// 設定のページ（2026-10-18）：受付がお客様の Cloudflare に置いた Worker の /setup（B の形：「Cloudflare で許可」のあと自動で開く）。上から順に埋めるだけで導入が終わる。
//   1. GitHub につなぐ（ボタン1つ・お客様名義の GitHub App）  2. 導入コード（担当者の下書きを取り込む）
//   3. Google で許可（シートの置き場をこの仕組みが作る・drive.file だけ）  4. 鍵（Discord のウェブフック・Buffer・メール・Claude）
//   5. 仕上げ（会社の設定とレシピを入れ、診断を流す）
// 承認のページ /a/<Issue>?s=<署名>（Discord の知らせのリンクから）と、指示のページ /i も、ここで受ける。
// 入口は合言葉（Deploy のときにお客様が決めた SETUP_PASSWORD）。鍵の値は画面にも記録にも二度と出さない。
import { shelfRoute } from './shelf.js';
import { repoApi, manifest, convert, putSecret, commitFiles, installationToken, call, userToken, ensureRepo } from './github_app.js';

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
button.sub,.btn.sub{background:var(--chip);color:var(--fg)}.btn{display:inline-flex;align-items:center;font-weight:700;border-radius:10px;padding:12px 16px;background:var(--good);color:#fff;text-decoration:none;min-height:44px}.moves{justify-content:space-between;align-items:center}.pass{color:var(--good);font-weight:700}
.steps{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:.9rem}.steps li{display:flex}.steps a,.steps li>span:first-child{color:var(--muted);text-decoration:none;display:flex;gap:8px;align-items:center}.steps li>span:first-child{width:22px}.steps span{width:22px;height:22px;border-radius:50%;background:var(--chip);display:grid;place-items:center;font-size:.75rem;flex:none}.steps .done span{background:var(--good);color:#fff}.steps .cur a{color:var(--fg);font-weight:700}.steps .cur span{outline:2px solid var(--good)}.steps small{color:var(--muted);font-weight:400}
.progress{position:sticky;bottom:0;background:var(--bg);padding:10px 0 4px;border-top:1px solid var(--line)}.ptext{font-size:.85rem;color:var(--muted);margin-bottom:6px}.track{height:10px;border-radius:999px;background:var(--chip);overflow:hidden}.fill{height:100%;background:var(--good);border-radius:999px;transition:width .3s}.row{display:flex;gap:8px;flex-wrap:wrap}.err{color:var(--bad)}.code{font-size:1.6rem;font-weight:700;letter-spacing:.1em}
ol{margin:0;padding-left:1.2em}pre{white-space:pre-wrap;background:var(--chip);border-radius:8px;padding:10px;margin:0;font:inherit;font-size:.9rem;max-height:420px;overflow:auto}a{color:var(--good)}`;
const page = (title, body) => new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
const go = (to, cookie) => new Response(null, { status: 303, headers: { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) } });

async function viewState(env) { const code = await env.CONFIG.get('code'); return { ...(await state(env)), auto: !!code, oauth: !!code && !!env.ONBOARD_API }; }
async function state(env) { return (await env.CONFIG.get('done', 'json')) || { secrets: [] }; }
async function mark(env, patch) { const s = { ...(await state(env)), ...patch }; await env.CONFIG.put('done', JSON.stringify(s)); return s; }
async function sessionKey(env) {   // ログインのクッキーの鍵：合言葉（古い形）か、置き場の鍵（B の形）
  if (env.SETUP_PASSWORD) return env.SETUP_PASSWORD;
  let k = await env.CONFIG.get('session_key');
  if (!k) { k = random(24); await env.CONFIG.put('session_key', k); }
  return k;
}
export async function loggedIn(env, req) {
  const c = /(?:^|;\s*)setup=([^;]+)/.exec(req.headers.get('cookie') || '');
  return !!c && same(c[1], await hmac(await sessionKey(env), 'setup'));
}
const loginCookie = async env => `setup=${await hmac(await sessionKey(env), 'setup')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
async function tell(env, event, extra = {}) {   // 担当者に進み具合を知らせる（失敗しても導入は止めない）
  const code = await env.CONFIG.get('code');
  if (!code || !env.ONBOARD_API) return;
  try { await fetch(env.ONBOARD_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: code, event, ...extra }) }); } catch { }
}

// ── 設定のページ（10/20 オーナー：全部を1枚に並べず、1つずつ進む形に。上に手順の順番、真ん中に今の手順と確かめ、下に進み具合のバー）
function view(s, origin, msg = '', want = '') {
  const has = k => (s.secrets || []).includes(k);
  const gh = s.github ? `<p class="muted">${esc(s.repo)} につながっています${s.auto && s.draft ? '（仕組みの中身も入りました）' : ''}</p>` : s.auto
    ? `<p>ボタンを押すと GitHub が開きます。GitHub のアカウントでログイン（なければ「Continue with Google」で作る）→ 本人確認でメールに届くコードを入れる →「Create GitHub App」→「Install」→「Authorize」の順に押してください。御社の GitHub に非公開のリポジトリができ、仕組みの中身が入ります（3分）</p><form method="post" action="/setup/github"><button>GitHub につなぐ</button></form>`
    : `<p>ボタンを押すと GitHub が開きます。「Create GitHub App」→ このリポジトリだけを選んで「Install」を押してください（1分）</p><form method="post" action="/setup/github"><button>GitHub につなぐ</button></form>`;
  const draft = s.draft ? `<p class="muted">${esc(s.company || '')} の設定を取り込みました</p>` : `<p>担当者からお送りした「導入コード」を入れてください</p><form method="post" action="/setup/draft" class="row"><input name="code" required placeholder="例：2IhxierPpcuc" autocomplete="off"><button>取り込む</button></form>`;
  const google = s.google ? `<p class="muted">台帳（Google スプレッドシート）を作りました。<a href="https://docs.google.com/spreadsheets/d/${esc(s.sheet)}/edit" target="_blank" rel="noopener">開く</a></p>`
    : `<p>ボタンを押すとコードが出ます。Google の画面にそのコードを入れて「許可」を押してください。この仕組みが作るシートだけを使い、ほかのファイルは見ません（1分）</p><button id="g" type="button">Google で許可</button><div id="gout" class="muted"></div>`;
  const field = (name, label, hint, type = 'text') => has(name) ? `<p class="muted">${label}：入っています（変えるときだけ入れ直す）</p><label>${label}<input name="${name}" type="${type}" autocomplete="off"></label>` : `<label>${label}<input name="${name}" type="${type}" autocomplete="off" placeholder="${esc(hint)}"></label>`;
  const slack = s.notify === 'slack', where = slack ? 'Slack' : 'Discord', hookKey = slack ? 'SLACK_WEBHOOK_URL' : 'DISCORD_WEBHOOK_URL';
  const hook = slack
    ? `<details open><summary>Slack の Incoming Webhook の出し方（3分）</summary><ol><li>https://api.slack.com/apps を開き「Create New App」→「From scratch」（名前は「Orbit Package」、ワークスペースは御社のもの）</li><li>左の「Incoming Webhooks」を On にし、「Add New Webhook to Workspace」で知らせを受けるチャンネルを選ぶ</li><li>出た「Webhook URL」をコピーして、下に貼る</li></ol></details>
    ${field('SLACK_WEBHOOK_URL', 'Slack の Webhook URL', 'https://hooks.slack.com/services/…', 'url')}`
    : `<details open><summary>Discord のウェブフック URL の出し方（3分）</summary><ol><li>Discord で御社のサーバーを作る（あれば使う）</li><li>知らせを受けるチャンネルの ⚙（チャンネルの編集）→「連携サービス」→「ウェブフック」→「新しいウェブフック」</li><li>「ウェブフック URL をコピー」して、下に貼る</li></ol></details>
    ${field('DISCORD_WEBHOOK_URL', 'Discord のウェブフック URL', 'https://discord.com/api/webhooks/…', 'url')}`;
  // 知らせの先（10/20）：Slack か Discord を選び、ログインしてチャンネルを選んで許可するだけ。URL を貼る形は「うまくいかないとき」に残す
  const connectButtons = `<p>知らせ（承認のお願い・診断の結果など）を受け取る先を選んでください。ログインして、受け取るチャンネルを選んで「許可」を押すだけです（1分）</p>
    <p class="muted">Slack：許可すると、Orbit のボットが <b>#orbit</b> を作って、押した人を招きます（同じ名前があれば #orbit-package）。Discord：先に <b>#orbit</b> という新しいチャンネルを作り、許可の画面でそこを選んでください。どちらも、いつもの業務のチャンネルには混ざりません</p>
    <div class="row"><form method="post" action="/setup/notify/start?svc=slack"><button>Slack に追加</button></form><form method="post" action="/setup/notify/start?svc=discord"><button>Discord につなぐ</button></form></div>
    <details><summary>うまくいかないとき：URL を貼って入れる</summary>${`<form method="post" action="/setup/secrets?step=notify" style="display:grid;gap:12px">${hook}<button class="sub">入れて、試しの知らせを送る</button></form>`}</details>`;
  const keyForm = (step, inner, label) => `<form method="post" action="/setup/secrets?step=${step}" style="display:grid;gap:12px">${inner}<button>${label}</button></form>`;
  const claude = `<details open><summary>Claude の鍵の出し方（2分）</summary><p>API のときは https://console.anthropic.com の「API Keys」で作る。定額の Claude のときは、PC のターミナルで claude setup-token を流して出た鍵</p></details>
    ${field('CLAUDE_KEY', 'Claude の鍵（sk-ant- で始まる）', 'sk-ant-…', 'password')}`;
  const extras = `<p class="muted">SNS の投稿やメールを仕事に使う会社だけ。使わなければ飛ばして大丈夫です（あとから足せます）</p>
    <details><summary>Buffer の鍵の出し方（SNS をつなぐ・8分）</summary><ol><li>https://buffer.com に Google でログインし、発信する SNS（Instagram はプロアカウント・Threads・X）を「チャンネル」としてつなぐ</li><li>「Settings」→「API」で鍵を作り、下に貼る</li></ol></details>
    ${field('BUFFER_API_KEY', 'Buffer の鍵', '')}
    <details><summary>メールの「アプリ パスワード」の出し方（3分）</summary><ol><li>https://myaccount.google.com/apppasswords を開く（2段階認証が要ります）</li><li>名前に「AI の係」と入れて作成 → 出た16文字を下に貼る</li></ol></details>
    ${field('MAIL_USER', '使うメールアドレス', 'example@gmail.com', 'email')}${field('MAIL_PASSWORD', 'アプリ パスワード（16文字）', '', 'password')}`;
  const ready = s.github && s.draft;
  const finish = s.finished ? `<p class="muted">診断を流しました。結果は ${where} に届きます。最初の1週間は試し（書き込まない・送らない）で動きます</p><form method="post" action="/setup/finish"><button class="sub">もう一度、仕上げと診断を流す</button></form>`
    : ready ? `<p>押すと、会社の設定とレシピを入れ、正しく動くかを診断します（結果は ${where} へ）</p><form method="post" action="/setup/finish"><button>仕上げる</button></form>` : `<p class="muted">GitHub${s.auto ? '' : 'と導入コード'}が済むと押せます</p>`;
  const claudeOk = has('CLAUDE_CODE_OAUTH_TOKEN') || has('ANTHROPIC_API_KEY');
  // 手順（must＝必須）。ok はその手順の確かめが通ったか、test は通ったときに出す一言
  const steps = [
    { id: 'github', title: 'GitHub につなぐ', must: true, ok: !!s.github, body: gh, test: `つながりました（${esc(s.repo || '')}）` },
    ...(s.auto ? [] : [{ id: 'draft', title: '導入コード', must: true, ok: !!s.draft, body: draft, test: '会社の設定を取り込みました' }]),
    { id: 'google', title: 'Google で許可', must: true, ok: !!s.google, body: google, test: '台帳のシートを作りました' },
    { id: 'notify', title: s.oauth ? '知らせの先' : `知らせの先（${where}）`, must: true, ok: has(hookKey) || (slack && has('SLACK_BOT_TOKEN')), body: s.oauth ? connectButtons : keyForm('notify', hook, '入れて、試しの知らせを送る'), test: slack && has('SLACK_BOT_TOKEN') ? `Slack に #${esc(s.slack_channel || 'orbit')} を作って、試しの知らせを送りました。届いているか見てください` : `試しの知らせを送りました。${where} に「つながりました」が届いているか見てください` },
    { id: 'claude', title: 'Claude の鍵', must: true, ok: claudeOk, body: keyForm('claude', claude, '入れる'), test: '鍵の形を確かめました（本当に動くかは、最後の仕上げの診断で確かめます）' },
    { id: 'extras', title: 'SNS とメール', must: false, ok: has('BUFFER_API_KEY') || has('MAIL_PASSWORD'), body: keyForm('extras', extras, '入れる'), test: '入れました' },
    { id: 'finish', title: '仕上げ', must: true, ok: !!s.finished, body: finish, test: `診断を流しました。結果は ${where} に届きます` },
  ];
  const ix = Math.max(0, steps.findIndex(x => x.id === want) >= 0 ? steps.findIndex(x => x.id === want) : steps.findIndex(x => x.must && !x.ok) >= 0 ? steps.findIndex(x => x.must && !x.ok) : steps.length - 1);
  const cur = steps[ix], next = steps[ix + 1], prev = steps[ix - 1];
  const musts = steps.filter(x => x.must), doneN = musts.filter(x => x.ok).length, pct = Math.round(doneN / musts.length * 100);
  const nav = `<ol class="steps"><li class="done"><span>✓</span>はじめに（2段階認証・Cloudflare で許可）</li>${steps.map((x, i) =>
    `<li class="${x.ok ? 'done' : ''} ${i === ix ? 'cur' : ''}"><a href="/setup?step=${x.id}"><span>${x.ok ? '✓' : i + 1}</span>${x.title}${x.must ? '' : '<small>（使う会社だけ）</small>'}</a></li>`).join('')}</ol>`;
  const test = cur.ok ? `<p class="pass">✓ 確かめました：${cur.test}</p>` : '';
  const moves = `<div class="row moves">${prev ? `<a class="btn sub" href="/setup?step=${prev.id}">← 前へ</a>` : ''}${next
    ? (cur.ok || !cur.must ? `<a class="btn" href="/setup?step=${next.id}">${cur.ok ? '次へ' : '使わない（飛ばす）'} →</a>` : `<span class="muted">この手順が済むと「次へ」が出ます</span>`) : ''}</div>`;
  const card = `<section class="card ${cur.ok ? 'ok' : ''}"><h2><span class="n">${cur.ok ? '✓' : ix + 1}</span>${cur.title}${cur.ok ? '<span class="tag">済み</span>' : ''}</h2>${cur.body}${test}${moves}</section>`;
  const bar = `<div class="progress"><div class="ptext">必須の手順 ${doneN} / ${musts.length} 済み${doneN === musts.length ? '・導入が終わりました' : ''}</div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
  const script = s.google || cur.id !== 'google' ? '' : `<script>
document.getElementById('g').onclick=async()=>{const o=document.getElementById('gout');o.textContent='準備しています…';
const r=await (await fetch('/setup/google/start',{method:'POST'})).json();if(r.error){o.innerHTML='<span class=err>'+r.error+'</span>';return}
o.innerHTML='<p>コード：<span class=code>'+r.user_code+'</span></p><p><a href="'+r.verification_url+'" target="_blank" rel="noopener">Google の画面を開く</a> → コードを入れて「許可」</p><p>待っています…</p>';
const t=setInterval(async()=>{const p=await (await fetch('/setup/google/poll',{method:'POST'})).json();if(p.status==='ok'){clearInterval(t);location.href='/setup?step=google'}else if(p.status==='error'){clearInterval(t);o.innerHTML+='<p class=err>'+p.error+'</p>'}},(r.interval||5)*1000)}</script>`;
  return page('Orbit Package の設定', `<h1>Orbit Package の設定</h1><p class="muted">1つずつ進めます。済むと ✓ が付き、「次へ」が出ます。鍵は暗号化して御社の GitHub に入り、担当者にも見えません</p>
    ${nav}
    ${msg ? `<p class="${msg.startsWith('⚠') ? 'err' : 'muted'}">${esc(msg)}</p>` : ''}
    ${card}
    <p class="muted">指示を出すページ：<a href="${origin}/i">${origin}/i</a>・棚（仕事を見る・言葉で頼んで作る・育てる）：<a href="${origin}/shelf">${origin}/shelf</a>・出来事の受け口（フォームなどからすぐ動かす）：<a href="${origin}/setup/hook">${origin}/setup/hook</a>（どれもこのページと同じログインで入れます）</p>
    ${bar}${script}`);
}

const login = (msg = '') => page('ログイン', `<h1>ログインしてください</h1>${msg ? `<p class="err">${esc(msg)}</p>` : ''}<p>担当者からのリンク（Orbit Package を始める）を開き、「Cloudflare で許可」をもう一度押すと、このページに入り直せます。設定はそのまま残ります。</p><p class="muted">合言葉（SETUP_PASSWORD）を決めてある場合は、下に入れても入れます。</p>
  <form method="post" action="/setup/login" style="display:grid;gap:10px"><input name="password" type="password" required autofocus><button>入る</button></form>`);

async function form(req) { return Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v).trim()])); }

// ── 各段の処理
async function connectGithub(env, origin) {
  const st = random(12); await env.CONFIG.put('gh_state', st, { expirationTtl: 1800 });
  const host = new URL(origin).hostname.split('.')[0].slice(0, 20);
  const m = manifest(origin, `${host.startsWith('orbit') ? '' : 'orbit-'}${host}-${random(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.slice(0, 34));   // orbit-orbit- と二重にしない
  return page('GitHub へ', `<p>GitHub に移ります…</p><form id="f" method="post" action="https://github.com/settings/apps/new?state=${st}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(m))}"><button>進まないときは押す</button></form><script>document.getElementById('f').submit()</script>`);
}

async function afterInstall(env, origin, gh, code) {
  // B の形：本人の許可の code があれば、リポジトリを作って（使い回して）つなぐ。なければ古い形（入れたリポジトリから探す）
  if (code) {
    const app = await env.CONFIG.get('app', 'json');
    const repo = await ensureRepo(await userToken(app, code), await env.CONFIG.get('inst'), (await env.CONFIG.get('repo_name')) || 'orbit-package');
    await env.CONFIG.put('repo', repo); await env.CONFIG.delete('tok');
    if ((await call(await installationToken(env), 'GET', `/repos/${repo}`)).status !== 200)
      return `⚠ アプリの手が ${repo} に届いていません。GitHub の「Settings」→「Applications」→ このアプリの「Configure」で「All repositories」か ${repo} を選んで「Save」を押してください（このページに戻ります）`;
    return finishGithub(env, origin, gh, repo);
  }
  const token = await installationToken(env);
  const list = await call(token, 'GET', '/installation/repositories?per_page=100');
  const repos = (list.json.repositories || []).map(r => r.full_name);
  const known = await env.CONFIG.get('repo'), want = (await env.CONFIG.get('repo_name')) || 'orbit-package';
  let repo = repos.includes(known) ? known : (repos.find(n => n.split('/')[1] === want) || null);   // 作ったリポジトリを先に（全部のリポジトリに入れた会社で、ほかのリポジトリを選ばない）
  for (const name of repo ? [] : repos) {   // 仕組みのリポジトリ：入口（receiver/setup.js）か中身（cloud/lines/recipe.py）があるもの。1つだけならそれ（10/18 t3：入口の雛形には中身がないため）
    for (const f of ['receiver/setup.js', 'cloud/lines/recipe.py']) if ((await call(token, 'GET', `/repos/${name}/contents/${f}`)).status === 200) { repo = name; break; }
    if (repo) break;
  }
  if (!repo && repos.length === 1) repo = repos[0];
  if (!repo) return `⚠ 仕組みの入ったリポジトリが見つかりません。GitHub の画面で、Deploy で作ったリポジトリを選んでください`;
  await env.CONFIG.put('repo', repo);
  return finishGithub(env, origin, gh, repo);
}

async function finishGithub(env, origin, gh, repo) {
  let key = await env.CONFIG.get('approve_key');
  if (!key) { key = random(24); await env.CONFIG.put('approve_key', key); }
  await putSecret(gh, 'APPROVE_KEY', key); await putSecret(gh, 'RECEIVER_URL', origin);
  await mark(env, { github: true, repo, secrets: [...new Set([...(await state(env)).secrets, 'APPROVE_KEY', 'RECEIVER_URL'])] });
  const code = await env.CONFIG.get('code');   // 受付が最初に入れた導入コード：中身と下書きをそのまま取り込む（B の形）
  if (code && !(await state(env)).draft) return importDraft(env, gh, code);
  return '';
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
// Google の合言葉：導入コードの束で置き場（CONFIG）に入る。Worker の設定にあればそれ（仮の値「-」などの短い物は使わない・10/18 t3）
async function googleSecret(env) {
  let v = env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CLIENT_SECRET.length > 10 ? env.GOOGLE_CLIENT_SECRET : await env.CONFIG.get('google_client_secret');
  const code = await env.CONFIG.get('code');
  if (!v && code && env.ONBOARD_API) {   // 古い設定のページで取り込んだ会社：受付から合言葉だけ受け取って置き場に入れる
    const r = await fetch(`${env.ONBOARD_API}?t=${encodeURIComponent(code)}&google=1`);
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.google_client_secret) { v = j.google_client_secret; await env.CONFIG.put('google_client_secret', v); }
  }
  return v || '';
}
async function googleStart(env) {
  if (!env.GOOGLE_CLIENT_ID) return { error: 'Google の設定（GOOGLE_CLIENT_ID）がまだありません。担当者にお知らせください' };
  if (!(await googleSecret(env))) return { error: '先に「導入コード」を入れてください' };   // 合言葉は導入コードの束で入る
  const r = await fetch('https://oauth2.googleapis.com/device/code', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPE }) });
  const j = await r.json();
  if (!r.ok) return { error: `Google の準備に失敗しました（${j.error || r.status}）` };
  await env.CONFIG.put('gdev', j.device_code, { expirationTtl: j.expires_in || 1800 });
  return { user_code: j.user_code, verification_url: j.verification_url || j.verification_uri, interval: j.interval || 5 };
}
async function googlePoll(env, gh) {
  const dev = await env.CONFIG.get('gdev');
  if (!dev) return { status: 'error', error: '時間切れです。もう一度「Google で許可」を押してください' };
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: await googleSecret(env), device_code: dev, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
  const j = await r.json();
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { status: 'wait' };
  if (!r.ok || !j.refresh_token) return { status: 'error', error: `許可を受け取れませんでした（${j.error || r.status}）` };
  await env.CONFIG.delete('gdev');
  const head = ['種類', 'ID', '中身', '更新'].map(v => ({ userEnteredValue: { stringValue: v } }));
  const s = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { authorization: `Bearer ${j.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'Orbit Package の台帳', locale: 'ja_JP', timeZone: 'Asia/Tokyo' }, sheets: [{ properties: { title: '作業台DB' }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: head }] }] }] }) });
  const sj = await s.json();
  if (!s.ok) return { status: 'error', error: `台帳を作れませんでした（${sj.error?.status || s.status}）` };
  await putSecret(gh, 'GOOGLE_OAUTH_JSON', JSON.stringify({ client_id: env.GOOGLE_CLIENT_ID, client_secret: await googleSecret(env), refresh_token: j.refresh_token, token_uri: 'https://oauth2.googleapis.com/token' }));
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
      const r = await fetch(f.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '✅ Orbit Package とつながりました。知らせと承認はこのチャンネルに届きます' }) });
      if (r.status === 204 || r.status === 200) await put('DISCORD_WEBHOOK_URL', f.DISCORD_WEBHOOK_URL); else bad.push(`Discord に送れませんでした（${r.status}）。URL を確かめてください`);
    }
  }
  if (f.SLACK_WEBHOOK_URL) {
    if (!/^https:\/\/hooks\.slack\.com\/services\/[\w-]+\/[\w-]+\/[\w-]+$/.test(f.SLACK_WEBHOOK_URL)) bad.push('Slack の Webhook URL の形が違います（https://hooks.slack.com/services/… で始まります）');
    else {
      const r = await fetch(f.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '✅ Orbit Package とつながりました。知らせと承認のリンクはこのチャンネルに届きます' }) });
      if (r.status === 200) await put('SLACK_WEBHOOK_URL', f.SLACK_WEBHOOK_URL); else bad.push(`Slack に送れませんでした（${r.status}）。URL を確かめてください`);
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
  // 仕組みの中身（承認したお客様にだけ受付が渡す）と下書きを、1回のコミットで入れる
  const b = await fetch(`${env.ONBOARD_API}?t=${encodeURIComponent(code)}&bundle=1`);
  const bj = await b.json().catch(() => ({}));
  if (!b.ok || !bj.files) return `⚠ ${bj.error || '仕組みの中身を受け取れませんでした。担当者にお知らせください'}`;
  if (bj.google_client_secret) await env.CONFIG.put('google_client_secret', bj.google_client_secret);   // Google の合言葉（設定ファイルは上書きしない）
  const files = { ...bj.files, 'cloud/lines/draft.json': { mode: '100644', content: JSON.stringify(j.setup, null, 1) + '\n' } };
  await commitFiles(gh, files, `仕組みの中身（${bj.version || ''}）と担当者の下書きを取り込む`);
  await env.CONFIG.put('code', code);
  let sharing = false;   // 毎晩の共有（share.yml）が大元へ申し出るための印。失敗しても導入は止めない（共有だけ使えない）
  try { await putSecret(gh, 'ONBOARD_CODE', code); sharing = true; } catch { }
  if (sharing) { const st0 = await state(env); await mark(env, { secrets: [...new Set([...st0.secrets, 'ONBOARD_CODE'])] }); }
  await mark(env, { draft: true, company: j.name || '', notify: (j.setup && j.setup.notify && j.setup.notify.kind) || 'discord_webhook' });   // 通知先の種類（slack / discord_webhook など）を控える。設定のページの欄と済みの判定を合わせる（10/19・t4 で見つけた）
  return '';
}

async function finish(env, gh, origin) {
  const r = await gh('POST', '/actions/workflows/setup.yml/dispatches', { ref: 'main', inputs: {} });
  if (r.status !== 204) return `⚠ 仕上げを始められませんでした（${r.status}）。少しして、もう一度押してください`;
  const st = await mark(env, { finished: true });
  await tell(env, 'setup', { repo: st.repo, url: origin, secrets: st.secrets, google: !!st.google });
  return '仕上げを始めました（数分）。結果は知らせの先（Slack か Discord）に届きます';
}

// ── 出来事の受け口の案内（10/20）：フォーム・GitHub・決済などの知らせを /hook/<から> に送ると、条件に合うレシピがその場で動く。合言葉（署名の鍵）は置き場に作る
async function hookPage(req, env, origin) {
  let secret = env.HOOK_SECRET || await env.CONFIG.get('hook_secret');
  if (req.method === 'POST' && !env.HOOK_SECRET && (await form(req)).regen === '1') secret = '';   // 作り直し（古い合言葉は使えなくなる）
  if (!secret) { secret = random(24); await env.CONFIG.put('hook_secret', secret); }
  return page('出来事の受け口', `<h1>出来事の受け口</h1><p class="muted">フォームや外のサービスから「何か起きた」という知らせをここに送ると、条件に合うレシピがその場で動きます（見回りを待ちません）。外に出る操作は、いつもどおりあなたの承認が先です。</p>
    <div class="card"><b>送り先の住所</b><p class="code">${esc(origin)}/hook/<span>form</span></p><p class="muted">最後の「form」は知らせの種類の名前です。レシピの「きっかけ」の「から」と同じ名前にします。</p></div>
    <div class="card"><b>合言葉（署名の鍵）</b><p class="code">${esc(secret)}</p><p class="muted">送る側は、本文を HMAC-SHA256 で署名し、ヘッダー <code>x-orbit-signature</code> に入れます。署名がない知らせは受けません。同じ出来事を2回送っても、動くのは1回です（ヘッダー <code>x-orbit-event-id</code> に出来事の番号を入れます）。</p>
    ${env.HOOK_SECRET ? '' : '<form method="post"><input type="hidden" name="regen" value="1"><button class="sub">合言葉を作り直す（古い物は使えなくなります）</button></form>'}</div>
    <p class="muted"><a href="/setup">← 設定のページへ</a>・<a href="/shelf">棚へ</a></p>`);
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
    return page('承認', `<h1>${ok ? '✅ 承認しました' : '❌ やめました'}</h1><p>${esc(title)}</p><p class="muted">${ok ? '続きを動かしています。結果は知らせの先に届きます' : ''}</p>`);
  }
  const body = String(iss.json.body || '').split('\n\n---\n')[0];
  if (iss.json.state === 'closed') return page('承認', `<h1>もう決まっています</h1><p>${esc(title)}</p><pre>${esc(body)}</pre>`);
  return page('承認', `<h1>${esc(title)}</h1><pre>${esc(body)}</pre><form method="post" style="display:grid;gap:10px">
    <label>直したい所・やめる理由（なくてよい）<textarea name="note" rows="3"></textarea></label>
    <div class="row"><button name="ok" value="true">✅ 承認する</button><button name="ok" value="false" class="sub">❌ やめる</button></div></form>`);
}

// ── 指示のページ
// 指示を1件受け付ける（指示のページ・Slack の #orbit から）。Issue にして instruct.yml を起こす。番号を返す（失敗は null）
export async function addInstruction(gh, text, by = 'ページ') {
  const iss = await gh('POST', '/issues', { title: `📝 ${text.split('\n')[0].slice(0, 80)}`, body: `${text}\n<!-- by:${by} -->`, labels: ['指示'] });
  if (iss.status !== 201) return null;
  await gh('POST', '/actions/workflows/instruct.yml/dispatches', { ref: 'main', inputs: { issue: String(iss.json.number) } });
  return iss.json.number;
}

// Slack の #orbit の書き込みを指示として受け付ける（受付が Events API で受けた書き込みを、その瞬間に渡してくる・10/20 オーナー：見に行く形にしない）。
// 合言葉（relay_key）で受付からの物か確かめ、#orbit の人の書き込みだけ・同じ書き込みは一度だけ。受け付けたら、その書き込みのスレッドに返す
export async function relayIn(request, env, ctx, gh = repoApi(env)) {
  const c = env.CONFIG && await env.CONFIG.get('slack', 'json');
  const raw = await request.text();
  if (!c || !c.relay_key || !same(request.headers.get('x-orbit-sig') || '', await hmacHex(c.relay_key, raw))) return new Response('forbidden', { status: 403 });
  let m = {}; try { m = JSON.parse(raw); } catch { }
  if (m.channel !== c.channel || !m.ts || !(m.text || '').trim()) return new Response('skip');
  if (await env.CONFIG.get(`seen:${m.ts}`)) return new Response('seen');   // Slack のやり直しで二度来ても一度だけ
  await env.CONFIG.put(`seen:${m.ts}`, '1', { expirationTtl: 86400 });
  const work = (async () => {
    const no = await addInstruction(gh, String(m.text).slice(0, 2000), 'Slack');
    await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: c.channel, thread_ts: m.ts, text: no ? `📝 受け付けました（#${no}）。結果はこのチャンネルに届きます` : '⚠ 受け付けられませんでした。少しして、もう一度書いてください' }) });
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  return new Response('ok');
}
async function hmacHex(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function instruct(req, env, gh) {
  if (req.method === 'POST') {
    const text = ((await form(req)).text || '').slice(0, 2000);
    if (!text) return go('/i');
    const no = await addInstruction(gh, text);
    if (!no) return page('指示', '<h1>受け付けられませんでした</h1><p class="muted">少しして、もう一度お願いします</p>');
    return page('指示', `<h1>受け付けました</h1><p>${esc(text)}</p><p class="muted">結果は知らせの先に届きます</p><p><a href="/i">続けて書く</a></p>`);
  }
  return page('指示', `<h1>仕事を頼む</h1><p class="muted">例：一覧・〇〇を動かして・〇〇を止めて・〇〇を再開して</p><form method="post" style="display:grid;gap:10px"><textarea name="text" rows="4" required></textarea><button>頼む</button></form>`);
}

// ── 入口（worker.js から呼ぶ）。扱わない道なら null
// 受付から送り先（Webhook の URL）を受け取る（10/20）。設定のページで作った一度きりの印が合う時だけ、知らせの先を替えて入れる（試しの知らせが届いた物だけ）
async function notifyPut(req, env, gh) {
  let b = {}; try { b = await req.json(); } catch { }
  const saved = await env.CONFIG.get('notify_nonce', 'json');
  const bot = b.svc === 'slack' && typeof b.token === 'string' && /^xoxb-/.test(b.token) && /^C\w+$/.test(String(b.channel || ''));   // Slack のボット（#orbit を作った形）
  if (!saved || typeof b.n !== 'string' || !same(b.n, saved.n) || b.svc !== saved.svc || !(bot || typeof b.url === 'string')) return Response.json({ ok: false, msg: '印が合いません。設定のページからもう一度押してください' }, { status: 403 });
  await env.CONFIG.delete('notify_nonce');
  await mark(env, { notify: b.svc });
  if (bot) {   // 試しの知らせが #orbit に届いた時だけ入れる
    const r = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ channel: b.channel, text: '✅ Orbit Package とつながりました。知らせと承認のリンクはこのチャンネルに届きます' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return Response.json({ ok: false, msg: `Slack に送れませんでした（${j.error || r.status}）` });
    await putSecret(gh, 'SLACK_BOT_TOKEN', b.token); await putSecret(gh, 'SLACK_CHANNEL_ID', b.channel);
    await env.CONFIG.put('slack', JSON.stringify({ token: b.token, channel: b.channel, relay_key: String(b.relay_key || '') }));   // #orbit の書き込みを指示として受ける（受付からの合言葉つき）
    await mark(env, { slack_channel: b.channel_name || '', secrets: [...new Set([...(await state(env)).secrets, 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'])] });
    await tell(env, 'notify', { svc: 'slack' });
    return Response.json({ ok: true, msg: '入れました：2件' });
  }
  const msg = await saveSecrets(env, gh, { [b.svc === 'slack' ? 'SLACK_WEBHOOK_URL' : 'DISCORD_WEBHOOK_URL']: b.url });
  const ok = !!msg && !msg.startsWith('⚠');
  if (ok) await tell(env, 'notify', { svc: b.svc });
  return Response.json({ ok, msg: msg || '入りませんでした' });
}

export async function route(req, env) {
  const url = new URL(req.url), path = url.pathname, origin = url.origin;
  if (!(path === '/setup' || path.startsWith('/setup/') || path === '/i' || /^\/a\/\d+$/.test(path) || (path === '/m' && req.method === 'POST'))) return null;
  if (!env.CONFIG) return page('設定', '<h1>置き場（CONFIG）がありません</h1><p class="muted">担当者からのリンクを開き、「Cloudflare で許可」をもう一度押してください</p>');
  const gh = repoApi(env);
  if (path === '/m') {   // 画像の置き場（Actions から。承認の鍵で確かめる）
    const key = await env.CONFIG.get('approve_key');
    const kv = env.MEDIA || env.CONFIG;
    if (!key || !same(req.headers.get('authorization') || '', `Bearer ${key}`) || !kv) return new Response('forbidden', { status: 403 });
    const type = req.headers.get('content-type') || '';
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type];
    if (!ext) return new Response('PNG・JPEG・WebP だけ', { status: 415 });
    const name = random(16).toLowerCase().replace(/[^a-z0-9]/g, '0') + ext;
    await kv.put(name, await req.arrayBuffer(), { metadata: { contentType: type } });
    return Response.json({ url: `${origin}/m/${name}` });
  }
  if (path === '/setup/notify/put' && req.method === 'POST') return notifyPut(req, env, gh);   // 受付から（ログインの印はない。一度きりの印で確かめる）
  const a = /^\/a\/(\d+)$/.exec(path);
  if (a) return approval(req, env, gh, Number(a[1]), url);
  if (path === '/setup' && url.searchParams.get('login')) {   // 受付が作ったログインの印つきのリンク（B の形）。1回使ったら消す（10/19：期限なしで使い回せた）。入り直しは「Cloudflare で許可」をもう一度押すと新しい印が入る
    if (await loggedIn(env, req)) return go('/setup');   // もう入っている（「進まないときは押す」を2回押したときなど）
    const t = await env.CONFIG.get('login_token');
    if (!t || !same(url.searchParams.get('login'), t)) return login('このリンクはもう使われたか、使えません');
    await env.CONFIG.delete('login_token');
    return go('/setup', await loginCookie(env));
  }
  if (path === '/setup/login' && req.method === 'POST') {
    if (!env.SETUP_PASSWORD) return login('合言葉（SETUP_PASSWORD）がまだ決まっていません。Cloudflare の Worker の「設定」→「変数とシークレット」で入れてください');
    const f = await form(req);
    if (!same(await hmac(env.SETUP_PASSWORD, f.password || ''), await hmac(env.SETUP_PASSWORD, env.SETUP_PASSWORD))) return login('合言葉が違います');
    return go('/setup', await loginCookie(env));
  }
  // GitHub から戻る道（ログインのクッキーは SameSite=Lax で付いてくる）
  if (!(await loggedIn(env, req))) return login();
  if (path === '/i') return instruct(req, env, gh);
  if (path === '/setup/hook') return hookPage(req, env, origin);
  if (path === '/shelf' || path.startsWith('/shelf/')) { const r = await shelfRoute(req, env, gh, url); if (r) return r; }   // 棚の画面（部品とレシピを見る・組む・育てる・10/19）
  let msg = '';
  try {
    if (path === '/setup/github' && req.method === 'POST') return connectGithub(env, origin);
    if (path === '/setup/github/back') {
      const st = await env.CONFIG.get('gh_state');
      if (!st || st !== url.searchParams.get('state')) return view(await viewState(env), origin, '⚠ 時間が経ちすぎました。もう一度「GitHub につなぐ」を押してください');
      const app = await convert(url.searchParams.get('code') || '');
      await env.CONFIG.put('app', JSON.stringify(app)); await env.CONFIG.delete('tok');
      return go(`https://github.com/apps/${app.slug}/installations/new`);
    }
    if (path === '/setup/github/installed') {
      const inst = url.searchParams.get('installation_id');
      if (!/^\d+$/.test(inst || '')) return view(await viewState(env), origin, '⚠ GitHub から戻れませんでした。もう一度押してください');
      await env.CONFIG.put('inst', inst); await env.CONFIG.delete('tok');
      msg = await afterInstall(env, origin, gh, url.searchParams.get('code'));
      if (!msg) await tell(env, 'github', { repo: await env.CONFIG.get('repo') });
    }
    if (path === '/setup/google/start' && req.method === 'POST') return Response.json(await googleStart(env));
    if (path === '/setup/google/poll' && req.method === 'POST') return Response.json(await googlePoll(env, gh));
    if (path === '/setup/notify/start' && req.method === 'POST') {   // 一度きりの印を作って受付の許可の口へ（15分で消える）
      const svc = url.searchParams.get('svc'), code = await env.CONFIG.get('code');
      if (!['slack', 'discord'].includes(svc) || !code || !env.ONBOARD_API) msg = '⚠ このページからはつなげません。「URL を貼って入れる」からお願いします';
      else {
        const n = random(24);
        await env.CONFIG.put('notify_nonce', JSON.stringify({ n, svc }), { expirationTtl: 900 });
        return go(`${new URL(env.ONBOARD_API).origin}/api/notify?svc=${svc}&t=${encodeURIComponent(code)}&n=${n}`);
      }
    }
    if (path === '/setup/secrets' && req.method === 'POST') msg = await saveSecrets(env, gh, await form(req));
    if (path === '/setup/draft' && req.method === 'POST') msg = await importDraft(env, gh, (await form(req)).code || '');
    if (path === '/setup/finish' && req.method === 'POST') msg = await finish(env, gh, origin);
  } catch (e) { msg = `⚠ ${String(e.message || e).slice(0, 200)}`; }
  const want = url.searchParams.get('step') || { '/setup/github/back': 'github', '/setup/github/installed': 'github', '/setup/draft': 'draft', '/setup/finish': 'finish' }[path] || '';   // 押した手順をそのまま見せる（確かめの結果と「次へ」）
  return view(await viewState(env), origin, msg, want);
}
