import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ticket } from 'lucide-react'
import { Button, Field, Input, Modal } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { money, monthName } from '@/lib/format'
import type { FeeBalance } from '@/lib/types'

export const COUPON_PREFIX = 'Descuento: '

const REASONS = ['Pagó a tiempo', 'Promoción del mes', 'Promoción de la semana', 'Cortesía', 'Ajuste por clase cancelada']

/**
 * Descuento de UNA sola vez: esta vez se cobra menos (con su motivo).
 * Ej. $550 → $400 "Pagó a tiempo". No cambia la cuota del alumno:
 * los siguientes meses se cobran completos. También perdona el recargo.
 */
export function CouponModal({ fee, studentName, onClose }: { fee: FeeBalance; studentName?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const price = Number(fee.amount)
  const paid = Number(fee.paid)
  const [pays, setPays] = useState(String(paid > 0 ? paid : Math.max(0, price - Number(fee.discount))))
  const [reason, setReason] = useState('')
  const [clearSpecial, setClearSpecial] = useState(true)
  const [saving, setSaving] = useState(false)
  const paysN = Number(pays)
  const valid = pays !== '' && paysN >= 0 && paysN <= price
  const discount = valid ? price - paysN : 0
  const stillOwes = valid ? Math.max(0, paysN - paid) : 0

  const save = async () => {
    if (!valid) return toast.error(`Escribe cuánto pagará (entre $0 y ${money(price)}).`)
    if (!reason.trim()) return toast.error('Escribe el motivo del descuento.')
    setSaving(true)
    try {
      unwrap(await supabase.from('fees').update({
        discount,
        discount_reason: COUPON_PREFIX + reason.trim(),
        late_fee_waived: Number(fee.late_fee_waived) + Number(fee.late_fee),
        review: null,
        notes: [fee.notes, `Descuento de una sola vez: ${money(price)} → ${money(paysN)} (${reason.trim()})`].filter(Boolean).join(' · '),
      }).eq('id', fee.id))
      if (clearSpecial && fee.concept === 'Mensualidad') {
        unwrap(await supabase.from('students').update({ monthly_fee: null }).eq('id', fee.student_id))
      }
      await Promise.all(['fees', 'accounts', 'students', 'student'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(stillOwes > 0 ? `Descuento aplicado. Falta pagar ${money(stillOwes)}.` : `${fee.concept} ${monthName(fee.period)} liquidado con descuento`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Descuento de una sola vez"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Ticket} onClick={save} loading={saving}>Aplicar descuento</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {studentName && <><span className="font-medium text-white">{studentName}</span> · </>}
          {fee.concept} {monthName(fee.period)} · precio {money(price)}{paid > 0 && <> · ya pagó <b className="text-white">{money(paid)}</b></>}
        </p>
        <Field label="Esta vez paga" hint={valid ? `Descuento de ${money(discount)} sólo este mes` : undefined}>
          <Input type="number" inputMode="decimal" min="0" max={price} step="0.01" value={pays} onChange={(e) => setPays(e.target.value)} autoFocus />
        </Field>
        {valid && discount > 0 && (
          <Field label="¿Por qué el descuento?">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} list="coupon-reasons" placeholder="Ej. Pagó a tiempo" />
            <datalist id="coupon-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button type="button" key={r} onClick={() => setReason(r)}
                  className={`rounded-full border px-3 py-1 text-xs ${reason === r ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted hover:text-white'}`}>{r}</button>
              ))}
            </div>
          </Field>
        )}
        {valid && (stillOwes > 0
          ? <p className="text-warn">Con el descuento todavía le falta pagar {money(stillOwes)}.</p>
          : <p className="text-ok">Con el descuento, {monthName(fee.period)} queda liquidado.</p>)}
        {Number(fee.late_fee) > 0 && <p className="text-xs text-muted">También se perdona el recargo de {money(fee.late_fee)}.</p>}
        {fee.concept === 'Mensualidad' && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={clearSpecial} onChange={(e) => setClearSpecial(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#F2E30A]" />
            <span>Los siguientes meses paga la mensualidad completa<span className="block text-xs text-muted">Quita cualquier cuota especial. La promo de hermanos no se toca.</span></span>
          </label>
        )}
      </div>
    </Modal>
  )
}
