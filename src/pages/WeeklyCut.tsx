import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { startOfWeek } from 'date-fns'
import { TrendingUp, TrendingDown, Scale, Banknote, Download, MessageCircle, Printer, Plus, Trash2, Vault, PiggyBank } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, IconButton, Input, Modal, PageHeader, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCashCuts, useCoachPay, useCoaches, useExpenses, useFees, usePayments, useStudents } from '@/lib/api'
import { CARRY_DESTINATION, DESTINATIONS, carryOver, nextPeriodStart, periodSummary } from '@/lib/cashcut'
import { METHOD_LABEL, date, money, toISODate, today } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'
import { exportCsv } from '@/lib/csv'
import type { CashCut } from '@/lib/types'

const cents = (n: number) => money(Math.round(n * 100) / 100)
const range = (from: string, to: string) => `${date(from, "d 'de' MMM")} al ${date(to, "d 'de' MMM yyyy")}`

/**
 * Corte de caja: normalmente el miércoles, cuando se paga a los profes.
 * Va del día siguiente al último corte hasta el día del corte: lo que entró,
 * lo que salió, cuánto se contó en caja y a dónde se fue el dinero.
 */
export default function WeeklyCut() {
  const [params, setParams] = useSearchParams()
  const cuts = useCashCuts()
  const payments = usePayments()
  const fees = useFees()
  const students = useStudents()
  const expenses = useExpenses()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const [making, setMaking] = useState(false)
  const [deleting, setDeleting] = useState<CashCut | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const t = today()
  const defaultFrom = nextPeriodStart(cuts.data ?? [], toISODate(startOfWeek(new Date(), { weekStartsOn: 1 })))
  const from = params.get('desde') ?? defaultFrom
  const to = params.get('hasta') ?? t
  const setRange = (k: 'desde' | 'hasta', v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }) }
  const prev = (cuts.data ?? []).find((c) => c.period_to < from)
  const carry = carryOver(prev)

  const d = useMemo(() => periodSummary({
    from, to, payments: payments.data ?? [], fees: fees.data ?? [],
    names: new Map((students.data ?? []).map((s) => [s.id, s.full_name])),
    expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [],
  }), [from, to, payments.data, fees.data, students.data, expenses.data, coaches.data, pay.data])
  const expected = carry + d.net

  // Acumulado por destino (p. ej. cuánto se ha guardado en el ahorro de Chivas)
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cuts.data ?? []) for (const x of c.distribution) if (x.to.toLowerCase() !== CARRY_DESTINATION.toLowerCase()) m.set(x.to, (m.get(x.to) ?? 0) + Number(x.amount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [cuts.data])

  const doExport = () => exportCsv(`corte-${from}-al-${to}.csv`, ['Tipo', 'Fecha', 'Concepto', 'Alumno / detalle', 'Forma de pago', 'Monto'], [
    ...d.ins.map((p) => ['Entrada', p.day, p.concept, p.student, METHOD_LABEL[p.method], Number(p.amount)]),
    ...d.loans.map((e) => ['Entrada', e.received_on ?? '', 'Préstamo', e.lender ?? '', '', Number(e.amount)]),
    ...d.outs.map((e) => ['Salida', e.date, e.name, e.detail, '', -e.amount]),
    ['TOTAL', '', '', '', '', d.net],
  ])
  const remove = async () => {
    if (!deleting) return
    try {
      unwrap(await supabase.from('cash_cuts').delete().eq('id', deleting.id))
      await qc.invalidateQueries({ queryKey: ['cash_cuts'] })
      toast.ok('Corte eliminado')
      setDeleting(null)
    } catch (e) { toast.error(e) }
  }

  const error = cuts.error || payments.error || expenses.error
  if (error) return <ErrorState error={error} onRetry={() => { cuts.refetch(); payments.refetch() }} />
  const loading = cuts.isLoading || payments.isLoading || fees.isLoading || students.isLoading || expenses.isLoading || coaches.isLoading

  return (
    <>
      <PageHeader title="Corte de caja" subtitle="Se hace cuando se paga a los profes (normalmente el miércoles): qué entró, qué salió, cuánto hay en caja y a dónde se va."
        actions={<>
          <Button variant="secondary" icon={Download} onClick={doExport} disabled={loading}>Exportar</Button>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()} className="hidden sm:inline-flex">Imprimir</Button>
          <Button icon={Vault} onClick={() => setMaking(true)} disabled={loading}>Hacer corte</Button>
        </>} />

      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4">
        <Field label="Desde"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setRange('desde', e.target.value)} className="h-10" /></Field>
        <Field label="Hasta (día del corte)"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setRange('hasta', e.target.value)} className="h-10" /></Field>
        <p className="pb-2 text-sm text-muted">{prev ? <>Último corte: <b className="text-white">{date(prev.cut_date)}</b> · se quedaron {cents(carry)} en caja chica</> : 'Todavía no hay cortes: el primero empieza este lunes.'}</p>
        {(params.get('desde') || params.get('hasta')) && <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>Desde el último corte</Button>}
      </Card>

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Entró" value={cents(d.inTotal)} icon={TrendingUp} tone="ok" hint={`${d.ins.length} cobros${d.loansIn ? ` + préstamos ${cents(d.loansIn)}` : ''}`} />
            <StatCard label="Salió" value={cents(d.outTotal)} icon={TrendingDown} tone="bad" hint="Sueldos, gastos y pagos de préstamos" />
            <StatCard label="Queda del periodo" value={cents(d.net)} icon={Scale} tone={d.net >= 0 ? 'ok' : 'bad'} hint="Entró − salió" />
            <StatCard label="Debería haber en caja" value={cents(expected)} icon={Banknote} tone="brand" hint={`Caja chica anterior ${cents(carry)} + lo que queda`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SummaryTable title="Entradas por forma de pago" rows={d.byMethod.map(([m, r]) => [METHOD_LABEL[m], r.n, r.total])} />
            <SummaryTable title="Entradas por concepto" rows={[...d.byKind.map(([k, r]) => [k, r.n, r.total] as [string, number, number]), ...(d.loansIn ? [['Préstamos recibidos', d.loans.length, d.loansIn] as [string, number, number]] : [])]} />
          </div>

          <Card className="overflow-x-auto">
            <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Salidas del periodo</h3>
            <table className="table-base min-w-[520px]">
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {d.outs.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-muted">Sin salidas en estas fechas.</td></tr> : d.outs.map((e, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{date(e.date, 'EEE d MMM')}</td>
                    <td className="font-medium">{e.name}</td>
                    <td><Badge tone={e.kind === 'sueldo' ? 'brand' : e.kind === 'fijo' ? 'neutral' : 'warn'}>{e.detail}</Badge></td>
                    <td className="text-right font-semibold">{cents(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-ink-900"><td colSpan={3} className="font-display text-lg font-bold uppercase">Total salidas</td><td className="text-right font-display text-lg font-bold text-bad">{cents(d.outTotal)}</td></tr></tfoot>
            </table>
            <p className="px-5 py-3 text-xs text-muted">Sueldos semanales cada miércoles · gastos mensuales el día 1 · gastos del mes y pagos en partes el día que se pagaron. Se editan en <Link to="/gastos" className="text-brand hover:underline">Gastos</Link>.</p>
          </Card>

          <Card className="overflow-x-auto">
            <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Cobros del periodo ({d.ins.length})</h3>
            <table className="table-base min-w-[620px]">
              <thead><tr><th>Fecha</th><th>Alumno</th><th>Concepto</th><th>Forma de pago</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {d.ins.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-muted">Sin cobros en estas fechas.</td></tr> : d.ins.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{date(p.day, 'EEE d MMM')}</td>
                    <td><Link to={`/alumnos/${p.student_id}?tab=pagos`} className="hover:text-brand">{p.student}</Link></td>
                    <td className="text-sm text-muted">{p.concept}</td>
                    <td>{METHOD_LABEL[p.method]}</td>
                    <td className="text-right font-semibold">{cents(Number(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totals.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><PiggyBank className="h-5 w-5 text-brand" /> Acumulado por destino (todos los cortes)</h3>
              <div className="flex flex-wrap gap-3">
                {totals.map(([k, v]) => <div key={k} className="rounded-xl border border-ink-600 px-4 py-2"><p className="text-xs uppercase tracking-wider text-muted">{k}</p><p className="font-display text-2xl font-bold">{cents(v)}</p></div>)}
              </div>
            </Card>
          )}

          <div>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Cortes anteriores</h2>
            {!cuts.data?.length ? <Card className="p-6 text-center text-sm text-muted">Aún no hay cortes. Pica <b>Hacer corte</b> cuando pagues a los profes.</Card> : (
              <div className="space-y-3">
                {cuts.data.map((c) => <CutCard key={c.id} cut={c} onDelete={() => setDeleting(c)} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {making && <CutModal from={from} to={to} summary={d} carry={carry} onClose={() => setMaking(false)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Eliminar corte" confirmLabel="Eliminar"
        text={deleting ? `Se eliminará el corte del ${date(deleting.cut_date)}. Los pagos y gastos no se borran.` : null} />
    </>
  )
}

function SummaryTable({ title, rows }: { title: string; rows: [string, number, number][] }) {
  return (
    <Card>
      <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">{title}</h3>
      <table className="table-base">
        <tbody>
          {rows.length === 0 ? <tr><td className="py-6 text-center text-muted">Sin cobros en estas fechas.</td></tr> :
            rows.map(([k, n, total]) => <tr key={k}><td className="font-medium">{k}</td><td className="text-muted">{n} {n === 1 ? 'pago' : 'pagos'}</td><td className="text-right font-semibold">{cents(total)}</td></tr>)}
        </tbody>
      </table>
    </Card>
  )
}

const shareText = (c: Pick<CashCut, 'cut_date' | 'period_from' | 'period_to' | 'income' | 'outflow' | 'counted' | 'distribution' | 'notes'>) => [
  '*Corte de caja Rancho Seco*', `${date(c.cut_date, "EEEE d 'de' MMMM")} · del ${range(c.period_from, c.period_to)}`, '',
  `Entró: ${cents(Number(c.income))}`, `Salió: ${cents(Number(c.outflow))}`, `*Contado en caja: ${cents(Number(c.counted))}*`, '',
  'A dónde se fue:', ...c.distribution.map((x) => `  · ${x.to}: ${cents(Number(x.amount))}`),
  ...(c.notes ? ['', c.notes] : []),
].join('\n')

function CutCard({ cut: c, onDelete }: { cut: CashCut; onDelete: () => void }) {
  const assigned = c.distribution.reduce((a, x) => a + Number(x.amount), 0)
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold uppercase">{date(c.cut_date, "EEEE d 'de' MMMM")}</p>
          <p className="text-xs text-muted">Del {range(c.period_from, c.period_to)}</p>
        </div>
        <div className="flex gap-5 text-sm">
          <span>Entró <b className="text-ok">{cents(Number(c.income))}</b></span>
          <span>Salió <b className="text-bad">{cents(Number(c.outflow))}</b></span>
          <span>Contado <b className="text-brand">{cents(Number(c.counted))}</b></span>
        </div>
        <div className="flex gap-1">
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText(c))}`} target="_blank" rel="noopener noreferrer" aria-label="Enviar por WhatsApp"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-wa hover:bg-ink-700"><MessageCircle className="h-4 w-4" /></a>
          <IconButton icon={Trash2} label="Eliminar corte" onClick={onDelete} className="h-8 w-8" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.distribution.map((x, i) => <Badge key={i} tone={x.to.toLowerCase() === CARRY_DESTINATION.toLowerCase() ? 'brand' : 'neutral'}>{x.to} · {cents(Number(x.amount))}</Badge>)}
        {Math.abs(Number(c.counted) - assigned) > 0.5 && <Badge tone="warn">Sin asignar {cents(Number(c.counted) - assigned)}</Badge>}
      </div>
      {c.notes && <p className="mt-2 text-sm text-muted">{c.notes}</p>}
    </Card>
  )
}

function CutModal({ from, to, summary: d, carry, onClose }: { from: string; to: string; summary: ReturnType<typeof periodSummary>; carry: number; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const expected = Math.round((carry + d.net) * 100) / 100
  const [cutDate, setCutDate] = useState(to)
  const [counted, setCounted] = useState(String(Math.max(0, expected)))
  const [rows, setRows] = useState<{ to: string; amount: string }[]>([{ to: CARRY_DESTINATION, amount: String(Math.max(0, expected)) }])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const assigned = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const left = (Number(counted) || 0) - assigned
  const diff = (Number(counted) || 0) - expected
  const setRow = (i: number, p: Partial<{ to: string; amount: string }>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))

  const save = async () => {
    if (!(Number(counted) >= 0)) return toast.error('Escribe cuánto dinero se contó.')
    const distribution = rows.filter((r) => r.to.trim() && Number(r.amount) > 0).map((r) => ({ to: r.to.trim(), amount: Number(r.amount) }))
    setSaving(true)
    try {
      unwrap(await supabase.from('cash_cuts').insert({
        cut_date: cutDate || to, period_from: from, period_to: to, income: d.inTotal, outflow: d.outTotal,
        counted: Number(counted), distribution, notes: notes.trim() || null,
      }))
      await qc.invalidateQueries({ queryKey: ['cash_cuts'] })
      toast.ok('Corte guardado. El siguiente empieza mañana.')
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Hacer corte de caja"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={Vault} onClick={save} loading={saving}>Guardar corte</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-ink-900 p-3 text-sm">
          <p className="text-muted">Del {range(from, to)}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <span>Caja chica anterior</span><b className="text-right">{cents(carry)}</b>
            <span>+ Entró</span><b className="text-right text-ok">{cents(d.inTotal)}</b>
            <span>− Salió</span><b className="text-right text-bad">{cents(d.outTotal)}</b>
            <span className="font-semibold">= Debería haber</span><b className="text-right text-brand">{cents(expected)}</b>
          </div>
          <p className="mt-2 text-xs text-muted">Incluye cobros por transferencia. Si esos no están en efectivo, cuéntalos aparte o mándalos a "Banco".</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha del corte"><Input type="date" value={cutDate} onChange={(e) => setCutDate(e.target.value)} /></Field>
          <Field label="¿Cuánto dinero hay? (contado)" hint={Math.abs(diff) > 0.5 ? `${diff > 0 ? 'Sobran' : 'Faltan'} ${cents(Math.abs(diff))} contra lo esperado` : 'Cuadra con lo esperado'}>
            <Input type="number" min="0" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">¿A dónde se va el dinero?</p>
          <datalist id="cut-destinations">{DESTINATIONS.map((x) => <option key={x} value={x} />)}</datalist>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_130px_auto] gap-2">
                <Input value={r.to} onChange={(e) => setRow(i, { to: e.target.value })} list="cut-destinations" placeholder="Ej. Ahorro Chivas" aria-label="Destino" className="h-10" />
                <Input type="number" min="0" inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} aria-label="Monto" className="h-10" />
                <IconButton icon={Trash2} label="Quitar" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="h-10 w-10" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows([...rows, { to: '', amount: left > 0 ? String(Math.round(left * 100) / 100) : '' }])}>Agregar destino</Button>
            <span className={cx('text-sm', Math.abs(left) > 0.5 ? 'text-warn' : 'text-ok')}>{Math.abs(left) > 0.5 ? `${left > 0 ? 'Falta asignar' : 'Te pasaste por'} ${cents(Math.abs(left))}` : 'Todo asignado ✓'}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Lo que pongas en "{CARRY_DESTINATION}" se queda en caja y es con lo que empieza el siguiente corte.</p>
        </div>
        <Field label="Notas (opcional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Se pagó a los profes en efectivo" /></Field>
      </div>
    </Modal>
  )
}
