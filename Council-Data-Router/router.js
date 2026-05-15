const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const wrap = require('./core/envelope');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const crypto = require('crypto');
const http = require('http');

const app = express();
const PORT = Number(process.env.NEXUS_PORT || 3001);
const BIND_HOST = process.env.NEXUS_BIND_HOST || '127.0.0.1';
const BODY_LIMIT = process.env.NEXUS_BODY_LIMIT || '10mb';
const EXEC_ENABLED = process.env.NEXUS_ENABLE_EXEC === '1';
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_TARGET = process.env.NEXUS_DEFAULT_PATH || path.resolve(__dirname, '..');
const ALLOWED_ORIGINS = new Set(
    (process.env.NEXUS_ALLOWED_ORIGINS || 'http://localhost:9002,http://127.0.0.1:9002')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'paths.json');
const DEFAULT_TREE_DEPTH = Number(process.env.NEXUS_TREE_DEPTH || 3);
const TEMP_PROBE_INTERVAL_MS = Number(process.env.NEXUS_TEMP_PROBE_INTERVAL_MS || 10000);
const LHM_WEB_URL = process.env.NEXUS_LHM_WEB_URL || 'http://127.0.0.1:8085/data.json';
const SKIPPED_TREE_NAMES = new Set([
    'node_modules',
    '.git',
    '.next',
    '.vs',
    'dist',
    'build',
    '.run-logs'
]);

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
let currentTarget = DEFAULT_TARGET;
let lastPeekPath = "";
let peekBurstCount = 0;

// THE PULSE STATE
let LATEST_STATS = { 
    cpu: null, 
    ram: null, 
    temp: null,
    temp_source: 'unavailable',
    uptime: null, 
    last_sync: 0 
};
let lastTempProbeAt = 0;

function translatePath(inputPath) {
    if (!inputPath) return "";
    try {
        let decoded = decodeURIComponent(inputPath);
        let normalized = decoded.replace(/\\/g, '/');
        if (!IS_WINDOWS) {
            normalized = normalized.replace(/^(\/\/wsl\.localhost\/Ubuntu|\/\/wsl\$\/Ubuntu)/i, '');
            normalized = normalized.replace(/^(\/\/wsl\.localhost|\/\/wsl\$)/i, '');
        }
        if (normalized.match(/^[a-zA-Z]:\//)) {
            if (!IS_WINDOWS) {
                const drive = normalized.charAt(0).toLowerCase();
                normalized = `/mnt/${drive}/${normalized.substring(3)}`;
            }
        }
        if (!IS_WINDOWS && normalized.startsWith('/Users/') && !normalized.startsWith('/mnt/')) {
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
if (!currentTarget || !fs.existsSync(currentTarget)) {
    currentTarget = DEFAULT_TARGET;
}

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

function readDirectoryTree(targetPath, depth = 0, maxDepth = DEFAULT_TREE_DEPTH) {
    try {
        const dirents = fs.readdirSync(targetPath, { withFileTypes: true });

        return dirents
            .filter((dirent) => !SKIPPED_TREE_NAMES.has(dirent.name))
            .map((dirent) => {
                const childPath = path.join(targetPath, dirent.name);
                const isDirectory = dirent.isDirectory();
                const node = {
                    name: dirent.name,
                    type: isDirectory ? 'folder' : 'file',
                    path: childPath
                };

                if (isDirectory && depth < maxDepth) {
                    node.children = readDirectoryTree(childPath, depth + 1, maxDepth);
                }

                return node;
            });
    } catch (e) {
        return [];
    }
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
function normalizeReading(value, precision = 0) {
    if (value === null || value === undefined || value === '') return null;
    const reading = Number(value);
    if (!Number.isFinite(reading)) return null;
    return Number(reading.toFixed(precision));
}

function normalizeTemperature(value) {
    const reading = normalizeReading(value, 1);
    if (reading === null || reading < -50 || reading > 150) return null;
    return reading;
}

function scoreTemperatureSensor(sensor) {
    const name = String(sensor.Name || sensor.name || sensor.Text || sensor.text || '').toLowerCase();
    const identifier = String(sensor.Identifier || sensor.identifier || sensor.SensorId || sensor.sensorId || '').toLowerCase();
    const combined = `${name} ${identifier}`;

    let score = 0;
    if (identifier.includes('/intelcpu/') || identifier.includes('/amdcpu/')) score += 30;
    if (combined.includes('cpu')) score += 15;
    // Prefer steady-state readings (average / package) over alarming peaks (core max). Core Max
    // is intentionally a per-sample maximum and on some laptops reads 98–100°C even when Core
    // Average sits near 84°C. Keep it positive but well below averages.
    if (combined.includes('average') || /\bavg\b/.test(combined)) score += 20;
    if (combined.includes('package')) score += 15;
    if (combined.includes('tctl') || combined.includes('tdie')) score += 12;
    if (combined.includes('core max')) score += 2;
    if (combined.includes('core')) score += 6;
    if (combined.includes('distance to tjmax')) score -= 40;
    if (combined.includes('gpu')) score -= 30;
    if (combined.includes('nvme') || combined.includes('ssd') || combined.includes('hdd')) score -= 25;
    if (combined.includes('motherboard') || combined.includes('chipset')) score -= 10;

    return score;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { timeout: 2500 }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
                if (body.length > 2 * 1024 * 1024) {
                    request.destroy(new Error('response too large'));
                }
            });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('request timeout')));
        request.on('error', reject);
    });
}

function collectLhmTemperatureSensors(node, sensors = []) {
    if (!node || typeof node !== 'object') return sensors;

    const sensorId = String(node.SensorId || node.Identifier || '');
    const sensorType = String(node.Type || node.SensorType || '');
    const rawValue = node.Value;
    const isTemperature = sensorType.toLowerCase() === 'temperature'
        || sensorId.toLowerCase().includes('/temperature/')
        || (typeof rawValue === 'string' && rawValue.includes('°C'));

    if (isTemperature) {
        const numericValue = typeof rawValue === 'number'
            ? rawValue
            : Number(String(rawValue || '').replace(/[^\d.-]/g, ''));
        const value = normalizeTemperature(numericValue);
        if (value !== null) {
            sensors.push({
                Name: node.Text || node.Name || 'Temperature',
                Identifier: sensorId,
                Value: value
            });
        }
    }

    const children = Array.isArray(node.Children) ? node.Children : [];
    children.forEach((child) => collectLhmTemperatureSensors(child, sensors));
    return sensors;
}

async function queryLibreHardwareMonitorWebTemperature() {
    try {
        const data = await fetchJson(LHM_WEB_URL);
        const sensors = collectLhmTemperatureSensors(data)
            .map((sensor) => ({ ...sensor, score: scoreTemperatureSensor(sensor) }))
            .filter((sensor) => sensor.score > 0)
            .sort((a, b) => b.score - a.score || b.Value - a.Value);

        if (!sensors.length) {
            return { value: null, source: 'unavailable' };
        }

        const selected = sensors[0];
        return {
            value: selected.Value,
            source: `LibreHardwareMonitor.web:${selected.Name}`
        };
    } catch (e) {
        return { value: null, source: 'unavailable' };
    }
}

function queryHardwareMonitorWmiTemperature() {
    if (!IS_WINDOWS) return Promise.resolve({ value: null, source: 'unavailable' });

    const script = `
$namespaces = @('root\\LibreHardwareMonitor', 'root\\OpenHardwareMonitor')
$sensors = @()
foreach ($namespace in $namespaces) {
  try {
    $sensors += Get-CimInstance -Namespace $namespace -ClassName Sensor -ErrorAction Stop |
      Where-Object { $_.SensorType -eq 'Temperature' -and $null -ne $_.Value } |
      Select-Object @{Name='Namespace';Expression={$namespace}}, Name, Identifier, Value
  } catch {}
}
$sensors | ConvertTo-Json -Compress -Depth 4
`;

    return new Promise((resolve) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { timeout: 5000, maxBuffer: 1024 * 1024 },
            (error, stdout) => {
                if (error || !stdout.trim()) {
                    resolve({ value: null, source: 'unavailable' });
                    return;
                }

                try {
                    const parsed = JSON.parse(stdout);
                    const sensors = (Array.isArray(parsed) ? parsed : [parsed])
                        .map((sensor) => ({
                            ...sensor,
                            normalizedValue: normalizeTemperature(sensor.Value),
                            score: scoreTemperatureSensor(sensor)
                        }))
                        .filter((sensor) => sensor.normalizedValue !== null && sensor.score > 0)
                        .sort((a, b) => b.score - a.score || b.normalizedValue - a.normalizedValue);

                    if (!sensors.length) {
                        resolve({ value: null, source: 'unavailable' });
                        return;
                    }

                    const selected = sensors[0];
                    const namespaceName = String(selected.Namespace || '').toLowerCase().includes('openhardwaremonitor')
                        ? 'OpenHardwareMonitor'
                        : 'LibreHardwareMonitor';
                    resolve({
                        value: selected.normalizedValue,
                        source: `${namespaceName}.wmi:${selected.Name || 'Temperature'}`
                    });
                } catch (parseError) {
                    resolve({ value: null, source: 'unavailable' });
                }
            }
        );
    });
}

async function readCpuTemperature() {
    try {
        const temperature = await si.cpuTemperature();
        const readings = [
            temperature?.main,
            temperature?.max,
            temperature?.chipset,
            ...(Array.isArray(temperature?.cores) ? temperature.cores : []),
            ...(Array.isArray(temperature?.socket) ? temperature.socket : [])
        ]
            .map(normalizeTemperature)
            .filter((value) => value !== null);

        if (readings.length === 0) {
            const now = Date.now();
            if (now - lastTempProbeAt < TEMP_PROBE_INTERVAL_MS) {
                return { value: LATEST_STATS.temp, source: LATEST_STATS.temp_source };
            }
            lastTempProbeAt = now;
            const webTemperature = await queryLibreHardwareMonitorWebTemperature();
            if (webTemperature.value !== null) return webTemperature;
            return queryHardwareMonitorWmiTemperature();
        }

        return { value: Math.max(...readings), source: 'systeminformation.cpuTemperature' };
    } catch (e) {
        return { value: null, source: 'unavailable' };
    }
}

async function updateHardwarePulse() {
    try {
        const [load, mem, time, temperature] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.time(),
            readCpuTemperature()
        ]);

        LATEST_STATS.cpu = normalizeReading(load.currentLoad);
        LATEST_STATS.ram = mem.total ? normalizeReading((mem.active / mem.total) * 100) : null;
        LATEST_STATS.uptime = normalizeReading(time.uptime, 3);
        LATEST_STATS.temp = temperature.value;
        LATEST_STATS.temp_source = temperature.source;
        LATEST_STATS.last_sync = Date.now();
    } catch (e) {
        // Silent fail, use last known good stats
    }
}

// Start the Pulse Loop (Every 2.5 seconds)
setInterval(() => { void updateHardwarePulse(); }, 2500);
void updateHardwarePulse(); // Initial fire

// --- ENDPOINTS (V16.0 PULSE ENGINE) ---

app.get(['/', '/health'], (req, res) => {
    res.json(wrap({
        status: "online",
        cpu_load: LATEST_STATS.cpu,
        ram_used: LATEST_STATS.ram,
        cpu_temp: LATEST_STATS.temp,
        cpu_temp_source: LATEST_STATS.temp_source,
        uptime: LATEST_STATS.uptime,
        last_sync: LATEST_STATS.last_sync,
        protocol: "V16.0 Pulse Engine"
    }, 'STABLE', 'HARDWARE_PULSE'));
});

app.get('/graph', requireAuth, async (req, res) => {
    try {
        const processes = await si.processes();
        const nodes = processes.list.sort((a, b) => b.cpu - a.cpu).slice(0, 10).map(p => ({ 
            id: p.pid, name: p.name, type: 'PROCESS', usage: p.cpu 
        }));
        res.json(wrap({ nodes, total_threads: processes.all }, 'STABLE', 'PROCESS_GRAPH'));
    } catch (e) { res.status(500).json({ error: "Graph Fault" }); }
});

app.all(['/filesystem/tree', '/tree', '/filesystem'], requireAuth, async (req, res) => {
    const shouldReset = req.query.reset === '1' || req.query.reset === 'true' || req.body?.reset === true;
    const rawPath = firstString(req.query.path, req.body?.path);

    if (shouldReset) {
        currentTarget = DEFAULT_TARGET;
    } else if (rawPath && rawPath.trim() !== "" && rawPath !== "undefined") {
        currentTarget = translatePath(rawPath);
    }

    const requestedDepth = Number(req.query.depth || req.body?.depth);
    const maxDepth = Number.isFinite(requestedDepth)
        ? Math.max(0, Math.min(5, requestedDepth))
        : DEFAULT_TREE_DEPTH;

    try {
        const tree = readDirectoryTree(currentTarget, 0, maxDepth);

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
        res.json(wrap({ tree, path: currentTarget, depth: maxDepth }, 'STABLE', 'FILESYSTEM_TREE'));
    } catch (e) { res.json(wrap({ tree: [], path: currentTarget, depth: maxDepth }, 'DEGRADED', 'FILESYSTEM_TREE')); }
});

app.post(['/set-path', '/nexus/command'], requireAuth, (req, res) => {
    const cmd = firstString(req.body?.cmd);
    const newPath = firstString(req.body?.path);
    if (cmd === 'SET_PATH' || newPath) {
        currentTarget = translatePath(newPath);
        saveConfig(newPath);
        console.log(`\n\x1b[33m[COMMAND]\x1b[0m Target Shift: ${currentTarget}`);
        res.json(wrap({ status: "SUCCESS", command: "SET_PATH", path: currentTarget }, 'STABLE', 'COMMAND'));
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
        res.json(wrap({ content, path: target }, 'STABLE', 'FILE_READ'));
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
        res.json(wrap({ status: "success", path: target, bytes: Buffer.byteLength(req.body.content, 'utf8') }, 'STABLE', 'FILE_WRITE'));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/delete-file', requireAuth, (req, res) => {
    const requestedPath = firstString(req.body?.path, req.body?.filepath);
    if (!requestedPath) return res.status(400).json({ error: "Invalid delete payload" });
    const target = translatePath(requestedPath);
    try {
        if (!fs.existsSync(target)) return res.status(404).json({ error: "Not Found" });
        if (!fs.statSync(target).isFile()) return res.status(400).json({ error: "Delete only supports files" });
        fs.unlinkSync(target);
        res.json(wrap({ status: "success", path: target }, 'STABLE', 'FILE_DELETE'));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/rename-file', requireAuth, (req, res) => {
    const requestedFromPath = firstString(req.body?.fromPath, req.body?.from_path, req.body?.sourcePath, req.body?.source);
    const requestedToPath = firstString(req.body?.toPath, req.body?.to_path, req.body?.targetPath, req.body?.destination);
    if (!requestedFromPath || !requestedToPath) return res.status(400).json({ error: "Invalid rename payload" });

    const source = translatePath(requestedFromPath);
    const destination = translatePath(requestedToPath);

    try {
        if (!fs.existsSync(source)) return res.status(404).json({ error: "Source not found" });
        if (!fs.statSync(source).isFile()) return res.status(400).json({ error: "Rename only supports files" });
        if (fs.existsSync(destination)) return res.status(409).json({ error: "Destination already exists" });
        if (!fs.existsSync(path.dirname(destination))) fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(source, destination);
        res.json(wrap({ status: "success", fromPath: source, toPath: destination }, 'STABLE', 'FILE_RENAME'));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/exec', requireAuth, (req, res) => {
    if (!EXEC_ENABLED) return res.status(403).json({ error: "Exec endpoint disabled" });
    const command = firstString(req.body?.command);
    if (!command) return res.status(400).json({ error: "Invalid command" });
    const cwd = firstString(req.body?.cwd);
    const targetDir = translatePath(cwd) || currentTarget;
    exec(command, { cwd: targetDir, maxBuffer: 1024*1024*10 }, (error, stdout, stderr) => {
        res.json(wrap({ output: stdout, stderr, exitCode: error ? error.code : 0 }, error ? 'DEGRADED' : 'STABLE', 'EXEC_OUTPUT'));
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
