const fs = require('fs');

const content = fs.readFileSync('sennet_extracted/assets/view/assets/js/app.js', 'utf8');

// Extract the _0x1e69 function
const idx = content.indexOf('function _0x1e69(){const _0x432040=[');
let depth = 0, started = false, inString = false, quoteChar = '';
let end = idx;
for (let i = idx; i < content.length; i++) {
    const ch = content[i];
    if (!inString) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
        else if (ch === "'" || ch === '"') { inString = true; quoteChar = ch; }
    } else {
        if (ch === '\\') i++;
        else if (ch === quoteChar) inString = false;
    }
}
const func1e69 = content.substring(idx, end);

// Also extract _0x28c6
const idx2 = content.indexOf('function _0x28c6(_0x5d5715,_0x91af6a){');
depth = 0; started = false; inString = false;
let end2 = idx2;
for (let i = idx2; i < content.length; i++) {
    const ch = content[i];
    if (!inString) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; if (started && depth === 0) { end2 = i + 1; break; } }
        else if (ch === "'" || ch === '"') { inString = true; quoteChar = ch; }
    } else {
        if (ch === '\\') i++;
        else if (ch === quoteChar) inString = false;
    }
}
const func28c6 = content.substring(idx2, end2);

// Execute globally to extract strings
global._strings = null;
eval(func1e69.replace('function _0x1e69', 'global._getStrings = function'));
const strings = global._getStrings();

console.log('Total strings:', strings.length);

// Print all URL-like strings
console.log('\n=== URL/Protocol strings ===');
for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (s && s.length > 5) {
        if (/https?:|wss?:|api\/|\.com|\.net|\.app|\.xyz|\.io|\.me|:\/\//.test(s)) {
            console.log('[' + i + ']:', s);
        }
    }
}

// Print domain-like strings
console.log('\n=== Domain strings ===');
for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (s && /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}$/.test(s)) {
        console.log('[' + i + ']:', s);
    }
}

// Search for strings containing key terms
console.log('\n=== V2Board/Payment/Skynet strings ===');
for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (s) {
        const low = s.toLowerCase();
        if (/sknet|sennet|v2board|checkout|stripe|alipay|weixin|paypal|skynet|subscription|panel/.test(low)) {
            console.log('[' + i + ']:', s);
        }
    }
}

// Also search for subscription/API related
console.log('\n=== Subscription/API strings ===');
for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (s) {
        const low = s.toLowerCase();
        if (/subscribe|subs\b|api\/v|passport|auth\/|token|login|register|traffic|server|profile/.test(low)) {
            console.log('[' + i + ']:', s);
        }
    }
}

// Save strings
fs.writeFileSync('decoded_strings_full.json', JSON.stringify(strings, null, 2));
console.log('\nSaved to decoded_strings_full.json');
