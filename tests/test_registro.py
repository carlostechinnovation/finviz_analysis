"""Lineas de traza del ciclo en el log principal: escritura y lectura."""
from modulos.registro import logica as registro

PREFIJO = "2026-11-28 23:05:00,123 INFO modulos.ejecucion.logica: "


def test_ciclo_terminado_solo_en_las_ultimas_lineas_y_con_su_fecha():
    fin = PREFIJO + registro.linea_fin("2026-11-28", "enviado")
    assert registro.ciclo_terminado(["a", fin], "2026-11-28")
    assert not registro.ciclo_terminado(["a", fin], "2026-12-05")
    lejos = [fin] + ["x"] * registro.LINEAS_COLA
    assert not registro.ciclo_terminado(lejos, "2026-11-28")
    assert not registro.ciclo_terminado([], "2026-11-28")


def test_tickers_pedidos_de_la_pasada_principal_del_ciclo():
    lineas = [
        PREFIJO + registro.linea_inicio("2026-11-21"),
        PREFIJO + registro.linea_ticker("VIEJO", 0, registro.GUARDADO, "puntos=1 precio=1"),
        PREFIJO + registro.linea_inicio("2026-11-28"),
        PREFIJO + registro.linea_ticker("A", 0, registro.GUARDADO, "puntos=20 precio=1"),
        PREFIJO + registro.linea_ticker("BRK-B", 0, registro.SIN_FICHA, "motivo=timeout 30s (tras 4 intentos)"),
        PREFIJO + registro.linea_reanudacion("2026-11-28", "ultima"),
        PREFIJO + registro.linea_ticker("C", 0, registro.ERROR_LOTE),
        PREFIJO + registro.linea_ticker("D", 1, registro.GUARDADO, "puntos=2 precio=1"),
    ]
    assert registro.tickers_pedidos(lineas, "2026-11-28") == {"A", "BRK-B", "C"}
    assert registro.tickers_pedidos(lineas, "2026-11-28", ronda=1) == {"D"}
    assert registro.tickers_pedidos(lineas, "2026-12-05") == set()


def test_leer_lineas_sin_fichero_y_sin_vacias(tmp_path):
    assert registro.leer_lineas(tmp_path / "no_existe.log") == []
    ruta = tmp_path / "x.log"
    ruta.write_text("uno\n\n  \ndos\n", encoding="utf-8")
    assert registro.leer_lineas(ruta) == ["uno", "dos"]
    assert registro.ultima_linea(["uno", "dos "]) == "dos"
