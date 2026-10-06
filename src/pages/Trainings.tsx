import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { addDays, subDays } from 'date-fns'
import { Plus, Dumbbell, Pencil, ClipboardCheck, Trash2, CalendarClock } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useAttendanceDetail, useCategories, useCoachCategories, useCoaches, useTrainings } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { ScheduleModal } from '@/components/WeeklySchedule'
import { useRole } from '@/lib/role'
import { datesFor, type Slot } from '@/lib/schedule'
import { date, time, toISODate, today } from '@/lib/format'
import { attendanceRate } from '@/lib/stats'
import type { Training } from '@/lib/types'

export default function Trainings() {
  const [weekly, setWeekly] = useState(false)
  const categories = useCategories()
  const role = useRole()
  const sinHorario = (categories.data ?? []).filter((c) => c.active && (!role.isProfe || role.categoryIds.includes(c.id)) && !(c.weekly_schedule ?? []).length)
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
      <PageHeader title="Entrenamientos" subtitle="Los días que entrena cada categoría y su asistencia."
        actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" icon={CalendarClock} onClick={() => setWeekly(true)}>Horario semanal</Button><Button icon={Plus} onClick={() => setEditing('new')}>Registrar entrenamiento</Button></div>} />
      {weekly && <ScheduleModal defaultCategory={cat || undefined} onClose={() => setWeekly(false)} />}
      {sinHorario.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-warn/50 p-4">
          <CalendarClock className="h-6 w-6 text-warn" />
          <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">Registra los horarios de tus entrenamientos</p>
            <p className="text-muted">Falta el horario de: {sinHorario.map((c) => c.name).join(', ')}. Así los entrenamientos se crean solos cada semana.</p></div>
          <Button icon={CalendarClock} onClick={() => setWeekly(true)}>Registrar horario</Button>
        </Card>
      )}
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

/** Días en que se puede registrar: los de su horario semanal (2 semanas atrás y 4 adelante). */
function scheduleDates(slots: Slot[], keep?: string) {
  const out = datesFor(slots, toISODate(subDays(new Date(), 14)), toISODate(addDays(new Date(), 28)))
  if (keep && !out.some((d) => d.date === keep)) out.push({ date: keep, start: '', end: '' })
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
}

export function TrainingModal({ training, defaultCategory, defaultDate, onClose }: { training?: Training; defaultCategory?: string; defaultDate?: string; onClose: () => void }) {
  const role = useRole()
  const { data: allCategories } = useCategories()
  const { data: cc } = useCoachCategories()
  const qc = useQueryClient()
  const toast = useToast()
  // El profe sólo registra en sus categorías
  const categories = (allCategories ?? []).filter((c) => !role.isProfe || role.categoryIds.includes(c.id))
  const [f, setF] = useState({
    category_id: training?.category_id ?? (defaultCategory && categories.some((c) => c.id === defaultCategory) ? defaultCategory : categories.length === 1 ? categories[0].id : ''),
    date: training?.date ?? defaultDate ?? '',
    start_time: training?.start_time?.slice(0, 5) ?? '',
    end_time: training?.end_time?.slice(0, 5) ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [weekly, setWeekly] = useState(false)
  const cat = categories.find((c) => c.id === f.category_id)
  const slots = (cat?.weekly_schedule ?? []) as Slot[]
  const options = slots.length ? scheduleDates(slots, training?.date) : []
  const t = today()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.category_id) return toast.error('Elige la categoría.')
    if (!f.date) return toast.error('Escoge el día del entrenamiento.')
    setSaving(true)
    try {
      // El profe que lo registra; si no, el de la categoría
      const coach = (role.coachId && role.categoryIds.includes(f.category_id) ? role.coachId : null) ?? cc?.find((x) => x.category_id === f.category_id)?.coach_id ?? null
      const payload = { category_id: f.category_id, coach_id: coach, date: f.date, start_time: f.start_time || null, end_time: f.end_time || null }
      if (training) unwrap(await supabase.from('trainings').update(payload).eq('id', training.id))
      else {
        const dup = unwrap(await supabase.from('trainings').select('id').eq('category_id', f.category_id).eq('date', f.date)) as { id: string }[]
        if (dup.length) { setSaving(false); return toast.error('Ese día ya está registrado para esta categoría.') }
        unwrap(await supabase.from('trainings').insert(payload))
      }
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
    <Modal open onClose={onClose} title={training ? 'Editar entrenamiento' : 'Registrar entrenamiento'}
      footer={<>
        {training && <Button variant="danger" icon={Trash2} className="mr-auto" onClick={() => setConfirmDel(true)}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="tr-form" loading={saving} disabled={!options.length}>Guardar</Button>
      </>}>
      <form id="tr-form" onSubmit={submit} className="space-y-4">
        <Field label="Categoría *">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, date: '' })}>
            <option value="">Elige…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {f.category_id && (!slots.length ? (
          <div className="rounded-xl border border-warn/50 bg-warn/10 p-4 text-sm">
            <p className="font-semibold">Registra los horarios de tus entrenamientos</p>
            <p className="mt-1 text-muted">{cat?.name} todavía no tiene días y horario. Escoge qué días entrena y a qué hora; después sólo eliges el día.</p>
            <Button size="sm" className="mt-3" icon={CalendarClock} onClick={() => setWeekly(true)}>Registrar horario</Button>
          </div>
        ) : (
          <Field label="Día del entrenamiento *" hint={`Sólo los días que entrena ${cat?.name}`}>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
              {options.map((o) => {
                const on = f.date === o.date
                return (
                  <button type="button" key={o.date + o.start} onClick={() => setF({ ...f, date: o.date, start_time: o.start, end_time: o.end })}
                    className={cx('rounded-xl border px-3 py-2 text-left text-sm', on ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 hover:border-brand', o.date === t && !on && 'border-brand/60')}>
                    <span className="block capitalize">{date(o.date, "EEE d 'de' MMM")}{o.date === t ? ' · hoy' : ''}</span>
                    {o.start && <span className="text-xs opacity-80">{time(o.start)}{o.end ? `–${time(o.end)}` : ''}</span>}
                  </button>
                )
              })}
            </div>
          </Field>
        ))}
      </form>
      {weekly && <ScheduleModal defaultCategory={f.category_id || undefined} onClose={() => setWeekly(false)} />}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} loading={saving} danger title="Eliminar entrenamiento" confirmLabel="Eliminar"
        text="También se eliminará la lista de asistencia de este entrenamiento. Esta acción no se puede deshacer." />
    </Modal>
  )
}
