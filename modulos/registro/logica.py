"""
Traza del ciclo en el log principal (diseno_informatico.md 6.3).

El log finvizanalysis.log es, junto con la tabla, lo que decide cada
lanzamiento diario si un ciclo termino o hay que reanudarlo. Por eso lleva
lineas con un formato fijo, que este modulo escribe y lee:

  CICLO INICIO fecha=AAAA-MM-DD                   primera linea de un ciclo nuevo
  CICLO REANUDADO fecha=AAAA-MM-DD tras: <linea>  primera linea de cada reanudacion
  TICKER <t> ronda=<n> <RESULTADO> [detalle]      una por ticker pedido, al acabar su lote
  CICLO PARADO fecha=AAAA-MM-DD ...               tope del lanzamiento alcanzado
  CICLO CON ERROR fecha=AAAA-MM-DD                tras el traceback de un error
  CICLO TERMINADO fecha=AAAA-MM-DD email=<...>    ultima linea de un ciclo completo

RESULTADO es GUARDADO, SIN_FICHA, NO_GUARDADO (ficha sin puntos o dilucion
pendiente), NO_LEIDO (la pagina no devolvio la casilla) o ERROR_LOTE.
"""
import re
from pathlib import Path

PREFIJO_LOG = "finvizanalysis"
LINEAS_COLA = 10   # "ultimas lineas" en las que se busca la marca de ciclo terminado

GUARDADO, SIN_FICHA, NO_GUARDADO, NO_LEIDO, ERROR_LOTE = (
    "GUARDADO", "SIN_FICHA", "NO_GUARDADO", "NO_LEIDO", "ERROR_LOTE")

_RE_CICLO = re.compile(r"CICLO (?:INICIO|REANUDADO) fecha=(\d{4}-\d{2}-\d{2})")
_RE_TICKER = re.compile(r"TICKER (\S+) ronda=(\d+) ([A-Z_]+)")


def ruta_log(config, nombre: str = PREFIJO_LOG) -> Path:
    return config.ruta("dir_logs") / f"{nombre}.log"


# ---------------------------------------------------------------- escritura
def linea_inicio(fecha) -> str:
    return f"CICLO INICIO fecha={fecha}"


def linea_reanudacion(fecha, ultima: str) -> str:
    return f"CICLO REANUDADO fecha={fecha} tras: {ultima or '(log vacio o inexistente)'}"


def linea_parada(fecha, horas: float) -> str:
    return (f"CICLO PARADO fecha={fecha}: tope de {horas:g} h por lanzamiento; "
            f"se reanudara en el proximo lanzamiento")


def linea_error(fecha) -> str:
    return f"CICLO CON ERROR fecha={fecha}: se reanudara en el proximo lanzamiento"


def linea_fin(fecha, resultado_email: str) -> str:
    return f"CICLO TERMINADO fecha={fecha} email={resultado_email}"


def linea_ticker(ticker: str, ronda: int, resultado: str, detalle: str = "") -> str:
    return f"TICKER {ticker} ronda={ronda} {resultado}" + (f" {detalle}" if detalle else "")


# ------------------------------------------------------------------ lectura
def leer_lineas(ruta: Path) -> list[str]:
    """Lineas no vacias del log; [] si no existe."""
    ruta = Path(ruta)
    if not ruta.exists():
        return []
    texto = ruta.read_text(encoding="utf-8", errors="replace")
    return [ln for ln in texto.splitlines() if ln.strip()]


def ultima_linea(lineas: list[str]) -> str:
    return lineas[-1].strip() if lineas else ""


def ciclo_terminado(lineas: list[str], fecha) -> bool:
    """True si entre las ultimas LINEAS_COLA lineas esta la marca de ciclo terminado de esa fecha."""
    marca = linea_fin(fecha, "")
    return any(marca in ln for ln in lineas[-LINEAS_COLA:])


def tickers_pedidos(lineas: list[str], fecha, ronda: int = 0) -> set[str]:
    """
    Tickers con linea TICKER de esa ronda dentro del ciclo de esa fecha (desde
    su CICLO INICIO o CICLO REANUDADO). Las lineas de otro ciclo no cuentan.
    """
    fecha, actual, pedidos = str(fecha), None, set()
    for ln in lineas:
        m = _RE_CICLO.search(ln)
        if m:
            actual = m.group(1)
            continue
        m = _RE_TICKER.search(ln)
        if m and actual == fecha and int(m.group(2)) == ronda:
            pedidos.add(m.group(1))
    return pedidos
