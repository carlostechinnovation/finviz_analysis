import datetime as dt

from apoyo import LectorFalso, Reloj, config_prueba
from modulos.bd.logica import RepositorioMemoria
from modulos.ejecucion.logica import (NADA, NUEVO, REANUDAR, Decision, Ejecutor, Estado, decidir, guardar_estado,
                                      leer_estado, preparar_estado, recuento)
from modulos.registro import logica as registro

INICIO = dt.datetime(2026, 11, 28, 23, 0)
FECHA = dt.date(2026, 11, 28)


def _ejecutar(config, lector, repo, universo, alias=None, inicio=INICIO, paso_min=1, ya_pedidos=frozenset()):
    reloj = Reloj(inicio, paso_min)
    estado = preparar_estado(config, Decision(NUEVO, inicio.date(), "prueba"), inicio, set())
    return Ejecutor(config, lector, repo, reloj=reloj, dormir=reloj.dormir).ejecutar(estado, universo, alias or {},
                                                                                      ya_pedidos)


# ----------------------------------------------------------------- decision
def test_decide_ciclo_nuevo_sin_datos_o_con_dato_de_7_dias_o_mas():
    hoy = dt.date(2026, 12, 5)
    assert decidir(None, [], hoy, 7).accion == NUEVO
    terminado = [registro.linea_fin("2026-11-28", "enviado")]
    d = decidir(dt.date(2026, 11, 28), terminado, hoy, 7)          # justo 7 dias: misma noche de la semana
    assert (d.accion, d.fecha) == (NUEVO, hoy) and "abandona" not in d.motivo
    d = decidir(dt.date(2026, 11, 20), ["... Lote 3 ..."], hoy, 7)  # sin terminar y viejo: se abandona
    assert d.accion == NUEVO and "abandona" in d.motivo


def test_decide_nada_si_el_ciclo_reciente_termino():
    lineas = [registro.linea_inicio("2026-11-28"), "x", registro.linea_fin("2026-11-28", "enviado")]
    d = decidir(dt.date(2026, 11, 28), lineas, dt.date(2026, 12, 4), 7)
    assert (d.accion, d.fecha) == (NADA, FECHA) and "2026-12-05" in d.motivo


def test_decide_reanudar_si_el_ciclo_reciente_no_termino():
    corte = [registro.linea_inicio("2026-11-28"), "... TICKER A ronda=0 GUARDADO puntos=20 precio=1"]
    d = decidir(dt.date(2026, 11, 28), corte, dt.date(2026, 11, 29), 7)
    assert (d.accion, d.fecha) == (REANUDAR, FECHA) and "TICKER A" in d.motivo
    error = corte + ["Traceback ...", registro.linea_error("2026-11-28")]
    assert decidir(dt.date(2026, 11, 28), error, dt.date(2026, 11, 29), 7).accion == REANUDAR
    assert decidir(dt.date(2026, 11, 28), [], dt.date(2026, 11, 29), 7).accion == REANUDAR   # sin log
    otro = [registro.linea_fin("2026-11-21", "enviado")]                                    # fin de otro ciclo
    assert decidir(dt.date(2026, 11, 28), otro, dt.date(2026, 11, 29), 7).accion == REANUDAR


def test_preparar_estado_reanuda_el_json_con_limite_nuevo(tmp_path):
    config = config_prueba(tmp_path)
    guardar_estado(config.ruta("dir_ejecuciones"),
                   Estado("2026-11-28", "2026-11-28T23:00:00", "2026-11-29T21:00:00", pedidos=["A"], terminada=True))
    ahora = dt.datetime(2026, 11, 29, 23, 0)
    e = preparar_estado(config, Decision(REANUDAR, FECHA, ""), ahora, {"B"})
    assert e.fecha == "2026-11-28" and e.inicio == "2026-11-28T23:00:00" and not e.terminada
    assert e.limite == "2026-11-30T21:00:00" and e.pedidos == ["A", "B"]
    # Sin JSON (borrado): se crea con la fecha del ciclo
    e = preparar_estado(config, Decision(REANUDAR, dt.date(2026, 11, 27), ""), ahora, set())
    assert e.fecha == "2026-11-27" and e.lotes == []


# ------------------------------------------------------------------- lotes
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


def test_una_linea_de_log_por_ticker(tmp_path, caplog):
    config = config_prueba(tmp_path, lectura__repesca_pausas_min=[])
    caplog.set_level("INFO")
    lector = LectorFalso({"A": (20, 10.5), "B": (15, 5.0)}, excepcion_en={2})
    _ejecutar(config, lector, RepositorioMemoria(), ["A", "X", "B"])
    lineas = [r.getMessage() for r in caplog.records if r.getMessage().startswith("TICKER")]
    assert lineas == ["TICKER A ronda=0 GUARDADO puntos=20 precio=10.5",
                      "TICKER X ronda=0 SIN_FICHA motivo=timeout",
                      "TICKER B ronda=0 ERROR_LOTE"]


def test_tope_del_lanzamiento_deja_el_ciclo_sin_terminar(tmp_path):
    config = config_prueba(tmp_path, ciclo__duracion_max_horas=0.05)   # 3 minutos
    repo = RepositorioMemoria()
    lector = LectorFalso({t: (20, 1.0) for t in "ABCDEF"})
    estado = _ejecutar(config, lector, repo, list("ABCDEF"))
    assert not estado.terminada and 0 < len(lector.llamadas) < 3
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


def test_reanudacion_salta_los_ya_guardados_y_los_ya_pedidos(tmp_path):
    config = config_prueba(tmp_path, lectura__repesca_pausas_min=[2])
    repo = RepositorioMemoria([("2026-11-28", "A", 20, 1.0)])
    lector = LectorFalso({"A": (20, 1.0), "B": (17, 2.0), "C": (18, 3.0), "X": (16, 4.0)}, fallan_n={"X": 0})
    estado = _ejecutar(config, lector, repo, ["A", "X", "B", "C"], ya_pedidos={"A", "X"})
    # Pasada principal: solo B y C. X (pedido antes, sin dato) va a la repesca
    assert lector.llamadas == [["B", "C"], ["X"]]
    assert estado.terminada and repo.tickers_con_dato(FECHA) == {"A", "B", "C", "X"}
