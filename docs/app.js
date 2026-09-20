/* =========================================================================
   Comparador empresas vs screener (Finviz)
   100% cliente: no hay backend. Solo HTML + JS estatico en GitHub Pages.

   Admite varios tickers a la vez (separados por comas): cada ticker es una
   columna de la tabla de resultados.

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
const TIMEOUT_MS = 20000;
// Minimo de etiquetas reconocidas para dar por buena una descarga.
const MIN_CAMPOS_VALIDOS = 8;

function logMsg(msg) {
    log.textContent += "[" + new Date().toLocaleTimeString() + "] " + msg + "\n";
    log.scrollTop = log.scrollHeight;
}

/* -------------------------------------------------------------------------
   DESCARGA VIA PROXY CORS
   GitHub Pages no puede llamar a finviz.com directamente (CORS) y no hay
   backend propio, asi que se usa un unico proxy publico con una unica
   llamada web por ticker (sin reintentos). r.jina.ai renderiza la pagina en
   su servidor y la devuelve como texto/markdown con cabeceras CORS abiertas.
   ------------------------------------------------------------------------- */
function construyeURLProxy(objetivo) {
    return "https://r.jina.ai/" + objetivo;
}

async function fetchConTimeout(url, ms) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { cache: "no-store", signal: ctrl.signal, redirect: "follow" });
    } finally {
        clearTimeout(id);
    }
}

// Descarga la ficha de Finviz para el ticker con una unica llamada web.
async function descargaDatos(ticker) {
    const objetivo = "https://finviz.com/quote.ashx?t=" + ticker + "&p=d";
    const url = construyeURLProxy(objetivo);

    logMsg("Descargando datos de " + ticker + " (timeout " + (TIMEOUT_MS / 1000) + "s)...");

    let resp;
    try {
        resp = await fetchConTimeout(url, TIMEOUT_MS);
    } catch (e) {
        const motivo = e.name === "AbortError" ? "timeout " + (TIMEOUT_MS / 1000) + "s" : e.message;
        logMsg("  [" + ticker + "] [FALLO] " + motivo);
        return null;
    }

    if (!resp.ok) {
        logMsg("  [" + ticker + "] [FALLO] HTTP " + resp.status);
        return null;
    }

    const cuerpo = await resp.text();
    if (!cuerpo || cuerpo.length < 200) {
        logMsg("  [" + ticker + "] [FALLO] respuesta vacia");
        return null;
    }

    const datos = extraeDatosMarkdown(cuerpo);
    const validos = cuentaConocidos(datos);
    if (validos < MIN_CAMPOS_VALIDOS) {
        logMsg("  [" + ticker + "] [FALLO] solo " + validos + " campos reconocidos (" + cuerpo.length + " bytes)");
        return null;
    }

    logMsg("  [" + ticker + "] [OK] " + validos + " campos reconocidos");
    return { datos: datos, validos: validos };
}

/* -------------------------------------------------------------------------
   DETECCION DE DILUCION (SEC EDGAR)
   ------------------------------------------------------------------------- */

// Mapeo ticker -> CIK. Se descarga una unica vez por sesion (fichero de la
// SEC con todas las empresas) y se cachea en memoria.
let tickerCikCache = null;
async function resuelveCIK(ticker) {
    if (!tickerCikCache) {
        tickerCikCache = {};
        try {
            const resp = await fetchConTimeout(
                construyeURLProxy("https://www.sec.gov/files/company_tickers.json"), TIMEOUT_MS);
            const json = extraeJSON(await resp.text());
            if (!json) throw new Error("respuesta sin JSON reconocible");
            for (const clave of Object.keys(json)) {
                const item = json[clave];
                if (item && item.ticker && item.cik_str !== undefined) {
                    tickerCikCache[String(item.ticker).toUpperCase()] = String(item.cik_str).padStart(10, "0");
                }
            }
        } catch (e) {
            logMsg("Dilucion: no se pudo descargar el mapeo ticker->CIK de SEC EDGAR (" + e.message + ")");
        }
    }
    return tickerCikCache[ticker.toUpperCase()] || null;
}

// Descarga el historico de acciones en circulacion desde la API XBRL de la
// SEC, probando varias etiquetas contables porque no todas las empresas
// informan bajo la misma (algunas usan dei:EntityCommonStockSharesOutstanding
// en vez de us-gaap:CommonStockSharesOutstanding).
async function descargaHistoricoShares(cik) {
    for (const ruta of XBRL_TAGS_SHARES) {
        const objetivo = "https://data.sec.gov/api/xbrl/companyconcept/CIK" + cik + "/" + ruta + ".json";
        try {
            const resp = await fetchConTimeout(construyeURLProxy(objetivo), TIMEOUT_MS);
            if (!resp.ok) continue;
            const json = extraeJSON(await resp.text());
            if (!json) continue;
            const puntos = (json.units && json.units.shares) || [];
            if (puntos.length >= 2) return puntos;
        } catch (e) {
            // Prueba con la siguiente etiqueta XBRL de la lista
        }
    }
    return null;
}

// Orquesta la comprobacion completa para un ticker. Nunca lanza: si algo
// falla (ticker no listado en SEC, sin historico, etc.) devuelve null y solo
// deja constancia en el log, para no romper la comparacion contra Finviz.
async function compruebaDilucion(ticker) {
    try {
        const cik = await resuelveCIK(ticker);
        if (!cik) {
            logMsg("  [" + ticker + "] Dilucion: ticker no encontrado en el mapeo CIK de SEC EDGAR.");
            return null;
        }
        const puntos = await descargaHistoricoShares(cik);
        if (!puntos) {
            logMsg("  [" + ticker + "] Dilucion: SEC EDGAR no tiene historico de acciones en circulacion.");
            return null;
        }
        const r = calculaDilucion(puntos);
        if (!r) {
            logMsg("  [" + ticker + "] Dilucion: no hay dos periodos separados ~1 anio para comparar.");
            return null;
        }
        logMsg("  [" + ticker + "] Dilucion: acciones en circulacion " + r.anterior.val.toLocaleString() +
               " (" + r.anterior.end + ") -> " + r.actual.val.toLocaleString() + " (" + r.actual.end + ") = " +
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
// del umbral, rojo con el aviso si lo supera, naranja si no hay datos.
function pintaFilaDilucion(tickers, resultadosPorTicker) {
    const celdasTicker = tickers.map(t => {
        const d = resultadosPorTicker[t].dilucion;
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

async function pintaMultiTicker(tickers, filtros, resultadosPorTicker) {
    const descripciones = await loadDescriptions();

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

    const lineas = tickers.map(t => {
        if (!resultadosPorTicker[t].datos) {
            return t + ": sin datos (fall\u00f3 la descarga de Finviz).";
        }
        const c = contadores[t];
        const d = resultadosPorTicker[t].dilucion;
        const veto = d && d.pct >= UMBRAL_DILUCION_PCT;
        return t + ": " + c.ok + " CUMPLE - " + c.nok + " INCUMPLE - " + c.na + " N/A" +
            (c.nok === 0 && c.na === 0 ? " -> pasa todos los criterios del screener." : "") +
            (veto ? " \u26a0 DESCARTAR por diluci\u00f3n fuerte (ver fila roja)." : "");
    });
    resumenDiv.textContent = lineas.join("\n");
    logMsg("Comparacion finalizada para " + tickers.length + " ticker(s).");
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

        const pares = await Promise.all(tickers.map(async (ticker) => {
            const [r, dilucion] = await Promise.all([
                descargaDatos(ticker),
                compruebaDilucion(ticker)
            ]);
            return [ticker, { datos: r ? r.datos : null, dilucion: dilucion }];
        }));
        const resultadosPorTicker = Object.fromEntries(pares);

        if (tickers.every(t => !resultadosPorTicker[t].datos)) {
            resumenDiv.textContent =
                "No se han podido descargar los datos de ning\u00fan ticker: el proxy CORS no respondi\u00f3 " +
                "con la ficha de Finviz. Revisa el log e int\u00e9ntalo de nuevo en unos minutos.";
            logMsg("La descarga ha fallado para todos los tickers.");
            return;
        }

        await pintaMultiTicker(tickers, filtros, resultadosPorTicker);

    } catch (e) {
        logMsg("Error inesperado: " + e.message);
        resumenDiv.textContent = "Error inesperado: " + e.message;
    } finally {
        compareBtn.disabled = false;
    }
}

compareBtn.addEventListener("click", runComparison);
loadScreeners();
