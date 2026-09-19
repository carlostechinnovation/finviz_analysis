// Tests unitarios de la logica pura (docs/logica.js), sin DOM ni red.
// Se ejecutan con el test runner incorporado en Node (node --test), sin
// dependencias externas, en linea con el resto del proyecto (JS estatico
// sin build system).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    aNumero, compara, buscaValor, buscaDescripcion,
    extraeDatosMarkdown, cuentaConocidos, extraeJSON, calculaDilucion,
    normaliza, limpia, ALIAS
} = require("../docs/logica.js");

test("normaliza: pasa a minusculas y quita todo lo que no sea alfanumerico", () => {
    assert.equal(normaliza("EPS Y/Y TTM"), "epsyyttm");
    assert.equal(normaliza("52-Week High"), "52weekhigh");
});

test("limpia: colapsa espacios y recorta bordes", () => {
    assert.equal(limpia("  Market   Cap \n"), "Market Cap");
});

test("aNumero: formatos habituales de Finviz", () => {
    assert.equal(aNumero("1,234.5"), 1234.5);
    assert.equal(aNumero("12.34%"), 12.34);
    assert.equal(aNumero("+3.2%"), 3.2);
    assert.equal(aNumero("-3.2%"), -3.2);
    assert.equal(aNumero("3.45T", true), 3.45e12);
    assert.equal(aNumero("200M", true), 200e6);
    assert.equal(aNumero("1.5K", true), 1500);
    // Sin escala=true no debe aplicar el multiplicador de sufijo
    assert.equal(Number.isNaN(aNumero("200M", false)), false);
    assert.equal(aNumero("200M", false), 200); // se queda con la parte numerica
});

test("aNumero: valores no disponibles devuelven NaN", () => {
    assert.ok(Number.isNaN(aNumero("-")));
    assert.ok(Number.isNaN(aNumero("N/A")));
    assert.ok(Number.isNaN(aNumero(undefined)));
    assert.ok(Number.isNaN(aNumero(null)));
    assert.ok(Number.isNaN(aNumero("")));
});

test("aNumero: campos combinados 'a / b' se quedan con el primero", () => {
    assert.equal(aNumero("0.61% / 1.20"), 0.61);
});

test("aNumero: campos con dos numeros separados por espacio se quedan con el ultimo (caso 52W Low de r.jina.ai)", () => {
    assert.equal(aNumero("48.93 72.74%"), 72.74);
});

test("compara: los cuatro operadores soportados", () => {
    assert.equal(compara(5, ">", 3), true);
    assert.equal(compara(5, ">", 5), false);
    assert.equal(compara(5, ">=", 5), true);
    assert.equal(compara(5, "<", 3), false);
    assert.equal(compara(5, "<=", 5), true);
});

test("compara: operador desconocido devuelve null", () => {
    assert.equal(compara(5, "!=", 3), null);
});

test("buscaValor: coincidencia directa, por alias y normalizada", () => {
    const datos = { "Fwd P/E": "12.3", "shsoutstand": "14.21M" };
    assert.equal(buscaValor(datos, "Fwd P/E"), "12.3");
    assert.equal(buscaValor(datos, "Forward P/E"), "12.3"); // via ALIAS
    assert.equal(buscaValor({ "Shs Outstand": "14.21M" }, "Shs  outstand"), "14.21M"); // via normaliza()
    assert.equal(buscaValor({}, "Lo que sea"), undefined);
});

test("buscaDescripcion: mismo comportamiento que buscaValor pero con cadena vacia por defecto", () => {
    const desc = { "Fwd P/E": "Precio sobre beneficio futuro" };
    assert.equal(buscaDescripcion(desc, "Fwd P/E"), "Precio sobre beneficio futuro");
    assert.equal(buscaDescripcion(desc, "Forward P/E"), "Precio sobre beneficio futuro");
    assert.equal(buscaDescripcion(desc, "Inexistente"), "");
});

test("ALIAS cubre EPS Y/Y TTM y 52W Low usados por el filtro anti-dilucion", () => {
    assert.ok(ALIAS["EPS Y/Y TTM"].includes("EPS Y/Y"));
    assert.ok(ALIAS["52W Low"].includes("52-Week Low"));
});

test("extraeDatosMarkdown: pares Clave**Valor**, con y sin enlaces markdown", () => {
    const texto = "Market Cap**19.61M**P/E**-**[Fwd P/E](url)[**6.60**](url)";
    const datos = extraeDatosMarkdown(texto);
    assert.equal(datos["Market Cap"], "19.61M");
    assert.equal(datos["P/E"], "-");
    assert.equal(datos["Fwd P/E"], "6.60");
});

test("extraeDatosMarkdown: ignora una 'clave' que en realidad es un numero en negrita", () => {
    const texto = "**339.08**Precio actual";
    const datos = extraeDatosMarkdown(texto);
    assert.equal(Object.keys(datos).includes("339.08"), false);
});

test("extraeDatosMarkdown: la primera aparicion de una clave gana sobre repeticiones posteriores", () => {
    const texto = "P/E**10**P/E**20**";
    const datos = extraeDatosMarkdown(texto);
    assert.equal(datos["P/E"], "10");
});

test("cuentaConocidos: solo cuenta etiquetas del diccionario FILTROS/ALIAS", () => {
    const datos = { "P/E": "10", "Campo Inventado": "x" };
    assert.equal(cuentaConocidos(datos), 1);
});

test("extraeJSON: tolera el envoltorio tipico de r.jina.ai antes y despues del JSON", () => {
    const envuelto =
        "Title: data.sec.gov\n" +
        "URL Source: https://data.sec.gov/api/xbrl/companyconcept/CIK0001858685/us-gaap/CommonStockSharesOutstanding.json\n" +
        "Markdown Content:\n" +
        '{"cik":1858685,"units":{"shares":[{"end":"2025-06-30","val":10138567}]}}\n' +
        "\n---\nFin de la pagina renderizada.";
    const json = extraeJSON(envuelto);
    assert.ok(json);
    assert.equal(json.cik, 1858685);
    assert.equal(json.units.shares[0].val, 10138567);
});

test("extraeJSON: sin llaves reconocibles devuelve null", () => {
    assert.equal(extraeJSON("esto no es json en absoluto"), null);
});

test("extraeJSON: JSON corrupto entre las llaves devuelve null en vez de lanzar", () => {
    assert.equal(extraeJSON("ruido { esto no es json valido "), null);
});

test("calculaDilucion: caso real BFRI, +40% en 1 anio dispara el umbral (ver README 7.4)", () => {
    // Datos reales de SEC EDGAR (CIK 1858685, us-gaap:CommonStockSharesOutstanding)
    const puntos = [
        { end: "2024-03-31", val: 5089413,  form: "10-Q" },
        { end: "2024-06-30", val: 5094184,  form: "10-Q" },
        { end: "2024-09-30", val: 6529792,  form: "10-Q" },
        { end: "2024-12-31", val: 8873932,  form: "10-K" },
        { end: "2025-03-31", val: 8873932,  form: "10-Q" },
        { end: "2025-06-30", val: 10138567, form: "10-Q" },
        { end: "2025-09-30", val: 11648323, form: "10-Q" },
        { end: "2025-12-31", val: 11648323, form: "10-K" },
        { end: "2026-03-31", val: 11873323, form: "10-Q" },
        { end: "2026-06-30", val: 14206126, form: "10-Q" }
    ];
    const r = calculaDilucion(puntos);
    assert.ok(r);
    assert.equal(r.actual.end, "2026-06-30");
    assert.equal(r.anterior.end, "2025-06-30");
    assert.ok(r.pct > 20, "se esperaba superar el umbral de dilucion fuerte (20%)");
    assert.ok(Math.abs(r.pct - 40.12) < 0.01);
});

test("calculaDilucion: acciones estables no disparan alerta (pct cercano a 0)", () => {
    const puntos = [
        { end: "2024-06-30", val: 10000000 },
        { end: "2025-06-30", val: 10050000 }
    ];
    const r = calculaDilucion(puntos);
    assert.ok(r);
    assert.ok(r.pct < 20);
});

test("calculaDilucion: menos de 2 puntos validos devuelve null", () => {
    assert.equal(calculaDilucion([]), null);
    assert.equal(calculaDilucion([{ end: "2025-01-01", val: 100 }]), null);
});

test("calculaDilucion: sin ningun dato cerca de 'hace 1 anio' (fuera de tolerancia) devuelve null", () => {
    const puntos = [
        { end: "2020-01-01", val: 100 },
        { end: "2026-01-01", val: 500 }
    ];
    assert.equal(calculaDilucion(puntos), null);
});

test("calculaDilucion: descarta puntos con val no numerico o sin fecha", () => {
    const puntos = [
        { end: "2025-06-30", val: 10000000 },
        { end: "2026-06-30", val: "no es un numero" },
        { end: null, val: 999 },
        { end: "2026-06-30", val: 14000000 }
    ];
    const r = calculaDilucion(puntos);
    assert.ok(r);
    assert.equal(r.actual.val, 14000000);
    assert.equal(r.anterior.val, 10000000);
});
