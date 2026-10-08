import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGeom, positionCheck, sizeEstimate, swayStep, newSway, MOVE_CHECKS, swayProgress, bodyPxFromSpan } from '../src/geometry.js';
import { standingPose, W, H } from './helpers.js';

test('positioning: a centred, fully visible person is accepted', () => {
  const r = positionCheck(standingPose(), W, H);
  assert.equal(r.ok, true, r.msg);
  assert.ok(r.span > 0.5);
});
test('positioning: nobody in frame asks the person to step in', () => {
  assert.match(positionCheck(null, W, H).msg, /Stand in front/);
});
test('positioning: hidden feet asks the person to step back', () => {
  assert.match(positionCheck(standingPose({ hideFeet: true }), W, H).msg, /feet/);
});
test('positioning: directions account for the mirrored view', () => {
  assert.match(positionCheck(standingPose({ cx: 0.8 }), W, H).msg, /your right/);
  assert.match(positionCheck(standingPose({ cx: 0.2 }), W, H).msg, /your left/);
});
test('positioning: a person too far away is asked to come closer', () => {
  assert.match(positionCheck(standingPose({ scale: 0.55, top: 0.25 }), W, H).msg, /closer/);
});
test('positioning: side-on person is asked to face the camera', () => {
  assert.match(positionCheck(standingPose({ turned: true }), W, H).msg, /Face the camera/);
});
test('geometry: body frame points down and across the shoulders', () => {
  const g = computeGeom(standingPose(), W, H);
  assert.ok(g);
  assert.ok(Math.abs(g.u.y) < 0.05, 'shoulder axis is level');
  assert.ok(g.d.y > 0.99, 'torso axis points down');
  assert.ok(g.E > 0 && g.torsoLen > 0 && g.thigh > 0);
  assert.ok(g.hipVis && g.kneeVis);
});
test('geometry: hips are estimated when the person is sitting (upper body only)', () => {
  const lm = standingPose();
  for (const i of [23, 24, 25, 26, 27, 28]) lm[i].visibility = 0.05;
  const g = computeGeom(lm, W, H);
  assert.ok(g);
  assert.equal(g.hipVis, false);
  assert.ok(g.hc.y > g.sc.y, 'estimated hips sit below shoulders');
});
test('geometry: returns null without shoulders', () => {
  const lm = standingPose(); lm[11].visibility = 0; lm[12].visibility = 0;
  assert.equal(computeGeom(lm, W, H), null);
});
test('move test: each pose passes its own check and fails the neutral pose', () => {
  const neutral = computeGeom(standingPose(), W, H);
  const cases = { armsUp: 'up', armsOut: 'out', handsOnHips: 'hips', knee: 'knee' };
  for (const [check, pose] of Object.entries(cases)) {
    const g = computeGeom(standingPose({ pose }), W, H);
    assert.equal(!!MOVE_CHECKS[check](g), true, `${check} should pass for ${pose}`);
    assert.equal(!!MOVE_CHECKS[check](neutral), false, `${check} should fail for neutral`);
  }
});
test('move test: turning to the side is detected against the recognised width', () => {
  const lock = { sw: computeGeom(standingPose(), W, H).sw };
  assert.equal(MOVE_CHECKS.turn(computeGeom(standingPose({ turned: true }), W, H), lock), true);
  assert.equal(MOVE_CHECKS.turn(computeGeom(standingPose(), W, H), lock), false);
});
test('move test: sway needs travel both ways', () => {
  const st = {};
  const at = x => computeGeom(standingPose({ cx: x }), W, H);
  assert.equal(swayProgress(st, at(0.5)), 0);
  assert.equal(swayProgress(st, at(0.6)), 0.5);
  assert.equal(swayProgress(st, at(0.4)), 1);
});
test('size estimate: thresholds map to S/M/L/XL', () => {
  const bodyPx = 1000;
  const sizeFor = cm => sizeEstimate({ sw: cm / 1.12 / 170 * bodyPx, bodyPx, heightCm: 170 }).size;
  assert.equal(sizeFor(36), 'S');
  assert.equal(sizeFor(40), 'M');
  assert.equal(sizeFor(44), 'L');
  assert.equal(sizeFor(48), 'XL');
  assert.equal(sizeEstimate({ sw: 100, bodyPx: 0, heightCm: 170 }), null);
  assert.ok(Math.abs(bodyPxFromSpan(0.89, 720) - 720) < 1e-9);
});
test('size estimate: a typical adult lands in a sensible range', () => {
  const lm = standingPose();
  const g = computeGeom(lm, W, H);
  const span = positionCheck(lm, W, H).span;
  const r = sizeEstimate({ sw: g.sw, bodyPx: bodyPxFromSpan(span, H), heightCm: 172 });
  assert.ok(r.cm > 25 && r.cm < 60, `got ${r.cm}`);
});
test('sway spring: hem swings opposite to movement, stays bounded, settles', () => {
  const s = newSway(), E = 200, dt = 1 / 60;
  let x = 600; swayStep(s, x, dt, E);
  for (let i = 0; i < 12; i++) { x += 8; swayStep(s, x, dt, E); }
  assert.ok(s.off < 0, 'moving right swings the hem left');
  assert.ok(Math.abs(s.off) <= E * 0.5);
  for (let i = 0; i < 240; i++) swayStep(s, x, dt, E);
  assert.ok(Math.abs(s.off) < 1, `settles, got ${s.off}`);
});
