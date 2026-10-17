import { useMemo, useState } from 'react'
import { Card, Input, cx } from './ui'
import { useCategoryResults } from './CategoryResults'
import { useCashCuts, useExpenses } from '@/lib/api'
import { savingFunds } from '@/lib/cashcut'
import { date, money, monthName, today } from '@/lib/format'

export interface FundBar { name: string; saved: number; target: number; hint?: string }

const cents = (n: number) => money(Math.round(n)).replace('.00', '')

/** Una barra con el % juntado: verde al completar, amarilla a la mitad, roja si va muy atrás. */
function Bar({ f }: { f: FundBar }) {
  const pct = f.target > 0 ? (f.saved / f.target) * 100 : null
  const tone = pct == null ? 'bg-info' : pct >= 100 ? 'bg-ok' : pct >= 50 ? 'bg-brand' : 'bg-bad'
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{f.name}</span>
        <span className="shrink-0">
          {pct != null && <b className={cx('mr-2 font-display text-lg', pct >= 100 ? 'text-ok' : pct >= 50 ? 'text-brand' : 'text-bad')}>{Math.round(pct)}%</b>}
          <span className="text-xs text-muted">{cents(f.saved)}{f.target > 0 ? ` de ${cents(f.target)}` : ''}</span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-ink-700">
        <div className={cx('h-full rounded-full transition-all', tone)} style={{ width: `${pct == null ? (f.saved > 0 ? 100 : 0) : Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      {f.hint && <p className="text-xs text-muted">{f.hint}</p>}
    </li>
  )
}

/**
 * ¿Cuánto llevamos juntado? Fondos (regalías, renta, seguro, uniformes) y el sueldo de cada profe
 * cubierto con lo que han pagado los niños de sus categorías en el mes.
 */
export default function FundProgress({ funds: given, month: initial }: { funds?: FundBar[]; month?: string }) {
  const [month, setMonth] = useState(initial ?? today().slice(0, 7))
  const { data } = useCategoryResults(month)
  const cuts = useCashCuts()
  const expenses = useExpenses()
  // Fondos según lo juntado en los cortes hasta hoy (en el corte se pasan ya con lo de esta semana)
  const funds = useMemo(() => given ?? fundBars(savingFunds({ cutDate: today(), expenses: expenses.data ?? [], cuts: cuts.data ?? [] })), [given, cuts.data, expenses.data])
  const profes = useMemo(() => {
    const m = new Map<string, FundBar>()
    for (const r of data?.list ?? []) {
      for (const c of r.coaches) {
        const part = c.monthly / c.share
        // Si la categoría tiene varios profes, lo cobrado se reparte según su parte del sueldo
        const covered = r.salaries > 0 ? (r.income * part) / r.salaries : 0
        const x = m.get(c.name) ?? { name: c.name, saved: 0, target: c.monthly, hint: '' }
        x.saved += covered
        x.hint = [x.hint, r.name].filter(Boolean).join(' · ')
        m.set(c.name, x)
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [data])
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">¿Cuánto llevamos juntado?</h3>
          <p className="text-xs text-muted">Verde = completo · amarillo = más de la mitad · rojo = va atrás.</p>
        </div>
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-10 w-44" aria-label="Mes" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Fondos</p>
          <ul className="space-y-4">{funds.map((f) => <Bar key={f.name} f={f} />)}</ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Sueldo de cada profe · con lo que pagaron sus niños en {monthName(`${month}-01`).split(' ')[0].toLowerCase()}</p>
          {profes.length ? <ul className="space-y-4">{profes.map((f) => <Bar key={f.name} f={f} />)}</ul> : <p className="text-sm text-muted">Cargando…</p>}
        </div>
      </div>
    </Card>
  )
}

/** Barras de los fondos: regalías, renta, seguro y uniformes. */
export function fundBars(funds: ReturnType<typeof savingFunds>, now: (key: string) => number = () => 0): FundBar[] {
  const fondo = (re: RegExp) => funds.filter((f) => re.test(f.name) && f.target > 0)
    .map((f) => ({ name: `Fondo ${f.name}`, saved: f.saved + now(f.key), target: f.target, hint: `Para el ${date(f.due, "d 'de' MMM")}` }))
  const unif = funds.filter((f) => f.kind === 'uniformes').reduce((a, f) => a + f.saved + now(f.key), 0)
  return [...fondo(/regal/i), ...fondo(/renta/i), ...fondo(/seguro/i), { name: 'Fondo de uniformes', saved: unif, target: 0, hint: 'Lo que hay guardado (no tiene meta)' }]
}
