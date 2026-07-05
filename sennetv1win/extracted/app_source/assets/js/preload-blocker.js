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
        /* Ẩn dialog chứa text "new version" hoặc "update" */ \
        .el-message-box__wrapper, \
        .el-dialog__wrapper, \
        .update-dialog, \
        .version-dialog, \
        [class*="update"], \
        [class*="newVersion"], \
        .modal-update, \
        .dialog-update { \
            display: none !important; \
            visibility: hidden !important; \
            pointer-events: none !important; \
            z-index: -9999 !important; \
            opacity: 0 !important; \
        } \
        /* Ẩn overlay/mask của dialog */ \
        .v-modal, \
        .el-overlay, \
        .modal-mask, \
        .dialog-mask { \
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
        var observer = new MutationObserver(function () {
            var allElements = document.querySelectorAll('*');
            for (var i = 0; i < allElements.length; i++) {
                var el = allElements[i];
                var text = (el.textContent || '').toLowerCase();
                var className = (el.className || '').toString().toLowerCase();

                // Phát hiện dialog update qua text hoặc class
                if ((text.indexOf('new version') !== -1 ||
                     text.indexOf('new version found') !== -1 ||
                     text.indexOf('cập nhật') !== -1 ||
                     text.indexOf('phiên bản mới') !== -1 ||
                     text.indexOf('đã có bản cập nhật') !== -1) &&
                    (className.indexOf('dialog') !== -1 ||
                     className.indexOf('modal') !== -1 ||
                     className.indexOf('message') !== -1 ||
                     className.indexOf('popup') !== -1 ||
                     className.indexOf('notification') !== -1 ||
                     el.tagName === 'DIALOG')) {

                    console.log('[PreloadBlocker] Removing update dialog:', el.className || el.tagName);
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    el.remove();
                }
            }
        });

        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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
