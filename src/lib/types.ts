export type StudentStatus = 'activo' | 'suspendido' | 'baja' | 'muestra'
export type AttendanceStatus = 'presente' | 'falta' | 'justificada' | 'retardo'
export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'deposito' | 'otro'
export type FeeStatus = 'pagado' | 'pendiente' | 'vencido' | 'parcial' | 'por_confirmar'
export type AccountStatus = 'al_corriente' | 'pendiente' | 'parcial' | 'vencido' | 'por_confirmar'
export type MatchStatus = 'programado' | 'jugado' | 'cancelado'

export interface Settings {
  id: number
  academy_name: string
  default_country_code: string
  default_monthly_fee: number
  due_day: number
  sibling_prices: number[]
  late_fee_amount: number
  payment_instructions: string
  collection_template: string
  report_template: string
  open_mode: boolean
}

export interface Category {
  id: string
  name: string
  description: string | null
  schedule: string | null
  monthly_fee: number | null
  sort_order: number
  active: boolean
  is_extra?: boolean
  /** Días y horas que entrena cada semana */
  weekly_schedule?: { dow: number; start: string; end: string }[] | null
  schedule_generated_until?: string | null
}

export interface ExtraClass {
  student_id: string
  category_id: string
}

export interface Coach {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  active: boolean
}

export interface CoachPay {
  coach_id: string
  amount: number
  frequency: 'semanal' | 'quincenal' | 'mensual'
}

export interface CoachPayHistory {
  id: string
  coach_id: string
  amount: number
  frequency: CoachPay['frequency']
  previous_amount: number | null
  effective_date: string
  reason: string | null
  responsibilities: string | null
  created_at: string
}

export interface ActivityRow {
  id: string
  at: string
  actor: string | null
  kind: string
  title: string
  body: string | null
  link: string | null
  student_id: string | null
}

export interface TeamMember {
  id: string
  full_name: string
  role: string | null
  active: boolean
  /** PIN cifrado (sólo administración) */
  pin_hash?: string | null
  /** El PIN lo asignó administración: al entrar debe escoger el suyo */
  pin_must_change?: boolean
  /** PIN temporal (sólo lo ve Jany hasta que la persona escoge el suyo) */
  pin_temp?: string | null
}

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  created_at: string
  seen_at: string | null
  /** Quién hizo el movimiento */
  actor?: string | null
}

export interface CashCut {
  id: string
  cut_date: string
  period_from: string
  period_to: string
  income: number
  outflow: number
  counted: number
  distribution: { to: string; amount: number }[]
  /** Entradas y salidas revisadas (✓ aprobada, monto corregido y nota) */
  items?: { key: string; type: 'entrada' | 'salida'; date: string; concept: string; detail: string; amount: number; approved: boolean; adjusted: number | null; note: string; excluded?: boolean; pending?: boolean; prepaidUntil?: string }[]
  /** Ahorros apartados en este corte */
  savings?: { key: string; name: string; target: number; due: string; suggested: number; saved: number; note?: string }[]
  notes: string | null
  created_at: string
}

export interface ExpenseInstallment {
  id: string
  expense_id: string
  /** 0 = anticipo; 1, 2, 3… = pagos */
  n: number
  due_date: string
  amount: number
  /** Fecha en que se pagó; vacía = pendiente */
  paid_on: string | null
  notes: string | null
}

export interface Expense {
  id: string
  name: string
  amount: number
  frequency: 'semanal' | 'quincenal' | 'mensual' | 'anual' | 'unico' | 'partes'
  paid_month: number | null
  paid_year: number | null
  /** Sólo gastos en partes: anticipo y número de pagos mensuales del resto. */
  down_payment: number | null
  installments: number | null
  /** Día exacto en que se hizo un gasto de una sola vez (desglose día a día). */
  paid_on: string | null
  notes: string | null
  /** Pagos de un gasto en partes (cada uno con su fecha y si ya se pagó). */
  expense_installments?: ExpenseInstallment[]
  /** Gastos fijos: meses (1-12) en que no se paga, p. ej. Regalías en julio y agosto */
  skip_months?: number[]
  /** 'prestamo' = dinero que le prestaron a Rancho Seco (sus pagos son para devolverlo) */
  kind?: 'gasto' | 'prestamo'
  /** Préstamos: quién prestó y cuándo llegó el dinero */
  lender?: string | null
  received_on?: string | null
  active: boolean
  sort_order: number
}

export interface Guardian {
  id: string
  full_name: string
  phone: string
  email: string | null
  relationship: string | null
}

export interface Student {
  id: string
  full_name: string
  photo_path: string | null
  birth_date: string | null
  category_id: string | null
  coach_id: string | null
  enrolled_at: string
  status: StudentStatus
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  notes: string | null
  monthly_fee: number | null
  sibling_group_id: string | null
  sibling_order: number | null
  sibling_price: number | null
  inactive_since: string | null
  inactive_until: string | null
  inactive_reason: string | null
  profile_completed_at: string | null
  /** Día de su clase muestra (si vino a probar) */
  trial_on?: string | null
  /** Uniforme: talla y fechas de entrega del uniforme y de la playera de entrenamiento */
  uniform_size?: string | null
  uniform_delivered_on?: string | null
  training_shirt_delivered_on?: string | null
  credential_delivered_on?: string | null
  profile_completed_by: string | null
  created_at: string
}

export interface SiblingGroup {
  id: string
  name: string
  notes: string | null
}

export interface StudentMedical {
  student_id: string
  blood_type: string | null
  allergies: string | null
  conditions: string | null
  medications: string | null
  insurance: string | null
  notes: string | null
}

export interface FeeBalance {
  id: string
  student_id: string
  concept: string
  period: string
  amount: number
  due_date: string
  notes: string | null
  discount: number
  discount_reason: string | null
  review: string | null
  late_fee_amount: number
  late_fee_waived: number
  late_months: number
  late_fee: number
  total_due: number
  paid: number
  balance: number
  last_paid_at: string | null
  status: FeeStatus
}

export interface Payment {
  id: string
  fee_id: string
  student_id: string
  amount: number
  paid_at: string
  method: PaymentMethod
  receipt_path: string | null
  notes: string | null
  /** Quién del equipo Rancho Seco recibió el pago */
  received_by?: string | null
  created_at: string
}

export interface StudentAccount {
  student_id: string
  balance: number
  overdue: number
  late_fees: number
  scholarships: number
  review_count: number
  overdue_count: number
  pending_count: number
  next_due: string | null
  status: AccountStatus
}

export interface Training {
  id: string
  category_id: string
  coach_id: string | null
  date: string
  start_time: string | null
  end_time: string | null
  objectives: string | null
  exercises: string | null
  notes: string | null
  /** Nota del profe para todo el grupo */
  coach_notes?: string | null
  /** Administración confirmó que la lista es correcta */
  verified_at?: string | null
  verified_by?: string | null
}

export interface AttendanceCheck {
  training_id: string
  student_id: string
  status: AttendanceStatus
  actor: string | null
}

export interface Attendance {
  id: string
  training_id: string
  student_id: string
  status: AttendanceStatus
  notes: string | null
}

export interface AttendanceDetail extends Attendance {
  date: string
  category_id: string
  start_time: string | null
}

export interface Match {
  id: string
  category_id: string
  opponent: string
  date: string
  time: string | null
  venue: string | null
  is_home: boolean
  goals_for: number | null
  goals_against: number | null
  status: MatchStatus
  notes: string | null
  /** Reporte al terminar el partido */
  report?: MatchReport | null
  report_at?: string | null
}

export interface MatchReport {
  injuries?: string
  kids?: string
  parents?: string
  referees?: string
  tournament?: string
  other?: string
  /** Fotos de evidencia (rutas en el almacenamiento) */
  photos?: string[]
}

export interface MatchPlayer {
  match_id: string
  student_id: string
  starter: boolean
  position: string | null
  goals: number
  assists: number
  minutes: number
  /** Convocado que sí llegó (false = falta). Los no convocados no tienen registro. */
  attended: boolean
  notes: string | null
  /** Se lesionó en el partido */
  injured?: boolean
}

export const SKILL_GROUPS = [
  {
    key: 'tecnica',
    label: 'Técnica',
    skills: [
      ['pase', 'Pase'],
      ['control_balon', 'Control de balón'],
      ['conduccion', 'Conducción'],
      ['tiro', 'Tiro'],
      ['recepcion', 'Recepción'],
    ],
  },
  {
    key: 'fisica',
    label: 'Física',
    skills: [
      ['velocidad', 'Velocidad'],
      ['resistencia', 'Resistencia'],
      ['coordinacion', 'Coordinación'],
      ['agilidad', 'Agilidad'],
    ],
  },
  {
    key: 'tactica',
    label: 'Táctica',
    skills: [
      ['posicionamiento', 'Posicionamiento'],
      ['toma_decisiones', 'Toma de decisiones'],
      ['juego_equipo', 'Juego en equipo'],
    ],
  },
  {
    key: 'actitud',
    label: 'Actitud',
    skills: [
      ['disciplina', 'Disciplina'],
      ['esfuerzo', 'Esfuerzo'],
      ['companerismo', 'Compañerismo'],
    ],
  },
] as const

export type SkillKey = (typeof SKILL_GROUPS)[number]['skills'][number][0]
export const ALL_SKILLS = SKILL_GROUPS.flatMap((g) => g.skills.map(([k]) => k)) as SkillKey[]

export type Evaluation = {
  id: string
  student_id: string
  coach_id: string | null
  date: string
  strengths: string | null
  improvements: string | null
  goals: string | null
  comments: string | null
} & Record<SkillKey, number>

export interface ReportRow {
  id: string
  student_id: string
  period_from: string
  period_to: string
  file_path: string | null
  created_at: string
}
