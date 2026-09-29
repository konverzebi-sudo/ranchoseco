import { describe, expect, it } from 'vitest'
import { discountsFor, expenseEntries, insuranceSaving, isNewEnrollment } from '../src/lib/finance'
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
  it('sueldos cada sábado, fijos el día 1 y únicos en su fecha', () => {
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
    expect(e.filter((x) => x.kind === 'sueldo').map((x) => x.date)).toEqual(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'])
    expect(e.find((x) => x.name === 'Cloro')!.date).toBe('2026-10-14')
    expect(e.find((x) => x.name === 'Renta')!.date).toBe('2026-10-01')
    expect(e.some((x) => x.name === 'Seguro')).toBe(false)
    expect(e.reduce((a, x) => a + x.amount, 0)).toBe(700 * 5 + 5000 + 500)
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
