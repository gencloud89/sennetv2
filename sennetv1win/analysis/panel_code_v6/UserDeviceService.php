<?php

namespace App\Services;

use App\Models\User;
use App\Models\UserDevice;
use App\Services\TelegramBotActionService;
use App\Services\TelegramService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class UserDeviceService
{
    const ONLINE_WINDOW = 180;

    public function normalizeHwid($hwid)
    {
        $hwid = trim((string)$hwid);
        if ($hwid === '') return null;
        return substr($hwid, 0, 128);
    }

    public function boundStatuses()
    {
        return [UserDevice::STATUS_ACTIVE, UserDevice::STATUS_BANNED, UserDevice::STATUS_PAUSED];
    }

    public function boundCount(int $userId)
    {
        return UserDevice::where('user_id', $userId)
            ->whereIn('status', [UserDevice::STATUS_ACTIVE, UserDevice::STATUS_BANNED, UserDevice::STATUS_PAUSED, UserDevice::STATUS_DELETED, UserDevice::STATUS_SUBSCRIPTION_SEEN, UserDevice::STATUS_SUBSCRIPTION_BANNED, UserDevice::STATUS_OVER_LIMIT])
            ->where(function ($query) {
                $query->whereNull('node_type')
                    ->orWhere('node_type', '<>', 'subscription');
            })
            ->count();
    }

    public function reportDevice(User $user, $hwid, $ip = null, $nodeType = null, $nodeId = null, $uuid = null, array $metadata = [])
    {
        $hwid = $this->normalizeHwid($hwid);
        if (!$hwid) {
            return [
                'accepted' => true,
                'blocked' => false,
                'reason' => null,
                'device' => null
            ];
        }

        return DB::transaction(function () use ($user, $hwid, $ip, $nodeType, $nodeId, $uuid, $metadata) {
            $now = time();
            $limit = (int)($user->device_limit ?: 0);
            $device = UserDevice::where('user_id', $user->id)
                ->where('hwid', $hwid)
                ->lockForUpdate()
                ->first();

            if ($device && $device->status === UserDevice::STATUS_BANNED) {
                $this->touchDevice($device, $ip, $nodeType, $nodeId, $uuid, $metadata, $now);
                return $this->result(false, true, 'banned', $device);
            }

            if ($device && $device->status === UserDevice::STATUS_PAUSED) {
                $this->touchDevice($device, $ip, $nodeType, $nodeId, $uuid, $metadata, $now);
                return $this->result(false, true, 'paused', $device);
            }

            if ($device && $device->status === UserDevice::STATUS_DELETED) {
                $this->touchDevice($device, $ip, $nodeType, $nodeId, $uuid, $metadata, $now);
                return $this->result(false, true, 'deleted', $device);
            }

            if ($device && $device->status === UserDevice::STATUS_ACTIVE) {
                $this->touchDevice($device, $ip, $nodeType, $nodeId, $uuid, $metadata, $now);
                return $this->result(true, false, null, $device);
            }

            $boundCount = $this->boundCount($user->id);
            if ($limit > 0 && $boundCount >= $limit) {
                if (!$device) {
                    $device = new UserDevice();
                    $device->user_id = $user->id;
                    $device->hwid = $hwid;
                    $device->first_seen_at = $now;
                }
                $device->status = UserDevice::STATUS_OVER_LIMIT;
                $device->unbound_at = null;
                $this->touchDevice($device, $ip, $nodeType, $nodeId, $uuid, $metadata, $now);
                $this->notifyDeviceLimit($user, $device);
                return $this->result(false, true, 'over_limit', $device);
            }

            $isNewDevice = !$device || !in_array($device->status, $this->boundStatuses(), true);
            if (!$device) {
                $device = new UserDevice();
                $device->user_id = $user->id;
                $device->hwid = $hwid;
                $device->first_seen_at = $now;
            }
            $device->status = UserDevice::STATUS_ACTIVE;
            $device->banned_at = null;
            $device->unbound_at = null;
            $this->touchDevice($device, $ip, $nodeType, $nodeId, $uuid, $metadata, $now);
            if ($isNewDevice) {
                $this->notifyDeviceChanged($user, $device, 'new_bind');
            }
            return $this->result(true, false, null, $device);
        });
    }

    private function touchDevice(UserDevice $device, $ip, $nodeType, $nodeId, $uuid, array $metadata, $now)
    {
        $device->uuid = $uuid ? substr((string)$uuid, 0, 64) : $device->uuid;
        $device->ip = $ip ? substr((string)$ip, 0, 128) : $device->ip;
        $device->node_type = $nodeType ? substr((string)$nodeType, 0, 32) : $device->node_type;
        $device->node_id = $nodeId ?: $device->node_id;
        $device->device_name = !empty($metadata['device_name']) ? substr((string)$metadata['device_name'], 0, 128) : $device->device_name;
        $device->platform = !empty($metadata['platform']) ? substr((string)$metadata['platform'], 0, 64) : $device->platform;
        $device->user_agent = !empty($metadata['user_agent']) ? substr((string)$metadata['user_agent'], 0, 255) : $device->user_agent;
        $device->real_ip = !empty($metadata['real_ip']) ? substr((string)$metadata['real_ip'], 0, 128) : $device->real_ip;
        $device->ip_source = !empty($metadata['ip_source']) ? substr((string)$metadata['ip_source'], 0, 32) : $device->ip_source;
        $device->last_seen_at = $now;
        $device->save();
    }

    private function result($accepted, $blocked, $reason, UserDevice $device = null)
    {
        return [
            'accepted' => $accepted,
            'blocked' => $blocked,
            'reason' => $reason,
            'device' => $device
        ];
    }

    private function notifyDeviceChanged(User $user, UserDevice $device, string $action)
    {
        if ($this->isSubscriptionDevice($device)) return;
        $key = 'TELEGRAM_DEVICE_CHANGED_' . $user->id . '_' . sha1($device->hwid . '|' . $action);
        if (Cache::has($key)) return;
        try {
            $telegramBot = new TelegramBotActionService(new TelegramService(config('v2board.telegram_admin_bot_token')), 'admin');
            $telegramBot->notifyUserDeviceChanged($user, $device, $action);
            Cache::put($key, 1, 3600);
        } catch (\Exception $e) {
            info('Telegram device changed notification failed', ['user_id' => $user->id, 'device_id' => $device->id, 'error' => $e->getMessage()]);
        }
    }

    private function notifyDeviceLimit(User $user, UserDevice $device)
    {
        $key = 'TELEGRAM_DEVICE_LIMIT_HWID_' . $user->id . '_' . sha1($device->hwid);
        if (Cache::has($key)) return;
        try {
            $telegramBot = new TelegramBotActionService(new TelegramService(config('v2board.telegram_admin_bot_token')), 'admin');
            $detail = "HWID: {$device->hwid}\nGioi han: " . ($user->device_limit ?: 'Khong gioi han');
            $telegramBot->notifyUserDeviceLimit($user, $detail);
            Cache::put($key, 1, 3600);
        } catch (\Exception $e) {
            info('Telegram device limit notification failed', ['user_id' => $user->id, 'device_id' => $device->id, 'error' => $e->getMessage()]);
        }
    }

    public function decorateDevice(UserDevice $device)
    {
        $lastSeen = (int)$device->last_seen_at;
        $device->is_online = $lastSeen > 0 && $lastSeen >= time() - self::ONLINE_WINDOW ? 1 : 0;
        $device->status_text = $this->statusText($device->status);
        return $device;
    }

    public function statusText($status)
    {
        switch ($status) {
            case UserDevice::STATUS_ACTIVE:
                return 'Đã bind';
            case UserDevice::STATUS_BANNED:
                return 'Đã ban';
            case UserDevice::STATUS_OVER_LIMIT:
                return 'Vượt giới hạn';
            case UserDevice::STATUS_UNBOUND:
                return 'Đã gỡ bind';
            case UserDevice::STATUS_SUBSCRIPTION_SEEN:
                return 'Da quet sub';
            case UserDevice::STATUS_SUBSCRIPTION_BANNED:
                return 'Da ban luot quet sub';
            case UserDevice::STATUS_PAUSED:
                return 'Da dung thiet bi';
            case UserDevice::STATUS_DELETED:
                return 'Da xoa thiet bi';
            default:
                return 'Không rõ';
        }
    }

    public function ban(UserDevice $device, $remark = null)
    {
        $device->status = $this->isSubscriptionStatus($device->status)
            ? UserDevice::STATUS_SUBSCRIPTION_BANNED
            : UserDevice::STATUS_BANNED;
        $device->banned_at = time();
        if ($remark !== null) $device->remark = $remark;
        return $device->save();
    }

    public function unban(UserDevice $device)
    {
        $device->status = $device->status === UserDevice::STATUS_SUBSCRIPTION_BANNED
            ? UserDevice::STATUS_SUBSCRIPTION_SEEN
            : UserDevice::STATUS_ACTIVE;
        $device->banned_at = null;
        return $device->save();
    }

    public function unbind(UserDevice $device)
    {
        $device->status = UserDevice::STATUS_UNBOUND;
        $device->unbound_at = time();
        return $device->save();
    }

    public function pause(UserDevice $device)
    {
        $device->status = UserDevice::STATUS_PAUSED;
        $device->banned_at = time();
        return $device->save();
    }

    public function resume(UserDevice $device)
    {
        $device->status = $this->isSubscriptionDevice($device)
            ? UserDevice::STATUS_SUBSCRIPTION_SEEN
            : UserDevice::STATUS_ACTIVE;
        $device->banned_at = null;
        return $device->save();
    }

    public function deleteDevice(UserDevice $device)
    {
        $device->status = UserDevice::STATUS_DELETED;
        $device->unbound_at = time();
        $device->banned_at = time();
        return $device->save();
    }

    public function resetUserDevices(int $userId)
    {
        return UserDevice::where('user_id', $userId)
            ->whereIn('status', [UserDevice::STATUS_ACTIVE, UserDevice::STATUS_BANNED, UserDevice::STATUS_PAUSED, UserDevice::STATUS_DELETED, UserDevice::STATUS_SUBSCRIPTION_SEEN, UserDevice::STATUS_SUBSCRIPTION_BANNED, UserDevice::STATUS_OVER_LIMIT])
            ->update([
                'status' => UserDevice::STATUS_UNBOUND,
                'unbound_at' => time(),
                'updated_at' => time()
            ]);
    }

    public function subscriptionCount(int $userId)
    {
        return UserDevice::where('user_id', $userId)
            ->where(function ($query) {
                $query->whereIn('status', [UserDevice::STATUS_SUBSCRIPTION_SEEN, UserDevice::STATUS_SUBSCRIPTION_BANNED])
                    ->orWhere(function ($builder) {
                        $builder->where('status', UserDevice::STATUS_PAUSED)
                            ->where('node_type', 'subscription');
                    });
            })
            ->count();
    }

    private function isSubscriptionStatus($status)
    {
        return in_array($status, [UserDevice::STATUS_SUBSCRIPTION_SEEN, UserDevice::STATUS_SUBSCRIPTION_BANNED], true);
    }

    private function isSubscriptionDevice(UserDevice $device)
    {
        return $device->node_type === 'subscription' || $this->isSubscriptionStatus($device->status);
    }
}
