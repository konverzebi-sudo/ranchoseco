import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format } from 'date-fns'
import {
  Banknote, ChevronLeft, ChevronRight, ClipboardCheck, Dumbbell, FileText, Receipt, Settings2, Star, Trophy, UserCog, UserPen, UserPlus, Users, Vault, type LucideIcon,
} from 'lucide-react'
import { Card, Input, Select, cx } from './ui'
import { useActivity } from '@/lib/api'
import { date, today } from '@/lib/format'

const KINDS: Record<string, { label: string; icon: LucideIcon; group: string }> = {
  pago: { label: 'Pago', icon: Banknote, group: 'Pagos' },
  cargo: { label: 'Cargo', icon: Receipt, group: 'Pagos' },
  alumno: { label: 'Alumno', icon: UserPen, group: 'Alumnos' },
  registro: { label: 'Registro', icon: UserPlus, group: 'Papás' },
  papas: { label: 'Papás', icon: Users, group: 'Papás' },
  lista: { label: 'Lista', icon: ClipboardCheck, group: 'Listas y partidos' },
  entrenamiento: { label: 'Entrenamiento', icon: Dumbbell, group: 'Listas y partidos' },
  partido: { label: 'Partido', icon: Trophy, group: 'Listas y partidos' },
  evaluacion: { label: 'Evaluación', icon: Star, group: 'Alumnos' },
  gasto: { label: 'Gasto', icon: FileText, group: 'Gastos y caja' },
  corte: { label: 'Corte', icon: Vault, group: 'Gastos y caja' },
  sueldo: { label: 'Sueldo', icon: UserCog, group: 'Gastos y caja' },
  equipo: { label: 'Equipo', icon: UserCog, group: 'Otros' },
  config: { label: 'Configuración', icon: Settings2, group: 'Otros' },
}
const GROUPS = ['Todo', 'Pagos', 'Alumnos', 'Papás', 'Listas y partidos', 'Gastos y caja', 'Otros']
const kindOf = (k: string) => KINDS[k] ?? { label: k, icon: FileText, group: 'Otros' }
const shift = (d: string, n: number) => format(addDays(new Date(d + 'T12:00:00'), n), 'yyyy-MM-dd')

/** Actividad en el sitio: todo lo que pasó en el día, quién lo hizo y a qué hora. */
export default function ActivityFeed() {
  const [day, setDay] = useState(today())
  const [group, setGroup] = useState('Todo')
  const [who, setWho] = useState('')
  const q = useActivity(day)
  const rows = q.data ?? []
  const people = useMemo(() => [...new Set(rows.map((r) => r.actor ?? 'Sin identificar'))].sort((a, b) => a.localeCompare(b, 'es')), [rows])
  const shown = rows.filter((r) => (group === 'Todo' || kindOf(r.kind).group === group) && (!who || (r.actor ?? 'Sin identificar') === who))
  const isToday = day === today()

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-600 px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-wide">Actividad en el sitio</h2>
          <p className="text-xs text-muted">Todo lo que se registra o se cambia, quién lo hizo y a qué hora.</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setDay(shift(day, -1))} className="rounded-lg p-2 text-muted hover:bg-ink-700" aria-label="Día anterior"><ChevronLeft className="h-5 w-5" /></button>
          <Input type="date" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-40" aria-label="Día" />
          <button onClick={() => setDay(shift(day, 1))} disabled={isToday} className="rounded-lg p-2 text-muted hover:bg-ink-700 disabled:opacity-30" aria-label="Día siguiente"><ChevronRight className="h-5 w-5" /></button>
          {!isToday && <button onClick={() => setDay(today())} className="ml-1 text-sm text-brand hover:underline">Hoy</button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-5 py-3">
        {GROUPS.map((g) => (
          <button key={g} onClick={() => setGroup(g)}
            className={cx('rounded-full border px-3 py-1 text-xs font-medium', group === g ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted hover:text-fg')}>
            {g}{g !== 'Todo' && ` (${rows.filter((r) => kindOf(r.kind).group === g).length})`}
          </button>
        ))}
        <Select value={who} onChange={(e) => setWho(e.target.value)} className="ml-auto h-8 w-auto text-xs" aria-label="Persona">
          <option value="">Todas las personas</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>

      {q.isLoading ? <p className="px-5 py-8 text-center text-sm text-muted">Cargando…</p>
        : q.data === null ? <p className="px-5 py-8 text-center text-sm text-warn">Falta activar la actividad en la base de datos (pegar el SQL en Supabase).</p>
        : shown.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">{rows.length ? 'Nada con ese filtro.' : `No hubo movimientos ${isToday ? 'hoy' : 'el ' + date(day, "d 'de' MMMM")}.`}</p>
        : (
          <ul className="max-h-[32rem] divide-y divide-ink-700 overflow-y-auto">
            {shown.map((r) => {
              const k = kindOf(r.kind)
              const Icon = k.icon
              const inner = (
                <>
                  <span className="w-12 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted">{format(new Date(r.at), 'HH:mm')}</span>
                  <span className="rounded-lg bg-ink-700 p-1.5 text-brand"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{r.title}</span>
                    {r.body && <span className="block break-words text-xs text-muted">{r.body}</span>}
                  </span>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', r.actor ? 'bg-brand-dim text-brand' : 'bg-ink-700 text-muted')}>
                    {r.actor ?? 'Sin identificar'}
                  </span>
                </>
              )
              return (
                <li key={r.id}>
                  {r.link
                    ? <Link to={r.link} className="flex items-start gap-3 px-5 py-2.5 hover:bg-ink-700/50">{inner}</Link>
                    : <div className="flex items-start gap-3 px-5 py-2.5">{inner}</div>}
                </li>
              )
            })}
          </ul>
        )}
      {shown.length > 0 && <p className="border-t border-ink-700 px-5 py-2 text-xs text-muted">{shown.length} movimientos</p>}
    </Card>
  )
}
