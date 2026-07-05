
const AVAILABLE_PRE_PROCESSORS = [
    Base64Encoded()
]

function preprocess(raw) {
    for (const processor of AVAILABLE_PRE_PROCESSORS) {
        try {
            if (processor.test(raw)) {
                return processor.parse(raw);
            }
        } catch (e) {
            console.error(`Parser [${processor.name}] failed\n Reason: ${e}`);
        }
    }
    return raw;
}

function Base64Encoded() {
    const name = "Base64 Pre-processor";

    const keys = ["dm1lc3M", "c3NyOi8v", "dHJvamFu", "c3M6Ly", "c3NkOi8v"];

    const test = function (raw) {
        return keys.some(k => raw.indexOf(k) !== -1);
    }
    const parse = function (raw) {
        const Base64 = new Base64Code();
        raw = Base64.safeDecode(raw);
        return raw;
    }
    return {name, test, parse};
}

function Base64Code() {
    const b64chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const b64tab = (function (bin) {
        const t = {};
        let i = 0;
        const l = bin.length;
        for (; i < l; i++) t[bin.charAt(i)] = i;
        return t;
    })(b64chars);
    const fromCharCode = String.fromCharCode;
    // encoder stuff
    const cb_utob = function (c) {
        let cc;
        if (c.length < 2) {
            cc = c.charCodeAt(0);
            return cc < 0x80
                ? c
                : cc < 0x800
                    ? fromCharCode(0xc0 | (cc >>> 6)) + fromCharCode(0x80 | (cc & 0x3f))
                    : fromCharCode(0xe0 | ((cc >>> 12) & 0x0f)) +
                    fromCharCode(0x80 | ((cc >>> 6) & 0x3f)) +
                    fromCharCode(0x80 | (cc & 0x3f));
        } else {
            cc =
                0x10000 +
                (c.charCodeAt(0) - 0xd800) * 0x400 +
                (c.charCodeAt(1) - 0xdc00);
            return (
                fromCharCode(0xf0 | ((cc >>> 18) & 0x07)) +
                fromCharCode(0x80 | ((cc >>> 12) & 0x3f)) +
                fromCharCode(0x80 | ((cc >>> 6) & 0x3f)) +
                fromCharCode(0x80 | (cc & 0x3f))
            );
        }
    };
    const re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
    const utob = function (u) {
        return u.replace(re_utob, cb_utob);
    };
    const cb_encode = function (ccc) {
        const padlen = [0, 2, 1][ccc.length % 3],
            ord =
                (ccc.charCodeAt(0) << 16) |
                ((ccc.length > 1 ? ccc.charCodeAt(1) : 0) << 8) |
                (ccc.length > 2 ? ccc.charCodeAt(2) : 0),
            chars = [
                b64chars.charAt(ord >>> 18),
                b64chars.charAt((ord >>> 12) & 63),
                padlen >= 2 ? "=" : b64chars.charAt((ord >>> 6) & 63),
                padlen >= 1 ? "=" : b64chars.charAt(ord & 63),
            ];
        return chars.join("");
    };
    const btoa = function (b) {
        return b.replace(/[\s\S]{1,3}/g, cb_encode);
    };
    this.encode = function (u) {
        const isUint8Array =
            Object.prototype.toString.call(u) === "[object Uint8Array]";
        return isUint8Array ? u.toString("base64") : btoa(utob(String(u)));
    };
    const uriencode = function (u, urisafe) {
        return !urisafe
            ? _encode(u)
            : _encode(String(u))
                .replace(/[+\/]/g, function (m0) {
                    return m0 === "+" ? "-" : "_";
                })
                .replace(/=/g, "");
    };
    const encodeURI = function (u) {
        return uriencode(u, true);
    };
    // decoder stuff
    const re_btou = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF7][\x80-\xBF]{3}/g;
    const cb_btou = function (cccc) {
        switch (cccc.length) {
            case 4:
                const cp =
                        ((0x07 & cccc.charCodeAt(0)) << 18) |
                        ((0x3f & cccc.charCodeAt(1)) << 12) |
                        ((0x3f & cccc.charCodeAt(2)) << 6) |
                        (0x3f & cccc.charCodeAt(3)),
                    offset = cp - 0x10000;
                return (
                    fromCharCode((offset >>> 10) + 0xd800) +
                    fromCharCode((offset & 0x3ff) + 0xdc00)
                );
            case 3:
                return fromCharCode(
                    ((0x0f & cccc.charCodeAt(0)) << 12) |
                    ((0x3f & cccc.charCodeAt(1)) << 6) |
                    (0x3f & cccc.charCodeAt(2))
                );
            default:
                return fromCharCode(
                    ((0x1f & cccc.charCodeAt(0)) << 6) | (0x3f & cccc.charCodeAt(1))
                );
        }
    };
    const btou = function (b) {
        return b.replace(re_btou, cb_btou);
    };
    const cb_decode = function (cccc) {
        const len = cccc.length,
            padlen = len % 4,
            n =
                (len > 0 ? b64tab[cccc.charAt(0)] << 18 : 0) |
                (len > 1 ? b64tab[cccc.charAt(1)] << 12 : 0) |
                (len > 2 ? b64tab[cccc.charAt(2)] << 6 : 0) |
                (len > 3 ? b64tab[cccc.charAt(3)] : 0),
            chars = [
                fromCharCode(n >>> 16),
                fromCharCode((n >>> 8) & 0xff),
                fromCharCode(n & 0xff),
            ];
        chars.length -= [0, 0, 2, 1][padlen];
        return chars.join("");
    };
    const _atob = function (a) {
        return a.replace(/\S{1,4}/g, cb_decode);
    };
    const atob = function (a) {
        return _atob(String(a).replace(/[^A-Za-z0-9\+\/]/g, ""));
    };
    const _decode = function (u) {
        return btou(_atob(u));
    };
    this.decode = function (a) {
        return _decode(
            String(a)
                .replace(/[-_]/g, function (m0) {
                    return m0 === "-" ? "+" : "/";
                })
                .replace(/[^A-Za-z0-9\+\/]/g, "")
        )
            .replace(/&gt;/g, ">")
            .replace(/&lt;/g, "<");
    };
    this.safeEncode = function (a) {
        return this.encode(a.replace(/\+/g, "-").replace(/\//g, "_"));
    };
    this.safeDecode = function (a) {
        return this.decode(a.replace(/-/g, "+").replace(/_/g, "/"));
    };
}

let Base64 = new Base64Code()

const AVAILABLE_PARSERS = [
    URI_SS(), URI_SSR(), URI_VMess(), URI_Trojan()
];

function safeMatch(p, line) {
    let patternMatched;
    try {
        patternMatched = p.test(line);
    } catch (err) {
        patternMatched = false;
    }
    return patternMatched;
}

function $parse(raw) {
    // pre-process
    raw = preprocess(raw);
    // parse
    const lines = raw.split("\n");
    const proxies = [];
    let lastParser;

    for (let line of lines) {
        line = line.trim();
        if (line.length === 0) continue; // skip empty line
        let matched = lastParser && safeMatch(lastParser, line);



        if (!matched) {
            for (const parser of AVAILABLE_PARSERS) {
                if (safeMatch(parser, line)) {
                    lastParser = parser;
                    matched = true;
                    break;
                }
            }
        }
        if (!matched) {
            //console.log(`ERROR: Failed to find a rule to parse line: \n${line}\n`);
        } else {

            try {
                const proxy = lastParser.parse(line);
                if (!proxy) {
                    console.log(`ERROR: parser return nothing for \n${line}\n`);
                }
                proxies.push(proxy);
            } catch (err) {
                console.log(
                    `ERROR: Failed to parse line: \n ${line}\n Reason: ${err.stack}`
                );
            }
        }
    }

    return proxies;
}

function URI_SS() {
    const name = 'URI SS Parser';
    const test = (line) => {
        return /^ss:\/\//.test(line);
    };
    const parse = (line) => {
        let content = line.split('ss://')[1];
        const proxy = {
            tag: decodeURIComponent(line.split('#')[1]),
            type: 'shadowsocks',
        }

        content = content.split('#')[0]
        const serverAndPort = content.match(/@([^/]*)(\/|$)/)[1]
        const portIdx = serverAndPort.lastIndexOf(':')
        proxy.server = serverAndPort.substring(0, portIdx)

        proxy.server_port = parseInt(serverAndPort.substring(portIdx + 1))
        const userInfo = Base64.decode(content.split('@')[0]).split(':')
        proxy.method = userInfo[0]
        proxy.password = userInfo[1]

        if(userInfo[0] == "2022-blake3-aes-256-gcm" || userInfo[0] == "2022-blake3-aes-128-gcm") {
            proxy.password = userInfo[1]+":"+userInfo[2]
        }

        const idx = content.indexOf('?plugin=')
        if (idx !== -1) {
            const pluginInfo = (
                'plugin=' +
                decodeURIComponent(content.split('?plugin=')[1].split('&')[0])
            ).split(';');
            const params = {};
            for (const item of pluginInfo) {
                const [key, val] = item.split('=');
                if (key) params[key] = val || true; // some options like "tls" will not have value
            }
            switch (params.plugin) {
                case 'obfs-local':
                    proxy.plugin = 'obfs-local'
                    proxy['plugin_opts'] = "obfs=" + params.obfs + ";obfs-host=" + params['obfs-host']
                    break;
                case 'simple-obfs':
                    proxy.plugin = 'obfs-local'
                    proxy['plugin_opts'] = "obfs=" + params.obfs + ";obfs-host=" + params['obfs-host']
                    break;
                case 'v2ray-plugin':
                    proxy.obfs = 'v2ray-plugin';
                    proxy['plugin_opts'] = {
                        mode: 'websocket',
                        host: params['obfs-host'],
                        path: params.path,
                        tls: params.tls
                    };
                    break;
                default:
                    throw new Error(
                        `Unsupported plugin option: ${params.plugin}`,
                    );
            }
        }
        return proxy;
    };
    return {name, test, parse};
}

function URI_SSR() {
    const name = 'URI SSR Parser';
    const test = (line) => {
        return /^ssr:\/\//.test(line);
    };
    const parse = (line) => {
        line = Base64.decode(line.split('ssr://')[1]);

        // handle IPV6 & IPV4 format
        let splitIdx = line.indexOf(':origin');
        if (splitIdx === -1) {
            splitIdx = line.indexOf(':auth_');
        }
        const serverAndPort = line.substring(0, splitIdx);
        const server = serverAndPort.substring(
            0,
            serverAndPort.lastIndexOf(':'),
        );
        const port = serverAndPort.substring(
            serverAndPort.lastIndexOf(':') + 1,
        );

        let params = line
            .substring(splitIdx + 1)
            .split('/?')[0]
            .split(':');
        let proxy = {
            type: 'ssr',
            server,
            server_port: parseInt(port),
            protocol: params[0],
            method: params[1],
            obfs: params[2],
            password: Base64.decode(params[3]),
        };

        const other_params = {};
        line = line.split('/?')[1].split('&');
        if (line.length > 1) {
            for (const item of line) {
                let [key, val] = item.split('=');
                val = val.trim();
                if (val.length > 0) {
                    other_params[key] = val;
                }
            }
        }
        proxy = {
            ...proxy,
            tag: other_params.remarks
                ? Base64.decode(other_params.remarks)
                : proxy.server,
            'protocol_param':
                Base64.decode(other_params.protoparam || '').replace(/\s/g, '')
            ,
            'obfs_param':
                Base64.decode(other_params.obfsparam || '').replace(/\s/g, '')
            ,
        };
        return proxy;
    };

    return {name, test, parse};
}

function URI_VMess() {
    const name = 'URI VMess Parser';
    const test = (line) => {
        return /^vmess:\/\//.test(line);
    };
    const parse = (line) => {
        line = line.split('vmess://')[1];
        const content = Base64.decode(line);
        const params = JSON.parse(content);

        let proxy = {}

        if (params.net === 'ws') {

            if (proxy.tls && params.host) {
                proxy.sni = params.host;
            }

            proxy = {
                tag: params.ps,
                type: 'vmess',
                server: params.add,
                server_port: parseInt(params.port),
                security: 'auto',
                uuid: params.id,
                alter_id: parseInt(params.aid),
                "tls": {
                    "enabled": params.tls === 'tls' ? true : false,
                    "insecure": false,
                    "server_name": params.host
                },
                "transport": {
                    "type": "ws",
                    "path": params.path,
                    "headers": {
                        "host": params.host
                    },
                    "early_data_header_name": "Sec-WebSocket-Protocol"
                }
            }

        } else {

            proxy = {
                tag: params.ps,
                type: 'vmess',
                server: params.add,
                server_port: parseInt(params.port),
                security: 'auto',
                uuid: params.id,
                alter_id: parseInt(params.aid)
            }
        }

        return proxy;

    };
    return {name, test, parse};
}

function URI_Trojan() {

    const test = (line) => {
        return /^trojan:\/\//.test(line);
    };
    const parse = (line) => {

        line = line.split("trojan://")[1];
        const [server, port] = line.split("@")[1].split("?")[0].split(":");
        const name = decodeURIComponent(line.split("#")[1].trim());
        let params = line.split('?')[1].split('&');
        let pwd = line.split("@")[0]
        let peer, sni = "", plugin, obfs, obfs_host = "", obfs_uri = "", tls = false ,allowInsecure = false;
        var tj = {}

        let result = {};
        params.forEach(item => {
            let [key, value] = item.split('=');
            result[key] = value;
        });

        params.forEach(param => {
            let [key, value] = param.split('=');
            switch (key) {
                case 'peer':
                    peer = value;
                    tls = true

                    if(peer.split('#').length > 1) {
                       sni = peer.split('#')[0]
                    }

                    break;
                case 'sni':
                    sni = value;
                    tls = true
                    break;
                case 'plugin':
                    plugin = value.split(';')[0];
                    break;
                case 'allowInsecure':
                    allowInsecure = true
                    break
            }
        })

        if(params.length > 1) {

            let plugin1 = params[2].split(';');

            if (plugin == "obfs-local") {
                if (plugin1.length > 1) {
                    for (let i = 0; i < plugin1.length; i++) {
                        let item = plugin1[i].split('=');
                        if (item[0] === 'obfs') {
                            obfs = item[1];
                        } else if (item[0] === 'obfs-host') {
                            obfs_host = item[1];
                        } else if (item[0] === 'obfs-uri') {
                            obfs_uri = item[1].split('#')[0];
                        }
                    }
                }
            }

            if (obfs === "websocket") {
                tj = {
                    "type": "trojan",
                    "tag": name,
                    "server": server,
                    "server_port": parseInt(port),
                    "password": pwd,
                    "tls": {
                        "enabled": tls,
                        "server_name": sni,
                        "insecure": allowInsecure
                    },
                    "transport": {
                        "type": "ws",
                        "path": obfs_uri,
                        "headers": {
                            "Host": obfs_host
                        }
                    }
                }
            }
        } else {

            tj = {
                "type": "trojan",
                "tag": name,
                "server": server,
                "server_port": parseInt(port),
                "password": pwd,
                "tls": {
                    "enabled": tls,
                    "server_name": sni,
                    "insecure": allowInsecure
                }
            }

        }


        return tj;
    };
    return {test, parse};
}