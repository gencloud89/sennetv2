#!/bin/bash
# ============================================================
# build-local-v19.sh — Build SENNET v4.2.1 cho Mac M4 (ARM64)
# ============================================================
# CHẠY TRỰC TIẾP TRÊN MAC M4 CỦA BẠN
# Cách dùng:
#   1. Copy repo này lên Mac M4 (hoặc git clone)
#   2. cd sennetv1mac && bash build/build-local-v19.sh
#   3. DMG sẽ ở output/SENNET_v4.2.1_mac_arm64.dmg
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="SENNET"
VERSION="4.2.1"
ELECTRON_VERSION="28.2.0"
SINGBOX_VERSION="1.11.0"

echo "=============================================="
echo " BUILD SENNET v${VERSION} — macOS ARM64 (M4)"
echo " VPN Logic: v19 (log monitor mode)"
echo "=============================================="

# ---- Check môi trường ----
if [ "$(uname)" != "Darwin" ]; then
    echo "ERROR: Script này chỉ chạy trên macOS!"
    exit 1
fi

ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
    echo "WARNING: Máy này là $ARCH, không phải ARM64. DMG build ra sẽ không chạy được!"
    echo "Nhấn Ctrl+C để hủy hoặc Enter để tiếp tục..."
    read
fi

# ---- Tạo thư mục output ----
mkdir -p "${PROJECT_DIR}/output"
mkdir -p /tmp/sennet_build

# ---- Bước 1: Tải Electron cho macOS ARM64 ----
echo ""
echo "[1/8] Downloading Electron v${ELECTRON_VERSION} for darwin-arm64..."
ELECTRON_URL="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-darwin-arm64.zip"
ELECTRON_ZIP="/tmp/sennet_build/electron-arm64.zip"
ELECTRON_DIR="/tmp/sennet_build/electron-arm64"

if [ ! -f "$ELECTRON_ZIP" ]; then
    echo "  Downloading from: ${ELECTRON_URL}"
    curl -L --connect-timeout 30 --max-time 300 -o "$ELECTRON_ZIP" "${ELECTRON_URL}"
else
    echo "  Using cached Electron zip"
fi

if [ ! -d "$ELECTRON_DIR" ]; then
    echo "  Extracting..."
    unzip -q "$ELECTRON_ZIP" -d "$ELECTRON_DIR"
fi
echo "  Electron ready"

# ---- Bước 2: Tải sing-box cho macOS ARM64 ----
echo ""
echo "[2/8] Downloading sing-box v${SINGBOX_VERSION} for darwin-arm64..."
SINGBOX_URL="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-darwin-arm64.tar.gz"
SINGBOX_TAR="/tmp/sennet_build/sing-box-arm64.tar.gz"
SINGBOX_DIR="/tmp/sennet_build/sing-box-arm64"

if [ ! -f "$SINGBOX_TAR" ]; then
    echo "  Downloading from: ${SINGBOX_URL}"
    curl -L --connect-timeout 30 --max-time 120 -o "$SINGBOX_TAR" "${SINGBOX_URL}"
else
    echo "  Using cached sing-box tarball"
fi

if [ ! -d "$SINGBOX_DIR" ]; then
    echo "  Extracting..."
    mkdir -p "$SINGBOX_DIR"
    tar -xzf "$SINGBOX_TAR" -C "$SINGBOX_DIR"
fi
echo "  sing-box ready"

# ---- Bước 3: Tạo cấu trúc .app bundle ----
echo ""
echo "[3/8] Creating .app bundle structure..."
APP_BUNDLE="${PROJECT_DIR}/output/${APP_NAME}.app"
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources/extra/static/icons"
mkdir -p "${APP_BUNDLE}/Contents/Frameworks"

# ---- Bước 4: Copy Electron binary + Frameworks ----
echo ""
echo "[4/8] Copying Electron binaries..."
cp "${ELECTRON_DIR}/Electron.app/Contents/MacOS/Electron" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
chmod +x "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
cp -r "${ELECTRON_DIR}/Electron.app/Contents/Frameworks/"* "${APP_BUNDLE}/Contents/Frameworks/"
echo "  Electron binary copied: $(wc -c < "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}") bytes"

# ---- Bước 5: Copy sing-box libcore ----
echo ""
echo "[5/8] Copying sing-box libcore..."
SINGBOX_BIN=$(find "$SINGBOX_DIR" -name "sing-box" -type f | head -1)
if [ -z "$SINGBOX_BIN" ]; then
    echo "  ERROR: sing-box binary not found in extracted archive!"
    echo "  Contents of ${SINGBOX_DIR}:"
    ls -la "$SINGBOX_DIR"
    exit 1
fi
cp "$SINGBOX_BIN" "${APP_BUNDLE}/Contents/Resources/extra/libcore"
chmod +x "${APP_BUNDLE}/Contents/Resources/extra/libcore"
echo "  libcore copied: $(wc -c < "${APP_BUNDLE}/Contents/Resources/extra/libcore") bytes"
echo "  libcore arch: $(lipo -info "${APP_BUNDLE}/Contents/Resources/extra/libcore" 2>/dev/null || file "${APP_BUNDLE}/Contents/Resources/extra/libcore")"

# ---- Bước 6: Pack app.asar ----
echo ""
echo "[6/8] Packing app.asar..."
# Cần cài asar nếu chưa có
if ! command -v npx &> /dev/null; then
    echo "  ERROR: npx not found. Please install Node.js: brew install node"
    exit 1
fi

cd "${PROJECT_DIR}/extracted/app_source"

# Cài dependencies nếu chưa có
if [ ! -d "node_modules" ]; then
    echo "  Installing npm dependencies..."
    npm install --production 2>&1 | tail -3
fi

npx asar pack . "${APP_BUNDLE}/Contents/Resources/app.asar" 2>/dev/null || {
    echo "  npx asar not found, installing..."
    npm install -g @electron/asar 2>&1 | tail -2
    npx asar pack . "${APP_BUNDLE}/Contents/Resources/app.asar"
}
echo "  app.asar created: $(wc -c < "${APP_BUNDLE}/Contents/Resources/app.asar") bytes"

# ---- Bước 7: Copy resources (icons, plist) ----
echo ""
echo "[7/8] Copying resources..."

# Copy Info.plist
if [ -f "${PROJECT_DIR}/packaging/Info.plist" ]; then
    cp "${PROJECT_DIR}/packaging/Info.plist" "${APP_BUNDLE}/Contents/"
    echo "  Info.plist copied"
fi

# Copy tray icons
if [ -f "${PROJECT_DIR}/packaging/iconTemplate.png" ]; then
    cp "${PROJECT_DIR}/packaging/iconTemplate.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate.png"
fi
if [ -f "${PROJECT_DIR}/packaging/iconTemplate@2x.png" ]; then
    cp "${PROJECT_DIR}/packaging/iconTemplate@2x.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate@2x.png"
fi
echo "  Tray icons copied"

# Copy App icon (.icns) — check both locations
ICNS_COPIED=0
if [ -f "${PROJECT_DIR}/packaging/electron.icns" ]; then
    cp "${PROJECT_DIR}/packaging/electron.icns" "${APP_BUNDLE}/Contents/Resources/electron.icns"
    ICNS_COPIED=1
elif [ -f "${PROJECT_DIR}/../docs/logo/icon.icns" ]; then
    cp "${PROJECT_DIR}/../docs/logo/icon.icns" "${APP_BUNDLE}/Contents/Resources/electron.icns"
    ICNS_COPIED=1
fi
if [ $ICNS_COPIED -eq 1 ]; then
    echo "  App icon (.icns) copied"
else
    echo "  WARNING: No .icns icon found — app will show default icon"
fi

# ---- Strip Electron (giảm dung lượng) ----
echo ""
echo "  Stripping unnecessary files..."
FW="${APP_BUNDLE}/Contents/Frameworks"

S0=$(du -sk "${APP_BUNDLE}" | cut -f1)

# SwiftShader — software GPU renderer (Apple Silicon có GPU hardware)
find "${FW}" \( -name "SwiftShader" -type d -o -name "*swiftshader*" -o -name "libvk_swiftshader*" \) -exec rm -rf {} + 2>/dev/null || true
rm -f "${APP_BUNDLE}/Contents/Resources/vk_swiftshader"* 2>/dev/null || true
S1=$(du -sk "${APP_BUNDLE}" | cut -f1); echo "  -SwiftShader: $(((S0-S1)/1024))MB saved"

# Locales — chỉ giữ English
find "${APP_BUNDLE}/Contents" \( -name "*.lproj" -type d \) | while read lproj; do
    lang=$(basename "$lproj" .lproj)
    case "$lang" in en|English) ;; *) rm -rf "$lproj" 2>/dev/null ;; esac
done
S2=$(du -sk "${APP_BUNDLE}" | cut -f1); echo "  -Locales: $(((S1-S2)/1024))MB saved"

# Debug symbols, dSYM, LICENSES, version files
find "${FW}" \( -name "*.dSYM" -o -name "Debug" -type d -o -name "LICENSE*" -o -name "*.version" \) -exec rm -rf {} + 2>/dev/null || true
find "${FW}" -name "Info.plist" -not -path "*\.framework/*" -delete 2>/dev/null || true
S3=$(du -sk "${APP_BUNDLE}" | cut -f1); echo "  -Debug/Licenses: $(((S2-S3)/1024))MB saved"

# Dọn thư mục trống
find "${APP_BUNDLE}/Contents" -type d -empty -delete 2>/dev/null || true
echo "  FINAL: $((S3/1024))MB (saved $(((S0-S3)/1024))MB)"

# ---- Bước 8: Ad-hoc sign + Create DMG ----
echo ""
echo "[8/8] Code signing + DMG creation..."

# Ad-hoc signing (cho phép app chạy trên local Mac)
codesign --force --deep --sign - "${APP_BUNDLE}" 2>/dev/null || {
    echo "  WARNING: Ad-hoc signing failed — app may need Gatekeeper bypass"
}

# Tạo DMG
DMG_NAME="SENNET_v${VERSION}_mac_arm64"
TMPDIR="/tmp/sennet_dmg_$$"
rm -rf "${TMPDIR}"
mkdir -p "${TMPDIR}"
cp -R "${APP_BUNDLE}" "${TMPDIR}/"
ln -s /Applications "${TMPDIR}/Applications"

echo "  Creating DMG..."
hdiutil create -volname "${APP_NAME}" \
    -srcfolder "${TMPDIR}" \
    -ov -format ULFO \
    "${PROJECT_DIR}/output/${DMG_NAME}.dmg"

rm -rf "${TMPDIR}"

# ---- Done ----
echo ""
echo "=============================================="
echo " BUILD COMPLETE — v${VERSION} (v19 VPN logic)"
echo "=============================================="
echo " DMG: ${PROJECT_DIR}/output/${DMG_NAME}.dmg"
echo " Size: $(du -sh "${PROJECT_DIR}/output/${DMG_NAME}.dmg" | cut -f1)"
echo ""
echo " Cách cài đặt:"
echo "   1. Mở file DMG"
echo "   2. Kéo SENNET.app vào /Applications"
echo "   3. Mở app — nhập password 1 lần duy nhất"
echo "   4. Login và bật VPN"
echo ""
echo " Nếu bị Gatekeeper chặn:"
echo "   sudo spctl --master-disable  (tắt Gatekeeper)"
echo "   Hoặc: xattr -cr /Applications/SENNET.app"
echo ""
echo " Log file VPN:"
echo "   ~/Library/Application Support/Gudao/vpn_debug.log"
echo "   ~/Library/Application Support/Gudao/vpn_core.log"
echo "=============================================="
