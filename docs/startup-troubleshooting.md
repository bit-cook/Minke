# Minke 启动与页面加载故障

本文适用于包含 [#18 修复](https://github.com/lencx/Minke/issues/18) 的构建。已发布的 Minke v0.5.0 不支持下文的超时环境变量。

## 页面加载失败后重试

Minke 分别等待本地 DSH 进程启动和窗口页面加载，这两个阶段的默认超时均为 90 秒。

如果窗口页面超时或加载失败，选择 **重新加载 / Reload** 可以再试一次。每次重试都会获得完整的页面加载等待时间，并复用已经启动的 DSH 进程。选择 **退出 Minke / Quit Minke** 则正常退出应用。

## 延长等待时间

完全退出 Minke 后，可以通过环境变量调整下一次启动的等待时间。单位为毫秒：

| 环境变量 | 控制的阶段 | 默认值 |
| --- | --- | --- |
| `MINKE_HARNESS_NAVIGATION_TIMEOUT_MS` | 窗口页面加载 | `90000` |
| `MINKE_HARNESS_STARTUP_TIMEOUT_MS` | 本地 DSH 进程启动 | `90000` |

例如，`180000` 表示等待 3 分钟。两个变量独立生效；空值采用默认值。值必须是 `1` 到 `2147483647` 之间的整数，非法值会显示配置错误。

### Windows

在 PowerShell 中设置变量，然后在同一个终端启动 Minke。将下面的路径替换为实际的 `Minke.exe` 路径，可以从快捷方式属性中查看：

```powershell
$env:MINKE_HARNESS_NAVIGATION_TIMEOUT_MS = "180000"
& "C:\实际安装目录\Minke.exe"
```

如果需要从桌面快捷方式启动时也采用此设置，可以保存为用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable("MINKE_HARNESS_NAVIGATION_TIMEOUT_MS", "180000", "User")
```

注销并重新登录 Windows 后再启动 Minke，使桌面进程继承新设置。恢复默认值时删除该用户变量，然后重新登录：

```powershell
[Environment]::SetEnvironmentVariable("MINKE_HARNESS_NAVIGATION_TIMEOUT_MS", $null, "User")
```

### macOS 和 Linux

从终端启动实际的应用可执行文件，并为该次启动设置变量。例如 macOS 默认安装位置：

```sh
MINKE_HARNESS_NAVIGATION_TIMEOUT_MS=180000 /Applications/Minke.app/Contents/MacOS/Minke
```

Linux 使用相同的环境变量前缀，将后面的路径替换为已安装的 Minke 可执行文件或 AppImage。

## 仍然无法启动

提交反馈时，请记录 Minke 版本、操作系统、完整错误信息、设置的超时值，以及重新加载后是否成功。`Harness window navigation did not finish` 表示窗口页面加载超时；`Harness did not become ready` 表示 DSH 进程尚未报告就绪，应调整相应阶段的变量。

这些设置不会迁移、清空或修改会话数据。若延长等待后仍稳定失败，需要结合具体错误继续排查。
