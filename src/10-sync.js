/* ---------------- 配置云同步（跨子域 / 跨设备） ----------------
 * 背景：超星把考试页分散在 i. / mooc1 / mooc2-ans / passport2 等多个子域，
 * 而且未登录时会 302 到登录域。浏览器存储（localStorage、油猴 GM 存储）**按 origin 隔离**，
 * 所以"设置页配好 → 考试页读到"在纯前端方案里根本不可能成立。
 *
 * 这里走服务端中转（Cloudflare Pages Functions + KV，见 functions/api/sync/[id].js）：
 *   - 配置在浏览器内用随机 128-bit key 做 AES-GCM 加密后才上传，**key 从不上传**（零知识）；
 *   - 服务端只存密文 + HMAC 写权限令牌，因此 KV 泄露也解不开配置；
 *   - 同步码 = "<id>.<key>"，一串 33 个字符，考试页粘贴一次即记住，之后每次打开自动拉取。
 *
 * 对外的五个动作：newCode / syncNow / pull / autoPull / enabled。
 */

CXAI.Sync = (function () {
  const DEFAULT_API = 'https://cx-exam-ai.pages.dev/api/sync';
  const CODE_STORE_KEY = 'syncCode'; // 单独存，不混进配置 JSON
  const STATE_KEY = 'syncState'; // 最近一次同步的结果（成功/失败原因/时间），面板要用它展示失败原因
  const API_STORE_KEY = 'syncAPI'; // 同步服务地址单独存一份（配置被覆盖时也能继续同步）
  const TOKEN_MSG = 'cx-exam-ai:write:v1';

  /* ---------------- 编码 ---------------- */

  function bytesToB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '===='.slice(0, 4 - (s.length % 4)) : '';
    const raw = atob(s + pad);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(String(text));
  }

  function utf8Text(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function rand(n) {
    const out = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
    else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }

  /* ---------------- WebCrypto ---------------- */

  function subtle() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (!c || !c.subtle) throw new Error('当前页面拿不到 crypto.subtle（需要 https 或 localhost）');
    return c.subtle;
  }

  async function aesKey(raw, usage) {
    return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
  }

  async function hmacToken(raw) {
    const k = await subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await subtle().sign('HMAC', k, utf8Bytes(TOKEN_MSG));
    return bytesToB64url(new Uint8Array(sig));
  }

  async function encrypt(rawKey, text) {
    const iv = rand(12);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, await aesKey(rawKey, 'encrypt'), utf8Bytes(text));
    const all = new Uint8Array(iv.length + ct.byteLength);
    all.set(iv, 0);
    all.set(new Uint8Array(ct), iv.length);
    return bytesToB64url(all);
  }

  async function decrypt(rawKey, blob) {
    const all = b64urlToBytes(blob);
    if (all.length < 13) throw new Error('密文长度异常');
    const iv = all.subarray(0, 12);
    const ct = all.subarray(12);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, await aesKey(rawKey, 'decrypt'), ct);
    return utf8Text(new Uint8Array(pt));
  }

  /* ---------------- 同步码 ---------------- */

  function apiBase() {
    // 配置里显式指定优先，同时**另存一份**到独立键：
    // 配置被云端旧版本覆盖 / 被清空时，同步地址不该跟着丢，否则再也拉不回来。
    try {
      const u = CXAI.Cfg.get('ui.syncAPI', '');
      if (u) {
        const v = String(u).replace(/\/+$/, '');
        try {
          CXAI.Store.set(API_STORE_KEY, v);
        } catch (e) {}
        return v;
      }
    } catch (e) {}
    try {
      const saved = CXAI.Store.get(API_STORE_KEY, '');
      if (saved) return String(saved).replace(/\/+$/, '');
    } catch (e) {}
    return DEFAULT_API;
  }

  function savedCode() {
    try {
      return String(CXAI.Store.get(CODE_STORE_KEY, '') || '');
    } catch (e) {
      return '';
    }
  }

  function setCode(code) {
    const v = String(code || '').trim();
    try {
      if (v) CXAI.Store.set(CODE_STORE_KEY, v);
      else CXAI.Store.remove(CODE_STORE_KEY);
    } catch (e) {}
    return v;
  }

  /** 最近一次同步的状态（{ok, at, models, error, code}） */
  function state() {
    try {
      const v = CXAI.Store.get(STATE_KEY, null);
      return v && typeof v === 'object' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function recordState(patch) {
    const next = Object.assign({ at: Date.now() }, state() || {}, patch || {});
    try {
      CXAI.Store.set(STATE_KEY, next);
    } catch (e) {}
    return next;
  }

  function parseCode(code) {
    const m = /^([A-Za-z0-9_-]{6,48})\.([A-Za-z0-9_-]{16,60})$/.exec(String(code || '').trim());
    if (!m) throw new Error('同步码格式不对（应该形如 abc12345.xyz…，中间有个点）');
    return { id: m[1], keyRaw: b64urlToBytes(m[2]) };
  }

  /** 生成一条全新的同步码（id + 16 字节随机密钥） */
  function makeCode() {
    const id = bytesToB64url(rand(8));
    const keyRaw = rand(16);
    return { id: id, keyRaw: keyRaw, code: id + '.' + bytesToB64url(keyRaw) };
  }

  /* ---------------- 网络 ---------------- */

  function request(method, url, headers, body, timeoutMs) {
    // anonymous: 配置同步不需要任何 cookie（跨域 + ACAO:* 时必须是 anonymous，否则被浏览器拦）
    // 注意：GET/HEAD 绝不能带 data —— 传空字符串也会被 fetch 判成 "GET cannot have body"
    const opts = { method: method, url: url, headers: headers || {}, timeout: timeoutMs || 15000, anonymous: true };
    if (body != null && String(method).toUpperCase() !== 'GET' && String(method).toUpperCase() !== 'HEAD') opts.data = body;
    const viaGm = typeof GM_xmlhttpRequest === 'function';
    return new Promise(function (resolve, reject) {
      const onOk = (res) => {
        let data = res.response !== undefined ? res.response : res.responseText;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {}
        }
        if ((res.status || 0) >= 200 && res.status < 300) resolve(data || {});
        else reject(new Error('HTTP ' + res.status + ' ' + ((data && (data.error || data.message)) || '')));
      };
      const onErr = (e) => reject(new Error((e && (e.error || e.message)) || '网络错误'));
      if (viaGm) {
        try {
          GM_xmlhttpRequest({ ...opts, onload: onOk, onerror: onErr, ontimeout: () => reject(new Error('请求超时')) });
        } catch (e) {
          reject(e);
        }
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeout);
      fetch(url, { method: method, headers: headers || {}, body: body == null ? undefined : body, signal: ctrl.signal })
        .then((r) =>
          r.text().then((t) => {
            let d = t;
            try {
              d = JSON.parse(t);
            } catch (e) {}
            if (r.ok) resolve(d || {});
            else reject(new Error('HTTP ' + r.status + ' ' + ((d && (d.error || d.message)) || '')));
          })
        )
        .catch((e) => reject(new Error(e && e.message ? e.message : '网络错误')))
        .finally(() => clearTimeout(timer));
    });
  }

  /* ---------------- 五个动作 ---------------- */

  /** 是否已启用云同步（存过同步码） */
  function enabled() {
    return !!savedCode();
  }

  /** 上传当前配置（覆盖同一 id）；首次调用即绑定写权限 */
  async function push(code, obj) {
    const parsed = parseCode(code);
    const blob = await encrypt(parsed.keyRaw, JSON.stringify(obj || CXAI.Cfg.data || CXAI.Cfg.load()));
    const token = await hmacToken(parsed.keyRaw);
    const base = apiBase();
    const res = await request(
      'PUT',
      base + '/' + encodeURIComponent(parsed.id),
      { 'Content-Type': 'application/json', 'x-cxai-token': token },
      JSON.stringify({ blob: blob })
    );
    return { ok: true, at: (res && res.at) || Date.now(), bytes: blob.length };
  }

  /** 生成并立即上传，返回同步码 */
  async function newCode() {
    const made = makeCode();
    const r = await push(made.code, CXAI.Cfg.data || CXAI.Cfg.load());
    setCode(made.code);
    try {
      CXAI.Cfg.set('ui.syncEnabled', true);
    } catch (e) {}
    CXAI.Log.ok('云同步已开启 · 密文 ' + r.bytes + ' 字符 · 同步码 ' + made.code.slice(0, 8) + '…');
    return made.code;
  }

  /** 用已保存的同步码上传当前配置 */
  async function syncNow(opt) {
    const code = savedCode();
    if (!code) throw new Error('还没开启云同步（先生成同步码）');
    const r = await push(code, CXAI.Cfg.data || CXAI.Cfg.load());
    if (!(opt && opt.silent)) CXAI.Log.ok('配置已同步到云端 · ' + r.bytes + ' 字符');
    return r;
  }

  /** 用同步码拉取并解密（不改本地配置） */
  async function pull(code) {
    const parsed = parseCode(code || savedCode());
    const base = apiBase();
    const res = await request('GET', base + '/' + encodeURIComponent(parsed.id), {}, null);
    if (!res || !res.blob) throw new Error('云端没有这份配置（同步码不对，或已过期）');
    const text = await decrypt(parsed.keyRaw, res.blob);
    let obj = null;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('解密后的配置不是合法 JSON');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('解密结果不是一个配置对象');
    return obj;
  }

  /** 拉取并写入本地（考试页自动同步走这里）；返回是否成功写入 */
  async function pullInto(code) {
    const obj = await pull(code);
    CXAI.Cfg.importJSON(obj);
    if (code) setCode(code);
    recordState({
      ok: true,
      at: Date.now(),
      models: ((obj.ai && obj.ai.providers) || []).length,
      error: '',
      code: String(code || '').slice(0, 8) + '…'
    });
    return obj;
  }

  /**
   * 自动同步（2026-11-18 改语义）：**只要存过同步码就每次都拉**。
   *
   * 旧实现只在"本地一个模型都没有"时才拉，于是设置中心改了判定强度 / 读图模型之后，
   * 考试页永远拿不到新配置 —— 这就是"同步逻辑说不清"的根源。
   * 现在：考试页每次加载脚本都会调 syncBoot()，云端配置以服务端为准覆盖本地。
   * 传 {force:false} 可退回旧行为（本地有配置就不覆盖）。
   */
  async function autoPull(opt) {
    opt = opt || {};
    if (!enabled()) return false;
    // 默认不覆盖本地：本地已有模型时不再 pull（旧实现每次进页都强制覆盖，
    // 考试页面板里改的设置会被云端旧配置冲掉）。需要覆盖时开 ui.forcePull 或传 {force:true}。
    const force = opt.force === true || CXAI.Cfg.get('ui.forcePull', false) === true;
    if (!force && (CXAI.Cfg.get('ai.providers', []) || []).length) return false;
    try {
      const obj = await pullInto(savedCode());
      const n = (obj.ai && obj.ai.providers ? obj.ai.providers.length : 0) || 0;
      CXAI.Log.ok('已从云端同步配置 · 模型 ' + n + ' 个');
      return true;
    } catch (e) {
      recordState({ ok: false, at: Date.now(), error: e && e.message ? e.message : String(e) });
      CXAI.Log.warn('云端同步失败：' + (e && e.message ? e.message : e));
      return false;
    }
  }

  /**
   * 进入考试页时的自动同步：总是拉一次，并把结果（含失败原因）记下来。
   * @returns {Promise<{ok:boolean, models?:number, at?:number, error?:string, skipped?:boolean}>}
   */
  async function syncBoot() {
    const code = savedCode();
    if (!code) {
      return { ok: false, skipped: true, error: '还没有同步码', at: Date.now() };
    }
    // ui.forcePull = false（默认）且本地已有模型时不覆盖：考试页面板里临时改的配置
    // 不该每次进页都被云端旧配置冲掉（2026-11-24 审查 #2：此前这条主路径绕过了 forcePull 开关）
    const force = CXAI.Cfg.get('ui.forcePull', false) === true;
    if (!force && (CXAI.Cfg.get('ai.providers', []) || []).length) {
      return { ok: false, skipped: true, error: '本地已有模型，未覆盖（开 ui.forcePull 可强制拉取）', at: Date.now() };
    }
    const t0 = Date.now();
    try {
      const obj = await pullInto(code);
      const models = ((obj.ai && obj.ai.providers) || []).length;
      recordState({ ok: true, at: Date.now(), models: models, error: '', ms: Date.now() - t0 });
      return { ok: true, models: models, at: Date.now(), ms: Date.now() - t0 };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      recordState({ ok: false, at: Date.now(), models: 0, error: msg, ms: Date.now() - t0 });
      return { ok: false, error: msg, at: Date.now(), ms: Date.now() - t0 };
    }
  }

  /** 停用云同步（本地忘记同步码；云端密文不动） */
  function disable() {
    setCode('');
    try {
      CXAI.Cfg.set('ui.syncEnabled', false);
    } catch (e) {}
  }

  return {
    enabled,
    savedCode,
    setCode,
    disable,
    makeCode,
    newCode,
    syncNow,
    push,
    pull,
    pullInto,
    autoPull,
    syncBoot,
    state,
    recordState,
    apiBase
  };
})();