import { addDays, format, getISODay, parseISO } from 'date-fns'

/** Un día de entrenamiento a la semana: dow 1 = lunes … 7 = domingo; horas 'HH:mm'. */
export interface Slot { dow: number; start: string; end: string }

export const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
export const DOW_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

export const sortSlots = (s: Slot[]) => [...s].sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start))

const hm = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`
}

/** Texto corto: "Lun y Mié 5–6:30 pm · Vie 4 pm" (agrupa los días con el mismo horario). */
export function scheduleText(slots: Slot[]) {
  const groups = new Map<string, number[]>()
  for (const s of sortSlots(slots)) {
    const k = `${s.start}|${s.end}`
    groups.set(k, [...(groups.get(k) ?? []), s.dow])
  }
  return [...groups].map(([k, days]) => {
    const [start, end] = k.split('|')
    const names = days.map((d) => DOW[d - 1])
    const dayTxt = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0]
    return `${dayTxt} ${hm(start)}${end ? `–${hm(end)}` : ''}`
  }).join(' · ')
}

/** Entrenamientos que tocan entre dos fechas (incluidas) según el horario. */
export function datesFor(slots: Slot[], from: string, to: string) {
  const out: { date: string; start: string; end: string }[] = []
  for (let d = parseISO(from); format(d, 'yyyy-MM-dd') <= to; d = addDays(d, 1)) {
    for (const s of sortSlots(slots)) if (s.dow === getISODay(d)) out.push({ date: format(d, 'yyyy-MM-dd'), start: s.start, end: s.end })
  }
  return out
}
