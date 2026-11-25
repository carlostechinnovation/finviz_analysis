import math

import numpy as np
import pandas as pd
import pytest

from modulos.analisis.logica import (benjamini_hochberg, correlaciones, detalle, estadisticas,
                                     estadisticas_puntos, movimientos, pares_semanales, variacion_pct)
from modulos.bd.logica import RepositorioMemoria


def _df(filas):
    return RepositorioMemoria(filas).historico()


def test_variacion_pct_con_base_cero_y_negativa():
    v = variacion_pct([22, 5, -79, 3], [20, 0, 20, -2])
    assert v[0] == pytest.approx(10.0)
    assert math.isnan(v[1])                       # base 0: sin dato
    assert v[2] == pytest.approx(-495.0)          # caida por el -99 de dilucion
    assert v[3] == pytest.approx(250.0)           # base negativa: se divide por |base|


def test_detalle_horizontes_tolerancia_y_orden():
    filas = [
        ("2025-11-26", "A", 10, 1), ("2026-08-26", "A", 12, 1), ("2026-10-24", "A", 16, 1),
        ("2026-11-21", "A", 20, 1), ("2026-11-28", "A", 22, 1),
        ("2026-11-14", "B", 20, 1), ("2026-11-28", "B", 18, 1),     # sin dato de hace 1 semana (hueco)
        ("2026-11-21", "C", 10, 1), ("2026-11-28", "C", 15, 1),
        ("2026-11-21", "D", 8, 1),                                   # ultimo dato antiguo
    ]
    d = detalle(_df(filas), tolerancia_dias=6).set_index("ticker")
    assert list(d.index) == ["C", "A", "B", "D"]                     # diff_last_week desc, vacios al final
    assert d.loc["A", "diff_last_week"] == pytest.approx(10.0)
    assert d.loc["A", "diff_last_month"] == pytest.approx(37.5)      # objetivo 2026-10-28: dato del 10-24
    assert d.loc["A", "diff_last_3_months"] == pytest.approx(83.3333, rel=1e-4)
    assert d.loc["A", "diff_last_12_months"] == pytest.approx(120.0)
    assert math.isnan(d.loc["B", "diff_last_week"])                   # 14 dias de hueco > 7 + 6
    assert d.loc["D", "fecha"] == pd.Timestamp("2026-11-21")
    assert math.isnan(d.loc["A", "diff_last_6_months"])               # no hay dato cerca de 2026-05-28


def test_estadisticas_y_movimientos():
    filas = [("2026-11-21", t, p, 1) for t, p in [("A", 10), ("B", 20), ("C", 18), ("D", 5)]] + \
            [("2026-11-28", t, p, 1) for t, p in [("A", 15), ("B", 16), ("C", 18), ("E", 30)]]
    df = _df(filas)
    e = estadisticas_puntos(df, 16)
    assert (e["n"], e["min"], e["max"], e["n_umbral"]) == (4, 15, 30, 3)
    assert e["media"] == pytest.approx(19.75)
    m = movimientos(df, 10)
    assert list(m["suben"]["ticker"]) == ["A"] and list(m["bajan"]["ticker"]) == ["B"]
    assert m["suben"]["dif_pct"][0] == pytest.approx(50.0)
    assert movimientos(_df(filas[:4]), 10)["suben"].empty
    assert math.isnan(estadisticas([1])["desv"]) and estadisticas([1, 3])["desv"] == pytest.approx(math.sqrt(2))


def test_pares_semanales_y_huecos():
    serie = _df([("2026-01-03", "A", 10, 100), ("2026-01-10", "A", 12, 110),
                 ("2026-01-17", "A", 11, 99), ("2026-02-14", "A", 13, 120)])
    p = pares_semanales(serie, 10)
    assert len(p) == 2                                   # el salto de 4 semanas no forma par
    assert p["dp"].tolist() == [2, -1]
    assert p["r"][0] == pytest.approx(0.10)
    assert p["r_sig"][0] == pytest.approx(-0.10)


def test_benjamini_hochberg():
    # Limites 0,0125 / 0,025 / 0,0375 / 0,05 para los p ordenados
    assert benjamini_hochberg([0.01, 0.035, 0.02, 0.20], 0.05).tolist() == [True, True, True, False]
    assert benjamini_hochberg([0.01, 0.04, 0.03, 0.20], 0.05).tolist() == [True, False, False, False]
    # Escalonado hacia arriba: el ultimo que pasa arrastra a los anteriores aunque no pasen solos
    assert benjamini_hochberg([0.01, 0.04, 0.03, 0.045], 0.05).tolist() == [True, True, True, True]
    assert benjamini_hochberg([0.5, 0.9], 0.05).tolist() == [False, False]


def test_correlacion_predictiva_detecta_relacion_y_exige_minimo():
    rng = np.random.default_rng(7)
    fechas = pd.date_range("2026-01-03", periods=30, freq="7D")
    filas = []
    puntos, precio = 15.0, 100.0
    dps = rng.normal(0, 1, len(fechas))
    for i, f in enumerate(fechas):
        puntos += dps[i]
        if i > 0:
            precio *= 1 + 0.02 * dps[i - 1]           # el precio sigue a los puntos con una semana de retraso
        filas.append((f, "A", round(puntos, 2), precio))
    for i, f in enumerate(fechas[:5]):                 # B: pocas semanas
        filas.append((f, "B", 10 + i, 50 + i))
    c = correlaciones(_df(filas), min_pares=8, max_hueco_dias=10, alfa=0.05)
    pt = c.por_ticker.set_index("ticker")
    assert pt.loc["A", "rho"] > 0.8 and bool(pt.loc["A", "significativa"])
    assert math.isnan(pt.loc["B", "rho"])
    assert c.suficientes and c.predictiva["n_empresas"] == 1 and c.predictiva["n_signif_pos"] == 1


def test_correlacion_sin_datos_suficientes():
    c = correlaciones(_df([("2026-11-21", "A", 10, 1), ("2026-11-28", "A", 12, 2)]), 8, 10, 0.05)
    assert not c.suficientes and c.n_ejecuciones == 2
