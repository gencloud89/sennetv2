const fs = require('fs');

// Tìm hiểu cách app gọi API trong app.js
const app = fs.readFileSync('extracted/app_source/assets/js/app.js', 'utf8');

// Tìm các URL patterns quan trọng
console.log('=== URL patterns in app.js ===');
const urlPatterns = [
    'host.php',
    'api/v1/passport',
    'api/v1/client',
    '/login',
    '/subscribe',
    'token=',
    'apihost',
    'APP_API_URL',
];
for (const p of urlPatterns) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const count = (app.match(new RegExp(escaped, 'g')) || []).length;
    console.log(p + ': ' + count + ' times');
}

// Tìm function gọi login
console.log('');
console.log('=== Searching for login function ===');
// Tìm kiếm các pattern gần 'login'
let idx = -1;
let found = 0;
while ((idx = app.indexOf('login', idx + 1)) !== -1 && found < 15) {
    const ctx = app.substring(Math.max(0, idx - 30), Math.min(app.length, idx + 30));
    // Chỉ in những context có vẻ liên quan đến code (không phải text hiển thị)
    if (ctx.includes('{') || ctx.includes('}') || ctx.includes('=') || ctx.includes('function') || ctx.includes('fetch')) {
        console.log('  [' + idx + ']: ...' + ctx + '...');
        found++;
    }
}

// Tìm các axios usage
console.log('');
console.log('=== Axios usage in app.js ===');
let aidx = -1;
let acount = 0;
while ((aidx = app.indexOf('axios', aidx + 1)) !== -1 && acount < 10) {
    const ctx = app.substring(Math.max(0, aidx - 60), Math.min(app.length, aidx + 80));
    console.log('  [' + aidx + ']: ...' + ctx + '...');
    acount++;
}

// Tìm fetch usage patterns - đặc biệt là auth/login
console.log('');
console.log('=== Fetch calls with auth/login or passport ===');
let fidx = -1;
let fcount = 0;
while ((fidx = app.indexOf('fetch(', fidx + 1)) !== -1 && fcount < 30) {
    const ctx = app.substring(fidx, Math.min(app.length, fidx + 120));
    if (ctx.includes('login') || ctx.includes('passport') || ctx.includes('auth') || ctx.includes('token')) {
        console.log('  [' + fidx + ']: ' + ctx.substring(0, 100) + '...');
        fcount++;
    }
}
