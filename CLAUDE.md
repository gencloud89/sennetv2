# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules — BẮT BUỘC TUÂN THỦ

### 1. 🔒 Cấm xóa file khi chưa được phép
**KHÔNG BAO GIỜ** xóa bất kỳ file hoặc thư mục nào nếu chưa có sự cho phép rõ ràng từ người dùng. Bao gồm:
- File tạm, file cache, file build output
- File được tạo ra trong quá trình phân tích
- File trong `sennet_extracted/`, `sennet_decompiled/`, `decoded_strings_full.json`
- Chỉ được xóa khi người dùng nói rõ "cho phép xóa" hoặc "được xóa"

Nếu cần dọn dẹp, hãy hỏi trước và liệt kê danh sách file sẽ xóa kèm lý do.

### 2. ✅ Tự verify kết quả
Mọi kết quả trả về phải được **tự động kiểm tra chéo** trước khi trình bày:
- Khi trích xuất dữ liệu (strings, URLs, domains) → xác nhận bằng ít nhất **2 phương pháp** khác nhau
- Khi decompile/phân tích → kiểm tra kết quả có nhất quán giữa các công cụ không
- Khi đưa ra kết luận → dẫn kèm **bằng chứng cụ thể** (số dòng, file path, output)
- Nếu có sự khác biệt giữa các phương pháp → báo cáo ngay, không bỏ qua
- Luôn tự hỏi: *"Làm sao để biết kết quả này là đúng?"* trước khi trả lời

### 3. ⚡ Quy tắc GSD (Get Stuff Done)
- **Hành động ngay**, không chỉ giải thích — nếu có thể làm được thì làm luôn
- Khi có nhiều cách tiếp cận → chọn cách **nhanh nhất và chắc chắn nhất**, làm trước, giải thích sau
- Không sa đà vào phân tích vô hạn khi chưa thử cách đơn giản nhất
- Khi gặp blocker → đề xuất giải pháp thay thế ngay, không dừng lại báo lỗi
- Ưu tiên: **Làm → Verify → Báo cáo** (không phải: Lên kế hoạch → Giải thích → Chờ)

### 4. 🧹 Code sạch sẽ
Tất cả script, tool, và code tạo ra trong dự án phải:
- Có comment giải thích rõ ràng bằng **tiếng Việt** (ưu tiên) hoặc tiếng Anh
- Đặt tên biến/hàm **có ý nghĩa** (không `a1`, `tmp`, `x`)
- Xử lý lỗi đầy đủ: try-catch, thông báo lỗi rõ ràng
- Không để hardcode magic numbers/strings (trích ra thành constants)
- Format nhất quán (spaces/tabs đồng nhất trong cùng file)
- Xóa code chết, console.log debug, file tạm trước khi commit

### 5. 📖 Tham khảo = Read-Only
Các file/website/app dùng để tham khảo:
- `sennet.apk` — file gốc, **không được sửa đổi**
- `sennet_extracted/` — APK đã giải nén, **chỉ đọc** (trừ khi tạo file mới bên ngoài)
- `sennet_decompiled/` — mã nguồn đã decompile, **chỉ đọc**
- `jadx/`, `jdk/` — công cụ, **không sửa**
- Các website tham khảo (sknetpay.com, github.com/...) — **chỉ xem, không sửa đổi**
- Mọi output phân tích ghi ra file **mới**, không ghi đè file nguồn

## Project Overview

This is a **reverse-engineered Android APK** analysis project. The target is `sennet.apk` — a VPN client app branded **SENNET** that integrates with a **v2board** proxy management panel. The app is built on **SagerNet/sing-box** (`libbox.so`) as its VPN core and uses a **Vue.js WebView** for its UI layer.

- **Package name:** `android.v2board.app` (external) / `android.skynet.app` (internal, dùng với adb)
- **App name:** SENNET
- **Version:** `V2BOARD/2.1.6`
- **VPN core:** sing-box (Go → gomobile → `libbox.so`)
- **Panel URL đã phát hiện:** `https://backbptd2.htb991.space/` (lưu trong localStorage `APP_API_URL`, có thể thay đổi)
- **Số server VPN:** 17 node (toàn bộ Việt Nam, Shadowsocks `chacha20-ietf-poly1305`)
- **Payment:** Stripe (`hooks.stripe.com`), Alipay (`alipays://`), WeChat Pay (`weixin://wap/pay?`)
- **Payment domain:** `checkout.sknetpay.com` (không còn resolve)
- **Main domain:** `sknetpay.com` (sau Cloudflare, hiện hiển thị nội dung không liên quan)
- **Auth API:** `Authorization: {auth_data}` — **KHÔNG dùng Bearer prefix** (!)

## Repository Structure

```
.
├── sennet.apk                          # Original APK file
├── sennet_extracted/                   # APK unzipped (APK is ZIP format)
│   ├── classes.dex                     # Android bytecode (single DEX)
│   ├── AndroidManifest.xml             # Binary XML manifest
│   ├── resources.arsc                  # Compiled resources
│   ├── lib/
│   │   └── */libbox.so                 # Native sing-box VPN (arm64/x86)
│   └── assets/
│       ├── view/app.html               # WebView entry point
│       ├── view/assets/js/app.js       # Main Vue app (1.4MB, OBFUSCATED)
│       ├── view/assets/js/index.min.js # UI components (Preline/Tailwind)
│       ├── view/assets/js/encrypt.js   # CryptoJS (AES/RSA for API auth)
│       └── prefix-china-apps.txt       # Chinese apps for split-tunnel bypass
├── sennet_decompiled/                  # JADX output — 2499 Java source files
│   └── sources/
│       ├── android/v2board/app/        # Main app code
│       │   ├── Application.java
│       │   ├── ui/MainActivity.java
│       │   ├── ui/AgentWebActivity.java
│       │   ├── bg/VPNService.java
│       │   └── database/preference/
│       ├── android/skynet/app/R.java   # Resource constants (skynet = internal name)
│       ├── i/g.java                     # BridgeHandler — JS ↔ Native bridge
│       ├── i/b.java                     # WebViewClient — URL intercept/payment
│       └── io/nekohasekai/libbox/      # sing-box JNI bindings
├── decoded_strings_full.json           # 6949 strings extracted from obfuscated app.js
├── jadx/                               # JADX decompiler (v1.5.0)
├── jdk/                                # Portable OpenJDK 21 (Temurin)
└── decode_strings.js                   # Node.js script to extract JS string array
```

## Key Architecture

### Layered Architecture
1. **WebView UI Layer** (`assets/view/`) — Vue.js SPA loaded from `file:///android_asset/view/app.html`. All UI rendering, API calls, and user interaction happens here. The JS is heavily obfuscated with obfuscator.io.
2. **Native Bridge** (`i/g.java`) — `BridgeHandler` class with 10 cases mapping JS calls to Android actions: open URLs, save `config.json`, test server connections, manage Crisp chat, clipboard, theme.
3. **VPN Core** (`libbox.so`) — sing-box compiled via gomobile. Handles all proxy protocols (Shadowsocks, VMess, VLESS, Trojan, Hysteria2, TUIC, WireGuard), DNS, routing, and Clash API.
4. **Configuration Layer** — Runtime config stored in `configs/config.json` (created by JS via BridgeHandler case 6) and `settings.db` (Room database for key-value preferences).

### The v2board Panel URL
Panel URL **không hardcode** trong source code — nó được lưu runtime trong WebView localStorage với key `APP_API_URL`. Khi người dùng login, app gọi API đến panel URL này.

- **Cơ chế lưu trữ:** localStorage key `APP_API_URL` → value `https://backbptd2.htb991.space/`
- **Cách decode từ app.js:** `_0xbc0996 → _0x47a377 → _0x28c6 → array[index]` → key `"tByte"` → map trong `_0x27ae04` → `"pse1"` → giá trị URL từ localStorage
- **Thay đổi panel:** Có 3 cách: (1) UI Configure option trong app, (2) Sửa trực tiếp localStorage file, (3) ADB JavaScript injection
- **Payment/callback domains** (`checkout.sknetpay.com`, `hooks.stripe.com`) hardcode trong [i/b.java](sennet_decompiled/sources/i/b.java) để URL interception
- **App hoạt động với bất kỳ panel v2board nào** — chỉ cần thay `APP_API_URL` là đủ, không cần sửa code Java

### Obfuscation
- **JavaScript**: obfuscator.io with string splitting, control flow flattening, dead code injection. The decoder function `_0x28c6` at position 220239 in `app.js` resolves indices into a 6949-element string array returned by `_0x1e69()`.
- **String decoding formula**: `array[index - 477]` where `477 = 0x25a8 - 0x1cc0 - 0x70b`
- **DEX/Java**: Not obfuscated — class names and method names are preserved, making JADX decompilation straightforward.

## Common Analysis Commands

### Extract APK
```bash
unzip -o sennet.apk -d sennet_extracted/
```

### Decompile with JADX (requires Java)
```bash
export JAVA_HOME="$(pwd)/jdk/jdk-21.0.9+10"
export PATH="$JAVA_HOME/bin:$PATH"
./jadx/bin/jadx -d sennet_decompiled --show-bad-code --no-res sennet.apk
```

### Extract DEX string table (Python)
```python
import struct
with open('sennet_extracted/classes.dex', 'rb') as f:
    data = f.read()
string_ids_size = struct.unpack_from('<I', data, 0x38)[0]
string_ids_off = struct.unpack_from('<I', data, 0x3c)[0]
# Iterate string_ids_size entries from string_ids_off to read all MUTF-8 strings
```

### Decode obfuscated JS strings (Node.js)
```bash
node decode_strings.js    # Extracts 6949 strings from app.js _0x1e69() array
```

### Search decompiled Java
```bash
grep -r "PATTERN" sennet_decompiled/sources/
grep -r "api/v1\|passport\|subscribe" sennet_decompiled/
```

### Analyze native library
```bash
# Strings search in libbox.so
strings sennet_extracted/lib/arm64-v8a/libbox.so | grep -iE "url|api|domain|host"
```

### DNS/network verification
```bash
nslookup checkout.sknetpay.com
nslookup sknetpay.com
```

## 🔬 Key Findings (Đã phát hiện & xác minh)

### 1. V2Board Panel URL
- **Panel URL:** `https://backbptd2.htb991.space/`
- **Cách phát hiện:** Chạy app trên emulator + logcat WebView console → `console.log(apihost + "=====" + apihost)`
- **Nơi lưu trữ:** WebView localStorage với key `APP_API_URL` (không hardcode trong code)
- **Internal package name:** `android.skynet.app` (khác với external `android.v2board.app`)
- **Cơ chế:** URL được lưu runtime trong localStorage, có thể thay đổi qua UI (Configure option) hoặc trực tiếp localStorage
- **Cách thay đổi panel:**
  1. Qua UI: Mở app → Configure → nhập URL panel mới
  2. Sửa localStorage: `adb shell` → sửa file leveldb của WebView
  3. ADB JS injection: `adb shell 'echo "localStorage.setItem(\"APP_API_URL\", \"https://panel-moi.com/\");" | ...'`

### 2. Chuỗi Deobfuscation app.js
- **Decoder chain:** `_0xbc0996 → _0x47a377 → _0x28c6 → _0x1e69()[index - 477]`
- **Offset formula:** `477 = 0x25a8 - 0x1cc0 - 0x70b`
- **Tổng số string trong array:** 6,949
- **Key cho apihost:** `"tByte"` (index 4020), decode ra `"apihost"`, sau đó map trong `_0x27ae04` → `"pse1"` → URL đầy đủ
- **Regex parse function đúng:** `/function\s+(_0x[a-f0-9]+)\s*\(([^)]*)\)\s*\{return\s+(_0x[a-f0-9]+)\s*\(([^)]+)\)\s*;?\s*\}/g`
- **Script decode thành công:** `decode_apihost_v3.js` (dùng recursive evaluator + memoization)

### 3. Tất Cả Domain Tìm Thấy Trong App

#### 🔴 Nhóm 1: Domain lõi (xóa = app không hoạt động)
| Domain | Vị trí | Vai trò |
|---|---|---|
| `backbptd2.htb991.space` | WebView localStorage (`APP_API_URL`) | **Panel v2board chính** — auth, lấy config VPN, node server |
| `hooks.stripe.com` | [i/b.java:116](sennet_decompiled/sources/i/b.java#L116) | Thanh toán Stripe |

#### 🟡 Nhóm 2: Domain chức năng phụ (xóa = mất tính năng)
| Domain | Vị trí | Vai trò |
|---|---|---|
| `checkout.sknetpay.com` | [i/b.java:94](sennet_decompiled/sources/i/b.java#L94) | Trang thanh toán riêng (không còn resolve) |
| `alipays://platformapi/...` | [i/b.java:131](sennet_decompiled/sources/i/b.java#L131) | Thanh toán Alipay |
| `weixin://wap/pay?` | DEX strings | Thanh toán WeChat |
| `crisp.chat` + subdomains | DEX strings + SDK | Chat hỗ trợ khách hàng |
| `www.tawk.to` | [i/b.java:158](sennet_decompiled/sources/i/b.java#L158) | Live chat dự phòng |
| `chatra.com` | [i/b.java:158](sennet_decompiled/sources/i/b.java#L158) | Live chat dự phòng |

#### 🟢 Nhóm 3: Link xã hội (xóa không ảnh hưởng)
| Domain | Vai trò |
|---|---|
| `telegram.me` | Link Telegram support |
| `m.me` | Link Facebook Messenger |
| `twitter.com` | Link Twitter |

### 4. Xác Thực API v2board
- **Auth format:** `Authorization: {auth_data}` — **KHÔNG có** `Bearer` prefix (!)
- **Login endpoint:** `POST /api/v1/passport/auth/login`
- **Credentials đã test thành công:** `test3@9999` / `123456789a`
- **Response bao gồm:** `token`, `auth_data` — `auth_data` được dùng cho mọi request API sau đó

### 5. VPN Servers & Kết Nối
- **Số lượng server:** 17 node VPN (toàn bộ ở Việt Nam)
- **Protocol:** Shadowsocks, method `chacha20-ietf-poly1305`
- **VPN core:** sing-box (SagerNet), biên dịch qua gomobile → `libbox.so`
- **Cấu hình lưu tại:** `configs/config.json` (runtime, tạo bởi JS qua BridgeHandler case 6)
- **Split tunneling:** `prefix-china-apps.txt` — danh sách app Trung Quốc để bypass VPN

### 6. Kết Quả Security Audit
- ✅ **Không có analytics/tracking SDK** (không Google Analytics, Firebase Analytics, Facebook SDK, v.v.)
- ✅ **Chỉ kết nối đến panel API** + các service thanh toán/chat tiêu chuẩn
- ✅ **Không gửi dữ liệu người dùng ra bên ngoài** ngoài API panel
- ✅ **Không có mã độc/backdoor** được phát hiện
- ⚠️ **Hardcoded payment domains** trong `i/b.java` → nếu panel mới không dùng Stripe/Alipay, các domain này vẫn bị chặn/bắt trong WebView URL interceptor

### 7. BridgeHandler (JS ↔ Native) — 10 Cases
File: [i/g.java](sennet_decompiled/sources/i/g.java)

| Case | Chức năng |
|---|---|
| 1 | Open URL in external browser |
| 2 | Save config.json |
| 3 | Test server connection (TCP ping) |
| 4 | Open Crisp chat |
| 5 | Copy to clipboard |
| 6 | Set theme color |
| 7 | Get app version |
| 8 | Close WebView |
| 9 | Get device info |
| 10 | Logout / Clear data |

### 8. Emulator Setup (Đã cấu hình)
- **AVD name:** `test_avd`
- **System image:** `system-images;android-30;google_apis;x86_64` (API 30 = Android 11)
- **ADB path:** `android_sdk/platform-tools/adb.exe`
- **Emulator path:** `android_sdk/emulator/emulator.exe`
- **Package để launch:** `android.skynet.app` (KHÔNG phải `android.v2board.app`)
- **Lệnh hữu ích:**
  ```bash
  # Khởi động emulator
  android_sdk/emulator/emulator.exe -avd test_avd -writable-system -no-snapshot &
  # Kiểm tra kết nối
  android_sdk/platform-tools/adb.exe devices
  # Xem WebView console
  android_sdk/platform-tools/adb.exe logcat -s "chromium" | grep -i "console"
  # Pull localStorage
  android_sdk/platform-tools/adb.exe pull //data//data//android.skynet.app//app_webview//Local Storage//leveldb/ leveldb_data/
  ```

## 🔧 APK Modification Workflow (Đã làm & verified)

### Quy trình patch APK (KHÔNG dùng apktool)

Đây là quy trình chuẩn để sửa đổi APK mà không làm hỏng cấu trúc:

```
1. Giải nén APK gốc → thư mục extracted/
2. Sửa file trong extracted/ (assets, res, lib...)
3. Dùng Python zipfile patch TRỰC TIẾP từ APK gốc (giữ nguyên metadata)
4. Không unzip-toàn-bộ-rồi-zip-lại — sẽ mất META-INF services, file order
5. Zipalign + apksigner (v1+v2+v3)
```

**Code mẫu (patch APK từ Python):**
```python
import zipfile
modified = {}  # dict[filename] = new_bytes
# Chỉ thay file cần đổi, giữ nguyên mọi file khác từ APK gốc
with zipfile.ZipFile('original.apk', 'r') as orig:
    with zipfile.ZipFile('output.apk', 'w', zipfile.ZIP_DEFLATED) as new:
        for item in orig.infolist():
            if item.filename in modified:
                new.writestr(item, modified[item.filename])
            else:
                new.writestr(item, orig.read(item.filename))
        # Thêm file MỚI (không có trong APK gốc)
        for name, data in modified.items():
            if name not in seen:
                new.writestr(zipfile.ZipInfo(name), data)
```

### Các lỗi phổ biến khi sửa APK

| # | Lỗi | Nguyên nhân | Fix |
|---|---|---|---|
| 1 | **Crash: DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION** | Manifest khai báo permission sai package prefix (vd: `v2board.app` vs `skynet.app`) | Compile class fix → DEX → multi-DEX (classes.dex + classes2.dex) |
| 2 | **Mất ServiceLoader** | Unzip/re-zip làm mất `META-INF/services/*` | Dùng phương pháp PATCH (giữ nguyên file gốc) |
| 3 | **TEXT XML trong res/** | File XML text trong `res/drawable*/` / `res/mipmap*/` — Android chỉ chấp nhận BINARY XML | Không thêm XML text vào res/; chỉ thay PNG |
| 4 | **APK phình to** | Native libs `.so` set ZIP_STORED thay vì ZIP_DEFLATED | Để compression mặc định, không force STORED |
| 5 | **Logo launcher không đổi** | File `drawable-anydpi-v24/ic_launcher_foreground.xml` cũ vẫn trỏ đến icon cũ | Xóa XML adaptive icon cũ hoặc thay foreground PNG |

### Sửa lỗi DEX (Java code) không cần source

Khi phát hiện bug trong file `.dex` (không có source code):

```
1. Decompile DEX → Java (dùng jadx)
2. Tìm class/method gây lỗi
3. Viết class fix (chỉ cần method bị lỗi + tất cả field/method mà class khác tham chiếu)
4. Compile với javac -source 8 -target 8 (dùng android.jar)
5. Dùng d8 chuyển .class → .dex
6. Đặt fix DEX làm classes.dex (primary), DEX gốc → classes2.dex
7. Sign + test
```

**Quan trọng:** Class fix PHẢI có ĐẦY ĐỦ tất cả field và method public của class gốc (dùng dexdump để kiểm tra). Thiếu field → `NoSuchFieldError`. Thiếu method → `NoSuchMethodError`.

### Các file quan trọng cần bảo toàn khi rebuild APK

| File/Thư mục | Vai trò | Hậu quả nếu thiếu |
|---|---|---|
| `META-INF/services/*` | Java ServiceLoader | App crash khi gọi service |
| `META-INF/*.version` | AndroidX version metadata | Runtime errors |
| `META-INF/com/android/build/gradle/app-metadata.properties` | Build metadata | Có thể gây lỗi runtime |
| `AndroidManifest.xml` | App manifest (BINARY XML) | App không cài được |
| `resources.arsc` | Resource table (BINARY) | Không load được resource |
| `classes.dex` | Mã Java (DEX format) | App crash ngay khi mở |

### Build APK với nhiều kiến trúc CPU

```bash
# Giảm kích thước: chỉ giữ architecture cần thiết
# ARM64: 99% điện thoại Android hiện đại (Samsung, Xiaomi, Pixel...)
# X86:   Máy ảo Trung Quốc (LDPlayer, Nox, Memu...)
# X64:   Android Emulator (AVD)
# ARMv7: Điện thoại cũ (trước 2019)

# Giữ arm64 + x86 → ~42 MB
# Giữ tất cả 4 → ~61 MB (nén) / ~130 MB (không nén)
```

### Inject JavaScript vào WebView app

```bash
# 1. Thêm script vào app.html trước app.js
# 2. Script có thể:
#    - Cài axios interceptors (retry/failover)
#    - Thay đổi localStorage (APP_API_URL, theme...)
#    - DOM manipulation (thay logo, text...)
#    - Export API toàn cục (window.*)
# 3. Quan trọng: KHÔNG set User-Agent từ JS (browser chặn)
#    WebView đã tự set UA suffix (AgentWeb/5.0.8) từ Java layer
```

## Key Files for Further Analysis

| Goal | File(s) |
|---|---|
| Find v2board API endpoints | [i/g.java](sennet_decompiled/sources/i/g.java) (BridgeHandler), [app.js](sennet_extracted/assets/view/assets/js/app.js) (search `api/v1`, `passport`) |
| Payment flow | [i/b.java](sennet_decompiled/sources/i/b.java) (shouldOverrideUrlLoading) |
| VPN config structure | `config.json` (generated at runtime), `libbox.so` (Go source: `github.com/sagernet/sing-box`) |
| User profile/subscription | [sennet_decompiled/sources/android/v2board/app/ui/profile/](sennet_decompiled/sources/android/v2board/app/ui/profile/) |
| Database schema | [sennet_decompiled/sources/android/v2board/app/database/](sennet_decompiled/sources/android/v2board/app/database/) |
| Decoded JS strings | `decoded_strings_full.json` (6949 entries) |
| JS deobfuscation script | `decode_apihost_v3.js` (recursive evaluator, decode được apihost key & value) |
| Emulator localStorage dump | `leveldb_log` (chứa APP_API_URL, APP_THEME, APP_DATA_INDEX, APP_DATA_MODE) |
| Fixed permission DEX | `fix_src/r0/h.java` → compile → `fix_full_dex/classes.dex` |
| APK build scripts | Python scripts trong session: patch APK, sign, zipalign, install |
| Mirror bootstrap | [mirror-bootstrap.js](sennet_extracted/assets/view/assets/js/mirror-bootstrap.js) — domain fallback + logo replacement |
