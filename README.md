# FINVIZ — Comparador de empresas contra los criterios de un SCREENER

Aplicación web estática (HTML + JavaScript, sin backend) que coge **uno o varios tickers** y **la URL de un screener de Finviz**, descarga la ficha de cada empresa y muestra, criterio a criterio, **cuáles cumple y cuáles no** — con una columna por empresa para poder compararlas de un vistazo. Incluye además una alerta independiente de **dilución fuerte** (aumento agresivo de acciones en circulación) basada en datos oficiales de SEC EDGAR, no solo en Finviz.

> ⚠️ **Proyecto educativo.** No es asesoramiento financiero ni una recomendación de inversión. Los datos proceden de [finviz.com](https://finviz.com) y de [SEC EDGAR](https://www.sec.gov/edgar) a través de proxies públicos de terceros y pueden estar incompletos, retrasados o ser erróneos. Úsalo para aprender cómo funcionan los filtros de un screener, no para operar con dinero real.

## Documentación

- **[diseno_funcional.md](diseno_funcional.md)** — qué problema resuelve, cómo se interpretan los filtros del screener de ejemplo, por qué la dilución de acciones necesita una comprobación aparte y cómo se mide la evolución semanal de la solvencia (con referencias).
- **[diseno_informatico.md](diseno_informatico.md)** — arquitectura de la web y del proceso semanal, flujo de ejecución, base de datos, instalación, planificación y tests.

## Uso rápido

1. Abre `docs/index.html` (servido, no como `file://`; ver [diseno_informatico.md](diseno_informatico.md)) o la versión publicada en GitHub Pages.
2. Escribe uno o varios tickers separados por comas (p. ej. `AAPL, MSFT, GOOG`).
3. Elige un screener predefinido o pega la URL de uno tuyo de Finviz.
4. Opcional: en **Excluir sectores** marca los sectores de Finviz cuyas empresas no quieres ver (todos sin marcar por defecto). Se ocultan al momento, sin volver a descargar nada ([diseno_funcional.md §7.9](diseno_funcional.md#79-exclusión-de-sectores)).
5. Pulsa **Comparar**.
6. Con dos o más empresas, los botones **Orden entrada** y **Orden por filtros cumplidos** (bajo "Comparar") reordenan las columnas sin volver a descargar nada: en el orden en que las escribiste o de más a menos puntos. La puntuación prima la **solvencia** (LT Debt/Eq, Debt/Eq y Current Ratio forman el bloque que más pesa) y gradúa cada criterio: cumplir o incumplir mucho suma o resta casi el doble que hacerlo por poco, salvo P/S, Rel Volume y ATR, que no tienen grados, y las caídas de Perf 3Y, que no restan. Las empresas con fondos propios negativos reciben la peor nota en deuda y una alerta de dilución resta 99 (detalle y referencias en [diseno_funcional.md §7](diseno_funcional.md#7-puntuación-y-orden-de-las-empresas)). Por debajo de 16 puntos el número lleva `(poco)`, y la dilución sin datos de SEC EDGAR sale en rojo con `(SIN DATOS: ver a mano)`.
7. Las casillas van en verde si cumplen y en rojo si incumplen, con cuatro intensidades según el grado: cuanto más oscuro, más holgura o más gravedad ([diseno_funcional.md §7.8](diseno_funcional.md#78-escala-de-color)).

También puedes enlazar directo con los tickers precargados y la comparación ya lanzada (screener por defecto "solventes"), con `?tickers=` en la URL, p. ej. `https://carlostechinnovation.github.io/finviz_analysis/?tickers=AAPL,MSFT,GOOG`. Así es como el email resumen de [DIIA](https://github.com/carlostechinnovation/diia) enlaza su tabla de Selección del día. Con `&escenario=texto` ese texto aparece como subtítulo bajo el título (p. ej. `?tickers=AAPL,MSFT&escenario=BolsaML - 2026-10-03 14:23:05`); así indican los emails de [bolsa](https://github.com/carlostechinnovation/bolsa) y DIIA de qué ejecución vienen los tickers. Con `&excluir_sectores=energy,financial` (códigos de Finviz separados por comas: `basicmaterials`, `communicationservices`, `consumercyclical`, `consumerdefensive`, `energy`, `financial`, `healthcare`, `industrials`, `realestate`, `technology`, `utilities`) la página se abre con esos sectores ya marcados en "Excluir sectores".

```bash
cd docs
python -m http.server 8000
# http://localhost:8000
```

## Proceso semanal de solvencia (backend)

Aparte de la web, un proceso Python ([diseno_funcional.md §9](diseno_funcional.md#9-evolución-semanal-de-la-solvencia-de-todo-el-russell-3000)) se lanza **cada noche a las 23:00** (hora de Madrid) y, una vez por semana, abre esta misma web con un navegador sin ventana para las ~2.600 empresas del **Russell 3000**, en lotes de 100. Si el servidor se reinicia a mitad, el lanzamiento de la noche siguiente reanuda el ciclo desde la última empresa guardada. Guarda la puntuación y el precio de cada empresa en MariaDB (`finvizanalysis.solvencia`) y envía un email:

- **Cuerpo:** un resumen ejecutivo con las cifras de la ejecución, las estadísticas de las puntuaciones, el top y el bottom 10 de la semana, la correlación entre subida de puntos y de precio, y el espacio en disco.
- **Adjunto:** un HTML con una fila por empresa, con sus variaciones de 1 semana a 12 meses.

Usa Python 3.11 con Conda, MariaDB y Playwright; las credenciales están en un fichero fuera del repositorio. Instalación y planificación en [diseno_informatico.md §9–§11](diseno_informatico.md#9-entorno-instalación-y-tests-del-proceso-semanal).

```bat
python actualizar_entorno.py      :: una vez: entorno conda + Chromium
ejecutar.bat --comprobar          :: lee la web con dos tickers (sin BD ni email)
ejecutar.bat                      :: ejecucion completa
```

## Tests

```bash
npm test             # web (node --test)
python -m pytest     # proceso semanal
```

Tests unitarios (`node --test`, sin dependencias) de la lógica pura en [docs/logica.js](docs/logica.js) —incluido el caso real de dilución de `BFRI` documentado en [diseno_funcional.md](diseno_funcional.md), la puntuación por filtros cumplidos, el orden de columnas y la exclusión de sectores— y comprobaciones estáticas de la página. Los de pytest cubren el proceso semanal sin red ni base de datos (con `FINVIZ_TEST_MARIADB=1` incluyen la integración con MariaDB) y comprueban que ningún fichero versionado lleva correos ni contraseñas.
