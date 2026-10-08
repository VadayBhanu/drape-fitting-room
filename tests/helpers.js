// Builds synthetic MediaPipe landmarks (normalised 0..1, raw camera space, not mirrored).
export function standingPose({ cx = 0.5, scale = 1, top = 0.12, pose = 'neutral', hideFeet = false, turned = false } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, z: 0, visibility: 0.99 }));
  const s = (dx, dy) => ({ x: cx + dx * scale, y: top + dy * scale, z: 0, visibility: 0.99 });
  const half = turned ? 0.015 : 0.06;
  lm[0] = s(0, 0);                                         // nose
  lm[11] = s(half, 0.13); lm[12] = s(-half, 0.13);         // shoulders
  lm[23] = s(half * 0.75, 0.38); lm[24] = s(-half * 0.75, 0.38); // hips
  lm[25] = s(0.045, 0.56); lm[26] = s(-0.045, 0.56);       // knees
  lm[27] = s(0.045, 0.74); lm[28] = s(-0.045, 0.74);       // ankles
  const arms = {
    neutral: [[0.08, 0.25], [0.085, 0.36], [-0.08, 0.25], [-0.085, 0.36]],
    up:      [[0.08, 0.02], [0.08, -0.08], [-0.08, 0.02], [-0.08, -0.08]],
    out:     [[0.15, 0.13], [0.24, 0.13], [-0.15, 0.13], [-0.24, 0.13]],
    hips:    [[0.12, 0.27], [0.055, 0.38], [-0.12, 0.27], [-0.055, 0.38]],
  }[pose === 'knee' ? 'neutral' : pose];
  lm[13] = s(...arms[0]); lm[15] = s(...arms[1]); lm[14] = s(...arms[2]); lm[16] = s(...arms[3]);
  if (pose === 'knee') lm[25] = s(0.05, 0.42);
  if (hideFeet) { lm[27].visibility = 0.1; lm[28].visibility = 0.1; }
  return lm;
}
export const W = 1280, H = 720;
