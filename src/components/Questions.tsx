import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, HelpCircle, Save } from 'lucide-react'
import { Badge, Button, Card, Textarea, cx } from './ui'
import { useToast } from './toast'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor } from '@/lib/actor'
import { date } from '@/lib/format'
import { notify } from '@/lib/notify'

export interface Question {
  id: string; number: number; assigned_to: string; topic: string | null; question: string
  answer: string | null; answered_by: string | null; answered_at: string | null; done: boolean
}

/** Preguntas que sistemas dejó a una persona (las que no se han cerrado). */
export function useQuestions(person: string) {
  return useQuery({
    queryKey: ['questions', person],
    enabled: !!person,
    queryFn: async () => unwrap(await supabase.from('questions').select('*').ilike('assigned_to', person).eq('done', false).order('number')) as Question[],
  })
}

/** Lo que ve Aby al entrar: las preguntas para contestar, una por una, y se guardan. */
export function QuestionsToAnswer({ person }: { person: string }) {
  const q = useQuestions(person)
  const list = q.data ?? []
  if (!list.length) return null
  const answered = list.filter((x) => x.answer?.trim()).length
  return (
    <Card className={cx(answered === list.length ? 'border-ok/60' : 'border-brand/70')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><HelpCircle className="h-5 w-5 text-brand" /> Preguntas de sistemas para ti</h2>
        <Badge tone={answered === list.length ? 'ok' : 'brand'}>{answered} de {list.length} contestadas</Badge>
      </div>
      <p className="px-5 pt-3 text-sm text-muted">Contesta cada una con tus palabras y pica <b>Guardar</b>. Si no sabes alguna, escribe "no sé" o a quién preguntarle. Puedes contestar unas hoy y otras después.</p>
      {answered === list.length && <p className="mx-5 mt-3 rounded-xl bg-ok/10 p-3 text-sm font-semibold text-ok">¡Gracias! Ya contestaste todas. Sistemas las va a revisar.</p>}
      <ol className="space-y-3 p-5">{list.map((x) => <QuestionRow key={x.id} q={x} all={list} />)}</ol>
    </Card>
  )
}

function QuestionRow({ q, all }: { q: Question; all: Question[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = useState(q.answer ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = text.trim() !== (q.answer ?? '').trim()
  const save = async () => {
    if (!text.trim()) return toast.error('Escribe tu respuesta.')
    setSaving(true)
    try {
      unwrap(await supabase.from('questions').update({ answer: text.trim(), answered_by: getActor() || q.assigned_to, answered_at: new Date().toISOString() }).eq('id', q.id))
      // Al contestar la última, a sistemas le llega el aviso con el reporte de respuestas
      const done = all.filter((x) => x.id !== q.id && x.answer?.trim()).length + 1
      if (done === all.length && !q.answer) await notify(`${q.assigned_to} contestó todas las preguntas de sistemas`, `${all.length} respuestas listas. Ábrelas en el Dashboard ("Preguntas para ${q.assigned_to}") y regresa con Claude para aplicarlas.`)
      await qc.invalidateQueries({ queryKey: ['questions'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.ok(`Respuesta ${q.number} guardada`)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <li className={cx('rounded-2xl border p-4', q.answer ? 'border-ok/40 bg-ok/5' : 'border-ink-600')}>
      <p className="mb-1 flex flex-wrap items-center gap-2 text-sm text-muted">
        <b className="font-display text-lg text-white">{q.number}.</b>{q.topic && <Badge>{q.topic}</Badge>}
        {q.answer && <span className="flex items-center gap-1 text-ok"><CheckCircle2 className="h-4 w-4" /> Contestada</span>}
      </p>
      <p className="mb-2">{q.question}</p>
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu respuesta aquí" />
      {(dirty || !q.answer) && <div className="mt-2 flex justify-end"><Button size="sm" icon={Save} loading={saving} onClick={save}>Guardar</Button></div>}
    </li>
  )
}

/** Lo que ve sistemas (Jany): cómo va Aby con las preguntas y sus respuestas. */
export function QuestionsStatus({ person }: { person: string }) {
  const q = useQuestions(person)
  const [open, setOpen] = useState(false)
  const list = q.data ?? []
  if (!list.length) return null
  const answered = list.filter((x) => x.answer?.trim())
  const complete = answered.length === list.length
  return (
    <Card className={complete ? 'border-ok/70 bg-ok/5' : undefined}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-4 text-left">
        <span className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
          {complete ? <CheckCircle2 className="h-5 w-5 text-ok" /> : <HelpCircle className="h-5 w-5 text-brand" />}
          {complete ? `${person} ya contestó todas las preguntas` : `Preguntas para ${person}`}
        </span>
        <span className="flex items-center gap-2 text-sm">
          <Badge tone={complete ? 'ok' : 'brand'}>{answered.length} de {list.length}</Badge>
          <span className="text-muted">{open ? 'Ocultar' : 'Ver respuestas'}</span>
        </span>
      </button>
      {complete && <p className="px-5 pb-3 text-sm font-semibold text-ok">Ya puedes regresar con Claude para tomar acción con sus respuestas.</p>}
      {answered.length > 0 && (
        <div className="px-5 pb-3">
          <Button size="sm" variant="secondary" onClick={async () => {
            const text = [`Respuestas de ${person} (${answered.length} de ${list.length})`, ...list.map((x) => `${x.number}. ${x.question}\nR: ${x.answer?.trim() || '(sin contestar)'}`)].join('\n\n')
            try { await navigator.clipboard.writeText(text) } catch { /* sin portapapeles */ }
          }}>Copiar reporte de respuestas</Button>
        </div>
      )}
      {open && (
        <ol className="divide-y divide-ink-700 border-t border-ink-600">
          {list.map((x) => (
            <li key={x.id} className="px-5 py-3">
              <p className="text-sm"><b>{x.number}.</b> {x.question}</p>
              {x.answer
                ? <p className="mt-1 rounded-lg bg-ink-900 p-2"><b className="text-ok">R:</b> {x.answer} <span className="text-xs text-muted">· {x.answered_by} {x.answered_at ? date(x.answered_at.slice(0, 10), "d 'de' MMM") : ''}</span></p>
                : <p className="mt-1 text-sm text-warn">Sin contestar</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
