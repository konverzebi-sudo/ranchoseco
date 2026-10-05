import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, Paperclip } from 'lucide-react'
import { addDays, addMonths, startOfMonth, setDate } from 'date-fns'
import { Button, ConfirmDialog, Field, Input, Modal, Select, Textarea, cx } from './ui'
import { useToast } from './toast'
import { useCategories, useCoaches, useFees, useSettings, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap, BUCKETS } from '@/lib/supabase'
import { METHOD_LABEL, date, money, monthName, shortDate, toISODate, today } from '@/lib/format'
import { TIER_LABEL, joinTier, tierAmount, tierNote, type JoinTier } from '@/lib/prorate'
import { PROMO_REASON, memberPrice } from '@/lib/siblings'
import { REINSCRIPTION_FEE } from '@/lib/inactive'
import { CREDENTIAL_CONCEPT, CREDENTIAL_FEE, UNIFORM_CONCEPTS, isUniformConcept } from '@/lib/uniforms'
import type { FeeBalance, Payment, PaymentMethod } from '@/lib/types'
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

const normName = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const RECEIVER_KEY = 'rs-last-receiver'
const readReceiver = () => { try { return localStorage.getItem(RECEIVER_KEY) ?? '' } catch { return '' } }
const saveReceiver = (v: string) => { try { localStorage.setItem(RECEIVER_KEY, v) } catch { /* sin almacenamiento */ } }
type Extra = { key: string; concept: string; amount: string; on: boolean; period: string; editable?: boolean }

/**
 * Generar pago: se elige al niño, aparece lo que debe (del más antiguo al más nuevo) y se marca
 * a qué corresponde el dinero; también se pueden cobrar en el mismo pago uniforme, playera,
 * credencial, un adelanto u otro concepto. Se anota quién del equipo recibió el pago.
 */
export function PaymentModal({ student: fixed, feeId, onClose }: { student?: StudentRow; feeId?: string; onClose: () => void }) {
  const students = useStudents()
  const allFees = useFees()
  const coaches = useCoaches()
  const qc = useQueryClient()
  const toast = useToast()
  const [sid, setSid] = useState(fixed?.id ?? '')
  const [search, setSearch] = useState('')
  const student = fixed ?? (students.data ?? []).find((s) => s.id === sid)
  const price = useMonthlyPrice((student ?? { id: '', category_id: null, sibling_group_id: null, sibling_order: null, monthly_fee: null }) as StudentRow)
  const fees = useMemo(() => (allFees.data ?? []).filter((f) => f.student_id === student?.id), [allFees.data, student?.id])
  const open = useMemo(() => fees.filter((f) => Number(f.balance) > 0).sort(payOrder), [fees])
  const credit = fees.filter((f) => Number(f.balance) < 0)
  const owed = open.reduce((a, f) => a + Number(f.balance), 0)
  const nextMonth = useMemo(() => {
    const taken = new Set(fees.filter((f) => f.concept === 'Mensualidad').map((f) => f.period.slice(0, 10)))
    for (let i = 0; i < 12; i++) { const p = toISODate(startOfMonth(addMonths(new Date(), i))); if (!taken.has(p)) return p }
    return null
  }, [fees])
  const thisPeriod = toISODate(startOfMonth(new Date()))

  // Lo que debe: casilla + cuánto se abona a cada cargo
  const [sel, setSel] = useState<Record<string, { on: boolean; amount: string }>>(feeId ? { [feeId]: { on: true, amount: '' } } : {})
  const [extras, setExtras] = useState<Extra[]>([])
  useEffect(() => {
    // Al elegir al niño se preparan los conceptos extra con su precio
    setExtras([
      ...UNIFORM_CONCEPTS.map((u) => ({ key: u.concept, concept: u.concept, amount: u.price != null ? String(u.price) : '', on: false, period: thisPeriod })),
      ...(nextMonth ? [{ key: 'adv', concept: `Mensualidad ${monthName(nextMonth)} (adelanto)`, amount: String(price.toPay), on: false, period: nextMonth }] : []),
      { key: 'otro', concept: '', amount: '', on: false, period: thisPeriod, editable: true },
    ])
    if (!feeId) setSel({})
  }, [student?.id, nextMonth, price.toPay]) // eslint-disable-line react-hooks/exhaustive-deps
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [paidAt, setPaidAt] = useState(today())
  const [receiver, setReceiver] = useState(readReceiver)
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const amountOf = (f: FeeBalance) => { const r = sel[f.id]; return r?.on ? (r.amount === '' ? Number(f.balance) : Number(r.amount) || 0) : 0 }
  const debtTotal = open.reduce((a, f) => a + amountOf(f), 0)
  const extraTotal = extras.filter((x) => x.on).reduce((a, x) => a + (Number(x.amount) || 0), 0)
  const total = Math.round((debtTotal + extraTotal) * 100) / 100
  const paidN = paid === '' ? null : Number(paid)

  /** Al escribir cuánto pagó se marca solo lo que debe, del más antiguo al más nuevo. */
  const distribute = (v: string) => {
    setPaid(v)
    const n = Number(v)
    if (!(n > 0)) return
    const plan = allocatePayment(open, n)
    setSel(Object.fromEntries(open.map((f) => {
      const p = plan.parts.find((x) => x.fee.id === f.id)
      return [f.id, { on: !!p, amount: p ? String(p.amount) : '' }]
    })))
  }

  const receivers = useMemo(() => [...new Set([...(coaches.data ?? []).filter((c) => c.active).map((c) => c.full_name), receiver].filter(Boolean))], [coaches.data, receiver])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!student) return toast.error('Escoge al niño.')
    if (!(total > 0)) return toast.error('Marca a qué corresponde el pago.')
    for (const f of open) if (sel[f.id]?.on && amountOf(f) > Number(f.balance) + 0.001) return toast.error(`A ${f.concept} ${monthName(f.period)} le abonas más de lo que debe (${money(f.balance)}).`)
    if (extras.some((x) => x.on && (!(Number(x.amount) > 0) || !x.concept.trim()))) return toast.error('Escribe el concepto y el monto de lo que agregaste.')
    if (!receiver.trim()) return toast.error('Escribe quién recibió el pago.')
    if (paidN != null && Math.abs(paidN - total) > 0.5 && !window.confirm(`Pagó ${money(paidN)} pero marcaste ${money(total)}. ¿Registrar ${money(total)}?`)) return
    setSaving(true)
    try {
      let receipt_path: string | null = null
      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        receipt_path = `${student.id}/comprobante-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from(BUCKETS.receipts).upload(receipt_path, file, { contentType: file.type })
        if (error) throw new Error('No se pudo subir el comprobante: ' + error.message)
      }
      const base = { student_id: student.id, paid_at: paidAt, method, notes: notes.trim() || null, receipt_path, received_by: receiver.trim() }
      const rows: Record<string, unknown>[] = open.filter((f) => sel[f.id]?.on && amountOf(f) > 0).map((f) => ({ ...base, fee_id: f.id, amount: amountOf(f) }))
      for (const x of extras.filter((y) => y.on)) {
        const isAdv = x.key === 'adv'
        const created = unwrap(await supabase.from('fees').insert(isAdv
          ? { student_id: student.id, concept: 'Mensualidad', period: x.period, amount: price.regular, discount: price.discount, discount_reason: price.reason, due_date: dueDateFor(x.period, price.dueDay), notes: 'Pagada por adelantado' }
          : { student_id: student.id, concept: x.concept.trim(), period: x.period, amount: Number(x.amount), due_date: paidAt }).select('id').single()) as { id: string }
        rows.push({ ...base, fee_id: created.id, amount: Number(x.amount) })
      }
      // Si la base de datos todavía no tiene la columna "quién recibió", se guarda en las notas
      const first = await supabase.from('payments').insert(rows)
      if (first.error && /received_by/.test(first.error.message)) {
        unwrap(await supabase.from('payments').insert(rows.map(({ received_by, ...r }) => ({ ...r, notes: [r.notes, `Recibió: ${received_by}`].filter(Boolean).join(' · ') }))))
      } else unwrap(first)
      saveReceiver(receiver.trim())
      await refresh(qc)
      const left = owed - debtTotal
      toast.ok(`Pago de ${money(total)} registrado${left > 0.5 ? `. Todavía debe ${money(left)}` : open.length ? '. Quedó al corriente' : ''}.`)
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  const list = (students.data ?? []).filter((s) => s.status !== 'baja' && (!search || normName(s.full_name).includes(normName(search)))).slice(0, 8)

  return (
    <Modal open onClose={onClose} title="Generar pago" wide
      footer={student ? <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="pay-form" icon={Save} loading={saving} disabled={!(total > 0)}>Registrar {money(total)}</Button></> : undefined}>
      <form id="pay-form" onSubmit={submit} className="space-y-4">
        {/* 1. Niño */}
        {!fixed && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">1. ¿De qué niño?</p>
            {student ? (
              <div className="flex items-center justify-between rounded-xl border border-brand bg-brand-dim px-3 py-2">
                <b>{student.full_name}</b>
                <button type="button" className="text-sm text-brand hover:underline" onClick={() => { setSid(''); setSearch(''); setPaid('') }}>Cambiar</button>
              </div>
            ) : (
              <>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Escribe el nombre del niño" autoFocus />
                {search && (
                  <ul className="mt-1 divide-y divide-ink-700 rounded-xl border border-ink-600">
                    {list.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No se encontró.</li> : list.map((s) => (
                      <li key={s.id}><button type="button" onClick={() => setSid(s.id)} className="w-full px-3 py-2 text-left text-sm hover:bg-ink-700">{s.full_name}</button></li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {student && (
          <>
            {/* 2. Lo que debe */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">2. Lo que debe (del más antiguo al más nuevo)</p>
                <span className="text-sm">Debe <b className={owed > 0 ? 'text-bad' : 'text-ok'}>{money(owed)}</b></span>
              </div>
              {credit.length > 0 && <p className="mb-2 rounded-xl border border-info/40 bg-info/10 p-2 text-xs text-info">Saldo a favor: {credit.map((f) => `${f.concept} ${monthName(f.period)} ${money(-Number(f.balance))}`).join(' · ')}</p>}
              {open.length === 0 ? <p className="rounded-xl border border-ink-600 px-3 py-2 text-sm text-ok">Está al corriente.</p> : (
                <>
                  <Field label="¿Cuánto pagó?" hint="Al escribirlo se marca solo lo que debe, empezando por lo más antiguo. Puedes cambiarlo abajo.">
                    <Input type="number" min="0" inputMode="decimal" value={paid} onChange={(e) => distribute(e.target.value)} placeholder={String(owed)} />
                  </Field>
                  <ul className="mt-2 divide-y divide-ink-700 rounded-xl border border-ink-600">
                    {open.map((f) => {
                      const r = sel[f.id]
                      return (
                        <li key={f.id} className={cx('flex flex-wrap items-center gap-3 px-3 py-2 text-sm', r?.on && 'bg-brand-dim')}>
                          <input type="checkbox" checked={!!r?.on} onChange={(e) => setSel({ ...sel, [f.id]: { on: e.target.checked, amount: r?.amount ?? '' } })} className="h-5 w-5 accent-[#F2E30A]" aria-label={`${f.concept} ${monthName(f.period)}`} />
                          <span className="min-w-0 flex-1">
                            <b>{f.concept} {monthName(f.period)}</b>
                            <span className="block text-xs text-muted">Debe {money(f.balance)}{Number(f.late_fee) > 0 ? ` (incluye ${money(f.late_fee)} de recargo)` : ''} · vence {shortDate(f.due_date)}</span>
                          </span>
                          {r?.on && (
                            <Input type="number" min="0" inputMode="decimal" value={r.amount} placeholder={String(f.balance)} aria-label="Cuánto se abona"
                              onChange={(e) => setSel({ ...sel, [f.id]: { on: true, amount: e.target.value } })} className="h-9 w-28" />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {paidN != null && paidN > owed + 0.5 && <p className="mt-1 text-xs text-info">Sobran {money(paidN - owed)}: márcalo abajo (adelanto, uniforme…).</p>}
                </>
              )}
            </div>

            {/* 3. Otros conceptos */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">3. ¿Paga algo más? (uniforme, playera, credencial, adelanto…)</p>
              <ul className="divide-y divide-ink-700 rounded-xl border border-ink-600">
                {extras.map((x, k) => (
                  <li key={x.key} className={cx('flex flex-wrap items-center gap-3 px-3 py-2 text-sm', x.on && 'bg-brand-dim')}>
                    <input type="checkbox" checked={x.on} onChange={(e) => setExtras(extras.map((y, j) => (j === k ? { ...y, on: e.target.checked } : y)))} className="h-5 w-5 accent-[#F2E30A]" aria-label={x.concept || 'Otro concepto'} />
                    {x.editable
                      ? <Input value={x.concept} onChange={(e) => setExtras(extras.map((y, j) => (j === k ? { ...y, concept: e.target.value, on: true } : y)))} placeholder="Otro concepto (torneo, arbitraje…)" className="h-9 min-w-0 flex-1" />
                      : <span className="min-w-0 flex-1 font-medium">{x.concept}</span>}
                    <Input type="number" min="0" inputMode="decimal" value={x.amount} placeholder="Monto" aria-label="Monto"
                      onChange={(e) => setExtras(extras.map((y, j) => (j === k ? { ...y, amount: e.target.value, on: e.target.value !== '' || y.on } : y)))} className="h-9 w-28" />
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3">
              <span className="font-display text-lg font-bold uppercase">Total del pago</span>
              <span className="font-display text-2xl font-bold text-ok">{money(total)}</span>
            </div>

            {/* 4. Datos del pago */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fecha de pago"><Input type="date" value={paidAt} max={today()} onChange={(e) => setPaidAt(e.target.value)} /></Field>
              <Field label="¿Quién recibió el pago? (equipo Rancho Seco) *">
                <Input value={receiver} onChange={(e) => setReceiver(e.target.value)} list="receivers" placeholder="Nombre" />
                <datalist id="receivers">{receivers.map((r) => <option key={r} value={r} />)}</datalist>
              </Field>
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
          </>
        )}
      </form>
    </Modal>
  )
}

/** Corregir o borrar un pago ya registrado (monto, fecha, forma de pago o a qué cargo corresponde). */
export function EditPaymentModal({ payment, student, onClose }: { payment: Payment; student: StudentRow; onClose: () => void }) {
  const fees = useFees(student.id)
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ amount: String(payment.amount), paid_at: payment.paid_at.slice(0, 10), method: payment.method, fee_id: payment.fee_id, notes: payment.notes ?? '', received_by: payment.received_by ?? '' })
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
      const upd = { amount, paid_at: f.paid_at, method: f.method, fee_id: f.fee_id, notes: f.notes.trim() || null }
      const r1 = await supabase.from('payments').update({ ...upd, received_by: f.received_by.trim() || null }).eq('id', payment.id)
      if (r1.error && /received_by/.test(r1.error.message)) unwrap(await supabase.from('payments').update(upd).eq('id', payment.id))
      else unwrap(r1)
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
        <Field label="¿Quién recibió el pago?"><Input value={f.received_by} onChange={(e) => setF({ ...f, received_by: e.target.value })} placeholder="Nombre" /></Field>
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
