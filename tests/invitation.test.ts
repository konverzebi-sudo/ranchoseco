import { describe, expect, it } from 'vitest'
import { invitationMessage } from '../src/pages/Matches'

describe('mensaje de convocatoria', () => {
  it('trae la info del partido, la cita 30 min antes y las instrucciones', () => {
    const t = invitationMessage({ category: '2015 Roja', opponent: 'Tigres', date: '2026-10-11', time: '10:00', venue: 'Cancha Sur, Av. Juárez 100', is_home: false, notes: 'Short negro' }, ['Ana', 'Luis'])
    expect(t).toContain('Categoría 2015 Roja')
    expect(t).toContain('Rival: Tigres (visitante)')
    expect(t).toContain('Cancha Sur, Av. Juárez 100')
    expect(t).toMatch(/Cita: 09:30/)
    expect(t).toContain('Short negro')
    expect(t).toContain('1. Ana')
    expect(t).toContain('Uniforme completo')
    expect(t).toContain('Termo de hidratación')
    expect(t).toContain('divertirnos y crecer en la cancha')
  })
})
