"""Convierte el Excel de listas mensuales (una hoja por categoría) en SQL de carga inicial.
Uso: python scripts/excel_to_seed.py <archivo.xlsx> > supabase/seed/seed_alumnos.sql
"""
import re, sys, datetime, openpyxl

SHEETS = [  # (hoja, nombre de categoría, descripción)
    ('CATE PREESCOLAR', 'Preescolar', 'Nacidos 2021-2023'),
    ('2020-2019', '2020-2019', 'Nacidos 2019-2020'),
    ('2018', '2018', 'Nacidos 2018'),
    ('2017-2016', '2017-2016', 'Nacidos 2016-2017'),
    ('2015 BLANCa', '2015 Blanca', 'Nacidos 2015 — equipo blanco'),
    ('2015 roja', '2015 Roja', 'Nacidos 2015 — equipo rojo'),
    ('2014', '2014', 'Nacidos 2014'),
    ('2012', '2012', 'Nacidos 2012'),
]
LOWER = {'de', 'del', 'la', 'las', 'los', 'y'}

def title(name):
    words = re.sub(r'\s+', ' ', name.strip()).split(' ')
    return ' '.join(w.lower() if (i and w.lower() in LOWER) else w[:1].upper() + w[1:].lower()
                    for i, w in enumerate(words))

def parse_date(v):
    if isinstance(v, datetime.datetime):
        return v.date(), None
    if isinstance(v, str) and v.strip():
        m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', v.strip())
        if m:
            a, b, y = map(int, m.groups())
            for mo, d in ((a, b), (b, a)):  # el Excel mezcla M/D y D/M
                try:
                    dt = datetime.date(y, mo, d)
                    if 2005 <= y <= datetime.date.today().year:
                        return dt, None
                except ValueError:
                    pass
        return None, f'Fecha de nacimiento por confirmar (Excel: {v.strip()})'
    return None, None

def q(v):
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = ['-- Carga inicial generada desde el Excel de listas (septiembre 2026).',
       '-- Toda esta información es editable desde la plataforma.', 'begin;']
for order, (sheet, cat, desc) in enumerate(SHEETS):
    out.append(f"insert into academia.categories (name, description, sort_order) values ({q(cat)}, {q(desc)}, {order}) on conflict (name) do nothing;")
seen = set()
for sheet, cat, _ in SHEETS:
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        continue
    header = [str(c or '').upper() for c in rows[0]]
    has_header = any('NOMBRE' in h for h in header)
    if has_header:
        name_col = next(i for i, h in enumerate(header) if 'NOMBRE' in h)
        date_col = next((i for i, h in enumerate(header) if 'NA' in h and 'NOMBRE' not in h), None)
    else:  # hoja sin encabezado: nombre en A, fecha en B
        name_col, date_col = 0, 1
    for r in (rows[1:] if has_header else rows):
        raw = r[name_col] if name_col < len(r) else None
        if not raw or not str(raw).strip():
            continue
        raw = str(raw)
        notes = []
        m = re.search(r'\(([^)]*)\)', raw)
        if m:
            notes.append(f'Anotación del Excel: ({m.group(1)})')
            raw = raw.replace(m.group(0), '')
        name = title(raw)
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        bd, note = parse_date(r[date_col]) if date_col is not None and date_col < len(r) else (None, None)
        if note:
            notes.append(note)
        out.append(
            'insert into academia.students (full_name, birth_date, category_id, enrolled_at, notes) '
            f"select {q(name)}, {q(bd.isoformat() if bd else None)}, id, '2026-09-01', {q(' · '.join(notes) or None)} "
            f'from academia.categories where name = {q(cat)};')
out.append('commit;')
print('\n'.join(out))
