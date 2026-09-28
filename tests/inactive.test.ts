import { describe, it, expect } from 'vitest'
import { cycleEnd, needsReinscription } from '../src/lib/inactive'

describe('inactivo temporal', () => {
  it('el ciclo va de agosto a julio', () => {
    expect(cycleEnd('2026-09-28')).toBe('2027-07-31')
    expect(cycleEnd('2027-03-10')).toBe('2027-07-31')
    expect(cycleEnd('2027-08-02')).toBe('2028-07-31')
  })
  it('menos de un año inactivo: no paga reinscripción', () => {
    expect(needsReinscription('2026-09-28', '2027-06-01')).toBe(false)
    expect(needsReinscription('2026-09-28', '2027-09-27')).toBe(false)
  })
  it('un año o más: paga reinscripción', () => {
    expect(needsReinscription('2026-09-28', '2027-09-28')).toBe(true)
    expect(needsReinscription('2026-09-28', '2028-01-10')).toBe(true)
  })
  it('sin fecha de inicio no se cobra', () => {
    expect(needsReinscription(null, '2030-01-01')).toBe(false)
  })
})
