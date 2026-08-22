# Chaitin Demo Console

面向 Agent 工程师答辩的脱敏回放控制台，覆盖恶意样本研判与安全运营告警。点击内置任务只会预填输入框，手动发送后才展示对应的状态机、证据、控制措施、日志、审计摘要和指标下钻。

## 安全边界

- 不读取、上传、执行或存储原始样本、私有 IOC、token、Key 或生产日志。
- 仅回放仓库内脱敏数据；`/api/live` 固定返回 `501`。
- 真实 Agent 调用能力必须经 OctoBus Connect RPC；本控制台没有后端访问路径。
- 默认监听容器 `7411`；部署时应仅映射宿主机回环地址。

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

首次确认镜像已由 GitHub Actions 发布后，在服务器执行：

```bash
docker pull ghcr.io/ch7pairsq/chaitin-demo-console:latest
```

若包为私有，使用权限最小的只读 package token 完成一次 `docker login ghcr.io`；不要将 token 填入 Portainer Stack 环境变量或仓库文件。
