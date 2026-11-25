"""
Informe de cada ejecucion semanal (diseno_funcional.md 9.5-9.6):

  - adjunto HTML autocontenido: titulo, subtitulo, inicio y fin de la
    ejecucion (primera y ultima descarga de empresa) y la tabla de DETALLE,
    una fila por ticker, ordenada por diff_last_week descendente;
  - cuerpo del email (HTML y texto plano): el resumen ejecutivo.

Colores de la tabla de detalle:
  - puntos >= umbral: escala de verdes, mas intensa cuantos mas puntos (del
    umbral al maximo teorico); por debajo: fondo gris claro y "(poco)";
  - diff_*: rojos si son negativos y verdes si son positivos, mas intensos
    cuanto mayor es |diff|, saturando en analisis.saturacion_diff_pct.
"""
import datetime as dt
import math
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from html import escape
from urllib.parse import quote

import pandas as pd

from modulos.analisis.logica import COLUMNA_CORRELACION, HORIZONTES, Correlaciones
from modulos.espacio.logica import texto_tamano

BLANCO = (255, 255, 255)
VERDE_CLARO, VERDE_OSCURO = (226, 244, 224), (27, 122, 53)
ROJO_OSCURO = (183, 28, 28)
GRIS_CLARO = "#ececec"
SUFIJO_POCO = " (poco)"


# ----------------------------------------------------------------- formatos
def _redondear(x: float, decimales: int) -> Decimal:
    return Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)


def _vacio(x) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x)) or pd.isna(x)


def numero(x, decimales: int = 2) -> str:
    """17.256 -> '17,26' (coma decimal, punto de miles). Vacio si no hay dato."""
    if _vacio(x):
        return ""
    texto = f"{_redondear(x, decimales):,.{decimales}f}"
    return texto.replace(",", "_").replace(".", ",").replace("_", ".")


def porcentaje(x) -> str:
    """Siempre con 1 decimal y signo: 3.04 -> '+3,0 %', -0.04 -> '0,0 %'. Vacio si no hay dato."""
    if _vacio(x):
        return ""
    r = _redondear(x, 1)
    if r == 0:
        return "0,0 %"
    return ("+" if r > 0 else "") + numero(float(r), 1) + " %"


def duracion(segundos) -> str:
    if _vacio(segundos):
        return ""
    s = int(round(float(segundos)))
    h, resto = divmod(s, 3600)
    m, s = divmod(resto, 60)
    return f"{h} h {m:02d} min" if h else (f"{m} min {s:02d} s" if m else f"{s} s")


def fecha_hora(texto: str | None) -> str:
    return texto.replace("T", " ") if texto else "—"


# ------------------------------------------------------------------ colores
def _mezcla(a, b, t: float) -> tuple:
    t = min(1.0, max(0.0, t))
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def _hex(rgb) -> str:
    return "#%02x%02x%02x" % rgb


def _texto_sobre(rgb) -> str:
    luminancia = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    return "#ffffff" if luminancia < 140 else "#1a1a1a"


def estilo_puntos(puntos, umbral: float, maximo: float) -> tuple[str, str]:
    """(estilo CSS, texto) de la celda de puntos."""
    if _vacio(puntos):
        return "", ""
    if puntos < umbral:
        return f"background:{GRIS_CLARO};color:#555", numero(puntos) + SUFIJO_POCO
    t = (puntos - umbral) / (maximo - umbral) if maximo > umbral else 1.0
    fondo = _mezcla(VERDE_CLARO, VERDE_OSCURO, t)
    return f"background:{_hex(fondo)};color:{_texto_sobre(fondo)}", numero(puntos)


def estilo_diff(valor, saturacion: float) -> tuple[str, str]:
    """(estilo CSS, texto) de una celda diff_*: verde si > 0, rojo si < 0."""
    if _vacio(valor):
        return "", ""
    destino = VERDE_OSCURO if valor > 0 else ROJO_OSCURO
    fondo = _mezcla(BLANCO, destino, abs(valor) / saturacion if saturacion else 1.0)
    return f"background:{_hex(fondo)};color:{_texto_sobre(fondo)}", porcentaje(valor)


# ------------------------------------------------------------------ resumen
@dataclass
class Resumen:
    """Todo lo que cuenta el informe de una ejecucion."""
    titulo: str
    subtitulo: str
    fecha: str
    inicio_descargas: str | None
    fin_descargas: str | None
    recuento: dict              # n_universo, n_con_puntos, n_sin_ficha, n_no_procesados
    duraciones: dict            # total_seg, lotes: {n, min, media, max, desv} en segundos
    n_bloqueos: int
    puntos: dict                # estadisticas_puntos
    movimientos: dict           # analisis.movimientos
    correlaciones: Correlaciones
    detalle: pd.DataFrame       # analisis.detalle + corr_puntos_precio
    tamano_dir: int | None
    tamano_tabla: int | None
    umbral: float
    maximo: float
    saturacion: float
    url_web: str = ""
    avisos: list = field(default_factory=list)


def _tabla_html(cabeceras: list[str], filas: list[list[str]]) -> str:
    th = "".join(f"<th>{escape(c)}</th>" for c in cabeceras)
    cuerpo = "".join("<tr>" + "".join(f"<td>{escape(str(c))}</td>" for c in f) + "</tr>" for f in filas)
    return f'<table class="resumen"><tr>{th}</tr>{cuerpo}</table>'


def _filas_movimientos(df: pd.DataFrame) -> list[list[str]]:
    return [[r.ticker, numero(r.puntos_antes), numero(r.puntos_ahora),
             ("+" if r.dif_puntos > 0 else "") + numero(r.dif_puntos), porcentaje(r.dif_pct)]
            for r in df.itertuples()]


def _texto_correlacion(c: Correlaciones) -> list[str]:
    """Lineas (texto plano) del estudio de correlacion."""
    if not c.suficientes:
        return [f"Datos insuficientes: hay {c.n_ejecuciones} ejecuciones semanales y cada empresa necesita "
                f"{c.min_pares} pares de semanas consecutivas ({c.min_pares + 2} ejecuciones seguidas) para "
                f"calcular su correlación."]
    p, s = c.predictiva, c.simultanea
    lineas = [
        f"Predictiva (variación de los puntos en una semana frente a la del precio la semana siguiente): "
        f"{p['n_empresas']} empresas con datos suficientes; mediana de rho de Spearman "
        f"{numero(p['mediana'])}; {numero(p['pct_positivas'], 1)} % con rho > 0; significativas "
        f"tras Benjamini-Hochberg: {p['n_signif_pos']} positivas y {p['n_signif_neg']} negativas.",
        f"Conjunta (todos los pares de todas las empresas): rho {numero(p['conjunta_rho'])}, "
        f"p = {numero(p['conjunta_p'], 4)}, n = {p['conjunta_n']}.",
        f"Simultánea (misma semana, solo de referencia: varios criterios dependen del precio): mediana "
        f"de rho {numero(s['mediana'])}; conjunta {numero(s['conjunta_rho'])} (n = {s['conjunta_n']}).",
    ]
    return lineas


def _conclusion(c: Correlaciones) -> str:
    if not c.suficientes:
        return ""
    p = c.predictiva
    if p["n_signif_pos"] == 0 and p["n_signif_neg"] == 0 and (_vacio(p["conjunta_p"]) or p["conjunta_p"] >= 0.05):
        return ("Por ahora no hay evidencia de que una subida de la puntuación vaya seguida de una subida "
                "del precio.")
    signo = "positiva" if (p["conjunta_rho"] or 0) > 0 else "negativa"
    return (f"La relación conjunta es {signo}; revisa las empresas significativas en la columna "
            f"{COLUMNA_CORRELACION} del adjunto.")


def lineas_resumen(r: Resumen) -> list[tuple[str, list]]:
    """Secciones del resumen ejecutivo: [(titulo, [lineas o ('tabla', cabeceras, filas)])]."""
    rc, du, pu, mv = r.recuento, r.duraciones, r.puntos, r.movimientos
    lotes = du["lotes"]
    secciones = [
        ("Ejecución", [
            f"Fecha de la ejecución: {r.fecha}. Primera descarga: {fecha_hora(r.inicio_descargas)}; "
            f"última: {fecha_hora(r.fin_descargas)}.",
            f"Tickers pedidos: {rc['n_universo']}. Con puntos: {rc['n_con_puntos']}. Sin ficha de Finviz: "
            f"{rc['n_sin_ficha']}." + (f" No procesados (no se llegaron a pedir): {rc['n_no_procesados']}."
                                       if rc["n_no_procesados"] else ""),
            f"Duración total: {duracion(du['total_seg']) or '—'}. Por lote ({lotes['n']} lotes): mínima "
            f"{duracion(lotes['min']) or '—'}, media {duracion(lotes['media']) or '—'}, máxima "
            f"{duracion(lotes['max']) or '—'}, desviación típica {duracion(lotes['desv']) or '—'}.",
            f"Bloqueos del proxy r.jina.ai: {r.n_bloqueos}.",
        ]),
        ("Puntuaciones de la última ejecución", [
            f"Mínimo {numero(pu['min'])}, media {numero(pu['media'])}, máximo {numero(pu['max'])}, "
            f"desviación típica {numero(pu['desv'])} (n = {pu['n']}).",
            f"Con {numero(r.umbral, 0)} puntos o más: {pu['n_umbral']} de {pu['n']}.",
        ]),
    ]
    cab = ["Ticker", "Puntos antes", "Puntos ahora", "Dif. puntos", "Dif. %"]
    if len(mv["fechas"]) == 2:
        periodo = f"entre {mv['fechas'][0]:%Y-%m-%d} y {mv['fechas'][1]:%Y-%m-%d}"
        secciones.append((f"Top {len(mv['suben'])} que más suben ({periodo})",
                          [("tabla", cab, _filas_movimientos(mv["suben"]))] if len(mv["suben"]) else ["Ninguna sube."]))
        secciones.append((f"Bottom {len(mv['bajan'])} que más bajan ({periodo})",
                          [("tabla", cab, _filas_movimientos(mv["bajan"]))] if len(mv["bajan"]) else ["Ninguna baja."]))
    else:
        secciones.append(("Top y bottom 10", ["Hace falta una segunda ejecución para comparar."]))
    correlacion = _texto_correlacion(r.correlaciones)
    if _conclusion(r.correlaciones):
        correlacion.append(_conclusion(r.correlaciones))
    secciones.append(("¿Si la puntuación sube, sube el precio?", correlacion))
    secciones.append(("Espacio en disco", [
        f"Carpeta de datos del proceso: {texto_tamano(r.tamano_dir)}. Tabla en MariaDB (datos + índices, "
        f"estimación de InnoDB): {texto_tamano(r.tamano_tabla)}."]))
    if r.avisos:
        secciones.insert(0, ("Avisos", list(r.avisos)))
    return secciones


CSS = """
body{font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;background:#ffffff;margin:16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;font-weight:normal;color:#444;margin:0 0 12px}
h3{font-size:15px;margin:18px 0 6px}p{margin:4px 0;font-size:13px}
table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #d0d0d0;padding:3px 7px}
th{background:#f3f3f3;text-align:left;position:sticky;top:0}td.n{text-align:right;white-space:nowrap}
table.resumen td{text-align:right}table.resumen td:first-child{text-align:left}
.nota{color:#555;font-size:12px}
"""


def cuerpo_html(r: Resumen) -> str:
    partes = [f"<h1>{escape(r.titulo)}</h1><h2>{escape(r.subtitulo)} — resumen ejecutivo</h2>"]
    for titulo, lineas in lineas_resumen(r):
        partes.append(f"<h3>{escape(titulo)}</h3>")
        for linea in lineas:
            partes.append(_tabla_html(linea[1], linea[2]) if isinstance(linea, tuple) else f"<p>{escape(linea)}</p>")
    partes.append('<p class="nota">El detalle de todas las empresas va en el HTML adjunto.</p>')
    return (f"<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>{escape(asunto(r))}</title>"
            f"<style>{CSS}</style></head><body>{''.join(partes)}</body></html>")


def cuerpo_texto(r: Resumen) -> str:
    salida = [f"{r.titulo} - {r.subtitulo} - resumen ejecutivo", ""]
    for titulo, lineas in lineas_resumen(r):
        salida.append(titulo.upper())
        for linea in lineas:
            if isinstance(linea, tuple):
                salida.append("  " + " | ".join(linea[1]))
                salida.extend("  " + " | ".join(f) for f in linea[2])
            else:
                salida.append("  " + linea)
        salida.append("")
    salida.append("El detalle de todas las empresas va en el HTML adjunto.")
    return "\n".join(salida)


def asunto(r: Resumen) -> str:
    return f"{r.titulo} - Solvencia semanal {r.fecha} ({r.recuento['n_con_puntos']} empresas)"


def nombre_adjunto(r: Resumen) -> str:
    return f"finviz_analysis_solvencia_{r.fecha}.html"


def adjunto_html(r: Resumen) -> str:
    """Pagina autocontenida con la tabla de DETALLE."""
    cabeceras = ["ticker", "puntos_solvencia", "fecha", *HORIZONTES, COLUMNA_CORRELACION]
    filas = []
    for fila in r.detalle.itertuples(index=False):
        d = fila._asdict()
        enlace = (f'<a href="{escape(r.url_web)}?tickers={quote(d["ticker"])}">{escape(d["ticker"])}</a>'
                  if r.url_web else escape(d["ticker"]))
        estilo, texto = estilo_puntos(d["puntos_solvencia"], r.umbral, r.maximo)
        celdas = [f"<td>{enlace}</td>", f'<td class="n" style="{estilo}">{escape(texto)}</td>',
                  f"<td>{pd.Timestamp(d['fecha']):%Y-%m-%d}</td>"]
        for h in HORIZONTES:
            estilo, texto = estilo_diff(d[h], r.saturacion)
            celdas.append(f'<td class="n" style="{estilo}">{escape(texto)}</td>')
        celdas.append(f'<td class="n">{escape(numero(d.get(COLUMNA_CORRELACION)))}</td>')
        filas.append("<tr>" + "".join(celdas) + "</tr>")
    th = "".join(f"<th>{escape(c)}</th>" for c in cabeceras)
    leyenda = (f"Puntos: verde si llegan a {numero(r.umbral, 0)} (más intenso hasta el máximo teórico "
               f"{numero(r.maximo)}); gris y \"(poco)\" por debajo. diff_*: variación en % del último dato "
               f"de cada empresa frente al de hace una semana, 1, 3, 6, 9 y 12 meses; verde si sube, rojo si "
               f"baja (más intenso hasta ±{numero(r.saturacion, 0)} %). {COLUMNA_CORRELACION}: rho de "
               f"Spearman entre la variación semanal de los puntos y la del precio la semana siguiente "
               f"(vacío si hay menos de {r.correlaciones.min_pares} semanas).")
    return (f"<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">"
            f"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>{escape(r.titulo)} - {escape(r.fecha)}</title><style>{CSS}</style></head><body>"
            f"<h1>{escape(r.titulo)}</h1><h2>{escape(r.subtitulo)}</h2>"
            f"<p>Fecha de inicio de ejecución (primera descarga de empresa): {escape(fecha_hora(r.inicio_descargas))}</p>"
            f"<p>Fecha de fin de ejecución (última descarga de empresa): {escape(fecha_hora(r.fin_descargas))}</p>"
            f"<h3>DETALLE ({len(r.detalle)} empresas)</h3><p class=\"nota\">{escape(leyenda)}</p>"
            f"<table><thead><tr>{th}</tr></thead><tbody>{''.join(filas)}</tbody></table></body></html>")


def duraciones(lotes: list, inicio: str | None, fin: str | None) -> dict:
    from modulos.analisis.logica import estadisticas
    total = None
    if inicio and fin:
        total = (dt.datetime.fromisoformat(fin) - dt.datetime.fromisoformat(inicio)).total_seconds()
    return {"total_seg": total, "lotes": estadisticas(l.duracion_seg for l in lotes)}
