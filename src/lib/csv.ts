import { downloadBlob } from './whatsapp'

/** Exporta filas a CSV compatible con Excel (UTF-8 con BOM, separador coma). */
export function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  downloadBlob(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }), filename)
}
