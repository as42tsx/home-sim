/**
 * Tiny locale loader. Does not fetch on import.
 * Message files live at the repo root (`i18n/zh.json`, `i18n/en.json`).
 */

const cache = new Map();

/**
 * @param {'zh'|'en'} [lang]
 * @returns {Promise<Record<string, string>>}
 */
export async function loadLocale(lang = 'zh') {
  if (cache.has(lang)) return cache.get(lang);
  const file = lang === 'en' ? 'en.json' : 'zh.json';
  const url = new URL(`../../i18n/${file}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法读取文案 ${file}（${res.status}）`);
  const data = await res.json();
  cache.set(lang, data);
  return data;
}

/**
 * @param {Record<string, string>|null|undefined} messages
 * @param {string} key
 */
export function translate(messages, key) {
  return messages?.[key] ?? key;
}
