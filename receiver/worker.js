// お客様の受け口（Cloudflare Workers・2026-10-17）。Discord のアプリの「Interactions Endpoint URL」にこの Worker の URL を入れる。
// Deploy ボタンの形（10/18）：/setup の設定のページで GitHub App・鍵・Google をつなぐ（setup.js）。Discord はウェブフック＋承認のページ /a/<番号>。
// 古い形の秘密の設定（Worker の secret）：DISCORD_PUBLIC_KEY（アプリの公開鍵）・APPROVERS（承認できる人の Discord の ID、カンマ区切り）・GH_TOKEN（このリポジトリだけの鍵：Actions と Issues の書き込み）・GH_REPO（組織/リポジトリ）
// 置き方：リポジトリの .github/workflows/receiver.yml が自動で置く（お客様は Cloudflare の鍵をリポジトリに貼るだけ）。
// 承認の状態＝Issue、途中の荷物＝GitHub の成果物。公開画像だけ KV（MEDIA）に置く。
import { handle } from './handle.js';
import { route } from './setup.js';
import { repoApi } from './github_app.js';
import SCHEDULE_FILE from './schedule.json' with { type: 'json' };   // レシピの定時の表（仕上げとレシピの変更のたびにリポジトリへ書き直す・Deploy ボタンの形）

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
export function isDue(rule, now) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const slot = jst.getUTCHours() * 2 + Math.floor(jst.getUTCMinutes() / 30);
  if ('interval' in rule) {
    const n = rule.interval, start = slot * 30;
    return n > 0 && Math.ceil(start / n) * n < start + 30;
  }
  return (rule.slots || []).includes(slot)
    && (!rule.weekdays || rule.weekdays.includes((jst.getUTCDay() + 6) % 7))
    && (!rule.monthdays || rule.monthdays.includes(jst.getUTCDate()));
}

export async function dispatchDue(env, now, gh = repoApi(env)) {
  const recipes = env.SCHEDULE ? JSON.parse(env.SCHEDULE) : SCHEDULE_FILE;
  const ids = [...new Set(recipes.filter(r => isDue(r.rule, now)).map(r => r.id))];
  if (!ids.length) return;
  const r = await gh('POST', '/actions/workflows/recipes.yml/dispatches', { ref: 'main', inputs: { ids: ids.join(',') } });
  if (r.status !== 204) throw new Error(`レシピの起動に失敗：GitHub ${r.status}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDue(env, new Date(event.scheduledTime)));
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
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
