# CLAUDE.md — sennetv1mac (macOS .app Build Project)

This file provides guidance to Claude Code when working with the macOS application in this directory.

## ⚠️ ISOLATION — Thư mục độc lập

Thư mục `sennetv1mac/` hoàn toàn độc lập với:
- Dự án Android (`../sennet.apk`)
- Dự án Windows (`../sennetv1win/`)

Mọi thao tác chỉ diễn ra trong thư mục này, không ảnh hưởng đến app Windows/Android.

## Rules — BẮT BUỘC TUÂN THỦ

### 1. 🔒 Cấm xóa file khi chưa được phép
### 2. ✅ Tự verify kết quả — xác nhận bằng ít nhất 2 phương pháp
### 3. ⚡ GSD — Hành động ngay → Verify → Báo cáo
### 4. 🧹 Code sạch sẽ — Comment rõ ràng, tên biến có ý nghĩa
### 5. 📖 Read-Only — File gốc không sửa đổi

## Directory Structure

```
sennetv1mac/
├── CLAUDE.md                  # This file
├── original/                  # 📥 Đặt file Mac gốc vào đây (nếu có)
├── extracted/
│   └── app_source/            # Mã nguồn Electron (port từ Windows)
├── build/                     # 🔧 Script build cho Mac
│   ├── build-arm64.sh         # Build cho Apple Silicon (M1-M5)
│   ├── build-x64.sh           # Build cho Intel Mac
│   └── build-universal.sh     # Build Universal Binary
├── packaging/                 # 📦 Cấu hình đóng gói
│   ├── Info.plist             # App metadata
│   ├── electron.icns          # App icon (cần tạo từ PNG)
│   └── entitlements.plist     # Code signing entitlements
├── output/                    # 🏗️ Build output (.app bundles, .dmg)
└── tools/                     # 🔧 Công cụ (7za từ Windows)
```

## Port từ Windows (sennetv1win) sang Mac

### Những gì đã port (cross-platform)
Toàn bộ WebView UI code — các file JS/HTML/CSS này giống hệt Windows:
- `app.html` — WebView entry point
- `assets/js/app.js` — Main Vue app (đã sửa version 4.2.1)
- `assets/js/mirror-bootstrap.js` — **QUAN TRỌNG**: HWID + Mirror + Fetch interceptor
- `assets/js/preload-blocker.js` — Update dialog blocker
- `assets/js/dom_kq4d21.min.js` — Bridge file
- `assets/js/vue.js`, `axios.min.js`, `encrypt.js`, `index.min.js`, etc.
- `assets/css/*` — Stylesheets
- `package.json` — Đã sửa version 4.2.1

### Những gì cần thay đổi cho Mac
1. **Native binaries**: `libcore.exe` → `libcore` (sing-box macOS binary)
2. **sysproxy**: macOS dùng `networksetup` thay cho `sysproxy.exe`
3. **Đường dẫn**: `%APPDATA%/Gudao/` → `~/Library/Application Support/Gudao/`
4. **Tray icon**: `.png` → `.png` + Template icons (macOS menu bar)
5. **Packaging**: `.exe` (NSIS) → `.app` bundle + `.dmg`
6. **Code signing**: Cần Apple Developer certificate cho distribution

## Kiến trúc ứng dụng

### App Architecture (Electron + sing-box)
- **Type:** Electron + sing-box VPN core
- **Framework:** Electron (Chromium + Node.js), `nodeIntegration: true`
- **VPN Core:** sing-box → `libcore` (Mac binary, cần build riêng)
- **System Proxy:** macOS `networksetup` (không cần sysproxy.exe)
- **App Name (internal):** `Gudao` / `Skynet`
- **Brand:** SENNET For macOS
- **Version:** 4.2.1
- **Sing-box API:** `http://127.0.0.1:9790/`
- **App Data:** `~/Library/Application Support/Gudao/`

### Communication Flow (giống Windows)
```
App mở → host.php → Server list → Login applogin → Token → Subscribe (x-hwid) → VPN config
```

### Các tính năng đã tích hợp (từ mirror-bootstrap.js v7)
1. **HWID**: `x-hwid` header trên mọi request + auto-detect login + auto-subscribe
2. **Domain Mirror**: 7 panel mirrors + 7 subscribe mirrors với retry
3. **Version**: 4.2.1 (khớp panel)
4. **Update Dialog**: Đã chặn (CSS + MutationObserver)
5. **White Screen Fix**: Error handler + Vue mount monitor

## Build Process

### Yêu cầu
- **macOS** (để build .app bundle)
- **Node.js 18+**
- **Electron** (binary cho Mac — arm64 hoặc x64)
- **sing-box** (Mac binary — `libcore`)
- **Xcode Command Line Tools** (cho code signing)

### Build .app Bundle (trên máy Mac)

```bash
# 1. Cài đặt Electron cho Mac
npm install electron@latest

# 2. Tạo cấu trúc .app bundle
mkdir -p "SENNET.app/Contents/MacOS"
mkdir -p "SENNET.app/Contents/Resources/extra/static/icons"
mkdir -p "SENNET.app/Contents/Frameworks"

# 3. Copy Electron binary
cp node_modules/electron/dist/Electron.app/Contents/MacOS/Electron "SENNET.app/Contents/MacOS/SENNET"
cp -r node_modules/electron/dist/Electron.app/Contents/Frameworks/* "SENNET.app/Contents/Frameworks/"

# 4. Copy app source (đóng gói thành app.asar)
npx asar pack extracted/app_source/ "SENNET.app/Contents/Resources/app.asar"

# 5. Copy native binaries
cp bin/libcore "SENNET.app/Contents/Resources/extra/libcore"
cp bin/libcore "SENNET.app/Contents/Resources/extra/libcore_backup"
chmod +x "SENNET.app/Contents/Resources/extra/libcore"

# 6. Copy icons
cp packaging/electron.icns "SENNET.app/Contents/Resources/"
cp packaging/iconTemplate.png "SENNET.app/Contents/Resources/extra/static/icons/enabledTemplate.png"
cp packaging/iconTemplate@2x.png "SENNET.app/Contents/Resources/extra/static/icons/enabledTemplate@2x.png"

# 7. Copy Info.plist
cp packaging/Info.plist "SENNET.app/Contents/"

# 8. Code sign (nếu có certificate)
codesign --force --deep --sign "Developer ID Application: XXX" "SENNET.app"

# 9. Tạo DMG
hdiutil create -volname "SENNET" -srcfolder "SENNET.app" -ov -format UDZO "output/SENNET_v7_mac.dmg"
```

### Build cho M-chip (arm64) vs Intel (x64)

| | Apple Silicon (M1-M5) | Intel |
|---|---|---|
| **Kiến trúc** | `arm64` (ARM64) | `x64` (x86_64) |
| **Electron** | `darwin-arm64` | `darwin-x64` |
| **libcore** | `libcore-darwin-arm64` | `libcore-darwin-amd64` |
| **Output** | `SENNET_v7_mac_arm64.dmg` | `SENNET_v7_mac_x64.dmg` |
| **Universal** | Gộp cả 2 → `SENNET_v7_mac_universal.dmg` | |

### Build Script

```bash
# Build cho Apple Silicon
./build/build-arm64.sh

# Build cho Intel
./build/build-x64.sh

# Build Universal (arm64 + x64)
./build/build-universal.sh
```

## Mac-specific Code Changes

### main.js adaptations (so với Windows)
```javascript
// Đường dẫn native binary
const libcorePath = path.join(appConfigDir, 'libcore')  // Không .exe
// sysproxy: macOS dùng networksetup
// isMac && (proxyCmd = 'networksetup -setwebproxy ...')

// App data path
// macOS: ~/Library/Application Support/Gudao/
// Windows: %APPDATA%/Gudao/
// Electron app.getPath('appData') tự động chọn đúng

// Tray icon
// macOS: dùng Template image (chỉ có alpha channel)
// Windows: dùng PNG màu
```

### env.js
```javascript
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isLinux = process.platform === 'linux'
```

## File quan trọng

| File | Vai trò |
|---|---|
| `extracted/app_source/assets/js/mirror-bootstrap.js` | **QUAN TRỌNG NHẤT** — HWID + Mirror + Fetch interceptor |
| `extracted/app_source/assets/js/preload-blocker.js` | Update dialog blocker |
| `extracted/app_source/assets/js/app.js` | Main Vue app (version 4.2.1) |
| `extracted/app_source/package.json` | Package info (version 4.2.1) |
| `extracted/app_source/src/main/main.js` | Electron main process |
| `extracted/app_source/src/main/env.js` | Platform detection |
| `packaging/Info.plist` | macOS app metadata |
| `packaging/entitlements.plist` | Code signing permissions |
