/**
 * Evaluación profesional de jugadores.
 * GENERACIÓN + NIVEL = PLANTILLA → ÁREAS → INDICADORES → EJERCICIOS → CRITERIOS → CALIFICACIÓN 1-5
 */

export type AreaKey = 'tecnica' | 'partido' | 'coordinacion' | 'fisico'
export const AREAS: { key: AreaKey; label: string; short: string; icon: string }[] = [
  { key: 'tecnica', label: 'Fundamentos técnicos', short: 'Técnica', icon: '⚽' },
  { key: 'partido', label: 'Situación de partido', short: 'Partido', icon: '🧠' },
  { key: 'coordinacion', label: 'Coordinación', short: 'Coordinación', icon: '🤸' },
  { key: 'fisico', label: 'Aspecto físico', short: 'Físico', icon: '💪' },
]
export const areaLabel = (k: string) => AREAS.find((a) => a.key === k)?.label ?? k

/** La escala es igual para todos; lo que cambia son los criterios de cada ejercicio. */
export const SCORE_LABEL: Record<number, string> = { 1: 'Inicial', 2: 'En desarrollo', 3: 'Adecuado', 4: 'Bueno', 5: 'Destacado' }

export interface EvalTemplate {
  id: string; name: string; generation: string | null; level: string; level_label: string; stage: string | null
  is_goalkeeper: boolean; category_id: string | null; match_name: string | null; sort_order: number; active: boolean
}
export interface EvalElement { id: string; template_id: string; area: AreaKey; name: string; sort_order: number; active: boolean }
export interface EvalExercise {
  id: string; name: string; description: string | null; objective: string | null; instructions: string | null
  material: string | null; duration: string | null; repetitions: string | null; difficulty: number | null
  criteria: Record<string, string>; observations: string | null; video_url: string | null; image_url: string | null; active: boolean
  eval_exercise_elements?: { element_id: string }[]
}
export interface PlayerEvaluation {
  id: string; student_id: string; template_id: string | null; template_name: string | null; level_label: string | null
  category_id: string | null; evaluated_on: string; coach: string | null; notes: string | null
  area_scores: Partial<Record<AreaKey, number>>; overall: number | null; created_at: string
}
export interface PlayerEvalItem {
  id: string; evaluation_id: string; area: AreaKey; element_id: string | null; element_name: string
  exercise_id: string | null; exercise_name: string | null; score: number; note: string | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Plantillas que le tocan a un niño: la de su categoría (+ Porteros si toma esa clase). */
export function templatesFor(student: { category_id: string | null; id: string }, templates: EvalTemplate[], extraCats: string[] = []) {
  const own = templates.filter((t) => t.active && t.category_id && t.category_id === student.category_id)
  const extra = templates.filter((t) => t.active && t.category_id && extraCats.includes(t.category_id) && !own.includes(t))
  return [...own, ...extra]
}

/** Promedio por área y general (sólo de lo calificado). */
export function scoresOf(items: Pick<PlayerEvalItem, 'area' | 'score'>[]) {
  const area: Partial<Record<AreaKey, number>> = {}
  for (const a of AREAS) {
    const xs = items.filter((i) => i.area === a.key && i.score > 0).map((i) => i.score)
    if (xs.length) area[a.key] = round1(xs.reduce((s, x) => s + x, 0) / xs.length)
  }
  const vals = Object.values(area) as number[]
  const overall = vals.length ? round1(vals.reduce((s, x) => s + x, 0) / vals.length) : null
  return { area, overall }
}

/** Área más fuerte / de mayor oportunidad, mejor indicador / más bajo. */
export function highlights(scores: Partial<Record<AreaKey, number>>, items: Pick<PlayerEvalItem, 'element_name' | 'score' | 'area'>[]) {
  const areas = (Object.entries(scores) as [AreaKey, number][]).sort((a, b) => b[1] - a[1])
  const its = [...items].filter((i) => i.score > 0).sort((a, b) => b.score - a.score)
  const top = its.length ? its[0].score : 0
  const low = its.length ? its[its.length - 1].score : 0
  return {
    bestArea: areas[0]?.[0] ?? null,
    weakArea: areas.length > 1 ? areas[areas.length - 1][0] : null,
    best: its.filter((i) => i.score === top).slice(0, 3),
    lowest: its.length > 1 ? its.filter((i) => i.score === low && low < top).slice(0, 3) : [],
    strengths: its.filter((i) => i.score >= 4).slice(0, 5),
    toDevelop: [...its].reverse().filter((i) => i.score <= 3).slice(0, 5),
  }
}

/** Evolución de cada área a lo largo de las evaluaciones (de la más vieja a la más nueva). */
export function evolution(evals: Pick<PlayerEvaluation, 'evaluated_on' | 'area_scores' | 'overall'>[]) {
  const list = [...evals].sort((a, b) => a.evaluated_on.localeCompare(b.evaluated_on))
  return AREAS.map((a) => ({ ...a, values: list.map((e) => e.area_scores?.[a.key] ?? null) }))
    .concat([{ key: 'general' as AreaKey, label: 'Promedio general', short: 'General', icon: '⭐', values: list.map((e) => (e.overall != null ? Number(e.overall) : null)) }])
}

/** Diferencia contra la evaluación anterior (por área y general). */
export function deltaVs(cur: Pick<PlayerEvaluation, 'area_scores' | 'overall'>, prev?: Pick<PlayerEvaluation, 'area_scores' | 'overall'>) {
  if (!prev) return null
  const out: Partial<Record<AreaKey | 'general', number>> = {}
  for (const a of AREAS) {
    const x = cur.area_scores?.[a.key], y = prev.area_scores?.[a.key]
    if (x != null && y != null) out[a.key] = round1(x - y)
  }
  if (cur.overall != null && prev.overall != null) out.general = round1(Number(cur.overall) - Number(prev.overall))
  return out
}

/**
 * "Candidato a cambio de nivel": en nivel de desarrollo, con sus 2 últimas evaluaciones en 4 o más
 * y mejorando. Sólo es una sugerencia: la decisión es del entrenador o la administración.
 */
export function levelChangeCandidate(template: Pick<EvalTemplate, 'level'> | undefined, evals: Pick<PlayerEvaluation, 'evaluated_on' | 'overall'>[]) {
  if (!template || template.level !== 'desarrollo') return false
  const list = [...evals].filter((e) => e.overall != null).sort((a, b) => b.evaluated_on.localeCompare(a.evaluated_on))
  return list.length >= 2 && Number(list[0].overall) >= 4 && Number(list[1].overall) >= 4 && Number(list[0].overall) >= Number(list[1].overall)
}

/** Palabras para papás y alumnos: nunca lenguaje negativo. */
export function friendlyLevel(score: number | null | undefined) {
  if (score == null) return '—'
  if (score >= 4.5) return 'Destacado'
  if (score >= 3.5) return 'Bueno'
  if (score >= 2.5) return 'Adecuado'
  if (score >= 1.5) return 'En proceso de consolidación'
  return 'Área prioritaria de desarrollo'
}
