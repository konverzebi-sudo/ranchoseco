import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowUp, GraduationCap, Pencil, Plus, Trash2, Users, UserPlus, X, CheckCircle2 } from 'lucide-react'
import { Avatar, Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Modal, PageHeader, SearchInput, Spinner, StatCard, feeTone } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useAccounts, useCategories, useFees, useSettings, useSiblingGroups, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { ACCOUNT_LABEL, money, monthName, today } from '@/lib/format'
import { PROMO_REASON, memberPrice, ordinal, promoStatus, siblingPrice, suggestSiblings, surnameKey } from '@/lib/siblings'
import type { SiblingGroup } from '@/lib/types'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())

export default function Scholarships() {
  const students = useStudents()
  const groups = useSiblingGroups()
  const accounts = useAccounts()
  const categories = useCategories()
  const { data: settings } = useSettings()
  const [editing, setEditing] = useState<{ group?: SiblingGroup; preset?: StudentRow[] } | null>(null)
  const prices = settings?.sibling_prices?.map(Number) ?? [500, 450, 400]
  const regular = Number(settings?.default_monthly_fee ?? 550)

  const overdueIds = useMemo(() => new Set((accounts.data ?? []).filter((a) => a.status === 'vencido').map((a) => a.student_id)), [accounts.data])
  const accOf = (id: string) => accounts.data?.find((a) => a.student_id === id)
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name ?? 'Sin categoría'

  const rows = useMemo(() => (groups.data ?? []).map((g) => {
    const members = (students.data ?? []).filter((s) => s.sibling_group_id === g.id).sort((a, b) => (a.sibling_order ?? 99) - (b.sibling_order ?? 99))
    const active = members.filter((m) => m.status === 'activo')
    const st = promoStatus(members, overdueIds)
    const monthlySaving = st.valid ? members.reduce((a, m, i) => a + Math.max(0, regular - memberPrice(m, i + 1, prices)), 0) : 0
    return { g, members, active, ...st, monthlySaving }
  }), [groups.data, students.data, overdueIds, prices, regular])

  const suggestions = useMemo(() => suggestSiblings(students.data ?? []), [students.data])
  const individual = (students.data ?? []).filter((s) => s.status === 'activo' && s.monthly_fee != null && !s.sibling_group_id)
  const invalid = rows.filter((r) => !r.valid)
  const withOverdue = rows.filter((r) => r.valid && r.overdue.length)
  const inPromo = rows.reduce((a, r) => a + r.active.length, 0)
  const promoSaving = rows.reduce((a, r) => a + r.monthlySaving, 0)

  if (groups.error) return <ErrorState error={groups.error} onRetry={() => groups.refetch()} />

  return (
    <>
      <PageHeader title="Becas y promociones" subtitle={`Promo hermanos: 1° ${money(prices[0])} · 2° ${money(prices[1])} · 3° en adelante ${money(prices[2])}`}
        actions={<Button icon={Plus} onClick={() => setEditing({})}>Nueva promo de hermanos</Button>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Familias en promo" value={rows.length} icon={Users} />
        <StatCard label="Alumnos en promo" value={inPromo} icon={GraduationCap} />
        <StatCard label="Descuento por promo al mes" value={money(promoSaving)} icon={GraduationCap} hint={`Contra la mensualidad de ${money(regular)}`} />
        <StatCard label="Promos no válidas" value={invalid.length} icon={AlertTriangle} tone={invalid.length ? 'bad' : 'ok'} hint={invalid.length ? 'Algún hermano ya no está inscrito' : withOverdue.length ? `${withOverdue.length} con pagos vencidos` : 'Todos inscritos y al corriente'} />
      </div>

      {(invalid.length > 0 || withOverdue.length > 0) && (
        <Card className="mb-6 border-bad/50 bg-bad/10 p-4">
          <p className="flex items-center gap-2 font-semibold text-bad"><AlertTriangle className="h-5 w-5" /> Revisar promo de hermanos</p>
          <ul className="mt-2 space-y-1 text-sm">
            {invalid.map((r) => (
              <li key={r.g.id}><b>{r.g.name}</b>: la promo <b>no es válida</b> porque {r.notEnrolled.map((b) => b.full_name).join(', ')} ya no {r.notEnrolled.length === 1 ? 'está inscrito' : 'están inscritos'}. Las mensualidades nuevas se generan sin promo.</li>
            ))}
            {withOverdue.map((r) => (
              <li key={'o' + r.g.id}><b>{r.g.name}</b>: {r.overdue.map((b) => b.full_name).join(', ')} {r.overdue.length === 1 ? 'tiene' : 'tienen'} pagos vencidos.</li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Promo hermanos</h2>
      {groups.isLoading || students.isLoading ? <Spinner /> : rows.length === 0 ? (
        <Card className="mb-8"><Empty icon={Users} title="Aún no hay familias en la promo" text="Agrega hermanos para que paguen 500 / 450 / 400. Abajo te sugerimos posibles hermanos por apellidos."
          action={<Button icon={Plus} onClick={() => setEditing({})}>Nueva promo de hermanos</Button>} /></Card>
      ) : (
        <div className="mb-8 grid gap-3 lg:grid-cols-2">
          {rows.map(({ g, members, valid, overdue, notEnrolled, monthlySaving }) => (
            <Card key={g.id} className={!valid || overdue.length ? 'border-bad/50 p-4' : 'p-4'}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-xl font-bold uppercase">{g.name}</p>
                  {!valid
                    ? <Badge tone="bad" className="mt-1"><AlertTriangle className="h-3 w-3" /> No válida: {notEnrolled.length ? 'hermano dado de baja' : 'faltan hermanos'}</Badge>
                    : overdue.length
                      ? <Badge tone="warn" className="mt-1"><AlertTriangle className="h-3 w-3" /> Válida · con pagos vencidos</Badge>
                      : <Badge tone="ok" className="mt-1"><CheckCircle2 className="h-3 w-3" /> Promo válida</Badge>}
                </div>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing({ group: g })}>Editar</Button>
              </div>
              <ul className="mt-3 divide-y divide-ink-700">
                {members.map((m, i) => {
                  const acc = accOf(m.id)
                  const order = m.sibling_order ?? i + 1
                  return (
                    <li key={m.id} className="flex items-center gap-3 py-2">
                      <span className="w-6 text-center font-display text-lg font-bold text-brand">{ordinal(order)}</span>
                      <Avatar name={m.full_name} path={m.photo_path} size={32} />
                      <Link to={`/alumnos/${m.id}?tab=pagos`} className="min-w-0 flex-1 hover:text-brand">
                        <p className="truncate text-sm font-medium">{m.full_name}</p>
                        <p className="text-xs text-muted">{catName(m.category_id)}{m.status !== 'activo' && ' · Baja'}</p>
                      </Link>
                      <span className="text-right text-sm font-semibold">{money(memberPrice(m, order, prices))}{m.sibling_price != null && <span className="block text-[10px] font-normal text-brand">especial</span>}</span>
                      <Badge tone={feeTone(acc?.status ?? 'al_corriente')}>{ACCOUNT_LABEL[acc?.status ?? 'al_corriente']}</Badge>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-xs text-muted">Descuento al mes: {money(monthlySaving)}</p>
            </Card>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          <h2 className="mb-1 font-display text-xl font-bold uppercase tracking-wide">Posibles hermanos</h2>
          <p className="mb-3 text-sm text-muted">Alumnos activos con los mismos dos apellidos que aún no están juntos en una promo. Confirma sólo si de verdad son hermanos.</p>
          <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {suggestions.map((sg) => (
              <Card key={sg.key} className="p-4">
                <p className="font-semibold capitalize">{sg.key}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {sg.students.map((s) => <li key={s.id} className="truncate text-muted">{s.full_name} · {catName(s.category_id)}{s.sibling_group_id ? ' · ya en otra promo' : ''}</li>)}
                </ul>
                <Button size="sm" variant="secondary" icon={UserPlus} className="mt-3" onClick={() => setEditing({ preset: sg.students })}>Crear promo</Button>
              </Card>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Becas individuales</h2>
      {individual.length === 0 ? (
        <Card className="p-5 text-sm text-muted">Nadie tiene cuota especial. Se asigna al confirmar "¿Beca?" o en el expediente del alumno.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base min-w-[560px]">
            <thead><tr><th>Alumno</th><th>Categoría</th><th>Paga</th><th>Beca al mes</th></tr></thead>
            <tbody>
              {individual.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/alumnos/${s.id}?tab=pagos`} className="font-medium hover:text-brand">{s.full_name}</Link></td>
                  <td className="text-muted">{catName(s.category_id)}</td>
                  <td>{money(s.monthly_fee)}</td>
                  <td className="text-ok">{money(Math.max(0, regular - Number(s.monthly_fee)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && <SiblingGroupModal group={editing.group} preset={editing.preset} onClose={() => setEditing(null)} />}
    </>
  )
}

function SiblingGroupModal({ group, preset, onClose }: { group?: SiblingGroup; preset?: StudentRow[]; onClose: () => void }) {
  const { data: students } = useStudents()
  const { data: fees } = useFees()
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const prices = settings?.sibling_prices?.map(Number) ?? [500, 450, 400]
  const initial = group
    ? (students ?? []).filter((s) => s.sibling_group_id === group.id).sort((a, b) => (a.sibling_order ?? 99) - (b.sibling_order ?? 99))
    : preset ?? []
  const [members, setMembers] = useState<StudentRow[]>(initial)
  const [custom, setCustom] = useState<Record<string, string>>(
    Object.fromEntries(initial.filter((s) => s.sibling_price != null).map((s) => [s.id, String(s.sibling_price)])))
  const priceOf = (id: string, i: number) => (custom[id] !== undefined && custom[id] !== '' ? Number(custom[id]) : siblingPrice(i + 1, prices))
  const key = members[0] ? surnameKey(members[0].full_name) : null
  const [name, setName] = useState(group?.name ?? (key ? `Familia ${titleCase(key)}` : ''))
  const [q, setQ] = useState('')
  const [applyNow, setApplyNow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const month = today().slice(0, 7) + '-01'

  const results = q.trim().length >= 2
    ? (students ?? []).filter((s) => s.status === 'activo' && !members.some((m) => m.id === s.id) && norm(s.full_name).includes(norm(q.trim()))).slice(0, 6)
    : []
  const move = (i: number, d: number) => setMembers((m) => { const n = [...m]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n })

  const refresh = () => Promise.all(['sibling_groups', 'students', 'student', 'fees', 'accounts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  const save = async () => {
    if (members.length < 2) return toast.error('Agrega al menos dos hermanos.')
    if (!name.trim()) return toast.error('Escribe el nombre de la familia.')
    const elsewhere = members.filter((m) => m.sibling_group_id && m.sibling_group_id !== group?.id)
    if (elsewhere.length) return toast.error(`${elsewhere.map((m) => m.full_name).join(', ')} ya está en otra promo. Quítalo de esa primero.`)
    if (Object.values(custom).some((v) => v !== '' && !(Number(v) >= 0))) return toast.error('Revisa los precios especiales.')
    setSaving(true)
    try {
      let gid = group?.id
      if (gid) unwrap(await supabase.from('sibling_groups').update({ name: name.trim() }).eq('id', gid))
      else gid = (unwrap(await supabase.from('sibling_groups').insert({ name: name.trim() }).select('id').single()) as { id: string }).id
      // Quitar a los que salieron del grupo
      const removed = initial.filter((s) => !members.some((m) => m.id === s.id))
      if (removed.length) unwrap(await supabase.from('students').update({ sibling_group_id: null, sibling_order: null, sibling_price: null }).in('id', removed.map((s) => s.id)))
      for (const [i, m] of members.entries()) {
        const c = custom[m.id]
        unwrap(await supabase.from('students').update({ sibling_group_id: gid, sibling_order: i + 1, sibling_price: c !== undefined && c !== '' ? Number(c) : null }).eq('id', m.id))
      }
      // Aplicar la promo a la mensualidad de este mes (sin tocar las que ya tienen beca individual)
      let applied = 0
      if (applyNow) {
        for (const [i, m] of members.entries()) {
          const fee = (fees ?? []).find((f) => f.student_id === m.id && f.concept === 'Mensualidad' && f.period === month)
          if (!fee) continue
          const price = priceOf(m.id, i)
          unwrap(await supabase.from('fees').update({ discount: Math.max(0, Number(fee.amount) - price), discount_reason: PROMO_REASON, review: null }).eq('id', fee.id))
          applied++
        }
      }
      await refresh()
      toast.ok(`Promo guardada${applied ? ` y aplicada a ${applied} mensualidades de ${monthName(month)}` : ''}`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!group) return
    setSaving(true)
    try {
      unwrap(await supabase.from('students').update({ sibling_group_id: null, sibling_order: null, sibling_price: null }).eq('sibling_group_id', group.id))
      unwrap(await supabase.from('sibling_groups').delete().eq('id', group.id))
      await refresh()
      toast.ok('Promo eliminada. Las siguientes mensualidades se cobrarán completas.')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={group ? 'Editar promo de hermanos' : 'Nueva promo de hermanos'}
      footer={<>
        {group && <Button variant="danger" icon={Trash2} className="mr-auto" onClick={() => setConfirmDel(true)}>Quitar promo</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} loading={saving}>Guardar</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Familia"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Familia Rico Silva" /></Field>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">Hermanos en la promo</p>
          <p className="mb-2 text-xs text-muted">El orden da el precio ({prices.map((p) => money(p)).join(' / ')}). Para un caso especial, escribe otra cantidad. La promo se mantiene sólo mientras todos sigan inscritos.</p>
          {members.length === 0 ? <p className="text-sm text-muted">Busca y agrega a los hermanos.</p> : (
            <ul className="space-y-2">
              {members.map((m, i) => (
                <li key={m.id} className="flex items-center gap-2 rounded-xl bg-ink-900 px-3 py-2">
                  <span className="w-6 font-display text-lg font-bold text-brand">{ordinal(i + 1)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.full_name}</span>
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
                    <input type="number" min="0" inputMode="decimal" value={custom[m.id] ?? ''} placeholder={String(siblingPrice(i + 1, prices))}
                      onChange={(e) => setCustom((c) => ({ ...c, [m.id]: e.target.value }))} aria-label={`Precio de ${m.full_name}`}
                      className="h-8 w-full rounded-lg border border-ink-600 bg-ink-800 pl-5 pr-1 text-sm font-semibold focus:border-brand focus:outline-none" />
                  </div>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:text-white disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === members.length - 1} className="rounded p-1 text-muted hover:text-white disabled:opacity-30" aria-label="Bajar"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setMembers((ms) => ms.filter((x) => x.id !== m.id))} className="rounded p-1 text-muted hover:text-bad" aria-label="Quitar"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <SearchInput value={q} onChange={setQ} placeholder="Buscar alumno para agregar" />
          {results.length > 0 && (
            <ul className="mt-2 divide-y divide-ink-700 rounded-xl border border-ink-600">
              {results.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => { setMembers((m) => [...m, s]); setQ(''); if (!name) { const k = surnameKey(s.full_name); if (k) setName(`Familia ${titleCase(k)}`) } }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-700">
                    <span className="truncate">{s.full_name}</span>
                    {s.sibling_group_id ? <span className="text-xs text-warn">ya en otra promo</span> : <Plus className="h-4 w-4 text-brand" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#F2E30A]" />
          <span>Aplicar el precio de la promo a la mensualidad de {monthName(month)} que ya tengan creada.<span className="block text-xs text-muted">Las siguientes mensualidades se generan con la promo automáticamente.</span></span>
        </label>
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} loading={saving} danger title="Quitar promo" confirmLabel="Quitar promo"
        text={<>Los hermanos de <b className="text-white">{group?.name}</b> dejarán de tener la promo y las siguientes mensualidades se cobrarán completas. Las mensualidades ya creadas no cambian.</>} />
    </Modal>
  )
}
