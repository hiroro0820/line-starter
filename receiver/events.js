// 出来事で起動する入口（2026-10-20）。外から来た知らせ（フォーム・GitHub・決済・自分のプログラム）を受けて、条件に合うレシピをその場で起こす。
// 見回り（定時）を待たない。外に出る操作の承認は今までどおり（レシピの出口で止まる）。受け口は起動だけで、判断・続きはリポジトリの側。
// 決まり：署名のない知らせは受けない／同じ出来事は一度だけ／条件に合わなければ何も起こさない（AI の費用もかからない）
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
const same = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

// 署名：x-orbit-signature か GitHub の x-hub-signature-256（sha256=<hex>）。本文そのままの HMAC-SHA256
export async function signatureOk(raw, headers, secret) {
  if (!secret) return false;
  const got = (headers.get('x-orbit-signature') || headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
  return !!got && same(got, await hmacHex(secret, raw));
}

export async function eventId(headers, raw) {
  return headers.get('x-orbit-event-id') || headers.get('x-github-delivery') || headers.get('x-request-id') || await hmacHex('event', raw);
}

export function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

// 条件：{ "項目の道": 値 } は等しい（並びならどれか）／{ gte, gt, lte, lt, in, contains, exists } で比べる。全部合えば合う。条件なしは常に合う
export function matches(when, ev) {
  return Object.entries(when || {}).every(([path, cond]) => {
    const v = getPath(ev, path);
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return Array.isArray(cond) ? cond.includes(v) : v === cond;
    return Object.entries(cond).every(([op, x]) => {
      if (op === 'exists') return (v !== undefined && v !== null && v !== '') === !!x;
      if (op === 'in') return Array.isArray(x) && x.includes(v);
      if (op === 'contains') return typeof v === 'string' ? v.includes(String(x)) : Array.isArray(v) && v.includes(x);
      const n = Number(v);
      if (v === undefined || v === null || v === '' || Number.isNaN(n)) return false;
      return op === 'gte' ? n >= x : op === 'gt' ? n > x : op === 'lte' ? n <= x : op === 'lt' ? n < x : false;
    });
  });
}

// 本文：{ か [ で始まれば JSON（送る側が名乗る形が違っても読める）、name=値&… ならフォームの形
export function body(raw, contentType = '') {
  const t = String(raw || '').trim();
  if (!t) return {};
  if (t[0] === '{' || t[0] === '[') return JSON.parse(t);
  if (/application\/x-www-form-urlencoded/.test(contentType) || /^[^=&\s]+=/.test(t)) return Object.fromEntries(new URLSearchParams(t));
  return JSON.parse(t);
}

// Actions の入力は1つ 64KB まで。大きい知らせは切る（レシピは必要な項目だけ読む）
export const pack = ev => { const s = JSON.stringify(ev); return s.length > 60000 ? JSON.stringify({ _切り詰め: true, text: s.slice(0, 59000) }) : s; };

// GitHub の一瞬の不調（5xx・429・通信の失敗）は、短く待って3回までやり直す。4xx（鍵・権限・形の間違い）はやり直さない（10/20）
export async function retrying(call, { waits = [400, 1500], sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let r;
  for (let i = 0; ; i++) {
    try { r = await call(); } catch (e) { r = { status: 0, error: e }; }
    if (!(r.status === 0 || r.status === 429 || r.status >= 500) || i >= waits.length) break;
    await sleep(waits[i]);
  }
  if (r.error && r.status === 0) throw r.error;
  return r;
}

export async function fire(gh, ids, ev, opts) {
  const r = await retrying(() => gh('POST', '/actions/workflows/recipes.yml/dispatches', { ref: 'main', inputs: { ids: ids.join(','), event: pack(ev) } }), opts);
  if (r.status !== 204) throw new Error(`レシピの起動に失敗：GitHub ${r.status}`);
}

// 1件の知らせを処理する。hub は seen(id)・later(item)・log(entry) を持つ物（Durable Object か、置き場の代用）
export async function onHook({ source, request, env, gh, hub, rules }) {
  if (request.method !== 'POST') return Response.json({ ok: true });   // 動いているかの確かめ
  if (!env.HOOK_SECRET) return Response.json({ error: '出来事の受け口の合言葉（HOOK_SECRET）がまだ設定されていません' }, { status: 503 });
  const raw = await request.text();
  if (!await signatureOk(raw, request.headers, env.HOOK_SECRET)) return Response.json({ error: 'bad signature' }, { status: 401 });
  let ev;
  try { ev = body(raw, request.headers.get('content-type') || ''); } catch { return Response.json({ error: '本文を読めません' }, { status: 400 }); }
  const mine = (rules || []).filter(r => r.on === source && matches(r.when, ev));
  if (!mine.length) return Response.json({ ok: true, fired: [], note: '条件に合うレシピなし' }, { status: 202 });
  const id = await eventId(request.headers, raw);
  if (!await hub.seen(id)) return Response.json({ ok: true, duplicate: true }, { status: 200 });   // 同じ出来事は一度だけ
  const now = [], wait = [];
  for (const r of mine) (r.after > 0 ? wait : now).push(r);
  if (now.length) {
    try { await fire(gh, [...new Set(now.map(r => r.id))], ev); }
    catch (e) { await hub.forget(id); await hub.log({ kind: '起動できず', source, ids: now.map(r => r.id), eventId: id, error: String(e.message || e).slice(0, 200) }); return Response.json({ error: '起動に失敗しました。もう一度送ってください' }, { status: 502 }); }   // 失敗したら「見た」印を戻す（再送で動く）
    await hub.log({ kind: '起動', source, ids: now.map(r => r.id), eventId: id });
  }
  for (const r of wait) { const ok = await hub.later({ id: r.id, at: Date.now() + r.after * 1000, event: ev, eventId: id }); await hub.log({ kind: ok ? '予約' : '予約できず', source, ids: [r.id], after: r.after, eventId: id }); }
  return Response.json({ ok: true, fired: now.map(r => r.id), waiting: wait.map(r => r.id) }, { status: 202 });
}
