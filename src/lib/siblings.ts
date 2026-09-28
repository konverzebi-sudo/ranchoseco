/** Promoción de hermanos: precio por orden, sugerencias por apellidos y validez de la promo. */

export const DEFAULT_SIBLING_PRICES = [500, 450, 400]
export const PROMO_REASON = 'Promo hermanos'

/** Precio del hermano en la posición `order` (1 = primero). Del último precio en adelante se repite. */
export function siblingPrice(order: number, prices: number[] = DEFAULT_SIBLING_PRICES) {
  const list = prices.length ? prices.map(Number) : DEFAULT_SIBLING_PRICES
  return list[Math.min(Math.max(order, 1), list.length) - 1]
}

export const ordinal = (n: number) => `${n}°`

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y'])
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Clave de apellidos: las dos últimas palabras sin partículas ("de la", "de los"…). */
export function surnameKey(fullName: string) {
  const words = norm(fullName).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !PARTICLES.has(w))
  return words.length >= 3 ? words.slice(-2).join(' ') : null
}

/** Grupos de posibles hermanos (mismos dos apellidos) que aún no están juntos en una promo. */
export function suggestSiblings<T extends { id: string; full_name: string; status: string; sibling_group_id: string | null }>(students: T[]) {
  const byKey = new Map<string, T[]>()
  for (const s of students) {
    if (s.status !== 'activo') continue
    const k = surnameKey(s.full_name)
    if (!k) continue
    byKey.set(k, [...(byKey.get(k) ?? []), s])
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length >= 2)
    .filter(([, list]) => !(list.every((s) => s.sibling_group_id) && new Set(list.map((s) => s.sibling_group_id)).size === 1))
    .map(([key, list]) => ({ key, students: list }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** Precio del hermano: el especial (manual) si lo tiene; si no, el que le toca por su orden. */
export function memberPrice(m: { sibling_price?: number | null; sibling_order?: number | null }, fallbackOrder: number, prices?: number[]) {
  return m.sibling_price != null ? Number(m.sibling_price) : siblingPrice(m.sibling_order ?? fallbackOrder, prices)
}

/**
 * Estado de la promo de un grupo:
 * - candado: todos los hermanos deben seguir inscritos; si uno se da de BAJA, la promo NO aplica
 *   (un hermano en "inactivo temporal" no la rompe).
 * - alerta: hermanos con pagos vencidos.
 */
export function promoStatus<T extends { id: string; status: string }>(members: T[], overdueIds: Set<string>) {
  const notEnrolled = members.filter((m) => m.status === 'baja')
  const overdue = members.filter((m) => m.status === 'activo' && overdueIds.has(m.id))
  return { valid: notEnrolled.length === 0 && members.length >= 2, notEnrolled, overdue, paused: members.filter((m) => m.status === 'suspendido') }
}

/** Hermanos con pagos vencidos (compatibilidad). */
export function promoBreakers<T extends { id: string }>(members: T[], overdueIds: Set<string>) {
  return members.filter((m) => overdueIds.has(m.id))
}
