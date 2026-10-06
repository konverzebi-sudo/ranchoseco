const NAME_KEY = 'rs-actor'
const ID_KEY = 'rs-actor-id'
const read = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }

/** Quién está usando este celular o computadora (se escoge de la lista del equipo). */
export const getActor = () => read(NAME_KEY)
export const getActorId = () => read(ID_KEY)
export function setActor(id: string, name: string) {
  try {
    if (id) { localStorage.setItem(ID_KEY, id); localStorage.setItem(NAME_KEY, name) }
    else { localStorage.removeItem(ID_KEY); localStorage.removeItem(NAME_KEY) }
  } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event('rs-actor'))
}
