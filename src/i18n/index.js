/**
 * zh is imported with this module so the publish bundle can inline it.
 * en stays a separate fetch, resolved from the page URL (works for src/ and dist/).
 */
import zhMessages from '../../i18n/zh.json' with { type: 'json' };

const cache = new Map();

/**
 * @param {'zh'|'en'} [lang]
 * @returns {Promise<Record<string, string>>}
 */
export async function loadLocale(lang = 'zh') {
  const key = lang === 'en' ? 'en' : 'zh';
  if (cache.has(key)) return cache.get(key);
  if (key === 'zh') {
    const data = { ...zhMessages };
    cache.set('zh', data);
    return data;
  }
  const url = new URL('i18n/en.json', document.baseURI);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法读取文案 en.json（${res.status}）`);
  const data = await res.json();
  cache.set('en', data);
  return data;
}

/**
 * @param {Record<string, string>|null|undefined} messages
 * @param {string} key
 */
export function translate(messages, key) {
  return messages?.[key] ?? key;
}

/**
 * Replace `{name}` placeholders. Missing messages fall back to the key.
 * @param {Record<string, string>|null|undefined} messages
 * @param {string} key
 * @param {Record<string, string|number>|null} [vars]
 */
export function formatMessage(messages, key, vars) {
  let text = messages?.[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
