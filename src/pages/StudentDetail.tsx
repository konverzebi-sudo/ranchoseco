import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Pencil, User, ClipboardCheck, Wallet, TrendingUp, Trophy, FileText, Plus, HeartPulse, Link2, Copy,
  MessageCircle, RefreshCw, UserX, Receipt, Phone, PauseCircle, PlayCircle,
} from 'lucide-react'
import {
  Avatar, Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Modal, Spinner, Tabs, Textarea, feeTone,
} from '@/components/ui'
import StudentForm from '@/components/StudentForm'
import { CollectButton } from '@/components/WhatsAppButtons'
import { PaymentModal, FeeModal } from '@/components/PaymentForms'
import { EvaluationModal, EvolutionChart, GroupSummary, SkillRadar } from '@/components/Evaluation'
import ReportPanel from '@/components/ReportPanel'
import { ScholarshipReviewModal } from '@/components/ScholarshipReview'
import { PauseModal, ReactivateModal } from '@/components/InactiveModals'
import { useToast } from '@/components/toast'
import {
  useAccounts, useAttendanceDetail, useCategories, useCoaches, useCoachCategories, useEvaluations, useFees, useMatches, useMatchPlayers,
  useMedical, usePayments, usePortalToken, useSettings, useSiblingGroups, useStudent, useStudents, useTrainings, portalUrl, primaryGuardian, type StudentRow,
} from '@/lib/api'
import {
  ACCOUNT_LABEL, ATTENDANCE_LABEL, FEE_LABEL, METHOD_LABEL, STATUS_LABEL, age, date, money, monthName, prettyPhone, shortDate, time,
} from '@/lib/format'
import { attendanceRate, consecutiveAbsences, overallAverage } from '@/lib/stats'
import { supabase, unwrap, signedUrl, BUCKETS } from '@/lib/supabase'
import { waLink } from '@/lib/whatsapp'
import { memberPrice, ordinal, promoStatus } from '@/lib/siblings'
import { SKILL_GROUPS, type AttendanceStatus, type Evaluation, type FeeBalance, type SkillKey } from '@/lib/types'

type Tab = 'general' | 'asistencias' | 'pagos' | 'seguimiento' | 'actividad' | 'reportes'
const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: 'general', label: 'Información general', icon: User },
  { id: 'asistencias', label: 'Asistencias', icon: ClipboardCheck },
  { id: 'pagos', label: 'Pagos', icon: Wallet },
  { id: 'seguimiento', label: 'Seguimiento deportivo', icon: TrendingUp },
  { id: 'actividad', label: 'Entrenamientos y partidos', icon: Trophy },
  { id: 'reportes', label: 'Reportes PDF', icon: FileText },
]

export default function StudentDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'general'
  const student = useStudent(id)
  const { data: categories } = useCategories()
  const accounts = useAccounts()
  const [editing, setEditing] = useState(false)

  if (student.error) return <ErrorState error={student.error} onRetry={() => student.refetch()} />
  if (student.isLoading || !student.data) return <Spinner />
  const s = student.data
  const cat = categories?.find((c) => c.id === s.category_id)
  const acc = accounts.data?.find((a) => a.student_id === s.id)
  const ag = age(s.birth_date)

  return (
    <>
      <Link to="/alumnos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> Alumnos</Link>
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={s.full_name} path={s.photo_path} size={76} className="ring-2 ring-brand" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide">{s.full_name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="brand">{cat?.name ?? 'Sin categoría'}</Badge>
              {ag != null && <span>{ag} años</span>}
              <Badge tone={s.status === 'activo' ? 'ok' : s.status === 'baja' ? 'bad' : 'warn'}>{STATUS_LABEL[s.status]}</Badge>
              {acc && <Badge tone={feeTone(acc.status)}>{ACCOUNT_LABEL[acc.status]}{Number(acc.balance) > 0 ? ` · ${money(acc.balance)}` : ''}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Number(acc?.balance ?? 0) > 0 && <CollectButton student={s} size="md" label="Cobrar por WhatsApp" />}
            <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Editar</Button>
          </div>
        </div>
      </Card>

      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      <div className="pt-5">
        {tab === 'general' && <GeneralTab s={s} />}
        {tab === 'asistencias' && <AttendanceTab s={s} />}
        {tab === 'pagos' && <PaymentsTab s={s} />}
        {tab === 'seguimiento' && <TrackingTab s={s} />}
        {tab === 'actividad' && <ActivityTab s={s} />}
        {tab === 'reportes' && <ReportPanel student={s} />}
      </div>
      {editing && <StudentForm student={s} onClose={() => setEditing(false)} />}
    </>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink-700 py-2.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function GeneralTab({ s }: { s: StudentRow }) {
  const { data: categories } = useCategories()
  const { data: coaches } = useCoaches()
  const { data: cc } = useCoachCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmBaja, setConfirmBaja] = useState(false)
  const [pause, setPause] = useState<'pause' | 'back' | null>(null)
  const [saving, setSaving] = useState(false)
  const g = primaryGuardian(s)
  const coachIds = s.coach_id ? [s.coach_id] : (cc ?? []).filter((x) => x.category_id === s.category_id).map((x) => x.coach_id)
  const coachNames = coachIds.map((id) => coaches?.find((c) => c.id === id)?.full_name).filter(Boolean).join(', ')

  const darDeBaja = async () => {
    setSaving(true)
    try {
      unwrap(await supabase.from('students').update({ status: s.status === 'baja' ? 'activo' : 'baja' }).eq('id', s.id))
      await Promise.all([qc.invalidateQueries({ queryKey: ['student', s.id] }), qc.invalidateQueries({ queryKey: ['students'] })])
      toast.ok(s.status === 'baja' ? 'Alumno reactivado' : 'Alumno dado de baja')
      setConfirmBaja(false)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-wide text-brand">Datos del alumno</h3>
        <InfoRow label="Fecha de nacimiento">{date(s.birth_date)}</InfoRow>
        <InfoRow label="Categoría">{categories?.find((c) => c.id === s.category_id)?.name ?? '—'}</InfoRow>
        <InfoRow label="Profesor">{coachNames || '—'}</InfoRow>
        <InfoRow label="Inscripción">{date(s.enrolled_at)}</InfoRow>
        <InfoRow label="Estatus">{STATUS_LABEL[s.status]}</InfoRow>
        {s.status === 'suspendido' && (
          <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
            <p className="font-semibold text-warn">Inactivo temporal{s.inactive_reason ? ` · ${s.inactive_reason}` : ''}</p>
            <p className="text-muted">Desde {date(s.inactive_since)}{s.inactive_until ? ` · regreso estimado ${date(s.inactive_until)}` : ''}. No se le generan mensualidades.</p>
          </div>
        )}
        {s.notes && <p className="mt-3 rounded-xl bg-ink-900 p-3 text-sm text-muted whitespace-pre-line">{s.notes}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {s.status === 'activo' && <Button variant="secondary" size="sm" icon={PauseCircle} onClick={() => setPause('pause')}>Inactivo temporal</Button>}
          {s.status === 'suspendido' && <Button size="sm" icon={PlayCircle} onClick={() => setPause('back')}>Reactivar</Button>}
          <Button variant={s.status === 'baja' ? 'secondary' : 'danger'} size="sm" icon={UserX} onClick={() => setConfirmBaja(true)}>
            {s.status === 'baja' ? 'Reactivar alumno' : 'Dar de baja'}
          </Button>
        </div>
        {pause === 'pause' && <PauseModal student={s} onClose={() => setPause(null)} />}
        {pause === 'back' && <ReactivateModal student={s} onClose={() => setPause(null)} />}
      </Card>

      <div className="space-y-5">
        <Card className="p-5">
          <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-wide text-brand">Tutor y emergencias</h3>
          <InfoRow label="Tutor">{g ? `${g.full_name}${g.relationship ? ` (${g.relationship})` : ''}` : 'Sin capturar'}</InfoRow>
          <InfoRow label="WhatsApp">
            {g ? <a href={waLink(g.phone, `Hola ${g.full_name.split(' ')[0]}, te escribimos de Deportivo Rancho Seco.`)} target="_blank" rel="noopener noreferrer" className="text-wa hover:underline">{prettyPhone(g.phone)}</a> : '—'}
          </InfoRow>
          {g?.email && <InfoRow label="Correo">{g.email}</InfoRow>}
          <InfoRow label="Emergencia">{s.emergency_contact_name ? <>{s.emergency_contact_name} {s.emergency_contact_phone && <a href={`tel:${s.emergency_contact_phone}`} className="ml-1 inline-flex items-center gap-1 text-brand"><Phone className="h-3.5 w-3.5" />{s.emergency_contact_phone}</a>}</> : '—'}</InfoRow>
        </Card>
        <SiblingPromoCard s={s} />
        <PortalLinkCard s={s} />
        <MedicalCard studentId={s.id} />
      </div>

      <ConfirmDialog open={confirmBaja} onClose={() => setConfirmBaja(false)} onConfirm={darDeBaja} loading={saving} danger={s.status !== 'baja'}
        title={s.status === 'baja' ? 'Reactivar alumno' : 'Dar de baja'}
        confirmLabel={s.status === 'baja' ? 'Reactivar' : 'Dar de baja'}
        text={s.status === 'baja'
          ? `${s.full_name} volverá a aparecer en listas de asistencia y cobranza.`
          : `${s.full_name} dejará de aparecer en listas de asistencia y cobranza, y su link para padres se desactivará. Su historial se conserva y puedes reactivarlo cuando quieras.`} />
    </div>
  )
}

function SiblingPromoCard({ s }: { s: StudentRow }) {
  const { data: groups } = useSiblingGroups()
  const { data: students } = useStudents()
  const { data: accounts } = useAccounts()
  const { data: settings } = useSettings()
  if (!s.sibling_group_id) return null
  const group = groups?.find((g) => g.id === s.sibling_group_id)
  const members = (students ?? []).filter((x) => x.sibling_group_id === s.sibling_group_id).sort((a, b) => (a.sibling_order ?? 99) - (b.sibling_order ?? 99))
  const st = promoStatus(members, new Set((accounts ?? []).filter((a) => a.status === 'vencido').map((a) => a.student_id)))
  const prices = settings?.sibling_prices?.map(Number)
  return (
    <Card className={st.valid && !st.overdue.length ? 'p-5' : 'border-bad/50 p-5'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Promo hermanos</h3>
        {st.valid ? <Badge tone={st.overdue.length ? 'warn' : 'ok'}>{st.overdue.length ? 'Con pagos vencidos' : 'Válida'}</Badge> : <Badge tone="bad">No válida</Badge>}
      </div>
      <p className="mb-2 text-sm text-muted">{group?.name}</p>
      <ul className="space-y-1 text-sm">
        {members.map((m, i) => (
          <li key={m.id} className="flex justify-between gap-2">
            <Link to={`/alumnos/${m.id}`} className={m.id === s.id ? 'font-semibold text-white' : 'text-muted hover:text-white'}>{ordinal(m.sibling_order ?? i + 1)} {m.full_name}{m.status !== 'activo' && ' (baja)'}</Link>
            <span>{money(memberPrice(m, i + 1, prices))}</span>
          </li>
        ))}
      </ul>
      {!st.valid && <p className="mt-2 text-xs text-bad">La promo sólo aplica si todos los hermanos siguen inscritos.</p>}
      <Link to="/becas" className="mt-2 inline-block text-xs text-brand hover:underline">Administrar en Becas</Link>
    </Card>
  )
}

function PortalLinkCard({ s }: { s: StudentRow }) {
  const { data: token, isLoading } = usePortalToken(s.id)
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const g = primaryGuardian(s)
  const url = token ? portalUrl(token) : ''
  const text = `Hola${g ? ' ' + g.full_name.split(' ')[0] : ''}, este es el enlace personal de ${s.full_name} en Deportivo Rancho Seco. Ahí puedes consultar su asistencia, avances, próximos entrenamientos y estado de cuenta:\n${url}`

  const regenerate = async () => {
    setBusy(true)
    try {
      const t = unwrap(await supabase.rpc('regenerate_portal_link', { p_student: s.id })) as string
      qc.setQueryData(['portal', s.id], t)
      toast.ok('Link nuevo generado. El anterior ya no funciona.')
      setConfirm(false)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <Card className="p-5">
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide text-brand"><Link2 className="h-5 w-5" /> Link para papás</h3>
      <p className="mb-3 text-sm text-muted">Sin usuario ni contraseña. Muestra sólo la información de {s.full_name.split(' ')[0]}.</p>
      {isLoading ? <Spinner /> : (
        <>
          <div className="truncate rounded-xl bg-ink-900 px-3 py-2.5 font-mono text-xs text-muted">{url}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {g && <a href={waLink(g.phone, text)} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-wa px-3 text-sm font-semibold text-ink hover:brightness-110"><MessageCircle className="h-4 w-4" /> Enviar al tutor</a>}
            <Button size="sm" variant="secondary" icon={Copy} onClick={() => navigator.clipboard.writeText(url).then(() => toast.ok('Link copiado'))}>Copiar</Button>
            <Button size="sm" variant="ghost" onClick={() => window.open(url, '_blank', 'noopener')}>Ver como papá</Button>
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setConfirm(true)}>Cambiar link</Button>
          </div>
        </>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={regenerate} loading={busy} danger title="Cambiar link"
        confirmLabel="Generar link nuevo" text="El link actual dejará de funcionar de inmediato. Úsalo si el link se compartió con alguien que no debía tenerlo. Después envía el nuevo al tutor." />
    </Card>
  )
}

function MedicalCard({ studentId }: { studentId: string }) {
  const { data, isLoading } = useMedical(studentId)
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [show, setShow] = useState(false)
  const [f, setF] = useState({ blood_type: '', allergies: '', conditions: '', medications: '', insurance: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const start = () => {
    setF({ blood_type: data?.blood_type ?? '', allergies: data?.allergies ?? '', conditions: data?.conditions ?? '', medications: data?.medications ?? '', insurance: data?.insurance ?? '', notes: data?.notes ?? '' })
    setOpen(true)
  }
  const save = async () => {
    setSaving(true)
    try {
      const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
      unwrap(await supabase.from('student_medical').upsert({ student_id: studentId, ...clean, updated_at: new Date().toISOString() }))
      await qc.invalidateQueries({ queryKey: ['medical', studentId] })
      toast.ok('Información médica guardada')
      setOpen(false)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  const has = data && Object.entries(data).some(([k, v]) => !['student_id', 'updated_at'].includes(k) && v)
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide text-brand"><HeartPulse className="h-5 w-5" /> Información médica</h3>
        <Badge tone="warn">Confidencial</Badge>
      </div>
      {isLoading ? <Spinner /> : !show ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-sm text-muted">{has ? 'Hay información registrada para emergencias.' : 'Sin información registrada.'}</p>
          {has && <Button size="sm" variant="secondary" onClick={() => setShow(true)}>Mostrar</Button>}
          <Button size="sm" variant="ghost" icon={Pencil} onClick={start}>{has ? 'Editar' : 'Agregar'}</Button>
        </div>
      ) : (
        <>
          <InfoRow label="Tipo de sangre">{data?.blood_type || '—'}</InfoRow>
          <InfoRow label="Alergias">{data?.allergies || '—'}</InfoRow>
          <InfoRow label="Padecimientos">{data?.conditions || '—'}</InfoRow>
          <InfoRow label="Medicamentos">{data?.medications || '—'}</InfoRow>
          <InfoRow label="Seguro médico">{data?.insurance || '—'}</InfoRow>
          {data?.notes && <p className="mt-2 text-sm text-muted">{data.notes}</p>}
          <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setShow(false)}>Ocultar</Button><Button size="sm" variant="ghost" icon={Pencil} onClick={start}>Editar</Button></div>
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Información médica"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} loading={saving}>Guardar</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de sangre"><Input value={f.blood_type} onChange={(e) => setF({ ...f, blood_type: e.target.value })} placeholder="O+" /></Field>
          <Field label="Seguro médico"><Input value={f.insurance} onChange={(e) => setF({ ...f, insurance: e.target.value })} /></Field>
          <Field label="Alergias" className="sm:col-span-2"><Textarea rows={2} value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} /></Field>
          <Field label="Padecimientos" className="sm:col-span-2"><Textarea rows={2} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
          <Field label="Medicamentos" className="sm:col-span-2"><Textarea rows={2} value={f.medications} onChange={(e) => setF({ ...f, medications: e.target.value })} /></Field>
          <Field label="Notas" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  )
}

const ATT_TONE: Record<AttendanceStatus, 'ok' | 'bad' | 'info' | 'warn'> = { presente: 'ok', falta: 'bad', justificada: 'info', retardo: 'warn' }

function AttendanceTab({ s }: { s: StudentRow }) {
  const att = useAttendanceDetail({ studentId: s.id })
  const rows = att.data ?? []
  const streak = consecutiveAbsences(rows).get(s.id) ?? 0
  const byMonth = useMemo(() => {
    const m = new Map<string, typeof rows>()
    for (const r of rows) { const k = r.date.slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]) }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])
  if (att.error) return <ErrorState error={att.error} />
  if (att.isLoading) return <Spinner />
  if (!rows.length) return <Card><Empty icon={ClipboardCheck} title="Sin asistencias registradas" text="Aparecerán aquí cuando se pase lista en su categoría." /></Card>
  const rate = attendanceRate(rows)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs uppercase tracking-wider text-muted">Asistencia</p><p className="font-display text-3xl font-bold text-brand">{rate}%</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wider text-muted">Registros</p><p className="font-display text-3xl font-bold">{rows.length}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wider text-muted">Faltas</p><p className="font-display text-3xl font-bold">{rows.filter((r) => r.status === 'falta').length}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wider text-muted">Faltas seguidas</p><p className={`font-display text-3xl font-bold ${streak >= 2 ? 'text-bad' : ''}`}>{streak}</p></Card>
      </div>
      {byMonth.map(([month, list]) => (
        <Card key={month} className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg font-bold uppercase tracking-wide">{monthName(month + '-01')}</h3>
            <Badge tone="brand">{attendanceRate(list)}%</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {list.slice().sort((a, b) => a.date.localeCompare(b.date)).map((r) => (
              <div key={r.id} className="rounded-xl bg-ink-900 px-3 py-2 text-center">
                <p className="text-xs text-muted">{date(r.date, 'EEE d')}</p>
                <Badge tone={ATT_TONE[r.status]} className="mt-1">{ATTENDANCE_LABEL[r.status]}</Badge>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function PaymentsTab({ s }: { s: StudentRow }) {
  const fees = useFees(s.id)
  const payments = usePayments(s.id)
  const toast = useToast()
  const [pay, setPay] = useState<string | null | undefined>(undefined)
  const [newFee, setNewFee] = useState(false)
  const [waive, setWaive] = useState<FeeBalance | null>(null)
  const [review, setReview] = useState<FeeBalance | null>(null)
  const [waiving, setWaiving] = useState(false)
  const qc = useQueryClient()
  const doWaive = async () => {
    if (!waive) return
    setWaiving(true)
    try {
      unwrap(await supabase.from('fees').update({ late_fee_waived: Number(waive.late_fee_waived) + Number(waive.late_fee) }).eq('id', waive.id))
      await Promise.all(['fees', 'accounts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Recargo condonado')
      setWaive(null)
    } catch (e) { toast.error(e) } finally { setWaiving(false) }
  }
  const balance = (fees.data ?? []).reduce((t, f) => t + Number(f.balance), 0)
  const scholarship = (fees.data ?? []).reduce((t, f) => t + Number(f.discount), 0)
  const openReceipt = async (path: string) => {
    const url = await signedUrl(BUCKETS.receipts, path, 300)
    if (url) window.open(url, '_blank', 'noopener'); else toast.error('No se encontró el comprobante.')
  }
  if (fees.error) return <ErrorState error={fees.error} />
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Card className="flex-1 p-4">
          <p className="text-xs uppercase tracking-wider text-muted">Saldo pendiente</p>
          <p className={`font-display text-3xl font-bold ${balance > 0 ? 'text-brand' : 'text-ok'}`}>{money(balance)}</p>
          {(scholarship > 0 || s.monthly_fee != null) && (
            <p className="mt-1 text-xs text-muted">
              {s.monthly_fee != null && <>Cuota especial: <span className="text-white">{money(s.monthly_fee)}</span> · </>}
              Becado a la fecha: <span className="text-ok">{money(scholarship)}</span>
            </p>
          )}
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button icon={Wallet} onClick={() => setPay(null)}>{balance > 0 ? 'Registrar pago' : 'Pagar por adelantado'}</Button>
          <Button variant="secondary" icon={Plus} onClick={() => setNewFee(true)}>Nuevo cargo</Button>
          {balance > 0 && <CollectButton student={s} size="md" label="WhatsApp" />}
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="table-base min-w-[860px]">
          <thead><tr><th>Concepto</th><th>Vence</th><th>Precio</th><th>Beca</th><th>Recargo</th><th>Pagado</th><th>Saldo</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {fees.isLoading ? <tr><td colSpan={9}><Spinner /></td></tr> :
              !fees.data?.length ? <tr><td colSpan={9} className="py-8 text-center text-muted">Sin cargos registrados.</td></tr> :
              fees.data.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium">{f.concept} {monthName(f.period)}</td>
                  <td>{shortDate(f.due_date)}</td>
                  <td>{money(f.amount)}</td>
                  <td>{Number(f.discount) > 0 ? <span className="text-ok">−{money(f.discount)}<span className="block text-xs text-muted">{f.discount_reason ?? 'Descuento'}</span></span> : <span className="text-muted">—</span>}</td>
                  <td>
                    {Number(f.late_fee) > 0 ? (
                      <span className="text-bad">{money(f.late_fee)}<span className="block text-xs text-muted">{f.late_months} {f.late_months === 1 ? 'mes' : 'meses'} × {money(f.late_fee_amount)}</span></span>
                    ) : Number(f.late_fee_waived) > 0 ? <span className="text-xs text-muted">Condonado</span> : <span className="text-muted">—</span>}
                  </td>
                  <td>{money(f.paid)}</td>
                  <td className="font-semibold">{money(f.balance)}</td>
                  <td>{f.status === 'por_confirmar'
                    ? <button onClick={() => setReview(f)} title="Confirmar beca o adeudo" className="hover:opacity-80"><Badge tone="warn" className="cursor-pointer underline decoration-dotted">{FEE_LABEL[f.status]}</Badge></button>
                    : <Badge tone={feeTone(f.status)}>{FEE_LABEL[f.status]}</Badge>}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {f.status === 'por_confirmar' && <Button size="sm" onClick={() => setReview(f)}>¿Beca o adeudo?</Button>}
                      {Number(f.late_fee) > 0 && <Button size="sm" variant="ghost" onClick={() => setWaive(f)}>Perdonar recargo</Button>}
                      {Number(f.balance) > 0 && <Button size="sm" variant="secondary" onClick={() => setPay(f.id)}>Pagar</Button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Historial de pagos</h3>
        {!payments.data?.length ? <p className="px-5 py-8 text-center text-sm text-muted">Sin pagos registrados.</p> : (
          <ul className="divide-y divide-ink-700">
            {payments.data.map((p) => {
              const f = fees.data?.find((x) => x.id === p.fee_id)
              return (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Receipt className="h-5 w-5 shrink-0 text-ok" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{money(p.amount)} · {METHOD_LABEL[p.method]}</p>
                    <p className="text-xs text-muted">{date(p.paid_at)}{f ? ` · ${f.concept} ${monthName(f.period)}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p>
                  </div>
                  {p.receipt_path && <Button size="sm" variant="ghost" onClick={() => openReceipt(p.receipt_path!)}>Comprobante</Button>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {pay !== undefined && <PaymentModal student={s} feeId={pay ?? undefined} onClose={() => setPay(undefined)} />}
      {newFee && <FeeModal student={s} onClose={() => setNewFee(false)} />}
      {review && <ScholarshipReviewModal fee={review} onClose={() => setReview(null)} />}
      <ConfirmDialog open={!!waive} onClose={() => setWaive(null)} onConfirm={doWaive} loading={waiving} title="Perdonar recargo" confirmLabel="Perdonar"
        text={waive ? <>Se perdonan <b className="text-white">{money(waive.late_fee)}</b> de recargo de {waive.concept} {monthName(waive.period)}. Si el pago sigue pendiente, a partir de mañana el recargo vuelve a correr.</> : null} />
    </div>
  )
}

function TrackingTab({ s }: { s: StudentRow }) {
  const evals = useEvaluations(s.id)
  const { data: coaches } = useCoaches()
  const [modal, setModal] = useState<{ editing?: Evaluation } | null>(null)
  const list = evals.data ?? []
  const latest = list.at(-1)
  if (evals.error) return <ErrorState error={evals.error} />
  if (evals.isLoading) return <Spinner />
  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button icon={Plus} onClick={() => setModal({})}>Nueva evaluación</Button></div>
      {!latest ? (
        <Card><Empty icon={TrendingUp} title="Aún no hay evaluaciones" text="Evalúa técnica, físico, táctica y actitud del 1 al 5. Toma menos de un minuto."
          action={<Button icon={Plus} onClick={() => setModal({})}>Evaluar ahora</Button>} /></Card>
      ) : (
        <>
          <GroupSummary evaluation={latest} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide">Evolución</h3>
              {list.length > 1 ? <EvolutionChart evaluations={list} /> : <p className="py-16 text-center text-sm text-muted">La gráfica de evolución aparece a partir de la segunda evaluación.</p>}
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide">Última evaluación · {date(latest.date)}</h3>
              <SkillRadar evaluation={latest} />
            </Card>
          </div>
          <div className="space-y-3">
            {list.slice().reverse().map((e) => (
              <Card key={e.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-bold uppercase">{date(e.date)}</p>
                    <p className="text-xs text-muted">{coaches?.find((c) => c.id === e.coach_id)?.full_name ?? 'Profesor sin especificar'} · Promedio {overallAverage(e).toFixed(1)}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setModal({ editing: e })}>Editar</Button>
                </div>
                <div className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
                  {SKILL_GROUPS.map((g) => (
                    <p key={g.key}><span className="text-white">{g.label}:</span> {g.skills.map(([k, l]) => `${l} ${e[k as SkillKey]}`).join(' · ')}</p>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  {e.strengths && <p><span className="text-ok">Fortalezas: </span>{e.strengths}</p>}
                  {e.improvements && <p><span className="text-warn">Áreas de mejora: </span>{e.improvements}</p>}
                  {e.goals && <p><span className="text-brand">Objetivos: </span>{e.goals}</p>}
                  {e.comments && <p><span className="text-muted">Comentarios: </span>{e.comments}</p>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      {modal && <EvaluationModal studentId={s.id} categoryId={s.category_id} previous={latest} editing={modal.editing} onClose={() => setModal(null)} />}
    </div>
  )
}

function ActivityTab({ s }: { s: StudentRow }) {
  const trainings = useTrainings({ categoryId: s.category_id ?? '00000000-0000-0000-0000-000000000000' })
  const att = useAttendanceDetail({ studentId: s.id })
  const mp = useMatchPlayers({ studentId: s.id })
  const matches = useMatches({ categoryId: s.category_id ?? '00000000-0000-0000-0000-000000000000' })
  const attMap = new Map((att.data ?? []).map((a) => [a.training_id, a.status]))
  const myMatches = (mp.data ?? []).map((p) => ({ p, m: matches.data?.find((m) => m.id === p.match_id) })).filter((x) => x.m)
    .sort((a, b) => b.m!.date.localeCompare(a.m!.date))
  const totals = myMatches.reduce((t, { p }) => ({ goals: t.goals + p.goals, assists: t.assists + p.assists, minutes: t.minutes + p.minutes }), { goals: 0, assists: 0, minutes: 0 })
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Partidos</h3>
        <div className="grid grid-cols-4 gap-2 border-b border-ink-700 px-5 py-3 text-center text-sm">
          <div><p className="font-display text-2xl font-bold">{myMatches.length}</p><p className="text-xs text-muted">Convocado</p></div>
          <div><p className="font-display text-2xl font-bold text-brand">{totals.goals}</p><p className="text-xs text-muted">Goles</p></div>
          <div><p className="font-display text-2xl font-bold">{totals.assists}</p><p className="text-xs text-muted">Asist.</p></div>
          <div><p className="font-display text-2xl font-bold">{totals.minutes}</p><p className="text-xs text-muted">Minutos</p></div>
        </div>
        {myMatches.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">Aún no ha sido convocado a partidos.</p> : (
          <ul className="divide-y divide-ink-700">
            {myMatches.map(({ p, m }) => (
              <li key={m!.id}>
                <Link to={`/partidos/${m!.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-ink-700/50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">vs {m!.opponent} {m!.goals_for != null && <span className="text-muted">({m!.goals_for}-{m!.goals_against})</span>}</p>
                    <p className="text-xs text-muted">{date(m!.date)} · {p.starter ? 'Titular' : 'Suplente'}{p.position ? ` · ${p.position}` : ''} · {p.minutes} min</p>
                  </div>
                  {p.goals > 0 && <Badge tone="brand">{p.goals} gol{p.goals > 1 ? 'es' : ''}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Entrenamientos de su categoría</h3>
        {!trainings.data?.length ? <p className="px-5 py-8 text-center text-sm text-muted">Sin entrenamientos registrados.</p> : (
          <ul className="divide-y divide-ink-700">
            {trainings.data.slice(0, 30).map((t) => {
              const st = attMap.get(t.id)
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.objectives || 'Entrenamiento'}</p>
                    <p className="text-xs text-muted">{date(t.date, "EEE d 'de' MMM")} {time(t.start_time)}</p>
                  </div>
                  {st ? <Badge tone={ATT_TONE[st]}>{ATTENDANCE_LABEL[st]}</Badge> : <span className="text-xs text-muted">Sin lista</span>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
