/**
 * The Ultimate Path Translator
 * Handles Windows (C:/), Linux (/mnt/c/), and hybrid mount points.
 * Sourced from <nexus-bridge-hardening> Pattern 1.
 */
const fs = require('fs');

function translatePath(inputPath) {
    if (!inputPath) return inputPath;
    
    // Step 1: Normalize all backslashes using char-code splitting (Regex-Free)
    let normalized = inputPath.split(String.fromCharCode(92)).join('/');
    
    // Step 2: Collapse double slashes
    while(normalized.includes('//')) {
        normalized = normalized.split('//').join('/');
    }

    // Step 3: Handle OS specific mappings
    if (process.platform === 'win32') {
        // Windows Host: Convert /mnt/c/ style to C:/
        if (normalized.toLowerCase().startsWith('/mnt/host/c/')) {
            normalized = 'C:/' + normalized.substring(12);
        } else if (normalized.toLowerCase().startsWith('/mnt/c/')) {
            normalized = 'C:/' + normalized.substring(7);
        }
        return normalized;
    } else {
        // Linux/WSL Host: Convert C:/ style to /mnt/c/
        if (normalized.match(/^[a-z]:\//i)) {
            const drive = normalized.charAt(0).toLowerCase();
            const prefix = fs.existsSync('/mnt/host/' + drive) ? `/mnt/host/${drive}/` : `/mnt/${drive}/`;
            normalized = prefix + normalized.substring(3);
        }
        return normalized;
    }
}

module.exports = { translatePath };
