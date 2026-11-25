"""
El repositorio es PUBLICO: ningun fichero versionado puede llevar contrasenas,
claves ni correos personales (diseno_informatico.md 12). Se revisan los
ficheros que git conoce (o todos los de texto si git no esta disponible).
"""
import re
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
EXTENSIONES = {".py", ".js", ".yml", ".yaml", ".md", ".bat", ".txt", ".sql", ".html", ".css", ".csv", ".json", ".toml"}
CORREO = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
CORREOS_PERMITIDOS = re.compile(r"@ejemplo\.invalid$|@users\.noreply\.github\.com$")
CLAVE = re.compile(r"""(?i)\b(password|passwd|api_key|secret|token)\b\s*[:=]\s*["']?([^\s"',}]{4,})""")
VALORES_PERMITIDOS = {"x", "p@ss"}


def _ficheros():
    try:
        salida = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=RAIZ,
                                capture_output=True, text=True, check=True).stdout.splitlines()
        rutas = [RAIZ / s for s in salida]
    except (OSError, subprocess.CalledProcessError):
        rutas = [p for p in RAIZ.rglob("*") if ".git" not in p.parts]
    return [p for p in rutas if p.is_file() and p.suffix.lower() in EXTENSIONES]


def test_sin_correos_personales():
    hallados = []
    for ruta in _ficheros():
        for correo in CORREO.findall(ruta.read_text(encoding="utf-8", errors="ignore")):
            if not CORREOS_PERMITIDOS.search(correo) and not correo.lower().startswith(("p@ss",)):
                hallados.append(f"{ruta.relative_to(RAIZ)}: {correo}")
    assert not hallados, "Correos en ficheros versionados:\n" + "\n".join(hallados)


def test_sin_contrasenas_en_claro():
    hallados = []
    for ruta in _ficheros():
        for clave, valor in CLAVE.findall(ruta.read_text(encoding="utf-8", errors="ignore")):
            if valor not in VALORES_PERMITIDOS and not valor.startswith(("str(", "conf[", "credenciales", "{", "mariadb")):
                hallados.append(f"{ruta.relative_to(RAIZ)}: {clave}={valor[:3]}...")
    assert not hallados, "Posibles secretos en ficheros versionados:\n" + "\n".join(hallados)


def test_universo_fuera_de_git():
    ignorado = subprocess.run(["git", "check-ignore", "-q", "permanentes/russell3000_bruto.csv"], cwd=RAIZ)
    assert ignorado.returncode == 0
