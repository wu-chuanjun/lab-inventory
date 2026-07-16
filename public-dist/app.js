/* ---- app.js - 库存系统前端 ---- */
(function () {
  'use strict';

  const TOKEN_KEY = 'lab_inventory_token';
  let currentUser = null;
  let items = [];
  let sortKey = 'name';
  let sortDir = 1;
  let warnThreshold = 10;
  let ws = null;
  let wsReconnectTimer = null;

  /* ---- HTTP helpers ---- */
  function token() { return localStorage.getItem(TOKEN_KEY); }
  function apiHeaders() {
    const t = token();
    return { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) };
  }
  async function api(method, path, body) {
    const opts = { method, headers: apiHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败 (' + res.status + ')');
    return data;
  }

  /* ---- Toast ---- */
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---- WebSocket ---- */
  function connectWS() {
    const t = token();
    if (!t) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = proto + '//' + location.host + '/ws';
    try { ws = new WebSocket(url); } catch (e) { retryWS(); return; }
    document.getElementById('wsDot').className = 'ws-dot offline';
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: t }));
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'auth_ok') {
          document.getElementById('wsDot').className = 'ws-dot online';
        } else if (m.type === 'sync') {
          refreshData();
        }
      } catch (_) { /* ignore */ }
    };
    ws.onclose = () => {
      document.getElementById('wsDot').className = 'ws-dot offline';
      retryWS();
    };
    ws.onerror = () => { ws.close(); };
  }

  function retryWS() {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => { connectWS(); }, 3000);
  }

  /* ---- Data ---- */
  async function refreshData() {
    try {
      const d = await api('GET', '/api/items');
      items = d.items || [];
      render();
    } catch (e) {
      if (e.message.includes('401')) doLogout();
    }
  }

  async function refreshOps() {
    try {
      const d = await api('GET', '/api/operations?limit=100');
      renderOps(d.operations || []);
    } catch (_) { /* */ }
  }

  /* ---- Login flow ---- */
  function doLogin(username, password) {
    api('POST', '/api/login', { username, password }).then(d => {
      localStorage.setItem(TOKEN_KEY, d.token);
      currentUser = d.user;
      enterApp();
    }).catch(e => {
      document.getElementById('loginErr').textContent = e.message;
      document.getElementById('loginErr').style.display = 'block';
    });
  }

  function doRegister(username, displayName, password, code) {
    api('POST', '/api/register', { username, displayName, password, code }).then(d => {
      localStorage.setItem(TOKEN_KEY, d.token);
      currentUser = d.user;
      enterApp();
    }).catch(e => {
      document.getElementById('regErr').textContent = e.message;
      document.getElementById('regErr').style.display = 'block';
    });
  }

  function doLogout() {
    const t = token();
    if (t) api('POST', '/api/logout').catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
    if (ws) { ws.close(); ws = null; }
    showLogin();
  }

  function showLogin() {
    document.getElementById('appMain').style.display = 'none';
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('loginPanel').style.display = 'block';
    document.getElementById('registerPanel').style.display = 'none';
  }

  function enterApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appMain').style.display = 'block';
    document.getElementById('userBar').style.display = 'flex';
    document.getElementById('userAvatar').textContent = (currentUser.displayName || currentUser.username).charAt(0).toUpperCase();
    document.getElementById('userName').textContent = currentUser.displayName || currentUser.username;
    document.getElementById('userRole').textContent = currentUser.role === 'admin' ? '管理员' : '成员';

    document.getElementById('warnThreshold').value = warnThreshold;
    connectWS();
    refreshData();
    refreshOps();
  }

  /* ---- Render ---- */
  function getFiltered() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    const fl = document.getElementById('filterLoc').value;
    const fp = document.getElementById('filterProv').value;
    let list = items.filter(it => {
      if (fl && it.location !== fl) return false;
      if (fp && it.provider !== fp) return false;
      if (q) {
        const hay = (it.name + ' ' + it.cas + ' ' + it.provider + ' ' + it.location).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'qty') { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = (av || '').toString().toLowerCase(); bv = (bv || '').toString().toLowerCase(); }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return list;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    const list = getFiltered();
    const tbody = document.getElementById('tbody');
    const empty = document.getElementById('emptyState');
    tbody.innerHTML = '';

    if (items.length === 0) {
      empty.style.display = 'block';
      document.querySelector('.table-card .table-scroll').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.querySelector('.table-card .table-scroll').style.display = 'block';
    }

    list.forEach(it => {
      const low = Number(it.qty) < warnThreshold;
      const tr = document.createElement('tr');
      if (low) tr.className = 'low-stock';
      tr.innerHTML =
        `<td>${esc(it.name)}</td>` +
        `<td>${it.cas ? esc(it.cas) : '<span style="color:var(--muted)">—</span>'}</td>` +
        `<td>${it.spec ? esc(it.spec) : '<span style="color:var(--muted)">—</span>'}</td>` +
        `<td class="qty ${low ? 'low' : ''}">${esc(it.qty)}${low ? ' ⚠' : ''}</td>` +
        `<td>${it.provider ? esc(it.provider) : '<span style="color:var(--muted)">—</span>'}</td>` +
        `<td><span class="tag loc-tag">${it.location ? esc(it.location) : '—'}</span></td>` +
        `<td><div class="row-actions">` +
          `<button data-edit="${it.id}">编辑</button>` +
          `<button class="ghost-danger" data-del="${it.id}">删除</button>` +
        `</div></td>`;
      tbody.appendChild(tr);
    });

    updateStats();
    updateHeaders();
    updateFilters();
  }

  function updateStats() {
    document.getElementById('statKinds').textContent = items.length;
    const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    document.getElementById('statQty').textContent = totalQty;
    document.getElementById('statLocs').textContent = new Set(items.map(i => i.location).filter(Boolean)).size;
    document.getElementById('statWarn').textContent = items.filter(i => Number(i.qty) < warnThreshold).length;
  }

  function updateHeaders() {
    document.querySelectorAll('thead th[data-key]').forEach(th => {
      const k = th.getAttribute('data-key');
      th.classList.toggle('sorted', k === sortKey);
      const arrow = th.querySelector('.arrow');
      if (k === sortKey) arrow.textContent = sortDir === 1 ? '▲' : '▼';
      else arrow.textContent = '▲▼';
    });
  }

  function updateFilters() {
    const locSel = document.getElementById('filterLoc');
    const provSel = document.getElementById('filterProv');
    const curLoc = locSel.value, curProv = provSel.value;
    const locs = [...new Set(items.map(i => i.location).filter(Boolean))].sort();
    const provs = [...new Set(items.map(i => i.provider).filter(Boolean))].sort();
    locSel.innerHTML = '<option value="">全部</option>' + locs.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    provSel.innerHTML = '<option value="">全部</option>' + provs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    locSel.value = curLoc; provSel.value = curProv;
  }

  function renderOps(ops) {
    const c = document.getElementById('opLogContent');
    c.innerHTML = ops.map(o => {
      const icon = o.action === 'create' ? '➕' : o.action === 'delete' ? '🗑️' : '✏️';
      const time = new Date(o.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `<div class="item">
        <span class="icon">${icon}</span>
        <div class="body">
          <span class="user">${esc(o.userName)}</span>
          ${o.action === 'create' ? '添加了' : o.action === 'delete' ? '删除了' : '修改了'}
          <strong>${esc(o.itemName)}</strong>
          <div class="action">${esc(o.detail)}</div>
        </div>
        <span class="time">${time}</span>
      </div>`;
    }).join('');
  }

  /* ---- CSV import / export ---- */
  function exportCSV() {
    if (items.length === 0) { toast('没有数据可导出'); return; }
    const headers = ['名称', 'CAS号', '规格', '数量', '提供商', '库存地'];
    const rows = items.map(it => [it.name, it.cas, it.spec, it.qty, it.provider, it.location]
      .map(v => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '库存导出_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 ' + items.length + ' 条记录');
  }

  function parseCSVLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = async function () {
      const text = reader.result;
      const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
      if (lines.length < 2) { toast('CSV 内容为空或缺少数据行'); return; }
      const headers = lines[0].split(',').map(h => h.trim());
      const get = (key) => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? (cols[idx] || '').trim() : '';
      };
      let added = 0, failed = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 2) continue;
        const name = get('名称') || cols[0] || '';
        if (!name) continue;
        const qty = Number(get('数量') || cols[3] || 0);
        try {
          await api('POST', '/api/items', {
            name,
            cas: get('CAS号') || cols[1] || '',
            spec: get('规格') || cols[2] || '',
            qty: isNaN(qty) ? 0 : qty,
            provider: get('提供商') || cols[4] || '',
            location: get('库存地') || cols[5] || '',
          });
          added++;
        } catch (e) { failed++; }
      }
      await refreshData();
      refreshOps();
      toast('已导入 ' + added + ' 条' + (failed ? '（' + failed + ' 条失败）' : ''));
    };
    reader.readAsText(file, 'UTF-8');
  }

  /* ---- Modal: item ---- */
  const overlay = document.getElementById('overlay');
  const form = document.getElementById('itemForm');
  function openItemModal(id) {
    form.reset();
    document.querySelectorAll('.field-group').forEach(g => g.classList.remove('invalid'));
    if (id) {
      const it = items.find(x => x.id === id);
      if (!it) return;
      document.getElementById('modalTitle').textContent = '编辑物品';
      document.getElementById('itemId').value = it.id;
      document.getElementById('f_name').value = it.name || '';
      document.getElementById('f_cas').value = it.cas || '';
      document.getElementById('f_spec').value = it.spec || '';
      document.getElementById('f_qty').value = it.qty != null ? it.qty : '';
      document.getElementById('f_provider').value = it.provider || '';
      document.getElementById('f_location').value = it.location || '';
    } else {
      document.getElementById('modalTitle').textContent = '新增物品';
      document.getElementById('itemId').value = '';
    }
    overlay.classList.add('open');
    setTimeout(() => document.getElementById('f_name').focus(), 100);
  }
  function closeModal() { overlay.classList.remove('open'); }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('f_name').value.trim();
    const qtyRaw = document.getElementById('f_qty').value.trim();
    const qty = Number(qtyRaw);

    let ok = true;
    const gName = document.getElementById('f_name').closest('.field-group');
    const gCas = document.getElementById('f_cas').closest('.field-group');
    const gQty = document.getElementById('f_qty').closest('.field-group');
    gName.classList.toggle('invalid', !name);
    if (qtyRaw === '' || isNaN(qty) || qty < 0) { gQty.classList.add('invalid'); ok = false; } else gQty.classList.remove('invalid');
    const cas = document.getElementById('f_cas').value.trim();
    if (cas && !/^\d{1,7}-\d{2}-\d$/.test(cas)) { gCas.classList.add('invalid'); ok = false; } else gCas.classList.remove('invalid');
    if (!name) ok = false;
    if (!ok) return;

    const payload = {
      name,
      cas, spec: document.getElementById('f_spec').value.trim(),
      qty: qty,
      provider: document.getElementById('f_provider').value.trim(),
      location: document.getElementById('f_location').value.trim()
    };

    const id = document.getElementById('itemId').value;
    try {
      if (id) {
        await api('PUT', '/api/items/' + id, payload);
        toast('已更新：' + name);
      } else {
        await api('POST', '/api/items', payload);
        toast('已添加：' + name);
      }
      closeModal();
      await refreshData();
      refreshOps();
    } catch (e) { toast(e.message); }
  });

  /* ---- Events ---- */
  document.addEventListener('DOMContentLoaded', function () {
    /* Login tab switching */
    document.getElementById('showReg').addEventListener('click', () => {
      document.getElementById('loginPanel').style.display = 'none';
      document.getElementById('registerPanel').style.display = 'block';
      document.getElementById('loginErr').style.display = 'none';
    });
    document.getElementById('showLogin').addEventListener('click', () => {
      document.getElementById('registerPanel').style.display = 'none';
      document.getElementById('loginPanel').style.display = 'block';
      document.getElementById('regErr').style.display = 'none';
    });

    /* Login form */
    document.getElementById('loginForm').addEventListener('submit', e => {
      e.preventDefault();
      const u = document.getElementById('loginUsername').value.trim();
      const p = document.getElementById('loginPassword').value;
      if (u && p) doLogin(u, p);
    });

    /* Register form */
    document.getElementById('regForm').addEventListener('submit', e => {
      e.preventDefault();
      const u = document.getElementById('regUsername').value.trim();
      const d = document.getElementById('regDisplayName').value.trim() || u;
      const p = document.getElementById('regPassword').value;
      const c = document.getElementById('regCode').value.trim();
      if (u && p && c) doRegister(u, d, p, c);
    });

    /* App buttons */
    document.getElementById('btnAdd').addEventListener('click', () => openItemModal());
    document.getElementById('btnCancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    document.getElementById('btnLogout').addEventListener('click', doLogout);

    document.getElementById('btnExport').addEventListener('click', exportCSV);
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', function () {
      if (this.files[0]) importCSV(this.files[0]);
      this.value = '';
    });

    document.getElementById('searchInput').addEventListener('input', render);
    document.getElementById('filterLoc').addEventListener('change', render);
    document.getElementById('filterProv').addEventListener('change', render);
    document.getElementById('warnThreshold').addEventListener('change', function () {
      warnThreshold = Number(this.value) || 0;
      render();
    });

    /* Sort headers */
    document.querySelectorAll('thead th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-key');
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = 1; }
        render();
      });
    });

    /* Table actions (delegation) */
    document.getElementById('tbody').addEventListener('click', async e => {
      const editId = e.target.getAttribute('data-edit');
      const delId = e.target.getAttribute('data-del');
      if (editId) openItemModal(editId);
      if (delId) {
        const it = items.find(x => x.id === delId);
        if (it && confirm('确定删除「' + it.name + '」吗？此操作不可撤销。')) {
          try {
            await api('DELETE', '/api/items/' + delId);
            toast('已删除：' + it.name);
            await refreshData();
            refreshOps();
          } catch (e) { toast(e.message); }
        }
      }
    });

    /* Operation log */
    document.getElementById('btnOps').addEventListener('click', async () => {
      document.getElementById('opsOverlay').classList.add('open');
      await refreshOps();
    });
    document.getElementById('btnOpsClose').addEventListener('click', () => {
      document.getElementById('opsOverlay').classList.remove('open');
    });
    document.getElementById('opsOverlay').addEventListener('click', e => {
      if (e.target === document.getElementById('opsOverlay'))
        document.getElementById('opsOverlay').classList.remove('open');
    });

    /* Manual refresh */
    document.getElementById('btnRefresh').addEventListener('click', () => {
      refreshData();
      refreshOps();
      toast('已刷新');
    });
  });

  /* ---- Check auth on load ---- */
  const savedToken = token();
  if (savedToken) {
    api('GET', '/api/me').then(d => {
      currentUser = d.user;
      enterApp();
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
    });
  } else {
    showLogin();
  }

})();
