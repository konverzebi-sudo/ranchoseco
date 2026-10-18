import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, ShieldCheck, UserPlus, GraduationCap, Vault, PiggyBank, Banknote, Wallet, Shirt } from 'lucide-react'
import { StatCard } from '@/components/ui'
import { DetailModal, type Detail } from '@/components/CardDetails'
import { useCashCuts, useCoachPay, useCoaches, useExpenses, useFees, usePayments, useSettings, useStudents } from '@/lib/api'
import { chivasConfig, openingCash, savingFunds } from '@/lib/cashcut'
import { DISCOUNT_LABEL, discountsFor, expenseEntries, insuranceSaving, isNewEnrollment } from '@/lib/finance'
import { money, today } from '@/lib/format'

const MONTH_NAME = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const monthLabel = (month: string) => `${MONTH_NAME[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

export const monthNameOf = (month: string) => MONTH_NAME[Number(month.slice(5, 7)) - 1]

/** Gastos del mes, ahorro del seguro, nuevas inscripciones y becas/descuentos. Se usa en Dashboard y Gastos. */
export default function FinanceModules() {
  const c = useFinanceCards()
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{c.gastos}{c.seguro}{c.nuevas}{c.becas}</div>
}

/** Las tarjetas de dinero por separado, para acomodarlas en el orden que se quiera. */
export function useFinanceCards(onDetail?: (k: 'seguro' | 'nuevas' | 'becas') => void) {
  const nav = useNavigate()
  const month = today().slice(0, 7)
  const expenses = useExpenses()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const students = useStudents()
  const fees = useFees()

  const d = useMemo(() => {
    const entries = expenseEntries({ month, expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [] }).filter((e) => e.kind !== 'prestamo')
    const salaries = entries.filter((e) => e.kind === 'sueldo').reduce((a, e) => a + e.amount, 0)
    const total = entries.reduce((a, e) => a + e.amount, 0)
    const ins = insuranceSaving(expenses.data ?? [], month)
    const nuevos = (students.data ?? []).filter((s) => s.status !== 'baja' && isNewEnrollment(s, month)).length
    const active = new Set((students.data ?? []).filter((s) => s.status === 'activo').map((s) => s.id))
    const disc = discountsFor((fees.data ?? []).filter((f) => f.period.startsWith(month) && active.has(f.student_id)))
    return { total, salaries, ins, nuevos, disc }
  }, [month, expenses.data, coaches.data, pay.data, students.data, fees.data])

  const discHint = (Object.keys(d.disc.by) as (keyof typeof d.disc.by)[])
    .filter((k) => d.disc.by[k] > 0).map((k) => `${DISCOUNT_LABEL[k]} ${money(d.disc.by[k])}`).join(' · ')

  return {
    gastos: (
      <StatCard key="gastos" label={`Gastos de ${MONTH_NAME[Number(month.slice(5, 7)) - 1]}`} value={money(Math.round(d.total))} icon={Receipt} tone="bad"
        hint={`Sueldos ${money(Math.round(d.salaries))} · Otros ${money(Math.round(d.total - d.salaries))} · Ver día a día`} onClick={() => nav(`/gastos/desglose?mes=${month}`)} />
    ),
    seguro: (
      <StatCard key="seguro" label="Ahorro para el seguro" value={d.ins ? money(Math.round(d.ins.saved)) : '—'} icon={ShieldCheck}
        hint={!d.ins ? 'Agrega el seguro como gasto anual' : d.ins.startsIn
          ? `Empieza en ${d.ins.startsIn}: apartar ${money(Math.round(d.ins.monthly))} al mes`
          : `${d.ins.months} de 12 meses · de ${money(d.ins.total)} · se paga en ${d.ins.dueLabel}`}
        onClick={() => (onDetail ? onDetail('seguro') : nav('/gastos'))} />
    ),
    nuevas: (
      <StatCard key="nuevas" label={`Nuevas inscripciones de ${MONTH_NAME[Number(month.slice(5, 7)) - 1]}`} value={d.nuevos} icon={UserPlus} tone={d.nuevos ? 'ok' : undefined}
        hint={`Alumnos que entraron en ${MONTH_NAME[Number(month.slice(5, 7)) - 1]}`} onClick={() => (onDetail ? onDetail('nuevas') : nav(`/alumnos?nuevos=${month}&st=todos`))} />
    ),
    becas: (
      <StatCard key="becas" label={`Becas y descuentos de ${MONTH_NAME[Number(month.slice(5, 7)) - 1]}`} value={money(d.disc.total)} icon={GraduationCap}
        hint={`${d.disc.students} alumnos${discHint ? ' · ' + discHint : ''}`} onClick={() => (onDetail ? onDetail('becas') : nav('/becas'))} />
    ),
  }
}

/** Las cajas según el último corte: caja chica, apartado de próximos gastos, caja de ahorro y total. */
/** Tarjeta de una caja: sólo título y total; al picarla se abre su desglose. */
function BoxCard({ label, icon: Icon, total, now, items, tone, hint, onClick }: {
  label: string; icon: typeof Wallet; total: number; now?: number; items?: { name: string; value: number }[]; tone?: string; hint?: string; onClick?: () => void
}) {
  const [open, setOpen] = useState(false)
  const r = (n: number) => money(Math.round(n)).replace('.00', '')
  const detail: Detail = {
    title: label, total,
    note: now != null ? `Acumulado ${r(total)} · se agregaron ${r(now)} en el último corte` : hint,
    groups: items && items.length ? [{ label: 'En qué está', total, rows: items.map((x) => ({ label: x.name, value: x.value })) }] : [],
    go: { label: 'Ir al corte de caja', to: '/corte' },
  }
  return (
    <>
      <button type="button" onClick={() => (onClick ? onClick() : setOpen(true))} title="Pica para ver el desglose"
        className="rounded-2xl border border-ink-600 bg-ink-800 p-4 text-left transition hover:border-ink-500 hover:bg-ink-700">
        <div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p><Icon className="h-5 w-5 text-brand" /></div>
        <p className={'mt-2 font-display text-3xl font-bold leading-none ' + (tone ?? '')}>{r(total)}</p>
      </button>
      {open && <DetailModal d={detail} onClose={() => setOpen(false)} />}
    </>
  )
}

export function useCashBoxCards(onDetail?: (k: 'total' | 'chica' | 'apartado' | 'ahorro' | 'uniformes' | 'chivas') => void) {
  const nav = useNavigate()
  const cuts = useCashCuts()
  const expenses = useExpenses()
  const payments = usePayments()
  const coaches = useCoaches()
  const coachPay = useCoachPay()
  const fees = useFees()
  const settings = useSettings()
  const b = useMemo(() => {
    const list = cuts.data ?? []
    const last = list[0]
    const t = today()
    const funds = savingFunds({ cutDate: t, expenses: expenses.data ?? [], cuts: list })
    // Caja chica: con lo que empezó + lo cobrado desde el último corte − lo que ya salió (sueldos y gastos de caja)
    const since = last?.period_to ?? '0000-00-00'
    const cobrado = (payments.data ?? []).filter((p) => p.paid_at > since && p.paid_at <= t).reduce((a, p) => a + Number(p.amount), 0)
    const months = [...new Set([since.slice(0, 7), t.slice(0, 7)])].filter((m) => m >= '2000')
    const salio = months.flatMap((month) => expenseEntries({ month, expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: coachPay.data ?? [] }))
      .filter((e) => e.date > since && e.date <= t && !e.pending && (e.from ?? 'caja') === 'caja').reduce((a, e) => a + e.amount, 0)
    const ahorro = funds.find((f) => f.kind === 'ahorro')?.saved ?? 0
    const apartFunds = funds.filter((f) => f.kind !== 'ahorro' && f.kind !== 'chivas' && f.kind !== 'seguro')
    const apartado = apartFunds.reduce((a, f) => a + f.saved, 0)
    const uniformes = funds.find((f) => f.kind === 'uniformes')?.saved ?? 0
    // Lo que se agregó en el último corte a cada caja
    const lastNow = (pred: (k: string, name: string) => boolean) => (last?.savings ?? []).filter((x) => pred(x.key, x.name)).reduce((a, x) => a + Number(x.saved), 0)
    const isChivasKey = (k: string, name: string) => k.startsWith('x:chivas') || /seguro/i.test(name)
    // Caja Chivas: sólo con las inscripciones cobradas, en sus 4 mini cajas
    const seguroGasto = Number((expenses.data ?? []).find((e) => /seguro/i.test(e.name) && e.active)?.amount ?? 0)
    const cfg = chivasConfig(settings.data, seguroGasto)
    const inscFee = new Set((fees.data ?? []).filter((f) => /^inscripci[oó]n/i.test(f.concept)).map((f) => f.id))
    const ins = (payments.data ?? []).filter((p) => inscFee.has(p.fee_id))
    const part = (xs: typeof ins) => {
      const total = xs.reduce((a, p) => a + Number(p.amount), 0)
      const cred = xs.reduce((a, p) => a + (p.split ? Number(p.split.credencial) : cfg.credencial), 0)
      const play = xs.reduce((a, p) => a + (p.split ? Number(p.split.playera) : cfg.playera), 0)
      const seg = Math.min(cfg.seguroAnual, xs.reduce((a, p) => a + (p.split ? Number(p.split.seguro) : cfg.seguro), 0))
      return { total, items: [{ name: 'Credenciales', value: cred }, { name: 'Playeras de entrenamiento', value: play }, { name: 'Seguro', value: seg }, { name: 'Libre en Caja Chivas', value: Math.max(0, total - cred - play - seg) }] }
    }
    const chivasAll = part(ins)
    const chivasLast = last ? part(ins.filter((p) => p.paid_at >= last.period_from && p.paid_at <= last.period_to)).total : 0
    return {
      last, chica: openingCash(last, list[1]) + cobrado - salio, ahorro, apartado, uniformes, chivas: chivasAll.total,
      apartItems: apartFunds.filter((f) => f.saved > 0.5).map((f) => ({ name: f.kind === 'uniformes' ? 'Fondo de uniformes' : f.name, value: f.saved })),
      chivasItems: chivasAll.items,
      now: { ahorro: lastNow((k) => k === 'x:caja-ahorro'), apartado: lastNow((k, n) => k !== 'x:caja-ahorro' && !isChivasKey(k, n)), chivas: chivasLast },
    }
  }, [cuts.data, expenses.data, payments.data, coaches.data, coachPay.data, fees.data, settings.data])
  const go = (k: 'total' | 'chica' | 'apartado' | 'ahorro' | 'chivas') => () => (onDetail ? onDetail(k) : nav('/corte'))
  return {
    total: <BoxCard key="total" label="Caja total" icon={Wallet} total={b.chica + b.ahorro + b.apartado + b.chivas} now={b.now.ahorro + b.now.apartado + b.now.chivas}
      items={[{ name: 'Caja chica', value: b.chica }, { name: 'Caja de ahorro', value: b.ahorro }, { name: 'Apartado próx. gastos', value: b.apartado }, { name: 'Caja Chivas', value: b.chivas }]} />,
    chivas: <BoxCard key="chivas" label="Caja Chivas" icon={Vault} total={b.chivas} now={b.now.chivas} items={b.chivasItems} tone="text-bad" />,
    chica: <BoxCard key="chica" label="Caja chica" icon={Banknote} total={b.chica} tone={b.chica < 0 ? 'text-bad' : undefined} onClick={go('chica')} />,
    apartado: <BoxCard key="apartado" label="Apartado próx. gastos" icon={Vault} total={b.apartado} now={b.now.apartado} items={b.apartItems} tone="text-brand" />,
    uniformes: <StatCard key="uniformes" label="Fondo de uniformes" value={money(Math.round(b.uniformes))} icon={Shirt} hint="Playeras, altas en Chivas, uniformes y credenciales" onClick={() => (onDetail ? onDetail('uniformes') : nav('/uniformes'))} />,
    ahorro: <BoxCard key="ahorro" label="Caja de ahorro" icon={PiggyBank} total={b.ahorro} now={b.now.ahorro} tone="text-ok"
      items={[{ name: 'Lo ahorrado antes', value: b.ahorro - b.now.ahorro }, { name: 'Lo que se agregó en el último corte', value: b.now.ahorro }]} />,
  }
}
