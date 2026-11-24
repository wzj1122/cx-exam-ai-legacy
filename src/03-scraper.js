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
    try {
      Array.from(root.querySelectorAll('.hoverDiv')).forEach((el) => {
        const tag = el.querySelector('span[data][qid], span[data]');
        if (!tag) return;
        const uuid = String(tag.getAttribute('qid') || '');
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
      return {
        key: String.fromCharCode(65 + i),
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
    if (!isJudge) return /^[A-H]+$/i.test(v) ? v.toUpperCase() : v;
    const k = judgeKey(q, v);
    return k || (/^[A-H]+$/i.test(v) ? v.toUpperCase() : v);
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
        return { key: String.fromCharCode(65 + k), text: cleanOption(raw, k), raw, el, answered: false };
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
