// 会社ごとに1つの「常駐の担当者」（Durable Object・2026-10-20）。眠っていても、知らせ・WebSocket・予約の時刻で起きる。
// やること：①同じ出来事を一度だけにする（seen） ②「N秒後に起こす」予約（later・alarm） ③動きの記録と、開いている画面へのライブ配信（/live）
// 置き場は storage の get/put/list だけ（テストで偽物に差し替えられる）。通信は dispatch（GitHub の呼び口）を外から渡す。
import { fire } from './events.js';
import { repoApi } from './github_app.js';

const KEEP_MS = 7 * 24 * 3600 * 1000;

export class Hub {
  constructor(state, env, { gh } = {}) { this.state = state; this.env = env; this.gh = gh; }
  api() { return this.gh || repoApi(this.env); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/live') {   // 画面とつなぐ（眠れる WebSocket）。つないだ瞬間に直近の動きを送る
      if (request.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ kind: '接続', recent: await this.recent() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method !== 'POST') return new Response('ok');
    const a = await request.json();
    const out = url.pathname === '/seen' ? await this.seen(a.id) : url.pathname === '/later' ? await this.later(a) : url.pathname === '/forget' ? await this.forget(a.id) : url.pathname === '/log' ? await this.log(a) : url.pathname === '/recent' ? await this.recent() : null;
    return Response.json(out);
  }

  async seen(id) {   // 初めて見る出来事なら true（印を付ける）。2度目は false
    const key = 'seen:' + id;
    if (await this.state.storage.get(key)) return false;
    await this.state.storage.put(key, Date.now());
    await this.schedule(Date.now() + KEEP_MS);   // 古い印の掃除の時刻
    return true;
  }

  async forget(id) { await this.state.storage.delete('seen:' + id); return true; }

  async later(item) {   // N秒後に起こす予約。同じ出来事・同じレシピは1つだけ
    const key = `later:${String(item.at).padStart(15, '0')}:${item.eventId}:${item.id}`;
    if ((await this.state.storage.list({ prefix: 'later:' })).size > 500) return false;   // 溜まりすぎ（暴走の守り）
    await this.state.storage.put(key, item);
    await this.schedule(item.at);
    return true;
  }

  async schedule(at) {   // いちばん早い時刻に起きるよう alarm を1つだけ持つ
    const cur = await this.state.storage.getAlarm();
    if (!cur || at < cur) await this.state.storage.setAlarm(Math.max(at, Date.now() + 1));
  }

  async log(entry) {
    const e = { ...entry, at: Date.now() };
    const list = ((await this.state.storage.get('log')) || []).concat(e).slice(-50);
    await this.state.storage.put('log', list);
    for (const ws of this.state.getWebSockets?.() || []) { try { ws.send(JSON.stringify(e)); } catch { /* 切れた画面は無視 */ } }
    return true;
  }

  async recent() { return (await this.state.storage.get('log')) || []; }

  // 眠れる WebSocket：画面からの文は「ping」だけ返す
  async webSocketMessage(ws, msg) { if (String(msg) === 'ping') ws.send('pong'); }

  async alarm() {   // 予約の時刻が来た物を起こす。失敗した物は残して1分後に再挑戦（3回で諦めて記録）
    const now = Date.now();
    const due = await this.state.storage.list({ prefix: 'later:', end: 'later:' + String(now + 1).padStart(15, '0') });
    for (const [key, item] of due) {
      try { await fire(this.api(), [item.id], item.event); await this.state.storage.delete(key); await this.log({ kind: '起動（予約）', ids: [item.id], eventId: item.eventId }); }
      catch (e) {
        const tries = (item.tries || 0) + 1;
        if (tries >= 3) { await this.state.storage.delete(key); await this.log({ kind: '諦めた', ids: [item.id], eventId: item.eventId, error: String(e.message || e).slice(0, 200) }); }
        else await this.state.storage.put(key, { ...item, tries, at: now + 60000 });   // 時刻が変わるので次の alarm で拾う
      }
    }
    for (const [key, t] of await this.state.storage.list({ prefix: 'seen:' })) if (now - t > KEEP_MS) await this.state.storage.delete(key);
    const rest = await this.state.storage.list({ prefix: 'later:', limit: 1 });
    const next = rest.size ? Math.min(...[...rest.values()].map(i => i.at)) : null;
    if (next) await this.state.storage.setAlarm(Math.max(next, now + 1000));
  }
}

// 受け口から Hub を呼ぶ口。HUB（Durable Object）があればそれ、なければ置き場（KV）で「一度だけ」だけ代用（予約はできない）
export function hubOf(env) {
  if (env.HUB) {
    const stub = env.HUB.get(env.HUB.idFromName('main'));
    const call = (path, body) => stub.fetch('https://hub' + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
    return { seen: id => call('/seen', { id }), later: item => call('/later', item), forget: id => call('/forget', { id }), log: e => call('/log', e), recent: () => call('/recent', {}), live: req => stub.fetch(req) };
  }
  const kv = env.CONFIG;
  return {
    seen: async id => { if (!kv) return true; if (await kv.get('seen:' + id)) return false; await kv.put('seen:' + id, '1', { expirationTtl: 7 * 24 * 3600 }); return true; },
    later: async () => false, forget: async id => { if (kv) await kv.delete('seen:' + id); return true; }, log: async () => true, recent: async () => [], live: null,
  };
}
