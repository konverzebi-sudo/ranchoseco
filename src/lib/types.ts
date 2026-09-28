export type StudentStatus = 'activo' | 'suspendido' | 'baja'
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
  late_fee_per_day: number
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

export interface Expense {
  id: string
  name: string
  amount: number
  frequency: 'semanal' | 'quincenal' | 'mensual' | 'anual' | 'unico'
  paid_month: number | null
  paid_year: number | null
  notes: string | null
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
  created_at: string
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
  late_fee_per_day: number
  late_fee_waived: number
  late_days: number
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
}

export interface MatchPlayer {
  match_id: string
  student_id: string
  starter: boolean
  position: string | null
  goals: number
  assists: number
  minutes: number
  notes: string | null
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
