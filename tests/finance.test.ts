import { describe, it, expect } from 'vitest'
import { categoryResults, expenseForMonth, installmentPlan, monthlyCost } from '../src/lib/finance'

const cat = (id: string, name: string) => ({ id, name, description: null, schedule: null, monthly_fee: null, sort_order: 0, active: true })
const fee = (student_id: string, period: string, discount: number) => ({
  id: student_id + period, student_id, concept: 'Mensualidad', period, amount: 550, due_date: period, notes: null,
  discount, discount_reason: discount ? 'Beca' : null, review: null, late_fee_per_day: 0, late_fee_waived: 0,
  late_days: 0, late_fee: 0, total_due: 550 - discount, paid: 0, balance: 0, last_paid_at: null, status: 'pagado' as const,
})
const pay = (student_id: string, paid_at: string, amount: number) => ({
  id: student_id + paid_at + amount, fee_id: 'x', student_id, amount, paid_at, method: 'efectivo' as const, receipt_path: null, notes: null, created_at: paid_at,
})

describe('costo mensual de sueldos', () => {
  it('semanal × 52/12, quincenal × 2, mensual × 1', () => {
    expect(monthlyCost({ amount: 750, frequency: 'semanal' })).toBeCloseTo(3250)
    expect(monthlyCost({ amount: 1000, frequency: 'quincenal' })).toBe(2000)
    expect(monthlyCost({ amount: 5000, frequency: 'mensual' })).toBe(5000)
  })
})

describe('resultados por categoría', () => {
  const r = categoryResults({
    month: '2026-09',
    categories: [cat('A', '2014'), cat('B', '2012')],
    students: [
      { id: 's1', category_id: 'A', status: 'activo' },
      { id: 's2', category_id: 'A', status: 'activo' },
      { id: 's3', category_id: 'B', status: 'activo' },
    ],
    payments: [pay('s1', '2026-09-05', 550), pay('s2', '2026-09-05', 300), pay('s3', '2026-09-03', 550), pay('s3', '2026-08-05', 500)],
    fees: [fee('s2', '2026-09-01', 250)],
    coaches: [{ id: 'c1', full_name: 'Bernardo', active: true }, { id: 'c2', full_name: 'Mili', active: true }],
    coachCategories: [{ coach_id: 'c1', category_id: 'A' }, { coach_id: 'c1', category_id: 'B' }],
    coachPay: [{ coach_id: 'c1', amount: 1200, frequency: 'mensual' }, { coach_id: 'c2', amount: 1700, frequency: 'mensual' }],
  })
  const A = r.list.find((x) => x.id === 'A')!
  const B = r.list.find((x) => x.id === 'B')!
  it('suma sólo los pagos del mes elegido', () => {
    expect(A.income).toBe(850)
    expect(B.income).toBe(550)
  })
  it('muestra las becas de la categoría', () => {
    expect(A.scholarships).toBe(250)
  })
  it('reparte el sueldo del profesor entre sus categorías', () => {
    expect(A.salaries).toBe(600)
    expect(B.salaries).toBe(600)
    // Mili (sin categoría, $1,700) se reparte por alumnos: 2/3 a A y 1/3 a B
    expect(A.result).toBeCloseTo(850 - 600 - (1700 * 2) / 3)
    expect(B.result).toBeCloseTo(550 - 600 - 1700 / 3)
  })
  it('los sueldos sin categoría se reparten como gasto general', () => {
    expect(r.unassignedSalaries).toBe(1700)
    expect(r.totals.result).toBe(1400 - 1200 - 1700)
  })
})

describe('gastos generales repartidos por alumno', () => {
  const base = {
    categories: [cat('A', '2014'), cat('B', '2012')],
    students: [
      { id: 's1', category_id: 'A', status: 'activo' }, { id: 's2', category_id: 'A', status: 'activo' },
      { id: 's3', category_id: 'A', status: 'activo' }, { id: 's4', category_id: 'B', status: 'activo' },
      { id: 's5', category_id: 'B', status: 'baja' },
    ],
    payments: [pay('s1', '2026-09-05', 550), pay('s4', '2026-09-05', 550)],
    fees: [], coaches: [], coachCategories: [], coachPay: [],
  }
  const exp = (name: string, amount: number, frequency: any, paid_month: number | null = null) =>
    ({ id: name, name, amount, frequency, paid_month, paid_year: null, notes: null, active: true, sort_order: 0 })
  const r = categoryResults({
    ...base, month: '2026-09',
    expenses: [exp('Regalías', 7500, 'mensual'), exp('Seguro', 12000, 'anual', 9), exp('Única', 400, 'unico', 10)],
  })
  it('suma el equivalente mensual (anual ÷ 12, único sólo en su mes)', () => {
    expect(r.generalTotal).toBe(7500 + 1000)
  })
  it('reparte según alumnos activos de cada categoría (bajas no cuentan)', () => {
    expect(r.activeTotal).toBe(4)
    expect(r.perStudent).toBe(8500 / 4)
    expect(r.list.find((x) => x.id === 'A')!.generalExpenses).toBe((8500 / 4) * 3)
    expect(r.list.find((x) => x.id === 'B')!.result).toBe(550 - 8500 / 4)
  })
  it('un gasto único cuenta completo en su mes', () => {
    const oct = categoryResults({ ...base, month: '2026-10', expenses: [exp('Única', 400, 'unico', 10)] })
    expect(oct.generalTotal).toBe(400)
  })
})

describe('gastos en partes', () => {
  const base = { amount: 3000, frequency: 'partes' as const, paid_month: 11, paid_year: 2026, active: true }
  it('anticipo en el mes de inicio y el resto en pagos mensuales iguales', () => {
    const plan = installmentPlan({ ...base, down_payment: 1000, installments: 4 })
    expect(plan.remaining).toBe(2000)
    expect(plan.each).toBe(500)
    expect(plan.schedule.map((p) => [p.key, p.amount])).toEqual([['2026-11', 1000], ['2026-12', 500], ['2027-01', 500], ['2027-02', 500], ['2027-03', 500]])
  })
  it('cuenta en cada mes sólo lo que cae ese mes', () => {
    const e = { ...base, down_payment: 1000, installments: 4 }
    expect(expenseForMonth(e, '2026-10')).toBe(0)
    expect(expenseForMonth(e, '2026-11')).toBe(1000)
    expect(expenseForMonth(e, '2027-01')).toBe(500)
    expect(expenseForMonth(e, '2027-04')).toBe(0)
  })
  it('sin anticipo el primer pago cae en el mes de inicio', () => {
    const e = { ...base, down_payment: 0, installments: 3 }
    expect(expenseForMonth(e, '2026-11')).toBe(1000)
    expect(expenseForMonth(e, '2027-01')).toBe(1000)
    expect(expenseForMonth(e, '2027-02')).toBe(0)
  })
})

describe('clase extra (porteros) en el reporte', () => {
  const r = categoryResults({
    month: '2026-09',
    categories: [cat('A', '2014'), { ...cat('P', 'Porteros'), is_extra: true }],
    students: [{ id: 's1', category_id: 'A', status: 'activo' }, { id: 's2', category_id: 'A', status: 'activo' }],
    payments: [pay('s1', '2026-09-05', 550), pay('s2', '2026-09-05', 550)],
    fees: [], coaches: [{ id: 'jd', full_name: 'Juan de Dios', active: true }],
    coachCategories: [{ coach_id: 'jd', category_id: 'P' }],
    coachPay: [{ coach_id: 'jd', amount: 1200, frequency: 'mensual' }],
    expenses: [{ id: 'r', name: 'Renta', amount: 1000, frequency: 'mensual', paid_month: null, paid_year: null, notes: null, active: true, sort_order: 0, down_payment: null, installments: null }],
    extraClasses: [{ student_id: 's1', category_id: 'P' }],
  })
  const A = r.list.find((x) => x.id === 'A')!
  const P = r.list.find((x) => x.id === 'P')!
  it('el portero sigue contando en su categoría; los gastos generales no se duplican', () => {
    expect(A.students).toBe(2)
    expect(A.generalExpenses).toBe(1000)
    expect(P.students).toBe(1)
    expect(P.generalExpenses).toBe(0)
  })
  it('a porteros sólo se le resta el sueldo de su profe', () => {
    expect(P.income).toBe(0)
    expect(P.salaries).toBe(1200)
    expect(P.result).toBe(-1200)
  })
})
