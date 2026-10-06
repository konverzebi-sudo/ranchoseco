import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Plus, UserRound } from 'lucide-react'
import { Badge, Button, Card, Field, Input, Modal, Select, cx } from './ui'
import { useToast } from './toast'
import { useTeam } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor, getActorId, getAdminOk, isAdminRole, pinHash, setActor } from '@/lib/actor'
import type { TeamMember } from '@/lib/types'

export const PIN_LENGTH = 6
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, PIN_LENGTH)

/** Nombre de quien entró con su PIN en este celular o computadora. */
export function useActor() {
  const read = () => (getActorId() && getAdminOk() === getActorId() ? getActor() : '')
  const [actor, set] = useState(read)
  useEffect(() => {
    const on = () => set(read())
    window.addEventListener('rs-actor', on)
    return () => window.removeEventListener('rs-actor', on)
  }, [])
  return actor
}

/** Busca de quién es el PIN (cada persona tiene uno distinto). */
async function whosePin(team: TeamMember[], pin: string) {
  for (const m of team) if (m.active && m.pin_hash && (await pinHash(m.id, pin)) === m.pin_hash) return m
  return null
}

/** Pantalla de entrada: sin PIN no se ve nada. */
export function LoginScreen({ logo }: { logo: string }) {
  const team = useTeam()
  const qc = useQueryClient()
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const fails = useRef(0)
  const [waitUntil, setWaitUntil] = useState(0)
  const list = team.data ?? []
  // Primera vez: nadie de administración tiene PIN todavía
  const setup = !!team.data && !list.some((m) => m.active && isAdminRole(m.role) && m.pin_hash)
  const admins = list.filter((m) => m.active && isAdminRole(m.role))
  const [who, setWho] = useState('')
  const [pin2, setPin2] = useState('')

  const enter = async (value = pin) => {
    if (value.length !== PIN_LENGTH) return
    if (Date.now() < waitUntil) return toast.error('Espera unos segundos e inténtalo de nuevo.')
    setBusy(true)
    try {
      const m = await whosePin(list, value)
      if (!m) {
        fails.current++
        if (fails.current >= 5) { setWaitUntil(Date.now() + 30_000); fails.current = 0 }
        setPin('')
        return toast.error('PIN incorrecto.')
      }
      setActor(m.id, m.full_name, true)
      toast.ok(`Hola, ${m.full_name.split(' ')[0]}`)
    } finally { setBusy(false) }
  }

  const createFirst = async () => {
    const m = admins.find((x) => x.id === who)
    if (!m) return toast.error('Escoge tu nombre.')
    if (pin.length !== PIN_LENGTH) return toast.error(`El PIN son ${PIN_LENGTH} números.`)
    if (pin !== pin2) return toast.error('Los dos PIN no coinciden.')
    setBusy(true)
    try {
      unwrap(await supabase.from('team_members').update({ pin_hash: await pinHash(m.id, pin) }).eq('id', m.id))
      await qc.invalidateQueries({ queryKey: ['team'] })
      setActor(m.id, m.full_name, true)
      toast.ok('PIN creado. Ahora asigna el PIN de los demás en Configuración → Equipo.')
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-page p-6">
      <div className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-800 p-6 text-center">
        <img src={logo} alt="Escudo Deportivo Rancho Seco" className="mx-auto h-20 w-20" />
        <p className="mt-3 font-display text-2xl font-bold uppercase">Rancho Seco</p>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Control de academia</p>
        {team.isLoading ? <p className="mt-6 text-sm text-muted">Cargando…</p> : setup ? (
          <div className="mt-6 space-y-3 text-left">
            <p className="text-sm text-muted">Primera vez: la persona de <b>administración</b> escoge su nombre y crea su PIN de {PIN_LENGTH} números.</p>
            <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Tu nombre">
              <option value="">Escoge tu nombre…</option>
              {admins.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
            <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(onlyDigits(e.target.value))} placeholder={`PIN de ${PIN_LENGTH} números`} />
            <Input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(onlyDigits(e.target.value))} placeholder="Repite el PIN" onKeyDown={(e) => e.key === 'Enter' && createFirst()} />
            <Button className="w-full" icon={KeyRound} loading={busy} onClick={createFirst}>Crear PIN y entrar</Button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted">Escribe tu PIN de {PIN_LENGTH} números</p>
            <Input type="password" inputMode="numeric" autoFocus value={pin} aria-label="PIN"
              onChange={(e) => { const v = onlyDigits(e.target.value); setPin(v); if (v.length === PIN_LENGTH) enter(v) }}
              className="text-center text-2xl tracking-[0.5em]" placeholder="••••••" />
            <Button className="w-full" icon={KeyRound} loading={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => enter()}>Entrar</Button>
            <p className="text-xs text-muted">¿No tienes PIN o lo olvidaste? Pídeselo a administración.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** En el menú: quién entró, cambiar su PIN y salir. */
export function WhoAmI() {
  const team = useTeam()
  const actor = useActor()
  const me = team.data?.find((m) => m.id === getActorId())
  const [changing, setChanging] = useState(false)
  return (
    <div className="text-xs text-muted">
      <p className="mb-1 flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> Entraste como</p>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{actor}{me?.role ? <span className="font-normal text-muted"> · {me.role}</span> : null}</span>
        <button onClick={() => setChanging(true)} className="rounded-lg p-1.5 hover:bg-ink-700 hover:text-fg" title="Cambiar mi PIN" aria-label="Cambiar mi PIN"><KeyRound className="h-4 w-4" /></button>
        <button onClick={() => setActor('', '')} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-ink-700 hover:text-fg" title="Salir"><LogOut className="h-4 w-4" /> Salir</button>
      </div>
      {changing && me && <SetPinModal member={me} self onClose={() => setChanging(false)} />}
    </div>
  )
}

/** Asignar o cambiar el PIN de una persona (debe ser distinto al de los demás). */
function SetPinModal({ member, self, onClose }: { member: TeamMember; self?: boolean; onClose: () => void }) {
  const team = useTeam()
  const qc = useQueryClient()
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (pin.length !== PIN_LENGTH) return toast.error(`El PIN son ${PIN_LENGTH} números.`)
    if (pin !== pin2) return toast.error('Los dos PIN no coinciden.')
    if (/^(\d)\1+$/.test(pin) || pin === '123456') return toast.error('Ese PIN es muy fácil de adivinar. Escoge otro.')
    setBusy(true)
    try {
      const other = await whosePin((team.data ?? []).filter((m) => m.id !== member.id), pin)
      if (other) { setBusy(false); return toast.error('Ese PIN ya lo usa otra persona. Escoge otro.') }
      unwrap(await supabase.from('team_members').update({ pin_hash: await pinHash(member.id, pin) }).eq('id', member.id))
      await qc.invalidateQueries({ queryKey: ['team'] })
      toast.ok(self ? 'Tu PIN quedó cambiado' : `PIN de ${member.full_name} guardado. Dáselo en persona.`)
      onClose()
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={self ? 'Cambiar mi PIN' : `PIN de ${member.full_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={KeyRound} loading={busy} onClick={save}>Guardar PIN</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{PIN_LENGTH} números. Con ese PIN la plataforma sabe quién es y qué puede ver{isAdminRole(member.role) ? ' (administración: todo, con los números)' : ' (vista de profesor, sin dinero)'}.</p>
        <Field label="Nuevo PIN"><Input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(onlyDigits(e.target.value))} /></Field>
        <Field label="Repite el PIN"><Input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(onlyDigits(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
      </div>
    </Modal>
  )
}

/** Escoger a alguien del equipo (p. ej. quién recibió el pago). Guarda el nombre tal cual está en la lista. */
export function TeamSelect({ value, onChange, className }: { value: string; onChange: (name: string) => void; className?: string }) {
  const team = useTeam()
  const list = (team.data ?? []).filter((m) => m.active)
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Persona del equipo">
      <option value="">Escoge a la persona…</option>
      {list.map((m) => <option key={m.id} value={m.full_name}>{m.full_name}{m.role ? ` · ${m.role}` : ''}</option>)}
      {value && !list.some((m) => m.full_name === value) && <option value={value}>{value}</option>}
    </Select>
  )
}

/** Configuración: la lista del equipo Rancho Seco y el PIN de cada quien. */
export function TeamSettings() {
  const team = useTeam()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [pinFor, setPinFor] = useState<TeamMember | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] })
  const add = async () => {
    if (name.trim().length < 2) return toast.error('Escribe el nombre.')
    try {
      unwrap(await supabase.from('team_members').insert({ full_name: name.trim(), role: role.trim() || null }))
      await refresh(); setName(''); setRole('')
      toast.ok('Agregado al equipo. Ahora asígnale su PIN.')
    } catch (e) { toast.error(e) }
  }
  const clearPin = async (m: TeamMember) => {
    if (!window.confirm(`¿Quitar el PIN de ${m.full_name}? Ya no podrá entrar hasta que le asignes otro.`)) return
    try { unwrap(await supabase.from('team_members').update({ pin_hash: null }).eq('id', m.id)); await refresh(); toast.ok('PIN quitado') } catch (e) { toast.error(e) }
  }
  const toggle = async (id: string, active: boolean) => {
    try { unwrap(await supabase.from('team_members').update({ active }).eq('id', id)); await refresh() } catch (e) { toast.error(e) }
  }
  return (
    <Card className="space-y-3 p-5 lg:col-span-2">
      <div>
        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Equipo Rancho Seco y PIN de acceso</h3>
        <p className="text-sm text-muted">Cada persona entra con su PIN de {PIN_LENGTH} números (distinto para cada quien). Sólo el puesto <b>Administración</b> ve los números; los demás ven la vista de profesor. Asigna el PIN aquí y dáselo en persona.</p>
      </div>
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-600">
        {(team.data ?? []).map((m) => (
          <li key={m.id} className={cx('flex flex-wrap items-center gap-2 px-3 py-2 text-sm', !m.active && 'opacity-50')}>
            <b className="min-w-0 flex-1">{m.full_name}</b>
            {m.role && <Badge tone={isAdminRole(m.role) ? 'brand' : 'neutral'}>{m.role}</Badge>}
            <span className={cx('text-xs', m.pin_hash ? 'text-ok' : 'text-warn')}>{m.pin_hash ? '🔒 con PIN' : 'sin PIN (no puede entrar)'}</span>
            <Button size="sm" variant="secondary" icon={KeyRound} onClick={() => setPinFor(m)}>{m.pin_hash ? 'Cambiar PIN' : 'Asignar PIN'}</Button>
            {m.pin_hash && <button className="text-xs text-muted hover:text-bad hover:underline" onClick={() => clearPin(m)}>Quitar PIN</button>}
            <button className="text-xs text-muted hover:text-brand hover:underline" onClick={() => toggle(m.id, !m.active)}>{m.active ? 'Dar de baja' : 'Volver a activar'}</button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (como siempre se va a ver)" />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Puesto (Administración / Profesor)" list="team-roles" />
        <datalist id="team-roles">{['Administración', 'Profesor', 'Staff'].map((r) => <option key={r} value={r} />)}</datalist>
        <Button icon={Plus} onClick={add}>Agregar</Button>
      </div>
      {pinFor && <SetPinModal member={pinFor} self={pinFor.id === getActorId()} onClose={() => setPinFor(null)} />}
    </Card>
  )
}
