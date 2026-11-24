/* ---------------- 控制台 UI（Shadow DOM 隔离，避免被页面 CSS 污染） ---------------- */

CXAI.UI = (function () {
  let host = null;
  // 卸载时要摘掉的全局监听：不摘的话 unmount→mount 后 Ctrl+Shift+X 会切换两次
  // （看起来像"按了没反应"），日志每行也会重复打印。
  let docKeydown = null;
  let logOff = null;
  let resizeHandler = null;

  /** 独立设置中心的默认地址（换部署位时改这里，或用配置项 ui.settingsURL 覆盖） */
  // Cloudflare Pages 会把 /settings.html 308 跳到 /settings，这里直接用规范路径，少一跳
  const DEFAULT_SETTINGS_URL = 'https://cx-exam-ai.pages.dev/settings';
  let root = null;
  let state = { running: false, paused: false, needSetup: false, total: 0, done: 0, answered: 0, todo: 0, failed: 0, current: 0, pageKind: '-', providers: 0, qlist: [], pending: null, doneAll: false, mode: 'single', sync: { ok: null, busy: false, msg: '', at: 0, models: 0 } };

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
/* 细滚动条（浅色） */
* { scrollbar-width: thin; scrollbar-color: #c7cdd8 transparent; }
*::-webkit-scrollbar { width: 7px; height: 7px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #ccd2dd; border-radius: 7px; }
*::-webkit-scrollbar-thumb:hover { background: #b6bfcd; }
*::-webkit-scrollbar-corner { background: transparent; }

.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font-size: 13px; color: #1f2430; }

/* 悬浮球：浅色、平时很淡，可拖 */
.ball { position: relative; width: 34px; height: 34px; border-radius: 50%;
  background: rgba(248,250,252,.5); border: 1px solid rgba(203,213,225,.4);
  color: #9aa3b2; display:flex; align-items:center; justify-content:center;
  font-size: 10px; font-weight: 600; letter-spacing:.3px; cursor: pointer;
  opacity: .26; transition: opacity .18s, background .18s, transform .12s, box-shadow .18s;
  user-select:none; touch-action:none; box-shadow: 0 2px 8px rgba(16,24,40,.08); }
.ball:hover { opacity: .9; background:rgba(255,255,255,.95); color:#2563eb; border-color:#cbd9f2; box-shadow: 0 3px 10px rgba(37,99,235,.12); }
.ball.busy { opacity: .4; }
.ball.busy::after { content:''; position:absolute; right:4px; top:4px; width:6px; height:6px; border-radius:50%; background:#16a34a; }
/* 长按后弹出的手势提示（球上方） */
.gmode { position:absolute; right:4px; bottom:44px; background:#fff; border:1px solid #e5e8ee; border-radius:9px;
  box-shadow:0 8px 22px rgba(16,24,40,.12); padding:5px; display:none; flex-direction:column; gap:2px;
  font-size:11px; color:#6b7280; white-space:nowrap; z-index:2; }
.gmode.show { display:flex; }
.gmode .g { padding:4px 9px; border-radius:6px; transition:.12s; }
.gmode .g.on { background:#eaf1ff; color:#2563eb; font-weight:600; }
.gtoast { position:absolute; right:0; bottom:44px; background:#111827; color:#fff; font-size:11px; line-height:1.4;
  padding:4px 9px; border-radius:7px; opacity:0; transform:translateY(5px); transition:.18s; pointer-events:none;
  white-space:nowrap; z-index:3; }
.gtoast.show { opacity:.9; transform:translateY(0); }

/* 运行/结束时球本身变淡绿并显示数字或 OK（不再额外加一个小圆） */
.ball.running { background: rgba(220,252,231,.46); border-color: rgba(167,243,208,.5); color: #62a987; opacity: .42; }
.ball.running #balllabel { font-size: 11px; }
.ball.done { background: rgba(220,252,231,.62); border-color: rgba(167,243,208,.6); color: #4f9e72; opacity: .5; }
.ball.done #balllabel { font-size: 10px; letter-spacing: .5px; }
.ball.dragging { opacity: 1; cursor: grabbing; transform: scale(1.05); }
/* 本域还没配置：球左上角一颗橙点，不弹窗打扰，点球才进面板 */
.ball.needs-setup::before { content:''; position:absolute; left:2px; top:2px; width:7px; height:7px; border-radius:50%;
  background:#f59e0b; box-shadow:0 0 0 2px rgba(255,255,255,.92); }
.setupbar { display:none; align-items:center; gap:8px; padding:8px 12px; background:#fffbeb;
  border-bottom:1px solid #fde68a; font-size:11.5px; color:#92400e; }
.setupbar.show { display:flex; }
.setupbar span { flex:1; line-height:1.5; }

.panel { position:absolute; right:0; bottom:44px; width: 404px; max-height: 76vh; background:#fff; border:1px solid #e5e8ee;
  border-radius: 12px; box-shadow: 0 16px 44px rgba(16,24,40,.16); display:none; flex-direction:column; overflow:hidden; }
.panel.show { display:flex; }
.hd { padding:10px 12px; background:#f7f8fb; border-bottom:1px solid #e8ebf1; display:flex; align-items:center; gap:8px; }
.hd .t { font-weight:600; font-size:13px; color:#111827; flex:1; }
.hd .x { cursor:pointer; color:#7b8494; padding:5px 9px; font-size:17px; line-height:1;
  border-radius:7px; transition:background .15s, color .15s; user-select:none; }
.hd .x:hover { color:#2563eb; background:#eef4ff; }
.hd .x.close:hover { color:#dc2626; background:#fdeeee; }
.stat { display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:#e8ebf1; }
.stat div { background:#fff; padding:7px 6px; text-align:center; }
.stat b { display:block; font-size:15px; color:#2563eb; font-weight:700; }
.stat div.bad b { color:#dc2626; }
.stat span { font-size:11px; color:#8a93a3; }
.bar { display:flex; gap:5px; padding:8px 10px; border-bottom:1px solid #e8ebf1; }
button.b { flex:1; padding:6px 0; border-radius:7px; border:1px solid #dde2ea; background:#fff; color:#374151;
  cursor:pointer; font-size:11.5px; transition:.15s; }
button.b:hover { background:#f5f7fb; border-color:#c8d2e0; color:#111827; }
button.b.primary { background:linear-gradient(135deg,#3b82f6,#6366f1); border:none; color:#fff; font-weight:600; box-shadow:0 2px 8px rgba(59,130,246,.24); }
button.b.danger { color:#dc2626; border-color:#f0c9c9; background:#fff7f7; }
button.b:disabled { opacity:.45; cursor:not-allowed; box-shadow:none; }

/* 题号格子：颜色即状态 */
.qgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(36px,1fr)); gap:6px;
  padding:9px 10px; max-height:138px; overflow-y:auto; overflow-x:hidden;
  border-bottom:1px solid #e8ebf1; background:#fafbfd; }
.qcard { height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center;
  font-size:12px; font-weight:600; cursor:pointer; border:1px solid #e2e7ef; background:#fff; color:#6b7280;
  transition:.15s; user-select:none; overflow:hidden; }
.qcard:hover { border-color:#bcd0f5; color:#2563eb; background:#f6f9ff; }
.qcard.ok { background:#eaf8ef; border-color:#bfe6cd; color:#15803d; }
.qcard.no { background:#fdf6e3; border-color:#f0e0b8; color:#a16207; }
.qcard.err { background:#fdeeee; border-color:#f3c9c9; color:#b91c1c; }
.qcard.wait { background:#fef7e6; border-color:#f2dfae; color:#b45309; }
.qcard.cur { box-shadow: 0 0 0 2px #2563eb inset; }
.qcard.sel { box-shadow: 0 0 0 2px #2563eb, 0 0 0 4px rgba(37,99,235,.14); }

.qdetail { flex:1; min-height:110px; overflow-y:auto; overflow-x:hidden; padding:9px 12px 10px; background:#fff; }
.qd-hd { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
.qd-hd .qn { font-weight:700; color:#2563eb; font-size:13px; }
.qd-hd .tag { font-size:10px; padding:1px 5px; border-radius:4px; background:#eef2f9; color:#5b6b86; }
.qd-hd .st { font-size:10px; padding:1px 5px; border-radius:4px; margin-left:auto; }
.qd-hd .st.ok { background:#eaf8ef; color:#15803d; }
.qd-hd .st.no { background:#fdf6e3; color:#a16207; }
.qd-hd .st.err { background:#fdeeee; color:#b91c1c; }
.qd-hd .st.wait { background:#fef7e6; color:#b45309; }
.qd-hd .st.todo { background:#f4f5f7; color:#6b7280; }
.qd-jump { font-size:10px; color:#2563eb; cursor:pointer; padding:1px 5px; border:1px solid #cfe0fb; border-radius:4px; background:#f6f9ff; }
.qd-jump:hover { background:#e9f1ff; }
.qd-stem { font-size:12px; color:#1f2937; line-height:1.6; margin-bottom:7px; word-break:break-word; }
.qd-opts { list-style:none; margin:0 0 8px; padding:0; }
.qd-opts li { display:flex; gap:6px; font-size:11.5px; color:#4b5563; padding:3px 4px; line-height:1.5; word-break:break-word; border-radius:5px; }
.qd-opts li b { flex:none; width:16px; height:16px; border-radius:4px; background:#f1f3f7; color:#6b7280; font-size:10px;
  display:flex; align-items:center; justify-content:center; font-weight:700; margin-top:1px; }
.qd-opts li.ai { background:#f2f7ff; }
.qd-opts li.ai b { background:#2563eb; color:#fff; }
.qd-opts li.pg { background:#f1faf4; color:#166534; }
.qd-opts li.pg b { background:#15803d; color:#fff; }
.qd-meta { border-top:1px dashed #e5e8ee; padding-top:7px; display:flex; flex-direction:column; gap:5px; }
.qd-meta .kv { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.qd-meta .k { flex:none; min-width:52px; font-size:10.5px; color:#8a93a3; }
.qd-meta .v { font-size:11.5px; font-weight:600; color:#111827; word-break:break-word; line-height:1.5; }
.qd-meta .v.ai { color:#2563eb; }
.qd-meta .v.pg { color:#15803d; }
.qd-meta .v.muted { font-weight:400; color:#8a93a3; }
.qd-meta .chip { font-size:10px; line-height:15px; padding:0 5px; border-radius:4px; color:#5b6b86;
  background:#f4f6fa; border:1px solid #e3e8f0; flex:none; }
.qd-meta .chip.ok { color:#15803d; background:#eaf8ef; border-color:#bfe6cd; }
.qd-meta .chip.bad { color:#b91c1c; background:#fdeeee; border-color:#f3c9c9; }
.qempty { padding:16px 12px; color:#9aa3b2; font-size:11.5px; text-align:center; line-height:1.6; }

.logs { flex:0 0 auto; max-height:0; overflow:hidden; transition:max-height .2s; background:#fff; }
.logs.show { max-height: 148px; overflow-y:auto; border-top:1px solid #e8ebf1; }
.lg { padding:2px 12px; font-size:11px; color:#5b6472; line-height:1.55; font-family:ui-monospace,Menlo,monospace; }
.lg.warn { color:#b45309; } .lg.error { color:#dc2626; } .lg.ok { color:#15803d; }
.q { padding:8px 12px; border-bottom:1px solid #f0f2f6; }
.q .h { display:flex; gap:6px; align-items:baseline; }
.q .idx { color:#8a93a3; font-size:11px; min-width:22px; }
.q .tag { font-size:10px; padding:1px 5px; border-radius:4px; background:#eef2f9; color:#5b6b86; }
.q .ans { margin-left:auto; font-weight:700; color:#15803d; font-size:13px; }
.q .ans.low { color:#b45309; }
.q .ans.err { color:#dc2626; }
.q .stem { color:#4b5563; font-size:11.5px; margin:3px 0 0 28px; line-height:1.5; word-break:break-word; }
.q .meta { margin-left:28px; font-size:10.5px; color:#8a93a3; margin-top:2px; }
.q .meta em { color:#2563eb; font-style:normal; }
.ft { padding:6px 12px; border-top:1px solid #e8ebf1; font-size:10.5px; color:#8a93a3; display:flex; align-items:center; gap:10px; background:#f7f8fb; }
.ft .lg-toggle { margin-left:auto; cursor:pointer; color:#8a93a3; padding:1px 5px; border-radius:4px; }
.ft .lg-toggle:hover { color:#2563eb; background:#eef4ff; }
.ft .ftstate { margin-left:0; }

/* 同步码气泡：贴着悬浮球，只有一个输入框 + 一个按钮 */
.syncpop { position:absolute; right:0; bottom:42px; width:268px; background:#fff; border:1px solid #e5e8ee;
  border-radius:11px; box-shadow:0 12px 32px rgba(16,24,40,.16); padding:9px 10px; display:none; z-index:4; }
.syncpop.show { display:block; animation: cxin .16s ease-out; }
.syncpop .sh { display:flex; align-items:center; gap:6px; font-size:11px; color:#6b7280; margin-bottom:6px; }
.syncpop .sh b { color:#111827; font-size:12px; font-weight:600; }
.syncpop .sh .x { margin-left:auto; cursor:pointer; color:#9aa3b2; padding:0 3px; line-height:1; }
.syncpop .sh .x:hover { color:#2563eb; }
.syncpop .srow { display:flex; gap:6px; }
.syncpop input { flex:1; min-width:0; border:1px solid #dfe3ea; border-radius:7px; padding:6px 8px;
  font:11px/1.4 ui-monospace,Menlo,monospace; outline:none; color:#111827; background:#fff; transition:.15s; }
.syncpop input:hover { border-color:#c8d2e0; }
.syncpop input:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.12); }
.syncpop button { flex:none; border:none; border-radius:7px; padding:6px 12px; font-size:11.5px; font-weight:600;
  color:#fff; background:linear-gradient(135deg,#3b82f6,#6366f1); cursor:pointer; transition:.15s;
  box-shadow:0 2px 8px rgba(59,130,246,.22); }
.syncpop button:hover { filter:brightness(1.06); }
.syncpop button:disabled { opacity:.65; cursor:default; box-shadow:none; }
.syncpop .hint { margin-top:6px; font-size:10.5px; color:#9aa3b2; line-height:1.55; word-break:break-word; }
.syncpop.done { border-color:#bfe6cd; background:#f7fdf9; }
.syncpop.done .hint { color:#15803d; font-weight:600; }
.syncpop.fail { border-color:#f3c9c9; background:#fff8f8; animation: cxshake .36s ease-in-out; }
.syncpop.fail .hint { color:#b91c1c; }
.syncpop .okmark { display:none; }
.syncpop.done .okmark { display:inline; color:#16a34a; font-weight:700; }

@keyframes cxin { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@keyframes cxshake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)}
  60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
@keyframes cxring { 0% { opacity:.9; transform:scale(.62); } 100% { opacity:0; transform:scale(2.15); } }
@keyframes cxpop { 0%{transform:scale(1)} 35%{transform:scale(1.16)} 100%{transform:scale(1)} }
/* 同步结果的扩散圈：绿=成功，红=失败，肉眼一眼能分 */
.fx { position:absolute; right:0; bottom:0; width:34px; height:34px; border-radius:50%; pointer-events:none; display:none; }
.fx.show { display:block; }
.fx.ok { border:2px solid #16a34a; animation: cxring .8s ease-out 2; }
.fx.err { border:2px solid #dc2626; animation: cxring .66s ease-out 2; }
.ball.synced { animation: cxpop .52s ease-out; }
.ball.sync-err::before { content:''; position:absolute; left:2px; top:2px; width:7px; height:7px; border-radius:50%;
  background:#dc2626; box-shadow:0 0 0 2px rgba(255,255,255,.92); }
/* 面板顶部：同步失败原因（双击小球打开的面板里展示） */
.syncfail { display:none; gap:6px; padding:8px 10px; background:#fff7f7; border-bottom:1px solid #f3c9c9;
  font-size:11px; color:#b91c1c; line-height:1.6; }
.syncfail.show { display:flex; }
.syncfail .t { flex:1; min-width:0; word-break:break-word; }
.syncfail .x { flex:none; cursor:pointer; color:#c98b8b; }
.syncfail .x:hover { color:#dc2626; }
.syncfail b { font-weight:600; }

/* 题号格子里的答案（数字下方一行小字，一眼看到每题答了什么） */
.qcard { flex-direction:column; gap:0; height:38px; }
.qcard b { font-size:12px; line-height:1.15; font-weight:700; }
.qcard i { font-style:normal; font-size:9px; line-height:1.1; max-width:100%; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; opacity:.9; }

/* 设置层 */
.mask { position:fixed; inset:0; background:rgba(17,24,39,.32); backdrop-filter: blur(1.5px); display:none; z-index:10; }
.mask.show { display:block; }
.dlg { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(820px,94vw); height:min(660px,88vh);
  background:#fff; border:1px solid #e5e8ee; border-radius:12px; display:flex; flex-direction:column; overflow:hidden;
  box-shadow:0 24px 64px rgba(16,24,40,.22); }
.dlg .dh { padding:11px 14px; font-weight:600; font-size:13px; color:#111827; border-bottom:1px solid #e8ebf1;
  display:flex; align-items:center; background:#f7f8fb; }
.dlg .dh .x { margin-left:auto; cursor:pointer; color:#9aa3b2; }
.dlg .dh .x:hover { color:#2563eb; }
.dbody { flex:1; display:flex; min-height:0; }
.dnav { width:126px; flex:none; border-right:1px solid #eaedf3; background:#fafbfd; padding:10px 8px; display:flex; flex-direction:column; gap:3px; overflow-y:auto; }
.navhd { font-size:10px; color:#a3abb9; padding:2px 10px 7px; letter-spacing:.5px; }
.ntab { display:flex; align-items:center; gap:7px; padding:8px 10px; border-radius:8px; font-size:12px; color:#5b6472;
  cursor:pointer; user-select:none; transition:.15s; }
.ntab:hover { background:#f1f4f9; color:#111827; }
.ntab.on { background:#eaf1ff; color:#2563eb; font-weight:600; box-shadow: inset 3px 0 0 #2563eb; }
.ntab .ic { font-size:12px; opacity:.85; width:14px; text-align:center; }
.dlg .db { flex:1; min-width:0; overflow-y:auto; overflow-x:hidden; padding:12px 14px; background:#fff; }
.dlg .df { padding:9px 14px; border-top:1px solid #e8ebf1; display:flex; gap:8px; background:#f7f8fb; }
.tabs { display:flex; gap:2px; border-bottom:1px solid #e8ebf1; margin:-2px 0 10px; background:#fff; }
.tab { padding:7px 12px; font-size:12px; color:#6b7280; cursor:pointer; border-radius:7px 7px 0 0; }
.tab:hover { color:#111827; background:#f4f6fa; }
.tab.on { color:#2563eb; background:#eef4ff; }
.pane { display:none; }
.pane.show { display:block; }
.testout { margin-top:7px; padding:8px 10px; background:#fafbfd; border:1px solid #e6eaf1; border-radius:8px;
  font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#5b6472; line-height:1.7;
  max-height:150px; overflow-y:auto; white-space:pre-wrap; word-break:break-word; }
.testout .ok { color:#15803d; } .testout .bad { color:#dc2626; } .testout .mid { color:#b45309; }

.fld { margin-bottom:9px; }
.fld label { display:block; font-size:11px; color:#6b7280; margin-bottom:3px; }
.fld input[type=text], .fld input[type=password], .fld input[type=number], .fld select, .fld textarea {
  width:100%; background:#fff; border:1px solid #dde2ea; color:#111827; border-radius:7px; padding:6px 8px; font-size:12px; outline:none; transition:.15s; }
.fld input:hover, .fld select:hover, .fld textarea:hover { border-color:#c8d2e0; }
.fld input:focus, .fld select:focus, .fld textarea:focus { border-color:#2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
.withbtn { display:flex; gap:6px; align-items:center; }
.withbtn input { flex:1; min-width:0; }
.mini { flex:0 0 auto; padding:5px 9px; font-size:11px; border-radius:6px; border:1px solid #dde2ea; background:#fff; color:#4b5563; cursor:pointer; }
.mini:hover { border-color:#2563eb; color:#2563eb; background:#f6f9ff; }
.mini[disabled] { opacity:.55; cursor:default; }
#mpop { position:fixed; display:none; background:#fff; border:1px solid #dfe4ec; border-radius:9px; box-shadow:0 14px 36px rgba(16,24,40,.18); overflow:hidden; }
#mpop .mph { display:flex; gap:6px; align-items:center; padding:7px 8px; border-bottom:1px solid #e8ebf1; }
#mpop .mpf { flex:1; min-width:0; background:#fff; border:1px solid #dde2ea; border-radius:6px; color:#111827; font-size:12px; padding:5px 7px; }
#mpop .mpc { font-size:11px; color:#8a93a3; white-space:nowrap; }
#mpop .mpl { max-height:262px; overflow-y:auto; padding:4px; }
#mpop .mi { padding:5px 8px; font-size:12px; color:#374151; border-radius:6px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#mpop .mi:hover { background:#f1f5fb; color:#111827; }
#mpop .mi.on { background:#eaf1ff; color:#2563eb; }
#mpop .mi-empty { padding:10px; font-size:12px; color:#8a93a3; }

/* 模型折叠卡 */
.pv { border:1px solid #e6eaf1; border-radius:10px; margin-bottom:7px; background:#fff; overflow:hidden; transition:border-color .15s, box-shadow .15s; }
.pv:hover { border-color:#cfd8e5; }
.pv .fld { margin-bottom:6px; }
.pv .row2 { gap:7px; }
.pv .ph { display:flex; align-items:center; gap:8px; padding:0 11px; height:38px; cursor:pointer; margin:0; }
.pv .ph:hover { background:#f7f9fc; }
.pv[data-open="1"] { border-color:#c9d8f2; box-shadow:0 2px 10px rgba(37,99,235,.07); }
.pv[data-open="1"] .ph { background:#f7f9fc; }
.pv .dot { width:7px; height:7px; border-radius:50%; background:#16a34a; flex:none; }
.pv.off .dot { background:#c7cdd8; }
.pv .nm { font-size:12px; font-weight:600; color:#111827; flex:none; min-width:50px; line-height:1; }
.pv .pm { flex:1; min-width:0; font-size:11.5px; line-height:1; color:#2563eb; font-family:ui-monospace,Menlo,monospace;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pv .chipx { flex:none; font-size:10px; line-height:15px; padding:0 5px; border-radius:4px;
  color:#5b6b86; background:#f2f5fa; border:1px solid #e3e8f0; }
.pv .ph .del { flex:none; color:#dc2626; font-size:11px; line-height:1; padding:4px 6px; border-radius:5px; }
.pv .ph .del:hover { background:#fdeeee; }
/* 行头里的复选框必须是一行内的小控件，不能继承 .fld label 的块级/间距 */
.pv .ph label.chk { display:inline-flex; align-items:center; gap:4px; margin:0; padding:0;
  font-size:11px; line-height:1; color:#4b5563; white-space:nowrap; flex:none; }
.pv .ph label.chk input { width:13px; height:13px; margin:0; accent-color:#2563eb; vertical-align:middle; }
.pv .ph .dot, .pv .ph .chipx { margin-top:0; }
.pv .pbody { display:none; padding:8px 10px 10px; border-top:1px solid #eef1f6; background:#fcfdff; }
.pv[data-open="1"] .pbody { display:block; }
.addrow { width:100%; padding:8px 0; border-radius:9px; border:1px dashed #cfd8e5; background:#fafbfd;
  color:#5b6472; font-size:12px; cursor:pointer; }
.addrow:hover { border-color:#2563eb; color:#2563eb; background:#f5f9ff; }
.pvbar { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.pvbar .t { font-size:12px; color:#4b5563; flex:1; }
.pvbar .mini { flex:none; }

details.adv { border-top:1px solid #e8ebf1; margin-top:8px; padding-top:6px; }
details.more { margin-top:6px; border-top:1px dashed #e8ebf1; padding-top:2px; }
details.adv > summary, details.more > summary { cursor:pointer; font-size:11px; color:#6b7280; padding:5px 0; list-style:none; user-select:none; }
details.adv > summary:hover, details.more > summary:hover { color:#2563eb; }
details.adv > summary::-webkit-details-marker, details.more > summary::-webkit-details-marker { display:none; }
details.adv > summary::before, details.more > summary::before { content:'▸ '; }
details.adv[open] > summary::before, details.more[open] > summary::before { content:'▾ '; }
details.adv[open] > summary, details.more[open] > summary { margin-bottom:6px; }
.row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; }
.chk, .fld label.chk { display:flex; align-items:center; gap:5px; font-size:11.5px; color:#4b5563; margin-bottom:0; }
.fld label.chk { margin-top:5px; }
.help { font-size:10.5px; color:#8a93a3; line-height:1.6; margin-top:2px; }
.pv .mhint { font-size:10.5px; color:#8a93a3; }
.tagv { display:inline-block; font-size:9.5px; padding:1px 4px; border-radius:3px; background:#eef4ff; color:#2563eb; margin-left:4px; }
/* ---------------- 右下角答案条（与悬浮球同一套浅色系，更淡更不抢眼） ---------------- */
.anscorner { position:fixed; right:12px; bottom:12px; z-index:2; width:216px; max-height:44vh;
  display:flex; flex-direction:column; background:rgba(248,250,252,.72); border:1px solid rgba(203,213,225,.45);
  border-radius:12px; box-shadow:0 2px 10px rgba(16,24,40,.07); backdrop-filter:blur(3px);
  font-size:11.5px; color:#7c8698; overflow:hidden; }
.anscorner .hd { display:flex; align-items:center; gap:6px; padding:6px 10px; cursor:pointer;
  background:rgba(255,255,255,.4); border-bottom:1px solid rgba(226,232,240,.55); font-weight:600;
  color:#8a93a3; user-select:none; }
.anscorner .hd b { color:#9aa3b2; font-weight:600; letter-spacing:.3px; }
.anscorner .hd .cnt { margin-left:auto; color:#a5aebc; font-weight:400; font-size:10px; }
.anscorner .hd .fold { color:#b4bcc8; padding:0 2px; }
.anscorner.folded .list { display:none; }
.anscorner.folded { width:auto; max-height:none; }
.anscorner .list { overflow-y:auto; padding:3px 5px 7px; }
.anscorner .arow { display:flex; gap:6px; padding:3px 6px; border-radius:7px; cursor:pointer; line-height:1.45; }
.anscorner .arow:hover { background:rgba(238,244,255,.75); }
.anscorner .arow b { flex:none; min-width:24px; color:#7fa3d9; font-weight:600; }
.anscorner .arow .a { flex:1; word-break:break-all; color:#8a93a3; }
.anscorner .arow.txt .a { color:#b08a5a; }
.anscorner .empty { padding:7px 10px; color:#b4bcc8; font-size:10.5px; line-height:1.5; }
`;
  /* ---------------- 结构 ---------------- */

  function template() {
    return `
<div class="wrap">
  <div class="panel" id="panel">
    <div class="hd">
      <div class="t">CX 考试 AI 大脑</div>
      <div class="x cfg" data-act="syncmask" title="云同步 · 输入同步码">⇅</div>
      <div class="x close" data-act="hide" title="收起面板">✕</div>
    </div>
    <div class="syncfail" id="syncfail"><span class="t"></span><span class="x" data-act="syncfail-close" title="关闭">✕</span></div>
    <div class="stat">
      <div><b id="s-total">0</b><span>题目</span></div>
      <div><b id="s-done">0</b><span>已答</span></div>
      <div><b id="s-fail">0</b><span>失败</span></div>
      <div><b id="s-todo">0</b><span>未答</span></div>
      <div><b id="s-model">0</b><span>模型</span></div>
    </div>
    <div class="setupbar" id="setupbar">
      <span>本域还没有模型配置：点「输入同步码」粘贴一次，或去设置中心配</span>
      <button class="b" data-act="syncmask">输入同步码</button>
      <button class="b" data-act="open-settings">设置中心</button>
    </div>
    <div class="bar">
      <button class="b primary" data-act="next" title="答下一道还没答的题">答一题</button>
      <button class="b" data-act="run" title="从头连答到底">自动连答</button>
      <button class="b" id="btn-showonly" data-act="showonly" title="开=只判题显示答案，不点击选项；关=判定后自动点选落盘">仅显示</button>
      <button class="b" data-act="pause">暂停</button>
      <button class="b danger" data-act="stop">停止</button>
    </div>
    <div class="qgrid" id="qgrid"></div>
    <div class="qdetail" id="qdetail"></div>
    <div class="logs" id="logs"></div>
    <div class="ft">Ctrl+Shift+X 呼出/隐藏<span class="lg-toggle" data-act="logs" title="展开/收起日志">日志</span><span id="s-state" class="ftstate">待机</span></div>
  </div>
  <div class="syncpop" id="syncpop">
    <div class="sh"><b>云同步</b><span id="syncpop-state"></span><span class="x" data-act="syncmask-close" title="关闭">✕</span></div>
    <div class="srow">
      <input id="sync-code" placeholder="同步码 abc123.xyz…" spellcheck="false" autocomplete="off">
      <button id="sync-confirm" data-act="sync-pull">同步</button>
    </div>
    <div class="hint" id="syncpop-hint">在设置中心点「生成同步码并上传」，把这串码粘进来；以后每次进考试页都会自动同步</div>
  </div>
  <div class="fx" id="fx"></div>
  <div class="gmode" id="gmode">
    <div class="g" data-dir="left">← 左滑：答一题</div>
    <div class="g" data-dir="up">↑ 上滑：自动连答</div>
    <div class="g" data-dir="down">↓ 下滑：隐藏/显示答案条</div>
  </div>
  <div class="gtoast" id="gtoast"></div>
  <div class="ball" id="ball"><span id="balllabel">CX</span></div>
  <div class="anscorner" id="anscorner">
    <div class="hd" data-act="anscorner-fold" title="点击展开/收起（答案条靠右下角显示全部已判定的答案）">
      <b>AI 答案</b><span class="cnt" id="anscorner-count"></span><span class="fold">▾</span>
    </div>
    <div class="list" id="anscorner-list"></div>
  </div>
</div>`;
  }

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'cx-ai-host';
    host.style.cssText = 'position:fixed;z-index:2147483000;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const box = document.createElement('div');
    box.innerHTML = template();
    root.appendChild(box);
    // 设置窗必须挂在 shadow 根上：它原先嵌在 .wrap/.panel 里，panel 收起时 display:none，
    // 展开时又被 46px 宽的 wrap 夹住，导致整块 0×0 点不到。
    const maskEl = box.querySelector('#mask');
    if (maskEl && maskEl.parentElement && maskEl.parentElement.id === 'panel') {
      root.appendChild(maskEl);
    }
    bind();
    setupBall();
    setupCornerDrag();
    render();

  }

  /** 卸掉整个界面（交卷/离开作答页时用）：节点移除，引用清空，之后可再 mount */
  function unmount() {
    try {
      if (docKeydown) document.removeEventListener('keydown', docKeydown);
    } catch (e) {}
    try {
      if (logOff) logOff();
    } catch (e) {}
    try {
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    } catch (e) {}
    docKeydown = null;
    logOff = null;
    resizeHandler = null;
    // 卸载时联动停掉全局副作用：boot 的 2s 交卷检测 interval、Guard 的弹窗轮询/伪装。
    // 旧实现 unmount 后这些定时器还在跑（2026-11-24 审查 #8）。
    try {
      if (typeof CXAI !== 'undefined' && CXAI._finishTimer) {
        clearInterval(CXAI._finishTimer);
        CXAI._finishTimer = null;
      }
    } catch (e) {}
    try {
      if (typeof CXAI !== 'undefined' && CXAI.Guard && CXAI.Guard.uninstall) CXAI.Guard.uninstall();
    } catch (e) {}
    try {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    } catch (e) {}
    host = null;
    root = null;
  }

  const $ = (sel) => (root ? root.querySelector(sel) : null);

  function bind() {
    root.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'ball') return; // 悬浮球的单击由 setupBall 处理（要和拖动区分）
      // 事件目标常常是行内的子节点（模型名、图标、文字），直接读 e.target 的 data-act
      // 会读不到 —— 表现就是"有时点得开、有时点不开"：点在空隙能开，点在文字上没反应。
      // 统一往上找最近一个带 data-act 的祖先。
      const actEl = e.target.closest ? e.target.closest('[data-act]') : null;
      const act =
        (e.target.getAttribute && e.target.getAttribute('data-act')) ||
        (actEl && actEl.getAttribute('data-act'));
      if (!act) return;
      switch (act) {
        case 'hide':
          togglePanel(false);
          break;
        case 'open-settings':
          openSettingsPage();
          break;
        case 'syncmask':
          openSync();
          break;
        case 'syncmask-close':
          closeSync();
          break;
        case 'syncfail-close': {
          const bar = $('#syncfail');
          if (bar) bar.classList.remove('show');
          break;
        }
        case 'sync-pull':
          runSync($('#sync-code') ? $('#sync-code').value : '');
          break;
        case 'run':
          CXAI.Engine.start();
          break;
        case 'next':
          CXAI.Engine.answerNext();
          break;
        case 'prefetch':
          CXAI.Engine.prefetch();
          break;
        case 'pause':
          CXAI.Engine.togglePause();
          break;
        case 'stop':
          CXAI.Engine.stop();
          break;
        case 'pick': {
          const row = e.target.closest ? e.target.closest('.qcard') : null;
          const n = Number((actEl && actEl.getAttribute('data-i')) || e.target.getAttribute('data-i') || (row && row.getAttribute('data-i')) || 0) || 0;
          if (n) {
            state.sel = n;
            render();
          }
          break;
        }
        case 'logs': {
          const lg = $('#logs');
          if (lg) lg.classList.toggle('show');
          break;
        }
        case 'showonly': {
          const cur = CXAI.Cfg.get('ui.showOnly', true) === true;
          try {
            CXAI.Cfg.set('ui.showOnly', !cur);
            if (CXAI.Cfg.save) CXAI.Cfg.save();
          } catch (err) {}
          toast(!cur ? '仅显示答案：开（判题后不点击选项）' : '自动点选：开（判定后落盘）');
          render();
          break;
        }
        case 'anscorner-fold': {
          const el = $('#anscorner');
          if (el) {
            el.classList.toggle('folded');
            try {
              CXAI.Store.set('ansCornerFold', el.classList.contains('folded'));
            } catch (err) {}
          }
          break;
        }
        case 'corner-copy': {
          let txt = '';
          try {
            txt = decodeURIComponent(actEl.getAttribute('data-a') || '');
          } catch (err) {
            txt = actEl.getAttribute('data-a') || '';
          }
          copyAnswerText(txt);
          break;
        }
        case 'corner-jump': {
          const n = Number(actEl.getAttribute('data-i')) || 0;
          if (n && CXAI.Engine && CXAI.Engine.jumpTo) CXAI.Engine.jumpTo(n);
          break;
        }
        case 'go': {
          const n = Number((actEl && actEl.getAttribute('data-i')) || e.target.getAttribute('data-i') || 0) || 0;
          if (n && CXAI.Engine && CXAI.Engine.jumpTo) CXAI.Engine.jumpTo(n);
          break;
        }
      }
    });
    docKeydown = function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault();
        togglePanel();
      }
    };
    document.addEventListener('keydown', docKeydown);
    logOff = CXAI.Log.on((entry) => appendLog(entry));
  }

  /* ---------------- 渲染 ---------------- */

  /**
   * 把浮球坐标夹进当前视口。
   * 为什么必须有：`uiPos` 是持久化的，换个显示器、把窗口从 2048 缩到 1024、
   * 或者笔记本拔掉外接屏之后，存下来的 left/top 就落在视口外 ——
   * 浮球 34px 大、`.panel` 又是相对 `.wrap` 的 absolute，于是整块 UI 一起消失，
   * 用户看到的就是"脚本不见了"（2026-11-17 实测：视口 1024×1153，存的 left=2006）。
   */
  function clampBallPos(left, top) {
    const w = window.innerWidth || 1024;
    const h = window.innerHeight || 768;
    const maxL = Math.max(2, w - 42);
    const maxT = Math.max(2, h - 42);
    const l = Math.round(Number(left));
    const t = Math.round(Number(top));
    return {
      left: Math.min(maxL, Math.max(2, isFinite(l) ? l : maxL)),
      top: Math.min(maxT, Math.max(2, isFinite(t) ? t : maxT))
    };
  }

  /** 面板贴着球的一侧展开：球在左半屏就往右开，别溢出屏幕 */
  function placePanel(ballLeft) {
    const p = $('#panel');
    if (!p) return;
    const x = ballLeft != null ? ballLeft : (root.querySelector('.wrap') || { getBoundingClientRect: () => ({ left: window.innerWidth - 40 }) }).getBoundingClientRect().left;
    if (x < 440) {
      p.style.left = '0';
      p.style.right = 'auto';
    } else {
      p.style.right = '0';
      p.style.left = 'auto';
    }
  }

  /**
   * 悬浮球的单击 / 双击。
   *   单击 = 直接开始答题（跑着的时候=暂停）
   *   双击 = 打开/收起整个面板
   * 用 260ms 定时器区分：单击先挂起，等这么久没有第二次点击才执行。
   */
  let ballClickTimer = null;
  let toastTimer = null;

  function toast(text) {
    const el = $('#gtoast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function modeNow() {
    return state.mode === 'auto' ? 'auto' : 'single';
  }

  /**
   * 悬浮球单击到底该干什么（2026-11-18 用户定义的状态机）：
   *   ① 本地没有同步码            → 'input'：单击打开同步码输入框
   *   ② 有同步码但没成功过 / 上次失败 → 'input'：同样让人重新填
   *   ③ 有同步码且同步成功        → 'answer'：单击开始答题
   * 判定全部读持久化的 Sync.state()，刷新页面后语义不变。
   */
  function syncGate() {
    try {
      const code = CXAI.Sync && CXAI.Sync.savedCode ? CXAI.Sync.savedCode() : '';
      if (!code) return 'input';
      const st = CXAI.Sync && CXAI.Sync.state ? CXAI.Sync.state() : null;
      if (!st || st.ok !== true) return 'input';
      return 'answer';
    } catch (e) {
      return 'input';
    }
  }

  /** 切换小球点击模式：single=点一下答一题 / auto=点一下跑完整卷 */
  function setMode(m, silent) {
    state.mode = m === 'auto' ? 'auto' : 'single';
    try {
      CXAI.Store.set('ballMode', state.mode);
    } catch (e) {}
    render();
    if (!silent) toast(state.mode === 'auto' ? '模式：自动连答（点一下跑完整卷）' : '模式：答一题（点一下答一道）');
  }

  /** 单击：按当前模式执行；双击：开合面板（260ms 内第二次点击算双击） */
  function onClickBall() {
    if (ballClickTimer) {
      clearTimeout(ballClickTimer);
      ballClickTimer = null;
      togglePanel();
      return;
    }
    ballClickTimer = setTimeout(function () {
      ballClickTimer = null;
      // 单击语义按同步状态走：没码 / 没成功过 → 输同步码；已同步成功 → 开始答题
      if (syncGate() === 'input') {
        try {
          const hasCode = !!(CXAI.Sync && CXAI.Sync.savedCode && CXAI.Sync.savedCode());
          toast(hasCode ? '上次没同步成功，先重新填一次同步码' : '先在下面粘贴同步码');
          openSync();
        } catch (e) {}
        return;
      }
      // 单击必须立刻有反馈：以前是静默执行，答题失败或没有可答题目时，
      // 用户看到的就是"点了根本没有任何反应"（2026-11-18 实测，被误判成同步码入口坏了）。
      try {
        const running = !!(CXAI.Engine.st && CXAI.Engine.st.running);
        if (modeNow() === 'auto') {
          if (running) {
            CXAI.Engine.togglePause();
            toast('已暂停 · 再点一下继续');
          } else {
            toast('自动连答启动…（双击小球开面板）');
            const p = CXAI.Engine.start();
            if (p && p.catch) p.catch((e) => toast('执行失败：' + ((e && e.message) || e)));
          }
        } else {
          if (running) {
            CXAI.Engine.stop();
            toast('已停止自动连答');
            return;
          }
          toast('答一题…（双击小球开面板 · ⇅ 填同步码）');
          const p = CXAI.Engine.answerNext();
          if (p && p.then) {
            p.then(function (r) {
              if (!r) return;
              if (r.reason === 'preview') toast('已切到整卷预览，加载完再点一下继续');
              else if (r.reason === 'all-answered') toast('这一页都答完了 ✓');
              else if (r.showOnly) toast('#' + r.q + ' 答案：' + (r.answer || '?') + ' · 右下角可见');
              else if (r.ok) toast('#' + r.q + ' 已答' + (r.next ? ' · 下一题 #' + r.next : ''));
              else if (r.reason === 'no-question') toast('这一页没识别到题目');
              else toast('#' + (r.q || '?') + ' 没写进去 · 双击开面板看原因');
            }).catch(function (e) {
              toast('执行失败：' + ((e && e.message) || e));
            });
          }
        }
      } catch (e) {
        toast('执行失败：' + ((e && e.message) || e));
      }
    }, 260);
  }

  /**
   * 悬浮球手势：
   *   单击        = 按当前模式执行（答一题 / 自动连答）
   *   双击        = 开合面板
   *   长按后左滑  = 切到「答一题」模式
   *   长按后上滑  = 切到「自动连答」模式
   *   直接拖动    = 摆位置（长按一旦触发就不再拖动，避免两种意图打架）
   */
  function setupBall() {
    const ball = $('#ball');
    const wrap = root.querySelector('.wrap');
    const gmode = $('#gmode');
    if (!ball || !wrap) return;
    try {
      const pos = CXAI.Store.get('uiPos', null);
      if (pos && pos.left != null) {
        const c = clampBallPos(pos.left, pos.top);
        wrap.style.left = c.left + 'px';
        wrap.style.top = c.top + 'px';
        wrap.style.right = 'auto';
        wrap.style.bottom = 'auto';
        if (c.left !== Math.round(Number(pos.left)) || c.top !== Math.round(Number(pos.top))) {
          // 旧坐标已越界：顺手写回修正值，免得下次打开又跑出去
          try {
            CXAI.Store.set('uiPos', c);
          } catch (e) {}
        }
      }
      const m = CXAI.Store.get('ballMode', '');
      if (m === 'auto' || m === 'single') state.mode = m;
    } catch (e) {}
    placePanel();

    // 窗口尺寸变化（含换显示器、缩放、全屏切换）后把球和面板拉回视口内
    try {
      resizeHandler = () => {
        try {
          const r = wrap.getBoundingClientRect();
          const c = clampBallPos(r.left, r.top);
          if (Math.abs(c.left - r.left) > 1 || Math.abs(c.top - r.top) > 1) {
            wrap.style.left = c.left + 'px';
            wrap.style.top = c.top + 'px';
            wrap.style.right = 'auto';
            wrap.style.bottom = 'auto';
            try {
              CXAI.Store.set('uiPos', c);
            } catch (e) {}
          }
          placePanel(c.left);
          try { avoidCornerOverlap(); } catch (e2) {}
        } catch (e) {}
      };
      window.addEventListener('resize', resizeHandler);
    } catch (e) {}

    let drag = null;
    let lpTimer = null;
    const LP_MS = 420;
    const GEST = 26;

    const showHint = (on) => {
      if (gmode) gmode.classList.toggle('show', !!on);
    };
    const markDir = (dir) => {
      if (!gmode) return;
      Array.from(gmode.querySelectorAll('.g')).forEach((g) => g.classList.toggle('on', !!dir && g.getAttribute('data-dir') === dir));
    };

    ball.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = wrap.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false, lp: false, dir: '' };
      try {
        ball.setPointerCapture(e.pointerId);
      } catch (err) {}
      clearTimeout(lpTimer);
      lpTimer = setTimeout(function () {
        if (!drag || drag.moved) return;
        drag.lp = true;
        ball.classList.add('dragging');
        showHint(true);
        markDir('');
      }, LP_MS);
      e.preventDefault();
    });

    ball.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (drag.lp) {
        // 长按之后：移动 = 选手势方向（不再拖动位置）
        let dir = '';
        if (dx <= -GEST && Math.abs(dx) >= Math.abs(dy)) dir = 'left';
        else if (dy <= -GEST && Math.abs(dy) > Math.abs(dx)) dir = 'up';
        else if (dy >= GEST && Math.abs(dy) > Math.abs(dx)) dir = 'down';
        if (dir !== drag.dir) {
          drag.dir = dir;
          markDir(dir);
        }
        e.preventDefault();
        return;
      }
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        drag.moved = true;
        clearTimeout(lpTimer);
      }
      if (!drag.moved) return;
      const left = Math.min(window.innerWidth - 42, Math.max(2, drag.ox + dx));
      const top = Math.min(window.innerHeight - 42, Math.max(2, drag.oy + dy));
      wrap.style.left = left + 'px';
      wrap.style.top = top + 'px';
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
      e.preventDefault();
    });

    const finish = () => {
      clearTimeout(lpTimer);
      if (!drag) return;
      const d = drag;
      drag = null;
      ball.classList.remove('dragging');
      showHint(false);
      if (d.lp) {
        if (d.dir === 'left') setMode('single');
        else if (d.dir === 'up') setMode('auto');
        else if (d.dir === 'down') toggleCorner();
        else toast('已取消（没选方向）');
        return;
      }
      if (!d.moved) {
        onClickBall();
        return;
      }
      const r = wrap.getBoundingClientRect();
      try {
        CXAI.Store.set('uiPos', { left: Math.round(r.left), top: Math.round(r.top) });
      } catch (err) {}
      placePanel(r.left);
    };

    ball.addEventListener('pointerup', (e) => {
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch (err) {}
      finish();
    });
    ball.addEventListener('pointercancel', () => {
      drag = null;
      clearTimeout(lpTimer);
      ball.classList.remove('dragging');
      showHint(false);
    });
  }

  function togglePanel(force) {
    const p = $('#panel');
    if (!p) return;
    const show = force != null ? force : !p.classList.contains('show');
    p.classList.toggle('show', show);
    if (show) placePanel();
    try {
      CXAI.Store.set('uiOpen', show);
    } catch (e) {}
  }

  /** 球和答案条避让（2026-11-24）：答案条可见且与球重叠时，把球挪到答案条正上方贴边 */
  function avoidCornerOverlap() {
    try {
      const box = $('#anscorner');
      const wrapEl = root && root.querySelector('.wrap');
      if (!box || !wrapEl || box.style.display === 'none') return;
      const c = box.getBoundingClientRect();
      if (!c.width || !c.height) return;
      const b = wrapEl.getBoundingClientRect();
      const overlap = !(b.right < c.left + 4 || b.left > c.right - 4 || b.bottom < c.top + 4 || b.top > c.bottom - 4);
      if (!overlap) return;
      const top = Math.max(4, Math.round(c.top - b.height - 12));
      wrapEl.style.top = top + 'px';
      wrapEl.style.left = Math.max(4, Math.round(c.right - b.width - 6)) + 'px';
      wrapEl.style.right = 'auto';
      wrapEl.style.bottom = 'auto';
    } catch (e) {}
  }

  function render() {
    if (!root) return;
    const set = (id, v) => {
      const el = $('#' + id);
      if (el) el.textContent = v;
    };
    const rows = rowsForRender();
    const answered = rows.filter((r) => r.status === 'ok' || r.status === 'skip').length;
    // 失败 / 需人工也算"处理过"：把它们只藏在底部角标里，用户看到的就是
    // "明明走了 5 题、面板只说答了 2 题"（2026-11-18 实测反馈）。这里单独给一个「失败」格子。
    const failed = rows.filter((r) => r.status === 'fail' || r.status === 'manual').length;
    const total = Math.max(state.total || 0, rows.length);
    state.answered = answered;
    state.failed = failed;
    state.todo = Math.max(0, total - answered - failed);
    set('s-total', total);
    set('s-done', answered);
    set('s-fail', failed);
    set('s-todo', state.todo);
    const failEl = $('#s-fail');
    if (failEl && failEl.parentNode) failEl.parentNode.classList.toggle('bad', failed > 0);
    set('s-model', state.providers);
    set('s-page', state.pageKind);
    set('s-state', (state.running ? (state.paused ? '已暂停' : '运行中') : '待机') +
      (state.pageKind && state.pageKind !== '-' ? ' · ' + state.pageKind : '') +
      (failed ? ' · 失败 ' + failed : '') +
      ' · ' + (state.mode === 'auto' ? '自动连答' : '答一题'));
    renderQGrid(rows);
    renderQDetail(rows);
    renderCorner(rows);
    avoidCornerOverlap();
    const soBtn = $('#btn-showonly');
    if (soBtn) {
      const on = CXAI.Cfg.get('ui.showOnly', true) === true;
      soBtn.textContent = on ? '仅显示' : '自动点选';
      soBtn.classList.toggle('primary', on);
      soBtn.title = on
        ? '当前仅显示答案（不点击选项）。点一下切换为自动点选落盘'
        : '当前自动点选落盘。点一下切回「仅显示答案」';
    }
    const ball = $('#ball');
    if (ball) ball.classList.toggle('busy', state.running && !state.paused);
    if (ball) ball.classList.toggle('needs-setup', !!state.needSetup && !state.running);
    // 同步失败：小球左上角红点（和"没配置"的橙点区分开），面板顶部保留原因
    const synced = state.sync || {};
    const failMs = Math.max(0, Number(CXAI.Cfg.get('ui.syncFailMs', 180000)) || 0);
    const failFresh = synced.ok === false && (!failMs || Date.now() - (Number(synced.at) || 0) < failMs);
    if (ball) ball.classList.toggle('sync-err', !!failFresh && synced.ok !== true);
    if (synced.ok === true) {
      const sbar = $('#syncfail');
      if (sbar) sbar.classList.remove('show');
    }
    const setupBar = $('#setupbar');
    if (setupBar) setupBar.classList.toggle('show', !!state.needSetup);
    const label = $('#balllabel');
    const gate = syncGate();
    if (label) {
      if (state.doneAll && !state.running) label.textContent = 'OK';
      else if (state.running) label.textContent = String(state.answered || 0);
      else if (gate === 'input') label.textContent = '⇅'; // 球上直接提示"点我是填同步码"
      else label.textContent = 'CX';
    }
    if (ball) {
      try {
        ball.title =
          gate === 'input'
            ? '单击：填同步码 · 双击：打开面板'
            : '单击：' + (state.mode === 'auto' ? '自动连答' : '答一题') + ' · 双击：打开面板';
      } catch (e) {}
    }
    if (ball) {
      ball.classList.toggle('running', !!state.running && !state.doneAll);
      ball.classList.toggle('done', !!state.doneAll && !state.running);
    }
    const runBtn = $('[data-act="run"]');
    if (runBtn) {
      runBtn.textContent = state.running ? '运行中…' : '自动连答';
      runBtn.disabled = state.running;
    }
  }

  function update(patch) {
    Object.assign(state, patch || {});
    render();
  }

  /** 答案进剪贴板（navigator.clipboard 优先，非安全上下文退 execCommand） */
  function copyAnswerText(t) {
    t = String(t || '').trim();
    if (!t) return;
    const done = () => toast('答案已复制 ✓');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;opacity:0;left:-999px';
        (document.body || document.documentElement).appendChild(ta);
        ta.select();
        document.execCommand('copy');
        (ta.parentNode || document.body).removeChild(ta);
        done();
      } catch (e) {
        toast('复制失败，请手动选中答案');
      }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(fallback);
      } else fallback();
    } catch (e) {
      fallback();
    }
  }

  /* ---------------- 右下角答案条 ---------------- */

  /**
   * 判定结果一出来就出现在右下角靠边：题号 + 答案。
   *   选择/判断题行：点击 = 滚动跳到该题；
   *   填空/简答/论述等文本行：点击 = 完整答案复制进剪贴板。
   * 数据直接吃 rowsForRender()（pushQuestion 已写入的清单），不另开数据通道。
   */
  const CORNER_TEXT_RE = /填空|简答|论述|名词解释|计算题|听力|口语|附件|阅读|翻译|作文/;

  function cornerAnswerText(a) {
    // 判断题答案若是 true/false，给人话：对 / 错
    const t = String(a == null ? '' : a).trim();
    if (/^(true|t|1|正确|对|√)$/i.test(t)) return '对';
    if (/^(false|f|0|错误|错|否|×)$/i.test(t)) return '错';
    return t;
  }

  function renderCorner(rows) {
    const box = $('#anscorner');
    if (!box) return;
    const show = CXAI.Cfg.get('ui.answerCorner', true) !== false && !cornerHidden();
    box.style.display = show ? 'flex' : 'none';
    if (!show) return;
    try {
      if (CXAI.Store.get('ansCornerFold', false)) box.classList.add('folded');
    } catch (e) {}
    applyCornerPos(box);
    const list = $('#anscorner-list');
    const cnt = $('#anscorner-count');
    if (!list) return;
    const esc = (t) => CXAI.U.escapeHtml(String(t == null ? '' : t));
    const all = rows || [];
    const items = all.filter((r) => r && !r.placeholder && String(r.answer || '').trim());
    const total = Math.max(state.total || 0, all.length);
    if (cnt) cnt.textContent = '已判 ' + items.length + '/' + total + (state.prefetched ? ' · 预取 ' + state.prefetched : '');
    if (!items.length) {
      list.innerHTML = '<div class="empty">还没有判定结果 —— 检测到题目后会自动判题，答案出现在这里</div>';
      return;
    }
    list.innerHTML = items
      .map((it) => {
        const n = Number(it.index) || 0;
        const raw = String(it.answer || '').trim();
        const a = cornerAnswerText(raw);
        const isTxt = CORNER_TEXT_RE.test(String(it.typeLabel || '')) || !/^[A-Ha-h｜|\s]+$/.test(a);
        const short = a.length > 40 ? a.slice(0, 40) + '…' : a;
        const tip = '#' + n + ' ' + a + (isTxt ? '（点击复制）' : '（点击跳到该题）');
        return '<div class="arow' + (isTxt ? ' txt' : '') + '" data-act="' + (isTxt ? 'corner-copy' : 'corner-jump') +
          '" data-i="' + esc(n) + '" data-a="' + esc(encodeURIComponent(a)) + '" title="' + esc(tip) + '">' +
          '<b>' + esc(n || '?') + '</b><span class="a">' + esc(short) + '</span></div>';
      })
      .join('');
  }

  /* ---- 答案条：隐藏/显示 + 拖动 ----
   * 隐藏：长按 CX 球下滑（toggleCorner，持久化 ansCornerHidden）；
   * 拖动：按住答案条头部拖（移动超过 8px 算拖动，否则还是"点击折叠"），位置存 cornerPos。
   */
  function cornerHidden() {
    try { return CXAI.Store.get('ansCornerHidden', false) === true; } catch (e) { return false; }
  }

  function toggleCorner() {
    const next = !cornerHidden();
    try { CXAI.Store.set('ansCornerHidden', next); } catch (e) {}
    const box = $('#anscorner');
    if (box) box.style.display = next ? 'none' : 'flex';
    toast(next ? '答案条已隐藏（长按球下滑可再打开）' : '答案条已显示');
    render();
  }

  /** 把持久化的答案条位置夹回视口内并应用（默认仍走 CSS 的 right/bottom 靠边） */
  function applyCornerPos(box) {
    try {
      const pos = CXAI.Store.get('cornerPos', null);
      if (!pos || pos.left == null) return;
      const w = window.innerWidth || 1024;
      const h = window.innerHeight || 768;
      const rect = box.getBoundingClientRect();
      const bw = rect.width || 216;
      const bh = rect.height || 40;
      const left = Math.min(Math.max(4, pos.left), Math.max(4, w - bw - 4));
      const top = Math.min(Math.max(4, pos.top), Math.max(4, h - bh - 4));
      box.style.right = 'auto';
      box.style.bottom = 'auto';
      box.style.left = Math.round(left) + 'px';
      box.style.top = Math.round(top) + 'px';
    } catch (e) {}
  }

  /** 答案条头部拖动：按住 .hd 拖走整条；没超过 8px 的按下抬起 = 折叠/展开 */
  function setupCornerDrag() {
    const box = $('#anscorner');
    const hd = box ? box.querySelector('.hd') : null;
    if (!box || !hd || hd._cxaiDrag) return;
    hd._cxaiDrag = true;
    let drag = null;
    hd.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = box.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
      try { hd.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    hd.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy) * 0.4) drag.moved = true;
      if (!drag.moved && Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) * 0.4) drag.moved = true;
      if (!drag.moved) return;
      box.style.right = 'auto';
      box.style.bottom = 'auto';
      box.style.left = Math.round(drag.ox + dx) + 'px';
      box.style.top = Math.round(drag.oy + dy) + 'px';
      e.preventDefault();
    });
    const done = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      try { hd.releasePointerCapture(e.pointerId); } catch (err) {}
      if (d.moved) {
        const r = box.getBoundingClientRect();
        try { CXAI.Store.set('cornerPos', { left: Math.round(r.left), top: Math.round(r.top) }); } catch (err) {}
        applyCornerPos(box);
        try { avoidCornerOverlap(); } catch (err) {}
      }
      // 没拖动 → 交回原有 data-act="anscorner-fold" 的点击逻辑（click 会自然触发）
    };
    hd.addEventListener('pointerup', done);
    hd.addEventListener('pointercancel', () => { drag = null; });
  }

  function appendLog(entry) {
    const box = $('#logs');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'lg ' + (entry.level || 'info');
    const t = new Date(entry.t);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    div.textContent = `${hh}:${mm}:${ss} ${entry.msg}`;
    box.appendChild(div);
    const maxLines = Math.max(50, Number(CXAI.Cfg.get('ui.logMax', 300)) || 300);
    while (box.children.length > maxLines) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 作答清单：一题一格 + 点开看详情 ---------------- */

  /**
   * 把"清单记录 + 还没做过的题号"合成完整的一张表（每道题都要有一格）。
   * 换卷后旧清单要丢掉：清单按 paperKey 存，纸一换就重置（用户明确要求"不用留"）。
   */
  function rowsForRender() {
    const items = state.qlist || [];
    let maxNo = 0;
    items.forEach((it) => {
      maxNo = Math.max(maxNo, Number(it.index) || 0);
    });
    const total = Math.max(state.total || 0, maxNo);
    const byNo = {};
    items.forEach((it) => {
      const n = Number(it.index) || 0;
      if (n) byNo[n] = it;
    });
    const rows = [];
    for (let i = 1; i <= total; i++) rows.push(byNo[i] || { index: i, status: 'todo', placeholder: true });
    items.forEach((it) => {
      const n = Number(it.index) || 0;
      if (!n || n > total) rows.push(it);
    });
    return rows;
  }

  const STATUS_WORD = { ok: '已答', skip: '已答·原有', fail: '失败', wait: '作答中', manual: '需人工', todo: '未答' };

  function statusOf(it) {
    const n = Number(it.index) || 0;
    let st = it.status || 'todo';
    const cur = Number(state.current) || 0;
    const pend = state.pending && Number(state.pending.index) ? Number(state.pending.index) : 0;
    if (st === 'todo' && (n === cur || n === pend) && state.running) st = 'wait';
    return st;
  }

  function clsOf(st) {
    // skip = 页面上已答、且与 AI 判定一致（fixWrong 认定答对）：这是"对的"，必须显示绿色；
  // 旧映射把它当中性色，用户看到的就是"答对了还是黄框"。
  return st === 'ok' || st === 'skip' ? 'ok' : st === 'wait' ? 'wait' : st === 'fail' || st === 'manual' ? 'err' : 'todo';
  }

  /** 题号格子：颜色=状态，点击=在下方面板看这题的选项与 AI 作答 */
  function renderQGrid(rows) {
    const box = $('#qgrid');
    if (!box) return;
    rows = rows || rowsForRender();
    if (!rows.length) {
      box.innerHTML = '<div class="qempty">还没有题目 —— 进入考试/作业页后这里会出现题号格子</div>';
      return;
    }
    const esc = (t) => CXAI.U.escapeHtml(String(t == null ? '' : t));
    const cur = Number(state.current) || 0;
    const sel = Number(state.sel) || 0;
    box.innerHTML = rows
      .map((it) => {
        const n = Number(it.index) || 0;
        const st = statusOf(it);
        const cls = clsOf(st);
        // 只允许一个格子高亮：跑批时跟 current，停下来时用你点过的 sel。
        // 旧实现 cur / sel 各画一个框，面板上会同时亮两题（实测 7 和 9 一起亮）。
        const active = Number(state.running ? cur : sel || cur) || 0;
        const isCur = n && n === active;
        const isSel = false;
        const tip = [`#${n}`, STATUS_WORD[st] || '', it.typeLabel || '', it.answer || it.actual ? '答：' + (it.answer || it.actual) : '', it.stem || '']
          .filter(Boolean)
          .join(' · ');
        // 数字下面再挂一行答案：整卷十几题时不用逐个点开就能看出哪题答了什么
        const ansRaw = String(it.answer || it.actual || '').replace(/\s+/g, '');
        const ansTxt = ansRaw ? (ansRaw.length > 4 ? ansRaw.slice(0, 4) + '…' : ansRaw) : '';
        return '<div class="qcard ' + cls + (isCur ? ' cur' : '') + (isSel ? ' sel' : '') +
          '" data-act="pick" data-i="' + esc(n) + '" title="' + esc(tip) + '">' +
          '<b>' + esc(n || '?') + '</b>' + (ansTxt ? '<i>' + esc(ansTxt) + '</i>' : '') + '</div>';
      })
      .join('');
    // 选中/当前格滚进视野
    const focus = box.querySelector('.qcard.sel') || box.querySelector('.qcard.cur');
    if (focus && focus.scrollIntoView) {
      try {
        focus.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (e) {}
    }
  }

  /** 选中题的下方详情：题干 / 选项（AI 选中的高亮）/ AI 答案 / 页面答案 / 置信度 */
  function renderQDetail(rows) {
    const box = $('#qdetail');
    if (!box) return;
    rows = rows || rowsForRender();
    const esc = (t) => CXAI.U.escapeHtml(String(t == null ? '' : t));
    let sel = Number(state.sel) || 0;
    if (!sel) {
      // 没选过就看当前题
      sel = Number(state.current) || Number(state.pending && state.pending.index) || 0;
      if (!sel && rows.length) sel = Number(rows[0].index) || 0;
    }
    const pend = state.pending && Number(state.pending.index) === sel ? state.pending : null;
    let it = rows.filter((r) => Number(r.index) === sel)[0];
    if (!it && pend) it = { index: sel, status: 'todo', placeholder: true, stem: pend.stem, typeLabel: pend.typeLabel };
    if (!it) {
      box.innerHTML = '<div class="qempty">点上面的题号格子，这里显示那道题的题目、选项和 AI 作答</div>';
      return;
    }
    const st = statusOf(it);
    const aiLetters = String(it.answer || '').toUpperCase().replace(/[^A-H]/g, '');
    const pgLetters = String(it.actual || '').toUpperCase().replace(/[^A-H]/g, '');
    const opts = (it.options && it.options.length ? it.options : []).map((o) => {
      const k = String(o.k || o.key || '').toUpperCase();
      const mark = aiLetters.indexOf(k) >= 0 ? ' ai' : pgLetters.indexOf(k) >= 0 ? ' pg' : '';
      const flag = pgLetters.indexOf(k) >= 0 ? ' ✓' : '';
      return '<li class="' + mark.trim() + '"><b>' + esc(k) + '</b><span>' + esc(String(o.t || o.text || '')) + flag + '</span></li>';
    }).join('');
    // 底部信息只显示"有值且有意义"的行：不再出现 ? / - 这种占位符
    const conf = it.confidence != null && Number(it.confidence) > 0 ? Math.round(Number(it.confidence) * 100) + '%' : '';
    const stageWord = {
      panel: '议会投票', critique: '交叉复核', arbiter: '仲裁裁决', fallback: '兜底取值',
      cached: '复用本次判定', stored: '复用上次判定', stem: '题干自带'
    };
    // 字母答案顺手翻成选项文字：B → B（北京），省得对着字母回看页面
    const letterize = (val) => {
      const raw = String(val == null ? '' : val).trim();
      if (!raw) return '';
      if (!/^[A-Ha-h]+$/.test(raw) || !it.options || !it.options.length) return raw;
      return raw.toUpperCase().split('').map((c) => {
        const o = it.options.filter((x) => String(x.k || '').toUpperCase() === c)[0];
        return o ? c + '（' + String(o.t || '').slice(0, 18) + '）' : c;
      }).join('  ');
    };
    const norm2 = (v) => String(v || '').replace(/[\s（）()·]/g, '').toUpperCase();
    const aiTxt = letterize(it.answer);
    const pgTxt = letterize(it.actual);
    const meta = [];
    if (aiTxt) {
      meta.push('<div class="kv"><span class="k">AI 判定</span><span class="v ai">' + esc(aiTxt) + '</span>' +
        (conf ? '<span class="chip">置信度 ' + conf + '</span>' : '') +
        (stageWord[it.stage] ? '<span class="chip">' + esc(stageWord[it.stage]) + '</span>' : '') + '</div>');
    }
    if (pgTxt) {
      const same = aiTxt && norm2(aiTxt) === norm2(pgTxt);
      meta.push('<div class="kv"><span class="k">页面已存</span><span class="v pg">' + esc(pgTxt) + '</span>' +
        (aiTxt
          ? (same ? '<span class="chip ok">与 AI 一致</span>' : '<span class="chip bad">与 AI 不一致</span>')
          : '<span class="chip">你手动作答 · AI 未参与</span>') + '</div>');
    }
    // 判定的"人话解释"：依据 / 各模型投了什么 / 降级原因（全题型兜底时尤其重要）
    if (it.reason) meta.push('<div class="kv"><span class="k">依据</span><span class="v muted">' + esc(CXAI.U.truncate(String(it.reason), 160)) + '</span></div>');
    if (it.votes && it.votes.length) {
      const vs = it.votes.slice(0, 5).map(function (v) {
        return esc(CXAI.U.truncate(v.who || '模型', 12) + ' ' + (v.answer || '?') + ' ' + (v.confidence != null ? Math.round(v.confidence * 100) + '%' : ''));
      });
      meta.push('<div class="kv"><span class="k">模型票</span><span class="v muted">' + vs.join(' · ') + (it.votes.length > 5 ? ' …' : '') + '</span></div>');
    }
    if (it.errors && it.errors.length) {
      meta.push('<div class="kv"><span class="k">降级</span><span class="v muted">' + esc(CXAI.U.truncate(it.errors.slice(-1)[0], 160)) + '</span></div>');
    }
    if (!meta.length) meta.push('<div class="kv"><span class="v muted">这题还没作答</span></div>');
    box.innerHTML =
      '<div class="qd-hd">' +
      '<span class="qn">#' + esc(it.index) + '</span>' +
      '<span class="tag">' + esc(it.typeLabel || '') + '</span>' +
      (it.shellLabel ? '<span class="tag">' + esc(it.shellLabel) + '</span>' : '') +
      '<span class="st ' + clsOf(st) + '">' + (STATUS_WORD[st] || '未答') + '</span>' +
      '<span class="qd-jump" data-act="go" data-i="' + esc(it.index) + '">跳到该题</span>' +
      '</div>' +
      '<div class="qd-stem">' + esc(it.stem || (it.placeholder ? '这题还没有作答记录（点「开始答题」，或手动作答后回来查看）' : '(没有题干)')) + '</div>' +
      (opts ? '<ul class="qd-opts">' + opts + '</ul>' : '') +
      '<div class="qd-meta">' + meta.join('') + '</div>';
  }

  /* ---------------- 清单存储（按卷隔离，换卷即清空） ---------------- */

  function paperNow() {
    try {
      return CXAI.Scraper.paperKey ? CXAI.Scraper.paperKey() : '';
    } catch (e) {
      return '';
    }
  }

  function getQList() {
    try {
      const saved = CXAI.Store.get('qlist', null);
      if (!saved) return [];
      // 老格式（纯数组）直接当成"上一份卷子"，丢掉
      if (Array.isArray(saved)) return [];
      if (saved.paper !== paperNow()) return [];
      return saved.rows || [];
    } catch (e) {
      return [];
    }
  }

  function saveQList(rows) {
    try {
      CXAI.Store.set('qlist', { paper: paperNow(), rows: rows || [] });
    } catch (e) {}
  }

  /** 记一条作答记录（同一题重复处理只覆盖，不重复堆格子） */
  function pushQuestion(rec) {
    if (!rec) return;
    const arr = getQList().slice();
    const key = rec.key || 'qid:' + (rec.qid || rec.index);
    const at = arr.findIndex((x) => (x.key || 'qid:' + (x.qid || x.index)) === key);
    const item = Object.assign({}, rec, { key });
    if (at >= 0) arr[at] = item;
    else arr.push(item);
    const rows = arr.slice(-300);
    state.qlist = rows;
    saveQList(rows);
    // 图谱跟着当前题走：新记录进来就把详情切到这道题
    if (rec.status === 'ok' || rec.status === 'fail' || rec.status === 'skip') state.sel = Number(rec.index) || state.sel;
    render();
  }

  /** 追加一道题的判定结果卡片 */
  function addQuestionCard(q, result, applyResult) {
    const box = $('#logs');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'q';
    const ok = applyResult && applyResult.ok;
    const low = result && result.lowConfidence;
    const cls = !ok ? 'ans err' : low ? 'ans low' : 'ans';
    const shown = result ? (result.answerText || '?') : '跳过';
    const conf = result ? Math.round((result.confidence || 0) * 100) + '%' : '-';
    const stageMap = { panel: '议会', critique: '复核', arbiter: '仲裁', fallback: '兜底', cached: '缓存' };
    const votes = result && result.votes ? result.votes.length : 0;
    const agree = result && result.ratio != null ? Math.round(result.ratio * 100) + '%' : '-';
    div.innerHTML = `
      <div class="h">
        <span class="idx">#${(q.index || 0) + 1}</span>
        <span class="tag">${CXAI.U.escapeHtml(q.typeLabel)}</span>
        <span class="${cls}">${CXAI.U.escapeHtml(shown)}</span>
      </div>
      <div class="stem">${CXAI.U.escapeHtml(q.stem || '(无题干)')}</div>
      <div class="meta">置信度 <em>${conf}</em> · 一致率 <em>${agree}</em> · 阶段 <em>${stageMap[result && result.stage] || '-'}</em> · 投票 <em>${votes}</em>${ok ? '' : ' · <em style="color:#ef7676">写入失败</em>'}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 设置面板 ---------------- */

  /**
   * 预设下拉显示的应该是"这份配置实际像哪个预设"，而不是历史存下来的 preset 字段。
   * 旧版本存过 preset:'deepseek'，用户后来把 Base URL 改成 magpie 网关，
   * 下拉还显示 DeepSeek —— 就是这个原因。这里按 Base URL 反查，查不到再退回存的值。
   */
  function settingsURL() {
    try {
      const u = CXAI.Cfg.get('ui.settingsURL', '');
      if (u) return String(u);
    } catch (e) {}
    return DEFAULT_SETTINGS_URL;
  }

  /** 新标签打开设置中心：同一份 GM 存储，改完回考试页直接生效 */

  /* ---------------- 云同步：小球旁的气泡 + 成功/失败特效 ----------------
   * 2026-11-18 重做：
   *   · 输入位置就在 CX 悬浮球上方（一个输入框 + 一个「同步」按钮，别的一律不要）；
   *   · 成功：绿圈扩散 + 小球弹一下 + 气泡变绿打勾，1.6s 后自动收起；
   *   · 失败：气泡红框抖动 + 红圈扩散，并把**具体原因**写到双击小球打开的面板顶部，
   *     同时自动把面板打开（失败必须让人看见，不能只留一行日志）。
   */

  function popEl() {
    return $('#syncpop');
  }

  function fx(kind) {
    const el = $('#fx');
    if (!el) return;
    el.className = 'fx';
    // 重新触发动画：先摘类、强制回流、再加类
    void el.offsetWidth;
    el.classList.add('show', kind === 'ok' ? 'ok' : 'err');
    setTimeout(function () {
      try {
        el.classList.remove('show', 'ok', 'err');
      } catch (e) {}
    }, 1800);
  }

  function syncHint(text, cls) {
    const hint = $('#syncpop-hint');
    if (!hint) return;
    hint.textContent = text;
    const pop = popEl();
    if (!pop) return;
    pop.classList.remove('done', 'fail');
    if (cls) pop.classList.add(cls);
  }

  /** 打开同步气泡（默认挂在悬浮球上方；视口上方不够就翻到下方） */
  function openSync(opt) {
    opt = opt || {};
    const pop = popEl();
    if (!pop) return;
    const input = $('#sync-code');
    const code = CXAI.Sync && CXAI.Sync.savedCode ? CXAI.Sync.savedCode() : '';
    if (input) {
      input.value = code;
      try {
        input.focus();
        input.select();
      } catch (e) {}
    }
    const st = state.sync || {};
    if (st.busy) syncHint('正在同步…', '');
    else if (code) syncHint('已存同步码 ' + code.slice(0, 8) + '… · 改完配置点「同步」立即拉取；进考试页也会自动同步', '');
    else syncHint('在设置中心点「生成同步码并上传」，把这串码粘进来；以后每次进考试页都会自动同步', '');

    pop.classList.add('show');
    // 位置：球在屏幕上半部就往下开，否则往上开
    try {
      const wrap = root.querySelector('.wrap');
      const r = wrap ? wrap.getBoundingClientRect() : null;
      if (r && r.top < 250) {
        pop.style.bottom = 'auto';
        pop.style.top = '42px';
      } else {
        pop.style.top = 'auto';
        pop.style.bottom = '42px';
      }
    } catch (e) {}
    if (opt.auto) {
      // 新用户自动弹出：给一次轻微提示，不打断输入
      try {
        toast('粘一次同步码即可开始');
      } catch (e) {}
    }
    render();
  }

  function closeSync() {
    const pop = popEl();
    if (!pop) return;
    pop.classList.remove('show', 'done', 'fail');
  }

  /** 同步成功：绿圈 + 弹一下 + 气泡打勾，然后自动收起 */
  function syncOk(r) {
    const models = Number((r && r.models) || 0);
    const msg = '✓ 同步成功 · 模型 ' + models + ' 个';
    state.sync = { ok: true, busy: false, msg: msg, at: Date.now(), models: models, fx: 'ok' };
    syncHint(msg + '（配置已写入本域）', 'done');
    const btn = $('#sync-confirm');
    if (btn) {
      btn.textContent = '已同步';
      btn.disabled = true;
    }
    const bar = $('#syncfail');
    if (bar) bar.classList.remove('show');
    const ball = $('#ball');
    if (ball) {
      ball.classList.remove('sync-err');
      ball.classList.add('synced');
      setTimeout(function () {
        try {
          ball.classList.remove('synced');
        } catch (e) {}
      }, 900);
    }
    fx('ok');
    toast(msg);
    update({ needSetup: false, providers: CXAI.Cfg.activeProviders().length });
    CXAI.Log.ok('云同步完成 · 模型 ' + models + ' 个');
    setTimeout(function () {
      try {
        closeSync();
        const b2 = $('#sync-confirm');
        if (b2) {
          b2.textContent = '同步';
          b2.disabled = false;
        }
      } catch (e) {}
    }, 1600);
    render();
  }

  /**
   * 同步失败：红圈 + 气泡抖动，并把原因写进面板顶部（双击小球打开的那个面板）。
   * @param {{error:string, at?:number, code?:string}} r
   */
  function syncFail(r) {
    const reason = String((r && (r.error || r.message)) || '未知原因');
    state.sync = { ok: false, busy: false, msg: reason, at: Date.now(), models: 0, fx: 'err' };
    syncHint('✗ 同步失败：' + reason, 'fail');
    const btn = $('#sync-confirm');
    if (btn) {
      btn.textContent = '重试';
      btn.disabled = false;
    }
    fx('err');
    toast('同步失败');
    // 面板顶部保留失败原因（含时间），并自动把面板打开 —— 失败必须让人一眼看到
    const bar = $('#syncfail');
    if (bar) {
      const t = bar.querySelector('.t');
      if (t) {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        t.innerHTML =
          '<b>同步失败</b> · ' +
          p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
          '<br>' + CXAI.U.escapeHtml(reason) +
          '<br><span style="color:#a16207">检查：同步码是否完整、设置中心是否点过「生成同步码并上传」、网络是否可达 cx-exam-ai.pages.dev</span>';
      }
      bar.classList.add('show');
    }
    try {
      togglePanel(true);
    } catch (e) {}
    CXAI.Log.error('云同步失败：' + reason);
    setTimeout(function () {
      try {
        closeSync();
      } catch (e) {}
    }, 2400);
    render();
  }

  /** 从气泡里读同步码并同步 */
  function runSync(raw) {
    const code = String(raw == null ? '' : raw).trim();
    const btn = $('#sync-confirm');
    const input = $('#sync-code');
    if (!code) {
      syncHint('先把同步码粘进来（形如 abc12345.xyz…）', 'fail');
      if (input) {
        try {
          input.focus();
        } catch (e) {}
      }
      return Promise.resolve(false);
    }
    if (!/^[A-Za-z0-9_-]{6,48}\.[A-Za-z0-9_-]{16,60}$/.test(code)) {
      syncFail({ error: '同步码格式不对（应该形如 abc12345.xyz…，中间有一个点）' });
      return Promise.resolve(false);
    }
    state.sync = { ok: null, busy: true, msg: '同步中…', at: Date.now() };
    if (btn) {
      btn.disabled = true;
      btn.textContent = '同步中…';
    }
    syncHint('正在从云端拉取并解密配置…', '');
    return CXAI.Sync.pullInto(code)
      .then(function (obj) {
        const n = (obj && obj.ai && obj.ai.providers ? obj.ai.providers.length : 0) || 0;
        syncOk({ models: n, at: Date.now() });
        return true;
      })
      .catch(function (e) {
        const msg = e && e.message ? e.message : String(e);
        try {
          CXAI.Sync.recordState({ ok: false, at: Date.now(), error: msg });
        } catch (e2) {}
        syncFail({ error: msg });
        return false;
      })
      .then(function (ok) {
        const b = $('#sync-confirm');
        if (b && !b.textContent.includes('已')) {
          b.disabled = false;
          b.textContent = ok ? '已同步' : '重试';
        }
        return ok;
      });
  }

  function openSettingsPage() {
    const url = settingsURL();
    try {
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      location.href = url;
    }
    CXAI.Log.info('已打开设置中心：' + url);
  }

  return {
    mount,
    unmount,
    update,
    addQuestionCard,
    pushQuestion,
    rowsForRender,
    renderQGrid,
    renderQDetail,
    appendLog,
    togglePanel,
    getQList,
    saveQList,
    settingsURL,
    openSettingsPage,
    openSync,
    closeSync,
    runSync,
    syncOk,
    syncFail,
    state
  };
})();