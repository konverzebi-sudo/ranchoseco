import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import { Button, Field, Input, Modal } from './ui'
import { useToast } from './toast'
import { INSCRIPTION_FEE, dueDateForStudent, useSuggestedFee } from './PaymentForms'
import { useSettings, type StudentRow } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, monthName, today } from '@/lib/format'
import { joinTier, tierAmount, tierNote } from '@/lib/prorate'
import { CREDENTIAL_CONCEPT, CREDENTIAL_FEE } from '@/lib/uniforms'

/** Cerrar el registro de un niño que vino a clase muestra: pasa a activo y se crean sus cargos. */
export function CloseTrialModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: settings } = useSettings()
  const regular = useSuggestedFee(student.category_id)
  const [day, setDay] = useState(today())
  const [inscription, setInscription] = useState(true)
  const [credential, setCredential] = useState(true)
  const [monthly, setMonthly] = useState(true)
  const [saving, setSaving] = useState(false)
  const period = `${day.slice(0, 7)}-01`
  const tier = joinTier(day, period) ?? 'completo'
  const monthlyAmount = tierAmount(Number(student.monthly_fee ?? regular), tier)
  const dueDay = settings?.due_day ?? 8

  const save = async () => {
    setSaving(true)
    try {
      unwrap(await supabase.from('students').update({ status: 'activo', enrolled_at: day }).eq('id', student.id))
      const due = dueDateForStudent(period, dueDay, day)
      const fees = [
        ...(inscription ? [{ student_id: student.id, concept: 'Inscripción', period, amount: INSCRIPTION_FEE, due_date: due }] : []),
        ...(credential ? [{ student_id: student.id, concept: CREDENTIAL_CONCEPT, period, amount: CREDENTIAL_FEE, due_date: due }] : []),
        ...(monthly && monthlyAmount > 0 ? [{ student_id: student.id, concept: 'Mensualidad', period, amount: monthlyAmount, due_date: due, notes: tierNote(tier) }] : []),
      ]
      if (fees.length) unwrap(await supabase.from('fees').upsert(fees, { onConflict: 'student_id,concept,period', ignoreDuplicates: true }))
      await Promise.all(['students', 'student', 'fees', 'accounts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`${student.full_name} ya es alumno inscrito`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Cerrar registro · ${student.full_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={UserCheck} onClick={save} loading={saving}>Inscribir</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Se queda en la academia: pasa a <b className="text-white">Activo</b> y se le crean sus cargos (con {dueDay} días para pagar sin recargo).</p>
        <Field label="Fecha de inscripción"><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inscription} onChange={(e) => setInscription(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" /> Cobrar inscripción <b>{money(INSCRIPTION_FEE)}</b></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={credential} onChange={(e) => setCredential(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" /> Cobrar Credencial Chivas <b>{money(CREDENTIAL_FEE)}</b></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" /> Cobrar mensualidad de {monthName(period)} <b>{money(monthlyAmount)}</b>{tier !== 'completo' && <span className="text-xs text-muted">({tierNote(tier)})</span>}</label>
      </div>
    </Modal>
  )
}
