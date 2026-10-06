import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Plus, UserRound } from 'lucide-react'
import { Badge, Button, Card, Field, Input, Modal, Select, cx } from './ui'
import { useToast } from './toast'
import { useTeam } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor, getActorId, getAdminOk, getViewAs, isAdminRole, pinHash, setActor, setViewAs } from '@/lib/actor'
import type { TeamMember } from '@/lib/types'

export const PIN_LENGTH = 4
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

/** A quién está "viendo como" Jany (vacío = su propia vista). */
export function useViewAs() {
  const [v, set] = useState(getViewAs)
  useEffect(() => {
    const on = () => set(getViewAs())
    window.addEventListener('rs-actor', on)
    return () => window.removeEventListener('rs-actor', on)
  }, [])
  return v
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
  // Activar acceso: sólo aparecen quienes todavía no tienen PIN (nadie puede cambiar el de otro)
  const pending = list.filter((m) => m.active && !m.pin_hash).sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  const nobody = !!team.data && !list.some((m) => m.active && m.pin_hash)
  const [mode, setMode] = useState<'pin' | 'activar'>('pin')
  const setup = nobody || mode === 'activar'
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
    const m = pending.find((x) => x.id === who)
    if (!m) return toast.error('Escoge tu nombre.')
    if (pin.length !== PIN_LENGTH) return toast.error(`El código son ${PIN_LENGTH} números.`)
    if (pin !== pin2) return toast.error('Los dos códigos no coinciden. Escríbelo otra vez.')
    if (/^(\d)\1+$/.test(pin) || pin === '1234' || pin === '4321') return toast.error('Ese código es muy fácil de adivinar. Escoge otro.')
    setBusy(true)
    try {
      // Que nadie más lo esté usando
      if (await whosePin(list, pin)) { setBusy(false); return toast.error('Ese código ya lo usa otra persona. Escoge otro.') }
      // Y que en lo que se escribía nadie haya activado a esta persona
      const fresh = unwrap(await supabase.from('team_members').select('pin_hash').eq('id', m.id).single()) as { pin_hash: string | null }
      if (fresh.pin_hash) { setBusy(false); await qc.invalidateQueries({ queryKey: ['team'] }); return toast.error(`${m.full_name} ya tiene código. Si lo olvidó, pídele a Jany que lo active de nuevo.`) }
      unwrap(await supabase.from('team_members').update({ pin_hash: await pinHash(m.id, pin) }).eq('id', m.id))
      await qc.invalidateQueries({ queryKey: ['team'] })
      setActor(m.id, m.full_name, true)
      toast.ok(`¡Listo, ${m.full_name.split(' ')[0]}! Tu código quedó guardado. La próxima vez sólo escríbelo.`)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0d0b] bg-cover bg-center p-6"
      style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.45)), url(${import.meta.env.BASE_URL}fondo-acceso.jpg)` }}>
      <div className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-800/95 p-6 text-center shadow-2xl backdrop-blur">
        <img src={logo} alt="Escudo Deportivo Rancho Seco" className="mx-auto h-20 w-20" />
        <p className="mt-3 font-display text-2xl font-bold uppercase">Rancho Seco</p>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Control de academia</p>
        {team.isLoading ? <p className="mt-6 text-sm text-muted">Cargando…</p> : setup ? (
          <div className="mt-6 space-y-3 text-left">
            <p className="text-center font-semibold">Activar mi acceso</p>
            <p className="text-sm text-muted">Escoge tu nombre, escribe tu código de {PIN_LENGTH} números y repítelo. Ese código será tu entrada.</p>
            {!pending.length ? <p className="text-sm text-ok">Todo el equipo ya tiene su código.</p> : (
              <>
                <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Tu nombre">
                  <option value="">Escoge tu nombre…</option>
                  {pending.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.role ? ` · ${m.role}` : ''}</option>)}
                </Select>
                <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(onlyDigits(e.target.value))} placeholder="Tu código" className="text-center text-xl tracking-[0.4em]" />
                <Input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(onlyDigits(e.target.value))} placeholder="Repite tu código" className="text-center text-xl tracking-[0.4em]" onKeyDown={(e) => e.key === 'Enter' && createFirst()} />
                <Button className="w-full" icon={KeyRound} loading={busy} onClick={createFirst}>Guardar mi código y entrar</Button>
              </>
            )}
            {!nobody && <button onClick={() => { setMode('pin'); setPin(''); setPin2('') }} className="w-full text-center text-sm text-brand hover:underline">Ya tengo mi código</button>}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted">Escribe tu PIN de {PIN_LENGTH} números</p>
            <Input type="password" inputMode="numeric" autoFocus value={pin} aria-label="PIN"
              onChange={(e) => { const v = onlyDigits(e.target.value); setPin(v); if (v.length === PIN_LENGTH) enter(v) }}
              className="text-center text-2xl tracking-[0.5em]" placeholder="••••" />
            <Button className="w-full" icon={KeyRound} loading={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => enter()}>Entrar</Button>
            {pending.length > 0 && <button onClick={() => { setMode('activar'); setPin(''); setPin2('') }} className="w-full rounded-xl border border-ink-600 py-2.5 text-sm font-semibold hover:border-brand">Activar mi acceso (primera vez)</button>}
            <p className="text-xs text-muted">¿Olvidaste tu código? Pídele a Jany que te active de nuevo.</p>
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
  const viewAs = useViewAs()
  return (
    <div className="text-xs text-muted">
      <p className="mb-1 flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> Entraste como</p>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{actor}{me?.role ? <span className="font-normal text-muted"> · {me.role}</span> : null}</span>
        <button onClick={() => setChanging(true)} className="rounded-lg p-1.5 hover:bg-ink-700 hover:text-fg" title="Cambiar mi PIN" aria-label="Cambiar mi PIN"><KeyRound className="h-4 w-4" /></button>
        <button onClick={() => setActor('', '')} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-ink-700 hover:text-fg" title="Salir"><LogOut className="h-4 w-4" /> Salir</button>
      </div>
      {isJany(me?.full_name) && (
        <label className="mt-2 block">
          <span className="mb-1 block">Ver como…</span>
          <Select value={viewAs} onChange={(e) => setViewAs(e.target.value)} className="h-9 text-sm" aria-label="Ver la plataforma como otra persona">
            <option value="">Mi vista (Jany)</option>
            {(team.data ?? []).filter((m) => m.active && m.id !== me?.id).map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.role ? ` · ${m.role}` : ''}</option>)}
          </Select>
        </label>
      )}
      {changing && me && <SetPinModal member={me} self onClose={() => setChanging(false)} />}
    </div>
  )
}

/** Aviso arriba cuando Jany está viendo como otra persona. */
export function ViewAsBanner() {
  const team = useTeam()
  const viewAs = useViewAs()
  const me = team.data?.find((m) => m.id === getActorId())
  const other = team.data?.find((m) => m.id === viewAs)
  if (!isJany(me?.full_name) || !other) return null
  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-info px-4 py-2 text-sm font-semibold text-ink">
      Estás viendo la plataforma como {other.full_name}{other.role ? ` (${other.role})` : ''}
      <button onClick={() => setViewAs('')} className="rounded-lg bg-ink px-3 py-1 text-xs text-white">Volver a mi vista</button>
    </div>
  )
}

/** Guarda el PIN. El temporal (lo genera Jany) se ve en Configuración hasta que la persona escoge el suyo. */
async function savePin(id: string, hash: string, tempPin: string | null) {
  const r = await supabase.from('team_members').update({ pin_hash: hash, pin_must_change: !!tempPin, pin_temp: tempPin }).eq('id', id)
  if (r.error && /pin_must_change|pin_temp/.test(r.error.message)) unwrap(await supabase.from('team_members').update({ pin_hash: hash }).eq('id', id))
  else unwrap(r)
}

/** Sólo Jany genera y ve las claves temporales. */
export const isJany = (name: string | null | undefined) => (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'jany'

/** PIN temporal al azar: 4 números, no obvio y distinto al de los demás. */
async function randomPin(team: TeamMember[], exceptId: string) {
  for (let i = 0; i < 50; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000
    const pin = String(n)
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) continue
    if (!(await whosePin(team.filter((m) => m.id !== exceptId), pin))) return pin
  }
  throw new Error('No se pudo generar el PIN, inténtalo de nuevo.')
}

/** Asignar o cambiar el PIN de una persona (debe ser distinto al de los demás). */
function SetPinModal({ member, self, onClose, forced, activate }: { member: TeamMember; self?: boolean; onClose: () => void; forced?: boolean; activate?: boolean }) {
  const team = useTeam()
  const qc = useQueryClient()
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (pin.length !== PIN_LENGTH) return toast.error(`El PIN son ${PIN_LENGTH} números.`)
    if (pin !== pin2) return toast.error('Los dos PIN no coinciden.')
    if (/^(\d)\1+$/.test(pin) || pin === '1234' || pin === '4321') return toast.error('Ese PIN es muy fácil de adivinar. Escoge otro.')
    setBusy(true)
    try {
      const other = await whosePin((team.data ?? []).filter((m) => m.id !== member.id), pin)
      if (other) { setBusy(false); return toast.error('Ese PIN ya lo usa otra persona. Escoge otro.') }
      await savePin(member.id, await pinHash(member.id, pin), null)
      await qc.invalidateQueries({ queryKey: ['team'] })
      toast.ok(activate ? `¡Listo! ${member.full_name} ya puede entrar con su PIN` : 'Tu PIN quedó guardado')
      onClose()
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={forced ? () => {} : onClose} title={forced ? `Hola, ${member.full_name.split(' ')[0]}: escoge tu PIN` : activate ? `Activar a ${member.full_name}` : 'Cambiar mi PIN'}
      footer={<>{forced ? <Button variant="secondary" onClick={() => setActor('', '')}>Salir</Button> : <Button variant="secondary" onClick={onClose}>Cancelar</Button>}<Button icon={KeyRound} loading={busy} onClick={save}>Guardar PIN</Button></>}>
      <div className="space-y-3">
        {activate && <p className="rounded-xl border border-brand/40 bg-brand-dim p-3 text-sm">Pásale el celular a <b>{member.full_name}</b> para que escriba su PIN de {PIN_LENGTH} números dos veces. Sólo esa persona lo sabrá; nadie más lo puede ver.</p>}
        {forced && <p className="rounded-xl border border-brand/40 bg-brand-dim p-3 text-sm">Entraste con un PIN temporal. Escoge tu PIN personal de {PIN_LENGTH} números: sólo tú lo vas a saber.</p>}
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
  const actor = useActor()
  const jany = isJany(actor)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [mine, setMine] = useState<TeamMember | null>(null)
  const [activating, setActivating] = useState<TeamMember | null>(null)
  const [busy, setBusy] = useState('')
  const list = team.data ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] })
  const add = async () => {
    if (name.trim().length < 2) return toast.error('Escribe el nombre.')
    try {
      unwrap(await supabase.from('team_members').insert({ full_name: name.trim(), role: role.trim() || null }))
      await refresh(); setName(''); setRole('')
      toast.ok(jany ? 'Agregado al equipo. Genérale su PIN.' : 'Agregado al equipo. Jany le genera su PIN.')
    } catch (e) { toast.error(e) }
  }
  const generate = async (ms: TeamMember[]) => {
    if (!ms.length) return toast.ok('Todos tienen PIN.')
    setBusy(ms.length > 1 ? 'all' : ms[0].id)
    try {
      for (const m of ms) {
        const pin = await randomPin(list, m.id)
        await savePin(m.id, await pinHash(m.id, pin), pin)
        m.pin_hash = await pinHash(m.id, pin) // para que el siguiente no repita
      }
      await refresh()
      toast.ok(ms.length > 1 ? `Se generaron ${ms.length} PIN temporales` : `PIN temporal de ${ms[0].full_name} generado`)
    } catch (e) { toast.error(e) } finally { setBusy('') }
  }
  const clearPin = async (m: TeamMember) => {
    if (!window.confirm(`¿Quitar el PIN de ${m.full_name}? Ya no podrá entrar hasta que le generes otro.`)) return
    try { unwrap(await supabase.from('team_members').update({ pin_hash: null, pin_must_change: false, pin_temp: null }).eq('id', m.id)); await refresh(); toast.ok('PIN quitado') } catch (e) { toast.error(e) }
  }
  const toggle = async (id: string, active: boolean) => {
    try { unwrap(await supabase.from('team_members').update({ active }).eq('id', id)); await refresh() } catch (e) { toast.error(e) }
  }
  const without = list.filter((m) => m.active && !m.pin_hash)
  return (
    <Card className="space-y-3 p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Equipo Rancho Seco y PIN de acceso</h3>
          <p className="text-sm text-muted">Cada persona entra con su PIN de {PIN_LENGTH} números. Sólo el puesto <b>Administración</b> ve los números; los demás ven la vista de profesor.</p>
          <p className="mt-1 text-xs text-muted">{jany
            ? 'Ve con cada persona y dale “Activar”: le pasas el celular y ella misma escribe su PIN (nadie más lo ve). Si no estás con ella, puedes darle un PIN temporal y al entrar escogerá el suyo. Si alguien lo olvida, actívalo de nuevo.'
            : 'Los PIN temporales los genera y los ve sólo Jany. Tu PIN lo puedes cambiar con la llavecita junto a tu nombre en el menú.'}</p>
        </div>
        {jany && without.length > 0 && <Button icon={KeyRound} loading={busy === 'all'} onClick={() => generate(without)}>Generar PIN para los {without.length} que no tienen</Button>}
      </div>
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-600">
        {list.map((m) => (
          <li key={m.id} className={cx('flex flex-wrap items-center gap-2 px-3 py-2 text-sm', !m.active && 'opacity-50')}>
            <b className="min-w-0 flex-1">{m.full_name}</b>
            {m.role && <Badge tone={isAdminRole(m.role) ? 'brand' : 'neutral'}>{m.role}</Badge>}
            {jany && m.pin_must_change && m.pin_temp
              ? <span className="rounded-lg bg-brand-dim px-2 py-1 font-mono text-base font-bold tracking-widest text-brand" title="PIN temporal: dáselo en persona">{m.pin_temp}</span>
              : <span className={cx('text-xs', !m.pin_hash ? 'text-warn' : m.pin_must_change ? 'text-info' : 'text-ok')}>{!m.pin_hash ? 'sin PIN (no puede entrar)' : m.pin_must_change ? '⏳ PIN temporal (aún no entra)' : '🔒 ya escogió su PIN'}</span>}
            {m.id === getActorId()
              ? <Button size="sm" variant="secondary" icon={KeyRound} onClick={() => setMine(m)}>Cambiar mi PIN</Button>
              : jany && <>
                <Button size="sm" icon={KeyRound} onClick={() => setActivating(m)}>{m.pin_hash ? 'Activar de nuevo' : 'Activar'}</Button>
                <Button size="sm" variant="ghost" loading={busy === m.id} onClick={() => generate([m])}>{m.pin_hash ? 'PIN temporal nuevo' : 'o PIN temporal'}</Button>
              </>}
            {jany && m.pin_hash && m.id !== getActorId() && <button className="text-xs text-muted hover:text-bad hover:underline" onClick={() => clearPin(m)}>Quitar PIN</button>}
            <button className="text-xs text-muted hover:text-brand hover:underline" onClick={() => toggle(m.id, !m.active)}>{m.active ? 'Dar de baja' : 'Volver a activar'}</button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (como siempre se va a ver)" />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Puesto (Administración / Profesor)" list="team-roles" />
        <datalist id="team-roles">{['Administración', 'Coordinador', 'Profesor', 'Staff'].map((r) => <option key={r} value={r} />)}</datalist>
        <Button icon={Plus} onClick={add}>Agregar</Button>
      </div>
      {mine && <SetPinModal member={mine} self onClose={() => setMine(null)} />}
      {activating && <SetPinModal member={activating} activate onClose={() => setActivating(null)} />}
    </Card>
  )
}

/** Si entró con PIN temporal, primero escoge el suyo. */
export function ForceOwnPin() {
  const team = useTeam()
  const me = team.data?.find((m) => m.id === getActorId())
  if (!me?.pin_must_change) return null
  return <SetPinModal member={me} self forced onClose={() => {}} />
}
