# Changelog — hermes-studio

记录每次代码改动：新增 (Added) / 优化 (Changed) / 修复 (Fixed)。新条目放最上面。

## [2026-10-08]
- 修复: 会话详情页消息不全（state.db 快照陈旧, 2341b44+1d946d8+3fd52a0）
- 修复: 新开 desktop 会话 resume 报 'Session not found' 被吞成 resume timeout（dbc5f9a）
- 修复: 活跃会话在 studio 冻结不更新（sessionMap 缓存永不刷新, 7928a1d）
- 新增: session 链路回归脚本 resume_matrix.js（每次更新必跑）
- 新增: 项目记忆面板 + 记忆注入诊断条（03dc639）
- 优化: 会话列表时间徽章显示最后消息时间而非创建时间（460d417）
