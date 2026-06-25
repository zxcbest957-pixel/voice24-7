@echo off
title Discord Voice 24/7 Idler (Self-bot)
echo ===================================================
echo Discord Voice 24/7 Idler Setup and Launcher
echo ===================================================

:: Check if python launcher (py) or python is installed
set PYTHON_CMD=py
where py >nul 2>nul
if %errorlevel% neq 0 (
    set PYTHON_CMD=python
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Python is not installed or not in PATH!
        echo Please install Python 3.8+ and make sure to check "Add Python to PATH" during installation.
        pause
        exit /b
    )
)

:: Check for .env file configurations
if not exist .env (
    echo [WARNING] .env file not found! Creating template...
    echo # Discord Account Credentials - User Token, not bot token > .env
    echo DISCORD_TOKEN=YOUR_DISCORD_ACCOUNT_TOKEN_HERE >> .env
    echo CHANNEL_ID=YOUR_VOICE_CHANNEL_ID_HERE >> .env
    echo SELF_MUTE=True >> .env
    echo SELF_DEAF=True >> .env
    echo KEEP_ALIVE=True >> .env
    echo PORT=8080 >> .env
    echo [INFO] Created .env template. Please fill in your DISCORD_TOKEN and CHANNEL_ID before running again.
    pause
    exit /b
)

findstr /C:"YOUR_DISCORD_ACCOUNT_TOKEN_HERE" .env >nul
if %errorlevel% equ 0 (
    echo [WARNING] Please update the DISCORD_TOKEN in your .env file with your actual account token!
    pause
    exit /b
)

findstr /C:"YOUR_VOICE_CHANNEL_ID_HERE" .env >nul
if %errorlevel% equ 0 (
    echo [WARNING] Please update the CHANNEL_ID in your .env file with your target voice channel ID!
    pause
    exit /b
)

:: Create virtual environment if it doesn't exist
if exist .venv goto :venv_exists
echo [INFO] Creating Python virtual environment venv...
%PYTHON_CMD% -m venv .venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment!
    pause
    exit /b
)
:venv_exists

:: Install requirements
echo [INFO] Installing/updating packages from requirements.txt...
.venv\Scripts\pip install --upgrade pip
.venv\Scripts\pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install requirements!
    pause
    exit /b
)

echo [INFO] Environment successfully configured.
echo Starting Discord Voice 24/7 Idler (Self-bot)...
echo ---------------------------------------------------

.venv\Scripts\python.exe bot.py

pause
