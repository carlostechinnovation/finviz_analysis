"""
Ciclo semanal por lotes con lanzamiento diario (diseno_informatico.md 6.1).

  1. Decision (decidir): con F = la fecha mas reciente de la tabla,
       - sin datos o F con ciclo.dias dias o mas            -> ciclo NUEVO con fecha de hoy;
       - si no, y el log termina en "CICLO TERMINADO F"     -> NADA que hacer;
       - si no (error, corte o sin log)                     -> REANUDAR el ciclo F.
  2. Limite del lanzamiento: ahora + ciclo.duracion_max_horas. A partir de el
     no se empieza ningun lote; el ciclo queda sin terminar y lo reanuda el
     siguiente lanzamiento.
  3. Pasada principal: los tickers del universo sin dato en esa fecha y que el
     log no da como ya pedidos en la pasada principal, en lotes de
     lectura.tamano_lote. Cada lote se guarda en BD al terminar y deja una
     linea TICKER por ticker en el log (modulos/registro).
  4. Repesca: una ronda por cada pausa de lectura.repesca_pausas_min, solo con
     los tickers que siguen sin dato (las clases partidas de iShares se piden
     con guion: BFB -> BF-B).
  5. Tras un lote con bloqueo del proxy se espera lectura.espera_bloqueo_min.

El JSON de estado por fecha (rutas.dir_ejecuciones) solo guarda las
estadisticas del informe (lotes con sus tiempos, tickers pedidos): la
decision y el punto de reanudacion salen de la tabla y del log.
"""
import datetime as dt
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from modulos.lector.logica import Lector, timeout_lote_min, url_lote
from modulos.registro import logica as registro

logger = logging.getLogger(__name__)

FORMATO = "%Y-%m-%dT%H:%M:%S"
MIN_MINUTOS_PARA_LOTE = 1.0
NUEVO, REANUDAR, NADA = "nuevo", "reanudar", "nada"


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
    fecha: str                 # AAAA-MM-DD: la de las filas de la tabla (inicio del ciclo)
    inicio: str                # primer lanzamiento del ciclo
    limite: str                # limite del lanzamiento en curso
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


# ----------------------------------------------------------------- decision
@dataclass
class Decision:
    accion: str                # NUEVO, REANUDAR o NADA
    fecha: dt.date             # la del ciclo nuevo o la del ciclo a reanudar / ya terminado
    motivo: str


def decidir(fecha_reciente: dt.date | None, lineas_log: list[str], hoy: dt.date, dias_ciclo: int) -> Decision:
    """Que hace este lanzamiento, a partir de la fecha mas reciente de la tabla y del log principal."""
    if fecha_reciente is None:
        return Decision(NUEVO, hoy, "la tabla no tiene datos")
    edad = (hoy - fecha_reciente).days
    if edad >= dias_ciclo:
        motivo = f"el dato mas reciente ({fecha_reciente}) tiene {edad} dias (>= {dias_ciclo})"
        if not registro.ciclo_terminado(lineas_log, fecha_reciente):
            motivo += f"; el ciclo {fecha_reciente} quedo sin terminar y se abandona"
        return Decision(NUEVO, hoy, motivo)
    if registro.ciclo_terminado(lineas_log, fecha_reciente):
        return Decision(NADA, fecha_reciente,
                        f"el ciclo {fecha_reciente} ya termino; el siguiente empieza el "
                        f"{fecha_reciente + dt.timedelta(days=dias_ciclo)}")
    ultima = registro.ultima_linea(lineas_log) or "(log vacio o inexistente)"
    return Decision(REANUDAR, fecha_reciente, f"el ciclo {fecha_reciente} no termino; ultima linea del log: {ultima}")


def preparar_estado(config, decision: Decision, ahora: dt.datetime, pedidos_log: set) -> Estado:
    """Estado del lanzamiento: nuevo, o el JSON del ciclo a reanudar (creado si falta), con el limite de hoy."""
    limite = (ahora + dt.timedelta(hours=float(config.get("ciclo.duracion_max_horas", 22)))).strftime(FORMATO)
    fecha = decision.fecha.isoformat()
    previo = leer_estado(config.ruta("dir_ejecuciones"), fecha) if decision.accion == REANUDAR else None
    if previo is None:
        estado = Estado(fecha, ahora.strftime(FORMATO), limite)
    else:
        estado = previo
        estado.limite, estado.terminada, estado.email_enviado = limite, False, False
    estado.pedidos = sorted(set(estado.pedidos) | set(pedidos_log))
    return estado


def trocear(lista: list, tamano: int) -> list[list]:
    return [lista[i:i + tamano] for i in range(0, len(lista), tamano)]


def _resultado_ticker(p) -> tuple[str, str]:
    """(RESULTADO, detalle) de la linea TICKER de una casilla leida."""
    if p is None:
        return registro.NO_LEIDO, ""
    if p.valida:
        return registro.GUARDADO, f"puntos={p.puntos:g} precio={'' if p.precio is None else f'{p.precio:g}'}"
    if p.sin_ficha:
        return registro.SIN_FICHA, f"motivo={p.motivo or ''}"
    return registro.NO_GUARDADO, f"dilucion={p.dilucion or ''} puntos={'' if p.puntos is None else f'{p.puntos:g}'}"


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
            for t in tickers:   # tras guardar: GUARDADO solo si ya esta en la tabla
                logger.info(registro.linea_ticker(t, ronda, *_resultado_ticker(lectura.puntuaciones.get(t))))
        except Exception as exc:   # un lote fallido no para la ejecucion: sus tickers van a la repesca
            error = f"{type(exc).__name__}: {exc}"[:500]
            logger.error("Lote %d fallido: %s", numero, error)
            for t in tickers:
                logger.info(registro.linea_ticker(t, ronda, registro.ERROR_LOTE))
        lote = Lote(numero, ronda, inicio.strftime(FORMATO), self.reloj().strftime(FORMATO), len(tickers),
                    n_guardados, terminada, bloqueo, error)
        logger.info("Lote %d: %d de %d con puntos%s", numero, n_guardados, len(tickers),
                    " (BLOQUEO del proxy)" if bloqueo else "")
        estado.lotes.append(lote)
        estado.pedidos = sorted(set(estado.pedidos) | set(tickers))
        guardar_estado(self.dir_ej, estado)
        return lote

    def _ronda(self, estado: Estado, tickers: list[str], ronda: int) -> bool:
        """Lotes de una ronda. False si se alcanzo el limite del lanzamiento."""
        for trozo in trocear(tickers, int(self.p["tamano_lote"])):
            if self._minutos_restantes(estado) < MIN_MINUTOS_PARA_LOTE:
                logger.warning("Limite del lanzamiento (%s): no se empiezan mas lotes", estado.limite)
                return False
            lote = self._lote(estado, trozo, ronda)
            if lote.bloqueo_proxy and not self._esperar(estado, float(self.p["espera_bloqueo_min"])):
                return False
        return True

    def ejecutar(self, estado: Estado, universo: list[str], alias: dict, ya_pedidos=frozenset()) -> Estado:
        """
        ya_pedidos: tickers que el log da como pedidos en la pasada principal de
        este ciclo (reanudacion); no se repiten en ella, pero si en la repesca.
        estado.terminada queda False si se alcanzo el limite del lanzamiento.
        """
        estado.n_universo = len(universo)
        guardar_estado(self.dir_ej, estado)
        hechos = self.repo.tickers_con_dato(estado.fecha_date)
        con_dato = {t for t in universo if t in hechos or alias.get(t) in hechos}
        pendientes = [t for t in universo if t not in con_dato and t not in ya_pedidos]
        logger.info("Ciclo %s: %d tickers, %d ya con dato, %d ya pedidos sin dato (van a la repesca), "
                    "%d pendientes en la pasada principal", estado.fecha, len(universo), len(con_dato),
                    len(universo) - len(con_dato) - len(pendientes), len(pendientes))
        completo = self._ronda(estado, pendientes, 0)
        for ronda, pausa in enumerate(self.p.get("repesca_pausas_min") or [], start=1):
            hechos = self.repo.tickers_con_dato(estado.fecha_date)
            faltan = [alias.get(t, t) for t in universo if t not in hechos and alias.get(t) not in hechos]
            if not completo or not faltan:
                break
            logger.info("Repesca %d: %d tickers sin dato", ronda, len(faltan))
            if not self._esperar(estado, float(pausa)):
                completo = False
                break
            completo = self._ronda(estado, faltan, ronda)
        estado.terminada = completo
        guardar_estado(self.dir_ej, estado)
        return estado


def recuento(estado: Estado, universo: list[str], alias: dict, hechos: set[str]) -> dict:
    """
    Tickers del universo con puntos en la fecha, pedidos sin ficha (tampoco en
    la repesca) y no procesados (no se llegaron a pedir).
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
