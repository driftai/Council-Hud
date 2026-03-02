
/**
 * ==========================================
 *       NEXUS NODE V13.1 (STICKY SESSION)
 * ==========================================
 * - In-Memory Sticky Pathing: Remembers path per session.
 * - Anti-Flicker: Ignores "blind" requests (no path) once established.
 * - Smart Path Translator: WSL-to-Windows automatic mapping.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// 🛡️ THE NEXUS SHIELD (AUTH PROTOCOL)
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
    const clientKey = req.headers['x-nexus-key'];
    if (!clientKey || clientKey !== NEXUS_KEY) {
        console.log(`\x1b[31m[SECURITY BLOCK] Unauthorized attempt from ${req.ip}\x1b[0m`);
        return res.status(401).json({ error: "ACCESS DENIED: INVALID NEXUS KEY" });
    }
    next();
};

// ==========================================
// 📂 PATH PERSISTENCE (STICKY SESSION)
// ==========================================
const CONFIG_DIR = path.join(__dirname, 'config');
const PATH_CONFIG_FILE = path.join(CONFIG_DIR, 'paths.json');
let currentTargetPath = '/home/alvin-linux/OpenClawStuff'; // Memory fallback

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR);

function loadConfig() {
    if (fs.existsSync(PATH_CONFIG_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(PATH_CONFIG_FILE, 'utf8'));
            if (data.lastPath) {
                currentTargetPath = data.lastPath;
                console.log(`\x1b[36m[CONFIG] Loaded saved path: ${currentTargetPath}\x1b[0m`);
            }
        } catch (e) {
            console.error("[CONFIG] Failed to load paths.json");
        }
    }
}

function saveConfig(newPath) {
    try {
        currentTargetPath = newPath;
        fs.writeFileSync(PATH_CONFIG_FILE, JSON.stringify({ lastPath: newPath }, null, 2));
    } catch (e) {
        console.error("[CONFIG] Failed to save paths.json");
    }
}

loadConfig();

// ==========================================
// 🗺️ SMART PATH TRANSLATOR
// ==========================================
function translatePath(inputPath) {
    if (!inputPath) return "";
    try {
        let decoded = decodeURIComponent(inputPath);
        let normalized = decoded.replace(/\\/g, '/');
        
        if (normalized.match(/^[a-zA-Z]:\//)) {
            const mountPrefix = fs.existsSync('/mnt/host/c') ? '/mnt/host/' : '/mnt/';
            normalized = normalized.replace(/^([a-zA-Z]):\//, (match, drive) => `${mountPrefix}${drive.toLowerCase()}/`);
        }
        return normalized;
    } catch (e) {
        return inputPath;
    }
}

// ==========================================
// 📂 THE DEPTH-LIMITED PEEK PROTOCOL
// ==========================================
async function getFileTree(dir, currentDepth = 0, MAX_DEPTH = 3) {
    if (currentDepth > MAX_DEPTH) return [];

    try {
        const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(dirents.map(async (dirent) => {
            const res = path.resolve(dir, dirent.name);
            
            if (['node_modules', '.git', '.openclaw', '.next'].includes(dirent.name)) return null;
            
            if (dirent.isDirectory()) {
                return { 
                    name: dirent.name, 
                    type: 'folder', 
                    path: res,
                    children: await getFileTree(res, currentDepth + 1, MAX_DEPTH) 
                };
            }
            return { name: dirent.name, type: 'file', path: res };
        }));
        return files.filter(Boolean);
    } catch (e) {
        return [];
    }
}

// ==========================================
// 🚀 ENDPOINTS (PROTECTED BY NEXUS SHIELD)
// ==========================================

app.post('/read-file', requireAuth, async (req, res) => {
    const safePath = translatePath(req.body.path);
    try {
        const data = await fsPromises.readFile(safePath, 'utf8');
        res.json({ content: data, filepath: safePath });
    } catch (err) {
        res.status(404).json({ error: "File not found or access denied." });
    }
});

app.post('/write-file', requireAuth, async (req, res) => {
    const safePath = translatePath(req.body.path);
    try {
        await fsPromises.mkdir(path.dirname(safePath), { recursive: true });
        await fsPromises.writeFile(safePath, req.body.content, 'utf8');
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/filesystem/tree', requireAuth, async (req, res) => {
    try {
        // STICKY LOGIC: Use provided path OR the memory fallback
        const targetPath = req.body.path ? translatePath(req.body.path) : currentTargetPath;
        
        // Update memory if a new valid path was sent
        if (req.body.path) {
            saveConfig(translatePath(req.body.path));
        } else {
            console.log(`[STICKY] Using Session Path: ${currentTargetPath}`);
        }
        
        console.log(`[TREE] Scanning: ${targetPath}`);
        const tree = await getFileTree(targetPath);
        res.json({ tree });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/nexus/command', requireAuth, (req, res) => {
    const { cmd, pid, port, command, cwd } = req.body;
    const targetDir = translatePath(cwd) || currentTargetPath;

    if (cmd === 'KILL_PROCESS') {
        const killCmd = port ? `lsof -ti tcp:${port} | xargs kill -9` : `kill -9 ${pid}`;
        exec(killCmd, () => res.json({ status: "success" }));
    } else if (command) {
        exec(command, { cwd: targetDir, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) return res.status(500).json({ output: stderr || error.message, exitCode: error.code });
            res.json({ output: stdout, stderr: stderr });
        });
    } else {
        res.status(400).json({ error: "Unknown command format" });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        header: {
            node_id: "WSL-OMEGA-01",
            status: "STABLE",
            timestamp: new Date().toISOString(),
            type: "HARDWARE"
        },
        payload: {
            cpu_load: Math.floor(Math.random() * 30) + 10,
            ram_used: Math.floor(Math.random() * 20) + 40,
            cpu_temp: 42,
            uptime: process.uptime(),
            protocol: "Platinum V13.1 Sticky"
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ========================================
      NEXUS NODE V13.1 (STICKY SESSION)
    ========================================
    Uplink Port: ${PORT}
    🛡️ SECURITY KEY: ${NEXUS_KEY}
    Status: Sticky Mode Active
    ========================================
    `);
});
