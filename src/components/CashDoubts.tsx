import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Save } from 'lucide-react'
import { Button, Card, Input } from './ui'
import { useToast } from './toast'
import { useCashCuts } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { cutBalance } from '@/lib/cashcut'
import { date, money } from '@/lib/format'
import { notify } from '@/lib/notify'
import type { CashCut } from '@/lib/types'

export const SOURCE_PREFIX = 'Vino de: '
export const SOURCES = ['Préstamo de ', 'Dinero del dueño', 'Ahorro apartado', 'Banco', 'Caja chica de otro lado', 'Otro']

/** Cortes en los que faltó dinero y todavía no se anotó de dónde salió. */
export function useCashDoubts() {
  const cuts = useCashCuts()
  const list = cuts.data ?? []
  return list.map((c, i) => ({ c, missing: Math.round(-cutBalance(c, list[i + 1]) * 100) / 100 })).filter((x) => x.missing > 0.5)
}

/**
 * Dudas de caja: desde que se hace el corte, si salió más de lo que había, queda aquí
 * hasta que alguien anota de dónde salió ese dinero (o por qué falta).
 */
export function CashDoubtsCard() {
  const doubts = useCashDoubts()
  if (!doubts.length) return null
  return (
    <Card className="border-bad/50">
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <AlertTriangle className="h-5 w-5 text-bad" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Dudas de caja</h2>
      </div>
      <p className="px-5 pt-3 text-xs text-muted">Salió más dinero del que había. Anota de dónde salió (o por qué falta) para que la caja cuadre.</p>
      <ul className="divide-y divide-ink-700">
        {doubts.map(({ c, missing }) => <DoubtRow key={c.id} cut={c} missing={missing} />)}
      </ul>
    </Card>
  )
}

function DoubtRow({ cut, missing }: { cut: CashCut; missing: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [from, setFrom] = useState('')
  const [amount, setAmount] = useState(String(missing))
  const [saving, setSaving] = useState(false)
  const save = async () => {
    const n = Number(amount)
    if (!from.trim()) return toast.error('Escribe de dónde salió o por qué falta.')
    if (!(n > 0)) return toast.error('Escribe cuánto.')
    setSaving(true)
    try {
      const distribution = [...(cut.distribution ?? []), { to: `${SOURCE_PREFIX}${from.trim()}`, amount: -n }]
      unwrap(await supabase.from('cash_cuts').update({ distribution }).eq('id', cut.id))
      await notify(`Se explicó un faltante del corte del ${date(cut.cut_date, "d 'de' MMM")}`, `${money(n)} vino de: ${from.trim()}`)
      await Promise.all(['cash_cuts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(n + 0.5 >= missing ? 'Listo, ese corte ya cuadra' : `Anotado. Todavía faltan ${money(missing - n)} por explicar`)
      setFrom('')
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <li className="space-y-2 px-5 py-3 text-sm">
      <p><Link to="/corte" className="font-semibold hover:text-brand">Corte del {date(cut.cut_date, "d 'de' MMMM")}</Link> · faltan <b className="text-bad">{money(missing)}</b> sin explicar</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={from} onChange={(e) => setFrom(e.target.value)} list="cash-doubt-sources" placeholder="¿De dónde salió? Ej. préstamo de Marco" className="h-9 min-w-0 flex-1" />
        <Input type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-28" aria-label="Monto" />
        <Button size="sm" icon={Save} loading={saving} onClick={save}>Guardar</Button>
      </div>
      <datalist id="cash-doubt-sources">{SOURCES.map((x) => <option key={x} value={x} />)}</datalist>
    </li>
  )
}
