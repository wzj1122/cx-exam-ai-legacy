// ==UserScript==
// @name         CX 考试 AI 大脑 · 学习通考试自动答题
// @namespace    https://github.com/wzj1122/cx-exam-ai
// @version        1.13.0
// @description  超星学习通考试页专用：自动抓题 + 加密字体解密 + 附件题（PDF 题干）逐页转图 + 多模型交叉判定（无需题库）+ 拟人化点选。参考 ocsjs 架构重写。
// @author       wzj1122
// @license      MIT
// @homepageURL  https://github.com/wzj1122/cx-exam-ai
// @supportURL   https://github.com/wzj1122/cx-exam-ai/issues
// @updateURL    https://update.greasyfork.org/scripts/605687/CX%20%E8%80%83%E8%AF%95%20AI%20%E5%A4%A7%E8%84%91%20%C2%B7%20%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%80%83%E8%AF%95%E8%87%AA%E5%8A%A8%E7%AD%94%E9%A2%98.user.js
// @downloadURL  https://update.greasyfork.org/scripts/605687/CX%20%E8%80%83%E8%AF%95%20AI%20%E5%A4%A7%E8%84%91%20%C2%B7%20%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%80%83%E8%AF%95%E8%87%AA%E5%8A%A8%E7%AD%94%E9%A2%98.user.js
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        https://cx-exam-ai.pages.dev/*
// @match        https://wzj1122.github.io/cx-exam-ai/*
// @match        http://127.0.0.1/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==
(function () {
'use strict';

/* 全局命名空间：所有模块挂载到 CXAI 上，模块之间只依赖它 */
var CXAI = {};
CXAI.__version = "1.13.0";
CXAI.__builtAt = "2026-11-25T01:01:47.220Z";

/* ==================== 01-core.js ==================== */
/* ---------------- 配置 / 存储 / 工具 ---------------- */

CXAI.CONFIG_KEY = 'cxai.config.v3';

/**
 * 默认配置。
 * providers 里每一项都是一个 OpenAI 兼容端点，可自由增删。
 * 判定流水线参数见 judge。
 */
/**
 * 模型预设：设置面板里"添加模型"直接选一个，字段自动填好。
 * 任何一家都能改成本地地址；magpie / Ollama / LM Studio 是本地网关，允许无 Key。
 */
CXAI.PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    hint: '文本模型，便宜，适合做判题主力。模型名留空 —— 填好 Key 点「拉取」，按端点返回的清单选。'
  },
  {
    id: 'tokenrhythm',
    label: '基元律动',
    baseURL: 'https://tokenrhythm.studio/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    hint: '基元律动（TokenRhythm），OpenAI 兼容接口。填 Key 后点「拉取」，模型以清单为准。'
  },
  {
    id: 'qwen-vl',
    label: '通义千问 VL',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    apiStyle: 'openai',
    vision: true,
    hint: '阿里云百炼的视觉模型，能直接读题图；Key 在 DashScope 控制台申请'
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    hint: '纯文本，便宜、并发宽松，适合当议会里的普通一票'
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: '',
    apiStyle: 'openai',
    vision: false,
    hint: '中文题感不错；Key 在智谱开放平台申请'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: '',
    apiStyle: 'openai',
    vision: true,
    hint: '国内直连多半要走代理；也可以把 Base URL 指向任何 OpenAI 兼容中转'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    keyOptional: true,
    hint: '本地跑，不用 Key；点「拉取」会列出已经 pull 下来的模型'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseURL: 'http://127.0.0.1:1234/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    keyOptional: true,
    hint: '本地服务器开在 1234；点「拉取」选当前加载的那个'
  },
  {
    id: 'custom',
    label: '自定义模型',
    baseURL: '',
    model: '',
    apiStyle: 'openai',
    vision: false,
    hint: '任何 OpenAI 兼容端点都填这里。默认按 OpenAI 协议发（POST {base}/chat/completions，Authorization: Bearer）；只吃 Anthropic 协议的，在高级设置里把「接口协议」切过去。'
  }
];

CXAI.DEFAULT_CONFIG = {
  ai: {
    // 参与判定的模型面板（第一轮各自独立作答）
    // 字段说明：apiStyle=openai|anthropic|gemini，role=judge|vision|both
    // 默认一个模型都不预置：空 Key 的"模板模型"会让人以为已经配好了，
    // 新装用户打开设置页就该是空态 + 一键添加预设。
    providers: [],

    /** 读图（多模态）流水线 */
    vision: {
      /** 总开关：关闭后题目图片一律忽略 */
      enabled: true,
      /**
       * auto    面板里有视觉模型就直传图片，否则先用读图模型转写成文字
       * inline  一律把图片直传给支持视觉的模型
       * ocr     一律先转写文字，再给所有模型判题（最省 token，纯文本模型也能答图题）
       * off     忽略图片
       */
      strategy: 'ocr',
      /** 单题最多送几张图 */
      maxImages: 6,
      /** 缩放后最长边（px），越小越省 token */
      maxEdge: 1400,
      /** JPEG 质量 0.1~1 */
      quality: 0.82,
      /** 单题图片总大小上限（字节），超出后丢弃多余图片 */
      maxTotalBytes: 4194304,
      /** 拉图超时 */
      fetchTimeoutMs: 15000,
      /** 指定读图模型（provider.id），空=自动挑 */
      ocrProviderId: '',
      /** 读图模型是否同时参与判题投票（只配一个模型时打开） */
      judgeToo: false,
      /** 图片 / 转写结果的本地缓存条数 */
      cacheSize: 60
    },
    judge: {
      /** council=多模型议会(默认) | single=单模型直答 | fast=单模型+高温度自一致 */
      mode: 'council',
      /** 第一轮参与作答的模型数量（从 enabled 的 provider 里取，按权重排序） */
      panelSize: 3,
      /** 交叉复核：让别的模型审阅答案 */
      enableCritique: true,
      /** 仲裁：分歧时由权重最高模型做最终裁决 */
      enableArbiter: true,
      /** 加权一致率达到该值即直接采纳，跳过仲裁 */
      voteThreshold: 0.7,
      /** 低于该置信度的题目标记为"存疑"，仍然作答但高亮 */
      minConfidence: 0.55,
      /** 单题并发请求数 */
      concurrency: 3,
      /** 单次请求超时(ms) */
      timeoutMs: 90000,
      /** 失败重试次数 */
      retries: 1,
      /** 同一题最多复议轮数 */
      maxRounds: 2
    },
    /**
     * 全题型兜底（2026-11-18）。
     * 主判定（议会/复核/仲裁）失败时，按这条链继续要答案：
     *   ① 逐个模型用极简 prompt 重问（stage=rescue）
     *   ② 本地确定性兜底：题干自带答案 → 首选项（stage=heuristic，低置信度，界面标黄）
     * 关掉 enabled 就回到旧行为（失败即红）。
     */
    fallback: {
      enabled: true,
      /** 本地兜底：题干没写答案时，选择题按首个选项给一个"低置信度"答案 */
      heuristic: true,
      /** 兜底最多重问几个模型 */
      tries: 3
    }
  },
  answer: {
    /** auto=自动识别 | single=逐题翻页模式 | whole=整卷模式 */
    pageMode: 'auto',
    /** 全部答完后自动点击"下一题"翻页（单题模式） */
    autoNext: true,
    /** 全部答完后自动交卷（危险，默认关闭） */
    autoSubmit: false,
    /**
     * 优先切「整卷预览」：单题翻页模式下先点页面上的整卷预览入口，
     * 一页装下全部题目再作答（省掉逐题翻页，也避免翻页丢答案）。
     * 关掉后一律在当前页逐题作答。
     */
    preferPreview: true,
    /**
     * 附件题干通道：题目正文放在 PDF/Office 附件里（2026-11 期中考试实测的新题型）。
     * 打开后会把附件渲染成页图送读图、并把"作答框=整卷答题区"的说明写进 prompt。
     * 关掉只是不渲染附件（题干仍会带【附件材料】文件名）。
     */
    attach: true
  },
  /** 节奏控制与人机伪装（CXAI.Guard 读取；延时单位 ms） */
  guard: {
    /** 总开关：保持前台 + 自动确认弹窗 + 节奏控制 */
    enabled: true,
    /** 题间最短间隔，实际值在 min~max 间随机 */
    minDelay: 1400,
    /** 题间最长间隔 */
    maxDelay: 4200,
    /** 每做多少题插入一次长停顿 */
    longBreakEvery: 6,
    /** 自动点掉"确定/继续/保存"类确认弹窗 */
    autoConfirm: true,
    /**
     * 弹窗出现后等多少秒再自动关（0 = 只手动关，永不自动点）。
     * 有些弹窗里是"提交确认""分数提示""是否继续作答"这种可能要看的信息，
     * 立刻点掉容易把有用的东西一起带走，所以默认给 10 秒缓冲；
     * 期间你自己关掉了就什么都不会发生。
     */
    dialogDelaySec: 10,
    /** 拦截 F12 / 右键 / 调试快捷键 */
    blockDevtools: false
  },
  /** 落盘与提交行为 */
  apply: {
    /** 重做页面上已经作答的题 */
    overwriteAnswered: false,
    /**
     * 页面已有答案时是否纠正错误答案：
     *   true  = 先判定，再把页面答案与 AI 结论比对，不一致才重做（答对就跳过）
     *   false = 一律跳过，不碰页面上已有的作答
     * 关掉 overwriteAnswered 才生效。以前这个键只被 `Cfg.get` 读取、默认配置里没有，
     * 且判定后从不回比，导致"答对也重写"。
     */
    fixWrong: true,
    /** 每题操作后立即点该题的"保存" */
    saveEach: false,
    /** 全部答完后自动交卷（危险，默认关闭） */
    autoSubmit: false,
    /** 自动交卷的正式键（面板写 submit，旧版写 autoSubmit，两个都认） */
    submit: false,
    /** 清掉与目标答案不一致的已选选项 */
    clearExtra: true,
    /** 输入框走键盘序列而非直接赋值（兼容富文本） */
    instantType: false,
    /** 点击后等待选中态生效的毫秒数 */
    verifyMs: 1100,
    /** 点完选项/保存后的静默等待（毫秒）：给页面自己的 AJAX 落库留窗口 */
    settleMs: 900,
    /** 落盘失败时的重试次数（页面重绘后元素引用会失效） */
    retries: 2,
    /** 重试仍失败就停下来等人工处理，不要带着空题往下翻 */
    stopOnFail: true,
    /**
     * 低置信度/本地兜底猜出来的答案是否也写进页面。
     * 默认关：这类题只标黄、不落盘，等人确认（猜错会直接算错，比空着更糟）。
     */
    allowGuess: false
  },
  /** 主循环 */
  engine: {
    /** 单次运行最多处理多少题（防死循环） */
    maxIterations: 200,
    /** 页面刷新/脚本重载后自动接着答（上次没跑完才会触发） */
    autoResume: true,
    /** 断点续跑的有效期（分钟），超过就当是新的一场 */
    resumeWindowMin: 20,
    /**
     * 无刷新翻页：用页面自己的 submitForm 走 ajax 保存，再 fetch 下一页 HTML
     * 原地替换题块，不再整页重载（超星默认 getTheNextQuestion → location.href 会整页刷新）。
     * 任何一步失败都自动回退到原生"下一题"。
     */
    softNext: true,
    /** 等待 submitForm 回调 / fetch 下一页的上限，超时就回退原生翻页 */
    softNextTimeoutMs: 6000,
    /** 启动后等题目渲染出来的最长时间（超星题块经常晚于 DOMContentLoaded 才出现） */
    bootstrapPollMs: 15000,
    /**
     * 进考试页后后台"预取答案"：每道题先跑一次判定并把结果缓存下来，
     * 这样点小球"答一题"时是直接落盘、几乎不用等模型。
     */
    prefetch: true,
    /** 预取并发（默认 4：进考试页先把答案并行缓存好，点球时几乎不用等） */
    prefetchConcurrency: 4,
    /** 预取开始前的等待，等题块稳定（2026-11-24 缩短：进页即判题） */
    prefetchDelayMs: 800,
    /** 进页后自动切「整卷预览」的等待（题块要先渲染出来） */
    previewDelayMs: 1500
  },
  ui: {
    x: 24,
    y: 96,
    collapsed: false,
    /**
     * 仅显示答案（2026-11-24 默认行为）：
     *   true  = 判题照常（题干答案 → 预取 → AI.solve），但绝不点击选项、不落盘、不翻页；
     *           答案只进面板与右下角答案条，人工照着填。
     *   false = 旧自动模式：判定后拟人化点选落盘。
     */
    showOnly: true,
    /** 右下角答案条（题号 + 答案清单，选择题点击跳题、文本题点击复制）
     *  2026-11-25 用户要求：默认隐藏，去设置中心「运行」里手动启用。 */
    answerCorner: false,
    /** 独立设置中心地址；留空 = 用脚本内置的官方地址（换部署位时才需要填） */
    settingsURL: '',
    /** 设置中心：高级模式（显示权重/温度/阈值/超时/运行/备份/诊断），默认关 */
    advanced: false,
    /** 设置中心：是否走完过首次向导（false 且一个模型都没有时才显示向导） */
    onboarded: false,
    /** 每道题下方显示作答详情（答案/置信度/依据/页面是否一致）——默认关闭：
     *  2026-11-18 用户看到题下那块卡片后明确表示"我没说过要在页面上显示这个"，
     *  页面要保持干净，判定详情统一放在面板里。想开的人自己在设置中心打开。 */
    inlineResult: false,
    /** 打开 inlineResult 时是否连"依据/票/页面比对"一起显示（默认只显示一行） */
    inlineResultDetail: false,
    /** 同步失败原因在面板顶部保留多久（毫秒），0 = 一直留到下次同步 */
    syncFailMs: 180000,
    /** 控制台最多保留多少行日志（超出丢最旧的） */
    logMax: 300,
    /** 云同步服务地址；留空 = 用默认 Pages Function */
    syncAPI: '',
    /**
     * 进考试页时云端配置是否强制覆盖本地。
     * 默认 false：本地已有模型时不再 pull，避免在考试页面板里改的设置下次加载被云端旧配置冲掉。
     */
    forcePull: false
  }
};

/* ---------------- 通用工具 ---------------- */

CXAI.U = {
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },
  rand(min, max) {
    return min + Math.random() * (max - min);
  },
  randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  },
  uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  },
  clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  },
  /** 深合并（数组直接替换） */
  mergeDeep(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    for (const k of Object.keys(patch)) {
      const bv = out[k];
      const pv = patch[k];
      if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
        out[k] = CXAI.U.mergeDeep(bv, pv);
      } else if (pv !== undefined) {
        out[k] = pv;
      }
    }
    return out;
  },
  /**
   * 按默认配置的类型归一（以默认值为准）：
   *   - 数字字段里出现字符串/注入片段 → 折回数字或默认值；
   *   - 布尔字段的 "false"/"true" 字符串 → 布尔；
   *   - 未知键原样保留（syncAPI / syncEnabled 这类运行期新增项）。
   * 为什么要做：设置中心把数值直接拼进 `value="${...}"`，而配置可以来自导入的 JSON /
   * 同步码 / URL hash。不做类型归一，一份形如 `"panelSize":"1\\" onfocus=..."` 的配置
   * 就能在设置页（油猴权限域）里执行脚本。
   */
  coerceLike(def, cur) {
    if (cur === undefined) return def;
    if (def == null) return cur;
    if (typeof def === 'number') {
      const n = Number(cur);
      return isFinite(n) ? n : def;
    }
    if (typeof def === 'boolean') {
      if (cur === 'true' || cur === '1' || cur === 1) return true;
      if (cur === 'false' || cur === '0' || cur === 0) return false;
      return !!cur;
    }
    if (typeof def === 'string') return cur == null ? def : String(cur);
    if (Array.isArray(def)) return Array.isArray(cur) ? cur : def;
    if (typeof def === 'object') {
      const out = Object.assign({}, cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {});
      Object.keys(def).forEach((k) => {
        out[k] = CXAI.U.coerceLike(def[k], out[k]);
      });
      return out;
    }
    return cur;
  },
  deepGet(obj, path, fallback) {
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  },
  /** 容错 JSON 解析：剥离 ```json 围栏、截取首个 {} 块、修复尾随逗号 */
  safeJson(text) {
    if (text == null) return null;
    if (typeof text === 'object') return text;
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    try {
      return JSON.parse(s);
    } catch (e) {
      try {
        return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
      } catch (e2) {
        return null;
      }
    }
  },
  /** 文本归一化：全角转半角、去空白、去标点、小写 */
  normText(s) {
    if (!s) return '';
    let t = String(s);
    // 全角 -> 半角
    t = t.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    t = t.replace(/\u3000/g, ' ');
    return t
      .toLowerCase()
      .replace(/[\s\r\n\t]+/g, '')
      .replace(/[，。、；：？！,.;:?!"'“”‘’（）()\[\]【】<>《》~\-—_/\\|]/g, '');
  },
  /** 字符二元组 Jaccard 相似度，用于选项文本兜底匹配 */
  similarity(a, b) {
    const x = CXAI.U.normText(a);
    const y = CXAI.U.normText(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const grams = (s) => {
      const m = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const g = s.slice(i, i + 2);
        m.set(g, (m.get(g) || 0) + 1);
      }
      if (s.length === 1) m.set(s, 1);
      return m;
    };
    const ga = grams(x);
    const gb = grams(y);
    let inter = 0;
    let union = 0;
    for (const [g, c] of ga) {
      const d = gb.get(g) || 0;
      inter += Math.min(c, d);
      union += Math.max(c, d);
    }
    for (const [g, c] of gb) {
      if (!ga.has(g)) union += c;
    }
    return union === 0 ? 0 : inter / union;
  },
  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  /** 截断显示 */
  truncate(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  },
  /** 带超时的 Promise */
  withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error((label || '请求') + ' 超时 ' + ms + 'ms')), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }
};

/* ---------------- 持久化 ----------------
 * 学习通的考试页散落在很多域名上（mooc1 / mooc2-ans / i.chaoxing / 各校 *.edu.cn），
 * 而 localStorage 是按「源」隔离的 —— 在一个站配好的 Key，换个站就看不见。
 * 所以这里三层落地：
 *   1) GM_getValue / GM_setValue：油猴存储，同一脚本在所有 @match 域名间共享（首选）
 *   2) localStorage：始终镜像写一份，既做本域兜底，也做「没装油猴时的旧数据」迁移源
 *   3) 内存：两者都写不进去时，至少本次会话不丢
 */

CXAI.Store = (function () {
  const mem = Object.create(null);
  let backend = '';

  function pick(name, win) {
    if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') return globalThis[name];
    if (win && typeof win[name] === 'function') return win[name];
    return null;
  }

  function gmApi() {
    try {
      const win = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : null;
      const get = pick('GM_getValue', win);
      const set = pick('GM_setValue', win);
      return get && set ? { get: get, set: set, del: pick('GM_deleteValue', win) } : null;
    } catch (e) {
      return null;
    }
  }

  const api = gmApi();

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  /** 有的管理器把对象存成 JSON 字符串再还回来，这里兜一层 */
  function unwrap(v) {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (!t || (t.charAt(0) !== '{' && t.charAt(0) !== '[')) return v;
    try {
      return JSON.parse(t);
    } catch (e) {
      return v;
    }
  }

  return {
    /** 'gm' = 走油猴存储（按域名隔离，跨域要靠 CXAI.cfgCodec 搬运）；'local' = 只在本源有效；'mem' = 仅本次会话 */
    get backend() {
      return backend || (api ? 'gm' : 'local');
    },
    scope() {
      return api ? 'cross-origin' : 'per-origin';
    },
    info(key) {
      const fromGm = api ? (function () {
        try {
          return api.get(key, undefined);
        } catch (e) {
          return undefined;
        }
      })() : undefined;
      const fromLocal = lsGet(key);
      return {
        backend: this.backend,
        scope: this.scope(),
        key: key,
        gmApi: !!api,
        hasGm: fromGm !== undefined && fromGm !== null,
        hasLocal: fromLocal !== undefined,
        bytes: fromGm !== undefined && fromGm !== null ? JSON.stringify(fromGm).length : fromLocal !== undefined ? JSON.stringify(fromLocal).length : 0
      };
    },
    get(key, fallback) {
      if (Object.prototype.hasOwnProperty.call(mem, key)) return mem[key];
      let v;
      if (api) {
        try {
          v = unwrap(api.get(key, undefined));
        } catch (e) {
          v = undefined;
        }
      }
      if (v === undefined || v === null) {
        // GM 里没有、但本源 localStorage 有（以前没装油猴时写的）→ 迁移上去
        const lv = lsGet(key);
        if (lv !== undefined && lv !== null) {
          if (api) {
            try {
              api.set(key, lv);
            } catch (e) {}
          }
          backend = api ? 'gm' : 'local';
          return lv;
        }
        backend = api ? 'gm' : 'local';
        return fallback;
      }
      backend = 'gm';
      return v;
    },
    set(key, value) {
      let okGm = false;
      let okLs = false;
      if (api) {
        try {
          api.set(key, value);
          okGm = true;
        } catch (e) {}
      }
      okLs = lsSet(key, value);
      if (!okGm && !okLs) {
        mem[key] = value;
        backend = 'mem';
        return false;
      }
      backend = okGm ? 'gm' : 'local';
      return true;
    },
    remove(key) {
      delete mem[key];
      if (api && api.del) {
        try {
          api.del(key);
        } catch (e) {}
      }
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }
  };
})();

/** 本地/内网地址判定：这类端点通常不需要 API Key */
CXAI.isLocalURL = function (url) {
  const u = String(url || '');
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:\d+)?(\/|$)/i.test(u) ||
    /^(https?:\/\/)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u) ||
    /\.local(:\d+)?(\/|$)/i.test(u);
};

/** 补齐 provider 缺失字段（兼容老配置 / 手写 JSON） */
CXAI.normalizeProvider = function (p, i) {
  const out = Object.assign({}, p || {});
  out.id = out.id || CXAI.U.uid('p');
  out.label = out.label || '模型' + ((i || 0) + 1);
  out.baseURL = String(out.baseURL || '').trim();
  out.apiKey = out.apiKey == null ? '' : String(out.apiKey);
  out.model = String(out.model || '').trim();
  out.apiStyle = out.apiStyle === 'anthropic' || out.apiStyle === 'gemini' ? out.apiStyle : 'openai';
  out.role = out.role === 'vision' || out.role === 'both' ? out.role : 'judge';
  // role=vision 天然带视觉能力
  out.vision = out.role === 'vision' || out.role === 'both' ? true : !!out.vision;
  out.weight = Number(out.weight) > 0 ? Number(out.weight) : 1;
  out.temperature = out.temperature == null || out.temperature === '' ? 0.2 : Number(out.temperature);
  out.enabled = out.enabled !== false;
  out.jsonMode = !!out.jsonMode;
  out.maxTokens = Number(out.maxTokens) > 0 ? Number(out.maxTokens) : 700;
  out.maxTokensField = out.maxTokensField || 'max_tokens';
  out.timeoutMs = Number(out.timeoutMs) > 0 ? Number(out.timeoutMs) : 0;
  out.keyOptional = out.keyOptional != null ? !!out.keyOptional : CXAI.isLocalURL(out.baseURL);
  if (typeof out.extraBody === 'string') out.extraBody = CXAI.U.safeJson(out.extraBody) || {};
  if (typeof out.extraHeaders === 'string') out.extraHeaders = CXAI.U.safeJson(out.extraHeaders) || {};
  if (!out.extraBody || typeof out.extraBody !== 'object') out.extraBody = {};
  if (!out.extraHeaders || typeof out.extraHeaders !== 'object') out.extraHeaders = {};
  return out;
};

CXAI.Cfg = {
  data: null,
  load() {
    const saved = CXAI.Store.get(CXAI.CONFIG_KEY, null);
    let data = CXAI.U.mergeDeep(
      JSON.parse(JSON.stringify(CXAI.DEFAULT_CONFIG)),
      saved && typeof saved === 'object' ? saved : {}
    );
    // 老版本 ai.vision 是布尔值 -> 迁移成对象，保留用户原来的开关状态
    if (typeof data.ai.vision === 'boolean') {
      data.ai.vision = Object.assign({}, CXAI.DEFAULT_CONFIG.ai.vision, { enabled: data.ai.vision });
    }
    // 类型归一必须在迁移之后：默认 ai.vision 是对象，直接 coerce 会吞掉老配置的布尔值
    data = CXAI.U.coerceLike(CXAI.DEFAULT_CONFIG, data);
    if (!data.ai.vision || typeof data.ai.vision !== 'object') {
      data.ai.vision = JSON.parse(JSON.stringify(CXAI.DEFAULT_CONFIG.ai.vision));
    }
    data.ai.providers = (data.ai.providers || []).map((p, i) => CXAI.normalizeProvider(p, i));
    // v1.13.0 一次性迁移：右下角答案条改成默认隐藏。
    // 老用户存过 ui.answerCorner=true，只改默认值对他们无效，这里强制关一次并打标，
    // 之后用户自己去设置中心「运行」里重新勾选，不会再被覆盖。
    try {
      if (!CXAI.Store.get('migr.answerCornerHidden', false)) {
        data.ui.answerCorner = false;
        CXAI.Store.set('migr.answerCornerHidden', true);
      }
    } catch (e) {}
    this.data = data;
    return this.data;
  },
  get(path, fallback) {
    if (!this.data) this.load();
    return CXAI.U.deepGet(this.data, path, fallback);
  },
  set(path, value) {
    if (!this.data) this.load();
    const parts = String(path).split('.');
    let cur = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    this.save();
  },
  save() {
    const ok = CXAI.Store.set(CXAI.CONFIG_KEY, this.data);
    if (!ok) CXAI.Log && CXAI.Log.error('配置写入失败：存储被禁用或空间不足，本次改动只在这个页面有效');
    return ok;
  },
  /** 导出成可粘贴的 JSON（换浏览器 / 换域名时搬运用） */
  json() {
    if (!this.data) this.load();
    return JSON.stringify(this.data, null, 2);
  },
  /** 从 JSON 文本导入，脏数据一律拒绝而不是写进配置 */
  importJSON(text) {
    let obj = null;
    try {
      obj = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('配置必须是一个 JSON 对象');
    if (!obj.ai && !obj.guard && !obj.apply) throw new Error('这不像本脚本的配置（缺少 ai / guard / apply 段）');
    CXAI.Store.set(CXAI.CONFIG_KEY, obj);
    this.load();
    return true;
  },
  /** 所有可用的端点（含无鉴权的本地服务 / magpie / Ollama） */
  allProviders() {
    return (this.get('ai.providers', []) || [])
      .map((p) => CXAI.normalizeProvider(p, 0))
      .filter((p) => p && p.enabled && p.baseURL && p.model && (p.apiKey || p.keyOptional || CXAI.isLocalURL(p.baseURL)));
  },
  /** 取可用的模型面板（按权重降序）；role=vision 的读图专模型默认不进判题面板 */
  activeProviders() {
    const all = this.allProviders();
    const judges = all.filter((p) => p.role !== 'vision');
    const list = judges.length ? judges : all;
    return list.sort((a, b) => (b.weight || 1) - (a.weight || 1));
  },
  /** 可用的读图模型（role=vision|both 或勾了 vision） */
  visionProviders() {
    return this.allProviders()
      .filter((p) => p.vision)
      .sort((a, b) => (b.weight || 1) - (a.weight || 1));
  }
};

/* ---------------- 配置码（跨域搬运） ----------------
 * 油猴的 GM 存储在多数管理器里按「脚本 + 域名」隔离：设置中心在
 * cx-exam-ai.pages.dev 写的那份，chaoxing.com 的考试页读不到。
 * 所以设置中心把整份配置编码成一个「配置码」，可以：
 *   1) 拼进 URL hash 交给任意 chaoxing 页面，脚本落库到本域（自动）
 *   2) 复制粘贴进考试页面板的「备份 → 导入」
 * 用 base64 + UTF-8 处理中文，不依赖任何后端。
 */
CXAI.cfgCodec = {
  encode(obj) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    } catch (e) {
      return '';
    }
  },
  decode(str) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(String(str)))));
    } catch (e) {
      return null;
    }
  }
};

/* ---------------- 日志 ---------------- */

CXAI.Log = {
  entries: [],
  listeners: [],
  max: 500,
  push(level, msg, data) {
    const entry = { t: Date.now(), level: level || 'info', msg: String(msg), data: data || null };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    const tag = '[CX-AI][' + entry.level + ']';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn.call(console, tag, msg, data || '');
    this.listeners.forEach((fn2) => {
      try {
        fn2(entry);
      } catch (e) {}
    });
  },
  info(m, d) {
    this.push('info', m, d);
  },
  warn(m, d) {
    this.push('warn', m, d);
  },
  error(m, d) {
    this.push('error', m, d);
  },
  ok(m, d) {
    this.push('ok', m, d);
  },
  on(fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
};

/** 自检：控制台执行 CXAI.diag() 就能看到存储后端、配置体量、模型清单 */
CXAI.diag = function () {
  let origin = '';
  try {
    origin = location.origin;
  } catch (e) {}
  const info = CXAI.Store.info(CXAI.CONFIG_KEY);
  const providers = (CXAI.Cfg.get('ai.providers', []) || []).map(function (p) {
    return { id: p.id, role: p.role, model: p.model, host: (function () {
      try {
        return new URL(p.baseURL).host;
      } catch (e) {
        return p.baseURL;
      }
    })(), enabled: p.enabled !== false };
  });
  const out = {
    version: CXAI.__version,
    origin: origin,
    store: info,
    providers: providers,
    vision: CXAI.Cfg.get('ai.vision', {}),
    judge: CXAI.Cfg.get('ai.judge', {})
  };
  CXAI.Log.info(
    '存储后端 ' + (info.backend === 'gm' ? 'GM（按域名隔离）' : info.backend === 'local' ? '仅本源 localStorage' : '内存') +
      ' · ' + info.bytes + ' 字节 · 模型 ' + providers.length + ' 个',
    out
  );
  return out;
};

/* ==================== 02-font.js ==================== */
/* ---------------- 加密字体解密（字形置换） ----------------
 * 学习通考试会把题干/选项替换成私用区乱码字符，再下发一份"字形错位"的字体：
 * 码点 X 的字形实际画的是另一个字。肉眼正常，读文本是乱码。
 *
 * 解法：把密文字用加密字体渲染成位图 -> 网格二值化 -> 与参考特征表做两级最近邻匹配。
 * 算法与参数严格对齐 ocsjs 的离线特征表生成端（MIT License, Copyright (c) 2022 enncy）。
 */

CXAI.Font = (function () {
  /* 渲染参数：必须与特征表生成端一致，改动会导致匹配全线失败 */
  const RENDER = 360;
  const SQ = 480;
  const BASELINE = 384;
  const SHORTLIST = 40;
  const INK_THRESHOLD = 40;

  /** 超星加密字体族标记 & 加密元素 class */
  const CX_MARKER = 'font-cxsecret';
  const CX_SELECTOR = '.' + CX_MARKER;
  /** 特征表地址（FRB2 位打包，约 0.76MB，本地缓存 7 天） */
  const REF_TABLE_URL = 'https://cdn.ocsjs.com/resources/font/font_ref_cx.bin';
  const REF_CACHE_KEY = '{{SECRET_mf3hgc5b}}';
  const REF_CACHE_TTL = 7 * 24 * 3600 * 1000;

  let renderCv = null;
  let refTablePromise = null;
  /** 密文字 -> 真实字，进程内终身复用 */
  const map = Object.create(null);
  let crackJob = null;
  // 失败不永久放弃：首次进考试页网络抖动很常见，60 秒后允许再试一次，
  // 否则整场考试的加密字体题都会以乱码送给模型。0 = 未失败。
  let crackFailedAt = 0;
  const CRACK_RETRY_MS = 60 * 1000;

  function getCanvas() {
    if (!renderCv) {
      const cv = document.createElement('canvas');
      cv.width = SQ;
      cv.height = SQ;
      renderCv = { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) };
    }
    return renderCv;
  }

  /* ---------- FRB2 解析 ---------- */

  function unpackBits(packed, offset, count, dims) {
    const bytesPerGlyph = dims / 8;
    const out = new Uint8Array(count * dims);
    for (let i = 0; i < count; i++) {
      const pBase = offset + i * bytesPerGlyph;
      const oBase = i * dims;
      for (let b = 0; b < bytesPerGlyph; b++) {
        const byte = packed[pBase + b];
        for (let k = 0; k < 8; k++) {
          out[oBase + b * 8 + k] = (byte >> (7 - k)) & 1;
        }
      }
    }
    return out;
  }

  function parseRefTable(buf) {
    if (!buf || buf.byteLength < 20) throw new Error('特征表数据为空或过短');
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'FRB2') throw new Error('特征表格式无效: ' + magic);
    const count = dv.getUint32(4, true);
    const threshold = dv.getUint32(8, true);
    const gc = dv.getUint32(12, true);
    const gf = dv.getUint32(16, true);
    // 头字段来自缓存/网络，必须校验：被截断的缓存不校验长度时会解析出全零特征，
    // 然后稳定地把所有字匹配错（比"解密失败"更隐蔽）。
    if (!count || count > 50000 || !gc || !gf || gc > 128 || gf > 128 || gc % 8 !== 0 || gf % 8 !== 0) {
      throw new Error('特征表头异常：count=' + count + ' gc=' + gc + ' gf=' + gf);
    }
    const need = 20 + count * 4 + (count * (gc * gc + gf * gf)) / 8;
    if (buf.byteLength < need) throw new Error('特征表数据不完整（' + buf.byteLength + '/' + Math.ceil(need) + ' 字节）');
    const cps = new Uint32Array(count);
    let off = 20;
    for (let i = 0; i < count; i++, off += 4) cps[i] = dv.getUint32(off, true);
    const packed = new Uint8Array(buf);
    const coarse = unpackBits(packed, off, count, gc * gc);
    off += (count * gc * gc) / 8;
    const fine = unpackBits(packed, off, count, gf * gf);
    return { count, cps, coarse, fine, gc, gf, threshold };
  }

  /* ---------- 加载特征表（内存 -> IndexedDB 缓存 -> 网络） ---------- */

  function idbGet(key) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('cx-ai-font', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('t');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          try {
            const db = req.result;
            const tx = db.transaction('t', 'readonly');
            const g = tx.objectStore('t').get(key);
            g.onsuccess = () => resolve(g.result || null);
            g.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function idbSet(key, value) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('cx-ai-font', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('t');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          try {
            const db = req.result;
            const tx = db.transaction('t', 'readwrite');
            tx.objectStore('t').put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          } catch (e) {
            resolve(false);
          }
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function httpGetBuffer(url) {
    return new Promise((resolve, reject) => {
      // 优先 GM_xmlhttpRequest（绕过 CORS，且可指定 arraybuffer）
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'arraybuffer',
          timeout: 60000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
            else reject(new Error('HTTP ' + res.status));
          },
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('请求超时'))
        });
        return;
      }
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(resolve, reject);
    });
  }

  function loadRefTable() {
    if (refTablePromise) return refTablePromise;
    refTablePromise = (async () => {
      const cached = await idbGet(REF_CACHE_KEY);
      if (cached && cached.buf && Date.now() - cached.at < REF_CACHE_TTL) {
        try {
          return parseRefTable(cached.buf);
        } catch (e) {
          /* 缓存损坏，走网络 */
        }
      }
      CXAI.Log.info('下载字形特征表（首次约 0.76MB）…');
      const buf = await httpGetBuffer(REF_TABLE_URL);
      const table = parseRefTable(buf);
      idbSet(REF_CACHE_KEY, { at: Date.now(), buf }).catch(() => {});
      CXAI.Log.ok(`特征表就绪：${table.count} 个候选字，粗网格 ${table.gc}，精网格 ${table.gf}`);
      return table;
    })();
    refTablePromise.catch(() => {
      refTablePromise = null;
    });
    return refTablePromise;
  }

  /* ---------- 字形渲染与匹配 ---------- */

  function renderGlyph(family, ch, table) {
    const { ctx } = getCanvas();
    ctx.clearRect(0, 0, SQ, SQ);
    ctx.fillStyle = '#fff';
    ctx.font = `${RENDER}px "${family}"`;
    ctx.textBaseline = 'alphabetic';
    const advance = ctx.measureText(ch).width;
    ctx.fillText(ch, (SQ - advance) / 2, BASELINE);
    const px = ctx.getImageData(0, 0, SQ, SQ).data;

    let hasInk = false;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > INK_THRESHOLD) {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) return null;

    // 积分图：一次构建，网格求和 O(1)
    const W = SQ + 1;
    const ii = new Uint32Array(W * W);
    for (let y = 0; y < SQ; y++) {
      let rowSum = 0;
      const srcRow = y * SQ * 4;
      const dstRow = (y + 1) * W;
      const upRow = y * W;
      for (let x = 0; x < SQ; x++) {
        rowSum += px[srcRow + x * 4 + 3];
        ii[dstRow + x + 1] = ii[upRow + x + 1] + rowSum;
      }
    }
    const box = (n) => {
      const b = SQ / n;
      const area = b * b;
      const out = new Uint8Array(n * n);
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const y0 = gy * b;
          const x0 = gx * b;
          const sum = ii[(y0 + b) * W + x0 + b] - ii[y0 * W + x0 + b] - ii[(y0 + b) * W + x0] + ii[y0 * W + x0];
          out[gy * n + gx] = sum / area > table.threshold ? 1 : 0;
        }
      }
      return out;
    };
    return { coarse: box(table.gc), fine: box(table.gf) };
  }

  const coverCache = {};

  /** 双回退对比法：判断加密字体是否真的覆盖该字符（不覆盖的说明是明文，跳过） */
  function isCoveredByFont(family, ch) {
    const render = (fallback) => {
      const key = family + '|' + fallback;
      let cv = coverCache[key];
      if (!cv) {
        cv = document.createElement('canvas');
        cv.width = 200;
        cv.height = 200;
        coverCache[key] = cv;
      }
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, 200, 200);
      ctx.fillStyle = '#fff';
      ctx.font = `120px "${family}", ${fallback}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, 10, 100);
      return ctx.getImageData(0, 0, 200, 200).data;
    };
    const a = render('serif');
    const b = render('sans-serif');
    let diff = 0;
    for (let i = 3; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]);
    return diff < 1000;
  }

  function bitDistance(arr, idx, dims, q) {
    let s = 0;
    const base = idx * dims;
    for (let i = 0; i < dims; i++) {
      if (arr[base + i] !== q[i]) s++;
    }
    return s;
  }

  function crackChar(table, feat) {
    const { count, cps, coarse, fine, gc, gf } = table;
    const dists = new Float64Array(count);
    for (let i = 0; i < count; i++) dists[i] = bitDistance(coarse, i, gc * gc, feat.coarse);
    const sorted = Float64Array.from(dists);
    sorted.sort();
    const threshold = sorted[Math.min(SHORTLIST, count) - 1];
    let bestI = -1;
    let best = Infinity;
    let second = Infinity;
    for (let i = 0; i < count; i++) {
      if (dists[i] > threshold) continue;
      const d = bitDistance(fine, i, gf * gf, feat.fine);
      if (d < best) {
        second = best;
        best = d;
        bestI = i;
      } else if (d < second) {
        second = d;
      }
    }
    if (bestI < 0) return null;
    return {
      ch: String.fromCodePoint(cps[bestI]),
      best,
      second,
      margin: second > 0 ? 1 - best / second : 1
    };
  }

  /* ---------- 字体来源提取 ---------- */

  /** 从 head 的 <style> 里找 base64 内联字体 */
  function extractFontFromStyle(doc, marker) {
    const styles = Array.from(doc.head ? doc.head.querySelectorAll('style') : []);
    const styleEl = styles.find((s) => s.textContent && s.textContent.indexOf(marker) >= 0);
    if (!styleEl) return null;
    const m = styleEl.textContent.match(/base64,([\w\W]+?)['")]/);
    if (!m) return null;
    const raw = window.atob(m[1].replace(/\s/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }

  /** 列出页面所有 @font-face（族名 + 源），用于 URL 形式的加密字体 */
  function listFontFaces(doc) {
    const faces = [];
    for (const sheet of Array.from(doc.styleSheets || [])) {
      let rules;
      try {
        rules = Array.from(sheet.cssRules || []);
      } catch (e) {
        continue; // 跨域样式表
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = (rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim();
        const srcRaw = rule.style.getPropertyValue('src') || '';
        const m = /url\(["']?([^"')]+)["']?\)/.exec(srcRaw);
        if (!family || !m) continue;
        const base = (doc.location && doc.location.href) || location.href;
        faces.push({ family, src: m[1].startsWith('data:') ? m[1] : new URL(m[1], base).href });
      }
    }
    return faces;
  }

  /* ---------- 解密主流程 ---------- */

  function collectText(doc) {
    const els = Array.from(doc.querySelectorAll(CX_SELECTOR));
    return els.map((el) => el.textContent || '').join('');
  }

  async function crackOnce(doc) {
    let source = extractFontFromStyle(doc, CX_MARKER);
    if (!source) {
      // 回退：找族名含 cxsecret 的 @font-face
      const face = listFontFaces(doc).find((f) => /cxsecret/i.test(f.family));
      if (face) source = face.src;
    }
    if (!source) {
      CXAI.Log.info('未检测到加密字体（此页面题目为明文）');
      return null;
    }
    const table = await loadRefTable();
    const chars = Array.from(new Set(collectText(doc).split(''))).filter((c) => c.trim() !== '');
    if (chars.length === 0) return null;

    const family = 'cx-decrypt-' + Math.random().toString(36).slice(2, 8);
    const face = new FontFace(family, typeof source === 'string' ? `url("${source}")` : source);
    await CXAI.U.withTimeout(face.load(), 20000, '字体加载');
    document.fonts.add(face);

    const t0 = Date.now();
    const result = Object.create(null);
    const low = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (!isCoveredByFont(family, ch)) {
        result[ch] = ch;
        continue;
      }
      const feat = renderGlyph(family, ch, table);
      if (!feat) {
        result[ch] = ch;
        continue;
      }
      const r = crackChar(table, feat);
      if (!r) {
        result[ch] = ch;
        continue;
      }
      result[ch] = r.ch;
      if (r.margin < 0.3) low.push({ from: ch, to: r.ch, margin: +r.margin.toFixed(3) });
      if (i % 10 === 9) await CXAI.U.sleep(0);
    }
    CXAI.Log.ok(`字形解密完成：${chars.length} 字 / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (low.length) CXAI.Log.warn(`${low.length} 个字符置信度偏低（可能为形近字）`, low);
    return result;
  }

  function decryptText(text) {
    if (!text) return text;
    return Array.from(text)
      .map((c) => (map[c] !== undefined ? map[c] : c))
      .join('');
  }

  /** 原地改写文本节点（不动 HTML 结构，避免破坏事件绑定） */
  function decryptElements(els) {
    const NF =
      (typeof document !== 'undefined' && document.defaultView && document.defaultView.NodeFilter) ||
      (typeof NodeFilter !== 'undefined' ? NodeFilter : null);
    if (!NF) return;
    for (const root of els) {
      let walker;
      try {
        walker = document.createTreeWalker(root, NF.SHOW_TEXT, null);
      } catch (e) {
        continue;
      }
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const v = node.nodeValue;
        if (v && /[\uE000-\uF8FF]/.test(v)) node.nodeValue = decryptText(v);
        else if (v) node.nodeValue = decryptText(v);
      }
    }
  }

  /**
   * 幂等增量解密：页面每次渲染新题后调用即可。
   * 无加密元素 -> 立即返回；有映射表 -> 毫秒级增量；首次 -> 完整破解。
   */
  async function ensure(doc) {
    doc = doc || document;
    if (crackFailedAt && Date.now() - crackFailedAt < CRACK_RETRY_MS) return;
    const els = Array.from(doc.querySelectorAll(CX_SELECTOR));
    if (els.length === 0) return;

    if (Object.keys(map).length === 0) {
      if (!crackJob) {
        crackJob = crackOnce(doc).catch((e) => {
          crackFailedAt = Date.now();
          crackJob = null;
          CXAI.Log.error('字形解密失败（60 秒后可重试）：' + e.message);
          return null;
        });
      }
      const res = await crackJob;
      if (!res) {
        crackJob = null;
        return;
      }
      Object.assign(map, res);
      crackFailedAt = 0;
    }
    decryptElements(els);
    // 移除标记，保证 getSecret 不再命中（天然幂等）
    els.forEach((el) => el.classList.remove(CX_MARKER));
  }

  /** 同步版：已有映射表时立即解密（供抓题前快速调用） */
  function ensureSync(doc) {
    doc = doc || document;
    if (Object.keys(map).length === 0) return false;
    const els = Array.from(doc.querySelectorAll(CX_SELECTOR));
    if (els.length === 0) return true;
    decryptElements(els);
    els.forEach((el) => el.classList.remove(CX_MARKER));
    return true;
  }

  return {
    ensure,
    ensureSync,
    decryptText,
    hasSecret(doc) {
      return (doc || document).querySelectorAll(CX_SELECTOR).length > 0;
    },
    mapSize() {
      return Object.keys(map).length;
    },
    /** 供调试：暴露原始映射表 */
    rawMap() {
      return map;
    }
  };
})();

/* ==================== 03-scraper.js ==================== */
/* ---------------- 页面识别与题目抓取 ----------------
 * 选择器对齐学习通现网结构（考试答题页 / 整卷预览 / 作业页 / 章节测验）。
 */

CXAI.Scraper = (function () {
  /** 学习通题号 -> 题型值映射
   *  2/4~10 统一压成 completion（落盘都走"写文本"路径），这是 ocsjs 的既有范式：
   *  简答 / 论述 / 计算 / 名词解释 / 分录 / 编程 在页面上的承载都是"一个可写的富文本框"，
   *  按填空写反而最稳。12/13/16/17 官方确有（匹配/排序/口语/听力），但码值与 DOM 未实测，
   *  这里先给独立 type（界面标签更准），写入仍走各自 shell 判定，不猜码值语义。
   */
  const TYPE_MAP = {
    0: 'single',
    1: 'multiple',
    2: 'completion',
    3: 'judgement',
    4: 'completion',
    5: 'completion',
    6: 'completion',
    7: 'completion',
    8: 'completion',
    9: 'completion',
    10: 'completion',
    11: 'line',
    12: 'match',
    13: 'sort',
    14: 'fill',
    15: 'reader',
    16: 'oral',
    17: 'listening'
  };

  const TYPE_LABEL = {
    single: '单选题',
    multiple: '多选题',
    judgement: '判断题',
    completion: '填空题',
    line: '连线题',
    match: '匹配题',
    sort: '排序题',
    fill: '完形填空',
    reader: '阅读理解',
    oral: '口语题',
    listening: '听力题',
    unknown: '未知题型'
  };

  /** 题目的"承载形态"：决定答案往哪写、能不能写 */
  const SHELL_LABEL = {
    choice: '选项题',
    text: '文本作答',
    match: '连线/匹配',
    group: '小题组',
    media: '音视频',
    attach: '附件材料',
    manual: '需人工'
  };

  /**
   * 题型码 → 中文标签。`TYPE_MAP` 把 2/4/5/6/7/8/9/10 全归成 completion（落盘都走填空路径），
   * 但界面上把它们一律显示成"填空题"是错的——超星 4 是简答题、5 论述题、6 计算题、
   * 8 名词解释、9 分录题、10 编程题。2026-11 期中考试实测：整卷只有 1 道 type=4，
   * 面板却写着"填空题"，用户以为是抓错了题。
   * 这里只影响显示，不改 `type`（apply 的分支判断依赖 `type`）。
   */
  const TYPE_LABEL_BY_CODE = {
    0: '单选题',
    1: '多选题',
    2: '填空题',
    3: '判断题',
    4: '简答题',
    5: '论述题',
    6: '计算题',
    7: '其他题',
    8: '名词解释',
    9: '分录题',
    10: '编程题',
    11: '连线题',
    14: '完形填空',
    15: '阅读理解'
  };

  /** 页面隐藏域里存的是"一段文本"而不是选项字母的题型（与 04-ai.isTextType 保持一致） */
  const TEXT_VALUE_TYPES = {
    completion: 1,
    line: 1,
    reader: 1,
    fill: 1,
    match: 1,
    oral: 1,
    listening: 1
  };

  /** 全页只有一个题块时，页面的全局 #questionId / 题型回退才是可靠的 */
  function singleQuestionPage() {
    try {
      return document.querySelectorAll('.questionLi, .TiMu').length <= 1;
    } catch (e) {
      return true;
    }
  }

  const JUDGE_WORDS = ['正确', '错误', '对', '错', '是', '否', '√', '×', 'true', 'false', 't', 'f', 'yes', 'no'];

  /** 题型码 → 界面标签。未知码给"第 N 类题"，别一律写成"未知题型" */
  function labelOf(type, typeCode) {
    if (TYPE_LABEL_BY_CODE[typeCode]) return TYPE_LABEL_BY_CODE[typeCode];
    if (TYPE_LABEL[type]) return TYPE_LABEL[type];
    if (typeCode != null && isFinite(typeCode)) return '第 ' + typeCode + ' 类题';
    return '未知题型';
  }

  /** 题面里出现这些词，说明是"要写一段话"的题，不是选字母 */
  const TEXT_WORDS = /填空|简答|论述|名词解释|计算|案例|材料|分录|编程|代码|程序设计|作图|画图|翻译|作文|实验|口语|听力|阅读|完形|配对|连线|匹配/;

  /**
   * 判定题目的承载形态（兜底链的第一环）：
   *   attach  附件题（题干在 PDF/Office 里）
   *   group   阅读理解/完形填空：一个外壳里装若干小题
   *   match   连线/匹配：下拉框或 .line_answer
   *   media   音视频题：页面上只有播放器
   *   choice  有选项
   *   text    有可写输入框（textarea / input / UEditor iframe）
   *   manual  什么都没有 —— 答案只能展示，由人手动填
   */
  function detectShell(root, options, inputs, attachments) {
    const has = (sel) => {
      try {
        return !!(root && root.querySelector && root.querySelector(sel));
      } catch (e) {
        return false;
      }
    };
    const count = (sel) => {
      try {
        return root && root.querySelectorAll ? root.querySelectorAll(sel).length : 0;
      } catch (e) {
        return 0;
      }
    };
    if (attachments && attachments.length) return 'attach';
    if (count('.questionLi .questionLi, .TiMu .TiMu, .reading_answer .questionLi, .filling_answer .questionLi') > 0) return 'group';
    if (has('.reading_answer, .filling_answer, .sub_que, .question-item')) return 'group';
    if (has('.line_answer, .selectBox') || count('select') > 0) return 'match';
    if (has('audio, video, .audio, .video, .audioWrap, .videoWrap, .player-wrap, #audioPlayer')) return 'media';
    if (options && options.length) return 'choice';
    if (inputs && inputs.length) return 'text';
    return 'manual';
  }

  /** 页面上的音视频资源（听力/口语题：模型只能按题干给要点） */
  function readMedia(root) {
    const out = [];
    try {
      Array.from(root.querySelectorAll('audio, video, source')).forEach((el) => {
        const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
        if (src) out.push({ tag: el.tagName.toLowerCase(), src: new URL(src, location.href).href });
      });
      Array.from(root.querySelectorAll('[onclick*="audio"], [onclick*="video"], .audioName, .videoName')).forEach((el) => {
        const src = el.getAttribute('onclick') || el.textContent || '';
        if (src) out.push({ tag: 'ref', src: String(src).slice(0, 180) });
      });
    } catch (e) {}
    return out;
  }


  /* ---------- 页面类型 ---------- */

  function detectPage() {
    const href = location.href;
    const hasQuestion = document.querySelectorAll('.questionLi').length > 0;
    const hasTiMu = document.querySelectorAll('.TiMu').length > 0;
    const nextBtn = document.querySelector('[onclick*="getTheNextQuestion"]');

    let kind = 'unknown';
    if (/\/exam\/preview/.test(href)) kind = 'exam-preview';
    else if (/\/exam\/test|\/exam-ans\//.test(href)) kind = 'exam-test';
    else if (/\/work\/dowork/.test(href)) kind = 'work';
    else if (hasTiMu) kind = 'chapter';
    else if (hasQuestion) kind = 'work';

    /**
     * 只读页面：点击有视觉反馈，但页面不会把作答提交给超星。
     *   reVersionTestStartNew-browse  组卷预览 / 试卷浏览
     *   mooc2-ans/exam/lookpaper      查看试卷
     *   /exam-ans/exam/test/look      回看已交试卷
     * 在这些页面上"选了但系统记录 0 题"是页面本身的设计，不是落盘失败，必须提示清楚。
     */
    // 真正的"点了不落库"页面只有几种：教师端试卷浏览 / 回看已交试卷。
    // 学生自己的「整卷预览」(`/exam-ans/mooc2/exam/preview`) 不在此列 —— 真机验证：
    // 它的选项是 `saveSingleSelect(this,qid)`，点一下就走 ajax 保存到 reVersionSubmitTestNew，
    // 而且 answerMode=1（逐题保存），正是"一页答完整卷、不用翻页"的形态。
    const readonly =
      /-browse|lookpaper|preview-browse|\/exam\/test\/look|\/exam-ans\/exam\/test\/look/i.test(href);

    /**
     * 已交卷 / 回看页：`/exam/test/look`、`lookpaper`、成绩单、报告页都算。
     * 这类页面上脚本不该出现（用户明确要求：交卷成功后界面自动消失）。
     */
    let finished =
      /\/exam\/test\/look|lookpaper|reportCard|examResult|exam-analysis|\/exam\/test\/score/i.test(href);
    if (!finished) {
      try {
        const head = String((document.body && document.body.innerText) || '').slice(0, 600);
        finished = /交卷成功|已交卷|考试已结束|提交成功|试卷已提交|成绩单/.test(head);
      } catch (e) {}
    }

    let mode = CXAI.Cfg.get('answer.pageMode', 'auto');
    if (mode === 'auto') {
      if (kind === 'chapter') mode = 'whole';
      else if (nextBtn && document.querySelectorAll('.questionLi').length <= 2) mode = 'single';
      else mode = 'whole';
    }
    // answerable = 真正能作答的考试/作业页。只有它为真才挂界面，
    // 别在课程首页、讨论区、已交卷回看页上挂一堆面板（用户明确要求）。
    const answerable = !finished && !/preview-browse|-browse/i.test(href) && (hasQuestion || hasTiMu);
    return {
      kind,
      mode,
      readonly,
      finished,
      answerable,
      hasQuestion: hasQuestion || hasTiMu,
      nextBtn,
      title: (document.title || '').trim()
    };
  }

  /* ---------- 文本清理 ---------- */

  function cleanStem(text) {
    return String(text || '')
      .replace(/[\t\r]+/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/^\s*\d+\s*[、.．]\s*/, '')
      // 题型标签的两种排版都要剥：
      //   「简答题」            —— 题型词开头
      //   「(简答题, 100.0 分)」—— 整个题干就是一个括号标签（附件题实测就长这样）
      .replace(
        /^\s*(单项选择题|多项选择题|不定项选择题|判断题|填空题|简答题|论述题|计算题|名词解释题?|案例分析题?|材料分析题?|阅读理解|完形填空|连线题|排序题|其他题)\s*[（(][^）)]*[）)]?\s*/,
        ''
      )
      .replace(
        /^\s*[（(]\s*(单项选择题|多项选择题|不定项选择题|判断题|填空题|简答题|论述题|计算题|名词解释题?|案例分析题?|材料分析题?|其他题)\s*[,，、]?\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*/,
        ''
      )
      .replace(
        /^\s*[（(]\s*(单项选择题|多项选择题|不定项选择题|判断题|填空题|简答题|论述题|计算题|名词解释题?|案例分析题?|材料分析题?|其他题)\s*[）)]\s*/,
        ''
      )
      // 【判断题】【单选题】【材料题】这类方括号前缀
      .replace(/^\s*【[^】]{1,10}】\s*/, '')
      .replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function cleanOption(text, idx) {
    let t = String(text || '')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 剥离 "A、" "A." "A)" "A：" 这类前缀；仅当剥离后仍有内容
    const m = /^[A-Ha-h]\s*[、.．)）:：]\s*/.exec(t);
    if (m && t.length > m[0].length) return t.slice(m[0].length).trim();
    const m2 = /^[A-Ha-h]\s+/.exec(t);
    if (m2 && t.length > m2[0].length && !/[A-Za-z]/.test(t.charAt(m2[0].length))) {
      // 只有后接非字母时才剥（"A 组" → "组"，"A test" 保持原样，避免把英文单词首字母吃掉）
      return t.slice(m2[0].length).trim();
    }
    return t;
  }

  function extractScore(root) {
    const m = (root.textContent || '').match(/[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]/);
    return m ? parseFloat(m[1]) : null;
  }

  /* ---------- 题型判定 ---------- */

  function typeFromValue(v) {
    const n = parseInt(v, 10);
    return TYPE_MAP[n] || 'unknown';
  }

  /** 题型码原始数字（显示用；`readTypeInput` 只返回归一化后的 type） */
  function typeCodeFromValue(v) {
    const n = parseInt(v, 10);
    return isFinite(n) ? n : null;
  }

  function readTypeRaw(root) {
    let candidates = [];
    try {
      candidates = Array.from(
        root.querySelectorAll('input[name^="type"], input[id^="answertype"], input[answertype]')
      );
    } catch (e) {}
    for (const el of candidates) {
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      if (/^type\d+$/.test(name)) return typeCodeFromValue(el.value);
      if (/^answertype/.test(id) || el.hasAttribute('answertype')) {
        return typeCodeFromValue(el.value || el.getAttribute('answertype'));
      }
    }
    // 回退：全页只有一道题时才允许在页面级找 —— 整卷/章节页里每个题的 type 隐藏域
    // 名字都带自己的题号，跨题回退会把第 1 题的题型套到所有题上（题型、落盘路径全错）
    if (!singleQuestionPage()) return null;
    const any = document.querySelector('input[name^="type"], input[answertype]');
    return any ? typeCodeFromValue(any.value || any.getAttribute('answertype')) : null;
  }

  /**
   * 附件题干（2026-11 期中考试实测的新形态）：题干 DOM 是空的，只有
   * `iframe.attach-iframe[module=insertAttach][objectid=…][filename=…]`，
   * 真正题目在一份 PDF 里。这里先把附件元信息抓出来，具体下载/渲染交给 03c-attach。
   */
  function readAttachments(root) {
    try {
      if (CXAI.Attach && typeof CXAI.Attach.collect === 'function') return CXAI.Attach.collect(root);
    } catch (e) {}
    const out = [];
    try {
      Array.from(root.querySelectorAll('iframe.attach-iframe, iframe[module="insertAttach"]')).forEach((el) => {
        const objectid = el.getAttribute('objectid') || el.getAttribute('objectId') || '';
        if (!objectid) return;
        out.push({
          objectid: objectid,
          filename: el.getAttribute('filename') || '',
          filetype: el.getAttribute('filetype') || ''
        });
      });
    } catch (e) {}
    return out;
  }

  function guessType(stem, options, shell) {
    if (shell === 'group') return 'reader';
    if (shell === 'match') return 'match';
    if (shell === 'media') return /听力|听录音|listen/i.test(stem) ? 'listening' : 'oral';
    if (shell === 'attach') return 'completion';
    const texts = options.map((o) => CXAI.U.normText(o.text));
    if (options.length === 0) return 'completion';
    if (options.length === 2 && texts.every((t) => JUDGE_WORDS.indexOf(t) >= 0)) return 'judgement';
    if (/多选|多项选择|不定项/.test(stem)) return 'multiple';
    if (/判断/.test(stem) && options.length <= 2) return 'judgement';
    if (TEXT_WORDS.test(stem) && options.length === 0) return 'completion';
    if (/阅读/.test(stem) && options.length === 0) return 'reader';
    if (/完形/.test(stem) && options.length === 0) return 'fill';
    return 'single';
  }

  /* ---------- 单题解析 ---------- */

  function readTypeInput(root, pageKind) {
    // 考试页 type 在 input[name^="type"]，作业页在 input[id^="answertype"]
    const candidates = Array.from(root.querySelectorAll('input[name^="type"], input[id^="answertype"], input[answertype]'));
    for (const el of candidates) {
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      // 非预览模式会有干扰项，只有 name=type\d+ 才是真题型
      if (/^type\d+$/.test(name)) return typeFromValue(el.value);
      if (/^answertype/.test(id) || el.hasAttribute('answertype')) return typeFromValue(el.value || el.getAttribute('answertype'));
    }
    // 回退：全页只有一道题时才允许页面级回退（原因同 readTypeRaw）
    if (!singleQuestionPage()) return null;
    const any = document.querySelector('input[name^="type"], input[answertype]');
    if (any) return typeFromValue(any.value || any.getAttribute('answertype'));
    return null;
  }

  function readStem(root) {
    // 优先 .mark_name（题目标题），其次 h3，再次整块文本
    const selectors = ['.mark_name', 'h3', '.Zy_TItle .clearfix', '.Cy_TItle'];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && (el.textContent || '').trim()) return el.textContent;
    }
    // 整卷预览：h3 + div 分片
    const parts = Array.from(root.children)
      .filter((c) => !c.classList.contains('stem_answer') && !c.classList.contains('mark_answer'))
      .map((c) => c.textContent || '')
      .join(' ');
    if (parts.trim()) return parts;
    return root.textContent || '';
  }

  function readOptionElements(root) {
    // 选择/判断选项；填空的输入区也在同一批选择器里
    let els = Array.from(root.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv'));
    if (els.length === 0) els = Array.from(root.querySelectorAll('.answerBg, .textDIV, .eidtDiv, .Cy_ulTop li'));
    els = els.filter((el) => {
      if (!el) return false;
      // 表单控件本身永远不是"选项"：简答题的 <textarea class="eidtDiv"> 与 .eidtDiv 同名，
      // 不过滤的话 1 道简答会被读成"1 个选项的单选题"，答案就去点输入框了（2026-11-18 实测）。
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return false;
      if (el.closest('.mark_answer')) return false; // 答案解析区
      // 富文本编辑器（填空/简答）的容器也叫 .textDIV，里面是工具栏 + iframe。
      // 不排除的话它会被当成一个"选项"，读数变成 "A:段落格式 字体 字号" 这种垃圾。
      if (el.closest('.subEditor, .edui-editor, .edui-default')) return false;
      if (el.querySelector && el.querySelector('textarea[id], iframe[id^="ueditor"]')) return false;
      if (/subEditor|edui/.test(String(el.className || ''))) return false;
      return true;
    });
    // 关键去重：`.answerBg .answer_p` 与它内部的 `.textDIV` 会同时命中，
    // 不去重的话一道 4 选项的单选会读成 8 个选项，答案字母全错位。
    els = els.filter((el) => !els.some((other) => other !== el && other.contains && other.contains(el)));
    return els;
  }

  /**
   * 选项三元组：页面显示字母 / 服务端真正提交的键 / 选项文本。
   * randomOptions=true 时页面显示 A、span[data] 却是 D：
   * key 保持页面显示字母（模型/UI 都用它），另存 serverKey，
   * 读回隐藏域时先映射回显示字母再比较，避免"答对点错"。
   */
  function optionMeta(el, i) {
    const holder =
      (el.closest && (el.closest('.answerBg') || el.closest('.hoverDiv') || el.closest('li'))) || el;
    let labelEl = null;
    try {
      labelEl =
        (holder.querySelector && holder.querySelector('.num_option, .num_option_dx, .option_num, .num, span[choice_name]')) ||
        (el.querySelector && el.querySelector('.num_option, .num_option_dx, .option_num, .num')) ||
        null;
    } catch (e) {}
    const raw = String(el.innerText || el.textContent || '').trim();
    let display = '';
    if (labelEl) {
      display = String(labelEl.textContent || '')
        .replace(/[^A-Za-z对错]/g, '')
        .trim()
        .toUpperCase();
    }
    if (!display) {
      const m = /^\s*([A-Ha-h])\s*[、.．)）:：]/.exec(raw);
      if (m) display = m[1].toUpperCase();
    }
    if (!display || display.length > 2) display = String.fromCharCode(65 + i);

    let serverKey = '';
    const candidates = [
      labelEl && labelEl.getAttribute && labelEl.getAttribute('data'),
      labelEl && labelEl.getAttribute && labelEl.getAttribute('choice_name'),
      holder.getAttribute && holder.getAttribute('data'),
      holder.getAttribute && holder.getAttribute('choice_name'),
      holder.getAttribute && holder.getAttribute('data-value'),
      holder.getAttribute && holder.getAttribute('value')
    ];
    for (const c of candidates) {
      const v = String(c == null ? '' : c).trim();
      if (!v) continue;
      if (/^\d{6,}$/.test(v)) continue;
      serverKey = v.toUpperCase();
      break;
    }
    return { displayLabel: display, serverKey: serverKey, holder: holder };
  }

  /** 选中态类名：check_answer / check_answer_dx / checkAnswer / checked / selected …（排除 un* 反向前缀） */
  const SEL_TOKEN = /^(check_?answer\w*|checked|selected|active|chosed|chosen|curSelected)$/i;

  function markHit(node) {
    if (!node) return false;
    if (node.getAttribute && node.getAttribute('aria-checked') === 'true') return true;
    if (node.hasAttribute && node.hasAttribute('checked')) return true;
    const tokens = String(node.className || '').split(/\s+/);
    return tokens.some((t) => !!t && !/^un/i.test(t) && SEL_TOKEN.test(t));
  }

  /**
   * 选项的"作用域"：从选项往上走，直到再上一层就会把别的选项也包进来为止。
   *
   * 这一步是必须的。超星考试页的结构是
   *   .stem_answer
   *     > .answerBg(选项A) > .answer_p
   *     > .answerBg(选项B) > .answer_p
   * v1.4.6 把判定往上找到 .stem_answer 的 `[class*="check_answer"]`，
   * 而 .stem_answer 同时包住 A/B/C/D —— 只要选中任意一个，四个选项就全被当成"已选"，
   * 于是多选的"取消多余勾选"一次都不执行（真机留下 answers{qid}=ACD 而正确答案是 AB），
   * 判断题/单选也会被误判为已答而跳过。
   */
  const OPTISH = '.answer_p, .textDIV, .eidtDiv, .answerBg, .Cy_ulTop li, .stem_answer > *';

  function optionScope(el, siblings) {
    if (!el) return null;
    const sibs = (siblings || []).filter(Boolean);
    let scope = el;
    let cur = el.parentElement;
    let guard = 0;
    while (cur && guard++ < 8) {
      if (sibs.length) {
        if (sibs.some((o) => o !== el && o !== scope && cur.contains(o))) break;
      } else {
        // 没给兄弟列表时（外部直接调 isChecked），用"这层包着几个可选项"判断越界：
        // 包了 2 个以上就说明再往上已经不是单个选项的容器了。
        let count = 0;
        try {
          count = cur.querySelectorAll(OPTISH).length;
        } catch (e) {
          count = 0;
        }
        if (count > 1) break;
      }
      scope = cur;
      cur = cur.parentElement;
    }
    return scope;
  }

  function isOptionAnswered(el, type, siblings) {
    if (type === 'completion') {
      const ta = el.querySelector('textarea');
      if (ta && ta.value && ta.value.trim()) return true;
      const frame = el.querySelector('iframe');
      if (frame) {
        try {
          const body = frame.contentDocument && frame.contentDocument.body;
          if (body && (body.innerText || '').trim()) return true;
        } catch (e) {}
      }
      const inp = el.querySelector('input[type="text"]');
      if (inp && inp.value && inp.value.trim()) return true;
      return false;
    }
    // 只在"仅含这一个选项"的容器里找选中标记
    const scope = optionScope(el, siblings) || el;
    if (markHit(scope)) return true;
    try {
      const inner = scope.querySelectorAll ? Array.from(scope.querySelectorAll('*')).slice(0, 30) : [];
      if (inner.some(markHit)) return true;
    } catch (e) {}
    const inp =
      (scope.querySelector && scope.querySelector('input[type="radio"], input[type="checkbox"]')) ||
      (el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]'));
    if (inp && (inp.checked || (inp.hasAttribute && inp.hasAttribute('checked')))) return true;
    return false;
  }

  function readTextInputs(root) {
    const list = [];
    root.querySelectorAll('textarea, input[type="text"]').forEach((el) => {
      if (el.closest('.mark_answer')) return;
      list.push(el);
    });
    root.querySelectorAll('iframe').forEach((el) => {
      if (el.closest('.mark_answer')) return;
      // 附件预览 / 音视频容器不是答题框：混进 q.inputs 后，填空题的答案会被写进
      // 附件 iframe 的 body（同源预览时甚至会改掉附件页），而真正的答题框反而空着。
      if (el.closest && (el.closest('.attach-iframe') || el.closest('[module="insertAttach"]'))) return;
      const src = String((el.getAttribute && el.getAttribute('src')) || '');
      if (/ueditorupload|\/read\?objectid|\.(?:mp4|mp3|pdf)(?:[?#]|$)/i.test(src)) return;
      list.push(el);
    });
    return list;
  }

  /**
   * 题干图片：滤掉图标/头像/二维码/装饰图，并优先收题干容器里的图。
   * 旧实现只滤 `/static/|icon|logo|blank.gif`，头像、二维码、装饰图都会进视觉模型；
   * 再加上 maxImages 截断，真正的题图反而可能被挤掉。
   */
  function readImages(root) {
    const out = [];
    const seen = {};
    const push = (img, forced) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src) return;
      if (/\/static\/|icon|logo|blank\.gif|avatar|headimg|qrcode|qr_code|emoji|loading|spacer|\.svg(?:[?#]|$)/i.test(src)) return;
      const cls = String(img.className || '') + ' ' + String((img.parentElement && img.parentElement.className) || '');
      if (!forced && /avatar|head|user|qrcode|qr|icon|logo|emoji|badge|decorate/i.test(cls)) return;
      const w = Number(img.getAttribute('width') || img.naturalWidth || 0);
      const h = Number(img.getAttribute('height') || img.naturalHeight || 0);
      if (!forced && w && h && w < 80 && h < 80) return; // 小图标
      let href = '';
      try {
        href = new URL(src, location.href).href;
      } catch (e) {
        href = src;
      }
      if (seen[href]) return;
      seen[href] = 1;
      out.push(href);
    };
    // 题干容器里的图最可信：先收，避免 maxImages 截断时把真题图挤出去
    let stemBox = null;
    try {
      stemBox = root.querySelector('.mark_name, .Zy_TItle, .Cy_TItle, .stem_answer');
    } catch (e) {}
    if (stemBox) {
      try {
        Array.from(stemBox.querySelectorAll('img')).forEach((img) => push(img, true));
      } catch (e) {}
    }
    try {
      Array.from(root.querySelectorAll('img')).forEach((img) => push(img, false));
    } catch (e) {}
    return out;
  }

  /**
   * 小题组（完型填空 / 阅读理解 / 材料题）的各小题选项。
   * 页面结构：每个小题一组 div.hoverDiv，里面 .addChoice[qid][data]；
   * 点它 = 页面自己的 addChoice(this) → 把字母写进 #answer{qid}。
   * 这里按 qid 分组，组顺序即页面小题顺序（2026-11-18 真机实测两类页面同构）。
   */
  function readGroupBlanks(root) {
    /**
     * 形态二（2026-11-19 真机：完型填空 / 阅读理解 / 共用选项题）：
     *   每个空是一组 `.hoverDiv`，onclick="saveSingleSelect(this,'<题号>')"，
     *   内层 `<span data="A" qid="<空UUID>">A</span>`。点 .hoverDiv 触发页面自己的保存，
     *   答案写进 `input[name="answer<题号>"]` 的 JSON（键是空 UUID）。
     * 旧实现只认 `.addChoice[qid]`，这些题 group 恒为 0，于是全部"没有可写入的答题框"。
     */
    const byUuid = new Map();
    const stems = {};
    // 顶层普通选项的 span.addChoice[qid] 里 qid 就是本题题号；
    // 只有小题组的空才用另一套 UUID。把它排除，否则普通选择题会被
    // 误判成"1 个空的小题组"，落盘走 answerGroup 而不是 answerChoice
    // （randomOptions 页面尤其明显：显示 A、data=D，结果点到别的选项）。
    let selfQid = '';
    try {
      selfQid = qidOf(root);
    } catch (e) {}
    try {
      Array.from(root.querySelectorAll('.hoverDiv')).forEach((el) => {
        const tag = el.querySelector('span[data][qid], span[data]');
        if (!tag) return;
        const uuid = String(tag.getAttribute('qid') || '');
        if (!uuid || uuid === selfQid) return;
        const key = String(tag.getAttribute('data') || '').trim().toUpperCase();
        if (!uuid || !key) return;
        if (!stems[uuid]) {
          // 小题题干：阅读理解的每个空前面都有 .reader_answer_tit（"(1) What will …"）。
          // 不抓它，模型只看到正文 + 一堆选项，不知道每个空在问什么（实测只能回段落摘要）。
          // 注意：这里的变量必须在 try 外层声明 —— 上一版把 block 写在 try 里，
          // 完后型题（没有 .reader_answer_tit）引用它就抛 ReferenceError，
          // 整个分组循环中断，group 直接变 0（2026-11-19 实测第 8 题）。
          let tit = null;
          try {
            const holder = el.closest('.stem_answer') || el.parentElement;
            const wrap = holder && holder.parentElement ? holder.parentElement : holder;
            const area = el.closest('.reading_answer');
            tit =
              (wrap && wrap.querySelector && wrap.querySelector('.reader_answer_tit, .stem_tit, .sub_tit')) ||
              (area && area.querySelector && area.querySelector('.reader_answer_tit')) ||
              null;
          } catch (e) {}
          if (tit) stems[uuid] = String(tit.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (!byUuid.has(uuid)) byUuid.set(uuid, []);
        byUuid.get(uuid).push({
          key: key,
          data: key,
          text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
          el: el,
          holder: el,
          add: el,
          uuid: uuid
        });
      });
    } catch (e) {}
    if (byUuid.size) {
      return Array.from(byUuid.entries()).map(function (pair) {
        return { qid: pair[0], stem: stems[pair[0]] || '', options: pair[1], answerEl: null, json: true };
      });
    }

    /**
     * 形态三（共用选项题）：每个空是 `.B-answerCon[index]`，里面
     * `<span choice_name="A" onclick="saveBTypeSelect(this,'<题号>')">A</span>`。
     * 页面自己的 addChoiceByBType 负责标记，submitForm 负责提交。
     */
    try {
      const bts = Array.from(root.querySelectorAll('.B-answerCon'));
      if (bts.length) {
        const blanks = bts
          .map(function (el) {
            const opts = Array.from(el.querySelectorAll('span[choice_name]'))
              .map(function (sp) {
                const key = String(sp.getAttribute('choice_name') || '').trim().toUpperCase();
                return { key: key, data: key, text: key, el: sp, holder: el, add: sp };
              })
              .filter(function (o) {
                return o.key;
              });
            let bstem = '';
            try {
              // 共用选项题每个空上面的题干：<p class="B-tit">(1) 国际非专利药品名是（ ）</p>
              const prev = el.previousElementSibling;
              const tit = (prev && prev.querySelector && prev.querySelector('.B-tit')) || (prev && /B-tit/.test(String(prev.className || '')) ? prev : null);
              const near = tit || el.parentElement.querySelector('.B-tit');
              if (near) bstem = String(near.textContent || '').replace(/\s+/g, ' ').trim();
            } catch (e) {}
            return {
              qid: 'bt' + (el.getAttribute('index') || ''),
              index: String(el.getAttribute('index') || ''),
              btype: true,
              stem: bstem,
              answerEl: null,
              options: opts
            };
          })
          .filter(function (b) {
            return b.options.length;
          });
        if (blanks.length) return blanks;
      }
    } catch (e) {}

    let els = [];
    try {
      els = Array.from(root.querySelectorAll('.addChoice[qid]'));
    } catch (e) {
      return [];
    }
    if (selfQid) els = els.filter((el) => String(el.getAttribute('qid') || '') !== selfQid);
    if (!els.length) return [];
    const qids = [];
    els.forEach(function (el) {
      const qid = String(el.getAttribute('qid') || '');
      if (qid && qids.indexOf(qid) < 0) qids.push(qid);
    });
    return qids
      .map(function (qid) {
        const opts = els
          .filter(function (el) {
            return String(el.getAttribute('qid') || '') === qid;
          })
          .map(function (el, k) {
            const data = String(el.getAttribute('data') || '').trim();
            const holder = el.closest ? el.closest('.hoverDiv') : null;
            return {
              key: (data || String.fromCharCode(65 + k)).toUpperCase(),
              data: data,
              text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
              // 关键：onclick="addChoice(this)" 挂在 .addChoice 自己身上（不是外层 .hoverDiv），
              // 点外层不会触发页面逻辑 —— 2026-11-18 实测 #answer{qid} 一直是空。
              el: el,
              holder: holder,
              add: el
            };
          });
        let answerEl = null;
        try {
          answerEl = root.querySelector('#answer' + qid);
        } catch (e) {}
        return { qid: qid, options: opts, answerEl: answerEl };
      })
      .filter(function (b) {
        return b.options.length > 0;
      });
  }

  /**
   * 判断题的另一种皮肤：选项不是 `.answerBg > .answer_p`，而是
   *   <div class="hoverDiv" onclick="..."><span data="true" qid="…">对</span></div>
   * 于是 `readGroupBlanks` 把它当成"只有 1 个空的小题组"，而模型回的是字母 A/B，
   * `answerGroup` 里按字母找选项永远找不到 —— 每题都报「小题组只落了 0/1 个空」。
   * 2026-11-19 用户真机就是这个：答一题模式下判断题点了没反应、日志 0/1 空。
   *
   * OCS 的做法是判断题一律按「对/错」文字点。所以这里在抓题阶段就把它还原成判断题形态：
   * 选项键按位置给 A/B（保持字母口径），点的元素沿用 span（onclick 常在它身上）。
   */
  function normalizeJudgeGroup(q) {
    if (!q || !q.group || q.group.length !== 1) return;
    const b = q.group[0] || {};
    const opts = (b.options || []).slice(0, 4);
    if (opts.length < 2) return;
    // 字母键说明它真的是"完型/阅读/共用选项"的那一空，别动
    if (opts.every((o) => /^[A-H]$/i.test(String((o && o.key) || '')))) return;
    const textOf = (o) => String((o && (o.text || o.data || o.key)) || '').trim();
    const YES = /^(对|正确|是|√|v|true|t|yes|y|1|right)$/i;
    const NO = /^(错|错误|否|×|x|false|f|no|n|0|wrong)$/i;
    const hasYes = opts.some((o) => YES.test(textOf(o)));
    const hasNo = opts.some((o) => NO.test(textOf(o)));
    if (!(hasYes && hasNo)) return;
    const els = opts.map((o) => (o && (o.add || o.el || o.holder)) || null).filter(Boolean);
    q.type = 'judgement';
    q.typeLabel = labelOf('judgement', q.typeCode);
    q.shell = 'choice';
    q.shellLabel = SHELL_LABEL.choice;
    q.options = opts.map(function (o, i) {
      const raw = textOf(o);
      return {
        key: String.fromCharCode(65 + i),
        // 选项文字只有 "true"/"false" 时换成中文，模型和日志都好看
        text: cleanOption(YES.test(raw) ? '对' : NO.test(raw) ? '错' : raw, i),
        raw: raw,
        el: o.add || o.el || o.holder || null,
        clickEl: o.add || o.el || o.holder || null,
        answered: false
      };
    });
    q.options.forEach((o) => {
      o.answered = isOptionAnswered(o.el, 'judgement', els);
    });
    q.judgeRaw = opts.map(function (o, i) {
      return { key: String.fromCharCode(65 + i), data: String((o && (o.data || o.key)) || '') };
    });
    q.group = [];
  }

  function parseOne(root, index, pageKind) {
    const typeFromInput = readTypeInput(root, pageKind);
    const typeCode = readTypeRaw(root);
    const attachments = readAttachments(root);
    const optionEls = readOptionElements(root);
    const stemRaw = readStem(root);
    const stem = cleanStem(stemRaw);
    // 输入框先抓：题型码可能缺失/错乱，但"页面上有没有可写的位置"是客观事实，
    // 它决定这题能不能自动写（全题型兜底的第一手证据）。
    const rawInputs = readTextInputs(root);
    // 附件题：题干被清理后就空了（只剩题型标签），题目在附件里。
    // 这里必须给个占位题干，否则 collect() 会把整题当空容器丢掉（只保留"有题干或有选项"的题）。
    const stemFinal = stem || (attachments.length ? '【附件材料】' + (attachments[0].filename || '附件') : '');

    const options = optionEls.map((el, i) => {
      const raw = (el.innerText || el.textContent || '').trim();
      const meta = optionMeta(el, i);
      return {
        key: meta.displayLabel,
        displayLabel: meta.displayLabel,
        serverKey: meta.serverKey,
        text: cleanOption(raw, i),
        raw,
        el,
        answered: false
      };
    });

    const shell0 = detectShell(root, options, rawInputs, attachments);
    let type = typeFromInput;
    if (!type || type === 'unknown') type = guessType(stem, options, shell0);
    // 选择题但无法匹配选项 -> 视为填空/文本题（别把"抓不到选项"当成"这题不该答"）
    if ((type === 'single' || type === 'multiple' || type === 'judgement') && options.length === 0) {
      type = shell0 === 'group' ? 'reader' : 'completion';
    }
    const shell = detectShell(root, options, rawInputs, attachments);

    const optEls = options.map((o) => o.el);
    options.forEach((o) => {
      o.answered = isOptionAnswered(o.el, type, optEls);
    });

    const q = {
      index,
      key: CXAI.U.normText(stemFinal).slice(0, 120) || 'q' + index,
      qid: qidOf(root),
      type,
      typeLabel: labelOf(type, typeCode),
      typeCode: typeCode,
      shell: shell,
      shellLabel: SHELL_LABEL[shell] || shell,
      // 小题组的各小题选项（完型 6 空 / 阅读 3 小题这种），非小题组一律空数组
      // 小题组的承载形态不止 shell=group：共用选项题是 shell=manual，
      // 统一解析，解析不到自然返回 []
      group: readGroupBlanks(root),
      media: readMedia(root),
      stem: stemFinal,
      stemRaw: String(stemRaw || '').replace(/\s+/g, ' ').trim(),
      options,
      inputs: shell === 'choice' ? [] : rawInputs,
      images: readImages(root),
      attachments: attachments,
      score: extractScore(root),
      root,
      answered: false
    };
    // 判断题被 .hoverDiv/true-false 皮肤误判成"1 个空的小题组"时在这里还原
    try {
      normalizeJudgeGroup(q);
    } catch (e) {}
    q.answered = isAnsweredNow(q);
    return q;
  }

  /**
   * 这题在页面上是不是已经答了。
   * 选择题以"页面自己的答案隐藏域"为准（#answer{qid} / answers{qid}），
   * 拿不到再退回看选项选中标记；填空/简答看 UEditor / 文本框里有没有内容。
   */
  function isAnsweredNow(q) {
    if (!q) return false;
    const v = pageValue(q);
    if (v && v.value) return true;
    if (q.type === 'completion') return false;
    return (q.options || []).some((o) => o.answered);
  }

  /* ---------------- 页面真实答案 / 题库无关的确定性线索 ---------------- */

  /** 超星的题号：.questionLi[data]，其次题型隐藏域名字里的题号（type123 / answertype123） */
  /**
   * 页面答案的"可读视图"：和 AI 答案统一成 `A|||B` 口径。
   *   - pageValue 只读第一个隐藏域/第一个输入框，面板里就成了「风」（AI 是 风|||雅|||颂）；
   *   - 小题组把 `input[name=answer<题号>]` 的 UUID JSON 原样显示，又长又看不懂。
   * 这里按题面形态逐空取值再拼，只用于展示与日志，不参与验收。
   */
  function answerView(q) {
    if (!q) return '';
    // 富文本（UEditor）里读出来是 <p>风</p>，而且同一空常常同时有 iframe 与 textarea
    // 两份值：这里统一去标签、压空白、按内容去重，面板才会显示成「风|||雅|||颂」。
    const clean = function (x) {
      return String(x == null ? '' : x)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const join = function (arr) {
      const seen = {};
      const out = [];
      arr.forEach(function (x) {
        const v = clean(x);
        if (!v || seen[v]) return;
        seen[v] = 1;
        out.push(v.length > 160 ? v.slice(0, 160) + '…' : v);
      });
      return out.join('|||');
    };
    const readJsonBlanks = function () {
      const out = [];
      let box = null;
      try {
        box =
          document.querySelector('input[name="answer' + q.qid + '"]') ||
          document.querySelector('input[id="answer' + q.qid + '"]');
      } catch (e) {}
      if (!box || !box.value) return null;
      let obj = null;
      try { obj = JSON.parse(box.value); } catch (e) { return null; }
      const list = Array.isArray(obj) ? obj : [obj];
      return list;
    };

    // ① 小题组：逐空取字母（完型/阅读是 UUID 键，共用选项是 name/content）
    if (q.group && q.group.length) {
      const list = readJsonBlanks();
      const out = q.group.map(function (b) {
        let v = '';
        try {
          const el = document.querySelector('#answer' + b.qid);
          if (el && String(el.value || '').trim()) v = String(el.value).trim();
        } catch (e) {}
        if (!v && list) {
          if (b.btype) {
            const hit = list.filter(function (it) { return String(it && it.name) === String(b.index); })[0];
            if (hit) v = String(hit.content || '');
          } else {
            for (const item of list) {
              if (!item) continue;
              let x = item[b.qid];
              if (x == null) continue;
              if (typeof x === 'string') {
                try { x = JSON.parse(x); } catch (e) {}
              }
              const ans = x && typeof x === 'object' ? x.answer : x;
              if (ans) { v = String(ans); break; }
            }
          }
        }
        return String(v || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, 4);
      });
      // 小题组的空是"按位置"的，两个空答案相同是合法的（A|||C|||C），不能去重
      return out.join('|||');
    }

    // ② 文本题：逐空读输入框 / 富文本
    const noChoice = !(q.options && q.options.length);
    if (noChoice) {
      const vals = [];
      (q.inputs || []).forEach(function (el) {
        if (!el || !el.isConnected) return;
        let v = '';
        if (el.tagName === 'IFRAME') {
          try {
            v = el.contentDocument && el.contentDocument.body ? String(el.contentDocument.body.innerText || '').trim() : '';
          } catch (e) {}
        } else {
          v = String(el.value || '').trim();
        }
        if (!v) return;
        // 一个答题框里塞了一串答案时（第 5 题：网页/网站/主页/…），
        // 按段落/换行拆开后用 ||| 连接，面板才和 AI 的分隔口径一致。
        const segs = String(v)
          .replace(/<\/p>|<br\s*\/?>|\n/g, '\n')
          .replace(/<[^>]*>/g, ' ')
          .split('\n')
          .map(function (x) { return x.replace(/\s+/g, ' ').trim(); })
          .filter(Boolean);
        if (segs.length > 1) segs.forEach(function (x) { vals.push(x); });
        else vals.push(v);
      });
      if (vals.length) return join(vals);
    }

    // ③ 选择题：页面自己的字母
    try {
      return String((pageValue(q) || {}).value || '').trim();
    } catch (e) {
      return '';
    }
  }

  function qidOf(root) {
    if (!root) return '';
    try {
      const box = root.closest ? root.closest('.questionLi') || root.closest('.TiMu') || root : root;
      const d = box.getAttribute && box.getAttribute('data');
      if (d && /^\d+$/.test(String(d).trim())) return String(d).trim();
    } catch (e) {}

    /**
     * 章节测验 / 作业页的 .TiMu 往往没有 data 属性，但题型隐藏域名字里就带着题号：
     *   <input name="type1234567">  /  <input id="answertype1234567">
     * 旧实现这里直接回退到全页唯一的 #questionId —— 一页十几道题就全被当成同一个 qid，
     * 于是会话缓存、作答记录（qid 主键）、#answer{qid} 回读全部串题：答了第一题，
     * 后面所有题都显示"已答"、并复用第一题的答案。必须先按题块取自己的题号。
     */
    try {
      const t = root.querySelector('input[name^="type"], input[id^="answertype"]');
      if (t) {
        const name = String(t.getAttribute('name') || '');
        const id = String(t.getAttribute('id') || '');
        // 真 qid 是长数字（如 type1234567）；type0/type1 这类短序号是页面干扰项，不能当题号
        const m = /^type(\d{4,})$/.exec(name) || /^answertype(\d{4,})$/.exec(id);
        if (m) return m[1];
      }
    } catch (e) {}

    // 全局 #questionId 只代表"当前这一题"，单题页才可信
    if (!singleQuestionPage()) return '';
    const inp = document.querySelector('#questionId') || document.querySelector('input[name="questionId"]');
    return inp ? String(inp.value || '').trim() : '';
  }

  /**
   * 判断题在页面隐藏域里存的不是 A/B，而是 `true` / `false`（真机实测 #5 判断题
   * `answer{qid}=true`）。拿它去和 AI 的 `A` 比对必然对不上，于是：
   *   ① 已答对的判断题被判成"答错了"→ 反复重做；
   *   ② 落盘验收用 A 比 true → 永远 ok:false → 自动暂停。
   * 这里统一折算成选项字母：按选项文字找出"正确/错误"分别是哪个 key，找不到再退 A/B。
   */
  function judgeKey(q, raw) {
    const txt = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!txt) return '';
    const opts = (q && q.options) || [];
    const find = (re) => opts.filter((o) => re.test(String(o.text || '').trim().toLowerCase()))[0];
    const yes = find(/^(正确|对|是|√|true|t|yes|1)$/) || find(/正确|^对$/);
    const no = find(/^(错误|错|否|×|false|f|no|0)$/) || find(/错误|^错$/);
    if (/^(true|1|t|对|正确|是|√|yes)$/.test(txt)) return yes ? yes.key : 'A';
    if (/^(false|0|f|错|错误|否|×|no)$/.test(txt)) return no ? no.key : 'B';
    return /^[a-h]+$/i.test(txt) ? txt.toUpperCase() : '';
  }

  /** 把页面上的答案折算成统一的字母串（判断题做 true/false → 选项字母） */
  function normPageAnswer(q, raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return '';
    // 题型码缺失被 guessType 猜成 single 时，判断题的隐藏域仍是 true/false：
    // 只要值本身长得像布尔且题目只有两个选项，也按判断题口径折算（否则终验被
    // replace(/[^A-H]/g,'') 清成空串，"点了也选了"却永远报写入失败）。
    const looksBool = /^(true|false|t|f|1|0|对|错|正确|错误|是|否|√|×)$/i.test(v);
    const isJudge = q && (q.type === 'judgement' || (looksBool && (q.options || []).length === 2));
    if (!isJudge) return toDisplayKeys(q, v);
    const k = judgeKey(q, v);
    return k ? toDisplayKeys(q, k) : toDisplayKeys(q, v);
  }

  /**
   * 服务端键 → 页面显示字母。
   * 只用于把隐藏域里的值折算成"模型和 UI 看到的字母"；
   * 点击仍然走选项元素本身，所以不会出现"答对点错"。
   */
  function toDisplayKeys(q, raw) {
    const s = String(raw == null ? '' : raw).trim();
    const opts = (q && q.options) || [];
    if (!s || !opts.length) return s;
    const lookup = function (tok) {
      const u = String(tok || '').trim().toUpperCase();
      if (!u) return '';
      const byServer = opts.filter(function (o) {
        return String(o.serverKey || '').toUpperCase() === u;
      })[0];
      if (byServer) return byServer.key;
      const byDisplay = opts.filter(function (o) {
        return String(o.displayLabel || o.key || '').toUpperCase() === u;
      })[0];
      if (byDisplay) return byDisplay.key;
      return '';
    };
    const whole = lookup(s);
    if (whole) return whole;
    if (/^[A-H]+$/i.test(s)) {
      const mapped = s
        .toUpperCase()
        .split('')
        .map(lookup)
        .join('');
      return mapped || s.toUpperCase();
    }
    return s;
  }

  /** HTML → 纯文本（简答的隐藏域里可能存的是 <p>…</p>） */
  function toPlain(t) {
    return String(t == null ? '' : t)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 页面自己记录的作答内容（选择题=选中字母串，填空/简答=文本） */
  function pageValue(q) {
    if (!q) return { value: '', src: '' };
    const qid = q.qid || qidOf(q.root);
    if (qid) {
      const a =
        document.getElementById('answer' + qid) ||
        document.querySelector('[name="answer' + qid + '"]');
      const as = document.querySelector('[name="answers' + qid + '"]');
      const readOne = (el, src) => {
        const raw = String((el && el.value) || '').trim();
        if (!raw) return null;
        // 简答/论述/阅读/完形/听力/口语/连线：隐藏域里存的是文本（可能带 <p>），要洗成纯文本
        const isText = q && (TEXT_VALUE_TYPES[q.type] || q.type === 'completion' || q.type === 'line');
        return { value: isText ? toPlain(raw) : normPageAnswer(q, raw), raw: raw, src: src };
      };
      const hit = readOne(a, 'answer') || readOne(as, 'answers');
      if (hit) return hit;
    }
    const ed = ueditorOf(q);
    if (ed) {
      const t = plainOf(ed);
      if (t) return { value: t, src: 'ueditor' };
    }
    for (const el of q.inputs || []) {
      if (el && el.value != null && String(el.value).trim()) return { value: toPlain(el.value), src: 'input' };
      if (el && el.tagName === 'IFRAME') {
        try {
          const b = el.contentDocument && el.contentDocument.body;
          // 只认富文本编辑器（contenteditable）：附件预览/视频 iframe 的正文不是考生答案
          const editable = b && (b.isContentEditable || b.getAttribute('contenteditable') === 'true');
          if (editable && (b.innerText || '').trim()) return { value: String(b.innerText).trim(), src: 'iframe' };
        } catch (e) {}
      }
    }
    // 没有隐藏域时按当前 DOM 的选中标记现算（不能用 q.options[].answered —— 那是解析时的快照，点完就过期了）
    const sibs = (q.options || []).map((o) => o.el);
    const marked = (q.options || [])
      .filter((o) => isOptionAnswered(o.el, q.type, sibs))
      .map((o) => o.key)
      .join('');
    if (marked) return { value: marked, src: 'dom' };
    return { value: '', src: '' };
  }

  /** UEditor 全局对象（页面里叫 UE；Tampermonkey 沙箱下要用 unsafeWindow） */
  function ueditorApi() {
    try {
      if (typeof UE !== 'undefined' && UE && typeof UE.getEditor === 'function') return UE;
    } catch (e) {}
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : null;
      if (w && w.UE && typeof w.UE.getEditor === 'function') return w.UE;
    } catch (e) {}
    return null;
  }

  function plainOf(ed) {
    try {
      if (!ed || !ed.body) return '';
      if (ed.getPlainTxt) {
        const t = String(ed.getPlainTxt() || '').replace(/\u200b/g, '').trim();
        if (t) return t;
      }
      const html = String(ed.getContent ? ed.getContent() : '');
      return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return '';
    }
  }

  /** 找出这道题对应的 UEditor 实例（只认页面上真实存在的 textarea / 已建好的实例） */
  function ueditorOf(q) {
    const api = ueditorApi();
    if (!api || !q) return null;
    const inst = (api.instances && typeof api.instances === 'object' ? api.instances : {}) || {};
    const ids = [];
    const root = q.root || document;
    try {
      Array.from(root.querySelectorAll('textarea[id]')).forEach((el) => {
        if (el.id && ids.indexOf(el.id) < 0) ids.push(el.id);
      });
    } catch (e) {}
    // input/iframe 的 id 只有"实例已经存在"时才算数：对 input 调 getEditor 会造出空壳实例
    (q.inputs || []).forEach((el) => {
      if (el && el.id && inst[el.id] && ids.indexOf(el.id) < 0) ids.push(el.id);
    });
    for (const id of ids) {
      try {
        let ed = inst[id];
        if (!ed) {
          const ta = document.getElementById(id);
          if (!ta || String(ta.tagName || '').toUpperCase() !== 'TEXTAREA') continue;
          ed = api.getEditor(id);
        }
        if (ed && typeof ed.getContent === 'function' && ed.body) return ed;
      } catch (e) {}
    }
    return null;
  }

  /** 换页后如果新题带富文本编辑器，尽量把实例重新挂上 */
  /** 页面自己初始化填空/简答编辑器时用的参数（从页面内联脚本里抄的，少一项皮肤就可能不一样） */
  const EDITOR_OPTS = {
    initialFrameHeight: 56,
    toolbars: [],
    pasteplain: true,
    disablePasteImage: true,
    disableDraggable: true
  };

  /**
   * 原地换 DOM 之后把富文本编辑器重新挂上。
   *
   * 页面是靠 `UE.getEditor('answerEditor{qid}1', {...})` 初始化的，所以换完题块后
   * 同一个调用能重新建出实例；但 **ed.body 是异步就绪的**（iframe 写文档），
   * 建完立刻读 body 会是 null —— 之前因此把可用的页面误判成"重建失败"，
   * 一遇填空/简答就整个退回真实跳转。这里改成等到 body 就绪为止。
   */
  async function ensureEditorsAsync(timeoutMs) {
    const api = ueditorApi();
    if (!api) return true;
    const areas = Array.from(document.querySelectorAll('textarea[id^="answerEditor"], textarea[id^="answer"]'));
    if (!areas.length) return true;
    const deadline = Date.now() + (Number(timeoutMs) || 3000);
    const sleepLocal = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const ta of areas) {
      let ed = null;
      try {
        ed = api.getEditor(ta.id, EDITOR_OPTS);
      } catch (e) {
        ed = null;
      }
      if (!ed || typeof ed.setContent !== 'function') return false;
      // 判活只能用"实例的 iframe 还在当前文档里"。
      // 不能用 ed.body.ownerDocument === document —— UEditor 的 body 本来就在它自己的
      // iframe 文档里，这么判会把每一个健康编辑器都判死（v1.5.0 首轮真机就栽在这里，
      // 一遇填空/简答就退回真实跳转）。
      const alive = () => !!(ed.body && ed.iframe && document.contains && document.contains(ed.iframe));
      while (Date.now() < deadline && !alive()) await sleepLocal(80);
      if (!alive()) return false;
    }
    return true;
  }

  /**
   * 题干里自带答案时直接采用（本题选AB / 正确答案：AB / 选择：B）。
   * 只认 A-H 的连续字母，且必须落在选项范围内，避免把英文单词首字母当成答案。
   */
  function stemAnswerKeys(stem, options) {
    const s = String(stem || '');
    const max = Math.max(options && options.length ? options.length : 0, 1);
    const pats = [
      /本题\s*(?:请)?(?:选择|选)\s*[:：]?\s*([A-Ha-h]{1,8})/,
      /(?:正确答案|参考答案|标准答案|答案)\s*[:：]\s*([A-Ha-h]{1,8})/,
      /(?:请选择|选择)\s*[:：]\s*([A-Ha-h]{1,8})\s*(?:[。.；;，,]|$)/
    ];
    for (const p of pats) {
      const m = p.exec(s);
      if (!m) continue;
      const letters = String(m[1] || '')
        .toUpperCase()
        .split('')
        .filter((c, i, a) => a.indexOf(c) === i);
      if (!letters.length) continue;
      if (letters.length > max) continue;
      const inRange = letters.every((c) => {
        const idx = c.charCodeAt(0) - 65;
        return idx >= 0 && idx < max;
      });
      if (inRange) return letters;
    }
    return [];
  }

  /**
   * 试卷标识：用来把"作答清单"绑到具体一份卷子上。
   * 用户明确要求：换卷/关掉页面之后旧清单不用留 —— 所以清单按这个 key 存，
   * key 一变就把旧清单丢掉（不做跨卷合并）。
   */
  function paperKey() {
    try {
      const q = new URLSearchParams(location.search);
      const get = (n) => q.get(n) || '';
      let pid = '';
      const el = document.querySelector('#paperId, input[name="paperId"], #testPaperId, input[name="testPaperId"]');
      if (el) pid = String(el.value || '').trim();
      const parts = [pid, get('tId'), get('examId'), get('id'), get('workId'), get('courseId')].filter(Boolean);
      if (parts.length) return parts.join('_');
    } catch (e) {}
    return (location.pathname || '') + '|' + String(document.title || '');
  }

  /**
   * 页面上的「整卷预览」入口。
   * 真机（exam-ans/exam/test/reVersionTestStartNew）上是：
   *   <a class="completeBtn fl" href="javascript:;" onclick="topreview();">整卷预览</a>
   * 走它 = 一页装下全部题目，答题时不用逐题翻页（这也是 ocsjs 的做法）。
   */
  function previewEntry() {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll('a,div,span,button,li'));
    } catch (e) {
      return null;
    }
    const byFn = nodes.filter((el) => /topreview|preview/i.test(el.getAttribute && (el.getAttribute('onclick') || el.getAttribute('href') || '')));
    const byText = nodes.filter((el) => /^(整卷预览|试卷预览|整卷)$/.test(String((el.textContent || '').trim())));
    const pick = byFn.concat(byText).filter((el) => el && el.offsetParent);
    return pick[0] || null;
  }

  /** 尽可能走页面自己的 topreview()；没有函数就点那个入口 */
  function enterPreview() {
    const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    try {
      if (typeof w.topreview === 'function') {
        w.topreview();
        return true;
      }
    } catch (e) {}
    const el = previewEntry();
    if (el) {
      try {
        el.click();
        return true;
      } catch (e) {}
    }
    return false;
  }

  /** 整卷题量：优先"题量: N"，其次整卷模式下的题块数 */
  function totalCount() {
    let n = 0;
    try {
      const text = (document.body && document.body.innerText) || '';
      const m = /题量\s*[:：]\s*(\d+)/.exec(text);
      if (m) n = parseInt(m[1], 10);
    } catch (e) {}
    if (!n) {
      const li = document.querySelectorAll('.questionLi').length;
      const timu = document.querySelectorAll('.TiMu').length;
      n = Math.max(li, timu);
    }
    return n || 0;
  }

  /** 当前是第几题（页面 URL 的 start 参数 + 1；整卷模式用题块序号） */
  function currentIndex() {
    try {
      const m = /[?&]start=(\d+)/.exec(location.href);
      if (m) return parseInt(m[1], 10) + 1;
    } catch (e) {}
    return 0;
  }

  /**
   * 无刷新翻页：把 fetch 回来的下一页 HTML 原地换掉当前题块。
   *
   * 注意：`.questionLi` 里就包着 #submitTest（questionId / type{qid} / answers{qid} / enc / start
   * 全在里），整块替换等于连表单状态一起换到新题，页面自己的行内 onclick 也不需要重新绑定
   * （addChoice / addMultipleChoice 都是全局函数 + 行内属性）。
   */
  function applyNextPage(html, opts) {
    opts = opts || {};
    let doc = null;
    try {
      doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch (e) {
      return { ok: false, why: '解析失败' };
    }
    const newLi = doc.querySelector('.questionLi');
    const oldLi = document.querySelector('.questionLi');
    // 最后一题之后再翻页，超星返回的是"提示 / 无效参数！"页 —— 这里必须报"到底了"，
    // 不能让上层把它当成"编辑���重建失败"而真跳过去（跳过去就回不来了）。
    if (!newLi) return { ok: false, why: '下一页没有题块：已到最后一题', end: true };
    if (!oldLi) return { ok: false, why: '当前页没有题块' };

    // 最后一题之后超星会跳交卷页 / 提示页，这类页面没有 #submitTest，别硬换
    if (!newLi.querySelector('#submitTest') && !doc.querySelector('#submitTest')) {
      return { ok: false, why: '下一页没有作答表单', end: true };
    }

    const formInsideLi = !!(oldLi.querySelector && oldLi.querySelector('#submitTest'));
    oldLi.outerHTML = newLi.outerHTML;

    if (!formInsideLi) {
      const newForm = doc.querySelector('#submitTest');
      const oldForm = document.querySelector('#submitTest');
      if (newForm && oldForm) oldForm.outerHTML = newForm.outerHTML;
    }
    // 个别皮肤把 #submitTest 放在题块外：题块换掉后表单跟着旧节点一起消失，
    // 页面自己的 submitForm / 答案隐藏域就全读不到了。这里补一次。
    if (!document.querySelector('#submitTest')) {
      const nf = doc.querySelector('#submitTest');
      if (nf) {
        try {
          (document.querySelector('.questionLi') || document.body).appendChild(nf);
        } catch (e) {}
      }
    }
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
      if (w && typeof w.answerCardLocateCurrent === 'function') w.answerCardLocateCurrent();
    } catch (e) {}
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
      if (w && w.MathJax && typeof w.MathJax.typeset === 'function') w.MathJax.typeset();
    } catch (e) {}
    // 换题块 = DOM 全量重建：collect() 的 250ms memo 必须立刻失效，
    // 否则上层 relive/pageValue 读到的是旧题的缓存快照
    invalidateCollect();
    return { ok: true };
  }

  /* ---------- 章节测验（.TiMu） ---------- */

  function parseChapter() {
    const nodes = Array.from(document.querySelectorAll('.TiMu'));
    return nodes.map((root, i) => {
      const stemEl = root.querySelector('.Zy_TItle .clearfix, .Zy_TItle, .clearfix');
      const stem = cleanStem(stemEl ? stemEl.textContent : root.textContent);
      let optionEls = Array.from(root.querySelectorAll('.Zy_ulTop li, .answerBg')).filter((el) => !el.closest('.Py_answer'));
      // 与 parseOne 相同的嵌套去重：`.Zy_ulTop li` 里可能还套着 `.answerBg`，
      // 不去重的话 4 个选项会读成 8 个，答案字母整体错位（章节测验真机结构）。
      optionEls = optionEls.filter(
        (el) => !optionEls.some((other) => other !== el && other.contains && other.contains(el))
      );
      const options = optionEls.map((el, k) => {
        const raw = (el.innerText || el.textContent || '').trim();
        const meta = optionMeta(el, k);
        return {
          key: meta.displayLabel,
          displayLabel: meta.displayLabel,
          serverKey: meta.serverKey,
          text: cleanOption(raw, k),
          raw,
          el,
          answered: false
        };
      });
      const typeAttr = root.querySelector('[answertype]');
      const rawInputs = readTextInputs(root);
      const shell0 = detectShell(root, options, rawInputs, []);
      let type = typeAttr ? typeFromValue(typeAttr.getAttribute('answertype') || typeAttr.value) : null;
      if (!type || type === 'unknown') type = guessType(stem, options, shell0);
      const shell = detectShell(root, options, rawInputs, []);
      const optEls = options.map((o) => o.el);
      options.forEach((o) => {
        o.answered = isOptionAnswered(o.el, type, optEls);
      });
      const q = {
        index: i,
        key: CXAI.U.normText(stem).slice(0, 120) || 'q' + i,
        qid: qidOf(root),
        type,
        typeLabel: labelOf(type, typeCodeFromValue(typeAttr ? typeAttr.getAttribute('answertype') || typeAttr.value : null)),
        shell: shell,
        shellLabel: SHELL_LABEL[shell] || shell,
        media: readMedia(root),
        stem,
        stemRaw: stem,
        options,
        inputs: shell === 'choice' ? [] : rawInputs,
        images: readImages(root),
        score: null,
        root,
        answered: false
      };
      q.answered = isAnsweredNow(q);
      return q;
    });
  }

  /* ---------- 对外 ---------- */

  /**
   * collect() 短窗 memo（2026-11-24）：
   * 一道题的处理路径里 collect 会被调 4~6 次（decrypt / relive / apply / pageValue / freshAnswered），
   * 每次都是全 DOM 解析。这里对 250ms 内的重复调用返回同一份结果；
   * 元素被换掉（applyNextPage）或需要强制刷新时调 invalidateCollect()。
   * 注意：返回的是缓存对象本体，调用方不得改写其结构（只读使用）。
   */
  let collectMemo = null;
  let collectMemoAt = 0;
  let collectMemoDoc = null;
  const COLLECT_MEMO_MS = 250;
  function invalidateCollect() {
    collectMemo = null;
    collectMemoAt = 0;
    collectMemoDoc = null;
  }
  function collect() {
    try {
      // document 换了（测试/页面重挂）立即失效，防止跨文档读到旧快照
      if (collectMemo && collectMemoDoc === document && Date.now() - collectMemoAt < COLLECT_MEMO_MS) return collectMemo;
    } catch (e) {}
    collectMemo = collectFresh();
    collectMemoDoc = document;
    collectMemoAt = Date.now();
    return collectMemo;
  }
  function collectFresh() {
    // 加密字体（font-cxsecret）：映射表就绪后，每次抓题前先把页面上的密文原地还原。
    // 之前 02-font 从未被调用，密文（私用区字符）原样送进模型，题干/选项等于乱码。
    try {
      if (CXAI.Font && CXAI.Font.ensureSync) CXAI.Font.ensureSync(document);
    } catch (e) {}
    const page = detectPage();
    let questions = [];
    if (page.kind === 'chapter') {
      questions = parseChapter();
    } else {
      const roots = Array.from(document.querySelectorAll('.questionLi')).filter((el) => !el.parentElement.closest('.questionLi'));
      questions = roots.map((root, i) => parseOne(root, i, page.kind));
    }
    // 过滤掉"什么也没抓到"的空容器：题干删完为空、但题目全在图片里（纯图片题）、
    // 或者只有附件/音视频/可写输入框，这些都是真实题目，不能因为文字为空就丢掉。
    questions = questions.filter(
      (q) =>
        q.stem ||
        (q.options && q.options.length) ||
        (q.inputs && q.inputs.length) ||
        (q.images && q.images.length) ||
        (q.attachments && q.attachments.length) ||
        (q.media && q.media.length)
    );
    questions.forEach((q, i) => (q.index = i));
    return { page, questions };
  }

  /** 当前是否已经全部答完（用于单题模式判断翻页） */
  function currentAnswered() {
    const { questions } = collect();
    return questions.length > 0 && questions.every((q) => q.answered || (q.options.length > 0 && q.options.some((o) => o.answered)));
  }

  /**
   * 找"下一题"按钮。
   *
   * 超星单题模式里两个按钮是并排的兄弟节点：
   *   上一题  <a class="btnBlue btn_92 fs14" onclick="getTheNextQuestion(-1)">
   *   下一题  <a class="jb_btn jb_btn_92 fs14" onclick="getTheNextQuestion(1)">
   * 早期版本用 [onclick*="getTheNextQuestion"] 取第一个，正好抓中"上一题"，
   * 于是脚本在相邻两题之间来回弹，整卷永远答不完、计数永远是 0。
   */
  function nextButton() {
    const all = Array.from(document.querySelectorAll('[onclick*="getTheNextQuestion"]'));
    const exact = all.find((el) => /getTheNextQuestion\(\s*1\s*\)/.test(el.getAttribute('onclick') || ''));
    if (exact) return exact;
    const loose = all.find((el) => {
      const oc = el.getAttribute('onclick') || '';
      if (/getTheNextQuestion\(\s*-/.test(oc)) return false;
      return !/上一题/.test((el.textContent || '').replace(/\s+/g, ''));
    });
    if (loose) return loose;
    return (
      Array.from(document.querySelectorAll('a,button,div,span')).find(
        (el) => /^下一?题$/.test((el.textContent || '').replace(/\s+/g, '')) && el.offsetParent
      ) || null
    );
  }

  /** 读回页面真正处于选中态的选项 key —— 用来核对 AI 答案有没有真的落到页面上 */
  function selectedKeys(q) {
    if (!q || !q.options || !q.options.length) return '';
    try {
      const sibs = q.options.map((o) => o.el);
      return q.options
        .filter((o) => isOptionAnswered(o.el, q.type, sibs))
        .map((o) => o.key)
        .join('');
    } catch (e) {
      return '';
    }
  }

  function clickNext() {
    const btn = nextButton();
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  /**
   * 在"当前页面重新抓到的题目列表"里找回同一道题。
   * 单题模式页面常有 1~2 个 questionLi（上一题残影 / 下一题预载），
   * 而且重绘后题干里的分值、序号可能变，所以不能只按题干全等匹配。
   */
  function pickSame(list, q) {
    if (!list || !list.length || !q) return null;
    const norm = (t) => CXAI.U.normText(t || '');
    const qStem = norm(q.stem);
    let best = null;
    let bestScore = 0;
    for (const x of list) {
      let score = 0;
      const xs = norm(x.stem);
      if (xs && qStem && xs === qStem) score += 100;
      else if (xs && qStem && xs.length > 8 && qStem.length > 8 &&
        (xs.indexOf(qStem.slice(0, 12)) >= 0 || qStem.indexOf(xs.slice(0, 12)) >= 0)) score += 60;
      // qid 是硬身份：两道纯图片题题干/选项文字可能一模一样，只能靠它区分
      if (q.qid && x.qid) {
        if (x.qid === q.qid) score += 200;
        else score -= 150;
      }
      const qImgs = (q.images || []).join(',');
      const xImgs = (x.images || []).join(',');
      if (qImgs && xImgs) score += qImgs === xImgs ? 60 : -40;
      const qOpts = (q.options || []).map((o) => norm(o.text)).filter(Boolean);
      const xOpts = (x.options || []).map((o) => norm(o.text)).filter(Boolean);
      if (qOpts.length && xOpts.length) {
        const hit = qOpts.filter((t) => xOpts.indexOf(t) >= 0).length;
        score += Math.round((hit / qOpts.length) * 40);
      }
      if (x.index === q.index) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
    }
    if (best && bestScore >= 40) return best;
    return list.length === 1 ? list[0] : null;
  }

  return {
    readGroupBlanks,
    answerView,
    detectPage,
    collect,
    invalidateCollect,
    parseOne,
    guessType,
    typeFromValue,
    cleanStem,
    cleanOption,
    currentAnswered,
    clickNext,
    nextButton,
    selectedKeys,
    toDisplayKeys,
    pickSame,
    TYPE_LABEL,
    SHELL_LABEL,
    detectShell,
    readMedia,
    labelOf,
    // v1.5.0
    optionScope,
    isOptionAnswered,
    isAnsweredNow,
    judgeKey,
    normPageAnswer,
    normalizeJudgeGroup,
    toPlain,
    pageValue,
    stemAnswerKeys,
    totalCount,
    paperKey,
    previewEntry,
    enterPreview,
    currentIndex,
    qidOf,
    ueditorApi,
    ueditorOf,
    ensureEditorsAsync,
    applyNextPage
  };
})();

/* ==================== 03b-vision.js ==================== */
/* ---------------- 读图（多模态）层 ----------------
 * 学习通的图片题有两个硬问题：
 *   1) 图片挂在 mooc1.chaoxing.com 上，多半要带 Cookie/Referer 才给，模型厂商的服务器拉不到；
 *   2) 原图动辄 1~3MB，直传会让 token 费用爆炸、甚至被端点拒收。
 * 所以这里统一做三件事：本地抓图 → 缩放压缩 → 转 data URL（或先转写成文字）。
 *
 * 两种用法：
 *   inline  把 data URL 直接塞给支持视觉的模型（qwen-vl / glm-4v / gpt-4o / magpie 背后的多模态模型）
 *   ocr     先用读图模型把图片"读成文字"，再把文字喂给纯文本模型判题
 */

CXAI.Vision = (function () {
  const imgCache = new Map(); // url -> {at, value}
  const ocrCache = new Map(); // key  -> value

  const SYSTEM_VISION = [
    '你是一名试卷图片转写员。图片来自中国高校在线考试（学习通），可能包含：题干文字、数学公式、化学式、表格、几何图形、电路图、流程图、代码片段、以及印在图片里的选项。',
    '',
    '任务：把图上一切与解题有关的信息，原样转写成纯文本，供后续纯文本模型判题。',
    '要求：',
    '1. 公式用常见线性写法（如 x^2、sqrt(3)、H2SO4、a/b），不要用 LaTeX 花括号。',
    '2. 表格按行输出，列之间用 " | " 分隔，第一行是表头。',
    '3. 图形/电路/几何：描述关键标注、坐标、角度、边长、连接关系，不要只写"一个图"。',
    '4. 图里出现的选项（如 A. xxx）逐条抄下来。',
    '5. 看不清的地方写 [不清]，绝不臆造。',
    '',
    '只输出一个 JSON 对象，不要 markdown 围栏：',
    '{"text":"<完整转写>","questionText":"<图上题干部分，没有就空串>","options":["<选项1>","<选项2>"],"kind":["text|formula|table|figure|code|diagram"],"confidence":<0到1>}'
  ].join('\n');

  /* ---------------- 配置 ---------------- */

  function cfg() {
    const v = CXAI.Cfg.get('ai.vision', {});
    const d = (CXAI.DEFAULT_CONFIG.ai.vision || {});
    const out = Object.assign({}, d, v && typeof v === 'object' ? v : {});
    if (typeof v === 'boolean') out.enabled = v;
    out.maxImages = Math.max(1, Math.min(20, Number(out.maxImages) || 6));
    out.maxEdge = Math.max(320, Math.min(4096, Number(out.maxEdge) || 1400));
    out.quality = Math.max(0.1, Math.min(1, Number(out.quality) || 0.82));
    out.maxTotalBytes = Math.max(200000, Number(out.maxTotalBytes) || 4194304);
    out.fetchTimeoutMs = Math.max(2000, Number(out.fetchTimeoutMs) || 15000);
    out.strategy = ['auto', 'inline', 'ocr', 'off'].indexOf(out.strategy) >= 0 ? out.strategy : 'ocr';
    out.enabled = out.enabled !== false;
    return out;
  }

  function isEnabled() {
    const c = cfg();
    return c.enabled && c.strategy !== 'off';
  }

  function dataUrlBytes(dataUrl) {
    const s = String(dataUrl || '');
    const i = s.indexOf(',');
    if (i < 0) return s.length;
    return Math.round((s.length - i - 1) * 0.75);
  }

  function remember(map, key, value, cap) {
    map.set(key, { at: Date.now(), value: value });
    while (map.size > (cap || 60)) {
      const first = map.keys().next();
      if (first.done) break;
      map.delete(first.value);
    }
  }

  /* ---------------- 抓图 ---------------- */

  function fetchBlob(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'image/*,*/*;q=0.8' };
      try {
        if (typeof location !== 'undefined' && location.href) headers.Referer = location.href;
      } catch (e) {}
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: headers,
          responseType: 'blob',
          timeout: timeoutMs,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
            else reject(new Error('HTTP ' + res.status));
          },
          onerror: () => reject(new Error('图片拉取失败（跨域或需要登录）')),
          ontimeout: () => reject(new Error('图片拉取超时'))
        });
        return;
      }
      if (typeof fetch !== 'function') {
        reject(new Error('当前环境没有可用的请求实现'));
        return;
      }
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (ctrl) ctrl.abort();
      }, timeoutMs);
      fetch(url, ctrl ? { credentials: 'include', signal: ctrl.signal } : { credentials: 'include' })
        .then((r) => {
          clearTimeout(timer);
          if (!r || r.ok === false) throw new Error('HTTP ' + ((r && r.status) || 0));
          if (typeof r.blob === 'function') return r.blob();
          if (typeof r.arrayBuffer === 'function') return r.arrayBuffer();
          throw new Error('响应无法读取');
        })
        .then(resolve)
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (typeof blob === 'string') {
        resolve(/^data:/.test(blob) ? blob : 'data:image/png;base64,' + blob);
        return;
      }
      if (typeof FileReader === 'function' && blob && typeof blob === 'object') {
        try {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(new Error('读取图片失败'));
          fr.readAsDataURL(blob);
          return;
        } catch (e) {
          /* 落到 arrayBuffer 分支 */
        }
      }
      if (blob && typeof blob.arrayBuffer === 'function') {
        blob
          .arrayBuffer()
          .then((buf) => {
            const bytes = new Uint8Array(buf);
            let bin = '';
            const CH = 0x8000;
            for (let i = 0; i < bytes.length; i += CH) {
              bin += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + CH));
            }
            const mime = (blob.type && MIME_EXT[blob.type] ? blob.type : 'image/png');
            resolve('data:' + mime + ';base64,' + btoa(bin));
          })
          .catch(() => reject(new Error('图片编码失败')));
        return;
      }
      reject(new Error('图片数据为空'));
    });
  }

  /** 用 canvas 缩放 + 重编码，失败时原样返回（宁可直接传大图，也不要没图） */
  function compress(dataUrl, maxEdge, quality) {
    if (typeof Image !== 'function' || typeof document === 'undefined' || !document.createElement) {
      return Promise.resolve(dataUrl);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (!settled) {
          settled = true;
          resolve(v || dataUrl);
        }
      };
      let probe = null;
      try {
        probe = document.createElement('canvas');
      } catch (e) {}
      if (!probe || typeof probe.getContext !== 'function') return finish(dataUrl);
      const img = new Image();
      const timer = setTimeout(() => finish(dataUrl), 8000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const w0 = img.naturalWidth || img.width || 0;
          const h0 = img.naturalHeight || img.height || 0;
          if (!w0 || !h0) return finish(dataUrl);
          const scale = Math.min(1, maxEdge / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const g = cv.getContext && cv.getContext('2d');
          if (!g) return finish(dataUrl);
          if (typeof g.fillRect === 'function') {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, w, h);
          }
          g.drawImage(img, 0, 0, w, h);
          const out = cv.toDataURL('image/jpeg', quality);
          finish(out && out.length > 128 ? out : dataUrl);
        } catch (e) {
          finish(dataUrl);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(dataUrl);
      };
      try {
        img.src = dataUrl;
      } catch (e) {
        clearTimeout(timer);
        finish(dataUrl);
      }
    });
  }

  /** 取单张图：URL -> {url,dataUrl,bytes,ok,error}（带内存缓存） */
  async function load(url, c) {
    c = c || cfg();
    const href = String(url || '');
    if (!href) return { url: href, dataUrl: '', bytes: 0, ok: false, error: '空地址' };
    if (/^data:image\//i.test(href)) {
      return { url: href, dataUrl: href, bytes: dataUrlBytes(href), ok: true, cached: true };
    }
    const hit = imgCache.get(href);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Object.assign({}, hit.value, { cached: true });
    try {
      const blob = await fetchBlob(href, c.fetchTimeoutMs);
      let dataUrl = await blobToDataUrl(blob);
      if (!dataUrl) throw new Error('图片数据为空');
      dataUrl = await compress(dataUrl, c.maxEdge, c.quality);
      const value = { url: href, dataUrl: dataUrl, bytes: dataUrlBytes(dataUrl), ok: true };
      remember(imgCache, href, value, c.cacheSize);
      return value;
    } catch (e) {
      return { url: href, dataUrl: '', bytes: 0, ok: false, error: e.message };
    }
  }

  /** 把一道题的图片全部处理成可发送的 parts */
  async function prepare(question) {
    const c = cfg();
    const empty = { items: [], mode: 'none', dropped: 0, totalBytes: 0, strategy: c.strategy };
    if (!c.enabled || c.strategy === 'off') return Object.assign(empty, { mode: 'off' });
    const urls = (question && question.images ? question.images : []).slice(0, c.maxImages);
    if (!urls.length) return empty;

    const items = [];
    let total = 0;
    let dropped = 0;
    for (const u of urls) {
      const got = await load(u, c);
      if (!got.ok) {
        dropped++;
        CXAI.Log.warn('图片读取失败：' + CXAI.U.truncate(got.url, 70) + ' · ' + got.error);
        continue;
      }
      if (got.bytes < 600) {
        dropped++; // 1x1 占位符 / 分隔线
        continue;
      }
      if (total + got.bytes > c.maxTotalBytes) {
        dropped++;
        continue;
      }
      total += got.bytes;
      items.push(got);
    }
    return { items: items, mode: items.length ? 'ready' : 'none', dropped: dropped, totalBytes: total, strategy: c.strategy };
  }

  /* ---------------- 读图模型 ---------------- */

  /** 挑读图模型：优先设置里指定的，其次权重最高的视觉模型 */
  function pickProvider() {
    const c = cfg();
    const vis = CXAI.Cfg.visionProviders();
    if (c.ocrProviderId) {
      const hit = vis.filter((p) => p.id === c.ocrProviderId)[0] || CXAI.Cfg.allProviders().filter((p) => p.id === c.ocrProviderId)[0];
      if (hit) return hit;
    }
    return vis[0] || null;
  }

  function panelHasVision(panel) {
    return (panel || []).some((p) => p && p.vision);
  }

  /* ---------------- 转写 ---------------- */

  function buildVisionUserText(q) {
    const lines = ['【已知信息】'];
    if (q && q.typeLabel) lines.push('题型：' + q.typeLabel);
    if (q && q.stem) lines.push('页面已抓到的题干文字（可能不完整）：' + CXAI.U.truncate(q.stem, 600));
    const opts = (q && q.options ? q.options : []).map((o) => o.key + '. ' + o.text);
    if (opts.length) lines.push('页面已抓到的选项：\n' + opts.join('\n'));
    else lines.push('页面上没有抓到选项（选项可能印在图片里，请一并转写）。');
    lines.push('【任务】按系统提示的 JSON 契约转写图片内容。');
    return lines.join('\n\n');
  }

  function transcribeKey(q, items) {
    const urls = (items || []).map((i) => i.url).join('|');
    return 'ocr|' + urls + '|' + CXAI.U.normText(q && q.stem).slice(0, 160);
  }

  /**
   * 用读图模型把图片转写成文字。
   * @returns {Promise<{text,questionText,options,kind,confidence,providerLabel,raw}>}
   */
  async function transcribe(question, provider, items) {
    provider = provider || pickProvider();
    if (!provider) throw new Error('没有可用的读图模型：请在设置里添加一个支持图片输入的模型（如 qwen-vl-max / glm-4v-plus / magpie 网关）');
    if (!items || !items.length) throw new Error('没有可转写的图片');
    const key = transcribeKey(question, items);
    const hit = ocrCache.get(key);
    if (hit) return Object.assign({ cached: true }, hit.value);

    const messages = [
      { role: 'system', content: SYSTEM_VISION },
      {
        role: 'user',
        content: [{ type: 'text', text: buildVisionUserText(question) }].concat(
          items.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl } }))
        )
      }
    ];
    const res = await CXAI.AI.callProvider(provider, messages, { temperature: 0.1, maxTokens: 1500 });
    const obj = CXAI.U.safeJson(res.text) || {};
    const out = {
      text: String(obj.text || obj.transcript || obj.content || '').trim(),
      questionText: String(obj.questionText || '').trim(),
      options: Array.isArray(obj.options) ? obj.options.map((x) => String(x == null ? '' : x).trim()).filter(Boolean) : [],
      kind: Array.isArray(obj.kind) ? obj.kind.map(String) : [],
      confidence: Number(obj.confidence) > 0 && Number(obj.confidence) <= 1 ? Number(obj.confidence) : 0.6,
      providerId: provider.id,
      providerLabel: provider.label,
      raw: res.text
    };
    if (!out.text && !out.questionText && !out.options.length) {
      // 模型没按契约输出：原文兜底，至少别丢信息
      out.text = String(res.text || '').trim().slice(0, 4000);
      out.confidence = Math.min(out.confidence, 0.45);
    }
    remember(ocrCache, key, out, cfg().cacheSize);
    return out;
  }

  /** 把转写结果拼成给判题模型的文字块 */
  function composePromptBlock(vision) {
    if (!vision) return '';
    const lines = ['【图片转写】以下内容由读图模型从题目图片中提取：'];
    if (vision.questionText) lines.push('图内题干：' + vision.questionText);
    if (vision.text) lines.push(vision.text);
    if (vision.options && vision.options.length) lines.push('图内选项：\n' + vision.options.join('\n'));
    if (!vision.questionText && !vision.text && !(vision.options || []).length) return '';
    lines.push('（转写可能有误差，题干与选项以上下文的页面文字为准，冲突时以页面文字优先。）');
    return lines.join('\n');
  }

  function clear() {
    imgCache.clear();
    ocrCache.clear();
  }

  function stats() {
    let bytes = 0;
    imgCache.forEach((v) => {
      bytes += (v.value && v.value.bytes) || 0;
    });
    return { images: imgCache.size, transcripts: ocrCache.size, bytes: bytes };
  }

  return {
    SYSTEM_VISION,
    cfg,
    isEnabled,
    load,
    prepare,
    pickProvider,
    panelHasVision,
    transcribe,
    composePromptBlock,
    buildVisionUserText,
    dataUrlBytes,
    clear,
    stats
  };
})();

/* ==================== 03c-attach.js ==================== */
/**
 * 03c-attach.js —— 附件题干通道（附件 PDF / Office 当题目）
 *
 * 学习通的「附件题」形态（2026-11 期中考试实测）：
 *   卷面只有 1 道简答题，题干 DOM 里全是空的，真正的题目在附件里：
 *     <iframe class="attach-iframe" module="insertAttach"
 *             objectid="ea89…" filename="…期中考试试卷.pdf" filetype="pdf">
 *   点它跳到 /exam-ans/ueditorupload/read?objectId=…
 *
 * 老版脚本拿到的 stem 是空的 —— 模型等于闭卷瞎答。本模块把附件变成「题图」，
 * 直接塞进 question.images，复用 03b-vision 的读图通道，传输层零改动。
 *
 * 取图有两条路，优先第一条（实测最省事）：
 *
 *  ① 页面原生页图（推荐，无需下载 PDF）
 *     GET /mooc-ans/screen/file?objectid=<id>  →  302 到 pan-yz.chaoxing.com 预览外壳
 *     外壳 HTML 里直接内联了逐页图地址：
 *       https://s3.cldisk.com/sv-w9/doc/<hash>/<objectid>/thumb/1.png   （1023×1447，约 270KB）
 *     这些 PNG 直接可下载（不需要 cookie），按页号排序后当题图送模型。
 *     实测 2 页试卷 → 2 张图 → 读图模型逐页识别题目再做答，正是想要的形态。
 *
 *  ② 兜底：预览页 `.btnDown` 的 CDN 直链（带临时签名）→ 下 PDF 字节 → pdf.js 逐页渲染
 *     仅当页面 HTML 里找不到 thumb 图、或站点改成动态渲染时才会走到这里；
 *     页面里若没有 pdfjsLib 就跳过（本脚本不再强制 @require pdf.js）。
 *
 * 全程可降级：两条路都失败 → 只把附件名与直链写进题干，warn 交给 UI，绝不中断整卷。
 */
(function () {
  /**
   * 注意：这里**不要**写 `const CXAI = (window.CXAI = window.CXAI || {})`。
   * build.js 把所有模块拼进同一个外层 IIFE，模块之间共享外层的 `var CXAI`；
   * 各自 `window.CXAI = ...` 会另造一个对象，而 `08-main` 末尾的 `window.CXAI = CXAI`
   * 会把那个临时对象整个覆盖掉 —— 症状就是 CXAI.Attach 永远是 undefined。
   */

  const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAX_PAGES = 6;
  const MAX_BYTES = 16 * 1024 * 1024;
  const CACHE_TTL = 15 * 60 * 1000;
  const WARN_ONCE = new Set();
  const cache = new Map(); // objectid → {at, meta, pages:[url|dataURL]}

  function cfg() {
    const on = CXAI.Cfg ? CXAI.Cfg.get('answer.attach', true) : true;
    return {
      enabled: on !== false,
      maxPages: MAX_PAGES,
      maxBytes: MAX_BYTES,
      renderEdge: 1600,
      quality: 0.85,
      timeoutMs: 45000
    };
  }

  function warnOnce(key, msg) {
    if (WARN_ONCE.has(key)) return;
    WARN_ONCE.add(key);
    try {
      CXAI.Log && CXAI.Log.warn(msg);
    } catch (e) {}
  }

  /* ---------------- 请求（GM 优先，降级 fetch） ---------------- */

  function gmRequest(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('当前环境没有 GM_xmlhttpRequest'));
        return;
      }
      const headers = { Accept: '*/*' };
      try {
        if (typeof location !== 'undefined' && location.href) headers.Referer = location.href;
      } catch (e) {}
      if (opts.headers) Object.assign(headers, opts.headers);
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: headers,
        responseType: opts.type || 'text',
        timeout: opts.timeout || cfg().timeoutMs,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error('附件请求失败（跨域或需要登录）')),
        ontimeout: () => reject(new Error('附件请求超时'))
      });
    });
  }

  async function fetchText(url, timeoutMs) {
    if (typeof GM_xmlhttpRequest === 'function') {
      const res = await gmRequest(url, { type: 'text', timeout: timeoutMs });
      if (res.status >= 200 && res.status < 300) return String(res.responseText || res.response || '');
      throw new Error('HTTP ' + res.status);
    }
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  async function fetchBytes(url, timeoutMs) {
    if (typeof GM_xmlhttpRequest === 'function') {
      const res = await gmRequest(url, { type: 'arraybuffer', timeout: timeoutMs });
      if (res.status >= 200 && res.status < 300 && res.response) return new Uint8Array(res.response);
      throw new Error('HTTP ' + res.status);
    }
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  /* ---------------- 附件枚举 ---------------- */

  /** iframe 的 name 属性是 base64(URL-encoded JSON)，里面有 objectid/name/type */
  function fromNameAttr(el) {
    const raw = el.getAttribute && el.getAttribute('name');
    if (!raw || raw.length < 24) return null;
    try {
      const obj = JSON.parse(decodeURIComponent(atob(raw)));
      if (!obj || !obj.objectid) return null;
      return { objectid: String(obj.objectid), filename: String(obj.name || ''), filetype: String(obj.type || '') };
    } catch (e) {
      return null;
    }
  }

  function fromPreviewHref(href) {
    if (!href || href.indexOf('ueditorupload/read') < 0) return null;
    try {
      const u = new URL(href, location.href);
      const id = u.searchParams.get('objectId') || u.searchParams.get('objectid');
      if (!id) return null;
      return { objectid: id, filename: u.searchParams.get('fileOriName') || '', filetype: '' };
    } catch (e) {
      return null;
    }
  }

  /** 从一道题的容器里列出附件（去重，保序） */
  function collect(root) {
    const scope = root || document;
    const out = [];
    const seen = Object.create(null);
    const push = (o) => {
      if (!o || !o.objectid || seen[o.objectid]) return;
      seen[o.objectid] = 1;
      out.push(o);
    };
    let nodes = [];
    try {
      nodes = Array.from(
        scope.querySelectorAll(
          'iframe.attach-iframe, iframe[module="insertAttach"], iframe[objectid], iframe[objectId], .attach-iframe, a[href*="ueditorupload/read"]'
        )
      );
    } catch (e) {}
    nodes.forEach((el) => {
      const byAttr = {
        objectid: el.getAttribute('objectid') || el.getAttribute('objectId') || '',
        filename: el.getAttribute('filename') || el.getAttribute('fileOriName') || '',
        filetype: el.getAttribute('filetype') || el.getAttribute('type') || ''
      };
      if (!byAttr.objectid) {
        const n = fromNameAttr(el);
        if (n) Object.assign(byAttr, n);
      }
      if (!byAttr.objectid) {
        const h = fromPreviewHref(el.getAttribute('href') || el.getAttribute('src') || '');
        if (h) Object.assign(byAttr, h);
      }
      push(byAttr);
    });
    return out;
  }

  function previewUrl(a) {
    const origin = location.origin || 'https://mooc1-api.chaoxing.com';
    let url = origin + '/exam-ans/ueditorupload/read?objectId=' + encodeURIComponent(a.objectid);
    if (a.filename) url += '&fileOriName=' + encodeURIComponent(a.filename);
    return url;
  }

  /* ---------------- ① 页面原生页图 ---------------- */

  function pageNoOf(url) {
    const m = /\/thumb\/(\d+)\.(?:png|jpe?g)/i.exec(String(url)) || /(\d+)\.(?:png|jpe?g)$/i.exec(String(url));
    return m ? parseInt(m[1], 10) : 999;
  }

  /* --- 精简 MD5（只用于算 s3 路径，输入是 objectid 这种 ASCII） --- */
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21, 6, 10, 15, 21
  ];

  function md5hex(input) {
    let str = '';
    try {
      str = unescape(encodeURIComponent(String(input == null ? '' : input)));
    } catch (e) {
      str = String(input);
    }
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;

    const n = str.length;
    const words = [];
    for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (str.charCodeAt(i) << ((i % 4) * 8));
    words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
    const total = (((n + 8) >> 6) + 1) * 16;
    for (let i = 0; i < total; i++) if (!words[i]) words[i] = 0;
    words[total - 2] = (n * 8) | 0;

    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (let i = 0; i < total; i += 16) {
      const oa = a;
      const ob = b;
      const oc = c;
      const od = d;
      for (let j = 0; j < 64; j++) {
        let f;
        let g;
        if (j < 16) {
          f = (b & c) | (~b & d);
          g = j;
        } else if (j < 32) {
          f = (d & b) | (~d & c);
          g = (5 * j + 1) % 16;
        } else if (j < 48) {
          f = b ^ c ^ d;
          g = (3 * j + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * j) % 16;
        }
        const tmp = d;
        d = c;
        c = b;
        const x = (a + f + K[j] + (words[i + g] | 0)) | 0;
        b = (b + ((x << MD5_S[j]) | (x >>> (32 - MD5_S[j])))) | 0;
        a = tmp;
      }
      a = (a + oa) | 0;
      b = (b + ob) | 0;
      c = (c + oc) | 0;
      d = (d + od) | 0;
    }

    const rhex = (num) => {
      let s = '';
      for (let i = 0; i < 4; i++) s += ((num >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return s;
    };
    return rhex(a) + rhex(b) + rhex(c) + rhex(d);
  }

  /**
   * s3 目录分片 = md5(objectid) 的**最后三个字节**（每个字节两位 hex）。
   * 实测：objectid=ea89639be4740e40493286718eee0655
   *       md5=98a23d4e4619b8c581d4cd398cf90dc3  →  末三字节 f9 / 0d / c3
   *       图片 = https://s3.cldisk.com/sv-w9/doc/f9/0d/c3/<objectid>/thumb/N.png
   * 这条规则让脚本完全不用下载 PDF、不用临时签名、不用请求外壳页。
   */
  function hashPath(objectid) {
    try {
      const hex = md5hex(objectid);
      if (!hex || hex.length !== 32) return '';
      return hex.slice(26, 28) + '/' + hex.slice(28, 30) + '/' + hex.slice(30, 32);
    } catch (e) {
      return '';
    }
  }

  /**
   * 用 <img> 探一页是否存在（img 不受 CORS 限制，也不吃 CSP connect-src）。
   * 故意不设 setTimeout 超时 —— 页面上常见的"计时器加速/掌控"类扩展会把 setTimeout
   * 改成立即执行（实测某环境 ms=1 就 timeout），用定时器做超时必然误判。
   * 404 会立刻触发 onerror，正常图会 onload，浏览器自身还有网络超时兜底。
   */
  function probeImage(url) {
    return new Promise((resolve) => {
      if (typeof Image !== 'function') {
        resolve({ ok: false, error: 'no Image' });
        return;
      }
      const img = new Image();
      let done = false;
      const fin = (r) => {
        if (done) return;
        done = true;
        resolve(r);
      };
      img.onload = () => fin({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => fin({ ok: false, error: 'load error' });
      img.src = url;
    });
  }

  /**
   * 附件逐页图地址。
   * ① 先按 md5 分片规则直拼（零请求、最快）；
   * ② 拼出来的第一页就取不到时，退回请求预览外壳页从 HTML 里抠地址（规则变了也能兜住）。
   */
  /**
   * 某一页是否存在。
   * s3 对不存在的页返回 **404 + image/png**（1200×675 的占位图，44KB），
   * 所以 `<img>` 的 onload 判断不出真假（实测 8 页全"成功"）。用 HEAD 判状态码最准；
   * HEAD 被 CSP/CORS 拦掉时退回 <img> + 排除那个 1200×675 占位图。
   */
  async function pageExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return true;
      if (r.status === 404) return false;
    } catch (e) {}
    const got = await probeImage(url);
    if (!got.ok) return false;
    return !(got.w === 1200 && got.h === 675);
  }

  async function pageImageUrls(a) {
    const out = [];
    const hp = hashPath(a.objectid);
    if (hp) {
      const base = 'https://s3.cldisk.com/sv-w9/doc/' + hp + '/' + a.objectid + '/thumb/';
      for (let i = 1; i <= MAX_PAGES + 2; i++) {
        const url = base + i + '.png';
        const ok = await pageExists(url);
        if (ok) out.push(url);
        else break; // 页号连续，遇到第一张缺失就是页数到头
      }
      if (out.length) return out;
      return [base + '1.png']; // 全都判不出来也别放弃，交给读图通道试第 1 页
    }

    const origin = location.origin || 'https://mooc1-api.chaoxing.com';
    const url = origin + '/mooc-ans/screen/file?objectid=' + encodeURIComponent(a.objectid);
    const html = await fetchText(url);
    const seen = Object.create(null);
    const re = /((?:https?:)?\/\/[a-z0-9.\-]*cldisk\.com\/[^"'\s()<>]+?\.(?:png|jpe?g|webp))/gi;
    let m;
    while ((m = re.exec(html))) {
      let u = m[1];
      if (u.indexOf('//') === 0) u = 'https:' + u;
      if (seen[u]) continue;
      seen[u] = 1;
      out.push(u);
    }
    out.sort((x, y) => pageNoOf(x) - pageNoOf(y));
    return out;
  }

  /* ---------------- ② 兜底：CDN 直链 + PDF 渲染 ---------------- */

  /** 预览页 → .btnDown 的 CDN 直链（临时签名，约 2 小时有效） */
  async function directUrl(a) {
    const html = await fetchText(previewUrl(a));
    const patterns = [
      /class="[^"]*btnDown[^"]*"[^>]*href="([^"]+)"/i,
      /<a[^>]+href="([^"]+)"[^>]*class="[^"]*btnDown[^"]*"/i,
      /href="(https?:\/\/[^"]*\/download\/[^"]+)"/i
    ];
    let hit = '';
    for (const re of patterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        hit = m[1];
        break;
      }
    }
    if (!hit) throw new Error('附件页里没有下载按钮');
    let u = hit.replace(/&amp;/g, '&');
    if (!/^https?:/i.test(u)) u = location.origin + (u.charAt(0) === '/' ? '' : '/') + u;
    return u;
  }

  function pdfLib() {
    // 油猴沙箱里页面全局要经 unsafeWindow 取，直接读 window.pdfjsLib 永远是 undefined
    let lib = null;
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : null;
      lib = (w && w.pdfjsLib) || window.pdfjsLib;
    } catch (e) {
      lib = window.pdfjsLib;
    }
    if (!lib || typeof lib.getDocument !== 'function') return null;
    try {
      if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      }
    } catch (e) {}
    return lib;
  }

  async function renderPages(bytes, c) {
    const lib = pdfLib();
    if (!lib) throw new Error('页面里没有 pdf.js，跳过 PDF 渲染');
    const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const total = doc.numPages || 0;
    const n = Math.min(total, c.maxPages);
    const pages = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, Math.max(1, c.renderEdge / Math.max(base.width, base.height)));
      const vp = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push({ page: i, dataUrl: canvas.toDataURL('image/jpeg', c.quality) });
    }
    try {
      doc.destroy();
    } catch (e) {}
    return { pages: pages.map((p) => p.dataUrl), total: total };
  }

  /* ---------------- 与题目对象对接 ---------------- */

  function attachStemText(question, meta) {
    const pageInfo = meta.pages ? '（共 ' + meta.pages + ' 页）' : '';
    const tag = '【附件材料】' + (meta.filename || '附件') + pageInfo;
    const cur = String(question.stem || '').trim();
    if (!cur) question.stem = tag;
    else if (cur.indexOf('【附件材料】') < 0) question.stem = cur + '\n' + tag;
  }

  /**
   * 页图 URL → dataURL。
   * 走页面 fetch（s3.cldisk.com 允许跨域，实测 200），而不是 GM_xmlhttpRequest：
   * GM 请求会带自定义 Referer，跨域时触发 preflight，s3 不认 OPTIONS —— 图直接丢。
   * 转成 dataURL 后 03b 的 Vision.load() 是直通分支，不再发任何请求，最稳。
   */
  async function pageToDataUrl(url, edge, quality) {
    const cap = (w, h) => {
      const scale = Math.min(1, (edge || 1400) / Math.max(w, h));
      return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
    };
    const draw = (src, sw, sh) => {
      const size = cap(sw, sh);
      const cv = document.createElement('canvas');
      cv.width = size.w;
      cv.height = size.h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.drawImage(src, 0, 0, size.w, size.h);
      const out = cv.toDataURL('image/jpeg', quality || 0.85);
      if (out && out.length > 2000) return out;
      throw new Error('canvas 输出为空');
    };
    const fromBlob = async (blob) => {
      if (!blob || !blob.size) throw new Error('空图片');
      if (typeof createImageBitmap === 'function') {
        try {
          const bmp = await createImageBitmap(blob);
          try {
            return draw(bmp, bmp.width, bmp.height);
          } finally {
            try {
              if (bmp.close) bmp.close();
            } catch (e) {}
          }
        } catch (e) {}
      }
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => reject(new Error('读取图片失败'));
        fr.readAsDataURL(blob);
      });
    };

    // ① 普通跨域 fetch：s3 的图不需要 cookie，反而**不能**带 credentials ——
    //    `credentials:'include'` 要求 `Access-Control-Allow-Credentials: true`，
    //    而 s3 只回 `Access-Control-Allow-Origin: *`，两者组合必被浏览器拒（Failed to fetch）。
    const inits = [{ mode: 'cors' }, { mode: 'cors', credentials: 'include' }];
    let lastErr = null;
    for (const init of inits) {
      try {
        const r = await fetch(url, init);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await fromBlob(await r.blob());
      } catch (e) {
        lastErr = e;
      }
    }

    // ② 最后一道：<img> + crossOrigin（img 不吃 CSP connect-src，只要 CDN 给了 ACAO 就能画进 canvas）
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            resolve(draw(img, img.naturalWidth, img.naturalHeight));
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
      });
    } catch (e) {
      throw new Error((lastErr && lastErr.message ? lastErr.message : '图片读取失败') + ' / ' + e.message);
    }
  }

  function applyImages(question, meta, images) {
    question.attachMeta = meta;
    if (!question.images) question.images = [];
    (images || []).forEach((src) => {
      const s = typeof src === 'string' ? src : src && src.dataUrl;
      if (s && question.images.indexOf(s) < 0) question.images.push(s);
    });
    attachStemText(question, meta);
  }

  /**
   * 把附件变成题图。返回 attachMeta（没有附件时返回 null）。
   * 幂等：同一道题重复调用只跑一次（attachMeta 已存在直接返回）。
   */
  async function enrich(question) {
    if (!question) return null;
    if (question.attachMeta) return question.attachMeta;
    const c = cfg();
    const list = question.attachments && question.attachments.length ? question.attachments : collect(question.root);
    if (!list.length) return null;
    question.attachments = list;
    if (!c.enabled) {
      question.attachMeta = { filename: list[0].filename, objectid: list[0].objectid, mode: 'off', pages: 0 };
      attachStemText(question, question.attachMeta);
      return question.attachMeta;
    }

    const a = list[0];
    const meta = {
      filename: a.filename || '附件',
      objectid: a.objectid,
      filetype: a.filetype || '',
      pages: 0,
      mode: 'none',
      source: '',
      url: ''
    };

    const hit = cache.get(a.objectid);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      applyImages(question, Object.assign(meta, hit.meta), hit.pages);
      return question.attachMeta;
    }

    // ① 页面原生页图（不用下 PDF）
    try {
      const imgs = await pageImageUrls(a);
      if (imgs.length) {
        const sliced = imgs.slice(0, c.maxPages);
        const dataUrls = [];
        for (const u of sliced) {
          try {
            const d = await pageToDataUrl(u, c.renderEdge, c.quality);
            if (d) dataUrls.push(d);
          } catch (e) {
            warnOnce('img:' + u, '页图转存失败：' + e.message);
          }
        }
        const picked = dataUrls.length ? dataUrls : sliced;
        meta.mode = 'pages';
        meta.source = dataUrls.length ? 'screen+inline' : 'screen';
        meta.pages = imgs.length;
        cache.set(a.objectid, { at: Date.now(), meta: meta, pages: picked });
        applyImages(question, meta, picked);
        try {
          CXAI.Log.info(
            '附件题：' + meta.filename + ' · ' + imgs.length + ' 页，' +
              (dataUrls.length ? dataUrls.length + ' 页已内联成图' : '仅拿到图地址')
          );
        } catch (e) {}
        return question.attachMeta;
      }
    } catch (e) {
      warnOnce('screen:' + a.objectid, '附件页图读取失败：' + e.message);
    }

    // ② 兜底：直链 → PDF 字节 → pdf.js 渲染
    let bytes = null;
    try {
      meta.url = await directUrl(a);
    } catch (e) {
      warnOnce('direct:' + a.objectid, '附件直链获取失败：' + e.message);
    }
    if (meta.url) {
      try {
        const got = await fetchBytes(meta.url);
        if (got && got.length > 512) bytes = got;
      } catch (e) {
        warnOnce('bytes:' + a.objectid, '附件下载失败：' + e.message);
      }
    }
    if (bytes && bytes.length <= c.maxBytes) {
      meta.bytes = bytes.length;
      try {
        const r = await renderPages(bytes, c);
        meta.mode = 'pages';
        meta.source = 'pdf';
        meta.pages = r.total;
        cache.set(a.objectid, { at: Date.now(), meta: meta, pages: r.pages });
        applyImages(question, meta, r.pages);
        try {
          CXAI.Log.info('附件题：' + meta.filename + ' · ' + r.total + ' 页（PDF 渲染）');
        } catch (e) {}
        return question.attachMeta;
      } catch (e) {
        warnOnce('render:' + a.objectid, '附件渲染失败：' + e.message);
      }
    }

    // ③ 全失败：只留线索
    meta.mode = meta.url ? 'link' : 'none';
    question.attachMeta = meta;
    attachStemText(question, meta);
    return meta;
  }

  /** 调试用：拿某份附件已缓存的页图 */
  function pagesOf(objectid) {
    const hit = cache.get(String(objectid || ''));
    return hit ? hit.pages : [];
  }

  function clear() {
    cache.clear();
    WARN_ONCE.clear();
  }

  CXAI.Attach = {
    collect: collect,
    previewUrl: previewUrl,
    pageImageUrls: pageImageUrls,
    pageToDataUrl: pageToDataUrl,
    hashPath: hashPath,
    md5: md5hex,
    probeImage: probeImage,
    directUrl: directUrl,
    enrich: enrich,
    pagesOf: pagesOf,
    clear: clear,
    cfg: cfg
  };
})();

/* ==================== 03d-mark.js ==================== */
/* ---------------- 题目下方作答标注（页面内联结果） ----------------
 * 为什么需要：面板只有一个"选中题"的详情区，考生在页面上核对时得来回切；
 * 2026-11-18 需求：**每道题下方直接显示这题的作答结果**（答案 / 置信度 / 判定阶段 /
 * 依据 / 页面是否一致 / 失败原因）。
 *
 * 实现要点：
 *   · 每题一个 Shadow DOM 小卡片（页面 CSS 再野也污染不进来），挂在 q.root 末尾；
 *   · 只在内存里用 WeakMap 记 root → host，页面重绘后自动重建，不往存储里塞 DOM；
 *   · 任何异常都吞掉 —— 标注是"附加信息"，绝不能因为它让答题主流程中断。
 */

CXAI.Mark = (function () {
  const CSS = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .m { margin: 6px 0 3px; padding: 5px 8px; border: 1px solid #e3e8f0; border-left: 3px solid #94a3b8;
      border-radius: 7px; background: #fbfcfe; font-size: 11.5px; line-height: 1.5; color: #1f2937; }
    .m.ok { border-left-color: #16a34a; background: #f7fdf9; }
    .m.warn { border-left-color: #d97706; background: #fffdf5; }
    .m.bad { border-left-color: #dc2626; background: #fff8f8; }
    .m.manual { border-left-color: #7c3aed; background: #fbf8ff; }
    .h { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .badge { flex: none; font-size: 10.5px; line-height: 17px; padding: 0 6px; border-radius: 4px;
      background: #eef2f8; color: #5b6472; border: 1px solid #e3e8f0; font-weight: 600; }
    .badge.ok { background: #e8f8ee; color: #15803d; border-color: #bfe6cd; }
    .badge.warn { background: #fdf6e3; color: #a16207; border-color: #f0e0b8; }
    .badge.bad { background: #fdeeee; color: #b91c1c; border-color: #f3c9c9; }
    .badge.manual { background: #f3edff; color: #6d28d9; border-color: #ddd0fb; }
    .ans { font-weight: 700; color: #1d4ed8; word-break: break-word; }
    .ans.ok { color: #15803d; }
    .ans.bad { color: #b91c1c; }
    .chip { flex: none; font-size: 10px; line-height: 16px; padding: 0 5px; border-radius: 4px;
      color: #5b6b86; background: #f2f5fa; border: 1px solid #e3e8f0; }
    .chip.low { color: #a16207; background: #fdf6e3; border-color: #f0e0b8; }
    .row { margin-top: 4px; display: flex; gap: 6px; align-items: baseline; }
    .k { flex: none; min-width: 46px; font-size: 10.5px; color: #98a1b0; }
    .v { flex: 1; min-width: 0; color: #374151; word-break: break-word; }
    .v.tight { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .v em { font-style: normal; color: #2563eb; }
    .v.good { color: #15803d; } .v.bad { color: #b91c1c; }
    .vr { color: #5b6472; }
    .t { margin-top: 5px; font-size: 10px; color: #a3abb9; }
  `;

  let MAP = new WeakMap();
  let styleMissing = 0;
  // 每道题最后一次渲染的入参（key = qid 或题干指纹）。
  // 为什么必须有：超星点完选项/保存后经常把 .questionLi 整块重绘，标注节点跟着被丢掉，
  // 用户看到的就是"答完了但题下面什么都没有"（2026-11-18 真机实测）。
  // 有了这份存档就能在题块重建后把同一份结果原样贴回去。
  const LAST = new Map();

  function keyOf(q) {
    try {
      const qid = String((q && q.qid) || '');
      if (qid) return 'qid:' + qid;
      return 'stem:' + CXAI.U.normText((q && q.stem) || '').slice(0, 60);
    } catch (e) {
      return 'stem:?';
    }
  }

  function enabled() {
    // 2026-11-18 用户明确要求：作答详情只放在「双击小球打开的面板」里，
    // 页面上不要任何额外元素（那块卡片会挡题干、看起来像"悬浮窗"）。
    // 所以这里恒为 false —— 整个模块保留只是为了兼容旧调用与历史数据，
    // 任何真实渲染都不会发生。要恢复页内标注必须显式改这一行。
    return false;
  }

  function esc(t) {
    return CXAI.U.escapeHtml(String(t == null ? '' : t));
  }

  function hostOf(q, create) {
    if (!q || !q.root || !q.root.appendChild) return null;
    let host = MAP.get(q.root);
    // MAP 以 root 元素为键：页面重绘会换掉 root，新 root 自然拿到新 host。
    // 这里不再检查 parentNode / isConnected —— 垫片和真浏览器对这两个属性的实现不一致，
    // 用它们会把已挂好的节点误判成游离，进而每次 render 都新建一块（测试里表现为取不到文本）。
    if (host) return host;
    if (!create) return null;
    try {
      host = document.createElement('div');
      host.className = 'cxai-mark';
      host.setAttribute('data-cxai', 'mark');
      host.style.cssText = 'display:block;width:100%;clear:both;margin:0;padding:0;';
      const sh = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
      const box = sh || host;
      const st = document.createElement('style');
      st.textContent = CSS;
      box.appendChild(st);
      const body = document.createElement('div');
      body.className = 'mb';
      box.appendChild(body);
      // 直接留一个正文引用：某些环境（离线测试的 DOM 垫片）attachShadow 不会回写 shadowRoot，
      // 只靠 shadowRoot.querySelector 会拿不到节点。
      try {
        host.__mb = body;
      } catch (e) {}
      q.root.appendChild(host);
      MAP.set(q.root, host);
      return host;
    } catch (e) {
      styleMissing++;
      return null;
    }
  }

  function bodyOf(host) {
    if (!host) return null;
    try {
      if (host.__mb) return host.__mb;
      const sh = host.shadowRoot;
      return sh ? sh.querySelector('.mb') : host.querySelector('.mb');
    } catch (e) {
      return null;
    }
  }

  function stageWord(s) {
    return (
      {
        panel: '议会投票',
        critique: '交叉复核',
        arbiter: '仲裁裁决',
        fallback: '加权兜底',
        rescue: '兜底重试',
        heuristic: '本地兜底',
        cached: '会话缓存',
        stored: '上次判定',
        stem: '题干自带',
        prefetch: '后台预判'
      }[s] || s || ''
    );
  }

  /** 字母答案顺手翻成选项文字：B → B（SYN + ACK） */
  function letterize(val, q) {
    const raw = String(val == null ? '' : val).trim();
    if (!raw) return '';
    const opts = (q && q.options) || [];
    if (!opts.length || !/^[A-Ha-h]+$/.test(raw)) return raw;
    return raw
      .toUpperCase()
      .split('')
      .map(function (c) {
        const o = opts.filter(function (x) {
          return String(x.key || '').toUpperCase() === c;
        })[0];
        if (!o) return c;
        const t = String(o.text || '').replace(/\s+/g, ' ').slice(0, 22);
        return c + '（' + t + '）';
      })
      .join('  ');
  }

  function clip(t, n) {
    const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** 页面答案与 AI 答案是否一致（选择题比字母串，文本题比包含关系） */
  function sameAnswer(ai, page, q) {
    const norm = (t) =>
      String(t == null ? '' : t)
        .replace(/[\s\u00a0]/g, '')
        .toUpperCase();
    const a = norm(ai);
    const b = norm(page);
    if (!a || !b) return false;
    if (a === b) return true;
    if (q && /^(completion|line|reader|fill|match|oral|listening)$/.test(String(q.type || ''))) {
      return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
    }
    return false;
  }

  function timeStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function kv(k, vHtml, cls) {
    return (
      '<div class="row"><span class="k">' + esc(k) + '</span><span class="v ' + (cls || '') + '">' + vHtml + '</span></div>'
    );
  }

  /**
   * 渲染一题的作答结果。
   * @param {object} q   题目对象
   * @param {object} result  AI.solve 的返回（可为空）
   * @param {object} applied Apply.apply 的返回（可为空）
   * @param {object} [opt]  {status:'ok'|'fail'|'skip'|'pending'|'preview'|'manual', error, at}
   */
  function render(q, result, applied, opt) {
    try {
      if (!enabled()) return null;
      const host = hostOf(q, true);
      const body = bodyOf(host);
      if (!body) return null;
      opt = opt || {};
      const ok = applied ? !!applied.ok : opt.status === 'ok' || opt.status === 'skip';
      const manual = !!(applied && applied.manual) || opt.status === 'manual';
      const low = !!(result && (result.lowConfidence || (Number(result.confidence) || 0) < 0.55));
      let state = 'todo';
      let badge = 'AI 已作答';
      if (opt.status === 'pending') {
        state = '';
        badge = '待作答';
      } else if (opt.status === 'preview') {
        state = 'warn';
        badge = '已预判 · 未写入';
      } else if (opt.status === 'skip') {
        state = 'ok';
        badge = '已答 · 沿用页面';
      } else if (ok) {
        state = low ? 'warn' : 'ok';
        badge = low ? '已作答 · 存疑' : 'AI 已作答';
      } else if (manual) {
        state = 'manual';
        badge = '需人工填写';
      } else {
        state = 'bad';
        badge = '写入失败';
      }

      const answer = result && result.answerText ? String(result.answerText) : '';
      // 默认只留一行（状态 + 答案 + 置信度）；要看依据/投票/页面比对得显式开 ui.inlineResultDetail
      const detail = !!(function () {
        try {
          return CXAI.Cfg.get('ui.inlineResultDetail', false) === true;
        } catch (e) {
          return false;
        }
      })();
      const shown = answer ? letterize(answer, q) : '';
      const conf = result && result.confidence != null ? Math.round(Number(result.confidence) * 100) : 0;
      const stage = stageWord(result && result.stage);
      const pageVal = (opt.actual != null ? opt.actual : '') || (applied && applied.actual) || '';
      const parts = [];

      const chips = [];
      if (conf) chips.push('<span class="chip' + (low ? ' low' : '') + '">置信度 ' + conf + '%</span>');
      if (stage) chips.push('<span class="chip">' + esc(stage) + '</span>');
      if (result && result.vision && result.vision.mode && result.vision.mode !== 'none')
        chips.push('<span class="chip">读图 ' + esc(result.vision.mode) + '</span>');

      parts.push(
        '<div class="h"><span class="badge ' + state + '">' + esc(badge) + '</span>' +
          (shown
            ? '<span class="ans ' + (state === 'bad' ? 'bad' : state === 'ok' ? 'ok' : '') + '" title="' + esc(shown) + '">' +
              esc(clip(shown, 180)) + '</span>'
            : '') +
          chips.join('') +
          '</div>'
      );

      if (opt.status === 'pending') {
        parts.push(kv('说明', '还没开始判这道题', 'vr'));
      } else if (detail) {
        const reason = (result && result.reason) || '';
        if (reason) parts.push(kv('依据', esc(clip(reason, 160)), 'vr'));
        if (answer && result && result.keys && result.keys.length) {
          const vs = (result.votes || []).slice(0, 4).map(function (v) {
            const who = clip(v.who || '模型', 12);
            return esc(who + ' ' + (v.answer || '?') + ' ' + (v.confidence != null ? Math.round(v.confidence * 100) + '%' : ''));
          });
          if (vs.length) parts.push(kv('票', '<span class="vr">' + vs.join(' · ') + (result.votes.length > 4 ? ' …' : '') + '</span>'));
        }
        if (pageVal) {
          const same = sameAnswer(answer, pageVal, q);
          parts.push(
            kv('页面', esc(clip(pageVal, 120)) + ' <span class="chip' + (same ? '' : ' low') + '">' + (same ? '与 AI 一致' : '与 AI 不同') + '</span>')
          );
        } else if (state === 'bad') {
          parts.push(kv('原因', esc(clip((applied && applied.error) || opt.error || '页面没有可写入的位置', 150)), 'bad'));
        }
        if (manual && !(state === 'bad')) {
          parts.push(kv('原因', esc(clip((applied && applied.error) || opt.error || '这题没有输入框/选项，答案请手动填', 150)), 'vr'));
        }
        if (result && result.errors && result.errors.length) {
          parts.push(kv('降级', esc(clip(result.errors.slice(-1)[0], 110)), 'vr'));
        }
      }
      const tail = [];
      if (opt.at || result) tail.push('判定于 ' + timeStr());
      if (opt.status === 'skip') tail.push('AI 未参与');
      if (tail.length && detail) parts.push('<div class="t">' + esc(tail.join(' · ')) + '</div>');

      body.innerHTML = '<div class="m ' + state + '">' + parts.join('') + '</div>';
      // 存档：题块被重绘后 attachAll 靠它把同一份结果贴回去
      try {
        LAST.set(keyOf(q), {
          stem: (q && q.stem) || '',
          result: result || null,
          applied: applied || null,
          opt: opt
        });
      } catch (e) {}
      // 纯文本摘要：离线测试的 DOM 垫片不解析 innerHTML，这里顺手留一份，
      // textOf() 与日志排查都靠它（真实浏览器里两者一致）。
      try {
        host.__summary =
          String(body.textContent || '').replace(/\s+/g, ' ').trim() ||
          String(body.innerHTML || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
      } catch (e) {}
      return host;
    } catch (e) {
      return null;
    }
  }

  /** 还没判：挂一条"待作答"，保证每道题下面都有位置 */
  function pending(q) {
    return render(q, null, null, { status: 'pending' });
  }

  /** 后台预取到答案（尚未写入页面） */
  function preview(q, result) {
    return render(q, result, null, { status: 'preview' });
  }

  /** 已答但 AI 没参与（页面上本来就有答案） */
  function existing(q, actual) {
    return render(
      q,
      { answerText: actual || '', confidence: null, stage: 'stored', keys: [] },
      { ok: true, actual: actual || '' },
      { status: 'skip', actual: actual || '' }
    );
  }

  function failed(q, msg, result) {
    return render(q, result || null, { ok: false, error: msg || '未知原因' }, { status: 'fail', error: msg });
  }

  /** 页面里所有题都挂上（幂等）：有存档的按存档回放结果，没存档的挂"待作答" */
  function attachAll(list) {
    try {
      if (!enabled()) return 0;
      let n = 0;
      (list || []).forEach(function (q) {
        const rec = LAST.get(keyOf(q));
        if (rec) {
          // 题块被重绘（超星点选项/保存后常见）：新 root 上还没有 host，这时按存档原样重建；
          // 已经有内容的就不动，免得每秒一次的补挂把 DOM 刷来刷去。
          const has = hostOf(q, false);
          const body = bodyOf(has);
          if (!(body && String(body.textContent || '').trim())) {
            render(q, rec.result, rec.applied, rec.opt);
            n++;
          }
          return;
        }
        const host = hostOf(q, true);
        if (!host) return;
        const body = bodyOf(host);
        if (!body) return;
        if (body.textContent && body.textContent.trim()) return;
        pending(q);
        n++;
      });
      return n;
    } catch (e) {
      return 0;
    }
  }

  function clearAll() {
    try {
      let n = 0;
      Array.from(document.querySelectorAll('.cxai-mark')).forEach(function (el) {
        try {
          if (el.parentNode) el.parentNode.removeChild(el);
        } catch (e) {}
        n++;
      });
      // 连带清掉索引，否则 textOf 还能从旧 host 里读到内容
      MAP = new WeakMap();
      LAST.clear();
      return n;
    } catch (e) {
      return 0;
    }
  }

  /** 调试/测试用：取某题标注的纯文本 */
  function textOf(q) {
    try {
      const host = hostOf(q, false);
      const body = bodyOf(host);
      const t = body ? String(body.textContent || '').replace(/\s+/g, ' ').trim() : '';
      return t || (host && host.__summary) || '';
    } catch (e) {
      return '';
    }
  }

  return { enabled, render, pending, preview, existing, failed, attachAll, clearAll, textOf, letterize, stageWord };
})();

/* ==================== 04-ai.js ==================== */
/* ---------------- AI 层：模型调用 + 多重判定 ----------------
 * 无题库。每道题都交给模型现场推理，并用"议会 + 交叉复核 + 仲裁"三重机制收敛。
 *
 *   Round 1  并行独立作答    N 个模型/多次采样各自给答案 + 置信度
 *   Round 2  交叉复核        每个模型审阅别人的答案，可改判（权重 1.2 倍）
 *   Round 3  仲裁            分歧时由最高权重模型做最终裁决
 *   收敛规则 加权一致率 >= voteThreshold 直接采纳，否则逐级升级
 */

CXAI.AI = (function () {
  const SYSTEM_SOLVE = [
    '你是一位严谨的中国高校考试答题专家，学科覆盖语文、数学、英语、物理、化学、生物、政治、历史、地理、计算机、医学、法学、管理学、经济学、教育学等全部科目。',
    '',
    '严格遵守以下输出契约：',
    '1. 只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释性前后缀。',
    '2. JSON 结构固定为：{"answer":"<答案>","confidence":<0到1的小数>,"reason":"<不超过60字的核心依据>"}',
    '3. answer 字段按题型写：',
    '   - 单选题：单个选项字母，如 "B"',
    '   - 多选题：选项字母连写、按字母升序，如 "ACD"',
    '   - 判断题：单个选项字母（即使选项文本是"正确/错误""对/错""√/×""True/False"，也用字母）',
    '   - 填空题：直接写要填的内容；多个空之间用 "|||" 分隔，顺序与空位一致',
    '   - 简答/论述/名词解释/计算/案例/材料题：写出完整答案；需要过程时先给步骤再给结论，用 "|||" 分隔多个设问',
    '   - 分录题：每笔分录一行，"借：…|||贷：…"',
    '   - 编程题：给完整可运行代码（保留缩进与换行），不要只写思路',
    '   - 连线/匹配题：按 "左项-右项" 配对，多个配对用 "|||" 分隔，如 "A-3|||B-1"',
    '   - 排序题：按正确顺序写选项字母连写，如 "CABD"',
    '   - 阅读理解/完形填空（含多个小题）：按小题顺序作答，"1. …|||2. …"，与小题数一致',
    '   - 口语/听力题：写出应说的完整句子或要点',
    '   - 附件材料题：把材料里出现的每一道题按顺序作答，"1. …|||2. …"',
    '4. confidence 必须真实反映把握程度，不要一律给高分。',
    '5. 题干缺字、选项缺失、图片无法辨识时：仍给出最佳猜测，但 confidence 不得高于 0.4，并在 reason 中注明"信息不全"。',
    '6. 无论题型多罕见，都必须给出一个可写进答题框的答案；不要输出"无法作答""需要更多信息"这类空答案。',
    '7. 宁可给出一个有依据的判断，也不要输出无法解析的内容。'
  ].join('\n');

  /** 兜底通道用的极简 prompt：模型已经失败过一轮，这里只要一个能落盘的答案 */
  const SYSTEM_RESCUE = [
    '你是考试答题兜底专家。前面几个模型都没能给出可用答案，现在只剩你这一次机会。',
    '要求：',
    '1. 只输出一个 JSON 对象：{"answer":"<答案>","confidence":<0到1>,"reason":"<不超过40字>"}',
    '2. answer 必须是可直接抄进答题框的内容；选择题写选项字母（多选连写），文本题写完整答案。',
    '3. 即使信息不全也要给出最可能的答案，禁止输出空字符串、"无法确定"、"需要更多信息"。'
  ].join('\n');

  const SYSTEM_CRITIQUE = [
    '你是一位考试答案复核专家。你会看到一道题和若干位答题者给出的答案，任务是指出错误、给出你独立判断的正确答案。',
    '',
    '输出契约：只输出一个 JSON 对象，结构为：',
    '{"answer":"<你最终认为正确的答案>","confidence":<0到1>,"agreeWith":"<你认为正确的候选编号，如 2；都不对填 none>","reason":"<不超过60字为何这样判>"}',
    '不要输出 JSON 以外的内容。'
  ].join('\n');

  const SYSTEM_ARBITER = [
    '你是最终裁决者。多位专家对同一道题给出了不同答案，请综合他们的推理独立判断，给出唯一最终答案。',
    '',
    '输出契约：只输出一个 JSON 对象：',
    '{"answer":"<最终答案>","confidence":<0到1>,"reason":"<不超过80字裁决依据>"}',
    '不要输出 JSON 以外的内容。'
  ].join('\n');

  /* ---------------- 底层请求 ---------------- */

  /** 通用请求：method='GET' 时不带 body */
  function httpMethod(method, url, headers, body, timeoutMs) {
    const hasBody = body != null;
    const payload = hasBody ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: method,
          url,
          headers,
          data: payload,
          timeout: timeoutMs || 90000,
          onload: (res) => {
            let parsed = null;
            try {
              parsed = JSON.parse(res.responseText);
            } catch (e) {}
            if (res.status >= 200 && res.status < 300) resolve(parsed || {});
            else {
              let msg =
                (parsed && parsed.error && (parsed.error.message || parsed.error.code)) ||
                (res.responseText || '').slice(0, 300) ||
                'HTTP ' + res.status;
              // 网关明确回 permission_error 时，原文是英文长句，落到日志里没人看得懂 —— 换成中文动作。
              // 注意：只有"页面上下文直接 fetch"才会被网关按 Origin 拒；Tampermonkey 的
              // GM_xmlhttpRequest 走扩展后台、不带页面 Origin，正常环境不会出现这条（2026-11-19 更正）。
              if (/doesn't answer the web page|permission_error/i.test(String(msg))) {
                const origin = (function () {
                  try {
                    return location.origin;
                  } catch (e) {
                    return '当前站点';
                  }
                })();
                msg =
                  '网关拒绝了这个页面 → 在网关设置（magpie：Settings → Network and sharing → Web pages）里加上 ' +
                  origin +
                  '，或改用允许跨域的服务商';
              }
              reject(new Error('HTTP ' + res.status + ' · ' + msg));
            }
          },
          onerror: () =>
            reject(
              new Error(
                '请求没发出去（baseURL / 网络 / 代理不可达，或被浏览器拦下）· 若在页面上下文直接 fetch 本地网关，' +
                  '请求会带 Origin 而被网关拒绝；油猴 GM_xmlhttpRequest 走扩展后台不受此限 · 当前页面 ' +
                  (function () {
                    try {
                      return location.origin;
                    } catch (e) {
                      return '当前站点';
                    }
                  })() +
                  ' 加进网关白名单'
              )
            ),
          ontimeout: () => reject(new Error('请求超时'))
        });
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 90000);
      const init = { method: method, headers: headers, signal: ctrl.signal };
      if (hasBody) init.body = payload;
      fetch(url, init)
        .then(async (r) => {
          const text = await r.text();
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch (e) {}
          clearTimeout(timer);
          if (r.ok) resolve(parsed || {});
          else reject(new Error('HTTP ' + r.status + ' · ' + (text || '').slice(0, 300)));
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  function httpJson(url, headers, body, timeoutMs) {
    return httpMethod('POST', url, headers, body, timeoutMs);
  }

  /* ---------- 三种接口风格的报文构造 ---------- */

  function flatten(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c && typeof c === 'object' ? (c.type === 'text' ? c.text : c.type === 'image_url' ? '[图片]' : '') : String(c || '')))
        .join('\n');
    }
    return String(content);
  }

  function splitDataUrl(url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(url || ''));
    if (!m) return null;
    return { mime: m[1] || 'image/png', base64: m[3] || '', isBase64: !!m[2] };
  }

  /** 统一的 parts（OpenAI 风格）→ 各家格式 */
  function contentParts(messages) {
    const sys = messages.filter((m) => m.role === 'system').map((m) => flatten(m.content)).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    return { system: sys, turns: rest };
  }

  function toAnthropic(content) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    return (content || []).map((c) => {
      if (!c || typeof c !== 'object') return { type: 'text', text: String(c || '') };
      if (c.type === 'text') return { type: 'text', text: String(c.text || '') };
      if (c.type === 'image_url') {
        const u = (c.image_url && c.image_url.url) || '';
        const d = splitDataUrl(u);
        if (d) return { type: 'image', source: { type: 'base64', media_type: d.mime, data: d.base64 } };
        return { type: 'image', source: { type: 'url', url: u } };
      }
      return { type: 'text', text: '' };
    });
  }

  function toGeminiParts(content) {
    if (typeof content === 'string') return [{ text: content }];
    return (content || []).map((c) => {
      if (!c || typeof c !== 'object') return { text: String(c || '') };
      if (c.type === 'text') return { text: String(c.text || '') };
      if (c.type === 'image_url') {
        const u = (c.image_url && c.image_url.url) || '';
        const d = splitDataUrl(u);
        if (d) return { inline_data: { mime_type: d.mime, data: d.base64 } };
        return { file_data: { file_uri: u } };
      }
      return { text: '' };
    });
  }

  /**
   * 按 provider.apiStyle 生成 {url, headers, body}。
   * 支持：openai（绝大多数中转/本地服务）、anthropic（Messages）、gemini（generateContent）。
   * magpie 网关三种都吃，换风格只改这一个下拉框。
   */
  function buildRequest(provider, messages, opts) {
    opts = opts || {};
    const style = provider.apiStyle === 'anthropic' ? 'anthropic' : provider.apiStyle === 'gemini' ? 'gemini' : 'openai';
    const base = String(provider.baseURL || '').replace(/\/+$/, '');
    const key = String(provider.apiKey || '');
    const temp = opts.temperature != null ? opts.temperature : provider.temperature != null ? provider.temperature : 0.2;
    const maxTokens = Number(opts.maxTokens || provider.maxTokens || 700) || 700;
    const headers = { 'Content-Type': 'application/json' };
    let url = base;
    let body = {};

    if (style === 'anthropic') {
      url = /\/messages$/.test(base) ? base : /\/v\d+$/.test(base) ? base + '/messages' : base + '/v1/messages';
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
      const p = contentParts(messages);
      body = { model: provider.model, max_tokens: maxTokens, temperature: temp, messages: [] };
      if (p.system) body.system = p.system;
      p.turns.forEach((m) => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const content = toAnthropic(m.content);
        const last = body.messages[body.messages.length - 1];
        if (last && last.role === role) last.content = last.content.concat(content);
        else body.messages.push({ role: role, content: content });
      });
      if (!body.messages.length) body.messages.push({ role: 'user', content: [{ type: 'text', text: '' }] });
    } else if (style === 'gemini') {
      const gmodel = String(provider.model || '');
      url = /:generateContent/.test(base)
        ? base
        : base + '/v1beta/models/' + encodeURIComponent(gmodel) + ':generateContent';
      if (key) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
      const p = contentParts(messages);
      body = {
        contents: p.turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toGeminiParts(m.content) })),
        generationConfig: { temperature: temp, maxOutputTokens: maxTokens }
      };
      if (p.system) body.systemInstruction = { parts: [{ text: p.system }] };
      if (!body.contents.length) body.contents.push({ role: 'user', parts: [{ text: '' }] });
    } else {
      url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
      if (key) headers.Authorization = 'Bearer ' + key;
      body = { model: provider.model, messages: messages, temperature: temp, stream: false };
      body[provider.maxTokensField || 'max_tokens'] = maxTokens;
      if (provider.jsonMode) body.response_format = { type: 'json_object' };
    }

    if (provider.extraHeaders && typeof provider.extraHeaders === 'object') Object.assign(headers, provider.extraHeaders);
    if (provider.extraBody && typeof provider.extraBody === 'object') {
      // 用户可以覆盖任何字段（top_p / reasoning_effort / enable_thinking …）
      Object.keys(provider.extraBody).forEach((k) => {
        const v = provider.extraBody[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && body[k] && typeof body[k] === 'object' && !Array.isArray(body[k])) {
          body[k] = CXAI.U.mergeDeep(body[k], v);
        } else {
          body[k] = v;
        }
      });
    }
    return { url: url, headers: headers, body: body, style: style };
  }

  function extractText(res, style) {
    if (!res) return null;
    if (style === 'anthropic') {
      if (typeof res.content === 'string') return res.content;
      if (Array.isArray(res.content)) {
        const t = res.content
          .filter((c) => c && (c.type === 'text' || c.text))
          .map((c) => String(c.text || ''))
          .join('\n')
          .trim();
        return t || null;
      }
      return null;
    }
    if (style === 'gemini') {
      const cand = res.candidates && res.candidates[0];
      const parts = (cand && cand.content && cand.content.parts) || [];
      const t = parts
        .map((p) => String((p && p.text) || ''))
        .join('')
        .trim();
      return t || null;
    }
    const choice = res.choices && res.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (content == null) return null;
    return typeof content === 'string' ? content : flatten(content);
  }

  /**
   * 拉取该 provider 的可用模型列表（各家 /models 端点）。
   * 返回 [{id, label}]，按 id 排序去重。失败直接抛错，由调用方提示。
   */
  async function listModels(provider) {
    provider = CXAI.normalizeProvider(provider, 0);
    const style = provider.apiStyle === 'anthropic' ? 'anthropic' : provider.apiStyle === 'gemini' ? 'gemini' : 'openai';
    const base = String(provider.baseURL || '').replace(/\/+$/, '');
    const key = String(provider.apiKey || '');
    const headers = { 'Content-Type': 'application/json' };
    let url = base;

    if (style === 'anthropic') {
      url = /\/models$/.test(base) ? base : /\/v\d+$/.test(base) ? base + '/models' : base + '/v1/models';
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
    } else if (style === 'gemini') {
      url = /\/models$/.test(base) ? base : base + '/v1beta/models';
      if (key) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
    } else {
      url = /\/models$/.test(base) ? base : base.replace(/\/chat\/completions$/, '') + '/models';
      if (key) headers.Authorization = 'Bearer ' + key;
    }
    if (provider.extraHeaders && typeof provider.extraHeaders === 'object') Object.assign(headers, provider.extraHeaders);

    const res = await httpMethod('GET', url, headers, null, Number(provider.timeoutMs) > 0 ? Number(provider.timeoutMs) : 15000);
    const raw = (res && (res.data || res.models || res.result)) || [];
    const arr = Array.isArray(raw) ? raw : [];
    const seen = {};
    const out = [];
    arr.forEach((m) => {
      if (!m) return;
      let id = m.id || m.name || m.model || m.model_name;
      if (!id) return;
      id = String(id).replace(/^models\//, '');
      if (style === 'gemini') {
        const methods = m.supportedGenerationMethods || m.supported_generation_methods;
        if (Array.isArray(methods) && !methods.some((x) => /generateContent/i.test(String(x)))) return;
      }
      if (seen[id]) return;
      seen[id] = 1;
      const dn = m.display_name || m.displayName || '';
      out.push({ id: id, label: dn && dn !== id ? dn + ' · ' + id : id });
    });
    out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return out;
  }

  /** 发一次对话请求，返回 {text, usage, model, style} */
  async function callProvider(provider, messages, opts) {
    opts = opts || {};
    provider = CXAI.normalizeProvider(provider, 0);
    const cfg = CXAI.Cfg.get('ai.judge', {});
    const req = buildRequest(provider, messages, opts);
    const timeoutMs = Number(provider.timeoutMs) > 0 ? Number(provider.timeoutMs) : cfg.timeoutMs || 90000;
    const retries = Math.max(0, cfg.retries != null ? cfg.retries : 1);
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await httpJson(req.url, req.headers, req.body, timeoutMs);
        if (res && res.error && !res.choices && !res.content && !res.candidates) {
          throw new Error((res.error && (res.error.message || res.error.code)) || '端点返回错误');
        }
        const text = extractText(res, req.style);
        if (text == null) {
          if (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.reasoning_content) {
            throw new Error('模型只返回了 reasoning_content，没有正文（试试关掉推理模式或换模型）');
          }
          throw new Error('响应缺少正文（style=' + req.style + '）');
        }
        return { text: String(text), usage: res.usage || null, model: res.model || provider.model, style: req.style };
      } catch (e) {
        lastErr = e;
        // JSON 模式不被支持时自动降级
        if (req.body.response_format && /response_format|json_object|400/i.test(e.message)) {
          delete req.body.response_format;
          continue;
        }
        if (attempt < retries) await CXAI.U.sleep(600 * (attempt + 1));
      }
    }
    throw lastErr || new Error('调用失败');
  }

  /* ---------------- Prompt 构建 ---------------- */

  function optionBlock(q) {
    if (!q.options || q.options.length === 0) return '';
    return q.options.map((o) => `${o.key}. ${o.text}`).join('\n');
  }

  function buildSolveMessages(q, hint, vctx, provider) {
    const lines = [`【题型】${q.typeLabel}`, `【题干】${q.stem || '(题干为空)'}`];
    if (q.attachMeta) {
      const m = q.attachMeta;
      const note =
        m.mode === 'pages'
          ? '，已逐页转成图片附在下方，请先完整读完附件再作答'
          : m.mode === 'link'
          ? '，附件没能转成图片/文字，只能按文件名与题干线索尽力作答'
          : '，附件通道已关闭，只能按文件名与题干线索尽力作答';
      lines.push(`【附件材料】${m.filename || '附件'}${m.pages ? '（共 ' + m.pages + ' 页）' : ''}${note}。`);
      lines.push(
        '【作答要求】本题的作答框就是整份材料的答题区：请通读附件，把材料里出现的每一道题按顺序作答，' +
          '格式为「1. …」换行「2. …」，不要只回答其中一题，也不要复述题目；' +
          (m.mode === 'pages' ? '' : '缺少材料正文时 confidence 不得高于 0.35。')
      );
    }
    const nImg = q.images ? q.images.length : 0;
    const mode = vctx && vctx.mode;
    if (nImg) {
      if (mode === 'inline' && provider && provider.vision) lines.push(`【图片】本题含 ${nImg} 张图片，已作为图片消息附在下方，请直接读图。`);
      else if (mode === 'ocr') lines.push(`【图片】本题原图已由读图模型转写为文字（见下方【图片转写】），请据此作答。`);
      else lines.push(`【图片】本题含 ${nImg} 张图片，但当前没有可用读图通道，请按已抓到的文字尽力作答，必要时降低置信度。`);
    }
    if (vctx && vctx.vision) {
      const block = CXAI.Vision.composePromptBlock(vctx.vision);
      if (block) lines.push(block);
    }
    if (q.shell === 'group') {
      const blanks = q.group || [];
      if (blanks.length) {
        // 完型/阅读理解是"一组小题各带自己的选项"：不把每空的选项列出来，
        // 模型看到的只有一段正文，只能回"信息不足"（2026-11-18 实测 Q8/Q9 全空）。
        lines.push(
          '【小题组各小题的选项】\n' +
            blanks
              .map(function (b, i) {
                return (
                  '第' +
                  (i + 1) +
                  '小题' +
                  (b.stem ? '（' + b.stem + '）' : '') +
                  '：' +
                  (b.options || []).map(function (o) { return o.key + '. ' + o.text; }).join('   ')
                );
              })
              .join('\n')
        );
        lines.push(
          '【作答格式】共 ' + blanks.length + ' 小题，必须输出 **恰好 ' + blanks.length + ' 段**字母，按顺序用 "|||" 分隔' +
            '（例如 ' + blanks.map(function (_, i) { return String.fromCharCode(65 + (i % 4)); }).join('|||') + '）；' +
            '少一段就视为无效答案。写 "1:A 2:C" 这种带题号的写法也接受。不要复述题目，不要漏答任何一小题。'
        );
      } else {
        lines.push(
          '【小题组】本题是一组小题（阅读理解 / 完形填空 / 材料题）。请按小题顺序逐条作答，' +
            '不要只答第一问，也不要复述题目；多条答案之间用 "|||" 分隔。'
        );
      }
    }
    if (q.shell === 'media') {
      lines.push(
        '【音视频】本题配有音视频材料（页面只给了播放器，没有文字稿）。请按题干与选项给出最可能的答案，' +
          'confidence 不高于 0.45，并在 reason 里注明"未听到音频"。'
      );
    }
    if (q.shell === 'manual') {
      lines.push('【答题框】本题页面没有可写入的答题框，答案会展示给考生手抄；仍要给出完整、可直接抄写的答案。');
    }
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    else lines.push('【说明】本题为填答题（可能有多空），没有选项，请直接给出要填写的答案；多空用 "|||" 分隔。');
    if (hint) lines.push(`【提示】${hint}`);
    lines.push('【输出】只输出 JSON 对象。');
    const userText = lines.join('\n\n');

    const attach = !!(provider && provider.vision && vctx && vctx.mode === 'inline' && vctx.imageParts && vctx.imageParts.length);
    if (attach) {
      return [
        { role: 'system', content: SYSTEM_SOLVE },
        {
          role: 'user',
          content: [{ type: 'text', text: userText }].concat(
            vctx.imageParts.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl } }))
          )
        }
      ];
    }
    return [
      { role: 'system', content: SYSTEM_SOLVE },
      { role: 'user', content: userText }
    ];
  }

  function visionTail(q, vctx) {
    const lines = [];
    if (vctx && vctx.vision) {
      const block = CXAI.Vision.composePromptBlock(vctx.vision);
      if (block) lines.push(block);
    }
    return lines;
  }

  /**
   * 复核/仲裁也要看到"小题组"的选项与音视频/无答题框的说明，
   * 否则它们只能对着候选字母空想，一有分歧就把正确结论改掉。
   */
  function shellHintLines(q) {
    const out = [];
    if (!q) return out;
    if (q.shell === 'group') {
      const blanks = q.group || [];
      if (blanks.length) {
        out.push(
          '【小题组各小题的选项】\n' +
            blanks
              .map(
                (b, i) =>
                  '第' +
                  (i + 1) +
                  '小题' +
                  (b.stem ? '（' + b.stem + '）' : '') +
                  '：' +
                  (b.options || []).map((o) => o.key + '. ' + o.text).join('   ')
              )
              .join('\n')
        );
        out.push('【作答格式】共 ' + blanks.length + ' 小题，按顺序只输出字母，用 "|||" 分隔（例如 A|||C|||B）。');
      } else {
        out.push('【小题组】按小题顺序作答，多条答案用 "|||" 分隔。');
      }
    }
    if (q.shell === 'media') out.push('【音视频】没有文字稿，按题干与选项给最可能的答案。');
    if (q.shell === 'manual') out.push('【答题框】页面没有输入框，答案会展示给考生手抄，写完整。');
    return out;
  }

  function buildCritiqueMessages(q, drafts, vctx) {
    const lines = [`【题型】${q.typeLabel}`, `【题干】${q.stem || '(题干为空)'}`];
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    shellHintLines(q).forEach((l) => lines.push(l));
    visionTail(q, vctx).forEach((l) => lines.push(l));
    const cand = drafts
      .map((d, i) => `${i + 1}. ${d.answerText}（置信度 ${d.confidence.toFixed(2)}）理由：${d.reason || '无'}`)
      .join('\n');
    lines.push(`【候选答案】\n${cand}`);
    lines.push('【输出】只输出 JSON 对象。');
    return [
      { role: 'system', content: SYSTEM_CRITIQUE },
      { role: 'user', content: lines.join('\n\n') }
    ];
  }

  function buildArbiterMessages(q, drafts, critiques, vctx) {
    const lines = [`【题型】${q.typeLabel}`, `【题干】${q.stem || '(题干为空)'}`];
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    shellHintLines(q).forEach((l) => lines.push(l));
    visionTail(q, vctx).forEach((l) => lines.push(l));
    const cand = drafts
      .map((d, i) => `初答${i + 1}：${d.answerText}（置信度 ${d.confidence.toFixed(2)}）理由：${d.reason || '无'}`)
      .join('\n');
    lines.push(`【初答】\n${cand}`);
    if (critiques && critiques.length) {
      lines.push(
        `【复核意见】\n` +
          critiques
            .map((c, i) => `复核${i + 1}：${c.answerText}（置信度 ${c.confidence.toFixed(2)}，同意候选 ${c.agreeWith || 'none'}）理由：${c.reason || '无'}`)
            .join('\n')
      );
    }
    lines.push('【输出】只输出 JSON 对象。');
    return [
      { role: 'system', content: SYSTEM_ARBITER },
      { role: 'user', content: lines.join('\n\n') }
    ];
  }

  /* ---------------- 答案解析 ---------------- */

  /** 这些题型的答案是"一段文本"，不是选项字母 */
  const TEXT_TYPES = { completion: 1, line: 1, reader: 1, fill: 1, match: 1, oral: 1, listening: 1 };

  function isTextType(q) {
    if (!q) return false;
    if (TEXT_TYPES[q.type]) return true;
    return !(q.options && q.options.length);
  }

  /** 全角字母/数字/标点 → 半角（模型偶尔吐全角"Ｂ"） */
  function normWidth(t) {
    return String(t == null ? '' : t)
      .replace(/[\uFF01-\uFF5E]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      })
      .replace(/\u3000/g, ' ');
  }

  /** 去掉代码块围栏、外层引号、"答案："前缀 —— 模型不守契约时的第一道清洗 */
  function cleanAnswerText(raw) {
    let t = String(raw == null ? '' : raw).trim();
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    t = t.replace(/^(?:最终答案|正确答案|参考答案|答案|answer)\s*[:：]\s*/i, '').trim();
    t = t.replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim();
    return t;
  }

  function letterRuns(text, keys) {
    const up = normWidth(text).toUpperCase();
    const letters = (up.match(/[A-H]/g) || []).filter(function (l) {
      return keys.indexOf(l) >= 0;
    });
    return Array.from(new Set(letters)).sort();
  }

  /**
   * 把模型给的原始答案映射为选项 key 数组（选择题）或纯文本（填空题/主观题）。
   * 2026-11-18：收紧"从整段话里抠 A-H"的规则 —— 旧实现会把
   * "B 正确，因为 A 和 C 都错" 解析成 ABC；现在只认「整串字母」「答案标记后的字母」
   * 「短句里的孤立字母」，其余交给选项文本匹配 / 语义映射 / 相似度。
   */
  function resolveAnswerKeys(answer, q) {
    if (answer == null) return null;
    const raw = String(answer).trim();
    if (!raw) return null;
    if (isTextType(q)) return { keys: [], text: cleanAnswerText(raw) || raw };

    const keys = (q.options || []).map(function (o) {
      return o.key;
    });
    const up = normWidth(raw).toUpperCase();
    const trim = up.trim();

    // 1) 整串就是字母组合："B" / "A,C" / "ACD" / "B 和 D"
    if (/^[A-H](?:\s*[,，、/和]?\s*[A-H])*$/.test(trim)) {
      const uniq = letterRuns(trim, keys);
      if (uniq.length) return { keys: uniq, text: uniq.join('') };
    }

    // 2) 答案标记之后的字母（"答案是 B" / "正确选项：AC"）
    const m = /(?:答案|正确选项|应选|选择|选)\s*[：:是为]?\s*([A-H](?:\s*[,，、/和]?\s*[A-H]){0,7})/.exec(up);
    if (m) {
      const uniq = letterRuns(m[1], keys);
      if (uniq.length) return { keys: uniq, text: uniq.join('') };
    }

    // 3) 选项文本精确匹配
    const norm = CXAI.U.normText(raw);
    for (const o of q.options) {
      if (CXAI.U.normText(o.text) === norm) return { keys: [o.key], text: o.key };
    }

    // 4) 判断题语义映射
    if (q.type === 'judgement') {
      const truthy = /正确|对|是|√|true|yes/i.test(raw);
      const falsy = /错误|错|否|×|false|no/i.test(raw);
      if (truthy !== falsy) {
        const want = truthy;
        for (const o of q.options) {
          const t = CXAI.U.normText(o.text);
          const isTrue = /^(正确|对|是|√|true|yes|t)$/.test(t);
          const isFalse = /^(错误|错|否|×|false|no|f)$/.test(t);
          if ((want && isTrue) || (!want && isFalse)) return { keys: [o.key], text: o.key };
        }
      }
    }

    // 5) 短句里的孤立字母（"我认为是 B"）：必须很短、且只出现一个候选字母，
    //    否则 "B 正确，因为 A 和 C 都错" 会被误解析成 ABC
    if (trim.length <= 12) {
      const uniq = letterRuns(trim, keys);
      if (uniq.length === 1) return { keys: uniq, text: uniq.join('') };
    }

    // 6) 相似度兜底
    let best = null;
    let bestScore = 0;
    for (const o of q.options) {
      const s = CXAI.U.similarity(raw, o.text);
      if (s > bestScore) {
        bestScore = s;
        best = o.key;
      }
    }
    if (best && bestScore >= 0.34) return { keys: [best], text: best };

    return null;
  }

  /**
   * 解析模型返回的 JSON 为统一结构。
   * 2026-11-18 起"宽松解析"：JSON 缺字段 → 抓"答案：X"；文本题没给 JSON → 整段当答案。
   * 只有真正取不到任何可写内容时才返回 null，由 solve() 的兜底链接手。
   */
  function parseModelResult(text, q) {
    const ctx = String(text == null ? '' : text);
    const obj = CXAI.U.safeJson(ctx);
    let answer =
      obj && (obj.answer != null ? obj.answer : obj.Answer != null ? obj.Answer : obj.result != null ? obj.result : obj['答案']);
    let confidence = obj && Number(obj.confidence != null ? obj.confidence : obj['置信度']);
    let reason = obj && (obj.reason || obj.analysis || obj.explain || obj['依据'] || '');
    let agreeWith = obj && obj.agreeWith;

    if (answer == null || String(answer).trim() === '') {
      // "答案：B" / "答案是 B" / "答案 B" 都要吃（模型很少严格照契约输出）
      const m = /(?:最终答案|正确答案|参考答案|答案|answer)\s*[:：是为]?\s*([^\n]+)/i.exec(normWidth(ctx));
      if (m) answer = m[1].trim();
    }
    if (answer == null || String(answer).trim() === '') {
      const only = /^\s*([A-H](?:\s*[,，、/]?\s*[A-H]){0,7})\s*[。.]?\s*$/.exec(normWidth(ctx).trim());
      if (only) answer = only[1];
    }
    if ((answer == null || String(answer).trim() === '') && isTextType(q)) {
      const t = cleanAnswerText(ctx);
      if (t) answer = t;
    }
    if (answer == null) return null;

    const resolved = resolveAnswerKeys(answer, q);
    if (!resolved) return null;
    if (!(resolved.keys || []).length && !String(resolved.text == null ? '' : resolved.text).trim()) return null;

    if (!isFinite(confidence) || confidence <= 0 || confidence > 1) {
      if (isFinite(confidence) && confidence > 1 && confidence <= 100) confidence = confidence / 100;
      else confidence = obj ? 0.6 : 0.5;
    }
    return {
      keys: resolved.keys || [],
      answerText: resolved.text != null ? String(resolved.text) : '',
      confidence: CXAI.U.clamp(confidence, 0.01, 1),
      reason: String(reason || '').slice(0, 200),
      agreeWith: agreeWith != null ? String(agreeWith) : null,
      raw: ctx
    };
  }

  /* ---------------- 投票 ---------------- */

  /** 文本题投票用的归一化：全角转半角、去空白/标点，只比"说了什么" */
  function voteNorm(t) {
    return String(t == null ? '' : t)
      .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\s\u3000]/g, '')
      .replace(/[.,;:!?'"`~()[\]{}<>、。，；：！？“”‘’（）【】《》…—\-]/g, '')
      .toLowerCase();
  }

  /** 两段文本是否"语义上足够接近"（包含关系或二元组 Dice 相似） */
  function voteSimilar(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const s = a.length <= b.length ? a : b;
    const l = a.length <= b.length ? b : a;
    if (s.length >= 6 && l.indexOf(s) >= 0 && s.length / l.length >= 0.62) return true;
    const grams = (x) => {
      const out = new Set();
      if (x.length < 2) {
        out.add(x);
        return out;
      }
      for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2));
      return out;
    };
    const A = grams(s);
    const B = grams(l);
    let inter = 0;
    A.forEach((g) => {
      if (B.has(g)) inter++;
    });
    return (2 * inter) / (A.size + B.size) >= 0.72;
  }

  function tally(drafts) {
    // 文本题三个模型的表述必然不同，按原串精确分桶会让一致率恒低（每题都烧复核+仲裁，
    // 最后取出的"最高票"也没有语义意义）。这里先归一化，再按相似度合并。
    const list = [];
    let total = 0;
    for (const d of drafts) {
      const raw = d.answerText == null ? '' : String(d.answerText);
      const k = voteNorm(raw);
      const w = (d.weight || 1) * (d.confidence || 0.5);
      total += w;
      let hit = list.filter((b) => b.norm === k || voteSimilar(b.norm, k))[0];
      if (!hit) {
        hit = { key: raw || '∅', norm: k, score: 0, count: 0, supporters: [] };
        list.push(hit);
      }
      hit.score += w;
      hit.count += 1;
      hit.supporters.push(d.providerLabel || d.providerId || '模型');
    }
    list.sort((a, b) => b.score - a.score || b.count - a.count);
    const top = list[0];
    return {
      list: list.map((b) => ({ key: b.key, score: b.score, count: b.count, supporters: b.supporters })),
      winner: top ? { key: top.key, score: top.score, count: top.count, supporters: top.supporters } : null,
      ratio: total > 0 && top ? top.score / total : 0
    };
  }

  /* ---------------- 判定主流程 ---------------- */

  function buildPanel() {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    const all = CXAI.Cfg.activeProviders();
    if (all.length === 0) throw new Error('没有启用的模型：请到设置里填写 API Key');

    if (judgeCfg.mode === 'fast') {
      const base = all[0];
      const n = Math.max(2, Math.min(5, judgeCfg.panelSize || 3));
      return Array.from({ length: n }, (_, i) => ({
        ...base,
        providerLabel: base.label + '#' + (i + 1),
        temperature: Math.min(1, 0.15 + i * 0.35),
        __sample: i
      }));
    }
    if (judgeCfg.mode === 'single') return [all[0]];

    const size = Math.max(1, Math.min(all.length, judgeCfg.panelSize || 3));
    let list = all.slice(0, size);
    // 勾了「读图模型也参与判题」却因为 panelSize 太小被挤出去时，把最末一票让给它
    if (CXAI.Cfg.get('ai.vision.judgeToo')) {
      const boths = all.filter((p) => p.role === 'both');
      if (boths.length && !list.some((p) => p.role === 'both')) {
        list = list.slice(0, Math.max(0, size - 1)).concat(boths[0]);
      }
    }
    return list.map((p) => ({ ...p, providerLabel: p.label }));
  }

  async function runPool(tasks, concurrency) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        try {
          results[i] = await tasks[i]();
        } catch (e) {
          results[i] = { __error: e };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /* ---------------- 读图通道选择 ---------------- */

  /**
   * 决定这道题的图片怎么处理。
   * @returns {Promise<{mode:'inline'|'ocr'|'none'|'off', imageParts:any[], vision:any|null, dropped:number}>}
   */
  async function resolveVision(question, panel) {
    const vc = CXAI.Vision.cfg();
    const none = { mode: 'none', imageParts: [], vision: null, dropped: 0 };
    if (!vc.enabled || vc.strategy === 'off') return Object.assign({}, none, { mode: 'off' });
    if (!question.images || !question.images.length) return none;

    const prep = await CXAI.Vision.prepare(question);
    if (!prep.items.length) {
      CXAI.Log.warn(`第 ${(question.index || 0) + 1} 题含 ${question.images.length} 张图片，但一张也没读成功，按纯文本判题`);
      return Object.assign({}, none, { dropped: prep.dropped });
    }

    const panelVision = CXAI.Vision.panelHasVision(panel);
    const doOcr = async () => {
      const vp = CXAI.Vision.pickProvider() || (panel.filter((p) => p && p.vision)[0] || null);
      if (!vp) return null;
      try {
        const vis = await CXAI.Vision.transcribe(question, vp, prep.items);
        CXAI.Log.info(
          `第 ${(question.index || 0) + 1} 题读图完成（${vp.label}·${prep.items.length}图）：` +
            CXAI.U.truncate(vis.text || vis.questionText || '(空)', 50)
        );
        return vis;
      } catch (e) {
        CXAI.Log.warn(`第 ${(question.index || 0) + 1} 题读图失败：${e.message}`);
        return null;
      }
    };

    if (vc.strategy === 'inline') return { mode: 'inline', imageParts: prep.items, vision: null, dropped: prep.dropped };
    if (vc.strategy === 'ocr') {
      const vis = await doOcr();
      return { mode: vis ? 'ocr' : 'none', imageParts: [], vision: vis, dropped: prep.dropped };
    }
    // auto：面板里**所有**模型都能看图才直传；混着纯文本模型时先转写。
    // 旧判据是"有任意一个视觉模型就 inline"，结果是纯文本模型收不到图片、
    // 却仍然参与投票 —— 它的答案纯属瞎猜，还会拉低正确结论。
    const allVision = (panel || []).length > 0 && (panel || []).every((p) => p && p.vision);
    if (allVision) return { mode: 'inline', imageParts: prep.items, vision: null, dropped: prep.dropped };
    const vis = await doOcr();
    if (vis) return { mode: 'ocr', imageParts: [], vision: vis, dropped: prep.dropped };
    // 转写失败但面板里仍有能看图的模型：至少让它们看图
    if (panelVision) return { mode: 'inline', imageParts: prep.items, vision: null, dropped: prep.dropped };
    CXAI.Log.warn(`第 ${(question.index || 0) + 1} 题含图片但无可用读图模型，按纯文本判题`);
    return Object.assign({}, none, { dropped: prep.dropped });
  }

  async function runSolveRound(panel, q, vctx) {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    // 长答案题型（附件整卷 / 简答 / 论述 / 计算）默认 700 token 会被截断成半句话，
    // 截断后没法写进答题框，所以这里单独抬高上限。
    const longForm = !!(
      q &&
      (q.attachMeta || isTextType(q) || q.shell === 'group' || q.shell === 'manual' || q.type === 'sort')
    );
    const tasks = panel.map((p) => async () => {
      const messages = buildSolveMessages(q, undefined, vctx, p);
      const t0 = Date.now();
      const res = await callProvider(p, messages, {
        temperature: p.temperature,
        maxTokens: longForm ? Math.max(Number(p.maxTokens || 0), 4000) : undefined
      });
      const parsed = parseModelResult(res.text, q);
      if (!parsed) throw new Error('答案无法解析：' + CXAI.U.truncate(res.text, 120));
      return {
        ...parsed,
        providerId: p.id,
        providerLabel: p.providerLabel || p.label,
        weight: p.weight || 1,
        ms: Date.now() - t0
      };
    });
    const raw = await runPool(tasks, judgeCfg.concurrency || 3);
    const ok = [];
    const errors = [];
    raw.forEach((r, i) => {
      if (!r) return;
      if (r.__error) errors.push(`${panel[i].providerLabel || panel[i].label}: ${r.__error.message}`);
      else ok.push(r);
    });
    return { drafts: ok, errors };
  }

  async function runCritiqueRound(panel, q, drafts, vctx) {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    const tasks = panel.map((p) => async () => {
      const messages = buildCritiqueMessages(q, drafts, vctx);
      const res = await callProvider(p, messages, { temperature: 0.1 });
      const parsed = parseModelResult(res.text, q);
      if (!parsed) throw new Error('复核结果无法解析');
      return {
        ...parsed,
        providerId: p.id,
        providerLabel: (p.providerLabel || p.label) + '·复核',
        weight: (p.weight || 1) * 1.2,
        ms: 0
      };
    });
    const raw = await runPool(tasks, judgeCfg.concurrency || 3);
    return raw.filter((r) => r && !r.__error);
  }

  async function runArbiter(provider, q, drafts, critiques, vctx) {
    const messages = buildArbiterMessages(q, drafts, critiques, vctx);
    const res = await callProvider(provider, messages, { temperature: 0 });
    const parsed = parseModelResult(res.text, q);
    if (!parsed) return null;
    return {
      ...parsed,
      providerId: provider.id,
      providerLabel: (provider.providerLabel || provider.label) + '·仲裁',
      weight: (provider.weight || 1) * 1.5
    };
  }

  /**
   * 对一道题做多重判定。
   * @returns {Promise<{keys:string[],answerText:string,confidence:number,reason:string,stage:string,votes:any[],errors:string[],lowConfidence:boolean}>}
   */
  async function councilSolve(question) {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    const panel = buildPanel();
    if (panel.length === 0) throw new Error('模型面板为空');

    // ---- Round 0 之前：附件题干（题目在 PDF/Office 附件里）→ 渲染成题图 ----
    // 附件题的 stem 是空的，不先把附件变成 question.images，模型就是闭卷瞎答。
    try {
      if (CXAI.Attach && question && !question.attachMeta) await CXAI.Attach.enrich(question);
    } catch (e) {
      CXAI.Log.warn('附件题干准备失败：' + e.message);
    }

    // ---- Round 0：读图通道（图片 → data URL 或 文字转写） ----
    let vctx = { mode: 'none', imageParts: [], vision: null, dropped: 0 };
    try {
      vctx = await resolveVision(question, panel);
    } catch (e) {
      CXAI.Log.warn('读图准备失败：' + e.message);
    }

    // ---- 附件题硬约束 ----
    // 附件题的题干是一张张 PDF 页图，模型看不到图就只能回"题目正文缺失，需补充具体小题"。
    // 那种回答对答题框毫无价值，还会被当成答案写进去，所以这里直接抛可执行的提示。
    if (question && question.attachMeta && question.attachMeta.mode === 'pages') {
      const hasInline = !!(vctx.imageParts && vctx.imageParts.length);
      const hasOcr = !!(
        vctx.vision && String((vctx.vision.text || '') + (vctx.vision.questionText || '')).trim()
      );
      if (!hasInline && !hasOcr) {
        const vc = CXAI.Vision.cfg();
        let why;
        if (!vc.enabled || vc.strategy === 'off') why = '读图通道被关闭（ai.vision.enabled=false 或 strategy=off）';
        else if (vctx.dropped) why = 'PDF 页图一张也没加载成功（共 ' + vctx.dropped + ' 张）';
        else why = '当前面板里没有能看图的模型';
        throw new Error(
          '附件题必须读 PDF 页图，但' +
            why +
            '。去 设置 → 读图，把「读图模型」指向一个支持视觉的模型（通义千问 VL / Gemini / 任意勾了“支持视觉”的自定义模型），保存后重跑这道题。'
        );
      }
    }

    // ---- Round 1：并行独立作答 ----
    const round1 = await runSolveRound(panel, question, vctx);
    if (round1.drafts.length === 0) {
      throw new Error('全部模型调用失败：' + round1.errors.join(' | '));
    }
    let errors = round1.errors.slice();
    let votes = round1.drafts.slice();
    let t = tally(votes);

    const visionMeta = {
      mode: vctx.mode,
      images: (question.images || []).length,
      sent: vctx.imageParts ? vctx.imageParts.length : 0,
      dropped: vctx.dropped || 0,
      ocrChars: vctx.vision ? String((vctx.vision.text || '') + (vctx.vision.questionText || '')).length : 0,
      ocrBy: vctx.vision ? vctx.vision.providerLabel : ''
    };

    const accept = (stage) => {
      // resolveAnswerKeys 对选择题可能返回 null（胜出答案映射不到任何选项）：
      // 直接 .keys 会抛 TypeError，整题掉进 rescue 链且报错信息难以排查（2026-11-24 审查 #1）
      const mapped = resolveAnswerKeys(t.winner.key, question);
      const keys = mapped && mapped.keys ? mapped.keys : [];
      return {
        keys,
        answerText: t.winner.key,
        confidence: bestConfidence(votes, t.winner.key),
        reason: bestReason(votes, t.winner.key),
        stage,
        ratio: +t.ratio.toFixed(3),
        votes: votes.map(voteSummary),
        errors,
        vision: visionMeta,
        lowConfidence: bestConfidence(votes, t.winner.key) < (judgeCfg.minConfidence || 0.55) || t.ratio < 0.5
      };
    };

    // 单模型 / 一致度达标 -> 直接采纳
    if (panel.length === 1 || judgeCfg.mode === 'single' || t.ratio >= (judgeCfg.voteThreshold || 0.7)) {
      return accept('panel');
    }

    // ---- Round 2：交叉复核 ----
    if (judgeCfg.enableCritique !== false) {
      CXAI.Log.info(`第 ${question.index + 1} 题分歧（一致率 ${(t.ratio * 100).toFixed(0)}%），发起交叉复核`);
      const critiques = await runCritiqueRound(panel, question, round1.drafts, vctx);
      if (critiques.length) {
        votes = votes.concat(critiques);
        t = tally(votes);
        if (t.ratio >= (judgeCfg.voteThreshold || 0.7)) return accept('critique');
      }

      // ---- Round 3：仲裁 ----
      if (judgeCfg.enableArbiter !== false) {
        const arbiterProvider = panel[0];
        try {
          const arb = await runArbiter(arbiterProvider, question, round1.drafts, critiques, vctx);
          if (arb) {
            votes = votes.concat([arb]);
            t = tally(votes);
            return accept('arbiter');
          }
        } catch (e) {
          errors.push('仲裁失败: ' + e.message);
        }
      }
    }

    // 兜底：取加权最高
    return accept('fallback');
  }

  /* ---------------- 全题型兜底通道 ----------------
   * 背景（2026-11-18）：期中考碰到 PDF 附件题之后，实际考卷里还会混进连线、
   * 排序、阅读理解小题组、听力、编程、甚至"页面只有一个播放器"的题型。
   * 主判定（议会 + 复核 + 仲裁）只在"模型都能回 JSON"时有效；任何一环坏了，
   * 旧实现就是整题失败、面板一片红。这里补一条兜底链：
   *   ① 议会失败 → ② 逐个模型用极简 prompt 重问（stage=rescue）
   *   ③ 仍失败 → ④ 本地确定性兜底（题干自带答案 / 首选项），stage=heuristic
   * 保证"只要还有一分可用信息，就一定给得出一个可展示、可写盘的答案"。
   */

  function fallbackCfg() {
    const c = CXAI.Cfg.get('ai.fallback', {}) || {};
    return {
      enabled: c.enabled !== false,
      heuristic: c.heuristic !== false,
      tries: Math.max(1, Math.min(4, Number(c.tries) || 3))
    };
  }

  /** 兜底用的候选模型：判定面板 + 全部可用端点（去重），图片题优先视觉模型 */
  function rescuePanel(q) {
    let list = [];
    try {
      list = buildPanel();
    } catch (e) {
      list = [];
    }
    const all = CXAI.Cfg.allProviders();
    const seen = {};
    const out = [];
    list.concat(all).forEach(function (p) {
      if (!p || !p.baseURL || !p.model) return;
      const id = (p.id || '') + '|' + p.baseURL + '|' + p.model;
      if (seen[id]) return;
      seen[id] = 1;
      out.push(p);
    });
    if (q && q.images && q.images.length) {
      out.sort(function (a, b) {
        return (b.vision ? 1 : 0) - (a.vision ? 1 : 0);
      });
    }
    return out;
  }

  function buildRescueMessages(q, vctx, provider) {
    const lines = [`【题型】${q.typeLabel || '未知'}${q.shellLabel ? '（' + q.shellLabel + '）' : ''}`, `【题干】${q.stem || '(题干为空)'}`];
    if (q.shell === 'group') lines.push('【小题组】请按小题顺序作答，多条答案用 "|||" 分隔。');
    if (q.shell === 'media') lines.push('【音视频】没有文字稿，按题干给最可能的答案。');
    if (q.shell === 'manual') lines.push('【答题框】页面没有输入框，答案给考生手抄，写完整。');
    if (q.attachMeta) lines.push(`【附件材料】${q.attachMeta.filename || '附件'}：按材料里的题目顺序作答。`);
    const nImg = (q.images || []).length;
    if (nImg) {
      if (vctx && vctx.mode === 'inline' && provider && provider.vision) lines.push(`【图片】本题含 ${nImg} 张图片，已附在下方。`);
      else if (vctx && vctx.mode === 'ocr') lines.push('【图片】原图已转写为文字，见下方【图片转写】。');
    }
    if (vctx && vctx.vision) {
      const block = CXAI.Vision.composePromptBlock(vctx.vision);
      if (block) lines.push(block);
    }
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    else lines.push('【说明】没有选项，直接给要写入的答案。');
    lines.push('【输出】只输出 JSON 对象。');
    const userText = lines.join('\n\n');
    const attach = !!(provider && provider.vision && vctx && vctx.mode === 'inline' && vctx.imageParts && vctx.imageParts.length);
    if (attach) {
      return [
        { role: 'system', content: SYSTEM_RESCUE },
        {
          role: 'user',
          content: [{ type: 'text', text: userText }].concat(
            vctx.imageParts.map(function (i) {
              return { type: 'image_url', image_url: { url: i.dataUrl } };
            })
          )
        }
      ];
    }
    return [
      { role: 'system', content: SYSTEM_RESCUE },
      { role: 'user', content: userText }
    ];
  }

  /** 本地确定性兜底：题干自带答案 → 首选项；文本题没有可确定内容时返回 null */
  function heuristicAnswer(q, errors) {
    let keys = [];
    try {
      keys = (CXAI.Scraper && CXAI.Scraper.stemAnswerKeys ? CXAI.Scraper.stemAnswerKeys(q.stem, q.options) : []) || [];
    } catch (e) {
      keys = [];
    }
    if (keys.length) {
      return {
        keys: keys.slice(),
        answerText: keys.join(''),
        confidence: 0.55,
        reason: '模型全部失败，采用题干里写明的答案',
        stage: 'heuristic',
        ratio: null,
        votes: [],
        errors: errors || [],
        lowConfidence: true
      };
    }
    if (q.options && q.options.length) {
      const first = q.options[0].key;
      return {
        keys: [first],
        answerText: first,
        confidence: 0.15,
        reason: '模型全部失败，按首个选项兜底（务必人工复核）',
        stage: 'heuristic',
        ratio: null,
        votes: [],
        errors: errors || [],
        lowConfidence: true
      };
    }
    return null;
  }

  async function rescueSolve(question, firstErr) {
    const fb = fallbackCfg();
    const errors = ['主判定失败：' + (firstErr && firstErr.message ? firstErr.message : firstErr)];
    let vctx = { mode: 'none', imageParts: [], vision: null, dropped: 0 };
    const panel = rescuePanel(question);
    try {
      vctx = await resolveVision(question, panel);
    } catch (e) {
      errors.push('读图准备失败：' + e.message);
    }
    const queue = panel.slice(0, fb.tries);
    for (const p of queue) {
      try {
        const messages = buildRescueMessages(question, vctx, p);
        const res = await callProvider(p, messages, { temperature: 0.1, maxTokens: 4000 });
        const parsed = parseModelResult(res.text, question);
        if (parsed && ((parsed.keys || []).length || String(parsed.answerText || '').trim())) {
          CXAI.Log.warn(
            '兜底通道拿到答案（' + (p.providerLabel || p.label) + ' · ' + (p.model || '') + '）：' + CXAI.U.truncate(parsed.answerText, 40)
          );
          return Object.assign({}, parsed, {
            stage: 'rescue',
            ratio: null,
            votes: [{ who: p.providerLabel || p.label, answer: parsed.answerText, confidence: parsed.confidence, reason: parsed.reason }],
            errors: errors,
            lowConfidence: true
          });
        }
        errors.push((p.label || '模型') + '：兜底输出不可解析');
      } catch (e) {
        errors.push((p.label || '模型') + '：' + (e && e.message ? e.message : e));
      }
    }
    if (fb.heuristic) {
      const h = heuristicAnswer(question, errors);
      if (h) {
        CXAI.Log.warn('本地兜底给出答案：' + h.answerText + '（' + h.reason + '）');
        return h;
      }
    }
    throw new Error('全部模型与本地兜底都没拿到答案：' + errors.slice(-2).join(' | '));
  }

  /**
   * 对外入口：先走完整判定，失败自动降级到兜底链。
   * 唯一不兜底的情况是"附件题缺视觉输入"——那种答案对答题框没有价值，
   * 继续兜底只会把瞎猜写进卷子，必须让用户先把读图模型配好。
   */
  async function solve(question) {
    let primaryErr = null;
    try {
      const r = await councilSolve(question);
      if (r && ((r.keys || []).length || String(r.answerText || '').trim())) {
        const txt = String(r.answerText || '');
        // 题干没采到时（共用选项题实测），模型会回「题目信息缺失，无法确定填空内容」。
        // 以前这句会原样写进卷子 —— 宁可这题标失败/需人工，也不要把废话落盘。
        if (/无法确定|题目信息缺失|信息不足|无法作答|需要更多信息|缺少题目|信息缺失/.test(txt)) {
          primaryErr = new Error('判定结果不可用（模型回了“' + txt.slice(0, 40) + '”）');
        } else return r;
      } else primaryErr = new Error('主判定返回空答案');
    } catch (e) {
      primaryErr = e;
    }
    if (primaryErr && /附件题必须读 PDF 页图/.test(primaryErr.message)) throw primaryErr;
    if (!fallbackCfg().enabled) throw primaryErr;
    const no = Number(question && question.index);
    CXAI.Log.warn(
      '第 ' + (isFinite(no) ? no + 1 : '?') + ' 题主判定失败，走全题型兜底：' + (primaryErr && primaryErr.message ? primaryErr.message : primaryErr)
    );
    return rescueSolve(question, primaryErr);
  }

  function bestConfidence(votes, key) {
    const same = votes.filter((v) => v.answerText === key);
    if (!same.length) return 0.5;
    // 支持者越多、置信度越高越可信
    const avg = same.reduce((s, v) => s + v.confidence, 0) / same.length;
    const boost = Math.min(0.12, (same.length - 1) * 0.04);
    return CXAI.U.clamp(avg + boost, 0.01, 1);
  }

  function bestReason(votes, key) {
    const same = votes.filter((v) => v.answerText === key && v.reason);
    if (!same.length) return '';
    same.sort((a, b) => b.confidence - a.confidence);
    return same[0].reason;
  }

  function voteSummary(v) {
    return {
      who: v.providerLabel,
      answer: v.answerText,
      confidence: +v.confidence.toFixed(2),
      reason: v.reason,
      agreeWith: v.agreeWith
    };
  }

  /* ---------------- 连通性自检 ---------------- */

  async function ping(provider) {
    const t0 = Date.now();
    const res = await callProvider(
      provider,
      [
        { role: 'system', content: '你是一个连通性测试端点，只输出 JSON。' },
        { role: 'user', content: '输出 {"answer":"ok","confidence":1,"reason":"ping"}' }
      ],
      { temperature: 0, maxTokens: 60 }
    );
    return { ok: true, ms: Date.now() - t0, text: CXAI.U.truncate(res.text, 80) };
  }

  return {
    solve,
    councilSolve,
    rescueSolve,
    heuristicAnswer,
    ping,
    listModels,
    callProvider,
    parseModelResult,
    resolveAnswerKeys,
    isTextType,
    cleanAnswerText,
    normWidth,
    tally,
    buildPanel
  };
})();

/* ==================== 05-apply.js ==================== */
/* ---------------- 执行层：拟人化点选与作答写入 ----------------
 * 只做三件事：
 *   1) 把答案落到真实 DOM 上（点选项 / 写填空 / 选判断）
 *   2) 每步都复核是否真的选中，失败换策略重试
 *   3) 所有动作带随机延时与真实事件序列，避免"机器点击"特征
 */

CXAI.Apply = (function () {
  const POINTER_SEQ = ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove'];

  function sleep(...a) {
    return CXAI.U.sleep(...a);
  }

  /* ---------------- 基础：事件派发 ---------------- */

  function fire(el, type, extra) {
    const isPointer = /^pointer/.test(type);
    const isMouse = /^(mouse|click|dblclick|contextmenu)/.test(type);
    let ev;
    if (isPointer && typeof PointerEvent === 'function') {
      ev = new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse' }, extra || {}));
    } else if (isMouse) {
      // 油猴沙箱里的 window 不是真 Window：`view: window` 会让 MouseEvent 构造直接抛
      // "Failed to read the 'view' property from 'UIEventInit'"，整题落盘随之中断。
      // view 对 dispatchEvent 没有作用，去掉它；真需要时再试 unsafeWindow。
      const opts = Object.assign({ bubbles: true, cancelable: true, composed: true }, extra || {});
      try {
        ev = new MouseEvent(type, opts);
      } catch (e) {
        ev = new Event(type, { bubbles: true, cancelable: true });
      }
    } else {
      ev = new Event(type, { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(ev);
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    // 随机落点，避开正中心（真实人手不会每次都点正中）
    const px = 0.25 + Math.random() * 0.5;
    const py = 0.3 + Math.random() * 0.4;
    return {
      x: Math.round(r.left + r.width * px),
      y: Math.round(r.top + r.height * py),
      clientX: Math.round(r.left + r.width * px),
      clientY: Math.round(r.top + r.height * py)
    };
  }

  /**
   * 拟人点击：指针预热 + 一次激活行为。
   *
   * 关键（对齐 ocsjs 的 `option.click()`）：
   *   **一次操作 = 一次 click**。
   * 旧实现先 fire('click') 再 el.click()，等于同一选项被 handler 处理两次：
   *   - 多选/复选的 handler 是 toggle 语义 → 点两次 = 选中又取消；
   *   - 单选虽然幂等，但页面会因此发两次保存请求，后端按最后一次落库。
   * 这就是"页面上明明看到点了，超星却记 0 题"的直接来源。
   */
  async function humanClick(el, opts) {
    opts = opts || {};
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {
      try {
        el.scrollIntoView();
      } catch (e2) {}
    }
    await sleep(CXAI.U.randInt(90, 240));

    const pt = centerOf(el) || { clientX: 0, clientY: 0 };
    const base = {
      clientX: pt.clientX,
      clientY: pt.clientY,
      screenX: pt.clientX + (window.screenX || 0),
      screenY: pt.clientY + (window.screenY || 0),
      button: 0,
      buttons: 0
    };

    // 指针预热：只负责 hover/按下/抬起的"手感"，不触发激活行为
    for (const t of POINTER_SEQ) {
      fire(el, t, base);
      await sleep(CXAI.U.randInt(5, 18));
    }
    fire(el, 'focus', base);
    fire(el, 'pointerdown', Object.assign({}, base, { buttons: 1 }));
    fire(el, 'mousedown', Object.assign({}, base, { buttons: 1 }));
    await sleep(CXAI.U.randInt(45, 120));
    fire(el, 'pointerup', base);
    fire(el, 'mouseup', base);
    await sleep(CXAI.U.randInt(10, 35));

    // 唯一的激发点：原生 click（走页面自己的 handler + 浏览器默认行为）
    try {
      el.click();
    } catch (e) {}
    return true;
  }

  /** 一次点击：语义等同 humanClick，留着是为了让调用点读起来明确"只点一次" */
  function clickOnce(el) {
    return humanClick(el, {});
  }

  /* ---------------- 状态探测 ---------------- */

  /** class 列表（避开 "unchecked" 这种含 checked 的坑） */
  function classTokens(node) {
    const raw = node && node.className;
    if (!raw) return [];
    if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
    if (raw.baseVal != null) return String(raw.baseVal).split(/\s+/).filter(Boolean);
    return [];
  }

  /**
   * 选中态类名（各版皮肤都可能用到）：
   *   check_answer / checkAnswer  —— 超星老考试页、作业页
   *   checked / selected / active / chosed / chosen —— 新版与预览页
   * 明确排除 unchecked / unselected 这类反向类名。
   */
  const SEL_TOKEN = /^(check_?answer\w*|checked|selected|active|chosed|chosen|curSelected)$/i;

  function hasSelClass(node) {
    if (!node) return false;
    return classTokens(node).some((t) => !/^un/i.test(t) && SEL_TOKEN.test(t));
  }

  function inputOf(el) {
    if (!el) return null;
    const own = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (own) return own;
    const host = el.parentElement;
    return (host && host.querySelector && host.querySelector('input[type="radio"], input[type="checkbox"]')) || null;
  }

  /**
   * 选项是否已选中。
   *
   * **只在"仅含这一个选项"的容器里查**（见 Scraper.optionScope）：
   * 超星考试页 .stem_answer 同时包住 A/B/C/D 四个 .answerBg，
   * 一旦往上找到 .stem_answer 的 `[class*="check_answer"]`，任意一个选项被选就会
   * 把四个都判成"已选"—— 多选的取消多余勾选因此一次都不执行（真机实测：
   * 正确答案 AB，页面留下 ACD）。
   */
  function sibsOf(q) {
    return ((q && q.options) || []).map((o) => o.el);
  }

  function isChecked(optionEl, siblings) {
    if (!optionEl) return false;
    const scope = (CXAI.Scraper.optionScope && CXAI.Scraper.optionScope(optionEl, siblings)) || optionEl;
    for (const node of [optionEl, scope]) {
      if (node && hasSelClass(node)) return true;
      if (node && node.getAttribute && node.getAttribute('aria-checked') === 'true') return true;
      if (node && node.hasAttribute && node.hasAttribute('checked')) return true;
    }
    try {
      if (scope.querySelector && scope.querySelector('[class*="check_answer"], [class*="checkAnswer"]')) return true;
    } catch (e) {}
    const inp = inputOf(optionEl);
    if (inp && (inp.checked || (inp.hasAttribute && inp.hasAttribute('checked')))) return true;
    return false;
  }

  /**
   * 选项状态指纹：类名链 + input.checked。
   * 页面用什么类名我们事先并不知道，"点完之后指纹变了"是唯一与皮肤无关的客观证据，
   * 用它代替"必须命中某个特定类名"的判定，可以避免"点了、页面也变了、但脚本仍认为没选中"
   * 从而连环补点、把已选 toggle 掉的情况。
   */
  function stateSig(optionEl) {
    if (!optionEl) return '';
    const chain = [optionEl, optionEl.parentElement, optionEl.parentElement && optionEl.parentElement.parentElement].filter(Boolean);
    const parts = chain.map((n) => classTokens(n).join('.'));
    const inp = inputOf(optionEl);
    parts.push(inp ? String(!!inp.checked) + '@' + (inp.getAttribute('checked') || '') : '-');
    return parts.join('|');
  }

  /** 选项及其两层父节点的全部类名（去重），用于判断"点击后新增了什么类" */
  function classChain(optionEl) {
    const chain = [optionEl, optionEl && optionEl.parentElement, optionEl && optionEl.parentElement && optionEl.parentElement.parentElement].filter(Boolean);
    const out = [];
    chain.forEach((n) =>
      classTokens(n).forEach((t) => {
        if (out.indexOf(t) < 0) out.push(t);
      })
    );
    return out;
  }

  /**
   * 点击后新增的类名，排除纯视觉态（hover / focus / mousedown…）。
   * 旧实现拿 stateSig 的整串比对，hover 换一个类就当成"选中成功"，
   * 真正的选中失败被掩盖，只能靠后面的隐藏域验收兜底（没有隐藏域的皮肤直接漏检）。
   */
  function addedTokens(optionEl, before) {
    const now = classChain(optionEl);
    return now.filter((t) => before.indexOf(t) < 0 && !/hover|focus|mouseover|mouseenter|mousedown|mousemove|pressed|drag/i.test(t));
  }

  async function waitChecked(optionEl, timeoutMs, siblings) {
    const deadline = Date.now() + (timeoutMs || 1200);
    while (Date.now() < deadline) {
      if (isChecked(optionEl, siblings)) return true;
      await sleep(80);
    }
    return isChecked(optionEl, siblings);
  }

  /* ---------------- 选择题 ---------------- */

  /** 元素是否还挂在文档上：单题模式页面会在 AI 请求期间重绘，旧引用会失效 */
  function isLive(el) {
    if (!el) return false;
    try {
      if (el.isConnected === true) return true;
      if (typeof document.contains === 'function') return document.contains(el);
    } catch (e) {}
    // 判断不了就当它是活的：点一下没反应也不会有副作用，验收那步会兜住
    return true;
  }

  function innerInput(opt) {
    const el = opt.el;
    const own = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (own) return own;
    const host = el.parentElement;
    return (host && host.querySelector && host.querySelector('input[type="radio"], input[type="checkbox"]')) || null;
  }

  /**
   * 点击阶梯：从"最像人手"到"最像注入"，逐级尝试。
   * 单题模式实测最常见的两种失败是
   *   1) 页面事件委托挂在 a.answerBg / li 上，点 .answer_p 不冒到 handler；
   *   2) 页面用 jQuery 绑定，原生 click 不触发（需要 .trigger('click')）。
   */
  /** 找选项/祖先上的行内 onclick 代码，用于直接调用页面自己的选中函数 */
  function pageFnOf(el) {
    let p = el;
    for (let i = 0; i < 5 && p; i++) {
      const attr = p.getAttribute ? p.getAttribute('onclick') : null;
      if (attr && /[A-Za-z_$][\w$]*\s*\(/.test(attr)) return { node: p, code: attr.trim() };
      p = p.parentElement;
    }
    return null;
  }

  /**
   * 点击目标阶梯。顺序对齐 ocsjs：**先点选项元素本身**（ocsjs 就是 `option.click()`，
   * option 取的是 `.answerBg .answer_p / .textDIV / .eidtDiv`），页面自己的 handler 跑不通
   * 再退到行内 onclick 函数、容器、input。
   * 每一步都与上一步不同节点，绝不重复点同一个位置。
   */
  function clickPlan(opt) {
    const el = opt.el;
    const plan = [];
    const seen = [];
    const add = (kind, node, label) => {
      if (!node || seen.indexOf(node) >= 0) return;
      seen.push(node);
      plan.push({ kind, el: node, label });
    };

    add('human', el, 'self');
    const pf = pageFnOf(el);
    if (pf) plan.push({ kind: 'pagefn', el: pf.node, code: pf.code, label: 'page-fn' });
    // 页面把状态挂在容器上（answerBg / li / label）时，补一次容器点击
    let p = el;
    for (let i = 0; i < 3 && p; i++) {
      p = p.parentElement;
      if (!p) break;
      if (/^(LI|LABEL|A)$/.test(p.tagName) || /answerBg|answer_bg|answerItem|option|chose/i.test(String(p.className || ''))) {
        add('human', p, 'anc:' + p.tagName.toLowerCase());
        break;
      }
    }
    add('native', innerInput(opt), 'input');
    add('jquery', el.parentElement || el, 'jq:self');
    add('hit', el, 'hit-test');
    return plan;
  }

  async function perform(step) {
    // 注意：这里不因为"看起来脱离文档"就跳过。派发事件给游离节点没有任何副作用，
    // 而 isLive() 在部分页面/沙箱环境下会误判，导致一次点击都发不出去（v1.4.2 的教训）。
    if (!step || !step.el) return false;
    try {
      if (step.kind === 'native') {
        step.el.click();
        return true;
      }
      if (step.kind === 'hit') {
        // 选项被透明遮罩/浮层盖住时，事件会落到命中元素上，这里改点真正的命中元素
        if (typeof document.elementFromPoint !== 'function') return false;
        const r = step.el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === step.el) return false;
        await humanClick(hit, { nativeFallback: true });
        return true;
      }
      if (step.kind === 'pagefn') {
        const win = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(step.code || '');
        const fn = m && win[m[1]];
        if (typeof fn !== 'function') return false;
        fn.call(win, step.el, window.event);
        return true;
      }
      if (step.kind === 'jquery') {
        const jq = window.jQuery || (typeof unsafeWindow !== 'undefined' && unsafeWindow.jQuery);
        if (typeof jq !== 'function') return false;
        jq(step.el).trigger('click');
        return true;
      }
      await humanClick(step.el, { nativeFallback: true });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 用抓取器重新读一遍页面，判断答案是否真的落到 DOM 上（最可靠的验收） */
  function freshAnswered(q, keys) {
    try {
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      if (!list.length) return false;
      const target = CXAI.Scraper.pickSame(list, q);
      if (!target) return false;
      const sibs = sibsOf(target);
      return (keys || []).some((k) => {
        const o = target.options.filter((x) => x.key === k)[0];
        return !!(o && (o.answered || isChecked(o.el, sibs)));
      });
    } catch (e) {
      return false;
    }
  }

  /** 失败时把选项的祖先结构记下来，方便定位是哪套页面皮肤 */
  function domSignature(opt) {
    const out = [];
    let p = opt && opt.el;
    for (let i = 0; i < 5 && p; i++) {
      out.push(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).trim().split(/\s+/).slice(0, 2).join('.') : ''));
      p = p.parentElement;
    }
    return out.join(' < ');
  }

  /**
   * 处理一道选择题。
   * @returns {Promise<{ok:boolean, clicked:string[], strategy:string, error?:string}>}
   */
  /** 页面上当前真实的答案串：优先页面自己的隐藏域（#answer{qid}/answers{qid}），退回选中标记 */
  function currentKeys(q) {
    try {
      const v = CXAI.Scraper.pageValue(q);
      if (v && v.value && /^[A-H]+$/i.test(v.value)) return v.value.toUpperCase();
    } catch (e) {}
    return CXAI.Scraper.selectedKeys(q);
  }

  async function answerChoice(q, keys, opts) {
    opts = opts || {};
    const sibs = sibsOf(q);
    const want = (keys || []).filter((k) => q.options.some((o) => o.key === k)).sort();
    if (!want.length) return { ok: false, clicked: [], strategy: 'none', error: '答案选项不存在' };
    if (q.type === 'single' || q.type === 'judgement') {
      // 单选/判断只取第一个：页面自身是单值语义，点新的会自动取消旧的
      const r = await clickOne(q, want[0], opts);
      const actual = currentKeys(q);
      return Object.assign({}, r, { actual, ok: !!(r && r.ok) && actual.indexOf(want[0]) >= 0 });
    }

    // 多选：以页面真实答案做差量 —— 只补缺的、只取消多的。
    // 之前靠 isChecked 判断，而 isChecked 会在 .stem_answer 层看到别的选项的勾，
    // 于是"已有的全跳过、多余的全不改"，最后留下 ACD（正确答案 AB）。
    const before = currentKeys(q);
    const clicked = [];
    const add = want.filter((k) => before.indexOf(k) < 0);
    const del = opts.clearExtra === false
      ? []
      : before.split('').filter((k) => k && want.indexOf(k) < 0);

    for (const k of add) {
      const opt = q.options.filter((o) => o.key === k)[0];
      if (!opt) return { ok: false, clicked, strategy: 'multi', error: '选项缺失' };
      const r = await clickOne(q, k, opts);
      if (!r.ok) return { ok: false, clicked, strategy: r.strategy, error: r.error, dom: r.dom, actual: currentKeys(q) };
      clicked.push(k);
      await sleep(CXAI.U.randInt(220, 620));
    }
    for (const k of del) {
      const opt = q.options.filter((o) => o.key === k)[0];
      if (!opt) continue;
      // 取消勾选也必须真的点一下（toggle 语义），点完以页面答案为准
      const r = await clickOne(q, k, Object.assign({}, opts, { deselect: true }));
      clicked.push('-' + k);
      if (!r.ok) break;
      await sleep(CXAI.U.randInt(180, 420));
    }

    let actual = currentKeys(q);
    // 差量点完还不对 → 按"逐项对齐"再补一轮（页面对 toggle 有节流时会出现）
    if (actual !== want.join('')) {
      for (const k of want) {
        if (actual.indexOf(k) >= 0) continue;
        const r = await clickOne(q, k, opts);
        if (!r.ok) break;
        actual = currentKeys(q);
        if (actual.indexOf(k) >= 0) clicked.push(k);
        await sleep(CXAI.U.randInt(160, 380));
      }
    }
    const ok = want.every((k) => actual.indexOf(k) >= 0) && (opts.clearExtra === false || actual.length === want.length);
    return { ok, clicked, strategy: 'multi', actual };
  }

  /**
   * 文本兜底：拿着答案选项的文字，重新从页面上抓一遍题，按文字找元素再点。
   * 单题模式页面会重绘，原引用失效时这条路径能把答案落到新元素上。
   */
  async function retryByText(q, keys) {
    const norm = (t) => CXAI.U.normText(t || '');
    const wanted = (keys || [])
      .map((k) => {
        const o = q.options.filter((x) => x.key === k)[0];
        return o ? norm(o.text) : '';
      })
      .filter(Boolean);
    if (!wanted.length) return null;
    let list = [];
    try {
      list = (CXAI.Scraper.collect() || {}).questions || [];
    } catch (e) {
      return null;
    }
    const target = CXAI.Scraper.pickSame(list, q);
    if (!target || !target.options.length) return null;

    const picked = [];
    for (const t of wanted) {
      let opt = target.options.filter((o) => norm(o.text) === t)[0];
      if (!opt) {
        const short = t.slice(0, 12);
        opt = target.options.filter((o) => short && norm(o.text).indexOf(short) >= 0)[0];
      }
      if (!opt) return null;
      const r = await clickOne(target, opt.key, {});
      if (!r.ok) return { ok: false, clicked: picked, strategy: 'by-text', error: r.error, dom: r.dom };
      picked.push(opt.key);
      await sleep(CXAI.U.randInt(200, 460));
    }
    if (target.type === 'single' || target.type === 'judgement') {
      // 单选只认第一个
      return { ok: picked.length > 0, clicked: picked, strategy: 'by-text' };
    }
    return { ok: picked.length === wanted.length, clicked: picked, strategy: 'by-text' };
  }

  /**
   * 把某个选项点到"页面上确实处于选中态"。
   *
   * 复用 ocsjs 被长期验证正确的三条：
   *   1) 用原生 el.click() 让页面自己的 handler 跑（不代劳改 DOM、不伪造状态）；
   *   2) 点一次就等 ~500ms 再看结果，不在同一次操作里连点；
   *   3) 已经选中就跳过，绝不重复点（toggle 语义的选项一点第二次就回到未选）。
   *
   * 在三条之上只加一件事：**状态指纹比对**。
   * 页面用 check_answer 也好、只改 input.checked 也好、换成别的类名也好，
   * 只要点完之后指纹和点之前不同，就认定这一下生效了，立刻收手。
   * 这样既不会因为"类名不认识"而连环补点，也不会把选中态 toggle 掉。
   */
  async function clickOne(q, key, opts) {
    opts = opts || {};
    const opt = q.options.filter((o) => o.key === key)[0];
    if (!opt) return { ok: false, clicked: [], strategy: 'none', error: '选项缺失' };
    // 已选中 → 直接过（ocsjs 的 if 判断就是这一条：已选不再点）
    // 例外：opts.deselect（多选里要取消多余勾选）时必须真的点一下
    const sibs = sibsOf(q);
    if (!opts.deselect && isChecked(opt.el, sibs)) return { ok: true, clicked: [key], strategy: 'already' };

    const settleMs = Number(opts.settleMs || 520); // ocsjs: await $.sleep(500)
    const sigBefore = stateSig(opt.el);
    const tokensBefore = classChain(opt.el);
    const plan = clickPlan(opt);
    const tried = [];
    let maxSteps = Number(opts.maxSteps || 5);

    for (const step of plan) {
      if (tried.filter((t) => t.indexOf('(跳过)') < 0).length >= maxSteps) break;
      const did = await perform(step);
      tried.push(step.label + (did ? '' : '(跳过)'));
      if (!did) continue;

      await sleep(settleMs); // 只等一次，不在这里做任何补点

      const picked = isChecked(opt.el, sibs);
      // 只有"选中证据"才算成功：真选中类名/aria/checked，或新增了一个非 hover/focus 的类。
      const added = addedTokens(opt.el, tokensBefore);
      if (picked || added.length) {
        return {
          ok: true,
          clicked: [key],
          strategy: step.label + (!picked && added.length ? '+cls:' + added[0] : '')
        };
      }
      // 完全没有变化 → 说明这一下没打到 handler，才换下一个目标（换的是不同节点）
      await sleep(CXAI.U.randInt(120, 260));
    }

    let probe = '';
    try {
      const r = opt.el.getBoundingClientRect ? opt.el.getBoundingClientRect() : null;
      probe =
        'live=' + isLive(opt.el) +
        ' conn=' + opt.el.isConnected +
        ' rect=' + (r ? Math.round(r.width) + 'x' + Math.round(r.height) : '?') +
        ' cls=' + (opt.el.className || '-') +
        ' sig=' + sigBefore +
        ' now=' + stateSig(opt.el);
    } catch (e) {
      probe = 'probe 失败：' + e.message;
    }
    return {
      ok: false,
      clicked: [],
      strategy: 'failed',
      error: '点击后页面无任何变化（试过 ' + tried.slice(0, 6).join(' / ') + '）',
      dom: domSignature(opt) + ' ｜ ' + probe
    };
  }

  /**
   * 点完之后的"落库窗口"。
   *
   * 超星各版本收集答案的时机不同：作业页要点每题自带的保存按钮，考试页多在
   * 点击后异步 POST、翻页前再由页面统一保存。原实现在 clickOne 成功后立刻点
   * "下一题"，等于抢在页面把答案写进内部状态之前换题 —— 表现就是"选项看着是选中的，
   * 交卷/回看却是 0 题"。
   *
   * 这里做两件事：有保存按钮就点一次；再留一段固定静默期给页面的 AJAX 落库。
   */
  async function settle(q, minMs) {
    let saved = false;
    try {
      const btn =
        (q && q.root && q.root.querySelector('[onclick*="saveQuestion"], .saveQuestion, [class*="save_btn"], .savebtndiv, [class*="savebtn"]')) ||
        // 兜底只认"本题 qid"的保存按钮，不再全页抓第一个 —— 整卷页面会点到别的题的保存
        (q && q.qid ? document.querySelector('[onclick*="saveQuestion(' + q.qid + '"]') : null);
      if (btn) {
        await clickOnce(btn);
        saved = true;
      }
    } catch (e) {}
    const wait = Math.max(Number(minMs || 0), Number(CXAI.Cfg.get('apply.settleMs', 900)) || 900);
    await sleep(wait);
    return { saved, waited: wait };
  }

  /* ---------------- 填空题 ---------------- */

  /** 给原生输入框写值，模拟键盘输入末尾的事件序列 */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    fire(el, 'keydown');
    fire(el, 'input');
    fire(el, 'keyup');
    fire(el, 'change');
    fire(el, 'blur');
  }

  /** 富文本 iframe（有道/超星自带编辑器）写入 */
  function setFrameValue(frame, value) {
    const doc = frame.contentDocument;
    if (!doc) return false;
    const body = doc.body;
    if (!body) return false;
    body.innerHTML = String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    try {
      body.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      body.dispatchEvent(new doc.defaultView.Event('keyup', { bubbles: true }));
    } catch (e) {}
    return true;
  }

  /** 逐字符"打字"，让 input 事件序列看起来像真人 */
  async function typeInto(el, text, opts) {
    opts = opts || {};
    const target = String(text == null ? '' : text);
    if (opts.instant) {
      setNativeValue(el, target);
      return true;
    }
    try {
      el.focus();
    } catch (e) {}
    setNativeValue(el, '');
    const step = Math.max(1, Math.ceil(target.length / 24));
    let cur = '';
    for (let i = 0; i < target.length; i += step) {
      cur = target.slice(0, i + step);
      setNativeValue(el, cur);
      await sleep(CXAI.U.randInt(28, 90));
    }
    setNativeValue(el, target);
    return el.value === target;
  }

  function splitBlanks(text, count) {
    const t = String(text || '').trim();
    if (!t) return new Array(Math.max(1, count)).fill('');
    // 只有一个答题框（简答/论述最常见）：模型用 "|||" 分隔多个设问，它只是分隔符，
    // 不能原样写进答案框。旧实现 count<=1 直接返回原文，页面里就会出现 "1. …|||2. …"。
    if (count <= 1) {
      const joined = t
        .split(/\s*\|\|\|\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
      return [joined || t];
    }

    const mk = (re) => t.split(re).map((s) => s.trim()).filter(Boolean);
    // 只把顿号当"多个空"的分隔符。逗号（，/,）在中文句子里太常见，
    // 拿来切分会把"首先，…，然后，…"这种整段答案拆成半句话分别塞进多个空。
    const COMMA = /\s*、\s*/;
    const commaParts = () => t.split(COMMA).map((s) => s.trim()).filter(Boolean);
    const allShort = (parts) => parts.length > 0 && parts.every((p) => p.length <= 16);

    // 逐级尝试常见分隔符：显式的 ||| 最可信，其次分号、换行、顿号/逗号。
    const EXPLICIT = [/\s*\|\|\|\s*/, /\s*[;；]\s*/, /\s*\n+\s*/];
    for (const re of EXPLICIT) {
      const parts = mk(re);
      if (parts.length === count) return parts;
    }
    const cparts = commaParts();
    if (cparts.length === count && allShort(cparts)) return cparts;

    // 拆出来的项比空多：按顺序取前 count 个。
    // 顿号/逗号只有在每一项都短（是"空"而不是句子）时才允许截断 ——
    // 否则一段带逗号的简答正文会被误当成多个空，前两个逗号之间的半句话被写进框里。
    for (const re of EXPLICIT) {
      const parts = mk(re);
      if (parts.length > count) return parts.slice(0, count);
    }
    if (cparts.length > count && allShort(cparts)) return cparts.slice(0, count);

    // 拆出来比空少：按顺序填，剩下的留空，由上层标成需人工复核
    for (const re of EXPLICIT) {
      const parts = mk(re);
      if (parts.length > 1) {
        const out = new Array(count).fill('');
        parts.forEach((p, i) => {
          if (i < count) out[i] = p;
        });
        return out;
      }
    }
    if (cparts.length > 1 && allShort(cparts)) {
      const out = new Array(count).fill('');
      cparts.forEach((p, i) => {
        if (i < count) out[i] = p;
      });
      return out;
    }

    // 真的没法拆：整段塞第一个空（保持旧行为，不把答案丢掉）
    const out = new Array(count).fill('');
    out[0] = t;
    return out;
  }

  /* ---------------- 富文本（UEditor） ---------------- */

  /**
   * 找出这道题上的 UEditor 实例。
   * 超星填空/简答提交时走 setStuAnswerOfSomeQues() → UE.getEditor(id).sync()，
   * 而 sync() 取的是 **编辑器实例内部的内容**。v1.4.x 直接往 iframe.body 里写 HTML，
   * 编辑器实例并不知道，sync() 同步出去仍是空串 —— 这就是"填空/简答看着填了、系统里是 0"。
   */
  function editorList(q) {
    const out = [];
    const api = CXAI.Scraper.ueditorApi ? CXAI.Scraper.ueditorApi() : null;
    if (!api || !q) return out;
    const inst = (api.instances && typeof api.instances === 'object' ? api.instances : {}) || {};
    // 顺序很重要：先页面上真实存在的 textarea（填空是 answerEditor{qid}N），
    // 再退到"实例已经存在"的控件。反过来的话，UE.getEditor('answer{qid}')
    // 会为一个不存在的容器造出"空壳实例"（setContent 存在、body 为 null），
    // 写进去的内容会被 submitForm 里的 sync() 用空内容覆盖掉 —— 又变成"填了没交"。
    const ids = [];
    const add = (id) => {
      if (id && ids.indexOf(id) < 0) ids.push(id);
    };
    try {
      Array.from((q.root || document).querySelectorAll('textarea[id]')).forEach((ta) => add(ta.id));
    } catch (e) {}
    // 已经建好的实例（含 textarea 被编辑器替换掉的皮肤）：只读 instances，绝不新建。
    // 对 input/iframe 的 id 调 getEditor 会凭空造出空壳实例，甚至把正常文本框替换成编辑器。
    Object.keys(inst).forEach((id) => {
      if (!id) return;
      // 只认本题的实例 id，避免把别题的编辑器也写一遍。
      // 没有 qid 时**绝不**按前缀扫描全页实例：整卷里每个题都会把别人的编辑器算进来。
      const qid = q.qid || (CXAI.Scraper.qidOf ? CXAI.Scraper.qidOf(q.root) : '');
      if (qid && (id === 'answer' + qid || id.indexOf('answerEditor' + qid) === 0 || id.indexOf('ueditor_' + qid) === 0)) add(id);
    });
    (q.inputs || []).forEach((el) => {
      if (el && el.id && inst[el.id]) add(el.id);
    });
    for (const id of ids) {
      try {
        let ed = inst[id];
        // 只有超星编辑器的固定 id 才允许"按需创建"，普通 textarea 绝不能 getEditor
        if (!ed && /^(answer\d|answerEditor\d|ueditor)/i.test(id)) ed = api.getEditor(id);
        if (ed && typeof ed.setContent === 'function' && ed.body && out.indexOf(ed) < 0) out.push(ed);
      } catch (e) {}
    }
    return out;
  }

  function toEditorHtml(text) {
    return String(text == null ? '' : text)
      .split(/\r?\n/)
      .map((l) => '<p>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>')
      .join('');
  }

  /** 写入编辑器并 sync 回隐藏域，最后按编辑器内容验收 */
  function setEditorValue(ed, text) {
    if (!ed || typeof ed.setContent !== 'function') return false;
    try {
      if (typeof ed.focus === 'function') ed.focus();
    } catch (e) {}
    try {
      ed.setContent(toEditorHtml(text), false);
    } catch (e) {
      try {
        ed.setContent(toEditorHtml(text));
      } catch (e2) {
        return false;
      }
    }
    try {
      if (typeof ed.sync === 'function') ed.sync();
    } catch (e) {}
    try {
      if (typeof ed.fireEvent === 'function') {
        ed.fireEvent('contentChange');
        ed.fireEvent('selectionchange');
      }
    } catch (e) {}
    let got = '';
    try {
      got = ed.getPlainTxt ? ed.getPlainTxt() : String(ed.getContent() || '').replace(/<[^>]+>/g, ' ');
    } catch (e) {}
    const norm = (t) => String(t || '').replace(/\s+/g, '');
    const want = norm(String(text == null ? '' : text).slice(0, 24));
    return !!want && norm(got).indexOf(want) >= 0;
  }

  /** 这个 iframe 是不是富文本编辑器（UEditor / contenteditable），而不是附件或播放器 */
  function isEditableFrame(el) {
    if (!el) return false;
    if (/^ueditor/i.test(String(el.id || ''))) return true;
    try {
      const b = el.contentDocument && el.contentDocument.body;
      return !!(b && (b.isContentEditable || b.getAttribute('contenteditable') === 'true'));
    } catch (e) {
      return false;
    }
  }

  /**
   * 处理填空题 / 简答题。
   * @returns {Promise<{ok:boolean, filled:number, mode?:string, error?:string}>}
   */
  /**
   * 等这道题的答题框就绪。
   *
   * 单题模式换题、整卷预览首次渲染时，UEditor 是**异步**建起来的：这一刻页面上
   * 只有原始 textarea，等一拍才变成编辑器实例。旧实现在这一刻直接写 textarea/iframe，
   * 编辑器随后初始化又用空内容覆盖回去 —— 用户看到的就是
   * 「填空题第一次点不输入答案，第二次点才写进去」（2026-11-19 实测）。
   */
  async function ensureBlankReady(q) {
    let api = null;
    try {
      api = CXAI.Scraper.ueditorApi ? CXAI.Scraper.ueditorApi() : null;
    } catch (e) {
      api = null;
    }
    if (!api || !CXAI.Scraper.ensureEditorsAsync) return;
    let areas = [];
    try {
      areas = Array.from((q.root || document).querySelectorAll('textarea[id^="answerEditor"], textarea[id^="answer"]'));
    } catch (e) {
      areas = [];
    }
    if (!areas.length) return;
    // 实例已经挂好就不用等
    const inst = (api.instances && typeof api.instances === 'object' ? api.instances : {}) || {};
    if (areas.every((ta) => inst[ta.id] && inst[ta.id].body)) return;
    try {
      await CXAI.Scraper.ensureEditorsAsync(2600);
    } catch (e) {}
    await sleep(CXAI.U.randInt(120, 260));
  }

  async function answerBlank(q, text, opts) {
    opts = opts || {};
    await ensureBlankReady(q);
    let r = await writeBlankOnce(q, text, opts);
    // 一个字都没写进去：多半是元素刚被页面重建/编辑器刚就绪，重取一次再写一遍
    if (r && !r.filled && !r.ok) {
      await sleep(CXAI.U.randInt(320, 560));
      let fresh = q;
      try {
        const list = (CXAI.Scraper.collect() || {}).questions || [];
        fresh = CXAI.Scraper.pickSame(list, q) || q;
      } catch (e) {}
      r = await writeBlankOnce(fresh, text, opts);
      if (r && r.filled) CXAI.Log.info('填空/简答第一次没写进去，重取答题框后已写入 ' + r.filled + '/' + (r.total || '?'));
    }
    return r;
  }

  /** 真正写一次（编辑器 → 原生输入框两级） */
  async function writeBlankOnce(q, text, opts) {
    opts = opts || {};
    const eds = editorList(q);
    if (eds.length) {
      const parts = splitBlanks(text, eds.length);
      let filled = 0;
      for (let i = 0; i < eds.length; i++) {
        const val = parts[i] != null ? parts[i] : String(text || '');
        if (!val) continue;
        if (setEditorValue(eds[i], val)) filled++;
        await sleep(CXAI.U.randInt(160, 420));
      }
      // 全部空都写进去才算成功（见下面 native 分支的说明）
      if (filled) return { ok: filled === eds.length, filled, total: eds.length, partial: filled < eds.length, mode: 'ueditor' };
    }
    const inputs = (q.inputs || []).filter((el) => el && el.isConnected);
    if (!inputs.length) {
      // 回退：从 root 里现找（附件/视频 iframe 不是答题框，别把答案写进去）
      q.inputs = Array.from(q.root.querySelectorAll('textarea, input[type="text"], iframe')).filter((el) => {
        if (!el || (el.closest && el.closest('.mark_answer'))) return false;
        return String(el.tagName).toUpperCase() !== 'IFRAME' || isEditableFrame(el);
      });
    }
    const list = (q.inputs || []).filter((el) => {
      if (!el || !el.isConnected) return false;
      // 隐藏控件（type=hidden / display:none）不是给考生填的：混进来会把"3 个空"算成 6 个空，
      // 答案被拆散进看不见的元素（2026-11-18 实测填空题 inputs=6）。
      if (String(el.tagName).toUpperCase() === 'INPUT' && String(el.type).toLowerCase() === 'hidden') return false;
      if (String(el.tagName).toUpperCase() === 'IFRAME' && !isEditableFrame(el)) return false;
      try {
        if (el.offsetParent === null && getComputedStyle(el).display === 'none') return false;
      } catch (e) {}
      return true;
    });
    if (!list.length) return { ok: false, filled: 0, error: '未找到输入框' };

    const parts = splitBlanks(text, list.length);
    let filled = 0;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const val = parts[i] != null ? parts[i] : parts[parts.length - 1] || '';
      if (!val) continue;
      if (el.tagName === 'IFRAME') {
        if (setFrameValue(el, val)) filled++;
      } else {
        const ok = await typeInto(el, val, opts);
        if (ok) filled++;
      }
      await sleep(CXAI.U.randInt(160, 420));
    }
    // 原生控件也回读一次：input 事件被页面重置时 typeInto 会"写成功但值是空"
    let got = 0;
    for (const el of list) {
      if (el.value != null && String(el.value).trim()) got++;
      else if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument && el.contentDocument.body && (el.contentDocument.body.innerText || '').trim()) got++;
        } catch (e) {}
      }
    }
    if (got) filled = Math.max(filled, got);
    // 只有全部空都落盘才算成功。3 个空只写进 1 个就报 ok，主循环会当成"已答"继续翻页，
    // 剩下的空永远没人补（2026-11-18 真机：一道三空填空只填了第一个）。
    return { ok: filled === list.length, filled, total: list.length, partial: filled < list.length, mode: 'native' };
  }

  /** 这些题型按"写文本"处理（与 04-ai.isTextType 对齐，避免两边漂移） */
  function isTextKind(q) {
    if (!q) return false;
    return /^(completion|line|reader|fill|oral|listening)$/.test(String(q.type || ''));
  }

  /* ---------------- 判断题 ---------------- */

  const JUDGE_YES = /^(对|正确|是|√|v|true|t|yes|y|1|right)$/i;
  const JUDGE_NO = /^(错|错误|否|×|x|false|f|no|n|0|wrong)$/i;

  /** 「对/错」两侧判定：返回 'yes' / 'no' / ''（先剥掉选项字母前缀） */
  function judgeSide(text) {
    const t = String(text == null ? '' : text)
      .trim()
      .replace(/^[A-Ha-h][\s.、:：)）]*/, '')
      .trim();
    if (!t) return '';
    if (JUDGE_YES.test(t)) return 'yes';
    if (JUDGE_NO.test(t)) return 'no';
    return '';
  }

  /**
   * 判断题的候选选项：问卷子长成什么皮肤，只要能点到就行。
   *   ① q.options（正常 .answerBg 皮肤 / 已被 03-scraper 还原的 hoverDiv 皮肤）
   *   ② 小题组里唯一那个空的选项（漏网的非字母键判断题）
   *   ③ 直接从题目容器里找 .hoverDiv / .answerBg / .answer_p
   */
  function judgeOptions(q) {
    const out = [];
    const push = (o, i) => {
      const el = (o && (o.clickEl || o.el || o.holder || o.add)) || null;
      if (!el || !el.isConnected) return;
      if (out.some((x) => x.el === el)) return;
      out.push({
        key: String((o && o.key) || '') || String.fromCharCode(65 + i),
        text: String((o && (o.text || o.raw || o.data)) || '').trim(),
        el
      });
    };
    (q.options || []).forEach(push);
    if (!out.length && q.group && q.group.length === 1) (q.group[0].options || []).forEach(push);
    if (!out.length && q.root) {
      let nodes = [];
      try {
        nodes = Array.from(q.root.querySelectorAll('.hoverDiv, .answerBg, .answer_p, .Cy_ulTop li')).filter(
          (el) => el && el.isConnected && !(el.closest && el.closest('.mark_answer'))
        );
      } catch (e) {
        nodes = [];
      }
      nodes.slice(0, 4).forEach((el, i) => {
        const txt = String(el.innerText || el.textContent || '').trim();
        if (!txt || txt.length > 20) return;
        push({ key: String.fromCharCode(65 + i), text: txt, el }, i);
      });
    }
    return out.slice(0, 4);
  }

  /**
   * 判断题落盘：先按「对/错」文字选边，再点那个选项，最后以页面状态验收。
   *
   * 为什么不再走字母：判断题的隐藏域常存 `true`/`false`，选项键也可能是 `data="true"`，
   * 拿 AI 的 `A`/`B` 去套集合比对永远对不上 —— 表现就是"点了、选了，但脚本说写入失败"。
   * OCS 的做法就是判断题按文字点，这里照做。
   */
  async function answerJudgement(q, result, opts) {
    opts = opts || {};
    const cands = judgeOptions(q);
    if (cands.length < 2) {
      return {
        ok: false,
        manual: true,
        error: '判断题没找到可点的选项（' + (q.typeLabel || '判断题') + '）；答案在面板里，请手动选'
      };
    }
    const keys = (result && (result.keys || []).join('')) || '';
    // 目标边：答案文字 → 字母 → 选项位置
    let want = judgeSide(result && result.answerText);
    let wantedKey = '';
    if (!want) {
      const m = /^[A-Ha-h]+$/.exec(String(keys).trim());
      if (m) {
        const idx = m[0].toUpperCase().charCodeAt(0) - 65;
        const o = cands[idx];
        want = (o && judgeSide(o.text)) || (idx === 0 ? 'yes' : 'no');
      }
    }
    if (!want) {
      return {
        ok: false,
        manual: true,
        error: '判断题的答案没能对上「对/错」（AI 答案：' + ((result && result.answerText) || '-') + '），请手动选'
      };
    }
    let target = cands.filter((o) => judgeSide(o.text) === want)[0];
    // 选项文字里没有对/错（只有 true/false 之类）：按位置取，A=第一个
    if (!target) target = cands[want === 'yes' ? 0 : 1] || cands[0];
    wantedKey = target.key;

    const pseudo = {
      type: 'judgement',
      qid: q.qid,
      root: q.root,
      options: cands.map((o) => ({ key: o.key, text: o.text, el: o.el, answered: false }))
    };
    const r = await clickOne(pseudo, wantedKey, opts);
    await sleep(CXAI.U.randInt(180, 420));

    // 验收三条任一命中就算成功：隐藏域折算成同一侧 / 选项上有选中标记
    let live = '';
    let liveOk = false;
    try {
      const pv = CXAI.Scraper.pageValue(q) || {};
      live = String(pv.value || '');
      if (live) {
        if (/^[A-Ha-h]+$/.test(live)) {
          liveOk = live.toUpperCase().indexOf(wantedKey) >= 0;
        } else {
          const side = judgeSide(live);
          liveOk = !!side && side === want;
        }
      }
    } catch (e) {}
    let marked = false;
    try {
      marked = isChecked(target.el, cands.map((x) => x.el));
    } catch (e) {}
    const ok = !!(r && r.ok) || liveOk || marked;
    return {
      ok,
      clicked: [wantedKey],
      actual: ok ? target.text : live,
      strategy: 'judgement',
      manual: !ok,
      error: ok
        ? undefined
        : '判断题点了没生效（' + ((r && r.error) || '页面无变化') + '）；目标：' + (want === 'yes' ? '对' : '错')
    };
  }

  /* ---------------- 统一入口 ---------------- */

  /**
   * 把一道题的判定结果写到页面上。
   * @param {object} q  题目对象
   * @param {object} result  CXAI.AI.solve 的返回
   */
  /**
   * 小题组落盘：完型填空 / 阅读理解这类"一题多小题"。
   * 每个小题的答案是 1~4 个字母（选项的 data 属性），点对应 .hoverDiv 会触发页面自己的
   * addChoice(this) → 写进 #answer{qid}。写完按 #answer{qid} 的实际值验收。
   */
  /**
   * 读某个空当前的真实答案。
   *   ① 独立隐藏域 #answer{uuid}（作业页 / 部分考试页）
   *   ② 完型 / 阅读 / 共用选项题：input[name="answer<题号>"] 里是 JSON
   *      { "<空UUID>": "{\"answer\":\"A\",\"score\":0.0}", ... }
   */
  function readBlankState(mainQid, uuid) {
    try {
      const el = document.querySelector('#answer' + uuid);
      if (el && String(el.value || '').trim()) return String(el.value);
    } catch (e) {}
    try {
      const box =
        document.querySelector('input[name="answer' + mainQid + '"]') ||
        document.querySelector('input[id="answer' + mainQid + '"]');
      if (box && box.value) {
        const obj = JSON.parse(box.value);
        const list = Array.isArray(obj) ? obj : [obj];
        for (const item of list) {
          if (!item || !item[uuid]) continue;
          let v = item[uuid];
          if (typeof v === 'string') {
            try {
              v = JSON.parse(v);
            } catch (e) {}
          }
          const ans = v && typeof v === 'object' ? v.answer : v;
          if (ans) return String(ans);
        }
      }
    } catch (e) {}
    return '';
  }

  /** 选项元素上是否已经出现"选中"标记（页面标记类名不统一，按正则兜） */
  function optionMarked(b, want) {
    try {
      const hit = (b.options || []).filter((o) => String(o.key || '').toUpperCase() === want)[0];
      if (!hit) return false;
      const re = /(^|\s)(check_?answer|checked|selected|cur|active|chosed|chosen)\S*/i;
      return [hit.el, hit.holder].filter(Boolean).some((n) => re.test(String(n.className || '')));
    } catch (e) {
      return false;
    }
  }

  /** 某个空当前是否已有答案（JSON 隐藏域优先，共用选项题看 B-answerCon 的标记） */
  function blankStateOf(b, mainQid) {
    if (b && b.btype) {
      let holder = null;
      try {
        holder = document.querySelector('#sigleQuestionDiv_' + mainQid + ' .B-answerCon[index="' + b.index + '"]');
      } catch (e) {}
      if (!holder) {
        try {
          holder = document.querySelectorAll('.B-answerCon')[Number(b.index) - 1] || null;
        } catch (e) {}
      }
      if (!holder) return '';
      const re = /(^|\s)(check_?answer|checked|selected|cur|active|chosed|chosen)\S*/i;
      const hit = Array.from(holder.querySelectorAll('span[choice_name]')).filter((sp) => re.test(String(sp.className || '')))[0];
      return hit ? String(hit.getAttribute('choice_name') || '').toUpperCase() : '';
    }
    return readBlankState(mainQid, b && b.qid);
  }

  async function answerGroup(q, result) {
    const blanks = (q && q.group) || [];
    if (!blanks.length) {
      return {
        ok: false,
        manual: true,
        error: '这题是多小题组，但页面上没抓到小题选项（' + (q.typeLabel || '未知题型') + '）'
      };
    }
    const text = String((result && result.answerText) || '');
    // 有些卷子的选项本身是占位文本（实测：完型 A/B/C/D 四个选项内容是「选项1..选项4」，
    // 页面上根本没有 however/adopted 这些词）。这种情况下按文字匹配毫无意义，
    // 只会把模型的猜测硬塞进去；这里只接受模型直接给的字母。
    const placeholder = blanks.length > 0 && blanks.every(function (b) {
      const opts = b.options || [];
      return opts.length > 0 && opts.every(function (o) {
        const t = String(o.text || '').replace(/^[A-Ha-h][\s.、:：)]*/, '').trim();
        return /^选项\s*\d+$/i.test(t);
      });
    });
    // 选项是占位文本时直接判定"题目有问题"，不要按字母硬点：
    // 卷子本身没有真实选项内容，点哪都是猜，写进去只会污染作答记录。
    if (placeholder) {
      return {
        ok: false,
        manual: true,
        broken: true,
        filled: 0,
        total: blanks.length,
        mode: 'group',
        actual: '',
        error: '题目有问题：卷子给的选项是占位文本（选项1/选项2…），没有真实选项内容，无法作答（共 ' + blanks.length + ' 个空）'
      };
    }

    const picks = [];
    const norm = (t) => String(t == null ? '' : t).replace(/[\s\u00a0]/g, '').toLowerCase();
    const stripKey = (t) => String(t || '').replace(/^[A-H][\s.、:：)]*/, '');
    const segs = text.split(/\s*\|\|\|\s*/).map((s) => s.trim()).filter(Boolean);
    // ① 逐段按"选项文字"匹配：完型/阅读的模型常直接回单词（in contrast / social …），
    //    只认字母的话会把 "in contrast" 里的 a、c 当答案，落进去全是乱字母（2026-11-18 实测）。
    for (let i = 0; i < blanks.length && i < segs.length; i++) {
      const seg = segs[i].replace(/^\s*\d{1,2}\s*[.、:：)]\s*/, '');
      if (!seg) continue;
      if (/^[A-Ha-h]{1,4}$/.test(seg)) {
        picks[i] = seg.toUpperCase();
        continue;
      }
      if (placeholder) continue; // 占位选项：文字对不上，别硬塞
      const ns = norm(seg);
      const opts = blanks[i].options || [];
      let hit = opts.filter((o) => norm(stripKey(o.text)) === ns)[0];
      if (!hit) {
        hit = opts.filter((o) => {
          const ot = norm(stripKey(o.text));
          return ot && (ot.indexOf(ns) >= 0 || ns.indexOf(ot) >= 0);
        })[0];
      }
      if (hit) picks[i] = String(hit.key).toUpperCase();
    }
    // ② 仍缺：带题号的 1:A 2:C（只补空位，不动①已匹配到的）
    if (picks.filter(Boolean).length < blanks.length) {
      const re = /(\d{1,2})\s*[:：.、)]\s*([A-H]{1,4})/g;
      let m;
      while ((m = re.exec(text))) {
        const idx = Number(m[1]) - 1;
        if (idx >= 0 && idx < blanks.length && !picks[idx]) picks[idx] = m[2].toUpperCase();
      }
    }
    // ③ 仍缺：A|||C|||B / A,C,B / 纯字母串，同样只补空位
    if (picks.filter(Boolean).length < blanks.length) {
      const segs2 = text
        .split(/\s*\|\|\|\s*|\s*[;；,，]\s*|\s*\n+\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segs2.length === blanks.length && segs2.every((s) => /^[A-Ha-h]{1,4}$/.test(s))) {
        segs2.forEach((s, i) => {
          if (!picks[i]) picks[i] = s.toUpperCase();
        });
      } else if (!placeholder) {
        const letters = (text.toUpperCase().match(/[A-H]/g) || []).join('');
        if (letters.length >= blanks.length) {
          letters.split('').slice(0, blanks.length).forEach((c, i) => {
            if (!picks[i]) picks[i] = c;
          });
        }
      }
    }
    const wrote = [];
    let filled = 0;
    for (let i = 0; i < blanks.length; i++) {
      const b = blanks[i];
      const want = picks[i] || '';
      if (!want) continue;
      let opt = (b.options || []).filter((o) => String(o.key || '').toUpperCase() === want)[0];
      // 选项键不是字母（判断题皮肤 data=true/false 之类漏网到这里的）：按字母位置取，A=第 1 个
      if (!opt && /^[A-H]$/.test(want)) {
        const idx = want.charCodeAt(0) - 65;
        opt = (b.options || [])[idx] || null;
      }
      if (!opt) continue;
      const target = opt.add || opt.el || opt.holder;
      const markedOf = () => {
        try {
          if (optionMarked(b, String(opt.key || '').toUpperCase() === want ? want : String(opt.key || ''))) return true;
        } catch (e) {}
        const re = /(^|\s)(check_?answer|checked|selected|cur|active|chosed|chosen)\S*/i;
        return [opt.el, opt.holder, opt.add].filter(Boolean).some((n) => re.test(String(n.className || '')));
      };
      try {
        await humanClick(target);
      } catch (e) {}

      // 先轮询回读：页面的 submitForm / JSON 落库都有延迟（完型实测 300~1200ms）。
      // 旧实现读一次没读到就再点一次 —— 那一下等于把刚选中的选项又点掉，
      // 表现就是"4、5 两个空来回点"（2026-11-19 用户实测）。
      let got = '';
      for (let t = 0; t < 6; t++) {
        await sleep(220);
        got = blankStateOf(b, q.qid);
        if (!got && optionMarked(b, want)) got = want;
        if (!got && markedOf()) got = want;
        if (got && String(got).toUpperCase().indexOf(want) >= 0) break;
      }

      // 只有"DOM 里也没留下选中标记"才补一次原生 click（元素被遮/坐标偏移时）
      if (String(got).toUpperCase().indexOf(want) < 0 && !optionMarked(b, want) && !markedOf()) {
        try {
          target.click();
        } catch (e) {}
        for (let t = 0; t < 5; t++) {
          await sleep(240);
          got = blankStateOf(b, q.qid);
          if (!got && optionMarked(b, want)) got = want;
          if (!got && markedOf()) got = want;
          if (got && String(got).toUpperCase().indexOf(want) >= 0) break;
        }
      }

      if (String(got).toUpperCase().indexOf(want) >= 0) {
        filled++;
        wrote.push(want);
      }
      await sleep(CXAI.U.randInt(120, 300));
    }
    const miss = blanks.length - filled;
    // 全落盘才算成功：只写进去一半就报 ok，面板会显示"已答"，考生以为交完了
    // （2026-11-18 实测：完型 6 空只落了 4 个，状态却是 ok）。
    return {
      ok: filled > 0 && miss === 0,
      manual: filled < blanks.length,
      // 题目本身残缺（选项只有「选项1..4」）：单独标记，日志里直接说题目有问题
      broken: miss > 0 && placeholder,
      filled: filled,
      total: blanks.length,
      mode: 'group',
      actual: wrote.join(' '),
      error:
        filled === blanks.length
          ? undefined
          : placeholder
            ? '题目有问题：卷子给的选项是占位文本（选项1/选项2…），没有真实选项内容，无法作答（共 ' + blanks.length + ' 个空）'
            : '小题组只落了 ' + filled + '/' + blanks.length + ' 个空（判定答案：' + (text.slice(0, 50) || '空') + '），剩下的请人工核对'
    };
  }

  /* ---------------- 连线 / 匹配 / 排序 ---------------- */

  /** 本题上的下拉框（连线题、匹配题、部分排序题都是 select 形态） */
  function selectList(q) {
    try {
      return Array.from(q.root.querySelectorAll('select')).filter((el) => el && el.isConnected && !el.disabled);
    } catch (e) {
      return [];
    }
  }

  /** 把答案切成"每个下拉框一段"；切不出来就整段复用 */
  function segmentsOf(text, count) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return [];
    const tries = [/\s*\|\|\|\s*/, /\s*\n+\s*/, /\s*[;；]\s*/, /\s*[、,，]\s*/];
    for (const re of tries) {
      const parts = t.split(re).map((s) => s.trim()).filter(Boolean);
      if (parts.length === count) return parts;
    }
    return t
      .split(/\s*\|\|\|\s*|\s*\n+\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 把一段答案塞进一个 select：先按选项文字匹配，再按字母/序号 */
  function setSelectValue(sel, seg) {
    const opts = Array.from(sel.options || []);
    if (!opts.length || !seg) return false;
    const strip = (t) => String(t == null ? '' : t).replace(/^[A-Ha-h\d]{1,2}\s*[、.．)）:：\-]\s*/, '');
    const norm = (t) => CXAI.U.normText(strip(t));
    const want = norm(seg);
    let hit = opts.filter((o) => norm(o.text) === want)[0];
    if (!hit) {
      hit = opts.filter((o) => {
        const ot = norm(o.text);
        return ot && want && (ot.indexOf(want) >= 0 || want.indexOf(ot) >= 0);
      })[0];
    }
    if (!hit) {
      const m = /^([A-Ha-h]|\d{1,2})/.exec(String(seg).trim());
      if (m) {
        const k = m[1].toUpperCase();
        hit = opts.filter((o) => String(o.value || '').toUpperCase() === k || norm(o.text) === k)[0];
        if (!hit && /^\d+$/.test(k)) {
          const idx = Number(k);
          hit = opts[idx] || opts[idx - 1] || null;
        }
      }
    }
    if (!hit || hit.disabled) return false;
    const val = hit.value != null ? hit.value : hit.text;
    try {
      sel.value = val;
      if (sel.selectedIndex < 0) sel.selectedIndex = opts.indexOf(hit);
      fire(sel, 'input');
      fire(sel, 'change');
    } catch (e) {
      return false;
    }
    return String(sel.value) === String(val);
  }

  /**
   * 连线 / 匹配 / 排序落盘。
   * 旧实现把 match 归进文本题型，直接进 answerBlank 找 textarea/input —— 页面上只有 select，
   * 于是永远"未找到输入框"转人工。这里按下拉框写入并回读验收；拖拽形态明确转人工。
   */
  async function answerSelectGrid(q, result, kindLabel) {
    const sels = selectList(q);
    if (!sels.length) {
      return {
        ok: false,
        manual: true,
        mode: kindLabel,
        error: kindLabel + '题在页面上没有下拉框（这是拖拽/点击形态），答案在面板里（双击小球 → 点这道题的题号格），请手动完成'
      };
    }
    const text = String((result && result.answerText) || '');
    const segs = segmentsOf(text, sels.length);
    let filled = 0;
    for (let i = 0; i < sels.length; i++) {
      const seg = segs[i] || (segs.length === 1 ? segs[0] : '');
      if (setSelectValue(sels[i], seg)) filled++;
      await sleep(CXAI.U.randInt(120, 320));
    }
    let got = 0;
    for (const s of sels) if (String(s.value || '').trim()) got++;
    const ok = filled === sels.length && got === sels.length;
    return {
      ok,
      manual: !ok,
      filled,
      total: sels.length,
      mode: kindLabel,
      actual: sels.map((s) => String(s.value || '')).join(','),
      error: ok ? undefined : '只填了 ' + filled + '/' + sels.length + ' 个下拉框（页面读到 ' + got + ' 个），其余请人工补'
    };
  }

  async function apply(q, result) {
    if (!q || !result) return { ok: false, error: '参数缺失' };
    // 落盘前把 collect 的短窗 memo 作废：点击会改选中态/隐藏域，判定链路里缓存的老快照
    // 会让"终验读页面真实答案"读到旧值（2026-11-24）
    try { if (CXAI.Scraper.invalidateCollect) CXAI.Scraper.invalidateCollect(); } catch (e) {}
    const opts = {
      verifyMs: CXAI.Cfg.get('apply.verifyMs', 1100),
      clearExtra: CXAI.Cfg.get('apply.clearExtra', true),
      instant: CXAI.Cfg.get('apply.instantType', false)
    };
    // 全题型兜底：选择题型但页面上一个选项都没抓到时，不要把"没选项"当成"写成功"。
    // 判断题不在此列 —— 它的选项有时藏在 .hoverDiv 里（readOptionElements 抓不到），
    // answerJudgement 会自己去题目容器里找，提前拦下会变成"点了没反应"。
    if ((q.type === 'single' || q.type === 'multiple') && !(q.options || []).length) {
      return {
        ok: false,
        manual: true,
        error: '这题识别成' + (q.typeLabel || '选择题') + '，但页面上没有可点的选项；答案在面板里（双击小球 → 点这道题的题号格），请手动填写'
      };
    }
    // 判断题：一律按「对/错」文字点（隐藏域存 true/false，按字母比永远对不上）
    if (q.type === 'judgement') return await answerJudgement(q, result, opts);
    // 小题组（完型填空 / 阅读理解）：先按"每空一小题"落盘，别掉进下面的文本分支，
    // 那里没有输入框，只会回报"没找到输入框"→ 整题静默丢弃（2026-11-18 实测 Q8/Q9 全空）。
    if (q.group && q.group.length) return await answerGroup(q, result);
    // 连线/匹配/排序：走下拉框写入，拖拽形态明确转人工（此前一律"未找到输入框"）
    if (q.type === 'match' || q.shell === 'match') return await answerSelectGrid(q, result, '连线');
    if (q.type === 'sort') return await answerSelectGrid(q, result, '排序');
    if (q.type === 'completion' || q.type === 'line' || isTextKind(q) || q.options.length === 0) {
      const r = await answerBlank(q, result.answerText, opts);
      // 文本题但页面没有任何输入框（听力/口语/特殊皮肤/富文本未初始化）：
      // 答案照样给出，标注里提示人工填写，不要把整卷当成"落盘失败"卡住。
      if (r && r.error === '未找到输入框') {
        return {
          ok: false,
          manual: true,
          error: '这题在页面上没有可写入的答题框（' + (q.shellLabel || q.typeLabel || '未知题型') + '）；答案在面板里（双击小球 → 点这道题的题号格），请手动填写'
        };
      }
      let freshBlank = q;
      try {
        const l = (CXAI.Scraper.collect() || {}).questions || [];
        freshBlank = CXAI.Scraper.pickSame(l, q) || q;
      } catch (e) {}
      const liveText = (CXAI.Scraper.pageValue(freshBlank) || {}).value || '';
      // 验收口径与小题组一致：所有空都写进去才算 ok。只写一半时报 manual + partial，
      // 让主循环停下来等人补写，而不是在面板上显示"已答"然后翻页走人。
      const total = Number(r && r.total) || 0;
      const filled = Number(r && r.filled) || 0;
      const partial = !!(r && total > 0 && filled < total);
      const okNow = partial ? false : (r && r.ok) || (!total && !!liveText);
      return Object.assign({}, r, {
        actual: liveText,
        ok: !!okNow,
        partial: partial,
        manual: !okNow,
        filled: filled,
        total: total,
        error: okNow
          ? r && r.error
          : '只写进了 ' + filled + '/' + (total || '?') + ' 个空（页面读到：' + (liveText || '空') + '），其余请人工补写'
      });
    }
    if (q.type === 'judgement' && result.keys.length === 0 && q.options.length) {
      // 判断但答案没映射到 key：按文本再试一次
      const mapped = CXAI.AI.resolveAnswerKeys(result.answerText, q);
      if (mapped && mapped.keys.length) result.keys = mapped.keys;
    }
    let r = await answerChoice(q, result.keys, opts);
    if (!r || !r.ok) {
      // 兜底：元素可能已经被页面重绘换掉，按选项文字重新找一遍
      const again = await retryByText(q, result.keys);
      if (again && again.ok) r = again;
    }
    // 最终以页面自己的隐藏域为准（#answer{qid} / answers{qid}），这是"真的落盘了吗"的唯一客观证据。
    // 必须重新抓一遍：重绘后旧引用已经游离，读它只会得到空值（会误报"没落盘"）。
    let freshQ = q;
    try {
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      freshQ = CXAI.Scraper.pickSame(list, q) || q;
    } catch (e) {}
    let live = (CXAI.Scraper.pageValue(freshQ) || {}).value || (r && r.actual) || '';
    // pageValue 已经把隐藏域折算成"页面显示字母"（randomOptions 下服务端 A = 显示 B）。
    // 这里绝不能再折一次：第二次会把显示字母又当服务端键映射一遍，B 变成 C。
    const want = (result.keys || []).join('');
    // 最终验收按"集合相等"：want='AB' 而页面留下 AC 必须判失败。
    // 旧实现只看 live 里有没有第一个字母，配合 retryByText 的"点了几次"式成功判定会漏掉错选项。
    const liveSet = String(live || '')
      .toUpperCase()
      .replace(/[^A-H]/g, '')
      .split('')
      .sort()
      .join('');
    const wantSet = String(want || '')
      .toUpperCase()
      .replace(/[^A-H]/g, '')
      .split('')
      .sort()
      .join('');
    return Object.assign({}, r || {}, {
      actual: live,
      ok: !!(r && r.ok) && !!liveSet && liveSet === wantSet
    });
  }

  /** 单题保存（部分考试页每题都有保存按钮） */
  async function saveOne(q) {
    const SEL = '[onclick*="saveQuestion"], .saveQuestion, [class*="save_btn"], .savebtndiv, [class*="savebtn"]';
    let node = (q.root && q.root.querySelector(SEL)) || null;
    // 全页兜底只在"按本题 qid 精确定位"时允许：否则整卷页面会点到别的题的「保存」
    if (!node && q && q.qid) {
      try {
        node = document.querySelector('[onclick*="saveQuestion(' + q.qid + '"]');
      } catch (e) {}
    }
    // 单题翻页模式：整页只有这一道题，而「保存」按钮常常挂在题目容器**外面**
    //（页面底部工具条 / 右侧操作区）。只按 root + qid 找就会一直报
    //「没找到该题的保存按钮，内容可能会丢」（2026-11-19 实测 #5）。
    if (!node) {
      let onlyOne = false;
      try {
        onlyOne = document.querySelectorAll('.questionLi, .TiMu').length <= 1;
      } catch (e) {}
      if (onlyOne) {
        node = document.querySelector(SEL);
        if (!node) {
          node =
            Array.from(document.querySelectorAll('a, button, span, input[type="button"]')).filter((el) => {
              const t = String(el.textContent || '').trim();
              if (!/^(保存|保存答案|保存作答|保存本题)$/.test(t)) return false;
              return !!(el.offsetParent || el.getClientRects().length);
            })[0] || null;
        }
      }
    }
    if (!node) return false;
    // 命中的常常是外层容器（超星整卷预览是 <div class="savebtndiv"><a onclick="saveQuestion(...)">保存</a></div>），
    // 直接点容器不会触发内部按钮的行为 —— 早先就是这样"点了但没保存"。这里往下找真正可点的那个。
    if (!node.hasAttribute('onclick') && !/^(A|BUTTON|INPUT)$/i.test(node.tagName)) {
      const inner = node.querySelector('[onclick], a, button, input[type="button"], input[type="submit"]');
      if (inner) node = inner;
    }
    await clickOnce(node);
    await sleep(CXAI.U.randInt(200, 500));
    return true;
  }

  /** 整卷提交按钮（默认只找不点，交给人工确认） */
  function findSubmitButton() {
    const patterns = [/交卷/, /提交试卷/, /提交答案/, /^提交$/];
    const nodes = Array.from(document.querySelectorAll('a,button,div,span')).filter((el) => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      if (t.length > 12) return false;
      return patterns.some((p) => p.test(t));
    });
    return nodes[0] || null;
  }

  return { humanClick, clickOnce, settle, apply, answerChoice, answerBlank, answerJudgement, judgeSide, clickOne, isChecked, stateSig, saveOne, findSubmitButton, typeInto, fire };
})();

/* ==================== 06-guard.js ==================== */
/* ---------------- 环境伪装与节流 ----------------
 * 考试页的常见干扰：
 *   1) 切屏 / 失焦检测（visibilitychange、blur、document.hidden）
 *   2) 定时弹窗确认（"是否继续作答"）
 *   3) 频率检测（同一秒内多点、等间隔点击）
 * 本模块按配置逐项处理，并给主循环提供"像人"的节奏。
 */

CXAI.Guard = (function () {
  let installed = false;
  let alertTimer = null;
  const patched = [];

  /**
   * 伪装成原生函数：页面一行 `Function.prototype.toString` 就能识破重写过的
   * document.hasFocus / confirm / 属性 getter，这里统一把 toString 换成原生样式。
   */
  function maskNative(fn, nativeText) {
    try {
      const text = nativeText || 'function native() { [native code] }';
      Object.defineProperty(fn, 'toString', { value: () => text, configurable: true, writable: true });
    } catch (e) {}
    return fn;
  }

  function on(obj, prop, value) {
    try {
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      const getter = maskNative(
        function () {
          return typeof value === 'function' ? value() : value;
        },
        'function get ' + prop + '() { [native code] }'
      );
      Object.defineProperty(obj, prop, {
        configurable: true,
        get: getter,
        set() {}
      });
      patched.push(() => {
        try {
          if (desc) Object.defineProperty(obj, prop, desc);
          else delete obj[prop];
        } catch (e) {}
      });
    } catch (e) {}
  }

  /* ---------- 1. 前台伪装 ---------- */

  function patchVisibility() {
    on(document, 'hidden', false);
    on(document, 'visibilityState', 'visible');
    try {
      document.hasFocus = maskNative(function () {
        return true;
      }, 'function hasFocus() { [native code] }');
    } catch (e) {}
    // 吞掉可见性/失焦事件，避免上报"切屏次数"
    const killer = (e) => {
      if (e.type === 'visibilitychange' || e.type === 'blur' || e.type === 'pagehide' || e.type === 'freeze') {
        e.stopImmediatePropagation();
        e.stopPropagation();
      }
    };
    ['visibilitychange', 'blur', 'pagehide', 'freeze', 'webkitvisibilitychange'].forEach((t) => {
      window.addEventListener(t, killer, true);
      document.addEventListener(t, killer, true);
    });
    window.addEventListener('focus', () => {}, true);
  }

  /* ---------- 2. 防调试噪音 ---------- */

  function patchDebugger() {
    if (!CXAI.Cfg.get('guard.blockDevtools', true)) return;
    // 屏蔽极高频率的 debugger 陷阱（只处理 setInterval/setTimeout 里的函数体）
    const rawSetInterval = window.setInterval;
    window.setInterval = maskNative(function (fn, ms) {
      if (typeof fn === 'function' && /debugger/.test(fn.toString())) return 0;
      return rawSetInterval.apply(window, arguments);
    }, 'function setInterval() { [native code] }');
    // 关掉右键/复制限制这类常见的小动作（会挡住自己的 UI）
    document.addEventListener(
      'contextmenu',
      (e) => {
        e.stopImmediatePropagation();
      },
      true
    );
  }

  /* ---------- 3. 弹窗自动确认 ---------- */

  /**
   * 弹窗处理：**不抢在用户前面点**。
   *
   * 有些弹窗里是可能要看的信息（提交确认、分数提示、是否继续作答……），立刻点掉
   * 等于把有用的东西一起关掉。所以改成：
   *   1) 弹窗出现只记时间，谁都不点；
   *   2) 等够 `guard.dialogDelaySec` 秒（默认 10，可在设置里改；0 = 永不自动点）；
   *   3) 期间你自己关掉了 → 元素消失，什么都不做；
   *   4) 一直没关才点一下，并记一条日志。
   * 交卷 / 提交试卷类按钮永远不在名单里。
   */
  const seen = new WeakMap();

  function dismissDialogs() {
    let clicked = 0;
    const delaySec = Number(CXAI.Cfg.get('guard.dialogDelaySec', 10));
    if (!(delaySec > 0)) {
      // 0 = 只手动关，连计时都不做
      return 0;
    }
    // 只认"弹窗容器里的按钮 + 文本精确匹配"：旧实现把页面上任何 button/a 上写着
    // 「确定/继续」的可见元素都算弹窗，10 秒后会误点保存确认、继续跳页这类真实操作。
    const killers = [/^继续作答$/, /^继续考试$/, /^离开$/, /^确定$/, /^知道了$/, /^继续$/];
    const nodes = Array.from(
      document.querySelectorAll(
        '.layui-layer-btn a, .dialog-btn, .popup-btn, [class*="confirm"] a, [class*="confirm"] button, [role="dialog"] button, [role="dialog"] a'
      )
    );
    const now = Date.now();
    const visible = (el) => {
      // 不能用 offsetParent 判可见：fixed 定位的弹窗（超星大量使用）offsetParent 恒为 null，
      // 会被误判成"不可见"而永远不关。getClientRects 对 fixed 也有效。
      try {
        if (el.getClientRects && el.getClientRects().length > 0) return true;
      } catch (e) {}
      return !!el.offsetParent;
    };
    for (const el of nodes) {
      if (!visible(el)) {
        seen.delete(el);
        continue;
      }
      const t = (el.textContent || '').trim();
      if (!t || t.length > 10) continue;
      if (!killers.some((p) => p.test(t))) continue;
      // 交卷 / 提交试卷类按钮，任何时候都不自动点
      if (/交卷|提交试卷|确定提交|结束考试/.test(t)) continue;
      const first = seen.get(el);
      if (!first) {
        seen.set(el, now);
        CXAI.Log.info('发现弹窗「' + t + '」，' + delaySec + ' 秒内你不关我再自动关');
        continue;
      }
      if (now - first < delaySec * 1000) continue;
      try {
        el.click();
        clicked++;
        CXAI.Log.warn('弹窗「' + t + '」已 ' + delaySec + ' 秒未处理，自动关闭');
      } catch (e) {}
      seen.delete(el);
    }
    return clicked;
  }

  function startAlertWatcher() {
    if (alertTimer) return;
    alertTimer = setInterval(() => {
      try {
        dismissDialogs();
      } catch (e) {}
    }, 1500);
  }

  /* ---------- 4. 原生 confirm / alert 接管 ---------- */

  function patchNativeDialog() {
    if (!CXAI.Cfg.get('guard.autoConfirm', true)) return;
    try {
      const rawConfirm = window.confirm.bind(window);
      window.confirm = maskNative(function (msg) {
        const text = String(msg == null ? '' : msg);
        // 交卷 / 提交试卷这类确认，脚本自己没在跑自动交卷时**不要替用户点掉**：
        // 该看到的提示要能看到（用户明确提过"有些弹窗可能是我们需要的"）。
        const risky = /交卷|提交试卷|提交答案|结束考试|确认提交/.test(text);
        const auto = CXAI.Cfg.get('apply.autoSubmit', false) || CXAI.Cfg.get('apply.submit', false);
        if (risky && !auto) {
          CXAI.Log.warn('这是交卷确认，交给你自己点：' + text.slice(0, 80));
          try {
            return rawConfirm(msg);
          } catch (e) {
            return false;
          }
        }
        CXAI.Log.warn('已自动确认 confirm：' + text.slice(0, 80));
        return true;
      }, 'function confirm() { [native code] }');
      window.alert = maskNative(function (msg) {
        CXAI.Log.info('已吞掉 alert：' + String(msg).slice(0, 80));
      }, 'function alert() { [native code] }');
    } catch (e) {}
  }

  /* ---------- 5. 节奏控制 ---------- */

  /**
   * 下一题之前的等待时间。人工答题不会匀速，这里用
   * "基础间隔 × 抖动 + 概率性长停顿" 模拟。
   */
  function pace(index) {
    const min = CXAI.Cfg.get('guard.minDelay', 1400);
    const max = CXAI.Cfg.get('guard.maxDelay', 4200);
    let wait = CXAI.U.randInt(min, max);
    // 每 5~8 题插入一次较长停顿（喝水、抬头）
    const every = CXAI.Cfg.get('guard.longBreakEvery', 6);
    if (every > 0 && index > 0 && index % every === 0) {
      wait += CXAI.U.randInt(4000, 9000);
      CXAI.Log.info(`第 ${index} 题后长停顿 ${Math.round(wait / 1000)}s`);
    }
    // 偶发 3% 概率的额外犹豫
    if (Math.random() < 0.03) wait += CXAI.U.randInt(3000, 7000);
    return wait;
  }

  /* ---------- 对外 ---------- */

  function install() {
    if (installed) return;
    installed = true;
    if (CXAI.Cfg.get('guard.enabled', true)) {
      patchVisibility();
      patchDebugger();
      patchNativeDialog();
      startAlertWatcher();
      CXAI.Log.ok('环境伪装已启用（前台保持 / 弹窗自动确认 / 节奏抖动）');
    } else {
      CXAI.Log.warn('环境伪装未启用');
    }
  }

  function uninstall() {
    patched.forEach((fn) => fn());
    patched.length = 0;
    if (alertTimer) clearInterval(alertTimer);
    alertTimer = null;
    installed = false;
  }

  return { install, uninstall, pace, dismissDialogs, installed: () => installed };
})();

/* ==================== 07-ui.js ==================== */
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
    // 位置不记忆（2026-11-24）：每次进页球都回到默认右下角（答案条上方），
    // 用户本次页面内可以拖动，换页/刷新自动复位。
    try {
      const m = CXAI.Store.get('ballMode', '');
      if (m === 'auto' || m === 'single') state.mode = m;
    } catch (e) {}
    placePanel();

    // 窗口尺寸变化后把球拉回视口内
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
          }
          placePanel(c.left);
          try { syncBallToCorner(); } catch (e2) {}
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
      // 球与答案条锁定：拖球时答案条跟着吸附到球正下方
      try { syncCornerToBall(); } catch (err) {}
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
      // 位置不记忆：只在本页内生效，换页/刷新自动复位（2026-11-24）
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

  /**
   * 球与答案条锁定（2026-11-24）：两个元素相对位置恒定 —— 球始终在答案条正上方 10px、
   * 右边缘对齐。拖谁两个一起走；进页复位到默认右下角（答案条 right/bottom 12px，位置不记忆）。
   * 答案条隐藏时球回落到 CSS 默认位（右下角）。
   */
  function syncBallToCorner() {
    try {
      const box = $('#anscorner');
      const wrapEl = root && root.querySelector('.wrap');
      if (!box || !wrapEl) return;
      if (box.style.display === 'none') {
        // 隐藏时球回默认位：清掉 JS 位移，走 .wrap 的 right/bottom CSS
        wrapEl.style.left = '';
        wrapEl.style.top = '';
        wrapEl.style.right = '';
        wrapEl.style.bottom = '';
        return;
      }
      const c = box.getBoundingClientRect();
      if (!c.width) return;
      const b = wrapEl.getBoundingClientRect();
      wrapEl.style.left = Math.max(4, Math.round(c.right - b.width)) + 'px';
      wrapEl.style.top = Math.max(4, Math.round(c.top - b.height - 10)) + 'px';
      wrapEl.style.right = 'auto';
      wrapEl.style.bottom = 'auto';
    } catch (e) {}
  }

  /** 反向：以球为锚，把答案条吸附到球正下方 10px、右边缘对齐（拖球时用） */
  function syncCornerToBall() {
    try {
      const box = $('#anscorner');
      const wrapEl = root && root.querySelector('.wrap');
      if (!box || !wrapEl || box.style.display === 'none') return;
      const b = wrapEl.getBoundingClientRect();
      const c = box.getBoundingClientRect();
      if (!b.width || !c.width) return;
      box.style.left = Math.max(4, Math.round(b.right - c.width)) + 'px';
      box.style.top = Math.max(4, Math.round(b.bottom + 10)) + 'px';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
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
    syncBallToCorner();
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
    const show = CXAI.Cfg.get('ui.answerCorner', false) === true && !cornerHidden();
    box.style.display = show ? 'flex' : 'none';
    if (!show) return;
    try {
      if (CXAI.Store.get('ansCornerFold', false)) box.classList.add('folded');
    } catch (e) {}
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
   * 隐藏：长按 CX 球下滑（toggleCorner，状态持久化 ansCornerHidden）；
   * 拖动：按住答案条头部拖（移动超过 8px 算拖动，否则还是"点击折叠"）。
   * 位置不持久化：本页内自由拖，换考试页自动复位到右下角默认位（2026-11-24）。
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

  /** 答案条头部拖动：按住 .hd 拖走整条；没超过 8px 的按下抬起 = 折叠/展开 */
  function setupCornerDrag() {
    const box = $('#anscorner');
    const hd = box ? box.querySelector('.hd') : null;
    const wrapEl = root ? root.querySelector('.wrap') : null;
    if (!box || !hd || hd._cxaiDrag) return;
    hd._cxaiDrag = true;
    let drag = null;
    hd.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = box.getBoundingClientRect();
      const wr = wrapEl ? wrapEl.getBoundingClientRect() : null;
      // 拖答案条时记录球相对答案条的偏移：两个锁死，一起走
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false,
        ballDx: wr ? wr.left - r.left : 0, ballDy: wr ? wr.top - r.top : 0 };
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
      if (wrapEl) {
        wrapEl.style.right = 'auto';
        wrapEl.style.bottom = 'auto';
        wrapEl.style.left = Math.round(drag.ox + dx + drag.ballDx) + 'px';
        wrapEl.style.top = Math.round(drag.oy + dy + drag.ballDy) + 'px';
      }
      e.preventDefault();
    });
    const done = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      try { hd.releasePointerCapture(e.pointerId); } catch (err) {}
      if (d.moved) {
        // 位置不落盘：本页内自由拖，换考试页自动复位（球已经跟着一起走了）
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

/* ==================== 08-main.js ==================== */
/* ---------------- 主编排引擎 ----------------
 * 两种页面形态：
 *   whole   整卷渲染（所有 .questionLi 同时在 DOM 里）→ 顺序遍历
 *   single  单题模式（一次只渲染一题）→ 答完点"下一题"循环
 * 判题靠 CXAI.AI.solve（多重 AI），落盘靠 CXAI.Apply。
 */

CXAI.Engine = (function () {
  const st = {
    running: false,
    paused: false,
    haltReason: '',
    stopped: false,
    cursor: 0,
    // 本页临时判定结果（只活在内存里，进页/换页即失效）——见 memoGet/memoSet
    memo: new Map(),
    results: [],
    skipped: 0,
    failed: 0,
    startedAt: 0,
    // 单题模式是整页导航（getTheNextQuestion → submitForm → location.href），
    // 每翻一页脚本内存就清零一次。已答题数必须从会话存储里累加，否则面板永远显示 0。
    baseDone: 0,
    // 跨页记录每道题被处理过几次：来回弹（比如误点"上一题"）靠它兜底
    visited: {},
    // 题量（页面右上"题量: N"）。单题模式下页面只有一个题块，不能拿 .questionLi 数当题量
    total: 0,
    // 这一程是否已经尝试切到"整卷预览"（防来回跳）
    previewTried: false,
    // 预取状态
    prefetching: false,
    prefetchPromise: null,
    // 切整卷预览 = 主动把活交接给下一页，finally 不能把 running 标记清掉，
    // 否则新页面 boot 读不到"上次还在跑"，就再也不会自动开始（用户实测的问题）
    handoff: false
  };

  function sleep(...a) {
    return CXAI.U.sleep(...a);
  }

  /* ---------------- 会话断点（页面刷新后能接着答） ---------------- */

  const SESSION_KEY = 'session';

  function saveSession(running) {
    try {
      CXAI.Store.set(SESSION_KEY, {
        running: running !== false && st.running,
        startedAt: st.startedAt,
        done: appliedCount() + st.skipped,
        failed: st.failed,
        visited: st.visited || {},
        previewTried: st.previewTried || false,
        url: location.href,
        at: Date.now()
      });
    } catch (e) {}
  }

  function assertAlive() {
    if (st.stopped) throw new Error('__STOPPED__');
    return true;
  }

  /** 暂停点：在每题开始前等待恢复 */
  async function waitIfPaused() {
    while (st.paused && !st.stopped) await sleep(300);
    assertAlive();
  }

  /** 面板清单的行主键：qid 优先，否则用题干+选项+图片指纹（同题干不同题不再合并成一行） */
  function rowKeyOf(q) {
    if (q.qid) return 'qid:' + q.qid;
    const opts = (q.options || []).map((o) => CXAI.U.normText(o.text || '')).join('|');
    const imgs = (q.images || []).map((u) => String(u).slice(0, 24)).join(',');
    const raw = [CXAI.U.normText(q.stem || '').slice(0, 60), opts, imgs].filter(Boolean).join('|');
    return 'stem:' + (raw || 'i' + (Number(q.index) || 0));
  }

  /* ---------------- 单题处理 ---------------- */

  /** 落盘前重新从页面取一次题目：单题模式页面会在判题期间重绘，旧元素引用会失效 */
  function relive(q) {
    try {
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      const hit = CXAI.Scraper.pickSame(list, q);
      if (!hit) return q;
      // 小题组（完型/阅读/共用选项）根级 options 本来就是空的，旧判断会把它们当成
      // "没抓到题"而继续用过期快照：进页面时 .hoverDiv 还没渲染，group=0 一路传到判题，
      // 于是 prompt 里既没选项也没小题题干，模型只能回段落（2026-11-19 实测 #8/#9）。
      const hasOpts = (hit.options && hit.options.length) || (hit.group && hit.group.length);
      if (!hasOpts) return q;
      hit.index = q.index;
      return hit;
    } catch (e) {
      return q;
    }
  }

  /**
   * 页面已有答案是否与判定结果一致。
   * 选择题比字母集合（判断题的 true/false 已由 pageValue 折成字母）；
   * 文本题比归一化后的包含关系（页面可能只截取/多写了前后缀）。
   */
  function sameAnswer(q, result, live) {
    if (!result) return false;
    const norm = (v) => CXAI.U.normText(String(v == null ? '' : v).replace(/<[^>]+>/g, ' '));
    const textType = q.type === 'completion' || (CXAI.AI.isTextType && CXAI.AI.isTextType(q));
    if (textType) {
      const a = norm(result.answerText);
      const b = norm(live);
      return !!a && !!b && (b.indexOf(a) >= 0 || a.indexOf(b) >= 0);
    }
    const keys =
      result.keys && result.keys.length
        ? result.keys
        : ((CXAI.AI.resolveAnswerKeys(result.answerText, q) || {}).keys || []);
    const ai = keys.join('');
    return !!ai && ai.split('').sort().join('') === String(live).split('').sort().join('');
  }

  /**
   * 加密字体（font-cxsecret）：先把密文还原，再重新抓一次题。
   * 之前 02-font 只在模块里导出、主链路从未调用，于是密文（私用区字符）原样送模型。
   */
  async function decryptIfNeeded(q) {
    try {
      if (!CXAI.Font || !CXAI.Font.hasSecret || !CXAI.Font.hasSecret(document)) return q;
      await CXAI.Font.ensure(document);
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      let hit = CXAI.Scraper.pickSame(list, q);
      // 解密后题干/选项文字全变了，pickSame 可能认不回来：按位置兜底（collect 的 index 是顺序号）
      if (!hit && isFinite(Number(q.index)) && list[Number(q.index)] && list[Number(q.index)].index === Number(q.index)) {
        hit = list[Number(q.index)];
      }
      if (hit) {
        hit.index = q.index;
        hit.no = q.no;
        return hit;
      }
    } catch (e) {
      CXAI.Log.warn('字形解密失败，按原文判题：' + (e && e.message ? e.message : e));
    }
    return q;
  }

  /** 把一道题的结论写进面板清单（跨页持久化），同时读回页面真实选中态做对比 */
  function recordQ(q, result, applied, status) {
    try {
      // 展示口径：多空/小题组统一成 A|||B（pageValue 只读第一空，会显示成「风」）
      const live =
        (CXAI.Scraper.answerView ? CXAI.Scraper.answerView(q) : '') ||
        (CXAI.Scraper.pageValue(q) || {}).value ||
        '';
      CXAI.UI.pushQuestion({
        index: q.no || (Number(q.index) || 0) + 1,
        qid: q.qid || '',
        type: q.type || '',
        typeLabel: q.typeLabel || '',
        stem: CXAI.U.truncate(q.stem || '', 240),
        options: (q.options || []).slice(0, 10).map((o) => ({ k: o.key, t: CXAI.U.truncate(o.text || '', 60), a: !!o.answered })),
        answer: result && result.answerText ? String(result.answerText) : '',
        actual: live,
        stage: result && result.stage ? result.stage : '',
        confidence: result && result.confidence != null ? result.confidence : null,
        // 详情面板要能说清"为什么是这个答案"：依据 / 各模型投票 / 兜底降级原因
        reason: result && result.reason ? String(result.reason).slice(0, 240) : '',
        votes: result && result.votes ? result.votes.slice(0, 6) : [],
        errors: result && result.errors ? result.errors.slice(-3) : [],
        shellLabel: q.shellLabel || '',
        confidenceLow: !!(result && result.lowConfidence),
        status: status,
        // 用题号（qid）或"题干+选项"指纹当主键：同一道题翻回来还是同一行，不会堆成两条
        key: rowKeyOf(q)
      });
    } catch (e) {}
  }

  /* ---------------- 判定结果的临时缓存（只活在本页内存） ----------------
   * 2026-11-19 用户要求：不要再缓存"之前查过的题目"的答案。
   *
   * 旧实现在 Store 里落了一份按「题干+选项+图片指纹」索引的 answers 表（上限 400 条），
   * 跨页、跨场、跨天都复用，直接引出两个真机事故：
   *   ① 面板日志「#2 用已缓存的判定 B」→ 后面紧跟「只落了 0/1 个空」：
   *      套上去的是上一次（甚至另一道题）的旧结论，页面结构一变就写不进去；
   *   ② 题面文字相近的另一道题命中同一条，答案整道错位。
   *
   * 现在只保留内存 Map：
   *   · 进页 / 每次开跑都清空（resetMemo）
   *   · 预取（同一页、同一场）仍然复用，点小球几乎不用等模型
   *   · 绝不跨页、跨场、跨天复用旧答案
   */

  /** 缓存主键 = 面板行主键（qid 优先，否则题干+选项+图片指纹） */
  function memoKey(q) {
    return rowKeyOf(q);
  }

  /**
   * 小题组的缓存答案是否"不可用"：当时抓取坏了（group=0），prompt 里没选项没题干，
   * 模型只能回一段散文。这种结果必须作废重判，否则每次都会"命中上次判定"复读同一段话
   * （2026-11-19 实测第 9 题：连续几轮报错内容一字不差）。
   */
  function groupAnswerUnusable(q, r) {
    if (!q || !q.group || !q.group.length || !r) return false;
    const txt = String(r.answerText || '');
    if (!txt) return false;
    const segs = txt.split(/\s*\|\|\|\s*/).map((x) => x.trim()).filter(Boolean);
    const letters = segs.filter((x) => /^[A-Ha-h]{1,4}$/.test(x)).length;
    // 没字母（散文）或字母段数少于空数（2 个空只回 1 个）都算不可用
    return letters === 0 || letters < q.group.length;
  }

  function memoGet(q) {
    try {
      if (!st.memo) return null;
      const hit = st.memo.get(memoKey(q));
      if (!hit || !hit.answerText) return null;
      if (groupAnswerUnusable(q, hit)) {
        st.memo.delete(memoKey(q));
        CXAI.Log.warn(`#${q.no || ''} 本页缓存的答案对不上小题组格式，作废重判`);
        return null;
      }
      return Object.assign({}, hit, { stage: 'prefetched' });
    } catch (e) {
      return null;
    }
  }

  function memoSet(q, result) {
    try {
      if (!st.memo) st.memo = new Map();
      st.memo.set(memoKey(q), result);
    } catch (e) {}
  }

  function resetMemo() {
    try {
      if (st.memo) st.memo.clear();
      else st.memo = new Map();
    } catch (e) {
      st.memo = new Map();
    }
  }

  /** 题干自带答案（本题选AB / 答案：B）就直接用，别让模型把明写的答案改掉 */
  function stemResult(q) {
    const keys = CXAI.Scraper.stemAnswerKeys ? CXAI.Scraper.stemAnswerKeys(q.stem, q.options) : [];
    if (!keys.length) return null;
    return {
      keys: keys.slice(),
      answerText: keys.join(''),
      confidence: 1,
      ratio: 1,
      stage: 'stem',
      votes: [],
      reason: '题干自带答案'
    };
  }

  /**
   * 落盘 + 重试（答一题 / 自动连答共用同一条路）。
   *
   * 超星的题块会被页面自己重绘（换题、点击回调、保存回调都会），第一次拿到的元素引用
   * 可能已经游离，写进去没反应。这里失败就 relive() 重新抓一次题再写。
   * manual（页面根本没有可写位置）/ broken（题目残缺）不重试 —— 重试也写不进去。
   */
  async function applyWithRetry(q, result) {
    const retries = Math.max(0, Number(CXAI.Cfg.get('apply.retries', 2)) || 0);
    let applied = { ok: false, error: '未执行' };
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) {
        CXAI.Log.warn(`#${q.no || ''} 页面元素可能已重绘，重新取一次再落盘（第 ${attempt}/${retries} 次）`);
        await sleep(CXAI.U.randInt(350, 700));
      }
      applied = await CXAI.Apply.apply(attempt === 0 ? q : relive(q), result);
      // 落盘会改动页面的选中态/隐藏域：collect 的 250ms memo 失效，保证下一次读取是新鲜快照
      try { CXAI.Scraper.invalidateCollect(); } catch (e) {}
      if (applied && applied.ok) return applied;
      if (applied && (applied.broken || (applied.manual && !applied.partial))) return applied;
    }
    return applied;
  }

  async function handleQuestion(q, pageKind) {
    const overwrite = CXAI.Cfg.get('apply.overwriteAnswered', false);
    // 仅显示答案（ui.showOnly，默认开）：判题照常，但绝不点击/落盘/翻页，答案只进面板与右下角答案条
    const showOnly = CXAI.Cfg.get('ui.showOnly', true) === true;
    // 加密字体：等解密完成再读题，否则题干/选项是私用区乱码
    q = await decryptIfNeeded(q);
    try {
      if (CXAI.Mark) CXAI.Mark.pending(q);
    } catch (e) {}
    const no = q.no || (Number(q.index) || 0) + 1;
    // 对比用"可读视图"：小题组 pageValue 是整串 UUID JSON，拿它和 B|||C 比永远不相等，
    // 于是 fixWrong 每轮都判"不一致 → 重做"，把已经答对的题又改一遍（2026-11-19 第 9 题）。
    const liveBefore =
      (CXAI.Scraper.answerView ? CXAI.Scraper.answerView(q) : '') ||
      (CXAI.Scraper.pageValue(q) || {}).value ||
      '';

    // 仅显示答案模式：判出答案就进面板/答案条，落盘、纠错、跳过逻辑全部跳过。
    // 页面已答与否只影响展示标签，不影响"要不要判"。
    if (showOnly) {
      let res = stemResult(q) || memoGet(q);
      if (!res) {
        CXAI.Log.info(`#${no} 判定中 · ${q.typeLabel} · ${CXAI.U.truncate(q.stem, 40)}`);
        try {
          res = await CXAI.AI.solve(q);
          memoSet(q, res);
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          st.failed++;
          CXAI.Log.error(`#${no} 判定失败：${msg}`);
          try { if (CXAI.Mark) CXAI.Mark.failed(q, msg, null); } catch (e2) {}
          recordQ(q, { answerText: '', reason: msg }, { ok: false, error: msg }, 'fail');
          CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
          return { q, failed: true };
        }
      }
      CXAI.Log.ok(`#${no} 答案 ${CXAI.U.escapeHtml(res.answerText || '')}（仅显示，不落盘）`);
      const rec = { index: q.index, no, qid: q.qid, type: q.type, stem: CXAI.U.truncate(q.stem, 80), result: res, applied: { ok: false, showOnly: true } };
      st.results.push(rec);
      recordQ(q, res, { ok: false, showOnly: true }, q.answered ? 'skip' : 'answer');
      CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
      return rec;
    }

    // 页面已经答过、又不想覆盖时：答对了就跳过，答错了才重做（apply.fixWrong 默认开）。
    // 关键：如果此刻还没有判定结果，必须**先判题再用判题结果比对** ——
    // 旧实现在 result 为空时直接往下走并重写，等于把页面上已经答对的题也覆盖掉。
    const fixWrong = CXAI.Cfg.get('apply.fixWrong', true);

    let result = null;
    const sr = stemResult(q);
    if (sr) {
      result = sr;
      CXAI.Log.info(`#${no} 题干自带答案 ${sr.answerText}，直接采用`);
    } else if (!overwrite) {
      // 只认本页内存里的预取结果；跨页/跨场的旧结论一律不再复用（2026-11-19 用户要求）
      const pre = memoGet(q);
      if (pre) {
        result = pre;
        CXAI.Log.info(`#${no} 用本页预取好的判定 ${pre.answerText}`);
      }
    }

    if (q.answered && !overwrite) {
      const skipIt = (why) => {
        st.skipped++;
        CXAI.Log.info(`#${no} ${why}（页面：${liveBefore || '-'}），跳过`);
        try {
          if (CXAI.Mark) CXAI.Mark.existing(q, liveBefore);
        } catch (e) {}
        recordQ(q, result, { ok: true }, 'skip');
        CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
        saveSession(true);
        return { q, skipped: true };
      };
      if (result && sameAnswer(q, result, liveBefore)) return skipIt('已答且与判定一致');
      if (!fixWrong) return skipIt('已答');
      if (result) CXAI.Log.warn(`#${no} 页面答案是 ${liveBefore}，与判定 ${result.answerText} 不一致，重做这题`);
      // result 为空：先判题，判完在下面对比（不在这里重写）
    }

    if (!result) {
      CXAI.Log.info(`#${no} 判定中 · ${q.typeLabel} · ${CXAI.U.truncate(q.stem, 40)}`);
      try {
        result = await CXAI.AI.solve(q);
        memoSet(q, result);
      } catch (e) {
        // 全题型兜底也失败了（例如附件题缺读图模型）：这题标红、继续走下一题，
        // 不要整卷停在这里（旧行为是抛到外层，整卷只留下一条"处理异常"）。
        st.failed++;
        const msg = e && e.message ? e.message : String(e);
        CXAI.Log.error(`#${no} 判定失败：${msg}`);
        try {
          if (CXAI.Mark) CXAI.Mark.failed(q, msg, null);
        } catch (e2) {}
        recordQ(q, { answerText: '', reason: msg }, { ok: false, error: msg }, 'fail');
        CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
        saveSession(true);
        return { q, failed: true };
      }
    }

    // 判完再和页面答案比：一致就不要再写一遍（fixWrong 只纠正错误答案）
    if (q.answered && !overwrite && fixWrong) {
      const liveNow =
        (CXAI.Scraper.answerView ? CXAI.Scraper.answerView(q) : '') ||
        (CXAI.Scraper.pageValue(q) || {}).value ||
        liveBefore;
      if (sameAnswer(q, result, liveNow)) {
        st.skipped++;
        CXAI.Log.info(`#${no} 判定结果与页面答案一致（${liveNow || '-'}），不重写`);
        try {
          if (CXAI.Mark) CXAI.Mark.existing(q, liveNow);
        } catch (e) {}
        recordQ(q, result, { ok: true }, 'skip');
        CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
        saveSession(true);
        return { q, skipped: true };
      }
    }

    /**
     * 小题组的字母答案是可机械验证的：每个空都能对应到页面上的真实选项，
     * 不像散文答案那样无法核对。这里只要字母齐全就允许落盘，
     * 否则单模型（少一票导致 confidence 只有 20%）会把整题白白留空。
     */
    function groupLettersComplete(qq, rr) {
      if (!qq || !qq.group || !qq.group.length || !rr) return false;
      const segs = String(rr.answerText || '')
        .split(/\s*\|\|\|\s*/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (segs.length < qq.group.length) return false;
      return segs.slice(0, qq.group.length).every((x) => /^[A-Ha-h]{1,4}$/.test(x));
    }

    // 低置信度 / 本地兜底（stage=heuristic，按首选项猜）不自动落盘：
    // 猜出来的答案写上去比空着更危险，README 承诺的是"标黄复核"。
    // 需要"宁可写错也别空着"的人可以在设置里打开 apply.allowGuess。
    if (result && result.lowConfidence && !CXAI.Cfg.get('apply.allowGuess', false) && !groupLettersComplete(q, result)) {
      st.failed++;
      CXAI.Log.warn(`#${no} 置信度不足（${Math.round((result.confidence || 0) * 100)}%），不自动写入；答案在面板里，请人工确认`);
      try {
        if (CXAI.Mark) CXAI.Mark.failed(q, '置信度不足，需人工确认', result);
      } catch (e) {}
      recordQ(q, result, { ok: false, manual: true, error: '低置信度' }, 'manual');
      CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
      saveSession(true);
      return { q, manual: true };
    }

    await waitIfPaused();
    const applied = await applyWithRetry(q, result);
    const live =
      (CXAI.Scraper.answerView ? CXAI.Scraper.answerView(q) : '') ||
      (CXAI.Scraper.pageValue(q) || {}).value ||
      applied.actual ||
      '';
    if (!applied.ok) {
      st.failed++;
      if (applied.broken) {
        // 题目本身残缺（例如选项只有「选项1..4」）：直接说题目有问题，不要让人去手写
        CXAI.Log.warn(`#${no} 跳过：${applied.error || '题目数据异常'}`);
      } else if (applied.manual) {
        CXAI.Log.warn(`#${no} 需人工填写：${applied.error || '页面没有可写入的位置'}（AI 答案 ${result.answerText}）`);
      } else {
        CXAI.Log.error(`#${no} 写入失败：${applied.error || '未知'}（答案 ${result.answerText}｜页面 ${live || '空'}）`);
      }
      if (applied.dom) CXAI.Log.warn(`选项结构：${applied.dom}`);
      if ((!applied.manual || applied.partial) && CXAI.Cfg.get('apply.stopOnFail', true)) {
        st.haltReason = applied.partial ? '只写了一部分' : '写入失败';
        st.paused = true;
        CXAI.Log.warn(
          applied.partial
            ? '已暂停：这题只写进去一部分（' + applied.filled + '/' + applied.total + '），剩下请手动画好再点「继续」'
            : '已暂停：这题没写进去，继续翻页会漏题。手动选好后在面板点「继续」'
        );
      }
    } else {
      CXAI.Log.ok(
        `#${no} 已填 ${CXAI.U.escapeHtml(result.answerText)} · 页面 ${live || '?'} · ${Math.round((result.confidence || 0) * 100)}% · ${result.stage}`
      );
      if (applied.partial) {
        CXAI.Log.warn(`#${no} 只写进了 ${applied.filled}/${applied.total} 个空，剩余请人工核对`);
      }
    }

    // 落盘策略：整卷预览 / 章节测验里每道填空·简答都有自己的「保存」按钮，
    // 不点的话内容会在失焦或页面重绘时被清掉，超星还会拦住"继续填下一题"。
    // 所以这类题在整卷场景下一律自动点保存；其余情况仍按 apply.saveEach 走。
    const wholePage = (function () {
      try {
        return document.querySelectorAll('.questionLi, .TiMu').length > 1;
      } catch (e) {
        return false;
      }
    })();
    // 判断依据放宽到"有没有输入框"：填空/简答靠 input/textarea/iframe 承载答案，
    // 而题型映射在不同皮肤上不一定可靠（有的页面 type 值不同）。整卷里有输入框就落一次盘。
    const hasInput = !!(q.inputs && q.inputs.some(function (el) {
      return el && el.isConnected;
    }));
    const blankLike =
      hasInput || q.type === 'completion' || /填空|简答|论述|名词解释|计算题/.test(String(q.typeLabel || ''));
    // 填空/简答一律点一次本题的「保存」：单题页每题也都有自己的保存按钮，
    // 旧实现只在整卷（questionLi>1）时才点，单题模式填完就直接翻页 —— 内容会丢
    //（2026-11-19 用户实测：第 3 题填完 风|||雅|||颂，保存按钮始终没被点）。
    if (CXAI.Cfg.get('apply.saveEach', false) || blankLike) {
      const saved = await CXAI.Apply.saveOne(q);
      if (!saved) {
        if (wholePage && blankLike) CXAI.Log.warn(`#${no} 是${q.typeLabel || '填空'}题，但没找到该题的「保存」按钮，内容可能会丢`);
        else CXAI.Log.info(`#${no} 页面上没有单独的「保存」按钮（由页面统一提交）`);
      } else {
        CXAI.Log.ok(`#${no} 已点本题「保存」`);
      }
    }

    try {
      if (CXAI.Mark) {
        CXAI.Mark.render(q, result, applied, {
          status: applied && applied.ok ? 'ok' : applied && applied.manual ? 'manual' : 'fail',
          actual: live,
          at: Date.now()
        });
      }
    } catch (e) {}
    CXAI.UI.addQuestionCard(q, result, applied);
    const rec = { index: q.index, no, qid: q.qid, type: q.type, stem: CXAI.U.truncate(q.stem, 80), result, applied };
    st.results.push(rec);
    // 面板上的"已答"只算真正落盘的（applied.ok），失败/需人工单独进「失败」列，
    // 不混进作答数 —— 但两者都要算进"已处理"，否则走了 5 题仍显示"已答 2"。
    recordQ(q, result, applied, applied && applied.ok ? 'ok' : applied && applied.manual ? 'manual' : 'fail');
    CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
    // 单题模式翻页是整页导航，finally 来不及执行；进度必须在这一题刚落盘时写盘，
    // 否则下一页读回来的 done 永远是 0 —— 用户看到的就是"作答 0 个"。
    saveSession(true);
    return rec;
  }

  /* ---------------- 整卷模式 ---------------- */

  async function runWholePage(page) {
    let { questions } = CXAI.Scraper.collect();
    CXAI.Log.info(`整卷模式：共 ${questions.length} 题`);
    CXAI.UI.update({ total: questions.length, done: 0 });
    if (!questions.length) {
      CXAI.Log.warn('页面上没有找到题目，确认是否在考试/作业页面');
      return;
    }

    for (let i = st.cursor; i < questions.length; i++) {
      st.cursor = i;
      await waitIfPaused();
      // DOM 可能被页面重绘，逐题重新取一次引用
      const fresh = CXAI.Scraper.collect().questions;
      // 重排后下标会指向别的题：先按 qid/题干找回原来那道，找回失败才退回下标
      let q = null;
      try {
        q = CXAI.Scraper.pickSame(fresh, questions[i]) || null;
      } catch (e) {}
      if (!q) q = fresh[i] || questions[i];
      // 整卷页的 currentIndex() 读的是 URL 的 start（永远是进页时那一题），
      // 所以题号必须按数组位置写：否则面板的蓝色高亮会一直停在第 5 题。
      q.no = i + 1;
      if (!q) continue;
      // 面板的「当前题」：旧实现从不更新，永远停在进页面时的 URL start（第 5 题）。
      CXAI.UI.update({ current: i + 1, pending: { index: i + 1, stem: q.stem, typeLabel: q.typeLabel } });
      try {
        await handleQuestion(q, page.kind);
      } catch (e) {
        if (e.message === '__STOPPED__') throw e;
        st.failed++;
        CXAI.Log.error(`#${i + 1} 处理异常：${e.message}`);
      }
      if (i < questions.length - 1) await sleep(CXAI.Guard.pace(i));
    }
    CXAI.Log.ok(`整卷处理完毕：成功 ${appliedCount()} · 跳过 ${st.skipped} · 失败 ${st.failed}`);
    await maybeSubmit();
  }

  // 真正落盘的题数（applied.ok）。st.results.length 含失败项，不能当"已作答"用。
  function appliedCount() {
    return st.baseDone + st.results.filter((r) => r.applied && r.applied.ok).length;
  }

  /* ---------------- 无刷新翻页 ----------------
   * 超星单题模式的翻页链是：
   *   getTheNextQuestion(1) → submitForm(true,false,cb)（ajax 保存，回调给 lastUpdateTime|remainTime|enc）
   *                          → window.location.href = 下一页（整页重载）
   * 整页重载会把脚本内存、面板、计时器一起清掉，用户看到的就是"刷新来刷新去"。
   * 这里把后半段换成 fetch + 原地换 DOM：保存还是走页面自己的 submitForm（服务器视角完全一样），
   * 只是不再整页重载。任何一步失败都自动回退到页面原生的「下一题」。
   */

  /** 调页面自己的 submitForm 走 ajax 保存，返回 'lastUpdateTime|remainTime|enc' */
  function pageSubmitSave() {
    return new Promise((resolve) => {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
      if (!w || typeof w.submitForm !== 'function') return resolve(null);
      let done = false;
      const wait = Math.max(2000, Number(CXAI.Cfg.get('engine.softNextTimeoutMs', 6000)) || 6000);
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, wait);
      try {
        w.submitForm(true, false, function (data) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(String(data == null ? '' : data));
        });
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }

  /** 按页面自己的规则拼下一页地址：start+1，并带上保存回调给的 enc/remainTime */
  function nextUrl(data) {
    const url = new URL(location.href);
    const cur = Number(url.searchParams.get('start') || 0);
    url.searchParams.set('start', String(cur + 1));
    const parts = String(data || '').split('|');
    if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
      url.searchParams.set('relationAnswerLastUpdateTime', parts[0]);
      url.searchParams.set('remainTimeParam', parts[1]);
      url.searchParams.set('enc', parts[2]);
    }
    return url.toString();
  }

  /**
   * @returns {Promise<{ok:boolean, why?:string, url?:string, fatal?:boolean}>}
   *   ok    原地换题成功（调用方直接继续循环）
   *   url   保存成功但必须真跳转（富文本页编辑器重建不了 / 已经到最后一题）
   */
  async function softNext() {
    if (!CXAI.Cfg.get('engine.softNext', true)) return { ok: false, why: '已关闭' };
    const page = CXAI.Scraper.detectPage();
    if (page.readonly) return { ok: false, why: '浏览/预览页不记录作答' };
    if (!document.querySelector('#submitTest')) return { ok: false, why: '页面上没有作答表单' };
    if (typeof DOMParser !== 'function') return { ok: false, why: 'DOMParser 不可用' };

    const data = await pageSubmitSave();
    if (!data) return { ok: false, why: 'submitForm 保存回调超时' };
    const url = nextUrl(data);
    let html = '';
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return { ok: false, why: '取下一页 HTTP ' + res.status };
      html = await res.text();
    } catch (e) {
      return { ok: false, why: '取下一页失败：' + e.message };
    }
    const swapped = CXAI.Scraper.applyNextPage(html);
    if (!swapped.ok) {
      // 到底了：不跳转，交给主循环收尾（跳过去是"无效参数！"死页面）
      if (swapped.end) return { ok: false, end: true, why: swapped.why || '已到最后一题' };
      return { ok: false, why: swapped.why || '换题失败', url };
    }
    // 填空/简答：换完题块必须把 UEditor 重新挂起来（body 异步就绪，要等）
    const editorsOk = CXAI.Scraper.ensureEditorsAsync ? await CXAI.Scraper.ensureEditorsAsync(3000) : true;
    if (!editorsOk) return { ok: false, why: '富文本编辑器没能重建', url };
    try {
      history.replaceState(null, '', url);
    } catch (e) {}
    return { ok: true, url };
  }

  /* ---------------- 单题模式 ---------------- */

  async function runSingleMode(page) {
    const maxIter = CXAI.Cfg.get('engine.maxIterations', 200);
    st.total = CXAI.Scraper.totalCount() || st.total;
    const first = CXAI.Scraper.collect().questions[0];
    CXAI.Log.info(
      '单题模式：逐题作答并翻页（页面题目块 ' + CXAI.Scraper.collect().questions.length +
        ' 个 · 本卷共 ' + (st.total || '?') + ' 题 · 无刷新翻页 ' + (CXAI.Cfg.get('engine.softNext', true) ? '开' : '关') + '）'
    );
    if (first && !first.answered) {
      CXAI.UI.update({ current: CXAI.Scraper.currentIndex() || 1, pending: { index: CXAI.Scraper.currentIndex() || 1, stem: first.stem, typeLabel: first.typeLabel } });
    }
    for (let iter = 0; iter < maxIter; iter++) {
      await waitIfPaused();
      const { questions } = CXAI.Scraper.collect();
      const q = questions[0];
      if (!q) {
        CXAI.Log.warn('当前页未识别到题目，可能已到最后一题');
        break;
      }
      // 题号以页面 start 参数为准（单题模式下一题一块，不能拿数组下标当题号）
      q.no = CXAI.Scraper.currentIndex() || (st.baseDone + iter + 1);
      st.cursor = q.no;
      // 同一道题反复出现 = 翻页在来回弹（典型原因：抓到了"上一题"按钮）
      // 纯图片题的题干为空：必须把图片指纹拼进 key，否则每轮 key 都不同，判重永远不触发
      const imgSig = (q.images || []).map((u) => String(u).slice(-24)).join(',');
      const vkey =
        q.qid || [CXAI.U.normText(q.stem).slice(0, 60), imgSig].filter(Boolean).join('|') || '#' + iter;
      st.visited = st.visited || {};
      st.visited[vkey] = (Number(st.visited[vkey]) || 0) + 1;
      if (st.visited[vkey] > 3) {
        CXAI.Log.error(
          '同一道题已被处理 ' + st.visited[vkey] + ' 次（题号附近来回跳），已停止，避免整卷空转。'
        );
        break;
      }
      q.index = iter;
      CXAI.UI.update({ total: st.total || st.baseDone + iter + 1, done: appliedCount() + st.skipped, current: q.no });
      try {
        await handleQuestion(q, page.kind);
      } catch (e) {
        if (e.message === '__STOPPED__') throw e;
        CXAI.Log.error(`第 ${q.no} 题异常：${e.message}`);
      }
      // 写入失败会自动暂停（stopOnFail）：暂停期间绝不能翻页，否则这题就漏了。
      // 旧实现只在下一次循环开头等，结果先翻了一页才发现已暂停。
      await waitIfPaused();
      await sleep(CXAI.Guard.pace(iter));
      // 翻页前留落库窗口：超星在换题时会重建题目区，抢在它保存之前换题就丢答案。
      await CXAI.Apply.settle(q);

      // ① 无刷新翻页
      const sn = await softNext();
      if (sn.ok) {
        let movedOk = false;
        for (let w = 0; w < 12; w++) {
          const cur = CXAI.Scraper.collect().questions[0];
          if (cur && (CXAI.U.normText(cur.stem) !== CXAI.U.normText(q.stem) || (cur.qid && q.qid && cur.qid !== q.qid))) {
            movedOk = true;
            break;
          }
          await sleep(120);
        }
        if (movedOk) continue;
        CXAI.Log.warn('无刷新翻页后题目没变，回退原生「下一题」');
      } else if (sn.end) {
        CXAI.Log.ok('已到最后一道题：' + (sn.why || ''));
        break;
      } else if (sn.url) {
        // 富文本页编辑器实在重建不了：让页面自己跳一次并初始化（只跳这一次）
        CXAI.Log.info('改为页面内跳转：' + (sn.why || ''));
        location.href = sn.url;
        return;
      } else if (sn.why && sn.why !== '已关闭') {
        CXAI.Log.info('无刷新翻页不可用（' + sn.why + '），改用原生「下一题」');
      }

      // ② 原生翻页（回退路径）：翻页前自检，页面没把这题记为已答就停下，别静默翻完整卷
      if (!page.readonly) {
        const cur = CXAI.Scraper.collect().questions[0];
        const same = cur && CXAI.U.normText(cur.stem) === CXAI.U.normText(q.stem);
        if (same && !cur.answered) {
          st.failed++;
          CXAI.Log.error(
            `第 ${q.no} 题翻页前自检失败：页面仍是未答状态。已停止翻页，避免整卷记 0 题。`
          );
          CXAI.UI.update({ failed: st.failed });
          break;
        }
      }
      const moved = CXAI.Scraper.clickNext();
      if (!moved) {
        CXAI.Log.ok('没有"下一题"按钮，单题模式结束');
        break;
      }
      await sleep(CXAI.U.randInt(900, 1800));
      let waitCount = 0;
      while (waitCount++ < 12) {
        const cur = CXAI.Scraper.collect().questions[0];
        if (cur && CXAI.U.normText(cur.stem) !== CXAI.U.normText(q.stem)) break;
        await sleep(250);
      }
      const advanced = CXAI.Scraper.collect().questions[0];
      if (advanced && CXAI.U.normText(advanced.stem) === CXAI.U.normText(q.stem)) {
        CXAI.Log.warn('点了"下一题"但题目没变，可能已经是最后一题（或翻页按钮被遮住），停止单题循环');
        break;
      }
    }
    CXAI.Log.ok(`单题模式结束：成功 ${appliedCount()} · 跳过 ${st.skipped} · 失败 ${st.failed}`);
    await maybeSubmit();
  }

  /* ---------------- 整卷预览（OCS 的做法） ---------------- */

  /**
   * 切「整卷预览」：一页装下全部题目，再逐题作答。
   *
   * OCS 稳定就稳定在这一步 —— 不逐题翻页，就没有"翻页把答案翻丢""换题整页重载
   * 导致面板清零"这些麻烦。用户 2026-11-19 明确要求默认开启。
   * @param {string} [why] 触发来源，只用于日志
   * @returns {Promise<boolean>} true = 已点入口、页面即将切换
   */
  async function maybeEnterPreview(why) {
    try {
      if (!CXAI.Cfg.get('answer.preferPreview', true)) return false;
      if (st.previewTried) return false;
      const page = CXAI.Scraper.detectPage();
      if (!page || page.readonly) return false;
      if (page.kind === 'chapter') return false;
      const shown = document.querySelectorAll('.questionLi').length;
      const total = CXAI.Scraper.totalCount ? CXAI.Scraper.totalCount() : shown;
      // 只有"确实是逐题渲染"才切：单题模式，或者题量比当前页可见的多
      const need = page.mode === 'single' || (total > shown && shown > 0);
      if (!need) return false;
      const entry = CXAI.Scraper.previewEntry();
      if (!entry) return false;
      st.previewTried = true;
      saveSession(st.running);
      CXAI.Log.info(
        '发现「整卷预览」入口' + (why ? '（' + why + '）' : '') + '：切到整卷模式，一页装下全部 ' + (total || '?') + ' 题，不用逐题翻页'
      );
      await sleep(CXAI.U.randInt(400, 900));
      const entered = CXAI.Scraper.enterPreview();
      if (!entered) {
        CXAI.Log.warn('整卷预览入口点不动，继续在当前页逐题作答');
        return false;
      }
      st.handoff = !!st.running;
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 整卷页：把"下一道待答的题"滚进视野并闪一下高亮（逐题推进的视觉锚点） */
  function scrollToNextUnanswered(questions, fromPos, isEmpty) {
    try {
      const list = questions || [];
      if (!list.length) return;
      let target = null;
      for (let i = 1; i <= list.length; i++) {
        const cand = list[(fromPos + i) % list.length];
        if (cand && isEmpty(cand)) {
          target = cand;
          break;
        }
      }
      if (!target || !target.root || !target.root.scrollIntoView) return;
      target.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const old = target.root.style.outline;
      target.root.style.outline = '2px solid #6d8bff';
      setTimeout(function () {
        try {
          target.root.style.outline = old;
        } catch (e) {}
      }, 1600);
      const no = (Number(target.index) || 0) + 1;
      CXAI.UI.update({ current: no });
      CXAI.Log.info('下一题：#' + no + ' ' + CXAI.U.truncate(target.stem || '', 24));
    } catch (e) {}
  }

  /* ---------------- 点一下 = 答一题 ---------------- */

  /**
   * 答"下一道还没答的题"（点小球一次 = 走一步）。
   *
   * 2026-11-19 按用户要求对齐 OCS 的操作顺序：
   *   ① 先切整卷预览（默认开），一页到底
   *   ② 取下一道还没有答案的题（按 st.nextIdx 轮转，不每次从头扫）
   *   ③ 判题：题干自带答案 → 本页预取 → 现场判定（不读跨场旧缓存）
   *   ④ 落盘（元素被重绘会自动重取再写）
   *   ⑤ 填空/简答补一次本题「保存」
   *   ⑥ 自动切到下一题：整卷页滚动高亮下一题，单题页无刷新翻页
   */
  async function answerNext(opt) {
    opt = opt || {};
    if (st.running) {
      CXAI.Log.warn('自动连答正在跑，先「停止」再用单题作答');
      return { ok: false, reason: 'running' };
    }
    // ① 整卷预览优先：第一次点击先切页，加载完再点一下就是答第一道
    if (!st.previewTried && CXAI.Cfg.get('answer.preferPreview', true)) {
      const moved = await maybeEnterPreview('答一题');
      if (moved) return { ok: true, reason: 'preview', left: -1 };
    }
    const page = CXAI.Scraper.detectPage();
    const { questions } = CXAI.Scraper.collect();
    if (!questions.length) {
      CXAI.Log.warn('这一页没有识别到题目');
      return { ok: false, reason: 'no-question' };
    }
    const whole = questions.length > 1;
    const overwrite = CXAI.Cfg.get('apply.overwriteAnswered', false);
    const isEmpty = (q) => !((CXAI.Scraper.pageValue(q) || {}).value || '');
    const total = questions.length;
    // ② 从上次停下的下一题开始轮转（OCS 是顺序往下走，不是每次都从头扫）
    const startAt = Math.max(0, Math.min(Number(st.nextIdx) || 0, total - 1));
    const ordered = questions.slice(startAt).concat(questions.slice(0, startAt));
    const next = overwrite ? ordered[0] || null : ordered.filter(isEmpty)[0] || null;
    if (!next) {
      CXAI.Log.ok('这一页的题都已经有答案了');
      CXAI.UI.update({ doneAll: true });
      return { ok: true, reason: 'all-answered', left: 0 };
    }
    const pos = questions.indexOf(next);
    let q = next;
    q = await decryptIfNeeded(q);
    q.no = whole ? (pos >= 0 ? pos + 1 : (Number(q.index) || 0) + 1) : (CXAI.Scraper.currentIndex() || 1);
    CXAI.UI.update({ current: q.no, pending: { index: q.no, stem: q.stem, typeLabel: q.typeLabel } });
    try {
      if (CXAI.Mark) CXAI.Mark.pending(q);
    } catch (e) {}

    // ③ 判题：题干自带答案 → 本页预取 → 现场判定（跨页/跨场的旧答案不再复用）
    let result = stemResult(q) || memoGet(q);
    if (result) {
      CXAI.Log.info(`#${q.no} 用本页预取好的判定 ${result.answerText}`);
    } else {
      CXAI.Log.info(`#${q.no} 现场判定 · ${q.typeLabel} · ${CXAI.U.truncate(q.stem || '', 30)}`);
      try {
        result = await CXAI.AI.solve(q);
        memoSet(q, result);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        CXAI.Log.error(`#${q.no} 判定失败：${msg}`);
        recordQ(q, { answerText: '', reason: msg }, { ok: false, error: msg }, 'fail');
        return { ok: false, q: q.no, error: msg };
      }
    }

    // 仅显示答案模式（ui.showOnly）：不落盘、不保存、不翻页 —— 判定结果进面板与右下角答案条即止
    if (CXAI.Cfg.get('ui.showOnly', true) === true) {
      recordQ(q, result, { ok: false, showOnly: true }, q.answered ? 'skip' : 'answer');
      CXAI.UI.update({ current: q.no });
      CXAI.Log.ok(`#${q.no} 答案 ${CXAI.U.escapeHtml(result.answerText || '')}（仅显示，不落盘）`);
      // 轮转指针往前推，下一次点击判定下一题
      st.nextIdx = total ? (pos + 1) % total : 0;
      return { ok: true, q: q.no, showOnly: true, answer: result.answerText, left: questions.filter(isEmpty).length };
    }

    // ④ 落盘（页面重绘会自动重取一次再写，与自动连答共用同一条路）
    const applied = await applyWithRetry(q, result);
    const live =
      (CXAI.Scraper.answerView ? CXAI.Scraper.answerView(q) : '') ||
      (CXAI.Scraper.pageValue(q) || {}).value ||
      (applied && applied.actual) ||
      '';
    try {
      if (CXAI.Mark) {
        CXAI.Mark.render(q, result, applied, {
          status: applied && applied.ok ? 'ok' : applied && applied.manual ? 'manual' : 'fail',
          actual: live,
          at: Date.now()
        });
      }
    } catch (e) {}
    recordQ(q, result, applied, applied && applied.ok ? 'ok' : applied && applied.manual ? 'manual' : 'fail');
    CXAI.UI.update({ doneAll: false, done: appliedCount() + st.skipped, current: q.no });
    if (applied && applied.ok) {
      CXAI.Log.ok(`#${q.no} 已填 ${CXAI.U.escapeHtml(result.answerText)} · 页面 ${live || '?'}`);
      if (applied.partial) CXAI.Log.warn(`#${q.no} 只填了 ${applied.filled}/${applied.total} 个空，其余请人工核对`);
    } else if (applied && applied.manual) {
      CXAI.Log.warn(`#${q.no} 需要人工补：${applied.error || '页面没有可写入的位置'}（AI 答案 ${result.answerText}）`);
    } else {
      CXAI.Log.error(`#${q.no} 写入失败：${applied && applied.error}`);
    }

    // ⑤ 填空·简答：每题都有自己的「保存」，不点会丢内容（OCS 也是逐题 save）
    if (applied && applied.ok) {
      const hasInput = !!(q.inputs && q.inputs.some((el) => el && el.isConnected));
      const blankLike =
        hasInput || q.type === 'completion' || /填空|简答|论述|名词解释|计算题/.test(String(q.typeLabel || ''));
      if (blankLike) {
        const saved = await CXAI.Apply.saveOne(q);
        if (!saved) CXAI.Log.info(`#${q.no} 页面上没有单独的「保存」按钮（由页面统一提交）`);
      }
    }

    // ⑥ 自动切到下一题
    if (applied && applied.ok) {
      st.nextIdx = total ? (pos + 1) % total : 0;
      if (opt.advance !== false) {
        if (!whole && page.mode === 'single') {
          // 单题翻页页：无刷新换题（失败退回原生「下一题」）
          await CXAI.Apply.settle(q);
          const sn = await softNext();
          if (sn.ok) {
            // 已原地换到下一题，停在那儿等下一次点击
          } else if (sn.url) {
            // 富文本页必须由页面自己初始化：整页跳过去
            location.href = sn.url;
            return { ok: true, q: q.no, advance: 'reload', left: -1 };
          } else if (!sn.end) {
            CXAI.Scraper.clickNext();
            await sleep(CXAI.U.randInt(700, 1400));
          }
        } else {
          // 整卷/预览页：滚到下一道还没答的题并高亮
          scrollToNextUnanswered(questions, pos, isEmpty);
        }
      }
    } else {
      CXAI.Log.warn(`#${q.no} 没有落盘，先停在这道题；手动补好后再点一次小球`);
    }
    const left = CXAI.Scraper.collect().questions.filter(isEmpty).length;
    if (!left) CXAI.UI.update({ doneAll: true, running: false });
    return { ok: !!(applied && applied.ok), q: q.no, left, next: left ? (Number(st.nextIdx) || 0) + 1 : 0 };
  }

  /* ---------------- 预取答案（后台跑，不碰页面） ---------------- */

  /**
   * 把当前页每道"还没答案"的题先判一遍，结果按 qid 存起来。
   * 只写存储，不动 DOM —— 之后点一下球就是"读缓存 + 落盘"，秒出。
   */
  async function prefetch(opt) {
    opt = opt || {};
    if (st.prefetching) return st.prefetchPromise || 0;
    st.prefetching = true;
    const concurrency = Math.max(1, Math.min(8, Number(CXAI.Cfg.get('engine.prefetchConcurrency', 4)) || 4));
    const overwrite = CXAI.Cfg.get('apply.overwriteAnswered', false);
    let queue = [];
    try {
      queue = (CXAI.Scraper.collect().questions || []).filter((q) => {
        if (stemResult(q) || memoGet(q)) return false;
        if (!overwrite && (CXAI.Scraper.pageValue(q) || {}).value) return false;
        return true;
      });
    } catch (e) {
      queue = [];
    }
    if (!queue.length) {
      st.prefetching = false;
      return 0;
    }
    CXAI.Log.info(`开始预取 ${queue.length} 道题的答案（并发 ${concurrency}），期间你可以随时点小球答一题`);
    let done = 0;
    let stopped = false;
    const worker = async () => {
      while (queue.length && !stopped && !st.stopped) {
        let q = queue.shift();
        try {
          q = await decryptIfNeeded(q);
          const r = await CXAI.AI.solve(q);
          memoSet(q, r);
          try {
            if (CXAI.Mark) CXAI.Mark.preview(q, r);
          } catch (e) {}
          done++;
          CXAI.Log.ok(`预取 ${done}/${done + queue.length} · #${(Number(q.index) || 0) + 1} ${CXAI.U.truncate(q.stem || '', 24)} → ${r.answerText}`);
          CXAI.UI.update({ prefetched: done });
        } catch (e) {
          CXAI.Log.warn('预取失败：' + e.message);
        }
      }
    };
    st.prefetchPromise = Promise.all(Array.from({ length: concurrency }, worker)).then(() => {
      st.prefetching = false;
      CXAI.Log.ok(`预取完成：${done} 道题已缓存，点小球即可逐题落盘`);
      return done;
    });
    return st.prefetchPromise;
  }

  /* ---------------- 用页面现状给清单打底 ---------------- */

  /**
   * 把"页面上已经存在的答案"读进清单：整卷/预览模式下 10 道题可能早就答过了，
   * 面板不能一片"未答"。这些行进 status='skip'（已答·原有），AI 答案留空——
   * 我们并不知道用户当时选了什么，不猜。
   */
  function primeFromPage() {
    try {
      const qs = CXAI.Scraper.collect().questions || [];
      if (!qs.length) return 0;
      const whole = qs.length > 1;
      const base = whole ? 0 : (CXAI.Scraper.currentIndex() || 1) - 1;
      // 已经有 AI 结论的行不要被"打底"覆盖掉（否则刚答完的题会变成"AI 未参与"）
      const existing = {};
      try {
        (CXAI.UI.getQList() || []).forEach((r) => {
          if (r && r.key) existing[r.key] = r;
        });
      } catch (e) {}
      let n = 0;
      qs.forEach((q, i) => {
        const pv = (CXAI.Scraper.pageValue(q) || {}).value || '';
        if (!pv) return;
        const no = whole ? i + 1 : base + 1;
        const rowKey = rowKeyOf(q);
        const prev = existing[rowKey];
        if (prev && prev.answer) return; // 留着 AI 的结论
        try {
          if (CXAI.Mark) CXAI.Mark.existing(q, pv);
        } catch (e) {}
        CXAI.UI.pushQuestion({
          index: no,
          qid: q.qid || '',
          type: q.type || '',
          typeLabel: q.typeLabel || '',
          stem: CXAI.U.truncate(q.stem || '', 240),
          options: (q.options || []).slice(0, 10).map((o) => ({ k: o.key, t: CXAI.U.truncate(o.text || '', 60), a: !!o.answered })),
          answer: '',
          actual: pv,
          status: 'skip',
          stage: 'stored',
          key: rowKey
        });
        n++;
      });
      if (n) CXAI.Log.info('页面上已有 ' + n + ' 道题的答案，已填入清单（标为"已答·原有"）');
      return n;
    } catch (e) {
      return 0;
    }
  }

  /* ---------------- 清单点行跳转 ---------------- */

  /**
   * 跳到第 n 题（n = 面板上显示的题号，从 1 起）。
   * 超星页面自己的 getTheQuestionByStart(start) 收的是 URL 里的 start 值，等于题号-1。
   */
  function jumpTo(n) {
    const num = Math.max(1, Number(n) || 1);
    const target = num - 1;

    // ① 整卷预览 / 章节页是"单页滚动"：直接滚到第 n 题并闪一下高亮。
    //    旧实现只会调 getTheQuestionByStart（预览页没有）→ 改成改 URL 重载，
    //    单页预览里等于什么也没发生，这就是"点题号没反应"。
    let el = null;
    try {
      el = document.getElementById('q' + num) || document.getElementById('question' + num);
    } catch (e) {}
    if (!el) {
      const qs = CXAI.Scraper.collect().questions || [];
      if (qs[target] && qs[target].root) el = qs[target].root;
    }
    if (el && el.scrollIntoView) {
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (e) {
        try {
          el.scrollIntoView();
        } catch (e2) {}
      }
      try {
        const old = el.style.outline;
        el.style.outline = '2px solid #6d8bff';
        setTimeout(() => {
          try {
            el.style.outline = old;
          } catch (e) {}
        }, 1600);
      } catch (e) {}
      CXAI.Log.info('已跳到第 ' + num + ' 题');
      return;
    }

    // ② 单题翻页模式：页面自己的 getTheQuestionByStart(start)，start = 题号-1
    const cur = CXAI.Scraper.currentIndex();
    if (cur && target === cur - 1) {
      CXAI.Log.info('已经在第 ' + num + ' 题');
      return;
    }
    const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    try {
      if (typeof w.getTheQuestionByStart === 'function') {
        CXAI.Log.info('跳转到第 ' + num + ' 题');
        w.getTheQuestionByStart(target);
        return;
      }
    } catch (e) {}
    try {
      const url = new URL(location.href);
      url.searchParams.set('start', String(target));
      location.href = url.toString();
    } catch (e) {
      CXAI.Log.warn('跳转失败：' + e.message);
    }
  }

  /* ---------------- 交卷 ---------------- */

  async function maybeSubmit() {
    // v1.8.0：考试页面板与设置中心写的是 apply.submit，旧代码读的是 apply.autoSubmit —— 两个都认，别让开关只生效一半
    if (!CXAI.Cfg.get('apply.autoSubmit', false) && !CXAI.Cfg.get('apply.submit', false)) {
      CXAI.Log.warn('未开启自动交卷。请人工复核标黄题目后再手动交卷。');
      return;
    }
    const btn = CXAI.Apply.findSubmitButton();
    if (!btn) {
      CXAI.Log.warn('未找到交卷按钮，请手动提交');
      return;
    }
    CXAI.Log.warn('10 秒后自动交卷，需要中止请点「停止」');
    await sleep(10000);
    if (st.stopped) return;
    await CXAI.Apply.humanClick(btn, { nativeFallback: true });
    CXAI.Log.ok('已点击交卷');
    // 点完交卷还会弹一次"确认提交"：等最多 8 秒，只在明确的确认按钮上点，
    // 不再把时序完全交给 Guard 的 10 秒延时。
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await sleep(600);
      if (st.stopped) return;
      let okBtn = null;
      try {
        okBtn = Array.from(
          document.querySelectorAll('.layui-layer-btn a, .dialog-btn, [class*="confirm"] a, [class*="confirm"] button')
        ).filter((el) => {
          const t = (el.textContent || '').trim();
          return /^(确定|确认|是|提交|交卷)$/.test(t);
        })[0];
      } catch (e) {}
      if (okBtn) {
        try {
          okBtn.click();
          CXAI.Log.ok('已确认交卷弹窗');
        } catch (e) {}
        return;
      }
    }
  }

  /* ---------------- 对外 ---------------- */

  async function start() {
    if (st.running) return;
    const providers = CXAI.Cfg.activeProviders();
    if (!providers.length) {
      CXAI.Log.error('还没有配置模型：点面板右上角 ⇅ 粘同步码拉取，或在设置中心（网页版）配好后生成同步码');
      if (CXAI.UI.openSync) CXAI.UI.openSync();
      return;
    }

    st.running = true;
    st.stopped = false;
    st.paused = false;
    st.cursor = 0;
    st.nextIdx = 0;
    // 每次开跑都清空本页临时判定（不继承上一次的旧答案）
    resetMemo();
    // 整页导航会把内存清零，续跑时把上一页的累计进度接回来
    st.baseDone = 0;
    try {
      const prev = CXAI.Store.get(SESSION_KEY, null);
      const winMs = (Number(CXAI.Cfg.get('engine.resumeWindowMin', 20)) || 20) * 60000;
      if (prev && prev.running && Date.now() - (Number(prev.at) || 0) < winMs) {
        st.baseDone = Number(prev.done) || 0;
        st.visited = prev.visited || {};
        st.previewTried = !!prev.previewTried;
        if (st.baseDone > 0) CXAI.Log.info('接着上次进度：已完成 ' + st.baseDone + ' 题');
      }
    } catch (e) {}
    st.results = [];
    st.skipped = 0;
    st.failed = 0;
    st.startedAt = Date.now();
    let _n = 0;
    try {
      st.total = CXAI.Scraper.totalCount() || 0;
      _n = st.total || CXAI.Scraper.collect().questions.length;
    } catch (e) {}
    // 面板清单跨页保留：先把上次的记录摆回面板，"已处理"从清单里的成功条数起算。
    // baseDone 取 session 恢复值与清单统计的较大者：单题模式翻页后 qlist 可能被换卷清空，
    // 覆盖写回会让"已完成 N 题"归零（2026-11-24 审查 #3）。
    let prevList = [];
    try {
      prevList = CXAI.UI.getQList ? CXAI.UI.getQList() : [];
    } catch (e) {}
    st.baseDone = Math.max(st.baseDone, prevList.filter((x) => x && x.status === 'ok').length);
    // 整卷/预览模式下先把"页面上已经答过的题"读进清单，别让面板一片未答
    try {
      primeFromPage();
    } catch (e) {}
    CXAI.UI.update({
      running: true,
      doneAll: false,
      paused: false,
      providers: providers.length,
      done: appliedCount() + st.skipped,
      total: _n,
      qlist: prevList,
      current: CXAI.Scraper.currentIndex() || 1
    });
    saveSession(true);

    try {
      const page = CXAI.Scraper.detectPage();
      CXAI.UI.update({ pageKind: page.kind });
      CXAI.Log.info(`页面识别：${page.kind} · ${page.title || location.pathname}`);
      if (page.kind === 'unknown') {
        CXAI.Log.error('当前页面不是学习通考试/作业页，脚本待机');
        return;
      }
      if (page.readonly) {
        CXAI.Log.warn(
          '⚠ 当前是试卷浏览/预览页（' + location.pathname + '）：这里点选项只有本地高亮，超星不会记录作答。' +
            '要真正落库请进正式考试或作业页面（/exam-ans/exam/test/... 或 /work/dowork）。'
        );
      }
      // 有「整卷预览」入口就先切过去（与"答一题"共用同一条逻辑，别让两套行为漂移）
      if (await maybeEnterPreview('自动连答')) {
        st.handoff = true;
        return;
      }
      // 整卷预览页刚切过来时题块可能还没渲染完，先等它出现（最多 12s），别一上来就判"没有题目"
      if (!CXAI.Scraper.collect().questions.length) {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          await sleep(400);
          if (CXAI.Scraper.collect().questions.length) break;
        }
      }
      if (page.kind === 'chapter') await runWholePage(page);
      else if (page.mode === 'single') await runSingleMode(page);
      else await runWholePage(page);
      CXAI.UI.update({ doneAll: true });
    } catch (e) {
      if (e.message === '__STOPPED__') CXAI.Log.warn('已手动停止');
      else CXAI.Log.error('运行中断：' + e.message);
    } finally {
      if (st.handoff) {
        // 交接给下一页：**先**在 st.running 还是 true 的时候写盘（saveSession 会与 st.running 取与），
        // 再把内存状态放下。顺序反了就会写成 running:false，新页面永远不会自动开始。
        saveSession(true);
        st.running = false;
        st.handoff = false;
        CXAI.Log.info('已切到整卷预览，等新页面加载后自动接着答');
      } else {
        const cost = Math.round((Date.now() - st.startedAt) / 1000);
        CXAI.Log.info(`总耗时 ${cost}s · 成功 ${appliedCount()} · 跳过 ${st.skipped} · 失败 ${st.failed}`);
        st.running = false;
        st.paused = false;
        saveSession(false);
      }
      CXAI.UI.update({ running: false, paused: false });
    }
  }

  function togglePause() {
    if (!st.running) return;
    st.paused = !st.paused;
    CXAI.Log.warn(st.paused ? '已暂停' : '继续');
    CXAI.UI.update({ paused: st.paused });
  }

  function stop() {
    if (!st.running) return;
    st.stopped = true;
    st.paused = false;
    saveSession(false);
    CXAI.Log.warn('停止中…');
  }

  return { start, togglePause, stop, jumpTo, softNext, primeFromPage, answerNext, prefetch, maybeEnterPreview, resetMemo, st, saveSession };
})();

/* ---------------- 启动 ---------------- */

(function boot() {
  /**
   * 读取 URL 里的配置码并落到本域存储。
   * 为什么需要它：油猴存储按域名隔离，设置中心（pages.dev）写的配置考试页（chaoxing.com）读不到，
   * 只能由设置中心生成链接，本脚本在任意匹配页面把配置码导入本域。
   */
  function consumeConfigHash() {
    let raw = '';
    try {
      raw = String(location.hash || '');
    } catch (e) {
      return false;
    }
    const m = /[#&]cxai_cfg=([A-Za-z0-9+/=%_-]+)/.exec(raw);
    if (!m) return false;
    const obj = CXAI.cfgCodec.decode(decodeURIComponent(m[1]));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      CXAI.Log.warn('配置码解不出来，忽略');
      return false;
    }
    try {
      CXAI.Cfg.importJSON(obj);
    } catch (e) {
      CXAI.Log.error('配置码导入失败：' + (e && e.message ? e.message : e));
      return false;
    }
    // 清掉 hash：刷新不重复导入，配置也不留在地址栏 / 浏览历史里
    try {
      const clean = location.href.replace(/([#&])cxai_cfg=[^&#]*/g, '').replace(/[#&]+$/, '');
      history.replaceState(null, '', clean);
    } catch (e) {}
    CXAI.Log.ok(
      '已通过链接导入设置中心的配置 · 模型 ' + (CXAI.Cfg.get('ai.providers', []) || []).length + ' 个 · 本域已生效'
    );
    return true;
  }

  /** 题块可能晚于 DOMContentLoaded 才由 ajax 渲染：给入口留一个短暂的重试窗口 */
  let bootRetry = null;

  function ready() {
    try {
      // 设置中心「同步到学习通」带过来的配置码：先落库，再走正常流程
      try {
        consumeConfigHash();
      } catch (e) {}
      // 独立设置中心（/settings.html）：整页接管，不跑任何考试逻辑、不装环境伪装、不挂浮球
      if (CXAI.Settings && CXAI.Settings.isHere()) {
        try {
          CXAI.Settings.mount();
        } catch (e) {
          console.error('[CX-AI] 设置中心渲染失败', e);
        }
        return;
      }
      // 只在"真正能作答的考试/作业页"出现：课程首页、讨论区、已交卷回看页一律不挂界面，
      // 连环境伪装都不装（那是全局副作用，不该出现在普通页面）。
      const gate = (function () {
        try {
          return CXAI.Scraper.detectPage();
        } catch (e) {
          return null;
        }
      })();
      if (!gate || !gate.answerable) {
        // 超星的题块经常在 DOMContentLoaded 之后才回填。旧实现在这里直接 return，
        // 于是"脚本有时出现、有时完全不见"（尤其整卷预览/章节页）。
        // 只对考试/作业类 URL 重试，课程首页等页面不空转。
        const href = String(location.href || '');
        const examish = /\/exam|\/work\/|dowork|doHomeWork|homework|mooc2\/exam|exam-ans/i.test(href);
        if (!bootRetry) {
          bootRetry = {
            deadline: Date.now() + (Number(CXAI.Cfg.get('engine.bootstrapPollMs', 15000)) || 15000),
            first: true
          };
        }
        if (!gate || !gate.finished) {
          if (examish && Date.now() < bootRetry.deadline) {
            if (bootRetry.first) {
              bootRetry.first = false;
              try {
                CXAI.Log.info('考试页题目还没渲染出来，等待题块出现…');
              } catch (e) {}
            }
            setTimeout(ready, 400);
            return;
          }
        }
        try {
          console.log(
            '[CX-AI] 当前页面不是考试作答页，脚本不出现：' +
              (gate ? gate.kind + (gate.finished ? ' · 已交卷/回看页' : '') : '页面未识别')
          );
        } catch (e) {}
        return;
      }
      bootRetry = null;
      CXAI.Cfg.load();
      if (CXAI.Cfg.get('guard.enabled', true)) CXAI.Guard.install();
      CXAI.UI.mount();
      // 交卷/跳到回看页之后，界面自己收掉（用户点交卷、或页面自己跳转都能兜住）
      // interval 句柄挂到 CXAI 上，UI.unmount() 时联动清理（避免卸载后定时器空转）
      CXAI._finishTimer = setInterval(function () {
        try {          if (!document.getElementById('cx-ai-host')) return;
          const p2 = CXAI.Scraper.detectPage();
          if (p2.finished) {
            CXAI.Log.info('检测到已交卷，界面已自动隐藏');
            CXAI.UI.unmount();
          }
        } catch (e) {}
      }, 2000);
      try {
        // 清单必须第一时间从存储恢复：单题模式每翻一页整页重载，面板不能跟着从 0 开始
        const rows0 = CXAI.UI.getQList ? CXAI.UI.getQList() : [];
        CXAI.UI.update({ qlist: rows0 });
        CXAI.UI.update({
          done: rows0.filter((x) => x && x.status === 'ok').length,
          total: CXAI.Scraper.totalCount(),
          current: CXAI.Scraper.currentIndex()
        });
      } catch (e) {}
      // 超星的题块常常晚于 DOMContentLoaded 才渲染（ajax 回填），
      // v1.4.6 只抓一次，于是面板永远显示"题目 0、已处理 0"。这里轮询补抓。
      (function pollQuestions() {
        const deadline = Date.now() + (Number(CXAI.Cfg.get('engine.bootstrapPollMs', 15000)) || 15000);
        let tries = 0;
        const tick = () => {
          tries++;
          let n = 0;
          let total = 0;
          try {
            n = CXAI.Scraper.collect().questions.length;
            total = CXAI.Scraper.totalCount();
          } catch (e) {}
          if (n > 0) {
            CXAI.UI.update({ total: total || n, current: CXAI.Scraper.currentIndex() });
            try {
              CXAI.Engine.primeFromPage();
            } catch (e) {}
            // 每题下方先挂"待作答"，后面的判定结果直接替换这一块
            try {
              if (CXAI.Mark) CXAI.Mark.attachAll(CXAI.Scraper.collect().questions);
            } catch (e) {}
            // 默认开启整卷预览（OCS 的做法）：逐题翻页的卷子先进"一页装下整卷"，
            // 免得每答一题就整页重载、答案和面板都被翻丢。
            try {
              if (CXAI.Cfg.get('answer.preferPreview', true)) {
                setTimeout(function () {
                  try {
                    CXAI.Engine.maybeEnterPreview('进页');
                  } catch (e) {}
                }, Math.max(600, Number(CXAI.Cfg.get('engine.previewDelayMs', 1500)) || 1500));
              }
            } catch (e) {}
            // 加密字体（font-cxsecret）：后台先解出字形映射，抓题/预取都会走它
            try {
              if (CXAI.Font && CXAI.Font.hasSecret(document)) {
                CXAI.Font.ensure(document).then(function () {
                  try {
                    CXAI.Engine.primeFromPage();
                  } catch (e) {}
                });
              }
            } catch (e) {}
            // 后台预取：先把答案判好缓存下来，之后点小球就是"读缓存 + 落盘"，几乎不用等
            try {
              if (CXAI.Cfg.get('engine.prefetch', true)) {
                setTimeout(function () {
                  try {
                    CXAI.Engine.prefetch();
                  } catch (e) {}
                }, Math.max(500, Number(CXAI.Cfg.get('engine.prefetchDelayMs', 2000)) || 2000));
              }
            } catch (e) {}
            const first = CXAI.Scraper.collect().questions[0];
            if (first) {
              CXAI.UI.update({ pending: { index: CXAI.Scraper.currentIndex() || 1, stem: first.stem, typeLabel: first.typeLabel } });
            }
            return;
          }
          if (Date.now() < deadline) setTimeout(tick, Math.min(1200, 250 + tries * 150));
        };
        setTimeout(tick, 300);
      })();
      CXAI.UI.update({
        providers: CXAI.Cfg.activeProviders().length,
        pageKind: (function () {
          try {
            return CXAI.Scraper.detectPage().kind;
          } catch (e) {
            return '-';
          }
        })()
      });
      CXAI.Log.ok('脚本已加载 · Ctrl+Shift+X 呼出面板');
      // 上次答到一半被页面刷新打断 → 自动接着答
      try {
        const ss = CXAI.Store.get('session', null);
        if (ss && ss.running) {
          const winMs = (Number(CXAI.Cfg.get('engine.resumeWindowMin', 20)) || 20) * 60000;
          const page = CXAI.Scraper.detectPage();
          const fresh = Date.now() - (Number(ss.at) || 0) < winMs;
          if (fresh && page.kind !== 'unknown' && CXAI.Cfg.get('engine.autoResume', true)) {
            CXAI.Log.warn('上次作答被页面刷新打断（已完成 ' + (Number(ss.done) || 0) + ' 题），3 秒后自动接着答');
            setTimeout(function () {
              try {
                CXAI.Engine.start();
              } catch (e) {
                CXAI.Log.error('自动续跑失败：' + e.message);
              }
            }, 3000);
          } else {
            CXAI.Store.remove('session');
          }
        }
      } catch (e) {}
      // 本域第一次跑（或配置没跟着过来）时，直接把设置面板和导入框摆在眼前
      // 本域还没配置：**不自动弹面板**（用户明确要求，除非自己点），
      // 只在悬浮球上点一颗提示点；想配就点球 → 面板里会给出「打开设置中心」与配置码入口。
      var np = (CXAI.Cfg.get('ai.providers', []) || []).length;
      if (!np) {
        CXAI.Log.warn(
          '本域还没有模型配置（存储后端：' + CXAI.Store.backend + '）。' +
            '去设置中心配好后点右上角「生成同步码并上传」，再把同步码粘到小球旁边的输入框里（之后每次进考试页都会自动同步）'
        );
        try {
          CXAI.UI.update({ needSetup: true });
        } catch (e) {}
      }
      // 每次进入考试页都自动同步一次（2026-11-18 需求）：
      // 只要存过同步码就静默拉取，不再限制"本地没有模型才拉" ——
      // 那个条件让设置中心改完的判定强度/读图模型在考试页永远不生效。
      try {
        if (CXAI.Sync && CXAI.Sync.savedCode && CXAI.Sync.savedCode()) {
          CXAI.Log.info('检测到同步码：正在从云端同步配置…');
          CXAI.Sync.syncBoot().then(function (r) {
            if (!r) return;
            if (r.ok) {
              try {
                CXAI.UI.update({ needSetup: false, providers: CXAI.Cfg.activeProviders().length });
                if (CXAI.UI.syncOk) CXAI.UI.syncOk(r);
              } catch (e) {}
              CXAI.Log.ok('云同步完成 · 模型 ' + (r.models || 0) + ' 个 · 直接点「答一题」就行');
            } else if (r.skipped) {
              // 本地已有模型、未覆盖：这是正常分支，不要按失败处理（不标红、不弹面板）
              CXAI.Log.info('云同步跳过：' + (r.error || '本地配置未覆盖'));
            } else if (r.error) {
              // 失败原因要落到面板上（双击小球打开的那个面板），别只丢在日志里
              try {
                if (CXAI.UI.syncFail) CXAI.UI.syncFail(r);
              } catch (e) {}
              CXAI.Log.error('云同步失败：' + r.error);
            }
          });
        } else if (!np) {
          // 新用户：既没有模型也没有同步码 → 直接把小球旁的输入框摆出来（一个输入框 + 一个按钮）
          try {
            if (CXAI.UI.openSync) CXAI.UI.openSync({ auto: true });
          } catch (e) {}
        } else {
          // 有模型、但还没存过同步码：同样把输入框自动摆出来一次。
          // 以前只有"一个模型都没有"才弹，于是想填同步码只能自己发现「双击小球 → 面板 → ⇅」
          // 这条隐藏路径，用户实测就是"点一下根本没反应"（2026-11-18）。
          // 半小时内只自动弹一次，避免单题模式每题整页重载都弹一遍。
          try {
            const at = Number(CXAI.Store.get('syncPromptAt', 0)) || 0;
            if (!at || Date.now() - at > 30 * 60 * 1000) {
              CXAI.Store.set('syncPromptAt', Date.now());
              if (CXAI.UI.openSync) CXAI.UI.openSync({ auto: true });
            }
          } catch (e) {}
        }
      } catch (e) {}
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开控制台', () => CXAI.UI.togglePanel(true));
        GM_registerMenuCommand('开始答题', () => CXAI.Engine.start());
        GM_registerMenuCommand('输入同步码（云同步）', () => {
          try {
            CXAI.UI.openSync();
          } catch (e) {}
        });
        GM_registerMenuCommand('打开设置中心（配置模型）', () => {
          const url = CXAI.UI && CXAI.UI.settingsURL ? CXAI.UI.settingsURL() : 'https://cx-exam-ai.pages.dev/settings.html';
          try {
            window.open(url, '_blank', 'noopener');
          } catch (e) {
            location.href = url;
          }
        });
      }
    } catch (e) {
      console.error('[CX-AI] 启动失败', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(ready, 400));
  } else {
    setTimeout(ready, 400);
  }
})();

/* 暴露给控制台调试 */
try {
  (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).CXAI = CXAI;
} catch (e) {
  window.CXAI = CXAI;
}

/* ==================== 09-settings.js ==================== */
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

/* ==================== 10-sync.js ==================== */
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
})();
