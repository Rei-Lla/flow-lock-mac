@echo off
chcp 65001 >nul
title 心流锁定器 - 一键构建

echo.
echo  ==========================================
echo    心流强制锁定器 - Windows 一键构建脚本
echo  ==========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [!] 未检测到 Node.js，正在打开下载页面...
    echo  [!] 请安装后重新双击运行本脚本
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js 版本: %NODE_VER%

:: 进入脚本所在目录
cd /d "%~dp0"
echo  [..] 当前目录: %cd%
echo.

:: 安装依赖
echo  [1/3] 安装依赖中，请稍候...
call npm install >nul 2>nul
if %errorlevel% neq 0 (
    echo  [!] 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)
echo  [OK] 依赖安装完成
echo.

:: 构建
echo  [2/3] 构建项目中...
call npm run build >nul 2>nul
if %errorlevel% neq 0 (
    echo  [!] 构建失败
    pause
    exit /b 1
)
echo  [OK] 构建完成
echo.

:: 打包
echo  [3/3] 打包 EXE 中，这一步需要几分钟...
call npx electron-builder --win portable
if %errorlevel% neq 0 (
    echo  [!] 打包失败
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo    构建成功！
echo  ==========================================
echo.
echo  EXE 文件在 release 文件夹中
echo  正在打开文件夹...
echo.

:: 打开 release 文件夹
start "" "%~dp0release"

pause
