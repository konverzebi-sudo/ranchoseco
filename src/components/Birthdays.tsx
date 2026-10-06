import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format, isLeapYear } from 'date-fns'
import { Cake, MessageCircle } from 'lucide-react'
import { Card } from './ui'
import { parentsOf, useStudents, type StudentRow } from '@/lib/api'
import { waLink } from '@/lib/whatsapp'
import { date, isValidPhone, today } from '@/lib/format'

/** Mes-día del cumpleaños ese año (el 29 de febrero se festeja el 28 si el año no es bisiesto). */
const bdayKey = (birth: string, year: number) => {
  const md = birth.slice(5, 10)
  return md === '02-29' && !isLeapYear(new Date(year, 0, 1)) ? '02-28' : md
}

/** Alumnos (no dados de baja) que cumplen años en esa fecha 'YYYY-MM-DD'. */
export function birthdaysOn(students: StudentRow[], iso: string) {
  const y = Number(iso.slice(0, 4))
  return students.filter((s) => s.birth_date && s.status !== 'baja' && bdayKey(s.birth_date, y) === iso.slice(5, 10))
}

export const turns = (s: StudentRow, iso: string) => Number(iso.slice(0, 4)) - Number(s.birth_date!.slice(0, 4))

export function birthdayMessage(s: StudentRow, iso = today()) {
  const name = s.full_name.split(' ')[0]
  return `¡Feliz cumpleaños, ${name}! 🎂⚽\n\nToda la familia de Deportivo Rancho Seco te desea un día increíble por tus ${turns(s, iso)} años, lleno de alegría y muchos goles. ¡Que cumplas muchos más! 💛🖤`
}

/** Botones de WhatsApp para felicitar: uno por papá / mamá con teléfono. */
export function BirthdayButtons({ student, iso = today() }: { student: StudentRow; iso?: string }) {
  const { papa, mama, otros } = parentsOf(student)
  const to = [papa && { who: 'Papá', g: papa }, mama && { who: 'Mamá', g: mama }, ...otros.map((g) => ({ who: g.relationship || 'Tutor', g }))]
    .filter((x): x is { who: string; g: NonNullable<typeof papa> } => !!x && isValidPhone(x.g.phone))
  if (!to.length) return <Link to={`/alumnos/${student.id}`} className="text-xs text-muted hover:text-brand">Sin teléfono · agregar</Link>
  return (
    <div className="flex flex-wrap gap-1.5">
      {to.map(({ who, g }) => (
        <a key={g.id} href={waLink(g.phone, birthdayMessage(student, iso))} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl bg-wa px-3 py-1.5 text-xs font-semibold text-ink hover:brightness-110" title={g.full_name}>
          <MessageCircle className="h-3.5 w-3.5" /> Felicitar ({who})
        </a>
      ))}
    </div>
  )
}

/** Dashboard: cumpleaños de hoy (con botón para felicitar) y de los próximos 7 días. */
export default function BirthdaysCard() {
  const students = useStudents()
  const t = today()
  const { todays, upcoming } = useMemo(() => {
    const list = students.data ?? []
    const upcoming = Array.from({ length: 7 }, (_, i) => format(addDays(new Date(t + 'T12:00:00'), i + 1), 'yyyy-MM-dd'))
      .flatMap((d) => birthdaysOn(list, d).map((s) => ({ s, d })))
    return { todays: birthdaysOn(list, t), upcoming }
  }, [students.data, t])
  if (!todays.length && !upcoming.length) return null
  return (
    <Card className={todays.length ? 'border-brand/60' : ''}>
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <Cake className="h-5 w-5 text-brand" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Cumpleaños</h2>
      </div>
      <ul className="divide-y divide-ink-700">
        {todays.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="text-2xl">🎂</span>
            <span className="min-w-0 flex-1"><Link to={`/alumnos/${s.id}`} className="font-semibold hover:text-brand">{s.full_name}</Link>
              <span className="block text-xs text-muted">¡Hoy cumple {turns(s, t)} años!</span></span>
            <BirthdayButtons student={s} />
          </li>
        ))}
        {upcoming.map(({ s, d }) => (
          <li key={s.id + d} className="flex items-center gap-3 px-5 py-2 text-sm">
            <Cake className="h-4 w-4 text-muted" />
            <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1 truncate hover:text-brand">{s.full_name}</Link>
            <span className="text-xs text-muted">{date(d, "EEE d MMM")} · cumple {turns(s, d)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
