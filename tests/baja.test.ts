import { describe, expect, it } from 'vitest'
import { proportional, weeksUntil } from '../src/components/InactiveModals'

describe('baja: cobro proporcional', () => {
  it('cuenta las semanas que vino en el mes', () => {
    expect(weeksUntil('2026-10-03')).toBe(1)
    expect(weeksUntil('2026-10-12')).toBe(2)
    expect(weeksUntil('2026-10-30')).toBe(4)
  })
  it('cobra sólo esas semanas', () => {
    expect(proportional(550, 2)).toBe(275)
    expect(proportional(450, 1)).toBe(113)
  })
})

import { classCharge } from '../src/components/ClassCut'
describe('baja: cobro hasta la última clase', () => {
  it('vino a 2 de 8 clases: se cobra la cuarta parte', () => {
    expect(classCharge(550, 2, 8)).toBe(138)
  })
  it('nunca menos de lo que ya pagó', () => {
    expect(classCharge(550, 1, 8, 300)).toBe(300)
  })
})
