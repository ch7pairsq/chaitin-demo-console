# Chaitin Demo Console

面向 Agent 工程师答辩的脱敏回放控制台，覆盖恶意样本研判与安全运营告警。点击内置任务只会预填输入框，手动发送后才展示对应的状态机、证据、控制措施、日志、审计摘要和指标下钻。

## 页面答辩能力

- 对话触发：10 个覆盖正常、槽位缺失、RAG 拒答、LLM 超时降级、OctoBus 失败、多轮切换及安全运营处置失败的案例；点击不执行，手动发送才开始。
- `trace_id`：每条状态、结构化日志、模型解释和能力审计均显示同一 `trace_id`，可直接复制用于排障与答辩说明。
- OctoBus：常驻展示 `service → instance → capset` 三层授权路径、Connect RPC 边界、调用主体与最小权限原则。
- 能力审计：每次授权调用展示 audit ID、能力名、三层路径、授权主体、读写策略、结果和脱敏证据摘要。
- 模型解释：展示受限模型输入口径、返回内容、引用 ID、降级结果和“模型不可改写决定”的控制边界。
- 初始化指引：页面内提供从服务器登录、Secret 注入、三层注册、Stack 发布、重启验收到回放测试的可复制步骤；从不要求在页面输入私钥、token 或 API Key。
- Portainer：页面顶部单独保留 Stack 入口；只有设置 `PORTAINER_URL` 后才会跳转。

## 安全边界

- 不读取、上传、执行或存储原始样本、私有 IOC、token、Key 或生产日志。
- 仅回放仓库内脱敏数据；`/api/live` 固定返回 `501`。
- 真实 Agent 调用能力必须经 OctoBus Connect RPC；本控制台没有后端访问路径。
- 默认监听容器 `7411`；部署时应仅映射宿主机回环地址。
- `PORTAINER_URL` 是唯一允许回传浏览器的部署变量；服务端仅接受 `http(s)` 地址，其他值会被忽略。

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

将 [deploy/portainer-service.yml](deploy/portainer-service.yml) 中的 `demo-console` 合并到现有 `chaitin` Stack；不要把它部署为第二个 Stack。它只从 GHCR 拉取已发布镜像，端口固定为 `127.0.0.1:7411`，不挂载 Docker socket、知识库、状态卷或任何密钥。

在 Stack 的非敏感环境变量中选填 `PORTAINER_URL=https://<portainer-host>:9443`，以启用页面顶部的 Portainer 按钮。不要在这个变量或任何页面字段填写用户名、密码、token、私钥或 API Key。

首次确认镜像已由 GitHub Actions 发布后，在服务器执行：

```bash
docker pull ghcr.io/ch7pairsq/chaitin-demo-console:latest
```

若包为私有，使用权限最小的只读 package token 完成一次 `docker login ghcr.io`；不要将 token 填入 Portainer Stack 环境变量或仓库文件。
