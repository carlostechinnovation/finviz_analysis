/* =========================================================================
   Comparador empresas vs screener (Finviz)
   100% cliente: no hay backend. Solo HTML + JS estatico en GitHub Pages.

   Admite varios tickers a la vez (separados por comas): cada ticker es una
   columna de la tabla de resultados.

   Si la URL trae ?tickers=AAA,BBB,CCC se precarga el textbox y se lanza la
   comparacion sola, sin esperar un clic (asi funciona el enlace que manda
   DIIA en su email con la Seleccion del dia).

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
const resumenDiv = document.getElementById("resumen");
const log = document.getElementById("log");

const SCREENER_POR_DEFECTO = "solventes";
const VALOR_CUSTOM = "__custom__";

// Precarga el textbox de tickers desde el parametro de URL ?tickers=... (p.ej.
// el enlace del email resumen de DIIA con su Seleccion del dia) y, si llega,
// lanza la comparacion automaticamente en cuanto se cargan los screeners
// (mas abajo), para ver directo la tabla de solvencia sin un clic extra.
const tickersURL = new URLSearchParams(location.search).get("tickers");
if (tickersURL) tickerInput.value = tickersURL;

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

function construyeURLProxy(objetivo) {
    return "https://r.jina.ai/" + objetivo;
}

// Descarga el cuerpo completo con un limite de tiempo que cubre tambien la
// lectura del cuerpo, no solo la llegada de las cabeceras. Nunca lanza.
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

// Descarga la ficha de Finviz del ticker.
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

// Devuelve el CIK, "" si SEC no lista el ticker, o null si no hay mapeo.
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
// Rellena screenerSelect a partir del texto CSV (SCREENER|URL, con cabecera).
// Devuelve true si ha anadido al menos un screener.
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

    customURLInput.style.display = screenerSelect.value === VALOR_CUSTOM ? "inline-block" : "none";
}

screenerSelect.addEventListener("change", () => {
    customURLInput.style.display = screenerSelect.value === VALOR_CUSTOM ? "inline-block" : "none";
});

let descripcionesCache = null;
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
   lo que indica CUMPLE / INCUMPLE / N-A, o el aviso de dilucion en la
   primera fila.
   ------------------------------------------------------------------------- */
function textoPlano(s) {
    const d = document.createElement("div");
    d.textContent = String(s === undefined || s === null ? "" : s);
    return d.innerHTML;
}

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

// Ficha de Finviz en velas semanales para el ticker (p.ej. AAPL ->
// https://finviz.com/stock?t=AAPL&p=w).
function urlFinvizSemanal(ticker) {
    return "https://finviz.com/stock?t=" + encodeURIComponent(ticker) + "&p=w";
}

function pintaCabecera(tickers) {
    const th = ["Filtro", "Condici\u00f3n Screener", "Descripci\u00f3n"]
        .map(t => "<th>" + textoPlano(t) + "</th>")
        .concat(tickers.map(t =>
            '<th><a href="' + urlFinvizSemanal(t) + '" target="_blank" rel="noopener noreferrer">' +
            textoPlano(t) + "</a></th>"))
        .join("");
    resultsThead.innerHTML = "<tr>" + th + "</tr>";
}

// Primera fila de la tabla: aviso de dilucion (independiente del screener).
// Cada celda muestra el porcentaje de esa empresa: verde si esta por debajo
// del umbral, rojo con el aviso si lo supera, naranja si no hay datos o si
// todavia no ha llegado (dilucion === undefined).
function pintaFilaDilucion(tickers, resultadosPorTicker) {
    const celdasTicker = tickers.map(t => {
        const d = resultadosPorTicker[t].dilucion;
        if (d === undefined) {
            return '<td class="na">' + textoPlano("(pendiente)") + "</td>";
        }
        if (!d) {
            return '<td class="na">N/D</td>';
        }
        const pctTexto = (d.pct >= 0 ? "+" : "") + d.pct.toFixed(1) + "%";
        if (d.pct >= UMBRAL_DILUCION_PCT) {
            return '<td class="dilucion-alerta">' +
                textoPlano("ALERTA POR DILUCI\u00d3N: " + pctTexto + " en 1 a\u00f1o") + "</td>";
        }
        return '<td class="ok">' + textoPlano(pctTexto) + "</td>";
    }).join("");

    const tr = document.createElement("tr");
    tr.innerHTML =
        "<td>" + textoPlano("Diluci\u00f3n en 1 a\u00f1o (SEC EDGAR)") + "</td>" +
        "<td>" + textoPlano("< " + UMBRAL_DILUCION_PCT + "% de aumento") + "</td>" +
        "<td>" + textoPlano(
            "Aumento de acciones en circulaci\u00f3n en ~1 a\u00f1o, seg\u00fan SEC EDGAR " +
            "(no Finviz). N/D = sin datos suficientes en SEC EDGAR. Ver README \u00a77.4."
        ) + "</td>" +
        celdasTicker;
    resultsTable.appendChild(tr);
}

// Pinta la tabla con lo que haya llegado hasta ahora. Se llama cada vez que
// termina una descarga, asi la tabla se va rellenando mientras la cola del
// proxy despacha el resto. En resultadosPorTicker[t], datos/dilucion valen
// undefined mientras estan pendientes y null si la descarga fallo.
function pintaMultiTicker(tickers, filtros, resultadosPorTicker, descripciones) {
    pintaCabecera(tickers);
    resultsTable.innerHTML = "";
    pintaFilaDilucion(tickers, resultadosPorTicker);

    const ordenados = ORDEN.filter(c => filtros.includes(c))
        .concat(filtros.filter(c => !ORDEN.includes(c)));

    const contadores = {};
    for (const t of tickers) contadores[t] = { ok: 0, nok: 0, na: 0 };

    for (const codigo of ordenados) {
        const def = FILTROS[codigo];
        const etiqueta = def ? def.finviz : codigo;
        const condicion = def ? def.texto : "(filtro no soportado)";

        const porTicker = tickers.map(t => {
            const datos = resultadosPorTicker[t].datos;
            if (datos === undefined) return { texto: "(descargando)", estado: "na" };
            if (!datos) return { texto: "(sin datos)", estado: "na" };

            const bruto = def ? buscaValor(datos, etiqueta) : undefined;
            const mostrado = (bruto === undefined || bruto === "") ? "N/A" : bruto;

            let estado = "na";
            if (def) {
                const num = aNumero(bruto, def.escala);
                if (!isNaN(num)) {
                    const r = compara(num, def.op, def.valor);
                    if (r !== null) estado = r ? "ok" : "nok";
                }
            }
            return { texto: String(mostrado), estado: estado };
        });

        tickers.forEach((t, i) => {
            if (!resultadosPorTicker[t].datos) return;
            const estado = porTicker[i].estado;
            if (estado === "ok") contadores[t].ok++;
            else if (estado === "nok") contadores[t].nok++;
            else contadores[t].na++;
        });

        const celdasTicker = porTicker.map(v => {
            return '<td class="' + v.estado + '">' + textoPlano(v.texto) + "</td>";
        }).join("");

        const tr = document.createElement("tr");
        tr.innerHTML =
            "<td>" + textoPlano(etiqueta) + "</td>" +
            "<td>" + textoPlano(condicion) + "</td>" +
            "<td>" + textoPlano(buscaDescripcion(descripciones, etiqueta)) + "</td>" +
            celdasTicker;
        resultsTable.appendChild(tr);
    }

    const pendientesFinviz = tickers.filter(t => resultadosPorTicker[t].datos === undefined).length;
    const pendientesSEC = tickers.filter(t => resultadosPorTicker[t].dilucion === undefined).length;
    const lineas = [];
    if (pendientesFinviz || pendientesSEC) {
        lineas.push("En curso: faltan " + pendientesFinviz + " ficha(s) de Finviz y " + pendientesSEC +
            " comprobaci\u00f3n(es) de diluci\u00f3n. El proxy admite " + PROXY_MAX_POR_MINUTO +
            " peticiones/minuto, as\u00ed que la tabla se va completando sola.");
    }
    for (const t of tickers) {
        const datos = resultadosPorTicker[t].datos;
        if (datos === undefined) {
            lineas.push(t + ": descargando...");
            continue;
        }
        if (!datos) {
            lineas.push(t + ": sin datos (fall\u00f3 la descarga de Finviz tras reintentar; ver log).");
            continue;
        }
        const c = contadores[t];
        const d = resultadosPorTicker[t].dilucion;
        const veto = d && d.pct >= UMBRAL_DILUCION_PCT;
        lineas.push(t + ": " + c.ok + " CUMPLE - " + c.nok + " INCUMPLE - " + c.na + " N/A" +
            (c.nok === 0 && c.na === 0 ? " -> pasa todos los criterios del screener." : "") +
            (veto ? " \u26a0 DESCARTAR por diluci\u00f3n fuerte (ver fila roja)." : ""));
    }
    resumenDiv.textContent = lineas.join("\n");
}

function leeFiltrosScreener() {
    let screenerURL = screenerSelect.value;
    if (screenerURL === VALOR_CUSTOM) screenerURL = customURLInput.value.trim();
    if (!screenerURL) return null;

    const qs = screenerURL.split("?")[1] || "";
    const f = new URLSearchParams(qs).get("f");
    return f ? f.split(",").map(x => x.trim()).filter(Boolean) : [];
}

async function runComparison() {
    log.textContent = "";
    resultsTable.innerHTML = "";
    resumenDiv.textContent = "";
    compareBtn.disabled = true;

    try {
        const tickers = leeTickers();
        const filtros = leeFiltrosScreener();

        if (!tickers.length || filtros === null) {
            alert("Rellena el/los Ticker(s) de empresas y el Screener (o URL)");
            return;
        }
        if (!filtros.length) {
            resumenDiv.textContent = "La URL del screener no contiene filtros (par\u00e1metro 'f').";
            logMsg("AVISO: la URL del screener no tiene parametro 'f'.");
            return;
        }

        logMsg("Comparando " + tickers.join(", ") + " contra: " +
               screenerSelect.options[screenerSelect.selectedIndex].textContent);
        logMsg("Filtros del screener (" + filtros.length + "): " + filtros.join(", "));

        // Cada ticker cuesta 1 peticion a Finviz y de 1 a 3 a SEC EDGAR, mas una
        // unica para el mapeo ticker->CIK. Las de Finviz van primero en la cola.
        logMsg("Tiempo estimado: entre " + minutosEstimados(2 * tickers.length + 1) + " y " +
               minutosEstimados(4 * tickers.length + 1) + " minuto(s) (limite del proxy: " +
               PROXY_MAX_POR_MINUTO + " peticiones/minuto). Las fichas de Finviz van primero.");

        const descripciones = await loadDescriptions();
        const resultadosPorTicker = {};
        for (const t of tickers) resultadosPorTicker[t] = { datos: undefined, dilucion: undefined };
        const repinta = () => pintaMultiTicker(tickers, filtros, resultadosPorTicker, descripciones);
        repinta();

        await Promise.all(tickers.map((ticker) => Promise.all([
            descargaDatos(ticker).then(r => {
                resultadosPorTicker[ticker].datos = r ? r.datos : null;
                repinta();
            }),
            compruebaDilucion(ticker).then(d => {
                resultadosPorTicker[ticker].dilucion = d;
                repinta();
            })
        ])));

        if (tickers.every(t => !resultadosPorTicker[t].datos)) {
            resumenDiv.textContent =
                "No se han podido descargar los datos de ning\u00fan ticker: el proxy CORS no respondi\u00f3 " +
                "con la ficha de Finviz. Revisa el log e int\u00e9ntalo de nuevo en unos minutos.";
            logMsg("La descarga ha fallado para todos los tickers.");
            return;
        }
        const fallidos = tickers.filter(t => !resultadosPorTicker[t].datos);
        logMsg("Comparacion finalizada para " + tickers.length + " ticker(s)" +
               (fallidos.length ? "; sin ficha de Finviz: " + fallidos.join(", ") : "") + ".");

    } catch (e) {
        logMsg("Error inesperado: " + e.message);
        resumenDiv.textContent = "Error inesperado: " + e.message;
    } finally {
        compareBtn.disabled = false;
    }
}

compareBtn.addEventListener("click", runComparison);
loadScreeners().then(() => {
    if (tickersURL) runComparison();
});
