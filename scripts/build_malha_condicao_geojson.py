#!/usr/bin/env python3
"""
scripts/build_malha_condicao_geojson.py
Gera dashboard/data/rodovias_pr_condicao.geojson a partir do shapefile SAM
(CONDICAO_MALHA_<ano>_SIRGAS2000_22S_LN) do DER-PR.

O shapefile traz um registro por segmento de trecho, já com nota de condição
(1-5) por segmento, extensão total do trecho ("Ext (km)") e data do
levantamento. Este script:
  1. Lê os registros, mantendo a geometria no CRS original do shapefile
     (SIRGAS 2000 / UTM 22S, EPSG:31982 — métrico).
  2. Agrupa, dentro de cada trecho, os segmentos consecutivos (ordenados por
     "ordem") que têm a mesma nota em uma única feature de linha — reduz o
     número de features sem alterar a informação (a nota já é por segmento).
  3. Simplifica cada geometria fundida (Douglas-Peucker, tolerância em
     metros) ainda em UTM 22S — a tolerância só tem sentido físico num CRS
     métrico, por isso a simplificação acontece antes da reprojeção.
  4. Reprojeta para WGS84 lon/lat (EPSG:4326, o que o Leaflet espera) e grava
     um GeoJSON com properties {trecho, nota, ext_trecho_km, data_lev}.

Uso:
    python scripts/build_malha_condicao_geojson.py [caminho_do_shapefile.shp]

Se omitido, usa data/CONDICAO_MALHA_2024_SIRGAS2000_22S_LN.shp.
"""

import json
import os
import sys

try:
    import shapefile
except ImportError:
    raise SystemExit("Dependência ausente: pip install pyshp")
try:
    from pyproj import Transformer
except ImportError:
    raise SystemExit("Dependência ausente: pip install pyproj")
try:
    from shapely.geometry import LineString
except ImportError:
    raise SystemExit("Dependência ausente: pip install shapely")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SHP = os.path.join(ROOT, 'data', 'CONDICAO_MALHA_2024_SIRGAS2000_22S_LN.shp')
OUTPUT_PATH = os.path.join(ROOT, 'dashboard', 'data', 'rodovias_pr_condicao.geojson')

SRC_CRS = 'EPSG:31982'  # SIRGAS 2000 / UTM zone 22S — CRS do shapefile SAM
DST_CRS = 'EPSG:4326'   # WGS84 lon/lat — o que o Leaflet espera
SIMPLIFY_TOLERANCE_M = 15  # metros, aplicado em UTM 22S (CRS métrico)


def read_segments(shp_path):
    sf = shapefile.Reader(shp_path)

    # sf.shapes() (leitura em lote) falha nesta base com um erro de tipo de
    # forma interno do pyshp; ler forma a forma (sf.shape(i)) funciona para
    # todos os 11.600 registros, então usamos esse caminho.
    # Pontos ficam em UTM 22S (metros) — a reprojeção só acontece depois da
    # simplificação, em simplify_and_reproject().
    segments = []
    for i, rec in enumerate(sf.iterRecords()):
        d = rec.as_dict()
        shp = sf.shape(i)
        points = [(x, y) for x, y in shp.points]
        segments.append({
            'trecho':   d['trecho'],
            'ordem':    d['ordem'],
            'nota':     int(d['nota']),
            'data_lev': d['data_lev'],
            'ext_km':   d['Ext (km)'],
            'points':   points,
        })
    return segments


def merge_same_nota_runs(segments):
    """Agrupa por trecho, ordena por 'ordem' e funde em uma linha só os
    segmentos consecutivos com a mesma nota (eles compartilham o ponto de
    junção exatamente, então basta concatenar sem duplicar esse ponto)."""
    by_trecho = {}
    for seg in segments:
        by_trecho.setdefault(seg['trecho'], []).append(seg)

    groups = []
    for trecho, segs in by_trecho.items():
        segs.sort(key=lambda s: s['ordem'])
        # "Ext (km)" é a extensão total do trecho, repetida em cada segmento
        # (raríssimas exceções de poucos metros entre segmentos do mesmo
        # trecho); usar o valor do primeiro segmento é suficiente.
        ext_trecho_km = segs[0]['ext_km']

        current = None
        for seg in segs:
            if current is not None and current['nota'] == seg['nota']:
                current['points'].extend(seg['points'][1:])
            else:
                if current is not None:
                    groups.append(current)
                current = {
                    'trecho':       trecho,
                    'nota':         seg['nota'],
                    'data_lev':     seg['data_lev'],
                    'ext_trecho_km': ext_trecho_km,
                    'points':       list(seg['points']),
                }
        if current is not None:
            groups.append(current)
    return groups


def simplify_and_reproject(groups, tolerance_m=SIMPLIFY_TOLERANCE_M):
    """Simplifica cada geometria fundida (Douglas-Peucker, preserve_topology=True)
    ainda em UTM 22S (metros), depois reprojeta os vértices resultantes para
    WGS84 e arredonda a 6 casas decimais (~11 cm, só precisão de saída, não
    reduz vértices)."""
    transformer = Transformer.from_crs(SRC_CRS, DST_CRS, always_xy=True)
    vertices_before = vertices_after = 0

    for g in groups:
        vertices_before += len(g['points'])
        if len(g['points']) >= 2:
            simplified = LineString(g['points']).simplify(tolerance_m, preserve_topology=True)
            utm_points = list(simplified.coords)
        else:
            utm_points = g['points']
        vertices_after += len(utm_points)
        g['points'] = [tuple(round(c, 6) for c in transformer.transform(x, y)) for x, y in utm_points]

    return vertices_before, vertices_after


def to_geojson(groups):
    features = []
    for g in groups:
        features.append({
            'type': 'Feature',
            'properties': {
                'trecho':        g['trecho'],
                'nota':          g['nota'],
                'ext_trecho_km': g['ext_trecho_km'],
                'data_lev':      g['data_lev'],
            },
            'geometry': {
                'type': 'LineString',
                'coordinates': [list(p) for p in g['points']],
            },
        })
    return {'type': 'FeatureCollection', 'features': features}


def main():
    shp_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SHP
    if not os.path.exists(shp_path):
        raise SystemExit(f"Shapefile não encontrado: {shp_path}")

    print(f'[1/4] Lendo {shp_path}...')
    segments = read_segments(shp_path)
    print(f'      {len(segments)} segmentos lidos.')

    print('[2/4] Agrupando segmentos consecutivos com a mesma nota...')
    groups = merge_same_nota_runs(segments)
    print(f'      {len(groups)} features geradas (de {len(segments)} segmentos originais).')

    print(f'[3/4] Simplificando geometria (Douglas-Peucker, tolerância {SIMPLIFY_TOLERANCE_M} m, UTM 22S) e reprojetando para WGS84...')
    vertices_before, vertices_after = simplify_and_reproject(groups)
    print(f'      {vertices_before:,} vértices -> {vertices_after:,} vértices '
          f'({(1 - vertices_after / vertices_before) * 100:.1f}% de redução).')

    print(f'[4/4] Gravando {OUTPUT_PATH}...')
    geojson = to_geojson(groups)
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(',', ':'))

    size_kb = os.path.getsize(OUTPUT_PATH) // 1024
    print()
    print('=' * 55)
    print(f'[OK] Gerado: {OUTPUT_PATH} ({size_kb:,} KB)')
    print('=' * 55)


if __name__ == '__main__':
    main()
