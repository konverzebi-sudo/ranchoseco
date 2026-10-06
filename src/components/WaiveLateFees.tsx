import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eraser } from 'lucide-react'
import { Button, Field, Input, Modal, SearchInput, Select, Textarea, cx } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { date, money, monthName, today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { getActor } from '@/lib/actor'
import { TeamSelect } from './Team'
import type { FeeBalance } from '@/lib/types'

type Action = 'recargo' | 'descuento'
type Pick = { action: Action; amount: string }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Perdonar recargos y adeudos: se escoge al niño y el cargo, y qué se le hace:
 * perdonar el recargo o hacer un descuento / beca por un monto (se cobra menos).
 * Siempre se pide por qué y quién lo autorizó o registró. Queda anotado en el cargo
 * y como aviso en el Dashboard.
 */
export default function WaiveLateFeesModal({ fees, names, preselect = [], onClose }: {
  fees: FeeBalance[]; names: Map<string, string>; preselect?: string[]; onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const list = fees.filter((f) => Number(f.balance) > 0)
    .sort((a, b) => (names.get(a.student_id) ?? '').localeCompare(names.get(b.student_id) ?? '', 'es') || a.period.localeCompare(b.period))
  const [sel, setSel] = useState<Record<string, Pick>>(() => Object.fromEntries(preselect.map((id) => [id, { action: 'recargo' as Action, amount: '' }])))
  const [q, setQ] = useState('')
  const [reason, setReason] = useState('')
  const [who, setWho] = useState(getActor)
  const [saving, setSaving] = useState(false)
  const shown = list.filter((f) => sel[f.id] || !q || norm(names.get(f.student_id) ?? '').includes(norm(q)))
  const valueOf = (f: FeeBalance, p: Pick) => (p.action === 'recargo' ? Number(f.late_fee) : Math.min(Number(p.amount) || 0, Number(f.balance)))
  const chosen = list.filter((f) => sel[f.id])
  const total = chosen.reduce((a, f) => a + valueOf(f, sel[f.id]), 0)
  const toggle = (f: FeeBalance) => setSel((s) => {
    const n = { ...s }
    if (n[f.id]) delete n[f.id]
    else n[f.id] = { action: Number(f.late_fee) > 0 ? 'recargo' : 'descuento', amount: '' }
    return n
  })

  const save = async () => {
    if (!chosen.length) return toast.error('Escoge a qué niño y a qué cargo.')
    for (const f of chosen) {
      const p = sel[f.id]
      if (p.action === 'recargo' && !(Number(f.late_fee) > 0)) return toast.error(`${names.get(f.student_id)} no tiene recargo en ${monthName(f.period)}: escoge "Descuento / beca".`)
      if (p.action === 'descuento' && !(Number(p.amount) > 0)) return toast.error(`Escribe cuánto se le descuenta a ${names.get(f.student_id)}.`)
    }
    if (reason.trim().length < 3) return toast.error('Escribe por qué.')
    if (who.trim().length < 2) return toast.error('Escoge quién lo autorizó.')
    setSaving(true)
    try {
      for (const f of chosen) {
        const p = sel[f.id]
        const v = valueOf(f, p)
        const line = `${p.action === 'recargo' ? 'Recargo perdonado' : 'Descuento'} de ${money(v)} el ${date(today())}: ${reason.trim()} · autorizó/registró: ${who.trim()}`
        const notes = [f.notes, line].filter(Boolean).join(' | ')
        unwrap(await supabase.from('fees').update(p.action === 'recargo'
          ? { late_fee_waived: Number(f.late_fee_waived) + Number(f.late_fee), notes }
          : { discount: Number(f.discount) + v, discount_reason: `Descuento: ${reason.trim()}`, notes }).eq('id', f.id))
      }
      await notify(`Se perdonaron / descontaron ${money(total)}`,
        `${chosen.map((f) => `${names.get(f.student_id) ?? 'Alumno'} (${monthName(f.period)}: ${sel[f.id].action === 'recargo' ? 'recargo' : 'descuento'} ${money(valueOf(f, sel[f.id]))})`).join(', ')} · Por qué: ${reason.trim()} · Autorizó/registró: ${who.trim()}`,
        '/cobranza', 'recargo')
      await Promise.all(['fees', 'accounts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`Listo: ${money(total)} perdonados / descontados`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Perdonar recargos y adeudos"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={Eraser} onClick={save} loading={saving} disabled={!chosen.length}>Aplicar {money(total)}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Escoge al niño y qué se le hace: <b>perdonar el recargo</b> o un <b>descuento / beca</b> (se le cobra menos). Lo demás sigue pendiente.</p>
        <SearchInput value={q} onChange={setQ} placeholder="Buscar niño" />
        {list.length === 0 ? <p className="text-sm text-muted">No hay adeudos pendientes.</p> : (
          <ul className="max-h-80 divide-y divide-ink-700 overflow-y-auto rounded-xl border border-ink-600">
            {shown.map((f) => {
              const p = sel[f.id]
              return (
                <li key={f.id} className={cx('px-3 py-2 text-sm', p && 'bg-brand-dim')}>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input type="checkbox" checked={!!p} onChange={() => toggle(f)} className="h-4 w-4 accent-[#F2E30A]" />
                    <span className="min-w-0 flex-1 truncate"><b>{names.get(f.student_id) ?? 'Alumno'}</b> <span className="text-muted">· {f.concept} {monthName(f.period)}</span></span>
                    <span className="whitespace-nowrap text-xs">debe <b>{money(f.balance)}</b>{Number(f.late_fee) > 0 && <span className="text-bad"> · recargo {money(f.late_fee)}</span>}</span>
                  </label>
                  {p && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                      <Select value={p.action} onChange={(e) => setSel({ ...sel, [f.id]: { ...p, action: e.target.value as Action } })} className="h-9 w-48 text-sm" aria-label="Qué se le hace">
                        {Number(f.late_fee) > 0 && <option value="recargo">Perdonar recargo ({money(f.late_fee)})</option>}
                        <option value="descuento">Descuento / beca</option>
                      </Select>
                      {p.action === 'descuento' && (
                        <Input type="number" min="0" inputMode="decimal" value={p.amount} onChange={(e) => setSel({ ...sel, [f.id]: { ...p, amount: e.target.value } })}
                          placeholder={`Hasta ${f.balance}`} className="h-9 w-32" aria-label="Monto del descuento" />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <Field label="¿Por qué? *"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Pagó a tiempo por transferencia; beca por desempeño; hermano entró a medio mes…" /></Field>
        <Field label="¿Quién lo autorizó? *"><TeamSelect value={who} onChange={setWho} /></Field>
        <p className="text-xs text-muted">Queda anotado en el cargo del niño y como aviso en el Dashboard.</p>
      </div>
    </Modal>
  )
}
