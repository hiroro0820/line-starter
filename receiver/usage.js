// 今月の使った量（2026-10-22 オーナー：「1日に頼める回数」ではなく、使った量で見る）。数えるのはお客様の受け口が、お客様の GitHub から（大元は通らない）
//   Actions の分：今月の実行（runs）の長さを分に切り上げて足す（GitHub は1つの仕事ごとに分で切り上げて数える）。目安：無料枠は月 2,000分（非公開のリポジトリ・Free）
//   AI の費用：リポジトリの usage.csv（claude-p・API の呼び口が1回ごとに書く）の今月の「費用ドル」の合計（定額の Claude の会社は、API にしたらの目安）
//   上限：会社の設定 limits.actions_minutes（既定 2000）・limits.ai_usd_month（既定なし）。10分ごとに数え直す（置き場に控え）
const dec = new TextDecoder();
const unb64 = s => Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0));
const CACHE_MS = 10 * 60 * 1000;

export const monthOf = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 7);   // 日本時間の「年-月」
export function runMinutes(runs) {
  let n = 0;
  for (const r of runs || []) {
    const a = Date.parse(r.run_started_at || r.created_at), b = Date.parse(r.status === 'completed' ? r.updated_at : new Date().toISOString());
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    n += Math.max(1, Math.ceil((b - a) / 60000));
  }
  return n;
}
export function aiCost(csv, month) {
  const lines = String(csv || '').split('\n'), head = (lines[0] || '').split(',');
  const at = head.indexOf('日時'), cost = head.indexOf('費用ドル');
  if (at < 0 || cost < 0) return 0;
  let sum = 0;
  for (const l of lines.slice(1)) { const c = l.split(','); if ((c[at] || '').startsWith(month)) sum += Number(c[cost]) || 0; }
  return Math.round(sum * 100) / 100;
}

export async function monthUsage(env, gh, now = Date.now(), fresh = false) {
  const month = monthOf(now);
  if (!fresh && env.CONFIG) { try { const c = await env.CONFIG.get('usage_cache', 'json'); if (c && c.month === month && now - c.at < CACHE_MS) return c; } catch { /* 数え直す */ } }
  const since = `${month}-01T00:00:00+09:00`;
  let runs = [];
  for (let page = 1; page <= 5; page++) {
    const r = await gh('GET', `/actions/runs?created=${encodeURIComponent('>=' + new Date(since).toISOString())}&per_page=100&page=${page}`);
    const xs = r.status === 200 && r.json && Array.isArray(r.json.workflow_runs) ? r.json.workflow_runs : [];
    runs = runs.concat(xs); if (xs.length < 100) break;
  }
  let csv = '';
  try { const f = await gh('GET', '/contents/usage.csv'); if (f.status === 200 && f.json && f.json.content) csv = dec.decode(unb64(f.json.content)); } catch { /* 無ければ0 */ }
  let company = {};
  try { const f = await gh('GET', '/contents/cloud/lines/company.json'); if (f.status === 200 && f.json && f.json.content) company = JSON.parse(dec.decode(unb64(f.json.content))); } catch { /* 既定の上限 */ }
  const lim = company.limits || {};
  const u = { month, at: now, actions_min: runMinutes(runs), actions_limit: Number(lim.actions_minutes) || 2000, runs: runs.length, ai_usd: aiCost(csv, month), ai_limit: Number(lim.ai_usd_month) || null };
  if (env.CONFIG) { try { await env.CONFIG.put('usage_cache', JSON.stringify(u), { expirationTtl: 3600 }); } catch { /* 控えなくてもよい */ } }
  return u;
}

// 頼む・試すの前の確かめ：上限に近ければ止める（理由と残りの量つき）。問題なければ null
export function budgetGuard(u) {
  if (!u) return null;
  if (u.actions_min >= u.actions_limit * 0.95) return `今月の GitHub Actions の分が上限に近いので、新しく作るのを止めています（${u.actions_min} / ${u.actions_limit}分）。来月になるか、会社の設定 limits.actions_minutes を上げると再開します`;
  if (u.ai_limit && u.ai_usd >= u.ai_limit) return `今月の AI の費用が上限に達したので、新しく作るのを止めています（$${u.ai_usd} / $${u.ai_limit}）`;
  return null;
}
