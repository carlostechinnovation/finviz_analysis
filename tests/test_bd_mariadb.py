"""
Prueba de integracion con MariaDB real: solo si FINVIZ_TEST_MARIADB=1 y existe
el fichero de secretos. Usa el schema finvizanalysis_test y lo borra al final.
"""
import datetime as dt
import os

import pytest

from modulos.bd.logica import RepositorioMariaDB
from modulos.configuracion.logica import cargar_configuracion

pytestmark = pytest.mark.skipif(os.environ.get("FINVIZ_TEST_MARIADB") != "1",
                                reason="integracion con MariaDB desactivada (FINVIZ_TEST_MARIADB=1 para activarla)")
SCHEMA = "finvizanalysis_test"


@pytest.fixture
def repo():
    config = cargar_configuracion()
    r = RepositorioMariaDB(config.credenciales_bd, SCHEMA, "solvencia")
    yield r
    from sqlalchemy import text
    with r.motor.begin() as con:
        con.execute(text(f"DROP SCHEMA IF EXISTS `{SCHEMA}`"))


def test_crea_guarda_sustituye_y_lee(repo):
    repo.asegurar_tabla()
    repo.asegurar_tabla()                           # idempotente
    f = dt.date(2026, 11, 28)
    assert repo.fecha_mas_reciente() is None        # tabla vacia
    assert repo.guardar(f, [("AAA", 17.25, 354.2), ("BBB", -81.5, None)]) == 2
    repo.guardar(f, [("AAA", 18.0, 355.0)])         # misma clave: sustituye
    assert repo.tickers_con_dato(f) == {"AAA", "BBB"}
    repo.guardar(dt.date(2026, 11, 21), [("AAA", 17.0, 350.0)])
    assert repo.fecha_mas_reciente() == f
    df = repo.historico().set_index("ticker")
    assert df.loc["AAA", "puntos_solvencia"] == 18.0 and df.loc["AAA", "precio"] == 355.0
    assert df.loc["BBB", "puntos_solvencia"] == -81.5 and df["precio"].isna().sum() == 1
    assert repo.tamano_bytes() > 0
