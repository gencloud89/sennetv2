/**
 * mirror-bootstrap.js — v14-DEBUG cho SENNET VPN macOS
 * ==================================================================
 * VERSION: v14-DEBUG (2026-07-21)
 *
 * THAY ĐỔI so với v10:
 *   1. 🖥️ VPN DEBUG PANEL — hiển thị trạng thái VPN (core status, connection)
 *   2. 📡 IPC LISTENERS — bắt coreStatus, statusJS, applog từ main process
 *   3. 🔧 VPN ERROR DETECTION — hiển thị lỗi khi libcore không start được
 *
 * Giữ nguyên từ v10:
 *   - Default APP_API_URL = https://kio.senviet.us
 *   - x-hwid header trên mọi fetch request
 *   - Auto device report qua localStorage polling
 *   - Update dialog blocker (CSS + MutationObserver)
 *   - Axios mirror retry (dự phòng)
 * ==================================================================
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================

    var PANEL_DOMAINS = [
        'https://kio.senviet.us',
        'https://appsenviet.htb991.space',
        'https://htb991.space',
        'https://mirrorhk1.scdh2268.com',
        'https://mirrorhk2.scdh2268.com',
        'https://mirrorhk3.scdh2268.com',
        'https://mirrorhk4.scdh2268.com',
        'https://mirrorhk5.scdh2268.com',
        'https://mirrorhk6.scdh2268.com'
    ];

    var SUBSCRIBE_HOSTS = [
        'venom.cdy.892.htd892.com',
        'appsenviet.htb991.space',
        'htb991.space',
        'submirror1.scdh2268.com',
        'submirror2.scdh2268.com',
        'submirror3.scdh2268.com',
        'submirror4.scdh2268.com',
        'submirror5.scdh2268.com',
        'submirror6.scdh2268.com'
    ];

    var STORAGE_KEY_API_URL = 'APP_API_URL';
    var STORAGE_KEY_HWID = 'APP_DEVICE_HWID';
    var DEFAULT_PANEL_URL = 'https://kio.senviet.us';

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function extractHost(url) {
        try {
            if (url.indexOf('://') !== -1) {
                return (url.split('://')[1] || '').split('/')[0];
            }
            return url.split('/')[0];
        } catch (e) { return url; }
    }

    function replaceHost(url, newHost) {
        try {
            var parts = url.split('://');
            var protocol = parts.length > 1 ? parts[0] + '://' : 'https://';
            var rest = parts.length > 1 ? parts[1] : parts[0];
            var pathIndex = rest.indexOf('/');
            var path = pathIndex !== -1 ? rest.substring(pathIndex) : '/';
            return protocol + newHost + path;
        } catch (e) { return url; }
    }

    function getCurrentPanelUrl() {
        try { return localStorage.getItem(STORAGE_KEY_API_URL); }
        catch (e) { return null; }
    }

    // ============================================================
    // HWID GENERATOR
    // ============================================================

    function generateHWID() {
        var parts = [];

        try {
            var os = require('os');
            var hostname = os.hostname();
            parts.push(hostname);
            parts.push(os.platform());
            parts.push(os.arch());

            var nets = os.networkInterfaces();
            for (var key in nets) {
                if (nets.hasOwnProperty(key)) {
                    for (var i = 0; i < nets[key].length; i++) {
                        var net = nets[key][i];
                        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
                            parts.push(net.mac.replace(/:/g, ''));
                            break;
                        }
                    }
                    if (parts.length > 4) break;
                }
            }

            var cpus = os.cpus();
            if (cpus && cpus.length > 0) {
                parts.push(cpus[0].model.replace(/\s+/g, '_').substring(0, 30));
            }
        } catch (e) {
            // Fallback
            parts.push(navigator.userAgent || 'unknown');
            parts.push(navigator.platform || 'unknown');
            parts.push(navigator.hardwareConcurrency || '1');
            parts.push(screen.width + 'x' + screen.height);
        }

        var raw = parts.join('||');
        var hash = 0;
        for (var i = 0; i < raw.length; i++) {
            var chr = raw.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }

        var h = Math.abs(hash).toString(16).toUpperCase();
        while (h.length < 8) h = '0' + h;
        var shortHost = (parts[0] || 'UNKNOWN').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
        return 'MAC-' + shortHost + '-' + h.substring(0, 8);
    }

    function getOrCreateHWID() {
        try {
            var existing = localStorage.getItem(STORAGE_KEY_HWID);
            if (existing && existing.length > 3) return existing;
        } catch (e) {}

        var hwid = generateHWID();
        try { localStorage.setItem(STORAGE_KEY_HWID, hwid); } catch (e) {}
        return hwid;
    }

    window.getDeviceHWID = getOrCreateHWID;

    // ============================================================
    // DEVICE METADATA
    // ============================================================

    function getDeviceMetadata() {
        try {
            var os = require('os');
            return {
                device_name: os.hostname() || 'Mac',
                platform: os.platform() + ' ' + os.arch(),
                user_agent: navigator.userAgent || 'macos.v2board.app 2.0',
                os_release: os.release()
            };
        } catch (e) {
            return {
                device_name: 'Mac',
                platform: 'darwin',
                user_agent: navigator.userAgent || 'macos.v2board.app 2.0'
            };
        }
    }

    window.getDeviceMetadata = getDeviceMetadata;

    // ============================================================
    // 🔑 CRITICAL FIX #1: Set default APP_API_URL
    // ============================================================
    // App cần biết panel URL để kết nối. Nếu localStorage trống (lần đầu
    // cài trên Mac), app sẽ không biết gọi API nào → treo ở loading screen.
    // Fix: Set default panel URL nếu chưa có.

    function ensurePanelUrl() {
        try {
            var existing = localStorage.getItem(STORAGE_KEY_API_URL);
            if (!existing || existing.length < 5) {
                console.log('[MirrorBootstrap v10] APP_API_URL not set — using default: ' + DEFAULT_PANEL_URL);
                localStorage.setItem(STORAGE_KEY_API_URL, DEFAULT_PANEL_URL);
            } else {
                console.log('[MirrorBootstrap v10] APP_API_URL: ' + existing);
            }
        } catch (e) {
            console.log('[MirrorBootstrap v10] Cannot access localStorage to set APP_API_URL');
        }
    }

    // ============================================================
    // ⚡ CRITICAL FIX #2: Ultra-minimal fetch interceptor
    // ============================================================
    // v9 interceptor có QUÁ NHIỀU code xử lý response (clone, text, JSON parse,
    // mirror retry...) → mỗi thứ đều có thể gây lỗi trên Mac.
    //
    // v10: CHỈ thêm headers, trả về response nguyên bản.
    // KHÔNG clone(), KHÔNG text(), KHÔNG JSON parse(), KHÔNG mirror retry.

    var _hwidCache = null;
    var _metaCache = null;

    function setupFetchInterceptor() {
        if (typeof fetch === 'undefined') {
            setTimeout(setupFetchInterceptor, 100);
            return;
        }

        var _origFetch = window.fetch;

        // Pre-cache HWID và metadata (gọi 1 lần, dùng cho mọi request)
        _hwidCache = getOrCreateHWID();
        _metaCache = getDeviceMetadata();

        window.fetch = function (input, init) {
            try {
                var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');

                // Chỉ thêm headers cho HTTP/HTTPS requests
                if (url && (url.indexOf('http://') === 0 || url.indexOf('https://') === 0)) {
                    // Đảm bảo init và headers tồn tại
                    if (!init) { init = {}; }
                    if (!init.headers) { init.headers = {}; }

                    // Thêm headers — chỉ xử lý plain object (app KHÔNG dùng Headers class)
                    if (typeof init.headers === 'object' && !init.headers.has) {
                        if (!init.headers['x-hwid']) init.headers['x-hwid'] = _hwidCache;
                        if (!init.headers['X-Device-Name']) init.headers['X-Device-Name'] = _metaCache.device_name;
                        if (!init.headers['X-Device-Platform']) init.headers['X-Device-Platform'] = _metaCache.platform;
                    }
                }
            } catch (e) {
                // Nếu có lỗi JavaScript → fallback gọi fetch gốc
                console.log('[MirrorBootstrap v10] Fetch interceptor error, fallback to original fetch:', e.message);
            }

            // Luôn gọi fetch gốc — không can thiệp response
            return _origFetch.call(this, input, init);
        };

        console.log('[MirrorBootstrap v10] Fetch interceptor installed (minimal mode)');
    }

    // ============================================================
    // 🔄 DEVICE REPORTING — Poll localStorage thay vì đọc response body
    // ============================================================
    // Thay vì clone response và parse JSON (có thể gây lỗi), poll localStorage
    // để phát hiện token/auth_data sau khi user login thành công.
    // App v2board lưu token vào localStorage sau khi login.

    var _deviceReported = false;
    var _lastReportedToken = null;
    var _reportRetryCount = 0;
    var _MAX_REPORT_RETRIES = 10;

    function reportDevice(token) {
        if (_deviceReported && _lastReportedToken === token) return;

        var panelUrl = getCurrentPanelUrl() || DEFAULT_PANEL_URL;
        var hwid = _hwidCache || getOrCreateHWID();
        var meta = _metaCache || getDeviceMetadata();

        var subscribeUrl = panelUrl.replace(/\/+$/, '') + '/api/v1/client/subscribe';
        var fullUrl = subscribeUrl + '?token=' + encodeURIComponent(token);

        console.log('[MirrorBootstrap v10] Reporting device — HWID=' + hwid + ' token=' + token.substring(0, 10) + '...');

        var xhr = new XMLHttpRequest();
        xhr.open('GET', fullUrl, true);
        xhr.setRequestHeader('x-hwid', hwid);
        xhr.setRequestHeader('X-Device-Name', meta.device_name || 'Mac');
        xhr.setRequestHeader('X-Device-Platform', meta.platform || 'darwin');
        xhr.setRequestHeader('User-Agent', navigator.userAgent || 'macos.v2board.app 2.0');
        xhr.timeout = 15000;

        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                console.log('[MirrorBootstrap v10] ✅ Device reported successfully');
                _deviceReported = true;
                _lastReportedToken = token;
                _reportRetryCount = 0;
            } else {
                console.log('[MirrorBootstrap v10] Device report failed — HTTP ' + xhr.status);
                _reportRetryCount++;
                if (_reportRetryCount < _MAX_REPORT_RETRIES) {
                    setTimeout(function () { reportDevice(token); }, 5000);
                }
            }
        };

        xhr.onerror = function () {
            console.log('[MirrorBootstrap v10] Device report network error');
            _reportRetryCount++;
            if (_reportRetryCount < _MAX_REPORT_RETRIES) {
                setTimeout(function () { reportDevice(token); }, 5000);
            }
        };

        xhr.ontimeout = function () {
            console.log('[MirrorBootstrap v10] Device report timeout');
            _reportRetryCount++;
            if (_reportRetryCount < _MAX_REPORT_RETRIES) {
                setTimeout(function () { reportDevice(token); }, 5000);
            }
        };

        try { xhr.send(); } catch (e) {}
    }

    function startTokenPolling() {
        // Các key localStorage mà app v2board có thể lưu token sau login
        var TOKEN_KEYS = [
            'auth_data',
            'APP_TOKEN',
            'app_token',
            'token',
            'account',
            'APP_DATA_INDEX',
            'APP_DATA_MODE'
        ];

        var _lastTokenValue = null;
        var _pollCount = 0;

        setInterval(function () {
            _pollCount++;
            if (_deviceReported && _pollCount > 60) return; // Ngừng poll sau 60 lần nếu đã report

            try {
                for (var i = 0; i < TOKEN_KEYS.length; i++) {
                    var val = localStorage.getItem(TOKEN_KEYS[i]);
                    if (val && val.length > 3) {
                        // Thử parse JSON (account key thường là JSON)
                        if (TOKEN_KEYS[i] === 'account' || TOKEN_KEYS[i] === 'APP_DATA_INDEX') {
                            try {
                                var parsed = JSON.parse(val);
                                if (parsed.token) val = parsed.token;
                                if (parsed.auth_data) val = parsed.auth_data;
                            } catch (e) {}
                        }

                        if (val && val !== _lastTokenValue && val.length > 5) {
                            console.log('[MirrorBootstrap v10] Token detected in localStorage key: ' + TOKEN_KEYS[i]);
                            _lastTokenValue = val;
                            reportDevice(val);
                            return;
                        }
                    }
                }
            } catch (e) {}

            // Log mỗi 10 lần poll để debug
            if (_pollCount % 10 === 0 && !_deviceReported) {
                console.log('[MirrorBootstrap v10] Polling for token... (attempt ' + _pollCount + ', not yet reported)');
            }
        }, 3000);
    }

    // ============================================================
    // AXIOS INTERCEPTORS — Mirror retry (dự phòng)
    // ============================================================

    function setupAxiosInterceptors() {
        if (typeof axios === 'undefined') {
            setTimeout(setupAxiosInterceptors, 100);
            return;
        }

        var hwid = _hwidCache || getOrCreateHWID();
        var meta = _metaCache || getDeviceMetadata();

        // Request interceptor: thêm headers
        axios.interceptors.request.use(
            function (config) {
                if (!config.headers) config.headers = {};
                if (!config.headers['x-hwid']) config.headers['x-hwid'] = hwid;
                if (!config.headers['X-Device-Name']) config.headers['X-Device-Name'] = meta.device_name;
                if (!config.headers['X-Device-Platform']) config.headers['X-Device-Platform'] = meta.platform;
                return config;
            },
            function (error) { return Promise.reject(error); }
        );

        // Response interceptor: block version check + mirror retry
        axios.interceptors.response.use(
            function (response) {
                // Force version 4.2.1
                if (response.config && response.config.url &&
                    response.config.url.indexOf('/app/getVersion') !== -1 &&
                    response.data && response.data.data) {
                    response.data.data.macos_version = '4.2.1';
                    response.data.data.windows_version = '4.2.1';
                    response.data.data.android_version = '2.1.6';
                    response.data.data.macos_download_url = '';
                    response.data.data.windows_download_url = '';
                    response.data.data.android_download_url = '';
                }
                return response;
            },
            function (error) {
                // Mirror retry cho network errors
                var config = error.config;
                if (!config) return Promise.reject(error);

                var isNetworkError = !error.response &&
                    (error.code === 'ECONNABORTED' ||
                     error.code === 'ERR_NETWORK' ||
                     error.code === 'ERR_CONNECTION_REFUSED' ||
                     (error.message || '').indexOf('Network Error') !== -1 ||
                     (error.message || '').indexOf('timeout') !== -1);

                if (!isNetworkError) return Promise.reject(error);

                config._retryCount = (config._retryCount || 0) + 1;
                if (config._retryCount > PANEL_DOMAINS.length) return Promise.reject(error);

                var originalUrl = config._originalUrl || config.url;
                var nextDomain = PANEL_DOMAINS[config._retryCount % PANEL_DOMAINS.length];
                config.url = replaceHost(originalUrl, extractHost(nextDomain));
                config.timeout = (config.timeout || 10000) + 5000;

                return axios(config);
            }
        );

        console.log('[MirrorBootstrap v10] Axios interceptors installed');
    }

    // ============================================================
    // UPDATE DIALOG BLOCKER — CSS + MutationObserver
    // ============================================================

    function blockUpdateDialog() {
        var css = '\
            .update-dialog, .version-dialog, .modal-update, .dialog-update, \
            .el-message-box__wrapper.update-available { \
                display: none !important; visibility: hidden !important; \
                pointer-events: none !important; z-index: -9999 !important; opacity: 0 !important; \
            } \
        ';
        var style = document.createElement('style');
        style.id = 'mirror-block-update';
        style.textContent = css;
        if (document.head) {
            document.head.appendChild(style);
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                document.head.appendChild(style);
            });
        }

        var _debounceTimer = null;

        function scanDialogs() {
            if (_debounceTimer) clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(function () {
                _debounceTimer = null;
                var dialogs = document.querySelectorAll(
                    '.el-message-box, .el-dialog, .el-message, .el-notification, ' +
                    '[class*="dialog"], [class*="modal"], [class*="popup"], ' +
                    'dialog, [role="dialog"], [role="alertdialog"]'
                );
                for (var i = 0; i < dialogs.length; i++) {
                    var el = dialogs[i];
                    if (!el.isConnected || el.style.display === 'none') continue;
                    var text = (el.textContent || '').toLowerCase();
                    if (text.indexOf('new version') !== -1 ||
                        text.indexOf('cập nhật') !== -1 ||
                        text.indexOf('phiên bản mới') !== -1) {
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                    }
                }
            }, 500);
        }

        var observer = new MutationObserver(scanDialogs);

        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
    }

    // ============================================================
    // WHITE SCREEN MONITOR
    // ============================================================

    var _vueCheckAttempts = 0;
    function checkVueMounted() {
        _vueCheckAttempts++;
        var app = document.getElementById('app');
        var container = document.querySelector('.Container, .newsignPage, .newHome');
        if ((app && app.innerHTML && app.innerHTML.length > 50) || container) {
            console.log('[MirrorBootstrap v10] Vue mounted OK (attempt ' + _vueCheckAttempts + ')');
            return;
        }
        if (_vueCheckAttempts < 30) {
            setTimeout(checkVueMounted, 1000);
        } else {
            console.log('[MirrorBootstrap v10] ⚠️ Vue may not have mounted after 30s');
        }
    }

    // ============================================================
    // 🖥️ VPN DEBUG PANEL — Hiển thị trạng thái VPN
    // ============================================================

    var _vpnLogs = [];
    var _MAX_VPN_LOGS = 50;
    var _vpnPanel = null;

    function vpnLog(msg, color) {
        console.log('[VPN] ' + msg);
        _vpnLogs.push({ time: new Date().toISOString().substring(11, 23), msg: msg, color: color || '#0f0' });
        if (_vpnLogs.length > _MAX_VPN_LOGS) _vpnLogs.shift();
        updateVpnPanel();
    }

    function createVpnPanel() {
        if (_vpnPanel) return;
        _vpnPanel = document.createElement('div');
        _vpnPanel.id = '__vpnDebugPanel';
        _vpnPanel.style.cssText = 'position:fixed;bottom:0;right:0;z-index:999998;' +
            'background:rgba(0,0,0,0.9);color:#0f0;font:10px/1.3 monospace;' +
            'max-width:420px;max-height:220px;overflow-y:auto;' +
            'padding:4px 6px;border:1px solid #333;border-radius:4px 0 0 0;' +
            'opacity:0.88;white-space:pre-wrap;word-break:break-all;' +
            'pointer-events:auto;';
        // Get VPN log path
        var logPath = 'unknown';
        try {
            var app = require('electron').app || require('electron').remote.app;
            var path = require('path');
            logPath = path.join(app.getPath('appData'), 'Gudao', 'vpn_debug.log');
        } catch(e) {}
        _vpnPanel.innerHTML = '<b style="color:#ff0">VPN Debug</b> | <span id="__vpnCoreStatus" style="color:#f00">CORE: ?</span> | <span id="__vpnConnStatus" style="color:#f00">VPN: ?</span>\n' +
            '<span style="color:#888;font-size:9px">Log file: ' + logPath + '</span>\n';
        document.body.appendChild(_vpnPanel);
    }

    function updateVpnPanel() {
        if (!_vpnPanel) return;
        var html = '<b style="color:#ff0">VPN Debug</b> | <span id="__vpnCoreStatus">CORE: </span> | <span id="__vpnConnStatus">VPN: </span>\n';
        // Show last 18 entries
        var start = Math.max(0, _vpnLogs.length - 18);
        for (var i = start; i < _vpnLogs.length; i++) {
            var entry = _vpnLogs[i];
            html += '<span style="color:' + entry.color + '">' + entry.time + ' ' + entry.msg + '</span>\n';
        }
        _vpnPanel.innerHTML = html;
        _vpnPanel.scrollTop = _vpnPanel.scrollHeight;
    }

    function setupVpnIpcListeners() {
        try {
            var ipcRenderer = require('electron').ipcRenderer;
            if (!ipcRenderer) {
                vpnLog('ipcRenderer not available', '#f00');
                return;
            }
            vpnLog('IPC listener installed', '#0f0');

            // Core status (sing-box started/stopped)
            ipcRenderer.on('coreStatus', function (event, status) {
                vpnLog('Core ' + (status === 'true' ? 'STARTED' : 'STOPPED'), status === 'true' ? '#0f0' : '#f80');
            });

            // VPN connection status
            ipcRenderer.on('statusJS', function (event, status) {
                vpnLog('VPN ' + (status === 'true' ? 'CONNECTED' : 'DISCONNECTED'), status === 'true' ? '#0f0' : '#f80');
            });

            // Sing-box log output
            ipcRenderer.on('applog', function (event, data) {
                var msg = String(data).substring(0, 200);
                // Highlight errors
                var color = (msg.indexOf('error') !== -1 || msg.indexOf('fail') !== -1 || msg.indexOf('err') !== -1) ? '#f00' : '#888';
                vpnLog('SING: ' + msg, color);
            });

            // App exit
            ipcRenderer.on('appExit', function () {
                vpnLog('App exit signal', '#f80');
            });

            // V2Ray general log
            ipcRenderer.on('V2Ray-log', function (event, msg) {
                vpnLog('LOG: ' + msg, '#aaa');
            });

        } catch (e) {
            vpnLog('IPC setup error: ' + e.message, '#f00');
        }
    }

    // ============================================================
    // MAIN INIT
    // ============================================================
    // CRITICAL: Các phần quan trọng (set APP_API_URL, cài fetch interceptor)
    // PHẢI chạy NGAY LẬP TỨC (synchronous) vì script app.js chạy ngay sau
    // script này. Nếu đợi DOMContentLoaded, app.js sẽ gọi fetch() TRƯỚC KHI
    // interceptor được cài → mất header x-hwid và có thể gây lỗi.

    function initCritical() {
        console.log('[MirrorBootstrap v10] === CRITICAL INIT START ===');

        // 1. 🔑 SET DEFAULT PANEL URL — quan trọng nhất!
        // App cần biết panel URL để gọi API. Nếu không có → treo loading.
        ensurePanelUrl();

        // 2. Pre-cache HWID và metadata
        _hwidCache = getOrCreateHWID();
        _metaCache = getDeviceMetadata();
        console.log('[MirrorBootstrap v10] HWID=' + _hwidCache + ' device=' + _metaCache.device_name);

        // 3. ⚡ CÀI FETCH INTERCEPTOR NGAY LẬP TỨC
        // Đây là phần quan trọng nhất — phải chạy TRƯỚC app.js
        setupFetchInterceptor();

        // 4. Axios interceptors (sẽ retry nếu axios chưa load)
        setupAxiosInterceptors();

        console.log('[MirrorBootstrap v10] === CRITICAL INIT DONE ===');
    }

    function initDeferred() {
        console.log('[MirrorBootstrap v14] === DEFERRED INIT START ===');

        // 5. Block update dialogs (cần document.head và document.body)
        blockUpdateDialog();

        // 6. Start token polling for device reporting
        startTokenPolling();

        // 7. Monitor Vue mounting
        setTimeout(checkVueMounted, 3000);

        // 8. 🖥️ VPN Debug Panel (cần document.body)
        try {
            createVpnPanel();
            setupVpnIpcListeners();
            vpnLog('VPN Debug Panel ready', '#ff0');
            // Check if libcore exists
            try {
                var fs = require('fs');
                var path = require('path');
                var electron = require('electron');
                var app = electron.app || electron.remote.app;
                var appData = app.getPath('appData');
                var libcorePath = path.join(appData, 'Gudao', 'libcore');
                if (fs.existsSync(libcorePath)) {
                    vpnLog('libcore FOUND at: ' + libcorePath, '#0f0');
                    try {
                        fs.accessSync(libcorePath, fs.constants.X_OK);
                        vpnLog('libcore is executable', '#0f0');
                    } catch (e) {
                        vpnLog('libcore NOT executable: ' + e.message, '#f00');
                    }
                } else {
                    vpnLog('libcore MISSING: ' + libcorePath, '#f00');
                    // Check Resources/extra
                    var resPath = path.join(process.cwd(), 'resources', 'extra', 'libcore');
                    if (fs.existsSync(resPath)) {
                        vpnLog('libcore found in Resources: ' + resPath, '#0f0');
                    } else {
                        vpnLog('libcore also missing from Resources: ' + resPath, '#f00');
                    }
                }
            } catch (e) {
                vpnLog('libcore check error: ' + e.message, '#f00');
            }
        } catch (e) {
            console.log('[MirrorBootstrap v14] VPN panel error: ' + e.message);
        }

        console.log('[MirrorBootstrap v14] === DEFERRED INIT DONE ===');
    }

    // CHẠY CRITICAL PARTS NGAY LẬP TỨC (SYNCHRONOUS)
    // Để fetch interceptor sẵn sàng trước khi app.js chạy
    initCritical();

    // Deferred parts (cần DOM) chạy khi DOM sẵn sàng
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDeferred);
    } else {
        initDeferred();
    }

})();
