@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node 22 ou mais novo em https://nodejs.org
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
if errorlevel 1 (
  echo Node.js muito antigo. E necessario o Node 22 ou mais novo.
  node --version
  pause
  exit /b 1
)
if "%~1"=="" (
  node server.js serve
) else (
  node server.js %*
)
if errorlevel 1 pause
