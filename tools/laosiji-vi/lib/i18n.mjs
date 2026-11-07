// Bộ máy dịch chuỗi zh → vi trên AST của bản build upstream.
// Chỉ thay nội dung chuỗi (Literal / TemplateElement); không đụng tới cấu trúc code.
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export const CJK = /[぀-ヿ㐀-䶿一-鿿]/;
// Một "cụm" = chuỗi liên tiếp ký tự CJK + dấu câu CJK/fullwidth.
export const RUN = /[぀-ヿ㐀-䶿一-鿿][　-〿぀-ヿ㐀-䶿一-鿿！-～“”‘’…·]*/g;

const COMPARE_METHODS = new Set(['test', 'includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'match', 'matchAll', 'search', 'split', 'has', 'replace', 'replaceAll', 'some', 'every', 'find']);
const SELECTOR_METHODS = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches']);
const LOG_METHODS = new Set(['debug', 'log', 'warn', 'error', 'info', 'trace']);

export function parse(code) {
  return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
}

// Hàm log của upstream là arrow nhỏ chỉ gọi console.* — tên biến bị nén nên phải nhận diện theo nội dung.
function findLoggers(ast, code) {
  const names = new Set();
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier' || !node.init) return;
      let fn = node.init;
      if (fn.type === 'CallExpression' && fn.arguments[0] && /Function/.test(fn.arguments[0].type)) fn = fn.arguments[0];
      if (!/Function/.test(fn.type)) return;
      const text = code.slice(fn.start, fn.end);
      if (text.length < 300 && /console\.(log|warn|error|info|debug)\(/.test(text)) names.add(node.id.name);
    },
  });
  return names;
}

function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) return callee.property.name;
  return '';
}

// Phân loại ngữ cảnh của một chuỗi: key | regex | log | selector | compare | text
function classify(ancestors, loggers) {
  // ancestors: [..., parent, node]
  let node = ancestors[ancestors.length - 1];
  let i = ancestors.length - 2;
  if (node.type === 'TemplateElement') { node = ancestors[i]; i -= 1; } // TemplateLiteral
  // leo qua các nút "trong suốt"
  const skipUp = () => {
    while (i >= 0) {
      const p = ancestors[i];
      if (p.type === 'ConditionalExpression' && p.test !== node) { node = p; i -= 1; continue; }
      if (p.type === 'LogicalExpression') { node = p; i -= 1; continue; }
      if (p.type === 'BinaryExpression' && p.operator === '+') { node = p; i -= 1; continue; }
      if (p.type === 'TemplateLiteral') { node = p; i -= 1; continue; }
      if (p.type === 'ArrayExpression') { node = p; i -= 1; continue; }
      break;
    }
  };
  const parent0 = ancestors[i];
  if (parent0 && (parent0.type === 'Property' || parent0.type === 'MethodDefinition' || parent0.type === 'PropertyDefinition') && parent0.key === node && !parent0.computed) return 'key';
  if (parent0 && parent0.type === 'MemberExpression' && parent0.property === node) return 'key';
  // Mảng toàn chuỗi ngắn (danh sách từ khoá/nhãn để so khớp nội dung trang) → cần quyết định thủ công như chuỗi so sánh.
  if (parent0 && parent0.type === 'ArrayExpression' && parent0.elements.length > 1
    && parent0.elements.every(el => el && el.type === 'Literal' && typeof el.value === 'string' && el.value.length <= 40 && !/[<>]/.test(el.value))) return 'compare';
  skipUp();
  const parent = ancestors[i];
  if (!parent) return 'text';
  // log / RegExp: tìm trong cả chuỗi tổ tiên gần (đối số lồng nhau)
  for (let k = i; k >= Math.max(0, i - 4); k -= 1) {
    const p = ancestors[k];
    if ((p.type === 'CallExpression' || p.type === 'NewExpression')) {
      const name = calleeName(p.callee);
      if (name === 'RegExp') return 'regex';
      const isConsole = p.callee.type === 'MemberExpression' && p.callee.object.type === 'Identifier' && p.callee.object.name === 'console';
      if (isConsole || loggers.has(name) || (p.callee.type === 'MemberExpression' && LOG_METHODS.has(name))) return 'log';
      break;
    }
  }
  if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) return 'compare';
  if (parent.type === 'SwitchCase' && parent.test === node) return 'compare';
  if (parent.type === 'CallExpression') {
    const name = calleeName(parent.callee);
    const isArg = parent.arguments.includes(node);
    const isObject = parent.callee.type === 'MemberExpression' && parent.callee.object === node;
    if (isArg && SELECTOR_METHODS.has(name)) return 'selector';
    if (isArg && COMPARE_METHODS.has(name)) {
      if ((name === 'replace' || name === 'replaceAll') && parent.arguments[0] !== node) return 'text';
      return 'compare';
    }
    if (isObject && COMPARE_METHODS.has(name) && node.type === 'ArrayExpression') return 'compare';
  }
  if (parent.type === 'MemberExpression' && parent.object === node && node.type === 'ArrayExpression') {
    const call = ancestors[i - 1];
    if (call && call.type === 'CallExpression' && COMPARE_METHODS.has(calleeName(call.callee))) return 'compare';
  }
  if (parent.type === 'NewExpression' && calleeName(parent.callee) === 'Set') return 'compare';
  return 'text';
}

const PUNCT = { '：': ': ', '，': ', ', '；': '; ', '！': '! ', '？': '? ', '（': ' (', '）': ') ', '、': ', ', '。': '. ', '「': ' “', '」': '” ', '【': '[', '】': ']' };
// lead/trail = đoạn template này đứng ngay sau / ngay trước một biểu thức \${...}
function normalizePunct(s, lead = false, trail = false) {
  if (!/[：，；！？（）、。「」【】]/.test(s)) return s;
  return s.replace(/\s*([：，；！？（）、。「」【】])\s*/g, (m, ch, off, whole) => {
    let r = PUNCT[ch];
    if ((off === 0 && !lead) || /[\s(“\["'>]$/.test(whole.slice(0, off))) r = r.replace(/^ /, '');
    const rest = whole.slice(off + m.length);
    if ((!rest && !trail) || /^[\s)”\]"'<,.;:!?]/.test(rest)) r = r.replace(/ $/, '');
    return r;
  });
}

const escapeFor = (text, quote) => text
  .replace(/\\/g, '\\\\')
  .replace(quote === '`' ? /`|\$\{/g : new RegExp(quote, 'g'), m => '\\' + m)
  .replace(quote === '`' ? /(?!)/g : /\n/g, '\\n')
  .replace(quote === '`' ? /(?!)/g : /\r/g, '\\r');

/**
 * @param {string} code  nội dung JS (không gồm header userscript)
 * @param {{strings:Object,phrases:Object,keep:Set<string>,compare:Object}} dict
 */
export function translate(code, dict) {
  const ast = parse(code);
  const loggers = findLoggers(ast, code);
  const edits = [];
  const stats = { strings: 0, whole: 0, phrased: 0, partial: 0, kept: {}, runsTranslated: 0 };
  const missing = new Map();   // cụm chưa có bản dịch -> {count, sample}
  const undecided = new Map(); // chuỗi so sánh chưa quyết định -> {count, sample}
  const phrased = new Map();   // chuỗi dịch theo cụm: gốc -> kết quả (để rà soát câu ghép)
  const bump = (m, k, sample) => { const e = m.get(k) || { count: 0, sample }; e.count += 1; m.set(k, e); };

  walk.fullAncestor(ast, (node, _st, ancestors) => {
    let value, rawStart, rawEnd, quote, lead = false, trail = false;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      value = node.value; quote = code[node.start]; rawStart = node.start + 1; rawEnd = node.end - 1;
    } else if (node.type === 'TemplateElement') {
      if (node.value.cooked == null) return;
      value = node.value.cooked; quote = '`'; rawStart = node.start; rawEnd = node.end;
      const tpl = ancestors[ancestors.length - 2];
      lead = tpl.quasis[0] !== node; trail = !node.tail;
    } else return;
    if (!CJK.test(value)) return;
    stats.strings += 1;
    const ctx = classify(ancestors, loggers);
    const keep = why => { stats.kept[why] = (stats.kept[why] || 0) + 1; };
    if (ctx === 'key' || ctx === 'regex' || ctx === 'log' || ctx === 'selector') return keep(ctx);
    if (dict.keep.has(value)) return keep('keep-list');
    if (ctx === 'compare') {
      // Cùng một chuỗi có thể là nhãn UI ở chỗ này nhưng là từ khoá so khớp trang ở chỗ khác:
      // khoá "chuỗi @ a|b|c" (3 phần tử đầu của mảng chứa nó) được ưu tiên hơn khoá "chuỗi".
      const arr = ancestors[ancestors.length - 2];
      const sig = arr && arr.type === 'ArrayExpression' ? arr.elements.slice(0, 3).map(el => (el && el.type === 'Literal' ? String(el.value) : '?')).join('|') : '';
      const sigKey = sig ? `${value} @ ${sig}` : value;
      const decision = dict.compare[sigKey] ?? dict.compare[value];
      if (decision === undefined) { bump(undecided, sigKey, code.slice(Math.max(0, node.start - 80), node.end + 40)); return keep('compare-undecided'); }
      if (decision === 'keep') return keep('compare-keep');
      if (decision !== 'translate') { edits.push({ start: rawStart, end: rawEnd, text: escapeFor(decision, quote) }); stats.whole += 1; return; }
    }
    const raw = code.slice(rawStart, rawEnd);
    let next;
    if (Object.prototype.hasOwnProperty.call(dict.strings, value)) {
      next = escapeFor(dict.strings[value], quote); stats.whole += 1;
    } else {
      let miss = 0;
      // Thay theo ngữ cảnh (i18n/context.json) trước khi dịch từng cụm, vd ">关闭</option>" → ">Tắt</option>".
      let src = raw;
      for (const [from, to] of dict.context || []) if (src.includes(from)) src = src.split(from).join(to);
      next = src.replace(RUN, (run, offset, whole) => {
        if (!Object.prototype.hasOwnProperty.call(dict.phrases, run)) { miss += 1; bump(missing, run, value.slice(0, 160)); return run; }
        stats.runsTranslated += 1;
        let text = dict.phrases[run];
        // Tiếng Trung không dùng dấu cách; khi ghép bản dịch cạnh chữ/số Latin thì phải chèn dấu cách.
        const before = whole[offset - 1] || (lead ? 'x' : ''), after = whole[offset + run.length] || (trail ? 'x' : '');
        if (/[\p{L}\p{N})\]]/u.test(before) && /^[\p{L}\p{N}(]/u.test(text)) text = ' ' + text;
        if (/[\p{L}\p{N}(\[]/u.test(after) && /[\p{L}\p{N}.)…:,;]$/u.test(text)) text += ' ';
        return escapeFor(text, quote);
      });
      // Dấu câu toàn khổ còn sót bên ngoài các cụm (vd "：JavDB", "（…）") → dấu câu ASCII.
      if (!miss) next = normalizePunct(next, lead, trail);
      if (miss) stats.partial += 1; else stats.phrased += 1;
      if (!miss && RUN.test(raw)) phrased.set(value, next);
      RUN.lastIndex = 0;
    }
    if (next !== raw) edits.push({ start: rawStart, end: rawEnd, text: next });
  });

  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, stats, missing, undecided, phrased };
}

// Kiểm tra bản dịch không làm đổi cấu trúc code: so chuỗi token, bỏ qua nội dung chuỗi.
export function sameShape(a, b) {
  const toks = src => {
    const out = [];
    for (const t of acorn.tokenizer(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true })) {
      const isStr = t.type.label === 'string' || t.type.label === 'template';
      out.push(isStr ? t.type.label : `${t.type.label}:${t.value ?? ''}`);
    }
    return out;
  };
  const ta = toks(a), tb = toks(b);
  if (ta.length !== tb.length) return { ok: false, reason: `số token khác nhau ${ta.length} != ${tb.length}` };
  for (let i = 0; i < ta.length; i += 1) if (ta[i] !== tb[i]) return { ok: false, reason: `token #${i}: ${ta[i]} != ${tb[i]}` };
  return { ok: true };
}
