import { OUT_GROUPS, carryOver, counts, cutBalance, itemValue, outGroup, type CutItem } from './cashcut'
import { METHOD_LABEL, date, money } from './format'
import type { CashCut, PaymentMethod } from './types'

const SOURCE_PREFIX = 'Vino de: '
const m = (n: number) => money(Math.round(n * 100) / 100).replace('.00', '')
const LINE = '━━━━━━━━━━━━━━'

export interface CutSummary {
  cut: CashCut
  had: number
  income: number
  outflow: number
  saved: number
  coveredTotal: number
  balance: number
  counted: number
  /** contado − debería haber (negativo = faltan) */
  diff: number
  byConcept: { label: string; n: number; total: number }[]
  byMethod: { label: string; total: number }[]
  ins: CutItem[]
  outGroups: { label: string; total: number; items: { concept: string; date: string; value: number; was: number | null; note: string }[] }[]
  savings: { name: string; saved: number }[]
  covered: { from: string; amount: number }[]
  sent: { to: string; amount: number }[]
  elsewhere: { concept: string; value: number; note: string }[]
  fixes: { concept: string; note: string }[]
  notes: string
}

/** Todos los números del corte, listos para el reporte de WhatsApp o el PDF. */
export function cutSummary(c: CashCut, prev?: Pick<CashCut, 'distribution'>): CutSummary {
  const items = (c.items ?? []) as CutItem[]
  const ins = items.filter((i) => i.type === 'entrada' && counts(i))
  const outs = items.filter((i) => i.type === 'salida' && counts(i))
  const income = ins.reduce((a, i) => a + itemValue(i), 0)
  const outflow = outs.reduce((a, i) => a + itemValue(i), 0)
  const savings = (c.savings ?? []).filter((s) => Number(s.saved) > 0).map((s) => ({ name: s.name, saved: Number(s.saved) }))
  const covered = (c.distribution ?? []).filter((x) => Number(x.amount) < 0).map((x) => ({ from: x.to.replace(SOURCE_PREFIX, ''), amount: -Number(x.amount) }))
  const sent = (c.distribution ?? []).filter((x) => Number(x.amount) > 0 && x.to !== 'Ahorros apartados').map((x) => ({ to: x.to, amount: Number(x.amount) }))
  const balance = cutBalance(c, prev)
  const counted = Number(c.counted)

  // Entradas por concepto (mensualidades, inscripciones…) y por forma de pago
  // Se juntan sin importar mayúsculas ni acentos (INSCRIPCION = Inscripción)
  const key = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const label = new Map<string, string>()
  const byConcept = new Map<string, { n: number; total: number }>()
  const byMethod = new Map<string, number>()
  for (const i of ins) {
    const parts = i.detail.split(' · ')
    const raw = parts[0] || 'Otros'
    const concept = key(raw)
    // Se muestra la forma bien escrita (con acentos y sin mayúsculas sostenidas) si existe
    if (!label.has(concept) || (raw !== raw.toUpperCase() && label.get(concept) === label.get(concept)!.toUpperCase())) label.set(concept, raw)
    const r = byConcept.get(concept) ?? { n: 0, total: 0 }
    r.n++; r.total += itemValue(i); byConcept.set(concept, r)
    const how = METHOD_LABEL[parts.at(-1) as PaymentMethod] ?? 'Otro'
    byMethod.set(how, (byMethod.get(how) ?? 0) + itemValue(i))
  }

  return {
    cut: c,
    had: carryOver(prev),
    income,
    outflow,
    saved: savings.reduce((a, s) => a + s.saved, 0),
    coveredTotal: covered.reduce((a, x) => a + x.amount, 0),
    balance,
    counted,
    diff: counted - balance,
    byConcept: [...byConcept].sort((a, b) => b[1].total - a[1].total).map(([k, r]) => ({ label: label.get(k)!, ...r })),
    byMethod: [...byMethod].map(([label, total]) => ({ label, total })),
    ins,
    outGroups: OUT_GROUPS.map((g) => {
      const list = outs.filter((i) => outGroup(i) === g.id)
      return {
        label: g.label,
        total: list.reduce((a, i) => a + itemValue(i), 0),
        items: list.map((i) => ({ concept: i.concept, date: i.date, value: itemValue(i), was: i.adjusted != null ? Number(i.amount) : null, note: i.note })),
      }
    }).filter((g) => g.items.length),
    savings,
    covered,
    sent,
    elsewhere: items.filter((i) => i.type === 'salida' && i.approved && i.excluded && !i.pending).map((i) => ({ concept: i.concept, value: itemValue(i), note: i.note })),
    fixes: items.filter((i) => i.adjusted != null && i.note).map((i) => ({ concept: i.concept, note: i.note })),
    notes: c.notes?.trim() ?? '',
  }
}

/**
 * Reporte del corte para WhatsApp: primero el resumen (cuánto había, entró, salió, se apartó
 * y cuánto quedó), después el detalle por secciones. Usa *negritas* y viñetas de WhatsApp.
 */
export function cutReportText(c: CashCut, prev?: Pick<CashCut, 'distribution'>) {
  const r = cutSummary(c, prev)
  const out: string[] = [
    `🐎 *RANCHO SECO · CORTE DE CAJA*`,
    `📅 ${cap(date(c.cut_date, "EEEE d 'de' MMMM"))}`,
    `Del ${date(c.period_from, "d 'de' MMM")} al ${date(c.period_to, "d 'de' MMM")}`,
    '',
    `💵 *RESUMEN*`,
    `Había en caja: ${m(r.had)}`,
    `➕ Entró: ${m(r.income)}`,
    `➖ Salió: ${m(r.outflow)}`,
  ]
  if (r.saved > 0) out.push(`🐷 Se apartó: ${m(r.saved)}`)
  if (r.covered.length) out.push(`🤝 Se cubrió con: ${m(r.coveredTotal)}`)
  out.push(LINE)
  if (r.balance < -0.5) out.push(`⚠️ *FALTARON ${m(-r.balance)}* (sin explicar de dónde salió)`)
  else {
    out.push(`💰 *Debería haber: ${m(r.balance)}*`)
    out.push(`🧮 Se contó: ${m(r.counted)}`)
    if (r.diff < -0.5) out.push(`⚠️ *Faltan ${m(-r.diff)}* contra lo que debería haber`)
    else if (r.diff > 0.5) out.push(`➕ Sobran ${m(r.diff)} contra lo que debería haber`)
    else out.push('✅ Cuadra')
  }

  if (r.ins.length) {
    out.push('', `🟢 *ENTRÓ ${m(r.income)}*`)
    for (const x of r.byConcept) out.push(`• ${x.label} (${x.n}): ${m(x.total)}`)
    if (r.byMethod.length > 1) out.push(`   ${r.byMethod.map((x) => `${x.label} ${m(x.total)}`).join(' · ')}`)
  }

  if (r.outGroups.length) {
    out.push('', `🔴 *SALIÓ ${m(r.outflow)}*`)
    for (const g of r.outGroups) {
      out.push(`*${g.label}: ${m(g.total)}*`)
      for (const i of g.items) out.push(`   • ${i.concept}: ${m(i.value)}${i.was != null ? ` (era ${m(i.was)})` : ''}`)
    }
  }

  if (r.savings.length) {
    out.push('', `🐷 *SE APARTÓ ${m(r.saved)}*`)
    for (const s of r.savings) out.push(`• ${s.name}: ${m(s.saved)}`)
  }

  if (r.covered.length) {
    out.push('', `🤝 *LO QUE FALTÓ SALIÓ DE*`)
    for (const x of r.covered) out.push(`• ${x.from}: ${m(x.amount)}`)
  }

  if (r.sent.length) {
    out.push('', `📦 *A DÓNDE SE FUE EL DINERO*`)
    for (const x of r.sent) out.push(`• ${x.to}: ${m(x.amount)}`)
  }

  if (r.elsewhere.length) {
    out.push('', `ℹ️ *Se pagó por fuera de la caja*`)
    for (const i of r.elsewhere) out.push(`• ${i.concept}: ${m(i.value)}${i.note ? ` (${i.note})` : ''}`)
  }

  if (r.fixes.length) {
    out.push('', `✏️ *Correcciones*`)
    for (const i of r.fixes) out.push(`• ${i.concept}: ${i.note}`)
  }
  if (r.notes) out.push('', `📝 ${r.notes}`)
  return out.join('\n')
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
