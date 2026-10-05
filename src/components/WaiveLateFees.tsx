import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eraser } from 'lucide-react'
import { Button, Field, Input, Modal, Textarea, cx } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { date, money, monthName, today } from '@/lib/format'
import { notify } from '@/lib/notify'
import type { FeeBalance } from '@/lib/types'

/**
 * Perdonar recargos: se escoge a qué niños, y siempre se pide la justificación
 * y quién lo autorizó / cobró. Queda anotado en el cargo y como aviso en el Dashboard.
 */
export default function WaiveLateFeesModal({ fees, names, preselect = [], onClose }: {
  fees: FeeBalance[]; names: Map<string, string>; preselect?: string[]; onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const list = fees.filter((f) => Number(f.late_fee) > 0)
    .sort((a, b) => (names.get(a.student_id) ?? '').localeCompare(names.get(b.student_id) ?? '', 'es') || a.period.localeCompare(b.period))
  const [sel, setSel] = useState<Set<string>>(new Set(preselect))
  const [reason, setReason] = useState('')
  const [who, setWho] = useState('')
  const [saving, setSaving] = useState(false)
  const chosen = list.filter((f) => sel.has(f.id))
  const total = chosen.reduce((a, f) => a + Number(f.late_fee), 0)
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const save = async () => {
    if (!chosen.length) return toast.error('Escoge a qué niño se le perdona el recargo.')
    if (reason.trim().length < 3) return toast.error('Escribe la justificación.')
    if (who.trim().length < 2) return toast.error('Escribe quién lo autorizó o quién cobró.')
    setSaving(true)
    try {
      for (const f of chosen) {
        const line = `Recargo de ${money(f.late_fee)} perdonado el ${date(today())}: ${reason.trim()} · autorizó/cobró: ${who.trim()}`
        unwrap(await supabase.from('fees').update({
          late_fee_waived: Number(f.late_fee_waived) + Number(f.late_fee),
          notes: [f.notes, line].filter(Boolean).join(' | '),
        }).eq('id', f.id))
      }
      await notify(`Se perdonaron ${money(total)} de recargos`,
        `${chosen.map((f) => `${names.get(f.student_id) ?? 'Alumno'} (${monthName(f.period)} ${money(f.late_fee)})`).join(', ')} · Motivo: ${reason.trim()} · Autorizó/cobró: ${who.trim()}`,
        '/cobranza', 'recargo')
      await Promise.all(['fees', 'accounts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`Se perdonaron ${money(total)} de recargos`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Perdonar recargos"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={Eraser} onClick={save} loading={saving} disabled={!chosen.length}>Perdonar {money(total)}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Escoge a quién se le perdona. El precio de la mensualidad sigue pendiente; si no se paga, a partir de mañana el recargo vuelve a correr.</p>
        {list.length === 0 ? <p className="text-sm text-muted">No hay recargos pendientes.</p> : (
          <ul className="max-h-72 divide-y divide-ink-700 overflow-y-auto rounded-xl border border-ink-600">
            {list.map((f) => (
              <li key={f.id}>
                <label className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', sel.has(f.id) && 'bg-brand-dim')}>
                  <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="h-4 w-4 accent-[#F2E30A]" />
                  <span className="min-w-0 flex-1 truncate"><b>{names.get(f.student_id) ?? 'Alumno'}</b> <span className="text-muted">· {f.concept} {monthName(f.period)}</span></span>
                  <span className="font-semibold text-bad">{money(f.late_fee)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <Field label="Justificación *"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Pagó a tiempo por transferencia y no se registró" /></Field>
        <Field label="¿Quién lo autorizó / quién cobró? *"><Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Nombre" /></Field>
        <p className="text-xs text-muted">Queda anotado en el cargo del niño y como aviso en el Dashboard.</p>
      </div>
    </Modal>
  )
}
