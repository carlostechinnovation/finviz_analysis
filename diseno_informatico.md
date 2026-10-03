# Diseño informático

## 1. Arquitectura

Todo se ejecuta **en el navegador**; no hay servidor propio, base de datos ni claves de API. Es una web estática publicable tal cual en GitHub Pages.

```
navegador  --fetch-->  https://r.jina.ai/https://finviz.com/quote.ashx?t=TICKER
                              |
                              +--> devuelve la pagina renderizada como texto/markdown
                                   con cabeceras CORS abiertas

navegador  --fetch-->  https://r.jina.ai/https://data.sec.gov/api/xbrl/companyconcept/CIK.../....json
                              |
                              +--> devuelve el JSON de SEC EDGAR (envuelto en metadatos
                                   de r.jina.ai, ver logica.js:extraeJSON)
```

- **Por qué un proxy**: GitHub Pages no puede llamar a `finviz.com` ni a `data.sec.gov` directamente por CORS (comprobado: `data.sec.gov` no devuelve `Access-Control-Allow-Origin` en sus respuestas JSON), y no hay backend propio. Se usa `r.jina.ai`, que renderiza la página en su servidor y la devuelve con CORS abierto. **Timeout de 30 s** por llamada (`TIMEOUT_MS` en `app.js`).
- **Cupo del proxy: 20 peticiones/minuto por IP** sin clave (cabecera `x-ratelimit-limit: 20, 20;w=60`, comprobada el 2026-09-29). Todas las llamadas pasan por **una única cola** (`creaLimitador` en `logica.js`) que no arranca más de `PROXY_MAX_POR_MINUTO = 18` peticiones por ventana deslizante de 60 s ni más de `PROXY_MAX_SIMULTANEAS = 4` a la vez, con **prioridad para las fichas de Finviz** sobre las consultas a SEC EDGAR. Antes de esta cola, abrir los 55 tickers del email de DIIA lanzaba las 55 fichas a la vez y el proxy devolvía **HTTP 429 a 35 de ellas**: los datos existían en Finviz, era el proxy el que las rechazaba.
- **Reintentos** (`pideAlProxy` en `app.js`, hasta `PROXY_MAX_INTENTOS = 4`): se reintenta lo transitorio — red o timeout, HTTP 408/429/5xx, respuesta vacía o con menos de `MIN_CAMPOS_VALIDOS` campos (el proxy devuelve a veces la ficha vacía y a la siguiente llamada completa). Un 429 además **pausa toda la cola 30 s**. No se reintenta lo definitivo: un ticker que Finviz no reconoce (el proxy devuelve su página de búsqueda, `Title: Search`) o un 404 del destino, que `r.jina.ai` entrega como HTTP 200 con la línea `Warning: Target URL returned error 404`.
- **Sin claves gestionadas por esta app**: al depender de un proxy público de terceros, su disponibilidad no está bajo control del proyecto (ver [§5](#5-limitaciones-técnicas-conocidas)).

## 2. Estructura del repositorio

```
docs/                            <- raiz publicada en GitHub Pages
├── index.html                   formulario, botones de orden + tabla de resultados (cabecera dinamica)
├── logica.js                    logica pura: filtros, parseo, dilucion, puntuacion y orden (sin DOM ni red)
├── app.js                       DOM, descarga (fetch a los proxies) y orquestacion multi-ticker
├── style.css                    estilos (ok / nok / na / dilucion-alerta, filas y botones de orden)
├── urls_screeners_finviz.csv    screeners predefinidos   (SCREENER|URL)
└── descripcion_filtros.csv      glosario de campos Finviz (FILTRO|DESCRIPCION)
tests/
├── logica.test.js               tests de parseo, dilucion y cola del proxy (docs/logica.js)
└── orden.test.js                tests de evaluacion de casillas, pesos/tramos, patrimonio negativo,
                                  puntuacion y orden de columnas,
                                  mas comprobaciones estaticas de index.html / app.js / style.css
package.json                     solo para poder correr "npm test" (sin dependencias)
README.md                        resumen para la portada de GitHub
diseno_funcional.md              este documento hermano: el porque (con referencias)
diseno_informatico.md            este documento
CLAUDE.md                        normas de este proyecto para Claude Code (ver alli el porque
                                  no sigue el stack Python/FastAPI/React por defecto)
```

Los dos CSV usan **`|` como separador** (no coma) y tienen una línea de cabecera.

`logica.js` se carga en `index.html` **antes** que `app.js` (variables globales compartidas, sin módulos ni bundler) y además expone sus funciones vía `module.exports`, protegido por `if (typeof module !== "undefined")`, para poder testearlas con Node sin afectar al navegador (donde `module` no existe).

No hay carpetas `modulos/`, `permanentes/`, `volatiles/`, `web/` ni `sql/`: no aplican porque no hay backend, no se persisten datos entre ejecuciones y no hay base de datos. Ver `CLAUDE.md` para el detalle de por qué se aparta de la estructura estándar de proyectos del autor.

## 3. Flujo de ejecución (comparación multi-ticker)

0. Entrada alternativa por URL: si la página se abre con `?tickers=AAA,BBB,CCC`, `app.js` precarga ese valor en el campo "Ticker de empresas" y lanza la comparación sola en cuanto termina `loadScreeners()` (con el screener por defecto, `SCREENER_POR_DEFECTO = "solventes"`), sin esperar un clic en "Comparar". Es el mecanismo que usa el email resumen de [DIIA](https://github.com/carlostechinnovation/diia) para enlazar su tabla de Selección del día ya calculada. Si además llega `?escenario=texto`, `app.js` lo escribe (con `textContent`, nunca como HTML) en el `<h2 id="escenario">` bajo el título y lo hace visible; sin el parámetro, el subtítulo queda oculto. Los emails de [bolsa](https://github.com/carlostechinnovation/bolsa) (modo futuro) y DIIA lo rellenan con `BolsaML - {fecha}` y `DIIA - {fecha}`, la misma fecha que muestra la cabecera de cada email.
1. El usuario escribe uno o varios tickers separados por comas en el campo "Ticker de empresas" y elige un screener (o pega una URL).
2. `leeTickers()` (`app.js`) separa por comas, recorta espacios, pasa a mayúsculas y elimina duplicados y vacíos.
3. `leeFiltrosScreener()` extrae los códigos de filtro del parámetro `f=` de la URL del screener.
4. Para **cada ticker** se encolan sus tareas (`Promise.all`), que la cola del proxy despacha al ritmo permitido (§1):
   1. `descargaDatos(ticker)`: descarga y parsea la ficha de Finviz (`docs/logica.js:extraeDatosMarkdown`).
   2. `compruebaDilucion(ticker)`: resuelve el CIK del ticker en SEC EDGAR (`resuelveCIK`; el fichero completo ticker→CIK se descarga **una sola vez** y se cachea la *promesa*, no el resultado: cachear un objeto vacío mientras llegaba la descarga hacía que todos los tickers menos el primero salieran como "no encontrado") y busca una comparación de acciones en circulación (`buscaDilucionSEC`), probando las etiquetas XBRL de `XBRL_TAGS_SHARES` **hasta encontrar una reciente y coherente** (`docs/logica.js:calculaDilucion` con la fecha de hoy: último dato de hace menos de `ANTIGUEDAD_MAX_DILUCION_DIAS = 550` días, sin ceros y sin caídas de más del 90 %, que son errores de escala del XBRL).
   3. Ninguna de las dos llamadas lanza excepción hacia arriba: un fallo en un ticker (Finviz caído, ticker no listado en SEC, etc.) se registra en el log y ese ticker queda marcado como "sin datos" para Finviz y/o sin alerta de dilución, **sin bloquear a los demás tickers**.
   4. Cada vez que termina una descarga se **repinta la tabla** (`repinta()`) con lo que haya llegado: las celdas pendientes muestran `(descargando)` / `(pendiente)`. Con 55 tickers la comparación completa tarda unos 7-10 minutos, marcados por el cupo del proxy; el progreso y el balance final van al log.
5. `pintaMultiTicker(comparacion)` construye la tabla a partir del estado guardado en `comparacionActual` (`{ tickers, filtros, resultadosPorTicker, descripciones }`):
   1. `ordenaFiltros` (orden económico de `ORDEN`) y `evaluaTabla` → `evaluaFiltro`, que da el texto, el estado `ok`/`nok`/`na`, el valor numérico de cada casilla y dos marcas:
      - `sinFicha`: descarga pendiente o fallida.
      - `patrimonioNegativo`: `hayPatrimonioNegativo`, es decir, `Book/sh` < 0 o ratio negativo en Debt/Eq o LT Debt/Eq. En ese caso la casilla pasa a `nok` con el texto `(patrimonio negativo)`.
   2. `calculaPuntosPorTicker` → `puntosEmpresa` → `puntosCasilla` aplica `PESOS_FILTROS`, la matriz de pesos que prima la solvencia (diseno_funcional.md §7), en este orden:
      - `sinFicha` → 0;
      - patrimonio negativo → `incumple` (peor tramo);
      - N/A → `na`;
      - con `tramos` → `puntosTramo` (primer tramo cuya comparación `op`/`limite` se cumple);
      - si no → `cumple` / `incumple`.

      Al total se suma `PUNTOS_ALERTA_DILUCION` (−99) si `hayAlertaDilucion`. Todo en `logica.js`, sin DOM. Para cambiar un peso o un tramo basta con editar `PESOS_FILTROS`; los tests comprueban que cada filtro soportado tiene pesos y que los tramos siguen alineados con la condición del screener.
   3. `ordenaTickers(tickers, puntos, criterioOrden)` decide el orden de las columnas: `ORDEN_ENTRADA` (el del textbox) u `ORDEN_PUNTOS` (de más a menos puntos; a igualdad, orden de entrada). Devuelve una lista nueva: el orden de entrada nunca se modifica.
   4. Pinta, con ese orden de columnas:
      - Cabecera dinámica (`pintaCabecera`): `Filtro | Condición Screener | Descripción` + una columna por ticker.
      - Fila `Orden entrada` (`pintaFilaOrdenEntrada`, clase `.fila-orden`, gris claro): posición 1, 2, 3… de cada ticker en el textbox. Solo si `hayVariasEmpresas` (2 o más).
      - Fila `Orden por filtros cumplidos` (`pintaFilaPuntos`, clase `.fila-puntos`): los puntos de cada ticker.
      - Fila de dilución (`pintaFilaDilucion` → `celdaDilucion`): verde (`.ok`) por debajo del umbral, rojo (`.dilucion-alerta`) con `ALERTA POR DILUCIÓN: +XX% en 1 año` si lo supera, naranja (`.na`) si no hay datos en SEC EDGAR (`N/D`).
      - Una fila por filtro (`pintaFilaFiltro`): el valor va **dentro** de la celda de su ticker y el color (verde `.ok` / rojo `.nok` / naranja `.na`) indica `CUMPLE` / `INCUMPLE` / `N/A`.
6. Botones **Orden entrada** / **Orden por filtros cumplidos** (`#botonesOrden`, bajo "Comparar"): `actualizaBotonesOrden()` los muestra solo con 2 o más tickers y marca el activo (`.activo`, `aria-pressed`). Al pulsar uno, `seleccionaOrden(criterio)` cambia `criterioOrden` y llama a `repinta()`: la tabla se recarga reordenando las columnas **sin volver a descargar nada**. El criterio elegido se mantiene durante las descargas en curso y en las siguientes comparaciones de la sesión (por defecto, orden de entrada).

No hay ejecución programada ni tareas en segundo plano: todo ocurre **bajo demanda**, al pulsar "Comparar". No hay, por tanto, planificación temporal que documentar.

## 4. Instalación y uso en local

No requiere instalación de dependencias para usar la app (JS puro, sin build). Para desarrollarla o correr los tests sí hace falta Node.js (usado: v20).

```bash
# Servir la app (abrir index.html como file:// falla al cargar los CSV)
cd docs
python -m http.server 8000
# http://localhost:8000

# Tests unitarios de la logica pura (raiz del repo)
npm test
```

`package.json` no declara dependencias: `npm test` solo invoca `node --test tests/`, el test runner incorporado en Node desde la v18, que ejecuta todos los `tests/*.test.js`. Sin DOM ni red: la lógica de puntuación y orden está en `logica.js` precisamente para poder probarla así; `tests/orden.test.js` comprueba además, leyendo los ficheros, que los botones de orden están en `index.html`, que no queda rastro de `#resumen` y que `app.js` / `logica.js` siguen en ASCII puro.

### Añadir un screener nuevo

Añadir una línea a `docs/urls_screeners_finviz.csv`:

```
nombre_del_screener|https://finviz.com/screener.ashx?v=111&f=cap_midover,fa_pe_u20
```

La app solo mira el parámetro `f=` de la URL; el resto (`v`, `o`, `p`, `ft`) se ignora.

## 5. Limitaciones técnicas conocidas

- **Dependencia de un proxy de terceros (`r.jina.ai`).** Si está caído o cambia el formato de salida, la descarga falla aunque se reintente. Su cupo (20 peticiones/minuto por IP) fija la duración de una comparación grande: no se puede acelerar sin una clave de pago, que no puede ir en una web pública.
- **El parseo de Finviz es frágil por naturaleza.** Se basa en el texto renderizado de la ficha; cualquier cambio de maquetación puede romperlo. El umbral de 8 campos reconocidos (`MIN_CAMPOS_VALIDOS`) existe para detectarlo y avisar en vez de dar resultados falsos.
- **El JSON de SEC EDGAR llega envuelto** en metadatos que añade `r.jina.ai` (`Title:`, `URL Source:`, `Markdown Content:`) porque ese proxy está pensado para HTML, no para JSON. `logica.js:extraeJSON` extrae el primer objeto `{...}` de la respuesta en vez de asumir que el cuerpo entero es JSON limpio; si el proxy además reformatea el contenido interno del JSON, el parseo puede fallar igualmente (se degrada sin romper el resto de la comparación).
- **Codificación ASCII pura en `app.js` y `logica.js`.** Los acentos y símbolos van como escapes `\uXXXX` dentro de las cadenas, para que ningún editor los corrompa al guardar en otra codificación. Al editar estos ficheros a mano hay que mantener esa convención.
- **Sin caché ni histórico.** Cada comparación vuelve a descargar todo; no hay seguimiento de la evolución de una empresa entre comparaciones.
- **Coste por ticker.** Cada ticker cuesta 1 petición a Finviz y de 1 a 3 a SEC EDGAR (más una única para el mapeo ticker→CIK). La cola evita el 429, pero el tiempo total crece lineal con el número de tickers.
- **Tickers que Finviz no cubre.** Algunas clases de acción cotizan pero no tienen ficha en Finviz (p. ej. `RUSHB`: `finviz.com` responde 404; sí existe `RUSHA`). Se muestran como "sin datos" tras un único intento.
- **Empresas con varias clases de acción** suelen salir `N/D` en dilución: informan las acciones por clase (dato dimensional) y la API `companyconcept` de la SEC solo devuelve los datos sin dimensión.
