import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { date, money } from '@/lib/format'
import type { CutSummary } from '@/lib/cutReport'
import type { CutBoxes } from './cutPdf'

const Y = '#F2E30A'
const INK = '#111111'
const GRAY = '#6B6B6B'
const LIGHT = '#F4F4F2'
const LINE = '#E2E2E2'
const OK = '#16A34A'
const BAD = '#DC2626'
const INFO = '#2563EB'
const SAVE = '#9333EA'
const OUT_COLORS = ['#DC2626', '#EA580C', '#D97706', '#7C3AED']

// Helvetica del PDF no trae el signo menos tipográfico; se usa el guion normal
const m = (n: number) => money(Math.round(n * 100) / 100).replace('.00', '').replace('−', '-')
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, paddingBottom: 46 },
  header: { backgroundColor: INK, paddingVertical: 14, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center' },
  logo: { width: 54, height: 54, marginRight: 12 },
  hTitle: { color: '#FFFFFF', fontSize: 20, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  hSub: { color: Y, fontSize: 9, fontFamily: 'Helvetica-Bold', letterSpacing: 2, marginTop: 3 },
  hRight: { marginLeft: 'auto', alignItems: 'flex-end' },
  hDate: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Helvetica-Bold' },
  hSmall: { color: '#BBBBBB', fontSize: 8, marginTop: 2 },
  stripe: { height: 4, backgroundColor: Y },
  body: { paddingHorizontal: 28, paddingTop: 14 },
  section: { marginBottom: 14 },
  sTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textTransform: 'uppercase', borderLeftWidth: 3, borderLeftColor: Y, paddingLeft: 6, marginBottom: 8, flexDirection: 'row' },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: LIGHT, borderRadius: 6, padding: 9, borderTopWidth: 3 },
  kpiLabel: { fontSize: 7.5, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  result: { borderRadius: 8, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  resBig: { color: '#FFFFFF', fontSize: 22, fontFamily: 'Helvetica-Bold' },
  resSmall: { color: '#FFFFFF', fontSize: 9, marginTop: 2 },
  resCol: { marginLeft: 'auto', flexDirection: 'row', gap: 16 },
  resLbl: { color: '#FFFFFF', fontSize: 7.5, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.85 },
  resVal: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  barLabel: { width: 150, fontSize: 8.5 },
  barTrack: { flex: 1, height: 11, backgroundColor: '#ECECEC', borderRadius: 2, position: 'relative' },
  barVal: { width: 70, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { backgroundColor: LIGHT, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8, fontSize: 8 },
  table: { borderWidth: 1, borderColor: LINE, borderRadius: 4, marginBottom: 8 },
  group: { flexDirection: 'row', backgroundColor: INK, paddingVertical: 4, paddingHorizontal: 6 },
  groupTxt: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEEEEE', paddingVertical: 3, paddingHorizontal: 6 },
  td: { fontSize: 8 },
  note: { fontSize: 7.5, color: GRAY, marginTop: 1 },
  two: { flexDirection: 'row', gap: 10 },
  box: { flex: 1, backgroundColor: LIGHT, borderRadius: 6, padding: 10, marginBottom: 10 },
  solo: { backgroundColor: LIGHT, borderRadius: 6, padding: 10, marginBottom: 10 },
  boxTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  boxRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', color: GRAY, fontSize: 7.5, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 },
})

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[s.kpi, { borderTopColor: color }]}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
    </View>
  )
}

/** Barra horizontal: `from`→`to` dentro de la escala [lo, hi]. */
function Bar({ label, from, to, lo, hi, color, value, bold }: { label: string; from: number; to: number; lo: number; hi: number; color: string; value: string; bold?: boolean }) {
  const span = hi - lo || 1
  const a = ((Math.min(from, to) - lo) / span) * 100
  const w = Math.max(0.8, (Math.abs(to - from) / span) * 100)
  return (
    <View style={s.barRow} wrap={false}>
      <Text style={[s.barLabel, bold ? { fontFamily: 'Helvetica-Bold' } : {}]}>{label}</Text>
      <View style={s.barTrack}>
        <View style={{ position: 'absolute', left: `${a}%`, width: `${w}%`, top: 0, bottom: 0, backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={[s.barVal, { color }]}>{value}</Text>
    </View>
  )
}

/** Cómo se llega a "debería haber": había + entró - salió - se apartó + se cubrió. */
function Waterfall({ r }: { r: CutSummary }) {
  const steps: { label: string; delta: number; color: string; sign: string }[] = [
    { label: 'Había en caja', delta: r.had, color: GRAY, sign: '' },
    { label: 'Entró', delta: r.income, color: OK, sign: '+ ' },
    { label: 'Salió', delta: -r.outflow, color: BAD, sign: '- ' },
  ]
  if (r.saved > 0) steps.push({ label: 'Se apartó (ahorros)', delta: -r.saved, color: SAVE, sign: '- ' })
  if (r.coveredTotal > 0) steps.push({ label: 'Se cubrió con', delta: r.coveredTotal, color: INFO, sign: '+ ' })
  let acc = 0
  const rows = steps.map((x, i) => {
    const from = i === 0 ? 0 : acc
    acc += x.delta
    return { ...x, from, to: acc }
  })
  const all = [0, ...rows.flatMap((x) => [x.from, x.to])]
  const lo = Math.min(...all), hi = Math.max(...all)
  return (
    <View>
      {rows.map((x) => <Bar key={x.label} label={x.label} from={x.from} to={x.to} lo={lo} hi={hi} color={x.color} value={`${x.sign}${m(Math.abs(x.delta))}`} />)}
      <View style={{ borderTopWidth: 1, borderTopColor: LINE, marginTop: 3, paddingTop: 4 }}>
        <Bar label="Debería haber" from={0} to={r.balance} lo={lo} hi={hi} color={r.balance < 0 ? BAD : INK} value={m(r.balance)} bold />
        {r.balance >= -0.5 && <Bar label="Se contó" from={0} to={r.counted} lo={lo} hi={hi} color="#B8A900" value={m(r.counted)} bold />}
      </View>
    </View>
  )
}

function Result({ r }: { r: CutSummary }) {
  const short = r.balance < -0.5
  const tone = short || r.diff < -0.5 ? BAD : r.diff > 0.5 ? INFO : OK
  const title = short ? `FALTARON ${m(-r.balance)}` : r.diff < -0.5 ? `FALTAN ${m(-r.diff)}` : r.diff > 0.5 ? `SOBRAN ${m(r.diff)}` : 'LA CAJA CUADRA'
  const sub = short ? 'Salió más de lo que había y no se ha explicado de dónde salió.' : r.diff < -0.5 ? 'Se contó menos de lo que debería haber.' : r.diff > 0.5 ? 'Se contó más de lo que debería haber.' : 'Lo contado es igual a lo que debería haber.'
  return (
    <View style={[s.result, { backgroundColor: tone }]} wrap={false}>
      <View>
        <Text style={s.resBig}>{title}</Text>
        <Text style={s.resSmall}>{sub}</Text>
      </View>
      {!short && (
        <View style={s.resCol}>
          <View><Text style={s.resLbl}>Debería haber</Text><Text style={s.resVal}>{m(r.balance)}</Text></View>
          <View><Text style={s.resLbl}>Se contó</Text><Text style={s.resVal}>{m(r.counted)}</Text></View>
        </View>
      )}
    </View>
  )
}

function Footer({ generatedAt }: { generatedAt: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>Rancho Seco · Corte de caja · generado el {generatedAt}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  )
}

export function CutDocument({ r, logo, generatedAt, boxes }: { r: CutSummary; logo: string; generatedAt: string; boxes?: CutBoxes }) {
  const c = r.cut
  const maxConcept = Math.max(1, ...r.byConcept.map((x) => x.total))
  const maxGroup = Math.max(1, ...r.outGroups.map((g) => g.total))
  // Detalle de entradas agrupado por concepto (Mensualidad, Inscripción…)
  const key = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const insBy = r.byConcept.map((g) => ({
    ...g,
    items: r.ins.filter((i) => key(i.detail.split(' · ')[0] || 'Otros') === key(g.label)).sort((a, b) => a.date.localeCompare(b.date) || a.concept.localeCompare(b.concept)),
  }))
  const value = (i: { amount: number; adjusted: number | null }) => Number(i.adjusted ?? i.amount)

  return (
    <Document title={`Corte de caja ${c.cut_date}`} author="Rancho Seco">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Image src={logo} style={s.logo} />
          <View>
            <Text style={s.hTitle}>CORTE DE CAJA</Text>
            <Text style={s.hSub}>RANCHO SECO · CONTROL DE ACADEMIA</Text>
          </View>
          <View style={s.hRight}>
            <Text style={s.hDate}>{cap(date(c.cut_date, "EEEE d 'de' MMMM yyyy"))}</Text>
            <Text style={s.hSmall}>Del {date(c.period_from, "d 'de' MMM")} al {date(c.period_to, "d 'de' MMM")}</Text>
          </View>
        </View>
        <View style={s.stripe} />

        <View style={s.body}>
          <Result r={r} />

          <View style={[s.kpis, { marginBottom: 8 }]}>
            <Kpi label="Entradas" value={m(r.income)} color={OK} />
            <Kpi label="Gastos" value={m(r.outflow)} color={BAD} />
            <Kpi label="Saldo" value={m(r.had + r.income - r.outflow + r.coveredTotal)} color={INK} />
          </View>
          {boxes && (
            <View style={s.section} wrap={false}>
              <Text style={s.sTitle}>Caja de ahorro y próximos pagos</Text>
              <View style={s.kpis}>
                <Kpi label="Caja chica" value={m(boxes.chica)} color={GRAY} />
                <Kpi label="Caja de ahorro" value={m(boxes.ahorro)} color={OK} />
                <Kpi label="Apartado próx. gastos" value={m(boxes.apartado)} color={SAVE} />
                <Kpi label="Caja Chivas" value={m(boxes.chivas)} color={'#B8A900'} />
                <Kpi label="Caja total" value={m(boxes.total)} color={INK} />
              </View>
            </View>
          )}
          {boxes && boxes.chivas > 0 && (
            <View style={s.section} wrap={false}>
              <Text style={s.sTitle}>Distribución de Caja Chivas (inscripciones) · {m(boxes.chivas)}</Text>
              {boxes.chivasParts.map((p, i) => <Bar key={p.label} label={p.label} from={0} to={p.value} lo={0} hi={Math.max(1, ...boxes.chivasParts.map((x) => x.value))} color={['#B8A900', OK, INFO, GRAY][i]} value={`${m(p.value)} · ${Math.round((p.value / boxes.chivas) * 100)}%`} />)}
              {boxes.seguro.target > 0 && <Text style={{ fontSize: 8, color: GRAY, marginTop: 2 }}>Seguro: lleva {m(boxes.seguro.saved)} de {m(boxes.seguro.target)} ({Math.round((boxes.seguro.saved / boxes.seguro.target) * 100)}%)</Text>}
            </View>
          )}

          <View style={s.section} wrap={false}>
            <Text style={s.sTitle}>Cómo se llegó al saldo</Text>
            <Waterfall r={r} />
          </View>

          <View style={s.two}>
            {r.byConcept.length > 0 && (
              <View style={[s.section, { flex: 1 }]} wrap={false}>
                <Text style={s.sTitle}>Entró por concepto</Text>
                {r.byConcept.map((x) => <Bar key={x.label} label={`${x.label} (${x.n})`} from={0} to={x.total} lo={0} hi={maxConcept} color={OK} value={m(x.total)} />)}
                {r.byMethod.length > 0 && (
                  <View style={s.chips}>
                    {r.byMethod.map((x) => <Text key={x.label} style={s.chip}>{x.label}: {m(x.total)}</Text>)}
                  </View>
                )}
              </View>
            )}
            {r.outGroups.length > 0 && (
              <View style={[s.section, { flex: 1 }]} wrap={false}>
                <Text style={s.sTitle}>Salió por tipo</Text>
                {r.outGroups.map((g, i) => <Bar key={g.label} label={`${g.label} (${g.items.length})`} from={0} to={g.total} lo={0} hi={maxGroup} color={OUT_COLORS[i % OUT_COLORS.length]} value={m(g.total)} />)}
              </View>
            )}
          </View>

          {(r.savings.length > 0 || r.covered.length > 0 || r.sent.length > 0) && (
            <View style={s.two} wrap={false}>
              {r.sent.length > 0 && (
                <View style={s.box}>
                  <Text style={s.boxTitle}>A dónde se fue el dinero</Text>
                  {r.sent.map((x) => <View key={x.to} style={s.boxRow}><Text>{x.to}</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{m(x.amount)}</Text></View>)}
                </View>
              )}
              {r.savings.length > 0 && (
                <View style={s.box}>
                  <Text style={[s.boxTitle, { color: SAVE }]}>Se apartó · {m(r.saved)}</Text>
                  {r.savings.map((x) => <View key={x.name} style={s.boxRow}><Text>{x.name}</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{m(x.saved)}</Text></View>)}
                </View>
              )}
              {r.covered.length > 0 && (
                <View style={s.box}>
                  <Text style={[s.boxTitle, { color: INFO }]}>Lo que faltó salió de</Text>
                  {r.covered.map((x, i) => <View key={i} style={s.boxRow}><Text>{x.from}</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{m(x.amount)}</Text></View>)}
                </View>
              )}
            </View>
          )}

          {r.outGroups.length > 0 && (
            <View style={s.section}>
              <Text style={s.sTitle}>Detalle de lo que salió · {m(r.outflow)}</Text>
              {r.outGroups.map((g, gi) => (
                <View key={g.label} style={s.table}>
                  <View style={[s.group, { backgroundColor: OUT_COLORS[gi % OUT_COLORS.length] }]} wrap={false}>
                    <Text style={[s.groupTxt, { flex: 1 }]}>{g.label}</Text>
                    <Text style={s.groupTxt}>{m(g.total)}</Text>
                  </View>
                  {g.items.map((i, k) => (
                    <View key={k} style={[s.tr, k % 2 ? { backgroundColor: '#FAFAFA' } : {}]} wrap={false}>
                      <Text style={[s.td, { width: 46, color: GRAY }]}>{date(i.date, 'd MMM')}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.td}>{i.concept}</Text>
                        {(i.was != null || i.note) && <Text style={s.note}>{[i.was != null ? `Era ${m(i.was)}` : '', i.note].filter(Boolean).join(' · ')}</Text>}
                      </View>
                      <Text style={[s.td, { width: 70, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{m(i.value)}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {r.elsewhere.length > 0 && (
            <View style={s.solo} wrap={false}>
              <Text style={s.boxTitle}>Se pagó por fuera de la caja (no cuenta en este corte)</Text>
              {r.elsewhere.map((x, i) => (
                <View key={i} style={s.boxRow}>
                  <Text style={{ flex: 1 }}>{x.concept}{x.note ? ` · ${x.note}` : ''}</Text>
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{m(x.value)}</Text>
                </View>
              ))}
            </View>
          )}

          {insBy.length > 0 && (
            <View style={s.section}>
              <Text style={s.sTitle}>Detalle de lo que entró · {m(r.income)}</Text>
              {insBy.map((g) => (
                <View key={g.label} style={s.table}>
                  <View style={[s.group, { backgroundColor: OK }]} wrap={false}>
                    <Text style={[s.groupTxt, { flex: 1 }]}>{g.label} ({g.n})</Text>
                    <Text style={s.groupTxt}>{m(g.total)}</Text>
                  </View>
                  {g.items.map((i, k) => {
                    const parts = i.detail.split(' · ')
                    return (
                      <View key={i.key} style={[s.tr, k % 2 ? { backgroundColor: '#FAFAFA' } : {}]} wrap={false}>
                        <Text style={[s.td, { width: 46, color: GRAY }]}>{date(i.date, 'd MMM')}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.td}>{i.concept}</Text>
                          {(i.adjusted != null || i.note) && <Text style={s.note}>{[i.adjusted != null ? `Era ${m(Number(i.amount))}` : '', i.note].filter(Boolean).join(' · ')}</Text>}
                        </View>
                        <Text style={[s.td, { width: 90, color: GRAY }]}>{parts.length > 1 ? cap(parts.slice(1).join(' · ')) : ''}</Text>
                        <Text style={[s.td, { width: 60, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{m(value(i))}</Text>
                      </View>
                    )
                  })}
                </View>
              ))}
            </View>
          )}

          {r.notes !== '' && (
            <View style={[s.solo, { borderLeftWidth: 3, borderLeftColor: Y }]} wrap={false}>
              <Text style={s.boxTitle}>Notas del corte</Text>
              <Text>{r.notes}</Text>
            </View>
          )}
        </View>
        <Footer generatedAt={generatedAt} />
      </Page>
    </Document>
  )
}
