import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PauseCircle, PlayCircle, UserX } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from './ui'
import { useToast } from './toast'
import { useFees, useSettings, type StudentRow } from '@/lib/api'
import { dueDateForStudent } from './PaymentForms'
import { supabase, unwrap } from '@/lib/supabase'
import { date, money, monthName, today } from '@/lib/format'
import { REINSCRIPTION_FEE, cycleEnd, inactiveDays, needsReinscription } from '@/lib/inactive'

const REASONS = ['Incapacidad', 'Lesión', 'Enfermedad', 'Viaje', 'Motivos familiares', 'Otro']

const refreshKeys = ['students', 'student', 'fees', 'accounts', 'sibling_groups']

/** Pasar a "Inactivo temporal": no se generan mensualidades mientras dure. */
export function PauseModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: fees } = useFees(student.id)
  const [reason, setReason] = useState('Incapacidad')
  const [other, setOther] = useState('')
  const [since, setSince] = useState(today())
  const [until, setUntil] = useState(cycleEnd(today()))
  const [fromMonth, setFromMonth] = useState(today().slice(0, 7))
  const [cancelFees, setCancelFees] = useState(true)
  const [saving, setSaving] = useState(false)

  // Mensualidades sin ningún pago desde el mes elegido: se pueden cancelar
  const cancellable = useMemo(
    () => (fees ?? []).filter((f) => f.concept === 'Mensualidad' && f.period.slice(0, 7) >= fromMonth && Number(f.paid) === 0),
    [fees, fromMonth],
  )

  const save = async () => {
    const motivo = reason === 'Otro' ? other.trim() || 'Otro' : reason
    if (until && until < since) return toast.error('El regreso estimado debe ser después de la fecha de inicio.')
    setSaving(true)
    try {
      unwrap(await supabase.from('students').update({
        status: 'suspendido', inactive_since: since, inactive_until: until || null, inactive_reason: motivo,
      }).eq('id', student.id))
      if (cancelFees && cancellable.length) {
        unwrap(await supabase.from('fees').delete().in('id', cancellable.map((f) => f.id)))
      }
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`${student.full_name} quedó como inactivo temporal${cancelFees && cancellable.length ? ` · se cancelaron ${cancellable.length} mensualidades` : ''}`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Inactivo temporal"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={PauseCircle} onClick={save} loading={saving}>Pasar a inactivo temporal</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted"><span className="font-medium text-white">{student.full_name}</span> no pagará mensualidades mientras esté inactivo. Al regresar antes de un año no paga reinscripción.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Motivo">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select>
          </Field>
          {reason === 'Otro' && <Field label="¿Cuál?"><Input value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
          <Field label="Desde"><Input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></Field>
          <Field label="Regreso estimado" hint="Por defecto, fin del ciclo (31 de julio)"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        </div>
        <div className="rounded-xl border border-ink-600 bg-ink-900 p-4">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={cancelFees} onChange={(e) => setCancelFees(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#F2E30A]" />
            <span>Cancelar sus mensualidades sin pagar a partir de
              <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="mx-1 h-8 rounded-lg border border-ink-600 bg-ink-800 px-2" aria-label="Mes desde" />
            </span>
          </label>
          <p className="mt-2 text-xs text-muted">
            {cancellable.length
              ? `Se cancelarán: ${cancellable.map((f) => `${monthName(f.period)} (${money(f.amount)})`).join(', ')}`
              : 'No tiene mensualidades sin pagar desde ese mes.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}

/** Regresa de inactivo temporal: sólo paga reinscripción si pasó un año o más. */
export function ReactivateModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const toast = useToast()
  const [back, setBack] = useState(today())
  const owes = needsReinscription(student.inactive_since, back)
  const [charge, setCharge] = useState(true)
  const [saving, setSaving] = useState(false)
  const days = inactiveDays(student.inactive_since, back)

  const save = async () => {
    setSaving(true)
    try {
      const history = student.inactive_since
        ? `Inactivo temporal (${student.inactive_reason ?? 'sin motivo'}) del ${date(student.inactive_since)} al ${date(back)}`
        : null
      unwrap(await supabase.from('students').update({
        status: 'activo', inactive_since: null, inactive_until: null, inactive_reason: null,
        ...(history ? { notes: [student.notes, history].filter(Boolean).join(' · ') } : {}),
      }).eq('id', student.id))
      if (owes && charge) {
        unwrap(await supabase.from('fees').upsert({
          student_id: student.id, concept: 'Reinscripción', period: back.slice(0, 7) + '-01', amount: REINSCRIPTION_FEE, due_date: dueDateForStudent(back.slice(0, 7) + '-01', settings?.due_day ?? 8, back),
          notes: 'Regresó después de un año o más inactivo',
        }, { onConflict: 'student_id,concept,period', ignoreDuplicates: true }))
      }
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`${student.full_name} está activo de nuevo${owes && charge ? ` · se creó la reinscripción de ${money(REINSCRIPTION_FEE)}` : ''}`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Reactivar alumno"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={PlayCircle} onClick={save} loading={saving}>Reactivar</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          <span className="font-medium text-white">{student.full_name}</span>
          {student.inactive_since ? <> estuvo inactivo desde el {date(student.inactive_since)}{student.inactive_reason ? ` (${student.inactive_reason})` : ''}.</> : ' estaba inactivo temporal.'}
        </p>
        <Field label="Regresa el"><Input type="date" value={back} onChange={(e) => setBack(e.target.value || today())} /></Field>
        {owes ? (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-4">
            <p className="font-semibold text-warn">Estuvo inactivo {Math.floor(days / 30)} meses (un año o más): paga reinscripción.</p>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" />
              Crear cargo de reinscripción por {money(REINSCRIPTION_FEE)}
            </label>
          </div>
        ) : (
          <div className="rounded-xl border border-ok/40 bg-ok/10 p-4">
            <p className="font-semibold text-ok">No paga reinscripción: estuvo inactivo {days} días (menos de un año).</p>
          </div>
        )}
        <p className="text-xs text-muted">Desde el siguiente "Generar mensualidades" se le vuelve a cobrar su mensualidad.</p>
      </div>
    </Modal>
  )
}

/** Semanas que vino en el mes hasta el día de la baja (máximo 4). */
export const weeksUntil = (iso: string) => Math.min(4, Math.max(1, Math.ceil(Number(iso.slice(8, 10)) / 7)))
/** Lo que se cobra de la mensualidad por las semanas que vino. */
export const proportional = (charge: number, weeks: number) => Math.round((charge * weeks) / 4)

/**
 * Dar de baja: opción de cobrar sólo las semanas que vino ese mes (pago proporcional).
 * Las mensualidades siguientes que no tengan pagos se cancelan.
 */
export function BajaModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: fees } = useFees(student.id)
  const [on, setOn] = useState(today())
  const [prop, setProp] = useState(true)
  const [weeks, setWeeks] = useState(() => weeksUntil(today()))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const period = on.slice(0, 7) + '-01'
  const fee = (fees ?? []).find((f) => f.concept === 'Mensualidad' && f.period === period)
  const charge = fee ? Number(fee.amount) - Number(fee.discount) : 0
  const paid = fee ? Number(fee.paid) : 0
  const newCharge = Math.max(proportional(charge, weeks), paid)
  const later = (fees ?? []).filter((f) => f.concept === 'Mensualidad' && f.period > period && Number(f.paid) === 0)

  const save = async () => {
    setSaving(true)
    try {
      if (prop && fee && newCharge < charge) {
        const note = `Baja el ${date(on)}: cobro proporcional de ${weeks} de 4 semanas (${money(newCharge)} de ${money(charge)})`
        unwrap(await supabase.from('fees').update({
          discount: Number(fee.amount) - newCharge,
          discount_reason: `Baja: proporcional ${weeks} de 4 semanas`,
          notes: [fee.notes, note].filter(Boolean).join(' | '),
        }).eq('id', fee.id))
      }
      if (later.length) unwrap(await supabase.from('fees').delete().in('id', later.map((f) => f.id)))
      unwrap(await supabase.from('students').update({ status: 'baja', notes: [student.notes, reason.trim() && `Baja el ${date(on)}: ${reason.trim()}`].filter(Boolean).join('\n') || student.notes }).eq('id', student.id))
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`${student.full_name.split(' ')[0]} quedó dado de baja`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Dar de baja · ${student.full_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={UserX} loading={saving} onClick={save}>Dar de baja</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Dejará de aparecer en listas de asistencia y cobranza, y su link para papás se desactiva. Su historial se conserva y se puede reactivar.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha de la baja"><Input type="date" value={on} max={today()} onChange={(e) => { const v = e.target.value || today(); setOn(v); setWeeks(weeksUntil(v)) }} /></Field>
          <Field label="Motivo (opcional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. cambio de ciudad" /></Field>
        </div>
        {fee ? (
          <div className="space-y-2 rounded-xl border border-ink-600 p-3 text-sm">
            <label className="flex cursor-pointer items-center gap-2 font-semibold">
              <input type="checkbox" checked={prop} onChange={(e) => setProp(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" />
              Cobrar sólo las semanas que vino en {monthName(period)} (pago proporcional)
            </label>
            {prop && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Semanas que vino:</span>
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" onClick={() => setWeeks(n)}
                      className={'rounded-lg border px-3 py-1 ' + (weeks === n ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 text-muted')}>{n}</button>
                  ))}
                </div>
                <p>Mensualidad {money(charge)} → se cobran <b className="text-brand">{money(newCharge)}</b> ({weeks} de 4 semanas).</p>
                {paid > proportional(charge, weeks) && <p className="text-xs text-warn">Ya había pagado {money(paid)}, así que no se cobra menos de eso.</p>}
              </>
            )}
          </div>
        ) : <p className="text-sm text-muted">No tiene mensualidad de {monthName(period)}.</p>}
        {later.length > 0 && <p className="text-xs text-muted">Se cancelan {later.length} mensualidad{later.length === 1 ? '' : 'es'} siguiente{later.length === 1 ? '' : 's'} sin pagos ({later.map((f) => monthName(f.period)).join(', ')}).</p>}
      </div>
    </Modal>
  )
}
