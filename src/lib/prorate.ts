/**
 * Primera mensualidad de un alumno que entra a medio mes (regla de la academia):
 *   entra del 1 al 15   → mes completo
 *   entra del 16 al 22  → mitad de la mensualidad ($275 con $550)
 *   entra del 23 en adelante → $100
 */
export type JoinTier = 'completo' | 'mitad' | 'minimo'

export const LATE_JOIN_FEE = 100

export const TIER_LABEL: Record<JoinTier, string> = {
  completo: 'Mes completo',
  mitad: 'Mitad',
  minimo: 'Cuota mínima',
}

/**
 * Qué le toca pagar en el mes `period` ('YYYY-MM-01') según su fecha de inscripción.
 * null = aún no estaba inscrito ese mes (no se le cobra).
 */
export function joinTier(enrolledAt: string | null | undefined, period: string): JoinTier | null {
  if (!enrolledAt) return 'completo'
  const ym = period.slice(0, 7)
  const enrolledYm = enrolledAt.slice(0, 7)
  if (enrolledYm < ym) return 'completo'
  if (enrolledYm > ym) return null
  const day = Number(enrolledAt.slice(8, 10))
  return day <= 15 ? 'completo' : day <= 22 ? 'mitad' : 'minimo'
}

export function tierAmount(regular: number, tier: JoinTier) {
  if (tier === 'mitad') return Math.round((regular / 2) * 100) / 100
  if (tier === 'minimo') return Math.min(regular, LATE_JOIN_FEE)
  return regular
}

export const tierNote = (tier: JoinTier) =>
  tier === 'mitad' ? 'Entró a medio mes (del 16 al 22): se cobra la mitad'
    : tier === 'minimo' ? `Entró a fin de mes (del 23 en adelante): se cobran $${LATE_JOIN_FEE}`
      : null
