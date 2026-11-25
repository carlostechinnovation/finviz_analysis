@echo off
REM ============================================================
REM  run_solvencia_auto.bat - Envoltorio DESATENDIDO para Task Scheduler.
REM  "< nul": ninguna pausa espera a una tecla. Reenvia los argumentos.
REM ============================================================
call "%~dp0..\ejecutar.bat" %* < nul
exit /b %ERRORLEVEL%
