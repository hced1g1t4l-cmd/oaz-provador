import {
  FaceLandmarker,
  FilesetResolver,
} from "./vision_bundle.mjs";

/* Diretório deste arquivo — para achar wasm/ e models/ localmente. */
const ASSET_BASE = new URL(".", import.meta.url).href;

/* =========================================================================
   OAZ Protetor Solar Stick — Provador Virtual
   Câmera ao vivo OU upload de foto. Tudo roda no navegador.
   ========================================================================= */

/* ---------- Cores REAIS medidas das swatches oficiais do OAZ ------------- */
/* color = cor do creme; cover = cobertura na pele (0..1), calibrada suave.  */
const SHADES = [
  { tone: "Cor 1", name: "Claro",       color: "#d3ac82", cover: 0.18, img: "refs/img/stick_cor1.png?v=9", stick: "refs/img/stick_cor1.png?v=9", buy: "https://www.oaz.vc/protetor-facial--solar-stick--cor1/p" },
  { tone: "Cor 2", name: "Médio Claro", color: "#c99676", cover: 0.20, img: "refs/img/stick_cor2.png?v=9", stick: "refs/img/stick_cor2.png?v=9", buy: "https://www.oaz.vc/protetor-facial--solar-stick-1/p" },
  { tone: "Cor 3", name: "Médio",       color: "#a97343", cover: 0.25, img: "refs/img/stick_cor3.png?v=9", stick: "refs/img/stick_cor3.png?v=9", buy: "https://www.oaz.vc/protetor-facial--solar-stick-cor3/p" },
  { tone: "Cor 4", name: "Escuro",      color: "#623e22", cover: 0.30, img: "refs/img/stick_cor4.png?v=9", stick: "refs/img/stick_cor4.png?v=9", buy: "https://www.oaz.vc/protetor-facial--solar-stick-cor4/p" },
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
  countdown: document.getElementById("countdown"),
  countNum:  document.getElementById("count-num"),
  flash:     document.getElementById("flash"),
  result:    document.getElementById("result"),
  resultImg: document.getElementById("result-img"),
  resRetake: document.getElementById("res-retake"),
  resSave:   document.getElementById("res-save"),
  resShare:  document.getElementById("res-share"),
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
  el.result.hidden = true;
  el.countdown.hidden = true;
  el.flash.hidden = true;
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
    card.style.setProperty("--tone", s.color);
    card.innerHTML = `
      <span class="smear"></span>
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
  const locked = activeIndex < 0;
  el.actSave.classList.toggle("locked", locked);
  el.actShare.classList.toggle("locked", locked);
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

  // Bastão encostado na base da imagem (canto inferior direito)
  if (img && img.complete && img.naturalWidth) {
    const ratio = img.naturalWidth / img.naturalHeight;
    const sh = Math.round(h * 0.42);
    const sw = Math.round(sh * ratio);
    const sx = w - m - sw;
    const sy = h - sh;                 // encosta na base
    o.save();
    o.shadowColor = "rgba(0,0,0,.35)";
    o.shadowBlur = Math.round(w * 0.03);
    o.shadowOffsetY = Math.round(-h * 0.004);
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

let capturing = false;

el.actSave.addEventListener("click", onCapture);

async function onCapture() {
  if (capturing) return;
  if (activeIndex < 0) { requireProduct(); return; }
  capturing = true;
  try {
    if (mode === "live") {
      await runCountdown();
      playShutter();
      await doFlash();
    }
    const url = captureDataURL();
    el.resultImg.src = url;
    el.result.hidden = false;
  } finally {
    capturing = false;
  }
}

/* Sem produto selecionado: avisa e destaca o seletor em vez de capturar. */
let toastTimer = null;
function requireProduct() {
  showToast("Selecione uma cor de produto para tirar a foto");
  if (el.shelf) {
    el.shelf.classList.remove("nudge");
    void el.shelf.offsetWidth;
    el.shelf.classList.add("nudge");
  }
}
function showToast(msg) {
  let t = document.getElementById("oaz-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "oaz-toast";
    t.className = "toast";
    (el.stage || document.body).appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* Contador 3·2·1 transparente sobre a imagem. */
function runCountdown() {
  return new Promise((resolve) => {
    const seq = [3, 2, 1];
    let i = 0;
    el.countdown.hidden = false;
    const step = () => {
      if (i >= seq.length) { el.countdown.hidden = true; resolve(); return; }
      el.countNum.textContent = seq[i];
      el.countNum.style.animation = "none"; void el.countNum.offsetWidth; el.countNum.style.animation = "";
      i++;
      setTimeout(step, 850);
    };
    step();
  });
}

/* Flash branco rápido da captura. */
function doFlash() {
  return new Promise((resolve) => {
    el.flash.hidden = false;
    el.flash.classList.add("go");
    setTimeout(() => { el.flash.classList.remove("go"); el.flash.hidden = true; resolve(); }, 360);
  });
}

/* Som real de obturador SLR (Nikon D70S) embutido em base64.
   Fonte: BigSoundBank (uso livre). Bem mais fiel que a sintese. */
const SHUTTER_DATA_URI = "data:audio/mpeg;base64,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G//jzRgVY+iVVnczM0MgEBAokgkQmNkoxhkAmwMFLJBgMmOqmDh48WFSoyJMUtSMCwhaSE4xJE56dE9BMZYbiGckHPMJQdQopZK2RdBtRAIBWGCVnwYKAL4A6giUNSRTWMT7ksKQcL0Ow27PgeS3qYpagWjWM68E1GvTjOIEbyrEoKQlo3kwpgqgZszgolBlaOx+JV7lR3IaqQfVQ/QfLsKoq/CwCWriUeMuzmonZp5+bh/P7kMEx0EBUdTJx67hwxLpZNau7ovpcX8zeSV28ec/i0UzCg1rqQcEPZp+43///7/vf///D+4d//5//dryzkru08Tf+fpN0////////vHO13Vz/////////////////3VzvVef//////////z//XP///H6btwDTEFNRTMuOTkuNQAAAAAA//u0xAAAoFHZLp2MgAQavONxrCK4WjZAAC6HiR/FUAYbgwKXlUaZKoa9mUGmg5qGsdXjEl6F1VYUCyZSXK2ukAgkxjn0OFg2yBoI3bExgeEZqxkmGmcoKFwDLWNNwFZRguSSApwImppDRIsmiorXMuo5UPNTUFQ9M4FGVS5N5B6OMfUFcWGnRgpfzuvEwl2qV0mZtxVWbcZCbdnU/D7RmNOml88sTf1qK+2oKKKvbFAz+NCpKOM5Ut9+Z6if74tDVZnUioInLJXIZJIqkPXIerT1idv2b9ntn6XOYldyvhnzuWPccquWNbLerut8xx/fO3s7Pcf138vy/ut6/nfy/n8/n///v//////////+5573qtV/OzHB0TfeEAATDTtMXKog5rRIdBKYISoKYc8akc5bDnJMGmAxYEBxUoXAMyYKAbEYqzIs8peYYihEACY8ZLLGVxQpTA1kHDqSfoEDWETqelrr2sGTmVRVhRBBzQqZLNgqwTQEimjqa3k9U4SzQoVf7EXJgBE5XTYUHSUAQFVZkz0l3WII/QWu1sa1XalctjjLmAuA12ij67X5X0y9BVMpatBD1trMUf6hsyl2Yo70AyGmoX9nmQtouqC2u0lq1TQDORq2/timtU1e8HwgiKAkGw9DkMBsVhmuIGitQ5pTtkodKHEuKkB8NBqIARDRYabDN7LFrTWsc//7X/+vt/DTYcmrQqK00ehylHMmIKaimZccnJcagAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//u0xAAD3MnQ7uwwXwgAADSAAAAECCQwQVc4MmrO80l2G+dmMQ7HofbVYZYFaCrkhXbR9Uqct5az/Jyo3BcAwUcEX/REURX605wYuwVL5RVWxV6dK5hwZUChMRTTgTOTpSGLmsyaM5b5O88L+M2TFRCWwpNktaHoBjkddJkTG2IM2a7NauHEgmBscrFRiXk8K4kj0J44E9AXHoTDSTCMTWr0nPWpm4qnwhAqDg7kUtLWmWWkNiOstQt0ueFoGoqM0B2tpvEfEkehOP1NrMuPb/rUI/NScSR6KiC7WB91ccpWH3I1sCoqtnq76/6Xslv8qOZRgIKQc1ECLcnTEFNRTMuOTkuNQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVEFHMjM5NAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDAwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJQ=";
let _shutterEl = null;
function getShutterEl() {
  if (!_shutterEl) { _shutterEl = new Audio(SHUTTER_DATA_URI); _shutterEl.preload = "auto"; }
  return _shutterEl;
}
/* Destrava o audio no primeiro toque (politicas de autoplay em mobile). */
function unlockShutter() {
  const a = getShutterEl();
  a.muted = true;
  const p = a.play();
  if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  else a.muted = false;
}
document.addEventListener("pointerdown", unlockShutter, { once: true });

function playShutter() {
  try {
    const a = getShutterEl().cloneNode();
    a.volume = 1;
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

el.resRetake.addEventListener("click", () => {
  el.result.hidden = true;
  if (mode === "photo") resetToChooser();
});

el.resSave.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = `oaz-stick-${activeIndex >= 0 ? SHADES[activeIndex].tone.replace(" ", "").toLowerCase() : "original"}.png`;
  a.href = el.resultImg.src;
  a.click();
});

el.resShare.addEventListener("click", async () => {
  try {
    const blob = await (await fetch(el.resultImg.src)).blob();
    const file = new File([blob], "oaz-stick.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "OAZ Protetor Solar Stick", text: "Meu tom no provador OAZ" });
    } else {
      const a = document.createElement("a"); a.download = "oaz-stick.png"; a.href = el.resultImg.src; a.click();
    }
  } catch (e) { console.warn("[OAZ] share cancelado/indisponível", e); }
});

el.actShare.addEventListener("click", async () => {
  if (activeIndex < 0) { requireProduct(); return; }
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
