"""
Crea o actualiza el entorno conda 'finvizanalysis' del proceso semanal
(diseno_informatico.md 9) y deja todo listo para la tarea programada:

  1. conda env create / conda env update con entorno.yml;
  2. Chromium de Playwright DENTRO del entorno (modulos/lector/navegador.py),
     para que lo encuentre tambien el usuario SYSTEM de la tarea programada;
  3. comprueba que cada dependencia se importa y que Chromium arranca;
  4. guarda la ruta del Python del entorno en config/python_exe.txt, que lee
     _python_env.bat.

Termina con codigo 1 si algo falla. Se ejecuta con el Python 'base' de conda:

    python actualizar_entorno.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

from modulos.lector.navegador import variables_de_entorno

NOMBRE_ENV = "finvizanalysis"
RAIZ = Path(__file__).resolve().parent
ENTORNO_YML = RAIZ / "entorno.yml"
FICHERO_PYTHON = RAIZ / "config" / "python_exe.txt"
MODULOS = ["numpy", "scipy", "pandas", "yaml", "sqlalchemy", "pymysql", "playwright", "pytest"]
PRUEBA_CHROMIUM = ("from playwright.sync_api import sync_playwright\n"
                   "with sync_playwright() as p:\n"
                   "    b = p.chromium.launch(headless=True); b.close()\n")


def buscar_conda() -> str:
    """Ruta de conda: el PATH o las rutas habituales de Anaconda/Miniconda en Windows."""
    en_path = shutil.which("conda")
    if en_path:
        return en_path
    casa = Path.home()
    for c in (casa / "anaconda3" / "Scripts" / "conda.exe", casa / "miniconda3" / "Scripts" / "conda.exe",
              Path(r"C:\ProgramData\anaconda3\Scripts\conda.exe"),
              Path(r"C:\ProgramData\miniconda3\Scripts\conda.exe")):
        if c.exists():
            return str(c)
    sys.exit("[entorno] ERROR: no encuentro 'conda'. Abre 'Anaconda Prompt' y repite.")


def python_del_entorno(conda: str) -> Path | None:
    """Python del entorno si existe (busca su carpeta en 'conda env list')."""
    salida = subprocess.run([conda, "env", "list"], capture_output=True, text=True).stdout
    for linea in salida.splitlines():
        partes = linea.split()
        if partes and partes[0] == NOMBRE_ENV:
            exe = Path(partes[-1]) / "python.exe"
            return exe if exe.exists() else None
    return None


def main() -> int:
    conda = buscar_conda()
    python = python_del_entorno(conda)
    orden = "update" if python else "create"
    print(f"[entorno] conda env {orden} -f {ENTORNO_YML.name} ...")
    if subprocess.run([conda, "env", orden, "-f", str(ENTORNO_YML)]).returncode != 0:
        print("[entorno] AVISO: conda devolvio error; se comprueba igualmente el resultado")
    python = python_del_entorno(conda)
    if python is None:
        print(f"[entorno] ERROR: no existe el entorno '{NOMBRE_ENV}' tras conda env {orden}")
        return 1

    entorno = variables_de_entorno()
    print("[entorno] Instalando Chromium de Playwright dentro del entorno ...")
    subprocess.run([str(python), "-m", "playwright", "install", "chromium"], env=entorno)

    fallos = [m for m in MODULOS
              if subprocess.run([str(python), "-c", f"import {m}"], capture_output=True).returncode != 0]
    if subprocess.run([str(python), "-c", PRUEBA_CHROMIUM], env=entorno, capture_output=True).returncode != 0:
        fallos.append("Chromium (no arranca)")
    FICHERO_PYTHON.parent.mkdir(exist_ok=True)
    FICHERO_PYTHON.write_text(str(python), encoding="utf-8")
    if fallos:
        print("[entorno] ERROR: fallan " + ", ".join(fallos))
        return 1
    print(f"[entorno] OK: {python}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
