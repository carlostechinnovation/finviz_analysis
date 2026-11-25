"""
Donde busca Playwright su Chromium: DENTRO del entorno conda, no en el perfil
del usuario de Windows (mismo criterio que bolsa, soporte/entorno/navegador.py).

Por defecto Playwright descarga los navegadores en %LOCALAPPDATA%\ms-playwright,
una carpeta por usuario. actualizar_entorno.py se ejecuta con el usuario de
siempre, pero la tarea programada corre como SYSTEM, que buscaria el navegador
en su propio perfil y no lo encontraria. Con PLAYWRIGHT_BROWSERS_PATH=0
(instalacion "hermetica" documentada por Playwright) el navegador va dentro del
paquete playwright del entorno, comun a cualquier usuario.

Solo biblioteca estandar: actualizar_entorno.py lo importa desde el Python base.
"""
import os

VARIABLE = "PLAYWRIGHT_BROWSERS_PATH"
DENTRO_DEL_ENTORNO = "0"
CARPETA_POR_USUARIO = "ms-playwright"


def variables_de_entorno(base=None) -> dict:
    """Variables de entorno (las de este proceso si no se dan) con Chromium dentro del entorno."""
    return {**(os.environ if base is None else base), VARIABLE: DENTRO_DEL_ENTORNO}


def usar_navegador_del_entorno() -> None:
    """En este proceso, Playwright buscara Chromium dentro del entorno conda."""
    os.environ[VARIABLE] = DENTRO_DEL_ENTORNO
