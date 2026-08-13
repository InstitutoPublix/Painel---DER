#!/usr/bin/env python3
"""
scripts/build_malha_condicao_geojson.py
Gera dashboard/data/rodovias_pr_condicao.geojson a partir do shapefile SAM
(CONDICAO_MALHA_<ano>_SIRGAS2000_22S_LN) do DER-PR.

O shapefile traz um registro por segmento de trecho, já com nota de condição
(1-5) por segmento e extensão total do trecho ("Ext (km)"). Este script:
  1. Lê os registros, mantendo a geometria no CRS original do shapefile
     (SIRGAS 2000 / UTM 22S, EPSG:31982 — métrico).
  2. Costura os segmentos de cada trecho por PROXIMIDADE GEOGRÁFICA real das
     extremidades, não pelo campo 'ordem' da fonte. Investigação anterior
     (scratchpad/geometria_costura/RELATORIO_validacao_angulos.md) mostrou
     que 'ordem' não corresponde de forma confiável à sequência espacial dos
     segmentos em ~24% dos trechos — a costura por 'ordem' produzia laços
     (a linha "quase voltava" sobre si mesma), inflando o comprimento
     desenhado sem que isso aparecesse na métrica de razão de comprimento
     (fundida/declarado), só num ângulo de junção próximo de 180°.
     Duas abordagens são calculadas por trecho e a melhor é escolhida por
     junção (não por comprimento total sozinho — ver `costura_geografica`):
       A) guloso com penalidade de ângulo — nearest-endpoint, mas o custo de
          cada candidato inclui uma penalidade se a virada exceder 60°.
       B) grafo multi-fragmento (greedy-edge) — considera todas as conexões
          candidatas entre extremidades de pares de segmentos de uma vez
          (não segmento-a-segmento a partir de um ponto fixo), o que evita o
          defeito clássico do nearest-neighbor de "esquecer" um segmento e
          ter que voltar para pegá-lo.
     2-opt é aplicado como refinamento posterior em A e B (ver comentário em
     `two_opt_refine` sobre o que isso realmente contribuiu na validação).
     Validado em scratchpad/geometria_costura/RELATORIO_prototipo_v2.md:
     94,8% dos 1.645 trechos com razão de comprimento E ângulo de junção
     corretos simultaneamente (contra 3,2% da costura por 'ordem').
  3. Agrupa, dentro da nova sequência geográfica, os segmentos consecutivos
     com a mesma nota em uma única feature de linha (mesma lógica de antes,
     só que sobre a ordem corrigida).
  4. Calcula `ext_trecho_km` de cada fragmento como o comprimento REAL da
     geometria daquele fragmento específico (medido em UTM 22S, métrico) —
     não mais herdado do Ext(km) do trecho inteiro. Corrige o bug em que um
     trecho fatiado em N fragmentos de nota diferente mostrava o mesmo km
     total (do trecho inteiro) em cada um deles (ver
     scratchpad/geometria_costura/RELATORIO_costura_geometria.md).
  5. Simplifica cada geometria fundida (Douglas-Peucker, tolerância em
     metros) ainda em UTM 22S — a tolerância só tem sentido físico num CRS
     métrico, por isso a simplificação acontece antes da reprojeção.
  6. Reprojeta para WGS84 lon/lat (EPSG:4326, o que o Leaflet espera) e grava
     um GeoJSON com properties {trecho, nota, ext_trecho_km, data_lev}.

Uso:
    python scripts/build_malha_condicao_geojson.py [caminho_do_shapefile.shp]

Se omitido, usa data/CONDICAO_MALHA_2024_SIRGAS2000_22S_LN.shp.
"""

import json
import math
import os
import sys
from collections import Counter

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

# Parâmetros da costura geográfica — validados em
# scratchpad/geometria_costura/prototipo_costura_v2.py e
# RELATORIO_prototipo_v2.md. Não ajustar sem re-rodar aquela validação.
ALVO_M = 150.0             # janela (m) do vetor de direção em cada extremidade
LIMIAR_ANGULO_OK = 60.0    # graus; acima disso, guloso penaliza o candidato
PENALIDADE_POR_GRAU = 40.0  # metros de penalidade por grau acima do limiar
RAZAO_ACEITAVEL = 0.10     # ±10% de desvio do Ext(km) declarado


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


# ---------------------------------------------------------------------
# Costura geográfica (portado de scratchpad/geometria_costura/
# prototipo_costura_v2.py — funções puras, sem dependência do ambiente de
# teste do scratchpad, só math + shapely).
# ---------------------------------------------------------------------

def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _vetor_chegada(points, alvo_m=ALVO_M):
    """Vetor unitário apontando de um ponto ~alvo_m antes do fim até o fim
    (direção de chegada numa junção)."""
    end = points[-1]
    ref = points[0]
    acc = 0.0
    for i in range(len(points) - 2, -1, -1):
        seglen = _dist(points[i], points[i + 1])
        if acc + seglen >= alvo_m:
            frac = (alvo_m - acc) / seglen if seglen > 0 else 0
            ref = (points[i + 1][0] + (points[i][0] - points[i + 1][0]) * frac,
                   points[i + 1][1] + (points[i][1] - points[i + 1][1]) * frac)
            break
        acc += seglen
        ref = points[i]
    vx, vy = end[0] - ref[0], end[1] - ref[1]
    n = math.hypot(vx, vy)
    return (vx / n, vy / n) if n > 0 else None


def _vetor_saida(points, alvo_m=ALVO_M):
    """Vetor unitário apontando do início até um ponto ~alvo_m adiante
    (direção de saída de uma junção)."""
    start = points[0]
    ref = points[-1]
    acc = 0.0
    for i in range(1, len(points)):
        seglen = _dist(points[i - 1], points[i])
        if acc + seglen >= alvo_m:
            frac = (alvo_m - acc) / seglen if seglen > 0 else 0
            ref = (points[i - 1][0] + (points[i][0] - points[i - 1][0]) * frac,
                   points[i - 1][1] + (points[i][1] - points[i - 1][1]) * frac)
            break
        acc += seglen
        ref = points[i]
    vx, vy = ref[0] - start[0], ref[1] - start[1]
    n = math.hypot(vx, vy)
    return (vx / n, vy / n) if n > 0 else None


def _angulo_entre(v1, v2):
    if v1 is None or v2 is None:
        return 0.0
    dot = max(-1.0, min(1.0, v1[0] * v2[0] + v1[1] * v2[1]))
    return math.degrees(math.acos(dot))


def _guloso_com_penalidade_angulo(segs):
    """Abordagem A: nearest-endpoint, mas o custo de cada candidato é
    distância + penalidade se a virada exceder LIMIAR_ANGULO_OK — evita que
    o algoritmo aceite um quase-retorno só porque está geograficamente
    perto (a causa raiz do defeito da costura por 'ordem')."""
    remaining = list(segs)
    start = min(remaining, key=lambda s: s['ordem'])  # ponto de partida arbitrário
    remaining.remove(start)
    order = [dict(start)]

    while remaining:
        current_pts = order[-1]['points']
        v_chegada = _vetor_chegada(current_pts)
        ce = current_pts[-1]
        best, best_score, best_pts = None, None, None
        for seg in remaining:
            for rev in (False, True):
                pts = list(seg['points'])[::-1] if rev else list(seg['points'])
                d = _dist(ce, pts[0])
                v_saida = _vetor_saida(pts)
                ang = _angulo_entre(v_chegada, v_saida)
                penal = max(0.0, ang - LIMIAR_ANGULO_OK) * PENALIDADE_POR_GRAU
                score = d + penal
                if best_score is None or score < best_score:
                    best_score, best, best_pts = score, seg, pts
        order.append({**best, 'points': best_pts})
        remaining.remove(best)
    return order


class _UnionFind:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def _multifragmento(segs):
    """Abordagem B: grafo multi-fragmento (greedy-edge). Constrói todas as
    conexões candidatas entre as duas extremidades de cada par de
    segmentos, ordena por distância, e aceita gulosamente as menores que
    não violem grau<=2 por extremidade nem fechem ciclo prematuro
    (Union-Find). Ao contrário do nearest-neighbor sequencial (abordagem A),
    considera o problema globalmente — não deixa segmentos "sobrando" longe
    do ponto onde o guloso já passou. Foi a abordagem vencedora em ~35% dos
    trechos no geral e na quase totalidade dos casos mais difíceis (ver
    RELATORIO_prototipo_v2.md, seções 5 e 6)."""
    n = len(segs)
    if n == 1:
        return [dict(segs[0])]

    def pt(i, e):
        return segs[i]['points'][0] if e == 0 else segs[i]['points'][-1]

    candidatos = []
    for i in range(n):
        for j in range(i + 1, n):
            for ei in (0, 1):
                for ej in (0, 1):
                    candidatos.append((_dist(pt(i, ei), pt(j, ej)), i, ei, j, ej))
    candidatos.sort(key=lambda c: c[0])

    endpoint_used = [[False, False] for _ in range(n)]
    adjacency = {}
    uf = _UnionFind(n)
    edges_added = 0
    for d, i, ei, j, ej in candidatos:
        if edges_added == n - 1:
            break
        if endpoint_used[i][ei] or endpoint_used[j][ej]:
            continue
        if uf.find(i) == uf.find(j):
            continue
        endpoint_used[i][ei] = True
        endpoint_used[j][ej] = True
        adjacency[(i, ei)] = (j, ej)
        adjacency[(j, ej)] = (i, ei)
        uf.union(i, j)
        edges_added += 1

    start_seg = next(i for i in range(n) if not (endpoint_used[i][0] and endpoint_used[i][1]))
    free_end = 0 if not endpoint_used[start_seg][0] else 1

    order = []
    visited = set()
    current_seg, entry_end = start_seg, free_end
    for _ in range(n):
        visited.add(current_seg)
        seg = segs[current_seg]
        pts = list(seg['points'])
        if entry_end == 0:
            exit_end = 1
        else:
            pts = pts[::-1]
            exit_end = 0
        order.append({**seg, 'points': pts})
        nxt = adjacency.get((current_seg, exit_end))
        if nxt is None:
            break
        current_seg, entry_end = nxt

    assert len(visited) == n, f"multifragmento não visitou todos os segmentos ({len(visited)}/{n})"
    return order


def _two_opt_refine(order, max_iter=60):
    """Refinamento 2-opt clássico: procura pares de arestas que, se a
    cadeia entre elas for revertida, reduzem a distância total de salto.

    Nota de robustez: nos dados testados (1.292 trechos com >=2 segmentos —
    ver RELATORIO_prototipo_v2.md), isso NUNCA alterou o resultado da
    abordagem B (0,0% dos casos) e nunca venceu a seleção final nem para A
    nem para B — a construção inicial de ambas já era boa o suficiente para
    este tamanho de instância (no máximo 38 segmentos por trecho). Mantido
    mesmo assim como rede de segurança por robustez contra casos futuros ou
    dados atualizados (um novo levantamento SAM pode ter trechos com
    topologia mais difícil do que qualquer um testado), não porque haja
    necessidade comprovada nos dados atuais.
    """
    order = list(order)
    n = len(order)
    if n < 3:
        return order

    def gap(o, i):
        return _dist(o[i]['points'][-1], o[i + 1]['points'][0])

    improved = True
    it = 0
    while improved and it < max_iter:
        improved = False
        it += 1
        for i in range(n - 1):
            for j in range(i + 2, n):
                old = gap(order, i) + (gap(order, j) if j < n - 1 else 0)
                sub_rev = [{**s, 'points': list(reversed(s['points']))} for s in reversed(order[i + 1:j + 1])]
                trial = order[:i + 1] + sub_rev + order[j + 1:]
                new_cost = _dist(trial[i]['points'][-1], trial[i + 1]['points'][0]) + (
                    _dist(trial[j]['points'][-1], trial[j + 1]['points'][0]) if j < n - 1 else 0
                )
                if new_cost < old - 1e-6:
                    order = trial
                    improved = True
    return order


def _avaliar(order, ext_km):
    flat = [p for seg in order for p in seg['points']]
    km_total = LineString(flat).length / 1000.0 if len(flat) >= 2 else 0.0
    razao = (km_total / ext_km) if ext_km else None

    max_ang = 0.0
    for i in range(len(order) - 1):
        v_cheg = _vetor_chegada(order[i]['points'])
        v_sai = _vetor_saida(order[i + 1]['points'])
        max_ang = max(max_ang, _angulo_entre(v_cheg, v_sai))

    return {'km_total': km_total, 'razao': razao, 'max_angulo': round(max_ang, 1)}


def costura_geografica(segs):
    """Escolhe, entre as variantes A/A+2opt/B/B+2opt, a costura final de um
    trecho. Critério (nem ângulo nem razão decidem sozinhos — foi a lição
    da validação anterior: razão sozinha escondia laços de ~180°, e ângulo
    sozinho pode escolher um candidato com razão de comprimento ruim):
      1. entre as variantes com razão dentro de ±10% do Ext(km) declarado,
         escolhe a de menor ângulo máximo de junção;
      2. se nenhuma variante tiver razão aceitável, cai para a de menor
         desvio de razão (um comprimento absurdamente errado é pior sinal
         que um ângulo moderado).
    Retorna (order, nome_da_variante_escolhida)."""
    if len(segs) == 1:
        return [dict(segs[0])], 'unico_segmento'

    ext_km = segs[0]['ext_km']
    order_a = _guloso_com_penalidade_angulo(segs)
    order_b = _multifragmento(segs)
    variantes = {
        'guloso_angulo': order_a,
        'guloso_angulo_2opt': _two_opt_refine(order_a),
        'multifragmento': order_b,
        'multifragmento_2opt': _two_opt_refine(order_b),
    }
    metricas = {nome: _avaliar(o, ext_km) for nome, o in variantes.items()}

    def chave(nome):
        m = metricas[nome]
        desvio_razao = abs((m['razao'] if m['razao'] is not None else 1.0) - 1.0)
        razao_aceitavel = desvio_razao <= RAZAO_ACEITAVEL
        return (0 if razao_aceitavel else 1, m['max_angulo'] if razao_aceitavel else desvio_razao, desvio_razao)

    melhor_nome = min(metricas, key=chave)
    return variantes[melhor_nome], melhor_nome


def costura_e_agrupar_por_nota(segments):
    """Para cada trecho: costura por proximidade geográfica (não mais por
    'ordem' — ver docstring do módulo), depois agrupa segmentos
    consecutivos (na nova ordem) com a mesma nota em uma única feature de
    linha. ext_trecho_km de cada fragmento resultante é o comprimento REAL
    daquele fragmento, medido na própria geometria (ver comentário abaixo,
    após o loop principal) — não mais herdado do Ext(km) do trecho inteiro.

    Os poucos trechos (6, confirmados em RELATORIO_prototipo_v2.md) que têm
    um único segmento bruto no shapefile não têm decisão de costura
    possível — o valor de saída é sempre o comprimento real desse único
    segmento. Nesses casos, se ele não bater com o Ext(km) declarado da
    fonte, é descompasso de dado na própria base (não corrigível por
    costura) — não uma falha deste script."""
    by_trecho = {}
    for seg in segments:
        by_trecho.setdefault(seg['trecho'], []).append(seg)

    stats = Counter()
    groups = []
    for trecho, segs in by_trecho.items():
        order, variante = costura_geografica(segs)
        stats[variante] += 1

        current = None
        for seg in order:
            if current is not None and current['nota'] == seg['nota']:
                current['points'].extend(seg['points'][1:])
            else:
                if current is not None:
                    groups.append(current)
                current = {
                    'trecho':   trecho,
                    'nota':     seg['nota'],
                    'data_lev': seg['data_lev'],
                    'points':   list(seg['points']),
                }
        if current is not None:
            groups.append(current)

    # ext_trecho_km = comprimento real de CADA FRAGMENTO (não do trecho
    # inteiro), medido ainda em UTM 22S (metros, antes da reprojeção em
    # simplify_and_reproject() — que substitui g['points'] por coordenadas
    # WGS84, não métricas).
    for g in groups:
        g['ext_trecho_km'] = round(LineString(g['points']).length / 1000.0, 2) if len(g['points']) >= 2 else 0.0

    return groups, stats


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

    print('[2/4] Costurando por proximidade geográfica e agrupando segmentos consecutivos com a mesma nota...')
    groups, stats = costura_e_agrupar_por_nota(segments)
    print(f'      {len(groups)} features geradas (de {len(segments)} segmentos originais).')
    print(f'      Variante vencedora por trecho: '
          f'{stats.get("multifragmento", 0)} multi-fragmento, '
          f'{stats.get("guloso_angulo", 0)} guloso+ângulo, '
          f'{stats.get("multifragmento_2opt", 0)} multi-fragmento+2opt, '
          f'{stats.get("guloso_angulo_2opt", 0)} guloso+ângulo+2opt, '
          f'{stats.get("unico_segmento", 0)} sem ambiguidade (1 segmento só).')

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
