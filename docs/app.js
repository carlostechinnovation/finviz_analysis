/* =========================================================================
   Comparador empresa vs screener (Finviz)
   100% cliente: no hay backend. Solo HTML + JS estatico en GitHub Pages.

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
const log = document.getElementById("log");

const SCREENER_POR_DEFECTO = "solventes";
const VALOR_CUSTOM = "__custom__";

// Tiempo maximo de espera a la llamada. Sin esto, un proxy caido bloquea ~20s.
const TIMEOUT_MS = 9000;
// Minimo de etiquetas reconocidas para dar por buena una descarga.
const MIN_CAMPOS_VALIDOS = 8;

/* -------------------------------------------------------------------------
   1) DEFINICION DE FILTROS
   Cada codigo de filtro de Finviz se traduce a:
     - finviz : etiqueta EXACTA tal y como aparece en la ficha de la empresa
     - op     : operador de comparacion
     - valor  : umbral numerico
     - texto  : lo que se muestra en la columna "Condicion Screener"
     - escala : true si el valor puede venir con sufijo K/M/B/T (Market Cap, Float)
   ------------------------------------------------------------------------- */
const FILTROS = {
    // --- Descriptivos ---
    "cap_largeunder":         { finviz: "Market Cap",    op: "<",  valor: 200e9, texto: "< 200B",  escala: true },

    // --- Fundamentales ---
    "fa_pe_u30":              { finviz: "P/E",           op: "<",  valor: 30,    texto: "< 30" },
    "fa_fpe_u20":             { finviz: "Forward P/E",   op: "<",  valor: 20,    texto: "< 20" },
    "fa_ps_o2":               { finviz: "P/S",           op: ">",  valor: 2,     texto: "> 2" },
    "fa_evsales_u6":          { finviz: "EV/Sales",      op: "<",  valor: 6,     texto: "< 6" },
    "fa_grossmargin_o10":     { finviz: "Gross Margin",  op: ">",  valor: 10,    texto: "> 10%" },
    "fa_opermargin_o5":       { finviz: "Oper. Margin",  op: ">",  valor: 5,     texto: "> 5%" },
    "fa_curratio_o1":         { finviz: "Current Ratio", op: ">",  valor: 1,     texto: "> 1" },
    "fa_debteq_u1":           { finviz: "Debt/Eq",       op: "<",  valor: 1,     texto: "< 1" },
    "fa_ltdebteq_u1":         { finviz: "LT Debt/Eq",    op: "<",  valor: 1,     texto: "< 1" },

    // --- Propiedad / liquidez ---
    "sh_instown_o30":         { finviz: "Inst Own",      op: ">",  valor: 30,    texto: "> 30%" },
    "sh_float_o1":            { finviz: "Shs Float",     op: ">",  valor: 1e6,   texto: "> 1M", escala: true },
    "sh_short_u10":           { finviz: "Short Float",   op: "<",  valor: 10,    texto: "< 10%" },
    "sh_relvol_o0.5":         { finviz: "Rel Volume",    op: ">",  valor: 0.5,   texto: "> 0.5" },

    // --- Tecnicos ---
    "ta_averagetruerange_o1": { finviz: "ATR (14)",      op: ">",  valor: 1,     texto: "> 1" },
    "ta_rsi_nos40":           { finviz: "RSI (14)",      op: ">",  valor: 40,    texto: "> 40 (no sobrevendido)" },
    "ta_sma20_pa":            { finviz: "SMA20",         op: ">",  valor: 0,     texto: "> 0% (precio sobre SMA20)" },
    // OJO: revisar este mapeo con el test de cumplimiento del README.
    // a5h se interpreta aqui como "a 5% o mas del maximo de 52 semanas",
    // y el dato "52W High" de Finviz es negativo cuando el precio esta por debajo.
    "ta_highlow52w_a5h":      { finviz: "52W High",      op: "<=", valor: -5,    texto: "<= -5% (a 5% o m\u00e1s del m\u00e1ximo)" },
    "ta_perf2_26wup":         { finviz: "Perf Half Y",   op: ">",  valor: 0,     texto: "> 0%" },
    "ta_perf_3yup":           { finviz: "Perf 3Y",       op: ">",  valor: 0,     texto: "> 0%" }
};

// Orden economico de presentacion (los filtros no listados se anaden al final)
const ORDEN = [
    "cap_largeunder",
    "fa_pe_u30", "fa_fpe_u20", "fa_ps_o2", "fa_evsales_u6",
    "fa_grossmargin_o10", "fa_opermargin_o5",
    "fa_curratio_o1", "fa_debteq_u1", "fa_ltdebteq_u1",
    "sh_instown_o30", "sh_float_o1", "sh_short_u10", "sh_relvol_o0.5",
    "ta_averagetruerange_o1", "ta_rsi_nos40", "ta_sma20_pa",
    "ta_highlow52w_a5h", "ta_perf2_26wup", "ta_perf_3yup"
];

// Etiquetas alternativas que Finviz ha usado a lo largo del tiempo
const ALIAS = {
    "Oper. Margin": ["Operating Margin", "Opern Margin", "Operating Margin (ttm)"],
    "Gross Margin": ["Gross Margin (ttm)"],
    "Shs Float": ["Float", "Shs Float / Outstanding"],
    "ATR (14)": ["ATR"],
    "RSI (14)": ["RSI"],
    "Short Float": ["Short Float / Ratio", "Short Interest Share", "Short Float / Short Ratio"],
    "Perf Half Y": ["Perf 26W", "Perf Half", "Perf Half Year"],
    "Perf 3Y": ["Perf 3 Y", "Perf 3Year"],
    "Inst Own": ["Institutional Ownership"],
    "Rel Volume": ["Rel Vol", "Relative Volume"],
    "52W High": ["52-Week High"],
    "EV/Sales": ["EV / Sales"],
    "Forward P/E": ["Fwd P/E"],
    "LT Debt/Eq": ["LT Debt/Equity"],
    "Debt/Eq": ["Debt/Equity", "Total Debt/Equity"]
};

/* -------------------------------------------------------------------------
   2) UTILIDADES
   ------------------------------------------------------------------------- */
function logMsg(msg) {
    log.textContent += "[" + new Date().toLocaleTimeString() + "] " + msg + "\n";
    log.scrollTop = log.scrollHeight;
}

function normaliza(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function limpia(s) {
    return String(s).replace(/\s+/g, " ").trim();
}

// Conjunto de etiquetas que sabemos leer -> sirve para validar una descarga
const ETIQUETAS_CONOCIDAS = new Set();
(function construyeConocidas() {
    for (const codigo of Object.keys(FILTROS)) {
        const etiqueta = FILTROS[codigo].finviz;
        ETIQUETAS_CONOCIDAS.add(normaliza(etiqueta));
        for (const alt of (ALIAS[etiqueta] || [])) ETIQUETAS_CONOCIDAS.add(normaliza(alt));
    }
})();

// Convierte "1,234.5", "12.34%", "+3.2%", "3.45T", "-" ... a numero
function aNumero(txt, escala) {
    if (txt === undefined || txt === null) return NaN;
    let s = String(txt).trim();
    if (!s || s === "-" || s === "N/A") return NaN;

    // Campos combinados tipo "0.61% / 1.20" -> nos quedamos con el primero
    s = s.split("/")[0].trim();
    s = s.replace(/,/g, "").replace(/%/g, "").replace(/\$/g, "").replace(/^\+/, "").trim();

    const m = s.match(/^(-?\d*\.?\d+)\s*([KMBT])?$/i);
    if (!m) return NaN;

    let n = parseFloat(m[1]);
    if (escala && m[2]) {
        n *= { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()];
    }
    return n;
}

function compara(valor, op, umbral) {
    switch (op) {
        case ">":  return valor >  umbral;
        case ">=": return valor >= umbral;
        case "<":  return valor <  umbral;
        case "<=": return valor <= umbral;
    }
    return null;
}

// Busca una etiqueta en los datos de la empresa, probando alias y normalizacion
function buscaValor(datos, etiqueta) {
    if (datos[etiqueta] !== undefined) return datos[etiqueta];

    for (const alt of (ALIAS[etiqueta] || [])) {
        if (datos[alt] !== undefined) return datos[alt];
    }

    const objetivo = normaliza(etiqueta);
    for (const k of Object.keys(datos)) {
        if (normaliza(k) === objetivo) return datos[k];
    }
    return undefined;
}

/* -------------------------------------------------------------------------
   3) EXTRACCION DE DATOS
   ------------------------------------------------------------------------- */

// Recorre TODAS las tablas del documento buscando pares clave/valor.
// No depende del nombre de clase "snapshot-table2", que Finviz ya ha cambiado.
function extraeDatosHTML(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const datos = {};

    doc.querySelectorAll("tr").forEach(tr => {
        const celdas = Array.from(tr.children)
            .filter(c => c.tagName === "TD" || c.tagName === "TH");
        if (celdas.length < 2 || celdas.length % 2 !== 0) return;

        for (let i = 0; i + 1 < celdas.length; i += 2) {
            const clave = limpia(celdas[i].textContent);
            const valor = limpia(celdas[i + 1].textContent);
            if (!clave || !valor) continue;
            if (clave.length > 32) continue;
            if (/^[\d.,%+-]+$/.test(clave)) continue;   // la "clave" es un numero -> no es un par
            if (datos[clave] === undefined) datos[clave] = valor;
        }
    });
    return datos;
}

function cuentaConocidos(datos) {
    let n = 0;
    for (const k of Object.keys(datos)) {
        if (ETIQUETAS_CONOCIDAS.has(normaliza(k))) n++;
    }
    return n;
}

/* -------------------------------------------------------------------------
   4) DESCARGA VIA PROXY CORS
   GitHub Pages no puede llamar a finviz.com directamente (CORS) y no hay
   backend propio, asi que se usa un unico proxy publico con una unica
   llamada web (sin reintentos en paralelo).
   ------------------------------------------------------------------------- */
function construyeURLProxy(objetivo) {
    return "https://api.allorigins.win/raw?url=" + encodeURIComponent(objetivo);
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

    const datos = extraeDatosHTML(cuerpo);
    const validos = cuentaConocidos(datos);
    if (validos < MIN_CAMPOS_VALIDOS) {
        logMsg("  [FALLO] solo " + validos + " campos reconocidos (" + cuerpo.length + " bytes)");
        return null;
    }

    logMsg("  [OK] " + validos + " campos reconocidos");
    return { datos: datos, validos: validos };
}

/* -------------------------------------------------------------------------
   5) CARGA DE CSVs
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

function buscaDescripcion(descripciones, etiqueta) {
    if (descripciones[etiqueta]) return descripciones[etiqueta];
    for (const alt of (ALIAS[etiqueta] || [])) {
        if (descripciones[alt]) return descripciones[alt];
    }
    const objetivo = normaliza(etiqueta);
    for (const k of Object.keys(descripciones)) {
        if (normaliza(k) === objetivo) return descripciones[k];
    }
    return "";
}

/* -------------------------------------------------------------------------
   6) COMPARACION
   ------------------------------------------------------------------------- */
function textoPlano(s) {
    const d = document.createElement("div");
    d.textContent = String(s === undefined || s === null ? "" : s);
    return d.innerHTML;
}

async function pinta(ticker, filtros, datos) {
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

    resumenDiv.textContent =
        ticker + ": " + ok + " CUMPLE - " + nok + " INCUMPLE - " + na + " N/A" +
        (nok === 0 && na === 0 ? " -> la empresa pasa todos los criterios del screener." : "");
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

        const r = await descargaDatos(ticker);
        if (!r) {
            resumenDiv.textContent =
                "No se han podido descargar los datos de " + ticker +
                ": el proxy CORS no respondi\u00f3 con la ficha de Finviz. " +
                "Revisa el log e int\u00e9ntalo de nuevo en unos minutos.";
            logMsg("La descarga ha fallado.");
            return;
        }

        logMsg("Datos de la empresa extraidos: " + Object.keys(r.datos).length + " campos");

        await pinta(ticker, filtros, r.datos);

    } catch (e) {
        logMsg("Error inesperado: " + e.message);
        resumenDiv.textContent = "Error inesperado: " + e.message;
    } finally {
        compareBtn.disabled = false;
    }
}

compareBtn.addEventListener("click", runComparison);
loadScreeners();
