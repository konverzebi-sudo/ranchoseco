import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronLeft, Search, ShieldCheck, UserRound } from 'lucide-react'
import { Button, Field, Input, Select, Spinner, Textarea, cx } from '@/components/ui'
import { LOGO } from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { isValidPhone, normalizePhone, today } from '@/lib/format'

interface Kid { id: string; full_name: string; category: string; category_order: number; completed: boolean }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const RELATIONS = ['Mamá', 'Papá', 'Abuela', 'Abuelo', 'Tía', 'Tío', 'Tutor legal', 'Otro']
const BLOOD = ['No sé', 'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']

/**
 * Página pública para que los papás completen los datos de su hijo.
 * Sólo muestra nombres y categorías; cada alumno se registra una sola vez.
 */
export default function Registro() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['registro_lista'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('registro_lista')
      if (error) throw new Error(error.message)
      return data as Kid[]
    },
  })
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [kid, setKid] = useState<Kid | null>(null)
  const [done, setDone] = useState<Kid | null>(null)

  const kids = list.data ?? []
  const categories = useMemo(() => [...new Map(kids.map((k) => [k.category, k.category_order])).entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c), [kids])
  const shown = kids.filter((k) => (!cat || k.category === cat) && (!q.trim() || norm(k.full_name).includes(norm(q.trim()))))
  const completed = kids.filter((k) => k.completed).length

  if (kid) return <KidForm kid={kid} onBack={() => setKid(null)} onDone={() => { setDone(kid); setKid(null); qc.invalidateQueries({ queryKey: ['registro_lista'] }) }} />

  return (
    <div className="min-h-dvh bg-ink pb-12">
      <header className="border-b-4 border-brand bg-ink-900">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-5">
          <img src={LOGO} alt="Escudo Deportivo Rancho Seco" className="h-16 w-16" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Deportivo Rancho Seco</p>
            <h1 className="font-display text-3xl font-bold uppercase leading-tight">Registro de datos</h1>
            <p className="text-sm text-muted">Busca a tu hijo y completa sus datos. Toma 2 minutos.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-5">
        {done && (
          <div className="rounded-2xl border border-ok/40 bg-ok/10 p-4">
            <p className="flex items-center gap-2 font-semibold text-ok"><CheckCircle2 className="h-5 w-5" /> ¡Gracias! Los datos de {done.full_name} quedaron guardados.</p>
            <p className="mt-1 text-sm text-muted">Si tienes otro hijo en la academia, búscalo abajo.</p>
          </div>
        )}

        {list.isLoading ? <Spinner label="Cargando alumnos…" /> : list.error ? (
          <div className="rounded-2xl border border-bad/40 p-4 text-sm">No se pudo cargar la lista. Revisa tu conexión e inténtalo de nuevo.
            <Button size="sm" className="mt-2" onClick={() => list.refetch()}>Reintentar</Button></div>
        ) : (
          <>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted"><span>{completed} de {kids.length} familias ya registraron sus datos</span><span>{kids.length ? Math.round((completed / kids.length) * 100) : 0}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-700"><div className="h-full rounded-full bg-brand" style={{ width: `${kids.length ? (completed / kids.length) * 100 : 0}%` }} /></div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe el nombre de tu hijo" className="pl-10" type="search" />
            </div>

            <div className="-mx-4 overflow-x-auto px-4">
              <div className="flex min-w-max gap-2">
                <button onClick={() => setCat('')} className={cx('rounded-xl border px-4 py-2 text-sm font-semibold', !cat ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted')}>Todas</button>
                {categories.map((c) => (
                  <button key={c} onClick={() => setCat(c)} className={cx('rounded-xl border px-4 py-2 text-sm font-semibold', cat === c ? 'border-brand bg-brand text-ink' : 'border-ink-600 text-muted')}>{c}</button>
                ))}
              </div>
            </div>

            {!cat && !q.trim() ? (
              <p className="py-6 text-center text-sm text-muted">Elige la categoría de tu hijo o escribe su nombre.</p>
            ) : shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No encontramos ese nombre. Revisa cómo está escrito o avisa a la academia.</p>
            ) : (
              <ul className="space-y-2">
                {shown.map((k) => (
                  <li key={k.id}>
                    {k.completed ? (
                      <div className="flex items-center gap-3 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3 opacity-70">
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-ok" />
                        <div className="min-w-0 flex-1"><p className="truncate font-medium">{k.full_name}</p><p className="text-xs text-muted">{k.category}</p></div>
                        <span className="text-xs font-semibold text-ok">Datos guardados</span>
                      </div>
                    ) : (
                      <button onClick={() => setKid(k)} className="flex w-full items-center gap-3 rounded-2xl border border-ink-600 bg-ink-800 px-4 py-3 text-left transition hover:border-brand">
                        <UserRound className="h-6 w-6 shrink-0 text-brand" />
                        <div className="min-w-0 flex-1"><p className="truncate font-medium">{k.full_name}</p><p className="text-xs text-muted">{k.category}</p></div>
                        <span className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-ink">Completar</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="flex items-start gap-2 pt-4 text-xs text-ink-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Tus datos sólo los ve la academia y se usan para contacto y emergencias. Una vez guardados, sólo la academia puede corregirlos.</p>
      </main>
    </div>
  )
}

function KidForm({ kid, onBack, onDone }: { kid: Kid; onBack: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    birth_date: '', blood_type: 'No sé', allergies: '', conditions: '', medications: '', insurance: '', medical_notes: '',
    emergency_name: '', emergency_phone: '',
    tutor_name: '', tutor_relationship: 'Mamá', tutor_phone: '', tutor_email: '',
    tutor2_name: '', tutor2_relationship: 'Papá', tutor2_phone: '',
  })
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!f.birth_date) errs.birth_date = 'Escribe la fecha de nacimiento.'
    if (!f.tutor_name.trim()) errs.tutor_name = 'Escribe tu nombre.'
    if (!isValidPhone(normalizePhone(f.tutor_phone))) errs.tutor_phone = 'Escribe tu WhatsApp a 10 dígitos.'
    if (f.tutor_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.tutor_email.trim())) errs.tutor_email = 'Revisa el correo.'
    if (!f.emergency_name.trim()) errs.emergency_name = 'Escribe a quién llamar en una emergencia.'
    if (!isValidPhone(normalizePhone(f.emergency_phone))) errs.emergency_phone = 'Teléfono a 10 dígitos.'
    if (f.tutor2_phone && !isValidPhone(normalizePhone(f.tutor2_phone))) errs.tutor2_phone = 'Teléfono a 10 dígitos.'
    if (!consent) errs.consent = 'Necesitamos tu autorización para guardar los datos.'
    setErrors(errs)
    if (Object.keys(errs).length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    setSaving(true)
    setServerError('')
    try {
      const payload = {
        ...f,
        blood_type: f.blood_type === 'No sé' ? '' : f.blood_type,
        tutor_phone: normalizePhone(f.tutor_phone),
        tutor2_phone: f.tutor2_phone ? normalizePhone(f.tutor2_phone) : '',
        emergency_phone: normalizePhone(f.emergency_phone),
      }
      const { error } = await supabase.rpc('registro_guardar', { p_student: kid.id, p: payload })
      if (error) throw new Error(error.message)
      onDone()
    } catch (err) {
      setServerError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-ink pb-12">
      <header className="sticky top-0 z-10 border-b border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button onClick={onBack} className="rounded-xl p-2 text-muted hover:bg-ink-700" aria-label="Regresar"><ChevronLeft className="h-6 w-6" /></button>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-brand">Datos de</p>
            <p className="truncate font-display text-xl font-bold uppercase">{kid.full_name}</p>
          </div>
        </div>
      </header>
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-6 px-4 pt-5">
        {serverError && <p className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{serverError}</p>}
        {Object.keys(errors).length > 0 && <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">Revisa los campos marcados en rojo.</p>}

        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-brand">Del niño</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de nacimiento *" error={errors.birth_date}><Input type="date" value={f.birth_date} max={today()} onChange={set('birth_date')} /></Field>
            <Field label="Tipo de sangre"><Select value={f.blood_type} onChange={set('blood_type')}>{BLOOD.map((b) => <option key={b}>{b}</option>)}</Select></Field>
          </div>
          <Field label="Alergias" hint="Medicamentos, alimentos, picaduras… Escribe «Ninguna» si no tiene."><Textarea rows={2} value={f.allergies} onChange={set('allergies')} /></Field>
          <Field label="Padecimientos o condiciones" hint="Asma, diabetes, lesiones recientes…"><Textarea rows={2} value={f.conditions} onChange={set('conditions')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Medicamentos que toma"><Input value={f.medications} onChange={set('medications')} /></Field>
            <Field label="Seguro médico / IMSS"><Input value={f.insurance} onChange={set('insurance')} placeholder="Ej. IMSS, GNP…" /></Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-brand">Papá, mamá o tutor</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tu nombre completo *" error={errors.tutor_name}><Input value={f.tutor_name} onChange={set('tutor_name')} autoComplete="name" /></Field>
            <Field label="Parentesco"><Select value={f.tutor_relationship} onChange={set('tutor_relationship')}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            <Field label="Tu WhatsApp *" error={errors.tutor_phone} hint="10 dígitos"><Input value={f.tutor_phone} onChange={set('tutor_phone')} inputMode="tel" autoComplete="tel" placeholder="81 1234 5678" /></Field>
            <Field label="Correo (opcional)" error={errors.tutor_email}><Input type="email" value={f.tutor_email} onChange={set('tutor_email')} autoComplete="email" /></Field>
          </div>
          <details className="rounded-xl border border-ink-600 p-3">
            <summary className="cursor-pointer text-sm text-muted">Agregar otro papá, mamá o tutor (opcional)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="Nombre"><Input value={f.tutor2_name} onChange={set('tutor2_name')} /></Field>
              <Field label="Parentesco"><Select value={f.tutor2_relationship} onChange={set('tutor2_relationship')}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="WhatsApp" error={errors.tutor2_phone}><Input value={f.tutor2_phone} onChange={set('tutor2_phone')} inputMode="tel" /></Field>
            </div>
          </details>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-brand">En caso de emergencia</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="¿A quién llamamos? *" error={errors.emergency_name}><Input value={f.emergency_name} onChange={set('emergency_name')} placeholder="Nombre y parentesco" /></Field>
            <Field label="Teléfono *" error={errors.emergency_phone}><Input value={f.emergency_phone} onChange={set('emergency_phone')} inputMode="tel" /></Field>
          </div>
          <Field label="Algo más que debamos saber (opcional)"><Textarea rows={2} value={f.medical_notes} onChange={set('medical_notes')} /></Field>
        </section>

        <label className={cx('flex items-start gap-3 rounded-xl border p-3 text-sm', errors.consent ? 'border-bad/60' : 'border-ink-600')}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#F2E30A]" />
          <span>Autorizo a Deportivo Rancho Seco a guardar estos datos para contactarme y para atender cualquier emergencia de mi hijo.</span>
        </label>

        <Button type="submit" size="lg" loading={saving} className="w-full">Guardar datos</Button>
        <p className="text-center text-xs text-muted">Revisa bien antes de guardar: después sólo la academia puede corregirlos.</p>
      </form>
    </div>
  )
}
