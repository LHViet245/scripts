// Kiểm tra nhanh (smoke test) bằng jsdom: chạy bản upstream và bản đã dựng trên vài trang mẫu,
// so sánh lỗi runtime, số phần tử script chèn vào trang, và bảng cài đặt có còn tiếng Trung không.
//   node test/smoke.mjs              # so laosiji-new.js với upstream (theo config.json)
//   node test/smoke.mjs a.js b.js    # so 2 file bất kỳ (a = gốc, b = bản dựng)
// Không thay được việc thử trên trình duyệt thật (mạng bị chặn, trang mẫu rất tối giản).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const [aPath, bPath] = process.argv.slice(2);
const upstreamCode = aPath ? fs.readFileSync(aPath, 'utf8')
  : execFileSync('git', ['-C', path.resolve(ROOT, '../..'), 'show', `${config.upstream.remote}/${config.upstream.branch}:${config.upstream.file}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
const builtCode = fs.readFileSync(bPath || path.resolve(ROOT, config.output), 'utf8');
const FIXTURES = [
  { name: 'javdb-detail', url: 'https://javdb.com/v/AbCd1', html: `<html lang="zh"><head><title>SSIS-001 test</title></head><body><nav class="navbar"><div class="navbar-start"></div><div class="navbar-end"></div></nav><section class="section"><div class="container"><div class="video-detail"><h2 class="title is-4"><strong>SSIS-001 </strong><strong class="current-title">テストタイトル</strong></h2><div class="video-meta-panel"><div class="columns"><div class="column column-video-cover"><a href="#"><img class="video-cover" src="https://c0.jdbstatic.com/covers/ab/AbCd1.jpg"></a></div><div class="column"><nav class="panel movie-panel-info"><div class="panel-block first-block"><strong>番號:</strong>&nbsp;<span class="value"><a href="/video_codes/SSIS">SSIS</a>-001</span><a class="button is-white copy-to-clipboard" data-clipboard-text="SSIS-001"></a></div><div class="panel-block"><strong>日期:</strong>&nbsp;<span class="value">2024-01-01</span></div><div class="panel-block"><strong>演員:</strong>&nbsp;<span class="value"><a href="/actors/x1">テスト</a><strong class="symbol female">♀</strong></span></div></nav></div></div></div><div class="video-detail-tabs"><div class="tabs"><ul><li class="is-active" data-movie-tab-target="magnets"><a>磁鏈</a></li><li data-movie-tab-target="reviews"><a>短評</a></li></ul></div></div><div id="magnets-content"></div></div></div></section></body></html>` },
  { name: 'javdb-list', url: 'https://javdb.com/', html: `<html lang="zh"><head><title>JavDB</title></head><body><nav class="navbar"><div class="navbar-start"></div></nav><div class="movie-list h cols-4 vcols-8">${Array.from({ length: 6 }, (_, i) => `<div class="item"><a href="/v/X${i}" class="box" title="title ${i}"><div class="cover"><img src="https://c0.jdbstatic.com/thumbs/x/X${i}.jpg"></div><div class="video-title"><strong>ABC-00${i}</strong> テスト ${i}</div><div class="score"><span class="value">4.${i}分, 由${i}0人評價</span></div><div class="meta">2024-01-0${i + 1}</div></a></div>`).join('')}</div><nav class="pagination"><a class="pagination-next" href="/?page=2">下一頁</a></nav></body></html>` },
  { name: 'javbus-detail', url: 'https://www.javbus.com/SSIS-001', html: `<html lang="zh-cn"><head><title>SSIS-001 test - JavBus</title></head><body><div class="container"><h3>SSIS-001 テストタイトル</h3><div class="row movie"><div class="col-md-9 screencap"><a class="bigImage" href="/pics/cover/abc_b.jpg"><img src="/pics/cover/abc_b.jpg"></a></div><div class="col-md-3 info"><p><span class="header">識別碼:</span> <span style="color:#CC0000;">SSIS-001</span></p><p><span class="header">發行日期:</span> 2024-01-01</p></div></div><h4>磁力連結投稿</h4><table id="magnet-table"></table></div></body></html>` },
  { name: 'javlibrary-detail', url: 'https://www.javlibrary.com/cn/?v=javme1', html: `<html lang="zh-CN"><head><title>SSIS-001 テスト - JAVLibrary</title></head><body><div id="topmenu"><div class="advsearch"></div></div><div id="leftmenu"><ul class="menul1"></ul></div><div id="video_title"><h3 class="post-title text"><a href="#">SSIS-001 テスト</a></h3></div><div id="video_id"><table><tr><td class="header">识别码:</td><td class="text">SSIS-001</td></tr></table></div><div id="video_jacket"><img id="video_jacket_img" src="https://pics.dmm.co.jp/x.jpg"></div></body></html>` },
];

async function run(code) {
const results = {};
for (const fx of FIXTURES) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + String(e.message || e).split('\n')[0]));
  vc.on('error', (...a) => { const s = a.map(String).join(' '); if (!/Not implemented/.test(s)) errors.push('console.error: ' + s.slice(0, 200)); });
  const dom = new JSDOM(fx.html, { url: fx.url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const store = new Map();
  const menus = [];
  Object.assign(w, {
    GM_getValue: (k, d) => (store.has(k) ? store.get(k) : d),
    GM_setValue: (k, v) => store.set(k, v),
    GM_deleteValue: k => store.delete(k),
    GM_listValues: () => [...store.keys()],
    GM_setClipboard: () => {}, GM_download: () => {}, GM_openInTab: () => {},
    GM_registerMenuCommand: name => { menus.push(name); return menus.length; },
    GM_xmlhttpRequest: opts => { setTimeout(() => opts.onerror?.({ status: 0, error: 'offline' }), 5); return { abort() {} }; },
    GM_info: { script: { version: 'test' } },
    Hls: function Hls() {},
    matchMedia: q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    scrollTo: () => {}, scrollBy: () => {},
  });
  w.unsafeWindow = w;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.addEventListener('error', e => errors.push('window.error: ' + (e.error?.stack || e.message || '').split('\n').slice(0, 2).join(' | ')));
  w.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' | ')));
  try {
    w.eval(code.replace(/^﻿/, ''));
  } catch (e) {
    errors.push('eval: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | '));
  }
  await new Promise(r => setTimeout(r, 2500));
  let settings = null;
  if (fx.name === 'javdb-list') {
    try {
      const open = w.__LAOSIJI_OPEN_SETTINGS__ || w.top.__LAOSIJI_OPEN_SETTINGS__;
      if (typeof open === 'function') open();
      await new Promise(r => setTimeout(r, 500));
      const panel = w.document.querySelector('#jav-settings-panel');
      if (panel) settings = {
        nav: [...panel.querySelectorAll('.sp-nav [data-sp-tab], .sp-nav button, .sp-nav a')].map(b => b.textContent.trim()),
        langRow: !!panel.querySelector('#sp-title-translate-lang'),
        cjk: [...new Set((panel.textContent.match(/[\u4e00-\u9fff]{1,}[^<\n]{0,10}/g) || []))].slice(0, 30),
        sample: panel.textContent.replace(/\s+/g, ' ').slice(0, 600),
      };
      else settings = { error: 'panel not found', open: typeof open };
    } catch (e) { settings = { error: String(e) }; }
  }
  const text = w.document.body?.textContent || '';
  const injected = w.document.querySelectorAll('[class*="jav-"], [class*="laosiji"], [id^="jav-"]').length;
  const cjk = [...new Set((text.match(/[一-鿿]{2,}/g) || []))];
  results[fx.name] = { errors: [...new Set(errors)], menus, injected, bodyCjkSample: cjk.slice(0, 15), settings };

}
return results;
}

const up = await run(upstreamCode);
const vi = await run(builtCode);
let fail = 0;
for (const name of Object.keys(vi)) {
  const a = up[name], b = vi[name];
  const newErrors = b.errors.filter(e => !a.errors.includes(e));
  const ok = !newErrors.length && b.injected >= a.injected;
  if (!ok) fail += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}: lỗi ${a.errors.length}→${b.errors.length}, phần tử chèn ${a.injected}→${b.injected}`);
  newErrors.forEach(e => console.log('    lỗi mới:', e.slice(0, 300)));
  if (b.settings) {
    const s = b.settings;
    const sOk = !s.error && s.langRow && !s.cjk.length && s.nav.length > 0;
    if (!sOk) fail += 1;
    console.log(`${sOk ? '✓' : '✗'} bảng cài đặt: ${s.error || `tab [${s.nav.join(', ')}], ô ngôn ngữ dịch: ${s.langRow ? 'có' : 'KHÔNG'}, chữ Trung còn sót: ${s.cjk.length ? s.cjk.join(' | ') : 'không'}`}`);
  }
}
console.log(fail ? `\n${fail} kiểm tra thất bại` : '\nTất cả kiểm tra đạt');
process.exit(fail ? 1 : 0);
