import { useMemo, useState, type FormEvent } from 'react'
import { addMonths } from 'date-fns'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Receipt, Trash2, Users, Wallet, UserCog, Calculator, Pencil, CalendarDays } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, IconButton, Input, Modal, PageHeader, Select, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import CategoryResults from '@/components/CategoryResults'
import CoachCategoryPicker from '@/components/CoachCategoryPicker'
import CoachModal from '@/components/CoachModal'
import FinanceModules from '@/components/FinanceModules'
import { InstallmentsEditor, PayInstallmentModal } from '@/components/Installments'
import LoansSection from '@/components/Loans'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useExpenses, useExtraClasses, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, shortDate, toISODate, today } from '@/lib/format'
import { EXPENSE_FREQUENCY, FREQUENCY_LABEL, expenseForMonth, installmentDate, installmentLabel, installmentPlan, installmentsOf, monthlyCost, pendingInstallments, isLoan } from '@/lib/finance'
import type { Coach, Expense, ExpenseInstallment } from '@/lib/types'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const cents = (n: number) => money(Math.round(n * 100) / 100)
const thisYear = Number(today().slice(0, 4))
const FIXED: Expense['frequency'][] = ['semanal', 'quincenal', 'mensual', 'anual']

/** Fecha en que cae un gasto del mes: su día exacto o el día 1 del mes. */
const entryDate = (e: Expense, month: string) => (e.paid_on && e.paid_on.startsWith(month) ? e.paid_on : e.paid_on ? `${month}-${e.paid_on.slice(8, 10)}` : `${month}-01`)

export default function Expenses() {
  const nav = useNavigate()
  const expenses = useExpenses()
  const students = useStudents()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const cc = useCoachCategories()
  const extras = useExtraClasses()
  const categories = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [modal, setModal] = useState<{ mode: 'fijo' | 'mes'; expense?: Expense } | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [viewMonth, setViewMonth] = useState(today().slice(0, 7))
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null)
  const [editingCoach, setEditingCoach] = useState<Coach | null>(null)
  const [paying, setPaying] = useState<{ expense: Expense; inst: ExpenseInstallment } | null>(null)
  const month = today().slice(0, 7)

  const active = useMemo(() => (students.data ?? []).filter((s) => s.status === 'activo'), [students.data])
  const activeCount = active.length
  const list = expenses.data ?? []
  const generalMonthly = list.reduce((a, e) => a + expenseForMonth(e, month), 0)
  const fixedList = list.filter((e) => FIXED.includes(e.frequency))
  const fixedMonthly = fixedList.reduce((a, e) => a + expenseForMonth(e, month), 0)
  // Gastos del mes: los de una sola vez y los pagos en partes que caen en el mes elegido
  // (los gastos en partes aparecen una fila por cada pago que cae en el mes, pagado o pendiente)
  const monthRows = list.filter((e) => !FIXED.includes(e.frequency) && e.active && !isLoan(e)).flatMap((e) => {
    const rows = installmentsOf(e)
    if (rows) return rows.filter((i) => installmentDate(i).startsWith(viewMonth))
      .map((i) => ({ key: i.id, e, date: installmentDate(i), amount: Number(i.amount), label: installmentLabel(i, rows), inst: i as ExpenseInstallment | undefined }))
    const amount = expenseForMonth(e, viewMonth)
    return amount > 0 ? [{ key: e.id, e, date: entryDate(e, viewMonth), amount, label: e.frequency === 'partes' ? 'En partes' : 'Una sola vez', inst: undefined }] : []
  }).sort((a, b) => a.date.localeCompare(b.date))
  const monthTotal = monthRows.reduce((a, r) => a + r.amount, 0)
  const monthPending = monthRows.filter((r) => r.inst && !r.inst.paid_on).reduce((a, r) => a + r.amount, 0)
  const coachRows = (coaches.data ?? []).filter((c) => c.active).map((c) => {
    const p = pay.data?.find((x) => x.coach_id === c.id)
    const cats = (cc.data ?? []).filter((x) => x.coach_id === c.id).map((x) => categories.data?.find((k) => k.id === x.category_id)).filter(Boolean)
    // Alumnos a su cargo: los de sus categorías y los inscritos en sus clases extra (p. ej. Porteros)
    const extraMembers = new Set((extras.data ?? []).filter((x) => cats.some((k) => k!.is_extra && k!.id === x.category_id)).map((x) => x.student_id))
    const catStudents = active.filter((s) => cats.some((k) => !k!.is_extra && k!.id === s.category_id) || extraMembers.has(s.id)).length
    return { c, p, cats, catStudents, monthly: monthlyCost(p) }
  }).filter((r) => r.p)
  const salariesMonthly = coachRows.reduce((a, r) => a + r.monthly, 0)

  const remove = async () => {
    if (!deleting) return
    try {
      unwrap(await supabase.from('expenses').delete().eq('id', deleting.id))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok('Gasto eliminado')
      setDeleting(null)
    } catch (e) { toast.error(e) }
  }

  const rowActions = (e: Expense, mode: 'fijo' | 'mes') => (
    <div className="flex justify-end gap-1">
      <IconButton icon={Pencil} label={`Editar ${e.name}`} onClick={() => setModal({ mode, expense: e })} className="h-8 w-8" />
      <IconButton icon={Trash2} label={`Eliminar ${e.name}`} onClick={() => setDeleting(e)} className="h-8 w-8" />
    </div>
  )

  if (expenses.error) return <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />

  return (
    <>
      <PageHeader title="Gastos" subtitle="Captura los gastos a mano. El sistema calcula cuánto le corresponde a cada alumno."
        actions={<>
          <Button variant="secondary" icon={CalendarDays} onClick={() => nav(`/gastos/desglose?mes=${month}`)}>Día a día</Button>
          <Button variant="secondary" icon={Plus} onClick={() => setModal({ mode: 'mes' })}>Gasto del mes</Button>
          <Button icon={Plus} onClick={() => setModal({ mode: 'fijo' })}>Gasto fijo</Button>
        </>} />

      <div className="mb-3"><FinanceModules /></div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Alumnos activos" value={activeCount} icon={Users} hint="Base para repartir los gastos" />
        <StatCard label="Gastos generales al mes" value={money(Math.round(generalMonthly))} icon={Receipt} hint="Promedio: semanal × 4.33 · anual ÷ 12" />
        <StatCard label="Gasto por alumno al mes" value={activeCount ? cents(generalMonthly / activeCount) : '—'} icon={Calculator} tone="brand" />
        <StatCard label="Sueldos de profesores al mes" value={money(Math.round(salariesMonthly))} icon={UserCog} hint={`${coachRows.length} profesores con sueldo`} />
      </div>

      <div className="mb-8"><CategoryResults /></div>

      {/* ---------- Gastos del mes ---------- */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Gastos del mes</h2>
          <p className="text-sm text-muted">Gastos de una sola vez y pagos en partes que caen en el mes. Toca uno para editarlo.</p>
        </div>
        <div className="flex gap-2">
          <Input type="month" value={viewMonth} onChange={(e) => setViewMonth(e.target.value || today().slice(0, 7))} className="h-9 w-40" aria-label="Mes" />
          <Button size="sm" icon={Plus} onClick={() => setModal({ mode: 'mes' })}>Agregar</Button>
        </div>
      </div>
      {expenses.isLoading ? <Spinner /> : (
        <Card className="mb-8 overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Monto</th><th>Por alumno</th><th /></tr></thead>
            <tbody>
              {monthRows.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-sm text-muted">Sin gastos extra en {MONTHS[Number(viewMonth.slice(5, 7)) - 1].toLowerCase()}. Agrega arbitrajes, balones, transporte, reparaciones…</td></tr>
              ) : monthRows.map(({ key, e, date: d, amount, label, inst }) => (
                  <tr key={key}>
                    <td className="whitespace-nowrap">{shortDate(d)}</td>
                    <td><button onClick={() => setModal({ mode: 'mes', expense: e })} className="text-left font-medium hover:text-brand">{e.name}</button>
                      {e.notes && <p className="text-xs text-muted">{e.notes}</p>}</td>
                    <td>{inst ? <Badge tone="brand">{label}</Badge> : <span className="text-sm text-muted">{label}</span>}
                      {inst && <p className="text-xs text-muted">Total {money(e.amount)}</p>}</td>
                    <td className="font-semibold">{cents(amount)}</td>
                    <td>{activeCount ? cents(amount / activeCount) : '—'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {inst && (inst.paid_on
                          ? <button onClick={() => setPaying({ expense: e, inst })} title="Ver pago"><Badge tone="ok" className="cursor-pointer">Pagado</Badge></button>
                          : <Button size="sm" onClick={() => setPaying({ expense: e, inst })}>{inst.due_date < today() ? 'Atrasado · pagar' : 'Pagar'}</Button>)}
                        {rowActions(e, 'mes')}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-900">
                <td colSpan={3} className="font-display text-lg font-bold uppercase">Total gastos del mes · {MONTHS[Number(viewMonth.slice(5, 7)) - 1]}</td>
                <td className="font-display text-lg font-bold text-bad">{money(Math.round(monthTotal))}{monthPending > 0 && <span className="block font-sans text-xs font-normal text-warn">{cents(monthPending)} pendiente de pagar</span>}</td>
                <td className="font-semibold text-brand">{activeCount ? cents(monthTotal / activeCount) : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      <LoansSection />

      {/* ---------- Gastos generales fijos ---------- */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Gastos generales fijos</h2>
          <p className="text-sm text-muted">Se repiten cada semana, quincena, mes o año. Toca uno para editarlo.</p>
        </div>
        <Button size="sm" icon={Plus} onClick={() => setModal({ mode: 'fijo' })}>Agregar gasto fijo</Button>
      </div>
      {expenses.isLoading || students.isLoading ? <Spinner /> : !fixedList.length ? (
        <Card className="mb-8"><Empty icon={Receipt} title="Aún no hay gastos fijos" text="Agrega regalías, renta, seguro, sueldos generales…" action={<Button icon={Plus} onClick={() => setModal({ mode: 'fijo' })}>Agregar gasto fijo</Button>} /></Card>
      ) : (
        <Card className="mb-8 overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Concepto</th><th>Monto</th><th>Al mes</th><th>Por alumno</th><th /></tr></thead>
            <tbody>
              {fixedList.map((e) => {
                const monthly = expenseForMonth(e, month)
                return (
                  <tr key={e.id} className={cx(!e.active && 'opacity-50')}>
                    <td><button onClick={() => setModal({ mode: 'fijo', expense: e })} className="text-left font-medium hover:text-brand">{e.name}</button>
                      {e.notes && <p className="text-xs text-muted">{e.notes}</p>}</td>
                    <td>{money(e.amount)} <span className="text-xs text-muted">{EXPENSE_FREQUENCY[e.frequency].per}{e.frequency === 'anual' && e.paid_month ? ` · se paga en ${MONTHS[e.paid_month - 1].toLowerCase()}` : ''}</span></td>
                    <td>{money(Math.round(monthly))}</td>
                    <td>{activeCount ? <>{cents(Number(e.amount) / activeCount)} <span className="text-xs text-muted">{EXPENSE_FREQUENCY[e.frequency].per}</span></> : '—'}</td>
                    <td>{rowActions(e, 'fijo')}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-ink-900">
                <td className="font-display text-lg font-bold uppercase">Total gastos fijos</td>
                <td className="text-sm text-muted">{fixedList.filter((e) => e.active).length} gastos</td>
                <td className="font-display text-lg font-bold text-bad">{money(Math.round(fixedMonthly))}</td>
                <td className="font-semibold text-brand">{activeCount ? <>{cents(fixedMonthly / activeCount)} <span className="text-xs font-normal text-muted">al mes</span></> : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      <h2 className="mb-1 font-display text-xl font-bold uppercase tracking-wide">Profesores por categoría</h2>
      <p className="mb-3 text-sm text-muted">Toca el nombre o el sueldo para abrir la ficha del profesor y su historial de sueldo.</p>
      {coachRows.length === 0 ? (
        <Card className="mb-8 p-5 text-sm text-muted">Registra el sueldo de cada profesor en <Link to="/profesores" className="text-brand hover:underline">Profesores</Link>.</Card>
      ) : (
        <Card className="mb-8 overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Profesor</th><th>Categorías</th><th>Sueldo</th><th>Al mes</th><th>Por alumno de su categoría</th></tr></thead>
            <tbody>
              {coachRows.map(({ c, p, cats, catStudents, monthly }) => (
                <tr key={c.id}>
                  <td><button onClick={() => setEditingCoach(c)} className="text-left font-medium hover:text-brand">{c.full_name}</button></td>
                  <td>
                    <button onClick={() => setPicking({ id: c.id, name: c.full_name })} className="group flex flex-wrap items-center gap-1 text-left" aria-label={`Categorías de ${c.full_name}`}>
                      {cats.length
                        ? <>{cats.map((k) => <Badge key={k!.id} tone="brand">{k!.name}</Badge>)}<span className="ml-1 text-xs text-muted group-hover:text-brand">Cambiar</span></>
                        : <span className="text-xs text-warn group-hover:underline">Asignar categoría</span>}
                    </button>
                  </td>
                  <td>
                    <button onClick={() => setEditingCoach(c)} className="group text-left" title="Ver ficha e historial de sueldo">
                      <span className="underline decoration-dotted group-hover:text-brand">{money(p!.amount)}</span> <span className="text-xs text-muted">{FREQUENCY_LABEL[p!.frequency]}</span>
                    </button>
                  </td>
                  <td>{money(Math.round(monthly))}</td>
                  <td>{catStudents ? <>{cents(Number(p!.amount) / catStudents)} <span className="text-xs text-muted">{FREQUENCY_LABEL[p!.frequency]}</span></> : <span className="text-xs text-muted">Se reparte entre todos</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(() => {
                const freqs = new Set(coachRows.map((r) => r.p!.frequency))
                const sameFreq = freqs.size === 1 ? [...freqs][0] : null
                const totalAmount = coachRows.reduce((a, r) => a + Number(r.p!.amount), 0)
                return (
                  <tr className="bg-ink-900">
                    <td className="font-display text-lg font-bold uppercase">Total sueldos</td>
                    <td className="text-sm text-muted">{coachRows.length} profesores</td>
                    <td className="font-semibold">{sameFreq ? <>{money(totalAmount)} <span className="text-xs font-normal text-muted">{FREQUENCY_LABEL[sameFreq]}</span></> : <span className="text-muted">—</span>}</td>
                    <td className="font-display text-lg font-bold text-bad">{money(Math.round(salariesMonthly))}</td>
                    <td>{activeCount ? <>{cents(salariesMonthly / activeCount)} <span className="text-xs text-muted">al mes por alumno (entre todos)</span></> : '—'}</td>
                  </tr>
                )
              })()}
            </tfoot>
          </table>
        </Card>
      )}

      {picking && <CoachCategoryPicker coachId={picking.id} coachName={picking.name} onClose={() => setPicking(null)} />}
      {editingCoach && <CoachModal coach={editingCoach} onClose={() => setEditingCoach(null)} />}
      {modal && <ExpenseModal mode={modal.mode} expense={modal.expense} defaultMonth={viewMonth} onClose={() => setModal(null)} nextOrder={list.length + 1}
        onPayInstallment={(expense, inst) => setPaying({ expense, inst })} />}
      {paying && <PayInstallmentModal expense={paying.expense} inst={paying.inst} onClose={() => setPaying(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Eliminar gasto" confirmLabel="Eliminar"
        text={<>Se eliminará <b className="text-white">{deleting?.name}</b> y dejará de restarse en los reportes. Si sólo quieres pausarlo, edítalo y desmarca "Gasto activo".</>} />
    </>
  )
}

function ExpenseModal({ mode, expense, defaultMonth, onClose, nextOrder, onPayInstallment }: {
  mode: 'fijo' | 'mes'; expense?: Expense; defaultMonth: string; onClose: () => void; nextOrder: number
  onPayInstallment: (expense: Expense, inst: ExpenseInstallment) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const allExpenses = useExpenses().data ?? []
  const live = allExpenses.find((x) => x.id === expense?.id) ?? expense
  const liveRows = live ? installmentsOf(live) : null
  const pending = mode === 'mes' && !expense ? pendingInstallments(allExpenses, '9999-12-31') : []
  const initDate = expense?.paid_on
    ?? (expense?.paid_month ? `${expense.paid_year ?? thisYear}-${String(expense.paid_month).padStart(2, '0')}-01` : defaultMonth === today().slice(0, 7) ? today() : `${defaultMonth}-01`)
  const [f, setF] = useState({
    name: expense?.name ?? '', amount: expense ? String(expense.amount) : '',
    frequency: expense?.frequency ?? ((mode === 'mes' ? 'unico' : 'mensual') as Expense['frequency']),
    paid_month: expense?.paid_month ?? Number(today().slice(5, 7)), day: initDate,
    down: expense?.down_payment != null ? String(expense.down_payment) : '', installments: String(expense?.installments ?? 2),
    notes: expense?.notes ?? '', active: expense?.active ?? true,
  })
  // Calendario editable de un gasto nuevo en partes: fecha y monto de cada pago
  const [edits, setEdits] = useState<Record<number, { date?: string; amount?: string }>>({})
  const [firstPaid, setFirstPaid] = useState(true)
  const isPlan = f.frequency === 'partes'
  const isOnce = f.frequency === 'unico'
  const hasRows = isPlan && !!liveRows
  const dYear = Number(f.day.slice(0, 4)) || thisYear
  const dMonth = Number(f.day.slice(5, 7)) || 1
  const plan = installmentPlan({ amount: Number(f.amount) || 0, down_payment: Number(f.down) || 0, installments: Math.round(Number(f.installments)) || 1, paid_month: dMonth, paid_year: dYear })
  const schedule = plan.schedule.map((p, idx) => {
    const n = p.kind === 'anticipo' ? 0 : p.n
    const auto = f.day ? toISODate(addMonths(new Date(f.day + 'T12:00:00'), idx)) : ''
    const e = edits[n] ?? {}
    return { n, label: p.kind === 'anticipo' ? 'Anticipo' : `Pago ${p.n} de ${plan.n}`, date: e.date ?? auto, amount: e.amount ?? String(Math.round(p.amount * 100) / 100) }
  })
  const [saving, setSaving] = useState(false)

  const pickPending = (name: string) => {
    const hit = pending.find((p) => `${p.expense.name} — ${p.label} pendiente` === name)
    if (hit) { onClose(); onPayInstallment(hit.expense, hit.inst) }
    else setF({ ...f, name })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast.error('Escribe el nombre del gasto.')
    if (!hasRows && (!(Number(f.amount) >= 0) || f.amount === '')) return toast.error('Escribe el monto.')
    if ((isOnce || isPlan) && !hasRows && !f.day) return toast.error('Escribe la fecha.')
    if (isPlan && !hasRows) {
      if (!(Number(f.down || 0) >= 0) || Number(f.down || 0) > Number(f.amount)) return toast.error('El anticipo no puede ser mayor que el total.')
      const n = Math.round(Number(f.installments))
      if (!(n >= 1 && n <= 60)) return toast.error('Los pagos deben ser entre 1 y 60.')
      if (schedule.some((s) => !s.date || !(Number(s.amount) >= 0))) return toast.error('Revisa la fecha y el monto de cada pago.')
    }
    setSaving(true)
    const payload = hasRows
      ? { name: f.name.trim(), amount: liveRows!.reduce((a, i) => a + Number(i.amount), 0), notes: f.notes.trim() || null, active: f.active }
      : {
          name: f.name.trim(), amount: Number(f.amount), frequency: f.frequency,
          paid_month: isOnce || isPlan ? dMonth : f.frequency === 'anual' ? f.paid_month : null,
          paid_year: isOnce || isPlan ? dYear : null,
          paid_on: isOnce || isPlan ? f.day : null,
          down_payment: isPlan ? Number(f.down) || 0 : null,
          installments: isPlan ? Math.round(Number(f.installments)) : null,
          notes: f.notes.trim() || null, active: f.active,
        }
    try {
      let id = expense?.id
      if (expense) unwrap(await supabase.from('expenses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', expense.id))
      else id = (unwrap(await supabase.from('expenses').insert({ ...payload, sort_order: nextOrder }).select('id').single()) as { id: string }).id
      if (isPlan && !hasRows) {
        unwrap(await supabase.from('expense_installments').insert(schedule.map((s, idx) => ({
          expense_id: id, n: s.n, due_date: s.date, amount: Number(s.amount), paid_on: idx === 0 && firstPaid ? s.date : null,
        }))))
      }
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok(expense ? 'Gasto actualizado' : isPlan ? `Gasto agregado con ${schedule.length} pagos en el calendario` : 'Gasto agregado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }
  const allowed: Expense['frequency'][] = mode === 'mes' ? ['unico', 'partes'] : FIXED
  return (
    <Modal open onClose={onClose} title={expense ? `Editar ${expense.name}` : mode === 'mes' ? 'Agregar gasto del mes' : 'Agregar gasto fijo'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="expense-form" icon={Wallet} loading={saving}>{expense ? 'Guardar' : 'Agregar'}</Button></>}>
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        {pending.length > 0 && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3">
            <p className="mb-2 text-sm font-semibold text-warn">¿Es el pago de una parte pendiente? Tócala para marcarla como pagada:</p>
            <div className="flex flex-wrap gap-2">
              {pending.map((p) => (
                <button type="button" key={p.inst.id} onClick={() => { onClose(); onPayInstallment(p.expense, p.inst) }}
                  className="rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-left text-sm hover:border-brand">
                  <b>{isLoan(p.expense) ? `Préstamo · ${p.expense.lender ?? p.expense.name}` : p.expense.name}</b> · {p.label} · {cents(Number(p.inst.amount))}
                  <span className={cx('block text-xs', p.inst.due_date < today() ? 'text-bad' : 'text-muted')}>{p.inst.due_date < today() ? 'Atrasado · ' : ''}toca el {shortDate(p.inst.due_date)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Concepto"><Input value={f.name} onChange={(e) => pickPending(e.target.value)} placeholder="Ej. Luz, arbitrajes, balones…" autoFocus={!expense} list="expense-names" /></Field>
        <datalist id="expense-names">
          {pending.map((p) => <option key={p.inst.id} value={`${p.expense.name} — ${p.label} pendiente`} />)}
          {['Renta de canchas', 'Regalías', 'Seguro', 'Luz', 'Agua', 'Arbitrajes', 'Balones y material', 'Uniformes', 'Transporte'].map((n) => <option key={n} value={n} />)}
        </datalist>
        {!hasRows && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isPlan ? 'Total del gasto' : 'Monto'}><Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="¿Cada cuándo se paga?">
              <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Expense['frequency'] })}>
                {[...new Set([...allowed, ...(expense ? [expense.frequency] : [])])].map((k) => <option key={k} value={k}>{EXPENSE_FREQUENCY[k].label}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {f.frequency === 'anual' && (
          <Field label="Mes en que se paga">
            <Select value={f.paid_month} onChange={(e) => setF({ ...f, paid_month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        )}
        {isOnce && <Field label="Fecha del gasto" hint="Para el desglose día a día"><Input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>}
        {hasRows && live && <InstallmentsEditor expense={live} />}
        {isPlan && !hasRows && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Anticipo" hint="0 si no hubo"><Input type="number" min="0" inputMode="decimal" value={f.down} onChange={(e) => { setF({ ...f, down: e.target.value }); setEdits({}) }} placeholder="0" /></Field>
              <Field label="¿En cuántos pagos el resto?"><Input type="number" min="1" max="60" inputMode="numeric" value={f.installments} onChange={(e) => { setF({ ...f, installments: e.target.value }); setEdits({}) }} /></Field>
              <Field label={plan.down > 0 ? 'Fecha del anticipo' : 'Fecha del primer pago'}>
                <Input type="date" value={f.day} onChange={(e) => { setF({ ...f, day: e.target.value }); setEdits({}) }} />
              </Field>
            </div>
            {Number(f.amount) > 0 && (
              <div className="space-y-2 rounded-xl border border-brand/30 bg-brand-dim p-3 text-sm">
                <p>Total <b>{money(plan.total)}</b> · Anticipo <b>{money(plan.down)}</b> · Restante <b className="text-brand">{money(plan.remaining)}</b></p>
                <p className="text-xs text-muted">Puedes cambiar la fecha y el monto de cada pago. Los pendientes aparecen en el calendario y en el Dashboard la semana que toquen.</p>
                {schedule.map((s, idx) => (
                  <div key={s.n} className="grid grid-cols-[92px_1fr_110px] items-center gap-2 sm:grid-cols-[92px_1fr_110px_auto]">
                    <span className="font-medium">{s.label}</span>
                    <Input type="date" value={s.date} onChange={(e) => setEdits({ ...edits, [s.n]: { ...edits[s.n], date: e.target.value } })} className="h-9" aria-label={`Fecha ${s.label}`} />
                    <Input type="number" min="0" inputMode="decimal" value={s.amount} onChange={(e) => setEdits({ ...edits, [s.n]: { ...edits[s.n], amount: e.target.value } })} className="h-9" aria-label={`Monto ${s.label}`} />
                    {idx === 0
                      ? <label className="col-span-3 flex items-center gap-1.5 text-xs sm:col-span-1"><input type="checkbox" checked={firstPaid} onChange={(e) => setFirstPaid(e.target.checked)} className="h-4 w-4 accent-[#F2E30A]" /> Ya se pagó</label>
                      : <span className="hidden text-xs text-muted sm:block">Pendiente</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Field label="Notas (opcional)"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {expense && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[#F2E30A]" /> Gasto activo (desmárcalo para pausarlo sin borrarlo)</label>}
      </form>
    </Modal>
  )
}
