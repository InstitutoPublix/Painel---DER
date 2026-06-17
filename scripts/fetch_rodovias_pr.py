"""
fetch_rodovias_pr.py
====================
Busca o traçado real das rodovias estaduais do Paraná via Overpass API
e gera dashboard/data/rodovias_pr.geojson com condição de malha por SR.

AVISO: Não foi encontrada lista completa de municípios por SR no projeto
(cobertura disponível: apenas os 21 municípios do piloto). A atribuição
de trechos às SRs é feita por Voronoi (proximidade ao município-sede
de cada SR). Todos os trechos são marcados atribuicao_aproximada=true.
Confirme com a equipe de SIG do DER antes de usar em material formal.

Para reexecutar (a partir da raiz do projeto):
    python scripts/fetch_rodovias_pr.py

Lê:   data/der_precomputed.json   (condição IRI Bom+Muito Bom por SR)
Gera: dashboard/data/rodovias_pr.geojson
Tempo estimado: 2–5 minutos (depende da velocidade da Overpass API).
"""

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date

ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRECOMPUTED = os.path.join(ROOT, 'data', 'der_precomputed.json')
OUT         = os.path.join(ROOT, 'dashboard', 'data', 'rodovias_pr.geojson')

if not os.path.exists(PRECOMPUTED):
    sys.exit(f'Arquivo não encontrado: {PRECOMPUTED}')

# ── Municípios-sede das SRs (Voronoi seed points) ───────────────────────────
# Fonte: estrutura organizacional pública do DER-PR
SR_SEDES = {
    'SR Leste':         {'lat': -25.4284, 'lon': -49.2733},  # Curitiba
    'SR Campos Gerais': {'lat': -25.0916, 'lon': -50.1619},  # Ponta Grossa
    'SR Norte':         {'lat': -23.3045, 'lon': -51.1696},  # Londrina
    'SR Noroeste':      {'lat': -23.4205, 'lon': -51.9331},  # Maringá
    'SR Oeste':         {'lat': -24.9578, 'lon': -53.4595},  # Cascavel
}

# ── Consulta Overpass API ────────────────────────────────────────────────────
# Busca ways com ref começando em "PR" dentro da área do estado do Paraná.
# highway: primary, secondary, tertiary, trunk (rodovias estaduais e equivalentes).
OVERPASS_URL   = 'https://overpass-api.de/api/interpreter'
OVERPASS_QUERY = """
[out:json][timeout:180];
area["ISO3166-2"="BR-PR"]["admin_level"="4"]->.pr;
way(area.pr)["highway"~"^(primary|secondary|tertiary|trunk)$"]["ref"~"^PR"];
out geom;
"""

# Simplificação: stride — retém no máximo MAX_NOS pontos por trecho.
# Tolerância cartográfica equivale a ~1 km em latitude para MAX_NOS=30.
MAX_NOS = 30


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


def nearest_sr(lat, lon):
    return min(SR_SEDES, key=lambda sr: haversine(lat, lon, SR_SEDES[sr]['lat'], SR_SEDES[sr]['lon']))


def normalize_ref(raw):
    """Normaliza para 'PR-NNN'. Aceita PR-092, PR 092, PR092, etc.
    Se o campo tiver múltiplos refs separados por ';', usa o primeiro."""
    if not raw:
        return None
    first = raw.split(';')[0].strip()
    m = re.search(r'PR[\s\-]?(\d+)', first, re.IGNORECASE)
    if not m:
        return None
    return f"PR-{int(m.group(1)):03d}"


def simplify_stride(coords):
    """Simplificação por stride: retém no máximo MAX_NOS pontos, sempre
    incluindo o primeiro e o último."""
    n = len(coords)
    if n <= MAX_NOS:
        return coords
    step = max(1, n // MAX_NOS)
    result = coords[::step]
    if result[-1] != coords[-1]:
        result.append(coords[-1])
    return result


def fetch_overpass(query, retries=3):
    data = urllib.parse.urlencode({'data': query}).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(OVERPASS_URL, data=data, method='POST')
            req.add_header('User-Agent', 'DER-PR-Painel/1.0 (pesquisa institucional)')
            with urllib.request.urlopen(req, timeout=200) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as exc:
            if attempt < retries - 1:
                print(f'  Tentativa {attempt + 1} falhou ({exc}). Aguardando 15 s...')
                time.sleep(15)
            else:
                raise


# ── Carrega condição IRI por SR ──────────────────────────────────────────────
print('Carregando condição da malha (IRI)...')
with open(PRECOMPUTED, encoding='utf-8') as f:
    precomp = json.load(f)

sr_pct_bom = {}
for sr_name, r in precomp['regionais'].items():
    bom = round(r['iri']['bom'] + r['iri']['muito_bom'], 2)
    sr_pct_bom[sr_name] = bom

print('  IRI Bom+Muito Bom por SR:')
for sr, pct in sorted(sr_pct_bom.items()):
    print(f'    {sr}: {pct}%')

# ── Busca na Overpass API ────────────────────────────────────────────────────
print('\nConsultando Overpass API (pode levar até 5 minutos)...')
result = fetch_overpass(OVERPASS_QUERY)
ways   = [e for e in result.get('elements', []) if e.get('type') == 'way']
print(f'  {len(ways)} ways retornados')

# ── Constrói features GeoJSON ────────────────────────────────────────────────
features = []
skipped  = 0

for way in ways:
    tags    = way.get('tags', {})
    ref_raw = tags.get('ref', '')
    ref     = normalize_ref(ref_raw)
    if not ref:
        skipped += 1
        continue

    geom = way.get('geometry', [])
    if len(geom) < 2:
        skipped += 1
        continue

    # GeoJSON usa [lon, lat]
    raw_coords = [[g['lon'], g['lat']] for g in geom]
    coords     = simplify_stride(raw_coords)

    # Centróide para Voronoi
    lats = [g['lat'] for g in geom]
    lons = [g['lon'] for g in geom]
    clat = sum(lats) / len(lats)
    clon = sum(lons) / len(lons)

    sr     = nearest_sr(clat, clon)
    pct_bom = sr_pct_bom.get(sr, 0.0)

    features.append({
        'type': 'Feature',
        'geometry': {'type': 'LineString', 'coordinates': coords},
        'properties': {
            'ref':                  ref,
            'sr':                   sr,
            'pct_bom_muito_bom':    pct_bom,
            'atribuicao_aproximada': True,
            'highway':              tags.get('highway', ''),
            'way_id':               way['id']
        }
    })

print(f'  {len(features)} trechos com ref PR válido exportados')
print(f'  {skipped} trechos ignorados (sem ref PR ou geometria insuficiente)')

# ── Exporta GeoJSON ──────────────────────────────────────────────────────────
geojson = {
    'type':              'FeatureCollection',
    'gerado_em':         str(date.today()),
    'fonte_geometria':   'OpenStreetMap via Overpass API (https://overpass-api.de)',
    'fonte_condicao':    'DER-PR — IRI Bom+Muito Bom por SR (der_precomputed.json, levantamento SGP 2021–2022)',
    'atribuicao_sr':     (
        'Voronoi por município-sede de cada SR (aproximação). '
        'Lista completa de municípios por SR não disponível no projeto — '
        'cobertura disponível: apenas 21 municípios do piloto.'
    ),
    'simplificacao':     f'Stride: máximo {MAX_NOS} nós por trecho (~1 km de tolerância)',
    'features':          features
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(geojson, f, ensure_ascii=False, separators=(',', ':'))

size_kb = os.path.getsize(OUT) / 1024
print(f'\nOK — arquivo gerado: {OUT} ({size_kb:.0f} KB)')

sr_counts = Counter(f['properties']['sr'] for f in features)
print('\nTrechos por SR:')
for sr in sorted(SR_SEDES):
    cnt = sr_counts.get(sr, 0)
    pct = sr_pct_bom.get(sr, 0.0)
    print(f'  {sr}: {cnt} trechos  |  IRI Bom+Muito Bom: {pct:.1f}%')
