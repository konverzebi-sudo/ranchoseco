import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { startOfMonth } from 'date-fns'
import { Button, Modal, cx } from './ui'
import {
  useAttendanceDetail, useCashCuts, useCategories, useCoachCategories, useCoachPay, useCoaches, useExpenses, useFees, usePayments, useStudents,
} from '@/lib/api'
import { SAVINGS_BOX_KEY, carryOver, cutBalance, savingFunds } from '@/lib/cashcut'
import { DISCOUNT_LABEL, discountKind, insuranceSaving, isNewEnrollment } from '@/lib/finance'
import { isUniformConcept } from '@/lib/uniforms'
import { ATTENDANCE_LABEL, date, money, monthName, toISODate, today } from '@/lib/format'

export type CardKind =
  | 'total' | 'chica' | 'apartado' | 'ahorro' | 'pendiente' | 'recargos' | 'becas' | 'nuevas'
  | 'muestra' | 'asistencia' | 'activos' | 'profes' | 'seguro' | 'uniformes' | 'porconfirmar'

interface Row { label: string; sub?: string; value?: number | string; link?: string; tone?: 'bad' | 'ok' }
interface Group { label: string; total?: number | string; rows: Row[] }
interface Detail { title: string; total?: number | string; note?: string; groups: Group[]; go?: { label: string; to: string } }

const fmt = (v: number | string | undefined) => (typeof v === 'number' ? money(v) : v ?? '')
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Desglose de cada tarjeta del Dashboard: al picarle se ve de qué se compone. */
export default function CardDetailModal({ kind, onClose }: { kind: CardKind; onClose: () => void }) {
  const nav = useNavigate()
  const t = today()
  const month = t.slice(0, 7)
  const mes = MONTHS[Number(month.slice(5, 7)) - 1]
  const students = useStudents()
  const categories = useCategories()
  const fees = useFees()
  const cuts = useCashCuts()
  const expenses = useExpenses()
  const coaches = useCoaches()
  const coachPay = useCoachPay()
  const cc = useCoachCategories()
  const allPayments = usePayments()
  const todayAtt = useAttendanceDetail({ from: t, to: t })
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true })

  const d: Detail | null = useMemo(() => {
    const st = students.data ?? []
    const name = new Map(st.map((s) => [s.id, s.full_name]))
    const cat = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
    const catOf = (id: string | null) => (id ? cat.get(id) ?? '' : 'Sin categoría')
    const active = st.filter((s) => s.status === 'activo')
    const activeIds = new Set(active.map((s) => s.id))
    const allFees = fees.data ?? []
    const list = cuts.data ?? []
    const funds = savingFunds({ cutDate: t, expenses: expenses.data ?? [], cuts: list })
    const since = list[0] ? `Al corte del ${date(list[0].cut_date, "d 'de' MMM")}` : 'Aún no hay cortes'
    const byKey = <T,>(xs: T[], key: (x: T) => string) => {
      const m = new Map<string, T[]>()
      for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
      return [...m.entries()]
    }
    const fundRows = (f: (typeof funds)[number]) => ({ label: f.name, sub: f.kind === 'ahorro' ? 'Ahorro libre' : `Para el ${date(f.due, "d 'de' MMM")} · meta ${money(f.target)}`, value: f.saved })

    switch (kind) {
      case 'chica': {
        const last = list[0]
        if (!last) return { title: 'Caja chica', total: 0, note: 'Aún no hay cortes.', groups: [], go: { label: 'Ir al corte de caja', to: '/corte' } }
        const prev = list[1]
        const saved = (last.savings ?? []).reduce((a, s) => a + (Number(s.saved) || 0), 0)
        const covered = (last.distribution ?? []).filter((x) => Number(x.amount) < 0)
        const bal = cutBalance(last, prev)
        return {
          title: 'Caja chica', total: bal < -0.5 ? bal : carryOver(last), note: since,
          groups: [
            { label: `Cómo quedó el corte del ${date(last.cut_date, "d 'de' MMM")}`, total: bal, rows: [
              { label: 'Había en caja chica (corte anterior)', value: carryOver(prev) },
              { label: '+ Entró', value: Number(last.income), tone: 'ok' },
              { label: '− Salió', value: -Number(last.outflow), tone: 'bad' },
              { label: '− Se apartó de ahorro', value: -saved },
              ...covered.map((x) => ({ label: `+ ${x.to}`, value: -Number(x.amount) })),
              { label: bal < -0.5 ? '= Faltó (sin explicar de dónde salió)' : '= Saldo', value: bal, tone: bal < -0.5 ? 'bad' as const : undefined },
            ] },
            { label: 'A dónde se mandó el dinero', rows: (last.distribution ?? []).filter((x) => Number(x.amount) > 0).map((x) => ({ label: x.to, value: Number(x.amount) })) },
          ],
          go: { label: 'Ir al corte de caja', to: '/corte' },
        }
      }
      case 'total':
      case 'apartado':
      case 'ahorro': {
        const box = funds.filter((f) => f.kind === 'ahorro')
        const apart = funds.filter((f) => f.kind !== 'ahorro' && f.kind !== 'uniformes')
        const boxCuts = list.flatMap((c) => (c.savings ?? []).filter((s) => s.key === SAVINGS_BOX_KEY && Number(s.saved)).map((s) => ({ label: `Corte del ${date(c.cut_date, "d 'de' MMM")}`, sub: s.note || undefined, value: Number(s.saved) })))
        const gA: Group = { label: 'Caja de ahorro', total: box.reduce((a, f) => a + f.saved, 0), rows: boxCuts.length ? boxCuts : [{ label: 'Todavía no se ha apartado nada', value: 0 }] }
        const gP: Group = { label: 'Apartado de próximos gastos', total: apart.reduce((a, f) => a + f.saved, 0), rows: apart.map(fundRows) }
        const groups = kind === 'ahorro' ? [gA] : kind === 'apartado' ? [gP] : [gA, gP]
        const title = kind === 'ahorro' ? 'Caja de ahorro' : kind === 'apartado' ? 'Apartado de próximos gastos' : 'Caja total'
        return { title, total: groups.reduce((a, g) => a + Number(g.total ?? 0), 0), note: since, groups, go: { label: 'Ir al corte de caja', to: '/corte' } }
      }
      case 'pendiente': {
        const open = allFees.filter((f) => Number(f.balance) > 0 && activeIds.has(f.student_id))
        return {
          title: `Pendiente de cobro a ${mes}`, total: open.reduce((a, f) => a + Number(f.balance), 0), note: `${open.length} cargos abiertos`,
          groups: byKey(open.sort((a, b) => b.period.localeCompare(a.period)), (f) => monthName(f.period)).map(([k, fs]) => ({
            label: k, total: fs.reduce((a, f) => a + Number(f.balance), 0),
            rows: fs.sort((a, b) => (name.get(a.student_id) ?? '').localeCompare(name.get(b.student_id) ?? '', 'es')).map((f) => ({
              label: name.get(f.student_id) ?? 'Alumno', sub: `${f.concept}${f.status === 'vencido' ? ' · vencido' : ''}${Number(f.late_fee) > 0 ? ` · incluye ${money(f.late_fee)} de recargo` : ''}`,
              value: Number(f.balance), link: `/alumnos/${f.student_id}?tab=pagos`, tone: f.status === 'vencido' ? 'bad' as const : undefined,
            })),
          })),
          go: { label: 'Ir a cobranza', to: '/cobranza?f=pendiente' },
        }
      }
      case 'recargos': {
        const open = allFees.filter((f) => Number(f.balance) > 0 && activeIds.has(f.student_id))
        const late = open.filter((f) => Number(f.late_fee) > 0)
        const extras = open.filter((f) => f.concept !== 'Mensualidad')
        const row = (f: (typeof open)[number], v: number) => ({ label: name.get(f.student_id) ?? 'Alumno', sub: `${f.concept} ${monthName(f.period)}`, value: v, link: `/alumnos/${f.student_id}?tab=pagos` })
        return {
          title: 'Recargos y extras pendientes', total: late.reduce((a, f) => a + Number(f.late_fee), 0) + extras.reduce((a, f) => a + Number(f.balance), 0),
          groups: [
            { label: 'Recargos por pago tardío', total: late.reduce((a, f) => a + Number(f.late_fee), 0), rows: late.map((f) => row(f, Number(f.late_fee))) },
            { label: 'Extras (inscripciones, uniformes, etc.)', total: extras.reduce((a, f) => a + Number(f.balance), 0), rows: extras.map((f) => row(f, Number(f.balance))) },
          ],
          go: { label: 'Ir a cobranza', to: '/cobranza?f=vencido' },
        }
      }
      case 'becas': {
        const disc = allFees.filter((f) => f.period.startsWith(month) && activeIds.has(f.student_id) && Number(f.discount) > 0)
        return {
          title: `Becas y descuentos de ${mes}`, total: disc.reduce((a, f) => a + Number(f.discount), 0),
          groups: byKey(disc, (f) => DISCOUNT_LABEL[discountKind(f.discount_reason)]).map(([k, fs]) => ({
            label: k, total: fs.reduce((a, f) => a + Number(f.discount), 0),
            rows: fs.map((f) => ({ label: name.get(f.student_id) ?? 'Alumno', sub: `${f.concept} · ${f.discount_reason ?? ''}`, value: Number(f.discount), link: `/alumnos/${f.student_id}?tab=pagos` })),
          })),
          go: { label: 'Ir a becas', to: '/becas' },
        }
      }
      case 'porconfirmar': {
        const rv = allFees.filter((f) => f.status === 'por_confirmar' && activeIds.has(f.student_id))
        return {
          title: '¿Beca? Por confirmar', total: rv.reduce((a, f) => a + Number(f.balance), 0), note: 'Pagaron menos de la cuota: confirmar si es beca o adeudo.',
          groups: [{ label: 'Pagos menores a la cuota', rows: rv.map((f) => ({ label: name.get(f.student_id) ?? 'Alumno', sub: `${f.concept} ${monthName(f.period)} · pagó ${money(f.paid)} de ${money(f.total_due)}`, value: Number(f.balance), link: `/alumnos/${f.student_id}?tab=pagos` })) }],
          go: { label: 'Ir a cobranza', to: '/cobranza?f=por_confirmar' },
        }
      }
      case 'nuevas': {
        const n = st.filter((s) => s.status !== 'baja' && isNewEnrollment(s, month))
        return {
          title: `Nuevas inscripciones de ${mes}`, total: `${n.length}`,
          groups: [{ label: 'Alumnos que entraron', rows: n.map((s) => ({ label: s.full_name, sub: `${catOf(s.category_id)} · entró el ${date(s.enrolled_at, "d 'de' MMM")}`, link: `/alumnos/${s.id}` })) }],
          go: { label: 'Ir a alumnos', to: `/alumnos?nuevos=${month}&st=todos` },
        }
      }
      case 'muestra': {
        const n = st.filter((s) => s.status === 'muestra')
        return {
          title: 'Clases muestra', total: `${n.length}`, note: n.length ? 'Pendientes de cerrar registro' : 'Nadie a prueba ahorita',
          groups: [{ label: 'A prueba', rows: n.map((s) => ({ label: s.full_name, sub: `${catOf(s.category_id)}${s.trial_on ? ` · clase muestra el ${date(s.trial_on, "d 'de' MMM")}` : ''}`, link: `/alumnos/${s.id}` })) }],
          go: { label: 'Ir a alumnos', to: '/alumnos?st=muestra' },
        }
      }
      case 'asistencia': {
        const att = todayAtt.data ?? []
        const present = att.filter((a) => a.status === 'presente' || a.status === 'retardo').length
        return {
          title: 'Asistencia de hoy', total: att.length ? `${present}/${att.length}` : '—', note: att.length ? 'presentes' : 'Aún no se pasa lista hoy',
          groups: byKey(att, (a) => catOf(a.category_id)).map(([k, as]) => ({
            label: k, total: `${as.filter((a) => a.status === 'presente' || a.status === 'retardo').length}/${as.length}`,
            rows: as.map((a) => ({ label: name.get(a.student_id) ?? 'Alumno', value: ATTENDANCE_LABEL[a.status], tone: a.status === 'falta' ? 'bad' as const : a.status === 'presente' ? 'ok' as const : undefined, link: `/alumnos/${a.student_id}` })),
          })),
          go: { label: 'Ir a asistencias', to: '/asistencias' },
        }
      }
      case 'activos':
        return {
          title: 'Alumnos activos', total: `${active.length}`,
          groups: (categories.data ?? []).map((c) => ({ c, ks: active.filter((s) => s.category_id === c.id) })).filter((x) => x.ks.length)
            .map(({ c, ks }) => ({ label: c.name, total: `${ks.length}`, rows: ks.map((s) => ({ label: s.full_name, link: `/alumnos/${s.id}` })) })),
          go: { label: 'Ir a alumnos', to: '/alumnos?st=activo' },
        }
      case 'profes': {
        const act = (coaches.data ?? []).filter((c) => c.active)
        return {
          title: 'Profesores', total: `${act.length}`,
          groups: [{ label: 'Sueldo y categorías', rows: act.map((c) => {
            const p = (coachPay.data ?? []).find((x) => x.coach_id === c.id)
            const cats = (cc.data ?? []).filter((x) => x.coach_id === c.id).map((x) => cat.get(x.category_id)).filter(Boolean).join(', ')
            return { label: c.full_name, sub: cats || 'Sin categoría', value: p ? `${money(p.amount)} ${p.frequency}` : '—' }
          }) }],
          go: { label: 'Ir a profesores', to: '/profesores' },
        }
      }
      case 'seguro': {
        const ins = insuranceSaving(expenses.data ?? [], month)
        if (!ins) return { title: 'Ahorro para el seguro', total: '—', note: 'Agrega el seguro como gasto anual.', groups: [], go: { label: 'Ir a gastos', to: '/gastos' } }
        const rows = Array.from({ length: ins.months }, (_, i) => {
          const dt = new Date(t + 'T12:00:00'); dt.setMonth(dt.getMonth() - (ins.months - 1 - i))
          return { label: monthName(toISODate(startOfMonth(dt))), value: ins.monthly }
        })
        return {
          title: 'Ahorro para el seguro', total: ins.saved, note: `${ins.name}: ${money(ins.total)} · se paga en ${ins.dueLabel} · faltan ${money(ins.remaining)}`,
          groups: [{ label: `Lo que se aparta cada mes (${money(ins.monthly)})`, total: ins.saved, rows }],
          go: { label: 'Ir a gastos', to: '/gastos' },
        }
      }
      case 'uniformes': {
        const feeMap = new Map(allFees.map((f) => [f.id, f]))
        const pays = (allPayments.data ?? []).map((p) => ({ p, f: feeMap.get(p.fee_id) })).filter((x) => x.f && isUniformConcept(x.f.concept))
        const fund = funds.find((f) => f.kind === 'uniformes')
        return {
          title: 'Fondo de uniformes', total: fund?.saved ?? 0, note: 'Lo que se ha mandado al fondo en los cortes. Abajo, los cobros de uniformes.',
          groups: byKey(pays, (x) => x.f!.concept).map(([k, xs]) => ({
            label: k, total: xs.reduce((a, x) => a + Number(x.p.amount), 0),
            rows: xs.map(({ p }) => ({ label: name.get(p.student_id) ?? 'Alumno', sub: date(p.paid_at, "d 'de' MMM"), value: Number(p.amount), link: `/alumnos/${p.student_id}?tab=pagos` })),
          })),
          go: { label: 'Ir a uniformes', to: '/uniformes' },
        }
      }
    }
    return null
  }, [kind, students.data, categories.data, fees.data, cuts.data, expenses.data, coaches.data, coachPay.data, cc.data, allPayments.data, todayAtt.data, t, month, mes])

  if (!d) return null
  return (
    <Modal open onClose={onClose} title={d.title} wide
      footer={<>{d.go && <Button variant="secondary" onClick={() => { onClose(); nav(d.go!.to) }}>{d.go.label}</Button>}<Button onClick={onClose}>Cerrar</Button></>}>
      <div className="space-y-3 text-sm">
        {d.total !== undefined && (
          <div className="flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3">
            <span className="font-display text-lg font-bold uppercase">Total</span>
            <span className={cx('font-display text-2xl font-bold', typeof d.total === 'number' && d.total < 0 && 'text-bad')}>{fmt(d.total)}</span>
          </div>
        )}
        {d.note && <p className="text-xs text-muted">{d.note}</p>}
        {d.groups.length === 0 && <p className="py-4 text-center text-muted">No hay nada que mostrar.</p>}
        <div>
          {d.groups.map((g, i) => (
            <div key={i} className="border-t border-ink-700 first:border-t-0">
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} className="flex w-full items-center justify-between gap-2 py-2 text-left">
                <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
                  <ChevronDown className={cx('h-4 w-4 text-brand transition-transform', !open[i] && '-rotate-90')} />{g.label}{g.rows.length ? ` · ${g.rows.length}` : ''}
                </span>
                {g.total !== undefined && <b className={cx(typeof g.total === 'number' && g.total < 0 && 'text-bad')}>{fmt(g.total)}</b>}
              </button>
              {open[i] && (
                <ul className="space-y-1 pb-2 pl-6">
                  {g.rows.length === 0 && <li className="text-muted">Nada.</li>}
                  {g.rows.map((r, k) => {
                    const body = (
                      <>
                        <span className="min-w-0 truncate">· {r.label}{r.sub && <span className="text-xs text-muted"> {r.sub}</span>}</span>
                        {r.value !== undefined && <span className={cx('shrink-0 tabular-nums', r.tone === 'bad' ? 'text-bad' : r.tone === 'ok' ? 'text-ok' : 'text-muted')}>{fmt(r.value)}</span>}
                      </>
                    )
                    return (
                      <li key={k}>
                        {r.link
                          ? <Link to={r.link} onClick={onClose} className="flex items-baseline justify-between gap-3 hover:text-brand">{body}</Link>
                          : <div className="flex items-baseline justify-between gap-3">{body}</div>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
