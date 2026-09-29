import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Receipt, Trash2, Users, Wallet, UserCog, Calculator, Pencil, CalendarDays } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, IconButton, Input, Modal, PageHeader, Select, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import CategoryResults from '@/components/CategoryResults'
import CoachCategoryPicker from '@/components/CoachCategoryPicker'
import CoachModal from '@/components/CoachModal'
import FinanceModules from '@/components/FinanceModules'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useExpenses, useExtraClasses, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, shortDate, today } from '@/lib/format'
import { EXPENSE_FREQUENCY, FREQUENCY_LABEL, expenseForMonth, installmentPlan, monthlyCost } from '@/lib/finance'
import type { Coach, Expense } from '@/lib/types'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const cents = (n: number) => money(Math.round(n * 100) / 100)
const thisYear = Number(today().slice(0, 4))
const YEARS = [thisYear - 1, thisYear, thisYear + 1]
const FIXED: Expense['frequency'][] = ['semanal', 'quincenal', 'mensual', 'anual']

/** Calendario del anticipo y los pagos; los meses ya pasados se marcan como pagados. */
function PlanSchedule({ plan }: { plan: ReturnType<typeof installmentPlan> }) {
  const month = today().slice(0, 7)
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {plan.schedule.map((p) => {
        const done = p.key < month
        return (
          <li key={`${p.kind}${p.n}`} className={cx('rounded-lg border px-2 py-1 text-xs', done ? 'border-ok/40 text-ok' : p.key === month ? 'border-brand text-brand' : 'border-ink-600 text-muted')}>
            {p.kind === 'anticipo' ? 'Anticipo' : `Pago ${p.n}`} · {p.label} · <b>{cents(p.amount)}</b>{done && ' ✓'}
          </li>
        )
      })}
    </ul>
  )
}

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
  const month = today().slice(0, 7)

  const active = useMemo(() => (students.data ?? []).filter((s) => s.status === 'activo'), [students.data])
  const activeCount = active.length
  const list = expenses.data ?? []
  const generalMonthly = list.reduce((a, e) => a + expenseForMonth(e, month), 0)
  const fixedList = list.filter((e) => FIXED.includes(e.frequency))
  const fixedMonthly = fixedList.reduce((a, e) => a + expenseForMonth(e, month), 0)
  // Gastos del mes: los de una sola vez y los pagos en partes que caen en el mes elegido
  const monthList = list.filter((e) => !FIXED.includes(e.frequency) && expenseForMonth(e, viewMonth) > 0)
    .sort((a, b) => entryDate(a, viewMonth).localeCompare(entryDate(b, viewMonth)))
  const monthTotal = monthList.reduce((a, e) => a + expenseForMonth(e, viewMonth), 0)
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
              {monthList.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-sm text-muted">Sin gastos extra en {MONTHS[Number(viewMonth.slice(5, 7)) - 1].toLowerCase()}. Agrega arbitrajes, balones, transporte, reparaciones…</td></tr>
              ) : monthList.map((e) => {
                const amount = expenseForMonth(e, viewMonth)
                const part = e.frequency === 'partes' ? installmentPlan(e, Number(viewMonth.slice(0, 4))).schedule.find((p) => p.key === viewMonth) : null
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{shortDate(entryDate(e, viewMonth))}</td>
                    <td><button onClick={() => setModal({ mode: 'mes', expense: e })} className="text-left font-medium hover:text-brand">{e.name}</button>
                      {e.notes && <p className="text-xs text-muted">{e.notes}</p>}</td>
                    <td>{part ? <Badge tone="brand">{part.kind === 'anticipo' ? 'Anticipo' : `Pago ${part.n} de ${e.installments}`}</Badge> : <span className="text-sm text-muted">Una sola vez</span>}
                      {part && <p className="text-xs text-muted">Total {money(e.amount)}</p>}</td>
                    <td className="font-semibold">{cents(amount)}</td>
                    <td>{activeCount ? cents(amount / activeCount) : '—'}</td>
                    <td>{rowActions(e, 'mes')}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-ink-900">
                <td colSpan={3} className="font-display text-lg font-bold uppercase">Total gastos del mes · {MONTHS[Number(viewMonth.slice(5, 7)) - 1]}</td>
                <td className="font-display text-lg font-bold text-bad">{money(Math.round(monthTotal))}</td>
                <td className="font-semibold text-brand">{activeCount ? cents(monthTotal / activeCount) : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

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
      {modal && <ExpenseModal mode={modal.mode} expense={modal.expense} defaultMonth={viewMonth} onClose={() => setModal(null)} nextOrder={list.length + 1} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Eliminar gasto" confirmLabel="Eliminar"
        text={<>Se eliminará <b className="text-white">{deleting?.name}</b> y dejará de restarse en los reportes. Si sólo quieres pausarlo, edítalo y desmarca "Gasto activo".</>} />
    </>
  )
}

function ExpenseModal({ mode, expense, defaultMonth, onClose, nextOrder }: { mode: 'fijo' | 'mes'; expense?: Expense; defaultMonth: string; onClose: () => void; nextOrder: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const initDate = expense?.paid_on
    ?? (expense?.paid_month ? `${expense.paid_year ?? thisYear}-${String(expense.paid_month).padStart(2, '0')}-01` : defaultMonth === today().slice(0, 7) ? today() : `${defaultMonth}-01`)
  const [f, setF] = useState({
    name: expense?.name ?? '', amount: expense ? String(expense.amount) : '',
    frequency: expense?.frequency ?? ((mode === 'mes' ? 'unico' : 'mensual') as Expense['frequency']),
    paid_month: expense?.paid_month ?? Number(today().slice(5, 7)), day: initDate,
    down: expense?.down_payment != null ? String(expense.down_payment) : '', installments: String(expense?.installments ?? 2),
    notes: expense?.notes ?? '', active: expense?.active ?? true,
  })
  const isPlan = f.frequency === 'partes'
  const isOnce = f.frequency === 'unico'
  const dYear = Number(f.day.slice(0, 4)) || thisYear
  const dMonth = Number(f.day.slice(5, 7)) || 1
  const plan = installmentPlan({ amount: Number(f.amount) || 0, down_payment: Number(f.down) || 0, installments: Math.round(Number(f.installments)) || 1, paid_month: dMonth, paid_year: dYear })
  const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast.error('Escribe el nombre del gasto.')
    if (!(Number(f.amount) >= 0) || f.amount === '') return toast.error('Escribe el monto.')
    if ((isOnce || isPlan) && !f.day) return toast.error('Escribe la fecha.')
    if (isPlan) {
      if (!(Number(f.down || 0) >= 0) || Number(f.down || 0) > Number(f.amount)) return toast.error('El anticipo no puede ser mayor que el total.')
      const n = Math.round(Number(f.installments))
      if (!(n >= 1 && n <= 60)) return toast.error('Los pagos deben ser entre 1 y 60.')
    }
    setSaving(true)
    const payload = {
      name: f.name.trim(), amount: Number(f.amount), frequency: f.frequency,
      paid_month: isOnce || isPlan ? dMonth : f.frequency === 'anual' ? f.paid_month : null,
      paid_year: isOnce || isPlan ? dYear : null,
      paid_on: isOnce || isPlan ? f.day : null,
      down_payment: isPlan ? Number(f.down) || 0 : null,
      installments: isPlan ? Math.round(Number(f.installments)) : null,
      notes: f.notes.trim() || null, active: f.active,
    }
    try {
      if (expense) unwrap(await supabase.from('expenses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', expense.id))
      else unwrap(await supabase.from('expenses').insert({ ...payload, sort_order: nextOrder }))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok(expense ? 'Gasto actualizado' : 'Gasto agregado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }
  const allowed: Expense['frequency'][] = mode === 'mes' ? ['unico', 'partes'] : FIXED
  return (
    <Modal open onClose={onClose} title={expense ? `Editar ${expense.name}` : mode === 'mes' ? 'Agregar gasto del mes' : 'Agregar gasto fijo'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="expense-form" icon={Wallet} loading={saving}>{expense ? 'Guardar' : 'Agregar'}</Button></>}>
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        <Field label="Concepto"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Luz, arbitrajes, balones…" autoFocus={!expense} list="expense-names" /></Field>
        <datalist id="expense-names">{['Renta de canchas', 'Regalías', 'Seguro', 'Luz', 'Agua', 'Arbitrajes', 'Balones y material', 'Uniformes', 'Transporte'].map((n) => <option key={n} value={n} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isPlan ? 'Total del gasto' : 'Monto'}><Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="¿Cada cuándo se paga?">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Expense['frequency'] })}>
              {[...new Set([...allowed, ...(expense ? [expense.frequency] : [])])].map((k) => <option key={k} value={k}>{EXPENSE_FREQUENCY[k].label}</option>)}
            </Select>
          </Field>
        </div>
        {f.frequency === 'anual' && (
          <Field label="Mes en que se paga">
            <Select value={f.paid_month} onChange={(e) => setF({ ...f, paid_month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        )}
        {isOnce && <Field label="Fecha del gasto" hint="Para el desglose día a día"><Input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>}
        {isPlan && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Anticipo" hint="0 si no hubo"><Input type="number" min="0" inputMode="decimal" value={f.down} onChange={(e) => setF({ ...f, down: e.target.value })} placeholder="0" /></Field>
              <Field label="¿En cuántos pagos el resto?" hint="Un pago por mes"><Input type="number" min="1" max="60" inputMode="numeric" value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} /></Field>
              <Field label={plan.down > 0 ? 'Fecha del anticipo' : 'Fecha del primer pago'} hint="Los siguientes, el mismo día de cada mes">
                <Input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} min={`${YEARS[0]}-01-01`} max={`${YEARS[2]}-12-31`} />
              </Field>
            </div>
            {Number(f.amount) > 0 && (
              <div className="rounded-xl border border-brand/30 bg-brand-dim p-3 text-sm">
                <p>Total <b>{money(plan.total)}</b> · Anticipo <b>{money(plan.down)}</b></p>
                <p className="font-display text-xl font-bold text-brand">Restante {money(plan.remaining)} en {plan.n} {plan.n === 1 ? 'pago' : 'pagos'} de {cents(plan.each)}</p>
                <PlanSchedule plan={plan} />
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
