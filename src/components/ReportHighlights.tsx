import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, Trophy, BadgeCheck, TrendingUp, GraduationCap, Clock, type LucideIcon } from 'lucide-react'
import { Badge, Card, cx } from '@/components/ui'
import { useAttendanceDetail, useCategories, useFees, useMatches, usePayments, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { monthHighlights, ON_TIME_DAY, type Highlights, type HighlightItem } from '@/lib/highlights'
import { today } from '@/lib/format'
import type { Evaluation, MatchPlayer } from '@/lib/types'

export const SECTIONS: { key: keyof Highlights; title: string; short: string; text: string; icon: LucideIcon; tone: 'ok' | 'bad' | 'brand' }[] = [
  { key: 'allClasses', title: 'Top asistencia', short: 'Asistieron a todas las clases', text: 'Presentes (o con retardo) en todos los entrenamientos en que se pasó lista.', icon: CalendarCheck, tone: 'ok' },
  { key: 'allMatches', title: 'Sin faltas en partidos', short: 'Asistieron a todos los partidos', text: 'Llegaron a todos los partidos a los que fueron convocados. "No convocado" no cuenta como falta.', icon: Trophy, tone: 'ok' },
  { key: 'onTime', title: 'Top pago puntual', short: `Pagaron del 1 al ${ON_TIME_DAY} del mes o antes`, text: `Pagaron la mensualidad del día 1 al ${ON_TIME_DAY} del mes, o antes.`, icon: BadgeCheck, tone: 'ok' },
  { key: 'improved', title: 'Top mejora de habilidades', short: 'Mejoraron en habilidades', text: 'Su última evaluación salió mejor que la anterior. (Después afinamos la lista de habilidades.)', icon: TrendingUp, tone: 'brand' },
  { key: 'scholarshipLate', title: 'Red flags', short: 'Tienen beca y no pagaron a tiempo', text: `Con beca, promo o descuento en el mes y que pagaron después del día ${ON_TIME_DAY} (o no han pagado).`, icon: GraduationCap, tone: 'bad' },
  { key: 'latePayment', title: 'Top retardo de pagos', short: 'Pagan la última semana del mes o después', text: 'Pagaron la última semana del mes o después (o siguen sin pagar).', icon: Clock, tone: 'bad' },
]

/** Listas del mes para Reportes (asistencia, pagos, becas, mejoras). */
export function useMonthHighlights(month: string) {
  const from = `${month}-01`
  const to = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`
  const students = useStudents()
  const categories = useCategories()
  const attendance = useAttendanceDetail({ from, to })
  const matches = useMatches({ from, to })
  const fees = useFees()
  const payments = usePayments()
  const matchIds = (matches.data ?? []).map((m) => m.id)
  const players = useQuery({
    queryKey: ['match_players', 'month', matchIds],
    enabled: !!matches.data,
    queryFn: async () => matchIds.length ? unwrap(await supabase.from('match_players').select('*').in('match_id', matchIds)) as MatchPlayer[] : [],
  })
  const evaluations = useQuery({
    queryKey: ['evaluations', 'all'],
    queryFn: async () => unwrap(await supabase.from('evaluations').select('*').order('date')) as Evaluation[],
  })
  const loading = students.isLoading || attendance.isLoading || matches.isLoading || fees.isLoading || payments.isLoading || players.isLoading || evaluations.isLoading

  const h = useMemo(() => loading ? null : monthHighlights({
    month, today: today(), students: students.data ?? [], attendance: attendance.data ?? [], matchPlayers: players.data ?? [],
    fees: fees.data ?? [], payments: payments.data ?? [], evaluations: evaluations.data ?? [],
  }), [loading, month, students.data, attendance.data, players.data, fees.data, payments.data, evaluations.data])

  const byId = new Map((students.data ?? []).map((s) => [s.id, s]))
  const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
  const render = (it: HighlightItem) => {
    const st = byId.get(it.student_id)
    return st ? { id: st.id, name: st.full_name, cat: catName.get(st.category_id ?? '') ?? 'Sin categoría', note: it.note } : null
  }
  return { h, render }
}

export function HighlightCard({ title, text, icon: Icon, tone, items, render, expanded }: {
  title: string; text: string; icon: LucideIcon; tone: 'ok' | 'bad' | 'brand'; items: HighlightItem[]; expanded?: boolean
  render: (it: HighlightItem) => { id: string; name: string; cat: string; note?: string } | null
}) {
  const [all, setAll] = useState(!!expanded)
  const rows = items.map(render).filter(Boolean).sort((a, b) => a!.cat.localeCompare(b!.cat) || a!.name.localeCompare(b!.name)) as { id: string; name: string; cat: string; note?: string }[]
  const shown = all ? rows : rows.slice(0, 10)
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-ink-600 px-5 py-4">
        <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-brand')} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">{title}</h3>
          <p className="text-xs text-muted">{text}</p>
        </div>
        <Badge tone={tone === 'brand' ? 'brand' : tone}>{rows.length}</Badge>
      </div>
      {!rows.length ? <p className="px-5 py-6 text-center text-sm text-muted">Nadie en esta lista este mes.</p> : (
        <ul className="divide-y divide-ink-700">
          {shown.map((r) => (
            <li key={r.id}>
              <Link to={`/alumnos/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-ink-700/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted">{r.cat}{r.note ? ` · ${r.note}` : ''}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 10 && (
        <button onClick={() => setAll(!all)} className="border-t border-ink-600 px-5 py-2.5 text-sm text-brand hover:underline">{all ? 'Ver menos' : `Ver los ${rows.length}`}</button>
      )}
    </Card>
  )
}
