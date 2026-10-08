import { describe, expect, it } from 'vitest'
import { dueDateForStudent } from '../src/components/PaymentForms'

describe('nuevo ingreso: 15 días de tolerancia', () => {
  it('entra el 3 de octubre: su mensualidad vence el 18', () => {
    expect(dueDateForStudent('2026-10-01', 8, '2026-10-03')).toBe('2026-10-18')
  })
  it('entra el 20: vence 15 días después', () => {
    expect(dueDateForStudent('2026-10-01', 8, '2026-10-20')).toBe('2026-11-04')
  })
  it('los demás meses y la lista con la que arrancó la temporada: día 8', () => {
    expect(dueDateForStudent('2026-11-01', 8, '2026-10-03')).toBe('2026-11-08')
    expect(dueDateForStudent('2026-09-01', 8, '2026-09-01')).toBe('2026-09-08')
  })
})
