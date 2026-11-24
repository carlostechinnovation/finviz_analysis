// Tests del filtro "Excluir sectores" (docs/logica.js, seccion 7): lista
// estatica de sectores de Finviz, extraccion del sector de la ficha,
// parametro ?excluir_sectores= y separacion de empresas visibles/excluidas,
// mas comprobaciones estaticas de docs/index.html y docs/app.js.
// Sin DOM ni red: node --test, sin dependencias.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    SECTORES_FINVIZ, nombreSector, extraeSector, parseaSectoresExcluidos, separaPorSector,
    extraeDatosMarkdown, SELECTOR_FICHA_FINVIZ
} = require("../docs/logica.js");

const DOCS = path.join(__dirname, "..", "docs");

// Respuesta real de r.jina.ai (recortada) para XOM con el selector
// ".quote-header_category, .snapshot-table2" (2026-11-24).
const FICHA_XOM =
    "Title: XOM - ExxonMobil Holdings Corp Stock Price and Quote\n\n" +
    "URL Source: https://finviz.com/quote.ashx?t=XOM&p=d\n\n" +
    "Markdown Content:\n" +
    "[Energy](https://finviz.com/screener/stocks?v=111&f=sec_energy)" +
    "[Oil & Gas Integrated](https://finviz.com/screener/stocks?v=111&f=industry_oilgasintegrated \"Oil & Gas Integrated\")" +
    "[USA](https://finviz.com/screener/stocks?v=111&f=geo_usa)" +
    "[Mega](https://finviz.com/screener/stocks?v=111&f=cap_mega)" +
    "[NYSE](https://finviz.com/screener/stocks?v=111&f=exch_nyse)\n" +
    "Index**S&P 500, RUI**\n" +
    "Market Cap**645.93B**\n" +
    "P/E**14.20**\n";

test("SECTORES_FINVIZ: los 11 sectores del screener de Finviz, sin Any ni Custom", () => {
    assert.deepEqual(SECTORES_FINVIZ.map(s => s.nombre), [
        "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
        "Energy", "Financial", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"
    ]);
    for (const s of SECTORES_FINVIZ) {
        assert.match(s.codigo, /^[a-z]+$/, "codigo de URL de Finviz: " + s.codigo);
        assert.equal(s.codigo, s.nombre.toLowerCase().replace(/ /g, ""));
    }
});

test("nombreSector: nombre visible, o el codigo si no es un sector conocido", () => {
    assert.equal(nombreSector("realestate"), "Real Estate");
    assert.equal(nombreSector("zzz"), "zzz");
});

test("SELECTOR_FICHA_FINVIZ: pide la cabecera con el sector y la tabla de fundamentales", () => {
    assert.match(SELECTOR_FICHA_FINVIZ, /\.quote-header_category/);
    assert.match(SELECTOR_FICHA_FINVIZ, /\.snapshot-table2/);
});

test("extraeSector: lee el codigo del enlace f=sec_ de la ficha", () => {
    assert.equal(extraeSector(FICHA_XOM), "energy");
    assert.equal(extraeSector("Index**DJIA**\nP/E**30**"), null);
    assert.equal(extraeSector(undefined), null);
});

test("extraeDatosMarkdown: los enlaces de cabecera no estropean los campos de la tabla", () => {
    const datos = extraeDatosMarkdown(FICHA_XOM);
    assert.equal(datos["Index"], "S&P 500, RUI");
    assert.equal(datos["Market Cap"], "645.93B");
    assert.equal(datos["P/E"], "14.20");
});

test("parseaSectoresExcluidos: codigos validos sin duplicados, sin distinguir mayusculas", () => {
    assert.deepEqual(parseaSectoresExcluidos(" Energy, financial,energy ,,REALESTATE"),
        { codigos: ["energy", "financial", "realestate"], desconocidos: [] });
});

test("parseaSectoresExcluidos: separa los valores desconocidos (Any, nombres con espacio...)", () => {
    assert.deepEqual(parseaSectoresExcluidos("any,Real Estate,utilities"),
        { codigos: ["utilities"], desconocidos: ["any", "real estate"] });
});

test("parseaSectoresExcluidos: sin parametro no excluye nada", () => {
    assert.deepEqual(parseaSectoresExcluidos(null), { codigos: [], desconocidos: [] });
    assert.deepEqual(parseaSectoresExcluidos(""), { codigos: [], desconocidos: [] });
});

test("separaPorSector: oculta los sectores excluidos y mantiene el orden de entrada", () => {
    const resultados = {
        XOM: { sector: "energy" }, AAPL: { sector: "technology" },
        JPM: { sector: "financial" }, MSFT: { sector: "technology" }
    };
    assert.deepEqual(separaPorSector(["XOM", "AAPL", "JPM", "MSFT"], resultados, ["energy", "financial"]),
        { visibles: ["AAPL", "MSFT"], excluidas: ["XOM", "JPM"] });
});

test("separaPorSector: sin sectores marcados se ven todas", () => {
    const resultados = { XOM: { sector: "energy" }, AAPL: { sector: "technology" } };
    assert.deepEqual(separaPorSector(["XOM", "AAPL"], resultados, []),
        { visibles: ["XOM", "AAPL"], excluidas: [] });
});

test("separaPorSector: sector pendiente o desconocido no excluye la empresa", () => {
    const resultados = { PEND: { sector: undefined }, FALLO: { sector: null } };
    assert.deepEqual(separaPorSector(["PEND", "FALLO"], resultados, ["energy"]),
        { visibles: ["PEND", "FALLO"], excluidas: [] });
});

test("index.html: fieldset 'Excluir sectores' vacio (las casillas las crea app.js)", () => {
    const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
    assert.match(html, /<fieldset id="sectoresExcluidos"[^>]*>\s*<legend>Excluir sectores<\/legend>\s*<\/fieldset>/);
    assert.doesNotMatch(html, /type="checkbox"/);
});

test("app.js: casillas desde SECTORES_FINVIZ, desmarcadas salvo ?excluir_sectores=, y repintado al cambiar", () => {
    const app = fs.readFileSync(path.join(DOCS, "app.js"), "utf8");
    assert.match(app, /parametrosURL\.get\("excluir_sectores"\)/);
    assert.match(app, /for \(const s of SECTORES_FINVIZ\)/);
    assert.match(app, /casilla\.checked = excluirSectoresURL\.codigos\.includes\(s\.codigo\)/);
    assert.match(app, /sectoresExcluidosEl\.addEventListener\("change", cambiaSectoresExcluidos\)/);
    assert.match(app, /pintaFilaSector\(columnas, resultados\)/);
});
