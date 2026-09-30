import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { startOfWeek } from 'date-fns'
import { TrendingUp, TrendingDown, Scale, Banknote, Download, MessageCircle, Printer, Plus, Trash2, Vault, PiggyBank, Check, Pencil, CheckCheck, X } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, IconButton, Input, Modal, PageHeader, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCashCuts, useCoachPay, useCoaches, useExpenses, useFees, usePayments, useStudents } from '@/lib/api'
import {
  CARRY_DESTINATION, DESTINATIONS, OUT_GROUPS, buildItems, carryOver, counts, itemTotals, itemValue, nextPeriodStart, outGroup, periodSummary, savingFunds,
  type CutItem, type SavingFund,
} from '@/lib/cashcut'
import { METHOD_LABEL, date, money, toISODate, today } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'
import { exportCsv } from '@/lib/csv'
import { waLink } from '@/lib/whatsapp'
import type { CashCut, PaymentMethod } from '@/lib/types'

const cents = (n: number) => money(Math.round(n * 100) / 100)
const range = (from: string, to: string) => `${date(from, "d 'de' MMM")} al ${date(to, "d 'de' MMM yyyy")}`
const FUND_LABEL: Record<SavingFund['kind'], string> = { fijo: 'Gasto fijo', seguro: 'Seguro anual', parte: 'Pago pendiente', prestamo: 'Préstamo' }
/** A quién se le manda el reporte de cada corte por WhatsApp. */
const REPORT_TO = [
  { name: 'Marco DL', phone: '528442713705' },
  { name: 'Junior DR', phone: '528444958824' },
]

const SOURCE_PREFIX = 'Vino de: '
const SOURCES = ['Préstamo de ', 'Dinero del dueño', 'Ahorro apartado', 'Banco', 'Caja chica de otro lado', 'Otro']

type Review = Record<string, { approved?: boolean; adjusted?: number | null; note?: string; excluded?: boolean }>

/**
 * Corte de caja (normalmente el miércoles, cuando se paga a los profes):
 * 1) se revisa cada entrada y salida con ✓ (y se corrige con nota si hace falta),
 * 2) se decide cuánto apartar para los pagos grandes que vienen,
 * 3) se cuenta la caja y se dice a dónde se va el dinero.
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
  const qc = useQueryClient()
  const toast = useToast()
  const [deleting, setDeleting] = useState<CashCut | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [editingCut, setEditingCut] = useState<CashCut | null>(null)
  const [sent, setSent] = useState<CashCut | null>(null)

  const t = today()
  const defaultFrom = nextPeriodStart(cuts.data ?? [], toISODate(startOfWeek(new Date(), { weekStartsOn: 1 })))
  const from = params.get('desde') ?? defaultFrom
  const to = params.get('hasta') ?? t
  const setRange = (k: 'desde' | 'hasta', v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }) }
  const prev = (cuts.data ?? []).find((c) => c.period_to < from && c.id !== editingCut?.id)
  const carry = carryOver(prev)

  const d = useMemo(() => periodSummary({
    from, to, payments: payments.data ?? [], fees: fees.data ?? [],
    names: new Map((students.data ?? []).map((s) => [s.id, s.full_name])),
    expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [],
  }), [from, to, payments.data, fees.data, students.data, expenses.data, coaches.data, pay.data])

  // Revisión de líneas (✓, monto corregido, nota)
  const [review, setReview] = useState<Review>({})
  const [editing, setEditing] = useState<string | null>(null)
  const items: CutItem[] = useMemo(() => buildItems(d).map((i) => ({ ...i, ...review[i.key] }) as CutItem), [d, review])
  const tot = itemTotals(items)
  const setItem = (key: string, p: Review[string]) => setReview((r) => ({ ...r, [key]: { ...r[key], ...p } }))
  const approveAll = (type: CutItem['type'], approved: boolean) => setReview((r) => {
    const n = { ...r }
    for (const i of items.filter((x) => x.type === type)) n[i.key] = { ...n[i.key], approved }
    return n
  })

  // Sugerencias de ahorro
  const funds = useMemo(() => savingFunds({ cutDate: to, expenses: expenses.data ?? [], cuts: cuts.data ?? [], excludeCut: editingCut?.id }), [to, expenses.data, cuts.data, editingCut])
  const [saveAmt, setSaveAmt] = useState<Record<string, string>>({})
  const [saveNote, setSaveNote] = useState<Record<string, string>>({})
  const savedNow = (f: SavingFund) => (f.key in saveAmt ? Number(saveAmt[f.key]) || 0 : 0)
  const savingsTotal = funds.reduce((a, f) => a + savedNow(f), 0)
  const suggestedTotal = funds.reduce((a, f) => a + f.suggested, 0)
  // Lo apartado en cortes anteriores para pagos que todavía no se hacen
  const savedBefore = funds.reduce((a, f) => a + f.saved, 0)

  // Caja
  const expected = carry + tot.income - tot.outflow
  // Saldo después de apartar el ahorro; si es negativo, hay que decir de dónde salió lo que faltó
  const saldo = expected - savingsTotal
  const deficit = Math.max(0, -saldo)
  const [sources, setSources] = useState<{ from: string; amount: string }[]>([])
  const sourcesTotal = sources.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const toJustify = deficit - sourcesTotal
  const available = Math.max(0, saldo + sourcesTotal)
  const [counted, setCounted] = useState('')
  const countedN = counted === '' ? Math.round(available * 100) / 100 : Number(counted) || 0
  const [rows, setRows] = useState<{ to: string; amount: string }[]>([])
  const assigned = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const left = countedN - assigned
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const byMethod = useMemo(() => {
    const m = new Map<PaymentMethod, number>()
    for (const p of d.ins) { const i = items.find((x) => x.key === `p:${p.id}`); if (i && counts(i)) m.set(p.method, (m.get(p.method) ?? 0) + itemValue(i)) }
    return [...m.entries()]
  }, [d.ins, items])

  const totals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cuts.data ?? []) for (const x of c.distribution) if (Number(x.amount) > 0 && x.to.toLowerCase() !== CARRY_DESTINATION.toLowerCase()) m.set(x.to, (m.get(x.to) ?? 0) + Number(x.amount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [cuts.data])

  // Orígenes (lo que faltó y salió de otro lado) se guardan con monto negativo y "Vino de: …"
  const distributionNow = () => [
    ...sources.filter((r) => r.from.trim() && Number(r.amount) > 0).map((r) => ({ to: `${SOURCE_PREFIX}${r.from.trim()}`, amount: -Number(r.amount) })),
    ...(savingsTotal > 0 ? [{ to: 'Ahorros apartados', amount: Math.round(savingsTotal * 100) / 100 }] : []),
    ...rows.filter((r) => r.to.trim() && Number(r.amount) > 0).map((r) => ({ to: r.to.trim(), amount: Number(r.amount) })),
  ]
  const save = async () => {
    const distribution = distributionNow()
    setSaving(true)
    try {
      const row = {
        cut_date: to, period_from: from, period_to: to, income: tot.income, outflow: tot.outflow, counted: countedN, distribution,
        items, savings: funds.map((f) => ({ key: f.key, name: f.name, target: f.target, due: f.due, suggested: f.suggested, saved: savedNow(f), note: saveNote[f.key] || undefined })),
        notes: notes.trim() || null,
      }
      const savedCut = editingCut
        ? unwrap(await supabase.from('cash_cuts').update(row).eq('id', editingCut.id).select('*').single()) as CashCut
        : unwrap(await supabase.from('cash_cuts').insert(row).select('*').single()) as CashCut
      await qc.invalidateQueries({ queryKey: ['cash_cuts'] })
      resetDraft()
      setConfirming(false)
      setSent(savedCut)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  const resetDraft = () => {
    setReview({}); setSaveAmt({}); setSaveNote({}); setCounted(''); setRows([]); setSources([]); setNotes(''); setEditingCut(null)
    setParams({}, { replace: true })
  }
  /** Cargar un corte guardado para corregirlo */
  const startEdit = (c: CashCut) => {
    setEditingCut(c)
    setReview(Object.fromEntries((c.items ?? []).map((i) => [i.key, { approved: i.approved, adjusted: i.adjusted, note: i.note, excluded: i.excluded }])))
    setSaveAmt(Object.fromEntries((c.savings ?? []).map((s) => [s.key, String(s.saved)])))
    setSaveNote(Object.fromEntries((c.savings ?? []).filter((s) => s.note).map((s) => [s.key, s.note!])))
    setCounted(String(c.counted))
    setRows(c.distribution.filter((x) => x.to !== 'Ahorros apartados' && Number(x.amount) > 0).map((x) => ({ to: x.to, amount: String(x.amount) })))
    setSources(c.distribution.filter((x) => Number(x.amount) < 0).map((x) => ({ from: x.to.replace(SOURCE_PREFIX, ''), amount: String(-Number(x.amount)) })))
    setNotes(c.notes ?? '')
    setParams({ desde: c.period_from, hasta: c.period_to }, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const remove = async () => {
    if (!deleting) return
    try {
      unwrap(await supabase.from('cash_cuts').delete().eq('id', deleting.id))
      await qc.invalidateQueries({ queryKey: ['cash_cuts'] })
      toast.ok('Corte eliminado')
      setDeleting(null)
    } catch (e) { toast.error(e) }
  }
  const doExport = () => exportCsv(`corte-${from}-al-${to}.csv`, ['Tipo', 'Fecha', 'Concepto', 'Detalle', 'Monto', 'Corregido', 'Revisado', 'Nota'],
    items.map((i) => [i.type, i.date, i.concept, i.detail, i.type === 'salida' ? -i.amount : i.amount, i.adjusted ?? '', i.approved ? 'Sí' : 'No', i.note]))

  const error = cuts.error || payments.error || expenses.error
  if (error) return <ErrorState error={error} onRetry={() => { cuts.refetch(); payments.refetch() }} />
  const loading = cuts.isLoading || payments.isLoading || fees.isLoading || students.isLoading || expenses.isLoading || coaches.isLoading

  const ReviewList = ({ type, title }: { type: CutItem['type']; title: string }) => {
    const list = items.filter((i) => i.type === type)
    const done = list.filter((i) => i.approved).length
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-4">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">{title} <span className="font-sans text-sm font-normal normal-case text-muted">· {done} de {list.length} revisadas</span></h3>
          {list.length > 0 && (done < list.length
            ? <Button size="sm" variant="secondary" icon={CheckCheck} onClick={() => approveAll(type, true)}>Aprobar todas</Button>
            : <Button size="sm" variant="ghost" icon={X} onClick={() => approveAll(type, false)}>Desaprobar todas</Button>)}
        </div>
        {list.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">Nada en estas fechas.</p> : (
          <ul className="divide-y divide-ink-700">
            {(type === 'salida'
              ? OUT_GROUPS.flatMap((g) => {
                  const inGroup = list.filter((i) => outGroup(i) === g.id)
                  if (!inGroup.length) return []
                  const sub = inGroup.filter(counts).reduce((a, i) => a + itemValue(i), 0)
                  return [{ header: g.label, sub, count: inGroup.length } as const, ...inGroup]
                })
              : list
            ).map((i) => 'header' in i ? (
              <li key={'h' + i.header} className="flex items-center justify-between bg-ink-900 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <span>{i.header} · {i.count}</span><span className="text-white">{cents(i.sub)}</span>
              </li>
            ) : (
              <li key={i.key} className={cx('px-4 py-2.5', i.approved && 'bg-ok/5', (i.excluded || !i.approved) && 'opacity-60')}>
                <div className="flex items-center gap-3">
                  <button onClick={() => setItem(i.key, { approved: !i.approved })} aria-pressed={i.approved} aria-label={i.approved ? 'Quitar aprobación' : 'Aprobar'}
                    className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2', i.approved ? 'border-ok bg-ok text-ink' : 'border-ink-500 text-transparent hover:border-ok')}>
                    <Check className="h-5 w-5" strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.concept}</p>
                    <p className="truncate text-xs text-muted">{i.date ? date(i.date, 'EEE d MMM') : ''} · {i.detail.replace(/ · (efectivo|transferencia|tarjeta|deposito|otro)$/, (m) => ` · ${METHOD_LABEL[m.slice(3) as PaymentMethod] ?? m.slice(3)}`)}</p>
                    {i.excluded && <p className="text-xs text-info">No salió de la caja (no cuenta)</p>}
                    {i.note && <p className="text-xs text-warn">Nota: {i.note}</p>}
                  </div>
                  <div className="text-right">
                    {i.adjusted != null && <p className="text-xs text-muted line-through">{cents(i.amount)}</p>}
                    <p className={cx('font-semibold', i.adjusted != null && 'text-warn', i.excluded && 'line-through')}>{cents(itemValue(i))}</p>
                  </div>
                  <IconButton icon={Pencil} label="Corregir" onClick={() => setEditing(editing === i.key ? null : i.key)} className="h-8 w-8" />
                </div>
                {editing === i.key && (
                  <div className="mt-2 grid gap-2 rounded-xl bg-ink-900 p-3 sm:grid-cols-[140px_1fr_auto]">
                    <Input type="number" min="0" inputMode="decimal" defaultValue={String(itemValue(i))} aria-label="Monto correcto" className="h-10"
                      onBlur={(e) => { const v = Number(e.target.value); setItem(i.key, { adjusted: v >= 0 && v !== i.amount ? v : null }) }} />
                    <Input defaultValue={i.note} placeholder="¿Por qué se corrige? (nota)" aria-label="Nota" className="h-10" onBlur={(e) => setItem(i.key, { note: e.target.value })} />
                    <label className="flex items-center gap-2 text-xs sm:col-span-3"><input type="checkbox" checked={!!i.excluded} onChange={(e) => setItem(i.key, { excluded: e.target.checked })} className="h-4 w-4 accent-[#F2E30A]" />
                      {type === 'salida' ? 'No salió de la caja (se pagó por otro lado, por ejemplo transferencia)' : 'No entró a la caja (por ejemplo, transferencia al banco)'}</label>
                    <div className="flex gap-2">
                      {i.adjusted != null && <Button size="sm" variant="ghost" onClick={() => setItem(i.key, { adjusted: null })}>Deshacer</Button>}
                      <Button size="sm" onClick={() => { setItem(i.key, { approved: true }); setEditing(null) }}>Listo</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between border-t border-ink-600 bg-ink-900 px-5 py-3 font-display text-lg font-bold uppercase">
          <span>Total {title.toLowerCase()} <span className="font-sans text-xs font-normal normal-case text-muted">(sólo palomeadas)</span></span><span className={type === 'entrada' ? 'text-ok' : 'text-bad'}>{cents(type === 'entrada' ? tot.income : tot.outflow)}</span>
        </div>
      </Card>
    )
  }

  return (
    <>
      <PageHeader title="Corte de caja" subtitle="Revisa con ✓ cada entrada y salida, aparta el ahorro de la semana y di a dónde se va el dinero."
        actions={<>
          <Button variant="secondary" icon={Download} onClick={doExport} disabled={loading}>Exportar</Button>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()} className="hidden sm:inline-flex">Imprimir</Button>
          <Button icon={Vault} onClick={() => setConfirming(true)} disabled={loading}>{editingCut ? 'Guardar corrección' : 'Hacer corte ahora'}</Button>
        </>} />

      {editingCut && (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-2 border-brand/50 bg-brand-dim p-3">
          <p className="text-sm">Estás corrigiendo el corte del <b>{date(editingCut.cut_date, "EEEE d 'de' MMMM")}</b>. Cambia lo que necesites y pica <b>Guardar corrección</b>.</p>
          <Button size="sm" variant="ghost" onClick={resetDraft}>Cancelar corrección</Button>
        </Card>
      )}
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4">
        <Field label="Desde"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setRange('desde', e.target.value)} className="h-10" /></Field>
        <Field label="Hasta (día del corte)"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setRange('hasta', e.target.value)} className="h-10" /></Field>
        <p className="pb-2 text-sm text-muted">{prev ? <>Último corte: <b className="text-white">{date(prev.cut_date)}</b> · se quedaron {cents(carry)} en caja chica</> : 'Todavía no hay cortes: el primero empieza este lunes.'}</p>
        {!editingCut && (params.get('desde') || params.get('hasta')) && <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>Desde el último corte</Button>}
      </Card>

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Entró" value={cents(tot.income)} icon={TrendingUp} tone="ok" hint={byMethod.map(([m, v]) => `${METHOD_LABEL[m]} ${cents(v)}`).join(' · ') || 'Palomea las entradas para contarlas'} />
            <StatCard label="Salió" value={cents(tot.outflow)} icon={TrendingDown} tone="bad" hint="Sueldos, gastos y pagos de préstamos" />
            <StatCard label="Resultado de estas fechas" value={cents(tot.income - tot.outflow)} icon={Scale} tone={tot.income >= tot.outflow ? 'ok' : 'bad'} hint={tot.income >= tot.outflow ? 'Entró más de lo que salió (sin contar la caja chica)' : 'Salió más de lo que entró (sin contar la caja chica)'} />
            <StatCard label="Debería haber en caja" value={cents(expected)} icon={Banknote} tone="brand" hint={`Caja chica anterior ${cents(carry)} + lo que queda`} />
            <StatCard label="Debería haber en ahorro" value={cents(savedBefore + savingsTotal)} icon={PiggyBank} tone="ok"
              hint={`Ya apartado ${cents(savedBefore)}${savingsTotal > 0 ? ` + hoy ${cents(savingsTotal)}` : ''} · para pagos que aún no se hacen`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ReviewList type="entrada" title="Entradas" />
            <ReviewList type="salida" title="Salidas" />
          </div>

          {/* ---------- Sugerencia de ahorro ---------- */}
          <Card>
            <div className="border-b border-ink-600 px-5 py-4">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><PiggyBank className="h-5 w-5 text-brand" /> Sugerencia de ahorro</h3>
              <p className="text-xs text-muted">Para cada pago grande te sugerimos cuánto apartar esta semana. Escribe cuánto se guarda de verdad; si no hay dinero, déjalo en 0.
                {expected > 0 ? <> Hay <b className="text-white">{cents(expected)}</b> en caja para repartir.</> : <> <b className="text-warn">Esta semana no hay dinero en caja para ahorrar.</b></>}</p>
            </div>
            {funds.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No hay pagos grandes por juntar.</p> : (
              <ul className="divide-y divide-ink-700">
                {funds.map((f) => {
                  const now = savedNow(f)
                  const pctBefore = f.target ? Math.min(100, (f.saved / f.target) * 100) : 0
                  const pctAfter = f.target ? Math.min(100, ((f.saved + now) / f.target) * 100) : 0
                  return (
                    <li key={f.key} className="grid gap-3 px-5 py-3 md:grid-cols-[1fr_220px_150px]">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">{f.name} <Badge tone={f.kind === 'prestamo' ? 'warn' : f.kind === 'parte' ? 'info' : 'neutral'}>{FUND_LABEL[f.kind]}</Badge></p>
                        <p className="text-xs text-muted">Pagar {cents(f.target)} el {date(f.due, "d 'de' MMM")} · {f.weeksLeft === 1 ? 'esta semana' : `quedan ${f.weeksLeft} semanas`}
                          {f.kind === 'parte' && ' · este dinero aún tiene que irse ahí'}</p>
                        {f.debt && <p className="text-xs"><span className="text-muted">Deuda total</span> {cents(f.debt.total)} · <span className="text-ok">abonado {cents(f.debt.paid)}</span> · <span className="text-warn">falta {cents(f.debt.total - f.debt.paid)}</span></p>}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
                            <div className="absolute inset-y-0 left-0 rounded-full bg-brand/40" style={{ width: `${pctAfter}%` }} />
                            <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${pctBefore}%` }} />
                          </div>
                          <span className="w-24 text-right text-xs"><b className={pctAfter >= 100 ? 'text-ok' : 'text-brand'}>Vas al {Math.round(pctAfter)}%</b></span>
                        </div>
                        <p className="text-xs text-muted">Ya guardado {cents(f.saved)}{now > 0 ? ` + ${cents(now)} hoy` : ''}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-xs uppercase tracking-wider text-muted">Te sugerimos</p>
                        <p className="font-display text-2xl font-bold text-brand">{cents(f.suggested)}</p>
                        <p className="text-xs text-muted">{f.kind === 'fijo' || f.kind === 'seguro' ? 'parte de esta semana' : `${cents(Math.max(0, f.target - f.saved))} ÷ ${f.weeksLeft} ${f.weeksLeft === 1 ? 'semana' : 'semanas'}`}</p>
                      </div>
                      <div className="space-y-1">
                        <Input type="number" min="0" inputMode="decimal" value={saveAmt[f.key] ?? ''} placeholder="0" aria-label={`Se guarda para ${f.name}`}
                          onChange={(e) => setSaveAmt({ ...saveAmt, [f.key]: e.target.value })} className="h-10" />
                        <div className="flex gap-1">
                          <button className="text-xs text-brand hover:underline" onClick={() => setSaveAmt({ ...saveAmt, [f.key]: String(f.suggested) })}>Lo sugerido</button>
                          <span className="text-xs text-muted">·</span>
                          <button className="text-xs text-muted hover:underline" onClick={() => setSaveAmt({ ...saveAmt, [f.key]: '0' })}>Nada</button>
                        </div>
                        <Input value={saveNote[f.key] ?? ''} onChange={(e) => setSaveNote({ ...saveNote, [f.key]: e.target.value })} placeholder="Nota" className="h-8 text-xs" aria-label="Nota" />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 bg-ink-900 px-5 py-3">
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted">Sugerido esta semana {cents(suggestedTotal)}
                {funds.length > 0 && <button className="text-brand hover:underline" onClick={() => setSaveAmt(Object.fromEntries(funds.map((f) => [f.key, String(f.suggested)])))}>Guardar todo lo sugerido</button>}
                {Object.keys(saveAmt).length > 0 && <button className="hover:underline" onClick={() => setSaveAmt({})}>Borrar</button>}
              </span>
              <span className="font-display text-lg font-bold uppercase">Se guarda <span className="text-brand">{cents(savingsTotal)}</span></span>
            </div>
          </Card>

          {/* ---------- Caja ---------- */}
          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><Vault className="h-5 w-5 text-brand" /> Caja y a dónde se va el dinero</h3>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="divide-y divide-ink-700 rounded-xl bg-ink-900 text-sm">
                  <div className="flex justify-between px-3 py-2"><span>Caja chica anterior</span><b>{cents(carry)}</b></div>
                  <Breakdown label="+ Total de entradas" total={tot.income} tone="text-ok"
                    lines={items.filter((i) => i.type === 'entrada' && counts(i)).map((i) => [`${i.concept} · ${i.detail.split(' · ')[0]}`, itemValue(i)])} />
                  <Breakdown label="− Total de salidas" total={tot.outflow} tone="text-bad"
                    lines={OUT_GROUPS.flatMap((g) => {
                      const l = items.filter((i) => i.type === 'salida' && counts(i) && outGroup(i) === g.id)
                      return l.length ? [[g.label.toUpperCase(), l.reduce((a, i) => a + itemValue(i), 0), true] as const, ...l.map((i) => [`${i.concept}`, itemValue(i)] as const)] : []
                    })} />
                  <Breakdown label="− Total de ahorro" total={savingsTotal} tone="text-brand"
                    lines={funds.filter((f) => savedNow(f) > 0).map((f) => [f.name, savedNow(f)])} empty="No se apartó ahorro." />
                  <div className="flex justify-between px-3 py-2.5 font-semibold">
                    <span>= Saldo final al día de hoy <span className="block text-xs font-normal text-muted">lo que queda en caja</span></span>
                    <b className={cx('font-display text-2xl', saldo < 0 ? 'text-bad' : 'text-white')}>{cents(saldo)}</b>
                  </div>
                </div>
                {saldo < 0 && (
                  <p className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">Faltaron <b>{cents(deficit)}</b>: salió más de lo que había. Anota a la derecha <b>de dónde salió</b> ese dinero, o revisa arriba si algún pago no salió de la caja (lápiz ✎).</p>
                )}
                <Field label="¿Cuánto dinero hay de verdad en caja? (contado)" hint={Math.abs(countedN - available) > 0.5 ? `${countedN > available ? 'Sobran' : 'Faltan'} ${cents(Math.abs(countedN - available))} contra lo que debería haber (${cents(available)})` : `Cuadra con lo que debería haber (${cents(available)})`}>
                  <Input type="number" min="0" inputMode="decimal" value={counted === '' ? String(Math.round(available * 100) / 100) : counted} onChange={(e) => setCounted(e.target.value)} />
                </Field>
                <p className="text-xs text-muted">Incluye cobros por transferencia. Si ese dinero no está en efectivo, mándalo a "Banco".</p>
              </div>
              <div className="space-y-5">
                {deficit > 0 && (
                  <div className="rounded-xl border border-bad/40 p-3">
                    <p className="mb-2 text-sm font-semibold">Faltaron {cents(deficit)}. ¿De dónde salió ese dinero?</p>
                    <datalist id="cut-sources">{SOURCES.map((x) => <option key={x} value={x} />)}</datalist>
                    <div className="space-y-2">
                      {sources.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_130px_40px] gap-2">
                          <Input value={r.from} onChange={(e) => setSources(sources.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)))} list="cut-sources" placeholder="Ej. Préstamo de Marco" aria-label="De dónde salió" className="h-10" />
                          <Input type="number" min="0" inputMode="decimal" value={r.amount} onChange={(e) => setSources(sources.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} aria-label="Monto" className="h-10" />
                          <IconButton icon={Trash2} label="Quitar" onClick={() => setSources(sources.filter((_, k) => k !== i))} className="h-10 w-10" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <Button size="sm" variant="ghost" icon={Plus} onClick={() => setSources([...sources, { from: '', amount: toJustify > 0 ? String(Math.round(toJustify * 100) / 100) : '' }])}>Agregar de dónde salió</Button>
                      <span className={cx('text-sm', toJustify > 0.5 ? 'text-bad' : 'text-ok')}>{toJustify > 0.5 ? `Falta explicar ${cents(toJustify)}` : 'Cuadrado ✓'}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">Si fue un préstamo, regístralo también en <Link to="/gastos" className="text-brand hover:underline">Gastos → Préstamos</Link> para que quede la deuda.</p>
                  </div>
                )}
                <div>
                <p className="mb-2 text-sm font-semibold">Hay {cents(countedN)} en caja. ¿A dónde se va?</p>
                <datalist id="cut-destinations">{DESTINATIONS.map((x) => <option key={x} value={x} />)}</datalist>
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_130px_40px] gap-2">
                      <Input value={r.to} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)))} list="cut-destinations" placeholder="Ej. Caja chica, Banco…" aria-label="Destino" className="h-10" />
                      <Input type="number" min="0" inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} aria-label="Monto" className="h-10" />
                      <IconButton icon={Trash2} label="Quitar" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="h-10 w-10" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows([...rows, { to: rows.length ? '' : CARRY_DESTINATION, amount: left > 0 ? String(Math.round(left * 100) / 100) : '' }])}>Agregar destino</Button>
                  <span className={cx('text-sm', Math.abs(left) > 0.5 ? 'text-warn' : 'text-ok')}>{Math.abs(left) > 0.5 ? `${left > 0 ? 'Falta asignar' : 'Te pasaste por'} ${cents(Math.abs(left))}` : 'Todo asignado ✓'}</span>
                </div>
                <p className="mt-1 text-xs text-muted">Lo que pongas en "{CARRY_DESTINATION}" se queda en caja y es con lo que empieza el siguiente corte. El ahorro ya se apartó arriba.</p>
                </div>
              </div>
            </div>
            <Field label="Notas del corte (opcional)" className="mt-4"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Se pagó a los profes en efectivo" /></Field>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {tot.pending > 0 && <span className="text-sm text-warn">{tot.pending} líneas sin palomear (no cuentan)</span>}
              <Button icon={Vault} onClick={() => setConfirming(true)}>{editingCut ? "Guardar corrección" : "Hacer corte"}</Button>
            </div>
          </Card>

          {totals.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide">Acumulado por destino (todos los cortes)</h3>
              <div className="flex flex-wrap gap-3">
                {totals.map(([k, v]) => <div key={k} className="rounded-xl border border-ink-600 px-4 py-2"><p className="text-xs uppercase tracking-wider text-muted">{k}</p><p className="font-display text-2xl font-bold">{cents(v)}</p></div>)}
              </div>
            </Card>
          )}

          <div>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Cortes anteriores</h2>
            {!cuts.data?.length ? <Card className="p-6 text-center text-sm text-muted">Aún no hay cortes. Cuando pagues a los profes, revisa todo arriba y pica <b>Guardar corte</b>.</Card> : (
              <div className="space-y-3">{cuts.data.map((c) => <CutCard key={c.id} cut={c} onEdit={() => startEdit(c)} onDelete={() => setDeleting(c)} />)}</div>
            )}
          </div>
          <p className="text-xs text-muted">Los sueldos semanales cuentan el miércoles · gastos mensuales el día 1 · gastos del mes y pagos en partes el día que se pagaron. Se editan en <Link to="/gastos" className="text-brand hover:underline">Gastos</Link>.</p>
        </div>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title={editingCut ? 'Confirmar corrección del corte' : 'Confirmar corte de caja'}
        footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Revisar otra vez</Button><Button icon={Check} onClick={save} loading={saving}>Confirmar corte</Button></>}>
        <div className="space-y-4 text-sm">
          <Field label="Día del corte"><Input type="date" value={to} min={from} max={t} onChange={(e) => e.target.value && setRange('hasta', e.target.value)} /></Field>
          <p className="text-muted">Del {range(from, to)}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-ink-900 p-3">
            <span>Entró</span><b className="text-right text-ok">{cents(tot.income)}</b>
            <span>Salió</span><b className="text-right text-bad">{cents(tot.outflow)}</b>
            <span>Debería haber</span><b className="text-right">{cents(expected)}</b>
            <span className="font-semibold">Dinero contado</span><b className="text-right text-brand">{cents(countedN)}</b>
          </div>
          <div>
            <p className="mb-1 font-semibold">A dónde se va</p>
            {distributionNow().length === 0 ? <p className="text-muted">Nada asignado.</p> : (
              <ul className="space-y-1">{distributionNow().map((x) => <li key={x.to} className={cx('flex justify-between', x.amount < 0 && 'text-bad')}><span>{x.to}</span><b>{cents(Math.abs(x.amount))}</b></li>)}</ul>
            )}
            {toJustify > 0.5 && <p className="mt-1 text-bad">Faltaron {cents(deficit)} y falta explicar de dónde salieron {cents(toJustify)}.</p>}
            {Math.abs(left) > 0.5 && <p className="mt-1 text-warn">{left > 0 ? 'Falta asignar' : 'Te pasaste por'} {cents(Math.abs(left))}</p>}
          </div>
          {tot.pending > 0
            ? <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-warn">Hay {tot.pending} líneas sin palomear (✓): <b>no se cuentan</b> en este corte. Puedes confirmar así o regresar a revisarlas.</p>
            : <p className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-ok">Todas las entradas y salidas están revisadas ✓</p>}
          {tot.adjusted > 0 && <p className="text-muted">{tot.adjusted} montos corregidos con nota.</p>}
        </div>
      </Modal>
      <Modal open={!!sent} onClose={() => setSent(null)} title="Corte guardado ✓"
        footer={<Button variant="secondary" onClick={() => setSent(null)}>Listo</Button>}>
        {sent && (
          <div className="space-y-4 text-sm">
            <p>Se guardó el corte del <b>{date(sent.cut_date, "EEEE d 'de' MMMM")}</b>. El siguiente empieza mañana.</p>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-ink-900 p-3 text-center">
              <div><p className="text-xs text-muted">Entró</p><p className="font-semibold text-ok">{cents(Number(sent.income))}</p></div>
              <div><p className="text-xs text-muted">Salió</p><p className="font-semibold text-bad">{cents(Number(sent.outflow))}</p></div>
              <div><p className="text-xs text-muted">En caja</p><p className="font-semibold text-brand">{cents(Number(sent.counted))}</p></div>
            </div>
            <p className="font-semibold">Enviar reporte del corte por WhatsApp a:</p>
            <ReportButtons cut={sent} />
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Eliminar corte" confirmLabel="Eliminar"
        text={deleting ? `Se eliminará el corte del ${date(deleting.cut_date)} con lo que se apartó de ahorro. Los pagos y gastos no se borran.` : null} />
    </>
  )
}

/** Un total que al tocarlo muestra su desglose en texto simple. */
function Breakdown({ label, total, tone, lines, empty = 'Nada palomeado.' }: {
  label: string; total: number; tone: string; lines: (readonly [string, number] | readonly [string, number, boolean])[]; empty?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-ink-800">
        <span>{label} <span className="text-xs text-muted">{open ? '▾ ocultar' : '▸ ver desglose'}</span></span>
        <b className={tone}>{cents(total)}</b>
      </button>
      {open && (
        <div className="space-y-0.5 px-3 pb-3 font-mono text-xs text-muted">
          {lines.length === 0 ? <p>{empty}</p> : lines.map(([t, v, head], k) => (
            <p key={k} className={cx('flex justify-between gap-3', head && 'pt-1.5 font-semibold text-white')}><span className="truncate">{head ? t : `· ${t}`}</span><span>{cents(v)}</span></p>
          ))}
        </div>
      )}
    </div>
  )
}

/** Botones para mandar el reporte del corte por WhatsApp a Marco y Junior. */
function ReportButtons({ cut, small }: { cut: CashCut; small?: boolean }) {
  return (
    <div className={cx('flex flex-wrap gap-2', !small && 'flex-col sm:flex-row')}>
      {REPORT_TO.map((r) => (
        <a key={r.phone} href={waLink(r.phone, shareText(cut))} target="_blank" rel="noopener noreferrer"
          className={cx('inline-flex items-center justify-center gap-1.5 rounded-xl bg-wa font-semibold text-ink hover:brightness-110', small ? 'h-8 px-2.5 text-xs' : 'h-11 flex-1 px-4')}>
          <MessageCircle className="h-4 w-4" /> {small ? r.name : `Enviar a ${r.name}`}
        </a>
      ))}
    </div>
  )
}

const shareText = (c: CashCut) => [
  '*Corte de caja Rancho Seco*', `${date(c.cut_date, "EEEE d 'de' MMMM")} · del ${range(c.period_from, c.period_to)}`, '',
  `Entró: ${cents(Number(c.income))}`, `Salió: ${cents(Number(c.outflow))}`,
  ...OUT_GROUPS.flatMap((g) => {
    const v = (c.items ?? []).filter((i) => i.type === 'salida' && counts(i) && outGroup(i) === g.id).reduce((a, i) => a + itemValue(i), 0)
    return v > 0 ? [`  · ${g.label}: ${cents(v)}`] : []
  }), `*Contado en caja: ${cents(Number(c.counted))}*`,
  ...((c.items ?? []).filter((i) => i.adjusted != null).length ? ['', 'Correcciones:', ...(c.items ?? []).filter((i) => i.adjusted != null).map((i) => `  · ${i.concept}: ${cents(i.amount)} → ${cents(Number(i.adjusted))}${i.note ? ` (${i.note})` : ''}`)] : []),
  ...((c.savings ?? []).some((s) => Number(s.saved) > 0) ? ['', 'Ahorro apartado:', ...(c.savings ?? []).filter((s) => Number(s.saved) > 0).map((s) => `  · ${s.name}: ${cents(Number(s.saved))}`)] : []),
  ...(c.distribution.some((x) => Number(x.amount) < 0) ? ['', 'Faltó dinero y salió de:', ...c.distribution.filter((x) => Number(x.amount) < 0).map((x) => `  · ${x.to.replace(SOURCE_PREFIX, '')}: ${cents(-Number(x.amount))}`)] : []),
  '', 'A dónde se fue:', ...c.distribution.filter((x) => Number(x.amount) > 0).map((x) => `  · ${x.to}: ${cents(Number(x.amount))}`),
  ...(c.notes ? ['', c.notes] : []),
].join('\n')

function CutCard({ cut: c, onEdit, onDelete }: { cut: CashCut; onEdit: () => void; onDelete: () => void }) {
  const assigned = c.distribution.filter((x) => Number(x.amount) > 0 && x.to !== 'Ahorros apartados').reduce((a, x) => a + Number(x.amount), 0)
  const items = c.items ?? []
  const adjusted = items.filter((i) => i.adjusted != null)
  const savings = (c.savings ?? []).filter((s) => Number(s.saved) > 0)
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold uppercase">{date(c.cut_date, "EEEE d 'de' MMMM")}</p>
          <p className="text-xs text-muted">Del {range(c.period_from, c.period_to)}{items.length ? ` · ${items.filter((i) => i.approved).length} de ${items.length} revisadas` : ''}</p>
        </div>
        <div className="flex gap-5 text-sm">
          <span>Entró <b className="text-ok">{cents(Number(c.income))}</b></span>
          <span>Salió <b className="text-bad">{cents(Number(c.outflow))}</b></span>
          <span>Contado <b className="text-brand">{cents(Number(c.counted))}</b></span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ReportButtons cut={c} small />
          <IconButton icon={Pencil} label="Corregir corte" onClick={onEdit} className="h-8 w-8" />
          <IconButton icon={Trash2} label="Eliminar corte" onClick={onDelete} className="h-8 w-8" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.distribution.map((x, i) => <Badge key={i} tone={Number(x.amount) < 0 ? 'bad' : x.to.toLowerCase() === CARRY_DESTINATION.toLowerCase() ? 'brand' : 'neutral'}>{x.to} · {cents(Math.abs(Number(x.amount)))}</Badge>)}
        {Math.abs(Number(c.counted) - assigned) > 0.5 && <Badge tone="warn">Sin asignar {cents(Number(c.counted) - assigned)}</Badge>}
      </div>
      {savings.length > 0 && <p className="mt-2 text-xs text-muted">Ahorro: {savings.map((s) => `${s.name} ${cents(Number(s.saved))}`).join(' · ')}</p>}
      {adjusted.length > 0 && <p className="mt-1 text-xs text-warn">Correcciones: {adjusted.map((i) => `${i.concept} ${cents(i.amount)} → ${cents(Number(i.adjusted))}${i.note ? ` (${i.note})` : ''}`).join(' · ')}</p>}
      {c.notes && <p className="mt-2 text-sm text-muted">{c.notes}</p>}
    </Card>
  )
}
