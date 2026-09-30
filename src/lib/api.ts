import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase, unwrap } from './supabase'
import type {
  Attendance,
  AttendanceDetail,
  CashCut,
  Category,
  Coach,
  CoachPay,
  CoachPayHistory,
  Expense,
  ExtraClass,
  Evaluation,
  FeeBalance,
  Guardian,
  Match,
  MatchPlayer,
  Payment,
  ReportRow,
  Settings,
  SiblingGroup,
  Student,
  StudentAccount,
  StudentMedical,
  Training,
} from './types'

export type StudentRow = Student & {
  student_guardians: { is_primary: boolean; guardians: Guardian | null }[]
}

export const primaryGuardian = (s: StudentRow): Guardian | null =>
  (s.student_guardians.find((g) => g.is_primary) ?? s.student_guardians[0])?.guardians ?? null

export const isDad = (r: string | null | undefined) => /pap|padre/i.test(r ?? '')
export const isMom = (r: string | null | undefined) => /mam|madre/i.test(r ?? '')
/** Papá, mamá y otros tutores (abuela, tío…) de un alumno. */
export function parentsOf(s: StudentRow) {
  const all = s.student_guardians.filter((x) => x.guardians).map((x) => ({ ...x.guardians!, is_primary: x.is_primary }))
  const papa = all.find((g) => isDad(g.relationship)) ?? null
  const mama = all.find((g) => isMom(g.relationship)) ?? null
  const otros = all.filter((g) => g !== papa && g !== mama)
  return { papa, mama, otros, all }
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await supabase.from('settings').select('*').eq('id', 1).single()) as Settings,
    staleTime: 5 * 60_000,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () =>
      unwrap(await supabase.from('categories').select('*').order('sort_order').order('name')) as Category[],
    staleTime: 60_000,
  })
}

export function useCoaches() {
  return useQuery({
    queryKey: ['coaches'],
    queryFn: async () => unwrap(await supabase.from('coaches').select('*').order('full_name')) as Coach[],
    staleTime: 60_000,
  })
}

export function useExpenses() {
  return useQuery({
    queryKey: ['expenses'],
    queryFn: async () => unwrap(await supabase.from('expenses').select('*, expense_installments(*)').order('sort_order').order('created_at')) as Expense[],
  })
}

export function useExtraClasses() {
  return useQuery({
    queryKey: ['extra_classes'],
    queryFn: async () => unwrap(await supabase.from('student_extra_classes').select('student_id, category_id')) as ExtraClass[],
  })
}

export function useSiblingGroups() {
  return useQuery({
    queryKey: ['sibling_groups'],
    queryFn: async () => unwrap(await supabase.from('sibling_groups').select('*').order('name')) as SiblingGroup[],
  })
}

export function useCoachPay() {
  return useQuery({
    queryKey: ['coach_pay'],
    queryFn: async () => unwrap(await supabase.from('coach_pay').select('*')) as CoachPay[],
    staleTime: 60_000,
  })
}

export function useCashCuts() {
  return useQuery({
    queryKey: ['cash_cuts'],
    queryFn: async () => unwrap(await supabase.from('cash_cuts').select('*').order('cut_date', { ascending: false }).order('created_at', { ascending: false })) as CashCut[],
  })
}

export function useCoachPayHistory(coachId?: string) {
  return useQuery({
    queryKey: ['coach_pay_history', coachId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('coach_pay_history').select('*').order('effective_date', { ascending: false }).order('created_at', { ascending: false })
      if (coachId) q = q.eq('coach_id', coachId)
      return unwrap(await q) as CoachPayHistory[]
    },
  })
}

export function useCoachCategories() {
  return useQuery({
    queryKey: ['coach_categories'],
    queryFn: async () =>
      unwrap(await supabase.from('coach_categories').select('*')) as { coach_id: string; category_id: string }[],
    staleTime: 60_000,
  })
}

export function useStudents() {
  return useQuery({
    queryKey: ['students'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('students')
          .select('*, student_guardians(is_primary, guardians(*))')
          .order('full_name'),
      ) as StudentRow[],
  })
}

export function useStudent(id: string | undefined) {
  return useQuery({
    queryKey: ['student', id],
    enabled: !!id,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('students')
          .select('*, student_guardians(is_primary, guardians(*))')
          .eq('id', id!)
          .single(),
      ) as StudentRow,
  })
}

export function useMedical(studentId: string | undefined) {
  return useQuery({
    queryKey: ['medical', studentId],
    enabled: !!studentId,
    queryFn: async () =>
      unwrap(await supabase.from('student_medical').select('*').eq('student_id', studentId!).maybeSingle()) as
        | StudentMedical
        | null,
  })
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async () => unwrap(await supabase.from('student_accounts').select('*')) as StudentAccount[],
  })
}

export function useFees(studentId?: string) {
  return useQuery({
    queryKey: ['fees', studentId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('fee_balances').select('*').order('period', { ascending: false })
      if (studentId) q = q.eq('student_id', studentId)
      return unwrap(await q) as FeeBalance[]
    },
  })
}

export function usePayments(studentId?: string, from?: string) {
  return useQuery({
    queryKey: ['payments', studentId ?? 'all', from ?? ''],
    queryFn: async () => {
      let q = supabase.from('payments').select('*').order('paid_at', { ascending: false })
      if (studentId) q = q.eq('student_id', studentId)
      if (from) q = q.gte('paid_at', from)
      return unwrap(await q) as Payment[]
    },
  })
}

export function useTrainings(opts: { categoryId?: string; from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['trainings', opts],
    queryFn: async () => {
      let q = supabase.from('trainings').select('*').order('date', { ascending: false }).order('start_time')
      if (opts.categoryId) q = q.eq('category_id', opts.categoryId)
      if (opts.from) q = q.gte('date', opts.from)
      if (opts.to) q = q.lte('date', opts.to)
      return unwrap(await q) as Training[]
    },
  })
}

export function useAttendanceFor(trainingId: string | undefined) {
  return useQuery({
    queryKey: ['attendance', 'training', trainingId],
    enabled: !!trainingId,
    queryFn: async () =>
      unwrap(await supabase.from('attendance').select('*').eq('training_id', trainingId!)) as Attendance[],
  })
}

export function useAttendanceDetail(opts: { studentId?: string; categoryId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['attendance', 'detail', opts],
    queryFn: async () => {
      let q = supabase.from('attendance_detail').select('*').order('date', { ascending: false })
      if (opts.studentId) q = q.eq('student_id', opts.studentId)
      if (opts.categoryId) q = q.eq('category_id', opts.categoryId)
      if (opts.from) q = q.gte('date', opts.from)
      if (opts.to) q = q.lte('date', opts.to)
      return unwrap(await q) as AttendanceDetail[]
    },
  })
}

export function useMatches(opts: { categoryId?: string; from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['matches', opts],
    queryFn: async () => {
      let q = supabase.from('matches').select('*').order('date', { ascending: false })
      if (opts.categoryId) q = q.eq('category_id', opts.categoryId)
      if (opts.from) q = q.gte('date', opts.from)
      if (opts.to) q = q.lte('date', opts.to)
      return unwrap(await q) as Match[]
    },
  })
}

export function useMatchPlayers(opts: { matchId?: string; studentId?: string }) {
  return useQuery({
    queryKey: ['match_players', opts],
    enabled: !!(opts.matchId || opts.studentId),
    queryFn: async () => {
      let q = supabase.from('match_players').select('*')
      if (opts.matchId) q = q.eq('match_id', opts.matchId)
      if (opts.studentId) q = q.eq('student_id', opts.studentId)
      return unwrap(await q) as MatchPlayer[]
    },
  })
}

export function useEvaluations(studentId: string | undefined) {
  return useQuery({
    queryKey: ['evaluations', studentId],
    enabled: !!studentId,
    queryFn: async () =>
      unwrap(
        await supabase.from('evaluations').select('*').eq('student_id', studentId!).order('date'),
      ) as Evaluation[],
  })
}

export function useEvaluationCounts() {
  return useQuery({
    queryKey: ['evaluations', 'counts'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('evaluations').select('student_id')) as { student_id: string }[]
      const m = new Map<string, number>()
      for (const r of rows) m.set(r.student_id, (m.get(r.student_id) ?? 0) + 1)
      return m
    },
  })
}

export function useReports(studentId?: string) {
  return useQuery({
    queryKey: ['reports', studentId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('reports').select('*').order('created_at', { ascending: false })
      if (studentId) q = q.eq('student_id', studentId)
      return unwrap(await q.limit(200)) as ReportRow[]
    },
  })
}

export function usePortalToken(studentId: string | undefined) {
  return useQuery({
    queryKey: ['portal', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const row = unwrap(
        await supabase.from('portal_links').select('token').eq('student_id', studentId!).maybeSingle(),
      ) as { token: string } | null
      if (row) return row.token
      // Alumno sin link (p. ej. creado antes del portal): lo generamos
      return unwrap(await supabase.rpc('regenerate_portal_link', { p_student: studentId })) as string
    },
    staleTime: Infinity,
  })
}

export const portalUrl = (token: string) =>
  `${window.location.origin}${import.meta.env.BASE_URL}#/p/${token}`

/** Mutación genérica que invalida las consultas indicadas al terminar. */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: QueryKey[] = [],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  })
}
