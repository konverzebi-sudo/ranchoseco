import { useMemo, useState } from 'react'
import { Input } from './ui'
import { Card } from './ui'
import { Gauge, GaugeGrid, PieChart } from './Gauges'
import { useCategoryResults } from './CategoryResults'
import { useCashCuts, useExpenses, useExtraClasses, useFees, usePayments, useSettings, useStudents } from '@/lib/api'
import { chivasConfig, savingFunds } from '@/lib/cashcut'
import { date, money, monthName, today } from '@/lib/format'

export interface FundBar { name: string; saved: number; target: number; hint?: string }

const cents = (n: number) => money(Math.round(n)).replace('.00', '')
const mesDe = (month: string) => monthName(`${month}-01`).split(' ')[0].toLowerCase()

/** Barras de los fondos: regalías, renta, seguro y uniformes. */
export function fundBars(funds: ReturnType<typeof savingFunds>, now: (key: string) => number = () => 0): FundBar[] {
  const fondo = (re: RegExp) => funds.filter((f) => re.test(f.name) && f.target > 0)
    .map((f) => ({ name: f.name, saved: f.saved + now(f.key), target: f.target, hint: `Para el ${date(f.due, "d 'de' MMM")}` }))
  const unif = funds.filter((f) => f.kind === 'uniformes').reduce((a, f) => a + f.saved + now(f.key), 0)
  return [...fondo(/regal/i), ...fondo(/renta/i), ...fondo(/seguro/i), { name: 'Uniformes', saved: unif, target: 0, hint: 'Lo guardado (sin meta)' }]
}

/** Fondos (regalías, renta, seguro, uniformes) en medidores tipo gasolina. */
export function FundGauges({ funds: given }: { funds?: FundBar[] }) {
  const cuts = useCashCuts()
  const expenses = useExpenses()
  const funds = useMemo(() => given ?? fundBars(savingFunds({ cutDate: today(), expenses: expenses.data ?? [], cuts: cuts.data ?? [] })), [given, cuts.data, expenses.data])
  return (
    <GaugeGrid title="¿Cuánto llevamos juntado en los fondos?" subtitle="Verde = completo · amarillo = más de la mitad · rojo = va atrás">
      {funds.map((f) => (
        <Gauge key={f.name} pct={f.target > 0 ? (f.saved / f.target) * 100 : null} label={f.name}
          sub={<>{cents(f.saved)}{f.target > 0 ? ` de ${cents(f.target)}` : ''}{f.hint ? <span className="block">{f.hint}</span> : null}</>} />
      ))}
    </GaugeGrid>
  )
}

/**
 * Sueldo de cada profe cubierto con lo que ya se cobró de la MENSUALIDAD del mes de los niños
 * de sus categorías (igual que "Pagos por categoría"). Un niño en clase extra (Porteros) reparte
 * su mensualidad entre su categoría y la clase extra; si la categoría tiene varios profes, se reparte.
 */
export function ProfeGauges({ month, picker }: { month: string; picker?: React.ReactNode }) {
  const { data } = useCategoryResults(month)
  const fees = useFees()
  const students = useStudents()
  const extras = useExtraClasses()
  const income = useMemo(() => {
    const base = new Map((students.data ?? []).map((s) => [s.id, s.category_id]))
    const ext = new Map<string, string[]>()
    for (const x of extras.data ?? []) ext.set(x.student_id, [...(ext.get(x.student_id) ?? []), x.category_id])
    const m = new Map<string, number>()
    for (const f of fees.data ?? []) {
      if (f.concept !== 'Mensualidad' || f.period !== `${month}-01`) continue
      const cats = [base.get(f.student_id), ...(ext.get(f.student_id) ?? [])].filter(Boolean) as string[]
      const paid = Math.min(Number(f.paid), Number(f.total_due))
      for (const c of cats) m.set(c, (m.get(c) ?? 0) + paid / cats.length)
    }
    return m
  }, [fees.data, students.data, extras.data, month])
  const [by, setBy] = useState<'profe' | 'categoria'>('profe')
  // Por categoría: la mensualidad cobrada de la categoría contra la parte del sueldo que le toca
  const cats = useMemo(() => (data?.list ?? []).filter((r) => r.salaries > 0).map((r) => ({
    name: r.name, saved: income.get(r.id) ?? 0, target: r.salaries, hint: r.coaches.map((c) => c.name).join(' · '),
  })), [data, income])
  const profes = useMemo(() => {
    const m = new Map<string, FundBar>()
    for (const r of data?.list ?? []) {
      for (const c of r.coaches) {
        const part = c.monthly / c.share
        const covered = r.salaries > 0 ? ((income.get(r.id) ?? 0) * part) / r.salaries : 0
        const x = m.get(c.name) ?? { name: c.name, saved: 0, target: c.monthly, hint: '' }
        x.saved += covered
        x.hint = [x.hint, r.name].filter(Boolean).join(' · ')
        m.set(c.name, x)
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [data, income])
  const list = by === 'profe' ? profes : cats
  return (
    <GaugeGrid title={`Sueldo de cada ${by === 'profe' ? 'profe' : 'categoría'} · ${mesDe(month)}`}
      actions={<div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-ink-600 p-0.5 text-sm">
          {(['profe', 'categoria'] as const).map((k) => <button key={k} type="button" onClick={() => setBy(k)} className={'rounded-lg px-3 py-1.5 font-semibold ' + (by === k ? 'bg-brand text-ink' : 'text-muted hover:text-white')}>{k === 'profe' ? 'Por profe' : 'Por categoría'}</button>)}
        </div>
        {picker}
      </div>}
      subtitle={by === 'profe' ? '¿Ya alcanza la mensualidad que pagaron sus niños para su sueldo del mes?' : '¿Ya alcanza la mensualidad cobrada de cada categoría para la parte del sueldo que le toca?'}>
      {list.length ? list.map((f) => (
        <Gauge key={f.name} pct={(f.saved / f.target) * 100} label={f.name}
          title={`Mensualidad cobrada ${cents(f.saved)} · sueldo ${cents(f.target)}`}
          sub={<>{cents(f.saved)} de {cents(f.target)}<span className="block">{f.hint}</span></>} />
      )) : <p className="col-span-full text-sm text-muted">Cargando…</p>}
    </GaugeGrid>
  )
}

/** Fondos y sueldos de profes (se usa en el corte de caja, con su propio mes). */
export default function FundProgress({ month: initial, chivasNew, before }: { month?: string; chivasNew?: React.ReactNode; before?: string }) {
  const [month, setMonth] = useState(initial ?? today().slice(0, 7))
  return (
    <div className="space-y-3">
      <ChivasDistribution before={before}>{chivasNew}</ChivasDistribution>
      <ProfeGauges month={month} picker={<Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-10 w-48" aria-label="Mes" />} />
    </div>
  )
}

/**
 * Distribución de la Caja Chivas: cuánto hay en cada mini caja (credenciales, playeras,
 * seguro y libre). El seguro además muestra qué tanto lleva de su meta.
 * `now` suma lo que se está apartando en el corte que se está haciendo.
 */
export function ChivasDistribution({ before, children }: { before?: string; children?: React.ReactNode }) {
  const expenses = useExpenses()
  const settings = useSettings()
  const payments = usePayments()
  const fees = useFees()
  const d = useMemo(() => {
    const seguroGasto = Number((expenses.data ?? []).find((e) => /seguro/i.test(e.name) && e.active)?.amount ?? 0)
    const cfg = chivasConfig(settings.data, seguroGasto)
    // Sólo las inscripciones cobradas (antes de este corte, si se está haciendo uno)
    const inscFee = new Set((fees.data ?? []).filter((f) => /^inscripci[oó]n/i.test(f.concept)).map((f) => f.id))
    const ins = (payments.data ?? []).filter((p) => inscFee.has(p.fee_id) && (!before || p.paid_at < before))
    const total = ins.reduce((a, p) => a + Number(p.amount), 0)
    const credenciales = ins.reduce((a, p) => a + (p.split ? Number(p.split.credencial) : cfg.credencial), 0)
    const playeras = ins.reduce((a, p) => a + (p.split ? Number(p.split.playera) : cfg.playera), 0)
    const seguro = Math.min(cfg.seguroAnual, ins.reduce((a, p) => a + (p.split ? Number(p.split.seguro) : cfg.seguro), 0))
    const libre = Math.max(0, total - credenciales - playeras - seguro)
    return {
      count: ins.length,
      parts: [
        { label: 'Credenciales', value: credenciales },
        { label: 'Playeras de entrenamiento', value: playeras },
        { label: 'Seguro', value: seguro },
        { label: 'Libre en Caja Chivas', value: libre },
      ],
      seguro, seguroMeta: cfg.seguroAnual, seguroDue: undefined as string | undefined,
    }
  }, [expenses.data, settings.data, payments.data, fees.data, before])
  const total = d.parts.reduce((a, p) => a + p.value, 0)
  const acumulado = (
    <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto]">
        {total > 0 ? <PieChart data={d.parts} max={4} /> : <p className="text-sm text-muted">Todavía no hay inscripciones cobradas.</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[34rem]">
          {d.parts.map((p) => (
            <div key={p.label} className="rounded-xl bg-ink-900 p-3">
              <p className="text-xs text-muted">{p.label}</p>
              <p className="font-display text-xl font-bold">{cents(p.value)}</p>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <Gauge pct={d.seguroMeta ? (d.seguro / d.seguroMeta) * 100 : null} label="Seguro: lo juntado de su meta"
              sub={`${cents(d.seguro)} de ${cents(d.seguroMeta)}${d.seguroDue ? ` · para el ${date(d.seguroDue, "d 'de' MMM yyyy")}` : ''}`} />
          </div>
        </div>
      </div>
  )
  return (
    <Card className="border-2 border-bad/70 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold uppercase tracking-wide">Distribución de Caja Chivas (inscripciones)</h3>
        <p className="text-lg">Ya acumulado <b className="font-display text-2xl text-brand">{cents(total)}</b> <span className="text-sm text-muted">· {d.count} inscripciones</span></p>
      </div>
      {children ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          <section className="rounded-2xl border border-ink-600 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Ya acumulado</p>
            {acumulado}
          </section>
          <section className="rounded-2xl border border-bad/40 bg-bad/5 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-bad">Nuevo a acumular en este corte</p>
            {children}
          </section>
        </div>
      ) : acumulado}
    </Card>
  )
}
