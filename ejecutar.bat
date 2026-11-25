@echo off
REM ============================================================
REM  ejecutar.bat - Proceso semanal de solvencia (principal.py).
REM  Reenvia los argumentos:
REM      ejecutar.bat                  ejecucion completa con email
REM      ejecutar.bat --sin-email      todo menos el envio
REM      ejecutar.bat --solo-email     rehace y envia el informe de la ultima fecha
REM      ejecutar.bat --max-tickers 5  prueba con los 5 primeros tickers
REM      ejecutar.bat --comprobar      abre la web con dos tickers (sin BD ni email)
REM ============================================================
setlocal
set "DIR_PROYECTO=%~dp0"
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
echo  finviz_analysis - Solvencia semanal. Inicio: %DATE% %TIME%   Argumentos: %*
call "%DIR_PROYECTO%_python_env.bat"
if errorlevel 1 (endlocal & exit /b 1)
cd /d "%DIR_PROYECTO%"
"%PYTHON%" principal.py %*
set CODIGO=%ERRORLEVEL%
if "%CODIGO%"=="0" (echo  FIN CORRECTO: %DATE% %TIME%) else (echo  FIN CON ERROR ^(codigo %CODIGO%^): revisa C:\finvizanalysis\volatiles\logs)
endlocal & exit /b %CODIGO%
