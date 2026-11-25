"""El log del proceso se vacia al arrancar un ciclo nuevo y solo se conserva al reanudar."""
import logging

import pytest

import principal
from apoyo import config_prueba


@pytest.fixture
def config(tmp_path, log_restaurado):
    c = config_prueba(tmp_path)
    c.ruta("dir_logs").mkdir(parents=True)
    return c


def _escribir(config, texto, **kw):
    principal.configurar_log(config, **kw)
    logging.getLogger("prueba").info(texto)
    return (config.ruta("dir_logs") / "finvizanalysis.log").read_text(encoding="utf-8")


def test_ejecucion_nueva_vacia_el_log(config):
    _escribir(config, "semana anterior")
    texto = _escribir(config, "semana nueva")
    assert "semana nueva" in texto and "semana anterior" not in texto


def test_reanudar_sigue_escribiendo_detras(config):
    _escribir(config, "antes del corte")
    texto = _escribir(config, "tras reanudar", vaciar=False)
    assert "antes del corte" in texto and "tras reanudar" in texto


def test_borra_logs_con_fecha_de_versiones_anteriores(config):
    viejo = config.ruta("dir_logs") / "finvizanalysis_2026-11-21.log"
    otro = config.ruta("dir_logs") / "finvizanalysis_comprobar.log"
    viejo.write_text("x", encoding="utf-8")
    otro.write_text("x", encoding="utf-8")
    _escribir(config, "hoy")
    assert not viejo.exists() and otro.exists()
