import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { startOfWeek } from 'date-fns'
import { TrendingUp, TrendingDown, Scale, Download, MessageCircle, Printer, Plus, Trash2, Vault, PiggyBank, Check, Pencil, CheckCheck, X, ChevronDown, FileText } from 'lucide-react'
import { Explain, FoldCard, Badge, Button, Card, ConfirmDialog, ErrorState, Field, IconButton, Input, Modal, PageHeader, Spinner, StatCard, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import RangePicker from '@/components/RangePicker'
import { useCashCuts, useCoachPay, useCoaches, useExpenses, useFees, usePayments, useSettings, useStudents } from '@/lib/api'
import {
  CARRY_DESTINATION, DESTINATIONS, carryOver as carryOverOf, OUT_GROUPS, SAVINGS_BOX_KEY, CHIVAS_KEY, CHIVAS_PLAYERAS_KEY, CHIVAS_CREDENCIALES_KEY, chivasConfig, cutGaps, isManual, isSalary, manualItem, nextDay, pendingSalaries, prepaidUntil, vacationItems, buildItems, counts, openingCash, itemTotals, itemValue, nextPeriodStart, outGroup, periodSummary, savingFunds,
  type CutItem, type SavingFund,
} from '@/lib/cashcut'
import { METHOD_LABEL, date, money, toISODate, today } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'
import { exportCsv } from '@/lib/csv'
import { downloadBlob, waLink } from '@/lib/whatsapp'
import { cutReportText } from '@/lib/cutReport'
import { notify } from '@/lib/notify'
import { UNIFORMS_FUND_KEY, isUniformConcept } from '@/lib/uniforms'
import type { CashCut, PaymentMethod } from '@/lib/types'

const cents = (n: number) => money(Math.round(n * 100) / 100)
const range = (from: string, to: string) => `${date(from, "d 'de' MMM")} al ${date(to, "d 'de' MMM yyyy")}`
const FUND_LABEL: Record<SavingFund['kind'], string> = { fijo: 'Gasto fijo', seguro: 'Seguro y credenciales', parte: 'Pago pendiente', prestamo: 'Préstamo', ahorro: 'Ahorro libre', uniformes: 'Fondo de uniformes', chivas: 'Caja Chivas' }
/** A quién se le manda el reporte de cada corte por WhatsApp. */
const REPORT_TO = [
  { name: 'Marco DL', phone: '528442713705' },
  { name: 'Junior DR', phone: '528444958824' },
]

import { CashDoubtsCard, SOURCE_PREFIX, SOURCES } from '@/components/CashDoubts'
import FundProgress from '@/components/FundProgress'

type Review = Record<string, { amount?: number; approved?: boolean; adjusted?: number | null; note?: string; excluded?: boolean; pending?: boolean }>

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
  const prevPrev = prev ? (cuts.data ?? []).find((c) => c.period_to < prev.period_from && c.id !== editingCut?.id) : undefined
  // Si el corte anterior quedó en negativo, se empieza con ese negativo (no con $0)
  const carry = openingCash(prev, prevPrev)

  const d = useMemo(() => periodSummary({
    from, to, payments: payments.data ?? [], fees: fees.data ?? [],
    names: new Map((students.data ?? []).map((s) => [s.id, s.full_name])),
    expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [],
  }), [from, to, payments.data, fees.data, students.data, expenses.data, coaches.data, pay.data])

  // Revisión de líneas (✓, monto corregido, nota)
  const [review, setReview] = useState<Review>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [manual, setManual] = useState<CutItem[]>([])
  // Entradas / Salidas encogidas (toca el título para abrir o cerrar)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const items: CutItem[] = useMemo(() => {
    // Sueldos que quedaron pendientes en cortes anteriores y vacaciones ya pagadas por adelantado
    const pend = pendingSalaries(cuts.data ?? [], editingCut?.id)
    const prepaid = prepaidUntil(cuts.data ?? [], editingCut?.id)
    return [...buildItems(d), ...pend, ...manual].map((i) => {
      const paidAhead = isSalary(i) && !i.prepaidUntil && !i.key.startsWith('pend:') && (prepaid.get(i.concept) ?? '') >= i.date
      const base = paidAhead ? { ...i, approved: true, excluded: true, note: `Ya se pagó en vacaciones (hasta el ${Number(prepaid.get(i.concept)!.slice(8, 10))}/${Number(prepaid.get(i.concept)!.slice(5, 7))})` } : i
      return { ...base, ...review[i.key] } as CutItem
    })
  }, [d, review, manual, cuts.data, editingCut])
  const [vacation, setVacation] = useState<{ weeks: string; until: string } | null>(null)
  const [adding, setAdding] = useState<CutItem['type'] | null>(null)
  const tot = itemTotals(items)
  const setItem = (key: string, p: Review[string]) => setReview((r) => ({ ...r, [key]: { ...r[key], ...p } }))
  const approveAll = (type: CutItem['type'], approved: boolean) => setReview((r) => {
    const n = { ...r }
    for (const i of items.filter((x) => x.type === type)) n[i.key] = { ...n[i.key], approved }
    return n
  })

  // Inscripciones de este corte (van a la Caja Chivas)
  const inscItems = items.filter((i) => i.type === 'entrada' && counts(i) && /^inscripci[oó]n/i.test(i.detail))
  const inscCount = inscItems.length
  const inscripciones = inscItems.reduce((a, i) => a + itemValue(i), 0)
  // Sugerencias de ahorro (el seguro se junta según las inscripciones cobradas)
  // Caja Chivas: precios por inscripción y seguro anual ÷ meta de alumnos (de Configuración)
  const settings = useSettings()
  const seguroGasto = Number((expenses.data ?? []).find((e) => /seguro/i.test(e.name) && e.active)?.amount ?? 0)
  const cfg = chivasConfig(settings.data, seguroGasto)
  const funds = useMemo(() => savingFunds({ cutDate: to, expenses: expenses.data ?? [], cuts: cuts.data ?? [], excludeCut: editingCut?.id, inscriptions: inscCount, seguro: { anual: cfg.seguroAnual, meta: cfg.meta } }), [to, expenses.data, cuts.data, editingCut, inscCount, cfg.seguroAnual, cfg.meta])
  const [saveAmt, setSaveAmt] = useState<Record<string, string>>({})
  const [saveNote, setSaveNote] = useState<Record<string, string>>({})
  const savedNow = (f: SavingFund) => (f.key in saveAmt ? Number(saveAmt[f.key]) || 0 : 0)
  const savingsTotal = funds.reduce((a, f) => a + savedNow(f), 0)
  const suggestedTotal = funds.reduce((a, f) => a + f.suggested, 0)
  // Las cajas después de este corte
  const box = funds.find((f) => f.kind === 'ahorro')
  const uniformsIn = items.filter((i) => i.type === 'entrada' && counts(i) && isUniformConcept(i.detail.split(' · ')[0])).reduce((a, i) => a + itemValue(i), 0)
  // Reparto de las inscripciones: playera, credencial, parte del seguro y lo demás libre en la Caja Chivas
  const seguroFund = funds.find((f) => f.kind === 'seguro')
  // Cada inscripción con su reparto (el que se anotó al cobrarla, o el de siempre)
  // Lista de la Caja Chivas: qué secciones se apartan (lo que no, se queda libre)
  const [chivasOn, setChivasOn] = useState({ credencial: true, playera: true, seguro: true })
  const chivasSplit = useMemo(() => {
    const byId = new Map((payments.data ?? []).map((x) => [`p:${x.id}`, x.split]))
    const sp = inscItems.map((i) => byId.get(i.key))
    const playeras = chivasOn.playera ? sp.reduce((a, x) => a + (x ? Number(x.playera) : cfg.playera), 0) : 0
    const credenciales = chivasOn.credencial ? sp.reduce((a, x) => a + (x ? Number(x.credencial) : cfg.credencial), 0) : 0
    const room = seguroFund ? Math.max(0, seguroFund.target - seguroFund.saved) : Infinity
    const seguro = chivasOn.seguro ? Math.min(room, sp.reduce((a, x) => a + (x ? Number(x.seguro) : cfg.seguro), 0)) : 0
    return { playeras, credenciales, seguro, libre: Math.max(0, Math.round((inscripciones - playeras - credenciales - seguro) * 100) / 100) }
  }, [inscCount, inscripciones, seguroFund?.target, seguroFund?.saved, payments.data, inscItems.map((i) => i.key).join(), chivasOn, cfg.playera, cfg.credencial, cfg.seguro]) // eslint-disable-line react-hooks/exhaustive-deps
  // Nuevo a acumular en la Caja Chivas (lista con palomitas); lo ya acumulado se ve a la izquierda
  const chivasRows: { id: 'credencial' | 'playera' | 'seguro' | 'libre'; label: string; unit: string; field?: 'chivas_credencial' | 'chivas_playera'; price?: number; key: string | undefined; extra?: string }[] = [
    { id: 'credencial', label: 'Credenciales', unit: `${cents(cfg.credencial)} c/u`, field: 'chivas_credencial', price: cfg.credencial, key: CHIVAS_CREDENCIALES_KEY },
    { id: 'playera', label: 'Playeras de entrenamiento', unit: `${cents(cfg.playera)} c/u`, field: 'chivas_playera', price: cfg.playera, key: CHIVAS_PLAYERAS_KEY },
    { id: 'seguro', label: 'Seguro', unit: `${cents(cfg.seguroAnual)} ÷ ${cfg.meta} alumnos = ${cents(cfg.seguro)} c/u`, key: seguroFund?.key },
    { id: 'libre', label: 'Libre en Caja Chivas', unit: 'lo que queda', key: CHIVAS_KEY },
  ]
  // Doble clic en el precio: cambia cuánto va de cada inscripción (de aquí en adelante)
  const editPrice = async (field: 'chivas_credencial' | 'chivas_playera', label: string, current: number) => {
    const v = window.prompt(`¿Cuánto va de cada inscripción a ${label}? (aplica de aquí en adelante)`, String(current))
    if (v == null || !(Number(v) >= 0)) return
    try {
      unwrap(await supabase.from('settings').update({ [field]: Number(v) }).eq('id', 1))
      await qc.invalidateQueries({ queryKey: ['settings'] })
      toast.ok(`Listo: ${label} ahora es ${cents(Number(v))} por inscripción`)
    } catch (e) { toast.error(e) }
  }
  const applyChivas = () => setSaveAmt((x) => ({
    ...x,
    [CHIVAS_PLAYERAS_KEY]: String(chivasSplit.playeras),
    [CHIVAS_CREDENCIALES_KEY]: String(chivasSplit.credenciales),
    [CHIVAS_KEY]: String(chivasSplit.libre),
    ...(seguroFund ? { [seguroFund.key]: String(chivasSplit.seguro) } : {}),
  }))
  // Las inscripciones se mandan solas a la Caja Chivas (en un corte nuevo; se puede cambiar a mano)
  useEffect(() => {
    if (editingCut || !inscCount) return
    applyChivas()
  }, [inscCount, inscripciones, chivasSplit.seguro, chivasSplit.playeras, chivasSplit.credenciales, chivasSplit.libre, editingCut]) // eslint-disable-line react-hooks/exhaustive-deps
  // Lo que se cobró de uniformes se manda solo al fondo de uniformes (corte nuevo)
  useEffect(() => {
    if (editingCut) return
    setSaveAmt((x) => ({ ...x, [UNIFORMS_FUND_KEY]: uniformsIn > 0 ? String(uniformsIn) : x[UNIFORMS_FUND_KEY] ?? '' }))
  }, [uniformsIn, editingCut])

  // Caja
  const expected = carry + tot.income - tot.outflow
  // Saldo en caja: lo que queda después del apartado y la Caja Chivas se queda en la Caja de ahorro
  const otherSaved = funds.filter((f) => f.key !== SAVINGS_BOX_KEY).reduce((a, f) => a + savedNow(f), 0)
  const restoAhorro = Math.max(0, Math.round((expected - otherSaved) * 100) / 100)
  useEffect(() => {
    if (editingCut) return
    setSaveAmt((x) => ({ ...x, [SAVINGS_BOX_KEY]: String(restoAhorro) }))
  }, [restoAhorro, editingCut])
  // Saldo después de apartar el ahorro; si es negativo, hay que decir de dónde salió lo que faltó
  const saldo = expected - savingsTotal
  const deficit = Math.max(0, -saldo)
  const [sources, setSources] = useState<{ from: string; amount: string }[]>([])
  const sourcesTotal = sources.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const toJustify = deficit - sourcesTotal
  // Puede ser negativo: faltó dinero y no se ha dicho de dónde salió
  const available = saldo + sourcesTotal
  const [counted, setCounted] = useState('')
  const countedN = counted === '' ? Math.round(Math.max(0, available) * 100) / 100 : Number(counted) || 0
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


  // Orígenes (lo que faltó y salió de otro lado) se guardan con monto negativo y "Vino de: …"
  // Lo contado que no se mandó a ningún lado se queda en caja chica (para que el siguiente corte empiece con eso)
  const distributionNow = () => {
    const sent = rows.filter((r) => r.to.trim() && Number(r.amount) > 0).map((r) => ({ to: r.to.trim(), amount: Number(r.amount) }))
    return [
      ...sources.filter((r) => r.from.trim() && Number(r.amount) > 0).map((r) => ({ to: `${SOURCE_PREFIX}${r.from.trim()}`, amount: -Number(r.amount) })),
      ...(savingsTotal > 0 ? [{ to: 'Ahorros apartados', amount: Math.round(savingsTotal * 100) / 100 }] : []),
      ...sent,
    ]
  }
  // Lo que queda sin destino se va a la Caja de ahorro (la caja chica termina en cero)
  const restToSavings = Math.max(0, Math.round(left * 100) / 100)
  const save = async () => {
    const distribution = distributionNow()
    setSaving(true)
    try {
      const extra = restToSavings > 0.5 ? restToSavings : 0
      const row = {
        cut_date: to, period_from: from, period_to: to, income: tot.income, outflow: tot.outflow, counted: Math.round((countedN - extra) * 100) / 100, distribution,
        items, savings: funds.map((f) => ({ key: f.key, name: f.name, target: f.target, due: f.due, suggested: f.suggested,
          saved: Math.round((savedNow(f) + (f.key === SAVINGS_BOX_KEY ? extra : 0)) * 100) / 100,
          note: [saveNote[f.key], f.key === SAVINGS_BOX_KEY && extra ? `Incluye ${cents(extra)} que quedaron sin destino` : ''].filter(Boolean).join(' · ') || undefined })),
        notes: notes.trim() || null,
      }
      const savedCut = editingCut
        ? unwrap(await supabase.from('cash_cuts').update(row).eq('id', editingCut.id).select('*').single()) as CashCut
        : unwrap(await supabase.from('cash_cuts').insert(row).select('*').single()) as CashCut
      if (editingCut) {
        const diff = (a: number, b: number) => (Math.abs(a - b) > 0.5 ? `${cents(b)} → ${cents(a)}` : null)
        const changes = [
          diff(tot.income, Number(editingCut.income)) && `entró ${diff(tot.income, Number(editingCut.income))}`,
          diff(tot.outflow, Number(editingCut.outflow)) && `salió ${diff(tot.outflow, Number(editingCut.outflow))}`,
          diff(countedN, Number(editingCut.counted)) && `contado ${diff(countedN, Number(editingCut.counted))}`,
        ].filter(Boolean).join(' · ')
        await notify(`Se corrigió el corte del ${date(editingCut.cut_date, "d 'de' MMM")}`, changes || 'Se cambiaron revisiones, notas o destinos del dinero')
        await qc.invalidateQueries({ queryKey: ['notifications'] })
      }
      await qc.invalidateQueries({ queryKey: ['cash_cuts'] })
      resetDraft()
      setConfirming(false)
      setSent(savedCut)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  const resetDraft = () => {
    setReview({}); setSaveAmt({}); setSaveNote({}); setCounted(''); setRows([]); setSources([]); setNotes(''); setEditingCut(null); setManual([])
    setParams({}, { replace: true })
  }
  /** Cargar un corte guardado para corregirlo */
  const startEdit = (c: CashCut) => {
    setEditingCut(c)
    setTimeout(() => document.getElementById('hacer-corte')?.scrollIntoView({ behavior: 'smooth' }), 50)
    setReview(Object.fromEntries((c.items ?? []).map((i) => [i.key, { amount: i.amount, approved: i.approved, adjusted: i.adjusted, note: i.note, excluded: i.excluded }])))
    setSaveAmt(Object.fromEntries((c.savings ?? []).map((s) => [s.key, String(s.saved)])))
    setSaveNote(Object.fromEntries((c.savings ?? []).filter((s) => s.note).map((s) => [s.key, s.note!])))
    setCounted(String(c.counted))
    setRows(c.distribution.filter((x) => x.to !== 'Ahorros apartados' && Number(x.amount) > 0).map((x) => ({ to: x.to, amount: String(x.amount) })))
    setSources(c.distribution.filter((x) => Number(x.amount) < 0).map((x) => ({ from: x.to.replace(SOURCE_PREFIX, ''), amount: String(-Number(x.amount)) })))
    setNotes(c.notes ?? '')
    setManual((c.items ?? []).filter((i) => isManual(i) || i.key.startsWith('vac:')))
    setParams({ desde: c.period_from, hasta: c.period_to }, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const remove = async () => {
    if (!deleting) return
    try {
      unwrap(await supabase.from('cash_cuts').delete().eq('id', deleting.id))
      await notify(`Se eliminó el corte del ${date(deleting.cut_date, "d 'de' MMM")}`, `Entró ${cents(Number(deleting.income))} · salió ${cents(Number(deleting.outflow))} · contado ${cents(Number(deleting.counted))}`)
      await Promise.all(['cash_cuts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
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
    const isFolded = !!folded[type]
    const sumAll = list.filter(counts).reduce((a, i) => a + itemValue(i), 0)
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-4">
          <button type="button" onClick={() => setFolded((f) => ({ ...f, [type]: !f[type] }))} aria-expanded={!isFolded}
            className="-m-2 flex items-center gap-2 rounded-xl p-2 text-left hover:bg-ink-700/50" title={isFolded ? 'Toca para ver el desglose' : 'Toca para encoger'}>
            <ChevronDown className={cx('h-5 w-5 shrink-0 text-brand transition-transform', isFolded && '-rotate-90')} />
            <span>
              <span className="font-display text-lg font-bold uppercase tracking-wide">{title}</span>
              <span className="text-sm text-muted"> · {done} de {list.length} revisadas · {cents(sumAll)}</span>
              <span className="block text-xs text-muted">{isFolded ? 'Toca para ver el desglose' : 'Toca aquí para encoger'}</span>
            </span>
          </button>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(type)}>{type === 'entrada' ? 'Agregar pago' : 'Agregar gasto'}</Button>
            {type === 'salida' && <Button size="sm" variant="ghost" onClick={() => setVacation(vacation ? null : { weeks: '2', until: '' })}>🏖 Vacaciones</Button>}
            {list.length > 0 && (done < list.length
              ? <Button size="sm" variant="secondary" icon={CheckCheck} onClick={() => approveAll(type, true)}>Aprobar todas</Button>
              : <Button size="sm" variant="ghost" icon={X} onClick={() => approveAll(type, false)}>Desaprobar todas</Button>)}
          </div>
        </div>
        {type === 'salida' && vacation && (
          <div className="space-y-2 border-b border-ink-600 bg-ink-900 px-4 py-3 text-sm">
            <p className="font-semibold">Pagar vacaciones por adelantado</p>
            <p className="text-xs text-muted">A cada profe y staff de este corte se le paga su semana normal más las semanas de vacaciones. En los cortes de esas semanas su sueldo ya no se vuelve a cobrar.</p>
            <div className="grid gap-2 sm:grid-cols-[160px_200px_auto]">
              <Field label="Semanas de vacaciones"><Input type="number" min="1" max="8" inputMode="numeric" value={vacation.weeks} onChange={(e) => setVacation({ ...vacation, weeks: e.target.value })} className="h-10" /></Field>
              <Field label="Regresan a trabajar el"><Input type="date" value={vacation.until} onChange={(e) => setVacation({ ...vacation, until: e.target.value })} className="h-10" /></Field>
              <div className="flex items-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setVacation(null)}>Cancelar</Button>
                <Button size="sm" disabled={!(Number(vacation.weeks) >= 1) || !vacation.until} onClick={() => {
                  // Se paga hasta el día antes de regresar
                  const back = new Date(vacation.until + 'T12:00:00'); back.setDate(back.getDate() - 1)
                  const v = vacationItems(items, Math.round(Number(vacation.weeks)), toISODate(back))
                  if (!v.length) { toast.error('Primero palomea los sueldos de esta semana.'); return }
                  setManual((m) => [...m.filter((x) => !x.key.startsWith('vac:')), ...v]); setVacation(null)
                  toast.ok(`Se agregaron ${v.length} pagos de vacaciones`)
                }}>Agregar pagos de vacaciones</Button>
              </div>
            </div>
          </div>
        )}
        {adding === type && (
          <ManualLineForm type={type} defaultDate={to} onCancel={() => setAdding(null)}
            onAdd={(it) => { setManual((m) => [...m, it]); setAdding(null) }} />
        )}
        {isFolded ? null : list.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">Nada en estas fechas.</p> : (
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
                    {i.pending ? <p className="text-xs text-warn">No se pagó: queda pendiente para el siguiente corte</p> : i.excluded && <p className="text-xs text-info">No salió de la caja (no cuenta)</p>}
                    {i.note && <p className="text-xs text-warn">Nota: {i.note}</p>}
                  </div>
                  <div className="text-right">
                    {i.adjusted != null && <p className="text-xs text-muted line-through">{cents(i.amount)}</p>}
                    <p className={cx('font-semibold', i.adjusted != null && 'text-warn', i.excluded && 'line-through')}>{cents(itemValue(i))}</p>
                  </div>
                  {(isManual(i) || i.key.startsWith('vac:')) && <IconButton icon={Trash2} label="Quitar línea agregada" onClick={() => setManual((m) => m.filter((x) => x.key !== i.key))} className="h-8 w-8" />}
                  <IconButton icon={Pencil} label="Corregir" onClick={() => setEditing(editing === i.key ? null : i.key)} className="h-8 w-8" />
                </div>
                {editing === i.key && (
                  <div className="mt-2 grid gap-2 rounded-xl bg-ink-900 p-3 sm:grid-cols-[140px_1fr_auto]">
                    <Input type="number" min="0" inputMode="decimal" defaultValue={String(itemValue(i))} aria-label="Monto correcto" className="h-10"
                      onBlur={(e) => { const v = Number(e.target.value); setItem(i.key, { adjusted: v >= 0 && v !== i.amount ? v : null }) }} />
                    <Input defaultValue={i.note} placeholder="¿Por qué se corrige? (nota)" aria-label="Nota" className="h-10" onBlur={(e) => setItem(i.key, { note: e.target.value })} />
                    <label className="flex items-center gap-2 text-xs sm:col-span-3"><input type="checkbox" checked={!!i.excluded} onChange={(e) => setItem(i.key, { excluded: e.target.checked })} className="h-4 w-4 accent-[#F2E30A]" />
                      {type === 'salida' ? 'No salió de la caja (se pagó por otro lado, por ejemplo transferencia)' : 'No entró a la caja (por ejemplo, transferencia al banco)'}</label>
                    {isSalary(i) && !i.prepaidUntil && (
                      <label className="flex items-center gap-2 text-xs sm:col-span-3"><input type="checkbox" checked={!!i.pending} onChange={(e) => setItem(i.key, { pending: e.target.checked, excluded: e.target.checked, approved: true })} className="h-4 w-4 accent-[#F2E30A]" />
                        No se le pagó esta semana: queda <b>pendiente</b> y le aparece en el siguiente corte</label>
                    )}
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
        {type === 'entrada' && list.length > 0 && (() => {
          // Subtotales por concepto (sólo lo palomeado): inscripciones, mensualidades, etc.
          const by = new Map<string, { n: number; all: number; total: number }>()
          for (const i of list) {
            const k = i.detail.split(' · ')[0] || 'Otro'
            const r = by.get(k) ?? { n: 0, all: 0, total: 0 }
            r.all++
            if (counts(i)) { r.n++; r.total += itemValue(i) }
            by.set(k, r)
          }
          const plural = (k: string) => (k === 'Préstamo recibido' ? 'Préstamos recibidos' : /[aeiou]$/i.test(k) ? `${k}s` : k.replace(/ón$/, 'ones').replace(/d$/, 'des'))
          return (
            <div className="space-y-1 border-t border-ink-600 px-5 py-3 text-sm">
              {[...by.entries()].sort((a, b) => b[1].total - a[1].total || b[1].all - a[1].all).map(([k, r]) => (
                <p key={k} className="flex flex-wrap items-center justify-between gap-x-3">
                  <span>Total de {plural(k).toLowerCase()} <span className="text-xs text-muted">({r.n} de {r.all} palomeadas)</span>
                    {k === 'Reinscripción' && r.total > 0 && (() => {
                      const seg = funds.find((f) => f.kind === 'seguro')
                      if (!seg) return <span className="ml-2 text-xs text-muted">(agrega el seguro en Gastos para apartarlo)</span>
                      return Number(saveAmt[seg.key] ?? 0) >= r.total
                        ? <span className="ml-2 text-xs text-ok">✓ va al apartado del seguro y credenciales</span>
                        : <button className="ml-2 text-xs text-brand hover:underline" onClick={() => setSaveAmt({ ...saveAmt, [seg.key]: String(Number(saveAmt[seg.key] ?? 0) + r.total) })}>Mandar al seguro y credenciales</button>
                    })()}
                    {isUniformConcept(k) && r.total > 0 && (
                      Number(saveAmt[UNIFORMS_FUND_KEY] ?? 0) >= uniformsIn
                        ? <span className="ml-2 text-xs text-ok">✓ va al fondo de uniformes</span>
                        : <button className="ml-2 text-xs text-brand hover:underline" onClick={() => setSaveAmt({ ...saveAmt, [UNIFORMS_FUND_KEY]: String(uniformsIn) })}>Mandar al fondo de uniformes</button>
                    )}
                    {k === 'Inscripción' && r.total > 0 && (
                      Number(saveAmt[SAVINGS_BOX_KEY] ?? 0) >= r.total
                        ? <span className="ml-2 text-xs text-ok">✓ va a la caja de ahorro</span>
                        : <button className="ml-2 text-xs text-brand hover:underline" onClick={() => setSaveAmt({ ...saveAmt, [SAVINGS_BOX_KEY]: String(r.total) })}>Mandar al ahorro</button>
                    )}
                  </span>
                  <b>{cents(r.total)}</b>
                </p>
              ))}
            </div>
          )
        })()}
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
        </>}
        bar={<div className="flex flex-wrap items-end gap-3">
        <RangePicker label="Fechas del corte" from={from} to={to}
          onChange={(a, b) => { const p = new URLSearchParams(params); p.set('desde', a); p.set('hasta', b); setParams(p, { replace: true }) }} />
        <p className="pb-2 text-sm text-muted">{prev ? <>Último corte: <b className="text-white">{date(prev.cut_date)}</b> · {carry < 0 ? <span className="text-bad">quedó en negativo {cents(carry)} (faltó dinero)</span> : <>se quedaron {cents(carry)} en caja chica</>}</> : 'Todavía no hay cortes: el primero empieza este lunes.'}</p>
        {!editingCut && (params.get('desde') || params.get('hasta')) && <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>Desde el último corte</Button>}
        </div>} />
      {/* Primero las dudas de caja, luego los cortes anteriores y hasta abajo el corte nuevo */}
      <div className="mb-6"><CashDoubtsCard /></div>
      <div className="mb-6 space-y-6">
          <div>
            <FoldCard defaultOpen={!!params.get('ver')} title="Cortes anteriores" subtitle="Pica un corte para ver su desglose · pasa el mouse sobre un número para ver de dónde sale">
            {!cuts.data?.length ? <p className="p-6 text-center text-sm text-muted">Aún no hay cortes. Cuando pagues a los profes, revisa todo abajo en "Hacer el corte".</p> : (
              <>
              <div className="space-y-3 p-3 md:hidden">{cuts.data.map((c, i) => <CutRow key={c.id} mobile cut={c} prev={cuts.data![i + 1]} focus={params.get('ver') === c.id} onEdit={() => startEdit(c)} onDelete={() => setDeleting(c)} />)}</div>
              <div className="hidden overflow-x-auto md:block">
                <table className="table-base table-compact cuts-fit w-full whitespace-nowrap text-[0.85rem] lg:min-w-0 min-w-[820px]">
                  <thead><tr>{CUT_COLUMNS.map(([label, why]) => <th key={label} title={why} className="cursor-help underline decoration-ink-500 decoration-dotted underline-offset-4">{label}</th>)}<th /></tr></thead>
                  <tbody>{cuts.data.map((c, i) => <CutRow key={c.id} cut={c} prev={cuts.data![i + 1]} focus={params.get('ver') === c.id} onEdit={() => startEdit(c)} onDelete={() => setDeleting(c)} />)}</tbody>
                  <tfoot>
                    {(() => {
                      const t = cuts.data!.map((c, i) => cutNums(c, cuts.data![i + 1])).reduce((a, n) => ({ income: a.income + n.income, outflow: a.outflow + n.outflow, ahorro: a.ahorro + n.ahorro, apartado: a.apartado + n.apartado, chivas: a.chivas + n.chivas, otro: a.otro + n.otro }), { income: 0, outflow: 0, ahorro: 0, apartado: 0, chivas: 0, otro: 0 })
                      return (
                        <tr className="bg-ink-900 font-bold [&>td]:whitespace-nowrap">
                          <td className="font-display uppercase">Total · {cuts.data!.length} cortes</td>
                          <td className="text-muted">—</td>
                          <td className="text-ok">{cents(t.income)}</td>
                          <td className="text-bad">{cents(t.outflow)}</td>
                          <td>{cents(t.income - t.outflow)}</td>
                          <td>{cents(t.ahorro)}</td>
                          <td>{cents(t.apartado)}</td>
                          <td>{cents(t.chivas)}</td>
                          <td>{cents(t.otro)}</td>
                          <td colSpan={2} />
                        </tr>
                      )
                    })()}
                  </tfoot>
                </table>
              </div>
              </>
            )}
            </FoldCard>
          </div>
      </div>

      <section id="hacer-corte" className="scroll-mt-4 rounded-2xl border border-brand/40 p-3 sm:p-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold uppercase tracking-wide"><Vault className="h-5 w-5 text-brand" /> {editingCut ? 'Corregir corte' : 'Hacer el corte'}</h2>

      {(() => {
        // Avisos: días sin corte (cobros que no se cuentan) y fechas que se enciman con otro corte
        const others = (cuts.data ?? []).filter((c) => c.id !== editingCut?.id)
        const before = others.filter((c) => c.period_to < to).sort((a, b) => b.period_to.localeCompare(a.period_to))[0]
        const overlap = others.find((c) => c.period_from <= to && c.period_to >= from)
        const skipped = before && nextDay(before.period_to) < from ? { from: nextDay(before.period_to), to: from } : null
        const gaps = cutGaps(cuts.data ?? [], payments.data ?? []).filter((g) => g.after.id !== editingCut?.id)
        if (!overlap && !skipped && !gaps.length) return null
        return (
          <Card className="mb-3 space-y-2 border-bad/50 bg-bad/5 p-3 text-sm">
            {skipped && (
              <p className="flex flex-wrap items-center gap-2 text-bad">
                <span>⚠ Te estás saltando días: el corte anterior terminó el <b>{date(before!.period_to, "d 'de' MMM")}</b>. Los cobros desde el {date(skipped.from, "d 'de' MMM")} no entrarían en ningún corte.</span>
                <Button size="sm" variant="secondary" onClick={() => setRange('desde', skipped.from)}>Empezar el {date(skipped.from, "d 'de' MMM")}</Button>
              </p>
            )}
            {overlap && <p className="text-bad">⚠ Estas fechas se enciman con el corte del {date(overlap.cut_date, "d 'de' MMM")}: algunos cobros y pagos se contarían dos veces.</p>}
            {gaps.map((g) => (
              <p key={g.from} className="flex flex-wrap items-center gap-2 text-bad">
                <span>⚠ Del {date(g.from, "d 'de' MMM")} al {date(g.to, "d 'de' MMM")} no hay corte{g.income > 0 ? <>: <b>{cents(g.income)} de cobros no se están contando</b></> : ''}.</span>
                <Button size="sm" variant="secondary" onClick={() => { startEdit(g.after); setParams({ desde: g.from, hasta: g.after.period_to }, { replace: true }) }}>Arreglar el corte del {date(g.after.cut_date, "d 'de' MMM")}</Button>
              </p>
            ))}
          </Card>
        )
      })()}
      {editingCut && (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-2 border-brand/50 bg-brand-dim p-3">
          <p className="text-sm">Estás corrigiendo el corte del <b>{date(editingCut.cut_date, "EEEE d 'de' MMMM")}</b>. Cambia lo que necesites y pica <b>Guardar corrección</b>.</p>
          <Button size="sm" variant="ghost" onClick={resetDraft}>Cancelar corrección</Button>
        </Card>
      )}

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Entradas" value={cents(tot.income)} icon={TrendingUp} tone="ok" hint={byMethod.map(([m, v]) => `${METHOD_LABEL[m]} ${cents(v)}`).join(' · ') || 'Palomea las entradas para contarlas'} />
            <StatCard label="Gastos" value={cents(tot.outflow)} icon={TrendingDown} tone="bad" hint="Sueldos, gastos y pagos de préstamos" />
            <StatCard label="Resultado de estas fechas" value={cents(tot.income - tot.outflow)} icon={Scale} tone={tot.income >= tot.outflow ? 'ok' : 'bad'} hint={tot.income >= tot.outflow ? 'Entró más de lo que salió (sin contar la caja chica)' : 'Salió más de lo que entró (sin contar la caja chica)'} />
          </div>
          <FundProgress month={to.slice(0, 7)} before={from} chivasNew={
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Inscripciones de este corte <b className="font-display text-xl text-brand">{inscCount} · {cents(inscripciones)}</b></p>
                {inscCount > 0 && <button className="text-sm text-brand hover:underline" onClick={applyChivas}>Repartir otra vez</button>}
              </div>
              <ul className="divide-y divide-ink-700 rounded-xl border border-ink-600 bg-ink-800">
                {chivasRows.map((r) => {
                  const on = r.id === 'libre' || chivasOn[r.id]
                  return (
                    <li key={r.id} className={cx('grid grid-cols-[2rem_1fr_8rem] items-center gap-3 px-3 py-2.5', !on && 'opacity-50')}>
                      {r.id === 'libre' ? <span className="text-center text-lg text-brand">=</span> : (
                        <input type="checkbox" checked={on} onChange={(e) => setChivasOn({ ...chivasOn, [r.id]: e.target.checked })} className="h-5 w-5 accent-[#F2E30A]" aria-label={r.label} />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold">{r.label}</p>
                        <p className="text-sm text-muted">{r.field
                          ? <span onDoubleClick={() => editPrice(r.field!, r.id === 'credencial' ? 'credencial' : 'playera', r.price!)} title="Doble clic para cambiar el precio (aplica de aquí en adelante)" className="cursor-pointer underline decoration-dotted">{r.unit}</span>
                          : r.unit}</p>
                      </div>
                      {r.key ? <Input type="number" min="0" inputMode="decimal" value={saveAmt[r.key] ?? ''} placeholder="0" aria-label={r.label} disabled={!on}
                        onChange={(e) => setSaveAmt({ ...saveAmt, [r.key!]: e.target.value })} className="h-10 text-right text-base font-semibold" /> : <span />}
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-sm">Se suma a la Caja Chivas: <b className="text-brand">{cents(chivasRows.reduce((a, r) => a + (r.key ? Number(saveAmt[r.key] || 0) : 0), 0))}</b> <span className="text-muted">· doble clic en un precio para cambiarlo</span></p>
            </>
          } />

          <div className="grid gap-6 xl:grid-cols-2">
            <ReviewList type="entrada" title="Entradas" />
            <ReviewList type="salida" title="Salidas" />
          </div>

          {/* ---------- Sugerencia de ahorro ---------- */}
          <Card>
            <div className="border-b border-ink-600 px-5 py-4">
              <h3 className="flex items-center gap-2 font-display text-xl font-bold uppercase tracking-wide"><PiggyBank className="h-6 w-6 text-brand" /> Caja de ahorro y próximos pagos</h3>
              <p className="text-sm text-muted">Cada caja dice cuánto tiene acumulado y cuánto pones esta vez. Abajo, los próximos pagos ordenados por lo que toca apartar esta semana.
                {expected > 0 ? <> Hay <b className="text-white">{cents(expected)}</b> en caja para repartir.</> : <> <b className="text-warn">Esta semana no hay dinero en caja para ahorrar.</b></>}</p>
            </div>
            {(() => {
              // Las cajas: caja chica = lo de esta semana; las demás = lo juntado antes. "Sugerir" llena lo que toca a cada caja.
              const ahorroAntes = box?.saved ?? 0
              const isApartado = (f: SavingFund) => f.kind !== 'ahorro' && f.kind !== 'uniformes' && f.kind !== 'chivas' && f.kind !== 'seguro'
              const apartadoAntes = funds.filter(isApartado).reduce((a, f) => a + f.saved, 0)
              const unifAntes = funds.filter((f) => f.kind === 'uniformes').reduce((a, f) => a + f.saved, 0)
              const sugApartado = () => setSaveAmt((x) => ({ ...x, ...Object.fromEntries(funds.filter(isApartado).map((f) => [f.key, String(f.suggested)])) }))
              const pill = (onClick: () => void) => <button type="button" onClick={onClick} title="Llena lo que se sugiere apartar esta semana" className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-ink shadow-sm hover:brightness-105">Usar sugerencia</button>
              const apartadoNow = funds.filter(isApartado).reduce((a, f) => a + savedNow(f), 0)
              const unifNow = funds.filter((f) => f.kind === 'uniformes').reduce((a, f) => a + savedNow(f), 0)
              const ahorroNow = box ? savedNow(box) : 0
              return (
                <div className="grid gap-3 border-b border-ink-600 p-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-ink-600 bg-ink-800 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Acumulado · Apartado próx. gastos</p>
                    <p className="mt-1 font-display text-2xl font-bold">{cents(apartadoAntes + unifAntes)}</p>
                    <p className="text-xs text-muted">Lo que ya estaba guardado para regalías, renta y pagos pendientes</p>
                  </div>
                  <div className="rounded-2xl border border-brand/50 bg-brand/5 p-3">
                    <div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Nuevo ahorro · Apartado próx. gastos</p>{pill(sugApartado)}</div>
                    <p className="mt-1 font-display text-2xl font-bold text-brand">+ {cents(apartadoNow + unifNow)}</p>
                    <p className="text-xs text-muted">Lo que se aparta en este corte · queda en {cents(apartadoAntes + unifAntes + apartadoNow + unifNow)}</p>
                  </div>
                  <div className="rounded-2xl border border-bad/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Caja Chivas</p>
                    <p className="mt-1 font-display text-2xl font-bold text-brand">+ {cents(funds.filter((f) => f.kind === 'chivas' || f.kind === 'seguro').reduce((a, f) => a + savedNow(f), 0))}</p>
                    <p className="text-xs text-muted">Las inscripciones de este corte (ver la distribución arriba)</p>
                  </div>
                  <div className="rounded-2xl border border-ok/50 bg-ok/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Saldo en caja → Caja de ahorro</p>
                    <p className="mt-1 font-display text-2xl font-bold text-ok">+ {cents(ahorroNow)}</p>
                    <p className="text-xs text-muted">Lo que queda se guarda en la Caja de ahorro · tenía {cents(ahorroAntes)}, queda en <b className="text-white">{cents(ahorroAntes + ahorroNow)}</b></p>
                  </div>
                </div>
              )
            })()}
            {funds.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No hay pagos grandes por juntar.</p> : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Próximo pago</th><th>Total</th><th>En # días</th><th>Mensual</th><th>Sugerencia</th><th>Se guarda</th></tr></thead>
                  <tbody>
                    {[...funds].filter((f) => f.kind === 'fijo' || f.kind === 'parte' || f.kind === 'prestamo').sort((x, y) => y.suggested - x.suggested).map((f) => {
                      const now = savedNow(f)
                      const pctBefore = f.target ? Math.min(100, (f.saved / f.target) * 100) : 0
                      const pctAfter = f.target ? Math.min(100, ((f.saved + now) / f.target) * 100) : 0
                      const days = Math.max(0, Math.round((new Date(f.due + 'T12:00:00').getTime() - new Date(to + 'T12:00:00').getTime()) / 86_400_000))
                      // Cuánto es al mes: los mensuales su monto; los anuales entre 12; pagos en partes y préstamos no aplica
                      const monthly = days > 45 ? f.target / 12 : f.kind === 'fijo' ? f.target : null
                      const how = f.kind === 'fijo' ? 'la parte de esta semana' : `lo que falta ÷ ${f.weeksLeft} ${f.weeksLeft === 1 ? 'semana' : 'semanas'}`
                      return (
                        <Fragment key={f.key}>
                          <tr className="[&>td]:border-b-0 [&>td]:pb-1">
                            <td>
                              <p className="font-semibold">{f.name}</p>
                              <p className="text-xs text-muted">{FUND_LABEL[f.kind]}{f.debt ? ` · deuda ${cents(f.debt.total)}, falta ${cents(f.debt.total - f.debt.paid)}` : ''}</p>
                            </td>
                            <td className="font-semibold text-brand">{cents(f.target)}</td>
                            <td><b>{days === 0 ? 'Hoy' : `${days} ${days === 1 ? 'día' : 'días'}`}</b><span className="block text-xs text-muted">{date(f.due, "d 'de' MMM")}</span></td>
                            <td>{monthly != null ? cents(monthly) : '—'}</td>
                            <td><span title={`Sugerencia: ${how}`} className="inline-block rounded-lg bg-brand px-2.5 py-1 font-display text-lg font-bold text-ink">{cents(f.suggested)}</span></td>
                            <td><div className="w-36"><Input type="number" min="0" inputMode="decimal" value={saveAmt[f.key] ?? ''} placeholder={String(f.suggested)} aria-label={`Se guarda para ${f.name}`}
                              title="En gris va la sugerencia: pica el cuadro para usarla o escribe otra cantidad"
                              onFocus={() => { if (saveAmt[f.key] == null || saveAmt[f.key] === '') setSaveAmt((x) => ({ ...x, [f.key]: String(f.suggested) })) }}
                              onChange={(e) => setSaveAmt({ ...saveAmt, [f.key]: e.target.value })} className="h-10 text-right text-base font-semibold placeholder:font-normal placeholder:text-muted" /></div></td>
                          </tr>
                          {/* Línea de progreso: separa un pago del otro */}
                          <tr>
                            <td colSpan={6} className="!pt-0">
                              <div className="flex items-center gap-3">
                                <div className="relative h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-ink-700">
                                  <div className="absolute inset-y-0 left-0 rounded-full bg-brand/40" style={{ width: `${pctAfter}%` }} />
                                  <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${pctBefore}%` }} />
                                </div>
                                <span className="shrink-0 whitespace-nowrap text-sm"><b className={pctAfter >= 100 ? 'text-ok' : 'text-brand'}>Vas al {Math.round(pctAfter)}%</b> <span className="text-muted">· guardado {cents(f.saved)}{now > 0 ? ` + ${cents(now)} hoy` : ''}</span></span>
                                <button type="button" onClick={() => setSaveAmt({ ...saveAmt, [f.key]: '0' })} className="shrink-0 text-sm text-muted hover:underline">Nada</button>
                                <div className="w-56 shrink-0"><Input value={saveNote[f.key] ?? ''} onChange={(e) => setSaveNote({ ...saveNote, [f.key]: e.target.value })} placeholder="Nota" className="h-8 text-sm" aria-label="Nota" /></div>
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 bg-ink-900 px-5 py-3">
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted">Sugerido esta semana {cents(suggestedTotal)}
                {funds.length > 1 && <button className="text-brand hover:underline" onClick={() => setSaveAmt({ ...saveAmt, ...Object.fromEntries(funds.filter((f) => f.kind !== 'ahorro' && f.kind !== 'uniformes').map((f) => [f.key, String(f.suggested)])) })}>Guardar todo lo sugerido</button>}
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
                  <div className="flex justify-between px-3 py-2"><span>{carry < 0 ? 'Faltante del corte anterior' : 'Caja chica anterior'}</span><b className={carry < 0 ? 'text-bad' : ''}>{cents(carry)}</b></div>
                  <Breakdown label="+ Total de entradas" total={tot.income} tone="text-ok"
                    lines={(() => {
                      // Agrupado por concepto: inscripciones, mensualidades, etc., con su subtotal y el total al final
                      const ins = items.filter((i) => i.type === 'entrada' && counts(i))
                      const concept = (i: CutItem) => i.detail.split(' · ')[0] || 'Otro'
                      const order = ['Inscripción', 'Reinscripción', 'Mensualidad']
                      const groups = [...new Set(ins.map(concept))].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99 || a.localeCompare(b))
                      const lines = groups.flatMap((g) => {
                        const l = ins.filter((i) => concept(i) === g)
                        const label = g === 'Inscripción' ? 'Inscripciones' : g === 'Reinscripción' ? 'Reinscripciones' : g === 'Mensualidad' ? 'Mensualidades' : g
                        return [[`${label.toUpperCase()} (${l.length})`, l.reduce((a, i) => a + itemValue(i), 0), true] as const, ...l.map((i) => [i.concept, itemValue(i)] as const)]
                      })
                      return lines.length ? [...lines, ['TOTAL DE ENTRADAS', tot.income, true] as const] : lines
                    })()} />
                  <Breakdown label="− Total de salidas" total={tot.outflow} tone="text-bad"
                    lines={OUT_GROUPS.flatMap((g) => {
                      const l = items.filter((i) => i.type === 'salida' && counts(i) && outGroup(i) === g.id)
                      return l.length ? [[g.label.toUpperCase(), l.reduce((a, i) => a + itemValue(i), 0), true] as const, ...l.map((i) => [`${i.concept}`, itemValue(i)] as const)] : []
                    })} />
                  <Breakdown label="− Total en cajas de ahorro" total={savingsTotal} tone="text-brand"
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

          <p className="text-xs text-muted">Los sueldos semanales cuentan el miércoles · gastos mensuales el día 1 · gastos del mes y pagos en partes el día que se pagaron. Se editan en <Link to="/gastos" className="text-brand hover:underline">Gastos</Link>.</p>
        </div>
      )}
      </section>

      <Modal open={confirming} onClose={() => setConfirming(false)} title={editingCut ? 'Confirmar corrección del corte' : 'Confirmar corte de caja'}
        footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Revisar otra vez</Button><Button icon={Check} onClick={save} loading={saving}>Confirmar corte</Button></>}>
        <div className="space-y-4 text-sm">
          <Field label="Día del corte"><Input type="date" value={to} min={from} max={t} onChange={(e) => e.target.value && setRange('hasta', e.target.value)} /></Field>
          <p className="text-muted">Del {range(from, to)}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-ink-900 p-3">
            <span>Entradas</span><b className="text-right text-ok">{cents(tot.income)}</b>
            <span>Gastos</span><b className="text-right text-bad">{cents(tot.outflow)}</b>
            <span>Saldo después de apartar</span><b className="text-right">{cents(expected)}</b>
            <span className="font-semibold">Dinero contado</span><b className="text-right text-brand">{cents(countedN)}</b>
          </div>
          <div>
            <p className="mb-1 font-semibold">A dónde se va</p>
            {distributionNow().length === 0 ? <p className="text-muted">Nada asignado.</p> : (
              <ul className="space-y-1">{distributionNow().map((x) => <li key={x.to} className={cx('flex justify-between', x.amount < 0 && 'text-bad')}><span>{x.to}</span><b>{cents(Math.abs(x.amount))}</b></li>)}</ul>
            )}
            {toJustify > 0.5 && <p className="mt-1 text-bad">Faltaron {cents(deficit)} y falta explicar de dónde salieron {cents(toJustify)}.</p>}
            {left > 0.5 && <p className="mt-1 text-muted">Los {cents(left)} sin destino se van a la <b>Caja de ahorro</b> (la caja chica queda en cero).</p>}
            {left < -0.5 && <p className="mt-1 text-warn">Te pasaste por {cents(-left)}</p>}
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
            <ReportButtons cut={sent} />
            <PdfButton cut={sent} className="w-full" />
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

/** Enviar el reporte del corte: primero se ve, se puede corregir, copiar y mandar a quien sea. */
function ReportButtons({ cut, small, iconOnly }: { cut: CashCut; small?: boolean; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {iconOnly
        ? <button type="button" onClick={() => setOpen(true)} title="Reporte por WhatsApp" aria-label="Reporte por WhatsApp" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-wa text-ink hover:brightness-110"><MessageCircle className="h-4 w-4" /></button>
        : <Button variant="whatsapp" size={small ? 'sm' : 'md'} icon={MessageCircle} onClick={() => setOpen(true)} className={small ? '' : 'w-full'}>
            {small ? 'Reporte' : 'Ver y enviar el reporte por WhatsApp'}
          </Button>}
      {open && <ReportModal cut={cut} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Descarga el corte en un PDF visual (resumen, gráficas y todo el detalle). */
function PdfButton({ cut, small, className, iconOnly }: { cut: CashCut; small?: boolean; className?: string; iconOnly?: boolean }) {
  const cuts = useCashCuts()
  const expenses = useExpenses()
  const settings = useSettings()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const prev = (cuts.data ?? []).find((x) => x.period_to < cut.period_from && x.id !== cut.id)
      const { renderCutPdf, cutBoxes } = await import('@/pdf/cutPdf')
      const seguroGasto = Number((expenses.data ?? []).find((e) => /seguro/i.test(e.name) && e.active)?.amount ?? 0)
      const cfg = chivasConfig(settings.data, seguroGasto)
      const boxes = cutBoxes(cut, cuts.data ?? [], expenses.data ?? [], { anual: cfg.seguroAnual, meta: cfg.meta })
      downloadBlob(await renderCutPdf(cut, prev, boxes), `Corte de caja ${cut.cut_date}.pdf`)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  if (iconOnly) return <IconButton icon={FileText} label="Descargar PDF del corte" onClick={go} className={cx('h-8 w-8', busy && 'animate-pulse')} />
  return <Button variant="secondary" size={small ? 'sm' : 'md'} icon={FileText} loading={busy} onClick={go} className={className}>{small ? 'PDF' : 'Descargar PDF del corte'}</Button>
}

function ReportModal({ cut, onClose }: { cut: CashCut; onClose: () => void }) {
  const cuts = useCashCuts()
  const toast = useToast()
  const prev = (cuts.data ?? []).find((x) => x.period_to < cut.period_from && x.id !== cut.id)
  const [text, setText] = useState<string | null>(null)
  const value = text ?? cutReportText(cut, prev)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast.ok('Reporte copiado. Pégalo en el chat o grupo que quieras.') } catch { toast.error('No se pudo copiar; selecciónalo y cópialo.') }
  }
  return (
    <Modal open onClose={onClose} title="Reporte del corte" wide
      footer={<>
        <PdfButton cut={cut} />
        <Button variant="secondary" onClick={copy}>Copiar</Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(value)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-wa px-4 text-sm font-semibold text-wa hover:bg-wa/10"><MessageCircle className="h-4 w-4" /> Otro chat o grupo</a>
        {REPORT_TO.map((r) => (
          <a key={r.phone} href={waLink(r.phone, value)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-wa px-4 text-sm font-semibold text-ink hover:brightness-110">
            <MessageCircle className="h-4 w-4" /> {r.name}
          </a>
        ))}
      </>}>
      <p className="mb-2 text-sm text-muted">Así se va a ver en WhatsApp (las *palabras con asteriscos* salen en negritas). Puedes corregirlo antes de mandarlo.</p>
      <Textarea rows={22} value={value} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" />
    </Modal>
  )
}

/** Formulario corto para agregar un pago o un gasto que no estaba registrado. */
function ManualLineForm({ type, defaultDate, onAdd, onCancel }: { type: CutItem['type']; defaultDate: string; onAdd: (i: CutItem) => void; onCancel: () => void }) {
  const [f, setF] = useState({ concept: '', amount: '', date: defaultDate, note: '' })
  const ok = f.concept.trim() && Number(f.amount) > 0
  return (
    <div className="grid gap-2 border-b border-ink-600 bg-ink-900 px-4 py-3 sm:grid-cols-[1fr_120px_150px]">
      <Input value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder={type === 'entrada' ? '¿De quién o de qué? Ej. pago en efectivo de Juan' : '¿En qué se gastó? Ej. garrafones de agua'} className="h-10" autoFocus />
      <Input type="number" min="0" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="Monto" className="h-10" />
      <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="h-10" />
      <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Nota (por qué se agrega)" className="h-10 sm:col-span-2" />
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={!ok} onClick={() => onAdd(manualItem(type, f.date, f.concept.trim(), Number(f.amount), f.note.trim()))}>{type === 'entrada' ? 'Agregar pago' : 'Agregar gasto'}</Button>
      </div>
    </div>
  )
}

function CutRow({ cut: c, prev, focus, mobile, onEdit, onDelete }: { cut: CashCut; prev?: CashCut; focus?: boolean; mobile?: boolean; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState<CutItem['type'] | null>(null)
  // Si se llegó desde otro lado a "ver este corte", se abre solo y la página baja hasta él
  const [expanded, setExpanded] = useState(!!focus)
  useEffect(() => {
    if (focus) setTimeout(() => document.getElementById(`corte-${c.id}${mobile ? '-m' : ''}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
  }, [focus, c.id])
  const [adding, setAdding] = useState(false)
  const addLine = async (it: CutItem) => {
    try {
      const all = [...(c.items ?? []), it] as CutItem[]
      const tot = itemTotals(all)
      unwrap(await supabase.from('cash_cuts').update({ items: all, income: tot.income, outflow: tot.outflow }).eq('id', c.id))
      await notify(`${it.type === 'entrada' ? 'Se agregó un pago' : 'Se agregó un gasto'} al corte del ${date(c.cut_date, "d 'de' MMM")}`,
        `${it.concept}: ${cents(it.amount)}${it.note ? ` · ${it.note}` : ''} · ahora ${it.type === 'entrada' ? `entró ${cents(tot.income)}` : `salió ${cents(tot.outflow)}`}`)
      await Promise.all(['cash_cuts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(it.type === 'entrada' ? 'Pago agregado al corte' : 'Gasto agregado al corte')
      setAdding(false)
    } catch (e) { toast.error(e) }
  }
  const assigned = c.distribution.filter((x) => Number(x.amount) > 0 && x.to !== 'Ahorros apartados').reduce((a, x) => a + Number(x.amount), 0)
  const items = c.items ?? []
  const adjusted = items.filter((i) => i.adjusted != null)
  const savings = (c.savings ?? []).filter((s) => Number(s.saved) > 0)
  const had = carryOverOf(prev)
  const savedTotal = savings.reduce((a, s) => a + Number(s.saved), 0)
  const covered = c.distribution.filter((x) => Number(x.amount) < 0).reduce((a, x) => a - Number(x.amount), 0)
  const should = had + Number(c.income) - Number(c.outflow) - savedTotal + covered
  const diff = Number(c.counted) - should
  const cents = (n: number) => money(Math.round(n)).replace('.00', '')
  const show = (t: CutItem['type']) => { setExpanded(true); setOpen(open === t ? null : t); setAdding(false) }
  // A qué caja se fue el saldo (mismos nombres que el Dashboard)
  const isChivas = (k: string, name: string) => k.startsWith('x:chivas') || /seguro/i.test(name)
  const box = {
    ahorro: savings.filter((x) => x.key === SAVINGS_BOX_KEY),
    chivas: savings.filter((x) => isChivas(x.key, x.name)),
    apartado: savings.filter((x) => x.key !== SAVINGS_BOX_KEY && !isChivas(x.key, x.name)),
  }
  const sumOf = (xs: { saved: number | string }[]) => xs.reduce((a, x) => a + Number(x.saved), 0)
  const listOf = (xs: { name: string; saved: number | string }[]) => xs.map((x) => `${x.name} ${cents(Number(x.saved))}`).join(' · ')
  const others = c.distribution.filter((x) => Number(x.amount) > 0 && x.to !== 'Ahorros apartados')
  const othersTotal = others.reduce((a, x) => a + Number(x.amount), 0)
  const cell = (xs: { name: string; saved: number | string }[]) => sumOf(xs) > 0 ? <Explain why={listOf(xs)}>{cents(sumOf(xs))}</Explain> : <span className="text-muted">—</span>
  const status = should < -0.5 ? <Badge tone="bad">Faltó {cents(-should)}</Badge> : diff < -0.5 ? <Badge tone="bad">Faltan {cents(-diff)}</Badge> : diff > 0.5 ? <Badge tone="info">Sobran {cents(diff)}</Badge> : <Badge tone="ok">Cuadra</Badge>
  const actions = mobile ? (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <ReportButtons cut={c} small />
      <PdfButton cut={c} small />
      <IconButton icon={Pencil} label="Corregir corte" onClick={onEdit} className="h-8 w-8" />
      <IconButton icon={Trash2} label="Eliminar corte" onClick={onDelete} className="h-8 w-8" />
    </div>
  ) : (
    <div className="flex items-center justify-end gap-0.5">
      <ReportButtons cut={c} small iconOnly />
      <PdfButton cut={c} small iconOnly />
      <IconButton icon={Pencil} label="Corregir corte" onClick={onEdit} className="h-8 w-8" />
      <IconButton icon={Trash2} label="Eliminar corte" onClick={onDelete} className="h-8 w-8" />
    </div>
  )
  const detail = (
            <div className="space-y-2 pl-5 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs uppercase tracking-wider text-muted">A dónde se fue:</span>
                {c.distribution.map((x, i) => <Badge key={i} tone={Number(x.amount) < 0 ? 'bad' : x.to.toLowerCase() === CARRY_DESTINATION.toLowerCase() ? 'brand' : 'neutral'}>{x.to} · {cents(Math.abs(Number(x.amount)))}</Badge>)}
                {Math.abs(Number(c.counted) - assigned) > 0.5 && <Badge tone="warn">Sin asignar {cents(Number(c.counted) - assigned)}</Badge>}
              </div>
              {savings.length > 0 && <p className="text-xs text-muted">Ahorro: {savings.map((s) => `${s.name} ${cents(Number(s.saved))}`).join(' · ')}</p>}
              {adjusted.length > 0 && <p className="text-xs text-warn">Correcciones: {adjusted.map((i) => `${i.concept} ${cents(i.amount)} → ${cents(Number(i.adjusted))}${i.note ? ` (${i.note})` : ''}`).join(' · ')}</p>}
              {c.notes && <p className="text-muted">📝 {c.notes}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant={open === 'entrada' ? 'primary' : 'secondary'} onClick={() => show('entrada')}>Ver lo que entró</Button>
                <Button size="sm" variant={open === 'salida' ? 'primary' : 'secondary'} onClick={() => show('salida')}>Ver lo que salió</Button>
              </div>
              {open && (() => {
                const l = items.filter((i) => i.type === open && counts(i))
                const groupOf = (i: CutItem) => (open === 'salida' ? OUT_GROUPS.find((g) => g.id === outGroup(i))!.label : (i.detail.split(' · ')[0] || 'Otro'))
                const groups = [...new Set(l.map(groupOf))]
                return (
                  <div className="mt-3 rounded-xl bg-ink-900 p-3">
                    <div className="space-y-0.5 font-mono text-xs text-muted">
                      {l.length === 0 && <p>Nada.</p>}
                      {groups.map((g) => {
                        const gl = l.filter((i) => groupOf(i) === g)
                        return (
                          <div key={g}>
                            <p className="flex justify-between pt-1.5 font-semibold text-white"><span>{g.toUpperCase()} ({gl.length})</span><span>{cents(gl.reduce((a, i) => a + itemValue(i), 0))}</span></p>
                            {gl.map((i) => <p key={i.key} className="flex justify-between gap-3"><span className="truncate">· {i.concept}{isManual(i) ? ' (agregado a mano)' : ''}{i.note ? ` — ${i.note}` : ''}</span><span>{cents(itemValue(i))}</span></p>)}
                          </div>
                        )
                      })}
                      <p className="flex justify-between border-t border-ink-600 pt-1.5 font-semibold text-white"><span>TOTAL</span><span>{cents(open === 'entrada' ? Number(c.income) : Number(c.outflow))}</span></p>
                    </div>
                    {adding
                      ? <div className="mt-3 overflow-hidden rounded-xl border border-ink-600"><ManualLineForm type={open} defaultDate={c.cut_date} onCancel={() => setAdding(false)} onAdd={addLine} /></div>
                      : <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setAdding(true)}>{open === 'entrada' ? 'Agregar un pago para cuadrar' : 'Agregar un gasto para cuadrar'}</Button>}
                  </div>
                )
              })()}
            </div>
  )
  // Celular: cada corte en su tarjeta (sin tabla que se recorra de lado)
  if (mobile) return (
    <div id={`corte-${c.id}-m`} className={cx('rounded-2xl border border-ink-600 bg-ink-800 p-4', focus && 'ring-2 ring-brand')}>
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-start justify-between gap-2 text-left">
        <span>
          <span className="flex items-center gap-1.5 text-lg font-bold"><ChevronDown className={cx('h-4 w-4 text-brand transition-transform', !expanded && '-rotate-90')} />{date(c.period_to, "d 'de' MMM")}</span>
          <span className="block pl-5 text-sm text-muted">desde {date(c.period_from, "d 'de' MMM")}</span>
        </span>
        {status}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <button type="button" onClick={() => show('entrada')} className="rounded-xl bg-ink-900 p-2 text-left"><span className="block text-xs text-muted">Entradas</span><b className="text-ok">{cents(Number(c.income))}</b></button>
        <button type="button" onClick={() => show('salida')} className="rounded-xl bg-ink-900 p-2 text-left"><span className="block text-xs text-muted">Gastos</span><b className="text-bad">{cents(Number(c.outflow))}</b></button>
        <div className="rounded-xl bg-ink-900 p-2"><span className="block text-xs text-muted">Saldo</span><b>{cents(should + savedTotal)}</b></div>
        <div className="rounded-xl bg-ink-900 p-2"><span className="block text-xs text-muted">Caja de ahorro</span><b className="text-ok">{cents(sumOf(box.ahorro))}</b></div>
        <div className="rounded-xl bg-ink-900 p-2"><span className="block text-xs text-muted">Apartado próx. gastos</span><b>{cents(sumOf(box.apartado))}</b></div>
        <div className="rounded-xl bg-ink-900 p-2"><span className="block text-xs text-muted">Caja Chivas</span><b className="text-brand">{cents(sumOf(box.chivas))}</b></div>
      </div>
      <div className="mt-3">{actions}</div>
      {expanded && <div className="mt-3 border-t border-ink-600 pt-3">{detail}</div>}
    </div>
  )
  return (
    <>
      <tr id={`corte-${c.id}`} className={cx('cursor-pointer', expanded && 'bg-ink-900', focus && 'ring-2 ring-inset ring-brand')} onClick={() => setExpanded(!expanded)}>
        <td>
          <p className="flex items-center gap-1.5 whitespace-nowrap font-bold"><ChevronDown className={cx('h-4 w-4 shrink-0 text-brand transition-transform', !expanded && '-rotate-90')} />{date(c.period_to, "d 'de' MMM")}</p>
          <p className="whitespace-nowrap pl-5 text-xs text-muted">desde {date(c.period_from, "d 'de' MMM")}</p>
        </td>
        <td><Explain why="Lo que quedó en caja chica en el corte anterior">{cents(had)}</Explain></td>
        <td><button onClick={(e) => { e.stopPropagation(); show('entrada') }} className="font-semibold text-ok hover:underline">{cents(Number(c.income))}</button></td>
        <td><button onClick={(e) => { e.stopPropagation(); show('salida') }} className="font-semibold text-bad hover:underline">{cents(Number(c.outflow))}</button></td>
        <td><Explain why={`Caja chica al empezar ${cents(had)} + entradas ${cents(Number(c.income))} − gastos ${cents(Number(c.outflow))}${covered ? ` + vino de otro lado ${cents(covered)}` : ''}`}>{cents(should + savedTotal)}</Explain></td>
        <td>{cell(box.ahorro)}</td>
        <td>{cell(box.apartado)}</td>
        <td>{cell(box.chivas)}</td>
        <td>{othersTotal > 0 || Number(c.counted) > 0.5 ? <Explain why={[...others.map((x) => `${x.to} ${cents(Number(x.amount))}`), Math.abs(Number(c.counted) - othersTotal) > 0.5 ? `Sin destino (caja chica) ${cents(Number(c.counted) - othersTotal)}` : ''].filter(Boolean).join(' · ')}>{cents(Number(c.counted))}</Explain> : <span className="text-muted">—</span>}</td>
        <td>{status}</td>
        <td onClick={(e) => e.stopPropagation()}>{actions}</td>
      </tr>
      {expanded && (
        <tr className="bg-ink-900">
          <td colSpan={11} className="!pt-0">
            {detail}
          </td>
        </tr>
      )}
    </>
  )
}

/** Columnas de "Cortes anteriores" con lo que significa cada una (sale al dejar el mouse encima). */
const CUT_COLUMNS: [string, string][] = [
  ['Corte', 'Día en que terminó el corte y desde qué día cuenta'],
  ['Caja chica inicial', 'Lo que quedó en caja chica del corte anterior (con la regla nueva siempre es $0)'],
  ['Entradas', 'Todo lo que se cobró en esas fechas: mensualidades, inscripciones, uniformes…'],
  ['Gastos', 'Todo lo que salió: sueldos, gastos administrativos, gastos del mes y pagos de préstamos'],
  ['Saldo', 'Caja chica inicial + entradas − gastos: el dinero que hay que repartir en las cajas'],
  ['Ahorro', 'Caja de ahorro: lo que se guardó sin un gasto asignado (lo que sobra sin destino va aquí)'],
  ['Apartado', 'Apartado de próximos gastos: lo guardado para regalías, renta, pagos en partes, préstamos y el fondo de uniformes'],
  ['Chivas', 'Caja Chivas: las inscripciones, repartidas en credenciales, playeras, seguro y libre'],
  ['Otro / caja chica', 'Lo que se mandó a otro lado (por ejemplo el viaje a Guadalajara) o lo que se quedó en caja chica'],
  ['¿Cuadra?', 'Si el saldo se repartió completo: Cuadra, Faltan (se contó menos) o Sobran'],
]

/** Los números de un corte, separados por caja (para los totales). */
function cutNums(c: CashCut, prev?: CashCut) {
  const sv = (c.savings ?? []).filter((x) => Number(x.saved) > 0)
  const isChivas = (k: string, name: string) => k.startsWith('x:chivas') || /seguro/i.test(name)
  const sum = (xs: typeof sv) => xs.reduce((a, x) => a + Number(x.saved), 0)
  return {
    had: carryOverOf(prev), income: Number(c.income), outflow: Number(c.outflow),
    ahorro: sum(sv.filter((x) => x.key === SAVINGS_BOX_KEY)),
    chivas: sum(sv.filter((x) => isChivas(x.key, x.name))),
    apartado: sum(sv.filter((x) => x.key !== SAVINGS_BOX_KEY && !isChivas(x.key, x.name))),
    otro: Number(c.counted),
  }
}
