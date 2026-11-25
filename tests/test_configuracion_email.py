import pytest
import yaml

from modulos.configuracion.logica import (Config, ErrorConfiguracion, cargar_configuracion, fusionar_secretos,
                                          normalizar_destinatarios)
from modulos.email.logica import construir_mensaje, motivo_para_no_enviar

SECRETOS = {
    "mariadb": {"user": "u", "password": "p@ss", "host": "h", "port": 3307, "database": "otro_proyecto"},
    "email": {"usuario": "remitente@ejemplo.invalid", "password": "x", "destinatarios": "a@ejemplo.invalid; b@ejemplo.invalid"},
}


def test_schema_propio_y_destinatarios():
    d = fusionar_secretos({"bd": {"database": "finvizanalysis"}}, dict(SECRETOS))
    assert d["_bd"]["database"] == "finvizanalysis" and d["_bd"]["port"] == 3307
    assert d["_email"]["destinatarios"] == ["a@ejemplo.invalid", "b@ejemplo.invalid"]
    propios = {**SECRETOS, "finvizanalysis": {"destinatarios": ["c@ejemplo.invalid"]}}
    assert fusionar_secretos({}, propios)["_email"]["destinatarios"] == ["c@ejemplo.invalid"]
    assert normalizar_destinatarios(None) == []


def test_sin_fichero_de_secretos(tmp_path):
    ruta = tmp_path / "configuracion.yml"
    ruta.write_text(yaml.safe_dump({"rutas": {"dir_secretos": str(tmp_path / "no.yml")}}), encoding="utf-8")
    with pytest.raises(ErrorConfiguracion, match="secretos"):
        cargar_configuracion(str(ruta))
    assert cargar_configuracion(str(ruta), con_secretos=False).get("_bd") is None


def test_configuracion_del_repositorio_sin_secretos():
    config = cargar_configuracion(con_secretos=False)
    assert config.get("bd.database") == "finvizanalysis" and config.get("bd.tabla") == "solvencia"
    assert config.get("lectura.tamano_lote") == 100
    assert config.ruta("universo_csv").name == "russell3000_bruto.csv"


def test_email():
    config = Config({"email": {"activar": True}, "_email": fusionar_secretos({}, dict(SECRETOS))["_email"]})
    assert motivo_para_no_enviar(config) is None
    assert "destinatarios" in motivo_para_no_enviar(Config({"_email": {"usuario": "u", "password": "p"}}))
    m = construir_mensaje("r@ejemplo.invalid", ["a@ejemplo.invalid"], "Asunto", "texto", "<p>html</p>",
                          {"detalle.html": b"<html></html>"})
    partes = [p.get_content_type() for p in m.walk()]
    assert partes == ["multipart/mixed", "multipart/alternative", "text/plain", "text/html", "text/html"]
    assert m.get_payload()[1].get_filename() == "detalle.html"
