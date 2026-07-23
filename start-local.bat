@echo off
TITLE EdgeMesh - Local Dev Launcher (No Docker)
COLOR 0A
CLS

echo ======================================================================
echo    EDGEMESH // LOCAL DEV MODE ^| NO DOCKER REQUIRED
echo ======================================================================
echo.
echo  Starting all services as separate processes...
echo  (Close individual windows to stop a service)
echo.
echo ======================================================================
echo.

REM ---- Build shared packages first ----
echo [1/9] Building shared packages...
call pnpm --filter "@edgemesh/shared-types" build >nul 2>&1
call pnpm --filter "@edgemesh/shared-utils" build >nul 2>&1
call pnpm --filter "@edgemesh/logger" build >nul 2>&1
echo       Done.
echo.

REM ---- Core Services ----
echo [2/9] Starting Origin Server        (http://localhost:5000)...
start "EdgeMesh | Origin Server" cmd /k "cd /d %~dp0 && set PORT=5000 && pnpm --filter @edgemesh/origin dev"

echo [3/9] Starting Registry Server      (http://localhost:3002)...
start "EdgeMesh | Registry Server" cmd /k "cd /d %~dp0 && set PORT=3002 && pnpm --filter @edgemesh/registry dev"

timeout /t 3 /nobreak >nul

echo [4/9] Starting Routing Engine       (http://localhost:3001)...
start "EdgeMesh | Routing Engine" cmd /k "cd /d %~dp0 && set PORT=3001 && set REGISTRY_URL=http://localhost:3002 && pnpm --filter @edgemesh/routing-engine dev"

echo [5/9] Starting API Gateway          (http://localhost:3000)...
start "EdgeMesh | API Gateway" cmd /k "cd /d %~dp0 && set PORT=3000 && set ROUTING_ENGINE_URL=http://localhost:3001 && set ORIGIN_URL=http://localhost:5000 && set REGISTRY_URL=http://localhost:3002 && pnpm --filter @edgemesh/gateway dev"

REM ---- Edge Nodes (no Redis - falls back gracefully) ----
echo [6/9] Starting Edge Node Mumbai     (http://localhost:4001)...
start "EdgeMesh | Edge Mumbai" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-mumbai&&set NODE_NAME=Edge Mumbai&&set REGION=Mumbai, India&&set LATITUDE=19.0760&&set LONGITUDE=72.8777&&set PORT=4001&&set BASE_URL=http://localhost:4001&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [7/9] Starting Edge Node Delhi      (http://localhost:4002)...
start "EdgeMesh | Edge Delhi" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-delhi&&set NODE_NAME=Edge Delhi&&set REGION=Delhi, India&&set LATITUDE=28.7041&&set LONGITUDE=77.1025&&set PORT=4002&&set BASE_URL=http://localhost:4002&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [8/14] Starting Edge Node Singapore  (http://localhost:4003)...
start "EdgeMesh | Edge Singapore" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-singapore&&set NODE_NAME=Edge Singapore&&set REGION=Singapore&&set LATITUDE=1.3521&&set LONGITUDE=103.8198&&set PORT=4003&&set BASE_URL=http://localhost:4003&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [9/14] Starting Edge Node London     (http://localhost:4004)...
start "EdgeMesh | Edge London" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-london&&set NODE_NAME=Edge London&&set REGION=London, UK&&set LATITUDE=51.5074&&set LONGITUDE=-0.1278&&set PORT=4004&&set BASE_URL=http://localhost:4004&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [10/14] Starting Edge Node Frankfurt  (http://localhost:4005)...
start "EdgeMesh | Edge Frankfurt" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-frankfurt&&set NODE_NAME=Edge Frankfurt&&set REGION=Frankfurt, Germany&&set LATITUDE=50.1109&&set LONGITUDE=8.6821&&set PORT=4005&&set BASE_URL=http://localhost:4005&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [11/14] Starting Edge Node New York   (http://localhost:4006)...
start "EdgeMesh | Edge New York" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-newyork&&set NODE_NAME=Edge New York&&set REGION=New York, USA&&set LATITUDE=40.7128&&set LONGITUDE=-74.0060&&set PORT=4006&&set BASE_URL=http://localhost:4006&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [12/14] Starting Edge Node Tokyo      (http://localhost:4007)...
start "EdgeMesh | Edge Tokyo" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-tokyo&&set NODE_NAME=Edge Tokyo&&set REGION=Tokyo, Japan&&set LATITUDE=35.6762&&set LONGITUDE=139.6503&&set PORT=4007&&set BASE_URL=http://localhost:4007&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

echo [13/14] Starting Edge Node Sydney     (http://localhost:4008)...
start "EdgeMesh | Edge Sydney" cmd /k "cd /d %~dp0\apps\edge-node && set NODE_ID=edge-sydney&&set NODE_NAME=Edge Sydney&&set REGION=Sydney, Australia&&set LATITUDE=-33.8688&&set LONGITUDE=151.2093&&set PORT=4008&&set BASE_URL=http://localhost:4008&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&pnpm dev"

REM ---- Frontend Apps ----
echo [14/14] Starting Admin Dashboard ^& Client App (5173, 5174)...
start "EdgeMesh | Admin Dashboard" cmd /k "cd /d %~dp0\apps\dashboard && pnpm dev"
start "EdgeMesh | Client App" cmd /k "cd /d %~dp0\apps\client && pnpm dev"

echo.
echo ======================================================================
echo  ALL SERVICES LAUNCHED IN SEPARATE WINDOWS!
echo ======================================================================
echo   Admin Dashboard  : http://localhost:5173
echo   Client App       : http://localhost:5174
echo   API Gateway      : http://localhost:3000
echo   Routing Engine   : http://localhost:3001
echo   Registry Server  : http://localhost:3002
echo   Origin Server    : http://localhost:5000
echo   Edge Mumbai      : http://localhost:4001
echo   Edge Delhi       : http://localhost:4002
echo   Edge Singapore   : http://localhost:4003
echo   Edge London      : http://localhost:4004
echo   Edge Frankfurt   : http://localhost:4005
echo   Edge New York    : http://localhost:4006
echo   Edge Tokyo       : http://localhost:4007
echo   Edge Sydney      : http://localhost:4008
echo ======================================================================
echo.
echo  NOTE: Redis cache is DISABLED in this mode. Edge nodes will fall
echo  back to local disk cache ^& direct origin fetches automatically.
echo.
echo  Close individual windows to stop specific services.
echo  Press any key in THIS window to STOP ALL services at once...
pause >nul

echo.
echo [STOP] Killing all EdgeMesh service windows...
taskkill /FI "WINDOWTITLE eq EdgeMesh*" /F >nul 2>&1
echo [STOP] All services stopped.
pause
