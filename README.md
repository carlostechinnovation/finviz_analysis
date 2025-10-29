# FINVIZ - Comparador de una EMPRESA contra los criterios de un SCREENER

**MOTIVO:**

Un usuario crea un screener con unos criterios que aparentan ser interesantes.
Otro día, el usuario se pregunta: 

*¿Por qué la empresa XXX que aparenta ser buena no aparece en los resultados de mi screener?*

**IMPLEMENTACIÓN:**

Una web permite recoger el nombre de la empresa analizada y la URL del screener (hay algunos ya metidos por defecto en un CSV que pienso que son interesantes).

La web extrae las propiedades de la empresa y las compara con los criterios del screener. 

Muestra en rojo, verde y naranja la comparación de cada criterio.

**COMPROBACIÓN:**

- **Cumplimiento** = Si ejecuto la comparación para una empresa de las mostradas en la web de finviz para el SCREENER, la tabla debe ser toda VERDE.

- **Incumplimiento** = Si cojo una empresa al azar que no sale en la web del screener, su tabla tendrá al menos un criterio en rojo (INCU)


