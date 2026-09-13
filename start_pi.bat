@echo off
chcp 65001 >nul
setlocal

rem 切换到脚本所在目录（项目根目录）
cd /d "%~dp0"

echo ==========================================
echo   how-pi-agent-works  启动器
echo ==========================================
echo.

rem 检查 Node.js / npm
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+：https://nodejs.org/
    pause
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请检查 Node.js 安装是否完整。
    pause
    exit /b 1
)

rem 首次运行自动安装依赖
if not exist "node_modules" (
    echo [提示] 未找到 node_modules，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
    echo.
)

echo 请选择要启动的内容：
echo   [1] 教学版 Agent ^(前端 5174 + API 4317^)
echo   [2] 教程站点 VitePress
echo   [3] 全部启动（两个新窗口）
echo   [0] 退出
echo.
set /p choice=请输入选项并回车 [默认 1]:

if "%choice%"=="" set choice=1

if "%choice%"=="1" goto run_agent
if "%choice%"=="2" goto run_docs
if "%choice%"=="3" goto run_all
if "%choice%"=="0" goto end
echo [提示] 无效选项，默认启动教学版 Agent。
goto run_agent

:run_agent
echo.
echo 正在启动教学版 Agent...
echo   前端：http://localhost:5174/
echo   API ：http://localhost:4317/
echo.
call npm run teaching-agent:dev
goto end

:run_docs
echo.
echo 正在启动教程站点...
call npm run docs:dev
goto end

:run_all
echo.
echo 正在新窗口中启动教学版 Agent...
start "teaching-agent" /d "%~dp0" cmd /k "npm run teaching-agent:dev"
echo 正在新窗口中启动教程站点...
start "docs" /d "%~dp0" cmd /k "npm run docs:dev"
echo.
echo 两个服务已在独立窗口启动，关闭对应窗口即可停止。
goto end

:end
endlocal
