import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Layers, Trash2, Users, Clock } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Modal, PageHeader, Spinner, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoaches, useSettings, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money } from '@/lib/format'
import type { Category } from '@/lib/types'

export default function Categories() {
  const categories = useCategories()
  const students = useStudents()
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const { data: settings } = useSettings()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)

  if (categories.error) return <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
  return (
    <>
      <PageHeader title="Categorías" subtitle="Grupos de entrenamiento, profesores asignados y mensualidad."
        actions={<Button icon={Plus} onClick={() => setEditing('new')}>Nueva categoría</Button>} />
      {categories.isLoading ? <Spinner /> : !categories.data?.length ? (
        <Card><Empty icon={Layers} title="Aún no hay categorías" action={<Button icon={Plus} onClick={() => setEditing('new')}>Crear categoría</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {categories.data.map((c) => {
            const n = (students.data ?? []).filter((s) => s.category_id === c.id && s.status === 'activo').length
            const coachNames = (cc.data ?? []).filter((x) => x.category_id === c.id).map((x) => coaches.data?.find((k) => k.id === x.coach_id)?.full_name).filter(Boolean)
            return (
              <Card key={c.id} className={cx('p-5', !c.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-2xl font-bold uppercase tracking-wide">{c.name}</h3>
                    {c.description && <p className="text-sm text-muted">{c.description}</p>}
                  </div>
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(c)} aria-label={`Editar ${c.name}`} />
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <Link to={`/alumnos?cat=${c.id}`} className="flex items-center gap-2 hover:text-brand"><Users className="h-4 w-4 text-brand" /> {n} alumnos activos</Link>
                  <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-brand" /> {c.schedule || <span className="text-muted">Horario sin definir</span>}</p>
                  <p className="text-muted">Profesor: <span className="text-white">{coachNames.join(', ') || 'Sin asignar'}</span></p>
                  <p className="text-muted">Mensualidad: <span className="text-white">{c.monthly_fee ? money(c.monthly_fee) : settings?.default_monthly_fee ? `${money(settings.default_monthly_fee)} (general)` : 'Sin definir'}</span></p>
                </div>
                {!c.active && <Badge className="mt-3">Inactiva</Badge>}
              </Card>
            )
          })}
        </div>
      )}
      {editing && <CategoryModal category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CategoryModal({ category, onClose }: { category?: Category; onClose: () => void }) {
  const { data: coaches } = useCoaches()
  const { data: cc } = useCoachCategories()
  const { data: categories } = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({
    name: category?.name ?? '', description: category?.description ?? '', schedule: category?.schedule ?? '',
    monthly_fee: category?.monthly_fee != null ? String(category.monthly_fee) : '', active: category?.active ?? true,
  })
  const [assigned, setAssigned] = useState<Set<string>>(new Set((cc ?? []).filter((x) => x.category_id === category?.id).map((x) => x.coach_id)))
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast.error('Escribe el nombre de la categoría.')
    setSaving(true)
    try {
      const payload = {
        name: f.name.trim(), description: f.description.trim() || null, schedule: f.schedule.trim() || null,
        monthly_fee: f.monthly_fee ? Number(f.monthly_fee) : null, active: f.active,
        ...(category ? {} : { sort_order: (categories?.length ?? 0) }),
      }
      let id = category?.id
      if (id) unwrap(await supabase.from('categories').update(payload).eq('id', id))
      else id = (unwrap(await supabase.from('categories').insert(payload).select('id').single()) as { id: string }).id
      unwrap(await supabase.from('coach_categories').delete().eq('category_id', id!))
      if (assigned.size) unwrap(await supabase.from('coach_categories').insert([...assigned].map((coach_id) => ({ coach_id, category_id: id }))))
      await Promise.all(['categories', 'coach_categories'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Categoría guardada')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  const remove = async () => {
    setSaving(true)
    try {
      unwrap(await supabase.from('categories').delete().eq('id', category!.id))
      await Promise.all(['categories', 'students', 'coach_categories'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Categoría eliminada')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={category ? 'Editar categoría' : 'Nueva categoría'}
      footer={<>
        {category && <Button variant="danger" icon={Trash2} onClick={() => setConfirmDel(true)} className="mr-auto">Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="cat-form" loading={saving}>Guardar</Button>
      </>}>
      <form id="cat-form" onSubmit={submit} className="space-y-4">
        <Field label="Nombre *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. 2014 o Sub-12" autoFocus /></Field>
        <Field label="Descripción"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Nacidos en 2014" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Horario"><Input value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} placeholder="Lun y Mié 6:00 pm" /></Field>
          <Field label="Mensualidad" hint="Vacío = usar la mensualidad general"><Input type="number" inputMode="decimal" min="0" value={f.monthly_fee} onChange={(e) => setF({ ...f, monthly_fee: e.target.value })} /></Field>
        </div>
        <Field label="Profesor de la categoría" hint="Cada categoría tiene un solo profesor. Un profesor puede llevar varias categorías.">
          {coaches?.length ? (
            <div className="flex flex-wrap gap-2">
              {coaches.filter((c) => c.active || assigned.has(c.id)).map((c) => {
                const on = assigned.has(c.id)
                return (
                  <button type="button" key={c.id} onClick={() => setAssigned(on ? new Set() : new Set([c.id]))}
                    className={cx('rounded-xl border px-3 py-2 text-sm', on ? 'border-brand bg-brand text-ink font-semibold' : 'border-ink-600 text-muted hover:text-white')}>
                    {c.full_name}
                  </button>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted">Primero registra profesores en la sección Profesores.</p>}
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[#F2E30A]" /> Categoría activa</label>
      </form>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} loading={saving} danger title="Eliminar categoría" confirmLabel="Eliminar"
        text={<>Se eliminará <b>{category?.name}</b> junto con sus entrenamientos y partidos. Los alumnos se conservan pero quedarán sin categoría. Esta acción no se puede deshacer. Si sólo ya no se usa, mejor desmarca "Categoría activa".</>} />
    </Modal>
  )
}

