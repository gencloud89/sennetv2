#!/bin/bash
# ============================================================
# build-x64.sh — Build SENNET cho Mac Intel (x86_64)
# ============================================================
# Chạy trên máy Mac Intel hoặc cross-compile từ Apple Silicon
# Yêu cầu: Node.js 18+, npm, sing-box binary (libcore-darwin-amd64)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="SENNET"
VERSION="4.2.1"
ARCH="x64"
ELECTRON_ARCH="darwin-x64"

echo "=== BUILD SENNET v${VERSION} for macOS Intel (${ARCH}) ==="

# ---- Bước 1: Tải Electron cho Mac Intel ----
echo "[1/8] Preparing Electron for ${ARCH}..."
ELECTRON_VERSION=$(node -e "try{console.log(require('electron/package.json').version)}catch(e){console.log('latest')}")
if [ "$ELECTRON_VERSION" = "latest" ]; then
    echo "  Installing electron..."
    npm install electron@latest --save-dev
    ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
fi
echo "  Electron version: ${ELECTRON_VERSION}"

# ---- Bước 2: Tạo cấu trúc .app bundle ----
echo "[2/8] Creating .app bundle structure..."
APP_BUNDLE="${PROJECT_DIR}/output/${APP_NAME}_x64.app"
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources/extra/static/icons"
mkdir -p "${APP_BUNDLE}/Contents/Frameworks"

# ---- Bước 3: Copy Electron binary ----
echo "[3/8] Copying Electron binaries..."
# Với x64, cần Electron bản Intel
ELECTRON_DIST="node_modules/electron/dist"
if [ -f "${ELECTRON_DIST}/Electron.app/Contents/MacOS/Electron" ]; then
    DIST_ARCH=$(file "${ELECTRON_DIST}/Electron.app/Contents/MacOS/Electron" | grep -o 'arm64\|x86_64')
    if [ "$DIST_ARCH" = "x86_64" ] || [ "$DIST_ARCH" = "arm64" ]; then
        cp "${ELECTRON_DIST}/Electron.app/Contents/MacOS/Electron" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
        cp -r "${ELECTRON_DIST}/Electron.app/Contents/Frameworks/"* "${APP_BUNDLE}/Contents/Frameworks/"
        echo "  Using Electron ${DIST_ARCH} binary"
    else
        echo "  Unknown Electron architecture: ${DIST_ARCH}"
        exit 1
    fi
else
    echo "  WARNING: Electron binary not found"
    echo "  Download Electron ${ELECTRON_VERSION}-${ELECTRON_ARCH} from https://github.com/electron/electron/releases"
    exit 1
fi

# ---- Bước 4: Đóng gói app.asar ----
echo "[4/8] Packing app.asar..."
cd "${PROJECT_DIR}/extracted/app_source"
npx asar pack . "${APP_BUNDLE}/Contents/Resources/app.asar"
echo "  app.asar created: $(wc -c < "${APP_BUNDLE}/Contents/Resources/app.asar") bytes"

# ---- Bước 5: Copy native binaries ----
echo "[5/8] Copying native binaries..."
if [ -f "${PROJECT_DIR}/bin/libcore-darwin-amd64" ]; then
    cp "${PROJECT_DIR}/bin/libcore-darwin-amd64" "${APP_BUNDLE}/Contents/Resources/extra/libcore"
    cp "${PROJECT_DIR}/bin/libcore-darwin-amd64" "${APP_BUNDLE}/Contents/Resources/extra/libcore_backup"
    chmod +x "${APP_BUNDLE}/Contents/Resources/extra/libcore"
    chmod +x "${APP_BUNDLE}/Contents/Resources/extra/libcore_backup"
    echo "  libcore (sing-box) copied for ${ARCH}"
else
    echo "  WARNING: libcore-darwin-amd64 not found in bin/"
    echo "  Build sing-box for macOS AMD64 and place at bin/libcore-darwin-amd64"
fi

# ---- Bước 6: Copy icons ----
echo "[6/8] Copying icons..."
if [ -f "${PROJECT_DIR}/packaging/iconTemplate.png" ]; then
    cp "${PROJECT_DIR}/packaging/iconTemplate.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate.png"
fi
if [ -f "${PROJECT_DIR}/packaging/iconTemplate@2x.png" ]; then
    cp "${PROJECT_DIR}/packaging/iconTemplate@2x.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate@2x.png"
fi
if [ -f "${PROJECT_DIR}/packaging/electron.icns" ]; then
    cp "${PROJECT_DIR}/packaging/electron.icns" "${APP_BUNDLE}/Contents/Resources/"
fi

# ---- Bước 7: Copy Info.plist ----
echo "[7/8] Copying Info.plist..."
cp "${PROJECT_DIR}/packaging/Info.plist" "${APP_BUNDLE}/Contents/"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" "${APP_BUNDLE}/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${VERSION}" "${APP_BUNDLE}/Contents/Info.plist" 2>/dev/null || true

# ---- Bước 8: Code sign + DMG ----
echo "[8/8] Code signing and DMG creation..."
if [ -n "${APPLE_DEVELOPER_ID}" ]; then
    codesign --force --deep --options runtime \
        --sign "${APPLE_DEVELOPER_ID}" \
        --entitlements "${PROJECT_DIR}/packaging/entitlements.plist" \
        "${APP_BUNDLE}"
else
    codesign --force --deep --sign - "${APP_BUNDLE}" 2>/dev/null || true
fi

DMG_NAME="SENNET_v${VERSION}_mac_x64"
hdiutil create -volname "${APP_NAME}" \
    -srcfolder "${APP_BUNDLE}" \
    -ov -format ULFO \
    "${PROJECT_DIR}/output/${DMG_NAME}.dmg"

echo ""
echo "=== BUILD COMPLETE ==="
echo "Output: ${PROJECT_DIR}/output/${DMG_NAME}.dmg"
echo "App size: $(du -sh "${APP_BUNDLE}" | cut -f1)"
echo "DMG size: $(du -sh "${PROJECT_DIR}/output/${DMG_NAME}.dmg" | cut -f1)"
