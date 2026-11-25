"""Pytest del proceso de solvencia: la raiz del repositorio en sys.path para importar modulos/."""
import logging
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))


@pytest.fixture
def log_restaurado():
    """Deja el logger raiz como estaba (los tests de log llaman a configurar_log, que lo cambia)."""
    raiz = logging.getLogger()
    antes, nivel = list(raiz.handlers), raiz.level
    yield
    for h in list(raiz.handlers):
        raiz.removeHandler(h)
        h.close()
    for h in antes:
        raiz.addHandler(h)
    raiz.setLevel(nivel)
