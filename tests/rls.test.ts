/**
 * Ejecuta la migración real contra Postgres (PGlite) y verifica que el
 * Row Level Security aísla correctamente a administradores, profesores y padres.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'

const ADMIN = '00000000-0000-0000-0000-00000000000a'
const COACH_A = '00000000-0000-0000-0000-0000000000c1'
const COACH_B = '00000000-0000-0000-0000-0000000000c2'
const PARENT_1 = '00000000-0000-0000-0000-0000000000f1'
const PARENT_2 = '00000000-0000-0000-0000-0000000000f2'
const CAT_A = '10000000-0000-0000-0000-00000000000a'
const CAT_B = '10000000-0000-0000-0000-00000000000b'
const STU_1 = '20000000-0000-0000-0000-000000000001' // cat A, hijo de PARENT_1
const STU_2 = '20000000-0000-0000-0000-000000000002' // cat B, hijo de PARENT_2
const FEE_1 = '30000000-0000-0000-0000-000000000001'
const TR_A = '40000000-0000-0000-0000-00000000000a'
const TR_B = '40000000-0000-0000-0000-00000000000b'

// Imitación mínima del entorno de Supabase (auth.users, auth.uid(), roles).
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`

let db: PGlite

async function as<T = any>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set role authenticated;`)
  try {
    return await db.query<T>(sql, params)
  } finally {
    await db.exec("reset role; set request.jwt.claim.sub = '';")
  }
}
const count = async (uid: string, table: string) =>
  (await as<{ n: number }>(uid, `select count(*)::int as n from ${table}`)).rows[0].n

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  await db.exec(readFileSync('supabase/migrations/0001_schema.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0003_portal.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0004_open_mode.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0006_late_fees.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0007_becas.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0008_sueldos.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0009_gastos.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0010_recargo_mensual.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0011_gastos_en_partes.sql', 'utf8').replace(/notify pgrst[^;]*;/, ''))
  await db.exec(readFileSync('supabase/migrations/0012_hermanos.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0013_inactivo_temporal.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0014_clases_extra.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0015_registro_papas.sql', 'utf8'))
  await db.exec('update academia.settings set open_mode = false') // las pruebas por rol corren con el sitio cerrado

  const users: [string, string, string][] = [
    [ADMIN, 'admin@rs.mx', 'admin'],
    [COACH_A, 'coacha@rs.mx', 'profesor'],
    [COACH_B, 'coachb@rs.mx', 'profesor'],
    [PARENT_1, 'papa1@rs.mx', 'padre'],
    [PARENT_2, 'papa2@rs.mx', 'padre'],
  ]
  // Tutores registrados antes de que exista su usuario -> vinculación automática por correo
  await db.exec(`
    insert into academia.categories (id, name) values ('${CAT_A}', 'Sub-10'), ('${CAT_B}', 'Sub-14');
  `)
  await db.exec(`
    insert into academia.guardians (full_name, phone, email) values
      ('Papá Uno', '5215511111111', 'PAPA1@rs.mx'), ('Papá Dos', '5215522222222', 'papa2@rs.mx');
  `)
  for (const [id, email, role] of users) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
    await db.query('insert into academia.profiles (id, email, role) values ($1, $2, $3)', [id, email, role])
    await db.query('update academia.guardians set user_id = $1 where lower(email) = lower($2)', [id, email])
  }
  await db.exec(`
    insert into academia.coaches (id, full_name, user_id) values ('${COACH_A}', 'Profe A', '${COACH_A}'), ('${COACH_B}', 'Profe B', '${COACH_B}');
    insert into academia.coach_categories values ('${COACH_A}', '${CAT_A}'), ('${COACH_B}', '${CAT_B}');
    insert into academia.students (id, full_name, category_id) values
      ('${STU_1}', 'Alumno Uno', '${CAT_A}'), ('${STU_2}', 'Alumno Dos', '${CAT_B}');
    insert into academia.student_guardians (student_id, guardian_id)
      select '${STU_1}', id from academia.guardians where email = 'PAPA1@rs.mx';
    insert into academia.student_guardians (student_id, guardian_id)
      select '${STU_2}', id from academia.guardians where email = 'papa2@rs.mx';
    insert into academia.student_medical (student_id, allergies) values ('${STU_1}', 'Penicilina'), ('${STU_2}', 'Ninguna');
    insert into academia.fees (id, student_id, period, amount, due_date) values
      ('${FEE_1}', '${STU_1}', '2026-09-01', 600, '2026-09-10');
    insert into academia.fees (student_id, period, amount, due_date) values
      ('${STU_2}', '2026-09-01', 700, '2099-09-10');
    insert into academia.trainings (id, category_id, date) values ('${TR_A}', '${CAT_A}', current_date), ('${TR_B}', '${CAT_B}', current_date);
  `)
})

describe('proyecto compartido', () => {
  it('un usuario de Auth sin perfil en academia no ve nada', async () => {
    const OTHER = '00000000-0000-0000-0000-0000000000ee'
    await db.query(`insert into auth.users (id, email) values ($1, 'hub@otro.mx')`, [OTHER])
    expect(await count(OTHER, 'academia.students')).toBe(0)
    expect(await count(OTHER, 'academia.fees')).toBe(0)
    expect(await count(OTHER, 'academia.categories')).toBe(0)
    await expect(as(OTHER, `insert into academia.students (full_name) values ('X')`)).rejects.toThrow(/row-level security/)
  })
})

describe('administrador', () => {
  it('ve todos los alumnos, cargos y datos médicos', async () => {
    expect(await count(ADMIN, 'academia.students')).toBe(2)
    expect(await count(ADMIN, 'academia.fees')).toBe(2)
    expect(await count(ADMIN, 'academia.student_medical')).toBe(2)
  })
  it('registra pagos parciales y calcula estado', async () => {
    await as(ADMIN, `insert into academia.payments (fee_id, student_id, amount) values ($1, $2, 200)`, [FEE_1, STU_1])
    const r = await as<{ status: string; balance: string }>(ADMIN, `select status, balance from academia.fee_balances where id = $1`, [FEE_1])
    expect(r.rows[0].status).toBe('vencido') // venció el 10-sep-2026 y hay saldo
    expect(Number(r.rows[0].balance)).toBe(400)
  })
  it('rechaza pagos mayores al saldo', async () => {
    await expect(
      as(ADMIN, `insert into academia.payments (fee_id, student_id, amount) values ($1, $2, 500)`, [FEE_1, STU_1]),
    ).rejects.toThrow(/excede/)
  })
  it('liquidar deja el cargo como pagado', async () => {
    await as(ADMIN, `insert into academia.payments (fee_id, student_id, amount) values ($1, $2, 400)`, [FEE_1, STU_1])
    const r = await as<{ status: string }>(ADMIN, `select status from academia.fee_balances where id = $1`, [FEE_1])
    expect(r.rows[0].status).toBe('pagado')
  })
  it('cambiar de categoría deja historial de inscripción', async () => {
    await as(ADMIN, `update academia.students set category_id = $1 where id = $2`, [CAT_B, STU_1])
    await as(ADMIN, `update academia.students set category_id = $1 where id = $2`, [CAT_A, STU_1])
    const r = await as<{ n: number }>(ADMIN, `select count(*)::int n from academia.enrollments where student_id = $1`, [STU_1])
    expect(r.rows[0].n).toBe(3)
  })
})

describe('profesor', () => {
  it('sólo ve a los alumnos de sus categorías', async () => {
    const r = await as<{ id: string }>(COACH_A, 'select id from academia.students')
    expect(r.rows.map((x) => x.id)).toEqual([STU_1])
    expect(await count(COACH_A, 'academia.student_medical')).toBe(1)
    expect(await count(COACH_A, 'academia.categories')).toBe(1)
  })
  it('no ve mensualidades ni pagos', async () => {
    expect(await count(COACH_A, 'academia.fees')).toBe(0)
    expect(await count(COACH_A, 'academia.payments')).toBe(0)
  })
  it('registra asistencia en su categoría', async () => {
    await as(COACH_A, `insert into academia.attendance (training_id, student_id, status) values ($1, $2, 'presente')`, [TR_A, STU_1])
    expect(await count(COACH_A, 'academia.attendance')).toBe(1)
  })
  it('no puede registrar asistencia en otra categoría', async () => {
    await expect(
      as(COACH_A, `insert into academia.attendance (training_id, student_id, status) values ($1, $2, 'presente')`, [TR_B, STU_2]),
    ).rejects.toThrow(/row-level security/)
  })
  it('no puede crear entrenamientos de otra categoría', async () => {
    await expect(
      as(COACH_A, `insert into academia.trainings (category_id, date) values ($1, current_date)`, [CAT_B]),
    ).rejects.toThrow(/row-level security/)
  })
  it('evalúa sólo a sus jugadores', async () => {
    const cols = 'pase,control_balon,conduccion,tiro,recepcion,velocidad,resistencia,coordinacion,agilidad,posicionamiento,toma_decisiones,juego_equipo,disciplina,esfuerzo,companerismo'
    const vals = Array(15).fill(4).join(',')
    await as(COACH_A, `insert into academia.evaluations (student_id, coach_id, ${cols}) values ($1, $2, ${vals})`, [STU_1, COACH_A])
    await expect(
      as(COACH_A, `insert into academia.evaluations (student_id, coach_id, ${cols}) values ($1, $2, ${vals})`, [STU_2, COACH_A]),
    ).rejects.toThrow(/row-level security/)
  })
  it('no puede modificar alumnos ni cambiarse de rol', async () => {
    const r = await as(COACH_A, `update academia.students set full_name = 'X' where id = $1`, [STU_1])
    expect(r.affectedRows).toBe(0)
    await expect(as(COACH_A, `update academia.profiles set role = 'admin' where id = $1`, [COACH_A])).rejects.toThrow(/administrador/)
  })
})

describe('padre de familia', () => {
  it('sólo ve a su hijo', async () => {
    const r = await as<{ id: string }>(PARENT_1, 'select id from academia.students')
    expect(r.rows.map((x) => x.id)).toEqual([STU_1])
    expect(await count(PARENT_2, 'academia.students')).toBe(1)
  })
  it('ve sólo sus mensualidades, pagos, evaluaciones y asistencias', async () => {
    expect(await count(PARENT_1, 'academia.fees')).toBe(1)
    expect(await count(PARENT_1, 'academia.payments')).toBe(2)
    expect(await count(PARENT_1, 'academia.evaluations')).toBe(1)
    expect(await count(PARENT_1, 'academia.attendance')).toBe(1)
    expect(await count(PARENT_2, 'academia.payments')).toBe(0)
    expect(await count(PARENT_2, 'academia.evaluations')).toBe(0)
  })
  it('ve los entrenamientos sólo de la categoría de su hijo', async () => {
    const r = await as<{ id: string }>(PARENT_2, 'select id from academia.trainings')
    expect(r.rows.map((x) => x.id)).toEqual([TR_B])
  })
  it('no puede leer datos de otro alumno aunque conozca su id', async () => {
    const r = await as(PARENT_1, 'select * from academia.student_medical where student_id = $1', [STU_2])
    expect(r.rows.length).toBe(0)
    const g = await as(PARENT_1, 'select * from academia.guardians')
    expect(g.rows.length).toBe(1)
  })
  it('no puede registrar pagos, alumnos ni asistencias', async () => {
    await expect(
      as(PARENT_1, `insert into academia.payments (fee_id, student_id, amount) values ($1, $2, 1)`, [FEE_1, STU_1]),
    ).rejects.toThrow()
    await expect(as(PARENT_1, `insert into academia.students (full_name) values ('Intruso')`)).rejects.toThrow(/row-level security/)
    await expect(
      as(PARENT_1, `insert into academia.attendance (training_id, student_id, status) values ($1, $2, 'presente')`, [TR_A, STU_1]),
    ).rejects.toThrow(/row-level security/)
  })
  it('no puede autopromoverse a administrador', async () => {
    await expect(as(PARENT_1, `update academia.profiles set role = 'admin' where id = $1`, [PARENT_1])).rejects.toThrow(/administrador/)
  })
  it('un usuario desactivado pierde acceso', async () => {
    await db.query(`update academia.profiles set active = false where id = $1`, [PARENT_2])
    expect(await count(PARENT_2, 'academia.students')).toBe(0)
    await db.query(`update academia.profiles set active = true where id = $1`, [PARENT_2])
  })
})

describe('portal para padres por link privado', () => {
  async function anon(sql: string, params: unknown[] = []) {
    await db.exec(`reset role; set request.jwt.claim.sub = ''; set role anon;`)
    try { return await db.query<any>(sql, params) } finally { await db.exec('reset role;') }
  }
  it('cada alumno nuevo recibe un link automáticamente', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int n from academia.portal_links')
    expect(r.rows[0].n).toBe(2)
  })
  it('con el token correcto devuelve sólo la información de ese alumno', async () => {
    const tok = (await db.query<{ token: string }>('select token from academia.portal_links where student_id = $1', [STU_1])).rows[0].token
    const r = await anon('select academia.get_portal($1) as p', [tok])
    const p = r.rows[0].p
    expect(p.student.full_name).toBe('Alumno Uno')
    expect(p.fees.length).toBe(1)
    expect(p.evaluations.length).toBe(1)
    expect(JSON.stringify(p)).not.toContain('Penicilina')
    expect(JSON.stringify(p)).not.toContain('Alumno Dos')
    expect(JSON.stringify(p)).not.toContain('55111')
  })
  it('un token inválido no devuelve nada', async () => {
    const r = await anon('select academia.get_portal($1) as p', ['x'.repeat(64)])
    expect(r.rows[0].p).toBeNull()
  })
  it('un visitante sin sesión no puede leer tablas directamente', async () => {
    expect((await anon('select * from academia.portal_links')).rows.length).toBe(0)
    expect((await anon('select * from academia.students')).rows.length).toBe(0)
  })
  it('regenerar el link invalida el anterior', async () => {
    const old = (await db.query<{ token: string }>('select token from academia.portal_links where student_id = $1', [STU_1])).rows[0].token
    await as(COACH_A, 'select academia.regenerate_portal_link($1)', [STU_1])
    const r = await anon('select academia.get_portal($1) as p', [old])
    expect(r.rows[0].p).toBeNull()
  })
  it('un profesor no puede regenerar links de alumnos ajenos ni leerlos', async () => {
    await expect(as(COACH_A, 'select academia.regenerate_portal_link($1)', [STU_2])).rejects.toThrow(/permiso/)
    expect(await count(COACH_A, 'academia.portal_links')).toBe(1)
  })
})

describe('modo abierto', () => {
  async function anon(sql: string, params: unknown[] = []) {
    await db.exec(`reset role; set request.jwt.claim.sub = ''; set role anon;`)
    try { return await db.query<any>(sql, params) } finally { await db.exec('reset role;') }
  }
  it('cerrado: un visitante no ve nada', async () => {
    expect((await anon('select * from academia.students')).rows.length).toBe(0)
  })
  it('abierto: un visitante puede consultar y registrar', async () => {
    await db.exec('update academia.settings set open_mode = true')
    expect((await anon('select * from academia.students')).rows.length).toBe(2)
    expect((await anon('select * from academia.fee_balances')).rows.length).toBe(2)
    await anon(`insert into academia.students (full_name) values ('Nuevo desde el sitio')`)
    expect((await anon('select * from academia.students')).rows.length).toBe(3)
  })
  it('el visitante no puede apagar ni encender el modo abierto', async () => {
    await expect(anon('update academia.settings set open_mode = false')).rejects.toThrow(/panel de Supabase/)
  })
  it('al cerrarlo se pierde el acceso inmediatamente', async () => {
    await db.exec('update academia.settings set open_mode = false')
    expect((await anon('select * from academia.students')).rows.length).toBe(0)
    await expect(anon(`insert into academia.students (full_name) values ('X')`)).rejects.toThrow(/row-level security/)
  })
})

describe('recargo por mes de atraso ($550 del 1 al 5, $50 por mes)', () => {
  const bal = async (id: string) =>
    (await as<any>(ADMIN, 'select late_months, late_fee::float, total_due::float, balance::float, status from academia.fee_balances where id = $1', [id])).rows[0]
  const lm = async (due: string, settled: string) => (await db.query<{ n: number }>('select academia.late_months($1::date, $2::date) n', [due, settled])).rows[0].n
  let late: string, onTime: string, old: string

  beforeAll(async () => {
    old = (await db.query<{ id: string }>(`insert into academia.fees (student_id, concept, period, amount, due_date)
      values ($1, 'Anterior', '2026-01-01', 550, current_date - 3) returning id`, [STU_2])).rows[0].id // creado con tarifa 0
    await db.exec('update academia.settings set late_fee_amount = 50')
    late = (await db.query<{ id: string }>(`insert into academia.fees (student_id, concept, period, amount, due_date)
      values ($1, 'Mensualidad', '2026-08-01', 550, current_date - 3) returning id`, [STU_2])).rows[0].id
    onTime = (await db.query<{ id: string }>(`insert into academia.fees (student_id, concept, period, amount, due_date)
      values ($1, 'Mensualidad', '2026-10-01', 550, current_date + 2) returning id`, [STU_2])).rows[0].id
  })

  it('cuenta meses de atraso: 1 al pasar el día 5, 2 al pasar el siguiente 5', async () => {
    expect(await lm('2026-09-05', '2026-09-05')).toBe(0)
    expect(await lm('2026-09-05', '2026-09-06')).toBe(1)
    expect(await lm('2026-09-05', '2026-10-05')).toBe(1)
    expect(await lm('2026-09-05', '2026-10-06')).toBe(2)
    expect(await lm('2026-09-05', '2026-12-10')).toBe(4)
  })
  it('unos días tarde suma un solo recargo de $50', async () => {
    expect(await bal(late)).toMatchObject({ late_months: 1, late_fee: 50, total_due: 600, balance: 600, status: 'vencido' })
  })
  it('dentro del plazo no hay recargo', async () => {
    expect(await bal(onTime)).toMatchObject({ late_months: 0, late_fee: 0, balance: 550, status: 'pendiente' })
  })
  it('un cargo conserva la tarifa con la que se creó', async () => {
    expect(await bal(old)).toMatchObject({ late_fee: 0, balance: 550 })
  })
  it('no se puede pagar más del saldo con recargo', async () => {
    await expect(as(ADMIN, `insert into academia.payments (fee_id, student_id, amount) values ($1, $2, 601)`, [late, STU_2])).rejects.toThrow(/excede/)
  })
  it('al cubrir la mensualidad el recargo queda pendiente', async () => {
    await as(ADMIN, `insert into academia.payments (fee_id, student_id, amount) values ($1, $2, 550)`, [late, STU_2])
    expect(await bal(late)).toMatchObject({ late_fee: 50, balance: 50, status: 'vencido' })
  })
  it('perdonar el recargo deja el cargo pagado', async () => {
    await as(ADMIN, `update academia.fees set late_fee_waived = 50 where id = $1`, [late])
    expect(await bal(late)).toMatchObject({ late_fee: 0, balance: 0, status: 'pagado' })
  })
  it('el portal de papás muestra el recargo', async () => {
    const tok = (await db.query<{ token: string }>('select token from academia.portal_links where student_id = $1', [STU_2])).rows[0].token
    const p = (await db.query<any>('select academia.get_portal($1) as p', [tok])).rows[0].p
    const f = p.fees.find((x: any) => x.id === old)
    expect(f).toMatchObject({ late_fee: 0, total_due: 550 })
    expect(p.academy.late_fee_amount).toBe(50)
  })
})

describe('becas y montos por confirmar', () => {
  const bal = async (id: string) =>
    (await as<any>(ADMIN, 'select discount::float, late_fee::float, total_due::float, balance::float, status from academia.fee_balances where id = $1', [id])).rows[0]
  let fee: string
  beforeAll(async () => {
    fee = (await db.query<{ id: string }>(`insert into academia.fees (student_id, concept, period, amount, due_date, review, late_fee_amount)
      values ($1, 'Mensualidad', '2026-07-01', 550, current_date - 10, 'confirmar_beca', 50) returning id`, [STU_2])).rows[0].id
    await db.query(`insert into academia.payments (fee_id, student_id, amount, paid_at) values ($1, $2, 300, current_date - 12)`, [fee, STU_2])
  })
  it('por confirmar: no corre recargo ni se marca vencido', async () => {
    expect(await bal(fee)).toMatchObject({ late_fee: 0, balance: 250, status: 'por_confirmar' })
  })
  it('confirmar beca: el descuento cubre la diferencia y queda pagado', async () => {
    await as(ADMIN, `update academia.fees set discount = 250, discount_reason = 'Beca', review = null where id = $1`, [fee])
    expect(await bal(fee)).toMatchObject({ discount: 250, total_due: 300, balance: 0, status: 'pagado' })
    const acc = (await as<any>(ADMIN, 'select scholarships::float from academia.student_accounts where student_id = $1', [STU_2])).rows[0]
    expect(acc.scholarships).toBe(250)
  })
  it('el descuento no puede ser mayor al precio', async () => {
    await expect(as(ADMIN, `update academia.fees set discount = 600 where id = $1`, [fee])).rejects.toThrow()
  })
})

describe('sueldos de profesores', () => {
  beforeAll(async () => {
    await db.query(`insert into academia.coach_pay (coach_id, amount, frequency) values ($1, 750, 'semanal')`, [COACH_A])
  })
  it('sólo administración ve los sueldos', async () => {
    expect(await count(ADMIN, 'academia.coach_pay')).toBe(1)
    expect(await count(COACH_A, 'academia.coach_pay')).toBe(0)
    expect(await count(PARENT_1, 'academia.coach_pay')).toBe(0)
  })
  it('un profesor no puede cambiarse el sueldo', async () => {
    const r = await as(COACH_A, `update academia.coach_pay set amount = 9999 where coach_id = $1`, [COACH_A])
    expect(r.affectedRows).toBe(0)
  })
  it('frecuencia inválida se rechaza', async () => {
    await expect(as(ADMIN, `update academia.coach_pay set frequency = 'diario' where coach_id = $1`, [COACH_A])).rejects.toThrow()
  })
})

describe('gastos generales', () => {
  it('sólo administración ve y edita los gastos', async () => {
    await db.query(`insert into academia.expenses (name, amount, frequency) values ('Renta', 5000, 'mensual')`)
    expect(await count(ADMIN, 'academia.expenses')).toBe(1)
    expect(await count(COACH_A, 'academia.expenses')).toBe(0)
    const r = await as(COACH_A, `update academia.expenses set amount = 1`)
    expect(r.affectedRows).toBe(0)
  })
})

describe('promoción de hermanos', () => {
  it('sólo administración crea grupos; el papá ve el grupo de su hijo', async () => {
    const g = (await db.query<{ id: string }>(`insert into academia.sibling_groups (name) values ('Familia Uno') returning id`)).rows[0].id
    await db.query(`update academia.students set sibling_group_id = $1, sibling_order = 1 where id = $2`, [g, STU_1])
    expect(await count(ADMIN, 'academia.sibling_groups')).toBe(1)
    expect(await count(PARENT_1, 'academia.sibling_groups')).toBe(1)
    expect(await count(PARENT_2, 'academia.sibling_groups')).toBe(0)
    await expect(as(COACH_A, `insert into academia.sibling_groups (name) values ('X')`)).rejects.toThrow(/row-level security/)
  })
  it('precios por defecto 500 / 450 / 400', async () => {
    const r = await db.query<{ p: string[] }>('select sibling_prices::text[] p from academia.settings')
    expect(r.rows[0].p.map(Number)).toEqual([500, 450, 400])
  })
})

describe('clases extra (porteros)', () => {
  let porteros: string, trP: string
  beforeAll(async () => {
    porteros = (await db.query<{ id: string }>(`insert into academia.categories (name, is_extra) values ('Porteros', true) returning id`)).rows[0].id
    await db.query(`insert into academia.coach_categories values ($1, $2)`, [COACH_B, porteros])
    trP = (await db.query<{ id: string }>(`insert into academia.trainings (category_id, date) values ($1, current_date) returning id`, [porteros])).rows[0].id
    await db.query(`insert into academia.student_extra_classes (student_id, category_id) values ($1, $2)`, [STU_1, porteros])
  })
  it('el alumno sigue en su categoría y además en la clase extra', async () => {
    const r = await db.query<{ category_id: string }>('select category_id from academia.students where id = $1', [STU_1])
    expect(r.rows[0].category_id).toBe(CAT_A)
  })
  it('se puede pasar lista en la clase extra a sus inscritos, y a nadie más', async () => {
    await as(COACH_B, `insert into academia.attendance (training_id, student_id, status) values ($1, $2, 'presente')`, [trP, STU_1])
    await expect(as(ADMIN, `insert into academia.attendance (training_id, student_id, status) values ($1, $2, 'presente')`, [trP, STU_2])).rejects.toThrow(/no pertenece/)
  })
  it('el profe de la clase extra ve a sus porteros', async () => {
    const ids = (await as<{ id: string }>(COACH_B, 'select id from academia.students')).rows.map((x) => x.id)
    expect(ids).toContain(STU_1)
  })
})

describe('registro de datos por los papás (link público)', () => {
  async function anon(sql: string, params: unknown[] = []) {
    await db.exec(`reset role; set request.jwt.claim.sub = ''; set role anon;`)
    try { return await db.query<any>(sql, params) } finally { await db.exec('reset role;') }
  }
  beforeAll(async () => { await db.exec('update academia.settings set open_mode = false') })
  it('un visitante ve sólo nombres y categorías', async () => {
    const r = await anon('select * from academia.registro_lista()')
    expect(r.rows.length).toBeGreaterThan(0)
    expect(Object.keys(r.rows[0]).sort()).toEqual(['category', 'category_order', 'completed', 'full_name', 'id'])
  })
  it('guarda los datos una sola vez', async () => {
    const payload = JSON.stringify({ tutor_name: 'Mamá Dos', tutor_phone: '81 1234 5678', tutor_relationship: 'Mamá', allergies: 'Polen', birth_date: '2015-03-02' })
    await anon('select academia.registro_guardar($1, $2::jsonb)', [STU_2, payload])
    const s = (await db.query<any>('select profile_completed_by, birth_date::text from academia.students where id = $1', [STU_2])).rows[0]
    expect(s.profile_completed_by).toBe('Mamá Dos')
    expect(s.birth_date).toBe('2015-03-02')
    const m = (await db.query<any>('select allergies from academia.student_medical where student_id = $1', [STU_2])).rows[0]
    expect(m.allergies).toBe('Polen')
    const g = (await db.query<any>(`select g.phone from academia.guardians g join academia.student_guardians sg on sg.guardian_id = g.id where sg.student_id = $1 and sg.is_primary`, [STU_2])).rows[0]
    expect(g.phone).toBe('528112345678')
    const l = (await anon('select completed from academia.registro_lista() where id = $1', [STU_2])).rows[0]
    expect(l.completed).toBe(true)
    await expect(anon('select academia.registro_guardar($1, $2::jsonb)', [STU_2, payload])).rejects.toThrow(/ya fueron registrados/)
  })
  it('valida el WhatsApp', async () => {
    await expect(anon('select academia.registro_guardar($1, $2::jsonb)', [STU_1, JSON.stringify({ tutor_name: 'X', tutor_phone: '123' })])).rejects.toThrow(/10 dígitos/)
  })
  it('sin modo abierto, el visitante sigue sin poder leer tablas', async () => {
    expect((await anon('select * from academia.students')).rows.length).toBe(0)
  })
})
