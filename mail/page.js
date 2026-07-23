// 📮 Páginas del Neat Mail Worker: webmail (/) y panel admin (/admin)
// Se sirven inline desde el worker. Toda la lógica es fetch() same-origin a /api/v1/mail.
// OJO: dentro de estas plantillas no usar backticks ni ${} en el JS embebido (rompería la plantilla).

const BASE_CSS = [
  ":root{--bg:#070d2b;--card:#0e1740;--line:#22306b;--txt:#e9edff;--mut:#8fa0d8;--acc:#4d7cff;--ok:#34d399;--bad:#f87171;--warn:#fbbf24;}",
  "*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;line-height:1.45}",
  ".wrap{max-width:920px;margin:0 auto;padding:24px 16px 64px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}.brand b{font-size:20px}.brand small{color:var(--mut)}",
  ".card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}",
  "input,button{font:inherit;border-radius:10px;border:1px solid var(--line);padding:10px 12px}input{background:#0a1234;color:var(--txt);width:100%}button{background:var(--acc);border-color:var(--acc);color:#fff;cursor:pointer;font-weight:600}button.ghost{background:transparent;color:var(--txt)}button.mini{padding:4px 9px;font-size:12px}button.danger{background:transparent;border-color:var(--bad);color:var(--bad)}button:disabled{opacity:.5;cursor:default}",
  ".row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mut{color:var(--mut);font-size:13px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-all}",
  ".chip{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;cursor:pointer;background:transparent;color:var(--txt)}.chip.on{background:var(--acc);border-color:var(--acc)}",
  ".msg{display:flex;gap:10px;align-items:baseline;justify-content:space-between;padding:10px 6px;border-bottom:1px solid var(--line);cursor:pointer}.msg:hover{background:#101b4a}.msg .sub{font-weight:600}.msg.unread .sub{color:#fff}.msg.unread .sub::before{content:'● ';color:var(--acc)}",
  ".toast{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;background:#101b4a;border:1px solid var(--line);padding:10px 16px;border-radius:12px;display:none;z-index:9;max-width:90vw}.toast.show{display:block}.toast.bad{border-color:var(--bad);color:var(--bad)}",
  "table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600}",
  ".pill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--mut)}.pill.block{border-color:var(--bad);color:var(--bad)}.pill.auto{border-color:var(--ok);color:var(--ok)}",
  "pre.body{white-space:pre-wrap;background:#0a1234;border:1px solid var(--line);border-radius:10px;padding:14px;max-height:420px;overflow:auto;font-size:13.5px}iframe.body{width:100%;height:420px;border:1px solid var(--line);border-radius:10px;background:#fff}",
  ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.stat{background:#0a1234;border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}.stat b{display:block;font-size:22px}.stat span{color:var(--mut);font-size:12px}",
  "a{color:var(--acc)}summary{cursor:pointer;color:var(--mut)}h2{font-size:16px;margin-bottom:10px}h3{font-size:14px;margin:14px 0 8px}",
].join("\n");

const TOAST_JS = [
  "function toast(msg,bad){var t=document.getElementById('toast');t.textContent=msg;t.className='toast show'+(bad?' bad':'');clearTimeout(t._h);t._h=setTimeout(function(){t.className='toast';},3800);}",
  "function esc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','&quot':'&quot;','\"':'&quot;'}[c];});}",
  "function fmtDate(s){try{return new Date(s).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'});}catch(e){return s;}}",
  "var S={tok:localStorage.getItem('nmail_token')||'',user:JSON.parse(localStorage.getItem('nmail_user')||'null')};",
  "function save(tok,user){S.tok=tok;S.user=user;localStorage.setItem('nmail_token',tok);localStorage.setItem('nmail_user',JSON.stringify(user));}",
  "function logout(){localStorage.removeItem('nmail_token');localStorage.removeItem('nmail_user');location.href='/';}",
  "function api(path,opts){opts=opts||{};opts.headers=Object.assign({'content-type':'application/json','authorization':'Bearer '+S.tok},opts.headers||{});return fetch('/api/v1/mail'+path,opts).then(function(r){if(r.status===401&&path!=='/login'){toast('Sesión vencida — entra de nuevo',1);setTimeout(logout,900);throw new Error('401');}return r.json();});}",
].join("\n");

export const WEBMAIL_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neat Mail 📮</title><link rel="icon" href="https://neat.blue/favicon.ico"><style>${BASE_CSS}</style></head>
<body><div class="wrap">
<div class="brand">📮 <b>Neat Mail</b><small class="mut">· tu correo vive en tu cuenta Neat</small><span style="flex:1"></span><a class="ghost mut" href="https://neat.blue" style="text-decoration:none;font-size:13px">neat.blue</a></div>
<div id="app"></div>
<div id="toast" class="toast"></div>
<div class="mut" style="margin-top:26px;font-size:12px;text-align:center">Buzón automático <b>tunombre@neat.qzz.io</b> con tu cuenta · 1× <b>tunombre@is-so.pro</b> si la reclamas · recibir, no enviar (por ahora)</div>
</div>
<script>
${TOAST_JS}
var boxes=[],msgs=[],filterAddr='',unread=0,SEED=0;
function login(e){e.preventDefault();var u=document.getElementById('lu').value.trim(),p=document.getElementById('lp').value;
 fetch('/api/v1/mail/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:p})})
 .then(function(r){return r.json();}).then(function(j){
  if(!j.success){toast(j.error.message+(j.error.fix?' · '+j.error.fix:''),1);return;}
  save(j.data.token,{username:j.data.username,role:j.data.role});toast('Bienvenido, '+j.data.username+' 👋');boot();
 }).catch(function(){toast('No pudimos llegar al servidor — reintenta',1);});}
function boot(){api('/').then(function(j){if(!j.success)return;boxes=j.data.mailboxes;msgs=j.data.messages;unread=j.data.unread;render();}).catch(function(){});}
function refresh(addr){api('/messages'+(addr?'?address='+encodeURIComponent(addr)+'&limit=50':'?limit=50')).then(function(j){if(j.success){msgs=j.data.messages;renderList();}});}
function claim(){var inp=document.getElementById('claimname'),v=inp.value.trim();if(!v)return;
 api('/claim',{method:'POST',body:JSON.stringify({address:v})}).then(function(j){
  if(!j.success){toast(j.error.code+': '+j.error.message+(j.error.fix?' · '+j.error.fix:''),1);return;}
  toast('📬 '+j.data.address+' es tuya');inp.value='';boot();});}
function openMsg(id){api('/messages/'+id).then(function(j){if(!j.success)return;renderMsg(j.data);refresh(filterAddr);});}
function markUnread(id){api('/messages/'+id,{method:'PATCH',body:JSON.stringify({is_read:0})}).then(function(){toast('Marcado pendiente');refresh(filterAddr);});}
function delMsg(id){if(!confirm('¿Borrar este correo para siempre?'))return;api('/messages/'+id,{method:'DELETE'}).then(function(){toast('Borrado');document.getElementById('reader').innerHTML='';boot();});}
function render(){var el=document.getElementById('app');
 if(!S.tok||!S.user){el.innerHTML='<div class="card"><h2>Entra con tu cuenta Neat</h2><p class="mut" style="margin-bottom:12px">El mismo usuario y contraseña de tu cuenta. Tu buzón <b>tunombre@neat.qzz.io</b> ya te está esperando.</p><form onsubmit="login(event)"><input id="lu" placeholder="usuario" autocomplete="username" required style="margin-bottom:8px"><input id="lp" type="password" placeholder="contraseña" autocomplete="current-password" required style="margin-bottom:12px"><button type="submit" style="width:100%">Entrar 📮</button></form></div>';return;}
 var h='<div class="card row"><div style="flex:1">Hola <b>'+esc(S.user.username)+'</b> <span class="pill">'+esc(S.user.role||'user')+'</span> <span class="pill">'+unread+' sin leer</span></div>'+(S.user.role==='admin'?'<button class="mini ghost" onclick="location.href='+"'+'/admin'+"'"+'">🛠 panel</button>':'')+'<button class="mini ghost" onclick="refresh(filterAddr)">↻ actualizar</button><button class="mini ghost" onclick="logout()">salir</button></div>';
 h+='<div class="card"><h2>Tus buzones</h2><div class="row" id="chips">';
 h+='<button class="chip'+(!filterAddr?' on':'')+'" onclick="filterAddr=\'\';renderChips();refresh(\'\')">todos</button>';
 boxes.forEach(function(b){h+='<button class="chip'+(filterAddr===b.address?' on':'')+'" onclick="filterAddr=\''+esc(b.address)+'\';renderChips();refresh(\''+esc(b.address)+'\')">'+esc(b.address)+(b.blocked?' 🔒':'')+'</button>';});
 h+='</div><h3>¿Quieres tu @is-so.pro? (1 por cuenta)</h3><div class="row"><input id="claimname" placeholder="tunombre" style="max-width:260px"><span class="mut">@is-so.pro</span><button class="mini" onclick="claim()">reclamar</button></div><p class="mut" style="margin-top:6px">El correo que llegue antes de que la reclames se guarda y aparece aquí en cuanto es tuya. Minúsculas, números, punto, guion y guion_bajo.</p></div>';
 h+='<div class="card"><h2>Bandeja <span class="mut" id="lcount"></span></h2><div id="list"></div></div><div class="card" id="reader"><span class="mut">Abre un correo para leerlo aquí.</span></div>';
 el.innerHTML=h;renderList();}
function renderChips(){render();}
function renderList(){var el=document.getElementById('list');if(!el)return;document.getElementById('lcount').textContent='('+msgs.length+')';
 if(!msgs.length){el.innerHTML='<p class="mut">Nada por aquí todavía. Cuando alguien te escriba, aparece solo. 📭</p>';return;}
 var h='';msgs.forEach(function(m){h+='<div class="msg'+(m.is_read?'':' unread')+'" onclick="openMsg(\''+m.id+'\')"><div style="min-width:0"><div class="sub">'+esc(m.subject)+'</div><div class="mut mono">'+esc(m.sender)+' → '+esc(m.address)+'</div></div><div class="mut" style="white-space:nowrap;font-size:12px">'+fmtDate(m.created_at)+'</div></div>';});el.innerHTML=h;}
function renderMsg(m){var el=document.getElementById('reader');var h='<div class="row" style="justify-content:space-between"><h2 style="margin:0">'+esc(m.subject)+'</h2><div class="row"><button class="mini ghost" onclick="markUnread(\''+m.id+'\')">pendiente</button><button class="mini danger" onclick="delMsg(\''+m.id+'\')">borrar</button></div></div><p class="mut mono" style="margin:6px 0 12px">'+esc(m.sender)+' → '+esc(m.address)+' · '+fmtDate(m.created_at)+(m.has_attach?' · 📎 '+m.attach_names.map(esc).join(', '):'')+'</p>';
 if(m.text){h+='<pre class="body">'+esc(m.text)+'</pre>';}else if(m.html){h+='<iframe class="body" sandbox="" srcdoc="'+esc(m.html)+'"></iframe>';}else{h+='<p class="mut">Correo muy pesado: solo metadatos disponibles.</p>';}
 el.innerHTML=h;}
boot();
</script></body></html>`;

export const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neat Mail · Admin 🛠</title><link rel="icon" href="https://neat.blue/favicon.ico"><style>${BASE_CSS} details{margin-top:8px}</style></head>
<body><div class="wrap">
<div class="brand">🛠 <b>Neat Mail · Admin</b><small class="mut">· control total de buzones</small><span style="flex:1"></span><a class="mut" href="/" style="font-size:13px">← webmail</a></div>
<div id="app"></div><div id="toast" class="toast"></div>
</div>
<script>
${TOAST_JS}
if(!S.tok||!S.user||S.user.role!=='admin'){document.getElementById('app').innerHTML='<div class="card"><h2>Solo el admin</h2><p class="mut">Entra primero al webmail con la cuenta admin.</p><button onclick="location.href='+"'/'"+'">Ir al webmail</button></div>';}
else{
function stats(){api('/admin/stats').then(function(j){if(!j.success)return;var d=j.data;var h='<div class="grid">'+
 '<div class="stat"><b>'+d.mboxes+'</b><span>buzones</span></div><div class="stat"><b>'+d.messages+'</b><span>correos</span></div><div class="stat"><b>'+d.unread+'</b><span>sin leer</span></div><div class="stat"><b>'+d.orphans+'</b><span>huérfanos</span></div><div class="stat"><b>'+d.blocked+'</b><span>suspendidos</span></div></div>'+
 '<p class="mut" style="margin-top:8px">'+esc(d.by_domain['neat.qzz.io'])+' × @neat.qzz.io · '+esc(d.by_domain['is-so.pro'])+' × @is-so.pro</p>';
 document.getElementById('stats').innerHTML=h;}).catch(function(){});}
function boxes(){var q=document.getElementById('bq').value.trim();
 api('/admin/boxes?limit=200'+(q?'&q='+encodeURIComponent(q):'')).then(function(j){if(!j.success)return;
 var h='<table><tr><th>buzón</th><th>dueño</th><th>origen</th><th>correos</th><th></th></tr>';
 j.data.boxes.forEach(function(b){h+='<tr><td class="mono">'+esc(b.address)+(b.blocked?' <span class="pill block">susp</span>':'')+'</td><td>'+esc(b.owner)+'</td><td><span class="pill '+(b.source==='auto'?'auto':'')+'">'+esc(b.source)+'</span></td><td>'+b.messages+' <span class="mut">('+b.unread+' nuevos)</span></td><td class="row" style="flex-wrap:nowrap">'+
 '<button class="mini ghost" onclick="msgsOf(\''+esc(b.address)+'\')">📥</button>'+
 '<button class="mini ghost" onclick="reown(\''+esc(b.address)+'\',\''+esc(b.owner)+'\')">✏️</button>'+
 '<button class="mini '+(b.blocked?'':'danger')+'" onclick="toggleBlock(\''+esc(b.address)+'\','+(b.blocked?0:1)+')">'+(b.blocked?'🔓':'🔒')+'</button>'+
 '<button class="mini danger" onclick="delBox(\''+esc(b.address)+'\','+b.messages+')">🗑</button></td></tr>';});
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
 j.data.messages.forEach(function(m){h+='<div class="msg'+(m.is_read?'':' unread')+'" onclick="openAdmin(\''+m.id+'\')"><div style="min-width:0"><div class="sub">'+esc(m.subject)+'</div><div class="mut mono">'+esc(m.sender)+'</div></div><div class="mut" style="font-size:12px">'+fmtDate(m.created_at)+'</div></div>';});
 document.getElementById('detail').innerHTML=h;});}
function orphans(){api('/admin/orphans?limit=100').then(function(j){if(!j.success)return;
 var h='<h3>Huérfanos ('+j.data.orphans.length+') — se adoptan solos al crear su buzón</h3>';
 if(!j.data.orphans.length)h+='<p class="mut">Ninguno. 🎉</p>';
 j.data.orphans.forEach(function(m){h+='<div class="msg" onclick="openAdmin(\''+m.id+'\')"><div style="min-width:0"><div class="sub">'+esc(m.subject)+'</div><div class="mut mono">'+esc(m.sender)+' → '+esc(m.address)+'</div></div><div class="mut" style="font-size:12px">'+fmtDate(m.created_at)+'</div></div>';});
 document.getElementById('orph').innerHTML=h;}).catch(function(){});}
function openAdmin(id){api('/admin/messages/'+id).then(function(j){if(!j.success)return;var m=j.data;
 var h='<h3>'+esc(m.subject)+'</h3><p class="mut mono">'+esc(m.sender)+' → '+esc(m.address)+' · dueño: '+esc(m.owner||'(huérfano)')+' · '+fmtDate(m.created_at)+'</p>';
 h+=m.text?'<pre class="body">'+esc(m.text)+'</pre>':(m.html?'<details><summary>ver HTML (sắndbox)</summary><iframe class="body" sandbox="" srcdoc="'+esc(m.html)+'"></iframe></details>':'<p class="mut">Solo metadatos.</p>');
 h+='<div class="row" style="margin-top:10px"><button class="mini danger" onclick="delAdmin(\''+m.id+'\')">🗑 borrar correo</button></div>';
 document.getElementById('detail').innerHTML=h+'<hr style="border-color:var(--line);margin:18px 0">'+document.getElementById('detail').innerHTML;});}
function delAdmin(id){if(!confirm('¿Borrar este correo?'))return;api('/admin/messages/'+id,{method:'DELETE'}).then(function(){toast('Correo borrado');stats();});}
document.getElementById('app').innerHTML='<div class="card" id="stats"></div>'+
 '<div class="card"><h2>Crear buzón</h2><div class="row"><input id="nba" placeholder="nombre@neat.qzz.io | nombre@is-so.pro" style="flex:2;min-width:220px"><input id="nbo" placeholder="dueño (cuenta Neat)" style="flex:1;min-width:140px"><button class="mini" onclick="createBox()">crear + adoptar</button></div><p class="mut" style="margin-top:6px">El admin sí puede asignar nombres reservados (hola@, support@…).</p></div>'+
 '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Buzones</h2><div class="row"><input id="bq" placeholder="buscar…" style="width:170px" onkeydown="if(event.key===\'Enter\')boxes()"><button class="mini ghost" onclick="boxes()">buscar</button><button class="mini ghost" onclick="stats();boxes();orphans()">↻</button></div></div><div id="btable" style="margin-top:10px"></div></div>'+
 '<div class="card" id="detail"><span class="mut">Toca 📥 en un buzón para ver su correo, o un huérfano abajo.</span></div>'+
 '<div class="card" id="orph"></div>';
stats();boxes();orphans();
}
</script></body></html>`;
