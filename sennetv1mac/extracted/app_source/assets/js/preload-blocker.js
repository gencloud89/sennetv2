/**
 * preload-blocker.js — Chặn update dialog (phiên bản an toàn)
 * ==========================================================
 * KHÔNG override XMLHttpRequest — để tránh xung đột với axios.
 * Chỉ dùng CSS + MutationObserver để chặn update dialog.
 *
 * Tất cả xử lý network (x-hwid header, version intercept, mirror domain)
 * được thực hiện trong mirror-bootstrap.js qua axios interceptors.
 */
(function () {
    'use strict';

    // ============================================================
    // CSS — Ẩn tất cả dialog/modal liên quan đến update
    // ============================================================

    var blockCSS = '\
        /* Ẩn dialog chứa class update-dialog hoặc version-dialog */ \
        .update-dialog, \
        .version-dialog, \
        .modal-update, \
        .dialog-update, \
        .el-message-box__wrapper.update-available { \
            display: none !important; \
            visibility: hidden !important; \
            pointer-events: none !important; \
            z-index: -9999 !important; \
            opacity: 0 !important; \
        } \
        /* Ẩn overlay/mask của dialog */ \
        .v-modal:has(+ .update-dialog), \
        .el-overlay:has(+ .el-message-box__wrapper.update-available) { \
            display: none !important; \
        } \
    ';

    function injectBlockCSS() {
        var style = document.createElement('style');
        style.id = 'preload-block-update-css';
        style.textContent = blockCSS;
        document.head.appendChild(style);
    }

    // ============================================================
    // MutationObserver — Quét và xóa dialog update xuất hiện sau
    // ============================================================

    function startDOMScanner() {
        // FIX: Debounce 500ms — tránh quét DOM liên tục khi Vue render
        // FIX: KHÔNG dùng querySelectorAll('*') — chỉ quét dialog/modal
        // FIX: KHÔNG gọi el.remove() — ẩn bằng CSS để tránh infinite loop
        var _debounceTimer = null;

        var observer = new MutationObserver(function () {
            if (_debounceTimer) {
                clearTimeout(_debounceTimer);
            }
            _debounceTimer = setTimeout(function () {
                _debounceTimer = null;
                // Chỉ tìm các element dialog/modal cụ thể
                var dialogElements = document.querySelectorAll(
                    '.el-message-box, .el-dialog, .el-message, .el-notification, ' +
                    '[class*="dialog"], [class*="modal"], [class*="popup"], ' +
                    'dialog, [role="dialog"], [role="alertdialog"]'
                );
                for (var i = 0; i < dialogElements.length; i++) {
                    var el = dialogElements[i];
                    if (!el.isConnected || el.style.display === 'none') continue;

                    var text = (el.textContent || '').toLowerCase();

                    // Phát hiện dialog update qua text
                    if (text.indexOf('new version') !== -1 ||
                        text.indexOf('new version found') !== -1 ||
                        text.indexOf('cập nhật') !== -1 ||
                        text.indexOf('phiên bản mới') !== -1 ||
                        text.indexOf('đã có bản cập nhật') !== -1) {

                        console.log('[PreloadBlocker] Removing update dialog:', el.className || el.tagName);
                        // Ẩn bằng CSS thay vì xóa — tránh infinite loop
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                        el.setAttribute('data-preload-hidden', 'true');
                    }
                }
            }, 500); // Debounce 500ms
        });

        if (document.body) {
            // FIX: CHỈ observe childList (KHÔNG characterData)
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
    }

    // ============================================================
    // INIT
    // ============================================================

    if (document.head) {
        injectBlockCSS();
    } else {
        document.addEventListener('DOMContentLoaded', injectBlockCSS);
    }

    if (document.body) {
        startDOMScanner();
    } else {
        document.addEventListener('DOMContentLoaded', startDOMScanner);
    }

    console.log('[PreloadBlocker] Loaded (safe mode — no XHR override)');
})();
