import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Card } from './ui'
import { useFees, useStudents } from '@/lib/api'
import { money, monthName } from '@/lib/format'

/**
 * Cargos pagados de más: lo pagado no corresponde a lo que se debía.
 * Se corrige con "Corregir" en el pago (bajar el monto o pasarlo al cargo correcto).
 */
export default function OverpaidAlert() {
  const fees = useFees()
  const students = useStudents()
  const name = (id: string) => students.data?.find((s) => s.id === id)?.full_name ?? 'Alumno'
  const list = (fees.data ?? []).filter((f) => Number(f.balance) < -0.001)
  if (!list.length) return null
  return (
    <Card className="border-bad/60">
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <AlertTriangle className="h-5 w-5 text-bad" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Pagado de más · revisar</h2>
      </div>
      <p className="px-5 pt-3 text-xs text-muted">Lo pagado no corresponde a lo que se debía. Entra al niño → Pagos → "Corregir" para dejar el monto correcto o pasarlo al cargo que sí corresponde.</p>
      <ul className="divide-y divide-ink-700">
        {list.map((f) => (
          <li key={f.id}>
            <Link to={`/alumnos/${f.student_id}?tab=pagos`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-ink-700/50">
              <span><b>{name(f.student_id)}</b> <span className="text-muted">· {f.concept} {monthName(f.period)}: costaba {money(f.total_due)}{Number(f.discount) > 0 ? ` (con ${money(f.discount)} de ${f.discount_reason ?? 'descuento'})` : ''}, se registró {money(f.paid)}</span></span>
              <span className="font-semibold text-bad">{money(-Number(f.balance))} de más</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
