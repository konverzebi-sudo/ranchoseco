import { describe, expect, it } from 'vitest'
import { cutReportText } from '../src/lib/cutReport'

const item = (type: 'entrada' | 'salida', concept: string, detail: string, amount: number) => ({ key: concept + detail, type, date: '2026-10-05', concept, detail, amount, approved: true, adjusted: null, note: '', excluded: false })

describe('reporte del corte por WhatsApp', () => {
  const cut = {
    id: 'c', cut_date: '2026-10-07', period_from: '2026-10-01', period_to: '2026-10-07', income: 1700, outflow: 700, counted: 900, notes: null,
    distribution: [{ to: 'Caja chica', amount: 900 }], savings: [],
    items: [item('entrada', 'Ana', 'Mensualidad · efectivo', 550), item('entrada', 'Luis', 'INSCRIPCION · efectivo', 600), item('entrada', 'Eva', 'Inscripción · transferencia', 550), item('salida', 'Tonny', 'Sueldo profesor · semanal', 700)],
  }
  const t = cutReportText(cut as never, { distribution: [{ to: 'Caja chica', amount: 100 }] })
  it('resumen claro con lo que debería haber y la diferencia', () => {
    expect(t).toContain('Había en caja: $100')
    expect(t).toContain('➕ Entró: $1,700')
    expect(t).toContain('*Debería haber: $1,100*')
    expect(t).toContain('*Faltan $200*')
  })
  it('junta conceptos aunque estén escritos distinto y separa por forma de pago', () => {
    expect(t).toContain('• Inscripción (2): $1,150')
    expect(t).toContain('Efectivo $1,150 · Transferencia $550')
    expect(t).toContain('• Tonny: $700')
  })
})
