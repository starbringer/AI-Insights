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

// Soft, warm data palette — readable on both the cream and slate themes.
const COLOR = {
  input:       '#5f93d1',
  output:      '#e3a838',
  cacheCreate: '#a98cd6',
  cacheRead:   '#5fb98f',
  ok:    '#5fb98f',
  warn:  '#e3a838',
  error: '#df7b6b',
  dim:   '#9b9486',
  blue:  '#5f93d1',
  orange:'#e3a838',
  green: '#5fb98f',
  purple:'#a98cd6',
  yellow:'#e3a838',
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

// Read a CSS custom property off the document root.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function gridLine() { return cssVar('--grid-line') || 'rgba(0,0,0,.08)'; }

// Theme-aware colors for chart chrome, recomputed whenever the theme changes.
function chartTheme() {
  return {
    dim:     cssVar('--text-dim') || '#999',
    text:    cssVar('--text')     || '#333',
    grid:    gridLine(),
    surface: cssVar('--surface')  || '#fff',
    border:  cssVar('--sh-dark')  || '#ccc',
  };
}

// (Re)register the shared ECharts theme so tooltips match the active palette.
function registerEchartsTheme() {
  if (!window.echarts) return;
  const t = chartTheme();
  echarts.registerTheme('app', {
    textStyle: { color: t.dim },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.border,
      textStyle: { color: t.text },
      extraCssText: 'border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.20);',
    },
  });
}

function initChart(id) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return null;
  charts[id]?.dispose();
  const c = echarts.init(el, 'app', { renderer: 'svg' });
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el.parentElement ?? el);
  charts[id] = c;
  return c;
}

function baseOption() {
  const t = chartTheme();
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', confine: true },
    // containLabel lets ECharts measure axis labels and keep them inside the
    // canvas, so million-scale y-axis values are never clipped at the edge.
    grid: { left: 8, right: 14, top: 32, bottom: 8, containLabel: true },
    textStyle: { color: t.dim },
    axisLabel: { color: t.dim },
  };
}

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

const PAGE_META = {
  dashboard: ['Dashboard', 'Token usage at a glance'],
  audit:     ['Configuration Audit', 'Data-driven findings about your Claude Code setup'],
  runs:      ['Runs', 'Browse and inspect every recorded run'],
  settings:  ['Settings', 'Tune audit thresholds and reference pricing'],
};

function switchTab(tab) {
  currentTab = tab;
  location.hash = tab;
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(s => s.hidden = s.id !== `tab-${tab}`);
  const meta = PAGE_META[tab];
  if (meta) {
    document.getElementById('page-title').textContent = meta[0];
    document.getElementById('page-subtitle').textContent = meta[1];
  }
  loadTab(tab);
}

function loadTab(tab) {
  if (tab === 'dashboard') loadDashboard();
  else if (tab === 'audit') loadAudit();
  else if (tab === 'runs') loadRuns();
  else if (tab === 'settings') loadSettings();
}

// ===== Dashboard =====

// Every token-usage chart carries its own time-range switcher.
const RANGES = [['1h', 'Last 1 hour'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];

const chartRanges = (() => {
  try { return { ...JSON.parse(localStorage.getItem('chartRanges') || '{}') }; }
  catch { return {}; }
})();
function chartRange(key) {
  return RANGES.some(([r]) => r === chartRanges[key]) ? chartRanges[key] : '30d';
}

const CHART_LOADERS = {
  trend:    async r => renderTrendChart(await api(`/timeseries?range=${r}`)),
  models:   async r => renderModelsChart(await api(`/models?range=${r}`)),
  projects: async r => renderProjectsChart(await api(`/projects?range=${r}`)),
  mcp:      async r => renderMcpUsageChart(await api(`/mcp-usage?range=${r}`)),
  skills:   async r => renderSkillUsageChart(await api(`/skill-usage?range=${r}`)),
  topRuns:  async r => renderTopRunsChart(await api(`/top-runs?limit=10&range=${r}`)),
};

function initRangeGroups() {
  document.querySelectorAll('.range-group').forEach(group => {
    const key = group.dataset.chart;
    if (!CHART_LOADERS[key]) return;
    group.innerHTML = RANGES.map(([r, label]) =>
      `<button class="range-btn${chartRange(key) === r ? ' active' : ''}" data-range="${r}" title="${esc(label)}">${esc(r)}</button>`
    ).join('');
    group.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chartRanges[key] = btn.dataset.range;
        localStorage.setItem('chartRanges', JSON.stringify(chartRanges));
        group.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b === btn));
        CHART_LOADERS[key](btn.dataset.range).catch(e => console.warn(`Chart ${key} failed:`, e.message));
      });
    });
  });
}

async function loadDashboard() {
  const jobs = [
    ['stats', async () => renderKpiCards(await api('/stats'))],
    ...Object.entries(CHART_LOADERS).map(([key, load]) => [key, () => load(chartRange(key))]),
  ];

  // allSettled so a single missing endpoint (e.g. server not restarted after
  // a new endpoint was added) doesn't blank out the whole dashboard.
  const results = await Promise.allSettled(jobs.map(([, run]) => run()));

  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') failures.push({ key: jobs[i][0], err: r.reason });
  });
  if (failures.length === jobs.length) {
    document.getElementById('kpi-row').innerHTML = `<p class="text-error">All dashboard endpoints failed: ${esc(failures[0].err.message)}</p>`;
    return;
  }
  for (const f of failures) console.warn(`Dashboard section failed: ${f.key} —`, f.err.message);
}

const SVG_A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const KPI_ICONS = {
  today:  `<svg ${SVG_A}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
  week:   `<svg ${SVG_A}><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>`,
  month:  `<svg ${SVG_A}><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 14h3M13.5 14h3"/></svg>`,
  cache:  `<svg ${SVG_A}><path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/></svg>`,
  active: `<svg ${SVG_A}><path d="M4 19v-5M10 19v-9M16 19v-13M22 19V8"/></svg>`,
};

function renderKpiCards(stats) {
  const { today, sevenDays, thirtyDays, cacheHitRate30d, activeRuns } = stats;
  const cacheStatus = cacheHitRate30d >= 50 ? 'ok' : 'warn';
  const cards = [
    { icon: 'today',  label: 'Today',     value: fmt.tokens(today.total),       sub: `${fmt.tokens(today.input)} in · ${fmt.tokens(today.output)} out`, sub2: `~$${today.totalCost?.toFixed(2) ?? '?'} API-equiv` },
    { icon: 'week',   label: '7 days',    value: fmt.tokens(sevenDays.total),   sub: `${fmt.tokens(sevenDays.input)} in · ${fmt.tokens(sevenDays.output)} out`, sub2: `~$${sevenDays.totalCost?.toFixed(2) ?? '?'} API-equiv` },
    { icon: 'month',  label: '30 days',   value: fmt.tokens(thirtyDays.total),  sub: `${fmt.tokens(thirtyDays.input)} in · ${fmt.tokens(thirtyDays.output)} out`, sub2: `${fmt.usd(thirtyDays.totalCost)} API-equiv` },
    { icon: 'cache',  label: 'Cache hit', value: fmt.pct(cacheHitRate30d),      sub: '30-day average', cls: cacheStatus },
    { icon: 'active', label: 'Active',    value: String(activeRuns ?? 0),       sub: 'runs · 5 min window' },
  ];
  document.getElementById('kpi-row').innerHTML = cards.map(c => `
    <div class="kpi-card ${c.cls ?? ''}">
      <div class="kpi-icon">${KPI_ICONS[c.icon] ?? ''}</div>
      <div class="kpi-body">
        <div class="kpi-label">${esc(c.label)}</div>
        <div class="kpi-value">${esc(c.value)}</div>
        <div class="kpi-sub">${esc(c.sub ?? '')}</div>
        ${c.sub2 ? `<div class="kpi-sub2">${esc(c.sub2)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTrendChart(series) {
  const chart = initChart('chart-trend');
  if (!chart) return;
  const dates = series.map(d => d.date);
  chart.setOption({
    ...baseOption(),
    legend: { data: ['Input','Output','Cache write','Cache read'], top: 0, textStyle:{color:COLOR.dim} },
    xAxis: { type:'category', data:dates, axisLine:{lineStyle:{color:COLOR.dim}} },
    yAxis: { type:'value', axisLabel:{formatter: v => fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:gridLine()}} },
    series: [
      { name:'Input',       type:'bar', stack:'s', data:series.map(d=>d.input),                      itemStyle:{color:COLOR.input} },
      { name:'Output',      type:'bar', stack:'s', data:series.map(d=>d.output),                     itemStyle:{color:COLOR.output} },
      { name:'Cache write', type:'bar', stack:'s', data:series.map(d=>(d.cacheCreate5m??0)+(d.cacheCreate1h??0)), itemStyle:{color:COLOR.cacheCreate} },
      { name:'Cache read',  type:'bar', stack:'s', data:series.map(d=>d.cacheRead),                  itemStyle:{color:COLOR.cacheRead} },
    ],
  });
}

// Range switches can land on an empty window — without an explicit empty
// state the previous range's bars would linger on screen.
function renderChartEmpty(chart, text) {
  chart.clear();
  chart.setOption({ ...baseOption(), title: { text, left: 'center', top: 'middle', textStyle: { color: COLOR.dim, fontSize: 13, fontWeight: 'normal' } } });
}

function renderModelsChart(models) {
  const chart = initChart('chart-models');
  if (!chart) return;
  if (!models?.length) return renderChartEmpty(chart, 'No usage in this range');
  const palette = [COLOR.input, COLOR.output, COLOR.cacheCreate, COLOR.cacheRead, '#f04d4d'];
  const names = models.map(m => m.model.replace('claude-', '').replace(/-(\d)/g, ' $1'));
  chart.setOption({
    ...baseOption(),
    grid: { left: 6, right: 16, top: 30, bottom: 6, containLabel: true },
    legend: { data: ['Input', 'Output', 'Cache write', 'Cache read'], top: 0, textStyle: { color: COLOR.dim, fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: gridLine() } } },
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
  if (!chart) return;
  const top = (projects ?? []).filter(p => p.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 10);
  if (!top.length) return renderChartEmpty(chart, 'No usage in this range');
  const names = top.map(p => {
    const parts = (p.cwd ?? '').replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || p.cwd || '(unknown)';
  });
  chart.setOption({
    ...baseOption(),
    grid: { left: 6, right: 80, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: gridLine() } } },
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
        return `${esc(proj.cwd ?? '?')}<br>${fmt.tokens(proj.totalTokens)} tokens · ${proj.runCount ?? 0} runs · ${proj.agentCount ?? 0} agents`;
      },
    },
  });
}

// Shared renderer for the MCP / Skill usage cards: horizontal bars of
// estimated tokens with call counts, plus an in-chart empty state.
function renderUsageBarChart(chartId, rows, color, emptyText, tooltipFor) {
  const chart = initChart(chartId);
  if (!chart) return;
  if (!rows?.length) return renderChartEmpty(chart, emptyText);
  const top = rows.slice(0, 10).reverse(); // largest at the top of the bar chart
  chart.setOption({
    ...baseOption(),
    grid: { left: 6, right: 76, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: gridLine() } } },
    yAxis: { type: 'category', data: top.map(r => r.name), axisLabel: { color: COLOR.dim, fontSize: 11 } },
    series: [{
      type: 'bar', barMaxWidth: 22,
      data: top.map(r => r.tokens),
      itemStyle: { color },
      label: { show: true, position: 'right', formatter: p => fmt.tokens(p.value), color: COLOR.dim, fontSize: 10 },
    }],
    tooltip: { formatter: p => tooltipFor(top[p.dataIndex]) },
  });
}

function renderMcpUsageChart(servers) {
  renderUsageBarChart(
    'chart-mcp-usage',
    (servers ?? []).map(s => ({ ...s, name: s.server })),
    COLOR.purple,
    'No MCP tool calls in this range',
    s => {
      const toolLines = (s.tools ?? []).slice(0, 8)
        .map(t => `${esc(t.tool)}: ${t.calls} call${t.calls !== 1 ? 's' : ''} · ${fmt.tokens(t.tokens)}`);
      return [`<b>${esc(s.server)}</b>`,
              `${s.calls} call${s.calls !== 1 ? 's' : ''} · ~${fmt.tokens(s.tokens)} tokens (est.)`,
              ...toolLines].join('<br>');
    });
}

function renderSkillUsageChart(skills) {
  renderUsageBarChart(
    'chart-skill-usage',
    (skills ?? []).map(s => ({ ...s, name: s.skill })),
    COLOR.green,
    'No skill invocations in this range',
    s => `<b>${esc(s.skill)}</b><br>${s.calls} invocation${s.calls !== 1 ? 's' : ''} · ~${fmt.tokens(s.tokens)} tokens (est.)`);
}

function renderTopRunsChart(runs) {
  const chart = initChart('chart-top-runs');
  if (!chart) return;
  if (!runs?.length) {
    chart.clear();
    chart.setOption({ ...baseOption(), title: { text: 'No runs yet', left: 'center', top: 'middle', textStyle: { color: COLOR.dim, fontSize: 13, fontWeight: 'normal' } } });
    return;
  }

  // Reverse so the #1 run lands at the top of the horizontal bar chart
  const rows = [...runs].reverse();
  const labels = rows.map(s => {
    const t = (s.title ?? '').trim() || '(untitled)';
    const suffix = (s.agent_count ?? 1) > 1 ? `  · ${s.agent_count} agents` : '';
    const trimmed = t.length > 42 ? t.slice(0, 41) + '…' : t;
    return `${trimmed}${suffix}`;
  });

  chart.setOption({
    ...baseOption(),
    grid: { left: 260, right: 100, top: 28, bottom: 8 },
    legend: { data: ['Input', 'Output', 'Cache write', 'Cache read'], top: 0, textStyle: { color: COLOR.dim, fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: gridLine() } } },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: COLOR.dim, fontSize: 11, width: 250, overflow: 'truncate' },
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
          `${s.agent_count ?? 1} agent${(s.agent_count ?? 1) === 1 ? '' : 's'} · ${s.turn_count ?? 0} turns · ${esc((s.model ?? '').replace('claude-', ''))}`,
          ...ps.map(p => `${p.marker} ${p.seriesName}: ${fmt.tokens(p.value)}`),
          `<b>Total: ${fmt.tokens(s.total)}</b>`,
        ];
        return lines.join('<br>');
      },
    },
  });

  // Click a bar to jump to that run's detail page
  chart.off('click');
  chart.on('click', params => {
    if (params.componentType !== 'series') return;
    const s = rows[params.dataIndex];
    if (s?.run_id) openRunDetail(s.run_id, s.title ?? '', s.cwd ?? '');
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
    grid.appendChild(buildMcpCard(report.mcp, report.agents30d ?? 0));
    grid.appendChild(buildCacheHitCard(report));
    grid.appendChild(buildSkillsCard(report.skills));
    grid.appendChild(buildSettingsCard(report.settings));
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
  const fileCt = d.files?.length ?? 0;
  const headline = `${fileCt} file${fileCt !== 1 ? 's' : ''} · ${fmt.tokens(d.totalTokens)} tokens · ${d.totalWords} words · ${d.agentCount30d ?? 0} agents (30d) · est. ${fmt.tokens(d.estimatedInjectedTokens30d)} injected`;
  const fileRows = (d.files ?? []).map(f =>
    `<li><code>${esc(f.label)}</code> — ${fmt.tokens(f.tokens)} tokens / ${f.words} words</li>`).join('');
  const fix = `<ul>
    ${fileRows}
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
    chart.setOption({ ...baseOption(),
      grid: { left:8, right:14, top:16, bottom:8, containLabel:true },
      xAxis: { type:'category', data:dates, axisLabel:{color:COLOR.dim} },
      yAxis: { type:'value', axisLabel:{formatter:v=>fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:gridLine()}} },
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
  const headline = `${d.entries.length} hook entries · ${totalFires7d} recorded fires / 7 days · ~${fmt.tokens(totalTokens7d)} tokens`;
  const fix = `<ul>
    <li>Disable plugin: <code>claude plugin disable &lt;name&gt;</code></li>
    <li>Remove hook from <code>~/.claude/settings.json</code> under <code>hooks.&lt;event&gt;</code></li>
    <li>Consider if UserPromptSubmit hooks can be replaced with Skills</li>
  </ul>`;
  const card = auditCard('Hooks', d.status, headline, 'chart-hooks', 160, fix);
  setTimeout(() => {
    const chart = initChart('chart-hooks');
    if (!chart || !d.fires7d?.length) return;
    const data = d.fires7d.map(f => ({ name: f.event, value: f.fires7d }));
    chart.setOption({ ...baseOption(),
      grid: { left:6, right:58, top:8, bottom:8, containLabel:true },
      xAxis: { type:'value', axisLabel:{formatter:v=>fmt.tokens(v), color:COLOR.dim}, splitLine:{lineStyle:{color:gridLine()}} },
      yAxis: { type:'category', data:data.map(d=>d.name), axisLabel:{color:COLOR.dim, fontSize:10} },
      series: [{ type:'bar', data:data.map(d=>d.value), itemStyle:{color:COLOR.purple},
        label:{show:true, position:'right', formatter:p=>fmt.tokens(p.value), color:COLOR.dim} }],
      tooltip: { formatter: p => {
        const f = d.fires7d[p.dataIndex];
        return `${esc(p.name)}: ${f?.fires7d ?? 0} fires · ~${fmt.tokens(f?.estimatedTokens ?? 0)} est. tokens/7d`;
      } },
    });
  }, 50);
  return card;
}

function buildMcpCard(d, sessions30d = 0) {
  if (!d) return emptyCard('MCPs');
  const headline = `${d.servers.length} server${d.servers.length !== 1 ? 's' : ''} · ${d.totalTools} tools · ${fmt.tokens(d.totalSchemaTokens)} schema tokens`;
  const fix = `<ul>
    <li>Servers are read from <code>~/.claude.json</code> (user + local scope) and each project's <code>.mcp.json</code> (project scope)</li>
    <li>Remove user-scope server: <code>claude mcp remove &lt;name&gt; -s user</code></li>
    <li>Remove local-scope server: <code>claude mcp remove &lt;name&gt; -s local</code></li>
    <li>Prefer servers with fewer tools to reduce schema token overhead</li>
    <li>Schema tokens are injected every session; reduce servers to save cache budget</li>
  </ul>`;
  const scopeColor = { user:'#4d8af0', 'claude.ai':'#4df09a', desktop:'#7a7d96', local:'#f09a4d', project:'#9a4df0' };
  const card = auditCard('MCPs', d.status, headline, 'chart-mcps', 0, fix);
  const chartEl = card.querySelector('#chart-mcps');
  if (!chartEl) return card;
  chartEl.style.height = 'auto';

  const diagHtml = d.diagnostics?.length
    ? `<details class="mcp-diagnostics"><summary>${d.diagnostics.length} diagnostic${d.diagnostics.length !== 1 ? 's' : ''}</summary>
        <ul>${d.diagnostics.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`
    : '';

  if (!d.servers?.length) {
    chartEl.innerHTML = `<p style="color:var(--dim);font-size:12px;margin-top:8px">No MCP servers found in
      <code>~/.claude.json</code> (user/local scope) or any project's <code>.mcp.json</code>.</p>${diagHtml}`;
    return card;
  }

  const showEst = sessions30d > 0;
  chartEl.innerHTML = `<table class="mcp-table" style="width:100%;font-size:12px;margin-top:8px;border-collapse:collapse">
    <thead><tr>
      <th style="text-align:left;color:var(--dim);padding:4px 8px 4px 0;font-weight:500;border-bottom:1px solid var(--border)">Name</th>
      <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border)">Scope</th>
      <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border)">Type</th>
      <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border);text-align:right">Tools</th>
      <th style="color:var(--dim);padding:4px 8px;font-weight:500;border-bottom:1px solid var(--border);text-align:right">Schema tokens</th>
      ${showEst ? `<th style="color:var(--dim);padding:4px 0 4px 8px;font-weight:500;border-bottom:1px solid var(--border);text-align:right" title="schemaTokens × sessions in last 30d (upper bound)">Est. 30d tokens</th>` : ''}
    </tr></thead>
    <tbody>${d.servers.map((s, i) => {
      const sc = s.scope ?? 'user';
      const color = scopeColor[sc] ?? '#7a7d96';
      const est30d = (s.schemaTokens || 0) * sessions30d;
      const expandable = (s.tools?.length ?? 0) > 0;
      const hint = expandable ? `<span class="mcp-expand-caret">▸</span> ` : '';
      const scopeTitle = s.project ? `${sc} — ${s.project}` : sc;
      return `<tr class="mcp-server-row${expandable ? ' expandable' : ''}" data-idx="${i}" title="${esc(s.source ?? '')}">
        <td style="padding:4px 8px 4px 0;white-space:nowrap">${hint}<code style="font-size:11px">${esc(s.name)}</code></td>
        <td style="padding:4px 8px;white-space:nowrap">
          <span title="${esc(scopeTitle)}" style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600">${esc(sc)}</span>
        </td>
        <td style="padding:4px 8px;color:var(--dim);font-size:11px">${esc(s.type ?? '—')}</td>
        <td style="padding:4px 8px;text-align:right;color:var(--dim);font-size:11px">${s.toolCount || (s.probeError ? `<span class="status-warn" title="${esc(s.probeError)}">?</span>` : '—')}</td>
        <td style="padding:4px 8px;text-align:right;color:var(--dim);font-size:11px">${s.schemaTokens ? fmt.tokens(s.schemaTokens) : '—'}</td>
        ${showEst ? `<td style="padding:4px 0 4px 8px;text-align:right;color:var(--dim);font-size:11px">${est30d ? fmt.tokens(est30d) : '—'}</td>` : ''}
      </tr>
      ${expandable ? `<tr class="mcp-tools-row" data-for="${i}" hidden><td colspan="${showEst ? 6 : 5}">
        <div class="mcp-tools-list">${s.tools.map((t, ti) => `
          <div class="mcp-tool" data-tool="${i}:${ti}">
            <div class="mcp-tool-head">
              <code>${esc(t.name)}</code>
              <span class="mcp-tool-tokens">${fmt.tokens(t.tokens)} tok</span>
            </div>
            ${t.description ? `<div class="mcp-tool-desc">${esc(t.description)}</div>` : ''}
            <details class="mcp-tool-schema"><summary>Input schema</summary>
              <pre>${esc(JSON.stringify(t.inputSchema, null, 2) ?? 'null')}</pre>
            </details>
          </div>`).join('')}
        </div>
      </td></tr>` : ''}`;
    }).join('')}</tbody>
  </table>
  ${showEst ? `<p style="color:var(--dim);font-size:10px;margin-top:6px">Est. 30d = schema tokens × ${sessions30d} agents in the last 30 days (upper bound; user/local MCPs inject into every session)</p>` : ''}
  ${diagHtml}`;

  // Click a server row to expand its tool list with schemas.
  chartEl.querySelectorAll('.mcp-server-row.expandable').forEach(row => {
    row.addEventListener('click', () => {
      const detail = chartEl.querySelector(`.mcp-tools-row[data-for="${row.dataset.idx}"]`);
      if (!detail) return;
      detail.hidden = !detail.hidden;
      row.classList.toggle('open', !detail.hidden);
      const caret = row.querySelector('.mcp-expand-caret');
      if (caret) caret.textContent = detail.hidden ? '▸' : '▾';
    });
  });
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
      chart.setOption({ ...baseOption(),
        grid: { left:48, right:12, top:16, bottom:24 },
        xAxis: { type:'category', data:series.map(d=>d.date), axisLabel:{color:COLOR.dim} },
        yAxis: { type:'value', min:0, max:100, axisLabel:{formatter:v=>`${v}%`, color:COLOR.dim}, splitLine:{lineStyle:{color:gridLine()}} },
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
  const card = auditCard('Model mix', d.status, headline, 'chart-modelmix', 210, fix);
  setTimeout(async () => {
    const chart = initChart('chart-modelmix');
    if (!chart) return;
    try {
      const ago30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const models = await api(`/models?since=${ago30}`);
      if (!models.length) return;
      const palette = [COLOR.blue, COLOR.orange, COLOR.purple, COLOR.green, COLOR.yellow];
      // Horizontal bars: model names sit on the y-axis so they're never rotated
      // or clipped; containLabel guarantees the longest name still fits, and the
      // right margin leaves room for the token-count label. Largest model on top.
      const rows = [...models].reverse();
      const names = rows.map(m => m.model.replace('claude-','').replace(/-(\d)/g,' $1'));
      chart.setOption({ ...baseOption(),
        grid: { left: 6, right: 76, top: 14, bottom: 8, containLabel: true },
        // Each bar carries its exact total as an end label, so the x-axis tick
        // numbers are redundant — and they crowd into an unreadable pile on a
        // narrow plot. Hide them; keep the split lines for a sense of scale.
        xAxis: { type:'value', axisLabel:{show:false}, axisTick:{show:false}, splitLine:{lineStyle:{color:gridLine()}} },
        yAxis: { type:'category', data:names, axisLabel:{color:COLOR.dim, fontSize:11}, axisTick:{show:false} },
        series: [{ type:'bar', barMaxWidth:24,
          data: rows.map((m,i)=>({value:m.total, itemStyle:{color:palette[i%palette.length]}})),
          label:{show:true, position:'right', formatter:p=>fmt.tokens(p.value), color:COLOR.dim, fontSize:11} }],
        tooltip: { trigger:'item', formatter: p => `${esc(p.name)}: ${fmt.tokens(p.value)} tokens` },
      });
    } catch { /* skip */ }
  }, 50);
  return card;
}

function buildSettingsCard(d) {
  if (!d) return emptyCard('Settings');
  const headline = d.model
    ? `Default model: <code>${esc(d.model)}</code>${d.effortLevel ? ` · effort: ${esc(d.effortLevel)}` : ''}`
    : 'No default model set (per-session choice)';
  const fix = `<ul>
    <li>Change default model: <code>/model</code> or edit <code>~/.claude/settings.json</code></li>
    <li>Prune stale entries from <code>permissions.allow</code> — each is matched on every tool call</li>
    <li>Never enable auto-approve globally; scope permissions per project instead</li>
  </ul>`;
  const card = auditCard('Settings', d.status, headline, 'chart-settings', 0, fix);
  const el = card.querySelector('#chart-settings');
  if (el) {
    el.style.height = 'auto';
    el.innerHTML = `<table style="width:100%;font-size:12px;margin-top:8px;border-collapse:collapse">
      <tbody>
        <tr><td style="padding:4px 8px 4px 0;color:var(--dim)">Allow rules</td><td class="td-num">${d.permissionsAllow ?? 0}</td></tr>
        <tr><td style="padding:4px 8px 4px 0;color:var(--dim)">Deny rules</td><td class="td-num">${d.permissionsDeny ?? 0}</td></tr>
        <tr><td style="padding:4px 8px 4px 0;color:var(--dim)">Auto-approve all</td>
            <td class="td-num">${d.hasAutoApprove ? '<span class="status-warn">⚠ enabled</span>' : 'off'}</td></tr>
      </tbody>
    </table>`;
  }
  return card;
}

function emptyCard(title) {
  const d = document.createElement('div');
  d.className = 'audit-card';
  d.innerHTML = `<div class="audit-card-header"><span class="audit-card-title">${esc(title)}</span></div>
    <div class="text-dim">No data</div>`;
  return d;
}

// ===== Runs =====

let runsState = { page: 0, limit: 50, search: '', project: '', sort: 'last_seen_at' };

async function loadRuns(reset = true) {
  if (reset) runsState.page = 0;
  const { page, limit, search, project } = runsState;
  const offset = page * limit;
  const params = new URLSearchParams({ limit, offset, ...(search ? {search} : {}), ...(project ? {project} : {}) });
  try {
    const [data, projects] = await Promise.all([
      api(`/runs?${params}`),
      api('/projects'),
    ]);
    renderRunsTable(data.rows, data.total);
    renderProjectFilter(projects);
  } catch (e) {
    document.getElementById('runs-table-wrap').innerHTML = `<p class="text-error">${esc(e.message)}</p>`;
  }
}

function renderProjectFilter(projects) {
  const sel = document.getElementById('project-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All projects</option>' +
    projects.map(p => `<option value="${esc(p.cwd)}" ${p.cwd===cur?'selected':''}>${esc(p.cwd ?? '(unknown)')}</option>`).join('');
}

function renderRunsTable(rows, total) {
  document.getElementById('runs-count').textContent = `${total} run${total!==1?'s':''}`;
  const { page, limit } = runsState;
  const totalPages = Math.ceil(total / limit);
  document.getElementById('runs-page').textContent = `${page+1} / ${Math.max(1,totalPages)}`;
  document.getElementById('runs-prev').disabled = page === 0;
  document.getElementById('runs-next').disabled = page >= totalPages - 1;

  if (!rows.length) {
    document.getElementById('runs-table-wrap').innerHTML = '<p class="text-dim" style="padding:24px 0">No runs found.</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr>
      <th></th><th>Title</th><th>Project</th>
      <th class="td-num">Agents</th><th class="td-num">Turns</th>
      <th class="td-num">Total tokens</th>
      <th class="td-num">Input</th><th class="td-num">Cache read</th>
      <th class="td-num">Output</th><th>Last active</th>
    </tr></thead>
    <tbody>${rows.map(r => {
      const title = r.title ?? 'Untitled';
      const cwd   = r.cwd ?? '';
      const agentBadge = (r.agent_count ?? 1) > 1
        ? `<span class="run-agents-badge">× ${r.agent_count}</span>`
        : '';
      return `<tr>
      <td style="padding:0 6px 0 0"><button class="btn-sm btn-view" data-rid="${esc(r.run_id)}" data-title="${esc(title)}" data-cwd="${esc(cwd)}">View</button></td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(title)}">${agentBadge}${esc(title)}</td>
      <td class="td-dim" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(cwd)}">${esc(cwd.split(/[/\\]/).pop() || '—')}</td>
      <td class="td-num">${r.agent_count ?? 1}</td>
      <td class="td-num">${r.turn_count ?? 0}</td>
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
      openRunDetail(btn.dataset.rid, btn.dataset.title, btn.dataset.cwd);
    });
  });
  document.getElementById('runs-table-wrap').replaceChildren(table);
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
  registerEchartsTheme();
  initRangeGroups();

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Light / dark theme toggle — persisted, re-themes charts in place.
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    registerEchartsTheme();
    loadTab(currentTab);
    if (!document.getElementById('sd-page').hidden) refreshSessionDetail();
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
      runsState.search = e.target.value;
      loadRuns();
    }, 300);
  });

  document.getElementById('project-filter').addEventListener('change', e => {
    runsState.project = e.target.value;
    loadRuns();
  });

  document.getElementById('runs-prev').addEventListener('click', () => {
    if (runsState.page > 0) { runsState.page--; loadRuns(false); }
  });
  document.getElementById('runs-next').addEventListener('click', () => {
    runsState.page++;
    loadRuns(false);
  });

  await loadProviders();

  const validTabs = ['dashboard', 'audit', 'runs', 'settings'];
  const runLink = location.hash.match(/^#run=(.+)$/);
  const hashTab = location.hash.replace('#', '');
  const initialTab = validTabs.includes(hashTab) ? hashTab : runLink ? 'runs' : 'dashboard';
  switchTab(initialTab);
  // Deep link: #run=<run_id> opens that run's session-tree page directly.
  if (runLink) openRunDetail(decodeURIComponent(runLink[1]), '', '');
});

// ===== Session Detail — Session Trees =====
//
// One SESSION (run) = one or more AGENTS. Every agent gets its own tree:
// the main agent's tree first, then each sub-agent's tree below it. Inside a
// tree the top level is the chronological spine (prompt → API call → hook →
// …) and children carry what each step did: tool calls with results, MCP
// calls, injected context, thinking, errors. Abandoned uuid branches (edits,
// retries) render as collapsed ⎇ sub-trees.

const NODE_ICON = {
  prompt: '●', assistant: '✦', text: '¶', thinking: '∿',
  context: '✚', hook: '⚡', api_error: '✕', compact: '▣',
  fallback: '⤷', info: '·', branch: '⎇',
};
const CAT_ICON = { tool: '⚙', mcp: '⇄', task: '◈', skill: '❖' };
const KIND_TITLES = {
  prompt: 'User prompt', assistant: 'LLM call', text: 'Assistant text',
  thinking: 'Thinking', tool: 'Tool call', context: 'Injected context',
  hook: 'Hook', api_error: 'API error', compact: 'Context compaction',
  fallback: 'Model fallback', info: 'Info', branch: 'Abandoned branch',
};

let openRunArgs = null;
let currentRunData = null;         // {run, agents}
let treeNodeIndex = new Map();     // nid -> {node, agentId}
let selectedNodeRow = null;

function refreshSessionDetail() {
  if (openRunArgs) openRunDetail(...openRunArgs);
}

function nodeIcon(n) {
  return n.kind === 'tool' ? (CAT_ICON[n.cat] ?? '⚙') : (NODE_ICON[n.kind] ?? '·');
}

function fmtClock(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
}

async function openRunDetail(runId, title, cwd) {
  openRunArgs = [runId, title, cwd];
  const sdPage  = document.getElementById('sd-page');
  const sdBody  = document.getElementById('sd-body');
  const agentsEl = document.getElementById('sd-agents');
  const canvasEl = document.getElementById('sd-canvas');
  const detailEl = document.getElementById('sd-detail');

  document.getElementById('modal-title').textContent = title || 'Run';
  document.getElementById('modal-subtitle').textContent = cwd ? `${cwd}  ·  ${runId}` : runId;
  document.getElementById('sd-stats').textContent = '';
  agentsEl.innerHTML = '<div class="sd-placeholder text-dim">Loading…</div>';
  canvasEl.innerHTML = '<div class="sd-placeholder text-dim">Loading…</div>';
  detailEl.innerHTML = '<div class="sd-placeholder text-dim">← Click a node to view details</div>';

  sdBody.classList.remove('show-detail', 'show-agents');
  document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'map'));

  sdPage.hidden = false;
  document.body.style.overflow = 'hidden';

  try {
    const runData = await api(`/run/${runId}`);
    currentRunData = runData;
    const agents = runData.agents || [];
    if (!title && runData.run?.title) {
      document.getElementById('modal-title').textContent = runData.run.title;
      document.getElementById('modal-subtitle').textContent = runData.run.cwd ? `${runData.run.cwd}  ·  ${runId}` : runId;
    }

    // Fetch every agent's tree in parallel — all trees belong to this session.
    const treeResults = await Promise.allSettled(
      agents.map(a => api(`/agent/${a.agent_id}/tree`))
    );
    const trees = new Map();
    treeResults.forEach((r, i) => {
      if (r.status === 'fulfilled') trees.set(agents[i].agent_id, r.value);
    });

    renderAgentSidebar(runData);
    renderSessionTrees(runData, trees);
    renderSessionStats(trees);
  } catch (e) {
    agentsEl.innerHTML = '';
    canvasEl.innerHTML = '';
    detailEl.innerHTML = `<p class="text-error">${esc(e.message)}</p>`;
  }
}

function renderSessionStats(trees) {
  const sum = { prompts: 0, apiCalls: 0, tools: 0, mcp: 0, tasks: 0, hooks: 0, errors: 0, compactions: 0, branches: 0 };
  for (const t of trees.values()) {
    for (const k of Object.keys(sum)) sum[k] += t.stats?.[k] ?? 0;
  }
  const parts = [
    `${sum.prompts} prompt${sum.prompts !== 1 ? 's' : ''}`,
    `${sum.apiCalls} LLM call${sum.apiCalls !== 1 ? 's' : ''}`,
    `${sum.tools} tool${sum.tools !== 1 ? 's' : ''}`,
  ];
  if (sum.mcp) parts.push(`${sum.mcp} MCP`);
  if (sum.tasks) parts.push(`${sum.tasks} sub-agent${sum.tasks !== 1 ? 's' : ''}`);
  if (sum.hooks) parts.push(`${sum.hooks} hook${sum.hooks !== 1 ? 's' : ''}`);
  if (sum.errors) parts.push(`${sum.errors} error${sum.errors !== 1 ? 's' : ''}`);
  if (sum.compactions) parts.push(`${sum.compactions} compaction${sum.compactions !== 1 ? 's' : ''}`);
  if (sum.branches) parts.push(`${sum.branches} branch${sum.branches !== 1 ? 'es' : ''}`);
  document.getElementById('sd-stats').textContent = parts.join(' · ');
}

function renderAgentSidebar(runData) {
  const el = document.getElementById('sd-agents');
  const agents = runData.agents || [];
  if (agents.length === 0) {
    el.innerHTML = '<div class="sd-placeholder text-dim">No agents</div>';
    return;
  }

  const header = `<div class="sd-agents-title">Agents · ${agents.length}</div>`;
  const items = agents.map(a => {
    const isChild = a.is_subagent === 1;
    const title = a.title?.trim() || a.description?.trim() || '(untitled)';
    const pill = a.agent_type ? `<span class="sd-agent-type-pill">${esc(a.agent_type)}</span>` : '';
    const tokens = fmt.tokens(a.total ?? 0);
    return `<div class="sd-agent-item ${isChild ? 'child' : ''}" data-aid="${esc(a.agent_id)}">
      <div class="sd-agent-title">${pill}${esc(title)}</div>
      <div class="sd-agent-meta">${a.turn_count ?? 0} turns · ${tokens} tokens</div>
    </div>`;
  }).join('');
  el.innerHTML = header + items;

  el.querySelectorAll('.sd-agent-item').forEach(item => {
    item.addEventListener('click', () => focusAgentTree(item.dataset.aid));
  });
}

function focusAgentTree(agentId) {
  document.querySelectorAll('.sd-agent-item').forEach(it => {
    it.classList.toggle('active', it.dataset.aid === agentId);
  });
  const target = document.getElementById(`tree-agent-${agentId}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1200);
  }
  // Mobile: make sure the map panel is visible
  if (window.innerWidth <= 640) {
    const body = document.getElementById('sd-body');
    body.classList.remove('show-detail', 'show-agents');
    document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'map'));
  }
}

// --- tree rendering ---

let _nidCounter = 0;

function renderSessionTrees(runData, trees) {
  const canvasEl = document.getElementById('sd-canvas');
  const agents = runData.agents || [];
  treeNodeIndex = new Map();
  selectedNodeRow = null;
  _nidCounter = 0;

  if (agents.length === 0) {
    canvasEl.innerHTML = '<div class="sd-placeholder text-dim">No agents in this run.</div>';
    return;
  }

  // Sub-agents claimable by Task nodes (matched by description, then order)
  const subagents = agents.filter(a => a.is_subagent === 1);
  const claimed = new Set();
  function claimSubagent(taskDesc) {
    if (taskDesc) {
      const m = subagents.find(a => !claimed.has(a.agent_id) && (a.description === taskDesc || a.title === taskDesc));
      if (m) { claimed.add(m.agent_id); return m.agent_id; }
    }
    const next = subagents.find(a => !claimed.has(a.agent_id));
    if (next && taskDesc !== undefined) { claimed.add(next.agent_id); return next.agent_id; }
    return null;
  }

  const html = [];
  for (const a of agents) {
    const tree = trees.get(a.agent_id);
    const title = a.title?.trim() || a.description?.trim() || '(untitled)';
    const pill = a.agent_type ? `<span class="sd-agent-type-pill">${esc(a.agent_type)}</span>` : '';
    const kindTag = a.is_subagent === 1 ? 'Sub-agent tree' : 'Agent tree';
    html.push(`<section class="tree-agent ${a.is_subagent === 1 ? 'sub' : ''}" id="tree-agent-${esc(a.agent_id)}">`);
    html.push(`<header class="tree-agent-head">
      <span class="tree-agent-kind">${kindTag}</span>
      <span class="tree-agent-title">${pill}${esc(title)}</span>
      <span class="tree-agent-meta">${a.turn_count ?? 0} LLM calls · ${fmt.tokens(a.total ?? 0)} tokens</span>
    </header>`);

    if (!tree || !tree.trees?.length) {
      html.push('<div class="tree-empty text-dim">No transcript data for this agent.</div>');
    } else {
      for (const root of tree.trees) {
        html.push(`<div class="tree-root">`);
        if (tree.trees.length > 1) html.push(`<div class="tree-root-label">${esc(root.label)}</div>`);
        html.push(`<div class="tree-spine">`);
        for (const n of root.spine) html.push(renderNodeHtml(n, a.agent_id, claimSubagent, 0));
        html.push(`</div></div>`);
      }
    }
    html.push('</section>');
  }

  canvasEl.innerHTML = html.join('');

  // Click handling — one delegated listener for rows, toggles, jump links
  canvasEl.onclick = (ev) => {
    const jump = ev.target.closest('.tnode-jump');
    if (jump) {
      ev.stopPropagation();
      focusAgentTree(jump.dataset.target);
      return;
    }
    const toggle = ev.target.closest('.tnode-toggle');
    if (toggle) {
      ev.stopPropagation();
      toggle.closest('.tnode').classList.toggle('collapsed');
      return;
    }
    const row = ev.target.closest('.tnode-row');
    if (row) {
      const rec = treeNodeIndex.get(row.dataset.nid);
      if (rec) {
        if (selectedNodeRow) selectedNodeRow.classList.remove('selected');
        selectedNodeRow = row;
        row.classList.add('selected');
        renderNodeDetail(rec.node, rec.agentId);
      }
    }
  };
}

function renderNodeHtml(n, agentId, claimSubagent, depth) {
  const nid = `n${_nidCounter++}`;
  treeNodeIndex.set(nid, { node: n, agentId });

  let children = n.children || [];
  // An assistant step whose only child is its own text block is redundant —
  // the label already shows the text and the detail panel has the full copy.
  if (n.kind === 'assistant' && children.length === 1 && children[0].kind === 'text') children = [];

  const collapsed = n.kind === 'branch' || depth >= 3;
  const hasKids = children.length > 0;
  const statusCls = n.status ? ` st-${n.status}` : '';
  const catCls = n.cat ? ` cat-${n.cat}` : '';

  // Task tool node → link to the sub-agent's own tree
  let jumpBtn = '';
  if (n.cat === 'task') {
    const target = claimSubagent(n.taskDesc ?? null);
    if (target) jumpBtn = `<button class="tnode-jump" data-target="${esc(target)}" title="Open this sub-agent's tree">tree ↓</button>`;
  }

  const parts = [];
  parts.push(`<div class="tnode k-${esc(n.kind)}${catCls}${collapsed && hasKids ? ' collapsed' : ''}">`);
  parts.push(`<div class="tnode-row${statusCls}" data-nid="${nid}">`);
  parts.push(`<span class="tnode-icon i-${esc(n.cat ?? n.kind)}">${nodeIcon(n)}</span>`);
  parts.push(`<span class="tnode-main">`);
  parts.push(`<span class="tnode-label">${esc(n.label ?? '')}</span>`);
  if (n.sub) parts.push(`<span class="tnode-sub">${esc(n.sub)}</span>`);
  parts.push(`</span>`);
  if (jumpBtn) parts.push(jumpBtn);
  if (n.ts) parts.push(`<span class="tnode-ts">${fmtClock(n.ts)}</span>`);
  if (hasKids) parts.push(`<button class="tnode-toggle" title="Collapse / expand">${'▾'}</button>`);
  parts.push(`</div>`);

  if (hasKids) {
    parts.push(`<div class="tnode-kids">`);
    for (const c of children) parts.push(renderNodeHtml(c, agentId, claimSubagent, depth + 1));
    parts.push(`</div>`);
  }
  parts.push(`</div>`);
  return parts.join('');
}

// --- detail panel ---

function renderNodeDetail(n, agentId) {
  const el = document.getElementById('sd-detail');
  el.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'sd-turn-header';
  const title = n.kind === 'tool'
    ? `${KIND_TITLES.tool}${n.cat && n.cat !== 'tool' ? ` · ${n.cat.toUpperCase()}` : ''}`
    : (KIND_TITLES[n.kind] ?? n.kind);
  hdr.textContent = title;
  el.appendChild(hdr);

  const meta = document.createElement('div');
  meta.className = 'nd-meta';
  const chips = [];
  if (n.ts) chips.push({ text: fmtClock(n.ts) });
  if (n.model) chips.push({ text: n.model.replace(/^claude-/, '') });
  if (n.status === 'err') chips.push({ text: 'error', cls: 'err' });
  if (n.usage) {
    chips.push({ text: `in ${fmt.tokens(n.usage.input)}` });
    chips.push({ text: `out ${fmt.tokens(n.usage.output)}` });
    if (n.usage.cacheRead) chips.push({ text: `cache read ${fmt.tokens(n.usage.cacheRead)}` });
    if (n.usage.cacheCreate) chips.push({ text: `cache write ${fmt.tokens(n.usage.cacheCreate)}` });
  }
  meta.innerHTML = chips.map(c => `<span class="nd-chip${c.cls ? ` ${c.cls}` : ''}">${esc(c.text)}</span>`).join('');
  if (chips.length) el.appendChild(meta);

  const sections = n.sections?.length
    ? n.sections
    : [{ heading: undefined, text: n.label ?? '' }];

  for (const s of sections) {
    const box = document.createElement('div');
    box.className = `nd-section${s.error ? ' err' : ''}`;
    const h = s.heading ? `<div class="nd-section-head">${esc(s.heading)}</div>` : '';
    const cls = s.code ? 'nd-pre code' : 'nd-pre';
    box.innerHTML = `${h}<pre class="${cls}">${esc(s.text)}</pre>`;
    el.appendChild(box);
  }

  el.scrollTop = 0;

  if (window.innerWidth <= 640) {
    document.getElementById('sd-body')?.classList.add('show-detail');
    document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'detail'));
  }
}

function closeRunDetail() {
  document.getElementById('sd-page').hidden = true;
  document.body.style.overflow = '';
}
document.getElementById('sd-back-btn').addEventListener('click', closeRunDetail);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('sd-page').hidden) closeRunDetail();
});
document.querySelectorAll('.sd-panel-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sd-panel-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const body = document.getElementById('sd-body');
    body.classList.remove('show-detail', 'show-agents');
    if (btn.dataset.panel === 'detail')      body.classList.add('show-detail');
    else if (btn.dataset.panel === 'agents') body.classList.add('show-agents');
  });
});
