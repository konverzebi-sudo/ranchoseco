import { describe, it, expect } from 'vitest'
import { memberPrice, promoBreakers, promoStatus, siblingPrice, suggestSiblings, surnameKey } from '../src/lib/siblings'

describe('promo de hermanos', () => {
  it('1° $500, 2° $450, 3° y siguientes $400', () => {
    expect(siblingPrice(1)).toBe(500)
    expect(siblingPrice(2)).toBe(450)
    expect(siblingPrice(3)).toBe(400)
    expect(siblingPrice(4)).toBe(400)
  })
  it('detecta apellidos aunque tengan "de la" o "de los"', () => {
    expect(surnameKey('Sebastian Peralta de Santiago')).toBe('peralta santiago')
    expect(surnameKey('VALENTINA PERALTA DE SANTIAGO')).toBe('peralta santiago')
    expect(surnameKey('Dylan Usvaldo de los Santos Lozada')).toBe('santos lozada')
    expect(surnameKey('Muñiz')).toBeNull()
  })
  const st = (id: string, full_name: string, sibling_group_id: string | null = null, status = 'activo') => ({ id, full_name, sibling_group_id, status })
  it('sugiere hermanos y omite los que ya están agrupados o dados de baja', () => {
    const s = suggestSiblings([
      st('1', 'Angel Alejandro Rico Silva'), st('2', 'Miranda Estefania Rico Silva'),
      st('3', 'Luca Nicolas Escalera Davila', 'g1'), st('4', 'Nilmar Osvaldo Escalera Davila', 'g1'),
      st('5', 'Gabriel Reyna Marines', null, 'baja'), st('6', 'Mateo Reyna Marines', null, 'baja'),
      st('7', 'Otro Alumno Distinto'),
    ])
    expect(s.map((x) => x.key)).toEqual(['rico silva'])
  })
  it('la promo deja de ser válida si un hermano tiene pagos vencidos', () => {
    const members = [{ id: 'a' }, { id: 'b' }]
    expect(promoBreakers(members, new Set())).toEqual([])
    expect(promoBreakers(members, new Set(['b']))).toEqual([{ id: 'b' }])
  })
})

describe('casos especiales y candado de inscripción', () => {
  it('el precio manual tiene prioridad sobre el del orden', () => {
    expect(memberPrice({ sibling_price: 350, sibling_order: 1 }, 1)).toBe(350)
    expect(memberPrice({ sibling_price: null, sibling_order: 2 }, 2)).toBe(450)
  })
  it('si un hermano se da de baja la promo deja de ser válida', () => {
    const ok = promoStatus([{ id: 'a', status: 'activo' }, { id: 'b', status: 'activo' }], new Set())
    expect(ok.valid).toBe(true)
    expect(promoStatus([{ id: 'a', status: 'activo' }, { id: 'b', status: 'suspendido' }], new Set()).valid).toBe(true) // inactivo temporal no rompe
    const baja = promoStatus([{ id: 'a', status: 'activo' }, { id: 'b', status: 'baja' }], new Set())
    expect(baja.valid).toBe(false)
    expect(baja.notEnrolled.map((m) => m.id)).toEqual(['b'])
  })
  it('los pagos vencidos generan alerta', () => {
    const r = promoStatus([{ id: 'a', status: 'activo' }, { id: 'b', status: 'activo' }], new Set(['a']))
    expect(r.overdue.map((m) => m.id)).toEqual(['a'])
  })
})
