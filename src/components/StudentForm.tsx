import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Save } from 'lucide-react'
import { Button, Field, Input, Modal, Select, Textarea, Avatar } from './ui'
import { useToast } from './toast'
import { useCategories, useCoaches, useSettings, primaryGuardian, type StudentRow } from '@/lib/api'
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

export default function StudentForm({ student, defaultCategory, onClose, onSaved }: {
  student?: StudentRow
  defaultCategory?: string
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const { data: categories } = useCategories()
  const { data: coaches } = useCoaches()
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const g = student ? primaryGuardian(student) : null

  const [f, setF] = useState({
    full_name: student?.full_name ?? '',
    birth_date: student?.birth_date ?? '',
    category_id: student?.category_id ?? defaultCategory ?? '',
    coach_id: student?.coach_id ?? '',
    enrolled_at: student?.enrolled_at ?? today(),
    status: (student?.status ?? 'activo') as StudentStatus,
    emergency_contact_name: student?.emergency_contact_name ?? '',
    emergency_contact_phone: student?.emergency_contact_phone ?? '',
    notes: student?.notes ?? '',
    g_name: g?.full_name ?? '',
    g_phone: g?.phone ?? '',
    g_email: g?.email ?? '',
    g_relationship: g?.relationship ?? '',
  })
  const [photo, setPhoto] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const cc = settings?.default_country_code ?? '52'
  const gPhone = f.g_phone ? normalizePhone(f.g_phone, cc) : ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (f.full_name.trim().length < 3) errs.full_name = 'Escribe el nombre completo.'
    if (f.g_phone && !isValidPhone(gPhone)) errs.g_phone = 'Teléfono inválido: usa 10 dígitos.'
    if (f.g_phone && !f.g_name.trim()) errs.g_name = 'Escribe el nombre del tutor.'
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
        emergency_contact_name: f.emergency_contact_name.trim() || null,
        emergency_contact_phone: f.emergency_contact_phone.trim() || null,
        notes: f.notes.trim() || null,
      }
      let id = student?.id
      if (id) unwrap(await supabase.from('students').update(payload).eq('id', id))
      else id = (unwrap(await supabase.from('students').insert(payload).select('id').single()) as { id: string }).id

      if (f.g_name.trim() && gPhone) {
        const gp = { full_name: f.g_name.trim(), phone: gPhone, email: f.g_email.trim() || null, relationship: f.g_relationship.trim() || null }
        if (g) unwrap(await supabase.from('guardians').update(gp).eq('id', g.id))
        else {
          const created = unwrap(await supabase.from('guardians').insert(gp).select('id').single()) as { id: string }
          unwrap(await supabase.from('student_guardians').insert({ student_id: id, guardian_id: created.id, is_primary: true }))
        }
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
          <Field label="Fecha de inscripción">
            <Input type="date" value={f.enrolled_at} onChange={set('enrolled_at')} />
          </Field>
          <Field label="Estatus">
            <Select value={f.status} onChange={set('status')}>
              <option value="activo">Activo</option>
              <option value="suspendido">Suspendido</option>
              <option value="baja">Baja</option>
            </Select>
          </Field>
        </section>

        <section>
          <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-brand">Padre, madre o tutor</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" error={errors.g_name}><Input value={f.g_name} onChange={set('g_name')} placeholder="Nombre del tutor" /></Field>
            <Field label="WhatsApp" error={errors.g_phone} hint={gPhone && isValidPhone(gPhone) ? `Se guardará como ${prettyPhone(gPhone)}` : '10 dígitos; se agrega +52 automáticamente'}>
              <Input value={f.g_phone} onChange={set('g_phone')} inputMode="tel" placeholder="81 1234 5678" />
            </Field>
            <Field label="Correo (opcional)"><Input type="email" value={f.g_email} onChange={set('g_email')} /></Field>
            <Field label="Parentesco (opcional)"><Input value={f.g_relationship} onChange={set('g_relationship')} placeholder="Mamá, papá, abuela…" /></Field>
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
