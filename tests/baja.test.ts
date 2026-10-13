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
