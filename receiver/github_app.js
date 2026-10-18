// GitHub につなぐ（2026-10-18）：お客様がボタンを押すと、お客様名義の GitHub App ができる（manifest の流れ）。
// できた App の鍵はお客様の Cloudflare の置き場（KV の CONFIG）だけに入り、担当者には渡らない。
// この App で：Actions を起こす・Issue を書く・リポジトリの秘密の設定（鍵）を暗号化して入れる・下書きのファイルを書く。
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const concat = (...xs) => { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of xs) { out.set(x, i); i += x.length; } return out; };

// GitHub の秘密の設定の暗号（libsodium の sealed box と同じ形）：使い捨ての鍵の組 → nonce = blake2b(使い捨ての公開鍵 + 相手の公開鍵, 24) → box
export function seal(message, publicKey) {
  const eph = nacl.box.keyPair();
  const nonce = blake2b(concat(eph.publicKey, publicKey), undefined, 24);
  return concat(eph.publicKey, nacl.box(typeof message === 'string' ? enc.encode(message) : message, nonce, publicKey, eph.secretKey));
}
export function unseal(sealed, publicKey, secretKey) {   // テスト用（中身が戻るかを確かめる）
  const eph = sealed.subarray(0, 32), nonce = blake2b(concat(eph, publicKey), undefined, 24);
  return nacl.box.open(sealed.subarray(32), nonce, eph, secretKey);
}

// GitHub App の鍵（PKCS#1 の PEM）を WebCrypto が読める PKCS#8 に包む
const der = (tag, body) => {
  const n = body.length, len = n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
  return concat(Uint8Array.of(tag, ...len), body);
};
export function pkcs8(pem) {
  const raw = unb64(pem.replace(/-----[^-]+-----|\s+/g, ''));
  if (/BEGIN PRIVATE KEY/.test(pem)) return raw;
  const alg = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);   // rsaEncryption・NULL
  return der(0x30, concat(Uint8Array.of(0x02, 0x01, 0x00), alg, der(0x04, raw)));
}

export async function appJwt(appId, pem, now = Date.now()) {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(now / 1000);
  const body = `${b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${b64u(enc.encode(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })))}`;
  return `${body}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(body)))}`;
}

const API = 'https://api.github.com';
const headers = token => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'line-receiver', 'x-github-api-version': '2022-11-28' });
export async function call(token, method, path, body, fetcher = fetch) {
  const r = await fetcher(path.startsWith('http') ? path : API + path, { method, headers: headers(token), body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let json = {}; try { json = t ? JSON.parse(t) : {}; } catch { json = { text: t }; }
  return { status: r.status, json };
}

// 置き場（KV の CONFIG）：app（App の鍵）・inst（インストールの番号）・repo（組織/リポジトリ）・tok（短い鍵の控え）
export async function installationToken(env, fetcher = fetch, now = Date.now()) {
  const cached = await env.CONFIG.get('tok', 'json');
  if (cached && cached.exp - now > 5 * 60 * 1000) return cached.token;
  const app = await env.CONFIG.get('app', 'json'), inst = await env.CONFIG.get('inst');
  if (!app || !inst) return null;
  const r = await call(await appJwt(app.id, app.pem, now), 'POST', `/app/installations/${inst}/access_tokens`, undefined, fetcher);
  if (r.status !== 201) throw new Error(`GitHub の鍵を取れない（${r.status}）`);
  await env.CONFIG.put('tok', JSON.stringify({ token: r.json.token, exp: Date.parse(r.json.expires_at) }));
  return r.json.token;
}

// リポジトリへの呼び口。古い形（Worker の秘密の設定 GH_TOKEN・GH_REPO）にも、App の形にも対応
export function repoApi(env, fetcher = fetch) {
  return async (method, path, body) => {
    let token = env.GH_TOKEN, repo = env.GH_REPO;
    if (env.CONFIG) {
      const t = await installationToken(env, fetcher);
      if (t) { token = t; repo = await env.CONFIG.get('repo') || repo; }
    }
    if (!token || !repo) return { status: 0, json: { message: 'GitHub にまだつないでいない' } };
    return call(token, method, `/repos/${repo}${path}`, body, fetcher);
  };
}

// App の設計図（お客様の GitHub で「Create」を押すと、この権限の App ができる）
export function manifest(origin, name) {
  return {
    name, url: origin, public: false,
    hook_attributes: { url: `${origin}/gh-hook`, active: false },
    redirect_url: `${origin}/setup/github/back`,
    setup_url: `${origin}/setup/github/installed`,
    default_permissions: { actions: 'write', issues: 'write', contents: 'write', secrets: 'write', metadata: 'read' },
    default_events: [],
  };
}

export async function convert(code, fetcher = fetch) {
  const r = await fetcher(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'line-receiver' } });
  if (r.status !== 201) throw new Error(`GitHub App を作れなかった（${r.status}）`);
  const j = await r.json();
  return { id: j.id, slug: j.slug, pem: j.pem, owner: j.owner?.login || '' };
}

// 秘密の設定を1つ入れる（値は暗号化してから送る。GitHub も担当者も中身は読めない）
export async function putSecret(gh, name, value) {
  if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(name)) throw new Error(`名前が違う：${name}`);
  const k = await gh('GET', '/actions/secrets/public-key');
  if (k.status !== 200) throw new Error(`鍵を入れる準備ができない（${k.status}）`);
  const sealed = seal(String(value), unb64(k.json.key));
  const r = await gh('PUT', `/actions/secrets/${name}`, { encrypted_value: b64(sealed), key_id: k.json.key_id });
  if (r.status !== 201 && r.status !== 204) throw new Error(`${name} を入れられなかった（${r.status}）`);
}

// ファイルを1つ書く（下書きの取り込み）
export async function putFile(gh, path, text, message) {
  const cur = await gh('GET', `/contents/${path}`);
  const r = await gh('PUT', `/contents/${path}`, { message, content: b64(enc.encode(text)), ...(cur.status === 200 ? { sha: cur.json.sha } : {}) });
  if (r.status !== 200 && r.status !== 201) throw new Error(`${path} を書けなかった（${r.status}）`);
}
