-- =====================================================================
-- PREGUNTAS PENDIENTES PARA ADMINISTRACIÓN
-- Dudas que sistemas le deja a una persona (p. ej. Aby). Ella las contesta
-- desde su Dashboard y las respuestas se guardan para tomar acción después.
-- =====================================================================
create table if not exists academia.questions (
  id           uuid primary key default gen_random_uuid(),
  number       int not null,
  assigned_to  text not null,
  topic        text,
  question     text not null,
  answer       text,
  answered_by  text,
  answered_at  timestamptz,
  done         boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (assigned_to, number)
);
alter table academia.questions enable row level security;
drop policy if exists questions_admin on academia.questions;
create policy questions_admin on academia.questions for all to authenticated
  using (academia.is_admin()) with check (academia.is_admin());
drop policy if exists questions_open_mode on academia.questions;
create policy questions_open_mode on academia.questions for all to anon
  using (academia.open_mode()) with check (academia.open_mode());
grant select, insert, update, delete on academia.questions to authenticated, anon;

insert into academia.questions (number, assigned_to, topic, question) values
(1, 'Aby', 'Corte de caja', 'Corte del 7 de octubre: faltan $7,200 (debería haber $27,600 y se contaron $20,400). ¿Sabes qué pasó con ese dinero o a dónde se fue?'),
(2, 'Aby', 'Corte de caja', 'Corte del 30 de septiembre: salió más dinero del que había y se anotó que $8,850 "vinieron de CAJA". ¿De qué caja salió ese dinero exactamente?'),
(5, 'Aby', 'Pagos', 'Sebastián Abdiel García Esquivel: en septiembre pagó $500 y con la promoción de hermanos le tocaba $450. ¿Los $50 de más se quedan como adelanto de otro mes, se le regresan, o su mensualidad era de $500?'),
(6, 'Aby', 'Uniformes', '¿Cuál es el precio del uniforme completo?'),
(7, 'Aby', 'Pagos', 'Fredy Jharet Álvarez Ramos: en el Excel aparece un pago de septiembre de $450 que no está en la plataforma. ¿Sí lo pagó? ¿Lo registramos? (¿qué día y en efectivo o transferencia?)'),
(8, 'Aby', 'Pagos', 'Iker Ulises Padilla Saucedo: en el Excel aparece un pago de septiembre de $100 que no está en la plataforma. ¿Sí lo pagó? ¿De qué fue ese pago?'),
(9, 'Aby', 'Pagos', '2015 Blanca: en el Excel hay 6 pagos de $300 (Rodrigo Benjamín González, Eduardo Emanuel Oviedo, Víctor Mateo Alonso, Job Uriel Martínez, Ian Alejandro Sena y Amauryk Vázquez = $1,800) que no están registrados. ¿Sí los pagaron? ¿Eran reinscripción o uniforme?'),
(10, 'Aby', 'Pagos', 'Axel Kilian González, Jhonatan Erazo y Damián Lumbreras: en septiembre el Excel dice $550 y la plataforma $600 (mensualidad + $50 de recargo). ¿Cuánto pagaron de verdad?'),
(11, 'Aby', 'Pagos', 'Hiram Estrada (octubre $400), Axel y José Eduardo: en el Excel aparecen pagos de octubre hechos por adelantado. ¿Son reales? ¿Cuándo los pagaron?'),
(12, 'Aby', 'Sueldos', 'Cortes del 16 y del 23 de septiembre: los sueldos de Juan de Dios y Tonny no coinciden con el Excel. ¿Cuánto se le pagó a cada uno esas dos semanas?'),
(13, 'Aby', 'Gastos', 'Viaje a Guadalajara ($11,000): ¿cómo se va a pagar? ¿En partes, de una sola vez, de qué caja? (el 14 de octubre ya se apartaron $5,000)'),
(14, 'Aby', 'Gastos', 'El Ingeniero: aparecen $1,450 de regalías pendientes y $5,000 de renta. ¿Qué son esos pagos y cómo se deben registrar?'),
(15, 'Aby', 'PDF del corte', 'En el PDF del corte, ¿cambiamos el texto "Se contó" por "Efectivo contado en caja"? (sí / no)'),
(16, 'Aby', 'PDF del corte', 'En el PDF del corte, cuando no se sabe si pagaron en efectivo o transferencia sale un cuadrito "Otro". ¿Lo quitamos? (sí / no)'),
(19, 'Aby', 'Corte de caja', 'Corte del 9 de septiembre: la diferencia de $8,500 viene de pagos pasados del control anterior sin fecha real. ¿Le ponemos una nota de que no es dinero faltante? (sí / no)'),
(20, 'Aby', 'Ganancia por categoría', 'En "Ganancia real por categoría", ¿el sueldo del profe se cuenta con lo que de verdad se pagó en el mes (contando los miércoles) o con el promedio (4.33 semanas)?'),
(21, 'Aby', 'Caja Chivas', 'Las reinscripciones ($300): ¿también van a la Caja Chivas? ¿Se reparten igual que la inscripción (playera, credencial, seguro) o completas a lo libre?'),
(22, 'Aby', 'Caja Chivas', 'El dinero de inscripciones que ya estaba guardado en la Caja de ahorro, ¿se pasa a la Caja Chivas? (sí / no)'),
(23, 'Aby', 'Caja Chivas', 'El seguro ($11,000) se junta con $73.33 de cada inscripción. Si en el año hay menos de 150 inscripciones no se completa. ¿Lo que falte se aparta cada semana?'),
(24, 'Aby', 'Caja Chivas', 'Las mini cajas de Playeras y Credenciales de la Caja Chivas, ¿sustituyen al Fondo de uniformes, o el fondo se queda para lo que se cobra aparte (reposición de playera $250, uniformes)?'),
(26, 'Aby', 'Gastos', 'La sección de Gastos donde están Regalías, Renta, Seguro y los sueldos de Junior, Mili y Samuel, ¿se llama "Gastos administrativos" o "Sueldos administrativos"?'),
(27, 'Aby', 'Gastos', 'En la página de Gastos se escoge un mes completo para analizar. ¿Así sirve, o se necesita escoger un rango de días (por ejemplo del 3 al 17)?')
on conflict (assigned_to, number) do nothing;
