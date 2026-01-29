const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile, spawn } = require('child_process');
const multer = require('multer');

const app = express();
const configPath = process.env.MC_PANEL_CONFIG || path.join(__dirname, 'config.json');

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file at ${configPath}. Copy config.example.json to config.json.`);
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

const config = loadConfig();
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

async function loadUsers() {
  const userFile = config.userFile;
  const exists = fs.existsSync(userFile);
  if (!exists) {
    return [];
  }
  const raw = await fsp.readFile(userFile, 'utf-8');
  return JSON.parse(raw);
}

function execSystemctl(args) {
  return new Promise((resolve, reject) => {
    execFile('sudo', ['systemctl', ...args], (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }
      return resolve(stdout.trim());
    });
  });
}

function resolveRootPath(relativePath) {
  const root = path.resolve(config.minecraft.rootDir);
  const target = path.resolve(root, relativePath || '.');
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('Path traversal detected');
  }
  const rootReal = fs.realpathSync(root);
  let targetReal;
  try {
    targetReal = fs.realpathSync(target);
  } catch (error) {
    targetReal = target;
  }
  if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
    throw new Error('Path traversal detected');
  }
  return { root: rootReal, target: targetReal };
}

function parseProperties(contents) {
  const map = new Map();
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    const idx = line.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }
  return { map, lines };
}

function updateProperties(lines, updates) {
  const seen = new Set();
  const newLines = lines.map((line) => {
    const idx = line.indexOf('=');
    if (idx === -1) {
      return line;
    }
    const key = line.slice(0, idx).trim();
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      return line;
    }
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  return newLines.join('\n');
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = { username: user.username };
  return res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.get('/api/settings', requireAuth, (req, res) => {
  res.json({
    ramMin: config.minecraft.ramMin,
    ramMax: config.minecraft.ramMax
  });
});

app.get('/api/server/status', requireAuth, async (req, res) => {
  try {
    const status = await execSystemctl(['is-active', config.minecraft.serviceName]);
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/server/start', requireAuth, async (req, res) => {
  const ram = Number(req.body.ram);
  if (!Number.isFinite(ram)) {
    return res.status(400).json({ error: 'Invalid RAM value' });
  }
  if (ram < config.minecraft.ramMin || ram > config.minecraft.ramMax) {
    return res.status(400).json({ error: `RAM must be between ${config.minecraft.ramMin} and ${config.minecraft.ramMax} GB` });
  }

  try {
    await fsp.writeFile(config.minecraft.envFile, `MC_RAM=${ram}G\n`);
    await execSystemctl(['restart', config.minecraft.serviceName]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/server/stop', requireAuth, async (req, res) => {
  try {
    await execSystemctl(['stop', config.minecraft.serviceName]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/properties', requireAuth, async (req, res) => {
  try {
    const contents = await fsp.readFile(config.minecraft.propertiesFile, 'utf-8');
    const { map } = parseProperties(contents);
    const allowed = {};
    for (const key of config.minecraft.propertyWhitelist) {
      if (map.has(key)) {
        allowed[key] = map.get(key);
      }
    }
    res.json({ properties: allowed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/properties', requireAuth, async (req, res) => {
  const updates = req.body || {};
  const allowedUpdates = {};
  for (const key of config.minecraft.propertyWhitelist) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      allowedUpdates[key] = String(updates[key]);
    }
  }
  if (Object.keys(allowedUpdates).length === 0) {
    return res.status(400).json({ error: 'No whitelisted properties provided' });
  }

  try {
    const contents = await fsp.readFile(config.minecraft.propertiesFile, 'utf-8');
    const { lines } = parseProperties(contents);
    const updated = updateProperties(lines, allowedUpdates);
    await fsp.writeFile(config.minecraft.propertiesFile, updated);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/logs/stream', requireAuth, async (req, res) => {
  const logFile = config.minecraft.logFile;
  if (!fs.existsSync(logFile)) {
    return res.status(404).end();
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const tail = spawn('tail', ['-n', '200', '-F', logFile]);

  tail.stdout.on('data', (data) => {
    const lines = data.toString('utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      res.write(`data: ${line.replace(/\r/g, '')}\n\n`);
    }
  });

  tail.stderr.on('data', (data) => {
    res.write(`data: [tail error] ${data.toString('utf-8')}\n\n`);
  });

  req.on('close', () => {
    tail.kill('SIGTERM');
  });
});

app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const { target } = resolveRootPath(req.query.path || '.');
    const stats = await fsp.stat(target);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    const entries = await fsp.readdir(target, { withFileTypes: true });
    const detailed = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(target, entry.name);
      const entryStats = await fsp.stat(entryPath);
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entryStats.size,
        mtime: entryStats.mtime
      };
    }));

    res.json({ path: req.query.path || '.', entries: detailed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/download', requireAuth, async (req, res) => {
  try {
    const { target } = resolveRootPath(req.query.path || '.');
    const stats = await fsp.stat(target);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Not a file' });
    }
    res.download(target);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const upload = multer({ dest: uploadDir });

app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const { target } = resolveRootPath(req.body.path || '.');
    const destination = path.join(target, req.file.originalname);
    await fsp.rename(req.file.path, destination);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/files', requireAuth, async (req, res) => {
  try {
    const { target } = resolveRootPath(req.query.path || '.');
    const stats = await fsp.stat(target);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Only files can be deleted' });
    }
    await fsp.unlink(target);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(config.port, () => {
  console.log(`Minecraft control panel running on port ${config.port}`);
});
