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
let lastStats = { cpu: 0, ram: 0, temp: 45 };

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
    fs.writeFileSync(AUTH_KEY_PATH, NEXUS_KEY);
}

const requireAuth = (req, res, next) => {
    if (req.url === '/health' || req.url === '/' || req.url.includes('health')) return next();
    const clientKey = req.headers['x-nexus-key'];
    if (!clientKey || clientKey !== NEXUS_KEY) return res.status(401).json({ error: "UNAUTHORIZED" });
    next();
};

// ==========================================
// 🗺️ THE WINDOWS BRIDGE (NATIVE TELEMETRY)
// ==========================================
function getWindowsStats() {
    try {
        const psCommand = `
            $cpu = (Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;
            $mem = Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory;
            $memUsed = [math]::Round((($mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory) / $mem.TotalVisibleMemorySize) * 100);
            $temp = Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace 'root/wmi' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { ($_.CurrentTemperature - 2732)/10.0 };
            if (!$temp) { $temp = 45.0 + (Get-Random -Minimum -5 -Maximum 5) / 10.0 };
            $uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime;
            Write-Output "$cpu|$memUsed|$temp|$([math]::Round($uptime.TotalSeconds))"
        `.replace(/\n/g, ' ').trim();

        const result = execSync(`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "${psCommand}"`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
        const [cpu, ram, temp, uptime] = result.split('|');
        
        lastStats = { 
            cpu: Math.round(parseFloat(cpu)) || 5, 
            ram: Math.round(parseFloat(ram)) || 0, 
            temp: parseFloat(temp) || 45.0 
        };

        return {
            cpu_load: lastStats.cpu,
            ram_used: lastStats.ram,
            cpu_temp: lastStats.temp,
            uptime: parseFloat(uptime) || 0
        };
    } catch (e) {
        return null;
    }
}

// --- ENDPOINTS (V15.2 CONSOLE MIRROR) ---

app.get(['/', '/health'], async (req, res) => {
    try {
        const winStats = getWindowsStats();
        if (winStats) {
            return res.json(wrap({ status: "online", ...winStats, protocol: "V15.2 Mirror" }));
        }
        const [cpu, mem, time] = await Promise.all([si.currentLoad(), si.mem(), si.time()]);
        res.json(wrap({
            status: "online",
            cpu_load: Math.round(cpu.currentLoad),
            ram_used: Math.round((mem.active / mem.total) * 100),
            cpu_temp: 45.0,
            uptime: time.uptime,
            protocol: "V15.2 Fallback"
        }));
    } catch (e) { res.status(500).json({ error: "Fault" }); }
});

app.all(['/filesystem/tree', '/tree', '/filesystem'], requireAuth, async (req, res) => {
    const rawPath = req.query.path || req.body.path;
    if (rawPath && rawPath.trim() !== "" && rawPath !== "undefined") {
        currentTarget = translatePath(rawPath);
        saveConfig(rawPath);
    }
    
    try {
        const dirents = fs.readdirSync(currentTarget, { withFileTypes: true });
        const tree = dirents.map((dirent) => {
            const res = path.join(currentTarget, dirent.name);
            if (['node_modules', '.git', '.next', '.vs', 'dist'].includes(dirent.name)) return null;
            return { name: dirent.name, type: dirent.isDirectory() ? 'folder' : 'file', path: res };
        }).filter(Boolean);

        // CONSOLE MIRROR: Show hardware stats in the PEEK log
        if (currentTarget !== lastPeekPath) {
            console.log(`\n\x1b[34m[PEEK]\x1b[0m Monitoring: ${currentTarget}`);
            console.log(`\x1b[32m[STATS]\x1b[0m CPU: ${lastStats.cpu}% | RAM: ${lastStats.ram}% | TEMP: ${lastStats.temp}°C`);
            lastPeekPath = currentTarget;
            peekBurstCount = 1;
        } else {
            peekBurstCount++;
            // Every 10 pulses, show a mini telemetry update in the terminal
            if (peekBurstCount % 10 === 0) {
                process.stdout.write(`\x1b[36m[${lastStats.cpu}%|${lastStats.ram}%]\x1b[0m`); 
            } else {
                process.stdout.write('\x1b[34m.\x1b[0m'); 
            }
        }
        res.json(tree);
    } catch (e) { res.json([]); }
});

app.post(['/set-path', '/nexus/command'], requireAuth, (req, res) => {
    const { cmd, path: newPath, level } = req.body;
    if (cmd === 'SET_BRIGHTNESS') {
        const brightnessCmd = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command \"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${level})\"`;
        exec(brightnessCmd);
        return res.json(wrap({ status: "SUCCESS" }));
    }
    if (cmd === 'SET_PATH' || newPath) {
        currentTarget = translatePath(newPath);
        saveConfig(newPath);
        console.log(`\n\x1b[33m[COMMAND]\x1b[0m Target Shift: ${currentTarget}`);
        res.json({ status: "SUCCESS" });
    } else {
        res.status(400).json({ error: "Invalid Directive" });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`  NEXUS NODE V15.2 (CONSOLE MIRROR)`);
    console.log(`  Uplink: Direct Hardware Access`);
    console.log(`========================================\n`);
});
