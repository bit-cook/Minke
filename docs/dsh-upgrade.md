# DSH 升级说明

当前源码使用 [`dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)。已安装应用的内置版本以该应用的发布说明为准。

## 本次同步

- 原生快捷键支持查看、搜索、自定义和恢复；进行中的对话可直接使用新启用的工具。
- 改善归档筛选、长对话加载、文档预览、语法高亮和审批提示。
- 修复异常退出后的插件安装、配置保存，以及部分长对话无法继续发送的问题。

## 升级至 rc.2

**会话与设置**：DSH 升级到 Session V4，并将旧 `settings.yaml` 设置迁入当前 Profile。升级前建议备份 Data Home；升级后的数据不适合交给旧版运行。Minke 保留原生 `llm-pi-ai` 配置入口，本地模型发现不会覆盖用户保存的模型配置。

**自定义插件**：新版会检查 DSH 依赖版本，不兼容的插件会跳过并提示。更新插件的版本约束及接口适配；涉及 Agent Preset、设置、文件二进制读取的插件需检查上游迁移说明。Inspector 不再默认提供，可按需安装。

**定时任务**：DSH 默认关闭定时任务与时间上下文；Minke 延续此前的启用配置，使用 DSH 自带的持久化任务服务。

## 此前同步的功能

- DSH 原生 Plugins 页面支持安装、配置和实时启停插件。Creator 模式通过 Plugin Manager 安装持久插件，移除原来的 Cordis 动态定义和执行工具。
- 对话回合结束后显示文件变更卡片，可在侧栏逐文件审阅；侧栏增加 Word、Excel、PowerPoint 预览，也可打开指定网址、Subagent 对话和提交的计划。
- 工作区按目录层级分组。刷新可恢复侧栏布局、右侧栏与底栏的终端连接、网页地址和文件草稿；发送第一条消息前也能使用文件预览与终端。
- 输入框菜单统一使用方向键选择、Enter 或 Tab 确认、Escape 关闭。上下文用量移到输入框底部，点击查看详情；思考内容采用紧凑 Markdown，轨迹和预览统一显示附件及缩略图。
- 改进 CLI 和 Web 启动速度、启动诊断及会话占用提示；修复重启后待处理 Inbox 消息恢复、视觉模型输入类型、Messages API 地址和历史工具输入兼容问题。

## alpha.2 升级时检查

**插件管理**：统一使用 DSH 原生 Plugins 页面。旧禁用列表会自动迁移到当前 Profile，并保留已安装插件；Minke 保留插件发现和安全模式恢复。

**自定义插件**：插件依赖改为运行时解析，Plugin Manager 支持运行时卸载。开发者需检查加载、依赖注入和资源释放逻辑。Client Sessions 支持多个实例共存，会话选择 API 和相关插槽已调整。

**Subagent 限制**：可续接子代理链默认最多同时保留 8 个子代理，委派深度为 1，可在设置中调整。

**模型列表**：默认列表移除 V4 Flash 和 V4 Flash Vision Exp；pi-ai 模型支持手动调整输入类型。

**终端权限**：右侧栏和底栏均使用 DSH 用户终端，以系统用户权限运行，独立于 Agent 的沙箱模式；两处共享 Minke 的字体、行距和代码配色设置。

**CLI**：可通过 `dsh <profile>` 启动指定 Profile。

## 从更早版本升级时检查

**DeepSeek API 地址**：默认协议改为 Messages。若手动填写了旧官方根地址，移除该覆盖值，或改为 `https://api.deepseek.com/anthropic`。自定义服务地址保留原值。

**会话日志上报**：上游默认启用实验性 `session-log-deepseek`，使用 DeepSeek 适配器的官方 API 时，会随请求提交会话日志增量。若要关闭，在当前 Data Home 的 `profiles/web/cordis.patch.yml` 中加入以下配置，然后重启 Minke：

```yaml
- id: session-log-deepseek
  config:
    enabled: false
```

Data Home 的实际位置可在 Settings → Minke → Storage 中查看。保留文件内其他配置项。详见[上游日志上报说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/session/session-log-deepseek/README.md)。

**自定义插件和配置**：PTC 包与服务统一改为 `ptc-runtime`，没有旧名称别名；Node PTC 在独立进程中执行，模型代码的 `process.env` 为空。旧 workflow 改为 `workflow-ptc`，内置 E2B 后端移除，Ralph 默认关闭。依赖这些功能的配置需要调整。

**插件启动与恢复**：`agent/session-start` 被串行、异步的 `agent/created` 替代。可选插件启动失败不会阻止其他插件工作，必要插件失败仍会停止启动；热更新激活失败不再自动回滚全部修改。安全模式和 DSH 原生禁用操作均保留安装，修正配置后可以恢复启用。

[完整上游变更](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.6-alpha.2...dsh-v0.1.7-rc.2)
