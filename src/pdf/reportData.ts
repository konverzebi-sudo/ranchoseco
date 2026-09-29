import { supabase, unwrap, signedUrl, BUCKETS } from '@/lib/supabase'
import { attendanceRate } from '@/lib/stats'
import { date as fmtDate } from '@/lib/format'
import type { AttendanceStatus, Evaluation } from '@/lib/types'

export interface ReportData {
  academyName: string
  student: { name: string; category: string; coach: string; birthDate: string | null; photoUrl: string | null }
  from: string
  to: string
  periodLabel: string
  attendance: { total: number; present: number; late: number; absent: number; justified: number; rate: number | null }
  trainingsCount: number
  trainings: { date: string; objectives: string | null }[]
  matches: { date: string; opponent: string; goalsFor: number | null; goalsAgainst: number | null; starter: boolean; position: string | null; goals: number; assists: number; minutes: number }[]
  evaluations: Evaluation[]
  generatedAt: string
}

export const periodLabel = (from: string, to: string) => `${fmtDate(from)} al ${fmtDate(to)}`

export function summarizeAttendance(rows: { status: AttendanceStatus | string }[]) {
  return {
    total: rows.length,
    present: rows.filter((r) => r.status === 'presente').length,
    late: rows.filter((r) => r.status === 'retardo').length,
    absent: rows.filter((r) => r.status === 'falta').length,
    justified: rows.filter((r) => r.status === 'justificada').length,
    rate: attendanceRate(rows),
  }
}

/** Reúne desde la base de datos toda la información del reporte de un alumno. */
export async function loadReportData(studentId: string, from: string, to: string): Promise<ReportData> {
  const student = unwrap(await supabase.from('students').select('*').eq('id', studentId).single()) as {
    full_name: string; birth_date: string | null; category_id: string | null; coach_id: string | null; photo_path: string | null
  }
  const [settings, category, coaches, cc, att, trainings, mp, evals] = await Promise.all([
    supabase.from('settings').select('academy_name').eq('id', 1).single(),
    student.category_id ? supabase.from('categories').select('name').eq('id', student.category_id).single() : Promise.resolve({ data: null, error: null }),
    supabase.from('coaches').select('id, full_name'),
    student.category_id ? supabase.from('coach_categories').select('coach_id').eq('category_id', student.category_id) : Promise.resolve({ data: [], error: null }),
    supabase.from('attendance_detail').select('status, date').eq('student_id', studentId).gte('date', from).lte('date', to),
    student.category_id
      ? supabase.from('trainings').select('date, objectives').eq('category_id', student.category_id).gte('date', from).lte('date', to).order('date')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('match_players').select('*, matches!inner(date, opponent, goals_for, goals_against, status)').eq('student_id', studentId).eq('attended', true)
      .gte('matches.date', from).lte('matches.date', to),
    supabase.from('evaluations').select('*').eq('student_id', studentId).lte('date', to).order('date'),
  ])
  const coachList = (unwrap(coaches) ?? []) as { id: string; full_name: string }[]
  const coachIds = student.coach_id ? [student.coach_id] : ((unwrap(cc) ?? []) as { coach_id: string }[]).map((x) => x.coach_id)
  const coachName = coachIds.map((id) => coachList.find((c) => c.id === id)?.full_name).filter(Boolean).join(', ')

  const matches = ((unwrap(mp) ?? []) as any[])
    .map((r) => ({
      date: r.matches.date, opponent: r.matches.opponent, goalsFor: r.matches.goals_for, goalsAgainst: r.matches.goals_against,
      starter: r.starter, position: r.position, goals: r.goals, assists: r.assists, minutes: r.minutes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    academyName: (unwrap(settings) as { academy_name: string }).academy_name,
    student: {
      name: student.full_name,
      category: (category.data as { name: string } | null)?.name ?? 'Sin categoría',
      coach: coachName || '—',
      birthDate: student.birth_date,
      photoUrl: student.photo_path ? await signedUrl(BUCKETS.photos, student.photo_path, 600) : null,
    },
    from, to, periodLabel: periodLabel(from, to),
    attendance: summarizeAttendance((unwrap(att) ?? []) as { status: string }[]),
    trainingsCount: ((unwrap(trainings) ?? []) as unknown[]).length,
    trainings: (unwrap(trainings) ?? []) as { date: string; objectives: string | null }[],
    matches,
    evaluations: (unwrap(evals) ?? []) as Evaluation[],
    generatedAt: new Date().toISOString(),
  }
}

export function reportFilename(d: ReportData) {
  const slug = d.student.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `Reporte-${slug}-${d.to.slice(0, 7)}.pdf`
}

/** Genera el PDF (la librería se carga sólo cuando se necesita). */
export async function renderReportPdf(data: ReportData): Promise<Blob> {
  const [{ pdf }, { ReportDocument }] = await Promise.all([import('@react-pdf/renderer'), import('./ReportDocument')])
  const logo = new URL(`${import.meta.env.BASE_URL}escudo.png`, window.location.href).href
  return pdf(ReportDocument({ data, logo })).toBlob()
}
