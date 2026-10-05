import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { startOfMonth, addDays } from 'date-fns'
import { Wallet, Download, CalendarPlus, AlertTriangle, TrendingUp, CheckCircle2, Receipt, GraduationCap, HelpCircle, Eraser } from 'lucide-react'
import { Avatar, Badge, Button, Card, Empty, ErrorState, PageHeader, SearchInput, Segmented, Select, Spinner, StatCard, feeTone } from '@/components/ui'
import { CollectButton } from '@/components/WhatsAppButtons'
import { PaymentModal, GenerateMonthModal } from '@/components/PaymentForms'
import { ScholarshipReviewModal } from '@/components/ScholarshipReview'
import CategoryResults from '@/components/CategoryResults'
import WaiveLateFeesModal from '@/components/WaiveLateFees'
import { useCategories, useFees, usePayments, useStudents, primaryGuardian, type StudentRow } from '@/lib/api'
import { ACCOUNT_LABEL, METHOD_LABEL, date, money, monthName, prettyPhone, shortDate, toISODate, today } from '@/lib/format'
import { exportCsv } from '@/lib/csv'
import type { AccountStatus, FeeBalance } from '@/lib/types'

type Filter = 'vencido' | 'por_confirmar' | 'por_vencer' | 'pendiente' | 'al_corriente' | 'todos'
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Billing() {
  const [params, setParams] = useSearchParams()
  const filter = (params.get('f') as Filter) || 'vencido'
  const [cat, setCat] = useState('')
  const [period, setPeriod] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'alumnos' | 'resumen' | 'pagos'>('alumnos')
  const [paying, setPaying] = useState<StudentRow | null>(null)
  const [generating, setGenerating] = useState(false)
  const [reviewing, setReviewing] = useState<{ fee: FeeBalance; name: string } | null>(null)
  const [waiveAll, setWaiveAll] = useState(false)
  const students = useStudents()
  const categories = useCategories()
  const fees = useFees()
  const monthStart = toISODate(startOfMonth(new Date()))
  const payments = usePayments(undefined, view === 'pagos' ? undefined : monthStart)
  const t = today()
  const soon = toISODate(addDays(new Date(), 7))

  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name ?? 'Sin categoría'
  const periods = useMemo(() => [...new Set((fees.data ?? []).map((f) => f.period))].sort().reverse(), [fees.data])

  const rows = useMemo(() => {
    const byStudent = new Map<string, FeeBalance[]>()
    for (const f of fees.data ?? []) {
      if (period && f.period !== period) continue
      byStudent.set(f.student_id, [...(byStudent.get(f.student_id) ?? []), f])
    }
    const nq = norm(q.trim())
    return (students.data ?? [])
      .filter((s) => s.status === 'activo' && (!cat || s.category_id === cat))
      .filter((s) => !nq || norm(s.full_name).includes(nq) || norm(primaryGuardian(s)?.full_name ?? '').includes(nq))
      .map((s) => {
        const list = byStudent.get(s.id) ?? []
        const open = list.filter((f) => Number(f.balance) > 0)
        const balance = open.reduce((a, f) => a + Number(f.balance), 0)
        const late = open.reduce((a, f) => a + Number(f.late_fee), 0)
        const overdue = open.some((f) => f.status === 'vencido')
        const toReview = open.filter((f) => f.status === 'por_confirmar')
        const collectible = open.filter((f) => f.status !== 'por_confirmar').reduce((a, f) => a + Number(f.balance), 0)
        const dueSoon = open.some((f) => f.status !== 'vencido' && f.status !== 'por_confirmar' && f.due_date <= soon && f.due_date >= t)
        const status = overdue ? 'vencido' : toReview.length ? 'por_confirmar' : open.some((f) => f.status === 'parcial') ? 'parcial' : open.length ? 'pendiente' : 'al_corriente'
        return { s, open, balance, late, overdue, toReview, collectible, dueSoon, status: status as AccountStatus, hasFees: list.length > 0 }
      })
      .filter((r) =>
        filter === 'todos' ? true :
        filter === 'vencido' ? r.overdue :
        filter === 'por_confirmar' ? r.toReview.length > 0 :
        filter === 'por_vencer' ? r.dueSoon :
        filter === 'pendiente' ? r.balance > 0 :
        r.balance === 0 && r.hasFees)
      .sort((a, b) => b.balance - a.balance)
  }, [fees.data, students.data, cat, period, q, filter, soon, t])

  const totals = useMemo(() => {
    const active = new Set((students.data ?? []).filter((s) => s.status === 'activo').map((s) => s.id))
    const open = (fees.data ?? []).filter((f) => Number(f.balance) > 0 && active.has(f.student_id))
    return {
      review: open.filter((f) => f.status === 'por_confirmar').reduce((a, f) => a + Number(f.balance), 0),
      reviewCount: open.filter((f) => f.status === 'por_confirmar').length,
      scholarshipMonth: (fees.data ?? []).filter((f) => f.period === monthStart).reduce((a, f) => a + Number(f.discount), 0),
      scholarshipAll: (fees.data ?? []).reduce((a, f) => a + Number(f.discount), 0),
      lateFees: open.filter((f) => Number(f.late_fee) > 0),
      pending: open.reduce((a, f) => a + Number(f.balance), 0),
      overdue: open.filter((f) => f.status === 'vencido').reduce((a, f) => a + Number(f.balance), 0),
      collected: (payments.data ?? []).filter((p) => p.paid_at >= monthStart).reduce((a, p) => a + Number(p.amount), 0),
      open,
    }
  }, [fees.data, students.data, payments.data, soon, monthStart])

  const lateTotal = totals.lateFees.reduce((a, f) => a + Number(f.late_fee), 0)
  const setFilter = (f: Filter) => setParams({ f }, { replace: true })
  const doExport = () =>
    exportCsv(`cobranza-${t}.csv`, ['Alumno', 'Categoría', 'Avisos a (papá/mamá)', 'Teléfono', 'Conceptos pendientes', 'Recargo', 'Saldo', 'Estado'],
      rows.map((r) => {
        const g = primaryGuardian(r.s)
        return [r.s.full_name, catName(r.s.category_id), g?.full_name, g ? prettyPhone(g.phone) : '', r.open.map((f) => `${f.concept} ${monthName(f.period)}`).join('; '), r.late, r.balance, ACCOUNT_LABEL[r.status]]
      }))

  const error = students.error || fees.error
  return (
    <>
      <PageHeader title="Mensualidades y pagos"
        actions={<>
          {lateTotal > 0 && <Button variant="secondary" icon={Eraser} onClick={() => setWaiveAll(true)}>Perdonar recargos…</Button>}
          <Button variant="secondary" icon={CalendarPlus} onClick={() => setGenerating(true)}>Generar mensualidades</Button>
          <Button variant="secondary" icon={Download} onClick={doExport} disabled={!rows.length}>Exportar</Button>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Cobrado este mes" value={money(totals.collected)} icon={TrendingUp} tone="ok" onClick={() => setView('pagos')} />
        <StatCard label="Vencido" value={money(totals.overdue)} icon={AlertTriangle} tone={totals.overdue ? 'bad' : undefined} hint={lateTotal > 0 ? `Incluye ${money(lateTotal)} de recargos` : undefined} onClick={() => { setView('alumnos'); setFilter('vencido') }} />
        <StatCard label="¿Beca? Por confirmar" value={money(totals.review)} icon={HelpCircle} hint={`${totals.reviewCount} cargos por revisar`} onClick={() => { setView('alumnos'); setFilter('por_confirmar') }} />
        <StatCard label="Becado este mes" value={money(totals.scholarshipMonth)} icon={GraduationCap} hint={`Temporada: ${money(totals.scholarshipAll)}`} onClick={() => setView('resumen')} />
        <StatCard label="Total pendiente" value={money(totals.pending)} icon={Wallet} onClick={() => { setView('alumnos'); setFilter('pendiente') }} />
      </div>

      <div className="mb-4"><Segmented value={view} onChange={setView} options={[{ id: 'alumnos', label: 'Por alumno' }, { id: 'resumen', label: 'Por categoría y periodo' }, { id: 'pagos', label: 'Pagos recibidos' }]} /></div>

      {error ? <ErrorState error={error} onRetry={() => { students.refetch(); fees.refetch() }} /> :
        (students.isLoading || fees.isLoading) ? <Spinner /> :
        view === 'alumnos' ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {([['vencido', 'Vencidos'], ['por_confirmar', '¿Beca? Por confirmar'], ['por_vencer', 'Por vencer'], ['pendiente', 'Con saldo'], ['al_corriente', 'Al corriente'], ['todos', 'Todos']] as [Filter, string][]).map(([id, label]) => (
                <button key={id} onClick={() => setFilter(id)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium ${filter === id ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted hover:text-white'}`}>{label}</button>
              ))}
            </div>
            <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_200px]">
              <SearchInput value={q} onChange={setQ} placeholder="Buscar alumno o tutor" />
              <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
                <option value="">Todas las categorías</option>
                {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Periodo">
                <option value="">Todos los meses</option>
                {periods.map((p) => <option key={p} value={p}>{monthName(p)}</option>)}
              </Select>
            </div>
            {rows.length === 0 ? (
              <Card><Empty icon={CheckCircle2} title={filter === 'vencido' ? 'Nadie tiene pagos vencidos' : 'Sin resultados'}
                text={(fees.data ?? []).length === 0 ? 'Aún no hay mensualidades. Genera las del mes con un clic.' : 'Prueba con otro filtro.'}
                action={(fees.data ?? []).length === 0 ? <Button icon={CalendarPlus} onClick={() => setGenerating(true)}>Generar mensualidades</Button> : undefined} /></Card>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => {
                  const g = primaryGuardian(r.s)
                  return (
                    <li key={r.s.id}>
                      <Card className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:p-4">
                        <Link to={`/alumnos/${r.s.id}?tab=pagos`} className="flex min-w-0 flex-1 items-center gap-3">
                          <Avatar name={r.s.full_name} path={r.s.photo_path} size={42} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.s.full_name}</p>
                            <p className="truncate text-xs text-muted">
                              {catName(r.s.category_id)} · {r.open.length ? r.open.map((f) => `${f.concept} ${monthName(f.period)}`).join(', ') : 'Al corriente'}
                            </p>
                            {r.late > 0 && <p className="text-xs text-bad">Incluye {money(r.late)} de recargo</p>}
                            {!g && r.balance > 0 && <p className="text-xs text-warn">Falta WhatsApp de papá o mamá</p>}
                          </div>
                        </Link>
                        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                          <div className="text-right">
                            <p className="font-display text-xl font-bold">{money(r.balance)}</p>
                            {r.toReview.length > 0 ? (
                              <button onClick={() => setReviewing({ fee: r.toReview[0], name: r.s.full_name })} title="Confirmar beca o adeudo" className="hover:opacity-80">
                                <Badge tone="warn" className="cursor-pointer underline decoration-dotted">¿Beca? Por confirmar</Badge>
                              </button>
                            ) : <Badge tone={feeTone(r.status)}>{ACCOUNT_LABEL[r.status]}</Badge>}
                          </div>
                          {r.balance > 0 && (
                            <div className="flex gap-2">
                              {r.toReview.length > 0 && <Button icon={HelpCircle} onClick={() => setReviewing({ fee: r.toReview[0], name: r.s.full_name })}>¿Beca?</Button>}
                              {r.collectible > 0 && <CollectButton student={r.s} size="md" />}
                              <Button variant="secondary" icon={Receipt} onClick={() => setPaying(r.s)}>Pago</Button>
                            </div>
                          )}
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : view === 'resumen' ? <Summary open={totals.open} all={fees.data ?? []} students={students.data ?? []} catName={catName} /> : (
          <PaymentsList students={students.data ?? []} fees={fees.data ?? []} />
        )}

      {paying && <PaymentModal student={paying} onClose={() => setPaying(null)} />}
      {reviewing && <ScholarshipReviewModal fee={reviewing.fee} studentName={reviewing.name} onClose={() => setReviewing(null)} />}
      {waiveAll && <WaiveLateFeesModal fees={totals.lateFees} names={new Map((students.data ?? []).map((x) => [x.id, x.full_name]))} onClose={() => setWaiveAll(false)} />}
      {generating && <GenerateMonthModal students={students.data ?? []} onClose={() => setGenerating(false)} />}
    </>
  )
}

function Summary({ open, all, students, catName }: { open: FeeBalance[]; all: FeeBalance[]; students: StudentRow[]; catName: (id: string | null) => string }) {
  const catOf = new Map(students.map((s) => [s.id, s.category_id]))
  const byCat = new Map<string, { n: Set<string>; total: number; overdue: number }>()
  const byPeriod = new Map<string, { n: number; total: number }>()
  for (const f of open) {
    const k = catOf.get(f.student_id) ?? ''
    const c = byCat.get(k) ?? { n: new Set(), total: 0, overdue: 0 }
    c.n.add(f.student_id); c.total += Number(f.balance); if (f.status === 'vencido') c.overdue += Number(f.balance)
    byCat.set(k, c)
    const p = byPeriod.get(f.period) ?? { n: 0, total: 0 }
    p.n++; p.total += Number(f.balance)
    byPeriod.set(f.period, p)
  }
  const becas = new Map<string, { n: Set<string>; months: Map<string, number>; total: number }>()
  const becaMonths = [...new Set(all.filter((f) => Number(f.discount) > 0).map((f) => f.period))].sort()
  for (const f of all) {
    if (!(Number(f.discount) > 0)) continue
    const k = catOf.get(f.student_id) ?? ''
    const b = becas.get(k) ?? { n: new Set(), months: new Map(), total: 0 }
    b.n.add(f.student_id); b.total += Number(f.discount)
    b.months.set(f.period, (b.months.get(f.period) ?? 0) + Number(f.discount))
    becas.set(k, b)
  }
  const becaTotal = [...becas.values()].reduce((a, b) => a + b.total, 0)
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2"><CategoryResults /></div>
      <Card className="overflow-x-auto lg:col-span-2">
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Becas · total {money(becaTotal)}</h3>
        <table className="table-base">
          <thead><tr><th>Categoría</th><th>Becados</th>{becaMonths.map((m) => <th key={m}>{monthName(m)}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {[...becas.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => (
              <tr key={k}><td>{catName(k || null)}</td><td>{v.n.size}</td>{becaMonths.map((m) => <td key={m}>{money(v.months.get(m) ?? 0)}</td>)}<td className="font-semibold text-ok">{money(v.total)}</td></tr>
            ))}
            {becas.size === 0 && <tr><td colSpan={3 + becaMonths.length} className="py-8 text-center text-muted">Aún no hay becas confirmadas. Revisa los cargos "¿Beca? Por confirmar".</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-x-auto">
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Adeudos por categoría</h3>
        <table className="table-base">
          <thead><tr><th>Categoría</th><th>Alumnos</th><th>Vencido</th><th>Total</th></tr></thead>
          <tbody>
            {[...byCat.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => (
              <tr key={k}><td>{catName(k || null)}</td><td>{v.n.size}</td><td className="text-bad">{money(v.overdue)}</td><td className="font-semibold">{money(v.total)}</td></tr>
            ))}
            {byCat.size === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">Sin adeudos.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-x-auto">
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Adeudos por periodo</h3>
        <table className="table-base">
          <thead><tr><th>Mes</th><th>Cargos abiertos</th><th>Total</th></tr></thead>
          <tbody>
            {[...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => (
              <tr key={k}><td>{monthName(k)}</td><td>{v.n}</td><td className="font-semibold">{money(v.total)}</td></tr>
            ))}
            {byPeriod.size === 0 && <tr><td colSpan={3} className="py-8 text-center text-muted">Sin adeudos.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function PaymentsList({ students, fees }: { students: StudentRow[]; fees: FeeBalance[] }) {
  const payments = usePayments()
  const [month, setMonth] = useState(toISODate(startOfMonth(new Date())).slice(0, 7))
  const list = (payments.data ?? []).filter((p) => p.paid_at.startsWith(month))
  const total = list.reduce((a, p) => a + Number(p.amount), 0)
  const name = (id: string) => students.find((s) => s.id === id)?.full_name ?? '—'
  const fee = (id: string) => fees.find((f) => f.id === id)
  return (
    <Card className="overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-600 px-5 py-4">
        <h3 className="font-display text-lg font-bold uppercase tracking-wide">Pagos de {monthName(month + '-01')} · <span className="text-ok">{money(total)}</span></h3>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm" aria-label="Mes" />
          <Button size="sm" variant="secondary" icon={Download} disabled={!list.length}
            onClick={() => exportCsv(`pagos-${month}.csv`, ['Fecha', 'Alumno', 'Concepto', 'Importe', 'Método', 'Notas'],
              list.map((p) => { const f = fee(p.fee_id); return [p.paid_at, name(p.student_id), f ? `${f.concept} ${monthName(f.period)}` : '', p.amount, METHOD_LABEL[p.method], p.notes] }))}>Exportar</Button>
        </div>
      </div>
      {payments.isLoading ? <Spinner /> : (
        <table className="table-base min-w-[560px]">
          <thead><tr><th>Fecha</th><th>Alumno</th><th>Concepto</th><th>Método</th><th className="text-right">Importe</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const f = fee(p.fee_id)
              return (
                <tr key={p.id}>
                  <td>{shortDate(p.paid_at)}</td>
                  <td><Link to={`/alumnos/${p.student_id}?tab=pagos`} className="hover:text-brand">{name(p.student_id)}</Link></td>
                  <td className="text-muted">{f ? `${f.concept} ${monthName(f.period)}` : ''}</td>
                  <td>{METHOD_LABEL[p.method]}</td>
                  <td className="text-right font-semibold">{money(p.amount)}</td>
                </tr>
              )
            })}
            {!list.length && <tr><td colSpan={5} className="py-8 text-center text-muted">Sin pagos en {date(month + '-01', 'MMMM yyyy')}.</td></tr>}
          </tbody>
        </table>
      )}
    </Card>
  )
}
