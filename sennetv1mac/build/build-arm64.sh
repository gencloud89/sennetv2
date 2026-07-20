#!/bin/bash
# ============================================================
# build-arm64.sh — Build SENNET cho Apple Silicon (M1/M2/M3/M4/M5)
# ============================================================
# Chạy trên máy Mac Apple Silicon
# Yêu cầu: Node.js 18+, npm, sing-box binary (libcore-darwin-arm64)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="SENNET"
VERSION="4.2.1"
ARCH="arm64"
ELECTRON_ARCH="darwin-arm64"

echo "=== BUILD SENNET v${VERSION} for macOS Apple Silicon (${ARCH}) ==="

# ---- Bước 1: Tải Electron cho Mac ARM64 (nếu chưa có) ----
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
APP_BUNDLE="${PROJECT_DIR}/output/${APP_NAME}.app"
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources/extra/static/icons"
mkdir -p "${APP_BUNDLE}/Contents/Frameworks"

# ---- Bước 3: Copy Electron binary ----
echo "[3/8] Copying Electron binaries..."
if [ -f "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
    cp "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
    cp -r "node_modules/electron/dist/Electron.app/Contents/Frameworks/"* "${APP_BUNDLE}/Contents/Frameworks/"
else
    echo "  WARNING: Electron binary not found at node_modules/electron/dist/"
    echo "  Download Electron ${ELECTRON_VERSION}-${ELECTRON_ARCH} from https://github.com/electron/electron/releases"
    echo "  Extract to node_modules/electron/dist/"
    exit 1
fi

# ---- Bước 4: Đóng gói app.asar ----
echo "[4/8] Packing app.asar..."
cd "${PROJECT_DIR}/extracted/app_source"
npx asar pack . "${APP_BUNDLE}/Contents/Resources/app.asar"
echo "  app.asar created: $(wc -c < "${APP_BUNDLE}/Contents/Resources/app.asar") bytes"

# ---- Bước 5: Copy native binaries (sing-box libcore) ----
echo "[5/8] Copying native binaries..."
if [ -f "${PROJECT_DIR}/bin/libcore-darwin-arm64" ]; then
    cp "${PROJECT_DIR}/bin/libcore-darwin-arm64" "${APP_BUNDLE}/Contents/Resources/extra/libcore"
    cp "${PROJECT_DIR}/bin/libcore-darwin-arm64" "${APP_BUNDLE}/Contents/Resources/extra/libcore_backup"
    chmod +x "${APP_BUNDLE}/Contents/Resources/extra/libcore"
    chmod +x "${APP_BUNDLE}/Contents/Resources/extra/libcore_backup"
    echo "  libcore (sing-box) copied for ${ARCH}"
else
    echo "  WARNING: libcore-darwin-arm64 not found in bin/"
    echo "  Build sing-box for macOS ARM64 and place at bin/libcore-darwin-arm64"
    echo "  Build command (on Mac):"
    echo "    cd sing-box && CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -o libcore-darwin-arm64 ./cmd/sing-box"
fi

# ---- Bước 6: Copy icons ----
echo "[6/8] Copying icons..."
# Tray icons
if [ -f "${PROJECT_DIR}/packaging/iconTemplate.png" ]; then
    cp "${PROJECT_DIR}/packaging/iconTemplate.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate.png"
else
    # Fallback: copy từ app_source assets
    if [ -f "${PROJECT_DIR}/extracted/app_source/assets/images/icon.png" ]; then
        cp "${PROJECT_DIR}/extracted/app_source/assets/images/icon.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate.png"
    fi
fi
if [ -f "${PROJECT_DIR}/packaging/iconTemplate@2x.png" ]; then
    cp "${PROJECT_DIR}/packaging/iconTemplate@2x.png" "${APP_BUNDLE}/Contents/Resources/extra/static/icons/enabledTemplate@2x.png"
fi
# App icon (.icns)
if [ -f "${PROJECT_DIR}/packaging/electron.icns" ]; then
    cp "${PROJECT_DIR}/packaging/electron.icns" "${APP_BUNDLE}/Contents/Resources/"
fi

# ---- Bước 7: Copy Info.plist ----
echo "[7/8] Copying Info.plist..."
cp "${PROJECT_DIR}/packaging/Info.plist" "${APP_BUNDLE}/Contents/"
# Cập nhật version trong plist
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" "${APP_BUNDLE}/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${VERSION}" "${APP_BUNDLE}/Contents/Info.plist" 2>/dev/null || true

# ---- Bước 8: Code sign + Tạo DMG ----
echo "[8/8] Code signing and DMG creation..."
# Code sign (nếu có certificate)
if [ -n "${APPLE_DEVELOPER_ID}" ]; then
    echo "  Signing with ${APPLE_DEVELOPER_ID}..."
    codesign --force --deep --options runtime \
        --sign "${APPLE_DEVELOPER_ID}" \
        --entitlements "${PROJECT_DIR}/packaging/entitlements.plist" \
        "${APP_BUNDLE}"
else
    echo "  No APPLE_DEVELOPER_ID set — skipping code sign"
    # Ad-hoc signing để app chạy được
    codesign --force --deep --sign - "${APP_BUNDLE}" 2>/dev/null || true
fi

# Tạo DMG
DMG_NAME="SENNET_v${VERSION}_mac_arm64"
echo "  Creating ${DMG_NAME}.dmg..."
hdiutil create -volname "${APP_NAME}" \
    -srcfolder "${APP_BUNDLE}" \
    -ov -format ULFO \
    "${PROJECT_DIR}/output/${DMG_NAME}.dmg"

echo ""
echo "=== BUILD COMPLETE ==="
echo "Output: ${PROJECT_DIR}/output/${DMG_NAME}.dmg"
echo "App size: $(du -sh "${APP_BUNDLE}" | cut -f1)"
echo "DMG size: $(du -sh "${PROJECT_DIR}/output/${DMG_NAME}.dmg" | cut -f1)"
echo ""
echo "To test: open ${PROJECT_DIR}/output/${DMG_NAME}.dmg"
echo "To install: drag ${APP_NAME}.app to /Applications/"
