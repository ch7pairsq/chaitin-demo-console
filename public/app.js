const state = { cases: [], config: {}, domain: 'all', preparedCaseId: null, preparedText: '', run: 0, metrics: { total: 0, nonSuccess: 0, malware: 0, security: 0 }, current: null };
const $ = (selector) => document.querySelector(selector);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function label(value) { return String(value ?? '').replaceAll('_', ' '); }
function textNode(tag, value, className) { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
function clear(node) { node.replaceChildren(); }
function caseById(id) { return state.cases.find((item) => item.id === id); }

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

function renderCases() {
  const list = $('#case-list'); clear(list);
  for (const item of state.cases.filter((candidate) => state.domain === 'all' || candidate.domain === state.domain)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `case ${item.domain}`; button.dataset.id = item.id;
    const line = document.createElement('span'); line.append(textNode('small', item.domain === 'security' ? '安全运营' : '恶意样本', 'domain-tag'), textNode('b', item.title));
    button.append(line, textNode('small', label(item.outcome), 'case-outcome'));
    button.addEventListener('click', () => prepareCase(item.id)); list.append(button);
  }
}

function prepareCase(id) {
  const item = caseById(id); if (!item) return;
  const input = $('#prompt'); input.value = item.user; input.focus();
  state.preparedCaseId = id; state.preparedText = item.user;
  $('#prepared').textContent = '已预填 · 请发送'; $('#prepared').classList.add('ready');
}

function clearPrepared() {
  state.preparedCaseId = null; state.preparedText = ''; $('#prepared').textContent = '未选择'; $('#prepared').classList.remove('ready');
}

function appendMessage(kind, content) {
  const node = textNode('article', content, kind); $('#conversation').append(node); $('#conversation').scrollTop = $('#conversation').scrollHeight;
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
    const item = document.createElement('article'); item.className = 'step';
    const rail = document.createElement('div'); rail.className = 'step-rail'; rail.append(textNode('span', String(step.sequence).padStart(2, '0')), textNode('small', step.at.slice(11, 16)));
    const body = document.createElement('div'); body.className = 'step-body';
    const top = document.createElement('div'); top.className = 'step-top'; top.append(textNode('b', step.state), textNode('span', step.detail, 'step-detail')); body.append(top);
    const facts = document.createElement('dl'); facts.className = 'step-facts';
    for (const [name, value, tone] of [['关键操作', step.operation, ''], ['证据 / 输出', step.evidence, 'evidence'], ['安全控制', step.guardrail, 'guardrail'], ['答辩关注', step.interviewerFocus, 'question']]) { const row = document.createElement('div'); row.className = tone; row.append(textNode('dt', name), textNode('dd', value)); facts.append(row); }
    body.append(facts); item.append(rail, body); timeline.append(item); await wait(85);
  }
}

function metricDefinitions() {
  const current = state.current;
  return [
    { id: 'total', name: '本次会话回放', value: state.metrics.total, description: '浏览器当前会话中，用户手动发送后完成的回放次数。', source: 'demo-console 内存计数 / chaitin_demo_replay_total', interpretation: '用于证明界面操作已触发演示，而非点击即执行。' },
    { id: 'non-success', name: '拒答 / 降级次数', value: state.metrics.nonSuccess, description: '统计需要澄清、拒答、暂停或人工处理的回放。', source: 'demo-console 内存计数 / chaitin_demo_non_success_total', interpretation: '数值上升不表示系统故障，体现 fail-closed 和人工接管。' },
    { id: 'domain', name: '当前链路域', value: current?.domain === 'security' ? '安全运营' : current ? '恶意样本' : '—', description: '当前 trace 所属的业务 Agent。', source: '预置回放 case.domain', interpretation: '两个 Agent 的规则与能力边界独立，均经 OctoBus。' },
    { id: 'severity', name: '当前严重性', value: current?.severity?.toUpperCase() ?? '—', description: '由确定性规则或案例预置风险级别。', source: 'risk-engine / security rule-engine 的可解释输出', interpretation: 'LLM 不拥有修改该等级的权限。' }
  ];
}

function renderMetrics() {
  const grid = $('#metric-grid'); clear(grid);
  for (const metric of metricDefinitions()) { const card = document.createElement('button'); card.type = 'button'; card.className = 'metric-card'; card.append(textNode('small', metric.name), textNode('strong', metric.value)); card.addEventListener('click', () => showMetric(metric)); grid.append(card); }
}

function showMetric(metric) {
  $('#metric-dialog-title').textContent = metric.name;
  const body = $('#metric-dialog-body'); clear(body);
  for (const [name, value] of [['当前值', metric.value], ['计算口径', metric.description], ['数据来源', metric.source], ['答辩解释', metric.interpretation]]) { const row = document.createElement('div'); row.append(textNode('dt', name), textNode('dd', value)); body.append(row); }
  $('#metric-dialog').showModal();
}

async function render(result, run) {
  state.current = result; $('#trace-title').textContent = result.title; $('#trace-id').textContent = `trace_id: ${result.traceId}`;
  const outcome = $('#outcome'); outcome.textContent = label(result.outcome); outcome.className = `outcome ${/REVIEW|COMPLETED|ESCALATE/.test(result.outcome) ? 'ok' : 'warn'}`;
  const verification = $('#verification'); verification.textContent = result.verification === 'server-validated' ? '服务器联调已通过' : '稳定回放'; verification.className = `verification ${result.verification}`;
  $('#trace-summary').replaceChildren(textNode('span', `${result.domain === 'security' ? '安全运营 Agent' : '恶意样本 Agent'} · ${result.reply}`));
  renderTable('#log-view', result.logs, ['timestamp', 'level', 'state', 'message', 'decision'], '暂无日志');
  renderTable('#audit-view', result.audit, ['traceId', 'capability', 'boundary', 'result', 'evidence'], '此路径没有能力调用审计。');
  state.metrics.total += 1; state.metrics[result.domain] += 1;
  if (!['HUMAN_REVIEW_REQUIRED', 'COMPLETED', 'NEEDS_REVIEW', 'ESCALATE'].includes(result.outcome)) state.metrics.nonSuccess += 1;
  renderMetrics(); await renderTimeline(result, run);
}

async function replay(id, userText) {
  const response = await fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: id }) });
  if (!response.ok) throw new Error('replay_failed');
  const result = await response.json(); appendMessage('user', userText); appendMessage('bot', result.reply); const run = ++state.run; await render(result, run);
}

function selectTab(button) {
  document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('.panel').forEach((item) => item.classList.toggle('active', item.id === button.dataset.tab));
}

async function boot() {
  [state.cases, state.config] = await Promise.all([fetch('/api/cases').then((res) => res.json()), fetch('/api/config').then((res) => res.json())]);
  $('#mode').textContent = `${state.config.mode.toUpperCase()} MODE`; renderCases(); renderMetrics();
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { state.domain = button.dataset.domain; document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderCases(); }));
  document.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => selectTab(button)));
  $('#open-portainer').addEventListener('click', () => state.config.portainerUrl ? window.open(state.config.portainerUrl, '_blank', 'noopener') : alert('未配置 PORTAINER_URL。'));
  $('#prompt').addEventListener('input', (event) => { if (event.target.value !== state.preparedText) clearPrepared(); });
  $('#chat-form').addEventListener('submit', async (event) => { event.preventDefault(); const input = $('#prompt'); const message = input.value.trim(); if (!message) return; const id = message === state.preparedText && state.preparedCaseId ? state.preparedCaseId : caseForMessage(message); input.value = ''; clearPrepared(); try { await replay(id, message); } catch { appendMessage('bot', '回放服务失败，请检查 demo-console 容器日志。'); } });
}
boot().catch(() => { $('#conversation').replaceChildren(textNode('article', '控制台初始化失败，请检查 demo-console 容器日志。', 'bot')); });
