import { useMemo } from 'react'
import { Check } from 'lucide-react'
import { cx } from './ui'
import { useAttendanceDetail, useCategories, useTrainings, type StudentRow } from '@/lib/api'
import { datesFor, type Slot } from '@/lib/schedule'
import { date, money } from '@/lib/format'

const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return `${period.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** Clases del mes de un niño (según su horario y los entrenamientos registrados) y a cuáles vino. */
export function useMonthClasses(student: StudentRow, period: string) {
  const cats = useCategories()
  const to = monthEnd(period)
  const trainings = useTrainings({ categoryId: student.category_id ?? undefined, from: period, to })
  const att = useAttendanceDetail({ studentId: student.id, from: period, to })
  return useMemo(() => {
    const slots = ((cats.data ?? []).find((c) => c.id === student.category_id)?.weekly_schedule ?? []) as Slot[]
    const dates = [...new Set([...datesFor(slots, period, to).map((d) => d.date), ...(student.category_id ? (trainings.data ?? []).map((t) => t.date) : [])])].sort()
    const came = new Set((att.data ?? []).filter((a) => a.status === 'presente' || a.status === 'retardo').map((a) => a.date))
    return { dates, came, ready: !!cats.data && !!trainings.data }
  }, [cats.data, trainings.data, att.data, student.category_id, period, to])
}

/** Lo que se cobra si vino a `classes` de `total` clases (nunca menos de lo que ya pagó). */
export const classCharge = (charge: number, classes: number, total: number, paid = 0) =>
  Math.max(total > 0 ? Math.round((charge * classes) / total) : charge, paid)

/**
 * Escoger la última clase a la que vino: se cobran sólo las clases hasta ese día.
 * Las clases a las que se le pasó lista como presente salen con ✓.
 */
export function ClassCutPicker({ dates, came, last, onChange, charge, paid }: {
  dates: string[]; came: Set<string>; last: string; onChange: (d: string) => void; charge: number; paid: number
}) {
  const upTo = dates.filter((d) => d <= last).length
  const amount = classCharge(charge, upTo, dates.length, paid)
  return (
    <div className="space-y-2">
      <p className="text-muted">¿Hasta qué clase vino?</p>
      <div className="flex flex-wrap gap-1.5">
        {dates.map((d) => (
          <button key={d} type="button" onClick={() => onChange(d)}
            className={cx('rounded-lg border px-2.5 py-1 text-xs', d <= last ? 'border-brand bg-brand-dim' : 'border-ink-600 text-muted', d === last && 'bg-brand font-semibold text-ink')}>
            {date(d, 'EEE d')}{came.has(d) && <Check className="ml-1 inline h-3 w-3 text-ok" />}
          </button>
        ))}
      </div>
      <p>Vino a <b>{upTo} de {dates.length}</b> clases → se cobran <b className="text-brand">{money(amount)}</b> de {money(charge)}.</p>
      {paid > Math.round((charge * upTo) / Math.max(1, dates.length)) && <p className="text-xs text-warn">Ya había pagado {money(paid)}, así que no se cobra menos de eso.</p>}
      <p className="text-xs text-muted">✓ = se le pasó lista como presente.</p>
    </div>
  )
}
