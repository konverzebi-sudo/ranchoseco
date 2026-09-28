import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import { Plus, Dumbbell, Pencil, ClipboardCheck, Trash2 } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useAttendanceDetail, useCategories, useCoachCategories, useCoaches, useTrainings } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { date, time, toISODate, today } from '@/lib/format'
import { attendanceRate } from '@/lib/stats'
import type { Training } from '@/lib/types'

export default function Trainings() {
  const categories = useCategories()
  const coaches = useCoaches()
  const [cat, setCat] = useState('')
  const [from, setFrom] = useState(toISODate(subDays(new Date(), 30)))
  const trainings = useTrainings({ categoryId: cat || undefined, from })
  const att = useAttendanceDetail({ categoryId: cat || undefined, from })
  const [editing, setEditing] = useState<Training | 'new' | null>(null)
  const nav = useNavigate()

  const attByTraining = useMemo(() => {
    const m = new Map<string, { status: string }[]>()
    for (const a of att.data ?? []) m.set(a.training_id, [...(m.get(a.training_id) ?? []), a])
    return m
  }, [att.data])

  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? ''
  const coachName = (id: string | null) => coaches.data?.find((c) => c.id === id)?.full_name

  return (
    <>
      <PageHeader title="Entrenamientos" subtitle="Objetivos, ejercicios y asistencia de cada sesión."
        actions={<Button icon={Plus} onClick={() => setEditing('new')}>Registrar entrenamiento</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px]">
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
      </div>
      {trainings.error ? <ErrorState error={trainings.error} /> : trainings.isLoading ? <Spinner /> : !trainings.data?.length ? (
        <Card><Empty icon={Dumbbell} title="Sin entrenamientos en este periodo" text="Al pasar lista se crea automáticamente el entrenamiento del día. También puedes registrarlo aquí con objetivos y ejercicios."
          action={<Button icon={Plus} onClick={() => setEditing('new')}>Registrar entrenamiento</Button>} /></Card>
      ) : (
        <ul className="space-y-2">
          {trainings.data.map((t) => {
            const list = attByTraining.get(t.id) ?? []
            const rate = attendanceRate(list)
            return (
              <li key={t.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="w-16 shrink-0 rounded-xl bg-ink-900 py-2 text-center">
                      <p className="text-xs uppercase text-muted">{date(t.date, 'MMM')}</p>
                      <p className="font-display text-2xl font-bold leading-none">{date(t.date, 'd')}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">{catName(t.category_id)}</Badge>
                        <span className="text-sm text-muted">{date(t.date, 'EEEE')} {time(t.start_time)}{t.end_time ? `–${time(t.end_time)}` : ''}</span>
                      </div>
                      <p className="mt-1 font-medium">{t.objectives || 'Entrenamiento'}</p>
                      {t.exercises && <p className="mt-1 whitespace-pre-line text-sm text-muted">{t.exercises}</p>}
                      {t.notes && <p className="mt-1 text-sm text-muted">Obs.: {t.notes}</p>}
                      <p className="mt-2 text-xs text-muted">{coachName(t.coach_id) ?? 'Profesor sin especificar'} · {list.length ? `Asistencia ${rate}% (${list.length} registros)` : 'Sin lista'}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => { try { localStorage.setItem('ranchoseco-ultima-categoria', t.category_id) } catch { /* */ } nav('/asistencias') }}>Lista</Button>
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(t)} aria-label="Editar" />
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <TrainingModal training={editing === 'new' ? undefined : editing} defaultCategory={cat} onClose={() => setEditing(null)} />}
    </>
  )
}

export function TrainingModal({ training, defaultCategory, defaultDate, onClose }: { training?: Training; defaultCategory?: string; defaultDate?: string; onClose: () => void }) {
  const { data: categories } = useCategories()
  const { data: coaches } = useCoaches()
  const { data: cc } = useCoachCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({
    category_id: training?.category_id ?? defaultCategory ?? '',
    coach_id: training?.coach_id ?? '',
    date: training?.date ?? defaultDate ?? today(),
    start_time: training?.start_time?.slice(0, 5) ?? '',
    end_time: training?.end_time?.slice(0, 5) ?? '',
    objectives: training?.objectives ?? '',
    exercises: training?.exercises ?? '',
    notes: training?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.category_id) return toast.error('Elige la categoría.')
    if (f.start_time && f.end_time && f.end_time <= f.start_time) return toast.error('La hora de fin debe ser posterior al inicio.')
    setSaving(true)
    try {
      const coach = f.coach_id || cc?.find((x) => x.category_id === f.category_id)?.coach_id || null
      const payload = { ...f, coach_id: coach, start_time: f.start_time || null, end_time: f.end_time || null,
        objectives: f.objectives.trim() || null, exercises: f.exercises.trim() || null, notes: f.notes.trim() || null }
      if (training) unwrap(await supabase.from('trainings').update(payload).eq('id', training.id))
      else unwrap(await supabase.from('trainings').insert(payload))
      await qc.invalidateQueries({ queryKey: ['trainings'] })
      toast.ok('Entrenamiento guardado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }
  const remove = async () => {
    setSaving(true)
    try {
      unwrap(await supabase.from('trainings').delete().eq('id', training!.id))
      await Promise.all(['trainings', 'attendance'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Entrenamiento eliminado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={training ? 'Editar entrenamiento' : 'Registrar entrenamiento'} wide
      footer={<>
        {training && <Button variant="danger" icon={Trash2} className="mr-auto" onClick={() => setConfirmDel(true)}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="tr-form" loading={saving}>Guardar</Button>
      </>}>
      <form id="tr-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría *">
            <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">Elige…</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Profesor">
            <Select value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}>
              <option value="">El de la categoría</option>
              {coaches?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Fecha"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio"><Input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></Field>
            <Field label="Fin"><Input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></Field>
          </div>
        </div>
        <Field label="Objetivos"><Input value={f.objectives} onChange={(e) => setF({ ...f, objectives: e.target.value })} placeholder="Ej. Pase corto y desmarque" /></Field>
        <Field label="Ejercicios realizados"><Textarea value={f.exercises} onChange={(e) => setF({ ...f, exercises: e.target.value })} placeholder="Un ejercicio por línea" /></Field>
        <Field label="Observaciones"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></Field>
      </form>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} loading={saving} danger title="Eliminar entrenamiento" confirmLabel="Eliminar"
        text="También se eliminará la lista de asistencia de este entrenamiento. Esta acción no se puede deshacer." />
    </Modal>
  )
}
