import { LOGO } from '@/components/Layout'

export default function SetupNeeded() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <img src={LOGO} alt="Escudo Deportivo Rancho Seco" className="mx-auto h-28 w-28" />
        <h1 className="mt-6 font-display text-3xl font-bold uppercase">Falta conectar la base de datos</h1>
        <p className="mt-3 text-sm text-muted">
          Configura <code className="text-brand">VITE_SUPABASE_URL</code> y <code className="text-brand">VITE_SUPABASE_ANON_KEY</code> en
          el archivo <code>.env.local</code> (ver README) y vuelve a compilar el sitio.
        </p>
      </div>
    </div>
  )
}
