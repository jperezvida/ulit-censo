"""
Radar Digital · prueba con Overture Maps (places, esquema 2.0). Sin coste, sin escribir en el censo.

  1) Extracción por lotes, reutilizable (una vez por versión; no desde funciones de Vercel):
       python3 cruzar.py extraer --release 2026-11-18.0 --salida medina.parquet
  2) Cruce con los negocios del censo exportados del Radar (CSV «;» con Nombre y Dirección, p. ej. el
     botón «CSV» del Radar), fuera del repositorio:
       python3 cruzar.py cruzar --lugares medina.parquet --censo piloto.csv --informe informe.json

Datos: Overture Maps Foundation, CDLA-Permissive-2.0 / ODbL según fuente (se conserva `sources`).
Nunca convierte la falta de datos en «no tiene»; solo propone candidatos con procedencia y fecha.
"""
import argparse, csv, json, re, sys, unicodedata

BBOX = (-4.945, 41.290, -4.880, 41.332)  # zona urbana de Medina del Campo (xmin, ymin, xmax, ymax)

def extraer(release, salida):
    import pyarrow.dataset as ds, pyarrow.compute as pc, pyarrow.fs as fs, pyarrow.parquet as pq
    s3 = fs.S3FileSystem(anonymous=True, region='us-west-2')
    d = ds.dataset(f'overturemaps-us-west-2/release/{release}/theme=places/type=place/', filesystem=s3, format='parquet')
    xmin, ymin, xmax, ymax = BBOX
    f = ((pc.field('bbox', 'xmin') < xmax) & (pc.field('bbox', 'xmax') > xmin)
         & (pc.field('bbox', 'ymin') < ymax) & (pc.field('bbox', 'ymax') > ymin))
    t = d.to_table(filter=f)
    if 'categories' in t.schema.names: t = t.drop_columns(['categories'])  # campo antiguo: no se usa
    pq.write_table(t, salida)
    print(f'{t.num_rows} lugares · release {release} · {salida}')

VACIAS = {'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'sl', 'sa', 'slu', 'cb', 'sc', 's', 'l', 'c', 'b'}
# Palabras de tipo de negocio: no identifican por sí solas un establecimiento.
GENERICAS = {'bar', 'restaurante', 'cafeteria', 'cafe', 'tienda', 'comercio', 'peluqueria', 'heladeria', 'churreria',
             'panaderia', 'farmacia', 'optica', 'bodega', 'taberna', 'meson', 'supermercado', 'hermanos', 'hijos'}
TIPOS_VIA = {'calle', 'c', 'cl', 'avenida', 'av', 'avda', 'plaza', 'pl', 'pza', 'paseo', 'ronda', 'travesia', 'camino', 'carretera', 'ctra'}

def tokens(s):
    s = unicodedata.normalize('NFD', (s or '').lower()).encode('ascii', 'ignore').decode()
    return [w for w in re.sub(r'[^a-z0-9]+', ' ', s).split() if w not in VACIAS]

def calle_y_numero(direccion):
    t = tokens(direccion)
    num = next((w for w in t if w.isdigit()), '')
    calle = [w for w in t if not w.isdigit() and w not in TIPOS_VIA]
    return set(calle), num

def comparar(neg, lugar):
    """Criterios legibles. 'fiable' exige nombre distintivo completo y misma calle; si no, 'dudosa'."""
    a = [w for w in tokens(neg['nombre']) if w not in GENERICAS] or tokens(neg['nombre'])
    nombre_o = (lugar.get('names') or {}).get('primary') or ''
    b = set(tokens(nombre_o))
    comunes = [w for w in a if w in b]
    if not comunes: return None
    calle_c, num_c = calle_y_numero(neg['direccion'])
    ad = (lugar.get('addresses') or [{}])[0] or {}
    calle_o, num_o = calle_y_numero(ad.get('freeform') or '')
    criterios = []
    criterios.append('nombre completo' if len(comunes) == len(a) else f'nombre parcial ({" ".join(comunes)})')
    misma_calle = bool(calle_c and calle_o and (calle_c <= calle_o or calle_o <= calle_c))
    if misma_calle: criterios.append('misma calle' if calle_c == calle_o else 'calle compatible')
    if num_c and num_o: criterios.append('mismo número' if num_c == num_o else f'otro número ({num_o})')
    fiable = len(comunes) == len(a) and misma_calle and not (num_c and num_o and num_c != num_o)
    if not misma_calle and len(comunes) < len(a): return None  # parcial y en otra calle: ruido
    return {'nivel': 'fiable' if fiable else 'dudosa', 'criterios': criterios}

def evidencia(lugar, release):
    ad = (lugar.get('addresses') or [{}])[0] or {}
    fuentes = [{'dataset': s.get('dataset'), 'propiedad': s.get('property') or 'registro', 'licencia': s.get('license'),
                'actualizado': s.get('update_time'), 'id_origen': s.get('record_id')} for s in (lugar.get('sources') or [])]
    tax = lugar.get('taxonomy') or {}
    return {
        'gers': lugar['id'], 'release': release, 'nombre': (lugar.get('names') or {}).get('primary'),
        'direccion': ad.get('freeform'), 'confianza': round(lugar.get('confidence') or 0, 2),
        'estado_operativo': lugar.get('operating_status'),  # informativo: NUNCA cambia la ocupación del censo
        'categoria_basica': lugar.get('basic_category'), 'taxonomia': tax.get('hierarchy'),
        'webs': lugar.get('websites') or [], 'redes': lugar.get('socials') or [], 'telefonos': lugar.get('phones') or [],
        'marca': ((lugar.get('brand') or {}).get('names') or {}).get('primary'),
        'marca_wikidata': (lugar.get('brand') or {}).get('wikidata'),
        'fuentes': fuentes, 'ver': f"https://explore.overturemaps.org/?gers={lugar['id']}",
    }

def cruzar(lugares_parquet, censo_csv, informe, release):
    import pyarrow.parquet as pq
    lugares = pq.read_table(lugares_parquet).drop_columns(['geometry']).to_pylist()
    with open(censo_csv, encoding='utf-8-sig') as fh:
        filas = list(csv.DictReader(fh, delimiter=';'))
    res = []
    for f in filas:
        neg = {'nombre': f.get('Nombre') or f.get('nombre') or '', 'direccion': f.get('Dirección') or f.get('direccion') or ''}
        cands = []
        for l in lugares:
            c = comparar(neg, l)
            if c: cands.append({**c, **evidencia(l, release)})
        cands.sort(key=lambda c: (c['nivel'] != 'fiable', -len(c['criterios']), -c['confianza']))
        res.append({'negocio': neg, 'candidatos': cands[:3]})
    resumen = {
        'lugares_descargados': len(lugares), 'negocios': len(res),
        'con_coincidencia_fiable': sum(any(c['nivel'] == 'fiable' for c in r['candidatos']) for r in res),
        'solo_dudosa': sum(bool(r['candidatos']) and not any(c['nivel'] == 'fiable' for c in r['candidatos']) for r in res),
        'sin_coincidencia': sum(not r['candidatos'] for r in res),
        'con_web_propuesta': sum(any(c['webs'] for c in r['candidatos'][:1]) for r in res),
        'con_redes_propuestas': sum(any(c['redes'] for c in r['candidatos'][:1]) for r in res),
        'con_categoria_propuesta': sum(any(c['categoria_basica'] for c in r['candidatos'][:1]) for r in res),
    }
    json.dump({'resumen': resumen, 'resultados': res}, open(informe, 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(resumen, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest='orden', required=True)
    e = sub.add_parser('extraer'); e.add_argument('--release', required=True); e.add_argument('--salida', required=True)
    c = sub.add_parser('cruzar'); c.add_argument('--lugares', required=True); c.add_argument('--censo', required=True)
    c.add_argument('--informe', required=True); c.add_argument('--release', default='2026-11-18.0')
    a = p.parse_args()
    extraer(a.release, a.salida) if a.orden == 'extraer' else cruzar(a.lugares, a.censo, a.informe, a.release)
