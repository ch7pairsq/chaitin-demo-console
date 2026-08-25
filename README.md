# Chaitin Demo Console

面向 Agent 工程实践的脱敏回放控制台，覆盖恶意样本研判与安全运营告警。点击内置任务只会预填输入框，手动发送后才展示对应的状态机、证据、控制措施、日志、审计摘要和指标下钻。

## 页面能力

- 对话触发：12 个覆盖正常、槽位缺失、RAG 拒答、LLM 超时/格式错误降级、OctoBus 失败、多轮切换及安全运营处置失败的案例；点击不执行，手动发送才开始。
- `trace_id`：回放页面中每条状态、结构化日志、模型解释和能力审计均显示同一回放 `trace_id`，可直接复制用于讲解状态关联。真实执行的最终 `trace_id` 必须以 Agent Compose run、OctoBus 审计和 SQLite 快照为准。
- 受控实时触发：手动发送**已预置且未改写**的任一案例后，浏览器仅调用 demo-console；服务端校验案例全文与白名单，再以独立 token 转发给内网触发器。12 个案例都固定映射到 Agent Compose 的受控命令；页面显示 `ACCEPTED` 仅代表命令已被 Agent Compose 接收，**不代表业务任务已经完成**。
- 执行与回放分层：正常安全运营案例可通过 OctoBus 验证真实能力调用；槽位收集、闲聊拒答和多轮切换可验证真实状态机入口。LLM 超时、模型格式错误、网关临时故障、处置留存失败及知识消融页面展示的是预先测试过的脱敏证据回放，并不在生产服务中主动注入故障。
- OctoBus：常驻展示 `service → instance → capset` 三层授权路径、Connect RPC 边界、调用主体与最小权限原则。
- 能力审计：每次授权调用展示 audit ID、能力名、三层路径、授权主体、读写策略、结果和脱敏证据摘要。
- 模型解释：展示可公开的**脱敏回放**模型输入、受限输出、引用 ID、降级结果和“模型不可改写决定”的控制边界。输入/输出支持折叠；它不是系统提示词或实时模型完整转录。
- 对话可用性：桌面端聊天区固定高度，案例列表与对话记录独立滚动；内置案例只会预填输入，仍需手动点击发送。
- 知识证明：以规则版本、来源类别、已知误判边界与人工复核条件展示脱敏案例溯源；同一输入下并列“启用受控知识 / 移除对应知识”的消融回放。它只证明可执行机制和输出差异，真实工单、样本、IOC 与统计仍在私有受控台账中查验。
- 规则溯源与知识消融：顶部入口集中展示脱敏案例的规则版本、误判边界、人工复核条件与知识消融对照；从不要求在页面输入私钥、token 或 API Key。
- 发布中心：默认选择远程 `main` 的最新已推送版本，页面不要求手工输入 commit；发布器在服务器内解析并固定完整 SHA。需要精确回滚时才选择“指定 commit（高级）”。默认只预览；启用后由 Stack 内网的受控发布器更新 agent-compose，并完成无样本健康检查。
- Portainer：页面顶部单独保留 Stack 入口；只有设置 `PORTAINER_URL` 后才会跳转。

## 安全边界

- 不读取、上传、执行或存储原始样本、私有 IOC、token、Key 或生产日志。
- 默认仅回放仓库内脱敏数据；只有 `DEMO_MODE=hybrid` 且内部触发器、独立 secret 均就绪时，`/api/live` 才接收全部已预置案例。任意编辑过的输入仍会被拒绝，不能成为 Agent 指令。
- 真实 Agent 调用能力必须经 OctoBus Connect RPC；本控制台没有后端访问路径。
- 默认监听容器 `7411`；部署时应仅映射宿主机回环地址。
- `PORTAINER_URL` 是唯一允许回传浏览器的部署变量；服务端仅接受 `http(s)` 地址，其他值会被忽略。
- 浏览器不会获得 Docker socket、触发器/发布器 token、私钥或 OctoBus token。`agent-trigger-bridge` 是独立的内网服务：没有主机端口、没有发布目录和私有知识库挂载，只接受硬编码案例白名单，并以固定 Docker Engine Exec 参数启动 Agent Compose。**Docker socket 仍是高权限基础设施能力**；本项目以独立 token、无公网暴露、只读根文件系统和固定命令降低风险，但生产环境应优先改为 Agent Compose 的受控事件 API 或最小权限执行器。

## 本地验证

```bash
npm run check
npm test
docker build -t chaitin-demo-console:local .
docker run --rm -p 127.0.0.1:7411:7411 chaitin-demo-console:local
```

浏览器访问 `http://127.0.0.1:7411`。

## 运维命令文档

服务器登录、Secret 注入、Stack 更新及重启验收不在演示界面中执行。请使用 [8 步命令行运维与验收手册](docs/operations-command-runbook.md)；其中所有命令避免输出密钥、私有 IOC 或样本正文。

开发联调中遇到的配置、模型、沙箱、权限、审计与降级问题及处理结论见[开发联调问题摘要](docs/development-debugging-retrospective.md)。

## 镜像发布

推送 `main` 会由 GitHub Actions 运行语法检查、测试并发布：

```text
ghcr.io/ch7pairsq/chaitin-demo-console:latest
ghcr.io/ch7pairsq/chaitin-demo-console:sha-<commit>
ghcr.io/ch7pairsq/chaitin-demo-console:trigger-bridge
```

首次发布后，在 GitHub Packages 将镜像包设为可被部署服务器拉取；如果保持私有，服务器需使用只读 package token 登录 GHCR，不能把该 token 写入 Stack 文件。

## Portainer 部署

以完整清单 [deploy/chaitin-stack.yml](deploy/chaitin-stack.yml) 作为唯一权威 Stack 来源；不要新建第二个 Stack。`deploy/portainer-service.yml` 仅作历史合并参考，使用前必须核对镜像策略与完整清单一致。控制台端口固定为 `127.0.0.1:7411`，不挂载 Docker socket、知识库或状态卷。发布器和触发器都无宿主机端口；两者使用不同 token，职责不混用。

在 Stack 的非敏感环境变量中选填 `PORTAINER_URL=https://<portainer-host>:9443`，以启用页面顶部的 Portainer 按钮。不要在这个变量或任何页面字段填写用户名、密码、token、私钥或 API Key。

首次确认镜像已由 GitHub Actions 发布后，在服务器执行：

```bash
docker pull ghcr.io/ch7pairsq/chaitin-demo-console:latest
```

若包为私有，使用权限最小的只读 package token 完成一次 `docker login ghcr.io`；不要将 token 填入 Portainer Stack 环境变量或仓库文件。

## 将 release-runner 加入既有 Stack

你当前的 `chaitin` Stack 若只显示 `agent-compose`、`octobus` 与 `demo-console`，说明受控发布器尚未部署。不要新建第二个 Stack：在 Portainer 的 `Stacks → chaitin → Editor` 中，将 [deploy/portainer-service.yml](deploy/portainer-service.yml) 里的完整 `release-runner:` 服务合并到既有 `services:` 下，并保留它的 `chaitin-net` 网络配置。随后更新 Stack。

验收要求：容器名为 `chaitin-release-runner` 且状态为 `running`；它**没有** Published Port；只有它挂载 Docker socket，`demo-console` 不挂载。若镜像尚未出现在 GHCR，先等待本仓库 `main` 的 GitHub Actions 镜像构建完成，再更新 Stack。

首次部署 runner 前，服务器还需要保留两个 Agent 的受控 Git 工作目录；它们挂载到 runner 的 `/deploy`，用于读取指定 commit 的 `agent-compose.yml`。在服务器以管理员身份一次性准备：

```bash
install -d -m 700 /data/chaitin/deploy-manifests
git clone https://github.com/ch7pairsq/security-triage-agent.git /data/chaitin/deploy-manifests/security-triage-agent
git clone https://github.com/ch7pairsq/malware-triage-agent.git /data/chaitin/deploy-manifests/malware-triage-agent
install -m 600 /data/chaitin/deploy-manifests/security-triage-agent/.env.example /data/chaitin/deploy-manifests/security-triage-agent/.env
install -m 600 /data/chaitin/deploy-manifests/malware-triage-agent/.env.example /data/chaitin/deploy-manifests/malware-triage-agent/.env
```

随后仅在服务器编辑两个 `.env` 文件，填入各自已有的 OctoBus/模型等部署值；不要提交、复制或显示这些文件。目录已存在时不要重复 `git clone`，先核对目录与 `.env` 权限均为 `600`。

## 受控发布器首次启用

首次保持 `RELEASE_MODE=preview`，先在页面验证“发布中心”的预览路径。需要真实发布时，在服务器上由管理员创建下列两个不同的随机值文件，并设置为 `0600 root:root`：

```text
/data/chaitin/secrets/release-runner-token
/data/chaitin/secrets/release-ui-confirmation
```

然后把 Stack 的 `RELEASE_MODE` 改为 `enabled` 并更新 Stack。控制台将 token 仅转发给内网 `release-runner`；操作者在浏览器临时输入确认码后才能触发发布。无论该开关是否开启，“预览发布计划”都不会读取 Secret、连接发布器或改变服务器。发布器只允许 `security-triage-agent` 与 `malware-triage-agent`，并要求 commit 已位于远程 `main`，随后依次执行：`fetch → 固定 Git ref → agent-compose up → 项目/capset/无样本健康检查`。任何失败都不会自动重试或扩大 OctoBus 权限。

## 受控手动触发器

在镜像 `trigger-bridge` 已发布并在服务器预拉取后，由管理员创建独立 token 文件（不复用发布 token）：

```bash
install -d -m 700 /data/chaitin/secrets
umask 077
openssl rand -hex 32 > /data/chaitin/secrets/agent-trigger-bridge-token
chown root:root /data/chaitin/secrets/agent-trigger-bridge-token
chmod 600 /data/chaitin/secrets/agent-trigger-bridge-token
```

再以完整 [Stack 清单](deploy/chaitin-stack.yml) 更新既有 `chaitin` Stack。不要发布 `agent-trigger-bridge` 端口。验收时，任意一个未编辑的预置案例均可受控提交：链路为 `浏览器 → demo-console → agent-trigger-bridge → Docker Engine Exec → agent-compose → Agent → OctoBus（仅在该工作流需要能力调用时）`。浏览器不会得到 bridge token、Agent Compose 命令、OctoBus token 或原始能力响应。

发送后的页面会同时给出：

- `已受控提交 Agent Compose`：表示 bridge 已获得 Agent Compose run 标识；此时应在 Agent Compose UI 或 CLI 查询最终运行状态。
- `回放 trace_id`、模型输入/输出、审计和日志：用于展示该案例的脱敏状态机和证据口径，不能替代本次真实执行的 OctoBus 审计或 SQLite 记录。
- 真实闭环核验：以 Agent Compose 的 `run_id`、最终业务 `trace_id`、OctoBus 审计记录及 SQLite `workflow_snapshots` 四项相互印证。
