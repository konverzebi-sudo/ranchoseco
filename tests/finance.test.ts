import { describe, it, expect } from 'vitest'
import { categoryResults, monthlyCost } from '../src/lib/finance'

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
    expect(A.result).toBe(250)
    expect(B.result).toBe(-50)
  })
  it('los sueldos sin categoría también se restan del total', () => {
    expect(r.unassignedSalaries).toBe(1700)
    expect(r.totals.result).toBe(1400 - 1200 - 1700)
  })
})
