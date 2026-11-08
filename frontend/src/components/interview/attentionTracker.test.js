// node --test (no browser needed): the attention summary from per-frame face results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAttentionTracker, directionOf, yawRatio } from "./attentionTracker.js";

// A 68-point face: jaw edges at x=100 and x=200, nose tip at 100 + 100 * ratio,
// eyes open (eye aspect ratio ~0.3) or closed.
function face({ ratio = 0.5, eyesOpen = true, score = 0.9, size = 100, expressions = { neutral: 0.9, happy: 0.1 } } = {}) {
  const points = Array.from({ length: 68 }, () => ({ x: 150, y: 150 }));
  points[0] = { x: 100, y: 150 };
  points[16] = { x: 200, y: 150 };
  points[30] = { x: 100 + 100 * ratio, y: 160 };
  const h = eyesOpen ? 3 : 0.5; // half the eye opening
  for (const [start, cx] of [[36, 130], [42, 170]]) {
    const eye = [{ x: cx - 10, y: 140 }, { x: cx - 4, y: 140 - h }, { x: cx + 4, y: 140 - h }, { x: cx + 10, y: 140 }, { x: cx + 4, y: 140 + h }, { x: cx - 4, y: 140 + h }];
    eye.forEach((p, i) => (points[start + i] = p));
  }
  return { points, expressions, score, box: { width: size, height: size } };
}

// Feeds frames every `step` ms; each entry is [faces, seconds].
function run(script, step = 250, tracker = createAttentionTracker()) {
  let t = 0;
  for (const [faces, secs] of script) {
    for (let i = 0; i < (secs * 1000) / step; i++, t += step) tracker.update(faces, t);
  }
  tracker.update(script[script.length - 1][0], t);
  return tracker.summary();
}

test("direction thresholds match faces measured with the real model", () => {
  // measured nose-tip ratios: facing the camera 0.41-0.63, clearly turned 0.21-0.34 / 0.70-0.97
  for (const r of [0.41, 0.5, 0.63]) assert.equal(directionOf(r), "center");
  for (const r of [0.21, 0.34]) assert.equal(directionOf(r), "right");
  for (const r of [0.7, 0.97]) assert.equal(directionOf(r), "left");
  assert.equal(yawRatio(face({ ratio: 0.3 }).points), 0.3);
  // landmarks outside the face are a bad frame
  assert.equal(yawRatio(face({ ratio: 1.39 }).points), null);
});

test("times and turns follow the head", () => {
  const s = run([[[face()], 6], [[face({ ratio: 0.9 })], 4], [[face()], 3], [[face({ ratio: 0.1 })], 4], [[face()], 3]]);
  assert.equal(s.time_straight, 12);
  assert.equal(s.time_left, 4);
  assert.equal(s.time_right, 4);
  assert.equal(s.time_away, 0);
  assert.deepEqual([s.seen_left, s.seen_right, s.seen_center], [1, 1, 3]);
});

test("the same timing on a slow device (one analysis every 1.3 s)", () => {
  const s = run([[[face()], 13], [[face({ ratio: 0.9 })], 6.5], [[face()], 13]], 1300);
  assert.equal(s.time_left, 7); // 6.5 s rounded at the frame boundary, not shifted by the confirmation
  assert.equal(s.seen_left, 1);
});

test("an off-centre camera is calibrated: the student's straight-ahead does not count as turned", () => {
  // the camera is to one side, so facing the screen reads 0.36 (would be "right" without calibration)
  const s = run([[[face({ ratio: 0.36 })], 10], [[face({ ratio: 0.6 })], 3], [[face({ ratio: 0.36 })], 3]]);
  assert.equal(s.time_right, 0);
  assert.equal(s.time_left, 3); // 0.6 is 0.24 from this student's straight-ahead
});

test("a single jittery frame is not a turn", () => {
  const s = run([[[face()], 3], [[face({ ratio: 0.9 })], 0.25], [[face()], 3]]);
  assert.equal(s.seen_left, 0);
  assert.equal(s.time_left, 0);
});

test("face lost right after a turn counts as that side for up to 5 s, then as not visible", () => {
  const s = run([[[face()], 4], [[face({ ratio: 0.1 })], 2], [[], 8], [[face()], 2]]);
  assert.equal(s.time_right, 7); // 2 s seen turned + 5 s turned out of view
  assert.equal(s.time_away, 3);
  const t = run([[[face()], 4], [[], 3], [[face()], 2]]);
  assert.equal(t.time_away, 3); // lost while facing the camera: not visible
  assert.equal(t.time_left + t.time_right, 0);
});

test("long gaps (tab in the background) are not counted", () => {
  const tr = createAttentionTracker();
  tr.update([face()], 0);
  tr.update([face()], 60000);
  assert.equal(tr.summary().time_straight, 2);
});

test("the largest face is the student; a confident second face warns", () => {
  const tr = createAttentionTracker();
  const student = face({ ratio: 0.5, size: 200 });
  assert.equal(tr.update([face({ ratio: 0.9, size: 60, score: 0.4 }), student], 0).warning, null); // unsure background face
  assert.equal(tr.update([face({ ratio: 0.9, size: 60, score: 0.8 }), student], 250).warning, "multiple");
  assert.equal(tr.update([], 500).warning, "none");
  assert.equal(tr.summary().seen_left, 0);
});

test("blinks are counted against the student's own open-eye level", () => {
  const open = [[face()], 2];
  const blink = [[face({ eyesOpen: false })], 0.25];
  const s = run([open, blink, open, blink, open, blink, open]);
  assert.equal(s.blinks, 3);
  // eyes closed on a turned head are ignored
  const t = run([open, [[face({ ratio: 0.9, eyesOpen: false })], 1], [[face({ ratio: 0.9 })], 1], open]);
  assert.equal(t.blinks, 0);
});

test("expressions are the share of frames where one expression dominates", () => {
  const tr = createAttentionTracker();
  for (let i = 0; i < 4; i++) tr.update([face({ expressions: i < 3 ? { happy: 0.8, neutral: 0.2 } : { neutral: 0.7, sad: 0.3 } })], i * 250);
  const s = tr.summary();
  assert.equal(s.emotions.happy, 75);
  assert.equal(s.emotions.neutral, 25);
  assert.equal(createAttentionTracker().summary(), null);
});
