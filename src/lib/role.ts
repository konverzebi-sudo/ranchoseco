import { useMemo } from 'react'
import { useCategories, useCoachCategories, useCoaches, useTeam } from './api'
import { useActor } from '@/components/Team'
import { getActorId, getAdminOk, isAdminRole } from './actor'

/** Secciones que ve un profe (sin pagos ni administración). */
export const PROFE_PATHS = ['/', '/asistencias', '/entrenamientos', '/partidos', '/calendario', '/evaluaciones', '/reportes']
/** El profe puede abrir la ficha de sus niños (sin pagos). */
export const profeCanOpen = (path: string) => PROFE_PATHS.includes(path) || path.startsWith('/alumnos/') || path.startsWith('/partidos/')

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Vista según quién usa el aparato ("¿Quién eres?"): si en el equipo es Profesor,
 * ve la vista de profe con sus categorías (las que tiene asignadas en Profesores).
 * Cuando haya usuarios con contraseña, esto lo decidirá el inicio de sesión.
 */
export function useRole() {
  const actor = useActor()
  const team = useTeam()
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const cats = useCategories()
  return useMemo(() => {
    // Sólo cuenta quien entró con su PIN en este aparato
    const me = team.data?.find((m) => m.id === getActorId() && getAdminOk() === m.id && m.active && !!m.pin_hash)
    const isAdmin = !!me && isAdminRole(me.role)
    const isCoach = !!me && /profe/i.test(me.role ?? '')
    const coach = isCoach ? (coaches.data ?? []).find((c) => norm(c.full_name) === norm(me!.full_name)) : undefined
    const categoryIds = coach
      ? (cc.data ?? []).filter((x) => x.coach_id === coach.id).map((x) => x.category_id)
      : (cats.data ?? []).map((c) => c.id) // sin nombre escogido: ve todas las categorías, pero sin números
    return { loggedIn: !!me, isProfe: !isAdmin, isAdmin, isCoach, name: isCoach ? actor : '', coachId: coach?.id ?? null, categoryIds, ready: !!team.data }
  }, [actor, team.data, coaches.data, cc.data, cats.data])
}
