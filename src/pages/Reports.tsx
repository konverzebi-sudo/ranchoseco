import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, ChevronRight, Download } from 'lucide-react'
import { Avatar, Badge, Button, Card, ErrorState, PageHeader, SearchInput, Select, Spinner } from '@/components/ui'
import { useCategories, useReports, useStudents, useEvaluationCounts } from '@/lib/api'
import { date } from '@/lib/format'
import { periodLabel } from '@/pdf/reportData'
import { signedUrl, BUCKETS } from '@/lib/supabase'
import { useToast } from '@/components/toast'
import CategoryResults from '@/components/CategoryResults'
import ReportHighlights from '@/components/ReportHighlights'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Reports() {
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
    <>
      <PageHeader title="Reportes" subtitle="Resultados por categoría y reportes PDF de cada jugador." />
      <div className="mb-6"><CategoryResults /></div>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Reporte PDF por jugador</h2>
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
      <ReportHighlights />
    </>
  )
}
