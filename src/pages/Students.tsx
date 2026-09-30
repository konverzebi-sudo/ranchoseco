import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Users, Download, ChevronRight, CheckCircle2, Copy, MessageCircle, ArrowUp, ArrowDown, ArrowUpDown, UserPlus, X } from 'lucide-react'
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
import { isNewEnrollment } from '@/lib/finance'
import { monthLabel } from '@/components/FinanceModules'
import type { AccountStatus, FeeBalance, StudentStatus } from '@/lib/types'

type SortKey = 'nombre' | 'categoria' | 'tutor' | 'estatus' | 'cuenta'
const STATUS_ORDER: Record<string, number> = { activo: 0, muestra: 1, suspendido: 2, baja: 3 }
const ACCOUNT_ORDER: Record<string, number> = { al_corriente: 0, pendiente: 1, por_confirmar: 2, vencido: 3 }

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
  const datos = params.get('datos') ?? ''
  const nuevos = /^\d{4}-\d{2}$/.test(params.get('nuevos') ?? '') ? params.get('nuevos')! : ''
  const sortKey = (params.get('orden') as SortKey) || 'nombre'
  const sortDir = params.get('dir') === 'desc' ? -1 : 1
  // Primer toque: de menor a mayor; si ya estaba así, al revés
  const toggleSort = (k: SortKey) => {
    const p = new URLSearchParams(params)
    p.set('orden', k)
    if (k === sortKey && sortDir === 1) p.set('dir', 'desc'); else p.delete('dir')
    setParams(p, { replace: true })
  }
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
  const catOrder = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.sort_order])), [categories.data])

  const rows = useMemo(() => {
    const nq = norm(q.trim())
    const digits = q.replace(/\D/g, '')
    const list = (students.data ?? []).filter((s) => {
      if (nuevos && !isNewEnrollment(s, nuevos)) return false
      if (status && s.status !== status) return false
      if (cat && (cat === 'none' ? s.category_id : s.category_id !== cat)) return false
      if (acct && (accMap.get(s.id)?.status ?? 'al_corriente') !== acct) return false
      if (datos === 'completos' && !s.profile_completed_at) return false
      if (datos === 'faltan' && s.profile_completed_at) return false
      if (!nq) return true
      const g = primaryGuardian(s)
      return (
        norm(s.full_name).includes(nq) ||
        norm(catMap.get(s.category_id ?? '') ?? '').includes(nq) ||
        (g && norm(g.full_name).includes(nq)) ||
        (digits.length >= 4 && g?.phone.includes(digits))
      )
    })
    const byName = (a: (typeof list)[number], b: (typeof list)[number]) => a.full_name.localeCompare(b.full_name, 'es')
    const key = (s: (typeof list)[number]): number | string => {
      switch (sortKey) {
        case 'categoria': return s.category_id ? catOrder.get(s.category_id) ?? 98 : 99
        case 'tutor': return norm(primaryGuardian(s)?.full_name ?? '~')
        case 'estatus': return STATUS_ORDER[s.status] ?? 9
        case 'cuenta': { const a = accMap.get(s.id); return (ACCOUNT_ORDER[a?.status ?? 'al_corriente'] ?? 0) * 1e7 + Number(a?.balance ?? 0) }
        default: return norm(s.full_name)
      }
    }
    return list.sort((a, b) => {
      const ka = key(a), kb = key(b)
      const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'es')
      return c * sortDir || byName(a, b)
    })
  }, [students.data, q, cat, status, acct, datos, nuevos, accMap, catMap, catOrder, sortKey, sortDir])

  const SortTh = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => {
    const on = sortKey === k
    const Icon = !on ? ArrowUpDown : sortDir === 1 ? ArrowUp : ArrowDown
    return (
      <th className={className} aria-sort={on ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 uppercase hover:text-brand ${on ? 'text-brand' : ''}`}>
          {children}<Icon className={`h-3.5 w-3.5 ${on ? '' : 'opacity-40'}`} />
        </button>
      </th>
    )
  }

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

      {(() => {
        const base = (students.data ?? []).filter((s) => s.status !== 'baja')
        const done = base.filter((s) => s.profile_completed_at).length
        const pct = base.length ? Math.round((done / base.length) * 100) : 0
        const link = `${window.location.origin}${import.meta.env.BASE_URL}#/registro`
        const msg = `Hola, familias de Deportivo Rancho Seco. Les pedimos completar los datos de su hijo (contacto, emergencias e información médica). Toma 2 minutos: ${link}`
        return (
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm"><b className="font-display text-2xl text-brand">{done}</b> <span className="text-muted">de {base.length} alumnos tienen sus datos completos · faltan <b className="text-white">{base.length - done}</b></span></p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700"><div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setParam('datos', datos === 'faltan' ? '' : 'faltan')}>{datos === 'faltan' ? 'Ver todos' : 'Ver los que faltan'}</Button>
                <Button size="sm" variant="secondary" icon={Copy} onClick={() => navigator.clipboard.writeText(link).then(() => toast.ok('Link copiado'))}>Copiar link para papás</Button>
                <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-wa px-3 text-sm font-semibold text-ink hover:brightness-110"><MessageCircle className="h-4 w-4" /> Enviar por WhatsApp</a>
              </div>
            </div>
          </Card>
        )
      })()}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_180px]">
        <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Nombre, categoría, tutor o teléfono" className="sm:col-span-2 lg:col-span-1" />
        <Select value={cat} onChange={(e) => setParam('cat', e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Sin categoría</option>
        </Select>
        <Select value={status} onChange={(e) => setParam('st', e.target.value === 'activo' ? '' : e.target.value || 'todos')} aria-label="Filtrar por estatus">
          <option value="activo">Activos</option>
          <option value="muestra">Clases muestra</option>
          <option value="suspendido">Inactivos temporales</option>
          <option value="baja">Bajas</option>
          <option value="">Todos</option>
        </Select>
        <Select value={acct} onChange={(e) => setParam('acct', e.target.value)} aria-label="Filtrar por estado de cuenta">
          <option value="">Cualquier estado de cuenta</option>
          {(Object.keys(ACCOUNT_LABEL) as AccountStatus[]).map((k) => <option key={k} value={k}>{ACCOUNT_LABEL[k]}</option>)}
        </Select>
      </div>

      {nuevos && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 border-ok/40 p-3">
          <p className="flex items-center gap-2 text-sm"><UserPlus className="h-4 w-4 text-ok" /> Mostrando las <b>nuevas inscripciones de {monthLabel(nuevos)}</b> ({rows.length})</p>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setParam('nuevos', '')}>Quitar filtro</Button>
        </Card>
      )}

      {/* Celular: ordenar */}
      <div className="mb-3 flex items-center gap-2 lg:hidden">
        <Select value={sortKey} onChange={(e) => toggleSort(e.target.value as SortKey)} className="h-9 flex-1 text-sm" aria-label="Ordenar por">
          <option value="nombre">Ordenar por nombre</option>
          <option value="categoria">Ordenar por categoría</option>
          <option value="tutor">Ordenar por tutor</option>
          <option value="estatus">Ordenar por estatus</option>
          <option value="cuenta">Ordenar por estado de cuenta</option>
        </Select>
        <Button size="sm" variant="secondary" icon={sortDir === 1 ? ArrowUp : ArrowDown} onClick={() => toggleSort(sortKey)}>{sortDir === 1 ? 'A→Z' : 'Z→A'}</Button>
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
                  <tr><SortTh k="nombre">Alumno</SortTh><SortTh k="categoria">Categoría</SortTh><SortTh k="tutor">Tutor</SortTh><SortTh k="estatus">Estatus</SortTh><SortTh k="cuenta">Estado de cuenta</SortTh><th className="text-right">Acciones</th></tr>
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
                              <p className="flex items-center gap-1.5 font-medium">{s.full_name}{s.profile_completed_at && <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Datos completos" />}</p>
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
                            <option value="activo">Activo</option><option value="muestra">Clase muestra</option><option value="suspendido">Inactivo temporal</option><option value="baja">Baja</option>
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
                          <p className="flex items-center gap-1.5 truncate font-medium">{s.full_name}{s.profile_completed_at && <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-label="Datos completos" />}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted">{catMap.get(s.category_id ?? '') ?? 'Sin categoría'}</span>
                            {s.status === 'muestra' && <Badge tone="info">Clase muestra</Badge>}
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
