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
    // 判断题的隐藏域可能是 true/false（题型被猜成 single 时 pageValue 不会折算）：
    // 统一走 scraper 的口径折算成字母，再按集合比对，避免"点了也选了却报写入失败"。
    try {
      if (CXAI.Scraper.normPageAnswer) live = CXAI.Scraper.normPageAnswer(freshQ, live) || live;
    } catch (e) {}
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