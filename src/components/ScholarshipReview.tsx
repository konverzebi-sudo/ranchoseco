import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GraduationCap, Wallet } from 'lucide-react'
import { Button, Field, Input, Modal } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { money, monthName } from '@/lib/format'
import type { FeeBalance } from '@/lib/types'

/**
 * Decide si un pago menor a la cuota normal fue BECA o ADEUDO.
 * Se escribe cuánto es la mensualidad y cuánto paga el alumno:
 * - Beca: la diferencia (mensualidad − paga) se registra como descuento
 *   y, opcionalmente, lo que paga queda como cuota especial del alumno.
 * - Adeudo: el cargo deja de estar "por confirmar" y el saldo queda pendiente.
 */
export function ScholarshipReviewModal({ fee, studentName, onClose }: { fee: FeeBalance; studentName?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [saving, setSaving] = useState<'beca' | 'adeudo' | null>(null)
  const [keepFee, setKeepFee] = useState(true)
  const paid = Number(fee.paid)
  const [price, setPrice] = useState(String(Number(fee.amount)))
  const [pays, setPays] = useState(String(paid))
  const priceN = Number(price) || 0
  const paysN = Number(pays) || 0
  const scholarship = Math.max(0, priceN - paysN)
  const stillOwes = Math.max(0, paysN - paid)
  const debt = Math.max(0, priceN - Number(fee.discount) - paid)
  const invalid = !(priceN > 0) || paysN < 0 || paysN > priceN

  const refresh = () => Promise.all(['fees', 'accounts', 'students', 'student'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  const asScholarship = async () => {
    if (invalid) return toast.error('Revisa los montos: lo que paga no puede ser mayor que la mensualidad.')
    setSaving('beca')
    try {
      unwrap(await supabase.from('fees').update({ amount: priceN, discount: scholarship, discount_reason: scholarship > 0 ? 'Beca' : null, review: null }).eq('id', fee.id))
      if (keepFee && fee.concept === 'Mensualidad') {
        unwrap(await supabase.from('students').update({ monthly_fee: paysN }).eq('id', fee.student_id))
      }
      await refresh()
      toast.ok(`Beca de ${money(scholarship)} registrada`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(null) }
  }

  const asDebt = async () => {
    if (!(priceN > 0)) return toast.error('Escribe cuánto es la mensualidad.')
    setSaving('adeudo')
    try {
      unwrap(await supabase.from('fees').update({ amount: priceN, review: null }).eq('id', fee.id))
      await refresh()
      toast.ok(`Registrado como adeudo de ${money(debt)}`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(null) }
  }

  return (
    <Modal open onClose={onClose} title="¿Beca o adeudo?">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {studentName && <><span className="font-medium text-white">{studentName}</span> · </>}
          {fee.concept} {monthName(fee.period)} · lleva pagado <b className="text-white">{money(paid)}</b>.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mensualidad">
            <Input type="number" inputMode="decimal" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="¿Cuánto paga?">
            <Input type="number" inputMode="decimal" min="0" step="0.01" value={pays} onChange={(e) => setPays(e.target.value)} />
          </Field>
        </div>
        {invalid ? (
          <p className="text-bad">Lo que paga no puede ser mayor que la mensualidad.</p>
        ) : stillOwes > 0 && (
          <p className="text-warn">Con la beca, de este mes le faltarán {money(stillOwes)} por pagar.</p>
        )}
        <button onClick={asScholarship} disabled={!!saving || invalid}
          className="flex w-full items-start gap-3 rounded-2xl border border-ink-600 bg-ink-900 p-4 text-left transition hover:border-ok disabled:opacity-50">
          <GraduationCap className="mt-0.5 h-6 w-6 shrink-0 text-ok" />
          <div>
            <p className="font-semibold">Es beca: {money(scholarship)} becados</p>
            <p className="mt-0.5 text-muted">Paga {money(paysN)} de {money(priceN)}. La diferencia se suma al total de becas.</p>
          </div>
        </button>
        {fee.concept === 'Mensualidad' && (
          <label className="flex items-center gap-2 pl-1 text-muted">
            <input type="checkbox" checked={keepFee} onChange={(e) => setKeepFee(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" />
            Cobrarle {money(paysN)} también en los siguientes meses (cuota especial)
          </label>
        )}
        <button onClick={asDebt} disabled={!!saving}
          className="flex w-full items-start gap-3 rounded-2xl border border-ink-600 bg-ink-900 p-4 text-left transition hover:border-bad">
          <Wallet className="mt-0.5 h-6 w-6 shrink-0 text-bad" />
          <div>
            <p className="font-semibold">Es adeudo: debe {money(debt)}</p>
            <p className="mt-0.5 text-muted">No hay beca. Queda como saldo pendiente para cobrarlo.</p>
          </div>
        </button>
        {saving && <p className="text-center text-muted">Guardando…</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Decidir después</Button></div>
      </div>
    </Modal>
  )
}
