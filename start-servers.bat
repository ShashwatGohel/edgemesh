@echo off
TITLE EdgeMesh - Standalone Server Launcher
COLOR 0A
CLS

echo ======================================================================
echo    EDGEMESH // STANDALONE MODE ^| NO DOCKER REQUIRED
echo ======================================================================
echo.
echo  This launcher builds and starts all services as separate servers:
echo    [1] CORE SERVER   - Origin (5000) + Registry (3002)
echo                        + Routing (3001) + Gateway (3000)
echo    [2] EDGE MUMBAI   - Port 4001
echo    [3] EDGE DELHI    - Port 4002
echo    [4] EDGE SINGAPORE- Port 4003
echo    [5] DASHBOARD     - http://localhost:5173
echo    [6] CLIENT APP    - http://localhost:5174
echo.
echo ======================================================================
echo.

REM ─────────────────────────────────────────────────────────
REM  STEP 1: Install dependencies if node_modules missing
REM ─────────────────────────────────────────────────────────
echo [SETUP] Checking dependencies...

if not exist "%~dp0servers\core\node_modules" (
    echo [SETUP] Installing core server dependencies...
    cd /d "%~dp0servers\core"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install core dependencies. Ensure Node.js is installed.
        pause
        exit /b 1
    )
)

if not exist "%~dp0servers\edge-node\node_modules" (
    echo [SETUP] Installing edge-node dependencies...
    cd /d "%~dp0servers\edge-node"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install edge-node dependencies.
        pause
        exit /b 1
    )
)

if not exist "%~dp0apps\dashboard\node_modules" (
    echo [SETUP] Installing dashboard dependencies...
    cd /d "%~dp0apps\dashboard"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install dashboard dependencies.
        pause
        exit /b 1
    )
)

if not exist "%~dp0apps\client\node_modules" (
    echo [SETUP] Installing client app dependencies...
    cd /d "%~dp0apps\client"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install client app dependencies.
        pause
        exit /b 1
    )
)

echo [SETUP] Dependencies ready.
echo.

REM ─────────────────────────────────────────────────────────
REM  STEP 2: Build TypeScript
REM ─────────────────────────────────────────────────────────
echo [BUILD] Building Core Server (TypeScript)...
cd /d "%~dp0servers\core"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Core server build failed. Check TypeScript errors above.
    pause
    exit /b 1
)

echo [BUILD] Building Edge Node (TypeScript)...
cd /d "%~dp0servers\edge-node"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Edge node build failed. Check TypeScript errors above.
    pause
    exit /b 1
)

echo [BUILD] Build complete!
echo.

REM ─────────────────────────────────────────────────────────
REM  STEP 3: Start Redis containers (optional, requires Docker)
REM ─────────────────────────────────────────────────────────
echo [REDIS] Checking if Docker is available...
docker info >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [REDIS] Docker detected. Starting Redis containers...
    docker compose -f "%~dp0docker\redis.yml" up -d >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [REDIS] Redis containers started:
        echo          redis-mumbai    ^> localhost:6379
        echo          redis-delhi     ^> localhost:6380
        echo          redis-singapore ^> localhost:6381
        echo [REDIS] Waiting for Redis to be ready...
        timeout /t 3 /nobreak >nul
        set REDIS_ENABLED=1
    ) else (
        echo [REDIS] Failed to start Redis containers. Edge nodes will use MockRedis.
        set REDIS_ENABLED=0
    )
) else (
    echo [REDIS] Docker not available. Edge nodes will use MockRedis ^(in-memory^).
    set REDIS_ENABLED=0
)
echo.

REM ─────────────────────────────────────────────────────────
REM  STEP 4: Launch all servers in separate windows
REM ─────────────────────────────────────────────────────────
echo [LAUNCH] Starting Core Server (Origin + Registry + Routing + Gateway)...
start "EdgeMesh | CORE SERVER" cmd /k "cd /d %~dp0servers\core && node dist/index.js"

echo [LAUNCH] Waiting for Core Server to initialize...
timeout /t 4 /nobreak >nul

echo [LAUNCH] Starting Edge Node Mumbai  (Port 4001)...
start "EdgeMesh | EDGE MUMBAI" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-mumbai&&set NODE_NAME=Edge Mumbai&&set REGION=Mumbai, India&&set LATITUDE=19.0760&&set LONGITUDE=72.8777&&set PORT=4001&&set BASE_URL=http://localhost:4001&&set REDIS_URL=redis://localhost:6379&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node Delhi   (Port 4002)...
start "EdgeMesh | EDGE DELHI" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-delhi&&set NODE_NAME=Edge Delhi&&set REGION=Delhi, India&&set LATITUDE=28.7041&&set LONGITUDE=77.1025&&set PORT=4002&&set BASE_URL=http://localhost:4002&&set REDIS_URL=redis://localhost:6380&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node Singapore (Port 4003)...
start "EdgeMesh | EDGE SINGAPORE" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-singapore&&set NODE_NAME=Edge Singapore&&set REGION=Singapore&&set LATITUDE=1.3521&&set LONGITUDE=103.8198&&set PORT=4003&&set BASE_URL=http://localhost:4003&&set REDIS_URL=redis://localhost:6381&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node London    (Port 4004)...
start "EdgeMesh | EDGE LONDON" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-london&&set NODE_NAME=Edge London&&set REGION=London, UK&&set LATITUDE=51.5074&&set LONGITUDE=-0.1278&&set PORT=4004&&set BASE_URL=http://localhost:4004&&set REDIS_URL=redis://localhost:6382&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node Frankfurt (Port 4005)...
start "EdgeMesh | EDGE FRANKFURT" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-frankfurt&&set NODE_NAME=Edge Frankfurt&&set REGION=Frankfurt, Germany&&set LATITUDE=50.1109&&set LONGITUDE=8.6821&&set PORT=4005&&set BASE_URL=http://localhost:4005&&set REDIS_URL=redis://localhost:6383&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node New York  (Port 4006)...
start "EdgeMesh | EDGE NEWYORK" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-newyork&&set NODE_NAME=Edge New York&&set REGION=New York, USA&&set LATITUDE=40.7128&&set LONGITUDE=-74.0060&&set PORT=4006&&set BASE_URL=http://localhost:4006&&set REDIS_URL=redis://localhost:6384&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node Tokyo     (Port 4007)...
start "EdgeMesh | EDGE TOKYO" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-tokyo&&set NODE_NAME=Edge Tokyo&&set REGION=Tokyo, Japan&&set LATITUDE=35.6762&&set LONGITUDE=139.6503&&set PORT=4007&&set BASE_URL=http://localhost:4007&&set REDIS_URL=redis://localhost:6385&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Edge Node Sydney    (Port 4008)...
start "EdgeMesh | EDGE SYDNEY" cmd /k "cd /d %~dp0servers\edge-node && set NODE_ID=edge-sydney&&set NODE_NAME=Edge Sydney&&set REGION=Sydney, Australia&&set LATITUDE=-33.8688&&set LONGITUDE=151.2093&&set PORT=4008&&set BASE_URL=http://localhost:4008&&set REDIS_URL=redis://localhost:6386&&set ORIGIN_URL=http://localhost:5000&&set REGISTRY_URL=http://localhost:3002&&node dist/index.js"

echo [LAUNCH] Starting Admin Dashboard   (Port 5173)...
start "EdgeMesh | DASHBOARD" cmd /k "cd /d %~dp0apps\dashboard && npx vite --port 5173"

echo [LAUNCH] Starting Client App        (Port 5174)...
start "EdgeMesh | CLIENT APP" cmd /k "cd /d %~dp0apps\client && npx vite --port 5174"

echo.
echo ======================================================================
echo  ALL SERVICES LAUNCHED IN SEPARATE WINDOWS!
echo ======================================================================
echo.
echo   CORE SERVER:
echo     Origin Server    ^> http://localhost:5000/health
echo     Service Registry ^> http://localhost:3002/health
echo     Routing Engine   ^> http://localhost:3001/health
echo     API Gateway      ^> http://localhost:3000/health
echo.
echo   EDGE NODES:
echo     Edge Mumbai      ^> http://localhost:4001/health
echo     Edge Delhi       ^> http://localhost:4002/health
echo     Edge Singapore   ^> http://localhost:4003/health
echo     Edge London      ^> http://localhost:4004/health
echo     Edge Frankfurt   ^> http://localhost:4005/health
echo     Edge New York    ^> http://localhost:4006/health
echo     Edge Tokyo       ^> http://localhost:4007/health
echo     Edge Sydney      ^> http://localhost:4008/health
echo.
echo   FRONTENDS:
echo     Admin Dashboard  ^> http://localhost:5173
echo     Client App       ^> http://localhost:5174
echo.
echo   REDIS CACHE:
if "%REDIS_ENABLED%"=="1" (
    echo     redis-mumbai    ^> localhost:6379 (Docker/Real)
    echo     redis-delhi     ^> localhost:6380 (Docker/Real)
    echo     redis-singapore ^> localhost:6381 (Docker/Real)
) else (
    echo     All nodes using MockRedis (in-memory, Docker not detected)
)
echo.
echo ======================================================================
echo.
echo  Press any key in THIS window to STOP ALL services...
pause >nul

echo.
echo [STOP] Shutting down all EdgeMesh services...
taskkill /FI "WINDOWTITLE eq EdgeMesh*" /F >nul 2>&1
if "%REDIS_ENABLED%"=="1" (
    echo [STOP] Stopping Redis containers...
    docker compose -f "%~dp0docker\redis.yml" down >nul 2>&1
    echo [STOP] Redis containers stopped.
)
echo [STOP] All services stopped cleanly.
echo.
pause
