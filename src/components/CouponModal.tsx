import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ticket } from 'lucide-react'
import { Button, Field, Input, Modal } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { money, monthName } from '@/lib/format'
import type { FeeBalance } from '@/lib/types'

export const COUPON_PREFIX = 'Cupón: '

/**
 * Cupón / promoción de UNA sola vez: el cargo queda liquidado con lo que ya se pagó
 * (el faltante y el recargo se registran como descuento con su motivo).
 * No cambia la cuota del alumno: los siguientes meses se cobran completos.
 */
export function CouponModal({ fee, studentName, onClose }: { fee: FeeBalance; studentName?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [clearSpecial, setClearSpecial] = useState(true)
  const [saving, setSaving] = useState(false)
  const paid = Number(fee.paid)
  const lateFee = Number(fee.late_fee)
  const principalLeft = Math.max(0, Number(fee.amount) - Number(fee.discount) - paid)

  const save = async () => {
    if (!reason.trim()) return toast.error('Escribe el motivo del cupón.')
    setSaving(true)
    try {
      unwrap(await supabase.from('fees').update({
        discount: Number(fee.discount) + principalLeft,
        discount_reason: COUPON_PREFIX + reason.trim(),
        late_fee_waived: Number(fee.late_fee_waived) + lateFee,
        review: null,
        notes: [fee.notes, `Cupón de ${money(principalLeft + lateFee)}: ${reason.trim()}`].filter(Boolean).join(' · '),
      }).eq('id', fee.id))
      if (clearSpecial && fee.concept === 'Mensualidad') {
        unwrap(await supabase.from('students').update({ monthly_fee: null }).eq('id', fee.student_id))
      }
      await Promise.all(['fees', 'accounts', 'students', 'student'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`${fee.concept} ${monthName(fee.period)} liquidado con cupón`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Liquidar con cupón"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Ticket} onClick={save} loading={saving}>Liquidar</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {studentName && <><span className="font-medium text-white">{studentName}</span> · </>}
          {fee.concept} {monthName(fee.period)}: pagó <b className="text-white">{money(paid)}</b>. Queda liquidado y el faltante
          ({money(principalLeft)}{lateFee > 0 ? ` + ${money(lateFee)} de recargo` : ''}) se registra como cupón.
        </p>
        <Field label="Motivo del cupón">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus list="coupon-reasons" placeholder="Ej. Promoción semana de septiembre" />
          <datalist id="coupon-reasons">
            {['Promoción del mes', 'Promoción de la semana', 'Descuento por pronto pago', 'Cortesía', 'Ajuste por clase cancelada'].map((r) => <option key={r} value={r} />)}
          </datalist>
        </Field>
        {fee.concept === 'Mensualidad' && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={clearSpecial} onChange={(e) => setClearSpecial(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#F2E30A]" />
            <span>Los siguientes meses paga la mensualidad completa<span className="block text-xs text-muted">Quita cualquier cuota especial que tenga. La promo de hermanos no se toca.</span></span>
          </label>
        )}
      </div>
    </Modal>
  )
}
