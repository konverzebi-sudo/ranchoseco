import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Save } from 'lucide-react'
import { Button, Field, Input, Modal, Select, Textarea, Avatar } from './ui'
import { useToast } from './toast'
import { useCategories, useCoaches, useSettings, parentsOf, type StudentRow } from '@/lib/api'
import { supabase, unwrap, BUCKETS } from '@/lib/supabase'
import { isValidPhone, normalizePhone, prettyPhone, today } from '@/lib/format'
import type { StudentStatus } from '@/lib/types'

/** Reduce la foto a 640px antes de subirla (rápido en datos móviles). */
async function resizeImage(file: File, max = 640): Promise<Blob> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.85))
}

export async function uploadStudentPhoto(studentId: string, file: File) {
  const blob = await resizeImage(file)
  const path = `${studentId}/foto-${Date.now()}.jpg`
  const { error } = await supabase.storage.from(BUCKETS.photos).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error('No se pudo subir la foto: ' + error.message)
  unwrap(await supabase.from('students').update({ photo_path: path }).eq('id', studentId))
  return path
}

export default function StudentForm({ student, defaultCategory, defaultStatus, onClose, onSaved }: {
  student?: StudentRow
  defaultCategory?: string
  defaultStatus?: StudentStatus
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const { data: categories } = useCategories()
  const { data: coaches } = useCoaches()
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const par = student ? parentsOf(student) : { papa: null, mama: null, otros: [], all: [] }
  const otro = par.otros[0] ?? null
  const currentPrimary = par.all.find((x) => x.is_primary)

  const [f, setF] = useState({
    full_name: student?.full_name ?? '',
    birth_date: student?.birth_date ?? '',
    category_id: student?.category_id ?? defaultCategory ?? '',
    coach_id: student?.coach_id ?? '',
    enrolled_at: student?.enrolled_at ?? today(),
    status: (student?.status ?? defaultStatus ?? 'activo') as StudentStatus,
    emergency_contact_name: student?.emergency_contact_name ?? '',
    emergency_contact_phone: student?.emergency_contact_phone ?? '',
    notes: student?.notes ?? '',
    monthly_fee: student?.monthly_fee != null ? String(student.monthly_fee) : '',
    uniform_size: student?.uniform_size ?? '',
    uniform_delivered_on: student?.uniform_delivered_on ?? '',
    training_shirt_delivered_on: student?.training_shirt_delivered_on ?? '',
    credential_delivered_on: student?.credential_delivered_on ?? '',
    papa_name: par.papa?.full_name ?? '',
    papa_phone: par.papa?.phone ?? '',
    mama_name: par.mama?.full_name ?? '',
    mama_phone: par.mama?.phone ?? '',
    otro_name: otro?.full_name ?? '',
    otro_phone: otro?.phone ?? '',
    otro_rel: otro?.relationship ?? '',
    email: (currentPrimary ?? par.all[0])?.email ?? '',
    avisos: (currentPrimary && currentPrimary === par.papa ? 'papa' : currentPrimary && currentPrimary === otro ? 'otro' : par.mama || !par.papa ? 'mama' : 'papa') as 'papa' | 'mama' | 'otro',
  })
  const [photo, setPhoto] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const cc = settings?.default_country_code ?? '52'
  const phoneOf = (v: string) => (v ? normalizePhone(v, cc) : '')
  const slots = [
    { key: 'papa' as const, label: 'Papá', rel: 'Papá', name: f.papa_name, phone: phoneOf(f.papa_phone), existing: par.papa },
    { key: 'mama' as const, label: 'Mamá', rel: 'Mamá', name: f.mama_name, phone: phoneOf(f.mama_phone), existing: par.mama },
    { key: 'otro' as const, label: 'Otro tutor', rel: f.otro_rel.trim() || 'Tutor', name: f.otro_name, phone: phoneOf(f.otro_phone), existing: otro },
  ]
  const [showOtro, setShowOtro] = useState(!!otro)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (f.full_name.trim().length < 3) errs.full_name = 'Escribe el nombre completo.'
    for (const sl of slots) {
      if (sl.phone && !isValidPhone(sl.phone)) errs[`${sl.key}_phone`] = 'Teléfono inválido: usa 10 dígitos.'
      if (sl.phone && !sl.name.trim()) errs[`${sl.key}_name`] = `Escribe el nombre de ${sl.label.toLowerCase()}.`
      if (sl.name.trim() && !sl.phone) errs[`${sl.key}_phone`] = 'Escribe su WhatsApp.'
    }
    if (f.birth_date && f.birth_date > today()) errs.birth_date = 'La fecha no puede ser futura.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setSaving(true)
    try {
      const payload = {
        full_name: f.full_name.trim(),
        birth_date: f.birth_date || null,
        category_id: f.category_id || null,
        coach_id: f.coach_id || null,
        enrolled_at: f.enrolled_at || today(),
        status: f.status,
        trial_on: f.status === 'muestra' ? student?.trial_on ?? f.enrolled_at ?? today() : student?.trial_on ?? null,
        emergency_contact_name: f.emergency_contact_name.trim() || null,
        emergency_contact_phone: f.emergency_contact_phone.trim() || null,
        notes: f.notes.trim() || null,
        monthly_fee: f.monthly_fee === '' ? null : Number(f.monthly_fee),
        uniform_size: f.uniform_size.trim() || null,
        uniform_delivered_on: f.uniform_delivered_on || null,
        training_shirt_delivered_on: f.training_shirt_delivered_on || null,
        credential_delivered_on: f.credential_delivered_on || null,
      }
      let id = student?.id
      if (id) unwrap(await supabase.from('students').update(payload).eq('id', id))
      else id = (unwrap(await supabase.from('students').insert(payload).select('id').single()) as { id: string }).id

      // Papá, mamá y otro tutor: se guardan por separado; el que recibe los avisos queda como principal
      const ids: Record<string, string> = {}
      for (const sl of slots) {
        if (sl.name.trim() && sl.phone) {
          const gp = { full_name: sl.name.trim(), phone: sl.phone, relationship: sl.rel }
          if (sl.existing) { unwrap(await supabase.from('guardians').update(gp).eq('id', sl.existing.id)); ids[sl.key] = sl.existing.id }
          else {
            const created = unwrap(await supabase.from('guardians').insert(gp).select('id').single()) as { id: string }
            unwrap(await supabase.from('student_guardians').insert({ student_id: id, guardian_id: created.id, is_primary: false }))
            ids[sl.key] = created.id
          }
        } else if (sl.existing) {
          unwrap(await supabase.from('student_guardians').delete().eq('student_id', id!).eq('guardian_id', sl.existing.id))
        }
      }
      const primaryId = ids[f.avisos] ?? ids.mama ?? ids.papa ?? ids.otro
      if (primaryId) {
        unwrap(await supabase.from('student_guardians').update({ is_primary: false }).eq('student_id', id!))
        unwrap(await supabase.from('student_guardians').update({ is_primary: true }).eq('student_id', id!).eq('guardian_id', primaryId))
        if (f.email.trim() !== ((currentPrimary ?? par.all[0])?.email ?? '')) unwrap(await supabase.from('guardians').update({ email: f.email.trim() || null }).eq('id', primaryId))
      }
      if (photo) await uploadStudentPhoto(id!, photo)
      await Promise.all(['students', 'student', 'accounts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(student ? 'Cambios guardados' : 'Alumno registrado')
      onSaved?.(id!)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={student ? 'Editar alumno' : 'Nuevo alumno'} wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="student-form" icon={Save} loading={saving}>Guardar</Button>
      </>}>
      <form id="student-form" onSubmit={submit} className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={f.full_name || '?'} path={student?.photo_path} size={64} />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-ink-600 bg-ink-700 px-4 py-2.5 text-sm hover:border-ink-500">
            <Camera className="h-4 w-4" />
            {photo ? photo.name : student?.photo_path ? 'Cambiar fotografía' : 'Agregar fotografía'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
        </div>

        {!student && (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de alta">
            {([['activo', 'Inscripción', 'Se queda como alumno activo'], ['muestra', 'Clase muestra', 'Viene a probar; su registro queda pendiente']] as const).map(([v, label, text]) => (
              <button type="button" key={v} onClick={() => setF({ ...f, status: v })} aria-pressed={f.status === v}
                className={`rounded-xl border p-3 text-left ${f.status === v ? 'border-brand bg-brand-dim' : 'border-ink-600 hover:border-ink-500'}`}>
                <p className="font-semibold">{label}</p><p className="text-xs text-muted">{text}</p>
              </button>
            ))}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre completo *" error={errors.full_name} className="sm:col-span-2">
            <Input value={f.full_name} onChange={set('full_name')} autoFocus={!student} placeholder="Nombre y apellidos" />
          </Field>
          <Field label="Fecha de nacimiento" error={errors.birth_date}>
            <Input type="date" value={f.birth_date} onChange={set('birth_date')} max={today()} />
          </Field>
          <Field label="Categoría">
            <Select value={f.category_id} onChange={set('category_id')}>
              <option value="">Sin categoría</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Profesor asignado" hint="Si lo dejas vacío, se usa el profesor de la categoría.">
            <Select value={f.coach_id} onChange={set('coach_id')}>
              <option value="">El de su categoría</option>
              {coaches?.filter((c) => c.active || c.id === f.coach_id).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
          <Field label={f.status === 'muestra' ? 'Fecha de la clase muestra' : 'Fecha de inscripción'}>
            <Input type="date" value={f.enrolled_at} onChange={set('enrolled_at')} />
          </Field>
          <div className="grid gap-3 rounded-xl border border-ink-600 p-3 sm:col-span-2 sm:grid-cols-4">
            <Field label="Talla de uniforme">
              <Input value={f.uniform_size} onChange={set('uniform_size')} list="uniform-sizes" placeholder="Ej. 10, CH, M" />
            </Field>
            <datalist id="uniform-sizes">{['4', '6', '8', '10', '12', '14', '16', 'XCH', 'CH', 'M', 'G', 'XG'].map((t) => <option key={t} value={t} />)}</datalist>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
              <input type="checkbox" checked={!!f.uniform_delivered_on} onChange={(e) => setF({ ...f, uniform_delivered_on: e.target.checked ? today() : '' })} className="h-5 w-5 accent-[#F2E30A]" />
              Uniforme entregado{f.uniform_delivered_on && <span className="text-xs text-muted">({f.uniform_delivered_on.slice(8, 10)}/{f.uniform_delivered_on.slice(5, 7)})</span>}
            </label>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
              <input type="checkbox" checked={!!f.training_shirt_delivered_on} onChange={(e) => setF({ ...f, training_shirt_delivered_on: e.target.checked ? today() : '' })} className="h-5 w-5 accent-[#F2E30A]" />
              Playera de entrenamiento entregada{f.training_shirt_delivered_on && <span className="text-xs text-muted">({f.training_shirt_delivered_on.slice(8, 10)}/{f.training_shirt_delivered_on.slice(5, 7)})</span>}
            </label>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
              <input type="checkbox" checked={!!f.credential_delivered_on} onChange={(e) => setF({ ...f, credential_delivered_on: e.target.checked ? today() : '' })} className="h-5 w-5 accent-[#F2E30A]" />
              Credencial entregada{f.credential_delivered_on && <span className="text-xs text-muted">({f.credential_delivered_on.slice(8, 10)}/{f.credential_delivered_on.slice(5, 7)})</span>}
            </label>
          </div>
          <Field label="Cuota especial (beca)" hint="Vacío = cuota normal de su categoría. Ej. 300 si tiene beca parcial; 0 si es beca completa.">
            <Input type="number" min="0" inputMode="decimal" value={f.monthly_fee} onChange={set('monthly_fee')} placeholder="Cuota normal" />
          </Field>
          <Field label="Estatus">
            <Select value={f.status} onChange={set('status')}>
              <option value="activo">Activo</option>
              <option value="suspendido">Inactivo temporal</option>
              <option value="baja">Baja</option>
              <option value="muestra">Clase muestra (pendiente de inscribir)</option>
            </Select>
          </Field>
        </section>

        <section>
          <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-brand">Papá y mamá</h3>
          <div className="space-y-4">
            {slots.filter((sl) => sl.key !== 'otro' || showOtro).map((sl) => (
              <div key={sl.key} className="grid gap-3 rounded-xl border border-ink-600 p-3 sm:grid-cols-[1fr_1fr]">
                <p className="text-sm font-semibold sm:col-span-2">{sl.label}</p>
                {sl.key === 'otro' && <Field label="Parentesco" className="sm:col-span-2"><Input value={f.otro_rel} onChange={set('otro_rel')} placeholder="Abuela, tío, tutor legal…" /></Field>}
                <Field label="Nombre" error={errors[`${sl.key}_name`]}><Input value={sl.key === 'papa' ? f.papa_name : sl.key === 'mama' ? f.mama_name : f.otro_name} onChange={set(`${sl.key}_name` as keyof typeof f)} placeholder={`Nombre de ${sl.label.toLowerCase()}`} /></Field>
                <Field label="WhatsApp" error={errors[`${sl.key}_phone`]} hint={sl.phone && isValidPhone(sl.phone) ? `Se guardará como ${prettyPhone(sl.phone)}` : '10 dígitos'}>
                  <Input value={sl.key === 'papa' ? f.papa_phone : sl.key === 'mama' ? f.mama_phone : f.otro_phone} onChange={set(`${sl.key}_phone` as keyof typeof f)} inputMode="tel" placeholder="81 1234 5678" />
                </Field>
              </div>
            ))}
            {!showOtro && <button type="button" onClick={() => setShowOtro(true)} className="text-sm text-brand hover:underline">+ Agregar otro tutor (abuela, tío…)</button>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primer contacto (sale en la lista y recibe los avisos)">
                <Select value={f.avisos} onChange={(e) => setF({ ...f, avisos: e.target.value as 'papa' | 'mama' | 'otro' })}>
                  <option value="mama">Mamá</option>
                  <option value="papa">Papá</option>
                  {showOtro && <option value="otro">Otro tutor</option>}
                </Select>
              </Field>
              <Field label="Correo (opcional)"><Input type="email" value={f.email} onChange={set('email')} /></Field>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-brand">Emergencias y notas</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contacto de emergencia"><Input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></Field>
            <Field label="Teléfono de emergencia"><Input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} inputMode="tel" /></Field>
            <Field label="Observaciones" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
          </div>
        </section>
      </form>
    </Modal>
  )
}
