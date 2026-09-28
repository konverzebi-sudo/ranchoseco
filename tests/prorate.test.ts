import { describe, it, expect } from 'vitest'
import { joinTier, tierAmount } from '../src/lib/prorate'

describe('primera mensualidad si entra a medio mes', () => {
  const sep = '2026-09-01'
  it('del 1 al 15: mes completo', () => {
    expect(joinTier('2026-09-01', sep)).toBe('completo')
    expect(joinTier('2026-09-15', sep)).toBe('completo')
  })
  it('del 16 al 22: mitad ($275)', () => {
    expect(joinTier('2026-09-16', sep)).toBe('mitad')
    expect(joinTier('2026-09-22', sep)).toBe('mitad')
    expect(tierAmount(550, 'mitad')).toBe(275)
  })
  it('del 23 en adelante: $100', () => {
    expect(joinTier('2026-09-23', sep)).toBe('minimo')
    expect(joinTier('2026-09-30', sep)).toBe('minimo')
    expect(tierAmount(550, 'minimo')).toBe(100)
  })
  it('inscrito antes paga completo; inscrito después no paga ese mes', () => {
    expect(joinTier('2026-08-25', sep)).toBe('completo')
    expect(joinTier('2026-10-02', sep)).toBeNull()
    expect(tierAmount(550, 'completo')).toBe(550)
  })
})
