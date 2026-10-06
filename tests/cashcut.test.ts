import { describe, expect, it } from 'vitest'
import { buildItems, carryOver, cutGaps, pendingSalaries, prepaidUntil, vacationItems, itemTotals, nextPeriodStart, periodSummary, savingFunds } from '../src/lib/cashcut'
import type { Expense, FeeBalance, Payment } from '../src/lib/types'

const exp = (p: Partial<Expense>): Expense => ({ id: p.name ?? 'x', name: 'x', amount: 0, frequency: 'mensual', paid_month: null, paid_year: null, down_payment: null, installments: null, paid_on: null, notes: null, active: true, sort_order: 0, ...p })
const pay = (id: string, paid_at: string, amount: number, method: Payment['method'] = 'efectivo') => ({ id, fee_id: 'f', student_id: 's', amount, paid_at, method }) as Payment

describe('corte de caja', () => {
  it('el siguiente corte empieza el día después del último', () => {
    expect(nextPeriodStart([], '2026-09-28')).toBe('2026-09-28')
    expect(nextPeriodStart([{ period_to: '2026-09-30' }, { period_to: '2026-09-23' }], 'x')).toBe('2026-10-01')
  })
  it('lo que se dejó en caja chica pasa al siguiente corte', () => {
    expect(carryOver({ distribution: [{ to: 'Caja chica', amount: 1500 }, { to: 'Ahorro Chivas', amount: 7500 }] })).toBe(1500)
    expect(carryOver(undefined)).toBe(0)
  })
  it('suma cobros y préstamos; resta sueldos del miércoles y pagos hechos, no los pendientes', () => {
    const inst = (n: number, due_date: string, amount: number, paid_on: string | null) => ({ id: `i${n}`, expense_id: 'x', n, due_date, amount, paid_on, notes: null })
    const d = periodSummary({
      from: '2026-10-01', to: '2026-10-07',
      payments: [pay('a', '2026-10-02', 550), pay('b', '2026-10-05', 600, 'transferencia'), pay('c', '2026-10-09', 550)],
      fees: [{ id: 'f', concept: 'Mensualidad' } as FeeBalance], names: new Map([['s', 'Juan']]),
      expenses: [
        exp({ name: 'Préstamo', kind: 'prestamo', lender: 'Pepe', amount: 5000, frequency: 'partes', received_on: '2026-10-03', expense_installments: [inst(1, '2026-11-03', 5000, null)] }),
        exp({ name: 'Playeras', amount: 4500, frequency: 'partes', expense_installments: [inst(1, '2026-10-02', 2250, '2026-10-02'), inst(2, '2026-10-06', 2250, null)] }),
      ],
      coaches: [{ id: 'c', full_name: 'Juan de Dios', active: true }], coachPay: [{ coach_id: 'c', amount: 700, frequency: 'semanal' }],
    })
    expect(d.inTotal).toBe(550 + 600 + 5000)
    expect(d.cashIn).toBe(550)
    expect(d.outs.map((o) => [o.date, o.amount])).toEqual([['2026-10-02', 2250], ['2026-10-07', 700]])
    expect(d.net).toBe(6150 - 2950)
  })
})

describe('sugerencia de ahorro', () => {
  const regalias = exp({ id: 'r', name: 'Regalías Chivas', amount: 7500, frequency: 'mensual' })
  const seguro = exp({ id: 's', name: 'Seguro', amount: 11000, frequency: 'anual', paid_month: 9 })
  it('reparte lo que falta entre las semanas que quedan', () => {
    const [f] = savingFunds({ cutDate: '2026-10-07', expenses: [regalias], cuts: [] })
    expect(f).toMatchObject({ key: 'f:r:2026-11-01', due: '2026-11-01', weeksLeft: 4, suggested: 1875, saved: 0 })
  })
  it('la parte semanal es fija y nunca más de lo que falta', () => {
    const cuts = [{ id: 'c1', savings: [{ key: 'f:r:2026-11-01', name: 'x', target: 7500, due: '2026-11-01', suggested: 1875, saved: 6500 }] }]
    const [f] = savingFunds({ cutDate: '2026-10-14', expenses: [regalias], cuts })
    expect(f).toMatchObject({ saved: 6500, weeksLeft: 3, suggested: 1000 })
    expect(savingFunds({ cutDate: '2026-09-30', expenses: [regalias], cuts: [] })[0]).toMatchObject({ due: '2026-10-01', suggested: 1875 })
    expect(savingFunds({ cutDate: '2026-10-14', expenses: [regalias], cuts, excludeCut: 'c1' })[0].saved).toBe(0)
  })
  it('el seguro anual se junta hasta septiembre', () => {
    const [f] = savingFunds({ cutDate: '2026-10-07', expenses: [seguro], cuts: [] })
    expect(f).toMatchObject({ kind: 'seguro', due: '2027-09-01', weeksLeft: 47 })
    expect(f.suggested).toBeCloseTo(11000 / 52, 2)
  })
  it('las partes pendientes y los préstamos piden guardar su siguiente pago', () => {
    const inst = (id: string, n: number, due_date: string, amount: number, paid_on: string | null) => ({ id, expense_id: 'x', n, due_date, amount, paid_on, notes: null })
    const f = savingFunds({ cutDate: '2026-10-07', cuts: [], expenses: [
      exp({ name: 'Playeras', frequency: 'partes', amount: 7500, expense_installments: [inst('a', 0, '2026-09-01', 3000, '2026-09-01'), inst('b', 1, '2026-10-21', 2250, null), inst('c', 2, '2026-11-21', 2250, null)] }),
      exp({ name: 'P', kind: 'prestamo', lender: 'Pepe', frequency: 'partes', amount: 10000, expense_installments: [inst('d', 1, '2026-10-01', 5000, '2026-10-01'), inst('e', 2, '2026-11-01', 5000, null)] }),
    ] })
    expect(f.filter((x) => x.kind !== 'ahorro' && x.kind !== 'uniformes').map((x) => [x.kind, x.name, x.suggested])).toEqual([['parte', 'Playeras · Pago 2 de 3', 1125], ['prestamo', 'Préstamo de Pepe · Pago 2 de 2', 1250]])
    expect(f[1].debt).toEqual({ total: 10000, paid: 5000 })
  })
})

describe('revisión de líneas', () => {
  it('conserva lo aprobado y corregido; los totales usan el monto corregido', () => {
    const d = periodSummary({ from: '2026-10-01', to: '2026-10-07', payments: [pay('a', '2026-10-02', 550)], fees: [], names: new Map(), expenses: [], coaches: [{ id: 'c', full_name: 'Juan', active: true }], coachPay: [{ coach_id: 'c', amount: 700, frequency: 'semanal' }] })
    const first = buildItems(d)
    const edited = first.map((i) => i.type === 'salida' ? { ...i, approved: true, adjusted: 600, note: 'Se le pagó menos' } : i)
    const again = buildItems(d, edited)
    expect(again.find((i) => i.type === 'salida')).toMatchObject({ approved: true, adjusted: 600, note: 'Se le pagó menos' })
    expect(itemTotals(again)).toEqual({ income: 0, outflow: 600, pending: 1, adjusted: 1 })
    expect(itemTotals(again.map((i) => ({ ...i, approved: true }))).income).toBe(550)
  })
})

describe('caja de ahorro', () => {
  it('se acumula con lo que se manda en cada corte y nunca se reinicia', () => {
    const cuts = [
      { id: 'a', savings: [{ key: 'x:caja-ahorro', name: 'Caja de ahorro', target: 0, due: '', suggested: 0, saved: 1200 }] },
      { id: 'b', savings: [{ key: 'x:caja-ahorro', name: 'Caja de ahorro', target: 0, due: '', suggested: 0, saved: 600 }] },
    ]
    const box = savingFunds({ cutDate: '2026-11-04', expenses: [], cuts }).find((f) => f.kind === 'ahorro')!
    expect(box.saved).toBe(1800)
  })
})

describe('ahorro con meses sin pago', () => {
  it('en junio el siguiente pago de Regalías es septiembre', () => {
    const regalias = exp({ id: 'r', name: 'Regalías Chivas', amount: 7500, frequency: 'mensual', skip_months: [7, 8] })
    const [f] = savingFunds({ cutDate: '2027-06-09', expenses: [regalias], cuts: [] })
    expect(f.due).toBe('2027-09-01')
  })
})

describe('días sin corte', () => {
  it('avisa los huecos entre cortes y cuánto se cobró en ellos', () => {
    const cuts = [
      { id: 'a', cut_date: '2026-09-02', period_from: '2026-08-31', period_to: '2026-09-02' },
      { id: 'b', cut_date: '2026-09-09', period_from: '2026-09-07', period_to: '2026-09-09' },
      { id: 'c', cut_date: '2026-09-16', period_from: '2026-09-10', period_to: '2026-09-16' },
    ]
    const g = cutGaps(cuts, [pay('x', '2026-09-05', 39750), pay('y', '2026-09-10', 600)])
    expect(g.map((x) => [x.from, x.to, x.income, x.after.id])).toEqual([['2026-09-03', '2026-09-06', 39750, 'b']])
  })
})

describe('sueldos pendientes y vacaciones', () => {
  const sal = (concept: string, amount: number, extra = {}) => ({ key: `o:2026-09-16:${concept}:Sueldo profesor · semanal`, type: 'salida' as const, date: '2026-09-16', concept, detail: 'Sueldo profesor · semanal', amount, approved: false, adjusted: null, note: '', excluded: true, ...extra })
  it('un sueldo que no se pagó aparece en el siguiente corte hasta pagarse', () => {
    const c1 = { id: 'c1', cut_date: '2026-09-16', items: [sal('Juan de Dios', 700, { pending: true })] }
    const p = pendingSalaries([c1])
    expect(p).toMatchObject([{ key: 'pend:o:2026-09-16:Juan de Dios:Sueldo profesor · semanal', concept: 'Juan de Dios (pendiente del 16/9)', amount: 700 }])
    const c2 = { id: 'c2', cut_date: '2026-09-23', items: [{ ...p[0], approved: true }] }
    expect(pendingSalaries([c1, c2])).toEqual([])
  })
  it('vacaciones: paga N semanas por adelantado y recuerda hasta cuándo', () => {
    const items = [sal('Tonny', 1400, { approved: true, excluded: false }), sal('Javier', 900, { approved: true, excluded: false })]
    const v = vacationItems(items, 2, '2026-12-30')
    expect(v.map((i) => [i.concept, i.amount, i.prepaidUntil])).toEqual([['Tonny', 2800, '2026-12-30'], ['Javier', 1800, '2026-12-30']])
    expect(prepaidUntil([{ id: 'x', items: v }]).get('Tonny')).toBe('2026-12-30')
  })
})

describe('sueldos semanales en cada corte', () => {
  const base = { payments: [], fees: [], names: new Map<string, string>(), expenses: [], coaches: [{ id: 'c', full_name: 'Juan', active: true }], coachPay: [{ coach_id: 'c', amount: 700, frequency: 'semanal' as const }] }
  const sal = (from: string, to: string) => periodSummary({ ...base, from, to } as never).outs.map((o) => o.date)
  it('un corte que termina en lunes trae los sueldos del miércoles de esa semana', () => {
    expect(sal('2026-10-01', '2026-10-05')).toEqual(['2026-10-07'])
  })
  it('el siguiente corte no los repite', () => {
    expect(sal('2026-10-06', '2026-10-12')).toEqual(['2026-10-14'])
  })
  it('cortes de jueves a miércoles quedan igual que antes', () => {
    expect(sal('2026-09-24', '2026-09-30')).toEqual(['2026-09-30'])
  })
})
