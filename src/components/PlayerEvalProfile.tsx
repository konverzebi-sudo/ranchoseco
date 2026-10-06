import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Award, Sparkles, Target } from 'lucide-react'
import { Badge, Card, cx } from './ui'
import { date } from '@/lib/format'
import {
  AREAS, SCORE_LABEL, areaLabel, deltaVs, evolution, friendlyLevel, highlights, levelChangeCandidate,
  type EvalTemplate, type PlayerEvalItem, type PlayerEvaluation,
} from '@/lib/evaluation'

const pct = (v: number | null | undefined) => `${Math.max(0, Math.min(100, ((v ?? 0) / 5) * 100))}%`
const barTone = (v: number | null | undefined) => (v == null ? 'bg-ink-600' : v >= 4 ? 'bg-ok' : v >= 3 ? 'bg-brand' : 'bg-warn')

/** Barras de resultado por área + promedio general. */
export function AreaBars({ ev, prev }: { ev: Pick<PlayerEvaluation, 'area_scores' | 'overall'>; prev?: Pick<PlayerEvaluation, 'area_scores' | 'overall'> }) {
  const d = deltaVs(ev, prev)
  const Delta = ({ v }: { v?: number }) => v == null || v === 0 ? null : (
    <span className={cx('ml-1 inline-flex items-center text-xs font-semibold', v > 0 ? 'text-ok' : 'text-warn')}>
      {v > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(v).toFixed(1)}
    </span>
  )
  return (
    <div className="space-y-2.5">
      {AREAS.map((a) => {
        const v = ev.area_scores?.[a.key]
        return (
          <div key={a.key}>
            <div className="flex items-baseline justify-between text-sm"><span>{a.icon} {a.label}</span><span><b>{v != null ? v.toFixed(1) : '—'}</b><span className="text-muted"> / 5</span><Delta v={d?.[a.key]} /></span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-ink-700"><div className={cx('h-full rounded-full', barTone(v))} style={{ width: pct(v) }} /></div>
          </div>
        )
      })}
      <div className="flex items-baseline justify-between border-t border-ink-600 pt-2">
        <span className="font-display text-lg font-bold uppercase">Promedio general</span>
        <span className="font-display text-2xl font-bold text-brand">{ev.overall != null ? Number(ev.overall).toFixed(1) : '—'}<span className="text-sm text-muted"> / 5</span><Delta v={d?.general} /></span>
      </div>
    </div>
  )
}

/** Resultado completo de una evaluación: áreas, fortalezas, áreas de desarrollo, indicadores y evolución. */
export function EvalResult({ ev, items, history, template }: {
  ev: PlayerEvaluation; items: PlayerEvalItem[]; history: PlayerEvaluation[]; template?: EvalTemplate
}) {
  const older = history.filter((h) => h.id !== ev.id && h.evaluated_on <= ev.evaluated_on).sort((a, b) => b.evaluated_on.localeCompare(a.evaluated_on))
  const prev = older[0]
  const h = highlights(ev.area_scores, items)
  const evo = evolution(history.filter((x) => x.evaluated_on <= ev.evaluated_on))
  const candidate = levelChangeCandidate(template, history.filter((x) => x.evaluated_on <= ev.evaluated_on))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{date(ev.evaluated_on)}</span>
        {ev.template_name && <Badge>{ev.template_name}</Badge>}
        {ev.level_label && ev.level_label !== 'General' && <Badge tone="info">{ev.level_label}</Badge>}
        {ev.coach && <span>· Evaluó {ev.coach}</span>}
        {candidate && <Badge tone="ok">Candidato a cambio de nivel</Badge>}
      </div>
      {candidate && <p className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-xs text-ok">Mejora sostenida en sus últimas evaluaciones. Es sólo una sugerencia: el cambio de grupo lo decide el entrenador o la administración.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><AreaBars ev={ev} prev={prev} />{prev && <p className="mt-2 text-xs text-muted">Flechas: comparado con la evaluación del {date(prev.evaluated_on)}.</p>}</Card>
        <Card className="space-y-3 p-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-ok/10 p-2.5"><p className="text-xs text-muted">Área más fuerte</p><p className="font-semibold text-ok">{h.bestArea ? areaLabel(h.bestArea) : '—'}</p></div>
            <div className="rounded-xl bg-warn/10 p-2.5"><p className="text-xs text-muted">Área de mayor oportunidad</p><p className="font-semibold text-warn">{h.weakArea ? areaLabel(h.weakArea) : '—'}</p></div>
          </div>
          <div><p className="mb-1 flex items-center gap-1.5 font-semibold text-ok"><Award className="h-4 w-4" /> Fortalezas</p>
            {h.strengths.length ? <ul className="list-inside list-disc text-muted">{h.strengths.map((i) => <li key={i.element_name}>{i.element_name} <span className="text-xs">({SCORE_LABEL[i.score]})</span></li>)}</ul> : <p className="text-muted">Aún sin indicadores en 4 o 5.</p>}</div>
          <div><p className="mb-1 flex items-center gap-1.5 font-semibold text-warn"><Target className="h-4 w-4" /> Áreas de desarrollo</p>
            {h.toDevelop.length ? <ul className="list-inside list-disc text-muted">{h.toDevelop.map((i) => <li key={i.element_name}>{i.element_name} <span className="text-xs">({SCORE_LABEL[i.score]})</span></li>)}</ul> : <p className="text-muted">Todo en buen nivel.</p>}</div>
          <p className="text-xs text-muted">Mejor indicador: <b>{h.best.map((i) => i.element_name).join(', ') || '—'}</b>{h.lowest.length ? <> · Indicador más bajo: <b>{h.lowest.map((i) => i.element_name).join(', ')}</b></> : null}</p>
        </Card>
      </div>
      {evo[0].values.length > 1 && (
        <Card className="overflow-x-auto p-4">
          <p className="mb-2 flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-brand" /> Evolución</p>
          <table className="w-full text-sm">
            <tbody>
              {evo.map((r) => (
                <tr key={r.key} className="border-t border-ink-700 first:border-t-0">
                  <td className="py-1.5 pr-3">{r.icon} {r.short}</td>
                  <td className="py-1.5 tabular-nums">{r.values.map((v, i) => <span key={i}>{i > 0 && <span className="text-muted"> → </span>}<b className={i === r.values.length - 1 ? 'text-brand' : ''}>{v != null ? Number(v).toFixed(1) : '—'}</b></span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card className="overflow-x-auto p-4">
        <p className="mb-2 font-semibold">Detalle por indicador</p>
        {AREAS.map((a) => {
          const its = items.filter((i) => i.area === a.key)
          if (!its.length) return null
          return (
            <div key={a.key} className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.icon} {a.label}</p>
              <ul className="divide-y divide-ink-700 text-sm">
                {its.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                    <span>{i.element_name}{i.exercise_name && <span className="text-xs text-muted"> · {i.exercise_name}</span>}{i.note && <span className="block text-xs text-muted">📝 {i.note}</span>}</span>
                    <span className="whitespace-nowrap"><b>{i.score}</b> <span className="text-xs text-muted">{SCORE_LABEL[i.score]}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {ev.notes && <p className="mt-2 rounded-xl bg-ink-900 p-3 text-sm"><b>Observaciones:</b> {ev.notes}</p>}
      </Card>
    </div>
  )
}

/** Resumen para la ficha del niño (con lenguaje positivo). */
export function PlayerEvalSummary({ studentId, history }: { studentId: string; history: PlayerEvaluation[] }) {
  const last = history[0]
  if (!last) return (
    <Card className="p-5 text-sm text-muted">Aún no tiene evaluación por áreas. <Link to={`/evaluaciones?alumno=${studentId}`} className="text-brand hover:underline">Realizar evaluación</Link></Card>
  )
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Evaluación por áreas</h3>
        <span className="text-xs text-muted">Última: {date(last.evaluated_on)} · {friendlyLevel(last.overall)}</span>
      </div>
      <AreaBars ev={last} prev={history[1]} />
    </Card>
  )
}
