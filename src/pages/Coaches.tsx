import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, UserCog, MessageCircle } from 'lucide-react'
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useSettings, useStudents } from '@/lib/api'
import { FREQUENCY_LABEL, monthlyCost } from '@/lib/finance'
import { useCategoryOwners } from '@/components/CoachCategoryPicker'
import { Lock } from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { isValidPhone, normalizePhone, prettyPhone } from '@/lib/format'
import { waLink } from '@/lib/whatsapp'
import type { Coach, CoachPay } from '@/lib/types'
import { money } from '@/lib/format'

export default function Coaches() {
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const categories = useCategories()
  const students = useStudents()
  const pay = useCoachPay()
  const [editing, setEditing] = useState<Coach | 'new' | null>(null)

  if (coaches.error) return <ErrorState error={coaches.error} onRetry={() => coaches.refetch()} />
  return (
    <>
      <PageHeader title="Profesores" subtitle="Cada profesor puede llevar una o varias categorías."
        actions={<Button icon={Plus} onClick={() => setEditing('new')}>Nuevo profesor</Button>} />
      {coaches.isLoading ? <Spinner /> : !coaches.data?.length ? (
        <Card><Empty icon={UserCog} title="Aún no hay profesores" text="Regístralos y asígnales sus categorías." action={<Button icon={Plus} onClick={() => setEditing('new')}>Registrar profesor</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {coaches.data.map((c) => {
            const cats = (cc.data ?? []).filter((x) => x.coach_id === c.id).map((x) => x.category_id)
            const n = (students.data ?? []).filter((s) => s.status === 'activo' && (s.coach_id === c.id || (!s.coach_id && cats.includes(s.category_id ?? '')))).length
            return (
              <Card key={c.id} className={cx('p-5', !c.active && 'opacity-60')}>
                <div className="flex items-center gap-3">
                  <Avatar name={c.full_name} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-xl font-bold uppercase">{c.full_name}</p>
                    <p className="text-sm text-muted">{n} alumnos{!c.active && ' · Inactivo'}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(c)} aria-label={`Editar ${c.full_name}`} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {cats.length ? cats.map((id) => <Badge key={id} tone="brand">{categories.data?.find((k) => k.id === id)?.name}</Badge>) : <span className="text-sm text-muted">Sin categorías asignadas</span>}
                </div>
                {(() => {
                  const p = pay.data?.find((x) => x.coach_id === c.id)
                  return p ? (
                    <p className="mt-3 text-sm">
                      Sueldo: <span className="font-semibold">{money(p.amount)}</span> <span className="text-muted">{FREQUENCY_LABEL[p.frequency]}</span>
                      {p.frequency !== 'mensual' && <span className="text-muted"> · ≈ {money(Math.round(monthlyCost(p)))} al mes</span>}
                      {cats.length > 1 && <span className="block text-xs text-muted">Se reparte entre sus {cats.length} categorías en los reportes</span>}
                    </p>
                  ) : <p className="mt-3 text-sm text-muted">Sin sueldo registrado</p>
                })()}
                {c.phone && (
                  <a href={waLink(c.phone, `Hola ${c.full_name.split(' ')[0]}`)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-wa hover:underline">
                    <MessageCircle className="h-4 w-4" /> {prettyPhone(c.phone)}
                  </a>
                )}
              </Card>
            )
          })}
        </div>
      )}
      {editing && <CoachModal coach={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CoachModal({ coach, onClose }: { coach?: Coach; onClose: () => void }) {
  const { data: categories } = useCategories()
  const { data: cc } = useCoachCategories()
  const { data: settings } = useSettings()
  const { data: pays } = useCoachPay()
  const current = pays?.find((p) => p.coach_id === coach?.id)
  const owners = useCategoryOwners()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ full_name: coach?.full_name ?? '', phone: coach?.phone ?? '', email: coach?.email ?? '', active: coach?.active ?? true })
  const [cats, setCats] = useState<Set<string>>(new Set((cc ?? []).filter((x) => x.coach_id === coach?.id).map((x) => x.category_id)))
  const [salary, setSalary] = useState(current ? String(current.amount) : '')
  const [frequency, setFrequency] = useState<CoachPay['frequency']>(current?.frequency ?? 'semanal')
  const [saving, setSaving] = useState(false)
  const phone = f.phone ? normalizePhone(f.phone, settings?.default_country_code ?? '52') : ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.full_name.trim()) return toast.error('Escribe el nombre del profesor.')
    if (phone && !isValidPhone(phone)) return toast.error('Teléfono inválido: usa 10 dígitos.')
    if (salary !== '' && !(Number(salary) >= 0)) return toast.error('El sueldo debe ser un número positivo.')
    setSaving(true)
    try {
      const payload = { full_name: f.full_name.trim(), phone: phone || null, email: f.email.trim() || null, active: f.active }
      let id = coach?.id
      if (id) unwrap(await supabase.from('coaches').update(payload).eq('id', id))
      else id = (unwrap(await supabase.from('coaches').insert(payload).select('id').single()) as { id: string }).id
      unwrap(await supabase.from('coach_categories').delete().eq('coach_id', id!))
      if (cats.size) unwrap(await supabase.from('coach_categories').insert([...cats].map((category_id) => ({ coach_id: id, category_id }))))
      if (salary !== '') unwrap(await supabase.from('coach_pay').upsert({ coach_id: id, amount: Number(salary), frequency, updated_at: new Date().toISOString() }))
      else if (current) unwrap(await supabase.from('coach_pay').delete().eq('coach_id', id!))
      await Promise.all(['coaches', 'coach_categories', 'coach_pay'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Profesor guardado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={coach ? 'Editar profesor' : 'Nuevo profesor'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="coach-form" loading={saving}>Guardar</Button></>}>
      <form id="coach-form" onSubmit={submit} className="space-y-4">
        <Field label="Nombre completo *"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="WhatsApp" hint={phone && isValidPhone(phone) ? prettyPhone(phone) : undefined}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="81 1234 5678" /></Field>
          <Field label="Correo"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sueldo" hint={salary && frequency !== 'mensual' ? `≈ ${money(Math.round(monthlyCost({ amount: Number(salary), frequency })))} al mes` : 'Se descuenta en el reporte por categoría'}>
            <Input type="number" min="0" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Ej. 750" />
          </Field>
          <Field label="Se paga">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as CoachPay['frequency'])}>
              <option value="semanal">Cada semana</option>
              <option value="quincenal">Cada quincena</option>
              <option value="mensual">Cada mes</option>
            </Select>
          </Field>
        </div>
        <Field label="Categorías que entrena">
          <div className="flex flex-wrap gap-2">
            {categories?.map((c) => {
              const on = cats.has(c.id)
              const owner = owners.get(c.id)
              const lockedBy = owner && owner.id !== coach?.id ? owner.name : null
              return (
                <button type="button" key={c.id} disabled={!!lockedBy} title={lockedBy ? `Asignada a ${lockedBy}` : undefined}
                  onClick={() => setCats((s) => { const n = new Set(s); on ? n.delete(c.id) : n.add(c.id); return n })}
                  className={cx('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm',
                    lockedBy ? 'cursor-not-allowed border-ink-700 text-ink-500' : on ? 'border-brand bg-brand font-semibold text-ink' : 'border-ink-600 text-muted hover:text-white')}>
                  {lockedBy && <Lock className="h-3.5 w-3.5" />}
                  {c.name}{lockedBy && <span className="text-xs"> · {lockedBy}</span>}
                </button>
              )
            })}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[#F2E30A]" /> Profesor activo</label>
      </form>
    </Modal>
  )
}
