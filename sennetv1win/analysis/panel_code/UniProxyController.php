<?php

namespace App\Http\Controllers\V1\Server;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\ServerService;
use App\Services\UserDeviceService;
use App\Services\UserService;
use App\Utils\CacheKey;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use MessagePack\Packer;

class UniProxyController extends Controller
{
    private $nodeType;
    private $nodeInfo;
    private $nodeId;
    private $serverService;

    public function __construct(Request $request)
    {
        $token = $request->input('token');
        if (empty($token)) {
            abort(500, 'token is null');
        }
        if ($token !== config('v2board.server_token')) {
            abort(500, 'token is error');
        }
        $this->nodeType = $request->input('node_type');
        if ($this->nodeType === 'v2ray') $this->nodeType = 'vmess';
        if ($this->nodeType === 'hysteria2') $this->nodeType = 'hysteria';
        $this->nodeId = $request->input('node_id');
        $this->serverService = new ServerService();
        $this->nodeInfo = $this->serverService->getServer($this->nodeId, $this->nodeType);
        if (!$this->nodeInfo) abort(500, 'server is not exist');
    }

    // 后端获取用户
    public function user(Request $request)
    {
        ini_set('memory_limit', -1);
        Cache::put(CacheKey::get('SERVER_' . strtoupper($this->nodeType) . '_LAST_CHECK_AT', $this->nodeInfo->id), time(), 3600);
        $users = $this->serverService->getAvailableUsers($this->nodeInfo->group_id)
            ->map(function ($user) {
                return array_filter($user->toArray(), function ($v) {
                    return !is_null($v);
                });
            })->toArray();

        $response['users'] = $users;
        if (strpos($request->header('X-Response-Format'), 'msgpack') !== false) {
            $packer = new Packer();
            $response = $packer->pack($response);
            $eTag = sha1($response);
            if (strpos($request->header('If-None-Match'), $eTag) !== false) {
                abort(304);
            }

            return response($response, 200, ['Content-Type' => 'application/x-msgpack'])->header('ETag', "\"{$eTag}\"");
        } else {
            $eTag = sha1(json_encode($response));
            if (strpos($request->header('If-None-Match'), $eTag) !== false) {
                abort(304);
            }

            return response($response)->header('ETag', "\"{$eTag}\"");
        }
    }

    // 后端提交数据
    public function push(Request $request)
    {
        $data = $request->json()->all();
        if (empty($data)) {
            $data = $_POST;
        }
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            // JSON decoding error
            return response([
                'error' => 'Invalid traffic data'
            ], 400);
        }
        Cache::put(CacheKey::get('SERVER_' . strtoupper($this->nodeType) . '_ONLINE_USER', $this->nodeInfo->id), count($data), 3600);
        Cache::put(CacheKey::get('SERVER_' . strtoupper($this->nodeType) . '_LAST_PUSH_AT', $this->nodeInfo->id), time(), 3600);
        $userService = new UserService();
        $userService->trafficFetch($this->nodeInfo->toArray(), $this->nodeType, $data);

        return response([
            'data' => true
        ]);
    }

    // 后端获取在线数据
    public function alivelist(Request $request)
    {
        $alive = Cache::remember('ALIVE_LIST', 60, function () {
            $userService = new UserService();
            $users = $userService->getDeviceLimitedUsers();

            if ($users->isEmpty()) {
                return [];
            }

            $keys = [];
            $idMap = [];
            foreach ($users as $user) {
                $key = 'ALIVE_IP_USER_' . $user->id;
                $keys[] = $key;
                $idMap[$key] = $user->id;
            }

            $results = Cache::many($keys);
            $alive = [];
            foreach ($results as $key => $data) {
                if (is_array($data) && isset($data['alive_ip'])) {
                    $alive[$idMap[$key]] = $data['alive_ip'];
                }
            }
            return $alive;
        });
        return response()->json(['alive' => (object)$alive]);
    }

    // 后端提交在线数据
    public function alive(Request $request)
    {
        $data = $request->json()->all();
        if (empty($data)) {
            $data = $_POST;
        }
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            // JSON decoding error
            return response([
                'error' => 'Invalid online data'
            ], 400);
        }
        $updateAt = time();
        $deviceBlocks = $this->handleDeviceReportsFromAlive($data);
        foreach ($data as $uid => $ips) {
            if (is_array($ips) && isset($ips['devices'])) {
                $ips = $ips['ips'] ?? [];
            }
            if (is_array($ips) && isset($ips[0]) && is_array($ips[0])) {
                $ips = array_map(function ($item) {
                    if (isset($item['ip'])) return $item['ip'] . '_' . ($item['node_id'] ?? '');
                    return null;
                }, $ips);
                $ips = array_values(array_filter($ips));
            }
            $ips_array = Cache::get('ALIVE_IP_USER_' . $uid) ?? [];
            // 更新节点数据
            $ips_array[$this->nodeType . $this->nodeId] = ['aliveips' => $ips, 'lastupdateAt' => $updateAt];
            // 清理过期数据
            foreach ($ips_array as $nodetypeid => $oldips) {
                if (!is_int($oldips) && ($updateAt - $oldips['lastupdateAt'] > 100)) {
                    unset($ips_array[$nodetypeid]);
                }
            }
            $count = 0;
            if (config('v2board.device_limit_mode', 0) == 1) {
                $ipmap = [];
                foreach ($ips_array as $nodetypeid => $newdata) {
                    if (!is_int($newdata) && isset($newdata['aliveips'])) {
                        foreach ($newdata['aliveips'] as $ip_NodeId) {
                            $ip = explode("_", $ip_NodeId)[0];
                            $ipmap[$ip] = 1;
                        }
                    }
                }
                $count = count($ipmap);
            } else {
                foreach ($ips_array as $nodetypeid => $newdata) {
                    if (!is_int($newdata) && isset($newdata['aliveips'])) {
                        $count += count($newdata['aliveips']);
                    }
                }
            }
            $ips_array['alive_ip'] = $count;
            Cache::put('ALIVE_IP_USER_' . $uid, $ips_array, 120);
        }

        return response([
            'data' => true,
            'blocked' => $deviceBlocks
        ]);
    }

    public function device(Request $request)
    {
        $data = $request->json()->all();
        if (empty($data)) {
            $data = $_POST;
        }
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            return response(['error' => 'Invalid device data'], 400);
        }

        return response([
            'data' => true,
            'blocked' => $this->handleDeviceReports($this->normalizeDeviceReports($data))
        ]);
    }

    private function handleDeviceReportsFromAlive(array $data)
    {
        $reports = [];
        foreach ($data as $uid => $items) {
            if (is_array($items) && isset($items['devices']) && is_array($items['devices'])) {
                foreach ($items['devices'] as $item) {
                    if (!is_array($item)) continue;
                    $item['user_id'] = $item['user_id'] ?? $uid;
                    $reports[] = $item;
                }
                continue;
            }
            if (!is_array($items)) continue;
            foreach ($items as $item) {
                if (!is_array($item) || empty($item['hwid'])) continue;
                $item['user_id'] = $item['user_id'] ?? $uid;
                $reports[] = $item;
            }
        }
        return $this->handleDeviceReports($this->normalizeDeviceReports($reports));
    }

    private function normalizeDeviceReports(array $data)
    {
        if (isset($data['devices']) && is_array($data['devices'])) {
            $data = $data['devices'];
        }
        if (isset($data['user_id']) || isset($data['uid'])) {
            $data = [$data];
        }

        $reports = [];
        foreach ($data as $uid => $item) {
            if (!is_array($item)) continue;
            $userId = $item['user_id'] ?? $item['uid'] ?? (is_numeric($uid) ? $uid : null);
            if (!$userId || empty($item['hwid'])) continue;
            $realIp = $item['real_ip'] ?? $item['public_ip'] ?? $item['original_ip'] ?? $item['origin_ip'] ?? $item['x_forwarded_for'] ?? null;
            $reports[] = [
                'user_id' => (int)$userId,
                'hwid' => $item['hwid'],
                'ip' => $item['ip'] ?? $item['client_ip'] ?? null,
                'real_ip' => $realIp,
                'ip_source' => $item['ip_source'] ?? ($realIp ? 'client' : 'node'),
                'uuid' => $item['uuid'] ?? null,
                'node_type' => $item['node_type'] ?? $this->nodeType,
                'node_id' => $item['node_id'] ?? $this->nodeId,
                'device_name' => $item['device_name'] ?? $item['device_model'] ?? $item['model'] ?? $item['hostname'] ?? $item['computer_name'] ?? null,
                'platform' => $item['platform'] ?? $item['os'] ?? $item['device_type'] ?? null,
                'user_agent' => $item['user_agent'] ?? $item['ua'] ?? null,
            ];
        }
        return $reports;
    }

    private function handleDeviceReports(array $reports)
    {
        if (empty($reports)) return [];
        $service = new UserDeviceService();
        $users = User::whereIn('id', array_unique(array_column($reports, 'user_id')))->get()->keyBy('id');
        $blocked = [];
        foreach ($reports as $report) {
            if (!isset($users[$report['user_id']])) continue;
            $result = $service->reportDevice(
                $users[$report['user_id']],
                $report['hwid'],
                $report['ip'],
                $report['node_type'],
                $report['node_id'],
                $report['uuid'],
                [
                    'device_name' => $report['device_name'] ?? null,
                    'platform' => $report['platform'] ?? null,
                    'user_agent' => $report['user_agent'] ?? null,
                    'real_ip' => $report['real_ip'] ?? null,
                    'ip_source' => $report['ip_source'] ?? null,
                ]
            );
            if ($result['blocked']) {
                $blocked[] = [
                    'user_id' => (int)$report['user_id'],
                    'hwid' => $report['hwid'],
                    'reason' => $result['reason']
                ];
            }
        }
        return $blocked;
    }

    // 后端获取配置
    public function config(Request $request)
    {
        switch ($this->nodeType) {
            case 'shadowsocks':
                $response = [
                    'server_port' => $this->nodeInfo->server_port,
                    'cipher' => $this->nodeInfo->cipher,
                    'obfs' => $this->nodeInfo->obfs,
                    'obfs_settings' => $this->nodeInfo->obfs_settings
                ];

                if ($this->nodeInfo->cipher === '2022-blake3-aes-128-gcm') {
                    $response['server_key'] = Helper::getServerKey($this->nodeInfo->created_at, 16);
                }
                if ($this->nodeInfo->cipher === '2022-blake3-aes-256-gcm') {
                    $response['server_key'] = Helper::getServerKey($this->nodeInfo->created_at, 32);
                }
                break;
            case 'vmess':
                $response = [
                    'server_port' => $this->nodeInfo->server_port,
                    'network' => $this->nodeInfo->network,
                    'networkSettings' => $this->nodeInfo->networkSettings,
                    'tls' => $this->nodeInfo->tls
                ];
                break;
            case 'vless':
                $response = [
                    'server_port' => $this->nodeInfo->server_port,
                    'network' => $this->nodeInfo->network,
                    'networkSettings' => $this->nodeInfo->network_settings,
                    'tls' => $this->nodeInfo->tls,
                    'flow' => $this->nodeInfo->flow,
                    'tls_settings' => $this->nodeInfo->tls_settings,
                    'encryption' => $this->nodeInfo->encryption,
                    'encryption_settings' => $this->nodeInfo->encryption_settings
                ];
                break;
            case 'trojan':
                $response = [
                    'host' => $this->nodeInfo->host,
                    'network' => $this->nodeInfo->network,
                    'networkSettings' => $this->nodeInfo->network_settings,
                    'server_port' => $this->nodeInfo->server_port,
                    'server_name' => $this->nodeInfo->server_name,
                ];
                break;
            case 'tuic':
                $response = [
                    'server_port' => $this->nodeInfo->server_port,
                    'server_name' => $this->nodeInfo->server_name,
                    'congestion_control' => $this->nodeInfo->congestion_control,
                    'zero_rtt_handshake' => $this->nodeInfo->zero_rtt_handshake ? true : false,
                ];
                break;
            case 'hysteria':
                $response = [
                    'version' => $this->nodeInfo->version,
                    'host' => $this->nodeInfo->host,
                    'server_port' => $this->nodeInfo->server_port,
                    'server_name' => $this->nodeInfo->server_name,
                    'up_mbps' => $this->nodeInfo->up_mbps,
                    'down_mbps' => $this->nodeInfo->down_mbps
                ];
                if ($this->nodeInfo->version == 1) {
                    $response['obfs'] = $this->nodeInfo->obfs_password ?? null;
                } elseif ($this->nodeInfo->version == 2) {
                    if ($this->nodeInfo->up_mbps == 0 && $this->nodeInfo->down_mbps == 0) {
                        $response['ignore_client_bandwidth'] = true;
                    } else {
                        $response['ignore_client_bandwidth'] = false;
                    }
                    $response['obfs'] = $this->nodeInfo->obfs ?? null;
                    $response['obfs-password'] = $this->nodeInfo->obfs_password ?? null;
                }
                break;
            case 'anytls':
                $response = [
                    'server_port' => $this->nodeInfo->server_port,
                    'server_name' => $this->nodeInfo->server_name,
                    'padding_scheme' => $this->nodeInfo->padding_scheme
                ];
                break;
        }
        $response['base_config'] = [
            'push_interval' => (int)config('v2board.server_push_interval', 60),
            'pull_interval' => (int)config('v2board.server_pull_interval', 60)
        ];
        if ($this->nodeInfo['route_id']) {
            $response['routes'] = $this->serverService->getRoutes($this->nodeInfo['route_id']);
        }
        $eTag = sha1(json_encode($response));
        if (strpos($request->header('If-None-Match'), $eTag) !== false) {
            abort(304);
        }

        return response($response)->header('ETag', "\"{$eTag}\"");
    }
}
