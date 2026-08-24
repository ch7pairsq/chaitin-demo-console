# 开发联调问题与处理摘要

用于答辩说明：以下内容只记录问题分类、根因与处理结论；不包含私钥、Token、Key、IOC、样本或生产日志正文。

| 类别 | 实际问题与根因 | 处理与当前结论 |
|---|---|---|
| Agent Compose 配置 | 项目配置沿用了 Docker Compose 风格的顶层 `version: 1`，当前 Agent Compose 解析器不接受该字段；部分字段名、层级和类型也与 Docker Compose 不兼容。 | 先以最小配置做 schema 解析，移除不兼容顶层字段，再逐项加入模型、工作区、工具、触发器和调度配置。结论：Agent Compose 是 Agent 项目声明，不是通用 Docker Compose。 |
| 可选环境变量 | 配置语法已经解析到环境变量阶段，但可选 LLM / OctoBus 变量未在 Guest 进程显式定义，导致运行时校验失败。 | schema 验证阶段显式传入空值，仅验证变量声明和结构；真实联调时通过服务器 Secret / `.env` 注入有效值。不能把“空值通过 schema”误表述为“已完成网关联调”。 |
| LLM 401 | Guest 中模型请求返回 401。排查确认通用 `LLM_API_KEY` 被 agent-compose runtime facade 占用/覆盖，而非 DeepSeek Key 本身无效。 | 改用项目私有变量 `MALWARE_TRIAGE_LLM_API_KEY`，代码优先读取该变量；变量缺失、超时或解析失败均回退确定性摘要。该优先级已有自动化测试。 |
| 沙箱运行时连通性 | Guest 已启动，但缺少 `AGENT_COMPOSE_RUNTIME_BASE_URL` 时，Guest 无法访问 Agent Compose 运行时 facade。 | Stack 中提供容器内地址 `http://agent-compose:7410`；更新 Stack 后需重新启动 Guest 复验。该问题属于运行时网络/配置，不等同于模型 Key 或模型服务故障。 |
| 降级定位 | 单看“模型失败”无法区分模型 HTTP 错误、模型超时、Guest 到 facade 网络不可达或输出格式错误。 | 按 `trace_id` 留存状态、失败类别和最终 narration source：模型超时/HTTP/格式错误走 LLM fallback；Guest/facade 不可达属于运行时网络问题；两者均不会改变确定性规则动作。 |
| OctoBus 审计追踪 | 普通 `access.log` 未直接按 `trace_id` 提供完整可检索记录，难以仅靠一类日志完成链路证明。 | 以 Agent SQLite 状态快照、Connect RPC 调用记录、Mock/能力审计和控制台结构化展示交叉核验；生产答辩前还需按实际 OctoBus 专用审计查询方式核验 trace 检索能力，不能只凭普通访问日志宣称完成。 |
| Capset 令牌 | schema 阶段不能确定网关是否要求 Capset 专用 Token；过早写入通用 Token 会掩盖授权边界问题。 | 先验证变量/调用契约，再以 OctoBus 返回结果决定是否启用对应 Capset 的最小权限 Token。Token 只通过服务器 Secret 注入，不写入 Git、页面或日志。 |
| Portainer Stack 更新 | Stack 由 Portainer 管理时，引用本机构建上下文、非兼容字段或宿主机路径会造成更新失败或 500。 | 发布改为 Git Workspace + 已构建镜像；Stack 只声明服务、卷、网络和 Secret 引用。先做 Compose config/预览，再更新 Stack。 |
| VirusTotal 浏览器查询 | 无账号页面查询会触发人机验证或页面卡住，不能把它作为稳定自动化依赖。 | MVP 改用离线样本库和预生成/模拟的脱敏报告；仅在受控、单条、可跳过队列中补全哈希，不上传样本。 |
| 私钥与敏感数据 | 远程联调需要本机 PEM，存在误复制、误提交或被进程读取的风险。 | 私钥 ACL 已收紧为仅本机 `eversec` 账户可读；私钥不上传服务器、仓库、模型、页面或日志。样本、IOC、Token 采用同样的最小暴露原则。 |
| 知识库实践性 | 若知识仅写在文档、阈值无依据或移除知识后输出不变，无法证明其参与决策。 | 增加规则溯源字段、已知误判边界、人工复核条件和知识消融测试；工作台只展示脱敏证明，真实案例统计仍在私有台账中查验。 |

## 答辩总结

> 联调过程中没有把“能启动”当作“全链路完成”。我们将问题分为配置 schema、Secret 注入、Guest 运行时、模型调用、OctoBus 授权与审计六层；每一层先最小化验证，再保留 `trace_id`、状态快照和降级证据。对于尚需生产侧核验的项，如 OctoBus 专用审计检索与 Guest 重启后的 facade 连通性，明确标记为待复验，而不以模拟结果替代真实结论。
