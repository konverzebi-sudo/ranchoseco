import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileText, ChevronRight, Download, ArrowLeft, PiggyBank } from 'lucide-react'
import { Avatar, Badge, Button, Card, ErrorState, Input, PageHeader, SearchInput, Select, Spinner, StatCard } from '@/components/ui'
import { useCategories, useReports, useStudents, useEvaluationCounts } from '@/lib/api'
import { date, money, today } from '@/lib/format'
import { periodLabel } from '@/pdf/reportData'
import { signedUrl, BUCKETS } from '@/lib/supabase'
import { useToast } from '@/components/toast'
import CategoryResults, { useCategoryResults } from '@/components/CategoryResults'
import { HighlightCard, SECTIONS, useMonthHighlights } from '@/components/ReportHighlights'
import { monthLabel } from '@/components/FinanceModules'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Reportes: módulos resumidos; al tocar uno se abre su desglose. */
export default function Reports() {
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : today().slice(0, 7)
  const view = params.get('ver') ?? ''
  const go = (ver: string) => setParams(ver ? { mes: month, ver } : { mes: month })
  const setMonth = (m: string) => setParams(view ? { mes: m, ver: view } : { mes: m }, { replace: true })

  const { data: results } = useCategoryResults(month)
  const { h, render } = useMonthHighlights(month)
  const reports = useReports()
  const students = useStudents()
  const evalCounts = useEvaluationCounts()

  const section = SECTIONS.find((s) => s.key === view)
  const title = view === 'ganancia' ? 'Ganancia real por categoría' : view === 'pdf' ? 'Reporte PDF por jugador' : section?.title

  if (view && title) {
    return (
      <>
        <button onClick={() => go('')} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> Reportes</button>
        <PageHeader title={title} subtitle={view === 'pdf' ? 'Genera y descarga el reporte de cada jugador.' : `Desglose de ${monthLabel(month)}`}
          actions={view !== 'ganancia' && view !== 'pdf' ? <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-10 w-44" aria-label="Mes" /> : undefined} />
        {view === 'ganancia' && <CategoryResults key={month} initialMonth={month} />}
        {view === 'pdf' && <PdfPlayers />}
        {section && (!h ? <Spinner /> : <HighlightCard title={section.title} text={section.text} icon={section.icon} tone={section.tone} items={h[section.key]} render={render} expanded />)}
      </>
    )
  }

  const activeCount = (students.data ?? []).filter((s) => s.status === 'activo').length
  const evaluated = (students.data ?? []).filter((s) => s.status === 'activo' && evalCounts.data?.get(s.id)).length
  const monthReports = (reports.data ?? []).filter((r) => r.created_at.startsWith(month)).length

  return (
    <>
      <PageHeader title="Reportes" subtitle="Toca un módulo para ver su desglose."
        actions={<Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-10 w-44" aria-label="Mes" />} />

      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Dinero · {monthLabel(month)}</h2>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Ganancia real por categoría" icon={PiggyBank} tone={results && results.totals.result < 0 ? 'bad' : 'ok'}
          value={results ? money(Math.round(results.totals.result)) : '…'}
          hint={results ? `Ingreso ${money(Math.round(results.totals.income))} − gastos ${money(Math.round(results.totals.generalExpenses))} − sueldos ${money(Math.round(results.totals.salaries))}` : 'Calculando…'}
          onClick={() => go('ganancia')} />
        <StatCard label="Reporte PDF por jugador" icon={FileText} value={monthReports}
          hint={`PDF generados en el mes · ${evaluated} de ${activeCount} jugadores evaluados`} onClick={() => go('pdf')} />
      </div>

      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Listas del mes · {monthLabel(month)}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const items = h?.[s.key] ?? []
          const names = items.map(render).filter(Boolean).slice(0, 3).map((r) => r!.name.split(' ')[0])
          return (
            <StatCard key={s.key} label={s.title} icon={s.icon} tone={s.tone === 'bad' ? 'bad' : s.tone === 'ok' ? 'ok' : 'brand'}
              value={h ? items.length : '…'}
              hint={!h ? 'Calculando…' : items.length ? `${names.join(', ')}${items.length > 3 ? ` y ${items.length - 3} más` : ''}` : 'Nadie este mes'}
              onClick={() => go(s.key)} />
          )
        })}
      </div>
    </>
  )
}

/** Lista de jugadores para generar su PDF y los reportes recientes. */
function PdfPlayers() {
  const students = useStudents()
  const categories = useCategories()
  const reports = useReports()
  const toast = useToast()
  const evalCounts = useEvaluationCounts()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const lastReport = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of reports.data ?? []) if (!m.has(r.student_id)) m.set(r.student_id, r.created_at)
    return m
  }, [reports.data])
  const list = (students.data ?? []).filter((s) => s.status === 'activo' && (!cat || s.category_id === cat) && (!q || norm(s.full_name).includes(norm(q))))
  const name = (id: string) => students.data?.find((s) => s.id === id)?.full_name ?? '—'
  const open = async (path: string) => {
    const url = await signedUrl(BUCKETS.reports, path, 300)
    if (url) window.open(url, '_blank', 'noopener'); else toast.error('No se encontró el archivo.')
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_200px]">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar jugador" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {students.error ? <ErrorState error={students.error} /> : students.isLoading ? <Spinner /> : (
          <ul className="space-y-2">
            {list.map((s) => (
              <li key={s.id}>
                <Link to={`/alumnos/${s.id}?tab=reportes`}>
                  <Card className="flex items-center gap-3 p-3 hover:border-ink-500">
                    <Avatar name={s.full_name} path={s.photo_path} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.full_name}</p>
                      <p className="text-xs text-muted">{categories.data?.find((c) => c.id === s.category_id)?.name ?? 'Sin categoría'} · {lastReport.has(s.id) ? `Último reporte ${date(lastReport.get(s.id)!.slice(0, 10))}` : 'Sin reportes'}</p>
                    </div>
                    {evalCounts.data && (evalCounts.data.get(s.id) ? <Badge tone="ok" className="hidden sm:inline-flex">{evalCounts.data.get(s.id)} eval.</Badge> : <Badge className="hidden sm:inline-flex">Sin evaluar</Badge>)}
                    <ChevronRight className="h-5 w-5 text-muted" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Card className="h-fit">
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Generados recientemente</h3>
        {!reports.data?.length ? <p className="px-5 py-8 text-center text-sm text-muted">Aún no hay reportes.</p> : (
          <ul className="divide-y divide-ink-700">
            {reports.data.slice(0, 20).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <FileText className="h-5 w-5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name(r.student_id)}</p>
                  <p className="truncate text-xs text-muted">{periodLabel(r.period_from, r.period_to)}</p>
                </div>
                {r.file_path && <Button size="sm" variant="ghost" icon={Download} onClick={() => open(r.file_path!)} aria-label="Abrir PDF" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
