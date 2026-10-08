import type { AttendanceDetail, Evaluation, FeeBalance, MatchPlayer, Payment } from './types'
import { overallAverage } from './stats'

/** Último día del mes para pagar sin retardo. */
export const ON_TIME_DAY = 8

export interface HighlightItem { student_id: string; note?: string }
export interface Highlights {
  allClasses: HighlightItem[]
  allMatches: HighlightItem[]
  onTime: HighlightItem[]
  improved: HighlightItem[]
  scholarshipLate: HighlightItem[]
  latePayment: HighlightItem[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Listas del mes para Reportes ('YYYY-MM'):
 * - Todas las clases: estuvo (presente o retardo) en todos los entrenamientos de su categoría en que se pasó lista.
 * - Todos los partidos: fue convocado al menos a uno y llegó a todos (los no convocados no cuentan).
 * - Pago puntual: su mensualidad está pagada y se pagó a más tardar el día 8.
 * - Mejoró: su última evaluación tiene mejor promedio que la anterior.
 * - Beca y no pagó a tiempo: tiene beca/descuento y pagó después del 8 este mes (o no ha pagado), o sigue debiendo meses anteriores.
 * - Retardo: pagó la última semana del mes o después (o sigue sin pagar ya en esa semana).
 */
export function monthHighlights(opts: {
  month: string
  today: string
  students: { id: string; category_id: string | null; status: string }[]
  attendance: AttendanceDetail[]
  matchPlayers: MatchPlayer[]
  fees: FeeBalance[]
  payments: Payment[]
  evaluations: Evaluation[]
}): Highlights {
  const { month, today, attendance, matchPlayers, fees, payments, evaluations } = opts
  const students = opts.students.filter((s) => s.status === 'activo')
  const ids = new Set(students.map((s) => s.id))
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const onTimeLimit = `${month}-${pad(ON_TIME_DAY)}`
  const lastWeek = `${month}-${pad(lastDay - 6)}`

  // Entrenamientos con lista por categoría y asistencias de cada alumno
  const inMonth = attendance.filter((a) => a.date.startsWith(month))
  const taken = new Map<string, Set<string>>()
  for (const a of inMonth) taken.set(a.category_id, (taken.get(a.category_id) ?? new Set()).add(a.training_id))
  const present = new Map<string, Set<string>>()
  for (const a of inMonth) if (a.status === 'presente' || a.status === 'retardo') present.set(a.student_id, (present.get(a.student_id) ?? new Set()).add(a.training_id))
  const allClasses = students.flatMap((s) => {
    const t = s.category_id ? taken.get(s.category_id) : undefined
    const p = present.get(s.id)
    if (!t?.size || !p) return []
    return [...t].every((id) => p.has(id)) ? [{ student_id: s.id, note: `${t.size} de ${t.size} clases` }] : []
  })

  const calls = new Map<string, MatchPlayer[]>()
  for (const p of matchPlayers) if (ids.has(p.student_id)) calls.set(p.student_id, [...(calls.get(p.student_id) ?? []), p])
  const allMatches = [...calls.entries()].filter(([, l]) => l.every((p) => p.attended !== false))
    .map(([student_id, l]) => ({ student_id, note: `${l.length} de ${l.length} partidos` }))

  const period = `${month}-01`
  const monthly = fees.filter((f) => f.period === period && f.concept === 'Mensualidad' && ids.has(f.student_id))
  const paysOf = (feeId: string) => payments.filter((p) => p.fee_id === feeId).map((p) => p.paid_at.slice(0, 10)).sort()
  const lastPay = (f: FeeBalance) => paysOf(f.id).at(-1)
  const paid = (f: FeeBalance) => Number(f.balance) <= 0
  const fmt = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`

  const onTime = monthly.filter((f) => paid(f) && Number(f.amount) - Number(f.discount) > 0 && (lastPay(f) ?? '9999') <= onTimeLimit)
    .map((f) => ({ student_id: f.student_id, note: `Pagó el ${fmt(lastPay(f)!)}` }))

  // Con beca: siguen debiendo meses anteriores (no sólo el mes del reporte)…
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const owedBefore = fees.filter((f) => f.period < period && f.concept === 'Mensualidad' && ids.has(f.student_id) && Number(f.discount) > 0 && Number(f.balance) > 0)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((f) => ({ student_id: f.student_id, note: `${f.discount_reason ?? 'Beca'} · debe ${MES[Number(f.period.slice(5, 7)) - 1]} ($${Number(f.balance).toLocaleString('es-MX')})` }))
  // …o este mes pagaron tarde / no han pagado
  const lateThisMonth = monthly.filter((f) => Number(f.discount) > 0).flatMap((f) => {
    const lp = lastPay(f)
    if (paid(f)) return lp && lp > onTimeLimit ? [{ student_id: f.student_id, note: `${f.discount_reason ?? 'Beca'} · pagó el ${fmt(lp)}` }] : []
    return today > onTimeLimit ? [{ student_id: f.student_id, note: `${f.discount_reason ?? 'Beca'} · aún no paga` }] : []
  })
  const flags = new Map<string, string[]>()
  for (const x of [...owedBefore, ...lateThisMonth]) flags.set(x.student_id, [...(flags.get(x.student_id) ?? []), x.note])
  const scholarshipLate = [...flags.entries()].map(([student_id, notes]) => ({ student_id, note: notes.join(' · ') }))

  const latePayment = monthly.flatMap((f) => {
    const lp = lastPay(f)
    if (paid(f)) return lp && lp >= lastWeek ? [{ student_id: f.student_id, note: `Pagó el ${fmt(lp)}` }] : []
    return today >= lastWeek ? [{ student_id: f.student_id, note: 'Aún no paga' }] : []
  })

  const byStudent = new Map<string, Evaluation[]>()
  for (const e of evaluations) if (ids.has(e.student_id)) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), e])
  const improved = [...byStudent.entries()].flatMap(([student_id, l]) => {
    if (l.length < 2) return []
    const [prev, last] = [...l].sort((a, b) => a.date.localeCompare(b.date)).slice(-2)
    const d = Math.round((overallAverage(last) - overallAverage(prev)) * 10) / 10
    return d > 0 ? [{ student_id, note: `+${d} (de ${overallAverage(prev)} a ${overallAverage(last)})` }] : []
  })

  return { allClasses, allMatches, onTime, improved, scholarshipLate, latePayment }
}
