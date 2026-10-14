import { cutSummary } from '@/lib/cutReport'
import { date } from '@/lib/format'
import type { CashCut } from '@/lib/types'

/** PDF visual del corte de caja (se carga sólo cuando se pide). */
export async function renderCutPdf(cut: CashCut, prev?: Pick<CashCut, 'distribution'>): Promise<Blob> {
  const [{ pdf }, { CutDocument }] = await Promise.all([import('@react-pdf/renderer'), import('./CutDocument')])
  const logo = new URL(`${import.meta.env.BASE_URL}escudo.png`, window.location.href).href
  const generatedAt = date(new Date().toISOString(), "d 'de' MMMM yyyy, HH:mm")
  return pdf(CutDocument({ r: cutSummary(cut, prev), logo, generatedAt })).toBlob()
}
