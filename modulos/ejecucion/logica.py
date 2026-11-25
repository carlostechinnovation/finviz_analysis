"""
Ejecucion semanal por lotes (diseno_informatico.md 6.1).

  1. Fecha de la ejecucion: la de hoy, o la de una ejecucion sin terminar de
     hace como mucho ventana.dias_reanudar dias (se reanuda con su fecha).
  2. Limite: el siguiente ventana.dia_limite a ventana.hora_limite (domingo
     23:59), sin pasar de inicio + ventana.duracion_max_horas. A partir del
     limite no se empieza ningun lote.
  3. Pasada principal: los tickers del universo sin dato en esa fecha, en
     lotes de lectura.tamano_lote. Cada lote se guarda en BD al terminar.
  4. Repesca: una ronda por cada pausa de lectura.repesca_pausas_min, solo con
     los tickers que siguen sin dato (las clases partidas de iShares se piden
     con guion: BFB -> BF-B).
  5. Tras un lote con bloqueo del proxy se espera lectura.espera_bloqueo_min.

El estado (lotes con sus tiempos, tickers pedidos) se guarda en un JSON por
fecha en rutas.dir_ejecuciones, tras cada lote: si el proceso cae, al
relanzarlo se sigue donde iba y las estadisticas del resumen no se pierden.
"""
import datetime as dt
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from modulos.lector.logica import Lector, timeout_lote_min, url_lote

logger = logging.getLogger(__name__)

FORMATO = "%Y-%m-%dT%H:%M:%S"
MIN_MINUTOS_PARA_LOTE = 1.0


@dataclass
class Lote:
    numero: int
    ronda: int                 # 0 = pasada principal; 1, 2... = repescas
    inicio: str
    fin: str
    n_pedidos: int
    n_guardados: int
    terminada: bool
    bloqueo_proxy: bool
    error: str | None = None

    @property
    def duracion_seg(self) -> float:
        return (dt.datetime.strptime(self.fin, FORMATO) - dt.datetime.strptime(self.inicio, FORMATO)).total_seconds()


@dataclass
class Estado:
    fecha: str                 # AAAA-MM-DD: la de las filas de la tabla
    inicio: str
    limite: str
    n_universo: int = 0
    pedidos: list = field(default_factory=list)     # tickers pedidos al menos una vez
    lotes: list = field(default_factory=list)       # [Lote]
    terminada: bool = False
    email_enviado: bool = False

    @property
    def fecha_date(self) -> dt.date:
        return dt.date.fromisoformat(self.fecha)

    @property
    def limite_dt(self) -> dt.datetime:
        return dt.datetime.strptime(self.limite, FORMATO)

    def a_dict(self) -> dict:
        d = asdict(self)
        d["lotes"] = [asdict(l) if isinstance(l, Lote) else l for l in self.lotes]
        return d

    @classmethod
    def de_dict(cls, d: dict) -> "Estado":
        e = cls(**{k: v for k, v in d.items() if k != "lotes"})
        e.lotes = [Lote(**l) for l in d.get("lotes", [])]
        return e


def ruta_estado(dir_ejecuciones: Path, fecha: str) -> Path:
    return Path(dir_ejecuciones) / f"{fecha}.json"


def guardar_estado(dir_ejecuciones: Path, estado: Estado) -> None:
    ruta = ruta_estado(dir_ejecuciones, estado.fecha)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_suffix(".tmp")
    temporal.write_text(json.dumps(estado.a_dict(), indent=1, ensure_ascii=False), encoding="utf-8")
    temporal.replace(ruta)


def leer_estado(dir_ejecuciones: Path, fecha: str) -> Estado | None:
    ruta = ruta_estado(dir_ejecuciones, fecha)
    if not ruta.exists():
        return None
    return Estado.de_dict(json.loads(ruta.read_text(encoding="utf-8")))


def calcular_limite(inicio: dt.datetime, dia_limite: int, hora_limite: str, max_horas: float) -> dt.datetime:
    """Siguiente dia_limite (ISO) a hora_limite desde inicio, sin pasar de inicio + max_horas."""
    h, m = (int(x) for x in str(hora_limite).split(":"))
    candidato = inicio.replace(hour=h, minute=m, second=0, microsecond=0)
    candidato += dt.timedelta(days=(int(dia_limite) - inicio.isoweekday()) % 7)
    if candidato <= inicio:
        candidato += dt.timedelta(days=7)
    return min(candidato, inicio + dt.timedelta(hours=float(max_horas)))


def iniciar_o_reanudar(config, ahora: dt.datetime) -> Estado:
    """Estado de la ejecucion: reanuda la mas reciente sin terminar si es reciente; si no, una nueva."""
    dir_ej = config.ruta("dir_ejecuciones")
    dias = int(config.get("ventana.dias_reanudar", 2))
    for atras in range(0, dias + 1):
        fecha = (ahora.date() - dt.timedelta(days=atras)).isoformat()
        previo = leer_estado(dir_ej, fecha)
        if previo and not previo.terminada:
            if ahora < previo.limite_dt:
                logger.info("Se reanuda la ejecucion del %s (limite %s)", fecha, previo.limite)
                return previo
            logger.info("La ejecucion sin terminar del %s ya paso su limite: no se reanuda", fecha)
            break
    fecha = ahora.date().isoformat()
    previo = leer_estado(dir_ej, fecha)
    limite = calcular_limite(ahora, config.get("ventana.dia_limite", 7), config.get("ventana.hora_limite", "23:59"),
                             config.get("ventana.duracion_max_horas", 48))
    if previo:   # relanzada el mismo dia tras terminar: completa lo que falte y conserva los lotes
        previo.terminada, previo.email_enviado, previo.limite = False, False, limite.strftime(FORMATO)
        return previo
    return Estado(fecha, ahora.strftime(FORMATO), limite.strftime(FORMATO))


def trocear(lista: list, tamano: int) -> list[list]:
    return [lista[i:i + tamano] for i in range(0, len(lista), tamano)]


class Ejecutor:
    """Recorre los lotes. Reloj y espera inyectables para los tests."""

    def __init__(self, config, lector: Lector, repo, reloj=dt.datetime.now, dormir=time.sleep):
        self.config, self.lector, self.repo = config, lector, repo
        self.reloj, self.dormir = reloj, dormir
        self.p = config.get("lectura")
        self.url = config.exigir("web.url")
        self.dir_ej = config.ruta("dir_ejecuciones")

    def _minutos_restantes(self, estado: Estado) -> float:
        return (estado.limite_dt - self.reloj()).total_seconds() / 60

    def _esperar(self, estado: Estado, minutos: float) -> bool:
        """Espera minutos sin pasar del limite. False si no queda tiempo despues."""
        espera = min(minutos, max(0.0, self._minutos_restantes(estado)))
        if espera > 0:
            logger.info("Pausa de %.1f min", espera)
            self.dormir(espera * 60)
        return self._minutos_restantes(estado) >= MIN_MINUTOS_PARA_LOTE

    def _lote(self, estado: Estado, tickers: list[str], ronda: int) -> Lote:
        timeout = min(timeout_lote_min(len(tickers), self.p), self._minutos_restantes(estado))
        inicio = self.reloj()
        numero = len(estado.lotes) + 1
        logger.info("Lote %d (ronda %d): %d tickers, espera maxima %.0f min", numero, ronda, len(tickers), timeout)
        n_guardados, terminada, bloqueo, error = 0, False, False, None
        try:
            lectura = self.lector.leer(url_lote(self.url, tickers), timeout)
            terminada, bloqueo = lectura.terminada, lectura.bloqueo_proxy
            pedidos = set(tickers)
            filas = [(p.ticker, p.puntos, p.precio) for p in lectura.validas() if p.ticker in pedidos]
            n_guardados = self.repo.guardar(estado.fecha_date, filas)
        except Exception as exc:   # un lote fallido no para la ejecucion: sus tickers van a la repesca
            error = f"{type(exc).__name__}: {exc}"[:500]
            logger.error("Lote %d fallido: %s", numero, error)
        lote = Lote(numero, ronda, inicio.strftime(FORMATO), self.reloj().strftime(FORMATO), len(tickers),
                    n_guardados, terminada, bloqueo, error)
        logger.info("Lote %d: %d de %d con puntos%s", numero, n_guardados, len(tickers),
                    " (BLOQUEO del proxy)" if bloqueo else "")
        estado.lotes.append(lote)
        estado.pedidos = sorted(set(estado.pedidos) | set(tickers))
        guardar_estado(self.dir_ej, estado)
        return lote

    def _ronda(self, estado: Estado, tickers: list[str], ronda: int) -> bool:
        """Lotes de una ronda. False si se alcanzo el limite de la ventana."""
        for trozo in trocear(tickers, int(self.p["tamano_lote"])):
            if self._minutos_restantes(estado) < MIN_MINUTOS_PARA_LOTE:
                logger.warning("Limite de la ventana (%s): no se empiezan mas lotes", estado.limite)
                return False
            lote = self._lote(estado, trozo, ronda)
            if lote.bloqueo_proxy and not self._esperar(estado, float(self.p["espera_bloqueo_min"])):
                return False
        return True

    def ejecutar(self, estado: Estado, universo: list[str], alias: dict) -> Estado:
        estado.n_universo = len(universo)
        guardar_estado(self.dir_ej, estado)
        hechos = self.repo.tickers_con_dato(estado.fecha_date)
        pendientes = [t for t in universo if t not in hechos and alias.get(t) not in hechos]
        logger.info("Ejecucion %s: %d tickers, %d ya con dato, %d pendientes", estado.fecha, len(universo),
                    len(universo) - len(pendientes), len(pendientes))
        sigue = self._ronda(estado, pendientes, 0)
        for ronda, pausa in enumerate(self.p.get("repesca_pausas_min") or [], start=1):
            hechos = self.repo.tickers_con_dato(estado.fecha_date)
            faltan = [alias.get(t, t) for t in universo if t not in hechos and alias.get(t) not in hechos]
            if not sigue or not faltan:
                break
            logger.info("Repesca %d: %d tickers sin dato", ronda, len(faltan))
            if not self._esperar(estado, float(pausa)):
                break
            sigue = self._ronda(estado, faltan, ronda)
        estado.terminada = True
        guardar_estado(self.dir_ej, estado)
        return estado


def recuento(estado: Estado, universo: list[str], alias: dict, hechos: set[str]) -> dict:
    """
    Tickers del universo con puntos en la fecha, pedidos sin ficha (tampoco en
    la repesca) y no procesados porque se acabo la ventana.
    """
    pedidos = set(estado.pedidos)
    con, sin = 0, 0
    for t in universo:
        if t in hechos or alias.get(t) in hechos:
            con += 1
        elif t in pedidos or alias.get(t) in pedidos:
            sin += 1
    return {"n_universo": len(universo), "n_con_puntos": con, "n_sin_ficha": sin,
            "n_no_procesados": len(universo) - con - sin}
