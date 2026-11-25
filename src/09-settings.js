/* ---------------- 独立设置中心（网页版配置页） ----------------
 * 考试页里的 ⚙ 面板只有进了考试才点得开，配模型要点几十下、还得先有考试。
 * 这里把同一份 CXAI.Cfg 配置搬到一张独立网页上：
 *   https://cx-exam-ai.pages.dev/settings.html   （或任意部署位 /settings.html）
 * 打开就能像普通网站设置页那样改模型、判题、读图、运行参数、备份、诊断，
 * 改完立刻写回存储，回到 chaoxing.com 的考试页直接生效。
 *
 * 存储关键点：油猴的 GM 存储作用域是「脚本 + 站点」，**不是跨域名共享** ——
 * 设置页（pages.dev）写的配置，考试页（chaoxing.com）读不到同一份。
 * 所以「备份」页提供两条搬运通道：
 *   1) 「同步到学习通」：把整份配置编码进 URL hash（CXAI.cfgCodec），打开学习通后脚本自动落库到那一侧
 *   2) 「复制配置码」/ 导出 JSON：粘到考试页面板的「备份 → 导入」
 * 若管理器连 GM 存储都没有（backend === 'local'），同样走这两条通道。
 *
 * 本模块顶层零副作用：不在设置页时它只是一堆函数，绝不会往考试页插东西。
 */

CXAI.Settings = (function () {
  let host = null;
  let saveTimer = null;
  let mounted = false;
  const S = {
    tab: 'model',
    /** 是否正在走首次向导（进入设置页时由 needWizard() 决定，完成后置 false） */
    wzActive: false,
    /** 每个 provider 卡片是否展开 */
    open: {},
    /** 拉取到的模型清单：provider.id -> [{id,label}] */
    models: {},
    /** 拉取/测试的进行中标记 */
    busy: {},
    /** 诊断输出 */
    diag: null
  };

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return CXAI.U.escapeHtml(s == null ? '' : String(s));
  }

  function q(sel) {
    return host ? host.querySelector(sel) : null;
  }

  function qa(sel) {
    return host ? Array.from(host.querySelectorAll(sel)) : [];
  }

  function storeInfo() {
    try {
      return CXAI.Store.info(CXAI.CONFIG_KEY);
    } catch (e) {
      return { backend: 'mem', scope: '-', bytes: 0, ok: false };
    }
  }

  function backendText() {
    const info = storeInfo();
    if (info.backend === 'gm') return { tag: '油猴存储 · 本域', cls: 'ok', hint: '油猴存储按域名隔离：这份配置只对当前站点生效。到考试页请用「备份 → 同步到学习通」' };
    if (info.backend === 'local') return { tag: '仅本域存储', cls: 'warn', hint: '没有 GM 存储，配置只在本域名有效 —— 用「备份 → 导出」把 JSON 粘到考试页的设置里' };
    return { tag: '内存 · 未持久化', cls: 'bad', hint: '刷新就丢，检查脚本管理器是否禁用了存储' };
  }

  function cfg() {
    if (!CXAI.Cfg.data) CXAI.Cfg.load();
    return CXAI.Cfg.data;
  }

  /** 写盘：合并 300ms 内的连续改动，避免拖一次滑杆写十几次 GM */
  function persist(msg) {
    const ok = CXAI.Cfg.save();
    if (msg !== false) toast(ok === false ? '保存失败：存储被禁用或空间不足' : msg || '已保存', ok === false ? 'bad' : 'ok');
    refreshMeta();
    // 云同步开着：改动 1.2 秒后自动推一份（连续拖滑杆不会打十几条请求）
    try {
      if (CXAI.Sync && CXAI.Sync.enabled && CXAI.Sync.enabled()) {
        clearTimeout(S.syncTimer);
        S.syncTimer = setTimeout(function () {
          CXAI.Sync.syncNow({ silent: true })
            .then(function () {
              const hint = q('#cs-cloudhint');
              if (hint) hint.textContent = '已自动上传 · ' + new Date().toLocaleTimeString();
            })
            .catch(function (e) {
              CXAI.Log.warn('云同步失败：' + (e && e.message ? e.message : e));
            });
        }, 1200);
      }
    } catch (e) {}
    return ok;
  }

  function touch(msg) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(msg), 280);
  }

  function toast(text, kind) {
    const box = q('#cs-toast');
    if (!box) return;
    box.textContent = text;
    box.className = 'cs-toast show ' + (kind || '');
    clearTimeout(box._t);
    box._t = setTimeout(() => {
      box.className = 'cs-toast ' + (kind || '');
    }, 2600);
  }

  /* ---------------- 预设联动 ---------------- */

  /** 反推一个 provider 用的是哪个预设（和 07-ui 里的同名逻辑保持一致） */
  function presetOf(p) {
    const list = presets();
    const norm = (u) => String(u || '').replace(/\/+$/, '').toLowerCase();
    // 先按 Base URL 精确反查：用户改了地址就不再算那个预设
    const hit = list.filter((x) => x.baseURL && norm(x.baseURL) === norm(p && p.baseURL))[0];
    if (hit) return hit.id;
    // 再认存的 preset 字段，但必须是当前仍存在的预设（旧配置里的 magpie / kimi 已删除）
    if (p && p.preset && list.some((x) => x.id === p.preset)) return p.preset;
    return 'custom';
  }

  function presets() {
    return CXAI.PRESETS || [];
  }

  function presetOptions(cur) {
    return presets()
      .map((p) => '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.label) + '</option>')
      .join('');
  }

  function presetById(id) {
    return presets().filter((p) => p.id === id)[0] || null;
  }

  /* ---------------- 页面识别 ---------------- */

  /**
   * 是不是「设置中心」页面。
   * 优先看 <html data-cxai-settings>（settings.html 自带，换域名/换部署位都不用改代码），
   * 其次看路径与查询参数，最后看站点根目录是不是本项目的 Pages 域名。
   */
  function isHere() {
    try {
      const d = document.documentElement;
      if (d && d.hasAttribute && d.hasAttribute('data-cxai-settings')) return true;
      const p = String(location.pathname || '').replace(/\/+$/, '');
      if (/\/settings(\.html)?$/i.test(p)) return true;
      const s = String(location.search || '') + String(location.hash || '');
      if (/[?&#](cxai|settings)=(settings|1)\b/i.test(s)) return true;
      // 只认 /settings 与 /settings.html。
      // 千万别把 "/" 算进来：落地页在根路径，那样会把首页整页接管，
      // 而且设置页上「安装页」的链接指回 / 会变成死循环（v1.8.0 的真 bug）。
      if (/^cx-exam-ai\.pages\.dev$/i.test(location.host) && /^\/settings(\.html)?$/i.test(location.pathname)) return true;
    } catch (e) {}
    return false;
  }

  /** 简单版保留哪几栏；其余只在「高级设置」里出现 */
  const SIMPLE_TABS = ['model', 'judge', 'vision'];

  /** 是否处于高级模式（配置项 ui.advanced，默认关） */
  function advancedOn() {
    try {
      return !!CXAI.Cfg.get('ui.advanced', false);
    } catch (e) {
      return false;
    }
  }

  /**
   * 要不要「开局就是向导」：一个模型都没有，且用户没点过跳过。
   * 只用来决定进入设置页时的初始模式 —— 一旦进了向导就看 S.wzActive，
   * 否则第 1 步提交第一个模型后 providers 非空，第 2/3 步会被直接跳过。
   */
  function needWizard() {
    if ((cfg().ai.providers || []).length) return false;
    try {
      return !CXAI.Cfg.get('ui.onboarded', false);
    } catch (e) {
      return true;
    }
  }

  /**
   * 读图模型下拉：只列真实存在的模型，**不提供"自动挑"**。
   * 原因：脚本没有任何可靠办法判断某家模型到底能不能看图（/models 里不带这个信息），
   * 与其猜错，不如让用户自己指定一个。
   */
  function visionModelOptions() {
    const ps = cfg().ai.providers || [];
    const cur = (cfg().ai.vision || {}).ocrProviderId || '';
    if (!ps.length) return '<option value="">（先在「模型」里加一个）</option>';
    return ps
      .map(
        (p) =>
          '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' +
          esc(p.label || p.model || p.id) + (p.model ? ' · ' + esc(p.model) : '') + '</option>'
      )
      .join('');
  }

  /** 读图模型必须落地成具体 id：空 / 指向已删模型时，落到第一个启用模型 */
  function ensureVisionModel() {
    const c = cfg();
    const v = c.ai.vision || {};
    if (!v.enabled) return;
    const ps = c.ai.providers || [];
    if (!ps.length) return;
    if (v.ocrProviderId && ps.some((p) => p.id === v.ocrProviderId)) return;
    const first = ps.filter((p) => p.enabled !== false)[0] || ps[0];
    v.ocrProviderId = first.id;
    const single = ps.filter((p) => p.enabled !== false).length <= 1;
    if (v.judgeToo || single) {
      v.judgeToo = true;
      first.role = 'both';
    } else {
      first.role = 'vision';
    }
    first.vision = true;
    c.ai.providers = ps.map((x, i) => CXAI.normalizeProvider(x, i));
    touch(false);
  }

  /* ---------------- 样式 ---------------- */

  const CSS = `
.cs-root { text-align:left; --blue:#2563eb; --ink:#111827; --sub:#6b7280; --line:#e5e8ef; --bg:#f6f7fb;
  position:fixed; inset:0; z-index:2147483000; overflow:auto; background:var(--bg); color:var(--ink);
  font:13px/1.55 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.cs-root * { box-sizing:border-box; }
.cs-root a { color:var(--blue); text-decoration:none; }
.cs-root a:hover { text-decoration:underline; }
.cs-root ::-webkit-scrollbar { width:8px; height:8px; }
.cs-root ::-webkit-scrollbar-thumb { background:#ccd2dd; border-radius:8px; }
.cs-root ::-webkit-scrollbar-track { background:transparent; }

.cs-top { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:10px; flex-wrap:wrap; row-gap:8px;
  padding:12px 22px; background:rgba(255,255,255,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
.cs-logo { width:26px; height:26px; border-radius:8px; background:linear-gradient(135deg,#2563eb,#60a5fa);
  color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; letter-spacing:.5px; }
.cs-title { font-size:15px; font-weight:600; white-space:nowrap; }
.cs-title small { font-weight:400; color:var(--sub); font-size:12px; margin-left:8px; }
.cs-top .spacer { flex:1; }
.cs-pill { font-size:11.5px; padding:3px 9px; border-radius:999px; border:1px solid var(--line); color:var(--sub);
  background:#fff; white-space:nowrap; flex:none; }
.cs-pill.ok { color:#15803d; border-color:#bbf7d0; background:#f0fdf4; }
.cs-pill.warn { color:#b45309; border-color:#fde68a; background:#fffbeb; }
.cs-pill.bad { color:#b91c1c; border-color:#fecaca; background:#fef2f2; }

.cs-layout { display:grid; grid-template-columns:190px minmax(0,1fr); gap:22px; max-width:1180px; margin:0 auto; padding:22px; }
.cs-layout.wiz { grid-template-columns:minmax(0,1fr); max-width:860px; }
.cs-nav { position:sticky; top:78px; align-self:start; display:flex; flex-direction:column; gap:2px; }
.cs-nav .hd { font-size:11px; color:#9aa3b2; padding:0 10px 6px; letter-spacing:.4px; }
.cs-nav .it { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:9px; cursor:pointer;
  color:#4b5563; font-size:12.5px; transition:.14s; user-select:none; }
.cs-nav .it .ic { width:16px; text-align:center; color:#9aa3b2; font-size:12px; }
.cs-nav .it:hover { background:#eef1f7; color:#111827; }
.cs-nav .it.on { background:#e8efff; color:var(--blue); font-weight:600; }
.cs-nav .it.on .ic { color:var(--blue); }
.cs-nav .foot { margin-top:14px; padding:10px; font-size:11px; color:#9aa3b2; line-height:1.7; border-top:1px dashed var(--line); }

.cs-main { min-width:0; display:flex; flex-direction:column; gap:16px; padding-bottom:80px; }
.cs-card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px 18px; box-shadow:0 1px 2px rgba(16,24,40,.03); }
.cs-card > h2 { margin:0 0 2px; font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; }
.cs-card > h2 .tag { font-size:11px; font-weight:400; color:var(--sub); }
.cs-card > .desc { font-size:11.5px; color:var(--sub); margin:0 0 14px; line-height:1.7; }
.cs-grid { display:grid; gap:12px; grid-template-columns:repeat(2,minmax(0,1fr)); }
.cs-grid.g3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
@media (max-width: 860px) { .cs-grid, .cs-grid.g3 { grid-template-columns:1fr; } .cs-layout { grid-template-columns:1fr; } .cs-nav { position:static; flex-direction:row; flex-wrap:wrap; } }

.cs-fld { display:flex; flex-direction:column; gap:5px; min-width:0; }
.cs-fld > label { font-size:11.5px; color:#4b5563; font-weight:500; }
.cs-fld .hint { font-size:11px; color:#9aa3b2; line-height:1.5; }
.cs-in, .cs-sel, .cs-ta { width:100%; padding:7px 10px; border:1px solid #dfe3ea; border-radius:9px; background:#fff;
  font:12.5px/1.5 inherit; color:var(--ink); outline:none; transition:.14s; }
.cs-in:focus, .cs-sel:focus, .cs-ta:focus { border-color:#a8c2f7; box-shadow:0 0 0 3px rgba(37,99,235,.1); }
.cs-ta { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; line-height:1.6; resize:vertical; }
.cs-row { display:flex; gap:8px; align-items:center; }
.cs-row > .cs-in { flex:1; min-width:0; }

.cs-btn { padding:7px 13px; border:1px solid #dfe3ea; border-radius:9px; background:#fff; color:#374151;
  font:12.5px/1.4 inherit; cursor:pointer; transition:.14s; white-space:nowrap; }
.cs-btn:hover { border-color:#c3cee0; background:#f8fafc; }
.cs-btn:active { transform:translateY(.5px); }
.cs-btn.pri { background:var(--blue); border-color:var(--blue); color:#fff; font-weight:500; }
.cs-btn.pri:hover { background:#1d4ed8; }
.cs-btn.danger { color:#b91c1c; border-color:#fecaca; background:#fff7f7; }
.cs-btn.danger:hover { background:#fef2f2; }
.cs-btn.mini { padding:4px 9px; font-size:11.5px; border-radius:7px; }
.cs-btn[disabled] { opacity:.55; cursor:not-allowed; }

.cs-chk { display:flex; align-items:center; gap:7px; font-size:12.5px; color:#374151; cursor:pointer; padding:5px 0; }
.cs-chk input { width:14px; height:14px; accent-color:var(--blue); }

/* ---- 模型卡 ---- */
.cs-pv { border:1px solid var(--line); border-radius:12px; margin-bottom:10px; background:#fff; overflow:hidden; transition:.16s; }
.cs-pv.off { opacity:.62; background:#fcfcfd; }
.cs-pv:hover { border-color:#d3dbe8; }
.cs-ph { display:flex; align-items:center; gap:9px; padding:10px 12px; cursor:pointer; user-select:none; }
.cs-ph .dot { width:7px; height:7px; border-radius:50%; background:#cbd5e1; flex:none; }
.cs-pv:not(.off) .dot { background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.14); }
.cs-ph .nm { font-weight:600; font-size:12.5px; color:#374151; flex:none; }
.cs-ph .pm { color:#6b7280; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.cs-ph .chip { font-size:10.5px; padding:1px 7px; border-radius:999px; background:#eef4ff; color:#2563eb; flex:none; }
.cs-ph .chip.v { background:#f5f0ff; color:#7c3aed; }
.cs-ph .del { font-size:11.5px; color:#b91c1c; padding:2px 6px; border-radius:6px; flex:none; }
.cs-ph .del:hover { background:#fef2f2; }
.cs-pb { display:none; padding:0 12px 12px; border-top:1px solid #f1f4f9; }
.cs-pv[data-open="1"] .cs-pb { display:block; }
.cs-pv .cs-grid { margin-top:12px; }

/* ---- 列表 / 输出 ---- */
.cs-added { border:1px solid var(--line); border-radius:11px; overflow:hidden; margin-bottom:14px; background:#fff; }
.cs-added-hd { padding:8px 12px; background:#f7f9fc; border-bottom:1px solid var(--line); font-size:11.5px; color:#6b7280; }
.cs-added-row { display:flex; align-items:center; gap:9px; padding:9px 12px; border-bottom:1px solid #f1f4f9; font-size:12px; }
.cs-added-row:last-child { border-bottom:none; }
.cs-added-row .dot { width:7px; height:7px; border-radius:50%; background:#22c55e; flex:none; }
.cs-added-row .nm { font-weight:600; color:#1f2937; flex:none; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-added-row .md { color:#4b5563; flex:none; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-added-row .bs { color:#9aa3b2; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-added-row .del { color:#b91c1c; font-size:11.5px; cursor:pointer; flex:none; padding:2px 6px; border-radius:6px; }
.cs-added-row .del:hover { background:#fef2f2; }
.cs-sub { font-size:11.5px; color:#9aa3b2; margin:0 0 8px; }
.cs-presets { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
@media (max-width:760px) { .cs-presets { grid-template-columns:repeat(2,minmax(0,1fr)); } }
.cs-pre { display:flex; flex-direction:column; gap:2px; align-items:flex-start; text-align:left;
  padding:10px 12px; border:1px solid var(--line); border-radius:11px; background:#fff; cursor:pointer;
  font:12px/1.5 inherit; transition:.14s; }
.cs-pre:hover { border-color:#a8c2f7; background:#f7faff; transform:translateY(-1px); }
.cs-pre .nm { font-weight:600; color:#1f2937; font-size:12.5px; }
.cs-pre .bd { color:#6b7280; font-size:11.5px; }
.cs-pre .bs { color:#9aa3b2; font-size:10.5px; overflow:hidden; text-overflow:ellipsis; max-width:100%; white-space:nowrap; }
.cs-out { font-family:ui-monospace,Menlo,monospace; font-size:11.5px; line-height:1.7; color:#374151;
  background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:10px 12px; max-height:260px; overflow:auto; }
.cs-out .ok { color:#15803d; }
.cs-out .bad { color:#b91c1c; }
.cs-out .mid { color:#6b7280; }

.cs-toast { position:fixed; right:22px; top:70px; z-index:5; padding:9px 15px; border-radius:10px; background:#111827; color:#fff;
  font-size:12.5px; opacity:0; transform:translateY(-6px); transition:.2s; pointer-events:none; max-width:340px; }
.cs-toast.show { opacity:.95; transform:translateY(0); }
.cs-toast.bad { background:#b91c1c; }
.cs-toast.warn { background:#b45309; }

.cs-note { font-size:11.5px; line-height:1.7; color:#6b7280; background:#f8fafc; border:1px dashed var(--line);
  border-radius:10px; padding:10px 12px; }
.cs-note b { color:#374151; }
.cs-note code, .cs-card code { background:#eef2f9; border:1px solid var(--line); border-radius:4px;
  padding:0 4px; font-family:ui-monospace,Menlo,monospace; font-size:11.5px; color:#334155; }
.cs-steps { display:flex; align-items:center; gap:8px; margin-bottom:16px; font-size:11.5px; color:#9aa3b2; }
.cs-steps .st { display:flex; align-items:center; gap:6px; }
.cs-steps .st b { width:19px; height:19px; border-radius:50%; background:#e5e8ef; color:#6b7280;
  display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; }
.cs-steps .st.on { color:#2563eb; font-weight:600; }
.cs-steps .st.on b { background:var(--blue); color:#fff; }
.cs-steps .st.done b { background:#bbf7d0; color:#15803d; }
.cs-steps .ln { flex:1; height:1px; background:var(--line); min-width:16px; max-width:48px; }
.cs-pre.on { border-color:var(--blue); background:#f2f7ff; box-shadow:0 0 0 2px rgba(37,99,235,.12); }
.cs-pre .go { font-size:10.5px; color:#2563eb; margin-top:2px; }
.cs-choices { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
@media (max-width:760px) { .cs-choices { grid-template-columns:1fr; } }
.cs-choice { text-align:left; padding:12px 14px; border:1px solid var(--line); border-radius:12px;
  background:#fff; cursor:pointer; font:12.5px/1.6 inherit; transition:.14s; }
.cs-choice:hover { border-color:#a8c2f7; background:#f8fbff; }
.cs-choice.on { border-color:var(--blue); background:#f2f7ff; box-shadow:0 0 0 2px rgba(37,99,235,.12); }
.cs-choice b { display:block; font-size:13px; margin-bottom:2px; color:#1f2937; }
.cs-choice span { color:#6b7280; font-size:11.5px; }
.cs-top .adv { border-color:#c7d7f7; color:#2563eb; background:#f2f7ff; }
.cs-top .adv:hover { background:#e8f0ff; border-color:#a8c2f7; }
.cs-kv { display:grid; grid-template-columns:120px minmax(0,1fr); gap:6px 10px; font-size:12px; }
.cs-kv .k { color:#9aa3b2; }
.cs-kv .v { color:#374151; word-break:break-all; }
.cs-line { height:1px; background:var(--line); margin:14px 0; }
`;

  /* ---------------- 顶部 / 导航 ---------------- */

  function topbar() {
    const st = backendText();
    const adv = advancedOn();
    const n = (cfg().ai.providers || []).filter((p) => p.enabled).length;
    return `
<div class="cs-top">
  <div class="cs-logo">CX</div>
  <div class="cs-title">考试 AI 大脑 <small>设置中心</small></div>
  <span class="cs-pill ${st.cls}" id="cs-pill-store" title="${esc(st.hint)}">${esc(st.tag)}</span>
  <span class="cs-pill" id="cs-pill-count">${n} 个已启用模型</span>
  <div class="spacer"></div>
  <button class="cs-btn adv" data-act="sync-top" id="cs-sync-top"
    title="${(CXAI.Sync && CXAI.Sync.enabled && CXAI.Sync.enabled()) ? '把当前配置加密后上传到云端（考试页粘同步码即可自动拉取）' : '生成同步码并把配置加密上传到云端；考试页粘一次码就够'}"
    ${(cfg().ai.providers || []).length ? '' : 'disabled'}>${(CXAI.Sync && CXAI.Sync.enabled && CXAI.Sync.enabled()) ? '上传到云端' : '生成同步码并上传'}</button>
  <button class="cs-btn${adv ? '' : ' adv'}" data-act="toggle-advanced" id="cs-adv"
    title="${adv ? '隐藏权重、温度、阈值、超时等专业项，回到简单设置' : '显示权重、温度、阈值、超时、运行、备份、诊断等专业项'}">${adv ? '切回简单设置' : '高级设置'}</button>
  <a class="cs-btn" href="/" target="_self" title="回到安装 / 说明页">安装页</a>
  <a class="cs-btn" href="https://greasyfork.org/zh-CN/scripts/605687" target="_blank" rel="noopener">检查更新</a>
  <span class="cs-pill" id="cs-pill-ver">v${esc(CXAI.__version)}</span>
</div>`;
  }

  function nav() {
    const all = [
      ['model', '◈', '模型'],
      ['judge', '◉', '判题'],
      ['vision', '▣', '读图'],
      ['run', '▷', '运行'],
      ['backup', '⇅', '备份'],
      ['diag', '◎', '诊断']
    ];
    // 简单版只给三栏：运行 / 备份 / 诊断是排查和搬运用的，普通用户不用看
    const items = advancedOn() ? all : all.filter((x) => SIMPLE_TABS.indexOf(x[0]) >= 0);
    return `
<nav class="cs-nav">
  <div class="hd">配置分类</div>
  ${items
    .map(
      ([id, ic, label]) =>
        `<div class="it${S.tab === id ? ' on' : ''}" data-act="tab" data-tab="${id}"><span class="ic">${ic}</span>${label}</div>`
    )
    .join('')}
  <div class="foot">
    <b>Ctrl+Shift+X</b> 呼出考试面板<br>
    改动即时保存<br>
    <a href="https://github.com/wzj1122/cx-exam-ai" target="_blank" rel="noopener">项目主页</a> ·
    <a href="https://greasyfork.org/zh-CN/scripts/605687" target="_blank" rel="noopener">Greasy Fork</a>
  </div>
</nav>`;
  }
  function refreshMeta() {
    try {
      const st = backendText();
      const pill = q('#cs-pill-store');
      if (pill) {
        pill.className = 'cs-pill ' + st.cls;
        pill.textContent = st.tag;
        pill.title = st.hint;
      }
      const cnt = q('#cs-pill-count');
      if (cnt) cnt.textContent = (cfg().ai.providers || []).filter((p) => p.enabled).length + ' 个已启用模型';
    } catch (e) {}
  }

  /* ---------------- 模型面板 ---------------- */

  function styleLabel(s) {
    return s === 'anthropic' ? 'Anthropic（/v1/messages）' : s === 'gemini' ? 'Gemini（generateContent）' : 'OpenAI 兼容';
  }

  function modelPickerHtml(list, i) {
    if (!list.length) return '<div class="hint">端点没有返回模型清单，手填即可</div>';
    return `<select class="cs-sel" data-act="pick-model" data-i="${i}" style="margin-top:6px">
      <option value="">从拉取到的 ${list.length} 个模型里选…</option>
      ${list.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.label || m.id) + '</option>').join('')}
    </select>`;
  }

  function providerCard(p, i) {
    const adv = advancedOn();
    const pr = presetOf(p);
    const open = S.open[p.id] === undefined ? (adv ? i === 0 : true) : !!S.open[p.id];
    const badge = p.role === 'vision' ? '读图' : p.role === 'both' ? '读图+判题' : '';
    const list = S.models[p.id] || null;
    const busy = S.busy['test' + i] ? ' disabled' : '';
    return `
<div class="cs-pv${p.enabled === false ? ' off' : ''}" data-pv="${i}" data-id="${esc(p.id)}" data-open="${open ? 1 : 0}">
  <div class="cs-ph" data-act="pv-toggle" data-i="${i}">
    <span class="dot"></span>
    <span class="nm">模型 ${i + 1}</span>
    <span class="pm">${esc(p.model || '(未填模型名)')}</span>
    ${badge ? '<span class="chip v">' + badge + '</span>' : ''}
    <span class="chip">${esc(pr)}</span>
    <label class="cs-chk" style="padding:0"><input type="checkbox" data-f="enabled" data-i="${i}"${p.enabled !== false ? ' checked' : ''}>启用</label>
    <span class="del" data-act="pv-del" data-i="${i}">删除</span>
  </div>
  <div class="cs-pb">
    <div class="cs-grid${adv ? ' g3' : ''}">
      <div class="cs-fld"><label>预设</label>
        <select class="cs-sel" data-f="preset" data-i="${i}">${presetOptions(pr)}</select></div>
      ${adv
        ? `<div class="cs-fld"><label>显示名</label>
            <input class="cs-in" data-f="label" data-i="${i}" value="${esc(p.label)}" placeholder="只用于界面显示"></div>
          <div class="cs-fld"><label>权重</label>
            <input class="cs-in" type="number" min="0.1" max="5" step="0.1" data-f="weight" data-i="${i}" value="${p.weight == null ? 1 : p.weight}">
            <div class="hint">越高越容易被选进议会</div></div>`
        : `<div class="cs-fld"><label>&nbsp;</label>
            <div class="hint" style="padding-top:8px">选预设会自动填好地址和模型名，只剩 Key 要你自己填。</div></div>`}
    </div>
    <div class="cs-grid">
      <div class="cs-fld"><label>Base URL</label>
        <input class="cs-in" data-f="baseURL" data-i="${i}" value="${esc(p.baseURL)}" placeholder="https://api.deepseek.com/v1"></div>
      <div class="cs-fld"><label>API Key</label>
        <input class="cs-in" type="password" data-f="apiKey" data-i="${i}" value="${esc(p.apiKey)}" placeholder="本地网关可留空" autocomplete="off"></div>
    </div>
    <div class="cs-grid">
      <div class="cs-fld"><label>模型名</label>
        <div class="cs-row">
          <input class="cs-in" data-f="model" data-i="${i}" value="${esc(p.model)}" placeholder="deepseek-chat / qwen-vl-max …">
          <button class="cs-btn mini" data-act="fetch" data-i="${i}"${busy}>拉取</button>
        </div>
        ${list
          ? modelPickerHtml(list, i)
          : p.model
            ? ''
            : '<div class="hint" style="color:#b45309">还没选模型 —— 填好 Key 后点「拉取」，按清单选一个</div>'}
      </div>
      ${adv
        ? `<div class="cs-fld"><label>接口协议</label>
            <select class="cs-sel" data-f="apiStyle" data-i="${i}">
              ${['openai', 'anthropic', 'gemini']
                .map((st) => '<option value="' + st + '"' + (p.apiStyle === st ? ' selected' : '') + '>' + styleLabel(st) + '</option>')
                .join('')}
            </select>
            <div class="hint">默认 <b>OpenAI</b>（{base}/chat/completions）；只有明确吃 Anthropic 协议的端点才需要改</div></div>`
        : `<div class="cs-fld"><label>连通性</label>
            <button class="cs-btn" data-act="test-one" data-i="${i}"${busy} style="margin-top:6px;align-self:flex-start">测试这个模型</button>
            <span class="hint" data-testout="${i}"></span></div>`}
    </div>
    ${adv
      ? `<div class="cs-grid g3">
          <div class="cs-fld"><label>温度</label>
            <input class="cs-in" type="number" min="0" max="2" step="0.1" data-f="temperature" data-i="${i}" value="${p.temperature == null ? 0.2 : p.temperature}"></div>
          <div class="cs-fld"><label>最大输出 tokens</label>
            <input class="cs-in" type="number" min="64" max="8192" step="64" data-f="maxTokens" data-i="${i}" value="${p.maxTokens == null ? 700 : p.maxTokens}"></div>
          <div class="cs-fld"><label>允许空 Key</label>
            <label class="cs-chk"><input type="checkbox" data-f="keyOptional" data-i="${i}"${p.keyOptional ? ' checked' : ''}>本地网关 / 免鉴权</label></div>
        </div>
        <div class="cs-row" style="margin-top:12px">
          <button class="cs-btn mini" data-act="test-one" data-i="${i}"${busy}>测试这个</button>
          <button class="cs-btn mini" data-act="pv-up" data-i="${i}">上移</button>
          <button class="cs-btn mini" data-act="pv-down" data-i="${i}">下移</button>
          <div style="flex:1"></div>
          <span class="hint" data-testout="${i}"></span>
        </div>`
      : `<div class="cs-row" style="margin-top:10px">
          <button class="cs-btn mini" data-act="pv-up" data-i="${i}">上移</button>
          <button class="cs-btn mini" data-act="pv-down" data-i="${i}">下移</button>
        </div>`}
  </div>
</div>`;
  }
  function emptyState() {
    const QUICK = ['deepseek', 'tokenrhythm', 'qwen-vl', 'qwen', 'glm', 'openai', 'ollama', 'lmstudio', 'custom'];
    const list = presets().filter((p) => QUICK.indexOf(p.id) >= 0);
    return `
  <div class="cs-note" style="margin-bottom:12px">
    <b>还没有配置任何模型。</b>选一个预设就能起步（会填好地址和模型名，只差你自己的 Key）；
    用本地网关（Ollama / LM Studio 等）的话，Key 可以留空，装好就能跑。
  </div>
  <div class="cs-presets">
    ${list
      .map(
        (p) => `<button class="cs-pre" data-act="pv-add-preset" data-preset="${esc(p.id)}" title="${esc(p.baseURL || '')}">
        <span class="nm">${esc(p.label)}</span>
        <span class="bd">${esc(p.model || '（填 Key 后拉取选模型）')}</span>
        <span class="bs">${esc((p.baseURL || '').replace(/^https?:\/\//, '') || '自定义地址')}</span>
      </button>`
      )
      .join('')}
  </div>`;
  }

  function paneModel() {
    const ps = cfg().ai.providers || [];
    return `
<section class="cs-card">
  <h2>模型 <span class="tag">判题与读图都从这里配</span></h2>
  <p class="desc">每个模型 = 一条 OpenAI 兼容端点。填 Base URL + Key + 模型名即可；本地网关（Ollama / LM Studio 等）可以留空 Key。
  点「拉取」会向端点要一遍模型清单，直接选一个填进去，省得手打。</p>
  ${syncBarHtml()}
  <div id="cs-pvbox">${ps.map((p, i) => providerCard(p, i)).join('') || emptyState()}</div>
  <div class="cs-row" style="margin-top:14px">
    <button class="cs-btn pri" data-act="pv-add">+ 空白模型</button>
    <select class="cs-sel" data-act="add-preset-select" style="width:auto;min-width:150px;flex:none">
      <option value="">+ 从预设添加…</option>
      ${presetOptions('')}
    </select>
    <button class="cs-btn" data-act="test-all">测试全部连接</button>
    <button class="cs-btn" data-act="pv-collapse">全部收起</button>
    <div style="flex:1"></div>
    <span class="hint" id="cs-sync-tip">${(cfg().ai.providers || []).length ? '配好后点右上角「生成同步码并上传」，再把它粘到考试页面板里拉一次' : ''}</span>
    <a class="cs-btn" href="https://greasyfork.org/zh-CN/scripts/605687" target="_blank" rel="noopener" title="看各家的 Key 在哪申请">去哪拿 Key？</a>
  </div>
  <div class="cs-out" id="cs-testout" style="display:none;margin-top:12px"></div>
</section>`;
  }

  /* ---------------- 判题面板 ---------------- */

  function strengthNow(j) {
    if (j.mode === 'single') return 'single';
    if (j.mode === 'fast') return 'fast';
    return j.enableArbiter ? 'max' : 'council';
  }

  function paneJudge() {
    const j = cfg().ai.judge || {};
    const st = strengthNow(j);
    const strengthBox = `
      <div class="cs-fld">
        <label>判定强度</label>
        <select class="cs-sel" data-act="strength">
          <option value="single"${st === 'single' ? ' selected' : ''}>省 token · 单模型直接作答</option>
          <option value="fast"${st === 'fast' ? ' selected' : ''}>快速 · 单模型采样 3 次自一致</option>
          <option value="council"${st === 'council' ? ' selected' : ''}>标准 · 多模型议会投票（推荐）</option>
          <option value="max"${st === 'max' ? ' selected' : ''}>严格 · 议会 + 交叉复核 + 仲裁</option>
        </select>
        <div class="hint">改这一项会同时改模式 / 参与模型数 / 复核 / 仲裁</div>
      </div>`;
    if (!advancedOn()) {
      return `
<section class="cs-card">
  <h2>判题 <span class="tag">一道题怎么收敛出一个答案</span></h2>
  <p class="desc">默认「标准」就够用。越往下越准，但也更慢、更费 token。阈值、并发、超时这些去右上角「高级设置」里调。</p>
  ${strengthBox}
  <div class="cs-note" style="margin-top:14px">
    现在有 <b>${(cfg().ai.providers || []).filter((p) => p.enabled !== false).length}</b> 个启用的模型：
    只配一个时「标准」会自动降级成单模型多次采样；配两个以上才是真正的议会投票。
  </div>
</section>`;
    }
    return `
<section class="cs-card">
  <h2>判题 <span class="tag">一道题怎么收敛出一个答案</span></h2>
  <p class="desc">默认「标准」就够用。往下一档更准，但更慢、更费 token。</p>
  <div class="cs-grid">
    <div class="cs-fld">
      <label>判定强度</label>
      <select class="cs-sel" data-act="strength">
        <option value="single"${st === 'single' ? ' selected' : ''}>省 token · 单模型直接作答</option>
        <option value="fast"${st === 'fast' ? ' selected' : ''}>快速 · 单模型采样 3 次自一致</option>
        <option value="council"${st === 'council' ? ' selected' : ''}>标准 · 多模型议会投票（推荐）</option>
        <option value="max"${st === 'max' ? ' selected' : ''}>严格 · 议会 + 交叉复核 + 仲裁</option>
      </select>
      <div class="hint">改这一项会同时改下面的模式 / 参与模型数 / 复核 / 仲裁</div>
    </div>
    <div class="cs-fld">
      <label>判定模式</label>
      <select class="cs-sel" data-path="ai.judge.mode">
        <option value="council"${j.mode === 'council' ? ' selected' : ''}>议会（多模型投票）</option>
        <option value="fast"${j.mode === 'fast' ? ' selected' : ''}>快速（单模型多次采样）</option>
        <option value="single"${j.mode === 'single' ? ' selected' : ''}>单模型</option>
      </select>
      <div class="hint">council 至少要有 2 个启用模型才有意义</div>
    </div>
  </div>
  <div class="cs-grid g3" style="margin-top:12px">
    <div class="cs-fld"><label>参与模型数</label>
      <input class="cs-in" type="number" min="1" max="6" data-path="ai.judge.panelSize" value="${j.panelSize || 3}"></div>
    <div class="cs-fld"><label>一致率阈值</label>
      <input class="cs-in" type="number" min="0.3" max="1" step="0.05" data-path="ai.judge.voteThreshold" value="${j.voteThreshold == null ? 0.7 : j.voteThreshold}">
      <div class="hint">达到就直接采纳，不再升级</div></div>
    <div class="cs-fld"><label>最低置信度</label>
      <input class="cs-in" type="number" min="0" max="1" step="0.05" data-path="ai.judge.minConfidence" value="${j.minConfidence == null ? 0.55 : j.minConfidence}">
      <div class="hint">低于它标黄，仍作答</div></div>
  </div>
  <div class="cs-grid g3" style="margin-top:12px">
    <div class="cs-fld"><label>单题并发</label>
      <input class="cs-in" type="number" min="1" max="6" data-path="ai.judge.concurrency" value="${j.concurrency || 3}"></div>
    <div class="cs-fld"><label>单次超时 (ms)</label>
      <input class="cs-in" type="number" min="5000" max="300000" step="1000" data-path="ai.judge.timeoutMs" value="${j.timeoutMs || 90000}"></div>
    <div class="cs-fld"><label>失败重试</label>
      <input class="cs-in" type="number" min="0" max="5" data-path="ai.judge.retries" value="${j.retries == null ? 1 : j.retries}"></div>
  </div>
  <div class="cs-grid" style="margin-top:12px">
    <label class="cs-chk"><input type="checkbox" data-path="ai.judge.enableCritique"${j.enableCritique ? ' checked' : ''}>交叉复核（Round 2）：让别的模型审阅并改判</label>
    <label class="cs-chk"><input type="checkbox" data-path="ai.judge.enableArbiter"${j.enableArbiter ? ' checked' : ''}>仲裁（Round 3）：分歧时由最高权重模型裁决</label>
  </div>
</section>`;
  }

  /* ---------------- 读图面板 ---------------- */

  function paneVision() {
    const v = cfg().ai.vision || {};
    const ps = (cfg().ai.providers || []).filter((p) => p.enabled !== false);
    const cur = v.ocrProviderId || '';
    const single = ps.length <= 1;
    // 简单版只问四件事：要不要读图 / 怎么读 / 用哪个模型读 / 它要不要一起投票
    if (!advancedOn()) {
      return `
<section class="cs-card">
  <h2>读图 <span class="tag">图片题怎么处理</span></h2>
  <p class="desc">学习通的图片挂在别的域名上，模型厂商的服务器常常拉不到，所以图片由脚本在本地抓下来、压小，再交给你指定的模型。</p>
  <label class="cs-chk" style="margin-bottom:12px"><input type="checkbox" data-path="ai.vision.enabled"${v.enabled ? ' checked' : ''}>处理题目里的图片（关掉后带图的题只按文字判）</label>
  <div class="cs-grid">
    <div class="cs-fld"><label>怎么读</label>
      <select class="cs-sel" data-path="ai.vision.strategy">
        <option value="ocr"${v.strategy === 'ocr' ? ' selected' : ''}>先转成文字再判题（最省 token，推荐）</option>
        <option value="inline"${v.strategy === 'inline' ? ' selected' : ''}>直接把图片发给模型（需要模型能看图）</option>
        <option value="auto"${v.strategy === 'auto' ? ' selected' : ''}>自动：能直传就直传，否则转文字</option>
      </select>
    </div>
    <div class="cs-fld"><label>用哪个模型读图</label>
      <select class="cs-sel" data-path="ai.vision.ocrProviderId">${visionModelOptions()}</select>
      <div class="hint">必须指定一个。脚本判断不了哪家真的能看图，所以由你选。</div>
    </div>
  </div>
  <label class="cs-chk" style="margin-top:10px"><input type="checkbox" data-path="ai.vision.judgeToo"${v.judgeToo ? ' checked' : ''}>这个模型也参与判题${single ? '（只有一条模型，建议勾上）' : ''}</label>
  <div class="cs-note" style="margin-top:14px">
    单题最多处理 <b>${v.maxImages == null ? 6 : v.maxImages}</b> 张图、缩放长边 <b>${v.maxEdge || 1400}px</b>。
    这些在「高级设置」里可调。
  </div>
</section>`;
    }
    return `
<section class="cs-card">
  <h2>读图 <span class="tag">图片题怎么处理</span></h2>
  <p class="desc">学习通的图片挂在 mooc1 上，模型厂商的服务器常常拉不到；这里统一本地抓图 → 缩放压缩 → 要么直传视觉模型，要么先转成文字再判。</p>
  <label class="cs-chk" style="margin-bottom:10px"><input type="checkbox" data-path="ai.vision.enabled"${v.enabled ? ' checked' : ''}>启用读图（关掉后题目图片一律忽略）</label>
  <div class="cs-grid">
    <div class="cs-fld">
      <label>处理策略</label>
      <select class="cs-sel" data-path="ai.vision.strategy">
        <option value="auto"${v.strategy === 'auto' ? ' selected' : ''}>自动：有视觉模型就直传，否则先转文字</option>
        <option value="inline"${v.strategy === 'inline' ? ' selected' : ''}>直传：图片塞给视觉模型</option>
        <option value="ocr"${v.strategy === 'ocr' ? ' selected' : ''}>转写：先读成文字再判（最省 token）</option>
        <option value="off"${v.strategy === 'off' ? ' selected' : ''}>关闭</option>
      </select>
    </div>
    <div class="cs-fld">
      <label>读图模型</label>
      <select class="cs-sel" data-path="ai.vision.ocrProviderId">${visionModelOptions()}</select>
      <div class="hint">必须指定一个（脚本无法判断哪家模型真能看图）。选中后它变成「读图」角色，从判题议会里退出</div>
    </div>
  </div>
  <label class="cs-chk" style="margin-top:10px"><input type="checkbox" data-path="ai.vision.judgeToo"${v.judgeToo ? ' checked' : ''}>读图模型同时参与判题（只配了一个模型时必须勾）</label>
  <div class="cs-line"></div>
  <div class="cs-grid g3">
    <div class="cs-fld"><label>单题最多几张图</label>
      <input class="cs-in" type="number" min="1" max="20" data-path="ai.vision.maxImages" value="${v.maxImages == null ? 6 : v.maxImages}">
      <div class="hint">默认 6；一套卷子图文题多就往上调</div></div>
    <div class="cs-fld"><label>缩放最长边 (px)</label>
      <input class="cs-in" type="number" min="600" max="2400" step="100" data-path="ai.vision.maxEdge" value="${v.maxEdge || 1400}">
      <div class="hint">越小越省 token，1400 基本够看清公式</div></div>
    <div class="cs-fld"><label>JPEG 质量</label>
      <input class="cs-in" type="number" min="0.1" max="1" step="0.02" data-path="ai.vision.quality" value="${v.quality == null ? 0.82 : v.quality}"></div>
  </div>
  <div class="cs-grid g3" style="margin-top:12px">
    <div class="cs-fld"><label>单题图片总大小上限 (MB)</label>
      <input class="cs-in" type="number" min="0.5" max="20" step="0.5" data-path-x="ai.vision.maxTotalBytes" value="${((v.maxTotalBytes || 4194304) / 1048576).toFixed(1)}"></div>
    <div class="cs-fld"><label>拉图超时 (ms)</label>
      <input class="cs-in" type="number" min="3000" max="60000" step="1000" data-path="ai.vision.fetchTimeoutMs" value="${v.fetchTimeoutMs || 15000}"></div>
    <div class="cs-fld"><label>本地缓存条数</label>
      <input class="cs-in" type="number" min="0" max="300" data-path="ai.vision.cacheSize" value="${v.cacheSize == null ? 60 : v.cacheSize}"></div>
  </div>
</section>`;
  }

  /* ---------------- 运行面板 ---------------- */

  function chk(path, on, label, hint) {
    return `<label class="cs-chk" title="${esc(hint || '')}"><input type="checkbox" data-path="${path}"${on ? ' checked' : ''}>${esc(label)}</label>`;
  }

  function num(path, value, min, max, step, label, hint) {
    return `<div class="cs-fld"><label>${esc(label)}</label>
      <input class="cs-in" type="number"${min != null ? ' min="' + min + '"' : ''}${max != null ? ' max="' + max + '"' : ''}${step ? ' step="' + step + '"' : ''} data-path="${path}" value="${esc(value)}">
      ${hint ? '<div class="hint">' + esc(hint) + '</div>' : ''}</div>`;
  }

  function paneRun() {
    const a = cfg().answer || {};
    const g = cfg().guard || {};
    const ap = cfg().apply || {};
    const en = cfg().engine || {};
    return `
<section class="cs-card">
  <h2>运行 <span class="tag">什么时候答、答完做什么</span></h2>
  <p class="desc">这些参数决定脚本在考试页上的动作节奏。不确定就别动，默认值是照「看起来像人在做」调的。</p>

  <div class="cs-grid">
    <div class="cs-fld">
      <label>翻页模式</label>
      <select class="cs-sel" data-path="answer.pageMode">
        <option value="auto"${a.pageMode === 'auto' ? ' selected' : ''}>自动识别</option>
        <option value="whole"${a.pageMode === 'whole' ? ' selected' : ''}>整卷（一页看完全部题）</option>
        <option value="single"${a.pageMode === 'single' ? ' selected' : ''}>单题（一次一题，自动下一题）</option>
      </select>
    </div>
    ${num('answer.intervalMs', a.intervalMs == null ? 900 : a.intervalMs, 0, 20000, 100, '题间间隔 (ms)')}
  </div>
  <div class="cs-grid" style="margin-top:12px">
    ${num('guard.minDelay', g.minDelay == null ? 1400 : g.minDelay, 0, 60000, 100, '题间最短间隔 (ms)')}
    ${num('guard.maxDelay', g.maxDelay == null ? 4200 : g.maxDelay, 0, 120000, 100, '题间最长间隔 (ms)')}
  </div>
  <div class="cs-grid g3" style="margin-top:12px">
    ${num('guard.longBreakEvery', g.longBreakEvery == null ? 6 : g.longBreakEvery, 0, 50, 1, '每 N 题长停顿', '0 = 不停')}
    ${num('guard.dialogDelaySec', g.dialogDelaySec == null ? 10 : g.dialogDelaySec, 0, 120, 1, '弹窗自动关闭 (秒)', '0 = 永不自动关')}
    ${num('engine.maxIterations', en.maxIterations || 200, 10, 2000, 10, '单次最多处理题数')}
  </div>

  <div class="cs-line"></div>
  <div class="cs-grid g3">
    ${chk('ui.showOnly', cfg().ui.showOnly !== false, '仅显示答案（不自动点选）', '默认开：进页判题、右下角答案条展示答案，绝不点击选项；关掉 = 判定后自动点选落盘')}
    ${chk('ui.answerCorner', cfg().ui.answerCorner === true, '右下角答案条', '默认隐藏；勾上后选择题点击跳到该题，填空/简答点击复制答案')}
    ${chk('apply.fixWrong', ap.fixWrong !== false, '已答题答错才重写', '默认开：先判题，与页面答案不一致才重做；关掉 = 已答一律不碰')}
    ${chk('apply.allowGuess', ap.allowGuess === true, '低置信度也写入（不推荐）', '默认关：置信度不足的题只标黄，留给你确认')}
    ${chk('guard.enabled', g.enabled, '环境伪装总开关', '前台保持 + 自动确认弹窗 + 节奏控制')}
    ${chk('guard.autoConfirm', g.autoConfirm !== false, '自动点掉确认弹窗')}
    ${chk('apply.overwriteAnswered', ap.overwriteAnswered, '重做已答题目', '无视页面已有答案，全部重判重写（默认关）')}
    ${chk('apply.saveEach', ap.saveEach, '每题点保存')}
    ${chk('apply.clearExtra', ap.clearExtra !== false, '清掉与答案不符的已选项')}
    ${chk('apply.stopOnFail', ap.stopOnFail !== false, '落盘失败就停下等人处理')}
    ${chk('engine.softNext', en.softNext !== false, '无刷新翻页', '失败自动回退原生翻页')}
    ${chk('engine.prefetch', en.prefetch !== false, '进页面后台预取答案', '点「答一题」时几乎不用等')}
  </div>

  <div class="cs-line"></div>
  <div class="cs-note">
    <b>自动交卷</b>：默认关闭。开启后全部答完会先等 10 秒反悔窗口再点交卷 —— 交卷不可撤销，低置信度的题建议人工过一遍。
    这个开关与考试页面板里的「自动交卷」是同一个（保存时同时写 <code>apply.submit</code> 与 <code>apply.autoSubmit</code>，兼容旧版）。
  </div>
  <div class="cs-grid" style="margin-top:10px">
    ${chk('apply.submit', ap.submit === true || ap.autoSubmit === true, '全部答完后自动交卷（慎用）')}
    ${chk('ui.forcePull', cfg().ui.forcePull === true, '进考试页用云端配置覆盖本地', '默认关：本地改过的设置不会被云端旧配置冲掉')}
  </div>

  <div class="cs-line"></div>
  <div class="cs-grid g3">
    ${num('apply.verifyMs', ap.verifyMs == null ? 1100 : ap.verifyMs, 200, 5000, 100, '点后等选中态 (ms)')}
    ${num('apply.settleMs', ap.settleMs == null ? 900 : ap.settleMs, 0, 5000, 100, '保存后等待 (ms)')}
    ${num('apply.retries', ap.retries == null ? 2 : ap.retries, 0, 5, 1, '落盘失败重试次数')}
    ${num('engine.resumeWindowMin', en.resumeWindowMin || 20, 1, 180, 1, '断点续跑有效期 (分钟)')}
  </div>
  <div class="cs-grid g3" style="margin-top:12px">
    ${num('engine.bootstrapPollMs', en.bootstrapPollMs || 15000, 1000, 60000, 500, '等题块渲染上限 (ms)')}
    ${num('engine.prefetchConcurrency', en.prefetchConcurrency || 4, 1, 8, 1, '预取并发')}
    ${num('engine.prefetchDelayMs', en.prefetchDelayMs == null ? 2000 : en.prefetchDelayMs, 0, 30000, 500, '预取前等待 (ms)')}
  </div>
</section>`;
  }

  /* ---------------- 备份面板 ---------------- */

  /** 模型页顶部的云同步状态条（简单版也看得到，不用进高级） */
  function syncBarHtml() {
    const code = (CXAI.Sync && CXAI.Sync.savedCode) ? CXAI.Sync.savedCode() : '';
    if (!code) {
      return `<div class="cs-note" style="margin-bottom:12px">
        <b>还没开云同步。</b>点右上角「生成同步码并上传」→ 把这串码粘到考试页面板里拉一次，
        之后换子域 / 换设备都自动同步（配置在本地加密后才上传，密钥不上传）。
      </div>`;
    }
    return `<div class="cs-note" style="margin-bottom:12px;border-style:solid;background:#f0f7ff;border-color:#c7d7f7">
      <b>云同步已开启</b> · 同步码
      <code style="font-family:ui-monospace,Menlo,monospace">${esc(code)}</code>
      <span class="cs-row" style="display:inline-flex;gap:6px;margin-left:6px">
        <button class="cs-btn mini" data-act="sync-copy">复制</button>
        <button class="cs-btn mini" data-act="sync-now">立即上传</button>
      </span>
      <div class="hint" style="margin-top:4px">考试页面板里粘这串码拉一次即可；之后每次改配置都会自动上传。别公开这串码 —— 它同时是解密密钥。</div>
    </div>`;
  }

  /** 顶栏云同步按钮：未开启就先生成+上传，已开启就是手动上传一次 */
  async function syncTopClick() {
    const btn = q('#cs-sync-top');
    if (btn) btn.disabled = true;
    try {
      if (CXAI.Sync && CXAI.Sync.enabled && CXAI.Sync.enabled()) {
        const r = await CXAI.Sync.syncNow();
        toast('已上传到云端 · ' + r.bytes + ' 字符', 'ok');
      } else {
        await syncNew();
      }
    } catch (e) {
      toast('失败：' + (e && e.message ? e.message : e), 'bad');
    }
    if (btn) btn.disabled = false;
  }

  /** 备份页里的云同步状态块 */
  function cloudSyncHtml() {
    const code = (CXAI.Sync && CXAI.Sync.savedCode) ? CXAI.Sync.savedCode() : '';
    if (!code) {
      return `
      <div class="cs-row" style="margin-top:10px;flex-wrap:wrap">
        <button class="cs-btn pri" data-act="sync-new">生成同步码并上传</button>
        <span class="hint" id="cs-cloudhint">生成后抄到考试页面板里，粘一次就够</span>
      </div>`;
    }
    return `
    <div class="cs-grid" style="margin-top:10px">
      <div class="cs-fld"><label>同步码（在考试页面板里粘一次）</label>
        <div class="cs-row">
          <input class="cs-in" id="cs-synccode" readonly value="${esc(code)}" style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px">
          <button class="cs-btn mini" data-act="sync-copy">复制</button>
        </div>
        <div class="hint">这串同时是解密密钥 —— 别公开贴出来，别人拿到就能解开你的配置</div></div>
    </div>
    <div class="cs-row" style="margin-top:10px;flex-wrap:wrap">
      <button class="cs-btn pri" data-act="sync-now">立即上传当前配置</button>
      <button class="cs-btn" data-act="sync-pull">从云端拉回（校验）</button>
      <button class="cs-btn" data-act="sync-off">停用云同步</button>
      <span class="hint" id="cs-cloudhint">改动会自动上传</span>
    </div>`;
  }

  async function syncNew() {
    try {
      const code = await CXAI.Sync.newCode();
      renderFrame(); // 顶栏按钮文案 / 状态条 / 备份页一起刷新
      const hint = q('#cs-cloudhint');
      if (hint) hint.textContent = '已上传 · ' + code.slice(0, 8) + '…';
      copyText(code, '同步码已复制 · 粘到考试页面板里拉一次');
      toast('云同步已开启 · 同步码已复制', 'ok');
    } catch (e) {
      toast('生成失败：' + (e && e.message ? e.message : e), 'bad');
    }
  }

  async function syncNowClick() {
    const btn = q('[data-act="sync-now"]');
    if (btn) btn.disabled = true;
    try {
      const r = await CXAI.Sync.syncNow();
      toast('已上传 · ' + r.bytes + ' 字符', 'ok');
    } catch (e) {
      toast('上传失败：' + (e && e.message ? e.message : e), 'bad');
    }
    if (btn) btn.disabled = false;
  }

  async function syncPullClick() {
    try {
      const obj = await CXAI.Sync.pull();
      const n = (obj.ai && obj.ai.providers ? obj.ai.providers.length : 0) || 0;
      toast('云端配置可解密 · 模型 ' + n + ' 个', 'ok');
    } catch (e) {
      toast('拉取失败：' + (e && e.message ? e.message : e), 'bad');
    }
  }

  function syncOffClick() {
    if (!confirm('停用云同步？本机会忘掉同步码，云端密文不会删。')) return;
    CXAI.Sync.disable();
    renderMain();
    toast('已停用云同步', 'ok');
  }

  function paneBackup() {
    const info = storeInfo();
    return `
<section class="cs-card">
  <h2>备份 <span class="tag">换浏览器 / 换域名时搬配置</span></h2>
  <p class="desc">配置里只有模型地址和参数，不含任何账号信息。导出的 JSON 可以直接贴进考试页面板的「设置 → 备份」，也可以用来在另一台电脑上恢复。</p>
  <div class="cs-note" style="margin-bottom:14px">
    <b>云同步（推荐 · 跨子域 / 跨设备）</b>：超星把考试页分散在 i. / mooc2-ans. / passport2. 等多个子域，
    浏览器存储按域隔离，纯前端传不过去。云同步把配置<b>在本地加密后</b>存到 Cloudflare KV（密钥不上传），
    考试页只要填一次同步码，之后每次打开自动拉取。
    ${cloudSyncHtml()}
  </div>
  <div class="cs-row" style="margin-bottom:10px">
    <button class="cs-btn pri" data-act="export-text">导出到下面文本框</button>
    <button class="cs-btn" data-act="download">下载 .json 文件</button>
    <button class="cs-btn" data-act="copy">复制到剪贴板</button>
    <div style="flex:1"></div>
    <label class="cs-btn" style="cursor:pointer">从文件导入<input type="file" accept="application/json,.json" data-act="upload" style="display:none"></label>
  </div>
  <textarea class="cs-ta" id="cs-io" rows="10" placeholder="点「导出到下面文本框」把当前配置变成 JSON；在别的机器上把 JSON 粘进来点「导入」"></textarea>
  <div class="cs-row" style="margin-top:10px">
    <button class="cs-btn" data-act="import-text">导入文本框里的配置</button>
    <button class="cs-btn danger" data-act="reset">恢复默认设置</button>
    <div style="flex:1"></div>
    <span class="hint" id="cs-iohint"></span>
  </div>
  <div class="cs-line"></div>
  <div class="cs-kv">
    <div class="k">存储后端</div><div class="v">${esc(info.backend === 'gm' ? '油猴 GM（按域名隔离）' : info.backend === 'local' ? 'localStorage（仅本域）' : '内存')}</div>
    <div class="k">配置体积</div><div class="v">${info.bytes || 0} 字节</div>
    <div class="k">当前站点</div><div class="v">${esc(location.host || 'file://')}</div>
    <div class="k">存储键</div><div class="v">${esc(CXAI.CONFIG_KEY)}</div>
  </div>
</section>`;
  }

  /* ---------------- 诊断面板 ---------------- */

  function paneDiag() {
    const info = storeInfo();
    const st = backendText();
    const diag = S.diag;
    return `
<section class="cs-card">
  <h2>诊断 <span class="tag">出问题时先看这一页</span></h2>
  <p class="desc">这里的信息和考试页控制台里执行 <code>CXAI.diag()</code> 得到的一致。</p>
  <div class="cs-kv">
    <div class="k">脚本版本</div><div class="v">v${esc(CXAI.__version)} · 构建 ${esc(CXAI.__builtAt || '-')}</div>
    <div class="k">存储</div><div class="v">${esc(st.tag)} · ${info.bytes || 0} 字节 —— ${esc(st.hint)}</div>
    <div class="k">模型</div><div class="v">${(cfg().ai.providers || []).map((p) => esc(p.label || p.model || p.id) + (p.enabled === false ? '(停用)' : '')).join('、') || '未配置'}</div>
    <div class="k">用户脚本管理器</div><div class="v">${esc(detectManager())}</div>
    <div class="k">页面地址</div><div class="v">${esc(location.href)}</div>
  </div>
  <div class="cs-row" style="margin-top:14px">
    <button class="cs-btn pri" data-act="diag">重新采集诊断信息</button>
    <button class="cs-btn" data-act="test-all">测试全部连接</button>
    <button class="cs-btn" data-act="copy-diag">复制诊断信息</button>
  </div>
  <div class="cs-out" id="cs-testout" style="display:none;margin-top:12px"></div>
  <div class="cs-out" id="cs-diagout" style="margin-top:12px">${diag ? esc(diag) : '点上面「重新采集」生成。'}</div>
</section>`;
  }

  function detectManager() {
    try {
      if (typeof GM_info !== 'undefined' && GM_info && GM_info.scriptHandler) {
        return GM_info.scriptHandler + ' ' + (GM_info.version || '');
      }
    } catch (e) {}
    return truthyGM() ? '支持 GM_* 但不报名字' : '无 GM_* 接口（降级 localStorage）';
  }

  function truthyGM() {
    try {
      return typeof GM_getValue === 'function';
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 首次向导（三步） ----------------
   * 一个模型都没有时，不要把六栏设置怼到用户脸上：
   *   ① 选一家 + 填 Key（能顺手测连通）
   *   ② 判题强度（只给四档，内部参数自动换算）
   *   ③ 要不要读图 + 用哪个模型读
   * 完成后写 ui.onboarded=true，进简单版设置页。
   */

  function wizardState() {
    if (!S.wz) {
      S.wz = {
        step: 1,
        pick: '',
        key: '',
        model: '',
        base: '',
        judge: 'council',
        visionOn: true,
        visionId: '',
        strategy: 'ocr',
        out: '',
        testing: false,
        fetching: false,
        list: null
      };
    }
    return S.wz;
  }

  function wizardSteps(step) {
    const names = ['添加模型', '判题强度', '读图'];
    return (
      '<div class="cs-steps">' +
      [1, 2, 3]
        .map((n) => {
          const cls = n === step ? 'on' : n < step ? 'done' : '';
          const dot = '<div class="st ' + cls + '"><b>' + n + '</b>' + names[n - 1] + '</div>';
          return dot + (n < 3 ? '<div class="ln"></div>' : '');
        })
        .join('') +
      '</div>'
    );
  }

  function wizardStep1(w) {
    const QUICK = ['deepseek', 'tokenrhythm', 'qwen-vl', 'qwen', 'glm', 'openai', 'ollama', 'lmstudio', 'custom'];
    const list = presets().filter((p) => QUICK.indexOf(p.id) >= 0);
    const pre = presetById(w.pick);
    const added = cfg().ai.providers || [];
    return `
${wizardSteps(1)}
<section class="cs-card">
  <h2>先加模型 <span class="tag">第 1 步 / 共 3 步 · 可加多个</span></h2>
  <p class="desc">判题时多个模型会各自作答再投票，所以这里可以加好几个：选一家、填 Key、点「添加这个模型」，想加第二个就再选一次。用本地网关（Ollama / LM Studio 等）的话 Key 可以留空。</p>
  ${added.length
      ? `<div class="cs-added">
          <div class="cs-added-hd">已添加 ${added.length} 个模型（判题会一起参与）</div>
          ${added
            .map(
              (p) => `<div class="cs-added-row">
              <span class="dot"></span>
              <span class="nm">${esc(p.label || p.model || p.id)}</span>
              <span class="md">${esc(p.model || '（未选模型）')}</span>
              <span class="bs">${esc(p.baseURL || '')}</span>
              <span class="del" data-act="wz-del" data-id="${esc(p.id)}">删除</span>
            </div>`
            )
            .join('')}
        </div>`
      : ''}
  <div class="cs-sub">${added.length ? '再加一个：' : '选一家：'}</div>
  <div class="cs-presets">
    ${list
      .map(
        (p) => `<button class="cs-pre${w.pick === p.id ? ' on' : ''}" data-act="wz-pick" data-preset="${esc(p.id)}">
        <span class="nm">${esc(p.label)}</span>
        <span class="bd">${esc(p.model || '（填 Key 后拉取选模型）')}</span>
        <span class="bs">${esc(String(p.baseURL || '').replace(/^https?:\/\//, '') || '自定义地址')}</span>
        ${w.pick === p.id ? '<span class="go">已选中 ↓</span>' : ''}
      </button>`
      )
      .join('')}
  </div>
  ${pre
      ? `<div class="cs-grid" style="margin-top:16px">
          ${w.pick === 'custom'
            ? `<div class="cs-fld" style="grid-column:1 / -1"><label>Base URL（必填）</label>
                <input class="cs-in" data-wz="base" value="${esc(w.base)}" placeholder="https://你的端点/v1">
                <div class="hint">默认按 <b>OpenAI 协议</b>发请求（<code>POST {base}/chat/completions</code>）；只吃 Anthropic 协议（<code>/v1/messages</code>）的，走完引导后在高级设置里切「接口协议」。</div></div>`
            : ''}
          <div class="cs-fld"><label>API Key${pre.keyOptional ? '（这家可留空）' : ''}</label>
            <input class="cs-in" type="password" data-wz="key" value="${esc(w.key)}" autocomplete="off"
              placeholder="${pre.keyOptional ? '本地网关随便填，或留空' : 'sk-…'}"></div>
          <div class="cs-fld"><label>模型名</label>
            <div class="cs-row">
              <input class="cs-in" data-wz="model" value="${esc(w.model || pre.model || '')}" placeholder="留空也行，点「拉取」按清单选">
              <button class="cs-btn" data-act="wz-fetch"${w.fetching ? ' disabled' : ''}>${w.fetching ? '拉取中…' : '拉取'}</button>
            </div>
            ${w.list && w.list.length
              ? `<select class="cs-sel" data-act="wz-pick-model" style="margin-top:6px">
                   <option value="">从拉到的 ${w.list.length} 个模型里选…</option>
                   ${w.list.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.label || m.id) + '</option>').join('')}
                 </select>`
              : '<div class="hint">模型名以端点最新返回的清单为准，所以默认不预设</div>'}
          </div>
        </div>
        ${w.pick === 'custom'
          ? ''
          : `<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">地址不对？手动改 Base URL</summary>
              <input class="cs-in" style="margin-top:8px" data-wz="base" value="${esc(w.base || pre.baseURL || '')}">
            </details>`}`
      : '<div class="cs-note" style="margin-top:14px">上面点一家，再填 Key。已经有清单里的模型就直接点「下一步」。</div>'}
  <div class="cs-row" style="margin-top:16px;flex-wrap:wrap">
    <button class="cs-btn" data-act="wz-test"${pre ? '' : ' disabled'}>${w.testing ? '测试中…' : '测试连通'}</button>
    <span class="hint" id="cs-wzout" style="flex:1;min-width:150px">${esc(w.out || '')}</span>
    ${pre ? '<button class="cs-btn pri" data-act="wz-add">+ 添加这个模型</button>' : ''}
    <button class="cs-btn" data-act="wz-skip" title="先跳过引导，直接进设置页">先跳过</button>
    <button class="cs-btn${added.length ? ' pri' : ''}" data-act="wz-next"${added.length || pre ? '' : ' disabled'}>下一步 →</button>
  </div>
</section>`;
  }

  function wizardStep2(w) {
    const opts = [
      ['single', '省 token', '一个模型直接答，最快最便宜'],
      ['fast', '快速', '一个模型连答几次，取一致的'],
      ['council', '标准（推荐）', '多个模型各自答，再投票'],
      ['max', '严格', '投票 + 交叉复核 + 仲裁，最准也最慢']
    ];
    return `
${wizardSteps(2)}
<section class="cs-card">
  <h2>判题要多严格 <span class="tag">第 2 步 / 共 3 步</span></h2>
  <p class="desc">只有一个模型时选「标准」也没问题 —— 脚本会自动降级成单模型多次采样，不会卡住。</p>
  <div class="cs-choices">
    ${opts
      .map(
        ([v, t, d]) =>
          `<button class="cs-choice${w.judge === v ? ' on' : ''}" data-act="wz-judge" data-v="${v}"><b>${t}</b><span>${d}</span></button>`
      )
      .join('')}
  </div>
  <div class="cs-row" style="margin-top:16px">
    <button class="cs-btn" data-act="wz-back">← 上一步</button>
    <div style="flex:1"></div>
    <button class="cs-btn pri" data-act="wz-next">下一步 →</button>
  </div>
</section>`;
  }

  function wizardStep3(w) {
    const ps = cfg().ai.providers || [];
    const opts = ps
      .map(
        (p) =>
          '<option value="' + esc(p.id) + '"' + ((w.visionId || (ps[0] || {}).id) === p.id ? ' selected' : '') + '>' +
          esc(p.label || p.model || p.id) + (p.model ? ' · ' + esc(p.model) : '') + '</option>'
      )
      .join('');
    return `
${wizardSteps(3)}
<section class="cs-card">
  <h2>要不要处理图片题 <span class="tag">第 3 步 / 共 3 步</span></h2>
  <p class="desc">卷子里有图片题才会用到。给一个能看图的模型（例如 qwen-vl-max / gpt-4o）；只有一个模型时它自己读、自己判。</p>
  <label class="cs-chk" style="margin-bottom:12px"><input type="checkbox" data-wz="visionOn"${w.visionOn ? ' checked' : ''}>处理题目里的图片</label>
  ${w.visionOn
      ? `<div class="cs-grid">
          <div class="cs-fld"><label>用哪个模型读图</label>
            <select class="cs-sel" data-wz="visionId">${opts || '<option value="">（还没有模型）</option>'}</select>
            <div class="hint">必须选一个 —— 脚本判断不了哪家模型真能看图，所以由你指定</div></div>
          <div class="cs-fld"><label>怎么读</label>
            <select class="cs-sel" data-wz="strategy">
              <option value="ocr"${w.strategy === 'ocr' ? ' selected' : ''}>先转成文字再判题（推荐）</option>
              <option value="inline"${w.strategy === 'inline' ? ' selected' : ''}>直接把图片发给模型</option>
              <option value="auto"${w.strategy === 'auto' ? ' selected' : ''}>自动：能直传就直传</option>
            </select></div>
        </div>`
      : '<div class="cs-note">关掉后带图的题只按文字判，图片会被忽略。</div>'}
  <div class="cs-row" style="margin-top:16px">
    <button class="cs-btn" data-act="wz-back">← 上一步</button>
    <div style="flex:1"></div>
    <button class="cs-btn pri" data-act="wz-done">完成，开始用 →</button>
  </div>
</section>`;
  }

  function wizardHtml() {
    const w = wizardState();
    return w.step === 2 ? wizardStep2(w) : w.step === 3 ? wizardStep3(w) : wizardStep1(w);
  }

  /** 重建整页（切简单/高级、向导换步都走它） */
  function renderFrame() {
    if (!host) return;
    host.innerHTML = frame();
    renderMain();
  }

  const STRENGTH_MAP = {
    single: { mode: 'single', panelSize: 1, enableCritique: false, enableArbiter: false },
    fast: { mode: 'fast', panelSize: 1, enableCritique: false, enableArbiter: false },
    council: { mode: 'council', panelSize: 3, enableCritique: true, enableArbiter: false },
    max: { mode: 'council', panelSize: 3, enableCritique: true, enableArbiter: true }
  };

  /** 向导第 1 步 → 第 2 步：校验并真正写入这个 provider */
  function wizardCommitProvider() {
    const w = wizardState();
    const pre = presetById(w.pick);
    if (!pre) return { ok: false, msg: '先点一家模型' };
    const base = String(w.base || pre.baseURL || '').trim();
    const model = String(w.model || pre.model || '').trim();
    const key = String(w.key || '').trim();
    if (!base) return { ok: false, msg: 'Base URL 是空的' };
    if (!model) return { ok: false, msg: '还没有模型名：点「拉取」选一个，或直接手填' };
    if (!key && !pre.keyOptional && !CXAI.isLocalURL(base)) return { ok: false, msg: '这家需要填 API Key' };
    const c = cfg();
    const list = c.ai.providers || [];
    const fresh = CXAI.normalizeProvider(
      {
        id: CXAI.U.uid('p'),
        label: pre.label,
        preset: pre.id,
        baseURL: base,
        model: model,
        apiStyle: pre.id === 'custom' ? 'openai' : pre.apiStyle || 'openai',
        apiKey: key,
        weight: 1,
        temperature: 0.2,
        maxTokens: 700,
        enabled: true,
        vision: !!pre.vision,
        keyOptional: !!pre.keyOptional || CXAI.isLocalURL(base),
        role: 'judge'
      },
      list.length
    );
    list.push(fresh);
    c.ai.providers = list;
    // 读图模型默认取「第一个模型」；只有当后加的这家预设本身带视觉能力时，才改用新的这个
    if (!w.visionId || pre.vision) w.visionId = fresh.id;
    CXAI.Cfg.save();
    return { ok: true, provider: fresh };
  }

  /** 向导完成：把判题 / 读图一次性写进配置 */
  function wizardDone() {
    const w = wizardState();
    const c = cfg();
    const m = STRENGTH_MAP[w.judge] || STRENGTH_MAP.council;
    Object.keys(m).forEach((k) => (c.ai.judge[k] = m[k]));

    const ps = c.ai.providers || [];
    if (w.visionOn && ps.length) {
      const id = w.visionId || ps[0].id;
      const single = ps.filter((p) => p.enabled !== false).length <= 1;
      c.ai.vision.enabled = true;
      c.ai.vision.strategy = w.strategy || 'ocr';
      c.ai.vision.ocrProviderId = id;
      c.ai.vision.judgeToo = single;
      ps.forEach((p) => {
        if (p.id === id) {
          p.role = single ? 'both' : 'vision';
          p.vision = true;
        } else {
          p.role = 'judge';
          p.vision = false;
        }
      });
    } else {
      c.ai.vision.enabled = false;
      c.ai.vision.strategy = 'off';
      ps.forEach((p) => {
        p.role = 'judge';
        p.vision = false;
      });
    }
    c.ai.providers = ps.map((x, i) => CXAI.normalizeProvider(x, i));
    c.ui.onboarded = true;
    CXAI.Cfg.save();
    S.wz = null;
    S.wzActive = false;
    S.tab = 'model';
    renderFrame();
    toast('配置完成 · 回到考试页刷新即可', 'ok');
  }

  /** 向导第 1 步：按当前 Key / Base URL 拉一次模型清单，模型名以清单为准 */
  async function wizardFetch() {
    const w = wizardState();
    const pre = presetById(w.pick);
    if (!pre) return;
    const base = String(w.base || pre.baseURL || '').trim();
    if (!base) {
      toast('先填 Base URL', 'warn');
      return;
    }
    const probe = CXAI.normalizeProvider(
      {
        baseURL: base,
        model: String(w.model || pre.model || '').trim() || 'probe',
        apiKey: String(w.key || '').trim(),
        apiStyle: pre.id === 'custom' ? 'openai' : pre.apiStyle || 'openai',
        keyOptional: !!pre.keyOptional || CXAI.isLocalURL(base)
      },
      0
    );
    w.fetching = true;
    w.out = '正在拉取模型清单…';
    renderFrame();
    try {
      const list = await CXAI.AI.listModels(probe);
      w.list = list || [];
      w.fetching = false;
      if (w.list.length) {
        if (!String(w.model || '').trim()) w.model = w.list[0].id;
        w.out = '✓ 拉到 ' + w.list.length + ' 个模型 · 已选 ' + w.model;
        toast('拉到 ' + w.list.length + ' 个模型', 'ok');
      } else {
        w.out = '端点没返回模型清单，手填模型名即可';
        toast('没拉到清单，手填模型名', 'warn');
      }
    } catch (e) {
      w.fetching = false;
      w.list = null;
      w.out = '✗ ' + (e && e.message ? e.message : e);
      toast('拉取失败：' + w.out, 'bad');
    }
    renderFrame();
  }

  async function wizardTest() {
    const w = wizardState();
    const pre = presetById(w.pick);
    if (!pre) return;
    const probe = CXAI.normalizeProvider({
      baseURL: String(w.base || pre.baseURL || '').trim(),
      model: String(w.model || pre.model || '').trim(),
      apiKey: String(w.key || '').trim(),
      apiStyle: pre.apiStyle || 'openai',
      keyOptional: !!pre.keyOptional || CXAI.isLocalURL(String(w.base || pre.baseURL || ''))
    }, 0);
    w.testing = true;
    w.out = '正在请求…';
    renderFrame();
    try {
      const r = await CXAI.AI.ping(probe);
      w.out = '✓ 连通 · ' + (r.ms || '') + 'ms · ' + CXAI.U.truncate(String(r.text || '').replace(/\s+/g, ' '), 30);
      w.testing = false;
      renderFrame();
      toast('连通', 'ok');
    } catch (e) {
      w.out = '✗ ' + (e && e.message ? e.message : e);
      w.testing = false;
      renderFrame();
      toast('连不通：' + w.out, 'bad');
    }
  }

  /* ---------------- 渲染 ---------------- */

  function paneHtml(tab) {
    switch (tab) {
      case 'judge':
        return paneJudge();
      case 'vision':
        return paneVision();
      case 'run':
        return paneRun();
      case 'backup':
        return paneBackup();
      case 'diag':
        return paneDiag();
      default:
        return paneModel();
    }
  }

  /** 整页骨架（只在 mount 时渲染一次） */
  function frame() {
    const wiz = !!S.wzActive;
    return `${topbar()}
<div class="cs-layout${wiz ? ' wiz' : ''}">
  ${wiz ? '' : nav()}
  <main class="cs-main" id="cs-main"></main>
</div>
<div class="cs-toast" id="cs-toast"></div>`;
  }
  function renderMain() {
    const main = q('#cs-main');
    if (!main) return;
    // 向导进行中：整块交给向导，不看页签
    if (S.wzActive) {
      main.innerHTML = wizardHtml();
      refreshMeta();
      return;
    }
    if (!advancedOn() && SIMPLE_TABS.indexOf(S.tab) < 0) S.tab = 'model';
    ensureVisionModel();
    main.innerHTML = paneHtml(S.tab);
    qa('.cs-nav .it').forEach((el) => el.classList.toggle('on', el.getAttribute('data-tab') === S.tab));
    refreshMeta();
    if (S.tab === 'diag' && !S.diag) collectDiag();
  }
  /* ---------------- 字段读写 ---------------- */

  const NUM_FIELDS = { weight: 1, temperature: 1, maxTokens: 1 };

  function updProvider(i, field, raw) {
    const ps = cfg().ai.providers || [];
    const p = ps[i];
    if (!p) return;
    if (field === 'enabled' || field === 'keyOptional') p[field] = !!raw;
    else if (NUM_FIELDS[field]) {
      // 空/非数字不写 0：maxTokens:0 会被原样发给端点，weight:0 会让这票失效
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      p[field] = isFinite(n) ? n : field === 'weight' ? 1 : 0;
    } else p[field] = raw;
    // 预设一旦手改地址/模型名就不再是那个「预设」了，但保留 preset 字段用于显示
    if (field === 'baseURL' || field === 'model') {
      const best = detectPresetByURL(p.baseURL);
      p.preset = best;
    }
    CXAI.Cfg.data.ai.providers = ps.map((x, k) => CXAI.normalizeProvider(x, k));
    touch('已保存');
  }

  function detectPresetByURL(url) {
    const h = String(url || '').toLowerCase();
    const hit = presets().filter((x) => x.baseURL && String(x.baseURL).toLowerCase() === h)[0];
    return hit ? hit.id : 'custom';
  }

  function setPath(path, value) {
    const parts = String(path).split('.');
    let cur = cfg();
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    touch('已保存');
  }

  function readField(el) {
    const type = el.getAttribute('type') || '';
    if (type === 'checkbox') return el.checked;
    if (type === 'number') {
      // 清空输入框不等于 0：返回 undefined，让调用方跳过写入、保留旧值。
      // 以前返回 0，把超时/并发/图片尺寸等字段持久化成 0（请求会带 max_tokens:0）。
      const raw = String(el.value == null ? '' : el.value).trim();
      if (!raw) return undefined;
      const n = Number(raw);
      return isFinite(n) ? n : undefined;
    }
    return el.value;
  }

  /* ---------------- 读图模型与 role 联动 ----------------
   * 读图模型是用 role 表达的（vision / both），不是单独字段。
   * 改了「读图模型」下拉或「同时参与判题」就必须同步所有 provider 的 role，
   * 否则 visionProviders() / activeProviders() 仍然按旧角色挑模型。
   */
  function syncVisionRoles() {
    const c = cfg();
    const v = c.ai.vision || {};
    const vid = v.ocrProviderId || '';
    const both = !!v.judgeToo;
    (c.ai.providers || []).forEach((p) => {
      if (vid && p.id === vid) {
        p.role = both ? 'both' : 'vision';
        p.vision = true;
      } else if (vid) {
        p.role = 'judge';
        p.vision = false;
      } else {
        // 取消读图：角色收回判题，但保留模型自带的视觉能力标记（auto 策略还要用）
        p.role = 'judge';
      }
    });
    CXAI.Cfg.data.ai.providers = c.ai.providers.map((x, i) => CXAI.normalizeProvider(x, i));
    // 只配了一个模型时，它必须兼任判题，否则判题面板会空
    if (vid && (c.ai.providers || []).filter((p) => p.enabled !== false && p.role !== 'vision').length === 0) {
      c.ai.vision.judgeToo = true;
      (c.ai.providers || []).forEach((p) => {
        if (p.id === vid) p.role = 'both';
      });
    }
  }

  /* ---------------- 模型动作 ---------------- */

  function addProvider() {
    const c = cfg();
    const list = c.ai.providers || [];
    const fresh = CXAI.normalizeProvider(
      {
        id: CXAI.U.uid('p'),
        label: '新模型 ' + (list.length + 1),
        preset: 'custom',
        baseURL: 'https://api.openai.com/v1',
        apiStyle: 'openai',
        model: 'gpt-4o-mini',
        apiKey: '',
        weight: 1,
        temperature: 0.2,
        maxTokens: 700,
        enabled: true,
        vision: false,
        role: 'judge'
      },
      list.length
    );
    list.push(fresh);
    c.ai.providers = list;
    S.open[fresh.id] = true;
    persist('已添加模型，填好 Key 后点「拉取」');
    renderMain();
  }

  /** 从预设一键添加一个模型 */
  function addPresetProvider(id) {
    const pre = presetById(id);
    if (!pre) return addProvider();
    const c = cfg();
    const list = c.ai.providers || [];
    const fresh = CXAI.normalizeProvider(
      {
        id: CXAI.U.uid('p'),
        label: pre.label,
        preset: pre.id,
        baseURL: pre.baseURL,
        model: pre.model,
        apiStyle: pre.apiStyle || 'openai',
        apiKey: '',
        weight: 1,
        temperature: 0.2,
        maxTokens: 700,
        enabled: true,
        vision: !!pre.vision,
        keyOptional: !!pre.keyOptional,
        role: 'judge'
      },
      list.length
    );
    list.push(fresh);
    c.ai.providers = list;
    S.open[fresh.id] = true;
    persist('已添加 ' + pre.label + ' · 填好 Key 点「拉取」');
    renderMain();
    toast('已添加 ' + pre.label, 'ok');
  }

  function delProvider(i) {
    const c = cfg();
    const list = c.ai.providers || [];
    const p = list[i];
    if (!p) return;
    if (list.length <= 1) {
      toast('至少要留一个模型', 'warn');
      return;
    }
    if (!confirm('删除模型「' + (p.label || p.model || p.id) + '」？')) return;
    list.splice(i, 1);
    c.ai.providers = list;
    if (c.ai.vision && c.ai.vision.ocrProviderId === p.id) c.ai.vision.ocrProviderId = '';
    persist('已删除');
    renderMain();
  }

  function moveProvider(i, dir) {
    const c = cfg();
    const list = c.ai.providers || [];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
    c.ai.providers = list;
    persist(false);
    renderMain();
  }

  function applyPresetTo(i, id) {
    const pre = presetById(id);
    const c = cfg();
    const p = (c.ai.providers || [])[i];
    if (!p) return;
    if (!pre) {
      p.preset = 'custom';
      persist(false);
      renderMain();
      return;
    }
    p.preset = pre.id;
    if (pre.baseURL) p.baseURL = pre.baseURL;
    if (pre.model) p.model = pre.model;
    // 自定义模型默认走 OpenAI 协议（用户之后仍可在高级设置里手动切 Anthropic/Gemini）
    p.apiStyle = pre.apiStyle || 'openai';
    if (pre.id === 'custom' && !p.apiStyle) p.apiStyle = 'openai';
    if (pre.label) p.label = pre.label;
    if (pre.keyOptional) p.keyOptional = true;
    p.vision = !!pre.vision || p.vision;
    persist('已套用预设 ' + pre.label);
    renderMain();
  }

  async function fetchModels(i) {
    const p = (cfg().ai.providers || [])[i];
    if (!p) return;
    const pid = p.id;
    S.busy['fetch' + i] = true;
    const btn = q('[data-act="fetch"][data-i="' + i + '"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '拉取中…';
    }
    try {
      const list = await CXAI.AI.listModels(p);
      S.models[pid] = list || [];
      // await 期间用户可能上移 / 删除 / 新增模型：不能再用旧下标回写，按 id 重新定位
      const idx = (cfg().ai.providers || []).findIndex((x) => x.id === pid);
      if (idx < 0) {
        toast('这个模型已被删除，拉取结果已丢弃', 'warn');
        renderMain();
        return;
      }
      if (!list || !list.length) {
        toast('端点没返回模型清单，手填模型名即可', 'warn');
      } else {
        // 以拉取结果为准：模型名为空就自动填第一个，用户随时能从下拉里换
        const blank = !String(((cfg().ai.providers || [])[idx] || {}).model || '').trim();
        if (blank) {
          updProvider(idx, 'model', list[0].id);
          toast('拉到 ' + list.length + ' 个，已选 ' + list[0].id, 'ok');
        } else {
          toast('拉到 ' + list.length + ' 个模型', 'ok');
        }
      }
      renderMain();
    } catch (e) {
      toast('拉取失败：' + (e && e.message ? e.message : e), 'bad');
      if (btn && btn.isConnected !== false) {
        btn.disabled = false;
        btn.textContent = '拉取';
      }
    } finally {
      S.busy['fetch' + i] = false;
    }
  }

  function outBox() {
    const box = q('#cs-testout');
    if (!box) return null;
    box.style.display = 'block';
    return box;
  }

  async function testOne(i) {
    const p = (cfg().ai.providers || [])[i];
    if (!p) return;
    const pid = p.id;
    let line = q('[data-testout="' + i + '"]');
    const btn = q('[data-act="test-one"][data-i="' + i + '"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '测试中…';
    }
    if (line) line.textContent = '正在请求…';
    try {
      const t0 = Date.now();
      const r = await CXAI.AI.ping(p);
      const ms = (r && r.ms) || Date.now() - t0;
      const txt = CXAI.U.truncate(String((r && r.text) || '').replace(/\s+/g, ' '), 40);
      // await 期间可能重绘 / 调整顺序：按 id 重新定位输出行，别往脱离文档的旧节点里写
      const idx = (cfg().ai.providers || []).findIndex((x) => x.id === pid);
      if (idx >= 0) line = q('[data-testout="' + idx + '"]');
      if (line) line.innerHTML = '<span style="color:#15803d">✓ ' + ms + 'ms · ' + esc(txt) + '</span>';
      toast('连通 · ' + ms + 'ms', 'ok');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const idx = (cfg().ai.providers || []).findIndex((x) => x.id === pid);
      if (idx >= 0) line = q('[data-testout="' + idx + '"]');
      if (line) line.innerHTML = '<span style="color:#b91c1c">✗ ' + esc(msg) + '</span>';
      toast('失败：' + msg, 'bad');
    }
    if (btn && btn.isConnected !== false) {
      btn.disabled = false;
      btn.textContent = '测试这个';
    }
  }

  async function testAll() {
    let box = outBox();
    const list = (cfg().ai.providers || []).filter((p) => p.enabled !== false);
    if (!list.length) {
      toast('没有启用的模型', 'warn');
      return;
    }
    const paint = (html) => {
      // 测试期间可能切页签/重绘：每次写之前重新定位输出框，别往脱离文档的节点里写
      box = q('#cs-testout') || box;
      if (!box) return;
      box.style.display = 'block';
      box.innerHTML = html;
    };
    paint('<div class="mid">正在测试 ' + list.length + ' 个模型…</div>');
    const lines = [];
    let ok = 0;
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      const head = (p.role === 'vision' ? '[读图] ' : p.role === 'both' ? '[读图+判题] ' : '[判题] ') +
        (p.label || p.id) + ' · ' + (p.model || '(未填模型)');
      lines.push('<div class="mid">… ' + esc(head) + '</div>');
      paint(lines.join(''));
      try {
        const t0 = Date.now();
        const r = await CXAI.AI.ping(p);
        ok++;
        lines[lines.length - 1] =
          '<div class="ok">✓ ' + esc(head) + ' · ' + ((r && r.ms) || Date.now() - t0) + 'ms · ' +
          esc(CXAI.U.truncate(String((r && r.text) || '').replace(/\s+/g, ' '), 40)) + '</div>';
      } catch (e) {
        lines[lines.length - 1] = '<div class="bad">✗ ' + esc(head) + ' · ' + esc(e && e.message ? e.message : e) + '</div>';
      }
      paint(lines.join(''));
    }
    lines.push('<div class="' + (ok === list.length ? 'ok' : 'bad') + '">完成：' + ok + '/' + list.length + ' 连通</div>');
    paint(lines.join(''));
    toast('连通 ' + ok + '/' + list.length, ok === list.length ? 'ok' : 'warn');
  }

  /* ---------------- 备份动作 ---------------- */

  function exportText() {
    const ta = q('#cs-io');
    if (!ta) return;
    ta.value = CXAI.Cfg.json();
    const hint = q('#cs-iohint');
    if (hint) hint.textContent = '已导出 ' + ta.value.length + ' 字符';
    toast('已导出 ' + ta.value.length + ' 字符', 'ok');
  }

  function importText(raw) {
    const txt = String(raw == null ? (q('#cs-io') || {}).value || '' : raw).trim();
    if (!txt) {
      toast('文本框是空的', 'warn');
      return;
    }
    try {
      CXAI.Cfg.importJSON(txt);
      S.models = {};
      persist('配置已导入');
      renderMain();
      toast('导入成功 · 模型 ' + (cfg().ai.providers || []).length + ' 个', 'ok');
    } catch (e) {
      toast('导入失败：' + (e && e.message ? e.message : e), 'bad');
    }
  }

  /** 把当前配置编码进 URL hash，打开学习通让考试域落库（油猴存储按域隔离，这是唯一自动通道） */
  function syncToChaoxing() {
    const code = CXAI.cfgCodec.encode(CXAI.Cfg.data || CXAI.Cfg.load());
    if (!code) {
      toast('配置编码失败', 'bad');
      return;
    }
    const url = 'https://i.chaoxing.com/base#cxai_cfg=' + encodeURIComponent(code);
    try {
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      location.href = url;
    }
    const hint = q('#cs-synchint');
    if (hint) hint.textContent = '已打开学习通，配置会在那一侧自动生效（同时复制了一份配置码）';
    copyText(code, '配置码已复制');
    toast('已打开学习通 · 配置将自动落库', 'ok');
  }

  function copyConfigCode() {
    const code = CXAI.cfgCodec.encode(CXAI.Cfg.data || CXAI.Cfg.load());
    if (!code) {
      toast('配置编码失败', 'bad');
      return;
    }
    copyText(code, '配置码已复制 · 粘到考试页面板「备份 → 导入」');
  }

  function downloadJSON() {
    try {
      const blob = new Blob([CXAI.Cfg.json()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cx-exam-ai-config-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 800);
      toast('已下载配置文件', 'ok');
    } catch (e) {
      toast('下载失败：' + e.message, 'bad');
    }
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || '已复制', 'ok');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(okMsg || '已复制', 'ok');
      } catch (e2) {
        toast('复制失败，请手动全选复制', 'warn');
      }
      ta.remove();
    }
  }

  function resetConfig() {
    if (!confirm('恢复默认设置？当前配置会被清掉（模型、Key、参数全部重置）')) return;
    try {
      CXAI.Cfg.importJSON(JSON.stringify(CXAI.DEFAULT_CONFIG));
      S.models = {};
      renderMain();
      toast('已恢复默认', 'ok');
    } catch (e) {
      toast('重置失败：' + e.message, 'bad');
    }
  }

  /* ---------------- 诊断动作 ---------------- */

  function collectDiag() {
    let d = null;
    try {
      d = CXAI.diag();
    } catch (e) {
      d = { error: String(e && e.message ? e.message : e) };
    }
    S.diag = JSON.stringify(d, null, 2);
    const box = q('#cs-diagout');
    if (box) box.textContent = S.diag;
    return S.diag;
  }

  /* ---------------- 事件 ---------------- */

  function onClick(e) {
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    const act = el.getAttribute('data-act');
    const i = Number(el.getAttribute('data-i'));
    switch (act) {
      case 'tab':
        S.tab = el.getAttribute('data-tab') || 'model';
        renderMain();
        break;
      case 'pv-toggle':
        if (e.target.closest && e.target.closest('input, label, select, button, .del')) return;
        {
          const card = el.closest('.cs-pv');
          if (!card) return;
          const open = card.getAttribute('data-open') === '1';
          card.setAttribute('data-open', open ? '0' : '1');
          S.open[card.getAttribute('data-id')] = !open;
        }
        break;
      case 'pv-add':
        addProvider();
        break;
      case 'pv-add-preset':
        addPresetProvider(el.getAttribute('data-preset'));
        break;
      case 'toggle-advanced': {
        const on = !advancedOn();
        CXAI.Cfg.set('ui.advanced', on);
        // 向导里点「高级设置」：结束引导直接进设置页，否则点了会没反应（向导优先渲染）
        if (S.wzActive) {
          S.wzActive = false;
          S.wz = null;
          CXAI.Cfg.set('ui.onboarded', true);
        }
        S.tab = 'model';
        renderFrame();
        toast(on ? '已切到高级设置：权重 / 阈值 / 超时 / 运行 / 备份 / 诊断' : '已切回简单设置（专业项隐藏，值仍保留）', 'ok');
        break;
      }
      case 'wz-pick': {
        const w = wizardState();
        w.pick = el.getAttribute('data-preset') || '';
        const pre = presetById(w.pick);
        w.key = '';
        w.model = pre ? pre.model || '' : '';
        w.base = pre ? pre.baseURL || '' : '';
        w.list = null;
        w.out = '';
        renderFrame();
        break;
      }
      case 'wz-judge': {
        const w = wizardState();
        w.judge = el.getAttribute('data-v') || 'council';
        renderFrame();
        break;
      }
      case 'wz-test':
        wizardTest();
        break;
      case 'wz-fetch':
        wizardFetch();
        break;
      case 'wz-add': {
        const r = wizardCommitProvider();
        if (!r.ok) {
          toast(r.msg, 'warn');
          break;
        }
        const w = wizardState();
        const label = r.provider ? r.provider.label || r.provider.model : '';
        w.pick = '';
        w.key = '';
        w.model = '';
        w.base = '';
        w.list = null;
        w.out = '';
        renderFrame();
        toast('已添加 ' + label + ' · 可以继续加，或点「下一步」', 'ok');
        break;
      }
      case 'wz-del': {
        const id = el.getAttribute('data-id');
        const c = cfg();
        c.ai.providers = (c.ai.providers || []).filter((p) => p.id !== id);
        CXAI.Cfg.save();
        const w = wizardState();
        w.list = null;
        renderFrame();
        toast('已删除', 'ok');
        break;
      }
      case 'wz-next': {
        const w = wizardState();
        if (w.step === 1) {
          // 表里还填着未提交的那个，先替用户加进去
          if (w.pick) {
            const r = wizardCommitProvider();
            if (!r.ok) {
              toast(r.msg, 'warn');
              break;
            }
            w.pick = '';
            w.key = '';
            w.model = '';
            w.base = '';
            w.list = null;
          }
          if (!(cfg().ai.providers || []).length) {
            toast('至少添加一个模型', 'warn');
            break;
          }
          w.step = 2;
          renderFrame();
        } else if (w.step === 2) {
          w.step = 3;
          renderFrame();
        } else {
          wizardDone();
        }
        break;
      }
      case 'wz-back': {
        const w = wizardState();
        w.step = Math.max(1, w.step - 1);
        renderFrame();
        break;
      }
      case 'wz-done':
        wizardDone();
        break;
      case 'wz-skip': {
        CXAI.Cfg.set('ui.onboarded', true);
        S.wz = null;
        S.wzActive = false;
        S.tab = 'model';
        renderFrame();
        toast('已跳过引导 · 需要细调时点右上角「高级设置」', 'ok');
        break;
      }
      case 'pv-del':
        delProvider(i);
        break;
      case 'pv-up':
        moveProvider(i, -1);
        break;
      case 'pv-down':
        moveProvider(i, 1);
        break;
      case 'pv-collapse':
        qa('.cs-pv').forEach((c) => {
          c.setAttribute('data-open', '0');
          S.open[c.getAttribute('data-id')] = false;
        });
        break;
      case 'fetch':
        fetchModels(i);
        break;
      case 'test-one':
        testOne(i);
        break;
      case 'test-all':
        testAll();
        break;
      case 'export-text':
        exportText();
        break;
      case 'sync-chaoxing':
        syncToChaoxing();
        break;
      case 'sync-new':
        syncNew();
        break;
      case 'sync-top':
        syncTopClick();
        break;
      case 'sync-now':
        syncNowClick();
        break;
      case 'sync-pull':
        syncPullClick();
        break;
      case 'sync-off':
        syncOffClick();
        break;
      case 'sync-copy':
        copyText(CXAI.Sync.savedCode(), '同步码已复制');
        break;
      case 'copy-code':
        copyConfigCode();
        break;
      case 'download':
        downloadJSON();
        break;
      case 'copy':
        copyText(CXAI.Cfg.json(), '配置 JSON 已复制');
        break;
      case 'import-text':
        importText();
        break;
      case 'reset':
        resetConfig();
        break;
      case 'diag':
        collectDiag();
        toast('诊断信息已刷新', 'ok');
        break;
      case 'copy-diag':
        copyText(collectDiag() || '', '诊断信息已复制');
        break;
    }
  }

  function onChange(e) {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const act = t.getAttribute('data-act');

    // 向导里的字段（data-wz）
    const wzKey = t.getAttribute('data-wz');
    if (wzKey) {
      const w = wizardState();
      if (wzKey === 'visionOn') {
        w.visionOn = !!t.checked;
        renderFrame();
        return;
      }
      if (wzKey === 'visionId') {
        w.visionId = t.value;
        return;
      }
      if (wzKey === 'strategy') {
        w.strategy = t.value;
        return;
      }
      w[wzKey] = t.value;
      return;
    }

    // 「+ 从预设添加…」下拉
    if (act === 'add-preset-select') {
      const id = t.value;
      if (id) {
        addPresetProvider(id);
      }
      return;
    }

    // 向导：从拉到的清单里选模型
    if (act === 'wz-pick-model') {
      const w = wizardState();
      if (t.value) {
        w.model = t.value;
        renderFrame();
      }
      return;
    }

    // 拉取到的模型清单里选一个填进去
    if (act === 'pick-model') {
      const i = Number(t.getAttribute('data-i'));
      const val = t.value;
      if (val) {
        updProvider(i, 'model', val);
        renderMain();
        toast('模型名已填入', 'ok');
      }
      return;
    }

    // 判定强度：一次改四个字段
    if (act === 'strength') {
      const MAP = {
        single: { mode: 'single', panelSize: 1, enableCritique: false, enableArbiter: false },
        fast: { mode: 'fast', panelSize: 1, enableCritique: false, enableArbiter: false },
        council: { mode: 'council', panelSize: 3, enableCritique: true, enableArbiter: false },
        max: { mode: 'council', panelSize: 3, enableCritique: true, enableArbiter: true }
      };
      const m = MAP[t.value];
      if (m) {
        Object.keys(m).forEach((k) => (cfg().ai.judge[k] = m[k]));
        persist('判定强度已切换');
        renderMain();
      }
      return;
    }

    // provider 字段
    const f = t.getAttribute('data-f');
    if (f != null && t.hasAttribute('data-i')) {
      const i = Number(t.getAttribute('data-i'));
      const fv = readField(t);
      if (fv === undefined) return; // 数字框被清空：不写 0，保留旧值
      updProvider(i, f, fv);
      // 预设改变要重渲染整张卡（会换掉 baseURL / 模型名）
      if (f === 'preset') {
        applyPresetTo(i, t.value);
        return;
      }
      if (f === 'enabled') {
        const card = t.closest('.cs-pv');
        if (card) card.classList.toggle('off', !t.checked);
        refreshMeta();
      }
      return;
    }

    // 全局字段
    const path = t.getAttribute('data-path');
    if (path) {
      const val = readField(t);
      if (val === undefined) return; // 数字框清空：不落 0
      setPath(path, val);
      // 交卷开关：引擎与 guard 读旧字段，两个都写
      if (path === 'apply.submit') setPath('apply.autoSubmit', val);
      // 读图开关与策略必须联动：向导里选过"不处理图片"会把 strategy 写成 'off'，
      // 之后在简单版只勾回 enabled，03b-vision 仍判为关闭 —— 图片永远不处理。
      if (path === 'ai.vision.enabled' && val === true && cfg().ai.vision.strategy === 'off') {
        setPath('ai.vision.strategy', 'ocr');
        renderMain();
      }
      if (path === 'ai.vision.strategy' && val !== 'off' && cfg().ai.vision.enabled !== true) {
        setPath('ai.vision.enabled', true);
        renderMain();
      }
      // 读图模型 / 兼任判题：要同步所有 provider 的 role，否则挑模型的逻辑还按旧角色走
      if (path === 'ai.vision.ocrProviderId' || path === 'ai.vision.judgeToo') {
        syncVisionRoles();
        renderMain();
        toast('读图模型已更新', 'ok');
      }
      return;
    }
    const mb = t.getAttribute('data-path-x');
    if (mb === 'ai.vision.maxTotalBytes') {
      setPath('ai.vision.maxTotalBytes', Math.round((Number(t.value) || 4) * 1048576));
    }
  }

  /** 输入框边打边存（防抖），不等失焦 */
  function onInput(e) {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const wz = t.getAttribute('data-wz');
    if (wz) {
      const w = wizardState();
      w[wz] = t.value;
      return;
    }
    if (!t.getAttribute('data-path') && !t.getAttribute('data-f')) return;
    const type = t.getAttribute('type') || 'text';
    if (type === 'checkbox') return;
    const path = t.getAttribute('data-path');
    if (path) {
      const val = readField(t);
      if (val === undefined) return; // 边打边存时清空输入框：保留旧值，不写 0
      setPath(path, val);
      return;
    }
    const f = t.getAttribute('data-f');
    if (f != null && t.hasAttribute('data-i')) {
      const fv = readField(t);
      if (fv === undefined) return;
      updProvider(Number(t.getAttribute('data-i')), f, fv);
    }
  }

  function onUpload(e) {
    const t = e.target;
    if (!t || t.getAttribute('data-act') !== 'upload') return;
    const file = t.files && t.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const ta = q('#cs-io');
      if (ta) ta.value = String(fr.result || '');
      importText(String(fr.result || ''));
    };
    fr.onerror = () => toast('读文件失败', 'bad');
    fr.readAsText(file);
  }

  /* ---------------- 挂载 ---------------- */

  function injectCSS() {
    try {
      if (typeof GM_addStyle === 'function') {
        GM_addStyle(CSS);
        return;
      }
    } catch (e) {}
    const st = document.createElement('style');
    st.id = 'cs-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function mount() {
    if (mounted) return true;
    injectCSS();
    // 骨架页自带的深色样式接管后就没用了，留着会污染 code / a 等继承样式
    const bootStyle = document.getElementById('cs-boot-style');
    if (bootStyle) bootStyle.remove();
    document.title = 'CX 考试 AI 大脑 · 设置中心';

    // 整页接管：settings.html 只是骨架，真正的界面由脚本渲染
    host = document.createElement('div');
    host.id = 'cx-ai-settings';
    host.className = 'cs-root';
    const body = document.body || document.documentElement;
    body.innerHTML = '';
    body.appendChild(host);
    host.innerHTML = frame();

    CXAI.Cfg.load();
    S.wz = null;
    S.wzActive = needWizard();
    // 支持 /settings.html?tab=judge 直接落到指定栏（排查 / 收藏夹直达都方便）
    const wantTab = (function () {
      try {
        const m = /[?&]tab=([a-z]+)/i.exec(String(location.search || ''));
        return m ? m[1].toLowerCase() : '';
      } catch (e) {
        return '';
      }
    })();
    S.tab = ['model', 'judge', 'vision', 'run', 'backup', 'diag'].indexOf(wantTab) >= 0 ? wantTab : 'model';
    renderMain();

    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    host.addEventListener('change', onUpload);

    mounted = true;
    try {
      CXAI.Log.info('设置中心已就绪 · 存储后端 ' + CXAI.Store.backend + ' · 配置 ' + storeInfo().bytes + ' 字节');
    } catch (e) {}
    return true;
  }

  function unmount() {
    if (!mounted) return;
    host = null;
    mounted = false;
    const el = document.getElementById('cx-ai-settings');
    if (el) el.remove();
  }

  return { isHere, mount, unmount, collectDiag };
})();
