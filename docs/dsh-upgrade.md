# DSH 升级说明

当前源码使用 [`dsh-v0.1.6-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1)。已安装应用的内置版本以该应用的发布说明为准。

## 新增功能

- 右侧栏增加 DSH 原生终端，支持多个标签、选择 Shell 和刷新后恢复。Start 页和新增标签菜单继续区分 DSH 与 Minke；Minke 文件管理器、终端、浏览器和底栏保持独立。
- Settings 可以查看、恢复已归档会话；文件、Skill 引用和交付文件默认在侧栏预览。附件入口合并到输入框的加号菜单。
- MCP 增加资源读取和 URI 模板；Headless 支持标准输入、恢复会话和 JSON 事件输出。SSH 远程工作区、Browser Use、Computer Use 和 Auto review 按上游方式配置，其中实验功能需要显式启用。
- 改进会话排序、分叉、重连、文件编辑卡片及长时间运行的显示。

## 升级时检查

**DeepSeek API 地址**：默认协议改为 Messages。若手动填写了旧官方根地址，移除该覆盖值，或改为 `https://api.deepseek.com/anthropic`。自定义服务地址保留原值。

**会话日志上报**：上游默认启用实验性 `session-log-deepseek`，使用 DeepSeek 适配器的官方 API 时，会随请求提交会话日志增量。若要关闭，在当前 Data Home 的 `profiles/web/cordis.patch.yml` 中加入以下配置，然后重启 Minke：

```yaml
- id: session-log-deepseek
  config:
    enabled: false
```

Data Home 的实际位置可在 Settings → Minke → Storage 中查看。保留文件内其他配置项。详见[上游日志上报说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/session/session-log-deepseek/README.md)。

**自定义插件和配置**：PTC 包与服务统一改为 `ptc-runtime`，没有旧名称别名；Node PTC 在独立进程中执行，模型代码的 `process.env` 为空。旧 workflow 改为 `workflow-ptc`，内置 E2B 后端移除，Ralph 默认关闭。依赖这些功能的配置需要调整。

**插件启动与恢复**：`agent/session-start` 被串行、异步的 `agent/created` 替代。可选插件启动失败不会阻止其他插件工作，必要插件失败仍会停止启动；热更新激活失败不再自动回滚全部修改。Minke 的安全模式和按插件禁用仍保留安装，修正配置后可以恢复启用。

[完整上游变更](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.2...dsh-v0.1.6-alpha.1)
