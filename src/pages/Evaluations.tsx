import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react'
import { Avatar, Badge, Button, Card, ConfirmDialog, Empty, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, Spinner, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { TeamSelect } from '@/components/Team'
import { EvalResult } from '@/components/PlayerEvalProfile'
import { useCategories, useCoachCategories, useCoaches, useExtraClasses, useStudents, type StudentRow } from '@/lib/api'
import { useEvalElements, useEvalExercises, useEvalTemplates, usePlayerEvalItems, usePlayerEvaluations } from '@/lib/evalApi'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor } from '@/lib/actor'
import { useRole } from '@/lib/role'
import { age, date, today } from '@/lib/format'
import {
  AREAS, SCORE_LABEL, areaLabel, scoresOf, templatesFor,
  type AreaKey, type EvalElement, type EvalExercise, type EvalTemplate, type PlayerEvaluation,
} from '@/lib/evaluation'

type Tab = 'evaluar' | 'historial' | 'catalogo'
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function EvaluationsPage() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('alumno') ? 'evaluar' : 'evaluar')
  return (
    <>
      <PageHeader title="Evaluaciones" subtitle="Evaluación por generación y nivel: áreas, indicadores, ejercicios y criterios del 1 al 5."
        actions={<Segmented value={tab} onChange={setTab} options={[{ id: 'evaluar', label: 'Realizar evaluación' }, { id: 'historial', label: 'Historial' }, { id: 'catalogo', label: 'Catálogo de ejercicios' }]} />} />
      {tab === 'evaluar' ? <Evaluate initialStudent={params.get('alumno') ?? ''} /> : tab === 'historial' ? <History /> : <Catalog />}
    </>
  )
}

// ---------------------------------------------------------------------------
// REALIZAR EVALUACIÓN
// ---------------------------------------------------------------------------
type Score = { score: number; exercise: string; note: string }

function Evaluate({ initialStudent }: { initialStudent: string }) {
  const students = useStudents()
  const categories = useCategories()
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const extras = useExtraClasses()
  const templates = useEvalTemplates()
  const elements = useEvalElements()
  const exercises = useEvalExercises()
  const qc = useQueryClient()
  const toast = useToast()
  const [sid, setSid] = useState(initialStudent)
  const [tplId, setTplId] = useState('')
  const [scores, setScores] = useState<Record<string, Score>>({})
  const [openEx, setOpenEx] = useState<string | null>(null)
  const [coach, setCoach] = useState(getActor)
  const [on, setOn] = useState(today())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<PlayerEvaluation | null>(null)

  const student = (students.data ?? []).find((s) => s.id === sid)
  const extraCats = (extras.data ?? []).filter((x) => x.student_id === sid).map((x) => x.category_id)
  const options = student ? templatesFor(student, templates.data ?? [], extraCats) : []
  const tpl = options.find((t) => t.id === tplId) ?? options[0]
  useEffect(() => { setScores({}); setSaved(null); setNotes(''); setTplId('') }, [sid])
  useEffect(() => { setScores({}) }, [tpl?.id])

  const els = (elements.data ?? []).filter((e) => e.active && e.template_id === tpl?.id)
  const exFor = (el: EvalElement) => (exercises.data ?? []).filter((x) => x.active && x.eval_exercise_elements?.some((l) => l.element_id === el.id))
  const items = els.filter((e) => scores[e.id]?.score).map((e) => ({ area: e.area, score: scores[e.id].score }))
  const result = scoresOf(items)
  const done = items.length
  const set = (id: string, patch: Partial<Score>) => setScores((s) => ({ ...s, [id]: { ...(s[id] ?? { score: 0, exercise: '', note: '' }), ...patch } }))

  const coachOf = (s: StudentRow) => (cc.data ?? []).filter((x) => x.category_id === s.category_id).map((x) => coaches.data?.find((c) => c.id === x.coach_id)?.full_name).filter(Boolean).join(', ')

  const save = async () => {
    if (!student || !tpl) return
    if (!done) return toast.error('Califica al menos un indicador.')
    if (!coach) return toast.error('Escoge quién evaluó.')
    if (done < els.length && !window.confirm(`Calificaste ${done} de ${els.length} indicadores. ¿Guardar así?`)) return
    setSaving(true)
    try {
      const ev = unwrap(await supabase.from('player_evaluations').insert({
        student_id: student.id, template_id: tpl.id, template_name: tpl.name, level_label: tpl.level_label, category_id: student.category_id,
        evaluated_on: on, coach, notes: notes.trim() || null, area_scores: result.area, overall: result.overall,
      }).select('*').single()) as PlayerEvaluation
      const rows = els.filter((e) => scores[e.id]?.score).map((e) => {
        const s = scores[e.id]
        const ex = exFor(e).find((x) => x.id === (s.exercise || exFor(e)[0]?.id))
        return { evaluation_id: ev.id, area: e.area, element_id: e.id, element_name: e.name, exercise_id: ex?.id ?? null, exercise_name: ex?.name ?? null, score: s.score, note: s.note.trim() || null }
      })
      unwrap(await supabase.from('player_evaluation_items').insert(rows))
      await qc.invalidateQueries({ queryKey: ['eval'] })
      toast.ok('Evaluación guardada')
      setSaved(ev)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  if (students.isLoading || templates.isLoading) return <Spinner />
  if (!(templates.data ?? []).length) return <Card className="p-6 text-sm text-warn">Falta activar el módulo en la base de datos (pegar el SQL en Supabase).</Card>

  if (!student) return <StudentPicker onPick={setSid} />

  const cat = categories.data?.find((c) => c.id === student.category_id)
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <Avatar name={student.full_name} path={student.photo_path} size={64} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-bold uppercase leading-tight">{student.full_name}</p>
          <p className="text-sm text-muted">
            {cat?.name ?? 'Sin categoría'} · Generación {tpl?.generation ?? '—'}{age(student.birth_date) != null ? ` · ${age(student.birth_date)} años` : ''} · Profe {coachOf(student) || '—'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {tpl && <Badge tone={tpl.level === 'avanzado' ? 'ok' : tpl.level === 'desarrollo' ? 'info' : 'neutral'}>{tpl.level === 'general' ? 'Plantilla ' + tpl.name : tpl.level_label}</Badge>}
          </div>
        </div>
        <Button variant="ghost" onClick={() => setSid('')}>Cambiar alumno</Button>
      </Card>

      {!tpl ? <Card className="p-5 text-sm text-warn">Su categoría todavía no tiene plantilla de evaluación. Revisa el catálogo.</Card> : saved ? (
        <SavedResult ev={saved} studentId={student.id} tpl={tpl} onNew={() => { setSaved(null); setScores({}) }} />
      ) : (
        <>
          {options.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Evaluar con la plantilla:</span>
              {options.map((t) => <button key={t.id} onClick={() => setTplId(t.id)} className={cx('rounded-full border px-3 py-1', t.id === tpl.id ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 text-muted')}>{t.name}</button>)}
            </div>
          )}
          <div className="sticky top-[57px] z-20 -mx-4 grid grid-cols-5 gap-2 border-b border-ink-600 bg-page/95 px-4 py-2 text-center backdrop-blur lg:top-0 lg:mx-0 lg:rounded-2xl lg:border">
            {AREAS.map((a) => <div key={a.key}><p className="truncate text-[11px] text-muted">{a.short}</p><p className="font-display text-xl font-bold">{result.area[a.key]?.toFixed(1) ?? '—'}</p></div>)}
            <div><p className="text-[11px] text-muted">General</p><p className="font-display text-xl font-bold text-brand">{result.overall?.toFixed(1) ?? '—'}</p></div>
          </div>
          <p className="text-xs text-muted">{done} de {els.length} indicadores calificados · 1 Inicial · 2 En desarrollo · 3 Adecuado · 4 Bueno · 5 Destacado</p>

          {AREAS.map((a) => {
            const list = els.filter((e) => e.area === a.key)
            if (!list.length) return null
            return (
              <Card key={a.key}>
                <div className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide">{a.icon} {a.label}</h3>
                  <span className="font-display text-xl font-bold text-brand">{result.area[a.key]?.toFixed(1) ?? '—'}</span>
                </div>
                <ul className="divide-y divide-ink-700">
                  {list.map((el) => {
                    const exs = exFor(el)
                    const s = scores[el.id]
                    const ex = exs.find((x) => x.id === s?.exercise) ?? exs[0]
                    const crit = ex?.criteria ?? {}
                    return (
                      <li key={el.id} className={cx('px-4 py-3', !!s?.score && 'bg-ok/5')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 font-medium">{el.name}</p>
                          {exs.length > 1 ? (
                            <Select value={ex?.id ?? ''} onChange={(e) => set(el.id, { exercise: e.target.value })} className="h-8 w-auto text-xs" aria-label="Ejercicio">
                              {exs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </Select>
                          ) : ex && <span className="text-xs text-muted">Ejercicio: <b>{ex.name}</b></span>}
                          {ex && <button onClick={() => setOpenEx(openEx === el.id ? null : el.id)} className="inline-flex items-center gap-1 text-xs text-brand hover:underline"><BookOpen className="h-3.5 w-3.5" /> {openEx === el.id ? 'Ocultar' : 'Ver ejercicio'}</button>}
                        </div>
                        {openEx === el.id && ex && <ExerciseInfo ex={ex} />}
                        <div className="mt-2 grid grid-cols-5 gap-1.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} onClick={() => set(el.id, { score: s?.score === n ? 0 : n, exercise: ex?.id ?? '' })} aria-pressed={s?.score === n} title={crit[String(n)] ?? SCORE_LABEL[n]}
                              className={cx('rounded-xl border py-2 text-center transition', s?.score === n ? 'border-brand bg-brand text-ink' : 'border-ink-600 bg-ink-900 text-muted hover:text-fg')}>
                              <span className="block font-display text-lg font-bold leading-none">{n}</span><span className="block text-[10px] sm:text-xs">{SCORE_LABEL[n]}</span>
                            </button>
                          ))}
                        </div>
                        {s?.score ? <p className="mt-1.5 text-xs text-muted"><b>{SCORE_LABEL[s.score]}:</b> {crit[String(s.score)] ?? ''}</p> : null}
                        <Input value={s?.note ?? ''} onChange={(e) => set(el.id, { note: e.target.value })} placeholder="Observación (opcional)" className="mt-2 h-9 text-sm" aria-label="Observación" />
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )
          })}

          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="¿Quién evaluó? *"><TeamSelect value={coach} onChange={setCoach} /></Field>
              <Field label="Fecha"><Input type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value || today())} /></Field>
            </div>
            <Field label="Observaciones generales"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recomendaciones, actitud, lo que quieras dejar anotado" /></Field>
            <div className="flex justify-end"><Button icon={Save} loading={saving} onClick={save}>Guardar evaluación</Button></div>
          </Card>
        </>
      )}
    </div>
  )
}

function ExerciseInfo({ ex }: { ex: EvalExercise }) {
  return (
    <div className="mt-2 space-y-1.5 rounded-xl bg-ink-900 p-3 text-xs">
      {ex.objective && <p><b>Objetivo:</b> {ex.objective}</p>}
      {ex.instructions && <p><b>Instrucciones:</b> {ex.instructions}</p>}
      <p className="text-muted">{[ex.material && `Material: ${ex.material}`, ex.duration && `Duración: ${ex.duration}`, ex.repetitions && `Repeticiones: ${ex.repetitions}`, ex.difficulty && `Dificultad ${ex.difficulty}/5`].filter(Boolean).join(' · ')}</p>
      <ul className="space-y-0.5">{[1, 2, 3, 4, 5].map((n) => ex.criteria?.[String(n)] && <li key={n}><b>{n} {SCORE_LABEL[n]}:</b> {ex.criteria[String(n)]}</li>)}</ul>
      {ex.observations && <p className="text-muted">{ex.observations}</p>}
      {ex.video_url && <a href={ex.video_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Ver video</a>}
      {ex.image_url && <img src={ex.image_url} alt={ex.name} className="max-h-48 rounded-lg" />}
    </div>
  )
}

function SavedResult({ ev, studentId, tpl, onNew }: { ev: PlayerEvaluation; studentId: string; tpl: EvalTemplate; onNew: () => void }) {
  const history = usePlayerEvaluations(studentId)
  const items = usePlayerEvalItems([ev.id])
  if (!items.data) return <Spinner />
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-2 border-ok/50 p-4"><p className="font-semibold text-ok">Evaluación guardada ✓</p>
        <div className="flex gap-2"><Link to={`/alumnos/${studentId}?tab=evaluacion`}><Button variant="secondary">Ver ficha del alumno</Button></Link><Button onClick={onNew}>Nueva evaluación</Button></div></Card>
      <EvalResult ev={ev} items={items.data} history={history.data ?? [ev]} template={tpl} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// HISTORIAL
// ---------------------------------------------------------------------------
function History() {
  const evals = usePlayerEvaluations()
  const students = useStudents()
  const categories = useCategories()
  const templates = useEvalTemplates()
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<PlayerEvaluation | null>(null)
  const name = (id: string) => students.data?.find((s) => s.id === id)?.full_name ?? 'Alumno'
  const list = (evals.data ?? []).filter((e) => (!cat || e.category_id === cat) && (!q || norm(name(e.student_id)).includes(norm(q))))
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar alumno" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría"><option value="">Todas las categorías</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </div>
      {evals.isLoading ? <Spinner /> : !list.length ? <Card><Empty icon={Star} title="Todavía no hay evaluaciones" text="Usa “Realizar evaluación”." /></Card> : (
        <Card className="overflow-x-auto">
          <table className="table-base min-w-[720px]">
            <thead><tr><th>Fecha</th><th>Alumno</th><th>Plantilla</th>{AREAS.map((a) => <th key={a.key}>{a.short}</th>)}<th>General</th><th>Evaluó</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-ink-700/40" onClick={() => setOpen(e)}>
                  <td className="whitespace-nowrap">{date(e.evaluated_on, 'd MMM yy')}</td>
                  <td className="font-medium">{name(e.student_id)}</td>
                  <td className="text-xs">{e.template_name}</td>
                  {AREAS.map((a) => <td key={a.key}>{e.area_scores?.[a.key]?.toFixed(1) ?? '—'}</td>)}
                  <td className="font-semibold text-brand">{e.overall != null ? Number(e.overall).toFixed(1) : '—'}</td>
                  <td className="text-xs">{e.coach}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {open && <EvalModal ev={open} name={name(open.student_id)} tpl={templates.data?.find((t) => t.id === open.template_id)} onClose={() => setOpen(null)} />}
    </div>
  )
}

function EvalModal({ ev, name, tpl, onClose }: { ev: PlayerEvaluation; name: string; tpl?: EvalTemplate; onClose: () => void }) {
  const items = usePlayerEvalItems([ev.id])
  const history = usePlayerEvaluations(ev.student_id)
  const qc = useQueryClient()
  const toast = useToast()
  const [del, setDel] = useState(false)
  const remove = async () => {
    try { unwrap(await supabase.from('player_evaluations').delete().eq('id', ev.id)); await qc.invalidateQueries({ queryKey: ['eval'] }); toast.ok('Evaluación borrada'); onClose() } catch (e) { toast.error(e) }
  }
  return (
    <Modal open onClose={onClose} title={`Evaluación · ${name}`} wide
      footer={<><Button variant="danger" className="mr-auto" icon={Trash2} onClick={() => setDel(true)}>Borrar</Button><Link to={`/alumnos/${ev.student_id}?tab=evaluacion`}><Button variant="secondary">Ver ficha</Button></Link><Button onClick={onClose}>Cerrar</Button></>}>
      {!items.data ? <Spinner /> : <EvalResult ev={ev} items={items.data} history={history.data ?? [ev]} template={tpl} />}
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={remove} danger title="Borrar evaluación" confirmLabel="Borrar" text="Se borrará esta evaluación y sus calificaciones." />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// CATÁLOGO DE EJERCICIOS
// ---------------------------------------------------------------------------
function Catalog() {
  const role = useRole()
  const templates = useEvalTemplates()
  const elements = useEvalElements()
  const exercises = useEvalExercises()
  const qc = useQueryClient()
  const toast = useToast()
  const [tplId, setTplId] = useState('')
  const [area, setArea] = useState<'' | AreaKey>('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<EvalExercise | 'new' | null>(null)
  const [openEl, setOpenEl] = useState<Record<string, boolean>>({})
  const [delEx, setDelEx] = useState<EvalExercise | null>(null)
  const [delEl, setDelEl] = useState<EvalElement | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [adding, setAdding] = useState<{ area: AreaKey; name: string } | null>(null)
  // El profe ve y edita sólo las plantillas de sus categorías
  const tpls = (templates.data ?? []).filter((t) => !role.isProfe || (t.category_id && role.categoryIds.includes(t.category_id)))
  const idx = Math.max(0, tpls.findIndex((t) => t.id === tplId))
  const tpl = tpls[idx]
  const els = (elements.data ?? []).filter((e) => e.template_id === tpl?.id)
  const exOf = (elId: string) => (exercises.data ?? []).filter((x) => x.eval_exercise_elements?.some((l) => l.element_id === elId) && (!q || norm(x.name).includes(norm(q))))
  const refresh = () => qc.invalidateQueries({ queryKey: ['eval'] })
  const go = (d: number) => { const n = tpls[(idx + d + tpls.length) % tpls.length]; if (n) { setTplId(n.id); setOpenEl({}) } }

  const addElement = async () => {
    if (!adding || !tpl || !adding.name.trim()) return
    try {
      const sort = els.filter((e) => e.area === adding.area).length
      unwrap(await supabase.from('eval_elements').insert({ template_id: tpl.id, area: adding.area, name: adding.name.trim(), sort_order: sort }))
      await refresh(); setAdding(null); toast.ok('Indicador agregado')
    } catch (e) { toast.error(e) }
  }
  const rename = async () => {
    if (!renaming?.name.trim()) return
    try { unwrap(await supabase.from('eval_elements').update({ name: renaming.name.trim() }).eq('id', renaming.id)); await refresh(); setRenaming(null) } catch (e) { toast.error(e) }
  }
  const removeElement = async () => {
    if (!delEl) return
    try {
      // Los ejercicios que sólo evaluaban este indicador también se quitan
      const only = (exercises.data ?? []).filter((x) => x.eval_exercise_elements?.length === 1 && x.eval_exercise_elements[0].element_id === delEl.id).map((x) => x.id)
      if (only.length) unwrap(await supabase.from('eval_exercises').delete().in('id', only))
      unwrap(await supabase.from('eval_elements').delete().eq('id', delEl.id))
      await refresh(); toast.ok('Indicador eliminado'); setDelEl(null)
    } catch (e) { toast.error(e) }
  }
  const removeExercise = async () => {
    if (!delEx) return
    try { unwrap(await supabase.from('eval_exercises').delete().eq('id', delEx.id)); await refresh(); toast.ok('Ejercicio eliminado'); setDelEx(null) } catch (e) { toast.error(e) }
  }

  if (templates.isLoading || exercises.isLoading) return <Spinner />
  if (!(templates.data ?? []).length) return <Card className="p-6 text-sm text-warn">Falta activar el módulo en la base de datos (pegar el SQL en Supabase).</Card>
  if (!tpl) return <Card className="p-6 text-sm text-muted">No tienes categorías asignadas.</Card>
  return (
    <div className="space-y-3">
      <div className="sticky top-[57px] z-20 -mx-4 space-y-2 border-b border-ink-600 bg-page/95 px-4 py-3 backdrop-blur lg:top-0 lg:mx-0 lg:rounded-2xl lg:border">
        <div className="flex items-center gap-2">
          {tpls.length > 1 && <Button size="sm" variant="secondary" icon={ChevronLeft} onClick={() => go(-1)} aria-label="Categoría anterior" />}
          <div className="min-w-0 flex-1 text-center">
            <p className="font-display text-xl font-bold uppercase leading-tight">{tpl.name}</p>
            <p className="text-xs text-muted">Generación {tpl.generation} · {tpl.level_label} · categoría {tpl.match_name} · {idx + 1} de {tpls.length}</p>
          </div>
          {tpls.length > 1 && <Button size="sm" variant="secondary" onClick={() => go(1)} aria-label="Siguiente categoría">Siguiente <ChevronRight className="h-4 w-4" /></Button>}
        </div>
        {tpls.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {tpls.map((t) => (
              <button key={t.id} onClick={() => { setTplId(t.id); setOpenEl({}) }} className={cx('whitespace-nowrap rounded-full border px-3 py-1 text-xs', t.id === tpl.id ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 text-muted hover:text-fg')}>{t.name}</button>
            ))}
          </div>
        )}
      </div>

      <Card className="p-4">
        <p className="mb-3 font-semibold">Qué se evalúa en {tpl.name} <span className="text-xs font-normal text-muted">· toca ✎ para cambiar el nombre, 🗑 para quitar, + para agregar</span></p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AREAS.map((a) => {
            const list = els.filter((e) => e.area === a.key)
            return (
              <div key={a.key} className="rounded-xl border border-ink-600 p-3">
                <p className="mb-2 text-sm font-semibold">{a.icon} {a.label} <span className="text-xs font-normal text-muted">· {list.length}</span></p>
                <ul className="space-y-1 text-sm">
                  {list.map((e) => (
                    <li key={e.id} className="group flex items-center gap-1">
                      {renaming?.id === e.id ? (
                        <><Input autoFocus value={renaming.name} onChange={(ev) => setRenaming({ ...renaming, name: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && rename()} className="h-8 text-sm" />
                          <Button size="sm" onClick={rename}>OK</Button></>
                      ) : (
                        <><span className="min-w-0 flex-1 truncate">· {e.name}</span>
                          <button onClick={() => setRenaming({ id: e.id, name: e.name })} className="rounded p-1 text-muted hover:text-brand" aria-label={`Cambiar nombre de ${e.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDelEl(e)} className="rounded p-1 text-muted hover:text-bad" aria-label={`Quitar ${e.name}`}><Trash2 className="h-3.5 w-3.5" /></button></>
                      )}
                    </li>
                  ))}
                </ul>
                {adding?.area === a.key ? (
                  <div className="mt-2 flex gap-1"><Input autoFocus value={adding.name} onChange={(ev) => setAdding({ ...adding, name: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && addElement()} placeholder="Nuevo indicador" className="h-8 text-sm" />
                    <Button size="sm" onClick={addElement}>Agregar</Button></div>
                ) : <button onClick={() => setAdding({ area: a.key, name: '' })} className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Agregar indicador</button>}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar ejercicio" />
        <Select value={area} onChange={(e) => setArea(e.target.value as '' | AreaKey)} aria-label="Área"><option value="">Todas las áreas</option>{AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</Select>
        <Button icon={Plus} onClick={() => setEditing('new')}>Crear ejercicio</Button>
      </div>
      {AREAS.filter((a) => !area || a.key === area).map((a) => {
        const list = els.filter((e) => e.area === a.key)
        if (!list.length) return null
        return (
          <Card key={a.key}>
            <p className="border-b border-ink-600 px-5 py-3 font-display text-lg font-bold uppercase tracking-wide">{a.icon} {a.label} <span className="font-sans text-sm font-normal normal-case text-muted">· ejercicios por indicador</span></p>
            <ul className="divide-y divide-ink-700">
              {list.map((el) => {
                const xs = exOf(el.id)
                return (
                  <li key={el.id} className="px-4 py-2.5">
                    <button onClick={() => setOpenEl((o) => ({ ...o, [el.id]: !o[el.id] }))} className="flex w-full items-center justify-between text-left">
                      <span className="flex items-center gap-1.5 font-medium"><ChevronDown className={cx('h-4 w-4 text-brand transition-transform', !openEl[el.id] && '-rotate-90')} />{el.name}</span>
                      <span className="text-xs text-muted">{xs.length} ejercicio{xs.length === 1 ? '' : 's'}</span>
                    </button>
                    {openEl[el.id] && (
                      <ul className="mt-2 space-y-2 pl-6">
                        {xs.map((x) => (
                          <li key={x.id} className="rounded-xl border border-ink-600 p-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <b className="flex-1">{x.name}</b>
                              {x.difficulty && <Badge>Dificultad {x.difficulty}/5</Badge>}
                              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(x)}>Editar</Button>
                              <Button size="sm" variant="ghost" icon={Copy} onClick={() => setEditing({ ...x, id: '', name: `${x.name} (copia)` })}>Duplicar</Button>
                              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDelEx(x)} aria-label="Borrar ejercicio" />
                            </div>
                            <ExerciseInfo ex={x} />
                          </li>
                        ))}
                        {!xs.length && <li className="text-xs text-muted">Sin ejercicios. Se puede calificar con la escala general, o crea uno.</li>}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}
      {tpls.length > 1 && <div className="flex justify-end"><Button variant="secondary" onClick={() => { go(1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Siguiente categoría: {tpls[(idx + 1) % tpls.length].name} <ChevronRight className="h-4 w-4" /></Button></div>}
      {editing && <ExerciseModal exercise={editing === 'new' ? null : editing} defaultTemplate={tpl.id} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!delEx} onClose={() => setDelEx(null)} onConfirm={removeExercise} danger title="Borrar ejercicio" confirmLabel="Borrar" text={`Se borrará "${delEx?.name ?? ''}". Las evaluaciones ya hechas se conservan.`} />
      <ConfirmDialog open={!!delEl} onClose={() => setDelEl(null)} onConfirm={removeElement} danger title="Quitar indicador" confirmLabel="Quitar"
        text={`Se quitará "${delEl?.name ?? ''}" de ${tpl.name} y ya no se calificará. Sus ejercicios también se borran. Las evaluaciones ya hechas se conservan.`} />
    </div>
  )
}

function ExerciseModal({ exercise, defaultTemplate, onClose }: { exercise: EvalExercise | null; defaultTemplate?: string; onClose: () => void }) {
  const templates = useEvalTemplates()
  const elements = useEvalElements()
  const qc = useQueryClient()
  const toast = useToast()
  const isEdit = !!exercise?.id
  const [f, setF] = useState(() => ({
    name: exercise?.name ?? '', description: exercise?.description ?? '', objective: exercise?.objective ?? '', instructions: exercise?.instructions ?? '',
    material: exercise?.material ?? '', duration: exercise?.duration ?? '', repetitions: exercise?.repetitions ?? '', difficulty: String(exercise?.difficulty ?? 3),
    observations: exercise?.observations ?? '', video_url: exercise?.video_url ?? '', image_url: exercise?.image_url ?? '',
    criteria: { 1: '', 2: '', 3: '', 4: '', 5: '', ...(exercise?.criteria ?? {}) } as Record<string, string>,
  }))
  const firstEl = exercise?.eval_exercise_elements?.[0]?.element_id
  const [tplId, setTplId] = useState(() => elements.data?.find((e) => e.id === firstEl)?.template_id ?? defaultTemplate ?? '')
  const [linked, setLinked] = useState<string[]>(exercise?.eval_exercise_elements?.map((l) => l.element_id) ?? [])
  const [saving, setSaving] = useState(false)
  const [del, setDel] = useState(false)
  const els = (elements.data ?? []).filter((e) => e.template_id === tplId)
  const text = (k: keyof typeof f, label: string, area = false) => (
    <Field label={label}>{area ? <Textarea rows={2} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <Input value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>
  )
  const save = async () => {
    if (!f.name.trim()) return toast.error('Escribe el nombre del ejercicio.')
    if (!linked.length) return toast.error('Escoge al menos un indicador que evalúa.')
    setSaving(true)
    try {
      const row = {
        name: f.name.trim(), description: f.description.trim() || null, objective: f.objective.trim() || null, instructions: f.instructions.trim() || null,
        material: f.material.trim() || null, duration: f.duration.trim() || null, repetitions: f.repetitions.trim() || null, difficulty: Number(f.difficulty) || null,
        observations: f.observations.trim() || null, video_url: f.video_url.trim() || null, image_url: f.image_url.trim() || null,
        criteria: Object.fromEntries(Object.entries(f.criteria).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
      }
      let id = exercise?.id
      if (isEdit) unwrap(await supabase.from('eval_exercises').update(row).eq('id', id!))
      else id = (unwrap(await supabase.from('eval_exercises').insert(row).select('id').single()) as { id: string }).id
      unwrap(await supabase.from('eval_exercise_elements').delete().eq('exercise_id', id!))
      unwrap(await supabase.from('eval_exercise_elements').insert(linked.map((element_id) => ({ exercise_id: id, element_id }))))
      await qc.invalidateQueries({ queryKey: ['eval'] })
      toast.ok('Ejercicio guardado')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  const remove = async () => {
    try { unwrap(await supabase.from('eval_exercises').delete().eq('id', exercise!.id)); await qc.invalidateQueries({ queryKey: ['eval'] }); toast.ok('Ejercicio eliminado'); onClose() } catch (e) { toast.error(e) }
  }
  return (
    <Modal open onClose={onClose} title={isEdit ? 'Editar ejercicio' : 'Nuevo ejercicio'} wide
      footer={<>{isEdit && <Button variant="danger" className="mr-auto" icon={Trash2} onClick={() => setDel(true)}>Eliminar</Button>}<Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Save} loading={saving} onClick={save}>Guardar</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {text('name', 'Nombre *')}
          <Field label="Categoría y nivel (plantilla)">
            <Select value={tplId} onChange={(e) => { setTplId(e.target.value); setLinked([]) }}>
              <option value="">Escoge…</option>{(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        {tplId && (
          <Field label="Indicadores que evalúa (área y elemento) *">
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-ink-600 p-2">
              {AREAS.map((a) => {
                const list = els.filter((e) => e.area === a.key)
                return list.length ? (
                  <div key={a.key}><p className="text-xs font-semibold uppercase text-muted">{a.label}</p>
                    <div className="flex flex-wrap gap-1.5">{list.map((e) => {
                      const on = linked.includes(e.id)
                      return <button type="button" key={e.id} onClick={() => setLinked(on ? linked.filter((x) => x !== e.id) : [...linked, e.id])}
                        className={cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 text-muted')}>{e.name}</button>
                    })}</div></div>
                ) : null
              })}
            </div>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {text('description', 'Descripción', true)}
          {text('objective', 'Objetivo', true)}
        </div>
        {text('instructions', 'Instrucciones', true)}
        <div className="grid gap-3 sm:grid-cols-4">
          {text('material', 'Material')}
          {text('duration', 'Duración')}
          {text('repetitions', 'Repeticiones')}
          <Field label="Dificultad"><Select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        </div>
        <Field label="Criterios de evaluación (qué tiene que pasar para cada calificación)">
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="flex items-start gap-2"><span className="mt-2 w-28 shrink-0 text-xs font-semibold">{n} · {SCORE_LABEL[n]}</span>
                <Textarea rows={1} value={f.criteria[String(n)] ?? ''} onChange={(e) => setF({ ...f, criteria: { ...f.criteria, [String(n)]: e.target.value } })} /></div>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          {text('observations', 'Observaciones')}
          {text('video_url', 'Video (link, opcional)')}
          {text('image_url', 'Imagen (link, opcional)')}
        </div>
        <p className="text-xs text-muted">Área: {[...new Set(linked.map((id) => areaLabel(els.find((e) => e.id === id)?.area ?? '')))].join(', ') || '—'}</p>
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={remove} danger title="Eliminar ejercicio" confirmLabel="Eliminar" text="Las evaluaciones ya hechas con este ejercicio se conservan." />
    </Modal>
  )
}

/** Escoger categoría y luego al niño (si el profe tiene una sola categoría, sale su lista directo). */
function StudentPicker({ onPick }: { onPick: (id: string) => void }) {
  const role = useRole()
  const students = useStudents()
  const categories = useCategories()
  const evals = usePlayerEvaluations()
  const cats = (categories.data ?? []).filter((c) => !role.isProfe || role.categoryIds.includes(c.id))
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const current = cats.length === 1 ? cats[0].id : cat
  const last = new Map<string, string>()
  for (const e of evals.data ?? []) if (!last.has(e.student_id)) last.set(e.student_id, e.evaluated_on)
  const extraIds = new Set<string>()
  const list = (students.data ?? []).filter((s) => (s.status === 'activo' || s.status === 'muestra')
    && (q.trim().length >= 2 ? norm(s.full_name).includes(norm(q.trim())) && (!role.isProfe || role.categoryIds.includes(s.category_id ?? '')) : s.category_id === current || extraIds.has(s.id)))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  const count = (id: string) => (students.data ?? []).filter((s) => s.category_id === id && (s.status === 'activo' || s.status === 'muestra')).length
  return (
    <Card className="space-y-4 p-5">
      {cats.length > 1 && (
        <div>
          <p className="mb-2 font-semibold">1. Escoge la categoría</p>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button key={c.id} onClick={() => { setCat(c.id); setQ('') }}
                className={cx('rounded-xl border px-4 py-2.5 text-sm font-semibold', current === c.id ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted hover:text-fg')}>
                {c.name} <span className="font-normal opacity-70">· {count(c.id)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 font-semibold">{cats.length > 1 ? '2. ' : ''}Escoge al alumno</p>
        <SearchInput value={q} onChange={setQ} placeholder="O busca por nombre" />
      </div>
      {!current && q.trim().length < 2 ? <p className="text-sm text-muted">Toca una categoría para ver a sus alumnos.</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {list.map((s) => (
            <li key={s.id}>
              <button onClick={() => onPick(s.id)} className="flex w-full items-center gap-3 rounded-xl border border-ink-600 px-3 py-2.5 text-left hover:border-brand">
                <Avatar name={s.full_name} path={s.photo_path} size={36} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.full_name}</span>
                  <span className="text-xs text-muted">{last.has(s.id) ? `Última evaluación: ${date(last.get(s.id)!, 'd MMM yy')}` : 'Sin evaluación'}{s.status === 'muestra' ? ' · clase muestra' : ''}</span></span>
                {last.has(s.id) ? <Badge tone="ok">Evaluado</Badge> : <Badge>Evaluar</Badge>}
              </button>
            </li>
          ))}
          {!list.length && <li className="text-sm text-muted">Nadie con ese nombre.</li>}
        </ul>
      )}
    </Card>
  )
}
