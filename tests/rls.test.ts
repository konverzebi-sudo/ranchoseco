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
    await as(COACH_A, `insert into academia.evaluations (student_id, ${cols}) values ($1, ${vals})`, [STU_1])
    await expect(
      as(COACH_A, `insert into academia.evaluations (student_id, ${cols}) values ($1, ${vals})`, [STU_2]),
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
    await expect(anon('select * from academia.portal_links')).rejects.toThrow(/permission denied/)
    await expect(anon('select * from academia.students')).rejects.toThrow(/permission denied/)
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
