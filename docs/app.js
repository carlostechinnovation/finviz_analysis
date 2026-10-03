/* =========================================================================
   Comparador empresas vs screener (Finviz)
   100% cliente: no hay backend. Solo HTML + JS estatico en GitHub Pages.

   Admite varios tickers a la vez (separados por comas): cada ticker es una
   columna de la tabla de resultados. Las columnas se muestran en el orden
   del textbox ("Orden entrada") o de mas a menos puntos ("Orden por filtros
   cumplidos"), segun el boton pulsado; ver ordenaTickers en logica.js.

   Si la URL trae ?tickers=AAA,BBB,CCC se precarga el textbox y se lanza la
   comparacion sola, sin esperar un clic (asi funciona el enlace que manda
   DIIA en su email con la Seleccion del dia). Si ademas trae
   ?escenario=texto, ese texto se muestra como subtitulo bajo el titulo.

   La logica pura (filtros, parseo, calculo de dilucion) vive en logica.js,
   cargado antes que este fichero, para poder testearla con Node sin DOM.
   Aqui solo queda el DOM, la red (fetch a los proxies) y la orquestacion.

   NOTA DE CODIFICACION: este fichero se mantiene en ASCII puro a proposito.
   Los acentos y simbolos van como escapes \uXXXX dentro de las cadenas, de
   forma que ningun editor pueda corromperlo al guardarlo en otra codificacion.
   ========================================================================= */

const tickerInput = document.getElementById("ticker");
const screenerSelect = document.getElementById("screenerSelect");
const customURLInput = document.getElementById("customURL");
const compareBtn = document.getElementById("compareBtn");
const resultsTableEl = document.getElementById("resultsTable");
const resultsThead = resultsTableEl.querySelector("thead");
const resultsTable = resultsTableEl.querySelector("tbody");
const botonesOrden = document.getElementById("botonesOrden");
const ordenEntradaBtn = document.getElementById("ordenEntradaBtn");
const ordenPuntosBtn = document.getElementById("ordenPuntosBtn");
const log = document.getElementById("log");
const escenarioEl = document.getElementById("escenario");

const SCREENER_POR_DEFECTO = "solventes";
const VALOR_CUSTOM = "__custom__";

const parametrosURL = new URLSearchParams(location.search);

// Precarga el textbox de tickers desde el parametro de URL ?tickers=... (p.ej.
// el enlace del email resumen de DIIA con su Seleccion del dia) y, si llega,
// lanza la comparacion automaticamente en cuanto se cargan los screeners
// (mas abajo), para ver directo la tabla de solvencia sin un clic extra.
const tickersURL = parametrosURL.get("tickers");
if (tickersURL) tickerInput.value = tickersURL;

// Subtitulo opcional desde ?escenario=... (p.ej. "BolsaML - 2026-10-03 14:23:05"
// o "DIIA - 2026-10-03 14:23", que mandan los emails de bolsa y DIIA), para
// saber de que ejecucion vienen los tickers. Va como textContent: un texto
// llegado por la URL nunca se interpreta como HTML.
const escenarioURL = (parametrosURL.get("escenario") || "").trim();
if (escenarioURL) {
    escenarioEl.textContent = escenarioURL;
    escenarioEl.hidden = false;
}

// Copia embebida de docs/urls_screeners_finviz.csv, usada como respaldo si el
// fetch del CSV falla (p.ej. index.html abierto como file://, donde el
// navegador bloquea la carga de ficheros locales: ver diseno_informatico.md
// SS4). Mantener sincronizada con el CSV al anadir un screener nuevo.
const SCREENERS_RESPALDO =
    "SCREENER|URL\n" +
    "solventes|https://finviz.com/screener.ashx?v=211&p=w&f=cap_largeunder%2Cfa_curratio_o1%2Cfa_debteq_u1%2Cfa_epsyoyttm_pos%2Cfa_evsales_u6%2Cfa_fpe_u20%2Cfa_grossmargin_o10%2Cfa_ltdebteq_u1%2Cfa_opermargin_o5%2Cfa_pe_u30%2Cfa_ps_o2%2Csh_float_o1%2Csh_instown_o30%2Csh_relvol_o0.5%2Csh_short_u10%2Cta_averagetruerange_o1%2Cta_highlow52w_a5h%2Cta_perf2_26wup%2Cta_perf_3yup%2Cta_rsi_nos40%2Cta_sma20_pa&ft=4&o=-instown\n";

// Tiempo maximo de espera a la llamada. r.jina.ai renderiza la pagina en su
// servidor antes de responder, lo que tarda varios segundos; sin este limite
// una caida del servicio dejaria la pagina esperando indefinidamente.
const TIMEOUT_MS = 30000;
// Minimo de etiquetas reconocidas para dar por buena una descarga.
const MIN_CAMPOS_VALIDOS = 8;

/**
 * Anade una linea con hora al log visible de la pagina.
 * @param {string} msg Mensaje.
 */
function logMsg(msg) {
    log.textContent += "[" + new Date().toLocaleTimeString() + "] " + msg + "\n";
    log.scrollTop = log.scrollHeight;
}

/* -------------------------------------------------------------------------
   DESCARGA VIA PROXY CORS
   GitHub Pages no puede llamar a finviz.com directamente (CORS) y no hay
   backend propio, asi que se usa un proxy publico: r.jina.ai renderiza la
   pagina en su servidor y la devuelve como texto/markdown con CORS abierto.
   Ese proxy admite 20 peticiones/minuto por IP, asi que TODAS las llamadas
   pasan por una unica cola (creaLimitador, en logica.js) y los fallos
   transitorios (429, 5xx, timeout, respuesta vacia) se reintentan.
   ------------------------------------------------------------------------- */
const limitadorProxy = creaLimitador(PROXY_MAX_POR_MINUTO, PROXY_VENTANA_MS, PROXY_MAX_SIMULTANEAS);

/**
 * URL del proxy CORS para una URL de destino.
 * @param {string} objetivo URL de Finviz o de la SEC.
 * @returns {string} URL a traves de r.jina.ai.
 */
function construyeURLProxy(objetivo) {
    return "https://r.jina.ai/" + objetivo;
}

// Descarga el cuerpo completo con un limite de tiempo que cubre tambien la
// lectura del cuerpo, no solo la llegada de las cabeceras. Nunca lanza.
/**
 * Descarga una URL con limite de tiempo.
 * @param {string} url URL a descargar.
 * @param {number} ms Limite en milisegundos.
 * @returns {Promise<{status:number, texto?:string, motivo?:string}>} Resultado.
 */
async function descargaTexto(url, ms) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        const resp = await fetch(url, { cache: "no-store", signal: ctrl.signal, redirect: "follow" });
        if (!resp.ok) return { status: resp.status };
        return { status: resp.status, texto: await resp.text() };
    } catch (e) {
        return { status: 0, motivo: e.name === "AbortError" ? "timeout " + (ms / 1000) + "s" : e.message };
    } finally {
        clearTimeout(id);
    }
}

// Pide "objetivo" a traves del proxy, respetando el cupo y reintentando lo
// transitorio. "valida(texto)" devuelve null si la respuesta sirve, o
// { motivo, definitivo } si no. Devuelve el texto, o null si no hubo manera.
// Con opciones.silencioso no se anotan los fallos definitivos (p.ej. el 404 de
// una etiqueta XBRL que la empresa no usa: es lo esperable, no un error).
/**
 * Pide una URL al proxy respetando el cupo y reintentando lo transitorio.
 * @param {string} objetivo URL de destino.
 * @param {string} etiqueta Prefijo para el log.
 * @param {number} prioridad PRIORIDAD_FINVIZ o PRIORIDAD_SEC.
 * @param {Function} [valida] Validador de la respuesta.
 * @param {{silencioso?:boolean}} [opciones] Opciones de log.
 * @returns {Promise<string|null>} Texto valido, o null.
 */
async function pideAlProxy(objetivo, etiqueta, prioridad, valida, opciones) {
    const url = construyeURLProxy(objetivo);
    let motivo = "";
    for (let intento = 1; intento <= PROXY_MAX_INTENTOS; intento++) {
        const r = await limitadorProxy.encola(() => descargaTexto(url, TIMEOUT_MS), prioridad);
        let definitivo = false;
        if (r.texto !== undefined) {
            const fallo = valida ? valida(r.texto) : null;
            if (!fallo) return r.texto;
            motivo = fallo.motivo;
            definitivo = !!fallo.definitivo;
        } else {
            motivo = r.motivo || ("HTTP " + r.status);
            definitivo = !esReintentable(r.status);
            if (r.status === 429) limitadorProxy.pausa(PROXY_PAUSA_429_MS);
        }
        if (definitivo) {
            if (!(opciones && opciones.silencioso)) logMsg("  [" + etiqueta + "] [FALLO] " + motivo);
            return null;
        }
        if (intento < PROXY_MAX_INTENTOS) {
            logMsg("  [" + etiqueta + "] intento " + intento + " fallido (" + motivo + "); se reintenta.");
        }
    }
    logMsg("  [" + etiqueta + "] [FALLO] " + motivo + " (tras " + PROXY_MAX_INTENTOS + " intentos)");
    return null;
}

/**
 * Descarga y parsea la ficha de Finviz del ticker.
 * @param {string} ticker Ticker de la empresa.
 * @returns {Promise<{datos:Object, validos:number}|null>} Ficha, o null.
 */
async function descargaDatos(ticker) {
    const objetivo = "https://finviz.com/quote.ashx?t=" + encodeURIComponent(ticker) + "&p=d";
    let datos = null, validos = 0;

    const texto = await pideAlProxy(objetivo, ticker, PRIORIDAD_FINVIZ, (cuerpo) => {
        if (esBusquedaFinviz(cuerpo)) return { motivo: "Finviz no reconoce el ticker", definitivo: true };
        const errorDestino = errorDestinoProxy(cuerpo);
        if (errorDestino) {
            return { motivo: "Finviz respondio HTTP " + errorDestino, definitivo: !esReintentable(errorDestino) };
        }
        if (!cuerpo || cuerpo.length < 200) return { motivo: "respuesta vacia" };
        datos = extraeDatosMarkdown(cuerpo);
        validos = cuentaConocidos(datos);
        if (validos < MIN_CAMPOS_VALIDOS) {
            return { motivo: "solo " + validos + " campos reconocidos (" + cuerpo.length + " bytes)" };
        }
        return null;
    });
    if (texto === null) return null;

    logMsg("  [" + ticker + "] [OK] " + validos + " campos reconocidos");
    return { datos: datos, validos: validos };
}

/* -------------------------------------------------------------------------
   DETECCION DE DILUCION (SEC EDGAR)
   ------------------------------------------------------------------------- */

// Mapeo ticker -> CIK. Se descarga una unica vez por sesion (fichero de la
// SEC con todas las empresas). Se cachea la PROMESA, no el resultado: con
// varios tickers a la vez, cachear un objeto vacio mientras llegaba la
// descarga hacia que todos menos el primero vieran el mapeo "cargado" y
// vacio, y salian como "ticker no encontrado". Si la descarga falla, se
// olvida la promesa para que la siguiente comparacion lo vuelva a intentar.
let promesaMapeoCIK = null;
/**
 * Descarga (una vez por sesion) el mapeo ticker -> CIK de la SEC.
 * @returns {Promise<Object<string,string>|null>} Mapeo, o null si fallo.
 */
function cargaMapeoCIK() {
    if (!promesaMapeoCIK) {
        promesaMapeoCIK = (async () => {
            const texto = await pideAlProxy("https://www.sec.gov/files/company_tickers.json",
                "SEC mapeo CIK", PRIORIDAD_SEC,
                (cuerpo) => extraeJSON(cuerpo) ? null : { motivo: "respuesta sin JSON reconocible" });
            const json = texto === null ? null : extraeJSON(texto);
            if (!json) {
                promesaMapeoCIK = null;
                return null;
            }
            const mapeo = {};
            for (const clave of Object.keys(json)) {
                const item = json[clave];
                if (item && item.ticker && item.cik_str !== undefined) {
                    mapeo[String(item.ticker).toUpperCase()] = String(item.cik_str).padStart(10, "0");
                }
            }
            return mapeo;
        })();
    }
    return promesaMapeoCIK;
}

/**
 * CIK de la SEC para un ticker.
 * @param {string} ticker Ticker de la empresa.
 * @returns {Promise<string|null>} CIK, "" si la SEC no lo lista, o null si
 *     no hay mapeo.
 */
async function resuelveCIK(ticker) {
    const mapeo = await cargaMapeoCIK();
    if (!mapeo) return null;
    // SEC escribe las clases con guion (BRK-B); Finviz, a veces con punto.
    return mapeo[ticker.toUpperCase()] || mapeo[ticker.toUpperCase().replace(".", "-")] || "";
}

// Busca en la API XBRL de la SEC una comparacion de acciones en circulacion
// reciente y coherente, probando varias etiquetas contables porque no todas
// las empresas informan bajo la misma (algunas usan
// dei:EntityCommonStockSharesOutstanding en vez de
// us-gaap:CommonStockSharesOutstanding, y otras dejaron de usar una hace anios).
// Si una etiqueta no da una comparacion valida (no existe -> 404 del destino,
// datos viejos, sin dos fechas separadas ~1 anio, error de escala) se pasa a
// la siguiente. Devuelve { r, ruta } o null.
/**
 * Busca en la SEC una serie de acciones en circulacion reciente y coherente.
 * @param {string} cik CIK de la empresa (10 digitos).
 * @param {string} ticker Ticker, para el log.
 * @returns {Promise<{r:Object, ruta:string}|null>} Dilucion y etiqueta XBRL.
 */
async function buscaDilucionSEC(cik, ticker) {
    for (const ruta of XBRL_TAGS_SHARES) {
        const objetivo = "https://data.sec.gov/api/xbrl/companyconcept/CIK" + cik + "/" + ruta + ".json";
        const texto = await pideAlProxy(objetivo, ticker + " SEC " + ruta, PRIORIDAD_SEC, (cuerpo) => {
            const errorDestino = errorDestinoProxy(cuerpo);
            if (errorDestino) {
                return { motivo: "SEC respondio HTTP " + errorDestino, definitivo: !esReintentable(errorDestino) };
            }
            return extraeJSON(cuerpo) ? null : { motivo: "respuesta sin JSON reconocible" };
        }, { silencioso: true });
        const json = texto === null ? null : extraeJSON(texto);
        // La SEC devuelve a veces "shares": {} (objeto vacio, no lista): se trata como sin datos.
        const shares = json && json.units && json.units.shares;
        const puntos = Array.isArray(shares) ? shares : [];
        const r = calculaDilucion(puntos, Date.now());
        if (r) return { r: r, ruta: ruta };
    }
    return null;
}

// Orquesta la comprobacion completa para un ticker. Nunca lanza: si algo
// falla (ticker no listado en SEC, sin historico, etc.) devuelve null y solo
// deja constancia en el log, para no romper la comparacion contra Finviz.
/**
 * Comprobacion completa de dilucion de un ticker. Nunca lanza.
 * @param {string} ticker Ticker de la empresa.
 * @returns {Promise<Object|null>} Resultado de calculaDilucion, o null.
 */
async function compruebaDilucion(ticker) {
    try {
        const cik = await resuelveCIK(ticker);
        if (cik === null) {
            logMsg("  [" + ticker + "] Dilucion: no se pudo descargar el mapeo ticker->CIK de SEC EDGAR.");
            return null;
        }
        if (!cik) {
            logMsg("  [" + ticker + "] Dilucion: ticker no encontrado en el mapeo CIK de SEC EDGAR.");
            return null;
        }
        const hallado = await buscaDilucionSEC(cik, ticker);
        if (!hallado) {
            logMsg("  [" + ticker + "] Dilucion: SEC EDGAR no tiene un historico reciente y coherente de " +
                   "acciones en circulacion (probadas " + XBRL_TAGS_SHARES.length + " etiquetas XBRL; " +
                   "habitual en empresas con varias clases de accion).");
            return null;
        }
        const r = hallado.r;
        logMsg("  [" + ticker + "] Dilucion (" + hallado.ruta + "): acciones en circulacion " +
               r.anterior.val.toLocaleString() + " (" + r.anterior.end + ") -> " +
               r.actual.val.toLocaleString() + " (" + r.actual.end + ") = " +
               (r.pct >= 0 ? "+" : "") + r.pct.toFixed(1) + "%");
        return r;
    } catch (e) {
        logMsg("  [" + ticker + "] Dilucion: error inesperado (" + e.message + ")");
        return null;
    }
}

/* -------------------------------------------------------------------------
   CARGA DE CSVs
   ------------------------------------------------------------------------- */
/**
 * Rellena screenerSelect a partir del texto CSV (SCREENER|URL, con cabecera).
 * @param {string} text Contenido del CSV.
 * @returns {boolean} true si ha anadido al menos un screener.
 */
function poblarScreeners(text) {
    const lines = text.replace(/\r/g, "").split("\n").slice(1);

    let anadidos = 0;
    let porDefecto = null;
    for (const line of lines) {
        if (!line.trim() || line.indexOf("|") === -1) continue;
        const idx = line.indexOf("|");
        const nombre = line.slice(0, idx).trim();
        const url = line.slice(idx + 1).trim();
        if (!nombre || !url) continue;

        const option = document.createElement("option");
        option.value = url;
        option.textContent = nombre;
        screenerSelect.appendChild(option);
        anadidos++;

        if (nombre.toLowerCase() === SCREENER_POR_DEFECTO) porDefecto = option;
        if (!porDefecto && anadidos === 1) porDefecto = option;
    }

    if (porDefecto) screenerSelect.value = porDefecto.value;
    return anadidos > 0;
}

/**
 * Carga el desplegable de screeners (CSV, o la copia embebida si falla).
 * @returns {Promise<void>}
 */
async function loadScreeners() {
    screenerSelect.innerHTML = "";

    const optCustom = document.createElement("option");
    optCustom.value = VALOR_CUSTOM;
    optCustom.textContent = "CUSTOM (URL manual)";
    screenerSelect.appendChild(optCustom);

    let cargado = false;
    try {
        const resp = await fetch("urls_screeners_finviz.csv", { cache: "no-store" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        cargado = poblarScreeners(await resp.text());
    } catch (e) {
        logMsg("No se pudo cargar urls_screeners_finviz.csv (" + e.message + "); uso la lista de respaldo embebida.");
    }

    if (!cargado) poblarScreeners(SCREENERS_RESPALDO);

    actualizaCampoCustom();
}

/**
 * Muestra el campo de URL manual solo con la opcion CUSTOM.
 */
function actualizaCampoCustom() {
    customURLInput.style.display = screenerSelect.value === VALOR_CUSTOM ? "inline-block" : "none";
}

screenerSelect.addEventListener("change", actualizaCampoCustom);

let descripcionesCache = null;
/**
 * Carga (una vez) el glosario descripcion_filtros.csv.
 * @returns {Promise<Object<string,string>>} Etiqueta -> descripcion.
 */
async function loadDescriptions() {
    if (descripcionesCache) return descripcionesCache;
    const map = {};
    try {
        const resp = await fetch("descripcion_filtros.csv", { cache: "no-store" });
        const text = (await resp.text()).replace(/\r/g, "");
        for (const line of text.split("\n").slice(1)) {
            if (!line.trim() || line.indexOf("|") === -1) continue;
            const idx = line.indexOf("|");
            map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
    } catch (e) {
        logMsg("No se pudo cargar descripcion_filtros.csv: " + e.message);
    }
    descripcionesCache = map;
    return map;
}

/* -------------------------------------------------------------------------
   COMPARACION (multi-ticker)
   Columnas fijas: Filtro | Condicion Screener | Descripcion, seguidas de una
   columna por cada ticker. El valor de la empresa va DENTRO de su celda
   (no en una columna aparte); el color de la celda (verde/rojo/naranja) es
   lo que indica CUMPLE / INCUMPLE / N-A, o el aviso de dilucion.
   Filas, de arriba abajo: "Orden entrada" (solo con 2 o mas empresas),
   "Orden por filtros cumplidos" (puntos), dilucion y un filtro por fila.
   ------------------------------------------------------------------------- */

// Ultima comparacion lanzada ({ tickers, filtros, resultadosPorTicker,
// descripciones }) y criterio de orden de columnas elegido con los botones.
// Se guardan para poder reordenar la tabla sin volver a descargar nada.
let comparacionActual = null;
let criterioOrden = ORDEN_ENTRADA;

/**
 * Escapa un texto para insertarlo como HTML.
 * @param {*} s Texto (undefined/null se tratan como "").
 * @returns {string} Texto escapado.
 */
function textoPlano(s) {
    const d = document.createElement("div");
    d.textContent = String(s === undefined || s === null ? "" : s);
    return d.innerHTML;
}

/**
 * Lee los tickers del textbox: mayusculas, sin vacios ni duplicados, en el
 * mismo orden en que se escribieron.
 * @returns {string[]} Tickers en orden de entrada.
 */
function leeTickers() {
    const vistos = new Set();
    const resultado = [];
    for (const trozo of tickerInput.value.split(",")) {
        const t = trozo.trim().toUpperCase();
        if (t && !vistos.has(t)) {
            vistos.add(t);
            resultado.push(t);
        }
    }
    return resultado;
}

/**
 * Ficha de Finviz en velas semanales (p.ej. AAPL ->
 * https://finviz.com/stock?t=AAPL&p=w).
 * @param {string} ticker Ticker de la empresa.
 * @returns {string} URL.
 */
function urlFinvizSemanal(ticker) {
    return "https://finviz.com/stock?t=" + encodeURIComponent(ticker) + "&p=w";
}

/**
 * HTML de una celda de datos.
 * @param {*} texto Contenido (se escapa).
 * @param {string} [clase] Clase CSS (ok / nok / na / dilucion-alerta).
 * @returns {string} HTML del <td>.
 */
function celda(texto, clase) {
    const atributo = clase ? ' class="' + clase + '"' : "";
    return "<td" + atributo + ">" + textoPlano(texto) + "</td>";
}

/**
 * Pinta la cabecera: tres columnas fijas + una por ticker, en el orden dado.
 * @param {string[]} columnas Tickers en el orden de presentacion.
 */
function pintaCabecera(columnas) {
    const th = ["Filtro", "Condici\u00f3n Screener", "Descripci\u00f3n"]
        .map(t => "<th>" + textoPlano(t) + "</th>")
        .concat(columnas.map(t =>
            '<th><a href="' + urlFinvizSemanal(t) + '" target="_blank" rel="noopener noreferrer">' +
            textoPlano(t) + "</a></th>"))
        .join("");
    resultsThead.innerHTML = "<tr>" + th + "</tr>";
}

/**
 * Anade una fila al cuerpo de la tabla.
 * @param {string[]} fijas Textos de las tres columnas fijas.
 * @param {string[]} celdasTicker HTML de las celdas de cada ticker.
 * @param {string} [clase] Clase CSS de la fila.
 */
function anadeFila(fijas, celdasTicker, clase) {
    const tr = document.createElement("tr");
    if (clase) tr.className = clase;
    tr.innerHTML = fijas.map(t => celda(t)).join("") + celdasTicker.join("");
    resultsTable.appendChild(tr);
}

/**
 * Fila "Orden entrada": posicion de cada ticker en el textbox (1, 2, 3...).
 * Al ordenar por puntos, cada celda sigue a su ticker.
 * @param {string[]} columnas Tickers en el orden de presentacion.
 * @param {string[]} tickers Tickers en orden de entrada.
 */
function pintaFilaOrdenEntrada(columnas, tickers) {
    anadeFila(
        ["Orden entrada", "", "Posici\u00f3n de la empresa en el campo \"Ticker de empresas\"."],
        columnas.map(t => celda(tickers.indexOf(t) + 1)),
        "fila-orden");
}

/**
 * Fila "Orden por filtros cumplidos": puntos de cada ticker.
 * @param {string[]} columnas Tickers en el orden de presentacion.
 * @param {Object<string,number>} puntos ticker -> puntos.
 */
function pintaFilaPuntos(columnas, puntos) {
    anadeFila(
        ["Orden por filtros cumplidos", "M\u00e1s puntos = mejor",
         "Pesos que priman la solvencia: LT Debt/Eq, Debt/Eq y Current Ratio punt\u00faan por " +
         "tramos; " + PUNTOS_ALERTA_DILUCION + " por alerta de diluci\u00f3n; 0 si no hay ficha. " +
         "Ver diseno_funcional.md \u00a77."],
        columnas.map(t => celda(puntos[t])),
        "fila-puntos");
}

/**
 * Celda de dilucion de un ticker: verde por debajo del umbral, roja con el
 * aviso si lo supera, naranja si no hay datos o aun no han llegado.
 * @param {Object|null|undefined} d Resultado de compruebaDilucion
 *     (undefined = pendiente).
 * @returns {string} HTML del <td>.
 */
function celdaDilucion(d) {
    if (d === undefined) return celda("(pendiente)", "na");
    if (!d) return celda("N/D", "na");
    const pctTexto = (d.pct >= 0 ? "+" : "") + d.pct.toFixed(1) + "%";
    if (hayAlertaDilucion(d)) {
        return celda("ALERTA POR DILUCI\u00d3N: " + pctTexto + " en 1 a\u00f1o", "dilucion-alerta");
    }
    return celda(pctTexto, "ok");
}

/**
 * Fila de dilucion (independiente del screener).
 * @param {string[]} columnas Tickers en el orden de presentacion.
 * @param {Object} resultadosPorTicker ticker -> { datos, dilucion }.
 */
function pintaFilaDilucion(columnas, resultadosPorTicker) {
    anadeFila(
        ["Diluci\u00f3n en 1 a\u00f1o (SEC EDGAR)", "< " + UMBRAL_DILUCION_PCT + "% de aumento",
         "Aumento de acciones en circulaci\u00f3n en ~1 a\u00f1o, seg\u00fan SEC EDGAR " +
         "(no Finviz). N/D = sin datos suficientes en SEC EDGAR. Ver diseno_funcional.md \u00a76."],
        columnas.map(t => celdaDilucion(resultadosPorTicker[t].dilucion)));
}

/**
 * Fila de un filtro del screener.
 * @param {string} codigo Codigo del filtro.
 * @param {string[]} columnas Tickers en el orden de presentacion.
 * @param {Object} evaluacionesFiltro ticker -> { texto, estado }.
 * @param {Object<string,string>} descripciones Glosario de etiquetas.
 */
function pintaFilaFiltro(codigo, columnas, evaluacionesFiltro, descripciones) {
    const def = FILTROS[codigo];
    const etiqueta = def ? def.finviz : codigo;
    anadeFila(
        [etiqueta, def ? def.texto : "(filtro no soportado)", buscaDescripcion(descripciones, etiqueta)],
        columnas.map(t => celda(evaluacionesFiltro[t].texto, evaluacionesFiltro[t].estado)));
}

/**
 * Pinta la tabla completa con lo que haya llegado hasta ahora. Se llama cada
 * vez que termina una descarga y al pulsar un boton de orden. En
 * resultadosPorTicker[t], datos/dilucion valen undefined mientras estan
 * pendientes y null si la descarga fallo.
 * @param {Object} comparacion { tickers, filtros, resultadosPorTicker, descripciones }.
 */
function pintaMultiTicker(comparacion) {
    const tickers = comparacion.tickers;
    const resultados = comparacion.resultadosPorTicker;
    const codigos = ordenaFiltros(comparacion.filtros);
    const evaluaciones = evaluaTabla(tickers, codigos, resultados);
    const puntos = calculaPuntosPorTicker(tickers, evaluaciones, resultados);
    const columnas = ordenaTickers(tickers, puntos, criterioOrden);

    pintaCabecera(columnas);
    resultsTable.innerHTML = "";
    if (hayVariasEmpresas(tickers.length)) pintaFilaOrdenEntrada(columnas, tickers);
    pintaFilaPuntos(columnas, puntos);
    pintaFilaDilucion(columnas, resultados);
    for (const codigo of codigos) {
        pintaFilaFiltro(codigo, columnas, evaluaciones[codigo], comparacion.descripciones);
    }
}

/**
 * Repinta la ultima comparacion, si la hay.
 */
function repinta() {
    if (comparacionActual) pintaMultiTicker(comparacionActual);
}

/**
 * Muestra los botones de orden solo con varias empresas y marca el activo.
 */
function actualizaBotonesOrden() {
    const n = comparacionActual ? comparacionActual.tickers.length : 0;
    botonesOrden.hidden = !hayVariasEmpresas(n);
    ordenEntradaBtn.classList.toggle("activo", criterioOrden === ORDEN_ENTRADA);
    ordenPuntosBtn.classList.toggle("activo", criterioOrden === ORDEN_PUNTOS);
    ordenEntradaBtn.setAttribute("aria-pressed", String(criterioOrden === ORDEN_ENTRADA));
    ordenPuntosBtn.setAttribute("aria-pressed", String(criterioOrden === ORDEN_PUNTOS));
}

/**
 * Cambia el criterio de orden de columnas y recarga la tabla (sin descargar).
 * @param {string} criterio ORDEN_ENTRADA u ORDEN_PUNTOS.
 */
function seleccionaOrden(criterio) {
    criterioOrden = criterio;
    actualizaBotonesOrden();
    repinta();
}

/**
 * Codigos de filtro del parametro f= del screener elegido.
 * @returns {string[]|null} Codigos, o null si no hay screener ni URL.
 */
function leeFiltrosScreener() {
    let screenerURL = screenerSelect.value;
    if (screenerURL === VALOR_CUSTOM) screenerURL = customURLInput.value.trim();
    if (!screenerURL) return null;

    const qs = screenerURL.split("?")[1] || "";
    const f = new URLSearchParams(qs).get("f");
    return f ? f.split(",").map(x => x.trim()).filter(Boolean) : [];
}

/**
 * Valida el formulario y devuelve tickers y filtros, o null si no sirve.
 * @returns {{tickers:string[], filtros:string[]}|null} Entrada valida, o null.
 */
function leeEntrada() {
    const tickers = leeTickers();
    const filtros = leeFiltrosScreener();
    if (!tickers.length || filtros === null) {
        alert("Rellena el/los Ticker(s) de empresas y el Screener (o URL)");
        return null;
    }
    if (!filtros.length) {
        logMsg("AVISO: la URL del screener no contiene filtros (parametro 'f').");
        return null;
    }
    return { tickers: tickers, filtros: filtros };
}

/**
 * Deja en el log que se compara, contra que y cuanto tardara.
 * @param {string[]} tickers Empresas.
 * @param {string[]} filtros Codigos del screener.
 */
function anunciaComparacion(tickers, filtros) {
    logMsg("Comparando " + tickers.join(", ") + " contra: " +
           screenerSelect.options[screenerSelect.selectedIndex].textContent);
    logMsg("Filtros del screener (" + filtros.length + "): " + filtros.join(", "));
    // Cada ticker cuesta 1 peticion a Finviz y de 1 a 3 a SEC EDGAR, mas una
    // unica para el mapeo ticker->CIK. Las de Finviz van primero en la cola.
    logMsg("Tiempo estimado: entre " + minutosEstimados(2 * tickers.length + 1) + " y " +
           minutosEstimados(4 * tickers.length + 1) + " minuto(s) (limite del proxy: " +
           PROXY_MAX_POR_MINUTO + " peticiones/minuto). Las fichas de Finviz van primero.");
}

/**
 * Descarga ficha y dilucion de un ticker, repintando al llegar cada una.
 * @param {string} ticker Ticker de la empresa.
 * @param {Object} resultadosPorTicker Donde se guardan los resultados.
 * @returns {Promise<void>}
 */
function descargaTicker(ticker, resultadosPorTicker) {
    return Promise.all([
        descargaDatos(ticker).then(r => {
            resultadosPorTicker[ticker].datos = r ? r.datos : null;
            repinta();
        }),
        compruebaDilucion(ticker).then(d => {
            resultadosPorTicker[ticker].dilucion = d;
            repinta();
        })
    ]);
}

/**
 * Deja en el log el balance final de la comparacion.
 * @param {string[]} tickers Empresas.
 * @param {Object} resultadosPorTicker ticker -> { datos, dilucion }.
 */
function anunciaFin(tickers, resultadosPorTicker) {
    const fallidos = tickers.filter(t => !resultadosPorTicker[t].datos);
    if (fallidos.length === tickers.length) {
        logMsg("No se han podido descargar los datos de ningun ticker: el proxy CORS no respondio " +
               "con la ficha de Finviz. Intentalo de nuevo en unos minutos.");
        return;
    }
    logMsg("Comparacion finalizada para " + tickers.length + " ticker(s)" +
           (fallidos.length ? "; sin ficha de Finviz: " + fallidos.join(", ") : "") + ".");
}

/**
 * Lanza la comparacion: valida, pinta la tabla vacia y la va rellenando
 * segun llegan las descargas.
 * @returns {Promise<void>}
 */
async function runComparison() {
    log.textContent = "";
    resultsThead.innerHTML = "";
    resultsTable.innerHTML = "";
    comparacionActual = null;
    actualizaBotonesOrden();
    compareBtn.disabled = true;

    try {
        const entrada = leeEntrada();
        if (!entrada) return;
        anunciaComparacion(entrada.tickers, entrada.filtros);

        const resultadosPorTicker = {};
        for (const t of entrada.tickers) resultadosPorTicker[t] = { datos: undefined, dilucion: undefined };
        comparacionActual = {
            tickers: entrada.tickers,
            filtros: entrada.filtros,
            resultadosPorTicker: resultadosPorTicker,
            descripciones: await loadDescriptions()
        };
        actualizaBotonesOrden();
        repinta();

        await Promise.all(entrada.tickers.map(t => descargaTicker(t, resultadosPorTicker)));
        anunciaFin(entrada.tickers, resultadosPorTicker);
    } catch (e) {
        logMsg("Error inesperado: " + e.message);
    } finally {
        compareBtn.disabled = false;
    }
}

compareBtn.addEventListener("click", runComparison);
ordenEntradaBtn.addEventListener("click", () => seleccionaOrden(ORDEN_ENTRADA));
ordenPuntosBtn.addEventListener("click", () => seleccionaOrden(ORDEN_PUNTOS));
loadScreeners().then(() => {
    if (tickersURL) runComparison();
});
