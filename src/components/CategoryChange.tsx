import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Check, X } from 'lucide-react'
import { Badge, Button, Card, Field, Input, Modal, Select } from './ui'
import { useToast } from './toast'
import { useCategories, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor } from '@/lib/actor'
import { useRole } from '@/lib/role'
import { date } from '@/lib/format'

export interface CategoryRequest {
  id: string; student_id: string; from_category: string | null; to_category: string; reason: string | null
  requested_by: string | null; status: 'pendiente' | 'aprobado' | 'rechazado'; decided_by: string | null; decided_at: string | null; created_at: string
}

export function useCategoryRequests(status: CategoryRequest['status'] | 'todas' = 'pendiente') {
  return useQuery({
    queryKey: ['category_requests', status],
    queryFn: async () => {
      let q = supabase.from('category_change_requests').select('*').order('created_at', { ascending: false })
      if (status !== 'todas') q = q.eq('status', status)
      const r = await q
      return r.error ? [] : (r.data as CategoryRequest[])
    },
  })
}

const refreshKeys = ['category_requests', 'students', 'student']

/** Perfil del alumno: el coordinador y administración cambian directo; el profe lo solicita. */
export function CategoryChangeButton({ student }: { student: StudentRow }) {
  const role = useRole()
  const pending = useCategoryRequests('pendiente')
  const mine = (pending.data ?? []).find((r) => r.student_id === student.id)
  const [open, setOpen] = useState(false)
  if (mine) return <Badge tone="info">Cambio de categoría en proceso</Badge>
  return (
    <>
      <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setOpen(true)}>{role.canMoveCategory ? 'Cambiar de categoría' : 'Solicitar cambio de categoría'}</Button>
      {open && <CategoryChangeModal student={student} direct={role.canMoveCategory} onClose={() => setOpen(false)} />}
    </>
  )
}

function CategoryChangeModal({ student, direct, onClose }: { student: StudentRow; direct: boolean; onClose: () => void }) {
  const cats = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const current = cats.data?.find((c) => c.id === student.category_id)
  const save = async () => {
    if (!to) return toast.error('Escoge la nueva categoría.')
    if (!direct && reason.trim().length < 3) return toast.error('Escribe por qué se cambia.')
    setSaving(true)
    try {
      const who = getActor() || null
      const row = { student_id: student.id, from_category: student.category_id, to_category: to, reason: reason.trim() || null, requested_by: who }
      if (direct) {
        unwrap(await supabase.from('students').update({ category_id: to }).eq('id', student.id))
        // Queda en el historial como aprobado
        await supabase.from('category_change_requests').insert({ ...row, status: 'aprobado', decided_by: who, decided_at: new Date().toISOString() })
        toast.ok(`${student.full_name.split(' ')[0]} quedó en ${cats.data?.find((c) => c.id === to)?.name}`)
      } else {
        unwrap(await supabase.from('category_change_requests').insert(row))
        toast.ok('Solicitud enviada. La aprueba el coordinador o administración.')
      }
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={direct ? 'Cambiar de categoría' : 'Solicitar cambio de categoría'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={ArrowRightLeft} loading={saving} onClick={save}>{direct ? 'Cambiar' : 'Enviar solicitud'}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm"><b>{student.full_name}</b> está en <b>{current?.name ?? 'sin categoría'}</b>.</p>
        <Field label="Pasarlo a *">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Escoge la categoría…</option>
            {(cats.data ?? []).filter((c) => c.active && !c.is_extra && c.id !== student.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={direct ? 'Motivo (opcional)' : 'Motivo *'}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. por su nivel lo pasamos a 2015 Blanca" /></Field>
        {!direct && <p className="text-xs text-muted">El cambio se hace cuando lo apruebe el coordinador (Prof. Padrón) o administración.</p>}
      </div>
    </Modal>
  )
}

/** Dashboard del coordinador y de administración: solicitudes por aprobar. */
export function CategoryRequestsCard() {
  const role = useRole()
  const reqs = useCategoryRequests('pendiente')
  const students = useStudents()
  const cats = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  if (!role.canMoveCategory || !reqs.data?.length) return null
  const kid = (id: string) => students.data?.find((s) => s.id === id)
  const cat = (id: string | null) => cats.data?.find((c) => c.id === id)?.name ?? 'sin categoría'
  const decide = async (r: CategoryRequest, ok: boolean) => {
    setBusy(r.id)
    try {
      if (ok) unwrap(await supabase.from('students').update({ category_id: r.to_category }).eq('id', r.student_id))
      unwrap(await supabase.from('category_change_requests').update({ status: ok ? 'aprobado' : 'rechazado', decided_by: getActor() || null, decided_at: new Date().toISOString() }).eq('id', r.id))
      await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(ok ? 'Cambio aprobado' : 'Solicitud rechazada')
    } catch (e) { toast.error(e) } finally { setBusy('') }
  }
  return (
    <Card className="border-info/50">
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <ArrowRightLeft className="h-5 w-5 text-info" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Cambios de categoría por aprobar</h2>
        <Badge tone="info">{reqs.data.length}</Badge>
      </div>
      <ul className="divide-y divide-ink-700">
        {reqs.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <Link to={`/alumnos/${r.student_id}`} className="font-semibold hover:text-brand">{kid(r.student_id)?.full_name ?? 'Alumno'}</Link>
              <span className="block text-xs text-muted">{cat(r.from_category)} → <b className="text-fg">{cat(r.to_category)}</b>{r.reason ? ` · ${r.reason}` : ''} · pidió {r.requested_by ?? '—'} el {date(r.created_at.slice(0, 10), 'd MMM')}</span>
            </span>
            <Button size="sm" icon={Check} loading={busy === r.id} onClick={() => decide(r, true)}>Aprobar</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => decide(r, false)}>Rechazar</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
