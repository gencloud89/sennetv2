<?php

namespace App\Http\Controllers\V1\Client;

use App\Http\Controllers\Controller;
use App\Protocols\General;
use App\Protocols\Singbox\Singbox;
use App\Protocols\Singbox\SingboxOld;
use App\Protocols\ClashMeta;
use App\Services\ServerService;
use App\Services\UserService;
use App\Models\Plan;
use App\Models\User;
use App\Models\UserDevice;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ClientController extends Controller
{
    public function subscribe(Request $request)
    {
        
        $flag = $request->input('flag')
            ?? ($_SERVER['HTTP_USER_AGENT'] ?? '');
        $flag = strtolower($flag);
        $user = $request->user;
        $subscriptionDevice = $this->recordSubscriptionDevice($request, $user);
        if ($this->isSubscriptionDeviceBlocked($subscriptionDevice)) {
            $msg = ($subscriptionDevice && $subscriptionDevice->status === UserDevice::STATUS_OVER_LIMIT)
                ? 'Tài khoản đã đạt giới hạn số thiết bị được phép'
                : 'Thiết bị này đã bị dừng hoặc đã bị xóa';
            abort(403, $msg);
        }
        $custom_sni = $request->input('sni');
        if ($custom_sni === null && isset($user['network_settings'])) {
            $custom_sni = $user['network_settings'] ?? null;
        }

        $userService = new UserService();
        if ($userService->isAvailable($user)) {
            $serverService = new ServerService();
            $servers = $serverService->getAvailableServers($user);

            if($flag) {
                if (!strpos($flag, 'sing')) {
                    $this->setSubscribeInfoToServers($servers, $user, $custom_sni);
                    foreach (array_reverse(glob(app_path('Protocols') . '/*.php')) as $file) {
                        $file = 'App\\Protocols\\' . basename($file, '.php');
                        $class = new $file($user, $servers);
                        if (strpos($flag, $class->flag) !== false) {
                            return $class->handle();
                        }
                    }
                }
                if (strpos($flag, 'sing') !== false) {
                    $version = null;
                    if (preg_match('/sing-box\s+([0-9.]+)/i', $flag, $matches)) {
                        $version = $matches[1];
                    }
                    if (!is_null($version) && $version >= '1.12.0') {
                        $class = new Singbox($user, $servers);
                    } else {
                        $class = new SingboxOld($user, $servers);
                    }
                    return $class->handle();
                }
            }
            $class = new General($user, $servers);
            return $class->handle();
        } else {
            return $this->handleExpiredUser($request, $flag, $user, $custom_sni);
        }
    }

    private function setSubscribeInfoToServers(&$servers, $user, $custom_sni)
    {
        if ($custom_sni !== null) {
            foreach ($servers as &$server) {
                if ($server['type'] === 'shadowsocks' && isset($server['obfs']) && $server['obfs'] === 'http') {
                    $server['obfs-host'] = $custom_sni;
                }
                if ($server['type'] === 'vmess') {
                    if ($server['tls'] && isset($server['tlsSettings']['serverName'])) {
                        $server['tlsSettings']['serverName'] = $custom_sni;
                    }
                    if ($server['network'] === 'ws' && isset($server['networkSettings']['headers']['Host'])) {
                        $server['networkSettings']['headers']['Host'] = $custom_sni;
                    }
                }
                if ($server['type'] === 'vless') {
                    if ($server['tls'] && isset($server['tls_settings']['server_name'])) {
                        $server['tls_settings']['server_name'] = $custom_sni;
                    }
                    if ($server['network'] === 'ws' && isset($server['network_settings']['headers']['Host'])) {
                        $server['network_settings']['headers']['Host'] = $custom_sni;
                    }
                }
                if ($server['type'] === 'trojan') {
                    if (!empty($server['server_name'])) {
                        $server['server_name'] = $custom_sni;
                    }
                    if ($server['network'] === 'ws' && isset($server['network_settings']['headers']['Host'])) {
                        $server['network_settings']['headers']['Host'] = $custom_sni;
                    }
                }
                if ($server['type'] === 'hysteria') {
                    if (isset($server['server_name'])) {
                        $server['server_name'] = $custom_sni;
                    }
                }
                if ($server['type'] === 'tuic') {
                    if (isset($server['server_name'])) {
                        $server['server_name'] = $custom_sni;
                    }
                }
                if ($server['type'] === 'anytls') {
                    if (isset($server['server_name'])) {
                        $server['server_name'] = $custom_sni;
                    }
                }
            }
        }

        if (!isset($servers[0])) return;
        if (!(int)config('v2board.show_info_to_server_enable', 0)) return;
        $useTraffic = $user['u'] + $user['d'];
        $totalTraffic = $user['transfer_enable'];
        $remainingTraffic = Helper::trafficConvert($totalTraffic - $useTraffic);
        $expiredDate = $user['expired_at'] ? date('d-m-Y H:i:s', $user['expired_at']) : 'Vĩnh Viễn';
        $userService = new UserService();
        $resetDay = $userService->getResetDay($user);
        $userPlanId = $user['plan_id'];
        $v2Plan = Plan::find($userPlanId);
        $UserID = $user['id'];
        $planName = $v2Plan->name;
        if ($totalTraffic - $useTraffic <= 0) {
            $dataStatus = 'Đã hết data';
        } else {
            $dataStatus = $remainingTraffic;
        }
        array_unshift($servers, array_merge($servers[0], [
            'name' => "⏳ Hạn SD: {$expiredDate}",
        ]));
        if ($resetDay) {
            array_unshift($servers, array_merge($servers[0], [
                'name' => "Reset data sau：{$resetDay} Ngày",
            ]));
        }
        array_unshift($servers, array_merge($servers[0], [
            'name' => "📨 Data: {$dataStatus}",
        ]));
        array_unshift($servers, array_merge($servers[0], [
            'name' => "📝 Gói: {$planName}",
        ]));
        array_unshift($servers, array_merge($servers[0], [
            'name' => "👤 User ID: {$UserID}",
        ]));
    }

    private function isBotOrCrawler(string $ua): bool
    {
        if ($ua === '') return true;
        $lower = strtolower($ua);
        $signatures = [
            'telegrambot', 'twitterbot', 'facebookexternalhit', 'facebookbot',
            'slackbot', 'discordbot', 'linkedinbot', 'whatsapp',
            'googlebot', 'bingbot', 'yandexbot', 'duckduckbot',
            'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'petalbot',
            'python-requests', 'python-urllib', 'python/', 'go-http-client',
            'node-fetch', 'axios/', 'wget/', 'curl/', 'libwww-perl',
            'scrapy', 'headlesschrome', 'phantomjs', 'okhttp/4.9',
        ];
        foreach ($signatures as $sig) {
            if (strpos($lower, $sig) !== false) return true;
        }
        return false;
    }

    private function recordSubscriptionDevice(Request $request, $user)
    {
        try {
            if (empty($user['id'])) return;
            $ua = (string)$request->userAgent();
            if ($ua === '') return;
            if ($this->isBotOrCrawler($ua)) return null;

            $model = User::find($user['id']);
            if (!$model) return;

            $ip = $this->clientIp($request);
            $headerHwid = $request->header('x-hwid');
            if ($headerHwid) {
                $hwid = 'sub-' . substr(hash('sha256', $model->id . '|' . $headerHwid), 0, 40);
            } else {
                $hwid = 'sub-' . substr(hash('sha256', $model->id . '|' . $ua), 0, 40);
            }
            $legacyHwid = 'sub-' . substr(hash('sha256', $model->id . '|' . $ua . '|' . $ip), 0, 40);
            $now = time();
            $device = UserDevice::where('user_id', $model->id)
                ->whereIn('hwid', array_unique([$hwid, $legacyHwid]))
                ->first();

            if (!$device) {
                // Enforce subscription device limit before registering a new device
                $limit = (int)($model->device_limit ?? 0);
                if ($limit > 0) {
                    $activeCount = UserDevice::where('user_id', $model->id)
                        ->where(function ($q) {
                            // Active subscription devices (subscription_seen or paused)
                            $q->where(function ($q2) {
                                $q2->where('node_type', 'subscription')
                                   ->whereIn('status', [
                                       UserDevice::STATUS_SUBSCRIPTION_SEEN,
                                       UserDevice::STATUS_PAUSED,
                                   ]);
                            })
                            // Real HWID devices bound via node (future-proof)
                            ->orWhere(function ($q2) {
                                $q2->where(function ($q3) {
                                        $q3->whereNull('node_type')
                                           ->orWhere('node_type', '<>', 'subscription');
                                    })
                                   ->whereIn('status', [
                                       UserDevice::STATUS_ACTIVE,
                                       UserDevice::STATUS_BANNED,
                                       UserDevice::STATUS_PAUSED,
                                   ]);
                            });
                        })
                        ->count();
                    if ($activeCount >= $limit) {
                        // Not saved to DB — just signals 403 to the caller
                        $over = new UserDevice();
                        $over->status = UserDevice::STATUS_OVER_LIMIT;
                        return $over;
                    }
                }

                $device = new UserDevice();
                $device->user_id = $model->id;
                $device->hwid = $hwid;
                $device->first_seen_at = $now;
                $device->status = UserDevice::STATUS_SUBSCRIPTION_SEEN;
            } elseif ($device->status === UserDevice::STATUS_UNBOUND || $device->status === UserDevice::STATUS_OVER_LIMIT) {
                $device->status = UserDevice::STATUS_SUBSCRIPTION_SEEN;
            }

            if ($device->hwid !== $hwid && !UserDevice::where('user_id', $model->id)->where('hwid', $hwid)->exists()) {
                $device->hwid = $hwid;
            }
            $device->uuid = substr((string)$model->uuid, 0, 64);
            $device->ip = substr($ip, 0, 128);
            $device->real_ip = substr($this->realClientIp($request) ?: $ip, 0, 128);
            $device->ip_source = 'subscribe';
            $device->node_type = 'subscription';
            $device->device_name = substr($this->subscriptionDeviceName($request, $ua), 0, 128);
            $device->platform = substr($this->subscriptionPlatform($ua), 0, 64);
            $device->user_agent = substr($ua, 0, 255);
            $device->last_seen_at = $now;
            $device->save();
            return $device;
        } catch (\Throwable $e) {
            Log::warning('record subscription device failed', [
                'user_id' => $user['id'] ?? null,
                'message' => $e->getMessage()
            ]);
        }
        return null;
    }

    private function isSubscriptionDeviceBlocked($device)
    {
        if (!$device) return false;
        return in_array($device->status, [
            UserDevice::STATUS_PAUSED,
            UserDevice::STATUS_DELETED,
            UserDevice::STATUS_SUBSCRIPTION_BANNED,
            UserDevice::STATUS_OVER_LIMIT,
        ], true);
    }

    private function clientIp(Request $request)
    {
        return (string)($request->ip() ?: $this->realClientIp($request) ?: '0.0.0.0');
    }

    private function realClientIp(Request $request)
    {
        $headers = [
            'CF-Connecting-IP',
            'X-Real-IP',
            'X-Forwarded-For',
            'X-Client-IP'
        ];
        foreach ($headers as $header) {
            $value = $request->headers->get($header);
            if (!$value) continue;
            $ip = trim(explode(',', $value)[0]);
            if ($ip !== '') return $ip;
        }
        return null;
    }

    private function subscriptionDeviceName(Request $request, $ua)
    {
        $reported = $request->input('device_name')
            ?? $request->input('device_model')
            ?? $request->input('model')
            ?? $request->headers->get('X-Device-Name')
            ?? $request->headers->get('X-Device-Model');
        if ($reported) return (string)$reported;

        $lower = strtolower($ua);
        $app = 'Subscription client';
        $appMac = false; // app chỉ chạy trên macOS (suy ra platform)
        if (strpos($lower, 'shadowrocket') !== false) $app = 'Shadowrocket';
        elseif (strpos($lower, 'quantumult') !== false) $app = 'Quantumult X';
        elseif (strpos($lower, 'surge') !== false) $app = 'Surge';
        elseif (strpos($lower, 'loon') !== false) $app = 'Loon';
        elseif (strpos($lower, 'stash') !== false) $app = 'Stash';
        elseif (strpos($lower, 'karing') !== false) $app = 'Karing';
        elseif (strpos($lower, 'flclash') !== false) $app = 'FLClash';
        elseif (strpos($lower, 'hiddify') !== false) $app = 'Hiddify';
        elseif (strpos($lower, 'nekoray') !== false || strpos($lower, 'nekobox') !== false) $app = 'NekoRay';
        elseif (strpos($lower, 'streisand') !== false) $app = 'Streisand';
        // Clash family — phân biệt trước khi rơi vào nhánh 'clash' chung
        elseif (strpos($lower, 'clash-verge') !== false || strpos($lower, 'clash verge') !== false || strpos($lower, 'clashverge') !== false) $app = 'Clash Verge';
        elseif (strpos($lower, 'clashmi') !== false) $app = 'ClashMi';
        elseif (strpos($lower, 'flyclash') !== false) $app = 'FlyClash';
        elseif (strpos($lower, 'clashx meta') !== false || strpos($lower, 'clashx-meta') !== false) { $app = 'ClashX Meta'; $appMac = true; }
        elseif (strpos($lower, 'clashx') !== false) { $app = 'ClashX'; $appMac = true; }
        elseif (strpos($lower, 'mihomo party') !== false) $app = 'Mihomo Party';
        elseif (strpos($lower, 'mihomo') !== false || strpos($lower, 'clash.meta') !== false || strpos($lower, 'clash-meta') !== false) $app = 'Mihomo';
        elseif (strpos($lower, 'clash') !== false) $app = 'Clash';
        elseif (strpos($lower, 'sing-box') !== false || strpos($lower, 'singbox') !== false) $app = 'sing-box';
        elseif (strpos($lower, 'v2rayng') !== false) $app = 'V2RayNG';
        elseif (strpos($lower, 'v2rayn') !== false) $app = 'V2rayN';
        elseif (strpos($lower, 'v2ray') !== false) $app = 'V2Ray';
        elseif (strpos($lower, 'xray') !== false) $app = 'Xray';

        $hardware = $this->subscriptionHardwareLabel($ua);
        if ($hardware) return $app . ' - ' . $hardware;

        $platform = $this->subscriptionPlatform($ua);
        if ($platform === 'Unknown' && $appMac) $platform = 'macOS';
        // Nhiều client desktop (Clash Verge, Mihomo...) không nhúng OS vào UA →
        // chỉ hiển thị tên app, tránh hậu tố "- Unknown" gây khó hiểu.
        return $platform !== 'Unknown' ? $app . ' - ' . $platform : $app;
    }

    private function subscriptionPlatform($ua)
    {
        $lower = strtolower($ua);
        if (strpos($lower, 'ipad') !== false) return 'iPadOS';
        if (strpos($lower, 'iphone') !== false || strpos($lower, 'ios') !== false || strpos($lower, 'shadowrocket') !== false) return 'iOS';
        if (strpos($lower, 'android') !== false) return 'Android';
        if (strpos($lower, 'windows') !== false) return 'Windows';
        if (strpos($lower, 'macintosh') !== false || strpos($lower, 'mac os') !== false) return 'macOS';
        if (strpos($lower, 'linux') !== false) return 'Linux';
        return 'Unknown';
    }

    private function subscriptionHardwareLabel($ua): ?string
    {
        // Darwin-based UA includes hardware identifier at end, e.g.:
        // "Shadowrocket/3082 CFNetwork/3860 Darwin/25.1.0 iPhone17,2"
        // "Surge/5.10 CFNetwork/1490 Darwin/24.0.0 x86_64 (MacBookPro18,3)"
        // Matches iPhone/iPad/iPod/Mac/iMac/MacBook identifiers
        if (preg_match('/\b([A-Za-z]{2,}(?:Pro|Air|mini|Book)?[A-Za-z]*\d+,\d+)\b/', $ua, $m)) {
            $id = $m[1];
            $name = $this->appleModelName($id);
            return $name !== null ? $name : $id;
        }

        // Android standard UA: "Linux; Android 14; Pixel 8 Pro Build/"
        if (preg_match('/;\s*Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/i', $ua, $m)) {
            $model = trim($m[1]);
            if ($model !== '' && !in_array(strtolower($model), ['linux', 'unknown', ''])) {
                // Try Samsung SM-code lookup first
                if (preg_match('/^SM-[A-Z0-9]+$/i', $model)) {
                    $named = $this->samsungModelName($model);
                    if ($named !== null) return $named;
                    return 'Samsung ' . strtoupper($model);
                }
                return ucwords(strtolower($model));
            }
        }

        // Samsung SM-code from elsewhere in UA
        if (preg_match('/\b(SM-[A-Z0-9]+)\b/i', $ua, $m)) {
            $named = $this->samsungModelName($m[1]);
            return $named !== null ? $named : 'Samsung ' . strtoupper($m[1]);
        }

        // Keyword fallback
        $lower = strtolower($ua);
        if (strpos($lower, 'ipad') !== false) return 'iPad';
        if (strpos($lower, 'iphone') !== false) return 'iPhone';
        if (strpos($lower, 'macintosh') !== false || strpos($lower, 'mac os') !== false) return 'Mac';
        if (strpos($lower, 'windows nt') !== false) return 'Windows PC';
        if (strpos($lower, 'samsung') !== false) return 'Samsung';
        if (strpos($lower, 'android') !== false) return 'Android';
        return null;
    }

    private function appleModelName(string $identifier): ?string
    {
        // Built-in map has descriptive names (chip, size). Check it first.
        // For devices not in the built-in list, fall back to the auto-update cache.

        static $builtIn = [
            // ── iPhone 16 series (2024) ──
            'iPhone17,1' => 'iPhone 16 Pro',
            'iPhone17,2' => 'iPhone 16 Pro Max',
            'iPhone17,3' => 'iPhone 16',
            'iPhone17,4' => 'iPhone 16 Plus',
            // ── iPhone 15 series (2023) ──
            'iPhone16,1' => 'iPhone 15 Pro',
            'iPhone16,2' => 'iPhone 15 Pro Max',
            'iPhone15,4' => 'iPhone 15',
            'iPhone15,5' => 'iPhone 15 Plus',
            // ── iPhone 14 series (2022) ──
            'iPhone15,2' => 'iPhone 14 Pro',
            'iPhone15,3' => 'iPhone 14 Pro Max',
            'iPhone14,7' => 'iPhone 14',
            'iPhone14,8' => 'iPhone 14 Plus',
            // ── iPhone SE ──
            'iPhone14,6' => 'iPhone SE (3rd gen)',
            'iPhone12,8' => 'iPhone SE (2nd gen)',
            'iPhone8,4'  => 'iPhone SE (1st gen)',
            // ── iPhone 13 series (2021) ──
            'iPhone14,2' => 'iPhone 13 Pro',
            'iPhone14,3' => 'iPhone 13 Pro Max',
            'iPhone14,4' => 'iPhone 13 mini',
            'iPhone14,5' => 'iPhone 13',
            // ── iPhone 12 series (2020) ──
            'iPhone13,1' => 'iPhone 12 mini',
            'iPhone13,2' => 'iPhone 12',
            'iPhone13,3' => 'iPhone 12 Pro',
            'iPhone13,4' => 'iPhone 12 Pro Max',
            // ── iPhone 11 series (2019) ──
            'iPhone12,1' => 'iPhone 11',
            'iPhone12,3' => 'iPhone 11 Pro',
            'iPhone12,5' => 'iPhone 11 Pro Max',
            // ── iPhone XS / XR (2018) ──
            'iPhone11,2' => 'iPhone XS',
            'iPhone11,4' => 'iPhone XS Max',
            'iPhone11,6' => 'iPhone XS Max',
            'iPhone11,8' => 'iPhone XR',
            // ── iPhone X / 8 / 7 (2016–2017) ──
            'iPhone10,1' => 'iPhone 8',
            'iPhone10,2' => 'iPhone 8 Plus',
            'iPhone10,3' => 'iPhone X',
            'iPhone10,4' => 'iPhone 8',
            'iPhone10,5' => 'iPhone 8 Plus',
            'iPhone10,6' => 'iPhone X',
            'iPhone9,1'  => 'iPhone 7',
            'iPhone9,2'  => 'iPhone 7 Plus',
            'iPhone9,3'  => 'iPhone 7',
            'iPhone9,4'  => 'iPhone 7 Plus',
            // ── iPhone 6s (2015) ──
            'iPhone8,1'  => 'iPhone 6s',
            'iPhone8,2'  => 'iPhone 6s Plus',
            // ── iPhone 6 (2014) ──
            'iPhone7,1'  => 'iPhone 6 Plus',
            'iPhone7,2'  => 'iPhone 6',
            // ── iPhone 5s / 5c / 5 (2012–2013) ──
            'iPhone6,1'  => 'iPhone 5s',
            'iPhone6,2'  => 'iPhone 5s',
            'iPhone5,1'  => 'iPhone 5',
            'iPhone5,2'  => 'iPhone 5',
            'iPhone5,3'  => 'iPhone 5c',
            'iPhone5,4'  => 'iPhone 5c',
            // ── iPhone 4S / 4 (2010–2011) ──
            'iPhone4,1'  => 'iPhone 4S',
            'iPhone3,1'  => 'iPhone 4',
            'iPhone3,2'  => 'iPhone 4',
            'iPhone3,3'  => 'iPhone 4',
            // ── iPad Pro M4 (2024) ──
            'iPad16,3'   => 'iPad Pro 11" M4',
            'iPad16,4'   => 'iPad Pro 11" M4',
            'iPad17,1'   => 'iPad Pro 13" M4',
            'iPad17,2'   => 'iPad Pro 13" M4',
            // ── iPad mini 7 (A17 Pro, 2024) ──
            'iPad17,5'   => 'iPad mini 7',
            'iPad17,6'   => 'iPad mini 7',
            // ── iPad Air M2 (2024) ──
            'iPad14,8'   => 'iPad Air 11" M2',
            'iPad14,9'   => 'iPad Air 11" M2',
            'iPad14,10'  => 'iPad Air 13" M2',
            'iPad14,11'  => 'iPad Air 13" M2',
            // ── iPad Pro M2 (2022) ──
            'iPad14,3'   => 'iPad Pro 11" M2',
            'iPad14,4'   => 'iPad Pro 11" M2',
            'iPad14,5'   => 'iPad Pro 12.9" M2',
            'iPad14,6'   => 'iPad Pro 12.9" M2',
            // ── iPad 10th gen (2022) ──
            'iPad13,18'  => 'iPad (10th gen)',
            'iPad13,19'  => 'iPad (10th gen)',
            // ── iPad Air 5 M1 (2022) ──
            'iPad13,16'  => 'iPad Air (5th gen)',
            'iPad13,17'  => 'iPad Air (5th gen)',
            // ── iPad mini 6 (2021) ──
            'iPad14,1'   => 'iPad mini (6th gen)',
            'iPad14,2'   => 'iPad mini (6th gen)',
            // ── iPad Pro M1 11" / 12.9" (2021) ──
            'iPad13,4'   => 'iPad Pro 11" M1',
            'iPad13,5'   => 'iPad Pro 11" M1',
            'iPad13,6'   => 'iPad Pro 11" M1',
            'iPad13,7'   => 'iPad Pro 11" M1',
            'iPad13,8'   => 'iPad Pro 12.9" M1',
            'iPad13,9'   => 'iPad Pro 12.9" M1',
            'iPad13,10'  => 'iPad Pro 12.9" M1',
            'iPad13,11'  => 'iPad Pro 12.9" M1',
            // ── iPad 9th gen (2021) ──
            'iPad12,1'   => 'iPad (9th gen)',
            'iPad12,2'   => 'iPad (9th gen)',
            // ── iPad Air 4 (2020) ──
            'iPad13,1'   => 'iPad Air (4th gen)',
            'iPad13,2'   => 'iPad Air (4th gen)',
            // ── iPad 8th gen (2020) ──
            'iPad11,6'   => 'iPad (8th gen)',
            'iPad11,7'   => 'iPad (8th gen)',
            // ── iPad Pro 11" 2nd gen (2020) ──
            'iPad8,9'    => 'iPad Pro 11" (2nd gen)',
            'iPad8,10'   => 'iPad Pro 11" (2nd gen)',
            // ── iPad Pro 12.9" 4th gen (2020) ──
            'iPad8,11'   => 'iPad Pro 12.9" (4th gen)',
            'iPad8,12'   => 'iPad Pro 12.9" (4th gen)',
            // ── iPad mini 5 (2019) ──
            'iPad11,1'   => 'iPad mini (5th gen)',
            'iPad11,2'   => 'iPad mini (5th gen)',
            // ── iPad Air 3 (2019) ──
            'iPad11,3'   => 'iPad Air (3rd gen)',
            'iPad11,4'   => 'iPad Air (3rd gen)',
            // ── iPad Pro 11" 1st gen (2018) ──
            'iPad8,1'    => 'iPad Pro 11" (1st gen)',
            'iPad8,2'    => 'iPad Pro 11" (1st gen)',
            'iPad8,3'    => 'iPad Pro 11" (1st gen)',
            'iPad8,4'    => 'iPad Pro 11" (1st gen)',
            // ── iPad Pro 12.9" 3rd gen (2018) ──
            'iPad8,5'    => 'iPad Pro 12.9" (3rd gen)',
            'iPad8,6'    => 'iPad Pro 12.9" (3rd gen)',
            'iPad8,7'    => 'iPad Pro 12.9" (3rd gen)',
            'iPad8,8'    => 'iPad Pro 12.9" (3rd gen)',
            // ── iPad 7th gen (2019) ──
            'iPad7,11'   => 'iPad (7th gen)',
            'iPad7,12'   => 'iPad (7th gen)',
            // ── iPod touch ──
            'iPod9,1'    => 'iPod touch (7th gen)',
            'iPod7,1'    => 'iPod touch (6th gen)',
            // ── MacBook Pro M4 (2024) ──
            'Mac16,1'    => 'MacBook Pro 14" M4',
            'Mac16,2'    => 'MacBook Pro 14" M4 Pro/Max',
            'Mac16,6'    => 'MacBook Pro 16" M4 Pro/Max',
            'Mac16,7'    => 'MacBook Pro 16" M4 Pro',
            // ── MacBook Air M3 (2024) ──
            'Mac14,12'   => 'MacBook Air 13" M3',
            'Mac14,15'   => 'MacBook Air 15" M3',
            // ── MacBook Pro M3 (2023) ──
            'Mac14,5'    => 'MacBook Pro 14" M3 Pro/Max',
            'Mac14,6'    => 'MacBook Pro 16" M3 Pro/Max',
            'Mac14,9'    => 'MacBook Pro 14" M3',
            'Mac14,10'   => 'MacBook Pro 16" M3',
            // ── Mac mini M4 (2024) ──
            'Mac16,10'   => 'Mac mini M4',
            // ── Mac mini M2 (2023) ──
            'Mac14,3'    => 'Mac mini M2',
            'Mac14,4'    => 'Mac mini M2 Pro',
            // ── MacBook Air M2 (2022) ──
            'Mac14,2'    => 'MacBook Air 13" M2',
            'Mac14,13'   => 'MacBook Air 15" M2',
            // ── MacBook Pro M2 13" (2022) ──
            'Mac14,7'    => 'MacBook Pro 13" M2',
            // ── iMac M3 (2023) ──
            'iMac24,1'   => 'iMac 24" M3',
            'iMac24,2'   => 'iMac 24" M3',
            // ── iMac M1 (2021) ──
            'iMac21,1'   => 'iMac 24" M1',
            'iMac21,2'   => 'iMac 24" M1',
            // ── MacBook Pro M1 Pro/Max (2021) ──
            'MacBookPro18,1' => 'MacBook Pro 14" M1 Pro',
            'MacBookPro18,2' => 'MacBook Pro 14" M1 Max',
            'MacBookPro18,3' => 'MacBook Pro 16" M1 Pro',
            'MacBookPro18,4' => 'MacBook Pro 16" M1 Max',
            // ── MacBook Air M1 (2020) ──
            'MacBookAir10,1' => 'MacBook Air M1',
            // ── MacBook Pro M1 13" (2020) ──
            'MacBookPro17,1' => 'MacBook Pro 13" M1',
            // ── Mac Studio (2022–2023) ──
            'Mac13,1'    => 'Mac Studio M1 Max',
            'Mac13,2'    => 'Mac Studio M1 Ultra',
            'Mac14,14'   => 'Mac Studio M2 Max',
            'Mac14,16'   => 'Mac Studio M2 Ultra',
        ];
        if (isset($builtIn[$identifier])) return $builtIn[$identifier];

        // For devices released after this built-in list, use auto-update cache from ipsw.me
        // Run `php artisan device:update-models` to refresh the cache
        static $fileLoaded = false;
        static $fileCache = [];
        if (!$fileLoaded) {
            $fileLoaded = true;
            $f = storage_path('app/device_models_apple.json');
            if (file_exists($f) && is_readable($f)) {
                $decoded = @json_decode(file_get_contents($f), true);
                if (is_array($decoded)) $fileCache = $decoded;
            }
        }
        return $fileCache[$identifier] ?? null;
    }

    private function samsungModelName(string $smCode): ?string
    {
        // Normalize SM-S928B / SM-S928U / SM-S928 → base code S928
        if (!preg_match('/^SM-([A-Z]\d+)/i', $smCode, $m)) return null;
        $base = strtoupper($m[1]);

        static $map = [
            // ── Galaxy S25 series (2025) ──
            'S938' => 'Galaxy S25 Ultra',
            'S936' => 'Galaxy S25+',
            'S931' => 'Galaxy S25',
            // ── Galaxy S24 series (2024) ──
            'S928' => 'Galaxy S24 Ultra',
            'S926' => 'Galaxy S24+',
            'S921' => 'Galaxy S24',
            'S721' => 'Galaxy S24 FE',
            // ── Galaxy S23 series (2023) ──
            'S918' => 'Galaxy S23 Ultra',
            'S916' => 'Galaxy S23+',
            'S911' => 'Galaxy S23',
            'S711' => 'Galaxy S23 FE',
            // ── Galaxy S22 series (2022) ──
            'S908' => 'Galaxy S22 Ultra',
            'S906' => 'Galaxy S22+',
            'S901' => 'Galaxy S22',
            // ── Galaxy S21 series (2021) ──
            'G998' => 'Galaxy S21 Ultra',
            'G996' => 'Galaxy S21+',
            'G991' => 'Galaxy S21',
            'G990' => 'Galaxy S21 FE',
            // ── Galaxy S20 series (2020) ──
            'G988' => 'Galaxy S20 Ultra',
            'G986' => 'Galaxy S20+',
            'G981' => 'Galaxy S20',
            'G780' => 'Galaxy S20 FE',
            // ── Galaxy S10 series (2019) ──
            'G977' => 'Galaxy S10 5G',
            'G975' => 'Galaxy S10+',
            'G973' => 'Galaxy S10',
            'G970' => 'Galaxy S10e',
            // ── Galaxy Z Fold series ──
            'F956' => 'Galaxy Z Fold 6',
            'F946' => 'Galaxy Z Fold 5',
            'F936' => 'Galaxy Z Fold 4',
            'F926' => 'Galaxy Z Fold 3',
            'F916' => 'Galaxy Z Fold 2',
            'F900' => 'Galaxy Fold',
            // ── Galaxy Z Flip series ──
            'F741' => 'Galaxy Z Flip 6',
            'F731' => 'Galaxy Z Flip 5',
            'F721' => 'Galaxy Z Flip 4',
            'F711' => 'Galaxy Z Flip 3',
            'F707' => 'Galaxy Z Flip 5G',
            'F700' => 'Galaxy Z Flip',
            // ── Galaxy Note series ──
            'N986' => 'Galaxy Note 20 Ultra',
            'N981' => 'Galaxy Note 20',
            'N976' => 'Galaxy Note 10+',
            'N975' => 'Galaxy Note 10+ 5G',
            'N971' => 'Galaxy Note 10 5G',
            'N970' => 'Galaxy Note 10',
            'N960' => 'Galaxy Note 9',
            'N950' => 'Galaxy Note 8',
            // ── Galaxy A series (recent) ──
            'A566' => 'Galaxy A56',
            'A556' => 'Galaxy A55',
            'A546' => 'Galaxy A54',
            'A536' => 'Galaxy A53',
            'A528' => 'Galaxy A52s',
            'A526' => 'Galaxy A52',
            'A356' => 'Galaxy A35',
            'A346' => 'Galaxy A34',
            'A336' => 'Galaxy A33',
            'A326' => 'Galaxy A32',
            'A256' => 'Galaxy A25',
            'A236' => 'Galaxy A23',
            'A226' => 'Galaxy A22',
            'A156' => 'Galaxy A15',
            'A135' => 'Galaxy A13',
            'A057' => 'Galaxy A05s',
            'A055' => 'Galaxy A05',
            'A736' => 'Galaxy A73',
            'A725' => 'Galaxy A72',
            'A716' => 'Galaxy A71',
            'A715' => 'Galaxy A71',
            'A536' => 'Galaxy A53',
            // ── Galaxy Tab S series ──
            'X818' => 'Galaxy Tab S10 Ultra',
            'X816' => 'Galaxy Tab S10+',
            'X810' => 'Galaxy Tab S10',
            'X910' => 'Galaxy Tab S9 Ultra',
            'X916' => 'Galaxy Tab S9+',
            'X916' => 'Galaxy Tab S9+',
            'X710' => 'Galaxy Tab S9 FE',
            'X716' => 'Galaxy Tab S9 FE',
            'T870' => 'Galaxy Tab S7',
            'T875' => 'Galaxy Tab S7',
        ];
        return isset($map[$base]) ? 'Samsung ' . $map[$base] : null;
    }

    private function handleExpiredUser($request, $flag, $user, $custom_sni)
    {
    
        $servers = [
            [
                'id' => 9991,
                'name' => 'User ID: ' . $user['id'],
                'type' => 'vmess',
                'host' => 'expired.example.com',
                'port' => 80,
                'server_port' => 80,
                'tls' => 0,
                'network' => 'ws',
                'networkSettings' => [
                    'path' => '/expired',
                    'headers' => [
                        'Host' => 'expired.example.com',
                    ],
                ],
                'show' => 1,
                'is_online' => 1,
            ],
            [
                'id' => 9992,
                'name' => 'Gói của bạn đã hết hạn',
                'type' => 'vmess',
                'host' => 'expired.example.com',
                'port' => 80,
                'server_port' => 80,
                'tls' => 0,
                'network' => 'ws',
                'networkSettings' => [
                    'path' => '/expired',
                    'headers' => [
                        'Host' => 'expired.example.com',
                    ],
                ],
                'show' => 1,
                'is_online' => 1,
            ],
        ];
    
    
        if ($flag) {
            if (!strpos($flag, 'sing')) {
                foreach (array_reverse(glob(app_path('Protocols') . '/*.php')) as $file) {
                    $file = 'App\\Protocols\\' . basename($file, '.php');
                    $class = new $file($user, $servers);
                    if (strpos($flag, $class->flag) !== false) {
                        return $class->handle();
                    }
                }
            }
            if (strpos($flag, 'sing') !== false) {
                $version = null;
                if (preg_match('/sing-box\s+([0-9.]+)/i', $flag, $matches)) {
                    $version = $matches[1];
                }
                if (!is_null($version) && $version >= '1.12.0') {
                    $class = new Singbox($user, $servers);
                } else {
                    $class = new SingboxOld($user, $servers);
                }
                return $class->handle();
            }
        }
        $class = new General($user, $servers);
        return $class->handle();
    }

}
