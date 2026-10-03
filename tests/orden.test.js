// Tests de la evaluacion de casillas, la puntuacion por empresa (pesos que
// priman la solvencia, con tramos y fondos propios negativos) y el orden de
// columnas (docs/logica.js, seccion 6), mas unas comprobaciones estaticas de
// docs/index.html y docs/app.js (botones de orden presentes, #resumen quitado,
// subtitulo ?escenario=).
// Sin DOM ni red: node --test, sin dependencias.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ordenaFiltros, estadoDeValor, hayPatrimonioNegativo, evaluaFiltro, evaluaTabla,
    hayAlertaDilucion, puntosTramo, puntosCasilla, puntosEmpresa, calculaPuntosPorTicker,
    ordenaTickers, hayVariasEmpresas, extraeDatosMarkdown, compara,
    FILTROS, ORDEN, UMBRAL_DILUCION_PCT,
    PESOS_FILTROS, PUNTOS_ALERTA_DILUCION, ORDEN_ENTRADA, ORDEN_PUNTOS
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

test("evaluaFiltro: descarga pendiente o fallida es naranja y se marca sinFicha", () => {
    assert.deepEqual(evaluaFiltro(undefined, "fa_pe_u30"), { texto: "(descargando)", estado: "na", sinFicha: true });
    assert.deepEqual(evaluaFiltro(null, "fa_pe_u30"), { texto: "(sin datos)", estado: "na", sinFicha: true });
});

test("evaluaFiltro: filtro no soportado es naranja (na)", () => {
    assert.deepEqual(evaluaFiltro({ "P/E": "10" }, "zz_desconocido"), { texto: "N/A", estado: "na" });
});

test("evaluaFiltro: el texto es el valor de la ficha, el estado su cumplimiento y valor el numero", () => {
    assert.deepEqual(evaluaFiltro({ "P/E": "10.2" }, "fa_pe_u30"), { texto: "10.2", estado: "ok", valor: 10.2 });
    assert.deepEqual(evaluaFiltro({ "P/E": "31" }, "fa_pe_u30"), { texto: "31", estado: "nok", valor: 31 });
    const vacio = evaluaFiltro({ "P/E": "" }, "fa_pe_u30");
    assert.equal(vacio.texto, "N/A");
    assert.equal(vacio.estado, "na");
    assert.equal(evaluaFiltro({}, "fa_pe_u30").estado, "na");
});

test("evaluaTabla: una evaluacion por filtro y ticker", () => {
    const resultados = { AAA: { datos: { "P/E": "10" } }, BBB: { datos: null } };
    const ev = evaluaTabla(["AAA", "BBB"], ["fa_pe_u30"], resultados);
    assert.equal(ev["fa_pe_u30"].AAA.estado, "ok");
    assert.equal(ev["fa_pe_u30"].BBB.texto, "(sin datos)");
});

// --- Fondos propios negativos ---

test("hayPatrimonioNegativo: Book/sh negativo o ratio negativo, solo en ratios de deuda", () => {
    const negativo = { "Book/sh": "-1.45" };
    assert.equal(hayPatrimonioNegativo(negativo, "fa_debteq_u1", NaN), true);
    assert.equal(hayPatrimonioNegativo(negativo, "fa_ltdebteq_u1", NaN), true);
    assert.equal(hayPatrimonioNegativo(negativo, "fa_curratio_o1", 1.08), false);
    assert.equal(hayPatrimonioNegativo({ "Book/sh": "16.65" }, "fa_debteq_u1", 3.77), false);
    assert.equal(hayPatrimonioNegativo({}, "fa_debteq_u1", -0.8), true);
    assert.equal(hayPatrimonioNegativo({}, "fa_debteq_u1", NaN), false);
});

test("evaluaFiltro: caso real MCD (Book/sh -1.45, Finviz pone '-' en Debt/Eq): casilla roja", () => {
    // Fragmento real de la ficha de Finviz via r.jina.ai (2026-09-30).
    const datos = extraeDatosMarkdown(
        "Book/sh**-1.45**P/B**-**Quick Ratio**1.07**Current Ratio**1.08**Debt/Eq**-**LT Debt/Eq**-**");
    assert.deepEqual(evaluaFiltro(datos, "fa_debteq_u1"),
        { texto: "- (patrimonio negativo)", estado: "nok", patrimonioNegativo: true });
    assert.equal(evaluaFiltro(datos, "fa_ltdebteq_u1").estado, "nok");
    assert.equal(evaluaFiltro(datos, "fa_curratio_o1").estado, "ok");
});

// --- Pesos y tramos ---

test("PESOS_FILTROS: todos los filtros soportados tienen pesos", () => {
    for (const codigo of Object.keys(FILTROS)) {
        const peso = PESOS_FILTROS[codigo];
        assert.ok(peso, "falta el peso de " + codigo);
        for (const campo of ["cumple", "na", "incumple"]) assert.equal(typeof peso[campo], "number");
    }
});

test("PESOS_FILTROS: la solvencia pesa mas que cualquier otro criterio", () => {
    const solvencia = ["fa_ltdebteq_u1", "fa_debteq_u1", "fa_curratio_o1"];
    const resto = Object.keys(PESOS_FILTROS).filter(c => !solvencia.includes(c));
    const maxResto = Math.max(...resto.map(c => PESOS_FILTROS[c].cumple));
    for (const c of solvencia) assert.ok(PESOS_FILTROS[c].cumple > maxResto, c);
    assert.ok(PESOS_FILTROS["fa_ltdebteq_u1"].cumple > PESOS_FILTROS["fa_debteq_u1"].cumple);
});

test("PESOS_FILTROS: en los tramos, cumple e incumple son el mejor y el peor tramo", () => {
    for (const codigo of Object.keys(PESOS_FILTROS)) {
        const peso = PESOS_FILTROS[codigo];
        if (!peso.tramos) continue;
        const puntos = peso.tramos.map(t => t.puntos);
        assert.equal(peso.cumple, Math.max(...puntos), codigo);
        assert.equal(peso.incumple, Math.min(...puntos), codigo);
    }
});

test("PESOS_FILTROS: un tramo suma si y solo si la casilla es verde", () => {
    for (const codigo of Object.keys(PESOS_FILTROS)) {
        const peso = PESOS_FILTROS[codigo];
        if (!peso.tramos) continue;
        const def = FILTROS[codigo];
        for (let v = 0; v <= 5; v = Math.round((v + 0.01) * 100) / 100) {
            const cumple = compara(v, def.op, def.valor);
            assert.equal(puntosTramo(peso.tramos, v) > 0, cumple, codigo + " con " + v);
        }
    }
});

test("PESOS_FILTROS: la suma maxima no llega a compensar la alerta de dilucion", () => {
    const maximo = Object.keys(PESOS_FILTROS).reduce((s, c) => s + PESOS_FILTROS[c].cumple, 0);
    assert.equal(maximo, 22.25);
    assert.ok(maximo < -PUNTOS_ALERTA_DILUCION);
});

test("puntosTramo: LT Debt/Eq por tramos (< 0.3, 0.3-0.6, 0.6-1, 1-2, > 2)", () => {
    const tramos = PESOS_FILTROS["fa_ltdebteq_u1"].tramos;
    const casos = [[0, 4], [0.29, 4], [0.3, 3], [0.59, 3], [0.6, 1.5], [0.99, 1.5],
                   [1, -2], [2, -2], [2.01, -4], [3.14, -4]];
    for (const [valor, puntos] of casos) assert.equal(puntosTramo(tramos, valor), puntos, "valor " + valor);
});

test("puntosTramo: Debt/Eq por tramos (< 0.5, 0.5-1, 1-2, > 2)", () => {
    const tramos = PESOS_FILTROS["fa_debteq_u1"].tramos;
    const casos = [[0.1, 3], [0.49, 3], [0.5, 1.5], [0.99, 1.5], [1, -1.5], [2, -1.5], [3.77, -3]];
    for (const [valor, puntos] of casos) assert.equal(puntosTramo(tramos, valor), puntos, "valor " + valor);
});

test("puntosTramo: Current Ratio por tramos (>= 2, 1.5-2, 1-1.5, 0.8-1, < 0.8)", () => {
    const tramos = PESOS_FILTROS["fa_curratio_o1"].tramos;
    const casos = [[3, 3], [2, 3], [1.99, 2.5], [1.5, 2.5], [1.08, 1.5], [1, -1.5],
                   [0.8, -1.5], [0.76, -3], [0.31, -3]];
    for (const [valor, puntos] of casos) assert.equal(puntosTramo(tramos, valor), puntos, "valor " + valor);
});

test("puntosTramo: sin tramo aplicable (NaN) devuelve 0", () => {
    assert.equal(puntosTramo(PESOS_FILTROS["fa_curratio_o1"].tramos, NaN), 0);
});

test("puntosCasilla: sin ficha o filtro sin pesos vale 0", () => {
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro(undefined, "fa_ltdebteq_u1")), 0);
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro(null, "fa_ltdebteq_u1")), 0);
    assert.equal(puntosCasilla("zz_desconocido", { texto: "N/A", estado: "na" }), 0);
});

test("puntosCasilla: N/A resta en solvencia y en P/E (perdidas), y es neutro en tecnicos", () => {
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro({}, "fa_ltdebteq_u1")), -1);
    assert.equal(puntosCasilla("fa_curratio_o1", evaluaFiltro({}, "fa_curratio_o1")), -1);
    assert.equal(puntosCasilla("fa_opermargin_o5", evaluaFiltro({}, "fa_opermargin_o5")), -0.5);
    assert.equal(puntosCasilla("fa_pe_u30", evaluaFiltro({ "P/E": "-" }, "fa_pe_u30")), -1);
    assert.equal(puntosCasilla("ta_rsi_nos40", evaluaFiltro({}, "ta_rsi_nos40")), 0);
});

test("puntosCasilla: filtros binarios usan cumple / incumple", () => {
    assert.equal(puntosCasilla("fa_opermargin_o5", evaluaFiltro({ "Oper. Margin": "12%" }, "fa_opermargin_o5")), 2.5);
    assert.equal(puntosCasilla("fa_opermargin_o5", evaluaFiltro({ "Oper. Margin": "2%" }, "fa_opermargin_o5")), -2.5);
    // Ser mega-cap incumple el screener pero no resta: no empeora la solvencia.
    assert.equal(puntosCasilla("cap_largeunder", evaluaFiltro({ "Market Cap": "3.45T" }, "cap_largeunder")), 0);
});

test("puntosCasilla: los ratios de solvencia puntuan por tramos", () => {
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro({ "LT Debt/Eq": "0.2" }, "fa_ltdebteq_u1")), 4);
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro({ "LT Debt/Eq": "0.8" }, "fa_ltdebteq_u1")), 1.5);
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro({ "LT Debt/Eq": "3.14" }, "fa_ltdebteq_u1")), -4);
});

test("puntosCasilla: patrimonio negativo vale el peor tramo", () => {
    const datos = { "Book/sh": "-6.73", "Debt/Eq": "-", "LT Debt/Eq": "-" };
    assert.equal(puntosCasilla("fa_ltdebteq_u1", evaluaFiltro(datos, "fa_ltdebteq_u1")), -4);
    assert.equal(puntosCasilla("fa_debteq_u1", evaluaFiltro(datos, "fa_debteq_u1")), -3);
});

test("hayAlertaDilucion: solo a partir del umbral; sin datos o pendiente no es alerta", () => {
    assert.equal(hayAlertaDilucion({ pct: UMBRAL_DILUCION_PCT }), true);
    assert.equal(hayAlertaDilucion({ pct: 40.1 }), true);
    assert.equal(hayAlertaDilucion({ pct: 19.9 }), false);
    assert.equal(hayAlertaDilucion({ pct: -5 }), false);
    assert.equal(hayAlertaDilucion(null), false);
    assert.equal(hayAlertaDilucion(undefined), false);
});

test("puntosEmpresa: suma las casillas; la alerta de dilucion resta 99 y sin alerta no suma", () => {
    const ev = {
        fa_ltdebteq_u1: evaluaFiltro({ "LT Debt/Eq": "0.2" }, "fa_ltdebteq_u1"),
        fa_pe_u30: evaluaFiltro({ "P/E": "45" }, "fa_pe_u30")
    };
    assert.equal(puntosEmpresa(ev, false), 3.5);
    assert.equal(puntosEmpresa(ev, true), -95.5);
    assert.equal(puntosEmpresa({}, false), 0);
});

test("calculaPuntosPorTicker: solvente, patrimonio negativo, sin ficha con alerta y pendiente", () => {
    const codigos = ["fa_ltdebteq_u1", "fa_debteq_u1", "fa_curratio_o1"];
    const resultados = {
        AAA: { datos: { "LT Debt/Eq": "0.2", "Debt/Eq": "0.4", "Current Ratio": "2.5" }, dilucion: { pct: 2 } },
        BBB: { datos: { "Book/sh": "-6.73", "Debt/Eq": "-", "LT Debt/Eq": "-", "Current Ratio": "0.76" }, dilucion: null },
        CCC: { datos: null, dilucion: { pct: 40 } },
        DDD: { datos: undefined, dilucion: undefined }
    };
    const tickers = ["AAA", "BBB", "CCC", "DDD"];
    const ev = evaluaTabla(tickers, codigos, resultados);
    assert.deepEqual(calculaPuntosPorTicker(tickers, ev, resultados), { AAA: 10, BBB: -10, CCC: -99, DDD: 0 });
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

test("?escenario= se muestra como subtitulo oculto por defecto y sin interpretar HTML", () => {
    const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
    const app = fs.readFileSync(path.join(DOCS, "app.js"), "utf8");
    const posTitulo = html.indexOf("</h1>");
    const posEscenario = html.indexOf('<h2 id="escenario" class="subtitulo" hidden>');
    assert.ok(posTitulo > -1 && posEscenario > posTitulo, "el subtitulo va justo bajo el <h1>");
    assert.match(app, /parametrosURL\.get\("escenario"\)/);
    assert.match(app, /escenarioEl\.textContent = escenarioURL/);
    assert.equal(/escenarioEl\.innerHTML/.test(app), false);
});

test("app.js y logica.js siguen en ASCII puro (ver cabecera de ambos ficheros)", () => {
    for (const fichero of ["app.js", "logica.js"]) {
        const bytes = fs.readFileSync(path.join(DOCS, fichero));
        assert.equal(bytes.every(b => b < 128), true, fichero + " tiene caracteres no ASCII");
    }
});
