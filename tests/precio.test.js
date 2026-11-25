// Tests de la marca data-precio (lectura automatica del proceso semanal de
// solvencia: diseno_informatico.md 6.2).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { textoPrecio, extraeDatosMarkdown, ETIQUETA_PRECIO } = require("../docs/logica.js");

test("textoPrecio: lee el campo Price de la ficha real (AAPL 2026-11-24)", () => {
    const datos = extraeDatosMarkdown("Markdown Content:\nPrev Close**349.08**\nPrice**354.20**\nChange**1.47%**\n");
    assert.equal(ETIQUETA_PRECIO, "Price");
    assert.equal(textoPrecio(datos), "354.2");
});

test("textoPrecio: vacio sin ficha, sin campo o con un valor no numerico", () => {
    assert.equal(textoPrecio(null), "");
    assert.equal(textoPrecio({}), "");
    assert.equal(textoPrecio({ Price: "-" }), "");
    assert.equal(textoPrecio({ Price: "1,234.50" }), "1234.5");
});

test("app.js: la casilla de puntos lleva data-precio con textoPrecio de la ficha", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");
    assert.match(app, /data-precio="/);
    assert.match(app, /textoPrecio\(resultadosPorTicker\[t\]\.datos\)/);
});

test("logica.js y app.js siguen en ASCII puro", () => {
    for (const f of ["logica.js", "app.js"]) {
        const texto = fs.readFileSync(path.join(__dirname, "..", "docs", f), "utf8");
        assert.ok(/^[\x00-\x7F]*$/.test(texto), f + " tiene caracteres no ASCII");
    }
});
