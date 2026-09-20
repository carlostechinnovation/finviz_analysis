# Normas de este proyecto (finviz_analysis)

Este fichero sobreescribe, **solo para este proyecto**, las "Preferencias
tecnicas por defecto" de `~/.claude/CLAUDE.md` (Python, Conda, MariaDB,
uvicorn/FastAPI, React). El resto de normas personales de ese fichero
(estilo de interaccion, preguntar antes de cambios ambiguos, etc.) se
mantienen y siguen aplicando aqui.

## Por que este proyecto no usa el stack por defecto

`finviz_analysis` es intencionadamente una **web 100% estatica** (HTML +
JavaScript, sin backend, sin base de datos), pensada para publicarse tal
cual en GitHub Pages sin coste ni mantenimiento de servidor. Anadir Python
(Conda), FastAPI/uvicorn, MariaDB o React contradiria ese objetivo: no hay
nada que un backend o una base de datos resuelvan aqui, y GitHub Pages no
puede ejecutar Python ni FastAPI.

Por tanto, para este proyecto:

- **Lenguaje**: JavaScript puro (sin framework, sin bundler, sin
  transpilacion). Los ficheros `docs/app.js` y `docs/logica.js` se
  mantienen en ASCII puro a proposito (ver cabecera de esos ficheros).
- **Backend**: ninguno. Toda la logica corre en el navegador; el acceso a
  Finviz y a SEC EDGAR se hace via el proxy publico `r.jina.ai` para
  esquivar CORS.
- **Base de datos**: ninguna. No hay estado persistente entre ejecuciones.
- **Tests**: `node --test` (test runner incorporado en Node, sin
  dependencias), no pytest. Ver `tests/logica.test.js`.

## Estructura de carpetas de este proyecto

Se sigue la convencion general de `~/.claude/CLAUDE.md` en lo que aplica:

- `docs/` — web estatica publicada en GitHub Pages (uso identico al de la
  convencion global: aqui vive tanto el HTML/CSS como el JS, porque no hay
  un backend separado que justifique una carpeta `modulos/`).
- `tests/` — tests unitarios (`node --test`, equivalente a la preferencia
  por pytest en proyectos Python).

No existen `modulos/`, `permanentes/`, `volatiles/`, `web/` ni `sql/`:
no hay codigo de backend, ni ficheros de datos persistentes o volatiles
propios del proyecto, ni una aplicacion web con FastAPI+React, ni SQL.

## Documentacion de este proyecto

Se siguen las normas globales de documentacion:

- `README.md` — resumen breve para la portada de GitHub.
- `diseno_funcional.md` — el porque del proyecto con enfoque de analista
  bursatil, con referencias bibliograficas para las decisiones complejas
  (por que esos filtros del screener, por que el proxy de dilucion via EPS
  es insuficiente, etc.).
- `diseno_informatico.md` — arquitectura, flujo de ejecucion, estructura de
  ficheros e instrucciones de instalacion/uso/tests.

No se crean otros ficheros `.md` explicativos ademas de estos tres.
