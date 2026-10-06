import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { EvalElement, EvalExercise, EvalTemplate, PlayerEvalItem, PlayerEvaluation } from './evaluation'

// Si las tablas todavía no existen en la base de datos, se regresa vacío (no truena la página)
const safe = <T,>(r: { data: unknown; error: unknown }) => (r.error ? ([] as T[]) : (r.data as T[]))

export function useEvalTemplates() {
  return useQuery({ queryKey: ['eval', 'templates'], queryFn: async () => safe<EvalTemplate>(await supabase.from('eval_templates').select('*').order('sort_order')), staleTime: 60_000 })
}
export function useEvalElements() {
  return useQuery({ queryKey: ['eval', 'elements'], queryFn: async () => safe<EvalElement>(await supabase.from('eval_elements').select('*').order('sort_order')), staleTime: 60_000 })
}
export function useEvalExercises() {
  return useQuery({
    queryKey: ['eval', 'exercises'],
    queryFn: async () => safe<EvalExercise>(await supabase.from('eval_exercises').select('*, eval_exercise_elements(element_id)').order('name')),
    staleTime: 60_000,
  })
}
export function usePlayerEvaluations(studentId?: string) {
  return useQuery({
    queryKey: ['eval', 'player', studentId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('player_evaluations').select('*').order('evaluated_on', { ascending: false }).order('created_at', { ascending: false })
      if (studentId) q = q.eq('student_id', studentId)
      return safe<PlayerEvaluation>(await q)
    },
  })
}
export function usePlayerEvalItems(evaluationIds: string[]) {
  return useQuery({
    queryKey: ['eval', 'items', evaluationIds.join(',')],
    enabled: evaluationIds.length > 0,
    queryFn: async () => safe<PlayerEvalItem>(await supabase.from('player_evaluation_items').select('*').in('evaluation_id', evaluationIds)),
  })
}
