# CLAUDE.md — sennetv1win (Windows .exe Analysis Project)

This file provides guidance to Claude Code when working with the Windows application in this directory.

## ⚠️ ISOLATION — Thư mục độc lập

Thư mục `sennetv1win/` hoàn toàn độc lập với dự án Android (`../sennet.apk`) và Mac (`../sennetv1mac/`). Mọi thao tác phân tích, giải nén, sửa đổi chỉ diễn ra trong thư mục này.

## Rules — BẮT BUỘC TUÂN THỦ

### 1. 🔒 Cấm xóa file khi chưa được phép
- Không xóa bất kỳ file/thư mục nào nếu chưa có sự cho phép rõ ràng
- File trong `extracted/`, `decompiled/` — chỉ đọc

### 2. ✅ Tự verify kết quả
- Xác nhận bằng ít nhất 2 phương pháp khác nhau
- Dẫn kèm bằng chứng cụ thể (offset, file path, output)

### 3. ⚡ GSD (Get Stuff Done)
- Hành động ngay → Verify → Báo cáo

### 4. 🧹 Code sạch sẽ
- Comment rõ ràng bằng tiếng Việt hoặc tiếng Anh
- Đặt tên biến/hàm có ý nghĩa

### 5. 📖 Read-Only
- File gốc (`.exe`, `.msi` gốc) — không sửa đổi
- Output phân tích ghi ra file mới

## Directory Structure

```
sennetv1win/
├── CLAUDE.md                  # This file
├── original/                  # 📥 File .exe gốc (sennetwin.exe)
├── extracted/                 # 📦 Giải nén từ installer
│   ├── installer_full/        # Toàn bộ nội dung NSIS installer
│   └── app_source/            # Mã nguồn Electron (giải nén từ app.asar)
├── analysis/                  # 📊 Báo cáo phân tích, panel code, strings
├── output/                    # 🏗️ Build output
└── tools/                     # 🔧 7za.exe
```

## Key Architecture

### App Architecture (Electron + NSIS)
- **Type:** Electron + NSIS Installer
- **Framework:** Electron (Chromium + Node.js), `nodeIntegration: true`
- **VPN Core:** sing-box → `resources/extra/libcore.exe` (29 MB)
- **System Proxy:** `resources/extra/sysproxy.exe`
- **App Name (internal):** `Gudao` / `Skynet` v2.1.7 → đã sửa thành v4.2.1
- **Brand:** SENNET For Windows
- **Sing-box API:** `http://127.0.0.1:9790/`
- **App Data:** `%APPDATA%/Gudao/`

### Communication Flow (ĐÃ XÁC MINH - v7)
```
App mở → host.php → Lấy server list ["backbptd2.htb991.space", "backaptd1.htb991.space"]
       → Login: POST {server}/api/v1/app/applogin (KHÔNG phải /passport/auth/login!)
       → Token trả về ở TOP-LEVEL {token: "..."} (KHÔNG phải {data: {token: "..."}})
       → App KHÔNG tự gọi subscribe → mirror-bootstrap.js phải làm việc này
```

### HTTP Libraries
- **fetch()**: App dùng cho TẤT CẢ API calls đến panel (29 lần trong app.js)
- **axios**: CHỈ dùng cho localhost sing-box API (`http://127.0.0.1:9790/configs/`)
- **XMLHttpRequest**: KHÔNG dùng trực tiếp

### Panel Servers
| Server | Vai trò |
|--------|---------|
| `appsenviet.htb991.space/host.php` | Config endpoint — trả về danh sách server API |
| `backbptd2.htb991.space` | API server chính (login, subscribe, etc.) |
| `backaptd1.htb991.space` | API server dự phòng |
| `kio.senviet.us` | V2Board admin panel (quản lý user, device) |

### Database (từ VPS 103.166.185.213)
- **Host:** `localhost`, **User:** `sql_kio_senviet_us`, **Pass:** `85673c8983b35`
- **Database:** `sql_kio_senviet_us`
- **Device table:** `v2_user_device` — unique key `(user_id, hwid)`

## Phiên bản & Build History

| Ver | Thay đổi | Kết quả |
|-----|----------|---------|
| v1 | Extract + phân tích ban đầu | White screen fix |
| v2 | HWID fix sai (inject vào login body) | ❌ Panel không nhận |
| v3 | HWID fix đúng (x-hwid header + axios interceptor) | ✅ Device 1097, 1098 |
| v4 | Update dialog fix + version 4.2.1 | ⚠️ Chưa triệt để |
| v5 | Version consistency fix | ❌ Sót app.js |
| v6 | **Phát hiện app dùng fetch()** + fetch interceptor | ✅ Nhưng login detection sai pattern |
| v7 | **Fix triệt để: fetch interceptor + auto-detect token + mirror retry** | ✅ Device 1102 |
| v8 | **NSIS installer chuẩn + tối ưu kích thước** | ❌ Crash: missing electron-updater |
| **v9** | **Fix crash electron-updater → stub + rebuild NSIS** | ✅ Stable |

## Size Optimization (v8 → v9)

| Thành phần | Trước | Sau | Đã xóa |
|------------|-------|-----|--------|
| app.asar | 81 MB | **28 MB** | font-spider cache (45MB), rxjs (7MB), underscore (1.6MB), electron-updater (0.8MB) |
| Installer EXE | 97 MB | **76 MB** | NSIS LZMA compression |
| Portable ZIP | 127 MB | **98 MB** | deflate compression |

### Đã xóa khỏi node_modules (không dùng runtime):
- `.font-spider/` — cache font gốc (45MB)
- `rxjs` — chỉ dùng cho dev (7MB)
- `underscore` — không dùng trong main process (1.6MB)
- `electron-updater` — đã disable, thay bằng stub (0.8MB)
- `electron-notarize` — chỉ cho Mac code signing (0.2MB)

## Files Modified (v9 — current)

### `src/main/main.js` — QUAN TRỌNG: electron-updater stub
```javascript
// KHÔNG require('electron-updater') nữa — module đã bị xóa
// Thay bằng stub object:
const autoUpdater = {
  autoDownload: false,
  checkForUpdates: function () { console.log('[Update] Disabled'); return Promise.resolve(null); },
  checkForUpdatesAndNotify: function () { return Promise.resolve(null); },
  downloadUpdate: function () { return Promise.resolve(null); },
  quitAndInstall: function () {},
  on: function () { return this; },
  once: function () { return this; },
  removeListener: function () { return this; }
};
```
> **Cảnh báo**: Nếu thêm module mới vào node_modules, phải đảm bảo module đó tồn tại.
> Nếu xóa module khỏi node_modules, phải kiểm tra `require()` trong `src/main/main.js`.

### `assets/js/mirror-bootstrap.js` — File quan trọng nhất
Chứa TOÀN BỘ logic custom. Các chức năng:

1. **HWID Generator** (`generateHWID`, `getOrCreateHWID`)
   - Format: `WIN-{HOSTNAME}-{8-char-hash}`
   - Dùng `os` module (hostname, MAC, CPU)
   - Cache trong localStorage `APP_DEVICE_HWID`

2. **Fetch Interceptor** (`setupFetchInterceptor`) — QUAN TRỌNG NHẤT
   - Override `window.fetch` để thêm `x-hwid`, `X-Device-Name`, `X-Device-Platform` vào MỌI request
   - **Auto-detect token**: Quét response body tìm `token` (không hardcode URL pattern)
   - **Auto-subscribe**: Sau khi detect token → tự động gọi `/api/v1/client/subscribe` với `x-hwid` header
   - **Mirror retry**: Network error → thử mirror domain tiếp theo (PANEL_DOMAINS)
   - Dùng XMLHttpRequest cho subscribe call (tránh recursive fetch)
   - Periodic retry mỗi 30s nếu chưa thành công

3. **Axios Interceptors** (`setupAxiosInterceptors`) — Dự phòng
   - Thêm `x-hwid` header vào axios requests
   - Mirror retry cho axios errors
   - Version response interceptor (force 4.2.1)

4. **Login Detection** (`watchForLoginAndReportDevice`) — Dự phòng cho axios

5. **Domain Backup Config** (`loadDomainBackupConfig`)
   - Tải `domain-backup-config.json` từ panel để cập nhật mirror list

6. **Update Dialog Blocker** (`blockUpdateDialog`)
   - CSS + MutationObserver để ẩn dialog update

7. **White Screen Fix**
   - Global error handler + Vue mount monitor

### `assets/js/preload-blocker.js`
- CSS + MutationObserver chặn update dialog
- **KHÔNG override XMLHttpRequest** (để tránh xung đột với axios/fetch)
- Safe mode: chỉ dùng DOM manipulation

### `assets/js/app.js`
- Sửa version string `2.1.7` → `4.2.1` (trong string array của obfuscated code, vị trí 144539)

### `package.json`
- Version `4.2.1`

## Build Workflow (v9)

### Extract
```bash
# Giải nén NSIS installer
tools/7za/7za.exe x original/sennetwin.exe -oextracted/installer_full/

# Giải nén ASAR
npx asar extract extracted/installer_full/resources/app.asar extracted/app_source/
```

### Modify & Repack
```bash
# 1. Sửa file trong extracted/app_source/

# 2. Repack ASAR
npx asar pack extracted/app_source/ extracted/installer_full/resources/app.asar

# 3. Build portable ZIP
tools/7za/7za.exe a -tzip -mx5 output/SENNET_vN_portable.zip "extracted/installer_full/*"

# 4. Build NSIS installer (dùng makensis từ tools/nsis/)
cd output
../tools/nsis/nsis-3.10/makensis.exe sennet_installer.nsi
# Output: SENNET_vN_installer.exe (NSIS Modern UI, có wizard + uninstall)
```

### NSIS Installer Script
File: `output/sennet_installer.nsi`
- Dùng Modern UI (MUI2) — welcome page, chọn thư mục, progress, finish
- Cài vào `$PROGRAMFILES\SENNET`
- Tạo Start Menu + Desktop shortcuts
- Registry để hiện trong Add/Remove Programs
- Uninstaller đầy đủ (xóa file + shortcuts + registry)

### Verify ASAR Content
```bash
# Extract toàn bộ ASAR để verify
npx asar extract extracted/installer_full/resources/app.asar /tmp/verify/
# Kiểm tra các file đã sửa:
# - assets/js/mirror-bootstrap.js (36497 bytes)
# - assets/js/app.js (153494 bytes, version 4.2.1)
# - src/main/main.js (có electron-updater stub)
```

## Test HWID Flow

```bash
# Test login (qua backbptd2 — server app thực sự dùng)
curl -X POST https://backbptd2.htb991.space/api/v1/app/applogin \
  -H "User-Agent: windows.v2board.app 2.0" \
  -H "Content-Type: application/json" \
  -d '{"email":"test3@9999","password":"123456789a"}'

# Test subscribe với x-hwid
curl "https://backbptd2.htb991.space/api/v1/client/subscribe?token={TOKEN}" \
  -H "User-Agent: windows.v2board.app 2.0" \
  -H "x-hwid: WIN-TEST-XXXXXXXX"

# Kiểm tra database
ssh root@103.166.185.213
mysql -u sql_kio_senviet_us -p85673c8983b35 sql_kio_senviet_us \
  -e "SELECT id, hwid, device_name, platform, status, FROM_UNIXTIME(last_seen_at) FROM v2_user_device WHERE user_id=1787 ORDER BY id DESC LIMIT 5"
```

## Key Files Reference

| Goal | File |
|---|---|
| HWID + Mirror + Fetch interceptor | `extracted/app_source/assets/js/mirror-bootstrap.js` |
| Update dialog blocker (safe) | `extracted/app_source/assets/js/preload-blocker.js` |
| App version string | `extracted/app_source/assets/js/app.js` |
| Package version | `extracted/app_source/package.json` |
| Auto-update disable | `extracted/app_source/src/main/main.js` |
| WebView entry point | `extracted/app_source/app.html` |
| Tray icon | `extracted/installer_full/resources/extra/static/icons/enabledTemplate.png` |
| Tray icon @2x | `extracted/installer_full/resources/extra/static/icons/enabledTemplate@2x.png` |
| Panel code (local copy) | `analysis/panel_code_v6/*.php` |

## Diff from Android Version

| | Android | Windows |
|---|---|---|
| Panel URL | `backbptd2.htb991.space` | `appsenviet.htb991.space/host.php` |
| API servers | Gọi trực tiếp | Lấy từ `host.php` → `backbptd2.htb991.space` |
| Login endpoint | `/api/v1/passport/auth/login` | `/api/v1/app/applogin` |
| Sing-box port | 10090 | 9790 |
| HTTP library | fetch() | fetch() (29 lần) + axios (localhost) |
| Backend | Java BridgeHandler | Node.js IPC + child_process |
| HWID source | Java `Settings.Secure.ANDROID_ID` | Node.js `os` module → hash |
| app.js size | 1.4 MB | 157 KB |
| Bridge file | `dom.js` (2.9 MB) | `dom_kq4d21.min.js` (3 MB) |
| Admin rights | No | sudo-prompt (TUN needs admin) |
| Auto-update | None | electron-updater (đã disable) |
