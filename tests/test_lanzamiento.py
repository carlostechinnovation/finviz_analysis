"""
Lanzamiento diario de principio a fin (principal.lanzamiento) con lector y
repositorio falsos: ciclo nuevo, nada que hacer, reanudacion tras un corte y
error. Sin repesca ni bloqueos, para no esperar de verdad.
"""
import argparse
import datetime as dt

import pytest

import principal
from apoyo import LectorFalso, config_prueba
from modulos.bd.logica import RepositorioMemoria
from modulos.configuracion.logica import crear_directorios
from modulos.registro import logica as registro

UNIVERSO = ["AAA", "BBB", "CCC"]
DATOS = {"AAA": (20, 10.0), "BBB": (15, 5.0), "CCC": (17, 1.0)}
ARGS = argparse.Namespace(sin_email=True, max_tickers=0)


@pytest.fixture
def config(tmp_path, log_restaurado):
    csv = tmp_path / "universo.csv"
    csv.write_text("Ticker,Name,Asset Class,Exchange\n" +
                   "".join(f"{t},{t} INC,Equity,NASDAQ\n" for t in UNIVERSO), encoding="utf-8")
    c = config_prueba(tmp_path, rutas__universo_csv=str(csv), lectura__repesca_pausas_min=[])
    crear_directorios(c)
    return c


def _lanzar(config, repo, lector, ahora=None):
    principal.configurar_log(config, principal.LOG_LANZAMIENTO)   # como main()
    return principal.lanzamiento(config, ARGS, ahora or dt.datetime.now(), lector=lector, repo=repo)


def _log(config, nombre=registro.PREFIJO_LOG) -> str:
    return registro.ruta_log(config, nombre).read_text(encoding="utf-8")


def test_ciclo_nuevo_y_al_dia_siguiente_nada(config):
    repo, lector = RepositorioMemoria(), LectorFalso(DATOS)
    assert _lanzar(config, repo, lector) == 0
    texto = _log(config)
    hoy = dt.date.today().isoformat()
    assert registro.linea_inicio(hoy) in texto and texto.count("TICKER ") == 3
    assert texto.strip().endswith(registro.linea_fin(hoy, "sin email (--sin-email)"))
    assert repo.tickers_con_dato(dt.date.today()) == set(UNIVERSO)

    lector2 = LectorFalso(DATOS)
    assert _lanzar(config, repo, lector2, dt.datetime.now() + dt.timedelta(days=1)) == 0
    assert lector2.llamadas == [] and _log(config) == texto       # el log del ciclo no se toca
    assert "Decision: NADA" in _log(config, principal.LOG_LANZAMIENTO)


def test_reanuda_tras_un_corte_y_sigue_el_log(config):
    hoy = dt.date.today()
    ayer = (hoy - dt.timedelta(days=1)).isoformat()
    corte = [registro.linea_inicio(ayer), registro.linea_ticker("AAA", 0, registro.GUARDADO, "puntos=20 precio=10"),
             "Lote 2 (ronda 0): 2 tickers, espera maxima 20 min"]
    registro.ruta_log(config).write_text("\n".join(corte) + "\n", encoding="utf-8")
    repo, lector = RepositorioMemoria([(ayer, "AAA", 20, 10.0)]), LectorFalso(DATOS)
    assert _lanzar(config, repo, lector) == 0
    assert lector.llamadas == [["BBB", "CCC"]]
    texto = _log(config)
    assert texto.startswith(corte[0]) and registro.linea_reanudacion(ayer, corte[-1]) in texto
    assert texto.strip().endswith(registro.linea_fin(ayer, "sin email (--sin-email)"))
    assert repo.tickers_con_dato(dt.date.fromisoformat(ayer)) == set(UNIVERSO)


def test_error_en_el_ciclo_deja_la_marca_y_se_reanuda(config):
    config.datos["rutas"]["universo_csv"] = str(config.ruta("dir_base") / "no_existe.csv")
    repo = RepositorioMemoria([(dt.date.today().isoformat(), "AAA", 20, 10.0)])
    assert _lanzar(config, repo, LectorFalso(DATOS)) == 1
    texto = _log(config)
    assert "FileNotFoundError" in texto and texto.strip().endswith(registro.linea_error(dt.date.today()))
    assert "Decision: REANUDAR" in _log(config, principal.LOG_LANZAMIENTO)
