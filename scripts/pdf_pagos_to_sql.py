"""
Convierte el control de pagos de la temporada (PDF exportado del Excel, una
página por categoría) en SQL para cargar a la plataforma.

Uso:
  python scripts/pdf_pagos_to_sql.py <pagos.pdf> <students.json> <categories.json> <salida.sql> <reporte.md>

students.json / categories.json: exportados de la API (id, full_name, category_id…).

Reglas acordadas con la academia (sept. 2026):
- Cuota normal: agosto $500, septiembre en adelante $550.
- Monto menor a la cuota normal  -> cargo "por confirmar" (¿beca?) sin recargo.
- "PTE"                           -> cargo pendiente.
- "400 PTS 150"                   -> pagó 400, debe 150.
- Pagó agosto y septiembre vacío  -> debe septiembre (con recargo $50/día desde el día 6).
- "BECADO"                        -> beca completa.
- Fila amarilla                   -> baja.
- REINS / REINSC 300              -> reinscripción pagada.
"""
import difflib
import json
import re
import sys
import unicodedata
import uuid
from datetime import date

import pdfplumber

PAGES = {  # página (1-based) -> categoría
    1: 'Preescolar', 9: '2020-2019', 10: '2018', 11: '2017-2016',
    13: '2015 Blanca', 14: '2015 Roja', 15: '2014', 16: '2012',
}
REGULAR = {'AGO': 500, 'SEP': 550, 'OCT': 550}
PERIOD = {'AGO': '2026-08-01', 'SEP': '2026-09-01', 'OCT': '2026-10-01'}
DUE = {'AGO': '2026-08-05', 'SEP': '2026-09-05', 'OCT': '2026-10-05'}
MONTH_LABEL = {'AGO': 'agosto', 'SEP': 'septiembre', 'OCT': 'octubre'}
LATE_FEE = {'AGO': 0, 'SEP': 50, 'OCT': 50}
YELLOW = (1.0, 1.0, 0.0)
LOWER = {'de', 'del', 'la', 'las', 'los', 'y'}


def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'\([^)]*\)', '', s)
    return re.sub(r'\s+', ' ', re.sub(r'[^a-zA-Z ]', ' ', s)).strip().lower()


def title(name):
    words = re.sub(r'\s+', ' ', re.sub(r'\([^)]*\)', '', name)).strip().split(' ')
    return ' '.join(w.lower() if (i and w.lower() in LOWER) else w[:1].upper() + w[1:].lower() for i, w in enumerate(words))


def parse_date(v):
    v = re.sub(r'[^0-9/]', '', v or '')
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})', v)
    if not m:
        return None
    a, b, y = int(m[1]), int(m[2]), int(m[3])
    if y < 100:
        y += 2000
    if not 2005 <= y <= 2026:
        return None
    d, mo = (b, a) if b > 12 else (a, b)  # D/M salvo que el segundo número sea > 12
    try:
        return date(y, mo, d)
    except ValueError:
        return None
    return None


def money(v):
    v = (v or '').replace('$', '').replace(',', '').strip()
    return float(v) if re.fullmatch(r'\d+(\.\d+)?', v) else None


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def col_index(header):
    idx = {}
    for i, h in enumerate(header):
        h = norm(h).upper()
        if h.startswith('NOMBRE'):
            idx['NAME'] = i
        elif h in ('FECHA NA', 'FEC NAC', 'FN', 'FECHA NACIMIENTO'):
            idx['BIRTH'] = i
        elif h == 'INSC':
            idx['INSC'] = i
        elif h.startswith('AGO') and 'AGO' not in idx:
            idx['AGO'] = i
        elif h.startswith('SEP'):
            idx['SEP'] = i
        elif h == 'OCT':
            idx['OCT'] = i
        elif h.startswith('REIN'):
            idx['REINS'] = i
        elif h.startswith('UNI'):
            idx['UNI'] = i
        elif h.startswith('TOR'):
            idx.setdefault('TOR', i)
    return idx


def row_colors(page, cell, fills):
    x0, top, _, bottom = cell
    out = set()
    for r in fills:
        if r['x0'] <= x0 + 2 and r['x1'] >= x0 + 5 and r['top'] <= top + 1 and r['bottom'] >= bottom - 1:
            c = r['non_stroking_color']
            out.add(tuple(round(v, 2) for v in c) if isinstance(c, (list, tuple)) else c)
    return out


def main(pdf_path, students_path, cats_path, out_sql, out_md):
    students = json.load(open(students_path, encoding='utf8'))
    cats = {c['name']: c['id'] for c in json.load(open(cats_path, encoding='utf8'))}
    by_norm = {}
    for s in students:
        by_norm.setdefault(norm(s['full_name']), []).append(s)

    pdf = pdfplumber.open(pdf_path)
    sql = ['-- Carga del control de pagos agosto-septiembre 2026 (generado automáticamente).', 'begin;']
    rep = {'nuevos': [], 'bajas': [], 'confirmar': [], 'deben_sep': [], 'sin_pagos': [], 'colores': [],
           'omitidos': [], 'duplicados': [], 'notas': []}
    totals = {'pagos': 0, 'monto': 0.0, 'cargos': 0}
    matched_ids = set()

    for pno, cat in PAGES.items():
        page = pdf.pages[pno - 1]
        table = page.find_tables()[0]
        rows = table.extract()
        fills = [r for r in page.rects if r.get('fill') and r.get('non_stroking_color') not in (None, (1,), (1, 1, 1), [1], [1, 1, 1], (0,), [0])]
        hdr_i = next(i for i, r in enumerate(rows) if r and any('NOMBRE' in (c or '').upper() for c in r))
        idx = col_index(rows[hdr_i])
        seen = {}
        entries = []
        for ri in range(hdr_i + 1, len(rows)):
            r = [(c or '').replace('\n', ' ').strip() for c in rows[ri]]
            name = r[idx['NAME']]
            cell = table.rows[ri].cells[0]
            colors = row_colors(page, cell, fills) if cell else set()
            if name.upper() == 'PTE PLAYERA':
                if entries:
                    entries[-1]['extra_notes'].append('Pendiente: playera')
                continue
            if not name:
                if any(r[1:]):
                    rep['omitidos'].append(f'{cat}: fila sin nombre ({", ".join(c for c in r if c)})')
                continue
            e = {'name': name, 'row': r, 'colors': colors, 'extra_notes': []}
            key = norm(name)
            filled = sum(1 for c in r if c)
            if key in seen:
                rep['duplicados'].append(f'{cat}: {title(name)} aparece dos veces; se usó la fila con más datos')
                if filled > sum(1 for c in seen[key]['row'] if c):
                    entries[entries.index(seen[key])] = e
                    seen[key] = e
                continue
            seen[key] = e
            entries.append(e)

        for e in entries:
            r, name = e['row'], e['name']
            get = lambda k: r[idx[k]] if k in idx and idx[k] < len(r) else ''
            ago, sep, octv = get('AGO'), get('SEP'), get('OCT')
            # Celdas corridas: "INCAPAC" | "IDAD500"
            if ago.upper().startswith('INCAPAC'):
                e['extra_notes'].append('Agosto: incapacidad')
                ago, sep = '', re.sub(r'^[A-Z]+', '', sep.upper())
            birth_raw = get('BIRTH')
            spill = re.match(r'^([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s+(\d.*)$', birth_raw)
            if spill:  # nombre cortado que se pasó a la columna de fecha: "PERA" | "LES 18/09/2018"
                name, birth_raw = name + spill[1], spill[2]
            birth = parse_date(birth_raw)
            insc = parse_date(get('INSC'))
            yellow = YELLOW in e['colors']
            other = [c for c in e['colors'] if c not in (YELLOW, (0.97, 0.98, 0.98))]
            label = title(name)

            # Empate con alumnos existentes (misma categoría primero)
            key = norm(name)
            cand = [s for s in by_norm.get(key, []) if s['id'] not in matched_ids]
            if not cand:
                pool = [s for s in students if s['id'] not in matched_ids]
                close = difflib.get_close_matches(key, [norm(s['full_name']) for s in pool], n=1, cutoff=0.88)
                cand = [s for s in pool if close and norm(s['full_name']) == close[0]]
            same_cat = [s for s in cand if s['category_id'] == cats[cat]]
            s = (same_cat or cand or [None])[0]
            notes = list(e['extra_notes'])
            if other:
                notes.append('Resaltado en color en el control de pagos (significado por confirmar)')
                rep['colores'].append(f'{cat}: {label}')
            comment = next((c for c in r[idx.get('REINS', 99) + 1 if 'REINS' in idx else len(r):] if c and not money(c)), None) \
                or next((c for c in r if 'BAJA' in c.upper()), None)
            if comment and 'BAJA' in comment.upper():
                notes.append('Comentario: ' + comment.capitalize())

            if s:
                sid = s['id']
                matched_ids.add(sid)
                sets = []
                if birth and not s['birth_date']:
                    sets.append(f'birth_date = {q(birth.isoformat())}')
                if insc:
                    sets.append(f'enrolled_at = {q(insc.isoformat())}')
                if s['category_id'] != cats[cat]:
                    sets.append(f'category_id = {q(cats[cat])}')
            else:
                sid = str(uuid.uuid4())
                rep['nuevos'].append(f'{cat}: {label}')
                sql.append(
                    'insert into academia.students (id, full_name, birth_date, category_id, enrolled_at, notes) values '
                    f"({q(sid)}, {q(label)}, {q(birth.isoformat() if birth else None)}, {q(cats[cat])}, "
                    f"{q((insc or date(2026, 9, 1)).isoformat())}, {q('Alta desde el control de pagos 2026-2027')});")
                sets = []
                if birth_raw and not birth:
                    notes.append(f'Fecha de nacimiento por confirmar (control: {birth_raw})')
            if yellow:
                sets.append("status = 'baja'")
                rep['bajas'].append(f'{cat}: {label}')
            if 'BECADO' in (ago + sep).upper():
                sets.append('monthly_fee = 0')
                notes.append('Becado (beca completa)')
            if notes:
                note_txt = ' · '.join(notes)
                sets.append(f"notes = trim(both ' ·' from coalesce(notes, '') || ' · ' || {q(note_txt)})")
            if sets:
                sql.append(f'update academia.students set {", ".join(sets)} where id = {q(sid)};')

            # Cargos y pagos
            def fee(month, concept, amount, paid=None, review=False, discount=0, reason=None, late=0, note=None):
                fid = str(uuid.uuid4())
                totals['cargos'] += 1
                sql.append(
                    'insert into academia.fees (id, student_id, concept, period, amount, due_date, discount, discount_reason, review, late_fee_per_day, notes) values '
                    f"({q(fid)}, {q(sid)}, {q(concept)}, {q(PERIOD[month])}, {amount}, {q(DUE[month])}, {discount}, {q(reason)}, "
                    f"{q('confirmar_beca' if review else None)}, {late}, {q(note)}) on conflict (student_id, concept, period) do nothing;")
                if paid:
                    totals['pagos'] += 1
                    totals['monto'] += paid
                    sql.append(
                        'insert into academia.payments (fee_id, student_id, amount, paid_at, method, notes) '
                        f"select {q(fid)}, {q(sid)}, {paid}, {q(DUE[month])}, 'otro', 'Importado del control de pagos (fecha real no registrada)' "
                        f'where exists (select 1 from academia.fees where id = {q(fid)});')

            becado = 'BECADO' in (ago + sep).upper()
            months = {'AGO': ago, 'SEP': sep, 'OCT': octv}
            for m, raw in months.items():
                raw_u = raw.upper().replace('}', '').strip()
                reg = REGULAR[m]
                if becado and m in ('AGO', 'SEP'):
                    fee(m, 'Mensualidad', reg, discount=reg, reason='Beca completa')
                    continue
                if not raw_u:
                    if m == 'SEP' and money(ago) and not yellow:
                        fee(m, 'Mensualidad', reg, late=LATE_FEE[m])
                        rep['deben_sep'].append(f'{cat}: {label}')
                    continue
                split = re.fullmatch(r'\$?(\d+)\s*PTS?E?\s*\$?(\d+)', raw_u)
                if split:  # "400 PTS 150": pagó y debe
                    p, owe = float(split[1]), float(split[2])
                    fee(m, 'Mensualidad', p + owe, paid=p, late=LATE_FEE[m], note=f'Control: {raw}')
                    continue
                if raw_u.startswith('PT'):
                    fee(m, 'Mensualidad', reg, late=0 if yellow else LATE_FEE[m], note=f'Control: {raw}')
                    if m == 'SEP' and not yellow:
                        rep['deben_sep'].append(f'{cat}: {label}')
                    continue
                amt = money(raw)
                if amt is None:
                    rep['notas'].append(f'{cat}: {label} — valor no reconocido en {MONTH_LABEL[m]}: "{raw}"')
                    continue
                if amt >= reg:
                    fee(m, 'Mensualidad', amt, paid=amt)
                else:
                    fee(m, 'Mensualidad', reg, paid=amt, review=True, note=f'Pagó {amt:g} de {reg}: ¿beca o adeudo?')
                    rep['confirmar'].append(f'{cat}: {label} — {MONTH_LABEL[m]} pagó ${amt:g} de ${reg} (diferencia ${reg - amt:g})')
            for k, concept in (('REINS', 'Reinscripción'), ('UNI', 'Uniforme')):
                amt = money(get(k))
                if amt:
                    fee('AGO', concept, amt, paid=amt)

            paid_any = any(money(v) or re.match(r'^\$?\d+\s*PT', v.upper()) for v in (ago, sep, octv))
            if not paid_any and not yellow and not becado and not any(c.upper().startswith('PT') for c in (ago, sep, octv)):
                rep['sin_pagos'].append(f'{cat}: {label}')

    # Alumnos del primer Excel que no aparecen en el control
    missing = [s for s in students if s['id'] not in matched_ids and s['status'] != 'baja']
    sql.append('commit;')
    open(out_sql, 'w', encoding='utf8', newline='\n').write('\n'.join(sql) + '\n')

    L = ['# Resumen de la carga del control de pagos', '',
         f"- **Pagos registrados:** {totals['pagos']} por **${totals['monto']:,.0f}**",
         f"- **Cargos creados:** {totals['cargos']}", '']

    def sec(t, items):
        if items:
            L.extend([f'## {t} ({len(items)})', *[f'- {i}' for i in items], ''])
    sec('Alumnos nuevos (no estaban en el primer Excel)', rep['nuevos'])
    sec('Marcados como baja (fila amarilla)', rep['bajas'])
    sec('Por confirmar: ¿beca o adeudo?', rep['confirmar'])
    sec('Deben septiembre ($550 + recargo)', rep['deben_sep'])
    sec('Activos sin ningún pago registrado en agosto ni septiembre', rep['sin_pagos'])
    sec('Filas resaltadas en azul, rojo o naranja (significado por confirmar)', rep['colores'])
    sec('Duplicados en el control', rep['duplicados'])
    sec('Filas omitidas', rep['omitidos'])
    sec('Valores no reconocidos', rep['notas'])
    sec('Alumnos del primer Excel que no aparecen en el control de pagos', [s['full_name'] for s in missing])
    open(out_md, 'w', encoding='utf8', newline='\n').write('\n'.join(L))
    print('\n'.join(L[:6]))


if __name__ == '__main__':
    main(*sys.argv[1:6])
