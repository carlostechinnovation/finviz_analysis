# FINVIZ — Comparador de empresas contra los criterios de un SCREENER

Aplicación web estática (HTML + JavaScript, sin backend) que coge **uno o varios tickers** y **la URL de un screener de Finviz**, descarga la ficha de cada empresa y muestra, criterio a criterio, **cuáles cumple y cuáles no** — con una columna por empresa para poder compararlas de un vistazo. Incluye además una alerta independiente de **dilución fuerte** (aumento agresivo de acciones en circulación) basada en datos oficiales de SEC EDGAR, no solo en Finviz.

> ⚠️ **Proyecto educativo.** No es asesoramiento financiero ni una recomendación de inversión. Los datos proceden de [finviz.com](https://finviz.com) y de [SEC EDGAR](https://www.sec.gov/edgar) a través de proxies públicos de terceros y pueden estar incompletos, retrasados o ser erróneos. Úsalo para aprender cómo funcionan los filtros de un screener, no para operar con dinero real.

## Documentación

- **[diseno_funcional.md](diseno_funcional.md)** — qué problema resuelve, cómo se interpretan los filtros del screener de ejemplo y por qué la dilución de acciones necesita una comprobación aparte (con referencias).
- **[diseno_informatico.md](diseno_informatico.md)** — arquitectura, flujo de ejecución, estructura de ficheros, cómo correr la app y los tests en local.

## Uso rápido

1. Abre `docs/index.html` (servido, no como `file://`; ver [diseno_informatico.md](diseno_informatico.md)) o la versión publicada en GitHub Pages.
2. Escribe uno o varios tickers separados por comas (p. ej. `AAPL, MSFT, GOOG`).
3. Elige un screener predefinido o pega la URL de uno tuyo de Finviz.
4. Pulsa **Comparar**.

```bash
cd docs
python -m http.server 8000
# http://localhost:8000
```

## Tests

```bash
npm test
```

Tests unitarios (`node --test`, sin dependencias) de la lógica pura en [docs/logica.js](docs/logica.js), incluido el caso real de dilución de `BFRI` documentado en [diseno_funcional.md](diseno_funcional.md).
