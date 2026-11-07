#!/usr/bin/env node
// Dựng laosiji-new.js (bản Việt hoá, tắt 115) từ bản build upstream.
//
//   node build.mjs                 # lấy upstream/main:<file> trong config.json, ghi ra laosiji-new.js
//   node build.mjs --src path.js   # dùng một file upstream cụ thể
//   node build.mjs --report-only   # chỉ in báo cáo, không ghi file
//   node build.mjs --strict        # dừng (exit 1) nếu còn cụm chưa dịch / chuỗi so sánh chưa phân loại
//
// Báo cáo chi tiết: out/missing.json (cụm chưa dịch), out/undecided.json (chuỗi so sánh chưa phân loại).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { translate, sameShape, parse } from './lib/i18n.mjs';
import { applyPatches } from './patches.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const config = readJson('config.json');

// ---------- 1. nguồn upstream ----------
let source, sourceRef;
if (opt('--src')) {
  source = fs.readFileSync(opt('--src'), 'utf8');
  sourceRef = { file: opt('--src') };
} else {
  const { remote, branch, file } = config.upstream;
  const ref = `${remote}/${branch}`;
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  source = git('show', `${ref}:${file}`);
  sourceRef = { ref, file, commit: git('rev-parse', ref).trim(), commitDate: git('log', '-1', '--format=%cI', ref, '--', file).trim() };
}
source = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
const headerEnd = source.indexOf('// ==/UserScript==');
if (headerEnd < 0) throw new Error('Không tìm thấy header userscript');
const headerSrc = source.slice(0, headerEnd + '// ==/UserScript=='.length);
const body = source.slice(headerSrc.length);

// ---------- 2. header ----------
const upVersion = (headerSrc.match(/^\/\/ @version\s+(\S+)/m) || [])[1];
if (!upVersion) throw new Error('Không đọc được @version upstream');
const version = config.revision ? `${upVersion}-vi.${config.revision}` : `${upVersion}-vi`;
const H = config.header;
const dropMatch = new RegExp(H.dropMatch);
const override = { name: H.name, namespace: H.namespace, version, description: H.description, homepageURL: H.homepageURL, supportURL: H.supportURL, downloadURL: H.downloadURL, updateURL: H.updateURL };
const headerLines = [];
for (const line of headerSrc.split('\n')) {
  const m = line.match(/^\/\/ @(\S+)(\s+)(.*)$/);
  if (!m) { headerLines.push(line); continue; }
  const [, key, , value] = m;
  if (/^(name|description):/.test(key)) continue;            // bỏ bản dịch tên/mô tả kiểu name:zh-CN
  if ((key === 'match' || key === 'include') && dropMatch.test(value)) continue;
  if (key in override) {
    if (override[key] === null) continue;
    headerLines.push(`// @${key.padEnd(12)} ${override[key]}`);
    delete override[key];
    continue;
  }
  headerLines.push(line);
}
const missingKeys = Object.entries(override).filter(([, v]) => v);
if (missingKeys.length) {
  const end = headerLines.findIndex(l => l.startsWith('// ==/UserScript=='));
  headerLines.splice(end, 0, ...missingKeys.map(([k, v]) => `// @${k.padEnd(12)} ${v}`));
}
const header = headerLines.join('\n');

// ---------- 3. dịch ----------
const dict = {
  strings: readJson('i18n/strings.json'),
  phrases: readJson('i18n/phrases.json'),
  keep: new Set(readJson('i18n/keep.json')),
  compare: readJson('i18n/compare.json'),
  context: readJson('i18n/context.json'),
};
const t0 = Date.now();
const result = translate(body, dict);
const shape = sameShape(body, result.code);
if (!shape.ok) throw new Error(`Bản dịch làm đổi cấu trúc code: ${shape.reason}`);

// ---------- 4. vá + addon ----------
const patched = applyPatches(result.code, { version, upVersion });
const addonDir = path.join(ROOT, 'addon');
const addons = fs.readdirSync(addonDir).filter(f => f.endsWith('.js')).sort()
  .map(f => `\n// ---- addon: ${f} (tools/laosiji-vi/addon) ----\n` + fs.readFileSync(path.join(addonDir, f), 'utf8').replace(/\r\n/g, '\n'));
const output = `${header}\n${patched.code}${addons.join('')}\n`;
parse(output.slice(header.length)); // ném lỗi nếu cú pháp hỏng

// ---------- 5. báo cáo ----------
const sortMap = m => Object.fromEntries([...m.entries()].sort((a, b) => b[1].count - a[1].count));
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out/missing.json'), JSON.stringify(sortMap(result.missing), null, 1));
fs.writeFileSync(path.join(ROOT, 'out/undecided.json'), JSON.stringify(sortMap(result.undecided), null, 1));
fs.writeFileSync(path.join(ROOT, 'out/phrased.json'), JSON.stringify(Object.fromEntries(result.phrased), null, 1));
const s = result.stats;
console.log(`upstream ${sourceRef.file} ${upVersion}${sourceRef.commit ? ` (${sourceRef.commit.slice(0, 7)})` : ''} → ${version}`);
console.log(`chuỗi có CJK: ${s.strings} | dịch nguyên chuỗi: ${s.whole} | dịch theo cụm: ${s.phrased} | còn sót cụm: ${s.partial}`);
console.log(`giữ nguyên: ${Object.entries(s.kept).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`cụm chưa dịch: ${result.missing.size} (out/missing.json) | chuỗi so sánh chưa phân loại: ${result.undecided.size} (out/undecided.json)`);
console.log(`bản vá: ${patched.applied.map(p => `${p.name}×${p.count}`).join(', ')}`);
console.log(`cấu trúc code giống upstream: OK | ${Date.now() - t0} ms`);

if (flag('--strict') && (result.missing.size || result.undecided.size)) {
  console.error('--strict: còn chuỗi chưa dịch/chưa phân loại'); process.exit(1);
}
if (!flag('--report-only')) {
  const outFile = path.resolve(ROOT, config.output);
  fs.writeFileSync(outFile, output);
  fs.writeFileSync(path.join(ROOT, 'upstream.lock.json'), JSON.stringify({ ...sourceRef, upstreamVersion: upVersion, builtVersion: version }, null, 2) + '\n');
  console.log(`đã ghi ${path.relative(REPO, outFile)} (${(Buffer.byteLength(output) / 1024).toFixed(0)} KB)`);
}
