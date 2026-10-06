import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Modal, cx } from './ui'
import { useFees, useStudents } from '@/lib/api'
import { METHOD_LABEL, date, money, monthName } from '@/lib/format'
import type { Payment } from '@/lib/types'

const ORDER = ['Mensualidad', 'Inscripción', 'Reinscripción']

/** Desglose de lo que entró en el mes: por concepto (con cada alumno), por forma de pago y por quién lo recibió. */
export default function IncomeBreakdownModal({ payments, title, onClose }: { payments: Payment[]; title: string; onClose: () => void }) {
  const fees = useFees()
  const students = useStudents()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const d = useMemo(() => {
    const fee = new Map((fees.data ?? []).map((f) => [f.id, f]))
    const name = new Map((students.data ?? []).map((s) => [s.id, s.full_name]))
    const rows = payments.map((p) => {
      const f = fee.get(p.fee_id)
      // Adelanto = se pagó un mes que todavía no llega
      const concept = f ? (f.concept === 'Mensualidad' && f.period.slice(0, 7) > p.paid_at.slice(0, 7) ? 'Mensualidad (adelanto)' : f.concept) : 'Otro'
      return { p, concept, who: name.get(p.student_id) ?? 'Alumno', period: f?.period }
    })
    const groups = new Map<string, typeof rows>()
    for (const r of rows) groups.set(r.concept, [...(groups.get(r.concept) ?? []), r])
    const rank = (k: string) => { const i = ORDER.findIndex((o) => k.startsWith(o)); return i < 0 ? 99 : i }
    const byConcept = [...groups.entries()].map(([k, list]) => ({ k, list: list.sort((a, b) => b.p.paid_at.localeCompare(a.p.paid_at) || a.who.localeCompare(b.who, 'es')), total: list.reduce((a, r) => a + Number(r.p.amount), 0) }))
      .sort((a, b) => rank(a.k) - rank(b.k) || b.total - a.total)
    const sumBy = (key: (r: (typeof rows)[number]) => string) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.p.amount))
      return [...m.entries()].sort((a, b) => b[1] - a[1])
    }
    return {
      byConcept, total: rows.reduce((a, r) => a + Number(r.p.amount), 0),
      byMethod: sumBy((r) => METHOD_LABEL[r.p.method] ?? r.p.method),
      byReceiver: sumBy((r) => r.p.received_by || 'Sin anotar'),
    }
  }, [payments, fees.data, students.data])
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  const Section = ({ id, label, total, children }: { id: string; label: string; total: number; children: React.ReactNode }) => (
    <div className="border-t border-ink-700 first:border-t-0">
      <button type="button" onClick={() => toggle(id)} className="flex w-full items-center justify-between gap-2 py-2 text-left">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
          <ChevronDown className={cx('h-4 w-4 text-brand transition-transform', !open[id] && '-rotate-90')} />{label}
        </span>
        <b>{money(total)}</b>
      </button>
      {open[id] && <div className="pb-2 pl-6">{children}</div>}
    </div>
  )

  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between rounded-xl bg-ok/10 px-4 py-3">
          <span className="font-display text-lg font-bold uppercase">+ Total de entradas</span>
          <span className="font-display text-2xl font-bold text-ok">{money(d.total)}</span>
        </div>
        <p className="text-xs text-muted">{payments.length} pagos. Toca cada concepto para ver quién pagó.</p>
        <div>
          {d.byConcept.map((g) => (
            <Section key={g.k} id={g.k} label={`${g.k} · ${g.list.length}`} total={g.total}>
              <ul className="space-y-1">
                {g.list.map(({ p, who, period }) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3">
                    <Link to={`/alumnos/${p.student_id}?tab=pagos`} className="min-w-0 truncate hover:text-brand">· {who}
                      <span className="text-xs text-muted"> {period ? `${monthName(period)} · ` : ''}{date(p.paid_at, 'd MMM')} · {METHOD_LABEL[p.method]}{p.received_by ? ` · recibió ${p.received_by}` : ''}</span></Link>
                    <span className="shrink-0 tabular-nums text-muted">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-600 p-3">
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Por forma de pago</p>
            {d.byMethod.map(([k, v]) => <p key={k} className="flex justify-between"><span>{k}</span><b>{money(v)}</b></p>)}
          </div>
          <div className="rounded-xl border border-ink-600 p-3">
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Quién lo recibió</p>
            {d.byReceiver.map(([k, v]) => <p key={k} className={cx('flex justify-between', k === 'Sin anotar' && 'text-muted')}><span>{k}</span><b>{money(v)}</b></p>)}
          </div>
        </div>
      </div>
    </Modal>
  )
}
