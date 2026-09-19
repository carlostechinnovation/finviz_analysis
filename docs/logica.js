/* =========================================================================
   Logica pura del comparador (sin DOM ni red) para poder testearla con Node.
   Se carga como <script> normal antes de app.js (variables globales
   compartidas, sin modulos ni bundler) y tambien se puede "require()" desde
   tests/ gracias al guard de module.exports del final.

   NOTA DE CODIFICACION: este fichero se mantiene en ASCII puro a proposito.
   Los acentos y simbolos van como escapes \uXXXX dentro de las cadenas, de
   forma que ningun editor pueda corromperlo al guardarlo en otra codificacion.
   ========================================================================= */

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

    // --- Crecimiento / dilucion ---
    // Finviz no tiene filtro directo de "variacion del numero de acciones".
    // El BPA creciente es el proxy: la dilucion exagerada lo aplasta aunque los
    // ingresos totales suban. Insuficiente por si solo: ver UMBRAL_DILUCION_PCT
    // y calculaDilucion() mas abajo para la deteccion real via SEC EDGAR.
    "fa_epsyoyttm_pos":       { finviz: "EPS Y/Y TTM",   op: ">",  valor: 0,     texto: "> 0% (BPA creciente: sin diluci\u00f3n exagerada)" },

    // --- Propiedad / liquidez ---
    "sh_instown_o30":         { finviz: "Inst Own",      op: ">",  valor: 30,    texto: "> 30%" },
    "sh_float_o1":            { finviz: "Shs Float",     op: ">",  valor: 1e6,   texto: "> 1M", escala: true },
    "sh_short_u10":           { finviz: "Short Float",   op: "<",  valor: 10,    texto: "< 10%" },
    "sh_relvol_o0.5":         { finviz: "Rel Volume",    op: ">",  valor: 0.5,   texto: "> 0.5" },

    // --- Tecnicos ---
    "ta_averagetruerange_o1": { finviz: "ATR (14)",      op: ">",  valor: 1,     texto: "> 1" },
    "ta_rsi_nos40":           { finviz: "RSI (14)",      op: ">",  valor: 40,    texto: "> 40 (no sobrevendido)" },
    "ta_sma20_pa":            { finviz: "SMA20",         op: ">",  valor: 0,     texto: "> 0% (precio sobre SMA20)" },
    // Comprobado contra Finviz: a5h significa "5% o mas POR ENCIMA del minimo de
    // 52 semanas", NO "cerca del maximo". El dato "52W Low" de la ficha llega
    // como "48.93 72.74%" y aNumero() se queda con el porcentaje (2o numero).
    "ta_highlow52w_a5h":      { finviz: "52W Low",       op: ">",  valor: 5,     texto: "> 5% (a 5% o m\u00e1s del m\u00ednimo)" },
    "ta_perf2_26wup":         { finviz: "Perf Half Y",   op: ">",  valor: 0,     texto: "> 0%" },
    "ta_perf_3yup":           { finviz: "Perf 3Y",       op: ">",  valor: 0,     texto: "> 0%" }
};

// Orden economico de presentacion (los filtros no listados se anaden al final)
const ORDEN = [
    "cap_largeunder",
    "fa_pe_u30", "fa_fpe_u20", "fa_ps_o2", "fa_evsales_u6",
    "fa_grossmargin_o10", "fa_opermargin_o5",
    "fa_curratio_o1", "fa_debteq_u1", "fa_ltdebteq_u1",
    "fa_epsyoyttm_pos",
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
    "52W Low": ["52-Week Low"],
    "EPS Y/Y TTM": ["EPS growth TTM", "EPS Y/Y", "EPS TTM Y/Y"],
    "EV/Sales": ["EV / Sales"],
    "Forward P/E": ["Fwd P/E"],
    "LT Debt/Eq": ["LT Debt/Equity"],
    "Debt/Eq": ["Debt/Equity", "Total Debt/Equity"]
};

// --- Deteccion de dilucion fuerte (fuente: SEC EDGAR, no Finviz) ---
// Finviz no publica el historico de acciones en circulacion, solo el valor
// actual. Por eso fa_epsyoyttm_pos (EPS creciente) es solo un proxy indirecto
// de "sin dilucion": una empresa con perdidas que se reducen puede mostrar
// EPS Y/Y TTM positivo mientras emite acciones nuevas de forma masiva.
// Caso real verificado: BFRI tiene EPS Y/Y TTM +73% en Finviz (pasa ese
// filtro) pero sus acciones en circulacion subieron +40% en un anio segun
// SEC EDGAR (10.14M en 2025-06-30 -> 14.21M en 2026-06-30).
// LIMITACION CONOCIDA: los datos "as filed" de SEC EDGAR no se reexpresan
// tras un split. Un split directo (no dilucion real) puede disparar esta
// alerta como falso positivo.
const UMBRAL_DILUCION_PCT = 20;         // % de aumento en ~1 anio = dilucion fuerte
const TOLERANCIA_DILUCION_DIAS = 120;   // margen para localizar el dato de "hace 1 anio"
const XBRL_TAGS_SHARES = [
    "us-gaap/CommonStockSharesOutstanding",
    "dei/EntityCommonStockSharesOutstanding",
    "us-gaap/CommonStockSharesIssued"
];

/* -------------------------------------------------------------------------
   2) UTILIDADES
   ------------------------------------------------------------------------- */
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

    // El lector jina.ai junta a veces dos numeros en un campo (p.ej. "52W High"
    // llega como "344.57 -4.75%"): el segundo es el que usan los filtros.
    if (/\s/.test(s)) s = s.split(/\s+/).pop();

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
   3) EXTRACCION DE DATOS
   ------------------------------------------------------------------------- */

// Recorre el markdown que devuelve r.jina.ai buscando pares "Clave**Valor**"
// (o, con enlaces, "[Clave](url)[**Valor**](url)"). r.jina.ai NO garantiza un
// salto de linea por campo: a veces los mete todos seguidos en una sola linea,
// asi que se busca en todo el texto en vez de trocear por lineas. El valor se
// limita a una sola linea y pocos caracteres para no confundirlo con frases
// sueltas en negrita (p.ej. el precio "**339.08**" o avisos de marketing) que
// no van precedidas de una etiqueta real.
function extraeDatosMarkdown(texto) {
    const datos = {};
    const limpio = String(texto).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

    const re = /([A-Za-z0-9][A-Za-z0-9 /().%+-]{0,30})\*\*([^*\r\n]{1,40}?)\*\*/g;
    let m;
    while ((m = re.exec(limpio)) !== null) {
        const clave = limpia(m[1]);
        const valor = limpia(m[2]);
        if (!clave || !valor) continue;
        if (clave.length > 32) continue;
        if (/^[\d.,%+-]+$/.test(clave)) continue;   // la "clave" es un numero -> no es un par
        if (datos[clave] === undefined) datos[clave] = valor;
    }
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
   4) DETECCION DE DILUCION (SEC EDGAR)
   ------------------------------------------------------------------------- */

// r.jina.ai esta pensado para paginas HTML: antepone metadatos tipo
// "Title: ...\nURL Source: ...\nMarkdown Content:\n" antes del contenido y
// puede reformatear texto como si fuera prosa. Contra un endpoint JSON (SEC
// EDGAR) eso rompe un JSON.parse() directo. Como esta app no tiene servidor
// donde depurar el problema en caliente, se extrae el primer objeto JSON
// valido buscando desde la primera "{" hasta la ultima "}" de la respuesta,
// en vez de asumir que el cuerpo entero es JSON limpio.
function extraeJSON(texto) {
    const inicio = texto.indexOf("{");
    const fin = texto.lastIndexOf("}");
    if (inicio === -1 || fin === -1 || fin <= inicio) return null;
    try {
        return JSON.parse(texto.slice(inicio, fin + 1));
    } catch (e) {
        return null;
    }
}

// Compara el ultimo dato disponible con el mas cercano a "hace 1 anio".
function calculaDilucion(puntos) {
    const validos = puntos
        .filter(p => p && p.end && typeof p.val === "number")
        .sort((a, b) => new Date(a.end) - new Date(b.end));
    if (validos.length < 2) return null;

    const actual = validos[validos.length - 1];
    const fechaActual = new Date(actual.end);
    const objetivoMs = fechaActual.getTime() - 365 * 24 * 3600 * 1000;

    let anterior = null, mejorDist = Infinity;
    for (const p of validos) {
        if (p === actual) continue;
        const dist = Math.abs(new Date(p.end).getTime() - objetivoMs);
        if (dist < mejorDist) { mejorDist = dist; anterior = p; }
    }
    if (!anterior || mejorDist > TOLERANCIA_DILUCION_DIAS * 24 * 3600 * 1000) return null;
    if (anterior.val <= 0) return null;

    const pct = ((actual.val - anterior.val) / anterior.val) * 100;
    return { pct: pct, actual: actual, anterior: anterior };
}

// Guard para poder usar require("./logica.js") desde tests/ con Node, sin
// afectar al navegador (donde "module" no existe y este bloque no se ejecuta).
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        FILTROS, ORDEN, ALIAS,
        UMBRAL_DILUCION_PCT, TOLERANCIA_DILUCION_DIAS, XBRL_TAGS_SHARES,
        ETIQUETAS_CONOCIDAS,
        normaliza, limpia, aNumero, compara, buscaValor, buscaDescripcion,
        extraeDatosMarkdown, cuentaConocidos, extraeJSON, calculaDilucion
    };
}
