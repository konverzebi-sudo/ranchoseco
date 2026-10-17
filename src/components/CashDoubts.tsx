import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Save, X } from 'lucide-react'
import { Button, Card, Input, Modal } from './ui'
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
 * Cada duda es una línea; al picarla se abre la ventana para explicarla (una o varias cantidades).
 */
export function CashDoubtsCard() {
  const doubts = useCashDoubts()
  const [open, setOpen] = useState<{ cut: CashCut; missing: number } | null>(null)
  if (!doubts.length) return null
  return (
    <Card className="border-bad/50">
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <AlertTriangle className="h-5 w-5 text-bad" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Dudas de caja</h2>
        <span className="ml-auto text-xs text-muted">Pica una para explicarla</span>
      </div>
      <ul className="divide-y divide-ink-700">
        {doubts.map(({ c, missing }) => (
          <li key={c.id}>
            <button type="button" onClick={() => setOpen({ cut: c, missing })} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-ink-700">
              <span>Corte del <b>{date(c.cut_date, "d 'de' MMMM")}</b></span>
              <span className="flex items-center gap-2">faltan <b className="text-bad">{money(missing)}</b><ChevronRight className="h-4 w-4 text-muted" /></span>
            </button>
          </li>
        ))}
      </ul>
      {open && <DoubtModal cut={open.cut} missing={open.missing} onClose={() => setOpen(null)} />}
    </Card>
  )
}

function DoubtModal({ cut, missing, onClose }: { cut: CashCut; missing: number; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [lines, setLines] = useState([{ from: '', amount: String(missing) }])
  const [saving, setSaving] = useState(false)
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0)
  const set = (i: number, k: 'from' | 'amount', v: string) => setLines((x) => x.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const save = async () => {
    const ok = lines.filter((l) => l.from.trim() || Number(l.amount) > 0)
    if (!ok.length) return toast.error('Escribe de dónde salió y cuánto.')
    if (ok.some((l) => !l.from.trim())) return toast.error('Escribe de dónde salió cada cantidad.')
    if (ok.some((l) => !(Number(l.amount) > 0))) return toast.error('Escribe cuánto en cada línea.')
    setSaving(true)
    try {
      const distribution = [...(cut.distribution ?? []), ...ok.map((l) => ({ to: `${SOURCE_PREFIX}${l.from.trim()}`, amount: -Number(l.amount) }))]
      unwrap(await supabase.from('cash_cuts').update({ distribution }).eq('id', cut.id))
      await notify(`Se explicó un faltante del corte del ${date(cut.cut_date, "d 'de' MMM")}`, ok.map((l) => `${money(Number(l.amount))} vino de: ${l.from.trim()}`).join(' · '))
      await Promise.all(['cash_cuts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(total + 0.5 >= missing ? 'Listo, ese corte ya cuadra' : `Anotado. Todavía faltan ${money(missing - total)} por explicar`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Corte del ${date(cut.cut_date, "d 'de' MMMM")}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Save} loading={saving} onClick={save}>Guardar</Button></>}>
      <div className="space-y-3 text-sm">
        <p>Faltan <b className="text-bad">{money(missing)}</b>. ¿De dónde salió ese dinero (o por qué falta)?</p>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={l.from} onChange={(e) => set(i, 'from', e.target.value)} list="cash-doubt-sources" placeholder="Ej. préstamo de Marco" className="h-10 min-w-0 flex-1" autoFocus={i === 0} />
            <Input type="number" min="0" inputMode="decimal" value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} className="h-10 w-28" aria-label="Cantidad" />
            {lines.length > 1 && <button type="button" onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="text-muted hover:text-bad" aria-label="Quitar"><X className="h-4 w-4" /></button>}
          </div>
        ))}
        <datalist id="cash-doubt-sources">{SOURCES.map((x) => <option key={x} value={x} />)}</datalist>
        <button type="button" onClick={() => setLines((x) => [...x, { from: '', amount: String(Math.max(0, Math.round((missing - total) * 100) / 100)) }])} className="text-brand hover:underline">+ Salió de varios lados</button>
        {lines.length > 1 && (
          <p className={total + 0.5 >= missing ? 'text-ok' : 'text-warn'}>
            Suma {money(total)} de {money(missing)}{total + 0.5 < missing ? ` · faltan ${money(missing - total)}` : ''}
          </p>
        )}
      </div>
    </Modal>
  )
}
