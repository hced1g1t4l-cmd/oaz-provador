# OAZ Protetor Solar Stick — Provador Virtual

Provador de realidade aumentada **100% no navegador**: a pessoa abre a câmera (ou
envia uma foto) e testa as **4 cores** do Protetor Solar Stick Facial (FPS 70)
aplicadas como filtro na pele do rosto, em tempo real. Tira uma foto com contagem
3‑2‑1, flash e som de obturador, compara Antes/Depois e vai direto para a compra.

> **Privacidade:** todo o processamento (câmera, detecção de rosto, aplicação da
> cor) acontece no aparelho do usuário. **Nenhuma imagem é enviada ou armazenada.**

**Demo ao vivo:** https://hced1g1t4l-cmd.github.io/oaz-provador/

---

## Índice

1. [Rodar localmente](#rodar-localmente)
2. [Estrutura de arquivos](#estrutura-de-arquivos)
3. [Como funciona (arquitetura)](#como-funciona-arquitetura)
4. [Ajustes rápidos (o que mexer para cada coisa)](#ajustes-rápidos)
5. [Assets do MediaPipe (WASM + modelo)](#assets-do-mediapipe)
6. [Deploy no GitHub Pages](#deploy-no-github-pages)
7. [HTML standalone (1 arquivo)](#html-standalone)
8. [Compatibilidade e pegadinhas](#compatibilidade-e-pegadinhas)
9. [Próximos passos](#próximos-passos)

---

## Rodar localmente

A câmera (`getUserMedia`) só funciona em **HTTPS** ou em **localhost**. Rode um
servidor estático simples nesta pasta:

```bash
cd "21. OAZ Solar Stick Tryon"
python3 -m http.server 8000
```

Abra <http://localhost:8000> → **Experimentar cores** → **Permitir câmera**.

Não há etapa de build: é HTML/CSS/JS puro. Basta editar e recarregar.

---

## Estrutura de arquivos

```
21. OAZ Solar Stick Tryon/
├── index.html            # Página demo + modal do provador (marcação/UI)
├── style.css             # Todo o estilo, animações, pincelada, overlays
├── app.js                # Lógica: câmera, MediaPipe, máscara de pele, tint,
│                         #         Antes/Depois, captura (contagem/flash/som),
│                         #         seletor, compartilhamento
├── vision_bundle.js      # Runtime do MediaPipe tasks-vision v0.10.12 (local)
├── vision_bundle.mjs     # Mesmo bundle (cópia .mjs para dev; o app usa o .js)
├── wasm/                 # WASM do MediaPipe (SIMD e no-SIMD)
├── models/
│   └── face_landmarker.task   # Modelo de landmarks do rosto (~3,6 MB)
├── refs/
│   ├── img/
│   │   ├── stick_cor1..4.png  # Recortes PNG (sem fundo) dos bastões reais
│   │   ├── thumb_cor1..4.png  # Cópia legada (mesma imagem) p/ retrocompat.
│   │   ├── smear_mask.png     # Máscara da "pincelada" (branco s/ transparente)
│   │   └── cor*_N.png         # Recortes intermediários (experimentos, não usados)
│   └── audio/
│       ├── 2394.mp3           # Som real do obturador (Nikon D70S) — fonte do base64
│       └── 2394.ogg
├── build_standalone.py   # Gera o OAZ-Provador-Standalone.html (1 arquivo)
├── OAZ-Provador-Standalone.html  # Versão autocontida p/ compartilhar (WhatsApp etc.)
└── _site/                # Cópia publicada no GitHub Pages (repo oaz-provador)
```

> **Fonte da verdade = a pasta do projeto.** O `_site/` é o que vai pro GitHub
> Pages. Sempre copie os arquivos alterados para `_site/` antes de dar push
> (veja [Deploy](#deploy-no-github-pages)).

---

## Como funciona (arquitetura)

Pipeline por frame (função `render()` em `app.js`):

1. **Fonte → canvas com recorte "cover" (`fitSource`/`drawBase`).**
   O vídeo/foto é recortado para um retângulo fixo **3:4** e desenhado no
   `<canvas>`. Isso garante que a linha do divisor Antes/Depois (DOM) fique
   **alinhada** com o filtro (canvas), independente do tamanho real da câmera.

2. **Detecção de rosto (`ensureModel` + MediaPipe Face Landmarker).**
   `numFaces: 1`, `runningMode: "VIDEO"`. Retorna 468 landmarks normalizados.

3. **Máscara da pele (`buildSkinPath`).**
   Constrói um `Path2D` com o contorno do rosto (`FACE_OVAL`) e **subtrai**
   olhos e boca (`LEFT_EYE`, `RIGHT_EYE`, `LIPS`), usando `evenodd`. Os
   landmarks são mapeados do espaço da fonte para o espaço recortado do canvas.

4. **Aplicação da cor (`applyTint`).**
   - Pinta a cor do tom (`shade.color`) num canvas auxiliar, recorta pela
     máscara da pele (`destination-in`).
   - Desenha sobre o vídeo com `globalAlpha = shade.cover` (cobertura por tom).
   - Um leve `multiply` a `globalAlpha = 0.08` dá profundidade.

5. **Assinatura do produto na foto (`drawSignature`).**
   Desenha o bastão selecionado encostado na base, canto inferior direito
   (altura ≈ 42% do frame).

6. **Antes/Depois (`splitMode` + `#divider`).**
   Divisor vertical arrastável; à esquerda a imagem original, à direita o filtro.

7. **Captura (`onCapture` → `runCountdown` → `doFlash` → `playShutter`).**
   Contagem **3‑2‑1** transparente, **flash** branco, **som de obturador** real
   e exibe a foto composta (`buildCompositeCanvas`) no overlay de resultado.

Estados principais: `mode` (`"live"`/`"photo"`), `activeIndex` (‑1 = "Sem
produto"), `splitMode`, `capturing`.

---

## Ajustes rápidos

Tudo abaixo é editável sem build. Depois de editar, **recarregue** (e, no deploy,
suba o `?v=` de cache — veja Deploy).

### Cores / cobertura dos tons
Array `SHADES` no topo do `app.js`:

```js
const SHADES = [
  { tone: "Cor 1", name: "Claro", color: "#d3ac82", cover: 0.18,
    img: "refs/img/stick_cor1.png?v=9", stick: "refs/img/stick_cor1.png?v=9",
    buy: "https://www.oaz.vc/.../p" },
  // ...
];
```

- `color` → cor do creme aplicada na pele.
- `cover` → intensidade (0..1). Maior = mais cobertura.
- `buy` → link do e‑commerce para o botão **Compre Agora** daquele tom.
- `img`/`stick` → imagem do bastão (seletor, canto fixado, card, e a "assinatura"
  na foto).

### Intensidade global do filtro
Função `applyTint()` em `app.js`:
- `ctx.globalAlpha = shade.cover;` (camada de cor principal).
- `ctx.globalAlpha = 0.08;` no bloco `multiply` (profundidade). Suba/baixe para
  mais/menos efeito.

### Pincelada colorida atrás do bastão (seletor)
- **Cor:** vem de `--tone` (definido por card em `buildShelf`, = `s.color`).
- **Textura/forma:** `refs/img/smear_mask.png` (máscara branca em fundo
  transparente), usada como `mask` no CSS `.stick-card .smear`.
- **Regenerar a textura** (exemplo com Pillow):

```python
from PIL import Image, ImageDraw, ImageFilter
import random, math
W, H = 480, 260
m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
# ... desenhe traços/estrias horizontais afinando nas pontas ...
m.filter(ImageFilter.GaussianBlur(2.2)).save("refs/img/smear_mask.png")
```
Posição/ângulo/opacidade: regras `.stick-card .smear` no `style.css`.

### Imagens dos bastões
São **recortes PNG sem fundo** (`refs/img/stick_corN.png`). Para trocar por novas
fotos, gere PNGs com fundo transparente e mantenha os nomes (ou atualize os
caminhos em `SHADES`). Para "assinar" a foto sem cortar, o `drawSignature` usa a
mesma imagem encostada na base (ajuste `sh = Math.round(h * 0.42)` para o tamanho).

### Som do obturador
Está **embutido em base64** no `app.js` (`SHUTTER_DATA_URI`) — funciona offline e
no standalone. Para trocar por outro som:

```bash
# baixe um .mp3 curto e gere o base64
python3 -c "import base64;print(base64.b64encode(open('novo.mp3','rb').read()).decode())"
```
Cole no lugar do valor de `SHUTTER_DATA_URI`. Há um "destravamento" no primeiro
toque (`unlockShutter`) para contornar autoplay em mobile.

### Contagem regressiva
Função `runCountdown()`: `const seq = [3, 2, 1];` e o `setTimeout(step, 850)`
(ms por número). Estilos em `style.css` (`.countdown`, `#count-num`).

### Bloqueio "sem produto"
Sem tom selecionado (`activeIndex < 0`), **captura e compartilhamento são
bloqueados** com aviso (`requireProduct` → `showToast` + shake do seletor). Os
botões ficam esmaecidos (`.act.locked`). Remova as guardas em `onCapture` e no
listener de `actShare` se quiser permitir foto sem cor.

### Textos e rótulos
Direto no `index.html` (títulos, botões "Testar ao vivo", "Compre Agora", nome do
produto no card, etc.). Nomes dos tons no seletor: campo `tone` em `SHADES`.

---

## Assets do MediaPipe

Runtime e modelo são **hospedados localmente** (`vision_bundle.js`, `wasm/`,
`models/face_landmarker.task`) para carregar rápido e não depender de CDN externo
que pode estar bloqueado/instável.

- `app.js` importa de `./vision_bundle.js` e resolve `wasm/` e `models/` via
  `ASSET_BASE` (a própria pasta).
- **Atualizar versão:** baixe o `vision_bundle`, os `wasm/*` e o `.task` do
  jsDelivr (`@mediapipe/tasks-vision@<versão>`) e substitua os arquivos.

> O **standalone** e a demo pública usam CDN para esses assets (ver
> `build_standalone.py`), porque um único arquivo não pode embutir o `.task`
> de forma prática.

---

## Deploy no GitHub Pages

O repositório publicado é a pasta **`_site/`** (remoto: `oaz-provador`, branch
`main`, servido em `https://hced1g1t4l-cmd.github.io/oaz-provador/`).

Passos para publicar uma alteração:

```bash
cd "21. OAZ Solar Stick Tryon"

# 1) suba o cache-buster nos links do index.html (evita cache velho no navegador)
#    ex.: style.css?v=13 -> v=14 e app.js?v=13 -> v=14
sed -i '' 's/style.css?v=13/style.css?v=14/; s/app.js?v=13/app.js?v=14/' index.html

# 2) copie os arquivos alterados para o _site
cp index.html app.js style.css vision_bundle.js _site/
cp refs/img/smear_mask.png _site/refs/img/    # se mexeu na pincelada
# (copie também refs/img/stick_*.png, models/, wasm/ se mudaram)

# 3) commit + push
cd _site && git add -A && git commit -m "..." && git push
```

A publicação leva ~1 min para propagar.

> ### ⚠️ Pegadinha importante — módulo `.mjs` no GitHub Pages
> O `app.js` **deve** importar `./vision_bundle.js` (não `.mjs`). O GitHub Pages
> serve `.js` com `Content-Type: application/javascript`; arquivos `.mjs` podem vir
> com MIME errado e o navegador recusa o módulo → **o app inteiro não carrega e o
> botão "Experimentar cores" não faz nada.** Por isso mantemos o bundle como
> `vision_bundle.js` no deploy. O `.nojekyll` (já presente) evita o Jekyll ignorar
> pastas/arquivos.

---

## HTML standalone

`OAZ-Provador-Standalone.html` é uma versão **de um único arquivo** (CSS/JS
embutidos, imagens e som em base64, MediaPipe via CDN). Serve para compartilhar
direto (WhatsApp, e‑mail). **Lembre:** a câmera só abre via HTTPS/localhost — ao
abrir por `file://` o navegador não libera a câmera.

Regerar depois de alterar `index.html`/`style.css`/`app.js`:

```bash
python3 build_standalone.py
```

O script transforma: máscara da pincelada → data URI; imagens dos bastões → data
URIs; imports do MediaPipe → CDN; e injeta CSS/JS inline. O som já está embutido.

---

## Compatibilidade e pegadinhas

- **HTTPS obrigatório** para câmera (ou `localhost`). O GitHub Pages já é HTTPS.
- **iOS/Safari:** o `<video>` usa `playsinline`, `webkit-playsinline`, `muted`,
  `autoplay`. Sem isso o vídeo abre em tela cheia ou não toca.
- **Autoplay de áudio (mobile):** o som só toca após interação; `unlockShutter`
  destrava no primeiro `pointerdown`.
- **Layout responsivo:** usa `dvh` + `env(safe-area-inset-*)` e limita a largura
  do modal em telas baixas (iPhone/Samsung/desktop).
- **Cache:** sempre suba o `?v=` ao publicar; a demo tem meta tags anti‑cache.
- **Permissão negada:** se o usuário bloquear a câmera, é preciso reabilitar nas
  configurações do navegador (mostramos mensagem de erro na tela de permissão).

---

## Próximos passos

1. Fotos/render de alta qualidade dos 4 bastões (ou 3D).
2. Domínio próprio (custom domain) para a URL/permissão aparecerem como "OAZ".
3. Embed no site oficial via `<iframe>` (ou script).
4. (Opcional) Trocar o pipeline por um SDK de AR (DeepAR/Banuba/ModiFace) para
   realismo fotográfico de campanha.
5. Métricas de uso (tons mais provados, cliques em "Compre Agora").
