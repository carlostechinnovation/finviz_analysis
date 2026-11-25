"""
Proceso de solvencia de finviz_analysis: puntos de todo el Russell 3000 en
ciclos semanales, con un lanzamiento diario que empieza un ciclo, lo reanuda o
no hace nada (diseno_informatico.md 6).

    python principal.py                  lanzamiento diario (decide, ejecuta y, al cerrar el ciclo, email)
    python principal.py --sin-email      lo mismo sin el envio
    python principal.py --solo-email     rehace el informe de la ultima fecha de la tabla y lo envia
    python principal.py --max-tickers N  solo los N primeros tickers del universo (pruebas; no cierra el ciclo)
    python principal.py --comprobar      abre la web con dos tickers; no toca BD ni email
    python principal.py --url URL        usa otra web (p. ej. http://localhost:8000/) en vez de web.url
    python principal.py --config RUTA    usa otro configuracion.yml (pruebas)

Codigo de salida: 0 si todo fue bien (tambien si no habia nada que hacer o se
alcanzo el tope del lanzamiento); 1 si hubo un error (se intenta avisar por email).
"""
import argparse
from html import escape
import datetime as dt
import logging
import re
import sys
import traceback

from modulos.analisis import logica as analisis
from modulos.bd.logica import crear_repositorio
from modulos.configuracion.logica import cargar_configuracion, crear_directorios
from modulos.email.logica import enviar
from modulos.ejecucion.logica import (NADA, NUEVO, REANUDAR, Ejecutor, decidir, guardar_estado, leer_estado,
                                      preparar_estado, recuento)
from modulos.espacio.logica import tamano_directorio
from modulos.informe import logica as informe
from modulos.lector.logica import crear_lector, timeout_lote_min, url_lote
from modulos.registro import logica as registro
from modulos.universo.logica import leer_universo

logger = logging.getLogger("finvizanalysis")
TICKERS_COMPROBACION = ["AAPL", "MSFT"]


PREFIJO_LOG = registro.PREFIJO_LOG
LOG_LANZAMIENTO = f"{PREFIJO_LOG}_lanzamiento"   # la decision de cada lanzamiento diario
# Logs de versiones anteriores, uno por fecha: finvizanalysis_AAAA-MM-DD.log
_LOG_CON_FECHA = re.compile(rf"^{PREFIJO_LOG}_\d{{4}}-\d{{2}}-\d{{2}}\.log$")


def configurar_log(config, nombre: str = PREFIJO_LOG, vaciar: bool = True) -> None:
    """
    Log a consola y a <dir_logs>/<nombre>.log. Con vaciar=True el fichero se
    vacia al arrancar (modo 'w'); al reanudar un ciclo cortado se llama con
    vaciar=False y se sigue escribiendo detras. Borra tambien los logs con
    fecha que dejaban las versiones anteriores.
    """
    manejadores = [logging.StreamHandler(sys.stdout)]
    try:
        dir_logs = config.ruta("dir_logs")
        for viejo in dir_logs.iterdir():
            if _LOG_CON_FECHA.match(viejo.name):
                viejo.unlink(missing_ok=True)
        manejadores.append(logging.FileHandler(registro.ruta_log(config, nombre), mode="w" if vaciar else "a",
                                               encoding="utf-8"))
    except Exception:
        pass
    logging.basicConfig(level=logging.INFO, handlers=manejadores, force=True,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def comprobar(config) -> int:
    """Abre la web con dos tickers como hara la tarea programada. No toca BD ni email."""
    lector = crear_lector(config)
    url = url_lote(config.exigir("web.url"), TICKERS_COMPROBACION)
    lectura = lector.leer(url, timeout_lote_min(len(TICKERS_COMPROBACION), config.get("lectura")))
    for p in lectura.puntuaciones.values():
        logger.info("%s: puntos=%s precio=%s sin_ficha=%s dilucion=%s valida=%s",
                    p.ticker, p.puntos, p.precio, p.sin_ficha, p.dilucion, p.valida)
    ok = lectura.terminada and len(lectura.validas()) == len(TICKERS_COMPROBACION) and \
        all(p.precio is not None for p in lectura.validas())
    logger.info("Comprobacion %s", "CORRECTA" if ok else "FALLIDA (revisa el log)")
    return 0 if ok else 1


def construir_resumen(config, repo, estado, universo, alias) -> informe.Resumen:
    p = config.get("analisis")
    df = repo.historico()
    detalle = analisis.detalle(df, int(p["tolerancia_dias"]))
    corr = analisis.correlaciones(df, int(p["correlacion"]["min_pares"]), int(p["correlacion"]["max_hueco_dias"]),
                                  float(p["correlacion"]["alfa_fdr"]))
    detalle = detalle.merge(corr.por_ticker[["ticker", "rho"]].rename(columns={"rho": analisis.COLUMNA_CORRELACION}),
                            on="ticker", how="left")
    lotes = estado.lotes
    inicio = lotes[0].inicio if lotes else None
    fin = lotes[-1].fin if lotes else None
    rc = recuento(estado, universo, alias, repo.tickers_con_dato(estado.fecha_date))
    avisos = []
    if rc["n_no_procesados"]:
        avisos.append(f"{rc['n_no_procesados']} tickers del universo no se llegaron a pedir.")
    errores = [l for l in lotes if l.error]
    if errores:
        avisos.append(f"{len(errores)} lotes fallaron (sus tickers pasaron a la repesca); primer error: "
                      f"{errores[0].error}")
    return informe.Resumen(
        titulo=config.get("email.titulo", "finviz_analysis"), subtitulo=config.get("email.subtitulo", ""),
        fecha=estado.fecha, inicio_descargas=inicio, fin_descargas=fin, recuento=rc,
        duraciones=informe.duraciones(lotes, inicio, fin), n_bloqueos=sum(1 for l in lotes if l.bloqueo_proxy),
        puntos=analisis.estadisticas_puntos(df, float(p["umbral_puntos"])),
        movimientos=analisis.movimientos(df, int(p["top_n"])), correlaciones=corr, detalle=detalle,
        tamano_dir=tamano_directorio(config.ruta("dir_base")), tamano_tabla=repo.tamano_bytes(),
        umbral=float(p["umbral_puntos"]), maximo=float(p["puntos_maximos"]),
        saturacion=float(p["saturacion_diff_pct"]), url_web=config.get("web.url", ""), avisos=avisos)


def publicar(config, resumen: informe.Resumen, con_email: bool) -> str:
    """Escribe adjunto y cuerpo en rutas.dir_informes y, si toca, envia el email."""
    carpeta = config.ruta("dir_informes")
    adjunto = informe.adjunto_html(resumen)
    html, texto = informe.cuerpo_html(resumen), informe.cuerpo_texto(resumen)
    (carpeta / informe.nombre_adjunto(resumen)).write_text(adjunto, encoding="utf-8")
    (carpeta / f"email_{resumen.fecha}.html").write_text(html, encoding="utf-8")
    logger.info("Informe en %s", carpeta / informe.nombre_adjunto(resumen))
    if not con_email:
        return "sin email (--sin-email)"
    return enviar(config, informe.asunto(resumen), texto, html,
                  {informe.nombre_adjunto(resumen): adjunto.encode("utf-8")})


def avisar_error(config, detalle: str) -> None:
    try:
        enviar(config, "finviz_analysis - ERROR en el proceso de solvencia", detalle,
               f"<pre>{escape(detalle)}</pre>")
    except Exception as exc:
        logger.error("Tampoco se pudo enviar el email de error: %s", exc)


def solo_email(config, a) -> int:
    repo = crear_repositorio(config)
    repo.asegurar_tabla()
    universo, alias = leer_universo(config.ruta("universo_csv"))
    df = repo.historico()
    if df.empty:
        raise RuntimeError("La tabla esta vacia: no hay nada que enviar")
    fecha = analisis.fechas_ejecucion(df)[-1]
    estado = leer_estado(config.ruta("dir_ejecuciones"), f"{fecha:%Y-%m-%d}")
    if estado is None:
        raise RuntimeError(f"No hay estado de la ejecucion {fecha:%Y-%m-%d} en rutas.dir_ejecuciones")
    resultado = publicar(config, construir_resumen(config, repo, estado, universo, alias), not a.sin_email)
    estado.email_enviado = resultado == "enviado"
    guardar_estado(config.ruta("dir_ejecuciones"), estado)
    logger.info("Fin: %s", resultado)
    return 0


def lanzamiento(config, a, ahora: dt.datetime, lector=None, repo=None) -> int:
    """
    Lanzamiento diario (diseno_informatico.md 6.1). La decision se anota en
    LOG_LANZAMIENTO; el ciclo escribe en el log principal, que solo se vacia al
    empezar un ciclo nuevo. lector y repo se inyectan en los tests.
    """
    repo = repo if repo is not None else crear_repositorio(config)
    repo.asegurar_tabla()
    lineas = registro.leer_lineas(registro.ruta_log(config))
    decision = decidir(repo.fecha_mas_reciente(), lineas, ahora.date(), int(config.get("ciclo.dias", 7)))
    logger.info("Decision: %s, ciclo %s (%s)", decision.accion.upper(), decision.fecha, decision.motivo)
    if decision.accion == NADA:
        return 0

    configurar_log(config, vaciar=decision.accion == NUEVO)
    fecha = decision.fecha.isoformat()
    logger.info(registro.linea_inicio(fecha) if decision.accion == NUEVO
                else registro.linea_reanudacion(fecha, registro.ultima_linea(lineas)))
    logger.info("Decision: %s", decision.motivo)
    try:
        universo, alias = leer_universo(config.ruta("universo_csv"))
        if a.max_tickers:
            universo = universo[:a.max_tickers]
        pedidos_log = registro.tickers_pedidos(lineas, fecha) if decision.accion == REANUDAR else set()
        estado = preparar_estado(config, decision, ahora, pedidos_log)
        lector = lector if lector is not None else crear_lector(config)
        estado = Ejecutor(config, lector, repo).ejecutar(estado, universo, alias, pedidos_log)
        if not estado.terminada:
            logger.warning(registro.linea_parada(fecha, float(config.get("ciclo.duracion_max_horas", 22))))
            return 0
        resultado = publicar(config, construir_resumen(config, repo, estado, universo, alias), not a.sin_email)
        estado.email_enviado = resultado == "enviado"
        guardar_estado(config.ruta("dir_ejecuciones"), estado)
        if a.max_tickers:
            logger.info("Fin de la prueba con --max-tickers %d (%s): el ciclo %s no se da por terminado",
                        a.max_tickers, resultado, fecha)
        else:
            logger.info(registro.linea_fin(fecha, resultado))
        return 0
    except Exception:   # error dentro del ciclo: queda en su log, con la marca al final
        detalle = traceback.format_exc()
        logger.error("Ejecucion fallida:\n%s", detalle)
        if not a.sin_email:
            avisar_error(config, detalle)
        logger.error(registro.linea_error(fecha))
        return 1


def main(argv=None) -> int:
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--sin-email", action="store_true")
    args.add_argument("--solo-email", action="store_true")
    args.add_argument("--comprobar", action="store_true")
    args.add_argument("--max-tickers", type=int, default=0)
    args.add_argument("--url", help="sustituye a web.url (p. ej. la web servida en local)")
    args.add_argument("--config", help="otro configuracion.yml (por defecto config/configuracion.yml)")
    a = args.parse_args(argv)

    ahora = dt.datetime.now()
    if a.comprobar:
        config = cargar_configuracion(a.config, con_secretos=False)
        if a.url:
            config.datos.setdefault("web", {})["url"] = a.url
        configurar_log(config, f"{PREFIJO_LOG}_comprobar")
        return comprobar(config)

    config = cargar_configuracion(a.config)
    if a.url:
        config.datos.setdefault("web", {})["url"] = a.url
    crear_directorios(config)
    configurar_log(config, f"{PREFIJO_LOG}_solo_email" if a.solo_email else LOG_LANZAMIENTO)
    try:
        return solo_email(config, a) if a.solo_email else lanzamiento(config, a, ahora)
    except Exception:
        detalle = traceback.format_exc()
        logger.error("Ejecucion fallida:\n%s", detalle)
        if not a.sin_email:
            avisar_error(config, detalle)
        return 1


if __name__ == "__main__":
    sys.exit(main())
