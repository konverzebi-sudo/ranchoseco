import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Lock } from 'lucide-react'
import { Button, Modal, cx } from './ui'
import { useToast } from './toast'
import { useCategories, useCoachCategories, useCoaches } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'

/** Mapa categoría -> profesor que ya la tiene (una categoría sólo puede tener un profesor). */
export function useCategoryOwners() {
  const { data: cc } = useCoachCategories()
  const { data: coaches } = useCoaches()
  const owners = new Map<string, { id: string; name: string }>()
  for (const x of cc ?? []) {
    const c = coaches?.find((k) => k.id === x.coach_id)
    if (c && c.active) owners.set(x.category_id, { id: c.id, name: c.full_name })
  }
  return owners
}

/** Elegir las categorías de un profesor. Las que ya tiene otro profesor aparecen bloqueadas. */
export default function CoachCategoryPicker({ coachId, coachName, onClose }: { coachId: string; coachName: string; onClose: () => void }) {
  const { data: categories } = useCategories()
  const { data: cc } = useCoachCategories()
  const owners = useCategoryOwners()
  const qc = useQueryClient()
  const toast = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set((cc ?? []).filter((x) => x.coach_id === coachId).map((x) => x.category_id)))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const taken = [...selected].filter((id) => owners.get(id) && owners.get(id)!.id !== coachId)
      if (taken.length) throw new Error('Una de las categorías ya tiene profesor. Actualiza la página e inténtalo de nuevo.')
      unwrap(await supabase.from('coach_categories').delete().eq('coach_id', coachId))
      if (selected.size) unwrap(await supabase.from('coach_categories').insert([...selected].map((category_id) => ({ coach_id: coachId, category_id }))))
      await qc.invalidateQueries({ queryKey: ['coach_categories'] })
      toast.ok(`Categorías de ${coachName} guardadas`)
      onClose()
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  const free = (categories ?? []).filter((c) => !owners.get(c.id) || owners.get(c.id)!.id === coachId).length

  return (
    <Modal open onClose={onClose} title={`Categorías de ${coachName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={saving}>Guardar</Button></>}>
      <p className="mb-4 text-sm text-muted">
        Toca las categorías que entrena. {free === 0 ? 'No hay categorías libres.' : 'Las bloqueadas ya tienen profesor.'}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(categories ?? []).map((c) => {
          const owner = owners.get(c.id)
          const lockedBy = owner && owner.id !== coachId ? owner.name : null
          const on = selected.has(c.id)
          return (
            <button key={c.id} type="button" disabled={!!lockedBy}
              onClick={() => setSelected((s) => { const n = new Set(s); on ? n.delete(c.id) : n.add(c.id); return n })}
              className={cx('flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition',
                lockedBy ? 'cursor-not-allowed border-ink-700 bg-ink-900 opacity-50'
                  : on ? 'border-brand bg-brand text-ink' : 'border-ink-600 bg-ink-900 hover:border-ink-500')}>
              <span>
                <span className="block font-semibold">{c.name}</span>
                <span className={cx('text-xs', on && !lockedBy ? 'text-ink/70' : 'text-muted')}>{lockedBy ? `Asignada a ${lockedBy}` : on ? 'Seleccionada' : 'Disponible'}</span>
              </span>
              {lockedBy ? <Lock className="h-4 w-4 shrink-0" /> : on ? <Check className="h-5 w-5 shrink-0" /> : null}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
