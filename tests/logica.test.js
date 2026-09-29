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
    normaliza, limpia, ALIAS,
    creaLimitador, esReintentable, errorDestinoProxy, esBusquedaFinviz, minutosEstimados,
    PROXY_MAX_POR_MINUTO
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

// --- Cola del proxy (r.jina.ai admite 20 peticiones/minuto por IP) ---

test("PROXY_MAX_POR_MINUTO deja margen bajo el cupo real de r.jina.ai (20/min)", () => {
    assert.ok(PROXY_MAX_POR_MINUTO < 20);
});

test("creaLimitador: nunca arranca mas tareas por ventana que el cupo", async () => {
    const limitador = creaLimitador(3, 150, 10);
    const arranques = [];
    const tareas = [];
    for (let i = 0; i < 7; i++) {
        tareas.push(limitador.encola(async () => { arranques.push(Date.now()); return i; }));
    }
    const resultados = await Promise.all(tareas);
    assert.deepEqual(resultados, [0, 1, 2, 3, 4, 5, 6]);
    // En cualquier ventana de 150 ms caben como mucho 3 arranques.
    for (let i = 3; i < arranques.length; i++) {
        assert.ok(arranques[i] - arranques[i - 3] >= 145, "arranque " + i + " demasiado pronto");
    }
});

test("creaLimitador: respeta el maximo de tareas simultaneas", async () => {
    const limitador = creaLimitador(100, 1000, 2);
    let activas = 0, maximo = 0;
    const tarea = () => limitador.encola(async () => {
        activas++;
        maximo = Math.max(maximo, activas);
        await new Promise(r => setTimeout(r, 20));
        activas--;
    });
    await Promise.all([tarea(), tarea(), tarea(), tarea(), tarea()]);
    assert.equal(maximo, 2);
});

test("creaLimitador: a igual cupo, despacha antes la prioridad baja (Finviz) que la alta (SEC)", async () => {
    const limitador = creaLimitador(100, 1000, 1);
    const orden = [];
    const bloqueo = limitador.encola(() => new Promise(r => setTimeout(r, 20)));
    const p1 = limitador.encola(async () => orden.push("sec"), 1);
    const p2 = limitador.encola(async () => orden.push("finviz"), 0);
    await Promise.all([bloqueo, p1, p2]);
    assert.deepEqual(orden, ["finviz", "sec"]);
});

test("creaLimitador: una tarea que lanza rechaza su promesa y no bloquea la cola", async () => {
    const limitador = creaLimitador(100, 1000, 1);
    await assert.rejects(limitador.encola(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await limitador.encola(async () => "sigue"), "sigue");
    assert.equal(limitador.pendientes(), 0);
});

test("creaLimitador: pausa() retrasa los arranques siguientes", async () => {
    const limitador = creaLimitador(100, 1000, 5);
    limitador.pausa(80);
    const t0 = Date.now();
    await limitador.encola(async () => null);
    assert.ok(Date.now() - t0 >= 75);
});

test("esReintentable: transitorios si, errores definitivos no", () => {
    for (const s of [0, 408, 429, 500, 502, 503, 504]) assert.equal(esReintentable(s), true, String(s));
    for (const s of [400, 401, 403, 404, 422]) assert.equal(esReintentable(s), false, String(s));
});

test("errorDestinoProxy: lee el aviso de r.jina.ai cuando el destino falla", () => {
    const texto = "Title: \n\nURL Source: https://data.sec.gov/x.json\n\n" +
        "Warning: Target URL returned error 404: Not Found\n\nMarkdown Content:\n`NoSuchKey`";
    assert.equal(errorDestinoProxy(texto), 404);
    assert.equal(errorDestinoProxy("Title: FDX\n\nMarkdown Content:\nMarket Cap**68.55B**"), null);
});

test("esBusquedaFinviz: un ticker inexistente cae en la pagina de busqueda", () => {
    assert.equal(esBusquedaFinviz("Title: Search\n\nURL Source: https://finviz.com/quote.ashx?t=ZZZZQX"), true);
    assert.equal(esBusquedaFinviz("Title: XMTR - Xometry Inc Stock Price and Quote\n\nURL Source: x"), false);
});

test("minutosEstimados: redondea hacia arriba al ritmo del cupo", () => {
    assert.equal(minutosEstimados(0), 1);
    assert.equal(minutosEstimados(PROXY_MAX_POR_MINUTO), 1);
    assert.equal(minutosEstimados(PROXY_MAX_POR_MINUTO + 1), 2);
    assert.equal(minutosEstimados(111), Math.ceil(111 / PROXY_MAX_POR_MINUTO));
});

// --- Dilucion: datos caducados o incoherentes (casos reales del 2026-09-29) ---

test("calculaDilucion: con 'hoy', rechaza una etiqueta XBRL abandonada hace anios (WLY 2010-2011)", () => {
    const puntos = [
        { end: "2010-08-31", val: 60264327 },
        { end: "2011-05-31", val: 60884591 }
    ];
    assert.ok(calculaDilucion(puntos), "sin 'hoy' se sigue calculando (compatibilidad)");
    assert.equal(calculaDilucion(puntos, new Date("2026-09-29")), null);
});

test("calculaDilucion: con 'hoy', acepta un dato de hace menos de ~18 meses", () => {
    const puntos = [
        { end: "2024-12-31", val: 118209139 },
        { end: "2025-12-31", val: 122943172 }
    ];
    const r = calculaDilucion(puntos, new Date("2026-09-29"));
    assert.ok(r);
    assert.ok(Math.abs(r.pct - 4.0) < 0.1);
});

test("calculaDilucion: ignora los ceros (XMTR declaraba 0 acciones en 2021-12-31)", () => {
    const puntos = [
        { end: "2020-12-31", val: 7755782 },
        { end: "2021-12-31", val: 0 }
    ];
    assert.equal(calculaDilucion(puntos), null);
});

test("calculaDilucion: una caida de mas del 90% es un error de escala, no un dato (CPK)", () => {
    const puntos = [
        { end: "2025-08-04", val: 23544479000 },
        { end: "2026-08-03", val: 24106455 }
    ];
    assert.equal(calculaDilucion(puntos, new Date("2026-09-29")), null);
});

test("calculaDilucion: 'shares' que no es una lista (la SEC devuelve {} a veces, CTSH) no lanza", () => {
    assert.equal(calculaDilucion({}), null);
    assert.equal(calculaDilucion(undefined), null);
});
