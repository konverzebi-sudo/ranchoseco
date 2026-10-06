import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, UserRound } from 'lucide-react'
import { Badge, Button, Card, Input, Select, cx } from './ui'
import { useToast } from './toast'
import { useTeam } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { getActor, getActorId, setActor } from '@/lib/actor'

/** Nombre de quien usa este celular o computadora (se actualiza al cambiarlo). */
export function useActor() {
  const [actor, set] = useState(() => (getActorId() ? getActor() : ''))
  useEffect(() => {
    const on = () => set(getActorId() ? getActor() : '')
    window.addEventListener('rs-actor', on)
    return () => window.removeEventListener('rs-actor', on)
  }, [])
  return actor
}

/** "¿Quién eres?": se escoge del equipo y todo lo que se haga desde aquí queda con ese nombre. */
export function WhoAmI() {
  const team = useTeam()
  const actor = useActor()
  const list = (team.data ?? []).filter((m) => m.active)
  const id = actor ? getActorId() : ''
  return (
    <label className="block text-xs text-muted">
      <span className="mb-1 flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> Estás registrando como</span>
      <Select value={id} onChange={(e) => setActor(e.target.value, list.find((m) => m.id === e.target.value)?.full_name ?? '')}
        className={cx('h-9 text-sm', !actor && 'border-warn text-warn')} aria-label="¿Quién eres?">
        <option value="">¿Quién eres? (escoge tu nombre)</option>
        {list.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        {id && !list.some((m) => m.id === id) && <option value={id}>{actor}</option>}
      </Select>
    </label>
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

/** Configuración: la lista del equipo Rancho Seco. */
export function TeamSettings() {
  const team = useTeam()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] })
  const add = async () => {
    if (name.trim().length < 2) return toast.error('Escribe el nombre.')
    try {
      unwrap(await supabase.from('team_members').insert({ full_name: name.trim(), role: role.trim() || null }))
      await refresh(); setName(''); setRole('')
      toast.ok('Agregado al equipo')
    } catch (e) { toast.error(e) }
  }
  const toggle = async (id: string, active: boolean) => {
    try { unwrap(await supabase.from('team_members').update({ active }).eq('id', id)); await refresh() } catch (e) { toast.error(e) }
  }
  return (
    <Card className="space-y-3 p-5 lg:col-span-2">
      <div>
        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-brand">Equipo Rancho Seco</h3>
        <p className="text-sm text-muted">Las personas que reciben pagos y registran movimientos. Al cobrar se escoge de esta lista, así cada quien queda siempre con el mismo nombre.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(team.data ?? []).map((m) => (
          <span key={m.id} className={cx('inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', m.active ? 'border-ink-600' : 'border-ink-700 opacity-50')}>
            <b>{m.full_name}</b>{m.role && <Badge>{m.role}</Badge>}
            <button className="text-xs text-muted hover:text-brand hover:underline" onClick={() => toggle(m.id, !m.active)}>{m.active ? 'Quitar' : 'Volver a activar'}</button>
          </span>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (como siempre se va a ver)" />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Puesto (opcional)" list="team-roles" />
        <datalist id="team-roles">{['Administración', 'Profesor', 'Caja', 'Staff'].map((r) => <option key={r} value={r} />)}</datalist>
        <Button icon={Plus} onClick={add}>Agregar</Button>
      </div>
    </Card>
  )
}
