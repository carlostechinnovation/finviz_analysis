import re

import pandas as pd

from apoyo import config_prueba
from modulos.analisis import logica as analisis
from modulos.bd.logica import RepositorioMemoria
from modulos.ejecucion.logica import Estado, Lote
from modulos.informe.logica import (GRIS_CLARO, adjunto_html, cuerpo_html, cuerpo_texto, duracion, estilo_diff,
                                    estilo_puntos, numero, porcentaje)


def test_formatos():
    assert porcentaje(3.04) == "+3,0 %"
    assert porcentaje(0.05) == "+0,1 %"        # redondeo comercial, no al par
    assert porcentaje(-0.04) == "0,0 %"
    assert porcentaje(-495) == "-495,0 %"
    assert porcentaje(1234.56) == "+1.234,6 %"
    assert porcentaje(float("nan")) == ""
    assert numero(17.255) == "17,26"
    assert duracion(3725) == "1 h 02 min" and duracion(95) == "1 min 35 s"


def test_colores():
    estilo, texto = estilo_puntos(15.99, 16, 26.31)
    assert GRIS_CLARO in estilo and texto == "15,99 (poco)"
    claro, texto16 = estilo_puntos(16, 16, 26.31)
    oscuro, _ = estilo_puntos(26.31, 16, 26.31)
    assert texto16 == "16,00" and claro != oscuro and "#1b7a35" in oscuro
    verde, _ = estilo_diff(50, 100)
    rojo, _ = estilo_diff(-50, 100)
    assert verde != rojo and estilo_diff(-200, 100)[0].startswith("background:#b71c1c")
    assert estilo_diff(float("nan"), 100) == ("", "")


def _resumen(tmp_path):
    import principal
    config = config_prueba(tmp_path)
    for nombre in ("dir_ejecuciones", "dir_informes", "dir_logs"):
        config.ruta(nombre).mkdir(parents=True, exist_ok=True)
    repo = RepositorioMemoria([("2026-11-21", "AAA", 20, 10), ("2026-11-28", "AAA", 22, 11),
                               ("2026-11-21", "BBB", 18, 10), ("2026-11-28", "BBB", 12, 9),
                               ("2026-11-28", "CCC", 17, 5)])
    lotes = [Lote(1, 0, "2026-11-28T00:01:00", "2026-11-28T00:21:00", 2, 2, True, False),
             Lote(2, 0, "2026-11-28T00:21:00", "2026-11-28T00:51:00", 2, 1, True, True)]
    estado = Estado("2026-11-28", "2026-11-28T00:01:00", "2026-11-29T23:59:00", n_universo=4,
                    pedidos=["AAA", "BBB", "CCC", "DDD"], lotes=lotes, terminada=True)
    return principal.construir_resumen(config, repo, estado, ["AAA", "BBB", "CCC", "DDD"], {})


def test_adjunto_html(tmp_path):
    r = _resumen(tmp_path)
    html = adjunto_html(r)
    assert "<h1>finviz_analysis</h1>" in html and "<h2>Prueba</h2>" in html
    assert "primera descarga de empresa): 2026-11-28 00:01:00" in html
    assert "última descarga de empresa): 2026-11-28 00:51:00" in html
    cab = re.findall(r"<th>(.*?)</th>", html)
    assert cab == ["ticker", "puntos_solvencia", "fecha", "diff_last_week", "diff_last_month",
                   "diff_last_3_months", "diff_last_6_months", "diff_last_9_months", "diff_last_12_months",
                   "corr_puntos_precio"]
    orden = re.findall(r'\?tickers=([A-Z]+)"', html)
    assert orden == ["AAA", "BBB", "CCC"]                 # +10 %, -33,3 %, sin dato
    assert "+10,0 %" in html and "-33,3 %" in html and "12,00 (poco)" in html


def test_cuerpo_resumen(tmp_path):
    r = _resumen(tmp_path)
    texto = cuerpo_texto(r)
    assert "Tickers pedidos: 4. Con puntos: 3. Sin ficha de Finviz: 1." in texto
    assert "Duración total: 50 min 00 s" in texto
    assert "mínima 20 min 00 s, media 25 min 00 s, máxima 30 min 00 s" in texto
    assert "Bloqueos del proxy r.jina.ai: 1." in texto
    assert "Con 16 puntos o más: 2 de 3." in texto
    assert "AAA | 20,00 | 22,00 | +2,00 | +10,0 %" in texto
    assert "BBB | 18,00 | 12,00 | -6,00 | -33,3 %" in texto
    assert "Datos insuficientes" in texto
    assert "Tabla en MariaDB" in texto
    html = cuerpo_html(r)
    assert "<title>finviz_analysis - Solvencia semanal 2026-11-28 (3 empresas)</title>" in html
    assert isinstance(r.detalle, pd.DataFrame) and analisis.COLUMNA_CORRELACION in r.detalle
