import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, Send, UserPen, X } from 'lucide-react'
import { Avatar, Badge, Button, Card, Field, Input, Modal, Select, Textarea } from './ui'
import { useToast } from './toast'
import StudentForm, { resizeImage } from './StudentForm'
import { useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap, BUCKETS } from '@/lib/supabase'
import { getActor } from '@/lib/actor'
import { useRole } from '@/lib/role'
import { date, today } from '@/lib/format'
import { POSITIONS } from '@/pages/StudentDetail'

export interface ProfileRequest {
  id: string; student_id: string; changes: Record<string, { from: unknown; to: unknown }>
  requested_by: string | null; status: 'pendiente' | 'aprobado' | 'rechazado'; decided_by: string | null; decided_at: string | null; created_at: string
}

/** Campos que un profe puede pedir cambiar (sin dinero, categoría ni estatus). */
const FIELDS = {
  full_name: 'Nombre',
  birth_date: 'Fecha de nacimiento',
  position: 'Posición',
  uniform_size: 'Talla de uniforme',
  emergency_contact_name: 'Contacto de emergencia',
  emergency_contact_phone: 'Tel. de emergencia',
  notes: 'Notas',
  photo_path: 'Foto',
} as const
type FieldKey = keyof typeof FIELDS

export function useProfileRequests(status: ProfileRequest['status'] = 'pendiente') {
  return useQuery({
    queryKey: ['profile_requests', status],
    queryFn: async () => {
      const r = await supabase.from('student_edit_requests').select('*').eq('status', status).order('created_at', { ascending: false })
      return r.error ? [] : (r.data as ProfileRequest[])
    },
  })
}

const refreshKeys = ['profile_requests', 'students', 'student']

/**
 * Nombre del alumno que abre su perfil para editarlo.
 * Administración edita directo; el profe manda los cambios para que los confirme administración.
 */
export function EditableName({ student, children }: { student: StudentRow; children: ReactNode }) {
  const role = useRole()
  const pending = useProfileRequests('pendiente')
  const inProcess = (pending.data ?? []).some((r) => r.student_id === student.id)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Editar perfil" className="group inline-flex items-center gap-2 text-left hover:text-brand">
        {children}
        <UserPen className="h-5 w-5 shrink-0 text-muted group-hover:text-brand" />
      </button>
      {inProcess && <Badge tone="info" className="ml-2 align-middle">Cambios por confirmar</Badge>}
      {open && (role.isAdmin
        ? <StudentForm student={student} onClose={() => setOpen(false)} />
        : <ProfileRequestModal student={student} onClose={() => setOpen(false)} />)}
    </>
  )
}

function ProfileRequestModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const orig: Record<FieldKey, string> = {
    full_name: student.full_name ?? '',
    birth_date: student.birth_date ?? '',
    position: student.position ?? '',
    uniform_size: student.uniform_size ?? '',
    emergency_contact_name: student.emergency_contact_name ?? '',
    emergency_contact_phone: student.emergency_contact_phone ?? '',
    notes: student.notes ?? '',
    photo_path: student.photo_path ?? '',
  }
  const [f, setF] = useState(orig)
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: FieldKey) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const send = async () => {
    if (f.full_name.trim().length < 3) return toast.error('Escribe el nombre completo.')
    if (f.birth_date && f.birth_date > today()) return toast.error('La fecha de nacimiento no puede ser futura.')
    const changes: ProfileRequest['changes'] = {}
    for (const k of Object.keys(FIELDS) as FieldKey[]) {
      if (k === 'photo_path') continue
      const to = f[k].trim()
      if (to !== orig[k]) changes[k] = { from: orig[k] || null, to: to || null }
    }
    if (!Object.keys(changes).length && !photo) return toast.error('No cambiaste nada.')
    setSaving(true)
    try {
      if (photo) {
        // La foto se sube aparte; se pone en el perfil sólo si se aprueba
        const path = `${student.id}/propuesta-${Date.now()}.jpg`
        const { error } = await supabase.storage.from(BUCKETS.photos).upload(path, await resizeImage(photo), { contentType: 'image/jpeg', upsert: true })
        if (error) throw new Error('No se pudo subir la foto: ' + error.message)
        changes.photo_path = { from: orig.photo_path || null, to: path }
      }
      unwrap(await supabase.from('student_edit_requests').insert({ student_id: student.id, changes, requested_by: getActor() || null }))
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Cambios enviados. Administración los confirma.')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Editar perfil" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Send} loading={saving} onClick={send}>Enviar para confirmar</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          {photo ? <img src={URL.createObjectURL(photo)} alt="" className="h-16 w-16 rounded-full object-cover" /> : <Avatar name={student.full_name} path={student.photo_path} size={64} />}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-brand hover:underline">
            <Camera className="h-4 w-4" /> Cambiar foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre completo" className="sm:col-span-2"><Input value={f.full_name} onChange={set('full_name')} /></Field>
          <Field label="Fecha de nacimiento"><Input type="date" value={f.birth_date} onChange={set('birth_date')} /></Field>
          <Field label="Posición">
            <Select value={f.position} onChange={set('position')}>
              <option value="">Sin posición</option>
              {[...new Set([...POSITIONS, ...(orig.position ? [orig.position] : [])])].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Talla de uniforme"><Input value={f.uniform_size} onChange={set('uniform_size')} placeholder="Ej. 10, CH, M" /></Field>
          <Field label="Contacto de emergencia"><Input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></Field>
          <Field label="Tel. de emergencia"><Input inputMode="tel" value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></Field>
          <Field label="Notas" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <p className="text-xs text-muted">Los cambios se aplican cuando administración los confirme. Categoría y pagos no se cambian aquí.</p>
      </div>
    </Modal>
  )
}

const show = (k: string, v: unknown) => (v == null || v === '' ? '—' : k === 'birth_date' ? date(String(v)) : k === 'photo_path' ? 'nueva foto' : String(v))

/** Dashboard de administración: cambios de perfil que mandaron los profes. */
export function ProfileRequestsCard() {
  const role = useRole()
  const reqs = useProfileRequests('pendiente')
  const students = useStudents()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  if (!role.isAdmin || !reqs.data?.length) return null
  const kid = (id: string) => students.data?.find((s) => s.id === id)
  const decide = async (r: ProfileRequest, ok: boolean) => {
    setBusy(r.id)
    try {
      if (ok) {
        const patch = Object.fromEntries(Object.entries(r.changes).filter(([k]) => k in FIELDS).map(([k, v]) => [k, v.to]))
        unwrap(await supabase.from('students').update(patch).eq('id', r.student_id))
      }
      unwrap(await supabase.from('student_edit_requests').update({ status: ok ? 'aprobado' : 'rechazado', decided_by: getActor() || null, decided_at: new Date().toISOString() }).eq('id', r.id))
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(ok ? 'Cambios aplicados al perfil' : 'Cambios rechazados')
    } catch (e) { toast.error(e) } finally { setBusy('') }
  }
  return (
    <Card className="border-info/50">
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <UserPen className="h-5 w-5 text-info" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Cambios de perfil por confirmar</h2>
        <Badge tone="info">{reqs.data.length}</Badge>
      </div>
      <ul className="divide-y divide-ink-700">
        {reqs.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <Link to={`/alumnos/${r.student_id}`} className="font-semibold hover:text-brand">{kid(r.student_id)?.full_name ?? 'Alumno'}</Link>
              <span className="block text-xs text-muted">pidió {r.requested_by ?? '—'} el {date(r.created_at.slice(0, 10), 'd MMM')}</span>
              <ul className="mt-1 space-y-0.5 text-xs">
                {Object.entries(r.changes).map(([k, v]) => (
                  <li key={k}><span className="text-muted">{FIELDS[k as FieldKey] ?? k}:</span> <s className="text-muted">{show(k, v.from)}</s> → <b className="text-fg">{show(k, v.to)}</b></li>
                ))}
              </ul>
            </span>
            <Button size="sm" icon={Check} loading={busy === r.id} onClick={() => decide(r, true)}>Confirmar</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => decide(r, false)}>Rechazar</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
