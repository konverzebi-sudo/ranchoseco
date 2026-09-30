import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Button, Field, IconButton, Input, Modal, cx } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { date, money, today } from '@/lib/format'
import { installmentLabel, installmentsOf } from '@/lib/finance'
import type { Expense, ExpenseInstallment } from '@/lib/types'

const cents = (n: number) => money(Math.round(n * 100) / 100)

/** Registrar que ya se pagó una parte de un gasto (o regresarla a pendiente). */
export function PayInstallmentModal({ expense, inst, onClose }: { expense: Expense; inst: ExpenseInstallment; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const all = installmentsOf(expense) ?? [inst]
  const [paidOn, setPaidOn] = useState(inst.paid_on ?? today())
  const [amount, setAmount] = useState(String(inst.amount))
  const [notes, setNotes] = useState(inst.notes ?? '')
  const [saving, setSaving] = useState(false)
  const save = async (paid: boolean) => {
    if (paid && !(Number(amount) >= 0)) return toast.error('Escribe el monto.')
    setSaving(true)
    try {
      unwrap(await supabase.from('expense_installments').update(paid
        ? { paid_on: paidOn || today(), amount: Number(amount), notes: notes.trim() || null }
        : { paid_on: null }).eq('id', inst.id))
      await qc.invalidateQueries({ queryKey: ['expenses'] })
      const left = all.filter((x) => x.id !== inst.id && !x.paid_on).length
      toast.ok(paid ? (left ? `Pagado. Quedan ${left} ${left === 1 ? 'pago pendiente' : 'pagos pendientes'}` : `Pagado. ${expense.name} quedó liquidado`) : 'Regresó a pendiente')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={`${expense.name} · ${installmentLabel(inst, all)}`}
      footer={<>
        {inst.paid_on && <Button variant="ghost" icon={RotateCcw} className="mr-auto" onClick={() => save(false)} loading={saving}>Marcar como pendiente</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={Check} onClick={() => save(true)} loading={saving}>{inst.paid_on ? 'Guardar' : 'Ya se pagó'}</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Tocaba pagar el <b className="text-white">{date(inst.due_date)}</b> · {cents(Number(inst.amount))}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="¿Qué día se pagó?"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Monto pagado"><Input type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        </div>
        <Field label="Nota (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Se pagó en efectivo" /></Field>
        <InstallmentList expense={expense} highlight={inst.id} />
      </div>
    </Modal>
  )
}

/** Resumen de todas las partes de un gasto: pagadas y pendientes. */
export function InstallmentList({ expense, highlight, onPick }: { expense: Expense; highlight?: string; onPick?: (i: ExpenseInstallment) => void }) {
  const all = installmentsOf(expense) ?? []
  if (!all.length) return null
  const paid = all.filter((i) => i.paid_on).reduce((a, i) => a + Number(i.amount), 0)
  const total = all.reduce((a, i) => a + Number(i.amount), 0)
  return (
    <div className="rounded-xl border border-ink-600">
      <p className="border-b border-ink-700 px-3 py-2 text-xs text-muted">Pagado <b className="text-ok">{cents(paid)}</b> de {cents(total)} · falta <b className="text-warn">{cents(total - paid)}</b></p>
      <ul className="divide-y divide-ink-700">
        {all.map((i) => (
          <li key={i.id}>
            <button type="button" disabled={!onPick} onClick={() => onPick?.(i)}
              className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', highlight === i.id && 'bg-brand-dim', onPick && 'hover:bg-ink-700')}>
              <span className="flex-1">{installmentLabel(i, all)} · {date(i.paid_on ?? i.due_date, 'd MMM yyyy')}</span>
              <span className="font-semibold">{cents(Number(i.amount))}</span>
              {i.paid_on ? <Badge tone="ok">Pagado</Badge> : <Badge tone={i.due_date < today() ? 'bad' : 'warn'}>{i.due_date < today() ? 'Atrasado' : 'Pendiente'}</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Editar las fechas y montos de cada parte de un gasto ya registrado. */
export function InstallmentsEditor({ expense }: { expense: Expense }) {
  const qc = useQueryClient()
  const toast = useToast()
  const all = installmentsOf(expense) ?? []
  const [paying, setPaying] = useState<ExpenseInstallment | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['expenses'] })
  const patch = async (i: ExpenseInstallment, p: Partial<ExpenseInstallment>) => {
    try {
      unwrap(await supabase.from('expense_installments').update(p).eq('id', i.id))
      await refresh()
    } catch (e) { toast.error(e) }
  }
  const add = async () => {
    const last = all.at(-1)
    const next = last ? new Date(last.due_date + 'T12:00:00') : new Date()
    next.setMonth(next.getMonth() + 1)
    try {
      unwrap(await supabase.from('expense_installments').insert({ expense_id: expense.id, n: (last?.n ?? 0) + 1, due_date: next.toISOString().slice(0, 10), amount: Number(last?.amount ?? 0) }))
      await refresh()
    } catch (e) { toast.error(e) }
  }
  const remove = async (i: ExpenseInstallment) => {
    try {
      unwrap(await supabase.from('expense_installments').delete().eq('id', i.id))
      await refresh()
    } catch (e) { toast.error(e) }
  }
  const total = all.reduce((a, i) => a + Number(i.amount), 0)
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Pagos <span className="font-normal text-muted">· total {cents(total)}</span></p>
      {all.map((i) => (
        <div key={i.id} className="grid grid-cols-[88px_1fr_110px_auto] items-center gap-2 rounded-xl border border-ink-600 p-2 text-sm">
          <span className="font-medium">{installmentLabel(i, all)}</span>
          <Input type="date" defaultValue={i.due_date} aria-label="Fecha programada" className="h-9"
            onBlur={(e) => e.target.value && e.target.value !== i.due_date && patch(i, { due_date: e.target.value })} />
          <Input type="number" min="0" inputMode="decimal" defaultValue={String(i.amount)} aria-label="Monto" className="h-9"
            onBlur={(e) => Number(e.target.value) >= 0 && Number(e.target.value) !== Number(i.amount) && patch(i, { amount: Number(e.target.value) })} />
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPaying(i)} title={i.paid_on ? 'Ver o deshacer pago' : 'Registrar pago'}>
              {i.paid_on ? <Badge tone="ok" className="cursor-pointer">Pagado {date(i.paid_on, 'd/M')}</Badge> : <Badge tone="warn" className="cursor-pointer underline decoration-dotted">Pagar</Badge>}
            </button>
            {!i.paid_on && <IconButton icon={Trash2} label="Quitar este pago" onClick={() => remove(i)} className="h-8 w-8" />}
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" icon={Plus} onClick={add}>Agregar otro pago</Button>
      {paying && <PayInstallmentModal expense={expense} inst={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}
