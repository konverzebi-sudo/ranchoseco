/** Lo que se le entrega a cada niño (se guarda la fecha de entrega). */
export const DELIVERIES = [
  { key: 'uniform_delivered_on', label: 'Uniforme', short: 'Uniforme' },
  { key: 'training_shirt_delivered_on', label: 'Playera de entrenamiento', short: 'Playera' },
  { key: 'credential_delivered_on', label: 'Credencial', short: 'Credencial' },
] as const
export type DeliveryKey = (typeof DELIVERIES)[number]['key']

export const SIZES = ['4', '6', '8', '10', '12', '14', '16', 'XCH', 'CH', 'M', 'G', 'XG']

/** Conceptos de cobro de uniformes: ese dinero se guarda aparte, en el fondo de uniformes. */
export const UNIFORM_CONCEPTS: { concept: string; price: number | null }[] = [
  // La primera playera va incluida en la inscripción; sólo se cobra si se pierde
  { concept: 'Playera de entrenamiento (reposición)', price: 250 },
  { concept: 'Credencial Chivas', price: 150 },
  { concept: 'Alta en Chivas (uniforme y credencial)', price: 100 },
  { concept: 'Uniforme', price: null },
]
/** La credencial de Chivas se cobra junto con la inscripción. */
export const CREDENTIAL_CONCEPT = 'Credencial Chivas'
export const CREDENTIAL_FEE = 150
export const isUniformConcept = (concept: string) => /uniform|playera|credencial|alta en chivas/i.test(concept)
export const UNIFORMS_FUND_KEY = 'x:uniformes'
