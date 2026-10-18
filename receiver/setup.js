// 設定のページ（2026-10-18）：お客様が「Deploy to Cloudflare」で置いた Worker の /setup。上から順に埋めるだけで導入が終わる。
//   1. GitHub につなぐ（ボタン1つ・お客様名義の GitHub App）  2. 導入コード（担当者の下書きを取り込む）
//   3. Google で許可（シートの置き場をこの仕組みが作る・drive.file だけ）  4. 鍵（Discord のウェブフック・Buffer・メール・Claude）
//   5. 仕上げ（会社の設定とレシピを入れ、診断を流す）
// 承認のページ /a/<Issue>?s=<署名>（Discord の知らせのリンクから）と、指示のページ /i も、ここで受ける。
// 入口は合言葉（Deploy のときにお客様が決めた SETUP_PASSWORD）。鍵の値は画面にも記録にも二度と出さない。
import { repoApi, manifest, convert, putSecret, putFile, installationToken, call } from './github_app.js';

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(text))).slice(0, 32);
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const random = n => b64u(crypto.getRandomValues(new Uint8Array(n)));

const CSS = `:root{--bg:#f4f5f1;--surface:#fff;--fg:#1f2622;--muted:#5f6b64;--line:#d6ddd7;--good:#1f6f5c;--bad:#b03a3a;--chip:#eef1ee}
@media (prefers-color-scheme:dark){:root{--bg:#141917;--surface:#1c2320;--fg:#e3eae6;--muted:#9aa7a0;--line:#33403a;--good:#6cc7ad;--bad:#ec8a8a;--chip:#232b27}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 "Hiragino Sans","Noto Sans JP",system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 56px;display:grid;gap:14px}h1{font-size:1.35rem;margin:0}p{margin:0}
.muted{color:var(--muted);font-size:.9rem}.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;display:grid;gap:10px}
.card h2{font-size:1.05rem;margin:0;display:flex;gap:8px;align-items:center}.n{width:26px;height:26px;border-radius:50%;background:var(--chip);display:grid;place-items:center;font-size:.85rem}
.ok .n{background:var(--good);color:#fff}.tag{font-size:.75rem;color:var(--good);font-weight:700}
input,textarea{width:100%;font:inherit;font-size:16px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);color:var(--fg)}
label{display:grid;gap:4px;font-size:.9rem}button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:12px 16px;background:var(--good);color:#fff;cursor:pointer;min-height:44px}
button.sub{background:var(--chip);color:var(--fg)}.row{display:flex;gap:8px;flex-wrap:wrap}.err{color:var(--bad)}.code{font-size:1.6rem;font-weight:700;letter-spacing:.1em}
ol{margin:0;padding-left:1.2em}pre{white-space:pre-wrap;background:var(--chip);border-radius:8px;padding:10px;margin:0;font:inherit;font-size:.9rem;max-height:420px;overflow:auto}a{color:var(--good)}`;
const page = (title, body) => new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
const go = (to, cookie) => new Response(null, { status: 303, headers: { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) } });

async function state(env) { return (await env.CONFIG.get('done', 'json')) || { secrets: [] }; }
async function mark(env, patch) { const s = { ...(await state(env)), ...patch }; await env.CONFIG.put('done', JSON.stringify(s)); return s; }
async function loggedIn(env, req) {
  if (!env.SETUP_PASSWORD) return false;
  const c = /(?:^|;\s*)setup=([^;]+)/.exec(req.headers.get('cookie') || '');
  return !!c && same(c[1], await hmac(env.SETUP_PASSWORD, 'setup'));
}
async function tell(env, event, extra = {}) {   // 担当者に進み具合を知らせる（失敗しても導入は止めない）
  const code = await env.CONFIG.get('code');
  if (!code || !env.ONBOARD_API) return;
  try { await fetch(env.ONBOARD_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: code, event, ...extra }) }); } catch { }
}

// ── 設定のページ
function view(s, origin, msg = '') {
  const card = (n, ok, title, body) => `<section class="card ${ok ? 'ok' : ''}"><h2><span class="n">${ok ? '✓' : n}</span>${title}${ok ? '<span class="tag">済み</span>' : ''}</h2>${body}</section>`;
  const has = k => (s.secrets || []).includes(k);
  const gh = s.github ? `<p class="muted">${esc(s.repo)} につながっています</p>` : `<p>ボタンを押すと GitHub が開きます。「Create GitHub App」→ このリポジトリだけを選んで「Install」を押してください（1分）</p><form method="post" action="/setup/github"><button>GitHub につなぐ</button></form>`;
  const draft = s.draft ? `<p class="muted">${esc(s.company || '')} の設定を取り込みました</p>` : `<p>担当者からお送りした「導入コード」を入れてください</p><form method="post" action="/setup/draft" class="row"><input name="code" required placeholder="例：2IhxierPpcuc" autocomplete="off"><button>取り込む</button></form>`;
  const google = s.google ? `<p class="muted">台帳（Google スプレッドシート）を作りました。<a href="https://docs.google.com/spreadsheets/d/${esc(s.sheet)}/edit" target="_blank" rel="noopener">開く</a></p>`
    : `<p>ボタンを押すとコードが出ます。Google の画面にそのコードを入れて「許可」を押してください。この仕組みが作るシートだけを使い、ほかのファイルは見ません（1分）</p><button id="g" type="button">Google で許可</button><div id="gout" class="muted"></div>`;
  const field = (name, label, hint, type = 'text') => has(name) ? `<p class="muted">${label}：入っています（変えるときだけ入れ直す）</p><label>${label}<input name="${name}" type="${type}" autocomplete="off"></label>` : `<label>${label}<input name="${name}" type="${type}" autocomplete="off" placeholder="${esc(hint)}"></label>`;
  const keys = `<form method="post" action="/setup/secrets" style="display:grid;gap:12px">
    <details><summary>Discord のウェブフック URL の出し方（3分）</summary><ol><li>Discord で御社のサーバーを作る（あれば使う）</li><li>知らせを受けるチャンネルの ⚙（チャンネルの編集）→「連携サービス」→「ウェブフック」→「新しいウェブフック」</li><li>「ウェブフック URL をコピー」して、下に貼る</li></ol></details>
    ${field('DISCORD_WEBHOOK_URL', 'Discord のウェブフック URL', 'https://discord.com/api/webhooks/…', 'url')}
    <details><summary>Buffer の鍵の出し方（SNS をつなぐ・8分）</summary><ol><li>https://buffer.com に Google でログインし、発信する SNS（Instagram はプロアカウント・Threads・X）を「チャンネル」としてつなぐ</li><li>「Settings」→「API」で鍵を作り、下に貼る</li></ol></details>
    ${field('BUFFER_API_KEY', 'Buffer の鍵', '')}
    <details><summary>メールの「アプリ パスワード」の出し方（3分）</summary><ol><li>https://myaccount.google.com/apppasswords を開く（2段階認証が要ります）</li><li>名前に「AI の係」と入れて作成 → 出た16文字を下に貼る</li></ol></details>
    ${field('MAIL_USER', '使うメールアドレス', 'example@gmail.com', 'email')}${field('MAIL_PASSWORD', 'アプリ パスワード（16文字）', '', 'password')}
    <details><summary>Claude の鍵の出し方（2分）</summary><p>API のときは https://console.anthropic.com の「API Keys」で作る。定額の Claude のときは、ターミナルで claude setup-token を流して出た鍵</p></details>
    ${field('CLAUDE_KEY', 'Claude の鍵（sk-ant- で始まる）', 'sk-ant-…', 'password')}
    <button>入れる（入れた物だけ・あとから足せます）</button></form>`;
  const ready = s.github && s.draft;
  const finish = s.finished ? `<p class="muted">診断を流しました。結果は Discord に届きます。最初の1週間は試し（書き込まない・送らない）で動きます</p><form method="post" action="/setup/finish"><button class="sub">もう一度、仕上げと診断を流す</button></form>`
    : ready ? `<p>入れ終わったら押してください。会社の設定とレシピを入れ、正しく動くかを診断します（結果は Discord へ）</p><form method="post" action="/setup/finish"><button>仕上げる</button></form>` : `<p class="muted">1と2が済むと押せます</p>`;
  const script = s.google ? '' : `<script>
document.getElementById('g').onclick=async()=>{const o=document.getElementById('gout');o.textContent='準備しています…';
const r=await (await fetch('/setup/google/start',{method:'POST'})).json();if(r.error){o.innerHTML='<span class=err>'+r.error+'</span>';return}
o.innerHTML='<p>コード：<span class=code>'+r.user_code+'</span></p><p><a href="'+r.verification_url+'" target="_blank" rel="noopener">Google の画面を開く</a> → コードを入れて「許可」</p><p>待っています…</p>';
const t=setInterval(async()=>{const p=await (await fetch('/setup/google/poll',{method:'POST'})).json();if(p.status==='ok'){clearInterval(t);location.reload()}else if(p.status==='error'){clearInterval(t);o.innerHTML+='<p class=err>'+p.error+'</p>'}},(r.interval||5)*1000)}</script>`;
  return page('AI の仕組みの設定', `<h1>AI の仕組みの設定</h1><p class="muted">上から順に進めてください。終わった所には ✓ が付きます。鍵は暗号化して御社の GitHub に入り、担当者にも見えません</p>
    ${msg ? `<p class="${msg.startsWith('⚠') ? 'err' : 'muted'}">${esc(msg)}</p>` : ''}
    ${card(1, s.github, 'GitHub につなぐ', gh)}${card(2, s.draft, '導入コード', draft)}${card(3, s.google, 'Google で許可', google)}
    ${card(4, ['DISCORD_WEBHOOK_URL', 'BUFFER_API_KEY', 'MAIL_PASSWORD'].every(has) && (has('CLAUDE_CODE_OAUTH_TOKEN') || has('ANTHROPIC_API_KEY')), '鍵を入れる', keys)}
    ${card(5, s.finished, '仕上げ', finish)}
    <p class="muted">指示を出すページ：<a href="${origin}/i">${origin}/i</a>（この合言葉で入れます）</p>${script}`);
}

const login = (msg = '') => page('合言葉', `<h1>合言葉を入れてください</h1><p class="muted">Deploy のときに決めた合言葉（SETUP_PASSWORD）です</p>${msg ? `<p class="err">${esc(msg)}</p>` : ''}
  <form method="post" action="/setup/login" style="display:grid;gap:10px"><input name="password" type="password" required autofocus><button>入る</button></form>`);

async function form(req) { return Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v).trim()])); }

// ── 各段の処理
async function connectGithub(env, origin) {
  const st = random(12); await env.CONFIG.put('gh_state', st, { expirationTtl: 1800 });
  const host = new URL(origin).hostname.split('.')[0].slice(0, 20);
  const m = manifest(origin, `ai-${host}-${random(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.slice(0, 34));
  return page('GitHub へ', `<p>GitHub に移ります…</p><form id="f" method="post" action="https://github.com/settings/apps/new?state=${st}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(m))}"><button>進まないときは押す</button></form><script>document.getElementById('f').submit()</script>`);
}

async function afterInstall(env, origin, gh) {
  // このリポジトリ（仕組みの入った物）を探して覚え、承認のリンク用の鍵と受け口の URL を入れる
  const token = await installationToken(env);
  const list = await call(token, 'GET', '/installation/repositories?per_page=100');
  const repos = (list.json.repositories || []).map(r => r.full_name);
  let repo = null;
  for (const name of repos) { if ((await call(token, 'GET', `/repos/${name}/contents/cloud/lines/recipe.py`)).status === 200) { repo = name; break; } }
  if (!repo) return `⚠ 仕組みの入ったリポジトリが見つかりません。GitHub の画面で、Deploy で作ったリポジトリを選んでください`;
  await env.CONFIG.put('repo', repo);
  let key = await env.CONFIG.get('approve_key');
  if (!key) { key = random(24); await env.CONFIG.put('approve_key', key); }
  await putSecret(gh, 'APPROVE_KEY', key); await putSecret(gh, 'RECEIVER_URL', origin);
  await mark(env, { github: true, repo, secrets: [...new Set([...(await state(env)).secrets, 'APPROVE_KEY', 'RECEIVER_URL'])] });
  return '';
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
async function googleStart(env) {
  if (!env.GOOGLE_CLIENT_ID) return { error: 'Google の設定（GOOGLE_CLIENT_ID）がまだありません。担当者にお知らせください' };
  const r = await fetch('https://oauth2.googleapis.com/device/code', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPE }) });
  const j = await r.json();
  if (!r.ok) return { error: `Google の準備に失敗しました（${j.error || r.status}）` };
  await env.CONFIG.put('gdev', j.device_code, { expirationTtl: j.expires_in || 1800 });
  return { user_code: j.user_code, verification_url: j.verification_url || j.verification_uri, interval: j.interval || 5 };
}
async function googlePoll(env, gh) {
  const dev = await env.CONFIG.get('gdev');
  if (!dev) return { status: 'error', error: '時間切れです。もう一度「Google で許可」を押してください' };
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET || '', device_code: dev, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
  const j = await r.json();
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { status: 'wait' };
  if (!r.ok || !j.refresh_token) return { status: 'error', error: `許可を受け取れませんでした（${j.error || r.status}）` };
  await env.CONFIG.delete('gdev');
  const head = ['種類', 'ID', '中身', '更新'].map(v => ({ userEnteredValue: { stringValue: v } }));
  const s = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { authorization: `Bearer ${j.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'AI の仕組みの台帳', locale: 'ja_JP', timeZone: 'Asia/Tokyo' }, sheets: [{ properties: { title: '作業台DB' }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: head }] }] }] }) });
  const sj = await s.json();
  if (!s.ok) return { status: 'error', error: `台帳を作れませんでした（${sj.error?.status || s.status}）` };
  await putSecret(gh, 'GOOGLE_OAUTH_JSON', JSON.stringify({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: j.refresh_token, token_uri: 'https://oauth2.googleapis.com/token' }));
  await putSecret(gh, 'WORKBENCH_SHEET', sj.spreadsheetId);
  const st = await state(env);
  await mark(env, { google: true, sheet: sj.spreadsheetId, secrets: [...new Set([...st.secrets, 'GOOGLE_OAUTH_JSON', 'WORKBENCH_SHEET'])] });
  return { status: 'ok' };
}

async function saveSecrets(env, gh, f) {
  const done = [], bad = [];
  const put = async (name, value) => { await putSecret(gh, name, value); done.push(name); };
  if (f.DISCORD_WEBHOOK_URL) {
    if (!/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(f.DISCORD_WEBHOOK_URL)) bad.push('Discord のウェブフック URL の形が違います');
    else {
      const r = await fetch(f.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '✅ AI の仕組みとつながりました。知らせと承認はこのチャンネルに届きます' }) });
      if (r.status === 204 || r.status === 200) await put('DISCORD_WEBHOOK_URL', f.DISCORD_WEBHOOK_URL); else bad.push(`Discord に送れませんでした（${r.status}）。URL を確かめてください`);
    }
  }
  if (f.BUFFER_API_KEY) await put('BUFFER_API_KEY', f.BUFFER_API_KEY);
  if (f.MAIL_USER) await put('MAIL_USER', f.MAIL_USER);
  if (f.MAIL_PASSWORD) await put('MAIL_PASSWORD', f.MAIL_PASSWORD.replace(/\s+/g, ''));
  if (f.CLAUDE_KEY) {
    if (/^sk-ant-oat/.test(f.CLAUDE_KEY)) await put('CLAUDE_CODE_OAUTH_TOKEN', f.CLAUDE_KEY);
    else if (/^sk-ant-/.test(f.CLAUDE_KEY)) await put('ANTHROPIC_API_KEY', f.CLAUDE_KEY);
    else bad.push('Claude の鍵は sk-ant- で始まります');
  }
  const st = await state(env);
  await mark(env, { secrets: [...new Set([...st.secrets, ...done])] });
  return bad.length ? `⚠ ${bad.join('／')}` : done.length ? `入れました：${done.length}件` : '';
}

async function importDraft(env, gh, code) {
  if (!/^[\w-]{8,40}$/.test(code)) return '⚠ 導入コードの形が違います';
  if (!env.ONBOARD_API) return '⚠ 取り込み先（ONBOARD_API）の設定がありません';
  const r = await fetch(`${env.ONBOARD_API}?t=${encodeURIComponent(code)}&draft=1`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.setup) return `⚠ ${j.error || '下書きがまだありません。担当者にお知らせください'}`;
  await putFile(gh, 'cloud/lines/draft.json', JSON.stringify(j.setup, null, 1) + '\n', '担当者の下書きを取り込む');
  await env.CONFIG.put('code', code);
  await mark(env, { draft: true, company: j.name || '' });
  return '';
}

async function finish(env, gh, origin) {
  const r = await gh('POST', '/actions/workflows/setup.yml/dispatches', { ref: 'main', inputs: {} });
  if (r.status !== 204) return `⚠ 仕上げを始められませんでした（${r.status}）。少しして、もう一度押してください`;
  const st = await mark(env, { finished: true });
  await tell(env, 'setup', { repo: st.repo, url: origin, secrets: st.secrets, google: !!st.google });
  return '仕上げを始めました（数分）。結果は Discord に届きます';
}

// ── 承認のページ（Discord の知らせのリンクから）
async function approval(req, env, gh, n, url) {
  const key = await env.CONFIG.get('approve_key');
  if (!key || !same(url.searchParams.get('s') || '', await hmac(key, `a:${n}`))) return page('承認', '<h1>このリンクは使えません</h1><p class="muted">知らせの中のボタンから開いてください</p>');
  const iss = await gh('GET', `/issues/${n}`);
  if (iss.status !== 200) return page('承認', `<h1>読み込めませんでした（${iss.status}）</h1>`);
  const title = String(iss.json.title || '').replace(/^⏸\s*/, '');
  if (req.method === 'POST') {
    if (iss.json.state === 'closed') return page('承認', `<h1>もう決まっています</h1><p>${esc(title)}</p>`);
    const f = await form(req), ok = f.ok === 'true';
    const r = await gh('POST', '/actions/workflows/resume.yml/dispatches', { ref: 'main', inputs: { issue: String(n), ok: String(ok), note: (f.note || '').slice(0, 1000), by: 'リンク' } });
    if (r.status !== 204) return page('承認', `<h1>受け付けられませんでした（${r.status}）</h1><p>少しして、もう一度押してください</p>`);
    return page('承認', `<h1>${ok ? '✅ 承認しました' : '❌ やめました'}</h1><p>${esc(title)}</p><p class="muted">${ok ? '続きを動かしています。結果は Discord に届きます' : ''}</p>`);
  }
  const body = String(iss.json.body || '').split('\n\n---\n')[0];
  if (iss.json.state === 'closed') return page('承認', `<h1>もう決まっています</h1><p>${esc(title)}</p><pre>${esc(body)}</pre>`);
  return page('承認', `<h1>${esc(title)}</h1><pre>${esc(body)}</pre><form method="post" style="display:grid;gap:10px">
    <label>直したい所・やめる理由（なくてよい）<textarea name="note" rows="3"></textarea></label>
    <div class="row"><button name="ok" value="true">✅ 承認する</button><button name="ok" value="false" class="sub">❌ やめる</button></div></form>`);
}

// ── 指示のページ
async function instruct(req, env, gh) {
  if (req.method === 'POST') {
    const text = ((await form(req)).text || '').slice(0, 2000);
    if (!text) return go('/i');
    const iss = await gh('POST', '/issues', { title: `📝 ${text.split('\n')[0].slice(0, 80)}`, body: `${text}\n<!-- by:ページ -->`, labels: ['指示'] });
    if (iss.status !== 201) return page('指示', `<h1>受け付けられませんでした（${iss.status}）</h1>`);
    await gh('POST', '/actions/workflows/instruct.yml/dispatches', { ref: 'main', inputs: { issue: String(iss.json.number) } });
    return page('指示', `<h1>受け付けました</h1><p>${esc(text)}</p><p class="muted">結果は Discord に届きます</p><p><a href="/i">続けて書く</a></p>`);
  }
  return page('指示', `<h1>仕事を頼む</h1><p class="muted">例：一覧・〇〇を動かして・〇〇を止めて・〇〇を再開して</p><form method="post" style="display:grid;gap:10px"><textarea name="text" rows="4" required></textarea><button>頼む</button></form>`);
}

// ── 入口（worker.js から呼ぶ）。扱わない道なら null
export async function route(req, env) {
  const url = new URL(req.url), path = url.pathname, origin = url.origin;
  if (!(path === '/setup' || path.startsWith('/setup/') || path === '/i' || /^\/a\/\d+$/.test(path) || (path === '/m' && req.method === 'POST'))) return null;
  if (!env.CONFIG) return page('設定', '<h1>置き場（CONFIG）がありません</h1><p class="muted">Deploy to Cloudflare のボタンから置き直してください</p>');
  const gh = repoApi(env);
  if (path === '/m') {   // 画像の置き場（Actions から。承認の鍵で確かめる）
    const key = await env.CONFIG.get('approve_key');
    if (!key || !same(req.headers.get('authorization') || '', `Bearer ${key}`) || !env.MEDIA) return new Response('forbidden', { status: 403 });
    const type = req.headers.get('content-type') || '';
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type];
    if (!ext) return new Response('PNG・JPEG・WebP だけ', { status: 415 });
    const name = random(16).toLowerCase().replace(/[^a-z0-9]/g, '0') + ext;
    await env.MEDIA.put(name, await req.arrayBuffer(), { metadata: { contentType: type } });
    return Response.json({ url: `${origin}/m/${name}` });
  }
  const a = /^\/a\/(\d+)$/.exec(path);
  if (a) return approval(req, env, gh, Number(a[1]), url);
  if (path === '/setup/login' && req.method === 'POST') {
    if (!env.SETUP_PASSWORD) return login('合言葉（SETUP_PASSWORD）がまだ決まっていません。Cloudflare の Worker の「設定」→「変数とシークレット」で入れてください');
    const f = await form(req);
    if (!same(await hmac(env.SETUP_PASSWORD, f.password || ''), await hmac(env.SETUP_PASSWORD, env.SETUP_PASSWORD))) return login('合言葉が違います');
    return go('/setup', `setup=${await hmac(env.SETUP_PASSWORD, 'setup')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  }
  // GitHub から戻る道（ログインのクッキーは SameSite=Lax で付いてくる）
  if (!(await loggedIn(env, req))) return login();
  if (path === '/i') return instruct(req, env, gh);
  let msg = '';
  try {
    if (path === '/setup/github' && req.method === 'POST') return connectGithub(env, origin);
    if (path === '/setup/github/back') {
      const st = await env.CONFIG.get('gh_state');
      if (!st || st !== url.searchParams.get('state')) return view(await state(env), origin, '⚠ 時間が経ちすぎました。もう一度「GitHub につなぐ」を押してください');
      const app = await convert(url.searchParams.get('code') || '');
      await env.CONFIG.put('app', JSON.stringify(app)); await env.CONFIG.delete('tok');
      return go(`https://github.com/apps/${app.slug}/installations/new`);
    }
    if (path === '/setup/github/installed') {
      const inst = url.searchParams.get('installation_id');
      if (!/^\d+$/.test(inst || '')) return view(await state(env), origin, '⚠ GitHub から戻れませんでした。もう一度押してください');
      await env.CONFIG.put('inst', inst); await env.CONFIG.delete('tok');
      msg = await afterInstall(env, origin, gh);
      if (!msg) await tell(env, 'github', { repo: await env.CONFIG.get('repo') });
    }
    if (path === '/setup/google/start' && req.method === 'POST') return Response.json(await googleStart(env));
    if (path === '/setup/google/poll' && req.method === 'POST') return Response.json(await googlePoll(env, gh));
    if (path === '/setup/secrets' && req.method === 'POST') msg = await saveSecrets(env, gh, await form(req));
    if (path === '/setup/draft' && req.method === 'POST') msg = await importDraft(env, gh, (await form(req)).code || '');
    if (path === '/setup/finish' && req.method === 'POST') msg = await finish(env, gh, origin);
  } catch (e) { msg = `⚠ ${String(e.message || e).slice(0, 200)}`; }
  return view(await state(env), origin, msg);
}
