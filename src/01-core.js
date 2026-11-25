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
