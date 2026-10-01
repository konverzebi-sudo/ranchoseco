import { useEffect, useState } from 'react'
import { MessageCircle, Briefcase } from 'lucide-react'
import { Modal } from './ui'

const KEY = 'rs-whatsapp-app'
type App = 'normal' | 'business'

const isAndroid = () => /Android/i.test(navigator.userAgent)
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
const readPref = (): App | null => { try { return (localStorage.getItem(KEY) as App) || null } catch { return null } }
const savePref = (v: App | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY) } catch { /* sin almacenamiento */ } }

/** Abre la conversación en la app elegida (en Android se puede escoger entre WhatsApp y WhatsApp Business). */
function openIn(app: App, waUrl: string) {
  const u = new URL(waUrl)
  const phone = u.pathname.replace(/\D/g, '')
  const text = u.searchParams.get('text') ?? ''
  if (isAndroid()) {
    const pkg = app === 'business' ? 'com.whatsapp.w4b' : 'com.whatsapp'
    const q = `${phone ? `phone=${phone}&` : ''}text=${encodeURIComponent(text)}`
    window.location.href = `intent://send/?${q}#Intent;scheme=whatsapp;package=${pkg};S.browser_fallback_url=${encodeURIComponent(waUrl)};end`
    return
  }
  // En iPhone ambas apps usan el mismo enlace; se abre la que el teléfono tenga como principal
  window.open(waUrl, '_blank', 'noopener')
}

/**
 * En el celular, antes de mandar cualquier mensaje por WhatsApp pregunta con cuál app:
 * WhatsApp normal o WhatsApp Business (se puede recordar la elección en ese celular).
 */
export default function WaChooser() {
  const [pending, setPending] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('a[href^="https://wa.me/"]') as HTMLAnchorElement | null
      if (!a || !isMobile()) return
      e.preventDefault()
      const pref = readPref()
      if (pref) openIn(pref, a.href)
      else setPending(a.href)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const choose = (app: App) => {
    if (remember) savePref(app)
    if (pending) openIn(app, pending)
    setPending(null)
  }

  return (
    <Modal open={!!pending} onClose={() => setPending(null)} title="¿Con cuál WhatsApp lo envías?">
      <div className="space-y-3">
        <button onClick={() => choose('normal')} className="flex w-full items-center gap-3 rounded-xl bg-wa px-4 py-3 text-left font-semibold text-ink hover:brightness-110">
          <MessageCircle className="h-6 w-6" /> WhatsApp
        </button>
        <button onClick={() => choose('business')} className="flex w-full items-center gap-3 rounded-xl border-2 border-wa px-4 py-3 text-left font-semibold hover:bg-wa/10">
          <Briefcase className="h-6 w-6 text-wa" /> WhatsApp Business
        </button>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[#25D366]" />
          Recordar en este celular (se puede cambiar en Configuración)
        </label>
        {!isAndroid() && <p className="text-xs text-muted">En iPhone se abre la app de WhatsApp que el teléfono tenga como principal.</p>}
      </div>
    </Modal>
  )
}

/** Para Configuración: ver o borrar la app recordada en este celular. */
export function useWaPreference() {
  const [pref, setPref] = useState<App | null>(() => readPref())
  return { pref, set: (v: App | null) => { savePref(v); setPref(v) } }
}
