// Tests de la evaluacion de casillas, la puntuacion por empresa y el orden de
// columnas (docs/logica.js, seccion 6), mas unas comprobaciones estaticas de
// docs/index.html y docs/app.js (botones de orden presentes, #resumen quitado).
// Sin DOM ni red: node --test, sin dependencias.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ordenaFiltros, estadoDeValor, evaluaFiltro, evaluaTabla, hayAlertaDilucion,
    puntosEmpresa, calculaPuntosPorTicker, ordenaTickers, hayVariasEmpresas,
    FILTROS, ORDEN, UMBRAL_DILUCION_PCT,
    PUNTOS_POR_ESTADO, PUNTOS_ALERTA_DILUCION, ORDEN_ENTRADA, ORDEN_PUNTOS
} = require("../docs/logica.js");

const DOCS = path.join(__dirname, "..", "docs");

// --- Evaluacion de casillas ---

test("ordenaFiltros: sigue ORDEN y deja los codigos desconocidos al final", () => {
    const filtros = ["zz_desconocido", "fa_pe_u30", "cap_largeunder"];
    assert.deepEqual(ordenaFiltros(filtros), ["cap_largeunder", "fa_pe_u30", "zz_desconocido"]);
});

test("ordenaFiltros: con todo ORDEN desordenado devuelve ORDEN", () => {
    assert.deepEqual(ordenaFiltros(ORDEN.slice().reverse()), ORDEN);
});

test("estadoDeValor: ok, nok y na segun el umbral del filtro", () => {
    const def = FILTROS["fa_pe_u30"];
    assert.equal(estadoDeValor("12.5", def), "ok");
    assert.equal(estadoDeValor("45", def), "nok");
    assert.equal(estadoDeValor("-", def), "na");
    assert.equal(estadoDeValor(undefined, def), "na");
});

test("estadoDeValor: aplica la escala K/M/B/T de Market Cap", () => {
    const def = FILTROS["cap_largeunder"];
    assert.equal(estadoDeValor("150.2B", def), "ok");
    assert.equal(estadoDeValor("3.45T", def), "nok");
});

test("estadoDeValor: operador desconocido da na, no un falso ok/nok", () => {
    assert.equal(estadoDeValor("5", { op: "!=", valor: 3 }), "na");
});

test("evaluaFiltro: descarga pendiente, fallida y filtro no soportado son naranja (na)", () => {
    assert.deepEqual(evaluaFiltro(undefined, "fa_pe_u30"), { texto: "(descargando)", estado: "na" });
    assert.deepEqual(evaluaFiltro(null, "fa_pe_u30"), { texto: "(sin datos)", estado: "na" });
    assert.deepEqual(evaluaFiltro({ "P/E": "10" }, "zz_desconocido"), { texto: "N/A", estado: "na" });
});

test("evaluaFiltro: el texto es el valor de la ficha y el estado su cumplimiento", () => {
    assert.deepEqual(evaluaFiltro({ "P/E": "10.2" }, "fa_pe_u30"), { texto: "10.2", estado: "ok" });
    assert.deepEqual(evaluaFiltro({ "P/E": "31" }, "fa_pe_u30"), { texto: "31", estado: "nok" });
    assert.deepEqual(evaluaFiltro({ "P/E": "" }, "fa_pe_u30"), { texto: "N/A", estado: "na" });
    assert.deepEqual(evaluaFiltro({}, "fa_pe_u30"), { texto: "N/A", estado: "na" });
});

test("evaluaTabla: una evaluacion por filtro y ticker", () => {
    const resultados = { AAA: { datos: { "P/E": "10" } }, BBB: { datos: null } };
    const ev = evaluaTabla(["AAA", "BBB"], ["fa_pe_u30"], resultados);
    assert.equal(ev["fa_pe_u30"].AAA.estado, "ok");
    assert.equal(ev["fa_pe_u30"].BBB.texto, "(sin datos)");
});

// --- Puntuacion ---

test("PUNTOS: verde +1, naranja 0, rojo -0.5 y alerta de dilucion -99", () => {
    assert.deepEqual(PUNTOS_POR_ESTADO, { ok: 1, na: 0, nok: -0.5 });
    assert.equal(PUNTOS_ALERTA_DILUCION, -99);
});

test("hayAlertaDilucion: solo a partir del umbral; sin datos o pendiente no es alerta", () => {
    assert.equal(hayAlertaDilucion({ pct: UMBRAL_DILUCION_PCT }), true);
    assert.equal(hayAlertaDilucion({ pct: 40.1 }), true);
    assert.equal(hayAlertaDilucion({ pct: 19.9 }), false);
    assert.equal(hayAlertaDilucion({ pct: -5 }), false);
    assert.equal(hayAlertaDilucion(null), false);
    assert.equal(hayAlertaDilucion(undefined), false);
});

test("puntosEmpresa: suma casillas verdes, naranjas y rojas", () => {
    assert.equal(puntosEmpresa(["ok", "ok", "ok", "na", "nok"], false), 2.5);
    assert.equal(puntosEmpresa([], false), 0);
});

test("puntosEmpresa: la alerta de dilucion resta 99; sin alerta la dilucion no suma", () => {
    assert.equal(puntosEmpresa(["ok", "ok"], true), -97);
    assert.equal(puntosEmpresa(["ok", "ok"], false), 2);
});

test("calculaPuntosPorTicker: combina filtros y dilucion de cada empresa", () => {
    const resultados = {
        AAA: { datos: { "P/E": "10", "Forward P/E": "25" }, dilucion: { pct: 2 } },
        BBB: { datos: { "P/E": "10", "Forward P/E": "15" }, dilucion: { pct: 40 } },
        CCC: { datos: null, dilucion: null }
    };
    const tickers = ["AAA", "BBB", "CCC"];
    const ev = evaluaTabla(tickers, ["fa_pe_u30", "fa_fpe_u20"], resultados);
    assert.deepEqual(calculaPuntosPorTicker(tickers, ev, resultados), { AAA: 0.5, BBB: -97, CCC: 0 });
});

// --- Orden de columnas ---

test("ordenaTickers: ORDEN_ENTRADA respeta el orden del textbox y no modifica la lista", () => {
    const tickers = ["FDX", "AAPL", "MSFT"];
    const orden = ordenaTickers(tickers, { FDX: 1, AAPL: 9, MSFT: 5 }, ORDEN_ENTRADA);
    assert.deepEqual(orden, ["FDX", "AAPL", "MSFT"]);
    assert.notEqual(orden, tickers);
});

test("ordenaTickers: ORDEN_PUNTOS de mas a menos puntos", () => {
    const tickers = ["FDX", "AAPL", "MSFT", "BFRI"];
    const puntos = { FDX: 12.5, AAPL: 14, MSFT: -1, BFRI: -85 };
    assert.deepEqual(ordenaTickers(tickers, puntos, ORDEN_PUNTOS), ["AAPL", "FDX", "MSFT", "BFRI"]);
    assert.deepEqual(tickers, ["FDX", "AAPL", "MSFT", "BFRI"]); // la entrada queda intacta
});

test("ordenaTickers: a igualdad de puntos se mantiene el orden de entrada", () => {
    const puntos = { CCC: 3, AAA: 3, BBB: 5 };
    assert.deepEqual(ordenaTickers(["CCC", "AAA", "BBB"], puntos, ORDEN_PUNTOS), ["BBB", "CCC", "AAA"]);
});

test("hayVariasEmpresas: fila 'Orden entrada' y botones solo con 2 empresas o mas", () => {
    assert.equal(hayVariasEmpresas(0), false);
    assert.equal(hayVariasEmpresas(1), false);
    assert.equal(hayVariasEmpresas(2), true);
    assert.equal(hayVariasEmpresas(55), true);
});

// --- Comprobaciones estaticas de la pagina ---

test("index.html: los dos botones de orden van tras 'Comparar' y ya no existe #resumen", () => {
    const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
    const posComparar = html.indexOf('id="compareBtn"');
    const posEntrada = html.indexOf('id="ordenEntradaBtn"');
    const posPuntos = html.indexOf('id="ordenPuntosBtn"');
    assert.ok(posComparar > -1 && posEntrada > posComparar && posPuntos > posEntrada);
    assert.match(html, />Orden entrada</);
    assert.match(html, />Orden por filtros cumplidos</);
    assert.equal(html.includes('id="resumen"'), false);
});

test("app.js y style.css: no queda ninguna referencia a #resumen", () => {
    const app = fs.readFileSync(path.join(DOCS, "app.js"), "utf8");
    const css = fs.readFileSync(path.join(DOCS, "style.css"), "utf8");
    assert.equal(/getElementById\("resumen"\)|resumenDiv/.test(app), false);
    assert.equal(css.includes("#resumen"), false);
});

test("app.js y logica.js siguen en ASCII puro (ver cabecera de ambos ficheros)", () => {
    for (const fichero of ["app.js", "logica.js"]) {
        const bytes = fs.readFileSync(path.join(DOCS, fichero));
        assert.equal(bytes.every(b => b < 128), true, fichero + " tiene caracteres no ASCII");
    }
});
