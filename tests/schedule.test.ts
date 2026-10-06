import { describe, expect, it } from 'vitest'
import { datesFor, scheduleText } from '../src/lib/schedule'

describe('horario semanal', () => {
  const slots = [{ dow: 3, start: '17:00', end: '18:30' }, { dow: 1, start: '17:00', end: '18:30' }, { dow: 5, start: '16:00', end: '' }]
  it('arma el texto agrupando días con el mismo horario', () => {
    expect(scheduleText(slots)).toBe('Lun y Mié 5 pm–6:30 pm · Vie 4 pm')
  })
  it('da las fechas de cada semana', () => {
    // 5-oct-2026 es lunes
    expect(datesFor(slots, '2026-10-05', '2026-10-11').map((x) => x.date)).toEqual(['2026-10-05', '2026-10-07', '2026-10-09'])
    expect(datesFor(slots, '2026-10-06', '2026-10-06')).toEqual([])
  })
})
