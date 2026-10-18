// 受け口の中身（2026-10-17）：Discord のボタン（✅ ❌）と /指示 を受け、お客様の GitHub のリポジトリの Actions を起こす。
// 置き場に依らない（Cloudflare Workers の worker.js から呼ぶ）。GitHub の呼び方と承認できる人は引数で渡す（テストで差し替える）。
// 決まり：承認できる人以外の操作は受けない。ここでは記録（Issue）と起動だけ。続き・判断はリポジトリの側（approve_cloud.py）。
const reply = (content, ephemeral = true) => ({ type: 4, data: { content, flags: ephemeral ? 64 : 0 } });
const dispatch = (gh, workflow, inputs) => gh('POST', `/actions/workflows/${workflow}/dispatches`, { ref: 'main', inputs });

// 1件のやり取りを処理して、Discord に返す中身を作る（テストできるよう、GitHub と承認者は引数で渡す）
export async function handle(i, { gh, approvers = '' } = {}) {
  if (i.type === 1) return { type: 1 };   // PING
  const user = (i.member && i.member.user) || i.user || {};
  const allowed = String(approvers).split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(user.id)) return reply('この操作は、登録された人だけができます。');
  const by = user.global_name || user.username || user.id;

  if (i.type === 3) {   // ボタン：ok:<Issue 番号> ／ ng:<Issue 番号>
    const m = /^(ok|ng):(\d+)$/.exec(i.data.custom_id || '');
    if (!m) return reply('この操作には、まだ対応していません。');
    const r = await dispatch(gh, 'resume.yml', { issue: m[2], ok: m[1] === 'ok' ? 'true' : 'false', note: '', by });
    if (r.status !== 204) return reply(`起動できませんでした（${r.status}）。少しして、もう一度押してください。`);
    return { type: 7, data: { content: `-# ${m[1] === 'ok' ? '✅ 承認' : '❌ やめる'}（${by}）を受け付けました。${m[1] === 'ok' ? '続きを動かしています' : ''}`, components: [] } };
  }

  if (i.type === 2 && i.data.name === '指示') {   // /指示 内容
    const text = String((i.data.options || []).find(o => o.name === '内容')?.value || '').slice(0, 2000);
    if (!text.trim()) return reply('内容が空です。');
    const iss = await gh('POST', '/issues', { title: `📝 ${text.split('\n')[0].slice(0, 80)}`, body: `${text}\n<!-- by:${by} -->`, labels: ['指示'] });
    if (iss.status !== 201) return reply(`受け付けられませんでした（${iss.status}）。`);
    const r = await dispatch(gh, 'instruct.yml', { issue: String(iss.json.number) });
    return reply(`📝 ${text}\n-# 受付（#${iss.json.number}）${r.status === 204 ? ' → 動かしています' : '（起動は失敗。担当が確かめます）'}`, false);
  }
  return reply('この操作には、まだ対応していません。');
}

