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
