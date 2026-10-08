// Pure logic: no DOM, no camera. Everything here runs in the browser and in Node tests.

export const add = (a, ...b) => b.reduce((p, q) => ({ x: p.x + q.x, y: p.y + q.y }), a);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = a => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a, b) => lerp(a, b, 0.5);
export const dot = (a, b) => a.x * b.x + a.y * b.y;

// MediaPipe pose landmark indices used by the app
export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};

/** Accessors over normalised landmarks. P() returns mirrored canvas pixels (selfie view). */
export function access(lm, W, H) {
  const vis = (i, t = 0.4) => !!lm && (lm[i].visibility ?? 1) > t;
  const P = i => ({ x: (1 - lm[i].x) * W, y: lm[i].y * H, z: lm[i].z ?? 0 });
  return { vis, P };
}

/** Body frame used to fit garments. Returns null when shoulders are not visible. */
export function computeGeom(lm, W, H, swayOff = 0) {
  if (!lm) return null;
  const { vis, P } = access(lm, W, H);
  if (!vis(11, 0.3) || !vis(12, 0.3)) return null;
  const ls = P(11), rs = P(12), sc = mid(ls, rs), sw = dist(ls, rs);
  if (sw < 8) return null;
  const u = norm(sub(ls, rs));
  let n = { x: -u.y, y: u.x }; if (n.y < 0) n = mul(n, -1);
  const hipVis = vis(23, 0.35) && vis(24, 0.35);
  const lh = hipVis ? P(23) : add(ls, mul(n, sw * 1.35));
  const rh = hipVis ? P(24) : add(rs, mul(n, sw * 1.35));
  const hc = mid(lh, rh), torsoLen = dist(sc, hc), d = norm(sub(hc, sc));
  const E = Math.max(sw, torsoLen * 0.58);
  const kneeVis = vis(25) && vis(26);
  const lk = kneeVis ? P(25) : add(lh, mul(d, torsoLen * 0.85));
  const rk = kneeVis ? P(26) : add(rh, mul(d, torsoLen * 0.85));
  const la = vis(27) ? P(27) : add(lk, mul(d, torsoLen * 0.85));
  const ra = vis(28) ? P(28) : add(rk, mul(d, torsoLen * 0.85));
  const leV = vis(13), reV = vis(14), lwV = vis(15), rwV = vis(16);
  const le = leV ? P(13) : add(ls, mul(d, torsoLen * 0.55));
  const re = reV ? P(14) : add(rs, mul(d, torsoLen * 0.55));
  const lw = lwV ? P(15) : add(le, mul(d, torsoLen * 0.5));
  const rw = rwV ? P(16) : add(re, mul(d, torsoLen * 0.5));
  return {
    ls, rs, sc, sw, u, d, lh, rh, hc, hw: dist(lh, rh), uh: norm(sub(lh, rh)), torsoLen, E,
    lk, rk, kc: mid(lk, rk), thigh: Math.max(dist(hc, mid(lk, rk)), torsoLen * 0.6), la, ra,
    le, re, lw, rw, leV, reV, lwV, rwV, hipVis, kneeVis, nose: P(0), noseV: vis(0), swayOff,
  };
}

/** Guidance for getting the whole body into frame. Messages are for the mirrored view. */
export function positionCheck(lm, W, H) {
  if (!lm) return { ok: false, msg: 'Stand in front of the camera, about two metres back.' };
  const { vis, P } = access(lm, W, H);
  const g = computeGeom(lm, W, H);
  if (!vis(0, 0.5) || P(0).y < H * 0.05) return { ok: false, msg: 'Step back or tilt the camera so your head is in the frame.' };
  const feet = vis(27, 0.5) && vis(28, 0.5) && P(27).y < H * 0.97 && P(28).y < H * 0.97;
  if (!feet) return { ok: false, msg: 'Step back until your feet are in the frame.' };
  const cx = (P(23).x + P(24).x) / 2 / W;
  if (cx < 0.36) return { ok: false, msg: 'Move a little to your right.' };
  if (cx > 0.64) return { ok: false, msg: 'Move a little to your left.' };
  const span = (Math.max(P(27).y, P(28).y) - P(0).y) / H;
  if (span < 0.5) return { ok: false, msg: 'Come a step closer.' };
  if (g && g.sw < g.torsoLen * 0.45) return { ok: false, msg: 'Face the camera.' };
  return { ok: true, msg: 'Hold still…', span };
}

/** Rough size from shoulder width relative to body height. Nose-to-ankle is ~89% of height. */
export function sizeEstimate({ sw, bodyPx, heightCm }) {
  if (!sw || !bodyPx || !heightCm) return null;
  const cm = (sw / bodyPx) * heightCm * 1.12;
  const size = cm < 38 ? 'S' : cm < 42 ? 'M' : cm < 46 ? 'L' : 'XL';
  return { cm, size };
}
export const bodyPxFromSpan = (span, H) => (span * H) / 0.89;

/** Damped spring that makes hems lag behind hip movement. Mutates and returns `s`. */
export function swayStep(s, hx, dt, E) {
  if (s.px == null) s.px = hx;
  const vx = (hx - s.px) / Math.max(dt, 1e-3); s.px = hx;
  s.vs += (vx - s.vs) * 0.35;
  const target = -s.vs * 0.085, steps = 3, h = dt / steps;
  for (let i = 0; i < steps; i++) { s.vel += (120 * (target - s.off) - 9 * s.vel) * h; s.off += s.vel * h; }
  const lim = E * 0.5; s.off = Math.max(-lim, Math.min(lim, s.off));
  return s;
}
export const newSway = () => ({ off: 0, vel: 0, px: null, vs: 0 });

/** Move-test pose checks. `lock` holds the shoulder width captured when the person was recognised. */
export const MOVE_CHECKS = {
  armsUp: g => g.lwV && g.rwV && g.lw.y < g.nose.y && g.rw.y < g.nose.y,
  armsOut: g => g.lwV && g.rwV && Math.abs(g.lw.y - g.ls.y) < g.E * 0.6 && Math.abs(g.rw.y - g.rs.y) < g.E * 0.6 && dist(g.lw, g.rw) > g.sw * 2.6,
  // wrists near hips AND elbows flared out, so arms simply hanging at the sides don't count
  handsOnHips: g => g.lwV && g.rwV && g.leV && g.reV
    && dist(g.lw, g.lh) < g.E * 0.55 && dist(g.rw, g.rh) < g.E * 0.55
    && Math.abs(dot(sub(g.le, g.sc), g.u)) > g.sw / 2 + g.E * 0.25
    && Math.abs(dot(sub(g.re, g.sc), g.u)) > g.sw / 2 + g.E * 0.25,
  turn: (g, lock) => g.sw < lock.sw * 0.55,
  knee: g => g.kneeVis && (g.lk.y < g.lh.y + g.thigh * 0.5 || g.rk.y < g.rh.y + g.thigh * 0.5),
};

/** Sway move: passes once hips travel past ±0.35E from where the move started. */
export function swayProgress(state, g) {
  if (!state.cx && state.cx !== 0) Object.assign(state, { cx: g.hc.x, l: false, r: false });
  const dx = g.hc.x - state.cx;
  if (dx < -g.E * 0.35) state.l = true;
  if (dx > g.E * 0.35) state.r = true;
  return (state.l + state.r) / 2;
}
