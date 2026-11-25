"""
Analisis del historico de puntos de solvencia (diseno_funcional.md 9.4-9.7).

Todo trabaja sobre un DataFrame con columnas fecha, ticker, puntos_solvencia
y precio (modulos/bd/logica.py), sin tocar la base de datos.

  - detalle(): una fila por ticker con su ultimo dato y los diff_* en %.
  - estadisticas_puntos(), movimientos(): puntuaciones de la ultima ejecucion
    y los que mas suben y bajan entre las dos ultimas ejecuciones.
  - correlaciones(): Spearman por empresa entre la variacion semanal de los
    puntos y la del precio (predictiva: semana siguiente; y simultanea), con
    correccion de Benjamini-Hochberg, mas la correlacion conjunta.
"""
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats

# Horizonte -> desplazamiento hacia atras desde el ultimo dato de cada ticker
HORIZONTES = {
    "diff_last_week": pd.DateOffset(days=7),
    "diff_last_month": pd.DateOffset(months=1),
    "diff_last_3_months": pd.DateOffset(months=3),
    "diff_last_6_months": pd.DateOffset(months=6),
    "diff_last_9_months": pd.DateOffset(months=9),
    "diff_last_12_months": pd.DateOffset(months=12),
}
COLUMNA_CORRELACION = "corr_puntos_precio"


def variacion_pct(actual, referencia):
    """(actual - referencia) / |referencia| * 100; NaN si la referencia es 0 o falta."""
    actual = pd.to_numeric(pd.Series(actual), errors="coerce").astype(float)
    referencia = pd.to_numeric(pd.Series(referencia), errors="coerce").astype(float).reset_index(drop=True)
    actual = actual.reset_index(drop=True)
    base = referencia.abs().where(referencia != 0)
    return (actual - referencia) / base * 100


def ultimos(df: pd.DataFrame) -> pd.DataFrame:
    """Ultimo dato conocido de cada ticker."""
    if df.empty:
        return df.copy()
    return df.sort_values("fecha").groupby("ticker", as_index=False).tail(1).reset_index(drop=True)


def detalle(df: pd.DataFrame, tolerancia_dias: int) -> pd.DataFrame:
    """
    Una fila por ticker: ticker, puntos_solvencia y fecha de su ultimo dato y
    los diff_* respecto al dato mas reciente con fecha <= ultima - horizonte
    (y no mas de tolerancia_dias anterior a esa fecha objetivo). Ordenado por
    diff_last_week descendente, sin dato al final.
    """
    columnas = ["ticker", "puntos_solvencia", "fecha", *HORIZONTES]
    if df.empty:
        return pd.DataFrame(columns=columnas)
    ult = ultimos(df)[["ticker", "fecha", "puntos_solvencia"]]
    derecha = df[["ticker", "fecha", "puntos_solvencia"]].rename(
        columns={"fecha": "fecha_ref", "puntos_solvencia": "puntos_ref"}).sort_values("fecha_ref")
    salida = ult.copy()
    for nombre, desplazamiento in HORIZONTES.items():
        izq = ult.assign(objetivo=ult["fecha"] - desplazamiento).sort_values("objetivo")
        cruce = pd.merge_asof(izq, derecha, left_on="objetivo", right_on="fecha_ref", by="ticker",
                              direction="backward", tolerance=pd.Timedelta(days=tolerancia_dias))
        cruce[nombre] = variacion_pct(cruce["puntos_solvencia"], cruce["puntos_ref"]).values
        salida = salida.merge(cruce[["ticker", nombre]], on="ticker", how="left")
    salida = salida.sort_values(["diff_last_week", "ticker"], ascending=[False, True], na_position="last")
    return salida[columnas].reset_index(drop=True)


def fechas_ejecucion(df: pd.DataFrame) -> list:
    return sorted(df["fecha"].unique()) if not df.empty else []


def _resumen(serie: pd.Series) -> dict:
    s = serie.dropna().astype(float)
    return {"n": int(len(s)),
            "min": float(s.min()) if len(s) else math.nan,
            "media": float(s.mean()) if len(s) else math.nan,
            "max": float(s.max()) if len(s) else math.nan,
            "desv": float(s.std(ddof=1)) if len(s) > 1 else math.nan}


def estadisticas(valores) -> dict:
    """n, min, media, max y desviacion tipica muestral."""
    return _resumen(pd.Series(list(valores), dtype=float))


def estadisticas_puntos(df: pd.DataFrame, umbral: float) -> dict:
    """Puntuaciones de la ultima ejecucion y cuantas llegan al umbral."""
    fechas = fechas_ejecucion(df)
    if not fechas:
        return {**_resumen(pd.Series(dtype=float)), "n_umbral": 0, "fecha": None}
    ultima = df[df["fecha"] == fechas[-1]]["puntos_solvencia"]
    return {**_resumen(ultima), "n_umbral": int((ultima >= umbral).sum()), "fecha": pd.Timestamp(fechas[-1])}


def movimientos(df: pd.DataFrame, n: int) -> dict:
    """
    Entre la ultima y la penultima ejecucion (fechas de la tabla), solo tickers
    con dato en las dos: los n que mas suben (diferencia en puntos > 0) y los n
    que mas bajan (< 0), con su variacion en %.
    """
    fechas = fechas_ejecucion(df)
    vacio = pd.DataFrame(columns=["ticker", "puntos_antes", "puntos_ahora", "dif_puntos", "dif_pct"])
    if len(fechas) < 2:
        return {"suben": vacio, "bajan": vacio, "fechas": tuple(pd.Timestamp(f) for f in fechas)}
    antes = df[df["fecha"] == fechas[-2]][["ticker", "puntos_solvencia"]].rename(columns={"puntos_solvencia": "puntos_antes"})
    ahora = df[df["fecha"] == fechas[-1]][["ticker", "puntos_solvencia"]].rename(columns={"puntos_solvencia": "puntos_ahora"})
    m = antes.merge(ahora, on="ticker")
    m["dif_puntos"] = m["puntos_ahora"] - m["puntos_antes"]
    m["dif_pct"] = variacion_pct(m["puntos_ahora"], m["puntos_antes"]).values
    suben = m[m["dif_puntos"] > 0].sort_values(["dif_puntos", "ticker"], ascending=[False, True]).head(n)
    bajan = m[m["dif_puntos"] < 0].sort_values(["dif_puntos", "ticker"], ascending=[True, True]).head(n)
    return {"suben": suben.reset_index(drop=True), "bajan": bajan.reset_index(drop=True),
            "fechas": (pd.Timestamp(fechas[-2]), pd.Timestamp(fechas[-1]))}


def pares_semanales(serie: pd.DataFrame, max_hueco_dias: int) -> pd.DataFrame:
    """
    Pasos semanales de un ticker (ordenado por fecha): dp = variacion de puntos,
    r = rentabilidad del precio en el mismo paso y r_sig = la del paso
    siguiente (NaN si el siguiente no es consecutivo o falta el precio).
    """
    s = serie.sort_values("fecha").reset_index(drop=True)
    hueco = s["fecha"].diff().dt.days
    valido = hueco.notna() & (hueco <= max_hueco_dias)
    dp = s["puntos_solvencia"].diff().where(valido)
    precio = s["precio"].where(s["precio"] > 0)
    r = (precio / precio.shift(1) - 1).where(valido)
    pasos = pd.DataFrame({"fecha": s["fecha"], "dp": dp, "r": r})
    pasos["r_sig"] = pasos["r"].shift(-1)
    return pasos[valido].reset_index(drop=True)


def benjamini_hochberg(p_valores, alfa: float) -> np.ndarray:
    """Mascara de descubrimientos con control de la tasa de falsos descubrimientos (BH, 1995)."""
    p = np.asarray(p_valores, dtype=float)
    n = len(p)
    if n == 0:
        return np.zeros(0, dtype=bool)
    orden = np.argsort(p)
    limites = alfa * np.arange(1, n + 1) / n
    pasan = p[orden] <= limites
    k = np.max(np.nonzero(pasan)[0]) + 1 if pasan.any() else 0
    mascara = np.zeros(n, dtype=bool)
    mascara[orden[:k]] = True
    return mascara


def _spearman(x: pd.Series, y: pd.Series, min_pares: int):
    ok = x.notna() & y.notna()
    x, y = x[ok], y[ok]
    if len(x) < min_pares or x.nunique() < 2 or y.nunique() < 2:
        return math.nan, math.nan, int(len(x))
    rho, p = stats.spearmanr(x, y)
    return float(rho), float(p), int(len(x))


@dataclass
class Correlaciones:
    por_ticker: pd.DataFrame                        # ticker, rho, p, n, significativa (predictiva)
    n_ejecuciones: int = 0
    min_pares: int = 0
    predictiva: dict = field(default_factory=dict)  # resumen de la predictiva
    simultanea: dict = field(default_factory=dict)  # resumen de la simultanea

    @property
    def suficientes(self) -> bool:
        return self.predictiva.get("n_empresas", 0) > 0


def _resumen_correlacion(tabla: pd.DataFrame, todos: pd.DataFrame, columna_r: str, alfa: float,
                         min_pares: int) -> tuple[dict, pd.DataFrame]:
    validas = tabla.dropna(subset=["rho"]).copy()
    validas["significativa"] = benjamini_hochberg(validas["p"].values, alfa) if len(validas) else []
    rho_c, p_c, n_c = _spearman(todos["dp"], todos[columna_r], max(min_pares, 3))
    resumen = {
        "n_empresas": int(len(validas)),
        "mediana": float(validas["rho"].median()) if len(validas) else math.nan,
        "pct_positivas": float((validas["rho"] > 0).mean() * 100) if len(validas) else math.nan,
        "n_signif_pos": int((validas["significativa"] & (validas["rho"] > 0)).sum()) if len(validas) else 0,
        "n_signif_neg": int((validas["significativa"] & (validas["rho"] < 0)).sum()) if len(validas) else 0,
        "conjunta_rho": rho_c, "conjunta_p": p_c, "conjunta_n": n_c,
    }
    return resumen, validas


def correlaciones(df: pd.DataFrame, min_pares: int, max_hueco_dias: int, alfa: float) -> Correlaciones:
    """
    Para cada empresa, Spearman entre dp (variacion semanal de puntos) y:
      - r_sig: rentabilidad de la semana SIGUIENTE (predictiva: si la
        puntuacion sube, sube despues el precio?). Es la que se publica por
        empresa (columna corr_puntos_precio);
      - r: rentabilidad de la MISMA semana (simultanea), solo de referencia:
        varios criterios del screener dependen del propio precio.
    """
    filas_pred, filas_sim, todos = [], [], []
    for ticker, serie in df.groupby("ticker"):
        pasos = pares_semanales(serie, max_hueco_dias)
        todos.append(pasos)
        filas_pred.append((ticker, *_spearman(pasos["dp"], pasos["r_sig"], min_pares)))
        filas_sim.append((ticker, *_spearman(pasos["dp"], pasos["r"], min_pares)))
    columnas = ["ticker", "rho", "p", "n"]
    pred = pd.DataFrame(filas_pred, columns=columnas)
    sim = pd.DataFrame(filas_sim, columns=columnas)
    todos_df = pd.concat(todos, ignore_index=True) if todos else pd.DataFrame(columns=["dp", "r", "r_sig"])
    resumen_pred, validas_pred = _resumen_correlacion(pred, todos_df, "r_sig", alfa, min_pares)
    resumen_sim, _ = _resumen_correlacion(sim, todos_df, "r", alfa, min_pares)
    por_ticker = pred.merge(validas_pred[["ticker", "significativa"]], on="ticker", how="left")
    return Correlaciones(por_ticker, len(fechas_ejecucion(df)), min_pares, resumen_pred, resumen_sim)
