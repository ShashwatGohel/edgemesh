@echo off
TITLE EdgeMesh CDN Simulator - Master Control Launcher
COLOR 0F
CLS

echo ======================================================================
echo    EDGEMESH // MULTI-REGION CDN SIMULATOR ^& REAL-TIME MONITORING
echo ======================================================================
echo.
echo  [1] Start Complete System via Docker Compose (Recommended)
echo      - 3 Redis Caches (6379, 6380, 6381)
echo      - 3 Edge Nodes: Mumbai (4001), Delhi (4002), Singapore (4003)
echo      - Origin Server (5000), Registry (3002), Routing (3001), Gateway (3000)
echo      - Admin Dashboard (5173), Client App (5174)
echo.
echo  [2] Start Standalone Servers (No Docker, No PNPM workspace needed)
echo.
echo  [3] Stop Docker Containers
echo.
echo ======================================================================
echo.

set /p CHOICE="Select launch mode [1-3] (Default: 1): "
if "%CHOICE%"=="" set CHOICE=1

if "%CHOICE%"=="1" goto DOCKER_MODE
if "%CHOICE%"=="2" goto LOCAL_MODE
if "%CHOICE%"=="3" goto STOP_DOCKER
goto DOCKER_MODE

:DOCKER_MODE
echo.
echo [INFO] Building and starting all Docker services...
docker compose -f docker/docker-compose.yml up --build -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Compose failed to start. Ensure Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo  🚀 EDGEMESH SYSTEM IS UP AND RUNNING!
echo ======================================================================
echo   🖥️  Main Admin Dashboard : http://localhost:5173
echo   📱  Client Simulator App  : http://localhost:5174
echo   🔀  API Gateway           : http://localhost:3000
echo   📍  Routing Engine        : http://localhost:3001
echo   📑  Service Registry      : http://localhost:3002
echo   ☁️   Origin Server         : http://localhost:5000
echo   ⚡  Edge Mumbai           : http://localhost:4001 (Redis: 6379)
echo   ⚡  Edge Delhi            : http://localhost:4002 (Redis: 6380)
echo   ⚡  Edge Singapore        : http://localhost:4003 (Redis: 6381)
echo ======================================================================
echo.
echo Press any key to view container logs...
pause > nul
docker compose -f docker/docker-compose.yml logs -f
goto END

:LOCAL_MODE
echo.
echo [INFO] Launching standalone servers (no Docker required)...
call start-servers.bat
goto END

:STOP_DOCKER
echo.
echo [INFO] Stopping all Docker containers...
docker compose -f docker/docker-compose.yml down
echo [INFO] All containers stopped cleanly.
pause
goto END

:END
