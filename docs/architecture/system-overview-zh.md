# Hermes Studio 系统架构总览

> 适用版本：v0.7.17（fork `wuchuguang/hermes-studio`，分支 `wcg/model-catalog-compat`）
> 生成日期：2026-09-05。基于源码实测梳理，非上游文档翻译。

## 1. 一句话定位

TypeScript monorepo：浏览器仪表盘（Vue 3）+ Koa 后端 + Electron 桌面壳，围绕 Hermes Agent 及外部 coding agent（Codex/Claude Code/Grok/Pi）提供聊天、编排、运维能力。本 fork 额外承担移动端 PWA 与单机多端会话同步。

## 2. 进程与端口拓扑（本机实际部署）

```
手机/浏览器
   │ https
   ▼
hermes.aiwzd.vip ── 43 nginx ── SSH隧道 ──► Mac:8648
                                            │
                    launchd com.hermes.web-ui
                    node ~/git-repo/hermes-studio/dist/server/index.js
                    （fork 构建，非 npm 全局包）
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
  hermes gateway:8642   hermes CLI 子进程    desktop backend:52805
  （agent 桥接）        （spawn per run）    （Electron 侧）
        └───────── 共享 ~/.hermes/state.db ─────────┘
```

- Web UI 自有状态：`HERMES_WEB_UI_HOME=~/.hermes-web-ui`（hermes-web-ui.db + 上传/运行时目录）
- Hermes Agent 状态：`~/.hermes/`（state.db / config.yaml / memories / skills），与 Web UI 状态严格分离
- 改 plist 后必须 `bootout+bootstrap`（`kickstart -k` 不重读配置）

## 3. 包边界

| 包 | 体积 | 职责 |
|---|---|---|
| `packages/client` | 7.6M src | Vue 3 + Vite + Naive UI + Pinia(14 stores) + vue-i18n(11 语言)。30+ views（Chat/History/Models/Skills/MCP/Kanban/Jobs/GroupChat/Workflow/Memory/Terminal/Journey/Files/Devices…） |
| `packages/server` | 6.7M src | Koa HTTP + Socket.IO + node:sqlite（DatabaseSync）。4 个业务模块 + bootstrap 组合层 |
| `packages/ekko-agent` | 1.7M | 内置 Ekko agent 运行时：conversations/memory/model/runtime/skills/tools |
| `packages/desktop` | — | Electron 壳：拉起本地 Web UI、捆绑 Python/Hermes 运行时、更新器、命令 shims（`hermes-studio cli/web/mcp`） |
| `tests` + `.github/workflows` | — | Vitest 单测/集成 + Playwright e2e；CI 含 build、Docker、桌面发布 |

## 4. 服务端模块分层（硬规则：routes 薄、controllers 验参、services 持有副作用）

```
packages/server/src/
├── bootstrap/            # 唯一允许做模块组合的层（~21 个 adapter）
│   ├── routes.ts         # 汇总全部路由模块；本地 API 必须先于代理 catch-all 注册
│   ├── http.ts / lifecycle.ts / update.ts / health.ts
│   └── *-adapter.ts      # chat/group-chat/session/workflow/agent 等运行时适配
└── modules/
    ├── studio/           # Web UI 自身业务（最厚）
    │   ├── routes/ → controllers/ → services/ → repositories/(21 个 store) → infrastructure/database
    │   ├── sockets/      # chat-run.ts(核心) / group-chat / global-agent / workflow / pet-state
    │   ├── middleware/   # legacy-app-api.ts：App/MCU 固件 URL 兼容映射（唯一出口）
    │   └── services/     # auth / chat-run / workflow / group-chat(含 handoff、context-engine)
    │                     # / files / usage / webhooks / voice / social-messages / theme …
    ├── hermes/           # 对 Hermes Agent 的管理面：profiles/skills/plugins/memory
    │                     # /models/providers/config/jobs/cron/kanban
    │   ├── routes/       # 含 6 家 OAuth（codex/nous/copilot/xai/anthropic/minimax）
    │   └── sockets/      # kanban-events / terminal
    ├── coding-agents/    # 外部 CLI agent 编排（见 §6）
    └── nekko/            # ekko 轻量变体
```

## 5. 数据所有权

| 库 | 位置 | 归属 | 关键表 |
|---|---|---|---|
| hermes-web-ui.db | `~/.hermes-web-ui/` | studio 自有（node:sqlite 直写） | sessions/messages/session_categories/session_usage、users/user_profiles（scrypt 账号体系）、workflows + workflow_runs/schedules、**gc_***（群聊 rooms/members/messages/handoff 链/context 快照/执行队列）、mcu_devices、app_connections、chat_webhook_endpoints、skill_usage、stt/tts、model_context、provider_audit、workspace_run_changes |
| state.db | `~/.hermes/` | Hermes Agent 正典库 | studio **只读合并**进 Chat 侧栏（desktop 会话），resume 时回退读消息 |

Schema 演进：`infrastructure/database/schemas.ts` 集中声明 + `syncTable()` 启动时自动建表/ALTER 补列（如新增 `sessions.workspace_extra_dirs` 无需迁移脚本）。

## 6. 聊天运行链路（核心）

### 6.1 两类执行引擎

```
run.start (Socket.IO /chat-run)
   │
   ├─ hermes 桥接会话 ──► ensureBridgeReadyForChatRun → createPrimaryAgentBridge
   │                      spawn hermes 子进程（source=api_server，写回 state.db）
   │
   └─ coding agent 会话（isCodingAgentExecution）
        handle-coding-agent-run.ts → startCodingAgentRun
        │
        ├─ resolveStoredProviderLaunchInput   # 凭据回填：config.yaml/.env/自定义 provider
        ├─ prepareCodingAgentLaunch           # 每 provider 分支写隔离运行时配置
        │    ├─ codex:  CODEX_HOME=rootDir + config.toml(model_provider=custom
        │    │         → 指向本 server 的 codex-proxy 路由) + 模型目录 + AGENTS.md
        │    ├─ claude: settings.json + mcp.json + hermes-rules.md
        │    ├─ grok:   GROK_HOME 影子目录     └─ pi: RPC 模式 + studio extension
        ├─ runtime/run-manager.ts             # 子进程生命周期/流解析/恢复
        └─ updateSession                     # workspace / agent_native_session_id 等回写
```

要点：
- **凭据代理**：scoped 模式下 API key 不落 CLI 配置，走 server 内建 `codex-proxy` / claude 代理路由，`experimental_bearer_token` 指向代理。
- **恢复机制**：`codex exec resume <id>` / claude `--resume`；resume 与新启的参数能力不同（如 codex resume 不支持 `--add-dir`，沙箱沿用首次启动）。
- 队列：会话忙碌时 `state.queue` 排队（`run.queued` 事件），后台委派（delegation）复用同一队列。

### 6.2 会话工作区（含 fork 多目录扩展）

| 字段 | 语义 | 消费方 |
|---|---|---|
| `sessions.workspace` | 主目录（cwd） | `--cd` / spawn cwd / 文件面板根 |
| `sessions.workspace_extra_dirs`（fork 新列，JSON 数组） | 附加读写目录 | codex 非_resume 启动 → `--add-dir`（可重复）；claude 每次启动；hermes/pi/grok 仅存储展示 |

链路：ChatPanel 弹窗（主 FolderPicker + 附加目录列表）→ `POST /sessions/:id/workspace` → 启动时 `resolveStoredProviderLaunchInput` 兜底读行 → `normalizeExtraDirs`（去重/滤主目录）→ spawn args。

## 7. 客户端结构

- `views/hermes/` 30+ 路由级页面；`components/hermes/`（chat 系 ChatPanel 4400 行为最大单件）
- `stores/hermes/` 14 个 Pinia store（chat 为核心：sessions/messages/queue/approvals/subagent 流）
- `api/`：`client.ts` 统一 request（Bearer = localStorage `hermes_api_key`）+ studio/hermes/ekko/coding-agents 四组
- 移动端：`_mobile.scss`（safe-area/36px 触控）+ `boot.js`（iOS 键盘 visualViewport 补偿）+ viewport-fit

## 8. 本 fork 定制清单（vs upstream）

| commit | 内容 |
|---|---|
| 3c6b613/b309237 | 移动端 PWA 增强（safe-area、键盘补偿） |
| —（分支基线） | cc-switch `{models:[...]}` 模型目录兼容 |
| 704732c | Chat 侧栏合并 desktop 会话（state.db 只读 + resume 回退） |
| fe334cf | 新建对话 agent 下拉仅显示已安装（`/api/agents/availability`） |
| bad7bcc | 删 API 中转（饲料）菜单；新建/搜索左右布局 |
| 进行中 | 多目录工作区（服务端+客户端已完成，i18n zh-TW/build/部署剩余） |

维护策略：定制全部固化在 fork 源码，升级 = `merge upstream/main` → `npm install --include=dev` → `npm run build`；push 仅走 SSH remote。

## 9. 安全边界

- 账号：users 表 scrypt（salt:key64），Bearer token 鉴权；profile 级访问控制（user_profiles + denySessionAccess）
- 文件访问：workspace 根受 `WORKSPACE_BASE` 约束，`isPathWithin` 防穿越；FolderPicker 服务端二次校验
- 子进程：参数数组传递（无 shell 拼接）；scoped 模式 `isolatedCodingAgentChildEnv` 隔离环境变量
- 凭据：不入库、不落盘到 CLI 配置目录，经内存代理路由下发

## 10. 快速排障索引

| 症状 | 先查 |
|---|---|
| 8648 拒连 | `launchctl print gui/501/com.hermes.web-ui`；bootstrap 偶发 I/O error 重试即可 |
| 构建后行为未变 | vite 缓存 → `rm -rf node_modules/.vite dist/client`；`.npmrc omit=dev` → `npm install --include=dev` |
| Chat 侧栏无 desktop 会话 | 先看分组折叠（localStorage `hermes_collapsed_groups`），再查 state.db 可读性 |
| coding agent 凭据错 | resolveStoredProviderLaunchInput 链：UI 传入 → session 行 → config.yaml → .env → provider preset |
| push 报 could not read Username | 用 SSH remote（ghfast.top 无凭据） |
