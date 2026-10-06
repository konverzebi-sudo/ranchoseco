import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, isSameMonth, startOfMonth, startOfWeek, format } from 'date-fns'
import { ChevronLeft, ChevronRight, Dumbbell, Trophy, Plus, Receipt } from 'lucide-react'
import { Button, Card, IconButton, Modal, PageHeader, Select, Spinner, cx } from '@/components/ui'
import { useCategories, useExpenses, useMatches, useStudents, useTrainings } from '@/lib/api'
import { BirthdayButtons, birthdaysOn, turns } from '@/components/Birthdays'
import { PayInstallmentModal } from '@/components/Installments'
import { installmentLabel, installmentsOf } from '@/lib/finance'
import { money } from '@/lib/format'
import type { Expense, ExpenseInstallment } from '@/lib/types'
import { monthName, time, toISODate, today, date } from '@/lib/format'
import { TrainingModal } from './Trainings'
import { MatchModal } from './Matches'
import { useRole } from '@/lib/role'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
type Show = 'todo' | 'tr' | 'bd' | 'ma' | 'pend' | 'paid'
const FILTERS: { id: Show; label: string; dot?: string; emoji?: string; money?: boolean }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'tr', label: 'Entrenamientos', dot: 'bg-ink-700' },
  { id: 'bd', label: 'Cumpleaños', emoji: '🎂' },
  { id: 'ma', label: 'Partidos', dot: 'bg-brand' },
  { id: 'pend', label: 'Pagos pendientes', dot: 'bg-bad/40', money: true },
  { id: 'paid', label: 'Pagos hechos', dot: 'bg-ok/40', money: true },
]

export default function CalendarPage() {
  const categories = useCategories()
  const nav = useNavigate()
  const [cursor, setCursor] = useState(startOfMonth(new Date()))
  const role = useRole()
  const [catPicked, setCat] = useState('')
  const cat = role.isProfe && !role.categoryIds.includes(catPicked) ? role.categoryIds[0] ?? '' : catPicked
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  // Qué se ve en el calendario (toca un tipo para ver sólo eso)
  const [show, setShow] = useState<Show>('todo')
  const see = (k: Show) => show === 'todo' || show === k
  const [create, setCreate] = useState<{ kind: 'tr' | 'ma'; day: string } | null>(null)
  const gridStart = startOfWeek(cursor, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
  const range = { categoryId: cat || undefined, from: toISODate(gridStart), to: toISODate(gridEnd) }
  const trainings = useTrainings(range)
  const matches = useMatches(range)
  const expenses = useExpenses()
  const students = useStudents()
  const bdays = (k: string) => birthdaysOn((students.data ?? []).filter((s) => !cat || s.category_id === cat), k)
  const [paying, setPaying] = useState<{ expense: Expense; inst: ExpenseInstallment } | null>(null)
  // Pagos de gastos en partes y préstamos (pendientes en su fecha; pagados el día que se pagaron)
  const bills = useMemo(() => {
    const m = new Map<string, { expense: Expense; inst: ExpenseInstallment; label: string }[]>()
    for (const e of expenses.data ?? []) {
      const rows = e.active ? installmentsOf(e) : null
      for (const i of rows ?? []) {
        const d = i.paid_on ?? i.due_date
        m.set(d, [...(m.get(d) ?? []), { expense: e, inst: i, label: installmentLabel(i, rows!) }])
      }
    }
    return m
  }, [expenses.data])
  const t = today()

  const events = useMemo(() => {
    const m = new Map<string, { kind: 'tr' | 'ma'; id: string; label: string; time: string | null; cat: string }[]>()
    const push = (d: string, e: { kind: 'tr' | 'ma'; id: string; label: string; time: string | null; cat: string }) => m.set(d, [...(m.get(d) ?? []), e])
    for (const x of trainings.data ?? []) push(x.date, { kind: 'tr', id: x.id, label: x.objectives || 'Entrenamiento', time: x.start_time, cat: x.category_id })
    for (const x of matches.data ?? []) if (x.status !== 'cancelado') push(x.date, { kind: 'ma', id: x.id, label: `vs ${x.opponent}`, time: x.time, cat: x.category_id })
    for (const list of m.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    return m
  }, [trainings.data, matches.data])
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? ''
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  return (
    <>
      <PageHeader title="Calendario" subtitle="Entrenamientos y partidos por categoría."
        actions={<Select value={cat} onChange={(e) => setCat(e.target.value)} className="min-w-[200px]" aria-label="Categoría">
          {!role.isProfe && <option value="">Todas las categorías</option>}
          {categories.data?.filter((c) => !role.isProfe || role.categoryIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>} />
      <Card className="p-3 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => setCursor((c) => addMonths(c, -1))} />
          <h2 className="font-display text-2xl font-bold uppercase">{monthName(toISODate(cursor))}</h2>
          <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => setCursor((c) => addMonths(c, 1))} />
        </div>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Qué ver">
          {FILTERS.filter((f) => !f.money || !cat).map((f) => (
            <button key={f.id} onClick={() => setShow(show === f.id && f.id !== 'todo' ? 'todo' : f.id)} aria-pressed={show === f.id}
              className={cx('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition sm:text-sm',
                show === f.id ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted hover:text-fg')}>
              {f.dot && <span className={cx('h-3 w-3 rounded', f.dot)} />}{f.emoji}{f.label}
            </button>
          ))}
        </div>
        {(trainings.isLoading || matches.isLoading) ? <Spinner /> : (
          <div className="grid grid-cols-7 gap-1">
            {DAYS.map((d) => <p key={d} className="pb-1 text-center text-xs font-semibold uppercase text-muted">{d}</p>)}
            {days.map((d) => {
              const k = toISODate(d)
              const list = (events.get(k) ?? []).filter((e) => see(e.kind))
              const dayBills = cat ? [] : (bills.get(k) ?? []).filter((b) => see(b.inst.paid_on ? 'paid' : 'pend'))
              const max = show === 'todo' ? 3 : 8
              return (
                <button key={k} onClick={() => setDayOpen(k)}
                  className={cx('min-h-[64px] rounded-xl border p-1.5 text-left transition sm:min-h-[96px]', isSameMonth(d, cursor) ? 'border-ink-600 bg-ink-900 hover:border-ink-500' : 'border-transparent opacity-40',
                    k === t && 'border-brand')}>
                  <p className={cx('text-xs font-semibold', k === t ? 'text-brand' : 'text-muted')}>{format(d, 'd')}</p>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, max).map((e) => (
                      <p key={e.kind + e.id} className={cx('truncate rounded px-1 py-0.5 text-[10px] font-medium sm:text-xs', e.kind === 'ma' ? 'bg-brand text-ink' : 'bg-ink-700 text-white')}>
                        <span className="hidden sm:inline">{time(e.time)} </span>{cat ? e.label : catName(e.cat)}
                      </p>
                    ))}
                    {list.length > max && <p className="text-[10px] text-muted">+{list.length - max}</p>}
                    {see('bd') && bdays(k).map((s) => (
                      <p key={'b' + s.id} className="truncate rounded bg-[#F9A8D4]/25 px-1 py-0.5 text-[10px] font-medium text-[#BE185D] sm:text-xs">🎂 {s.full_name.split(' ')[0]}</p>
                    ))}
                    {dayBills.map((b) => (
                      <p key={b.inst.id} className={cx('truncate rounded px-1 py-0.5 text-[10px] font-medium sm:text-xs', b.inst.paid_on ? 'bg-ok/20 text-ok' : 'bg-bad/20 text-bad')}>
                        $ {b.expense.kind === 'prestamo' ? b.expense.lender ?? b.expense.name : b.expense.name}
                      </p>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <Modal open={!!dayOpen} onClose={() => setDayOpen(null)} title={dayOpen ? date(dayOpen, "EEEE d 'de' MMMM") : ''}
        footer={<>
          <Button variant="secondary" icon={Plus} onClick={() => { setCreate({ kind: 'tr', day: dayOpen! }); setDayOpen(null) }}>Entrenamiento</Button>
          <Button icon={Plus} onClick={() => { setCreate({ kind: 'ma', day: dayOpen! }); setDayOpen(null) }}>Partido</Button>
        </>}>
        {!cat && (bills.get(dayOpen ?? '') ?? []).filter((b) => see(b.inst.paid_on ? 'paid' : 'pend')).length > 0 && (
          <ul className="mb-3 space-y-2">
            {(bills.get(dayOpen ?? '') ?? []).filter((b) => see(b.inst.paid_on ? 'paid' : 'pend')).map((b) => (
              <li key={b.inst.id}>
                <button onClick={() => { setPaying({ expense: b.expense, inst: b.inst }); setDayOpen(null) }} className="flex w-full items-center gap-3 rounded-xl bg-ink-900 p-3 text-left hover:bg-ink-700">
                  <div className={cx('rounded-lg p-2', b.inst.paid_on ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad')}><Receipt className="h-4 w-4" /></div>
                  <div className="flex-1"><p className="font-medium">{b.expense.kind === 'prestamo' ? `Préstamo · ${b.expense.lender ?? b.expense.name}` : b.expense.name} · {b.label}</p>
                    <p className="text-xs text-muted">{money(b.inst.amount)} · {b.inst.paid_on ? 'Pagado' : 'Pendiente: toca para marcar como pagado'}</p></div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {dayOpen && see('bd') && bdays(dayOpen).length > 0 && (
          <ul className="mb-3 space-y-2">
            {bdays(dayOpen).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 p-3">
                <span className="text-xl">🎂</span>
                <div className="min-w-0 flex-1"><p className="font-medium">{s.full_name}</p><p className="text-xs text-muted">Cumple {turns(s, dayOpen)} años</p></div>
                <BirthdayButtons student={s} iso={dayOpen} />
              </li>
            ))}
          </ul>
        )}
        {(show === 'todo' || show === 'tr' || show === 'ma') && ((events.get(dayOpen ?? '') ?? []).filter((e) => see(e.kind)).length === 0 ? <p className="text-sm text-muted">{show === 'tr' ? 'Sin entrenamientos este día.' : show === 'ma' ? 'Sin partidos este día.' : dayOpen && bdays(dayOpen).length ? 'Sin entrenamientos ni partidos este día.' : 'Sin actividades este día.'}</p> : (
          <ul className="space-y-2">
            {(events.get(dayOpen ?? '') ?? []).filter((e) => see(e.kind)).map((e) => (
              <li key={e.kind + e.id}>
                <button onClick={() => nav(e.kind === 'ma' ? `/partidos/${e.id}` : '/entrenamientos')} className="flex w-full items-center gap-3 rounded-xl bg-ink-900 p-3 text-left hover:bg-ink-700">
                  <div className={cx('rounded-lg p-2', e.kind === 'ma' ? 'bg-brand text-ink' : 'bg-ink-700 text-brand')}>{e.kind === 'ma' ? <Trophy className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}</div>
                  <div><p className="font-medium">{e.label}</p><p className="text-xs text-muted">{catName(e.cat)} {time(e.time)}</p></div>
                </button>
              </li>
            ))}
          </ul>
        ))}
      </Modal>
      {paying && <PayInstallmentModal expense={paying.expense} inst={paying.inst} onClose={() => setPaying(null)} />}
      {create?.kind === 'tr' && <TrainingModal defaultCategory={cat} defaultDate={create.day} onClose={() => setCreate(null)} />}
      {create?.kind === 'ma' && <MatchModal defaultCategory={cat} defaultDate={create.day} onClose={() => setCreate(null)} onSaved={(id) => nav(`/partidos/${id}`)} />}
    </>
  )
}
