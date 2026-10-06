import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Shirt } from 'lucide-react'
import { Badge, Card, ErrorState, PageHeader, SearchInput, Select, Spinner, StatCard, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useFees, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money } from '@/lib/format'
import { DELIVERIES, SIZES, isUniformConcept, type DeliveryKey } from '@/lib/uniforms'
import { DeliveryCheck, type Item } from '@/components/Deliveries'

const ITEM_OF: Record<DeliveryKey, Item> = { uniform_delivered_on: 'uniforme', training_shirt_delivered_on: 'playera', credential_delivered_on: 'credencial' }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Uniformes: talla de cada niño y qué se le ha entregado (uniforme, playera de
 * entrenamiento y credencial, con la fecha). También muestra sus cobros de uniformes.
 */
export default function Uniforms() {
  const students = useStudents()
  const categories = useCategories()
  const fees = useFees()
  const qc = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [missing, setMissing] = useState<'' | DeliveryKey | 'talla'>('')

  const catMap = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data])
  const base = useMemo(() => (students.data ?? []).filter((s) => s.status === 'activo' || s.status === 'muestra'), [students.data])
  const uniformFees = useMemo(() => {
    const m = new Map<string, { concept: string; amount: number; balance: number }[]>()
    for (const f of fees.data ?? []) if (isUniformConcept(f.concept)) m.set(f.student_id, [...(m.get(f.student_id) ?? []), { concept: f.concept, amount: Number(f.amount), balance: Number(f.balance) }])
    return m
  }, [fees.data])

  const rows = base.filter((s) => {
    if (cat && s.category_id !== cat) return false
    if (missing === 'talla' ? !!s.uniform_size : missing ? !!s[missing] : false) return false
    return !q || norm(s.full_name).includes(norm(q))
  }).sort((a, b) => (catMap.get(a.category_id ?? '')?.sort_order ?? 99) - (catMap.get(b.category_id ?? '')?.sort_order ?? 99) || a.full_name.localeCompare(b.full_name, 'es'))

  // Cuántos faltan por talla (para saber qué pedir)
  const bySize = useMemo(() => {
    const m = new Map<string, { uniforme: number; playera: number }>()
    for (const s of base) {
      const k = s.uniform_size || 'Sin talla'
      const r = m.get(k) ?? { uniforme: 0, playera: 0 }
      if (!s.uniform_delivered_on) r.uniforme++
      if (!s.training_shirt_delivered_on) r.playera++
      m.set(k, r)
    }
    const order = [...SIZES, 'Sin talla']
    return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99 || a[0].localeCompare(b[0]))
  }, [base])

  const save = async (id: string, patch: Record<string, string | null>) => {
    try {
      unwrap(await supabase.from('students').update(patch).eq('id', id))
      await Promise.all(['students', 'student'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) { toast.error(e) }
  }

  if (students.error) return <ErrorState error={students.error} onRetry={() => students.refetch()} />
  const count = (k: DeliveryKey) => base.filter((s) => s[k]).length

  return (
    <>
      <PageHeader title="Uniformes" subtitle="Talla de cada niño y qué ya se le entregó: uniforme, playera de entrenamiento y credencial." />
      {students.isLoading ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {DELIVERIES.map((d) => (
              <StatCard key={d.key} label={`${d.label} entregados`} value={`${count(d.key)} de ${base.length}`} icon={Shirt}
                tone={count(d.key) === base.length ? 'ok' : undefined} hint={`Faltan ${base.length - count(d.key)}`} onClick={() => setMissing(d.key)} />
            ))}
            <StatCard label="Sin talla" value={base.filter((s) => !s.uniform_size).length} icon={Shirt} hint="Pídeles la talla a los papás" onClick={() => setMissing('talla')} />
          </div>

          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Lo que falta entregar, por talla</p>
            <div className="flex flex-wrap gap-2">
              {bySize.map(([size, r]) => (
                <div key={size} className="rounded-xl border border-ink-600 px-3 py-1.5 text-sm">
                  <b>{size}</b> <span className="text-muted">· uniformes {r.uniforme} · playeras {r.playera}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-2 sm:grid-cols-[1fr_200px_230px]">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar niño" />
            <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={missing} onChange={(e) => setMissing(e.target.value as typeof missing)} aria-label="Pendientes">
              <option value="">Todos</option>
              <option value="uniform_delivered_on">Les falta el uniforme</option>
              <option value="training_shirt_delivered_on">Les falta la playera</option>
              <option value="credential_delivered_on">Les falta la credencial</option>
              <option value="talla">Sin talla</option>
            </Select>
          </div>

          <Card className="overflow-x-auto">
            <table className="table-base table-compact min-w-[860px]">
              <thead>
                <tr><th>Niño</th><th>Categoría</th><th>Talla</th>{DELIVERIES.map((d) => <th key={d.key}>{d.short}</th>)}<th>Cobros de uniforme</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-muted">Nadie con estos filtros.</td></tr> : rows.map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-[260px]"><Link to={`/alumnos/${s.id}`} className="block truncate font-medium hover:text-brand">{s.full_name}</Link></td>
                    <td className="whitespace-nowrap text-sm">{catMap.get(s.category_id ?? '')?.name ?? '—'}</td>
                    <td>
                      <Select value={s.uniform_size ?? ''} onChange={(e) => save(s.id, { uniform_size: e.target.value || null })}
                        className={cx('h-8 w-24 py-0 text-xs', !s.uniform_size && 'border-warn text-warn')} aria-label={`Talla de ${s.full_name}`}>
                        <option value="">—</option>
                        {[...new Set([...SIZES, ...(s.uniform_size ? [s.uniform_size] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    </td>
                    {DELIVERIES.map((d) => (
                      <td key={d.key}>
                        <DeliveryCheck student={s} item={ITEM_OF[d.key]} compact />
                      </td>
                    ))}
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(uniformFees.get(s.id) ?? []).map((f, k) => (
                          <Badge key={k} tone={f.balance > 0 ? 'warn' : 'ok'}>{f.concept.replace(' (uniforme y credencial)', '')} {f.balance > 0 ? `debe ${money(f.balance)}` : '✓'}</Badge>
                        ))}
                        {!uniformFees.get(s.id)?.length && <span className="text-xs text-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted">Al palomear una entrega se revisa si ya está pagada. Si no, puedes registrar el pago ahí mismo o entregarla sin pagar (queda como adeudo en el Dashboard). Ese dinero se manda al fondo de uniformes en el corte de caja.</p>
        </div>
      )}
    </>
  )
}
