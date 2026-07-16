const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const REGISTER_CODE = process.env.REGISTER_CODE || 'lab2026';
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days
const MAX_OPS = 500;

/* ---- helpers ---- */
function uid() {
  return crypto.randomBytes(6).toString('hex') + Date.now().toString(36);
}
function now() { return Date.now(); }

function escErr(msg) { return { error: msg }; }

/* ---- password ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex')); }
  catch { return false; }
}

/* ---- store (JSON file) ---- */
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const init = { users: [], items: [], operations: [], seeded: false };
    fs.writeFileSync(STORE_FILE, JSON.stringify(init, null, 2));
  }
}
ensureStore();

let store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));

function persist() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

/* ---- seed demo ---- */
function seedDemo() {
  if (store.seeded) return;
  store.items.push(
    { id: uid(), name: '无水乙醇', cas: '64-17-5', spec: '500mL / AR', qty: 24, provider: '国药集团', location: 'A区-3柜', createdBy: '系统', createdAt: now(), updatedBy: '系统', updatedAt: now() },
    { id: uid(), name: '氯化钠', cas: '7647-14-5', spec: '1kg / 分析纯', qty: 8, provider: '西陇科学', location: 'B区-1柜', createdBy: '系统', createdAt: now(), updatedBy: '系统', updatedAt: now() },
    { id: uid(), name: '盐酸', cas: '7647-01-0', spec: '2.5L / 36%', qty: 5, provider: '科密欧', location: '危化品库', createdBy: '系统', createdAt: now(), updatedBy: '系统', updatedAt: now() }
  );
  store.seeded = true;
  persist();
}
seedDemo();

/* ---- session ---- */
const sessions = new Map();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expires: now() + TOKEN_TTL });
  return token;
}

function getUserByToken(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < now()) { sessions.delete(token); return null; }
  return store.users.find(u => u.id === s.userId) || null;
}

function deleteSession(token) { sessions.delete(token); }

/* ---- operation log ---- */
function logOp(user, action, itemName, detail) {
  store.operations.unshift({
    id: uid(),
    userId: user.id,
    userName: user.displayName || user.username,
    action,
    itemName: itemName || '',
    detail: detail || '',
    createdAt: now()
  });
  if (store.operations.length > MAX_OPS) store.operations.length = MAX_OPS;
  persist();
}

/* ---- item helpers ---- */
function mkItem(name, cas, spec, qty, provider, location, user) {
  return {
    id: uid(), name, cas, spec,
    qty: (typeof qty === 'number' && !isNaN(qty)) ? qty : 0,
    provider, location,
    createdBy: user.id, createdByName: user.displayName,
    createdAt: now(), updatedBy: user.id, updatedByName: user.displayName,
    updatedAt: now()
  };
}

function itemPublic(it) { return it; } // return as-is

/* ---- app ---- */
const app = express();
app.use(express.json());

/* ---- auth middleware ---- */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const user = getUserByToken(token);
  if (!user) return res.status(401).json(escErr('未登录或登录已过期'));
  req.user = user;
  next();
}

/* ---- REST routes: auth ---- */
app.post('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/register', (req, res) => {
  const { username, displayName, password, code } = req.body || {};
  if (!username || !password) return res.status(400).json(escErr('用户名和密码为必填'));
  if (code !== REGISTER_CODE) return res.status(403).json(escErr('注册码错误'));
  if (store.users.find(u => u.username === username)) return res.status(409).json(escErr('用户名已存在'));
  const { salt, hash } = hashPassword(password);
  const user = {
    id: uid(), username, displayName: displayName || username,
    passwordHash: hash, passwordSalt: salt,
    role: store.users.length === 0 ? 'admin' : 'member',
    createdAt: now()
  };
  store.users.push(user);
  persist();
  const token = createSession(user.id);
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json(escErr('用户名和密码为必填'));
  const user = store.users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash))
    return res.status(401).json(escErr('用户名或密码错误'));
  const token = createSession(user.id);
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
});

app.post('/api/logout', auth, (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  deleteSession(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role } });
});

/* ---- REST routes: items ---- */
app.get('/api/items', auth, (req, res) => {
  res.json({ items: store.items.map(itemPublic) });
});

app.post('/api/items', auth, (req, res) => {
  const { name, cas, spec, qty, provider, location } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json(escErr('名称为必填'));
  const nqty = Number(qty);
  if (qty === undefined || qty === '' || isNaN(nqty) || nqty < 0) return res.status(400).json(escErr('数量必须为 ≥0 的数字'));

  const it = mkItem(name.trim(), (cas || '').trim(), (spec || '').trim(),
    nqty, (provider || '').trim(), (location || '').trim(), req.user);
  store.items.push(it);
  persist();
  logOp(req.user, 'create', it.name, '新增物品');
  broadcast();
  res.json({ item: itemPublic(it) });
});

app.put('/api/items/:id', auth, (req, res) => {
  const it = store.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json(escErr('物品不存在'));
  const { name, cas, spec, qty, provider, location } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json(escErr('名称不能为空'));
  if (qty !== undefined) {
    const nqty = Number(qty);
    if (isNaN(nqty) || nqty < 0) return res.status(400).json(escErr('数量必须为 ≥0 的数字'));
    it.qty = nqty;
  }
  if (name !== undefined) it.name = name.trim();
  if (cas !== undefined) it.cas = cas.trim();
  if (spec !== undefined) it.spec = spec.trim();
  if (provider !== undefined) it.provider = provider.trim();
  if (location !== undefined) it.location = location.trim();
  it.updatedBy = req.user.id;
  it.updatedByName = req.user.displayName;
  it.updatedAt = now();
  persist();
  logOp(req.user, 'update', it.name, '修改物品');
  broadcast();
  res.json({ item: itemPublic(it) });
});

app.delete('/api/items/:id', auth, (req, res) => {
  const idx = store.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json(escErr('物品不存在'));
  const it = store.items[idx];
  store.items.splice(idx, 1);
  persist();
  logOp(req.user, 'delete', it.name, '删除物品');
  broadcast();
  res.json({ ok: true });
});

/* ---- REST routes: operations ---- */
app.get('/api/operations', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ operations: store.operations.slice(0, limit) });
});

/* ---- static files ---- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---- WebSocket ---- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws._authed = false;
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'auth') {
        const user = getUserByToken(m.token);
        if (user) {
          ws._authed = true;
          ws.send(JSON.stringify({ type: 'auth_ok', user: { id: user.id, displayName: user.displayName, role: user.role } }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
        }
      }
    } catch (e) { /* ignore */ }
  });
  ws.on('close', () => { ws._authed = false; });
});

function broadcast() {
  const msg = JSON.stringify({ type: 'sync', ts: now() });
  wss.clients.forEach(c => {
    if (c.readyState === 1 && c._authed) c.send(msg);
  });
}

/* ---- start ---- */
server.listen(PORT, '0.0.0.0', () => {
  console.log('库存系统已启动 → http://localhost:' + PORT);
  console.log('注册码: ' + REGISTER_CODE);
  console.log('用户数: ' + store.users.length + ' | 物品数: ' + store.items.length);
});
