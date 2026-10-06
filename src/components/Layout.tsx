import { Suspense, useMemo, useState, useEffect, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Layers, UserCog, ClipboardCheck, Wallet, Receipt, GraduationCap, Dumbbell, Trophy, CalendarDays,
  FileText, Settings, Menu, X, Search, Scale, Shirt, Star,
} from 'lucide-react'
import { Spinner, cx } from './ui'
import ErrorBoundary from './ErrorBoundary'
import AutoMonthlyFees from './AutoMonthlyFees'
import { AutoTrainings } from './WeeklySchedule'
import { ForceOwnPin, LoginScreen, WhoAmI } from './Team'
import { profeCanOpen, useRole, PROFE_PATHS } from '@/lib/role'
import { parentsOf, useCategories, useStudents } from '@/lib/api'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alumnos', label: 'Alumnos', icon: Users },
  { to: '/asistencias', label: 'Asistencias', icon: ClipboardCheck },
  { to: '/cobranza', label: 'Mensualidades y pagos', short: 'Cobranza', icon: Wallet },
  { to: '/becas', label: 'Becas', icon: GraduationCap },
  { to: '/uniformes', label: 'Uniformes', icon: Shirt },
  { to: '/gastos', label: 'Gastos', icon: Receipt },
  { to: '/corte', label: 'Corte de caja', short: 'Corte', icon: Scale },
  { to: '/categorias', label: 'Categorías', icon: Layers },
  { to: '/profesores', label: 'Profesores', icon: UserCog },
  { to: '/entrenamientos', label: 'Entrenamientos', icon: Dumbbell },
  { to: '/evaluaciones', label: 'Evaluaciones', icon: Star },
  { to: '/partidos', label: 'Partidos', icon: Trophy },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/reportes', label: 'Reportes', icon: FileText },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]
const MOBILE_MAIN = ['/', '/alumnos', '/asistencias', '/cobranza']

export const LOGO = `${import.meta.env.BASE_URL}escudo.png`

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src={LOGO} alt="Escudo Deportivo Rancho Seco" className={compact ? 'h-9 w-9' : 'h-12 w-12'} />
      <div className="leading-none">
        <p className="font-display text-xl font-bold uppercase tracking-wider">Rancho <span className="text-brand">Seco</span></p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Control de academia</p>
      </div>
    </div>
  )
}

const normQ = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Atajos que también aparecen en el buscador. */
const ACTIONS = [
  { to: '/cobranza?nuevo-pago=1', label: 'Generar pago', words: 'cobrar pago abono registrar' },
  { to: '/alumnos?nuevo=1', label: 'Nuevo alumno', words: 'alta inscribir registrar alumno' },
  { to: '/alumnos?nuevo=muestra', label: 'Clase muestra', words: 'prueba muestra' },
  { to: '/asistencias', label: 'Pasar lista', words: 'asistencia lista' },
  { to: '/gastos/desglose', label: 'Gastos día a día', words: 'desglose gastos dia' },
]

/**
 * Buscador de arriba: con unas cuantas letras muestra los niños que coinciden
 * (por su nombre, el de su papá o mamá, o su teléfono) y las secciones de la página.
 */
function QuickSearch({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const nav = useNavigate()
  const students = useStudents()
  const categories = useCategories()
  const term = normQ(q.trim())
  const digits = q.replace(/\D/g, '')
  const results = useMemo(() => {
    if (term.length < 2 && digits.length < 3) return []
    const cat = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
    const kids = (students.data ?? []).filter((s) => {
      const p = parentsOf(s)
      return normQ(s.full_name).includes(term) || p.all.some((g) => normQ(g.full_name).includes(term) || (digits.length >= 3 && g.phone.includes(digits)))
    }).sort((a, b) => Number(a.status === 'baja') - Number(b.status === 'baja') || Number(!normQ(a.full_name).startsWith(term)) - Number(!normQ(b.full_name).startsWith(term)) || a.full_name.localeCompare(b.full_name, 'es'))
      .slice(0, 7).map((s) => ({ key: s.id, to: `/alumnos/${s.id}`, title: s.full_name, sub: `${cat.get(s.category_id ?? '') ?? 'Sin categoría'}${s.status === 'baja' ? ' · baja' : s.status === 'muestra' ? ' · clase muestra' : ''}`, kind: 'Alumno' as const }))
    const pages = [
      ...NAV.filter((n) => normQ(n.label).includes(term)).map((n) => ({ key: n.to, to: n.to, title: n.label, sub: 'Sección', kind: 'Sección' as const })),
      ...ACTIONS.filter((a) => normQ(a.label).includes(term) || normQ(a.words).includes(term)).map((a) => ({ key: a.to, to: a.to, title: a.label, sub: 'Atajo', kind: 'Sección' as const })),
    ].slice(0, 5)
    return [...kids, ...pages]
  }, [term, digits, students.data, categories.data])

  const go = (to: string) => { nav(to); setQ(''); setOpen(false); onDone?.() }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (results[active]) return go(results[active].to)
    if (q.trim()) go(`/alumnos?q=${encodeURIComponent(q.trim())}&st=todos`)
  }
  return (
    <form onSubmit={submit} className="relative" role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} placeholder="Buscar niño, papá, mamá o sección"
        aria-label="Buscar" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Escape') setOpen(false)
        }}
        className="h-10 w-full rounded-xl border border-ink-600 bg-ink-900 pl-9 pr-3 text-sm placeholder:text-ink-500 focus:border-brand focus:outline-none" />
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-xl border border-ink-600 bg-ink-800 py-1 shadow-xl">
          {results.map((r, k) => (
            <li key={r.key}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(r.to)} onMouseEnter={() => setActive(k)}
                className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', k === active && 'bg-ink-700')}>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span><span className="block truncate text-xs text-muted">{r.sub}</span></span>
                <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', r.kind === 'Alumno' ? 'bg-brand/20 text-brand' : 'bg-ink-600 text-muted')}>{r.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && term.length >= 2 && results.length === 0 && (
        <p className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-muted shadow-xl">Sin resultados</p>
      )}
    </form>
  )
}

export default function Layout() {
  const role = useRole()
  const nav = role.isProfe ? NAV.filter((n) => PROFE_PATHS.includes(n.to)) : NAV
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  useEffect(() => setDrawer(false), [loc.pathname])

  // Sin PIN no se ve nada (los links de papás y el registro siguen abiertos)
  if (!role.ready) return <div className="min-h-dvh bg-page"><Spinner /></div>
  if (!role.loggedIn) return <LoginScreen logo={LOGO} />

  return (
    <div className="min-h-dvh lg:flex">
      <ForceOwnPin />
      {/* Sidebar escritorio */}
      <aside className="theme-dark sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-ink-600 bg-ink-900 lg:flex">
        <div className="px-5 pb-4 pt-6"><Brand /></div>
        {!role.isProfe && <div className="px-4 pb-3"><QuickSearch /></div>}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Menú principal">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-brand text-ink' : 'text-muted hover:bg-ink-700 hover:text-white')}>
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-ink-600 px-4 py-3"><WhoAmI /></div>
      </aside>

      {/* Encabezado celular */}
      <header className="theme-dark sticky top-0 z-30 flex items-center justify-between border-b border-ink-600 bg-ink-900/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Brand compact />
        <button onClick={() => setDrawer(true)} aria-label="Abrir menú" className="rounded-xl p-2 text-muted hover:bg-ink-700 hover:text-white">
          <Menu className="h-6 w-6" />
        </button>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-7xl"><AutoMonthlyFees /><AutoTrainings /><ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<Spinner />}>{role.isProfe && !profeCanOpen(loc.pathname) ? <NoAccess /> : <Outlet />}</Suspense></ErrorBoundary></div>
      </main>

      {/* Barra inferior celular */}
      <nav className="theme-dark fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink-600 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegación rápida">
        {(role.isProfe ? nav.slice(0, 4) : NAV.filter((n) => MOBILE_MAIN.includes(n.to))).map(({ to, label, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand' : 'text-muted')}>
            <Icon className="h-6 w-6" />
            {short ?? (label === 'Dashboard' ? 'Inicio' : label)}
          </NavLink>
        ))}
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted">
          <Menu className="h-6 w-6" />
          Más
        </button>
      </nav>

      {/* Menú completo celular */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <div className="theme-dark absolute inset-y-0 right-0 flex w-[86%] max-w-sm flex-col border-l border-ink-600 bg-ink-900">
            <div className="flex items-center justify-between px-4 py-3">
              <Brand compact />
              <button onClick={() => setDrawer(false)} aria-label="Cerrar menú" className="rounded-xl p-2 text-muted hover:bg-ink-700"><X className="h-6 w-6" /></button>
            </div>
            {!role.isProfe && <div className="px-4 pb-3"><QuickSearch onDone={() => setDrawer(false)} /></div>}
            <div className="px-4 pb-3"><WhoAmI /></div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
              {nav.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-3.5 text-base font-medium',
                    isActive ? 'bg-brand text-ink' : 'text-white hover:bg-ink-700')}>
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  )
}

/** Lo que no le toca ver a un profe (pagos, gastos, corte, configuración…). */
function NoAccess() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-ink-600 bg-ink-800 p-6 text-center">
      <p className="font-display text-2xl font-bold uppercase">Sección de administración</p>
      <p className="mt-2 text-sm text-muted">Esta parte la maneja administración. Desde tu menú tienes asistencias, entrenamientos, partidos, calendario, evaluaciones y reportes.</p>
      <NavLink to="/" className="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink">Ir a mi inicio</NavLink>
    </div>
  )
}
