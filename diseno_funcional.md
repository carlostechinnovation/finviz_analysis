# Diseño funcional

## 1. Motivo

Un usuario crea un screener con unos criterios que aparentan ser interesantes. Otro día se pregunta:

> *¿Por qué la empresa XXX, que aparenta ser buena, no aparece en los resultados de mi screener?*

Finviz te dice **qué** empresas pasan el filtro, pero no **por qué** una concreta se queda fuera. Esta herramienta responde justo a eso: pone en una tabla cada criterio del screener frente al valor real de cada empresa que quieras revisar, una al lado de otra.

## 2. Qué hace

1. El usuario escribe **uno o varios tickers** (p. ej. `AAPL, MSFT, GOOG`) y elige un **screener** (predefinido en un CSV) o pega una **URL propia** de Finviz.
2. La app extrae los códigos de filtro del parámetro `f=` de esa URL.
3. Descarga la ficha de cada ticker y la compara filtro a filtro.
4. Pinta una tabla con una columna por ticker:

| Color | Estado | Significado |
|---|---|---|
| 🟢 Verde | `CUMPLE` | El valor de la empresa satisface la condición |
| 🔴 Rojo | `INCUMPLE` | El valor de la empresa no satisface la condición |
| 🟠 Naranja | `N/A` | El dato no está disponible, o el filtro no está soportado por la app |

5. Además, la primera fila de la tabla es una **alerta de dilución** (independiente del screener): si el número de acciones en circulación de una empresa ha crecido mucho en el último año, esa celda sale en rojo con el texto `ALERTA POR DILUCIÓN: +XX% en 1 año`, aunque el resto de filtros estén en `CUMPLE`. Ver [§4](#4-la-alerta-de-dilución-real-sec-edgar).

Al final se muestra un resumen por ticker (`N CUMPLE - N INCUMPLE - N N/A`, más el aviso de dilución si aplica) y un log con el detalle de cada descarga.

## 3. Cómo probar que funciona

- **Cumplimiento**: si comparas una empresa que **sí** aparece en los resultados del screener en Finviz, su columna debe salir **toda verde**.
- **Incumplimiento**: si coges una empresa al azar que **no** aparece, debe tener al menos un criterio en **rojo** (`INCUMPLE`) en su columna.
- **Dilución**: comparando `BFRI` debe salir la fila de dilución en rojo (ver [§4.2](#42-caso-real-verificado-bfri)), y comparando una empresa estable (p. ej. `AAPL`) esa celda debe salir vacía.

## 4. Análisis del screener predefinido: `solventes`

URL completa (decodificada):

```
https://finviz.com/screener.ashx
  ?v=211            vista "Charts" (gráficos)
  &p=w              velas semanales
  &ft=4             pestaña de filtros = "All" (solo afecta a la interfaz)
  &o=-instown       ordenar por propiedad institucional, descendente
  &f=<21 filtros>
```

### 4.1. Los 21 filtros, uno a uno

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

Estos tres ratios de solvencia (liquidez corriente y apalancamiento) son indicadores clásicos de análisis fundamental para evaluar la capacidad de una empresa de afrontar sus obligaciones a corto y largo plazo [1].

**Crecimiento y dilución**

| Código | Campo Finviz | Condición | Qué busca |
|---|---|---|---|
| `fa_epsyoyttm_pos` | EPS Y/Y TTM | Positivo | Que el **beneficio por acción** crezca, no solo los ingresos totales. Ver [§5](#5-el-filtro-anti-dilución) |

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

### 4.2. Qué tipo de empresa sale de aquí

Los filtros se refuerzan entre sí y el perfil resultante es bastante estrecho:

- **Margen neto implícito alto.** Exigir `P/S > 2` y a la vez `P/E < 30` obliga a un margen neto de aproximadamente `2 / 30 ≈ 6,7 %` como mínimo (relación derivada de `P/S = (P/E) × (margen neto)`, propia de la valoración relativa por múltiplos [2]). Esto elimina de golpe distribución, retail, aerolíneas y cualquier negocio de volumen con margen fino.
- **Balance sano.** Deuda inferior a fondos propios (total y a largo) más liquidez corriente positiva: fuera empresas muy apalancadas, utilities y buena parte del inmobiliario.
- **Rentable ya, no promesa futura.** `Forward P/E < 20` exige beneficios estimados positivos: fuera biotecnológicas sin ingresos y growth sin beneficios.
- **Tamaño medio-grande pero no gigante.** Por debajo de 200.000 M$ y con respaldo institucional > 30 %: fuera micro-caps y chicharros.
- **En tendencia alcista, no en rebote desde mínimos.** Por encima de la SMA20, RSI > 40, positiva a 6 meses y a 3 años, y al menos un 5 % por encima del mínimo anual.

**El resultado práctico** (consulta de septiembre de 2026: **13 empresas**) se concentra en dos bloques muy reconocibles:

- **Transporte marítimo y energía**: `FRO`, `STNG`, `INSW`, `TNK`, `TRMD`, `LPG`, `COP`, `EOG`.
- **Semiconductores**: `NXPI`, `QRVO`, `TEL`.
- Y algún industrial o farma suelto: `VMI`, `NBIX`.

Es decir: **negocios cíclicos maduros, con caja, poca deuda y en la parte buena de su ciclo**. La combinación "márgenes altos + múltiplo bajo + tendencia alcista" es exactamente el perfil de un sector cíclico en pleno pico de beneficios — lo cual es también su principal riesgo: valorar un negocio cíclico por un múltiplo bajo calculado sobre beneficios de pico de ciclo (en vez de sobre beneficios normalizados a lo largo del ciclo) es una fuente conocida de *trampas de valor* [3].

## 5. El filtro anti-dilución

La **dilución del accionista** —emitir acciones nuevas de forma continua— reparte el mismo negocio entre más participaciones: cada acción vale cada vez menos aunque la empresa en conjunto crezca. Es un riesgo que ninguno de los filtros clásicos de valoración detecta.

**Finviz no ofrece un filtro directo de "variación del número de acciones".** Tiene `Shares Outstanding` y `Float`, pero solo como magnitudes absolutas, no como variación en el tiempo. Verificado contra la lista real de filtros del screener.

El proxy nativo que sí funciona es exigir **crecimiento del beneficio por acción (BPA)**, porque es exactamente la magnitud que la dilución destruye: el beneficio por acción se define como el resultado neto entre el número medio ponderado de acciones en circulación, de forma que un aumento de ese denominador reduce el BPA aunque el numerador (el beneficio total) crezca [4].

> Si una empresa emite un 30 % más de acciones y sus beneficios totales solo suben un 10 %, los ingresos y el beneficio agregado crecen, pero el **BPA cae**. El filtro `fa_epsyoyttm_pos` (EPS Y/Y TTM positivo) captura justo ese caso.

Alternativas valoradas, por si se quiere endurecer (cifras sobre las 15 empresas que daba el screener sin este filtro):

| Filtro | Significado | Empresas resultantes |
|---|---|---|
| `fa_epsyoyttm_pos` ← **aplicado** | BPA creciente en los últimos 12 meses | 13 |
| `fa_eps5years_pos` | BPA creciente en los últimos 5 años | 9 |
| `fa_eps5years_pos` + `fa_epsyoyttm_pos` | Ambos: dilución histórica **y** reciente | 7 |
| `fa_eps3years_pos` + `fa_epsyoyttm_pos` | Ventana corta y exigente | 5 |

Se eligió la versión suave (`fa_epsyoyttm_pos`) para no expulsar negocios cíclicos sanos por un mal tramo de 3-5 años.

### 5.1. El proxy no es suficiente: caso `BFRI`

El BPA creciente falla cuando una empresa con pérdidas las va reduciendo a la vez que dispara la emisión de acciones: el BPA mejora (menos pérdida por acción) aunque el número de acciones se dispare. Esto es consistente con la propia definición contable del BPA: una mejora del numerador (menor pérdida neta) puede compensar, en el ratio, un fuerte aumento del denominador (más acciones) [4].

Verificado con `BFRI` (Biofrontera Inc.): en Finviz muestra `EPS Y/Y TTM: +73,13 %` — pasa el filtro `fa_epsyoyttm_pos` sin problema — pero sus acciones en circulación subieron de 10.138.567 (30-jun-2025) a 14.206.126 (30-jun-2026), un **+40,1 % en un año**, según los propios informes 10-Q/10-K que la empresa presenta a la SEC [5].

## 6. La alerta de dilución real (SEC EDGAR)

Por eso la comparación no depende solo de Finviz para esto: además consulta el histórico real de acciones en circulación en **SEC EDGAR**, el sistema oficial de presentación de informes de la SEC estadounidense, a través de su API pública de datos estructurados XBRL [5][6]. Si el aumento en ~12 meses supera el 20 %, la fila de dilución de la tabla se pinta en rojo para esa empresa (`ALERTA POR DILUCIÓN: +XX% en 1 año`), independientemente de si el resto de filtros del screener están en `CUMPLE`.

El umbral del 20 % es una elección de diseño, no un estándar normativo: separa la dilución rutinaria por compensación en acciones a empleados (habitualmente de un solo dígito bajo al año) de una emisión de capital agresiva como la de `BFRI`.

### 6.1. Caso real verificado: `BFRI`

Datos reales de SEC EDGAR (CIK `1858685`, concepto contable `us-gaap:CommonStockSharesOutstanding`) [5]:

| Fecha (fin de periodo) | Acciones en circulación | Informe |
|---|---|---|
| 2025-06-30 | 10.138.567 | 10-Q |
| 2026-06-30 | 14.206.126 | 10-Q |

`(14.206.126 - 10.138.567) / 10.138.567 = +40,1 %` → supera el umbral del 20 % → **se dispara la alerta**, pese a que Finviz muestra `EPS Y/Y TTM: +73,13 %` (positivo, pasa el filtro anti-dilución del screener).

### 6.2. Limitaciones funcionales de la alerta

- **No distingue dilución real de un *split*.** Los datos "as filed" de SEC EDGAR no se reexpresan retroactivamente tras un desdoblamiento de acciones (que no diluye realmente, solo reparte el mismo valor en más títulos). Un split reciente puede disparar esta alerta como falso positivo.
- **Solo cubre empresas que presentan ante la SEC.** No aplica a extranjeras que cotizan como ADR sin obligación de presentar 10-K/10-Q; en ese caso la celda simplemente sale vacía (no se asume nada).
- **El umbral es fijo (20 %) y global**, no se ajusta por sector; sectores intensivos en I+D en fase pre-beneficio (biotecnología, minería junior) diluyen con más frecuencia como parte normal de su modelo de financiación, así que la alerta debe leerse como una señal de atención, no como un veto automático de inversión.

## 7. Limitaciones funcionales generales

- **El significado de los códigos de filtro de Finviz no está documentado públicamente.** Se han verificado empíricamente comparando el número de resultados del screener con y sin cada filtro. Así se detectó y corrigió el mapeo de `ta_highlow52w_a5h`, que significa *"5 % o más **por encima del mínimo** de 52 semanas"* y no *"cerca del máximo"* como se interpretaba antes.
- **Solo se soportan los 21 filtros documentados en §4.1.** Un screener con otros códigos mostrará esas filas como `N/A`.
- **Sin caché ni histórico.** Cada comparación vuelve a descargar la ficha; no hay seguimiento de la evolución de una empresa entre comparaciones.
- **Uso de Finviz.** Respeta los términos de uso de finviz.com: esta herramienta hace una única petición manual por consulta y no automatiza extracciones masivas.

## Referencias

[1] Análisis de ratios de solvencia y liquidez (current ratio, debt-to-equity) como indicadores fundamentales de la capacidad de pago de una empresa: B. Graham y D. Dodd, *Security Analysis*, McGraw-Hill (edición original 1934, reeditada con actualizaciones posteriores).

[2] Relación entre P/E, P/S y margen neto en la valoración relativa por múltiplos: A. Damodaran, *Investment Valuation: Tools and Techniques for Determining the Value of Any Asset*, Wiley; material equivalente disponible públicamente en las notas de valoración por múltiplos del propio autor, NYU Stern School of Business (pages.stern.nyu.edu/~adamodar).

[3] Riesgo de valorar negocios cíclicos sobre beneficios de pico de ciclo ("trampa de valor" / normalización de beneficios): A. Damodaran, *Investment Valuation*, op. cit., capítulos sobre valoración de empresas cíclicas y beneficios normalizados.

[4] Definición contable del beneficio por acción (EPS) y su cálculo como resultado neto entre acciones en circulación (ponderadas, en el caso del EPS diluido): Financial Accounting Standards Board (FASB), *Accounting Standards Codification* Topic 260, "Earnings Per Share" (asc.fasb.org).

[5] U.S. Securities and Exchange Commission, SEC EDGAR, API `companyconcept` (XBRL Frames API): `https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{taxonomia}/{concepto}.json`. Documentación oficial: `https://www.sec.gov/edgar/sec-api-documentation`. Datos de `BFRI` consultados en `https://data.sec.gov/api/xbrl/companyconcept/CIK0001858685/us-gaap/CommonStockSharesOutstanding.json`.

[6] U.S. Securities and Exchange Commission, mapeo oficial ticker → CIK: `https://www.sec.gov/files/company_tickers.json`.
