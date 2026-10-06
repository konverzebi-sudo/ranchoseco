import { describe, expect, it } from 'vitest'
import { deltaVs, evolution, friendlyLevel, highlights, levelChangeCandidate, scoresOf, templatesFor, type EvalTemplate } from '../src/lib/evaluation'

const tpl = (id: string, category_id: string, level = 'general'): EvalTemplate => ({ id, name: id, generation: null, level, level_label: level, stage: null, is_goalkeeper: false, category_id, match_name: null, sort_order: 0, active: true })

describe('evaluación de jugadores', () => {
  it('elige la plantilla por la categoría del niño (2015 Roja ≠ 2015 Blanca) y agrega Porteros si toma la clase', () => {
    const ts = [tpl('2015-desarrollo', 'roja', 'desarrollo'), tpl('2015-avanzado', 'blanca', 'avanzado'), tpl('porteros', 'gk')]
    expect(templatesFor({ id: 'a', category_id: 'roja' }, ts).map((t) => t.id)).toEqual(['2015-desarrollo'])
    expect(templatesFor({ id: 'b', category_id: 'blanca' }, ts).map((t) => t.id)).toEqual(['2015-avanzado'])
    expect(templatesFor({ id: 'c', category_id: 'roja' }, ts, ['gk']).map((t) => t.id)).toEqual(['2015-desarrollo', 'porteros'])
  })
  it('promedia por área y en general', () => {
    const r = scoresOf([{ area: 'tecnica', score: 4 }, { area: 'tecnica', score: 5 }, { area: 'partido', score: 3 }, { area: 'fisico', score: 4 }])
    expect(r.area).toEqual({ tecnica: 4.5, partido: 3, fisico: 4 })
    expect(r.overall).toBe(3.8)
  })
  it('detecta área fuerte, de oportunidad y los indicadores', () => {
    const items = [{ area: 'tecnica' as const, element_name: 'Conducción', score: 5 }, { area: 'partido' as const, element_name: 'Toma de decisiones', score: 2 }]
    const h = highlights({ tecnica: 5, partido: 2 }, items)
    expect(h.bestArea).toBe('tecnica')
    expect(h.weakArea).toBe('partido')
    expect(h.best[0].element_name).toBe('Conducción')
    expect(h.lowest[0].element_name).toBe('Toma de decisiones')
  })
  it('muestra la evolución y la diferencia contra la anterior', () => {
    const e1 = { evaluated_on: '2026-09-01', area_scores: { tecnica: 3.2 }, overall: 3.2 }
    const e2 = { evaluated_on: '2026-10-01', area_scores: { tecnica: 3.6 }, overall: 3.6 }
    expect(evolution([e2, e1])[0].values).toEqual([3.2, 3.6])
    expect(deltaVs(e2, e1)).toEqual({ tecnica: 0.4, general: 0.4 })
  })
  it('candidato a cambio de nivel sólo en nivel de desarrollo, con 2 evaluaciones altas y nunca automático', () => {
    const evals = [{ evaluated_on: '2026-09-01', overall: 4.1 }, { evaluated_on: '2026-10-01', overall: 4.4 }]
    expect(levelChangeCandidate({ level: 'desarrollo' }, evals)).toBe(true)
    expect(levelChangeCandidate({ level: 'avanzado' }, evals)).toBe(false)
    expect(levelChangeCandidate({ level: 'desarrollo' }, [evals[0]])).toBe(false)
  })
  it('usa lenguaje positivo', () => {
    expect(friendlyLevel(1.2)).toBe('Área prioritaria de desarrollo')
    expect(friendlyLevel(2)).toBe('En proceso de consolidación')
  })
})
