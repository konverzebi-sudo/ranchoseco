import { cutSummary } from '@/lib/cutReport'
import { CHIVAS_CREDENCIALES_KEY, CHIVAS_KEY, CHIVAS_PLAYERAS_KEY, SAVINGS_BOX_KEY, carryOver, savingFunds } from '@/lib/cashcut'
import { date } from '@/lib/format'
import type { CashCut, Expense } from '@/lib/types'

/** Las cajas como quedaron al terminar ese corte (Caja de ahorro y próximos pagos y la Caja Chivas por dentro). */
export interface CutBoxes {
  chica: number; ahorro: number; apartado: number; chivas: number; uniformes: number; total: number
  chivasParts: { label: string; value: number }[]
  seguro: { saved: number; target: number }
  /** Lo que se puso en cada caja en este corte */
  now: { ahorro: number; apartado: number; chivas: number }
  /** Desglose: cada fondo con su total y lo de este corte */
  detail: { caja: 'Caja de ahorro' | 'Apartado próx. gastos' | 'Caja Chivas'; name: string; total: number; now: number }[]
}

export function cutBoxes(cut: CashCut, allCuts: CashCut[], expenses: Expense[], seguro?: { anual: number; meta: number }): CutBoxes {
  const upTo = allCuts.filter((c) => c.cut_date <= cut.cut_date)
  const funds = savingFunds({ cutDate: cut.cut_date, expenses, cuts: upTo, seguro })
  const val = (k: string) => funds.find((f) => f.key === k)?.saved ?? 0
  const seg = funds.find((f) => f.kind === 'seguro')
  const chivasParts = [
    { label: 'Credenciales', value: val(CHIVAS_CREDENCIALES_KEY) },
    { label: 'Playeras de entrenamiento', value: val(CHIVAS_PLAYERAS_KEY) },
    { label: 'Seguro', value: seg?.saved ?? 0 },
    { label: 'Libre en Caja Chivas', value: val(CHIVAS_KEY) },
  ]
  const ahorro = val(SAVINGS_BOX_KEY)
  const chivas = chivasParts.reduce((a, p) => a + p.value, 0)
  const uniformes = funds.filter((f) => f.kind === 'uniformes').reduce((a, f) => a + f.saved, 0)
  const apartado = funds.filter((f) => f.kind !== 'ahorro' && f.kind !== 'uniformes' && f.kind !== 'chivas' && f.kind !== 'seguro').reduce((a, f) => a + f.saved, 0)
  // Caja chica: lo que se quedó en caja para el siguiente corte (lo mandado a otro lado ya no está)
  const chica = carryOver(cut)
  const nowOf = (k: string) => (cut.savings ?? []).filter((x) => x.key === k).reduce((a, x) => a + Number(x.saved), 0)
  const cajaOf = (f: (typeof funds)[number]) => (f.kind === 'ahorro' ? 'Caja de ahorro' : f.kind === 'chivas' || f.kind === 'seguro' ? 'Caja Chivas' : 'Apartado próx. gastos') as CutBoxes['detail'][number]['caja']
  const detail = funds.map((f) => ({ caja: cajaOf(f), name: f.kind === 'uniformes' ? 'Fondo de uniformes' : f.name, total: f.saved, now: nowOf(f.key) }))
    .filter((x) => x.total > 0.5 || x.now > 0.5)
  const sumNow = (c: string) => detail.filter((x) => x.caja === c).reduce((a, x) => a + x.now, 0)
  return {
    chica, ahorro, apartado: apartado + uniformes, chivas, uniformes, total: chica + ahorro + apartado + chivas + uniformes, chivasParts, seguro: { saved: seg?.saved ?? 0, target: seg?.target ?? 0 },
    now: { ahorro: sumNow('Caja de ahorro'), apartado: sumNow('Apartado próx. gastos'), chivas: sumNow('Caja Chivas') }, detail,
  }
}

/** PDF visual del corte de caja (se carga sólo cuando se pide). */
export async function renderCutPdf(cut: CashCut, prev?: Pick<CashCut, 'distribution'>, boxes?: CutBoxes): Promise<Blob> {
  const [{ pdf }, { CutDocument }] = await Promise.all([import('@react-pdf/renderer'), import('./CutDocument')])
  const logo = new URL(`${import.meta.env.BASE_URL}escudo.png`, window.location.href).href
  const generatedAt = date(new Date().toISOString(), "d 'de' MMMM yyyy, HH:mm")
  return pdf(CutDocument({ r: cutSummary(cut, prev), logo, generatedAt, boxes })).toBlob()
}
