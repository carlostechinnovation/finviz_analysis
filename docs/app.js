/* =========================================================================
   Comparador empresa vs screener (Finviz)
   100% cliente: no hay backend. Solo HTML + JS estatico en GitHub Pages.

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
const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
const resumenDiv = document.getElementById("resumen");
const alertaDilucionDiv = document.getElementById("alertaDilucion");
const log = document.getElementById("log");

const SCREENER_POR_DEFECTO = "solventes";
const VALOR_CUSTOM = "__custom__";

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
   llamada web (sin reintentos en paralelo). r.jina.ai renderiza la pagina
   en su servidor y la devuelve como texto/markdown con cabeceras CORS
   abiertas.
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
        logMsg("  [FALLO] " + motivo);
        return null;
    }

    if (!resp.ok) {
        logMsg("  [FALLO] HTTP " + resp.status);
        return null;
    }

    const cuerpo = await resp.text();
    if (!cuerpo || cuerpo.length < 200) {
        logMsg("  [FALLO] respuesta vacia");
        return null;
    }

    const datos = extraeDatosMarkdown(cuerpo);
    const validos = cuentaConocidos(datos);
    if (validos < MIN_CAMPOS_VALIDOS) {
        logMsg("  [FALLO] solo " + validos + " campos reconocidos (" + cuerpo.length + " bytes)");
        return null;
    }

    logMsg("  [OK] " + validos + " campos reconocidos");
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
            logMsg("Dilucion: ticker no encontrado en el mapeo CIK de SEC EDGAR.");
            return null;
        }
        const puntos = await descargaHistoricoShares(cik);
        if (!puntos) {
            logMsg("Dilucion: SEC EDGAR no tiene historico de acciones en circulacion para este valor.");
            return null;
        }
        const r = calculaDilucion(puntos);
        if (!r) {
            logMsg("Dilucion: no hay dos periodos separados ~1 anio para comparar.");
            return null;
        }
        logMsg("Dilucion: acciones en circulacion " + r.anterior.val.toLocaleString() + " (" + r.anterior.end +
               ") -> " + r.actual.val.toLocaleString() + " (" + r.actual.end + ") = " +
               (r.pct >= 0 ? "+" : "") + r.pct.toFixed(1) + "%");
        return r;
    } catch (e) {
        logMsg("Dilucion: error inesperado (" + e.message + ")");
        return null;
    }
}

/* -------------------------------------------------------------------------
   CARGA DE CSVs
   ------------------------------------------------------------------------- */
async function loadScreeners() {
    screenerSelect.innerHTML = "";

    const optCustom = document.createElement("option");
    optCustom.value = VALOR_CUSTOM;
    optCustom.textContent = "CUSTOM (URL manual)";
    screenerSelect.appendChild(optCustom);

    try {
        const resp = await fetch("urls_screeners_finviz.csv", { cache: "no-store" });
        const text = (await resp.text()).replace(/\r/g, "");
        const lines = text.split("\n").slice(1);

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

            if (nombre.toLowerCase() === SCREENER_POR_DEFECTO) porDefecto = option;
            if (!porDefecto && screenerSelect.options.length === 2) porDefecto = option;
        }

        if (porDefecto) screenerSelect.value = porDefecto.value;
    } catch (e) {
        logMsg("No se pudo cargar urls_screeners_finviz.csv: " + e.message);
    }

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
   COMPARACION
   ------------------------------------------------------------------------- */
function textoPlano(s) {
    const d = document.createElement("div");
    d.textContent = String(s === undefined || s === null ? "" : s);
    return d.innerHTML;
}

// Pinta (o esconde) el aviso rojo de dilucion fuerte, independiente del
// screener: una empresa puede cumplir todos los filtros de Finviz y aun asi
// estar diluyendo agresivamente a sus accionistas.
function pintaAlertaDilucion(dilucion) {
    if (!dilucion || dilucion.pct < UMBRAL_DILUCION_PCT) {
        alertaDilucionDiv.classList.remove("activa");
        alertaDilucionDiv.textContent = "";
        return;
    }
    alertaDilucionDiv.textContent =
        "\u26a0 ALERTA DILUCI\u00d3N: acciones en circulaci\u00f3n +" + dilucion.pct.toFixed(1) + "% en 1 a\u00f1o " +
        "(" + dilucion.anterior.val.toLocaleString() + " el " + dilucion.anterior.end + " \u2192 " +
        dilucion.actual.val.toLocaleString() + " el " + dilucion.actual.end + "). " +
        "DESCARTAR: aumento fuerte de acciones aunque los beneficios mejoren.";
    alertaDilucionDiv.classList.add("activa");
}

async function pinta(ticker, filtros, datos, dilucion) {
    const descripciones = await loadDescriptions();

    const ordenados = ORDEN.filter(c => filtros.includes(c))
        .concat(filtros.filter(c => !ORDEN.includes(c)));

    let ok = 0, nok = 0, na = 0;

    for (const codigo of ordenados) {
        const def = FILTROS[codigo];
        const etiqueta = def ? def.finviz : codigo;
        const condicion = def ? def.texto : "(filtro no soportado)";

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

        if (estado === "ok") ok++;
        else if (estado === "nok") nok++;
        else na++;

        const etiquetaTexto = estado === "ok" ? "CUMPLE" : (estado === "nok" ? "INCUMPLE" : "N/A");

        const tr = document.createElement("tr");
        tr.innerHTML =
            "<td>" + textoPlano(etiqueta) + "</td>" +
            "<td>" + textoPlano(condicion) + "</td>" +
            "<td>" + textoPlano(mostrado) + "</td>" +
            '<td class="' + estado + '">' + etiquetaTexto + "</td>" +
            "<td>" + textoPlano(buscaDescripcion(descripciones, etiqueta)) + "</td>";
        resultsTable.appendChild(tr);
    }

    const veto = dilucion && dilucion.pct >= UMBRAL_DILUCION_PCT;
    resumenDiv.textContent =
        ticker + ": " + ok + " CUMPLE - " + nok + " INCUMPLE - " + na + " N/A" +
        (nok === 0 && na === 0 ? " -> la empresa pasa todos los criterios del screener." : "") +
        (veto ? " \u26a0 DESCARTAR por diluci\u00f3n fuerte (ver aviso rojo)." : "");
    logMsg("Comparacion finalizada: " + ok + " OK / " + nok + " NOK / " + na + " N/A");
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
    pintaAlertaDilucion(null);
    compareBtn.disabled = true;

    try {
        const ticker = tickerInput.value.trim().toUpperCase();
        const filtros = leeFiltrosScreener();

        if (!ticker || filtros === null) {
            alert("Rellena Ticker y Screener (o URL)");
            return;
        }
        if (!filtros.length) {
            resumenDiv.textContent = "La URL del screener no contiene filtros (par\u00e1metro 'f').";
            logMsg("AVISO: la URL del screener no tiene parametro 'f'.");
            return;
        }

        logMsg("Comparando " + ticker + " contra: " +
               screenerSelect.options[screenerSelect.selectedIndex].textContent);
        logMsg("Filtros del screener (" + filtros.length + "): " + filtros.join(", "));

        const [r, dilucion] = await Promise.all([
            descargaDatos(ticker),
            compruebaDilucion(ticker)
        ]);
        if (!r) {
            resumenDiv.textContent =
                "No se han podido descargar los datos de " + ticker +
                ": el proxy CORS no respondi\u00f3 con la ficha de Finviz. " +
                "Revisa el log e int\u00e9ntalo de nuevo en unos minutos.";
            logMsg("La descarga ha fallado.");
            return;
        }

        logMsg("Datos de la empresa extraidos: " + Object.keys(r.datos).length + " campos");

        pintaAlertaDilucion(dilucion);
        await pinta(ticker, filtros, r.datos, dilucion);

    } catch (e) {
        logMsg("Error inesperado: " + e.message);
        resumenDiv.textContent = "Error inesperado: " + e.message;
    } finally {
        compareBtn.disabled = false;
    }
}

compareBtn.addEventListener("click", runComparison);
loadScreeners();
