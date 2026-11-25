"""Pytest del proceso semanal: la raiz del repositorio en sys.path para importar modulos/."""
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))
