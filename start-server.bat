@echo off
setlocal
title Zaban Invoice Server
pushd "%~dp0"
if errorlevel 1 (
    echo ERROR: Cannot open the application folder.
    pause
    exit /b 1
)

set "NODE_EXE=%~dp0runtime\node.exe"
if exist "%NODE_EXE%" goto node_ready
set "NODE_EXE=node.exe"
where node.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or is missing from PATH.
    echo Install Node.js, then open this file again.
    popd
    pause
    exit /b 1
)

:node_ready
if not exist "node_modules\priority-web-sdk\package.json" (
    echo ERROR: Application dependencies are missing.
    echo Extract the complete portable package, including node_modules.
    popd
    pause
    exit /b 1
)
if not exist ".env" (
    echo ERROR: Missing .env configuration file in the application folder.
    echo Copy your existing .env here before starting the server.
    popd
    pause
    exit /b 1
)
echo Starting Zaban Invoice Server...
echo Keep this window open while using the application.
echo Close this window to stop the server, or press Ctrl+C.
echo The server will print its address and logs below.
echo.
"%NODE_EXE%" server.js
set "SERVER_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Server stopped. Exit code: %SERVER_EXIT_CODE%
popd
pause
exit /b %SERVER_EXIT_CODE%
