"""Piezas comunes de los tests: configuracion en memoria y lector falso (sin Internet)."""
import datetime as dt
from urllib.parse import parse_qs, urlparse

from modulos.configuracion.logica import Config
from modulos.lector.logica import Lector, Puntuacion, ResultadoLectura


def config_prueba(tmp_path, **cambios) -> Config:
    """Configuracion de prueba. cambios: ruta con '__' en vez de '.' (ciclo__duracion_max_horas=1)."""
    datos = {
        "rutas": {"dir_base": str(tmp_path), "dir_ejecuciones": str(tmp_path / "ejecuciones"),
                  "dir_informes": str(tmp_path / "informes"), "dir_logs": str(tmp_path / "logs")},
        "bd": {"database": "finvizanalysis_test", "tabla": "solvencia"},
        "web": {"url": "https://ejemplo.invalid/finviz_analysis/"},
        "lectura": {"lector": "falso", "tamano_lote": 2, "timeout_min": 20, "timeout_factor": 2,
                    "timeout_max_min": 60, "proxy_peticiones_por_minuto": 18,
                    "proxy_peticiones_max_por_ticker": 4, "repesca_pausas_min": [2, 4],
                    "espera_bloqueo_min": 16},
        "ciclo": {"dias": 7, "duracion_max_horas": 22},
        "analisis": {"umbral_puntos": 16, "puntos_maximos": 26.31, "saturacion_diff_pct": 100,
                     "tolerancia_dias": 6, "top_n": 10,
                     "correlacion": {"min_pares": 8, "max_hueco_dias": 10, "alfa_fdr": 0.05}},
        "email": {"activar": True, "titulo": "finviz_analysis", "subtitulo": "Prueba"},
    }
    for ruta, valor in cambios.items():
        nodo = datos
        partes = ruta.split("__")
        for p in partes[:-1]:
            nodo = nodo[p]
        nodo[partes[-1]] = valor
    return Config(datos)


class Reloj:
    """Reloj falso: avanza paso_min minutos en cada consulta, mas lo que se duerma."""

    def __init__(self, inicio: dt.datetime, paso_min: float = 1):
        self.ahora, self.paso = inicio, dt.timedelta(minutes=paso_min)

    def __call__(self):
        actual = self.ahora
        self.ahora += self.paso
        return actual

    def dormir(self, segundos):
        self.ahora += dt.timedelta(seconds=segundos)


class LectorFalso(Lector):
    """
    Devuelve puntos y precio para los tickers de datos. Los de fallan_n salen
    sin ficha ese numero de veces; bloqueo_en y excepcion_en son numeros de
    llamada (desde 1) con bloqueo del proxy o con una excepcion.
    """

    def __init__(self, datos: dict, fallan_n: dict | None = None, bloqueo_en: set | None = None,
                 excepcion_en: set | None = None):
        self.datos, self.fallan = datos, dict(fallan_n or {})
        self.bloqueo_en, self.excepcion_en = bloqueo_en or set(), excepcion_en or set()
        self.llamadas = []

    def leer(self, url, timeout_min):
        tickers = parse_qs(urlparse(url).query)["tickers"][0].split(",")
        self.llamadas.append(tickers)
        n = len(self.llamadas)
        if n in self.excepcion_en:
            raise RuntimeError("caida simulada")
        r = ResultadoLectura(bloqueo_proxy=n in self.bloqueo_en)
        for t in tickers:
            if self.fallan.get(t, 0) > 0 or t not in self.datos:
                self.fallan[t] = self.fallan.get(t, 0) - 1
                r.puntuaciones[t] = Puntuacion(t, 0, None, True, "sin_datos", "timeout")
            else:
                puntos, precio = self.datos[t]
                r.puntuaciones[t] = Puntuacion(t, puntos, precio, False, "ok")
        return r
