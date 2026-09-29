import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Receipt, Trash2, Users, Wallet, UserCog, Check, Loader2, Calculator } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, IconButton, Input, Modal, PageHeader, Select, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import CategoryResults from '@/components/CategoryResults'
import CoachCategoryPicker from '@/components/CoachCategoryPicker'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useExpenses, useExtraClasses, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, today } from '@/lib/format'
import { EXPENSE_FREQUENCY, FREQUENCY_LABEL, WEEKS_PER_MONTH, expenseForMonth, installmentPlan, monthlyCost } from '@/lib/finance'
import type { Expense } from '@/lib/types'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const cents = (n: number) => money(Math.round(n * 100) / 100)
const thisYear = Number(today().slice(0, 4))
const YEARS = [thisYear - 1, thisYear, thisYear + 1]

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

export default function Expenses() {
  const expenses = useExpenses()
  const students = useStudents()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const cc = useCoachCategories()
  const extras = useExtraClasses()
  const categories = useCategories()
  const [adding, setAdding] = useState<'fijo' | 'mes' | null>(null)
  const [viewMonth, setViewMonth] = useState(today().slice(0, 7))
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null)
  const month = today().slice(0, 7)

  const active = useMemo(() => (students.data ?? []).filter((s) => s.status === 'activo'), [students.data])
  const activeCount = active.length
  const list = expenses.data ?? []
  const generalMonthly = list.reduce((a, e) => a + expenseForMonth(e, month), 0)
  const FIXED: Expense['frequency'][] = ['semanal', 'quincenal', 'mensual', 'anual']
  const fixedList = list.filter((e) => FIXED.includes(e.frequency))
  const fixedMonthly = fixedList.reduce((a, e) => a + expenseForMonth(e, month), 0)
  // Gastos del mes: los de una sola vez y los pagos en partes que caen en el mes elegido
  const monthList = list.filter((e) => !FIXED.includes(e.frequency) && expenseForMonth(e, viewMonth) > 0)
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

  if (expenses.error) return <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />

  return (
    <>
      <PageHeader title="Gastos" subtitle="Captura los gastos a mano. El sistema calcula cuánto le corresponde a cada alumno."
        actions={<>
          <Button variant="secondary" icon={Plus} onClick={() => setAdding('mes')}>Gasto del mes</Button>
          <Button icon={Plus} onClick={() => setAdding('fijo')}>Gasto fijo</Button>
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Alumnos activos" value={activeCount} icon={Users} hint="Base para repartir los gastos" />
        <StatCard label="Gastos generales al mes" value={money(Math.round(generalMonthly))} icon={Receipt} hint="Semanal × 4.33 · anual ÷ 12" />
        <StatCard label="Gasto por alumno al mes" value={activeCount ? cents(generalMonthly / activeCount) : '—'} icon={Calculator} tone="brand" />
        <StatCard label="Sueldos de profesores al mes" value={money(Math.round(salariesMonthly))} icon={UserCog} hint={`${coachRows.length} profesores con sueldo`} />
      </div>

      <div className="mb-8"><CategoryResults /></div>

      {/* ---------- Gastos del mes ---------- */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Gastos del mes</h2>
          <p className="text-sm text-muted">Gastos de una sola vez y pagos en partes que caen en el mes.</p>
        </div>
        <div className="flex gap-2">
          <Input type="month" value={viewMonth} onChange={(e) => setViewMonth(e.target.value || today().slice(0, 7))} className="h-9 w-40" aria-label="Mes" />
          <Button size="sm" icon={Plus} onClick={() => setAdding('mes')}>Agregar</Button>
        </div>
      </div>
      {expenses.isLoading ? <Spinner /> : (
        <>
          {monthList.length === 0 ? (
            <Card className="mb-3 p-5 text-sm text-muted">Sin gastos extra en {MONTHS[Number(viewMonth.slice(5, 7)) - 1].toLowerCase()}. Agrega arbitrajes, balones, transporte, reparaciones…</Card>
          ) : (
            <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {monthList.map((e) => <ExpenseCard key={e.id} expense={e} activeCount={activeCount} />)}
            </div>
          )}
          <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 bg-ink-900 px-5 py-4">
            <p className="font-display text-lg font-bold uppercase tracking-wide">Total gastos del mes · {MONTHS[Number(viewMonth.slice(5, 7)) - 1]}</p>
            <div className="flex flex-wrap gap-8">
              <div><p className="text-xs uppercase tracking-wider text-muted">Total</p><p className="font-display text-3xl font-bold text-bad">{money(Math.round(monthTotal))}</p></div>
              <div><p className="text-xs uppercase tracking-wider text-muted">Por alumno</p><p className="font-display text-3xl font-bold text-brand">{activeCount ? cents(monthTotal / activeCount) : '—'}</p></div>
            </div>
          </Card>
        </>
      )}

      {/* ---------- Gastos generales fijos ---------- */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Gastos generales fijos</h2>
          <p className="text-sm text-muted">Se repiten cada semana, quincena, mes o año. Edita el monto directo en la tarjeta.</p>
        </div>
        <Button size="sm" icon={Plus} onClick={() => setAdding('fijo')}>Agregar gasto fijo</Button>
      </div>
      {expenses.isLoading || students.isLoading ? <Spinner /> : !fixedList.length ? (
        <Card className="mb-8"><Empty icon={Receipt} title="Aún no hay gastos fijos" text="Agrega regalías, renta, seguro, sueldos generales…" action={<Button icon={Plus} onClick={() => setAdding('fijo')}>Agregar gasto fijo</Button>} /></Card>
      ) : (
        <>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {fixedList.map((e) => <ExpenseCard key={e.id} expense={e} activeCount={activeCount} />)}
          <button onClick={() => setAdding('fijo')} className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-500 text-muted transition hover:border-brand hover:text-brand">
            <Plus className="h-6 w-6" /> Agregar gasto fijo
          </button>
        </div>
        <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 border-brand/40 bg-ink-900 px-5 py-4">
          <div>
            <p className="font-display text-lg font-bold uppercase tracking-wide">Total gastos generales fijos</p>
            <p className="text-xs text-muted">{fixedList.filter((e) => e.active).length} gastos · semanal × 4.33 · anual ÷ 12</p>
          </div>
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">Al mes</p>
              <p className="font-display text-3xl font-bold text-bad">{money(Math.round(fixedMonthly))}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">Por alumno al mes</p>
              <p className="font-display text-3xl font-bold text-brand">{activeCount ? cents(fixedMonthly / activeCount) : '—'}</p>
            </div>
          </div>
        </Card>
        </>
      )}

      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Profesores por categoría</h2>
      {coachRows.length === 0 ? (
        <Card className="mb-8 p-5 text-sm text-muted">Registra el sueldo de cada profesor en <Link to="/profesores" className="text-brand hover:underline">Profesores</Link>.</Card>
      ) : (
        <Card className="mb-8 overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Profesor</th><th>Categorías</th><th>Sueldo</th><th>Al mes</th><th>Por alumno de su categoría</th></tr></thead>
            <tbody>
              {coachRows.map(({ c, p, cats, catStudents, monthly }) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.full_name}</td>
                  <td>
                    <button onClick={() => setPicking({ id: c.id, name: c.full_name })} className="group flex flex-wrap items-center gap-1 text-left" aria-label={`Categorías de ${c.full_name}`}>
                      {cats.length
                        ? <>{cats.map((k) => <Badge key={k!.id} tone="brand">{k!.name}</Badge>)}<span className="ml-1 text-xs text-muted group-hover:text-brand">Cambiar</span></>
                        : <span className="text-xs text-warn group-hover:underline">Asignar categoría</span>}
                    </button>
                  </td>
                  <td>{money(p!.amount)} <span className="text-xs text-muted">{FREQUENCY_LABEL[p!.frequency]}</span></td>
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
      {adding && <ExpenseModal mode={adding} onClose={() => setAdding(null)} nextOrder={list.length + 1} />}
    </>
  )
}

/** Tarjeta editable: los cambios se guardan solos al salir del campo. */
function ExpenseCard({ expense, activeCount }: { expense: Expense; activeCount: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const init = () => ({ name: expense.name, amount: String(expense.amount), frequency: expense.frequency, paid_month: expense.paid_month ?? 9, paid_year: expense.paid_year ?? thisYear, down: String(expense.down_payment ?? 0), installments: String(expense.installments ?? 2) })
  const [f, setF] = useState(init)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => { setF(init()) }, [expense]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<Expense>) => {
    setState('saving')
    try {
      unwrap(await supabase.from('expenses').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', expense.id))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      setState('saved')
      setTimeout(() => setState('idle'), 1500)
    } catch (e) { setState('idle'); toast.error(e) }
  }
  const commitAmount = () => {
    const n = Number(f.amount)
    if (!(n >= 0) || f.amount === '') { toast.error('Escribe un monto válido.'); return setF((x) => ({ ...x, amount: String(expense.amount) })) }
    if (n !== Number(expense.amount)) save({ amount: n })
  }
  const commitDown = () => {
    const n = Number(f.down)
    if (!(n >= 0) || n > Number(f.amount)) { toast.error('El anticipo no puede ser mayor que el total.'); return setF((x) => ({ ...x, down: String(expense.down_payment ?? 0) })) }
    if (n !== Number(expense.down_payment ?? 0)) save({ down_payment: n })
  }
  const commitInstallments = () => {
    const n = Math.round(Number(f.installments))
    if (!(n >= 1 && n <= 60)) { toast.error('Los pagos deben ser entre 1 y 60.'); return setF((x) => ({ ...x, installments: String(expense.installments ?? 2) })) }
    if (n !== expense.installments) save({ installments: n })
  }
  const commitName = () => {
    if (!f.name.trim()) return setF((x) => ({ ...x, name: expense.name }))
    if (f.name.trim() !== expense.name) save({ name: f.name.trim() })
  }
  const remove = async () => {
    try {
      unwrap(await supabase.from('expenses').delete().eq('id', expense.id))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok('Gasto eliminado')
    } catch (e) { toast.error(e) }
  }

  const amount = Number(f.amount) || 0
  const freq = EXPENSE_FREQUENCY[f.frequency]
  const perStudent = activeCount ? amount / activeCount : 0
  const isPlan = f.frequency === 'partes'
  const plan = installmentPlan({ amount, down_payment: Number(f.down) || 0, installments: Number(f.installments) || 1, paid_month: f.paid_month, paid_year: f.paid_year })
  const monthly = f.frequency === 'semanal' ? amount * WEEKS_PER_MONTH : f.frequency === 'quincenal' ? amount * 2 : f.frequency === 'anual' ? amount / 12 : amount

  return (
    <Card className={cx('flex flex-col p-4', !expense.active && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={commitName} aria-label="Nombre del gasto"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 font-display text-xl font-bold uppercase tracking-wide outline-none focus:bg-ink-900 focus:ring-1 focus:ring-brand" />
        <span className="flex h-8 w-6 items-center justify-center">
          {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : state === 'saved' ? <Check className="h-4 w-4 text-ok" aria-label="Guardado" /> : null}
        </span>
        <IconButton icon={Trash2} label={`Eliminar ${expense.name}`} onClick={() => setConfirmDel(true)} className="h-8 w-8" />
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
          <Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })}
            onBlur={commitAmount} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="pl-7 font-display text-2xl font-bold" aria-label={`Monto de ${expense.name}`} />
        </div>
        <Select value={f.frequency} onChange={(e) => {
            const v = e.target.value as Expense['frequency']
            setF({ ...f, frequency: v })
            save({
              frequency: v, paid_month: v === 'anual' || v === 'unico' || v === 'partes' ? f.paid_month : null,
              paid_year: v === 'unico' || v === 'partes' ? f.paid_year : null,
              down_payment: v === 'partes' ? Number(f.down) || 0 : null, installments: v === 'partes' ? Number(f.installments) || 2 : null,
            })
          }}
          className="w-40" aria-label="Frecuencia">
          {(Object.keys(EXPENSE_FREQUENCY) as Expense['frequency'][]).map((k) => <option key={k} value={k}>{EXPENSE_FREQUENCY[k].label}</option>)}
        </Select>
      </div>
      {(f.frequency === 'anual' || f.frequency === 'unico') && (
        <label className="mt-2 flex items-center gap-2 text-sm text-muted">
          Se paga en
          <Select value={f.paid_month} onChange={(e) => { const m = Number(e.target.value); setF({ ...f, paid_month: m }); save({ paid_month: m }) }} className="h-9 w-40" aria-label="Mes de pago">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </label>
      )}
      {isPlan && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Anticipo">
              <Input type="number" min="0" inputMode="decimal" value={f.down} onChange={(e) => setF({ ...f, down: e.target.value })}
                onBlur={commitDown} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            </Field>
            <Field label="¿En cuántos pagos?">
              <Input type="number" min="1" max="60" inputMode="numeric" value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })}
                onBlur={commitInstallments} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            </Field>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-muted">
            {plan.down > 0 ? 'Anticipo en' : 'Primer pago en'}
            <Select value={f.paid_month} onChange={(e) => { const m = Number(e.target.value); setF({ ...f, paid_month: m }); save({ paid_month: m }) }} className="h-9 w-32" aria-label="Mes de inicio">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
            <Select value={f.paid_year} onChange={(e) => { const y = Number(e.target.value); setF({ ...f, paid_year: y }); save({ paid_year: y }) }} className="h-9 w-24" aria-label="Año de inicio">
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </label>
        </>
      )}

      {isPlan ? (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-dim p-3">
          <p className="text-xs uppercase tracking-wider text-muted">Restante</p>
          <p className="font-display text-2xl font-bold text-brand">{money(plan.remaining)} <span className="text-sm font-normal text-muted">en {plan.n} {plan.n === 1 ? 'pago' : 'pagos'} de {cents(plan.each)}</span></p>
          <p className="text-xs text-muted">Total {money(plan.total)} · anticipo {money(plan.down)}{activeCount > 0 && <> · {cents(plan.each / activeCount)} por alumno en cada pago</>}</p>
          <PlanSchedule plan={plan} />
        </div>
      ) : (
      <div className="mt-4 rounded-xl border border-brand/30 bg-brand-dim p-3">
        <p className="text-xs uppercase tracking-wider text-muted">Corresponde por alumno</p>
        <p className="font-display text-2xl font-bold text-brand">{cents(perStudent)} <span className="text-sm font-normal text-muted">{freq.per}</span></p>
        <p className="text-xs text-muted">
          {money(amount)} ÷ {activeCount} alumnos activos
          {f.frequency !== 'mensual' && f.frequency !== 'unico' && activeCount > 0 && <> · ≈ {cents(monthly / activeCount)} al mes</>}
        </p>
      </div>
      )}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} danger title="Eliminar gasto" confirmLabel="Eliminar"
        text={<>Se eliminará <b className="text-white">{expense.name}</b> y dejará de restarse en los reportes. Si sólo quieres pausarlo, cambia el monto a 0.</>} />
    </Card>
  )
}

function ExpenseModal({ mode, onClose, nextOrder }: { mode: 'fijo' | 'mes'; onClose: () => void; nextOrder: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ name: '', amount: '', frequency: (mode === 'mes' ? 'unico' : 'mensual') as Expense['frequency'], paid_month: Number(today().slice(5, 7)), paid_year: thisYear, down: '', installments: '2', notes: '' })
  const isPlan = f.frequency === 'partes'
  const plan = installmentPlan({ amount: Number(f.amount) || 0, down_payment: Number(f.down) || 0, installments: Math.round(Number(f.installments)) || 1, paid_month: f.paid_month, paid_year: f.paid_year })
  const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast.error('Escribe el nombre del gasto.')
    if (!(Number(f.amount) >= 0) || f.amount === '') return toast.error('Escribe el monto.')
    if (isPlan) {
      if (!(Number(f.down || 0) >= 0) || Number(f.down || 0) > Number(f.amount)) return toast.error('El anticipo no puede ser mayor que el total.')
      const n = Math.round(Number(f.installments))
      if (!(n >= 1 && n <= 60)) return toast.error('Los pagos deben ser entre 1 y 60.')
    }
    setSaving(true)
    try {
      unwrap(await supabase.from('expenses').insert({
        name: f.name.trim(), amount: Number(f.amount), frequency: f.frequency,
        paid_month: f.frequency === 'anual' || f.frequency === 'unico' || isPlan ? f.paid_month : null,
        paid_year: f.frequency === 'unico' ? thisYear : isPlan ? f.paid_year : null,
        ...(isPlan ? { down_payment: Number(f.down) || 0, installments: Math.round(Number(f.installments)) } : {}),
        notes: f.notes.trim() || null, sort_order: nextOrder,
      }))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok('Gasto agregado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={mode === 'mes' ? 'Agregar gasto del mes' : 'Agregar gasto fijo'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="expense-form" icon={Wallet} loading={saving}>Agregar</Button></>}>
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        <Field label="Concepto"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Luz, arbitrajes, balones…" autoFocus list="expense-names" /></Field>
        <datalist id="expense-names">{['Renta de canchas', 'Regalías', 'Seguro', 'Luz', 'Agua', 'Arbitrajes', 'Balones y material', 'Uniformes', 'Transporte'].map((n) => <option key={n} value={n} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isPlan ? 'Total del gasto' : 'Monto'}><Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="¿Cada cuándo se paga?">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Expense['frequency'] })}>
              {(Object.keys(EXPENSE_FREQUENCY) as Expense['frequency'][])
                .filter((k) => (mode === 'mes' ? ['unico', 'partes'] : ['semanal', 'quincenal', 'mensual', 'anual']).includes(k))
                .map((k) => <option key={k} value={k}>{EXPENSE_FREQUENCY[k].label}</option>)}
            </Select>
          </Field>
        </div>
        {(f.frequency === 'anual' || f.frequency === 'unico') && (
          <Field label="Mes en que se paga">
            <Select value={f.paid_month} onChange={(e) => setF({ ...f, paid_month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        )}
        {isPlan && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Anticipo" hint="Lo que se dio de entrada (0 si no hubo)"><Input type="number" min="0" inputMode="decimal" value={f.down} onChange={(e) => setF({ ...f, down: e.target.value })} placeholder="0" /></Field>
              <Field label="¿En cuántos pagos el resto?" hint="Un pago por mes"><Input type="number" min="1" max="60" inputMode="numeric" value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={plan.down > 0 ? 'Mes del anticipo' : 'Mes del primer pago'}>
                <Select value={f.paid_month} onChange={(e) => setF({ ...f, paid_month: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Año">
                <Select value={f.paid_year} onChange={(e) => setF({ ...f, paid_year: Number(e.target.value) })}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
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
      </form>
    </Modal>
  )
}
