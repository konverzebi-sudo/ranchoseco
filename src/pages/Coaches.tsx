import { useState } from 'react'
import { Plus, Pencil, UserCog, MessageCircle } from 'lucide-react'
import { Avatar, Badge, Button, Card, Empty, ErrorState, PageHeader, Spinner, cx } from '@/components/ui'
import CoachModal from '@/components/CoachModal'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useStudents } from '@/lib/api'
import { FREQUENCY_LABEL, monthlyCost } from '@/lib/finance'
import { prettyPhone, money } from '@/lib/format'
import { waLink } from '@/lib/whatsapp'
import type { Coach } from '@/lib/types'

export default function Coaches() {
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const categories = useCategories()
  const students = useStudents()
  const pay = useCoachPay()
  const [editing, setEditing] = useState<Coach | 'new' | null>(null)

  if (coaches.error) return <ErrorState error={coaches.error} onRetry={() => coaches.refetch()} />
  return (
    <>
      <PageHeader title="Profesores" subtitle="Cada profesor puede llevar una o varias categorías."
        actions={<Button icon={Plus} onClick={() => setEditing('new')}>Nuevo profesor</Button>} />
      {coaches.isLoading ? <Spinner /> : !coaches.data?.length ? (
        <Card><Empty icon={UserCog} title="Aún no hay profesores" text="Regístralos y asígnales sus categorías." action={<Button icon={Plus} onClick={() => setEditing('new')}>Registrar profesor</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {coaches.data.map((c) => {
            const cats = (cc.data ?? []).filter((x) => x.coach_id === c.id).map((x) => x.category_id)
            const n = (students.data ?? []).filter((s) => s.status === 'activo' && (s.coach_id === c.id || (!s.coach_id && cats.includes(s.category_id ?? '')))).length
            return (
              <Card key={c.id} className={cx('p-5', !c.active && 'opacity-60')}>
                <div className="flex items-center gap-3">
                  <Avatar name={c.full_name} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-xl font-bold uppercase">{c.full_name}</p>
                    <p className="text-sm text-muted">{n} alumnos{!c.active && ' · Inactivo'}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(c)} aria-label={`Editar ${c.full_name}`} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {cats.length ? cats.map((id) => <Badge key={id} tone="brand">{categories.data?.find((k) => k.id === id)?.name}</Badge>) : <span className="text-sm text-muted">Sin categorías asignadas</span>}
                </div>
                {(() => {
                  const p = pay.data?.find((x) => x.coach_id === c.id)
                  return p ? (
                    <p className="mt-3 text-sm">
                      Sueldo: <span className="font-semibold">{money(p.amount)}</span> <span className="text-muted">{FREQUENCY_LABEL[p.frequency]}</span>
                      {p.frequency !== 'mensual' && <span className="text-muted"> · ≈ {money(Math.round(monthlyCost(p)))} al mes</span>}
                      {cats.length > 1 && <span className="block text-xs text-muted">Se reparte entre sus {cats.length} categorías en los reportes</span>}
                    </p>
                  ) : <p className="mt-3 text-sm text-muted">Sin sueldo registrado</p>
                })()}
                {c.phone && (
                  <a href={waLink(c.phone, `Hola ${c.full_name.split(' ')[0]}`)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-wa hover:underline">
                    <MessageCircle className="h-4 w-4" /> {prettyPhone(c.phone)}
                  </a>
                )}
              </Card>
            )
          })}
        </div>
      )}
      {editing && <CoachModal coach={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
