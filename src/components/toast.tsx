import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'

type ToastItem = { id: number; text: string; kind: 'ok' | 'error' }
const Ctx = createContext<{ ok: (t: string) => void; error: (t: unknown) => void }>({ ok: () => {}, error: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, kind: ToastItem['kind']) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, kind }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 2800)
  }, [])
  const ok = useCallback((t: string) => push(t, 'ok'), [push])
  const error = useCallback((e: unknown) => push(e instanceof Error ? e.message : String(e), 'error'), [push])
  return (
    <Ctx.Provider value={{ ok, error }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${t.kind === 'ok' ? 'border-ok/40 bg-ink-800/95' : 'border-bad/40 bg-ink-800/95'}`}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
