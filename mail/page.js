// 📮 Páginas del Neat Mail Worker: webmail (/) y panel admin (/admin)
// Se sirven inline desde el worker. Toda la lógica es fetch() same-origin a /api/v1/mail.
// REGLAS DURAS de esta casa para el JS embebido (van en plantilla literal):
//   · NADA de backticks ni ${} dentro del JS de página (rompería la plantilla).
//   · NADA de \' ni valores dinámicos dentro de atributos onclick: se usa
//     delegación de eventos con data-act/data-id/data-a (los \' se pierden en la
//     plantilla y el navegador recibe comillas peladas = script muerto).

const BASE_CSS = [
  ":root{--bg:#0b0e14;--surface:#12161f;--surface-2:#171c28;--line:#232838;--txt:#e7eaf3;--mut:#8a91a6;--mut-2:#5c6377;--acc:#5b8dff;--acc-bg:#182238;--ok:#34d399;--bad:#f66;--warn:#fbbf24;--unread-bg:#141a29;}",
  "*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh;line-height:1.45;font-size:14px}",
  ".wrap{max-width:900px;margin:0 auto;padding:0 0 64px}",
  ".topbar{display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--surface);position:sticky;top:0;z-index:5}",
  ".topbar b{font-size:17px;font-weight:600;letter-spacing:-.2px}.topbar .mut{color:var(--mut)}.topbar a{color:var(--mut);text-decoration:none;font-size:13px}.topbar a:hover{color:var(--txt)}",
  ".content{padding:20px 20px 0}",
  ".card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:14px}",
  "input,button{font:inherit;border-radius:8px;border:1px solid var(--line);padding:9px 12px;font-size:13.5px}input{background:var(--bg);color:var(--txt);width:100%}input:focus{outline:none;border-color:var(--acc)}",
  "button{background:var(--acc);border-color:var(--acc);color:#fff;cursor:pointer;font-weight:600}button:hover{filter:brightness(1.08)}button.ghost{background:transparent;color:var(--mut);font-weight:500}button.ghost:hover{background:var(--surface-2);color:var(--txt)}",
  "button.mini{padding:5px 10px;font-size:12.5px}button.danger{background:transparent;border-color:var(--line);color:var(--bad)}button.danger:hover{background:var(--surface-2);border-color:var(--bad)}button:disabled{opacity:.5;cursor:default}",
  ".row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mut{color:var(--mut);font-size:13px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;color:var(--mut)}",
  ".chip{border:1px solid var(--line);border-radius:999px;padding:5px 13px;font-size:12.5px;cursor:pointer;background:transparent;color:var(--mut);font-weight:500}.chip:hover{border-color:var(--mut-2);color:var(--txt)}.chip.on{background:var(--acc-bg);border-color:var(--acc);color:var(--acc)}",
  ".msg{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid var(--line);cursor:pointer;border-radius:8px}.msg:hover{background:var(--surface-2)}.msg .sub{font-weight:400;color:var(--txt)}.msg.unread{background:var(--unread-bg)}.msg.unread .sub{font-weight:700}.msg .from{width:130px;flex:none;font-weight:400;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.msg.unread .from{color:var(--txt);font-weight:700}.msg .sub-wrap{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.msg .time{width:56px;flex:none;text-align:right;font-size:12px;color:var(--mut)}",
  ".toast{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;background:var(--surface-2);border:1px solid var(--line);padding:10px 16px;border-radius:10px;display:none;z-index:9;max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,.4)}.toast.show{display:block}.toast.bad{border-color:var(--bad);color:var(--bad)}",
  "table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.3px}tr:hover td{background:var(--surface-2)}",
  ".pill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--mut)}.pill.block{border-color:var(--bad);color:var(--bad)}.pill.auto{border-color:var(--ok);color:var(--ok)}",
  "pre.body{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:14px;max-height:420px;overflow:auto;font-size:13.5px}iframe.body{width:100%;height:420px;border:1px solid var(--line);border-radius:8px;background:#fff}",
  ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.stat{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center}.stat b{display:block;font-size:22px}.stat span{color:var(--mut);font-size:12px}",
  "a{color:var(--acc)}summary{cursor:pointer;color:var(--mut)}h2{font-size:15px;margin-bottom:12px;font-weight:600}h3{font-size:13.5px;margin:14px 0 8px;font-weight:600;color:var(--mut)}details{margin-top:8px}hr.b{border:none;border-top:1px solid var(--line);margin:18px 0}",
  "[data-admin] .topbar,[data-admin] button:not(.ghost):not(.danger){--acc:#e0954d;--acc-bg:#2b1f14}",
].join("\n");

const TOAST_JS = [
  "function toast(msg,bad){var t=document.getElementById('toast');t.textContent=msg;t.className='toast show'+(bad?' bad':'');clearTimeout(t._h);t._h=setTimeout(function(){t.className='toast';},3800);}",
  "function esc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}",
  "function fmtDate(s){try{return new Date(s).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'});}catch(e){return s;}}",
  "var S={tok:localStorage.getItem('nmail_token')||'',user:JSON.parse(localStorage.getItem('nmail_user')||'null')};",
  "function save(tok,user){S.tok=tok;S.user=user;localStorage.setItem('nmail_token',tok);localStorage.setItem('nmail_user',JSON.stringify(user));}",
  "function logout(){localStorage.removeItem('nmail_token');localStorage.removeItem('nmail_user');location.href='/';}",
  "function api(path,opts){opts=opts||{};opts.headers=Object.assign({'content-type':'application/json','authorization':'Bearer '+S.tok},opts.headers||{});return fetch('/api/v1/mail'+path,opts).then(function(r){if(r.status===401&&path!=='/login'){if(!S.tok)return r.json();return r.json().catch(function(){return null;}).then(function(j){var m=(j&&j.error&&j.error.message)||'Sesión vencida — entra de nuevo';var f=(j&&j.error&&j.error.fix)?' · '+j.error.fix:'';toast(m+f,1);setTimeout(logout,6000);throw new Error('401');});}return r.json();});}",
].join("\n");

export const WEBMAIL_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neat Mail 📮</title><link rel="icon" href="https://neat.blue/favicon.ico"><style>${BASE_CSS}</style></head>
<body><div class="wrap">
<div class="topbar"><span style="font-size:18px">📮</span> <b>Neat Mail</b><span style="flex:1"></span><a href="https://neat.blue">neat.blue</a></div>
<div class="content" id="app"></div>
<div id="toast" class="toast"></div>
<div class="mut" style="margin-top:26px;font-size:12px;text-align:center;padding:0 20px">Buzón automático <b>tunombre@neat.qzz.io</b> con tu cuenta · 1× <b>tunombre@is-so.pro</b> si la reclamas · recibir, no enviar (por ahora)</div>
</div>
<script>
${TOAST_JS}
var boxes=[],msgs=[],filterAddr='',unread=0;
function login(e){e.preventDefault();var u=document.getElementById('lu').value.trim(),p=document.getElementById('lp').value;var b=document.getElementById('lb');b.disabled=true;b.textContent='entrando…';
 fetch('/api/v1/mail/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:p})})
 .then(function(r){return r.json();}).then(function(j){
  b.disabled=false;b.textContent='Entrar 📮';
  if(!j.success){toast(j.error.message+(j.error.fix?' · '+j.error.fix:''),1);return;}
  save(j.data.token,{username:j.data.username,role:j.data.role});toast('Bienvenido, '+j.data.username+' 👋');boot();
 }).catch(function(){b.disabled=false;b.textContent='Entrar 📮';toast('No pudimos llegar al servidor — reintenta',1);});}
function boot(){api('/').then(function(j){if(!j.success)return;boxes=j.data.mailboxes;msgs=j.data.messages;unread=j.data.unread;render();}).catch(function(){});}
function refresh(){api('/messages'+(filterAddr?'?address='+encodeURIComponent(filterAddr)+'&limit=50':'?limit=50')).then(function(j){if(j.success){msgs=j.data.messages;renderList();}}).catch(function(){});}
function doRefresh(){refresh();boot();}
function claim(){var inp=document.getElementById('claimname'),v=inp.value.trim();if(!v)return;
 api('/claim',{method:'POST',body:JSON.stringify({address:v})}).then(function(j){
  if(!j.success){toast(j.error.code+': '+j.error.message+(j.error.fix?' · '+j.error.fix:''),1);return;}
  toast('📬 '+j.data.address+' es tuya');inp.value='';boot();});}
function openMsg(id){api('/messages/'+id).then(function(j){if(!j.success)return;renderMsg(j.data);refresh();}).catch(function(){});}
function markUnread(id){api('/messages/'+id,{method:'PATCH',body:JSON.stringify({is_read:0})}).then(function(){toast('Marcado pendiente');refresh();});}
function delMsg(id){if(!confirm('¿Borrar este correo para siempre?'))return;api('/messages/'+id,{method:'DELETE'}).then(function(){toast('Borrado');document.getElementById('reader').innerHTML='<span class="mut">Abre un correo para leerlo aquí.</span>';boot();});}
function render(){var el=document.getElementById('app');
 if(!S.tok||!S.user){el.innerHTML='<div class="card" style="max-width:380px;margin:40px auto"><h2>Entra con tu cuenta Neat</h2><p class="mut" style="margin-bottom:14px">El mismo usuario y contraseña de tu cuenta. Tu buzón <b>tunombre@neat.qzz.io</b> ya te está esperando.</p><form onsubmit="login(event)"><input id="lu" placeholder="usuario" autocomplete="username" required style="margin-bottom:8px"><input id="lp" type="password" placeholder="contraseña" autocomplete="current-password" required style="margin-bottom:12px"><button id="lb" type="submit" style="width:100%">Entrar 📮</button></form></div>';return;}
 var h='<div class="card row"><div style="flex:1">Hola <b>'+esc(S.user.username)+'</b> <span class="pill">'+esc(S.user.role||'user')+'</span> <span class="pill">'+unread+' sin leer</span></div>';
 if(S.user.role==='admin')h+='<button class="mini ghost" data-act="admin">🛠 panel</button>';
 h+='<button class="mini ghost" data-act="refresh">↻ actualizar</button><button class="mini ghost" data-act="logout">salir</button></div>';
 h+='<div class="card"><h2>Tus buzones</h2><div class="row">';
 h+='<button class="chip'+(!filterAddr?' on':'')+'" data-act="chip" data-a="">todos</button>';
 boxes.forEach(function(b){h+='<button class="chip'+(filterAddr===b.address?' on':'')+'" data-act="chip" data-a="'+esc(b.address)+'">'+esc(b.address)+(b.blocked?' 🔒':'')+'</button>';});
 h+='</div><h3 style="margin-top:16px">¿Quieres tu @is-so.pro? (1 por cuenta)</h3><form onsubmit="event.preventDefault();claim();" class="row"><input id="claimname" placeholder="tunombre" style="max-width:260px"><span class="mut">@is-so.pro</span><button class="mini" type="submit">reclamar</button></form><p class="mut" style="margin-top:6px">El correo que llegue antes de que la reclames se guarda y aparece aquí en cuanto es tuya. Minúsculas, números, punto, guion y guion_bajo.</p></div>';
 h+='<div class="card" style="padding:8px"><div class="row" style="justify-content:space-between;padding:8px 10px 10px"><h2 style="margin:0">Bandeja</h2><span class="mut" id="lcount"></span></div><div id="list"></div></div><div class="card" id="reader"><span class="mut">Abre un correo para leerlo aquí.</span></div>';
 el.innerHTML=h;renderList();}
function renderList(){var el=document.getElementById('list');if(!el)return;document.getElementById('lcount').textContent=msgs.length+' correos';
 if(!msgs.length){el.innerHTML='<p class="mut" style="padding:10px">Nada por aquí todavía. Cuando alguien te escriba, aparece solo. 📭</p>';return;}
 var h='';msgs.forEach(function(m){h+='<div class="msg'+(m.is_read?'':' unread')+'" data-act="open" data-id="'+esc(m.id)+'"><div class="from">'+esc(m.sender)+'</div><div class="sub-wrap"><span class="sub">'+esc(m.subject)+'</span></div><div class="time">'+fmtDate(m.created_at)+'</div></div>';});el.innerHTML=h;}
function renderMsg(m){var el=document.getElementById('reader');var h='<div class="row" style="justify-content:space-between"><h2 style="margin:0">'+esc(m.subject)+'</h2><div class="row"><button class="mini ghost" data-act="unread" data-id="'+esc(m.id)+'">pendiente</button><button class="mini danger" data-act="del" data-id="'+esc(m.id)+'">borrar</button></div></div><p class="mut mono" style="margin:6px 0 12px">'+esc(m.sender)+' → '+esc(m.address)+' · '+fmtDate(m.created_at)+(m.has_attach?' · 📎 '+m.attach_names.map(esc).join(', '):'')+'</p>';
 if(m.text){h+='<pre class="body">'+esc(m.text)+'</pre>';}else if(m.html){h+='<iframe class="body" sandbox="" srcdoc="'+esc(m.html)+'"></iframe>';}else{h+='<p class="mut">Correo muy pesado: solo metadatos disponibles.</p>';}
 el.innerHTML=h;}
document.addEventListener('click',function(e){var b=e.target.closest('[data-act]');if(!b)return;var act=b.dataset.act;
 if(act==='admin')location.href='/admin';
 if(act==='logout')logout();
 if(act==='refresh')doRefresh();
 if(act==='chip'){filterAddr=b.dataset.a||'';render();refresh();}
 if(act==='open')openMsg(b.dataset.id);
 if(act==='unread')markUnread(b.dataset.id);
 if(act==='del')delMsg(b.dataset.id);
});
// sin sesión: pantalla de login directa — NADA de llamar a la API sin token
// (boot() sin token → 401 → toast → logout → recarga → loop infinito)
if(S.tok&&S.user){boot();}else{render();}
</script></body></html>`;

export const ADMIN_HTML = `<!doctype html>
<html lang="es" data-admin><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neat Mail · Admin 🛠</title><link rel="icon" href="https://neat.blue/favicon.ico"><style>${BASE_CSS}</style></head>
<body><div class="wrap">
<div class="topbar"><span style="font-size:18px">🛠</span> <b>Neat Mail · Admin</b><span class="pill" style="border-color:#e0954d;color:#e0954d">acceso admin</span><span style="flex:1"></span><a href="/">← webmail</a></div>
<div class="content" id="app"></div><div id="toast" class="toast"></div>
</div>
<script>
${TOAST_JS}
function stats(){api('/admin/stats').then(function(j){if(!j.success)return;var d=j.data;var h='<div class="grid">'+
 '<div class="stat"><b>'+d.mboxes+'</b><span>buzones</span></div><div class="stat"><b>'+d.messages+'</b><span>correos</span></div><div class="stat"><b>'+d.unread+'</b><span>sin leer</span></div><div class="stat"><b>'+d.orphans+'</b><span>huérfanos</span></div><div class="stat"><b>'+d.blocked+'</b><span>suspendidos</span></div></div>'+
 '<p class="mut" style="margin-top:10px">'+esc(d.by_domain['neat.qzz.io'])+' × @neat.qzz.io · '+esc(d.by_domain['is-so.pro'])+' × @is-so.pro</p>';
 document.getElementById('stats').innerHTML=h;}).catch(function(){});}
function boxes(){var q=document.getElementById('bq').value.trim();
 api('/admin/boxes?limit=200'+(q?'&q='+encodeURIComponent(q):'')).then(function(j){if(!j.success)return;
 var h='<table><tr><th>buzón</th><th>dueño</th><th>origen</th><th>correos</th><th></th></tr>';
 j.data.boxes.forEach(function(b){h+='<tr><td class="mono">'+esc(b.address)+(b.blocked?' <span class="pill block">susp</span>':'')+'</td><td>'+esc(b.owner)+'</td><td><span class="pill '+(b.source==='auto'?'auto':'')+'">'+esc(b.source)+'</span></td><td>'+b.messages+' <span class="mut">('+b.unread+' nuevos)</span></td><td class="row" style="flex-wrap:nowrap">'+
 '<button class="mini ghost" data-act="msgs" data-a="'+esc(b.address)+'">📥</button>'+
 '<button class="mini ghost" data-act="reown" data-a="'+esc(b.address)+'" data-o="'+esc(b.owner)+'">✏️</button>'+
 '<button class="mini '+(b.blocked?'':'danger')+'" data-act="block" data-a="'+esc(b.address)+'" data-v="'+(b.blocked?0:1)+'">'+(b.blocked?'🔓':'🔒')+'</button>'+
 '<button class="mini danger" data-act="delbox" data-a="'+esc(b.address)+'" data-n="'+b.messages+'">🗑</button></td></tr>';});
 h+='</table>';document.getElementById('btable').innerHTML=h;}).catch(function(){});}
function createBox(){var a=document.getElementById('nba').value.trim(),o=document.getElementById('nbo').value.trim();if(!a||!o){toast('address y owner, ambos',1);return;}
 api('/admin/boxes',{method:'POST',body:JSON.stringify({address:a,owner:o})}).then(function(j){if(!j.success){toast(j.error.code+': '+j.error.message,1);return;}toast('Buzón creado ✔');document.getElementById('nba').value='';document.getElementById('nbo').value='';stats();boxes();});}
function reown(addr,old){var o=prompt('Nuevo dueño de '+addr+' (ahora: '+old+'):');if(!o)return;
 api('/admin/boxes/'+addr,{method:'PATCH',body:JSON.stringify({owner:o})}).then(function(j){if(!j.success){toast(j.error.message,1);return;}toast('Reasignado ✔');stats();boxes();});}
function toggleBlock(addr,v){api('/admin/boxes/'+addr,{method:'PATCH',body:JSON.stringify({blocked:v})}).then(function(j){if(j.success){toast(v?'Buzón suspendido 🔒':'Buzón reactivado 🔓');stats();boxes();}});}
function delBox(addr,n){if(!confirm('¿BORRAR '+addr+' y sus '+n+' correos? Esto no tiene vuelta.'))return;if(!confirm('Última llamada: se va TODO su correo. ¿Seguro?'))return;
 api('/admin/boxes/'+addr,{method:'DELETE'}).then(function(j){if(j.success){toast('Borrado ('+n+' correos)');stats();boxes();}});}
function msgsOf(addr){api('/admin/messages?address='+encodeURIComponent(addr)+'&limit=100').then(function(j){if(!j.success)return;
 var h='<h3>📥 '+esc(addr)+' ('+j.data.messages.length+')</h3>';
 if(!j.data.messages.length)h+='<p class="mut">Vacío.</p>';
 j.data.messages.forEach(function(m){h+='<div class="msg'+(m.is_read?'':' unread')+'" data-act="open" data-id="'+esc(m.id)+'"><div class="from">'+esc(m.sender)+'</div><div class="sub-wrap"><span class="sub">'+esc(m.subject)+'</span></div><div class="time">'+fmtDate(m.created_at)+'</div></div>';});
 document.getElementById('detail').innerHTML=h;}).catch(function(){});}
function orphans(){api('/admin/orphans?limit=100').then(function(j){if(!j.success)return;
 var h='<h3>Huérfanos ('+j.data.orphans.length+') — se adoptan solos al crear su buzón</h3>';
 if(!j.data.orphans.length)h+='<p class="mut">Ninguno. 🎉</p>';
 j.data.orphans.forEach(function(m){h+='<div class="msg" data-act="open" data-id="'+esc(m.id)+'"><div class="from">'+esc(m.sender)+'</div><div class="sub-wrap"><span class="sub">'+esc(m.subject)+'</span> <span class="mono">→ '+esc(m.address)+'</span></div><div class="time">'+fmtDate(m.created_at)+'</div></div>';});
 document.getElementById('orph').innerHTML=h;}).catch(function(){});}
function openAdmin(id){api('/admin/messages/'+id).then(function(j){if(!j.success)return;var m=j.data;
 var h='<h3>'+esc(m.subject)+'</h3><p class="mut mono">'+esc(m.sender)+' → '+esc(m.address)+' · dueño: '+esc(m.owner||'(huérfano)')+' · '+fmtDate(m.created_at)+'</p>';
 h+=m.text?'<pre class="body">'+esc(m.text)+'</pre>':(m.html?'<details><summary>ver HTML (sandbox)</summary><iframe class="body" sandbox="" srcdoc="'+esc(m.html)+'"></iframe></details>':'<p class="mut">Solo metadatos.</p>');
 h+='<div class="row" style="margin-top:10px"><button class="mini danger" data-act="delmsg" data-id="'+esc(m.id)+'">🗑 borrar correo</button></div><hr class="b">';
 document.getElementById('detail').innerHTML=h+document.getElementById('detail').innerHTML;}).catch(function(){});}
function delAdmin(id){if(!confirm('¿Borrar este correo?'))return;api('/admin/messages/'+id,{method:'DELETE'}).then(function(){toast('Correo borrado');stats();});}
function doSearch(e){e.preventDefault();boxes();}
if(!S.tok||!S.user||S.user.role!=='admin'){document.getElementById('app').innerHTML='<div class="card" style="max-width:380px;margin:40px auto"><h2>Solo el admin</h2><p class="mut" style="margin-bottom:12px">Entra primero al webmail con la cuenta admin.</p><button data-act="home">Ir al webmail</button></div>';}
else{
 document.getElementById('app').innerHTML='<div class="card" id="stats"></div>'+
 '<div class="card"><h2>Crear buzón</h2><form onsubmit="event.preventDefault();createBox();" class="row"><input id="nba" placeholder="nombre@neat.qzz.io | nombre@is-so.pro" style="flex:2;min-width:220px"><input id="nbo" placeholder="dueño (cuenta Neat)" style="flex:1;min-width:140px"><button class="mini" type="submit">crear + adoptar</button></form><p class="mut" style="margin-top:6px">El admin sí puede asignar nombres reservados (hola@, support@…).</p></div>'+
 '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Buzones</h2><form onsubmit="doSearch(event)" class="row"><input id="bq" placeholder="buscar…" style="width:170px"><button class="mini ghost" type="submit">buscar</button><button class="mini ghost" type="button" data-act="reload">↻</button></form></div><div id="btable" style="margin-top:10px"></div></div>'+
 '<div class="card" id="detail"><span class="mut">Toca 📥 en un buzón para ver su correo, o un huérfano abajo.</span></div>'+
 '<div class="card" id="orph"></div>';
 stats();boxes();orphans();
}
document.addEventListener('click',function(e){var b=e.target.closest('[data-act]');if(!b)return;var act=b.dataset.act;
 if(act==='home')location.href='/';
 if(act==='reload'){stats();boxes();orphans();}
 if(act==='msgs')msgsOf(b.dataset.a);
 if(act==='reown')reown(b.dataset.a,b.dataset.o);
 if(act==='block')toggleBlock(b.dataset.a,parseInt(b.dataset.v,10));
 if(act==='delbox')delBox(b.dataset.a,b.dataset.n);
 if(act==='open')openAdmin(b.dataset.id);
 if(act==='delmsg')delAdmin(b.dataset.id);
});
</script></body></html>`;
