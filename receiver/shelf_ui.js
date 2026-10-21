// 棚の画面の見た目と動き（2026-10-19 作り直し・10/20 「つくる」を言葉で頼む形に）。部品の羅列ではなく「仕事」から始める。
//   仕事（動いている物がカードで見える）→ 流れ（集める → 書く → 確かめる → 人が決める → 出す の5列）→ ブロックを押すとやさしい言葉の説明と設定
//   作るのは「つくる」から：ふつうの言葉で頼む → 提案（今ある物を使い回し、新しく作る物だけ知らせる）→ 承認 → 開発（影で始まる）。ブロックを自分で並べる画面はない。承認（人が決める）は 🔒 で外せない。育てる＝今夜確かめる → 大元へ
export const CSS = `:root{--bg:#f5f6f2;--sf:#fff;--fg:#1d2623;--mu:#5e6b64;--ln:#d8dfd9;--gd:#1f6f5c;--gd2:#e3f1ec;--bd:#b03a3a;--ch:#eef1ee;--wn:#9a6a12;--wn2:#f6eedb;
--c1:#d9ecf5;--c1b:#2f7aa3;--c2:#e6e1f4;--c2b:#6a55b0;--c3:#dff0e4;--c3b:#2e7a4c;--c4:#fff4d6;--c4b:#a37a10;--c5:#f9e8d2;--c5b:#b0651f}
@media (prefers-color-scheme:dark){:root{--bg:#131816;--sf:#1b2220;--fg:#e4ebe7;--mu:#9aa8a1;--ln:#33403a;--gd:#6cc7ad;--gd2:#1d3a32;--bd:#ec8a8a;--ch:#242c28;--wn:#e0b25e;--wn2:#3a2f18;
--c1:#1c3340;--c1b:#7cc0e6;--c2:#2b2640;--c2b:#b4a3ee;--c3:#1d3524;--c3b:#7ccb9b;--c4:#3a3216;--c4b:#e6c767;--c5:#40311c;--c5b:#f0b274}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 "Hiragino Sans","Noto Sans JP",system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:18px 16px 64px;display:grid;gap:16px}main>*,.card>*{min-width:0}
h1{font-size:1.3rem;margin:0}h2{font-size:1.05rem;margin:0}h3{font-size:.95rem;margin:0}p{margin:0}.mu{color:var(--mu);font-size:.88rem}.err{color:var(--bd)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.sp{flex:1}
.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}nav{display:flex;gap:6px;flex-wrap:wrap}nav button{background:var(--ch);color:var(--fg);border:0;border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer}nav button[aria-pressed=true]{background:var(--gd);color:#fff}nav a.nl{background:var(--ch);color:var(--fg);border-radius:999px;padding:8px 16px;font-weight:700;text-decoration:none}nav a.nl:hover{outline:2px solid var(--gd)}
button{font:inherit;cursor:pointer}.btn{font-weight:700;border:0;border-radius:10px;padding:9px 16px;background:var(--gd);color:#fff;min-height:40px}.btn.sub{background:var(--ch);color:var(--fg)}.btn.sm{padding:4px 10px;min-height:30px;font-size:.85rem}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:.78rem;font-weight:700;border-radius:999px;padding:2px 10px;background:var(--ch)}.chip.on{background:var(--gd);color:#fff}
.m-run{background:var(--gd2);color:var(--gd)}.m-shadow{background:var(--wn2);color:var(--wn)}.m-stop{background:var(--ch);color:var(--mu)}
.sum{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.sum button{border:1px solid var(--ln);background:var(--sf);color:var(--fg);border-radius:999px;padding:6px 14px}.sum button[aria-pressed=true]{border-color:var(--gd);background:var(--gd2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}
.card{background:var(--sf);border:1px solid var(--ln);border-radius:14px;padding:14px;display:grid;gap:10px;align-content:start}
.job{text-align:left;color:var(--fg);transition:border-color .15s}.job:hover{border-color:var(--gd)}.job b{font-size:1rem}
.mini{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.mini i{font-style:normal;font-size:.74rem;font-weight:700;border-radius:6px;padding:1px 7px}.mini u{text-decoration:none;color:var(--mu)}
.k1{background:var(--c1);color:var(--c1b)}.k2{background:var(--c2);color:var(--c2b)}.k3{background:var(--c3);color:var(--c3b)}.k4{background:var(--c4);color:var(--c4b)}.k5{background:var(--c5);color:var(--c5b)}
.say{background:var(--gd2);border-radius:12px;padding:12px 14px;line-height:1.8}
.lanes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;align-items:start}@media (max-width:820px){.lanes{grid-template-columns:minmax(0,1fr)}}
.lane{display:grid;gap:8px;align-content:start;background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:10px;position:relative}.lane>h3{display:flex;gap:6px;align-items:center;font-size:.85rem}.lane .no{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:.75rem;font-weight:800}
.lanes.ed{grid-template-columns:repeat(3,minmax(0,1fr))}.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}@media (max-width:820px){.lanes.ed,.grid2{grid-template-columns:minmax(0,1fr)}}
.lane>p{font-size:.78rem;color:var(--mu);line-height:1.5}
.blk{border-radius:10px;padding:8px 10px;text-align:left;border:1.5px solid transparent;color:var(--fg);display:grid;gap:1px;width:100%;position:relative}.blk b{font-size:.88rem}.blk span{font-size:.76rem;color:var(--mu);overflow-wrap:anywhere}.blk[aria-current=true]{border-color:var(--fg)}
.blk .x{position:absolute;right:6px;top:4px;font-size:.8rem;color:var(--mu);border:0;background:none;padding:2px 6px}
.lock{font-size:.74rem;color:var(--mu)}.add{border:1.5px dashed var(--ln);background:none;color:var(--mu);border-radius:10px;padding:6px;font-size:.82rem}
.panel{border:2px solid var(--gd);border-radius:14px;padding:14px;display:grid;gap:10px;background:var(--sf)}
.field{display:grid;gap:3px;font-size:.86rem}.field input,.field textarea,.field select,.inp{width:100%;font:inherit;font-size:15px;border:1px solid var(--ln);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--fg)}
.pick{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px;z-index:5}.pick .sheet{background:var(--sf);border-radius:16px;padding:16px;max-width:560px;width:100%;max-height:86vh;overflow:auto;display:grid;gap:10px}
.opt{text-align:left;border:1px solid var(--ln);background:var(--sf);color:var(--fg);border-radius:10px;padding:10px 12px;display:grid;gap:2px}.opt:hover{border-color:var(--gd)}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}@media (max-width:700px){.steps{grid-template-columns:minmax(0,1fr)}}.steps>div{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:12px;display:grid;gap:4px;border-top:4px solid var(--gd)}
.steps .n{font-weight:800;color:var(--gd)}

.big{font:inherit;font-size:16px;width:100%;border:1.5px solid var(--ln);border-radius:12px;padding:12px 14px;background:var(--bg);color:var(--fg);line-height:1.7}.big:focus{outline:2px solid var(--gd);border-color:var(--gd)}
.ex{border:1px solid var(--ln);background:var(--sf);color:var(--fg);border-radius:999px;padding:6px 12px;font-size:.84rem;text-align:left}.ex:hover{border-color:var(--gd)}
.prog{display:flex;gap:6px;flex-wrap:wrap}.prog span{flex:1;min-width:110px;text-align:center;font-size:.8rem;font-weight:700;border-radius:8px;padding:6px 8px;background:var(--ch);color:var(--mu)}.prog span.on{background:var(--gd);color:#fff}
.wait{display:flex;gap:10px;align-items:center}.dot{width:12px;height:12px;border-radius:50%;background:var(--gd);animation:bl 1.1s ease-in-out infinite;flex:none}@keyframes bl{50%{opacity:.2}}
.sec{display:grid;gap:6px}.sec>h3{color:var(--mu);font-size:.8rem;letter-spacing:.04em}.ul{margin:0;padding-left:1.2em;display:grid;gap:3px}.ok{background:var(--gd2);border-radius:12px;padding:12px 14px}.warn{background:var(--wn2);border-radius:12px;padding:12px 14px;color:var(--fg)}
.flow{display:grid;gap:6px}.flow>div{display:flex;gap:8px;align-items:baseline}.flow i{font-style:normal;font-size:.76rem;font-weight:700;border-radius:6px;padding:1px 8px;white-space:nowrap}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ch);border-radius:10px;padding:10px;margin:0;font:inherit;font-size:.84rem;max-height:320px;overflow:auto}`;

export const JS = `
const KIND={1:'集める',2:'書く（AI）',3:'確かめる',4:'人が決める',5:'出す・知らせる'};
const HELP={1:'仕事の材料をそろえます（シート・メール・ファイルなど）',2:'AI が文章をつくります（なくてもよい）',3:'まちがいや作り話をプログラムが止めます',4:'外に出す前に、人が ✅ か ❌ を決めます',5:'できた物を届けます（通知・シート・メールなど）'};
const STAGE_NO={入口:1,確かめ:3,出口:5};
const H=location.hash.slice(1).split('/');let D=null,view=H[0]||'jobs',filter='all',cur=H[1]||null,sel=null,q='';
const el=(t,a,...k)=>{const e=document.createElement(t);for(const[n,v]of Object.entries(a||{})){if(n==='class')e.className=v;else if(n.startsWith('on'))e[n]=v;else if(n==='text')e.textContent=v;else if(v!==false&&v!=null)e.setAttribute(n,v===true?'':v)}for(const c of k.flat(Infinity))if(c!=null&&c!==false)e.append(c.nodeType?c:document.createTextNode(c));return e};
const part=n=>D.parts.find(p=>p.name===n)||{name:n,stage:'?',desc:'（棚にない部品）',settings:[],cost:0,used_in:[]};
const plain=p=>String(p.desc||'').split(/[（(]/)[0];
const modeOf=r=>r.mode==='本番'?['動いている','m-run']:r.mode==='停止'||!r.mode?[r.kind!=='お客様だけ'?'まだ使っていない（見本）':'止めている','m-stop']:['試し中（影）','m-shadow'];
const whenText=w=>String(w||'').replace('平日','平日の').replace('毎日','毎日 ').replace('毎週','毎週 ');
const say=r=>{const ins=r.blocks.in.map(b=>b.part).join('・'),outs=r.blocks.out.map(b=>b.part).join('・');return whenText(r.when)+'に、'+ins+'から材料を集め、'+(r.ai?'AI が文章をつくり、':'')+(r.checks.length?r.checks.length+'つの確かめを通して、':'')+(r.approval==='止める'?'毎回あなたが ✅ か ❌ を決めてから':r.approval==='決まりで止める'?'大事な言葉（'+r.stop_words.join('・')+'）が出たときだけあなたが決めて':'そのまま')+'、'+outs+'に出します。'};
const miniFlow=r=>el('div',{class:'mini'},el('i',{class:'k1',text:r.blocks.in.map(b=>b.part).join('+')}),el('u',{text:'›'}),r.ai?[el('i',{class:'k2',text:'AI'}),el('u',{text:'›'})]:null,r.checks.length?[el('i',{class:'k3',text:'確かめ×'+r.checks.length}),el('u',{text:'›'})]:null,el('i',{class:'k4',text:r.approval==='止める'?'あなたが決める':r.approval==='決まりで止める'?'決まりで止める':'そのまま'}),el('u',{text:'›'}),el('i',{class:'k5',text:r.blocks.out.map(b=>b.part).join('+')}));
async function load(){const r=await fetch('/shelf/data');D=await r.json();if(D.error){app.replaceChildren(el('div',{class:'card'},el('p',{class:'err',text:D.error})));return}
 if(cur&&!D.recipes.find(x=>x.id===cur))cur=null;
 if(cur&&H[2]!==undefined){const r1=D.recipes.find(x=>x.id===cur),i=+H[2];sel=r1?{k:i<10?1:3,i:0,b:r1.blocks.in[0]&&{p:r1.blocks.in[0].part,s:r1.blocks.in[0].settings}}:null}
 draw()}
function draw(){document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.t===view)));app.replaceChildren(...({jobs:vJobs,make:vMake,tools:vTools,grow:vGrow}[view]||vJobs)().filter(Boolean))}
// ── 仕事
function vJobs(){if(cur)return vJob(D.recipes.find(r=>r.id===cur));
 const n={run:0,shadow:0,stop:0};D.recipes.forEach(r=>{const m=modeOf(r)[1];n[m==='m-run'?'run':m==='m-shadow'?'shadow':'stop']++});
 const rank=r=>r.mode==='本番'?0:r.mode==='停止'||!r.mode?(r.kind==='お客様だけ'?2:3):1;
 const list=D.recipes.filter(r=>filter==='all'||(filter==='mine'?r.kind==='お客様だけ':modeOf(r)[1]==={run:'m-run',shadow:'m-shadow',stop:'m-stop'}[filter])).sort((a,b)=>rank(a)-rank(b));
 const chip=(k,t)=>el('button',{'aria-pressed':String(filter===k),onclick:()=>{filter=k;draw()}},t);
 return[el('div',{class:'row'},el('div',{class:'sum'},chip('all','すべて '+D.recipes.length),chip('run','動いている '+n.run),chip('shadow','試し中 '+n.shadow),chip('stop','使っていない '+n.stop),chip('mine','お客様だけ '+D.recipes.filter(r=>r.kind==='お客様だけ').length)),el('span',{class:'sp'}),el('button',{class:'btn',onclick:()=>openMake(),text:'＋ 新しい仕事をつくる'})),
  el('p',{class:'mu',text:'会社の決まった仕事です。押すと、何をしているかと流れが見えます。最初はどれも「試し（影）」で、外には出ません。'}),
  el('div',{class:'grid'},list.map(r=>{const[mt,mc]=modeOf(r);return el('button',{class:'card job',onclick:()=>{cur=r.id;sel=null;draw();scrollTo(0,0)}},el('div',{class:'row'},el('b',{text:r.name}),el('span',{class:'sp'}),el('span',{class:'chip '+mc,text:mt})),el('p',{class:'mu',text:r.purpose||say(r)}),miniFlow(r),el('p',{class:'mu',text:'いつ：'+r.when+(r.kind==='お客様だけ'?'　・お客様だけ':'')}))}))]}
function vJob(r){
 const[mt,mc]=modeOf(r),lanes=[1,2,3,4,5].map(k=>{const bl=k===1?r.blocks.in.map(b=>({p:b.part,s:b.settings,l:b.label})):k===2?(r.ai?[{p:'AI で書く',ai:true}]:[]):k===3?r.blocks.checks.map(b=>({p:b.part,s:b.settings})):k===4?[{p:r.approval==='止める'?'毎回あなたが決める':r.approval==='決まりで止める'?'大事な言葉だけ決める':'止めずに進む',lock:r.approval!=='任せる'&&!!r.approval,free:r.approval==='任せる'||!r.approval}]:r.blocks.out.map(b=>({p:b.part,s:b.settings}));
  return el('div',{class:'lane'},el('h3',{},el('span',{class:'no k'+k,text:k}),KIND[k]),el('p',{text:HELP[k]}),bl.length?bl.map((b,i)=>el('button',{class:'blk k'+k,'aria-current':String(sel&&sel.k===k&&sel.i===i),onclick:()=>{sel={k,i,b};draw()}},el('b',{text:(b.lock?'🔒 ':'')+b.p}),el('span',{text:b.ai?(r.ai_instruction||'').slice(0,40):b.lock?(r.stop_words&&r.stop_words.length?'止める言葉：'+r.stop_words.join('・'):'外に出す前に、必ずあなたが決めます'):b.free?'影（試し）のあいだは外に出ません。本番にするときは、あなたが決めます':plain(part(b.p)).slice(0,40)}))):el('p',{class:'mu',text:'（なし）'}))});
 const p=sel&&!sel.b.ai&&!sel.b.lock&&!sel.b.free?part(sel.b.p):null;
 return[el('div',{class:'row'},el('button',{class:'btn sub sm',onclick:()=>{cur=null;sel=null;draw()},text:'← 仕事の一覧'}),el('span',{class:'sp'}),el('button',{class:'btn',onclick:()=>openMake('「'+r.name+'」をもとに、',{id:r.id,name:r.name}),text:'この仕事をもとに頼む'})),
  el('div',{class:'card'},el('div',{class:'row'},el('h2',{text:r.name}),el('span',{class:'chip '+mc,text:mt}),el('span',{class:'chip',text:r.kind})),el('div',{class:'say',text:say(r)}),el('p',{class:'mu',text:'1週の費用の上限：$'+(r.limit['1週の費用']??'-')+(r.limit['1日の回数']?'　・1日'+r.limit['1日の回数']+'回まで':'')}),
  el('div',{class:'lanes'},lanes),
  sel?el('div',{class:'panel'},el('div',{class:'row'},el('h2',{text:sel.b.p}),el('span',{class:'chip k'+sel.k,text:KIND[sel.k]})),
   sel.b.ai?el('p',{text:'AI への指示：'+(r.ai_instruction||'（なし）')}):(sel.b.lock||sel.b.free)?el('p',{text:'人が決める段は、この仕組みの決まりです。最初は影（試し）で、外には出ません。本番にするときも、外に出す物はあなたが ✅ してからです（決まりで止める言葉が出たときだけ止める仕事もあります）。'}):[el('p',{text:p.desc}),el('p',{class:'mu',text:'費用の目安：1回 $'+p.cost+'　・使っている仕事：'+((p.used_in||[]).length)+'つ'}),
    el('h3',{text:'この仕事での設定'}),Object.keys(sel.b.s||{}).length?Object.entries(sel.b.s).map(([k,v])=>el('p',{},el('b',{text:k+'　'}),typeof v==='object'?JSON.stringify(v):String(v))):el('p',{class:'mu',text:'初期値のまま使っています'}),
    p.settings.length?el('p',{class:'mu',text:'変えられる設定：'+p.settings.map(s=>s.key+(s.required?'（必須）':'')).join('、')}):null]):el('p',{class:'mu',text:'上の流れのブロックを押すと、やさしい言葉の説明と設定が出ます。'}))]
}
// ── つくる：ふつうの言葉で頼む → 提案 → 承認 → 開発
let mk={text:'',from:null,id:null,rec:null,busy:false,msg:'',fix:'',poll:null},builds=[];
const EX=['問い合わせが来たら、担当にすぐ知らせたい','毎週月曜の朝に、先週の数字をまとめて送りたい','予約が入ったら、前日にお客様へ案内を出したい'];
const STEP=['相談する','内容を確認','作る','できあがり'];
const STEP_OF={提案中:0,提案できた:1,開発中:2,完成:3};
const FLOW_K={集める:1,書く:2,確かめる:3,人が決める:4,出す:5};
const STAGE_WORD={入口:'集める',確かめ:'確かめる',出口:'出す'};
async function loadBuilds(){try{const r=await fetch('/shelf/builds');builds=(await r.json()).builds||[]}catch(e){}}
async function post(path,body){try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return await r.json()}catch(e){return{error:'通信に失敗しました。もう一度試してください'}}}
function pollBuild(){clearInterval(mk.poll);mk.poll=setInterval(async()=>{if(!mk.id){clearInterval(mk.poll);return}try{const j=await(await fetch('/shelf/build?id='+mk.id)).json();if(j.error)return;mk.rec=j;if(j.状態!=='提案中'&&j.状態!=='開発中'){clearInterval(mk.poll);await loadBuilds();if(j.状態==='完成')await load()}if(view==='make')draw()}catch(e){}},4000)}
async function askBuild(){mk.busy=true;mk.msg='';draw();const t=mk.text.trim(),j=await post('/shelf/ask',{text:t,from:mk.from&&mk.from.id||''});mk.busy=false;if(j.error){mk.msg=j.error;draw();return}mk.id=j.id;mk.rec={状態:'提案中',頼み:t};pollBuild();draw()}
async function actBuild(path,extra){mk.busy=true;mk.msg='';draw();const j=await post(path,{id:mk.id,...(extra||{})});mk.busy=false;if(j.error){mk.msg=j.error;draw();return}mk.fix='';try{mk.rec=await(await fetch('/shelf/build?id='+mk.id)).json()}catch(e){}if(mk.rec&&mk.rec.状態==='やめた'){mk.id=null;mk.rec=null}await loadBuilds();if(mk.rec&&(mk.rec.状態==='提案中'||mk.rec.状態==='開発中'))pollBuild();draw()}
const resetMake=()=>{clearInterval(mk.poll);mk={text:'',from:null,id:null,rec:null,busy:false,msg:'',fix:'',poll:null}};
function openMake(text,from){clearInterval(mk.poll);mk={text:text||'',from:from||null,id:null,rec:null,busy:false,msg:'',fix:'',poll:null};view='make';cur=null;sel=null;loadBuilds().then(draw);draw();scrollTo(0,0)}
const list=(a)=>(a&&a.length)?el('ul',{class:'ul'},a.map(x=>el('li',{text:String(x)}))):null;
const sec=(t,...k)=>el('div',{class:'sec'},el('h3',{text:t}),...k);
const progress=r=>{const n=STEP_OF[r.状態]??0;return el('div',{class:'prog'},STEP.map((t,i)=>el('span',{class:i<=n&&r.状態!=='失敗'?'on':'',text:(i+1)+' '+t})))};
function proposalCard(r){const p=r.提案||{},base=p.土台のレシピ,news=p.新しく作る部品||[],used=p.そのまま使う部品||[],qs=p.確認したいこと||[];
 return el('div',{class:'card'},el('h2',{text:'提案ができました'}),el('div',{class:'say',text:p.要約||''}),
  sec('土台にする仕事',el('p',{text:base?'今ある「'+base.名前+'」を土台にします。':'近い仕事が見つからなかったので、新しく組みます。'}),list(p.変えるところ)),
  sec('そのまま使う道具（部品）',used.length?el('div',{class:'mini'},used.map(n=>el('i',{class:'k'+(STAGE_NO[(D.parts.find(x=>x.name===n)||{}).stage]||2),text:n}))):el('p',{class:'mu',text:'なし'})),
  sec('新しく作る道具（部品）',news.length?news.map(x=>el('div',{class:'blk k'+(STAGE_NO[x.段]||2),style:'cursor:default'},el('b',{text:x.名前}),el('span',{text:(STAGE_WORD[x.段]||'')+'：'+(x.できること||'')}))):el('p',{class:'ok',text:'新しく作る物はありません。今ある道具だけで組めます。'})),
  sec('仕事の流れ',el('div',{class:'flow'},(p.流れ||[]).map(f=>el('div',{},el('i',{class:'k'+(FLOW_K[f.段]||2),text:f.段}),el('span',{text:f.内容}))))),
  (p.外に出る操作||[]).length?sec('外に出る操作',list(p.外に出る操作),el('p',{class:'mu',text:'毎回あなたが ✅ か ❌ を決めます。作った直後は「試し（影）」で、外には出ません。'})):null,
  p.費用の目安?sec('費用の目安',el('p',{text:p.費用の目安})):null,
  qs.length?el('div',{class:'warn'},el('b',{text:'教えてください'}),list(qs),el('p',{class:'mu',text:'下の欄に答えを書くと、提案を作り直します。'})):null,
  el('div',{class:'row'},el('button',{class:'btn',disabled:mk.busy,onclick:()=>actBuild('/shelf/build/approve'),text:'承認して、作り始める'}),el('button',{class:'btn sub',disabled:mk.busy,onclick:()=>actBuild('/shelf/build/cancel'),text:'やめる'})),
  el('label',{class:'field'},'直してほしい点・質問への答え（なくてもよい）',el('textarea',{class:'big',rows:3,placeholder:'例：通知は担当のメールではなく、Slack に出してほしい',oninput:ev=>{mk.fix=ev.target.value}},mk.fix)),
  el('div',{class:'row'},el('button',{class:'btn sub',disabled:mk.busy,onclick:()=>{if(mk.fix.trim().length<2){mk.msg='直してほしい点を書いてください';draw();return}actBuild('/shelf/build/answer',{text:mk.fix})},text:'この内容で、提案を作り直してもらう'})))}
function vMake(){const r=mk.rec,st=r&&r.状態;
 const msg=mk.msg?el('p',{class:'err',text:mk.msg}):null;
 const hist=builds.length?el('div',{class:'card'},el('h2',{text:'これまでの依頼'}),builds.map(b=>el('button',{class:'opt',onclick:()=>{clearInterval(mk.poll);mk={...mk,id:b.id,rec:b,msg:'',fix:''};if(b.状態==='提案中'||b.状態==='開発中')pollBuild();draw();scrollTo(0,0)}},el('div',{class:'row'},el('b',{text:String(b.頼み||'').slice(0,60)}),el('span',{class:'sp'}),el('span',{class:'chip '+(b.状態==='完成'?'m-run':b.状態==='失敗'?'m-stop':'m-shadow'),text:b.状態}))))):null;
 if(!r)return[el('div',{class:'say',text:'作りたい仕事を、ふつうの言葉で書いてください。今ある仕事や道具をできるだけ使い回して、足りない部分だけを提案します。あなたが「承認」するまで、何も作りません。'}),
  el('div',{class:'card'},mk.from?el('div',{class:'row'},el('span',{class:'chip on',text:'もとにする仕事：'+mk.from.name}),el('button',{class:'btn sub sm',onclick:()=>{mk.from=null;draw()},text:'外す'})):null,
   el('textarea',{class:'big',rows:5,placeholder:'例：問い合わせが来たら、担当にすぐ知らせたい',oninput:ev=>{mk.text=ev.target.value}},mk.text),
   el('div',{class:'row'},el('span',{class:'mu',text:'例：'}),EX.map(t=>el('button',{class:'ex',onclick:()=>{mk.text=t;draw()},text:t}))),
   el('div',{class:'row'},el('button',{class:'btn',disabled:mk.busy,onclick:askBuild,text:mk.busy?'送っています…':'相談する'}),msg)),hist];
 const head=[el('div',{class:'row'},el('button',{class:'btn sub sm',onclick:()=>{resetMake();loadBuilds().then(draw);draw()},text:'← 新しく頼む'}),el('span',{class:'sp'})),progress(r),el('div',{class:'card'},el('b',{text:'あなたの依頼'}),el('p',{text:r.頼み}))];
 if(st==='提案中')return[...head,el('div',{class:'card wait'},el('span',{class:'dot'}),el('p',{text:'今ある仕事と道具を見ながら、提案を考えています（1〜2分）。このページを閉じても続きます。'}))];
 if(st==='提案できた')return[...head,proposalCard(r),msg];
 if(st==='開発中')return[...head,el('div',{class:'card wait'},el('span',{class:'dot'}),el('p',{text:'承認された内容で作っています（数分）。終わると、ここに結果が出ます。このページを閉じても続きます。'}))];
 if(st==='完成')return[...head,el('div',{class:'card'},el('h2',{text:'できました'}),el('div',{class:'ok',text:r.結果||'試し（影）で動きます。最初は外に出ません。'}),(r.作った部品||[]).length?sec('新しく作った道具（部品）',list(r.作った部品)):null,
   el('div',{class:'row'},el('button',{class:'btn',onclick:()=>{location.href='/shelf/build'},text:'できた仕事を見る'}),el('button',{class:'btn sub',onclick:()=>openMake(),text:'別の仕事を頼む'})))];
 return[...head,el('div',{class:'card'},el('h2',{text:st==='失敗'?'うまくいきませんでした':'この依頼は終わっています'}),el('p',{class:'warn',text:r.理由||''}),
   st==='失敗'&&r.提案?[el('label',{class:'field'},'直してほしい点（なくてもよい）',el('textarea',{class:'big',rows:3,oninput:ev=>{mk.fix=ev.target.value}},mk.fix)),el('div',{class:'row'},el('button',{class:'btn',disabled:mk.busy,onclick:()=>actBuild('/shelf/build/answer',{text:mk.fix.trim()||'もう一度、提案を作り直してください'}),text:'もう一度、提案してもらう'}),msg)]:el('div',{class:'row'},el('button',{class:'btn',onclick:()=>openMake(r.頼み),text:'同じ内容で頼み直す'}),msg))]}
// ── 道具箱
function vTools(){const f=window.__tf||'all',qq=(window.__tq||'').trim();const keys=[['all','すべて'],['入口','集める'],['確かめ','確かめる'],['出口','出す・知らせる']];
 const ps=D.parts.filter(p=>(f==='all'||p.stage===f||p.stage==='どの段でも'&&f==='all')&&(!qq||(p.name+p.desc).includes(qq)));
 return[el('div',{class:'row'},el('div',{class:'sum'},keys.map(([k,t])=>el('button',{'aria-pressed':String(f===k),onclick:()=>{window.__tf=k;draw()},text:t}))),el('span',{class:'sp'}),el('input',{class:'inp',style:'max-width:280px',placeholder:'探す（例：メール・承認・週報）',value:qq,oninput:ev=>{window.__tq=ev.target.value;draw();const i=document.querySelector('.inp');i.focus();i.setSelectionRange(99,99)}})),
  el('p',{class:'mu',text:'仕事の中で使える道具です（'+ps.length+'）。仕事を組むときは、「＋ 足す」からここの道具を選べます。'}),
  el('div',{class:'grid'},ps.map(p=>el('div',{class:'card'},el('div',{class:'row'},el('span',{class:'chip k'+(STAGE_NO[p.stage]||2),text:KIND[STAGE_NO[p.stage]||2]}),el('b',{text:p.name}),el('span',{class:'sp'}),p.custom?el('span',{class:'chip',text:'お客様だけ'}):p.community?el('span',{class:'chip',text:'大元から'}):null),el('p',{text:plain(p)}),el('p',{class:'mu',text:'使っている仕事：'+(p.used_in.length?p.used_in.length+'つ':'まだない')+'　費用の目安 $'+p.cost}),
   p.settings.length?el('details',{},el('summary',{class:'mu',text:'設定（'+p.settings.length+'）'}),p.settings.map(s=>el('p',{class:'mu'},s.key+(s.required?'（必須）':'　初期値 '+JSON.stringify(s.default))))):null)))]}
// ── 育てる
function vGrow(){const cs=D.parts.filter(p=>p.custom),sh=new Set(D.share.parts||[]),rs=D.recipes.filter(r=>r.kind==='お客様だけ'),shr=new Set(D.share.recipes||[]);
 const gm=el('p',{class:'mu'});
 return[el('div',{class:'steps'},el('div',{},el('span',{class:'n',text:'① 作る'}),el('p',{text:'ほしい物を「つくる」でふつうの言葉で頼みます。承認すると作られ、お客様だけの部品として、すぐ使えます（大元には何も行きません）。'})),el('div',{},el('span',{class:'n',text:'② 今夜、確かめる'}),el('p',{text:'「大元へ戻す印」を付けると、その夜（21時ごろ）に、テスト・決まり・個人情報の確かめが走ります。通らなければ理由が出ます。'})),el('div',{},el('span',{class:'n',text:'③ 大元へ'}),el('p',{text:'通ると申し出が届き、担当者が中身を見て ✅ すると大元の棚に入ります（遅くとも翌日）。ほかのお客様へは週1の更新で届きます。'}))),
  el('div',{class:'card'},el('h2',{text:'① ほしい物を頼む'}),el('p',{text:'ほしい仕事や道具は、「つくる」でふつうの言葉で頼みます。承認すると、お客様の Claude が作ります。'}),el('div',{class:'row'},el('button',{class:'btn',onclick:()=>openMake(),text:'「つくる」で頼む'}))),
  el('div',{class:'card'},el('h2',{text:'② 大元へ戻す印（お客様だけの部品・'+cs.length+'）'}),cs.length?cs.map(p=>el('div',{class:'row'},el('b',{text:p.name}),el('span',{class:'mu',text:plain(p).slice(0,50)}),el('span',{class:'sp'}),el('span',{class:'chip '+(sh.has(p.name)?'m-run':''),text:sh.has(p.name)?'印あり：今夜確かめる':'印なし：このお客様だけで使う'}),el('button',{class:sh.has(p.name)?'btn sub sm':'btn sm',onclick:async()=>{const r=await fetch('/shelf/share',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:p.name,on:!sh.has(p.name)})}),j=await r.json();if(j.ok){await load();gm.className='mu';gm.textContent='✅ '+j.note}else{gm.className='err';gm.textContent='⚠ '+j.error}},text:sh.has(p.name)?'印を外す':'大元へ戻す印を付ける'}))):el('p',{class:'mu',text:'まだありません。「つくる」で部品を作ってもらうと、ここに出ます。'}),gm),
  el('div',{class:'card'},el('h2',{text:'③ 大元へ戻す印（お客様だけの仕事・'+rs.length+'）'}),el('p',{class:'mu',text:'仕事が使っている道具が、大元の棚にある物か、先に戻した物のときだけ通ります（お客様だけの道具を使う仕事は、道具を先に戻します）。大元に入ると、ほかのお客様には「止めた状態」で届きます。'}),
   rs.length?rs.map(r=>el('div',{class:'row'},el('b',{text:r.name}),el('span',{class:'sp'}),el('span',{class:'chip '+(shr.has(r.id)?'m-run':''),text:shr.has(r.id)?'印あり：今夜確かめる':'印なし：このお客様だけで使う'}),el('button',{class:shr.has(r.id)?'btn sub sm':'btn sm',onclick:async()=>{const r2=await fetch('/shelf/share',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'recipe',name:r.id,on:!shr.has(r.id)})}),j=await r2.json();if(j.ok){await load();gm.className='mu';gm.textContent='✅ '+j.note}else{gm.className='err';gm.textContent='⚠ '+j.error}},text:shr.has(r.id)?'印を外す':'大元へ戻す印を付ける'}))):el('p',{class:'mu',text:'まだありません。「組む」か「つくる」で仕事を作ると、ここに出ます。'}))]}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{view=b.dataset.t;cur=null;sel=null;if(view==='make'){loadBuilds().then(draw)}draw()});
const app=document.getElementById('app');load();`;
