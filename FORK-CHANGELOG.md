# FORK-CHANGELOG — 自研定制需求变更日志

> 用途：记录本 fork 相对上游（EKKOLearnAI/hermes-web-ui，已更名 Ekko Studio）的全部自研功能。
> 每次大版本 merge 冲突过多时，以本文件为蓝图在新 release 上重新二开。
> **约定：每合并一个新自研功能，必须同步更新此文件。**

## 快照

- 基准：上游 `upstream/main`
- 领先：19 commits（约 13 个功能/修复 + 5 个 merge 节点）
- 变更量：51 文件，+1771/-120
- 分支：`wcg/model-catalog-compat`（= fork main），部署走 8648 launchd `com.hermes.web-ui`

## 功能清单

### 移动端 / PWA

#### M1. iOS 键盘修复 boot.js + safe-area 样式
- **Commits**: b309237, 39850ba, 3c6b613
- **需求**：手机 PWA 键盘弹起遮挡输入框；iPhone 刘海屏 safe-area；触控区 36px
- **核心文件**：`packages/client/index.html`（viewport-fit=cover + boot.js）、`packages/client/public/boot.js`（visualViewport --vh 补偿）、`styles/_mobile.scss`、`styles/global.scss`
- **重二开要点**：boot.js 必须以 `<script defer>` 进 index.html head；`_mobile.scss` 经 `global.scss @use` 引入

#### M2. 壳 Service Worker + 缓存策略
- **Commit**: 39850ba
- **需求**：公网/弱网秒开；hashed 资产 cache-first、shell network-first、多账号缓存隔离
- **核心文件**：`packages/client/public/sw.js`、`packages/server/src/modules/studio/middleware/static-cache.ts`（ETag/304/缓存头）、`api/client.ts`（GET 去重）、`tests/server/static-cache.test.ts`
- **坑**：升级后浏览器可能压旧 chunk——发版后提醒用户强刷

### 模型目录

#### C1. Codex 目录格式兼容
- **Commit**: 2b38b13
- **需求**：cc-switch 类 provider 的 catalog 是 `{models:[...]}` 而非 OpenAI `{data:[...]}`，两者都要解析
- **核心文件**：`packages/server/src/modules/studio/public/provider-catalog.ts`

#### C2. 模型目录 provider 白名单
- **Commit**: 09fc1e6
- **需求**：线上只显示指定 provider/model（plist 环境变量驱动，空=不过滤，其它部署零影响）
- **核心文件**：`packages/server/src/modules/hermes/controllers/models.ts` — `applyProviderAllowlist()`，接入 getAvailable 全部 3 条返回路径 + `getAvailableModelGroupsForProfile`
- **运行时配置**：plist 环境变量 `HERMES_STUDIO_PROVIDER_ALLOWLIST`（改显示列表只改 plist + 重启，不重建）
- **为什么不用上游 modelVisibility**：那是 fail-open（规则失配回退全显），且藏不住整个 provider

### 会话

#### S1. Chat 侧栏显示 desktop 会话 + 历史加载
- **Commit**: 704732c
- **需求**：Chat 页侧栏显示 desktop（state.db）会话并可加载全部消息（4 处 patch：列表合并 desktop 组 + Socket.IO resume 回退读 state.db）
- **核心文件**：`stores/hermes/chat.ts`、`controllers/sessions.ts`、`sessions-db.ts`
- **参考**：`references/chat-sidebar-desktop-merge.md`

#### S2. 压缩链分段导航 + 幽灵会话修复
- **Commits**: 129b7c2, bfb70c4
- **需求**：desktop 会话 compaction 后新建会话 ID 续链——①时间戳竞态（child 早于父 26-48ms，2s 容差 `COMPRESSION_CONTINUATION_SKEW_SECONDS`）②studio 本地库陈旧快照产生幽灵条目（`listCompressionChainSessionIds` 过滤 + `withContinuation` 附链尾）；UI 横幅显示"N segments · viewing segment X"可跳转
- **核心文件**：`hermes/services/history/sessions-db.ts`、`MessageList.vue`、`stores/hermes/chat.ts`（threadSessionCount/threadIndex）、i18n `threadSegments`
- **完整根因**：`references/compression-continuation-chain.md`

### 工作区 / 多目录（codex 式）

#### W1. 会话级多目录（v1 基础设施）
- **Commit**: e87a7bd
- **需求**：会话支持主目录+附加目录；codex 仅非 resume 启动追加 `--add-dir`（resume 不支持），claude-code 每次追加
- **核心文件**：`schemas.ts`（`workspace_extra_dirs` JSON 列）、`session-store.ts`（bind 前必须 JSON.stringify）、`controllers/sessions.ts` `setWorkspace`、`coding-agents/services/index.ts`（extraDirs→launch）、`run-manager.ts`（codex 非 resume 分支 append）、`sockets/chat-run.ts` 透传
- **坑**：codex resume 与新建共用 commonArgs，`--add-dir` 只能加在新建分支拼接处

#### W2. Hermes Project 绑定 + 目录搜索（v2）★
- **Commits**: cfc1767, aebadd0, 10de4ea
- **需求**：绑定 hermes core 的 Project（projects.db 多目录工作区）一键填主目录+附加目录；"添加目录"支持按名称搜索后再选
- **核心文件**：
  - 服务端：`services/projects/projects-db.ts`（只读 projects.db）、`routes/projects.ts`（`GET /api/studio/projects` + `GET /api/studio/projects/dir-search` 限定深度模糊搜索，剪枝 node_modules/Library 等）、`bootstrap/routes.ts` 注册
  - 客户端：`DirSearchPicker.vue`（remote-search NSelect + 可删 chips）、`ChatPanel.vue`（新建会话弹窗项目下拉+extra dirs 传参；工作区弹窗项目下拉+搜索/浏览切换；右键入口同行为）
  - i18n：`workspaceProject/workspaceProjectPlaceholder/workspaceProjectEmpty/dirSearchPlaceholder/dirSearchToggle`（en/zh/zh-TW）
- **设计约束**：**无写端点**——项目增删只在 hermes 侧 `hermes project ...`，避免双头写
- **依赖**：hermes-agent fork 的 Project 感知（见 hermes-agent/FORK-CHANGELOG.md #3）——hermes 原生 agent 按 cwd 自动获得 workspace map；studio spawn cwd=session workspace 故天然命中

### 杂项

- **X1** `fe334cf` 新建会话 agent 下拉只显示已安装 agent（`fetchAgentAvailabilitySnapshot` 过滤）
- **X2** `bad7bcc` 删 API relay 侧栏菜单；新建/搜索并排布局（`PageSidebarNav.vue`）
- **X3** `39850ba` 启动 API 去重 + monaco 懒加载（FileEditor.vue onMounted 动态 import，3.7MB chunk 移出首屏）
- **X4** `704732c` 期间的项目基建：`routes/projects.ts` 等已含在 W2

## 已知上游改名风险

上游 0.7.18 起更名 Ekko Studio（品牌文案/组件前缀 ekko-*）。重二开时注意：
- `index.html` 标题/品牌保持 "Hermes Studio"（0.7.18 merge 已按"双方保留"处理过一次）
- `ekkoMemoryRoutes/ekkoSkillRoutes/ekkoMcpRoutes/ekkoConfigRoutes` 是上游路由组名，引用即可勿重命名

## 重新二开操作要点

1. **构建链**：`npm install --include=dev`（.npmrc omit=dev 会砍掉 vue-tsc）→ `npm run build`；Node ≥22（node:sqlite）
2. **DB 兼容**：`workspace_extra_dirs` 列由 syncTable 自动 ALTER，无手写迁移
3. **部署**：`launchctl bootout + bootstrap`（kickstart -k 不重读 plist）；bootstrap 偶发 5 I/O error 隔几秒重跑
4. **push**：必须 SSH URL `git@github.com:wuchuguang/hermes-studio.git`；fetch 走 ghfast.top+代理 7890
5. **验证**：本地 8648 + 公网 hermes.aiwzd.vip 双查；`scripts/verify-model-catalog.py` 核对模型白名单
6. 会话数据两层库：`~/.hermes/state.db`（desktop/hermes 真源）+ `~/.hermes-web-ui/hermes-web-ui.db`（studio 本地），侧栏/历史逻辑都在做两者合并——重写时先读 `references/desktop-studio-sync.md`

## 验证命令

```bash
cd ~/git-repo/hermes-studio
npm run build                                    # vue-tsc 全量类型检查 + 构建
packages/server && npx tsc --noEmit -p tsconfig.json
# API 冒烟：登录拿 JWT → GET /api/studio/projects、/api/studio/projects/dir-search?q=xxx
```
