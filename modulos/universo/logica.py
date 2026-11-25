"""
Universo de empresas: la cartera del ETF iShares IWV (Russell 3000), en
permanentes/russell3000_bruto.csv, tal como se descarga de la web del ETF
(diseno_funcional.md 9.1; mismo fichero y mismos filtros que bolsa).

Se queda solo con acciones cotizadas, un ticker por fila: fuera futuros,
efectivo, valores sin mercado ("NO MARKET", "Non-Nms"), CVR, escrow, derechos
y tickers repetidos.
"""
import csv
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_TICKER_VALIDO = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_SIN_MERCADO = re.compile(r"NO MARKET|Non-Nms", re.I)
_NO_ACCION = re.compile(r"\bCVR\s*$|\bESCROW\b|\bRIGHTS\b", re.I)
_CLASE = re.compile(r"\bCLASS ([A-Z])\s*$")


def _filas(ruta: Path) -> list[dict]:
    """Filas del CSV desde la cabecera 'Ticker' (iShares antepone datos del fondo)."""
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        lineas = f.read().splitlines()
    inicio = next((i for i, ln in enumerate(lineas) if ln.lstrip('"').startswith("Ticker")), 0)
    return list(csv.DictReader(lineas[inicio:]))


def normalizar_ticker(ticker: str) -> str:
    """'BRK B' (iShares) -> 'BRK-B' (Finviz)."""
    return re.sub(r"\s+", "-", str(ticker or "").strip().upper())


def alias_clase(ticker: str, nombre: str) -> str | None:
    """
    iShares quita el guion de algunas clases (BFB, HEIA) y Finviz lo necesita
    (BF-B, HEI-A). Si el nombre acaba en "CLASS X" y el ticker en X devuelve el
    simbolo con guion; si no, None. Solo se usa en la repesca: META "CLASS A"
    acaba en A y no es una clase partida, por eso no se aplica de entrada.
    """
    m = _CLASE.search(str(nombre or "").upper())
    if m and len(ticker) > 1 and ticker.endswith(m.group(1)) and "-" not in ticker:
        return f"{ticker[:-1]}-{m.group(1)}"
    return None


def leer_universo(ruta: Path) -> tuple[list[str], dict]:
    """
    Devuelve (tickers en el orden del CSV, alias de repesca {ticker: alias}).
    Lanza FileNotFoundError si falta el fichero.
    """
    ruta = Path(ruta)
    if not ruta.exists():
        raise FileNotFoundError(
            f"No existe {ruta}: descarga la cartera de iShares IWV ('Detailed Holdings and "
            f"Analytics', CSV) y guardala con ese nombre (diseno_informatico.md 10.2)")
    filas = _filas(ruta)
    tickers, alias, vistos = [], {}, set()
    for f in filas:
        t = normalizar_ticker(f.get("Ticker"))
        if not _TICKER_VALIDO.match(t) or t in vistos:
            continue
        if "Asset Class" in f and str(f["Asset Class"]).strip().lower() != "equity":
            continue
        if _SIN_MERCADO.search(str(f.get("Exchange", ""))):
            continue
        nombre = str(f.get("Name", ""))
        if _NO_ACCION.search(nombre):
            continue
        vistos.add(t)
        tickers.append(t)
        a = alias_clase(t, nombre)
        if a:
            alias[t] = a
    logger.info("Universo: %d tickers de %d filas de %s", len(tickers), len(filas), ruta.name)
    return tickers, alias
