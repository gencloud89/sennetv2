# Hướng dẫn triển khai Domain Mirror cho người dùng Trung Quốc

## 1. Vấn đề

Người dùng Trung Quốc bị Great Firewall (GFW) chặn, không truy cập được:
- Panel V2Board để đăng nhập
- Server subscription để tải cấu hình VPN
- Các URL test ping (Google, Cloudflare...)

## 2. Giải pháp tổng thể

Đặt VPS tại Hong Kong làm **Reverse Proxy Mirror**. Tất cả request từ user Trung Quốc đi qua mirror HK rồi mới đến server gốc.

```
User Trung Quốc ──→ Mirror HK (47.239.195.222) ──→ Server gốc (kio.senviet.us)
         ↑                    ↑                            ↑
    App Android         Nginx reverse proxy           V2Board Panel
```

## 3. Danh sách domain

### Panel Mirror (dùng để đăng nhập + lấy subscribe URL)

| # | Domain | Proxy đến |
|---|--------|-----------|
| 1 | `mirrorhk1.scdh2268.com` | `kio.senviet.us` |
| 2 | `mirrorhk2.scdh2268.com` | `kio.senviet.us` |
| 3 | `mirrorhk3.scdh2268.com` | `kio.senviet.us` |
| 4 | `mirrorhk4.scdh2268.com` | `kio.senviet.us` |
| 5 | `mirrorhk5.scdh2268.com` | `kio.senviet.us` |
| 6 | `mirrorhk6.scdh2268.com` | `kio.senviet.us` |

### Subscribe Mirror (dùng để tải cấu hình VPN)

| # | Domain | Proxy đến |
|---|--------|-----------|
| 1 | `submirror1.scdh2268.com` | `senviet.htb991.space` |
| 2 | `submirror2.scdh2268.com` | `senviet.htb991.space` |
| 3 | `submirror3.scdh2268.com` | `senviet.htb991.space` |
| 4 | `submirror4.scdh2268.com` | `senviet.htb991.space` |
| 5 | `submirror5.scdh2268.com` | `senviet.htb991.space` |
| 6 | `submirror6.scdh2268.com` | `senviet.htb991.space` |

### Domain gốc (dùng khi không bị chặn)

| Loại | Domain |
|------|--------|
| Panel chính | `kio.senviet.us` |
| Subscribe chính | `venom.cdy.892.htd892.com` |

## 4. Cấu trúc Nginx trên VPS Hong Kong

### File 1: Panel Mirror (`mirrorhk-panel.conf`)

```nginx
server {
    listen 443 ssl;
    server_name mirrorhk1.scdh2268.com mirrorhk2.scdh2268.com
               mirrorhk3.scdh2268.com mirrorhk4.scdh2268.com
               mirrorhk5.scdh2268.com mirrorhk6.scdh2268.com;

    ssl_certificate     /path/to/mirrorhk1.scdh2268.com/fullchain.pem;
    ssl_certificate_key /path/to/mirrorhk1.scdh2268.com/privkey.pem;

    location / {
        # Chặn trình duyệt, cho phép app
        if ($http_user_agent ~* "(Mozilla|Chrome|Safari|Firefox|Edg)") {
            return 302 https://does-not-exist.invalid$request_uri;
        }

        # Proxy đến panel gốc
        proxy_pass https://kio.senviet.us;
        proxy_ssl_server_name on;
        proxy_set_header Host kio.senviet.us;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
    }
}

server {
    listen 80;
    server_name mirrorhk1...mirrorhk6.scdh2268.com;
    return 301 https://$host$request_uri;
}
```

### File 2: Subscribe Mirror (`mirrorhk-sub.conf`)

```nginx
server {
    listen 443 ssl;
    server_name submirror1.scdh2268.com submirror2.scdh2268.com
               submirror3.scdh2268.com submirror4.scdh2268.com
               submirror5.scdh2268.com submirror6.scdh2268.com;

    location /api/v1/client/subscribe {
        # Chặn trình duyệt
        if ($http_user_agent ~* "(Mozilla|Chrome|Safari|Firefox|Edg)") {
            return 302 https://does-not-exist.invalid$request_uri;
        }

        proxy_pass https://senviet.htb991.space;
        proxy_ssl_server_name on;
        proxy_set_header Host senviet.htb991.space;
        proxy_http_version 1.1;
    }

    location / {
        return 302 https://does-not-exist.invalid$request_uri;
    }
}
```

## 5. Cách triển khai trên Android App

### 5.1. Domain list (hardcode trong app)

```kotlin
// Domain panel — thử lần lượt từng domain
val PANEL_DOMAINS = listOf(
    "https://kio.senviet.us",           // Domain gốc
    "https://mirrorhk1.scdh2268.com",   // Mirror HK 1
    "https://mirrorhk2.scdh2268.com",   // Mirror HK 2
    "https://mirrorhk3.scdh2268.com",
    "https://mirrorhk4.scdh2268.com",
    "https://mirrorhk5.scdh2268.com",
    "https://mirrorhk6.scdh2268.com"
)

// Domain subscribe — thử lần lượt từng domain
val SUBSCRIBE_DOMAINS = listOf(
    "venom.cdy.892.htd892.com",         // Domain gốc
    "submirror1.scdh2268.com",          // Mirror HK 1
    "submirror2.scdh2268.com",          // Mirror HK 2
    "submirror3.scdh2268.com",
    "submirror4.scdh2268.com",
    "submirror5.scdh2268.com",
    "submirror6.scdh2268.com"
)
```

### 5.2. Logic login với fallback

```kotlin
suspend fun loginWithFallback(email: String, password: String): LoginResult {
    var lastError: Exception? = null

    // Thử từng panel domain
    for (domain in PANEL_DOMAINS) {
        try {
            val response = httpClient.post("$domain/api/v1/passport/auth/login") {
                setBody(mapOf("email" to email, "password" to password))
                header("User-Agent", "SENNET-VPN/1.0")  // QUAN TRỌNG!
                header("Content-Type", "application/json")
                timeout(10_000)
            }
            if (response.status == 200) {
                return parseLoginResponse(response)
            }
        } catch (e: Exception) {
            lastError = e
            continue  // Thử domain tiếp theo
        }
    }

    throw lastError ?: Exception("All panel domains failed")
}
```

### 5.3. Logic tải subscribe với fallback

```kotlin
suspend fun downloadConfigWithFallback(subscribeUrl: String): String {
    var lastError: Exception? = null

    // Parse domain từ subscribe URL gốc
    val originalHost = URI(subscribeUrl).host

    // Tạo danh sách URL thay thế domain
    val urlsToTry = SUBSCRIBE_DOMAINS.map { mirrorDomain ->
        subscribeUrl.replace(originalHost, mirrorDomain)
    }

    // Thử từng URL
    for (url in urlsToTry) {
        try {
            val response = httpClient.get(url) {
                header("User-Agent", "SENNET-VPN/1.0")  // QUAN TRỌNG!
                timeout(15_000)
            }
            if (response.status == 200) {
                return response.bodyAsText()
            }
        } catch (e: Exception) {
            lastError = e
            continue
        }
    }

    throw lastError ?: Exception("All subscribe URLs failed")
}
```

### 5.4. Delay test URL với fallback cho Trung Quốc

```kotlin
// Google bị chặn ở TQ, fallback sang URL nội địa
val DELAY_TEST_URLS = listOf(
    "http://www.gstatic.com/generate_204",   // Google (nhanh, toàn cầu)
    "http://cp.cloud.360.cn/generate_204",    // 360 (CDN Trung Quốc)
    "http://connect.rom.miui.com/generate_204", // Xiaomi (Trung Quốc)
    "http://www.baidu.com"                     // Baidu (luôn hoạt động ở TQ)
)

suspend fun testLatency(nodeHost: String, nodePort: Int): Long? {
    for (testUrl in DELAY_TEST_URLS) {
        try {
            val start = System.currentTimeMillis()
            // Gửi request test đến node qua proxy
            val response = httpClient.get(testUrl) {
                timeout(5_000)
                proxy(nodeHost, nodePort)
            }
            if (response.status in listOf(200, 204)) {
                return System.currentTimeMillis() - start
            }
        } catch (e: Exception) {
            continue  // URL này bị chặn, thử URL khác
        }
    }
    return null  // Tất cả URL đều fail
}
```

### 5.5. Auto-select server tốt nhất

```kotlin
suspend fun autoSelectBestNode(nodes: List<VpnNode>): VpnNode? {
    val results = mutableMapOf<VpnNode, Long>()

    // Test tất cả node song song
    coroutineScope {
        nodes.forEach { node ->
            launch {
                val latency = testLatency(node.host, node.port)
                if (latency != null) {
                    results[node] = latency
                }
            }
        }
    }

    // Chọn node có latency thấp nhất
    return results.minByOrNull { it.value }?.key
}
```

### 5.6. Offline mode — dùng cache khi không có mạng

```kotlin
fun checkAuthWithOfflineMode(): Boolean {
    val cachedToken = getSavedToken()
    if (cachedToken == null) return false

    return try {
        // Thử gọi API kiểm tra token
        httpClient.get("$currentPanelDomain/api/v1/user/getSubscribe") {
            header("Authorization", cachedToken)
            timeout(5_000)
        }
        true  // Token còn hạn
    } catch (e: Exception) {
        // Không kết nối được panel → trust cached token
        if (e is ConnectException || e is SocketTimeoutException) {
            true  // OFFLINE MODE — dùng token đã lưu
        } else {
            false // Lỗi khác (403 = token hết hạn)
        }
    }
}
```

## 6. User-Agent quan trọng

Tất cả request đến mirror HK **PHẢI** dùng User-Agent đặc biệt:

```
SENNET-VPN/1.0
```

Nếu dùng User-Agent của browser (`Mozilla/5.0...`), mirror sẽ chặn và redirect đến `does-not-exist.invalid`.

## 7. Cấu hình DNS cho Trung Quốc

```kotlin
// DNS servers hoạt động ở Trung Quốc
val CHINA_DNS_SERVERS = listOf(
    "223.5.5.5",        // AliDNS
    "119.29.29.29",     // DNSPod
    "223.6.6.6",        // AliDNS backup
    "https://doh.pub/dns-query",      // DoH Trung Quốc
    "https://dns.alidns.com/dns-query" // DoH Alibaba
)
// KHÔNG dùng: 8.8.8.8 (Google DNS — bị chặn ở TQ)
```

## 8. Cập nhật domain không cần build lại app

Upload file `domain-backup-config.json` lên panel V2Board:

```json
{
  "panel_domains": [
    "https://kio.senviet.us",
    "https://mirrorhk1.scdh2268.com",
    "https://mirrorhk2.scdh2268.com",
    "https://mirrorhk3.scdh2268.com",
    "https://mirrorhk4.scdh2268.com",
    "https://mirrorhk5.scdh2268.com",
    "https://mirrorhk6.scdh2268.com"
  ],
  "subscribe_domains": [
    "venom.cdy.892.htd892.com",
    "submirror1.scdh2268.com",
    "submirror2.scdh2268.com",
    "submirror3.scdh2268.com",
    "submirror4.scdh2268.com",
    "submirror5.scdh2268.com",
    "submirror6.scdh2268.com"
  ],
  "oss_domains": []
}
```

App tải file này khi khởi động → cập nhật danh sách domain → không cần build lại app.

## 9. Tổng kết flow cho user Trung Quốc

```
1. App mở → Tải domain-backup-config.json từ panel (nếu kết nối được)
2. Login:
   a. Thử kio.senviet.us → TIMEOUT (bị GFW chặn)
   b. Thử mirrorhk1.scdh2268.com → OK! → Login thành công
3. Lấy subscribe URL:
   a. Gọi mirrorhk1.scdh2268.com/api/v1/user/getSubscribe → OK
4. Tải config:
   a. Thử venom.cdy.892.htd892.com → TIMEOUT
   b. Thử submirror1.scdh2268.com → OK! → Tải config thành công
5. Ping test server:
   a. Thử gstatic.com → TIMEOUT
   b. Thử baidu.com → OK! → Chọn server nhanh nhất
6. Kết nối VPN → Thành công!
```
