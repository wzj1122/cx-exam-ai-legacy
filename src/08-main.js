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
