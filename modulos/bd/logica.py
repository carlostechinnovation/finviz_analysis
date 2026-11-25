"""
Persistencia de los puntos de solvencia (diseno_informatico.md 7).

Interfaz Repositorio con dos implementaciones y la factoria crear_repositorio:
  - RepositorioMariaDB: schema bd.database (finvizanalysis), tabla bd.tabla
    (solvencia). Crea schema y tabla si no existen (sql/crear_solvencia.sql).
  - RepositorioMemoria: para los tests (misma semantica, sin base de datos).

guardar() es idempotente: repetir un ticker en la misma fecha lo sustituye
(clave primaria fecha + ticker), lo que permite reanudar una ejecucion.
"""
import datetime as dt
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import quote_plus

import pandas as pd

logger = logging.getLogger(__name__)

COLUMNAS = ["fecha", "ticker", "puntos_solvencia", "precio"]
RUTA_SQL_CREAR = Path(__file__).resolve().parents[2] / "sql" / "crear_solvencia.sql"


class Repositorio(ABC):
    @abstractmethod
    def asegurar_tabla(self) -> None:
        """Crea schema y tabla si no existen."""

    @abstractmethod
    def guardar(self, fecha: dt.date, filas: list[tuple]) -> int:
        """filas: [(ticker, puntos, precio|None)]. Devuelve cuantas se escribieron."""

    @abstractmethod
    def tickers_con_dato(self, fecha: dt.date) -> set[str]:
        """Tickers ya guardados en esa fecha."""

    @abstractmethod
    def fecha_mas_reciente(self) -> dt.date | None:
        """La fecha mas reciente con algun dato, o None si la tabla esta vacia."""

    @abstractmethod
    def historico(self) -> pd.DataFrame:
        """Toda la tabla: columnas COLUMNAS, fecha como Timestamp."""

    @abstractmethod
    def tamano_bytes(self) -> int | None:
        """Espacio ocupado por la tabla (datos + indices), o None si no se sabe."""


def _df(registros) -> pd.DataFrame:
    df = pd.DataFrame(list(registros), columns=COLUMNAS)
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["puntos_solvencia"] = pd.to_numeric(df["puntos_solvencia"], errors="coerce").astype(float)
    df["precio"] = pd.to_numeric(df["precio"], errors="coerce").astype(float)
    return df.sort_values(["ticker", "fecha"]).reset_index(drop=True)


class RepositorioMemoria(Repositorio):
    def __init__(self, registros: list[tuple] | None = None):
        self.datos = {}   # (fecha, ticker) -> (puntos, precio)
        for fecha, ticker, puntos, precio in registros or []:
            self.datos[(pd.Timestamp(fecha).date(), ticker)] = (puntos, precio)

    def asegurar_tabla(self) -> None:
        pass

    def guardar(self, fecha, filas) -> int:
        for ticker, puntos, precio in filas:
            self.datos[(fecha, ticker)] = (puntos, precio)
        return len(filas)

    def tickers_con_dato(self, fecha) -> set[str]:
        return {t for (f, t) in self.datos if f == fecha}

    def fecha_mas_reciente(self) -> dt.date | None:
        return max((f for f, _ in self.datos), default=None)

    def historico(self) -> pd.DataFrame:
        return _df((f, t, p, pr) for (f, t), (p, pr) in self.datos.items())

    def tamano_bytes(self) -> int | None:
        return None


class RepositorioMariaDB(Repositorio):
    def __init__(self, credenciales: dict, schema: str, tabla: str):
        from sqlalchemy import create_engine
        self.schema, self.tabla = schema, tabla
        url = (f"mysql+pymysql://{quote_plus(credenciales['user'])}:{quote_plus(credenciales['password'])}"
               f"@{credenciales['host']}:{credenciales['port']}/?charset=utf8mb4")
        self.motor = create_engine(url, pool_pre_ping=True)

    @property
    def _nombre(self) -> str:
        return f"`{self.schema}`.`{self.tabla}`"

    def asegurar_tabla(self) -> None:
        from sqlalchemy import text
        sql = RUTA_SQL_CREAR.read_text(encoding="utf-8").format(schema=self.schema, tabla=self.tabla)
        sentencias = [s.strip() for s in "\n".join(
            ln for ln in sql.splitlines() if not ln.strip().startswith("--")).split(";") if s.strip()]
        with self.motor.begin() as con:
            for s in sentencias:
                con.execute(text(s))

    def guardar(self, fecha, filas) -> int:
        if not filas:
            return 0
        from sqlalchemy import text
        sql = text(f"INSERT INTO {self._nombre} (fecha, ticker, puntos_solvencia, precio) "
                   f"VALUES (:f, :t, :p, :pr) ON DUPLICATE KEY UPDATE "
                   f"puntos_solvencia = VALUES(puntos_solvencia), precio = VALUES(precio)")
        with self.motor.begin() as con:
            con.execute(sql, [{"f": fecha, "t": t, "p": p, "pr": pr} for t, p, pr in filas])
        return len(filas)

    def tickers_con_dato(self, fecha) -> set[str]:
        from sqlalchemy import text
        with self.motor.connect() as con:
            filas = con.execute(text(f"SELECT ticker FROM {self._nombre} WHERE fecha = :f"), {"f": fecha})
            return {r[0] for r in filas}

    def fecha_mas_reciente(self) -> dt.date | None:
        from sqlalchemy import text
        with self.motor.connect() as con:
            fecha = con.execute(text(f"SELECT MAX(fecha) FROM {self._nombre}")).scalar()
        return pd.Timestamp(fecha).date() if fecha is not None else None

    def historico(self) -> pd.DataFrame:
        from sqlalchemy import text
        with self.motor.connect() as con:
            filas = con.execute(text(f"SELECT fecha, ticker, puntos_solvencia, precio FROM {self._nombre}"))
            return _df(tuple(r) for r in filas)

    def tamano_bytes(self) -> int | None:
        from sqlalchemy import text
        with self.motor.connect() as con:
            fila = con.execute(text(
                "SELECT COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t"), {"s": self.schema, "t": self.tabla}).first()
        return int(fila[0]) if fila else None


def crear_repositorio(config) -> Repositorio:
    """Factoria: MariaDB con las credenciales de secretos y el schema de este proyecto."""
    return RepositorioMariaDB(config.credenciales_bd, config.exigir("bd.database"), config.exigir("bd.tabla"))
