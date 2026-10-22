@echo off
chcp 65001 >nul
title 学生成绩管理系统 - 后端服务
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "C:\Users\admin\AppData\Local\nodejs\node.exe" set "NODE_EXE=C:\Users\admin\AppData\Local\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not defined NODE_EXE (
  echo.
  echo [错误] 没有找到 Node.js。
  echo 请先安装 Node.js（https://nodejs.org），或把 node.exe 放到 PATH 里。
  echo.
  pause
  exit /b 1
)

echo 正在启动服务，启动后请不要关闭这个窗口...
echo.
"%NODE_EXE%" server.js

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
