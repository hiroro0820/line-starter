// 端末の合言葉（2026-10-22）：大元の画面（orbit-package.com/app）が、お客様の受け口を読む・書くための鍵。端末ごとに1つ。
// 置き場はお客様の置き場（CONFIG）だけ。値そのものは置かず、SHA-256 の指紋を「dev:<指紋>」に置く（置き場を見られても使えない）。
// 期限は 400 日。使うたびに（1日1回まで）延ばすので、使っている端末では切れない。設定のページで全部取り消せる。
// 渡し方：受け口が https://orbit-package.com/app/#r=<受け口>&k=<合言葉> へ送る。# の後ろはブラウザの外に出ない（大元のサーバーに届かない）。
export const APP_ORIGIN = 'https://orbit-package.com';
const TTL = 400 * 24 * 3600, DAY = 24 * 3600 * 1000;
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function fingerprint(token) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(token))))].map(x => x.toString(16).padStart(2, '0')).join('');
}

// 呼んでよい画面の住所（大元の画面だけ。試すときは受け口の変数 APP_ORIGINS にカンマ区切りで足せる）
export const allowedOrigins = env => [APP_ORIGIN, ...String((env && env.APP_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean)];

export async function issueDevice(env, now = Date.now()) {
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.CONFIG.put('dev:' + await fingerprint(token), JSON.stringify({ at: now, seen: now }), { expirationTtl: TTL });
  return token;
}

// Authorization: Bearer <合言葉> を確かめる。合えば指紋（既読の置き場の名前に使う）、違えば null
export async function deviceOf(env, req, now = Date.now()) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('authorization') || '');
  if (!m || !env.CONFIG) return null;
  const fp = await fingerprint(m[1]), key = 'dev:' + fp;
  const d = await env.CONFIG.get(key, 'json');
  if (!d) return null;
  if (now - (d.seen || 0) > DAY) await env.CONFIG.put(key, JSON.stringify({ ...d, seen: now }), { expirationTtl: TTL });   // 使うたびに延ばす（1日1回まで）
  return fp;
}

export async function revokeDevices(env) {   // 全部の端末の合言葉を取り消す（漏れたとき）。消した数を返す
  let n = 0, cursor;
  do {
    const r = await env.CONFIG.list({ prefix: 'dev:', cursor });
    for (const k of r.keys) { await env.CONFIG.delete(k.name); await env.CONFIG.delete('read:' + k.name.slice(4)); n++; }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return n;
}

// 画面へ送る住所（新しい合言葉つき）。origin はこの受け口の住所
export async function appLink(env, origin) {
  const token = await issueDevice(env);
  return `${APP_ORIGIN}/app/#r=${encodeURIComponent(origin)}&k=${token}`;
}
