import { describe, expect, it } from 'vitest'
import { allocatePayment } from '../src/lib/allocate'

const fee = (id: string, concept: string, period: string, balance: number) => ({ id, concept, period, due_date: period.slice(0, 8) + '08', balance })

describe('repartir un pago', () => {
  const open = [fee('oct', 'Mensualidad', '2026-10-01', 550), fee('sep', 'Mensualidad', '2026-09-01', 50), fee('ins', 'Inscripción', '2026-10-01', 600)]
  it('primero lo más antiguo, y en el mismo mes la inscripción antes que la mensualidad', () => {
    const r = allocatePayment(open, 700)
    expect(r.parts.map((p) => [p.fee.id, p.amount, p.settles])).toEqual([['sep', 50, true], ['ins', 600, true], ['oct', 50, false]])
    expect(r.rest).toBe(0)
  })
  it('lo que sobra queda aparte (por adelantado)', () => {
    const r = allocatePayment([fee('sep', 'Mensualidad', '2026-09-01', 50)], 500)
    expect(r.parts.map((p) => p.amount)).toEqual([50])
    expect(r.rest).toBe(450)
  })
  it('sin deudas, todo queda aparte', () => {
    expect(allocatePayment([], 50)).toEqual({ parts: [], rest: 50 })
  })
})
