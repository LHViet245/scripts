// Ngôn ngữ đích cho "Dịch tiêu đề" (chỉ có ở bản Việt hoá).
// Bản vá title-target-language trong patches.mjs gọi __laosijiViTitleLang() ở đầu hàm targetLanguage của upstream.
// Giá trị "auto" = giữ cách chọn ngôn ngữ của upstream (theo ngôn ngữ trang).
function __laosijiViTitleLang() {
  try {
    const value = String(GM_getValue('title_translate_target_lang', 'vi') || 'vi');
    return value === 'auto' ? '' : value;
  } catch (_) {
    return 'vi';
  }
}

(() => {
  const KEY = 'title_translate_target_lang';
  const OPTIONS = [
    ['vi', 'Tiếng Việt'],
    ['en', 'English'],
    ['zh-CN', 'Tiếng Trung (Giản thể)'],
    ['zh-TW', 'Tiếng Trung (Phồn thể)'],
    ['ko', 'Tiếng Hàn'],
    ['auto', 'Theo ngôn ngữ trang (như upstream)'],
  ];
  const inject = () => {
    const anchor = document.querySelector('#sp-title-translate');
    if (!anchor || document.querySelector('#sp-title-translate-lang')) return;
    const row = anchor.closest('.sp-setting-row');
    if (!row) return;
    const current = (() => { try { return GM_getValue(KEY, 'vi') || 'vi'; } catch (_) { return 'vi'; } })();
    const label = document.createElement('label');
    label.className = 'sp-setting-row';
    label.innerHTML = '<span class="sp-setting-copy"><strong>Ngôn ngữ dịch tiêu đề</strong><small>Áp dụng sau khi tải lại trang</small></span>';
    const select = document.createElement('select');
    select.className = 'sp-select';
    select.id = 'sp-title-translate-lang';
    for (const [value, text] of OPTIONS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === current;
      select.appendChild(option);
    }
    select.addEventListener('change', () => { try { GM_setValue(KEY, select.value); } catch (_) {} });
    label.appendChild(select);
    row.insertAdjacentElement('afterend', label);
  };
  const start = () => {
    inject();
    new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
