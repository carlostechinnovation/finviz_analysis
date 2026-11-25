import datetime as dt

from apoyo import LectorFalso, Reloj, config_prueba
from modulos.bd.logica import RepositorioMemoria
from modulos.ejecucion.logica import (Ejecutor, Estado, calcular_limite, guardar_estado, iniciar_o_reanudar,
                                      leer_estado, recuento, se_reanudara)

SABADO = dt.datetime(2026, 11, 28, 0, 1)
FECHA = dt.date(2026, 11, 28)


def _ejecutar(config, lector, repo, universo, alias=None, inicio=SABADO, paso_min=1):
    reloj = Reloj(inicio, paso_min)
    estado = iniciar_o_reanudar(config, inicio)
    return Ejecutor(config, lector, repo, reloj=reloj, dormir=reloj.dormir).ejecutar(estado, universo, alias or {})


def test_limite_sabado_a_domingo():
    assert calcular_limite(SABADO, 7, "23:59", 48) == dt.datetime(2026, 11, 29, 23, 59)
    # Lanzada a mano un miercoles: el tope de 48 h llega antes que el domingo
    assert calcular_limite(dt.datetime(2026, 11, 25, 10, 0), 7, "23:59", 48) == dt.datetime(2026, 11, 27, 10, 0)
    # El domingo despues de la hora limite: el domingo siguiente
    assert calcular_limite(dt.datetime(2026, 11, 29, 23, 59, 30), 7, "23:59", 200) == \
        dt.datetime(2026, 12, 6, 23, 59)


def test_ejecucion_completa_con_repesca_y_alias(tmp_path):
    config = config_prueba(tmp_path)
    repo = RepositorioMemoria()
    universo, alias = ["A", "B", "C", "BFB", "X"], {"BFB": "BF-B"}
    lector = LectorFalso({"A": (20, 10.0), "B": (15, 5.0), "C": (17, 1.0), "BF-B": (18, 40.0)},
                         fallan_n={"C": 1})
    estado = _ejecutar(config, lector, repo, universo, alias)
    assert estado.terminada
    assert repo.tickers_con_dato(FECHA) == {"A", "B", "C", "BF-B"}
    # Pasada principal en lotes de 2; repesca 1 con C, BF-B (alias) y X; repesca 2 solo X
    assert lector.llamadas == [["A", "B"], ["C", "BFB"], ["X"], ["C", "BF-B"], ["X"], ["X"]]
    assert [l.ronda for l in estado.lotes] == [0, 0, 0, 1, 1, 2]
    rc = recuento(estado, universo, alias, repo.tickers_con_dato(FECHA))
    assert rc == {"n_universo": 5, "n_con_puntos": 4, "n_sin_ficha": 1, "n_no_procesados": 0}
    assert leer_estado(config.ruta("dir_ejecuciones"), "2026-11-28").terminada


def test_ventana_corta_lotes_y_cuenta_no_procesados(tmp_path):
    config = config_prueba(tmp_path, ventana__duracion_max_horas=0.05)   # 3 minutos
    repo = RepositorioMemoria()
    lector = LectorFalso({t: (20, 1.0) for t in "ABCDEF"})
    estado = _ejecutar(config, lector, repo, list("ABCDEF"))
    assert estado.terminada and 0 < len(lector.llamadas) < 3
    rc = recuento(estado, list("ABCDEF"), {}, repo.tickers_con_dato(FECHA))
    assert rc["n_no_procesados"] > 0 and rc["n_con_puntos"] + rc["n_no_procesados"] == 6


def test_bloqueo_espera_y_lote_fallido_va_a_repesca(tmp_path):
    config = config_prueba(tmp_path)
    repo = RepositorioMemoria()
    lector = LectorFalso({t: (20, 1.0) for t in "ABCD"}, bloqueo_en={1}, excepcion_en={2})
    estado = _ejecutar(config, lector, repo, list("ABCD"))
    assert estado.lotes[0].bloqueo_proxy and estado.lotes[1].error.startswith("RuntimeError")
    assert repo.tickers_con_dato(FECHA) == set("ABCD")
    espera = dt.datetime.fromisoformat(estado.lotes[1].inicio) - dt.datetime.fromisoformat(estado.lotes[0].fin)
    assert espera >= dt.timedelta(minutes=16)


def test_reanuda_ejecucion_sin_terminar(tmp_path):
    config = config_prueba(tmp_path)
    guardar_estado(config.ruta("dir_ejecuciones"),
                   Estado("2026-11-28", "2026-11-28T00:01:00", "2026-11-29T23:59:00", pedidos=["A"]))
    domingo = dt.datetime(2026, 11, 29, 9, 0)
    repo = RepositorioMemoria([("2026-11-28", "A", 20, 1.0)])
    lector = LectorFalso({"A": (20, 1.0), "B": (17, 2.0)})
    estado = _ejecutar(config, lector, repo, ["A", "B"], inicio=domingo)
    assert estado.fecha == "2026-11-28"
    assert lector.llamadas == [["B"]]          # A ya tenia dato en esa fecha
    assert repo.tickers_con_dato(FECHA) == {"A", "B"}


def test_no_reanuda_pasado_el_limite(tmp_path):
    config = config_prueba(tmp_path)
    guardar_estado(config.ruta("dir_ejecuciones"),
                   Estado("2026-11-29", "2026-11-29T00:01:00", "2026-11-29T23:59:00"))
    assert iniciar_o_reanudar(config, dt.datetime(2026, 11, 30, 8, 0)).fecha == "2026-11-30"


def test_se_reanudara_coincide_con_iniciar_o_reanudar(tmp_path):
    config = config_prueba(tmp_path)
    assert not se_reanudara(config, SABADO)                       # nada guardado: nueva
    guardar_estado(config.ruta("dir_ejecuciones"),
                   Estado("2026-11-29", "2026-11-29T00:01:00", "2026-11-29T23:59:00"))
    assert se_reanudara(config, dt.datetime(2026, 11, 29, 20, 0))    # sin terminar y en plazo
    assert not se_reanudara(config, dt.datetime(2026, 11, 30, 8, 0))  # limite pasado: nueva
