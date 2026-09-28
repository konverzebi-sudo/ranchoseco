import type { AttendanceDetail, Evaluation, SkillKey } from './types'
import { SKILL_GROUPS } from './types'

/** Porcentaje de asistencia: presente y retardo cuentan como asistencia. */
export function attendanceRate(rows: { status: string }[]) {
  if (!rows.length) return null
  const ok = rows.filter((r) => r.status === 'presente' || r.status === 'retardo').length
  return Math.round((ok / rows.length) * 100)
}

/** Faltas consecutivas más recientes por alumno (las justificadas no rompen ni suman la racha). */
export function consecutiveAbsences(rows: Pick<AttendanceDetail, 'student_id' | 'date' | 'status' | 'start_time'>[]) {
  const byStudent = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byStudent.get(r.student_id) ?? []
    list.push(r)
    byStudent.set(r.student_id, list)
  }
  const out = new Map<string, number>()
  for (const [id, list] of byStudent) {
    list.sort((a, b) => (b.date + (b.start_time ?? '')).localeCompare(a.date + (a.start_time ?? '')))
    let n = 0
    for (const r of list) {
      if (r.status === 'falta') n++
      else if (r.status === 'justificada') continue
      else break
    }
    out.set(id, n)
  }
  return out
}

export function groupAverage(e: Evaluation, groupKey: string) {
  const g = SKILL_GROUPS.find((x) => x.key === groupKey)!
  const vals = g.skills.map(([k]) => Number(e[k as SkillKey]))
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
}

export function overallAverage(e: Evaluation) {
  const avgs = SKILL_GROUPS.map((g) => groupAverage(e, g.key))
  return Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10
}

/** Serie por evaluación con el promedio de cada área (para gráficas de evolución). */
export function evolutionSeries(evals: Evaluation[]) {
  return evals.map((e) => ({
    date: e.date,
    ...Object.fromEntries(SKILL_GROUPS.map((g) => [g.key, groupAverage(e, g.key)])),
    general: overallAverage(e),
  })) as ({ date: string; general: number } & Record<string, number>)[]
}
