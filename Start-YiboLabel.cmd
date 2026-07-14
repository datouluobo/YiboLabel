@echo off
setlocal

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

set "PRINT_AGENT_PROJECT=%REPO_ROOT%\src\YiboLabel.PrintAgent\YiboLabel.PrintAgent.csproj"
set "DESKTOP_PROJECT=%REPO_ROOT%\src\YiboLabel.Desktop\YiboLabel.Desktop.csproj"
set "CLIENT_APP=%REPO_ROOT%\src\YiboLabel.App\ClientApp"
set "APP_PROJECT=%REPO_ROOT%\src\YiboLabel.App\YiboLabel.App.csproj"
set "DESKTOP_EXE=%REPO_ROOT%\src\YiboLabel.Desktop\bin\Debug\net10.0-windows\YiboLabel.Desktop.exe"
set "FRONTEND_INDEX=%REPO_ROOT%\src\YiboLabel.App\bin\Debug\net10.0-windows\wwwroot\index.html"

echo Stopping previous YiboLabel processes...
taskkill /F /IM YiboLabel.Desktop.exe >nul 2>nul
taskkill /F /IM YiboLabel.App.exe >nul 2>nul

echo Building x86 print agent...
dotnet build "%PRINT_AGENT_PROJECT%" -p:Platform=x86
if errorlevel 1 goto :fail

echo Building frontend...
pushd "%CLIENT_APP%"
call npm run build
if errorlevel 1 (
    popd
    goto :fail
)
popd

if not exist "%FRONTEND_INDEX%" (
    echo Frontend build output was not found:
    echo %FRONTEND_INDEX%
    goto :fail
)

echo Building app backend...
dotnet build "%APP_PROJECT%"
if errorlevel 1 goto :fail

echo Building desktop shell...
dotnet build "%DESKTOP_PROJECT%"
if errorlevel 1 goto :fail

if not exist "%DESKTOP_EXE%" (
    echo Desktop executable not found: %DESKTOP_EXE%
    goto :fail
)

echo Starting YiboLabel desktop window...
start "" "%DESKTOP_EXE%"

echo YiboLabel launch requested.
echo Frontend entry: %FRONTEND_INDEX%
exit /b 0

:fail
echo.
echo Launch failed.
exit /b 1
