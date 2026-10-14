import { OUT_GROUPS, carryOver, counts, cutBalance, itemValue, outGroup, type CutItem } from './cashcut'
import { METHOD_LABEL, date, money } from './format'
import type { CashCut, PaymentMethod } from './types'

const SOURCE_PREFIX = 'Vino de: '
const m = (n: number) => money(Math.round(n * 100) / 100).replace('.00', '')
const LINE = '━━━━━━━━━━━━━━'

/**
 * Reporte del corte para WhatsApp: primero el resumen (cuánto había, entró, salió, se apartó
 * y cuánto quedó), después el detalle por secciones. Usa *negritas* y viñetas de WhatsApp.
 */
export function cutReportText(c: CashCut, prev?: Pick<CashCut, 'distribution'>) {
  const items = (c.items ?? []) as CutItem[]
  const ins = items.filter((i) => i.type === 'entrada' && counts(i))
  const outs = items.filter((i) => i.type === 'salida' && counts(i))
  const elsewhere = items.filter((i) => i.type === 'salida' && i.approved && i.excluded && !i.pending)
  const income = ins.reduce((a, i) => a + itemValue(i), 0)
  const outflow = outs.reduce((a, i) => a + itemValue(i), 0)
  const savings = (c.savings ?? []).filter((s) => Number(s.saved) > 0)
  const saved = savings.reduce((a, s) => a + Number(s.saved), 0)
  const covered = (c.distribution ?? []).filter((x) => Number(x.amount) < 0)
  const sent = (c.distribution ?? []).filter((x) => Number(x.amount) > 0 && x.to !== 'Ahorros apartados')
  const had = carryOver(prev)
  const balance = cutBalance(c, prev)

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
    const meth = parts.at(-1) as PaymentMethod
    const how = METHOD_LABEL[meth] ?? 'Otro'
    byMethod.set(how, (byMethod.get(how) ?? 0) + itemValue(i))
  }

  const out: string[] = [
    `🐎 *RANCHO SECO · CORTE DE CAJA*`,
    `📅 ${cap(date(c.cut_date, "EEEE d 'de' MMMM"))}`,
    `Del ${date(c.period_from, "d 'de' MMM")} al ${date(c.period_to, "d 'de' MMM")}`,
    '',
    `💵 *RESUMEN*`,
    `Había en caja: ${m(had)}`,
    `➕ Entró: ${m(income)}`,
    `➖ Salió: ${m(outflow)}`,
  ]
  if (saved > 0) out.push(`🐷 Se apartó: ${m(saved)}`)
  if (covered.length) out.push(`🤝 Se cubrió con: ${m(covered.reduce((a, x) => a - Number(x.amount), 0))}`)
  out.push(LINE)
  if (balance < -0.5) out.push(`⚠️ *FALTARON ${m(-balance)}* (sin explicar de dónde salió)`)
  else {
    const counted = Number(c.counted)
    const diff = counted - balance
    out.push(`💰 *Debería haber: ${m(balance)}*`)
    out.push(`🧮 Se contó: ${m(counted)}`)
    if (diff < -0.5) out.push(`⚠️ *Faltan ${m(-diff)}* contra lo que debería haber`)
    else if (diff > 0.5) out.push(`➕ Sobran ${m(diff)} contra lo que debería haber`)
    else out.push('✅ Cuadra')
  }

  if (ins.length) {
    out.push('', `🟢 *ENTRÓ ${m(income)}*`)
    for (const [k, r] of [...byConcept].sort((a, b) => b[1].total - a[1].total)) out.push(`• ${label.get(k)} (${r.n}): ${m(r.total)}`)
    if (byMethod.size > 1) out.push(`   ${[...byMethod].map(([k, v]) => `${k} ${m(v)}`).join(' · ')}`)
  }

  if (outs.length) {
    out.push('', `🔴 *SALIÓ ${m(outflow)}*`)
    for (const g of OUT_GROUPS) {
      const list = outs.filter((i) => outGroup(i) === g.id)
      if (!list.length) continue
      out.push(`*${g.label}: ${m(list.reduce((a, i) => a + itemValue(i), 0))}*`)
      for (const i of list) out.push(`   • ${i.concept}: ${m(itemValue(i))}${i.adjusted != null ? ` (era ${m(i.amount)})` : ''}`)
    }
  }

  if (savings.length) {
    out.push('', `🐷 *SE APARTÓ ${m(saved)}*`)
    for (const s of savings) out.push(`• ${s.name}: ${m(Number(s.saved))}`)
  }

  if (covered.length) {
    out.push('', `🤝 *LO QUE FALTÓ SALIÓ DE*`)
    for (const x of covered) out.push(`• ${x.to.replace(SOURCE_PREFIX, '')}: ${m(-Number(x.amount))}`)
  }

  if (sent.length) {
    out.push('', `📦 *A DÓNDE SE FUE EL DINERO*`)
    for (const x of sent) out.push(`• ${x.to}: ${m(Number(x.amount))}`)
  }

  if (elsewhere.length) {
    out.push('', `ℹ️ *Se pagó por fuera de la caja*`)
    for (const i of elsewhere) out.push(`• ${i.concept}: ${m(itemValue(i))}${i.note ? ` (${i.note})` : ''}`)
  }

  const fixes = items.filter((i) => i.adjusted != null && i.note)
  if (fixes.length) {
    out.push('', `✏️ *Correcciones*`)
    for (const i of fixes) out.push(`• ${i.concept}: ${i.note}`)
  }
  if (c.notes?.trim()) out.push('', `📝 ${c.notes.trim()}`)
  return out.join('\n')
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
