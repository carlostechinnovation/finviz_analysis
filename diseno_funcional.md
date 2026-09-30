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

5. Además, antes de las filas de filtros hay una fila de **alerta de dilución** (independiente del screener): si el número de acciones en circulación de una empresa ha crecido mucho en el último año, esa celda sale en rojo con el texto `ALERTA POR DILUCIÓN: +XX% en 1 año`, aunque el resto de filtros estén en `CUMPLE`. Ver [§6](#6-la-alerta-de-dilución-real-sec-edgar).
6. Encima de la fila de dilución, justo debajo de la cabecera, hay dos filas de ordenación:
   - **Orden entrada** (fondo gris claro, solo con 2 o más empresas): la posición de cada empresa en el campo "Ticker de empresas" (1, 2, 3…).
   - **Orden por filtros cumplidos**: la puntuación de cada empresa, con pesos que priman la solvencia (ver [§7](#7-puntuación-y-orden-de-las-empresas)).
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
- **Solo cubre empresas que presentan ante la SEC.** No aplica a extranjeras que cotizan como ADR sin obligación de presentar 10-K/10-Q; en ese caso la celda simplemente sale vacía (no se asume nada).
- **El umbral es fijo (20 %) y global**, no se ajusta por sector; sectores intensivos en I+D en fase pre-beneficio (biotecnología, minería junior) diluyen con más frecuencia como parte normal de su modelo de financiación. En la puntuación (§7.5) la alerta manda la empresa al final del ranking, pero su columna sigue visible con todos sus datos: es una señal de atención para revisar a mano, no un veto automático de inversión.

## 7. Puntuación y orden de las empresas

Con muchas empresas a la vez (p. ej. los 55 tickers del email de DIIA), leer la tabla columna a columna no escala. La fila **Orden por filtros cumplidos** resume cada columna en un número que **prima la solvencia** y permite ordenarlas de mejor a peor. Los pesos están en `PESOS_FILTROS` (`docs/logica.js`).

### 7.1. Por qué pesos distintos, y por qué la solvencia pesa más

Una suma de señales binarias con el mismo peso, como el *F-score* de Piotroski [7], trata igual el endeudamiento que el RSI. Si el objetivo es **evitar empresas con riesgo de impago**, los criterios no valen lo mismo. La literatura de predicción de quiebras coincide en que el **apalancamiento**, la **liquidez** y la **rentabilidad** son los mejores predictores:

- Beaver [12]: los ratios de deuda y cash-flow sobre deuda ya distinguen a las empresas que quiebran hasta 5 años antes.
- Altman [13] (*Z-score*): combina liquidez (capital circulante), rentabilidad operativa (EBIT) y apalancamiento.
- Ohlson [14] (*O-score*): lo confirma con un modelo probabilístico.
- Campbell, Hilscher y Szilagyi [15]: el apalancamiento, la rentabilidad reciente y las caídas sostenidas de la cotización son los predictores más fuertes del riesgo de impago.

La valoración y los técnicos dicen poco sobre la capacidad de pago, así que quedan como desempate. El reparto resultante sobre el máximo posible (22,25 puntos) es:

- **Solvencia pura** (LT Debt/Eq, Debt/Eq, Current Ratio): 10 puntos, ≈45 %.
- **Capacidad de pago** (margen operativo, BPA, margen bruto): 5 puntos más, así que el bloque fundamental de pago suma ≈67 %.
- **Resto**: valoración, propiedad y técnicos.

Que los pesos sean de criterio experto y no estimados con datos no es un problema grave: los modelos lineales con pesos "impropios" (subjetivos, pero con el signo correcto) predicen casi tan bien como los ajustados y no se sobreajustan a una muestra [8].

### 7.2. Pesos por criterio

| Filtro | Bloque | Cumple | N/A | Incumple | Motivo |
|---|---|---|---|---|---|
| LT Debt/Eq < 1 | Solvencia | por tramos (máx. **+4**) | **−1** | por tramos (mín. **−4**) | Deuda estructural: el mayor riesgo de insolvencia a largo plazo |
| Debt/Eq < 1 | Solvencia | por tramos (máx. **+3**) | **−1** | por tramos (mín. **−3**) | Apalancamiento total, incluida la deuda a corto que hay que refinanciar |
| Current Ratio > 1 | Solvencia | por tramos (máx. **+3**) | **−1** | por tramos (mín. **−3**) | Liquidez: pagar lo que vence en 12 meses |
| Oper. Margin > 5 % | Capacidad de pago | +2,5 | −0,5 | −2,5 | El beneficio operativo es lo que paga los intereses |
| EPS Y/Y TTM > 0 % | Capacidad de pago | +1,5 | 0 | −1,5 | BPA creciente: mejora la cobertura de la deuda |
| Gross Margin > 10 % | Capacidad de pago | +1 | 0 | −1 | Colchón ante caídas de ventas |
| Forward P/E < 20 | Valoración | +1 | **−1** | −0,5 | Finviz pone `-` si hay pérdidas esperadas |
| P/E < 30 | Valoración | +0,75 | **−1** | −0,5 | Finviz pone `-` si hay pérdidas actuales |
| EV/Sales < 6 | Valoración | +0,5 | 0 | −0,5 | Poco relevante para la solvencia |
| P/S > 2 | Valoración | +0,25 | 0 | −0,25 | Irrelevante para la solvencia |
| Short Float < 10 % | Propiedad | +1 | 0 | −1 | Los bajistas suelen detectar antes el deterioro financiero [16] |
| Inst Own > 30 % | Propiedad | +0,5 | 0 | −0,5 | Supervisión de inversores profesionales |
| Shs Float > 1 M | Propiedad | +0,25 | 0 | −0,25 | Liquidez bursátil, no financiera |
| Rel Volume > 0,5 | Propiedad | +0,25 | 0 | 0 | Ruido diario |
| Market Cap < 200 B | Descriptivo | +0,25 | 0 | **0** | Ser mega-cap no empeora la solvencia |
| Perf 3Y > 0 % | Técnico | +0,75 | 0 | −0,75 | Caídas largas de cotización anticipan deterioro [15] |
| Perf Half Y > 0 % | Técnico | +0,5 | 0 | −0,5 | Ídem a 6 meses |
| 52W Low > 5 % | Técnico | +0,5 | 0 | −0,5 | En mínimos anuales el mercado puede estar descontando problemas |
| RSI (14) > 40 | Técnico | +0,25 | 0 | −0,25 | Momento de corto plazo |
| SMA20 > 0 % | Técnico | +0,25 | 0 | −0,25 | Momento de corto plazo |
| ATR (14) > 1 | Técnico | +0,25 | 0 | 0 | Volatilidad: no mide solvencia |
| Dilución SEC < 20 % | Veto | 0 | 0 | **−99** | Ver §7.5 |

**N/A negativo en solvencia (prudencia).** Que falte el dato de deuda o liquidez resta un punto. En P/E y Forward P/E el N/A también resta porque Finviz muestra `-` cuando el beneficio es negativo: ese N/A casi siempre es una mala noticia. En el resto de criterios el N/A es neutro.

**Sin ficha = 0.** Una casilla vacía porque la descarga está pendiente o falló (`(descargando)`, `(sin datos)`) vale 0 en todos los filtros. Un fallo del proxy no dice nada de la empresa, así que no se castiga como un N/A.

Un filtro de un screener propio que la app no soporta (sin entrada en `PESOS_FILTROS`) vale 0.

### 7.3. Tramos en los ratios de solvencia

Con un umbral binario, un LT Debt/Eq de 0,1 puntuaría igual que uno de 0,95. Por eso los tres ratios de solvencia puntúan **por tramos** según su valor. El tramo superior sigue la regla de Graham para el inversor defensivo: activo corriente de al menos el doble del pasivo corriente (Current Ratio ≥ 2) y deuda a largo plazo moderada frente al capital [17].

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
- se pintan en **rojo** con el texto `- (patrimonio negativo)`;
- valen el **peor tramo** (−3 y −4).

En empresas maduras con recompras masivas (MCD, SBUX), los fondos propios negativos no implican una quiebra inminente, pero sí un apalancamiento que obliga a mirar la columna con atención. Es la misma lógica de "señal de atención" que la alerta de dilución.

### 7.5. Dilución como veto (−99)

Las emisiones de acciones predicen rendimientos futuros inferiores de forma persistente:
- las empresas que amplían capital rinden menos que empresas comparables durante años [9];
- la variación del número de acciones en circulación predice los rendimientos futuros con signo negativo, con más fuerza que el tamaño o la relación valor contable/precio [10].

En clave de solvencia, además, diluir con fuerza suele delatar una necesidad de financiación. Por eso la alerta no se trata como "un filtro más", sino como una regla no compensatoria (lexicográfica): primero se separa a quien diluye fuerte y solo después se ordena por el resto de criterios [11]. Como la suma máxima es 22,25 puntos, −99 garantiza que ninguna combinación de casillas compense la alerta. La dilución en verde o `N/D` no suma: no diluir no es un mérito extra.

### 7.6. Orden y limitaciones

- **"Orden por filtros cumplidos"** ordena de más a menos puntos; a igualdad de puntos se respeta el orden de entrada.
- **"Orden entrada"** respeta el orden del campo "Ticker de empresas". La fila del mismo nombre deja ver ese orden original también cuando las columnas están ordenadas por puntos.

Limitaciones:
- **Depende del screener elegido.** La puntuación compara empresas **entre sí** frente a ese screener; no mide calidad absoluta.
- **Pesos pensados para empresas no financieras.** Utilities, bancos, aseguradoras y REITs se financian estructuralmente con deuda. El retail y la restauración operan con capital circulante negativo, y un Current Ratio de 0,8 es normal para ellos. En esos sectores la puntuación de solvencia sale sistemáticamente baja sin que eso indique más riesgo.
- **Faltan indicadores.** Finviz no ofrece la cobertura de intereses (EBIT / gastos financieros), que sería el mejor indicador de capacidad de pago.
- **Las columnas se mueven mientras se descarga.** Las casillas pendientes valen 0, así que con el orden por puntos activo las columnas pueden cambiar de sitio a medida que llegan datos.

## 8. Limitaciones funcionales generales

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
