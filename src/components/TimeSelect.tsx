import { useState } from 'react'
import { Input, Select, cx } from './ui'
import { timeLabel } from '@/lib/schedule'

const OTHER = '__otra'
/** Horas cerradas y medias horas de 6 am a 10 pm. */
const HALF_HOURS = Array.from({ length: 33 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

/**
 * Hora rápida: lista de horas cerradas y medias horas.
 * "Otra hora…" abre un campo para escribir una hora exacta (ej. 5:15 pm).
 */
export function TimeSelect({ value, onChange, className, placeholder, ...rest }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; 'aria-label'?: string
}) {
  const v = value.slice(0, 5)
  const [manual, setManual] = useState(!!v && !HALF_HOURS.includes(v))

  if (manual) {
    return (
      <span className={cx('inline-flex items-center gap-1', className)}>
        <Input type="time" value={v} onChange={(e) => onChange(e.target.value)} className="h-full min-w-0 flex-1" autoFocus aria-label={rest['aria-label']} />
        <button type="button" onClick={() => { setManual(false); if (v && !HALF_HOURS.includes(v)) onChange('') }}
          className="shrink-0 px-1 text-xs text-muted hover:text-brand">Lista</button>
      </span>
    )
  }
  return (
    <Select value={v} onChange={(e) => (e.target.value === OTHER ? setManual(true) : onChange(e.target.value))} className={className} aria-label={rest['aria-label']}>
      <option value="">{placeholder ?? 'Hora…'}</option>
      {HALF_HOURS.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
      <option value={OTHER}>Otra hora…</option>
    </Select>
  )
}
