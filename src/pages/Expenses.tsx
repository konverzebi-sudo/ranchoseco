import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Receipt, Trash2, Users, Wallet, UserCog, Check, Loader2, Calculator } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, IconButton, Input, Modal, PageHeader, Select, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import CategoryResults from '@/components/CategoryResults'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useExpenses, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, today } from '@/lib/format'
import { EXPENSE_FREQUENCY, FREQUENCY_LABEL, WEEKS_PER_MONTH, expenseForMonth, monthlyCost } from '@/lib/finance'
import type { Expense } from '@/lib/types'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const cents = (n: number) => money(Math.round(n * 100) / 100)

export default function Expenses() {
  const expenses = useExpenses()
  const students = useStudents()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const cc = useCoachCategories()
  const categories = useCategories()
  const [adding, setAdding] = useState(false)
  const month = today().slice(0, 7)

  const active = useMemo(() => (students.data ?? []).filter((s) => s.status === 'activo'), [students.data])
  const activeCount = active.length
  const list = expenses.data ?? []
  const generalMonthly = list.reduce((a, e) => a + expenseForMonth(e, month), 0)
  const coachRows = (coaches.data ?? []).filter((c) => c.active).map((c) => {
    const p = pay.data?.find((x) => x.coach_id === c.id)
    const cats = (cc.data ?? []).filter((x) => x.coach_id === c.id).map((x) => categories.data?.find((k) => k.id === x.category_id)).filter(Boolean)
    const catStudents = active.filter((s) => cats.some((k) => k!.id === s.category_id)).length
    return { c, p, cats, catStudents, monthly: monthlyCost(p) }
  }).filter((r) => r.p)
  const salariesMonthly = coachRows.reduce((a, r) => a + r.monthly, 0)

  if (expenses.error) return <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />

  return (
    <>
      <PageHeader title="Gastos" subtitle="Captura los gastos a mano. El sistema calcula cuánto le corresponde a cada alumno."
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Agregar gasto</Button>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Alumnos activos" value={activeCount} icon={Users} hint="Base para repartir los gastos" />
        <StatCard label="Gastos generales al mes" value={money(Math.round(generalMonthly))} icon={Receipt} hint="Semanal × 4.33 · anual ÷ 12" />
        <StatCard label="Gasto por alumno al mes" value={activeCount ? cents(generalMonthly / activeCount) : '—'} icon={Calculator} tone="brand" />
        <StatCard label="Sueldos de profesores al mes" value={money(Math.round(salariesMonthly))} icon={UserCog} hint={`${coachRows.length} profesores con sueldo`} />
      </div>

      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Gastos generales</h2>
      {expenses.isLoading || students.isLoading ? <Spinner /> : !list.length ? (
        <Card className="mb-8"><Empty icon={Receipt} title="Aún no hay gastos" text="Agrega regalías, renta, seguro, sueldos generales…" action={<Button icon={Plus} onClick={() => setAdding(true)}>Agregar gasto</Button>} /></Card>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => <ExpenseCard key={e.id} expense={e} activeCount={activeCount} />)}
          <button onClick={() => setAdding(true)} className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-500 text-muted transition hover:border-brand hover:text-brand">
            <Plus className="h-6 w-6" /> Agregar gasto
          </button>
        </div>
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
                  <td>{cats.length ? <div className="flex flex-wrap gap-1">{cats.map((k) => <Badge key={k!.id} tone="brand">{k!.name}</Badge>)}</div> : <Link to="/profesores" className="text-xs text-warn hover:underline">Asignar categoría</Link>}</td>
                  <td>{money(p!.amount)} <span className="text-xs text-muted">{FREQUENCY_LABEL[p!.frequency]}</span></td>
                  <td>{money(Math.round(monthly))}</td>
                  <td>{catStudents ? <>{cents(Number(p!.amount) / catStudents)} <span className="text-xs text-muted">{FREQUENCY_LABEL[p!.frequency]}</span></> : <span className="text-xs text-muted">Se reparte entre todos</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <CategoryResults />
      {adding && <ExpenseModal onClose={() => setAdding(false)} nextOrder={list.length + 1} />}
    </>
  )
}

/** Tarjeta editable: los cambios se guardan solos al salir del campo. */
function ExpenseCard({ expense, activeCount }: { expense: Expense; activeCount: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ name: expense.name, amount: String(expense.amount), frequency: expense.frequency, paid_month: expense.paid_month ?? 9 })
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => {
    setF({ name: expense.name, amount: String(expense.amount), frequency: expense.frequency, paid_month: expense.paid_month ?? 9 })
  }, [expense])

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
        <Select value={f.frequency} onChange={(e) => { const v = e.target.value as Expense['frequency']; setF({ ...f, frequency: v }); save({ frequency: v, paid_month: v === 'anual' || v === 'unico' ? f.paid_month : null, paid_year: v === 'unico' ? Number(today().slice(0, 4)) : null }) }}
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

      <div className="mt-4 rounded-xl border border-brand/30 bg-brand-dim p-3">
        <p className="text-xs uppercase tracking-wider text-muted">Corresponde por alumno</p>
        <p className="font-display text-2xl font-bold text-brand">{cents(perStudent)} <span className="text-sm font-normal text-muted">{freq.per}</span></p>
        <p className="text-xs text-muted">
          {money(amount)} ÷ {activeCount} alumnos activos
          {f.frequency !== 'mensual' && f.frequency !== 'unico' && activeCount > 0 && <> · ≈ {cents(monthly / activeCount)} al mes</>}
        </p>
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} danger title="Eliminar gasto" confirmLabel="Eliminar"
        text={<>Se eliminará <b className="text-white">{expense.name}</b> y dejará de restarse en los reportes. Si sólo quieres pausarlo, cambia el monto a 0.</>} />
    </Card>
  )
}

function ExpenseModal({ onClose, nextOrder }: { onClose: () => void; nextOrder: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ name: '', amount: '', frequency: 'mensual' as Expense['frequency'], paid_month: Number(today().slice(5, 7)), notes: '' })
  const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast.error('Escribe el nombre del gasto.')
    if (!(Number(f.amount) >= 0) || f.amount === '') return toast.error('Escribe el monto.')
    setSaving(true)
    try {
      unwrap(await supabase.from('expenses').insert({
        name: f.name.trim(), amount: Number(f.amount), frequency: f.frequency,
        paid_month: f.frequency === 'anual' || f.frequency === 'unico' ? f.paid_month : null,
        paid_year: f.frequency === 'unico' ? Number(today().slice(0, 4)) : null,
        notes: f.notes.trim() || null, sort_order: nextOrder,
      }))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok('Gasto agregado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title="Agregar gasto"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="expense-form" icon={Wallet} loading={saving}>Agregar</Button></>}>
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        <Field label="Concepto"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Luz, arbitrajes, balones…" autoFocus list="expense-names" /></Field>
        <datalist id="expense-names">{['Renta de canchas', 'Regalías', 'Seguro', 'Luz', 'Agua', 'Arbitrajes', 'Balones y material', 'Uniformes', 'Transporte'].map((n) => <option key={n} value={n} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto"><Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="¿Cada cuándo se paga?">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Expense['frequency'] })}>
              {(Object.keys(EXPENSE_FREQUENCY) as Expense['frequency'][]).map((k) => <option key={k} value={k}>{EXPENSE_FREQUENCY[k].label}</option>)}
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
        <Field label="Notas (opcional)"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}
