# 8 步命令行运维与验收手册

本文档替代控制台中原有的“登录服务器到回放验收”弹窗。命令由管理员在受控终端执行；页面不保存、复制或请求私钥、Token、DeepSeek Key、IOC 或原始样本。

先在**本地 PowerShell**设定临时变量。变量只驻留当前窗口，关闭窗口即失效；请按提示输入私钥本地路径，勿写进仓库。

```powershell
$SshKey = Read-Host '输入本地 PEM 私钥绝对路径'
$Server = Read-Host '输入服务器 IP 或域名'
```

下列第 1 步从本地执行；第 2 至第 8 步在服务器 SSH 会话中执行。所有读取类命令均不会输出 Secret 正文。

## 1. 登录并检查主机基础状态

```powershell
ssh -i $SshKey "root@$Server" 'hostnamectl; docker version --format "{{.Server.Version}}"; df -h /; timedatectl status'
```

通过标准：Docker 有服务端版本、磁盘有可用空间、系统时间同步正常。私钥仍只在本机。

## 2. 核查 `chaitin` Stack 容器状态

```sh
docker ps --filter 'label=com.docker.compose.project=chaitin' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

通过标准：`agent-compose`、`octobus`、`agent-compose-ui`、`malware-triage-demo-console` 处于 `Up`。部署 release-runner 后还应有 `chaitin-release-runner`。

## 3. 验证自动恢复策略与公网端口边界

```sh
docker inspect agent-compose octobus malware-triage-demo-console --format '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} ports={{json .NetworkSettings.Ports}}'
```

通过标准：服务使用 `always`（或 Stack 规定的自动恢复策略）；`octobus` 不出现宿主机 Published Port；Agent Compose、Agent Compose UI 与演示控制台只应绑定 `127.0.0.1`。

## 4. 检查 Secret 与部署变量权限，不读取内容

```sh
stat -c '%a %U:%G %n' /data/chaitin/deploy-manifests/security-triage-agent/.env /data/chaitin/deploy-manifests/malware-triage-agent/.env /data/chaitin/secrets/release-runner-token /data/chaitin/secrets/release-ui-confirmation
```

### Agent Compose 模型运行时恢复检查

`codex` Provider 的定时任务由 Agent Compose Runtime 调用模型，不能依赖浏览器或临时会话中的 Provider 配置。完整 Stack 会在启动时从恶意样本项目的 root-only `.env` 中**仅读取** `LLM_BASE_URL`、`MALWARE_TRIAGE_LLM_API_KEY` 与 `LLM_MODEL`，并映射为 Agent Compose 官方需要的 `LLM_API_ENDPOINT`、`LLM_API_KEY`、`LLM_MODEL`；DeepSeek 固定使用 `LLM_API_PROTOCOL=chat_completions`。模型 Key 不会写入 Stack、Git、日志或浏览器。

更新 Stack 前，仅核验三个值已设置，不显示其内容：

```sh
ENV_FILE=/data/chaitin/deploy-manifests/malware-triage-agent/.env
for key in LLM_BASE_URL MALWARE_TRIAGE_LLM_API_KEY LLM_MODEL; do
  value=$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)
  if [ -n "$value" ]; then echo "$key=SET"; else echo "$key=MISSING"; fi
done
```

通过标准：三项均为 `SET`。若任一项为 `MISSING`，Stack 会以退出码 `78` 停止 Agent Compose，而不是让调度任务长时间 `running` 后才超时。

更新 Stack 后，仅查看 PID 1 中是否存在必要变量名，绝不输出变量值：

```sh
docker exec agent-compose sh -c '
for key in LLM_API_ENDPOINT LLM_API_KEY LLM_MODEL LLM_API_PROTOCOL; do
  if tr "\000" "\n" </proc/1/environ | grep -q "^${key}="; then
    echo "$key=SET"
  else
    echo "$key=MISSING"
  fi
done'
```

通过标准：四项均为 `SET`，其中协议必须为 `chat_completions`（该值不属于密钥，必要时可在 Stack 审阅中核对）。

通过标准：文件为 `600 root:root`（或等效最小权限）。**不要执行 `cat`、`printenv`、`docker inspect` 环境变量全文输出或截图。**

## 5. 验证 Agent 项目注册与版本状态

```sh
docker exec agent-compose agent-compose project ls --json
```

通过标准：可见 `security-triage-agent` 和 `malware-triage-agent` 项目，且各自 revision 存在。随后在 OctoBus 控制台核对对应 `service → instance → capset`：

```text
security-triage-service → security-triage-demo → security-triage
malware-analysis-service → malware-analysis-demo → malware-analysis
```

## 6. 核对受控工作目录的 Git 版本，不发布

```sh
for p in security-triage-agent malware-triage-agent; do printf '%s ' "$p"; git -C "/data/chaitin/deploy-manifests/$p" rev-parse --short=12 HEAD; git -C "/data/chaitin/deploy-manifests/$p" status --short; done
```

通过标准：两个目录均能显示当前提交；`status --short` 无输出表示工作目录未被手工改动。本步骤不拉取、不注册、不重启服务。

## 7. 真实重启恢复验收

先针对演示控制台进行低风险重启，不重启 OctoBus；执行后立即检查状态和最近启动日志。

```sh
docker restart malware-triage-demo-console && sleep 3 && docker inspect -f '{{.State.Status}} restartCount={{.RestartCount}} started={{.State.StartedAt}}' malware-triage-demo-console && docker logs --tail 30 malware-triage-demo-console
```

通过标准：状态回到 `running`，日志出现控制台启动事件。随后在页面运行一个回放案例，确认 `trace_id`、审计和日志面板仍可显示。

## 8. 安全回放与日志查询

从服务器本机访问控制台健康资源，并仅按 trace ID 查询脱敏日志。不要把响应保存为包含敏感正文的文件。

```sh
curl -fsS http://127.0.0.1:7411/api/cases | grep -o '"id"' | wc -l && docker logs --since 15m malware-triage-demo-console 2>&1 | tail -n 80
```

通过标准：案例数大于零、控制台无启动错误。正式答辩时，在页面手动发送案例后，复制右侧 `trace_id`，再到 Portainer/受控日志系统按该 ID 检索。

## 发布边界

正式更新 Agent 仍由 Portainer 的 `chaitin` Stack 或受控 `release-runner` 完成。默认 `RELEASE_MODE=preview` 不执行服务器变更；只有管理员已部署 runner、配置服务器 Secret，并明确设置 `RELEASE_MODE=enabled` 后才能进行真实发布。发布过程只允许固定项目和已推送版本，且不读取样本、私钥、IOC 或模型 Key。
