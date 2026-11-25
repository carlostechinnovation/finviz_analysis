from modulos.universo.logica import alias_clase, leer_universo, normalizar_ticker

CSV = '''iShares Russell 3000 ETF
Fund Holdings as of,"Oct 15, 2026"

Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Quantity,Price,Location,Exchange,Currency,FX Rate,Market Currency,Accrual Date
"NVDA","NVIDIA","IT","Equity","1","6.84","1","1","217.23","United States","NASDAQ","USD","1.00","USD","-"
"BRK B","BERKSHIRE HATHAWAY INC CLASS B","Fin","Equity","1","1","1","1","1","United States","NYSE","USD","1.00","USD","-"
"BFB","BROWN FORMAN CORP CLASS B","Cons","Equity","1","1","1","1","1","United States","NYSE","USD","1.00","USD","-"
"NVDA","NVIDIA","IT","Equity","1","6.84","1","1","217.23","United States","NASDAQ","USD","1.00","USD","-"
"GTXI","GTXI INC - CVR","HC","Equity","0","0","0","0","0","United States","NASDAQ","USD","1.00","USD","-"
"-","VERDERA","En","Equity","0","0","0","0","0","United States","NASDAQ","USD","1.00","USD","-"
"HOLX","HOLOGIC INC","HC","Equity","1","0","1","1","0.01","United States","NO MARKET (E.G. UNLISTED)","USD","1.00","USD","-"
"UWMC-R-W","UWM HOLDINGS RIGHTS WHEN ISSUED EX","Fin","Equity","1","0","1","1","0","United States","NYSE","USD","1.00","USD","-"
"ESZ6","S&P500 EMINI DEC 26","Cash","Futures","0","0","1","1","1","-","Index","USD","1.00","USD","-"
"CVI","CVR ENERGY INC","En","Equity","1","0","1","1","1","United States","NYSE","USD","1.00","USD","-"

The content contained herein is owned or licensed by BlackRock
'''


def test_leer_universo_filtra_como_bolsa(tmp_path):
    ruta = tmp_path / "russell3000_bruto.csv"
    ruta.write_text(CSV, encoding="utf-8")
    tickers, alias = leer_universo(ruta)
    assert tickers == ["NVDA", "BRK-B", "BFB", "CVI"]
    assert alias == {"BFB": "BF-B"}


def test_normalizar_y_alias():
    assert normalizar_ticker(" brk b ") == "BRK-B"
    assert alias_clase("HEIA", "HEICO CORP CLASS A") == "HEI-A"
    assert alias_clase("BRK-B", "BERKSHIRE CLASS B") is None
    assert alias_clase("NVDA", "NVIDIA") is None


def test_universo_ausente(tmp_path):
    import pytest
    with pytest.raises(FileNotFoundError, match="iShares"):
        leer_universo(tmp_path / "no.csv")
