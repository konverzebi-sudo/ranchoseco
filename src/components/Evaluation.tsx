import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from 'recharts'
import { Button, Field, Input, Modal, Select, Stars, Textarea } from './ui'
import { useToast } from './toast'
import { useCoaches, useCoachCategories } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { shortDate, today } from '@/lib/format'
import { evolutionSeries, groupAverage } from '@/lib/stats'
import { ALL_SKILLS, SKILL_GROUPS, type Evaluation, type SkillKey } from '@/lib/types'

export const GROUP_COLORS: Record<string, string> = {
  tecnica: '#F2E30A',
  fisica: '#60A5FA',
  tactica: '#22C55E',
  actitud: '#F97316',
}

export function EvaluationModal({ studentId, categoryId, previous, editing, onClose }: {
  studentId: string
  categoryId: string | null
  previous?: Evaluation
  editing?: Evaluation
  onClose: () => void
}) {
  const { data: coaches } = useCoaches()
  const { data: cc } = useCoachCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const base = editing ?? previous
  const defaultCoach = editing?.coach_id ?? cc?.find((x) => x.category_id === categoryId)?.coach_id ?? ''
  const [scores, setScores] = useState<Record<SkillKey, number>>(
    () => Object.fromEntries(ALL_SKILLS.map((k) => [k, base ? Number(base[k]) : 0])) as Record<SkillKey, number>,
  )
  const [f, setF] = useState({
    date: editing?.date ?? today(),
    coach_id: defaultCoach,
    strengths: editing?.strengths ?? '',
    improvements: editing?.improvements ?? '',
    goals: editing?.goals ?? '',
    comments: editing?.comments ?? '',
  })
  const [saving, setSaving] = useState(false)
  const missing = ALL_SKILLS.filter((k) => !scores[k])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (missing.length) return toast.error(`Faltan ${missing.length} calificaciones por asignar.`)
    setSaving(true)
    try {
      const payload = {
        student_id: studentId, ...scores, date: f.date, coach_id: f.coach_id || null,
        strengths: f.strengths.trim() || null, improvements: f.improvements.trim() || null,
        goals: f.goals.trim() || null, comments: f.comments.trim() || null,
      }
      if (editing) unwrap(await supabase.from('evaluations').update(payload).eq('id', editing.id))
      else unwrap(await supabase.from('evaluations').insert(payload))
      await qc.invalidateQueries({ queryKey: ['evaluations', studentId] })
      toast.ok('Evaluación guardada')
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Editar evaluación' : 'Nueva evaluación'} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="eval-form" icon={Save} loading={saving}>Guardar evaluación</Button></>}>
      <form id="eval-form" onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha"><Input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Profesor">
            <Select value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}>
              <option value="">Sin especificar</option>
              {coaches?.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
        </div>
        {!editing && previous && <p className="text-xs text-muted">Se precargaron las calificaciones de la evaluación anterior ({shortDate(previous.date)}). Ajusta sólo lo que cambió.</p>}
        <p className="text-xs text-muted">1 = en desarrollo · 3 = bien · 5 = excelente</p>
        <div className="grid gap-5 md:grid-cols-2">
          {SKILL_GROUPS.map((g) => (
            <div key={g.key} className="rounded-2xl border border-ink-600 bg-ink-900 p-4">
              <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide" style={{ color: GROUP_COLORS[g.key] }}>{g.label}</h3>
              <div className="space-y-3">
                {g.skills.map(([k, label]) => (
                  <div key={k} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">{label}</span>
                    <Stars value={scores[k as SkillKey]} onChange={(v) => setScores((s) => ({ ...s, [k]: v }))} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fortalezas"><Textarea value={f.strengths} onChange={(e) => setF({ ...f, strengths: e.target.value })} /></Field>
          <Field label="Áreas de mejora"><Textarea value={f.improvements} onChange={(e) => setF({ ...f, improvements: e.target.value })} /></Field>
          <Field label="Objetivos para el siguiente periodo"><Textarea value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></Field>
          <Field label="Comentarios"><Textarea value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  )
}

export function EvolutionChart({ evaluations, height = 260 }: { evaluations: Evaluation[]; height?: number }) {
  const data = evolutionSeries(evaluations).map((d) => ({ ...d, label: shortDate(d.date) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#2A2A2A" vertical={false} />
        <XAxis dataKey="label" stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }} labelStyle={{ color: '#fff' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {SKILL_GROUPS.map((g) => (
          <Line key={g.key} type="monotone" dataKey={g.key} name={g.label} stroke={GROUP_COLORS[g.key]} strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function SkillRadar({ evaluation, height = 280 }: { evaluation: Evaluation; height?: number }) {
  const data = SKILL_GROUPS.flatMap((g) => g.skills.map(([k, label]) => ({ skill: label, value: Number(evaluation[k as SkillKey]) })))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="#2A2A2A" />
        <PolarAngleAxis dataKey="skill" tick={{ fill: '#A3A3A3', fontSize: 10 }} />
        <Radar dataKey="value" stroke="#F2E30A" fill="#F2E30A" fillOpacity={0.3} isAnimationActive={false} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

export function GroupSummary({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {SKILL_GROUPS.map((g) => (
        <div key={g.key} className="rounded-xl bg-ink-900 p-3">
          <p className="text-xs uppercase tracking-wider text-muted">{g.label}</p>
          <p className="font-display text-2xl font-bold" style={{ color: GROUP_COLORS[g.key] }}>{groupAverage(evaluation, g.key).toFixed(1)}</p>
        </div>
      ))}
    </div>
  )
}
