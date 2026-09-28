import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button, Card, ErrorState, Field, Input, PageHeader, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useSettings } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { fillTemplate } from '@/lib/whatsapp'

export default function SettingsPage() {
  const settings = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ academy_name: '', default_country_code: '52', default_monthly_fee: '', due_day: '10', payment_instructions: '', collection_template: '', report_template: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const s = settings.data
    if (s) setF({
      academy_name: s.academy_name, default_country_code: s.default_country_code, default_monthly_fee: String(s.default_monthly_fee ?? ''),
      due_day: String(s.due_day), payment_instructions: s.payment_instructions, collection_template: s.collection_template, report_template: s.report_template,
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
        due_day: due, payment_instructions: f.payment_instructions.trim(), collection_template: f.collection_template, report_template: f.report_template,
        updated_at: new Date().toISOString(),
      }).eq('id', 1))
      await qc.invalidateQueries({ queryKey: ['settings'] })
      toast.ok('Configuración guardada')
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Mensualidad general" hint="Si la categoría no define otra"><Input type="number" min="0" inputMode="decimal" value={f.default_monthly_fee} onChange={(e) => setF({ ...f, default_monthly_fee: e.target.value })} /></Field>
            <Field label="Día de vencimiento"><Input type="number" min="1" max="28" value={f.due_day} onChange={(e) => setF({ ...f, due_day: e.target.value })} /></Field>
            <Field label="Lada del país"><Input value={f.default_country_code} onChange={(e) => setF({ ...f, default_country_code: e.target.value })} inputMode="numeric" /></Field>
          </div>
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
