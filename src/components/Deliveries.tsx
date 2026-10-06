import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, PackageCheck, Wallet } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, cx } from './ui'
import { useToast } from './toast'
import { TeamSelect } from './Team'
import { PaymentModal } from './PaymentForms'
import { useFees, useStudents, type StudentRow } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { date, money, today, toISODate } from '@/lib/format'
import { getActor } from '@/lib/actor'
import { startOfMonth } from 'date-fns'
import type { FeeBalance } from '@/lib/types'

export type Item = 'uniforme' | 'playera' | 'credencial'
export const ITEMS: Record<Item, { key: 'uniform_delivered_on' | 'training_shirt_delivered_on' | 'credential_delivered_on'; label: string; concept: string; price: number | null; match: RegExp }> = {
  uniforme: { key: 'uniform_delivered_on', label: 'Uniforme', concept: 'Uniforme', price: null, match: /^uniforme|alta en chivas/i },
  playera: { key: 'training_shirt_delivered_on', label: 'Playera de entrenamiento', concept: 'Playera de entrenamiento', price: 250, match: /playera/i },
  credencial: { key: 'credential_delivered_on', label: 'Credencial', concept: 'Credencial Chivas', price: 150, match: /credencial|alta en chivas/i },
}
/** Sólo en octubre 2026: entregas que ya se habían pagado antes de usar la plataforma. */
const PRE_PLATFORM_UNTIL = '2026-10-31'
const PAY_LABEL = { pagado: 'Pagado', adeudo: 'Sin pagar (adeudo)', previo: 'Pagado antes de la plataforma' } as const

export interface Delivery {
  id: string; student_id: string; item: Item; delivered_on: string; delivered_by: string | null
  payment: 'pagado' | 'adeudo' | 'previo'; fee_id: string | null; notes: string | null; created_at: string
}

export function useDeliveries() {
  return useQuery({
    queryKey: ['deliveries'],
    queryFn: async () => {
      const r = await supabase.from('deliveries').select('*').order('delivered_on', { ascending: false })
      return r.error ? [] : (r.data as Delivery[])
    },
  })
}

/** ¿Ya se pagó esto? Busca los cargos de ese concepto del niño. */
export function payStatus(fees: FeeBalance[], studentId: string, item: Item) {
  const mine = fees.filter((f) => f.student_id === studentId && ITEMS[item].match.test(f.concept))
  const paid = mine.find((f) => Number(f.paid) > 0 && Number(f.balance) <= 0.001)
  const unpaid = mine.find((f) => Number(f.balance) > 0.001)
  return { paid, unpaid }
}

/** Casilla de entrega: al palomear revisa el pago y pregunta quién lo entregó. */
export function DeliveryCheck({ student, item, compact }: { student: StudentRow; item: Item; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [undo, setUndo] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  const deliveries = useDeliveries()
  const d = ITEMS[item]
  const on = student[d.key]
  const last = (deliveries.data ?? []).find((x) => x.student_id === student.id && x.item === item)

  const remove = async () => {
    try {
      const rows = (deliveries.data ?? []).filter((x) => x.student_id === student.id && x.item === item)
      for (const r of rows) {
        // Si se entregó sin pagar y nadie ha abonado, se quita también ese adeudo
        if (r.payment === 'adeudo' && r.fee_id) {
          const pays = unwrap(await supabase.from('payments').select('id').eq('fee_id', r.fee_id)) as { id: string }[]
          if (!pays.length) unwrap(await supabase.from('fees').delete().eq('id', r.fee_id))
        }
      }
      if (rows.length) unwrap(await supabase.from('deliveries').delete().in('id', rows.map((r) => r.id)))
      unwrap(await supabase.from('students').update({ [d.key]: null }).eq('id', student.id))
      await Promise.all(['students', 'student', 'deliveries', 'fees', 'accounts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Se quitó la entrega')
      setUndo(false)
    } catch (e) { toast.error(e) }
  }

  return (
    <>
      <label className={cx('flex cursor-pointer items-center gap-1.5 whitespace-nowrap', compact ? 'text-xs' : 'text-sm')}>
        <input type="checkbox" checked={!!on} onChange={(e) => (e.target.checked ? setOpen(true) : setUndo(true))} className="h-5 w-5 accent-[#22C55E]" aria-label={`${d.label} de ${student.full_name}`} />
        {on
          ? <span className={last?.payment === 'adeudo' ? 'text-bad' : 'text-ok'} title={last ? `Entregó ${last.delivered_by ?? '—'} · ${PAY_LABEL[last.payment]}` : undefined}>
              {compact ? '' : `${d.label} · `}{date(on, 'd MMM')}{last?.payment === 'adeudo' ? ' · debe' : ''}
            </span>
          : <span className="text-muted">{compact ? 'Pendiente' : d.label}</span>}
      </label>
      {open && <DeliverModal student={student} item={item} onClose={() => setOpen(false)} />}
      <ConfirmDialog open={undo} onClose={() => setUndo(false)} onConfirm={remove} danger title="Quitar la entrega" confirmLabel="Quitar"
        text={`¿Quitar la entrega de ${d.label.toLowerCase()} a ${student.full_name}?${last?.payment === 'adeudo' ? ' Si no ha abonado nada, también se quita el adeudo.' : ''}`} />
    </>
  )
}

function DeliverModal({ student, item, onClose }: { student: StudentRow; item: Item; onClose: () => void }) {
  const fees = useFees()
  const qc = useQueryClient()
  const toast = useToast()
  const d = ITEMS[item]
  const st = useMemo(() => payStatus(fees.data ?? [], student.id, item), [fees.data, student.id, item])
  const [who, setWho] = useState(getActor)
  const [on, setOn] = useState(today())
  const [mode, setMode] = useState<'pagar' | 'adeudo' | 'previo'>('pagar')
  const [amount, setAmount] = useState(() => String(st.unpaid ? st.unpaid.balance : d.price ?? ''))
  const [notes, setNotes] = useState('')
  const [paying, setPaying] = useState(false)
  const [saving, setSaving] = useState(false)
  const canPrevio = today() <= PRE_PLATFORM_UNTIL

  const record = async (payment: 'pagado' | 'adeudo' | 'previo', feeId: string | null) => {
    unwrap(await supabase.from('deliveries').insert({ student_id: student.id, item, delivered_on: on, delivered_by: who, payment, fee_id: feeId, notes: notes.trim() || null }))
    unwrap(await supabase.from('students').update({ [d.key]: on }).eq('id', student.id))
    await Promise.all(['students', 'student', 'deliveries', 'fees', 'accounts', 'payments'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  }

  const save = async () => {
    if (!who) return toast.error('Escoge quién lo entregó.')
    setSaving(true)
    try {
      if (st.paid && !st.unpaid) await record('pagado', st.paid.id)
      else if (mode === 'previo') await record('previo', null)
      else if (mode === 'adeudo') {
        let feeId = st.unpaid?.id ?? null
        if (!feeId) {
          const n = Number(amount)
          if (!(n > 0)) { setSaving(false); return toast.error(`Escribe cuánto cuesta ${d.label.toLowerCase()}.`) }
          const period = toISODate(startOfMonth(new Date(on + 'T12:00:00')))
          const fee = unwrap(await supabase.from('fees').insert({ student_id: student.id, concept: d.concept, period, amount: n, due_date: on, notes: `Entregado sin pagar el ${date(on)} (entregó ${who})` }).select('id').single()) as { id: string }
          feeId = fee.id
        }
        await record('adeudo', feeId)
      } else return setPaying(true)
      toast.ok(`${d.label} entregado a ${student.full_name.split(' ')[0]}`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  if (paying) {
    return <PaymentModal student={student} feeId={st.unpaid?.id} preset={st.unpaid ? [] : [d.concept]} presetAmount={st.unpaid ? undefined : amount}
      onClose={() => setPaying(false)}
      onPaid={async () => {
        try {
          await record('pagado', null)
          toast.ok(`Pago registrado y ${d.label.toLowerCase()} entregado`)
          onClose()
        } catch (e) { toast.error(e) }
      }} />
  }

  const isPaid = !!st.paid && !st.unpaid
  return (
    <Modal open onClose={onClose} title={`Entregar ${d.label.toLowerCase()} · ${student.full_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={isPaid || mode !== 'pagar' ? PackageCheck : Wallet} loading={saving} onClick={save}>
          {isPaid ? 'Registrar entrega' : mode === 'pagar' ? 'Registrar el pago' : mode === 'adeudo' ? 'Entregar sin pagar' : 'Registrar entrega'}
        </Button></>}>
      <div className="space-y-4">
        {isPaid ? (
          <p className="flex items-start gap-2 rounded-xl border border-ok/50 bg-ok/10 p-3 text-sm"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
            <span>Ya está pagado: <b>{st.paid!.concept}</b> ({money(st.paid!.total_due)}). Sólo falta anotar quién lo entregó.</span></p>
        ) : (
          <>
            <p className="flex items-start gap-2 rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
              <span>{st.unpaid ? <>Tiene un cargo de <b>{st.unpaid.concept}</b> y debe <b>{money(st.unpaid.balance)}</b>.</> : <>No tiene registrado ningún pago de <b>{d.label.toLowerCase()}</b>.</>} ¿Qué hacemos?</span></p>
            <div className="space-y-2">
              {([
                ['pagar', 'Registrar el pago ahora', 'Se abre el registro de pagos (el mismo de siempre) y al guardar queda entregado.'],
                ['adeudo', 'Entregar sin pagar', 'Queda como adeudo del niño y sale en el Dashboard hasta que lo pague.'],
                ...(canPrevio ? [['previo', 'Ya lo había pagado antes de esta plataforma', 'Sólo octubre: se registra la entrega sin mover el dinero (ya entró antes).']] : []),
              ] as [typeof mode, string, string][]).map(([k, t, h]) => (
                <label key={k} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm', mode === k ? 'border-brand bg-brand-dim' : 'border-ink-600')}>
                  <input type="radio" name="modo" checked={mode === k} onChange={() => setMode(k)} className="mt-1 h-4 w-4 accent-[#F2E30A]" />
                  <span><b>{t}</b><span className="block text-xs text-muted">{h}</span></span>
                </label>
              ))}
            </div>
            {(mode === 'adeudo' || mode === 'pagar') && !st.unpaid && (
              <Field label={`¿Cuánto cuesta ${d.label.toLowerCase()}?`}><Input type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" /></Field>
            )}
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="¿Quién lo entregó? *"><TeamSelect value={who} onChange={setWho} /></Field>
          <Field label="Fecha de entrega"><Input type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value || today())} /></Field>
        </div>
        <Field label="Nota (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. talla 10, se la llevó el papá" /></Field>
      </div>
    </Modal>
  )
}

/** Historial de entregas de un niño (ficha del alumno). */
export function DeliveryHistory({ studentId }: { studentId: string }) {
  const deliveries = useDeliveries()
  const list = (deliveries.data ?? []).filter((x) => x.student_id === studentId)
  if (!list.length) return null
  return (
    <ul className="mt-2 space-y-1 text-xs text-muted">
      {list.map((x) => (
        <li key={x.id}>{ITEMS[x.item].label}: entregado el {date(x.delivered_on)}{x.delivered_by ? ` por ${x.delivered_by}` : ''} · <span className={x.payment === 'adeudo' ? 'text-bad' : 'text-ok'}>{PAY_LABEL[x.payment]}</span>{x.notes ? ` · ${x.notes}` : ''}</li>
      ))}
    </ul>
  )
}

/** Dashboard: lo que se entregó y todavía no se paga. */
export function UnpaidDeliveries() {
  const deliveries = useDeliveries()
  const fees = useFees()
  const students = useStudents()
  const [paying, setPaying] = useState<{ s: StudentRow; feeId: string } | null>(null)
  const rows = (deliveries.data ?? []).filter((x) => x.payment === 'adeudo').map((x) => ({ x, fee: fees.data?.find((f) => f.id === x.fee_id), s: students.data?.find((s) => s.id === x.student_id) }))
    .filter((r) => r.s && (!r.fee || Number(r.fee.balance) > 0.001))
  if (!rows.length) return null
  return (
    <Card className="border-bad/50">
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <AlertTriangle className="h-5 w-5 text-bad" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Entregados sin pagar</h2>
        <Badge tone="bad">{rows.length}</Badge>
      </div>
      <ul className="max-h-72 divide-y divide-ink-700 overflow-y-auto">
        {rows.map(({ x, fee, s }) => (
          <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-0 flex-1"><Link to={`/alumnos/${s!.id}`} className="font-semibold hover:text-brand">{s!.full_name}</Link>
              <span className="block text-xs text-muted">{ITEMS[x.item].label} · entregado el {date(x.delivered_on, 'd MMM')}{x.delivered_by ? ` por ${x.delivered_by}` : ''}</span></span>
            <span className="font-semibold text-bad">{fee ? money(fee.balance) : '—'}</span>
            {fee && <Button size="sm" icon={Wallet} onClick={() => setPaying({ s: s!, feeId: fee.id })}>Cobrar</Button>}
          </li>
        ))}
      </ul>
      {paying && <PaymentModal student={paying.s} feeId={paying.feeId} onClose={() => setPaying(null)} />}
    </Card>
  )
}
