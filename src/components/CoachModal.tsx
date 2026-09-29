import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2, Receipt, Lock, History } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input, Modal, Select, Spinner, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useCoachCategories, useCoachPay, useCoachPayHistory, useSettings } from '@/lib/api'
import { FREQUENCY_LABEL, monthlyCost } from '@/lib/finance'
import { useCategoryOwners } from '@/components/CoachCategoryPicker'
import { supabase, unwrap } from '@/lib/supabase'
import { date, isValidPhone, money, normalizePhone, prettyPhone, today } from '@/lib/format'
import type { Coach, CoachPay } from '@/lib/types'

/** Ficha del profesor: datos, sueldo (con historial de cambios) y categorías. */
export default function CoachModal({ coach, onClose }: { coach?: Coach; onClose: () => void }) {
  const { data: categories } = useCategories()
  const { data: cc } = useCoachCategories()
  const { data: settings } = useSettings()
  const { data: pays } = useCoachPay()
  const history = useCoachPayHistory(coach?.id)
  const current = pays?.find((p) => p.coach_id === coach?.id)
  const owners = useCategoryOwners()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ full_name: coach?.full_name ?? '', phone: coach?.phone ?? '', email: coach?.email ?? '', active: coach?.active ?? true })
  const [cats, setCats] = useState<Set<string>>(new Set((cc ?? []).filter((x) => x.coach_id === coach?.id).map((x) => x.category_id)))
  const [salary, setSalary] = useState(current ? String(current.amount) : '')
  const [frequency, setFrequency] = useState<CoachPay['frequency']>(current?.frequency ?? 'semanal')
  const [saving, setSaving] = useState(false)
  const [change, setChange] = useState({ date: today(), reason: '', responsibilities: '' })
  const salaryChanged = salary !== '' && (!current || Number(salary) !== Number(current.amount) || frequency !== current.frequency)
  const [confirmDel, setConfirmDel] = useState<'borrar' | 'gasto' | null>(null)
  const phone = f.phone ? normalizePhone(f.phone, settings?.default_country_code ?? '52') : ''

  const remove = async (toExpense: boolean) => {
    if (!coach) return
    setSaving(true)
    try {
      if (toExpense && current) {
        unwrap(await supabase.from('expenses').insert({ name: coach.full_name, amount: current.amount, frequency: current.frequency, notes: 'Sueldo', sort_order: 99 }))
      }
      unwrap(await supabase.from('coaches').delete().eq('id', coach.id))
      await Promise.all(['coaches', 'coach_categories', 'coach_pay', 'expenses'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(toExpense ? `${coach.full_name} ahora está en Gastos generales` : 'Profesor eliminado')
      setConfirmDel(null)
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.full_name.trim()) return toast.error('Escribe el nombre del profesor.')
    if (phone && !isValidPhone(phone)) return toast.error('Teléfono inválido: usa 10 dígitos.')
    if (salary !== '' && !(Number(salary) >= 0)) return toast.error('El sueldo debe ser un número positivo.')
    if (salaryChanged && current && !change.reason.trim()) return toast.error('Escribe el motivo del cambio de sueldo.')
    setSaving(true)
    try {
      const payload = { full_name: f.full_name.trim(), phone: phone || null, email: f.email.trim() || null, active: f.active }
      let id = coach?.id
      if (id) unwrap(await supabase.from('coaches').update(payload).eq('id', id))
      else id = (unwrap(await supabase.from('coaches').insert(payload).select('id').single()) as { id: string }).id
      unwrap(await supabase.from('coach_categories').delete().eq('coach_id', id!))
      if (cats.size) unwrap(await supabase.from('coach_categories').insert([...cats].map((category_id) => ({ coach_id: id, category_id }))))
      if (salary !== '') unwrap(await supabase.from('coach_pay').upsert({ coach_id: id, amount: Number(salary), frequency, updated_at: new Date().toISOString() }))
      if (salaryChanged) {
        unwrap(await supabase.from('coach_pay_history').insert({
          coach_id: id, amount: Number(salary), frequency, previous_amount: current ? current.amount : null,
          effective_date: change.date || today(),
          reason: change.reason.trim() || (current ? null : 'Sueldo inicial'),
          responsibilities: change.responsibilities.trim() || null,
        }))
      }
      else if (current) unwrap(await supabase.from('coach_pay').delete().eq('coach_id', id!))
      await Promise.all(['coaches', 'coach_categories', 'coach_pay', 'coach_pay_history'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(salaryChanged && current ? 'Sueldo actualizado y guardado en el historial' : 'Profesor guardado')
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={coach ? 'Editar profesor' : 'Nuevo profesor'}
      footer={<>
        {coach && <Button variant="danger" icon={Trash2} className="mr-auto" onClick={() => setConfirmDel('borrar')}>Eliminar</Button>}
        {coach && current && <Button variant="ghost" icon={Receipt} onClick={() => setConfirmDel('gasto')}>Pasar a gastos generales</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="coach-form" loading={saving}>Guardar</Button>
      </>}>
      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => remove(confirmDel === 'gasto')} loading={saving} danger={confirmDel === 'borrar'}
        title={confirmDel === 'gasto' ? 'Pasar a gastos generales' : 'Eliminar profesor'}
        confirmLabel={confirmDel === 'gasto' ? 'Pasar a gastos' : 'Eliminar'}
        text={confirmDel === 'gasto'
          ? <>{coach?.full_name} dejará de estar en Profesores y su sueldo ({money(current?.amount ?? 0)} {current ? FREQUENCY_LABEL[current.frequency] : ''}) se agregará en <b className="text-white">Gastos generales</b>, repartido entre todos los alumnos.</>
          : <>Se eliminará a {coach?.full_name} con su sueldo y sus categorías. Los alumnos, entrenamientos y evaluaciones se conservan. Si sólo dejó de trabajar temporalmente, mejor desmarca "Profesor activo".</>} />
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
        {salaryChanged && current && (
          <div className="space-y-3 rounded-xl border border-brand/40 bg-brand-dim p-3">
            <p className="text-sm">Cambio de sueldo: <b>{money(current.amount)}</b> {FREQUENCY_LABEL[current.frequency]} → <b className="text-brand">{money(Number(salary))}</b> {FREQUENCY_LABEL[frequency]}</p>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <Field label="¿Desde cuándo?"><Input type="date" value={change.date} onChange={(e) => setChange({ ...change, date: e.target.value })} /></Field>
              <Field label="Motivo del cambio *"><Input value={change.reason} onChange={(e) => setChange({ ...change, reason: e.target.value })} placeholder="Ej. Aumento por antigüedad, toma otra categoría…" /></Field>
            </div>
            <Field label="Nuevas responsabilidades (opcional)"><Textarea rows={2} value={change.responsibilities} onChange={(e) => setChange({ ...change, responsibilities: e.target.value })} placeholder="Ej. Ahora también entrena a Porteros los sábados" /></Field>
          </div>
        )}
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
        {coach && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4 text-brand" /> Historial de sueldo</p>
            {history.isLoading ? <Spinner /> : !history.data?.length ? (
              <p className="rounded-xl border border-ink-600 px-3 py-3 text-sm text-muted">Sin cambios registrados todavía.</p>
            ) : (
              <ol className="divide-y divide-ink-700 rounded-xl border border-ink-600">
                {history.data.map((h) => (
                  <li key={h.id} className="px-3 py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{money(h.amount)} <span className="font-normal text-muted">{FREQUENCY_LABEL[h.frequency]}</span>
                        {h.previous_amount != null && <span className={cx('ml-2 text-xs', Number(h.amount) >= Number(h.previous_amount) ? 'text-ok' : 'text-bad')}>
                          {Number(h.amount) >= Number(h.previous_amount) ? '▲' : '▼'} antes {money(h.previous_amount)}</span>}
                      </span>
                      <span className="text-xs text-muted">Desde {date(h.effective_date)}</span>
                    </div>
                    {h.reason && <p className="text-muted">{h.reason}</p>}
                    {h.responsibilities && <p className="text-xs"><span className="text-brand">Responsabilidades:</span> {h.responsibilities}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[#F2E30A]" /> Profesor activo</label>
      </form>
    </Modal>
  )
}
