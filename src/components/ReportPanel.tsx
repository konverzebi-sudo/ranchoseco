import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { FileText, Download, Share2, CheckCircle2, Info } from 'lucide-react'
import { Button, Card, Field, Input, Segmented } from './ui'
import { useToast } from './toast'
import { usePortalToken, useReports, useSettings, portalUrl, primaryGuardian, type StudentRow } from '@/lib/api'
import { loadReportData, renderReportPdf, reportFilename, periodLabel, type ReportData } from '@/pdf/reportData'
import { canShareFiles, downloadBlob, reportMessage, shareFile, waLink } from '@/lib/whatsapp'
import { supabase, signedUrl, BUCKETS } from '@/lib/supabase'
import { date, isValidPhone, toISODate } from '@/lib/format'

type Range = 'mes' | 'anterior' | 'trimestre' | 'otro'

function rangeDates(r: Range, from: string, to: string) {
  const now = new Date()
  if (r === 'mes') return [toISODate(startOfMonth(now)), toISODate(now)]
  if (r === 'anterior') { const p = subMonths(now, 1); return [toISODate(startOfMonth(p)), toISODate(endOfMonth(p))] }
  if (r === 'trimestre') return [toISODate(startOfMonth(subMonths(now, 2))), toISODate(now)]
  return [from, to]
}

export default function ReportPanel({ student }: { student: StudentRow }) {
  const { data: settings } = useSettings()
  const { data: token } = usePortalToken(student.id)
  const reports = useReports(student.id)
  const qc = useQueryClient()
  const toast = useToast()
  const [range, setRange] = useState<Range>('mes')
  const [custom, setCustom] = useState({ from: toISODate(startOfMonth(subMonths(new Date(), 5))), to: toISODate(new Date()) })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ blob: Blob; data: ReportData; file: File } | null>(null)
  const guardian = primaryGuardian(student)

  const generate = async () => {
    const [from, to] = rangeDates(range, custom.from, custom.to)
    if (from > to) return toast.error('La fecha inicial debe ser anterior a la final.')
    setBusy(true)
    setResult(null)
    try {
      const data = await loadReportData(student.id, from, to)
      const blob = await renderReportPdf(data)
      const name = reportFilename(data)
      setResult({ blob, data, file: new File([blob], name, { type: 'application/pdf' }) })
      // Guardar copia en el historial (si falla el almacenamiento, el PDF sigue disponible)
      const path = `${student.id}/${Date.now()}-${name}`
      const up = await supabase.storage.from(BUCKETS.reports).upload(path, blob, { contentType: 'application/pdf' })
      await supabase.from('reports').insert({ student_id: student.id, period_from: from, period_to: to, file_path: up.error ? null : path })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.ok('Reporte generado')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const message = result && settings
    ? reportMessage(settings.report_template, student.full_name, result.data.periodLabel, token ? portalUrl(token) : undefined)
    : ''

  const share = async () => {
    if (!result) return
    const r = await shareFile(result.file, message)
    if (r === 'shared') return toast.ok('Reporte compartido')
    if (r === 'cancelled') return
    // Escritorio o navegador sin soporte: descargar y abrir el chat del tutor con el mensaje listo
    downloadBlob(result.blob, result.file.name)
    if (guardian && isValidPhone(guardian.phone)) {
      window.open(waLink(guardian.phone, message), '_blank', 'noopener')
      toast.ok('PDF descargado. Adjúntalo en el chat de WhatsApp que se abrió.')
    } else toast.error('PDF descargado. Falta el WhatsApp del tutor para abrir el chat.')
  }

  const openStored = async (path: string) => {
    const url = await signedUrl(BUCKETS.reports, path, 300)
    if (url) window.open(url, '_blank', 'noopener')
    else toast.error('No se encontró el archivo.')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        <h3 className="font-display text-xl font-bold uppercase tracking-wide">Reporte para padres</h3>
        <p className="mt-1 text-sm text-muted">Incluye asistencia, entrenamientos, partidos, evaluación, gráficas de evolución y objetivos.</p>
        <div className="mt-5 space-y-4">
          <Segmented value={range} onChange={setRange} options={[
            { id: 'mes', label: 'Este mes' }, { id: 'anterior', label: 'Mes anterior' },
            { id: 'trimestre', label: 'Últimos 3 meses' }, { id: 'otro', label: 'Otro periodo' },
          ]} />
          {range === 'otro' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desde"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
              <Field label="Hasta"><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
            </div>
          )}
          <p className="text-sm text-muted">Periodo: {periodLabel(...(rangeDates(range, custom.from, custom.to) as [string, string]))}</p>
          <Button size="lg" icon={FileText} loading={busy} onClick={generate} className="w-full sm:w-auto">GENERAR REPORTE PDF</Button>
        </div>

        {result && (
          <div className="mt-6 rounded-2xl border border-ok/30 bg-ok/5 p-4">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-ok" /> {result.file.name}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button size="lg" variant="secondary" icon={Download} onClick={() => downloadBlob(result.blob, result.file.name)}>DESCARGAR PDF</Button>
              <Button size="lg" variant="whatsapp" icon={Share2} onClick={share}>COMPARTIR POR WHATSAPP</Button>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {canShareFiles()
                ? 'Se abrirá el menú de compartir de tu celular: elige WhatsApp y el contacto del tutor. El mensaje va incluido.'
                : 'En computadora se descarga el PDF y se abre el chat del tutor con el mensaje listo; sólo arrastra el PDF al chat.'}
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Historial</h3>
        {reports.data?.length ? (
          <ul className="divide-y divide-ink-700">
            {reports.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <FileText className="h-5 w-5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">{periodLabel(r.period_from, r.period_to)}</p>
                  <p className="text-xs text-muted">Generado {date(r.created_at.slice(0, 10))}</p>
                </div>
                {r.file_path && <Button size="sm" variant="ghost" icon={Download} onClick={() => openStored(r.file_path!)} aria-label="Abrir PDF" />}
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-8 text-center text-sm text-muted">Aún no se han generado reportes.</p>}
      </Card>
    </div>
  )
}
