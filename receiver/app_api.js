// 画面のためのデータの口（2026-10-22）：大元の画面（orbit-package.com/app）が、ブラウザから直接この受け口を呼ぶ。
// 大元はデータを持たない：画面のファイルを配るだけで、仕事・記録・承認・頼みの中身は、ここ（お客様の Cloudflare）とお客様の GitHub にしかない。
// 入れるのは「端末の合言葉」（device.js・Authorization: Bearer）を持つ端末だけ。呼び元は大元の画面の住所だけ（CORS）。
//   GET  /app/api/version            … この受け口の版と、画面の口の版（古い受け口なら画面が取り込みを案内する）
//   GET  /app/api/summary            … ホーム：仕事の一覧・数字3つ・要確認・最近の実行・導入が済んだか
//   GET  /app/api/job?id=            … 仕事の詳細：中身（段）・実行の記録・承認待ち・直近の動き
//   POST /app/api/job/mode           … { id, to: 本番|影|停止|再開|今すぐ } を指示にして動かす（Issue＋instruct.yml。記録が残る）
//   GET  /app/api/notices            … 通知センター（承認待ち・失敗・完成など。既読はこの端末ごとに置き場へ）
//   POST /app/api/notices/read       … { ids:[…] } か { all:true } を既読に
//   GET  /app/api/approval?n=        … 承認待ちの中身／POST { n, ok, note } で決める（リンクのページと同じ道）
//   GET  /app/api/builds・/app/api/build?id=・POST /app/api/ask・/app/api/build/(approve|answer|cancel)
//                                    … 言葉で頼む（提案 → 承認 → 開発）。中身は棚の画面と同じ（shelf.js の buildRoute）
//   POST /app/api/live-ticket        … ライブ表示（WebSocket）の切符（60秒・1回だけ）。/live?ticket=<切符> でつなぐ
//   POST /run/event                  … Actions の仕事から段ごとの動き（live.py・承認の鍵で確かめる）→ 常駐の担当が画面へ配る
import { allowedOrigins, deviceOf } from './device.js';
import { shelfData, buildRoute, listBuilds } from './shelf.js';
import { addInstruction, decideApproval, setupFinished } from './setup.js';

export const API_VERSION = 1;
const TYPES = ['run.queued', 'run.started', 'step.started', 'step.progress', 'step.completed', 'step.failed', 'approval.required', 'approval.granted', 'run.failed', 'run.completed'];
const RUNNING_MS = 2 * 3600 * 1000;   // これより古い「始まった」は、終わりの知らせが届かなかった物として数えない
const dec = new TextDecoder();
const unb64 = s => Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0));
const readFile = async (gh, path) => { const r = await gh('GET', `/contents/${path}`); return r.status === 200 && r.json && r.json.content ? dec.decode(unb64(r.json.content)) : null; };
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ── CORS：大元の画面の住所からの呼び出しだけ、ブラウザに読ませる
export function corsHeaders(req, env) {
  const o = req.headers.get('origin');
  const h = { vary: 'Origin', 'cache-control': 'no-store' };
  if (o && allowedOrigins(env).includes(o)) Object.assign(h, { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST', 'access-control-max-age': '600' });
  return h;
}
const send = (req, env, o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req, env) } });

// ── 実行の記録（お客様のリポジトリの cloud/lines/runs.csv。line.py が1回ごとに1行書く）
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows; if (!head) return [];
  return body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const RESULT = { '合格': 'success', 'やめた件あり': 'warning', '承認待ち': 'waiting', '止めた': 'error', 'エージェントへ': 'error', '終わり（guard）': 'skipped' };
export const runOf = r => ({ at: r['日時'], job: r['ライン'], result: r['結果'], tone: RESULT[r['結果']] || 'muted', mode: r['モード'] === 'live' ? '本番' : r['モード'] === 'shadow' ? '影' : r['モード'],
  sec: Number(r['秒']) || 0, ai: Number(r['AI回数']) || 0, cost: Number(r['費用ドル']) || 0, writes: Number(r['書いた回数']) || 0, dropped: Number(r['やめた件数']) || 0 });
async function readRuns(gh) { const t = await readFile(gh, 'cloud/lines/runs.csv'); return t ? parseCsv(t).slice(-500).map(runOf) : []; }

// ── 承認待ち（approve_cloud.py が作る Issue：ラベル「承認待ち」・見出し「⏸ 承認待ち：<仕事の id>」）
async function openApprovals(gh) {
  const r = await gh('GET', `/issues?state=open&labels=${encodeURIComponent('承認待ち')}&per_page=30`);
  if (r.status !== 200 || !Array.isArray(r.json)) return [];
  return r.json.filter(i => !i.pull_request).map(i => ({ n: i.number, job: String(i.title || '').replace(/^⏸\s*承認待ち：/, '').trim(), at: i.created_at }));
}

// ── 常駐の担当の直近の動き（live.py の封筒）から、仕事ごとに「いま動いているか」と最後の段を出す
export function liveState(recent, now = Date.now()) {
  const runs = new Map();
  for (const e of recent || []) if (e && e.kind === 'run' && e.run_id) {
    const r = runs.get(e.run_id) || { run_id: e.run_id, job: e.job_id, events: [] };
    r.events.push(e); runs.set(e.run_id, r);
  }
  const out = {};
  for (const r of runs.values()) {
    r.events.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const last = r.events[r.events.length - 1], first = r.events[0];
    const ended = r.events.some(e => e.type === 'run.completed' || e.type === 'run.failed');
    const waiting = !ended && last.type === 'approval.required';
    const running = !ended && !waiting && now - (last.at || 0) < RUNNING_MS;
    const prev = out[r.job];
    if (!prev || (first.at || 0) >= (prev.startedAt || 0)) out[r.job] = { run_id: r.run_id, running, waiting, ended, failed: r.events.some(e => e.type === 'run.failed'), startedAt: first.at || 0, step: last.step_id, type: last.type,
      steps: r.events.filter(e => e.type.startsWith('step.')).map(e => ({ step: e.step_id, type: e.type, at: e.at })) };
  }
  return out;
}

const modeRank = m => ({ '本番': 0, '影': 1, '停止': 3 }[m] ?? 2);
function jobOf(rec, runs, approvals, live) {
  const mine = runs.filter(r => r.job === rec.id), last = mine[mine.length - 1] || null, l = live[rec.id] || null;
  const waiting = approvals.filter(a => a.job === rec.id).length;
  const status = waiting ? '承認待ち' : l && l.running ? '実行中' : rec.mode === '停止' ? '停止中' : rec.mode === '影' ? '試し（影）' : rec.mode === '本番' ? '稼働中' : rec.mode || '—';
  return { id: rec.id, name: rec.name, purpose: rec.purpose, when: rec.when, mode: rec.mode, kind: rec.kind, approval: rec.approval, status, waiting, running: !!(l && l.running), last, runs: mine.length,
    steps: { in: (rec.in || []).map(x => x.name || x.part), ai: rec.ai, checks: rec.checks || [], out: rec.out || [] } };
}

async function gather(env, gh, hub) {
  const [shelf, runs, approvals, recent] = await Promise.all([shelfData(gh).catch(e => ({ error: String(e.message || e) })), readRuns(gh).catch(() => []), openApprovals(gh).catch(() => []), (hub ? hub.recent() : Promise.resolve([])).catch(() => [])]);
  const live = liveState(recent);
  const jobs = (shelf.recipes || []).map(r => jobOf(r, runs, approvals, live)).sort((a, b) => modeRank(a.mode) - modeRank(b.mode) || (b.last ? 1 : 0) - (a.last ? 1 : 0) || a.name.localeCompare(b.name, 'ja'));
  const names = Object.fromEntries(jobs.map(j => [j.id, j.name]));
  return { shelf, runs, approvals: approvals.map(a => ({ ...a, name: names[a.job] || a.job })), recent, live, jobs, names };
}

async function summary(env, gh, hub) {
  const g = await gather(env, gh, hub);
  const builds = await listBuilds(gh, 6).catch(() => []);
  return { api: API_VERSION, setup: { finished: await setupFinished(env), shelf: !g.shelf.error, note: g.shelf.error || '' },
    counts: { jobs: g.jobs.filter(j => j.mode && j.mode !== '停止').length, running: g.jobs.filter(j => j.running).length, attention: g.approvals.length },
    attention: g.approvals, jobs: g.jobs, recent: g.runs.slice(-10).reverse().map(r => ({ ...r, name: g.names[r.job] || r.job })), builds };
}

async function jobDetail(env, gh, hub, id) {
  const g = await gather(env, gh, hub), job = g.jobs.find(j => j.id === id);
  if (!job) return null;
  const rec = (g.shelf.recipes || []).find(r => r.id === id) || {};
  return { job: { ...job, stop_words: rec.stop_words || [], limit: rec.limit || {}, ai_instruction: rec.ai_instruction || '' },
    runs: g.runs.filter(r => r.job === id).slice(-30).reverse(), approvals: g.approvals.filter(a => a.job === id), live: g.live[id] || null,
    recent: (g.recent || []).filter(e => e.kind === 'run' && e.job_id === id).slice(-40) };
}

// ── 通知センター：お客様の記録から組み立てる（大元には置かない）。既読はこの端末ごと（read:<端末の指紋>）
const WEEK = 7 * 24 * 3600 * 1000;
const jstMs = s => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : 0; };   // runs.csv の日時は日本時間
async function notices(env, gh, hub, fp, now = Date.now()) {
  const g = await gather(env, gh, hub), builds = await listBuilds(gh, 12).catch(() => []);
  const list = [];
  for (const a of g.approvals) list.push({ id: `a:${a.n}`, kind: 'approval', title: `${a.name}：承認が必要です`, body: '外に出す前の確認待ち', at: Date.parse(a.at) || now, to: { page: 'approval', n: a.n } });
  for (const r of g.runs.slice(-200)) {
    const at = jstMs(r.at); if (now - at > WEEK) continue;
    const name = g.names[r.job] || r.job;
    if (r.tone === 'error') list.push({ id: `r:${r.at}:${r.job}`, kind: 'error', title: `${name}で止まりました`, body: `結果：${r.result}。実行の記録を確かめてください`, at, to: { page: 'job', id: r.job } });
    else if (r.tone === 'warning') list.push({ id: `r:${r.at}:${r.job}`, kind: 'error', title: `${name}で一部をやめました`, body: `${r.dropped} 件をやめて、残りを進めました`, at, to: { page: 'job', id: r.job } });
    else if (r.tone === 'success' && r.mode === '本番') list.push({ id: `r:${r.at}:${r.job}`, kind: 'done', title: `${name}が完了`, body: `${r.sec} 秒・AI ${r.ai} 回`, at, to: { page: 'job', id: r.job } });
  }
  for (const b of builds) {
    const at = b['更新'] || b['日時'] || now; if (now - at > WEEK) continue;
    const head = String(b['頼み'] || '').slice(0, 40);
    if (b['状態'] === '提案できた') list.push({ id: `b:${b.id}:提案`, kind: 'action', title: '提案ができました', body: head, at, to: { page: 'build', id: b.id } });
    else if (b['状態'] === '完成') list.push({ id: `b:${b.id}:完成`, kind: 'done', title: '頼んだ仕事ができました', body: head, at, to: { page: 'build', id: b.id } });
    else if (b['状態'] === '失敗') list.push({ id: `b:${b.id}:失敗`, kind: 'error', title: '頼んだ仕事を作れませんでした', body: head, at, to: { page: 'build', id: b.id } });
  }
  list.sort((a, b) => b.at - a.at);
  const read = new Set((await env.CONFIG.get('read:' + fp, 'json')) || []);
  return { notices: list.slice(0, 40).map(n => ({ ...n, read: read.has(n.id) })) };
}
async function markRead(env, gh, hub, fp, b) {
  const key = 'read:' + fp, read = new Set((await env.CONFIG.get(key, 'json')) || []);
  const ids = b.all ? (await notices(env, gh, hub, fp)).notices.map(n => n.id) : (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => x.length <= 200).slice(0, 100);
  for (const id of ids) read.add(id);
  await env.CONFIG.put(key, JSON.stringify([...read].slice(-400)), { expirationTtl: 400 * 24 * 3600 });
  return { ok: true, read: ids.length };
}

// ── 仕事の状態を変える：指示（Issue＋instruct.yml）にする。決まった形だけ動く・記録と #orbit への報告が残る
const MODE_WORDS = { '本番': '本番にして', '影': '影にして', '停止': '止めて', '再開': '再開して', '今すぐ': '動かして' };
async function changeMode(gh, b, jobs) {
  const job = jobs.find(j => j.id === String(b.id || ''));
  if (!job) return [{ error: 'その仕事は見つかりません' }, 404];
  const w = MODE_WORDS[b.to];
  if (!w) return [{ error: '変え方は 本番・影・停止・再開・今すぐ のどれかです' }, 400];
  const no = await addInstruction(gh, `「${job.id}」を${w}`, '画面');
  return no ? [{ ok: true, issue: no, msg: `受け付けました（指示 #${no}）。1〜2分で反映され、結果は知らせの先にも届きます` }, 200] : [{ error: '受け付けられませんでした。少しして、もう一度押してください' }, 502];
}

async function approvalDetail(gh, n) {
  const iss = await gh('GET', `/issues/${n}`);
  if (iss.status !== 200) return null;
  const labels = (iss.json.labels || []).map(l => l.name || l);
  if (!labels.includes('承認待ち') && !labels.includes('承認') && !labels.includes('却下')) return null;   // 承認の Issue だけ（ほかの Issue は見せない）
  return { n, title: String(iss.json.title || '').replace(/^⏸\s*/, ''), job: String(iss.json.title || '').replace(/^⏸\s*承認待ち：/, '').trim(), body: String(iss.json.body || '').split('\n\n---\n')[0].slice(0, 6000),
    open: iss.json.state === 'open', decided: labels.includes('承認') ? '承認' : labels.includes('却下') ? '却下' : '', at: iss.json.created_at };
}

// ── /run/event：Actions の仕事からの段ごとの動き（承認の鍵）。封筒の欄だけを、長さを切って常駐の担当へ
export function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !TYPES.includes(e.type)) return null;
  const s = (v, n) => (v == null ? null : String(v).slice(0, n));
  if (!e.job_id || !e.run_id) return null;
  return { kind: 'run', event_id: s(e.event_id, 64), job_id: s(e.job_id, 80), run_id: s(e.run_id, 80), step_id: s(e.step_id, 40), type: e.type, occurred_at: s(e.occurred_at, 40), seq: Number.isFinite(+e.seq) ? +e.seq : 0, status: s(e.status, 40) };
}
export async function runEvent(req, env, hub) {
  const key = env.CONFIG && await env.CONFIG.get('approve_key');
  if (!key || !same(req.headers.get('authorization') || '', `Bearer ${key}`)) return new Response('forbidden', { status: 403 });
  const e = cleanEvent(await req.json().catch(() => null));
  if (!e) return new Response('bad event', { status: 400 });
  if (hub) await hub.log(e);
  return new Response(null, { status: 204 });
}

// ── 入口：/app/api/* だけを受ける（それ以外は null）
export async function appRoute(req, env, { gh, hub } = {}) {
  const url = new URL(req.url), path = url.pathname;
  if (!path.startsWith('/app/api/')) return null;
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigins(env).includes(origin)) return new Response('forbidden origin', { status: 403, headers: { vary: 'Origin' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (!env.CONFIG) return send(req, env, { error: '置き場（CONFIG）がありません' }, 500);
  const fp = await deviceOf(env, req);
  if (!fp) return send(req, env, { error: 'この端末は入れません。知らせの先（Slack・Discord）の「📌 入口」のリンクから開き直してください', code: 'login' }, 401);
  try {
    if (path === '/app/api/version' && req.method === 'GET') { let core = ''; try { core = JSON.parse((await readFile(gh, 'cloud/lines/core.json')) || '{}').version || ''; } catch { } return send(req, env, { api: API_VERSION, core }); }
    if (path === '/app/api/summary' && req.method === 'GET') return send(req, env, await summary(env, gh, hub));
    if (path === '/app/api/job' && req.method === 'GET') { const d = await jobDetail(env, gh, hub, url.searchParams.get('id') || ''); return d ? send(req, env, d) : send(req, env, { error: 'その仕事は見つかりません' }, 404); }
    if (path === '/app/api/notices' && req.method === 'GET') return send(req, env, await notices(env, gh, hub, fp));
    if (path === '/app/api/approval' && req.method === 'GET') { const n = Number(url.searchParams.get('n')); const d = Number.isInteger(n) && n > 0 ? await approvalDetail(gh, n) : null; return d ? send(req, env, d) : send(req, env, { error: 'その承認は見つかりません' }, 404); }
    if (path === '/app/api/builds' || path === '/app/api/build') {   // 棚の画面と同じ処理（GET）
      const r = await buildRoute(req, env, gh, url, path === '/app/api/builds' ? '/shelf/builds' : '/shelf/build');
      return r ? new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...corsHeaders(req, env) } }) : send(req, env, { error: '見つかりません' }, 404);
    }
    if (req.method !== 'POST') return send(req, env, { error: 'ありません' }, 404);
    if (path === '/app/api/ask' || /^\/app\/api\/build\/(approve|answer|cancel)$/.test(path)) {
      const r = await buildRoute(req, env, gh, url, path === '/app/api/ask' ? '/shelf/ask' : path.replace('/app/api/', '/shelf/'));
      return r ? new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...corsHeaders(req, env) } }) : send(req, env, { error: '見つかりません' }, 404);
    }
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== 'object') return send(req, env, { error: '形が違います' }, 400);
    if (path === '/app/api/notices/read') return send(req, env, await markRead(env, gh, hub, fp, b));
    if (path === '/app/api/job/mode') { const g = await gather(env, gh, hub); const [o, st] = await changeMode(gh, b, g.jobs); return send(req, env, o, st); }
    if (path === '/app/api/approval') {
      const n = Number(b.n), d = Number.isInteger(n) && n > 0 ? await approvalDetail(gh, n) : null;
      if (!d) return send(req, env, { error: 'その承認は見つかりません' }, 404);
      if (!d.open) return send(req, env, { error: 'もう決まっています', decided: d.decided }, 409);
      const r = await decideApproval(gh, n, b.ok === true, b.note, '画面');
      return r.status === 204 ? send(req, env, { ok: true, msg: b.ok === true ? '承認しました。続きを動かしています' : 'やめました' }) : send(req, env, { error: `受け付けられませんでした（${r.status}）。少しして、もう一度押してください` }, 502);
    }
    if (path === '/app/api/live-ticket') {
      const t = [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
      await env.CONFIG.put('lt:' + t, '1', { expirationTtl: 60 });
      return send(req, env, { ticket: t, expires_in: 60 });
    }
    return send(req, env, { error: 'ありません' }, 404);
  } catch (e) {
    return send(req, env, { error: 'うまく読めませんでした。少しして、もう一度開いてください', detail: String(e.message || e).slice(0, 200) }, 500);
  }
}

// ライブ表示の切符を使う（1回だけ）。合えば true
export async function useTicket(env, t) {
  if (!env.CONFIG || !/^[0-9a-f]{48}$/.test(String(t || ''))) return false;
  if (!(await env.CONFIG.get('lt:' + t))) return false;
  await env.CONFIG.delete('lt:' + t);
  return true;
}
