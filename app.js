import {
  FaceLandmarker,
  FilesetResolver,
} from "./vision_bundle.js";

/* Diretório deste arquivo — para achar wasm/ e models/ localmente. */
const ASSET_BASE = new URL(".", import.meta.url).href;

/* =========================================================================
   OAZ Protetor Solar Stick — Provador Virtual
   Câmera ao vivo OU upload de foto. Tudo roda no navegador.
   ========================================================================= */

/* ---------- Cores REAIS medidas das swatches oficiais do OAZ ------------- */
/* color = cor do creme; cover = cobertura na pele (0..1), calibrada suave.  */
const SHADES = [
  { tone: "Cor 1", name: "Claro",       color: "#d3ac82", cover: 0.18, img: "refs/img/stick_cor1.png", stick: "refs/img/stick_cor1.png", buy: "https://www.oaz.vc/protetor-facial--solar-stick--cor1/p" },
  { tone: "Cor 2", name: "Médio Claro", color: "#c99676", cover: 0.20, img: "refs/img/stick_cor2.png", stick: "refs/img/stick_cor2.png", buy: "https://www.oaz.vc/protetor-facial--solar-stick-1/p" },
  { tone: "Cor 3", name: "Médio",       color: "#a97343", cover: 0.25, img: "refs/img/stick_cor3.png", stick: "refs/img/stick_cor3.png", buy: "https://www.oaz.vc/protetor-facial--solar-stick-cor3/p" },
  { tone: "Cor 4", name: "Escuro",      color: "#623e22", cover: 0.30, img: "refs/img/stick_cor4.png", stick: "refs/img/stick_cor4.png", buy: "https://www.oaz.vc/protetor-facial--solar-stick-cor4/p" },
];

/* Pré-carrega os recortes (PNG sem fundo) do bastão para "assinar" a foto. */
const STICK_IMGS = SHADES.map((s) => { const im = new Image(); im.src = s.stick; return im; });

/* ---------- Índices de landmarks do MediaPipe (anéis ordenados) ---------- */
const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LEFT_EYE  = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
const RIGHT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const LIPS      = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];

/* ------------------------------- Elementos ------------------------------- */
const el = {
  open:      document.getElementById("open-tryon"),
  modal:     document.getElementById("tryon"),
  close:     document.getElementById("close-tryon"),
  chooser:   document.getElementById("chooser"),
  chooseLive:document.getElementById("choose-live"),
  chooseUp:  document.getElementById("choose-upload"),
  fileInput: document.getElementById("file-input"),
  permission:document.getElementById("permission"),
  grant:     document.getElementById("grant"),
  permError: document.getElementById("perm-error"),
  loading:   document.getElementById("loading"),
  video:     document.getElementById("video"),
  canvas:    document.getElementById("canvas"),
  pinned:    document.getElementById("pinned"),
  pinnedImg: document.getElementById("pinned-img"),
  hint:      document.getElementById("hint"),
  actions:   document.getElementById("actions"),
  actReset:  document.getElementById("act-reset"),
  actSplit:  document.getElementById("act-split"),
  actSave:   document.getElementById("act-save"),
  actShare:  document.getElementById("act-share"),
  divider:   document.getElementById("divider"),
  divHandle: document.querySelector("#divider .divider-handle"),
  stage:     document.querySelector(".stage"),
  productBar:document.getElementById("product-bar"),
  productImg: document.getElementById("product-img"),
  productShade: document.getElementById("product-shade"),
  buy:       document.getElementById("buy"),
  shelf:     document.getElementById("shelf"),
};

const ctx = el.canvas.getContext("2d");
const maskCanvas = document.createElement("canvas");
const mctx = maskCanvas.getContext("2d");
const tintCanvas = document.createElement("canvas");
const tctx = tintCanvas.getContext("2d");

/* ------------------------------- Estado ---------------------------------- */
let faceLandmarker = null;
let modelReady = false;
let currentRunningMode = null;
let stream = null;
let rafId = null;
let running = false;
let lastVideoTime = -1;
let latestLandmarks = null;
let activeIndex = -1;          // 0..3 = cor; -1 = sem produto (padrão ao abrir)
let mode = null;              // 'live' | 'photo'
let mirror = true;           // espelha só no modo câmera
let photoImg = null;
let splitMode = false;
let splitPos = 0.5;          // 0..1 posição do divisor
let noFaceFrames = 0;
/* Recorte "cover" da fonte para casar exatamente com o palco 3:4 na tela.   */
let srcW = 0, srcH = 0, cropX = 0, cropY = 0, cropW = 0, cropH = 0;

/* =============================== Fluxo modal ============================= */
el.open.addEventListener("click", openModal);
el.close.addEventListener("click", closeModal);
el.chooseLive.addEventListener("click", () => { el.chooser.hidden = true; el.permission.hidden = false; });
el.chooseUp.addEventListener("click", () => el.fileInput.click());
el.grant.addEventListener("click", startCamera);
el.fileInput.addEventListener("change", (e) => { if (e.target.files[0]) loadPhoto(e.target.files[0]); });

function openModal() {
  el.modal.hidden = false;
  buildShelf();
  resetToChooser();
}

function closeModal() {
  el.modal.hidden = true;
  stopEverything();
}

function resetToChooser() {
  stopEverything();
  activeIndex = -1;            // sempre começa em "Sem produto"
  el.chooser.hidden = false;
  el.permission.hidden = true;
  el.loading.hidden = true;
  el.actions.hidden = true;
  el.productBar.hidden = true;
  el.pinned.hidden = true;
  el.divider.hidden = true;
  el.hint.hidden = true;
  splitMode = false;
  el.actSplit.classList.remove("on");
  el.fileInput.value = "";
}

function stopEverything() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  el.video.srcObject = null;
  lastVideoTime = -1;
  latestLandmarks = null;
  photoImg = null;
}

/* ========================= Prateleira dos bastões ======================== */
function buildShelf() {
  if (el.shelf.childElementCount) return;

  // "Sem produto"
  const none = document.createElement("button");
  none.className = "stick-card noprod";
  none.type = "button";
  none.innerHTML = `<span class="noprod-icon"></span>
    <span class="stick-tone">Sem</span><span class="stick-name">produto</span>`;
  none.addEventListener("click", () => selectShade(-1));
  el.shelf.appendChild(none);

  // 4 cores
  SHADES.forEach((s, i) => {
    const card = document.createElement("button");
    card.className = "stick-card" + (i === activeIndex ? " active" : "");
    card.type = "button";
    card.innerHTML = `
      <span class="thumb"><img src="${s.img}" alt="${s.tone}" /></span>
      <span class="stick-tone">${s.tone}</span>`;
    card.addEventListener("click", () => selectShade(i));
    el.shelf.appendChild(card);
  });
}

function selectShade(i) {
  activeIndex = i;
  reflectSelection();
  if (mode === "photo") render();
}

function reflectSelection() {
  const cards = [...el.shelf.children];               // idx0 = sem produto, idx1..4 = cores
  cards.forEach((c, idx) => c.classList.toggle("active", idx - 1 === activeIndex));
  if (activeIndex === -1) {
    el.pinned.hidden = true;
    el.productShade.textContent = "Sem produto";
    el.buy.style.visibility = "hidden";
  } else {
    el.buy.style.visibility = "visible";
    updatePinned();
    updateProductBar();
  }
}

function updatePinned() {
  const s = SHADES[activeIndex];
  el.pinned.hidden = false;
  el.pinnedImg.src = s.img;
  el.pinned.querySelector(".pinned-tone").textContent = s.tone;
  el.pinned.querySelector(".pinned-name").textContent = "";
  el.pinned.style.animation = "none"; void el.pinned.offsetWidth; el.pinned.style.animation = "";
}

function updateProductBar() {
  const s = SHADES[activeIndex];
  el.productImg.src = s.img;
  el.productShade.textContent = s.tone;
  el.buy.href = s.buy;
}

/* ============================ Modelo (WASM) ============================= */
async function ensureModel() {
  if (faceLandmarker) return;
  console.log("[OAZ] Carregando WASM local…");
  const fileset = await FilesetResolver.forVisionTasks(ASSET_BASE + "wasm");
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: ASSET_BASE + "models/face_landmarker.task", delegate },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  try {
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (e) {
    console.warn("[OAZ] GPU indisponível, usando CPU…", e);
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
  }
  currentRunningMode = "VIDEO";
  modelReady = true;
  console.log("[OAZ] Modelo pronto.");
}

async function setRunningMode(m) {
  if (currentRunningMode === m) return;
  await faceLandmarker.setOptions({ runningMode: m });
  currentRunningMode = m;
}

/* ============================ Câmera (ao vivo) ========================== */
async function startCamera() {
  el.permError.hidden = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }, audio: false,
    });
  } catch (err) {
    el.permError.hidden = false;
    el.permError.textContent = err.name === "NotAllowedError"
      ? "Permissão negada. Libere a câmera nas configurações do navegador."
      : "Não foi possível acessar a câmera: " + err.message;
    return;
  }

  mode = "live"; mirror = true;
  el.permission.hidden = true;
  el.video.srcObject = stream;
  try { await el.video.play(); } catch (_) {}
  fitSource(el.video.videoWidth || 720, el.video.videoHeight || 960);

  el.loading.hidden = true;
  showTryUI();
  el.hint.hidden = false; el.hint.textContent = "Preparando o filtro…";
  running = true;
  loop();

  ensureModel().then(async () => {
    await setRunningMode("VIDEO");
    el.hint.textContent = "Posicione o rosto no centro";
  }).catch((e) => {
    console.error("[OAZ]", e);
    el.hint.hidden = false; el.hint.textContent = "Falha ao carregar o modelo de IA.";
  });
}

/* ============================ Upload de foto =========================== */
async function loadPhoto(file) {
  el.chooser.hidden = true;
  el.permission.hidden = true;
  el.loading.hidden = false;

  const img = new Image();
  img.onload = async () => {
    mode = "photo"; mirror = false; photoImg = img;
    fitSource(img.naturalWidth, img.naturalHeight);
    try {
      await ensureModel();
      await setRunningMode("IMAGE");
      const res = faceLandmarker.detect(img);
      latestLandmarks = res.faceLandmarks && res.faceLandmarks[0] ? res.faceLandmarks[0] : null;
    } catch (e) {
      console.error("[OAZ]", e);
    }
    el.loading.hidden = true;
    showTryUI();
    if (!latestLandmarks) { el.hint.hidden = false; el.hint.textContent = "Não achei um rosto nesta foto"; }
    else el.hint.hidden = true;
    render();
  };
  img.onerror = () => { el.loading.hidden = true; alert("Não foi possível abrir esta imagem."); resetToChooser(); };
  img.src = URL.createObjectURL(file);
}

function showTryUI() {
  el.actions.hidden = false;
  el.productBar.hidden = false;
  reflectSelection();
}

/* =============================== Canvas ================================= */
function sizeCanvases(w, h) {
  [el.canvas, maskCanvas, tintCanvas].forEach((c) => { c.width = w; c.height = h; });
}

/* Define o recorte "cover" da fonte para o palco 3:4 e dimensiona o canvas
   com esse MESMO aspecto — assim a linha do divisor (DOM) e o limite do
   filtro (canvas) ficam exatamente no mesmo lugar. */
function fitSource(sw, sh) {
  srcW = sw; srcH = sh;
  const targetAR = 3 / 4;
  const srcAR = sw / sh;
  if (srcAR > targetAR) { cropH = sh; cropW = sh * targetAR; }
  else { cropW = sw; cropH = sw / targetAR; }
  cropX = (sw - cropW) / 2;
  cropY = (sh - cropH) / 2;
  let cw = Math.round(cropW), ch = Math.round(cropH);
  const cap = 1400;
  if (Math.max(cw, ch) > cap) { const k = cap / Math.max(cw, ch); cw = Math.round(cw * k); ch = Math.round(ch * k); }
  sizeCanvases(cw, ch);
}

/* =============================== Render ================================= */
function loop() {
  if (!running) return;
  if (mode === "live" && modelReady && faceLandmarker &&
      el.video.readyState >= 2 && el.video.currentTime !== lastVideoTime) {
    lastVideoTime = el.video.currentTime;
    try {
      const res = faceLandmarker.detectForVideo(el.video, performance.now());
      latestLandmarks = res.faceLandmarks && res.faceLandmarks[0] ? res.faceLandmarks[0] : null;
      if (latestLandmarks) { noFaceFrames = 0; el.hint.hidden = true; }
      else if (++noFaceFrames > 12) { el.hint.hidden = false; el.hint.textContent = "Posicione o rosto no centro"; }
    } catch (_) {}
  }
  render();
  rafId = requestAnimationFrame(loop);
}

function drawBase() {
  const w = el.canvas.width, h = el.canvas.height;
  const src = mode === "live" ? el.video : photoImg;
  if (!src) return;
  if (mirror) {
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(src, cropX, cropY, cropW, cropH, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(src, cropX, cropY, cropW, cropH, 0, 0, w, h);
  }
}

function render() {
  const w = el.canvas.width, h = el.canvas.height;
  // 1) desenha resultado COM produto em toda a tela
  drawBase();
  if (activeIndex >= 0 && latestLandmarks) applyTint(latestLandmarks, w, h);
  // 2) modo antes/depois: lado esquerdo mostra o ORIGINAL
  if (splitMode) {
    const x = splitPos * w;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, h); ctx.clip(); drawBase(); ctx.restore();
  }
}

function applyTint(lm, w, h) {
  const shade = SHADES[activeIndex];
  // máscara da pele (rosto - olhos - boca) com borda suave
  mctx.clearRect(0, 0, w, h);
  mctx.save();
  mctx.filter = `blur(${Math.max(2, Math.round(w * 0.012))}px)`;
  mctx.fillStyle = "#fff";
  mctx.fill(buildSkinPath(lm, w, h), "evenodd");
  mctx.restore();
  // camada de cor recortada pela máscara
  tctx.clearRect(0, 0, w, h);
  tctx.fillStyle = shade.color;
  tctx.fillRect(0, 0, w, h);
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(maskCanvas, 0, 0);
  tctx.globalCompositeOperation = "source-over";
  // compõe: cobertura leve (normal) + toque de profundidade (multiply)
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = shade.cover;
  ctx.drawImage(tintCanvas, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.08;
  ctx.drawImage(tintCanvas, 0, 0);
  ctx.restore();
}

function buildSkinPath(lm, w, h) {
  // landmark normalizado -> pixel da FONTE -> pixel do CANVAS recortado
  const X = (nx) => (nx * srcW - cropX) * (w / cropW);
  const Y = (ny) => (ny * srcH - cropY) * (h / cropH);
  const mx = (nx) => (mirror ? (w - X(nx)) : X(nx));
  const my = (ny) => Y(ny);
  const path = new Path2D();
  const ring = (idx) => {
    idx.forEach((p, i) => {
      const x = mx(lm[p].x), y = my(lm[p].y);
      i === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    });
    path.closePath();
  };
  ring(FACE_OVAL); ring(LEFT_EYE); ring(RIGHT_EYE); ring(LIPS);
  return path;
}

/* ============================ Antes / Depois =========================== */
el.actSplit.addEventListener("click", () => {
  splitMode = !splitMode;
  el.divider.hidden = !splitMode;
  el.actSplit.classList.toggle("on", splitMode);
  splitPos = 0.5; positionDivider();
  if (mode === "photo") render();
});

function positionDivider() {
  const pct = (splitPos * 100).toFixed(2) + "%";
  el.divider.querySelector(".divider-line").style.left = pct;
  el.divHandle.style.left = pct;
}

function startDrag(ev) {
  ev.preventDefault();
  const move = (e) => {
    const rect = el.stage.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    splitPos = Math.min(1, Math.max(0, cx / rect.width));
    positionDivider();
    if (mode === "photo") render();
  };
  const up = () => {
    window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
    window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up);
  };
  window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
}
el.divHandle.addEventListener("mousedown", startDrag);
el.divHandle.addEventListener("touchstart", startDrag, { passive: false });

/* ========================= Recomeçar / Salvar / Share ================== */
el.actReset.addEventListener("click", resetToChooser);

const SIG_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

function roundRectPath(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* Desenha o bastão (PNG sem fundo) + etiqueta da cor escolhida na foto. */
function drawSignature(o, w, h) {
  const shade = SHADES[activeIndex];
  const img = STICK_IMGS[activeIndex];
  const m = Math.round(w * 0.035);

  // Bastão no canto inferior direito
  if (img && img.complete && img.naturalWidth) {
    const ratio = img.naturalWidth / img.naturalHeight;
    const sh = Math.round(h * 0.36);
    const sw = Math.round(sh * ratio);
    const sx = w - m - sw;
    const sy = h - m - sh;
    o.save();
    o.shadowColor = "rgba(0,0,0,.35)";
    o.shadowBlur = Math.round(w * 0.03);
    o.shadowOffsetY = Math.round(h * 0.006);
    o.drawImage(img, sx, sy, sw, sh);
    o.restore();
  }

  // Etiqueta (marca + cor) no canto inferior esquerdo
  const f1 = Math.round(w * 0.034);
  const f2 = Math.round(w * 0.058);
  const brand = "OAZ Protetor Solar Stick";
  const cor = shade.tone;
  const padX = Math.round(w * 0.04);
  const padY = Math.round(h * 0.02);
  const gap = Math.round(h * 0.012);
  const dot = Math.round(f2 * 0.72);

  o.textBaseline = "top";
  o.font = `600 ${f1}px ${SIG_FONT}`;
  const w1 = o.measureText(brand).width;
  o.font = `700 ${f2}px ${SIG_FONT}`;
  const w2 = dot + Math.round(f2 * 0.35) + o.measureText(cor).width;

  const pw = Math.round(Math.max(w1, w2) + padX * 2);
  const ph = Math.round(f1 + gap + f2 + padY * 2);
  const px = m;
  const py = h - m - ph;

  o.save();
  o.shadowColor = "rgba(0,0,0,.30)";
  o.shadowBlur = Math.round(w * 0.02);
  o.shadowOffsetY = Math.round(h * 0.004);
  roundRectPath(o, px, py, pw, ph, Math.round(ph * 0.26));
  o.fillStyle = "rgba(15,15,17,.62)";
  o.fill();
  o.restore();

  o.fillStyle = "rgba(255,255,255,.85)";
  o.font = `600 ${f1}px ${SIG_FONT}`;
  o.fillText(brand, px + padX, py + padY);

  const cy = py + padY + f1 + gap;
  o.fillStyle = shade.color;
  roundRectPath(o, px + padX, cy + Math.round((f2 - dot) / 2), dot, dot, Math.round(dot * 0.3));
  o.fill();
  o.fillStyle = "#fff";
  o.font = `700 ${f2}px ${SIG_FONT}`;
  o.fillText(cor, px + padX + dot + Math.round(f2 * 0.35), cy);
}

/* Monta a imagem final (foto + assinatura do produto). */
function buildCompositeCanvas() {
  const wasSplit = splitMode; splitMode = false; render();
  const w = el.canvas.width, h = el.canvas.height;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const o = out.getContext("2d");
  o.drawImage(el.canvas, 0, 0);
  if (activeIndex >= 0) drawSignature(o, w, h);
  splitMode = wasSplit; render();
  return out;
}

function captureDataURL() {
  return buildCompositeCanvas().toDataURL("image/png");
}

el.actSave.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = `oaz-stick-${activeIndex >= 0 ? SHADES[activeIndex].tone.replace(" ", "").toLowerCase() : "original"}.png`;
  a.href = captureDataURL();
  a.click();
});

el.actShare.addEventListener("click", async () => {
  try {
    const out = buildCompositeCanvas();
    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    const file = new File([blob], "oaz-stick.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "OAZ Protetor Solar Stick", text: "Meu tom no provador OAZ" });
    } else {
      const a = document.createElement("a"); a.download = "oaz-stick.png"; a.href = captureDataURL(); a.click();
    }
  } catch (e) { console.warn("[OAZ] share cancelado/indisponível", e); }
});
