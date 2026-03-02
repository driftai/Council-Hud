const { exec } = require('child_process');

console.log('\x1b[36m[IRON LINK]\x1b[0m Initializing Cloudflare Tunnel Engine (Native)...');

// Using the native cloudflared binary we installed to avoid interactive license prompts
const tunnel = exec('cloudflared tunnel --url http://127.0.0.1:3001');

function handleOutput(data) {
    const text = data.toString();
    
    // Improved regex to catch the Cloudflare quick tunnel URL
    const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (urlMatch) {
        console.log(`\n\x1b[32m[IRON LINK] TUNNEL ACTIVE:\x1b[0m \x1b[1m\x1b[37m${urlMatch[0]}\x1b[0m\n`);
        console.log(`Copy this URL to your Firebase .env file!`);
    } else if (text.trim() && !text.includes('Constitutes a symbol of your signature')) {
        // Log info logs but keep it clean
        if (text.includes('INF')) {
             console.log(`[TUNNEL] ${text.trim()}`);
        }
    }
}

tunnel.stdout.on('data', handleOutput);
tunnel.stderr.on('data', handleOutput);

tunnel.on('close', (code) => {
    console.log(`\x1b[31m[IRON LINK] Tunnel offline (Exit Code: ${code}).\x1b[0m`);
    process.exit(code || 1);
});
