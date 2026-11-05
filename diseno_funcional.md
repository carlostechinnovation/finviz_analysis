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
| 🟢 Verde, de claro a oscuro | `CUMPLE` | El valor de la empresa satisface la condición; cuanto más oscuro, con más holgura (ver [§7.8](#78-escala-de-color)) |
| 🔴 Rojo, de claro a oscuro | `INCUMPLE` | El valor de la empresa no satisface la condición; cuanto más oscuro, más grave (ver [§7.8](#78-escala-de-color)) |
| Borde oscuro y negrita, sobre el rojo que toque | `INCUMPLE` | Solo en LT Debt/Eq y Market Cap, para que salten a la vista (ver [§7.2](#72-pesos-por-criterio)) |
| 🟠 Naranja | `N/A` | El dato no está disponible, o el filtro no está soportado por la app |

5. Además, antes de las filas de filtros hay una fila de **alerta de dilución** (independiente del screener): si el número de acciones en circulación de una empresa ha crecido mucho en el último año, esa celda sale en rojo con el texto `ALERTA POR DILUCIÓN: +XX% en 1 año`, aunque el resto de filtros estén en `CUMPLE`. Si SEC EDGAR no da datos suficientes, la celda también sale en rojo, con `(SIN DATOS: ver a mano)`: no se puede descartar la dilución y hay que revisarla a mano. Ver [§6](#6-la-alerta-de-dilución-real-sec-edgar).
6. Encima de la fila de dilución, justo debajo de la cabecera, hay dos filas de ordenación:
   - **Orden entrada** (fondo gris claro, solo con 2 o más empresas): la posición de cada empresa en el campo "Ticker de empresas" (1, 2, 3…).
   - **Orden por filtros cumplidos** (columna "Descripción": `Puntos`): la puntuación de cada empresa, con pesos que priman la solvencia (ver [§7](#7-puntuación-y-orden-de-las-empresas)). Por debajo de 16 puntos el número lleva el sufijo `(poco)` (p. ej. `7 (poco)`): es el umbral por debajo del cual no se compra la empresa (ver [§7.6](#76-orden-y-limitaciones)).
   - Si la empresa tiene fondos propios negativos, sus casillas de Debt/Eq y LT Debt/Eq salen en rojo con `(patrimonio negativo)` (ver [§7.4](#74-fondos-propios-negativos)).
7. Con 2 o más empresas aparecen, bajo el botón "Comparar", los botones **Orden entrada** y **Orden por filtros cumplidos**, que recargan la tabla con las columnas en ese orden (sin volver a descargar datos). Por defecto se usa el orden de entrada.

Debajo de la tabla, un log con el detalle de cada descarga.

## 3. Cómo probar que funciona

- **Cumplimiento**: si comparas una empresa que **sí** aparece en los resultados del screener en Finviz, su columna debe salir **toda verde**.
- **Incumplimiento**: si coges una empresa al azar que **no** aparece, debe tener al menos un criterio en **rojo** (`INCUMPLE`) en su columna.
- **Dilución**: comparando `BFRI` debe salir la fila de dilución en rojo (ver [§6.1](#61-caso-real-verificado-bfri)), y comparando una empresa estable (p. ej. `AAPL`) esa celda debe salir en verde con su porcentaje.
- **Orden**: comparando varias empresas y pulsando **Orden por filtros cumplidos**, las columnas deben quedar de más a menos puntos, cualquier empresa con alerta de dilución al final, y la fila "Orden entrada" debe seguir mostrando la posición original de cada una.

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
- **Solo cubre empresas que presentan ante la SEC.** No aplica a extranjeras que cotizan como ADR sin obligación de presentar 10-K/10-Q. En ese caso, como en cualquier otro sin datos suficientes, la celda sale en rojo con `(SIN DATOS: ver a mano)`: no resta puntos (no se asume dilución), pero la ausencia de dato no se presenta como ausencia de riesgo y hay que revisarla a mano.
- **El umbral es fijo (20 %) y global**, no se ajusta por sector; sectores intensivos en I+D en fase pre-beneficio (biotecnología, minería junior) diluyen con más frecuencia como parte normal de su modelo de financiación. En la puntuación (§7.5) la alerta manda la empresa al final del ranking, pero su columna sigue visible con todos sus datos: es una señal de atención para revisar a mano, no un veto automático de inversión.

## 7. Puntuación y orden de las empresas

Con muchas empresas a la vez (p. ej. los 55 tickers del email de DIIA), leer la tabla columna a columna no escala. La fila **Orden por filtros cumplidos** resume cada columna en un número que **prima la solvencia** y permite ordenarlas de mejor a peor. Los pesos están en `PESOS_FILTROS` (`docs/logica.js`).

### 7.1. Por qué pesos distintos, y por qué la solvencia pesa más

Una suma de señales binarias con el mismo peso, como el *F-score* de Piotroski [7], trata igual el endeudamiento que el RSI. Si el objetivo es **evitar empresas con riesgo de impago**, los criterios no valen lo mismo. La literatura de predicción de quiebras coincide en que el **apalancamiento**, la **liquidez** y la **rentabilidad** son los mejores predictores:

- Beaver [12]: los ratios de deuda y cash-flow sobre deuda ya distinguen a las empresas que quiebran hasta 5 años antes.
- Altman [13] (*Z-score*): combina liquidez (capital circulante), rentabilidad operativa (EBIT) y apalancamiento.
- Ohlson [14] (*O-score*): lo confirma con un modelo probabilístico.
- Campbell, Hilscher y Szilagyi [15]: el apalancamiento, la rentabilidad reciente y las caídas sostenidas de la cotización son los predictores más fuertes del riesgo de impago.

La valoración y los técnicos dicen poco sobre la capacidad de pago, así que quedan como desempate. El reparto resultante sobre el máximo posible (26,31 puntos) es:

- **Solvencia pura** (LT Debt/Eq, Debt/Eq, Current Ratio): 10 puntos, ≈38 %.
- **Capacidad de pago** (margen operativo, BPA, margen bruto): 6,5 puntos más, así que el bloque fundamental de pago suma ≈63 %.
- **Resto**: valoración, propiedad y técnicos.

LT Debt/Eq sigue siendo el criterio individual que más pesa (+4) y la solvencia, el bloque que más pesa. Criterio a criterio hay una excepción: un margen operativo de "mucho" (+3,25) supera el máximo de Debt/Eq y de Current Ratio (+3). Se acepta porque es coherente con la literatura citada, donde la rentabilidad operativa está entre los mejores predictores [13][15].

Que los pesos sean de criterio experto y no estimados con datos no es un problema grave: los modelos lineales con pesos "impropios" (subjetivos, pero con el signo correcto) predicen casi tan bien como los ajustados y no se sobreajustan a una muestra [8].

### 7.2. Pesos por criterio

Cada criterio distingue cuánto cumple o incumple: "mucho" suma o resta casi el doble que "poco" (el porqué y la calibración, en §7.7).

| Filtro | Bloque | Cumple mucho | Cumple poco | N/A | Incumple poco | Incumple mucho | Motivo |
|---|---|---|---|---|---|---|---|
| LT Debt/Eq < 1 | Solvencia | <0,3: **+4** | <0,6: +3; <1: +1,5 | **−1** | ≤2: −2 | >2: **−4** | Deuda estructural: el mayor riesgo de insolvencia a largo plazo |
| Debt/Eq < 1 | Solvencia | <0,5: **+3** | <1: +1,5 | **−1** | ≤2: −1,5 | >2: **−3** | Apalancamiento total, incluida la deuda a corto que hay que refinanciar |
| Current Ratio > 1 | Solvencia | ≥2: **+3** | ≥1,5: +2,5; >1: +1,5 | **−1** | ≥0,8: −1,5 | <0,8: **−3** | Liquidez: pagar lo que vence en 12 meses |
| Oper. Margin > 5 % | Capacidad de pago | ≥20 %: +3,25 | >5 %: +1,75 | −0,5 | ≥0: −1,75 | <0: −3,25 | El beneficio operativo es lo que paga los intereses; por debajo de 0 hay pérdida operativa |
| EPS Y/Y TTM > 0 % | Capacidad de pago | ≥40 %: +1,95 | >0: +1,05 | 0 | ≥−50 %: −1,05 | <−50 %: −1,95 | BPA creciente: mejora la cobertura de la deuda |
| Gross Margin > 10 % | Capacidad de pago | ≥45 %: +1,3 | >10 %: +0,7 | 0 | ≥0: −0,7 | <0: −1,3 | Colchón ante caídas de ventas; por debajo de 0 se vende a pérdida |
| Forward P/E < 20 | Valoración | <12: +1,3 | <20: +0,7 | **−1** | ≤30: −0,35 | >30: −0,65 | Finviz pone `-` si hay pérdidas esperadas |
| P/E < 30 | Valoración | <15: +0,95 | <30: +0,55 | **−1** | ≤50: −0,35 | >50: −0,65 | Finviz pone `-` si hay pérdidas actuales; 15 es el máximo de Graham para el inversor defensivo [17] |
| EV/Sales < 6 | Valoración | <2: +0,65 | <6: +0,35 | 0 | ≤10: −0,35 | >10: −0,65 | Poco relevante para la solvencia |
| P/S > 2 | Valoración | +0,25 (sin grados) | +0,25 | 0 | −0,25 | −0,25 (sin grados) | Irrelevante para la solvencia; un P/S mayor es más caro, no mejor |
| Short Float < 10 % | Propiedad | <4 %: +1,3 | <10 %: +0,7 | 0 | ≤15 %: −0,7 | >15 %: −1,3 | Los bajistas suelen detectar antes el deterioro financiero [16] |
| Inst Own > 30 % | Propiedad | ≥85 %: +0,65 | >30 %: +0,35 | 0 | ≥15 %: −0,35 | <15 %: −0,65 | Supervisión de inversores profesionales |
| Shs Float > 1 M | Propiedad | ≥100 M: +0,32 | >1 M: +0,18 | 0 | ≥0,5 M: −0,18 | <0,5 M: −0,32 | Liquidez bursátil, no financiera |
| Rel Volume > 0,5 | Propiedad | +0,25 (sin grados) | +0,25 | 0 | 0 | 0 | Ruido diario: un pico de volumen no es mejor |
| Market Cap < 200 B | Descriptivo | 2–50 B: +1,3 | <2 B o 50–200 B: +0,7 | 0 | ≤500 B: −0,7 | >500 B: **−1,3** | Criterio del usuario: se descartan las mega-caps, coherente con el efecto tamaño (a igual riesgo, las empresas grandes rinden menos [18]); por debajo de 2 B vale menos porque el tamaño pequeño aumenta el riesgo de quiebra [14] |
| Perf 3Y > 0 % | Técnico | ≥75 %: +0,65 | >0: +0,35 | 0 | **0** | **0** | Criterio del usuario: suma si sube, pero una caída a 3 años no resta, sea poca o mucha, aunque las caídas sostenidas anticipan deterioro [15] |
| Perf Half Y > 0 % | Técnico | ≥15 %: +0,65 | >0: +0,35 | 0 | ≥−20 %: −0,35 | <−20 %: −0,65 | Las caídas sostenidas anticipan deterioro [15] |
| 52W Low > 5 % | Técnico | ≥40 %: +0,65 | >5 %: +0,35 | 0 | ≥2 %: −0,35 | <2 %: −0,65 | En mínimos anuales el mercado puede estar descontando problemas |
| RSI (14) > 40 | Técnico | 55–70: +0,32 | 40–55 o >70: +0,18 | 0 | ≥30: −0,18 | <30: −0,32 | Momento de corto plazo; por encima de 70 vale menos por sobrecompra (convención del análisis técnico, sin respaldo académico específico) |
| SMA20 > 0 % | Técnico | ≥5 %: +0,32 | >0: +0,18 | 0 | ≥−8 %: −0,18 | <−8 %: −0,32 | Momento de corto plazo |
| ATR (14) > 1 | Técnico | +0,25 (sin grados) | +0,25 | 0 | 0 | 0 | Volatilidad en dólares: depende del precio de la acción y no mide solvencia |
| Dilución SEC < 20 % | Veto | 0 | 0 | 0 | **−99** | **−99** | Ver §7.5 |

**LT Debt/Eq y Market Cap destacados.** Cuando una empresa incumple cualquiera de los dos (también con fondos propios negativos, §7.4), su casilla lleva borde oscuro y negrita, para que salte a la vista aunque incumpla por poco. El color de esa casilla sigue midiendo el grado (§7.8), y nada de esto cambia los puntos de la tabla de arriba (`FILTROS_CRITICOS` en `docs/logica.js`).

**N/A negativo en solvencia (prudencia).** Que falte el dato de deuda o liquidez resta un punto. En P/E y Forward P/E el N/A también resta porque Finviz muestra `-` cuando el beneficio es negativo: ese N/A casi siempre es una mala noticia. En el resto de criterios el N/A es neutro.

**Sin ficha = 0.** Una casilla vacía porque la descarga está pendiente o falló (`(descargando)`, `(sin datos)`) vale 0 en todos los filtros. Un fallo del proxy no dice nada de la empresa, así que no se castiga como un N/A.

Un filtro de un screener propio que la app no soporta (sin entrada en `PESOS_FILTROS`) vale 0.

### 7.3. Tramos en los ratios de solvencia

Con un umbral binario, un LT Debt/Eq de 0,1 puntuaría igual que uno de 0,95. Por eso los tres ratios de solvencia puntúan **por tramos** según su valor (el resto de criterios también tiene tramos, con otra regla: §7.7). El tramo superior sigue la regla de Graham para el inversor defensivo: activo corriente de al menos el doble del pasivo corriente (Current Ratio ≥ 2) y deuda a largo plazo moderada frente al capital [17].

| LT Debt/Eq | Puntos | | Debt/Eq | Puntos | | Current Ratio | Puntos |
|---|---|---|---|---|---|---|---|
| < 0,3 | +4 | | < 0,5 | +3 | | ≥ 2 | +3 |
| 0,3 – < 0,6 | +3 | | 0,5 – < 1 | +1,5 | | 1,5 – < 2 | +2,5 |
| 0,6 – < 1 | +1,5 | | 1 – 2 | −1,5 | | > 1 – < 1,5 | +1,5 |
| 1 – 2 | −2 | | > 2 | −3 | | 0,8 – 1 | −1,5 |
| > 2 | −4 | | | | | < 0,8 | −3 |

- **Límites alineados con el screener.** Cada límite coincide con la condición del screener (`< 1`, `> 1`), así que un tramo positivo es siempre una casilla verde y uno negativo, una roja. Un ratio exactamente igual a 1 incumple y cae en el primer tramo negativo.
- **LT Debt/Eq y Debt/Eq se combinan.** La deuda a largo es parte de la deuda total, así que LT Debt/Eq ≤ Debt/Eq. Por eso la combinación distingue a quien tiene poca deuda de todo tipo (ambos altos) de quien la tiene concentrada a corto plazo, que es un riesgo de refinanciación (LT bajo, total alto).

### 7.4. Fondos propios negativos

Cuando los fondos propios son negativos, **Finviz no publica Debt/Eq ni LT Debt/Eq**: muestra `-`, igual que si faltara el dato. Comprobado el 30-sep-2026 con `MCD` (Book/sh −1,45) y `SBUX` (Book/sh −6,73). Dejarlo como N/A (−1) premiaría el caso más arriesgado frente a una empresa con Debt/Eq de 1,5 (−1,5). Unos fondos propios negativos significan que el pasivo supera al activo contable, que es justo lo que miden los modelos de quiebra: por ejemplo, el indicador de pasivo mayor que activo del *O-score* [14].

Por eso, si `Book/sh` es negativo (o el propio ratio llega negativo), las casillas de **Debt/Eq y LT Debt/Eq**:
- se pintan en el **rojo más oscuro** con el texto `- (patrimonio negativo)`;
- valen el **peor tramo** (−3 y −4).

En empresas maduras con recompras masivas (MCD, SBUX), los fondos propios negativos no implican una quiebra inminente, pero sí un apalancamiento que obliga a mirar la columna con atención. Es la misma lógica de "señal de atención" que la alerta de dilución.

### 7.5. Dilución como veto (−99)

Las emisiones de acciones predicen rendimientos futuros inferiores de forma persistente:
- las empresas que amplían capital rinden menos que empresas comparables durante años [9];
- la variación del número de acciones en circulación predice los rendimientos futuros con signo negativo, con más fuerza que el tamaño o la relación valor contable/precio [10].

En clave de solvencia, además, diluir con fuerza suele delatar una necesidad de financiación. Por eso la alerta no se trata como "un filtro más", sino como una regla no compensatoria (lexicográfica): primero se separa a quien diluye fuerte y solo después se ordena por el resto de criterios [11]. Como la suma máxima es 26,31 puntos, −99 garantiza que ninguna combinación de casillas compense la alerta. La dilución en verde o `(SIN DATOS: ver a mano)` no suma ni resta: no diluir no es un mérito extra, y la falta de dato se señala en rojo para revisarla a mano en vez de castigarla.

### 7.6. Orden y limitaciones

- **"Orden por filtros cumplidos"** ordena de más a menos puntos; a igualdad de puntos se respeta el orden de entrada.
- **"Orden entrada"** respeta el orden del campo "Ticker de empresas". La fila del mismo nombre deja ver ese orden original también cuando las columnas están ordenadas por puntos.
- **Umbral de compra: 16 puntos.** Con las empresas que llegan desde el email FUTURO de [bolsa](https://github.com/carlostechinnovation/bolsa), el usuario compra solo las que tienen 16 puntos o más e ignora el resto (también las que salen sin ficha, que valen 0). Por eso las casillas por debajo de 16 llevan `(poco)` (`PUNTOS_MINIMOS_COMPRA` en `docs/logica.js`). Es un criterio de uso, no estimado con datos: 16 de un máximo de 26,31 exige, en la práctica, aprobar con holgura los tres ratios de solvencia y la capacidad de pago. Bolsa mide a posteriori la rentabilidad de esas compras (su `diseno_funcional.md`), que es lo que permitirá validar o ajustar el umbral.

Limitaciones:
- **Depende del screener elegido.** La puntuación compara empresas **entre sí** frente a ese screener; no mide calidad absoluta.
- **Pesos pensados para empresas no financieras.** Utilities, bancos, aseguradoras y REITs se financian estructuralmente con deuda. El retail y la restauración operan con capital circulante negativo, y un Current Ratio de 0,8 es normal para ellos. En esos sectores la puntuación de solvencia sale sistemáticamente baja sin que eso indique más riesgo.
- **Faltan indicadores.** Finviz no ofrece la cobertura de intereses (EBIT / gastos financieros), que sería el mejor indicador de capacidad de pago.
- **Las columnas se mueven mientras se descarga.** Las casillas pendientes valen 0, así que con el orden por puntos activo las columnas pueden cambiar de sitio a medida que llegan datos.

### 7.7. Por qué "poco" y "mucho", y cómo se conserva el umbral de 16

**La regla.** Fuera de los ratios de solvencia, que ya seguían esta idea con sus tramos (§7.3), cumplir o incumplir "poco" vale unas 0,7 veces el peso de referencia y "mucho", unas 1,3 veces: casi el doble (entre 1,7 y 1,9 veces, según el redondeo).

**Por qué graduar:**

1. **Un corte binario pierde información.** Dividir por la mediana una variable normal reduce su correlación con el resultado cerca de un 20 % [19], y esa práctica está muy criticada en regresión [20].
2. **Cerca del umbral, el dato dice poco.** Las empresas gestionan sus resultados para quedar justo por encima de cero [21]. Con los grados, cruzar el umbral cambia la nota un 30 % menos (de 2 a 1,4 veces el peso).
3. **El riesgo no es lineal, pero conviene acotarlo.** La probabilidad de impago no crece de forma lineal con el apalancamiento [22], y los ratios extremos distorsionan los modelos, por lo que se suelen truncar [23]. Los tramos monótonos y acotados son la práctica habitual en *credit scoring* [24].

**Por qué no se gradúan P/S, Rel Volume y ATR.** Cumplirlos "mucho" no es mejor: un P/S mayor es más caro, un pico de volumen es ruido y el ATR va en dólares, así que depende del precio de la acción.

**Cómo se conserva el umbral.** El cambio es una dispersión que preserva la media [25]: con ±30 % y cortes cerca de la mediana, la nota esperada de cada criterio apenas cambia, así que el umbral de 16 sigue significando lo mismo aunque el máximo teórico suba de 22,75 a 26,31. Los cortes se fijaron en la mediana de las empresas que cumplen y de las que incumplen, redondeada a valores con sentido económico (P/E 15, margen 0).

**Comprobación con fichas reales** (5-nov-2026, antes y después del cambio, sin dilución):

| | Antes | Después |
|---|---|---|
| Máximo teórico | 22,75 | 26,31 |
| Mínimo teórico | −22 | −24,91 |
| Nota media (105 empresas aleatorias) | 7,94 | 7,86 |
| Máximo observado (105 aleatorias) | 21,5 | 22,02 |
| Empresas con ≥16 (105 aleatorias) | 19 | 19 (18 coinciden) |
| Empresas con ≥16 (120, con 15 elegidas a mano) | 31 | 31 (30 coinciden) |

En la selección sale `BANF` (16,75 → 15,88) y entra `BKE` (15,25 → 16,73). El orden casi no cambia (correlación de rangos de Spearman 0,99). El cambio por empresa es de 0,94 puntos de media y 3,01 como máximo. Con *bootstrap* sobre las 105 aleatorias, la coincidencia entre selecciones (índice de Jaccard) tiene un IC 95 % de 0,75–1,00 y la tasa de selección varía ±2,9 puntos porcentuales.

**Pasar el screener ya no garantiza 16 puntos.** Antes, una empresa que cumplía los 21 filtros tenía como mínimo 17,25 puntos; ahora, si los cumple todos por poco, 13,69. En la muestra no ocurre: las 10 empresas con 0 o 1 casillas sin cumplir superan 16 (la más justa, `ACIW`, con 16,03).

Límites de esta comprobación:
- **Es algo optimista.** Los cortes se ajustaron con la misma muestra, en un solo día.
- **Cobertura parcial.** La lista disponible era parcial (tickers de `A` a `DHR`, 700 empresas del Russell 3000), y 16 de las 136 fichas pedidas llegaron sin datos legibles por el proxy, sin que se haya investigado la causa.
- **No demuestra mayor capacidad predictiva.** Solo demuestra que la selección apenas cambia. Eso solo podrá medirse con la rentabilidad a posteriori de bolsa, cuyas puntuaciones anteriores y posteriores a este cambio no son comparables cerca de 16.

### 7.8. Escala de color

Con un solo verde y un solo rojo, un Current Ratio de 0,95 y otro de 0,2 se veían igual. Ahora cada casilla tiene cuatro niveles de intensidad, tanto si cumple como si incumple, calculados con los mismos tramos de la puntuación (§7.2).

| Nivel | Verde (cumple) | Rojo (incumple) | Cuándo se usa |
|---|---|---|---|
| 1 | `#c8f7c5` | `#f7c5c5` | Primer tercio del recorrido desde el umbral hasta el tramo "mucho" |
| 2 | `#6fe586` | `#ef9488` | Segundo tercio |
| 3 | `#4b916e` | `#df5646` | Último tercio |
| 4 | `#045f42` | `#a81818` | Tramo "mucho": el de más puntos, a favor o en contra |

Por ejemplo, en LT Debt/Eq (umbral 1, "incumple mucho" por encima de 2), un valor de 1,2 es nivel 1, 1,5 es nivel 2, 2 es nivel 3 y 3,14 es nivel 4.

**Casos particulares:**
- **Sin grados, nivel 1.** P/S, Rel Volume y ATR en los dos sentidos, y Perf 3Y al incumplir, porque una caída a 3 años no resta.
- **Pasado el óptimo, verde del nivel 1.** Un RSI sobre 70 o un Market Cap bajo 2 B cumplen, pero puntúan como "poco". Una distancia simple al umbral los pintaría en el verde más oscuro y contradiría los puntos.
- **Fondos propios negativos, rojo del nivel 4**, como el peor tramo (§7.4).
- **Dilución.** La alerta va en rojo del nivel 4, porque es un veto (§7.5). La falta de datos va en rojo del nivel 1 y la ausencia de alerta en verde del nivel 1, porque no diluir no es un mérito extra.
- **N/A, en naranja**, sin escala.

**Por qué el grado dentro de cada filtro, y no los puntos.** Con los puntos, casi todos los filtros técnicos quedarían pálidos por mucho que incumplieran, y el color repetiría lo que ya dice la fila de puntos. El coste es que un P/E en nivel 4 (−0,65) se ve tan oscuro como un Current Ratio en nivel 4 (−3): el color indica cuánto se aleja la empresa del criterio, no cuánto pesa ese criterio. Por eso LT Debt/Eq y Market Cap se destacan con otro recurso visual (§7.2).

**Por qué cuatro niveles fijos.** Los colores de una tabla con muchas celdas salpicadas se comparan peor que los de un degradado contiguo, y pocas clases de un mismo tono se distinguen con más fiabilidad [26]. Los tercios son una convención de presentación, sin respaldo empírico. La frontera que sí tiene significado es la del nivel 4, que coincide siempre con el tramo "mucho" de la puntuación; lo comprueba un test para todos los filtros con grados.

**Alternativas descartadas:**
- **Distancia relativa al umbral** (`|valor − umbral| / |umbral|`): divide por cero en los filtros con umbral 0 (SMA20, EPS Y/Y TTM, Perf).
- **Percentil entre las empresas comparadas:** un mismo valor cambiaría de color según con quién se compare.

**Legibilidad y daltonismo, medidos.** El contraste del texto en los ocho colores va de 5,18:1 a 7,72:1, por encima del mínimo de 4,5:1 de WCAG AA [27]. La separación de colores se ha calculado como ΔE en OKLab ×100, con la simulación de Machado et al. a severidad máxima [28], y aquí se toma 8 como objetivo práctico, sin que sea una norma:

- Dentro de cada escala, los niveles contiguos quedan entre 9,4 y 23,9.
- Un verde puro no servía: su tono más oscuro quedaba a 1,6 del rojo del nivel 3 con deuteranopia. Por eso los verdes medios y oscuros tienden algo al azul y sus luminosidades no coinciden con las de los rojos.
- Tres pares verde/rojo siguen bajo el objetivo: V1/N1 (6,5, el mismo par y el mismo valor que antes de la escala), V2/N1 (6,9) y V2/N2 (7,0). La tabla no añade ningún símbolo a la casilla, así que quien tenga deuteranopia o protanopia debería confirmar esos casos comparando el valor con la columna de condición.
- El borde del filtro destacado contrasta 2,49:1 sobre el rojo del nivel 4, menos que sobre los demás niveles. En ese nivel, lo que más lo distingue es la negrita.

## 8. Limitaciones funcionales generales

- **El significado de los códigos de filtro de Finviz no está documentado públicamente.** Se han verificado empíricamente comparando el número de resultados del screener con y sin cada filtro. Así se detectó y corrigió el mapeo de `ta_highlow52w_a5h`, que significa *"5 % o más **por encima del mínimo** de 52 semanas"* y no *"cerca del máximo"* como se interpretaba antes.
- **Solo se soportan los 21 filtros documentados en §4.1.** Un screener con otros códigos mostrará esas filas como `N/A`.
- **Sin caché ni histórico.** Cada comparación vuelve a descargar la ficha; no hay seguimiento de la evolución de una empresa entre comparaciones.
- **Uso de Finviz.** Cada comparación descarga la ficha de cada empresa con un cupo limitado por el proxy (18 peticiones por minuto), y [bolsa](https://github.com/carlostechinnovation/bolsa) abre además la página de forma automática al preparar su email FUTURO. No se extrae el screener completo. Conviene revisar que este uso siga siendo compatible con los términos de finviz.com.

## Referencias

[1] Análisis de ratios de solvencia y liquidez (current ratio, debt-to-equity) como indicadores fundamentales de la capacidad de pago de una empresa: B. Graham y D. Dodd, *Security Analysis*, McGraw-Hill (edición original 1934, reeditada con actualizaciones posteriores).

[2] Relación entre P/E, P/S y margen neto en la valoración relativa por múltiplos: A. Damodaran, *Investment Valuation: Tools and Techniques for Determining the Value of Any Asset*, Wiley; material equivalente disponible públicamente en las notas de valoración por múltiplos del propio autor, NYU Stern School of Business (pages.stern.nyu.edu/~adamodar).

[3] Riesgo de valorar negocios cíclicos sobre beneficios de pico de ciclo ("trampa de valor" / normalización de beneficios): A. Damodaran, *Investment Valuation*, op. cit., capítulos sobre valoración de empresas cíclicas y beneficios normalizados.

[4] Definición contable del beneficio por acción (EPS) y su cálculo como resultado neto entre acciones en circulación (ponderadas, en el caso del EPS diluido): Financial Accounting Standards Board (FASB), *Accounting Standards Codification* Topic 260, "Earnings Per Share" (asc.fasb.org).

[5] U.S. Securities and Exchange Commission, SEC EDGAR, API `companyconcept` (XBRL Frames API): `https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{taxonomia}/{concepto}.json`. Documentación oficial: `https://www.sec.gov/edgar/sec-api-documentation`. Datos de `BFRI` consultados en `https://data.sec.gov/api/xbrl/companyconcept/CIK0001858685/us-gaap/CommonStockSharesOutstanding.json`.

[6] U.S. Securities and Exchange Commission, mapeo oficial ticker → CIK: `https://www.sec.gov/files/company_tickers.json`.

[7] J. D. Piotroski, "Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers", *Journal of Accounting Research*, 38 (Supplement), 2000, pp. 1-41.

[8] R. M. Dawes, "The robust beauty of improper linear models in decision making", *American Psychologist*, 34(7), 1979, pp. 571-582.

[9] T. Loughran y J. R. Ritter, "The New Issues Puzzle", *The Journal of Finance*, 50(1), 1995, pp. 23-51.

[10] J. Pontiff y A. Woodgate, "Share Issuance and Cross-sectional Returns", *The Journal of Finance*, 63(2), 2008, pp. 921-945.

[11] P. C. Fishburn, "Lexicographic Orders, Utilities and Decision Rules: A Survey", *Management Science*, 20(11), 1974, pp. 1442-1471.

[12] W. H. Beaver, "Financial Ratios as Predictors of Failure", *Journal of Accounting Research*, 4 (Empirical Research in Accounting: Selected Studies), 1966, pp. 71-111.

[13] E. I. Altman, "Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy", *The Journal of Finance*, 23(4), 1968, pp. 589-609.

[14] J. A. Ohlson, "Financial Ratios and the Probabilistic Prediction of Bankruptcy", *Journal of Accounting Research*, 18(1), 1980, pp. 109-131.

[15] J. Y. Campbell, J. Hilscher y J. Szilagyi, "In Search of Distress Risk", *The Journal of Finance*, 63(6), 2008, pp. 2899-2939.

[16] P. M. Dechow, A. P. Hutton, L. Meulbroek y R. G. Sloan, "Short-sellers, fundamental analysis, and stock returns", *Journal of Financial Economics*, 61(1), 2001, pp. 77-106.

[17] B. Graham, *The Intelligent Investor*, 4.ª ed. revisada, Harper & Row, 1973, cap. 14 ("Stock Selection for the Defensive Investor").

[18] R. W. Banz, "The relationship between return and market value of common stocks", *Journal of Financial Economics*, 9(1), 1981, pp. 3-18.

[19] J. Cohen, "The cost of dichotomization", *Applied Psychological Measurement*, 7(3), 1983, pp. 249-253.

[20] P. Royston, D. G. Altman y W. Sauerbrei, "Dichotomizing continuous predictors in multiple regression: a bad idea", *Statistics in Medicine*, 25(1), 2006, pp. 127-141.

[21] D. Burgstahler e I. Dichev, "Earnings management to avoid earnings decreases and losses", *Journal of Accounting and Economics*, 24(1), 1997, pp. 99-126.

[22] R. C. Merton, "On the pricing of corporate debt: the risk structure of interest rates", *The Journal of Finance*, 29(2), 1974, pp. 449-470.

[23] T. Shumway, "Forecasting bankruptcy more accurately: a simple hazard model", *The Journal of Business*, 74(1), 2001, pp. 101-124.

[24] L. C. Thomas, D. B. Edelman y J. N. Crook, *Credit Scoring and Its Applications*, SIAM, 2002.

[25] M. Rothschild y J. E. Stiglitz, "Increasing risk: I. A definition", *Journal of Economic Theory*, 2(3), 1970, pp. 225-243.

[26] M. Harrower y C. A. Brewer, "ColorBrewer.org: an online tool for selecting colour schemes for maps", *The Cartographic Journal*, 40(1), 2003, pp. 27-37.

[27] W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, criterio 1.4.3 "Contrast (Minimum)", recomendación del 5 de octubre de 2023.

[28] G. M. Machado, M. M. Oliveira y L. A. F. Fernandes, "A physiologically-based model for simulation of color vision deficiency", *IEEE Transactions on Visualization and Computer Graphics*, 15(6), 2009, pp. 1291-1298.
