import { useEffect, useState, type FormEvent } from 'react'
import { TeamSettings } from '@/components/Team'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, ShieldAlert, ShieldCheck, History } from 'lucide-react'
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useSettings } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { fillTemplate } from '@/lib/whatsapp'
import { date } from '@/lib/format'
import { useWaPreference } from '@/components/WaChooser'

/** Campos de precio que dejan historial cuando cambian. */
const TRACKED = [
  { field: 'default_monthly_fee', label: 'Mensualidad general', money: true },
  { field: 'due_day', label: 'Último día para pagar sin recargo', money: false },
  { field: 'late_fee_amount', label: 'Recargo por mes de atraso', money: true },
] as const
type HistoryRow = { id: string; field: string; label: string; old_value: string | null; new_value: string | null; reason: string | null; changed_at: string }
const show = (v: string | null, isMoney: boolean) => (v == null || v === '' ? '—' : isMoney ? `$${Number(v).toLocaleString('es-MX')}` : `día ${v}`)

export default function SettingsPage() {
  const settings = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ academy_name: '', default_country_code: '52', default_monthly_fee: '', due_day: '10', late_fee_amount: '', payment_instructions: '', collection_template: '', report_template: '' })
  const [saving, setSaving] = useState(false)
  const [reason, setReason] = useState('')
  const wa = useWaPreference()
  const history = useQuery({
    queryKey: ['settings_history'],
    queryFn: async () => unwrap(await supabase.from('settings_history').select('*').order('changed_at', { ascending: false }).limit(50)) as HistoryRow[],
  })
  const original = (k: (typeof TRACKED)[number]['field']) => String(Number(settings.data?.[k] ?? 0))
  const changed = settings.data ? TRACKED.filter((t) => String(Number(f[t.field]) || 0) !== original(t.field)) : []

  useEffect(() => {
    const s = settings.data
    if (s) setF({
      academy_name: s.academy_name, default_country_code: s.default_country_code, default_monthly_fee: String(s.default_monthly_fee ?? ''),
      due_day: String(s.due_day), late_fee_amount: String(s.late_fee_amount ?? 0), payment_instructions: s.payment_instructions, collection_template: s.collection_template, report_template: s.report_template,
    })
  }, [settings.data])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const due = Number(f.due_day)
    if (!(due >= 1 && due <= 28)) return toast.error('El día de vencimiento debe estar entre 1 y 28.')
    if (!/^\d{1,4}$/.test(f.default_country_code)) return toast.error('La lada del país debe ser numérica (México = 52).')
    setSaving(true)
    try {
      unwrap(await supabase.from('settings').update({
        academy_name: f.academy_name.trim(), default_country_code: f.default_country_code, default_monthly_fee: Number(f.default_monthly_fee) || 0,
        due_day: due, late_fee_amount: Number(f.late_fee_amount) || 0, payment_instructions: f.payment_instructions.trim(), collection_template: f.collection_template, report_template: f.report_template,
        updated_at: new Date().toISOString(),
      }).eq('id', 1))
      if (changed.length) {
        unwrap(await supabase.from('settings_history').insert(changed.map((t) => ({
          field: t.field, label: t.label, old_value: original(t.field), new_value: String(Number(f[t.field]) || 0), reason: reason.trim() || null,
        }))))
        setReason('')
      }
      await Promise.all(['settings', 'settings_history'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok(changed.length ? 'Guardado. El cambio de precio quedó en el historial.' : 'Configuración guardada')
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
  if (settings.isLoading) return <Spinner />
  const preview = fillTemplate(f.collection_template, { MES: 'Septiembre', 'NOMBRE DEL ALUMNO': 'Juan Pérez', SALDO: '600' })

  return (
    <>
      <PageHeader title="Configuración" actions={<Button type="submit" form="settings-form" icon={Save} loading={saving}>Guardar cambios</Button>} />
      <form id="settings-form" onSubmit={submit} className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Academia y cobranza</h3>
          <Field label="Nombre de la academia"><Input value={f.academy_name} onChange={(e) => setF({ ...f, academy_name: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mensualidad general" hint="Si la categoría no define otra"><Input type="number" min="0" inputMode="decimal" value={f.default_monthly_fee} onChange={(e) => setF({ ...f, default_monthly_fee: e.target.value })} /></Field>
            <Field label="Último día para pagar sin recargo"><Input type="number" min="1" max="28" value={f.due_day} onChange={(e) => setF({ ...f, due_day: e.target.value })} /></Field>
            <Field label="Recargo por mes de atraso" hint={Number(f.late_fee_amount) > 0 ? `Desde el día ${Number(f.due_day) + 1} se suman $${f.late_fee_amount}, y otros $${f.late_fee_amount} por cada mes más sin pagar` : 'Déjalo en 0 si no se cobra recargo'}>
              <Input type="number" min="0" inputMode="decimal" value={f.late_fee_amount} onChange={(e) => setF({ ...f, late_fee_amount: e.target.value })} />
            </Field>
            <Field label="Lada del país"><Input value={f.default_country_code} onChange={(e) => setF({ ...f, default_country_code: e.target.value })} inputMode="numeric" /></Field>
          </div>
          {changed.length > 0 && (
            <div className="rounded-xl border border-brand/40 bg-brand-dim p-3 text-sm">
              <p className="mb-2">Cambios: {changed.map((t) => <span key={t.field} className="mr-3 inline-block"><b>{t.label}</b> {show(original(t.field), t.money)} → <b className="text-brand">{show(String(Number(f[t.field]) || 0), t.money)}</b></span>)}</p>
              <Field label="¿Por qué cambia? (opcional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Aumento de temporada 2027" /></Field>
            </div>
          )}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4 text-brand" /> Historial de cambios de precios</p>
            {!history.data?.length ? <p className="rounded-xl border border-ink-600 px-3 py-3 text-sm text-muted">Sin cambios todavía. Cada vez que cambies la mensualidad, el día límite o el recargo, quedará aquí con su fecha.</p> : (
              <ol className="max-h-64 divide-y divide-ink-700 overflow-y-auto rounded-xl border border-ink-600">
                {history.data.map((h) => {
                  const isMoney = TRACKED.find((t) => t.field === h.field)?.money ?? true
                  return (
                    <li key={h.id} className="px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap justify-between gap-2"><span><b>{h.label}</b>: {show(h.old_value, isMoney)} → <b className="text-brand">{show(h.new_value, isMoney)}</b></span><span className="text-xs text-muted">{date(h.changed_at.slice(0, 10))}</span></div>
                      {h.reason && <p className="text-xs text-muted">{h.reason}</p>}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
          <Field label="WhatsApp en este celular" hint="Con cuál app se mandan los mensajes desde este celular">
            <Select value={wa.pref ?? ''} onChange={(e) => wa.set((e.target.value || null) as 'normal' | 'business' | null)}>
              <option value="">Preguntar cada vez</option>
              <option value="normal">WhatsApp</option>
              <option value="business">WhatsApp Business</option>
            </Select>
          </Field>
          <Field label="Datos para pagar" hint="Se muestran a los papás en su link (cuenta, CLABE, horario de caja…)">
            <Textarea value={f.payment_instructions} onChange={(e) => setF({ ...f, payment_instructions: e.target.value })} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Mensajes de WhatsApp</h3>
          <Field label="Recordatorio de pago" hint="Variables: [MES], [NOMBRE DEL ALUMNO], [SALDO]">
            <Textarea rows={7} value={f.collection_template} onChange={(e) => setF({ ...f, collection_template: e.target.value })} />
          </Field>
          <div className="rounded-xl bg-ink-900 p-3 text-sm text-muted whitespace-pre-line"><p className="mb-1 text-xs uppercase tracking-wider">Vista previa</p>{preview}</div>
          <Field label="Envío de reporte" hint="Variables: [NOMBRE DEL ALUMNO], [PERIODO]">
            <Textarea rows={6} value={f.report_template} onChange={(e) => setF({ ...f, report_template: e.target.value })} />
          </Field>
        </Card>

        <TeamSettings />

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start gap-3">
            {settings.data?.open_mode ? <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-warn" /> : <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-ok" />}
            <div className="text-sm">
              <p className="font-semibold">{settings.data?.open_mode ? 'Acceso abierto (temporal)' : 'Acceso protegido'}</p>
              <p className="mt-1 text-muted">
                {settings.data?.open_mode
                  ? 'Cualquier persona con la dirección del sitio puede ver y modificar la información. Cuando quieras que cada profesor vea sólo su categoría y que sólo administración modifique pagos, se activa el acceso por roles desde Supabase (ver README, sección "Cerrar el modo abierto"). Los links de los papás siguen funcionando igual.'
                  : 'Cada persona ve sólo lo que le corresponde según su rol. Los papás consultan con su link privado.'}
              </p>
            </div>
          </div>
        </Card>
      </form>
    </>
  )
}
