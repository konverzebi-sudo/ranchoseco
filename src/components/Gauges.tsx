import type { ReactNode } from 'react'
import { Card, cx } from './ui'

/** Color según qué tan lleno va: verde completo, amarillo más de la mitad, rojo va atrás. */
export const gaugeTone = (pct: number | null) => (pct == null ? 'info' : pct >= 99.5 ? 'ok' : pct >= 50 ? 'brand' : 'bad')
const STROKE: Record<string, string> = { ok: '#22C55E', brand: '#E5D400', bad: '#EF4444', info: '#60A5FA' }

/**
 * Medidor tipo gasolina: medio círculo que se va llenando, con el % grande en medio.
 * Si pasa de 100% el medidor se ve lleno y el número dice el % real.
 */
export function Gauge({ pct, label, sub, title, onClick }: { pct: number | null; label: string; sub?: ReactNode; title?: string; onClick?: () => void }) {
  const tone = gaugeTone(pct)
  const fill = pct == null ? 0 : Math.min(100, Math.max(0, pct))
  const R = 52, C = Math.PI * R
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title}
      className={cx('flex flex-col items-center rounded-2xl p-2 text-center', onClick && 'transition hover:bg-ink-700')}>
      <svg viewBox="0 0 128 74" className="w-full max-w-[150px]" role="img" aria-label={`${label}: ${pct == null ? 'sin meta' : `${Math.round(pct)}%`}`}>
        <path d="M 12 66 A 52 52 0 0 1 116 66" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" className="text-ink-700" />
        <path d="M 12 66 A 52 52 0 0 1 116 66" fill="none" stroke={STROKE[tone]} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(C * fill) / 100} ${C}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
        <text x="64" y="62" textAnchor="middle" className="fill-current font-display" style={{ fontSize: 24, fontWeight: 700 }}>
          {pct == null ? '—' : `${Math.round(pct)}%`}
        </text>
      </svg>
      <p className="mt-1 font-semibold leading-tight">{label}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </Tag>
  )
}

/** Recuadro con varios medidores alineados. */
export function GaugeGrid({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {/* Se acomodan solos: si cabe, todos en un renglón; si la ventana es chica, bajan a más renglones */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))' }}>{children}</div>
    </Card>
  )
}
