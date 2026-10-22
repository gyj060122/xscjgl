@echo off
chcp 65001 >nul
title 开放 8080 端口（需要管理员权限）
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo [提示] 这个脚本需要管理员权限。
  echo 请右键点击本文件，选择「以管理员身份运行」。
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="xscjgl-server-8080" >nul 2>&1
netsh advfirewall firewall add rule name="xscjgl-server-8080" dir=in action=allow protocol=TCP localport=8080
if errorlevel 1 (
  echo [失败] 添加防火墙规则时出错。
) else (
  echo.
  echo 已开放 TCP 8080 端口，同一局域网内的同学现在可以访问了。
  echo 撤销方法（同样需要管理员权限）：
  echo   netsh advfirewall firewall delete rule name="xscjgl-server-8080"
)
echo.
pause >nul
