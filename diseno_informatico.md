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

- **Por qué un proxy**: GitHub Pages no puede llamar a `finviz.com` ni a `data.sec.gov` directamente por CORS, y no hay backend propio. Se usa `r.jina.ai`, que renderiza la página en su servidor y la devuelve con CORS abierto. Una llamada por recurso, sin reintentos, con **timeout de 20 s** (`TIMEOUT_MS` en `app.js`).
- **Sin claves ni cuotas gestionadas por esta app**: al depender de un proxy público de terceros, la disponibilidad y los límites de uso no están bajo control del proyecto (ver [§5](#5-limitaciones-técnicas-conocidas)).

## 2. Estructura del repositorio

```
docs/                            <- raiz publicada en GitHub Pages
├── index.html                   formulario + tabla de resultados (cabecera dinamica)
├── logica.js                    logica pura: filtros, parseo, calculo de dilucion (sin DOM ni red)
├── app.js                       DOM, descarga (fetch a los proxies) y orquestacion multi-ticker
├── style.css                    estilos (colores ok / nok / na / dilucion-alerta)
├── urls_screeners_finviz.csv    screeners predefinidos   (SCREENER|URL)
└── descripcion_filtros.csv      glosario de campos Finviz (FILTRO|DESCRIPCION)
tests/
└── logica.test.js               tests unitarios de docs/logica.js (node --test)
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

0. Entrada alternativa por URL: si la página se abre con `?tickers=AAA,BBB,CCC`, `app.js` precarga ese valor en el campo "Ticker de empresas" y lanza la comparación sola en cuanto termina `loadScreeners()` (con el screener por defecto, `SCREENER_POR_DEFECTO = "solventes"`), sin esperar un clic en "Comparar". Es el mecanismo que usa el email resumen de [DIIA](https://github.com/carlostechinnovation/diia) para enlazar su tabla de Selección del día ya calculada.
1. El usuario escribe uno o varios tickers separados por comas en el campo "Ticker de empresas" y elige un screener (o pega una URL).
2. `leeTickers()` (`app.js`) separa por comas, recorta espacios, pasa a mayúsculas y elimina duplicados y vacíos.
3. `leeFiltrosScreener()` extrae los códigos de filtro del parámetro `f=` de la URL del screener.
4. Para **cada ticker**, en paralelo (`Promise.all`):
   1. `descargaDatos(ticker)`: descarga y parsea la ficha de Finviz (`docs/logica.js:extraeDatosMarkdown`).
   2. `compruebaDilucion(ticker)`: resuelve el CIK del ticker en SEC EDGAR (`resuelveCIK`, con caché en memoria del fichero completo ticker→CIK), descarga el histórico de acciones en circulación (`descargaHistoricoShares`, probando varias etiquetas XBRL) y calcula la variación en ~1 año (`docs/logica.js:calculaDilucion`).
   3. Ninguna de las dos llamadas lanza excepción hacia arriba: un fallo en un ticker (Finviz caído, ticker no listado en SEC, etc.) se registra en el log y ese ticker queda marcado como "sin datos" para Finviz y/o sin alerta de dilución, **sin bloquear a los demás tickers**.
5. `pintaMultiTicker()` construye la tabla:
   - Cabecera dinámica (`pintaCabecera`): `Filtro | Condición Screener | Descripción` + una columna por ticker.
   - Primera fila (`pintaFilaDilucion`): el porcentaje de variación de acciones en circulación de cada ticker, dentro de su propia celda — verde (`.ok`) si está por debajo del umbral, rojo (`.dilucion-alerta`) con el texto `ALERTA POR DILUCIÓN: +XX% en 1 año` si lo supera, naranja (`.na`) si no hay datos en SEC EDGAR (`N/D`).
   - Una fila por cada filtro del screener: el valor de la empresa va **dentro** de la celda de su ticker (no en una columna aparte), y el color de esa celda (verde `.ok` / rojo `.nok` / naranja `.na`) es lo que indica `CUMPLE` / `INCUMPLE` / `N/A`.
6. El resumen final (`#resumen`) muestra una línea por ticker con sus contadores y, si aplica, el aviso de descarte por dilución.

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

`package.json` no declara dependencias: `npm test` solo invoca `node --test tests/`, el test runner incorporado en Node desde la v18.

### Añadir un screener nuevo

Añadir una línea a `docs/urls_screeners_finviz.csv`:

```
nombre_del_screener|https://finviz.com/screener.ashx?v=111&f=cap_midover,fa_pe_u20
```

La app solo mira el parámetro `f=` de la URL; el resto (`v`, `o`, `p`, `ft`) se ignora.

## 5. Limitaciones técnicas conocidas

- **Dependencia de un proxy de terceros (`r.jina.ai`).** Si está caído, saturado o cambia el formato de salida, la descarga falla. No hay reintentos. Con varios tickers a la vez se lanzan varias peticiones en paralelo al mismo proxy público, sin límite explícito de concurrencia (decisión de diseño: se prioriza la simplicidad sobre la protección frente a saturación del proxy gratuito).
- **El parseo de Finviz es frágil por naturaleza.** Se basa en el texto renderizado de la ficha; cualquier cambio de maquetación puede romperlo. El umbral de 8 campos reconocidos (`MIN_CAMPOS_VALIDOS`) existe para detectarlo y avisar en vez de dar resultados falsos.
- **El JSON de SEC EDGAR llega envuelto** en metadatos que añade `r.jina.ai` (`Title:`, `URL Source:`, `Markdown Content:`) porque ese proxy está pensado para HTML, no para JSON. `logica.js:extraeJSON` extrae el primer objeto `{...}` de la respuesta en vez de asumir que el cuerpo entero es JSON limpio; si el proxy además reformatea el contenido interno del JSON, el parseo puede fallar igualmente (se degrada sin romper el resto de la comparación).
- **Codificación ASCII pura en `app.js` y `logica.js`.** Los acentos y símbolos van como escapes `\uXXXX` dentro de las cadenas, para que ningún editor los corrompa al guardar en otra codificación. Al editar estos ficheros a mano hay que mantener esa convención.
- **Sin caché ni histórico.** Cada comparación vuelve a descargar todo; no hay seguimiento de la evolución de una empresa entre comparaciones.
- **Sin límite de tickers simultáneos.** Cada ticker añadido multiplica el número de peticiones de red (1 a Finviz + hasta 3 a SEC EDGAR, esta última cacheada la parte de ticker→CIK). Es responsabilidad de quien usa la herramienta no abusar del proxy público.
