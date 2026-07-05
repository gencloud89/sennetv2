<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserDevice extends Model
{
    const STATUS_ACTIVE = 'active';
    const STATUS_BANNED = 'banned';
    const STATUS_UNBOUND = 'unbound';
    const STATUS_OVER_LIMIT = 'over_limit';
    const STATUS_SUBSCRIPTION_SEEN = 'subscription_seen';
    const STATUS_SUBSCRIPTION_BANNED = 'subscription_banned';
    const STATUS_PAUSED = 'paused';
    const STATUS_DELETED = 'deleted';

    protected $table = 'v2_user_device';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'first_seen_at' => 'timestamp',
        'last_seen_at' => 'timestamp',
        'banned_at' => 'timestamp',
        'unbound_at' => 'timestamp',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }
}
