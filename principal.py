"""
Proceso semanal de finviz_analysis: puntos de solvencia de todo el Russell 3000
(diseno_informatico.md 6).

    python principal.py                  ejecucion completa (lotes + email)
    python principal.py --sin-email      todo menos el envio
    python principal.py --solo-email     rehace el informe de la ultima fecha de la tabla y lo envia
    python principal.py --max-tickers N  solo los N primeros tickers del universo (pruebas)
    python principal.py --comprobar      abre la web con dos tickers; no toca BD ni email
    python principal.py --url URL        usa otra web (p. ej. http://localhost:8000/) en vez de web.url
    python principal.py --config RUTA    usa otro configuracion.yml (pruebas)

Codigo de salida: 0 si todo fue bien; 1 si hubo un error (se intenta avisar por email).
"""
import argparse
from html import escape
import datetime as dt
import logging
import sys
import traceback

from modulos.analisis import logica as analisis
from modulos.bd.logica import crear_repositorio
from modulos.configuracion.logica import cargar_configuracion, crear_directorios
from modulos.email.logica import enviar
from modulos.ejecucion.logica import Ejecutor, iniciar_o_reanudar, leer_estado, guardar_estado, recuento
from modulos.espacio.logica import tamano_directorio
from modulos.informe import logica as informe
from modulos.lector.logica import crear_lector, timeout_lote_min, url_lote
from modulos.universo.logica import leer_universo

logger = logging.getLogger("finvizanalysis")
TICKERS_COMPROBACION = ["AAPL", "MSFT"]


def configurar_log(config, fecha: str) -> None:
    manejadores = [logging.StreamHandler(sys.stdout)]
    try:
        ruta = config.ruta("dir_logs") / f"finvizanalysis_{fecha}.log"
        manejadores.append(logging.FileHandler(ruta, encoding="utf-8"))
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
        avisos.append(f"Se acabó la ventana de ejecución ({estado.limite.replace('T', ' ')}) con "
                      f"{rc['n_no_procesados']} tickers sin procesar.")
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
        enviar(config, "finviz_analysis - ERROR en la ejecucion semanal", detalle,
               f"<pre>{escape(detalle)}</pre>")
    except Exception as exc:
        logger.error("Tampoco se pudo enviar el email de error: %s", exc)


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
        configurar_log(config, "comprobar")
        return comprobar(config)

    config = cargar_configuracion(a.config)
    if a.url:
        config.datos.setdefault("web", {})["url"] = a.url
    crear_directorios(config)
    configurar_log(config, ahora.date().isoformat())
    try:
        repo = crear_repositorio(config)
        repo.asegurar_tabla()
        universo, alias = leer_universo(config.ruta("universo_csv"))
        if a.max_tickers:
            universo = universo[:a.max_tickers]
        if a.solo_email:
            df = repo.historico()
            if df.empty:
                raise RuntimeError("La tabla esta vacia: no hay nada que enviar")
            fecha = analisis.fechas_ejecucion(df)[-1]
            estado = leer_estado(config.ruta("dir_ejecuciones"), f"{fecha:%Y-%m-%d}")
            if estado is None:
                raise RuntimeError(f"No hay estado de la ejecucion {fecha:%Y-%m-%d} en rutas.dir_ejecuciones")
        else:
            estado = iniciar_o_reanudar(config, ahora)
            estado = Ejecutor(config, crear_lector(config), repo).ejecutar(estado, universo, alias)
        resultado = publicar(config, construir_resumen(config, repo, estado, universo, alias), not a.sin_email)
        estado.email_enviado = resultado == "enviado"
        guardar_estado(config.ruta("dir_ejecuciones"), estado)
        logger.info("Fin: %s", resultado)
        return 0
    except Exception:
        detalle = traceback.format_exc()
        logger.error("Ejecucion fallida:\n%s", detalle)
        if not a.sin_email:
            avisar_error(config, detalle)
        return 1


if __name__ == "__main__":
    sys.exit(main())
