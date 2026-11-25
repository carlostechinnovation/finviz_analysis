# Diseño informático

## 1. Arquitectura

El proyecto tiene dos partes:

- **La web (`docs/`)**: todo se ejecuta **en el navegador**, sin servidor propio, base de datos ni claves de API. Es una web estática publicable tal cual en GitHub Pages. Esta sección y las §2–§5 la describen.
- **El proceso semanal de solvencia** (el resto del código: `principal.py`, `modulos/`, `sql/`…): Python con MariaDB y email, en el servidor Windows. Abre la web publicada con un navegador sin ventana para todo el Russell 3000 y guarda cada semana puntos y precio. Se describe en las §6–§13.

```
navegador  --fetch-->  https://r.jina.ai/https://finviz.com/quote.ashx?t=TICKER
           (cabecera X-Target-Selector: .quote-header_category, .snapshot-table2)
                              |
                              +--> devuelve solo los enlaces de cabecera (sector...)
                                   y la tabla de fundamentales como
                                   texto/markdown, con cabeceras CORS abiertas
                                   (HTTP 422 si la pagina no la tiene: se repite
                                   la peticion sin la cabecera)

navegador  --fetch-->  https://r.jina.ai/https://data.sec.gov/api/xbrl/companyconcept/CIK.../....json
                              |
                              +--> devuelve el JSON de SEC EDGAR (envuelto en metadatos
                                   de r.jina.ai, ver logica.js:extraeJSON)
```

- **Por qué un proxy**: GitHub Pages no puede llamar a `finviz.com` ni a `data.sec.gov` directamente por CORS (comprobado: `data.sec.gov` no devuelve `Access-Control-Allow-Origin` en sus respuestas JSON), y no hay backend propio. Se usa `r.jina.ai`, que renderiza la página en su servidor y la devuelve con CORS abierto. **Timeout de 30 s** por llamada (`TIMEOUT_MS` en `app.js`).
- **Solo la tabla de fundamentales y el sector** (`descargaDatos` en `app.js`, `SELECTOR_FICHA_FINVIZ` en `logica.js`): la ficha de Finviz se pide con la cabecera `X-Target-Selector: .quote-header_category, .snapshot-table2`, que hace que `r.jina.ai` devuelva solo esa tabla y, delante, los enlaces de cabecera de la ficha (sector, industria, país…). El sector sale del enlace `f=sec_<codigo>` (`logica.js:extraeSector`) en la misma petición: comprobado el 2026-11-24 con AAPL y XOM, la lista de selectores separada por comas devuelve las dos partes, y un ticker inexistente sigue dando HTTP 422. Sin ella, Jina elige por su cuenta el "contenido principal" de la página, y en fichas con muchas noticias se queda con la lista de noticias y omite la tabla. Comprobado el 2026-11-19: EMBC daba 0 campos reconocidos sin selector (por eso salía `(sin datos)` tras 4 intentos) y 21 con él; AAPL daba 21 en los dos casos, y la respuesta pesa unas 14 veces menos (≈3 KB frente a ≈43 KB). Jina acepta esa cabecera en el preflight CORS (`access-control-allow-headers: x-target-selector`). Si la página no contiene la tabla, Jina responde **HTTP 422** `AssertionFailureError: No content available … with target selector` (`logica.js:esSinContenidoSelector`). Ocurre con un ticker inexistente, que Finviz manda a su buscador, o si Finviz cambiara su HTML. En ese caso se repite la petición **sin selector**, como se hacía antes: así se sigue reconociendo la página de búsqueda (`Title: Search`) y, si Finviz renombra la tabla, la web vuelve al comportamiento anterior en vez de fallar con todos los tickers. El plan B solo cuesta una petición más, en esos casos.
- **Cupo del proxy: 20 peticiones/minuto por IP** sin clave (cabecera `x-ratelimit-limit: 20, 20;w=60`, comprobada el 2026-09-29). Todas las llamadas pasan por **una única cola** (`creaLimitador` en `logica.js`) que no arranca más de `PROXY_MAX_POR_MINUTO = 18` peticiones por ventana deslizante de 60 s ni más de `PROXY_MAX_SIMULTANEAS = 4` a la vez, con **prioridad para las fichas de Finviz** sobre las consultas a SEC EDGAR. Antes de esta cola, abrir los 55 tickers del email de DIIA lanzaba las 55 fichas a la vez y el proxy devolvía **HTTP 429 a 35 de ellas**: los datos existían en Finviz, era el proxy el que las rechazaba.
- **Reintentos** (`pideAlProxy` en `app.js`, hasta `PROXY_MAX_INTENTOS = 4`): se reintenta lo transitorio — red o timeout, HTTP 408/429/5xx, respuesta vacía o con menos de `MIN_CAMPOS_VALIDOS` campos (el proxy devuelve a veces la ficha vacía y a la siguiente llamada completa). Un 429 además **pausa toda la cola 30 s**. Si se agotan los intentos, el motivo final lleva el sufijo `(tras 4 intentos)` (p. ej. `timeout 30s (tras 4 intentos)`), tanto en el log como en la marca `data-motivo`. No se reintenta lo definitivo: un ticker que Finviz no reconoce (el proxy devuelve su página de búsqueda, `Title: Search`) o un 404 del destino, que `r.jina.ai` entrega como HTTP 200 con la línea `Warning: Target URL returned error 404`.
- **Log de los errores del propio proxy**: cuando es `r.jina.ai` quien rechaza la petición (403, 429…), explica el motivo con un JSON en el cuerpo de la respuesta. `descargaTexto` lee ese cuerpo y `logica.js:interpretaErrorProxy` lo interpreta, de modo que el log muestra el motivo real y no solo `HTTP 403`. El caso típico es el **bloqueo de dominio** `AbuseAlleviationError` (comprobado el 2026-10-17: `Anonymous access to domain finviz.com blocked until … due to previous abuse found on https://finviz.com/quote.ashx?t=GS`). Ese bloqueo afecta a **todos los usuarios anónimos de Jina**, no a una IP concreta, dura unos 15 minutos y lo puede provocar un tercero. Ante él, el log explica una sola vez el bloqueo (dominio, hora local de fin y mensaje literal de Jina), cada ticker indica su motivo en una línea, y el balance final (`anunciaFin`) agrupa los tickers sin ficha por motivo e indica a partir de qué hora relanzar. El 403 no se reintenta.
- **Sin claves gestionadas por esta app**: al depender de un proxy público de terceros, su disponibilidad no está bajo control del proyecto (ver [§5](#5-limitaciones-técnicas-conocidas)).
- **Arquitectura Medallion: no aplica a la web.** Los proyectos con base de datos (solana, diia, comidaslocales, bolsa) separan sus datos en Bronce, Plata y Oro con la librería común `medallion_comun`. Esta web no persiste nada: lo descargado (Bronce), lo interpretado (`logica.js`, Plata) y la puntuación (Oro) solo existen en memoria durante la comparación. El proceso semanal sí persiste, pero en una sola tabla, por decisión del propietario (§7). Lo que bolsa lee de esta web lo guarda bolsa (schema `finviz_analysis`, expuesto en `bolsa_oro`), ver diseno_funcional §8.

## 2. Estructura del repositorio

```
docs/                            <- raiz publicada en GitHub Pages
├── index.html                   formulario (con el fieldset "Excluir sectores"), botones de orden + tabla de
│                                 resultados (cabecera dinamica)
├── logica.js                    logica pura: filtros, parseo, dilucion, puntuacion, orden y exclusion de
│                                 sectores (sin DOM ni red)
├── app.js                       DOM, descarga (fetch a los proxies) y orquestacion multi-ticker
├── style.css                    estilos (ok-1..4 / nok-1..4 / critico / na / dilucion-alerta, filas y botones de orden,
│                                 casillas de "Excluir sectores")
├── urls_screeners_finviz.csv    screeners predefinidos   (SCREENER|URL)
└── descripcion_filtros.csv      glosario de campos Finviz (FILTRO|DESCRIPCION)
tests/
├── logica.test.js               tests de parseo, dilucion y cola del proxy (docs/logica.js)
├── orden.test.js                tests de evaluacion de casillas, pesos/tramos, patrimonio negativo,
                                  puntuacion, sufijo "(poco)", escala de color y orden de columnas,
                                  mas comprobaciones estaticas de index.html / app.js / style.css
                                  (dilucion sin datos en rojo, marcas data-* de lectura automatica)
└── sectores.test.js             tests de la exclusion de sectores (lista de sectores, extraeSector,
                                  ?excluir_sectores=, separaPorSector) y comprobaciones estaticas
package.json                     solo para poder correr "npm test" (sin dependencias)
README.md                        resumen para la portada de GitHub
diseno_funcional.md              este documento hermano: el porque (con referencias)
diseno_informatico.md            este documento
CLAUDE.md                        normas de este proyecto para Claude Code (web estatica en JS +
                                  proceso semanal en Python)
```

Proceso semanal de solvencia (§6), fuera de `docs/`:

```
principal.py                     coordinador (opciones en §6.1)
ejecutar.bat / _python_env.bat   lanzador y deteccion del Python del entorno finvizanalysis
actualizar_entorno.py            crea/actualiza el entorno conda e instala Chromium dentro (§9)
entorno.yml                      dependencias del entorno conda
pyproject.toml                   configuracion de pytest
config/configuracion.yml         configuracion versionada, sin secretos (§10)
modulos/
├── configuracion/               configuracion.yml + secretos.yml
├── universo/                    cartera de iShares IWV -> tickers del Russell 3000
├── lector/                      interfaz Lector, LectorPlaywright y Chromium dentro del entorno
├── ejecucion/                   decision diaria, lotes, tope del lanzamiento, repesca y estado JSON
├── registro/                    traza del ciclo en el log (CICLO ..., TICKER ...), §6.3
├── bd/                          interfaz Repositorio (MariaDB y memoria)
├── analisis/                    diff_*, estadisticas, top/bottom y correlaciones
├── informe/                     adjunto HTML y cuerpo del email
├── email/                       envio SMTP
└── espacio/                     tamano en disco
sql/crear_solvencia.sql          schema y tabla (§7)
planificacion/                   envoltorio de Task Scheduler y comando schtasks (§11)
permanentes/                     universo (russell3000_bruto.csv, fuera de git)
volatiles/                       vacia en el repositorio (los datos van a C:\finvizanalysis)
tests/
├── precio.test.js               marca data-precio (web)
├── apoyo.py, conftest.py        lector y reloj falsos, configuracion de prueba
└── test_*.py                    pytest del proceso semanal (§9)
```

Los dos CSV usan **`|` como separador** (no coma) y tienen una línea de cabecera.

`logica.js` se carga en `index.html` **antes** que `app.js` (variables globales compartidas, sin módulos ni bundler) y además expone sus funciones vía `module.exports`, protegido por `if (typeof module !== "undefined")`, para poder testearlas con Node sin afectar al navegador (donde `module` no existe).

La web no usa `modulos/`, `sql/` ni `permanentes/`: son del proceso semanal. Ver `CLAUDE.md` para el reparto entre las dos partes.

## 3. Flujo de ejecución (comparación multi-ticker)

0. Entrada alternativa por URL: si la página se abre con `?tickers=AAA,BBB,CCC`, `app.js` precarga ese valor en el campo "Ticker de empresas" y lanza la comparación sola en cuanto termina `loadScreeners()` (con el screener por defecto, `SCREENER_POR_DEFECTO = "solventes"`), sin esperar un clic en "Comparar". Es el mecanismo que usa el email resumen de [DIIA](https://github.com/carlostechinnovation/diia) para enlazar su tabla de Selección del día ya calculada. Si además llega `?escenario=texto`, `app.js` lo escribe (con `textContent`, nunca como HTML) en el `<h2 id="escenario">` bajo el título y lo hace visible; sin el parámetro, el subtítulo queda oculto. Los emails de [bolsa](https://github.com/carlostechinnovation/bolsa) (modo futuro) y DIIA lo rellenan con `BolsaML - {fecha}` y `DIIA - {fecha}`, la misma fecha que muestra la cabecera de cada email. El parámetro opcional `?excluir_sectores=energy,financial` marca esas casillas de "Excluir sectores" al cargar la página (`parseaSectoresExcluidos` en `logica.js`: códigos de `SECTORES_FINVIZ`, separados por comas, sin distinguir mayúsculas y sin duplicados). Los códigos desconocidos se ignoran, y `avisaSectoresDesconocidosURL` los anota en el log al cargar y al empezar cada comparación, porque `runComparison()` vacía el log. Funciona con o sin `?tickers=`.
   - **Lectura automática.** Bolsa abre este mismo enlace con un navegador sin ventana antes de enviar su email FUTURO, para registrar las empresas con 16 puntos o más. Para que no tenga que interpretar textos de la página, `app.js` deja marcas que el usuario no ve: `document.body.dataset.comparacion` vale `en_curso` al empezar `runComparison()` y `terminada` al acabar todas las descargas (también si hubo un error), `document.body.dataset.bloqueoProxy` vale `1` si r.jina.ai bloqueó algún dominio durante la comparación (`0` si no), y cada celda de la fila de puntos lleva `data-ticker`, `data-puntos` (número), `data-sin-ficha` (`1` si la ficha de Finviz falta o sigue pendiente), `data-dilucion` (`ok`, `alerta`, `sin_datos` o `pendiente`: `estadoDilucion` en `logica.js`) y `data-motivo` (por qué falta la ficha, el mismo texto que agrupa `anunciaFin`, p. ej. `timeout 30s (tras 4 intentos)` o `Finviz no reconoce el ticker`; vacío si hay ficha). Con `data-motivo` bolsa explica en su email por qué una empresa salió sin datos y relee solo esas empresas (repesca). Con esta última marca bolsa también oculta las empresas con alerta de dilución en el Adjunto 5 de ese email y señala las que no se han podido verificar, que en puntos valen igual que las que no diluyen. La casilla lleva además `data-precio`: el campo `Price` de la ficha de Finviz (`logica.js:textoPrecio`, p. ej. `354.2`; vacío sin ficha). Lo lee el proceso semanal de solvencia (§6.2) para guardar el precio junto a los puntos.
1. El usuario escribe uno o varios tickers separados por comas en el campo "Ticker de empresas" y elige un screener (o pega una URL).
2. `leeTickers()` (`app.js`) separa por comas, recorta espacios, pasa a mayúsculas y elimina duplicados y vacíos.
3. `leeFiltrosScreener()` extrae los códigos de filtro del parámetro `f=` de la URL del screener.
4. Para **cada ticker** se encolan sus tareas (`Promise.all`), que la cola del proxy despacha al ritmo permitido (§1):
   1. `descargaDatos(ticker)`: descarga la tabla de fundamentales y la cabecera de la ficha de Finviz (con `X-Target-Selector` y, si Jina responde 422, la página completa), la parsea (`docs/logica.js:extraeDatosMarkdown`) y extrae el sector (`extraeSector`). El sector se guarda en `resultadosPorTicker[ticker].sector`: `undefined` mientras está pendiente y `null` si la ficha falla o no lo trae (la página completa sin selector no lo trae).
   2. `compruebaDilucion(ticker)`: resuelve el CIK del ticker en SEC EDGAR (`resuelveCIK`; el fichero completo ticker→CIK se descarga **una sola vez** y se cachea la *promesa*, no el resultado: cachear un objeto vacío mientras llegaba la descarga hacía que todos los tickers menos el primero salieran como "no encontrado") y busca una comparación de acciones en circulación (`buscaDilucionSEC`), probando las etiquetas XBRL de `XBRL_TAGS_SHARES` **hasta encontrar una reciente y coherente** (`docs/logica.js:calculaDilucion` con la fecha de hoy: un solo dato por fecha, el del informe presentado más tarde según el campo `filed` (`ultimoDatoPorFecha`: tras un split, los informes posteriores reexpresan las fechas antiguas ya ajustadas; caso IESC en diseno_funcional §6.2); último dato de hace menos de `ANTIGUEDAD_MAX_DILUCION_DIAS = 550` días, sin ceros y sin caídas de más del 90 %, que son errores de escala del XBRL).
   3. Ninguna de las dos llamadas lanza excepción hacia arriba: un fallo en un ticker (Finviz caído, ticker no listado en SEC, etc.) se registra en el log y ese ticker queda marcado como "sin datos" para Finviz y/o sin alerta de dilución, **sin bloquear a los demás tickers**.
   4. Cada vez que termina una descarga se **repinta la tabla** (`repinta()`) con lo que haya llegado: las celdas pendientes muestran `(descargando)` / `(pendiente)`. Con 55 tickers la comparación completa tarda unos 7-10 minutos, marcados por el cupo del proxy; el progreso y el balance final van al log.
5. `pintaMultiTicker(comparacion)` construye la tabla a partir del estado guardado en `comparacionActual` (`{ tickers, filtros, resultadosPorTicker, descripciones }`):
   0. `separaComparacion` → `logica.js:separaPorSector` aparta las empresas cuyo sector está marcado en "Excluir sectores" (`leeSectoresExcluidos`). Una empresa con sector pendiente o desconocido sigue visible. Los pasos siguientes trabajan solo con las visibles: las ocultas no tienen columna, ni puntos, ni marcas `data-*`.
   1. `ordenaFiltros` (orden económico de `ORDEN`) y `evaluaTabla` → `evaluaFiltro`, que da el texto, el estado `ok`/`nok`/`na`, el valor numérico de cada casilla y dos marcas:
      - `sinFicha`: descarga pendiente o fallida.
      - `patrimonioNegativo`: `hayPatrimonioNegativo`, es decir, `Book/sh` < 0 o ratio negativo en Debt/Eq o LT Debt/Eq. En ese caso la casilla pasa a `nok` con el texto `(patrimonio negativo)`.
   2. `calculaPuntosPorTicker` → `puntosEmpresa` → `puntosCasilla` aplica `PESOS_FILTROS`, la matriz de pesos que prima la solvencia (diseno_funcional.md §7), en este orden:
      - `sinFicha` → 0;
      - patrimonio negativo → `incumple` (peor tramo);
      - N/A → `na`;
      - con `tramos` → `puntosTramo` (primer tramo cuya comparación `op`/`limite` se cumple);
      - si no (P/S, Rel Volume y ATR, los únicos sin tramos) → `cumple` / `incumple`.

      Al total se suma `PUNTOS_ALERTA_DILUCION` (−99) si `hayAlertaDilucion`, y `puntosEmpresa` lo redondea a 2 decimales: sumar pesos como 0,35 deja restos de coma flotante que se verían en la casilla y en `data-puntos`. Todo en `logica.js`, sin DOM. Es una sola función genérica porque todos los criterios siguen la misma lógica: para cambiar un peso o un tramo basta con editar `PESOS_FILTROS`. Los tests comprueban que cada filtro soportado tiene pesos, que los tramos siguen alineados con la condición del screener, que "mucho" vale casi el doble que "poco" fuera de la solvencia y que el máximo es 26,31.
   3. `ordenaTickers(tickers, puntos, criterioOrden)` decide el orden de las columnas: `ORDEN_ENTRADA` (el del textbox) u `ORDEN_PUNTOS` (de más a menos puntos; a igualdad, orden de entrada). Devuelve una lista nueva: el orden de entrada nunca se modifica.
   4. Pinta, con ese orden de columnas:
      - Cabecera dinámica (`pintaCabecera`): `Filtro | Condición Screener | Descripción` + una columna por ticker.
      - Fila `Orden entrada` (`pintaFilaOrdenEntrada`, clase `.fila-orden`, gris claro): posición 1, 2, 3… de cada ticker en el textbox, contando también las empresas ocultas. Solo si `hayVariasEmpresas` (2 o más visibles).
      - Fila `Orden por filtros cumplidos` (`pintaFilaPuntos` → `celdaPuntos`, clase `.fila-puntos`; "Condición Screener" vacía y "Descripción" = `Puntos`): los puntos de cada ticker, con el sufijo `(poco)` por debajo de `PUNTOS_MINIMOS_COMPRA` = 16 (`logica.js:textoPuntos`) y los atributos `data-*` del paso 0.
      - Fila de dilución (`pintaFilaDilucion` → `celdaDilucion`, con la columna Descripción vacía): verde (`.ok-1`) por debajo del umbral, rojo oscuro y negrita (`.nok-4` y `.dilucion-alerta`) con `ALERTA POR DILUCIÓN: +XX% en 1 año` si lo supera, rojo claro (`.nok-1`) con `(SIN DATOS: ver a mano)` (`TEXTO_DILUCION_SIN_DATOS`) si no hay datos en SEC EDGAR, y naranja (`.na`) con `(pendiente)` mientras no han llegado.
      - Fila `Sector` (`pintaFilaSector` → `celdaSector`, sin color): el nombre del sector de Finviz (`nombreSector`), `(desconocido)` si no se conoce y `(pendiente)` en naranja mientras no ha llegado la ficha.
      - Una fila por filtro (`pintaFilaFiltro`): el valor va **dentro** de la celda de su ticker y el color (verde `.ok-N` / rojo `.nok-N` / naranja `.na`) indica `CUMPLE` / `INCUMPLE` / `N/A`, y `N` (1 a 4) la intensidad. La clase la decide `logica.js:claseCasilla`, y el nivel, `logica.js:nivelGrado`, que lo lee de los tramos de `PESOS_FILTROS` sin repetir límites (regla en `diseno_funcional.md` §7.8). Un `INCUMPLE` en los filtros de `FILTROS_CRITICOS` (LT Debt/Eq y Market Cap) añade la clase `.critico` (borde oscuro y negrita).
6. Botones **Orden entrada** / **Orden por filtros cumplidos** (`#botonesOrden`, bajo "Comparar"): `actualizaBotonesOrden()`, al que llama `repinta()`, los muestra solo con 2 o más tickers visibles y marca el activo (`.activo`, `aria-pressed`). Al pulsar uno, `seleccionaOrden(criterio)` cambia `criterioOrden` y llama a `repinta()`: la tabla se recarga reordenando las columnas **sin volver a descargar nada**. El criterio elegido se mantiene durante las descargas en curso y en las siguientes comparaciones de la sesión (por defecto, orden de entrada).
7. Filtro **Excluir sectores** (`<fieldset id="sectoresExcluidos">` en `index.html`): `app.js` crea al cargar una casilla por cada entrada de `SECTORES_FINVIZ` (`logica.js`), la lista estática de los 11 sectores del screener de Finviz, tomada de finviz.com el 2026-11-24. No se consulta Finviz en cada ejecución, y la lista vive en un solo sitio. Todas salen sin marcar, salvo las del parámetro `?excluir_sectores=` (paso 0). Al marcar o desmarcar una, `cambiaSectoresExcluidos()` llama a `repinta()`, que recarga la tabla **sin volver a descargar nada**, y `anunciaExclusiones()` anota en el log qué empresas quedan ocultas. El mismo resumen se escribe al final de cada comparación si hay algún sector marcado. Si se cambia durante las descargas, cada empresa desaparece al llegar su sector.

La web no tiene ejecución programada ni tareas en segundo plano: todo ocurre **bajo demanda**, al pulsar "Comparar" o al abrir un enlace con `?tickers=`. La única planificación es la del proceso semanal (§11).

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

`package.json` no declara dependencias: `npm test` solo invoca `node --test tests/`, el test runner incorporado en Node desde la v18, que ejecuta todos los `tests/*.test.js`. Sin DOM ni red: la lógica de puntuación y orden está en `logica.js` precisamente para poder probarla así; `tests/orden.test.js` comprueba además, leyendo los ficheros, que los botones de orden están en `index.html`, que no queda rastro de `#resumen`, que la dilución sin datos sale en rojo con `(SIN DATOS: ver a mano)`, que existen las marcas `data-*` de lectura automática y que `app.js` / `logica.js` siguen en ASCII puro. `tests/sectores.test.js` prueba la exclusión de sectores, con una respuesta real de `r.jina.ai` para XOM, recortada.

### Añadir un screener nuevo

Añadir una línea a `docs/urls_screeners_finviz.csv`:

```
nombre_del_screener|https://finviz.com/screener.ashx?v=111&f=cap_midover,fa_pe_u20
```

La app solo mira el parámetro `f=` de la URL; el resto (`v`, `o`, `p`, `ft`) se ignora.

## 5. Limitaciones técnicas conocidas

- **Dependencia de un proxy de terceros (`r.jina.ai`).** Si está caído o cambia el formato de salida, la descarga falla aunque se reintente. Su cupo (20 peticiones/minuto por IP) fija la duración de una comparación grande: no se puede acelerar sin una clave de pago, que no puede ir en una web pública. Además, Jina puede **bloquear temporalmente el acceso anónimo a finviz.com para todos sus usuarios** por el abuso de un tercero (HTTP 403 `AbuseAlleviationError`, ver [§1](#1-arquitectura)). Mientras dure no hay ninguna ficha disponible; la página solo puede explicarlo en el log e indicar cuándo relanzar. Otros proxys CORS gratuitos probados ese mismo día (corsproxy.io, allorigins, codetabs, cors.lol) tampoco servían: daban 401, timeout, 522 y 429.
- **El parseo de Finviz es frágil por naturaleza.** Se basa en el texto renderizado de la ficha; cualquier cambio de maquetación puede romperlo. El umbral de 8 campos reconocidos (`MIN_CAMPOS_VALIDOS`) existe para detectarlo y avisar en vez de dar resultados falsos. Pedir la tabla por su selector CSS (`.snapshot-table2`, junto con `.quote-header_category` para el sector) evita depender de qué parte de la página considere `r.jina.ai` el contenido principal, pero ata la descarga a ese nombre de clase. Si Finviz lo cambia, cada ficha cuesta una petición más (el plan B sin selector) hasta que se actualice `SELECTOR_FICHA_FINVIZ`, y además vuelve a aparecer el riesgo de que Jina se quede solo con las noticias. Si lo que cambia es `.quote-header_category`, la tabla sigue llegando pero sin sector: las empresas salen con sector `(desconocido)` y "Excluir sectores" deja de ocultarlas.
- **El JSON de SEC EDGAR llega envuelto** en metadatos que añade `r.jina.ai` (`Title:`, `URL Source:`, `Markdown Content:`) porque ese proxy está pensado para HTML, no para JSON. `logica.js:extraeJSON` extrae el primer objeto `{...}` de la respuesta en vez de asumir que el cuerpo entero es JSON limpio; si el proxy además reformatea el contenido interno del JSON, el parseo puede fallar igualmente (se degrada sin romper el resto de la comparación).
- **Codificación ASCII pura en `app.js` y `logica.js`.** Los acentos y símbolos van como escapes `\uXXXX` dentro de las cadenas, para que ningún editor los corrompa al guardar en otra codificación. Al editar estos ficheros a mano hay que mantener esa convención.
- **La web no tiene caché ni histórico.** Cada comparación vuelve a descargar todo. La evolución semanal de cada empresa la guarda el proceso semanal (§6).
- **Coste por ticker.** Cada ticker cuesta 1 petición a Finviz y de 1 a 3 a SEC EDGAR (más una única para el mapeo ticker→CIK). La cola evita el 429, pero el tiempo total crece lineal con el número de tickers.
- **Tickers que Finviz no cubre.** Algunas clases de acción cotizan pero no tienen ficha en Finviz (p. ej. `RUSHB`: `finviz.com` responde 404; sí existe `RUSHA`). Se muestran como "sin datos" tras un único intento.
- **Empresas con varias clases de acción** suelen salir `(SIN DATOS: ver a mano)` en dilución: informan las acciones por clase (dato dimensional) y la API `companyconcept` de la SEC solo devuelve los datos sin dimensión.

## 6. Proceso semanal de solvencia (backend)

Es un proceso Python separado de la web. Se lanza todas las noches a las 23:00 (hora de Madrid) y cada lanzamiento decide si empieza el ciclo de la semana, reanuda uno cortado o no hace nada. Cada ciclo abre la web con Chromium sin ventana (Playwright), en lotes de 100 tickers del Russell 3000, lee los puntos y el precio de cada empresa, los guarda en MariaDB y, al terminar, envía un email con el resumen y el detalle. El porqué de cada decisión está en [diseno_funcional.md §9](diseno_funcional.md#9-evolución-semanal-de-la-solvencia-de-todo-el-russell-3000).

```
Task Scheduler (diaria 23:00, hora de Madrid, SYSTEM)
  -> planificacion/run_solvencia_auto.bat -> ejecutar.bat -> principal.py
       universo   (permanentes/russell3000_bruto.csv, cartera de iShares IWV)
       lotes de 100 -> Chromium sin ventana -> https://carlostechinnovation.github.io/finviz_analysis/?tickers=...
                         (la web hace sus peticiones a r.jina.ai como siempre; §1)
                      <- marcas data-* de la fila de puntos (§3 paso 0)
       MariaDB  finvizanalysis.solvencia  (fecha, ticker, puntos_solvencia, precio)
       log      C:\finvizanalysis\volatiles\logs\finvizanalysis.log   (traza del ciclo: decide la reanudacion, §6.3)
       estado   C:\finvizanalysis\data\ejecuciones\<fecha>.json   (lotes y tiempos, solo para el informe)
       informe  C:\finvizanalysis\data\informes\   (adjunto HTML + cuerpo del email)
       email    SMTP (bloque 'email' de secretos.yml, el de bolsa)
```

Stack, el mismo que bolsa salvo la parte web: Python 3.11 (entorno Conda `finvizanalysis`, `entorno.yml`), pandas, numpy, scipy, SQLAlchemy + PyMySQL, PyYAML, Playwright y pytest. No hay FastAPI, uvicorn ni React, porque la única interfaz es la web estática y el email.

### 6.1. Flujo paso a paso (`principal.py`)

1. **Configuración** (`modulos/configuracion`): `config/configuracion.yml` más el fichero de secretos (§10).
2. **Carpetas y log del lanzamiento**: crea las de `rutas` si faltan.
   - Cada lanzamiento escribe primero en `C:\finvizanalysis\volatiles\logs\finvizanalysis_lanzamiento.log`, que se vacía en cada arranque. Ahí queda la decisión del paso 4 con su motivo, o el error si algo falla antes de decidir (base de datos, secretos).
   - El log del ciclo, `finvizanalysis.log`, no se toca hasta conocer la decisión.
   - `--comprobar` y `--solo-email` tienen su propio fichero (`finvizanalysis_comprobar.log`, `finvizanalysis_solo_email.log`), también vaciado al arrancar.
   - Se borran además los `finvizanalysis_AAAA-MM-DD.log` que dejaban las versiones anteriores.
3. **Tabla**: `CREATE SCHEMA/TABLE IF NOT EXISTS` (`sql/crear_solvencia.sql`, §7).
4. **Decisión** (`modulos/ejecucion`, `decidir`). Con F = `MAX(fecha)` de la tabla:
   - **Ciclo nuevo**, con la fecha de hoy, si la tabla está vacía o hoy − F ≥ `ciclo.dias` (7). El log del ciclo se vacía (modo `w`) y empieza con `CICLO INICIO fecha=<hoy>`. Si el ciclo F quedó sin terminar, se abandona, y así lo dice el motivo.
   - **Nada que hacer** si entre las 10 últimas líneas del log del ciclo está `CICLO TERMINADO fecha=F`. Sale con 0 sin tocar ese log: si lo vaciara, perdería la marca y la noche siguiente no sabría que el ciclo terminó.
   - **Reanudar el ciclo F** en cualquier otro caso: un error, un reinicio del servidor, el tope del paso 9 o un log que falta. El log sigue escribiéndose detrás (modo `a`) y la primera línea nueva es `CICLO REANUDADO fecha=F tras: <última línea anterior>`.

   La comparación es ≥ 7 para que el ciclo caiga siempre la misma noche de la semana.
5. **Universo** (`modulos/universo`): lee el CSV de iShares, filtra y normaliza (§9.1 del funcional). Prepara también los alias de repesca para las clases partidas (`BFB` → `BF-B`).
6. **Estado y límite** (`preparar_estado`):
   - Al reanudar, se reutiliza el JSON de estado del ciclo con sus lotes (si falta, se crea con la fecha F).
   - El límite del lanzamiento es ahora + `ciclo.duracion_max_horas` (22 h). Un lanzamiento de las 23:00 no empieza lotes después de las 21:00 del día siguiente, así que nunca se solapa con el de esa noche.
7. **Pasada principal** (`Ejecutor.ejecutar`): los tickers del universo sin dato en la fecha del ciclo y que el log no da ya como pedidos en su pasada principal (`registro.tickers_pedidos`, §6.3), en lotes de `lectura.tamano_lote`. Los ya pedidos sin dato (sin ficha, lote fallido) no se repiten aquí, sino en la repesca. Por cada lote:
   1. Espera máxima `min(timeout_max_min, max(timeout_min, timeout_factor · (4·N + 1) / 18))`, recortada a lo que quede hasta el límite.
   2. `Lector.leer(url, espera)`: abre `?tickers=<lote>` y espera a `data-comparacion="terminada"`. Si no termina a tiempo, lee igualmente las casillas.
   3. Guarda las válidas en la base de datos (§6.2) con `INSERT … ON DUPLICATE KEY UPDATE`.
   4. Escribe en el log una línea `TICKER` por cada ticker del lote, con su resultado (§6.3).
   5. Anota el lote en el JSON de estado: inicio, fin, pedidos, guardados, si terminó, si hubo bloqueo y el error si lo hubo. Lo escribe a un `.tmp` y lo renombra, para que una caída no lo deje a medias.
   6. Si hubo bloqueo del proxy, espera `lectura.espera_bloqueo_min`.
   7. Una excepción en un lote (página caída, Chromium) se anota (`ERROR_LOTE`) y no para la ejecución: sus tickers pasan a la repesca.
8. **Repesca**: tras cada pausa de `lectura.repesca_pausas_min` (2 y 4 min), una ronda solo con los tickers que siguen sin dato. Las clases partidas se piden con guion. Si el corte fue durante la repesca, al reanudar se repiten sus rondas, que son cortas.
9. **Tope del lanzamiento**: a partir del límite no se empieza ningún lote. Se escribe `CICLO PARADO fecha=F …` y se sale con 0, sin informe ni email: el siguiente lanzamiento reanuda.
10. **Informe y email** (§8), solo al completar el ciclo:
    - lee toda la tabla y calcula el detalle, las estadísticas y las correlaciones (`modulos/analisis`);
    - escribe el adjunto y el cuerpo en `rutas.dir_informes` y envía el email;
    - escribe la última línea, `CICLO TERMINADO fecha=F email=<resultado>`.

    Con `--max-tickers` esa marca no se escribe, porque es una prueba: el siguiente lanzamiento completa el resto del universo con la misma fecha.
11. **Errores y código de salida**:
    - Un error dentro del ciclo deja el traceback en su log, intenta mandar un email de error y termina el log con `CICLO CON ERROR fecha=F`. La noche siguiente se reanuda (como el envío del email forma parte del ciclo, un fallo de SMTP también se reintenta).
    - Un error antes de decidir queda en el log del lanzamiento.
    - Sale con 0 si todo fue bien, incluido "nada que hacer" y el tope del paso 9; con 1 si hubo un error.

Opciones de `principal.py`, que `ejecutar.bat` reenvía:

| Opción | Qué hace |
|---|---|
| *(ninguna)* | Lanzamiento diario: empieza un ciclo, lo reanuda o no hace nada; email al terminar el ciclo |
| `--sin-email` | Lo mismo sin el envío (el informe queda en `rutas.dir_informes`) |
| `--solo-email` | Rehace el informe de la última fecha de la tabla con su JSON de estado y lo envía, sin descargar nada |
| `--max-tickers N` | Solo los N primeros tickers del universo (pruebas). No da el ciclo por terminado |
| `--comprobar` | Abre la web con AAPL y MSFT y dice si se leen puntos y precio. No toca la base de datos ni el email, y no necesita el fichero de secretos |
| `--url URL` | Usa otra web en vez de `web.url`, por ejemplo `http://localhost:8000/` para probar cambios de `docs/` antes de publicarlos |
| `--config RUTA` | Usa otro `configuracion.yml` (pruebas con otro schema u otras carpetas) |

### 6.2. Lectura de la web (`modulos/lector`)

- **Interfaz `Lector`.** Tiene una implementación real, `LectorPlaywright`, que crea la factoría `crear_lector(config)` según `lectura.lector`. Los tests usan un lector falso y nunca salen a Internet.
- **Qué se lee.** Las marcas del §3 paso 0: el fin de la comparación, el bloqueo del proxy y, por casilla de la fila de puntos, `data-ticker`, `data-puntos`, `data-sin-ficha`, `data-dilucion`, `data-motivo` y **`data-precio`**. Esta última es el campo `Price` de la ficha de Finviz (`logica.js:textoPrecio`), vacío si no hay ficha.
- **Qué se guarda.** Solo las casillas *válidas*: con ficha, con puntos numéricos y con la dilución distinta de `pendiente`. Así, con una página que no terminó a tiempo, nunca se guardan unos puntos a los que todavía podría restarse el −99.
- **Dónde está Chromium.** Dentro del entorno Conda (`PLAYWRIGHT_BROWSERS_PATH=0`, `modulos/lector/navegador.py`), igual que en bolsa. La tarea programada corre como SYSTEM, que no vería un Chromium instalado en el perfil de otro usuario.

### 6.3. Traza del ciclo en el log (`modulos/registro`)

El log del ciclo, `finvizanalysis.log`, es junto con la tabla lo que decide cada lanzamiento (§6.1 paso 4). Por eso lleva líneas con un formato fijo, que `modulos/registro` escribe y lee:

| Línea | Cuándo |
|---|---|
| `CICLO INICIO fecha=AAAA-MM-DD` | Primera línea de un ciclo nuevo (el log se acaba de vaciar) |
| `CICLO REANUDADO fecha=AAAA-MM-DD tras: <línea>` | Primera línea de cada reanudación, con la última línea que había |
| `TICKER <t> ronda=<n> <RESULTADO> [detalle]` | Una por ticker pedido, al acabar su lote |
| `CICLO PARADO fecha=AAAA-MM-DD: …` | Se alcanzó el tope del lanzamiento |
| `CICLO CON ERROR fecha=AAAA-MM-DD: …` | Tras el traceback de un error dentro del ciclo |
| `CICLO TERMINADO fecha=AAAA-MM-DD email=<resultado>` | Última línea de un ciclo completo |

`RESULTADO` puede ser:

- `GUARDADO puntos=… precio=…`: se escribe después de guardar, así que el ticker ya está en la tabla;
- `SIN_FICHA motivo=…` (el `data-motivo` de la web);
- `NO_GUARDADO dilucion=… puntos=…`: con ficha, pero sin puntos o con la dilución pendiente;
- `NO_LEIDO`: la página no devolvió la casilla;
- `ERROR_LOTE`: el lote entero falló.

Al reanudar, el punto de partida es:

- los tickers con fila en la fecha del ciclo (la tabla);
- más los que tienen línea `TICKER … ronda=0` dentro de ese ciclo, desde su `CICLO INICIO` o `CICLO REANUDADO`. Las líneas de otro ciclo no cuentan.

La pasada principal sigue con el resto, en el orden del CSV. El JSON de estado (`rutas.dir_ejecuciones`) ya no decide nada: solo guarda las estadísticas del informe (duración de los lotes, bloqueos, errores y tickers pedidos).

## 7. Base de datos

Schema `finvizanalysis` (`bd.database`; el `mariadb.database` del fichero de secretos se ignora), tabla `solvencia` (`bd.tabla`):

| Columna | Tipo | Contenido |
|---|---|---|
| `fecha` | DATE, PK | Inicio del ciclo semanal (su primer lanzamiento) |
| `ticker` | VARCHAR(16), PK | Ticker como lo pide la web (con guion en las clases: `BRK-B`, `BF-B`) |
| `puntos_solvencia` | DECIMAL(7,2) | Puntos de la web con el screener `solventes`, incluido el −99 por dilución |
| `precio` | DECIMAL(14,4), NULL | Campo `Price` de la ficha de Finviz en la misma lectura |

- **Índices.** Además de la clave primaria `(fecha, ticker)` hay un índice `(ticker, fecha)` para las series por empresa.
- **Volumen.** Unas 2.600 filas por semana, unas 135.000 al año: decenas de MB como mucho.
- **Sin ficha.** Los tickers sin ficha no tienen fila.
- **Acceso.** El código accede por la interfaz `Repositorio` (`modulos/bd`), con dos implementaciones: `RepositorioMariaDB` (producción) y `RepositorioMemoria` (tests). La factoría es `crear_repositorio`.
- **Sin capas Medallion**, por decisión del propietario: una sola tabla con el dato ya elaborado (diseno_funcional §8).

## 8. Informe y email

- **Adjunto** `finviz_analysis_solvencia_<fecha>.html` (`modulos/informe`). Es un HTML autocontenido, con CSS en línea y sin JavaScript, que lleva:
  - el título (`email.titulo`) y el subtítulo (`email.subtitulo`);
  - la primera y la última descarga de empresa (inicio del primer lote y fin del último);
  - la tabla de DETALLE, con las columnas y colores de diseno_funcional §9.5, ordenada por `diff_last_week` descendente.

  Pesa unos 2–3 MB con todo el universo.
- **Cuerpo**: el resumen ejecutivo de diseno_funcional §9.6, en HTML y en texto plano. Se guarda también en `email_<fecha>.html`.
- **Envío** (`modulos/email`): SMTP con STARTTLS y las credenciales del bloque `email` de secretos.yml (las de bolsa). Los destinatarios salen del bloque opcional `finvizanalysis: destinatarios` si existe; si no, de `email.destinatarios`. La estructura MIME es `multipart/mixed` → [`multipart/alternative` (texto, HTML), adjunto `text/html` en base64].
- **Desactivar el envío**: `email.activar: false`, en `configuracion.yml` o en el bloque `email` de secretos.
- **Reenvío**: `--solo-email` reenvía el último informe.

## 9. Entorno, instalación y tests del proceso semanal

```bat
:: Una vez por equipo (y tras cambiar entorno.yml), con el Python 'base' de Conda:
python actualizar_entorno.py

:: Comprobar que la web se lee (sin BD ni email)
ejecutar.bat --comprobar

:: Prueba corta sin email
ejecutar.bat --max-tickers 5 --sin-email

:: Lanzamiento como el de la tarea diaria (empieza, reanuda o no hace nada)
ejecutar.bat
```

`actualizar_entorno.py`:

1. Crea o actualiza el entorno `finvizanalysis` con `entorno.yml`.
2. Instala Chromium de Playwright dentro del entorno.
3. Comprueba que se importa cada dependencia y que Chromium arranca.
4. Guarda la ruta del Python en `config/python_exe.txt` (no versionado), que es lo que lee `_python_env.bat`.

Conda solo resuelve `python` y `pip`; el resto llega por pip. Resolver más paquetes con conda agotaba la memoria del equipo de desarrollo.

Tests:

```bash
npm test                                   # web: node --test tests/*.test.js
python -m pytest                           # proceso semanal: tests/test_*.py, sin red ni BD
FINVIZ_TEST_MARIADB=1 python -m pytest     # incluye la integración con MariaDB (schema finvizanalysis_test, se borra al final)
```

Los tests de pytest cubren:

- el universo;
- la interpretación de las marcas;
- la decisión diaria, los lotes, el tope del lanzamiento, la repesca, los bloqueos y la reanudación, con reloj y lector falsos;
- la traza del log (`test_registro.py`) y el lanzamiento de principio a fin (`test_lanzamiento.py`): ciclo nuevo, nada que hacer, reanudación tras un corte y error;
- los `diff_*`, la tolerancia, el top y el bottom, Spearman y Benjamini-Hochberg;
- los formatos y colores del informe;
- la configuración y el email;
- el guardián de secretos del repositorio público (§12).

## 10. Configuración

`config/configuracion.yml` se versiona y no lleva secretos. Cada clave está comentada en el propio fichero:

- **`rutas`**: carpetas de datos (`C:\finvizanalysis\…`, fuera del repositorio), universo (`permanentes\russell3000_bruto.csv`; las rutas relativas parten de la raíz del repositorio) y fichero de secretos.
- **`bd`**: schema y tabla.
- **`web.url`**: la web publicada.
- **`lectura`**: tamaño de lote, esperas, cupo del proxy, repesca y bloqueo.
- **`ciclo`**: días del ciclo (7) y tope de horas por lanzamiento (22).
- **`analisis`**: umbral 16, máximo 26,31, saturación de los `diff_*`, tolerancia, top N y parámetros de la correlación.
- **`email`**: activación, título y subtítulo.

### 10.1. Secretos

Es el mismo fichero que bolsa, `C:\bolsa\secretos\secretos.yml` (`rutas.dir_secretos`), y solo se lee. Bloques que usa:

- **`mariadb`**: `user`, `password`, `host` y `port`. `database` se ignora.
- **`email`**: `smtp_host`, `smtp_port`, `usuario`, `password`, `destinatarios` y `activar`.
- **`finvizanalysis`** (opcional): `destinatarios` propios.

Las credenciales quedan en claves internas (`_bd`, `_email`) que nunca se escriben en logs, informes, estados ni en la base de datos.

### 10.2. Universo

En ishares.com, en la página del ETF **iShares Russell 3000 (IWV)**, descargar "Detailed Holdings and Analytics" (CSV) y guardarlo, tal cual, como `permanentes\russell3000_bruto.csv`. Es el mismo fichero que bolsa (`bolsa\permanentes\russell3000_bruto.csv`). No se versiona (`.gitignore`): es contenido de BlackRock y el repositorio es público. Conviene renovarlo cada trimestre, tras la reconstitución del índice.

## 11. Planificación

Una tarea diaria a las 23:00, hora local del servidor (Madrid), como SYSTEM. Se crea en PowerShell o CMD **como administrador**. Los comandos están también en `planificacion/windows_planificacion.txt`:

```powershell
schtasks /delete /tn "FinvizAnalysis_Solvencia_Semanal" /f
schtasks /create /tn "FinvizAnalysis_Solvencia_Diaria" /tr "C:\DATOS\GITHUB\finviz_analysis\planificacion\run_solvencia_auto.bat" /sc daily /st 23:00 /ru SYSTEM /rl HIGHEST /f
```

- **Antes de crear la tarea diaria, el servidor debe tener este código.** El código anterior, lanzado a diario, haría un recorrido completo del Russell 3000 cada noche.
- **El día de la semana del ciclo lo fija el primer ciclo.** Para medir el cierre del viernes, el primer lanzamiento con la tabla vacía debe ser un viernes (diseno_funcional §9.3).
- **Sin solapes.** Un lanzamiento no empieza lotes pasadas 22 h (`ciclo.duracion_max_horas`). Si aun así siguiera en marcha a las 23:00, Task Scheduler no arranca una segunda copia: es su opción por defecto, "no iniciar una instancia nueva". El límite de 72 h que Windows aplica por defecto a las tareas queda muy lejos.
- **Tras un reinicio del servidor** no hay que hacer nada: el lanzamiento de esa noche reanuda el ciclo.
- `run_solvencia_auto.bat` llama a `ejecutar.bat` con `< nul`, para que nada espere una tecla.
- Para consultar, lanzar a mano, deshabilitar o borrar la tarea: `schtasks /query | /run | /change /disable | /delete /tn "FinvizAnalysis_Solvencia_Diaria"`.

## 12. Seguridad: repositorio público

- **Credenciales fuera del repositorio.** Ninguna credencial ni correo va en el repositorio: credenciales y destinatarios están solo en `secretos.yml`, fuera de él (§10.1).
- **Fuera de git** (`.gitignore`):
  - `permanentes/*` (el universo de BlackRock);
  - `volatiles/*`;
  - `config/python_exe.txt` (una ruta local con el nombre de usuario de Windows).
- **Guardián automático.** `tests/test_repositorio_publico.py` revisa todos los ficheros versionables y falla si encuentra:
  - un correo que no sea de ejemplo (`@ejemplo.invalid`) o de GitHub noreply;
  - un `password`/`api_key`/`secret`/`token` con un valor literal.

  Comprueba también que el universo queda fuera de git.
- **Autoría de los commits.** Se hacen con el correo noreply de GitHub.

## 13. Limitaciones técnicas del proceso semanal

- **Depende de la web publicada y de r.jina.ai.** Si GitHub Pages o el proxy fallan, los lotes salen sin ficha. Un bloqueo largo del proxy puede dejar la semana incompleta: lo dice el resumen ("sin ficha", "bloqueos", "no procesados").
- **La puntuación es la de la web publicada en ese momento.** Un cambio en `docs/logica.js` cambia la serie desde la semana siguiente (diseno_funcional §9.8).
- **Un solo proceso a la vez.** Dos ejecuciones simultáneas se repartirían el cupo del proxy y escribirían el mismo JSON de estado: no hay bloqueo entre procesos.
- **El entorno Conda no se pudo crear en el equipo de desarrollo** (2026-11-25): conda se quedó sin memoria al resolver paquetes. Los tests y la prueba de extremo a extremo se hicieron con el entorno `bolsa2026`, que tiene los mismos paquetes. En el servidor se crea con `python actualizar_entorno.py`.
