import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays } from 'date-fns'
import { TrendingUp, Receipt, Wallet, AlertTriangle, Users, UserPlus, UserX, ClipboardCheck, GraduationCap, HeartHandshake } from 'lucide-react'
import { StatCard } from './ui'
import DateRangeSelect, { basicPresets, type Preset } from './DateRangeSelect'
import { DetailModal, type CardKind, type Detail } from './CardDetails'
import {
  useAttendanceDetail, useCashCuts, useCategories, useCoachPay, useCoaches, useExpenses, useFees, usePayments, useStudents,
} from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { DISCOUNT_LABEL, discountKind, expenseEntries } from '@/lib/finance'
import { date, money, monthName, toISODate, today } from '@/lib/format'

export interface Period { from: string; to: string; label: string }

const nextDay = (d: string) => toISODate(addDays(new Date(d + 'T12:00:00'), 1))
const short = (d: string) => date(d, "d 'de' MMM")

/**
 * Selector de periodo del Dashboard: por default "desde el último corte" hasta hoy;
 * también un corte en especial o fechas exactas. Se queda fijo arriba al bajar.
 */
export function usePeriod() {
  const cuts = useCashCuts()
  const t = today()
  const list = cuts.data ?? []
  // Atajos: desde el último corte, los cortes recientes y los de siempre (hoy, 7 días, este mes…)
  const presets: Preset[] = useMemo(() => {
    const last = list[0]
    const from = last ? (nextDay(last.period_to) > t ? t : nextDay(last.period_to)) : t.slice(0, 8) + '01'
    return [
      { id: 'ultimo', label: 'Desde el último corte', from, to: t },
      ...list.slice(0, 4).map((c) => ({ id: c.id, label: `Corte del ${short(c.cut_date)}`, from: c.period_from, to: c.period_to })),
      ...basicPresets(),
    ]
  }, [list, t])
  const [sel, setSel] = useState<{ id: string; from: string; to: string }>({ id: 'ultimo', from: t, to: t })
  // "Desde el último corte" (y los cortes) se recalculan solos cuando llegan los cortes
  const live = presets.find((p) => p.id === sel.id)
  const cur = live && sel.id !== 'personalizado' ? { id: live.id, from: live.from, to: live.to } : sel
  const label = sel.id === 'personalizado' ? `Del ${short(cur.from)} al ${short(cur.to)}` : `${live?.label ?? ''} (${short(cur.from)}${cur.from === cur.to ? '' : ` al ${short(cur.to)}`})`
  const period: Period = { from: cur.from, to: cur.to, label }
  const bar = <DateRangeSelect value={cur} presets={presets} onChange={(v) => setSel({ id: v.id, from: v.from, to: v.to })} />
  return { period, bar }
}

/** Tarjetas del Dashboard según el periodo escogido, en el orden que pidió administración. */
export default function PeriodCards({ period, onDetail }: { period: Period; onDetail: (k: CardKind) => void }) {
  const { from, to } = period
  const students = useStudents()
  const categories = useCategories()
  const fees = useFees()
  const payments = usePayments(undefined, from)
  const expenses = useExpenses()
  const coaches = useCoaches()
  const coachPay = useCoachPay()
  const att = useAttendanceDetail({ from, to })
  // Bajas: se sacan del registro de actividad (cuando el estatus cambió a baja)
  const bajas = useQuery({
    queryKey: ['activity', 'bajas', from, to],
    queryFn: async () => unwrap(await supabase.from('activity').select('at, student_id, title, body').ilike('body', '%Estatus:%→ baja%').gte('at', from).lte('at', `${to}T23:59:59`)) as { at: string; student_id: string | null; title: string; body: string | null }[],
  })
  const [open, setOpen] = useState<Detail | null>(null)

  const d = useMemo(() => {
    const st = students.data ?? []
    const name = new Map(st.map((s) => [s.id, s.full_name]))
    const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
    const catOf = (id: string) => catName.get(st.find((s) => s.id === id)?.category_id ?? '') ?? 'Sin categoría'
    const active = st.filter((s) => s.status === 'activo')
    const activeIds = new Set(active.map((s) => s.id))
    const allFees = fees.data ?? []
    const feeById = new Map(allFees.map((f) => [f.id, f]))
    const group = <T,>(xs: T[], key: (x: T) => string) => {
      const m = new Map<string, T[]>()
      for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
    }
    const sum = <T,>(xs: T[], v: (x: T) => number) => xs.reduce((a, x) => a + v(x), 0)

    // 1. Entradas
    const pays = (payments.data ?? []).filter((p) => p.paid_at >= from && p.paid_at <= to)
    const conceptOf = (p: (typeof pays)[number]) => feeById.get(p.fee_id)?.concept ?? 'Otro'
    // 2. Gastos (sueldos, administrativos y del mes que caen en esas fechas)
    const months: string[] = []
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = toISODate(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1, 12)).slice(0, 7)) months.push(m)
    const spend = months.flatMap((month) => expenseEntries({ month, expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: coachPay.data ?? [] }))
      .filter((e) => e.date >= from && e.date <= to && !e.pending)
    const KIND = { sueldo: 'Sueldos de profesores', fijo: 'Gastos administrativos', mes: 'Gastos del mes', prestamo: 'Pagos de préstamos' }
    // 3. Pendiente por cobrar (lo que vence hasta el final del periodo)
    const pend = allFees.filter((f) => Number(f.balance) > 0 && activeIds.has(f.student_id) && f.status !== 'por_confirmar' && f.due_date <= to)
    // 4. Recargos y extras
    const openFees = allFees.filter((f) => Number(f.balance) > 0 && activeIds.has(f.student_id))
    const late = sum(openFees, (f) => Number(f.late_fee))
    const extras = sum(openFees.filter((f) => f.concept !== 'Mensualidad'), (f) => Number(f.balance))
    // 6. Nuevos y 7. Clases muestra
    // Alumnos nuevos: los que se registraron en la plataforma en esas fechas (sin contar los que siguen a prueba)
    const regDay = (s: (typeof st)[number]) => toISODate(new Date(s.created_at))
    const nuevos = st.filter((s) => s.status !== 'muestra' && regDay(s) >= from && regDay(s) <= to)
    const muestras = st.filter((s) => (s.trial_on && s.trial_on >= from && s.trial_on <= to) || (s.status === 'muestra' && s.created_at.slice(0, 10) >= from && s.created_at.slice(0, 10) <= to))
    // 8. Asistencia
    const rows = (att.data ?? []).filter((a) => a.status !== 'justificada')
    const came = rows.filter((a) => a.status === 'presente' || a.status === 'retardo')
    const pct = rows.length ? Math.round((came.length / rows.length) * 100) : null
    // 9. Bajas
    const bj = bajas.data ?? []
    // 10. Con adeudo y 11. con adeudo y beca
    const owing = group(openFees.filter((f) => f.status !== 'por_confirmar'), (f) => f.student_id)
    const becados = new Set(allFees.filter((f) => Number(f.discount) > 0 && discountKind(f.discount_reason) === 'beca').map((f) => f.student_id))
    const owingBeca = owing.filter(([id]) => becados.has(id))
    // 12. Becas del periodo (cuotas de los meses del periodo)
    const disc = allFees.filter((f) => months.includes(f.period.slice(0, 7)) && Number(f.discount) > 0 && activeIds.has(f.student_id))

    const owingRow = ([id, fs]: [string, typeof allFees]) => ({
      label: name.get(id) ?? 'Alumno', sub: fs.map((f) => `${f.concept} ${monthName(f.period)}${f.status === 'vencido' ? ' (vencido)' : ''}`).join(' · '),
      value: sum(fs, (f) => Number(f.balance)), link: `/alumnos/${id}?tab=pagos`, wa: st.find((x) => x.id === id), tone: fs.some((f) => f.status === 'vencido') ? 'bad' as const : undefined,
    })
    return {
      income: { total: sum(pays, (p) => Number(p.amount)), detail: { title: 'Entradas', total: sum(pays, (p) => Number(p.amount)), note: period.label,
        groups: group(pays, conceptOf).map(([k, ps]) => ({ label: k, total: sum(ps, (p) => Number(p.amount)), rows: ps.sort((a, b) => a.paid_at.localeCompare(b.paid_at)).map((p) => ({ label: name.get(p.student_id) ?? 'Alumno', sub: `${short(p.paid_at)} · ${p.method}`, value: Number(p.amount), link: `/alumnos/${p.student_id}?tab=pagos` })) })) } as Detail },
      spend: { total: sum(spend, (e) => e.amount), sueldos: sum(spend.filter((e) => e.kind === 'sueldo'), (e) => e.amount), detail: { title: 'Gastos', total: sum(spend, (e) => e.amount), note: `${period.label} · sueldos cada miércoles, mensuales el día 1`,
        groups: group(spend, (e) => KIND[e.kind]).map(([k, es]) => ({ label: k, total: sum(es, (e) => e.amount), rows: es.map((e) => ({ label: e.name, sub: `${short(e.date)} · ${e.detail}`, value: e.amount })) })) } as Detail },
      pend: { total: sum(pend, (f) => Number(f.balance)), students: new Set(pend.map((f) => f.student_id)).size, detail: { title: 'Pendiente por cobrar', total: sum(pend, (f) => Number(f.balance)), note: `Lo que ya debía estar pagado al ${short(to)}`,
        groups: group(pend, (f) => monthName(f.period)).map(([k, fs]) => ({ label: k, total: sum(fs, (f) => Number(f.balance)), rows: fs.map((f) => ({ label: name.get(f.student_id) ?? 'Alumno', sub: `${f.concept} · venció el ${short(f.due_date)}`, value: Number(f.balance), link: `/alumnos/${f.student_id}?tab=pagos` })) })) } as Detail },
      late, extras,
      nuevos: { n: nuevos.length, detail: { title: 'Alumnos nuevos', total: `${nuevos.length}`, note: period.label, groups: group(nuevos, (s) => catName.get(s.category_id ?? '') ?? 'Sin categoría').map(([k, xs]) => ({ label: k, total: `${xs.length}`, rows: xs.map((s) => ({ label: s.full_name, sub: `Se registró el ${short(regDay(s))}${s.status === 'baja' ? ' · ya está de baja' : ''}`, link: `/alumnos/${s.id}` })) })) } as Detail },
      muestras: { n: muestras.length, detail: { title: 'Clases muestra', total: `${muestras.length}`, note: period.label, groups: [{ label: 'Niños que vinieron a probar', rows: muestras.map((s) => ({ label: s.full_name, sub: `${s.trial_on ? `Clase el ${short(s.trial_on)} · ` : ''}${s.status === 'muestra' ? 'Sigue a prueba' : s.status === 'activo' ? 'Ya se inscribió' : s.status}`, link: `/alumnos/${s.id}` })) }] } as Detail },
      att: { pct, detail: { title: 'Asistencia', total: pct == null ? '—' : `${pct}%`, note: `${came.length} asistencias de ${rows.length} (sin contar justificadas) · ${period.label}`,
        groups: group(rows, (a) => catOf(a.student_id)).map(([k, xs]) => { const c = xs.filter((a) => a.status === 'presente' || a.status === 'retardo').length; return { label: k, total: `${Math.round((c / xs.length) * 100)}%`, rows: [{ label: `${c} de ${xs.length} asistencias`, value: `${Math.round((c / xs.length) * 100)}%` }] } }) } as Detail },
      bajas: { n: bj.length, detail: { title: 'Bajas de alumnos', total: `${bj.length}`, note: period.label, groups: [{ label: 'Se dieron de baja', rows: bj.map((b) => ({ label: name.get(b.student_id ?? '') ?? b.title, sub: `${short(b.at.slice(0, 10))}${b.body ? ` · ${b.body}` : ''}`, link: b.student_id ? `/alumnos/${b.student_id}` : undefined })) }] } as Detail },
      owing: owing.length,
      owingBeca: { n: owingBeca.length, detail: { title: 'Alumnos con adeudo y beca', total: `${owingBeca.length} · ${money(sum(owingBeca, ([, fs]) => sum(fs, (f) => Number(f.balance))))}`, note: 'Tienen beca y aun así deben algo.',
        groups: group(owingBeca, ([id]) => catOf(id)).map(([k, xs]) => ({ label: k, total: sum(xs, ([, fs]) => sum(fs, (f) => Number(f.balance))), rows: xs.map(owingRow) })) } as Detail },
      becas: { total: sum(disc, (f) => Number(f.discount)), students: new Set(disc.map((f) => f.student_id)).size, detail: { title: 'Becas y descuentos', total: sum(disc, (f) => Number(f.discount)), note: `Cuotas de ${months.map((m) => monthName(`${m}-01`)).join(', ')} · dinero que se deja de cobrar`,
        groups: group(disc, (f) => DISCOUNT_LABEL[discountKind(f.discount_reason)]).map(([k, fs]) => ({ label: k, total: sum(fs, (f) => Number(f.discount)), rows: fs.map((f) => ({ label: name.get(f.student_id) ?? 'Alumno', sub: `${f.concept} ${monthName(f.period)} · ${f.discount_reason ?? ''}`, value: Number(f.discount), link: `/alumnos/${f.student_id}?tab=pagos` })) })) } as Detail },
      active: active.length,
    }
  }, [students.data, categories.data, fees.data, payments.data, expenses.data, coaches.data, coachPay.data, att.data, bajas.data, from, to, period.label])

  const hint = period.label
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Entradas" value={money(d.income.total)} icon={TrendingUp} tone="ok" hint={hint} onClick={() => setOpen(d.income.detail)} />
        <StatCard label="Gastos" value={money(Math.round(d.spend.total))} icon={Receipt} tone="bad" hint={`Sueldos ${money(Math.round(d.spend.sueldos))} · otros ${money(Math.round(d.spend.total - d.spend.sueldos))}`} onClick={() => setOpen(d.spend.detail)} />
        <StatCard label="Pendiente por cobrar" value={money(d.pend.total)} icon={Wallet} hint={`${d.pend.students} alumnos · vencido al ${short(to)}`} onClick={() => setOpen(d.pend.detail)} />
        <StatCard label="Recargos y extras pendientes" value={money(d.late + d.extras)} icon={AlertTriangle} tone={d.late + d.extras > 0 ? 'bad' : undefined} hint={`Recargos ${money(d.late)} · Extras ${money(d.extras)}`} onClick={() => onDetail('recargos')} />
        <StatCard label="Alumnos activos" value={d.active} icon={Users} hint="Hoy" onClick={() => onDetail('activos')} />
        <StatCard label="Alumnos nuevos" value={d.nuevos.n} icon={UserPlus} tone={d.nuevos.n ? 'ok' : undefined} hint={hint} onClick={() => setOpen(d.nuevos.detail)} />
        <StatCard label="Clases muestra" value={d.muestras.n} icon={UserPlus} tone={d.muestras.n ? 'brand' : undefined} hint={hint} onClick={() => setOpen(d.muestras.detail)} />
        <StatCard label="Asistencia" value={d.att.pct == null ? '—' : `${d.att.pct}%`} icon={ClipboardCheck} tone={d.att.pct == null ? undefined : d.att.pct >= 80 ? 'ok' : 'bad'} hint={d.att.pct == null ? 'No se ha pasado lista' : hint} onClick={() => setOpen(d.att.detail)} />
        <StatCard label="Bajas de alumnos" value={d.bajas.n} icon={UserX} tone={d.bajas.n ? 'bad' : undefined} hint={hint} onClick={() => setOpen(d.bajas.detail)} />
        <StatCard label="Alumnos con adeudo" value={d.owing} icon={AlertTriangle} tone={d.owing ? 'bad' : 'ok'} hint={d.active ? `${Math.round((d.owing / d.active) * 100)}% de los activos · hoy` : undefined} onClick={() => onDetail('adeudo')} />
        <StatCard label="Con adeudo y beca" value={d.owingBeca.n} icon={HeartHandshake} tone={d.owingBeca.n ? 'bad' : undefined} hint="Tienen beca y aun así deben · hoy" onClick={() => setOpen(d.owingBeca.detail)} />
        <StatCard label="Becas y descuentos" value={money(d.becas.total)} icon={GraduationCap} hint={`${d.becas.students} alumnos · cuotas del mes`} onClick={() => setOpen(d.becas.detail)} />
      </div>
      {open && <DetailModal d={open} onClose={() => setOpen(null)} />}
    </>
  )
}
