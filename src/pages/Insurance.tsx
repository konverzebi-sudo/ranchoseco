import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ShieldCheck, ShieldOff, ShieldPlus } from 'lucide-react'
import { Badge, Button, Card, Input, PageHeader, SearchInput, Spinner, StatCard, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor } from '@/lib/actor'
import { STATUS_LABEL, date, today } from '@/lib/format'
import { exportCsv } from '@/lib/csv'

interface Movement { id: string; student_id: string; kind: 'alta' | 'baja'; on_date: string; actor: string | null; note: string | null }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * Seguro: quién está dado de alta, quién falta (para las listas mensuales)
 * y las altas y bajas de cada mes.
 */
export default function Insurance() {
  const students = useStudents()
  const cats = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [month, setMonth] = useState(today().slice(0, 7))
  const [on, setOn] = useState(today())
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const moves = useQuery({
    queryKey: ['insurance_movements'],
    queryFn: async () => {
      const r = await supabase.from('insurance_movements').select('*').order('on_date', { ascending: false })
      return r.error ? null : (r.data as Movement[])
    },
  })
  const cat = (id: string | null) => cats.data?.find((c) => c.id === id)?.name ?? 'Sin categoría'
  const all = students.data ?? []
  const d = useMemo(() => {
    const coming = all.filter((s) => s.status === 'activo')
    const gone = (s: StudentRow) => s.status === 'baja' || s.status === 'suspendido'
    const sort = (xs: StudentRow[]) => [...xs].sort((a, b) => cat(a.category_id).localeCompare(cat(b.category_id)) || a.full_name.localeCompare(b.full_name, 'es'))
    return {
      missing: sort(coming.filter((s) => !s.insured)),
      toRemove: sort(all.filter((s) => s.insured && gone(s))),
      insured: sort(all.filter((s) => s.insured && !gone(s))),
    }
  }, [all, cats.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const monthMoves = (moves.data ?? []).filter((m) => m.on_date.startsWith(month))
  const kid = (id: string) => all.find((s) => s.id === id)

  const apply = async (ids: string[], kind: 'alta' | 'baja') => {
    if (!ids.length) return toast.error('Escoge al menos un niño.')
    setBusy(true)
    try {
      unwrap(await supabase.from('students').update(kind === 'alta' ? { insured: true, insured_on: on } : { insured: false }).in('id', ids))
      unwrap(await supabase.from('insurance_movements').insert(ids.map((student_id) => ({ student_id, kind, on_date: on, actor: getActor() || null }))))
      await Promise.all(['students', 'student', 'insurance_movements'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      setSel(new Set())
      toast.ok(`${ids.length} ${kind === 'alta' ? 'dados de alta' : 'dados de baja'} en el seguro`)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  if (students.isLoading) return <Spinner />
  if (moves.data === null) return <><PageHeader title="Seguro" /><Card className="p-6 text-sm text-warn">Falta activar esta sección en la base de datos (pegar el SQL en Supabase).</Card></>
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const monthLabel = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
  const insuredList = d.insured.filter((s) => !q || norm(s.full_name).includes(norm(q)))

  return (
    <>
      <PageHeader title="Seguro" subtitle="Quién está dado de alta, quién falta y las altas y bajas de cada mes." />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Dados de alta" value={d.insured.length} icon={ShieldCheck} tone="ok" />
          <StatCard label="Faltan de dar de alta" value={d.missing.length} icon={ShieldPlus} tone={d.missing.length ? 'bad' : 'ok'} hint="Alumnos activos sin seguro" />
          <StatCard label="Por dar de baja" value={d.toRemove.length} icon={ShieldOff} hint="Ya no vienen y siguen en el seguro" />
          <StatCard label={`Movimientos de ${MONTHS[Number(month.slice(5, 7)) - 1]}`} value={monthMoves.length} icon={ShieldCheck} hint={`${monthMoves.filter((m) => m.kind === 'alta').length} altas · ${monthMoves.filter((m) => m.kind === 'baja').length} bajas`} />
        </div>

        <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <span>Fecha de alta o baja:</span>
          <Input type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value || today())} className="h-9 w-44" />
          <span className="text-xs text-muted">Se usa para las altas y bajas que registres ahora.</span>
        </Card>

        {d.missing.length > 0 && (
          <Card className="border-bad/40">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-3">
              <h2 className="font-display text-lg font-bold uppercase tracking-wide">Faltan de dar de alta · {d.missing.length}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSel(new Set(d.missing.map((s) => s.id)))}>Seleccionar todos</Button>
                <Button size="sm" icon={ShieldPlus} loading={busy} disabled={![...sel].some((id) => d.missing.some((s) => s.id === id))} onClick={() => apply([...sel].filter((id) => d.missing.some((s) => s.id === id)), 'alta')}>Dar de alta seleccionados</Button>
              </div>
            </div>
            <ul className="max-h-96 divide-y divide-ink-700 overflow-y-auto">
              {d.missing.map((s) => (
                <li key={s.id}>
                  <label className={cx('flex cursor-pointer items-center gap-3 px-5 py-2 text-sm', sel.has(s.id) && 'bg-brand-dim')}>
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[#F2E30A]" />
                    <span className="min-w-0 flex-1"><b>{s.full_name}</b> <span className="text-xs text-muted">· {cat(s.category_id)}{s.birth_date ? ` · nació ${date(s.birth_date)}` : ' · falta fecha de nacimiento'}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {d.toRemove.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-3">
              <h2 className="font-display text-lg font-bold uppercase tracking-wide">Por dar de baja · {d.toRemove.length}</h2>
              <Button size="sm" variant="secondary" icon={ShieldOff} loading={busy} onClick={() => apply(d.toRemove.map((s) => s.id), 'baja')}>Dar de baja a todos</Button>
            </div>
            <ul className="divide-y divide-ink-700">
              {d.toRemove.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                  <Link to={`/alumnos/${s.id}`} className="hover:text-brand"><b>{s.full_name}</b> <span className="text-xs text-muted">· {cat(s.category_id)}</span></Link>
                  <span className="flex items-center gap-2"><Badge tone="warn">{STATUS_LABEL[s.status]}</Badge><Button size="sm" variant="ghost" onClick={() => apply([s.id], 'baja')}>Dar de baja</Button></span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-3">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">Altas y bajas de {monthLabel}</h2>
            <div className="flex items-center gap-2">
              <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-40" aria-label="Mes" />
              <Button size="sm" variant="secondary" icon={Download} disabled={!monthMoves.length}
                onClick={() => exportCsv(`seguro-${month}.csv`, ['Movimiento', 'Fecha', 'Alumno', 'Fecha de nacimiento', 'Categoría', 'Registró'],
                  monthMoves.map((m) => { const s = kid(m.student_id); return [m.kind === 'alta' ? 'Alta' : 'Baja', m.on_date, s?.full_name ?? '', s?.birth_date ?? '', cat(s?.category_id ?? null), m.actor ?? ''] }))}>Exportar</Button>
            </div>
          </div>
          {!monthMoves.length ? <p className="px-5 py-6 text-center text-sm text-muted">Sin altas ni bajas este mes.</p> : (
            <ul className="divide-y divide-ink-700">
              {monthMoves.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                  <span><Badge tone={m.kind === 'alta' ? 'ok' : 'warn'}>{m.kind === 'alta' ? 'Alta' : 'Baja'}</Badge> <b className="ml-1">{kid(m.student_id)?.full_name ?? 'Alumno'}</b> <span className="text-xs text-muted">· {cat(kid(m.student_id)?.category_id ?? null)}</span></span>
                  <span className="text-xs text-muted">{date(m.on_date, 'd MMM')}{m.actor ? ` · ${m.actor}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-3">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">Dados de alta · {d.insured.length}</h2>
            <div className="flex items-center gap-2">
              <SearchInput value={q} onChange={setQ} placeholder="Buscar" />
              <Button size="sm" variant="secondary" icon={Download} disabled={!d.insured.length}
                onClick={() => exportCsv(`asegurados-${today()}.csv`, ['Alumno', 'Fecha de nacimiento', 'Categoría', 'Alta desde'], d.insured.map((s) => [s.full_name, s.birth_date ?? '', cat(s.category_id), s.insured_on ?? '']))}>Lista completa</Button>
            </div>
          </div>
          <ul className="max-h-96 divide-y divide-ink-700 overflow-y-auto">
            {insuredList.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                <Link to={`/alumnos/${s.id}`} className="hover:text-brand"><b>{s.full_name}</b> <span className="text-xs text-muted">· {cat(s.category_id)}{s.insured_on ? ` · desde ${date(s.insured_on, 'd MMM yy')}` : ''}</span></Link>
                <Button size="sm" variant="ghost" onClick={() => apply([s.id], 'baja')}>Dar de baja</Button>
              </li>
            ))}
            {!insuredList.length && <li className="px-5 py-6 text-center text-sm text-muted">{d.insured.length ? 'Nadie con ese nombre.' : 'Todavía no hay nadie marcado como dado de alta.'}</li>}
          </ul>
        </Card>
      </div>
    </>
  )
}
