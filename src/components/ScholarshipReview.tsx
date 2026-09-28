import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GraduationCap, Wallet } from 'lucide-react'
import { Button, Modal } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { money, monthName } from '@/lib/format'
import type { FeeBalance } from '@/lib/types'

/**
 * Decide si un pago menor a la cuota normal fue BECA o ADEUDO.
 * - Beca: la diferencia se registra como descuento (cuenta en el total becado)
 *   y, opcionalmente, ese monto queda como cuota especial del alumno.
 * - Adeudo: el cargo deja de estar "por confirmar" y el saldo queda pendiente.
 */
export function ScholarshipReviewModal({ fee, studentName, onClose }: { fee: FeeBalance; studentName?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [saving, setSaving] = useState<'beca' | 'adeudo' | null>(null)
  const [keepFee, setKeepFee] = useState(true)
  const paid = Number(fee.paid)
  const diff = Math.max(0, Number(fee.amount) - Number(fee.discount) - paid)

  const refresh = () => Promise.all(['fees', 'accounts', 'students', 'student'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  const asScholarship = async () => {
    setSaving('beca')
    try {
      unwrap(await supabase.from('fees').update({ discount: Number(fee.discount) + diff, discount_reason: 'Beca', review: null }).eq('id', fee.id))
      if (keepFee && fee.concept === 'Mensualidad') {
        unwrap(await supabase.from('students').update({ monthly_fee: paid }).eq('id', fee.student_id))
      }
      await refresh()
      toast.ok(`Beca de ${money(diff)} registrada`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(null) }
  }

  const asDebt = async () => {
    setSaving('adeudo')
    try {
      unwrap(await supabase.from('fees').update({ review: null }).eq('id', fee.id))
      await refresh()
      toast.ok(`Registrado como adeudo de ${money(diff)}`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(null) }
  }

  return (
    <Modal open onClose={onClose} title="¿Beca o adeudo?">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {studentName && <><span className="font-medium text-white">{studentName}</span> · </>}
          {fee.concept} {monthName(fee.period)}: pagó <b className="text-white">{money(paid)}</b> de {money(Number(fee.amount) - Number(fee.discount))}.
          Faltan <b className="text-brand">{money(diff)}</b>.
        </p>
        <button onClick={asScholarship} disabled={!!saving}
          className="flex w-full items-start gap-3 rounded-2xl border border-ink-600 bg-ink-900 p-4 text-left transition hover:border-ok">
          <GraduationCap className="mt-0.5 h-6 w-6 shrink-0 text-ok" />
          <div>
            <p className="font-semibold">Es beca: {money(diff)} becados</p>
            <p className="mt-0.5 text-muted">El mes queda pagado y la diferencia se suma al total de becas.</p>
          </div>
        </button>
        {fee.concept === 'Mensualidad' && (
          <label className="flex items-center gap-2 pl-1 text-muted">
            <input type="checkbox" checked={keepFee} onChange={(e) => setKeepFee(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" />
            Cobrarle {money(paid)} también en los siguientes meses (cuota especial)
          </label>
        )}
        <button onClick={asDebt} disabled={!!saving}
          className="flex w-full items-start gap-3 rounded-2xl border border-ink-600 bg-ink-900 p-4 text-left transition hover:border-bad">
          <Wallet className="mt-0.5 h-6 w-6 shrink-0 text-bad" />
          <div>
            <p className="font-semibold">Es adeudo: debe {money(diff)}</p>
            <p className="mt-0.5 text-muted">Queda como saldo pendiente para cobrarlo.</p>
          </div>
        </button>
        {saving && <p className="text-center text-muted">Guardando…</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Decidir después</Button></div>
      </div>
    </Modal>
  )
}
