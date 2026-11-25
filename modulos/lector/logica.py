"""
Lectura de la web finviz_analysis (docs/) tal como la ve un usuario: se abre la
pagina con ?tickers=<lote>, se espera a que termine la comparacion y se leen
las marcas que el usuario no ve (diseno_informatico.md 6.2):

  - document.body.dataset.comparacion: "en_curso" -> "terminada";
  - document.body.dataset.bloqueoProxy: "1" si r.jina.ai bloqueo un dominio;
  - en la fila de puntos, cada <td> lleva data-ticker, data-puntos,
    data-sin-ficha ("1" sin ficha de Finviz o pendiente), data-dilucion
    ("ok", "alerta", "sin_datos" o "pendiente"), data-motivo y data-precio
    (campo "Price" de la ficha de Finviz; vacio si no lo trae).

Si la pagina no termina a tiempo se leen igualmente las casillas: las que ya
tienen ficha y dilucion resuelta son validas (sus puntos ya no cambian).

Interfaz Lector con una implementacion real (LectorPlaywright) y la factoria
crear_lector(config). Los tests usan su propio lector falso: nunca salen a Internet.
"""
import logging
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from urllib.parse import quote

from modulos.lector.navegador import usar_navegador_del_entorno

logger = logging.getLogger(__name__)

_JS_TERMINADA = "() => document.body && document.body.dataset.comparacion === 'terminada'"
_JS_CELDAS = ("tds => tds.map(td => [td.dataset.ticker, td.dataset.puntos, td.dataset.sinFicha, "
              "td.dataset.dilucion, td.dataset.motivo, td.dataset.precio])")
_JS_BLOQUEO = "() => document.body.dataset.bloqueoProxy === '1'"
_JS_LOG = "() => (document.getElementById('log') || {}).textContent || ''"

DILUCION_PENDIENTE = "pendiente"


@dataclass
class Puntuacion:
    ticker: str
    puntos: float | None
    precio: float | None
    sin_ficha: bool
    dilucion: str | None = None
    motivo: str | None = None

    @property
    def valida(self) -> bool:
        """Se guarda: tiene ficha, puntos numericos y la dilucion ya resuelta."""
        return (not self.sin_ficha and self.puntos is not None
                and self.dilucion != DILUCION_PENDIENTE)


@dataclass
class ResultadoLectura:
    puntuaciones: dict = field(default_factory=dict)   # ticker -> Puntuacion
    terminada: bool = True
    bloqueo_proxy: bool = False
    log_pagina: str = ""

    def validas(self) -> list[Puntuacion]:
        return [p for p in self.puntuaciones.values() if p.valida]


def _numero(valor) -> float | None:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def interpretar_celdas(celdas: list) -> dict:
    """[[ticker, puntos, sin_ficha, dilucion, motivo, precio], ...] -> {ticker: Puntuacion}."""
    resultado = {}
    for celda in celdas:
        celda = list(celda) + [None] * (6 - len(celda))
        ticker, puntos, sin_ficha, dilucion, motivo, precio = celda[:6]
        t = str(ticker or "").strip().upper()
        if not t:
            continue
        resultado[t] = Puntuacion(t, _numero(puntos), _numero(precio), str(sin_ficha) == "1",
                                  dilucion or None, str(motivo or "").strip() or None)
    return resultado


def url_lote(base: str, tickers: list[str]) -> str:
    """URL de la web con el lote precargado (la comparacion arranca sola)."""
    return base + ("&" if "?" in base else "?") + "tickers=" + quote(",".join(tickers), safe=",-.")


def timeout_lote_min(n_tickers: int, p: dict) -> float:
    """
    Espera maxima (min) para un lote de n_tickers. La cola de la pagina
    despacha como mucho proxy_peticiones_por_minuto y cada ticker cuesta hasta
    proxy_peticiones_max_por_ticker: (max*n + 1) / ritmo es lo minimo que tarda
    sin fallos (trabajo / ritmo, Little 1961). Se multiplica por timeout_factor
    para cubrir reintentos, entre timeout_min y timeout_max_min.
    """
    estimado = (p["proxy_peticiones_max_por_ticker"] * n_tickers + 1) / p["proxy_peticiones_por_minuto"]
    return min(p["timeout_max_min"], max(p["timeout_min"], p["timeout_factor"] * estimado))


class Lector(ABC):
    """Abre la web con un lote de tickers y devuelve lo que muestra."""

    @abstractmethod
    def leer(self, url: str, timeout_min: float) -> ResultadoLectura:
        """Espera como mucho timeout_min a que termine la comparacion."""


class LectorPlaywright(Lector):
    """Chromium sin ventana (Playwright), el de dentro del entorno conda."""

    TIMEOUT_CARGA_MS = 120_000

    def leer(self, url: str, timeout_min: float) -> ResultadoLectura:
        from playwright.sync_api import TimeoutError as TimeoutPlaywright, sync_playwright
        usar_navegador_del_entorno()
        with sync_playwright() as pw:
            navegador = pw.chromium.launch(headless=True)
            try:
                pagina = navegador.new_page()
                pagina.goto(url, wait_until="load", timeout=self.TIMEOUT_CARGA_MS)
                terminada = True
                try:
                    pagina.wait_for_function(_JS_TERMINADA, timeout=int(timeout_min * 60_000), polling=2000)
                except TimeoutPlaywright:
                    terminada = False
                    logger.warning("La pagina no termino en %.0f min: se leen las casillas ya resueltas",
                                   timeout_min)
                celdas = pagina.eval_on_selector_all("td[data-ticker]", _JS_CELDAS)
                bloqueo = pagina.evaluate(_JS_BLOQUEO)
                log_pagina = pagina.evaluate(_JS_LOG)
            finally:
                navegador.close()
        return ResultadoLectura(interpretar_celdas(celdas), terminada, bool(bloqueo), str(log_pagina or ""))


def crear_lector(config) -> Lector:
    """Factoria segun lectura.lector (solo 'playwright')."""
    tipo = str(config.get("lectura.lector", "playwright")).lower()
    if tipo != "playwright":
        raise ValueError(f"lectura.lector desconocido: '{tipo}'")
    return LectorPlaywright()
