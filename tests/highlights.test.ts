import { describe, expect, it } from 'vitest'
import { monthHighlights } from '../src/lib/highlights'
import type { AttendanceDetail, FeeBalance, MatchPlayer, Payment } from '../src/lib/types'

const students = ['a', 'b', 'c', 'd'].map((id) => ({ id, category_id: 'k', status: 'activo' }))
const att = (student_id: string, training_id: string, status: AttendanceDetail['status']) =>
  ({ id: student_id + training_id, student_id, training_id, status, notes: null, date: '2026-10-0' + training_id, category_id: 'k', start_time: null }) as AttendanceDetail
const fee = (student_id: string, p: Partial<FeeBalance> = {}) =>
  ({ id: 'f' + student_id, student_id, concept: 'Mensualidad', period: '2026-10-01', amount: 550, discount: 0, discount_reason: null, balance: 0, ...p }) as FeeBalance
const pay = (student_id: string, paid_at: string) => ({ id: 'p' + student_id, fee_id: 'f' + student_id, student_id, amount: 550, paid_at }) as Payment
const mp = (student_id: string, match_id: string, attended: boolean) => ({ student_id, match_id, attended }) as MatchPlayer

describe('listas del mes en reportes', () => {
  const h = monthHighlights({
    month: '2026-10', today: '2026-10-29', students,
    attendance: [att('a', '1', 'presente'), att('a', '2', 'retardo'), att('b', '1', 'presente'), att('b', '2', 'falta'), att('c', '1', 'presente')],
    matchPlayers: [mp('a', 'm1', true), mp('a', 'm2', true), mp('b', 'm1', false)],
    fees: [fee('a'), fee('b', { discount: 50, discount_reason: 'Beca' }), fee('c', { balance: 550 }), fee('d')],
    payments: [pay('a', '2026-10-08'), pay('b', '2026-10-12'), pay('d', '2026-10-27')],
    evaluations: [],
  })
  const ids = (l: { student_id: string }[]) => l.map((x) => x.student_id).sort()
  it('asistencias', () => {
    expect(ids(h.allClasses)).toEqual(['a']) // c no fue a la clase 2
    expect(ids(h.allMatches)).toEqual(['a']) // b faltó; c y d no convocados
  })
  it('pagos', () => {
    expect(ids(h.onTime)).toEqual(['a'])
    expect(ids(h.scholarshipLate)).toEqual(['b'])
    expect(ids(h.latePayment)).toEqual(['c', 'd']) // última semana desde el 25
  })
})
