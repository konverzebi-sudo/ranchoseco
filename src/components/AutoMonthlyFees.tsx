import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { startOfMonth } from 'date-fns'
import { useCategories, useFees, useSettings, useStudents } from '@/lib/api'
import { createMonthlyFees, monthlyPlan } from './PaymentForms'
import { useToast } from './toast'
import { monthName, toISODate } from '@/lib/format'
import { notify } from '@/lib/notify'

/**
 * Las mensualidades se crean solas: el primer día del mes (o la primera vez que se abre la
 * página ese mes) a cada alumno activo que todavía no tiene la de ese mes.
 */
export default function AutoMonthlyFees() {
  const students = useStudents()
  const categories = useCategories()
  const settings = useSettings()
  const fees = useFees()
  const qc = useQueryClient()
  const toast = useToast()
  const running = useRef(false)
  const periodDate = toISODate(startOfMonth(new Date()))

  useEffect(() => {
    if (running.current || !students.data || !categories.data || !settings.data || !fees.data) return
    const plan = monthlyPlan({ fees: fees.data, students: students.data, categories: categories.data, settings: settings.data, periodDate })
    if (!plan.toCreate.length) return
    running.current = true
    createMonthlyFees(plan, periodDate, settings.data.due_day ?? 8)
      .then(async (n) => {
        await notify(`Se crearon ${n} mensualidades de ${monthName(periodDate)}`, 'Se crean solas cada mes para los alumnos activos (con su promo, beca o cuota especial).', '/cobranza', 'mensualidades')
        await Promise.all(['fees', 'accounts', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
        toast.ok(`Se crearon ${n} mensualidades de ${monthName(periodDate)}`)
      })
      .catch(() => { /* se reintenta la próxima vez que se abra la página */ })
      .finally(() => { running.current = false })
  }, [students.data, categories.data, settings.data, fees.data, periodDate, qc, toast])

  return null
}
