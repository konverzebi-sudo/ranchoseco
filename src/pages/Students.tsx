import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Users, Download, ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar, Badge, Button, Card, Empty, ErrorState, PageHeader, SearchInput, Select, Spinner, feeTone } from '@/components/ui'
import { CollectButton } from '@/components/WhatsAppButtons'
import StudentForm from '@/components/StudentForm'
import { ScholarshipReviewModal } from '@/components/ScholarshipReview'
import { PauseModal, ReactivateModal } from '@/components/InactiveModals'
import { useToast } from '@/components/toast'
import { useAccounts, useCategories, useFees, useStudents, primaryGuardian } from '@/lib/api'
import { PaymentModal } from '@/components/PaymentForms'
import { ACCOUNT_LABEL, STATUS_LABEL, age, money, prettyPhone } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'
import { exportCsv } from '@/lib/csv'
import type { AccountStatus, FeeBalance, StudentStatus } from '@/lib/types'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Students() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const students = useStudents()
  const categories = useCategories()
  const accounts = useAccounts()
  const fees = useFees()
  const [reviewing, setReviewing] = useState<{ fee: FeeBalance; name: string } | null>(null)
  const [paying, setPaying] = useState<(typeof rows)[number] | null>(null)
  const [pausing, setPausing] = useState<{ s: (typeof rows)[number]; mode: 'pause' | 'back' } | null>(null)
  const reviewFee = (studentId: string) => (fees.data ?? []).find((f) => f.student_id === studentId && f.status === 'por_confirmar')
  const openReview = (studentId: string, name: string) => { const f = reviewFee(studentId); if (f) setReviewing({ fee: f, name }) }
  const q = params.get('q') ?? ''
  const cat = params.get('cat') ?? ''
  const stParam = params.get('st')
  const status = stParam === 'todos' ? '' : (stParam ?? 'activo')
  const acct = params.get('acct') ?? ''
  const [creating, setCreating] = useState(params.get('nuevo') === '1')

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    p.delete('nuevo')
    setParams(p, { replace: true })
  }

  const accMap = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.student_id, a])), [accounts.data])
  const catMap = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])

  const rows = useMemo(() => {
    const nq = norm(q.trim())
    const digits = q.replace(/\D/g, '')
    return (students.data ?? []).filter((s) => {
      if (status && s.status !== status) return false
      if (cat && (cat === 'none' ? s.category_id : s.category_id !== cat)) return false
      if (acct && (accMap.get(s.id)?.status ?? 'al_corriente') !== acct) return false
      if (!nq) return true
      const g = primaryGuardian(s)
      return (
        norm(s.full_name).includes(nq) ||
        norm(catMap.get(s.category_id ?? '') ?? '').includes(nq) ||
        (g && norm(g.full_name).includes(nq)) ||
        (digits.length >= 4 && g?.phone.includes(digits))
      )
    })
  }, [students.data, q, cat, status, acct, accMap, catMap])

  const inlineUpdate = async (id: string, patch: { category_id?: string | null; status?: StudentStatus }) => {
    try {
      unwrap(await supabase.from('students').update(patch).eq('id', id))
      await qc.invalidateQueries({ queryKey: ['students'] })
      toast.ok('Guardado')
    } catch (e) {
      toast.error(e)
    }
  }

  const doExport = () =>
    exportCsv('alumnos-rancho-seco.csv',
      ['Nombre', 'Categoría', 'Fecha de nacimiento', 'Estatus', 'Tutor', 'Teléfono', 'Estado de cuenta', 'Saldo'],
      rows.map((s) => {
        const g = primaryGuardian(s)
        const a = accMap.get(s.id)
        return [s.full_name, catMap.get(s.category_id ?? '') ?? '', s.birth_date, STATUS_LABEL[s.status], g?.full_name, g ? prettyPhone(g.phone) : '', ACCOUNT_LABEL[a?.status ?? 'al_corriente'], a?.balance ?? 0]
      }))

  return (
    <>
      <PageHeader title="Alumnos" subtitle={students.data ? `${rows.length} de ${students.data.length} alumnos` : undefined}
        actions={<>
          <Button variant="secondary" icon={Download} onClick={doExport} disabled={!rows.length}>Exportar</Button>
          <Button icon={Plus} onClick={() => setCreating(true)}>Nuevo alumno</Button>
        </>} />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_180px]">
        <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Nombre, categoría, tutor o teléfono" className="sm:col-span-2 lg:col-span-1" />
        <Select value={cat} onChange={(e) => setParam('cat', e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Sin categoría</option>
        </Select>
        <Select value={status} onChange={(e) => setParam('st', e.target.value === 'activo' ? '' : e.target.value || 'todos')} aria-label="Filtrar por estatus">
          <option value="activo">Activos</option>
          <option value="suspendido">Inactivos temporales</option>
          <option value="baja">Bajas</option>
          <option value="">Todos</option>
        </Select>
        <Select value={acct} onChange={(e) => setParam('acct', e.target.value)} aria-label="Filtrar por estado de cuenta">
          <option value="">Cualquier estado de cuenta</option>
          {(Object.keys(ACCOUNT_LABEL) as AccountStatus[]).map((k) => <option key={k} value={k}>{ACCOUNT_LABEL[k]}</option>)}
        </Select>
      </div>

      {students.error ? <ErrorState error={students.error} onRetry={() => students.refetch()} /> :
        students.isLoading ? <Spinner /> :
        rows.length === 0 ? (
          <Card><Empty icon={Users} title="No hay alumnos con estos filtros" text="Cambia la búsqueda o registra un alumno nuevo."
            action={<Button icon={Plus} onClick={() => setCreating(true)}>Nuevo alumno</Button>} /></Card>
        ) : (
          <>
            {/* Escritorio: tabla con edición directa */}
            <Card className="hidden overflow-hidden lg:block">
              <table className="table-base">
                <thead>
                  <tr><th>Alumno</th><th>Categoría</th><th>Tutor</th><th>Estatus</th><th>Estado de cuenta</th><th className="text-right">Acciones</th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const g = primaryGuardian(s)
                    const a = accMap.get(s.id)
                    const ag = age(s.birth_date)
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/alumnos/${s.id}`} className="flex items-center gap-3 hover:text-brand">
                            <Avatar name={s.full_name} path={s.photo_path} size={36} />
                            <div className="min-w-0">
                              <p className="font-medium">{s.full_name}</p>
                              <p className="text-xs text-muted">{ag != null ? `${ag} años` : 'Sin fecha de nacimiento'}</p>
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Select value={s.category_id ?? ''} onChange={(e) => inlineUpdate(s.id, { category_id: e.target.value || null })}
                            className="h-9 w-36 text-sm" aria-label={`Categoría de ${s.full_name}`}>
                            <option value="">Sin categoría</option>
                            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </Select>
                        </td>
                        <td>{g ? <><p>{g.full_name}</p><p className="text-xs text-muted">{prettyPhone(g.phone)}</p></> : <span className="text-muted">Sin capturar</span>}</td>
                        <td>
                          <Select value={s.status} onChange={(e) => {
                              const v = e.target.value as StudentStatus
                              if (v === 'suspendido') return setPausing({ s, mode: 'pause' })
                              if (s.status === 'suspendido' && v === 'activo') return setPausing({ s, mode: 'back' })
                              inlineUpdate(s.id, { status: v })
                            }}
                            className="h-9 w-32 text-sm" aria-label={`Estatus de ${s.full_name}`}>
                            <option value="activo">Activo</option><option value="suspendido">Inactivo temporal</option><option value="baja">Baja</option>
                          </Select>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {a?.status === 'por_confirmar' && reviewFee(s.id) ? (
                              <button onClick={() => openReview(s.id, s.full_name)} title="Escribir cuánto es la mensualidad y cuánto paga" className="hover:opacity-80">
                                <Badge tone="warn" className="cursor-pointer underline decoration-dotted">{ACCOUNT_LABEL.por_confirmar}</Badge>
                              </button>
                            ) : Number(a?.balance ?? 0) > 0 ? (
                              <button onClick={() => setPaying(s)} title="Registrar pago" className="hover:opacity-80">
                                <Badge tone={feeTone(a!.status)} className="cursor-pointer underline decoration-dotted">{ACCOUNT_LABEL[a!.status]}</Badge>
                              </button>
                            ) : <Badge tone={feeTone(a?.status ?? 'al_corriente')}>{ACCOUNT_LABEL[a?.status ?? 'al_corriente']}</Badge>}
                            {Number(a?.balance ?? 0) > 0 && <span className="font-semibold">{money(a!.balance)}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="flex justify-end gap-2">
                            {Number(a?.balance ?? 0) > 0 && <CollectButton student={s} />}
                            <Button variant="secondary" size="sm" onClick={() => nav(`/alumnos/${s.id}`)}>Expediente</Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>

            {/* Celular: tarjetas */}
            <ul className="space-y-2 lg:hidden">
              {rows.map((s) => {
                const a = accMap.get(s.id)
                return (
                  <li key={s.id}>
                    <Card className="flex items-center gap-3 p-3">
                      <Link to={`/alumnos/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={s.full_name} path={s.photo_path} size={44} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.full_name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted">{catMap.get(s.category_id ?? '') ?? 'Sin categoría'}</span>
                            {a && a.status === 'por_confirmar' && reviewFee(s.id)
                              ? <button onClick={(e) => { e.preventDefault(); openReview(s.id, s.full_name) }}><Badge tone="warn" className="underline decoration-dotted">¿Beca? {money(a.balance)}</Badge></button>
                              : a && a.status !== 'al_corriente' && <button onClick={(e) => { e.preventDefault(); setPaying(s) }}><Badge tone={feeTone(a.status)} className="underline decoration-dotted">{money(a.balance)}</Badge></button>}
                          </div>
                        </div>
                      </Link>
                      {Number(a?.balance ?? 0) > 0 ? <CollectButton student={s} label="" /> : <ChevronRight className="h-5 w-5 text-muted" />}
                    </Card>
                  </li>
                )
              })}
            </ul>
          </>
        )}

      {paying && <PaymentModal student={paying} onClose={() => setPaying(null)} />}
      {pausing?.mode === 'pause' && <PauseModal student={pausing.s} onClose={() => setPausing(null)} />}
      {pausing?.mode === 'back' && <ReactivateModal student={pausing.s} onClose={() => setPausing(null)} />}
      {reviewing && <ScholarshipReviewModal fee={reviewing.fee} studentName={reviewing.name} onClose={() => setReviewing(null)} />}
      {creating && <StudentForm defaultCategory={cat && cat !== 'none' ? cat : undefined} onClose={() => setCreating(false)} onSaved={(id) => nav(`/alumnos/${id}`)} />}
    </>
  )
}
