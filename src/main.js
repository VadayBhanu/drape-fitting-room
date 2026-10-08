import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { add, sub, mul, lerp, mid, access, computeGeom, positionCheck, sizeEstimate,
  bodyPxFromSpan, swayStep, newSway, MOVE_CHECKS, swayProgress } from "./geometry.js";
import { CATALOG, OPTS } from "./catalog.js";
import { cutBackground } from "./garment.js";
import { buildTopMesh, buildBottomMesh, drawGrid, estimateYaw } from "./warp.js";
import { runTryOn, cropBoxForPerson, explainError, DEFAULT_SPACE } from "./realfit.js";
window.__drapeReady = true;

const WASM  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const IS_PHONE = matchMedia("(pointer:coarse)").matches && Math.min(screen.width,screen.height) < 820;
const MODEL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${IS_PHONE?"lite":"full"}/float16/1/pose_landmarker_${IS_PHONE?"lite":"full"}.task`;

const $ = s => document.querySelector(s);
const canvas = $('#view'), viewCtx = canvas.getContext('2d');
let ctx = viewCtx;                          // garment drawing targets this; swapped to the layer canvas
const mk = () => document.createElement('canvas');
const layer = mk(), layerCtx = layer.getContext('2d');     // garments, before compositing
const hug = mk(), hugCtx = hug.getContext('2d');           // body outline used to shape clothes
const hands = mk(), handsCtx = hands.getContext('2d');     // hands redrawn on top of clothes
const shapes = mk(), shapesCtx = shapes.getContext('2d');
const raw = mk(), rawCtx = raw.getContext('2d');           // clean mirrored frame for real fit
const maskBody = mk(), maskDil = mk();
let maskOK = false;
const video = Object.assign(document.createElement('video'), { playsInline:true, muted:true, autoplay:true });
video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
document.body.append(video);

/* ---------- state ---------- */
const S = {
  phase:'idle', lm:null, lastSeen:0, lastT:0, hold:0, lock:null,
  top:CATALOG.tops[2], bottom:CATALOG.bottoms[0], editing:CATALOG.tops[2],
  bag:[], sway:newSway(), hug:true,
  move:{on:false,list:[],i:0,hold:0,passedAt:0,done:false,sw:null},
};
let landmarker, rafHost = window, loopGen = 0, pipWin = null, patternMtx = new DOMMatrix();

/* ---------- fabric patterns ---------- */
const patCache = new Map();
function tile(item){
  const c = item.colors[item.ci], key = item.id + item.ci;
  if (patCache.has(key)) return patCache.get(key);
  const t = document.createElement('canvas'); t.width = t.height = 64;
  const g = t.getContext('2d');
  g.fillStyle = c.base; g.fillRect(0,0,64,64);
  const a = c.accent || '#000';
  if (item.pattern === 'stripe'){ g.fillStyle = a; for (let y=4;y<64;y+=16) g.fillRect(0,y,64,7); }
  if (item.pattern === 'check'){
    g.fillStyle = a; g.globalAlpha=.42;
    for (let x=0;x<64;x+=32) g.fillRect(x,0,16,64);
    for (let y=0;y<64;y+=32) g.fillRect(0,y,64,16);
    g.globalAlpha=1;
  }
  if (item.pattern === 'block'){
    g.fillStyle = a;
    for (const [cx,cy] of [[16,16],[48,48]]){
      for (let k=0;k<6;k++){ const an=k*Math.PI/3; g.beginPath(); g.arc(cx+Math.cos(an)*5.5, cy+Math.sin(an)*5.5, 3.2, 0, 7); g.fill(); }
      g.beginPath(); g.arc(cx,cy,2.2,0,7); g.fill();
    }
    for (const [x,y] of [[48,16],[16,48]]){ g.beginPath(); g.arc(x,y,1.6,0,7); g.fill(); }
  }
  if (item.pattern === 'denim' || item.pattern === 'twill'){
    g.strokeStyle = item.pattern==='denim' ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.12)';
    g.lineWidth = 1.2;
    for (let i=-64;i<64;i+= item.pattern==='denim'?4:6){ g.beginPath(); g.moveTo(i,64); g.lineTo(i+64,0); g.stroke(); }
  }
  for (let i=0;i<260;i++){ g.fillStyle = Math.random()<.5?'rgba(255,255,255,.035)':'rgba(0,0,0,.05)'; g.fillRect(Math.random()*64,Math.random()*64,1.4,1.4); }
  patCache.set(key, t);
  return t;
}
function pattern(item){
  const p = ctx.createPattern(tile(item), 'repeat');
  p.setTransform(patternMtx);
  return p;
}

/* ---------- landmarks ---------- */
const W = () => canvas.width, H = () => canvas.height;
const vis = (i,t=.4) => access(S.lm, W(), H()).vis(i,t);
const P = i => access(S.lm, W(), H()).P(i);
const geom = () => computeGeom(S.lm, W(), H(), S.sway.off);
/* ---------- drawing garments ---------- */
function torsoPath(g, o){
  const {E,u,d,uh} = g, lift = mul(d,-E*.06);
  const sL = add(g.ls, mul(u,E*o.sh), lift), sR = add(g.rs, mul(u,-E*o.sh), lift);
  const nL = add(g.sc, mul(u,E*o.nw), mul(d,-E*.13)), nR = add(g.sc, mul(u,-E*o.nw), mul(d,-E*.13));
  const nC = add(g.sc, mul(d,E*(o.neck-.13)));
  const aL = add(g.ls, mul(u,E*.05), mul(d,E*.45)), aR = add(g.rs, mul(u,-E*.05), mul(d,E*.45));
  const half = Math.max(g.hw/2 + E*.16, E*.46);
  const hL = add(g.hc, mul(uh,half)), hR = add(g.hc, mul(uh,-half));
  const wL = add(lerp(aL,hL,.55), mul(u,-E*o.fit)), wR = add(lerp(aR,hR,.55), mul(u,E*o.fit));
  const hemLen = o.len * g.thigh, sw = mul(uh, g.swayOff*o.swing);
  const eL = add(hL, mul(d,hemLen), mul(uh,E*o.flare), sw), eR = add(hR, mul(d,hemLen), mul(uh,-E*o.flare), sw);
  const eC = add(g.hc, mul(d,hemLen + E*o.curve), mul(sw,1.15));
  const p = new Path2D();
  p.moveTo(nR.x,nR.y); p.quadraticCurveTo(nC.x,nC.y,nL.x,nL.y);
  p.lineTo(sL.x,sL.y);
  const cL = add(sL, mul(d,E*.25)); p.quadraticCurveTo(cL.x,cL.y,aL.x,aL.y);
  p.quadraticCurveTo(wL.x,wL.y,hL.x,hL.y);
  const mL = add(lerp(hL,eL,.5), mul(sw,-.3)); p.quadraticCurveTo(mL.x,mL.y,eL.x,eL.y);
  const hc2 = sub(mul(eC,2), mid(eL,eR)); p.quadraticCurveTo(hc2.x,hc2.y,eR.x,eR.y);
  const mR = add(lerp(hR,eR,.5), mul(sw,-.3)); p.quadraticCurveTo(mR.x,mR.y,hR.x,hR.y);
  p.quadraticCurveTo(wR.x,wR.y,aR.x,aR.y);
  const cR = add(sR, mul(d,E*.25)); p.quadraticCurveTo(cR.x,cR.y,sR.x,sR.y);
  p.closePath();
  return {p,nL,nR,nC,wL,wR,eC};
}

function fillShaded(path, item, g){
  ctx.fillStyle = pattern(item); ctx.fill(path);
  ctx.save(); ctx.clip(path);
  const a = add(g.sc, mul(g.u, g.E*.95)), b = add(g.sc, mul(g.u, -g.E*.95));
  const gr = ctx.createLinearGradient(a.x,a.y,b.x,b.y);
  gr.addColorStop(0,'rgba(0,0,0,.38)'); gr.addColorStop(.22,'rgba(0,0,0,0)');
  gr.addColorStop(.48,'rgba(255,255,255,.07)'); gr.addColorStop(.78,'rgba(0,0,0,0)'); gr.addColorStop(1,'rgba(0,0,0,.38)');
  ctx.fillStyle = gr; ctx.fillRect(0,0,W(),H());
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.stroke(path);
}

function limb(points, widths, item){
  ctx.lineJoin = 'round';
  for (let pass=0; pass<2; pass++){
    for (let i=0;i<points.length-1;i++){
      ctx.beginPath(); ctx.moveTo(points[i].x,points[i].y); ctx.lineTo(points[i+1].x,points[i+1].y);
      ctx.lineCap = i === points.length-2 ? 'butt' : 'round';
      ctx.lineWidth = widths[i] + (pass===0 ? 4 : 0);
      ctx.strokeStyle = pass===0 ? 'rgba(0,0,0,.3)' : pattern(item);
      ctx.stroke();
    }
  }
}

function sleeve(g, side, item, o){
  if (!o.sleeve) return;
  const L = side==='L', sh = L?g.ls:g.rs, el = L?g.le:g.re, wr = L?g.lw:g.rw, ev = L?g.leV:g.reV;
  const out = L ? g.u : mul(g.u,-1);
  const start = add(sh, mul(out,g.E*.05), mul(g.d,g.E*.03));
  const pts = [start];
  if (!ev) pts.push(add(start, mul(g.d, g.E*.4*Math.min(1,o.sleeve))));
  else if (o.sleeve <= 1) pts.push(lerp(sh,el,o.sleeve));
  else { pts.push(el); pts.push(lerp(el,wr,Math.min(1,o.sleeve-1))); }
  limb(pts, o.sleeve<=1 ? [g.E*.42] : [g.E*.37, g.E*.28], item);
}
const armInFront = (g, side) => {
  const s = S.lm[side==='L'?11:12].z, w = S.lm[side==='L'?15:16].z;
  return (side==='L'?g.lwV:g.rwV) && w < s - .25;
};

function pants(g, item){
  if (!g.hipVis) return;
  const {E,d,uh} = g;
  const half = Math.max(g.hw/2 + E*.14, E*.44);
  const wL = add(g.hc, mul(uh,half), mul(d,-E*.12)), wR = add(g.hc, mul(uh,-half), mul(d,-E*.12));
  const crotch = add(g.hc, mul(d,E*.45));
  for (const [hip,knee,ank] of [[g.lh,g.lk,g.la],[g.rh,g.rk,g.ra]]){
    const top = add(hip, mul(d,E*.12));
    limb([top, knee, lerp(knee,ank,.97)], [E*.6, E*.45], item);
  }
  const p = new Path2D();
  p.moveTo(wL.x,wL.y); p.lineTo(wR.x,wR.y);
  const r = add(g.rh, mul(d,E*.42), mul(uh,-E*.28)), l = add(g.lh, mul(d,E*.42), mul(uh,E*.28));
  p.lineTo(r.x,r.y); p.lineTo(crotch.x,crotch.y); p.lineTo(l.x,l.y); p.closePath();
  ctx.fillStyle = pattern(item); ctx.fill(p);
  ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth = E*.05;
  ctx.beginPath(); ctx.moveTo(wL.x,wL.y); ctx.lineTo(wR.x,wR.y); ctx.stroke();
}

function details(g, item, t){
  const c = item.colors[item.ci], {E,d,u} = g;
  const neckLow = add(mul(t.nC,.5), mul(t.nL,.25), mul(t.nR,.25));
  if (item.type === 'tee'){
    ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.lineWidth=E*.035;
    ctx.beginPath(); ctx.moveTo(t.nR.x,t.nR.y); ctx.quadraticCurveTo(t.nC.x,t.nC.y,t.nL.x,t.nL.y); ctx.stroke();
  }
  if (item.type === 'kurta'){
    const end = add(neckLow, mul(d,E*.42));
    ctx.strokeStyle = c.accent; ctx.lineWidth = E*.05;
    ctx.beginPath(); ctx.moveTo(neckLow.x,neckLow.y); ctx.lineTo(end.x,end.y); ctx.stroke();
    ctx.fillStyle = c.base;
    for (let k=1;k<=3;k++){ const b = lerp(neckLow,end,k/4); ctx.beginPath(); ctx.arc(b.x,b.y,E*.016,0,7); ctx.fill(); }
  }
  if (item.type === 'jacket'){
    const V0 = add(g.sc, mul(d, g.torsoLen*.55));
    ctx.fillStyle = '#ece6da';
    ctx.beginPath(); ctx.moveTo(t.nR.x,t.nR.y); ctx.lineTo(t.nL.x,t.nL.y); ctx.lineTo(V0.x,V0.y); ctx.closePath(); ctx.fill();
    for (const s of [1,-1]){
      const n = s>0 ? t.nL : t.nR, tip = add(n, mul(u,E*.13*s), mul(d,E*.32));
      ctx.beginPath(); ctx.moveTo(n.x,n.y); ctx.lineTo(tip.x,tip.y); ctx.lineTo(V0.x,V0.y); ctx.closePath();
      ctx.fillStyle = pattern(item); ctx.fill(); ctx.fillStyle='rgba(0,0,0,.22)'; ctx.fill();
    }
    ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(V0.x,V0.y); ctx.lineTo(t.eC.x,t.eC.y); ctx.stroke();
    ctx.fillStyle='#2a2826';
    for (const k of [.25,.6]){ const b = lerp(V0,t.eC,k); ctx.beginPath(); ctx.arc(b.x,b.y,E*.032,0,7); ctx.fill(); }
  }
  if (item.type === 'dress'){
    ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.lineWidth=E*.03;
    ctx.beginPath(); ctx.moveTo(t.wL.x,t.wL.y); ctx.lineTo(t.wR.x,t.wR.y); ctx.stroke();
  }
}

function drawImageTop(g, item){
  const img = item.img, w = g.E*1.95, h = w * img.height / img.width;
  const top = add(g.sc, mul(g.d, -g.E*.2));
  ctx.save(); ctx.translate(top.x, top.y); ctx.rotate(Math.atan2(g.u.y,g.u.x));
  ctx.drawImage(img, -w/2, 0, w, h); ctx.restore();
}

/* ---------- body outline from the segmentation mask ---------- */
function updateMask(m){
  if (!m){ maskOK = false; return; }
  const w = m.width, h = m.height, f = m.getAsFloat32Array();
  const step = Math.max(1, Math.round(w / 200)), mw = Math.floor(w/step), mh = Math.floor(h/step);
  const a = new Uint8ClampedArray(mw*mh);
  for (let y=0;y<mh;y++) for (let x=0;x<mw;x++) a[y*mw+x] = f[(y*step)*w + x*step] * 255;
  let dl = a;
  for (let pass=0; pass<2; pass++){                       // grow the outline a little for a natural, not skin-tight, fit
    const o = new Uint8ClampedArray(mw*mh);
    for (let y=0;y<mh;y++) for (let x=0;x<mw;x++){
      let v = 0;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
        const yy=y+dy, xx=x+dx; if (yy<0||xx<0||yy>=mh||xx>=mw) continue;
        const q = dl[yy*mw+xx]; if (q>v) v=q;
      }
      o[y*mw+x] = v;
    }
    dl = o;
  }
  for (const [cv, data] of [[maskBody, a],[maskDil, dl]]){
    if (cv.width !== mw || cv.height !== mh){ cv.width = mw; cv.height = mh; }
    const c2 = cv.getContext('2d'), id = c2.createImageData(mw, mh);
    for (let i=0;i<data.length;i++) id.data[i*4+3] = data[i];
    c2.putImageData(id, 0, 0);
  }
  maskOK = true;
}
function drawMirrored(c, src){
  c.save(); c.translate(W(),0); c.scale(-1,1); c.imageSmoothingEnabled = true; c.drawImage(src, 0, 0, W(), H()); c.restore();
}

/* ---------- garments from photos ---------- */
const armSideOf = (g, sleeveSide) => ((sleeveSide==='L') === (g.ls.x <= g.rs.x)) ? 'L' : 'R';
function drawGarmentTop(g, item, yaw){
  if (!item.info){ drawImageTop(g, item); return; }
  const mesh = buildTopMesh(g, item.info, { k:yaw.k, sign:yaw.sign, swayOff:g.swayOff });
  const front = sl => armInFront(g, armSideOf(g, sl.side));
  for (const sl of mesh.sleeves) if (!front(sl)) drawGrid(ctx, item.img, sl.src, sl.dst);
  drawGrid(ctx, item.img, mesh.torso.src, mesh.torso.dst);
  for (const sl of mesh.sleeves) if (front(sl)) drawGrid(ctx, item.img, sl.src, sl.dst);
}
function drawGarmentBottom(g, item, yaw){
  if (!g.hipVis || !item.info) return;
  for (const leg of buildBottomMesh(g, item.info, { k:yaw.k }).legs) drawGrid(ctx, item.img, leg.src, leg.dst);
}

function drawOutfit(g, dt){
  swayStep(S.sway, g.hc.x, dt, g.E); g.swayOff = S.sway.off;
  patternMtx = new DOMMatrix().translateSelf(g.sc.x,g.sc.y).rotateSelf(Math.atan2(g.u.y,g.u.x)*180/Math.PI).scaleSelf(g.E/180);
  const yaw = estimateYaw(g, S.lock && S.lock.sw, S.lm[11].z - S.lm[12].z);
  const top = S.top, bottom = top.type === 'dress' ? null : S.bottom;
  layerCtx.clearRect(0,0,W(),H());
  ctx = layerCtx;
  try {
    if (bottom){ if (bottom.type === 'garment') drawGarmentBottom(g, bottom, yaw); else if (bottom.type === 'pants') pants(g, bottom); }
    if (top.type === 'garment') drawGarmentTop(g, top, yaw);
    else if (top.type !== 'remote'){
      const o = OPTS[top.type];
      const front = {L:armInFront(g,'L'), R:armInFront(g,'R')};
      for (const s of ['L','R']) if (!front[s]) sleeve(g, s, top, o);
      const t = torsoPath(g, o);
      fillShaded(t.p, top, g);
      details(g, top, t);
      for (const s of ['L','R']) if (front[s]) sleeve(g, s, top, o);
    }
  } finally { ctx = viewCtx; }

  // keep clothes on the body outline above the hips (loose hems below the hips stay free)
  if (maskOK && S.hug){
    hugCtx.clearRect(0,0,W(),H());
    drawMirrored(hugCtx, maskDil);
    const far = Math.max(W(), H()) * 2;
    const a = add(g.hc, mul(g.uh, far)), b = add(g.hc, mul(g.uh, -far));
    hugCtx.fillStyle = '#000'; hugCtx.beginPath();
    hugCtx.moveTo(a.x,a.y); hugCtx.lineTo(b.x,b.y); hugCtx.lineTo(b.x+g.d.x*far, b.y+g.d.y*far); hugCtx.lineTo(a.x+g.d.x*far, a.y+g.d.y*far);
    hugCtx.closePath(); hugCtx.fill();
    layerCtx.globalCompositeOperation = 'destination-in'; layerCtx.drawImage(hug, 0, 0);
  }
  // turning: the far side of the body falls into shadow
  layerCtx.globalCompositeOperation = 'source-atop';
  const p0 = add(g.sc, mul(g.u, g.E)), p1 = add(g.sc, mul(g.u, -g.E));
  const gr = layerCtx.createLinearGradient(p0.x,p0.y,p1.x,p1.y), turn = (1 - yaw.k) * 0.5;
  const left = yaw.sign > 0 ? turn : 0, right = yaw.sign < 0 ? turn : 0;
  gr.addColorStop(0, `rgba(0,0,0,${0.2 + left})`); gr.addColorStop(.3,'rgba(0,0,0,0)');
  gr.addColorStop(.7,'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.2 + right})`);
  layerCtx.fillStyle = gr; layerCtx.fillRect(0,0,W(),H());
  layerCtx.globalCompositeOperation = 'source-over';
  viewCtx.drawImage(layer, 0, 0);

  // hands (and forearms reaching forward) stay in front of the clothes
  if (maskOK){
    shapesCtx.clearRect(0,0,W(),H()); shapesCtx.fillStyle = shapesCtx.strokeStyle = '#000'; shapesCtx.lineCap = 'round';
    let any = false;
    for (const sd of ['L','R']){
      const wv = sd==='L' ? g.lwV : g.rwV; if (!wv) continue;
      const el = sd==='L' ? g.le : g.re, wr = sd==='L' ? g.lw : g.rw;
      const hand = add(wr, mul(sub(wr, el), 0.35));
      shapesCtx.beginPath(); shapesCtx.arc(hand.x, hand.y, g.E*0.27, 0, 7); shapesCtx.fill(); any = true;
      if (armInFront(g, sd)){ shapesCtx.lineWidth = g.E*0.34; shapesCtx.beginPath(); shapesCtx.moveTo(el.x,el.y); shapesCtx.lineTo(hand.x,hand.y); shapesCtx.stroke(); }
    }
    if (any){
      handsCtx.globalCompositeOperation = 'source-over'; handsCtx.clearRect(0,0,W(),H());
      drawMirrored(handsCtx, video);
      handsCtx.globalCompositeOperation = 'destination-in'; drawMirrored(handsCtx, maskBody);
      handsCtx.drawImage(shapes, 0, 0);
      handsCtx.globalCompositeOperation = 'source-over';
      viewCtx.drawImage(hands, 0, 0);
    }
  }
}

/* ---------- positioning ---------- */
function drawTape(ok, progress){
  const w = W(), h = H();
  for (const x of [w*.31, w*.69]){
    ctx.fillStyle = ok ? 'rgba(233,207,147,.92)' : 'rgba(217,226,229,.35)';
    ctx.fillRect(x-7, h*.03, 14, h*.94);
    ctx.fillStyle = 'rgba(36,16,36,.75)';
    for (let i=0;i<=60;i++){ const y = h*.03 + i*(h*.94/60); ctx.fillRect(i%5===0 ? x-7 : x-7, y, i%5===0?10:5, 1.5); }
  }
  if (progress > 0 && S.lm){
    const n = P(0), r = Math.max(22, w*.025);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.beginPath(); ctx.arc(n.x, n.y - r*3, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#e9cf93';
    ctx.beginPath(); ctx.arc(n.x, n.y - r*3, r, -Math.PI/2, -Math.PI/2 + progress*Math.PI*2); ctx.stroke();
  }
}

const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
function drawSkeleton(color, alpha){
  if (!S.lm) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
  for (const [a,b] of BONES){ if (vis(a)&&vis(b)){ const p=P(a), q=P(b); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke(); } }
  for (const i of [0,11,12,13,14,15,16,23,24,25,26,27,28]) if (vis(i)){ const p=P(i); ctx.beginPath(); ctx.arc(p.x,p.y,5,0,7); ctx.fill(); }
  ctx.restore();
}

function lockOn(full, span){
  const g = geom(); if (!g) return;
  S.lock = { full, sw:g.sw, bodyPx: full ? bodyPxFromSpan(span, H()) : null, t:performance.now() };
  S.phase = 'tryon';
  $('#skipBtn').hidden = true;
  setStep(2);
  setPrompt('Got you. Pick something from the rail.');
  setTimeout(()=>{ if (S.phase==='tryon' && !S.move.on) setPrompt(''); }, 2600);
  for (const b of document.querySelectorAll('.tool[data-act="prev"],.tool[data-act="next"],.tool[data-act="photo"]')) b.disabled = false;
  $('#moveBtn').disabled = false; $('#addBag').disabled = false;
  updateRealFitButton();
  updateSize();
}

/* ---------- move test ---------- */
const fig = (arms, legs, extra='') => `<svg viewBox="0 0 40 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="20" cy="7" r="4"/><path d="M20 11v17"/><path d="${arms}"/><path d="${legs}"/>${extra}</svg>`;
const LEGS = 'M20 28l-6 16M20 28l6 16';
const MOVES = [
  {label:'Raise both arms', hint:'See how the hem lifts.', hold:.6, icon:fig('M20 15l-8-12M20 15l8-12',LEGS),
    check:MOVE_CHECKS.armsUp},
  {label:'Arms out to the sides', hint:'Check the sleeves and shoulders.', hold:.6, icon:fig('M4 15h32',LEGS),
    check:MOVE_CHECKS.armsOut},
  {label:'Hands on your hips', hint:'Watch the waist and fit.', hold:.6, icon:fig('M20 15l-8 7 5 6M20 15l8 7-5 6',LEGS),
    check:MOVE_CHECKS.handsOnHips},
  {label:'Turn to your side', hint:'See the fit in profile.', hold:.5, icon:fig('M20 15l2 12',LEGS,'<path d="M6 30c-3-6 0-12 6-14" stroke-dasharray="2 3"/>'),
    check:g=> MOVE_CHECKS.turn(g, S.lock)},
  {label:'Sway left, then right', hint:'Watch the fabric swing.', sway:true, icon:fig('M20 15l-7 9M20 15l7 9',LEGS,'<path d="M3 40h6M31 40h6"/>')},
  {label:'Lift one knee', hint:'Check how it moves with your stride.', hold:.4, needsLegs:true, icon:fig('M20 15l-7 9M20 15l7 9','M20 28l-6 16M20 28l8 4-3 8'),
    check:MOVE_CHECKS.knee},
];

function startMoves(){
  const m = S.move;
  Object.assign(m, {on:true, list:MOVES.filter(x=>!x.needsLegs || S.lock.full), i:0, hold:0, passedAt:0, done:false, sw:null});
  $('#moveCard').hidden = false; $('#moveActions').hidden = true;
  setStep(3); setPrompt(''); renderMove();
}
function renderMove(){
  const m = S.move, cur = m.list[m.i];
  $('#moveFig').innerHTML = cur.icon;
  $('#moveCount').textContent = `Move ${m.i+1} of ${m.list.length}`;
  $('#moveLabel').textContent = cur.label;
  $('#moveHint').textContent = cur.hint;
  $('#moveBar').style.width = '0%';
}
function updateMoves(g, dt, now){
  const m = S.move; if (!m.on || m.done) return;
  if (m.passedAt){
    if (now - m.passedAt > 700){
      m.passedAt = 0; m.i++; m.hold = 0; m.sw = null;
      if (m.i >= m.list.length){ finishMoves(); return; }
      renderMove();
    }
    return;
  }
  const cur = m.list[m.i]; let prog = 0;
  if (!g){ $('#moveBar').style.width = '0%'; return; }
  if (cur.sway){
    if (!m.sw) m.sw = {};
    prog = swayProgress(m.sw, g);
  } else {
    m.hold = cur.check(g) ? m.hold + dt : Math.max(0, m.hold - dt*2);
    prog = Math.min(1, m.hold / cur.hold);
  }
  $('#moveBar').style.width = (prog*100).toFixed(0) + '%';
  if (prog >= 1){ m.passedAt = now; $('#moveLabel').textContent = 'Nice.'; $('#moveHint').textContent = ''; }
}
function finishMoves(){
  const m = S.move; m.done = true;
  $('#moveFig').innerHTML = fig('M20 15l-8-12M20 15l8-12', LEGS);
  $('#moveCount').textContent = 'Move test complete';
  $('#moveLabel').textContent = `${S.top.name} passed`;
  $('#moveHint').textContent = 'You have seen it move. Keep it or try another piece.';
  $('#moveBar').style.width = '100%';
  $('#moveActions').hidden = false;
}

/* ---------- beat (Web Audio, scheduled from the render loop) ---------- */
const beat = {on:false, ac:null, next:0, step:0, kicks:[]};
function toggleBeat(btn){
  beat.ac ??= new (window.AudioContext || window.webkitAudioContext)();
  beat.on = !beat.on; btn.setAttribute('aria-pressed', beat.on);
  if (beat.on){ beat.ac.resume(); beat.next = beat.ac.currentTime + .05; beat.step = 0; }
}
function noise(ac, dur){
  const b = ac.createBuffer(1, ac.sampleRate*dur, ac.sampleRate), d = b.getChannelData(0);
  for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  const s = ac.createBufferSource(); s.buffer = b; return s;
}
function scheduleBeat(){
  if (!beat.on) return;
  const ac = beat.ac, stepDur = 60/104/2;
  while (beat.next < ac.currentTime + .15){
    const t = beat.next, s = beat.step % 16;
    if (s % 4 === 0){
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(45,t+.14);
      g.gain.setValueAtTime(.8,t); g.gain.exponentialRampToValueAtTime(.001,t+.25);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t+.26); beat.kicks.push(t);
    }
    if (s % 2 === 1){
      const n = noise(ac,.05), f = ac.createBiquadFilter(), g = ac.createGain();
      f.type='highpass'; f.frequency.value=7000; g.gain.setValueAtTime(.18,t); g.gain.exponentialRampToValueAtTime(.001,t+.05);
      n.connect(f).connect(g).connect(ac.destination); n.start(t);
    }
    if (s === 4 || s === 12){
      const n = noise(ac,.18), f = ac.createBiquadFilter(), g = ac.createGain();
      f.type='bandpass'; f.frequency.value=1600; g.gain.setValueAtTime(.35,t); g.gain.exponentialRampToValueAtTime(.001,t+.18);
      n.connect(f).connect(g).connect(ac.destination); n.start(t);
    }
    beat.next += stepDur; beat.step++;
  }
  const now = ac.currentTime; beat.kicks = beat.kicks.filter(k => k > now - .4);
  const last = beat.kicks.filter(k => k <= now).pop();
  const p = last != null ? Math.max(0, 1 - (now-last)/.3) : 0;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $('#stage').style.setProperty('--pulse', p.toFixed(2));
}

/* ---------- main loop ---------- */
function frame(now){
  const dt = Math.min(.05, (now - (S.lastT||now)) / 1000); S.lastT = now;
  const w = W(), h = H();
  ctx.save(); ctx.translate(w,0); ctx.scale(-1,1); ctx.drawImage(video,0,0,w,h); ctx.restore();

  if (landmarker && video.readyState >= 2){
    const res = landmarker.detectForVideo(video, now);
    const lm = res.landmarks && res.landmarks[0];
    updateMask(res.segmentationMasks && res.segmentationMasks[0]);
    for (const m of res.segmentationMasks || []) m.close();
    if (lm){
      if (!S.lm) S.lm = lm.map(p => ({...p}));
      else for (let i=0;i<lm.length;i++){ const s=S.lm[i], n=lm[i]; s.x+=(n.x-s.x)*.55; s.y+=(n.y-s.y)*.55; s.z+=(n.z-s.z)*.55; s.visibility=n.visibility; }
      S.lastSeen = now;
    } else if (now - S.lastSeen > 400) S.lm = null;
  }

  if (S.phase === 'position'){
    const c = positionCheck(S.lm, W(), H());
    S.hold = c.ok ? S.hold + dt : Math.max(0, S.hold - dt*2);
    drawSkeleton('#d9e2e5', .7);
    drawTape(c.ok, Math.min(1, S.hold/1.3));
    setPrompt(c.msg);
    if (S.hold >= 1.3) lockOn(true, c.span);
  } else if (S.phase === 'tryon'){
    const g = geom();
    if (g) drawOutfit(g, dt);
    const since = now - S.lock.t;
    if (since < 1000) drawSkeleton('#e9cf93', 1 - since/1000);
    if (!S.lm && now - S.lastSeen > 2000) setPrompt('Step back into the frame.', 'warn');
    else if ($('#prompt').dataset.tone === 'warn') setPrompt('');
    updateMoves(g, dt, now);
    if (RF.capturing) updateRealFitCapture(g, dt);
  }
  scheduleBeat();
}
function loop(gen){
  if (gen !== loopGen) return;
  frame(performance.now());
  rafHost.requestAnimationFrame(() => loop(gen));
}
function restartLoop(){ loopGen++; const gen = loopGen; rafHost.requestAnimationFrame(() => loop(gen)); }

/* ---------- start ---------- */
async function start(){
  const btn = $('#startBtn'); btn.disabled = true;
  if (!navigator.mediaDevices?.getUserMedia){ setPrompt('This browser cannot open the camera here. Open the file in Chrome, or serve it from localhost.', 'warn'); btn.disabled=false; return; }
  setPrompt('Opening camera…');
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: matchMedia('(orientation: portrait)').matches ? { width:{ideal:720}, height:{ideal:1280}, facingMode:'user' } : { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' }, audio:false });
    await video.play();
  } catch {
    setPrompt('Camera access was blocked. Allow the camera in the address bar, then press Open camera again.', 'warn');
    btn.disabled = false; return;
  }
  canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720;
  for (const c of [layer, hug, hands, shapes, raw]) { c.width = canvas.width; c.height = canvas.height; }
  $('#glass').style.setProperty('--ar', `${canvas.width}/${canvas.height}`);
  setPrompt('Loading body tracking…');
  try {
    const fs = await FilesetResolver.forVisionTasks(WASM);
    const make = delegate => PoseLandmarker.createFromOptions(fs, { baseOptions:{ modelAssetPath:MODEL, delegate }, runningMode:'VIDEO', numPoses:1, outputSegmentationMasks:true });
    landmarker = await make('GPU').catch(() => make('CPU'));
  } catch {
    setPrompt('Body tracking could not load. Check your connection and reload.', 'warn'); return;
  }
  $('#startOverlay').hidden = true; $('#skipBtn').hidden = false;
  S.phase = 'position'; setStep(1); restartLoop();
}

/* ---------- floating window ---------- */
async function float(){
  if (!('documentPictureInPicture' in window)){
    toastFloat('Floating needs Chrome or Edge on desktop. You can also drag this tab into its own window and set it beside your shop.');
    return;
  }
  if (pipWin){ pipWin.close(); return; }
  const stage = $('#stage');
  pipWin = await documentPictureInPicture.requestWindow({ width: 400, height: 640 });
  for (const ss of document.styleSheets){
    try { const st = pipWin.document.createElement('style'); st.textContent = [...ss.cssRules].map(r=>r.cssText).join('\n'); pipWin.document.head.append(st); }
    catch { const l = pipWin.document.createElement('link'); l.rel='stylesheet'; l.href=ss.href; pipWin.document.head.append(l); }
  }
  pipWin.document.body.classList.add('pip');
  pipWin.document.body.append(stage);
  rafHost = pipWin; restartLoop();
  toastFloat('The mirror is floating. Browse your shop and it stays on top.');
  pipWin.addEventListener('pagehide', () => {
    $('#stageHome').prepend(stage); pipWin = null; rafHost = window; restartLoop(); toastFloat('');
  });
}
function toastFloat(t){ $('#floatNote').textContent = t; }

/* ---------- pick any clothes: gallery, paste, link, share ---------- */
const IMG_URL = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)|\/images\/I\/|m\.media-amazon\.com/i;
async function addGarment(blob, { name = 'Your pick', url = null } = {}){
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch { setPrompt('That file is not an image this browser can open. Try a JPG or PNG.', 'warn'); return; }
  const { canvas: cut, info } = cutBackground(bmp);
  const item = { id:'g'+Date.now(), name, price:'', type:'garment', img:cut, info, blob, url,
    thumb: cut.toDataURL('image/png'), ci:0, colors:[{ name:'As photographed', base:'#777777' }] };
  if (info && info.kind === 'bottom'){ CATALOG.bottoms.push(item); S.bottom = item; }
  else { CATALOG.tops.push(item); S.top = item; }
  S.editing = item; renderCatalog(); updateRealFitButton();
  if (!info) setPrompt('Could not find the clothing outline in that photo. Real fit can still use it.', 'warn');
  else setPrompt(info.kind === 'bottom' ? 'Added to bottoms.' : 'Added. Step back to see it on you.');
}
function addRemote(url){
  const item = { id:'r'+Date.now(), name:'Linked photo', price:'', type:'remote', url, thumb:url, ci:0, colors:[{ name:'As linked', base:'#777777' }] };
  CATALOG.tops.push(item); S.top = item; S.editing = item; renderCatalog(); updateRealFitButton();
  setPrompt('This site blocks live preview of its images. Real fit can still use the link.', 'warn');
}
async function addFromLink(raw){
  const url = (raw.match(/https?:\/\/\S+/) || [])[0];
  if (!url){ setPrompt('Paste a link that starts with http.', 'warn'); return; }
  try {
    const r = await fetch(url, { mode:'cors' });
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.startsWith('image/')) { await addGarment(await r.blob(), { url, name:'Linked photo' }); return; }
    if (r.ok) { setPrompt('That is a web page, not a photo. On the product, long-press or right-click the clothing image, choose Copy image, then Paste here.', 'warn'); return; }
  } catch { /* blocked by the site: fall through */ }
  if (IMG_URL.test(url)) addRemote(url);
  else setPrompt('That is a product page. Long-press or right-click the clothing photo, choose Copy image (or Copy image address), then paste it here.', 'warn');
}
$('#upload').addEventListener('change', e => { const f = e.target.files[0]; if (f) addGarment(f, { name: f.name.replace(/\.\w+$/, '').slice(0, 28) || 'Your pick' }); e.target.value = ''; });
$('#pasteBtn').onclick = async () => {
  try {
    for (const it of await navigator.clipboard.read()){
      const t = it.types.find(x => x.startsWith('image/'));
      if (t){ await addGarment(await it.getType(t), { name:'Pasted photo' }); return; }
      if (it.types.includes('text/plain')){ await addFromLink(await (await it.getType('text/plain')).text()); return; }
    }
    setPrompt('Nothing to paste. Copy a clothing photo first.', 'warn');
  } catch { setPrompt('Press Ctrl+V (or long-press and Paste) to paste the copied photo.', 'warn'); }
};
document.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input')) return;
  const items = [...(e.clipboardData?.items || [])];
  const img = items.find(i => i.type.startsWith('image/'));
  if (img){ e.preventDefault(); addGarment(img.getAsFile(), { name:'Pasted photo' }); return; }
  const txt = e.clipboardData?.getData('text');
  if (txt && /https?:\/\//.test(txt)){ e.preventDefault(); addFromLink(txt); }
});
$('#linkBtn').onclick = () => { const v = $('#linkInput').value.trim(); if (v) addFromLink(v); };
$('#linkInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#linkBtn').click(); });
$('#hugToggle').addEventListener('change', e => { S.hug = e.target.checked; });

// shared from another app (installed app on Android)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
(async () => {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('drape-share');
  const img = await cache.match('shared-image'), txt = await cache.match('shared-text');
  if (img) await addGarment(await img.blob(), { name:'Shared photo' });
  else if (txt) await addFromLink(await txt.text());
  await cache.delete('shared-image'); await cache.delete('shared-text');
})();

/* ---------- real fit: photo-real try-on from three angles ---------- */
const RF = { capturing:false, i:0, hold:0, shots:[], results:[], busy:false };
const RF_STEPS = [
  { label:'Front',     prompt:'Face the camera and hold still.',        ok:y => y.k > 0.85 },
  { label:'Half turn', prompt:'Turn halfway to your side and hold.',    ok:y => y.k < 0.8 && y.k > 0.5 },
  { label:'Side',      prompt:'Turn fully to your side and hold.',      ok:y => y.k < 0.5 },
];
const tokenKey = 'drape.hfToken', spaceKey = 'drape.space';
try { $('#hfToken').value = localStorage.getItem(tokenKey) || ''; $('#rfSpace').value = localStorage.getItem(spaceKey) || DEFAULT_SPACE; }
catch { $('#rfSpace').value = DEFAULT_SPACE; }
$('#hfToken').addEventListener('change', e => { try { localStorage.setItem(tokenKey, e.target.value.trim()); } catch { /* storage off */ } });
$('#rfSpace').addEventListener('change', e => { try { localStorage.setItem(spaceKey, e.target.value.trim()); } catch { /* storage off */ } });

function realFitGarment(){ return ['garment','remote'].includes(S.top.type) ? S.top : null; }
function updateRealFitButton(){
  const ok = !!S.lock && !!realFitGarment() && !RF.busy && !RF.capturing;
  $('#rfBtn').disabled = !ok;
  $('#rfHint').textContent = !realFitGarment() ? 'Pick a clothing photo first (gallery, paste or link).'
    : !S.lock ? 'Stand in the frame first.' : 'Takes three photos as you turn, then makes each view.';
}
function startRealFit(){
  Object.assign(RF, { capturing:true, i:0, hold:0, shots:[] });
  S.move.on = false; $('#moveCard').hidden = true;
  updateRealFitButton(); setPrompt(RF_STEPS[0].prompt);
}
function updateRealFitCapture(g, dt){
  if (!g) return;
  const step = RF_STEPS[RF.i], yaw = estimateYaw(g, S.lock.sw, S.lm[11].z - S.lm[12].z);
  RF.hold = step.ok(yaw) ? RF.hold + dt : Math.max(0, RF.hold - dt);
  setPrompt(RF.hold > 0 ? `${step.label}: hold still…` : step.prompt);
  if (RF.hold < 0.7) return;
  RF.shots.push(captureShot(g)); RF.i++; RF.hold = 0;
  if (RF.i >= RF_STEPS.length){ RF.capturing = false; setPrompt('Photos taken. Making your real fit…'); processRealFit(); }
}
function captureShot(){
  rawCtx.clearRect(0,0,W(),H()); drawMirrored(rawCtx, video);
  let x0 = W(), y0 = H(), x1 = 0, y1 = 0;
  for (let i = 0; i < 33; i++) if (vis(i, .3)){ const p = P(i); x0 = Math.min(x0,p.x); y0 = Math.min(y0,p.y); x1 = Math.max(x1,p.x); y1 = Math.max(y1,p.y); }
  const g = geom(), head = g ? g.E * 0.6 : 60;
  const box = cropBoxForPerson({ x0, y0: Math.max(0, y0 - head), x1, y1 }, W(), H());
  const out = mk(); out.width = 768; out.height = 1024;
  const oc = out.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0,0,768,1024);
  oc.drawImage(raw, box.x, box.y, box.w, box.h, 0, 0, 768, 1024);
  return new Promise(res => out.toBlob(res, 'image/jpeg', 0.9));
}
async function processRealFit(){
  const item = realFitGarment(); if (!item) return;
  RF.busy = true; RF.results = []; updateRealFitButton();
  $('#rfResults').hidden = false; renderRealFit();
  const token = $('#hfToken').value.trim(), space = $('#rfSpace').value.trim() || DEFAULT_SPACE;
  try {
    for (let i = 0; i < RF.shots.length; i++){
      const person = await RF.shots[i];
      const url = await runTryOn({ person, garment: item.blob || item.url, description: $('#rfDesc').value.trim(), space, token,
        onStatus: st => { $('#rfStatus').textContent = `${RF_STEPS[i].label} view (${i+1} of ${RF.shots.length}): ${st}`; } });
      RF.results.push({ label: RF_STEPS[i].label, url }); renderRealFit(RF.results.length - 1);
    }
    $('#rfStatus').textContent = 'Done. Drag the slider to turn around.';
    setPrompt('Your real fit is ready.');
  } catch (e){
    $('#rfStatus').textContent = explainError(e); setPrompt('Real fit stopped. See the panel for why.', 'warn');
  } finally { RF.busy = false; updateRealFitButton(); }
}
function renderRealFit(i = RF.results.length - 1){
  const sl = $('#rfSlider'); sl.max = Math.max(0, RF.results.length - 1); sl.disabled = RF.results.length < 2;
  if (i < 0){ $('#rfImg').hidden = true; $('#rfLabel').textContent = ''; return; }
  sl.value = i; $('#rfImg').hidden = false; $('#rfImg').src = RF.results[i].url;
  $('#rfLabel').textContent = RF.results[i].label;
}
$('#rfSlider').addEventListener('input', e => renderRealFit(+e.target.value));
$('#rfBtn').onclick = startRealFit;

/* ---------- UI ---------- */
function setPrompt(t, tone){ const p = $('#prompt'); if (p.textContent !== t) p.textContent = t; p.dataset.tone = tone || ''; }
function setStep(n){
  for (const li of document.querySelectorAll('#steps li')){
    const s = +li.dataset.step; li.className = s < n ? 'done' : s === n ? 'now' : '';
  }
}
function swatchBg(item){
  if (item.type==='garment' || item.type==='remote') return `center/contain no-repeat url("${item.thumb}"), #f4f0ea`;
  const c = item.colors[item.ci];
  return c.accent ? `linear-gradient(135deg, ${c.base} 50%, ${c.accent} 50%)` : c.base;
}
function renderCatalog(){
  for (const [key, el] of [['tops', $('#railTops')], ['bottoms', $('#railBottoms')]]){
    el.innerHTML = '';
    for (const item of CATALOG[key]){
      const b = document.createElement('button');
      b.className = 'item' + (key==='bottoms' && S.top.type==='dress' ? ' off' : '');
      b.setAttribute('aria-pressed', key==='tops' ? S.top===item : S.bottom===item);
      b.innerHTML = `<span class="sw" style="background:${swatchBg(item)}"></span><span class="nm">${item.name}</span><span class="pr">${item.price}</span>`;
      b.onclick = () => { if (key==='tops') S.top = item; else S.bottom = item; S.editing = item; renderCatalog(); };
      el.append(b);
    }
  }
  const it = S.editing, box = $('#colours'); box.innerHTML = '';
  if (it && !['garment','remote'].includes(it.type) && it.colors.length > 1){
    box.innerHTML = `<span>${it.name} colours</span>`;
    it.colors.forEach((c,i) => {
      const d = document.createElement('button');
      d.className = 'dot'; d.title = c.name; d.setAttribute('aria-label', c.name);
      d.style.background = c.accent ? `linear-gradient(135deg, ${c.base} 50%, ${c.accent} 50%)` : c.base;
      d.setAttribute('aria-pressed', it.ci===i);
      d.onclick = () => { it.ci = i; renderCatalog(); };
      box.append(d);
    });
  }
}
function cycleTop(step){
  const t = CATALOG.tops, i = (t.indexOf(S.top) + step + t.length) % t.length;
  S.top = t[i]; S.editing = t[i]; renderCatalog();
  if (S.move.on && S.move.done) startMoves();
}
function addToBag(){
  const pieces = [S.top]; if (S.top.type!=='dress' && S.bottom) pieces.push(S.bottom);
  for (const p of pieces) S.bag.push(`${p.name}${['garment','remote'].includes(p.type) ? '' : ', ' + p.colors[p.ci].name}`);
  $('#bagCount').textContent = `(${S.bag.length})`;
  $('#bagList').innerHTML = S.bag.map(x => `<li><span>${x}</span></li>`).join('');
  setPrompt('Added to your bag.'); setTimeout(()=>{ if ($('#prompt').textContent==='Added to your bag.') setPrompt(''); }, 1800);
}
function updateSize(){
  const h = +$('#height').value, out = $('#sizeOut');
  if (!S.lock){ out.textContent = 'Enter your height, then stand in the frame.'; return; }
  if (!S.lock.full){ out.textContent = 'Stand back with your whole body in view to get a size estimate.'; return; }
  if (!h){ out.textContent = 'Enter your height to get a size estimate.'; return; }
  const { cm, size } = sizeEstimate({ sw:S.lock.sw, bodyPx:S.lock.bodyPx, heightCm:h });
  out.innerHTML = `Shoulders about <b>${Math.round(cm)} cm</b>. Try size <b>${size}</b>.<br><span class="note">A camera estimate. Check the brand's size chart before you buy.</span>`;
}
function photo(){
  canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'drape-fit.png'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000); });
}

$('#startBtn').onclick = start;
$('#skipBtn').onclick = () => { if (geom()) lockOn(false); else setPrompt('Show your shoulders to the camera first.'); };
$('#moveBtn').onclick = startMoves;
$('#addBag').onclick = addToBag;
$('#height').addEventListener('input', updateSize);
$('#stage').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act==='prev') cycleTop(-1);
  if (act==='next') cycleTop(1);
  if (act==='beat') toggleBeat(e.target.closest('button'));
  if (act==='photo') photo();
  if (act==='float') float();
  if (act==='bagFromMove') addToBag();
  if (act==='moveAgain') startMoves();
});
if (!('documentPictureInPicture' in window)) document.querySelector('.tool[data-act="float"]').hidden = true;
renderCatalog();
updateRealFitButton();
