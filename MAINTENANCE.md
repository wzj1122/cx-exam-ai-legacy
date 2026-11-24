> 最后更新：2026-11-24 ｜ 当前版本：1.12.0（`package.json`；`tools/diag-mapping.js` 为未发布诊断工具）

# MAINTENANCE

## 软件简介

**cx-exam-ai（CX 考试 AI 大脑）** 是一份面向超星学习通考试页的 Tampermonkey 用户脚本，单文件、零运行时依赖。

核心主张：**不用题库**。每道题在作答瞬间交给多个 OpenAI 兼容大模型并行推理，用"议会投票 → 交叉复核 → 仲裁"三级机制收敛出答案，再以拟人化点选写入页面。

参考项目 `ocsjs`（MIT，Copyright (c) 2022 enncy）的架构思想与学习通选择器经验，但重建了构建链：不引入 pnpm workspace、不引入 React、不打包题库 SDK，源码按编号分模块挂到全局 `CXAI` 命名空间，由自写拼接器产出单文件。

覆盖能力：
- 页面形态：整卷预览（`/mooc2/exam/preview`）、作业（`/mooc2/work/dowork`）、章节测验（`.TiMu`）、单题逐题模式
- 题型：单选、多选、判断、填空、简答/论述、连线/阅读（按选择题降级处理）
- 图片题：本地抓图 → canvas 缩放压缩 → 直传视觉模型（inline）或先转写成文字再判题（ocr）；策略可配 auto/inline/ocr/off
- 模型接入：OpenAI `/chat/completions`、Anthropic `/v1/messages`、Gemini `generateContent` 三种风格；支持本地网关（Ollama `11434`、LM Studio `1234`、magpie `3425` 这类任意本地端口；预设里已移除 magpie，用「自定义模型」填地址）空 Key 直连
- 字形加密：`font-cxsecret` 类内联 base64 字体还原（FRB2 特征表匹配）
- 反检测：前台状态伪装、弹窗自动确认、拟人节奏与完整指针事件序列

## 目录结构总览

```
cx-exam-ai/
├── build.js                  零依赖打包器（拼接 + 注入版本号/构建时间）
├── package.json              scripts: build / dev / check / test
├── README.md                 面向使用者的说明（安装表/使用/更新日志）
├── MAINTENANCE.md            本文件
├── CLAUDE.md                 仓库规则（文件权限、发布流程、禁止操作）
├── LICENSE                   MIT 许可证
├── index.html                落地页（Cloudflare Pages 一键安装入口 + 设置中心入口）
├── settings.html             独立设置中心骨架（脚本接管后整页渲染设置界面，未接管时给排查指引）
├── .gitignore                运行期产物与浏览器 profile 的排除清单
├── functions/api/sync/[id].js  Pages Function：配置云同步接口（GET/PUT/DELETE + KV `CFG_KV`）
├── wrangler.jsonc            Cloudflare Pages 部署配置（含 `pages_build_output_dir` 与 CFG_KV 绑定）
├── images/                   收款码（alipay.png / wechat_pay.png）
├── src/                      源码（按编号顺序拼接，禁止乱序）
│   ├── 00-header.js          UserScript 元数据块
│   ├── 01-core.js            配置默认值 / 存储 / 工具函数 / 日志
│   ├── 02-font.js            字形加密还原
│   ├── 03-scraper.js         页面识别、题型判定、题目解析
│   ├── 03b-vision.js         图片题读图层（抓图/压缩/data URL/转写）
│   ├── 03c-attach.js         附件题通道（PDF 页图推导 + 探测）
│   ├── 03d-mark.js           题下标注模块（**已停用**，enabled() 恒 false；作答详情只在面板）
│   ├── 04-ai.js              模型调用、三风格请求体、Prompt、多重判定流水线
│   ├── 05-apply.js           拟人化点选、填空写入、保存/交卷按钮定位
│   ├── 06-guard.js           环境伪装、弹窗确认、节奏控制
│   ├── 07-ui.js              Shadow DOM 控制台（面板/设置/题目卡片）
│   ├── 08-main.js            主编排引擎 + boot
│   ├── 09-settings.js        独立设置中心（网页版配置页，整页接管 /settings.html）
│   └── 10-sync.js            云同步（AES-GCM 加密 + Pages Functions/KV 中转）
├── tools/
│   ├── check.js              语法与模块契约自检
│   ├── test-dom.js           离线集成测试（自建 DOM 垫片 + fetch 模拟）
│   └── build-site.js         生成 Cloudflare 发布目录 .site/（只含 index.html + dist/ + images/）
└── dist/
    └── cx-exam-ai.user.js    构建产物（唯一交付物）
```

## 文件用途清单

| 文件 | 对外接口 | 职责 | 依赖 |
|---|---|---|---|
| `src/00-header.js` | — | `@match`/`@grant`/`@connect` 元数据（v1.8.0 起含 `cx-exam-ai.pages.dev` / `github.io` / `127.0.0.1`，设置中心要用）；`@run-at document-start` | 无 |
| `src/01-core.js` | `CXAI.DEFAULT_CONFIG` `CXAI.PRESETS` `CXAI.isLocalURL` `CXAI.normalizeProvider` `CXAI.Store` `CXAI.Cfg` `CXAI.Log` `CXAI.U` | 默认配置（judge 参数 + `ai.vision` 对象 + **0 个预置 provider**）、**9 条接入预设**（deepseek/tokenrhythm/qwen-vl/qwen/glm/openai/ollama/lmstudio/custom，`model` 全部留空、以 `AI.listModels` 拉到的清单为准）、provider 归一化（apiStyle/role/keyOptional/maxTokens/extraBody/extraHeaders）、GM_* 存储回退 localStorage、`U.{sleep,rand,randInt,uid,clamp,mergeDeep,deepGet,safeJson,normText,similarity,escapeHtml,truncate,withTimeout}` | 无 |
| `src/02-font.js` | `CXAI.Font` | 抽取 head 内 base64 字体 → canvas 360px 渲染 → 积分图盒式降采样 → 与 FRB2 特征表算汉明距离，输出 glyph→char 映射。**v1.11.2**：`03-scraper.collect` 与 `08-main.decryptIfNeeded` 已接入（此前模块从未被调用，密文原样送模型）；特征表校验长度/字段，失败 60 秒后可重试 | `CXAI.U` |
| `src/03-scraper.js` | `CXAI.Scraper.{detectPage,collect,parseOne,currentAnswered,clickNext,optionScope,pageValue,stemAnswerKeys,totalCount,currentIndex,applyNextPage,ueditorOf,ensureEditors}` | 识别页面种类与整卷/单题模式；解析 `.questionLi` / `.TiMu` 为题目对象 `{index,type,typeLabel,stem,options[{key,text,el,answered}],inputs,images,score,root,answered}`；**v1.5.0**：`optionScope` 把选中态限定在单选项容器内（`.stem_answer` 包着全部选项，往上找会把整题选项都判成已选）；`pageValue` 以 `#answer{qid}`/`answers{qid}`/UEditor 为准读页面真实答案；`stemAnswerKeys` 认题干自带答案；`totalCount` 读「题量: N」；`applyNextPage` 原地换题块（无刷新翻页）；**v1.11.0**：题型表补齐 0~17（12 匹配 / 13 排序 / 16 口语 / 17 听力），新增 `detectShell()` 判定承载形态 `shell ∈ {choice,text,match,group,media,attach,manual}`、`readMedia()` 抓音视频、`labelOf()` 未知码显示「第 N 类题」；`readOptionElements` 过滤掉 textarea/input/select（简答的 `.eidtDiv` 文本域不再被当成选项，否则简答会按单选去点）。**v1.11.2**：`qidOf` 按题块取 data / `type{长数字}`，不再让章节页所有题共用一个 qid；`pageValue` 对 fill/reader/line 等文本类隐藏域走 `toPlain`；纯图片/附件/音频题不再因题干为空被丢弃；`parseChapter` 选项嵌套去重；`collect` 先 `Font.ensureSync`；`applyNextPage` 兜底补 `#submitTest` | `CXAI.U` |
| `src/03b-vision.js` | `CXAI.Vision.{cfg,isEnabled,prepare,pickProvider,panelHasVision,transcribe,composePromptBlock,load,clear,stats}` | 图片题通道：`fetchBlob`（GM_xmlhttpRequest 带 Referer 优先，降级 fetch credentials:include）→ `blobToDataUrl`（FileReader / arrayBuffer+btoa 兜底）→ `compress`（canvas 长边缩放到 1400、JPEG 0.82，无 Image/canvas 时原样返回）→ 10 分钟内存缓存；`prepare` 丢占位图（<600B）与超总字节图；`transcribe` 用读图模型把图转成 `{text,questionText,options,kind,confidence}` | `CXAI.Cfg` `CXAI.AI` `CXAI.U` |
| `src/03c-attach.js` | `CXAI.Attach.{collect,previewUrl,pageImageUrls,hashPath,md5,probeImage,directUrl,enrich,pagesOf,clear,cfg}` | 附件题通道：附件枚举 → 页图地址推导（md5 末三字节）→ HEAD 探测页数 → 页图进 `question.images`；兜底为 `.btnDown` 直链 + pdf.js 渲染（页面有 pdfjsLib 时才走） | `CXAI.U` `CXAI.Log` `CXAI.Cfg` |
| `src/03d-mark.js` | `CXAI.Mark.{render,pending,preview,existing,failed,attachAll,clearAll,textOf,letterize,stageWord}` | **v1.11.0 新增、v1.11.0 收尾时停用**：原先在每题下方挂 Shadow DOM 卡片，2026-11-18 用户明确要求「页面上不要这块」→ `enabled()` 恒 `false`，`render/attachAll` 全部空操作，模块只为兼容旧调用保留。作答详情改由面板 `renderQDetail()` 承载（AI 判定/置信度/阶段/依据/投票/降级/页面一致性）。**恢复页内标注必须显式改 `enabled()` 那一行** | `CXAI.U` `CXAI.Cfg` `src/07-ui.js` |
| `src/04-ai.js` | `CXAI.AI.{solve,councilSolve,rescueSolve,heuristicAnswer,ping,listModels,callProvider,buildRequest,extractText,parseModelResult,resolveAnswerKeys,isTextType,cleanAnswerText,normWidth,tally,buildPanel}` + 内部 `httpMethod(method,url,headers,body,timeout)`（`httpJson` 是它的 POST 快捷方式） | 三风格请求体构建（openai/anthropic/gemini，含 system 提升、图片块、extraBody/extraHeaders 深合并）、响应文本抽取、**`listModels` 拉取各家 `/models`**（OpenAI `/models`、Anthropic `/v1/models`、Gemini `/v1beta/models?key=` 并过滤非 generateContent）、三套 Prompt + 读图上下文注入、答案归一化、加权投票、三级收敛；**v1.11.0**：`solve()` = 主判定失败后自动走兜底链（`rescueSolve` 逐模型极简 prompt 重问 → `heuristicAnswer` 题干答案/首选项），解析放宽到「答案：B / 答案是 B / 全角 Ｂ / 文本题整段代码块」并收紧"从解释文字乱抠 A–H"。唯一不兜底的是附件题缺视觉输入（会写进卷子的瞎猜） | `CXAI.Cfg` `CXAI.Vision` `CXAI.U` `CXAI.Log` |
| `src/05-apply.js` | `CXAI.Apply.{humanClick,apply,answerChoice,answerBlank,clickOne,isChecked,stateSig,saveOne,findSubmitButton,typeInto,settle,fire}` | 指针事件序列 + 随机落点；点后轮询选中态；失败逐级扩大候选元素重试；填空支持 textarea/input/contenteditable iframe；**v1.11.0**：没有可写目标时不再假装成功 —— 文本题找不到输入框、选择题抓不到选项一律返回 `{ok:false, manual:true, error:…}`，`08-main` 据此不触发"写入失败暂停"，答案靠题下标注交给人工 | `CXAI.U` `CXAI.Cfg` |
| `src/06-guard.js` | `CXAI.Guard.{install,uninstall,pace,dismissDialogs}` | `document.hidden`/`visibilityState`/`hasFocus` 伪装、吞掉 `visibilitychange`/`blur`、`confirm` 自动 true、弹窗白名单点击、题间节奏（含每 N 题长停顿与 3% 概率犹豫） | `CXAI.Cfg` `CXAI.U` `CXAI.Log` |
| `src/07-ui.js` | `CXAI.UI.{mount,unmount,update,addQuestionCard,pushQuestion,rowsForRender,renderQGrid,renderQDetail,appendLog,togglePanel,getQList,saveQList,settingsURL,openSettingsPage,openSync,closeSync,runSync,syncOk,syncFail,state}` | Shadow DOM 隔离的控制台：统计条、运行/暂停/停止、题目结果卡片（答案/置信度/一致率/阶段/票数）；题号格直接显示每题答案（`<b>题号</b><i>答案</i>`），详情区补依据/模型票/降级原因。**v1.11.0**：脚本内设置面板早已下线，同步入口改为**悬浮球上方气泡** `#syncpop`（`#sync-code` + `[data-act="sync-pull"]` 一个输入框一个按钮，旧 `#syncmask` 弹窗已删）；`syncOk()` 绿圈扩散 + 小球 `synced` 弹动 + 气泡 `done` 打勾，1.6s 收起；`syncFail()` 红圈 + 气泡 `fail` 抖动 + 自动打开面板并在顶部 `#syncfail` 写原因（含时间与排查建议）+ 小球 `sync-err` 红点；`state.sync.fx` 记录最近一次特效（测试用）；`ui.inlineResult` / `ui.syncFailMs` 见 `01-core` | `CXAI.Cfg` `CXAI.AI` `CXAI.PRESETS` `CXAI.Engine` `CXAI.Sync` `CXAI.Mark` |
| `src/08-main.js` | `CXAI.Engine.{start,togglePause,stop,jumpTo,softNext,primeFromPage,answerNext,prefetch,saveSession,st}` | 主循环：整卷遍历 / 单题翻页；会话缓存去重；暂停-恢复-中断；低置信度标记；可选自动交卷（10s 反悔窗口）；boot 引导；v1.8.0 起 `ready()` 先问 `CXAI.Settings.isHere()`，命中就整页接管设置中心并 return。**v1.11.0**：每题开始/结束/失败都写 `CXAI.Mark` 标注（`pending → render / failed`），预取写 `preview`，页面原有答案写 `existing`；判定失败不再抛到外层，标红后继续下一题；`recordQ` 增加 `reason/votes/errors/shellLabel/confidenceLow` 供详情区展示；boot 里**只要存过同步码就调用 `Sync.syncBoot()` 自动同步**（不再限制"本地无模型才拉"），成功调 `UI.syncOk()`、失败调 `UI.syncFail()`；没有同步码也没有模型时自动 `UI.openSync({auto:true})` 弹出小球旁气泡 | 全部模块 |
| `src/09-settings.js` | `CXAI.Settings.{isHere,mount,unmount,collectDiag}` | 独立设置中心：`settings.html`（Pages 上是 `/settings`）整页接管。默认「简单版」三栏（模型/判题/读图），`ui.advanced` 打开后才是六栏完整版；首次无模型时走 `wizardStep1/2/3` 三步向导（`S.wzActive` 控制，勿用 providers 是否为空判断）。模型卡 CRUD + 预设联动 + `AI.listModels` 拉取（模型名为空时自动选第一个）+ `AI.ping` 单卡测试；向导第 1 步同样可拉取；`data-f`/`data-path` 两条字段写入通道，280ms 防抖后 `Cfg.save()`；`syncVisionRoles()` 在改读图模型时同步所有 provider 的 `role`；支持 `?tab=` 深链。**顶层零副作用**，不在设置页时只是一堆函数 | `CXAI.Cfg` `CXAI.AI` `CXAI.PRESETS` `CXAI.U` `CXAI.Store` `CXAI.Log` |
| `src/10-sync.js` | `CXAI.Sync.{enabled,savedCode,setCode,disable,makeCode,newCode,syncNow,push,pull,pullInto,autoPull,syncBoot,state,recordState,apiBase}` | 云同步（AES-GCM + Cloudflare Pages Functions/KV）。**v1.11.0**：`autoPull()` 默认 `force:true`（有码就拉），新增 `syncBoot()` 返回 `{ok,models,error,ms}` 并写 `syncState`（面板展示失败原因靠它）；`apiBase()` 把 `ui.syncAPI` 另存独立键 `syncAPI`，配置被覆盖/清空时同步地址不丢 | `CXAI.Cfg` `CXAI.Store` `CXAI.Log` |
| `index.html` | — | Cloudflare Pages 落地页：三处一键安装入口（本站 `/dist/cx-exam-ai.user.js`、GitHub raw、Greasy Fork）、四件事、独立设置中心入口、三步上手、收款码。样式全内联，无外部依赖；改版式只动这一个文件 | `dist/cx-exam-ai.user.js`（下载路径）、`images/*.png` |
| `settings.html` | — | 设置中心骨架：深色兜底页（含未接管时的排查步骤）+ `<html data-cxai-settings>` 标记。body 会被脚本清空后整页渲染，所以这里**只放兜底与标记，别指望它自己渲染表单** | `src/09-settings.js`（渲染方）、`index.html`（入口） |
| `CLAUDE.md` | — | 仓库规则：哪些文件能改、发布流程（改版本 → 构建 → 自检 → 文档同步 → push）、禁止操作（手改 dist、删除 dist、提交 profile 目录） | 无 |
| `LICENSE` | — | MIT，版权人 `wzj1122` | 无 |
| `.gitignore` | — | 排除 `logs/`、`.watch.log`、`.chrome.log`、`.shot-*.png`、`.cdp-profile/`、`.chrome-profile/`、`.tmp-ocsjs/`、`node_modules/` 等运行期与本地产物 | 无 |
| `wrangler.jsonc` | — | Cloudflare **Pages** 部署配置：`name: cx-exam-ai`、`pages_build_output_dir: "./.site"`。**不能指向 "./"**——根目录含 `logs/`、`.cdp-profile/`、`.chrome-profile/`，被当作静态资源上传就是公开泄露登录态 Cookie；`assets.ignore` 在 wrangler 4.162 报 unexpected field 且不生效，只能靠“发布目录本身干净”。本地发布：`npm run site && npx wrangler pages deploy --branch=main`
| `tools/release.js` | `node tools/release.js [--bump patch\|minor\|major] [--version x.y.z] [--dry] [--skip-test] [--no-deploy] [--no-verify] [-m 说明]` | 一键发布：版本同步 → build → check → test-dom → build-site → 白名单 commit → push → wrangler pages deploy → 线上回读 `@version`。只 add 白名单路径，暂存区出现 profile/logs 立即中止 | `build.js` `tools/check.js` `tools/test-dom.js` `tools/build-site.js` `wrangler.jsonc` |
| `tools/verify-cdp.mjs` | `node tools/verify-cdp.mjs [--keep] [--cdp=9222]` | `node tools/verify-cdp.mjs [--keep] [--cdp=9222]` | 真实浏览器端到端验证：自起两个静态服务（8790/8791 = 两个 origin，复现跨域存储隔离）+ headless Chrome（CDP），跑「设置中心向导 → 配置码 → 云同步(KV) → 考试页落库 → 悬浮球/面板 → E 段：本地同步 API + 多题型兜底 + 题下标注」**35 项断言**，用 `Input.dispatchMouseEvent` 发真实双击（球的交互是 pointer 链，合成 click 无效）。线上 Cloudflare 不可达时自动跳过 A9/C 段（本地 E 段覆盖同步逻辑） | `dist/` `.site/` `tools/shim.js` `tools/fixtures/exam-mock.html` `tools/fixtures/exam-mock-types.html` |
| `tools/fixtures/exam-mock.html` | — | 模拟学习通考试页（`.questionLi` + `.stem_answer` + `check_answer` 点选行为），给 `verify-cdp.mjs` 当考试页夹具 | `tools/verify-cdp.mjs` |
| `tools/fixtures/exam-mock-types.html` | — | **v1.11.0 新增**：多题型夹具（单选 0 / 简答 4 / 连线 11 / 听力 17 / 排序 13），覆盖 `shell=choice/text/match/media/choice`；E 段用它验证全题型兜底与题下标注 | `tools/verify-cdp.mjs` |
| `tools/diag-mapping.js` | — | **2026-11-19 新增（未发布）**：现场取证脚本。粘进考试页控制台（只读、不改 DOM），逐题打印「位置键 / 页面字母标签 / data / 选项文本 / 是否被判已选 / 隐藏域」，并标出 `页面字母 ≠ 位置键` 的题。用于判断「AI 答案与页面勾选不符」是抓题层按键错位，还是落盘/重试链串题。**不是构建产物，不参与打包** | `src/03-scraper.js`（`parseOne`/`parseChapter`/`pickSame`）、`src/05-apply.js`（`answerChoice`/`answerJudgement`）、`src/08-main.js`（`answerNext`/`applyWithRetry`） |
| `tools/build-site.js` | `node tools/build-site.js` | 清空并重建 `.site/`：拷贝 `index.html` 与 `settings.html` → `/`、`dist/` → `/dist/`、`images/` → `/images/`，输出文件数与体积。Cloudflare Pages/Workers 的构建命令就是它，`.site/` 已进 `.gitignore` | `dist/cx-exam-ai.user.js` `images/*` |
| `images/alipay.png` `images/wechat_pay.png` | — | 收款码，README 与 index.html 共用；勿替换成别的图 | 无 |
| `dist/cx-exam-ai.user.js` | — | 构建产物，三处安装链接的唯一目标；**只由 `node build.js` 生成** | `src/*.js` + `package.json` |

**v1.11.2 对上述文件的补充（2026-11-19）**

| 文件 | 新增/变化 |
|---|---|
| `01-core.js` | `CXAI.U.coerceLike(def, cur)`：`Cfg.load` 后按默认类型归一导入配置（数字段字符串折回数字，防设置页 `value=` 注入）；`DEFAULT_CONFIG.apply.fixWrong = true` |
| `02-font.js` | 已被主链路调用；`parseRefTable` 校验 `count/gc/gf` 与字节长度；破解失败改为 60 秒后可重试 |
| `03-scraper.js` | `qidOf` 按题块取题号；`collect` 先 `Font.ensureSync`；`pageValue` 文本题型扩到 fill/reader/match/oral/listening；纯图片/附件题不再被过滤；`parseChapter` 去重；`applyNextPage` 补表单 |
| `03c-attach.js` | `pdfLib()` 优先从 `unsafeWindow.pdfjsLib` 取（油猴沙箱里 `window.pdfjsLib` 恒空） |
| `04-ai.js` | `auto` 读图仅在**全视觉**面板直传，混合面板走 OCR；`fast` 温度封顶 1；复核/仲裁提示词补小题组选项 |
| `05-apply.js` | `splitBlanks` 单空折 `|||`、不再按逗号拆空；`partial` 回报；iframe 只写编辑器；`editorList/ueditorOf` 不对 input 造空壳实例；`SEL_TOKEN` 认 `check_answer*`；`clickOne` 候选步数 3→5 |
| `07-ui.js` | `unmount` 摘掉 keydown / `Log.on` / resize；球拖动阈值 4→10px；`manual` 状态标红 |
| `08-main.js` | `sameAnswer` / `decryptIfNeeded` / `rowKeyOf`；fixWrong 判后比对；暂停不翻页；`answerNext` 失败不翻页 + 整卷填空补保存；缓存键带 qid 与图片指纹；入口对晚渲染题块轮询；`answers` 上限 400 |
| `09-settings.js` | 数字空值不写 0；读图 `enabled` 与 `strategy` 联动；`fetchModels/testOne` 按 provider id 回写；`num()` 转义 |
| `tools/test-dom.js` | 新增 [19] 12 项、[20] 4 项回归断言（vitest 无关，仍是零依赖 node 脚本） |

**v1.11.15 对上述文件的补充（2026-11-19）**

| 文件 | 新增/变化 |
|---|---|
| `01-core.js` | `engine.previewDelayMs=1500`：进页后自动切整卷预览的等待 |
| `03-scraper.js` | `normalizeJudgeGroup(q)`：`hoverDiv + span[data=true/false]` 的判断题从"1 个空的小题组"还原成判断题（导出同名函数） |
| `05-apply.js` | `answerJudgement(q,result,opts)` + `judgeSide(text)`（对/错文字点选、三口径验收）；`ensureBlankReady()` / `writeBlankOnce()` 拆分；`saveOne()` 单题页全页兜底；`apply` 末段用 `normPageAnswer` 折算；`answerGroup` 非字母键按位置取 |
| `07-ui.js` | 小球单击「答一题」后回 toast：`preview` / `all-answered` / `#n 已答 · 下一题 #m` |
| `08-main.js` | 删除 `answers` 持久缓存（`readAnswers/saveAnswer/cachedAnswer/cacheKey/ANSWERS_KEY`）；改为 `st.memo` + `memoGet/memoSet/resetMemo`；新增 `maybeEnterPreview()`、`scrollToNextUnanswered()`、`applyWithRetry()`；`answerNext()` 按 OCS 顺序重写（切预览 → 下一道未答 → 判 → 落盘 → 保存 → 自动推进）；`start()` 复用 `maybeEnterPreview`；boot 里按 `engine.previewDelayMs` 自动切预览 |

## 关键流程与数据流

### 1. 抓题

```
detectPage()                     // URL + DOM 双判据 → {kind, mode, hasQuestion}
  ↓ kind=exam/work          ↓ kind=chapter
querySelectorAll('.questionLi')   querySelectorAll('.TiMu')
  ↓ 过滤嵌套容器、跳过 .mark_answer 解析区
parseOne(root) → 题型判定:
   input[name^="type\d+"] / input[id^="answertype"]  → TYPE_MAP[]
   无 type 时 guessType(stem, options)（判断题词表/多选关键词/无选项=填空）
  ↓ 选项：`.answerBg .answer_p, .textDIV, .eidtDiv` → **嵌套去重，保留最外层**
  ↓ 文本：innerText → textContent → 子树拼接；cleanOption 去字母前缀
  ↓ 图片：img[src] 过滤 icon/logo/blank.gif
题目对象 + 加密字体元素 → 02-font 还原乱码字
```

### 2. 判定（04-ai）

```
buildPanel()            按 mode 生成面板：
                          council → N 个不同 provider
                          fast    → 同一 provider × N 次，temperature 0.15/0.50/0.85
                          single  → 1 个
Round1 runSolveRound()  Promise 池（并发=judge.concurrency）并行 /chat/completions
                        → parseModelResult()：JSON 解析 → 字母/文本/判断题词表/相似度四级映射
                        → {keys, answerText, confidence, reason}
tally()                 加权 score = Σ(weight × confidence)，一致率 = 冠军分 / 总分
   ratio ≥ voteThreshold → 采纳，stage='panel'
   ↓ 否则
Round2 runCritiqueRound()  把各候选连同理由交给每个模型复核，可改判，
                           复核票权重 = weight × 1.2
   达标 → stage='critique'
   ↓ 仍不达标
Round3 runArbiter()        取面板首位模型裁决，权重 × 1.5 → stage='arbiter'
   ↓ 全失败
   stage='fallback'（取加权最高）
置信度 = 支持者均值 + min(0.12, (支持数-1)×0.04)
```

### 2b. 读图（03b-vision → 04-ai.resolveVision）

```
question.images 非空 且 ai.vision.enabled 且 strategy != 'off'
  ↓ Vision.prepare(question)
      load(url)  ─ data URL 直通 / 10min 缓存命中 / fetchBlob → blobToDataUrl → compress(maxEdge,quality)
              ─ 失败或 bytes<600（占位图）或累计超 maxTotalBytes → 丢弃并计入 dropped
      items = [{url,dataUrl,bytes}]
  ↓ resolveVision() 按 strategy 分流
      inline → 直接把 dataUrl 作为 image_url 内容块塞进消息（要求该 provider.vision）
      ocr    → Vision.transcribe()：SYSTEM_VISION 提示词 + 图片 → {text,questionText,options,kind,confidence}
               结果按 'ocr|urls|题干前160字' 缓存；解析失败用原文兜底且 confidence≤0.45
      auto   → 面板含视觉模型则 inline，否则 ocr；转写失败记 warn 按纯文本判题
      off    → 不读图
  ↓ buildSolveMessages(q,hint,vctx,provider)
      插入【图片】说明 + 【图片转写】文本块；仅 inline 且 provider.vision 时附图片块
  ↓ solve() 返回值带 vision:{mode,images,sent,dropped,ocrChars,ocrBy}
```

### 3. 落盘（05-apply）

```
apply(q, result)
  ├ 选择/判断 → answerChoice()
  │    ├ 单选/判断：取 keys[0]
  │    ├ 多选：补齐未选项 → 取消多余勾选
  │    └ clickOne(): clickableCandidates 生成有序候选
  │         [.answer_p, .textDIV, .eidtDiv, input, el, 上层 li/a, closest('.answerBg')]
  │         humanClick(): scrollIntoView → over/enter/move → focus → down → up → click
  │                       （每步 6~130ms 随机；首个候选追加原生 click 兜底）
  │         轮询 isChecked 最多 verifyMs；失败换下一个候选（最多 4 个）
  │         仍失败 → 直接置 input.checked + input/change 事件
  └ 填空 → answerBlank()：splitBlanks("|||" 或 "；" 分隔) → 逐空
              textarea/input → typeInto() 分段写值，每段触发 keydown/input/keyup/change/blur
              iframe        → contentDocument.body.innerHTML + input/keyup
```

### 4. 主循环（08-main）

```
Engine.start()
  ├ 无可用 provider → 直接打开设置面板并返回
  ├ 整卷：collect() 一次 → 逐题（每题重新 collect 取新引用，防 DOM 重绘）
  └ 单题：collect()[0] → 作答 → clickNext() → 轮询题干变化（最多 3s）
每步之间：waitIfPaused() → Guard.pace(i)（min~max 抖动 + 每 N 题长停顿 + 3% 犹豫）
结束：可选 maybeSubmit()（找不到交卷按钮只告警）
```

### 5c. 云同步（10-sync + functions/api/sync）

超星考试页跨子域（i. / mooc2-ans. / passport2.），浏览器存储按 origin 隔离 → 纯前端传不过去，必须服务端中转。

- 客户端 `src/10-sync.js`：`makeCode()` 生成 `<id>.<key>`（8B id + 16B 密钥，base64url）；
  `push()` 用 `crypto.subtle` 做 AES-GCM 加密后 PUT，附带 `HMAC(key,'cx-exam-ai:write:v1')` 作为写令牌；
  `pull()` GET 后用同一 key 解密；`autoPull()` 只在「存过码 + 本地无配置」时执行（不覆盖本地改动）。
- 请求走 `GM_xmlhttpRequest`（`anonymous: true`，不带 cookie）→ 降级 `fetch`。
  **GET/HEAD 绝不能带 data**，否则 `fetch` 报 `GET cannot have body`（踩过一次）。
- 服务端 `functions/api/sync/[id].js`：GET 返回 `{blob,at}`；PUT 首次绑定 token、之后校验；
  DELETE 校验 token；`blob` 上限 24KB；KV 90 天过期；CORS 允许 `*`。
- 存储键：同步码在 `Store` 的 `syncCode`（不与配置 JSON 混存）。
- **配置在 localStorage 里有两份**（GM 垫片 `cxai:<KEY>` + 裸 `<KEY>`），写测试或清理时两处都要处理。

### 5b. 独立设置中心（09-settings）

`settings.html` 只是一份深色骨架 + `<html data-cxai-settings>` 标记。脚本的 `08-main.ready()` 一进来先问
`CXAI.Settings.isHere()`（看 HTML 属性 → 路径 `/settings(.html)` → `?cxai=settings` / `?settings=1` → Pages 域名根路径），
命中就 `CXAI.Settings.mount()` 并 `return`：**不跑考试逻辑、不装 guard、不挂浮球**，整页交给设置中心。

- `mount()`：注入 CSS（有 `GM_addStyle` 就用它）→ 删掉骨架的 `#cs-boot-style`（深色样式会污染浅色的 `code`/`a`）→
  `document.body.innerHTML=''` → 渲染 `id="cx-ai-settings"`。
- 六栏：`model`（provider 卡片 CRUD / 预设联动 / `AI.listModels` 拉取 / `AI.ping` 单卡测试 / 上移下移）、
  `judge`、`vision`、`run`、`backup`（导出/导入/下载/上传/恢复默认）、`diag`（`CXAI.diag()` 原始输出）。
- 字段写入：provider 字段走 `data-f` + `data-i`，全局字段走 `data-path`（点分路径，MB 换算走 `data-path-x`）。
  所有改动走 `touch()` → 280ms 防抖 → `CXAI.Cfg.save()`，没有「保存」按钮。
- **`syncVisionRoles()`**：`ai.vision.ocrProviderId` / `judgeToo` 一变，就同步所有 provider 的 `role`
  （选中者 `vision`/`both`，其余 `judge`）。少了这步，会出现"读图下拉改了但 `visionProviders()` 还按旧角色挑模型"。
  只配了一个模型时自动把 `judgeToo` 打开（否则判题面板为空）。
- 深链：`?tab=judge` 直接落到指定栏；`S.tab` 取值即上述六栏 id。
- **存储不跨域**：GM 存储作用域是「脚本 + 站点」，设置页（pages.dev）与考试页（chaoxing.com）各有一份。
  跨域搬运靠 `CXAI.cfgCodec`（base64+UTF-8）：
  - 设置中心「备份 → 同步到学习通」：生成 `https://i.chaoxing.com/base#cxai_cfg=<code>` 并打开；
  - `08-main.consumeConfigHash()` 在 **gate 之前**（任何匹配页面）读取该 hash → `Cfg.importJSON` → 写本域存储 →
    `history.replaceState` 清掉 hash（避免重复导入、避免配置留在地址/历史里）；
  - 备用通道：设置页「复制配置码」/ JSON 导出 → 考试页面板「备份 → 导入」。

### 5d. 一键发布（tools/release.js）

```bash
npm run release -- --bump patch|minor|major   # 升版本后发布
npm run release -- --version 1.11.0           # 指定版本
npm run release:dry                           # 只构建+自检+测试+生成 .site/
```

八步流水线，**任一步非零退出立即中止**：

| # | 步骤 | 说明 |
|---|---|---|
| 0 | 版本号 | `package.json.version` 为唯一来源，写入 `src/00-header.js` 的 `@version`；两处不一致直接 die |
| 1 | `node build.js` | `dist/cx-exam-ai.user.js`（唯一交付物，脚本不手改） |
| 2 | `node tools/check.js` | 模块编号/语法/契约自检 |
| 3 | `node tools/test-dom.js` | 离线集成测试（可 `--skip-test`） |
| 4 | `node tools/build-site.js` | 生成 `.site/`（Pages 发布目录，**只有** index/settings/dist/images） |
| 5 | `git add` + `commit` | 只 add 白名单路径；暂存区出现 `logs/`/`.cdp-profile/`/`.chrome-profile/`/`.shot-*` 立即中止；无改动则跳过 |
| 6 | `git push origin main` | Greasy Fork 从 main 自动同步（ID 605687） |
| 7 | `npx wrangler pages deploy --branch=main` | 上传 `.site/` + Functions bundle（`--no-deploy` 可跳过） |
| 8 | 线上回读 | `curl` Pages 上的 `dist/cx-exam-ai.user.js` 校验 `@version`（`--no-verify` 可跳过；CDN 时延只告警不失败） |

参数全集见 `CLAUDE.md`「正式发布流程」。**不要**改回"手动 build + 手动 push + 手动 wrangler"三连，版本号两处漏改是历史高频事故。

### 5e. 全题型兜底（v1.11.0）

```
Scraper.parseOne
  ├─ 题型码 0~17 → type；码缺失/未知 → guessType(stem, options, shell)
  ├─ detectShell(root, options, inputs, attachments) → shell
  │    attach → group → match → media → choice → text → manual（顺序即优先级）
  └─ q = {type, typeLabel, shell, shellLabel, inputs, media, options, images, attachments, root}

AI.solve(q)
  ├─ councilSolve：议会 → 复核 → 仲裁（原逻辑）
  │    解析：parseModelResult（JSON 缺失时抓「答案：X」/整段文本；全角归一化）
  └─ 抛错 / 空答案 → rescueSolve
       ├─ rescuePanel = 判定面板 + 全部可用端点（去重，图片题视觉优先）
       ├─ 逐模型 buildRescueMessages + SYSTEM_RESCUE（最多 ai.fallback.tries 个）
       ├─ 成功 → stage='rescue'（标注「兜底重试」）
       └─ 仍失败 → heuristicAnswer：题干自带答案 → 首选项（stage='heuristic'，置信度 0.15~0.55）
            文本题没有可确定内容时返回 null → 整题标红继续下一题

Apply.apply(q, result)
  ├─ 文本题找不到输入框 / 选择题抓不到选项 → {ok:false, manual:true, error}
  └─ manual 不触发 apply.stopOnFail 的暂停（答案由题下标注交给人工）

03d-mark.render(q, result, applied)
  └─ 每题末尾 Shadow DOM 卡片：状态 / 答案（字母带选项文字）/ 置信度 / 阶段 / 依据 / 页面比对 / 投票 / 失败原因
```

### 5f. 进考试页自动同步（v1.11.0）

```
08-main boot.ready()
  ├─ UI.mount() → Cfg.load()
  ├─ 有 syncCode？
  │    ├─ 是 → Sync.syncBoot()
  │    │        ├─ pull(code)（AES-GCM 解密）→ Cfg.importJSON(obj) → 写 syncState{ok,models,ms}
  │    │        └─ 返回 {ok, models} / {ok:false, error}
  │    │    ├─ ok  → UI.syncOk()：绿圈 + 小球弹动 + 气泡 ✓，1.6s 收起
  │    │    └─ 失败 → UI.syncFail()：红圈 + 气泡抖动 + togglePanel(true) + 面板顶部 #syncfail 显示原因
  │    └─ 否 且本地无模型 → UI.openSync({auto:true})：小球上方气泡（1 输入框 + 1 按钮）
  └─ 之后照常 pollQuestions → primeFromPage → Mark.attachAll → prefetch
```

- 同步码与同步服务地址都存在独立键（`syncCode` / `syncAPI`），不随配置 JSON 一起被覆盖，配置被云端旧版本顶掉后还能再拉回来。
- 手动同步入口：面板右上角 ⇅、未配置时的「输入同步码」按钮、油猴菜单；三者都打开同一个 `#syncpop`。

### 5. 状态与配置

- 配置全部落 `CXAI.Store`（GM_getValue/setValue，回退 localStorage），键 `CXAI.CONFIG_KEY`
- 运行时状态只在内存：`Engine.st = {running, paused, stopped, cursor, cache(Map), results, skipped, failed}`
- 会话缓存键 = `normText(stem) + '|' + normText(options).join('|')`，同一份卷子重复题干不重复花 token

## 修改安全守则

16. **设置窗（`#mask`）必须挂在 shadowRoot 直接子节点上**，不能嵌回 `.wrap` / `.panel`：`panel` 默认 `display:none`、`.wrap` 只有 46px 宽，嵌进去必然 0×0 且点不到（v1.1.1 已修，勿回退）。
17. **`DEFAULT_CONFIG` 必须覆盖所有 `Cfg.get('a.b')` 路径**。缺段时 `get` 有 fallback 不报错，但任何直接读 `Cfg.data.a.b` 的代码（如设置面板模板）会抛异常并中断整个渲染。新增配置项时两处一起改。
18. **设置面板的 DOM 契约：全部 `#cfg-*` id 一个都不能删**。`#cfg-strength` 只是把 `#cfg-mode / #cfg-panel / #cfg-critique / #cfg-arbiter` 四个字段联动起来写值，`#cfg-vmodel` 决定 provider 的 `role`，`saveConfig()` 仍然逐个按 id 读取——把字段移进 `details.adv` / `details.more` 折叠区只影响可见性（折叠时 `value`/`checked` 照样可读），但删掉元素会让保存静默丢值。新增开关时同时更新 `DEFAULT_CONFIG`、`openConfig` 模板、`saveConfig`、`readProviders`（若属 provider 级）。

19. **改 `07-ui.js` 的大段模板不要用 python 字符串切片粗暴替换**。`index('      .join(...)')` 这类锚点在一个文件里会出现多次（`presetOptions` / `visionProviders` 下拉都有），命中错位置会静默复制整段函数——语法合法、测试全绿，但体积膨胀且后定义的函数覆盖前面的。改完必须核对：`grep -c "function openConfig\|function renderProviders"` 应各为 1，以及 `grep -c "更多 · 接口风格"` 应为 1。

20. **所有 HTTP 请求走 `httpMethod(method, url, headers, body, timeout)`**，`httpJson` 只是 POST 特化。新增 GET 类接口（如 `listModels`）不得私拼 `fetch`，否则 GM/fetch 两条分支会各自漂移；`listModels` 是只读能力，任何时候都不许在里面写配置或改 provider。
1. **文件编号即加载顺序**。新模块必须取名 `NN-xxx.js` 且插在正确位置；`08-main.js` 必须是最后一个（它自执行 boot）。`tools/check.js` 会校验编号递增与关键导出。
21. **模型选择浮层 `#mpop` 必须挂在 `shadowRoot` 直接子节点**（和 `#mask` 同理，嵌在 `.panel` 里会 0×0）；判断「点在外面」只能用 `document` 级 `mousedown` + `e.composedPath()`，Shadow DOM 内 `e.target` 会被重定向成宿主节点，用 `root.contains(e.target)` 会永远判成外部。新增下拉/浮层类 UI 一律照此写，不要再用 `<datalist>`（Chrome 只显示前 3 项）。
2. **模块间只通过 `CXAI.*` 通信**，不要在文件顶部用 `const` 互相引用——拼接后是同一作用域，重名会静默覆盖。
22. **provider 行的 `role` / `vision` 由「读图模型」下拉统一决定**（`readProviders()` 末尾），勾了 `#cfg-vjudge` 的那一行是 `role='both'`；`buildPanel()` 在 `ai.vision.judgeToo` 为真时必须把 `both` 挤进面板，否则「勾了兼任但 panelSize=1」会静默失效，行内不再有角色控件；新增任何 provider 字段，要么常显、要么删掉 UI 只留默认值，不要复活 `details.more`（v1.3.0 起界面只有三个常显块 + 高级设置）。`readRow()` 必须对不存在的控件返回安全默认值，否则删控件会静默改坏请求参数（例如空温度 `Number('')===0`）。
3. **改选择器要同步改测试夹具** `tools/test-dom.js` 的 `buildExamPage()`，否则测试会"绿着烂掉"。当前夹具已覆盖 `.questionLi` 四题型 + 点击态。
4. **`readOptionElements` 的嵌套去重不能删**。`.answerBg .answer_p` 与内部 `.textDIV` 同时命中会让选项数翻倍、答案字母错位（本项目已踩过）。
5. **`isChecked` 三层查找不能收窄**。选中 class 的位置在不同页面版本间会漂移（自身/父级/祖父级）。
6. **交卷逻辑保持"默认不点"**。`maybeSubmit()` 只有在 `apply.autoSubmit===true` 时才动作，且带 10s 中止窗口；任何改动不得去掉这个窗口与"停止可中断"判断。
7. **Prompt 改动后跑 `node tools/test-dom.js`**。测试对 system prompt 的关键词（`最终裁决者` / `复核专家`）做了分发断言，改词要同步测试，否则会误判为通过。
8. **新增 provider 只动 `DEFAULT_CONFIG.ai.providers` 与 `CXAI.PRESETS`**，运行时一律走 `CXAI.Cfg.activeProviders()` / `visionProviders()` 过滤（前者排除 `role==='vision'` 的纯读图模型（`both` 会留在面板里），后者按权重降序只取 `vision===true`）。
9. **`normalizeProvider` 是唯一入口**。UI 读回、配置加载、预设应用都必须过它；直接塞裸对象会让 `apiStyle`/`keyOptional`/`maxTokens` 缺省，导致本地网关被误判为"缺 Key"而静默丢失。
10. **读图链路三段各自可降级**：`fetchBlob` 失败 → 丢弃该图并 warn；`compress` 无 canvas/Image → 原样返回大图；`transcribe` 解析失败 → 原文兜底且 confidence≤0.45。任何一段都不允许抛到 `solve()` 外面中断整卷。
11. **`resolveVision` 的 inline 判定只看 `provider.vision`**。给不支持视觉的端点发 image_url 会被 400，因此不要在 `buildSolveMessages` 里放宽这个条件。
12. **`ai.vision` 是对象不是布尔**。旧版布尔值由 `Cfg.load()` 迁移；新增字段必须同时改 `DEFAULT_CONFIG.ai.vision`、`Vision.cfg()` 归一化、设置面板 `#cfg-v*` 三项，否则保存时静默丢失。
13. **字体算法参数是双向契约**：`RENDER=360 / SQ=480 / BASELINE=384 / SHORTLIST=40 / INK_THRESHOLD=40` 必须与 FRB2 特征表生成端一致，单边改动会整体错字。
14. **构建产物不入源码逻辑**。`dist/` 是纯拼接结果，任何修复都必须落在 `src/`。
15. 单文件体积已达 ~146 KB；继续膨胀前先考虑把 FRB2 特征表改为按需远程拉取（当前实现已保留该分支）。

23. **落盘时不要拿"探测结果"当闸门**：`isLive()` / `contains()` / `getBoundingClientRect()` 只用来**描述**状态，不能用来**决定是否动手**。派发事件给游离节点无副作用，验收（`waitChecked` / `freshAnswered` / `retryByText`）才是唯一判据。v1.4.2~v1.4.3 三次"点不上"的根因都是把探测当准入条件：探测在 Tampermonkey 沙箱 / 局部重绘 / iframe 环境下会误判，判错就一次点击都发不出去。同理，`clickOne` 的 `tried` 必须记录每一步（含 `(跳过)`），失败信息里带 `live/conn/inDoc/rect/cls` 探针，否则只能看到"无可用元素"这种没法定位的结论。

24. **发布相关的东西都是"三处联动"，改一处必改其余**：版本号在 `src/00-header.js` 的 `@version` 与 `package.json` 的 `version`（构建脚本把后者注入 `CXAI.__version`）；安装链在 `index.html` 卡片、`README.md` 安装表、`src/00-header.js` 的 `@updateURL`/`@downloadURL`。任何一处漏改都会出现"页面写着 A 版、装下来是 B 版"。`dist/` 永远不手改，只跑 `node build.js`。
25. **提交前跑 `git status --short` 自查**：出现 `logs/`、`.cdp-profile/`、`.chrome-profile/`、`.shot-*.png` 说明 `.gitignore` 被绕过（多半是 `git add -f`）。这些目录含考试页面截图、登录态 Cookie、模型 Key，一旦推到公开仓库等于泄露，且从历史里清不掉。

## 变更记录

### v1.12.0（2026-11-24）仅显示答案 · 右下角答案条 · 进页即判题 + 审查 P1 修复

| 改动 | 涉及文件 |
|---|---|
| 新增 `ui.showOnly`（默认 true）与 `ui.answerCorner`（默认 true）；`engine.prefetchDelayMs` 默认 2000→800 | `01-core.js` `09-settings.js` |
| 仅显示模式：`handleQuestion` / `answerNext` 判题后不落盘不翻页，答案进面板与答案条；面板新增「仅显示/自动点选」快捷按钮 | `08-main.js` `07-ui.js` |
| 右下角答案条（Shadow 元素 `#anscorner`，固定 right/bottom 12px，可折叠）：题号+答案清单，选择题点击跳题、文本题点击复制剪贴板，头部显示已判/预取进度 | `07-ui.js` |
| P1#1 `accept()` 里 `resolveAnswerKeys(...).keys` 空指针 → 判空沿用 winner 原文 | `04-ai.js` |
| P1#2 `syncBoot()` 绕过 `ui.forcePull`：本地已有模型默认不覆盖，返回 `{skipped:true}`，boot 按跳过处理不标红 | `10-sync.js` `08-main.js` |
| P1#3 断点续跑 `st.baseDone` 被 qlist 统计覆盖 → 取 max | `08-main.js` |
| P1#4 判断题题型被猜成 single 时 `true/false` 隐藏域终验折算（两选项且值像布尔也走 judgeKey） | `03-scraper.js` |
| `collect()` 加 250ms 短窗 memo（`invalidateCollect` 导出；`applyNextPage`、`Apply.apply`、`applyWithRetry` 处失效；换 document 自动失效） | `03-scraper.js` `05-apply.js` `08-main.js` |
| `UI.unmount()` 联动清掉交卷检测 interval（句柄挂 `CXAI._finishTimer`）与 `Guard.uninstall()` | `07-ui.js` `08-main.js` |
| 离线测试补 [21] 仅显示模式断言 + memo 失效插桩；版本升 1.12.0，README 更新日志同步 | `tools/test-dom.js` `00-header.js` `package.json` `README.md` |

审查遗留（本轮未动，已记录）：判断题词表五处并行漂移、三套文本题型映射、localStorage 明文镜像 apiKey、`consumeConfigHash` 无确认导入、Gemini key 拼 URL、死代码清单（`waitChecked`/`currentAnswered`/`readTypeInput` 等）。后续按 P3→P4 顺序清理。

### 未发布 · 诊断工具（2026-11-19）新增现场取证脚本 tools/diag-mapping.js

用户反馈「实际给出的答案和勾选的选项明显不符」。本轮不改业务代码（未定位到具体题目的实机 DOM 证据），先补一把能一次定位的尺子：

| 改动 | 文件 |
|---|---|
| 新增只读取证脚本（不改业务代码，不参与打包）：逐题打印位置键 / 页面字母 / data / 选项文本 / 选中态 / 隐藏域，并标出 `页面字母 ≠ 位置键` | `tools/diag-mapping.js` |

**排查口径（配合本脚本判读）**，三条按概率排序：

1. **抓题层按键是最可疑的一条**：`03-scraper.parseOne`（`.map((el, i) => key: String.fromCharCode(65 + i))`）与 `parseChapter`（同款）只按 DOM 位置发字母键，`cleanOption` 又把页面自带的「A、」前缀剥掉不再保留。页面字母标签顺序一旦与 DOM 顺序不同（选项乱序 / 共用选项池重排 / 上一题残影混进 `.questionLi`），模型说的 B 与点下去的元素就不是同一个。
2. **重试链串题**：`08-main.applyWithRetry` 失败会 `relive(q)` → `03-scraper.pickSame`，而 `pickSame` 的通过线是 `bestScore >= 40`，而「选项文本全重合」本身就能拿满 40 分（qid 不同的扣分只在两边都有 qid 时生效）。于是两道选项池相同的题（判断题「对/错」、共用选项题、同类单选题）会互相命中，答案落到另一道题上。
3. **显示口径不是 bug**：面板「答案」列印解析后的字母，`03d-mark` 的「页面」列印 `answerView(q)`，两者不同就会显式标「与 AI 不同」——那是报警，不是故障本身。

### v1.11.15（2026-11-19）答一题对齐 OCS + 废弃跨场缓存 + 判断题/填空修复

用户四条实测反馈，一次修完（`src/03-scraper.js` `src/05-apply.js` `src/08-main.js` `src/01-core.js` `src/07-ui.js`）：

1. **不再缓存"之前查过的题"**：删掉 `Store('answers')` 持久缓存（`readAnswers/saveAnswer/cachedAnswer/cacheKey/ANSWERS_KEY` 全部下线），
   判定结果只留在内存 `st.memo`（键 = `rowKeyOf`：qid 优先），`resetMemo()` 在每次开跑时清空。
   预取仍然复用（同一页同一场），但跨页/跨场/跨天一律重判。日志文案改为「用本页预取好的判定」。
2. **答一题 = OCS 的推进顺序**：新增 `maybeEnterPreview()`，进页/首次点小球都会先切「整卷预览」（`answer.preferPreview` 默认开，
   新增 `engine.previewDelayMs`）；`answerNext()` 重写为「切预览 → 取下一道未答 → 判题 → `applyWithRetry` → 填空补保存 →
   自动切下一题」：整卷页 `scrollToNextUnanswered()` 滚动+高亮下一题，单题页仍走无刷新翻页。小球单击会 toast 结果与下一题号。
3. **判断题能答了**：根因是 `hoverDiv + span[data=true/false]` 皮肤被 `readGroupBlanks` 当成"1 个空的小题组"，
   字母答案永远对不上 → 日志「小题组只落了 0/1 个空」。新增 `03-scraper.normalizeJudgeGroup()` 在抓题阶段还原成判断题
   （选项键 A/B、文字折成对/错），`05-apply.answerJudgement()` 按「对/错」文字点选并用三条口径验收
   （隐藏域折算 / 选中标记 / clickOne 自证）；`answerGroup` 另加"非字母键按位置取"兜底。
4. **填空题第一次不输入**：`answerBlank()` 拆成 `ensureBlankReady()` + `writeBlankOnce()`：先等 UEditor 实例就绪
   （`ensureEditorsAsync`），一次没写进去就重取题目再写一遍，失败原因写进日志。
   另修 `saveOne()`：单题页的「保存」按钮常在题目容器外，只有一道题时允许全页兜底。

### v1.11.14（2026-11-19）小题组必须 N 段

| 改动 | 文件 |
|---|---|
| `groupAnswerUnusable` 增判「字母段数 < 空数」 | `src/08-main.js` |
| 小题组 prompt 强制 N 段并给等长示例 | `src/04-ai.js` |

### v1.11.13（2026-11-19）残缺题直接判「题目有问题」

| 改动 | 文件 |
|---|---|
| 占位选项时 `answerGroup` 早退（`broken:true`，不再点任何选项） | `src/05-apply.js` |
| `handleQuestion` 区分 `broken`（题目有问题）与 `manual`（需人工填写） | `src/08-main.js` |

### v1.11.12（2026-11-19）对比口径与共用选项题干

| 改动 | 文件 |
|---|---|
| `fixWrong` 对比改用 `answerView`（小题组不再因 JSON≠字母而重答） | `src/08-main.js` |
| 文本答案按段落/换行拆分，`<p>` 多答案输出为 `A\|\|\|B` | `src/03-scraper.js` |
| 共用选项题抓 `.B-tit` 作为每空题干 | `src/03-scraper.js` |

### v1.11.11（2026-11-19）页面答案口径统一

| 改动 | 文件 |
|---|---|
| 新增 `Scraper.answerView(q)`：多空/小题组/富文本统一成 `A\|\|\|B` 展示口径 | `src/03-scraper.js` |
| `recordQ` / 日志改用 `answerView`（验收仍用 pageValue） | `src/08-main.js` |

### v1.11.10（2026-11-19）字母答案放行 + 单一高亮

| 改动 | 文件 |
|---|---|
| `groupLettersComplete()`：小题组字母齐全时绕过低置信度闸门 | `src/08-main.js` |
| 面板格子只渲染一个高亮（跑批跟 current，停下跟 sel） | `src/07-ui.js` |

### v1.11.9（2026-11-19）完型分组修复

| 改动 | 文件 |
|---|---|
| 修 `readGroupBlanks` 的 `block` 作用域 bug（完型题抛 ReferenceError → group=0） | `src/03-scraper.js` |
| `groupAnswerUnusable`：小题组缓存里没有字母的散文答案作废重判 | `src/08-main.js` |
| 整卷模式逐题更新 `UI.current`，面板高亮随题移动 | `src/08-main.js` |

### v1.11.8（2026-11-19）面板与小题组刷新

| 改动 | 文件 |
|---|---|
| `relive()` 接受 `group` 非空的刷新对象（小题组不再用 group=0 的过期快照） | `src/08-main.js` |
| 整卷模式 `q.no = i + 1`，面板高亮随题移动（不再固定显示 URL start） | `src/08-main.js` |
| 状态 `skip` 与 `ok` 同级渲染为绿色（已答且与判定一致） | `src/07-ui.js` |

### v1.11.7（2026-11-19）阅读小题题干入 prompt

| 改动 | 文件 |
|---|---|
| `readGroupBlanks` 采集小题题干（`.reader_answer_tit`）写入 blank.stem | `src/03-scraper.js` |
| 判定 prompt / 复核 prompt 的「第 N 小题」带上题干 | `src/04-ai.js` |

### v1.11.6（2026-11-19）占位选项识别

| 改动 | 文件 |
|---|---|
| 小题组选项为占位文本（`选项\d+`）时跳过文字匹配，只接受字母答案；否则明确转人工并说明原因 | `src/05-apply.js` |

### v1.11.5（2026-11-19）小题组落盘修正

| 改动 | 文件 |
|---|---|
| 小题组点击后轮询回读（JSON/标记），禁止"读不到就再点一次"造成的 toggle 掉选 | `src/05-apply.js` |
| 新增 `optionMarked` / `blankStateOf`：JSON 隐藏域 + 选项标记双通道回读 | `src/05-apply.js` |
| 新增 `.B-answerCon[index]` + `span[choice_name]`（共用选项题）解析 | `src/03-scraper.js` |
| `group` 不再依赖 `shell==='group'`，所有题型统一尝试解析小题组 | `src/03-scraper.js` |

### v1.11.4（2026-11-19）真机三连修

| 改动 | 文件 |
|---|---|
| `fire()` 不再传 `view: window`（油猴沙箱里构造 MouseEvent 会抛异常），并加 `Event` 兜底 | `src/05-apply.js` |
| 填空/简答落盘后一律点本题「保存」（单题页也点），日志区分有无独立保存按钮 | `src/08-main.js` |
| `jumpTo` 优先 `#qN` / 题块 `scrollIntoView` 并高亮；单题页才走 `getTheQuestionByStart` | `src/08-main.js` |
| `readGroupBlanks` 支持 `.hoverDiv` + `span[data][qid]` 形态（完型/阅读/共用选项），按空 UUID 分组 | `src/03-scraper.js` |
| `answerGroup` 回读支持 `input[name="answer<题号>"]` 的 JSON（键=空 UUID） | `src/05-apply.js` |

### v1.11.3（2026-11-19）验收口径与配置收口

| 改动 | 文件 |
|---|---|
| 填空/简答「全部空落盘才算成功」，partial 报 manual 并暂停 | `src/05-apply.js`、`src/08-main.js` |
| 多选最终验收按集合相等（AC ≠ AB）；`retryByText` 的成功改由隐藏域回读 | `src/05-apply.js` |
| `clickOne` 只认选中证据（真类名/checked/非 hover 新增类），不再靠整串指纹变化 | `src/05-apply.js` |
| 保存按钮去掉全页兜底，限定本题题块 / `saveQuestion(qid)` | `src/05-apply.js` |
| 新增 `answerSelectGrid`：连线/匹配/排序按下拉框写入并回读，拖拽形态明确转人工 | `src/05-apply.js` |
| 低置信度（`lowConfidence`/heuristic）默认不落盘，`apply.allowGuess` 才写 | `src/08-main.js`、`src/01-core.js` |
| `tally` 先归一化再按包含/Dice 相似度聚类 | `src/04-ai.js` |
| 图片筛选：滤头像/二维码/图标，题干容器图优先 | `src/03-scraper.js` |
| 「A 组」剥离条件修正（后接非字母才剥） | `src/03-scraper.js` |
| 单题判重 key 带图片指纹；`answerNext` overwrite 模式轮转；整卷按 `pickSame` 找回题目 | `src/08-main.js` |
| 配置对齐：删死开关 `answer.humanize/fillText/skipAnswered/autoNext/intervalMs`、`antiDetect.*`；补 `apply.settleMs/submit/allowGuess`、`ui.logMax/syncAPI/forcePull`；设置页同步 | `src/01-core.js`、`src/09-settings.js` |
| 云同步 `autoPull` 默认不覆盖本地（`ui.forcePull` 才覆盖） | `src/10-sync.js` |
| Guard：getter/`hasFocus/confirm/alert/setInterval` 加 toString 伪装，弹窗白名单收紧 | `src/06-guard.js` |
| 交卷后自动确认弹窗（8 秒轮询） | `src/08-main.js` |
| 回归用例变更：部分填空不再算成功 + 新增 [21] 四组（apply 层 partial / 连线 / 多选集合 / 投票聚类），152 项 | `tools/test-dom.js` |

### v1.11.2（2026-11-19）答题链路小 bug 集中修复

- **字形解密接入主链路**：`03-scraper.collect()` 先 `Font.ensureSync`；`08-main.handleQuestion/prefetch/answerNext` 在判题前 `Font.ensure()` 并重新抓题（`decryptIfNeeded`）。`02-font` 特征表加长度/字段校验，失败 60 秒后可重试。
- **fixWrong 语义修正**：页面已答且暂无判定结果时先判题，再用 `sameAnswer()` 比对；一致则 `skip`，不再无条件重写。`01-core` 新增 `apply.fixWrong` 默认项。
- **qid/缓存串题**：`qidOf` 改为"题块 data → 题型隐藏域长数字 → 仅单题页用 #questionId"；`08-main.cacheKey/saveAnswer/cachedAnswer/rowKeyOf` 统一带 qid + 题干 + 选项 + 图片指纹；`answers` 存储上限 400 条。
- **主循环**：单题模式暂停期间不翻页；`answerNext` 写入失败不翻页、整卷填空补点保存；`handleQuestion` 部分填空回报 `partial`。
- **落盘**：`answerBlank` 单空把 `|||` 折成换行；`、` 之外不再用逗号拆空；iframe 只写 contenteditable/UEditor；`editorList/ueditorOf` 只对 textarea 调 `getEditor`；`SEL_TOKEN` 认 `check_answer*` 变体。
- **抓题/判定**：纯图片题不再被空题干过滤；`parseChapter` 选项嵌套去重；`auto` 读图在混合面板下改走 OCR；`fast` 温度封顶 1；复核/仲裁提示词补小题组选项。
- **入口/UI/设置**：题块晚渲染时入口轮询 15s；`applyNextPage` 兜底补回 `#submitTest`；`07-ui` 卸载摘监听、球拖动阈值 10px、manual 标红；设置中心数字框空值不写 0、读图开关与 strategy 联动、异步结果按 id 回写、导入配置类型归一（`CXAI.U.coerceLike`）。
- 测试 `tools/test-dom.js` 新增 [19] 回归 12 项与 [20] 主循环 fixWrong 4 项（共 147 断言）。
- **涉及文件**：`src/01-core.js` `src/02-font.js` `src/03-scraper.js` `src/03c-attach.js` `src/04-ai.js` `src/05-apply.js` `src/07-ui.js` `src/08-main.js` `src/09-settings.js` `tools/test-dom.js` `README.md` `MAINTENANCE.md` `package.json` `src/00-header.js` `dist/cx-exam-ai.user.js`

### v1.11.1（2026-11-19）更正本地网关 403 的归因

- **归因更正**：v1.11.0 收尾时把"3 个模型全部网络失败"记成"magpie 需要把 chaoxing 页面加进白名单"。真实环境不成立 —— 脚本请求优先走 `GM_xmlhttpRequest`（`src/04-ai.js:68`），它由油猴扩展后台发出、**不带页面 Origin**，网关正常返回 200。当时是 CDP 调试环境里 `tools/shim.js` 把 `GM_xmlhttpRequest` 实现为页面内 `fetch`（带 `Origin` + `credentials:'include'`），才触发网关 `permission_error`。实测证据：`curl` 带 `Origin` → 403，不带 → 200。
- **文案修正**：`httpMethod` 的 403 分支保留「去网关白名单」提示（只在网关明确回 permission_error 时出现）；`onerror` 分支改为「请求没发出去（baseURL/网络/代理/浏览器拦截）」并说明 GM_xmlhttpRequest 不受 CORS/Origin 限制，避免把调试环境的现象当成使用前提。
- **涉及文件**：`src/04-ai.js` `README.md` `MAINTENANCE.md` `src/00-header.js` `package.json` `dist/cx-exam-ai.user.js`

### v1.11.0（2026-11-18/19）全题型兜底（含小题组）+ 面板详情 + 球单击按同步状态分流

**背景**：期中考试遇到 PDF 附件题之后，用户又提出「其他各种各样的题型都要确保能找得到答案」「每道题下面直接显示作答详情」「同步逻辑说不清，改成每次进考试页都同步」「同步码输入 UI 重做，成功/失败要有能区分的特效」。

- **题型覆盖**：`TYPE_MAP` 补齐 12/13/16/17（匹配/排序/口语/听力），`labelOf()` 让未知码显示「第 N 类题」；新增 `detectShell()`（`attach/group/match/media/choice/text/manual`）与 `readMedia()`；`guessType` 接收 shell，小题组/连线/音视频各自归类。
- **修 bug（关键）**：`readOptionElements` 之前会把 `<textarea class="eidtDiv">` 当选项 —— 一条简答题被读成"1 个选项的单选题"，答案去点输入框，整卷少写一题。现在 textarea/input/select 一律不算选项（CDP 多题型用例 E5/E6 暴露）。
- **兜底链**：`AI.solve` = `councilSolve` → `rescueSolve`（逐模型极简 prompt）→ `heuristicAnswer`（题干答案/首选项）；新配置 `ai.fallback.{enabled,heuristic,tries}`。附件题缺视觉输入仍然硬失败（避免把瞎猜写进卷子）。
- **解析放宽/收紧**：支持「答案：B」「答案是 B」「全角 Ｂ」、文本题整段（去代码围栏/引号）；`B 正确，因为 A 和 C 都错` 不再被解析成 ABC（短句必须只含一个候选字母）。
- **题下标注（后于同一版本停用）**：曾新增 `src/03d-mark.js` 在每题末尾挂 Shadow DOM 卡片；真机测试后用户明确要求页面上不要这块 → `enabled()` 恒 false，页面零注入，详情只在面板 `renderQDetail()`。
- **manual 语义**：`05-apply` 无可写目标时返回 `{manual:true}`，`08-main` 不因此暂停；整卷继续答下一题。
- **自动同步**：`Sync.autoPull` 默认 force，新增 `Sync.syncBoot()` + `syncState` 持久化；boot 里只要有同步码就同步并回显结果；`apiBase` 把同步地址另存 `syncAPI` 键。
- **同步 UI**：删除 `#syncmask` 弹窗，改为小球上方 `#syncpop`（1 输入框 + 1 按钮）；`syncOk` 绿圈 + 弹动 + 打勾，`syncFail` 红圈 + 抖动 + 面板顶部原因条 + 小球红点；`state.sync.fx` 记录特效类型。
- **测试**：`test-dom` 132 项全绿（新增 [17] 兜底解析/shell、[18] 标注渲染与清理）；`verify-cdp` 扩到 35 项（新增 E 段：本地同步 API 的成功/失败/自动同步、多题型 5 题自动连答、标注与面板答案），线上 API 不可达时 A9/C 段自动跳过并在汇总里注明。
- **2026-11-18/19 真机复测后的追加修复（同一版本内）**：
  - **小题组能落盘**：`03-scraper.readGroupBlanks()` 按 `.addChoice[qid]` 拆小题（完型 6 空 / 阅读 3 问）；`04-ai` 把每空选项列进 prompt 并要求 `A|||C|||B`；`05-apply.answerGroup()` 逐空点 `.addChoice`（onclick 在它身上，点外层 `.hoverDiv` 无效）并用 `#answer{qid}` 验收；**全空才 `ok`**，半落标「需人工」。实测：阅读 3/3、完型 5/6。
  - **多空填空**：`splitBlanks` 补顿号/逗号/换行分隔，"项多取前 N、项少按序留空"；过滤 `input[type=hidden]` / `display:none`，避免 3 空算成 6 空。
  - **面板计数**：统计格 4→5（题目/已答/失败/未答/模型），`未答 = 总数 − 已答 − 失败`，`manual` 独立状态并计入「失败」。
  - **球单击状态机**：无同步码 / 有码未成功 → 单击弹同步码输入框；有码且同步成功 → 单击答题。球上 `⇅` + toast 反馈；有模型但无同步码时进页面自动摆出输入框（30 分钟一次）。
  - **废话守则**：模型回「题目信息缺失 / 无法确定」判失败，不写进卷子。
  - **网关 403 提示**：改写为「到网关设置 → Network and sharing → Web pages 加白名单」。
  - **测试**：`test-dom` 131 项全绿（[18] 改为断言页面零注入）。
- **涉及文件**：`src/01-core.js` `src/03-scraper.js` `src/03d-mark.js`（新增）`src/04-ai.js` `src/05-apply.js` `src/07-ui.js` `src/08-main.js` `src/10-sync.js` `src/00-header.js` `package.json` `tools/check.js` `tools/test-dom.js` `tools/verify-cdp.mjs` `tools/fixtures/exam-mock-types.html`（新增）`README.md` `MAINTENANCE.md`


### v1.10.6（2026-11-17）附件页图 CORS 凭证修正

- **根因**：`pageToDataUrl()` 里 `fetch(url,{credentials:'include'})`。s3 回 `ACAO: *` 且无 `Allow-Credentials`，带凭证的跨域请求被浏览器判为 CORS 失败 → `Failed to fetch` → `enrich` 拿不到图 → `solve()` 抛"页图一张也没加载成功（共 2 张）"。同时刻 `curl` 同一 URL 返回 200/269623 字节，排除网络问题。
- **修法**：三级降级 —— ① `fetch(url,{mode:'cors'})`（不带凭证）② `fetch(url,{mode:'cors',credentials:'include'})` ③ `<img crossOrigin='anonymous'>` + canvas。
- 实测：修复前 `fetchErr:"Failed to fetch"`；修复后 `dLen` 正常返回 dataURL。

### v1.10.5（2026-11-17）简答/论述答案被拆半（editorList 空壳实例）

- **根因**：`editorList()` 收集 id 时把 `q.inputs` 里所有带 id 的元素都塞进去，包括 UEditor 的 `<iframe id="ueditor_0">`。`UE.getEditor('ueditor_0')` 会为一个不存在的容器造"空壳实例"（`setContent` 存在、`body` 是新建的空文档），空壳通过 `ed.body` 校验 → `eds.length=2` → `splitBlanks(text,2)` 按 `|||` 把整段答案拆成两半，`answerBlank` 只把前半段 `sync()` 回 `textarea`。真机现象：16 题整卷答案只落盘 8 行，`apply` 仍回报 `ok:true, filled:2`。
- **修法**：`q.inputs` 只接受 `TEXTAREA` / `INPUT`；`answer{qid}` 兜底改为"一个 textarea 都没抓到"时才用。
- 实测：修复前 `pageValue="1. C 2. B 3. C 4. B 5. D 6. 0.6 7. 0.7 8. 0.8"`；修复后 600+ 字全文落盘。

### v1.10.4（2026-11-17）浮球越界兜底 + 整卷预览触发条件放宽

- `07-ui.js`：新增 `clampBallPos(left, top)`；`setupBall()` 恢复 `uiPos` 时夹进视口并回写；新增 `window.resize` 监听重新夹+`placePanel`。根因：`uiPos` 持久化了旧窗口坐标（实测 `left=2006`、视口 1024 宽），`.panel` 是 `.wrap` 内 absolute，整块 UI 一起飞出屏幕。
- `08-main.js`：整卷预览触发条件从 `page.mode==='single'` 放宽到 `single || (totalCount > 当前可见 .questionLi 数)`，解决"nextBtn 取不到 → mode=whole → 十题卷子只渲染一题却从不切预览"。
- `01-core.js`：`DEFAULT_CONFIG.answer.preferPreview = true`（补上守则不变量：所有 `Cfg.get` 路径必须在 DEFAULT_CONFIG 里）。
- 实测：视口 1024×1153 下 `saved={left:982,top:1111}`，球 `rect.x=982` 回到视口内。

### v1.10.3（2026-11-17）修 CXAI.Attach 丢失（模板拼接陷阱）+ 页图内联

- **根因**：`03c-attach.js` 是唯一在模块 IIFE 里自建命名空间的模块（`const CXAI = (window.CXAI = window.CXAI || {})`），其它模块都直接用 `build.js` 外层 IIFE 的 `var CXAI`。`08-main` 末尾 `(unsafeWindow||window).CXAI = CXAI` 会覆盖 03c 造的那个临时对象 —— `CXAI.Attach` 恒为 `undefined`，`04-ai.solve()` 里 `if (CXAI.Attach && ...)` 静默跳过，附件题退化成"只有文件名"，模型只能回「题目正文缺失」。VM 打点实测：`before-03c=undefined / after-03c=object / final=undefined`；删掉该行后 `final=object`。
- **页图获取**：`GM_xmlhttpRequest` 带自定义 `Referer`，跨域触发 preflight，s3 无 `OPTIONS` → 图全丢。改为 `pageToDataUrl()`：页面 `fetch`（s3 允许跨域，实测 200）→ `createImageBitmap` + canvas → JPEG 0.85 / 长边 1400 dataURL，塞进 `question.images`；`03b.Vision.load()` 对 dataURL 是直通分支，零请求。
- **失败兜底**：dataURL 一张都没成时退回原始图 URL；仍失败则 `solve()` 抛可执行错误。
- **实测**：真实 magpie 网关（`127.0.0.1:3425`，`auto/qwen3.8-flash`）+ s3 两张页图 → 输出 5 选择 / 5 填空 / 4 计算证明题答案，`confidence 0.9`，37s。
- **守则补充**：新增 `src/NN-*.js` 模块不要自己创建 `window.CXAI`，直接用外层闭包的 `CXAI`。

### v1.10.2（2026-11-17）附件题缺视觉输入时硬失败（可执行提示）

- `04-ai.solve()`：`attachMeta.mode==='pages'` 且 `vctx.imageParts`/`vctx.vision` 都为空时抛错，文案里区分三种原因（`ai.vision.enabled=false`/`strategy=off`、页图全部加载失败、面板无视觉模型），并指向「设置 → 读图 → 读图模型」。
- 目的：附件题的题干只有页图，没有视觉输入时模型只能回"题目正文缺失"，这句话会被 `apply` 当答案写进 UEditor —— 宁可报错也不要写垃圾。
- 实测依据：只配纯文本模型时必现；PDF 文字层虽有中文，但数学公式全丢（`pdftotext` 实测），所以"抽文字给纯文本模型"不可作为替代方案。

### v1.10.1（2026-11-17）一键发布：GitHub + Cloudflare 一条命令

- 新增 `tools/release.js`：八步流水线（版本同步 → build → check → test-dom → build-site → 白名单 commit → push → wrangler deploy → 线上回读），任一步失败即中止。
- `package.json` 新增 `npm run release` / `npm run release:dry`。
- `CLAUDE.md`：正式发布流程改为「一条命令」，保留手动步骤作兜底；写明白名单与禁止项。
- `README.md`：开发章节补「一条命令发新版」。
- `MAINTENANCE.md`：新增「5d. 一键发布」流程表与 `tools/release.js` 文件说明。

### v1.10.0（2026-11-17）附件题（PDF 当题干）

- 新增 `src/03c-attach.js`：附件题干通道。`collect()` 产出 `attachments`，`enrich(question)` 把附件页图塞进 `question.images` 后交给 03b 读图。
- 页图规则：`s3.cldisk.com/sv-w9/doc/<md5(objectid)[13..15]>/<objectid>/thumb/N.png`，`HEAD` 探页数（404 页会返回 1200×675 占位图，不能用 `img.onload` 判存在）。
- `03-scraper`：`parseOne` 采集附件；题干清理后为空时用 `【附件材料】文件名` 兜底（否则被 `collect()` 过滤）；`TYPE_LABEL_BY_CODE` 按题型码显示正确中文名。
- `04-ai`：`solve()` 前 `Attach.enrich()`；prompt 增【附件材料】与整卷作答要求；`runSolveRound` 对长答案题型 `maxTokens=4000`。
- `01-core`：新增 `answer.attach`（默认 true）。
- 实测：期中考试 1 题（type=4）+ 2 页 PDF → `pageImageUrls` 返回 2 张页图，`enrich` 后 `images=2`、`mode=pages`、`src=screen`。

### v1.9.2（2026-11-17）整卷填空自动落盘 + 脚本内设置面板下线

- **BUGFIX（用户实测）**：整卷预览下填空题填完不点「保存」，内容会被页面清掉，超星还会拦住继续填下一题。
  `08-main.handleQuestion()` 的落盘条件改为：`apply.saveEach` 或（整卷 且 该题有输入框/填空类题型）→ 一定点保存。
  判断放宽到 `q.inputs` 非空，因为不同皮肤下 `type` 映射不可靠。
- **BUGFIX（隐藏很久）**：`05-apply.saveOne()` 的选择器命中的常是外层容器 `div.savebtndiv`，
  点容器不会触发内部 `<a onclick="saveQuestion(…)">` —— 表现就是"点了但没保存"。现在若命中容器，
  会往下找 `[onclick], a, button, input[type=button|submit]` 再点。
- **UI 精简**：删除脚本内整套设置面板（`07-ui.js` 1742 → 983 行，dist 402KB → 365KB）：
  删掉 `openConfig/closeConfig/saveConfig/exportConfig/importConfig/testProviders/renderProviders/readRow/readProviders/
  renderPickerList/ensurePicker/openModelPicker/wireProviderBox/applyPreset/refreshVisionSelect/syncVisionHint/showTab/showHelp`
  等 24 个函数与 `#mask` 模板块；顶栏 ⚙ → **⇅ 云同步**（`data-act="syncmask"`），新加 `openSync/closeSync` 与
  `#syncmask` 小窗（同步码输入 + 拉取 + 打开设置中心）。
- `08-main`：无模型时 `UI.openConfig()` → `UI.openSync()`；GM 菜单加「输入同步码（云同步）」。
- `07-ui` 的 `sync-pull`：同时支持 `#sync-code2`（小窗）与 `#sync-code`（提示条），取**非空**的那个
  （早先优先读小窗，用户粘在提示条里会被忽略）。
- E2E 扩到 **30 项**：新增 D 段（`tools/fixtures/exam-mock-whole.html` + 本地 mock 模型服务），
  真跑整卷两题，断言 `filled=2 / results=2 / saveCount=2`。mock 的 CORS 必须回显 Origin + allow-credentials
  （脚本请求走 `credentials:'include'`，`ACAO:*` 会被浏览器拒）。
- 测试基建：`verify-cdp.mjs` 启动时自校验 `.site/dist` 与 `dist/` 一致（否则自动 build-site），
  `inject()` 前清掉旧 host/CXAI（同一文档重复注入会变成两套 UI —— 测试环境特有）。

### v1.9.1（2026-11-17）云同步入口提到顶栏

- `topbar()`：删除 `data-act="sync-chaoxing"`（旧的 URL 搬运），改为 `#cs-sync-top` / `data-act="sync-top"`：
  未启用 → 文案「生成同步码并上传」，点击走 `syncNew()`；已启用 → 文案「上传到云端」，点击走 `syncNow()`。
- `syncBarHtml()`：模型页顶部常驻云同步状态条（未启用给引导，已启用显示同步码 + 复制 + 立即上传），
  **简单版也可见** —— 之前同步入口只在「备份」页，而简单版没有备份栏，用户找不到。
- `syncNew()` 成功后改走 `renderFrame()`（顶栏文案、状态条、备份页一起刷新）并**自动复制同步码**。
- 备份页删除「备用：离线搬运（同步到学习通）」整块；`cfgCodec` / `consumeConfigHash` 代码保留作离线兜底，但 UI 不再暴露。
- E2E：A9 改为点顶栏按钮（断言同步码合法 + 模型页状态条出现 + 按钮变为「上传到云端」）；C1 改为核对备份页显示同一串码。
- 验证：`check` 12 模块、`test-dom` 114/0、`e2e` 27/27。

### v1.9.0（2026-11-17）云同步：Pages Functions + KV（彻底解决跨子域）

- **根因**：超星考试页跨多个子域（`i.` / `mooc2-ans.` / `passport2.`），且未登录 302 到登录域会把 hash 丢掉；
  浏览器存储按 origin 隔离 → v1.8.7 的"URL 带配置码"只能落到打开的那个子域，考试页仍读不到。
- 新增 `functions/api/sync/[id].js`：Pages Function，`GET/PUT/DELETE /api/sync/<id>`，KV binding `CFG_KV`
  （id `82987ae0f84d4ee18b3062cf666ab14e`）。首次 PUT 绑定 `x-cxai-token`，之后校验；blob ≤ 24KB；TTL 90 天。
- 新增 `src/10-sync.js`（`CXAI.Sync`）：AES-GCM（key 16B）+ HMAC 写令牌；`newCode/syncNow/pull/pullInto/autoPull/disable`。
- 设置中心「备份」页：生成同步码并上传、立即上传、云端校验、停用；`persist()` 里 1.2s 防抖**自动上传**。
- 考试页面板：`#setupbar` 加同步码输入 + 「拉取」；`08-main` 在无配置时 `autoPull()`（静默、不覆盖已有配置）。
- 工具链：`tools/shim.js` / `tools/cdp.js` 的 GM 垫片支持 `anonymous`（跨域 + `ACAO:*` 必须 omit），
  且 GET/HEAD 不再塞 body。
- E2E（`npm run e2e`）扩到 **27 项**：C1 生成同步码 / C2 KV 有密文 / C3 考试页粘码拉取 / C4 刷新仍在 /
  C5 新子域自动拉取 / C6 设置页改动自动上传后新子域拿到新值 / C7 HMAC 令牌被服务端接受并删除。
  验证：`check` 12 模块、`test-dom` 114/0、`e2e` **27/27 全绿**。

### v1.8.7（2026-11-17）修跨域读不到配置 + 考试页不再自动弹窗

- **新增 `tools/verify-cdp.mjs` 与 `tools/fixtures/exam-mock.html`**：真实浏览器端到端验证（CDP）。
  用 8790 / 8791 两个端口当两个 origin，真实复现"设置中心配好、考试页读不到"，
  再验证配置码通道打通；20 项断言全绿。`npm run e2e` 可一键回归。

- **根因**：v1.8.0 起假设「GM 存储同一脚本跨域名共享」，实际 TM / VM 的存储作用域是「脚本 + 站点」。
  设置中心写在 pages.dev 的配置，chaoxing.com 读不到，`08-main` 于是弹出「当前域名还没有配置」。
- 新增 `CXAI.cfgCodec.{encode,decode}`（`btoa(unescape(encodeURIComponent(JSON)))` 处理中文）作为跨域配置码。
- `08-main.consumeConfigHash()`：在 `ready()` 最开始（**gate 之前**，任何 `@match` 页面）解析 `#cxai_cfg=`，
  `Cfg.importJSON` 落库到本域并 `history.replaceState` 清 hash。
- 设置中心「备份」页新增「同步到学习通 →」（`syncToChaoxing()`，打开 `i.chaoxing.com/base#cxai_cfg=…`）
  与「复制配置码」（`copyConfigCode()`）。
- **行为变更**：本域无配置时不再 `CXAI.UI.openConfig()`（用户明确要求不自动弹窗）；
  改为 `CXAI.UI.update({needSetup:true})` → 悬浮球 `::before` 橙点 + 面板 `#setupbar` 提示条 + 「设置中心」按钮。
  `Engine.start()` 里"点开始答题但没模型"仍会打开面板，那是用户主动操作。
- 文案修正：设置页胶囊改「油猴存储 · 本域」、诊断页与面板存储信息去掉"所有域名共享"。
- 验证：`check` 11 模块；`test-dom` 114/0；无头 Chrome 实测
  `无 hash → providers=0`、`带配置码 → providers=1(label=基元律动) / bytes=579 / hash 已清空`。

### v1.8.6（2026-11-17）自定义模型默认 OpenAI 协议

- `custom` 预设的 `hint` 写清默认协议：`POST {base}/chat/completions` + `Authorization: Bearer`。
- `applyPresetTo()` 里协议改为**无条件套用** `pre.apiStyle || 'openai'`，并对 `custom` 再兜底一次 `openai`
  —— 避免从 Anthropic/Gemini 端点切到自定义模型时把旧协议带过去。
- `wizardCommitProvider()`：`custom` 一律写 `apiStyle: 'openai'`。
- 向导 custom 分支与高级设置「接口协议」下拉的说明文字都标注了默认 OpenAI。
- **BUGFIX（交互死角）**：向导渲染优先级高于设置页，导致在引导里点右上角「高级设置」毫无反应。
  `toggle-advanced` 现在会先结束引导（`S.wzActive=false` + `ui.onboarded=true`）再重渲染。
- 验证：`check` 11 模块；`test-dom` 114/0；无头探针 `count=1 / apiStyle=openai / preset=custom / advSel=openai`
  （高级设置里协议下拉确实停在 OpenAI）。

### v1.8.5（2026-11-17）引导页可连续添加多个模型

- **问题**：向导第 1 步只能加一个模型（点「下一步」直接进第 2 步），而判题议会本来就需要多个模型各自作答再投票。
- 第 1 步改为「已添加列表 + 继续添加」结构：
  - `wizardStep1()` 顶部渲染已添加的 provider（label / model / Base URL / 删除），`data-act="wz-del"`
  - 「+ 添加这个模型」`data-act="wz-add"` → `wizardCommitProvider()` 落库后**清空表单并留在第 1 步**，可继续选下一家
  - 「下一步」在 `providers.length >= 1` 时可用；若表单里还填着未提交的预设，会先替用户提交再切步
  - 第 3 步的读图下拉自然列出全部已添加模型
- 新增样式 `.cs-added / .cs-added-row / .cs-sub`。
- 验证：`check` 11 模块；`test-dom` 114/0；无头探针
  `cards=9 / after1=1 / formReset=true / after2=2 / afterDel=1 / step2=true / step3opts=1`（删到 1 个时下拉 1 项，正确）。

### v1.8.4（2026-11-17）引导页补上「自定义模型」

- **BUGFIX**：`QUICK` 预设清单（`emptyState()` 与 `wizardStep1()` 共用）只列了 8 家有 `baseURL` 的预设，
  把 `custom` 漏掉了 —— 用户在引导页看不到「自定义模型」。现已改为 9 个，与实际预设一致。
- 选「自定义模型」时，第 1 步把 **Base URL 作为必填字段直接露出来**（其余预设仍折叠在「地址不对？」里），
  并提示"只吃 Anthropic 协议的走完引导后在高级设置里切接口协议"。
- 切换预设时清空上一次的拉取结果（`w.list = null`），避免残留别的端点的模型清单。
- 验证：`check` 11 模块；`test-dom` 114/0；无头探针 `cards=9 / customCard=true / baseVisible=true /
  baseEmpty=true / fetchBtn=true / 空 Base URL 点下一步被拦住 / 填完后进入第 2 步`。

### v1.8.3（2026-11-17）预设换血：基元律动上线、magpie/Kimi 下线、模型名一律留空

- `CXAI.PRESETS` 重写为 9 条：`deepseek / tokenrhythm（基元律动，https://tokenrhythm.studio/v1）/ qwen-vl / qwen / glm / openai / ollama / lmstudio / custom（自定义模型）`。
  删除 `magpie` 与 `kimi`；**所有预设 `model` 置空**（以拉取到的清单为准）。
- `presetOf()`（09）与 `guessPreset()`（07）都不再按 host 硬编码猜、也不再兜底到 `magpie`：
  先按 `PRESETS[].baseURL` 精确反查，再认存的 `preset` 字段**但必须是当前仍存在的预设**，否则算 `custom`。
  这样老配置里 `preset:'magpie'` 不会渲染出空下拉。
- 拉取逻辑：`fetchModels()` 在 `model` 为空时自动采用清单第一项；向导新增 `wizardFetch()` + `data-act="wz-fetch"` +
  `wz-pick-model` 下拉，第 1 步就能拉清单选模型；「下一步」的校验提示改为"点「拉取」选一个，或手填"。
- 空态/向导预设卡的模型名位置显示「（填 Key 后拉取选模型）」，不再留空。
- `tools/test-dom.js` 断言同步：9 条预设、含 tokenrhythm、不含 magpie/kimi、所有预设 `model` 为空。
- 验证：`check` 11 模块；`test-dom` **114 通过 / 0 失败**（新增 3 条断言）。

### v1.8.2（2026-11-17）设置中心：简单 / 高级两档 + 首次三步向导

- **简单版（默认）**：`SIMPLE_TABS = ['model','judge','vision']`，`nav()` 只渲染这三栏；
  `providerCard()` 的 `adv` 分支去掉权重 / 温度 / maxTokens / 接口协议 / 允许空 Key；
  `paneJudge()` 只留「判定强度」四档；`paneVision()` 只留开关 / 策略 / 读图模型 / 兼任判题。
- **高级开关**：`ui.advanced`（默认 false），顶栏 `data-act="toggle-advanced"`，切换后 `renderFrame()` 重建导航与右栏。
- **首次向导**：`S.wzActive` + `S.wz`（step / pick / key / model / base / judge / visionOn / visionId / strategy），
  `wizardHtml()` → `wizardStep1/2/3`；第 1 步 `wizardCommitProvider()` 落库，第 3 步 `wizardDone()` 一次写入
  判题强度（`STRENGTH_MAP`）与读图设置并置 `ui.onboarded = true`。
  **坑：向导模式必须用 `S.wzActive` 判断，不能用 `providers.length === 0`** —— 第 1 步一提交模型就变非空，
  第 2/3 步会被直接跳过（本版实测踩到并修掉）。
- **`ensureVisionModel()`**：读图模型必须落地成具体 id；空 / 指向已删模型时落到第一个启用模型，
  单模型时自动 `judgeToo = true`（否则判题面板为空）。
- **读图下拉去掉「自动挑」**（`visionModelOptions()`）：脚本无法判断某家模型是否支持视觉，改由用户指定。
- `01-core`：`vision.maxImages` 默认 6；`ui.advanced` / `ui.onboarded` 新增。
- `03b-vision`：`maxImages` clamp 从 1..8 放宽到 1..20。
- `README`：补「简单版与高级版」「第一次打开：三步向导」两节。
- 验证：`check` 11 模块；`test-dom` 111/0；无头 Chrome 探针跑完三步向导（wizard1/2/3 全 true、visionOpts=1），
  简单版 navItems=3 且无权重/温度字段，高级版 advNavItems=6 且有，读图下拉 `visionAutoOpt=false`。

### v1.8.1（2026-11-16）修首页误判 / 默认模型 / 头部排版

- **BUGFIX（严重）**：`09-settings.isHere()` 里的 Pages 兜底判断 `^\/(settings)?(\.html)?$` 把根路径 `/` 也命中，
  于是打开 `cx-exam-ai.pages.dev` 首页就被整页接管；设置页上「安装页」链接指回 `/`，形成回不去的死循环。
  现在只认 `^\/settings(\.html)?$`。**改这段判断时任何"顺手放宽"的写法都要先在首页验证一遍。**
- **默认不预置模型**：`DEFAULT_CONFIG.ai.providers` 改为 `[]`。原来内置 3 个空 Key 模板，用户会误以为已配好；
  现在首次进设置页是空态 + 九个预设一键添加（`addPresetProvider()`，`data-act="pv-add-preset"`），
  非空时按钮行也多一个「+ 从预设添加…」下拉。`08-main` 原有"当前域名还没配置"的提示因此才真正会被触发。
- **预设补全**：`CXAI.PRESETS` 实际只有 `deepseek` / `custom` / `magpie` 三条，文档声称 10 条属虚报。
  已补 `qwen-vl` / `qwen` / `glm` / `kimi` / `openai` / `ollama` / `lmstudio`（本地网关两条带 `keyOptional`）。
- **头部排版**：状态胶囊文案缩短（`油猴存储 · 跨域共享` / `仅本域存储` / `内存 · 未持久化`）并加 `white-space:nowrap`、
  `.cs-top` 改 `flex-wrap:wrap`，窄窗口不再挤成两行。
- `README.md` 徽章版本号同步 1.8.1（shields.io 徽章是硬编码，改版本时必须手动改，否则仓库首页一直显示旧版本）。
- 验证：`check` 11 模块通过（PRESETS 10 条）；`test-dom` 111/0；无头 Chrome 实测首页不再被接管、`/settings` 空态出 9 张预设卡、
  头部胶囊单行。

### v1.8.0（2026-11-16）独立设置中心（网页版配置页）

- 新增 `src/09-settings.js`（`CXAI.Settings`，~1270 行）：整页接管 `/settings.html`，六栏配置
  （模型 / 判题 / 读图 / 运行 / 备份 / 诊断），改动 280ms 防抖后写 `CXAI.Cfg`。模型卡支持预设联动、
  `AI.listModels` 拉取、`AI.ping` 单卡测试、权重/温度/输出上限、上移下移删除；读图栏改动通过
  `syncVisionRoles()` 同步所有 provider 的 `role`，避免"下拉变了但挑模型的逻辑没变"。
- 新增 `settings.html`：深色静态骨架 + 未接管时的排查指引；用 `<html data-cxai-settings>` 做页面识别，
  不把域名硬编码进 `isHere()` 的主要判断。
- `src/00-header.js`：`@match` 增加 `cx-exam-ai.pages.dev` / `wzj1122.github.io/cx-exam-ai` / `127.0.0.1`；版本 1.8.0。
- `src/08-main.js`：`ready()` 最前面加设置页分支（整页接管、不跑考试逻辑）；GM 菜单加「打开设置中心（配置模型）」。
- `src/07-ui.js`：设置面板底部加「独立设置页 ↗」（`settingsURL()` 读 `ui.settingsURL`，默认 `https://cx-exam-ai.pages.dev/settings`）。
- `src/01-core.js`：`DEFAULT_CONFIG.ui` 新增 `settingsURL`（空 = 用内置官方地址）。
- **BUGFIX（真 bug）**：`apply.submit`（面板写）与 `apply.autoSubmit`（`08-main`/`06-guard` 读）字段不一致，
  面板里的「自动交卷」开关一直不生效。现在 `saveConfig` 与设置中心双写，`08-main.maybeSubmit()` /
  `06-guard` 的 confirm 判断双认。
- `tools/check.js` 契约加 `09-settings.js`；`tools/build-site.js` 发布 `settings.html`；
  `index.html` 加「独立设置中心」入口卡片。
- 验证：`node tools/check.js` 11 模块通过；`node tools/test-dom.js` 111 通过 / 0 失败；
  无头 Chrome 实测整页渲染、六栏切换、添加模型（3→4）、全部收起、导出 JSON（3948 字符含 `providers`）、
  诊断输出（1349 字符含版本）、`?tab=` 深链。

### v1.7.1（2026-11-16）Greasy Fork 上线 + Webhook 自动同步

- **Greasy Fork 建档完成**：脚本 ID **`605687`**，标题 `CX 考试 AI 大脑 · 学习通考试自动答题`，导入源 `https://raw.githubusercontent.com/wzj1122/cx-exam-ai/main/dist/cx-exam-ai.user.js`。服务器已回源到 1.7.0 版本内容（`update.greasyfork.org` 返回 200 `text/javascript`）。
- **头部补 `@updateURL` / `@downloadURL`**（占位风险解除）：两者都指向 Greasy Fork 自动更新地址
  `https://update.greasyfork.org/scripts/605687/CX%20%E8%80%83%E8%AF%95%20AI%20%E5%A4%A7%E8%84%91%20%C2%B7%20%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%80%83%E8%AF%95%E8%87%AA%E5%8A%A8%E7%AD%94%E9%A2%98.user.js`
  （该地址的文件名段只是展示用，`.../605687/任意名.user.js` 都 200，但**别改数字 ID**）。
- **Webhook 建好**：GitHub `POST /repos/wzj1122/cx-exam-ai/hooks` → hook id `712319329`，`events=["push"]`、`content_type=json`、`insecure_ssl=0`、secret 为 Greasy Fork 生成的那串（存在 GitHub 仓库设置里，不在本仓库）。以后 push 到 `main` 即触发 Greasy Fork 同步，无需手动上传。
- 版本 1.7.0 → **1.7.1**（`00-header.js` + `package.json` 双写）。Greasy Fork 只接受更高版本号的更新，所以回填链接必须伴随版本递增。
- `README.md`：badge 版本、Greasy Fork 安装链接（改成 `update.greasyfork.org` 直链）、脚本主页、更新日志全部同步。`index.html`：第三张卡片从“审核中”占位改回真实链接。

### v1.7.0（2026-11-16）Cloudflare Pages 上线（workers.dev 在国内不可达）

- **实测结论**：`cx-exam-ai.18293592881.workers.dev` 在国内解析到 `157.240.10.32`（Facebook 段）、`2a03:2880:...:face:b00c` —— DNS 污染，`curl` 12 s 超时（http 000）；对照组 `jxufe-auto-evaluate.pages.dev` 200。**所以对外链接一律走 `pages.dev`，不要写 `workers.dev`。**
- **Pages 项目已建**：`cx-exam-ai`（`wrangler pages project create cx-exam-ai --production-branch=main`，OAuth 方式 `wrangler login` 授权），首次直接上传发布 4 个文件。
- **线上校验**：`/` 200 `text/html` 7511 B；`/dist/cx-exam-ai.user.js` 200 `application/javascript` 290189 B（`@version 1.7.0`）；`/images/*.png` 200 `image/png`。
- **`wrangler.jsonc` 改为 Pages 配置**：去掉 `assets.directory`（Workers 静态资源写法），改 `pages_build_output_dir: "./.site"`。两套字段并存时 `wrangler deploy` 会报 "It seems that you have run `wrangler deploy` on a Pages project" 并要求确认，ov 容易半步走错；现在只有一种写法。
- **发布命令**：`npm run site && npx wrangler pages deploy --project-name=cx-exam-ai --branch=main`（`--commit-dirty=true` 可忽略脏工作区）。控制台若后续接入 Git，构建命令填 `npm run site`、输出目录填 `.site`。
- 遗留：GitHub 上那个 Workers 项目（`workers.dev`）已无用途，建议在控制台删掉，否则每次 push 都会跑一次 `wrangler deploy` 且随配置改动可能失败。

### v1.7.0（2026-11-16）补 Cloudflare Workers 部署配置

- 新增 `wrangler.jsonc`（`name=cx-exam-ai`、`compatibility_date=2026-11-16`）与 `tools/build-site.js`，发布目录定为 `.site/`：先 `node tools/build-site.js` 生成只含 `index.html` + `dist/` + `images/` 的 4 个文件，再 `npx wrangler deploy`。
- 动机：Cloudflare 新版控制台"创建应用"默认给的是 **Workers** 流程（构建命令/部署命令/预览命令三栏），没有构建输出目录的概念；要么退回 Pages 流程（`pages.dev` 域名），要么给它一份 `wrangler.jsonc` 走 Workers 静态资源（`<name>.<account>.workers.dev` 域名）。两条路现在都能用。
- 坑一：`assets.directory` 一度设成 `"./"`，`wrangler deploy --dry-run` 直接“Read 4631 files”，把 `.cdp-profile/`、`.chrome-profile/`、`logs/` 全算进站点——浏览器 profile 里是登录态 Cookie，等于公开泄露。改 `".site"` 后降到 6 个文件。
- 坑二：`assets.ignore` 在 wrangler 4.162 报 `Unexpected fields found in assets field: "ignore"`，配置被忽略且不报错——不要把安全边界押在这个字段上，只能靠“发布目录本身就干净”。
- 注意：Workers 通道下域名不是 `*.pages.dev`，README/index.html 里若改用 Workers，需要把 `cx-exam-ai.pages.dev` 换成实际 `workers.dev` 地址。

### v1.7.0（2026-11-16）首个公开发布版：仓库化 + 三处一键安装

把本地脚本整理成可公开发布的仓库（`wzj1122/cx-exam-ai`），发布结构对照本人另一个脚本仓库 `wzj1122/jxufe-auto-evaluate`。

- **`src/00-header.js`**：`@namespace` 改 `https://github.com/wzj1122/cx-exam-ai`，`@author` 改 `wzj1122`，新增 `@homepageURL` / `@supportURL`，`@version` 1.6.4 → 1.7.0。`@match` / `@grant` / `@connect` / `@run-at` 未动（改成域名会丢整卷与章节两套结构）。
- **新增 `index.html`**：Cloudflare Pages 落地页。三张安装卡片（本站 `/dist/cx-exam-ai.user.js`、GitHub raw、Greasy Fork）+ 前置提示（开发者模式、允许运行用户脚本）+ 四件事 + 三步上手 + 收款码。纯内联 CSS，深色渐变，无 CDN 依赖（Pages 国内可直连）。
- **新增 `CLAUDE.md`**：仓库规则表 + 发布流程（版本双写 → `node build.js` → `check`/`test` → 文档同步 → push）+ 禁止操作。
- **新增 `LICENSE`（MIT）/ `.gitignore` / `images/`**。`.gitignore` 明确排除 `logs/`、`.watch.log`、`.watch.out`、`.chrome.log`、`.shot-*.png`、`.cdp-profile/`、`.chrome-profile/`、`.tmp-ocsjs/` —— 浏览器 profile 含登录态 Cookie，**禁止 `git add -f` 绕过**。
- **`README.md` 重写**：补一键安装表（Cloudflare / GitHub / Greasy Fork）、前置要求（`chrome://extensions/` 开发者模式 + 「允许运行用户脚本」）、项目主页、开发命令、更新日志；技术章节（判定模式/读图/自定义模型/安全边界）内容保留。断言数按实测更正为 111 项。
- **`package.json`**：版本 1.7.0，补 `keywords` / `author` / `homepage` / `repository` / `bugs`。
- **构建**：`dist/cx-exam-ai.user.js` 283.4 KB / 7133 行；`tools/check.js` 10 模块契约通过；`tools/test-dom.js` 111 通过 / 0 失败（AI 请求 13 次）。
- **发布三通道**（前两项在本仓库完成，后两项需在网页控制台手动开通）：GitHub raw；Cloudflare Pages（项目名 `cx-exam-ai`，根目录 `.`，无构建命令，产物即静态文件）；Greasy Fork（首次手动建脚本，之后从 `main` 分支同步）。Greasy Fork 建档后拿到 `SCRIPT_ID`，需回填四处：`src/00-header.js` 新增 `@updateURL`/`@downloadURL`（这两行**先不写**——占位 ID 会让油猴每次启动去拉一个 404 更新地址）、`README.md` 两张表、`index.html` 两处链接；回填后 `node build.js` 重建并升 patch 版本，否则已装用户收不到更新。
- **注意**：Greasy Fork 审核可能因"考试类"标签要求补充说明，码表里不要写学校名与考试科目。

### v1.6.4（2026-11-16）小球手势：长按左滑=答一题模式，长按上滑=自动连答模式

用户想要不打开面板就能切模式：长按小球左滑 → 之后点一下答一题；长按上滑 → 之后点一下跑完整卷。

#### 手势表

| 操作 | 行为 |
|---|---|
| 单击（短按不移动） | 按**当前模式**执行：`答一题` 模式 → `Engine.answerNext()`；`自动连答` 模式 → `Engine.start()`（已在跑则暂停/继续） |
| 双击（260ms 内两下） | 开 / 合面板 |
| **长按 >420ms** | 球上方弹出两个提示：`← 左滑：答一题`、`↑ 上滑：自动连答` |
| 长按后**左滑**（≥26px 且横向位移大于纵向） | 切到「答一题」模式，松手生效，弹 toast「模式：答一题（点一下答一道）」 |
| 长按后**上滑**（≥26px 且纵向位移大于横向） | 切到「自动连答」模式，toast「模式：自动连答（点一下跑完整卷）」 |
| 长按但没选方向 | 松手取消，toast「已取消（没选方向）」 |
| 直接拖动（没触发长按） | 摆位置（位置记忆 `uiPos`，长按一旦触发就不再拖动，避免两种意图打架） |

- 模式持久化：`Store.set('ballMode', 'single'|'auto')`，下次进页面沿用；面板页脚状态里会写当前模式（`待机 · exam-preview · 答一题`）。
- 手势提示层 `.gmode` 与 toast `.gtoast` 都挂在 `.wrap` 里、球的正上方，只在长按时出现，平时完全不可见。

#### 真机验证（CDP 合成 PointerEvent）

| 步骤 | 结果 |
|---|---|
| 初始模式 | `single` |
| pointerdown 后等 520ms | `#gmode` 显示为 `show` |
| 左移 40px | 高亮 `data-dir=left` |
| 松手 | `state.mode = 'single'`，提示层收起 |
| 长按 + 上移 45px + 松手 | `state.mode = 'auto'` |
| 短按一下（auto 模式） | `Engine.st.running = true`（开始连答），随后 `stop()` 收掉 |
| 持久化 | `Store('ballMode') = 'auto'` |

离线测试 111 通过 / 0 失败；产物 283.3 KB / 7131 行。

### v1.6.3（2026-11-16）头部恢复干净：删掉预取/日志图标，功能换位置保留

用户反映上一版面板右上角多了「⤓ 预取」「☰ 日志」两个图标，位置难看。

判断：两个功能都有用，但都不该占头部 ——
- **预取**：进考试页已默认后台自动预取，手动触发是低频操作 → 挪进 `设置 → 运行` 页，做成一个整行按钮「立即预取当前页答案」。
- **日志**：调试时才看 → 挪进**面板页脚**，和状态文字并排，`日志` 两个字点一下展开/收起，默认收起。

结果：

| 位置 | 现在只有 |
|---|---|
| 头部 | `⚙ 设置`、`✕ 收起` 两个按钮 |
| 按钮栏 | `答一题` / `自动连答` / `暂停` / `停止` |
| 页脚 | `Ctrl+Shift+X 呼出/隐藏` · `日志`(可点) · 状态 |

真机校验：`header = [cfg, hide]`；页脚存在 `.lg-toggle` 文本「日志」；按钮栏四个按钮；设置「运行」页 `[data-act="prefetch"]` = 「立即预取当前页答案」，同页字段 `cfg-dmin/dmax/dlg/logmax/guard/force/save/submit` 一个不少。

离线测试 111 通过 / 0 失败；产物 279.5 KB / 7021 行。

### v1.6.2（2026-11-16）点一下答一题 · 后台预取答案 · 两种答题模式并存

用户新需求：小球单击不要"一口气答完整卷"，改成**点一次答一题**；同时希望**答案提前缓存**，点时直接落盘。

#### 1. `Engine.answerNext()`：点一下走一步

- 整卷/预览页：找**当前页第一道还没答案的题**，落盘后把这题滚进视野，停在那儿等你再点。
- 单题页：答完当前题再翻到下一题（`softNext` 优先，失败退回原生"下一题"；富文本页直接整页跳），不自动连答。
- 有缓存就直接用（`stemResult` → `cachedAnswer(qid)` → 会话缓存），没有才现场判一次。
- 整页都答完时不再乱点：返回 `{reason:'all-answered'}`，球面显示 `OK`。
- 自动连答在跑时不抢活：提示"先停止再用单题作答"。

#### 2. `Engine.prefetch()`：后台先把答案判好

- 进考试页后（`engine.prefetch` 默认开、延迟 `prefetchDelayMs=2000`）自动开跑：把每道"还没答案"的题判一遍，结果按 `qid` 写进 `answers` 存储 + 会话缓存，**只写数据不动页面**。
- 并发 `engine.prefetchConcurrency=2`，日志按 `预取 3/10 · #4 题干 → B` 打点；点小球时命中缓存就是"读缓存 + 落盘"，几乎不用等模型。
- 面板头部新增 ⤓ 图标可手动触发预取。

#### 3. 入口重新分工

| 位置 | 现在的作用 |
|---|---|
| 小球**单击** | 答下一题（运行中则暂停/继续） |
| 小球**双击** | 开/合面板 |
| 面板 `答一题`（主按钮） | 同上，点一次走一步 |
| 面板 `自动连答` | 原来的整卷自动跑 |
| 面板 `暂停 / 停止` | 只作用于自动连答 |
| 头部 `⤓ / ☰ / ⚙ / ✕` | 预取 / 日志 / 设置 / 收起 |

#### 验证（真机 CDP）

| 项 | 结果 |
|---|---|
| 头部图标 | `prefetch / logs / cfg / hide` 四个都在 |
| 按钮栏 | `答一题:next / 自动连答:run / 暂停:pause / 停止:stop` |
| 已答完的卷子点「答一题」 | `{ok:true, reason:'all-answered'}`，球面 `OK`，不重复点选项 |
| 预取 | 队列为空时不启动（`prefetching:false`） |
| 离线测试 | 111 通过 / 0 失败；10 模块通过；279.0 KB / 7016 行 |

**未实测**：还没有一份"未作答的新卷"来跑完整链路（当前两套卷子都已答完/已交卷）——"预取 → 逐题点球落盘"的完整流程要等你开一份新卷验证。

### v1.6.0 ~ v1.6.1（2026-11-16）小球变成唯一入口 · 交接续跑修好 · 混合图文题实测

用户四条：①打开考试页默认只显示右下角小球，不要弹整个面板；②点「开始答题」切到整卷预览后又停了；③单击小球直接开始答题、双击才开面板，球上显示淡绿进度、结束时显示 OK；④小球要**更不明显**（连绿色也别太深）。

#### 1. 默认只显示小球

去掉 `mount()` 里"上次开着就恢复"的 `uiOpen` 逻辑（`Store.set('uiOpen')` 仍保留，只是不再自动展开）。现在进考试页只出现那颗小圆点，点开才看面板。

#### 2. 切整卷预览后不自动开始（真根因）

`saveSession(running)` 内部是 `running !== false && st.running`。上一版在 handoff 分支里**先把 `st.running = false` 再 `saveSession(true)`**，取与之后写进去的还是 `false`，新页面 autoResume 永远不触发。

- 改成先 `saveSession(true)`（此时 `st.running` 还是 true），再放下内存状态。
- 另外 `start()` 里加了一道"等题块渲染"：整卷预览刚切过去时 `.questionLi` 可能还没出来，最多等 12 秒再判"没有题目"，避免一上来就空跑收工。

#### 3. 小球 = 主入口

- **单击**：未运行 → `Engine.start()`；正在跑 → `togglePause()`。
- **双击**：开/合整个面板。
- 用 260ms 定时器区分：单击先挂起，期间来第二次点击就取消单击、改执行开合。
- 球面文字直接变成进度：空闲 `CX` → 运行中显示已答数（如 `3`）→ 全部跑完显示 **`OK`**。颜色：运行中浅绿 `rgba(220,252,231,.46)`、完成 `rgba(220,252,231,.62)`，都只到"看得出是绿的"的程度。

#### 4. 小球可见度下调

| 状态 | 之前 | 现在 |
|---|---|---|
| 空闲 | `opacity .62`、`#f1f5f9` 底 | **`opacity .26`**、`rgba(248,250,252,.5)` 底、描边 `rgba(203,213,225,.4)`、字色 `#9aa3b2` |
| 运行中 | `#dcfce7` 实底、`opacity .95` | `rgba(220,252,231,.46)`、`opacity .42`、字色 `#62a987` |
| 完成 | `#bbf7d0` 实底、`opacity 1` | `rgba(220,252,231,.62)`、`opacity .5`、字色 `#4f9e72` |
| 悬停 | 全白实底 | `rgba(255,255,255,.95)`、`opacity .9`（要能看清才点得到） |

#### 5. 混合图文题（文字 + 图片）实测

真机上拿一道"题干有文字、图里还有信息"的题喂 `AI.solve()`：

```
vision: { mode:'ocr', images:1, sent:0, dropped:0, ocrChars:139, ocrBy:'auto/qwen3.8-flash' }
answer: B   confidence: 0.4   stage: panel   耗时 62s
```

结论：文字题干与图片**同时**进入判题 —— 图片先由读图模型转写成 139 字文本再并进 prompt（`ocrChars`），文字部分原样保留。纯图片题（题干空、选项只有 A/B/C/D）此前也已实测能答（两题分别得出 B / C）。读完图后置信度低会照常标黄，提醒人工复核。

#### 验证

| 项 | 结果 |
|---|---|
| 默认面板 | `panel.show = false`（只显示小球） |
| 单击小球 | `Engine.st.running = true`，球面变 `0` 并浅绿 |
| 双击小球 | `panel.show = true` |
| 跑完 | 球面 `OK`、class `ball done` |
| 球 opacity | 空闲 **0.26**（截图确认几乎只剩一个圈） |
| 混合图文题 | `ocrChars=139`、答案 B、62s |
| 离线测试 | 111 通过 / 0 失败；10 模块通过；272.4 KB / 6857 行 |

### v1.5.9（2026-11-16）面板头部：删掉没用的问号，设置/关闭放大

- 去掉 `<div class="x" data-act="help">?</div>`：它只是把用法写进日志区，而日志区现在默认折叠，点了等于没反应。`showHelp()` 函数与 `case 'help'` 保留（无入口，不再被触发），不影响任何流程。
- 设置 ⚙ 与关闭 ✕ 从 `font-size:12px / padding:0 4px` 放大到 **17px / 5px 9px**，加 `border-radius:7px`；
  - ⚙ 悬停：蓝字 + `#eef4ff` 底
  - ✕ 悬停：红字 + `#fdeeee` 底（和"关闭"语义一致）
  - 两个按钮都加了 `title`（设置 / 收起面板）
- 真机校验（CDP 取 computedStyle）：头部只剩两个按钮，`font-size:17px`、`padding:5px 9px`，`data-act` 分别为 `cfg` / `hide`。
- 离线测试 111 通过 / 0 失败；产物 270.4 KB / 6810 行。

### v1.5.8（2026-11-16）"有时点得开展不开"：事件目标不是带 data-act 的那个节点

用户反馈：模型卡行头有时点一下能展开，有时点不动。

根因：面板用的是 `root` 上的**事件委托**，而处理函数直接读 `e.target.getAttribute('data-act')`。`data-act` 挂在 `.ph`（整行）上，行里的模型名 `.nm`、预设胶囊 `.chipx`、状态点 `.dot` 都是子节点 —— 点在空白处命中 `.ph` 能开，点在文字上命中的是 `.nm`，读不到 `data-act` 就直接 `return`，于是"有时灵有时不灵"。

- 改成往上找最近的 `[data-act]` 祖先：`const actEl = e.target.closest('[data-act]')`，取不到再退回自身属性。
- 同一处隐患一起修：左侧导航点**图标**（`.ic`）不切页签；题号格子/「跳到该题」点在子节点上取不到题号 —— 现在 `pick` / `go` 都优先用 `actEl` 的 `data-i`。
- 折叠卡切换时明确排除 `input / label / select / button / .del / [data-del] / [data-fetch] / [data-pick]`，点「启用」勾选框只切启用，不会顺带把卡片折叠。

真机验证（CDP 直接点 DOM）：

| 操作 | 结果 |
|---|---|
| 点模型名 `.nm` | `data-open` 0 → 1（之前不响应） |
| 再点一次 | 1 → 0 |
| 点行头空白 | 0 → 1 |
| 点「启用」勾选框 | 卡片 `data-open` 不变，只切启用 |
| 点左侧导航图标 `.ic` | 正确切到 `judge` 页签（之前不响应） |

离线测试 111 通过 / 0 失败；产物 270.2 KB / 6809 行。

### v1.5.6 ~ v1.5.7（2026-11-16）设置窗重做：左侧导航 + 折叠模型卡 + 全白主题

用户连着三条反馈：①标签页放顶部还是很乱、模型 1/2/3 连在一起不好看，想要横版或可点开可收起的卡；②模型行右侧「启用 / 删除」跟别的元素不在一条线上，还有个三角形不知道干什么用；③整个 UI 改成白色。

#### 1. 设置窗改成"左侧竖排导航 + 右侧内容"

- 对话框 660px → **820px**；`.dbody` 左侧 `.dnav`（124px，模型/判题/运行/备份，带图标，选中项浅蓝底 + 左侧 3px 蓝条），右侧 `.db` 内容区独立滚动。
- 页签状态存 `state.cfgTab`，关掉再打开还是上次那页；`showTab(name)` 统一控制 `.ntab.on` / `.pane.show`。

#### 2. 模型列表改成可折叠卡

- 每张卡通栏：`● 模型 N  <模型名>  [预设]  ☑启用  删除`，**38px 高、单行、垂直居中对齐**；点击卡片头展开/收起（`data-open`），首张默认展开。
- 顶部加「全部展开 / 全部收起」，底部「+ 添加模型」变成虚线整行按钮。
- **删掉了删除按钮后面那个三角形**（用户明确问"干什么用的，删了"）：展开状态改用卡片边框变蓝 + 浅阴影表达，卡片头加 `title="点击展开 / 收起这张卡"`。
- 顺带修了行头错位的真凶：`.fld label` 是 `display:block; margin-bottom:3px`，卡片头里的「启用」继承了它 → 单独加 `.pv .ph label.chk { display:inline-flex; margin:0; padding:0; line-height:1 }` 和 `input[type=checkbox]{13px; accent-color:#2563eb}`。

#### 3. 全白主题

- 整套 CSS 重写为浅色：面板 `#fff` + `#e5e8ee` 描边 + 轻阴影；头部/页脚 `#f7f8fb`；数字蓝 `#2563eb`；按钮白底描边、主按钮蓝紫渐变。
- 状态色改成浅底深字：已答 `#eaf8ef/#15803d`、已答·原有 `#fdf6e3/#a16207`、失败 `#fdeeee/#b91c1c`、作答中 `#fef7e6/#b45309`、未答 `#f4f5f7/#6b7280`。
- 选项行：AI 选中项浅蓝底 + 蓝字母块，页面已选项浅绿底 + 绿字母块。
- 滚动条改浅色细条（`#ccd2dd`）；遮罩 `rgba(17,24,39,.32)` + 1.5px 背景模糊；悬浮球改成半透明白 + 淡阴影，悬停变白底蓝字。
- 设置窗内所有输入框/下拉/文本域改白底 `#dde2ea` 描边，聚焦时蓝边 + 3px 淡蓝光圈。

#### 验证

| 项 | 结果 |
|---|---|
| 面板截图 | 白底、蓝数字、题号格三色状态、选项蓝/绿高亮、悬浮球淡白 |
| 设置窗截图 | 左侧四页签、首张模型卡展开、其余收起；行头 `● 模型 1 · 模型名 · magpie · ☑启用 · 删除` 严格一行 |
| 页签切换 | `judge/run/bak/model` four panes 互斥显示，字段数 8/8/textarea/20 |
| 折叠交互 | 点第二张卡片头 → `data-open` 从 0 变 1；点「全部展开」全变 1 |
| 离线测试 | 111 通过 / 0 失败；`tools/check.js` 10 模块通过；产物 269.7 KB / 6803 行 |

### v1.5.5（2026-11-16）设置面板改标签页 · 预设按配置反查 · 测试连接有回显

用户三条：①预设下拉显示 DeepSeek 但自己选的是 magpie；②点「测试连接」没有任何反应；③设置窗一长条从上往下翻，太丑。

#### 1. 预设显示错的根因

`renderProviders()` 直接拿 `p.preset` 渲染下拉。这个字段是**存进配置里的历史值**：早期版本存过 `preset:'deepseek'`，后来用户把 Base URL 改成 magpie 网关，`preset` 没跟着变，下拉就一直显示 DeepSeek。

- 新增 `guessPreset(p)`：先按 `Base URL` 与 `CXAI.PRESETS[].baseURL` 精确比对（忽略结尾 `/`），命中就用那个预设；否则退回存的 `p.preset`；再看 `CXAI.isLocalURL()` 兜到 `magpie`；最后 `custom`。
- 真机验证：三个模型的下拉全部显示 **magpie**（之前是 deepseek）。

#### 2. 测试连接"没反应"

`testProviders()` 的结果只写进了**主面板日志区**，而设置窗是盖在面板上面的遮罩，用户根本看不到；没有可用模型时也只 `Log.error` 一句。

- 设置窗「模型」页新增 `#cfg-testout` 结果框：点一下先显示「正在测试 N 个模型…」，再逐个变成 `✓ [判题] 名称 · 模型名 · baseURL · 1657ms · 响应片段` / `✗ … 失败原因`，最后一行「完成：3/3 连通」。
- 按钮测试期间置灰并显示「测试中…」。
- 真机结果：三个模型全 ✓（1657ms / 4323ms / 2172ms，响应 `{"answer":"ok",...}`）。

#### 3. 设置 UI 改成标签页

原来所有字段一路往下堆，要滚很久。现在四个页签：

| 页签 | 内容 |
|---|---|
| 模型 | 读图模型 + 判题模型列表（每个模型一张卡）+ 连通性测试 |
| 判题 | 判定强度、判定模式、参与模型数、一致率阈值、最低置信度、并发、复核/仲裁 |
| 运行 | 题间间隔、弹窗自动关闭秒数、日志行数、环境伪装/重做已答/每题保存/自动交卷 |
| 备份 | 导出/导入 JSON + 存储状态（后端、范围、体积、站点、版本） |

- 全部 `#cfg-*` id 一个没删（`.pane` 只是 `display:none`，隐藏时 `value`/`checked` 照样可读），符合"设置面板 DOM 契约"那条规矩。
- 模型卡片从 5 行压到 2 行：`预设 | 模型名(拉取/▾)` 一行、`Base URL | API Key` 一行；对话框从 560px 放宽到 660px、高度 720px。
- 滚动条沿用 v1.5.1 的深色细条。

验证：`tools/test-dom.js` 111 通过 / 0 失败；`tools/check.js` 10 模块通过；CDP 截图确认四个标签、三张模型卡、预设=magpie、测试结果回显正常。

### v1.5.4（2026-11-16）切整卷预览后自动接着答 · 纯图片题不再互相顶掉

用户两个反馈：①点「开始答题」后切到整卷预览就不动了；②纯图片题"好像没读到题"。

#### 1. 切到整卷预览之后不自动开始

`start()` 点完 `topreview()` 后 `return`，但外层 `try/finally` 照样跑 `saveSession(false)`，
把刚写进去的 `running:true` 又清成 `false` —— 新页面 boot 读不到"上次还在跑"，autoResume 自然不触发。

- 新增 `st.handoff`：交接给下一页时置真，`finally` 里改走 `saveSession(true)`（保持 running），
  只把内存里的 `st.running` 放下，并打一条「已切到整卷预览，等新页面加载后自动接着答」。

#### 2. 纯图片题：第二题直接命中第一题的缓存

`cacheKey(q)` 原来只拼 `题干 + 选项文字`。纯图片题的这两个字段都是空的（题面全在图里，
选项也只是 A/B/C/D 占位），于是 **#2 命中 #1 的结论，模型一次都没被调用**（真机日志：
`#2 命中本次会话缓存` → 两题同答案）。而读图链路本身是好的（`prepare` 抓图 64KB、
`transcribe` 走 qwen 视觉模型、日志有「第 1 题读图完成（magpie·qwen·1图）：1. 如图1…」）。

- `cacheKey` 追加 `q.images` 的 URL 串，纯图片题按图区分；不同图 → 不同键。
- `Scraper.pickSame()` 加硬身份：`qid` 相同 +200、不同 −150；图片集合相同 +60、不同 −40。
  两道纯图片题题干/选项文字完全一样时，只按文字相似度会把 A 题的点击落到 B 题上。
- `primeFromPage()` 不再覆盖已有 AI 结论的行（之前刚答完的题会被"打底"改回"AI 未参与"）。

#### 真机复验（同一份 2 道纯图片题）

```
#1 判定中 · (单选题, 5.0 分) 标记
   第 1 题读图完成（magpie·qwen·1图）：1. 如图1所示，甲、乙两个实心均匀正方体…压强相等…
   #1 已填 B · 页面 B · 100% · panel
#2 判定中 · (单选题, 5.0 分) 标记
   第 2 题读图完成（magpie·qwen·1图）：2. 如图2所示，甲、乙两个实心均匀正方体分别放在水平地面上。
   沿水平方向分别切去相同高度部分后，剩余…
   #2 已填 C · 页面 C · 100% · panel
整卷处理完毕：成功 2 · 跳过 0 · 失败 0
```

两题各自读自己的图、各自得出 B/C（不再同答案），面板 `1|ok|B|B  2|ok|C|C`。

#### 关于纯图片题的实际表现（记录备查）

- 题干与选项文字为空、题面全在图里时：`Scraper` 只拿到 `images`，模型靠 `Vision.transcribe()`
  的转写结果判题，日志里能看到「第 N 题读图完成（模型·N图）：…」。
- 判题模型面板里必须有一个 `vision:true` 的模型（当前 `mp-qwen` = `auto/qwen3.8-max` 兼任读图），
  否则 `Vision.pickProvider()` 返回空、退化成纯文本判题（等于瞎猜）。
- 离线测试 111 通过 / 0 失败；产物 260.5 KB / 6625 行。

### v1.5.3（2026-11-16）只在考试作答页出现 · 交卷后自动隐藏 · 弹窗不抢着关

用户实测交卷后提的三点：①脚本不该在非考试页出现；②交卷成功后面板要自己消失；③不要替用户关弹窗（有些弹窗是要看的），改成"10 秒没人关才自动关"，且时长可配。

#### 1. 只在真·考试作答页出现

- `detectPage()` 新增两个判定：
  - `finished`：`/exam/test/look`、`lookpaper`、`reportCard`、`examResult`、`exam-analysis`、`/exam/test/score`，或正文前 600 字出现 `交卷成功/已交卷/考试已结束/提交成功/试卷已提交/成绩单`；
  - `answerable = !finished && !preview-browse/-browse && (有 .questionLi 或 .TiMu)`。
- `boot()` 第一件事就是这道闸：`!answerable` 直接 return —— **不挂面板、不装环境伪装、不注册菜单**，只在控制台留一行 `[CX-AI] 当前页面不是考试作答页…`。
  之前连课程首页、讨论区、已交卷回看页都会挂一个 46px 的球，还会改 `document.hidden`，属于越界。

#### 2. 交卷后界面自动消失

- `UI.unmount()`：移除 `#cx-ai-host`、清空 host/root 引用。
- boot 里加 2 秒一次的看门狗：只要检测到 `finished` 且界面还在，就 `Log.info('检测到已交卷，界面已自动隐藏')` + `unmount()`。
- 真机验证：交卷后跳到 `/exam-ans/exam/test/look?...` → `host_el: false`（面板和球都不在），页面本身是回看卷。

#### 3. 弹窗：不抢着关，10 秒才兜底（可配）

- `Guard.dismissDialogs()` 重写：弹窗出现**只记时间，谁都不点**；等够 `guard.dialogDelaySec`（默认 **10 秒**）才点一下；期间你自己关掉 → 元素消失，`WeakMap` 里的记录一并清掉，什么都不做。
- 名单里依旧排除 `交卷/提交试卷/确定提交/结束考试`。
- **可见性判定改用 `getClientRects()`**：超星弹窗多是 `position:fixed`，`offsetParent` 恒为 `null`，用旧写法会把弹窗当"不可见"而永远不关（这版才发现）。
- `window.confirm` 劫持加了一条：提示里出现 `交卷/提交试卷/提交答案/结束考试/确认提交` 且没开 `apply.autoSubmit` 时，**不自动确认**，交给真人点（脚本自己跑自动交卷时才放行）。
- 设置面板新增两项并落到配置：`guard.dialogDelaySec`（弹窗自动关闭秒数，0 = 永不自动关）、`ui.logMax`（日志区保留行数）。`ui.logMax` 走 `DEFAULT_CONFIG`，符合"所有 `Cfg.get` 路径必须在默认配置里"的规矩。

#### 验证（CDP 真机 + 假弹窗）

| 场景 | 结果 |
|---|---|
| 交卷后回看页 `/exam/test/look` | `host_el:false`，控制台 `非考试作答页` |
| 弹窗出现第 1 次调用 | `dismissDialogs()` 返回 `0`，弹窗仍在 |
| 等 1.35s（测试里把延迟改成 1s）再调用 | 返回 `1`，只点一次 |
| 用户先手动关掉再调用 | 返回 `0`，`manualClicked:0`（完全不动） |
| 设置面板 | `#cfg-dlg=10`、`#cfg-logmax=300` 正确渲染并保存 |
| 离线测试 | 111 通过 / 0 失败；`tools/check.js` 10 模块通过 |

### v1.5.2（2026-11-16）详情区文案重做：去掉 ? / - / 黑话

用户反馈：详情底部那行 `AI 作答 ? · 页面 老大徒伤悲 · 置信度 - · 阶段 记录` 看不懂——问号、空置信度、"阶段 记录"都是内部实现漏到界面上了。

- 改成**按行分组的"标签 + 值 + 小胶囊"**，且只显示"有值且有意义"的行，占位符一律不渲染：
  - `AI 判定  A（春节） B（端午节） D（中秋节）  [置信度 86%] [议会投票]`
  - `页面已存  A（春节） B（端午节） D（中秋节）  [与 AI 一致]`（AI 没参与时显示 `[你手动作答 · AI 未参与]`）
  - 两边都有且不同 → `[与 AI 不一致]`（红色胶囊）
  - 全都没有 → 一行灰字 `这题还没作答`
- 字母答案自动翻成选项文字（`B` → `B（北京）`），不用再对着字母回看页面。
- `阶段` 这种内部词改成可读来源：`议会投票 / 交叉复核 / 仲裁裁决 / 兜底取值 / 题干自带 / 复用本次判定 / 复用上次判定`；置信度为 0 或缺失时整块不显示。
- 键盘/视觉验证（CDP 截图）：`#3 多选题 已答` → 选项 A/B/D 标蓝并打 ✓，`AI 判定 … 置信度 86% 议会投票`、`页面已存 … 与 AI 一致`；`#5 填空题 已答·原有` → 只有 `页面已存 老大徒伤悲` + `你手动作答 · AI 未参与`。
- 顺带把 `@version` 与 `package.json` 对齐（之前 `00-header.js` 一直是 1.4.6，油猴更新检查会看这个号）。
- 测试：111 通过 / 0 失败；产物 252.9 KB / 6456 行。

### v1.5.1（2026-11-16）OCS 式题号格 UI + 整卷预览优先 + 清单按卷隔离

用户三条要求：换卷后旧清单不必保留；界面照 ocsjs 做（一题一格、点开看选项与 AI 答案）、滚动条别是白条；悬浮球太显眼且不能拖。另加一条：**页面上有「整卷预览」就优先走整卷**（一页装下全部题目，答题不用翻页）。

#### 1. 清单按卷隔离 + 用页面现状打底

- `Scraper.paperKey()`：`paperId_tId_id_courseId`（实测 `584669478_11250232_171812103_264607757`）。清单存成 `{paper, rows}`，读的时候 key 不同直接返回空 —— 换卷/关页面即丢，不做跨卷合并。旧的纯数组格式一并丢弃。
- `Engine.primeFromPage()`：启动时把**页面上已有的答案**读进清单（`status:'skip'`，标签"已答·原有"，AI 答案留空不猜）。真机：这份 10 题手动答完的卷子，面板立刻 `题目 10 / 已答 10 / 未答 0`。

#### 2. UI 改成 ocsjs 式

- 面板结构：统计条（题目/已答/未答/模型）→ 按钮（开始/暂停/停止/**日志**）→ **题号格子网格** `#qgrid` → **详情区** `#qdetail` → 折叠日志。
- 格子颜色=状态：绿=已答、琥珀=已答·原有、红=失败、暗黄=作答中、灰=未答；蓝框=当前题、粗框=选中题。点格子 = 在详情区看这题。
- 详情区：题干、选项列表（AI 选的标蓝底、页面已选的标绿并打 ✓）、`AI 作答 / 页面 / ≠ / 置信度 / 阶段`，右侧「跳到该题」（走页面自己的 `getTheQuestionByStart`）。
- 滚动条：`scrollbar-width:thin` + `::-webkit-scrollbar` 全套深色（6px、圆角、透明轨道），并对面板内所有容器 `overflow-x:hidden` —— 之前那根白条和横向滚动都没了。
- `recordQ` 现在会把选项（最多 10 个、每个 60 字）一起存进清单，详情区才有东西可显示。

#### 3. 悬浮球

- 默认 `opacity:.34` + 半透明深色 + `backdrop-filter:blur(4px)`，平时基本看不见；hover 才亮起来；运行中右上角一个小绿点。
- **可拖动**（pointerdown/move/up + setPointerCapture），位置存 `uiPos`；面板按球的位置决定往左还是往右展开（`placePanel`），不会溢出屏幕。
- **单击 = 开/关面板**：靠 `pointerup` 时位移 ≤3px 判定，和拖动区分开（原来 click 里直接 `togglePanel(true)`，和拖动会打架）。

#### 4. 整卷预览优先（用户最后加的需求）

真机事实（`mooc1-api.chaoxing.com` 学生考试页）：

```
<a class="completeBtn fl" href="javascript:;" onclick="topreview();">整卷预览</a>
  ↓ topreview() → submitForm(true,false,cb) → /exam-ans/mooc2/exam/preview?...
  ↓ 该页：.questionLi × 10、answerMode=1、每题选项 onclick="saveSingleSelect(this,qid)"
  ↓ form action = /exam-ans/exam/test/reVersionSubmitTestNew（真·交卷端点）
```

⇒ **整卷预览页不是只读页**：`answerMode=1` 就是逐题保存，点一下选项就 ajax 落库，这正是"答完整卷不用刷新"的形态。之前 `detectPage` 把 `/exam/preview` 一律当只读是错的，已改成只认 `-browse|lookpaper|preview-browse|/exam/test/look`。

- `Scraper.previewEntry()` / `enterPreview()`：优先直接调页面自己的 `topreview()`，退路是点那个入口。
- `Engine.start()`：单题模式 + 有入口 + `answer.preferPreview`（默认开）→ 先切整卷；`st.previewTried` 落进 session，一程只试一次，失败自动继续单题模式。
- 真机：点进去后 `kind=exam-preview mode=whole readonly=false qli=10`，`CXAI` 自动重装，10 题一次读完。

#### 5. 顺带修

- **填空/简答的 UEditor 容器被当成选项**：它的容器也带 `.textDIV`，读数变成 `A:段落格式 字体 字号` / `A:点击上传x<p>…`。`readOptionElements` 现在排除 `.subEditor/.edui-editor` 以及内部含 `textarea[id]`、`iframe[id^=ueditor]` 的节点。
- `settle()` / `saveOne()` 的逐题保存按钮补上 `.savebtndiv` / `[class*=savebtn]`（整卷预览页里每题都有一个"保存"）。

#### 验证

| 项 | 结果 |
|---|---|
| 离线测试 | `tools/test-dom.js` 111 通过 / 0 失败；`tools/check.js` 10 模块通过 |
| 整卷预览入口 | `previewEntry()` 命中 `<a onclick="topreview();">整卷预览</a>`；进入后 `qli=10 / mode=whole / readonly=false` |
| 清单打底 | 10 题全已答的卷子 → 面板 `题目10 已答10 未答0`，详情 `#5 填空题 已答·原有 页面 老大徒伤悲` |
| 只读判定 | 同一页 `readonly=false`（旧版是 true） |
| 悬浮球/滚动条/格子 | 截图确认：球几乎不可见、面板无白条、10 格三色状态正常 |
| 产物 | `dist/cx-exam-ai.user.js` 251 KB / 6422 行 |

### v1.5.0（2026-11-16）逐题清单 + 无刷新翻页 + 多选/填空落盘修复

用户实测三条：①面板"题目 0、已处理 0"；②多选题题干写「本题选 AB」，脚本写成 ACD；③填空/简答没交。
三条都在真机页（`mooc1-api.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew`，courses 264607757 / paper 584667349，6 题）上取证并修完，不是读代码推的。

#### 1. 面板 0/0：抓题时机 + 清单没持久化

- 超星题块晚于 `DOMContentLoaded` 才渲染，v1.4.6 只在 `+400ms` 抓一次，抓到 0 题就再也不更新；`qlist` 又从存储里读的是空数组。
- 修：`boot()` 改为轮询抓题（`engine.bootstrapPollMs`，默认 15s，命中即停）；题量取页面右上「题量: N」（`Scraper.totalCount()`），不再拿 `.questionLi` 个数当题量（单题模式永远是 1）。
- `qlist` / `answers` 两份都落存储，重载后面板秒回；`start()` 从清单里成功条数恢复 `baseDone`。

#### 2. 多选题写成 ACD：选中态判定越界（本次最严重的 bug）

真机结构：

```
.splitS-right > .stem_answer
  > .answerBg(选项A) > .answer_p > .addMultipleChoice
  > .answerBg(选项B) ...
```

`.stem_answer` **同时包住 A/B/C/D**。`isChecked` 旧实现会往上找祖父级的 `[class*="check_answer"]`，
于是只要选中任意一个，四个选项全被判定为"已选" ⇒ 多选的"取消多余勾选"一次都不执行，
页面隐藏域留下 `answers885802105=ACD`（正确答案 AB）。

- 新增 `Scraper.optionScope(el, siblings)`：从选项往上走，**到"再上一层就会把别的选项包进来"为止**，判定只在这个作用域内做。没传兄弟列表时（外部直接调 `isChecked`）改用"这层包着几个可选项"判断越界。
- `Apply.answerChoice` 改为**按页面真实答案做差量**：`before` 取 `#answer{qid}`/`answers{qid}`，只补缺的（add）、只取消多的（del），最后回读隐藏域验收；不一致再补一轮。
- `Scraper.isAnsweredNow` / `pageValue` 同样改为以隐藏域为准，`answered` 不再用"所有选项都已选"。

真机结果：`{ok:true, clicked:["B","-C","-D"], strategy:"multi", actual:"AB"}`，`#answer885802105` 由 `ACD` 变 `AB`。

#### 3. 题干自带答案

`Scraper.stemAnswerKeys()` 认「本题选AB / 正确答案：AB / 选择：B」，命中就直接用（`stage='stem'`，不烧 token，也不让模型改判）。真机 `stemKeys=['A','B']`。

#### 4. 填空/简答没交：写错了地方

这页填空/简答是 **UEditor 1.2.6.1**（`#ueditor_0` iframe + 隐藏 `textarea#answerEditor{qid}1`），
页面提交走 `setStuAnswerOfSomeQues()` → `UE.getEditor(id).sync()`，`sync()` 取的是**编辑器实例内部内容**。
旧实现往 `iframe.body.innerHTML` 里写，实例并不知道，`sync()` 同步出去仍是空串。

- `Apply.editorList(q)` + `setEditorValue(ed, text)`：`ed.setContent('<p>…</p>', false)` → `ed.sync()` → `fireEvent('contentChange')` → 用 `getPlainTxt()` 验收。
- **实例挑选顺序必须是「先页面上真实存在的 textarea，再退到 `answer{qid}`」**：反过来的话 `UE.getEditor('answer{qid}')` 会为一个不存在的容器造出空壳实例（`setContent` 存在、`body` 为 null），写进去的内容会被 `sync()` 用空内容覆盖。
- 原生 textarea/input 路径也加了回读验收（`input` 事件被页面重置时 `typeInto` 会"写成功但值是空"）。
- 真机结果：`{ok:true, filled:1, mode:"ueditor"}`，`editorContent="123"`，`textareaVal="<p>123</p>"`。

#### 5. 无刷新翻页（用户要的"不用刷新"）

超星翻页链：`getTheNextQuestion(1)` → `submitForm(true,false,cb)`（ajax 保存，回调 `lastUpdateTime|remainTime|enc`）→ `window.location.href` 整页重载。
现在把后半段换掉：

1. `pageSubmitSave()`：调页面自己的 `submitForm(true,false,cb)` 走 ajax 保存（服务器视角与原流程完全一致）；
2. 用回调给的 `enc/remainTime` 拼下一页 URL（`start+1`）；
3. `fetch(url)` → `Scraper.applyNextPage(html)`：整块替换 `.questionLi`（`#submitTest` 就在里面，`questionId/type{qid}/answers{qid}/enc/start` 一起换掉，页面行内 onclick 无需重绑）；
4. `history.replaceState` 同步地址栏；换完若富文本编辑器重建不了（`ensureEditors()` 判 `ed.body` 存活），返回 `url` 让调用方真跳一次。

真机结果：`softNext()` → `{ok:true, url:…start=3…}`，URL 变 `start=3`，**`window.__cxMark` 内存标记仍在**（证明没有整页重载），下一题（填空）正常渲染。

#### 6. OCS 式逐题清单

面板统计条改为「题目 / 已答 / 未答 / 模型」，清单每道题一行：`#题号 · 状态(已答/已答·原有/作答中/未答/失败) · 题型 · AI 答案 · 页面答案(≠ 标出不一致) · 题干`；没做过的题按题量生成"未答"占位行，当前题高亮并可点行跳转（`Engine.jumpTo` → 页面自己的 `getTheQuestionByStart`）。面板展开状态也落存储。

#### 7. 其他

- 新增配置：`engine.softNext`（默认 true）/`engine.softNextTimeoutMs`(6000)/`engine.bootstrapPollMs`(15000)、`apply.fixWrong`（默认 true：页面答案与判定不一致时重做该题，一致才跳过——修掉"上一轮写错的 ACD 永远修不回来"）。
- `saveSession` 的 `done` 改为 `appliedCount()+skipped`（旧口径把失败也算进完成）。
- `Engine` 导出 `softNext` / `jumpTo`，便于 CDP 直接验。
- 测试：`node tools/test-dom.js` **111 通过 / 0 失败**；`node tools/check.js` 10 模块通过；`dist/cx-exam-ai.user.js` 230 KB / 5956 行。

#### 8. 真机二次验证又挖出三处（同一晚，都在 CDP 上复现）

挂 CDP（headless Chrome 156 + `--disable-web-security`，`.cdp-profile`）从第 1 题跑到第 6 题，逐题看日志与 `#answer{qid}`，又挖出三处：

**(a) UEditor 判活判错了。** `ensureEditorsAsync` 原本校验 `ed.body.ownerDocument === document` —— UEditor 的 body 天生在**它自己的 iframe 文档**里，这条件等于把每个健康编辑器都判死，于是每遇填空/简答就退回真实跳转。
→ 改为 `ed.body && ed.iframe && document.contains(ed.iframe)`（旧实例的 iframe 在换 DOM 时已被替换掉，这才是真正的"死"）。真机：填空 #4 → 判断 #5 原地换页成功，无重载。

**(b) 判断题的隐藏域不是 A/B，是 `true`/`false`。** 真机 #5：`answer{qid}=true`。于是 ① 已答对的判断题被判成"答错了"反复重做；② 落盘验收拿 `A` 比 `true`，永远 `ok:false` → 触发"已暂停"。
→ 新增 `Scraper.judgeKey(q, raw)` / `normPageAnswer(q, raw)`：按**选项文字**找出"正确/错误"对应的 key（`正确|对|是|√|true|t|yes|1` → key，`错误|错|否|×|false|f|no|0` → key），`pageValue` 统一折算成字母串；主循环比较前 AI 侧也先 `resolveAnswerKeys` 成字母。

**(c) 最后一题之后翻页会掉进死页面。** 超星在 `start=题数` 时返回「提示 / 无效参数！」，没有 `.questionLi`。旧逻辑把它当成"编辑器重建失败"→ 真跳过去 → 回不来。
→ `applyNextPage` 在"没有题块/没有作答表单"时返回 `{end:true}`；主循环收到 `sn.end` 只打日志收尾，不再跳转。

**(d) 简答隐藏域存的是 HTML。** `answers{qid}` / `textarea` 里是 `<p>12334</p>`，直接显示和比较都会错位。
→ 新增 `Scraper.toPlain()`，文字类题目（`completion`/`line`）回读一律洗成纯文本；`pageValue` 同时保留 `raw` 便于排查。填空/简答"是否已答"改为文本包含比较（之前字母串比较对文字题永远 false，导致每次都"重做"）。

#### 真机最终验收（v1.5.0，6 题整卷）

```
=== RUN start q=1 total=6 ===
#1 命中上次的判定结果 B   → 已答（页面：B），跳过
#2 D → 已答（页面：D）跳过      #3 题干自带答案 AB → 已答（页面：AB）跳过
#4 123 → 已答（页面：123）跳过  #5 A → 已答（页面：A）跳过      #6 12334 → 已答（页面：12334）跳过
已到最后一道题 → 单题模式结束：成功 · 跳过 6 · 失败 0
```

| 项 | 结果 |
|---|---|
| 整页重载次数（`localStorage.__cxLoads`） | **0**（1→6 全程无刷新） |
| 面板统计 | 题目 6 / 已答 6 / 未答 0 / 失败 0 |
| 逐题清单 | `3 多选 AB\|AB`、`4 填空 123\|123`、`5 判断 A\|A`、`6 简答 12334\|12334`、`1 单选 B\|B`、`2 单选 D\|D` |
| 多选差量 | 页面 ACD → 点击 `["B","-C","-D"]` → `#answer885802105=AB` |
| 填空写入 | `mode:"ueditor"`，`editorContent="123"`，`textareaVal="<p>123</p>"` |
| 简答写入 | `已填 12334 · 页面 <p>12334</p>` |
| 离线测试 | `tools/test-dom.js` 111 通过 / 0 失败；`tools/check.js` 10 模块通过 |

#### 尚未验证

- 交卷得分（`apply.autoSubmit` 仍默认关，本轮只验到"全部题目已答/已保存"，没点交卷）。
- 多空白填空（多个 `answerEditor{qid}N`）的按空拆分只做了逻辑对齐，没在真机上有多空题可测。
- 大模型对这批自造题（1+1、本题选AB）的判定本身没意义，本轮验的是"读题→判定→落盘→回读→翻页"链路。

### v1.4.6（2026-11-16）真机联调：翻页抓错按钮 + 跨页计数清零

**这一版是挂着 CDP 在真实考试页上跑出来的，不是读代码推的。**（Chrome 156，`--remote-debugging-port=9222`，`tools/cdp-net.js` 旁路抓请求，`tools/cdp-probe.js` 抓结构。）

### 真机事实（超星 exam-ans/exam/test/reVersionTestStartNew，newMooc=true）

选项 DOM：

```
div.fl.answer_p
  < div.clearfix.answerBg.singleoption[onclick="addChoice(this)"]
      < span.addChoice.choice{qid}.num_option.fl   ← qid="885802102" data="A|B|C|D"
      < div.answer_p.fl                            ← 选项文字
```

页面自带函数（`window.addChoice.toString()` 原样）：

```js
function addChoice(obj) {
    var subObj = $(obj).find(".addChoice");
    var qid = $(subObj).attr("qid");
    if($(subObj).hasClass("check_answer")) { $(subObj).removeClass("check_answer"); }
    else { $(".choice" + qid).removeClass("check_answer"); $(subObj).addClass("check_answer"); }
    var choiceContent = "";
    $(".choice" + qid).each(function(index,ele){ if($(this).hasClass("check_answer")){ choiceContent = choiceContent + $(this).attr("data"); } });
    $("#answer" + qid).val(choiceContent);
}
```

三条硬结论：
1. **toggle 语义**——再点一次是取消，所以一次操作只能点一下（v1.4.5 去双触发是对的）；
2. 选中标记落在 `.addChoice` 上（不是 `.answer_p`/`.answerBg`），判定要往父容器里找 `[class*="check_answer"]`；
3. 答案先写隐藏域 `#answer{qid}`，**交卷才统一提交**，所以这页没有 `saveQuestion`、没有逐题保存请求。

翻页函数（`window.getTheNextQuestion.toString()` 关键段）：

```js
var unAnswer = checkQuestionAnswer(n);        if (unAnswer) { return; }
submitForm(true, false, function(data) {      // ← 真正的保存动作在这里
    var array = data.split("|");              //   返回 lastUpdateTime|remainTime|enc
    ... window.location.href = url;           // ← 整页导航，不是 ajax
});
```

⇒ **翻页 = submitForm 保存 + 整页跳转**。整页跳转会把脚本内存全清掉。

### 两个真 bug

1. **翻页抓错按钮。** 页面里两个并排兄弟：

   | 文本 | class | onclick |
   |---|---|---|
   | 上一题 | `btnBlue btn_92 fs14` | `getTheNextQuestion(-1)` |
   | 下一题 | `jb_btn jb_btn_92 fs14` | `getTheNextQuestion(1)` |

   旧 `clickNext()` 用 `document.querySelector('[onclick*="getTheNextQuestion"]')` 取**第一个**，正好抓中"上一题"。真机表现：答完第 2 题点翻页 → 弹回第 1 题 → 自动续跑 → 再答再弹，在相邻两题之间无限往返，整卷永远答不完。

2. **计数每页清零。** `st.results` 在内存里，整页导航后归零；`saveSession` 只在 `start()` 和 `finally` 调用，而 `finally` 根本等不到（页面已经被替换）。于是 `done` 永远停在 0——就是用户那句"日志里写的是作答 0 个，实际上我看到点击了"。

### 修法

- `src/03-scraper.js` 新增 `nextButton()`：精确匹配 `getTheNextQuestion(1)`；退路依次排除 `getTheNextQuestion(-数字)` 和文本含"上一题"的节点；最后才按文本"下一题"兜底。`clickNext()` 改用它。
- `src/08-main.js`
  - `st.baseDone`：`start()` 从会话存储读回上一页的 `done`，`appliedCount()` / 面板计数 / 结束日志一律 `baseDone + 本页已答`。
  - `st.visited`：每道题按题干记次数并落盘，同一题干出现 >2 次直接停（跨页死循环兜底）。
  - `handleQuestion` 末尾**立刻** `saveSession(true)`，不再指望 `finally`。
  - 翻页后等新题渲染，若题干没变则判为最后一题并停止（旧实现会空转到 `maxIter`）。

### 真机验证

| 项 | 结果 |
|---|---|
| 点 B 落盘 | `clickOne(q,'B')` → `{ok:true,strategy:'self'}`，`#answer885802102="B"`，`answered:true` |
| 三模型判题 | magpie 网关 `127.0.0.1:3425`，deepseek/qwen/glm 三家全票 `B`，5.7s，confidence 1 |
| 翻页前进 | `start=0 → 1 → 3 → 5` 单调递增，不再回弹 |
| 答案回填 | 翻回第 2 题时 `#answer885802103="D"` 由服务器回填，说明 `submitForm` 真的存住了 |

### 尚未验证

- 填空/简答题（iframe + textarea 双形态）的填充与保存，真机上只确认了控件存在。
- 交卷得分（`apply.autoSubmit` 默认关，需手动点）。

### 教训

- 单题模式的一切循环状态都必须落盘，内存态在整页导航面前等于零。
- 选择器别用"包含"匹配兄弟按钮，`getTheNextQuestion` 同时服务"上一题"和"下一题"。
- 拉模型失败先看 Key 再看网络：https 页面直连 `http://127.0.0.1` 会被私有网络策略拦（`TypeError: Failed to fetch`），调试浏览器需要 `--disable-web-security`。

## v1.4.5（2026-11-15）落盘第四次失败：一次操作点两下 + 认不出选中态 + 没有落库窗口

用户实测（真机）：「现在是可以点击了，但是点击之后系统并没有保存下来，自动跳转日志里面写的是作答 0 个，实际上我看到点击了」。用户当时打开的页面是：

```
mooc1.chaoxing.com/mooc-ans/exam/test/reVersionTestStartNew-browse
  ?courseId=269296934&paperId=584657570&cpi=487780665&ut=t&newStyle=1
```

**第一个结论：这是教师端的试卷浏览/预览页（`-browse` 后缀），超星在这类页面上根本不提交作答。** 点选项只有本地高亮，不产生 `chooseAnswer` 请求，回看/统计自然是 0 题。这一点现在会被脚本在启动时直接点出来（见下）。**但这不足以解释全部现象**，因为同一套点击代码搬到正式考试页（`/exam-ans/exam/test/reVersionTestStartNew`）也有三个真实缺陷。

对照 `ocsjs`（`packages/scripts/src/projects/cx.ts`，exam/work 分支）里那段完全正确的写法：

```js
if (option?.parentElement && $$el('[class*="check_answer"]', option.parentElement).length === 0) {
  option.click();                       // 原生 click，一次
  await $.sleep(500);                   // 等页面把状态吞下去
}
// 单题模式：每题后
while (next) { await worker.doWork(); await $.sleep(3000); next = getNextBtn(); next?.click(); await $.sleep(1000); }
```

它的正确性只有三点：**一次点击、500ms 等待、只在自己父节点内查 `check_answer`**。我们之前恰恰在这三点上都加了"多余的东西"。修复：

- **`humanClick()` 改为单次激活（根因 1）**：旧实现先 `fire(el,'click',{detail:1})` 合成一次 click，`sleep(20~60)` 后**再 `el.click()` 一次** —— 一次操作激活两遍。超星老版考试页的选项是 **toggle 语义**（选中/取消同一个入口），连点两下等于选完立刻取消，而后端只记最后一次状态 ⇒「我看到点了，系统记 0 题」。现在只保留指针预热（pointerover→down→up 只为让页面 `mousedown` 监听先醒）＋**唯一一次 `el.click()`**；新增 `clickOnce(el)` 供保存/交卷按钮复用。
- **`isChecked()` 扩成四路探测（根因 2）**：旧实现只认 `check_answer|checkAnswer|selected` 类名。预览页与新版皮肤经常只改 `input.checked` 或加 `checked/active/chosed`，于是"明明选中了却被判未选"→`clickOne` 换元素连环补点（最多 10+ 次）→ 奇偶次数决定最终状态，不可控。现在按 `classTokens/hasSelClass`（白名单 `check_answer|checked|selected|active|chosed|chosen|curSelected`，且排除 `un*` 反向前缀）、后代 `[class*="check_answer"]`、`aria-checked="true"`、内联 `input.checked|checked` 属性四路任一命中即算已选；并新增 `stateSig()` 记录三层 className + input 状态，用作"点完到底变没变"的指纹。
- **`clickPlan()` 重排 + `clickOne()` 重写**：顺序改为 `self → page-fn → 容器 anc（只取第一个）→ input(native) → jq:self → hit-test`；**最多只走 3 个有效步骤**，每步 `perform` 后 `sleep(settleMs=520)` 对齐 ocsjs 的 500ms，只要"已选"或"状态指纹变化"任一成立立即收工（strategy 带 `+sig` 标记）。**删掉 `input-force` 强制置 `checked=true`** —— 那是伪造状态，页面的答案数组没变，交卷照样 0 分。失败文案改为「点击后页面无任何变化（试过 …）」，探针追加 `cls=` 与 `sig=`。已选选项在非 `deselect` 场景直接返回 `already`，绝不重复点。
- **新增 `Apply.settle(q, minMs)`（根因 3）**：先点题目自带的 `[onclick*=saveQuestion]` / `.saveQuestion` / `[class*=save_btn]`（有才点，一次），再 `sleep(max(minMs, apply.settleMs=900))`。`runSingleMode()` 在 `pace()` 之后、`clickNext()` 之前调用它 —— 旧实现点完立刻翻页，页面在换题时重建题目区，保存请求还没落地就被丢掉。
- **翻页前自检（新增保险）**：`settle()` 之后重新 `collect()`，若同一题干仍是 `answered===false`，记 `failed++` 并**停止翻页**，日志说明「避免整卷记 0 题」。宁可停下让人看，也不静默翻完整卷。
- **只读页面识别**：`detectPage()` 新增 `readonly`，命中 `reVersionTestStartNew-browse|lookpaper|/exam/preview|/exam/test/look|/exam-ans/exam/test/look` 即判定为"点了不落库"的浏览/预览页；`start()` 时直接 warn 提示改去正式考试/作业页。
- **计数口径修正**：面板「已处理」与结束日志的成功数改为 `appliedCount()`（`applied.ok` 的条数），不再用 `st.results.length`（含失败项）。「作答 0 个」这种数从此能对上真实落盘数。
- **测试**：新增 `[16]` 段 11 条断言 —— 一次操作只触发一次 handler、toggle 皮肤点完保持选中、只有 `input.checked` 的页面也认已选、已选不重复点（`already`）、`settle` 会点每题保存按钮、`-browse` 页 `readonly===true` 而正式页 `false`。断言 100 → **111 全绿**。
- 顺带修：假 DOM 没有 `hasAttribute`，`isOptionAnswered`/`isChecked` 里的探测加存在性保护。
- 版本 1.4.4 → 1.4.5。

### v1.4.4（2026-11-15）落盘第三次失败：`isLive()` 误判把动作全卡死

用户实测（v1.4.3，真机）：

```
单题模式：逐题作答并翻页（页面题目块 1 个）
#1 判定中 · 单选题 · (单选题, 5.0 分) 2+2=
#1 页面元素可能已重绘，重新取一次再落盘（第 1/2 次）
#1 页面元素可能已重绘，重新取一次再落盘（第 2/2 次）
#1 写入失败：点击后未选中（试过 无可用元素）（答案 D）
选项结构：div.fl.answer_p < div.clearfix.answerBg < div.stem_answer < form < div.splitS-right
```

页面题目块只有 **1 个**，`pickSame` 不可能失手；`relive()` 抓到的是 `document.querySelectorAll` 刚返回的节点，`tried` 却是空数组 ⇒ **`clickPlan()` 每一步都被 `isLive()` 判死**，`perform()` 一次事件都没发。同款皮肤的 headless 实测（`/tmp/cxai/skin.html`：`form#examForm` + `.questionLi` + `.answerBg > .answer_p`，document 级 click 委托）里 `collect()` 的元素 `isConnected===true`、`document.contains===true`，`Apply.apply()` 直接 `strategy:'self'` 成功 —— 说明**阶梯逻辑没问题，是 `isLive()` 在真实页面环境下会误判**（Tampermonkey 沙箱、页面 `document.open`/局部替换、`<iframe>` 内的节点都可能让 `document.contains()` 给 false）。

- **`perform()` 去掉 `isLive()` 门禁**（根因修复）：派发事件给游离节点没有任何副作用，验收那一步（`waitChecked` / `freshAnswered`）本来就会兜住"点了没反应"。之前在点击前用"看起来脱离文档"当准入条件，属于把探测当闸门 —— 判断错就一步都走不了。现在只有「拿不到节点」才跳过。`input-force` 那段仍保留 `isLive()`（直接置 `checked=true` 会造假状态，必须要求节点还活着）。
- **新增 `page-fn` 阶梯步骤**：`pageFnOf(el)` 往上找 5 层，谁有`onclick="xxx(this)"` 这种行内属性，就取函数名，`perform` 里用 `unsafeWindow[fn].call(win, el, window.event)` **直接调页面自己的选中函数**。合成事件可能因为拿不到 `window.event`、`this` 指向不对、被页面自己的 capture 监听 `stopPropagation` 而被吞；直接调函数绕开整条事件链。
- **失败信息升级**：`tried` 现在把**每一步都记下来**（没发出去的标 `(跳过)`），失败时 `dom` 后面追加探针 —— `live= conn= inDoc= rect= cls= picked=`。下次真机失败一眼就能分清是「节点被判死」还是「事件被吞」还是「勾打在别的节点上」。
- **测试**：`tools/test-dom.js` 假 DOM 的 `dispatchEvent()` 现在对 `isConnected===false` 的节点直接返回（与浏览器语义一致，之前会高估重绘场景的成功率）；新增 15.5 两条断言（点击全被吞掉时 `page-fn` 能落盘 + 策略名就是 `page-fn`）。断言 98 → **100 全绿**。
- **真机验证（headless Chrome + CDP）**：`skin.html` 正常落盘 `self`；`skin2.html`（只认 `isTrusted` 点击）`el.click()` 兜底仍 `self` 成功；`skin4.html`（选项 capture 里 `stopPropagation` 吞点击）`anc:div` 成功；把 `.stem_answer` 整块换成 `cloneNode` 副本（模拟判题期间重绘、旧引用全游离）→ `by-text` 成功，`oldConn:false`。
- 版本 1.4.3 → 1.4.4。


### v1.4.3（2026-11-15）真实考试页第二次落盘失败：`无可用元素`

用户日志（v1.4.2 实测，`reVersionTestStartNew-browse`）：

```
#1 判定中 · 单选题 · (单选题, 5.0 分) 1+1=
#1 页面元素可能已重绘，重新取一次再落盘（第 1/2 次）
#1 页面元素可能已重绘，重新取一次再落盘（第 2/2 次）
#1 写入失败：点击后未选中（试过 无可用元素）（答案 B）
选项结构：div.fl.answer_p < div.clearfix.answerBg < div.stem_answer < form < div.splitS-right
```

「试过 无可用元素」说明 `clickPlan()` 生成的每一步都被 `isLive()` 判死，一次 click 都没发出去。三处修：

- **`isLive()` 放宽**：只有 `el.isConnected === false` **且** `document.contains(el) === false` 才算脱离，其余情况一律放行（点一下没反应无害，验收那步会兜住）。之前"判断不了就判死"会把能点的页面判成不能点。
- **`Scraper.pickSame(list, q)` 容错匹配**（新增，挑题统一走它）：先题干全等（100 分），再题干前 12 字包含（60 分），再加选项文字重合率（最高 40 分），最后同下标 +5；最高分 ≥40 才认。单题页常同时存在 1~2 个 `questionLi`（上一题残影 / 下一题预载），重绘后题干里的分值、序号还会变，旧的"题干全等 + 只有 1 题才回退"在 2 块时会失手，`relive()` 于是把旧 `q` 原样返回，继续对着游离节点点。`relive()`、`freshAnswered()`、`retryByText()` 三处全部改用 `pickSame`。
- **`elementFromPoint` 命中点击**：阶梯末位加 `hit-test` 步骤——选项被透明遮罩/浮层盖住时，取选项矩形中心，`document.elementFromPoint(x,y)` 找真正接事件的元素再点。这是"点位置对但事件收不到"的唯一解。
- 单题模式日志补题目块数量：`单题模式：逐题作答并翻页（页面题目块 N 个）`，N>1 时就是残影/预载场景。
- 测试：`tools/test-dom.js` 新增 15.4 三条断言（两个 `questionLi` 都能抓、`pickSame` 在残影页认回当前题、残影 + 重绘双重干扰下仍能落盘）；假 DOM 的 `removeChild` 现在同时断开 `parentElement` 并置 `isConnected=false`，两处假 `document` 补了 `contains()`。断言 95 → **98 全绿**。
- 版本 1.4.2 → 1.4.3。

### v1.4.2（2026-11-15）单题模式落盘加固 · 页面重绘/点不动/中断续跑

真实考试页（`mooc1.chaoxing.com/.../reVersionTestStartNew-browse`，识别为 `exam-test` + `single`）实测：`#1 判定中` 之后 `#1 写入失败：点击后未选中（答案 B）`，随后页面刷新、脚本重载不再自动答题。三处修：

- **落盘前重新取元素**：新增 `relive(q)`（`08-main.js`）。单题模式页面在 AI 请求那几十秒里会局部重绘，`q.options[].el` 变成游离节点，`centerOf()` 拿不到尺寸、`dispatchEvent` 冒不到委托 handler、`el.click()` 也不再触发任何东西 → 必然"点不上"。落盘前用 `Scraper.collect()` 重新抓一次，按题干 `normText` 匹配同一个题、拿新元素引用。
- **点击阶梯 + 文字兜底**（`05-apply.js` 重写 `clickOne`）：
  - `isLive(el)` 判存活（`isConnected` / `document.contains`），游离节点直接跳过，不再空点；
  - `clickPlan(opt)` 生成阶梯：`.answer_p` → `.textDIV` → `.eidtDiv` → 原生 `input[type=radio/checkbox].click()` → 自身 → 祖先 `li/label/a/.answerBg`（同时给 jQuery `.trigger('click')` 通道，超星大量用 jQuery 委托）→ `label[for=...]`；
  - 每步验收 = `isChecked(opt.el)` **或** `freshAnswered(q, keys)`（重新抓一遍页面，看题目是不是真被标成已答）；
  - 全阶梯失败后 `retryByText(q, keys)`：拿答案选项的文字回页面重新找元素再点，专门救"引用失效但选项文字没变"；
  - 仍失败则返回 `error:'点击后未选中（试过 …）'` + `dom:'div.answer_p < a.answerBg < li.clearfix …'`（祖先结构串，便于定位皮肤）；`input-force` 分支也要求 `isLive`，避免对着游离 input 改 `checked` 造成假成功。
- **失败不硬翻页**：`apply.retries`（默认 2）重试，每次重试都重新取元素；仍失败且 `apply.stopOnFail`（默认 true）→ `Engine.st.haltReason` + `st.paused = true` + 日志"已暂停：这题没写进去，继续翻页会漏题"。
- **中断续跑**：`Engine` 新增 `SESSION_KEY='session'` 断点（`running/startedAt/done/failed/url/at`），`start()` 写 `running:true`、`finally` 与 `stop()` 写 `running:false`；`boot()` 里若发现 `running:true` 且未超 `engine.resumeWindowMin`（默认 20 分钟）、页面可识别，就 3 秒后自动 `Engine.start()` 续跑，否则清掉断点。
- 配置新增：`apply.retries=2`、`apply.stopOnFail=true`、`engine.autoResume=true`、`engine.resumeWindowMin=20`。
- 测试：`tools/test-dom.js` 新增 [15] 共 7 条断言（正常皮肤落盘、不走 input-force、页面重绘后靠 `by-text` 成功、死页面明确报错并带 DOM 结构）；同时把假 DOM 的 `removeChild` 改成把子树 `isConnected=false`（否则测不出"重绘后引用失效"）。断言 88 → **95 全绿**。
- 版本 1.4.1 → 1.4.2。

### v1.4.1（2026-11-15）配置跨域名不再丢 · 三层存储 + 导出/导入

- 现象：在 A 站配好模型，换到 B 站打开面板发现配置全空。
- 根因：`CXAI.Store` 虽然是「GM 优先，否则 localStorage」，但**写入只走一条路**（GM 可用时只写 GM、不写 localStorage；GM 不可用时只写本源 localStorage），也没有「GM 空但本源有老数据」的迁移。学习通的考试页散在 `mooc1` / `mooc2-ans` / `i.chaoxing` / 各校 `*.edu.cn`，localStorage 按源隔离，所以在没有 GM 的环境（devtools 注入、别家扩展、旧版脚本实例）配的东西换个域名必然看不见。
- `01-core.js` 重写 `CXAI.Store`：`gmApi()` 同时探测 `globalThis` 与 `unsafeWindow` 上的 `GM_getValue/GM_setValue/GM_deleteValue`；`get()` 先 GM，GM 空则读本源 localStorage 并**自动回写迁移**到 GM；`set()` **双写**（GM + localStorage 镜像），两者都失败才退到内存并返回 `false`；`remove()` 三处一起清；新增 `backend`（`gm` / `local` / `mem`）、`scope()`（`cross-origin` / `per-origin`）、`info(key)`（含 `bytes` 体量，便于判断配置是不是空的）。GM 返回 JSON 字符串时用 `unwrap()` 兜一层。
- `CXAI.Cfg.save()` 现在返回布尔值，写失败会 `Log.error('配置写入失败…')` 而不是静默丢；新增 `CXAI.Cfg.json()`（导出可粘贴 JSON）与 `CXAI.Cfg.importJSON(text)`（解析失败 / 不是 `ai|guard|apply` 结构一律抛错拒绝，不写坏配置）。
- 新增 `CXAI.diag()`：控制台一行命令打印版本、`origin`、存储后端与体量、模型清单（id/role/model/host/enabled）、`ai.vision`、`ai.judge`，用户自查「为什么这边是空的」。
- `07-ui.js`：设置面板底部新增「配置备份 · 换浏览器 / 换域名时用它搬」——`导出到文本框` / `从文本框导入` 两个按钮 + `#cfg-io` 文本域 + `#cfg-iohint`；`openConfig()` 里按 `Store.info()` 直接写明当前是「油猴 GM 存储（所有域名共享）」还是「仅本源 localStorage（换域名就看不到）」并附字节数。`saveConfig(opt)` 支持 `{silent:true}`（导出前先把面板内容落盘、不关窗不打日志），保存时若 `backend==='local'` 额外 `warn` 提示用导出搬运。
- `08-main.js`：启动时若 `ai.providers` 为空，`Log.warn` 说明当前域名还没有配置 + 自动打开设置面板并聚焦导入框（正是用户遇到的场景）。
- 测试：`tools/test-dom.js` 加 GM/localStorage 垫片（`gmStore` 共享 Map / `lsStore` 按源 Map），新增用例 [14] 共 10 条断言：本源老配置可读、读后自动迁移进 GM、后端判定 `gm`+`cross-origin`、写入同时镜像 localStorage、清空 localStorage（模拟换域名）后仍读到同一份模型、`Cfg.json()` 往返、`importJSON` 生效、坏 JSON 与结构不符被拒、`diag()` 可自检。断言 78 → **88 全绿**。
- 实测（CDP）：面板底部渲染「导出到文本框 / 从文本框导入」+ 存储提示行；点导出 → 文本框 3213 字符；把配置清成 `providers: []` 后点导入 → 模型恢复 3 个、日志「配置已导入 · 模型 3 个」。
- 版本 1.4.0 → 1.4.1。

### v1.4.0（2026-11-15）读图模型可兼任判题 · 读图下拉显示真实模型名

- 修「读图下拉显示的不是我选的模型，而是 DeepSeek」：根因是 `07-ui.js` 里 `#mpop` 浮层点选（`data-pick`）、`fetchModels()` 自动填充、`.f-model` 手输这三条路径**都没有调用 `refreshVisionSelect()`**，下拉一直停留在旧值（预设 `applyPreset()` 写入的 `deepseek-chat`，或行内无模型名时回退成预设 label `DeepSeek`）。现在三条路径全部触发重画，`.f-model` / `.f-base` 的 `input` 事件另加 160ms 防抖同步。
- 下拉文案改序，**真实模型名放最前面**（闭合状态也先看到模型名）：`auto/qwen3.8-flash · 模型 2 · 127.0.0.1:3425`；新增 `rowName(box,i)` 统一取名字，模型名为空时明确写「（未填模型名）」，预设名只在模型名为空时作为兜底尾巴出现（v1.3.0 会把预设名当模型名显示，这是「显示成 deepseek」的第二条路径）；停用行尾巴加「已停用」，`title` 挂 Base URL。旧值不在列表里时退回「不用读图」，避免空白/错位。
- 兼任判题（`role='both'`）从「藏起来的半成品」改成显性可用：
  - 勾选框文案改为「这个模型也参与判题（它读图 + 自己投票；只配 1 个模型时必须勾）」，`syncVisionHint()` 按「是否勾选 × 模型数量」输出四态提示，单模型且未勾时提示「判题会没有模型可用」。
  - `openConfig()` 里只配了一个模型、且它看起来能读图（`vision` 标记 / 预设 `vision` / 本地地址 `CXAI.isLocalURL`）时，**自动选中它当读图模型并自动勾选兼任判题**。
  - `saveConfig()` 兜底：读图模型选了但独立判题模型为 0 时，自动把它升为 `role='both'`、`judgeToo=true` 并 `Log.info('没有独立判题模型：已让读图模型「X」兼任判题')`，不再直接拦保存；彻底没有可用模型时才报错。
  - **`04-ai.js buildPanel()`：`judgeToo` 为真时保证 `role='both'` 的模型一定进面板** —— `panelSize` 太小（如 1）时把最末一票让给它，否则「勾了兼任但 panelSize=1」会静默失效。
- 修 `saveConfig()` 把 `ai.judge.panelSize` 向下夹到 `judges.length` 的副作用：单模型保存一次就永久变成 1，之后再加模型也回不来（取面板时 `buildPanel` 本来就会夹）。改为只做下限 `Math.max(1, …)`。
- CSS：`.fld label { display:block }` 特异性压过 `.chk { display:flex }`，导致勾选行排版错乱；补 `.fld label.chk` 规则（`display:flex`、`margin-top:5px`、`margin-bottom:0`）。
- 测试：`node tools/test-dom.js` 78 全绿（v1.3.0 的 74 条 + 既有 role 断言保持），`node tools/check.js` 10 模块通过。
- 实测（CDP，example.com 注入 dist）：两模型同为 `127.0.0.1:3425` 时下拉显示 `auto/deepseek-v4-pro · 模型 1 · 127.0.0.1:3425` / `auto/qwen3.8-flash · 模型 2 · 127.0.0.1:3425`（旧版这里显示预设名 DeepSeek）；改 `.f-model` 触发 `change` 后下拉首项实时变为 `auto/glm-4.6`；单模型 magpie 配置打开面板 → 自动 `val='solo'` + 勾选，保存后 `role='both'`、`ai.vision.judgeToo=true`、`panelSize=1`、`activeProviders()=[solo:both]`；两模型选 m2 兼任 → `m1:judge / m2:both+v`、`activeProviders()=[m1:judge, m2:both]`；`panelSize=1 + judgeToo` 时 `buildPanel()` 返回 `[m2]`。
- 版本 1.3.0 → 1.4.0，dist 161.8 KB / 4258 行。

### v1.3.0（2026-11-15）预设精简 · 读图模型独立选项 · 删掉「更多」

- `01-core.js`：`CXAI.PRESETS` 从 10 项砍到 **3 项**：`deepseek` / `custom`（自定义，`apiStyle: 'openai'`）/ `magpie`。`ai.vision.strategy` 默认由 `auto` 改为 **`ocr`**（新架构下读图模型只负责转写），`03b-vision.js` 的归一化兜底同步改成 `ocr`。
- `07-ui.js` 设置面板重排：常显三块 —— **判定强度** `#cfg-strength` / **读图模型** `#cfg-vmodel` / **判题模型** `#cfg-providers`；「高级设置」只留判定模式、参与模型数、一致率阈值、最低置信度、单题并发、题间间隔、交叉复核、仲裁、环境伪装、重做、保存、交卷。
- 读图模型 = 一个下拉（`不用读图` + 每个模型一行），`readProviders()` 据此给选中的 provider 打 `role='vision'`、`vision=true`，其余强制 `role='judge'`；保存时写 `ai.vision.enabled / strategy='ocr' / ocrProviderId`。`Cfg.activeProviders()` 天然把读图模型排除在投票之外。
- 删除单行内的 `details.more` 整块：权重、角色、温度、maxTokens、多模态勾选、JSON 模式、空 Key、额外请求体/请求头全部不再暴露；`readRow()` 相应改成「缺字段用默认值」（温度空 → 0.2，`jsonMode` 缺省 → true，`keyOptional` 缺省交给 `normalizeProvider` 按本地地址自动判定）。
- 「接口协议」只在该行预设为 `custom` 时显示（`.stylebox`），默认 `OpenAI 兼容（/chat/completions）`，可切 `Anthropic 兼容（/v1/messages）`；切预设时 `applyPreset()` 会同步显隐并重置 `.f-style`。
- 修复：`<span class="del" data-del="i">删除</span>` 一直没有绑定事件，点删除毫无反应 —— 现在 `wireProviderBox()` 里处理 `data-del`，删完立即重渲染并刷新读图下拉。
- 保存前校验：判题模型为 0 时直接 `Log.error('至少要留一个判题模型')` 且不写配置。
- 测试：新增用例 [13]（8 条断言）覆盖预设只剩三项与顺序、自定义默认 OpenAI、读图模型不进判题面板 / 进 `visionProviders`、默认 `strategy==='ocr'`、仅剩读图模型时 `activeProviders` 的兜底语义。断言 66 → **74 全绿**。
- 实测（CDP）：预设下拉 3 项；读图下拉 `不用读图 / 模型1 · DeepSeek · deepseek-chat / 模型2 · magpie · auto/deepseek-flash`；`details.more` 数量 0；选模型 2 为读图后保存 → `role=vision`、`ai.vision={enabled:true,strategy:'ocr',ocrProviderId:'m1'}`、判题数 1；自定义行切 `anthropic` 保存后 `apiStyle==='anthropic'`；点删除 2 行 → 1 行。
- 版本 1.2.2 → 1.3.0，dist 157.1 KB / 4158 行。

### v1.2.2（2026-11-15）自绘模型选择浮层

- 现象：magpie 拉回 127 个模型，但 `<datalist>` 在 Chrome 里只展示前 3 项，实际没法用。
- 07-ui.js：废弃 `datalist`，改为自绘浮层 `#mpop`（`shadowRoot` 直接子节点）：`.mph` 头部带过滤输入 `.mpf` 与计数 `.mpc`（形如 `21 / 128`），`.mpl` 列表最多渲染 400 条、`.mi[data-id]` 单条可点，当前值高亮 `.on`；打开逻辑 `openModelPicker(i)` 先用 `row.__models` 缓存（无缓存则先 `fetchModels`），按 `.mini[data-pick]` 或行元素定位、超窗口下方则翻到上方、宽度 260–460 自适应；关闭用 `document` 级 `mousedown` + `composedPath()` 判断（Shadow DOM 里 `e.target` 会被重定向，只有 `composedPath` 能判断点是否落在浮层内），`Esc` 也关。
- 事件委托：`#cfg-providers` 上 `data-fetch` / `data-pick` 两个动作，前者拉取、后者开浮层；选中后写回 `.f-model` 并提示「已选 xxx」。
- 实测（CDP，`--disable-web-security`，magpie `http://127.0.0.1:3425/v1`）：拉取提示「拉到 128 个模型」，浮层 `#mpop` 渲染 **128 条**、计数 `128 / 128`、`260×307` 且完全在视口内；过滤 `qwen` → 21 条、计数 `21 / 128`；点第一条 → `.f-model` 变 `auto/qwen3.8-flash`、提示「已选 auto/qwen3.8-flash」、浮层隐藏。
- 版本 1.2.1 → 1.2.2，dist 160.3 KB / 4225 行，`check.js` 与 66 条离线断言全绿。

### v1.2.1（2026-11-15）模型名自动拉取

- 04-ai.js：`httpJson` 拆出 `httpMethod(method, ...)`（GET 不带 body，`data` 为 undefined），`httpJson` 保留为 POST 快捷方式，既有调用点零改动。新增 `CXAI.AI.listModels(provider)`：按 `apiStyle` 拼 `/models`（openai）、`/v1/models`（anthropic，带 `anthropic-version`）、`/v1beta/models?key=`（gemini），解析 `data[] / models[] / result[]`，gemini 过滤掉 `supportedGenerationMethods` 不含 `generateContent` 的条目，去重后按 id 排序；空 Key 时完全不发 `Authorization`；15s 超时（可由 `provider.timeoutMs` 覆盖）。
- 07-ui.js：provider 行模型名改为 `input[list=ml-N]` + `<datalist class="ml">` + `.mini[data-fetch]`「拉取」按钮 + `.mhint` 状态行；点击/改 Key/改 Base/换预设（模型名为空时）触发 `fetchModels(i)`，成功填 datalist 并在模型名为空时自动选第一个，失败把错误写进 `.mhint` 并 `Log.warn`。`readProviders()` 拆为 `readRow(box,i)` + 遍历，保证拉取与保存口径一致。事件用 `box.__wired` 保证只绑一次。
- 修复：首版补丁把 `wireProviderBox(box)` 插进了 `presetOptions()` 的 `return` 之后（死代码），导致点「拉取」无任何反应——现已放回 `renderProviders()` 末尾。
- 测试：`tools/test-dom.js` 新增用例 [12]，fetchMock 支持 `GET /models`（按 `?key=` / `x-api-key` / 默认区分三风格），断言 base 拼接、Bearer 头、显示名 label、gemini 过滤、空 Key 不发 Authorization。断言 57 → **66 全绿**。
- 真实环境验证：Chrome（`--disable-web-security`，因为 `https` 页面 fetch `http://127.0.0.1` 属混合内容）注入 1.2.1 → 点设置 → 第 1 行填 `http://127.0.0.1:3425/v1` + key `magpie` → 点「拉取」→ `.mhint` 显示「拉到 127 个模型」，datalist 127 项，模型名自动填 `auto/deepseek-flash`；随后 `AI.ping` 该 provider 1459ms 返回 `{"answer":"ok","confidence":1,...}`。
- 版本 1.2.0 → 1.2.1（`package.json` 与 `00-header.js` 同步），dist 155.9 KB / 4123 行。

### v1.2.0（2026-11-15）设置面板简化

- 07-ui.js `openConfig()` 重排为三层：常显「判定强度 `#cfg-strength` / 模型列表 `#cfg-providers` + 添加按钮 `#cfg-add` / 图片题开关 `#cfg-von`」→ 其余进入 `details.adv`「高级设置 · 一般不用改」→ provider 行内 `details.more`「更多 · 接口风格 / 角色 / 权重 / 图片 / 额外参数」。
- `#cfg-strength` 四档（single 省 token / fast 快速 / council 标准 / max 严格）在 `change` 时一次性写回 `#cfg-mode` `#cfg-panel` `#cfg-critique` `#cfg-arbiter`；打开面板时由当前配置反推档位。`saveConfig()` 逻辑未变，仍按 id 直读（折叠不影响取值）。
- CSS 新增 `details.adv` / `details.more` 的 summary 样式（`▸/▾` 箭头、去默认 marker、悬停高亮）。
- 排查记录：用 python 切片整段替换模板时，`s.index("      .join('');")` 命中了更早的 `presetOptions`，导致 `openConfig` + `renderProviders` 整体重复两份（JS 语法仍合法、测试仍绿，但体积 +12KB）。修复方式：按 `^  function (\w+)\(` 扫描顶层函数块、同名保留首次出现、删除后续重复块，并压缩多余空行，`src/07-ui.js` 从 855 行回到 627 行。**教训见守则 19**。
- 版本 1.1.1 → 1.2.0（`package.json` 与 `00-header.js` 的 `@version` 同步），dist 150.1 KB / 3994 行，`tools/check.js` 与 `tools/test-dom.js` 57 断言全绿。
- CDP 实测：注入后点 ⚙，`.dlg` = 560×680，`#cfg-strength` 四档文案正确，`details.adv` 默认收起，`details.more` 默认收起，点「严格」后 `mode=council panel=3 critique=true arbiter=true`，点「省 token」后 `mode=single panel=1`，providers 3 行保留。

### v1.1.1（2026-11-15）修复"点设置没反应"

- **默认配置补齐 guard / apply / engine 三段**（共 15 个字段）。此前代码里 `Cfg.get('guard.minDelay')` 一直靠 fallback 兜着，但 v1.1.0 新增的设置面板直接读 `c.guard.minDelay`，抛 `TypeError: Cannot read properties of undefined (reading 'minDelay')`，`openConfig()` 整个中断 → ⚙ 点击无任何反应。现 `DEFAULT_CONFIG` 为这些路径提供实体默认值，`Cfg.set` 也不再凭空建段。
- **设置窗改为挂到 shadow 根**。原 `.mask` 嵌在 `.wrap > .panel` 内：panel 收起时 `display:none`，展开时又被 46px 宽的 `.wrap` 夹住，实测 `.dlg` 尺寸 0×0（`getBoundingClientRect` 全零），看得见遮罩却点不到任何控件。现在 `mount()` 把 `#mask` 提升为 shadowRoot 直接子节点，`.mask` 用 `position:fixed;inset:0`，`.dlg` 用 `position:fixed` + 视口居中 `min(560px,92vw) × min(680px,86vh)`。
- 07-ui.js 渲染设置面板时对 `guard` / `apply` 逐段 `Object.assign({}, DEFAULT, saved)` 兜底，任何一段缺失都不再影响面板打开。
- tools/test-dom.js 新增用例 [11]：断言三段存在、13 条 `Cfg.get` 路径都有实体默认值、`mergeDeep` 对缺段老配置补默认且不覆盖已有值。断言数 51 → **57**。
- 新增调试工具：tools/cdp.js（CDP 控制器：targets/goto/eval/shot/inject/reload）、tools/watch.js（导航跟随注入守护）、tools/shim.js（GM_* 垫片，供纯 CDP 环境跑 userscript）。

### 2026-11-15 · v1.1.0 读图与自定义模型

- 新增 `src/03b-vision.js`：图片抓取（GM_xmlhttpRequest 带 Referer / fetch credentials:include）→ blob→data URL（FileReader，兜底 arrayBuffer+btoa 分块）→ canvas 缩放压缩（长边 1400 / JPEG 0.82）→ 10 分钟缓存；`prepare` 丢弃占位图与超限图；`transcribe` 用读图模型转写成结构化文字。
- `01-core`：新增 `CXAI.PRESETS` 10 条接入预设（含 magpie `127.0.0.1:3425/v1`、Ollama、LM Studio、qwen-vl、glm-4v）、`CXAI.isLocalURL`、`CXAI.normalizeProvider`；`ai.vision` 从布尔升级为对象（strategy/maxImages/maxEdge/quality/maxTotalBytes/ocrProviderId/cacheSize）；`Cfg` 新增 `allProviders()` 与 `visionProviders()`，`activeProviders()` 排除纯读图模型。
- `04-ai`：`buildRequest` 支持 OpenAI / Anthropic / Gemini 三风格（system 提升、图片块格式、`extraBody`/`extraHeaders` 深合并），`extractText` 对应三种响应；`resolveVision` 实现 auto/inline/ocr/off 四策略；`solve()` 结果带 `vision{...}` 元信息；读图上下文注入三个 Prompt。
- `07-ui`：provider 行重写（预设下拉自动填、接口风格、角色、空 Key、maxTokens、extraBody/extraHeaders）；新增读图设置块（开关/策略/专模型/最多图数/长边/质量）；测试连接区分 `[判题]/[读图]/[判题+读图]`。
- 测试：`tools/test-dom.js` 断言 30 → 51，新增自定义模型归一、三风格响应、ocr 转写通道、inline 直传、strategy=off 兜底；fetch 模拟改为按 URL 识别风格。`tools/check.js` 契约表纳入 `03b-vision.js`。
- 构建产物：`dist/cx-exam-ai.user.js` 146.2 KB / 3908 行。

### 2026-11-15 · v1.0.0 首版

- 建立 8 模块架构与零依赖拼接构建（`build.js` + `tools/check.js`），产物 `dist/cx-exam-ai.user.js` 105 KB / 2932 行。
- `03-scraper`：整卷/章节双结构解析，题型 12 项映射表，`cleanStem` 去题型前缀与分值。
- `02-font`：FRB2 特征表 + 360px 渲染 + 积分图降采样的字形还原。
- `04-ai`：议会/快速/单模型三模式；Round1 并行作答 → Round2 交叉复核（×1.2）→ Round3 仲裁（×1.5）；答案四级映射（字母/文本精确/判断词表/相似度）。
- `05-apply`：完整指针事件序列 + 随机落点 + 候选元素逐级重试 + `input.checked` 兜底。
- `06-guard`：`document.hidden`/`hasFocus` 伪装、可见性事件拦截、`confirm` 接管、弹窗白名单（排除交卷类按钮）、节奏抖动。
- `07-ui`：Shadow DOM 控制台，模型配置表单支持增删与连通性测试。
- `08-main`：整卷遍历与单题翻页双模式，会话缓存，暂停/停止，可选自动交卷。
- 修复：`.answerBg .answer_p` 与 `.textDIV` 嵌套重复导致选项数翻倍（改为保留最外层容器）。
- 修复：选中态只查父级导致 `.textDIV` 引用拿不到 `.answer_p` 上的勾（改为自身/父级/祖父级三层）。
- 测试：`tools/test-dom.js` 自建 DOM 垫片 + fetch 模拟，30 项断言覆盖抓题/映射/点选/填空/三级收敛/节奏，全绿。
