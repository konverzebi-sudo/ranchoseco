import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { Save } from 'lucide-react'
import { Button, Input, Modal, cx } from './ui'
import { useToast } from './toast'
import { useCategories } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { today } from '@/lib/format'
import { DOW_LONG, datesFor, scheduleText, sortSlots, type Slot } from '@/lib/schedule'
import type { Category } from '@/lib/types'
import { useRole } from '@/lib/role'

const AHEAD_DAYS = 13 // se crean los entrenamientos de hoy a 2 semanas
const plus = (d: string, n: number) => format(addDays(new Date(d + 'T12:00:00'), n), 'yyyy-MM-dd')
const slotsOf = (c: Pick<Category, 'weekly_schedule'>) => (Array.isArray(c.weekly_schedule) ? c.weekly_schedule : []) as Slot[]

/** Editor: qué días entrena y a qué hora (igual cada semana). */
export function ScheduleEditor({ value, onChange }: { value: Slot[]; onChange: (v: Slot[]) => void }) {
  const byDay = (d: number) => value.find((s) => s.dow === d)
  const last = value.at(-1)
  const set = (d: number, patch: Partial<Slot> | null) => {
    const rest = value.filter((s) => s.dow !== d)
    if (patch === null) return onChange(sortSlots(rest))
    const cur = byDay(d) ?? { dow: d, start: last?.start ?? '17:00', end: last?.end ?? '18:30' }
    onChange(sortSlots([...rest, { ...cur, ...patch }]))
  }
  return (
    <div className="space-y-1.5">
      {DOW_LONG.map((name, i) => {
        const d = i + 1
        const s = byDay(d)
        return (
          <div key={d} className={cx('flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2', s ? 'border-brand/60 bg-brand-dim' : 'border-ink-600')}>
            <label className="flex w-32 cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!!s} onChange={(e) => set(d, e.target.checked ? {} : null)} className="h-5 w-5 accent-[#F2E30A]" />
              {name}
            </label>
            {s ? (
              <div className="flex items-center gap-2 text-sm">
                <Input type="time" value={s.start} onChange={(e) => set(d, { start: e.target.value })} className="h-9 w-32" aria-label={`${name} inicio`} />
                <span className="text-muted">a</span>
                <Input type="time" value={s.end} onChange={(e) => set(d, { end: e.target.value })} className="h-9 w-32" aria-label={`${name} fin`} />
              </div>
            ) : <span className="text-xs text-muted">No entrena</span>}
          </div>
        )
      })}
      {value.length > 0 && <p className="pt-1 text-xs text-muted">Queda: <b className="text-fg">{scheduleText(value)}</b></p>}
    </div>
  )
}

/**
 * Guarda el horario de una categoría. Si cambió, los entrenamientos futuros que se crearon solos
 * (sin lista ni notas) se quitan y se vuelven a crear con el horario nuevo.
 */
export async function saveSchedule(category: Category, slots: Slot[]) {
  const before = JSON.stringify(sortSlots(slotsOf(category)))
  const now = JSON.stringify(sortSlots(slots))
  if (before === now) return
  if (slotsOf(category).length) {
    const future = unwrap(await supabase.from('trainings').select('id, objectives, exercises, notes, coach_notes')
      .eq('category_id', category.id).gt('date', today())) as { id: string; objectives: string | null; exercises: string | null; notes: string | null; coach_notes: string | null }[]
    const empty = future.filter((t) => !t.objectives && !t.exercises && !t.notes && !t.coach_notes).map((t) => t.id)
    if (empty.length) {
      const used = new Set((unwrap(await supabase.from('attendance').select('training_id').in('training_id', empty)) as { training_id: string }[]).map((a) => a.training_id))
      const drop = empty.filter((id) => !used.has(id))
      if (drop.length) unwrap(await supabase.from('trainings').delete().in('id', drop))
    }
  }
  unwrap(await supabase.from('categories').update({ weekly_schedule: sortSlots(slots), schedule: slots.length ? scheduleText(slots) : null, schedule_generated_until: null }).eq('id', category.id))
}

/** Crea solos los entrenamientos de las próximas 2 semanas según el horario de cada categoría. */
export async function generateTrainings(categories: Category[]) {
  const t = today()
  const to = plus(t, AHEAD_DAYS)
  let created = 0
  for (const c of categories) {
    const slots = slotsOf(c)
    if (!c.active || !slots.length) continue
    const from = c.schedule_generated_until && c.schedule_generated_until >= t ? plus(c.schedule_generated_until, 1) : t
    if (from > to) continue
    const want = datesFor(slots, from, to)
    const have = unwrap(await supabase.from('trainings').select('date').eq('category_id', c.id).gte('date', from).lte('date', to)) as { date: string }[]
    const haveDates = new Set(have.map((h) => h.date))
    const rows = want.filter((w) => !haveDates.has(w.date)).map((w) => ({ category_id: c.id, date: w.date, start_time: w.start, end_time: w.end || null }))
    if (rows.length) unwrap(await supabase.from('trainings').insert(rows))
    unwrap(await supabase.from('categories').update({ schedule_generated_until: to }).eq('id', c.id))
    created += rows.length
  }
  return created
}

/** Corre una vez al abrir la página. */
export function AutoTrainings() {
  const cats = useCategories()
  const qc = useQueryClient()
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current || !cats.data) return
    if (!cats.data.some((c) => slotsOf(c).length)) return
    ran.current = true
    generateTrainings(cats.data)
      .then((n) => { if (n) return Promise.all(['trainings', 'categories'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
      .catch(() => { ran.current = false })
  }, [cats.data, qc])
  return null
}

/** Entrenamientos → "Horario semanal": días y horas de cada categoría. */
export function ScheduleModal({ onClose, defaultCategory }: { onClose: () => void; defaultCategory?: string }) {
  const cats = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const role = useRole()
  const list = (cats.data ?? []).filter((c) => c.active && (!role.isProfe || role.categoryIds.includes(c.id)))
  const [cat, setCat] = useState(defaultCategory || list[0]?.id || '')
  const current = list.find((c) => c.id === cat)
  const [slots, setSlots] = useState<Slot[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!cat && list[0]) setCat(list[0].id) }, [cat, list])
  useEffect(() => { setSlots(current ? sortSlots(slotsOf(current)) : []) }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!current && JSON.stringify(sortSlots(slotsOf(current))) !== JSON.stringify(sortSlots(slots))
  const save = async () => {
    if (!current) return
    if (slots.some((s) => !s.start)) return toast.error('Pon la hora de inicio de cada día.')
    setSaving(true)
    try {
      await saveSchedule(current, slots)
      const fresh = unwrap(await supabase.from('categories').select('*').eq('id', current.id)) as Category[]
      const n = await generateTrainings(fresh)
      await Promise.all(['categories', 'trainings'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(`Horario de ${current.name} guardado${n ? ` · ${n} entrenamientos creados` : ''}`)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title="Horario semanal de entrenamientos"
      footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={Save} loading={saving} disabled={!dirty} onClick={save}>Guardar horario</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Escoge la categoría, marca los días que entrena y a qué hora. Cada semana se crean solos esos entrenamientos (se ven en el calendario y en el pase de lista).</p>
        <div className="flex flex-wrap gap-2">
          {list.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={cx('rounded-xl border px-3 py-1.5 text-sm', c.id === cat ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 text-muted hover:text-fg')}>
              {c.name}{slotsOf(c).length ? '' : ' ·  sin horario'}
            </button>
          ))}
        </div>
        {current && <ScheduleEditor value={slots} onChange={setSlots} />}
        <p className="text-xs text-muted">Si cambias el horario, los entrenamientos que vienen y aún no tienen lista se acomodan al nuevo. Si un día no hay entrenamiento (festivo, lluvia), bórralo en Entrenamientos y no vuelve a aparecer.</p>
      </div>
    </Modal>
  )
}
