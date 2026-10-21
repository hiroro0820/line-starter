// お客様の受け口（Cloudflare Workers・2026-10-17）。Discord のアプリの「Interactions Endpoint URL」にこの Worker の URL を入れる。
// B の形（10/18）：/setup の設定のページで GitHub App・鍵・Google をつなぐ（setup.js）。Discord はウェブフック＋承認のページ /a/<番号>。
// 古い形の秘密の設定（Worker の secret）：DISCORD_PUBLIC_KEY（アプリの公開鍵）・APPROVERS（承認できる人の Discord の ID、カンマ区切り）・GH_TOKEN（このリポジトリだけの鍵：Actions と Issues の書き込み）・GH_REPO（組織/リポジトリ）
// 置き方：リポジトリの .github/workflows/receiver.yml が自動で置く（お客様は Cloudflare の鍵をリポジトリに貼るだけ）。
// 承認の状態＝Issue、途中の荷物＝GitHub の成果物。公開画像だけ KV（MEDIA）に置く。
import { handle } from './handle.js';
import { route, loggedIn, relayIn, coreUpdate, slackTidy } from './setup.js';
import { onHook, retrying } from './events.js';
import { Hub, hubOf } from './hub.js';
import TRIGGERS_FILE from './triggers.json' with { type: 'json' };   // 出来事で起こすレシピの表（schedule.py triggers が書く）
import { repoApi } from './github_app.js';
import SCHEDULE_FILE from './schedule.json' with { type: 'json' };   // レシピの定時の表（仕上げとレシピの変更のたびにリポジトリへ書き直す・B の形）

export { Hub };   // Durable Object（出来事の受け口の常駐の担当者）
const hex = h => Uint8Array.from(h.match(/.{2}/g) || [], b => parseInt(b, 16));

export async function verify(raw, sig, ts, publicKeyHex) {
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hex(sig), new TextEncoder().encode(ts + raw));
  } catch { return false; }
}

export function githubOf(env) {
  return async (method, path, body) => {
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}${path}`, {
      method, headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'line-receiver' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    return { status: r.status, json: t ? JSON.parse(t) : {} };
  };
}

// schedule.py の小さな規則を判定。曜日は月=0〜日=6、日本時間の30分枠。
export function isDue(rule, now, exact = false) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const slot = jst.getUTCHours() * 2 + Math.floor(jst.getUTCMinutes() / 30);
  if (exact) {   // 1分ごとの見回り（cron が * * * * * の受け口）：ちょうどその分だけ。表に minutes がない古い表は30分枠のまま
    const mod = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    if ('interval' in rule) return rule.interval > 0 && mod % rule.interval === 0;
    if (rule.minutes) return rule.minutes.includes(mod) && (!rule.weekdays || rule.weekdays.includes((jst.getUTCDay() + 6) % 7)) && (!rule.monthdays || rule.monthdays.includes(jst.getUTCDate()));
  }
  if ('interval' in rule) {
    const n = rule.interval, start = slot * 30;
    return n > 0 && Math.ceil(start / n) * n < start + 30;
  }
  return (rule.slots || []).includes(slot)
    && (!rule.weekdays || rule.weekdays.includes((jst.getUTCDay() + 6) % 7))
    && (!rule.monthdays || rule.monthdays.includes(jst.getUTCDate()));
}

// 定時の表：Worker の設定（古い形）→ リポジトリの receiver/schedule.json（B の形・1時間ごとに読み直して置き場に控える）→ まとめたときの表
export async function scheduleOf(env, gh, now = Date.now()) {
  if (env.SCHEDULE) return JSON.parse(env.SCHEDULE);
  if (env.CONFIG) {
    const c = await env.CONFIG.get('schedule', 'json');
    if (c && now - c.at < 3600 * 1000) return c.list;
    const r = await gh('GET', '/contents/receiver/schedule.json');
    if (r.status === 200 && r.json.content) {
      const list = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.json.content.replace(/\s/g, '')), ch => ch.charCodeAt(0))));
      await env.CONFIG.put('schedule', JSON.stringify({ at: now, list })); return list;
    }
    if (c) return c.list;
  }
  return SCHEDULE_FILE;
}

// 出来事の表：Worker の設定 → 置き場に控えた物（1時間）→ リポジトリの receiver/triggers.json → まとめたときの表
export async function triggersOf(env, gh, now = Date.now()) {
  if (env.TRIGGERS) return JSON.parse(env.TRIGGERS);
  if (env.CONFIG) {
    const c = await env.CONFIG.get('triggers', 'json');
    if (c && now - c.at < 3600 * 1000) return c.list;
    const r = await gh('GET', '/contents/receiver/triggers.json');
    if (r.status === 200 && r.json.content) {
      const list = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.json.content.replace(/\s/g, '')), ch => ch.charCodeAt(0))));
      await env.CONFIG.put('triggers', JSON.stringify({ at: now, list })); return list;
    }
    if (c) return c.list;
  }
  return TRIGGERS_FILE;
}

export async function dispatchDue(env, now, gh = repoApi(env), opts = {}) {
  const recipes = await scheduleOf(env, gh, now.getTime());
  const ids = [...new Set(recipes.filter(r => isDue(r.rule, now, !!opts.exact)).map(r => r.id))];
  if (!ids.length) return;
  const r = await retrying(() => gh('POST', '/actions/workflows/recipes.yml/dispatches', { ref: 'main', inputs: { ids: ids.join(',') } }), opts);   // 一瞬の不調は3回までやり直す
  if (r.status !== 204) {
    try { if (env.CONFIG) await env.CONFIG.put('dispatch_fail', JSON.stringify({ at: now.toISOString(), ids, status: r.status })); } catch (e) { /* 控えが書けなくても、失敗は下で知らせる */ }   // 抜け見張り（watchdog）が、飛んだ回を見つける手がかり
    throw new Error(`レシピの起動に失敗：GitHub ${r.status}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDue(env, new Date(event.scheduledTime), undefined, { exact: event.cron === '* * * * *' }));   // 1分ごとの見回り（cron が * * * * *）なら1分単位・30分ごとの古い受け口は30分枠
    const jst = new Date(event.scheduledTime + 9 * 3600 * 1000), m = jst.getUTCMinutes();
    if (jst.getUTCHours() === 4 && (event.cron === '* * * * *' ? m === 10 : m < 30)) ctx.waitUntil(coreUpdate(env).catch(() => { }));   // 毎日 4:10 に芯の新しい版を確かめる（10/21）
  },
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (env.CONFIG && !(await env.CONFIG.get('slack_tidy'))) ctx.waitUntil(slackTidy(env, new URL(request.url).origin).catch(() => { }));   // Slack のチャンネルを #orbit だけに片付ける（一度だけ・10/21）
    if (path === '/setup/relay' && request.method === 'POST') return relayIn(request, env, ctx);   // Slack の #orbit の書き込み（受付から・その瞬間に・10/20）
    if (path === '/' && request.method === 'GET' && /text\/html/.test(request.headers.get('accept') || '')) return Response.redirect(new URL('/setup', request.url).toString(), 302);   // ブラウザで住所をそのまま開いたら設定のページへ（Discord の受け口・生存確認はそのまま・10/18 t3）
    if (path.startsWith('/hook/')) { const gh = repoApi(env); return onHook({ source: decodeURIComponent(path.slice(6)), request, env: { ...env, HOOK_SECRET: env.HOOK_SECRET || (env.CONFIG && await env.CONFIG.get('hook_secret')) || '' }, gh, hub: hubOf(env), rules: await triggersOf(env, gh) }); }   // 出来事の受け口（署名つき・10/20）
    if (path === '/live') {   // 動きのライブ表示（WebSocket。ログインした人だけ）
      if (!await loggedIn(env, request)) return new Response('login', { status: 401 });
      const hub = hubOf(env);
      return hub.live ? hub.live(request) : new Response('この受け口にはライブ表示の担当者（HUB）がありません', { status: 501 });
    }
    const page = await route(request, env);
    if (page) return page;
    if (request.method === 'GET' && path.startsWith('/m/')) {
      let key;
      try { key = decodeURIComponent(path.slice(3)); } catch { return new Response('not found', { status: 404 }); }
      const kv = env.MEDIA || env.CONFIG;   // 置き場は1つでも2つでもよい（10/18 t3：Deploy の画面で名前がぶつかるため1つにまとめた）
      if (!key || !kv) return new Response('not found', { status: 404 });
      const { value, metadata } = await kv.getWithMetadata(key, 'arrayBuffer');
      if (value === null) return new Response('not found', { status: 404 });
      return new Response(value, { headers: { 'content-type': metadata?.contentType || 'application/octet-stream', 'x-content-type-options': 'nosniff' } });
    }
    if (request.method !== 'POST') return new Response('ok', { status: 200 });   // 動いているかの確かめ用
    const raw = await request.text();   // 署名の確かめには、受け取ったままの本文が要る
    const ok = await verify(raw, request.headers.get('x-signature-ed25519') || '', request.headers.get('x-signature-timestamp') || '', env.DISCORD_PUBLIC_KEY || '');
    if (!ok) return new Response('bad signature', { status: 401 });
    const out = await handle(JSON.parse(raw), { gh: repoApi(env), approvers: env.APPROVERS || '' });
    return Response.json(out);
  },
};
