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
// El dato mas reciente no puede tener mas de ~18 meses: un 10-K anual mas el
// plazo de presentacion. Mas viejo es una etiqueta XBRL abandonada, no "hoy".
const ANTIGUEDAD_MAX_DILUCION_DIAS = 550;
// Una recompra no reduce el 90% de las acciones en un anio: eso es un error de
// escala en el XBRL (miles frente a unidades), no un dato.
const CAIDA_MAX_CREIBLE_PCT = -90;
const XBRL_TAGS_SHARES = [
    "us-gaap/CommonStockSharesOutstanding",
    "dei/EntityCommonStockSharesOutstanding",
    "us-gaap/CommonStockSharesIssued"
];

/* -------------------------------------------------------------------------
   2) UTILIDADES
   ------------------------------------------------------------------------- */
/**
 * Normaliza una etiqueta para compararla sin importar mayusculas ni signos.
 * @param {*} s Texto de entrada.
 * @returns {string} Solo letras minusculas y digitos.
 */
function normaliza(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Colapsa los espacios internos y recorta los bordes.
 * @param {*} s Texto de entrada.
 * @returns {string} Texto limpio.
 */
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

/**
 * Convierte "1,234.5", "12.34%", "+3.2%", "3.45T", "-" ... a numero.
 * @param {*} txt Valor tal y como llega de Finviz.
 * @param {boolean} [escala] true para aplicar los sufijos K/M/B/T.
 * @returns {number} El numero, o NaN si no hay dato.
 */
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

/**
 * Aplica un operador de comparacion de filtro.
 * @param {number} valor Valor de la empresa.
 * @param {string} op Uno de ">", ">=", "<", "<=".
 * @param {number} umbral Umbral del filtro.
 * @returns {boolean|null} Resultado, o null si el operador no se conoce.
 */
function compara(valor, op, umbral) {
    switch (op) {
        case ">":  return valor >  umbral;
        case ">=": return valor >= umbral;
        case "<":  return valor <  umbral;
        case "<=": return valor <= umbral;
    }
    return null;
}

/**
 * Busca una etiqueta en los datos de la empresa, probando alias y normalizacion.
 * @param {Object<string,string>} datos Pares etiqueta -> valor de la ficha.
 * @param {string} etiqueta Etiqueta de Finviz buscada.
 * @returns {string|undefined} El valor, o undefined si no aparece.
 */
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

/**
 * Igual que buscaValor, pero sobre el glosario de descripciones.
 * @param {Object<string,string>} descripciones Etiqueta -> descripcion.
 * @param {string} etiqueta Etiqueta de Finviz buscada.
 * @returns {string} La descripcion, o "" si no hay.
 */
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
/**
 * Extrae los pares etiqueta -> valor de la ficha de Finviz en markdown.
 * @param {string} texto Respuesta de r.jina.ai.
 * @returns {Object<string,string>} Pares encontrados (gana la primera aparicion).
 */
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

/**
 * Cuenta cuantas etiquetas de los datos sabe leer la app (FILTROS + ALIAS).
 * @param {Object<string,string>} datos Pares etiqueta -> valor.
 * @returns {number} Numero de etiquetas reconocidas.
 */
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
/**
 * Extrae el objeto JSON que va entre la primera "{" y la ultima "}".
 * @param {string} texto Respuesta del proxy.
 * @returns {Object|null} El objeto, o null si no hay JSON valido.
 */
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
// Con "hoy" (ms o Date), exige ademas que el ultimo dato sea reciente: una
// empresa que dejo de usar esa etiqueta XBRL hace anios (p.ej. al pasar a
// informar por clase de accion) devolvia una "dilucion" de 2010-2011 como si
// fuera del ultimo anio. Tambien descarta ceros y caidas imposibles (errores
// de escala en el propio XBRL: CPK declaro 23.544 millones de acciones en
// 2025-08 y 24 millones en 2026-08). Devuelve null si no hay comparacion fiable.
/**
 * Calcula la variacion de acciones en circulacion en ~1 anio.
 * @param {Array<{end:string,val:number}>} puntos Serie XBRL de la SEC.
 * @param {number|Date} [hoy] Fecha de referencia para descartar datos viejos.
 * @returns {{pct:number,actual:Object,anterior:Object}|null} Variacion o null.
 */
function calculaDilucion(puntos, hoy) {
    if (!Array.isArray(puntos)) return null;
    const validos = puntos
        .filter(p => p && p.end && typeof p.val === "number" && p.val > 0)
        .sort((a, b) => new Date(a.end) - new Date(b.end));
    if (validos.length < 2) return null;

    const actual = validos[validos.length - 1];
    const fechaActual = new Date(actual.end);
    if (hoy !== undefined &&
        new Date(hoy).getTime() - fechaActual.getTime() > ANTIGUEDAD_MAX_DILUCION_DIAS * 24 * 3600 * 1000) {
        return null;
    }
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
    if (pct <= CAIDA_MAX_CREIBLE_PCT) return null;
    return { pct: pct, actual: actual, anterior: anterior };
}

/* -------------------------------------------------------------------------
   5) LIMITE DE PETICIONES AL PROXY Y REINTENTOS
   r.jina.ai sin clave admite 20 peticiones por minuto y por IP (cabecera
   "x-ratelimit-limit: 20, 20;w=60", comprobada el 2026-09-29). Lanzar las
   fichas de 55 tickers a la vez devolvia HTTP 429 a 35 de ellas: los datos
   existian en Finviz, era el proxy el que las rechazaba. Todas las llamadas al
   proxy pasan por una unica cola que respeta ese cupo con margen.
   ------------------------------------------------------------------------- */
const PROXY_MAX_POR_MINUTO = 18;      // cupo real 20/min: se deja margen
const PROXY_VENTANA_MS = 60000;
const PROXY_MAX_SIMULTANEAS = 4;
const PROXY_MAX_INTENTOS = 4;
const PROXY_PAUSA_429_MS = 30000;     // si aun asi llega un 429, se para la cola
const PRIORIDAD_FINVIZ = 0;           // las fichas antes que la dilucion (SEC)
const PRIORIDAD_SEC = 1;

// Cola con prioridad que no arranca mas de maxPorVentana tareas en cada
// ventana deslizante de ventanaMs, ni mas de maxSimultaneas a la vez. A igual
// prioridad, por orden de llegada. "reloj" solo se inyecta en los tests.
/**
 * Crea la cola con cupo por ventana deslizante y maximo de tareas simultaneas.
 * @param {number} maxPorVentana Arranques maximos por ventana.
 * @param {number} ventanaMs Duracion de la ventana en ms.
 * @param {number} maxSimultaneas Tareas en vuelo como maximo.
 * @param {function():number} [reloj] Reloj inyectable (tests).
 * @returns {{encola:Function,pausa:Function,pendientes:Function}} La cola.
 */
function creaLimitador(maxPorVentana, ventanaMs, maxSimultaneas, reloj) {
    reloj = reloj || Date.now;
    const inicios = [];
    const cola = [];
    let activas = 0, orden = 0, pausaHasta = 0, temporizador = null;

    /** Milisegundos que hay que esperar antes del siguiente arranque. */
    function esperaNecesaria(ahora) {
        while (inicios.length && ahora - inicios[0] >= ventanaMs) inicios.shift();
        let espera = Math.max(0, pausaHasta - ahora);
        if (inicios.length >= maxPorVentana) {
            espera = Math.max(espera, inicios[0] + ventanaMs - ahora);
        }
        return espera;
    }

    /** Arranca todas las tareas que el cupo permita ahora mismo. */
    function bombea() {
        if (temporizador) return;
        while (cola.length && activas < maxSimultaneas) {
            const ahora = reloj();
            const espera = esperaNecesaria(ahora);
            if (espera > 0) {
                temporizador = setTimeout(() => { temporizador = null; bombea(); }, espera);
                return;
            }
            cola.sort((a, b) => a.prioridad - b.prioridad || a.orden - b.orden);
            const tarea = cola.shift();
            inicios.push(ahora);
            activas++;
            // Se libera el hueco ANTES de avisar a quien espera la tarea.
            const libera = () => { activas--; bombea(); };
            Promise.resolve()
                .then(tarea.fn)
                .then(v => { libera(); tarea.resolve(v); },
                      e => { libera(); tarea.reject(e); });
        }
    }

    return {
        encola(fn, prioridad) {
            return new Promise((resolve, reject) => {
                cola.push({ fn: fn, prioridad: prioridad || 0, orden: orden++, resolve: resolve, reject: reject });
                bombea();
            });
        },
        pausa(ms) {
            pausaHasta = Math.max(pausaHasta, reloj() + ms);
        },
        pendientes() {
            return cola.length + activas;
        }
    };
}

// Un fallo merece otro intento si es transitorio: red/timeout (status 0),
// 408, 429 (cupo del proxy) o 5xx. Un 404 o un 403 no se arreglan insistiendo.
/**
 * Indica si un fallo HTTP merece otro intento.
 * @param {number} status Codigo HTTP (0 = red o timeout).
 * @returns {boolean} true si es transitorio.
 */
function esReintentable(status) {
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

// r.jina.ai responde HTTP 200 aunque la web de destino falle, y lo avisa en
// una linea "Warning: Target URL returned error NNN". Devuelve ese NNN, o null.
/**
 * Lee el codigo de error del destino que r.jina.ai avisa en su cabecera.
 * @param {string} texto Respuesta del proxy.
 * @returns {number|null} Codigo HTTP del destino, o null si no hay aviso.
 */
function errorDestinoProxy(texto) {
    const m = /Target URL returned error (\d{3})/.exec(String(texto).slice(0, 2000));
    return m ? parseInt(m[1], 10) : null;
}

// Finviz redirige un ticker inexistente a su pagina de busqueda: el proxy la
// devuelve con "Title: Search". Es definitivo, no merece reintento.
/**
 * Detecta la pagina de busqueda de Finviz (ticker inexistente).
 * @param {string} texto Respuesta del proxy.
 * @returns {boolean} true si Finviz no reconoce el ticker.
 */
function esBusquedaFinviz(texto) {
    return /^Title:\s*Search\s*$/m.test(String(texto).slice(0, 500));
}

/**
 * Minutos que tardara la cola en despachar n peticiones al ritmo permitido.
 * @param {number} nPeticiones Peticiones previstas.
 * @returns {number} Minutos, como minimo 1.
 */
function minutosEstimados(nPeticiones) {
    return Math.max(1, Math.ceil(nPeticiones / PROXY_MAX_POR_MINUTO));
}

/* -------------------------------------------------------------------------
   6) EVALUACION DE CASILLAS, PUNTUACION Y ORDEN DE COLUMNAS
   Cada casilla de filtro vale PUNTOS_POR_ESTADO[estado]. La fila de dilucion
   solo resta: PUNTOS_ALERTA_DILUCION si hay alerta, 0 en otro caso (ni la
   dilucion baja ni la N/D suman). Ver diseno_funcional.md SS7.
   ------------------------------------------------------------------------- */
const PUNTOS_POR_ESTADO = { ok: 1, na: 0, nok: -0.5 };
const PUNTOS_ALERTA_DILUCION = -99;
const ORDEN_ENTRADA = "entrada";
const ORDEN_PUNTOS = "puntos";
// Con menos empresas no hay nada que ordenar: se ocultan la fila "Orden
// entrada" y los botones de orden.
const MIN_TICKERS_PARA_ORDENAR = 2;

/**
 * Ordena los codigos de filtro segun ORDEN; los desconocidos van al final.
 * @param {string[]} filtros Codigos del parametro f= del screener.
 * @returns {string[]} Codigos en orden de presentacion.
 */
function ordenaFiltros(filtros) {
    return ORDEN.filter(c => filtros.includes(c))
        .concat(filtros.filter(c => !ORDEN.includes(c)));
}

/**
 * Estado de una casilla a partir del valor bruto de la ficha.
 * @param {string|undefined} bruto Valor tal y como llega de Finviz.
 * @param {Object} def Definicion del filtro (FILTROS[codigo]).
 * @returns {string} "ok", "nok" o "na".
 */
function estadoDeValor(bruto, def) {
    const num = aNumero(bruto, def.escala);
    if (isNaN(num)) return "na";
    const r = compara(num, def.op, def.valor);
    if (r === null) return "na";
    return r ? "ok" : "nok";
}

/**
 * Evalua una casilla: un filtro del screener para una empresa.
 * @param {Object|null|undefined} datos Ficha de la empresa (undefined =
 *     descarga pendiente, null = descarga fallida).
 * @param {string} codigo Codigo del filtro.
 * @returns {{texto:string, estado:string}} Texto a mostrar y estado.
 */
function evaluaFiltro(datos, codigo) {
    if (datos === undefined) return { texto: "(descargando)", estado: "na" };
    if (!datos) return { texto: "(sin datos)", estado: "na" };
    const def = FILTROS[codigo];
    if (!def) return { texto: "N/A", estado: "na" };
    const bruto = buscaValor(datos, def.finviz);
    const texto = (bruto === undefined || bruto === "") ? "N/A" : String(bruto);
    return { texto: texto, estado: estadoDeValor(bruto, def) };
}

/**
 * Evalua todas las casillas de filtros de la tabla.
 * @param {string[]} tickers Empresas.
 * @param {string[]} codigos Filtros del screener.
 * @param {Object} resultadosPorTicker ticker -> { datos, dilucion }.
 * @returns {Object} evaluaciones[codigo][ticker] = { texto, estado }.
 */
function evaluaTabla(tickers, codigos, resultadosPorTicker) {
    const evaluaciones = {};
    for (const codigo of codigos) {
        evaluaciones[codigo] = {};
        for (const t of tickers) {
            evaluaciones[codigo][t] = evaluaFiltro(resultadosPorTicker[t].datos, codigo);
        }
    }
    return evaluaciones;
}

/**
 * Indica si la dilucion de una empresa supera el umbral de alerta.
 * @param {Object|null|undefined} dilucion Resultado de calculaDilucion.
 * @returns {boolean} true si hay alerta por dilucion.
 */
function hayAlertaDilucion(dilucion) {
    return !!dilucion && dilucion.pct >= UMBRAL_DILUCION_PCT;
}

/**
 * Puntos de una empresa a partir de los estados de sus casillas.
 * @param {string[]} estados Estados ("ok"/"nok"/"na") de sus filtros.
 * @param {boolean} alertaDilucion true si su fila de dilucion esta en alerta.
 * @returns {number} Suma de puntos.
 */
function puntosEmpresa(estados, alertaDilucion) {
    let total = alertaDilucion ? PUNTOS_ALERTA_DILUCION : 0;
    for (const estado of estados) total += PUNTOS_POR_ESTADO[estado] || 0;
    return total;
}

/**
 * Puntos de cada empresa de la tabla.
 * @param {string[]} tickers Empresas.
 * @param {Object} evaluaciones Salida de evaluaTabla.
 * @param {Object} resultadosPorTicker ticker -> { datos, dilucion }.
 * @returns {Object<string,number>} ticker -> puntos.
 */
function calculaPuntosPorTicker(tickers, evaluaciones, resultadosPorTicker) {
    const puntos = {};
    for (const t of tickers) {
        const estados = Object.keys(evaluaciones).map(c => evaluaciones[c][t].estado);
        puntos[t] = puntosEmpresa(estados, hayAlertaDilucion(resultadosPorTicker[t].dilucion));
    }
    return puntos;
}

/**
 * Orden de las columnas de empresas segun el criterio elegido.
 * ORDEN_ENTRADA respeta el textbox; ORDEN_PUNTOS ordena de mas a menos
 * puntos y, a igualdad, por orden de entrada.
 * @param {string[]} tickers Empresas en orden de entrada.
 * @param {Object<string,number>} puntos ticker -> puntos.
 * @param {string} criterio ORDEN_ENTRADA u ORDEN_PUNTOS.
 * @returns {string[]} Nueva lista ordenada (no modifica la de entrada).
 */
function ordenaTickers(tickers, puntos, criterio) {
    if (criterio !== ORDEN_PUNTOS) return tickers.slice();
    return tickers
        .map((t, i) => ({ t: t, i: i }))
        .sort((a, b) => (puntos[b.t] - puntos[a.t]) || (a.i - b.i))
        .map(x => x.t);
}

/**
 * Indica si hay empresas suficientes para mostrar la fila y botones de orden.
 * @param {number} nTickers Numero de empresas comparadas.
 * @returns {boolean} true si son MIN_TICKERS_PARA_ORDENAR o mas.
 */
function hayVariasEmpresas(nTickers) {
    return nTickers >= MIN_TICKERS_PARA_ORDENAR;
}

// Guard para poder usar require("./logica.js") desde tests/ con Node, sin
// afectar al navegador (donde "module" no existe y este bloque no se ejecuta).
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        FILTROS, ORDEN, ALIAS,
        UMBRAL_DILUCION_PCT, TOLERANCIA_DILUCION_DIAS, XBRL_TAGS_SHARES,
        ANTIGUEDAD_MAX_DILUCION_DIAS, CAIDA_MAX_CREIBLE_PCT,
        ETIQUETAS_CONOCIDAS,
        normaliza, limpia, aNumero, compara, buscaValor, buscaDescripcion,
        extraeDatosMarkdown, cuentaConocidos, extraeJSON, calculaDilucion,
        PROXY_MAX_POR_MINUTO, PROXY_VENTANA_MS, PROXY_MAX_SIMULTANEAS, PROXY_MAX_INTENTOS,
        PROXY_PAUSA_429_MS, PRIORIDAD_FINVIZ, PRIORIDAD_SEC,
        creaLimitador, esReintentable, errorDestinoProxy, esBusquedaFinviz, minutosEstimados,
        PUNTOS_POR_ESTADO, PUNTOS_ALERTA_DILUCION, ORDEN_ENTRADA, ORDEN_PUNTOS, MIN_TICKERS_PARA_ORDENAR,
        ordenaFiltros, estadoDeValor, evaluaFiltro, evaluaTabla, hayAlertaDilucion,
        puntosEmpresa, calculaPuntosPorTicker, ordenaTickers, hayVariasEmpresas
    };
}
