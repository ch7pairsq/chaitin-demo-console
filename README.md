# Chaitin Demo Console

面向 Agent 工程实践的脱敏回放控制台，覆盖恶意样本研判与安全运营告警。点击内置任务只会预填输入框，手动发送后才展示对应的状态机、证据、控制措施、日志、审计摘要和指标下钻。

## 页面能力

- 对话触发：12 个覆盖正常、槽位缺失、RAG 拒答、LLM 超时/格式错误降级、OctoBus 失败、多轮切换及安全运营处置失败的案例；点击不执行，手动发送才开始。
- `trace_id`：每条状态、结构化日志、模型解释和能力审计均显示同一 `trace_id`，可直接复制用于排障与链路说明。
- OctoBus：常驻展示 `service → instance → capset` 三层授权路径、Connect RPC 边界、调用主体与最小权限原则。
- 能力审计：每次授权调用展示 audit ID、能力名、三层路径、授权主体、读写策略、结果和脱敏证据摘要。
- 模型解释：展示受限模型输入口径、返回内容、引用 ID、降级结果和“模型不可改写决定”的控制边界。
- 初始化指引：顶部“查看指引”弹窗提供从服务器登录、Secret 注入、三层注册、Stack 发布、重启验收到回放测试的可复制步骤；从不要求在页面输入私钥、token 或 API Key。
- 发布中心：可选择两个固定 Agent 和指定 40 位 Git commit。默认只预览；启用后由 Stack 内网的受控发布器固定 revision、更新 agent-compose，并完成无样本健康检查。
- Portainer：页面顶部单独保留 Stack 入口；只有设置 `PORTAINER_URL` 后才会跳转。

## 安全边界

- 不读取、上传、执行或存储原始样本、私有 IOC、token、Key 或生产日志。
- 仅回放仓库内脱敏数据；`/api/live` 固定返回 `501`。
- 真实 Agent 调用能力必须经 OctoBus Connect RPC；本控制台没有后端访问路径。
- 默认监听容器 `7411`；部署时应仅映射宿主机回环地址。
- `PORTAINER_URL` 是唯一允许回传浏览器的部署变量；服务端仅接受 `http(s)` 地址，其他值会被忽略。
- 浏览器不会获得 Docker socket、发布器 token、私钥或 OctoBus token。真实发布需要服务器 Secret 中的临时确认码；默认 `RELEASE_MODE=preview`，不执行服务器操作。

## 本地验证

```bash
npm run check
npm test
docker build -t chaitin-demo-console:local .
docker run --rm -p 127.0.0.1:7411:7411 chaitin-demo-console:local
```

浏览器访问 `http://127.0.0.1:7411`。

## 镜像发布

推送 `main` 会由 GitHub Actions 运行语法检查、测试并发布：

```text
ghcr.io/ch7pairsq/chaitin-demo-console:latest
ghcr.io/ch7pairsq/chaitin-demo-console:sha-<commit>
```

首次发布后，在 GitHub Packages 将镜像包设为可被部署服务器拉取；如果保持私有，服务器需使用只读 package token 登录 GHCR，不能把该 token 写入 Stack 文件。

## Portainer 部署

将 [deploy/portainer-service.yml](deploy/portainer-service.yml) 中的 `demo-console` 与 `release-runner` 合并到现有 `chaitin` Stack；不要把它部署为第二个 Stack。控制台只从 GHCR 拉取已发布镜像，端口固定为 `127.0.0.1:7411`，不挂载 Docker socket、知识库、状态卷或任何密钥。发布器无宿主机端口，是唯一具有 Docker socket 的最小特权组件。

在 Stack 的非敏感环境变量中选填 `PORTAINER_URL=https://<portainer-host>:9443`，以启用页面顶部的 Portainer 按钮。不要在这个变量或任何页面字段填写用户名、密码、token、私钥或 API Key。

首次确认镜像已由 GitHub Actions 发布后，在服务器执行：

```bash
docker pull ghcr.io/ch7pairsq/chaitin-demo-console:latest
```

若包为私有，使用权限最小的只读 package token 完成一次 `docker login ghcr.io`；不要将 token 填入 Portainer Stack 环境变量或仓库文件。

## 受控发布器首次启用

首次保持 `RELEASE_MODE=preview`，先在页面验证“发布中心”的预览路径。需要真实发布时，在服务器上由管理员创建下列两个不同的随机值文件，并设置为 `0600 root:root`：

```text
/data/chaitin/secrets/release-runner-token
/data/chaitin/secrets/release-ui-confirmation
```

然后把 Stack 的 `RELEASE_MODE` 改为 `enabled` 并更新 Stack。控制台将 token 仅转发给内网 `release-runner`；操作者在浏览器临时输入确认码后才能触发发布。发布器只允许 `security-triage-agent` 与 `malware-triage-agent`，并要求 commit 已位于远程 `main`，随后依次执行：`fetch → 固定 Git ref → agent-compose up → 项目/capset/无样本健康检查`。任何失败都不会自动重试或扩大 OctoBus 权限。
