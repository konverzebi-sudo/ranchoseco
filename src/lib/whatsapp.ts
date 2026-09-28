import { monthOnly, plainAmount } from './format'
import type { FeeBalance } from './types'

/**
 * Integración con WhatsApp.
 *
 * - Cobranza y avisos: enlaces wa.me con el número internacional y el texto
 *   codificado. WhatsApp se abre con el mensaje listo; la persona revisa y
 *   presiona "Enviar". Nunca se envía nada automáticamente.
 * - Archivos (PDF): wa.me NO puede adjuntar archivos. Para compartir el PDF se
 *   usa la hoja nativa de compartir del dispositivo (Web Share API), donde el
 *   usuario elige WhatsApp. Si el navegador no lo soporta, se descarga el PDF.
 * - Envío automático: requiere WhatsApp Business Cloud API (plantillas
 *   aprobadas por Meta y un servidor). Ver WhatsAppBusinessProvider abajo.
 */

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

export function fillTemplate(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((t, [k, v]) => t.split(`[${k}]`).join(v), template)
}

/** Mensaje de cobranza con el saldo real de los cargos pendientes. */
export function collectionMessage(template: string, studentName: string, fees: FeeBalance[], portalUrl?: string) {
  const pending = fees.filter((f) => Number(f.balance) > 0).sort((a, b) => a.period.localeCompare(b.period))
  const months = [...new Set(pending.map((f) => monthOnly(f.period)))]
  const monthText = months.length <= 1 ? (months[0] ?? '') : `${months.slice(0, -1).join(', ')} y ${months.at(-1)}`
  const total = pending.reduce((s, f) => s + Number(f.balance), 0)
  const late = pending.reduce((s, f) => s + Number(f.late_fee ?? 0), 0)
  let msg = fillTemplate(template, {
    MES: monthText,
    'NOMBRE DEL ALUMNO': studentName,
    SALDO: plainAmount(total),
  })
  if (late > 0) msg += `\n\nEl saldo incluye $${plainAmount(late)} MXN de recargo por pago tardío.`
  if (portalUrl) msg += `\n\nPuedes consultar su estado de cuenta aquí: ${portalUrl}`
  return { text: msg, total, months, late }
}

export function reportMessage(template: string, studentName: string, period: string, portalUrl?: string) {
  let msg = fillTemplate(template, { 'NOMBRE DEL ALUMNO': studentName, PERIODO: period })
  if (portalUrl) msg += `\n\nTambién puedes ver su seguimiento en línea: ${portalUrl}`
  return msg
}

export const canShareFiles = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] })

/**
 * Comparte un archivo con la hoja nativa del dispositivo (celular: WhatsApp,
 * correo, etc.). Devuelve 'shared', 'cancelled' o 'unsupported'.
 */
export async function shareFile(file: File, text: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFiles()) return 'unsupported'
  try {
    await navigator.share({ files: [file], text, title: file.name })
    return 'shared'
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Punto de extensión para envío automático con WhatsApp Business Cloud API.
 * Debe implementarse en un servidor (p. ej. Supabase Edge Function) porque
 * requiere un token privado de Meta que nunca debe estar en el navegador:
 *   POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages
 *   { messaging_product: 'whatsapp', to, type: 'document', document: { link, filename } }
 * El PDF debe subirse antes a almacenamiento y enviarse como enlace firmado.
 */
export interface WhatsAppBusinessProvider {
  sendDocument(to: string, documentUrl: string, filename: string, caption: string): Promise<void>
  sendTemplate(to: string, template: string, params: string[]): Promise<void>
}
