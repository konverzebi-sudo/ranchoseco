import { Document, Page, View, Text, Image, StyleSheet, Svg, Rect, Line, Polyline, Circle, G } from '@react-pdf/renderer'
import { SKILL_GROUPS, type Evaluation, type SkillKey } from '@/lib/types'
import { groupAverage } from '@/lib/stats'
import { age, date, shortDate } from '@/lib/format'
import type { ReportData } from './reportData'

const Y = '#F2E30A'
const INK = '#111111'
const GRAY = '#6B6B6B'
const LIGHT = '#F4F4F2'
const COLORS: Record<string, string> = { tecnica: '#C9B800', fisica: '#3B82F6', tactica: '#16A34A', actitud: '#EA580C' }

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9.5, color: INK, paddingBottom: 48 },
  header: { backgroundColor: INK, paddingVertical: 16, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center' },
  logo: { width: 58, height: 58 },
  hTitle: { color: '#FFFFFF', fontSize: 18, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  hSub: { color: Y, fontSize: 9, fontFamily: 'Helvetica-Bold', letterSpacing: 2, marginTop: 3 },
  hRight: { marginLeft: 'auto', alignItems: 'flex-end' },
  hSmall: { color: '#BBBBBB', fontSize: 8 },
  stripe: { height: 4, backgroundColor: Y },
  body: { paddingHorizontal: 28, paddingTop: 16 },
  player: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  photo: { width: 64, height: 64, borderRadius: 32, marginRight: 14, objectFit: 'cover' },
  name: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  meta: { color: GRAY, marginTop: 3 },
  section: { marginBottom: 14 },
  sTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textTransform: 'uppercase', borderLeftWidth: 3, borderLeftColor: Y, paddingLeft: 6, marginBottom: 8 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: LIGHT, borderRadius: 6, padding: 9 },
  kpiLabel: { fontSize: 7.5, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  table: { borderWidth: 1, borderColor: '#E2E2E2', borderRadius: 4 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  th: { backgroundColor: INK, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 8, padding: 5 },
  td: { padding: 5, fontSize: 8.5 },
  two: { flexDirection: 'row', gap: 12 },
  box: { flex: 1, backgroundColor: LIGHT, borderRadius: 6, padding: 10 },
  boxTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 4 },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', color: GRAY, fontSize: 7.5, borderTopWidth: 1, borderTopColor: '#E2E2E2', paddingTop: 6 },
  skillRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
})

function Bars({ evaluation }: { evaluation: Evaluation }) {
  const W = 250, rowH = 11
  const rows = SKILL_GROUPS.flatMap((g) => g.skills.map(([k, label]) => ({ label, v: Number(evaluation[k as SkillKey]), c: COLORS[g.key] })))
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={s.skillRow}>
          <Text style={{ width: 92, fontSize: 8 }}>{r.label}</Text>
          <Svg width={W - 100} height={rowH}>
            <Rect x={0} y={2} width={W - 100} height={rowH - 4} fill="#E6E6E6" rx={2} />
            <Rect x={0} y={2} width={((W - 100) * r.v) / 5} height={rowH - 4} fill={r.c} rx={2} />
          </Svg>
          <Text style={{ width: 14, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 8 }}>{r.v}</Text>
        </View>
      ))}
    </View>
  )
}

function Evolution({ evaluations }: { evaluations: Evaluation[] }) {
  const pts = evaluations.slice(-8)
  const W = 250, H = 150, L = 22, B = 18, T = 8, R = 8
  const iw = W - L - R, ih = H - T - B
  const x = (i: number) => L + (pts.length === 1 ? iw / 2 : (iw * i) / (pts.length - 1))
  const y = (v: number) => T + ih - (ih * v) / 5
  return (
    <View>
      <Svg width={W} height={H}>
        {[1, 2, 3, 4, 5].map((v) => (
          <G key={v}>
            <Line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#E2E2E2" strokeWidth={0.6} />
            <Text x={L - 10} y={y(v) + 3} style={{ fontSize: 7, fill: GRAY } as never}>{String(v)}</Text>
          </G>
        ))}
        {SKILL_GROUPS.map((g) => {
          const coords = pts.map((e, i) => `${x(i)},${y(groupAverage(e, g.key))}`).join(' ')
          return (
            <G key={g.key}>
              {pts.length > 1 && <Polyline points={coords} stroke={COLORS[g.key]} strokeWidth={1.8} fill="none" />}
              {pts.map((e, i) => <Circle key={i} cx={x(i)} cy={y(groupAverage(e, g.key))} r={2.2} fill={COLORS[g.key]} />)}
            </G>
          )
        })}
        {pts.map((e, i) => (
          <Text key={i} x={Math.min(Math.max(x(i) - 14, 0), W - 32)} y={H - 4} style={{ fontSize: 6.5, fill: GRAY } as never}>{shortDate(e.date)}</Text>
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        {SKILL_GROUPS.map((g) => (
          <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 7, height: 7, backgroundColor: COLORS[g.key], marginRight: 3, borderRadius: 2 }} />
            <Text style={{ fontSize: 7.5 }}>{g.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export function ReportDocument({ data, logo }: { data: ReportData; logo: string }) {
  const latest = [...data.evaluations].filter((e) => e.date >= data.from).at(-1) ?? data.evaluations.at(-1) ?? null
  const a = data.attendance
  const played = data.matches
  const goals = played.reduce((t, m) => t + m.goals, 0)
  const assists = played.reduce((t, m) => t + m.assists, 0)
  const minutes = played.reduce((t, m) => t + m.minutes, 0)
  const ag = age(data.student.birthDate)

  return (
    <Document title={`Reporte deportivo — ${data.student.name}`} author={data.academyName} creator="Rancho Seco | Control de Academia">
      <Page size="LETTER" style={s.page}>
        <View style={s.header} fixed>
          <Image src={logo} style={s.logo} />
          <View style={{ marginLeft: 12 }}>
            <Text style={s.hTitle}>DEPORTIVO RANCHO SECO</Text>
            <Text style={s.hSub}>REPORTE DEPORTIVO</Text>
          </View>
          <View style={s.hRight}>
            <Text style={s.hSmall}>Periodo</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>{data.periodLabel}</Text>
          </View>
        </View>
        <View style={s.stripe} fixed />

        <View style={s.body}>
          <View style={s.player}>
            {data.student.photoUrl && <Image src={data.student.photoUrl} style={s.photo} />}
            <View>
              <Text style={s.name}>{data.student.name}</Text>
              <Text style={s.meta}>
                Categoría {data.student.category}{ag != null ? `  ·  ${ag} años` : ''}  ·  Profesor: {data.student.coach}
              </Text>
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sTitle}>Asistencia y participación</Text>
            <View style={s.kpis}>
              <View style={[s.kpi, { backgroundColor: INK }]}>
                <Text style={[s.kpiLabel, { color: '#BBBBBB' }]}>Asistencia</Text>
                <Text style={[s.kpiValue, { color: Y }]}>{a.rate != null ? `${a.rate}%` : '—'}</Text>
              </View>
              <View style={s.kpi}><Text style={s.kpiLabel}>Entrenamientos</Text><Text style={s.kpiValue}>{data.trainingsCount}</Text></View>
              <View style={s.kpi}><Text style={s.kpiLabel}>Pres. / Retardo</Text><Text style={s.kpiValue}>{a.present} / {a.late}</Text></View>
              <View style={s.kpi}><Text style={s.kpiLabel}>Faltas / Justif.</Text><Text style={s.kpiValue}>{a.absent} / {a.justified}</Text></View>
              <View style={s.kpi}><Text style={s.kpiLabel}>Partidos</Text><Text style={s.kpiValue}>{played.length}</Text></View>
            </View>
          </View>

          {played.length > 0 && (
            <View style={s.section} wrap={false}>
              <Text style={s.sTitle}>Historial de partidos</Text>
              <Text style={{ color: GRAY, marginBottom: 6 }}>Goles: {goals}  ·  Asistencias: {assists}  ·  Minutos jugados: {minutes}</Text>
              <View style={s.table}>
                <View style={s.tr}>
                  {['Fecha', 'Rival', 'Resultado', 'Posición', 'Titular', 'Min', 'Goles', 'Asist.'].map((h, i) => (
                    <Text key={h} style={[s.th, { width: ['12%', '26%', '12%', '16%', '10%', '8%', '8%', '8%'][i] }]}>{h}</Text>
                  ))}
                </View>
                {played.slice(-12).map((m, i) => (
                  <View key={i} style={s.tr}>
                    <Text style={[s.td, { width: '12%' }]}>{shortDate(m.date)}</Text>
                    <Text style={[s.td, { width: '26%' }]}>{m.opponent}</Text>
                    <Text style={[s.td, { width: '12%' }]}>{m.goalsFor != null ? `${m.goalsFor} - ${m.goalsAgainst}` : '—'}</Text>
                    <Text style={[s.td, { width: '16%' }]}>{m.position || '—'}</Text>
                    <Text style={[s.td, { width: '10%' }]}>{m.starter ? 'Sí' : 'No'}</Text>
                    <Text style={[s.td, { width: '8%' }]}>{m.minutes}</Text>
                    <Text style={[s.td, { width: '8%' }]}>{m.goals}</Text>
                    <Text style={[s.td, { width: '8%' }]}>{m.assists}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {latest ? (
            <>
              <View style={s.section} wrap={false}>
                <Text style={s.sTitle}>Evaluación deportiva ({date(latest.date)})</Text>
                <View style={s.kpis}>
                  {SKILL_GROUPS.map((g) => (
                    <View key={g.key} style={s.kpi}>
                      <Text style={s.kpiLabel}>{g.label}</Text>
                      <Text style={[s.kpiValue, { color: COLORS[g.key] }]}>{groupAverage(latest, g.key).toFixed(1)}<Text style={{ fontSize: 9, color: GRAY }}> / 5</Text></Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={[s.two, s.section]} wrap={false}>
                <View style={{ flex: 1 }}>
                  <Text style={s.boxTitle}>Detalle por habilidad</Text>
                  <Bars evaluation={latest} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.boxTitle}>Evolución</Text>
                  <Evolution evaluations={data.evaluations} />
                </View>
              </View>
              <View style={[s.two, s.section]} wrap={false}>
                <View style={s.box}><Text style={s.boxTitle}>Fortalezas</Text><Text>{latest.strengths || '—'}</Text></View>
                <View style={s.box}><Text style={s.boxTitle}>Áreas de mejora</Text><Text>{latest.improvements || '—'}</Text></View>
              </View>
              <View style={[s.two, s.section]} wrap={false}>
                <View style={s.box}><Text style={s.boxTitle}>Objetivos para el siguiente periodo</Text><Text>{latest.goals || '—'}</Text></View>
                <View style={s.box}><Text style={s.boxTitle}>Comentarios del profesor</Text><Text>{latest.comments || '—'}</Text></View>
              </View>
            </>
          ) : (
            <View style={s.section}>
              <Text style={s.sTitle}>Evaluación deportiva</Text>
              <Text style={{ color: GRAY }}>Aún no hay evaluaciones registradas para este jugador.</Text>
            </View>
          )}

          {data.trainings.length > 0 && (
            <View style={s.section}>
              <Text style={s.sTitle}>Entrenamientos del periodo</Text>
              {data.trainings.slice(-15).map((t, i) => (
                <Text key={i} style={{ marginBottom: 2 }}>{shortDate(t.date)}  ·  {t.objectives || 'Entrenamiento de categoría'}</Text>
              ))}
            </View>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text>{data.academyName} · Fútbol rápido</Text>
          <Text>Generado el {date(data.generatedAt.slice(0, 10))}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
