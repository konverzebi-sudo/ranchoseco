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
import { ToastProvider } from './components/toast'
import { Spinner } from './components/ui'
import { isConfigured } from './lib/supabase'
import SetupNeeded from './pages/SetupNeeded'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentDetail from './pages/StudentDetail'
import AttendancePage from './pages/Attendance'
import Billing from './pages/Billing'
import Expenses from './pages/Expenses'
import ExpenseBreakdown from './pages/ExpenseBreakdown'
import Scholarships from './pages/Scholarships'
import Categories from './pages/Categories'
import Coaches from './pages/Coaches'
import Trainings from './pages/Trainings'
import Matches from './pages/Matches'
import MatchDetail from './pages/MatchDetail'
import CalendarPage from './pages/Calendar'
import Reports from './pages/Reports'
import SettingsPage from './pages/SettingsPage'
import NotFound from './pages/NotFound'

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
          {!isConfigured ? (
            <SetupNeeded />
          ) : (
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
          )}
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
