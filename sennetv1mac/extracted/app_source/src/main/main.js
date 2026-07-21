const Promise = require('bluebird'),
  {
    Menu,
    Tray,
    app,
    BrowserWindow,
    shell,
    nativeImage,
    dialog,
  } = require('electron'),
  electron = require('electron'),
  ipc = require('electron').ipcMain,
  cps = require('child_process'),
  process = require('process'),
  { spawn } = require('child_process'),
  fs = require('fs'),
  fse = require('fs-extra'),
  path = require('path'),
  http = require('http'),
  https = require('https')
var request = require('request'),
  qs = require('querystring'),
  sudo = require('sudo-prompt')
// electron-updater đã bị xóa khỏi node_modules → dùng stub thay thế
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
const { isMac, isWin, isLinux, isDev, isNoPack } = require('./env.js'),
  { net } = require('electron'),
  util = require('util'),
  defaultGateway = require('default-gateway'),
  { ensureFile, ensureDir } = require('fs-extra'),
  os = require('os'),
  tracer = require('tracer')
let _isQuiting = false,
  mainWindow,
  coreServer,
  coreServerPID,
  tray,
  forceUpdate = false
autoUpdater.autoDownload = false
// ===== DISABLE AUTO UPDATE CHECK =====
// Ghi đè checkForUpdates để không bao giờ kiểm tra cập nhật
autoUpdater.checkForUpdates = function () {
  console.log('[Update] Auto update check disabled')
  return Promise.resolve(null)
}
// ===== END DISABLE AUTO UPDATE =====
let message = {
    error: '检查更新失败',
    checking: '正在检查更新',
    updateAva: '检测到新版本\uFF0C系统将自动下载并更新',
    updateNotAva: '当前已是最新版\uFF0C无需更新',
    updateEnd: '应用已完成更新\uFF0C下次启动将加载最新版本',
    updateLocal: '开发环境,不支持更新',
  },
  __libname = path.dirname(path.dirname(path.dirname(__dirname)))
if (isDev) {
  __libname = path.dirname(path.dirname(__dirname))
} else {
  isDev && isWin && (__libname = __dirname)
}
isNoPack && (__libname = path.dirname(path.dirname(__dirname)))
var __static = path.join(__libname, 'extra', 'static')
const _appname = 'Gudao',
  appConfigDir = path.join(app.getPath('appData'), _appname),
  logPath = path.join(appConfigDir, 'app_client.log'),
  vpnLogPath = path.join(appConfigDir, 'vpn_debug.log'),  // VPN debug log riêng
  confPath = path.join(os.homedir(), '.config'),
  dirPath = path.join(confPath, _appname),
  geoipPath = path.join(appConfigDir, 'geoip.db'),
  geositePath = path.join(appConfigDir, 'geosite.db'),
  configPath = path.join(appConfigDir, 'config.json'),
  configPath2 = path.join(__libname, 'extra/config.json'),
  sysproxyPath = path.join(appConfigDir, 'sysproxy.exe'),
  userConfigDir = app.getPath('userData')

// Helper: ghi log VPN ra file riêng
function vpnLogToFile(msg) {
  try {
    var ts = new Date().toISOString()
    var line = '[' + ts + '] ' + msg + '\n'
    fs.appendFileSync(vpnLogPath, line, 'utf8')
  } catch (e) {}
}

// ============================================================
// PRIVILEGED SESSION — 1 sudo prompt cho TOÀN BỘ phiên app
// ============================================================
// Dùng file-based command queue: root shell poll file mỗi 0.5s.
// execRoot ghi lệnh vào file không chặn (non-blocking).
// Chỉ prompt password MỘT LẦN khi mở app.

var _vpnCmdFile = isMac ? path.join(appConfigDir, 'vpn_cmd.sh') : null
var _vpnRootReady = false
var _vpnPendingCallbacks = []

function execRoot(cmd, callback) {
  if (!isMac) {
    // Windows: dùng cps.exec trực tiếp (cần admin context)
    cps.exec(cmd, callback)
    return
  }
  var safeCmd = cmd.replace(/'/g, "'\\''")
  var fullScript = '#!/bin/sh\n' + safeCmd + '\n'
  var tmpFile = _vpnCmdFile + '.tmp'

  if (_vpnRootReady) {
    try {
      // Ghi vào file tmp rồi rename atomic (không block)
      fs.writeFileSync(tmpFile, fullScript, 'utf8')
      fs.renameSync(tmpFile, _vpnCmdFile)
      vpnLogToFile('execRoot: ' + cmd.substring(0, 150))
    } catch (e) {
      vpnLogToFile('execRoot write error: ' + e.message)
    }
    if (callback) setTimeout(callback, 1000)
  } else {
    // Root shell chưa sẵn sàng — queue
    vpnLogToFile('execRoot QUEUED: ' + cmd.substring(0, 100))
    _vpnPendingCallbacks.push({ cmd: cmd, cb: callback })
  }
}

function setupPrivilegedSession() {
  if (!isMac) return
  vpnLogToFile('=== Privileged session setup (1 password only) ===')

  // Root shell loop: poll file mỗi 0.5s, thực thi nếu có lệnh
  var loopScript =
    'CMD=' + _vpnCmdFile + '; ' +
    'echo "root-shell-started"; ' +
    'while true; do ' +
    '  if [ -f "$CMD" ]; then ' +
    '    mv "$CMD" "$CMD.exec" 2>/dev/null; ' +
    '    sh "$CMD.exec" 2>&1; ' +
    '    rm -f "$CMD.exec"; ' +
    '  fi; ' +
    '  sleep 0.5; ' +
    'done'

  logger.info('Starting privileged session (1 password prompt)...')
  vpnLogToFile('Root shell script: ' + loopScript)

  sudo.exec(loopScript, { name: 'SENNET VPN' }, function (err, stdout, stderr) {
    if (err) {
      vpnLogToFile('Root shell ERROR: ' + (err.message || err))
    } else {
      vpnLogToFile('Root shell exited normally')
    }
    _vpnRootReady = false
  })

  // Đợi 3s cho user nhập password, sau đó đánh dấu ready
  setTimeout(function () {
    _vpnRootReady = true
    vpnLogToFile('Root shell READY (' + _vpnPendingCallbacks.length + ' queued commands)')
    for (var i = 0; i < _vpnPendingCallbacks.length; i++) {
      var pending = _vpnPendingCallbacks[i]
      execRoot(pending.cmd, pending.cb)
    }
    _vpnPendingCallbacks = []
  }, 3000)
}

function cleanupPrivilegedSession() {
  if (!isMac || !_vpnCmdFile) return
  vpnLogToFile('Cleaning up privileged session')

  // Dừng log monitor trước
  if (_coreLogMonitor) {
    _coreLogMonitor.stop()
    _coreLogMonitor = null
  }

  // Gửi lệnh cleanup: kill libcore + xóa file
  var cleanupCmd = 'pkill -9 -f libcore 2>/dev/null || true'
  execRoot(cleanupCmd)
  setTimeout(function () {
    try {
      fs.unlinkSync(_vpnCmdFile)
      fs.unlinkSync(path.join(appConfigDir, 'vpn_core.log'))
      fs.unlinkSync(path.join(appConfigDir, 'vpn_core.pid'))
    } catch (e) {}
  }, 1500)
  _vpnRootReady = false
}
// Mac: dùng libcore (không .exe), Windows: libcore.exe
var libcoreName = isMac ? 'libcore' : 'libcore.exe'
var libcorePath = path.join(appConfigDir, libcoreName)
var tun2socksPath = path.join(__libname, 'extra', libcoreName),
  tun2socksToolPath = path.resolve(userConfigDir, libcoreName)
let winToolPath
if (isMac) {
  winToolPath = null  // Mac không dùng sysproxy.exe
} else if (isWin) {
  winToolPath = path.join(__libname, '/extra/sysproxy.exe')
}
var userKey = '',
  serverLoad = '',
  serverConnected = '',
  serverMode = '',
  isModeBeforeSleep,
  isRouteBeforeSleep,
  noHelper = null,
  closeFlag = false,
  intervalId = null
function init() {
  logger.info('app init.')
  const _0x232031 = [
    {
      label: 'Application',
      submenu: [
        {
          label: 'About',
          selector: 'orderFrontStandardAboutPanel:',
        },
        { type: 'separator' },
      ],
    },
    {
      label: 'edit',
      submenu: [
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          selector: 'cut:',
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          selector: 'copy:',
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          selector: 'paste:',
        },
        {
          label: 'SelectAll',
          accelerator: 'CmdOrCtrl+A',
          selector: 'selectAll:',
        },
      ],
    },
  ]
  logger.info('app init 2.')
  initProxyHelper()
    .then(function () {
      // Setup privileged session: 1 sudo prompt duy nhất cho toàn bộ phiên
      if (isMac) setupPrivilegedSession()
    })
    .then(function () {
      initConfig()
        .then(function () {
          isMac
            ? Menu.setApplicationMenu(Menu.buildFromTemplate(_0x232031))
            : Menu.setApplicationMenu(null)
          createWindow()
          renderTray()
        })
        .catch(function (_0x27fff6) {
          logger.info('initConfig' + _0x27fff6)
          noHelper = 1
          exit()
        })
      initPowerMonitor()
    })
    .catch(function (_0x2dd6cc) {
      logger.info('initProxyHelper' + _0x2dd6cc)
      noHelper = 1
      exit()
    })
}
function createWindow() {
  isMac && app.dock.show()
  isDev
    ? ((mainWindow = new BrowserWindow({
        width: 720,
        height: 680,
        closable: true,
        resizable: false,
        maximizable: false,
        skipTaskbar: false,
        useContentSize: true,
        frame: false,
        icon: 'assets/favicon.icns',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
          nodeIntegration: true,
          nodeIntegrationInWorker: true,
          webSecurity: false,
          webviewTag: true,
          contextIsolation: false,
          enableRemoteModule: true,
		  devTools: true
        },
      })),
      mainWindow.webContents.setUserAgent('macos.v2board.app 2.0'),
      mainWindow.loadFile('app.html'))
    : ((mainWindow = new BrowserWindow({
        width: 720,
        height: 680,
        closable: true,
        resizable: false,
        maximizable: false,
        skipTaskbar: false,
        useContentSize: true,
        frame: false,
        icon: 'assets/favicon.icns',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
          nodeIntegration: true,
          nodeIntegrationInWorker: true,
          webSecurity: false,
          webviewTag: true,
          contextIsolation: false,
          enableRemoteModule: true,
		  devTools: true
        },
      })),
      mainWindow.webContents.setUserAgent('macos.v2board.app 2.0'),
      mainWindow.loadFile('app.html'))
  mainWindow.on('close', (_0x55afdd) => {
    !isQuiting() && (_0x55afdd.preventDefault(), mainWindow.hide())
  })
  mainWindow.on('closed', function () {
    mainWindow = null
    isMac && app.dock.hide()
  })
  logger.info('createWin done')
}
function getWindow() {
  return mainWindow
}
function isQuiting(_0x2544dd) {
  if (_0x2544dd !== undefined) {
    _isQuiting = _0x2544dd
  } else {
    return _isQuiting
  }
}
function reloadWindow() {
  mainWindow == null
    ? createWindow()
    : (mainWindow.close(),
      setTimeout(function () {
        reopenWindow()
        updateTray()
      }, 1000))
}
function reopenWindow() {
  mainWindow == null
    ? createWindow()
    : (mainWindow.show(), isMac && app.dock.show())
}
if (isDev) {
}
ipc.on('checkForUpdate', () => {})
// ===== DISABLE ALL UPDATE NOTIFICATIONS =====
// TẤT CẢ autoUpdater events đều bị vô hiệu hóa
// sendUpdateMessage bị chặn hoàn toàn với mọi update-related message
autoUpdater
  .on('error', (_0x3dedd8) => {
    console.log('[Update] Blocked error event')
  })
  .on('checking-for-update', (_0xc771c8) => {
    console.log('[Update] Blocked checking-for-update event')
  })
  .on('update-available', (_0x2effc0) => {
    console.log('[Update] Blocked update-available event — will NOT notify renderer')
  })
  .on('download-progress', ({ percent: _0x29f327 }) => {
    console.log('[Update] Blocked download-progress event')
  })
  .on('update-not-available', (_0x1a0fb6) => {
    console.log('[Update] Blocked update-not-available event')
  })
  .on('update-downloaded', () => {
    console.log('[Update] Blocked update-downloaded event')
  })
ipc.on('isUpdateNow', (_0x2ecacc, _0x252b40) => {
  console.log('[Update] Blocked isUpdateNow — will NOT quit and install')
})
ipc.on('downloadUpdate', () => {
  console.log('[Update] Blocked downloadUpdate')
})
function sendUpdateMessage(_0x64b2f7, _0x3d39de) {
  // ===== BLOCK ALL UPDATE MESSAGES =====
  // Không gửi bất kỳ thông báo update nào đến renderer
  console.log('[Update] BLOCKED message to renderer:', _0x64b2f7)
  return
}
function checkUpdate(_0x302196 = false) {
  // ===== DISABLE AUTO UPDATE =====
  console.log('[Update] Update check disabled — skipping')
  // forceUpdate = _0x302196
  // autoUpdater.checkForUpdates()
  // ===== END DISABLE =====
}
function windowAlert(_0x5db569) {
  var _0x1fff4c = {
    type: 'info',
    title: global.SiteName,
    message: _0x5db569,
    buttons: ['done'],
    defaultId: 0,
    icon: path.join(__static, 'ico', 'ico.png'),
  }
  dialog.showMessageBox(_0x1fff4c, function (_0x18c0b0) {})
}
function exit() {
  webContentsSend('appExit', 'true')
  NotTunkillCoreProcess()
    .then(function () {
      serverConnected = null
      app.exit()
    })
    .catch((_0x3f64b8) => {
      serverConnected = null
    })
}
function webContentsSend(_0x247998, _0xe70d8, _0x10fe40 = false) {
  if (mainWindow != null) {
    mainWindow.webContents.send(_0x247998, _0xe70d8)
  } else {
    !_0x10fe40 && console.log('No Window: ' + _0x247998 + ' | ' + _0xe70d8)
  }
}
function webContentsSendAction(
  _0x199ca0,
  _0x34c6c8,
  _0x4955c3,
  _0x103074 = false
) {
  mainWindow = getWindow()
  if (mainWindow != null) {
    mainWindow.webContents.send(_0x199ca0, _0x34c6c8, _0x4955c3)
  } else {
    !_0x103074 && console.log('No Window: ' + _0x199ca0 + ' | ' + _0x4955c3)
  }
}
const gotTheLock = app.requestSingleInstanceLock()
!gotTheLock
  ? app.quit()
  : (app.on('second-instance', (_0x3646f9, _0x114f8a, _0x2c2bef) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.focus()
      }
    }),
    app.on('ready', init))
app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  isQuiting(true)
})
app.on('quit', function () {
  console.log('quit ' + noHelper)
  noHelper == null && closeServer()
  if (isMac) cleanupPrivilegedSession()
})
app.on('activate', () => {
  getWindow() === null ? createWindow() : reopenWindow()
})
dialog.showErrorBox = (_0x2ce5fd, _0x187908) => {
  console.log(_0x2ce5fd + '\n' + _0x187908)
}
ipc.on('onClickControl', async function (_0x409650, _0x25e00c, _0x1aae86) {
  switch (_0x25e00c) {
    case 'winHide':
      !isQuiting() && mainWindow.hide()
      break
    case 'winMini':
      mainWindow != null && mainWindow.minimize()
      break
    case 'InitCore':
      rebootServer()
      break
    case 'Connect':
      setProxy(true),
        webContentsSend('statusJS', 'true'),
        console.log('Connect global')
      break
    case 'Stop':
      console.log('closeServer'),
        setProxy(),
        webContentsSend('statusJS', 'false')
      break
    case 'saveSysConfig':
      saveSysConfig(_0x1aae86).then(
        (_0x4df3e8) =>
          function (_0x5e8f95) {
            console.log(_0x4df3e8)
          }
      )
      break
    case 'quit':
      ;(userKey = ''), (serverLoad = ''), closeServer(), reloadWindow()
      break
    default:
      webContentsSend('V2Ray-log', 'IllegalAccess')
      break
  }
})
const logger = tracer.console({
  transport(_0x94d5c) {
    _0x94d5c &&
      fs
        .createWriteStream(logPath, { flags: 'a+' })
        .write(_0x94d5c.output + '\n', 'utf8')
  },
})
// Lấy danh sách NETWORK SERVICES — DÙNG BLOCKLIST (bao gồm mọi interface, chỉ loại trừ VPN ảo)
// v20: Sửa lỗi proxy set sai interface. Cách cũ dùng allowlist (chỉ hardware ports)
// → bỏ sót interface internet thật của user (USB LAN, Wi-Fi...). Cách mới: lấy TẤT CẢ,
// chỉ LOẠI TRỪ các service ảo/VPN đã biết.
function getActiveNetworkServices() {
  var services = []
  try {
    var orderOut = cps.execSync('networksetup -listnetworkserviceorder', { encoding: 'utf8' })
    var orderLines = orderOut.split('\n')

    // BLACKLIST: Các service ảo/VPN — case-insensitive
    var virtualPatterns = [
      'iphone', 'ipad',           // iOS tethering
      'shadowrocket',              // VPN app
      'tailscale',                 // VPN mesh
      'vpn',                       // Mọi VPN-related
      'nas',                       // NAS storage
      'macbook',                   // Hostname-based virtual
      'bluetooth',                 // Bluetooth PAN
      'firewire',                  // FireWire (cũ)
      'thunderbolt bridge',        // Bridge cho 2 máy Mac nối với nhau
      'thunderbolt ethernet'       // Thunderbolt Ethernet slot
    ]

    for (var j = 0; j < orderLines.length; j++) {
      var match = orderLines[j].match(/^\(\d+\)\s+(.+)$/)
      if (match) {
        var svc = match[1].trim()
        if (svc.indexOf('*') !== -1) continue  // Disabled service

        var isVirtual = false
        var svcLower = svc.toLowerCase()
        for (var k = 0; k < virtualPatterns.length; k++) {
          if (svcLower.indexOf(virtualPatterns[k]) !== -1) {
            isVirtual = true
            break
          }
        }

        if (!isVirtual) {
          services.push(svc)
        } else {
          logger.info('proxy: SKIP virtual: ' + svc)
        }
      }
    }
  } catch (e) {
    logger.info('proxy: error detecting services: ' + e.message)
  }
  if (services.length === 0) services.push('Wi-Fi')
  logger.info('proxy: active services (' + services.length + '): ' + JSON.stringify(services))
  return services
}

function setProxy(_0x8f8ad7) {
  if (isMac) {
    // Lấy TẤT CẢ active network services
    var networkServices = getActiveNetworkServices()
    // Chỉ dùng service CHÍNH (đầu tiên = priority cao nhất)
    var primaryService = networkServices[0] || 'Wi-Fi'

    if (_0x8f8ad7) {
      // Bật proxy — áp dụng cho TẤT CẢ services
      var cmds = []
      for (var i = 0; i < networkServices.length; i++) {
        var svc = networkServices[i]
        cmds.push('networksetup -setwebproxy "' + svc + '" 127.0.0.1 10090')
        cmds.push('networksetup -setsecurewebproxy "' + svc + '" 127.0.0.1 10090')
        cmds.push('networksetup -setsocksfirewallproxy "' + svc + '" 127.0.0.1 10090')
      }
      var proxyOnCmd = cmds.join(' && ')
      console.log('proxy: Mac proxy ON (' + networkServices.length + ' services, primary: ' + primaryService + ')')
      logger.info('proxy: Mac proxy ON: ' + proxyOnCmd)
      vpnLogToFile('PROXY ON (' + networkServices.length + ' services): ' + primaryService)
      execRoot(proxyOnCmd, function (err, stdout, stderr) {
        if (err || stderr) {
          var errMsg = 'PROXY ON ERROR: ' + (err ? err.message || err : stderr)
          logger.info(errMsg); vpnLogToFile(errMsg)
          webContentsSend('applog', 'PROXY ERROR: ' + (err ? err.message || err : stderr))
        } else {
          var okMsg = 'PROXY ON OK (' + networkServices.length + ' services)'
          logger.info(okMsg); vpnLogToFile(okMsg)
        }
      })
    } else {
      // Tắt proxy — cho TẤT CẢ services
      var offCmds = []
      for (var j = 0; j < networkServices.length; j++) {
        var svc2 = networkServices[j]
        offCmds.push('networksetup -setwebproxystate "' + svc2 + '" off')
        offCmds.push('networksetup -setsecurewebproxystate "' + svc2 + '" off')
        offCmds.push('networksetup -setsocksfirewallproxystate "' + svc2 + '" off')
      }
      var proxyOffCmd = offCmds.join(' && ')
      console.log('proxy: Mac proxy OFF (' + networkServices.length + ' services)')
      logger.info('proxy: Mac proxy OFF: ' + proxyOffCmd)
      vpnLogToFile('PROXY OFF (' + networkServices.length + ' services)')
      execRoot(proxyOffCmd, function (err, stdout, stderr) {
        if (err || stderr) {
          var errMsg = 'PROXY OFF ERROR: ' + (err ? err.message || err : stderr)
          logger.info(errMsg); vpnLogToFile(errMsg)
        } else {
          logger.info('PROXY OFF OK'); vpnLogToFile('PROXY OFF OK')
        }
      })
    }
  } else {
    // Windows: dùng sysproxy.exe
    let _0x404612 = path.join(appConfigDir, 'sysproxy.exe')
    var _0x3f692d = ''
    _0x8f8ad7
      ? (_0x3f692d = '"' + _0x404612 + '" global 127.0.0.1:10090 ""')
      : (_0x3f692d = '"' + _0x404612 + '" pac ""')
    cps.execSync(_0x3f692d)
    console.log('proxy: ' + _0x3f692d)
    logger.info('proxy: ' + _0x3f692d)
  }
}
async function initConfig() {
  return new Promise(async function (_0xe3d8df) {
    return (
      await ensureFile(logPath),
      os.platform() == 'darwin'
        ? ((tun2socksPath = path.join(__libname, 'extra/libcore')),
          (tun2socksToolPath = path.resolve(userConfigDir, 'libcore')))
        : ((tun2socksPath = path.join(__libname, 'extra/libcore.exe')),
          (tun2socksToolPath = path.resolve(userConfigDir, 'libcore.exe'))),
      !fs.existsSync(appConfigDir) &&
        (await ensureDir(appConfigDir), logger.info('SystemFolderCreated')),
      // Windows: copy sysproxy.exe — Mac không cần (dùng networksetup)
      !isMac && !fs.existsSync(sysproxyPath) &&
        fs.copyFile(
          path.join(__libname, 'extra/sysproxy.exe'),
          path.join(appConfigDir, 'sysproxy.exe'),
          (_0x117240) => {
            if (_0x117240) {
              throw _0x117240
            }
            logger.info('sysproxy.exe copy done')
          }
        ),
      // Copy native binary (libcore.exe cho Windows, libcore cho Mac)
      fs.copyFile(
        path.join(__libname, 'extra', libcoreName),
        path.join(appConfigDir, libcoreName),
        (_0x236421) => {
          if (_0x236421) {
            throw _0x236421
          }
        }
      ),
      logger.info('init Done.'),
      _0xe3d8df()
    )
  })
}
function saveSysConfig(_0xfe9109) {
  return new Promise((_0x113b46, _0x3b64e6) => {
    fs.writeFile(
      configPath,
      JSON.stringify(_0xfe9109, null, 4),
      {
        flag: 'w',
        encoding: 'utf-8',
        mode: '0666',
      },
      function (_0x2e84ec) {
        return _0x2e84ec
          ? _0x3b64e6(_0x2e84ec)
          : (coreServer != null && callRestartCore(), _0x113b46(true))
      }
    )
  })
}
function callRestartCore() {
  if (coreServer != null) {
    let _0x57c425 = coreServer.pid
    rebootServer()
    console.log('coreServer SIGHIUP:' + _0x57c425)
  } else {
    console.log('No coreServer')
  }
}
function getExeParams() {
  let _0x267ea8
  return (_0x267ea8 = ['run', '-D', '' + getResource()]), _0x267ea8
}
function getExeLocation() {
  let _0x348da9
  return (_0x348da9 = '"' + getResource('libcore.exe') + '"'), _0x348da9
}
const getResource = (_0x22f73a) => {
  let _0x53bccf = ''
  if (isMac) {
    _0x53bccf = app.isPackaged
      ? path.join(process.cwd(), '/resources/extra')
      : path.join(process.cwd(), '/extra')
  } else if (isWin) {
    _0x53bccf = app.isPackaged
      ? path.join(process.cwd(), '/resources/extra')
      : path.join(process.cwd(), '/extra')
  }
  _0x22f73a && (_0x53bccf = path.join(_0x53bccf, _0x22f73a))
  return _0x53bccf
}
// ============================================================
// CORE LOG MONITOR — Đọc output libcore từ log file
// ============================================================
// Vì libcore được start bởi root shell (qua execRoot), output của nó
// được redirect ra file. Monitor này thay thế cho cps.exec stdout/stderr.

var _coreLogMonitor = null  // { stop(), pid, _timer }
var _coreStarting = false   // Guard chống double-start libcore

function setupCoreLogMonitor(logFile, pidFile) {
  // Dọn dẹp monitor cũ nếu có
  if (_coreLogMonitor) {
    try { clearInterval(_coreLogMonitor._timer) } catch (e) {}
    _coreLogMonitor = null
  }

  var monitor = {
    pid: null,
    _timer: null,
    _lastSize: 0,
    _started: false,
    _startAttempts: 0,
    _stopped: false
  }

  function readPid() {
    try {
      if (fs.existsSync(pidFile)) {
        var pidStr = fs.readFileSync(pidFile, 'utf8').trim()
        if (pidStr && /^\d+$/.test(pidStr)) {
          monitor.pid = parseInt(pidStr, 10)
        }
      }
    } catch (e) {}
  }

  function checkPort9790() {
    // Kiểm tra sing-box controller API đã sẵn sàng chưa
    try {
      var result = cps.execSync(
        'curl -sf --connect-timeout 1 --max-time 2 http://127.0.0.1:9790/ 2>/dev/null || echo "NOT_READY"',
        { encoding: 'utf8', timeout: 3000 }
      )
      if (result && result.indexOf('NOT_READY') === -1) {
        return true
      }
    } catch (e) {}
    return false
  }

  function pollLog() {
    if (monitor._stopped) return

    // Kiểm tra PID còn sống không
    readPid()
    if (monitor.pid && !monitor._stopped) {
      try {
        process.kill(monitor.pid, 0)  // signal 0 = check exists
      } catch (e) {
        // Process đã chết
        if (monitor._started) {
          vpnLogToFile('libcore process died (pid=' + monitor.pid + ')')
          webContentsSend('applog', 'exit:libcore process ended')
          webContentsSend('coreStatus', 'false')
          monitor._started = false
        }
        monitor.pid = null
      }
    }

    // Đọc nội dung mới từ log file
    try {
      if (!fs.existsSync(logFile)) return
      var stat = fs.statSync(logFile)
      if (stat.size > monitor._lastSize) {
        var fd = fs.openSync(logFile, 'r')
        var buf = Buffer.alloc(Math.min(stat.size - monitor._lastSize, 65536))
        fs.readSync(fd, buf, 0, buf.length, monitor._lastSize)
        fs.closeSync(fd)
        monitor._lastSize = stat.size

        var text = buf.toString('utf8')
        var lines = text.split('\n')
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim()
          if (!line) continue

          // Forward to renderer
          webContentsSend('applog', 'data:' + line.substring(0, 300))

          // Phát hiện sing-box khởi động thành công
          if (line.indexOf('sing-box started') > -1 && !monitor._started) {
            monitor._started = true
            monitor._startAttempts = 0
            readPid()
            _coreStarting = false  // v20: Reset guard — libcore đã start xong
            vpnLogToFile('libcore STARTED (pid=' + monitor.pid + ')')
            webContentsSend('coreStatus', 'true')
            console.log('start success:' + monitor.pid)
          }

          // Phát hiện lỗi
          if (line.indexOf('external controller listen failed') > -1) {
            vpnLogToFile('libcore ERROR: port conflict (9790 already in use?)')
            console.log('start err: port conflict')
          }
          if (line.indexOf('open cache file: timeout') > -1) {
            vpnLogToFile('libcore ERROR: cache file timeout')
            console.log('start err: cache timeout')
          }
        }
      }
    } catch (e) {}

    // Fallback: nếu chưa detect "sing-box started" trong log, poll port 9790
    if (!monitor._started && !monitor._stopped) {
      monitor._startAttempts++
      if (monitor._startAttempts >= 4) {  // Sau ~4s (poll mỗi 1s)
        if (checkPort9790()) {
          monitor._started = true
          readPid()
          vpnLogToFile('libcore detected via port 9790 (pid=' + monitor.pid + ')')
          webContentsSend('coreStatus', 'true')
          console.log('start success (port):' + monitor.pid)
        }
        monitor._startAttempts = 0  // Reset, sẽ kiểm tra lại sau 4s
      }
      if (monitor._startAttempts > 30) {
        // Sau 30s — coi như failed
        _coreStarting = false  // v20: Reset guard — start thất bại
        vpnLogToFile('libcore FAILED to start after 30s')
        webContentsSend('coreStatus', 'false')
        monitor._startAttempts = 0
      }
    }
  }

  // Xóa log cũ nếu có
  try { fs.writeFileSync(logFile, '', 'utf8'); monitor._lastSize = 0 } catch (e) {}

  // Poll mỗi 1 giây
  monitor._timer = setInterval(pollLog, 1000)

  // Đọc PID sau 2s (đợi root shell ghi file)
  setTimeout(readPid, 2000)

  // Monitor methods
  monitor.stop = function () {
    monitor._stopped = true
    if (monitor._timer) {
      clearInterval(monitor._timer)
      monitor._timer = null
    }
  }

  monitor.kill = function () {
    // Gửi tín hiệu kill đến PID đã biết
    if (monitor.pid) {
      try { process.kill(monitor.pid, 'SIGTERM') } catch (e) {}
    }
  }

  _coreLogMonitor = monitor
  vpnLogToFile('Core log monitor started: ' + logFile)
  return monitor
}

async function startClashProcess(_0xb3c1ee, _0x4ec26e) {
  // v20: Guard chống double-start — nếu đang start dở thì bỏ qua
  if (isMac && _coreStarting) {
    vpnLogToFile('startClashProcess: SKIP (already starting)')
    logger.info('startClashProcess: SKIP (already starting)')
    return
  }
  if (isMac) _coreStarting = true

  let _0x2f9277 = path.join(appConfigDir, libcoreName)
  const _0x3c818b = '"' + _0x2f9277 + '" run -D "' + appConfigDir + '"'
  vpnLogToFile('startClashProcess: ' + _0x3c818b)
  logger.info('run: ' + _0x3c818b)

  if (isMac) {
    // ============================================================
    // MAC VPN START — v19 REWRITE
    // ============================================================
    // Fix 4 lỗi nghiêm trọng:
    //   1. KHÔNG double start (chỉ start qua root shell, không cps.exec)
    //   2. KHÔNG deadlock (không wait $PID — libcore chạy background)
    //   3. CÓ log monitoring (đọc output libcore từ file log)
    //   4. Port polling thay vì blind sleep 3s
    // ============================================================
    var coreLogFile = path.join(appConfigDir, 'vpn_core.log')
    var corePidFile = path.join(appConfigDir, 'vpn_core.pid')

    // Script start libcore trong root shell:
    // - Chạy background (&), redirect output ra log file
    // - Ghi PID ra file
    // - KHÔNG wait — script exit ngay, root shell tiếp tục poll
    var startScript =
      _0x3c818b + ' > "' + coreLogFile + '" 2>&1 &\n' +
      'echo $! > "' + corePidFile + '"\n' +
      '# libcore started in background, root shell continues polling\n'

    vpnLogToFile('VPN START (Mac v19): ' + _0x3c818b)
    logger.info('VPN START (Mac v19): ' + startScript)

    execRoot(startScript, function (err, stdout, stderr) {
      if (err || stderr) {
        var errMsg = 'VPN START ERROR: ' + (err ? err.message || err : stderr)
        logger.info(errMsg); vpnLogToFile(errMsg)
        webContentsSend('applog', 'VPN START ERROR: ' + (err ? err.message || err : stderr))
      } else {
        vpnLogToFile('VPN START script executed OK')
      }
    })

    // KHỞI ĐỘNG LOG MONITOR — thay thế cho cps.exec stdout/stderr
    _coreLogMonitor = setupCoreLogMonitor(coreLogFile, corePidFile)

    // Set coreServer = monitor object (giữ tương thích với code cũ)
    // Code check coreServer != null, coreServer.pid, coreServer.kill()
    coreServer = _coreLogMonitor
  } else {
    // Windows: giữ nguyên logic cps.exec
    coreServer = cps.exec(_0x3c818b)
    vpnLogToFile('coreServer pid: ' + (coreServer ? coreServer.pid : 'null'))
    coreServer.stdout.on('data', (_0x4ebb8f) => {
      webContentsSend('applog', 'data:' + _0x4ebb8f)
      if (_0x4ebb8f.indexOf('sing-box started') > -1) {
        console.log('start success:' + coreServer.pid)
        webContentsSend('coreStatus', 'true')
      } else {
        _0x4ebb8f.indexOf('external controller listen failed error') > -1 &&
          console.log('start err.')
      }
    })
    coreServer.on('SIGINT', function () {
      console.log('core ignore SIGINT')
    })
    coreServer.stderr.on('data', (_0x49166a) => {
      webContentsSend('applog', 'data2:' + _0x49166a)
      if (_0x49166a.indexOf('sing-box started') > -1) {
        console.log('start success:' + coreServer.pid)
        webContentsSend('coreStatus', 'true')
      } else {
        if (_0x49166a.indexOf('external controller listen failed error') > -1) {
          console.log('start err.')
        } else {
          _0x49166a.indexOf('open cache file: timeout') > -1 &&
            console.log('start err.')
        }
      }
    })
    coreServer.on('close', (_0xb5b6e4) => {
      webContentsSend('applog', 'close:' + _0xb5b6e4)
      console.log('RUN Close' + _0xb5b6e4)
    })
    coreServer.on('exit', (_0x1f23ec) => {
      webContentsSend('applog', 'exit:' + _0x1f23ec)
      coreServer = null
      console.log('RUN Exit' + _0x1f23ec)
    })
  }
}
function NotTunkillCoreProcess() {
  return new Promise((_0xb3107a) => {
    if (isMac) {
      // ============================================================
      // MAC VPN STOP — v19 REWRITE
      // ============================================================
      // 1. Stop log monitor trước (không cần poll nữa)
      // 2. execRoot: pkill libcore + unset proxy (script KHÔNG wait)
      // 3. Clean up coreServer reference
      // ============================================================

      // Dừng log monitor
      if (_coreLogMonitor) {
        _coreLogMonitor.stop()
        _coreLogMonitor = null
      }
      _coreStarting = false  // v20: Reset guard

      var services = getActiveNetworkServices()
      // Script stop: kill libcore + tắt proxy
      // Dùng pkill -9 để đảm bảo kill (kèm fallback nếu không có process)
      var combined = 'pkill -9 -f libcore 2>/dev/null || true'
      for (var i = 0; i < services.length; i++) {
        var svc = services[i]
        combined += '\nnetworksetup -setwebproxystate "' + svc + '" off'
        combined += '\nnetworksetup -setsecurewebproxystate "' + svc + '" off'
        combined += '\nnetworksetup -setsocksfirewallproxystate "' + svc + '" off'
      }
      // Dọn file PID
      combined += '\nrm -f "' + path.join(appConfigDir, 'vpn_core.pid') + '"'

      vpnLogToFile('VPN STOP (' + services.length + ' services)')
      logger.info('VPN STOP: ' + combined.substring(0, 200))

      execRoot(combined, function (err, stdout, stderr) {
        if (err || stderr) {
          var errMsg = 'VPN STOP ERROR: ' + (err ? err.message || err : stderr)
          logger.info(errMsg); vpnLogToFile(errMsg)
        } else {
          vpnLogToFile('VPN STOP OK'); logger.info('VPN STOP OK')
        }

        // Clean up coreServer (Mac: là monitor object, không phải ChildProcess)
        if (coreServer != null) {
          if (coreServer.stop) coreServer.stop()  // Mac monitor
          console.log('Kill Core:' + (coreServer.pid || 'monitor'))
        }
        coreServer = null

        // Gửi status STOP đến renderer
        webContentsSend('coreStatus', 'false')

        setTimeout(function () { _0xb3107a() }, 1000)
      })
    } else {
      // Windows: dùng taskkill
      let _0x5d4efd = 'cmd /k taskkill /f /im libcore.exe'
      cps.exec(_0x5d4efd)
      setProxy()
      coreServer != null &&
        (console.log('Kill Core:' + coreServer.pid), coreServer.kill())
      setTimeout(function () { _0xb3107a() }, 1500)
    }
  }).catch((_0x421f41) => {
    return _0x421f41
  })
}
function killCoreProcess() {
  return new Promise((_0x1bb740, _0x52d93b) => {
    if (isMac) {
      // Mac: dùng pgrep + pkill
      try {
        var result = cps.execSync('pgrep -f libcore 2>/dev/null || true', { encoding: 'utf8' })
        if (result.trim().length > 0) {
          console.log('libcore is run, killing...')
          cps.execSync('pkill -f libcore', { encoding: 'utf8' })
          console.log('libcore has been kill')
          _0x1bb740('SUCCESS')
        } else {
          console.log('libcore not run')
          _0x1bb740('not running')
        }
      } catch (e) {
        console.log('libcore not found (exception)')
        _0x1bb740('not running')
      }
    } else {
      // Windows: dùng tasklist + taskkill
      const _0x30d043 = 'libcore.exe',
        _0x29334e = 'tasklist /FI "IMAGENAME eq ' + _0x30d043 + '"'
      cps.exec(_0x29334e, (_0x3663df, _0x590145) => {
        !_0x3663df && _0x590145.includes(_0x30d043)
          ? (console.log(_0x30d043 + ' is run'),
            sudo.exec(
              'taskkill /F /IM libcore.exe',
              { name: 'App' },
              (_0x74736c, _0x435ded, _0x537f3a) => {
                if (_0x74736c) {
                  const _0x2a2d36 = _0x74736c.toString()
                  _0x2a2d36.includes('The process "libcore.exe" not found')
                    ? (console.log('Not found libcore'), _0x1bb740(_0x435ded))
                    : (console.error('ErrorMessage:', _0x2a2d36),
                      _0x52d93b(_0x74736c))
                } else {
                  _0x435ded.includes(
                    'SUCCESS: The process "libcore.exe" with PID'
                  ) &&
                    (console.log('libcore has been kill'), _0x1bb740(_0x435ded))
                  _0x1bb740(_0x435ded)
                }
              }
            ))
          : (console.log(_0x30d043 + ' not run'), _0x1bb740(_0x590145))
      })
    }
  }).catch((_0xd087ef) => {
    return _0xd087ef
  })
}
const RUN = ({ exe: _0x2abddb }, _0x559099) => {
  return new Promise((_0x5eecc1, _0x502bca) => {
    return sudo.exec(
      _0x2abddb,
      { name: 'Kill Process' },
      (_0x45e192, _0x2c6485) => {
        console.log(_0x45e192, _0x2c6485)
        if (_0x45e192) {
          return _0x502bca(_0x45e192)
        }
        _0x5eecc1(_0x2c6485)
        console.log('stdout: ' + _0x2c6485)
      }
    )
  })
}
function initPowerMonitor() {
  electron.powerMonitor.on('resume', () => {
    isModeBeforeSleep != 'OFF' &&
      isModeBeforeSleep != null &&
      typeof isModeBeforeSleep != 'undefined' &&
      console.log('run initPowerMonitor')
    isModeBeforeSleep = null
    isRouteBeforeSleep = null
  })
  electron.powerMonitor.on('suspend', () => {
    isRouteBeforeSleep = serverConnected
    console.log('suspend' + isModeBeforeSleep)
  })
  electron.powerMonitor.on('shutdown', () => {
    app.quit()
  })
}
function initProxyHelper() {
  return new Promise(function (_0x5647bb, _0x560c8f) {
    if (isMac) {
      // Mac: KHÔNG cần sudo ở bước init nữa
      // - libcore được copy bởi initConfig() (dùng fs.copyFile, không cần sudo)
      // - libcore được start với sudo trong startClashProcess()
      // - Việc chown/chmod/setuid không cần thiết vì đã dùng sudo để chạy
      logger.info('help init (Mac) — no sudo needed.')
      vpnLogToFile('=== SENNET VPN init (Mac) v17 ===')
      vpnLogToFile('tun2socksPath (Resources): ' + tun2socksPath)
      vpnLogToFile('libcorePath (appData): ' + path.join(appConfigDir, libcoreName))
      if (!fs.existsSync(tun2socksPath)) {
        var msg = 'libcore not found at ' + tun2socksPath + ' — VPN core unavailable'
        logger.info(msg); vpnLogToFile('ERROR: ' + msg)
      } else {
        vpnLogToFile('libcore FOUND in Resources')
        // Copy libcore từ Resources vào appConfigDir (không cần sudo)
        try {
          var destLibcore = path.join(appConfigDir, libcoreName)
          if (!fs.existsSync(destLibcore)) {
            fs.copyFileSync(tun2socksPath, destLibcore)
            fs.chmodSync(destLibcore, '755')
            vpnLogToFile('libcore copied to: ' + destLibcore)
          } else {
            vpnLogToFile('libcore already exists at: ' + destLibcore)
          }
        } catch (copyErr) {
          vpnLogToFile('libcore copy warning: ' + copyErr.message)
        }
      }
      return _0x5647bb()
    } else {
      return _0x5647bb()
    }
  })
}
function ProxyHelperAlert(_0x352374, _0x1749f4) {
  var _0xfff0c8 = {
    type: 'info',
    title: global.SiteName,
    message: _0x352374,
    buttons: ['done'],
    icon: path.join(__static, 'ico', 'ico.png'),
  }
  dialog.showMessageBox(_0xfff0c8, function (_0x3e074f) {})
}
function rebootServer() {
  NotTunkillCoreProcess()
    .then(function () {
      startClashProcess()
    })
    .catch((_0x39e1c6) => {
      console.log('kill error' + _0x39e1c6)
      serverConnected = null
    })
}
function closeServer() {
  NotTunkillCoreProcess()
    .then(function () {
      serverConnected = null
      webContentsSend('statusJS', 'false')
    })
    .catch((_0x1a5757) => {
      serverConnected = null
    })
}
function generateMenus() {
  let _0x5b4218 = [
    {
      label: '开启App',
      click: function () {
        reopenWindow()
      },
    },
    {
      label: '退出',
      click: function () {
        exit()
      },
    },
  ]
  return _0x5b4218
}
function updateTray() {
  const _0x1057b8 = generateMenus(),
    _0xa2c6a0 = Menu.buildFromTemplate(_0x1057b8)
  tray.setContextMenu(_0xa2c6a0)
  setTrayIcon()
}
function getTrayIcon() {
  return path.join(
    __static,
    'icons',
    isMac ? 'enabledTemplate@2x.png' : 'enabledTemplate@2x.png'
  )
}
function setTrayIcon() {
  tray.setImage(nativeImage.createFromPath(getTrayIcon()))
  isMac &&
    tray.setPressedImage(
      nativeImage.createFromPath(
        path.join(__static, 'icons', 'enabledTemplate@2x.png')
      )
    )
}
function renderTray() {
  tray = new Tray(nativeImage.createEmpty())
  updateTray()
  tray.on('click', function () {
    mainWindow != null &&
      (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show())
  })
}