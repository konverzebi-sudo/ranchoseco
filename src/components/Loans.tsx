import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { addMonths } from 'date-fns'
import { HandCoins, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Field, IconButton, Input, Modal, Textarea } from './ui'
import { useToast } from './toast'
import { InstallmentsEditor, PayInstallmentModal } from './Installments'
import { useExpenses } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, shortDate, toISODate, today } from '@/lib/format'
import { installmentsOf, isLoan, loanStatus } from '@/lib/finance'
import type { Expense, ExpenseInstallment } from '@/lib/types'

const cents = (n: number) => money(Math.round(n * 100) / 100)

/** Préstamos a Rancho Seco: quién prestó, cuánto, cuándo se le paga y cuánto falta. */
export default function LoansSection() {
  const expenses = useExpenses()
  const qc = useQueryClient()
  const toast = useToast()
  const [modal, setModal] = useState<{ loan?: Expense } | null>(null)
  const [paying, setPaying] = useState<{ expense: Expense; inst: ExpenseInstallment } | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const loans = (expenses.data ?? []).filter(isLoan).map((e) => ({ e, st: loanStatus(e) }))
    .sort((a, b) => Number(a.st.done) - Number(b.st.done) || (a.st.next?.due_date ?? '').localeCompare(b.st.next?.due_date ?? ''))
  const owed = loans.reduce((a, l) => a + l.st.remaining, 0)
  const t = today()

  const remove = async () => {
    if (!deleting) return
    try {
      unwrap(await supabase.from('expenses').delete().eq('id', deleting.id))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok('Préstamo eliminado')
      setDeleting(null)
    } catch (e) { toast.error(e) }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Préstamos a Rancho Seco</h2>
          <p className="text-sm text-muted">Quién nos prestó, cuándo le pagamos y cuánto falta. Los pagos salen en el calendario y en el Dashboard.</p>
        </div>
        <Button size="sm" icon={Plus} onClick={() => setModal({})}>Agregar préstamo</Button>
      </div>
      <Card className="mb-8 overflow-x-auto">
        <table className="table-base min-w-[720px]">
          <thead><tr><th>Quién nos prestó</th><th>Prestó</th><th>Devuelto</th><th>Falta</th><th>Siguiente pago</th><th /></tr></thead>
          <tbody>
            {loans.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-sm text-muted">Sin préstamos registrados.</td></tr>
            ) : loans.map(({ e, st }) => (
              <tr key={e.id} className={st.done ? 'opacity-60' : undefined}>
                <td><button onClick={() => setModal({ loan: e })} className="text-left font-medium hover:text-brand">{e.lender ?? e.name}</button>
                  <p className="text-xs text-muted">{e.received_on ? `Nos prestó el ${shortDate(e.received_on)}` : ''}{e.notes ? ` · ${e.notes}` : ''}</p></td>
                <td className="font-semibold">{cents(st.total)}</td>
                <td className="text-ok">{cents(st.paid)}</td>
                <td className="font-semibold text-warn">{cents(st.remaining)}</td>
                <td>{st.done ? <Badge tone="ok">Liquidado</Badge> : st.next ? (
                  <span className={st.next.due_date < t ? 'text-bad' : undefined}>{shortDate(st.next.due_date)} · {cents(Number(st.next.amount))}
                    <span className="block text-xs text-muted">{st.next.due_date < t ? 'Atrasado' : `${st.rows.filter((i) => !i.paid_on).length} pagos pendientes`}</span></span>
                ) : <span className="text-xs text-muted">Sin fechas de pago</span>}</td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    {st.next && <Button size="sm" icon={HandCoins} onClick={() => setPaying({ expense: e, inst: st.next! })}>Registrar pago</Button>}
                    <IconButton icon={Pencil} label={`Editar préstamo de ${e.lender}`} onClick={() => setModal({ loan: e })} className="h-8 w-8" />
                    <IconButton icon={Trash2} label={`Eliminar préstamo de ${e.lender}`} onClick={() => setDeleting(e)} className="h-8 w-8" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {loans.length > 0 && (
            <tfoot><tr className="bg-ink-900">
              <td colSpan={3} className="font-display text-lg font-bold uppercase">Lo que debemos</td>
              <td className="font-display text-lg font-bold text-warn">{cents(owed)}</td><td colSpan={2} />
            </tr></tfoot>
          )}
        </table>
      </Card>
      {modal && <LoanModal loan={modal.loan} onClose={() => setModal(null)} />}
      {paying && <PayInstallmentModal expense={paying.expense} inst={paying.inst} onClose={() => setPaying(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Eliminar préstamo" confirmLabel="Eliminar"
        text={<>Se eliminará el préstamo de <b className="text-white">{deleting?.lender}</b> con todos sus pagos registrados.</>} />
    </>
  )
}

function LoanModal({ loan, onClose }: { loan?: Expense; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const live = useExpenses().data?.find((x) => x.id === loan?.id) ?? loan
  const hasRows = !!(live && installmentsOf(live))
  const nextMonth = toISODate(addMonths(new Date(), 1))
  const [f, setF] = useState({
    lender: loan?.lender ?? '', amount: loan ? String(loan.amount) : '', received: loan?.received_on ?? today(),
    n: '1', first: nextMonth, notes: loan?.notes ?? '',
  })
  const [edits, setEdits] = useState<Record<number, { date?: string; amount?: string }>>({})
  const [saving, setSaving] = useState(false)
  const n = Math.max(1, Math.min(60, Math.round(Number(f.n)) || 1))
  const each = (Number(f.amount) || 0) / n
  const schedule = Array.from({ length: n }, (_, k) => {
    const e = edits[k + 1] ?? {}
    return { n: k + 1, date: e.date ?? (f.first ? toISODate(addMonths(new Date(f.first + 'T12:00:00'), k)) : ''), amount: e.amount ?? String(Math.round(each * 100) / 100) }
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.lender.trim()) return toast.error('Escribe quién nos prestó.')
    if (!hasRows && !(Number(f.amount) > 0)) return toast.error('Escribe cuánto nos prestó.')
    if (!hasRows && schedule.some((s) => !s.date || !(Number(s.amount) >= 0))) return toast.error('Revisa la fecha y el monto de cada pago.')
    setSaving(true)
    try {
      const base = { name: `Préstamo de ${f.lender.trim()}`, lender: f.lender.trim(), received_on: f.received || null, notes: f.notes.trim() || null }
      if (loan) {
        unwrap(await supabase.from('expenses').update({ ...base, ...(hasRows ? {} : { amount: Number(f.amount) }), updated_at: new Date().toISOString() }).eq('id', loan.id))
      }
      const id = loan?.id ?? (unwrap(await supabase.from('expenses').insert({
        ...base, kind: 'prestamo', amount: Number(f.amount), frequency: 'partes', down_payment: 0, installments: n,
        paid_on: schedule[0].date, paid_month: Number(schedule[0].date.slice(5, 7)), paid_year: Number(schedule[0].date.slice(0, 4)), sort_order: 999,
      }).select('id').single()) as { id: string }).id
      if (!hasRows) unwrap(await supabase.from('expense_installments').insert(schedule.map((s) => ({ expense_id: id, n: s.n, due_date: s.date, amount: Number(s.amount) }))))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.ok(loan ? 'Préstamo actualizado' : `Préstamo registrado con ${schedule.length} ${schedule.length === 1 ? 'pago' : 'pagos'} en el calendario`)
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={loan ? `Préstamo de ${loan.lender ?? ''}` : 'Agregar préstamo'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="loan-form" loading={saving}>{loan ? 'Guardar' : 'Agregar préstamo'}</Button></>}>
      <form id="loan-form" onSubmit={submit} className="space-y-4">
        <Field label="¿Quién nos prestó?"><Input value={f.lender} onChange={(e) => setF({ ...f, lender: e.target.value })} placeholder="Nombre de la persona" autoFocus={!loan} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="¿Cuánto nos prestó?"><Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} disabled={hasRows} /></Field>
          <Field label="¿Cuándo nos prestó?"><Input type="date" value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} /></Field>
        </div>
        {hasRows && live ? <InstallmentsEditor expense={live} /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="¿En cuántos pagos se le devuelve?"><Input type="number" min="1" max="60" inputMode="numeric" value={f.n} onChange={(e) => { setF({ ...f, n: e.target.value }); setEdits({}) }} /></Field>
              <Field label="¿Cuándo le pagamos? (primer pago)"><Input type="date" value={f.first} onChange={(e) => { setF({ ...f, first: e.target.value }); setEdits({}) }} /></Field>
            </div>
            {Number(f.amount) > 0 && (
              <div className="space-y-2 rounded-xl border border-brand/30 bg-brand-dim p-3 text-sm">
                <p className="text-xs text-muted">Puedes cambiar la fecha y el monto de cada pago.</p>
                {schedule.map((s) => (
                  <div key={s.n} className="grid grid-cols-[92px_1fr_110px] items-center gap-2">
                    <span className="font-medium">Pago {s.n} de {n}</span>
                    <Input type="date" value={s.date} onChange={(e) => setEdits({ ...edits, [s.n]: { ...edits[s.n], date: e.target.value } })} className="h-9" aria-label={`Fecha pago ${s.n}`} />
                    <Input type="number" min="0" inputMode="decimal" value={s.amount} onChange={(e) => setEdits({ ...edits, [s.n]: { ...edits[s.n], amount: e.target.value } })} className="h-9" aria-label={`Monto pago ${s.n}`} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Field label="Notas (opcional)"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ej. Para la compra de uniformes" /></Field>
      </form>
    </Modal>
  )
}
