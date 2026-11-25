# Normas de este proyecto (finviz_analysis)

Este fichero matiza, **solo para este proyecto**, las "Preferencias tecnicas
por defecto" de `~/.claude/CLAUDE.md`. El resto de normas personales de ese
fichero (estilo de interaccion, preguntar antes de cambios ambiguos, etc.) se
mantienen y siguen aplicando aqui.

## Dos partes con stacks distintos

### 1. La web (`docs/`): JavaScript estatico, sin backend

Es intencionadamente una **web 100% estatica** (HTML + JavaScript), publicada
tal cual en GitHub Pages sin coste ni servidor. GitHub Pages no puede ejecutar
Python ni FastAPI, asi que para la web:

- **Lenguaje**: JavaScript puro (sin framework, sin bundler, sin
  transpilacion). `docs/app.js` y `docs/logica.js` se mantienen en ASCII puro
  a proposito (ver cabecera de esos ficheros).
- **Sin backend ni base de datos**: toda la logica corre en el navegador; el
  acceso a Finviz y a SEC EDGAR se hace via el proxy publico `r.jina.ai`.
- **Tests**: `node --test` (`npm test`, `tests/*.test.js`).
- Las marcas `data-*` de la fila de puntos son una **interfaz publica**: las
  leen bolsa y el proceso semanal. No cambiarlas sin adaptar a sus lectores.

### 2. El proceso semanal de solvencia (resto del repositorio): Python

Abre la web publicada con Playwright para todo el Russell 3000, guarda puntos
y precio en MariaDB y envia un email. Sigue el stack por defecto y el de
bolsa:

- **Python 3.11** con **Conda** (entorno `finvizanalysis`, `entorno.yml`).
- **MariaDB** (schema `finvizanalysis`, tabla `solvencia`).
- **Sin FastAPI, uvicorn ni React**: no hay aplicacion web propia; la unica
  interfaz es la web estatica y el email.
- **Tests**: pytest (`tests/test_*.py`).
- **Credenciales**: solo en `C:\bolsa\secretos\secretos.yml` (el mismo de
  bolsa), nunca en el repositorio, que es **publico**. El test
  `tests/test_repositorio_publico.py` falla si aparece un correo o una
  contrasena en un fichero versionado.

## Estructura de carpetas

- `docs/` — la web publicada en GitHub Pages (HTML, CSS y JS).
- `modulos/` — codigo del proceso semanal, un paquete por responsabilidad.
- `tests/` — tests de las dos partes (`*.test.js` y `test_*.py`).
- `sql/` — creacion del schema y la tabla.
- `config/` — `configuracion.yml` (versionado, sin secretos).
- `planificacion/` — envoltorio de Task Scheduler y comando `schtasks`.
- `permanentes/` — universo `russell3000_bruto.csv` (fuera de git).
- `volatiles/` — vacia en el repositorio; los datos de ejecucion van a
  `C:\finvizanalysis`.

No existe `web/`: la unica web es la estatica de `docs/`.

## Documentacion

Se siguen las normas globales de documentacion:

- `README.md` — resumen breve para la portada de GitHub.
- `diseno_funcional.md` — el porque, con enfoque de analista bursatil y
  referencias bibliograficas (filtros del screener, dilucion, puntuacion y,
  en su seccion 9, la evolucion semanal y la correlacion puntos-precio).
- `diseno_informatico.md` — arquitectura de las dos partes, flujos,
  base de datos, instalacion, planificacion y tests.

No se crean otros ficheros `.md` explicativos ademas de estos tres.
