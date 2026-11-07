// Các bản vá áp lên code upstream SAU khi dịch.
// Mỗi bản vá phải khớp đúng số lần mong đợi; nếu upstream đổi code khiến bản vá
// không còn khớp, build sẽ dừng và báo tên bản vá để cập nhật lại.
import * as walk from 'acorn-walk';
import { parse } from './lib/i18n.mjs';

// esbuild giữ tên hàm bằng lời gọi n(fn, "tênGốc"); tìm hàm khai báo theo tên gốc đó.
// Tên biến bị nén (A, B…) dùng lại ở nhiều scope, nên chỉ lấy hàm khai báo cùng khối với lời gọi n(...).
function findNamedFunction(code, originalName) {
  const ast = parse(code);
  const found = [];
  walk.ancestor(ast, {
    CallExpression(node, _st, ancestors) {
      const [fn, name] = node.arguments;
      if (node.arguments.length !== 2 || fn.type !== 'Identifier' || name.type !== 'Literal' || name.value !== originalName) return;
      const block = [...ancestors].reverse().find(a => a.type === 'BlockStatement' || a.type === 'Program');
      for (const stmt of block?.body || []) {
        if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === fn.name) found.push(stmt);
      }
    },
  });
  return found;
}

function insertAtFunctionStart(code, originalName, makeCode) {
  const fns = findNamedFunction(code, originalName);
  if (fns.length !== 1) throw new Error(`không tìm thấy duy nhất hàm "${originalName}" (thấy ${fns.length})`);
  const fn = fns[0];
  const params = fn.params.map(p => (p.type === 'AssignmentPattern' ? p.left.name : p.name));
  const at = fn.body.start + 1;
  return { code: code.slice(0, at) + makeCode(params) + code.slice(at), count: 1 };
}

function replaceExact(code, pattern, replacement, expect) {
  const re = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const count = (code.match(re) || []).length;
  const ok = typeof expect === 'function' ? expect(count) : count === expect;
  if (!ok) throw new Error(`khớp ${count} lần (mong đợi ${typeof expect === 'function' ? 'điều kiện riêng' : expect})`);
  return { code: code.replace(re, replacement), count };
}

export const PATCHES = [
  {
    name: 'pan115-off',
    why: 'Tắt hẳn 115: đổi khoá cài đặt btn_show_pan115 sang một khoá không bao giờ được bật',
    run: code => replaceExact(code, '"btn_show_pan115"', '"laosiji_vi_pan115_disabled"', n => n >= 2),
  },
  {
    name: 'pan115-quick-toggle',
    why: 'Bỏ công tắc "115" trong bảng cài đặt nhanh',
    run: code => replaceExact(code, /\{id:"pan115",label:"[^"]*",cfgKey:"btnShowPan115",sync:"syncPan115"\},?/, '', 1),
  },
  {
    name: 'pan115-settings-tab',
    why: 'Bỏ tab "Cài đặt 115" trong bảng cài đặt',
    run: code => replaceExact(code, /\{id:"pan115",label:"[^"]*"\},?/, '', 1),
  },
  {
    name: 'title-target-language',
    why: 'Cho phép chọn ngôn ngữ đích khi dịch tiêu đề (mặc định tiếng Việt) — xem addon/10-title-language.js',
    run: code => insertAtFunctionStart(code, 'targetLanguage', () => 'const __viLang=__laosijiViTitleLang();if(__viLang)return __viLang;'),
  },
  {
    name: 'title-translate-message-vi',
    why: 'Thông báo "đang dịch / dịch thất bại" bằng tiếng Việt',
    run: code => insertAtFunctionStart(code, 'translateMessage', ([lang, type]) => `if(String(${lang}||"").toLowerCase()==="vi")return ${type}==="error"?"Dịch tiêu đề thất bại":"Đang dịch tiêu đề...";`),
  },
];

export function applyPatches(code) {
  const applied = [];
  for (const p of PATCHES) {
    try {
      const r = p.run(code);
      code = r.code;
      applied.push({ name: p.name, count: r.count });
    } catch (err) {
      throw new Error(`Bản vá "${p.name}" thất bại: ${err.message}\n  → ${p.why}\n  → sửa trong tools/laosiji-vi/patches.mjs`);
    }
  }
  return { code, applied };
}
