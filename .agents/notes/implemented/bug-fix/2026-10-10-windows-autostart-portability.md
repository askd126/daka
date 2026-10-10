# Agent Note: Windows 自启脚本使用安装目录

Status: implemented

## Problem

计划任务安装脚本写死了开发机路径，其他 Windows 安装目录无法注册正确的自启命令。启动脚本检测到端口未监听时只写日志，计划任务仍可能显示成功。

## Decision

安装时用 `$PSScriptRoot` 定位同目录的启动脚本。等待 Docker 后若服务端口仍未监听，以非零退出码报告失败。

## Alternatives considered

要求用户手动改绝对路径不需要改脚本，但安装步骤容易漏改，仓库发布后无法开箱使用。

## Consequences

仓库可以克隆到任意 Windows 路径；启动失败会在任务计划程序中留下失败结果，便于排查。服务仍在用户登录后启动，且不自动打开浏览器。

## Verification

PowerShell Parser 对两个 `.ps1` 文件的语法检查无错误。
