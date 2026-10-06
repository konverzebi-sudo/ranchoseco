import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import { ToastProvider } from './components/toast'
import { Spinner } from './components/ui'
import { isConfigured } from './lib/supabase'
import ErrorBoundary, { reloadOnce } from './components/ErrorBoundary'
import WaChooser from './components/WaChooser'

// Si se publicó una versión nueva mientras la página estaba abierta, recarga sola en lugar de quedarse en blanco
window.addEventListener('vite:preloadError', (e) => { if (reloadOnce()) e.preventDefault() })
import SetupNeeded from './pages/SetupNeeded'

// Cada sección se descarga sólo cuando se abre, para que la primera carga en el celular sea rápida.
const Students = lazy(() => import('./pages/Students'))
const StudentDetail = lazy(() => import('./pages/StudentDetail'))
const AttendancePage = lazy(() => import('./pages/Attendance'))
const Billing = lazy(() => import('./pages/Billing'))
const Expenses = lazy(() => import('./pages/Expenses'))
const ExpenseBreakdown = lazy(() => import('./pages/ExpenseBreakdown'))
const WeeklyCut = lazy(() => import('./pages/WeeklyCut'))
const Uniforms = lazy(() => import('./pages/Uniforms'))
const Evaluations = lazy(() => import('./pages/Evaluations'))
const Scholarships = lazy(() => import('./pages/Scholarships'))
const Categories = lazy(() => import('./pages/Categories'))
const Coaches = lazy(() => import('./pages/Coaches'))
const Trainings = lazy(() => import('./pages/Trainings'))
const Matches = lazy(() => import('./pages/Matches'))
const MatchDetail = lazy(() => import('./pages/MatchDetail'))
const CalendarPage = lazy(() => import('./pages/Calendar'))
const Reports = lazy(() => import('./pages/Reports'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const NotFound = lazy(() => import('./pages/NotFound'))
// El portal para padres se carga por separado para que abra rápido en el celular.
const Portal = lazy(() => import('./pages/Portal'))
const Registro = lazy(() => import('./pages/Registro'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HashRouter>
          <WaChooser />
          {!isConfigured ? (
            <SetupNeeded />
          ) : (
            <ErrorBoundary>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route path="/p/:token" element={<Portal />} />
                <Route path="/registro" element={<Registro />} />
                <Route element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="alumnos" element={<Students />} />
                  <Route path="alumnos/:id" element={<StudentDetail />} />
                  <Route path="asistencias" element={<AttendancePage />} />
                  <Route path="cobranza" element={<Billing />} />
                  <Route path="gastos" element={<Expenses />} />
                  <Route path="gastos/desglose" element={<ExpenseBreakdown />} />
                  <Route path="corte" element={<WeeklyCut />} />
                  <Route path="uniformes" element={<Uniforms />} />
                  <Route path="evaluaciones" element={<Evaluations />} />
                  <Route path="becas" element={<Scholarships />} />
                  <Route path="categorias" element={<Categories />} />
                  <Route path="profesores" element={<Coaches />} />
                  <Route path="entrenamientos" element={<Trainings />} />
                  <Route path="partidos" element={<Matches />} />
                  <Route path="partidos/:id" element={<MatchDetail />} />
                  <Route path="calendario" element={<CalendarPage />} />
                  <Route path="reportes" element={<Reports />} />
                  <Route path="configuracion" element={<SettingsPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
            </ErrorBoundary>
          )}
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
