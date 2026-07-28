// ============================================================================
// Harness configuration tabs (Instructions / Commands / Skills / Hooks / MCP /
// Permissions / Memory / Effective Configs / Dependency Graph).
//
// Everything here talks to the provider-agnostic /api/config/* endpoints and
// renders whatever the active provider's adapter reports. Capabilities decide
// which sidebar tabs are visible, so a future provider (Codex, OpenCode, …)
// that only implements a subset just shows fewer tabs.
//
// Shares the globals defined in app.js: fmt, esc, api, apiPut, apiPost,
// toast, initChart, baseOption, COLOR, gridLine, renderChartEmpty,
// currentProviderId.
// ============================================================================

async function apiDelete(path) {
  const res = await fetch(`/api${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** provider query-string fragment for the active source. */
function pq(prefix = '?') {
  return currentProviderId ? `${prefix}provider=${encodeURIComponent(currentProviderId)}` : '';
}

const SCOPE_COLORS = {
  user: '#4d8af0', project: '#9a4df0', local: '#f09a4d', plugin: '#5fb98f',
  global: '#4d8af0', 'claude.ai': '#4df09a', managed: '#df7b6b',
};

// Every scope badge explains itself on hover.
const SCOPE_DESC = {
  user: 'User scope — defined in your home config, applies to every project',
  project: 'Project scope — defined inside the project repository',
  local: 'Local scope — project-local settings not committed to the repo (settings.local.json)',
  plugin: 'Plugin scope — shipped by an installed plugin (read-only)',
  global: 'Global — injected into every session',
  'claude.ai': 'claude.ai-hosted connector — definition lives in your account, not on disk',
  managed: 'Managed — enforced by organization policy',
};

function scopeBadge(scope, extra) {
  const c = SCOPE_COLORS[scope] ?? '#7a7d96';
  const title = [SCOPE_DESC[scope] ?? scope, extra].filter(Boolean).join('\n');
  return `<span class="cfg-badge" style="background:${c}22;color:${c};border-color:${c}55"
    title="${esc(title)}">${esc(scope)}</span>`;
}

const EFFECT_DESC = {
  allow: 'allow — tool call runs without a permission prompt',
  deny: 'deny — tool call is always blocked',
  ask: 'ask — tool call always asks for confirmation',
};

function effectBadge(effect) {
  const c = effect === 'allow' ? '#5fb98f' : effect === 'deny' ? '#df7b6b' : '#e3a838';
  return `<span class="cfg-badge" style="background:${c}22;color:${c};border-color:${c}55"
    title="${esc(EFFECT_DESC[effect] ?? effect)}">${esc(effect)}</span>`;
}

function cfgError(rootId, e) {
  document.getElementById(rootId).innerHTML =
    `<p class="text-error">${esc(e?.message ?? String(e))}</p>`;
}

// ===== Capabilities-driven nav =====

const CAP_TO_TAB = {
  instructions: 'claudemd', commands: 'commands', skills: 'skills', hooks: 'hooks',
  permissions: 'permissions', mcp: 'mcp', memory: 'memory',
  effectiveConfig: 'configs', dependencies: 'workflow',
};

let configCaps = {};

async function refreshConfigCapabilities() {
  try {
    configCaps = await api(`/config/capabilities${pq()}`);
  } catch {
    configCaps = {}; // hide harness tabs when the endpoint is unavailable
  }
  let anyVisible = false;
  for (const [cap, tab] of Object.entries(CAP_TO_TAB)) {
    const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (!btn) continue;
    const supported = Boolean(configCaps[cap]);
    btn.hidden = !supported;
    anyVisible = anyVisible || supported;
  }
  document.querySelectorAll('.nav-group-label').forEach(el => {
    if (el.textContent === 'Harness') el.hidden = !anyVisible;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  refreshConfigCapabilities();
  document.getElementById('provider-select')?.addEventListener('change', refreshConfigCapabilities);
});

// ===== Instructions (CLAUDE.md) =====

const insState = { files: [], selected: null, dirty: false };

async function loadClaudeMdTab() {
  const root = document.getElementById('cfg-claudemd-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  let report;
  try { report = await api(`/config/instructions${pq()}`); }
  catch (e) { return cfgError('cfg-claudemd-root', e); }

  insState.files = report.files;
  const existing = report.files.filter(f => f.exists);
  const totalTokens = existing.reduce((s, f) => s + f.tokens, 0);

  root.innerHTML = `
    <div class="chart-card">
      <div class="chart-card-head">
        <div class="chart-card-title">Injected tokens per day
          <span class="title-note" title="Daily estimate: size of the global instruction file × number of agents active that day">global file × agents active that day</span></div>
        <span class="text-dim" style="font-size:12px">
          ${existing.length} file${existing.length !== 1 ? 's' : ''} ·
          ${fmt.tokens(totalTokens)} tokens total ·
          ${report.injection.agentCount30d} agents (30d) ·
          est. ${fmt.tokens(report.injection.estimatedInjectedTokens30d)} injected / 30d
        </span>
      </div>
      <div id="chart-cfg-injection" style="height:170px"></div>
    </div>
    <div class="cfg-split">
      <aside class="cfg-list" id="ins-file-list"></aside>
      <div id="ins-detail">
        <div class="cfg-editor-card">
          <div class="cfg-editor-head">
            <code id="ins-editor-path" class="cfg-editor-path text-dim">select a file</code>
            <span id="ins-dirty" class="cfg-dirty" title="This file has unsaved edits" hidden>unsaved</span>
            <button id="ins-save" class="btn btn-accent" disabled>Save</button>
          </div>
          <textarea id="ins-editor" class="cfg-editor" spellcheck="false"
            placeholder="Select an instruction file in the list. Files marked 'not created' are created on first save."></textarea>
        </div>
      </div>
    </div>`;

  const chart = initChart('chart-cfg-injection');
  if (chart) {
    const s = report.injection.dailySeries;
    if (!s.length) renderChartEmpty(chart, 'No activity in the last 30 days');
    else chart.setOption({ ...baseOption(),
      grid: { left: 8, right: 14, top: 14, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: s.map(x => x.date), axisLabel: { color: COLOR.dim } },
      yAxis: { type: 'value', axisLabel: { formatter: v => fmt.tokens(v), color: COLOR.dim }, splitLine: { lineStyle: { color: gridLine() } } },
      series: [{ type: 'line', data: s.map(x => x.injectedTokens), smooth: true,
        areaStyle: { opacity: .3 }, itemStyle: { color: COLOR.blue }, lineStyle: { color: COLOR.blue } }],
      tooltip: { trigger: 'axis', formatter: p => `${p[0].name}: ${fmt.tokens(p[0].value)} injected` },
    });
  }

  renderInsFileList();
  document.getElementById('ins-editor').addEventListener('input', () => {
    insState.dirty = true;
    document.getElementById('ins-dirty').hidden = false;
  });
  document.getElementById('ins-save').addEventListener('click', saveInstructionFile);
  // Auto-open the first existing file.
  const first = report.files.find(f => f.exists) ?? report.files[0];
  if (first) openInstructionFile(first.path);
}

function renderInsFileList() {
  const el = document.getElementById('ins-file-list');
  if (!el) return;
  el.innerHTML = insState.files.map(f => `
    <div class="cfg-list-item ${insState.selected === f.path ? 'active' : ''}" data-path="${esc(f.path)}">
      <div class="cfg-list-title">${scopeBadge(f.scope)} ${esc(f.label)}</div>
      <div class="cfg-list-meta text-dim">
        ${f.exists ? `${fmt.tokens(f.tokens)} tokens · ${f.words} words` : 'not created'}
      </div>
    </div>`).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => openInstructionFile(item.dataset.path));
  });
}

async function openInstructionFile(path) {
  if (insState.dirty && !confirm('Discard unsaved changes?')) return;
  try {
    const file = await api(`/config/instructions/file?path=${encodeURIComponent(path)}${pq('&')}`);
    insState.selected = path;
    insState.dirty = false;
    document.getElementById('ins-editor').value = file.content;
    document.getElementById('ins-editor-path').textContent = path;
    document.getElementById('ins-dirty').hidden = true;
    document.getElementById('ins-save').disabled = false;
    renderInsFileList();
  } catch (e) { toast(`Open failed: ${e.message}`); }
}

async function saveInstructionFile() {
  if (!insState.selected) return;
  try {
    await apiPut(`/config/instructions/file${pq()}`, {
      path: insState.selected,
      content: document.getElementById('ins-editor').value,
    });
    insState.dirty = false;
    document.getElementById('ins-dirty').hidden = true;
    toast('Saved');
    loadClaudeMdTab(); // refresh token counts + chart
  } catch (e) { toast(`Save failed: ${e.message}`); }
}

// ===== Commands =====

const cmdState = { list: [], search: '', selected: -1 };

async function loadCommandsTab() {
  const root = document.getElementById('cfg-commands-root');
  // Keep the open command selected across the reload that follows a save/delete.
  const prevPath = cmdState.list[cmdState.selected]?.path ?? null;
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  try { cmdState.list = await api(`/config/commands${pq()}`); }
  catch (e) { return cfgError('cfg-commands-root', e); }

  cmdState.selected = prevPath ? cmdState.list.findIndex(c => c.path === prevPath) : -1;
  root.innerHTML = `
    <div class="controls-row">
      <input type="text" id="cmd-search" class="input-sm" placeholder="Search commands…" value="${esc(cmdState.search)}">
      <span class="text-dim" id="cmd-count"></span>
      <div style="flex:1"></div>
      <button id="cmd-new" class="btn">+ New command</button>
    </div>
    <div id="cmd-new-form" class="cfg-editor-card" hidden></div>
    <div class="cfg-split">
      <aside class="cfg-list" id="cmd-list"></aside>
      <div id="cmd-detail"><div class="cfg-placeholder text-dim">← Select a command to view or edit it</div></div>
    </div>`;

  document.getElementById('cmd-search').addEventListener('input', e => {
    cmdState.search = e.target.value;
    renderCommandList();
  });
  document.getElementById('cmd-new').addEventListener('click', showNewCommandForm);
  renderCommandList();
  if (cmdState.selected >= 0) renderCommandDetail(cmdState.selected);
}

function renderCommandList() {
  const q = cmdState.search.trim().toLowerCase();
  const rows = cmdState.list.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q));
  document.getElementById('cmd-count').textContent =
    `${rows.length} of ${cmdState.list.length} command${cmdState.list.length !== 1 ? 's' : ''}`;
  const el = document.getElementById('cmd-list');
  if (!rows.length) { el.innerHTML = '<p class="text-dim" style="padding:16px 4px">No commands found.</p>'; return; }
  el.innerHTML = rows.map(c => {
    const idx = cmdState.list.indexOf(c);
    const dim = c.overriddenBy ? ' style="opacity:.45"' : '';
    const overridden = c.overriddenBy ? ` <span class="cfg-badge cfg-badge-plain" title="A same-named definition with higher priority wins: ${esc(c.overriddenBy)}">overridden</span>` : '';
    return `<div class="cfg-list-item ${idx === cmdState.selected ? 'active' : ''}" data-idx="${idx}"${dim}
      title="${esc(c.description || c.name)}">
      <div class="cfg-list-title"><code>/${esc(c.invokeName)}</code>${overridden}</div>
      <div class="cfg-list-meta">
        ${scopeBadge(c.source, c.source === 'plugin' ? `${c.pluginName}@${c.marketplace}` : c.projectDir ?? '')}
        <span class="text-dim" title="Tokens this command adds when invoked">${fmt.tokens(c.tokens)} tok</span>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => {
      cmdState.selected = Number(item.dataset.idx);
      renderCommandList();
      renderCommandDetail(cmdState.selected);
    });
  });
}

function renderCommandDetail(idx) {
  const c = cmdState.list[idx];
  if (!c) return;
  const el = document.getElementById('cmd-detail');
  el.innerHTML = `
    <div class="cfg-editor-card">
      <div class="cfg-editor-head">
        <code class="cfg-editor-path text-dim" title="${esc(c.path)}">${esc(c.path)}</code>
        ${c.editable
          ? `<button id="cmd-delete" class="btn btn-danger">Delete</button>
             <button id="cmd-save" class="btn btn-accent">Save</button>`
          : '<span class="text-dim" style="font-size:12px">plugin command — read-only</span>'}
      </div>
      <div class="cfg-card-desc text-dim">${esc(c.description || '—')}</div>
      <div class="cfg-card-meta text-dim">
        <code>/${esc(c.invokeName)}</code> · ${fmt.tokens(c.tokens)} tok/invocation
        · args ${esc(c.argumentHint ?? (c.usesArguments ? '$ARGUMENTS' : '—'))}
        ${c.overriddenBy ? ` · <span title="A same-named definition with higher priority wins">overridden by ${esc(c.overriddenBy)}</span>` : ''}
      </div>
      <textarea id="cmd-editor" class="cfg-editor" spellcheck="false" ${c.editable ? '' : 'readonly'}></textarea>
    </div>`;
  document.getElementById('cmd-editor').value = c.content;
  document.getElementById('cmd-save')?.addEventListener('click', async () => {
    try {
      await apiPut(`/config/commands/file${pq()}`, { path: c.path, content: document.getElementById('cmd-editor').value });
      toast('Saved');
      loadCommandsTab();
    } catch (e) { toast(`Save failed: ${e.message}`); }
  });
  document.getElementById('cmd-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete /${c.invokeName}?\n${c.path}`)) return;
    try {
      await apiDelete(`/config/commands?path=${encodeURIComponent(c.path)}${pq('&')}`);
      toast('Deleted');
      loadCommandsTab();
    } catch (e) { toast(`Delete failed: ${e.message}`); }
  });
  el.scrollTop = 0;
}

async function showNewCommandForm() {
  const form = document.getElementById('cmd-new-form');
  if (!form.hidden) { form.hidden = true; return; }
  let projects = [];
  try { projects = await api(`/config/projects${pq()}`); } catch { /* user-only then */ }
  form.hidden = false;
  form.innerHTML = `
    <div class="cfg-editor-head">
      <input type="text" id="cmd-new-name" class="input-sm" placeholder="name (e.g. my-check or ns:cmd)" style="width:220px">
      <select id="cmd-new-loc" class="input-sm">
        <option value="user">user (~/.claude/commands)</option>
        ${projects.map(p => `<option value="project:${esc(p)}">project — ${esc(p)}</option>`).join('')}
      </select>
      <div style="flex:1"></div>
      <button id="cmd-create" class="btn btn-accent">Create</button>
    </div>
    <textarea id="cmd-new-content" class="cfg-editor" spellcheck="false" style="min-height:160px">---
description: What this command does
---

Instructions for the agent when the user runs the command.
</textarea>`;
  document.getElementById('cmd-create').addEventListener('click', async () => {
    const name = document.getElementById('cmd-new-name').value.trim();
    const loc = document.getElementById('cmd-new-loc').value;
    const body = {
      name,
      content: document.getElementById('cmd-new-content').value,
      location: loc.startsWith('project:') ? 'project' : 'user',
      projectDir: loc.startsWith('project:') ? loc.slice(8) : undefined,
    };
    try {
      await apiPost(`/config/commands${pq()}`, body);
      toast(`Created /${name}`);
      loadCommandsTab();
    } catch (e) { toast(`Create failed: ${e.message}`); }
  });
}

// ===== Skills =====

const skillState = { list: [], selected: -1 };

async function loadSkillsTab() {
  const root = document.getElementById('cfg-skills-root');
  // Keep the open skill selected across the reload that follows a save.
  const prevPath = skillState.list[skillState.selected]?.path ?? null;
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  try { skillState.list = await api(`/config/skills${pq()}`); }
  catch (e) { return cfgError('cfg-skills-root', e); }

  if (!skillState.list.length) {
    root.innerHTML = '<p class="text-dim" style="padding:16px 0">No skills installed.</p>';
    return;
  }
  skillState.selected = prevPath ? skillState.list.findIndex(s => s.path === prevPath) : -1;
  root.innerHTML = `
    <div class="cfg-split cfg-split-narrow">
      <aside class="cfg-list" id="skill-list"></aside>
      <div id="skill-detail"><div class="cfg-placeholder text-dim">← Select a skill to see its details</div></div>
    </div>`;
  renderSkillList();
  if (skillState.selected >= 0) renderSkillDetail(skillState.selected);
}

function renderSkillList() {
  const el = document.getElementById('skill-list');
  el.innerHTML = skillState.list.map((s, i) => {
    const dim = s.overriddenBy ? ' style="opacity:.45"' : '';
    return `<div class="cfg-list-item ${i === skillState.selected ? 'active' : ''}" data-idx="${i}"${dim}
      ${s.overriddenBy ? `title="Overridden by a higher-priority same-named skill: ${esc(s.overriddenBy)}"` : ''}>
      <div class="cfg-list-title"><code>${esc(s.name)}</code></div>
      <div class="cfg-list-meta">${scopeBadge(s.source, s.source === 'plugin' ? `${s.pluginName}@${s.marketplace}` : s.projectDir ?? '')}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => {
      skillState.selected = Number(item.dataset.idx);
      renderSkillList();
      renderSkillDetail(skillState.selected);
    });
  });
}

function renderSkillDetail(idx) {
  const s = skillState.list[idx];
  if (!s) return;
  const el = document.getElementById('skill-detail');
  const trigCats = { action: [], format: [], topic: [], technology: [] };
  for (const t of s.triggers) (trigCats[t.category] ?? trigCats.topic).push(t.keyword);
  const trigHtml = Object.entries(trigCats).filter(([, ws]) => ws.length).map(([cat, ws]) => `
    <div class="cfg-trigger-row"><span class="text-dim">${esc(cat)}</span>
      ${ws.map(w => `<span class="cfg-chip cfg-chip-${esc(cat)}" title="Prompts containing '${esc(w)}' are likely to activate this skill">${esc(w)}</span>`).join('')}
    </div>`).join('');

  el.innerHTML = `
    <div class="cfg-editor-card">
      <div class="cfg-editor-head">
        <code class="cfg-editor-path text-dim" title="${esc(s.path)}">${esc(s.path)}</code>
        ${s.editable ? '<button id="skill-save" class="btn btn-accent">Save</button>'
                     : '<span class="text-dim" style="font-size:12px">plugin skill — read-only</span>'}
      </div>
      <div class="cfg-card-desc text-dim">${esc(s.description || '—')}</div>
      <div class="cfg-card-meta text-dim">
        ${fmt.tokens(s.tokens)} tok/invocation
        ${s.calls30d ? ` · ${s.calls30d} call${s.calls30d !== 1 ? 's' : ''} (30d) · ~${fmt.tokens(s.estTokens30d)} injected` : ' · unused in 30d'}
      </div>
      ${trigHtml ? `<div class="cfg-triggers"><div class="cfg-section-label text-dim">Likely triggers — prompts containing these activate the skill</div>${trigHtml}</div>` : ''}
      ${s.scripts.length ? `<div class="cfg-section-label text-dim">Scripts</div>
        <div class="cfg-file-chips">${s.scripts.map(f => `<span class="cfg-chip" title="Bundled script the skill can run: scripts/${esc(f)}">${esc(f)}</span>`).join('')}</div>` : ''}
      ${s.references.length ? `<div class="cfg-section-label text-dim">References</div>
        <div class="cfg-file-chips">${s.references.map(f => `<span class="cfg-chip" title="Reference file loaded on demand: references/${esc(f)}">${esc(f)}</span>`).join('')}</div>` : ''}
      <textarea id="skill-editor" class="cfg-editor" spellcheck="false" ${s.editable ? '' : 'readonly'}></textarea>
    </div>`;
  el.scrollTop = 0;
  document.getElementById('skill-editor').value = s.content;
  document.getElementById('skill-save')?.addEventListener('click', async () => {
    try {
      await apiPut(`/config/skills/file${pq()}`, { path: s.path, content: document.getElementById('skill-editor').value });
      toast('Saved');
      loadSkillsTab();
    } catch (e) { toast(`Save failed: ${e.message}`); }
  });
}

// ===== Hooks =====

const hookState = { entries: [], totalFires30d: 0, selected: -1, editable: false };

async function loadHooksTab() {
  const root = document.getElementById('cfg-hooks-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  let report;
  try { report = await api(`/config/hooks${pq()}`); }
  catch (e) { return cfgError('cfg-hooks-root', e); }

  hookState.entries = report.entries;
  hookState.totalFires30d = report.totalFires30d;
  hookState.selected = -1;
  hookState.editable = Boolean(configCaps.hooks?.editable);

  if (!report.entries.length) {
    root.innerHTML = '<p class="text-dim" style="padding:16px 0">No hooks configured in any settings layer.</p>';
    return;
  }

  root.innerHTML = `
    <p class="text-dim" style="margin:0 0 12px">
      ${report.entries.length} hook entr${report.entries.length !== 1 ? 'ies' : 'y'} ·
      ${report.totalFires30d} recorded fires in 30 days
      <span class="title-note" title="Fire counts come from your transcripts: prompts for UserPromptSubmit, agent starts for SessionStart, logged stop-hook fires, tool calls matched against each entry's matcher for Pre/PostToolUse, compactions for PreCompact">recorded, not estimated</span>
    </p>
    <div class="cfg-split cfg-split-narrow">
      <aside class="cfg-list" id="hook-list"></aside>
      <div id="hook-detail"><div class="cfg-placeholder text-dim">← Select a hook to see its actions</div></div>
    </div>`;
  renderHookList();
}

function renderHookList() {
  const el = document.getElementById('hook-list');
  el.innerHTML = hookState.entries.map((h, i) => `
    <div class="cfg-list-item ${i === hookState.selected ? 'active' : ''}" data-idx="${i}">
      <div class="cfg-list-title"><code>${esc(h.event)}</code></div>
      <div class="cfg-list-meta">
        ${scopeBadge(h.level, h.projectDir ?? '')}
        ${h.matcher ? `<code class="text-dim" title="Only tool calls matching this pattern fire the hook">${esc(h.matcher)}</code>` : ''}
        <span class="text-dim" title="Recorded fires in the last 30 days">${h.fires30d}×</span>
      </div>
    </div>`).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => {
      hookState.selected = Number(item.dataset.idx);
      renderHookList();
      renderHookDetail(hookState.selected);
    });
  });
}

function renderHookDetail(idx) {
  const h = hookState.entries[idx];
  if (!h) return;
  const el = document.getElementById('hook-detail');
  const ACTION_DESC = {
    command: 'command action — runs a shell command',
    http: 'http action — calls an HTTP endpoint',
    prompt: 'prompt action — injects a prompt for the model',
  };
  el.innerHTML = `
    <div class="cfg-editor-card">
      <div class="cfg-editor-head">
        <code class="cfg-editor-path text-dim" title="${esc(h.sourcePath)}">${esc(h.sourcePath)}</code>
        ${hookState.editable ? '<button id="hook-delete" class="btn btn-danger" title="Remove this hook entry from its settings file (script files are left on disk)">Remove hook</button>' : ''}
      </div>
      <div class="cfg-card-meta text-dim">
        Event <code>${esc(h.event)}</code>
        ${h.matcher ? ` · matcher <code>${esc(h.matcher)}</code>` : ' · fires on every occurrence'}
        · ${h.fires30d} recorded fires (30d)
      </div>
      <div class="cfg-section-label text-dim">Actions — click one with a script to view/edit it</div>
      <div id="hook-actions">${h.actions.map((a, ai) => `
        <div class="cfg-hook-action-card ${a.scriptPath ? 'clickable' : ''}" data-ai="${ai}"
             ${a.scriptPath ? `title="Click to view/edit ${esc(a.scriptPath)}"` : ''}>
          <span class="cfg-badge cfg-badge-plain" title="${esc(ACTION_DESC[a.type] ?? a.type)}">${esc(a.type)}</span>
          <code>${esc(a.command ?? a.url ?? a.prompt ?? '—')}</code>
          ${a.timeout ? `<span class="text-dim" title="Timeout in seconds">${a.timeout}s</span>` : ''}
          ${a.scriptPath ? '<span class="cfg-badge cfg-badge-plain" title="A script file was found on disk for this command — click to open it">script ▸</span>' : ''}
        </div>`).join('')}
      </div>
      <div id="hook-script"></div>
    </div>`;

  el.scrollTop = 0;
  el.querySelectorAll('.cfg-hook-action-card.clickable').forEach(card => {
    card.addEventListener('click', () => openHookScript(h.actions[Number(card.dataset.ai)].scriptPath));
  });

  document.getElementById('hook-delete')?.addEventListener('click', async () => {
    if (!confirm(`Remove this ${h.event} hook from\n${h.sourcePath}?\n\n(Referenced script files stay on disk.)`)) return;
    try {
      await apiDelete(`/config/hooks?sourcePath=${encodeURIComponent(h.sourcePath)}&event=${encodeURIComponent(h.event)}&matcherIndex=${h.matcherIndex}${pq('&')}`);
      toast('Hook removed');
      loadHooksTab();
    } catch (e) { toast(`Remove failed: ${e.message}`); }
  });
}

async function openHookScript(path) {
  const el = document.getElementById('hook-script');
  el.innerHTML = '<div class="cfg-placeholder text-dim">Loading script…</div>';
  try {
    const file = await api(`/config/hooks/script?path=${encodeURIComponent(path)}${pq('&')}`);
    el.innerHTML = `
      <div class="cfg-editor-head" style="margin-top:12px">
        <code class="cfg-editor-path text-dim" title="${esc(file.path)}">${esc(file.path)}</code>
        ${hookState.editable ? '<button id="hook-script-save" class="btn btn-accent">Save script</button>' : ''}
      </div>
      <textarea id="hook-script-editor" class="cfg-editor" spellcheck="false" style="min-height:260px"
        ${hookState.editable ? '' : 'readonly'}></textarea>`;
    document.getElementById('hook-script-editor').value = file.content;
    document.getElementById('hook-script-save')?.addEventListener('click', async () => {
      try {
        await apiPut(`/config/hooks/script${pq()}`, { path: file.path, content: document.getElementById('hook-script-editor').value });
        toast('Script saved');
      } catch (e) { toast(`Save failed: ${e.message}`); }
    });
  } catch (e) {
    el.innerHTML = `<p class="text-error">${esc(e.message)}</p>`;
  }
}

// ===== MCP =====

const mcpState = { report: null, selected: -1 };

async function loadMcpTab(refresh = false) {
  const root = document.getElementById('cfg-mcp-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:240px"></div>';
  let d;
  try { d = await api(`/config/mcp${pq()}${refresh ? `${pq() ? '&' : '?'}refresh=1` : ''}`); }
  catch (e) { return cfgError('cfg-mcp-root', e); }

  mcpState.report = d;
  mcpState.selected = -1;

  const est30d = d.servers.reduce((s, x) => s + (x.schemaTokens || 0), 0) * (d.agents30d ?? 0);
  const kpis = [
    { label: 'Servers', value: String(d.servers.length), hint: 'from config files, all scopes' },
    { label: 'Tools', value: String(d.totalTools), hint: 'across all probed servers' },
    { label: 'Schema tokens', value: fmt.tokens(d.totalSchemaTokens), hint: 'injected into every session that loads these servers' },
    { label: 'Est. injected / 30d', value: fmt.tokens(est30d), hint: `schema tokens × ${d.agents30d ?? 0} agents (upper bound)` },
  ];

  root.innerHTML = `
    <div class="usage-kpis" style="margin-bottom:12px">${kpis.map(k => `
      <div class="usage-kpi"><div class="usage-kpi-label text-dim">${esc(k.label)}</div>
      <div class="usage-kpi-value">${esc(k.value)}</div>
      ${k.hint ? `<div class="usage-kpi-hint text-dim">${esc(k.hint)}</div>` : ''}</div>`).join('')}
    </div>
    <div class="controls-row">
      <span class="text-dim" style="font-size:12px">Servers are enumerated from config files; tools come from live probes (cached 10 min).</span>
      <div style="flex:1"></div>
      <button id="mcp-reprobe" class="btn" title="Re-run the tool/schema probes for every server, bypassing the 10-minute cache">↻ Re-probe servers</button>
    </div>
    <div class="cfg-split cfg-split-narrow">
      <aside class="cfg-list" id="mcp-list"></aside>
      <div id="mcp-detail"></div>
    </div>`;

  document.getElementById('mcp-reprobe').addEventListener('click', () => loadMcpTab(true));
  renderMcpList();
  renderMcpDefault();
}

function mcpStatusIcon(s) {
  if (s.probeError) {
    return `<span class="status-warn" title="${esc(`No tool data: ${s.probeError}`)}">⚠</span>`;
  }
  return `<span class="status-ok" title="Probe OK — tools and schemas listed in the detail panel">✓</span>`;
}

function renderMcpList() {
  const d = mcpState.report;
  const el = document.getElementById('mcp-list');
  el.innerHTML = d.servers.map((s, i) => `
    <div class="cfg-list-item ${i === mcpState.selected ? 'active' : ''}" data-idx="${i}">
      <div class="cfg-list-title"><code>${esc(s.name)}</code> ${mcpStatusIcon(s)}</div>
      <div class="cfg-list-meta">
        ${scopeBadge(s.scope, s.project ?? s.source ?? '')}
        <span class="cfg-badge cfg-badge-plain" title="Transport: ${esc(s.type)}">${esc(s.type)}</span>
        <span class="text-dim">${s.toolCount ? `${s.toolCount} tools · ${fmt.tokens(s.schemaTokens)} tok` : '—'}</span>
      </div>
    </div>`).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => {
      mcpState.selected = Number(item.dataset.idx);
      renderMcpList();
      renderMcpDetail(mcpState.selected);
    });
  });
}

/** Right panel before any server is selected (usage lives on the Dashboard's MCP chart). */
function renderMcpDefault() {
  const d = mcpState.report;
  const el = document.getElementById('mcp-detail');
  el.innerHTML = `
    <div class="cfg-placeholder text-dim">← Select a server to inspect its tools, schemas and token overhead.</div>
    ${d.diagnostics?.length ? `<details class="mcp-diagnostics" style="margin-top:10px">
      <summary title="Enumeration or probe failures — the server list stays intact, failures are reported here instead">${d.diagnostics.length} diagnostic${d.diagnostics.length !== 1 ? 's' : ''}</summary>
      <ul>${d.diagnostics.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
}

function renderMcpDetail(idx) {
  const d = mcpState.report;
  const s = d.servers[idx];
  if (!s) return;
  const est30d = (s.schemaTokens || 0) * (d.agents30d ?? 0);
  const el = document.getElementById('mcp-detail');
  el.innerHTML = `
    <div class="cfg-editor-card">
      <div class="cfg-editor-head">
        <code class="cfg-card-name">${esc(s.name)}</code>
        ${scopeBadge(s.scope, s.project ?? '')}
        <span class="cfg-badge cfg-badge-plain" title="Transport: ${esc(s.type)}">${esc(s.type)}</span>
        <div style="flex:1"></div>
        ${mcpStatusIcon(s)}
      </div>
      <div class="cfg-card-meta text-dim">
        ${s.command ? `<code title="${esc(s.command)}">${esc(s.command.slice(0, 110))}</code><br>` : ''}
        defined in <code title="${esc(s.source)}">${esc(s.source.split(/[\\/]/).slice(-2).join('/'))}</code>
        ${s.toolCount ? ` · ${s.toolCount} tools · ${fmt.tokens(s.schemaTokens)} schema tokens
          · <span title="Schema tokens × ${d.agents30d ?? 0} agents in the last 30 days — an upper bound of what this server's schemas injected">≈${fmt.tokens(est30d)} injected / 30d</span>` : ''}
      </div>
      ${s.probeError ? `<div class="cfg-mcp-error text-dim" style="margin:6px 0 0">${esc(s.probeError)}</div>` : ''}
      ${s.tools?.length ? `
        <div class="cfg-section-label text-dim">Tools</div>
        <div class="cfg-mcp-tools" style="margin-left:0">
          ${s.tools.map(t => `<div class="mcp-tool">
            <div class="mcp-tool-head"><code>${esc(t.name)}</code>
              <span class="mcp-tool-tokens" title="Estimated tokens this tool's name + description + schema add to the context">${fmt.tokens(t.tokens)} tok</span></div>
            ${t.description ? `<div class="mcp-tool-desc">${esc(t.description)}</div>` : ''}
            <details class="mcp-tool-schema"><summary>Input schema</summary>
              <pre>${esc(JSON.stringify(t.inputSchema, null, 2) ?? 'null')}</pre></details>
          </div>`).join('')}
        </div>` : ''}
    </div>`;
  el.scrollTop = 0;
}

// ===== Permissions =====

async function loadPermissionsTab() {
  const root = document.getElementById('cfg-permissions-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  let projects = [];
  try { projects = await api(`/config/projects${pq()}`); } catch { /* user layer only */ }

  const stored = localStorage.getItem('permProject') ?? '';
  const selected = projects.includes(stored) ? stored : '';

  root.innerHTML = `
    <div class="controls-row">
      <span class="text-dim">Scope</span>
      <select id="perm-project" class="input-sm" style="max-width:420px">
        <option value="">User settings only</option>
        ${projects.map(p => `<option value="${esc(p)}" ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
    </div>
    <div id="perm-body"></div>`;

  document.getElementById('perm-project').addEventListener('change', e => {
    localStorage.setItem('permProject', e.target.value);
    renderPermissions(e.target.value);
  });
  renderPermissions(selected);
}

async function renderPermissions(project) {
  const body = document.getElementById('perm-body');
  body.innerHTML = '<div class="skeleton-card skeleton" style="height:160px"></div>';
  let model;
  try {
    model = await api(`/config/permissions${pq()}${project ? `${pq() ? '&' : '?'}project=${encodeURIComponent(project)}` : ''}`);
  } catch (e) { body.innerHTML = `<p class="text-error">${esc(e.message)}</p>`; return; }

  const counts = { allow: 0, deny: 0, ask: 0 };
  for (const r of model.effective) counts[r.effect]++;

  const ruleRow = (r) => `<div class="cfg-perm-rule ${r.overriddenBy ? 'overridden' : ''}">
    ${effectBadge(r.effect)}
    <code>${esc(r.raw)}</code>
    ${r.overriddenBy ? `<span class="text-dim" style="font-size:11px" title="The same rule is defined at the ${esc(r.overriddenBy)} layer, which takes priority">overridden by ${esc(r.overriddenBy)}</span>` : ''}
  </div>`;

  body.innerHTML = `
    <p class="text-dim" style="margin:4px 0 12px">
      Effective: ${counts.allow} allow · ${counts.deny} deny · ${counts.ask} ask
      — layers merge local &gt; project &gt; user; identical rules at lower layers are shown struck through.
    </p>
    <div class="cfg-perm-layers">
      ${model.layers.map(l => `
        <div class="chart-card">
          <div class="chart-card-title">${scopeBadge(l.level)}
            <span class="title-note" title="${esc(l.filePath)}">${esc(l.filePath.split(/[\\/]/).slice(-3).join('/'))}</span>
            ${l.exists ? '' : '<span class="text-dim" style="font-size:11px">(file not present)</span>'}
          </div>
          <div class="cfg-perm-rules">
            ${[...l.deny, ...l.ask, ...l.allow].map(ruleRow).join('') ||
              '<span class="text-dim" style="font-size:12px">no rules</span>'}
          </div>
        </div>`).join('')}
    </div>`;
}

// ===== Memory =====

const memState = { stores: [], selected: 0 };

async function loadMemoryTab() {
  const root = document.getElementById('cfg-memory-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  try { memState.stores = await api(`/config/memory${pq()}`); }
  catch (e) { return cfgError('cfg-memory-root', e); }

  if (!memState.stores.length) {
    root.innerHTML = '<p class="text-dim" style="padding:16px 0">No memory stores found. Memory appears once the tool persists MEMORY.md files for a project.</p>';
    return;
  }
  memState.selected = 0;
  root.innerHTML = `
    <div class="cfg-split">
      <aside class="cfg-list" id="mem-store-list"></aside>
      <div id="mem-topics" class="cfg-mem-topics"></div>
    </div>`;
  renderMemoryStoreList();
  renderMemoryTopics();
}

function renderMemoryStoreList() {
  const el = document.getElementById('mem-store-list');
  el.innerHTML = memState.stores.map((s, i) => {
    const label = s.cwd ? s.cwd.split(/[\\/]/).pop() : s.projectKey;
    return `<div class="cfg-list-item ${i === memState.selected ? 'active' : ''}" data-idx="${i}">
      <div class="cfg-list-title">${esc(label || s.projectKey)}</div>
      <div class="cfg-list-meta text-dim" title="${esc(s.cwd ?? s.dir)}">
        ${s.topics.length} topic${s.topics.length !== 1 ? 's' : ''} · ${fmt.ago(s.lastModifiedAt)}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => {
      memState.selected = Number(item.dataset.idx);
      renderMemoryStoreList();
      renderMemoryTopics();
    });
  });
}

function renderMemoryTopics() {
  const s = memState.stores[memState.selected];
  const el = document.getElementById('mem-topics');
  if (!s) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="text-dim" style="font-size:12px;margin-bottom:10px" title="${esc(s.dir)}">
      ${esc(s.cwd ?? s.projectKey)} · index lists ${s.index.length} of ${s.topics.length} topics
    </div>
    ${s.topics.map(t => `
      <details class="cfg-mem-topic" ${s.topics.length === 1 ? 'open' : ''}>
        <summary>
          <span class="cfg-mem-title">${esc(t.title ?? t.file)}</span>
          <code class="text-dim">${esc(t.file)}</code>
          ${t.referenced ? '' : '<span class="cfg-badge cfg-badge-plain" title="Not linked from the MEMORY.md index — the tool may never load this file">orphan</span>'}
          <span class="text-dim" style="font-size:11px" title="Last modified">${(t.sizeBytes / 1024).toFixed(1)} KB · ${new Date(t.modifiedAt).toLocaleString()}</span>
        </summary>
        <pre class="cfg-mem-content">${esc(t.content)}</pre>
      </details>`).join('') || '<p class="text-dim">No topic files.</p>'}`;
  el.scrollTop = 0;
}

// ===== Effective Configs =====

async function loadConfigsTab() {
  const root = document.getElementById('cfg-configs-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:200px"></div>';
  let projects = [];
  try { projects = await api(`/config/projects${pq()}`); } catch { /* user only */ }

  const stored = localStorage.getItem('configProject') ?? '';
  const selected = projects.includes(stored) ? stored : '';

  root.innerHTML = `
    <div class="controls-row">
      <span class="text-dim">Scope</span>
      <select id="configs-project" class="input-sm" style="max-width:420px">
        <option value="">User settings only</option>
        ${projects.map(p => `<option value="${esc(p)}" ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
    </div>
    <div id="configs-body"></div>`;

  document.getElementById('configs-project').addEventListener('change', e => {
    localStorage.setItem('configProject', e.target.value);
    renderEffectiveConfigs(e.target.value);
  });
  renderEffectiveConfigs(selected);
}

async function renderEffectiveConfigs(project) {
  const body = document.getElementById('configs-body');
  body.innerHTML = '<div class="skeleton-card skeleton" style="height:160px"></div>';
  let model, recentModels = [];
  try {
    model = await api(`/config/effective${pq()}${project ? `${pq() ? '&' : '?'}project=${encodeURIComponent(project)}` : ''}`);
  } catch (e) { body.innerHTML = `<p class="text-error">${esc(e.message)}</p>`; return; }
  try { recentModels = await api('/models?range=7d'); } catch { /* optional */ }

  const fmtVal = (v) => {
    const s = JSON.stringify(v);
    return s === undefined ? '—' : s.length > 120 ? s.slice(0, 119) + '…' : s;
  };

  const modelEntry = model.effective.find(e => e.key === 'model');
  const effortEntry = model.effective.find(e => e.key === 'effortLevel');
  const mostUsed = recentModels[0]?.model;

  body.innerHTML = `
    <div class="usage-kpis" style="margin:12px 0">
      <div class="usage-kpi">
        <div class="usage-kpi-label text-dim">Default model</div>
        <div class="usage-kpi-value" style="font-size:15px">${modelEntry ? `<code>${esc(String(modelEntry.value))}</code>` : '<span class="text-dim">not set</span>'}</div>
        <div class="usage-kpi-hint text-dim">${modelEntry ? `from ${esc(modelEntry.source)} settings` : 'chosen per session (/model)'}</div>
      </div>
      ${effortEntry ? `<div class="usage-kpi">
        <div class="usage-kpi-label text-dim">Effort level</div>
        <div class="usage-kpi-value" style="font-size:15px"><code>${esc(String(effortEntry.value))}</code></div>
        <div class="usage-kpi-hint text-dim">from ${esc(effortEntry.source)} settings</div>
      </div>` : ''}
      <div class="usage-kpi">
        <div class="usage-kpi-label text-dim">Most used model (7d)</div>
        <div class="usage-kpi-value" style="font-size:15px">${mostUsed ? `<code>${esc(mostUsed.replace(/^claude-/, ''))}</code>` : '<span class="text-dim">no usage</span>'}</div>
        <div class="usage-kpi-hint text-dim">from recorded transcripts, by total tokens</div>
      </div>
    </div>
    <div class="cfg-layer-files">
      ${model.layers.map(l => `<div class="cfg-layer-file">
        ${scopeBadge(l.level)}
        <code class="text-dim" title="${esc(l.filePath)}">${esc(l.filePath)}</code>
        ${l.exists ? (l.parseError ? `<span class="status-error" title="${esc(l.parseError)}">✕ parse error</span>` : '<span class="status-ok" title="File exists and parses as valid JSON">✓</span>')
                   : '<span class="text-dim" style="font-size:11px">not present</span>'}
      </div>`).join('')}
    </div>
    ${model.effective.length ? `<table style="margin-top:12px">
      <thead><tr><th>Key</th><th>Effective value</th><th>Source</th><th>Notes</th></tr></thead>
      <tbody>${model.effective.map(e => `<tr>
        <td><code>${esc(e.key)}</code></td>
        <td class="td-dim" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${esc(JSON.stringify(e.value, null, 2) ?? '')}"><code>${esc(fmtVal(e.value))}</code></td>
        <td>${scopeBadge(e.source)}${e.sourceIgnored ? ' <span class="status-warn" title="Every definition of this key sits in a layer the tool does not read — it never takes effect">⚠ ignored</span>' : ''}</td>
        <td class="td-dim" style="font-size:11px">
          ${e.overriddenLevels?.length ? `overrides ${e.overriddenLevels.join(', ')}` : ''}
          ${e.mergedLevels?.length ? `<span title="Claude Code accumulates this key across layers — every rule listed here is in force">combined from ${e.mergedLevels.join(' + ')} (all apply)</span>` : ''}
          ${e.ignoredLevels?.length ? `${e.overriddenLevels?.length || e.mergedLevels?.length ? ' · ' : ''}also set in ${e.ignoredLevels.join(', ')} (not read there)` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>` : '<p class="text-dim" style="padding:16px 0">No settings found in these layers.</p>'}
    <p class="text-dim" style="font-size:11px;margin-top:8px">
      Read-only merged view: local &gt; project &gt; user. Keys the tool restricts to specific layers
      (e.g. autoMode, pluginConfigs → user only) are flagged when set somewhere they are never read.
    </p>`;
}

// ===== Dependency Graph =====

const GRAPH_CAT_COLOR = { skill: '#5f93d1', hook: '#a98cd6', mcp: '#5fb98f', command: '#e3a838' };
const GRAPH_TYPE_ICON = { hook: '⚡', mcp: '⇄', skill: '❖', command: '/' };
// Columns run in workflow order, so the graph always reads left to right.
const GRAPH_LAYERS = ['hook', 'mcp', 'skill', 'command'];
const GRAPH_TYPE_DESC = {
  hook: 'Hook — fires on its event and runs its actions',
  mcp: 'MCP server — provides tools to the session',
  skill: 'Skill — activates on matching prompts',
  command: 'Slash command — user-invoked shortcut',
};

const graphState = { data: null, selected: -1 };

async function loadWorkflowTab() {
  const root = document.getElementById('cfg-workflow-root');
  root.innerHTML = '<div class="skeleton-card skeleton" style="height:280px"></div>';
  let g;
  try { g = await api(`/config/dependencies${pq()}`); }
  catch (e) { return cfgError('cfg-workflow-root', e); }

  graphState.data = g;
  graphState.selected = g.chains.length ? 0 : -1;

  if (!g.chains.length) {
    root.innerHTML = '<p class="text-dim" style="padding:16px 0">No cross-component workflows detected. Workflows appear when a skill/command/hook references an MCP server or another component by name or in its content.</p>';
    return;
  }

  root.innerHTML = `
    <div class="cfg-split cfg-split-narrow">
      <aside class="cfg-list" id="graph-chain-list"></aside>
      <div id="graph-detail"></div>
    </div>`;

  renderGraphChainList();
  renderGraphDetail(0);
}

function renderGraphChainList() {
  const g = graphState.data;
  const el = document.getElementById('graph-chain-list');
  el.innerHTML = g.chains.map((c, i) => {
    const typeIcons = [...new Set(c.steps.map(s => s.type))]
      .map(t => `<span title="${esc(GRAPH_TYPE_DESC[t])}">${GRAPH_TYPE_ICON[t]}</span>`).join(' ');
    return `<div class="cfg-list-item ${graphState.selected === i ? 'active' : ''}" data-idx="${i}">
      <div class="cfg-list-title">${esc(c.key)}</div>
      <div class="cfg-list-meta text-dim">${typeIcons} · ${c.steps.length} step${c.steps.length !== 1 ? 's' : ''}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.cfg-list-item').forEach(item => {
    item.addEventListener('click', () => {
      graphState.selected = Number(item.dataset.idx);
      renderGraphChainList();
      renderGraphDetail(graphState.selected);
    });
  });
}

function renderGraphDetail(sel) {
  const g = graphState.data;
  const el = document.getElementById('graph-detail');
  const chain = g.chains[sel];
  if (!chain) { el.innerHTML = ''; return; }

  // Subset of nodes/edges for the selected workflow.
  const chainIds = new Set(chain.steps.map(s => `${s.type}:${s.name}`));
  const nodes = g.nodes.filter(n => chainIds.has(n.id));
  const edges = g.edges.filter(e => chainIds.has(e.source) && chainIds.has(e.target));

  // Deterministic column layout instead of a force simulation: nodes are grouped
  // into one column per type in workflow order, so nothing overlaps, the same
  // workflow always draws the same way, and a big graph just gets taller.
  const columns = GRAPH_LAYERS
    .map(type => nodes.filter(n => n.type === type).sort((a, b) => a.name.localeCompare(b.name)))
    .filter(col => col.length);
  const rows = Math.max(...columns.map(c => c.length), 1);
  const COL_W = 230, ROW_H = 74;
  const pos = new Map();
  columns.forEach((col, ci) => col.forEach((n, ri) => {
    // Each column is centred on its own height so short columns sit mid-canvas.
    pos.set(n.id, { x: ci * COL_W, y: (ri - (col.length - 1) / 2) * ROW_H });
  }));

  el.innerHTML = `
    <div class="chart-card">
      <div class="chart-card-title">Workflow: ${esc(chain.key)}
        <span class="title-note" title="Components are grouped into a column per type and flow left to right. An arrow points from the component that references another to the one it references. Solid edges: one component's content literally names the other. Dashed edges: the names share a keyword (weaker signal). Hover any node or edge for detail.">solid = content reference · dashed = name similarity · hover for detail</span></div>
      <div id="chart-cfg-graph"></div>
    </div>
    <div class="chart-card" style="margin-top:14px">
      <div class="chart-card-title">Steps</div>
      ${chain.steps.map((s, i) => `<div class="cfg-chain-step">
        <span class="cfg-chain-num" style="background:${GRAPH_CAT_COLOR[s.type]}22;color:${GRAPH_CAT_COLOR[s.type]}" title="Step ${i + 1} in the workflow">${i + 1}</span>
        <span class="cfg-chain-icon" title="${esc(GRAPH_TYPE_DESC[s.type] ?? s.type)}">${GRAPH_TYPE_ICON[s.type] ?? '·'}</span>
        <code>${esc(s.name)}</code>
        <span class="text-dim cfg-chain-desc" title="${esc(s.description)}">${esc(s.description)}</span>
      </div>`).join('')}
    </div>`;
  el.scrollTop = 0;

  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // ECharts fits the node bounding box into the canvas with one uniform scale,
  // so the canvas has to be sized to that same scale or the graph floats in a
  // sea of dead space. Width is the binding constraint (labels need the room);
  // never scale above 1, so a two-node workflow keeps its natural spacing.
  const box = document.getElementById('chart-cfg-graph');
  const spanX = (columns.length - 1) * COL_W;
  const spanY = (rows - 1) * ROW_H;
  const scale = spanX > 0 ? Math.min(1, Math.max(180, box.clientWidth - 80) / spanX) : 1;
  box.style.height = `${Math.max(260, Math.round(spanY * scale) + 120)}px`;

  const cats = ['skill', 'hook', 'mcp', 'command'];
  const chart = initChart('chart-cfg-graph');
  if (!chart) return;
  if (!nodes.length) return renderChartEmpty(chart, 'No components');
  const t = chartTheme();
  chart.setOption({ ...baseOption(),
    tooltip: { formatter: p => p.dataType === 'edge'
      ? `${esc(p.data.source.split(':').slice(1).join(':'))} <b>${esc(p.data.label ?? '')}</b> ${esc(p.data.target.split(':').slice(1).join(':'))}${p.data.via === 'name' ? ' <i>(name match)</i>' : ''}`
      : `<b>${esc(p.data.name)}</b> — ${esc(p.data.categoryName)}${p.data.detail ? `<br>${esc(p.data.detail)}` : ''}` },
    legend: { top: 0, data: cats.filter(c => nodes.some(n => n.type === c)), textStyle: { color: COLOR.dim } },
    series: [{
      type: 'graph', layout: 'none', roam: true,
      categories: cats.map(c => ({ name: c, itemStyle: { color: GRAPH_CAT_COLOR[c] } })),
      data: nodes.map(n => ({
        id: n.id,
        x: pos.get(n.id).x, y: pos.get(n.id).y,
        name: n.name,
        category: cats.indexOf(n.type),
        categoryName: n.type,
        detail: n.detail ? String(n.detail).slice(0, 120) : undefined,
        symbolSize: 13 + Math.min(15, (degree.get(n.id) ?? 0) * 3),
        // The name sits below the node on an opaque chip in full-strength text
        // colour, so neither the node fill nor a crossing edge can wash it out.
        label: {
          show: true, position: 'bottom', distance: 7,
          formatter: () => (n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name),
          color: t.text, fontSize: 11, fontWeight: 500,
          backgroundColor: t.surface, padding: [3, 6], borderRadius: 5,
        },
      })),
      links: edges.map(e => ({
        source: e.source, target: e.target, label: e.label, via: e.via,
        lineStyle: { type: e.via === 'name' ? 'dashed' : 'solid', opacity: e.via === 'name' ? 0.4 : 0.8, width: e.via === 'name' ? 1 : 1.6, curveness: 0.12 },
      })),
      edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 7,
      // Edge labels only on hover — drawn for every edge they bury a busy graph.
      edgeLabel: { show: false },
      emphasis: {
        focus: 'adjacency',
        label: { show: true },
        edgeLabel: { show: true, formatter: p => p.data.label, color: t.text, fontSize: 10, backgroundColor: t.surface, padding: [2, 5], borderRadius: 4 },
      },
      blur: { itemStyle: { opacity: 0.25 }, lineStyle: { opacity: 0.12 }, label: { opacity: 0.3 } },
    }],
  });
}

// ===== Registration =====

window.ConfigPages = {
  claudemd: loadClaudeMdTab,
  commands: loadCommandsTab,
  skills: loadSkillsTab,
  hooks: loadHooksTab,
  mcp: loadMcpTab,
  permissions: loadPermissionsTab,
  memory: loadMemoryTab,
  configs: loadConfigsTab,
  workflow: loadWorkflowTab,
};
