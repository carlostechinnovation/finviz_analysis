"""
Espacio ocupado en disco (resumen ejecutivo, diseno_funcional.md 9.6): la
carpeta de datos del proceso (rutas.dir_base: estados, informes y logs) y la
tabla en MariaDB (DATA_LENGTH + INDEX_LENGTH de information_schema, que en
InnoDB es una estimacion). No incluye el entorno conda ni el repositorio.
"""
import os
from pathlib import Path


def tamano_directorio(ruta: Path) -> int:
    """Suma de los tamanos de todos los ficheros bajo ruta (0 si no existe)."""
    total = 0
    for raiz, _, ficheros in os.walk(ruta):
        for f in ficheros:
            try:
                total += (Path(raiz) / f).stat().st_size
            except OSError:
                pass
    return total


def texto_tamano(n_bytes: int | None) -> str:
    """1536 -> '1,5 KB'. None -> 'desconocido'."""
    if n_bytes is None:
        return "desconocido"
    valor = float(n_bytes)
    for unidad in ("B", "KB", "MB", "GB"):
        if valor < 1024 or unidad == "GB":
            return (f"{valor:.0f} {unidad}" if unidad == "B" else f"{valor:.1f} {unidad}").replace(".", ",")
        valor /= 1024
    return ""
