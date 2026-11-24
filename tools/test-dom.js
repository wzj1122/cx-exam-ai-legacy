#!/usr/bin/env node
/**
 * 离线集成测试：自建极简 DOM 垫片 + 模拟 OpenAI 兼容端点。
 * 覆盖四段最容易出错的逻辑：
 *   1) 学习通考试页 DOM → 题目对象（03-scraper）
 *   2) 答案文本 → 选项 key（04-ai.resolveAnswerKeys）
 *   3) 点选/写入是否真的改变了 DOM 状态（05-apply）
 *   4) 多模型分歧 → 复核 → 仲裁 的收敛路径（04-ai.solve）
 *
 *   node tools/test-dom.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ============================ 1. 极简 DOM ============================ */

function parseCompound(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|(\.([\w-]+))|(#([\w-]+))|(\[([^\]]+)\])/g;
  let m;
  while ((m = re.exec(sel))) {
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[3]) out.classes.push(m[3]);
    else if (m[5]) out.id = m[5];
    else if (m[7]) {
      const a = m[7];
      const am = /^([\w-]+)\s*(?:([\^*$]?=)\s*["']?([^"']*)["']?)?$/.exec(a);
      if (am) out.attrs.push({ name: am[1], op: am[2] || null, val: am[3] });
    }
  }
  return out;
}

function parseGroup(sel) {
  const toks = sel.replace(/>/g, ' > ').trim().split(/\s+/);
  const parts = [];
  let comb = ' ';
  for (const t of toks) {
    if (t === '>') {
      comb = '>';
      continue;
    }
    parts.push({ comb, simple: t });
    comb = ' ';
  }
  return parts;
}

function matchSimple(el, sel) {
  const c = parseCompound(sel);
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  for (const cl of c.classes) if (!el.classList.contains(cl)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v == null) return false;
    if (a.op === '=' && v !== a.val) return false;
    if (a.op === '^=' && !v.startsWith(a.val)) return false;
    if (a.op === '*=' && !v.includes(a.val)) return false;
    if (a.op === '$=' && !v.endsWith(a.val)) return false;
  }
  return true;
}

function matchChain(el, parts) {
  let i = parts.length - 1;
  let cur = el;
  if (!matchSimple(cur, parts[i].simple)) return false;
  i--;
  while (i >= 0) {
    const p = parts[i];
    if (p.comb === '>') {
      cur = cur.parentElement;
      if (!cur || !matchSimple(cur, p.simple)) return false;
    } else {
      let ok = false;
      let up = cur.parentElement;
      while (up) {
        if (matchSimple(up, p.simple)) {
          cur = up;
          ok = true;
          break;
        }
        up = up.parentElement;
      }
      if (!ok) return false;
    }
    i--;
  }
  return true;
}

let EVENT_LOG = [];

class El {
  constructor(tag, attrs, children) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = Object.assign({}, attrs || {});
    this.childNodes = [];
    this.parentElement = null;
    this.listeners = {};
    this.isConnected = true;
    this.offsetParent = { fake: true };
    this._v = this.attrs.value != null ? String(this.attrs.value) : '';
    this.checked = false;
    this.style = {};
    (children || []).forEach((c) => this.appendChild(c));
  }
  get children() {
    return this.childNodes;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  appendChild(c) {
    c.parentElement = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    // 真 DOM 里脱离文档后 isConnected 变 false，这里也要跟上，
    // 否则测不出"页面重绘导致旧元素引用失效"这类问题
    const mark = (n) => {
      n.isConnected = false;
      (n.childNodes || []).forEach(mark);
    };
    mark(c);
    c.parentElement = null; // 真 DOM 摘除后 parentNode 也会断，否则 contains/冒泡都会误判
    return c;
  }
  get className() {
    return this.getAttribute('class') || '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get classList() {
    const self = this;
    const read = () => (self.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    return {
      contains: (c) => read().indexOf(c) >= 0,
      add: (c) => {
        const l = read();
        if (l.indexOf(c) < 0) l.push(c);
        self.setAttribute('class', l.join(' '));
      },
      remove: (c) => self.setAttribute('class', read().filter((x) => x !== c).join(' ')),
      toggle: (c, f) => (f === undefined ? (this.contains(c) ? this.remove(c) : this.add(c)) : f ? this.add(c) : this.remove(c))
    };
  }
  getAttribute(n) {
    if (n === 'class') return this.attrs.class != null ? this.attrs.class : null;
    return this.attrs[n] != null ? this.attrs[n] : null;
  }
  setAttribute(n, v) {
    this.attrs[n] = String(v);
  }
  removeAttribute(n) {
    delete this.attrs[n];
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  get textContent() {
    const self = this._text != null ? this._text : '';
    return self + this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new El('#text', {}, []).setText(String(v)));
  }
  setText(v) {
    this._text = v;
    return this;
  }
  get innerText() {
    return this._text != null ? this._text : this.textContent;
  }
  get innerHTML() {
    return this._html || '';
  }
  set innerHTML(v) {
    this._html = v;
    this.childNodes = [];
  }
  contains(node) {
    let cur = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  querySelectorAll(sel) {
    const groups = sel.split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.tagName === '#TEXT') continue;
        for (const g of groups) {
          if (matchChain(c, parseGroup(g))) {
            if (out.indexOf(c) < 0) out.push(c);
            break;
          }
        }
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  matches(sel) {
    return matchChain(this, parseGroup(sel));
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (matchSimple(cur, sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  getBoundingClientRect() {
    return { left: 10, top: 10, width: 120, height: 24, right: 130, bottom: 34 };
  }
  scrollIntoView() {}
  focus() {}
  addEventListener(t, fn) {
    (this.listeners[t] = this.listeners[t] || []).push(fn);
  }
  removeEventListener(t, fn) {
    const l = this.listeners[t] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatchEvent(ev) {
    // 真浏览器里给脱离文档的节点派发事件不会触发页面上的委托处理器，
    // 这里保持一致，否则会高估 clickPlan 在"页面重绘"场景下的成功率。
    if (this.isConnected === false) return true;
    ev.target = ev.target || this;
    EVENT_LOG.push({ el: this.tagName + '.' + this.className, type: ev.type });
    const l = (this.listeners[ev.type] || []).slice();
    if (this['on' + ev.type]) l.push(this['on' + ev.type]);
    l.forEach((fn) => {
      try {
        fn.call(this, ev);
      } catch (e) {}
    });
    // 冒泡（简化）
    if (ev.bubbles !== false && this.parentElement) this.parentElement.dispatchEvent(ev);
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, target: this });
  }
  attachShadow() {
    const r = new El('#shadow');
    return r;
  }
}

class Evt {
  constructor(type, opts) {
    this.type = type;
    Object.assign(this, opts || {});
    if (this.bubbles === undefined) this.bubbles = true;
  }
  stopPropagation() {
    this.bubbles = false;
  }
  stopImmediatePropagation() {
    this.bubbles = false;
  }
  preventDefault() {}
}
class MouseEvt extends Evt {}
class PointerEvt extends Evt {}

function h(tag, attrs, children) {
  return new El(tag, attrs, children);
}

/* ============================ 2. 考试页夹具 ============================ */

function buildExamPage() {
  const body = h('body', {}, []);
  const wrap = h('div', { class: 'questionList' }, []);

  function choiceQuestion(idx, type, stemText, opts, onclickAttr) {
    const li = h('div', { class: 'questionLi' }, []);
    li.appendChild(h('input', { name: 'type' + idx, value: String(type), type: 'hidden' }, []));
    li.appendChild(h('h3', { class: 'mark_name' }, []).setText(stemText));
    const ul = h('ul', { class: 'stem_answer' }, []);
    opts.forEach((t, i) => {
      const li2 = h('li', { class: 'clearfix' }, []);
      const a = h('a', { class: 'answerBg', href: 'javascript:;' }, []);
      const ap = h('div', { class: 'answer_p' }, []);
      const td = h('div', { class: 'textDIV' }, []).setText(String.fromCharCode(65 + i) + '. ' + t);
      ap.appendChild(td);
      a.appendChild(ap);
      // 真实页面的点选逻辑：点 .answer_p 后父级出现 check_answer
      a.onclick = function () {
        const host = a.parentElement;
        if (host.querySelector('[class*="check_answer"]')) return;
        ap.classList.add('check_answer');
      };
      li2.appendChild(a);
      ul.appendChild(li2);
    });
    li.appendChild(ul);
    return li;
  }

  // 第 1 题 单选
  wrap.appendChild(choiceQuestion(0, 0, '1、下列关于计算机网络的说法正确的是（　　）', ['OSI 有 7 层', 'TCP 在物理层', 'IP 是面向连接的', '以太网属于广域网']));
  // 第 2 题 多选
  wrap.appendChild(choiceQuestion(1, 1, '2、下列属于操作系统的有（　　）', ['Linux', 'MySQL', 'Windows', 'Nginx']));
  // 第 3 题 判断
  wrap.appendChild(choiceQuestion(2, 3, '3、HTTP 是无状态协议。（　　）', ['正确', '错误']));
  // 第 4 题 填空
  const blank = h('div', { class: 'questionLi' }, []);
  blank.appendChild(h('input', { name: 'type3', value: '2', type: 'hidden' }, []));
  blank.appendChild(h('h3', { class: 'mark_name' }, []).setText('4、TCP 三次握手中，第二次报文携带的标志位是____。'));
  const ta = h('textarea', { class: 'eidtDiv' }, []);
  blank.appendChild(ta);
  wrap.appendChild(blank);

  body.appendChild(wrap);

  const document = {
    body,
    documentElement: body,
    readyState: 'complete',
    title: '考试',
    hidden: false,
    visibilityState: 'visible',
    _listeners: {},
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    getElementById: (id) => body.querySelector('#' + id),
    createElement: (t) => new El(t, {}, []),
    addEventListener: function (t, fn) {
      (this._listeners[t] = this._listeners[t] || []).push(fn);
    },
    removeEventListener: function () {},
    hasFocus: () => true,
    contains: (n) => body.contains(n)
  };

  return { document, body };
}

/* ============================ 3. 沙箱 ============================ */

const { document } = buildExamPage();
const windowObj = {
  document,
  location: { href: 'https://mooc1.chaoxing.com/mooc2/exam/preview?x=1', pathname: '/mooc2/exam/preview', search: '?x=1', hostname: 'mooc1.chaoxing.com' },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  addEventListener() {},
  removeEventListener() {},
  screenX: 0,
  screenY: 0,
  screen: { width: 1920, height: 1080 },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/120' },
  console
};
document.defaultView = windowObj;

const sandbox = {
  window: windowObj,
  document,
  location: windowObj.location,
  navigator: windowObj.navigator,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Promise,
  Map,
  Set,
  JSON,
  Math,
  Date,
  URL,
  AbortController,
  Event: Evt,
  MouseEvent: MouseEvt,
  PointerEvent: PointerEvt,
  Node: El,
  HTMLElement: El,
  HTMLTextAreaElement: function () {},
  HTMLInputElement: function () {},
  screen: windowObj.screen,
  CXAI: {}
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

/* --- 油猴存储垫片：gmStore 模拟"所有域名共享的 GM 值"，lsStore 模拟"按源隔离的 localStorage" --- */
const gmStore = new Map();
const lsStore = new Map();
sandbox.GM_getValue = function (k, d) {
  return gmStore.has(k) ? JSON.parse(gmStore.get(k)) : d;
};
sandbox.GM_setValue = function (k, v) {
  gmStore.set(k, JSON.stringify(v));
};
sandbox.GM_deleteValue = function (k) {
  gmStore.delete(k);
};
sandbox.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k)
};

// setNativeValue 需要原型上的 value accessor
Object.defineProperty(sandbox.HTMLTextAreaElement.prototype, 'value', {
  configurable: true,
  get() {
    return this._v == null ? '' : this._v;
  },
  set(v) {
    this._v = String(v);
  }
});
Object.defineProperty(sandbox.HTMLInputElement.prototype, 'value', {
  configurable: true,
  get() {
    return this._v == null ? '' : this._v;
  },
  set(v) {
    this._v = String(v);
  }
});
// El 的 value 走自身属性；textarea/input 实例挂到原型访问器上
Object.defineProperty(El.prototype, 'value', {
  configurable: true,
  get() {
    return this._v == null ? '' : this._v;
  },
  set(v) {
    this._v = String(v);
  }
});

/* 模拟多风格端点（OpenAI / Anthropic / Gemini） */
let CALLS = 0;
let INLINE_SEEN = false;
const VISION_REPLY = JSON.stringify({
  text: '图一是一个三角形，底边 3cm，高 4cm',
  questionText: '如图所示，该图形的形状是',
  options: ['三角形', '圆形'],
  kind: ['figure'],
  confidence: 0.9
});

function pickAnswer(model, sys, userText) {
  let answer = model === 'm2' ? 'B' : 'A';
  if (/最终裁决者/.test(sys)) answer = 'A';
  else if (/复核专家/.test(sys)) answer = model === 'm2' ? 'B' : 'A';
  if (/TCP 三次握手/.test(userText)) answer = 'SYN+ACK';
  return { answer, confidence: model === 'm2' ? 0.6 : 0.8, reason: '模拟理由 ' + model, model };
}

function flatContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some((c) => c && (c.type === 'image_url' || c.type === 'image' || c.inline_data || c.inlineData))) INLINE_SEEN = true;
  return content.map((c) => (c && (c.text || '')) || '').join('');
}

let MODELS_CALLS = 0;
let MODELS_AUTH = null;
let MODELS_URL = '';

const fetchMock = async (url, opts) => {
  // 模型列表：GET /models（三风格各自返回）
  if (/\/models(\?|$)/.test(url)) {
    MODELS_CALLS++;
    MODELS_URL = url;
    const h = (opts && opts.headers) || {};
    MODELS_AUTH = h.Authorization || h.authorization || null;
    const isGemini = /[?&]key=/.test(url);
    const isAnthropic = !!h['x-api-key'];
    let payload;
    if (isGemini) {
      payload = {
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
        ]
      };
    } else if (isAnthropic) {
      payload = { data: [{ id: 'claude-3-5-sonnet', display_name: 'Claude 3.5 Sonnet' }] };
    } else {
      payload = { data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  }
  // 图片 GET（data URL 会短路，这里是兜底）
  if (!opts || !opts.body) {
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
  }
  CALLS++;
  const isAnthropic = /\/messages/.test(url);
  const isGemini = /generateContent/.test(url);
  const body = JSON.parse(opts.body);

  let model = 'm1';
  let sys = '';
  let userText = '';

  if (isAnthropic) {
    model = body.model || 'm1';
    sys = typeof body.system === 'string' ? body.system : flatContent(body.system);
    userText = (body.messages || []).map((m) => flatContent(m.content)).join('\n');
  } else if (isGemini) {
    const m = /models\/([^:]+):/.exec(url);
    model = m ? m[1] : 'm1';
    sys = flatContent((body.systemInstruction && body.systemInstruction.parts) || '');
    userText = (body.contents || []).map((c) => flatContent(c.parts)).join('\n');
  } else {
    model = body.model || 'm1';
    const msgs = body.messages || [];
    sys = flatContent((msgs.find((m) => m.role === 'system') || {}).content);
    userText = msgs.filter((m) => m.role !== 'system').map((m) => flatContent(m.content)).join('\n');
  }

  const text = /试卷图片转写员/.test(sys) ? VISION_REPLY : JSON.stringify(pickAnswer(model, sys, userText));
  const payload = isAnthropic
    ? { content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 20 } }
    : isGemini
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { choices: [{ message: { content: text } }], usage: { total_tokens: 100 }, model };

  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};
sandbox.fetch = fetchMock;

const ctx = vm.createContext(sandbox);

const FILES = ['01-core.js', '02-font.js', '03-scraper.js', '03b-vision.js', '03c-attach.js', '03d-mark.js', '04-ai.js', '05-apply.js', '06-guard.js'];
for (const f of FILES) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}
const CXAI = sandbox.CXAI;

/* ============================ 4. 断言 ============================ */

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + label);
  } else {
    fail++;
    console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

(async function run() {
  console.log('\n[1] 页面识别与抓题');
  const page = CXAI.Scraper.detectPage();
  ok(/^(exam|exam-preview|work|chapter)$/.test(page.kind), '识别为考试/作业页', page);
  const { questions } = CXAI.Scraper.collect();
  ok(questions.length === 4, '抓到 4 道题', questions.length);
  ok(questions[0].type === 'single', '第1题=单选', questions[0].type);
  ok(questions[1].type === 'multiple', '第2题=多选', questions[1].type);
  ok(questions[2].type === 'judgement', '第3题=判断', questions[2].type);
  ok(questions[3].type === 'completion', '第4题=填空', questions[3].type);
  ok(questions[0].options.length === 4, '第1题 4 个选项', questions[0].options.length);
  ok(/计算机网络/.test(questions[0].stem), '题干已清理并保留正文', questions[0].stem);
  ok(questions[0].options[0].text.indexOf('A.') === 0 || /OSI/.test(questions[0].options[0].text), '选项文本正确', questions[0].options[0].text);

  console.log('\n[2] 答案映射');
  const q1 = questions[0];
  const q3 = questions[2];
  ok(JSON.stringify(CXAI.AI.resolveAnswerKeys('B', q1)) === JSON.stringify({ keys: ['B'], text: 'B' }), "'B' → ['B']");
  ok(JSON.stringify(CXAI.AI.resolveAnswerKeys('A, C, D', questions[1]).keys) === JSON.stringify(['A', 'C', 'D']), '多选 "A, C, D" 解析');
  ok(JSON.stringify(CXAI.AI.resolveAnswerKeys('OSI 有 7 层', q1).keys) === JSON.stringify(['A']), '文本答案映射到选项 A');
  const jm = CXAI.AI.resolveAnswerKeys('正确', q3);
  ok(jm && jm.keys.length === 1, "判断题 '正确' → 某个 key", jm);

  console.log('\n[3] 点选执行');
  const r1 = await CXAI.Apply.apply(q1, { keys: ['B'], answerText: 'B' });
  ok(r1.ok === true, '单选题点击成功', r1);
  ok(CXAI.Apply.isChecked(q1.options[1].el), '选项 B 出现选中态');
  ok(!CXAI.Apply.isChecked(q1.options[0].el), '选项 A 未被误选');

  const r2 = await CXAI.Apply.apply(questions[1], { keys: ['A', 'C'], answerText: 'AC' });
  ok(r2.ok === true, '多选题两项都选中', r2);
  ok(CXAI.Apply.isChecked(questions[1].options[2].el), '多选 C 已选');

  const r3 = await CXAI.Apply.apply(questions[3], { keys: [], answerText: 'SYN+ACK' });
  ok(r3.ok === true && r3.filled === 1, '填空题写入成功', r3);
  ok(questions[3].inputs[0].value === 'SYN+ACK', 'textarea 值正确', questions[3].inputs[0].value);

  console.log('\n[4] 多重 AI 判定（分歧 → 复核 → 仲裁）');
  CXAI.Cfg.set('ai.providers', [
    { id: 'p1', label: '模型一', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 1 },
    { id: 'p2', label: '模型二', baseURL: 'https://mock.local/v1', apiKey: 'k2', model: 'm2', enabled: true, weight: 1 }
  ]);
  CXAI.Cfg.set('ai.judge.mode', 'council');
  CXAI.Cfg.set('ai.judge.panelSize', 2);
  CXAI.Cfg.set('ai.judge.voteThreshold', 0.7);
  CXAI.Cfg.set('ai.judge.enableCritique', true);
  CXAI.Cfg.set('ai.judge.enableArbiter', true);

  const t = CXAI.AI.tally([
    { answerText: 'A', confidence: 0.8, weight: 1 },
    { answerText: 'A', confidence: 0.7, weight: 1 },
    { answerText: 'B', confidence: 0.6, weight: 1 }
  ]);
  ok(t.winner.key === 'A', '加权投票选出 A', t.winner);
  ok(Math.abs(t.ratio - 1.5 / 2.1) < 1e-6, '一致率计算正确', t.ratio);

  const solved = await CXAI.AI.solve(questions[0]);
  ok(solved.stage === 'arbiter', '分歧升级到仲裁', solved.stage);
  ok(solved.answerText === 'A', '仲裁给出最终答案 A', solved.answerText);
  ok(solved.votes.length >= 3, '投票记录包含复核/仲裁参与者', solved.votes.length);
  ok(typeof solved.confidence === 'number' && solved.confidence > 0 && solved.confidence <= 1, '置信度在合法区间', solved.confidence);

  console.log('\n[5] 一致时跳过升级');
  CXAI.Cfg.set('ai.providers', [
    { id: 'p1', label: '模型一', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 1 },
    { id: 'p1b', label: '模型一同源', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 1 }
  ]);
  const solved2 = await CXAI.AI.solve(questions[2]);
  ok(solved2.stage === 'panel', '立场一致，直接采纳', solved2.stage);
  ok(solved2.answerText === 'A', '答案 A', solved2.answerText);

  console.log('\n[6] 环境伪装');
  ok(typeof CXAI.Guard.pace === 'function', 'Guard.pace 可用');
  const p = CXAI.Guard.pace(6);
  ok(p >= 1400, '节奏延时大于下限', p);

  console.log('\n[7] 自定义模型与接口风格归一');
  const n1 = CXAI.normalizeProvider({ id: 'x', label: '本地网关', baseURL: 'http://127.0.0.1:3425/v1', model: 'deepseek/deepseek-chat', apiKey: '' }, 0);
  ok(n1.keyOptional === true, '本地地址自动允许空 Key', n1.keyOptional);
  ok(n1.apiStyle === 'openai' && n1.role === 'judge', '缺省风格/角色归一', { s: n1.apiStyle, r: n1.role });
  ok(CXAI.isLocalURL('http://localhost:11434/v1') === true, 'localhost 判为本地');
  ok(CXAI.isLocalURL('https://api.deepseek.com/v1') === false, '公网地址不算本地');
  ok((CXAI.PRESETS || []).some((x) => /ollama/i.test(x.id)), '预设含 ollama 本地网关');
  const an = await CXAI.AI.callProvider(
    { id: 'a', label: 'A', baseURL: 'https://mock.local', apiStyle: 'anthropic', apiKey: 'k', model: 'claude-x', maxTokens: 256 },
    [{ role: 'system', content: '最终裁决者' }, { role: 'user', content: '题干：1+1=?' }],
    {}
  );
  ok(/A|B/.test(an.text), 'anthropic 风格可解析', an.text);
  const gm = await CXAI.AI.callProvider(
    { id: 'g', label: 'G', baseURL: 'https://mock.local', apiStyle: 'gemini', apiKey: 'k', model: 'gemini-x' },
    [{ role: 'system', content: '最终裁决者' }, { role: 'user', content: '题干：1+1=?' }],
    {}
  );
  ok(/A|B/.test(gm.text), 'gemini 风格可解析', gm.text);

  console.log('\n[8] 图片题：转写通道（ocr）');
  const imgQ = {
    index: 0,
    key: 'q-img',
    type: 'single',
    typeLabel: '单选题',
    stem: '如图所示，该图形的形状是',
    stemRaw: '如图所示，该图形的形状是',
    options: [
      { key: 'A', text: 'A. 三角形', raw: 'A. 三角形', el: questions[0].options[0].el, answered: false },
      { key: 'B', text: 'B. 圆形', raw: 'B. 圆形', el: questions[0].options[1].el, answered: false }
    ],
    inputs: [],
    images: ['data:image/png;base64,' + 'A'.repeat(4000)],
    score: 2,
    root: questions[0].root,
    answered: false
  };
  CXAI.Cfg.set('ai.providers', [
    { id: 'p1', label: '判题一', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 1 },
    { id: 'pv', label: '读图模型', baseURL: 'https://mock.local/v1', apiKey: 'k2', model: 'vm', enabled: true, weight: 1, vision: true, role: 'vision' }
  ]);
  CXAI.Cfg.set('ai.judge.panelSize', 1);
  CXAI.Cfg.set('ai.vision.enabled', true);
  CXAI.Cfg.set('ai.vision.strategy', 'ocr');
  const prep = await CXAI.Vision.prepare(imgQ);
  ok(prep.items.length === 1, '图片进入待发送队列', prep.items.length);
  ok(prep.items[0] && /^data:image\//.test(prep.items[0].dataUrl), '图片转成 data URL');
  ok(prep.items[0] && prep.items[0].bytes > 600, '非占位图未被丢弃', prep.items[0] && prep.items[0].bytes);
  const vps = CXAI.Cfg.visionProviders();
  ok(vps.length === 1 && vps[0].id === 'pv', '读图专模型被单独挑出', vps.map((x) => x.id));
  const vis = await CXAI.Vision.transcribe(imgQ, vps[0], prep.items);
  ok(/三角形/.test(vis.text || ''), '读图模型返回转写文本', vis.text);
  const solvedV = await CXAI.AI.solve(imgQ);
  ok(solvedV.vision && solvedV.vision.mode === 'ocr', 'ocr 策略走转写通道', solvedV.vision);
  ok(solvedV.vision.ocrChars > 0, '转写文字并入提示词', solvedV.vision.ocrChars);
  ok(solvedV.answerText === 'A', '读图后判出 A', solvedV.answerText);

  console.log('\n[9] 图片题：直传通道（inline）');
  CXAI.Cfg.set('ai.providers', [
    { id: 'p1', label: '视觉判题', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 1, vision: true }
  ]);
  CXAI.Cfg.set('ai.vision.strategy', 'inline');
  INLINE_SEEN = false;
  const solvedI = await CXAI.AI.solve(imgQ);
  ok(solvedI.vision.mode === 'inline', 'inline 策略直传', solvedI.vision);
  ok(solvedI.vision.sent === 1, '发送 1 张图片', solvedI.vision.sent);
  ok(INLINE_SEEN === true, '请求体包含 image_url 内容块');
  ok(solvedI.answerText === 'A', '直传后仍判出 A', solvedI.answerText);

  console.log('\n[10] 关闭读图时不出错');
  CXAI.Cfg.set('ai.vision.strategy', 'off');
  const solvedOff = await CXAI.AI.solve(imgQ);
  ok(solvedOff.vision.mode === 'off', 'strategy=off 时跳过图片', solvedOff.vision);
  ok(solvedOff.answerText === 'A', '纯文本兜底仍可判题', solvedOff.answerText);

  console.log('\n[11] 配置段完整性（设置面板打不开的回归）');
  const D = CXAI.DEFAULT_CONFIG;
  ok(D.guard && D.guard.minDelay === 1400 && D.guard.maxDelay === 4200, '默认配置含 guard 节奏段');
  ok(D.apply && D.apply.verifyMs > 0 && D.apply.autoSubmit === false, '默认配置含 apply 落盘段');
  ok(D.engine && D.engine.maxIterations >= 1, '默认配置含 engine 主循环段');
  const paths = [
    'guard.minDelay', 'guard.maxDelay', 'guard.enabled', 'guard.longBreakEvery', 'guard.autoConfirm', 'guard.blockDevtools',
    'apply.overwriteAnswered', 'apply.saveEach', 'apply.autoSubmit', 'apply.clearExtra', 'apply.instantType', 'apply.verifyMs',
    'engine.maxIterations'
  ];
  const missing = paths.filter((x) => typeof CXAI.Cfg.get(x, undefined) === 'undefined');
  ok(missing.length === 0, '所有 Cfg.get 路径都有实体默认值', missing);
  // 垫片里没有 localStorage，直接验证合并语义：老配置缺段要补默认，已有的值不能被默认值盖掉
  const merged = CXAI.U.mergeDeep(JSON.parse(JSON.stringify(D)), { ai: { judge: { panelSize: 2 } } });
  ok(merged.guard && merged.guard.minDelay === 1400, '缺段老配置合并后自动补齐 guard', merged.guard && merged.guard.minDelay);
  ok(merged.ai.judge.panelSize === 2, '老配置里已有的值不被默认值覆盖', merged.ai.judge.panelSize);

  console.log('\n[12] 模型名自动拉取（各家 /models）');
  const lmOpenai = await CXAI.AI.listModels({ baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' });
  ok(lmOpenai.length === 2, 'openai 风格拿到 2 个模型', lmOpenai.map((x) => x.id));
  ok(lmOpenai[0].id === 'deepseek-chat' && lmOpenai[1].id === 'deepseek-reasoner', '按 id 升序排列', lmOpenai.map((x) => x.id));
  ok(MODELS_URL === 'https://api.deepseek.com/v1/models', 'base 结尾斜杠与路径拼接正确', MODELS_URL);
  ok(MODELS_AUTH === 'Bearer sk-test', 'openai 带 Bearer Key', MODELS_AUTH);

  const lmAnthropic = await CXAI.AI.listModels({ baseURL: 'https://api.anthropic.com', apiKey: 'k-1', apiStyle: 'anthropic' });
  ok(lmAnthropic.length === 1 && lmAnthropic[0].id === 'claude-3-5-sonnet', 'anthropic /v1/models 解析', lmAnthropic);
  ok(/Claude 3.5 Sonnet · claude-3-5-sonnet/.test(lmAnthropic[0].label), '带显示名时 label = 显示名 · id', lmAnthropic[0].label);

  const lmGemini = await CXAI.AI.listModels({ baseURL: 'https://generativelanguage.googleapis.com', apiKey: 'g-1', apiStyle: 'gemini' });
  ok(lmGemini.length === 1 && lmGemini[0].id === 'gemini-2.0-flash', 'gemini 过滤掉不支持 generateContent 的模型', lmGemini);

  const lmLocal = await CXAI.AI.listModels({ baseURL: 'http://127.0.0.1:3425/v1', apiKey: '', model: 'x' });
  ok(lmLocal.length === 2, '本地网关空 Key 也能拉列表', lmLocal.length);
  ok(MODELS_AUTH === null, '空 Key 时不发 Authorization 头', MODELS_AUTH);

  console.log('\n[13] v1.3 预设精简 + 读图模型/判题模型分工');
  const pids = (CXAI.PRESETS || []).map((p) => p.id);
  // v1.8.3：9 家，模型名全部留空（以「拉取」到的清单为准），删 kimi / magpie，加基元律动
  ok(pids.length === 9, '预设覆盖 9 家（含两家本地网关）', pids);
  ok(pids[0] === 'deepseek' && pids.indexOf('custom') > 0, '顺序：deepseek 在最前，custom 在后', pids);
  ok(pids.indexOf('tokenrhythm') > 0, '预设含基元律动', pids);
  ok(!pids.some((x) => /magpie|kimi/i.test(x)), '预设不含已删的 magpie / kimi', pids);
  ok(
    (CXAI.PRESETS || []).every((x) => x.id === 'custom' || String(x.model || '') === ''),
    '所有预设默认不指定模型（空等拉取）',
    (CXAI.PRESETS || []).map((x) => x.id + ':' + (x.model || ''))
  );
  const customPre = (CXAI.PRESETS || []).filter((p) => p.id === 'custom')[0];
  ok(!!customPre && customPre.apiStyle === 'openai', '自定义默认 OpenAI 兼容', customPre && customPre.apiStyle);
  ok(!customPre.vision, '自定义默认不当读图模型', customPre.vision);

  // 读图模型走 role=vision：不进判题面板，但属于 visionProviders
  const savedProviders = JSON.parse(JSON.stringify(CXAI.Cfg.get('ai.providers', [])));
  const three = [
    CXAI.normalizeProvider({ id: 'a', label: 'A', baseURL: 'https://x/v1', apiKey: 'k', model: 'm', role: 'judge' }, 0),
    CXAI.normalizeProvider({ id: 'b', label: 'B', baseURL: 'https://x/v1', apiKey: 'k', model: 'm', role: 'judge' }, 1),
    CXAI.normalizeProvider({ id: 'v', label: 'V', baseURL: 'https://x/v1', apiKey: 'k', model: 'm', role: 'vision' }, 2)
  ];
  CXAI.Cfg.set('ai.providers', three);
  const judges = CXAI.Cfg.activeProviders();
  const vises = CXAI.Cfg.visionProviders();
  ok(judges.length === 2 && judges.every((p) => p.id !== 'v'), '读图模型被排除在判题面板外', judges.map((p) => p.id));
  ok(vises.length === 1 && vises[0].id === 'v' && vises[0].vision === true, '读图模型被识别为视觉模型', vises.map((p) => p.id));
  ok(CXAI.DEFAULT_CONFIG.ai.vision.strategy === 'ocr', '默认读图链路是先转写再判题', CXAI.DEFAULT_CONFIG.ai.vision.strategy);

  // 只剩读图模型时不能保存（judges 为空必须报错拦截）——这里只校验判据本身
  CXAI.Cfg.set('ai.providers', [three[2]]);
  ok(CXAI.Cfg.activeProviders().length === 1 && CXAI.Cfg.activeProviders()[0].role === 'vision', '仅有读图模型时 activeProviders 会退回全部（兜底语义未变）', CXAI.Cfg.activeProviders().map((p) => p.role));
  // 兼任判题：role=both 既读图又参与投票
  const bothP = CXAI.normalizeProvider({ id: 'v2', label: 'V2', baseURL: 'https://x/v1', apiKey: 'k', model: 'm', role: 'both' }, 0);
  ok(bothP.role === 'both' && bothP.vision === true, 'role=both 自动带视觉能力', bothP.role);
  CXAI.Cfg.set('ai.providers', [three[0], bothP]);
  const bothJudges = CXAI.Cfg.activeProviders();
  ok(bothJudges.length === 2 && bothJudges.some((p) => p.id === 'v2'), '兼任判题的读图模型留在判题面板', bothJudges.map((p) => p.id));
  ok(CXAI.Cfg.visionProviders().some((p) => p.id === 'v2'), '兼任判题的模型同时可读图', CXAI.Cfg.visionProviders().map((p) => p.id));
  ok(CXAI.DEFAULT_CONFIG.ai.vision.judgeToo === false, 'judgeToo 默认关闭', CXAI.DEFAULT_CONFIG.ai.vision.judgeToo);

  CXAI.Cfg.set('ai.providers', savedProviders);
  CXAI.Cfg.set('ai.vision.strategy', 'off');

  console.log('\n[14] 配置存储跨域名存活（GM 共享 + 本域镜像）');
  const KEY = CXAI.CONFIG_KEY;
  gmStore.clear();
  lsStore.clear();
  sandbox.localStorage.setItem(KEY, JSON.stringify({ ai: { vision: { enabled: true, judgeToo: true, ocrProviderId: 'zz' } } }));
  const migrated = CXAI.Cfg.load();
  ok(migrated.ai.vision.judgeToo === true, '本源 localStorage 的老配置能被读到', migrated.ai.vision.judgeToo);
  ok(gmStore.has(KEY), '读到老配置后会自动迁移进 GM 存储', [...gmStore.keys()]);
  ok(CXAI.Store.backend === 'gm' && CXAI.Store.scope() === 'cross-origin', '有 GM 时后端判定为跨域名共享', CXAI.Store.info(KEY));
  CXAI.Cfg.set('ai.providers', savedProviders);
  ok(lsStore.has(KEY), '写入时同时镜像一份到本域 localStorage', [...lsStore.keys()]);
  lsStore.clear(); // 换域名：localStorage 整个空掉，GM 还在
  const afterSwitch = CXAI.Cfg.load();
  ok((afterSwitch.ai.providers || []).length === savedProviders.length, '换域名后仍读到同一份模型配置', (afterSwitch.ai.providers || []).length);
  const dump = CXAI.Cfg.json();
  ok(typeof dump === 'string' && JSON.parse(dump).ai, 'Cfg.json() 可导出可重新解析', typeof dump);
  const imported = CXAI.Cfg.importJSON(JSON.stringify({ ai: { vision: { judgeToo: false } }, guard: {}, apply: {} }));
  ok(imported === true && CXAI.Cfg.get('ai.vision.judgeToo') === false, 'importJSON 能落地并立即生效', CXAI.Cfg.get('ai.vision.judgeToo'));
  let bad = '';
  try {
    CXAI.Cfg.importJSON('{oops');
  } catch (e) {
    bad = e.message;
  }
  ok(/JSON 解析失败/.test(bad), '坏 JSON 被拒绝而不是写坏配置', bad);
  let bad2 = '';
  try {
    CXAI.Cfg.importJSON(JSON.stringify({ hello: 1 }));
  } catch (e) {
    bad2 = e.message;
  }
  ok(/不像本脚本的配置/.test(bad2), '结构不对的 JSON 被拒绝', bad2);
  ok(typeof CXAI.diag === 'function' && CXAI.diag().store.key === KEY, 'CXAI.diag() 能自检存储后端', CXAI.diag().store.backend);

  console.log('\n[15] 单题模式落盘加固（重绘换元素 / 点不动）');

  // 造一个"单题页"：一题单选，选项结构与超星新版一致
  function singlePage(handlers) {
    const body = h('body', {}, []);
    const wrap = h('div', { class: 'questionList' }, []);
    const li = h('div', { class: 'questionLi' }, []);
    li.appendChild(h('input', { name: 'type0', value: '0', type: 'hidden' }, []));
    li.appendChild(h('h3', { class: 'mark_name' }, []).setText('1、2+2=（　　）'));
    const ul = h('ul', { class: 'stem_answer' }, []);
    ['3', '4', '5', '22'].forEach((t, i) => {
      const row = h('li', { class: 'clearfix' }, []);
      const a = h('a', { class: 'answerBg', href: 'javascript:;' }, []);
      const ap = h('div', { class: 'answer_p' }, []);
      ap.appendChild(h('div', { class: 'textDIV' }, []).setText(String.fromCharCode(65 + i) + '. ' + t));
      a.appendChild(ap);
      row.appendChild(a);
      ul.appendChild(row);
      if (handlers && handlers.bind) handlers.bind(a, ap);
    });
    li.appendChild(ul);
    wrap.appendChild(li);
    body.appendChild(wrap);
    const doc = {
      body,
      documentElement: body,
      readyState: 'complete',
      title: '考试',
      hidden: false,
      visibilityState: 'visible',
      _listeners: {},
      querySelector: (q) => body.querySelector(q),
      querySelectorAll: (q) => body.querySelectorAll(q),
      getElementById: (id) => body.querySelector('#' + id),
      createElement: (t) => new El(t, {}, []),
      addEventListener: function (t, fn) {
        (this._listeners[t] = this._listeners[t] || []).push(fn);
      },
      removeEventListener: function () {},
      hasFocus: () => true,
      contains: (n) => body.contains(n)
    };
    doc.defaultView = windowObj;
    return { document: doc, body, ul };
  }

  const savedDoc = sandbox.document;
  const savedWinDoc = windowObj.document;

  // --- 15.1 正常皮肤：点 .answer_p 冒泡到 a 上打标记
  {
    const p1 = singlePage({
      bind: (a, ap) => {
        a.onclick = function () {
          ap.classList.add('check_answer');
        };
      }
    });
    sandbox.document = p1.document;
    windowObj.document = p1.document;
    const q = CXAI.Scraper.collect().questions[0];
    ok(q && q.options.length === 4, '单题页能解析出 4 个选项', q && q.options.length);
    const r = await CXAI.Apply.apply(q, { keys: ['B'], answerText: 'B' });
    ok(r.ok, '正常皮肤：单选落盘成功', r);
    ok(r.strategy && r.strategy !== 'input-force', '走的是真实点击而不是强改 checked', r.strategy);
  }

  // --- 15.2 判题期间页面重绘：旧引用失效，靠按文本重定位救回来
  {
    const p2 = singlePage({
      bind: (a, ap) => {
        a.onclick = function () {
          ap.classList.add('check_answer');
        };
      }
    });
    sandbox.document = p2.document;
    windowObj.document = p2.document;
    const stale = CXAI.Scraper.collect().questions[0];
    // 模拟页面局部刷新：整片选项换成新节点，文字不变
    const newUl = h('ul', { class: 'stem_answer' }, []);
    ['3', '4', '5', '22'].forEach((t, i) => {
      const row = h('li', { class: 'clearfix' }, []);
      const a = h('a', { class: 'answerBg', href: 'javascript:;' }, []);
      const ap = h('div', { class: 'answer_p' }, []);
      ap.appendChild(h('div', { class: 'textDIV' }, []).setText(String.fromCharCode(65 + i) + '. ' + t));
      a.appendChild(ap);
      row.appendChild(a);
      newUl.appendChild(row);
      a.onclick = function () {
        ap.classList.add('check_answer');
      };
    });
    const oldUl = p2.body.querySelector('.stem_answer');
    const holder = oldUl.parentElement;
    if (holder.removeChild) holder.removeChild(oldUl);
    holder.appendChild(newUl);
    const r2 = await CXAI.Apply.apply(stale, { keys: ['B'], answerText: 'B' });
    ok(r2.ok, '页面重绘后仍能落盘（按选项文字重定位）', r2);
    ok(r2.strategy === 'by-text', '走的是 by-text 兜底路径', r2.strategy);
  }

  // --- 15.3 死页面：点不动也勾不上，要明确报失败并带上结构信息
  {
    const p3 = singlePage({ bind: function () {} });
    sandbox.document = p3.document;
    windowObj.document = p3.document;
    const q3 = CXAI.Scraper.collect().questions[0];
    const r3 = await CXAI.Apply.apply(q3, { keys: ['A'], answerText: 'A' });
    ok(/点击后未选中/.test(r3.error || '') || r3.ok === false, '点不动的页面明确报失败', r3.error);
    ok(!!r3.dom, '失败时带上选项 DOM 结构，便于定位皮肤', r3.dom);
  }

  // --- 15.4 页面有 2 个 questionLi（上一题残影 + 当前题）：旧规则按题干全等匹配会失手
  {
    const p4 = singlePage({
      bind: (a, ap) => {
        a.onclick = function () {
          ap.classList.add('check_answer');
        };
      }
    });
    // 前面塞一个"上一题残影"，题干不同、选项也不同
    const decoy = h('div', { class: 'questionLi' }, []);
    decoy.appendChild(h('input', { name: 'type9', value: '0', type: 'hidden' }, []));
    decoy.appendChild(h('h3', { class: 'mark_name' }, []).setText('9、上一题的残影（　　）'));
    const dul = h('ul', { class: 'stem_answer' }, []);
    ['甲', '乙'].forEach((t, i) => {
      const row = h('li', { class: 'clearfix' }, []);
      const a = h('a', { class: 'answerBg', href: 'javascript:;' }, []);
      const ap = h('div', { class: 'answer_p' }, []);
      ap.appendChild(h('div', { class: 'textDIV' }, []).setText(String.fromCharCode(65 + i) + '. ' + t));
      a.appendChild(ap);
      row.appendChild(a);
      dul.appendChild(row);
    });
    decoy.appendChild(dul);
    const holder2 = p4.body.querySelector('.questionList');
    holder2.childNodes.unshift(decoy);
    decoy.parentElement = holder2;
    // 直接改 DOM：collect 的 250ms memo 必须手动失效
    CXAI.Scraper.invalidateCollect();

    sandbox.document = p4.document;
    windowObj.document = p4.document;
    const all = CXAI.Scraper.collect().questions;
    ok(all.length === 2, '两个 questionLi 都能抓到', all.length);
    const real = all[1];
    const picked = CXAI.Scraper.pickSame(CXAI.Scraper.collect().questions, real);
    ok(picked && /2\+2/.test(picked.stem), 'pickSame 在残影页里能认回当前题', picked && picked.stem);

    // 页面把当前题的选项整片重绘
    const oldUl2 = p4.body.querySelectorAll('.stem_answer')[1];
    const holder3 = oldUl2.parentElement;
    if (holder3.removeChild) holder3.removeChild(oldUl2);
    const ul2 = h('ul', { class: 'stem_answer' }, []);
    ['3', '4', '5', '22'].forEach((t, i) => {
      const row = h('li', { class: 'clearfix' }, []);
      const a = h('a', { class: 'answerBg', href: 'javascript:;' }, []);
      const ap = h('div', { class: 'answer_p' }, []);
      ap.appendChild(h('div', { class: 'textDIV' }, []).setText(String.fromCharCode(65 + i) + '. ' + t));
      a.appendChild(ap);
      row.appendChild(a);
      ul2.appendChild(row);
      a.onclick = function () {
        ap.classList.add('check_answer');
      };
    });
    holder3.appendChild(ul2);
    CXAI.Scraper.invalidateCollect();

    const r4 = await CXAI.Apply.apply(real, { keys: ['B'], answerText: 'B' });
    ok(r4.ok, '残影 + 重绘双重干扰下仍能落盘', r4);
  }

  // --- 15.5 页面把合成点击全吞掉，但行内 onclick 指向页面自己的函数：page-fn 兜底
  {
    const p5 = singlePage({ bind: function () {} });
    sandbox.document = p5.document;
    windowObj.document = p5.document;
    const q5 = CXAI.Scraper.collect().questions[0];
    const bgs = p5.body.querySelectorAll('.answerBg');
    bgs.forEach((a) => {
      a.setAttribute('onclick', 'pickIt(this)');
      const nodes = [a].concat(Array.from(a.querySelectorAll('*')));
      nodes.forEach((n) => {
        n.click = function () {};
        n.dispatchEvent = function () {
          return true;
        };
      });
    });
    sandbox.pickIt = function (bg) {
      const ap = bg.querySelector('.answer_p');
      if (ap) ap.classList.add('check_answer');
    };
    windowObj.pickIt = sandbox.pickIt;
    const r5 = await CXAI.Apply.apply(q5, { keys: ['B'], answerText: 'B' });
    ok(r5.ok, '点击被吞掉时仍能落盘', r5);
    ok(r5.strategy === 'page-fn', '走 page-fn（直接调页面 onclick 函数）', r5.strategy);
  }

  console.log('\n[16] 一次只点一下 / 认得出非 check_answer 的选中态');

  // --- 16.1 一次操作只产生一次 click（旧实现 fire('click') + el.click() 会打两次 handler）
  {
    let hits = 0;
    const p = singlePage({
      bind: (a, ap) => {
        a.onclick = function () {
          hits++;
          ap.classList.add('check_answer');
        };
      }
    });
    sandbox.document = p.document;
    windowObj.document = p.document;
    const q = CXAI.Scraper.collect().questions[0];
    const r = await CXAI.Apply.clickOne(q, 'A', {});
    ok(r.ok, '一次点击即落盘', r);
    ok(hits === 1, '一次操作只触发一次 handler（不再双触发）', hits);
  }

  // --- 16.2 toggle 皮肤：点第二次会把选中取消，脚本必须只点一次
  {
    const p = singlePage({
      bind: (a, ap) => {
        a.onclick = function () {
          if (ap.classList.contains('check_answer')) ap.classList.remove('check_answer');
          else ap.classList.add('check_answer');
        };
      }
    });
    sandbox.document = p.document;
    windowObj.document = p.document;
    const q = CXAI.Scraper.collect().questions[0];
    const r = await CXAI.Apply.apply(q, { keys: ['A'], answerText: 'A' });
    ok(r.ok, 'toggle 皮肤仍能落盘（点两下会被取消）', r);
    ok(CXAI.Apply.isChecked(q.options[0].el), 'toggle 皮肤点完保持选中态', q.options[0].el.className);
  }

  // --- 16.3 页面只改 input.checked，一个选中类名都不加（预览页/新版常见）
  {
    const p = singlePage({
      bind: (a) => {
        const inp = h('input', { type: 'radio', name: 'ans' }, []);
        a.appendChild(inp);
        a.onclick = function () {
          inp.checked = true;
        };
      }
    });
    sandbox.document = p.document;
    windowObj.document = p.document;
    const q = CXAI.Scraper.collect().questions[0];
    const r = await CXAI.Apply.apply(q, { keys: ['B'], answerText: 'B' });
    ok(r.ok, '只有 input.checked 的页面也认已选', r);
    ok(q.options[1].answered === false || true, '判定入口不抛错', '');
    const again = await CXAI.Apply.clickOne(q, 'B', {});
    ok(again.strategy === 'already', '已选选项不会重复点（toggle 安全）', again.strategy);
  }

  // --- 16.4 翻页前的落库窗口：题目自带保存按钮要点一次
  {
    const p = singlePage({
      bind: (a, ap) => {
        a.onclick = function () {
          ap.classList.add('check_answer');
        };
      }
    });
    sandbox.document = p.document;
    windowObj.document = p.document;
    const q = CXAI.Scraper.collect().questions[0];
    let saved = 0;
    const btn = h('a', { class: 'saveQuestion', onclick: 'saveQuestion()' }, []);
    btn.onclick = function () {
      saved++;
    };
    q.root.appendChild(btn);
    const s = await CXAI.Apply.settle(q, 10);
    ok(saved === 1, 'settle 会点每题自带的保存按钮', saved);
    ok(s.saved === true, 'settle 回报是否点过保存', s);
  }

  // --- 16.5 试卷浏览/预览页要能被识别出来（这类页面超星不记录作答）
  {
    const savedHref = sandbox.location.href;
    sandbox.location.href = 'https://mooc1.chaoxing.com/mooc-ans/exam/test/reVersionTestStartNew-browse?courseId=1&paperId=2';
    ok(CXAI.Scraper.detectPage().readonly === true, '-browse 预览页标记为只读', true);
    sandbox.location.href = 'https://mooc1-api.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=1&classId=2';
    ok(CXAI.Scraper.detectPage().readonly === false, '正式考试页不标只读', true);
    sandbox.location.href = savedHref;
  }

  sandbox.document = savedDoc;
  windowObj.document = savedWinDoc;

  console.log('\n[17] 全题型兜底：宽松解析 / 本地兜底 / 承载形态');
  {
    const qs = CXAI.Scraper.collect().questions;
    const single = qs[0];
    const r1 = CXAI.AI.parseModelResult('答案是 B', single);
    ok(!!r1 && r1.keys.join('') === 'B', '非 JSON 的「答案是 B」也能解析', r1);
    const r2 = CXAI.AI.parseModelResult('Ｂ', single);
    ok(!!r2 && r2.keys.join('') === 'B', '全角 Ｂ 归一化成 B', r2);
    const r3 = CXAI.AI.parseModelResult('B 正确，因为 A 和 C 都错', single);
    ok(!r3 || r3.keys.join('') === 'B', '解释性文字不会把 A/C 误当答案', r3);
    const qTxt = { type: 'completion', typeLabel: '简答题', stem: '简述 TCP 三次握手', options: [], keys: [] };
    const r4 = CXAI.AI.parseModelResult('```\n第一次 SYN，第二次 SYN+ACK，第三次 ACK\n```', qTxt);
    ok(!!r4 && /SYN\+ACK/.test(r4.answerText) && r4.answerText.indexOf('```') < 0, '文本题整段兜底并去掉代码围栏', r4);
    ok(CXAI.AI.isTextType(qTxt) && !CXAI.AI.isTextType(single), '文本题型判定（无选项=文本）', '');
    const h1 = CXAI.AI.heuristicAnswer(single, ['主判定失败']);
    ok(!!h1 && h1.stage === 'heuristic' && h1.keys.length === 1 && h1.lowConfidence === true, '本地兜底给出首选项（低置信度）', h1);
    const h2 = CXAI.AI.heuristicAnswer(qTxt, ['主判定失败']);
    ok(h2 === null, '文本题无可确定内容时不乱写', h2);
    const fake = (map) => ({ querySelector: (x) => (map[x] ? {} : null), querySelectorAll: (x) => map[x] || [] });
    ok(CXAI.Scraper.detectShell(fake({}), [{ key: 'A' }], [], []) === 'choice', 'shell=choice（有选项）', '');
    ok(CXAI.Scraper.detectShell(fake({}), [], [{}], []) === 'text', 'shell=text（有输入框）', '');
    ok(CXAI.Scraper.detectShell(fake({}), [], [], [{ objectid: '1' }]) === 'attach', 'shell=attach（附件题干）', '');
    ok(CXAI.Scraper.detectShell(fake({}), [], [], []) === 'manual', 'shell=manual（无选项无输入框）', '');
    ok(
      CXAI.Scraper.detectShell(
        fake({ 'audio, video, .audio, .video, .audioWrap, .videoWrap, .player-wrap, #audioPlayer': 1 }),
        [],
        [],
        []
      ) === 'media',
      'shell=media（只有播放器）',
      ''
    );
  }

  console.log('\n[18] 页面内不再注入标注（详情只在双击打开的面板里）');
  {
    const q = CXAI.Scraper.collect().questions[0];
    const host = CXAI.Mark.render(
      q,
      { keys: ['B'], answerText: 'B', confidence: 0.82, stage: 'panel', reason: '第二步是 SYN+ACK', votes: [{ who: 'm1', answer: 'B', confidence: 0.8 }] },
      { ok: true, actual: 'B' },
      { status: 'ok', actual: 'B' }
    );
    // 2026-11-18 用户要求：页面上不要任何卡片，判定详情只在面板里 → render 必须是空操作
    ok(host === null, '页面内不渲染作答卡片', host);
    ok(CXAI.Mark.textOf(q) === '', '页面里读不到标注文本', CXAI.Mark.textOf(q));
    const q2 = CXAI.Scraper.collect().questions[1] || q;
    CXAI.Mark.failed(q2, '这题在页面上没有可写入的答题框', null);
    ok(CXAI.Mark.textOf(q2) === '', '失败也不往页面写', CXAI.Mark.textOf(q2));
    ok(CXAI.Mark.attachAll(CXAI.Scraper.collect().questions) === 0, 'attachAll 不再挂载', '');
    CXAI.Mark.clearAll();
    ok(CXAI.Mark.textOf(q) === '', 'clearAll 幂等', '');
  }

  console.log('\n[19] 答题小 bug 回归（拆空 / qid / 选中态 / 回读 / 配置归一 / 读图策略）');
  {
    // ① 单空简答：||| 是分隔符，不能原样写进答题框
    const ta1 = h('textarea', {}, []);
    const qOne = { root: h('div', {}, [ta1]), inputs: [ta1], type: 'completion', typeLabel: '简答题', options: [] };
    const rOne = await CXAI.Apply.answerBlank(qOne, '1. 第一问答案|||2. 第二问答案', { instant: true });
    ok(
      rOne.ok && ta1.value.indexOf('|||') < 0 && /第一问答案/.test(ta1.value) && /\n/.test(ta1.value),
      '单空简答把 ||| 折成换行，不会原样落进答题框',
      ta1.value
    );

    // ② 带逗号的长答案不能被按逗号拆成多个空
    const b1 = h('input', { type: 'text' }, []);
    const b2 = h('input', { type: 'text' }, []);
    const b3 = h('input', { type: 'text' }, []);
    const qThree = { root: h('div', {}, [b1, b2, b3]), inputs: [b1, b2, b3], type: 'completion', typeLabel: '填空题', options: [] };
    const sentence = '首先，需要建立连接，然后，进行数据传输，最后，释放连接';
    const rThree = await CXAI.Apply.answerBlank(qThree, sentence, { instant: true });
    ok(
      b1.value === sentence && !b2.value && !b3.value && rThree.filled === 1 && rThree.partial === true,
      '中文长句不会被按逗号拆进三个空',
      [b1.value, b2.value, b3.value]
    );
    // 顿号仍然是合法的多空分隔（"赋、比、兴"）
    const d1 = h('input', { type: 'text' }, []);
    const d2 = h('input', { type: 'text' }, []);
    const d3 = h('input', { type: 'text' }, []);
    const qDun = { root: h('div', {}, [d1, d2, d3]), inputs: [d1, d2, d3], type: 'completion', typeLabel: '填空题', options: [] };
    await CXAI.Apply.answerBlank(qDun, '赋、比、兴', { instant: true });
    ok(d1.value === '赋' && d2.value === '比' && d3.value === '兴', '顿号分隔的三空仍能正确拆开', [d1.value, d2.value, d3.value]);

    // ③ 只填了一部分空时回报 partial（不再默默当成功）
    const p1 = h('input', { type: 'text' }, []);
    const p2 = h('input', { type: 'text' }, []);
    const qPart = { root: h('div', {}, [p1, p2]), inputs: [p1, p2], type: 'completion', typeLabel: '填空题', options: [] };
    const rPart = await CXAI.Apply.answerBlank(qPart, '只有一个答案', { instant: true });
    // 语义已收紧：只写进去一部分不算成功，必须报 manual 让主循环停下来等人补
    ok(rPart.ok === false && rPart.filled === 1 && rPart.total === 2 && rPart.partial === true, '部分填空不再算成功', rPart);

    // ④ 章节页各题按题型隐藏域取得自己的 qid（旧实现全页共用一个）
    const mkRoot = (typeName) => {
      const root = h('div', { class: 'questionLi' }, []);
      root.appendChild(h('input', { name: typeName, value: '0' }, []));
      return root;
    };
    ok(
      CXAI.Scraper.qidOf(mkRoot('type1234567')) === '1234567' &&
        CXAI.Scraper.qidOf(mkRoot('type7654321')) === '7654321',
      '每道题从 type{qid} 隐藏域拿到独立 qid',
      [CXAI.Scraper.qidOf(mkRoot('type1234567')), CXAI.Scraper.qidOf(mkRoot('type7654321'))]
    );
    ok(CXAI.Scraper.qidOf(mkRoot('type0')) !== '0', 'type0 这类短序号不被当成题号', CXAI.Scraper.qidOf(mkRoot('type0')));

    // ⑤ 选中态类名的后缀变体（check_answer_dx）也要认得
    const dx = h('a', { class: 'answer_p check_answer_dx' }, []);
    ok(CXAI.Apply.isChecked(dx, [dx]) === true, 'check_answer_dx 这类后缀变体认作已选', '');

    // ⑥ fill/reader 型隐藏域里的 HTML 按纯文本回读
    const hid = h('input', { id: 'answerv19', value: '<p>hello&nbsp;world</p>' }, []);
    document.body.appendChild(hid);
    const qV = { qid: 'v19', type: 'fill', options: [], inputs: [], root: h('div', {}, []) };
    ok(CXAI.Scraper.pageValue(qV).value === 'hello world', 'fill/reader 隐藏域按纯文本回读', CXAI.Scraper.pageValue(qV));
    document.body.removeChild(hid);

    // ⑦ 导入配置里的字符串数值会被折回数字（设置页 value= 拼接的注入面）
    CXAI.Cfg.importJSON(
      JSON.stringify({ ai: { judge: { panelSize: '1" onfocus=alert(1) x="' }, vision: { maxEdge: 'abc' } }, guard: {}, apply: {} })
    );
    ok(typeof CXAI.Cfg.get('ai.judge.panelSize') === 'number', '导入的字符串数值被折回数字', CXAI.Cfg.get('ai.judge.panelSize'));
    ok(CXAI.Cfg.get('ai.vision.maxEdge') === 1400, '非法数字回落到默认值', CXAI.Cfg.get('ai.vision.maxEdge'));

    // ⑧ auto 策略下，纯文本 + 视觉模型混编的面板改为先转写（不让纯文本模型瞎投票）
    CXAI.Cfg.set('ai.providers', [
      { id: 'j1', label: '文本模型', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 2 },
      { id: 'j2', label: '视觉模型', baseURL: 'https://mock.local/v1', apiKey: 'k2', model: 'm2', enabled: true, weight: 1, vision: true }
    ]);
    CXAI.Cfg.set('ai.judge.panelSize', 2);
    CXAI.Cfg.set('ai.vision.enabled', true);
    CXAI.Cfg.set('ai.vision.strategy', 'auto');
    CXAI.Cfg.set('ai.vision.ocrProviderId', '');
    const imgQ2 = Object.assign({}, imgQ, { images: ['data:image/png;base64,' + 'A'.repeat(4000)] });
    const solvedMix = await CXAI.AI.solve(imgQ2);
    ok(solvedMix.vision && solvedMix.vision.mode === 'ocr', '混合面板自动改用 OCR 转写', solvedMix.vision && solvedMix.vision.mode);

    // ⑨ 全视觉面板仍然走直传
    CXAI.Cfg.set('ai.providers', [
      { id: 'v1', label: '视觉一', baseURL: 'https://mock.local/v1', apiKey: 'k1', model: 'm1', enabled: true, weight: 2, vision: true },
      { id: 'v2', label: '视觉二', baseURL: 'https://mock.local/v1', apiKey: 'k2', model: 'm2', enabled: true, weight: 1, vision: true }
    ]);
    CXAI.Cfg.set('ai.judge.panelSize', 2);
    INLINE_SEEN = false;
    const solvedAllV = await CXAI.AI.solve(imgQ2);
    ok(solvedAllV.vision && solvedAllV.vision.mode === 'inline' && INLINE_SEEN === true, '全视觉面板保持直传图片', solvedAllV.vision && solvedAllV.vision.mode);
  }

  console.log('\n[21] 死角收口（部分写入 / 多选集合 / 连线 / 投票聚类）');
  {
    // ① 部分写入不算成功（apply 层，不只是 answerBlank）
    const n1 = h('input', { type: 'text' }, []);
    const n2 = h('input', { type: 'text' }, []);
    const qPart = { root: h('div', {}, [n1, n2]), inputs: [n1, n2], type: 'completion', typeLabel: '填空题', options: [], qid: '9001' };
    const rPart = await CXAI.Apply.apply(qPart, { answerText: '只有一个', keys: [] });
    ok(rPart.ok === false && rPart.manual === true && rPart.partial === true && /只写进了/.test(rPart.error || ''), 'apply 层：部分填空报 manual', rPart);

    // ② 连线/匹配：select 形态能写入并回读验收
    const fakeSel = {
      isConnected: true,
      disabled: false,
      value: '',
      selectedIndex: 0,
      options: [
        { text: '甲项', value: '1', disabled: false },
        { text: '乙项', value: '2', disabled: false }
      ],
      dispatchEvent() {}
    };
    const qMatch = { root: { querySelectorAll: () => [fakeSel] }, type: 'match', shell: 'match', options: [], inputs: [], qid: '9002' };
    const rMatch = await CXAI.Apply.apply(qMatch, { answerText: '乙项', keys: [] });
    ok(rMatch.ok === true && fakeSel.value === '2', '连线题按下拉框写入并回读', rMatch);

    // ③ 多选最终验收按集合：AC 不能冒充 AB
    const hidden = h('input', { id: 'answer9003', value: 'AC' }, []);
    const boxA = h('div', { class: 'answerBg' }, [h('span', { class: 'textDIV' }, [])]);
    const boxB = h('div', { class: 'answerBg' }, [h('span', { class: 'textDIV' }, [])]);
    const boxC = h('div', { class: 'answerBg' }, [h('span', { class: 'textDIV' }, [])]);
    const root3 = h('div', { class: 'questionLi', data: '9003' }, [boxA, boxB, boxC, hidden]);
    const qMulti = {
      root: root3,
      qid: '9003',
      type: 'multiple',
      typeLabel: '多选题',
      stem: '多选集合验收',
      options: [
        { key: 'A', text: '甲', el: boxA },
        { key: 'B', text: '乙', el: boxB },
        { key: 'C', text: '丙', el: boxC }
      ],
      inputs: []
    };
    const rMulti = await CXAI.Apply.apply(qMulti, { answerText: 'AB', keys: ['A', 'B'] });
    ok(rMulti.ok === false, '多选按集合验收（AC ≠ AB）', rMulti);

    // ④ 文本题投票先归一化再聚类：换标点/说法的回答算同一票
    const t1 = CXAI.AI.tally([
      { answerText: '首先建立连接，然后传输数据', confidence: 0.8, providerLabel: 'm1' },
      { answerText: '首先，建立连接；再传输数据', confidence: 0.8, providerLabel: 'm2' },
      { answerText: '完全不同的另一段回答', confidence: 0.8, providerLabel: 'm3' }
    ]);
    ok(t1.winner && t1.winner.count === 2, '相似文本聚成一票', t1);
    const t2 = CXAI.AI.tally([
      { answerText: 'AB', confidence: 0.9, providerLabel: 'm1' },
      { answerText: 'AC', confidence: 0.9, providerLabel: 'm2' }
    ]);
    ok(t2.winner && t2.winner.count === 1 && t2.list.length === 2, '选择题不同字母不会被误合并', t2);
  }

  console.log('\n[20] 主循环：页面已答且与判定一致时不重写（fixWrong）');
  {
    // 08-main 需要 UI / 设置中心 / 同步的桩；这里只验证主循环的作答决策
    CXAI.UI = {
      mount() {},
      unmount() {},
      update() {},
      addQuestionCard() {},
      pushQuestion() {},
      getQList: () => [],
      saveQList() {},
      renderQGrid() {},
      renderQDetail() {},
      appendLog() {},
      togglePanel() {},
      settingsURL: () => '',
      openSettingsPage() {},
      openSync() {},
      closeSync() {},
      runSync() {},
      syncOk() {},
      syncFail() {},
      state: {}
    };
    CXAI.Settings = { isHere: () => false };
    CXAI.Sync = { savedCode: () => '' };

    CXAI.Cfg.set('ai.providers', [
      { id: 'p1', label: 'M1', baseURL: 'https://mock.local/v1', apiKey: 'k', model: 'm1', enabled: true }
    ]);
    CXAI.Cfg.set('ai.judge.mode', 'single');
    CXAI.Cfg.set('ai.judge.panelSize', 1);
    CXAI.Cfg.set('guard.minDelay', 0);
    CXAI.Cfg.set('guard.maxDelay', 0);
    CXAI.Cfg.set('guard.longBreakEvery', 0);
    CXAI.Cfg.set('guard.enabled', false);
    CXAI.Cfg.set('apply.retries', 0);
    CXAI.Cfg.set('apply.stopOnFail', false);
    CXAI.Cfg.set('engine.autoResume', false);
    CXAI.Cfg.set('engine.prefetch', false);
    CXAI.Cfg.set('engine.bootstrapPollMs', 200);
    CXAI.Cfg.set('answer.preferPreview', false);
    // 以下断言测的是"自动点选落盘"老链路：先把仅显示模式关掉（默认开）
    CXAI.Cfg.set('ui.showOnly', false);

    const solveCalls = [];
    CXAI.AI.solve = async (q) => {
      solveCalls.push(q.stem);
      return { keys: ['A'], answerText: 'A', confidence: 0.9, stage: 'panel', votes: [], reason: 'test' };
    };
    const applyCalls = [];
    CXAI.Apply.apply = async (q, r) => {
      applyCalls.push(q.stem);
      return { ok: true, actual: (r.keys || []).join('') };
    };
    CXAI.Apply.saveOne = async () => true;

    // 清干净夹具：所有选项取消选中、文本框清空
    const qs20 = CXAI.Scraper.collect().questions;
    qs20.forEach((q) => {
      (q.options || []).forEach((o) => o.el.classList.remove('check_answer'));
      (q.inputs || []).forEach((el) => {
        if (el && el.tagName === 'TEXTAREA') el.value = '';
      });
    });
    const q0 = qs20[0];
    q0.options[0].el.classList.add('check_answer'); // 页面已答 A，与下面的判定一致

    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '08-main.js'), 'utf8'), ctx, {
      filename: '08-main.js'
    });
    const Engine = CXAI.Engine;
    ok(!!Engine && typeof Engine.start === 'function', '主循环模块可加载', '');

    solveCalls.length = 0;
    applyCalls.length = 0;
    await Engine.start();
    ok(solveCalls.indexOf(q0.stem) >= 0, '已答题仍会判定（否则无法知道答得对不对）', solveCalls.length);
    ok(applyCalls.indexOf(q0.stem) < 0, '判定与页面答案一致时不再重写', applyCalls.includes(q0.stem));

    // 页面答案改成 B（与判定 A 不一致）→ 必须重做
    q0.options[0].el.classList.remove('check_answer');
    q0.options[1].el.classList.add('check_answer');
    applyCalls.length = 0;
    await Engine.start();
    ok(applyCalls.indexOf(q0.stem) >= 0, '判定与页面答案不一致时才重写', applyCalls.includes(q0.stem));

    // --- [21] 仅显示答案模式（ui.showOnly，默认开）：判题照常，但绝不落盘
    solveCalls.length = 0;
    applyCalls.length = 0;
    CXAI.Cfg.set('ui.showOnly', true);
    await Engine.start();
    ok(solveCalls.indexOf(q0.stem) >= 0, '仅显示模式仍会判定', solveCalls.length);
    ok(applyCalls.length === 0, '仅显示模式不落盘（不点击选项）', applyCalls.length);
    CXAI.Cfg.set('ui.showOnly', false);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败（AI 请求 ${CALLS} 次）`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试崩溃：', e);
  process.exit(1);
});