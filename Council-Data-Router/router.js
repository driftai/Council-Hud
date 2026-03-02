const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3001;
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'paths.json');

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// --- THE ZERO-CACHE SHIELD ---
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
});

// --- STATE MANAGEMENT ---
let currentTarget = "/home/alvin-linux/OpenClawStuff";
let lastPeekPath = "";
let peekBurstCount = 0;

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
            const cleanData = rawData.replace(/^[^{]*/, '');
            const conf = JSON.parse(cleanData);
            if (conf.mirrored_paths && conf.mirrored_paths[0]) {
                currentTarget = translatePath(conf.mirrored_paths[0]);
                console.log(`\x1b[32m[CONFIG]\x1b[0m Path Restored: ${currentTarget}`);      
            }
        }
    } catch (e) { console.log(`\x1b[31m[CONFIG]\x1b[0m Restore failed: ${e.message}`); }
}
loadConfig();

function saveConfig(newPath) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mirrored_paths: [newPath] }), 'utf8');
    } catch (e) { console.error(`\x1b[31m[CONFIG]\x1b[0m Save failed: ${e.message}`); }
}

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

function getFileTree(dir, depth = 0) {
    if (depth > 3) return [];
    try {
        const dirents = fs.readdirSync(dir, { withFileTypes: true });
        return dirents.map((dirent) => {
            const res = path.join(dir, dirent.name);
            if (['node_modules', '.git', '.next', '.vs', 'dist', 'System Volume Information', '$RECYCLE.BIN'].includes(dirent.name)) return null;
            if (dirent.isDirectory()) {
                return { name: dirent.name, type: 'folder', path: res, children: getFileTree(res, depth + 1) };
            }
            return { name: dirent.name, type: 'file', path: res };
        }).filter(Boolean);
    } catch (e) { return []; }
}

// FIXED: Defining wrap locally and removing the require conflict
function wrap(payload, status = 'STABLE') {
    return {
        header: { 
            node_id: "WSL-ALVIN-01", 
            packet_id: uuidv4(), 
            timestamp: new Date().toISOString(), 
            schema_version: "2.1.0", 
            status: status,
            priority: "REALTIME"
        },
        payload
    };
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
    fs.writeFileSync(AUTH_KEY_PATH, NEXUS_KEY);
}

const requireAuth = (req, res, next) => {
    if (req.url === '/health' || req.url === '/' || req.url.includes('health')) return next();
    const clientKey = req.headers['x-nexus-key'];
    if (!clientKey || clientKey !== NEXUS_KEY) return res.status(401).json({ error: "UNAUTHORIZED" });
    next();
};

// --- ENDPOINTS ---

app.use((req, res, next) => {
    if (req.url.startsWith('/api/nexus')) req.url = req.url.replace('/api/nexus', '');
    next();
});

app.get(['/', '/health'], async (req, res) => {
    try {
        const [cpu, mem, temp, time] = await Promise.all([si.currentLoad(), si.mem(), si.cpuTemperature(), si.time()]);
        const data = {
            status: "online",
            cpu_load: Math.round(cpu.currentLoad),
            ram_used: Math.round((mem.active / mem.total) * 100),
            cpu_temp: temp.main || 45,
            uptime: time.uptime,
            protocol: "V14.3 Zero-Cache-Fix"
        };
        res.json(wrap(data));
    } catch (e) { res.status(500).json({ error: "Fault" }); }
});

app.get(['/graph', '/api/nexus/graph'], requireAuth, async (req, res) => {
    try {
        const processes = await si.processes();
        const nodes = processes.list.sort((a, b) => b.cpu - a.cpu).slice(0, 10).map(p => ({ id: p.pid, name: p.name, type: 'PROCESS', usage: p.cpu }));
        res.json(wrap({ nodes, total_threads: processes.all }));
    } catch (e) { res.status(500).json({ error: "Graph Fault" }); }
});

app.all(['/filesystem/tree', '/tree', '/filesystem'], requireAuth, async (req, res) => {
    const rawPath = req.query.path || req.body.path;
    if (rawPath && rawPath.trim() !== "" && rawPath !== "undefined") {
        currentTarget = translatePath(rawPath);
        saveConfig(rawPath);
    }
    const tree = getFileTree(currentTarget);
    if (currentTarget !== lastPeekPath) {
        console.log(`\n\x1b[34m[PEEK]\x1b[0m Monitoring: ${currentTarget}`);
        lastPeekPath = currentTarget;
        peekBurstCount = 1;
    } else {
        peekBurstCount++;
        if (peekBurstCount % 5 === 0) process.stdout.write('\x1b[34m.\x1b[0m');
    }
    res.json(wrap({ tree, root_path: currentTarget }));
});

app.post(['/set-path', '/nexus/command', '/command'], requireAuth, (req, res) => {
    const { cmd, path: newPath } = req.body;
    if (cmd === 'SET_PATH' || newPath) {
        currentTarget = translatePath(newPath);
        saveConfig(newPath);
        console.log(`\x1b[33m[COMMAND]\x1b[0m Path Set: ${currentTarget}`);
        res.json({ status: "SUCCESS" });
    } else {
        res.status(400).json({ error: "Invalid Directive" });
    }
});

app.post(['/read-file', '/read-local'], requireAuth, (req, res) => {
    const target = translatePath(req.body.path || req.body.filepath);
    try {
        const content = fs.readFileSync(target, 'utf8');
        res.json(wrap({ content, path: target }));
    } catch (e) { res.status(404).json({ error: "Not Found" }); }
});

app.post('/write-file', requireAuth, (req, res) => {
    const target = translatePath(req.body.path || req.body.filepath);
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, req.body.content, 'utf8');
        res.json({ status: "success" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/exec', requireAuth, (req, res) => {
    const { command, cwd } = req.body;
    const targetDir = translatePath(cwd) || currentTarget;
    exec(command, { cwd: targetDir, maxBuffer: 1024*1024*10 }, (error, stdout, stderr) => {
        res.json({ output: stdout, stderr, exitCode: error ? error.code : 0 });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`  NEXUS NODE V14.3 (ZERO-CACHE-FIX)`);
    console.log(`  🛡️ KEY: ${NEXUS_KEY}`);
    console.log(`  Target: ${currentTarget}`);
    console.log(`========================================\n`);
});
