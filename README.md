# RANCHO SECO | CONTROL DE ACADEMIA

Plataforma para administrar la academia de Deportivo Rancho Seco: alumnos, asistencias,
mensualidades y cobranza por WhatsApp, seguimiento deportivo, entrenamientos, partidos,
reportes PDF y un link privado para papás.

- **Sitio:** https://jefeshub.com/ranchoseco/
- **Link de papás:** `https://jefeshub.com/ranchoseco/#/p/<token>` (uno por alumno, se copia desde su expediente)

## Arquitectura

| Capa | Tecnología |
|---|---|
| Interfaz | React 18 + TypeScript + Vite + Tailwind CSS (sitio estático, mobile-first) |
| Datos, archivos | Supabase (Postgres + Storage), esquema propio `academia` |
| Seguridad | Row Level Security en la base de datos (no sólo en la interfaz) |
| PDF | `@react-pdf/renderer`, generado en el navegador |
| Gráficas | Recharts (pantalla) y SVG nativo (PDF) |
| Hospedaje | GitHub Pages (repo `ranchoseco` → `jefeshub.com/ranchoseco`) |

jefeshub.com es GitHub Pages (sólo archivos estáticos), por eso no hay servidor propio:
toda la lógica sensible vive en Postgres (políticas RLS, triggers y funciones).

```
src/
  pages/         Pantallas (Dashboard, Alumnos, Asistencias, Cobranza, Portal de papás…)
  components/    UI reutilizable, formularios, WhatsApp, reportes
  lib/           Supabase, consultas, formato, WhatsApp, estadísticas
  pdf/           Documento PDF y armado de datos del reporte
supabase/
  migrations/    Esquema, RLS, almacenamiento, portal y modo abierto
  seed/          Alumnos cargados del Excel de septiembre
  INSTALAR_EN_SUPABASE.sql   Todo lo anterior en un solo archivo
tests/           Pruebas de permisos contra Postgres real (PGlite)
scripts/         Conversión del Excel mensual a SQL
```

## Acceso

**Modo abierto (actual, temporal):** el sitio funciona sin usuario ni contraseña; quien tenga
la dirección puede consultar y modificar. Tiene `noindex` para no aparecer en buscadores.

**Papás:** cada alumno tiene un link con un token aleatorio de 256 bits. Sólo muestra la
información de ese alumno (nunca datos médicos, teléfonos ni otros alumnos) a través de la
función `academia.get_portal`. Se puede cambiar desde el expediente ("Cambiar link") y el
anterior deja de funcionar al instante.

### Cerrar el modo abierto (cuando se requiera)

El esquema ya incluye roles y políticas probadas (`admin`, `profesor`, `padre`):
el profesor sólo ve sus categorías y no ve pagos; sólo admin modifica cobranza.
Para activarlo falta la pantalla de inicio de sesión (no se construyó porque se pidió
acceso sin contraseña por ahora). Pasos:

1. Agregar la pantalla de login (Supabase Auth, correo y contraseña).
2. Crear las cuentas en Supabase > Authentication y darles perfil:
   ```sql
   insert into academia.profiles (id, email, full_name, role)
   select id, email, 'Nombre', 'admin' from auth.users where email = 'admin@correo.com';
   -- Profesor: además ligarlo a su ficha
   update academia.coaches set user_id = '<id del usuario>' where full_name = 'Nombre del profe';
   ```
3. Apagar el modo abierto (sólo se puede desde el SQL Editor):
   ```sql
   update academia.settings set open_mode = false;
   ```

## WhatsApp

- **Cobranza y avisos:** enlaces `wa.me/<número internacional>?text=<mensaje codificado>`.
  WhatsApp se abre con el mensaje listo; la persona revisa y presiona Enviar. Nada se envía
  automáticamente.
- **Reporte PDF:** `wa.me` no puede adjuntar archivos. En celular se usa la hoja nativa de
  compartir (Web Share API) con el PDF y el mensaje; en computadora se descarga el PDF y se
  abre el chat del tutor con el mensaje para arrastrar el archivo.
- **Envío automático (futuro):** requiere WhatsApp Business Cloud API con token privado en
  un servidor (p. ej. Supabase Edge Function). Ver la interfaz `WhatsAppBusinessProvider`
  en `src/lib/whatsapp.ts`.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # URL y anon key de Supabase
npm run dev                  # http://localhost:5173/ranchoseco/
npm test                     # 30 pruebas de permisos (RLS) contra Postgres
npm run build
```

## Instalar la base de datos en otro proyecto de Supabase

1. SQL Editor → pegar `supabase/INSTALAR_EN_SUPABASE.sql` → Run (una sola vez).
2. Project Settings → Data API → Exposed schemas → agregar `academia` → Save.

Para regenerar la carga desde un Excel mensual:
`python scripts/excel_to_seed.py SEPTIEMBRE.xlsx > supabase/seed/seed_alumnos.sql`

## Publicación

`jefeshub.com` está conectado a GitHub Pages del repo **hub-jany**, así que el sitio compilado
vive en la carpeta `ranchoseco/` de ese repo. Para publicar cambios:

```bash
bash scripts/publicar-en-jefeshub.sh
```

Corre las pruebas, compila y sube sólo la carpeta `ranchoseco/` al hub (no toca el resto).

Además, cada `push` a `main` de este repo publica una copia en
https://konverzebi-sudo.github.io/ranchoseco/ (`.github/workflows/deploy.yml`), útil como
respaldo. Variables del repositorio: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
(públicas por diseño; nunca la `service_role`).

Los datos personales de alumnos (`supabase/seed/seed_alumnos.sql`,
`supabase/INSTALAR_EN_SUPABASE.sql`, archivos `.xlsx`) están en `.gitignore`: este repositorio
es público y nunca deben subirse.
