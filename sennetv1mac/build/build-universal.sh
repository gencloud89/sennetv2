#!/bin/bash
# ============================================================
# build-universal.sh — Build SENNET Universal Binary (arm64 + x64)
# ============================================================
# Tạo .app bundle chứa CẢ 2 kiến trúc (Apple Silicon + Intel)
# Yêu cầu: Đã build cả 2 bản arm64 và x64 riêng lẻ trước
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="SENNET"
VERSION="4.2.1"

echo "=== BUILD SENNET v${VERSION} UNIVERSAL (arm64 + x64) ==="

# Kiểm tra đã có cả 2 bản build
ARM64_APP="${PROJECT_DIR}/output/${APP_NAME}.app"
X64_APP="${PROJECT_DIR}/output/${APP_NAME}_x64.app"
UNIVERSAL_APP="${PROJECT_DIR}/output/${APP_NAME}_universal.app"

if [ ! -d "${ARM64_APP}" ]; then
    echo "Building arm64 first..."
    "${SCRIPT_DIR}/build-arm64.sh"
fi

if [ ! -d "${X64_APP}" ]; then
    echo "Building x64 first..."
    "${SCRIPT_DIR}/build-x64.sh"
fi

echo "[1/5] Creating universal app bundle..."
rm -rf "${UNIVERSAL_APP}"
cp -r "${ARM64_APP}" "${UNIVERSAL_APP}"

echo "[2/5] Creating universal Electron binary with lipo..."
lipo -create \
    "${ARM64_APP}/Contents/MacOS/${APP_NAME}" \
    "${X64_APP}/Contents/MacOS/${APP_NAME}" \
    -output "${UNIVERSAL_APP}/Contents/MacOS/${APP_NAME}"

echo "[3/5] Creating universal libcore with lipo..."
if [ -f "${ARM64_APP}/Contents/Resources/extra/libcore" ] && [ -f "${X64_APP}/Contents/Resources/extra/libcore" ]; then
    lipo -create \
        "${ARM64_APP}/Contents/Resources/extra/libcore" \
        "${X64_APP}/Contents/Resources/extra/libcore" \
        -output "${UNIVERSAL_APP}/Contents/Resources/extra/libcore"
    lipo -create \
        "${ARM64_APP}/Contents/Resources/extra/libcore" \
        "${X64_APP}/Contents/Resources/extra/libcore" \
        -output "${UNIVERSAL_APP}/Contents/Resources/extra/libcore_backup"
    echo "  Universal libcore created"
fi

echo "[4/5] Creating universal Frameworks..."
for framework in "${ARM64_APP}/Contents/Frameworks/"*.framework; do
    fw_name=$(basename "$framework")
    fw_binary="${fw_name%.framework}"
    if [ -f "${ARM64_APP}/Contents/Frameworks/${fw_name}/${fw_binary}" ] && \
       [ -f "${X64_APP}/Contents/Frameworks/${fw_name}/${fw_binary}" ]; then
        lipo -create \
            "${ARM64_APP}/Contents/Frameworks/${fw_name}/${fw_binary}" \
            "${X64_APP}/Contents/Frameworks/${fw_name}/${fw_binary}" \
            -output "${UNIVERSAL_APP}/Contents/Frameworks/${fw_name}/${fw_binary}"
        echo "  Universal ${fw_name}"
    fi
done

echo "[5/5] Code signing universal app..."
if [ -n "${APPLE_DEVELOPER_ID}" ]; then
    codesign --force --deep --options runtime \
        --sign "${APPLE_DEVELOPER_ID}" \
        --entitlements "${PROJECT_DIR}/packaging/entitlements.plist" \
        "${UNIVERSAL_APP}"
else
    codesign --force --deep --sign - "${UNIVERSAL_APP}" 2>/dev/null || true
fi

# Tạo DMG
DMG_NAME="SENNET_v${VERSION}_mac_universal"
echo "  Creating ${DMG_NAME}.dmg..."
hdiutil create -volname "${APP_NAME}" \
    -srcfolder "${UNIVERSAL_APP}" \
    -ov -format UDZO \
    "${PROJECT_DIR}/output/${DMG_NAME}.dmg"

echo ""
echo "=== UNIVERSAL BUILD COMPLETE ==="
echo "Output: ${PROJECT_DIR}/output/${DMG_NAME}.dmg"
echo "App size: $(du -sh "${UNIVERSAL_APP}" | cut -f1)"
echo "DMG size: $(du -sh "${PROJECT_DIR}/output/${DMG_NAME}.dmg" | cut -f1)"
echo ""
echo "Architecture:"
lipo -info "${UNIVERSAL_APP}/Contents/MacOS/${APP_NAME}"
