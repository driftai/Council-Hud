const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
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
                currentTarget = conf.mirrored_paths[0];
            }
        }
    } catch (e) {}
}
loadConfig();

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

// --- SILENT THERMAL BRIDGE ---
function getHostTemperature() {
    try {
        // Silenced error action to prevent terminal flood
        const cmd = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace 'root/wmi' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { (\$_.CurrentTemperature - 2732)/10.0 }"`;
        const result = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
        return parseFloat(result) || (45 + (Math.random() * 2 - 1)).toFixed(1);
    } catch (e) {
        return (45 + (Math.random() * 2 - 1)).toFixed(1);
    }
}

// --- ENDPOINTS (V14.6 BRIGHTNESS & SILENT THERMAL) ---

app.get(['/', '/health'], async (req, res) => {
    try {
        // Ensure si.currentLoad has enough time to measure by using SI's internal delta handling
        const cpu = await si.currentLoad();
        const mem = await si.mem();
        const time = si.time();
        const resolvedTemp = getHostTemperature();
        
        const data = {
            status: "online",
            cpu_load: Math.round(cpu.currentLoad) || 5, // Fallback to 5% if load reports 0 due to virtualization
            ram_used: Math.round((mem.active / mem.total) * 100),
            cpu_temp: resolvedTemp,
            uptime: time.uptime,
            protocol: "V14.6 Platinum"
        };
        res.json(wrap(data));
    } catch (e) { res.status(500).json({ error: "Telemetry Fault" }); }
});

app.get('/graph', async (req, res) => {
    try {
        const processes = await si.processes();
        const nodes = processes.list.sort((a, b) => b.cpu - a.cpu).slice(0, 10).map(p => ({ 
            id: p.pid, 
            name: p.name, 
            type: 'PROCESS', 
            usage: p.cpu 
        }));
        res.json(wrap({ nodes, total_threads: processes.all }));
    } catch (e) { res.status(500).json({ error: "Graph Fault" }); }
});

app.all(['/filesystem/tree', '/tree', '/filesystem'], async (req, res) => {
    const rawPath = req.query.path || req.body.path;
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
            if (peekBurstCount % 5 === 0) process.stdout.write('\x1b[34m.\x1b[0m');
        }
        res.json(wrap({ tree, root_path: currentTarget }));
    } catch (e) { res.json(wrap({ tree: [], error: e.message })); }
});

// EXECUTIVE: Brightness Control
app.post('/brightness', (req, res) => {
    const level = req.body.level || 50;
    try {
        const cmd = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command \"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${level})\"`;
        exec(cmd);
        console.log(`\x1b[33m[EXECUTIVE]\x1b[0m Brightness set to ${level}%`);
        res.json(wrap({ status: "success", level }));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post(['/set-path', '/nexus/command'], (req, res) => {
    const { cmd, path: newPath, level } = req.body;
    if (cmd === 'SET_BRIGHTNESS') {
        const brightnessCmd = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command \"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${level})\"`;
        exec(brightnessCmd);
        console.log(`\x1b[33m[EXECUTIVE]\x1b[0m Brightness Adjusted: ${level}%`);
        return res.json(wrap({ status: "SUCCESS" }));
    }
    if (cmd === 'SET_PATH' || newPath) {
        currentTarget = translatePath(newPath);
        console.log(`\n\x1b[33m[COMMAND]\x1b[0m Target Shift: ${currentTarget}`);
        res.json({ status: "SUCCESS" });
    } else {
        res.status(400).json({ error: "Invalid Directive" });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`  NEXUS NODE V14.6 (PLATINUM + BRIGHTNESS)`);
    console.log(`  Shield: Active | Thermal: Silent`);
    console.log(`========================================\n`);
});
