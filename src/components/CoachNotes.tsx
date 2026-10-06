import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, MessageSquare, Trophy } from 'lucide-react'
import { Card } from './ui'
import { useCategories, useStudents } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { date, toISODate } from '@/lib/format'
import type { Attendance, AttendanceCheck, Match, MatchPlayer, Training } from '@/lib/types'

const REPORT_LABEL: Record<string, string> = { injuries: 'Lesionados', kids: 'Niños', parents: 'Papás', referees: 'Árbitros', tournament: 'Torneo', other: 'Notas' }

/** Lo de las últimas 2 semanas: listas por verificar, notas de los profes y reportes de partidos. */
function useRecent() {
  const from = toISODate(new Date(Date.now() - 14 * 86400_000))
  return useQuery({
    queryKey: ['attendance', 'recent-review', from],
    queryFn: async () => {
      const [tr, ma] = await Promise.all([
        supabase.from('trainings').select('*').gte('date', from).order('date', { ascending: false }),
        supabase.from('matches').select('*').gte('date', from).order('date', { ascending: false }),
      ])
      const trainings = (tr.data ?? []) as Training[]
      const ids = trainings.map((t) => t.id)
      const matchIds = ((ma.data ?? []) as Match[]).map((m) => m.id)
      const [att, chk, mp] = await Promise.all([
        ids.length ? supabase.from('attendance').select('*').in('training_id', ids) : { data: [] },
        ids.length ? supabase.from('attendance_checks').select('*').in('training_id', ids) : { data: [] },
        matchIds.length ? supabase.from('match_players').select('*').in('match_id', matchIds) : { data: [] },
      ])
      return { trainings, matches: (ma.data ?? []) as Match[], att: (att.data ?? []) as Attendance[], checks: ((chk as { data: unknown }).data ?? []) as AttendanceCheck[], players: (mp.data ?? []) as MatchPlayer[] }
    },
    refetchInterval: 60_000,
  })
}

export default function CoachNotes() {
  const q = useRecent()
  const cats = useCategories()
  const students = useStudents()
  const cat = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? ''
  const kid = (id: string) => students.data?.find((s) => s.id === id)?.full_name ?? 'Alumno'

  const { toVerify, notes } = useMemo(() => {
    const d = q.data
    if (!d) return { toVerify: [], notes: [] }
    const toVerify = d.trainings.filter((t) => !t.verified_at && d.att.some((a) => a.training_id === t.id)).map((t) => {
      const att = d.att.filter((a) => a.training_id === t.id)
      const chk = d.checks.filter((c) => c.training_id === t.id)
      const kids = new Set([...att, ...chk].map((x) => x.student_id))
      const diff = chk.length ? [...kids].filter((k) => att.find((a) => a.student_id === k)?.status !== chk.find((c) => c.student_id === k)?.status).length : null
      return { t, diff }
    }).sort((a, b) => (b.diff ?? -1) - (a.diff ?? -1))
    type Note = { key: string; date: string; title: string; text: string; link: string; alert?: boolean }
    const notes: Note[] = []
    for (const t of d.trainings) {
      if (t.coach_notes) notes.push({ key: 'g' + t.id, date: t.date, title: `${cat(t.category_id)} · entrenamiento`, text: t.coach_notes, link: '/asistencias' })
      for (const a of d.att.filter((x) => x.training_id === t.id && x.notes)) notes.push({ key: 'a' + a.id, date: t.date, title: `${kid(a.student_id)} · ${cat(t.category_id)}`, text: a.notes!, link: `/alumnos/${a.student_id}` })
    }
    for (const m of d.matches) {
      const r = m.report ?? {}
      const lines = Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${REPORT_LABEL[k] ?? k}: ${v}`)
      if (lines.length) notes.push({ key: 'm' + m.id, date: m.date, title: `Partido ${cat(m.category_id)} vs ${m.opponent}${m.goals_for != null ? ` (${m.goals_for}-${m.goals_against})` : ''}`, text: lines.join(' · '), link: `/partidos/${m.id}`, alert: !!r.injuries })
      for (const p of d.players.filter((x) => x.match_id === m.id && (x.notes || x.injured))) {
        notes.push({ key: 'p' + m.id + p.student_id, date: m.date, title: `${kid(p.student_id)} · partido vs ${m.opponent}`, text: [p.injured ? 'Se lesionó' : '', p.notes ?? ''].filter(Boolean).join(' · '), link: `/partidos/${m.id}`, alert: !!p.injured })
      }
    }
    notes.sort((a, b) => Number(!!b.alert) - Number(!!a.alert) || b.date.localeCompare(a.date))
    return { toVerify, notes }
  }, [q.data, cats.data, students.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!q.data || (!toVerify.length && !notes.length)) return null
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {toVerify.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
            <AlertTriangle className="h-5 w-5 text-warn" />
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">Listas por verificar</h2>
          </div>
          <ul className="max-h-80 divide-y divide-ink-700 overflow-y-auto">
            {toVerify.map(({ t, diff }) => (
              <li key={t.id}>
                <Link to="/asistencias" className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-ink-700/50">
                  <span className="text-sm"><b>{cat(t.category_id)}</b> <span className="text-muted">· {date(t.date, "EEE d MMM")}</span></span>
                  <span className={diff ? 'text-sm font-semibold text-bad' : 'text-xs text-muted'}>
                    {diff == null ? 'Falta la lista de administración' : diff ? `${diff} no coinciden` : 'Coincide · falta confirmar'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {notes.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
            <MessageSquare className="h-5 w-5 text-brand" />
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">Notas de los profes</h2>
          </div>
          <ul className="max-h-80 divide-y divide-ink-700 overflow-y-auto">
            {notes.map((n) => (
              <li key={n.key}>
                <Link to={n.link} className="flex items-start gap-3 px-5 py-2.5 hover:bg-ink-700/50">
                  {n.key.startsWith('m') || n.key.startsWith('p') ? <Trophy className={n.alert ? 'mt-0.5 h-4 w-4 text-bad' : 'mt-0.5 h-4 w-4 text-brand'} /> : <MessageSquare className="mt-0.5 h-4 w-4 text-muted" />}
                  <span className="min-w-0 flex-1 text-sm">
                    <span className={n.alert ? 'font-semibold text-bad' : 'font-semibold'}>{n.title}</span> <span className="text-xs text-muted">· {date(n.date, 'd MMM')}</span>
                    <span className="block break-words text-muted">{n.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
