import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IMAGE_BASE } from "../../api/axiosInstance";
import { createAttentionTracker } from "./attentionTracker";

const MODEL_BASE = `${IMAGE_BASE}models/`;
const BROWSER_INTERVAL_MS = 250; // frequent enough to catch most blinks; slow devices skip frames
// 0.3 keeps turned heads (measured: 0.5 loses most faces turned past ~25 degrees).
const DETECTOR_SCORE = 0.3;
const FRAME_WIDTH = 320; // frames sent to the server are downscaled
const SERVER_FAILURES_BEFORE_FALLBACK = 3;
const NO_FACE_WARNING_MS = 4000;

// face-api.js detection -> { points: [{x,y}] x 68, expressions, score, box }
const fromBrowser = (d) => ({
  points: d.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
  expressions: d.expressions,
  score: d.detection.score,
  box: { width: d.detection.box.width, height: d.detection.box.height },
});

// DGX vision service face -> same shape
const fromServer = (f) => ({
  points: Array.isArray(f.landmarks) && f.landmarks.length === 68 ? f.landmarks.map(([x, y]) => ({ x, y })) : null,
  expressions: f.expressions || {},
  score: f.score,
  box: f.box,
});

/**
 * Camera-based attention and expression tracking for every interview type. Only aggregate counts are
 * sent with the submission.
 *
 * The face model (detector, 68 landmarks, 7 expressions) runs either:
 *  - on the DGX Spark ("server"): a downscaled frame is sent every interval_ms to the
 *    backend, which forwards it to the DGX vision service; frames are not stored, or
 *  - in the browser ("browser"): face-api.js, the fallback when the server mode is not
 *    configured or stops answering.
 *
 * @param {boolean} enabled
 * @param {{client?: {faceFrame: Function}, config?: {mode: string, interval_ms: number}}} options
 * Returns { videoRef, status, warning, summary(), stop() }.
 */
export default function useFaceTracking(enabled = true, { client, config } = {}) {
  const videoRef = useRef(null);
  const intervalRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | on | denied | unavailable
  const [warning, setWarning] = useState("");

  const tracker = useRef(null);
  if (!tracker.current) tracker.current = createAttentionTracker();
  const noFaceSince = useRef(null);
  const modesUsed = useRef(new Set());

  // Read once: the mode only changes from server to browser (fallback), never back.
  const startMode = config && config.mode === "server" && client && client.faceFrame ? "server" : "browser";
  const serverInterval = Math.max(250, Number(config && config.interval_ms) || 1000);
  const clientRef = useRef(client);
  clientRef.current = client;

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Updates the attention summary and the on-screen warning from one analysed frame.
  // `at` is when the analysed frame was captured, so slow analysis does not shift time.
  const process = useCallback((faces, at = Date.now()) => {
    const now = at;
    const { warning: w } = tracker.current.update(faces, now);
    if (w === "none") {
      if (noFaceSince.current == null) noFaceSince.current = now;
      if (now - noFaceSince.current >= NO_FACE_WARNING_MS) setWarning("We cannot see your face. Please stay in front of the camera.");
      return;
    }
    noFaceSince.current = null;
    setWarning(w === "multiple" ? "More than one person is visible. Only you should be in front of the camera." : "");
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const startLoop = (fn, ms) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fn, ms);
    };

    // Browser mode: face-api.js + TensorFlow.js, loaded on demand (large).
    const runInBrowser = async () => {
      let faceapi;
      try {
        faceapi = await import("face-api.js");
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(`${MODEL_BASE}tiny_face_detector`),
          faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_BASE}face_landmark_68`),
          faceapi.nets.faceExpressionNet.loadFromUri(`${MODEL_BASE}face_expression`),
        ]);
      } catch (_) {
        if (!cancelled) {
          stop(); // no model to run: release the camera
          setStatus("unavailable");
        }
        return;
      }
      if (cancelled) return;
      modesUsed.current.add("browser");
      let inFlight = false; // a slow detection must not overlap the next one
      const frame = document.createElement("canvas");
      startLoop(async () => {
        const video = videoRef.current;
        if (inFlight || !video || video.readyState < 2 || !video.videoWidth) return;
        inFlight = true;
        try {
          // Freeze one frame: the detector, landmarks and expressions must all see the same
          // image. On the live video they run at different moments, and a moving head then
          // gets a face box from one frame and landmarks from a later one.
          frame.width = video.videoWidth;
          frame.height = video.videoHeight;
          frame.getContext("2d").drawImage(video, 0, 0);
          const capturedAt = Date.now();
          const detections = await faceapi
            .detectAllFaces(frame, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: DETECTOR_SCORE }))
            .withFaceLandmarks()
            .withFaceExpressions();
          if (!cancelled) process(detections.map(fromBrowser), capturedAt);
        } catch (_) {
          // skip this frame
        } finally {
          inFlight = false;
        }
      }, BROWSER_INTERVAL_MS);
    };

    // Server mode: frames go to the DGX Spark through the backend.
    const runOnServer = () => {
      let inFlight = false;
      let failures = 0;
      modesUsed.current.add("server");
      startLoop(async () => {
        const video = videoRef.current;
        if (inFlight || !video || video.readyState < 2 || !video.videoWidth) return;
        const canvas = canvasRef.current || (canvasRef.current = document.createElement("canvas"));
        canvas.width = FRAME_WIDTH;
        canvas.height = Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.7).replace(/^data:image\/jpeg;base64,/, "");
        const capturedAt = Date.now();
        inFlight = true;
        try {
          const res = await clientRef.current.faceFrame(image);
          failures = 0;
          if (!cancelled) process(((res.data && res.data.faces) || []).map(fromServer), capturedAt);
        } catch (err) {
          const st = err && err.response && err.response.status;
          const unavailable = st === 503 || (err && err.response && err.response.data && err.response.data.unavailable);
          // The attempt is over (submitted / time up): stop sending frames.
          if (st === 409 || st === 401) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
          }
          failures += 1;
          if (!cancelled && (unavailable || failures >= SERVER_FAILURES_BEFORE_FALLBACK)) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
            runInBrowser();
          }
        } finally {
          inFlight = false;
        }
      }, serverInterval);
    };

    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      } catch (_) {
        if (!cancelled) setStatus("denied");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("on");
      if (startMode === "server") runOnServer();
      else runInBrowser();
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, stop, process, startMode, serverInterval]);

  // Aggregate shape stored with the interview; null when no frame was analysed
  // (e.g. the face model never finished loading).
  const summary = useCallback(() => {
    const sum = tracker.current.summary();
    if (!sum) return null;
    const used = [...modesUsed.current];
    return { ...sum, analysis: used.length > 1 ? "mixed" : used[0] };
  }, []);

  // Stable object so consumers' callbacks/effects are not recreated every render.
  return useMemo(() => ({ videoRef, status, warning, summary, stop }), [status, warning, summary, stop]);
}
