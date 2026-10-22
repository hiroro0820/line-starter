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
//   POST /app/api/settings           … { path, value } 会社の設定を保存（画面の「直すこと」から・鍵は断る）
//   POST /app/api/share              … { kind: part|recipe, name, on } 大元へ戻す印（custom/share.json）を付ける・外す。御社だけの部品・仕事だけ（夜の share.yml が確かめて申し出る）
//   POST /app/api/live-ticket        … ライブ表示（WebSocket）の切符（60秒・1回だけ）。/live?ticket=<切符> でつなぐ
//   POST /run/event                  … Actions の仕事から段ごとの動き（live.py・承認の鍵で確かめる）→ 常駐の担当が画面へ配る
import { allowedOrigins, deviceOf } from './device.js';
import { shelfData, buildRoute, listBuilds, toggleShare } from './shelf.js';
import { commitFiles } from './github_app.js';
import { monthUsage } from './usage.js';
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

// ── 直すこと（10/22 オーナー：エラーが出たら orbit の画面から直せるように）
// ①足りない会社の設定：レシピの設定にある {会社:a.b} が、お客様の会社の設定（cloud/lines/company.json）に無い物。画面で値を入れて保存できる
// ②止まった知らせ：recipe.py の warn が作る Issue（ラベル「止まった」・見出し「⚠️ 止まっているレシピ：<名前>」）。理由を見せ、AI に相談して直す道へ
const REF = /\{会社:([\w.]+)\}/g;
const SECRETISH = /(key|token|secret|password|passwd|鍵|合言葉|パスワード)/i;
export const getPath = (o, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' && k in v ? v[k] : undefined), o);
const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
export function shapeOf(part, key) {   // 部品の説明（例「calendars＝{人: カレンダーID}」）から、入れ方（1つの値・名前と値の表・並び）を決める
  const d = String((part && part.desc) || ''), m = new RegExp(`${key}＝\\{([^:：}]+)[:：]\\s*([^}]+)\\}`).exec(d);
  if (m) return { shape: 'map', name: m[1].trim(), value: m[2].trim() };
  if (new RegExp(`${key}＝\\[`).test(d)) return { shape: 'list' };
  const def = ((part && part.settings) || []).find(x => x.key === key);
  if (def && def.default && typeof def.default === 'object') return Array.isArray(def.default) ? { shape: 'list' } : { shape: 'map', name: '名前', value: '値' };
  return { shape: 'text' };
}
export function needsOf(rec, company, parts) {   // そのレシピで足りない会社の設定の並び
  const out = [], seen = new Set(), byName = Object.fromEntries((parts || []).map(p => [p.name, p]));
  const walk = (v, part, key) => {
    if (v && typeof v === 'object') { for (const x of Object.values(v)) walk(x, part, key); return; }
    if (typeof v !== 'string') return;
    for (const m of v.matchAll(REF)) {
      const path = m[1];
      if (seen.has(path) || !empty(getPath(company, path))) continue;
      seen.add(path);
      const p = byName[part], s = ((p && p.settings) || []).find(x => x.key === key);
      out.push({ path, part, key, required: !!(s && s.required), secret: SECRETISH.test(path), ...shapeOf(p, key) });
    }
  };
  const b = rec.blocks || {};
  for (const it of [...(b.in || []), ...(b.checks || []), ...(b.out || [])]) for (const [k, v] of Object.entries(it.settings || {})) walk(v, it.part, k);
  return out;
}
async function readTrials(gh) {   // 通しの試しの報告（trial.py が custom/trials/<id>.json に書く）。{レシピの id: 報告}
  const ls = await gh('GET', '/contents/cloud/lines/custom/trials');
  if (ls.status !== 200 || !Array.isArray(ls.json)) return {};
  const rows = await Promise.all(ls.json.filter(f => /^[\w.-]+\.json$/.test(f.name)).slice(0, 60).map(async f => { try { const r = JSON.parse(await readFile(gh, f.path)); return [f.name.replace(/\.json$/, ''), { 日時: r['日時'], ok: !!r.ok, problems: (r.problems || []).slice(0, 40), steps: (r.steps || []).slice(0, 60), 仮の材料: r['仮の材料'] || [] }]; } catch { return null; } }));
  return Object.fromEntries(rows.filter(Boolean));
}
async function readCompany(gh) { try { return JSON.parse((await readFile(gh, 'cloud/lines/company.json')) || '{}'); } catch { return {}; } }
async function stoppedIssues(gh) {
  const r = await gh('GET', `/issues?state=open&labels=${encodeURIComponent('止まった')}&per_page=30`);
  if (r.status !== 200 || !Array.isArray(r.json)) return [];
  return r.json.filter(i => !i.pull_request).map(i => {
    const body = String(i.body || ''), nd = /<!--\s*needs:\s*([^>]*?)\s*-->/.exec(body);
    return { n: i.number, name: String(i.title || '').replace(/^⚠️\s*止まっているレシピ：/, '').trim(), why: body.split('\n\n直したら')[0].replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 1500), needs: nd ? nd[1].split(',').map(x => x.trim()).filter(Boolean) : [], at: i.created_at };
  });
}

const modeRank = m => ({ '本番': 0, '影': 1, '停止': 3 }[m] ?? 2);
function jobOf(rec, runs, approvals, live, fix = { needs: [], stopped: [], trial: null }) {
  const mine = runs.filter(r => r.job === rec.id), last = mine[mine.length - 1] || null, l = live[rec.id] || null;
  const waiting = approvals.filter(a => a.job === rec.id).length;
  const trialNg = fix.trial && !fix.trial.ok ? fix.trial.problems.length : 0;
  const needs = fix.needs.length, stopped = fix.stopped.length, broken = rec.mode !== '停止' && (needs || stopped || trialNg);
  const status = waiting ? '承認待ち' : l && l.running ? '実行中' : broken ? (needs ? '設定が必要' : trialNg ? '直すことあり' : '止まっています') : rec.mode === '停止' ? '停止中' : rec.mode === '影' ? '試し（影）' : rec.mode === '本番' ? '稼働中' : rec.mode || '—';
  return { id: rec.id, name: rec.name, purpose: rec.purpose, when: rec.when, mode: rec.mode, kind: rec.kind, approval: rec.approval, status, waiting, running: !!(l && l.running), last, runs: mine.length, needs, stopped, trial: fix.trial ? { ok: fix.trial.ok, problems: trialNg, 日時: fix.trial['日時'] } : null,
    steps: { in: (rec.in || []).map(x => x.name || x.part), ai: rec.ai, checks: rec.checks || [], out: rec.out || [] } };
}

async function gather(env, gh, hub) {
  const [shelf, runs, approvals, recent, company, stopped, trials] = await Promise.all([shelfData(gh).catch(e => ({ error: String(e.message || e) })), readRuns(gh).catch(() => []), openApprovals(gh).catch(() => []), (hub ? hub.recent() : Promise.resolve([])).catch(() => []), readCompany(gh), stoppedIssues(gh).catch(() => []), readTrials(gh).catch(() => ({}))]);
  const live = liveState(recent);
  const fixes = Object.fromEntries((shelf.recipes || []).map(r => [r.id, { needs: needsOf(r, company, shelf.parts), stopped: stopped.filter(i => i.name === r.name || i.name === r.id), trial: trials[r.id] || null }]));
  const jobs = (shelf.recipes || []).map(r => jobOf(r, runs, approvals, live, fixes[r.id])).sort((a, b) => modeRank(a.mode) - modeRank(b.mode) || (b.last ? 1 : 0) - (a.last ? 1 : 0) || a.name.localeCompare(b.name, 'ja'));
  const names = Object.fromEntries(jobs.map(j => [j.id, j.name]));
  return { shelf, runs, approvals: approvals.map(a => ({ ...a, name: names[a.job] || a.job })), recent, live, jobs, names, company, stopped, fixes };
}

async function summary(env, gh, hub) {
  const g = await gather(env, gh, hub);
  const [builds, usage] = await Promise.all([listBuilds(gh, 6).catch(() => []), monthUsage(env, gh).catch(() => null)]);
  return { api: API_VERSION, setup: { finished: await setupFinished(env), shelf: !g.shelf.error, note: g.shelf.error || '' },
    usage, counts: { jobs: g.jobs.filter(j => j.mode && j.mode !== '停止').length, running: g.jobs.filter(j => j.running).length, attention: g.approvals.length },
    attention: g.approvals, fix: g.jobs.filter(j => j.mode !== '停止' && (j.needs || j.stopped || (j.trial && !j.trial.ok))).map(j => ({ id: j.id, name: j.name, needs: j.needs, stopped: j.stopped, problems: j.trial && !j.trial.ok ? j.trial.problems : 0 })), jobs: g.jobs, recent: g.runs.slice(-10).reverse().map(r => ({ ...r, name: g.names[r.job] || r.job })), builds };
}

async function jobDetail(env, gh, hub, id) {
  const g = await gather(env, gh, hub), job = g.jobs.find(j => j.id === id);
  if (!job) return null;
  const rec = (g.shelf.recipes || []).find(r => r.id === id) || {};
  return { job: { ...job, stop_words: rec.stop_words || [], limit: rec.limit || {}, ai_instruction: rec.ai_instruction || '' }, share: shareItems(g.shelf, rec),
    runs: g.runs.filter(r => r.job === id).slice(-30).reverse(), approvals: g.approvals.filter(a => a.job === id), live: g.live[id] || null, fix: g.fixes[id] || { needs: [], stopped: [], trial: null },
    recent: (g.recent || []).filter(e => e.kind === 'run' && e.job_id === id).slice(-40) };
}

// ── 大元へ戻す印：この仕事が使う御社だけの部品（custom）と、御社だけの仕事そのもの。印は custom/share.json（shelf.js の toggleShare と同じ決まり）
export function shareItems(shelf, rec) {
  const s = shelf.share || {}, b = rec.blocks || {};
  const used = new Set([...(rec.in || []).map(x => x.part), ...(rec.checks || []), ...(rec.out || []), ...[...(b.in || []), ...(b.checks || []), ...(b.out || [])].map(x => x.part)]);
  const items = (shelf.parts || []).filter(p => p.custom && used.has(p.name)).map(p => ({ kind: 'part', name: p.name, desc: p.desc || '', on: (s.parts || []).includes(p.name) }));
  if (rec.kind === 'お客様だけ') items.push({ kind: 'recipe', name: rec.id, desc: rec.name || rec.id, on: (s.recipes || []).includes(rec.id) });
  return items;
}
async function saveShare(gh, b) {
  const data = await shelfData(gh); if (data.error) return [{ error: data.error }, 409];
  const r = toggleShare(data, data.share, { kind: b.kind === 'recipe' ? 'recipe' : 'part', name: String(b.name || ''), on: b.on !== false });
  if (r.error) return [r, 400];
  await commitFiles(gh, { 'cloud/lines/custom/share.json': { mode: '100644', content: JSON.stringify(r.share) + '\n' } }, `画面：大元へ戻す印を${b.on === false ? '外した' : '付けた'}：${b.name}`);
  return [{ ok: true, share: r.share, msg: b.on === false ? '大元へ戻す印を外しました' : '印を付けました。今夜21時ごろに確かめ（テスト・個人情報）が走り、通れば Orbit の担当が中身を見て取り込みます' }, 200];
}

// ── 通知センター：お客様の記録から組み立てる（大元には置かない）。既読はこの端末ごと（read:<端末の指紋>）
const WEEK = 7 * 24 * 3600 * 1000;
const jstMs = s => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : 0; };   // runs.csv の日時は日本時間
async function notices(env, gh, hub, fp, now = Date.now()) {
  const g = await gather(env, gh, hub), builds = await listBuilds(gh, 12).catch(() => []);
  const list = [];
  for (const i of g.stopped) { const j = g.jobs.find(x => x.name === i.name || x.id === i.name); list.push({ id: `s:${i.n}`, kind: 'error', title: `${i.name}が止まっています`, body: i.needs.length ? '会社の設定が足りません。画面から入れられます' : i.why.slice(0, 80), at: Date.parse(i.at) || now, to: j ? { page: 'job', id: j.id } : { page: 'jobs' } }); }
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
const MODE_WORDS = { '本番': '本番にして', '影': '影にして', '停止': '止めて', '再開': '再開して', '今すぐ': '動かして', '試す': '試して' };   // 試す＝通しの試し（外に出さない・後ろの段まで）
async function changeMode(gh, b, jobs) {
  const job = jobs.find(j => j.id === String(b.id || ''));
  if (!job) return [{ error: 'その仕事は見つかりません' }, 404];
  const w = MODE_WORDS[b.to];
  if (!w) return [{ error: '変え方は 本番・影・停止・再開・今すぐ・試す のどれかです' }, 400];
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

// ── 会社の設定を保存する（画面の「直すこと」から）。入れてよいのは、どれかのレシピが参照している設定だけ・鍵らしい名前は断る・値は文字／文字の並び／名前→文字の表
export function cleanValue(v) {
  const str = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 500;
  if (typeof v === 'string') return str(v) ? v.trim() : null;
  if (Array.isArray(v)) return v.length <= 50 && v.every(str) ? v.map(x => x.trim()) : null;
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length > 0 && e.length <= 50 && e.every(([k, x]) => str(k) && k.length <= 60 && str(x)) ? Object.fromEntries(e.map(([k, x]) => [k.trim(), x.trim()])) : null; }
  return null;
}
export const setPath = (o, path, v) => { const ks = path.split('.'); let cur = o; for (const k of ks.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {}; cur = cur[k]; } cur[ks[ks.length - 1]] = v; return o; };
async function saveSetting(env, gh, hub, b) {
  const path = String(b.path || '');
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,5}$/.test(path)) return [{ error: '設定の名前の形が違います' }, 400];
  if (SECRETISH.test(path)) return [{ error: '鍵・パスワードは、この画面では入れられません。設定のページで入れてください（鍵は暗号化して御社の GitHub に入ります）', code: 'secret' }, 400];
  const g = await gather(env, gh, hub);
  const used = new Set(); for (const r of g.shelf.recipes || []) for (const it of [...((r.blocks || {}).in || []), ...((r.blocks || {}).checks || []), ...((r.blocks || {}).out || [])]) for (const v of Object.values(it.settings || {})) for (const m of JSON.stringify(v).matchAll(REF)) used.add(m[1]);
  if (!used.has(path)) return [{ error: 'その設定は、どの仕事も使っていません' }, 400];
  const value = cleanValue(b.value);
  if (value === null) return [{ error: '値を入れてください（1つの値は500字まで・表は50行まで）' }, 400];
  const company = setPath(JSON.parse(JSON.stringify(g.company || {})), path, value);
  await commitFiles(gh, { 'cloud/lines/company.json': { mode: '100644', content: JSON.stringify(company, null, 2) + '\n' } }, `画面：会社の設定 ${path} を入れた`);
  let closed = 0;   // 足りない設定が原因で止まっていた知らせは、全部そろったら閉じる
  for (const i of g.stopped) if (i.needs.length && i.needs.every(p => p === path || !empty(getPath(company, p)))) {
    await gh('POST', `/issues/${i.n}/comments`, { body: '画面から会社の設定を入れました。次の回から動きます' }); await gh('PATCH', `/issues/${i.n}`, { state: 'closed' }); closed++;
  }
  return [{ ok: true, msg: `保存しました（${path}）${closed ? '。止まっていた知らせを閉じました' : ''}`, closed }, 200];
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
    if (path === '/app/api/settings') { const [o, st] = await saveSetting(env, gh, hub, b); return send(req, env, o, st); }
    if (path === '/app/api/share') { const [o, st] = await saveShare(gh, b); return send(req, env, o, st); }
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
