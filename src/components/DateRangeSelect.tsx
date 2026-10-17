import { useEffect, useRef, useState } from 'react'
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, cx } from './ui'
import { date, toISODate, today } from '@/lib/format'
const FIRST_DAY = '2026-08-01'

export interface Preset { id: string; label: string; from: string; to: string }
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const iso = (d: Date) => toISODate(d)
const d0 = (s: string) => new Date(s + 'T12:00:00')

/** Atajos de fechas (como en el administrador de anuncios). `extra` va primero (p. ej. "Desde el último corte"). */
export function basicPresets(): Preset[] {
  const t = d0(today())
  const wk = startOfWeek(t, { weekStartsOn: 1 })
  const lastMonth = subMonths(t, 1)
  return [
    { id: 'hoy', label: 'Hoy', from: iso(t), to: iso(t) },
    { id: 'ayer', label: 'Ayer', from: iso(addDays(t, -1)), to: iso(addDays(t, -1)) },
    { id: '7', label: 'Últimos 7 días', from: iso(addDays(t, -6)), to: iso(t) },
    { id: '14', label: 'Últimos 14 días', from: iso(addDays(t, -13)), to: iso(t) },
    { id: '30', label: 'Últimos 30 días', from: iso(addDays(t, -29)), to: iso(t) },
    { id: 'semana', label: 'Esta semana', from: iso(wk), to: iso(t) },
    { id: 'semana-pasada', label: 'La semana pasada', from: iso(addDays(wk, -7)), to: iso(addDays(wk, -1)) },
    { id: 'mes', label: 'Este mes', from: iso(startOfMonth(t)), to: iso(t) },
    { id: 'mes-pasado', label: 'El mes pasado', from: iso(startOfMonth(lastMonth)), to: iso(endOfMonth(lastMonth)) },
    // Todo: desde el primer pago registrado (agosto 2026) hasta hoy
    { id: 'todo', label: 'Todo', from: FIRST_DAY, to: iso(t) },
  ]
}

function Month({ month, lo, hi, max, onPick, onHover }: { month: Date; lo: string; hi: string; max: string; onPick: (d: string) => void; onHover: (d: string) => void }) {
  const days = eachDayOfInterval({ start: startOfWeek(month, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) })
  return (
    <div className="w-full sm:w-[17rem]">
      <p className="mb-2 text-center font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: es })}</p>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DAYS.map((d) => <span key={d} className="pb-1 text-xs text-muted">{d}</span>)}
        {days.map((dd) => {
          const k = iso(dd)
          if (!isSameMonth(dd, month)) return <span key={k} />
          const off = k > max
          const inRange = k >= lo && k <= hi
          const edge = k === lo || k === hi
          return (
            <button type="button" key={k} disabled={off} onClick={() => onPick(k)} onMouseEnter={() => onHover(k)}
              className={cx('h-9 text-sm transition', inRange && 'bg-info/25', edge && 'rounded-md bg-info font-semibold text-white', !inRange && !off && 'rounded-md hover:bg-ink-700', off && 'cursor-not-allowed opacity-30')}>
              {dd.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Selector de fechas: a la izquierda los atajos (hoy, últimos 7 días, este mes…),
 * a la derecha dos meses para escoger el rango; se aplica con "Actualizar".
 */
export default function DateRangeSelect({ value, presets, onChange }: {
  value: { id: string; from: string; to: string }
  presets: Preset[]
  onChange: (v: { id: string; from: string; to: string; label: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [start, setStart] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => startOfMonth(subMonths(d0(value.to), 1)))
  const ref = useRef<HTMLDivElement>(null)
  const max = today()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const openIt = () => { setDraft(value); setStart(null); setCursor(startOfMonth(subMonths(d0(value.to), 1))); setOpen(true) }
  const pickPreset = (p: Preset) => { setDraft({ id: p.id, from: p.from, to: p.to }); setStart(null); setCursor(startOfMonth(subMonths(d0(p.to), 1))) }
  const pickDay = (d: string) => {
    if (!start) { setStart(d); setDraft({ id: 'personalizado', from: d, to: d }); return }
    const [a, b] = d < start ? [d, start] : [start, d]
    setDraft({ id: 'personalizado', from: a, to: b }); setStart(null)
  }
  const lo = start ? (hover && hover < start ? hover : start) : draft.from
  const hi = start ? (hover && hover > start ? hover : start) : draft.to
  const labelOf = (v: { id: string; from: string; to: string }) => presets.find((p) => p.id === v.id)?.label ?? 'Personalizado'
  const apply = () => { onChange({ ...draft, label: labelOf(draft) }); setOpen(false) }
  const rangeText = (v: { from: string; to: string }) => v.from === v.to ? date(v.from, "d 'de' MMM yyyy") : `${date(v.from, "d 'de' MMM")} al ${date(v.to, "d 'de' MMM yyyy")}`

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (open ? setOpen(false) : openIt())}
        className="flex h-11 items-center gap-2 rounded-xl border border-ink-600 bg-ink-800 px-3 text-left hover:border-ink-500">
        <CalendarRange className="h-5 w-5 shrink-0 text-brand" />
        <span className="font-semibold">{labelOf(value)}</span>
        <span className="hidden text-sm text-muted sm:inline">· {rangeText(value)}</span>
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 flex max-h-[80vh] w-[min(95vw,52rem)] flex-col overflow-auto rounded-2xl border border-ink-600 bg-ink-800 shadow-2xl sm:flex-row">
          <ul className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-ink-600 p-3 sm:w-56 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            {[...presets, { id: 'personalizado', label: 'Personalizado', from: draft.from, to: draft.to }].map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-700">
                  <input type="radio" name="periodo" checked={draft.id === p.id} onChange={() => (p.id === 'personalizado' ? setDraft({ ...draft, id: 'personalizado' }) : pickPreset(p))} className="h-5 w-5 accent-[#3B82F6]" />
                  <span>{p.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex-1 p-4">
            <div className="mb-1 flex items-center justify-between">
              <button type="button" onClick={() => setCursor((c) => addMonths(c, -1))} className="rounded-lg p-1.5 hover:bg-ink-700" aria-label="Mes anterior"><ChevronLeft className="h-5 w-5" /></button>
              <p className="text-sm text-muted">{start ? 'Ahora toca el día final' : 'Toca el día de inicio y luego el final'}</p>
              <button type="button" onClick={() => setCursor((c) => addMonths(c, 1))} className="rounded-lg p-1.5 hover:bg-ink-700" aria-label="Mes siguiente"><ChevronRight className="h-5 w-5" /></button>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row" onMouseLeave={() => setHover(null)}>
              <Month month={cursor} lo={lo} hi={hi} max={max} onPick={pickDay} onHover={setHover} />
              <div className="hidden sm:block"><Month month={addMonths(cursor, 1)} lo={lo} hi={hi} max={max} onPick={pickDay} onHover={setHover} /></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-600 pt-3">
              <p className="text-sm"><b>{labelOf(draft)}</b> <span className="text-muted">· {rangeText(draft)}</span></p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={apply} disabled={!!start}>Actualizar</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
