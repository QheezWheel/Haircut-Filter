// Webcam Haircut Filters (fixed MediaPipe globals)
// Works with CDN scripts:
// - @mediapipe/camera_utils/camera_utils.js  -> global: Camera
// - @mediapipe/face_mesh/face_mesh.js        -> global: FaceMesh

const els = {
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  notes: document.getElementById("notes"),

  btnStart: document.getElementById("btnStart"),
  btnStop: document.getElementById("btnStop"),
  btnSnap: document.getElementById("btnSnap"),
  downloadLink: document.getElementById("downloadLink"),

  style: document.getElementById("style"),
  hairColor: document.getElementById("hairColor"),
  opacity: document.getElementById("opacity"),
  scale: document.getElementById("scale"),
  xOffset: document.getElementById("xOffset"),
  yOffset: document.getElementById("yOffset"),
  mirror: document.getElementById("mirror"),

  opacityVal: document.getElementById("opacityVal"),
  scaleVal: document.getElementById("scaleVal"),
  xVal: document.getElementById("xVal"),
  yVal: document.getElementById("yVal"),

  asset: document.getElementById("asset"),
  useAsset: document.getElementById("useAsset"),
};

const ctx = els.overlay.getContext("2d", { alpha: true });

let stream = null;
let camera = null;
let faceMesh = null;

let lastLandmarks = null;
let assetImg = null;

const state = {
  style: els.style.value,
  color: els.hairColor.value,
  opacity: Number(els.opacity.value) / 100,
  scale: Number(els.scale.value) / 100,
  xOffset: Number(els.xOffset.value),
  yOffset: Number(els.yOffset.value),
  mirror: els.mirror.checked,
  useAsset: els.useAsset.checked,
};

// ---------- UI helpers ----------
function setStatus(kind, text) {
  els.statusText.textContent = text;
  if (kind === "ok") {
    els.statusDot.style.background = "#31d07a";
    els.statusDot.style.boxShadow = "0 0 0 4px rgba(49,208,122,.12)";
  } else if (kind === "err") {
    els.statusDot.style.background = "#ff4d4d";
    els.statusDot.style.boxShadow = "0 0 0 4px rgba(255,77,77,.12)";
  } else {
    els.statusDot.style.background = "#ffbf3a";
    els.statusDot.style.boxShadow = "0 0 0 4px rgba(255,191,58,.12)";
  }
}

function setNote(msg) {
  els.notes.textContent = msg || "";
}

function syncLabels() {
  els.opacityVal.textContent = `${Math.round(state.opacity * 100)}%`;
  els.scaleVal.textContent = `${Math.round(state.scale * 100)}%`;
  els.xVal.textContent = `${state.xOffset}px`;
  els.yVal.textContent = `${state.yOffset}px`;
}
syncLabels();

function resizeCanvasToVideo() {
  const vw = els.video.videoWidth || 1280;
  const vh = els.video.videoHeight || 720;
  if (els.overlay.width !== vw) els.overlay.width = vw;
  if (els.overlay.height !== vh) els.overlay.height = vh;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function hexToRgba(hex, a = 1) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- Landmark utilities ----------
function lmToPx(lm) {
  return { x: lm.x * els.overlay.width, y: lm.y * els.overlay.height };
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function avgPoint(...pts) {
  const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

// FaceMesh landmark indices (stable enough for this overlay style)
const IDX = {
  leftTemple: 127,
  rightTemple: 356,
  foreheadTop: 10,
  noseBridge: 6,
  chin: 152,
  leftJaw: 234,
  rightJaw: 454,
};

// ---------- Drawing ----------
function beginMirroredDraw() {
  ctx.save();
  if (state.mirror) {
    ctx.translate(els.overlay.width, 0);
    ctx.scale(-1, 1);
  }
}
function endMirroredDraw() { ctx.restore(); }
function clearOverlay() { ctx.clearRect(0, 0, els.overlay.width, els.overlay.height); }

function drawSoftShadowPath(pathFn, fillStyle, shadowAlpha = 0.35) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  pathFn();
  ctx.fill();
  ctx.restore();
}

function drawHairVector(style, landmarks) {
  if (!landmarks || style === "none") return;

  const lt = lmToPx(landmarks[IDX.leftTemple]);
  const rt = lmToPx(landmarks[IDX.rightTemple]);
  const ft = lmToPx(landmarks[IDX.foreheadTop]);
  const nb = lmToPx(landmarks[IDX.noseBridge]);
  const chin = lmToPx(landmarks[IDX.chin]);
  const lj = lmToPx(landmarks[IDX.leftJaw]);
  const rj = lmToPx(landmarks[IDX.rightJaw]);

  const faceWidth = dist(lt, rt);
  const faceHeight = dist(ft, chin);
  const base = Math.max(80, (faceWidth + faceHeight) * 0.35);

  const sx = state.scale;
  const ox = state.xOffset;
  const oy = state.yOffset;

  const headCenter = avgPoint(lt, rt, ft);
  const cx = headCenter.x + ox;
  const cy = headCenter.y + oy;

  const hairColor = hexToRgba(state.color, state.opacity);
  const hairDark = hexToRgba(state.color, clamp(state.opacity + 0.12, 0, 1));

  const hairlineMid = avgPoint(ft, nb);
  const topY = ft.y - base * 0.55 * sx;

  const leftX = lt.x - base * 0.10 * sx;
  const rightX = rt.x + base * 0.10 * sx;

  if (style === "buzz") {
    drawSoftShadowPath(() => {
      ctx.moveTo(leftX, lt.y);
      ctx.quadraticCurveTo(cx, topY, rightX, rt.y);
      ctx.quadraticCurveTo(rt.x, hairlineMid.y, cx, hairlineMid.y + base * 0.10 * sx);
      ctx.quadraticCurveTo(lt.x, hairlineMid.y, leftX, lt.y);
      ctx.closePath();
    }, hairColor, 0.22);

    ctx.save();
    ctx.globalAlpha = 0.35 * state.opacity;
    ctx.fillStyle = hairDark;
    ctx.beginPath();
    ctx.moveTo(leftX, lt.y + base * 0.06 * sx);
    ctx.quadraticCurveTo(cx, topY + base * 0.35 * sx, rightX, rt.y + base * 0.06 * sx);
    ctx.quadraticCurveTo(cx, hairlineMid.y + base * 0.22 * sx, leftX, lt.y + base * 0.06 * sx);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  if (style === "fade") {
    drawSoftShadowPath(() => {
      ctx.moveTo(leftX, lt.y);
      ctx.quadraticCurveTo(cx, topY, rightX, rt.y);
      ctx.quadraticCurveTo(rt.x, hairlineMid.y + base * 0.05 * sx, cx, hairlineMid.y + base * 0.12 * sx);
      ctx.quadraticCurveTo(lt.x, hairlineMid.y + base * 0.05 * sx, leftX, lt.y);
      ctx.closePath();
    }, hairColor, 0.28);

    const fadeTop = (lt.y + rt.y) / 2;
    const fadeBottom = avgPoint(lj, rj, chin).y - base * 0.10 * sx;

    const gradL = ctx.createLinearGradient(lt.x - base * 0.35 * sx, fadeTop, lt.x - base * 0.35 * sx, fadeBottom);
    gradL.addColorStop(0, hexToRgba(state.color, state.opacity * 0.45));
    gradL.addColorStop(1, hexToRgba(state.color, 0));

    const gradR = ctx.createLinearGradient(rt.x + base * 0.35 * sx, fadeTop, rt.x + base * 0.35 * sx, fadeBottom);
    gradR.addColorStop(0, hexToRgba(state.color, state.opacity * 0.45));
    gradR.addColorStop(1, hexToRgba(state.color, 0));

    ctx.save();
    ctx.fillStyle = gradL;
    ctx.beginPath();
    ctx.moveTo(lt.x - base * 0.10 * sx, lt.y);
    ctx.quadraticCurveTo(lt.x - base * 0.50 * sx, (lt.y + lj.y) / 2, lj.x - base * 0.30 * sx, lj.y);
    ctx.lineTo(lj.x - base * 0.10 * sx, lj.y);
    ctx.quadraticCurveTo(lt.x - base * 0.18 * sx, (lt.y + lj.y) / 2, lt.x, lt.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = gradR;
    ctx.beginPath();
    ctx.moveTo(rt.x + base * 0.10 * sx, rt.y);
    ctx.quadraticCurveTo(rt.x + base * 0.50 * sx, (rt.y + rj.y) / 2, rj.x + base * 0.30 * sx, rj.y);
    ctx.lineTo(rj.x + base * 0.10 * sx, rj.y);
    ctx.quadraticCurveTo(rt.x + base * 0.18 * sx, (rt.y + rj.y) / 2, rt.x, rt.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  if (style === "fringe") {
    drawSoftShadowPath(() => {
      ctx.moveTo(leftX, lt.y);
      ctx.quadraticCurveTo(cx, topY, rightX, rt.y);
      ctx.quadraticCurveTo(rt.x, hairlineMid.y + base * 0.10 * sx, cx, hairlineMid.y + base * 0.16 * sx);
      ctx.quadraticCurveTo(lt.x, hairlineMid.y + base * 0.10 * sx, leftX, lt.y);
      ctx.closePath();
    }, hairColor, 0.3);

    ctx.save();
    ctx.fillStyle = hairDark;
    ctx.globalAlpha = 0.55 * state.opacity;
    const fringeY = hairlineMid.y + base * 0.14 * sx;
    const fringeLen = base * 0.30 * sx;
    const spikes = 9;
    for (let i = 0; i < spikes; i++) {
      const t = i / (spikes - 1);
      const x = leftX + (rightX - leftX) * t;
      const wobble = Math.sin(t * Math.PI * 2) * base * 0.04 * sx;
      const len = fringeLen * (0.75 + 0.35 * Math.sin((t + 0.15) * Math.PI * 3));
      ctx.beginPath();
      ctx.moveTo(x - base * 0.06 * sx, fringeY);
      ctx.quadraticCurveTo(x + wobble, fringeY + len, x + base * 0.06 * sx, fringeY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (style === "pompadour") {
    drawSoftShadowPath(() => {
      ctx.moveTo(leftX, lt.y + base * 0.08 * sx);
      ctx.bezierCurveTo(
        cx - base * 0.30 * sx, topY - base * 0.20 * sx,
        cx + base * 0.55 * sx, topY + base * 0.05 * sx,
        rightX, rt.y + base * 0.02 * sx
      );
      ctx.quadraticCurveTo(rt.x, hairlineMid.y + base * 0.08 * sx, cx, hairlineMid.y + base * 0.12 * sx);
      ctx.quadraticCurveTo(lt.x, hairlineMid.y + base * 0.08 * sx, leftX, lt.y + base * 0.08 * sx);
      ctx.closePath();
    }, hairColor, 0.33);

    ctx.save();
    ctx.strokeStyle = hexToRgba("#ffffff", 0.12 * state.opacity);
    ctx.lineWidth = Math.max(2, base * 0.02 * sx);
    ctx.beginPath();
    ctx.moveTo(cx - base * 0.10 * sx, topY + base * 0.18 * sx);
    ctx.bezierCurveTo(
      cx + base * 0.10 * sx, topY - base * 0.05 * sx,
      cx + base * 0.55 * sx, topY + base * 0.18 * sx,
      rightX - base * 0.05 * sx, rt.y + base * 0.05 * sx
    );
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (style === "long") {
    drawSoftShadowPath(() => {
      ctx.moveTo(leftX, lt.y);
      ctx.quadraticCurveTo(cx, topY, rightX, rt.y);

      ctx.bezierCurveTo(
        rt.x + base * 0.25 * sx, rt.y + base * 0.45 * sx,
        rj.x + base * 0.25 * sx, rj.y + base * 0.65 * sx,
        cx + base * 0.12 * sx, chin.y + base * 0.35 * sx
      );

      ctx.bezierCurveTo(
        cx - base * 0.12 * sx, chin.y + base * 0.35 * sx,
        lj.x - base * 0.25 * sx, lj.y + base * 0.65 * sx,
        lt.x - base * 0.25 * sx, lt.y + base * 0.45 * sx
      );
      ctx.closePath();
    }, hairColor, 0.34);

    ctx.save();
    ctx.globalAlpha = 0.28 * state.opacity;
    ctx.strokeStyle = hairDark;
    ctx.lineWidth = Math.max(1.5, base * 0.012 * sx);
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const x = leftX + (rightX - leftX) * t;
      ctx.beginPath();
      ctx.moveTo(x, hairlineMid.y + base * 0.12 * sx);
      ctx.bezierCurveTo(
        x + base * 0.12 * sx, hairlineMid.y + base * 0.55 * sx,
        x - base * 0.10 * sx, chin.y + base * 0.18 * sx,
        x + base * 0.06 * sx, chin.y + base * 0.42 * sx
      );
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
}

function drawHairAsset(landmarks) {
  if (!assetImg || !landmarks) return;

  const lt = lmToPx(landmarks[IDX.leftTemple]);
  const rt = lmToPx(landmarks[IDX.rightTemple]);
  const ft = lmToPx(landmarks[IDX.foreheadTop]);
  const chin = lmToPx(landmarks[IDX.chin]);

  const faceWidth = dist(lt, rt);
  const faceHeight = dist(ft, chin);

  const baseW = faceWidth * 1.55;
  const baseH = faceHeight * 1.35;

  const w = baseW * state.scale;
  const h = baseH * state.scale;

  const anchor = avgPoint(lt, rt, ft);
  const x = anchor.x - w / 2 + state.xOffset;
  const y = (ft.y - h * 0.42) + state.yOffset;

  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.drawImage(assetImg, x, y, w, h);
  ctx.restore();
}

// ---------- MediaPipe pipeline ----------
function initFaceMesh() {
  // IMPORTANT: FaceMesh is a global constructor from the CDN script
  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMesh.onResults((results) => {
    resizeCanvasToVideo();
    clearOverlay();
    beginMirroredDraw();

    const lm = results.multiFaceLandmarks?.[0] || null;
    if (lm) {
      lastLandmarks = lm;

      if (state.useAsset) drawHairAsset(lm);
      else drawHairVector(state.style, lm);

      setStatus("ok", "Tracking");
      setNote("");
    } else {
      setStatus("warn", "No face detected");
      setNote("Move into frame and face the camera.");
    }

    endMirroredDraw();
  });
}

async function startCamera() {
  try {
    setStatus("warn", "Requesting camera permission…");
    setNote("");

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    els.video.srcObject = stream;
    await els.video.play();

    resizeCanvasToVideo();

    // IMPORTANT: Camera is a global constructor from the CDN script
    camera = new Camera(els.video, {
      onFrame: async () => {
        if (!faceMesh) return;
        await faceMesh.send({ image: els.video });
      },
      width: els.video.videoWidth || 1280,
      height: els.video.videoHeight || 720,
    });

    camera.start();
    setStatus("ok", "Camera running");
    setNote("Pick a style, adjust opacity/scale/offset, then snapshot.");
  } catch (err) {
    console.error(err);
    setStatus("err", "Camera blocked");
    setNote("Open via https or http://localhost and allow camera access.");
  }
}

function stopCamera() {
  try {
    if (camera) camera.stop();
    camera = null;

    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    els.video.srcObject = null;
    clearOverlay();
    setStatus("warn", "Stopped");
    setNote("");
  } catch (e) {
    console.warn(e);
  }
}

function snapshot() {
  resizeCanvasToVideo();

  const out = document.createElement("canvas");
  out.width = els.overlay.width;
  out.height = els.overlay.height;
  const octx = out.getContext("2d");

  // Mirror if needed (match what user sees)
  octx.save();
  if (state.mirror) {
    octx.translate(out.width, 0);
    octx.scale(-1, 1);
  }
  octx.drawImage(els.video, 0, 0, out.width, out.height);
  octx.restore();

  // Draw overlay with same mirror transform
  octx.save();
  if (state.mirror) {
    octx.translate(out.width, 0);
    octx.scale(-1, 1);
  }
  octx.drawImage(els.overlay, 0, 0, out.width, out.height);
  octx.restore();

  const url = out.toDataURL("image/png");
  els.downloadLink.href = url;
  els.downloadLink.style.display = "inline-flex";
  els.downloadLink.textContent = "Download Snapshot";
  setNote("Snapshot ready. Download it, or tweak sliders and try again.");
}

// ---------- Event wiring ----------
function wireUI() {
  const updateState = () => {
    state.style = els.style.value;
    state.color = els.hairColor.value;
    state.opacity = Number(els.opacity.value) / 100;
    state.scale = Number(els.scale.value) / 100;
    state.xOffset = Number(els.xOffset.value);
    state.yOffset = Number(els.yOffset.value);
    state.mirror = els.mirror.checked;
    state.useAsset = els.useAsset.checked;
    syncLabels();
  };

  ["change", "input"].forEach((evt) => {
    els.style.addEventListener(evt, updateState);
    els.hairColor.addEventListener(evt, updateState);
    els.opacity.addEventListener(evt, updateState);
    els.scale.addEventListener(evt, updateState);
    els.xOffset.addEventListener(evt, updateState);
    els.yOffset.addEventListener(evt, updateState);
    els.mirror.addEventListener(evt, updateState);
    els.useAsset.addEventListener(evt, updateState);
  });

  els.asset.addEventListener("change", () => {
    const f = els.asset.files?.[0];
    if (!f) return;

    const img = new Image();
    img.onload = () => {
      assetImg = img;
      els.useAsset.checked = true;
      state.useAsset = true;
      setNote("PNG asset loaded. Use sliders to align it to your head.");
    };
    img.onerror = () => {
      assetImg = null;
      setNote("Could not load PNG asset. Make sure it's a valid image.");
    };
    img.src = URL.createObjectURL(f);
  });

  els.btnStart.addEventListener("click", startCamera);
  els.btnStop.addEventListener("click", stopCamera);
  els.btnSnap.addEventListener("click", snapshot);

  els.mirror.addEventListener("change", () => clearOverlay());
}

// ---------- Boot ----------
(function boot() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("err", "Unsupported browser");
    setNote("Your browser doesn't support getUserMedia(). Try modern Chrome/Firefox.");
    return;
  }

  // If CDN failed to load, FaceMesh will be undefined — show a helpful message
  if (typeof FaceMesh === "undefined") {
    setStatus("err", "FaceMesh not loaded");
    setNote("CDN script failed. Check your <script> tags and network console.");
    return;
  }
  if (typeof Camera === "undefined") {
    setStatus("err", "Camera utils not loaded");
    setNote("CDN camera_utils failed. Check your <script> tags and network console.");
    return;
  }

  initFaceMesh();
  wireUI();

  setStatus("warn", "Ready");
  setNote("Click “Start Camera”. If it fails, use https or http://localhost.");
})();
