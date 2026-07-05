# Hướng dẫn triển khai HWID (Hardware ID) cho App V2Board

## 1. Vấn đề

App VPN cần gửi Hardware ID (HWID) của thiết bị về panel V2Board để:
- **Quản lý thiết bị**: Admin biết user đang dùng thiết bị nào
- **Giới hạn thiết bị**: Mỗi tài khoản chỉ được dùng N thiết bị (`device_limit`)
- **Khóa/Mở thiết bị**: Admin có thể ban/unban từng thiết bị
- **Theo dõi hoạt động**: Biết thiết bị nào đang online, IP gì, OS gì

**Vấn đề phổ biến**: Developer mới thường cố gắng gửi HWID trong body của login request — **ĐIỀU NÀY SAI!**

## 2. Cơ chế HWID của V2Board (đã phân tích từ code panel thực tế)

### 2.1. Kiến trúc

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  App Client  │────▶│  V2Board Panel   │◀────│  Backend Node   │
│  (Electron)  │     │  kio.senviet.us  │     │  (XrayR/soga)   │
└──────────────┘     └──────────────────┘     └─────────────────┘
       │                      │                        │
       │  ① x-hwid header    │                        │
       │  (subscribe API)    │                        │
       │                      │  ② device report      │
       │                      │  (UniProxy API)       │
       └──────────────────────┴────────────────────────┘
```

### 2.2. Các endpoint liên quan

| Endpoint | Method | Ai gọi | Nhận HWID ở đâu |
|----------|--------|--------|-----------------|
| `/api/v1/passport/auth/login` | POST | Client | **KHÔNG nhận HWID!** |
| `/api/v1/client/subscribe` | GET | Client | Header `x-hwid` |
| `/api/v1/server/UniProxy/device` | POST | Backend Node | Body `{hwid}` |
| `/api/v1/server/UniProxy/alive` | POST | Backend Node | Body `{devices: [{hwid}]}` |

### 2.3. Cấu trúc database `v2_user_device`

```sql
CREATE TABLE `v2_user_device` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `hwid` varchar(128) NOT NULL,           -- Hardware ID (unique per user)
  `device_name` varchar(128) DEFAULT NULL, -- Tên thiết bị (vd: DESKTOP-ABC)
  `platform` varchar(64) DEFAULT NULL,     -- OS (vd: win32 x64)
  `user_agent` varchar(255) DEFAULT NULL,  -- User-Agent
  `uuid` varchar(64) DEFAULT NULL,         -- sing-box UUID
  `ip` varchar(128) DEFAULT NULL,          -- IP thiết bị
  `real_ip` varchar(128) DEFAULT NULL,     -- IP thật (qua proxy)
  `ip_source` varchar(32) DEFAULT NULL,    -- Nguồn IP (subscribe/node)
  `node_type` varchar(32) DEFAULT NULL,    -- 'subscription' | 'shadowsocks' | 'vmess'...
  `node_id` int(11) DEFAULT NULL,          -- Node VPN ID
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `first_seen_at` int(11) DEFAULT NULL,
  `last_seen_at` int(11) DEFAULT NULL,
  `banned_at` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_hwid` (`user_id`, `hwid`)  -- Mỗi user + hwid là duy nhất
);
```

### 2.4. Code panel xử lý HWID

#### File: `app/Services/UserDeviceService.php`

```php
// Chuẩn hóa HWID — max 128 chars
public function normalizeHwid($hwid) {
    $hwid = trim((string)$hwid);
    if ($hwid === '') return null;
    return substr($hwid, 0, 128);
}

// Ghi nhận device khi có kết nối VPN
public function reportDevice(User $user, $hwid, $ip = null, 
    $nodeType = null, $nodeId = null, $uuid = null, array $metadata = []) {
    
    $hwid = $this->normalizeHwid($hwid);
    if (!$hwid) return; // Bỏ qua nếu không có HWID
    
    // Tìm device hiện có hoặc tạo mới
    $device = UserDevice::where('user_id', $user->id)
        ->where('hwid', $hwid)->first();
    
    if (!$device) {
        $device = new UserDevice();
        $device->user_id = $user->id;
        $device->hwid = $hwid;
        $device->status = UserDevice::STATUS_ACTIVE;
    }
    
    // Cập nhật metadata
    $device->device_name = $metadata['device_name'] ?? $device->device_name;
    $device->platform = $metadata['platform'] ?? $device->platform;
    $device->user_agent = $metadata['user_agent'] ?? $device->user_agent;
    $device->ip = $ip;
    $device->last_seen_at = time();
    $device->save();
}
```

#### File: `app/Http/Controllers/V1/Client/ClientController.php`

```php
// Subscribe — ghi nhận device từ header x-hwid
private function recordSubscriptionDevice(Request $request, $user) {
    $headerHwid = $request->header('x-hwid');
    if ($headerHwid) {
        // CÓ header x-hwid → tạo HWID từ user_id + hwid thô
        $hwid = 'sub-' . substr(hash('sha256', 
            $user->id . '|' . $headerHwid), 0, 40);
    } else {
        // KHÔNG có header → tạo HWID từ user_id + user-agent
        $hwid = 'sub-' . substr(hash('sha256', 
            $user->id . '|' . $request->userAgent()), 0, 40);
    }
    
    // Tự động detect device_name và platform từ User-Agent
    $device->device_name = $this->subscriptionDeviceName($request, $ua);
    $device->platform = $this->subscriptionPlatform($ua);
    $device->node_type = 'subscription';
    $device->status = UserDevice::STATUS_SUBSCRIPTION_SEEN;
    $device->save();
}
```

## 3. Cách triển khai HWID cho App Client

### 3.1. Tạo HWID từ thông tin phần cứng

HWID nên được tạo từ các thông tin cố định của thiết bị để đảm bảo tính duy nhất và ổn định (không thay đổi khi user cài lại app).

**Nguyên tắc:**
- Dùng thông tin phần cứng không thay đổi: hostname, MAC address, CPU model
- Format ngắn gọn: `{OS}-{HOSTNAME}-{HASH}` (max 128 chars)
- Cache trong localStorage để không phải tính lại mỗi lần mở app
- Hash các thông tin để tạo identifier duy nhất

```javascript
/**
 * Tạo HWID duy nhất từ thông tin phần cứng
 * Format: WIN-DESKTOP1-A1B2C3D4 (max 128 chars)
 */
function generateHWID() {
    var parts = [];
    
    // Ưu tiên: Dùng Node.js os module (Electron)
    // Fallback: Dùng navigator (Browser/WebView)
    try {
        var os = require('os');
        parts.push(os.hostname());           // Tên máy
        parts.push(os.platform());           // win32/darwin/linux
        parts.push(os.arch());               // x64/arm64
        
        // MAC address (không dùng internal/virtual)
        var nets = os.networkInterfaces();
        for (var key in nets) {
            for (var i = 0; i < nets[key].length; i++) {
                var net = nets[key][i];
                if (!net.internal && net.mac && 
                    net.mac !== '00:00:00:00:00:00') {
                    parts.push(net.mac.replace(/:/g, ''));
                    break;
                }
            }
        }
        
        // CPU model
        var cpus = os.cpus();
        if (cpus && cpus.length > 0) {
            parts.push(cpus[0].model.replace(/\s+/g, '_'));
        }
    } catch (e) {
        // Fallback cho browser/webview
        parts.push(navigator.userAgent);
        parts.push(navigator.platform);
        parts.push(navigator.hardwareConcurrency);
        parts.push(screen.width + 'x' + screen.height);
    }
    
    // Hash đơn giản
    var raw = parts.join('||');
    var hash = 0;
    for (var i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    
    var h = Math.abs(hash).toString(16).toUpperCase();
    var prefix = 'WIN';  // WIN | MAC | LIN | ANDROID
    var host = parts[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
    return prefix + '-' + host + '-' + h.substring(0, 8);
}
```

### 3.2. Gửi HWID qua HTTP Header `x-hwid`

**ĐÂY LÀ CÁCH ĐÚNG!** Gửi HWID qua HTTP header, không phải body.

```javascript
// Cài đặt axios request interceptor
axios.interceptors.request.use(function (config) {
    // Đảm bảo headers object tồn tại
    if (!config.headers) config.headers = {};
    
    // Thêm x-hwid header vào MỌI request đến panel
    var hwid = getOrCreateHWID();
    if (hwid && !config.headers['x-hwid']) {
        config.headers['x-hwid'] = hwid;
    }
    
    // Thêm device metadata để panel hiển thị trong admin UI
    var meta = getDeviceMetadata();
    if (!config.headers['X-Device-Name']) {
        config.headers['X-Device-Name'] = meta.device_name;
    }
    if (!config.headers['X-Device-Platform']) {
        config.headers['X-Device-Platform'] = meta.platform;
    }
    
    return config;
}, function (error) {
    return Promise.reject(error);
});
```

### 3.3. Tự động report device sau khi login

Panel chỉ ghi nhận device khi client gọi subscribe API. Do đó, cần **tự động gọi subscribe** ngay sau khi login thành công.

```javascript
// Theo dõi login response → tự động gọi subscribe để ghi device
axios.interceptors.response.use(function (response) {
    // Phát hiện login thành công
    if (response.config.url.indexOf('/passport/auth/login') !== -1 &&
        response.data && response.data.data && response.data.data.auth_data) {
        
        var panelUrl = getPanelUrl();
        var token = response.data.data.token;
        var hwid = getOrCreateHWID();
        
        // Gọi subscribe API với x-hwid header
        axios.get(panelUrl + '/api/v1/client/subscribe?token=' + token, {
            headers: {
                'x-hwid': hwid,
                'X-Device-Name': getDeviceMetadata().device_name,
                'X-Device-Platform': getDeviceMetadata().platform
            }
        }).then(function() {
            console.log('Device reported to panel successfully!');
        }).catch(function(err) {
            console.error('Device report failed:', err.message);
        });
    }
    return response;
}, function(error) {
    return Promise.reject(error);
});
```

### 3.4. Device metadata để panel hiển thị

Panel tự động detect `device_name` và `platform` từ User-Agent, nhưng bạn có thể gửi thêm headers để hiển thị chính xác hơn:

```javascript
function getDeviceMetadata() {
    try {
        var os = require('os');
        return {
            device_name: os.hostname(),        // DESKTOP-ABC123
            platform: os.platform() + ' ' + os.arch(),  // win32 x64
            user_agent: navigator.userAgent
        };
    } catch (e) {
        return {
            device_name: 'Unknown Device',
            platform: 'unknown',
            user_agent: navigator.userAgent || ''
        };
    }
}
```

### 3.5. Flow hoàn chỉnh

```
1. App mở → Tạo/Lấy HWID từ localStorage (hoặc generate mới)
2. User đăng nhập → POST /api/v1/passport/auth/login
   (KHÔNG gửi HWID trong body — panel không đọc)
3. Login thành công → Nhận token + auth_data
4. TỰ ĐỘNG gọi GET /api/v1/client/subscribe?token={token}
   VỚI header: x-hwid, X-Device-Name, X-Device-Platform
5. Panel ghi device vào v2_user_device table
6. Admin thấy device trong panel → có thể quản lý
```

## 4. Lỗi phổ biến ❌ → Cách đúng ✅

### ❌ LỖI 1: Gửi HWID trong body login request

```javascript
// SAI! AuthController::login chỉ đọc email + password
axios.post('/api/v1/passport/auth/login', {
    email: email,
    password: password,
    hwid: 'WIN-DESKTOP-XXX'  // ← Panel KHÔNG đọc field này!
});
```

### ✅ ĐÚNG: Gửi HWID qua HTTP header + gọi subscribe sau login

```javascript
// ĐÚNG! ClientController::subscribe đọc header x-hwid
axios.get('/api/v1/client/subscribe?token=' + token, {
    headers: {
        'x-hwid': 'WIN-DESKTOP-XXX'  // ← Panel đọc header này!
    }
});
```

### ❌ LỖI 2: Chỉ gửi HWID khi login

Panel không ghi device khi login. Phải gọi subscribe API (hoặc node VPN báo cáo) thì device mới được ghi.

### ✅ ĐÚNG: Gọi subscribe API sau login

```javascript
// Bước 1: Login
var loginResp = await axios.post('/api/v1/passport/auth/login', {
    email: email, password: password
});

// Bước 2: Gọi subscribe với x-hwid header
var token = loginResp.data.data.token;
await axios.get('/api/v1/client/subscribe?token=' + token, {
    headers: { 'x-hwid': getHWID() }
});
// → Device được ghi vào v2_user_device!
```

### ❌ LỖI 3: Dùng User-Agent của browser

Nếu mirror server cấu hình chặn browser, request sẽ bị từ chối.

### ✅ ĐÚNG: Dùng User-Agent của app

```
User-Agent: windows.v2board.app 2.0
```

## 5. Kiểm tra HWID đã hoạt động

### 5.1. Kiểm tra database panel

```sql
SELECT id, user_id, hwid, device_name, platform, node_type, status,
       FROM_UNIXTIME(last_seen_at) as last_seen
FROM v2_user_device
WHERE user_id = {USER_ID}
ORDER BY id DESC;
```

Kết quả mong đợi:
```
id    user_id  hwid                                           device_name        platform   status
1098  1787     sub-d56d83c0acc882f8cddcd35ea9d2e85daf31fd8e  DESKTOP-ABC123     win32 x64  subscription_seen
```

### 5.2. Kiểm tra log app

```
[MirrorBootstrap] Generated HWID: WIN-DESKTOP1-A1B2C3D4
[MirrorBootstrap] Login detected — will report device to panel
[MirrorBootstrap] Reporting device to panel...
[MirrorBootstrap]   HWID: WIN-DESKTOP1-A1B2C3D4
[MirrorBootstrap]   URL: https://kio.senviet.us/api/v1/client/subscribe
[MirrorBootstrap] Device reported successfully to panel!
```

### 5.3. Kiểm tra Network tab (DevTools)

1. Mở DevTools → Network tab
2. Tìm request đến `/api/v1/client/subscribe`
3. Kiểm tra **Request Headers** → phải có `x-hwid: WIN-...`

## 6. Tổng kết

| Việc | Cách làm |
|------|----------|
| Tạo HWID | Hash từ hostname + MAC + CPU → `WIN-DESKTOP1-A1B2C3D4` |
| Cache HWID | localStorage key `APP_DEVICE_HWID` |
| Gửi HWID | **Header `x-hwid`** (KHÔNG phải body!) |
| Thời điểm gửi | Sau login → gọi subscribe API với `x-hwid` header |
| Device metadata | Headers `X-Device-Name`, `X-Device-Platform` |
| Kiểm tra | Query `v2_user_device` table hoặc xem admin panel |

## 7. File tham khảo

- Code panel: `app/Http/Controllers/V1/Client/ClientController.php` → `recordSubscriptionDevice()`
- Code panel: `app/Services/UserDeviceService.php` → `reportDevice()`
- Code panel: `app/Models/UserDevice.php` → Model & constants
- Code panel: `app/Http/Controllers/V1/Server/UniProxyController.php` → `device()`, `alive()`
- Database: `database/hwid_user_device.sql`
- App Windows: `mirror-bootstrap.js` → implementation thực tế
