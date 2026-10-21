// ==UserScript==
// @name         115 PotPlayer
// @namespace    local.115.potplayer
// @version      1.0.0
// @description  Open a single video from the 115 context menu in PotPlayer.
// @author       ZiPenOk
// @match        *://115.com/*
// @match        *://*.115.com/*
// @match        *://115cdn.com/*
// @match        *://*.115cdn.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      webapi.115.com
// @connect      proapi.115.com
// @license      GPL-3.0-only
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.0';
    const TAG = '[115 PotPlayer]';
    const ENTRY_ID = 'p115-potplayer-menu';
    const OWNER_ATTRIBUTE = 'data-p115-potplayer-owner';
    const MESSAGE = 'p115-potplayer-context-v1';
    const ROWS = 'li[rel="item"],.file-list-item,.file-item,[role="row"],[file_id],[fid],[data-file-id],[data-fid],[pick_code],[pickcode],[data-pick-code],[data-pickcode]';
    const MENUS = '#js_float_content,.context-menu';
    const VIDEO_EXTENSIONS = new Set('mp4 mkv avi wmv mov m4v ts mts m2ts flv f4v rm rmvb webm mpg mpeg mpe vob 3gp 3g2 asf ogv divx m2v mpeg4'.split(' '));
    const WORDS = {
        open: '\u4f7f\u7528 PotPlayer \u6253\u5f00',
        loading: '\u6b63\u5728\u83b7\u53d6\u64ad\u653e\u5730\u5740...',
        copied: '\u64ad\u653e\u547d\u4ee4\u5df2\u590d\u5236',
        launch: '\u6253\u5f00 PotPlayer',
        failed: 'PotPlayer \u64ad\u653e\u5931\u8d25',
        diagnostics: '115 PotPlayer: \u590d\u5236\u8bca\u65ad\u4fe1\u606f',
        diagnosticCopied: '\u8bca\u65ad\u4fe1\u606f\u5df2\u590d\u5236',
        missing: '\u672a\u53d6\u5f97 file_id / pickcode\uff0c\u8bf7\u5728\u811a\u672c\u83dc\u5355\u4e2d\u590d\u5236\u8bca\u65ad\u4fe1\u606f',
        notVideo: '\u6587\u4ef6\u4e0d\u662f\u53ef\u8bc6\u522b\u7684\u89c6\u9891',
    };
    const documents = new Set();
    const metadataCache = new Map();
    let context = null;
    let generation = 0;
    let scheduled = false;
    let playing = false;
    let lastDiagnostic = { reason: 'No right-click captured yet' };

    function log(message, detail) {
        console.info(TAG, message, detail || '');
    }

    function first(object, keys) {
        for (const key of keys) {
            const value = object[key];
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return undefined;
    }

    function flag(value) {
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
        return undefined;
    }

    function normalize(raw, api = false) {
        const fileId = String(first(raw, ['file_id', 'fileId', 'fid']) || (/^\d+$/.test(raw.id) ? raw.id : ''));
        const pickcode = String(first(raw, ['pick_code', 'pickcode', 'pickCode', 'pc']) || '');
        const name = String(first(raw, ['file_name', 'fileName', 'name', 'n', 'fn', 'title']) || '').trim();
        const category = first(raw, ['file_type', 'file_category', 'fc']);
        const icon = String(first(raw, ['ico', 'icon']) || '');
        const folder = flag(first(raw, ['is_dir', 'is_directory', 'is_folder', 'isDir', 'isFolder']));
        const isDir = folder === true || String(category) === '0' || /(^|[-_\/])folder([._\/]|$)/i.test(icon)
            || (api && raw.cid !== undefined && !fileId);
        const video = flag(first(raw, ['is_video', 'isVideo', 'iv', 'isv']));
        const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
        const isVideo = !isDir && (video === true || VIDEO_EXTENSIONS.has(extension) || /(^|[-_\/])video([._\/]|$)/i.test(icon));
        return { fileId, pickcode, name, isDir, isVideo };
    }

    function findRow(target) {
        if (!target || target.nodeType !== 1 || target.closest(MENUS)) return null;
        const row = target.closest(ROWS);
        if (row) return row;
        const generic = target.closest('li,tr');
        return generic?.querySelector('.file-name,.file-name-responsive') ? generic : null;
    }

    function selectedRows(doc) {
        const selected = new Set();
        doc.querySelectorAll(ROWS).forEach(row => {
            if (row.closest(MENUS)) return;
            if (row.matches('.selected,.is-selected,.checked,[aria-selected="true"],[selected="true"],[selected="selected"]')
                || row.querySelector('input[type="checkbox"]:checked')) selected.add(row);
        });
        return [...selected].filter(row => ![...selected].some(other => other !== row && other.contains(row)));
    }

    function readRow(row) {
        const raw = {};
        try {
            const page = row.ownerDocument.defaultView === window && typeof unsafeWindow !== 'undefined'
                ? unsafeWindow : row.ownerDocument.defaultView;
            const data = page.jQuery?.(row).data();
            if (data && typeof data === 'object') Object.assign(raw, data.file || data.item || data);
        } catch { /* DOM attributes remain available if the page's JS is isolated. */ }
        for (const attribute of row.attributes) {
            const key = attribute.name.replace(/^data-/, '').replace(/-/g, '_');
            raw[key] = attribute.value;
        }
        for (const key of ['file', 'item', 'info']) {
            try {
                const value = row.getAttribute(`data-${key}`);
                if (value) Object.assign(raw, JSON.parse(value));
            } catch { /* Ignore attributes which do not contain JSON. */ }
        }
        const nameNode = row.querySelector('.file-name-responsive,.file-name .name,.file-name [title],.file-name,[data-file-name]');
        raw.file_name = first(raw, ['file_name', 'filename', 'fileName', 'name', 'n', 'fn'])
            || nameNode?.getAttribute('title') || nameNode?.textContent.trim() || row.getAttribute('title') || '';
        if (row.querySelector('img[src*="/folder."],img[src*="/folder/"],.ico-folder,.icon-folder,img[alt="\u6587\u4ef6\u5939"]')) raw.is_dir = true;
        if (row.querySelector('.ico-video,.icon-video,[class*="file-type-video"]')) raw.is_video = true;
        if (!first(raw, ['pick_code', 'pickcode', 'pickCode', 'pc'])) {
            for (const link of row.querySelectorAll('a[href]')) {
                try {
                    const url = new URL(link.getAttribute('href'), row.ownerDocument.URL);
                    const code = url.searchParams.get('pickcode') || url.searchParams.get('pick_code');
                    if (code) { raw.pickcode = code; break; }
                } catch { /* Ignore non-URL actions. */ }
            }
        }
        return { file: normalize(raw), attributes: Object.fromEntries([...row.attributes].map(attribute => [attribute.name, attribute.value])) };
    }

    function requestJSON(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: 20000,
                anonymous: false,
                ...options,
                onload(response) {
                    try {
                        if (response.status < 200 || response.status >= 300) throw new Error(`115 HTTP ${response.status}`);
                        const payload = JSON.parse(response.responseText);
                        if (flag(payload.state) === false) throw new Error(String(payload.msg || payload.message || payload.error || `115 errno ${payload.errno || payload.errNo || 0}`));
                        resolve(payload);
                    } catch (error) { reject(error); }
                },
                onerror: () => reject(new Error('115 request failed')),
                ontimeout: () => reject(new Error('115 request timed out')),
                onabort: () => reject(new Error('115 request aborted')),
            });
        });
    }

    function fileInfo(fileId) {
        if (!/^\d+$/.test(fileId)) return Promise.reject(new Error('Invalid 115 file_id'));
        const cached = metadataCache.get(fileId);
        if (cached && Date.now() - cached.time < 60000) return cached.promise;
        const promise = requestJSON({
            method: 'GET',
            url: `https://webapi.115.com/files/get_info?file_id=${encodeURIComponent(fileId)}`,
            headers: { Referer: 'https://115.com/' },
        }).then(payload => {
            const data = payload.data;
            const raw = Array.isArray(data) ? data.find(item => String(item.file_id || item.fid || item.id) === fileId) || data[0]
                : data?.file_info || data;
            if (!raw || typeof raw !== 'object') throw new Error('115 returned no file metadata');
            const file = normalize(raw, true);
            if (file.fileId && file.fileId !== fileId) throw new Error('115 returned metadata for a different file');
            return file;
        }).catch(error => { metadataCache.delete(fileId); throw error; });
        if (metadataCache.size >= 100) metadataCache.delete(metadataCache.keys().next().value);
        metadataCache.set(fileId, { time: Date.now(), promise });
        return promise;
    }

    async function completeFile(file) {
        if (file.isDir || (file.isVideo && file.pickcode) || !file.fileId) return file;
        const info = await fileInfo(file.fileId);
        return {
            fileId: info.fileId || file.fileId,
            pickcode: info.pickcode || file.pickcode,
            name: info.name || file.name,
            isDir: info.isDir || file.isDir,
            isVideo: !info.isDir && (info.isVideo || file.isVideo),
        };
    }

    function is115Origin(origin) {
        try { return /(^|\.)(115\.com|115cdn\.com)$/.test(new URL(origin).hostname); }
        catch { return false; }
    }

    function relay(file, sourceWindow, diagnostic) {
        if (sourceWindow.parent === sourceWindow || sourceWindow.parent === window) return;
        sourceWindow.parent.postMessage({ type: MESSAGE, file, diagnostic }, '*');
    }

    function chooseFile(file, diagnostic, sourceWindow = window) {
        const token = ++generation;
        context = file ? { file, token } : null;
        lastDiagnostic = diagnostic;
        log('right-click', diagnostic);
        relay(file, sourceWindow, diagnostic);
        scheduleSync();
        if (!file || file.isDir) return;
        completeFile(file).then(resolved => {
            if (context?.token !== token) return;
            context.file = resolved;
            lastDiagnostic.resolved = resolved;
            log('file resolved', resolved);
            scheduleSync();
        }).catch(error => {
            if (context?.token !== token) return;
            lastDiagnostic.error = error.message;
            console.warn(TAG, 'metadata lookup failed', error.message);
        });
    }

    function handleContext(event, doc) {
        const target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
        if (target?.closest(MENUS)) return;
        const selected = selectedRows(doc);
        const row = findRow(target) || (target?.closest('#js_data_list,#js_file_list,.file-list,[role="grid"]') && selected.length === 1 ? selected[0] : null);
        if (!row || (selected.length > 1 && selected.some(item => item === row || item.contains(row)))) {
            chooseFile(null, { reason: row ? 'Multiple files selected' : 'File row not found', selected: selected.length, target: target?.tagName, className: target?.className }, doc.defaultView);
            return;
        }
        const result = readRow(row);
        chooseFile(result.file, { reason: 'File row captured', selected: selected.length, file: result.file, attributes: result.attributes }, doc.defaultView);
    }

    function isVisible(node) {
        const view = node.ownerDocument.defaultView;
        const style = view.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    }

    function removeEntries() {
        for (const doc of documents) doc.querySelectorAll(`#${ENTRY_ID}`).forEach(entry => entry.remove());
    }

    function clearContext() {
        ++generation;
        context = null;
        removeEntries();
    }

    function syncMenus() {
        scheduled = false;
        for (const doc of documents) {
            if (!doc.defaultView || !doc.documentElement) { documents.delete(doc); continue; }
            for (const menu of doc.querySelectorAll(MENUS)) {
                const list = menu.querySelector('.cell-icon > ul') || menu.querySelector(':scope > ul');
                const existing = menu.querySelector(`#${ENTRY_ID}`);
                if (!list || !isVisible(menu) || !context?.file.isVideo || context.file.isDir) {
                    existing?.remove();
                    continue;
                }
                let entry = existing;
                if (!entry) {
                    entry = doc.createElement('li');
                    entry.id = ENTRY_ID;
                    entry.setAttribute('data-p115-action', 'potplayer');
                    const link = doc.createElement('a');
                    link.href = '#';
                    const icon = doc.createElement('i');
                    icon.className = 'icon-operate ifo-video-play';
                    const label = doc.createElement('span');
                    label.textContent = WORDS.open;
                    link.append(icon, label);
                    entry.append(link);
                    const anchor = list.querySelector('li[val="view"],li[val="player"]');
                    if (anchor) anchor.after(entry);
                    else list.prepend(entry);
                    log('menu injected', { name: context.file.name, frame: doc.location.origin });
                    const box = menu.getBoundingClientRect();
                    if (box.bottom > doc.defaultView.innerHeight) menu.style.top = `${Math.max(0, menu.offsetTop - (box.bottom - doc.defaultView.innerHeight) - 8)}px`;
                }
                entry.p115File = { ...context.file };
            }
        }
    }

    function scheduleSync() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(syncMenus, 0);
    }

    function bindDocument(doc) {
        if (!doc.documentElement || doc.documentElement.hasAttribute(OWNER_ATTRIBUTE)) return;
        doc.documentElement.setAttribute(OWNER_ATTRIBUTE, VERSION);
        documents.add(doc);
        log('started', { version: VERSION, frame: doc.location.origin + doc.location.pathname });
        doc.addEventListener('contextmenu', event => handleContext(event, doc), true);
        for (const type of ['pointerdown', 'mousedown']) {
            doc.addEventListener(type, event => {
                if (!event.target.closest?.(`#${ENTRY_ID}`)) return;
                event.preventDefault();
                event.stopImmediatePropagation();
            }, true);
        }
        doc.addEventListener('click', event => {
            const entry = event.target.closest?.(`#${ENTRY_ID}`);
            if (entry) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const file = entry.p115File;
                const menu = entry.closest(MENUS);
                if (menu) menu.style.display = 'none';
                clearContext();
                play(file, doc);
            } else if (!event.target.closest?.(MENUS)) {
                clearContext();
                relay(null, doc.defaultView);
            }
        }, true);
        doc.addEventListener('keydown', event => {
            if (event.key === 'Escape') { clearContext(); relay(null, doc.defaultView); }
        }, true);
        const observer = new MutationObserver(records => {
            if (context || records.some(record => record.target.nodeType === 1 && record.target.closest(MENUS))) scheduleSync();
            if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('iframe,frame') || node.querySelector('iframe,frame'))))) scanFrames(doc);
        });
        observer.observe(doc, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
        scanFrames(doc);
    }

    function scanFrames(doc) {
        for (const frame of doc.querySelectorAll('iframe,frame')) {
            const attach = () => {
                try { if (frame.contentDocument) bindDocument(frame.contentDocument); }
                catch { /* Cross-origin frames run their own matching userscript. */ }
            };
            if (!frame.p115LoadBound) { frame.p115LoadBound = true; frame.addEventListener('load', attach); }
            attach();
        }
    }

    window.addEventListener('message', event => {
        if (event.data?.type !== MESSAGE || !is115Origin(event.origin)) return;
        if (![...document.querySelectorAll('iframe,frame')].some(frame => frame.contentWindow === event.source)) return;
        const raw = event.data.file;
        const file = raw && typeof raw === 'object' ? {
            fileId: String(raw.fileId || ''), pickcode: String(raw.pickcode || ''), name: String(raw.name || ''),
            isDir: raw.isDir === true, isVideo: raw.isVideo === true,
        } : null;
        chooseFile(file, { reason: 'Frame context received', origin: event.origin, file, frame: event.data.diagnostic });
    });

    function toast(doc, message, action) {
        doc.getElementById('p115-potplayer-toast')?.remove();
        const box = doc.createElement('div');
        box.id = 'p115-potplayer-toast';
        box.setAttribute('role', 'status');
        box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);padding:12px 16px;background:#fff;color:#1a2734;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 12px #0003;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere;';
        const text = doc.createElement('span');
        text.textContent = message;
        box.append(text);
        if (action) {
            const button = doc.createElement('button');
            button.textContent = WORDS.launch;
            button.style.cssText = 'display:block;margin-top:8px;padding:4px 10px;cursor:pointer;';
            button.addEventListener('click', action);
            box.append(button);
        }
        (doc.body || doc.documentElement).append(box);
        setTimeout(() => box.remove(), action ? 20000 : 7000);
    }

    async function play(file, doc) {
        if (playing) return;
        playing = true;
        try {
            toast(doc, WORDS.loading);
            file = await completeFile(file);
            if (!file.isVideo || file.isDir) throw new Error(WORDS.notVideo);
            if (!file.pickcode) throw new Error(WORDS.missing);
            const timestamp = Math.floor(Date.now() / 1000);
            const payload = await requestJSON({
                method: 'POST',
                url: `https://proapi.115.com/app/chrome/downurl?t=${timestamp}`,
                data: `data=${encodeURIComponent(encodeRequest(JSON.stringify({ pickcode: file.pickcode })))}`,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://115.com/', 'User-Agent': navigator.userAgent },
            });
            if (typeof payload.data !== 'string') throw new Error('115 returned no encrypted download data');
            const decoded = JSON.parse(decodeResponse(payload.data));
            const record = decoded[file.fileId] || Object.values(decoded).find(item => item?.url?.url);
            if (!record?.url?.url) throw new Error('115 returned no playable URL');
            const url = new URL(record.url.url);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('115 returned an invalid download URL');
            const clean = value => String(value || '').replace(/["\r\n]/g, ' ').trim();
            const directUrl = url.href.replace(/[\s"<>]/g, char => encodeURIComponent(char));
            const command = [`potplayer://${directUrl}`, '/current', `/user_agent="${clean(navigator.userAgent)}"`, '/referer="https://115.com/"', `/title="${clean(file.name)}"`].join(' ');
            await Promise.resolve(GM_setClipboard(command, 'text'));
            const launch = () => doc.defaultView.open('potplayer:///current/clipboard', '_self');
            launch();
            toast(doc, `${WORDS.copied}: ${file.name}`, launch);
            log('play command prepared', { name: file.name });
        } catch (error) {
            console.error(TAG, 'playback failed', error.message);
            lastDiagnostic.playbackError = error.message;
            toast(doc, `${WORDS.failed}: ${error.message}`);
        } finally { playing = false; }
    }

    // 115 uses RSA plus two XOR stages. The fixed zero request key is supported
    // by p115rsacipher; no MD5 library or page-global dependency is needed.
    const RSA_N = BigInt('0x8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683');
    const RSA_E = 65537n;
    const G_KTS = [240,229,105,174,191,220,191,138,26,69,232,190,125,166,115,184,222,143,231,196,69,218,134,196,155,100,139,20,106,180,241,170,56,1,53,158,38,105,44,134,0,107,79,165,54,52,98,166,42,150,104,24,242,74,253,189,107,151,143,77,143,137,19,183,108,142,147,237,14,13,72,62,215,47,136,216,254,254,126,134,80,149,79,209,235,131,38,52,219,102,123,156,126,157,122,129,50,234,182,51,222,58,169,89,52,102,59,170,186,129,96,72,185,213,129,156,248,108,132,119,255,84,120,38,95,190,232,30,54,159,52,128,92,69,44,155,118,213,27,143,204,195,184,245];
    const SHORT_KEY = [0x8d, 0xa5, 0xa5, 0x8d];
    const LONG_KEY = [120, 6, 173, 76, 51, 134, 93, 24, 76, 1, 63, 70];

    function xor(source, key) {
        const remainder = source.length % 4;
        return Array.from(source, (value, i) => value ^ key[(i < remainder ? i : i - remainder) % key.length]);
    }

    function modPow(base) {
        let result = 1n;
        let power = RSA_E;
        while (power) {
            if (power & 1n) result = result * base % RSA_N;
            base = base * base % RSA_N;
            power >>= 1n;
        }
        return result;
    }

    function bytesToInteger(bytes) {
        return BigInt('0x' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''));
    }

    function integerToBytes(value) {
        return value.toString(16).padStart(256, '0').match(/../g).map(hex => parseInt(hex, 16));
    }

    function encodeRequest(text) {
        const transformed = xor(xor(new TextEncoder().encode(text), SHORT_KEY).reverse(), LONG_KEY);
        const source = new Array(16).fill(0).concat(transformed);
        const encrypted = [];
        for (let i = 0; i < source.length; i += 117) {
            const chunk = source.slice(i, i + 117);
            const block = new Array(128).fill(2);
            block[0] = 0;
            block[127 - chunk.length] = 0;
            block.splice(128 - chunk.length, chunk.length, ...chunk);
            encrypted.push(...integerToBytes(modPow(bytesToInteger(block))));
        }
        return btoa(String.fromCharCode(...encrypted));
    }

    function decodeResponse(base64) {
        const encrypted = Array.from(atob(base64), char => char.charCodeAt(0));
        if (!encrypted.length || encrypted.length % 128) throw new Error('Invalid 115 RSA response length');
        const source = [];
        for (let i = 0; i < encrypted.length; i += 128) {
            const block = integerToBytes(modPow(bytesToInteger(encrypted.slice(i, i + 128))));
            const separator = block.indexOf(0, 2);
            if (separator < 10) throw new Error('Invalid 115 RSA response padding');
            source.push(...block.slice(separator + 1));
        }
        if (source.length < 16) throw new Error('Invalid 115 response key');
        const key = Array.from({ length: 12 }, (_, i) => ((source[i] + G_KTS[12 * i]) & 255) ^ G_KTS[12 * (11 - i)]);
        return new TextDecoder().decode(Uint8Array.from(xor(xor(source.slice(16), key).reverse(), SHORT_KEY)));
    }

    if (typeof GM_registerMenuCommand === 'function' && window.top === window) {
        GM_registerMenuCommand(WORDS.diagnostics, () => {
            const report = {
                version: VERSION,
                page: location.origin + location.pathname,
                captured: lastDiagnostic,
                documents: [...documents].map(doc => ({ page: doc.location.origin + doc.location.pathname, menus: doc.querySelectorAll(MENUS).length, rows: doc.querySelectorAll(ROWS).length })),
            };
            console.info(TAG, 'diagnostics', report);
            GM_setClipboard(JSON.stringify(report, null, 2), 'text');
            toast(document, WORDS.diagnosticCopied);
        });
    }

    if (document.documentElement) bindDocument(document);
    else {
        const ready = new MutationObserver(() => {
            if (!document.documentElement) return;
            ready.disconnect();
            bindDocument(document);
        });
        ready.observe(document, { childList: true });
    }
})();
