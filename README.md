# FINVIZ — Comparador de una EMPRESA contra los criterios de un SCREENER

Aplicación web estática (HTML + JavaScript, sin backend) que coge **un ticker** y **la URL de un screener de Finviz**, descarga la ficha de la empresa y muestra, criterio a criterio, **cuáles cumple y cuáles no**.

> ⚠️ **Proyecto educativo.** No es asesoramiento financiero ni una recomendación de inversión. Los datos proceden de [finviz.com](https://finviz.com) a través de un proxy público de terceros y pueden estar incompletos, retrasados o ser erróneos. Úsalo para aprender cómo funcionan los filtros de un screener, no para operar con dinero real.

---

## 1. Motivo

Un usuario crea un screener con unos criterios que aparentan ser interesantes. Otro día se pregunta:

> *¿Por qué la empresa XXX, que aparenta ser buena, no aparece en los resultados de mi screener?*

Finviz te dice **qué** empresas pasan el filtro, pero no **por qué** una concreta se queda fuera. Esta herramienta responde justo a eso: pone en una tabla cada criterio del screener frente al valor real de la empresa.

## 2. Qué hace

1. Lee un **ticker** (por ejemplo `AAPL`) y eliges un **screener** (de los predefinidos en un CSV) o pegas una **URL propia** de Finviz.
2. La app extrae los códigos de filtro del parámetro `f=` de esa URL.
3. Descarga la ficha `finviz.com/quote.ashx?t=TICKER` y extrae sus propiedades.
4. Compara cada criterio y pinta la tabla:

| Color | Estado | Significado |
|---|---|---|
| 🟢 Verde | `CUMPLE` | El valor de la empresa satisface la condición |
| 🔴 Rojo | `INCUMPLE` | El valor de la empresa no satisface la condición |
| 🟠 Naranja | `N/A` | El dato no está disponible, o el filtro no está soportado por la app |

Al final muestra un resumen (`N CUMPLE - N INCUMPLE - N N/A`) y un log con el detalle de la descarga.

## 3. Cómo probar que funciona

- **Cumplimiento**: si comparas una empresa que **sí** aparece en los resultados del screener en Finviz, la tabla debe salir **toda verde**.
- **Incumplimiento**: si coges una empresa al azar que **no** aparece, debe tener al menos un criterio en **rojo** (`INCUMPLE`).

## 4. Estructura del repositorio

```
docs/                            <- raíz publicada en GitHub Pages
├── index.html                   formulario + tabla de resultados
├── app.js                       toda la lógica (filtros, descarga, parseo, comparación)
├── style.css                    estilos (incluye los colores ok / nok / na)
├── urls_screeners_finviz.csv    screeners predefinidos   (SCREENER|URL)
└── descripcion_filtros.csv      glosario de campos Finviz (FILTRO|DESCRIPCION)
```

Los dos CSV usan **`|` como separador** (no coma) y tienen una línea de cabecera.

## 5. Arquitectura

Todo se ejecuta **en el navegador**; no hay servidor propio ni claves de API.

```
navegador  ──fetch──>  https://r.jina.ai/https://finviz.com/quote.ashx?t=TICKER
                              │
                              └──> devuelve la página renderizada como texto/markdown
                                   con cabeceras CORS abiertas
```

Detalles relevantes de [docs/app.js](docs/app.js):

- **Por qué un proxy**: GitHub Pages no puede llamar a `finviz.com` directamente por CORS. Se usa `r.jina.ai`, que renderiza la página en su servidor y la devuelve con CORS abierto. Una sola llamada, sin reintentos en paralelo, con **timeout de 20 s**.
- **Parseo**: se buscan pares `Clave**Valor**` en todo el texto (no línea a línea, porque el proxy a veces junta todos los campos en una sola línea). Se descarta la descarga si se reconocen menos de **8 campos** conocidos.
- **Alias**: el diccionario `ALIAS` cubre las distintas etiquetas que Finviz ha usado con el tiempo (`Oper. Margin` / `Operating Margin`, `Shs Float` / `Float`, etc.).
- **Normalización numérica**: `aNumero()` admite `1,234.5`, `12.34%`, `+3.2%`, sufijos `K/M/B/T` y campos combinados tipo `0.61% / 1.20`.
- **Codificación**: el fichero se mantiene en **ASCII puro** a propósito; los acentos van como escapes `\uXXXX` para que ningún editor lo corrompa al guardarlo en otra codificación.

## 6. Uso

En local basta con servir la carpeta `docs/` (abrir `index.html` como `file://` falla al cargar los CSV):

```bash
cd docs
python -m http.server 8000
# http://localhost:8000
```

O usar directamente la versión publicada en GitHub Pages del repositorio.

### Añadir un screener nuevo

Añade una línea a [docs/urls_screeners_finviz.csv](docs/urls_screeners_finviz.csv):

```
nombre_del_screener|https://finviz.com/screener.ashx?v=111&f=cap_midover,fa_pe_u20
```

La app solo mira el parámetro `f=` de la URL; el resto (`v`, `o`, `p`, `ft`) se ignora.

---

## 7. Análisis del screener predefinido: `solventes`

URL completa (decodificada):

```
https://finviz.com/screener.ashx
  ?v=211            vista "Charts" (gráficos)
  &p=w              velas semanales
  &ft=4             pestaña de filtros = "All" (solo afecta a la interfaz)
  &o=-instown       ordenar por propiedad institucional, descendente
  &f=<21 filtros>
```

### 7.1. Los 21 filtros, uno a uno

**Descriptivos**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `cap_largeunder` | Market Cap | < 200.000 M$ | Todo menos las mega-caps: deja fuera a Apple, Microsoft, Nvidia… |

**Fundamentales — valoración**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `fa_pe_u30` | P/E | < 30 | No pagar de más por los beneficios actuales |
| `fa_fpe_u20` | Forward P/E | < 20 | Que los beneficios *estimados* también salgan baratos |
| `fa_ps_o2` | P/S | **> 2** | ⚠️ Es un **mínimo**, no un máximo: descarta negocios de mucha venta y poco margen |
| `fa_evsales_u6` | EV/Sales | < 6 | Techo a lo anterior: ni barato de más ni caro de más |

**Fundamentales — calidad del negocio**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `fa_grossmargin_o10` | Gross Margin | > 10 % | Margen bruto mínimo |
| `fa_opermargin_o5` | Oper. Margin | > 5 % | Que el negocio sea rentable a nivel operativo |

**Fundamentales — solvencia** (de aquí viene el nombre del screener)

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `fa_curratio_o1` | Current Ratio | > 1 | El activo corriente cubre el pasivo corriente |
| `fa_debteq_u1` | Debt/Eq | < 1 | Deuda total menor que los fondos propios |
| `fa_ltdebteq_u1` | LT Debt/Eq | < 1 | Lo mismo para la deuda a largo plazo |

**Crecimiento y dilución**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `fa_epsyoyttm_pos` | EPS Y/Y TTM | Positivo | Que el **beneficio por acción** crezca, no solo los ingresos totales. Ver [§7.3](#73-el-filtro-anti-dilución) |

**Propiedad y liquidez de mercado**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `sh_instown_o30` | Inst Own | > 30 % | Respaldo de fondos institucionales |
| `sh_float_o1` | Shs Float | > 1 M acciones | Que haya papel suficiente circulando |
| `sh_short_u10` | Short Float | < 10 % | Evitar valores muy atacados por bajistas |
| `sh_relvol_o0.5` | Rel Volume | > 0,5 | Que hoy se negocie con actividad normal |

**Técnicos — tendencia y momento**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `ta_averagetruerange_o1` | ATR (14) | > 1 | Recorrido diario en $ suficiente |
| `ta_rsi_nos40` | RSI (14) | > 40 (no sobrevendido) | Descartar valores en caída libre |
| `ta_sma20_pa` | SMA20 | Precio **por encima** de la media de 20 días | Tendencia corta alcista |
| `ta_highlow52w_a5h` | 52W Low | **5 % o más por encima del mínimo de 52 semanas** | Que no esté hundido en mínimos anuales |
| `ta_perf2_26wup` | Perf Half Y | Positiva | Va bien a medio plazo (26 semanas) |
| `ta_perf_3yup` | Perf 3Y | Positiva | Y también a 3 años |

### 7.2. Qué tipo de empresa sale de aquí

Los filtros se refuerzan entre sí y el perfil resultante es bastante estrecho:

- **Margen neto implícito alto.** Exigir `P/S > 2` y a la vez `P/E < 30` obliga a un margen neto de aproximadamente `2 / 30 ≈ 6,7 %` como mínimo. Esto elimina de golpe distribución, retail, aerolíneas y cualquier negocio de volumen con margen fino.
- **Balance sano.** Deuda inferior a fondos propios (total y a largo) más liquidez corriente positiva: fuera empresas muy apalancadas, utilities y buena parte del inmobiliario.
- **Rentable ya, no promesa futura.** `Forward P/E < 20` exige beneficios estimados positivos: fuera biotecnológicas sin ingresos y growth sin beneficios.
- **Tamaño medio-grande pero no gigante.** Por debajo de 200.000 M$ y con respaldo institucional > 30 %: fuera micro-caps y chicharros.
- **En tendencia alcista, no en rebote desde mínimos.** Por encima de la SMA20, RSI > 40, positiva a 6 meses y a 3 años, y al menos un 5 % por encima del mínimo anual.

**El resultado práctico** (consulta de septiembre de 2026: **13 empresas**) se concentra en dos bloques muy reconocibles:

- **Transporte marítimo y energía**: `FRO`, `STNG`, `INSW`, `TNK`, `TRMD`, `LPG`, `COP`, `EOG`.
- **Semiconductores**: `NXPI`, `QRVO`, `TEL`.
- Y algún industrial o farma suelto: `VMI`, `NBIX`.

Es decir: **negocios cíclicos maduros, con caja, poca deuda y en la parte buena de su ciclo**. La combinación "márgenes altos + múltiplo bajo + tendencia alcista" es exactamente el perfil de un sector cíclico en pleno pico de beneficios — lo cual es también su principal riesgo: un múltiplo bajo en un cíclico en máximo de ciclo suele ser una *trampa de valor*.

### 7.3. El filtro anti-dilución

La **dilución del accionista** —emitir acciones nuevas de forma continua— reparte el mismo negocio entre más participaciones: cada acción vale cada vez menos aunque la empresa en conjunto crezca. Es un riesgo que ninguno de los filtros clásicos de valoración detecta.

**Finviz no ofrece un filtro directo de "variación del número de acciones".** Tiene `Shares Outstanding` y `Float`, pero solo como magnitudes absolutas, no como variación en el tiempo. Verificado contra la lista real de filtros del screener.

El proxy nativo que sí funciona es exigir **crecimiento del beneficio por acción (BPA)**, porque es exactamente la magnitud que la dilución destruye:

> Si una empresa emite un 30 % más de acciones y sus beneficios totales solo suben un 10 %, los ingresos y el beneficio agregado crecen, pero el **BPA cae**. El filtro `fa_epsyoyttm_pos` (EPS Y/Y TTM positivo) captura justo ese caso.

Alternativas valoradas, por si quieres endurecerlo (cifras sobre las 15 empresas que daba el screener sin este filtro):

| Filtro | Significado | Empresas resultantes |
|---|---|---|
| `fa_epsyoyttm_pos` ← **aplicado** | BPA creciente en los últimos 12 meses | 13 |
| `fa_eps5years_pos` | BPA creciente en los últimos 5 años | 9 |
| `fa_eps5years_pos` + `fa_epsyoyttm_pos` | Ambos: dilución histórica **y** reciente | 7 |
| `fa_eps3years_pos` + `fa_epsyoyttm_pos` | Ventana corta y exigente | 5 |

Se eligió la versión suave (`fa_epsyoyttm_pos`) para no expulsar negocios cíclicos sanos por un mal tramo de 3-5 años.

---

## 8. Limitaciones conocidas

- **Solo se soportan los 21 filtros del diccionario `FILTROS`** de `app.js`. Si pegas una URL con otros códigos, esas filas salen como `N/A` con el texto `(filtro no soportado)`.
- **El significado de los códigos de filtro de Finviz no está documentado públicamente.** Se han verificado empíricamente comparando el número de resultados del screener con y sin cada filtro. Así se detectó y corrigió el mapeo de `ta_highlow52w_a5h`, que significa *"5 % o más **por encima del mínimo** de 52 semanas"* y no *"cerca del máximo"* como se interpretaba antes.
- **Dependencia de un proxy de terceros.** Si `r.jina.ai` está caído, saturado o cambia el formato de salida, la descarga falla. No hay reintentos.
- **El parseo es frágil por naturaleza.** Se basa en el texto renderizado de la ficha de Finviz; cualquier cambio de maquetación puede romperlo. El umbral de 8 campos reconocidos existe precisamente para detectarlo y avisar en vez de dar resultados falsos.
- **Sin caché ni histórico.** Cada comparación vuelve a descargar la ficha.
- **Uso de Finviz.** Respeta los términos de uso de finviz.com: esta herramienta hace una única petición manual por consulta y no automatiza extracciones masivas.
