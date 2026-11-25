from modulos.lector.logica import interpretar_celdas, timeout_lote_min, url_lote

P = {"proxy_peticiones_max_por_ticker": 4, "proxy_peticiones_por_minuto": 18,
     "timeout_factor": 2, "timeout_min": 20, "timeout_max_min": 60}


def test_interpretar_celdas_y_validez():
    r = interpretar_celdas([
        ["aapl", "17.5", "0", "ok", "", "354.2"],
        ["MSFT", "-81.5", "0", "alerta", "", ""],        # dilucion -99: valida, sin precio
        ["XXX", "0", "1", "sin_datos", "timeout", ""],   # sin ficha: no se guarda
        ["YYY", "12", "0", "pendiente", "", "10"],       # dilucion pendiente: no se guarda
        ["ZZZ", "abc", "0", "ok"],                       # sin precio (pagina antigua) y sin numero
        ["", "1", "0", "ok", "", "1"],
    ])
    assert set(r) == {"AAPL", "MSFT", "XXX", "YYY", "ZZZ"}
    assert (r["AAPL"].puntos, r["AAPL"].precio, r["AAPL"].valida) == (17.5, 354.2, True)
    assert r["MSFT"].precio is None and r["MSFT"].valida
    assert not r["XXX"].valida and r["XXX"].motivo == "timeout"
    assert not r["YYY"].valida
    assert not r["ZZZ"].valida


def test_url_lote():
    assert url_lote("https://x.io/f/", ["AAPL", "BRK-B"]) == "https://x.io/f/?tickers=AAPL,BRK-B"
    assert url_lote("https://x.io/f/?a=1", ["A"]) == "https://x.io/f/?a=1&tickers=A"


def test_timeout_lote():
    assert timeout_lote_min(2, P) == 20                  # minimo
    assert round(timeout_lote_min(100, P), 1) == 44.6    # 2 * 401 / 18
    assert timeout_lote_min(500, P) == 60                # tope
