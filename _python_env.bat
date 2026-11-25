@REM Detecta el Python del entorno conda finvizanalysis.
@REM Lee primero config\python_exe.txt (lo escribe actualizar_entorno.py);
@REM si no existe o no es valido, busca en las rutas habituales de Anaconda.
@REM Uso:  call "%~dp0_python_env.bat"   ->  %PYTHON% definido o errorlevel 1.
@echo off
set PYTHON=
if exist "%~dp0config\python_exe.txt" set /p PYTHON=<"%~dp0config\python_exe.txt"
if defined PYTHON if exist "%PYTHON%" goto :encontrado
set PYTHON=
for %%R in ("%USERPROFILE%\.conda\envs" "%USERPROFILE%\anaconda3\envs" "%USERPROFILE%\miniconda3\envs" "C:\ProgramData\anaconda3\envs" "C:\ProgramData\miniconda3\envs") do (
    if exist "%%~R\finvizanalysis\python.exe" (
        set "PYTHON=%%~R\finvizanalysis\python.exe"
        goto :encontrado
    )
)
echo.
echo ERROR: no se encontro el Python del entorno finvizanalysis.
echo   Solucion: ejecuta una vez  python actualizar_entorno.py
exit /b 1
:encontrado
echo [entorno] Python: %PYTHON%
exit /b 0
