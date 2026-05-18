// ===== Utils =====

const fmt = {
  tokens: n => {
    if (n == null) return '—';
    if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
    return String(Math.round(n));
  },
  usd:  n => n == null ? '—' : `$${n.toFixed(4)}`,
  pct:  n => n == null ? '—' : `${Number(n).toFixed(1)}%`,
  date: s => s ? new Date(s).toLocaleDateString() : '—',
  ago:  s => {
    if (!s) return '—';
    const ms = Date.now() - new Date(s).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  },
};

const COLOR = {
  input:       '#4d8af0',
  output:      '#f09a4d',
  cacheCreate: '#9a4df0',
  cacheRead:   '#4df09a',
  ok:    '#4df09a',
  warn:  '#f0d44d',
  error: '#f04d4d',
  dim:   '#7a7d96',
};

function statusIcon(s) {
  if (s === 'ok')    return '<span class="status-ok">✓</span>';
  if (s === 'warn')  return '<span class="status-warn">⚠</span>';
  if (s === 'error') return '<span class="status-error">✕</span>';
  return '';
}
function statusClass(s) {
  return s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'error' ? 'error' : '';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ===== API =====

async function api(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body = {}) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ===== Toast =====

let toastTimer = null;
function toast(msg, dur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  el.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.hidden = true, 300); }, dur);
}

// ===== Charts =====

const charts = {};
function initChart(id) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return null;
  charts[id]?.dispose();
  const c = echarts.init(el, 'dark', { renderer: 'svg' });
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el.parentElement ?? el);
  charts[id] = c;
  return c;
}

const BASE_OPTION = {
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis', confine: true },
  grid: { left: 56, right: 12, top: 32, bottom: 24 },
  textStyle: { color: COLOR.dim },
  axisLabel: { color: COLOR.dim },
};

// ===== Providers =====

let allProviders = [];
let currentProviderId = null;

async function loadProviders() {
  let list = null;
  let fetchError = null;
  try {
    list = await api('/providers');
  } catch (e) {
    fetchError = e;
    console.warn('Failed to load /api/providers:', e);
  }
  allProviders = Array.isArray(list) ? list : [];

  const sel  = document.getElementById('provider-select');
  const wrap = document.getElementById('provider-switcher');

  if (fetchError) {
    wrap.hidden = true;
    showEmptyBanner(`Could not reach /api/providers (${fetchError.message}). The server may be running an older build — restart it (Ctrl+C, then \`bun run server.ts\`) and reload this page.`);
    return;
  }

  if (allProviders.length === 0) {
    wrap.hidden = true;
    showEmptyBanner('No data sources are configured. Add an entry to src/providers/index.ts.');
    return;
  }

  sel.innerHTML = allProviders.map(p =>
    `<option value="${esc(p.id)}"${p.hasData ? '' : ' disabled'}>${esc(p.label)}${p.hasData ? '' : ' — no data'}</option>`
  ).join('');
  wrap.hidden = false;

  // Default selection: stored choice (still valid + has data) → first with data → first overall.
  const stored = localStorage.getItem('provider');
  const storedValid = allProviders.some(p => p.id === stored && p.hasData);
  const firstWithData = allProviders.find(p => p.hasData);
  currentProviderId = storedValid ? stored : (firstWithData?.id ?? allProviders[0].id);
  sel.value = currentProviderId;

  updateProviderUI();

  sel.addEventListener('change', () => {
    currentProviderId = sel.value;
    localStorage.setItem('provider', currentProviderId);
    updateProviderUI();
    loadTab(currentTab);
  });
}

function currentProviderInfo() {
  return allProviders.find(p => p.id === currentProviderId) ?? null;
}

function updateProviderUI() {
  const info = currentProviderInfo();
  const pill = document.getElementById('provider-data-pill');
  if (info && !info.hasData) {
    pill.textContent = 'no data';
    pill.hidden = false;
    showEmptyBanner(`No data found for ${info.label}. Expected location: ${info.dataDir}`);
  } else {
    pill.hidden = true;
    showEmptyBanner(null);
  }
}

function showEmptyBanner(msg) {
  const banner = document.getElementById('empty-data-banner');
  const desc = document.getElementById('empty-banner-desc');
  if (msg) {
    desc.textContent = msg;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// ===== Tabs =====

let currentTab = 'dashboard';
const tabData = {};

function switchTab(tab) {
  currentTab = tab;
  location.hash = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(s => s.hidden = s.id !== `tab-${tab}`);
  loadTab(tab);
}

function loadTab(tab) {
  if (tab === 'dashboard') loadDashboard();
  else if (tab === 'audit') loadAudit();
  else if (tab === 'sessions') loadSessions();
  else if (tab === 'settings') loadSettings();
}

// ===== Dashboard =====

async function loadDashboard() {
  const ago30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const calls = [
    ['stats',        '/stats'],
    ['series',       '/timeseries?days=30'],
    ['models',       `/models?since=${ago30}`],
    ['projects',     '/projects'],
    ['topSessions',  '/top-sessions?limit=10'],
  ];

  // allSettled so a single missing endpoint (e.g. server not restarted after
  // a new endpoint was added) doesn't blank out the whole dashboard.
  const results = await Promise.allSettled(calls.map(([, path]) => api(path)));

  const data = {};
  const failures = [];
  results.forEach((r, i) => {
    const key = calls[i][0];
    if (r.status === 'fulfilled') data[key] = r.value;
    else { data[key] = null; failures.push({ path: calls[i][1], err: r.reason }); }
  });

  if (failures.length === calls.length) {
    document.getElementById('kpi-row').innerHTML = `<p class="text-error">All dashboard endpoints failed: ${esc(failures[0].err.message)}</p>`;
    return;
  }
  for (const f of failures) console.warn(`Dashboard endpoint failed: ${f.path} —`, f.err.message);

  if (data.stats)       renderKpiCards(data.stats);
  if (data.series)      renderTrendChart(data.series);
  if (data.models)      renderModelsChart(data.models);
  if (data.projects)    renderProjectsChart(data.projects);
  if (data.topSessions) renderTopSessionsChart(data.topSessions);
}

function renderKpiCards(stats) {
  const { today, sevenDays, thirtyDays, cacheHitRate30d, activeSessions } = stats;
  const cacheStatus = cacheHitRate30d >= 50 ? 'ok' : 'warn';
  const cards = [
    { label: 'Today',    value: fmt.tokens(today.total),       sub: `${fmt.tokens(today.input)} in · ${fmt.tokens(today.output)} out`, sub2: `~$${today.totalCost?.toFixed(2) ?? '?'} API-equiv` },
    { label: '7 days',   value: fmt.tokens(sevenDays.total),   sub: `${fmt.tokens(sevenDays.input)} in · ${fmt.tokens(sevenDays.output)} out`, sub2: `~$${sevenDays.totalCost?.toFixed(2) ?? '?'} API-equiv` },
    { label: '30 days',  value: fmt.tokens(thirtyDays.total),  sub: `${fmt.tokens(thirtyDays.input)} in · ${fmt.tokens(thirtyDays.output)} out`, sub2: `${fmt.usd(thirtyDays.totalCost)} API-equiv` },
    { label: 'Cache hit', value: fmt.pct(cacheHitRate30d),     sub: '30-day avg', cls: cacheStatus },
    { label: 'Active',   value: String(activeSessions),        sub: 'sessions (5 min window)' },
  ];
  document.getElementById('kpi-row').innerHTML = cards.map(c => `
    <div class="kpi-card ${c.cls ?? ''}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${esc(c.value)}</div>
      <div class="kpi-sub">${esc(c.sub ?? '')}</div>
      ${c.sub2 ? `<div class="kpi-sub2">${esc(c.sub2)}</div>` : ''}
    </div>
  `).join('');
}

function renderTrendChart(series) {
  const chart = initChart('chart-trend');
  if (!chart) return;
  const dates = series.map(d => d.date);
  chart.setOption({
    ...BASE_OPTION,
    legend: { data: ['Input','Output','Cache write','Cache read'], top: 0, textStyle:{color:COLOR.dim} },
    xAxis: { type:'category', data:dates, axisLine:{lineStyle:{color:COLOR.dim}} },
    yAxis: { type:'value', axisLabel:{formatter: v => fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:'#1e2130'}} },
    series: [
      { name:'Input',       type:'bar', stack:'s', data:series.map(d=>d.input),                      itemStyle:{color:COLOR.input} },
      { name:'Output',      type:'bar', stack:'s', data:series.map(d=>d.output),                     itemStyle:{color:COLOR.output} },
      { name:'Cache write', type:'bar', stack:'s', data:series.map(d=>(d.cacheCreate5m??0)+(d.cacheCreate1h??0)), itemStyle:{color:COLOR.cacheCreate} },
      { name:'Cache read',  type:'bar', stack:'s', data:series.map(d=>d.cacheRead),                  itemStyle:{color:COLOR.cacheRead} },
    ],
  });
}

function renderModelsChart(models) {
  const chart = initChart('chart-models');
  if (!chart || !models?.length) return;
  const palette = [COLOR.input, COLOR.output, COLOR.cacheCreate, COLOR.cacheRead, '#f04d4d'];
  const names = models.map(m => m.model.replace('claude-', '').replace(/-(\d)/g, ' $1'));
  chart.setOption({
    ...BASE_OPTION,
    grid: { left: 90, right: 16, top: 8, bottom: 24 },
    legend: { data: ['Input', 'Output', 'Cache write', 'Cache read'], top: 0, textStyle: { color: COLOR.dim, fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: '#1e2130' } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: COLOR.dim, fontSize: 11 } },
    series: [
      { name: 'Input',       type: 'bar', stack: 's', data: models.map(m => m.input),                         itemStyle: { color: COLOR.input } },
      { name: 'Output',      type: 'bar', stack: 's', data: models.map(m => m.output),                        itemStyle: { color: COLOR.output } },
      { name: 'Cache write', type: 'bar', stack: 's', data: models.map(m => (m.cacheCreate5m ?? 0) + (m.cacheCreate1h ?? 0)), itemStyle: { color: COLOR.cacheCreate } },
      { name: 'Cache read',  type: 'bar', stack: 's', data: models.map(m => m.cacheRead),                     itemStyle: { color: COLOR.cacheRead } },
    ],
    tooltip: { trigger: 'axis', formatter: ps => ps[0].name + '<br>' + ps.map(p => `${p.seriesName}: ${fmt.tokens(p.value)}`).join('<br>') },
  });
}

function renderProjectsChart(projects) {
  const chart = initChart('chart-projects');
  if (!chart || !projects?.length) return;
  const top = [...projects].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 10);
  const names = top.map(p => {
    const parts = (p.cwd ?? '').replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || p.cwd || '(unknown)';
  });
  chart.setOption({
    ...BASE_OPTION,
    grid: { left: 110, right: 80, top: 8, bottom: 8 },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: '#1e2130' } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: COLOR.dim, fontSize: 11 } },
    series: [{
      type: 'bar',
      data: top.map(p => p.totalTokens),
      itemStyle: { color: COLOR.input },
      label: { show: true, position: 'right', formatter: p => fmt.tokens(p.value), color: COLOR.dim, fontSize: 10 },
    }],
    tooltip: {
      formatter: (p) => {
        const proj = top[p.dataIndex];
        return `${esc(proj.cwd ?? '?')}<br>${fmt.tokens(proj.totalTokens)} tokens · ${proj.sessionCount} sessions`;
      },
    },
  });
}

function renderTopSessionsChart(sessions) {
  const chart = initChart('chart-top-sessions');
  if (!chart) return;
  if (!sessions?.length) {
    chart.clear();
    chart.setOption({ ...BASE_OPTION, title: { text: 'No sessions yet', left: 'center', top: 'middle', textStyle: { color: COLOR.dim, fontSize: 13, fontWeight: 'normal' } } });
    return;
  }

  // Reverse so the #1 session lands at the top of the horizontal bar chart
  const rows = [...sessions].reverse();
  const labels = rows.map(s => {
    const t = (s.title ?? '').trim() || '(untitled)';
    return t.length > 42 ? t.slice(0, 41) + '…' : t;
  });

  chart.setOption({
    ...BASE_OPTION,
    grid: { left: 240, right: 100, top: 28, bottom: 8 },
    legend: { data: ['Input', 'Output', 'Cache write', 'Cache read'], top: 0, textStyle: { color: COLOR.dim, fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: '#1e2130' } } },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: COLOR.dim, fontSize: 11, width: 230, overflow: 'truncate' },
      axisTick: { show: false },
    },
    series: [
      { name: 'Input',       type: 'bar', stack: 's', data: rows.map(r => r.input),                                            itemStyle: { color: COLOR.input } },
      { name: 'Output',      type: 'bar', stack: 's', data: rows.map(r => r.output),                                           itemStyle: { color: COLOR.output } },
      { name: 'Cache write', type: 'bar', stack: 's', data: rows.map(r => (r.cacheCreate5m ?? 0) + (r.cacheCreate1h ?? 0)),    itemStyle: { color: COLOR.cacheCreate } },
      { name: 'Cache read',  type: 'bar', stack: 's', data: rows.map(r => r.cacheRead),                                        itemStyle: { color: COLOR.cacheRead },
        label: { show: true, position: 'right', formatter: p => fmt.tokens(rows[p.dataIndex].total), color: COLOR.dim, fontSize: 10 } },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: ps => {
        const s = rows[ps[0].dataIndex];
        const lines = [
          `<b>${esc(s.title ?? '(untitled)')}</b>`,
          esc(s.cwd ?? '—'),
          `${s.turn_count ?? 0} turns · ${esc((s.model ?? '').replace('claude-', ''))}`,
          ...ps.map(p => `${p.marker} ${p.seriesName}: ${fmt.tokens(p.value)}`),
          `<b>Total: ${fmt.tokens(s.total)}</b>`,
        ];
        return lines.join('<br>');
      },
    },
  });

  // Click a bar to jump to that session's detail page
  chart.off('click');
  chart.on('click', params => {
    if (params.componentType !== 'series') return;
    const s = rows[params.dataIndex];
    if (s?.session_id) openSessionDetail(s.session_id, s.title ?? '', s.cwd ?? '');
  });
}

// ===== Audit =====

async function loadAudit() {
  const grid = document.getElementById('audit-grid');
  grid.innerHTML = '<div class="audit-card skeleton" style="height:260px"></div>'.repeat(4);
  try {
    const report = await api('/audit');
    grid.innerHTML = '';
    grid.appendChild(buildClaudeMdCard(report.claudeMd));
    grid.appendChild(buildHooksCard(report.hooks));
    grid.appendChild(buildMcpCard(report.mcp, report.sessions30d ?? 0));
    grid.appendChild(buildCacheHitCard(report));
    grid.appendChild(buildSkillsCard(report.skills));
    grid.appendChild(buildPluginsCard(report.plugins));
    grid.appendChild(buildModelMixCard(report.modelMix, report));
  } catch (e) {
    grid.innerHTML = `<p class="text-error">${esc(e.message)}</p>`;
  }
}

function auditCard(title, status, headlineHtml, chartId, chartHeight, fixHtml) {
  const div = document.createElement('div');
  div.className = 'audit-card';
  div.innerHTML = `
    <div class="audit-card-header">
      <span class="audit-card-title">${esc(title)}</span>
      ${statusIcon(status)}
    </div>
    <div class="audit-card-headline text-dim">${headlineHtml}</div>
    <div class="audit-chart" id="${chartId}" style="height:${chartHeight}px"></div>
    <details class="audit-fix">
      <summary>Tips</summary>
      ${fixHtml}
    </details>
  `;
  return div;
}

function buildClaudeMdCard(d) {
  if (!d) return emptyCard('CLAUDE.md');
  const headline = `${fmt.tokens(d.totalTokens)} tokens · ${d.totalWords} words · ${d.sessionCount30d} sessions (30d) · est. ${fmt.tokens(d.estimatedInjectedTokens30d)} injected`;
  const fix = `<ul>
    <li>Move project-specific rules to <code>&lt;project&gt;/.claude/CLAUDE.md</code></li>
    <li>Extract complex patterns into Skills (loaded on demand, not always injected)</li>
    <li>Remove explanatory comments — keep only imperative instructions</li>
  </ul>`;
  const card = auditCard('CLAUDE.md', d.status, headline, 'chart-claudemd', 140, fix);
  setTimeout(() => {
    const chart = initChart('chart-claudemd');
    if (!chart || !d.dailySeries?.length) return;
    const dates = d.dailySeries.map(x => x.date);
    const vals  = d.dailySeries.map(x => x.injectedTokens);
    chart.setOption({ ...BASE_OPTION,
      grid: { left:56, right:12, top:16, bottom:24 },
      xAxis: { type:'category', data:dates, axisLabel:{color:COLOR.dim} },
      yAxis: { type:'value', axisLabel:{formatter:v=>fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:'#1e2130'}} },
      series: [{ type:'line', data:vals, smooth:true, areaStyle:{opacity:.3}, itemStyle:{color:COLOR.blue}, lineStyle:{color:COLOR.blue} }],
      tooltip: { trigger:'axis', formatter: p => `${p[0].name}: ${fmt.tokens(p[0].value)} injected` },
    });
  }, 50);
  return card;
}

function buildHooksCard(d) {
  if (!d) return emptyCard('Hooks');
  const totalFires7d = d.fires7d?.reduce((s,f) => s + f.fires7d, 0) ?? 0;
  const totalTokens7d = d.fires7d?.reduce((s,f) => s + f.estimatedTokens, 0) ?? 0;
  const headline = `${d.entries.length} hook entries · ~${fmt.tokens(totalTokens7d)} tokens / 7 days · ${totalFires7d} estimated fires`;
  const fix = `<ul>
    <li>Disable plugin: <code>claude plugin disable &lt;name&gt;</code></li>
    <li>Remove hook from <code>~/.claude/settings.json</code> under <code>hooks.&lt;event&gt;</code></li>
    <li>Consider if UserPromptSubmit hooks can be replaced with Skills</li>
  </ul>`;
  const card = auditCard('Hooks', d.status, headline, 'chart-hooks', 160, fix);
  setTimeout(() => {
    const chart = initChart('chart-hooks');
    if (!chart || !d.fires7d?.length) return;
    const data = d.fires7d.map(f => ({ name: f.event, value: f.estimatedTokens }));
    chart.setOption({ ...BASE_OPTION,
      grid: { left:160, right:12, top:8, bottom:8 },
      xAxis: { type:'value', axisLabel:{formatter:v=>fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:'#1e2130'}} },
      yAxis: { type:'category', data:data.map(d=>d.name), axisLabel:{color:COLOR.dim} },
      series: [{ type:'bar', data:data.map(d=>d.value), itemStyle:{color:COLOR.purple},
        label:{show:true, position:'right', formatter:p=>fmt.tokens(p.value), color:COLOR.dim} }],
      tooltip: { formatter: p => `${p.name}: ${fmt.tokens(p.value)} est. tokens/7d` },
    });
  }, 50);
  return card;
}

function buildMcpCard(d, sessions30d = 0) {
  if (!d) return emptyCard('MCPs');
  const headline = `${d.servers.length} server${d.servers.length !== 1 ? 's' : ''} · ${d.totalTools} tools · ${fmt.tokens(d.totalSchemaTokens)} schema tokens`;
  const fix = `<ul>
    <li>Remove user-scope server: <code>claude mcp remove &lt;name&gt; -s user</code></li>
    <li>Remove local-scope server: <code>claude mcp remove &lt;name&gt; -s local</code></li>
    <li>Prefer servers with fewer tools to reduce schema token overhead</li>
    <li>Schema tokens are injected every session; reduce servers to save cache budget</li>
    <li>Desktop-scope servers (Claude Desktop app) do not affect Claude Code</li>
  </ul>`;
  const scopeColor = { user:'#4d8af0', 'claude.ai':'#4df09a', desktop:'#7a7d96', local:'#f09a4d', project:'#9a4df0' };
  const card = auditCard('MCPs', d.status, headline, 'chart-mcps', 0, fix);
  const chartEl = card.querySelector('#chart-mcps');
  if (chartEl && d.servers?.length) {
    chartEl.style.height = 'auto';
    const showEst = sessions30d > 0;
    chartEl.innerHTML = `<table style="width:100%;font-size:12px;margin-top:8px;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;color:var(--dim);padding:4px 8px 4px 0;font-weight:500;border-bottom:1px solid var(--border)">Name</th>
        <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border)">Scope</th>
        <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border)">Type</th>
        <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border);text-align:right">Schema tokens</th>
        ${showEst ? `<th style="color:var(--dim);padding:4px 0 4px 8px;font-weight:500;border-bottom:1px solid var(--border);text-align:right" title="schemaTokens × sessions in last 30d (upper bound)">Est. 30d tokens</th>` : ''}
      </tr></thead>
      <tbody>${d.servers.map(s => {
        const sc = s.scope ?? 'user';
        const color = scopeColor[sc] ?? '#7a7d96';
        const est30d = (s.schemaTokens || 0) * sessions30d;
        return `<tr>
          <td style="padding:4px 8px 4px 0;white-space:nowrap"><code style="font-size:11px">${esc(s.name)}</code></td>
          <td style="padding:4px 8px;white-space:nowrap">
            <span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600">${esc(sc)}</span>
          </td>
          <td style="padding:4px 8px;color:var(--dim);font-size:11px">${esc(s.type ?? '—')}</td>
          <td style="padding:4px 8px;text-align:right;color:var(--dim);font-size:11px">${s.schemaTokens ? fmt.tokens(s.schemaTokens) : '—'}</td>
          ${showEst ? `<td style="padding:4px 0 4px 8px;text-align:right;color:var(--dim);font-size:11px">${est30d ? fmt.tokens(est30d) : '—'}</td>` : ''}
        </tr>`;
      }).join('')}</tbody>
    </table>
    ${showEst ? `<p style="color:var(--dim);font-size:10px;margin-top:6px">Est. 30d = schema tokens × ${sessions30d} sessions (upper bound; user/local MCPs inject into every session)</p>` : ''}`;
  } else if (chartEl) {
    chartEl.style.height = 'auto';
    chartEl.innerHTML = '<p style="color:var(--dim);font-size:12px;margin-top:8px">No MCP servers configured.</p>';
  }
  return card;
}

function buildCacheHitCard(report) {
  const rate = report.cacheHitRate30d ?? 0;
  const status = rate >= 50 ? 'ok' : 'warn';
  const headline = `${fmt.pct(rate)} cache hit rate (30-day avg)`;
  const fix = `<ul>
    <li>Enable 1h cache: use <code>/cache</code> command or add cache_control to prompts</li>
    <li>Avoid long idle gaps — 5m cache expires after 5 minutes of inactivity</li>
    <li>Keep CLAUDE.md and system prompts stable across turns (changes bust the cache)</li>
  </ul>`;
  const card = auditCard('Cache hit rate', status, headline, 'chart-cache', 160, fix);
  setTimeout(async () => {
    const chart = initChart('chart-cache');
    if (!chart) return;
    try {
      const series = await api('/timeseries?days=30');
      const rates = series.map(d => {
        const cr = d.cacheRead ?? 0;
        const total = (d.input ?? 0) + (d.cacheCreate5m ?? 0) + (d.cacheCreate1h ?? 0) + cr;
        return total ? +(cr / total * 100).toFixed(1) : 0;
      });
      chart.setOption({ ...BASE_OPTION,
        grid: { left:48, right:12, top:16, bottom:24 },
        xAxis: { type:'category', data:series.map(d=>d.date), axisLabel:{color:COLOR.dim} },
        yAxis: { type:'value', min:0, max:100, axisLabel:{formatter:v=>`${v}%`, color:COLOR.dim}, splitLine:{lineStyle:{color:'#1e2130'}} },
        series: [{
          type:'line', data:rates, smooth:true,
          areaStyle:{ color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{offset:0,color:'rgba(77,240,154,.3)'},{offset:1,color:'rgba(77,240,154,.02)'}] }},
          lineStyle:{color:COLOR.green}, itemStyle:{color:COLOR.green},
          markLine:{ silent:true, data:[{yAxis:50,lineStyle:{color:COLOR.yellow,type:'dashed'}}], label:{formatter:'50% threshold', color:COLOR.yellow} },
        }],
        tooltip: { trigger:'axis', formatter: p=>`${p[0].name}: ${p[0].value}%` },
      });
    } catch { /* skip chart on error */ }
  }, 50);
  return card;
}

function buildSkillsCard(d) {
  if (!d) return emptyCard('Skills');
  const headline = `${d.count} skills installed`;
  const fix = `<ul>
    <li>Skills are loaded on demand (progressive disclosure) — no per-session overhead</li>
    <li>Unused skills do not consume tokens; no action needed</li>
    <li>Remove a skill: delete <code>~/.claude/skills/&lt;name&gt;/</code></li>
  </ul>`;
  const card = auditCard('Skills', 'ok', headline, 'chart-skills', 0, fix);
  const chartEl = card.querySelector('#chart-skills');
  if (chartEl && d.skills.length) {
    chartEl.style.height = 'auto';
    chartEl.innerHTML = `<table style="width:100%;font-size:12px;margin-top:4px;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;color:var(--dim);padding:4px 8px 4px 0;font-weight:500;border-bottom:1px solid var(--border)">Name</th>
        <th style="text-align:right;color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border)">SKILL.md tokens</th>
        <th style="text-align:left;color:var(--dim);padding:4px 0 4px 8px;font-weight:500;border-bottom:1px solid var(--border)">Description</th>
      </tr></thead>
      <tbody>${d.skills.map(s=>`<tr>
        <td style="padding:3px 8px 3px 0;white-space:nowrap"><code style="font-size:11px">${esc(s.name)}</code></td>
        <td style="text-align:right;padding:3px 8px;color:var(--dim);font-size:11px">${s.tokens ? fmt.tokens(s.tokens) : '—'}</td>
        <td style="color:var(--dim);padding:3px 0 3px 8px;font-size:11px">${esc(s.description)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  return card;
}

function buildPluginsCard(d) {
  if (!d) return emptyCard('Plugins');
  const headline = d.installed.length
    ? `${d.installed.length} plugin(s) installed`
    : 'No plugins installed';
  const fix = `<ul>
    <li>Plugins may inject additional hooks, MCPs, or skills</li>
    <li>Uninstall: <code>claude plugin uninstall &lt;name&gt;</code></li>
    <li>Review injected hooks/MCPs in the Hooks and MCP cards above</li>
  </ul>`;
  const card = auditCard('Plugins', 'ok', headline, 'chart-plugins', 0, fix);
  const chartEl = card.querySelector('#chart-plugins');
  if (chartEl && d.installed.length) {
    chartEl.style.height = 'auto';
    chartEl.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
      ${d.installed.map(p=>`<span style="background:var(--bg3);border:1px solid var(--border);
        border-radius:4px;padding:2px 8px;font-size:11px;color:var(--dim)">${esc(p.name)} ${p.version?`<span style="opacity:.5">${esc(p.version)}</span>`:''}</span>`).join('')}
    </div>`;
  }
  return card;
}

function buildModelMixCard(d, report) {
  if (!d) return emptyCard('Model mix');
  const topModel = Object.entries(d.totals ?? {}).sort((a,b)=>b[1]-a[1])[0];
  const headline = topModel ? `Dominant: ${topModel[0]} (${fmt.tokens(topModel[1])} tokens, 30d)` : 'No data yet';
  const fix = `<ul>
    <li>Switch to a lighter model for routine tasks: <code>/model claude-haiku-4-5</code></li>
    <li>Opus is 15× more expensive than Haiku per token</li>
    <li>Reserve Opus for complex reasoning; use Sonnet or Haiku for coding/editing</li>
  </ul>`;
  const card = auditCard('Model mix', d.status, headline, 'chart-modelmix', 160, fix);
  setTimeout(async () => {
    const chart = initChart('chart-modelmix');
    if (!chart) return;
    try {
      const models = await api('/models');
      if (!models.length) return;
      const palette = [COLOR.blue, COLOR.orange, COLOR.purple, COLOR.green, COLOR.yellow];
      chart.setOption({ ...BASE_OPTION,
        legend: { top:0, textStyle:{color:COLOR.dim} },
        xAxis: { type:'category', data:models.map(m=>m.model.replace('claude-','').replace(/-(\d)/g,' $1')), axisLabel:{color:COLOR.dim, rotate:15} },
        yAxis: { type:'value', axisLabel:{formatter:v=>fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:'#1e2130'}} },
        series: [{ type:'bar', data:models.map((m,i)=>({value:m.total, itemStyle:{color:palette[i%palette.length]}})),
          label:{show:true, position:'top', formatter:p=>fmt.tokens(p.value), color:COLOR.dim, fontSize:10} }],
        tooltip: { formatter: p => `${p.name}: ${fmt.tokens(p.value)} tokens` },
      });
    } catch { /* skip */ }
  }, 50);
  return card;
}

function emptyCard(title) {
  const d = document.createElement('div');
  d.className = 'audit-card';
  d.innerHTML = `<div class="audit-card-header"><span class="audit-card-title">${esc(title)}</span></div>
    <div class="text-dim">No data</div>`;
  return d;
}

// ===== Sessions =====

let sessionsState = { page: 0, limit: 50, search: '', project: '', sort: 'last_seen_at' };

async function loadSessions(reset = true) {
  if (reset) sessionsState.page = 0;
  const { page, limit, search, project } = sessionsState;
  const offset = page * limit;
  const params = new URLSearchParams({ limit, offset, ...(search ? {search} : {}), ...(project ? {project} : {}) });
  try {
    const [data, projects] = await Promise.all([
      api(`/sessions?${params}`),
      api('/projects'),
    ]);
    renderSessionsTable(data.rows, data.total);
    renderProjectFilter(projects);
  } catch (e) {
    document.getElementById('sessions-table-wrap').innerHTML = `<p class="text-error">${esc(e.message)}</p>`;
  }
}

function renderProjectFilter(projects) {
  const sel = document.getElementById('project-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All projects</option>' +
    projects.map(p => `<option value="${esc(p.cwd)}" ${p.cwd===cur?'selected':''}>${esc(p.cwd ?? '(unknown)')}</option>`).join('');
}

function renderSessionsTable(rows, total) {
  document.getElementById('sessions-count').textContent = `${total} session${total!==1?'s':''}`;
  const { page, limit } = sessionsState;
  const totalPages = Math.ceil(total / limit);
  document.getElementById('sessions-page').textContent = `${page+1} / ${Math.max(1,totalPages)}`;
  document.getElementById('sessions-prev').disabled = page === 0;
  document.getElementById('sessions-next').disabled = page >= totalPages - 1;

  if (!rows.length) {
    document.getElementById('sessions-table-wrap').innerHTML = '<p class="text-dim" style="padding:24px 0">No sessions found.</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr>
      <th></th><th>Title</th><th>Project</th><th>Model</th>
      <th class="td-num">Turns</th><th class="td-num">Total tokens</th>
      <th class="td-num">Input</th><th class="td-num">Cache read</th>
      <th class="td-num">Output</th><th>Last active</th>
    </tr></thead>
    <tbody>${rows.map(r => {
      const title = r.title ?? 'Untitled';
      const cwd   = r.cwd ?? '';
      return `<tr>
      <td style="padding:0 6px 0 0"><button class="btn-sm btn-view" data-sid="${esc(r.session_id)}" data-title="${esc(title)}" data-cwd="${esc(cwd)}">View</button></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(title)}">${esc(title)}</td>
      <td class="td-dim" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(cwd)}">${esc(cwd.split(/[/\\]/).pop() || '—')}</td>
      <td class="td-dim">${esc((r.model??'').replace('claude-','').replace(/-(\d)/g,' $1'))}</td>
      <td class="td-num">${r.turn_count}</td>
      <td class="td-num">${fmt.tokens(r.total)}</td>
      <td class="td-num td-dim">${fmt.tokens(r.input)}</td>
      <td class="td-num td-dim">${fmt.tokens(r.cacheRead)}</td>
      <td class="td-num td-dim">${fmt.tokens(r.output)}</td>
      <td class="td-dim">${fmt.ago(r.last_seen_at)}</td>
    </tr>`;
    }).join('')}</tbody>
  `;
  table.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', () => {
      openSessionDetail(btn.dataset.sid, btn.dataset.title, btn.dataset.cwd);
    });
  });
  document.getElementById('sessions-table-wrap').replaceChildren(table);
}

// ===== Settings =====

async function loadSettings() {
  try {
    const [thresholds, pricing] = await Promise.all([api('/audit/thresholds'), api('/audit/pricing')]);
    renderThresholds(thresholds);
    renderPricing(pricing);
  } catch (e) {
    document.getElementById('thresholds-form').textContent = `Error: ${e.message}`;
  }
}

const THRESHOLD_LABELS = {
  claudeMdWordsWarn:     ['CLAUDE.md words (warn)', 'words'],
  claudeMdWordsError:    ['CLAUDE.md words (error)', 'words'],
  userPromptSubmitHooks: ['UserPromptSubmit hooks', ''],
  sessionStartHooks:     ['SessionStart hooks', ''],
  mcpServers:            ['MCP server count', ''],
  mcpSchemaTokens:       ['MCP schema tokens', 'tok'],
  cacheHitRateMin:       ['Min cache hit rate', '%'],
  singleTurnTokensWarn:  ['Single-turn warn threshold', 'tok'],
  singleSessionTokensWarn: ['Single-session warn threshold', 'tok'],
};

function renderThresholds(t) {
  const form = document.getElementById('thresholds-form');
  form.innerHTML = Object.entries(THRESHOLD_LABELS).map(([key, [label, unit]]) => `
    <div class="threshold-row" data-key="${key}">
      <span class="threshold-label">${label}</span>
      <span class="threshold-val" data-val="${t[key]}">${fmt.tokens(t[key])}</span>
      <span class="threshold-unit">${unit}</span>
    </div>
  `).join('');

  form.querySelectorAll('.threshold-val').forEach(el => {
    el.addEventListener('click', () => startEditThreshold(el));
  });
}

function startEditThreshold(el) {
  const raw = el.dataset.val;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'threshold-input';
  input.value = raw;
  el.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const key = input.closest('[data-key]')?.dataset.key;
    const val = parseFloat(input.value);
    if (!isNaN(val) && key) {
      try {
        await apiPut('/audit/thresholds', { [key]: val });
        toast('Threshold saved');
      } catch { toast('Save failed'); }
    }
    loadSettings();
  };
  input.addEventListener('keydown', e => { if (e.key==='Enter') commit(); else if (e.key==='Escape') loadSettings(); });
  input.addEventListener('blur', commit);
}

function renderPricing(p) {
  const form = document.getElementById('pricing-form');
  const models = Object.entries(p.models ?? {});
  form.innerHTML = `<table style="width:100%;font-size:12px">
    <thead><tr>
      <th style="text-align:left;padding:6px 0;color:var(--dim)">Model</th>
      <th style="text-align:right;color:var(--dim);padding:0 8px">Input</th>
      <th style="text-align:right;color:var(--dim);padding:0 8px">Output</th>
    </tr></thead>
    <tbody>${models.map(([model, mp]) => `<tr>
      <td style="padding:6px 0;color:var(--dim)">${esc(model)}</td>
      <td class="td-num" style="padding:0 8px">$${mp.inputPer1M}</td>
      <td class="td-num" style="padding:0 8px">$${mp.outputPer1M}</td>
    </tr>`).join('')}</tbody>
  </table>
  <p class="text-dim" style="font-size:11px;margin-top:8px">Edit <code>data/pricing.json</code> to update. Cache write 5m: 1.25× input · 1h: 2× · read: 0.1×</p>`;
}

// ===== Init =====

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-rerun').addEventListener('click', async () => {
    const btn = document.getElementById('btn-rerun');
    btn.disabled = true;
    btn.textContent = 'Running…';
    try {
      await apiPost('/audit/refresh');
      toast('Audit refreshed');
      if (currentTab === 'audit') loadAudit();
    } catch (e) {
      toast(`Error: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Re-run audit';
    }
  });

  let searchTimer = null;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      sessionsState.search = e.target.value;
      loadSessions();
    }, 300);
  });

  document.getElementById('project-filter').addEventListener('change', e => {
    sessionsState.project = e.target.value;
    loadSessions();
  });

  document.getElementById('sessions-prev').addEventListener('click', () => {
    if (sessionsState.page > 0) { sessionsState.page--; loadSessions(false); }
  });
  document.getElementById('sessions-next').addEventListener('click', () => {
    sessionsState.page++;
    loadSessions(false);
  });

  await loadProviders();

  const validTabs = ['dashboard', 'audit', 'sessions', 'settings'];
  const hashTab = location.hash.replace('#', '');
  const initialTab = validTabs.includes(hashTab) ? hashTab : 'dashboard';
  switchTab(initialTab);
});

// ===== Session Detail — Flowchart =====

function toolCategory(name) {
  if (name === 'Agent') return 'agent';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'tool';
}

const FLOW_COLORS = {
  user:       { bg: '#0c1a2e', border: '#4d8af0', text: '#7ab3f0' },
  activities: { bg: '#0e1a14', border: '#4df09a', text: '#4df09a' },
  response:   { bg: '#1a1a2a', border: '#7a7a9a', text: '#a0a0c0' },
  agent:      { bg: '#180d2b', border: '#9a4df0', text: '#bf8af0' },
  summary:    { bg: '#1a1a1a', border: '#3a3a4a', text: '#6a6a8a' },
};

// Build a directed flowchart from session turns.
// Each conversation round = 3 nodes: User Prompt → Activities → Response.
// Sub-agents branch right from the Activities node. Caps at MAX_ROUNDS rounds.
function buildFlowGraph(turns, _title) {
  const NODE_W = 220, NODE_H = 56;
  const INNER_GAP = 28;   // gap between nodes within a conversation
  const ROUND_GAP = 60;   // gap between conversation cards (group padding adds the rest)
  const BRANCH_X = NODE_W + 70;  // x offset for sub-agent column
  const AGENT_V_GAP = NODE_H + 22;  // vertical spacing between stacked sub-agent nodes

  // === Step 1: group turns into conversation rounds ===
  // A round = one human turn + all following assistant activity until the next human.
  // Assistant turns WITH tool calls → activities (tools, MCP, agents).
  // Assistant turns with ONLY text and NO tool calls → final reply.
  const rounds = [];
  let cur = null;

  for (const turn of turns) {
    if (turn.kind === 'human') {
      if (cur) rounds.push(cur);
      cur = { userMsg: turn.text || '', toolCalls: [], agents: [], replyTexts: [] };
    } else if (turn.kind === 'assistant') {
      if (!cur) cur = { userMsg: '', toolCalls: [], agents: [], replyTexts: [] };
      if ((turn.toolCalls?.length ?? 0) > 0) {
        // This is an activity turn — collect tool calls and agent spawns
        for (const tc of turn.toolCalls) {
          const result = (turn.toolResults || []).find(r => r.toolUseId === tc.id) || null;
          if (toolCategory(tc.name) === 'agent') {
            let label = 'Sub-Agent';
            try {
              const inp = JSON.parse(tc.inputSummary.length < 300 ? tc.inputSummary : '{}');
              label = inp.description || inp.prompt?.slice(0, 50) || 'Sub-Agent';
            } catch { /* ignore */ }
            cur.agents.push({ tc, result, label });
          } else {
            cur.toolCalls.push({ tc, result });
          }
        }
      } else if (turn.text?.trim()) {
        // No tool calls + has text → this is the final reply
        cur.replyTexts.push(turn.text.trim());
      }
    }
  }
  if (cur) rounds.push(cur);

  // === Step 2: layout nodes ===
  const nodes = [];
  const edges = [];
  const groups = [];
  let mainY = 0;
  let prevId = null;
  let visibleIdx = 0;

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    const hasTools = round.toolCalls.length > 0;
    const hasAgents = round.agents.length > 0;
    const replyText = round.replyTexts.join(' ').trim();

    // Skip rounds that are just CLI commands (e.g. /model, /clear) with no AI activity or reply
    if (!hasTools && !hasAgents && !replyText) continue;

    // Pre-compute the Final Reply id so sub-agent return edges can reference it before it's created
    const respId = replyText ? `${i}_r` : null;
    const roundStartY = mainY;

    // --- User Prompt node ---
    const promptId = `${i}_p`;
    const promptText = round.userMsg.trim().replace(/\n+/g, ' ');
    // No hard truncation here — the renderer uses foreignObject + CSS ellipsis,
    // so the node always fits and hover shows the full text via <title>.
    const promptLabel = (promptText || 'Tool Round').slice(0, 240);
    nodes.push({ id: promptId, name: promptLabel, kind: 'user', x: 0, y: mainY,
      actData: { ...round, _nodeKind: 'user' } });
    if (prevId) edges.push({ source: prevId, target: promptId, branch: false });
    mainY += NODE_H + INNER_GAP;

    // --- Activities node + Sub-Agent nodes (both parallel children of User Prompt) ---
    let lastMainId = promptId;
    const parallelY = mainY;

    if (hasTools) {
      const actId = `${i}_a`;
      const mcpCt = round.toolCalls.filter(c => c.tc.name.startsWith('mcp__')).length;
      const plainToolCt = round.toolCalls.length - mcpCt;
      const parts = [];
      if (plainToolCt > 0) parts.push(`${plainToolCt} tool${plainToolCt !== 1 ? 's' : ''}`);
      if (mcpCt > 0) parts.push(`${mcpCt} MCP`);
      nodes.push({ id: actId, name: parts.join(' · ') || 'Activities', kind: 'activities',
        x: 0, y: parallelY, actData: { ...round, _nodeKind: 'activities' } });
      edges.push({ source: promptId, target: actId, branch: false });
      lastMainId = actId;
    }

    // Sub-agents: parallel to Activities, both children of User Prompt.
    // Each also links back to the Final Reply (return branch).
    for (let j = 0; j < round.agents.length; j++) {
      const ag = round.agents[j];
      const aid = `${i}_ag${j}`;
      const agLabel = ag.label.slice(0, 200);
      nodes.push({ id: aid, name: agLabel, kind: 'agent', x: BRANCH_X,
        y: parallelY + j * AGENT_V_GAP, actData: ag });
      edges.push({ source: promptId, target: aid, branch: true });
      if (respId) edges.push({ source: aid, target: respId, returnBranch: true });
    }

    // Advance mainY past the taller of Activities or the sub-agent stack
    if (hasTools || hasAgents) {
      const agentStackH = hasAgents ? (round.agents.length - 1) * AGENT_V_GAP + NODE_H : 0;
      mainY = parallelY + Math.max(hasTools ? NODE_H : 0, agentStackH) + INNER_GAP;
    }

    // --- Final Reply node ---
    if (respId) {
      const respText = replyText.replace(/\n+/g, ' ');
      const respLabel = respText.slice(0, 240);
      nodes.push({ id: respId, name: respLabel, kind: 'response', x: 0, y: mainY,
        actData: { ...round, _nodeKind: 'response' } });
      edges.push({ source: lastMainId, target: respId, branch: false });
      mainY += NODE_H + INNER_GAP;
      prevId = respId;
    } else {
      prevId = lastMainId;
    }

    // Record group bounds (yStart..yEnd covers the inside of the card, padding added at render)
    groups.push({
      label: `ROUND ${visibleIdx + 1}`,
      yStart: roundStartY,
      yEnd: mainY - INNER_GAP,
      hasBranch: hasAgents,
    });
    visibleIdx++;

    mainY += ROUND_GAP;
  }

  return { nodes, edges, groups, activities: rounds };
}

// Render flowchart as plain SVG with fixed-pixel nodes (no auto-scaling).
// Main flow column is horizontally centered in the container. Container scrolls if tall.
function renderFlowSVG(container, flowNodes, flowEdges, onNodeClick, flowGroups = []) {
  const NW = 220, NH = 56, PAD = 32;
  const BRANCH_X = NW + 70;  // must match buildFlowGraph
  const GROUP_PAD_X = 24, GROUP_PAD_TOP = 48, GROUP_PAD_BOTTOM = 26;
  const hasGroups = flowGroups.length > 0;

  // Center the main column within the container (leave room for group padding on the left)
  const containerW = Math.max(container.clientWidth || 0, 300);
  const hasAgents = flowNodes.some(n => n.x > 0);
  const contentW = hasAgents ? BRANCH_X + NW : NW;
  const minLeft = PAD + (hasGroups ? GROUP_PAD_X : 0);
  const cx = Math.max(minLeft, Math.floor((containerW - contentW) / 2));

  function nodeX(node) { return node.x === 0 ? cx : cx + BRANCH_X; }

  const ys = flowNodes.map(n => n.y);
  const oy = hasGroups ? GROUP_PAD_TOP + 4 : PAD;
  const bottomPad = hasGroups ? GROUP_PAD_BOTTOM + 12 : PAD;
  const svgW = Math.max(containerW, cx + contentW + Math.max(PAD, GROUP_PAD_X) + 4);
  const svgH = Math.max(...ys) + NH + oy + bottomPad;

  const p = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" style="display:block">`,
    `<defs>
      <marker id="fah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4a5568"/></marker>
      <marker id="fahb" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#7c3aed"/></marker>
      <linearGradient id="grpGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6b7fc4" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#6b7fc4" stop-opacity="0.02"/>
      </linearGradient>
      <linearGradient id="grpAccent" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7ab3f0" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#7c3aed" stop-opacity="0.75"/>
      </linearGradient>
    </defs>`,
  ];

  // Draw conversation group cards first (behind nodes/edges)
  for (let gi = 0; gi < flowGroups.length; gi++) {
    const g = flowGroups[gi];
    const gx = cx - GROUP_PAD_X;
    const gy = g.yStart + oy - GROUP_PAD_TOP;
    const gw = (g.hasBranch ? BRANCH_X + NW : NW) + GROUP_PAD_X * 2;
    const gh = (g.yEnd - g.yStart) + GROUP_PAD_TOP + GROUP_PAD_BOTTOM;
    // Card
    p.push(`<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="16" fill="url(#grpGrad)" stroke="rgba(120,140,200,0.22)" stroke-width="1"/>`);
    // Left accent strip
    p.push(`<rect x="${gx + 1}" y="${gy + 18}" width="3" height="${Math.max(0, gh - 36)}" rx="1.5" fill="url(#grpAccent)"/>`);
    // Round number chip (positioned above the first node, with breathing room)
    const chipW = 86, chipH = 20, chipX = gx + 16, chipY = gy + 12;
    p.push(`<rect x="${chipX}" y="${chipY}" width="${chipW}" height="${chipH}" rx="10" fill="rgba(120,140,200,0.18)" stroke="rgba(120,140,200,0.40)" stroke-width="0.6"/>`);
    p.push(`<text x="${chipX + chipW/2}" y="${chipY + 14}" text-anchor="middle" fill="#b6c4e8" font-size="10" font-weight="700" font-family="system-ui,sans-serif" letter-spacing="1.2">${esc(g.label)}</text>`);
  }

  for (const e of flowEdges) {
    const s = flowNodes.find(n => n.id === e.source);
    const t = flowNodes.find(n => n.id === e.target);
    if (!s || !t) continue;
    const sx = nodeX(s), tx = nodeX(t);
    if (e.branch) {
      // Forward branch: left column → right column (horizontal bezier)
      const x1 = sx + NW, y1 = s.y + oy + NH / 2;
      const x2 = tx, y2 = t.y + oy + NH / 2;
      const mx = (x1 + x2) / 2;
      p.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke="#7c3aed" stroke-width="1.5" fill="none" marker-end="url(#fahb)"/>`);
    } else if (e.returnBranch) {
      // Return branch: right column → left column (sub-agent → final reply, dashed)
      const x1 = sx + NW / 2, y1 = s.y + oy + NH;
      const x2 = tx + NW / 2, y2 = t.y + oy;
      const midy = (y1 + y2) / 2;
      p.push(`<path d="M${x1},${y1} C${x1},${midy} ${x2},${midy} ${x2},${y2}" stroke="#7c3aed" stroke-width="1.5" fill="none" stroke-dasharray="5,3" marker-end="url(#fahb)"/>`);
    } else {
      const lineX = sx + NW / 2;
      p.push(`<line x1="${lineX}" y1="${s.y + oy + NH}" x2="${lineX}" y2="${t.y + oy - 5}" stroke="#4a5568" stroke-width="1.5" marker-end="url(#fah)"/>`);
    }
  }

  for (const node of flowNodes) {
    const c = FLOW_COLORS[node.kind] || FLOW_COLORS.summary;
    const nx = nodeX(node), ny = node.y + oy;
    const bold = node.kind === 'user' ? '600' : '500';
    const label = esc((node.name || '').replace(/\s+/g, ' ').trim());
    p.push(`<g class="fnode" data-nid="${esc(String(node.id))}" style="cursor:${node.actData ? 'pointer' : 'default'}">`);
    p.push(`<title>${label}</title>`);
    p.push(`<rect x="${nx}" y="${ny}" width="${NW}" height="${NH}" rx="9" fill="${c.bg}" stroke="${c.border}" stroke-width="2"/>`);
    p.push(`<foreignObject x="${nx}" y="${ny}" width="${NW}" height="${NH}" pointer-events="none">`);
    p.push(`<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:6px 14px;box-sizing:border-box;overflow:hidden"><span style="font:${bold} 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;color:${c.text};text-align:center;max-width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word">${label}</span></div>`);
    p.push(`</foreignObject>`);
    p.push('</g>');
  }

  p.push('</svg>');
  container.innerHTML = p.join('');

  container.querySelectorAll('.fnode').forEach(el => {
    const nid = el.dataset.nid;
    const node = flowNodes.find(n => String(n.id) === nid);
    if (!node?.actData) return;
    el.addEventListener('click', () => onNodeClick(node));
    const rect = el.querySelector('rect');
    el.addEventListener('mouseenter', () => { if (rect) rect.style.filter = 'brightness(1.3)'; });
    el.addEventListener('mouseleave', () => { if (rect) rect.style.filter = ''; });
  });
}

async function openSessionDetail(sessionId, title, cwd) {
  const sdPage = document.getElementById('sd-page');
  const sdBody = document.getElementById('sd-body');
  const canvasEl = document.getElementById('sd-canvas');
  const detailEl = document.getElementById('sd-detail');

  document.getElementById('modal-title').textContent = title || 'Session';
  document.getElementById('modal-subtitle').textContent = cwd ? `${cwd}  ·  ${sessionId}` : sessionId;
  document.getElementById('sd-stats').textContent = '';
  canvasEl.innerHTML = '<div class="sd-placeholder text-dim">Loading…</div>';
  detailEl.innerHTML = '<div class="sd-placeholder text-dim">Loading…</div>';

  sdBody.classList.remove('show-detail');
  document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'map'));

  sdPage.hidden = false;
  document.body.style.overflow = 'hidden';

  try {
    const turns = await api(`/session/${sessionId}`);

    // Build flowchart and compute stats
    const { nodes: flowNodes, edges: flowEdges, groups: flowGroups, activities } = buildFlowGraph(turns, title || 'Session');
    let totalTools = 0, totalMcp = 0, totalAgents = 0, totalPrompts = 0;
    for (const round of activities) {
      if (round.userMsg?.trim()) totalPrompts++;
      for (const { tc } of (round.toolCalls || [])) {
        if (tc.name.startsWith('mcp__')) totalMcp++;
        else totalTools++;
      }
      totalAgents += (round.agents || []).length;
    }
    document.getElementById('sd-stats').textContent =
      `${totalPrompts} input${totalPrompts !== 1 ? 's' : ''} · ${totalTools} tool call${totalTools !== 1 ? 's' : ''} · ${totalMcp} MCP · ${totalAgents} agent${totalAgents !== 1 ? 's' : ''}`;

    if (turns.length === 0) {
      canvasEl.innerHTML = '<div class="sd-placeholder text-dim">No turn data found.</div>';
      detailEl.innerHTML = '';
      return;
    }

    renderFlowSVG(canvasEl, flowNodes, flowEdges, showFlowNodeDetail, flowGroups);
    detailEl.innerHTML = '<div class="sd-placeholder text-dim">← Click a node to view details</div>';

  } catch (e) {
    canvasEl.innerHTML = '';
    detailEl.innerHTML = `<p class="text-error">${esc(e.message)}</p>`;
  }
}

function showFlowNodeDetail(nodeData) {
  const el = document.getElementById('sd-detail');
  el.innerHTML = '';

  const { kind, actData } = nodeData;

  if (!actData) {
    el.innerHTML = '<div class="sd-placeholder text-dim">Select a node to view details</div>';
    return;
  }

  const hdr = document.createElement('div');
  hdr.className = 'sd-turn-header';
  el.appendChild(hdr);

  const tl = document.createElement('div');
  tl.className = 'tl';

  if (kind === 'user') {
    hdr.textContent = 'User Prompt';
    tl.appendChild(tlEntry('human', '○', `
      <div class="tl-card human">
        <div class="tl-text">${esc(actData.userMsg)}</div>
      </div>`));

  } else if (kind === 'activities') {
    const toolCt = actData.toolCalls?.length || 0;
    const mcpCt = actData.toolCalls?.filter(c => c.tc.name.startsWith('mcp__')).length || 0;
    const parts = [];
    if (toolCt - mcpCt > 0) parts.push(`${toolCt - mcpCt} tool${toolCt - mcpCt !== 1 ? 's' : ''}`);
    if (mcpCt > 0) parts.push(`${mcpCt} MCP`);
    hdr.textContent = `Activities  ·  ${parts.join(', ') || '0 tools'}`;

    for (const { tc, result } of (actData.toolCalls || [])) {
      const displayName = tc.name.startsWith('mcp__') ? tc.name.replace(/^mcp__[^_]+__/, '') : tc.name;
      const isMcp = tc.name.startsWith('mcp__');
      const iconCls = isMcp ? 'mcp' : 'tool';
      tl.appendChild(tlEntry(iconCls, '⚙', `
        <div class="tl-card ${iconCls}">
          <div class="tl-tool-name ${iconCls}">${esc(isMcp ? 'MCP' : 'Tool')}: ${esc(displayName)}</div>
          <div class="tl-text dim">${esc(tc.inputSummary)}</div>
        </div>`));
      if (result) {
        const cls = result.isError ? 'result-err' : 'result-ok';
        tl.appendChild(tlEntry(cls, result.isError ? '✗' : '✓', `
          <div class="tl-card ${cls}">
            <div class="tl-label ${cls}">${result.isError ? 'Error' : 'Result'}</div>
            <div class="tl-text dim">${esc(result.content)}</div>
          </div>`));
      }
    }

  } else if (kind === 'response') {
    hdr.textContent = 'Final Reply';
    const responseText = actData.replyTexts?.join('\n') || '';
    tl.appendChild(tlEntry('human', '◇', `
      <div class="tl-card" style="border-color:#7a7a9a;border-left:3px solid #7a7a9a">
        <div class="tl-text">${esc(responseText)}</div>
      </div>`));

  } else if (kind === 'agent') {
    hdr.textContent = 'Sub-Agent';
    tl.appendChild(tlEntry('mcp', '◈', `
      <div class="tl-card mcp">
        <div class="tl-tool-name mcp">Sub-Agent: ${esc(actData.label || 'Sub-Agent')}</div>
        <div class="tl-text dim">${esc(actData.tc?.inputSummary || '')}</div>
      </div>`));
    if (actData.result) {
      const cls = actData.result.isError ? 'result-err' : 'result-ok';
      tl.appendChild(tlEntry(cls, actData.result.isError ? '✗' : '✓', `
        <div class="tl-card ${cls}">
          <div class="tl-label ${cls}">${actData.result.isError ? 'Error' : 'Result'}</div>
          <div class="tl-text dim">${esc(actData.result.content)}</div>
        </div>`));
    }
  }

  el.appendChild(tl);
  el.scrollTop = 0;

  if (window.innerWidth <= 640) {
    document.getElementById('sd-body')?.classList.add('show-detail');
    document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'detail'));
  }
}

function tlEntry(iconClass, iconGlyph, bodyHtml) {
  const div = document.createElement('div');
  div.className = 'tl-entry';
  div.innerHTML = `<div class="tl-icon ${iconClass}">${iconGlyph}</div><div class="tl-body">${bodyHtml}</div>`;
  return div;
}

function buildHumanEntry(turn) {
  const ts = turn.timestamp ? new Date(turn.timestamp).toLocaleTimeString() : '';
  return tlEntry('human', '○', `
    <div class="tl-ts">${esc(ts)}</div>
    <div class="tl-card human">
      <div class="tl-label human">Human</div>
      <div class="tl-text">${esc(turn.text)}</div>
    </div>`);
}


function closeSessionDetail() {
  document.getElementById('sd-page').hidden = true;
  document.body.style.overflow = '';
}
document.getElementById('sd-back-btn').addEventListener('click', closeSessionDetail);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('sd-page').hidden) closeSessionDetail();
});
document.querySelectorAll('.sd-panel-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const body = document.getElementById('sd-body');
    if (btn.dataset.panel === 'detail') {
      body.classList.add('show-detail');
    } else {
      body.classList.remove('show-detail');
    }
  });
});
