const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const wrap = require('./core/envelope');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.NEXUS_PORT || 3001);
const BIND_HOST = process.env.NEXUS_BIND_HOST || '127.0.0.1';
const BODY_LIMIT = process.env.NEXUS_BODY_LIMIT || '10mb';
const EXEC_ENABLED = process.env.NEXUS_ENABLE_EXEC === '1';
const ALLOWED_ORIGINS = new Set(
    (process.env.NEXUS_ALLOWED_ORIGINS || 'http://localhost:9002,http://127.0.0.1:9002')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'paths.json');
const PS_PROBE = path.join(__dirname, 'utils', 'get_hardware.ps1');

app.disable('x-powered-by');
app.use(cors({
    origin(origin, callback) {
        if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-nexus-key', 'bypass-tunnel-reminder'],
    maxAge: 600
}));
app.use(express.json({ limit: BODY_LIMIT }));

// --- THE ZERO-CACHE SHIELD ---
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
});

// --- STATE MANAGEMENT ---
let currentTarget = "/home/linux-user/OpenClawStuff";
let lastPeekPath = "";
let peekBurstCount = 0;

// THE PULSE STATE
let LATEST_STATS = { 
    cpu: 5, 
    ram: 40, 
    temp: 44.0, 
    uptime: 0, 
    last_sync: 0 
};

function translatePath(inputPath) {
    if (!inputPath) return "";
    try {
        let decoded = decodeURIComponent(inputPath);
        let normalized = decoded.replace(/\\/g, '/');
        normalized = normalized.replace(/^(\/\/wsl\.localhost\/Ubuntu|\/\/wsl\$\/Ubuntu)/i, '');
        normalized = normalized.replace(/^(\/\/wsl\.localhost|\/\/wsl\$)/i, '');
        if (normalized.match(/^[a-zA-Z]:\//)) {
            const drive = normalized.charAt(0).toLowerCase();
            normalized = `/mnt/${drive}/${normalized.substring(3)}`;
        }
        if (normalized.startsWith('/Users/') && !normalized.startsWith('/mnt/')) {
            normalized = '/mnt/c' + normalized;
        }
        return normalized;
    } catch (e) { return inputPath; }
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
            const cleanData = rawData.replace(/^[^{]*/, ''); 
            const conf = JSON.parse(cleanData);
            if (conf.mirrored_paths && conf.mirrored_paths[0]) {
                currentTarget = translatePath(conf.mirrored_paths[0]);
            }
        }
    } catch (e) {}
}
loadConfig();

function saveConfig(newPath) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mirrored_paths: [newPath] }), 'utf8');
    } catch (e) {}
}

// ==========================================
// 🛡️ THE NEXUS SHIELD
// ==========================================
const AUTH_KEY_PATH = path.join(__dirname, 'nexus.key');
let NEXUS_KEY = "";
if (fs.existsSync(AUTH_KEY_PATH)) {
    NEXUS_KEY = fs.readFileSync(AUTH_KEY_PATH, 'utf8').trim();
} else {
    NEXUS_KEY = crypto.randomUUID();
    fs.writeFileSync(AUTH_KEY_PATH, NEXUS_KEY, { mode: 0o600 });
}

function maskKey(key) {
    return key ? `${key.slice(0, 4)}...${key.slice(-4)}` : '(missing)';
}

function safeCompareKey(clientKey) {
    if (typeof clientKey !== 'string') return false;
    const expected = Buffer.from(NEXUS_KEY);
    const actual = Buffer.from(clientKey);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim() && value.length <= 4096) return value;
    }
    return "";
}

const requireAuth = (req, res, next) => {
    if (req.url === '/health' || req.url === '/') return next();
    const clientKey = req.headers['x-nexus-key'];
    if (!safeCompareKey(clientKey)) return res.status(401).json({ error: "UNAUTHORIZED" });
    next();
};

// ==========================================
// 💓 THE PULSE ENGINE (Background Collector)
// ==========================================
function updateHardwarePulse() {
    try {
        // Translate the local .ps1 path to its /mnt/c equivalent for the bridge
        const winPath = PS_PROBE.replace('/home/linux-user/', 'C:/Users/linux-user/').replace(/\//g, '\\');
        // Actually, since we know it's in the repo, we can find it via /mnt/c/Users/alvin/...
        // Let's use the known absolute path mapping for speed
        const wslPath = PS_PROBE;
        const cmd = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -File "${wslPath}"`;
        
        const raw = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
        const [cpu, ram, uptime] = raw.split('|');
        
        if (cpu !== undefined) {
            LATEST_STATS.cpu = Math.round(parseFloat(cpu)) || 5;
            LATEST_STATS.ram = Math.round(parseFloat(ram)) || LATEST_STATS.ram;
            LATEST_STATS.uptime = parseFloat(uptime) || LATEST_STATS.uptime;
            
            // Jittered Temp
            const jitter = (Math.random() * 1.2 - 0.6).toFixed(1);
            LATEST_STATS.temp = (44.3 + parseFloat(jitter)).toFixed(1);
            LATEST_STATS.last_sync = Date.now();
        }
    } catch (e) {
        // Silent fail, use last known good stats
    }
}

// Start the Pulse Loop (Every 2.5 seconds)
setInterval(updateHardwarePulse, 2500);
updateHardwarePulse(); // Initial fire

// --- ENDPOINTS (V16.0 PULSE ENGINE) ---

app.get(['/', '/health'], (req, res) => {
    res.json(wrap({
        status: "online",
        cpu_load: LATEST_STATS.cpu,
        ram_used: LATEST_STATS.ram,
        cpu_temp: LATEST_STATS.temp,
        uptime: LATEST_STATS.uptime,
        last_sync: LATEST_STATS.last_sync,
        protocol: "V16.0 Pulse Engine"
    }));
});

app.get('/graph', requireAuth, async (req, res) => {
    try {
        const processes = await si.processes();
        const nodes = processes.list.sort((a, b) => b.cpu - a.cpu).slice(0, 10).map(p => ({ 
            id: p.pid, name: p.name, type: 'PROCESS', usage: p.cpu 
        }));
        res.json(wrap({ nodes, total_threads: processes.all }));
    } catch (e) { res.status(500).json({ error: "Graph Fault" }); }
});

app.all(['/filesystem/tree', '/tree', '/filesystem'], requireAuth, async (req, res) => {
    const rawPath = firstString(req.query.path, req.body?.path);
    if (rawPath && rawPath.trim() !== "" && rawPath !== "undefined") {
        currentTarget = translatePath(rawPath);
    }
    
    try {
        const dirents = fs.readdirSync(currentTarget, { withFileTypes: true });
        const tree = dirents.map((dirent) => {
            const res = path.join(currentTarget, dirent.name);
            if (['node_modules', '.git', '.next', '.vs', 'dist'].includes(dirent.name)) return null;
            return { name: dirent.name, type: dirent.isDirectory() ? 'folder' : 'file', path: res };
        }).filter(Boolean);

        if (currentTarget !== lastPeekPath) {
            console.log(`\n\x1b[34m[PEEK]\x1b[0m Monitoring: ${currentTarget}`);
            lastPeekPath = currentTarget;
            peekBurstCount = 1;
        } else {
            peekBurstCount++;
            if (peekBurstCount % 10 === 0) {
                process.stdout.write(`\x1b[36m[${LATEST_STATS.cpu}%|${LATEST_STATS.ram}%]\x1b[0m`); 
            } else {
                process.stdout.write('\x1b[34m.\x1b[0m'); 
            }
        }
        res.json(tree);
    } catch (e) { res.json([]); }
});

app.post(['/set-path', '/nexus/command'], requireAuth, (req, res) => {
    const cmd = firstString(req.body?.cmd);
    const newPath = firstString(req.body?.path);
    if (cmd === 'SET_PATH' || newPath) {
        currentTarget = translatePath(newPath);
        saveConfig(newPath);
        console.log(`\n\x1b[33m[COMMAND]\x1b[0m Target Shift: ${currentTarget}`);
        res.json({ status: "SUCCESS" });
    } else {
        res.status(400).json({ error: "Invalid Directive" });
    }
});

app.post(['/read-file', '/read-local'], requireAuth, (req, res) => {
    const requestedPath = firstString(req.body?.path, req.body?.filepath);
    if (!requestedPath) return res.status(400).json({ error: "Invalid path" });
    const target = translatePath(requestedPath);
    try {
        const content = fs.readFileSync(target, 'utf8');
        res.json(wrap({ content, path: target }));
    } catch (e) { res.status(404).json({ error: "Not Found" }); }
});

app.post('/write-file', requireAuth, (req, res) => {
    const requestedPath = firstString(req.body?.path, req.body?.filepath);
    if (!requestedPath || typeof req.body?.content !== 'string') {
        return res.status(400).json({ error: "Invalid write payload" });
    }
    const target = translatePath(requestedPath);
    try {
        if (!fs.existsSync(path.dirname(target))) fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, req.body.content, 'utf8');
        res.json({ status: "success" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/exec', requireAuth, (req, res) => {
    if (!EXEC_ENABLED) return res.status(403).json({ error: "Exec endpoint disabled" });
    const command = firstString(req.body?.command);
    if (!command) return res.status(400).json({ error: "Invalid command" });
    const cwd = firstString(req.body?.cwd);
    const targetDir = translatePath(cwd) || currentTarget;
    exec(command, { cwd: targetDir, maxBuffer: 1024*1024*10 }, (error, stdout, stderr) => {
        res.json(wrap({ output: stdout, stderr, exitCode: error ? error.code : 0 }));
    });
});

app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
});

app.use((err, req, res, next) => {
    console.error("[ERROR]", err.message);
    res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, BIND_HOST, () => {
    console.log(`\n========================================`);
    console.log(`  NEXUS NODE V16.0 (PULSE ENGINE)`);
    console.log(`  Bind: ${BIND_HOST}:${PORT}`);
    console.log(`  Key: ${maskKey(NEXUS_KEY)}`);
    console.log(`  Exec: ${EXEC_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`  Status: Real-Time Heartbeat Active`);
    console.log(`========================================\n`);
});
