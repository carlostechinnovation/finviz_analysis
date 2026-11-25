"""
Carga de la configuracion del proceso semanal (diseno_informatico.md 10).

Dos ficheros:
  - config/configuracion.yml  versionado, publico, SIN secretos;
  - rutas.dir_secretos        fuera del repositorio (el secretos.yml de bolsa),
                              solo lectura.

Reglas de fusion (las mismas que solana y diia):
  - El schema SIEMPRE es bd.database de este proyecto; mariadb.database del
    fichero de secretos se ignora, para no escribir nunca en otro proyecto.
  - El bloque opcional 'finvizanalysis: destinatarios' del fichero de
    secretos sustituye a email.destinatarios.
  - Las credenciales quedan en claves internas (_bd, _email) que nunca se
    escriben en logs, informes ni base de datos.
"""
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[2]
RUTA_CONFIG_POR_DEFECTO = RAIZ / "config" / "configuracion.yml"
BLOQUE_PROPIO = "finvizanalysis"


class ErrorConfiguracion(Exception):
    """Configuracion ausente o invalida. Aborta la ejecucion."""


class Config:
    """Configuracion fusionada. Acceso por ruta con puntos: config.get('lectura.tamano_lote')."""

    def __init__(self, datos: dict):
        self.datos = datos

    def get(self, ruta: str, por_defecto=None):
        nodo = self.datos
        for parte in ruta.split("."):
            if not isinstance(nodo, dict) or parte not in nodo:
                return por_defecto
            nodo = nodo[parte]
        return nodo

    def exigir(self, ruta: str):
        valor = self.get(ruta)
        if valor is None or valor == "":
            raise ErrorConfiguracion(f"Falta la clave obligatoria '{ruta}' en config/configuracion.yml")
        return valor

    def ruta(self, nombre: str) -> Path:
        """Ruta de la seccion 'rutas'; las relativas se resuelven desde la raiz del repositorio."""
        p = Path(str(self.exigir(f"rutas.{nombre}")))
        return p if p.is_absolute() else RAIZ / p

    @property
    def credenciales_bd(self) -> dict:
        return self.get("_bd", {})

    @property
    def credenciales_email(self) -> dict:
        return self.get("_email", {})


def leer_yaml(ruta: Path) -> dict:
    if not ruta.exists():
        raise ErrorConfiguracion(f"No existe el fichero: {ruta}")
    with ruta.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def normalizar_destinatarios(valor) -> list:
    """Admite lista o cadena separada por comas o punto y coma; quita vacios."""
    if not valor:
        return []
    if isinstance(valor, str):
        valor = valor.replace(";", ",").split(",")
    return [str(d).strip() for d in valor if str(d).strip()]


def fusionar_secretos(datos: dict, secretos: dict) -> dict:
    """Anade _bd y _email a los datos de configuracion a partir del fichero de secretos."""
    mariadb = dict(secretos.get("mariadb") or {})
    if not mariadb.get("user"):
        raise ErrorConfiguracion("El fichero de secretos no trae 'mariadb.user'.")
    datos["_bd"] = {
        "user": mariadb["user"],
        "password": str(mariadb.get("password", "") or ""),
        "host": mariadb.get("host") or "localhost",
        "port": int(mariadb.get("port") or 3306),
        "database": (datos.get("bd") or {}).get("database") or "finvizanalysis",
    }
    email = dict(secretos.get("email") or {})
    propios = (secretos.get(BLOQUE_PROPIO) or {}).get("destinatarios")
    if propios:
        email["destinatarios"] = propios
    email["destinatarios"] = normalizar_destinatarios(email.get("destinatarios"))
    datos["_email"] = email
    return datos


def cargar_configuracion(ruta_config: str | None = None, con_secretos: bool = True) -> Config:
    """configuracion.yml + secretos. con_secretos=False para --comprobar (no toca BD ni email)."""
    datos = leer_yaml(Path(ruta_config) if ruta_config else RUTA_CONFIG_POR_DEFECTO)
    if not con_secretos:
        return Config(datos)
    ruta_secretos = Path(str((datos.get("rutas") or {}).get("dir_secretos", "") or ""))
    if not str(ruta_secretos) or str(ruta_secretos) == "." or not ruta_secretos.exists():
        raise ErrorConfiguracion(
            f"No encuentro el fichero de secretos en '{ruta_secretos}' (rutas.dir_secretos). "
            f"Debe contener los bloques 'mariadb' y 'email'. NUNCA lo dejes dentro del "
            f"repositorio: es publico.")
    return Config(fusionar_secretos(datos, leer_yaml(ruta_secretos)))


def crear_directorios(config: Config) -> None:
    for nombre in ("dir_base", "dir_ejecuciones", "dir_informes", "dir_logs"):
        config.ruta(nombre).mkdir(parents=True, exist_ok=True)
