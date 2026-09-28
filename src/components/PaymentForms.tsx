import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, Paperclip } from 'lucide-react'
import { addMonths, startOfMonth, setDate } from 'date-fns'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import { useToast } from './toast'
import { useCategories, useFees, useSettings, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap, BUCKETS } from '@/lib/supabase'
import { METHOD_LABEL, date, money, monthName, toISODate, today } from '@/lib/format'
import { TIER_LABEL, joinTier, tierAmount, tierNote, type JoinTier } from '@/lib/prorate'
import { PROMO_REASON, memberPrice } from '@/lib/siblings'
import { REINSCRIPTION_FEE } from '@/lib/inactive'
import type { PaymentMethod } from '@/lib/types'

const PAY_KEYS = [['fees'], ['accounts'], ['payments']]
async function refresh(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all(PAY_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })))
}

/**
 * Precio de la mensualidad de un alumno: normal de su categoría y, si aplica,
 * el descuento por promo de hermanos (vigente) o por su cuota especial / beca.
 */
export function useMonthlyPrice(student: StudentRow) {
  const { data: settings } = useSettings()
  const { data: categories } = useCategories()
  const { data: students } = useStudents()
  const cat = categories?.find((c) => c.id === student.category_id)
  const regular = Number(cat?.monthly_fee ?? settings?.default_monthly_fee ?? 0)
  const group = student.sibling_group_id ? (students ?? []).filter((x) => x.sibling_group_id === student.sibling_group_id) : []
  const promoValid = group.length >= 2 && group.every((x) => x.status !== 'baja')
  const promo = promoValid ? memberPrice(student, student.sibling_order ?? 1, settings?.sibling_prices?.map(Number)) : null
  const target = promo ?? (student.monthly_fee != null ? Number(student.monthly_fee) : null)
  const discount = target != null ? Math.max(0, regular - target) : 0
  return { regular, discount, toPay: regular - discount, reason: promo != null ? PROMO_REASON : discount > 0 ? 'Beca' : null, dueDay: settings?.due_day ?? 8 }
}

const ADV = 'adv:'

/** Registrar pago completo o parcial sobre un cargo pendiente, o pagar meses por adelantado. */
export function PaymentModal({ student, feeId, onClose }: { student: StudentRow; feeId?: string; onClose: () => void }) {
  const fees = useFees(student.id)
  const price = useMonthlyPrice(student)
  const qc = useQueryClient()
  const toast = useToast()
  const open = useMemo(() => (fees.data ?? []).filter((f) => Number(f.balance) > 0).sort((a, b) => a.period.localeCompare(b.period)), [fees.data])
  // Próximos 3 meses que aún no tienen mensualidad: se pueden pagar por adelantado
  const advance = useMemo(() => {
    const taken = new Set((fees.data ?? []).filter((f) => f.concept === 'Mensualidad').map((f) => f.period.slice(0, 10)))
    const out: string[] = []
    for (let i = 0; out.length < 3 && i < 12; i++) {
      const p = toISODate(startOfMonth(addMonths(new Date(), i)))
      if (!taken.has(p)) out.push(p)
    }
    return out
  }, [fees.data])
  const [selected, setSelected] = useState(feeId ?? '')
  const current = selected || (open[0]?.id ?? (advance[0] ? ADV + advance[0] : ''))
  const advPeriod = current.startsWith(ADV) ? current.slice(ADV.length) : null
  const existing = open.find((f) => f.id === current)
  const fee = existing ?? (advPeriod ? { id: '', concept: 'Mensualidad', period: advPeriod, balance: price.toPay, late_fee: 0 } : undefined)
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
    if (advPeriod && !(price.regular > 0)) return toast.error('Configura la mensualidad en Categorías o Configuración.')
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
      let feeIdToPay = fee.id
      if (advPeriod) {
        // Pago adelantado: se crea la mensualidad de ese mes con su precio y luego se paga
        const created = unwrap(await supabase.from('fees').insert({
          student_id: student.id, concept: 'Mensualidad', period: advPeriod, amount: price.regular,
          due_date: dueDateFor(advPeriod, price.dueDay), discount: price.discount, discount_reason: price.reason,
          notes: 'Pagada por adelantado',
        }).select('id').single()) as { id: string }
        feeIdToPay = created.id
      }
      unwrap(await supabase.from('payments').insert({
        fee_id: feeIdToPay, student_id: student.id, amount: value, paid_at: paidAt, method, notes: notes.trim() || null, receipt_path,
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
      footer={open.length || advance.length ? <>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="pay-form" icon={Save} loading={saving}>Registrar {money(value)}</Button>
      </> : undefined}>
      {fees.isLoading ? null : open.length === 0 && advance.length === 0 ? (
        <p className="text-sm text-muted">{student.full_name} no tiene pagos pendientes ni meses por adelantar.</p>
      ) : (
        <form id="pay-form" onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">Alumno: <span className="font-medium text-white">{student.full_name}</span></p>
          <Field label="Concepto a pagar">
            <Select value={current} onChange={(e) => { setSelected(e.target.value); setAmount('') }}>
              {open.length > 0 && (
                <optgroup label="Pendientes">
                  {open.map((f) => <option key={f.id} value={f.id}>{f.concept} {monthName(f.period)} — saldo {money(f.balance)}</option>)}
                </optgroup>
              )}
              {advance.length > 0 && (
                <optgroup label="Pagar por adelantado">
                  {advance.map((p) => <option key={p} value={ADV + p}>Mensualidad {monthName(p)} — {money(price.toPay)}</option>)}
                </optgroup>
              )}
            </Select>
          </Field>
          {open.length === 0 && <p className="-mt-2 text-xs text-ok">Está al corriente. Puedes registrar un pago adelantado.</p>}
          {advPeriod && price.discount > 0 && (
            <p className="-mt-2 text-xs text-muted">Precio normal {money(price.regular)} − {price.reason} {money(price.discount)} = {money(price.toPay)}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Importe" hint={`Saldo: ${money(fee?.balance)}${Number(fee?.late_fee) > 0 ? ` (incluye ${money(fee?.late_fee)} de recargo)` : ''}. Déjalo así para liquidar o escribe un pago parcial.`}>
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

/** Precio de la inscripción. */
export const INSCRIPTION_FEE = 600
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

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
  const isInscription = norm(concept.trim()) === 'inscripcion'
  const isMonthly = norm(concept.trim()) === 'mensualidad'
  const autoTier = joinTier(student.enrolled_at, periodDate) ?? 'completo'
  const [tierPick, setTierPick] = useState<JoinTier | null>(null)
  const tier: JoinTier = isMonthly ? (tierPick ?? autoTier) : 'completo'
  const isReinscription = norm(concept.trim()) === 'reinscripcion'
  const suggestedFor = isInscription ? INSCRIPTION_FEE : isReinscription ? REINSCRIPTION_FEE : tierAmount(suggested, tier)
  const value = amount === '' ? suggestedFor : Number(amount)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!concept.trim()) return toast.error('Escribe el concepto.')
    if (!(value > 0)) return toast.error('Define el importe (o configura la mensualidad en Categorías / Configuración).')
    setSaving(true)
    try {
      unwrap(await supabase.from('fees').insert({
        student_id: student.id, concept: concept.trim(), period: periodDate, amount: value, due_date: dueValue,
        notes: tierNote(tier),
      }))
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
          <datalist id="concepts">{['Mensualidad', 'Inscripción', 'Reinscripción', 'Uniforme', 'Torneo', 'Arbitraje'].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mes"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Importe"><Input type="number" inputMode="decimal" min="1" step="0.01" placeholder={suggestedFor ? String(suggestedFor) : '0'} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Vence"><Input type="date" value={dueValue} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        {isMonthly && (
          <div className="rounded-xl border border-ink-600 bg-ink-900 p-4 text-sm">
            <p className="font-medium">¿Cuándo entró?</p>
            <p className="mb-2 text-xs text-muted">Del 1 al 15: mes completo · del 16 al 22: mitad · del 23 en adelante: $100.
              {autoTier !== 'completo' && tierPick === null && <> Se inscribió el {date(student.enrolled_at)}, por eso se eligió solo.</>}</p>
            <div className="flex flex-wrap gap-2">
              {(['completo', 'mitad', 'minimo'] as JoinTier[]).map((t) => (
                  <button type="button" key={t} onClick={() => { setTierPick(t); setAmount('') }}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tier === t ? 'bg-brand text-ink' : 'bg-ink-700 text-muted hover:text-white'}`}>
                    {TIER_LABEL[t]} · {money(tierAmount(suggested, t))}
                  </button>
                ))}
            </div>
          </div>
        )}
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
  const [tierOverride, setTierOverride] = useState<Record<string, JoinTier>>({})
  const periodDate = `${period}-01`

  const plan = useMemo(() => {
    const existing = new Set((fees ?? []).filter((f) => f.period === periodDate && f.concept === 'Mensualidad').map((f) => f.student_id))
    const active = students.filter((s) => s.status === 'activo')
    const rows = active.filter((s) => !existing.has(s.id)).map((s) => {
      const cat = categories?.find((c) => c.id === s.category_id)
      const regular = Number(cat?.monthly_fee ?? settings?.default_monthly_fee ?? 0)
      const auto = joinTier(s.enrolled_at, periodDate)
      const tier: JoinTier = tierOverride[s.id] ?? auto ?? 'completo'
      const amount = tierAmount(regular, tier)
      // Promo hermanos (en mes completo) o cuota especial / beca individual
      // Candado: la promo sólo aplica si todos los hermanos del grupo siguen inscritos
      const group = s.sibling_group_id ? students.filter((x) => x.sibling_group_id === s.sibling_group_id) : []
      const promoValid = group.length >= 2 && group.every((x) => x.status !== 'baja')
      const promo = promoValid ? memberPrice(s, s.sibling_order ?? 1, settings?.sibling_prices?.map(Number)) : null
      const reason = promo != null ? PROMO_REASON : 'Beca'
      const target = promo ?? (s.monthly_fee != null ? Number(s.monthly_fee) : null)
      const discount = target != null && tier === 'completo' ? Math.max(0, regular - target) : 0
      return { s, auto, tier, regular, amount, discount, reason }
    }).filter((r) => r.auto !== null) // si se inscribe después de ese mes, ese mes no paga
    return { toCreate: rows.filter((r) => r.amount > 0), noAmount: rows.filter((r) => !(r.amount > 0)), already: existing.size }
  }, [fees, students, categories, settings, periodDate, tierOverride])

  const run = async () => {
    setSaving(true)
    try {
      const due = dueDateFor(periodDate, settings?.due_day ?? 10)
      const payload = plan.toCreate.map(({ s, amount, discount, tier, reason }) => ({
        student_id: s.id, concept: 'Mensualidad', period: periodDate, amount, due_date: due,
        discount, discount_reason: discount > 0 ? reason : null,
        notes: tierNote(tier),
      }))
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

  const total = plan.toCreate.reduce((s, r) => s + r.amount - r.discount, 0)
  const becado = plan.toCreate.reduce((s, r) => s + r.discount, 0)
  return (
    <Modal open onClose={onClose} title="Generar mensualidades"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={run} loading={saving} disabled={!plan.toCreate.length}>Crear {plan.toCreate.length} mensualidades</Button></>}>
      <div className="space-y-4 text-sm">
        <Field label="Mes"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <div className="rounded-xl bg-ink-900 p-4">
          <p>Se crearán <b className="text-brand">{plan.toCreate.length}</b> mensualidades por <b>{money(total)}</b>, con vencimiento el día {settings?.due_day ?? 10}.</p>
          {becado > 0 && <p className="mt-1 text-ok">Incluye {money(becado)} en becas y promo de hermanos.</p>}
          {plan.already > 0 && <p className="mt-1 text-muted">{plan.already} alumnos ya tienen la mensualidad de este mes (no se duplican).</p>}
          {plan.noAmount.length > 0 && (
            <p className="mt-2 text-warn">{plan.noAmount.length} alumnos no tienen importe definido. Configura la mensualidad en Categorías o en Configuración.</p>
          )}
        </div>
        {(() => {
          const late = plan.toCreate.filter((r) => r.auto !== 'completo')
          if (!late.length) return null
          return (
            <div className="rounded-xl border border-ink-600 p-4">
              <p className="font-medium">{late.length} {late.length === 1 ? 'alumno entró' : 'alumnos entraron'} a medio mes</p>
              <p className="mb-3 text-xs text-muted">Del 1 al 15: mes completo · del 16 al 22: mitad · del 23 en adelante: $100. Toca otra opción para cambiarlo.</p>
              <ul className="space-y-3">
                {late.map((r) => (
                  <li key={r.s.id}>
                    <p className="truncate">{r.s.full_name} <span className="text-xs text-muted">· entró el {date(r.s.enrolled_at, "d 'de' MMM")}</span></p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(['completo', 'mitad', 'minimo'] as JoinTier[]).map((t) => (
                  <button type="button" key={t} onClick={() => setTierOverride((o) => ({ ...o, [r.s.id]: t }))}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${r.tier === t ? 'bg-brand text-ink' : 'bg-ink-700 text-muted hover:text-white'}`}>
                    {TIER_LABEL[t]} · {money(tierAmount(r.regular, t))}
                  </button>
                ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })()}
        <p className="text-muted">Próximo mes sugerido: {monthName(toISODate(addMonths(new Date(periodDate + 'T12:00:00'), 1)))}</p>
      </div>
    </Modal>
  )
}
