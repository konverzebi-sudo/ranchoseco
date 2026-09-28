import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Phone } from 'lucide-react'
import { Button, Field, Input, Modal, Textarea } from './ui'
import { useToast } from './toast'
import { useFees, usePortalToken, useSettings, portalUrl, primaryGuardian, type StudentRow } from '@/lib/api'
import { collectionMessage, waLink } from '@/lib/whatsapp'
import { isValidPhone, money, normalizePhone, prettyPhone } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'

/** Captura rápida del tutor cuando falta su teléfono (evita navegar a otra pantalla). */
export function GuardianQuickForm({ student, onSaved }: { student: StudentRow; onSaved: () => void }) {
  const g = primaryGuardian(student)
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(g?.full_name ?? '')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const normalized = normalizePhone(phone, settings?.default_country_code ?? '52')

  const save = async () => {
    if (!name.trim()) return toast.error('Escribe el nombre del padre, madre o tutor.')
    if (!isValidPhone(normalized)) return toast.error('El teléfono debe tener 10 dígitos (o incluir la lada del país).')
    setSaving(true)
    try {
      if (g) {
        unwrap(await supabase.from('guardians').update({ full_name: name.trim(), phone: normalized }).eq('id', g.id))
      } else {
        const created = unwrap(
          await supabase.from('guardians').insert({ full_name: name.trim(), phone: normalized }).select('id').single(),
        ) as { id: string }
        unwrap(await supabase.from('student_guardians').insert({ student_id: student.id, guardian_id: created.id, is_primary: true }))
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['students'] }), qc.invalidateQueries({ queryKey: ['student', student.id] })])
      toast.ok('Contacto del tutor guardado')
      onSaved()
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <span className="text-white font-medium">{student.full_name}</span> aún no tiene el teléfono de su tutor. Captúralo una vez y queda guardado.
      </p>
      <Field label="Nombre del padre, madre o tutor">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ej. María López" />
      </Field>
      <Field label="WhatsApp del tutor" hint={phone ? `Se guardará como ${prettyPhone(normalized)}` : '10 dígitos. Se agrega +52 automáticamente.'}>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="81 1234 5678" />
      </Field>
      <Button onClick={save} loading={saving} icon={Phone} className="w-full">Guardar contacto</Button>
    </div>
  )
}

/** Botón de cobranza: arma el mensaje con el saldo real y abre WhatsApp para revisarlo y enviarlo. */
export function CollectButton({ student, size = 'sm', label = 'Cobrar' }: { student: StudentRow; size?: 'sm' | 'md'; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="whatsapp" size={size} icon={MessageCircle} onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
        {label}
      </Button>
      {open && <CollectModal student={student} onClose={() => setOpen(false)} />}
    </>
  )
}

function CollectModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { data: settings } = useSettings()
  const { data: fees } = useFees()
  const { data: token } = usePortalToken(student.id)
  const guardian = primaryGuardian(student)
  const studentFees = useMemo(() => (fees ?? []).filter((f) => f.student_id === student.id && Number(f.balance) > 0 && f.status !== 'por_confirmar'), [fees, student.id])
  const built = useMemo(
    () => settings && collectionMessage(settings.collection_template, student.full_name, studentFees, token ? portalUrl(token) : undefined),
    [settings, student.full_name, studentFees, token],
  )
  const [edited, setEdited] = useState<string | null>(null)
  const text = edited ?? built?.text ?? ''
  const hasPhone = guardian && isValidPhone(guardian.phone)

  return (
    <Modal open onClose={onClose} title="Cobranza por WhatsApp"
      footer={hasPhone && studentFees.length > 0 ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <a href={waLink(guardian!.phone, text)} target="_blank" rel="noopener noreferrer" onClick={onClose}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-wa px-5 text-sm font-semibold text-ink hover:brightness-110">
            <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
          </a>
        </>
      ) : undefined}>
      {!hasPhone ? (
        <GuardianQuickForm student={student} onSaved={() => {}} />
      ) : studentFees.length === 0 ? (
        <p className="text-sm text-muted">{student.full_name} no tiene saldo pendiente. ¡Está al corriente!</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-ink-900 p-3">
              <p className="text-xs text-muted">Para</p>
              <p className="font-medium">{guardian!.full_name}</p>
              <p className="text-muted">{prettyPhone(guardian!.phone)}</p>
            </div>
            <div className="rounded-xl bg-ink-900 p-3">
              <p className="text-xs text-muted">Saldo pendiente</p>
              <p className="font-display text-2xl font-bold text-brand">{money(built?.total ?? 0)}</p>
              <p className="text-muted">{built?.months.join(', ')}</p>
            </div>
          </div>
          <Field label="Mensaje (puedes editarlo)">
            <Textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={9} />
          </Field>
          <p className="text-xs text-muted">WhatsApp se abrirá con el mensaje listo. Revísalo y presiona enviar desde WhatsApp.</p>
        </div>
      )}
    </Modal>
  )
}
