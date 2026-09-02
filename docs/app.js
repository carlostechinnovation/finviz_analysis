/* =========================================================================
   Comparador empresa vs screener (Finviz)
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

/* -------------------------------------------------------------------------
   1) DEFINICION DE FILTROS
   Cada codigo de filtro de Finviz se traduce a:
     - finviz : etiqueta EXACTA tal y como aparece en la ficha de la empresa
     - op     : operador de comparacion
     - valor  : umbral numerico
     - texto  : lo que se muestra en la columna "Condición Screener"
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
    // a5h = "5% or more below High"  ->  el dato "52W High" de Finviz es negativo
    "ta_highlow52w_a5h":      { finviz: "52W High",      op: "<=", valor: -5,    texto: "≤ -5% (a 5% o más del máximo)" },
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
    "Oper. Margin": ["Operating Margin", "Opern Margin"],
    "Shs Float": ["Float", "Shs Float / Outstanding"],
    "ATR (14)": ["ATR"],
    "RSI (14)": ["RSI"],
    "Short Float": ["Short Float / Ratio", "Short Interest Share"],
    "Perf Half Y": ["Perf 26W", "Perf Half"],
    "Inst Own": ["Institutional Ownership"]
};

/* -------------------------------------------------------------------------
   2) UTILIDADES
   ------------------------------------------------------------------------- */
function logMsg(msg) {
    log.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    log.scrollTop = log.scrollHeight;
}

function normaliza(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
   3) DESCARGA DE LA FICHA DE FINVIZ (via proxy CORS)
   GitHub Pages no puede llamar a finviz.com directamente (CORS), y el proxy
   antiguo "corsproxy.io/?<url>" ya no funciona sin API key desde un dominio
   publico. Se prueban varios proxies y varias URLs de Finviz hasta que uno
   devuelva una pagina con la tabla de datos.
   ------------------------------------------------------------------------- */
const PROXIES = [
    { nombre: "allorigins", build: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
    { nombre: "codetabs",   build: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
    { nombre: "corsproxy",  build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
    { nombre: "thingproxy", build: u => `https://thingproxy.freeboard.io/fetch/${u}` }
];

async function descargaFicha(ticker) {
    const objetivos = [
        `https://finviz.com/quote.ashx?t=${ticker}&p=d`,
        `https://finviz.com/stock?t=${ticker}&p=d`
    ];

    for (const objetivo of objetivos) {
        for (const proxy of PROXIES) {
            const url = proxy.build(objetivo);
            try {
                logMsg(`Intentando ${proxy.nombre} -> ${objetivo}`);
                const resp = await fetch(url, { cache: "no-store" });
                if (!resp.ok) {
                    logMsg(`  ✗ HTTP ${resp.status}`);
                    continue;
                }
                const html = await resp.text();
                if (html && html.indexOf("snapshot-table2") !== -1) {
                    logMsg(`  ✓ OK con ${proxy.nombre} (${html.length} bytes)`);
                    return html;
                }
                logMsg(`  ✗ Respuesta sin tabla de datos (${html.length} bytes)`);
            } catch (e) {
                logMsg(`  ✗ Error: ${e.message}`);
            }
        }
    }
    return null;
}

function extraeDatos(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const datos = {};

    const tablas = doc.querySelectorAll("table.snapshot-table2, .snapshot-table2");
    tablas.forEach(tabla => {
        tabla.querySelectorAll("tr").forEach(tr => {
            const tds = Array.from(tr.querySelectorAll("td"));
            for (let i = 0; i + 1 < tds.length; i += 2) {
                const clave = tds[i].textContent.replace(/\s+/g, " ").trim();
                const valor = tds[i + 1].textContent.replace(/\s+/g, " ").trim();
                if (clave) datos[clave] = valor;
            }
        });
    });
    return datos;
}

/* -------------------------------------------------------------------------
   4) CARGA DE CSVs
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

        // Screener seleccionado por defecto
        if (porDefecto) screenerSelect.value = porDefecto.value;
    } catch (e) {
        logMsg(`No se pudo cargar urls_screeners_finviz.csv: ${e.message}`);
    }

    customURLInput.style.display = screenerSelect.value === VALOR_CUSTOM ? "inline-block" : "none";
}

screenerSelect.addEventListener("change", () => {
    customURLInput.style.display = screenerSelect.value === VALOR_CUSTOM ? "inline-block" : "none";
});

async function loadDescriptions() {
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
        logMsg(`No se pudo cargar descripcion_filtros.csv: ${e.message}`);
    }
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
   5) COMPARACION
   ------------------------------------------------------------------------- */
async function runComparison() {
    log.textContent = "";
    resultsTable.innerHTML = "";
    resumenDiv.textContent = "";
    compareBtn.disabled = true;

    try {
        const ticker = tickerInput.value.trim().toUpperCase();

        let screenerURL = screenerSelect.value;
        if (screenerURL === VALOR_CUSTOM) screenerURL = customURLInput.value.trim();

        if (!ticker || !screenerURL) {
            alert("Rellena Ticker y Screener (o URL)");
            return;
        }

        logMsg(`Comparando ${ticker} contra: ${screenerSelect.options[screenerSelect.selectedIndex].textContent}`);

        // --- Filtros del screener ---
        const qs = screenerURL.split("?")[1] || "";
        const f = new URLSearchParams(qs).get("f");
        const filtros = f ? f.split(",").map(x => x.trim()).filter(Boolean) : [];
        if (!filtros.length) {
            resumenDiv.textContent = "La URL del screener no contiene filtros (parámetro 'f').";
            logMsg("⚠ La URL del screener no tiene parámetro 'f'.");
            return;
        }
        logMsg(`Filtros del screener (${filtros.length}): ${filtros.join(", ")}`);

        // --- Datos de la empresa ---
        const html = await descargaFicha(ticker);
        if (!html) {
            resumenDiv.textContent =
                `No se han podido descargar los datos de ${ticker}. ` +
                `Ningún proxy CORS respondió con la ficha de Finviz (revisa el log).`;
            logMsg("✗ Comparación abortada: sin datos de la empresa.");
            return;
        }

        const datos = extraeDatos(html);
        const nCampos = Object.keys(datos).length;
        logMsg(`Datos de la empresa extraídos: ${nCampos} campos`);
        if (nCampos === 0) {
            resumenDiv.textContent = `Se descargó la página de ${ticker} pero no se pudo leer la tabla de datos.`;
            return;
        }

        const descripciones = await loadDescriptions();

        // --- Ordenar filtros ---
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
            tr.innerHTML = `
      <td>${etiqueta}</td>
      <td>${condicion}</td>
      <td>${mostrado}</td>
      <td class="${estado}">${etiquetaTexto}</td>
      <td>${buscaDescripcion(descripciones, etiqueta)}</td>
    `;
            resultsTable.appendChild(tr);
        }

        resumenDiv.textContent =
            `${ticker}: ${ok} CUMPLE · ${nok} INCUMPLE · ${na} N/A` +
            (nok === 0 && na === 0 ? " → la empresa pasa todos los criterios del screener." : "");
        logMsg(`✅ Comparación finalizada: ${ok} OK / ${nok} NOK / ${na} N/A`);

    } catch (e) {
        logMsg(`✗ Error inesperado: ${e.message}`);
        resumenDiv.textContent = `Error inesperado: ${e.message}`;
    } finally {
        compareBtn.disabled = false;
    }
}

compareBtn.addEventListener("click", runComparison);
loadScreeners();
