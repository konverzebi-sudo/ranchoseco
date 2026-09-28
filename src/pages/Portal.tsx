import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { startOfMonth, subMonths } from 'date-fns'
import { CalendarDays, Wallet, TrendingUp, ClipboardCheck, Trophy, FileDown, Dumbbell, MapPin, ShieldX, Target } from 'lucide-react'
import { Badge, Button, Card, Spinner, Segmented, feeTone } from '@/components/ui'
import { EvolutionChart, GroupSummary } from '@/components/Evaluation'
import { useToast } from '@/components/toast'
import { LOGO } from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { ATTENDANCE_LABEL, FEE_LABEL, METHOD_LABEL, age, date, money, monthName, time, toISODate, today } from '@/lib/format'
import { attendanceRate } from '@/lib/stats'
import { downloadBlob } from '@/lib/whatsapp'
import { periodLabel, renderReportPdf, reportFilename, summarizeAttendance, type ReportData } from '@/pdf/reportData'
import type { AttendanceStatus, Evaluation, FeeStatus, PaymentMethod } from '@/lib/types'

interface PortalData {
  student: { id: string; full_name: string; birth_date: string | null; category: string | null; schedule: string | null; coach: string | null; enrolled_at: string; status: string }
  academy: { name: string; payment_instructions: string }
  upcoming_trainings: { date: string; start_time: string | null; end_time: string | null; objectives: string | null }[]
  upcoming_matches: { date: string; time: string | null; opponent: string; venue: string | null; is_home: boolean }[]
  attendance: { date: string; status: AttendanceStatus }[]
  fees: { id: string; concept: string; period: string; amount: number; paid: number; balance: number; due_date: string; status: FeeStatus }[]
  payments: { amount: number; paid_at: string; method: PaymentMethod; concept: string; period: string }[]
  evaluations: (Evaluation & { coach: string | null })[]
  matches: { date: string; opponent: string; goals_for: number | null; goals_against: number | null; status: string; starter: boolean; position: string | null; goals: number; assists: number; minutes: number }[]
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

const ATT_TONE: Record<AttendanceStatus, 'ok' | 'bad' | 'info' | 'warn'> = { presente: 'ok', falta: 'bad', justificada: 'info', retardo: 'warn' }

function Section({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold uppercase tracking-wide"><Icon className="h-5 w-5 text-brand" /> {title}</h2>
      {children}
    </Card>
  )
}

export default function Portal() {
  const { token } = useParams()
  const toast = useToast()
  const [range, setRange] = useState<'mes' | 'trimestre'>('mes')
  const [busy, setBusy] = useState(false)
  const q = useQuery({
    queryKey: ['portal-view', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_portal', { p_token: token })
      if (error) throw new Error(error.message)
      return data as PortalData | null
    },
    retry: 1,
  })

  if (q.isLoading) return <div className="min-h-dvh bg-ink"><Spinner label="Cargando información…" /></div>
  if (q.error || !q.data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <img src={LOGO} alt="Escudo Deportivo Rancho Seco" className="h-24 w-24" />
        <ShieldX className="mt-6 h-8 w-8 text-muted" />
        <h1 className="mt-3 font-display text-2xl font-bold uppercase">{q.error ? 'No se pudo cargar' : 'Este enlace no es válido'}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">{q.error ? 'Revisa tu conexión e inténtalo de nuevo.' : 'Pudo haber sido reemplazado por uno nuevo. Pide a la academia el enlace actualizado.'}</p>
        {q.error && <Button className="mt-4" onClick={() => q.refetch()}>Reintentar</Button>}
      </div>
    )
  }

  const d = q.data
  const s = d.student
  const balance = d.fees.reduce((t, f) => t + Number(f.balance), 0)
  const openFees = d.fees.filter((f) => Number(f.balance) > 0)
  const overdue = openFees.some((f) => f.status === 'vencido')
  const since = toISODate(subMonths(new Date(), 3))
  const recentAtt = d.attendance.filter((a) => a.date >= since)
  const rate = attendanceRate(recentAtt)
  const latest = d.evaluations.at(-1)
  const goals = d.matches.reduce((t, m) => t + m.goals, 0)
  const agenda = [
    ...d.upcoming_trainings.map((t) => ({ kind: 'tr' as const, date: t.date, time: t.start_time, title: t.objectives || 'Entrenamiento', sub: t.end_time ? `${time(t.start_time)}–${time(t.end_time)}` : time(t.start_time) })),
    ...d.upcoming_matches.map((m) => ({ kind: 'ma' as const, date: m.date, time: m.time, title: `Partido vs ${m.opponent}`, sub: [time(m.time), m.venue, m.is_home ? 'Local' : 'Visitante'].filter(Boolean).join(' · ') })),
  ].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))).slice(0, 8)

  const downloadReport = async () => {
    setBusy(true)
    try {
      const to = today()
      const from = toISODate(startOfMonth(range === 'mes' ? new Date() : subMonths(new Date(), 2)))
      const att = d.attendance.filter((a) => a.date >= from && a.date <= to)
      const data: ReportData = {
        academyName: d.academy.name,
        student: { name: s.full_name, category: s.category ?? 'Sin categoría', coach: s.coach ?? '—', birthDate: s.birth_date, photoUrl: null },
        from, to, periodLabel: periodLabel(from, to),
        attendance: summarizeAttendance(att),
        trainingsCount: att.length,
        trainings: [],
        matches: d.matches.filter((m) => m.date >= from && m.date <= to).map((m) => ({
          date: m.date, opponent: m.opponent, goalsFor: m.goals_for, goalsAgainst: m.goals_against, starter: m.starter, position: m.position, goals: m.goals, assists: m.assists, minutes: m.minutes,
        })),
        evaluations: d.evaluations.filter((e) => e.date <= to),
        generatedAt: new Date().toISOString(),
      }
      const blob = await renderReportPdf(data)
      downloadBlob(blob, reportFilename(data))
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-ink pb-10">
      <header className="border-b-4 border-brand bg-ink-900">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-5">
          <img src={LOGO} alt="Escudo Deportivo Rancho Seco" className="h-16 w-16" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Seguimiento del jugador</p>
            <h1 className="font-display text-3xl font-bold uppercase leading-tight">{s.full_name}</h1>
            <p className="text-sm text-muted">
              {s.category ? `Categoría ${s.category}` : 'Sin categoría'}{age(s.birth_date) != null ? ` · ${age(s.birth_date)} años` : ''}{s.coach ? ` · Profe ${s.coach}` : ''}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-5">
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3 text-center"><p className="text-[11px] uppercase tracking-wider text-muted">Asistencia</p><p className="font-display text-3xl font-bold text-brand">{rate != null ? `${rate}%` : '—'}</p></Card>
          <Card className="p-3 text-center"><p className="text-[11px] uppercase tracking-wider text-muted">Partidos</p><p className="font-display text-3xl font-bold">{d.matches.length}</p></Card>
          <Card className="p-3 text-center"><p className="text-[11px] uppercase tracking-wider text-muted">Goles</p><p className="font-display text-3xl font-bold">{goals}</p></Card>
        </div>

        <Section icon={Wallet} title="Estado de cuenta">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted">{balance > 0 ? 'Saldo pendiente' : 'Todo pagado'}</p>
              <p className={`font-display text-4xl font-bold ${balance > 0 ? (overdue ? 'text-bad' : 'text-brand') : 'text-ok'}`}>{money(balance)}</p>
            </div>
            <Badge tone={balance > 0 ? (overdue ? 'bad' : 'info') : 'ok'}>{balance > 0 ? (overdue ? 'Vencido' : 'Pendiente') : 'Al corriente'}</Badge>
          </div>
          {openFees.length > 0 && (
            <ul className="mt-4 space-y-2">
              {openFees.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-xl bg-ink-900 px-3 py-2.5 text-sm">
                  <div><p className="font-medium">{f.concept} {monthName(f.period)}</p><p className="text-xs text-muted">Vence {date(f.due_date)}</p></div>
                  <div className="text-right"><p className="font-semibold">{money(f.balance)}</p><Badge tone={feeTone(f.status)}>{FEE_LABEL[f.status]}</Badge></div>
                </li>
              ))}
            </ul>
          )}
          {d.academy.payment_instructions && balance > 0 && (
            <div className="mt-4 rounded-xl border border-brand/30 bg-brand-dim p-3 text-sm whitespace-pre-line"><p className="mb-1 font-semibold text-brand">Cómo pagar</p>{d.academy.payment_instructions}</div>
          )}
          {d.payments.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted hover:text-white">Historial de pagos ({d.payments.length})</summary>
              <ul className="mt-2 divide-y divide-ink-700">
                {d.payments.map((p, i) => (
                  <li key={i} className="flex justify-between py-2"><span>{date(p.paid_at)} · {p.concept} {monthName(p.period)} <span className="text-muted">({METHOD_LABEL[p.method]})</span></span><span className="font-semibold text-ok">{money(p.amount)}</span></li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        <Section icon={CalendarDays} title="Próximas actividades">
          {s.schedule && <p className="mb-3 text-sm text-muted">Horario habitual: <span className="text-white">{s.schedule}</span></p>}
          {agenda.length === 0 ? <p className="text-sm text-muted">No hay actividades programadas por ahora.</p> : (
            <ul className="space-y-2">
              {agenda.map((a, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl bg-ink-900 p-3">
                  <div className={`rounded-lg p-2 ${a.kind === 'ma' ? 'bg-brand text-ink' : 'bg-ink-700 text-brand'}`}>{a.kind === 'ma' ? <Trophy className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}</div>
                  <div className="min-w-0"><p className="font-medium">{a.title}</p><p className="text-xs text-muted">{cap(date(a.date, "EEEE d 'de' MMMM"))}{a.sub ? ` · ${a.sub}` : ''}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={TrendingUp} title="Avance deportivo">
          {!latest ? <p className="text-sm text-muted">Aún no hay evaluaciones. El profesor registrará el avance próximamente.</p> : (
            <div className="space-y-4">
              <p className="text-sm text-muted">Última evaluación: {date(latest.date)}{latest.coach ? ` · ${latest.coach}` : ''}</p>
              <GroupSummary evaluation={latest} />
              {d.evaluations.length > 1 && <EvolutionChart evaluations={d.evaluations} height={220} />}
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {latest.strengths && <div className="rounded-xl bg-ink-900 p-3"><p className="mb-1 font-semibold text-ok">Fortalezas</p>{latest.strengths}</div>}
                {latest.improvements && <div className="rounded-xl bg-ink-900 p-3"><p className="mb-1 font-semibold text-warn">Áreas de mejora</p>{latest.improvements}</div>}
                {latest.goals && <div className="rounded-xl bg-ink-900 p-3 sm:col-span-2"><p className="mb-1 flex items-center gap-1.5 font-semibold text-brand"><Target className="h-4 w-4" /> Objetivos</p>{latest.goals}</div>}
                {latest.comments && <div className="rounded-xl bg-ink-900 p-3 sm:col-span-2"><p className="mb-1 font-semibold">Comentarios del profesor</p>{latest.comments}</div>}
              </div>
            </div>
          )}
        </Section>

        <Section icon={ClipboardCheck} title="Asistencias">
          {d.attendance.length === 0 ? <p className="text-sm text-muted">Sin registros de asistencia todavía.</p> : (
            <>
              <p className="mb-3 text-sm text-muted">Últimos 3 meses: <span className="font-semibold text-white">{rate != null ? `${rate}%` : '—'}</span> ({recentAtt.length} entrenamientos)</p>
              <div className="flex flex-wrap gap-2">
                {d.attendance.slice(0, 16).map((a, i) => (
                  <div key={i} className="rounded-xl bg-ink-900 px-3 py-2 text-center">
                    <p className="text-xs text-muted">{date(a.date, 'd MMM')}</p>
                    <Badge tone={ATT_TONE[a.status]} className="mt-1">{ATTENDANCE_LABEL[a.status]}</Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        {d.matches.length > 0 && (
          <Section icon={Trophy} title="Partidos">
            <ul className="divide-y divide-ink-700 text-sm">
              {d.matches.slice(0, 10).map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2.5">
                  <div><p className="font-medium">vs {m.opponent} {m.goals_for != null && <span className="text-muted">({m.goals_for}-{m.goals_against})</span>}</p>
                    <p className="text-xs text-muted">{date(m.date)} · {m.starter ? 'Titular' : 'Suplente'}{m.position ? ` · ${m.position}` : ''} · {m.minutes} min</p></div>
                  {m.goals > 0 && <Badge tone="brand">{m.goals} gol{m.goals > 1 ? 'es' : ''}</Badge>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section icon={FileDown} title="Reporte en PDF">
          <p className="mb-3 text-sm text-muted">Descarga el reporte deportivo con asistencias, partidos y evaluación.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented value={range} onChange={setRange} options={[{ id: 'mes', label: 'Este mes' }, { id: 'trimestre', label: 'Últimos 3 meses' }]} />
            <Button icon={FileDown} loading={busy} onClick={downloadReport}>Descargar PDF</Button>
          </div>
        </Section>

        <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-xs text-ink-500"><MapPin className="h-3 w-3" /> {d.academy.name} · Fútbol rápido · Enlace personal, no lo compartas.</p>
      </main>
    </div>
  )
}
