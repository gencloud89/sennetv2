/**
 * mirror-bootstrap.js — Domain Mirror + HWID Fix cho SENNET VPN macOS
 * ==================================================================
 * Chức năng:
 *   1. Domain panel & subscribe mirror (china-mirror-guide.md)
 *   2. Axios interceptors: retry với mirror domain khi request thất bại
 *   3. HWID Generator: tự động tạo hardware ID và gửi qua x-hwid header
 *      → Panel v2board nhận HWID qua subscribe (ClientController@subscribe)
 *      → Header: x-hwid → device được ghi vào v2_user_device table
 *   4. Tải domain-backup-config.json từ panel
 *   5. White screen fix: error handler + Vue mount monitor
 *
 * CƠ CHẾ HWID (đã phân tích từ code panel trên VPS):
 *   - AuthController::login KHÔNG nhận HWID (chỉ email + password)
 *   - ClientController::subscribe đọc header "x-hwid" để ghi device
 *   - UserDeviceService::reportDevice ghi device vào v2_user_device
 *   - Device info gồm: hwid, device_name, platform, user_agent, ip
 * ==================================================================
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================

    var PANEL_DOMAINS = [
        'https://kio.senviet.us',
        'https://mirrorhk1.scdh2268.com',
        'https://mirrorhk2.scdh2268.com',
        'https://mirrorhk3.scdh2268.com',
        'https://mirrorhk4.scdh2268.com',
        'https://mirrorhk5.scdh2268.com',
        'https://mirrorhk6.scdh2268.com'
    ];

    var SUBSCRIBE_HOSTS = [
        'venom.cdy.892.htd892.com',
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
    // HWID format: WIN-{hostname}-{hash} (max 128 chars)
    // ============================================================

    function generateHWID() {
        var parts = [];

        try {
            // Sử dụng Node.js os module (có sẵn trong Electron)
            var os = require('os');
            var hostname = os.hostname();
            var platform = os.platform();
            var arch = os.arch();
            parts.push(hostname);
            parts.push(platform);
            parts.push(arch);

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

        // Format: MAC-XXXXXXXX (ngắn gọn, dễ đọc trong panel)
        // Panel normalizeHwid cắt 128 chars nên ta giữ format ngắn
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

        console.log('[MirrorBootstrap] Generated HWID:', hwid);
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
                platform: os.platform() + ' ' + os.arch(),  // darwin arm64
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
    // CƠ CHẾ GỬI HWID ĐÚNG (theo code panel trên VPS):
    //   1. Thêm header "x-hwid" vào MỌI request axios
    //   2. Panel ClientController::subscribe đọc header này
    //   3. Device được ghi vào v2_user_device với:
    //      - hwid = "sub-{sha256(user_id|header_hwid)[:40]}"
    //      - node_type = "subscription"
    //      - status = "subscription_seen"
    //
    // LƯU Ý: AuthController::login KHÔNG nhận HWID trong body,
    //        nên việc inject hwid vào login data là vô ích.
    //        Cách đúng là gửi qua HTTP header.

    function setupAxiosInterceptors() {
        if (typeof axios === 'undefined') {
            setTimeout(setupAxiosInterceptors, 100);
            return;
        }

        // REQUEST Interceptor: Thêm x-hwid header + lưu URL gốc cho retry
        axios.interceptors.request.use(
            function (config) {
                // Lưu URL gốc để retry với mirror domain
                config._originalUrl = config.url;
                config._retryCount = config._retryCount || 0;
                config._maxRetries = PANEL_DOMAINS.length;

                // Đảm bảo headers object tồn tại
                if (!config.headers) {
                    config.headers = {};
                }

                // Thêm x-hwid header vào MỌI request đến panel
                // Panel đọc header này trong ClientController::subscribe
                var hwid = getOrCreateHWID();
                if (hwid && !config.headers['x-hwid']) {
                    config.headers['x-hwid'] = hwid;
                }

                // Thêm X-Device-Name để panel hiển thị tên thiết bị rõ ràng
                var meta = getDeviceMetadata();
                if (meta.device_name && !config.headers['X-Device-Name']) {
                    config.headers['X-Device-Name'] = meta.device_name;
                }
                if (meta.platform && !config.headers['X-Device-Platform']) {
                    config.headers['X-Device-Platform'] = meta.platform;
                }

                // Log cho request đến panel API
                if (config.url && (
                    config.url.indexOf('/api/v1/') !== -1 ||
                    config.url.indexOf('/client/subscribe') !== -1 ||
                    config.url.indexOf('/passport/auth/login') !== -1
                )) {
                    console.log('[MirrorBootstrap] Request:', config.method || 'GET', config.url,
                        '| HWID header:', config.headers['x-hwid'] ? 'YES' : 'NO');
                }

                return config;
            },
            function (error) { return Promise.reject(error); }
        );

        // RESPONSE Interceptor: Chặn update dialog + Retry với mirror domain
        axios.interceptors.response.use(
            function (response) {
                // Log subscribe response để xác nhận HWID đã được ghi nhận
                if (response.config && response.config.url &&
                    response.config.url.indexOf('/client/subscribe') !== -1) {
                    console.log('[MirrorBootstrap] Subscribe OK — device should be recorded in panel');
                }

                // ===== CHẶN UPDATE DIALOG =====
                // Khi app gọi /app/getVersion, panel trả về windows_version="4.2.1"
                // App so sánh với version nội bộ (4.2.1) → hiện dialog "New version found"
                // Fix: Ghi đè response để version luôn khớp → không hiện update dialog
                if (response.config && response.config.url &&
                    response.config.url.indexOf('/app/getVersion') !== -1 &&
                    response.data && response.data.data) {
                    console.log('[MirrorBootstrap] Intercepted getVersion — forcing same version to disable update dialog');
                    // Gán tất cả version về "4.2.1" để app không thấy có update
                    response.data.data.windows_version = '4.2.1';
                    response.data.data.macos_version = '4.2.1';
                    response.data.data.android_version = '2.1.6';
                    response.data.data.windows_download_url = '';
                    response.data.data.macos_download_url = '';
                    response.data.data.android_download_url = '';
                }
                // ===== END CHẶN UPDATE DIALOG =====

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
                console.log('[MirrorBootstrap] Retry with mirror:', config.url);
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
        console.error('[MirrorBootstrap] Global error:', e.message, e.filename, e.lineno);
    });

    var vueCheckAttempts = 0;
    function checkVueMounted() {
        vueCheckAttempts++;
        var app = document.getElementById('app');
        var container = document.querySelector('.Container, .newsignPage, .newHome');
        if ((app && app.innerHTML && app.innerHTML.length > 50) || container) {
            console.log('[MirrorBootstrap] Vue app mounted OK');
            return;
        }
        if (vueCheckAttempts < 30) {
            setTimeout(checkVueMounted, 1000);
        } else {
            console.warn('[MirrorBootstrap] Vue may not have mounted after 30s');
        }
    }

    // ============================================================
    // LAST-RESORT UPDATE DIALOG BLOCKER
    // ============================================================
    // Nếu update dialog vẫn hiện sau tất cả các biện pháp trên,
    // dùng CSS + MutationObserver để ẩn nó khỏi DOM

    function blockUpdateDialog() {
        // CSS để ẩn update dialog — dùng !important để ghi đè mọi style
        var css = '\
            /* Ẩn dialog/modal chứa text "new version" hoặc "update" */ \
            .el-message-box__wrapper, \
            .el-dialog__wrapper, \
            .update-dialog, \
            .version-dialog, \
            [class*="update"], \
            [class*="newVersion"], \
            .modal-update, \
            .dialog-update { \
                display: none !important; \
                visibility: hidden !important; \
                pointer-events: none !important; \
                z-index: -9999 !important; \
                opacity: 0 !important; \
            } \
            /* Ẩn overlay/mask của dialog */ \
            .v-modal, \
            .el-overlay, \
            .modal-mask, \
            .dialog-mask { \
                display: none !important; \
            } \
        ';
        var style = document.createElement('style');
        style.id = 'mirror-block-update';
        style.textContent = css;
        document.head.appendChild(style);

        // MutationObserver — quét và ẩn dialog update xuất hiện sau này
        var observer = new MutationObserver(function (mutations) {
            // Tìm element chứa text "new version" hoặc "update"
            var allElements = document.querySelectorAll('*');
            for (var i = 0; i < allElements.length; i++) {
                var el = allElements[i];
                var text = (el.textContent || '').toLowerCase();
                var className = (el.className || '').toString().toLowerCase();

                // Phát hiện dialog update qua text hoặc class
                if ((text.indexOf('new version') !== -1 ||
                     text.indexOf('new version found') !== -1 ||
                     text.indexOf('cập nhật') !== -1 ||
                     text.indexOf('phiên bản mới') !== -1 ||
                     text.indexOf('đã có bản cập nhật') !== -1) &&
                    (className.indexOf('dialog') !== -1 ||
                     className.indexOf('modal') !== -1 ||
                     className.indexOf('message') !== -1 ||
                     className.indexOf('popup') !== -1 ||
                     className.indexOf('notification') !== -1 ||
                     el.tagName === 'DIALOG')) {

                    console.log('[MirrorBootstrap] Hiding update dialog:', el.className || el.tagName);
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    el.remove();
                }
            }
        });

        // Bắt đầu observe khi DOM sẵn sàng
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
            });
        }

        console.log('[MirrorBootstrap] Update dialog blocker installed (CSS + MutationObserver)');
    }

    // ============================================================
    // INIT
    // ============================================================

    // === TỰ ĐỘNG GỬI DEVICE REPORT SAU KHI LOGIN ===
    // Theo dõi login thành công → gọi subscribe với x-hwid header
    // để panel ghi nhận device vào v2_user_device table
    function watchForLoginAndReportDevice() {
        if (typeof axios === 'undefined') {
            setTimeout(watchForLoginAndReportDevice, 200);
            return;
        }

        // Intercept login response để phát hiện login thành công
        axios.interceptors.response.use(
            function (response) {
                // Phát hiện login thành công (cả auth/login và token2Login)
                if (response.config && response.config.url &&
                    (response.config.url.indexOf('/passport/auth/login') !== -1 ||
                     response.config.url.indexOf('/passport/auth/token2Login') !== -1) &&
                    response.data && response.data.data && response.data.data.auth_data) {

                    console.log('[MirrorBootstrap] Login detected — will report device to panel');

                    // Đợi 2 giây cho app khởi tạo xong, sau đó gọi subscribe
                    setTimeout(function () {
                        var authData = response.data.data.auth_data;
                        var panelUrl = getCurrentPanelUrl();
                        if (!panelUrl) {
                            // Thử lấy từ URL của request login
                            var loginUrl = response.config.url;
                            var match = loginUrl.match(/^(https?:\/\/[^\/]+)/);
                            if (match) panelUrl = match[1];
                        }
                        if (!panelUrl) {
                            console.log('[MirrorBootstrap] No panel URL — skipping device report');
                            return;
                        }

                        var subscribeUrl = panelUrl.replace(/\/+$/, '') + '/api/v1/client/subscribe';
                        var hwid = getOrCreateHWID();

                        console.log('[MirrorBootstrap] Reporting device to panel...');
                        console.log('[MirrorBootstrap]   HWID:', hwid);
                        console.log('[MirrorBootstrap]   URL:', subscribeUrl);

                        // Gọi subscribe với x-hwid header để ghi device
                        // Thêm token từ auth_data response nếu có
                        var params = '';
                        if (response.data.data.token) {
                            params = '?token=' + encodeURIComponent(response.data.data.token);
                        }

                        axios.get(subscribeUrl + params, {
                            headers: {
                                'x-hwid': hwid,
                                'User-Agent': navigator.userAgent || 'macos.v2board.app 2.0'
                            },
                            timeout: 15000
                        }).then(function (res) {
                            console.log('[MirrorBootstrap] Device reported successfully to panel!');
                            console.log('[MirrorBootstrap] Check v2_user_device table for new device');
                        }).catch(function (err) {
                            console.error('[MirrorBootstrap] Device report failed:', err.message);
                            // Retry sau 5 giây
                            setTimeout(function () {
                                console.log('[MirrorBootstrap] Retrying device report...');
                                axios.get(subscribeUrl + params, {
                                    headers: { 'x-hwid': hwid },
                                    timeout: 15000
                                }).then(function () {
                                    console.log('[MirrorBootstrap] Device report retry OK');
                                }).catch(function () {
                                    console.error('[MirrorBootstrap] Device report retry also failed');
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
    // FETCH INTERCEPTOR — App dùng fetch() cho API calls (KHÔNG phải axios!)
    // ============================================================
    // KEY FINDING: app.js sử dụng fetch() 29 lần, axios chỉ dùng cho localhost:9790.
    // App login qua /api/v1/app/applogin (KHÔNG phải /passport/auth/login).
    // App KHÔNG tự gọi subscribe → phải tự động gọi sau khi detect login.

    var _deviceReported = false;   // Tránh gọi subscribe nhiều lần
    var _reportRetryTimer = null;  // Timer cho periodic retry
    var _lastToken = null;         // Lưu token để retry

    // Hàm helper để thêm header vào fetch init
    function _setFetchHeader(headers, key, value) {
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
    }

    // Hàm helper: kiểm tra URL có thuộc panel domain không
    function _isPanelRequest(url) {
        if (!url || url.indexOf('http') !== 0) return false;
        // Lấy tất cả panel hosts để kiểm tra
        var allHosts = [];
        for (var i = 0; i < PANEL_DOMAINS.length; i++) {
            allHosts.push(extractHost(PANEL_DOMAINS[i]));
        }
        var requestHost = extractHost(url);
        for (var j = 0; j < allHosts.length; j++) {
            if (requestHost === allHosts[j]) return true;
        }
        // Cũng kiểm tra nếu là subscribe host
        for (var k = 0; k < SUBSCRIBE_HOSTS.length; k++) {
            if (requestHost === SUBSCRIBE_HOSTS[k]) return true;
        }
        return false;
    }

    function setupFetchInterceptor() {
        if (typeof fetch === 'undefined') {
            setTimeout(setupFetchInterceptor, 100);
            return;
        }

        var _origFetch = window.fetch;

        window.fetch = function (input, init) {
            var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            var originalUrl = url; // Lưu URL gốc để retry với mirror

            // Đảm bảo init và headers tồn tại
            if (!init) init = {};
            if (!init.headers) init.headers = {};

            // Thêm x-hwid header vào MỌI request đến panel API
            var hwid = getOrCreateHWID();
            var meta = getDeviceMetadata();

            // Luôn thêm HWID headers nếu có URL và HWID
            if (hwid && url && url.indexOf('http') === 0) {
                _setFetchHeader(init.headers, 'x-hwid', hwid);
                _setFetchHeader(init.headers, 'X-Device-Name', meta.device_name);
                _setFetchHeader(init.headers, 'X-Device-Platform', meta.platform);
            }

            // Lưu retry count vào init (dùng thuộc tính tạm)
            var retryCount = init._mirrorRetryCount || 0;
            init._mirrorRetryCount = retryCount;
            var maxRetries = PANEL_DOMAINS.length;

            // Gọi fetch gốc
            return _origFetch.apply(this, arguments).then(function (response) {
                // Phát hiện authentication thành công — tìm token trong response
                if (!_deviceReported && response.ok && url && url.indexOf('http') === 0) {
                    var cloned = response.clone();
                    cloned.text().then(function (text) {
                        try {
                            var data = JSON.parse(text);
                            var token = (data && data.data && data.data.token) || data.token || null;
                            if (token && token.length > 5) {
                                console.log('[MirrorBootstrap] Auth token detected in response — will report device');
                                _lastToken = token;
                                var match = url.match(/^(https?:\/\/[^\/]+)/);
                                var serverBase = match ? match[1] : url;
                                triggerDeviceReport(serverBase, token, hwid);
                            }
                        } catch (e) {}
                    }).catch(function () {});
                }

                return response;
            }, function (error) {
                // === MIRROR DOMAIN RETRY ===
                // Nếu request thất bại (network error, timeout) và chưa hết retry
                // → thử lại với mirror domain tiếp theo
                var isNetworkError = !error.response &&
                    (error.code === 'ECONNABORTED' ||
                     error.code === 'ERR_NETWORK' ||
                     error.code === 'ERR_CONNECTION_REFUSED' ||
                     error.code === 'ERR_TIMED_OUT' ||
                     (error.message || '').indexOf('Network Error') !== -1 ||
                     (error.message || '').indexOf('timeout') !== -1 ||
                     (error.message || '').indexOf('Failed to fetch') !== -1);

                if (isNetworkError && retryCount < maxRetries && _isPanelRequest(originalUrl)) {
                    retryCount++;
                    var nextDomainIndex = retryCount % PANEL_DOMAINS.length;
                    var mirrorDomain = PANEL_DOMAINS[nextDomainIndex];
                    var newUrl = replaceHost(originalUrl, extractHost(mirrorDomain));

                    // Tăng timeout cho lần retry
                    var newInit = {};
                    for (var k in init) {
                        if (init.hasOwnProperty(k)) newInit[k] = init[k];
                    }
                    newInit._mirrorRetryCount = retryCount;
                    if (!newInit.timeout && !newInit.signal) {
                        newInit.timeout = (init.timeout || 10000) + 5000;
                    }

                    console.log('[MirrorBootstrap] Fetch FAILED — retry #' + retryCount +
                        ' with mirror:', newUrl);
                    return window.fetch(newInputFromUrl(newUrl, input), newInit);
                }

                return Promise.reject(error);
            });
        };

        console.log('[MirrorBootstrap] Fetch interceptor installed — HWID + Mirror retry + Auto-detect auth');
    }

    // Helper: tạo input mới từ URL đã thay đổi (giữ nguyên cấu trúc input gốc)
    function newInputFromUrl(newUrl, originalInput) {
        if (typeof originalInput === 'string') return newUrl;
        if (originalInput && originalInput.url) {
            // Là Request object → tạo lại
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
        _deviceReported = true; // Đánh dấu ngay để tránh duplicate

        var subscribeUrl = serverBase.replace(/\/+$/, '') + '/api/v1/client/subscribe';
        var params = '?token=' + encodeURIComponent(token);
        var meta = getDeviceMetadata();

        console.log('[MirrorBootstrap] === DEVICE REPORT ===');
        console.log('[MirrorBootstrap]   HWID:', hwid);
        console.log('[MirrorBootstrap]   Token:', token.substring(0, 10) + '...');
        console.log('[MirrorBootstrap]   Subscribe URL:', subscribeUrl);
        console.log('[MirrorBootstrap]   Device:', meta.device_name, '|', meta.platform);

        var reqHeaders = {
            'x-hwid': hwid,
            'X-Device-Name': meta.device_name,
            'X-Device-Platform': meta.platform,
            'User-Agent': navigator.userAgent || 'macos.v2board.app 2.0'
        };

        var doReport = function () {
            // Dùng fetch gốc (_origFetch từ closure không truy cập được ở đây)
            // → Tạo XMLHttpRequest thủ công để tránh recursive fetch interceptor
            var xhr = new XMLHttpRequest();
            xhr.open('GET', subscribeUrl + params, true);
            xhr.setRequestHeader('x-hwid', hwid);
            xhr.setRequestHeader('X-Device-Name', meta.device_name);
            xhr.setRequestHeader('X-Device-Platform', meta.platform);
            xhr.setRequestHeader('User-Agent', navigator.userAgent || 'macos.v2board.app 2.0');
            xhr.timeout = 15000;

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    console.log('[MirrorBootstrap] ✅ Device reported SUCCESSFULLY!');
                    console.log('[MirrorBootstrap] Check v2_user_device table for new device with HWID:', hwid);
                } else {
                    console.error('[MirrorBootstrap] ❌ Device report FAILED — HTTP ' + xhr.status);
                    // Retry sau 10 giây
                    _deviceReported = false;
                    setTimeout(function () {
                        console.log('[MirrorBootstrap] Retrying device report...');
                        triggerDeviceReport(serverBase, token, hwid);
                    }, 10000);
                }
            };

            xhr.onerror = function () {
                console.error('[MirrorBootstrap] ❌ Device report NETWORK ERROR');
                _deviceReported = false;
                setTimeout(function () {
                    console.log('[MirrorBootstrap] Retrying device report (after error)...');
                    triggerDeviceReport(serverBase, token, hwid);
                }, 10000);
            };

            xhr.ontimeout = function () {
                console.error('[MirrorBootstrap] ❌ Device report TIMEOUT');
                _deviceReported = false;
                setTimeout(function () {
                    console.log('[MirrorBootstrap] Retrying device report (after timeout)...');
                    triggerDeviceReport(serverBase, token, hwid);
                }, 10000);
            };

            xhr.send();
        };

        doReport();

        // Periodic retry mỗi 30 giây nếu chưa thành công
        if (_reportRetryTimer) clearInterval(_reportRetryTimer);
        _reportRetryTimer = setInterval(function () {
            if (!_deviceReported && _lastToken) {
                console.log('[MirrorBootstrap] Periodic retry device report...');
                _deviceReported = true;
                doReport();
            }
        }, 30000);
    }

    function init() {
        console.log('[MirrorBootstrap] Initializing macOS client v4 (HWID via fetch + x-hwid header)...');

        // KHÔNG tự động set APP_API_URL — người dùng tự cấu hình
        var existingUrl = getCurrentPanelUrl();
        if (existingUrl) {
            console.log('[MirrorBootstrap] Using existing APP_API_URL:', existingUrl);
        } else {
            console.log('[MirrorBootstrap] No APP_API_URL set — user must configure');
        }

        // Tạo/sẵn sàng HWID
        var hwid = getOrCreateHWID();
        var meta = getDeviceMetadata();
        console.log('[MirrorBootstrap] Device HWID:', hwid);
        console.log('[MirrorBootstrap] Device Name:', meta.device_name);
        console.log('[MirrorBootstrap] Platform:', meta.platform);
        console.log('[MirrorBootstrap] HWID will be sent via x-hwid header on ALL API requests (fetch + axios)');
        console.log('[MirrorBootstrap] Panel will record device via ClientController::subscribe');

        // Cài fetch interceptor (QUAN TRỌNG: app dùng fetch, không phải axios!)
        setupFetchInterceptor();

        // Cài CSS + MutationObserver để chặn update dialog
        blockUpdateDialog();

        // Cài axios interceptors (thêm x-hwid header + domain mirror — dự phòng)
        setupAxiosInterceptors();

        // Theo dõi login để tự động report device (dự phòng cho axios)
        watchForLoginAndReportDevice();

        // Tải domain config từ panel
        loadDomainBackupConfig();

        // Kiểm tra Vue mount
        setTimeout(checkVueMounted, 3000);
    }

    init();
})();
