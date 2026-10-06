const NAME_KEY = 'rs-actor'
const ID_KEY = 'rs-actor-id'
const ADMIN_OK_KEY = 'rs-admin-ok'
const read = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }

/** Quién está usando este celular o computadora (se escoge de la lista del equipo). */
export const getActor = () => read(NAME_KEY)
export const getActorId = () => read(ID_KEY)
/** Administración que ya puso su PIN en este aparato (id de la persona). */
export const getAdminOk = () => read(ADMIN_OK_KEY)
export function setActor(id: string, name: string, adminOk = false) {
  try {
    if (id) { localStorage.setItem(ID_KEY, id); localStorage.setItem(NAME_KEY, name) }
    else { localStorage.removeItem(ID_KEY); localStorage.removeItem(NAME_KEY) }
    if (id && adminOk) localStorage.setItem(ADMIN_OK_KEY, id)
    else localStorage.removeItem(ADMIN_OK_KEY)
  } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event('rs-actor'))
}

/** PIN cifrado (SHA-256 junto con el id de la persona). */
export async function pinHash(memberId: string, pin: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rancho-seco:${memberId}:${pin}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Administración / directivos: los únicos que ven los números. */
export const isAdminRole = (role: string | null | undefined) => /admin|direct/i.test(role ?? '')
