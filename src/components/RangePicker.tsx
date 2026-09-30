import { useEffect, useRef, useState } from 'react'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from './ui'
import { date, toISODate, today } from '@/lib/format'

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/**
 * Un solo calendario para elegir un rango: el primer toque marca el inicio
 * y el segundo el final (si el segundo es antes, se acomodan solos).
 */
export default function RangePicker({ from, to, onChange, max, label = 'Fechas' }: {
  from: string; to: string; onChange: (from: string, to: string) => void; max?: string; label?: string
}) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(() => startOfMonth(new Date(to + 'T12:00:00')))
  const [start, setStart] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setStart(null) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const pick = (d: string) => {
    if (!start) { setStart(d); return }
    const [a, b] = d < start ? [d, start] : [start, d]
    onChange(a, b)
    setStart(null)
    setOpen(false)
  }
  // Mientras se elige, el rango se ve desde el inicio hasta donde está el dedo/ratón
  const lo = start ? (hover && hover < start ? hover : start) : from
  const hi = start ? (hover && hover > start ? hover : start) : to
  const days = eachDayOfInterval({ start: startOfWeek(cursor, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) })
  const t = today()

  return (
    <div ref={ref} className="relative">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <button type="button" onClick={() => { setOpen(!open); setStart(null); setCursor(startOfMonth(new Date(to + 'T12:00:00'))) }}
        className="flex h-10 items-center gap-2 rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm hover:border-ink-500">
        <CalendarRange className="h-4 w-4 text-muted" />
        <span>{date(from, "d 'de' MMM")} <span className="text-muted">al</span> {date(to, "d 'de' MMM yyyy")}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[300px] rounded-2xl border border-ink-600 bg-ink-800 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setCursor((c) => addMonths(c, -1))} className="rounded-lg p-1.5 hover:bg-ink-700" aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></button>
            <p className="text-sm font-semibold capitalize">{format(cursor, 'MMMM yyyy', { locale: es })}</p>
            <button type="button" onClick={() => setCursor((c) => addMonths(c, 1))} className="rounded-lg p-1.5 hover:bg-ink-700" aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <p className="mb-2 text-center text-xs text-muted">{start ? 'Ahora toca el día final' : 'Toca el día de inicio'}</p>
          <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
            {DAYS.map((d, i) => <span key={i} className="pb-1 text-xs font-semibold text-muted">{d}</span>)}
            {days.map((dd) => {
              const k = toISODate(dd)
              const disabled = !!max && k > max
              const inRange = k >= lo && k <= hi
              const edge = k === lo || k === hi
              return (
                <button type="button" key={k} disabled={disabled} onClick={() => pick(k)} onMouseEnter={() => setHover(k)}
                  className={cx('h-9 text-sm transition',
                    !isSameMonth(dd, cursor) && 'text-muted/60',
                    inRange && !edge && 'bg-brand-dim',
                    edge && 'rounded-lg bg-brand font-semibold text-ink',
                    !inRange && !disabled && 'rounded-lg hover:bg-ink-700',
                    k === t && !edge && 'font-bold underline',
                    disabled && 'cursor-not-allowed opacity-30')}>
                  {dd.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
