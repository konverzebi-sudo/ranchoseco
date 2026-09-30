import { format, parseISO, differenceInYears, isValid } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AttendanceStatus, FeeStatus, AccountStatus, PaymentMethod, StudentStatus } from './types'

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 })
export const money = (n: number | string | null | undefined) => mxn.format(Number(n ?? 0))
/** Importe sin símbolo para el mensaje de WhatsApp: 1,250 o 1,250.50 */
export const plainAmount = (n: number) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n)

export const toISODate = (d: Date) => format(d, 'yyyy-MM-dd')
export const today = () => toISODate(new Date())

export function date(d: string | null | undefined, pattern = "d 'de' MMM yyyy") {
  if (!d) return '—'
  const p = parseISO(d)
  return isValid(p) ? format(p, pattern, { locale: es }) : '—'
}
export const shortDate = (d: string | null | undefined) => date(d, 'dd/MM/yy')
export const monthName = (d: string) => {
  const s = format(parseISO(d), 'MMMM yyyy', { locale: es })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
export const monthOnly = (d: string) => {
  const s = format(parseISO(d), 'MMMM', { locale: es })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
export const time = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

export function age(birth: string | null) {
  if (!birth) return null
  const p = parseISO(birth)
  return isValid(p) ? differenceInYears(new Date(), p) : null
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

/** Teléfono internacional sólo dígitos: "81 1234 5678" -> "528112345678" */
export function normalizePhone(input: string, countryCode = '52'): string {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10) d = countryCode + d
  // Formato antiguo de celular en México (52 1 XXXXXXXXXX) -> 52 XXXXXXXXXX
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3)
  return d
}
export const isValidPhone = (d: string) => /^[0-9]{10,15}$/.test(d)

export function prettyPhone(d: string | null | undefined) {
  if (!d) return '—'
  if (d.startsWith('52') && d.length === 12) return `+52 ${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8)}`
  return `+${d}`
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  presente: 'Presente',
  falta: 'Falta',
  justificada: 'Justificada',
  retardo: 'Retardo',
}
export const FEE_LABEL: Record<FeeStatus, string> = {
  pagado: 'Pagado',
  pendiente: 'Pendiente',
  vencido: 'Vencido',
  parcial: 'Pago parcial',
  por_confirmar: 'Por confirmar',
}
export const ACCOUNT_LABEL: Record<AccountStatus, string> = {
  al_corriente: 'Al corriente',
  pendiente: 'Pendiente',
  parcial: 'Pago parcial',
  vencido: 'Vencido',
  por_confirmar: '¿Beca? Por confirmar',
}
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  deposito: 'Depósito',
  otro: 'Otro',
}
export const STATUS_LABEL: Record<StudentStatus, string> = {
  activo: 'Activo',
  suspendido: 'Inactivo temporal',
  baja: 'Baja',
  muestra: 'Clase muestra',
}
