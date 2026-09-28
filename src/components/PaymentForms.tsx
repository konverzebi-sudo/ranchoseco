import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, Paperclip } from 'lucide-react'
import { addMonths, startOfMonth, setDate } from 'date-fns'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import { useToast } from './toast'
import { useCategories, useFees, useSettings, type StudentRow } from '@/lib/api'
import { supabase, unwrap, BUCKETS } from '@/lib/supabase'
import { METHOD_LABEL, money, monthName, toISODate, today } from '@/lib/format'
import type { PaymentMethod } from '@/lib/types'

const PAY_KEYS = [['fees'], ['accounts'], ['payments']]
async function refresh(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all(PAY_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })))
}

/** Registrar pago completo o parcial sobre un cargo pendiente. */
export function PaymentModal({ student, feeId, onClose }: { student: StudentRow; feeId?: string; onClose: () => void }) {
  const fees = useFees(student.id)
  const qc = useQueryClient()
  const toast = useToast()
  const open = useMemo(() => (fees.data ?? []).filter((f) => Number(f.balance) > 0).sort((a, b) => a.period.localeCompare(b.period)), [fees.data])
  const [selected, setSelected] = useState(feeId ?? '')
  const fee = open.find((f) => f.id === (selected || open[0]?.id))
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [paidAt, setPaidAt] = useState(today())
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const value = amount === '' ? Number(fee?.balance ?? 0) : Number(amount)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!fee) return
    if (!(value > 0)) return toast.error('El importe debe ser mayor a cero.')
    if (value > Number(fee.balance)) return toast.error(`El importe excede el saldo de ${money(fee.balance)}.`)
    setSaving(true)
    try {
      let receipt_path: string | null = null
      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        receipt_path = `${student.id}/comprobante-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from(BUCKETS.receipts).upload(receipt_path, file, { contentType: file.type })
        if (error) throw new Error('No se pudo subir el comprobante: ' + error.message)
      }
      unwrap(await supabase.from('payments').insert({
        fee_id: fee.id, student_id: student.id, amount: value, paid_at: paidAt, method, notes: notes.trim() || null, receipt_path,
      }))
      await refresh(qc)
      toast.ok(value >= Number(fee.balance) ? `Pago registrado. ${fee.concept} liquidada.` : `Pago parcial registrado. Resta ${money(Number(fee.balance) - value)}.`)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Registrar pago"
      footer={open.length ? <>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="pay-form" icon={Save} loading={saving}>Registrar {money(value)}</Button>
      </> : undefined}>
      {fees.isLoading ? null : open.length === 0 ? (
        <p className="text-sm text-muted">{student.full_name} no tiene mensualidades pendientes. Crea primero un cargo.</p>
      ) : (
        <form id="pay-form" onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">Alumno: <span className="font-medium text-white">{student.full_name}</span></p>
          <Field label="Concepto a pagar">
            <Select value={fee?.id} onChange={(e) => { setSelected(e.target.value); setAmount('') }}>
              {open.map((f) => <option key={f.id} value={f.id}>{f.concept} {monthName(f.period)} — saldo {money(f.balance)}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Importe" hint={`Saldo: ${money(fee?.balance)}. Déjalo así para liquidar o escribe un pago parcial.`}>
              <Input type="number" inputMode="decimal" min="0.01" step="0.01" max={fee?.balance} placeholder={String(fee?.balance ?? '')} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Fecha de pago"><Input type="date" value={paidAt} max={today()} onChange={(e) => setPaidAt(e.target.value)} /></Field>
          </div>
          <Field label="Método de pago">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <button type="button" key={m} onClick={() => setMethod(m)}
                  className={`rounded-xl border px-2 py-2.5 text-sm font-medium ${method === m ? 'border-brand bg-brand text-ink' : 'border-ink-600 bg-ink-900 text-muted hover:text-white'}`}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-500 px-4 py-3 text-sm text-muted hover:text-white">
            <Paperclip className="h-4 w-4" />
            {file ? file.name : 'Adjuntar comprobante (opcional)'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Field label="Notas (opcional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        </form>
      )}
    </Modal>
  )
}

/** Monto sugerido: el de la categoría o el general de configuración. */
export function useSuggestedFee(categoryId: string | null) {
  const { data: settings } = useSettings()
  const { data: categories } = useCategories()
  const cat = categories?.find((c) => c.id === categoryId)
  return Number(cat?.monthly_fee ?? settings?.default_monthly_fee ?? 0)
}

export function dueDateFor(period: string, dueDay: number) {
  return toISODate(setDate(new Date(period + 'T12:00:00'), dueDay))
}

/** Crear un cargo (mensualidad, inscripción, uniforme, torneo…) para un alumno. */
export function FeeModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { data: settings } = useSettings()
  const suggested = useSuggestedFee(student.category_id)
  const qc = useQueryClient()
  const toast = useToast()
  const thisMonth = toISODate(startOfMonth(new Date()))
  const [concept, setConcept] = useState('Mensualidad')
  const [period, setPeriod] = useState(thisMonth.slice(0, 7))
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const periodDate = `${period}-01`
  const dueValue = due || dueDateFor(periodDate, settings?.due_day ?? 10)
  const value = amount === '' ? suggested : Number(amount)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!concept.trim()) return toast.error('Escribe el concepto.')
    if (!(value > 0)) return toast.error('Define el importe (o configura la mensualidad en Categorías / Configuración).')
    setSaving(true)
    try {
      unwrap(await supabase.from('fees').insert({ student_id: student.id, concept: concept.trim(), period: periodDate, amount: value, due_date: dueValue }))
      await refresh(qc)
      toast.ok('Cargo creado')
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo cargo"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="fee-form" icon={Save} loading={saving}>Crear cargo</Button></>}>
      <form id="fee-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Alumno: <span className="font-medium text-white">{student.full_name}</span></p>
        <Field label="Concepto">
          <Input value={concept} onChange={(e) => setConcept(e.target.value)} list="concepts" />
          <datalist id="concepts">{['Mensualidad', 'Inscripción', 'Uniforme', 'Torneo', 'Arbitraje'].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mes"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Importe"><Input type="number" inputMode="decimal" min="1" step="0.01" placeholder={suggested ? String(suggested) : '0'} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Vence"><Input type="date" value={dueValue} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Genera la mensualidad de un mes para todos los alumnos activos que aún no la tengan.
 * Usa el importe de su categoría o el general. No duplica cargos existentes.
 */
export function GenerateMonthModal({ students, onClose }: { students: StudentRow[]; onClose: () => void }) {
  const { data: settings } = useSettings()
  const { data: categories } = useCategories()
  const { data: fees } = useFees()
  const qc = useQueryClient()
  const toast = useToast()
  const [period, setPeriod] = useState(toISODate(startOfMonth(new Date())).slice(0, 7))
  const [saving, setSaving] = useState(false)
  const periodDate = `${period}-01`

  const plan = useMemo(() => {
    const existing = new Set((fees ?? []).filter((f) => f.period === periodDate && f.concept === 'Mensualidad').map((f) => f.student_id))
    const active = students.filter((s) => s.status === 'activo')
    const rows = active.filter((s) => !existing.has(s.id)).map((s) => {
      const cat = categories?.find((c) => c.id === s.category_id)
      return { s, amount: Number(cat?.monthly_fee ?? settings?.default_monthly_fee ?? 0) }
    })
    return { toCreate: rows.filter((r) => r.amount > 0), noAmount: rows.filter((r) => !(r.amount > 0)), already: existing.size }
  }, [fees, students, categories, settings, periodDate])

  const run = async () => {
    setSaving(true)
    try {
      const due = dueDateFor(periodDate, settings?.due_day ?? 10)
      const payload = plan.toCreate.map(({ s, amount }) => ({ student_id: s.id, concept: 'Mensualidad', period: periodDate, amount, due_date: due }))
      for (let i = 0; i < payload.length; i += 200) {
        unwrap(await supabase.from('fees').upsert(payload.slice(i, i + 200), { onConflict: 'student_id,concept,period', ignoreDuplicates: true }))
      }
      await refresh(qc)
      toast.ok(`${payload.length} mensualidades de ${monthName(periodDate)} creadas`)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  const total = plan.toCreate.reduce((s, r) => s + r.amount, 0)
  return (
    <Modal open onClose={onClose} title="Generar mensualidades"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={run} loading={saving} disabled={!plan.toCreate.length}>Crear {plan.toCreate.length} mensualidades</Button></>}>
      <div className="space-y-4 text-sm">
        <Field label="Mes"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <div className="rounded-xl bg-ink-900 p-4">
          <p>Se crearán <b className="text-brand">{plan.toCreate.length}</b> mensualidades por <b>{money(total)}</b>, con vencimiento el día {settings?.due_day ?? 10}.</p>
          {plan.already > 0 && <p className="mt-1 text-muted">{plan.already} alumnos ya tienen la mensualidad de este mes (no se duplican).</p>}
          {plan.noAmount.length > 0 && (
            <p className="mt-2 text-warn">{plan.noAmount.length} alumnos no tienen importe definido. Configura la mensualidad en Categorías o en Configuración.</p>
          )}
        </div>
        <p className="text-muted">Próximo mes sugerido: {monthName(toISODate(addMonths(new Date(periodDate + 'T12:00:00'), 1)))}</p>
      </div>
    </Modal>
  )
}
