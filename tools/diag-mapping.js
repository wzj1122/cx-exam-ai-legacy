/**
 * diag-mapping.js —— 「AI 答案字母」与「页面勾选的选项」对不上的现场取证脚本。
 *
 * 用法：在超星考试/作业页（脚本已注入的页面）按 F12 打开控制台，整段粘进去回车。
 * 不改任何东西，只读 DOM + 隐藏域，输出一张表：
 *   题号 | 题干 | 选项数 | 字母错位 | qid | 隐藏域
 * 有错位的题会额外把每个选项的 [位置键 / 页面字母 / data / 文本前 30 字 / 是否被判已选 / 类名] 打出来。
 *
 * 判读口径：
 *   · 「字母错位」> 0 → 抓题层把选项键按 DOM 位置发（03-scraper parseOne/parseChapter），
 *     而页面自己标的字母不是这个顺序 → AI 说 B、脚本点的却是页面标 A 的那个，属于本脚本要抓的头号问题。
 *   · 全 0 却没有勾对 → 问题在落盘/重试链（05-apply clickOne、08-main applyWithRetry→relive→pickSame），
 *     看日志里有没有「重新取一次再落盘」以及它取回的是不是同一道题（题号/题干是否变了）。
 */
(() => {
  const SEL = '.questionLi, .TiMu';
  const rows = [];
  const roots = Array.from(document.querySelectorAll(SEL));

  roots.forEach((root, qi) => {
    const stemEl = root.querySelector('.Zy_TItle, .qtContent, .mark_name, .stem, h3') || root;
    const stem = String(stemEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);

    const qidEl = root.querySelector('[name^="answer"], [id^="answer"]');
    const qid =
      root.getAttribute('data') ||
      root.getAttribute('qid') ||
      (qidEl ? String(qidEl.name || qidEl.id).replace(/^answers?/, '') : '');

    let els = Array.from(root.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv'));
    if (!els.length) els = Array.from(root.querySelectorAll('.answerBg, .textDIV, .eidtDiv, .Cy_ulTop li'));
    els = els.filter((el) => {
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return false;
      if (el.closest('.mark_answer')) return false;
      if (el.closest('.subEditor, .edui-editor, .edui-default')) return false;
      if (el.querySelector && el.querySelector('textarea[id], iframe[id^="ueditor"]')) return false;
      return true;
    });
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));

    const opts = els.map((el, i) => {
      const posKey = String.fromCharCode(65 + i);
      const holder = el.closest('.answerBg') || el.parentElement || el;
      const numEl = holder.querySelector ? holder.querySelector('.num_option, .option_num, .num') : null;
      const labelLetter = String(numEl ? numEl.innerText : '')
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
        .slice(0, 1);
      const prefixLetter = (String(el.innerText || '').match(/^\s*([A-Ha-h])\s*[、.．)）:：]/) || [])[1] || '';
      const dataAttr = (holder.getAttribute && holder.getAttribute('data')) || (el.getAttribute && el.getAttribute('data')) || '';
      const clsAll = (String(holder.className || '') + ' ' + String(el.className || '')).replace(/\bun\w+/gi, '');
      const marked = /check_?answer|checked|selected|cur(?:Selected)?|active|chosed|chosen/i.test(clsAll);
      return {
        posKey,
        pageLetter: labelLetter || String(prefixLetter).toUpperCase(),
        data: String(dataAttr).slice(0, 12),
        text: String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        marked,
        cls: clsAll.replace(/\s+/g, ' ').trim().slice(0, 50)
      };
    });

    const hidden = Array.from(root.querySelectorAll('input[name^="answer"], input[id^="answer"]'))
      .map((i) => (i.name || i.id) + '=' + String(i.value || '').slice(0, 12));

    const bad = opts.filter((o) => o.pageLetter && o.pageLetter !== o.posKey);

    rows.push({ 题号: qi + 1, 题干: stem, 选项数: opts.length, 字母错位: bad.length, qid, 隐藏域: hidden.join(' ') });
    if (bad.length) {
      console.warn('⚠ 第 ' + (qi + 1) + ' 题：位置键 ≠ 页面字母 —— AI 的字母会点偏');
      console.table(opts);
    }
    if (opts.every((o) => !o.pageLetter)) {
      console.warn('· 第 ' + (qi + 1) + ' 题：页面没有任何字母标签，键只能按位置发（这类题位置变了就整套错位）');
    }
  });

  console.table(rows);
  const totalBad = rows.filter((r) => r.字母错位 > 0).length;
  const noLabel = rows.filter((r) => r.选项数 > 0 && r.字母错位 === 0).length;
  if (totalBad) {
    console.error('❌ ' + totalBad + ' 道题的选项键与页面字母不一致 → 这就是「答案和勾选明显不符」的直接原因（抓题层按键规则）');
  } else {
    console.log('✅ 选项键与页面字母一致（共 ' + rows.length + ' 题，' + noLabel + ' 题无字母标签）→ 接着查落盘/重试链：日志里搜「重新取一次再落盘」，看它重取回来的题干是否变了');
  }
  return rows;
})();
