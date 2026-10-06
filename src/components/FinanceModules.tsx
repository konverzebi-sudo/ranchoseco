import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, ShieldCheck, UserPlus, GraduationCap, Vault, PiggyBank, Banknote, Wallet, Shirt } from 'lucide-react'
import { StatCard } from '@/components/ui'
import { useCashCuts, useCoachPay, useCoaches, useExpenses, useFees, useStudents } from '@/lib/api'
import { openingCash, savingFunds } from '@/lib/cashcut'
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
export function useCashBoxCards(onDetail?: (k: 'total' | 'chica' | 'apartado' | 'ahorro' | 'uniformes') => void) {
  const nav = useNavigate()
  const cuts = useCashCuts()
  const expenses = useExpenses()
  const b = useMemo(() => {
    const list = cuts.data ?? []
    const last = list[0]
    const funds = savingFunds({ cutDate: today(), expenses: expenses.data ?? [], cuts: list })
    const ahorro = funds.find((f) => f.kind === 'ahorro')?.saved ?? 0
    const apartado = funds.filter((f) => f.kind !== 'ahorro' && f.kind !== 'uniformes').reduce((a, f) => a + f.saved, 0)
    const uniformes = funds.find((f) => f.kind === 'uniformes')?.saved ?? 0
    return { last, chica: openingCash(last, list[1]), ahorro, apartado, uniformes }
  }, [cuts.data, expenses.data])
  const since = b.last ? `Al corte del ${b.last.cut_date.slice(8, 10)}/${b.last.cut_date.slice(5, 7)}` : 'Aún no hay cortes'
  const go = (k: 'total' | 'chica' | 'apartado' | 'ahorro') => () => (onDetail ? onDetail(k) : nav('/corte'))
  return {
    total: <StatCard key="total" label="Caja total" value={money(Math.round(b.ahorro + b.apartado))} icon={Wallet} tone="brand" hint={`Caja de ahorro + apartado · ${since}`} onClick={go('total')} />,
    chica: <StatCard key="chica" label="Caja chica" value={money(Math.round(b.chica))} icon={Banknote} tone={b.chica < 0 ? 'bad' : undefined}
      hint={b.chica < 0 ? `En negativo: faltó dinero y no se anotó de dónde salió · ${since}` : `Efectivo en caja · ${since}`} onClick={go('chica')} />,
    apartado: <StatCard key="apartado" label="Apartado de próximos gastos" value={money(Math.round(b.apartado))} icon={Vault} hint="Regalías, renta, seguro, partes y préstamos" onClick={go('apartado')} />,
    uniformes: <StatCard key="uniformes" label="Fondo de uniformes" value={money(Math.round(b.uniformes))} icon={Shirt} hint="Playeras, altas en Chivas, uniformes y credenciales" onClick={() => (onDetail ? onDetail('uniformes') : nav('/uniformes'))} />,
    ahorro: <StatCard key="ahorro" label="Caja de ahorro" value={money(Math.round(b.ahorro))} icon={PiggyBank} tone="ok" hint="Ahorro libre (inscripciones, etc.)" onClick={go('ahorro')} />,
  }
}
