/**
 * JSON Fortress (Content Sanitization)
 * Ensures raw file content cannot break the JSON response structure.
 * Sourced from <nexus-bridge-hardening> Pattern 2.
 */

function safeContent(raw) {
    if (!raw) return "";
    // Step 1: Use JSON.stringify to escape control characters, quotes, and newlines
    const escaped = JSON.stringify(raw);

    // Step 2: Remove the leading and trailing quotes added by stringify
    // This allows the value to be inserted into a larger JSON object correctly
    return escaped.substring(1, escaped.length - 1);
}

module.exports = { safeContent };
