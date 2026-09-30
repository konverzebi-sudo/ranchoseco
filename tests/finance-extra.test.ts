import { describe, expect, it } from 'vitest'
import { skipsMonth, discountsFor, expenseEntries, expenseForMonth, insuranceSaving, isNewEnrollment, loanStatus, loansReceived, pendingInstallments } from '../src/lib/finance'
import type { Expense } from '../src/lib/types'

const exp = (p: Partial<Expense>): Expense => ({ id: p.name ?? 'x', name: 'x', amount: 0, frequency: 'mensual', paid_month: null, paid_year: null, down_payment: null, installments: null, paid_on: null, notes: null, active: true, sort_order: 0, ...p })

describe('ahorro del seguro', () => {
  const list = [exp({ name: 'Seguro', amount: 12000, frequency: 'anual', paid_month: 9 })]
  it('empieza en octubre 2026', () => {
    expect(insuranceSaving(list, '2026-09')).toMatchObject({ months: 0, saved: 0, startsIn: 'oct' })
    expect(insuranceSaving(list, '2026-10')).toMatchObject({ months: 1, saved: 1000, startsIn: null })
    expect(insuranceSaving(list, '2027-03')).toMatchObject({ months: 6, saved: 6000, dueLabel: 'sep 2027' })
    expect(insuranceSaving(list, '2027-09')).toMatchObject({ months: 12, saved: 12000 })
    expect(insuranceSaving(list, '2027-10')).toMatchObject({ months: 1, saved: 1000, dueLabel: 'sep 2028' })
  })
  it('sin seguro no muestra nada', () => expect(insuranceSaving([], '2026-10')).toBeNull())
})

describe('desglose día a día', () => {
  it('sueldos cada miércoles, fijos el día 1 y únicos en su fecha', () => {
    const e = expenseEntries({
      month: '2026-10',
      expenses: [
        exp({ name: 'Renta', amount: 5000 }),
        exp({ name: 'Cloro', amount: 500, frequency: 'unico', paid_month: 10, paid_year: 2026, paid_on: '2026-10-14' }),
        exp({ name: 'Seguro', amount: 11000, frequency: 'anual', paid_month: 9 }),
      ],
      coaches: [{ id: 'c', full_name: 'Juan', active: true }],
      coachPay: [{ coach_id: 'c', amount: 700, frequency: 'semanal' }],
    })
    expect(e.filter((x) => x.kind === 'sueldo').map((x) => x.date)).toEqual(['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'])
    expect(e.find((x) => x.name === 'Cloro')!.date).toBe('2026-10-14')
    expect(e.find((x) => x.name === 'Renta')!.date).toBe('2026-10-01')
    expect(e.some((x) => x.name === 'Seguro')).toBe(false)
    expect(e.reduce((a, x) => a + x.amount, 0)).toBe(700 * 4 + 5000 + 500)
  })
})

describe('inscripciones y descuentos', () => {
  it('no cuenta la lista inicial de la temporada', () => {
    expect(isNewEnrollment({ enrolled_at: '2026-09-01' }, '2026-09')).toBe(false)
    expect(isNewEnrollment({ enrolled_at: '2026-09-16' }, '2026-09')).toBe(true)
    expect(isNewEnrollment({ enrolled_at: '2026-10-01' }, '2026-10')).toBe(true)
  })
  it('separa becas, promo hermanos y descuentos', () => {
    const r = discountsFor([
      { student_id: 'a', discount: 100, discount_reason: 'Beca' },
      { student_id: 'b', discount: 50, discount_reason: 'Promo hermanos' },
      { student_id: 'b', discount: 200, discount_reason: 'Descuento: entró tarde' },
      { student_id: 'c', discount: 0, discount_reason: null },
    ])
    expect(r).toEqual({ total: 350, by: { beca: 100, hermanos: 50, descuento: 200 }, students: 2 })
  })
})

describe('pagos en partes y préstamos', () => {
  const inst = (n: number, due_date: string, amount: number, paid_on: string | null = null) => ({ id: `i${n}`, expense_id: 'x', n, due_date, amount, paid_on, notes: null })
  const playeras = exp({ name: 'Playeras', amount: 7500, frequency: 'partes', expense_installments: [inst(0, '2026-09-01', 3000, '2026-09-01'), inst(1, '2026-10-01', 2250), inst(2, '2026-11-01', 2250)] })
  const prestamo = exp({ name: 'Préstamo', amount: 10000, frequency: 'partes', kind: 'prestamo', lender: 'Don Pepe', received_on: '2026-09-20', expense_installments: [inst(1, '2026-10-15', 5000), inst(2, '2026-11-15', 5000)] })
  it('cada pago cuenta en su mes; los pendientes también', () => {
    expect(expenseForMonth(playeras, '2026-09')).toBe(3000)
    expect(expenseForMonth(playeras, '2026-10')).toBe(2250)
  })
  it('un pago hecho antes cuenta el día que se pagó', () => {
    const p = { ...playeras, expense_installments: [inst(0, '2026-09-01', 3000, '2026-09-01'), inst(1, '2026-10-01', 2250, '2026-09-25'), inst(2, '2026-11-01', 2250)] }
    expect(expenseForMonth(p, '2026-09')).toBe(5250)
    expect(expenseForMonth(p, '2026-10')).toBe(0)
  })
  it('los pendientes de la semana y los atrasados salen como tarea', () => {
    expect(pendingInstallments([playeras, prestamo], '2026-10-04').map((x) => x.label)).toEqual(['Pago 2 de 3'])
    expect(pendingInstallments([playeras, prestamo], '2026-10-18').map((x) => x.expense.name)).toEqual(['Playeras', 'Préstamo'])
  })
  it('los préstamos no son gasto de operación pero sí salida en el desglose', () => {
    expect(expenseForMonth(prestamo, '2026-10')).toBe(0)
    const e = expenseEntries({ month: '2026-10', expenses: [prestamo], coaches: [], coachPay: [] })
    expect(e).toMatchObject([{ date: '2026-10-15', kind: 'prestamo', amount: 5000, name: 'Préstamo · Don Pepe', pending: true }])
    expect(loanStatus(prestamo)).toMatchObject({ total: 10000, paid: 0, remaining: 10000, done: false })
    expect(loansReceived([prestamo], '2026-09-14', '2026-09-20').length).toBe(1)
  })
})

describe('meses sin pago', () => {
  const regalias = exp({ name: 'Regalías Chivas', amount: 7500, frequency: 'mensual', skip_months: [7, 8] })
  it('julio y agosto no se pagan', () => {
    expect(expenseForMonth(regalias, '2027-06')).toBe(7500)
    expect(expenseForMonth(regalias, '2027-07')).toBe(0)
    expect(expenseForMonth(regalias, '2027-08')).toBe(0)
    expect(expenseEntries({ month: '2027-07', expenses: [regalias], coaches: [], coachPay: [] })).toEqual([])
    expect(skipsMonth(regalias, 9)).toBe(false)
  })
})
