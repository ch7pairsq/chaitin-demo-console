const state = { cases: [], config: {}, domain: 'all', preparedCaseId: null, preparedText: '', run: 0, metrics: { total: 0, nonSuccess: 0, malware: 0, security: 0 }, current: null };
const $ = (selector) => document.querySelector(selector);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const label = (value) => String(value ?? '').replaceAll('_', ' ');
const textNode = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const clear = (node) => node.replaceChildren();
const caseById = (id) => state.cases.find((item) => item.id === id);

const runbook = [
  ['01', '登录与主机检查', '在受控终端使用本地私钥登录服务器；私钥文件始终留在本机，不复制到服务器、仓库或页面。', 'ssh -i <local-key-path> root@<server-ip>', '确认 Docker、磁盘空间和时间同步正常。'],
  ['02', '配置 Server Secret', '在 Portainer 的 Stack 环境变量/Secret 中配置 DeepSeek Key、两个独立 OctoBus token 与端点；只填写值，不在 Compose 或 Git 中写死。', 'Portainer → Stacks → chaitin → Environment variables / Secrets', '确认 .env 不提交，页面和容器日志也不回显密钥。'],
  ['03', '验证 OctoBus 三层注册', '在 OctoBus 控制台确认每个 Agent 分别被授权到 service → instance → capset；Agent 仅知道 OctoBus 地址。', 'security: security-triage-service → security-triage-demo → security-triage\nmalware: malware-analysis-service → malware-analysis-demo → malware-analysis', '确认能力、令牌和 Agent 一一对应；不可跨 capset 调用。'],
  ['04', '用 Stack 发布', '在 Portainer 更新 chaitin Stack。服务应使用 restart: always，OctoBus 不发布公网端口，控制台只绑定 127.0.0.1。', 'Portainer → Stacks → chaitin → Update the stack', '确认 agent-compose、octobus、demo-console 均为 running。'],
  ['05', '容器与重启验收', '从 Portainer 查看三个容器日志和重启策略；只通过 Stack 管理配置、重启与镜像更新。', 'Portainer → Stacks → chaitin → Containers', '重启 demo/Agent 后，SQLite 状态卷与 restart: always 应恢复；不要直接改生产容器。'],
  ['06', '在本页回放验证', '先跑“正常”案例，再依次演示槽位缺失、RAG 拒答、LLM 超时、OctoBus 失败和多轮切换。', '左侧选择案例 → 检查预填 → 手动发送', '逐项确认右侧 trace_id、OctoBus 三层链路、模型输出、审计卡和日志均一致。'],
  ['07', '交付前边界复核', '确认无明文密钥、无样本、无 IOC 正文进入仓库或 UI；检查端口、审计和 README 操作记录。', 'git status && docker ps && Portainer Stack review', '保留 trace_id 与脱敏运行证据；异常应转人工而非绕过 OctoBus。']
];

function caseForMessage(message) {
  const exact = state.cases.find((item) => item.user === message);
  if (exact) return exact.id;
  const text = message.toLowerCase();
  if (/(告警|dns|扫描|ioc|安全运营)/.test(text)) return 'security-normal';
  if (/(状态|进度|trace)/.test(text)) return 'malware-switch';
  if (/(缺少|没有.*sha|unknown)/.test(text)) return 'malware-slots';
  if (/(低分|没有证据|拒答)/.test(text)) return 'malware-rag';
  if (/(超时|timeout|模型失败)/.test(text)) return 'malware-llm';
  if (/(octobus|网关|连接失败)/.test(text)) return 'malware-gateway';
  if (/(研判|分析|样本|恶意|yara|sha-?256|triage)/.test(text)) return 'malware-normal';
  return 'malware-chat';
}

function outcomeTone(outcome) {
  if (/(REFUSE|NEED|COLLECT|PAUSED|MANUAL)/.test(outcome)) return 'exception';
  if (/(ESCALATE|REVIEW)/.test(outcome)) return 'review';
  return 'normal';
}
function stepTone(step) {
  if (/(REFUSE|NEED|FAIL|COLLECT|PAUSED|HUMAN)/.test(step.state) || /(超时|失败|缺失|拒答|暂停)/.test(step.detail)) return 'exception';
  if (/(RECEIVED|COMPLETED|PERSIST|CREATE_REVIEW)/.test(step.state)) return 'boundary';
  return 'normal';
}

function renderCases() {
  const list = $('#case-list'); clear(list);
  for (const item of state.cases.filter((candidate) => state.domain === 'all' || candidate.domain === state.domain)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `case ${item.domain} ${outcomeTone(item.outcome)}`; button.dataset.id = item.id;
    const line = document.createElement('span'); line.append(textNode('small', item.domain === 'security' ? '安全运营' : '恶意样本', 'domain-tag'), textNode('b', item.title));
    button.append(line, textNode('small', label(item.outcome), 'case-outcome')); button.addEventListener('click', () => prepareCase(item.id)); list.append(button);
  }
}
function prepareCase(id) {
  const item = caseById(id); if (!item) return;
  const input = $('#prompt'); input.value = item.user; input.focus(); state.preparedCaseId = id; state.preparedText = item.user;
  $('#prepared').textContent = '已预填 · 请发送'; $('#prepared').classList.add('ready');
}
function clearPrepared() { state.preparedCaseId = null; state.preparedText = ''; $('#prepared').textContent = '未选择'; $('#prepared').classList.remove('ready'); }
function appendMessage(kind, content) { const node = textNode('article', content, kind); $('#conversation').append(node); $('#conversation').scrollTop = $('#conversation').scrollHeight; }
function copyText(value, successText) {
  navigator.clipboard?.writeText(value).then(() => { const prior = successText.dataset?.prior || successText.textContent; successText.dataset.prior = prior; successText.textContent = '已复制'; setTimeout(() => { successText.textContent = prior; }, 1300); }).catch(() => { alert('浏览器未允许复制，请手动复制。'); });
}
function renderTable(target, rows, columns, empty) {
  const tbody = $(target); clear(tbody);
  if (!rows.length) { const row = document.createElement('tr'); const cell = textNode('td', empty, 'empty-cell'); cell.colSpan = columns.length; row.append(cell); tbody.append(row); return; }
  for (const rowData of rows) { const row = document.createElement('tr'); for (const column of columns) row.append(textNode('td', rowData[column] ?? '—')); tbody.append(row); }
}

async function renderTimeline(result, run) {
  const timeline = $('#timeline'); clear(timeline);
  for (const step of result.steps) {
    if (run !== state.run) return;
    const item = document.createElement('article'); item.className = `step ${stepTone(step)}`;
    const rail = document.createElement('div'); rail.className = 'step-rail'; rail.append(textNode('span', String(step.sequence).padStart(2, '0')), textNode('small', step.at.slice(11, 16)));
    const body = document.createElement('div'); body.className = 'step-body';
    const top = document.createElement('div'); top.className = 'step-top'; top.append(textNode('b', step.state), textNode('span', step.detail, 'step-detail'), textNode('em', stepTone(step) === 'exception' ? '异常 / 降级' : stepTone(step) === 'boundary' ? '状态留存' : '执行中', 'step-badge')); body.append(top);
    const traceLine = document.createElement('div'); traceLine.className = 'step-trace'; traceLine.append(textNode('span', 'trace_id'), textNode('code', result.traceId)); body.append(traceLine);
    const facts = document.createElement('dl'); facts.className = 'step-facts';
    for (const [name, value, tone] of [['关键操作', step.operation, ''], ['证据 / 输出', step.evidence, 'evidence'], ['安全控制', step.guardrail, 'guardrail'], ['答辩关注', step.interviewerFocus, 'question']]) { const row = document.createElement('div'); row.className = tone; row.append(textNode('dt', name), textNode('dd', value)); facts.append(row); }
    body.append(facts); item.append(rail, body); timeline.append(item); await wait(80);
  }
}

function renderOctoBus(result) {
  $('#path-service').textContent = result.octobus.service; $('#path-instance').textContent = result.octobus.instance; $('#path-capset').textContent = result.octobus.capset;
  $('#path-protocol').textContent = `Connect RPC · trace_id=${result.traceId}`; $('#path-principal').textContent = `${result.domain}-agent · 最小权限 capset token`;
}
function renderModel(model) {
  $('#model-status').textContent = model.status; $('#model-provider').textContent = model.provider; $('#model-policy').textContent = model.requestPolicy; $('#model-output').textContent = model.response;
  $('#model-citations').textContent = model.citations.length ? model.citations.join('  ·  ') : '无引用；模型未被调用。'; $('#model-guardrail').textContent = model.guardrail;
}
function renderAudit(audit) {
  const board = $('#audit-cards'); clear(board); $('#audit-empty').hidden = audit.length > 0;
  for (const row of audit) {
    const card = document.createElement('article'); card.className = 'audit-card';
    const header = document.createElement('div'); header.className = 'audit-head'; header.append(textNode('code', row.auditId), textNode('span', row.result, 'audit-result')); card.append(header);
    const title = document.createElement('div'); title.className = 'audit-title'; title.append(textNode('b', row.capability), textNode('small', `${row.timestamp} · ${row.boundary}`)); card.append(title);
    const chain = document.createElement('div'); chain.className = 'audit-chain'; for (const [name, value] of [['service', row.service], ['instance', row.instance], ['capset', row.capset]]) { const node = document.createElement('span'); node.append(textNode('small', name.toUpperCase()), textNode('b', value)); chain.append(node); } card.append(chain);
    const details = document.createElement('dl'); details.className = 'audit-details'; for (const [name, value] of [['trace_id', row.traceId], ['授权主体', row.principal], ['策略', row.policy], ['证据摘要', row.evidence]]) { const item = document.createElement('div'); item.append(textNode('dt', name), textNode('dd', value)); details.append(item); } card.append(details); board.append(card);
  }
}
function renderRunbook() {
  const board = $('#runbook'); clear(board);
  for (const [number, title, body, command, check] of runbook) {
    const card = document.createElement('article'); card.className = 'runbook-step'; const head = document.createElement('div'); head.className = 'runbook-head'; head.append(textNode('span', number), textNode('b', title)); card.append(head, textNode('p', body));
    const commandBox = document.createElement('div'); commandBox.className = 'command-box'; const code = textNode('code', command); const copy = textNode('button', '复制'); copy.type = 'button'; copy.addEventListener('click', () => copyText(command, copy)); commandBox.append(code, copy); card.append(commandBox);
    const checkLine = document.createElement('div'); checkLine.className = 'check-line'; checkLine.append(textNode('b', '检查点'), textNode('span', check)); card.append(checkLine); board.append(card);
  }
}
function metricDefinitions() {
  const current = state.current;
  return [
    { name: '本次会话回放', value: state.metrics.total, description: '浏览器当前会话中，用户手动发送后完成的回放次数。', source: 'demo-console 内存计数 / chaitin_demo_replay_total', interpretation: '证明页面操作触发了回放，而非点击案例立即执行。' },
    { name: '异常 / 降级接管', value: state.metrics.nonSuccess, description: '统计需要澄清、拒答、暂停或人工处理的回放。', source: 'demo-console 内存计数 / chaitin_demo_non_success_total', interpretation: '数值上升不等于系统故障，体现 fail-closed 和人工接管。' },
    { name: '当前链路域', value: current?.domain === 'security' ? '安全运营' : current ? '恶意样本' : '—', description: '当前 trace 所属的业务 Agent。', source: '预置回放 case.domain', interpretation: '两个 Agent 的规则与能力边界独立，均经 OctoBus。' },
    { name: '当前严重性', value: current?.severity?.toUpperCase() ?? '—', description: '由确定性规则或案例预置风险级别。', source: 'risk-engine / security rule-engine 的可解释输出', interpretation: 'LLM 不拥有修改该等级的权限。' }
  ];
}
function renderMetrics() { const grid = $('#metric-grid'); clear(grid); for (const metric of metricDefinitions()) { const card = document.createElement('button'); card.type = 'button'; card.className = 'metric-card'; card.append(textNode('small', metric.name), textNode('strong', metric.value)); card.addEventListener('click', () => showMetric(metric)); grid.append(card); } }
function showMetric(metric) { $('#metric-dialog-title').textContent = metric.name; const body = $('#metric-dialog-body'); clear(body); for (const [name, value] of [['当前值', metric.value], ['计算口径', metric.description], ['数据来源', metric.source], ['答辩解释', metric.interpretation]]) { const row = document.createElement('div'); row.append(textNode('dt', name), textNode('dd', value)); body.append(row); } $('#metric-dialog').showModal(); }
async function render(result, run) {
  state.current = result; $('#trace-title').textContent = result.title; $('#trace-id').textContent = result.traceId; $('#copy-trace').disabled = false;
  const outcome = $('#outcome'); outcome.textContent = label(result.outcome); outcome.className = `outcome ${outcomeTone(result.outcome)}`;
  const verification = $('#verification'); verification.textContent = result.verification === 'server-validated' ? '服务器联调已通过' : '稳定回放'; verification.className = `verification ${result.verification}`;
  $('#trace-summary').replaceChildren(textNode('span', `${result.domain === 'security' ? '安全运营 Agent' : '恶意样本 Agent'} · ${result.reply}`));
  renderOctoBus(result); renderModel(result.llm); renderAudit(result.audit); renderTable('#log-view', result.logs, ['timestamp', 'level', 'state', 'message', 'decision'], '暂无日志');
  state.metrics.total += 1; state.metrics[result.domain] += 1; if (!['HUMAN_REVIEW_REQUIRED', 'COMPLETED', 'NEEDS_REVIEW', 'ESCALATE'].includes(result.outcome)) state.metrics.nonSuccess += 1; renderMetrics(); await renderTimeline(result, run);
}
async function replay(id, userText) { const response = await fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: id }) }); if (!response.ok) throw new Error('replay_failed'); const result = await response.json(); appendMessage('user', userText); appendMessage('bot', result.reply); const run = ++state.run; await render(result, run); }
function selectTab(button) { document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button)); document.querySelectorAll('.panel').forEach((item) => item.classList.toggle('active', item.id === button.dataset.tab)); }
async function boot() {
  [state.cases, state.config] = await Promise.all([fetch('/api/cases').then((res) => res.json()), fetch('/api/config').then((res) => res.json())]);
  $('#mode').textContent = `${state.config.mode.toUpperCase()} MODE`; renderCases(); renderMetrics(); renderRunbook();
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { state.domain = button.dataset.domain; document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderCases(); }));
  document.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => selectTab(button)));
  document.querySelectorAll('[data-tab-target]').forEach((button) => button.addEventListener('click', () => selectTab(document.querySelector(`[data-tab="${button.dataset.tabTarget}"]`))));
  $('#open-portainer').addEventListener('click', () => state.config.portainerUrl ? window.open(state.config.portainerUrl, '_blank', 'noopener') : alert('未配置 PORTAINER_URL。请在 Portainer Stack 环境变量中设置控制台地址。'));
  $('#copy-trace').addEventListener('click', () => { if (state.current) copyText(state.current.traceId, $('#copy-trace')); });
  $('#audit-focus').addEventListener('click', () => { if (state.current) { copyText(state.current.traceId, $('#audit-focus')); $('#audit-focus').textContent = `当前 ${state.current.traceId}`; } });
  $('#copy-log-query').addEventListener('click', () => state.current ? copyText(`trace_id=\"${state.current.traceId}\"`, $('#copy-log-query')) : alert('请先发送一个案例。'));
  $('#prompt').addEventListener('input', (event) => { if (event.target.value !== state.preparedText) clearPrepared(); });
  $('#chat-form').addEventListener('submit', async (event) => { event.preventDefault(); const input = $('#prompt'); const message = input.value.trim(); if (!message) return; const id = message === state.preparedText && state.preparedCaseId ? state.preparedCaseId : caseForMessage(message); input.value = ''; clearPrepared(); try { await replay(id, message); } catch { appendMessage('bot', '回放服务失败，请检查 demo-console 容器日志。'); } });
}
boot().catch(() => { $('#conversation').replaceChildren(textNode('article', '控制台初始化失败，请检查 demo-console 容器日志。', 'bot')); });
