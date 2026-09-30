import { Suspense, useState, useEffect, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Layers, UserCog, ClipboardCheck, Wallet, Receipt, GraduationCap, Dumbbell, Trophy, CalendarDays,
  FileText, Settings, Menu, X, Search, Scale,
} from 'lucide-react'
import { Spinner, cx } from './ui'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alumnos', label: 'Alumnos', icon: Users },
  { to: '/asistencias', label: 'Asistencias', icon: ClipboardCheck },
  { to: '/cobranza', label: 'Mensualidades y pagos', short: 'Cobranza', icon: Wallet },
  { to: '/becas', label: 'Becas', icon: GraduationCap },
  { to: '/gastos', label: 'Gastos', icon: Receipt },
  { to: '/corte', label: 'Corte de caja', short: 'Corte', icon: Scale },
  { to: '/categorias', label: 'Categorías', icon: Layers },
  { to: '/profesores', label: 'Profesores', icon: UserCog },
  { to: '/entrenamientos', label: 'Entrenamientos', icon: Dumbbell },
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

function QuickSearch({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    nav(`/alumnos?q=${encodeURIComponent(q.trim())}`)
    setQ('')
    onDone?.()
  }
  return (
    <form onSubmit={submit} className="relative" role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar alumno, tutor o teléfono"
        aria-label="Buscar alumno"
        className="h-10 w-full rounded-xl border border-ink-600 bg-ink-900 pl-9 pr-3 text-sm placeholder:text-ink-500 focus:border-brand focus:outline-none" />
    </form>
  )
}

export default function Layout() {
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  useEffect(() => setDrawer(false), [loc.pathname])

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-ink-600 bg-ink-900 lg:flex">
        <div className="px-5 pb-4 pt-6"><Brand /></div>
        <div className="px-4 pb-3"><QuickSearch /></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Menú principal">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-brand text-ink' : 'text-muted hover:bg-ink-700 hover:text-white')}>
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="border-t border-ink-600 px-5 py-3 text-[11px] text-ink-500">Deportivo Rancho Seco · Fútbol rápido</p>
      </aside>

      {/* Encabezado celular */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-600 bg-ink/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Brand compact />
        <button onClick={() => setDrawer(true)} aria-label="Abrir menú" className="rounded-xl p-2 text-muted hover:bg-ink-700 hover:text-white">
          <Menu className="h-6 w-6" />
        </button>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-7xl"><Suspense fallback={<Spinner />}><Outlet /></Suspense></div>
      </main>

      {/* Barra inferior celular */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink-600 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegación rápida">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map(({ to, label, short, icon: Icon, end }) => (
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
          <div className="absolute inset-y-0 right-0 flex w-[86%] max-w-sm flex-col border-l border-ink-600 bg-ink-900">
            <div className="flex items-center justify-between px-4 py-3">
              <Brand compact />
              <button onClick={() => setDrawer(false)} aria-label="Cerrar menú" className="rounded-xl p-2 text-muted hover:bg-ink-700"><X className="h-6 w-6" /></button>
            </div>
            <div className="px-4 pb-3"><QuickSearch onDone={() => setDrawer(false)} /></div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
              {NAV.map(({ to, label, icon: Icon, end }) => (
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
