import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { date, money } from '@/lib/format'
import type { CutSummary } from '@/lib/cutReport'
import type { CutBoxes } from './cutPdf'

const Y = '#F2E30A'
const INK = '#111111'
const GRAY = '#6B6B6B'
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
  page: { fontFamily: 'Helvetica', fontSize: 9.5, color: INK, paddingBottom: 46, backgroundColor: '#F6F6F3' },
  header: { backgroundColor: INK, paddingVertical: 18, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center' },
  logo: { width: 58, height: 58, marginRight: 14 },
  hTitle: { color: '#FFFFFF', fontSize: 24, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  hSub: { color: Y, fontSize: 9, fontFamily: 'Helvetica-Bold', letterSpacing: 2, marginTop: 3 },
  hRight: { marginLeft: 'auto', alignItems: 'flex-end' },
  hDate: { color: Y, fontSize: 15, fontFamily: 'Helvetica-Bold' },
  hSmall: { color: '#CCCCCC', fontSize: 9, marginTop: 3 },
  stripe: { height: 5, backgroundColor: Y },
  body: { paddingHorizontal: 26, paddingTop: 16 },
  section: { marginBottom: 16 },
  sTitle: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.8, textTransform: 'uppercase', borderLeftWidth: 5, borderLeftColor: Y, paddingLeft: 8, marginBottom: 9, flexDirection: 'row' },
  kpis: { flexDirection: 'row', gap: 9 },
  kpi: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, borderLeftWidth: 5, borderWidth: 1, borderColor: '#E8E8E4' },
  kpiLabel: { fontSize: 7.5, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'Helvetica-Bold' },
  kpiValue: { fontSize: 21, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  result: { borderRadius: 16, paddingVertical: 18, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  resBig: { color: '#FFFFFF', fontSize: 30, fontFamily: 'Helvetica-Bold' },
  resSmall: { color: '#FFFFFF', fontSize: 10, marginTop: 3 },
  resCol: { marginLeft: 'auto', flexDirection: 'row', gap: 16 },
  resLbl: { color: '#FFFFFF', fontSize: 7.5, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.85 },
  resVal: { color: '#FFFFFF', fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  barLabel: { width: 150, fontSize: 8.5 },
  barTrack: { flex: 1, height: 12, backgroundColor: '#E9E9E4', borderRadius: 6, position: 'relative' },
  barVal: { width: 70, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, fontSize: 8.5, borderWidth: 1, borderColor: '#E8E8E4' },
  table: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8E4', borderRadius: 10, marginBottom: 9, overflow: 'hidden' },
  group: { flexDirection: 'row', backgroundColor: INK, paddingVertical: 6, paddingHorizontal: 9 },
  groupTxt: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 9.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0EC', paddingVertical: 4, paddingHorizontal: 9 },
  td: { fontSize: 8.5 },
  note: { fontSize: 7.5, color: GRAY, marginTop: 1 },
  two: { flexDirection: 'row', gap: 10 },
  box: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E8E8E4' },
  solo: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E8E8E4' },
  boxTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  boxRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', color: GRAY, fontSize: 7.5, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 },
})

function Kpi({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <View style={[s.kpi, { borderLeftColor: color }]}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
      {sub && <Text style={{ fontSize: 7.5, color: GRAY, marginTop: 3 }}>{sub}</Text>}
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


/** Resumen claro, renglón por renglón (como en la página del corte). */
function Summary({ r }: { r: CutSummary }) {
  const rows: { label: string; value: string; color?: string }[] = [
    { label: 'Caja chica anterior', value: m(r.had) },
    { label: '+ Total de entradas', value: m(r.income), color: OK },
    { label: '- Total de salidas', value: m(r.outflow), color: BAD },
    { label: '- Total en cajas de ahorro', value: m(r.saved), color: '#9A8C00' },
    ...(r.coveredTotal > 0 ? [{ label: '+ Lo que faltó salió de otro lado', value: m(r.coveredTotal), color: INFO }] : []),
  ]
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1.4, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E8E8E4', paddingVertical: 4 }}>
        {rows.map((x, i) => (
          <View key={x.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: '#F0F0EC' }}>
            <Text style={{ fontSize: 10 }}>{x.label}</Text>
            <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: x.color ?? INK }}>{x.value}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: INK, borderRadius: 12, padding: 14, justifyContent: 'center' }}>
          <Text style={{ color: '#BBBBBB', fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6, textTransform: 'uppercase' }}>Saldo final · queda en caja</Text>
          <Text style={{ color: r.balance < 0 ? '#FF6B6B' : Y, fontSize: 26, fontFamily: 'Helvetica-Bold', marginTop: 4 }}>{m(r.balance)}</Text>
        </View>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E8E8E4', padding: 12 }}>
          <Text style={{ color: GRAY, fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6, textTransform: 'uppercase' }}>Se contó en caja</Text>
          <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 3 }}>{m(r.counted)}</Text>
        </View>
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
                <Kpi label="Caja chica" value={m(boxes.chica)} color={'#B8A900'} sub="queda para el siguiente corte" />
                <Kpi label="Caja de ahorro" value={m(boxes.ahorro)} color={'#B8A900'} sub={`+ ${m(boxes.now.ahorro)} en este corte`} />
                <Kpi label="Apartado próx. gastos" value={m(boxes.apartado)} color={'#B8A900'} sub={`+ ${m(boxes.now.apartado)} en este corte`} />
                <Kpi label="Caja Chivas" value={m(boxes.chivas)} color={BAD} sub={`+ ${m(boxes.now.chivas)} en este corte`} />
                <Kpi label="Caja total" value={m(boxes.total)} color={INK} sub={`+ ${m(boxes.now.ahorro + boxes.now.apartado + boxes.now.chivas)} en este corte`} />
              </View>
              {boxes.detail.length > 0 && (
                <View style={[s.table, { marginTop: 8 }]}>
                  <View style={[s.group, { backgroundColor: INK }]}>
                    <Text style={[s.groupTxt, { flex: 1 }]}>Desglose de cada caja</Text>
                    <Text style={[s.groupTxt, { width: 90, textAlign: 'right' }]}>Total</Text>
                    <Text style={[s.groupTxt, { width: 90, textAlign: 'right' }]}>En este corte</Text>
                  </View>
                  {boxes.detail.map((x, i) => (
                    <View key={i} style={s.tr} wrap={false}>
                      <Text style={[s.td, { width: 110, color: x.caja === 'Caja Chivas' ? BAD : '#8A7E00', fontFamily: 'Helvetica-Bold' }]}>{x.caja}</Text>
                      <Text style={[s.td, { flex: 1 }]}>{x.name}</Text>
                      <Text style={[s.td, { width: 90, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{m(x.total)}</Text>
                      <Text style={[s.td, { width: 90, textAlign: 'right', color: x.now > 0 ? OK : GRAY }]}>{x.now > 0 ? `+ ${m(x.now)}` : '—'}</Text>
                    </View>
                  ))}
                </View>
              )}
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
            <Text style={s.sTitle}>Caja y a dónde se va el dinero</Text>
            <Summary r={r} />
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
