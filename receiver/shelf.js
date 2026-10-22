// 棚の画面（2026-10-19）：お客様の設定のページ（受け口の Worker）の /shelf。部品とレシピを ①見る ②組む ③育てる。
//   データの元：お客様のリポジトリの cloud/lines/shelf.json（pack の shelf.py が作る）と custom/recipes/*.json・custom/share.json。
//   画面が書くのは custom/builds（頼みの記録）と custom/share.json だけ。レシピと部品を作るのは Actions（build.yml・build_request.py）で、触れるのは custom/ の中だけ・モードは必ず「影」・承認は「止める」で始まる。出荷時のレシピ・部品を消す・変える道はない（パックの決まりと同じ）。
import { commitFiles } from './github_app.js';
import { monthUsage, budgetGuard } from './usage.js';
import { CSS, JS } from './shelf_ui.js';
import { BUILD_HTML } from './shelf_build_page.js';   // 組む（4つの口）の画面。元は shelf_build.html（build_shelf_page.py で書き出す）

const dec = new TextDecoder();
const unb64 = s => Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0));
const readFile = async (gh, path) => { const r = await gh('GET', `/contents/${path}`); return r.status === 200 && r.json.content ? dec.decode(unb64(r.json.content)) : null; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// ── データ：棚（shelf.json）＋ お客様だけのレシピ（custom/recipes）＋ 共有の印
export async function shelfData(gh) {
  const shelf = JSON.parse((await readFile(gh, 'cloud/lines/shelf.json')) || 'null');
  if (!shelf) return { error: '棚の一覧（cloud/lines/shelf.json）がまだありません。設定のページで「仕上げる」を押したあとに出ます' };
  let share = { parts: [], recipes: [] };
  try { share = { ...share, ...JSON.parse((await readFile(gh, 'cloud/lines/custom/share.json')) || '{}') }; } catch { }
  const custom = [];
  const ls = await gh('GET', '/contents/cloud/lines/custom/recipes');
  if (ls.status === 200 && Array.isArray(ls.json)) for (const f of ls.json.filter(x => /\.json$/.test(x.name)).slice(0, 40)) {
    try { const r = JSON.parse(await readFile(gh, f.path)); custom.push(summary(f.name.replace(/\.json$/, ''), 'お客様だけ', r)); } catch { }
  }
  const have = new Set(custom.map(x => x.id));
  return { ...shelf, recipes: [...shelf.recipes.filter(r => !(r.kind === 'お客様だけ' && have.has(r.id))), ...custom], share };
}
function summary(id, kind, r) {
  const ap = r['承認'] || {};
  return { id, kind, name: r['名前'] || id, purpose: r['目的'] || '', when: r['いつ'] || '', mode: r['モード'] || '', approval: ap['既定'] || (ap['止める言葉'] ? '決まりで止める' : ''), stop_words: ap['止める言葉'] || [],
    in: (r['入口'] || []).map(x => ({ part: x['部品'], name: x['名前'] || '' })), ai: (r['中身'] || {})['型'] || '', checks: (r['確かめ'] || []).map(x => x['部品']), out: (r['出口'] || []).map(x => x['部品']), limit: r['上限'] || {}, share: r['共有'],
    blocks: { in: (r['入口'] || []).map(x => ({ part: x['部品'], label: x['名前'] || '', settings: x['設定'] || {} })), checks: (r['確かめ'] || []).map(x => ({ part: x['部品'], settings: x['設定'] || {} })), out: (r['出口'] || []).map(x => ({ part: x['部品'], settings: x['設定'] || {} })) },
    ai_instruction: (r['中身'] || {})['指示'] || '' };
}

// ── ③育てる：共有の印（custom/share.json）を付ける・外す。出せるのはお客様だけの部品（custom）だけ
export function toggleShare(shelf, share, b) {
  const name = String(b.name || ''), on = b.on !== false;
  if (b.kind === 'recipe') {   // お客様だけの仕事（レシピ）。使っている部品が大元の棚にない物は、夜の確かめで止まる（先に部品を共有する）
    if (!(shelf.recipes || []).some(r => r.id === name && r.kind === 'お客様だけ')) return { error: 'お客様だけの仕事だけ、共有の印を付けられます' };
    const recipes = new Set(share.recipes || []); on ? recipes.add(name) : recipes.delete(name);
    return { share: { parts: share.parts || [], recipes: [...recipes] } };
  }
  const p = shelf.parts.find(x => x.name === name);
  if (!p || !p.custom) return { error: 'お客様だけの部品（custom）だけ、共有の印を付けられます' };
  const parts = new Set(share.parts || []); on ? parts.add(name) : parts.delete(name);
  return { share: { parts: [...parts], recipes: share.recipes || [] } };
}

// ── 組む：4つの口の選び（slots.json）から、お客様だけのレシピ（custom/recipes）を作る（10/20）。AI は使わない。モードは必ず「影」・承認は「止める」。出荷時のレシピと同じ ID は使えない
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD = {   // 入力欄の形の確かめ（キーごと）。置き換えた値は、レシピの設定にそのまま入る
  spreadsheet: [/^[A-Za-z0-9_-]{20,}$/, 'スプレッドシートの ID は、URL の /d/ と /edit の間の文字です'],
  range: [/^[^\n'"{}]{1,80}$/, '読む範囲は、例のように書いてください（例：予定!A1:H500）'],
  from: [/^[a-z0-9][a-z0-9-]{0,29}$/, '知らせの種類の名前は、小文字の英数字とハイフンで書いてください（例：form）'],
  path: [/^(?!\/)(?!.*\.\.)[\w\-./*]{1,120}$/, 'ファイルの場所は、仕組みの中の相対の場所で書いてください（例：reports/*.md）'],
  to: [EMAIL, '送り先は、メールアドレスで書いてください'],
};
const fillIn = (v, vals) => typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m)) : Array.isArray(v) ? v.map(x => fillIn(x, vals)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillIn(x, vals)])) : v;
export function composeRecipe(shelf, b, now = Date.now()) {
  const err = m => ({ error: m }), sl = shelf.slots;
  if (!sl) return err('組む画面の元データがまだありません。設定のページで「仕上げる」を押したあとに出ます');
  const pick = (k, id) => (sl[k] || []).find(x => x.id === id);
  const s = pick('集め方', b.s), w = pick('書き方', b.w), d = pick('出し方', b.d), when = pick('いつ', b.when);
  const cs = (Array.isArray(b.c) ? b.c : []).map(id => pick('確かめ', id));
  if (!s || !w || !d || !when || cs.some(x => !x)) return err('選んだ組み合わせが見つかりません');
  if (!!s['来たらすぐ'] !== (when.id === 'now')) return err(s['来たらすぐ'] ? '「入力が来たら」の仕事は、動かす時を「来たらすぐ」にしてください' : '「来たらすぐ」は、入力が来たら動く集め方でだけ選べます');
  const name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 40) return err('仕事の名前を、2〜40字で入れてください');
  const vals = {};
  for (const f of [...(s['入力'] || []), ...(d['入力'] || [])]) {
    const v = String((b.inputs || {})[f['キー']] ?? f['既定'] ?? '').trim();
    if (!v) return err(`「${f['名前']}」を入れてください`);
    const rule = FIELD[f['キー']]; if (rule && !rule[0].test(v)) return err(rule[1]);
    vals[f['キー']] = v;
  }
  const id = String(b.id || '').trim() || 'my-' + now.toString(36);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return err('レシピの ID は、小文字の英数字とハイフンで2文字以上にしてください');
  if ((shelf.recipes || []).some(r => r.id === id)) return err('同じ ID の仕事がすでにあります');
  const copy = x => JSON.parse(JSON.stringify(x));
  const rec = { 名前: name, 目的: `${s['名前']}集めて、${w['名前']}、${d['名前']}仕事です`, いつ: when['レシピ'],
    ...(s['きっかけ'] ? { きっかけ: fillIn(copy(s['きっかけ']), vals) } : {}),
    入口: [{ 名前: '材料', 部品: s['入口']['部品'], 設定: fillIn(copy(s['入口']['設定']), vals) }], 仕事がなければ止める: ['材料'],
    中身: copy(w['中身']), 確かめ: cs.flatMap(c => fillIn(copy(c['確かめ']), vals)),
    出口: [{ 部品: d['出口']['部品'], 設定: fillIn(copy(d['出口']['設定']), vals) }],
    上限: { '1週の費用': 1, ...(s['来たらすぐ'] ? { '1日の回数': 30 } : {}) }, 承認: { 既定: '止める' }, モード: '影', 共有: false };
  const parts = Object.fromEntries((shelf.parts || []).map(p => [p.name, p.stage]));
  for (const [stage, list] of [['入口', rec.入口], ['確かめ', rec.確かめ], ['出口', rec.出口]]) for (const x of list) if (parts[x.部品] !== stage) return err(`部品「${x.部品}」が棚にないか、段が違います（${stage}）`);
  return { id, recipe: rec };
}

// ── つくる：言葉で頼む → 提案 → 承認 → 開発（10/20）。記録は custom/builds/<番号>.json（状態・頼み・提案・結果）。提案と開発は Actions（build.yml）が、お客様の Claude で行う
const BUILD_ID = /^b[0-9a-z]{4,20}$/;
const ACTIVE = ['提案中', '開発中'], STALE_MS = 45 * 60 * 1000;   // 1日の回数の上限はやめた：今月の使った量（usage.js）で止める（10/22 オーナー）
const buildPath = id => `cloud/lines/custom/builds/${id}.json`;
const stale = r => ACTIVE.includes(r['状態']) && Date.now() - (r['更新'] || 0) > STALE_MS;
const shown = (id, r) => ({ id, ...(stale(r) ? { ...r, 状態: '失敗', 理由: 'うまく進みませんでした。もう一度、頼んでみてください' } : r) });
async function readBuild(gh, id) { try { return JSON.parse(await readFile(gh, buildPath(id)) || 'null'); } catch { return null; } }
export async function listBuilds(gh, limit = 12) {
  const ls = await gh('GET', '/contents/cloud/lines/custom/builds');
  if (ls.status !== 200 || !Array.isArray(ls.json)) return [];
  const ids = ls.json.map(f => f.name.replace(/\.json$/, '')).filter(i => BUILD_ID.test(i)).sort().reverse().slice(0, limit);
  const rows = await Promise.all(ids.map(async id => { const r = await readBuild(gh, id); return r && shown(id, r); }));
  return rows.filter(Boolean);
}
async function putBuild(gh, id, r, message) { await commitFiles(gh, { [buildPath(id)]: { mode: '100644', content: JSON.stringify(r, null, 1) + '\n' } }, message); }
async function startStep(gh, id, r, step, message) {
  await putBuild(gh, id, r, message);
  const d = await gh('POST', '/actions/workflows/build.yml/dispatches', { ref: 'main', inputs: { id, step } });
  if (d.status === 204) return { ok: true, id };
  await putBuild(gh, id, { ...r, 状態: '失敗', 理由: '作業を始められませんでした。少し待って、もう一度試してください' }, `つくる：起動できず ${id}`);
  return { error: `作業を始められませんでした（GitHub ${d.status}）。少し待って、もう一度試してください` };
}
// 頼み方の確かめ（暴走と費用の守り）：長さ・同時に1つだけ・今月の使った量（Actions の分・AI の費用）が上限に近くないか
export function askGuard(rows, text, now = Date.now(), usage = null) {
  const t = String(text || '').trim();
  if (t.length < 5) return '作りたい仕事を、もう少し詳しく書いてください（例：問い合わせが来たら担当にすぐ知らせたい）';
  if (t.length > 1500) return '長すぎます。1500字までにしてください';
  if (rows.some(r => ACTIVE.includes(r['状態']) && !stale(r))) return 'いま、ほかの依頼を作業中です。終わってから頼んでください';
  return budgetGuard(usage);
}
const forgetTables = async env => { try { if (env && env.CONFIG) { await env.CONFIG.delete('schedule'); await env.CONFIG.delete('triggers'); } } catch (e) { /* 控えが消せなくても、1時間で入れ替わる */ } };
export async function buildRoute(req, env, gh, url, path) {   // 大元の画面（app_api.js）からも呼ぶ（10/22）
  if (path === '/shelf/builds' && req.method === 'GET') return json({ builds: await listBuilds(gh) });
  if (path === '/shelf/build' && req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const r = BUILD_ID.test(id) ? await readBuild(gh, id) : null;
    if (r && r['状態'] === '完成') await forgetTables(env);   // 作った仕事が定時・出来事で動けるよう、表の控えを捨てる
    return r ? json(shown(id, r)) : json({ error: '見つかりません' }, 404);
  }
  if (req.method !== 'POST') return null;
  const b = await req.json().catch(() => null); if (!b) return json({ error: '形が違います' }, 400);
  if (path === '/shelf/ask') {
    const rows = await listBuilds(gh, 40), bad = askGuard(rows, b.text, Date.now(), await monthUsage(env || {}, gh).catch(() => null));
    if (bad) return json({ error: bad }, 429);
    const id = 'b' + Date.now().toString(36), r = { 状態: '提案中', 頼み: String(b.text).trim(), もと: String(b.from || '').slice(0, 60), 日時: Date.now(), 更新: Date.now() };
    const out = await startStep(gh, id, r, 'propose', `つくる：頼み ${id}`);
    return json(out, out.error ? 502 : 200);
  }
  const id = String(b.id || ''), r = BUILD_ID.test(id) ? await readBuild(gh, id) : null;
  if (!r) return json({ error: '見つかりません' }, 404);
  if (path === '/shelf/build/approve') {   // 作る段で落ちた依頼（承認済み・提案あり）は、提案をやり直さずに同じ提案で作り直せる（10/22）
    const retry = r['状態'] === '失敗' && r['承認'] && r['提案'];
    if (r['状態'] !== '提案できた' && !retry) return json({ error: '承認できるのは、提案ができた依頼だけです' }, 409);
    const out = await startStep(gh, id, { ...r, 状態: '開発中', 承認: Date.now(), 更新: Date.now() }, 'make', `つくる：承認 ${id}`);
    return json(out, out.error ? 502 : 200);
  }
  if (path === '/shelf/build/answer') {
    const t = String(b.text || '').trim();
    if (t.length < 2 || t.length > 1500) return json({ error: '直してほしい点を、1500字までで書いてください' }, 400);
    if (!['提案できた', '失敗'].includes(r['状態'])) return json({ error: 'いまは直しを受けられません' }, 409);
    const out = await startStep(gh, id, { ...r, 状態: '提案中', 追加: [...(r['追加'] || []), t].slice(-5), 更新: Date.now() }, 'propose', `つくる：直し ${id}`);
    return json(out, out.error ? 502 : 200);
  }
  if (path === '/shelf/build/cancel') {
    if (r['状態'] === '開発中' && !stale(r)) return json({ error: '作っている最中は、やめられません（終わるまでお待ちください）' }, 409);
    await putBuild(gh, id, { ...r, 状態: 'やめた', 更新: Date.now() }, `つくる：やめた ${id}`);
    return json({ ok: true });
  }
  return null;
}

export async function shelfRoute(req, env, gh, url) {
  const path = url.pathname;
  if (path === '/shelf' && req.method === 'GET') return new Response(null, { status: 302, headers: { location: '/shelf/build' } });   // 仕事を頼む入口は「組む」（10/21 オーナー：棚・道具箱・育てるの画面は使わない）
  if (path === '/shelf/make' && req.method === 'GET') return page();   // 言葉で頼む（つくる）だけ
  if (path === '/shelf/data' && req.method === 'GET') return json(await shelfData(gh));
  if (path === '/shelf/build' && req.method === 'GET' && !url.searchParams.has('id')) return buildPage();   // 組む（4つの口）の画面
  if (path === '/shelf/compose' && req.method === 'POST') {
    const b = await req.json().catch(() => null); if (!b) return json({ error: '形が違います' }, 400);
    const data = await shelfData(gh); if (data.error) return json(data, 409);
    const r = composeRecipe(data, b); if (r.error) return json(r, 400);
    await commitFiles(gh, { [`cloud/lines/custom/recipes/${r.id}.json`]: { mode: '100644', content: JSON.stringify(r.recipe, null, 2) + '\n' } }, `棚の画面から新しい仕事「${r.recipe['名前']}」（影で始まる）`);
    await forgetTables(env);   // 定時・出来事の表の控えを捨てる（次の見回りで、表の更新 workflow が直した新しい表を読む）
    return json({ ok: true, id: r.id, note: '作りました。最初の1週間は「試し（影）」で動き、外には出ません' });
  }
  if (path.startsWith('/shelf/ask') || path.startsWith('/shelf/build')) return buildRoute(req, env, gh, url, path);
  if (req.method !== 'POST' || path !== '/shelf/share') return null;
  const b = await req.json().catch(() => null); if (!b) return json({ error: '形が違います' }, 400);
  const data = await shelfData(gh); if (data.error) return json(data, 409);
  const r = toggleShare(data, data.share, b); if (r.error) return json(r, 400);
  await commitFiles(gh, { 'cloud/lines/custom/share.json': { mode: '100644', content: JSON.stringify(r.share) + '\n' } }, `棚の画面から共有の印を${b.on === false ? '外した' : '付けた'}：${b.name}`);
  return json({ ok: true, share: r.share, note: b.on === false ? '共有の印を外しました' : '今夜の定時（21時ごろ）に共有の確かめが走ります' });
}

const buildPage = () => new Response(BUILD_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });

// ── 画面（仕事 → 組む → つくる → 道具箱 → 育てる）。見た目と動きは shelf_ui.js
const page = () => new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>言葉で頼む</title><style>${CSS}</style></head><body><main>
<div class="top"><h1>言葉で頼む</h1><nav><a class="nl" href="/shelf/build">組む</a><button data-t="make" aria-pressed="true">言葉で頼む</button></nav><span class="sp"></span><a href="/setup" class="mu">設定のページへ</a></div>
<script>location.hash='make'</script>
<div id="app" class="mu">読み込み中…</div></main><script>${JS}</script></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
