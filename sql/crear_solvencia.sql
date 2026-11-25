-- Tabla de puntos de solvencia (diseno_informatico.md 7).
-- {schema} y {tabla} los sustituye modulos/bd/logica.py con bd.database y bd.tabla.
-- Una fila por ejecucion semanal y ticker; los tickers sin ficha de Finviz no se guardan.
CREATE SCHEMA IF NOT EXISTS `{schema}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `{schema}`.`{tabla}` (
    fecha             DATE          NOT NULL COMMENT 'Fecha de inicio de la ejecucion semanal',
    ticker            VARCHAR(16)   NOT NULL,
    puntos_solvencia  DECIMAL(7,2)  NOT NULL COMMENT 'Puntos de la web con el screener solventes (incluye -99 por dilucion)',
    precio            DECIMAL(14,4) NULL     COMMENT 'Campo Price de la ficha de Finviz en la misma lectura',
    PRIMARY KEY (fecha, ticker),
    KEY ix_ticker_fecha (ticker, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
