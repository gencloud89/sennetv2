/**
 * mirror-bootstrap.js — Domain Mirror + HWID Fix cho SENNET VPN macOS
 * ==================================================================
 * VERSION: v9-DEBUG (2026-07-21)
 * - Bọc TOÀN BỘ fetch interceptor trong try-catch
 * - Fallback về _origFetch nếu có lỗi JavaScript
 * - Console.log ở MỖI bước để xác định chính xác dòng gây lỗi
 * - Global unhandledrejection handler
 * - Debug log array window.__mirrorDebugLog
 *
 * Chức năng:
 *   1. Domain panel & subscribe mirror (china-mirror-guide.md)
 *   2. Axios interceptors: retry với mirror domain khi request thất bại
 *   3. HWID Generator: tự động tạo hardware ID và gửi qua x-hwid header
 *   4. Tải domain-backup-config.json từ panel
 *   5. White screen fix: error handler + Vue mount monitor
 * ==================================================================
 */
(function () {
    'use strict';

    // ============================================================
    // DEBUG: Global error capture
    // ============================================================
    window.__mirrorDebugLog = [];
    var _MAX_DEBUG_LOG = 200;

    function _debugLog(msg) {
        var entry = '[MirrorDebug ' + new Date().toISOString() + '] ' + msg;
        console.log(entry);
        // Lưu vào array để inspect qua DevTools
        try {
            window.__mirrorDebugLog.push(entry);
            if (window.__mirrorDebugLog.length > _MAX_DEBUG_LOG) {
                window.__mirrorDebugLog.shift();
            }
        } catch (e) {}
    }

    // Bắt unhandled Promise rejections
    window.addEventListener('unhandledrejection', function (e) {
        _debugLog('UNHANDLED REJECTION: ' + (e.reason ? (e.reason.message || e.reason) : 'unknown'));
        if (e.reason && e.reason.stack) {
            _debugLog('  Stack: ' + e.reason.stack.substring(0, 200));
        }
    });

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

    var DELAY_TEST_URLS = [
        'http://www.gstatic.com/generate_204',
        'http://cp.cloud.360.cn/generate_204',
        'http://connect.rom.miui.com/generate_204',
        'http://www.baidu.com'
    ];

    var STORAGE_KEY_API_URL = 'APP_API_URL';
    var STORAGE_KEY_HWID = 'APP_DEVICE_HWID';
    var DOMAIN_CONFIG_PATH = '/domain-backup-config.json';

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
    // HWID GENERATOR — Tạo Hardware ID duy nhất cho thiết bị
    // ============================================================

    function generateHWID() {
        var parts = [];

        try {
            // Sử dụng Node.js os module (có sẵn trong Electron)
            var os = require('os');
            _debugLog('generateHWID: require(os) OK');
            var hostname = os.hostname();
            var platform = os.platform();
            var arch = os.arch();
            parts.push(hostname);
            parts.push(platform);
            parts.push(arch);
            _debugLog('generateHWID: hostname=' + hostname + ' platform=' + platform + ' arch=' + arch);

            // Lấy MAC address đầu tiên (không phải internal)
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

            // CPU info
            var cpus = os.cpus();
            if (cpus && cpus.length > 0) {
                parts.push(cpus[0].model.replace(/\s+/g, '_').substring(0, 30));
            }
        } catch (e) {
            // Node.js os không có sẵn (fallback cho môi trường browser)
            _debugLog('generateHWID: require(os) FAILED — ' + e.message + ' — using navigator fallback');
            parts.push(navigator.userAgent || 'unknown');
            parts.push(navigator.platform || 'unknown');
            parts.push(navigator.hardwareConcurrency || '1');
            parts.push(screen.width + 'x' + screen.height);
        }

        // Tạo SHA256-like hash đơn giản từ các parts
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
            if (existing && existing.length > 3) {
                return existing;
            }
        } catch (e) {}

        var hwid = generateHWID();
        try {
            localStorage.setItem(STORAGE_KEY_HWID, hwid);
        } catch (e) {}

        _debugLog('getOrCreateHWID: ' + hwid);
        return hwid;
    }

    // Xuất HWID ra global để các module khác có thể gọi
    window.getDeviceHWID = getOrCreateHWID;

    // ============================================================
    // DEVICE METADATA — Tạo thông tin thiết bị cho panel
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
            _debugLog('getDeviceMetadata: require(os) FAILED — ' + e.message + ' — using fallback');
            return {
                device_name: 'Mac',
                platform: 'darwin',
                user_agent: navigator.userAgent || 'macos.v2board.app 2.0'
            };
        }
    }

    window.getDeviceMetadata = getDeviceMetadata;

    // ============================================================
    // DOMAIN BACKUP CONFIG
    // ============================================================

    function loadDomainBackupConfig(callback) {
        var currentUrl = getCurrentPanelUrl();
        if (!currentUrl) { if (callback) callback(); return; }
        var configUrl = currentUrl.replace(/\/+$/, '') + DOMAIN_CONFIG_PATH;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', configUrl, true);
        xhr.timeout = 8000;
        xhr.onload = function () {
            if (xhr.status === 200) {
                try {
                    var config = JSON.parse(xhr.responseText);
                    if (config.panel_domains && config.panel_domains.length > 0) {
                        PANEL_DOMAINS = config.panel_domains;
                    }
                    if (config.subscribe_domains && config.subscribe_domains.length > 0) {
                        SUBSCRIBE_HOSTS = config.subscribe_domains;
                    }
                } catch (e) {}
            }
            if (callback) callback();
        };
        xhr.onerror = function () { if (callback) callback(); };
        xhr.ontimeout = function () { if (callback) callback(); };
        try { xhr.send(); } catch (e) { if (callback) callback(); }
    }

    // ============================================================
    // AXIOS INTERCEPTORS — Domain Mirror + x-hwid Header
    // ============================================================

    function setupAxiosInterceptors() {
        if (typeof axios === 'undefined') {
            setTimeout(setupAxiosInterceptors, 100);
            return;
        }

        _debugLog('setupAxiosInterceptors: axios found, installing interceptors');

        axios.interceptors.request.use(
            function (config) {
                config._originalUrl = config.url;
                config._retryCount = config._retryCount || 0;
                config._maxRetries = PANEL_DOMAINS.length;

                if (!config.headers) {
                    config.headers = {};
                }

                var hwid = getOrCreateHWID();
                if (hwid && !config.headers['x-hwid']) {
                    config.headers['x-hwid'] = hwid;
                }

                var meta = getDeviceMetadata();
                if (meta.device_name && !config.headers['X-Device-Name']) {
                    config.headers['X-Device-Name'] = meta.device_name;
                }
                if (meta.platform && !config.headers['X-Device-Platform']) {
                    config.headers['X-Device-Platform'] = meta.platform;
                }

                return config;
            },
            function (error) { return Promise.reject(error); }
        );

        axios.interceptors.response.use(
            function (response) {
                if (response.config && response.config.url &&
                    response.config.url.indexOf('/client/subscribe') !== -1) {
                    _debugLog('Axios: Subscribe OK');
                }

                if (response.config && response.config.url &&
                    response.config.url.indexOf('/app/getVersion') !== -1 &&
                    response.data && response.data.data) {
                    _debugLog('Axios: Intercepted getVersion — forcing version');
                    response.data.data.windows_version = '4.2.1';
                    response.data.data.macos_version = '4.2.1';
                    response.data.data.android_version = '2.1.6';
                    response.data.data.windows_download_url = '';
                    response.data.data.macos_download_url = '';
                    response.data.data.android_download_url = '';
                }

                return response;
            },
            function (error) {
                var config = error.config;
                if (!config) return Promise.reject(error);

                var isNetworkError = !error.response &&
                    (error.code === 'ECONNABORTED' ||
                     error.code === 'ERR_NETWORK' ||
                     error.code === 'ERR_CONNECTION_REFUSED' ||
                     error.code === 'ERR_TIMED_OUT' ||
                     (error.message || '').indexOf('Network Error') !== -1 ||
                     (error.message || '').indexOf('timeout') !== -1);

                if (!isNetworkError) return Promise.reject(error);
                if (config._retryCount >= config._maxRetries) return Promise.reject(error);

                config._retryCount++;
                var originalUrl = config._originalUrl || config.url;
                var nextDomainIndex = config._retryCount % PANEL_DOMAINS.length;
                var mirrorDomain = PANEL_DOMAINS[nextDomainIndex];

                var panelHosts = [];
                for (var i = 0; i < PANEL_DOMAINS.length; i++) {
                    panelHosts.push(extractHost(PANEL_DOMAINS[i]));
                }
                var currentPanelHost = extractHost(getCurrentPanelUrl() || PANEL_DOMAINS[0]);
                var requestHost = extractHost(originalUrl);

                if (panelHosts.indexOf(requestHost) !== -1 || requestHost === currentPanelHost) {
                    config.url = replaceHost(originalUrl, extractHost(mirrorDomain));
                }
                config.timeout = (config.timeout || 10000) + 5000;
                _debugLog('Axios: Retry with mirror: ' + config.url);
                return axios(config);
            }
        );
    }

    // ============================================================
    // SUBSCRIBE URL HELPER
    // ============================================================

    window.getMirrorSubscribeUrls = function (originalSubscribeUrl) {
        var urls = [];
        for (var i = 0; i < SUBSCRIBE_HOSTS.length; i++) {
            urls.push(replaceHost(originalSubscribeUrl, SUBSCRIBE_HOSTS[i]));
        }
        return urls;
    };

    window.MIRROR_DELAY_TEST_URLS = DELAY_TEST_URLS;
    window.MIRROR_PANEL_DOMAINS = PANEL_DOMAINS;
    window.MIRROR_SUBSCRIBE_HOSTS = SUBSCRIBE_HOSTS;

    // ============================================================
    // WHITE SCREEN FIX
    // ============================================================

    window._mirrorBootstrapLoaded = true;

    window.addEventListener('error', function (e) {
        _debugLog('Global error: ' + e.message + ' ' + e.filename + ':' + e.lineno);
    });

    var vueCheckAttempts = 0;
    function checkVueMounted() {
        vueCheckAttempts++;
        var app = document.getElementById('app');
        var container = document.querySelector('.Container, .newsignPage, .newHome');
        if ((app && app.innerHTML && app.innerHTML.length > 50) || container) {
            _debugLog('Vue app mounted OK (attempt ' + vueCheckAttempts + ')');
            return;
        }
        if (vueCheckAttempts < 30) {
            setTimeout(checkVueMounted, 1000);
        } else {
            _debugLog('Vue may not have mounted after 30s — possible white screen');
        }
    }

    // ============================================================
    // LAST-RESORT UPDATE DIALOG BLOCKER
    // ============================================================

    function blockUpdateDialog() {
        var css = '\
            .update-dialog, \
            .version-dialog, \
            .modal-update, \
            .dialog-update, \
            .el-message-box__wrapper.update-available { \
                display: none !important; \
                visibility: hidden !important; \
                pointer-events: none !important; \
                z-index: -9999 !important; \
                opacity: 0 !important; \
            } \
            .v-modal:has(+ .update-dialog), \
            .el-overlay:has(+ .el-message-box__wrapper.update-available) { \
                display: none !important; \
            } \
        ';
        var style = document.createElement('style');
        style.id = 'mirror-block-update';
        style.textContent = css;
        document.head.appendChild(style);

        var _observerDebounceTimer = null;
        var _observerDebounceMs = 500;

        var observer = new MutationObserver(function (mutations) {
            if (_observerDebounceTimer) {
                clearTimeout(_observerDebounceTimer);
            }
            _observerDebounceTimer = setTimeout(function () {
                _observerDebounceTimer = null;
                var dialogElements = document.querySelectorAll(
                    '.el-message-box, .el-dialog, .el-message, .el-notification, ' +
                    '[class*="dialog"], [class*="modal"], [class*="popup"], ' +
                    'dialog, [role="dialog"], [role="alertdialog"]'
                );
                for (var i = 0; i < dialogElements.length; i++) {
                    var el = dialogElements[i];
                    if (!el.isConnected || el.style.display === 'none') continue;

                    var text = (el.textContent || '').toLowerCase();

                    if (text.indexOf('new version') !== -1 ||
                        text.indexOf('new version found') !== -1 ||
                        text.indexOf('cập nhật') !== -1 ||
                        text.indexOf('phiên bản mới') !== -1 ||
                        text.indexOf('đã có bản cập nhật') !== -1) {

                        _debugLog('Hiding update dialog: ' + (el.className || el.tagName));
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                        el.setAttribute('data-mirror-hidden', 'true');
                    }
                }
            }, _observerDebounceMs);
        });

        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
    }

    // ============================================================
    // INIT
    // ============================================================

    var _deviceReported = false;
    var _reportRetryTimer = null;
    var _lastToken = null;

    function watchForLoginAndReportDevice() {
        if (typeof axios === 'undefined') {
            setTimeout(watchForLoginAndReportDevice, 200);
            return;
        }

        axios.interceptors.response.use(
            function (response) {
                var isLoginUrl = response.config && response.config.url && (
                    response.config.url.indexOf('/passport/auth/login') !== -1 ||
                    response.config.url.indexOf('/passport/auth/token2Login') !== -1 ||
                    response.config.url.indexOf('/api/v1/app/applogin') !== -1
                );

                var authData = null;
                var token = null;
                if (response.data) {
                    authData = response.data.auth_data || null;
                    token = response.data.token || null;
                    if (response.data.data) {
                        authData = authData || response.data.data.auth_data;
                        token = token || response.data.data.token;
                    }
                }

                if (isLoginUrl && (authData || token)) {
                    _debugLog('Login detected via axios — will report device');

                    setTimeout(function () {
                        var panelUrl = getCurrentPanelUrl();
                        if (!panelUrl) {
                            var loginUrl = response.config.url;
                            var match = loginUrl.match(/^(https?:\/\/[^\/]+)/);
                            if (match) panelUrl = match[1];
                        }
                        if (!panelUrl) {
                            _debugLog('No panel URL — skipping device report');
                            return;
                        }

                        var subscribeUrl = panelUrl.replace(/\/+$/, '') + '/api/v1/client/subscribe';
                        var hwid = getOrCreateHWID();

                        var params = '';
                        if (token) {
                            params = '?token=' + encodeURIComponent(token);
                        }

                        axios.get(subscribeUrl + params, {
                            headers: {
                                'x-hwid': hwid,
                                'User-Agent': navigator.userAgent || 'macos.v2board.app 2.0'
                            },
                            timeout: 15000
                        }).then(function (res) {
                            _debugLog('Device reported via axios OK');
                            if (_reportRetryTimer) {
                                clearInterval(_reportRetryTimer);
                                _reportRetryTimer = null;
                            }
                        }).catch(function (err) {
                            _debugLog('Device report via axios failed: ' + err.message);
                            setTimeout(function () {
                                axios.get(subscribeUrl + params, {
                                    headers: { 'x-hwid': hwid },
                                    timeout: 15000
                                }).then(function () {
                                    _debugLog('Device report retry OK');
                                }).catch(function () {
                                    _debugLog('Device report retry also failed');
                                });
                            }, 5000);
                        });
                    }, 2000);
                }
                return response;
            },
            function (error) { return Promise.reject(error); }
        );
    }

    // ============================================================
    // FETCH INTERCEPTOR — *** DEBUG VERSION v9 ***
    // ============================================================
    // Thay đổi so với v8:
    //   1. Bọc TOÀN BỘ code synchronous trong try-catch
    //   2. Nếu lỗi → fallback gọi _origFetch trực tiếp
    //   3. Console.log ở MỖI bước với request ID
    //   4. try-catch trong response handler
    //   5. try-catch trong error handler
    //   6. Global unhandledrejection listener
    // ============================================================

    // Hàm helper để thêm header vào fetch init — BỌC TRY-CATCH
    function _setFetchHeader(headers, key, value) {
        try {
            if (headers instanceof Headers) {
                if (!headers.has(key)) headers.set(key, value);
            } else if (Array.isArray(headers)) {
                var exists = false;
                for (var i = 0; i < headers.length; i++) {
                    if ((headers[i][0] || '').toLowerCase() === key.toLowerCase()) {
                        exists = true; break;
                    }
                }
                if (!exists) headers.push([key, value]);
            } else {
                var found = false;
                for (var k in headers) {
                    if (k.toLowerCase() === key.toLowerCase()) { found = true; break; }
                }
                if (!found) headers[key] = value;
            }
        } catch (e) {
            _debugLog('_setFetchHeader ERROR: ' + e.message + ' for key=' + key);
        }
    }

    // Hàm helper: kiểm tra URL có thuộc panel domain không
    function _isPanelRequest(url) {
        if (!url || url.indexOf('http') !== 0) return false;
        var allHosts = [];
        for (var i = 0; i < PANEL_DOMAINS.length; i++) {
            allHosts.push(extractHost(PANEL_DOMAINS[i]));
        }
        var requestHost = extractHost(url);
        for (var j = 0; j < allHosts.length; j++) {
            if (requestHost === allHosts[j]) return true;
        }
        for (var k = 0; k < SUBSCRIBE_HOSTS.length; k++) {
            if (requestHost === SUBSCRIBE_HOSTS[k]) return true;
        }
        return false;
    }

    // Helper: tạo input mới từ URL đã thay đổi
    function newInputFromUrl(newUrl, originalInput) {
        if (typeof originalInput === 'string') return newUrl;
        if (originalInput && originalInput.url) {
            try {
                var req = new Request(newUrl, originalInput);
                return req;
            } catch (e) {
                return newUrl;
            }
        }
        return newUrl;
    }

    // Gọi subscribe API để ghi device
    function triggerDeviceReport(serverBase, token, hwid) {
        if (_deviceReported) return;
        _deviceReported = true;

        var subscribeUrl = serverBase.replace(/\/+$/, '') + '/api/v1/client/subscribe';
        var params = '?token=' + encodeURIComponent(token);
        var meta = getDeviceMetadata();

        _debugLog('DEVICE REPORT: HWID=' + hwid + ' URL=' + subscribeUrl);

        var doReport = function () {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', subscribeUrl + params, true);
            xhr.setRequestHeader('x-hwid', hwid);
            xhr.setRequestHeader('X-Device-Name', meta.device_name);
            xhr.setRequestHeader('X-Device-Platform', meta.platform);
            xhr.setRequestHeader('User-Agent', navigator.userAgent || 'macos.v2board.app 2.0');
            xhr.timeout = 15000;

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    _debugLog('Device reported SUCCESSFULLY');
                    if (_reportRetryTimer) {
                        clearInterval(_reportRetryTimer);
                        _reportRetryTimer = null;
                    }
                } else {
                    _debugLog('Device report FAILED — HTTP ' + xhr.status);
                    _deviceReported = false;
                    setTimeout(function () {
                        triggerDeviceReport(serverBase, token, hwid);
                    }, 10000);
                }
            };

            xhr.onerror = function () {
                _debugLog('Device report NETWORK ERROR');
                _deviceReported = false;
                setTimeout(function () {
                    triggerDeviceReport(serverBase, token, hwid);
                }, 10000);
            };

            xhr.ontimeout = function () {
                _debugLog('Device report TIMEOUT');
                _deviceReported = false;
                setTimeout(function () {
                    triggerDeviceReport(serverBase, token, hwid);
                }, 10000);
            };

            xhr.send();
        };

        doReport();

        if (_reportRetryTimer) clearInterval(_reportRetryTimer);
        _reportRetryTimer = setInterval(function () {
            if (!_deviceReported && _lastToken) {
                _debugLog('Periodic retry device report...');
                _deviceReported = true;
                doReport();
            }
        }, 30000);
    }

    // ============================================================
    // *** CORE FIX: setupFetchInterceptor with TRY-CATCH ***
    // ============================================================
    var _origFetch = null;  // Lưu ở scope ngoài để fallback có thể truy cập
    var _fetchReqId = 0;    // Global request counter

    function setupFetchInterceptor() {
        _debugLog('setupFetchInterceptor: START');
        if (typeof fetch === 'undefined') {
            _debugLog('setupFetchInterceptor: fetch undefined, retry in 100ms');
            setTimeout(setupFetchInterceptor, 100);
            return;
        }

        _origFetch = window.fetch;
        _debugLog('setupFetchInterceptor: _origFetch saved, type=' + typeof _origFetch);

        window.fetch = function (input, init) {
            var _reqId = ++_fetchReqId;

            // ===== TRY-CATCH BAO TOÀN BỘ SYNCHRONOUS CODE =====
            try {
                _debugLog('FETCH #' + _reqId + ' ENTER');

                // STEP 1: Extract URL
                var url;
                try {
                    url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                    _debugLog('FETCH #' + _reqId + ' URL=' + (url ? url.substring(0, 120) : '(empty)'));
                } catch (e1) {
                    _debugLog('FETCH #' + _reqId + ' ERROR extracting URL: ' + e1.message);
                    url = '';
                }
                var originalUrl = url;

                // STEP 2: Prepare init and headers
                try {
                    if (!init) {
                        init = {};
                        _debugLog('FETCH #' + _reqId + ' init was falsy, set to {}');
                    }
                    if (!init.headers) {
                        init.headers = {};
                        _debugLog('FETCH #' + _reqId + ' init.headers was falsy, set to {}');
                    }
                    _debugLog('FETCH #' + _reqId + ' init type=' + typeof init + ' headers type=' + typeof init.headers);
                } catch (e2) {
                    _debugLog('FETCH #' + _reqId + ' ERROR preparing init/headers: ' + e2.message);
                    // CRITICAL FALLBACK: gọi _origFetch trực tiếp, không can thiệp
                    _debugLog('FETCH #' + _reqId + ' FALLBACK-A: calling _origFetch directly');
                    return _origFetch.call(this, input);
                }

                // STEP 3: Get HWID and metadata
                var hwid;
                var meta;
                try {
                    hwid = getOrCreateHWID();
                    meta = getDeviceMetadata();
                    _debugLog('FETCH #' + _reqId + ' HWID=' + hwid + ' device=' + meta.device_name + ' platform=' + meta.platform);
                } catch (e3) {
                    _debugLog('FETCH #' + _reqId + ' ERROR getting HWID/metadata: ' + e3.message);
                    hwid = 'unknown';
                    meta = { device_name: 'Unknown', platform: 'unknown' };
                }

                // STEP 4: Add headers
                if (hwid && url && url.indexOf('http') === 0) {
                    try {
                        _setFetchHeader(init.headers, 'x-hwid', hwid);
                        _setFetchHeader(init.headers, 'X-Device-Name', meta.device_name);
                        _setFetchHeader(init.headers, 'X-Device-Platform', meta.platform);
                        _debugLog('FETCH #' + _reqId + ' Headers added OK');
                    } catch (e4) {
                        _debugLog('FETCH #' + _reqId + ' ERROR adding headers: ' + e4.message);
                    }
                } else {
                    _debugLog('FETCH #' + _reqId + ' Skipping headers (hwid=' + !!hwid + ' urlHasHttp=' + (url && url.indexOf('http') === 0) + ')');
                }

                // STEP 5: Mirror retry tracking
                var retryCount = init._mirrorRetryCount || 0;
                init._mirrorRetryCount = retryCount;
                var maxRetries = PANEL_DOMAINS.length;

                // STEP 6: Call original fetch
                _debugLog('FETCH #' + _reqId + ' Calling _origFetch...');
                return _origFetch.call(this, input, init).then(function (response) {
                    // ===== RESPONSE HANDLER (TRY-CATCH) =====
                    _debugLog('FETCH #' + _reqId + ' RESPONSE status=' + response.status + ' ok=' + response.ok);

                    try {
                        // === PHÁT HIỆN LOGIN ===
                        var isLoginUrl = url && (
                            url.indexOf('/applogin') !== -1 ||
                            url.indexOf('/passport/auth/login') !== -1 ||
                            url.indexOf('/passport/auth/token2Login') !== -1
                        );

                        if (!_deviceReported && response.ok && isLoginUrl) {
                            _debugLog('FETCH #' + _reqId + ' Login URL detected — cloning response');

                            var cloned;
                            try {
                                cloned = response.clone();
                                _debugLog('FETCH #' + _reqId + ' clone OK');
                            } catch (cloneErr) {
                                _debugLog('FETCH #' + _reqId + ' clone() FAILED: ' + cloneErr.message + ' — skipping login detection');
                                cloned = null;
                            }

                            if (cloned) {
                                cloned.text().then(function (text) {
                                    _debugLog('FETCH #' + _reqId + ' body length=' + (text ? text.length : 0));
                                    try {
                                        var data = JSON.parse(text);
                                        var token = (data && data.data && data.data.token) || data.token || null;
                                        if (token && token.length > 5) {
                                            _lastToken = token;
                                            var match = url.match(/^(https?:\/\/[^\/]+)/);
                                            var serverBase = match ? match[1] : url;
                                            _debugLog('FETCH #' + _reqId + ' Token found, triggering device report...');
                                            triggerDeviceReport(serverBase, token, hwid);
                                        } else {
                                            _debugLog('FETCH #' + _reqId + ' No token in response');
                                        }
                                    } catch (parseErr) {
                                        _debugLog('FETCH #' + _reqId + ' JSON parse error: ' + parseErr.message);
                                    }
                                }).catch(function (textErr) {
                                    _debugLog('FETCH #' + _reqId + ' text() error: ' + textErr.message);
                                });
                            }
                        }
                    } catch (respHandlerErr) {
                        _debugLog('FETCH #' + _reqId + ' ERROR in response handler: ' + respHandlerErr.message);
                        // Không rethrow — vẫn return response bình thường
                    }

                    _debugLog('FETCH #' + _reqId + ' Returning response OK');
                    return response;

                }, function (error) {
                    // ===== ERROR HANDLER (TRY-CATCH) =====
                    _debugLog('FETCH #' + _reqId + ' ERROR: ' + (error.message || error.name || 'unknown'));

                    try {
                        var isNetworkError = (
                            (error.message || '').indexOf('Failed to fetch') !== -1 ||
                            (error.message || '').indexOf('Network Error') !== -1 ||
                            (error.name === 'AbortError') ||
                            (error.name === 'TimeoutError')
                        );
                        _debugLog('FETCH #' + _reqId + ' isNetworkError=' + isNetworkError + ' retryCount=' + retryCount);

                        if (isNetworkError && retryCount < maxRetries && _isPanelRequest(originalUrl)) {
                            retryCount++;
                            var nextDomainIndex = retryCount % PANEL_DOMAINS.length;
                            var mirrorDomain = PANEL_DOMAINS[nextDomainIndex];
                            var newUrl = replaceHost(originalUrl, extractHost(mirrorDomain));

                            var newInit = {};
                            for (var k in init) {
                                if (init.hasOwnProperty(k)) newInit[k] = init[k];
                            }
                            newInit._mirrorRetryCount = retryCount;
                            delete newInit.signal;

                            _debugLog('FETCH #' + _reqId + ' Mirror retry #' + retryCount + ': ' + newUrl);
                            return window.fetch(newInputFromUrl(newUrl, input), newInit);
                        }
                    } catch (errHandlerErr) {
                        _debugLog('FETCH #' + _reqId + ' ERROR in error handler: ' + errHandlerErr.message);
                    }

                    return Promise.reject(error);
                });

            } catch (syncErr) {
                // ===== FATAL SYNC ERROR — FALLBACK TO ORIGINAL FETCH =====
                _debugLog('FETCH #' + _reqId + ' FATAL SYNC ERROR: ' + syncErr.message);
                if (syncErr.stack) {
                    _debugLog('FETCH #' + _reqId + ' Stack: ' + syncErr.stack.substring(0, 300));
                }
                _debugLog('FETCH #' + _reqId + ' FALLBACK-Z: calling _origFetch directly (no interceptor)');

                // CRITICAL: Gọi _origFetch trực tiếp để app không bị treo
                try {
                    return _origFetch.call(this, input);
                } catch (fallbackErr) {
                    _debugLog('FETCH #' + _reqId + ' EVEN FALLBACK FAILED: ' + fallbackErr.message);
                    return Promise.reject(fallbackErr);
                }
            }
        }; // end window.fetch

        _debugLog('setupFetchInterceptor: DONE — fetch interceptor v9-DEBUG installed');
    }

    // ============================================================
    // MAIN INIT — Bọc trong try-catch
    // ============================================================

    function init() {
        _debugLog('=== MirrorBootstrap v9-DEBUG INIT START ===');
        _debugLog('User-Agent: ' + (navigator.userAgent || 'N/A'));
        _debugLog('Platform: ' + (navigator.platform || 'N/A'));
        _debugLog('fetch available: ' + (typeof fetch !== 'undefined'));
        _debugLog('axios available: ' + (typeof axios !== 'undefined'));
        _debugLog('XMLHttpRequest available: ' + (typeof XMLHttpRequest !== 'undefined'));

        // KHÔNG tự động set APP_API_URL — người dùng tự cấu hình
        var existingUrl;
        try {
            existingUrl = getCurrentPanelUrl();
            _debugLog('APP_API_URL from localStorage: ' + (existingUrl || '(not set)'));
        } catch (e) {
            _debugLog('ERROR reading localStorage: ' + e.message);
        }

        // Tạo/sẵn sàng HWID
        try {
            var hwid = getOrCreateHWID();
            var meta = getDeviceMetadata();
            _debugLog('Device HWID: ' + hwid);
            _debugLog('Device Name: ' + meta.device_name);
            _debugLog('Platform: ' + meta.platform);
        } catch (e) {
            _debugLog('ERROR in HWID init: ' + e.message);
        }

        // Cài fetch interceptor (QUAN TRỌNG NHẤT: app dùng fetch, không phải axios!)
        try {
            setupFetchInterceptor();
        } catch (e) {
            _debugLog('FATAL: setupFetchInterceptor threw: ' + e.message);
        }

        // Cài CSS + MutationObserver để chặn update dialog
        try {
            blockUpdateDialog();
            _debugLog('Update dialog blocker installed');
        } catch (e) {
            _debugLog('ERROR in blockUpdateDialog: ' + e.message);
        }

        // Cài axios interceptors (dự phòng)
        try {
            setupAxiosInterceptors();
        } catch (e) {
            _debugLog('ERROR in setupAxiosInterceptors: ' + e.message);
        }

        // Theo dõi login để tự động report device (dự phòng cho axios)
        try {
            watchForLoginAndReportDevice();
        } catch (e) {
            _debugLog('ERROR in watchForLoginAndReportDevice: ' + e.message);
        }

        // Tải domain config từ panel
        try {
            loadDomainBackupConfig();
        } catch (e) {
            _debugLog('ERROR in loadDomainBackupConfig: ' + e.message);
        }

        // Kiểm tra Vue mount
        setTimeout(checkVueMounted, 3000);

        _debugLog('=== MirrorBootstrap v9-DEBUG INIT COMPLETE ===');
    }

    // Bọc init() trong try-catch
    try {
        init();
    } catch (e) {
        _debugLog('FATAL: init() threw: ' + e.message);
        if (e.stack) _debugLog('Stack: ' + e.stack.substring(0, 500));
    }

})();
