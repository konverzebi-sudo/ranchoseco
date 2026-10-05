import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, Paperclip } from 'lucide-react'
import { addDays, addMonths, startOfMonth, setDate } from 'date-fns'
import { Button, ConfirmDialog, Field, Input, Modal, Select, Textarea, cx } from './ui'
import { useToast } from './toast'
import { useCategories, useFees, useSettings, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap, BUCKETS } from '@/lib/supabase'
import { METHOD_LABEL, date, money, monthName, toISODate, today } from '@/lib/format'
import { TIER_LABEL, joinTier, tierAmount, tierNote, type JoinTier } from '@/lib/prorate'
import { PROMO_REASON, memberPrice } from '@/lib/siblings'
import { REINSCRIPTION_FEE } from '@/lib/inactive'
import { CREDENTIAL_CONCEPT, CREDENTIAL_FEE, UNIFORM_CONCEPTS, isUniformConcept } from '@/lib/uniforms'
import type { Payment, PaymentMethod } from '@/lib/types'
import { allocatePayment, payOrder } from '@/lib/allocate'
import { notify } from '@/lib/notify'

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

/**
 * Registrar un pago. Por defecto se aplica a lo que debe, primero lo más antiguo
 * (y lo que sobre se abona al siguiente mes por adelantado). También se puede elegir
 * a qué cargo corresponde.
 */
export function PaymentModal({ student, feeId, onClose }: { student: StudentRow; feeId?: string; onClose: () => void }) {
  const fees = useFees(student.id)
  const price = useMonthlyPrice(student)
  const qc = useQueryClient()
  const toast = useToast()
  const open = useMemo(() => (fees.data ?? []).filter((f) => Number(f.balance) > 0).sort(payOrder), [fees.data])
  const credit = useMemo(() => (fees.data ?? []).filter((f) => Number(f.balance) < 0), [fees.data])
  const owed = open.reduce((a, f) => a + Number(f.balance), 0)
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
  const [mode, setMode] = useState<'auto' | 'pick'>(feeId ? 'pick' : 'auto')
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
  const auto = mode === 'auto' && open.length > 0
  const value = amount === '' ? (auto ? owed : Number(fee?.balance ?? 0)) : Number(amount)
  const plan = auto ? allocatePayment(open, value) : null
  const restPeriod = advance[0] ?? null

  const createAdvance = async (period: string) => {
    const created = unwrap(await supabase.from('fees').insert({
      student_id: student.id, concept: 'Mensualidad', period, amount: price.regular,
      due_date: dueDateFor(period, price.dueDay), discount: price.discount, discount_reason: price.reason,
      notes: 'Pagada por adelantado',
    }).select('id').single()) as { id: string }
    return created.id
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!(value > 0)) return toast.error('El importe debe ser mayor a cero.')
    if (!auto) {
      if (!fee) return
      if (advPeriod && !(price.regular > 0)) return toast.error('Configura la mensualidad en Categorías o Configuración.')
      if (value > Number(fee.balance)) return toast.error(`El importe excede el saldo de ${money(fee.balance)}. Usa "Aplicar a lo que debe" para repartirlo.`)
    }
    if (auto && plan!.rest > 0 && (!restPeriod || plan!.rest > price.toPay)) {
      return toast.error(`Sobran ${money(plan!.rest)} después de liquidar todo. Revisa el importe.`)
    }
    setSaving(true)
    try {
      let receipt_path: string | null = null
      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        receipt_path = `${student.id}/comprobante-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from(BUCKETS.receipts).upload(receipt_path, file, { contentType: file.type })
        if (error) throw new Error('No se pudo subir el comprobante: ' + error.message)
      }
      const base = { student_id: student.id, paid_at: paidAt, method, notes: notes.trim() || null, receipt_path }
      if (auto) {
        const rows = plan!.parts.map((p) => ({ ...base, fee_id: p.fee.id, amount: p.amount }))
        if (plan!.rest > 0) rows.push({ ...base, fee_id: await createAdvance(restPeriod!), amount: plan!.rest })
        unwrap(await supabase.from('payments').insert(rows))
        await refresh(qc)
        const left = owed - value
        toast.ok(left > 0 ? `Pago registrado. Todavía debe ${money(left)}.` : plan!.rest > 0 ? `Pago registrado. Quedó al corriente y abonó ${money(plan!.rest)} a ${monthName(restPeriod!)}.` : 'Pago registrado. Quedó al corriente.')
      } else {
        const feeIdToPay = advPeriod ? await createAdvance(advPeriod) : fee!.id
        unwrap(await supabase.from('payments').insert({ ...base, fee_id: feeIdToPay, amount: value }))
        await refresh(qc)
        toast.ok(value >= Number(fee!.balance) ? `Pago registrado. ${fee!.concept} liquidada.` : `Pago parcial registrado. Resta ${money(Number(fee!.balance) - value)}.`)
      }
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
          <p className="text-sm text-muted">Alumno: <span className="font-medium text-white">{student.full_name}</span>
            {open.length > 0 ? <> · debe <b className="text-bad">{money(owed)}</b></> : <> · <span className="text-ok">está al corriente</span></>}</p>
          {credit.length > 0 && (
            <p className="rounded-xl border border-info/40 bg-info/10 p-2.5 text-xs text-info">
              Tiene saldo a favor: {credit.map((f) => `${f.concept} ${monthName(f.period)} ${money(-Number(f.balance))}`).join(' · ')}. Si fue un error (por ejemplo, el precio cambió por promo), corrígelo en su expediente.
            </p>
          )}

          {open.length > 0 && (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Cómo aplicar el pago">
              <button type="button" onClick={() => { setMode('auto'); setAmount('') }} aria-pressed={mode === 'auto'}
                className={cx('rounded-xl border p-2.5 text-left text-sm', mode === 'auto' ? 'border-brand bg-brand-dim' : 'border-ink-600')}>
                <b>Aplicar a lo que debe</b><span className="block text-xs text-muted">Primero lo más antiguo</span>
              </button>
              <button type="button" onClick={() => { setMode('pick'); setAmount('') }} aria-pressed={mode === 'pick'}
                className={cx('rounded-xl border p-2.5 text-left text-sm', mode === 'pick' ? 'border-brand bg-brand-dim' : 'border-ink-600')}>
                <b>Elegir a qué corresponde</b><span className="block text-xs text-muted">Inscripción, un mes, adelanto…</span>
              </button>
            </div>
          )}

          {!auto && (
            <Field label="Concepto a pagar">
              <Select value={current} onChange={(e) => { setSelected(e.target.value); setAmount('') }}>
                {open.length > 0 && (
                  <optgroup label="Pendientes (del más antiguo al más reciente)">
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
          )}
          {!auto && open.length > 0 && current !== open[0].id && (
            <p className="-mt-2 text-xs text-warn">Ojo: todavía debe {open[0].concept} {monthName(open[0].period)} ({money(open[0].balance)}), que es más antiguo.</p>
          )}
          {!auto && advPeriod && price.discount > 0 && (
            <p className="-mt-2 text-xs text-muted">Precio normal {money(price.regular)} − {price.reason} {money(price.discount)} = {money(price.toPay)}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Importe que pagó" hint={auto ? `Debe ${money(owed)}. Escribe lo que pagó y se reparte solo.` : `Saldo: ${money(fee?.balance)}${Number(fee?.late_fee) > 0 ? ` (incluye ${money(fee?.late_fee)} de recargo)` : ''}.`}>
              <Input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder={String(auto ? owed : fee?.balance ?? '')} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Fecha de pago"><Input type="date" value={paidAt} max={today()} onChange={(e) => setPaidAt(e.target.value)} /></Field>
          </div>

          {auto && plan && value > 0 && (
            <div className="rounded-xl bg-ink-900 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Así se aplica</p>
              {plan.parts.map((p) => (
                <p key={p.fee.id} className="flex justify-between gap-3">
                  <span>{p.fee.concept} {monthName(p.fee.period)} {p.settles ? <span className="text-ok">· queda pagada</span> : <span className="text-warn">· resta {money(Number(p.fee.balance) - p.amount)}</span>}</span>
                  <b>{money(p.amount)}</b>
                </p>
              ))}
              {plan.rest > 0 && (
                restPeriod && plan.rest <= price.toPay
                  ? <p className="flex justify-between gap-3 text-info"><span>Adelanto a Mensualidad {monthName(restPeriod)}</span><b>{money(plan.rest)}</b></p>
                  : <p className="text-bad">Sobran {money(plan.rest)}: es más de lo que debe más un mes de adelanto.</p>
              )}
            </div>
          )}

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

/** Corregir o borrar un pago ya registrado (monto, fecha, forma de pago o a qué cargo corresponde). */
export function EditPaymentModal({ payment, student, onClose }: { payment: Payment; student: StudentRow; onClose: () => void }) {
  const fees = useFees(student.id)
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ amount: String(payment.amount), paid_at: payment.paid_at.slice(0, 10), method: payment.method, fee_id: payment.fee_id, notes: payment.notes ?? '' })
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const feeName = (id: string) => { const x = fees.data?.find((y) => y.id === id); return x ? `${x.concept} ${monthName(x.period)}` : 'cargo' }

  /** Si era un adelanto y se quedó sin pagos, se quita también ese cargo. */
  const cleanupAdvance = async (feeId: string) => {
    const fee = fees.data?.find((x) => x.id === feeId)
    if (!fee || fee.notes !== 'Pagada por adelantado') return
    const left = unwrap(await supabase.from('payments').select('id').eq('fee_id', feeId)) as { id: string }[]
    if (!left.length) unwrap(await supabase.from('fees').delete().eq('id', feeId))
  }

  const save = async () => {
    const amount = Number(f.amount)
    if (!(amount > 0)) return toast.error('El monto debe ser mayor a cero.')
    setSaving(true)
    try {
      unwrap(await supabase.from('payments').update({ amount, paid_at: f.paid_at, method: f.method, fee_id: f.fee_id, notes: f.notes.trim() || null }).eq('id', payment.id))
      if (f.fee_id !== payment.fee_id) await cleanupAdvance(payment.fee_id)
      const changes = [
        amount !== Number(payment.amount) && `monto ${money(payment.amount)} → ${money(amount)}`,
        f.paid_at !== payment.paid_at.slice(0, 10) && `fecha ${date(payment.paid_at)} → ${date(f.paid_at)}`,
        f.method !== payment.method && `forma ${METHOD_LABEL[payment.method]} → ${METHOD_LABEL[f.method]}`,
        f.fee_id !== payment.fee_id && `de ${feeName(payment.fee_id)} a ${feeName(f.fee_id)}`,
      ].filter(Boolean).join(' · ')
      await notify(`Se corrigió un pago de ${student.full_name}`, changes || 'Se cambiaron las notas', `/alumnos/${student.id}?tab=pagos`, 'pago')
      await refresh(qc)
      await qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.ok('Pago corregido')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  const remove = async () => {
    setSaving(true)
    try {
      unwrap(await supabase.from('payments').delete().eq('id', payment.id))
      await cleanupAdvance(payment.fee_id)
      await notify(`Se borró un pago de ${student.full_name}`, `${money(payment.amount)} del ${date(payment.paid_at)} · ${feeName(payment.fee_id)}`, `/alumnos/${student.id}?tab=pagos`, 'pago')
      await refresh(qc)
      await qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.ok('Pago borrado')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Corregir pago · ${student.full_name}`}
      footer={<>
        <Button variant="danger" className="mr-auto" onClick={() => setConfirmDel(true)}>Borrar pago</Button>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={Save} onClick={save} loading={saving}>Guardar</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto"><Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Fecha de pago"><Input type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
        </div>
        <Field label="¿A qué corresponde?">
          <Select value={f.fee_id} onChange={(e) => setF({ ...f, fee_id: e.target.value })}>
            {(fees.data ?? []).slice().sort((a, b) => a.period.localeCompare(b.period)).map((x) => (
              <option key={x.id} value={x.id}>{x.concept} {monthName(x.period)} — {Number(x.balance) > 0 ? `debe ${money(x.balance)}` : 'pagada'}</option>
            ))}
          </Select>
        </Field>
        <Field label="Forma de pago">
          <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </Select>
        </Field>
        <Field label="Notas"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ej. Se registró por error" /></Field>
        <p className="text-xs text-muted">Los cambios quedan anotados en los avisos del Dashboard.</p>
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} loading={saving} danger title="Borrar pago" confirmLabel="Borrar"
        text={`Se borrará el pago de ${money(payment.amount)} del ${date(payment.paid_at)} (${feeName(payment.fee_id)}). Ese cargo volverá a quedar pendiente.`} />
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

/**
 * Fecha límite para un alumno: la general del mes, salvo que haya entrado después;
 * entonces tiene los mismos días que todos (del 1 al 8 = 8 días) contados desde que entró,
 * para que un alumno nuevo no nazca con recargo.
 */
export function dueDateForStudent(period: string, dueDay: number, enrolledAt: string | null | undefined) {
  const base = dueDateFor(period, dueDay)
  if (!enrolledAt || enrolledAt <= base) return base
  return toISODate(addDays(new Date(enrolledAt + 'T12:00:00'), Math.max(0, dueDay - 1)))
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
  const dueValue = due || dueDateForStudent(periodDate, settings?.due_day ?? 10, student.enrolled_at)
  const isInscription = norm(concept.trim()) === 'inscripcion'
  const [withCredential, setWithCredential] = useState(true)
  const isMonthly = norm(concept.trim()) === 'mensualidad'
  const autoTier = joinTier(student.enrolled_at, periodDate) ?? 'completo'
  const [tierPick, setTierPick] = useState<JoinTier | null>(null)
  const tier: JoinTier = isMonthly ? (tierPick ?? autoTier) : 'completo'
  const isReinscription = norm(concept.trim()) === 'reinscripcion'
  const uniformPrice = UNIFORM_CONCEPTS.find((u) => norm(u.concept) === norm(concept.trim()))?.price
  const suggestedFor = isInscription ? INSCRIPTION_FEE : isReinscription ? REINSCRIPTION_FEE : uniformPrice != null ? uniformPrice : isUniformConcept(concept) ? 0 : tierAmount(suggested, tier)
  const value = amount === '' ? suggestedFor : Number(amount)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!concept.trim()) return toast.error('Escribe el concepto.')
    if (!(value > 0)) return toast.error('Define el importe (o configura la mensualidad en Categorías / Configuración).')
    setSaving(true)
    try {
      unwrap(await supabase.from('fees').insert([
        { student_id: student.id, concept: concept.trim(), period: periodDate, amount: value, due_date: dueValue, notes: tierNote(tier) },
        ...(isInscription && withCredential ? [{ student_id: student.id, concept: CREDENTIAL_CONCEPT, period: periodDate, amount: CREDENTIAL_FEE, due_date: dueValue }] : []),
      ]))
      await refresh(qc)
      toast.ok(isInscription && withCredential ? 'Inscripción y credencial Chivas creadas' : 'Cargo creado')
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
          <datalist id="concepts">{['Mensualidad', 'Inscripción', 'Reinscripción', ...UNIFORM_CONCEPTS.map((u) => u.concept), 'Torneo', 'Arbitraje'].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        {isInscription && (
          <label className="-mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={withCredential} onChange={(e) => setWithCredential(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" />
            También cobrar <b>Credencial Chivas {money(CREDENTIAL_FEE)}</b></label>
        )}
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
      const payload = plan.toCreate.map(({ s, amount, discount, tier, reason }) => ({
        student_id: s.id, concept: 'Mensualidad', period: periodDate, amount, due_date: dueDateForStudent(periodDate, settings?.due_day ?? 10, s.enrolled_at),
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
