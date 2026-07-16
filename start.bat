@echo off
chcp 65001 >nul
echo ============================================
echo   课题组库存管理系统 - 启动服务
echo ============================================
echo.
echo 第一步：安装依赖（仅首次需要）
cd /d "%~dp0"
call npm install --registry=https://registry.npmmirror.com
echo.
echo 第二步：启动服务器
echo 本机访问: http://localhost:3000
echo 局域网访问: http://%COMPUTERNAME%:3000 （其他人输这个地址）
echo 注意: 关掉这个窗口服务就停了
echo.
echo 按 Ctrl+C 停止服务
echo ============================================
echo.
npm start
pause
