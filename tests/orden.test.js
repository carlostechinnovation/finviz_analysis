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
    hayAlertaDilucion, estadoDilucion, puntosTramo, puntosCasilla, puntosEmpresa, calculaPuntosPorTicker,
    ordenaTickers, hayVariasEmpresas, extraeDatosMarkdown, compara,
    FILTROS, ORDEN, UMBRAL_DILUCION_PCT,
    PESOS_FILTROS, PUNTOS_ALERTA_DILUCION, ORDEN_ENTRADA, ORDEN_PUNTOS,
    PUNTOS_MINIMOS_COMPRA, TEXTO_DILUCION_SIN_DATOS, textoPuntos,
    claseCasilla, CLASE_ROJO_INTENSO
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

test("PESOS_FILTROS: LT Debt/Eq es el criterio que mas pesa y la solvencia el bloque que mas pesa", () => {
    const solvencia = ["fa_ltdebteq_u1", "fa_debteq_u1", "fa_curratio_o1"];
    const pago = ["fa_opermargin_o5", "fa_epsyoyttm_pos", "fa_grossmargin_o10"];
    const suma = codigos => codigos.reduce((s, c) => s + PESOS_FILTROS[c].cumple, 0);
    const otros = Object.keys(PESOS_FILTROS).filter(c => c !== "fa_ltdebteq_u1");
    assert.ok(PESOS_FILTROS["fa_ltdebteq_u1"].cumple > Math.max(...otros.map(c => PESOS_FILTROS[c].cumple)));
    assert.ok(suma(solvencia) > suma(pago));
    const resto = Object.keys(PESOS_FILTROS).filter(c => !solvencia.includes(c) && !pago.includes(c));
    assert.ok(suma(solvencia) > suma(resto));
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
        // Cada limite y sus alrededores, en la escala propia del filtro.
        const limites = [def.valor, ...peso.tramos.map(t => t.limite)];
        const valores = limites.flatMap(l => [l, l - 0.01, l + 0.01, l * 0.999, l * 1.001]);
        for (const v of valores) {
            const cumple = compara(v, def.op, def.valor);
            assert.equal(puntosTramo(peso.tramos, v) > 0, cumple, codigo + " con " + v);
        }
    }
});

test("PESOS_FILTROS: fuera de la solvencia, 'mucho' vale casi el doble que 'poco'", () => {
    const solvencia = ["fa_ltdebteq_u1", "fa_debteq_u1", "fa_curratio_o1"];
    const casiDoble = (mucho, poco, etiqueta) => {
        const razon = mucho / poco;
        assert.ok(razon >= 1.7 && razon < 2, etiqueta + ": razon " + razon);
    };
    for (const codigo of Object.keys(PESOS_FILTROS)) {
        const peso = PESOS_FILTROS[codigo];
        if (!peso.tramos || solvencia.includes(codigo)) continue;
        const suman = peso.tramos.map(t => t.puntos).filter(p => p > 0);
        const restan = peso.tramos.map(t => t.puntos).filter(p => p < 0);
        casiDoble(Math.max(...suman), Math.min(...suman), codigo + " cumple");
        if (restan.length) casiDoble(Math.min(...restan), Math.max(...restan), codigo + " incumple");
    }
});

test("PESOS_FILTROS: P/S, Rel Volume y ATR no tienen grados (cumplirlos mucho no es mejor)", () => {
    for (const codigo of ["fa_ps_o2", "sh_relvol_o0.5", "ta_averagetruerange_o1"]) {
        assert.equal(PESOS_FILTROS[codigo].tramos, undefined, codigo);
    }
});

test("PESOS_FILTROS: el N/A de P/E y Forward P/E (perdidas) resta mas que incumplir mucho", () => {
    for (const codigo of ["fa_pe_u30", "fa_fpe_u20"]) {
        assert.ok(PESOS_FILTROS[codigo].na < PESOS_FILTROS[codigo].incumple, codigo);
    }
});

test("PESOS_FILTROS: la suma maxima no llega a compensar la alerta de dilucion", () => {
    const maximo = Object.keys(PESOS_FILTROS).reduce((s, c) => s + PESOS_FILTROS[c].cumple, 0);
    assert.equal(Math.round(maximo * 100) / 100, 26.31);
    assert.ok(maximo < -PUNTOS_ALERTA_DILUCION);
});

test("puntosTramo: los limites de los criterios con grados", () => {
    const casos = {
        fa_opermargin_o5:   [[20, 3.25], [19.99, 1.75], [5.01, 1.75], [5, -1.75], [0, -1.75], [-0.01, -3.25]],
        fa_epsyoyttm_pos:   [[40, 1.95], [39.9, 1.05], [0.01, 1.05], [0, -1.05], [-50, -1.05], [-50.01, -1.95]],
        fa_grossmargin_o10: [[45, 1.3], [44.9, 0.7], [10.01, 0.7], [10, -0.7], [0, -0.7], [-0.24, -1.3]],
        fa_fpe_u20:         [[11.99, 1.3], [12, 0.7], [19.99, 0.7], [20, -0.35], [30, -0.35], [30.01, -0.65]],
        fa_pe_u30:          [[14.99, 0.95], [15, 0.55], [29.99, 0.55], [30, -0.35], [50, -0.35], [50.01, -0.65]],
        fa_evsales_u6:      [[1.99, 0.65], [2, 0.35], [5.99, 0.35], [6, -0.35], [10, -0.35], [10.01, -0.65]],
        sh_short_u10:       [[3.99, 1.3], [4, 0.7], [9.99, 0.7], [10, -0.7], [15, -0.7], [15.01, -1.3]],
        sh_instown_o30:     [[85, 0.65], [84.9, 0.35], [30.01, 0.35], [30, -0.35], [15, -0.35], [14.9, -0.65]],
        sh_float_o1:        [[100e6, 0.32], [99e6, 0.18], [1.01e6, 0.18], [1e6, -0.18], [0.5e6, -0.18], [0.4e6, -0.32]],
        ta_perf2_26wup:     [[15, 0.65], [14.9, 0.35], [0.01, 0.35], [0, -0.35], [-20, -0.35], [-20.01, -0.65]],
        ta_highlow52w_a5h:  [[40, 0.65], [39.9, 0.35], [5.01, 0.35], [5, -0.35], [2, -0.35], [1.99, -0.65]],
        ta_sma20_pa:        [[5, 0.32], [4.99, 0.18], [0.01, 0.18], [0, -0.18], [-8, -0.18], [-8.01, -0.32]]
    };
    for (const codigo of Object.keys(casos)) {
        for (const [valor, puntos] of casos[codigo]) {
            assert.equal(puntosTramo(PESOS_FILTROS[codigo].tramos, valor), puntos, codigo + " con " + valor);
        }
    }
});

test("puntosTramo: Market Cap premia 2B-50B y castiga mas a partir de 500B", () => {
    const tramos = PESOS_FILTROS["cap_largeunder"].tramos;
    const casos = [[19.61e6, 0.7], [1.99e9, 0.7], [2e9, 1.3], [49.9e9, 1.3], [50e9, 0.7], [198.3e9, 0.7],
                   [200e9, -0.7], [500e9, -0.7], [501e9, -1.3], [3.45e12, -1.3]];
    for (const [valor, puntos] of casos) assert.equal(puntosTramo(tramos, valor), puntos, "valor " + valor);
});

test("puntosTramo: RSI vale menos en sobrecompra (> 70) y resta por debajo de 40", () => {
    const tramos = PESOS_FILTROS["ta_rsi_nos40"].tramos;
    const casos = [[79.14, 0.18], [70.01, 0.18], [70, 0.32], [55, 0.32], [54.99, 0.18], [40.01, 0.18],
                   [40, -0.18], [30, -0.18], [29.99, -0.32]];
    for (const [valor, puntos] of casos) assert.equal(puntosTramo(tramos, valor), puntos, "valor " + valor);
});

test("puntosTramo: Perf 3Y suma por grados y una caida nunca resta, sea poca o mucha", () => {
    const tramos = PESOS_FILTROS["ta_perf_3yup"].tramos;
    const casos = [[103.66, 0.65], [75, 0.65], [74.9, 0.35], [0.01, 0.35], [0, 0], [-12, 0], [-80, 0]];
    for (const [valor, puntos] of casos) assert.equal(puntosTramo(tramos, valor), puntos, "valor " + valor);
    assert.equal(PESOS_FILTROS["ta_perf_3yup"].incumple, 0);
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

test("puntosCasilla: filtros sin grados usan cumple / incumple", () => {
    assert.equal(puntosCasilla("fa_ps_o2", evaluaFiltro({ "P/S": "4.28" }, "fa_ps_o2")), 0.25);
    assert.equal(puntosCasilla("fa_ps_o2", evaluaFiltro({ "P/S": "0.91" }, "fa_ps_o2")), -0.25);
    assert.equal(puntosCasilla("sh_relvol_o0.5", evaluaFiltro({ "Rel Volume": "1.41" }, "sh_relvol_o0.5")), 0.25);
    assert.equal(puntosCasilla("sh_relvol_o0.5", evaluaFiltro({ "Rel Volume": "0.2" }, "sh_relvol_o0.5")), 0);
    assert.equal(puntosCasilla("ta_averagetruerange_o1", evaluaFiltro({ "ATR (14)": "2.71" }, "ta_averagetruerange_o1")), 0.25);
    assert.equal(puntosCasilla("ta_averagetruerange_o1", evaluaFiltro({ "ATR (14)": "0.46" }, "ta_averagetruerange_o1")), 0);
});

test("puntosCasilla: los criterios con grados distinguen poco de mucho, en verde y en rojo", () => {
    const oper = v => puntosCasilla("fa_opermargin_o5", evaluaFiltro({ "Oper. Margin": v }, "fa_opermargin_o5"));
    assert.equal(oper("35.51%"), 3.25);
    assert.equal(oper("12%"), 1.75);
    assert.equal(oper("2%"), -1.75);
    assert.equal(oper("-3.53%"), -3.25);
    const cap = v => puntosCasilla("cap_largeunder", evaluaFiltro({ "Market Cap": v }, "cap_largeunder"));
    assert.equal(cap("19.61M"), 0.7);
    assert.equal(cap("36.02B"), 1.3);
    assert.equal(cap("423.3B"), -0.7);
    assert.equal(cap("3.45T"), -1.3);
    const perf = v => puntosCasilla("ta_perf_3yup", evaluaFiltro({ "Perf 3Y": v }, "ta_perf_3yup"));
    assert.equal(perf("12%"), 0.35);
    assert.equal(perf("-12%"), 0);
});

test("claseCasilla: rojo intenso solo al incumplir LT Debt/Eq o Market Cap", () => {
    assert.equal(claseCasilla("fa_ltdebteq_u1", evaluaFiltro({ "LT Debt/Eq": "3.14" }, "fa_ltdebteq_u1")), CLASE_ROJO_INTENSO);
    assert.equal(claseCasilla("fa_ltdebteq_u1",
        evaluaFiltro({ "Book/sh": "-6.73", "LT Debt/Eq": "-" }, "fa_ltdebteq_u1")), CLASE_ROJO_INTENSO);
    assert.equal(claseCasilla("cap_largeunder", evaluaFiltro({ "Market Cap": "3.45T" }, "cap_largeunder")), CLASE_ROJO_INTENSO);
    assert.equal(claseCasilla("fa_ltdebteq_u1", evaluaFiltro({ "LT Debt/Eq": "0.2" }, "fa_ltdebteq_u1")), "ok");
    assert.equal(claseCasilla("cap_largeunder", evaluaFiltro({}, "cap_largeunder")), "na");
    assert.equal(claseCasilla("fa_debteq_u1", evaluaFiltro({ "Debt/Eq": "3.77" }, "fa_debteq_u1")), "nok");
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

test("estadoDilucion: distingue alerta, sin alerta, sin datos y pendiente", () => {
    assert.equal(estadoDilucion({ pct: UMBRAL_DILUCION_PCT }), "alerta");
    assert.equal(estadoDilucion({ pct: 19.9 }), "ok");
    assert.equal(estadoDilucion({ pct: -5 }), "ok");
    assert.equal(estadoDilucion(null), "sin_datos");
    assert.equal(estadoDilucion(undefined), "pendiente");
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
    assert.equal(puntosEmpresa(ev, false), 3.65);
    assert.equal(puntosEmpresa(ev, true), -95.35);
    assert.equal(puntosEmpresa({}, false), 0);
});

test("puntosEmpresa: redondea a 2 decimales, sin restos de coma flotante", () => {
    // Sin redondear, 0.7 + 0.35 + 0.18 + 0.32 da 1.5499999999999998.
    const ev = {
        sh_short_u10: evaluaFiltro({ "Short Float": "5%" }, "sh_short_u10"),
        fa_evsales_u6: evaluaFiltro({ "EV/Sales": "3" }, "fa_evsales_u6"),
        ta_sma20_pa: evaluaFiltro({ "SMA20": "2%" }, "ta_sma20_pa"),
        sh_float_o1: evaluaFiltro({ "Shs Float": "200M" }, "sh_float_o1")
    };
    assert.equal(puntosEmpresa(ev, false), 1.55);
    // Con todos los filtros en su mejor tramo, el total es exactamente el maximo.
    const mejor = {};
    const fichaMejor = {
        "Market Cap": "10B", "P/E": "10", "Forward P/E": "10", "P/S": "3", "EV/Sales": "1",
        "Gross Margin": "50%", "Oper. Margin": "25%", "Current Ratio": "2.5", "Debt/Eq": "0.1",
        "LT Debt/Eq": "0.1", "EPS Y/Y TTM": "50%", "Inst Own": "90%", "Shs Float": "200M",
        "Short Float": "1%", "Rel Volume": "1", "ATR (14)": "2", "RSI (14)": "60", "SMA20": "6%",
        "52W Low": "50%", "Perf Half Y": "20%", "Perf 3Y": "80%"
    };
    for (const codigo of Object.keys(FILTROS)) mejor[codigo] = evaluaFiltro(fichaMejor, codigo);
    assert.equal(puntosEmpresa(mejor, false), 26.31);
    assert.equal(textoPuntos(puntosEmpresa(mejor, false)), "26.31");
});

test("puntosEmpresa: pasar todos los filtros justo por el borde da 13.69, por debajo de 16", () => {
    // Antes, pasar el screener garantizaba 17.25 o mas. Ver diseno_funcional.md SS7.7.
    const fichaBorde = {
        "Market Cap": "100B", "P/E": "25", "Forward P/E": "18", "P/S": "3", "EV/Sales": "5",
        "Gross Margin": "20%", "Oper. Margin": "10%", "Current Ratio": "1.2", "Debt/Eq": "0.8",
        "LT Debt/Eq": "0.8", "EPS Y/Y TTM": "10%", "Inst Own": "50%", "Shs Float": "50M",
        "Short Float": "8%", "Rel Volume": "1", "ATR (14)": "2", "RSI (14)": "45", "SMA20": "2%",
        "52W Low": "20%", "Perf Half Y": "5%", "Perf 3Y": "20%"
    };
    const borde = {};
    for (const codigo of Object.keys(FILTROS)) {
        borde[codigo] = evaluaFiltro(fichaBorde, codigo);
        assert.equal(borde[codigo].estado, "ok", codigo);
    }
    assert.equal(puntosEmpresa(borde, false), 13.69);
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

// --- Texto de la casilla de puntos ---

test("textoPuntos: por debajo de 16 puntos se anade '(poco)'", () => {
    assert.equal(PUNTOS_MINIMOS_COMPRA, 16);
    assert.equal(textoPuntos(7), "7 (poco)");
    assert.equal(textoPuntos(15.75), "15.75 (poco)");
    assert.equal(textoPuntos(0), "0 (poco)");
    assert.equal(textoPuntos(-89), "-89 (poco)");
    assert.equal(textoPuntos(16), "16");
    assert.equal(textoPuntos(19.5), "19.5");
});

// --- Comprobaciones estaticas de la pagina ---

test("app.js: dilucion sin datos en rojo con '(SIN DATOS: ver a mano)'", () => {
    const app = fs.readFileSync(path.join(DOCS, "app.js"), "utf8");
    assert.equal(TEXTO_DILUCION_SIN_DATOS, "(SIN DATOS: ver a mano)");
    assert.match(app, /if \(!d\) return celda\(TEXTO_DILUCION_SIN_DATOS, "nok"\);/);
    assert.equal(app.includes('celda("N/D"'), false);
});

test("app.js: marcas invisibles para lectura automatica (puntos y fin de la comparacion)", () => {
    const app = fs.readFileSync(path.join(DOCS, "app.js"), "utf8");
    assert.match(app, /data-ticker="/);
    assert.match(app, /data-puntos="/);
    assert.match(app, /data-sin-ficha="/);
    assert.match(app, /data-dilucion="/);
    assert.match(app, /document\.body\.dataset\.comparacion = "en_curso"/);
    assert.match(app, /document\.body\.dataset\.comparacion = "terminada"/);
    assert.match(app, /document\.body\.dataset\.bloqueoProxy = ultimoBloqueo \? "1" : "0"/);
});

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
