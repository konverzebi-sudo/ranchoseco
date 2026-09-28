import { differenceInCalendarDays, parseISO } from 'date-fns'

/** Reinscripción que se cobra al volver después de un año o más inactivo. */
export const REINSCRIPTION_FEE = 300

/** Fin del ciclo escolar/deportivo (agosto a julio) al que pertenece una fecha 'YYYY-MM-DD'. */
export function cycleEnd(dateStr: string) {
  const y = Number(dateStr.slice(0, 4))
  const m = Number(dateStr.slice(5, 7))
  return `${m >= 8 ? y + 1 : y}-07-31`
}

/** ¿Debe pagar reinscripción al regresar? Sólo si estuvo inactivo un año o más. */
export function needsReinscription(inactiveSince: string | null | undefined, returnDate: string) {
  if (!inactiveSince) return false
  return differenceInCalendarDays(parseISO(returnDate), parseISO(inactiveSince)) >= 365
}

export function inactiveDays(inactiveSince: string | null | undefined, until: string) {
  if (!inactiveSince) return 0
  return Math.max(0, differenceInCalendarDays(parseISO(until), parseISO(inactiveSince)))
}
