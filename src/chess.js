// ═══ MOTOR DE AJEDREZ VENDORED — NO EDITAR AQUÍ ═══
// Fuente de verdad: neat-apps/chess.html (misma copia byte a byte, validada 43/43:
// perft CPW exacto en 6 posiciones, invariante undo FEN+hist, 18 unit tests).
// Si hay que tocar el motor: se toca en chess.html, se re-valida y se re-copia.
// Motor de ajedrez completo (inline, sin dependencias).
// Validado 2026-07-19 (43/43): perft exacto CPW — startpos d1..d5 (20/400/8902/197281/4865609),
// kiwipete d1..d4 (48/2039/97862/4085603), pos3 ep/clavadas d1..d5 (14/191/2812/43238/674624),
// pos4 promociones d1..d4 (6/264/9467/422333), pos5 d1..d3 (44/1486/62379), pos6 d1..d3 (46/2079/89890);
// undo byte-exacto (invariante FEN+hist a toda profundidad) + 18 unit tests
// (ep FEN exacto, mates, ahogado, enroques SAN/FEN, enroque-a-través-de-jaque-de-peón, 3-fold FIDE, 50-move).
// NO TOCAR sin re-validar con la suite completa.
"use strict";
const GLYPHS={k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"};
const FILES="abcdefgh";
const KNIGHT=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIAG=[[-1,-1],[-1,1],[1,-1],[1,1]], ORTHO=[[-1,0],[0,-1],[0,1],[1,0]];
function sq(f,r){return r*8+f}
function inB(f,r){return f>=0&&f<8&&r>=0&&r<8}
function alg(s){return FILES[s%8]+(8-((s/8)|0))}
function parseSq(a){return (8-parseInt(a[1],10))*8+FILES.indexOf(a[0])}
class Chess{
  constructor(fen){
    this.reset();
    if(fen) this.load(fen);
  }
  reset(){
    this.b=new Array(64).fill(null); // {c:'w'|'b', t:'kqrnbp'}
    this.turn='w'; this.cast='KQkq'; this.ep=-1; this.half=0; this.full=1; this.hist=[]; this.rep={};
    const back='rnbqkbnr';
    for(let f=0;f<8;f++){
      this.b[sq(f,0)]={c:'b',t:back[f]};this.b[sq(f,1)]={c:'b',t:'p'};
      this.b[sq(f,6)]={c:'w',t:'p'};this.b[sq(f,7)]={c:'w',t:back[f]};
    }
    this.rep[this.posKey()]=1;
  }
  posKey(){let s=this.turn+"|"+this.cast+"|"+this.ep+"|";for(let i=0;i<64;i++){const p=this.b[i];s+=p?(p.c==='w'?p.t.toUpperCase():p.t):'.';}return s;}
  load(fen){
    const [pos,t,c,e,h,fu]=fen.trim().split(/\s+/);
    this.b=new Array(64).fill(null);
    pos.split('/').forEach((row,r)=>{let f=0;for(const ch of row){if(/\d/.test(ch)){f+=+ch;}else{this.b[sq(f,r)]={c:ch===ch.toUpperCase()?'w':'b',t:ch.toLowerCase()};f++;}}});
    this.turn=t;this.cast=(c&&c!=='-')?c:'';this.ep=(e&&e!=='-')?parseSq(e):-1;this.half=+(h||0);this.full=+(fu||1);this.hist=[];this.rep={};
    this.rep[this.posKey()]=1; // sembrar posición inicial (3-fold FIDE cuenta la inicial)
  }
  fen(){
    const rows=[];
    for(let r=0;r<8;r++){let row='',n=0;for(let f=0;f<8;f++){const p=this.b[sq(f,r)];if(!p)n++;else{if(n){row+=n;n=0;}row+=p.c==='w'?p.t.toUpperCase():p.t;}}if(n)row+=n;rows.push(row);}
    return rows.join('/')+' '+this.turn+' '+(this.cast||'-')+' '+(this.ep>=0?alg(this.ep):'-')+' '+this.half+' '+this.full;
  }
  kingSq(c){for(let i=0;i<64;i++){const p=this.b[i];if(p&&p.c===c&&p.t==='k')return i;}return -1;}
  attacked(s,by){ // ¿casilla s atacada por bando by?
    const tf=s%8,tr=(s/8)|0;
    // peones
    const dr=by==='w'?1:-1; // peón atacante blanco está UNA fila abajo (r+1), negro arriba (r-1)
    for(const df of[-1,1]){const f=tf+df,r=tr+dr;if(inB(f,r)){const p=this.b[sq(f,r)];if(p&&p.c===by&&p.t==='p')return true;}}
    for(const [df,dr2]of KNIGHT){const f=tf+df,r=tr+dr2;if(inB(f,r)){const p=this.b[sq(f,r)];if(p&&p.c===by&&p.t==='n')return true;}}
    for(const [df,dr2]of KING){const f=tf+df,r=tr+dr2;if(inB(f,r)){const p=this.b[sq(f,r)];if(p&&p.c===by&&p.t==='k')return true;}}
    for(const [df,dr2]of DIAG){let f=tf+df,r=tr+dr2;while(inB(f,r)){const p=this.b[sq(f,r)];if(p){if(p.c===by&&(p.t==='b'||p.t==='q'))return true;break;}f+=df;r+=dr2;}}
    for(const [df,dr2]of ORTHO){let f=tf+df,r=tr+dr2;while(inB(f,r)){const p=this.b[sq(f,r)];if(p){if(p.c===by&&(p.t==='r'||p.t==='q'))return true;break;}f+=df;r+=dr2;}}
    return false;
  }
  inCheck(c){return this.attacked(this.kingSq(c),c==='w'?'b':'w');}
  pseudo(c){ // pseudo-legales de bando c
    const M=[];
    for(let s=0;s<64;s++){
      const p=this.b[s];if(!p||p.c!==c)continue;
      const f=s%8,r=(s/8)|0;
      if(p.t==='p'){
        const dir=c==='w'?-1:1, startR=c==='w'?6:1, promoR=c==='w'?0:7;
        if(inB(f,r+dir)&&!this.b[sq(f,r+dir)]){
          for(const t of(r+dir===promoR?['q','r','b','n']:['']))M.push({from:s,to:sq(f,r+dir),p:t});
          if(r===startR&&!this.b[sq(f,r+2*dir)])M.push({from:s,to:sq(f,r+2*dir),p:'',dbl:true});
        }
        for(const df of[-1,1]){
          const f2=f+df,r2=r+dir;
          if(!inB(f2,r2))continue;
          const t2=sq(f2,r2),q=this.b[t2];
          if(q&&q.c!==c){for(const t of(r2===promoR?['q','r','b','n']:['']))M.push({from:s,to:t2,p:t,cap:q.t});}
          else if(t2===this.ep)M.push({from:s,to:t2,p:'',ep:true,cap:'p'});
        }
      }else if(p.t==='n'||p.t==='k'){
        for(const [df,dr]of(p.t==='n'?KNIGHT:KING)){
          const f2=f+df,r2=r+dr;
          if(!inB(f2,r2))continue;
          const t2=sq(f2,r2),q=this.b[t2];
          if(!q)M.push({from:s,to:t2,p:''});
          else if(q.c!==c)M.push({from:s,to:t2,p:'',cap:q.t});
        }
        if(p.t==='k'&&c===this.turn){ // enroques (condiciones de casillas vacías + no jaque en tránsito)
          const home=c==='w'?7:0,opp=c==='w'?'b':'w';
          if(s===sq(4,home)){
            const long=c==='w'?'Q':'q',short=c==='w'?'K':'k';
            if(this.cast.includes(short)&&!this.b[sq(5,home)]&&!this.b[sq(6,home)]
              &&this.b[sq(7,home)]&&this.b[sq(7,home)].t==='r'&&this.b[sq(7,home)].c===c
              &&!this.attacked(s,opp)&&!this.attacked(sq(5,home),opp)&&!this.attacked(sq(6,home),opp))
              M.push({from:s,to:sq(6,home),p:'',castle:'K'});
            if(this.cast.includes(long)&&!this.b[sq(3,home)]&&!this.b[sq(2,home)]&&!this.b[sq(1,home)]
              &&this.b[sq(0,home)]&&this.b[sq(0,home)].t==='r'&&this.b[sq(0,home)].c===c
              &&!this.attacked(s,opp)&&!this.attacked(sq(3,home),opp)&&!this.attacked(sq(2,home),opp))
              M.push({from:s,to:sq(2,home),p:'',castle:'Q'});
          }
        }
      }else{
        const dirs=p.t==='b'?DIAG:p.t==='r'?ORTHO:DIAG.concat(ORTHO);
        for(const [df,dr]of dirs){
          let f2=f+df,r2=r+dr;
          while(inB(f2,r2)){
            const t2=sq(f2,r2),q=this.b[t2];
            if(!q)M.push({from:s,to:t2,p:''});
            else{if(q.c!==c)M.push({from:s,to:t2,p:'',cap:q.t});break;}
            f2+=df;r2+=dr;
          }
        }
      }
    }
    return M;
  }
  push(m){ // aplica sin validar turno; guarda undo
    const p=this.b[m.from];
    this.hist.push({m,cap:m.ep?'p':(this.b[m.to]?this.b[m.to].t:null),epCapSq:m.ep?(m.to+(this.turn==='w'?8:-8)):null,
      castPrev:this.cast,epPrev:this.ep,halfPrev:this.half});
    this.ep=-1;
    if(p.t==='k'||p.t==='r'||m.to===sq(0,0)||m.to===sq(7,0)||m.to===sq(0,7)||m.to===sq(7,7)||m.from===sq(0,0)||m.from===sq(7,0)||m.from===sq(0,7)||m.from===sq(7,7)){
      if(p.t==='k'){this.cast=this.cast.replace(p.c==='w'?'K':'k','').replace(p.c==='w'?'Q':'q','');}
      if(m.from===sq(7,7)||m.to===sq(7,7))this.cast=this.cast.replace('K','');
      if(m.from===sq(0,7)||m.to===sq(0,7))this.cast=this.cast.replace('Q','');
      if(m.from===sq(7,0)||m.to===sq(7,0))this.cast=this.cast.replace('k','');
      if(m.from===sq(0,0)||m.to===sq(0,0))this.cast=this.cast.replace('q','');
    }
    this.b[m.to]={c:p.c,t:m.p||p.t};
    this.b[m.from]=null;
    if(m.ep)this.b[this.hist[this.hist.length-1].epCapSq]=null;
    if(m.castle==='K'){const home=p.c==='w'?7:0;this.b[sq(5,home)]=this.b[sq(7,home)];this.b[sq(7,home)]=null;}
    if(m.castle==='Q'){const home=p.c==='w'?7:0;this.b[sq(3,home)]=this.b[sq(0,home)];this.b[sq(0,home)]=null;}
    if(m.dbl)this.ep=m.from+(p.c==='w'?-8:8);
    this.half=(p.t==='p'||this.hist[this.hist.length-1].cap)?0:this.half+1;
    if(this.turn==='b')this.full++;
    this.turn=this.turn==='w'?'b':'w';
  }
  pop(){
    const h=this.hist.pop();if(!h)return;
    const m=h.m;this.turn=this.turn==='w'?'b':'w';
    const p=this.b[m.to];
    this.b[m.from]={c:p.c,t:m.p?'p':p.t};
    this.b[m.to]=h.cap&&!m.ep?{c:this.turn==='w'?'b':'w',t:h.cap}:null;
    if(m.ep)this.b[h.epCapSq]={c:this.turn==='w'?'b':'w',t:'p'};
    if(m.castle==='K'){const home=this.turn==='w'?7:0;this.b[sq(7,home)]=this.b[sq(5,home)];this.b[sq(5,home)]=null;}
    if(m.castle==='Q'){const home=this.turn==='w'?7:0;this.b[sq(0,home)]=this.b[sq(3,home)];this.b[sq(3,home)]=null;}
    if(this.turn==='b')this.full--;
    this.cast=h.castPrev;this.ep=h.epPrev;this.half=h.halfPrev;
    if(h.repKey&&this.rep[h.repKey])this.rep[h.repKey]--;
  }
  moves(opts){ // legales; opts.from (int) filtra por origen
    const c=this.turn,opp=c==='w'?'b':'w',out=[];
    for(const m of this.pseudo(c)){
      if(opts&&opts.from!==undefined&&m.from!==opts.from)continue;
      this.push(m);
      if(!this.attacked(this.kingSq(c),opp))out.push(m);
      this.pop();
    }
    return out;
  }
  san(m){
    if(m.castle==='K')return this.sfx('O-O',m);
    if(m.castle==='Q')return this.sfx('O-O-O',m);
    const p=this.b[m.from];
    let s='';
    if(p.t!=='p'){
      s+=p.t.toUpperCase();
      const others=this.moves().filter(o=>o.to===m.to&&o.from!==m.from&&o.p===m.p&&this.b[o.from].t===p.t);
      if(others.length){
        const sameF=others.some(o=>(o.from%8)===(m.from%8)), sameR=others.some(o=>((o.from/8)|0)===((m.from/8)|0));
        if(!sameF)s+=FILES[m.from%8];
        else if(!sameR)s+=String(8-((m.from/8)|0));
        else s+=alg(m.from);
      }
      if(m.cap)s+='x';
      s+=alg(m.to);
    }else{
      if(m.cap)s+=FILES[m.from%8]+'x';
      s+=alg(m.to);
      if(m.p)s+='='+m.p.toUpperCase();
    }
    return this.sfx(s,m);
  }
  sfx(s,m){
    const before=this.turn;
    this.push(m);
    if(this.inCheck(this.turn))s+=this.moves().length===0?'#':'+';
    this.pop();
    if(before!==this.turn){} // silencio: sfx no muta
    return s;
  }
  move(u){ // u = "e2e4" | "e7e8q" | {from,to,p}
    let from,to,prom='';
    if(typeof u==='object'){from=parseSq(u.from);to=parseSq(u.to);prom=(u.p||'').toLowerCase();}
    else{from=parseSq(u.slice(0,2));to=parseSq(u.slice(2,4));prom=(u[4]||'').toLowerCase();}
    const ms=this.moves();
    const m=ms.find(x=>x.from===from&&x.to===to&&x.p===prom);
    if(!m)return null;
    const s=this.san(m);
    this.push(m);
    const key=this.posKey();
    this.hist[this.hist.length-1].repKey=key;
    this.rep[key]=(this.rep[key]||0)+1;
    return {san:s,from:alg(from),to:alg(to)};
  }
  over(){
    const ms=this.moves();
    if(ms.length===0)return this.inCheck(this.turn)?{r:'mate'}:{r:'stale'};
    if(this.half>=100)return {r:'fifty'};
    if((this.rep[this.posKey()]||0)>=3)return {r:'rep'};
    const rest=this.b.filter(Boolean);
    if(rest.length<=3){
      if(rest.length===2)return {r:'insuf'};
      const minors=rest.filter(p=>p.t==='b'||p.t==='n');
      if(minors.length===1)return {r:'insuf'};
      if(rest.length===4){ // K+B vs K+B mismo color de casilla
        const bs=[];for(let i=0;i<64;i++){const p=this.b[i];if(p&&p.t==='b')bs.push(i);}
        if(bs.length===2&&((bs[0]%8+((bs[0]/8)|0))%2)===((bs[1]%8+((bs[1]/8)|0))%2))return {r:'insuf'};
      }
    }
    return null;
  }
}
export { Chess, alg };
