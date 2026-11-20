const fileInput = document.getElementById('fileInput');
const canvas = document.getElementById('canvas');
const emptyHint = document.getElementById('emptyHint');
const canvasWrap = document.getElementById('canvasWrap');
const ctx = canvas.getContext('2d');
// 智慧選取／黑色線條偵測／邊緣偵測都要用「乾淨、沒有疊圖」的像素顏色去判斷，但
// 看得到的 canvas 上面疊了描邊線條、座標點、藍色預覽圈這些畫面標記，如果直接從它
// 身上 getImageData，顏色判斷就會被這些標記污染（尤其是連續用好幾次智慧選取時，
// 上一次畫的紅線、藍點會被下一次誤判成圖案的一部分）。這裡另外準備一張只畫原圖、
// 沒有任何標記的離屏畫布，專門給顏色取樣用。
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', {willReadFrequently: true});
function refreshSampleCanvas() {
  if (!img) return;
  const workScale = Math.min(1, 360 / img.naturalWidth);
  sampleCanvas.width = Math.max(1, Math.round(img.naturalWidth * workScale));
  sampleCanvas.height = Math.max(1, Math.round(img.naturalHeight * workScale));
  sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
  sampleCtx.drawImage(img, 0, 0, sampleCanvas.width, sampleCanvas.height);
}
const coordsList = document.getElementById('coordsList');
const exportBox = document.getElementById('exportBox');
const statusMsg = document.getElementById('statusMsg');
const closeToggle = document.getElementById('closeToggle');
const previewCanvas = document.getElementById('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');
const previewWrap = document.getElementById('previewWrap');
const previewEmpty = document.getElementById('previewEmpty');

let showLines = false;

const boundaryPreviewCanvas = document.getElementById('boundaryPreviewCanvas');
const boundaryPreviewCtx = boundaryPreviewCanvas.getContext('2d');
const boundaryPreviewWrap = document.getElementById('boundaryPreviewWrap');
const boundaryPreviewEmpty = document.getElementById('boundaryPreviewEmpty');

function renderBoundaryPreview() {
  const boundaryPoints = boundaryRel();
  const hasPoints = points.length > 0;
  const hasBoundary = boundaryPoints.length >= 3;
  if (!hasPoints && !hasBoundary) {
    boundaryPreviewCanvas.style.display = 'none';
    boundaryPreviewEmpty.style.display = 'block';
    return;
  }
  boundaryPreviewEmpty.style.display = 'none';
  boundaryPreviewCanvas.style.display = 'block';

  const size = Math.max(140, Math.min(boundaryPreviewWrap.clientWidth - 16, 420));
  boundaryPreviewCanvas.width = size;
  boundaryPreviewCanvas.height = size;
  boundaryPreviewCtx.clearRect(0, 0, size, size);
  boundaryPreviewCtx.fillStyle = 'rgba(128,128,128,0.08)';
  boundaryPreviewCtx.fillRect(0, 0, size, size);

  const relPoints = hasPoints ? points.map(toRelPoint) : [];
  const allXs = [], allYs = [];
  if (hasPoints) {relPoints.forEach(p => {allXs.push(p[0]); allYs.push(p[1]);});}
  if (hasBoundary) {boundaryPoints.forEach(p => {allXs.push(p[0]); allYs.push(p[1]);});}
  const minX = Math.min(...allXs), maxX = Math.max(...allXs);
  const minY = Math.min(...allYs), maxY = Math.max(...allYs);
  const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
  const pad = 20;
  const scale = Math.min((size - 2 * pad) / w, (size - 2 * pad) / h);
  const offsetX = (size - w * scale) / 2;
  const offsetY = (size - h * scale) / 2;
  function toPrev(p) {
    return [offsetX + (p[0] - minX) * scale, offsetY + (p[1] - minY) * scale];
  }

  if (hasBoundary) {
    boundaryPreviewCtx.save();
    boundaryPreviewCtx.strokeStyle = '#a855f7';
    boundaryPreviewCtx.setLineDash([6, 4]);
    boundaryPreviewCtx.lineWidth = 2;
    boundaryPreviewCtx.fillStyle = 'rgba(168,85,247,0.08)';
    boundaryPreviewCtx.beginPath();
    boundaryPoints.forEach((p, i) => {
      const [dx, dy] = toPrev(p);
      if (i === 0) boundaryPreviewCtx.moveTo(dx, dy); else boundaryPreviewCtx.lineTo(dx, dy);
    });
    boundaryPreviewCtx.closePath();
    boundaryPreviewCtx.fill();
    boundaryPreviewCtx.stroke();
    boundaryPreviewCtx.restore();
  }

  if (hasPoints) {
    boundaryPreviewCtx.fillStyle = 'rgba(122,176,255,0.85)';
    relPoints.forEach(p => {
      const [dx, dy] = toPrev(p);
      boundaryPreviewCtx.beginPath();
      boundaryPreviewCtx.arc(dx, dy, 1.6, 0, Math.PI * 2);
      boundaryPreviewCtx.fill();
    });
  }

  if (hasPoints && hasBoundary) {
    const allInside = relPoints.every(p => pointInPolygon(p[0], p[1], boundaryPoints));
    const [bx0, by0] = toPrev([Math.min(...relPoints.map(p => p[0])), Math.min(...relPoints.map(p => p[1]))]);
    const [bx1, by1] = toPrev([Math.max(...relPoints.map(p => p[0])), Math.max(...relPoints.map(p => p[1]))]);
    boundaryPreviewCtx.save();
    boundaryPreviewCtx.strokeStyle = allInside ? '#1d9e75' : '#e24b4a';
    boundaryPreviewCtx.lineWidth = 1.5;
    boundaryPreviewCtx.setLineDash([4, 3]);
    boundaryPreviewCtx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    boundaryPreviewCtx.restore();
  }
}

function renderPreview() {
  renderPointsPreview(previewCanvas, previewCtx, previewWrap, previewEmpty);
  updateHeroStats();
  redraw();
  renderBoundaryPreview();
}

document.getElementById('toggleGapLineBtn').addEventListener('click', () => {
  showLines = !showLines;
  document.getElementById('toggleGapLineLabel').textContent = showLines ? '隱藏連接線／警示線' : '顯示連接線／警示線';
  renderPreview();
});

let img = null;
let points = []; // natural-image pixel coordinates
let exportMode = 'json';

function loadImageFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    statusMsg.textContent = '請上傳圖片檔案（png、jpg等）。';
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const image = new Image();
    image.onload = () => {
      img = image;
      origin = {x: Math.round(img.naturalWidth / 2), y: Math.round(img.naturalHeight / 2)};
      points = [];
      pendingPoints = null;
      selectedPointIndex = -1;
      resetSelectionMask();
      showSelectionPreviewRow(false);
      showView('work');
      resetLayers();
      clearHistory();
      resetView();
      clearDetections();
      setupCanvas();
      redraw();
      updateOutputs();
      openWin('win-detect');
    };
    image.onerror = () => {
      statusMsg.textContent = '圖片讀取失敗，請換一張試試。';
    };
    image.src = ev.target.result;
  };
  reader.onerror = () => {
    statusMsg.textContent = '檔案讀取失敗。';
  };
  reader.readAsDataURL(file);
}

function transformImage(rotateDeg, flipH, flipV) {
  if (!img) return;
  const swapDims = (((rotateDeg % 360) + 360) % 180) !== 0;
  const off = document.createElement('canvas');
  off.width = swapDims ? img.naturalHeight : img.naturalWidth;
  off.height = swapDims ? img.naturalWidth : img.naturalHeight;
  const octx = off.getContext('2d');
  octx.save();
  octx.translate(off.width / 2, off.height / 2);
  octx.rotate(rotateDeg * Math.PI / 180);
  octx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  octx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  octx.restore();
  const newImg = new Image();
  newImg.onload = () => {
    img = newImg;
    origin = {x: Math.round(img.naturalWidth / 2), y: Math.round(img.naturalHeight / 2)};
    points = [];
    resetSelectionMask();
    resetLayers();
    clearHistory();
    resetView();
    clearDetections();
    setupCanvas();
    redraw();
    updateOutputs();
    statusMsg.textContent = '已調整圖片方向，原本的描邊座標已清除，請重新描邊。';
  };
  newImg.src = off.toDataURL();
}

document.getElementById('rotate180Btn').addEventListener('click', () => transformImage(180, false, false));
document.getElementById('rotateLeftBtn').addEventListener('click', () => transformImage(-90, false, false));
document.getElementById('rotateRightBtn').addEventListener('click', () => transformImage(90, false, false));
document.getElementById('flipHBtn').addEventListener('click', () => transformImage(0, true, false));
document.getElementById('flipVBtn').addEventListener('click', () => transformImage(0, false, true));

fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  loadImageFile(file);
});

['dragenter', 'dragover'].forEach(evt => {
  canvasWrap.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    canvasWrap.classList.add('drag-over');
  });
});
['dragleave', 'dragend'].forEach(evt => {
  canvasWrap.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    canvasWrap.classList.remove('drag-over');
  });
});
canvasWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  canvasWrap.classList.remove('drag-over');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadImageFile(file);
});

let isCanvasFullscreen = false;

let fullscreenPlaceholder = null;

document.getElementById('toggleFullscreenBtn').addEventListener('click', () => {
  if (!world) {
    statusMsg.textContent = '畫面上還沒有圖片或座標可以放大檢視。';
    return;
  }
  isCanvasFullscreen = true;
  // .layout-left 是 position: sticky，會自己形成一個獨立的堆疊層，就算把 canvas-wrap
  // 設成 position:fixed 加很高的 z-index，也只會在那個堆疊層「裡面」最上面，一樣會被
  // 旁邊 .layout-right 的功能列整個蓋過去。這裡直接把 canvas-wrap 這個節點搬到
  // <body> 底下、脫離那個堆疊層，才能真的蓋到最上面；關閉時再搬回原本的位置。
  fullscreenPlaceholder = document.createComment('canvas-wrap-placeholder');
  canvasWrap.parentNode.insertBefore(fullscreenPlaceholder, canvasWrap);
  document.body.appendChild(canvasWrap);
  canvasWrap.classList.add('fullscreen-view');
  document.getElementById('closeFullscreenBtn').style.display = 'inline-block';
  document.body.style.overflow = 'hidden';
  setupCanvas();
  redraw();
});

function exitFullscreenCanvas() {
  if (!isCanvasFullscreen) return;
  isCanvasFullscreen = false;
  canvasWrap.classList.remove('fullscreen-view');
  document.getElementById('closeFullscreenBtn').style.display = 'none';
  document.body.style.overflow = '';
  if (fullscreenPlaceholder && fullscreenPlaceholder.parentNode) {
    fullscreenPlaceholder.parentNode.insertBefore(canvasWrap, fullscreenPlaceholder);
    fullscreenPlaceholder.remove();
    fullscreenPlaceholder = null;
  }
  if (world) {setupCanvas(); redraw();}
}
document.getElementById('closeFullscreenBtn').addEventListener('click', exitFullscreenCanvas);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exitFullscreenCanvas();
});

let pendingPoints = null;
let pendingClose = false;

function showSelectionPreviewRow(show) {
  document.getElementById('selectionPreviewRow').style.display = show ? 'flex' : 'none';
}

let mode = 'select';
let origin = {x: 0, y: 0};
let prevMode = 'manual';
let boundaryPoints = [];

function colorDist(data, idx, r0, g0, b0) {
  const dr = Math.abs(data[idx] - r0), dg = Math.abs(data[idx + 1] - g0), db = Math.abs(data[idx + 2] - b0);
  return Math.max(dr, dg, db);
}

function magicWandSelect(imgData, w, h, startX, startY, tolerance) {
  const data = imgData.data;
  const startIdx = (startY * w + startX) * 4;
  const r0 = data[startIdx], g0 = data[startIdx + 1], b0 = data[startIdx + 2];
  const mask = new Uint8Array(w * h);
  const stack = [[startX, startY]];
  mask[startY * w + startX] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (mask[nIdx]) continue;
      const di = nIdx * 4;
      if (colorDist(data, di, r0, g0, b0) <= tolerance) {
        mask[nIdx] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  return mask;
}

function detectBackgroundMask(imgData, w, h, tolerance) {
  const data = imgData.data;
  const r0 = data[0], g0 = data[1], b0 = data[2], a0 = data[3];
  const isTransparentRef = a0 < 10;
  const mask = new Uint8Array(w * h);
  const stack = [];
  function matches(di) {
    if (isTransparentRef) return data[di + 3] < 10;
    return colorDist(data, di, r0, g0, b0) <= tolerance;
  }
  function seed(x, y) {
    const idx = y * w + x;
    if (mask[idx]) return;
    const di = idx * 4;
    if (matches(di)) {mask[idx] = 1; stack.push([x, y]);}
  }
  for (let x = 0; x < w; x++) {seed(x, 0); seed(x, h - 1);}
  for (let y = 0; y < h; y++) {seed(0, y); seed(w - 1, y);}
  while (stack.length) {
    const [x, y] = stack.pop();
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (mask[nIdx]) continue;
      const di = nIdx * 4;
      if (matches(di)) {mask[nIdx] = 1; stack.push([nx, ny]);}
    }
  }
  return mask;
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function detectBlackMask(imgData, w, h, threshold) {
  const data = imgData.data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const di = i * 4;
    if (data[di + 3] < 100) continue;
    if (luminance(data[di], data[di + 1], data[di + 2]) <= threshold) mask[i] = 1;
  }
  return mask;
}

function sobelEdgeMask(imgData, w, h, threshold) {
  const data = imgData.data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const di = i * 4;
    lum[i] = data[di + 3] < 100 ? 255 : luminance(data[di], data[di + 1], data[di + 2]);
  }
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const tl = lum[idx - w - 1], tc = lum[idx - w], tr = lum[idx - w + 1];
      const ml = lum[idx - 1], mr = lum[idx + 1];
      const bl = lum[idx + w - 1], bc = lum[idx + w], br = lum[idx + w + 1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag >= threshold) mask[idx] = 1;
    }
  }
  return mask;
}

function findComponents(mask, w, h, minSize) {
  const visited = new Uint8Array(w * h);
  const components = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || visited[idx]) continue;
      const compMask = new Uint8Array(w * h);
      const stack = [[x, y]];
      visited[idx] = 1;
      compMask[idx] = 1;
      let count = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1], [cx + 1, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (!mask[nIdx] || visited[nIdx]) continue;
          visited[nIdx] = 1;
          compMask[nIdx] = 1;
          count++;
          stack.push([nx, ny]);
        }
      }
      if (count >= minSize) components.push({mask: compMask, count});
    }
  }
  components.sort((a, b) => b.count - a.count);
  return components;
}

function traceContourFrom(mask, w, h, startX, startY) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let backtrackDir = 4;
  for (let i = 0; i < 8; i++) {
    const nx = startX + dirs[i][0], ny = startY + dirs[i][1];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
      backtrackDir = i;
      break;
    }
  }
  const contour = [{x: startX, y: startY}];
  let curr = {x: startX, y: startY};
  const maxSteps = w * h * 4;
  for (let steps = 0; steps < maxSteps; steps++) {
    let found = null, foundDir = -1;
    for (let i = 1; i <= 8; i++) {
      const dirIdx = (backtrackDir + i) % 8;
      const nx = curr.x + dirs[dirIdx][0];
      const ny = curr.y + dirs[dirIdx][1];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) {
        found = {x: nx, y: ny};
        foundDir = dirIdx;
        break;
      }
    }
    if (!found) break;
    backtrackDir = (foundDir + 4) % 8;
    curr = found;
    contour.push(curr);
    if (curr.x === startX && curr.y === startY && contour.length > 2) break;
  }
  return contour;
}

function traceContour(mask, w, h) {
  let startX = -1, startY = -1;
  outer:
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {startX = x; startY = y; break outer;}
    }
  }
  if (startX === -1) return [];
  return traceContourFrom(mask, w, h, startX, startY);
}

function isMaskBoundary(mask, w, h, x, y) {
  if (!mask[y * w + x]) return false;
  const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1], [x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]];
  for (const [nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
    if (!mask[ny * w + nx]) return true;
  }
  return false;
}

function traceAllContours(mask, w, h) {
  const visited = new Uint8Array(w * h);
  const contours = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] && !visited[idx] && isMaskBoundary(mask, w, h, x, y)) {
        const contour = traceContourFrom(mask, w, h, x, y);
        if (contour.length >= 3) {
          contours.push(contour);
          contour.forEach(p => {visited[p.y * w + p.x] = 1;});
        } else {
          visited[idx] = 1;
        }
      }
    }
  }
  return contours;
}

function perpendicularDistance(p, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return Math.hypot(p.x - p1.x, p.y - p1.y);
  const u = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / (mag * mag);
  const ix = p1.x + u * dx, iy = p1.y + u * dy;
  return Math.hypot(p.x - ix, p.y - iy);
}

function simplifyPath(pts, epsilon) {
  if (pts.length < 3) return pts;
  let dmax = 0, index = 0;
  const p1 = pts[0], p2 = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], p1, p2);
    if (d > dmax) {dmax = d; index = i;}
  }
  if (dmax > epsilon) {
    const left = simplifyPath(pts.slice(0, index + 1), epsilon);
    const right = simplifyPath(pts.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [p1, p2];
}

function resampleBySpacing(pts, spacing) {
  if (pts.length < 2) return pts;
  const result = [pts[0]];
  let last = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - last.x, pts[i].y - last.y);
    if (d >= spacing) {
      result.push(pts[i]);
      last = pts[i];
    }
  }
  return result;
}

function fillSampleMask(mask, w, h, spacing) {
  const step = Math.max(1, spacing);
  const pts = [];
  for (let y = 0; y < h; y += step) {
    const yi = Math.round(y);
    if (yi >= h) continue;
    for (let x = 0; x < w; x += step) {
      const xi = Math.round(x);
      if (xi >= w) continue;
      if (mask[yi * w + xi]) pts.push({x: xi, y: yi});
    }
  }
  return pts;
}

function thinMask(mask, w, h) {
  const arr = new Uint8Array(mask);
  function get(x, y) {return (x >= 0 && y >= 0 && x < w && y < h) ? arr[y * w + x] : 0;}
  function countTransitionsAndSum(x, y) {
    const n = [get(x, y - 1), get(x + 1, y - 1), get(x + 1, y), get(x + 1, y + 1), get(x, y + 1), get(x - 1, y + 1), get(x - 1, y), get(x - 1, y - 1)];
    let B = 0; for (let i = 0; i < 8; i++) B += n[i];
    let A = 0; for (let i = 0; i < 8; i++) if (n[i] === 0 && n[(i + 1) % 8] === 1) A++;
    return {n, B, A};
  }
  let changed = true;
  let guard = 0;
  while (changed && guard < 200) {
    guard++;
    changed = false;
    let toDelete = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!get(x, y)) continue;
        const {n, B, A} = countTransitionsAndSum(x, y);
        if (B < 2 || B > 6 || A !== 1) continue;
        const [p2, , p4, , p6, , p8] = n;
        if (p2 * p4 * p6 !== 0) continue;
        if (p4 * p6 * p8 !== 0) continue;
        toDelete.push(y * w + x);
      }
    }
    if (toDelete.length) {toDelete.forEach(i => arr[i] = 0); changed = true;}
    toDelete = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!get(x, y)) continue;
        const {n, B, A} = countTransitionsAndSum(x, y);
        if (B < 2 || B > 6 || A !== 1) continue;
        const [p2, , p4, , p6, , p8] = n;
        if (p2 * p4 * p8 !== 0) continue;
        if (p2 * p6 * p8 !== 0) continue;
        toDelete.push(y * w + x);
      }
    }
    if (toDelete.length) {toDelete.forEach(i => arr[i] = 0); changed = true;}
  }
  return arr;
}

// 把細化後只剩單一像素寬的骨架，排成一條有順序的路徑，而不是直接在整張
// 遮罩上打格子取樣（格子取樣對只有 1px 寬的線命中率很低，容易漏點；對還沒
// 細化的原始粗邊框則會把整段寬度都取進來，變成粗線)。細化後的骨架在尖角、
// 凹角處常會留下很短的小分岔，單純沿 8-鄰接走容易卡在分岔裡出不來，所以改用
// 「每一步找最近的下一個還沒走過的骨架像素」最近鄰排序，遇到小分岔也只是順路
// 繞一下，不會整條路徑斷在那裡。
// 細化後的骨架在尖角（像這次角尖那種很銳利的頂點）很容易長出一小截多餘的分岔
// （spur），雖然只有幾個像素，但最近鄰排序法走到那邊時會在原地來回跳，疊出一小
// 球亂糟糟的點，就是預覽圖上紅圈那種糾結。這裡先把那些很短的分岔修剪掉，再排序。
function pruneSkeletonSpurs(mask, w, h, maxSpurLen) {
  const arr = new Uint8Array(mask);
  function neighborsOf(x, y, excludeX, excludeY) {
    const n = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx === excludeX && ny === excludeY) continue;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && arr[ny * w + nx]) n.push([nx, ny]);
      }
    }
    return n;
  }
  let guard = 0, changed = true;
  while (changed && guard < 15) {
    guard++;
    changed = false;
    const endpoints = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (arr[y * w + x] && neighborsOf(x, y, -1, -1).length === 1) endpoints.push([x, y]);
      }
    }
    for (const [sx, sy] of endpoints) {
      if (!arr[sy * w + sx]) continue;
      let cx = sx, cy = sy, prevx = -1, prevy = -1;
      const path = [[cx, cy]];
      let hitBranch = false, deadEnd = false;
      for (let step = 0; step < maxSpurLen; step++) {
        const neigh = neighborsOf(cx, cy, prevx, prevy);
        if (neigh.length === 0) {deadEnd = true; break;}
        if (neigh.length >= 2) {hitBranch = true; break;}
        prevx = cx; prevy = cy;
        [cx, cy] = neigh[0];
        path.push([cx, cy]);
      }
      if ((hitBranch || deadEnd) && path.length <= maxSpurLen) {
        path.forEach(([px, py]) => {arr[py * w + px] = 0;});
        changed = true;
      }
    }
  }
  return arr;
}

function orderSkeletonPath(mask, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) pts.push({x, y});
    }
  }
  if (pts.length <= 2) return pts;

  const used = new Uint8Array(pts.length);
  const ordered = [pts[0]];
  used[0] = 1;
  let currIdx = 0;
  for (let step = 1; step < pts.length; step++) {
    const cx = pts[currIdx].x, cy = pts[currIdx].y;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      const dx = pts[i].x - cx, dy = pts[i].y - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {bestDist = d; bestIdx = i;}
    }
    if (bestIdx === -1) break;
    used[bestIdx] = 1;
    ordered.push(pts[bestIdx]);
    currIdx = bestIdx;
  }
  return ordered;
}

// 細化模式（只取中心線）下，改用「沿骨架路徑走訪＋依距離等間隔抽樣」取點；
// 非細化模式則維持原本的格子取樣（這樣環狀線條的內外圈才都不會漏掉）。
function sampleMaskPoints(mask, w, h, spacing, isCenterline) {
  if (isCenterline) {
    const pruned = pruneSkeletonSpurs(mask, w, h, 8);
    const ordered = orderSkeletonPath(pruned, w, h);
    return resampleBySpacing(ordered, spacing);
  }
  return fillSampleMask(mask, w, h, spacing);
}

function pathLength(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
  }
  return total;
}

function getTargetCount() {
  const v = Number(document.getElementById('targetCountInput').value);
  return (v && v > 0) ? v : null;
}

function resolveSpacingForContour(contourPts) {
  const targetCount = getTargetCount();
  if (targetCount) {
    const len = pathLength(contourPts);
    return Math.max(1, len / targetCount);
  }
  return Number(document.getElementById('spacingSlider').value) || 3;
}

function resolveSpacingForMask(maskPixelCount) {
  const targetCount = getTargetCount();
  if (targetCount) {
    return Math.max(1, Math.sqrt(maskPixelCount / targetCount));
  }
  return Number(document.getElementById('spacingSlider').value) || 3;
}

// ---- 智慧選取／一鍵選取外框：比照 Photoshop 的選取範圍疊加方式 ----
// 一般點一下＝取代目前選取；按住 Shift 再點＝加入（聯集）；按住 Alt／Option 再點＝
// 減去（差集）；Shift+Alt 一起按＝只留交集。跟 PS 一樣是點下去就立即生效，不用
// 再按「套用」確認。
let selectionMask = null;
let selectionMaskW = 0, selectionMaskH = 0;

function getCombineMode(e) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.altKey) return 'subtract';
  if (e.shiftKey) return 'union';
  return 'replace';
}

function combineModeLabel(mode) {
  return {replace: '選取（取代）', union: '加入選取（Shift）', subtract: '減去選取（Alt）', intersect: '交集選取（Shift+Alt）'}[mode] || mode;
}

function combineSelectionMask(newMask, w, h, mode) {
  if (!selectionMask || selectionMaskW !== w || selectionMaskH !== h) {
    selectionMask = new Uint8Array(w * h);
    selectionMaskW = w; selectionMaskH = h;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const cur = selectionMask[i], nw = newMask[i];
    let v;
    if (mode === 'replace') v = nw;
    else if (mode === 'union') v = (cur || nw) ? 1 : 0;
    else if (mode === 'subtract') v = (cur && !nw) ? 1 : 0;
    else /* intersect */ v = (cur && nw) ? 1 : 0;
    out[i] = v;
  }
  selectionMask = out;
  return out;
}

function resetSelectionMask() {
  selectionMask = null;
  selectionMaskW = 0; selectionMaskH = 0;
}

// 把合併後的選取遮罩變成最終座標：實心填滿就整塊格子取樣；否則找出所有獨立區塊，
// 每一塊各自描邊再簡化、等距抽樣，最後接在一起（減去／交集後可能變成好幾塊分開的
// 區域，所以不能只描第一塊）。
function pointsFromSelectionMask(mask, w, h) {
  const fillMode = document.getElementById('fillModeToggle').checked;
  if (fillMode) {
    const maskCount = mask.reduce((a, b) => a + b, 0);
    if (maskCount < 1) return {pts: [], close: false};
    const fillN = getTargetCount();
    const filled = fillN
      ? fitToCount(sp => fillSampleMask(mask, w, h, sp), fillN)
      : fillSampleMask(mask, w, h, resolveSpacingForMask(maskCount));
    return {pts: filled.map(p => workToNatural(p.x, p.y)), close: false};
  }
  const comps = findComponents(mask, w, h, Number(document.getElementById('minSizeSlider').value) || 5);
  if (comps.length === 0) return {pts: [], close: false};
  const contourPaths = [];
  for (const comp of comps) {
    const contour = traceContour(comp.mask, w, h);
    if (contour.length < 3) continue;
    contourPaths.push(simplifyPath(contour, 1.5));
  }
  let all = [];
  const contourN = getTargetCount();
  if (contourN) {
    // 有填「總點數」：沿著輪廓依長度平均分配，剛好產生這麼多個點
    all = resampleContoursToCount(contourPaths, contourN).map(p => workToNatural(p.x, p.y));
  } else {
    for (const denoised of contourPaths) {
      const resampled = resampleBySpacing(denoised, resolveSpacingForContour(denoised));
      all = all.concat(resampled.map(p => workToNatural(p.x, p.y)));
    }
  }
  return {pts: all, close: comps.length === 1};
}

// ---- 變更／拖曳既有座標點 ----
let selectedPointIndex = -1;
let isDraggingPoint = false;
let pointerHitExisting = false;

function findNearestPointIndex(px, py, thresholdPx) {
  let best = -1, bestDist = thresholdPx * thresholdPx;
  for (let i = 0; i < points.length; i++) {
    const [dx, dy] = toDisplay(points[i][0], points[i][1]);
    const d = (dx - px) * (dx - px) + (dy - py) * (dy - py);
    if (d <= bestDist) {bestDist = d; best = i;}
  }
  return best;
}

function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (canvas.width / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height)
  ];
}

canvas.addEventListener('pointerdown', (e) => {
  if (!world || points.length === 0) return;
  if (mode === 'select' || mode === 'brush' || e.button !== 0 || spaceDown) return;
  const [px, py] = canvasPointFromEvent(e);
  const idx = findNearestPointIndex(px, py, 12);
  if (idx !== -1) {
    selectedPointIndex = idx;
    isDraggingPoint = true;
    pointerHitExisting = true;
    canvas.setPointerCapture(e.pointerId);
    redraw();
    statusMsg.textContent = `已選取第 ${idx + 1} 個座標點（黃色外框），可以直接拖曳移動位置，或按「刪除選取的點」。`;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!isDraggingPoint || selectedPointIndex === -1) return;
  const [px, py] = canvasPointFromEvent(e);
  const [nx, ny] = toNatural(px, py);
  points[selectedPointIndex] = [nx, ny];
  redraw();
});
function endPointDrag() {
  if (isDraggingPoint) {
    isDraggingPoint = false;
    updateOutputs();
  }
}
canvas.addEventListener('pointerup', endPointDrag);
canvas.addEventListener('pointercancel', endPointDrag);

canvas.addEventListener('click', (e) => {
  if (!world) return;
  if (suppressClick) { suppressClick = false; return; }
  if (mode === 'select' || mode === 'brush') return;
  if (pointerHitExisting) {
    // 剛剛的 pointerdown 已經選到既有的點（可能只是點一下選取，也可能有拖曳），
    // 這次 click 不要再疊加新增一個點上去。
    pointerHitExisting = false;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);

  if (mode === 'boundary') {
    const [nx, ny] = toNatural(px, py);
    if (boundarySpace !== 'nat') { boundaryPoints = []; boundarySpace = 'nat'; }
    boundaryPoints.push([nx, ny]);
    redraw();
    document.getElementById('boundaryStatus').textContent = `已設定 ${boundaryPoints.length} 個邊界角點，繼續點擊可以加更多，完成後按「完成邊界」。`;
    updatePickBar();
    return;
  }

  if (mode === 'origin') {
    const [nx, ny] = toNatural(px, py);
    origin = {x: nx, y: ny};
    mode = prevMode;
    document.getElementById('modeManual').classList.toggle('primary', mode === 'manual');
    document.getElementById('modeWand').classList.toggle('primary', mode === 'wand');
    document.getElementById('modeOrigin').classList.remove('primary');
    redraw();
    updateOutputs();
    statusMsg.textContent = '已設定原點，之後的座標都會以此為基準。';
    endPick();
    return;
  }

  if (mode === 'manual') {
    const [nx, ny] = toNatural(px, py);
    if (e.shiftKey && points.length >= 2) insertAtNearestSegment(nx, ny);
    else points.push([nx, ny]);
    selectedPointIndex = -1;
    redraw();
    updateOutputs();
    return;
  }

  if (!img) { statusMsg.textContent = '智慧選取需要先選擇圖片。'; return; }
  const wandNat = toNaturalF(px, py);
  if (wandNat[0] < 0 || wandNat[1] < 0 || wandNat[0] >= img.naturalWidth || wandNat[1] >= img.naturalHeight) { statusMsg.textContent = '請點在圖片範圍內。'; return; }
  const sx = Math.min(sampleCanvas.width - 1, Math.max(0, Math.round(wandNat[0] * sampleCanvas.width / img.naturalWidth)));
  const sy = Math.min(sampleCanvas.height - 1, Math.max(0, Math.round(wandNat[1] * sampleCanvas.height / img.naturalHeight)));
  const combineMode = getCombineMode(e);
  statusMsg.textContent = '選取中…';
  setTimeout(() => {
    const imgData = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
    const tolerance = Number(document.getElementById('toleranceSlider').value);
    const newMask = magicWandSelect(imgData, sampleCanvas.width, sampleCanvas.height, sx, sy, tolerance);
    const combined = combineSelectionMask(newMask, sampleCanvas.width, sampleCanvas.height, combineMode);
    const result = pointsFromSelectionMask(combined, sampleCanvas.width, sampleCanvas.height);
    if (result.pts.length < 1) {
      statusMsg.textContent = combineMode === 'subtract'
        ? '減去之後選取範圍變成空的了，試著調整容許度或換一個點。'
        : '找不到可用的選取範圍，試著調整容許度或換一個點。';
      return;
    }
    points = result.pts;
    closeToggle.checked = result.close;
    selectedPointIndex = -1;
    redraw();
    updateOutputs();
    statusMsg.textContent = `已${combineModeLabel(combineMode)}，共 ${points.length} 個座標點。`;
  }, 10);
});

document.getElementById('modeManual').addEventListener('click', () => {
  mode = 'manual';
  document.getElementById('modeManual').classList.add('primary');
  document.getElementById('modeWand').classList.remove('primary');
  document.getElementById('modeOrigin').classList.remove('primary');
  document.getElementById('modeHint').textContent = '手動模式：在空白處點擊會依序新增座標點；點在「既有的點」上則會選取它（出現黃色外框），可以直接拖曳改位置，或按「刪除選取的點」單獨刪掉那一個，不是只能刪最後一個。';
});
document.getElementById('modeWand').addEventListener('click', () => {
  mode = 'wand';
  document.getElementById('modeWand').classList.add('primary');
  document.getElementById('modeManual').classList.remove('primary');
  document.getElementById('modeOrigin').classList.remove('primary');
  document.getElementById('modeHint').textContent = '智慧選取：在想要的區域內點一下，會自動依顏色相近範圍描出邊界，可用「容許度」調整選取的寬鬆程度。跟 Photoshop 一樣：直接點＝取代目前選取；按住 Shift 再點＝加入（聯集）；按住 Alt／Option 再點＝減去（差集）；Shift+Alt 一起按＝只留交集。「一鍵選取外框」按鈕也吃同樣的快捷鍵。';
});
document.getElementById('modeOrigin').addEventListener('click', () => {
  if (mode !== 'origin') prevMode = mode;
  mode = 'origin';
  document.getElementById('modeManual').classList.remove('primary');
  document.getElementById('modeWand').classList.remove('primary');
  document.getElementById('modeOrigin').classList.add('primary');
  document.getElementById('modeHint').textContent = '設定原點：在圖上點一下想要的原點位置，設定後會自動回到剛才的模式。';
});
document.getElementById('setOriginNumBtn').addEventListener('click', () => {
  const xv = document.getElementById('originXInput').value;
  const yv = document.getElementById('originYInput').value;
  if (xv === '' || yv === '') {
    statusMsg.textContent = '請同時輸入原點的 X 與 Y 座標值。';
    return;
  }
  const nx = Number(xv), ny = Number(yv);
  if (Number.isNaN(nx) || Number.isNaN(ny)) {
    statusMsg.textContent = '原點座標格式不正確，請輸入數字。';
    return;
  }
  if (!Number.isInteger(nx) || !Number.isInteger(ny)) {
    statusMsg.textContent = '原點座標值只接受整數。';
    return;
  }
  centerOffset = [nx, ny];
  redraw();
  updateOutputs();
  statusMsg.textContent = `原點的座標值已設為 (${nx}, ${ny})，所有匯出座標都以它為基準。`;
});
document.getElementById('boundaryModeBtn').addEventListener('click', () => {
  if (mode !== 'boundary') prevMode = mode;
  mode = 'boundary';
  document.getElementById('modeManual').classList.remove('primary');
  document.getElementById('modeWand').classList.remove('primary');
  document.getElementById('modeOrigin').classList.remove('primary');
  document.getElementById('boundaryStatus').textContent = boundaryPoints.length
    ? `目前已有 ${boundaryPoints.length} 個邊界角點，繼續在圖上點擊可以加更多。`
    : '請在圖上依序點擊邊界的各個角點（例如菱形的 4 個角），完成後按「完成邊界」。';
  renderBoundaryPreview();
});
document.getElementById('finishBoundaryBtn').addEventListener('click', () => {
  if (boundaryPoints.length < 3) {
    document.getElementById('boundaryStatus').textContent = '邊界至少需要3個角點才能圍成一個區域。';
    return;
  }
  mode = prevMode;
  document.getElementById('modeManual').classList.toggle('primary', mode === 'manual');
  document.getElementById('modeWand').classList.toggle('primary', mode === 'wand');
  redraw();
  renderBoundaryPreview();
  document.getElementById('boundaryStatus').textContent = `邊界已完成，共 ${boundaryPoints.length} 個角點。`;
});
document.getElementById('clearBoundaryBtn').addEventListener('click', () => {
  boundaryPoints = [];
  redraw();
  renderBoundaryPreview();
  document.getElementById('boundaryStatus').textContent = '尚未設定邊界角點';
});
document.getElementById('applyBoundaryNumBtn').addEventListener('click', () => {
  const ids = ['boundaryX1', 'boundaryY1', 'boundaryX2', 'boundaryY2', 'boundaryX3', 'boundaryY3', 'boundaryX4', 'boundaryY4'];
  const vals = ids.map(id => document.getElementById(id).value);
  if (vals.some(v => v === '')) {
    document.getElementById('boundaryStatus').textContent = '請把 4 個角點的 X、Y 都填完整，不能留空。';
    return;
  }
  const nums = vals.map(Number);
  if (nums.some(n => Number.isNaN(n))) {
    document.getElementById('boundaryStatus').textContent = '座標格式不正確，請輸入數字。';
    return;
  }
  boundaryPoints = [
    [nums[0], nums[1]],
    [nums[2], nums[3]],
    [nums[4], nums[5]],
    [nums[6], nums[7]]
  ];
  boundarySpace = 'rel';
  redraw();
  renderBoundaryPreview();
  document.getElementById('boundaryStatus').textContent = `已套用輸入的 4 個角點當邊界，記得勾選「依多邊形邊界自動算」再按「套用縮放」，座標就不會超出這個邊界。`;
});
document.getElementById('toleranceSlider').addEventListener('input', (e) => {
  document.getElementById('toleranceVal').textContent = e.target.value;
});
document.getElementById('spacingSlider').addEventListener('input', (e) => {
  document.getElementById('spacingVal').textContent = e.target.value;
});
document.getElementById('minSizeSlider').addEventListener('input', (e) => {
  document.getElementById('minSizeVal').textContent = e.target.value;
});
document.getElementById('flipY').addEventListener('change', () => {updateOutputs();});
document.getElementById('autoOuterBtn').addEventListener('click', (e) => {
  if (!img) return;
  const combineMode = getCombineMode(e);
  statusMsg.textContent = '偵測外框中…';
  setTimeout(() => {
    const imgData = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
    const tolerance = Number(document.getElementById('toleranceSlider').value) || 32;
    const bgMask = detectBackgroundMask(imgData, sampleCanvas.width, sampleCanvas.height, tolerance);
    const subjectMask = new Uint8Array(bgMask.length);
    for (let i = 0; i < bgMask.length; i++) subjectMask[i] = bgMask[i] ? 0 : 1;
    const combined = combineSelectionMask(subjectMask, sampleCanvas.width, sampleCanvas.height, combineMode);
    const result = pointsFromSelectionMask(combined, sampleCanvas.width, sampleCanvas.height);
    if (result.pts.length < 1) {
      statusMsg.textContent = combineMode === 'subtract'
        ? '減去之後選取範圍變成空的了，請調整容許度。'
        : '找不到可用的主體區域，請調整容許度。';
      return;
    }
    points = result.pts;
    closeToggle.checked = result.close;
    selectedPointIndex = -1;
    redraw();
    updateOutputs();
    statusMsg.textContent = `已${combineModeLabel(combineMode)}外框，共 ${points.length} 個座標點。`;
  }, 10);
});

document.getElementById('applySelectionReplaceBtn').addEventListener('click', () => {
  if (!pendingPoints) return;
  points = pendingPoints;
  closeToggle.checked = pendingClose;
  pendingPoints = null;
  selectedPointIndex = -1;
  showSelectionPreviewRow(false);
  redraw();
  updateOutputs();
  statusMsg.textContent = `已套用選取，共 ${points.length} 個座標點（取代原本座標）。`;
});
document.getElementById('applySelectionMergeBtn').addEventListener('click', () => {
  if (!pendingPoints) return;
  points = points.concat(pendingPoints);
  closeToggle.checked = false;
  pendingPoints = null;
  selectedPointIndex = -1;
  showSelectionPreviewRow(false);
  redraw();
  updateOutputs();
  statusMsg.textContent = `已合併進目前座標，共 ${points.length} 個座標點（多段選取會各自保留原本的點，不會自動連成單一封閉輪廓，「閉合路徑」已自動關閉）。`;
});
document.getElementById('cancelSelectionBtn').addEventListener('click', () => {
  pendingPoints = null;
  showSelectionPreviewRow(false);
  redraw();
  statusMsg.textContent = '已取消這次選取預覽，原本的座標沒有變動。';
});

document.getElementById('deleteSelectedPointBtn').addEventListener('click', () => {
  if (deleteSelectedSet()) return;
  if (selectedPointIndex < 0 || selectedPointIndex >= points.length) {
    statusMsg.textContent = '目前沒有選取任何座標點。先在圖上點一下既有的點（會出現黃色外框）再刪除。';
    return;
  }
  points.splice(selectedPointIndex, 1);
  selectedPointIndex = -1;
  redraw();
  updateOutputs();
  statusMsg.textContent = `已刪除選取的點，目前剩下 ${points.length} 個座標點。`;
});
document.getElementById('clearBtn').addEventListener('click', () => {
  points = [];
  pendingPoints = null;
  selectedPointIndex = -1;
  resetSelectionMask();
  showSelectionPreviewRow(false);
  redraw();
  updateOutputs();
});
closeToggle.addEventListener('change', () => {redraw(); updateOutputs();});
document.getElementById('dotDiameterSlider').addEventListener('input', (e) => {
  document.getElementById('dotDiameterVal').textContent = e.target.value;
  redraw();
  updateSimStats();
  renderPreview();
});

document.getElementById('formatJson').addEventListener('click', () => {exportMode = 'json'; updateOutputs();});
document.getElementById('formatSvg').addEventListener('click', () => {exportMode = 'svg'; updateOutputs();});

function updateOutputs() {
  onPointsChanged();
  if (exportPoints().length === 0) {
    coordsList.innerHTML = '<div style="color:var(--text-3)">（尚無點）</div>';
    exportBox.value = '';
    document.getElementById('totalCountSummary').textContent = '目前尚未產生任何座標';
    updateSimStats();
    renderPreview();
    return;
  }
  const rel = getRelPoints();
  document.getElementById('totalCountSummary').textContent = `目前共 ${rel.length} 個匯出座標` + (lastDupRemoved ? `（描點 ${points.length} 個，已去除 ${lastDupRemoved} 個重複座標）` : '');

  coordsList.innerHTML = rel.map((p, i) => `<div>${i + 1}. x=${p[0]}, y=${p[1]}</div>`).join('');

  if (exportMode === 'json') {
    exportBox.value = JSON.stringify(rel.map(p => ({x: p[0], y: p[1]})), null, 2);
  } else {
    exportBox.value = buildSvgPath(rel);
  }
  updateSimStats();
  renderPreview();
}

document.getElementById('copyBtn').addEventListener('click', async () => {
  if (!exportBox.value) {
    statusMsg.textContent = '目前沒有座標可以複製。';
    return;
  }
  try {
    await navigator.clipboard.writeText(exportBox.value);
    statusMsg.textContent = '已複製到剪貼簿。';
  } catch (err) {
    exportBox.focus();
    exportBox.select();
    try {
      document.execCommand('copy');
      statusMsg.textContent = '已複製（備援方式）。';
    } catch (err2) {
      statusMsg.textContent = '自動複製失敗，請手動選取文字後複製。';
    }
  }
});

document.getElementById('copyListTextBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('outlierStatus');
  const text = coordsList.innerText.trim();
  if (!text) {
    statusEl.textContent = '目前沒有座標可以複製。';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = '已複製清單文字，可以直接貼給 Claude。';
  } catch (err) {
    try {
      const range = document.createRange();
      range.selectNodeContents(coordsList);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
      statusEl.textContent = '已複製（備援方式）。';
    } catch (err2) {
      statusEl.textContent = '自動複製失敗，請手動選取清單文字後複製。';
    }
  }
});

document.getElementById('findOutlierBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('outlierStatus');
  if (points.length < 4) {
    statusEl.textContent = '點數太少，不足以判斷離群點。';
    return;
  }
  const dists = points.map((p, i) => {
    let minD = Infinity;
    points.forEach((q, j) => {
      if (i === j) return;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < minD) minD = d;
    });
    return minD;
  });
  const sorted = [...dists].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const threshold = Math.max(median * 10, 20);
  const outlierIdx = [];
  dists.forEach((d, i) => {if (d > threshold) outlierIdx.push(i);});
  if (outlierIdx.length === 0) {
    statusEl.textContent = `沒有抓到明顯的離群點（最近鄰距離中位數約 ${median.toFixed(1)}，目前最大的最近鄰距離是 ${Math.max(...dists).toFixed(1)}）。`;
    return;
  }
  const removed = outlierIdx.map(i => points[i]);
  points = points.filter((p, i) => !outlierIdx.includes(i));
  redraw();
  updateOutputs();
  const removedText = removed.map(p => `(${p[0]}, ${p[1]})`).join('、');
  statusEl.textContent = `已移除 ${outlierIdx.length} 個離群點：${removedText}（判斷依據：跟其他點的最近距離，超過中位數的 10 倍）。`;
});

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function allPointsInsidePolygon(pts, poly) {
  return pts.every(p => pointInPolygon(p[0], p[1], poly));
}

function toRelPoint(p) {
  const flip = document.getElementById('flipY').checked;
  const angle = Number(document.getElementById('autoRotateInput').value) || 0;
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p[0] - origin.x, dy = p[1] - origin.y;
  const rdx = dx * cos - dy * sin;
  const rdy = dx * sin + dy * cos;
  return [rdx + centerOffset[0], (flip ? -rdy : rdy) + centerOffset[1]];
}

function findMaxScaleForPolygon(pts, poly, cx, cy) {
  const relCenter = toRelPoint([cx, cy]);
  if (!pointInPolygon(relCenter[0], relCenter[1], poly)) return 0;
  const relPts = pts.map(toRelPoint);
  function testScale(s) {
    const scaled = relPts.map(p => [relCenter[0] + (p[0] - relCenter[0]) * s, relCenter[1] + (p[1] - relCenter[1]) * s]);
    return allPointsInsidePolygon(scaled, poly);
  }
  let hi = 1;
  while (testScale(hi) && hi < 64) hi *= 2;
  if (testScale(hi)) return hi;
  let lo = 0;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    if (testScale(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

document.getElementById('applyScaleBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('scaleStatus');
  if (points.length === 0) {
    statusEl.textContent = '目前沒有座標，請先描邊或選取。';
    return;
  }
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const curW = (maxX - minX) || 1, curH = (maxY - minY) || 1;

  const centerMode = document.querySelector('input[name="scaleCenter"]:checked').value;
  let cx, cy, centerRel;
  if (centerMode === 'origin') {
    cx = origin.x; cy = origin.y;
    centerRel = [0, 0];
  } else if (centerMode === 'custom') {
    const xv = document.getElementById('scaleCenterX').value, yv = document.getElementById('scaleCenterY').value;
    if (xv === '' || yv === '' || Number.isNaN(Number(xv)) || Number.isNaN(Number(yv))) {
      statusEl.textContent = '請輸入中心座標的 X 和 Y，或按「捕捉目前圖案中心」。';
      return;
    }
    centerRel = [Number(xv), Number(yv)];
    [cx, cy] = relToNatural(centerRel[0], centerRel[1]);
  } else {
    // 用「匯出座標」下的外框中心（跟「指定中心」同一個定義）當縮放中心。
    // 舊版用的是原圖像素的外框中心，套用自動旋轉後兩者不是同一點，
    // 所以已經置中的圖案縮放完會偏掉。
    centerRel = getRelBBoxCenter();
    [cx, cy] = relToNatural(centerRel[0], centerRel[1]);
  }

  const scaleMode = document.querySelector('input[name="scaleMode"]:checked').value;
  let scaleFactor;
  if (scaleMode === 'percent') {
    const pct = Number(document.getElementById('scalePercentInput').value);
    if (!pct || pct <= 0) {
      statusEl.textContent = '請輸入有效的縮放比例（%）。';
      return;
    }
    scaleFactor = pct / 100;
  } else if (scaleMode === 'fit') {
    const bw = Number(document.getElementById('boundaryWInput').value);
    const bh = Number(document.getElementById('boundaryHInput').value);
    if (!bw || !bh || bw <= 0 || bh <= 0) {
      statusEl.textContent = '請輸入有效的邊界寬度與高度。';
      return;
    }
    const relPtsForFit = points.map(toRelPoint);
    const relXsForFit = relPtsForFit.map(p => p[0]), relYsForFit = relPtsForFit.map(p => p[1]);
    const relWForFit = (Math.max(...relXsForFit) - Math.min(...relXsForFit)) || 1;
    const relHForFit = (Math.max(...relYsForFit) - Math.min(...relYsForFit)) || 1;
    scaleFactor = Math.min(bw / relWForFit, bh / relHForFit);
  } else {
    if (boundaryPoints.length < 3) {
      statusEl.textContent = '請先用「設定邊界角點」點出多邊形邊界（至少3點），再「完成邊界」。';
      return;
    }
    const maxScale = findMaxScaleForPolygon(points, boundaryRel(), cx, cy);
    if (maxScale <= 0) {
      statusEl.textContent = '縮放中心不在邊界多邊形內，無法縮放符合邊界，請改用「以圖案自身中心縮放」，或重新設定邊界。';
      return;
    }
    scaleFactor = maxScale * 0.98;
  }

  points = points.map(p => [
    cx + (p[0] - cx) * scaleFactor,
    cy + (p[1] - cy) * scaleFactor
  ]);
  redraw();
  updateOutputs();
  statusEl.textContent = `已縮放為原本的 ${(scaleFactor * 100).toFixed(1)}%，縮放後外框尺寸約 ${(curW * scaleFactor).toFixed(1)} × ${(curH * scaleFactor).toFixed(1)}，縮放中心（匯出座標）(${Math.round(centerRel[0] * 100) / 100}, ${Math.round(centerRel[1] * 100) / 100})。`;
});

function transformPointsSimple(kind) {
  if (points.length === 0) {
    document.getElementById('checkStatus').textContent = '目前沒有座標，請先描邊或選取。';
    return;
  }
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  if (kind === 'flipH') {
    points = points.map(p => [cx - (p[0] - cx), p[1]]);
  } else if (kind === 'flipV') {
    points = points.map(p => [p[0], cy - (p[1] - cy)]);
  } else if (kind === 'rotateDeg') {
    const deg = Number(document.getElementById('checkRotateDegInput').value) || 0;
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    points = points.map(p => {
      const dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    });
  }
  redraw();
  updateOutputs();
  document.getElementById('checkStatus').textContent = '已調整，請再看一次上方預覽跟原圖有沒有對上，沒對就再按一次。';
}
document.getElementById('checkFlipHBtn').addEventListener('click', () => transformPointsSimple('flipH'));
document.getElementById('checkFlipVBtn').addEventListener('click', () => transformPointsSimple('flipV'));
document.getElementById('checkRotateBtn').addEventListener('click', () => transformPointsSimple('rotateDeg'));

document.getElementById('scalePercentInput').addEventListener('input', () => {
  document.getElementById('scaleModePercent').checked = true;
});
document.getElementById('boundaryWInput').addEventListener('input', () => {
  document.getElementById('scaleModeFit').checked = true;
});
document.getElementById('boundaryHInput').addEventListener('input', () => {
  document.getElementById('scaleModeFit').checked = true;
});

document.getElementById('applyRotateBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('rotateStatus');
  if (points.length === 0) {
    statusEl.textContent = '目前沒有座標，請先描邊或選取。';
    return;
  }
  const deg = Number(document.getElementById('rotateAngleInput').value);
  if (Number.isNaN(deg)) {
    statusEl.textContent = '請輸入有效的旋轉角度。';
    return;
  }
  const centerMode = document.querySelector('input[name="rotateCenter"]:checked').value;
  let cx, cy;
  if (centerMode === 'origin') {
    cx = origin.x; cy = origin.y;
  } else {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  points = points.map(p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  redraw();
  updateOutputs();
  statusEl.textContent = `已將整個圖案旋轉 ${deg}°。Y 軸方向與自動旋轉角度會在匯出時自動套用。`;
});

function parseImportedCoords(text) {
  text = (text || '').trim();
  if (!text) return null;

  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      const pts = data.map(item => {
        if (Array.isArray(item)) return [Number(item[0]), Number(item[1])];
        if (item && typeof item === 'object') return [Number(item.x), Number(item.y)];
        return null;
      }).filter(p => p && !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
      if (pts.length) return pts;
    }
  } catch (e) { /* 不是 JSON，繼續嘗試其他格式 */}

  if (/[MLZmlz]/.test(text)) {
    const nums = text.replace(/[MLZmlz]/g, ' ').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length >= 2 && nums.every(n => !Number.isNaN(n))) {
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      if (pts.length) return pts;
    }
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const linePts = [];
  for (const line of lines) {
    const parts = line.split(/[,\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      const x = Number(parts[0]), y = Number(parts[1]);
      if (!Number.isNaN(x) && !Number.isNaN(y)) linePts.push([x, y]);
    }
  }
  if (linePts.length) return linePts;

  return null;
}

let shiftedPoints = null;
let shiftExportMode = 'json';

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('importBox').value = ev.target.result;
    document.getElementById('shiftStatus').textContent = '已讀入檔案內容，請輸入原點並按「計算位移並套用」。';
  };
  reader.onerror = () => {
    document.getElementById('shiftStatus').textContent = '檔案讀取失敗。';
  };
  reader.readAsText(file);
});

function renderShifted() {
  const listEl = document.getElementById('shiftedList');
  const exportEl = document.getElementById('shiftedExportBox');
  if (!shiftedPoints || shiftedPoints.length === 0) {
    listEl.innerHTML = '<div style="color:var(--text-3)">（尚無資料）</div>';
    exportEl.value = '';
    return;
  }
  listEl.innerHTML = shiftedPoints.map((p, i) => `<div>${i + 1}. x=${p[0]}, y=${p[1]}</div>`).join('');
  if (shiftExportMode === 'json') {
    exportEl.value = JSON.stringify(shiftedPoints.map(p => ({x: p[0], y: p[1]})), null, 2);
  } else {
    const d = shiftedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
    exportEl.value = d;
  }
}

document.getElementById('applyShiftBtn').addEventListener('click', () => {
  const text = document.getElementById('importBox').value;
  const pts = parseImportedCoords(text);
  if (!pts) {
    document.getElementById('shiftStatus').textContent = '無法辨識座標格式，請確認 JSON／SVG path／每行 x,y 的格式是否正確。';
    return;
  }
  const x1v = document.getElementById('origX1').value;
  const y1v = document.getElementById('origY1').value;
  const x2v = document.getElementById('newX2').value;
  const y2v = document.getElementById('newY2').value;
  if ([x1v, y1v, x2v, y2v].some(v => v === '')) {
    document.getElementById('shiftStatus').textContent = '請完整輸入目前原點 (X1, Y1) 與新原點 (X2, Y2)。';
    return;
  }
  const x1 = Number(x1v), y1 = Number(y1v), x2 = Number(x2v), y2 = Number(y2v);
  if ([x1, y1, x2, y2].some(n => Number.isNaN(n))) {
    document.getElementById('shiftStatus').textContent = '座標格式不正確，請輸入數字。';
    return;
  }
  const dx = x2 - x1, dy = y2 - y1;
  shiftedPoints = pts.map(p => [p[0] + dx, p[1] + dy]);
  renderShifted();
  document.getElementById('shiftStatus').textContent = `已計算位移量 (dx=${dx}, dy=${dy})，共平移 ${shiftedPoints.length} 個座標點，相對距離與形狀皆保持不變。`;
});

document.getElementById('shiftFormatJson').addEventListener('click', () => {shiftExportMode = 'json'; renderShifted();});
document.getElementById('shiftFormatSvg').addEventListener('click', () => {shiftExportMode = 'svg'; renderShifted();});
document.getElementById('shiftCopyBtn').addEventListener('click', async () => {
  const exportEl = document.getElementById('shiftedExportBox');
  if (!exportEl.value) {
    document.getElementById('shiftStatus').textContent = '目前沒有平移後的座標可以複製。';
    return;
  }
  try {
    await navigator.clipboard.writeText(exportEl.value);
    document.getElementById('shiftStatus').textContent = '已複製到剪貼簿。';
  } catch (err) {
    exportEl.focus();
    exportEl.select();
    try {
      document.execCommand('copy');
      document.getElementById('shiftStatus').textContent = '已複製（備援方式）。';
    } catch (err2) {
      document.getElementById('shiftStatus').textContent = '自動複製失敗，請手動選取文字後複製。';
    }
  }
});

function parseHideoutBlocks(text) {
  const blocks = text.match(/\{[^{}]*\}/g) || [];
  const pts = [];
  for (const b of blocks) {
    const xMatch = b.match(/"x"\s*:\s*(-?\d+(?:\.\d+)?)/);
    const yMatch = b.match(/"y"\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (xMatch && yMatch) pts.push([Number(xMatch[1]), Number(yMatch[1])]);
  }
  return pts;
}

document.getElementById('pasteHideoutFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('pasteHideoutBox').value = ev.target.result;
  };
  reader.onerror = () => {
    document.getElementById('batchStatus').textContent = '檔案讀取失敗。';
  };
  reader.readAsText(file);
});

document.getElementById('parseReplaceBtn').addEventListener('click', () => {
  const text = document.getElementById('pasteHideoutBox').value;
  const pts = parseHideoutBlocks(text);
  const statusEl = document.getElementById('batchStatus');
  if (pts.length === 0) {
    statusEl.textContent = '沒有解析到任何 x, y 座標，請確認貼上的內容格式。';
    return;
  }
  origin = {x: 0, y: 0};
  centerOffset = [0, 0];
  points = pts.map(p => relToNatural(p[0], p[1]));
  resetLayers('匯入座標');
  resetView();
  setupCanvas();
  closeToggle.checked = false;
  redraw();
  updateOutputs();
  statusEl.textContent = `已解析並取代座標，共 ${points.length} 個點，原點已重設為 (0, 0)，預覽已更新。`;
});

function getRelPointsRaw() {
  const points = exportPoints();
  const flip = document.getElementById('flipY').checked;
  const angle = Number(document.getElementById('autoRotateInput').value) || 0;
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return points.map(p => {
    const dx = p[0] - origin.x;
    const dy = p[1] - origin.y;
    const rdx = dx * cos - dy * sin;
    const rdy = dx * sin + dy * cos;
    const rx = Math.round(rdx + centerOffset[0]);
    const ry = Math.round((flip ? -rdy : rdy) + centerOffset[1]);
    return [rx, ry];
  });
}

function parseTemplate(text) {
  const nameMatch = text.match(/"([^"]+)"\s*:\s*\{/);
  const blockMatch = text.match(/\{[^{}]*\}/);
  if (!nameMatch || !blockMatch) return null;
  const block = blockMatch[0];
  const hashMatch = block.match(/"hash"\s*:\s*(-?\d+)/);
  if (!hashMatch) return null;
  const rMatch = block.match(/"r"\s*:\s*(-?\d+)/);
  const fvMatch = block.match(/"fv"\s*:\s*(-?\d+)/);
  return {
    name: nameMatch[1],
    hash: hashMatch[1],
    r: rMatch ? rMatch[1] : '0',
    fv: fvMatch ? fvMatch[1] : '0'
  };
}

document.getElementById('generateBatchBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('batchStatus');
  const exportEl = document.getElementById('batchExportBox');
  if (points.length === 0) {
    statusEl.textContent = '目前沒有座標，請先描邊或選取。';
    exportEl.value = '';
    return;
  }
  const tpl = currentObjectTemplate();
  if (!tpl) {
    statusEl.textContent = document.getElementById('templateBox').value.trim() ? '無法從貼上的範例解析出名稱與 hash，請確認格式。' : '還沒有可用的物件：請先在「設定 › 線稿用物件」新增一組，或在下面直接貼上一組範例。';
    return;
  }
  const rel = getRelPoints();
  const lines = rel.map(p => {
    return `    "${tpl.name}": {\n      "hash": ${tpl.hash},\n      "x": ${p[0]},\n      "y": ${p[1]},\n      "r": ${tpl.r},\n      "fv": ${tpl.fv}\n    },`;
  });
  exportEl.value = lines.join('\n');
  statusEl.textContent = `已用物件「${tpl.name}」產生 ${rel.length} 組設定（hash=${tpl.hash}，r=${tpl.r}，fv=${tpl.fv}，只改 x, y）。`;
});

document.getElementById('batchCopyBtn').addEventListener('click', async () => {
  const exportEl = document.getElementById('batchExportBox');
  const statusEl = document.getElementById('batchStatus');
  if (!exportEl.value) {
    statusEl.textContent = '目前沒有批次內容可以複製，請先「產生批次設定」。';
    return;
  }
  try {
    await navigator.clipboard.writeText(exportEl.value);
    statusEl.textContent = '已複製到剪貼簿。';
  } catch (err) {
    exportEl.focus();
    exportEl.select();
    try {
      document.execCommand('copy');
      statusEl.textContent = '已複製（備援方式）。';
    } catch (err2) {
      statusEl.textContent = '自動複製失敗，請手動選取文字後複製。';
    }
  }
});

const bgGradientLayer = document.getElementById('bgGradientLayer');
const bgImageLayer = document.getElementById('bgImageLayer');
let bgImageDataUrl = null;
let hideAllColorBlocks = false;

function buildGradient() {
  let colors = ['bgColor1', 'bgColor2', 'bgColor3', 'bgColor4', 'bgColorBase'].map(id => document.getElementById(id).value);
  let glow = Number(document.getElementById('bgGlow').value) || 0;
  const preset = THEMES[currentTheme];
  if (preset) {
    // 預設主題：直接用主題的配色，不受自訂參數影響
    colors = preset.c;
    glow = preset.glow;
  } else {
    if (hideAllColorBlocks) {
      // 連底色都一起隱藏，只剩背景圖片（跟頁面本身的深色底）
      bgGradientLayer.style.background = 'transparent';
      return;
    }
    if (document.getElementById('disableGradientToggle').checked && !!bgImageDataUrl) {
      bgGradientLayer.style.background = colors[4];
      return;
    }
  }
  // 深色介面用的背景：顏色只當作低強度的柔和光暈，不再是整塊高彩度色塊
  bgGradientLayer.style.background = themeGradient(colors, glow, false);
}
function applyBgImage() {
  if (bgImageDataUrl && currentTheme === 'custom') {
    bgImageLayer.style.backgroundImage = `url(${bgImageDataUrl})`;
  } else {
    bgImageLayer.style.backgroundImage = 'none';
  }
}
['bgColor1', 'bgColor2', 'bgColor3', 'bgColor4', 'bgColorBase'].forEach(id => {
  document.getElementById(id).addEventListener('input', buildGradient);
});
document.getElementById('bgImageInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    bgImageDataUrl = ev.target.result;
    applyBgImage();
    buildGradient();
    document.getElementById('bgSettingsStatus').textContent = '已套用背景圖片，記得按「儲存背景設定」才會保留。';
  };
  reader.onerror = () => {
    document.getElementById('bgSettingsStatus').textContent = '圖片讀取失敗。';
  };
  reader.readAsDataURL(file);
});
document.getElementById('clearBgImageBtn').addEventListener('click', () => {
  bgImageDataUrl = null;
  applyBgImage();
  buildGradient();
  document.getElementById('bgSettingsStatus').textContent = '已清除背景圖片。';
});
document.getElementById('disableGradientToggle').addEventListener('change', buildGradient);
document.getElementById('hideAllBgColorsBtn').addEventListener('click', () => {
  hideAllColorBlocks = !hideAllColorBlocks;
  document.getElementById('hideAllBgColorsBtn').textContent = hideAllColorBlocks
    ? '恢復顯示色塊背景'
    : '一鍵隱藏全部色塊（只顯示背景圖片）';
  buildGradient();
});
document.getElementById('bgImageOpacity').addEventListener('input', (e) => {
  document.getElementById('bgImageOpacityVal').textContent = e.target.value;
  bgImageLayer.style.opacity = Number(e.target.value) / 100;
});
document.getElementById('saveBgSettingsBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('bgSettingsStatus');
  try {
    const settings = {
      c1: document.getElementById('bgColor1').value,
      c2: document.getElementById('bgColor2').value,
      c3: document.getElementById('bgColor3').value,
      c4: document.getElementById('bgColor4').value,
      base: document.getElementById('bgColorBase').value,
      opacity: document.getElementById('bgImageOpacity').value,
      glow: document.getElementById('bgGlow').value,
      image: bgImageDataUrl,
      disableGradient: document.getElementById('disableGradientToggle').checked,
      hideAllColorBlocks: hideAllColorBlocks,
      theme: currentTheme
    };
    localStorage.setItem('traceToolBgSettingsV6', JSON.stringify(settings));
    statusEl.textContent = '已儲存背景設定，下次打開這個頁面會自動套用。';
  } catch (err) {
    statusEl.textContent = '儲存失敗（可能是圖片太大，瀏覽器儲存空間不夠），可以試試看換小一點的圖片，或不要上傳圖片只存顏色設定。';
  }
});


// ======================================================================
// v6：新版介面（預覽為核心／彈出視窗／設定頁／匯入匯出整合）
// ======================================================================
const $id = (id) => document.getElementById(id);
const view = {z: 1, x: 0, y: 0, home: true};   // 描點畫布的縮放與平移（home＝還在預設的置中位置）
let baseK = 1;                            // 100% 時每個座標單位對應幾個畫面像素
let contentBox = null;                    // 圖片＋座標本身的範圍（不含原點），用來決定 100% 的顯示比例
let centerOffset = [0, 0];                // 原點的座標值：原點那個位置匯出時是多少（預設 0, 0）
let boundarySpace = 'nat';                // 邊界角點的座標空間：nat＝原圖像素，rel＝匯出座標
let lastDupRemoved = 0;
let spaceDown = false, suppressClick = false, panDrag = null, selDrag = null, keepSelectionOnce = false;
const selectedSet = new Set();            // 框選模式選到的點
let heroHit = null;
const LAYER_COLORS = ['#6ea8ff', '#3ecf8e', '#ffb020', '#f472b6', '#a78bfa', '#2dd4bf', '#f97316', '#e879f9'];
const DEFAULT_DOT_SIZE = 10;
function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return null;   // 灰階沒有色相
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hh * 60 + 360) % 360;
}
function hslToHex(hh, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + hh / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
// 新圖層的顏色：先挑調色盤裡還沒被用到的；都用過了就推算一個和現有顏色色相差最遠的新顏色
function pickLayerColor(used) {
  const taken = (used || []).map(L => String(L.color || '').toLowerCase());
  const free = LAYER_COLORS.find(c => !taken.includes(c));
  if (free) return free;
  const hues = taken.filter(c => /^#[0-9a-f]{6}$/.test(c)).map(hexToHue).filter(v => v !== null);
  let best = 0, bestD = -1;
  for (let cand = 0; cand < 360; cand += 3) {
    let dmin = 360;
    for (const u of hues) { const d = Math.abs(cand - u); dmin = Math.min(dmin, d, 360 - d); }
    if (dmin > bestD) { bestD = dmin; best = cand; }
  }
  for (let i = 0; i < 6; i++) {
    const c = hslToHex(best, 0.78, [0.64, 0.5, 0.76, 0.42, 0.58, 0.7][i]);
    if (!taken.includes(c)) return c;
  }
  return hslToHex(best, 0.78, 0.64);
}
function validSize(v) { v = Number(v); return (isFinite(v) && v >= 1 && v <= 40) ? v : DEFAULT_DOT_SIZE; }
function validColor(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? String(c).toLowerCase() : null; }
const MAX_AUTO_LAYERS = 60;
let layers = [], activeLayer = 0, layerSeq = 0;   // 圖層
let historyStack = [], histIdx = -1, restoringState = false;   // 復原／重做
let mergedOp = false, mergedSizes = null;         // 整體調整進行中（暫時把所有圖層合成一份）
let stateSeq = 0;                                 // 每次狀態真的有變就 +1
let strokeDrag = null;                            // 筆觸描邊進行中
let lastPointCount = 0;
let world = null;                         // 畫布顯示的座標範圍（原圖範圍，或沒有圖時的座標外框）
let showImage = true;                     // 主畫布是否顯示原圖

// 偵測與選取用的「工作解析度」座標 → 原圖像素座標。
// 工作解析度固定（最寬 360px），不再跟著畫面版面寬度變動，所以視窗縮放後
// 先前偵測出來的區塊仍然有效，點位間距的密度也跟舊版桌面版面一致。
function workToNatural(x, y) {
  return [
    Math.round(x * img.naturalWidth / sampleCanvas.width),
    Math.round(y * img.naturalHeight / sampleCanvas.height)
  ];
}

function setupCanvas() {
  if (!world) {
    canvas.style.display = 'none';
    emptyHint.style.display = '';
    $id('zoomCtl').hidden = true;
    return;
  }
  let maxW, maxH;
  if (isCanvasFullscreen) {
    maxW = window.innerWidth - 32;
    maxH = window.innerHeight - 96;
  } else {
    maxW = canvasWrap.clientWidth - 12;
    maxH = canvasWrap.clientHeight - 12;
  }
  // 點選原點／邊界時，底部留給提示列，避免它蓋住圖片下緣
  if (canvasWrap.classList.contains('picking')) maxH -= 52;
  if (maxW < 40 || maxH < 40) { maxW = 480; maxH = 360; needsRelayout = true; }
  // 畫布佔滿整個區域；圖片（或座標範圍）在 100% 時剛好置中放得下，周圍留一點邊
  canvas.width = Math.max(1, Math.round(maxW));
  canvas.height = Math.max(1, Math.round(maxH));
  // 100% 的大小只看圖片（或座標範圍）本身，不受偏移影響：偏移時圖片移動，但顯示比例不會跟著變
  const cb = contentBox || world;
  const fitScale = Math.min(maxW / cb.w, maxH / cb.h) * 0.94;
  // 有原圖時小圖最多放大 3 倍；純座標（沒有圖）或放大檢視時直接撐滿
  baseK = (isCanvasFullscreen || !img) ? fitScale : Math.min(fitScale, 3);
  canvas.style.display = 'block';
  emptyHint.style.display = 'none';
  if (view.home) centerView();
  clampView();
  if (img) refreshSampleCanvas();
}

// 核心預覽：填滿整個預覽區、依裝置像素比繪製
function renderPointsPreview(canvasEl, ctxEl, wrapEl, emptyEl) {
  const allPts = exportPoints();
  if (!allPts.length) {
    canvasEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }
  const W = wrapEl.clientWidth, H = wrapEl.clientHeight;
  if (W < 20 || H < 20) { needsRelayout = true; return; }
  emptyEl.style.display = 'none';
  canvasEl.style.display = 'block';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasEl.width = Math.round(W * dpr);
  canvasEl.height = Math.round(H * dpr);
  ctxEl.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctxEl.clearRect(0, 0, W, H);

  // 預設以「正的」方向（同原圖／遊戲畫面）顯示；設定頁可改成直接畫匯出座標
  const relPoints = allPts;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of relPoints) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
  const pad = Math.min(48, Math.max(24, Math.min(W, H) * 0.08));
  // 只有一兩個點、外框幾乎沒有大小時，不要把畫面放大到整個被一個點塞滿
  const scale = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h, 12);
  const offsetX = (W - w * scale) / 2;
  const offsetY = (H - h * scale) / 2;
  function toPrev(p) {
    return [offsetX + (p[0] - minX) * scale, offsetY + (p[1] - minY) * scale];
  }

  if (showImage && img) {
    // 原圖對照：把原圖半透明墊在底下（只有正向顯示時座標才對得上）
    const [ix, iy] = toPrev([0, 0]);
    ctxEl.save();
    ctxEl.globalAlpha = 0.38;
    ctxEl.drawImage(img, ix, iy, img.naturalWidth * scale, img.naturalHeight * scale);
    ctxEl.restore();
  }

  const diameter = Number($id('dotDiameterSlider').value);
  const dispRadius = Math.max(1.2, (diameter / 2) * scale);
  const fillMode = $id('fillModeToggle').checked;

  if (!fillMode && showLines) {
    for (const L of visibleLayers()) {
      const P = L.points, m = P.length;
      if (m < 2) continue;
      ctxEl.strokeStyle = 'rgba(255,107,107,0.9)';
      ctxEl.lineWidth = 1.5;
      ctxEl.setLineDash([]);
      ctxEl.beginPath();
      P.forEach((p, i) => {
        const [dx, dy] = toPrev(p);
        if (i === 0) ctxEl.moveTo(dx, dy); else ctxEl.lineTo(dx, dy);
      });
      if (L.close && m > 2) ctxEl.closePath();
      ctxEl.stroke();
      ctxEl.save();
      ctxEl.strokeStyle = '#ffb020';
      ctxEl.setLineDash([5, 4]);
      ctxEl.lineWidth = 2;
      const seg = (a, b) => {
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= diameter) return;
        const [x1, y1] = toPrev(a), [x2, y2] = toPrev(b);
        ctxEl.beginPath();
        ctxEl.moveTo(x1, y1); ctxEl.lineTo(x2, y2);
        ctxEl.stroke();
      };
      for (let i = 0; i < m - 1; i++) seg(P[i], P[i + 1]);
      if (L.close && m > 2) seg(P[m - 1], P[0]);
      ctxEl.restore();
    }
  }

  ctxEl.fillStyle = 'rgba(122,176,255,0.78)';
  relPoints.forEach(p => {
    const [dx, dy] = toPrev(p);
    ctxEl.beginPath();
    ctxEl.arc(dx, dy, dispRadius, 0, Math.PI * 2);
    ctxEl.fill();
  });
}

// 預覽下方的即時統計
function updateHeroStats() {
  const el = $id('heroStats');
  if (!el) return;
  const allPts = exportPoints();
  const n = allPts.length;
  const flip = $id('flipY').checked;
  const angle = Number($id('autoRotateInput').value) || 0;
  const maxCount = getMaxCount();
  const exportN = n ? getRelPoints().length : 0;
  const items = [{k: '匯出座標數' + (maxCount ? `（上限 ${maxCount}）` : ''), v: String(exportN) + (lastDupRemoved ? `（去重 −${lastDupRemoved}）` : ''), cls: (maxCount && exportN > maxCount) ? 'warn' : ''}];

  if ($id('fillModeToggle').checked) {
    items.push({k: '平均間距', v: '實心填滿'});
    items.push({k: '可能斷開', v: '—'});
  } else if (layerGapStats().dists.length) {
    const gs = layerGapStats();
    items.push({k: '平均間距', v: (gs.dists.reduce((a, b) => a + b, 0) / gs.dists.length).toFixed(2)});
    items.push({k: typeof gs.diameter === 'number' ? `可能斷開（直徑 ${gs.diameter}）` : '可能斷開（依各圖層大小）', v: `${gs.gaps} 段`, cls: gs.gaps > 0 ? 'warn' : 'ok'});
  } else {
    items.push({k: '平均間距', v: '—'});
    items.push({k: '可能斷開', v: '—'});
  }
  items.push({k: '輸出方向', v: `${flip ? 'Y 向上' : 'Y 向下'} · 旋轉 ${angle}°`, cls: 'small'});

  el.innerHTML = items.map(it =>
    `<div class="stat"><dt>${it.k}</dt><dd class="${it.cls || ''}">${it.v}</dd></div>`).join('');
}

// ---- 版面重新計算 ----
let needsRelayout = false;
function relayout() {
  if ($id('view-work').hidden) { needsRelayout = true; return; }
  needsRelayout = false;
  setupCanvas();
  renderPreview();
}
window.addEventListener('resize', relayout);
// 版面是依視窗高度伸縮的，畫布容器大小一變就重新計算（不必等視窗 resize 事件）
if (window.ResizeObserver) {
  let roPending = false;
  const ro = new ResizeObserver(() => {
    if (roPending || isCanvasFullscreen) return;
    roPending = true;
    requestAnimationFrame(() => { roPending = false; relayout(); });
  });
  ro.observe(canvasWrap);
  ro.observe(previewWrap);
}

// ---- 頁面切換（工作區／設定） ----
function showView(name) {
  const isWork = name !== 'settings';
  if (!isWork) closeWin();
  $id('view-work').hidden = !isWork;
  $id('view-settings').hidden = isWork;
  document.querySelectorAll('.view-tab').forEach(t => {
    if (t.dataset.view === (isWork ? 'work' : 'settings')) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (isWork) {
    if (needsRelayout) relayout(); else renderPreview();
  }
  window.scrollTo(0, 0);
  $id('view-settings').scrollTop = 0;
}
document.querySelectorAll('.view-tab').forEach(t => {
  t.addEventListener('click', () => showView(t.dataset.view));
});

// ---- 彈出視窗（可拖曳，不會擋住操作畫布） ----
let currentWin = null;
function markToolButtons() {
  document.querySelectorAll('[data-win]').forEach(b => {
    b.classList.toggle('active', b.dataset.win === currentWin);
    b.setAttribute('aria-expanded', b.dataset.win === currentWin ? 'true' : 'false');
  });
}
function openWin(id) {
  const el = $id(id);
  if (!el) return;
  if (currentWin && currentWin !== id) $id(currentWin).hidden = true;
  el.hidden = false;
  currentWin = id;
  $id('adjModal').hidden = false;
  $id('adjModalBox').dataset.size = el.dataset.size || 'md';
  $id('snackbar').classList.remove('show');
  $id('exportMenu').hidden = true;
  markToolButtons();
  renderPreview();
  if (id === 'win-scale') renderBoundaryPreview();
  if (id === 'win-origin') { $id('originXInput').value = centerOffset[0]; $id('originYInput').value = centerOffset[1]; }
  if (id === 'win-detect') { $id('detectStatus').textContent = ''; $id('detectStatus').classList.remove('error'); suggestDetectMethod(); }
}
function closeWin() {
  if (!currentWin) return;
  $id(currentWin).hidden = true;
  currentWin = null;
  $id('adjModal').hidden = true;
  markToolButtons();
}
document.querySelectorAll('[data-win]').forEach(b => {
  b.addEventListener('click', () => {
    // 置中大視窗裡的分頁只負責切換，不會把視窗關掉
    if (currentWin === b.dataset.win) closeWin(); else openWin(b.dataset.win);
  });
});
document.querySelectorAll('.win').forEach(win => {
  win.querySelector('.win-close').addEventListener('click', closeWin);
  const head = win.querySelector('.win-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || win.classList.contains('win-adj')) return;
    if (window.matchMedia('(max-width: 700px)').matches) return;
    const rect = win.getBoundingClientRect();
    win.style.left = rect.left + 'px';
    win.style.top = rect.top + 'px';
    drag = {dx: e.clientX - rect.left, dy: e.clientY - rect.top};
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const maxL = window.innerWidth - 80, maxT = window.innerHeight - 48;
    const left = Math.min(maxL, Math.max(80 - win.offsetWidth, e.clientX - drag.dx));
    const top = Math.min(maxT, Math.max(0, e.clientY - drag.dy));
    win.style.left = left + 'px';
    win.style.top = top + 'px';
  });
  const endDrag = () => { drag = null; };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || isCanvasFullscreen) return;
  if (currentWin) closeWin(); else $id('exportMenu').hidden = true;
});
$id('adjBackdrop').addEventListener('click', closeWin);

// 狀態列訊息同步顯示在視窗內，不用關掉視窗才看得到結果
new MutationObserver(() => { $id('adjStatus').textContent = statusMsg.textContent; })
  .observe(statusMsg, {childList: true, characterData: true, subtree: true});
// .hideout 匯入／批次的訊息也同步到主狀態列
new MutationObserver(() => { statusMsg.textContent = $id('batchStatus').textContent; })
  .observe($id('batchStatus'), {childList: true, characterData: true, subtree: true});

// ---- 匯出選單 ----
$id('exportMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $id('exportMenu').hidden;
  $id('exportMenu').hidden = !open;
  $id('exportMenuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('.menu-wrap')) $id('exportMenu').hidden = true;
});

// ---- 在圖上點選（原點／邊界角點）時的提示列 ----
const pickBar = $id('pickBar');
let pickKind = null, pickReturnWin = null, pickCancelled = false;
function syncModeButtons() {
  $id('modeManual').classList.toggle('primary', mode === 'manual');
  $id('modeWand').classList.toggle('primary', mode === 'wand');
  $id('modeOrigin').classList.toggle('primary', mode === 'origin');
  $id('modeSelect').classList.toggle('primary', mode === 'select');
  $id('modeBrush').classList.toggle('primary', mode === 'brush');
}
function updatePickBar(msg) {
  if (!pickKind) return;
  $id('pickBarText').textContent = msg || (pickKind === 'origin'
    ? '在圖上點一下要當作原點的位置'
    : `依序點出邊界角點（已 ${boundaryPoints.length} 點，至少 3 點）`);
}
function beginPick(kind) {
  if (!world) {
    mode = prevMode;
    syncModeButtons();
    statusMsg.textContent = '畫面上還沒有圖片或座標，無法點選。請先選擇圖片或匯入座標。';
    return;
  }
  pickKind = kind;
  pickReturnWin = currentWin;
  closeWin();
  $id('pickBarDone').hidden = kind !== 'boundary';
  pickBar.hidden = false;
  canvasWrap.classList.add('picking');
  setupCanvas();
  redraw();
  updatePickBar();
  canvasWrap.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function dropPick() {
  const wasPicking = canvasWrap.classList.contains('picking');
  pickBar.hidden = true;
  canvasWrap.classList.remove('picking');
  if (wasPicking && world) { setupCanvas(); redraw(); }
  pickKind = null;
  pickReturnWin = null;
}
function endPick() {
  if (!pickKind) return;
  // 原點點選完成就算儲存了，不再回到視窗；邊界角點（或按了取消）才回去繼續設定
  const back = (pickKind === 'origin' && !pickCancelled) ? null : pickReturnWin;
  pickCancelled = false;
  dropPick();
  // 回到原本的描點模式時，把模式說明文字也一起換回來
  if (mode === 'manual' || mode === 'wand') $id(mode === 'wand' ? 'modeWand' : 'modeManual').click(); else syncModeButtons();
  if (back) openWin(back);
}
$id('modeOrigin').addEventListener('click', () => beginPick('origin'));
$id('boundaryModeBtn').addEventListener('click', () => beginPick('boundary'));
$id('clearBoundaryBtn').addEventListener('click', () => updatePickBar());
$id('finishBoundaryBtn').addEventListener('click', () => {
  if (boundaryPoints.length >= 3) endPick();
});
$id('pickBarDone').addEventListener('click', () => {
  if (boundaryPoints.length < 3) {
    updatePickBar(`邊界至少需要 3 個角點（目前 ${boundaryPoints.length} 點）`);
    return;
  }
  $id('finishBoundaryBtn').click();
  endPick();
});
$id('pickBarCancel').addEventListener('click', () => {
  pickCancelled = true;
  mode = prevMode;
  syncModeButtons();
  redraw();
  endPick();
});
$id('modeManual').addEventListener('click', dropPick);
$id('modeWand').addEventListener('click', dropPick);

function bindFormatPair(aId, bId) {
  const a = $id(aId), b = $id(bId);
  a.addEventListener('click', () => { a.classList.add('active'); b.classList.remove('active'); });
  b.addEventListener('click', () => { b.classList.add('active'); a.classList.remove('active'); });
}
bindFormatPair('formatJson', 'formatSvg');
bindFormatPair('shiftFormatJson', 'shiftFormatSvg');

// ---- 設定：即時生效＋自動儲存 ----
const SETTINGS_KEY = 'traceToolSettingsV6';
const persistIds = ['snapRadiusSlider', 'offsetStepInput', 'dedupeToggle', 'maxCountInput', 'flipY', 'autoRotateInput', 'targetCountInput', 'minSizeSlider', 'centerlineToggle',
  'fillModeToggle', 'toleranceSlider', 'spacingSlider', 'showExtentsToggle',
  'blackThresholdSlider', 'edgeThresholdSlider'];
function syncSliderLabels() {
  persistIds.forEach(id => {
    if (!id.endsWith('Slider')) return;
    const span = $id(id.replace('Slider', 'Val'));
    if (span) span.textContent = $id(id).value;
  });
}
function saveSettings() {
  const data = {};
  persistIds.forEach(id => {
    const el = $id(id);
    data[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) {}
}
(function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    persistIds.forEach(id => {
      if (!(id in data)) return;
      const el = $id(id);
      if (el.type === 'checkbox') el.checked = !!data[id]; else el.value = data[id];
    });
    syncSliderLabels();
  } catch (e) {}
})();
persistIds.forEach(id => $id(id).addEventListener('change', saveSettings));
$id('autoRotateInput').addEventListener('input', () => { updateOutputs(); });
$id('fillModeToggle').addEventListener('change', () => { redraw(); updateOutputs(); });
$id('resetSettingsBtn').addEventListener('click', () => {
  persistIds.forEach(id => {
    const el = $id(id);
    if (el.type === 'checkbox') el.checked = el.defaultChecked; else el.value = el.defaultValue;
  });
  syncSliderLabels();
  try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
  redraw();
  updateOutputs();
  $id('settingsStatus').textContent = '已恢復預設值。';
});

// ---- 匯出座標 ↔ 原圖像素座標 ----
// toRelPoint 的反運算：把「匯出座標」（已套用原點、自動旋轉、Y 軸方向）換回原圖像素座標
function relToNatural(rx, ry) {
  const flip = $id('flipY').checked;
  const angle = Number($id('autoRotateInput').value) || 0;
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  rx -= centerOffset[0];
  ry -= centerOffset[1];
  const rdy = flip ? -ry : ry;
  return [origin.x + cos * rx + sin * rdy, origin.y - sin * rx + cos * rdy];
}
// 目前圖案在匯出座標下的外框中心
function getRelBBoxCenter() {
  const src = exportPoints();
  if (!src.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of src) {
    const r = toRelPoint(p);
    if (r[0] < minX) minX = r[0];
    if (r[0] > maxX) maxX = r[0];
    if (r[1] < minY) minY = r[1];
    if (r[1] > maxY) maxY = r[1];
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
$id('captureCenterBtn').addEventListener('click', () => {
  const c = getRelBBoxCenter();
  if (!c) { $id('scaleStatus').textContent = '目前沒有座標，無法捕捉中心。'; return; }
  $id('scaleCenterX').value = Math.round(c[0] * 100) / 100;
  $id('scaleCenterY').value = Math.round(c[1] * 100) / 100;
  $id('scaleCenterCustom').checked = true;
  $id('scaleStatus').textContent = `已捕捉目前圖案中心 (${$id('scaleCenterX').value}, ${$id('scaleCenterY').value})，之後的縮放都以這一點為準。`;
});
['scaleCenterX', 'scaleCenterY'].forEach(id => $id(id).addEventListener('input', () => { $id('scaleCenterCustom').checked = true; }));

// ---- 背景主題 ----
const THEMES = {
  deep:     {name: '深空',   c: ['#2f6bff', '#7c4dff', '#0ea5a0', '#3b4cca', '#090b10'], glow: 22},
  aurora:   {name: '極光',   c: ['#10b981', '#06b6d4', '#6366f1', '#0d9488', '#070f0e'], glow: 24},
  dusk:     {name: '暮紫',   c: ['#a855f7', '#ec4899', '#6366f1', '#7c3aed', '#0d0a14'], glow: 22},
  ember:    {name: '餘燼',   c: ['#f97316', '#ef4444', '#f59e0b', '#b45309', '#110b09'], glow: 17},
  graphite: {name: '石墨',   c: ['#64748b', '#64748b', '#64748b', '#64748b', '#0d0f13'], glow: 0}
};
let currentTheme = 'deep';
function themeGradient(c, glow, small) {
  const mix = (col) => `color-mix(in srgb, ${col} ${glow}%, transparent)`;
  const sz = small ? ['75% 80%', '70% 75%', '75% 80%', '70% 75%'] : ['60vmax 46vmax', '52vmax 40vmax', '58vmax 44vmax', '50vmax 40vmax'];
  return `radial-gradient(${sz[0]} at 8% -8%, ${mix(c[0])} 0%, transparent 70%),` +
    `radial-gradient(${sz[1]} at 96% -4%, ${mix(c[1])} 0%, transparent 70%),` +
    `radial-gradient(${sz[2]} at 88% 108%, ${mix(c[2])} 0%, transparent 70%),` +
    `radial-gradient(${sz[3]} at 2% 104%, ${mix(c[3])} 0%, transparent 70%),` +
    `${c[4]}`;
}
function persistTheme() {
  try {
    const raw = localStorage.getItem('traceToolBgSettingsV6');
    const data = raw ? JSON.parse(raw) : {};
    data.theme = currentTheme;
    localStorage.setItem('traceToolBgSettingsV6', JSON.stringify(data));
  } catch (e) {}
}
function selectTheme(name, save) {
  currentTheme = (name === 'custom' || THEMES[name]) ? name : 'deep';
  document.querySelectorAll('.theme-chip').forEach(b => b.setAttribute('aria-checked', b.dataset.theme === currentTheme ? 'true' : 'false'));
  $id('bgCustomRows').hidden = currentTheme !== 'custom';
  applyBgImage();
  buildGradient();
  if (save) persistTheme();
}
(function buildThemeList() {
  const list = $id('themeList');
  const mk = (key, label, swatchStyle, inner) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip';
    b.dataset.theme = key;
    b.setAttribute('role', 'radio');
    const sw = document.createElement('span');
    sw.className = 'sw';
    if (swatchStyle) sw.style.background = swatchStyle;
    if (inner) sw.innerHTML = inner;
    const tx = document.createElement('span');
    tx.textContent = label;
    b.appendChild(sw); b.appendChild(tx);
    b.addEventListener('click', () => selectTheme(key, true));
    list.appendChild(b);
  };
  Object.keys(THEMES).forEach(k => mk(k, THEMES[k].name, themeGradient(THEMES[k].c, Math.min(60, THEMES[k].glow * 2.2), true)));
  mk('custom', '自訂', '', '<svg class="ic"><use href="#i-settings"/></svg>');
})();

// ---- 背景 ----
$id('bgGlow').addEventListener('input', (e) => {
  $id('bgGlowVal').textContent = e.target.value;
  buildGradient();
});
$id('resetBgBtn').addEventListener('click', () => {
  ['bgColor1', 'bgColor2', 'bgColor3', 'bgColor4', 'bgColorBase', 'bgGlow', 'bgImageOpacity'].forEach(id => {
    $id(id).value = $id(id).defaultValue;
  });
  $id('bgGlowVal').textContent = $id('bgGlow').value;
  $id('bgImageOpacityVal').textContent = $id('bgImageOpacity').value;
  bgImageLayer.style.opacity = Number($id('bgImageOpacity').value) / 100;
  $id('disableGradientToggle').checked = false;
  hideAllColorBlocks = false;
  $id('hideAllBgColorsBtn').textContent = '一鍵隱藏全部色塊（只顯示背景圖片）';
  bgImageDataUrl = null;
  applyBgImage();
  buildGradient();
  try { localStorage.removeItem('traceToolBgSettingsV6'); } catch (e) {}
  persistTheme();
  $id('bgSettingsStatus').textContent = '已恢復自訂背景的預設值。';
});

(function loadBgSettings() {
  try {
    const raw = localStorage.getItem('traceToolBgSettingsV6');
    if (!raw) {
      // 第一次使用新版：舊版的亮色色塊不適合深色介面，只沿用舊版存的背景圖片
      const old = localStorage.getItem('traceToolBgSettings');
      if (old) {
        const o = JSON.parse(old);
        if (o && o.image) { bgImageDataUrl = o.image; }
      }
      selectTheme('deep', false);
      return;
    }
    const s = JSON.parse(raw);
    if (s.c1) $id('bgColor1').value = s.c1;
    if (s.c2) $id('bgColor2').value = s.c2;
    if (s.c3) $id('bgColor3').value = s.c3;
    if (s.c4) $id('bgColor4').value = s.c4;
    if (s.base) $id('bgColorBase').value = s.base;
    if (s.glow !== undefined) {
      $id('bgGlow').value = s.glow;
      $id('bgGlowVal').textContent = s.glow;
    }
    if (s.opacity !== undefined) {
      $id('bgImageOpacity').value = s.opacity;
      $id('bgImageOpacityVal').textContent = s.opacity;
      bgImageLayer.style.opacity = Number(s.opacity) / 100;
    }
    if (s.image) {
      bgImageDataUrl = s.image;
      applyBgImage();
    }
    if (s.disableGradient !== undefined) {
      $id('disableGradientToggle').checked = !!s.disableGradient;
    }
    if (s.hideAllColorBlocks) {
      hideAllColorBlocks = true;
      $id('hideAllBgColorsBtn').textContent = '恢復顯示色塊背景';
    }
    // 舊版儲存的設定沒有主題欄位：有存過細部參數就視為自訂
    selectTheme(s.theme || (s.c1 ? 'custom' : 'deep'), false);
  } catch (err) {
    selectTheme('deep', false);
  }
})();

// ---- 操作結果：懸浮 snackbar（取代常駐狀態列） ----
const snackbar = $id('snackbar');
let snackTimer = null;
function showSnack(text) {
  text = (text || '').trim();
  if (!text) return;
  // 座標調整大視窗開著時，訊息已顯示在視窗內，不再重複浮出
  if (!$id('adjModal').hidden) return;
  const busy = /…$/.test(text);
  const warn = !busy && /請|失敗|找不到|無法|沒有|不足|不正確|至少|太細|太小|變成空/.test(text);
  $id('snackText').textContent = text;
  snackbar.classList.toggle('warn', warn);
  snackbar.classList.toggle('busy', busy);
  $id('snackIcon').setAttribute('href', warn || busy ? '#i-info' : '#i-check');
  snackbar.classList.add('show');
  clearTimeout(snackTimer);
  // 訊息越長停留越久；警示類再多留一點時間
  const ms = Math.min(9000, 2600 + text.length * 70 + (warn ? 1500 : 0));
  snackTimer = setTimeout(() => snackbar.classList.remove('show'), ms);
}
snackbar.addEventListener('click', () => { clearTimeout(snackTimer); snackbar.classList.remove('show'); });
['statusMsg', 'checkStatus'].forEach(id => {
  const el = $id(id);
  new MutationObserver(() => showSnack(el.textContent))
    .observe(el, {childList: true, characterData: true, subtree: true});
});

// ======================================================================
// v7：檢視縮放／平移、框選編輯、匯入草稿流程、中心鎖定、密度調整、自動保存
// ======================================================================

// ---- 描點畫布的檢視（縮放／平移） ----
// 畫布顯示範圍：有原圖就是原圖範圍（座標超出時一併包進來），沒有圖就用座標的外框
function fitWorld() {
  let x0, y0, x1, y1;
  if (img) { x0 = 0; y0 = 0; x1 = img.naturalWidth; y1 = img.naturalHeight; }
  const wpts = exportPoints();
  if (wpts.length) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of wpts) {
      if (p[0] < a) a = p[0];
      if (p[1] < b) b = p[1];
      if (p[0] > c) c = p[0];
      if (p[1] > d) d = p[1];
    }
    const m = Math.max(12, Math.max(c - a, d - b) * 0.08);
    a -= m; b -= m; c += m; d += m;
    if (img) { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
    else { x0 = a; y0 = b; x1 = c; y1 = d; }
  }
  contentBox = (x0 === undefined) ? null : {w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0)};
  if (x0 !== undefined) {   // 原點一定要在顯示範圍內
    x0 = Math.min(x0, origin.x - 12); y0 = Math.min(y0, origin.y - 12);
    x1 = Math.max(x1, origin.x + 12); y1 = Math.max(y1, origin.y + 12);
  }
  world = (x0 === undefined) ? null : {x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0)};
}
function pointsOutsideWorld() {
  const wpts = exportPoints();
  if (!world) return wpts.length > 0;
  for (const p of wpts) {
    if (p[0] < world.x || p[1] < world.y || p[0] > world.x + world.w || p[1] > world.y + world.h) return true;
  }
  return false;
}
function viewScale() { return baseK * view.z; }
// 讓原點落在畫面正中央（圖片偏移後，動的是圖片，原點不動）
function centerView() {
  const k = viewScale();
  view.x = origin.x - world.x - canvas.width / k / 2;
  view.y = origin.y - world.y - canvas.height / k / 2;
}
function toNaturalF(px, py) {
  const k = viewScale();
  return [px / k + world.x + view.x, py / k + world.y + view.y];
}
function toNatural(px, py) {
  const p = toNaturalF(px, py);
  return [Math.round(p[0]), Math.round(p[1])];
}
function toDisplay(nx, ny) {
  const k = viewScale();
  return [(nx - world.x - view.x) * k, (ny - world.y - view.y) * k];
}
function clampView() {
  if (!world) return;
  view.z = Math.min(32, Math.max(0.1, view.z));
  // 可以拖到圖片範圍外，只限制不要整個拖出畫面找不回來（至少留一小塊在畫面內）
  const k = viewScale(), vw = canvas.width / k, vh = canvas.height / k;
  const keepX = Math.min(world.w, vw) * 0.15, keepY = Math.min(world.h, vh) * 0.15;
  view.x = Math.min(world.w - keepX, Math.max(keepX - vw, view.x));
  view.y = Math.min(world.h - keepY, Math.max(keepY - vh, view.y));
  $id('zoomLabel').textContent = Math.round(view.z * 100) + '%';
  $id('zoomCtl').hidden = false;
}
function resetView() { view.z = 1; view.home = true; fitWorld(); if (world && canvas.width) { centerView(); clampView(); } }
function zoomAt(px, py, factor) {
  if (!world) return;
  const before = toNaturalF(px, py);
  view.home = false;
  view.z = Math.min(32, Math.max(0.1, view.z * factor));
  const k = viewScale();
  view.x = before[0] - world.x - px / k;
  view.y = before[1] - world.y - py / k;
  clampView();
  redraw();
}

// ---- 主畫布：同時是描點區與結果預覽（可切換是否顯示原圖） ----
function redraw() {
  if (!world || canvas.style.display === 'none') return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = viewScale();
  const imageView = !!(img && showImage);
  if (imageView) {
    const o = toDisplay(0, 0);
    ctx.imageSmoothingEnabled = k < 4;
    ctx.drawImage(img, o[0], o[1], img.naturalWidth * k, img.naturalHeight * k);
  } else if (img) {
    // 圖片關閉時，用細框標出原圖的範圍
    const o = toDisplay(0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(o[0], o[1], img.naturalWidth * k, img.naturalHeight * k);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(o[0] + 0.5, o[1] + 0.5, img.naturalWidth * k, img.naturalHeight * k);
  }
  const fillMode = $id('fillModeToggle').checked;
  let diameter = DEFAULT_DOT_SIZE;
  let ringR = 9;
  const vis = visibleLayers();
  const activeL = mergedOp ? vis[0] : layers[activeLayer];
  function pathOf(P, close, color, width) {
    if (P.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    P.forEach((p, i) => {
      const [dx, dy] = toDisplay(p[0], p[1]);
      if (i === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy);
    });
    if (close && P.length > 2) ctx.closePath();
    ctx.stroke();
  }
  function gapsOf(P, close) {
    ctx.save();
    ctx.strokeStyle = '#ffb020';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    const seg = (a, b) => {
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= diameter) return;
      const [x1, y1] = toDisplay(a[0], a[1]), [x2, y2] = toDisplay(b[0], b[1]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    for (let i = 0; i < P.length - 1; i++) seg(P[i], P[i + 1]);
    if (close && P.length > 2) seg(P[P.length - 1], P[0]);
    ctx.restore();
  }
  function dotsOf(P, radius, color, firstColor) {
    P.forEach((p, i) => {
      const [dx, dy] = toDisplay(p[0], p[1]);
      ctx.beginPath();
      ctx.arc(dx, dy, radius, 0, Math.PI * 2);
      ctx.fillStyle = (firstColor && i === 0) ? firstColor : color;
      ctx.fill();
    });
  }
  for (const L of vis) {
    const P = L.points;
    if (!P.length) continue;
    const isActive = L === activeL;
    diameter = validSize(L.size);   // 每個圖層用自己的標點大小與顏色
    // 標點大小與顏色在「顯示圖片」開或關時都一樣套用；作用中的圖層不透明、其他圖層淡一點
    const dotR = fillMode ? Math.max(1.5, Math.min(diameter / 2 * k, 3)) : Math.max(2, diameter / 2 * k);
    if (!fillMode) {
      if (imageView) pathOf(P, L.close, isActive ? '#ff3b30' : L.color, isActive ? 2 : 1.4);
      else if (showLines) pathOf(P, L.close, 'rgba(255,107,107,0.9)', 1.5);
      if (showLines) gapsOf(P, L.close);
    }
    dotsOf(P, dotR, dotFill(L.color, isActive || vis.length === 1 ? 1.2 : 0.6), (imageView && isActive && !fillMode) ? '#34c759' : null);
    if (isActive) ringR = dotR + 5;
  }
  if (!mergedOp && layers[activeLayer] && layers[activeLayer].visible && selectedPointIndex >= 0 && selectedPointIndex < points.length) {
    const [sx, sy] = toDisplay(points[selectedPointIndex][0], points[selectedPointIndex][1]);
    ctx.save();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawExtents();

  // 原點十字
  const [ox, oy] = toDisplay(origin.x, origin.y);
  ctx.strokeStyle = '#6ea8ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy);
  ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8);
  ctx.stroke();

  // 邊界
  const bnd = boundaryNat();
  if (bnd.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#a855f7';
    ctx.setLineDash(bnd.length >= 3 ? [6, 4] : []);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    bnd.forEach((p, i) => {
      const [dx, dy] = toDisplay(p[0], p[1]);
      if (i === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy);
    });
    if (bnd.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#a855f7';
    bnd.forEach(p => {
      const [dx, dy] = toDisplay(p[0], p[1]);
      ctx.beginPath();
      ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  drawEditOverlay();
}
// ---- 標點大小與顏色（主畫面下方直接調） ----
function dotFill(color, scale) {
  const hex = validColor(color) || '#7ab0ff';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.min(1, 0.82 * (scale || 1))})`;
}
// 下方的「標點大小／顏色」調的是作用中的圖層；切換圖層時控制項會跟著換成那個圖層的設定
function syncDotControls() {
  const L = layers[activeLayer];
  if (!L) return;
  const s = $id('dotDiameterSlider'), c = $id('dotColor');
  s.value = validSize(L.size);
  $id('dotDiameterVal').textContent = s.value;
  const col = validColor(L.color) || '#7ab0ff';
  if (c.value !== col) c.value = col;
}
$id('dotDiameterSlider').addEventListener('input', (e) => {
  const L = layers[activeLayer];
  if (L) L.size = validSize(e.target.value);
}, true);
$id('dotDiameterSlider').addEventListener('change', () => { pushHistory(); scheduleAutosave(); updateOutputs(); });
$id('dotColor').addEventListener('input', (e) => {
  const L = layers[activeLayer];
  if (L) L.color = validColor(e.target.value) || L.color;
  const d = document.querySelector('#layerList .layer-row.active .dot');
  if (d && L) d.style.background = L.color;
  redraw();
});
$id('dotColor').addEventListener('change', () => { pushHistory(); scheduleAutosave(); renderLayers(); });

// ---- 直接在畫布上標出匯出座標的 X／Y 範圍與中心 ----
function drawTag(text, x, y, color) {
  const w = ctx.measureText(text).width + 12, hh = 20;
  const bx = Math.min(canvas.width - w - 2, Math.max(2, x - w / 2));
  const by = Math.min(canvas.height - hh - 2, Math.max(2, y - hh / 2));
  ctx.fillStyle = 'rgba(12,15,22,0.86)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, w, hh, 6); else ctx.rect(bx, by, w, hh);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, bx + 6, by + hh / 2 + 0.5);
}
function drawExtents() {
  if (!$id('showExtentsToggle').checked) return;
  const all = exportPoints();
  const oScr = toDisplay(origin.x, origin.y);
  if (all.length < 2) { ctx.save(); ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'middle'; if (world) drawTag(`原點 ${centerOffset[0]}, ${centerOffset[1]}`, oScr[0], oScr[1] - 22, '#6ea8ff'); ctx.restore(); return; }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of all) {
    const r = toRelPoint(p);
    if (r[0] < minX) minX = r[0];
    if (r[0] > maxX) maxX = r[0];
    if (r[1] < minY) minY = r[1];
    if (r[1] > maxY) maxY = r[1];
  }
  // 匯出座標的範圍框換回畫面位置（套用自動旋轉後，它在畫面上會是斜的）
  const toScreen = (rx, ry) => { const n = relToNatural(rx, ry); return toDisplay(n[0], n[1]); };
  const c00 = toScreen(minX, minY), c10 = toScreen(maxX, minY), c11 = toScreen(maxX, maxY), c01 = toScreen(minX, maxY);
  const cc = toScreen((minX + maxX) / 2, (minY + maxY) / 2);
  ctx.save();
  // 先畫一層深色、再疊淺色虛線，白底或深色底的圖片上都看得到
  const frame = () => {
    ctx.beginPath();
    ctx.moveTo(c00[0], c00[1]); ctx.lineTo(c10[0], c10[1]); ctx.lineTo(c11[0], c11[1]); ctx.lineTo(c01[0], c01[1]);
    ctx.closePath();
    ctx.stroke();
  };
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(10,12,18,0.55)';
  ctx.lineWidth = 2.5;
  frame();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  frame();
  ctx.setLineDash([]);
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  const tag = drawTag;
  // 每一邊是一條 X 或 Y 固定的線：標籤放在邊的中點、往外推一點
  const edge = (a, b, text, color) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = mx - cc[0], dy = my - cc[1], len = Math.hypot(dx, dy) || 1;
    tag(text, mx + dx / len * 16, my + dy / len * 16, color);
  };
  edge(c00, c01, `X ${Math.round(minX)}`, '#6ea8ff');
  edge(c10, c11, `X ${Math.round(maxX)}`, '#6ea8ff');
  edge(c00, c10, `Y ${Math.round(minY)}`, '#3ecf8e');
  edge(c01, c11, `Y ${Math.round(maxY)}`, '#3ecf8e');
  // 中心
  ctx.strokeStyle = '#ffb020';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cc[0] - 7, cc[1]); ctx.lineTo(cc[0] + 7, cc[1]);
  ctx.moveTo(cc[0], cc[1] - 7); ctx.lineTo(cc[0], cc[1] + 7);
  ctx.stroke();
  const cxR = Math.round((minX + maxX) / 2), cyR = Math.round((minY + maxY) / 2);
  tag(`中心 ${cxR}, ${cyR}`, cc[0], cc[1] + 22, '#ffb020');
  // 原點（匯出座標 0, 0 的位置）；跟中心在同一個位置時就不重複顯示
  if (cxR !== centerOffset[0] || cyR !== centerOffset[1]) tag(`原點 ${centerOffset[0]}, ${centerOffset[1]}`, oScr[0], oScr[1] - 22, '#6ea8ff');
  ctx.restore();
}
$id('showExtentsToggle').addEventListener('change', () => { redraw(); });

// ---- 偏移：按畫面上的上下左右，把圖片（連同描好的點）相對原點移動 ----
// 原點固定在畫面中央不動；匯出座標只會加減整數。畫面方向換算成匯出座標時取最接近的八個方向之一，
// 例如自動旋轉 45°、Y 向上時，「上」= X、Y 各 + 一個基礎量。
function offsetStep() { const v = Math.round(Number($id('offsetStepInput').value)); return (isFinite(v) && v >= 1) ? v : 10; }
const NUDGE_NAMES = {'0,-1': '上', '0,1': '下', '-1,0': '左', '1,0': '右'};
function nudgeDelta(ux, uy) {
  const flip = $id('flipY').checked;
  const rad = (Number($id('autoRotateInput').value) || 0) * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const a = ux * cos - uy * sin;
  let c = ux * sin + uy * cos;
  if (flip) c = -c;
  const m = Math.max(Math.abs(a), Math.abs(c)) || 1;
  const s = offsetStep();
  return [Math.round(a / m) * s, Math.round(c / m) * s];
}
function fmtDelta(d) {
  const part = (n, v) => v ? `${n} ${v > 0 ? '+' : '−'}${Math.abs(v)}` : '';
  return [part('X', d[0]), part('Y', d[1])].filter(Boolean).join('、');
}
function syncNudgeTitles() {
  document.querySelectorAll('#nudgePad button').forEach(btn => {
    const [ux, uy] = btn.dataset.nudge.split(',').map(Number);
    const txt = `往${NUDGE_NAMES[btn.dataset.nudge]}移動（${fmtDelta(nudgeDelta(ux, uy))}）`;
    btn.title = txt + '；基礎量在設定頁調整';
    btn.setAttribute('aria-label', txt);
  });
  $id('nudgeStep').textContent = offsetStep();
}
['offsetStepInput', 'autoRotateInput', 'flipY'].forEach(id => { $id(id).addEventListener('input', syncNudgeTitles); $id(id).addEventListener('change', syncNudgeTitles); });
function doNudge(btn) {
  if (!world) { statusMsg.textContent = '還沒有圖片或座標，無法偏移。'; return false; }
  const [ux, uy] = btn.dataset.nudge.split(',').map(Number);
  const d = nudgeDelta(ux, uy);
  const k = viewScale(), scr = toDisplay(origin.x, origin.y);
  const o = relToNatural(centerOffset[0] - d[0], centerOffset[1] - d[1]);   // 原點往反方向搬，所有匯出座標就剛好加上 d（原點自己的座標值不變）
  origin = {x: o[0], y: o[1]};
  // 顯示比例不變、原點留在畫面上原本的位置，只有圖片跟著移動
  fitWorld();
  view.x = origin.x - world.x - scr[0] / k;
  view.y = origin.y - world.y - scr[1] / k;
  clampView();
  redraw();
  updateOutputs();
  const c = getRelBBoxCenter();
  statusMsg.textContent = `已往${NUDGE_NAMES[btn.dataset.nudge]}偏移（${fmtDelta(d)}）` + (c ? `，圖案中心現在在 (${Math.round(c[0])}, ${Math.round(c[1])})。` : '。');
  return true;
}
// 按一下移動一步；按住不放會連續移動（放開後整段只算一個復原步驟）
let nudgeHold = null;
function stopNudgeHold() {
  if (!nudgeHold) return;
  clearTimeout(nudgeHold.timer);
  clearInterval(nudgeHold.timer);
  nudgeHold.btn.classList.remove('holding');
  const repeated = nudgeHold.repeated, before = nudgeHold.histBefore;
  nudgeHold = null;
  if (repeated) {
    restoringState = false;
    // 第一步已經記了一筆：拿掉它，整段連續移動只留一個復原步驟
    if (before >= 0 && histIdx === before + 1) { historyStack = historyStack.slice(0, before + 1); histIdx = before; }
    pushHistory();
    scheduleAutosave();
  }
}
document.querySelectorAll('#nudgePad button').forEach(btn => {
  let skipClick = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    stopNudgeHold();
    skipClick = true;
    const histBefore = histIdx;
    if (!doNudge(btn)) return;
    nudgeHold = {btn: btn, repeated: false, timer: 0, histBefore: histBefore};
    const hold = nudgeHold;
    hold.timer = setTimeout(() => {
      if (nudgeHold !== hold) return;
      hold.repeated = true;
      restoringState = true;   // 連續移動期間先不記錄復原步驟
      btn.classList.add('holding');
      hold.timer = setInterval(() => { if (nudgeHold === hold) doNudge(btn); }, 70);
    }, 380);
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  // 只停掉「這顆按鈕」自己的連續移動（按另一顆時，前一顆會收到 blur，不能把新的也停掉）
  ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach(ev => btn.addEventListener(ev, () => { if (nudgeHold && nudgeHold.btn === btn) stopNudgeHold(); }));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // 鍵盤（Enter／空白鍵）操作走 click；滑鼠與觸控已經在 pointerdown 處理過
  btn.addEventListener('click', () => { if (skipClick) { skipClick = false; return; } doNudge(btn); });
});
window.addEventListener('blur', stopNudgeHold);
syncNudgeTitles();

$id('toggleImageBtn').addEventListener('click', () => {
  showImage = !showImage;
  $id('toggleImageBtn').classList.toggle('active', showImage);
  $id('toggleImageBtn').setAttribute('aria-pressed', showImage ? 'true' : 'false');
  $id('toggleImageLabel').textContent = showImage ? '顯示圖片：開' : '顯示圖片：關';
  if (showImage && !img) statusMsg.textContent = '目前沒有原圖（只有座標），所以畫面上只會顯示座標點。';
  redraw();
  renderPreview();
});

canvas.addEventListener('wheel', (e) => {
  if (!world) return;
  e.preventDefault();
  const [px, py] = canvasPointFromEvent(e);
  zoomAt(px, py, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, {passive: false});
$id('zoomInBtn').addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 1.4));
$id('zoomOutBtn').addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.4));
$id('zoomLabel').addEventListener('click', () => { resetView(); setupCanvas(); redraw(); });

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
  const onCanvasScreen = !typing && $id('adjModal').hidden && !$id('view-work').hidden;
  if (e.code === 'Space' && onCanvasScreen) { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && onCanvasScreen && world) {
    if (selectedSet.size || selectedPointIndex >= 0) { e.preventDefault(); $id('deleteSelectedPointBtn').click(); }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; canvas.style.cursor = ''; }
});

// ---- 框選／多選編輯、平移拖曳 ----
function pointerCanvasScale() {
  const rect = canvas.getBoundingClientRect();
  return canvas.width / rect.width;
}
canvas.addEventListener('pointerdown', (e) => {
  if (!world) return;
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panDrag = {cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y};
    view.home = false;
    if (e.button === 0) suppressClick = true;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (mode === 'brush' && e.button === 0) {
    if (!img) { statusMsg.textContent = '筆觸描邊需要先選擇圖片。'; return; }
    const [bx, by] = canvasPointFromEvent(e);
    strokeDrag = {pts: [toNaturalF(bx, by)]};
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (mode !== 'select' || e.button !== 0) return;
  const [px, py] = canvasPointFromEvent(e);
  const idx = findNearestPointIndex(px, py, 10);
  if (idx !== -1) {
    if (e.shiftKey) {
      if (selectedSet.has(idx)) selectedSet.delete(idx); else selectedSet.add(idx);
    } else if (!selectedSet.has(idx)) {
      selectedSet.clear();
      selectedSet.add(idx);
    }
    selDrag = {type: 'move', last: toNaturalF(px, py), moved: false};
  } else {
    if (!e.shiftKey) selectedSet.clear();
    selDrag = {type: 'box', x0: px, y0: py, x1: px, y1: py, base: new Set(selectedSet)};
  }
  selectedPointIndex = -1;
  canvas.setPointerCapture(e.pointerId);
  redraw();
});
canvas.addEventListener('pointermove', (e) => {
  if (panDrag) {
    const k = viewScale() / pointerCanvasScale();
    view.x = panDrag.vx - (e.clientX - panDrag.cx) / k;
    view.y = panDrag.vy - (e.clientY - panDrag.cy) / k;
    clampView();
    redraw();
    return;
  }
  if (strokeDrag) {
    const [bx, by] = canvasPointFromEvent(e);
    strokeDrag.pts.push(toNaturalF(bx, by));
    redraw();
    return;
  }
  if (!selDrag) return;
  const [px, py] = canvasPointFromEvent(e);
  if (selDrag.type === 'move') {
    const cur = toNaturalF(px, py);
    const dx = cur[0] - selDrag.last[0], dy = cur[1] - selDrag.last[1];
    selectedSet.forEach(i => { if (points[i]) points[i] = [points[i][0] + dx, points[i][1] + dy]; });
    selDrag.last = cur;
    selDrag.moved = true;
  } else {
    selDrag.x1 = px; selDrag.y1 = py;
    const xa = Math.min(selDrag.x0, px), xb = Math.max(selDrag.x0, px);
    const ya = Math.min(selDrag.y0, py), yb = Math.max(selDrag.y0, py);
    selectedSet.clear();
    selDrag.base.forEach(i => selectedSet.add(i));
    for (let i = 0; i < points.length; i++) {
      const [dx, dy] = toDisplay(points[i][0], points[i][1]);
      if (dx >= xa && dx <= xb && dy >= ya && dy <= yb) selectedSet.add(i);
    }
  }
  redraw();
});
function endEditDrag() {
  if (panDrag) { panDrag = null; return; }
  if (strokeDrag) { finishStroke(); return; }
  if (!selDrag) return;
  const d = selDrag;
  selDrag = null;
  if (d.type === 'move' && d.moved) {
    selectedSet.forEach(i => { if (points[i]) points[i] = [Math.round(points[i][0]), Math.round(points[i][1])]; });
    keepSelectionOnce = true;
    updateOutputs();
  }
  redraw();
  if (d.type === 'box') statusMsg.textContent = selectedSet.size ? `已框選 ${selectedSet.size} 個點，可以拖曳移動，或按 Delete／「刪除選取的點」。` : '';
}
canvas.addEventListener('pointerup', endEditDrag);
canvas.addEventListener('pointercancel', endEditDrag);

function drawEditOverlay() {
  if (strokeDrag && strokeDrag.pts.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(45,212,191,0.95)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    strokeDrag.pts.forEach((p, i) => {
      const [dx, dy] = toDisplay(p[0], p[1]);
      if (i === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy);
    });
    ctx.stroke();
    ctx.restore();
  }
  if (selectedSet.size) {
    ctx.save();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    selectedSet.forEach(i => {
      if (!points[i]) return;
      const [sx, sy] = toDisplay(points[i][0], points[i][1]);
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }
  if (selDrag && selDrag.type === 'box') {
    ctx.save();
    ctx.strokeStyle = '#ffcc00';
    ctx.fillStyle = 'rgba(255,204,0,0.12)';
    ctx.setLineDash([5, 4]);
    const x = Math.min(selDrag.x0, selDrag.x1), y = Math.min(selDrag.y0, selDrag.y1);
    const w = Math.abs(selDrag.x1 - selDrag.x0), h = Math.abs(selDrag.y1 - selDrag.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
function deleteSelectedSet() {
  if (!selectedSet.size) return false;
  const n = selectedSet.size;
  points = points.filter((p, i) => !selectedSet.has(i));
  selectedSet.clear();
  selectedPointIndex = -1;
  redraw();
  updateOutputs();
  statusMsg.textContent = `已刪除 ${n} 個選取的點，目前剩下 ${points.length} 個座標點。`;
  return true;
}
// Shift+點擊：把新點插進最近的那一段線中間（而不是接在最後面）
function insertAtNearestSegment(nx, ny) {
  let best = -1, bestD = Infinity;
  const segCount = (closeToggle.checked && points.length > 2) ? points.length : points.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.min(1, Math.max(0, ((nx - a[0]) * vx + (ny - a[1]) * vy) / len2));
    const d = Math.hypot(nx - (a[0] + t * vx), ny - (a[1] + t * vy));
    if (d < bestD) { bestD = d; best = i; }
  }
  points.splice(best + 1, 0, [nx, ny]);
  selectedPointIndex = best + 1;
  statusMsg.textContent = `已在第 ${best + 1} 與第 ${best + 2} 點之間插入新點。`;
}
$id('modeSelect').addEventListener('click', () => {
  dropPick();
  mode = 'select';
  syncModeButtons();
  $id('modeHint').textContent = '框選模式：在空白處拖曳可以框選多個點（按住 Shift 可加選／取消單點）；拖曳已選取的點會整組一起移動；按 Delete 或「刪除選取的點」一次刪除。';
});
['modeManual', 'modeWand'].forEach(id => $id(id).addEventListener('click', () => {
  $id('modeSelect').classList.remove('primary');
  $id('modeBrush').classList.remove('primary');
  selectedSet.clear();
  redraw();
}));
$id('clearBtn').addEventListener('click', () => { selectedSet.clear(); if (!img) { resetView(); setupCanvas(); } });

function updateImportPreview() {
  const im = $id('importPreviewImg');
  if (img && img.src) { im.src = img.src; im.hidden = false; $id('importPreviewEmpty').hidden = true; }
  else { im.hidden = true; $id('importPreviewEmpty').hidden = false; }
}
// 頂部「匯入圖片」：一律重新選取圖片（不會沿用上一張）
$id('importImageBtn').addEventListener('click', () => { $id('fileInput').click(); });
// 選同一個檔案也要能再觸發一次
$id('fileInput').addEventListener('click', () => { $id('fileInput').value = ''; });
function clearDetections() {
  updateImportPreview();
  resetSelectionMask();
  pendingPoints = null;
  selectedSet.clear();
}

// ---- 邊界角點的兩種座標空間 ----
// 在圖上點的角點是原圖像素座標；直接輸入數字的角點是匯出（遊戲）座標。
function boundaryRel() { return boundarySpace === 'rel' ? boundaryPoints : boundaryPoints.map(toRelPoint); }
function boundaryNat() { return boundarySpace === 'rel' ? boundaryPoints.map(p => relToNatural(p[0], p[1])) : boundaryPoints; }

function refreshCenterOffset() {}   // centerOffset 現在是「原點的座標值」（在設定原點視窗輸入），不再自動推算

// ---- 匯出時去除重複座標 ----
function getRelPoints() {
  const raw = getRelPointsRaw();
  lastDupRemoved = 0;
  if (!$id('dedupeToggle').checked) return raw;
  const seen = new Set(), out = [];
  for (const p of raw) {
    const key = p[0] + ',' + p[1];
    if (seen.has(key)) { lastDupRemoved++; continue; }
    seen.add(key);
    out.push(p);
  }
  return out;
}
$id('dedupeToggle').addEventListener('change', () => { updateOutputs(); });
$id('maxCountInput').addEventListener('input', () => { renderPreview(); updateDensityInfo(); });
function getMaxCount() {
  const v = Number($id('maxCountInput').value);
  return v > 0 ? v : 0;
}

// ---- 密度調整：設定最小間隔，把太密的點刪掉 ----
function thinPoints(src, minDist) {
  if (!(minDist > 0)) return src.slice();
  const cell = minDist, grid = new Map(), out = [];
  const d2 = minDist * minDist;
  for (const p of src) {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    let ok = true;
    for (let ix = gx - 1; ix <= gx + 1 && ok; ix++) {
      for (let iy = gy - 1; iy <= gy + 1 && ok; iy++) {
        const bucket = grid.get(ix + ':' + iy);
        if (!bucket) continue;
        for (const q of bucket) {
          const dx = q[0] - p[0], dy = q[1] - p[1];
          if (dx * dx + dy * dy < d2) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const key = gx + ':' + gy;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
    out.push(p);
  }
  return out;
}
function thinnedExportCount(d) {
  let all = [];
  for (const L of visibleLayers()) all = all.concat(thinPoints(L.points, d));
  const keepPts = points, keepFlag = mergedOp;
  points = all; mergedOp = true;
  const n = getRelPoints().length;
  points = keepPts; mergedOp = keepFlag;
  return n;
}
function applyThin(d) {
  syncActiveLayer();
  layers.forEach(L => { if (L.visible) L.points = thinPoints(L.points, d); });
  points = layers[activeLayer].points;
  lastPointCount = points.length;
}
function updateDensityInfo() {
  const el = $id('densityInfo');
  if (!el) return;
  const n = exportPoints().length ? getRelPoints().length : 0;
  const max = getMaxCount();
  const over = max && n > max;
  el.innerHTML = `目前匯出 <b style="color:${over ? 'var(--warn)' : 'var(--text)'}">${n}</b> 個座標` +
    (max ? `，上限 ${max}${over ? `（超過 ${n - max} 個）` : '（在上限內）'}。` : '。');
}
$id('thinApplyBtn').addEventListener('click', () => {
  const st = $id('densityStatus');
  const d = Number($id('minGapInput').value);
  const before = exportPoints().length;
  if (!before) { st.textContent = '目前沒有座標。'; return; }
  if (!(d > 0)) { st.textContent = '請輸入大於 0 的最小間隔。'; return; }
  applyThin(d);
  redraw();
  updateOutputs();
  st.textContent = `已依最小間隔 ${d} 精簡：${before} → ${exportPoints().length} 個點（同一個圖層內任兩點的距離都不小於 ${d}）。`;
});
$id('thinAutoBtn').addEventListener('click', () => {
  const st = $id('densityStatus');
  const max = getMaxCount();
  const before = exportPoints().length;
  if (!before) { st.textContent = '目前沒有座標。'; return; }
  if (!max) { st.textContent = '請先在「設定」頁填入裝飾物數量上限。'; return; }
  if (getRelPoints().length <= max) { st.textContent = `目前已在上限 ${max} 以內，不需要精簡。`; return; }
  let lo = 0, hi = 1;
  while (thinnedExportCount(hi) > max && hi < 1e6) hi *= 2;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (thinnedExportCount(mid) > max) lo = mid; else hi = mid;
  }
  applyThin(hi);
  $id('minGapInput').value = Math.round(hi * 100) / 100;
  redraw();
  updateOutputs();
  st.textContent = `已自動精簡到上限以內：${before} → ${exportPoints().length} 個點，使用的最小間隔約 ${Math.round(hi * 100) / 100}。`;
});

// ---- 依「總點數」取樣 ----
function polylineLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return L;
}
// 沿著折線依弧長等距取 n 個點（會在線段中間內插，所以直線邊也能均勻佈點）
function resampleEven(pts, n) {
  const L = polylineLength(pts);
  if (n <= 0 || pts.length < 2 || L === 0) return pts.slice(0, Math.max(0, n));
  const out = [];
  const step = L / n;
  let seg = 0, segStart = 0;
  let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < pts.length - 2 && segStart + segLen < target) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(pts[seg + 1].x - pts[seg].x, pts[seg + 1].y - pts[seg].y);
    }
    const t = segLen ? Math.min(1, (target - segStart) / segLen) : 0;
    out.push({x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t});
  }
  return out;
}
// 多條輪廓：依各自長度的比例分配點數，總和剛好等於 n
function resampleContoursToCount(paths, n) {
  const lens = paths.map(polylineLength);
  const total = lens.reduce((a, b) => a + b, 0);
  if (!paths.length || total === 0) return [];
  const counts = lens.map(l => Math.max(paths.length > 1 ? 1 : 0, Math.round(n * l / total)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  const order = lens.map((l, i) => i).sort((a, b) => lens[b] - lens[a]);
  for (let i = 0; diff !== 0 && i < 100000; i++) {
    const idx = order[i % order.length];
    if (diff > 0) { counts[idx]++; diff--; }
    else if (counts[idx] > 1) { counts[idx]--; diff++; }
  }
  let out = [];
  paths.forEach((p, i) => { out = out.concat(resampleEven(p, counts[i])); });
  return out;
}
// 沒辦法內插的取樣方式（中心線、網格）：調整間距逼近目標數量，多出來的再平均抽掉
function fitToCount(run, n) {
  let lo = 0.5, hi = 1, r = run(hi), best = r;
  while (r.length > n && hi < 4096) { lo = hi; hi *= 2; r = run(hi); }
  const score = (arr) => (arr.length >= n ? arr.length - n : (n - arr.length) * 1000);
  if (score(r) < score(best)) best = r;
  for (let i = 0; i < 22 && best.length !== n; i++) {
    const mid = (lo + hi) / 2;
    r = run(mid);
    if (score(r) < score(best)) best = r;
    if (r.length > n) lo = mid; else hi = mid;
  }
  if (best.length > n) {
    const out = [];
    for (let k = 0; k < n; k++) out.push(best[Math.floor(k * best.length / n)]);
    return out;
  }
  return best;
}
function sampleComponents(comps, useCenterline) {
  const W = sampleCanvas.width, H = sampleCanvas.height;
  const samplers = comps.map(c => {
    if (useCenterline) {
      const ordered = orderSkeletonPath(pruneSkeletonSpurs(thinMask(c.mask, W, H), W, H, 8), W, H);
      return (sp) => resampleBySpacing(ordered, sp);
    }
    return (sp) => fillSampleMask(c.mask, W, H, sp);
  });
  const run = (sp) => samplers.reduce((acc, f) => acc.concat(f(sp)), []);
  const n = getTargetCount();
  return n ? fitToCount(run, n) : run(Number($id('spacingSlider').value) || 3);
}
$id('targetCountInput').addEventListener('input', () => {
  const n = getTargetCount();
  $id('modeHintCount').textContent = n
    ? `已設定總點數 ${n}：下一次選取或偵測套用時，會直接產生這麼多個點（圖案太小、像素不夠時會少於這個數字）。`
    : '總點數留空：依「設定 › 取樣與偵測」的點位間距取樣。';
});

// ---- 每次座標變動時的共用處理 ----
function onPointsChanged() {
  if (mergedOp) { refreshCenterOffset(); return; }
  if (!layers.length) resetLayers();
  syncActiveLayer();
  if (points.length !== lastPointCount && !keepSelectionOnce) selectedSet.clear();
  keepSelectionOnce = false;
  lastPointCount = points.length;
  refreshCenterOffset();
  // 座標跑到畫面範圍外（例如縮放、平移、貼上座標之後）就重新調整顯示範圍
  if (!selDrag && !strokeDrag && !isDraggingPoint && (pointsOutsideWorld() || (!img && !exportPoints().length && world))) {
    resetView();
    setupCanvas();
  }
  pushHistory();
  renderLayers();
  updateDensityInfo();
  scheduleAutosave();
}

// ---- 預覽：原圖對照、滑鼠提示、點選 ----
const pvTip = $id('pvTip');
// 主畫布：滑鼠移到點上顯示序號與匯出座標
canvas.addEventListener('mousemove', (e) => {
  if (!world || panDrag || selDrag || strokeDrag || isDraggingPoint || !points.length) { pvTip.hidden = true; return; }
  const [px, py] = canvasPointFromEvent(e);
  const i = findNearestPointIndex(px, py, 9);
  if (i < 0) { pvTip.hidden = true; return; }
  const r = toRelPoint(points[i]);
  pvTip.textContent = `#${i + 1}　x=${Math.round(r[0])}, y=${Math.round(r[1])}`;
  pvTip.hidden = false;
  pvTip.style.left = Math.min(window.innerWidth - 190, e.clientX + 14) + 'px';
  pvTip.style.top = (e.clientY + 16) + 'px';
});
canvas.addEventListener('mouseleave', () => { $id('pvTip').hidden = true; });
function nearestPreviewPoint(e) {
  if (!heroHit || heroHit.length > 30000) return -1;
  const rect = previewCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  let best = -1, bestD = 12 * 12;
  for (let i = 0; i < heroHit.length; i++) {
    const dx = heroHit[i][0] - x, dy = heroHit[i][1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
previewCanvas.addEventListener('mousemove', (e) => {
  const i = nearestPreviewPoint(e);
  if (i < 0 || !points[i]) { pvTip.hidden = true; previewCanvas.style.cursor = 'default'; return; }
  const r = toRelPoint(points[i]);
  pvTip.textContent = `#${i + 1}　x=${Math.round(r[0])}, y=${Math.round(r[1])}`;
  pvTip.hidden = false;
  pvTip.style.left = Math.min(window.innerWidth - 190, e.clientX + 14) + 'px';
  pvTip.style.top = (e.clientY + 16) + 'px';
  previewCanvas.style.cursor = 'pointer';
});
previewCanvas.addEventListener('mouseleave', () => { pvTip.hidden = true; });
previewCanvas.addEventListener('click', (e) => {
  const i = nearestPreviewPoint(e);
  selectedPointIndex = i;
  if (img) redraw();
  renderPreview();
  if (i >= 0) {
    const r = toRelPoint(points[i]);
    statusMsg.textContent = `已選取第 ${i + 1} 個點，匯出座標 (${Math.round(r[0])}, ${Math.round(r[1])})。`;
  }
});

// ---- 處理中提示：耗時的動作先顯示提示再開始算（計算期間畫面仍會暫停回應） ----
const BUSY_SEL = '#runDetectBtn, #autoOuterBtn, #thinApplyBtn, #thinAutoBtn, #parseReplaceBtn';
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest(BUSY_SEL);
  if (!el) return;
  if (el.dataset.busyPass) { delete el.dataset.busyPass; return; }
  e.stopImmediatePropagation();
  e.preventDefault();
  $id('busy').hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.dataset.busyPass = '1';
    el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: e.shiftKey, altKey: e.altKey}));
    setTimeout(() => { $id('busy').hidden = true; }, 140);
  }));
}, true);

// ---- 自動保存工作進度（只存在這台裝置的這個瀏覽器裡） ----
const SESSION_KEY = 'traceToolSessionV7';
let autosaveTimer = null, sessionReady = false;
function buildSessionData(withImage) {
  return {
    v: 9,
    layers: (syncActiveLayer(), layers.map(L => ({name: L.name, visible: L.visible, close: L.close, color: L.color, size: L.size, points: L.points}))),
    active: activeLayer,
    origin: {x: origin.x, y: origin.y},
    originValue: [centerOffset[0], centerOffset[1]],
    boundary: boundaryPoints.map(p => [p[0], p[1]]),
    boundarySpace: boundarySpace,
    image: (withImage && img && img.src && img.src.indexOf('data:') === 0) ? img.src : null
  };
}
function saveSessionNow() {
  if (!sessionReady) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(buildSessionData(true)));
    $id('sessionStatus').textContent = '進度已自動保存（含原圖）。';
  } catch (err) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(buildSessionData(false)));
      $id('sessionStatus').textContent = '進度已自動保存（原圖太大，瀏覽器空間不足，只保存了座標）。';
    } catch (err2) {
      $id('sessionStatus').textContent = '自動保存失敗（瀏覽器儲存空間不足或被停用）。';
    }
  }
}
function scheduleAutosave() {
  if (!sessionReady) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveSessionNow, 600);
}
function applySessionData(s, done) {
  // 舊版專案檔只有一份 points：當成單一圖層讀進來
  loadLayersFrom(Array.isArray(s.layers) ? s.layers : [{name: '圖層 1', points: s.points || [], close: !!s.close}], s.active);
  clearHistory();
  renderLayers();
  origin = (s.origin && typeof s.origin.x === 'number') ? {x: s.origin.x, y: s.origin.y} : {x: 0, y: 0};
  centerOffset = (Array.isArray(s.originValue) && isFinite(s.originValue[0]) && isFinite(s.originValue[1])) ? [Math.round(s.originValue[0]), Math.round(s.originValue[1])] : [0, 0];
  boundaryPoints = Array.isArray(s.boundary) ? s.boundary.map(p => [Number(p[0]), Number(p[1])]) : [];
  boundarySpace = s.boundarySpace === 'rel' ? 'rel' : 'nat';
  selectedPointIndex = -1;
  selectedSet.clear();
  const finish = () => { resetView(); setupCanvas(); redraw(); updateOutputs(); if (done) done(); };
  if (s.image) {
    const im = new Image();
    im.onload = () => { img = im; clearDetections(); finish(); };
    im.onerror = () => { finish(); };
    im.src = s.image;
  } else {
    finish();
  }
}
$id('downloadProjectBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildSessionData(true))], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '描邊座標專案.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $id('sessionStatus').textContent = '已下載專案檔。';
});
$id('loadProjectFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const s = JSON.parse(ev.target.result);
      if (!s || !(Array.isArray(s.points) || Array.isArray(s.layers))) throw new Error('format');
      applySessionData(s, () => { $id('sessionStatus').textContent = `已載入專案檔，共 ${layers.length} 個圖層、${exportPoints().length} 個點。`; });
    } catch (err) {
      $id('sessionStatus').textContent = '這不是有效的專案檔。';
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});
$id('clearSessionBtn').addEventListener('click', () => {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  $id('sessionStatus').textContent = '已清除保存在瀏覽器裡的進度（目前畫面上的座標不受影響，之後有變動仍會再次自動保存）。';
});
(function restoreSession() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
  if (s && (Array.isArray(s.layers) || Array.isArray(s.points)) && ((s.layers || []).some(L => L.points && L.points.length) || (s.points || []).length || s.image)) {
    applySessionData(s, () => {
      sessionReady = true;
      if (exportPoints().length) statusMsg.textContent = `已還原上次的進度，共 ${layers.length} 個圖層、${exportPoints().length} 個座標點。`;
    });
  } else {
    sessionReady = true;
  }
})();
if (!layers.length) resetLayers();
syncDetectFields();
$id('detectTolerance').value = $id('toleranceSlider').value;
$id('detectToleranceVal').textContent = $id('toleranceSlider').value;
pushHistory();
$id('modeSelect').click();   // 預設使用框選模式
updateDensityInfo();
$id('targetCountInput').dispatchEvent(new Event('input'));

// ======================================================================
// v9：圖層、復原／重做、自動偵測（直接建立圖層）、筆觸描邊
// ======================================================================

// `points` 永遠是「目前作用中圖層」的點；匯出、統計、預覽用的是所有顯示中的圖層
function syncActiveLayer() {
  const L = layers[activeLayer];
  if (L) { L.points = points; L.close = closeToggle.checked; }
}
function visibleLayers() {
  if (mergedOp) { const A = layers[activeLayer] || {}; return [{points: points, close: false, color: A.color || LAYER_COLORS[0], size: A.size}]; }
  syncActiveLayer();
  return layers.filter(L => L.visible);
}
function exportPoints() {
  if (mergedOp) return points;
  const vis = visibleLayers();
  if (vis.length === 1) return vis[0].points;
  let out = [];
  for (const L of vis) out = out.concat(L.points);
  return out;
}
function newLayer(name, pts, close, used) {
  layerSeq++;
  return {id: layerSeq, name: name || `圖層 ${layerSeq}`, visible: true, close: close === undefined ? true : !!close, points: pts || [], color: pickLayerColor(used || layers), size: DEFAULT_DOT_SIZE};
}
function resetLayers(name) {
  layerSeq = 0;
  layers = [newLayer(name || '圖層 1', points, closeToggle.checked, [])];
  activeLayer = 0;
  renderLayers();
}
function setActiveLayer(i, silent) {
  if (i < 0 || i >= layers.length) return;
  syncActiveLayer();
  activeLayer = i;
  points = layers[i].points;
  closeToggle.checked = layers[i].close;
  selectedPointIndex = -1;
  selectedSet.clear();
  lastPointCount = points.length;
  renderLayers();
  if (!silent) { redraw(); updateOutputs(); }
}
function renderLayers() {
  syncDotControls();
  const list = $id('layerList');
  // 正在改圖層名稱時不重建清單（才不會把輸入中的文字洗掉），但作用中標記、顏色、點數仍要就地更新
  if (!list) return;
  if (list.contains(document.activeElement) && list.querySelectorAll('.layer-row').length === layers.length) { updateLayerCounts(); return; }
  list.innerHTML = '';
  layers.forEach((L, i) => {
    const row = document.createElement('div');
    row.className = 'layer-row' + (i === activeLayer ? ' active' : '') + (L.visible ? '' : ' off');
    row.dataset.i = i;
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'eye icon-only';
    eye.title = L.visible ? '隱藏這個圖層（不會匯出）' : '顯示這個圖層';
    eye.innerHTML = `<svg class="ic"><use href="#${L.visible ? 'i-eye' : 'i-eyeoff'}"/></svg>`;
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      syncActiveLayer();
      L.visible = !L.visible;
      renderLayers(); redraw(); updateOutputs();
    });
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = L.color;
    const name = document.createElement('input');
    name.className = 'lname';
    name.value = L.name;
    name.title = '點一下可以改名';
    name.addEventListener('change', () => { L.name = name.value.trim() || L.name; name.value = L.name; pushHistory(); scheduleAutosave(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = L.points.length;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del icon-only';
    del.title = '刪除這個圖層';
    del.innerHTML = '<svg class="ic"><use href="#i-x"/></svg>';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(i); });
    row.addEventListener('click', (e) => { if (e.target !== name || i !== activeLayer) setActiveLayer(i); });
    row.appendChild(eye); row.appendChild(dot); row.appendChild(name); row.appendChild(cnt); row.appendChild(del);
    list.appendChild(row);
  });
  $id('layerSummary').textContent = `${layers.length} 個圖層`;
  $id('layersTabCount').textContent = layers.length;
}
function updateLayerCounts() {
  const list = $id('layerList');
  if (!list) return;
  list.querySelectorAll('.layer-row').forEach(row => {
    const L = layers[Number(row.dataset.i)];
    if (!L) return;
    const i = Number(row.dataset.i);
    row.querySelector('.cnt').textContent = L.points.length;
    row.classList.toggle('active', i === activeLayer);
    row.classList.toggle('off', !L.visible);
    const d = row.querySelector('.dot');
    if (d) d.style.background = L.color;
  });
}
function deleteLayer(i) {
  syncActiveLayer();
  if (layers.length === 1) {
    layers[0].points = [];
    points = layers[0].points;
  } else {
    layers.splice(i, 1);
    if (activeLayer > i || activeLayer >= layers.length) activeLayer = Math.max(0, activeLayer - 1);
    points = layers[activeLayer].points;
    closeToggle.checked = layers[activeLayer].close;
  }
  selectedPointIndex = -1;
  selectedSet.clear();
  lastPointCount = points.length;
  renderLayers(); redraw(); updateOutputs();
}
// 圖層面板：固定在右側，或摺疊成畫布角落的小按鈕（點了以懸浮面板顯示）。狀態會記住。
function setLayersCollapsed(on, showFloating) {
  const panel = $id('layerPanel'), pill = $id('layersPill');
  if (on) {
    canvasWrap.appendChild(panel);
    panel.classList.add('floating');
    panel.hidden = !showFloating;
    pill.hidden = false;
    pill.setAttribute('aria-expanded', showFloating ? 'true' : 'false');
  } else {
    const body = document.querySelector('.preview-body');
    body.insertBefore(panel, body.querySelector('.rail-right'));
    panel.classList.remove('floating');
    panel.hidden = false;
    pill.hidden = true;
  }
  try { localStorage.setItem('traceToolLayersCollapsed', on ? '1' : '0'); } catch (e) {}
}
$id('toggleLayersBtn').addEventListener('click', () => setLayersCollapsed(true, false));
$id('pinLayersBtn').addEventListener('click', () => setLayersCollapsed(false));
$id('closeLayersBtn').addEventListener('click', () => setLayersCollapsed(true, false));
$id('layersPill').addEventListener('click', () => setLayersCollapsed(true, $id('layerPanel').hidden));
try { if (localStorage.getItem('traceToolLayersCollapsed') === '1') setLayersCollapsed(true, false); } catch (e) {}
$id('addLayerBtn').addEventListener('click', () => {
  syncActiveLayer();
  layers.push(newLayer());
  setActiveLayer(layers.length - 1);
  statusMsg.textContent = `已新增「${layers[activeLayer].name}」，接下來描的點會放在這個圖層。`;
});
$id('showAllLayersBtn').addEventListener('click', () => {
  layers.forEach(L => { L.visible = true; });
  renderLayers(); redraw(); updateOutputs();
});
$id('mergeLayersBtn').addEventListener('click', () => {
  syncActiveLayer();
  const vis = layers.filter(L => L.visible);
  if (vis.length < 2) { statusMsg.textContent = '至少要有兩個顯示中的圖層才能合併。'; return; }
  let all = [];
  vis.forEach(L => { all = all.concat(L.points); });
  const merged = newLayer('合併圖層', all, false, layers.filter(L => !L.visible));
  merged.color = vis[0].color; merged.size = vis[0].size;
  layers = layers.filter(L => !L.visible).concat([merged]);
  activeLayer = layers.length - 1;
  points = merged.points;
  closeToggle.checked = false;
  lastPointCount = points.length;
  renderLayers(); redraw(); updateOutputs();
  statusMsg.textContent = `已把 ${vis.length} 個顯示中的圖層合併成一個，共 ${all.length} 個點。`;
});
closeToggle.addEventListener('change', () => { syncActiveLayer(); });
// 「清除全部」算一個步驟：先暫停記錄，等圖層也重設完再記一次，Ctrl+Z 一次就能救回來
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#clearBtn')) restoringState = true; }, true);
$id('clearBtn').addEventListener('click', () => { restoringState = false; resetLayers(); redraw(); updateOutputs(); });

// 多圖層時，SVG 每個圖層各自是一段路徑
function buildSvgPath(rel) {
  if ($id('fillModeToggle').checked) return rel.map(p => `M ${p[0]} ${p[1]}`).join(' ');
  return visibleLayers().filter(L => L.points.length).map(L => {
    const r = L.points.map(p => { const q = toRelPoint(p); return [Math.round(q[0]), Math.round(q[1])]; });
    let d = r.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
    if (L.close && r.length > 2) d += ' Z';
    return d;
  }).join(' ');
}
// 間距統計：每個圖層各自計算，不會把圖層之間的跳接算成斷開
function layerGapStats() {
  const dists = [];
  let gaps = 0;
  const sizes = new Set();
  for (const L of visibleLayers()) {
    const P = L.points, m = P.length, dia = validSize(L.size);
    if (m) sizes.add(dia);
    const add = d => { dists.push(d); if (d > dia) gaps++; };
    for (let i = 0; i < m - 1; i++) add(Math.hypot(P[i][0] - P[i + 1][0], P[i][1] - P[i + 1][1]));
    if (L.close && m > 2) add(Math.hypot(P[m - 1][0] - P[0][0], P[m - 1][1] - P[0][1]));
  }
  const list = [...sizes];
  return {dists: dists, diameter: list.length === 1 ? list[0] : (list.length ? '各圖層' : validSize((layers[activeLayer] || {}).size)), gaps: gaps};
}
function updateSimStats() {
  const statsEl = $id('simStats');
  if (!statsEl) return;
  const total = exportPoints().length;
  if ($id('fillModeToggle').checked) {
    statsEl.textContent = total ? `目前為實心填滿模式，共 ${total} 個座標點（網格取樣，不計算順序間距）。` : '目前沒有座標。';
    return;
  }
  const s = layerGapStats();
  if (!s.dists.length) { statsEl.textContent = '目前點數不足，無法計算間距。'; return; }
  const sorted = s.dists.slice().sort((a, b) => a - b);
  const avg = s.dists.reduce((a, b) => a + b, 0) / s.dists.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  statsEl.innerHTML = `目前共 ${total} 個點，${s.dists.length} 段間距（各圖層分開計算）。<br>平均間距 ${avg.toFixed(2)}，中位數 ${median.toFixed(2)}，最小 ${sorted[0].toFixed(2)}，最大 ${sorted[sorted.length - 1].toFixed(2)}。<br>裝飾物直徑設為 ${s.diameter}：目前有 <b style="color:${s.gaps > 0 ? '#ff6b6b' : 'inherit'}">${s.gaps}</b> 段間距大於直徑，可能會斷開不連貫。`;
}

// ---- 作用於「整個圖案」的調整（旋轉、縮放、翻轉）：先把所有顯示中的圖層合在一起算，再拆回去 ----
const MERGE_SEL = '#applyRotateBtn, #applyScaleBtn, #checkFlipHBtn, #checkFlipVBtn, #checkRotateBtn';
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest(MERGE_SEL);
  if (!el || mergedOp) return;
  syncActiveLayer();
  const vis = layers.filter(L => L.visible);
  if (layers.length === 1 && vis.length === 1) return;
  mergedSizes = vis.map(L => L.points.length);
  let all = [];
  vis.forEach(L => { all = all.concat(L.points); });
  points = all;
  mergedOp = true;
}, true);
document.addEventListener('click', () => {
  if (!mergedOp) return;
  const vis = layers.filter(L => L.visible);
  const total = mergedSizes.reduce((a, b) => a + b, 0);
  if (points.length === total) {
    let k = 0;
    vis.forEach((L, i) => { L.points = points.slice(k, k + mergedSizes[i]); k += mergedSizes[i]; });
  }
  mergedOp = false;
  mergedSizes = null;
  points = layers[activeLayer].points;
  lastPointCount = points.length;
  redraw();
  updateOutputs();
});

// ---- 復原／重做 ----
function snapshotState() {
  syncActiveLayer();
  return JSON.stringify({
    layers: layers.map(L => ({name: L.name, visible: L.visible, close: L.close, color: L.color, size: L.size, points: L.points})),
    origin: origin, originValue: centerOffset, boundary: boundaryPoints, boundarySpace: boundarySpace
  });
}
function updateUndoButtons() {
  $id('undoBtn').disabled = histIdx <= 0;
  $id('redoBtn').disabled = histIdx >= historyStack.length - 1;
}
function pushHistory() {
  if (restoringState || mergedOp) return;
  const s = snapshotState();
  if (histIdx >= 0 && historyStack[histIdx] === s) return;
  historyStack = historyStack.slice(0, histIdx + 1);
  historyStack.push(s);
  if (historyStack.length > 120) historyStack.shift();
  histIdx = historyStack.length - 1;
  stateSeq++;
  updateUndoButtons();
}
function clearHistory() { historyStack = []; histIdx = -1; }
function loadLayersFrom(list, active) {
  layerSeq = 0;
  const src = (Array.isArray(list) && list.length ? list : [{points: []}]);
  const out = [];
  src.forEach((L, i) => {
    // 還沒指定顏色的圖層，要避開清單裡其他圖層已經指定的顏色
    const used = out.concat(src.slice(i + 1).filter(o => validColor(o.color)));
    const nl = newLayer(L.name, (L.points || []).filter(p => Array.isArray(p) && p.length >= 2).map(p => [Number(p[0]), Number(p[1])]), L.close, used);
    nl.visible = L.visible !== false;
    if (validColor(L.color)) nl.color = validColor(L.color);
    nl.size = validSize(L.size);
    out.push(nl);
  });
  layers = out;
  activeLayer = Math.min(Math.max(0, active || 0), layers.length - 1);
  points = layers[activeLayer].points;
  closeToggle.checked = layers[activeLayer].close;
  selectedPointIndex = -1;
  selectedSet.clear();
  lastPointCount = points.length;
}
function applyHistoryState(s) {
  const o = JSON.parse(s);
  restoringState = true;
  // 切換作用中的圖層不算一個步驟，所以復原時盡量留在目前這個圖層
  loadLayersFrom(o.layers, activeLayer);
  origin = o.origin || {x: 0, y: 0};
  centerOffset = (Array.isArray(o.originValue) && isFinite(o.originValue[0]) && isFinite(o.originValue[1])) ? [Math.round(o.originValue[0]), Math.round(o.originValue[1])] : [0, 0];
  boundaryPoints = o.boundary || [];
  boundarySpace = o.boundarySpace === 'rel' ? 'rel' : 'nat';
  renderLayers();
  redraw();
  updateOutputs();
  restoringState = false;
  updateUndoButtons();
}
function undo() {
  if (histIdx <= 0) { statusMsg.textContent = '沒有可以復原的步驟了。'; return; }
  histIdx--;
  applyHistoryState(historyStack[histIdx]);
  statusMsg.textContent = `已復原上一步（還可以再復原 ${histIdx} 步）。`;
}
function redo() {
  if (histIdx >= historyStack.length - 1) { statusMsg.textContent = '沒有可以重做的步驟。'; return; }
  histIdx++;
  applyHistoryState(historyStack[histIdx]);
  statusMsg.textContent = '已重做。';
}
$id('undoBtn').addEventListener('click', undo);
$id('redoBtn').addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
  if (typing || !$id('adjModal').hidden || $id('view-work').hidden) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

// ---- 自動偵測：一次找出所有線條／區塊，直接各自建立成圖層 ----
function allocateCounts(weights, n) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = weights.map(w => Math.max(1, Math.round(n * w / total)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a]);
  for (let i = 0; diff !== 0 && i < 200000; i++) {
    const idx = order[i % order.length];
    if (diff > 0) { counts[idx]++; diff--; }
    else if (counts[idx] > 1) { counts[idx]--; diff++; }
    else if (counts.every(c => c <= 1)) break;
  }
  return counts;
}
function detectMethod() {
  const r = document.querySelector('input[name="detectMethod"]:checked');
  return r ? r.value : 'black';
}
document.querySelectorAll('input[name="detectMethod"]').forEach(r => r.addEventListener('change', () => syncDetectFields()));
['blackThresholdSlider', 'edgeThresholdSlider', 'snapRadiusSlider'].forEach(id => {
  $id(id).addEventListener('input', (e) => { $id(id.replace('Slider', 'Val')).textContent = e.target.value; });
});
$id('detectTolerance').addEventListener('input', (e) => {
  $id('toleranceSlider').value = e.target.value;
  $id('toleranceSlider').dispatchEvent(new Event('input'));
  $id('toleranceSlider').dispatchEvent(new Event('change'));
  $id('detectToleranceVal').textContent = e.target.value;
});
$id('toleranceSlider').addEventListener('input', (e) => { $id('detectTolerance').value = e.target.value; $id('detectToleranceVal').textContent = e.target.value; });
$id('skipDetectBtn').addEventListener('click', closeWin);
// ---- 影像前處理與「非純色圖片」用的偵測（照片、漸層、有底紋或雜訊的圖） ----
function lumArray(data, W, H) {
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = i * 4;
    lum[i] = data[d + 3] < 100 ? 255 : luminance(data[d], data[d + 1], data[d + 2]);
  }
  return lum;
}
// 方框模糊（可分離、滑動加總），做兩次接近高斯模糊
function boxBlur(src, W, H, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let sum = 0;
    const row = y * W;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = sum / win;
      sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
function sobelOf(ch, W, H) {
  const g = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (ch[i - W + 1] + 2 * ch[i + 1] + ch[i + W + 1]) - (ch[i - W - 1] + 2 * ch[i - 1] + ch[i + W - 1]);
      const gy = (ch[i + W - 1] + 2 * ch[i + W] + ch[i + W + 1]) - (ch[i - W - 1] + 2 * ch[i - W] + ch[i - W + 1]);
      g[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return g;
}
// 彩色梯度：三個色版各自先模糊再算梯度，取最大值（亮度相同、顏色不同的邊界也抓得到）
function colorGradient(data, W, H, blurR) {
  const out = new Float32Array(W * H);
  for (let c = 0; c < 3; c++) {
    let ch = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) ch[i] = data[i * 4 + 3] < 100 ? 255 : data[i * 4 + c];
    ch = boxBlur(boxBlur(ch, W, H, blurR), W, H, blurR);
    const g = sobelOf(ch, W, H);
    for (let i = 0; i < W * H; i++) if (g[i] > out[i]) out[i] = g[i];
  }
  return out;
}
// Otsu：自動找出把數值分成兩群的門檻
function otsuThreshold(values, maxV, onlyPositive) {
  const bins = 256, hist = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (onlyPositive && v <= 0) continue;
    hist[Math.min(bins - 1, Math.max(0, Math.floor(v / maxV * (bins - 1))))]++;
    total++;
  }
  if (!total) return 0;
  let sumAll = 0;
  for (let b = 0; b < bins; b++) sumAll += b * hist[b];
  let wB = 0, sumB = 0, best = 0, bestVar = -1;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += b * hist[b];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = b; }
  }
  return (best + 0.5) / (bins - 1) * maxV;
}
function dilateMask(mask, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (mask[i] || (x > 0 && mask[i - 1]) || (x < W - 1 && mask[i + 1]) || (y > 0 && mask[i - W]) || (y < H - 1 && mask[i + W])) out[i] = 1;
  }
  return out;
}
function erodeMask(mask, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) out[i] = 1;
  }
  return out;
}
// 判斷圖片是不是「純色線稿」：純色圖大部分像素周圍沒有任何亮度變化
function looksLikePhoto(data, W, H) {
  const g = sobelOf(lumArray(data, W, H), W, H);
  const sample = [];
  let busy = 0, n = 0;
  for (let i = 0; i < g.length; i += 3) { sample.push(g[i]); if (g[i] > 20) busy++; n++; }
  sample.sort((a, b) => a - b);
  const median = sample[Math.floor(sample.length / 2)] || 0;
  return {photo: median > 3 || busy / n > 0.3, median: median, busy: busy / n};
}
function sensitivityFactor() {
  // 靈敏度 50 = 自動門檻；越高門檻越低（抓到越多），越低門檻越高
  const s = Number($id('detectSens').value);
  return Math.pow(2, (50 - s) / 25);
}
// 照片模式・深色線條：跟「周圍平均亮度」比，夠暗才算線條（背景深淺不一也不會整片被抓進來）
function photoDarkLineMask(data, W, H) {
  const l = boxBlur(lumArray(data, W, H), W, H, 1);
  const R = Math.max(6, Math.round(W / 30));
  const mean = boxBlur(boxBlur(l, W, H, R), W, H, R);
  const diff = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) diff[i] = mean[i] - l[i];
  const auto = Math.max(8, otsuThreshold(diff, 128, true));
  const t = auto * sensitivityFactor();
  const mask = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) if (diff[i] > t) { mask[i] = 1; count++; }
  return {mask: mask, count: count, threshold: t};
}
// 照片模式・邊緣：彩色梯度＋自動門檻
function photoEdgeMask(data, W, H) {
  const g = colorGradient(data, W, H, 1);
  let maxG = 0;
  for (let i = 0; i < g.length; i++) if (g[i] > maxG) maxG = g[i];
  const auto = Math.max(12, otsuThreshold(g, Math.max(1, maxG), false));
  const t = auto * sensitivityFactor();
  const mask = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) if (g[i] > t) { mask[i] = 1; count++; }
  return {mask: mask, count: count, threshold: t};
}
// 照片模式・外框：把強邊緣當成牆，從圖片四周往內灌，灌不到的地方就是主體（背景有漸層或雜訊也能用）
function photoSubjectMask(data, W, H) {
  const g = colorGradient(data, W, H, 1);
  let maxG = 0;
  for (let i = 0; i < g.length; i++) if (g[i] > maxG) maxG = g[i];
  const auto = Math.max(12, otsuThreshold(g, Math.max(1, maxG), false));
  const t = auto * sensitivityFactor();
  let wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (g[i] > t) wall[i] = 1;
  wall = dilateMask(wall, W, H);
  const bg = new Uint8Array(W * H);
  const stack = [];
  const seed = (x, y) => { const i = y * W + x; if (!bg[i] && !wall[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  let bgCount = stack.length;
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    if (x > 0 && !bg[i - 1] && !wall[i - 1]) { bg[i - 1] = 1; bgCount++; stack.push(i - 1); }
    if (x < W - 1 && !bg[i + 1] && !wall[i + 1]) { bg[i + 1] = 1; bgCount++; stack.push(i + 1); }
    if (y > 0 && !bg[i - W] && !wall[i - W]) { bg[i - W] = 1; bgCount++; stack.push(i - W); }
    if (y < H - 1 && !bg[i + W] && !wall[i + W]) { bg[i + W] = 1; bgCount++; stack.push(i + W); }
  }
  let subject = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) subject[i] = bg[i] ? 0 : 1;
  // 牆被加粗過 1px，主體也跟著縮回 1px
  subject = erodeMask(subject, W, H);
  let count = 0;
  for (let i = 0; i < W * H; i++) count += subject[i];
  return {mask: subject, count: count, bgCount: bgCount, threshold: t};
}
function showDetectError(msg) {
  const st = $id('detectStatus');
  st.textContent = msg;
  st.classList.add('error');
  st.scrollIntoView({block: 'nearest'});
}

function detectImageType() {
  const r = document.querySelector('input[name="detectType"]:checked');
  return r ? r.value : 'auto';
}
function syncDetectFields() {
  const m = detectMethod(), ty = detectImageType();
  const alpha = m === 'alpha';
  document.querySelectorAll('[data-detect]').forEach(el => { el.hidden = el.dataset.detect !== m || (ty === 'photo' && !alpha); });
  // 透明邊只看透明度，跟圖片是純色還是漸層無關
  $id('detectTypeTitle').hidden = alpha;
  $id('detectTypeRow').hidden = alpha;
  $id('detectSensRow').hidden = alpha || ty === 'solid';
  $id('detectSensNote').textContent = ty === 'auto' ? '（只在判斷為非純色圖片時使用）' : '';
}
document.querySelectorAll('input[name="detectType"]').forEach(r => r.addEventListener('change', syncDetectFields));
$id('detectSens').addEventListener('input', (e) => { $id('detectSensVal').textContent = e.target.value; });
$id('alphaThreshold').addEventListener('input', (e) => { $id('alphaThresholdVal').textContent = e.target.value; });
// 圖片有沒有透明區域：有的話預設就用「透明邊」
function transparencyInfo() {
  if (!img || !sampleCanvas.width) return {ratio: 0, partial: 0};
  const W = sampleCanvas.width, H = sampleCanvas.height;
  const d = sampleCtx.getImageData(0, 0, W, H).data;
  let clear = 0, partial = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 16) clear++; else if (d[i] < 240) partial++; }
  return {ratio: clear / (W * H), partial: partial / (W * H)};
}
function suggestDetectMethod() {
  const info = transparencyInfo();
  const has = info.ratio > 0.01;
  $id('alphaInfo').textContent = has
    ? `這張圖有透明背景（約 ${(info.ratio * 100).toFixed(0)}% 是透明的），已預設使用「透明邊」。`
    : '這張圖沒有透明區域，「透明邊」無法使用（去背的 PNG 才有）。';
  const pick = document.querySelector(`input[name="detectMethod"][value="${has ? 'alpha' : 'black'}"]`);
  if (has || detectMethod() === 'alpha') pick.checked = true;
  syncDetectFields();
}
// 把遮罩裡「被主體包住的洞」找出來（從邊界灌不到的透明區域）
function holeMask(subject, W, H) {
  const outside = new Uint8Array(W * H), stack = [];
  const seed = (x, y) => { const i = y * W + x; if (!subject[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    if (x > 0 && !subject[i - 1] && !outside[i - 1]) { outside[i - 1] = 1; stack.push(i - 1); }
    if (x < W - 1 && !subject[i + 1] && !outside[i + 1]) { outside[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !subject[i - W] && !outside[i - W]) { outside[i - W] = 1; stack.push(i - W); }
    if (y < H - 1 && !subject[i + W] && !outside[i + W]) { outside[i + W] = 1; stack.push(i + W); }
  }
  const holes = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) holes[i] = (!subject[i] && !outside[i]) ? 1 : 0;
  return holes;
}

$id('runDetectBtn').addEventListener('click', () => {
  const st = $id('detectStatus');
  st.textContent = '';
  st.classList.remove('error');
  if (!img) { showDetectError('請先選擇圖片。'); return; }
  const W = sampleCanvas.width, H = sampleCanvas.height, area = W * H;
  const imgData = sampleCtx.getImageData(0, 0, W, H);
  const method = detectMethod();
  const minSize = Number($id('minSizeSlider').value) || 5;
  const N = getTargetCount();
  const spacing = Number($id('spacingSlider').value) || 3;
  const fillMode = $id('fillModeToggle').checked;
  const ty = detectImageType();
  const info = looksLikePhoto(imgData.data, W, H);
  const photo = method !== 'alpha' && (ty === 'photo' || (ty === 'auto' && info.photo));
  const modeLabel = method === 'alpha' ? '透明邊' : (photo ? '非純色圖片模式' : '純色線稿模式');
  const otherHint = photo
    ? '可以把「靈敏度」調高，或把圖片類型改成「純色線稿」試試。'
    : (ty === 'auto' ? '可以把圖片類型改成「照片／漸層」試試。' : '可以調整上面的門檻，或把圖片類型改成「照片／漸層」試試。');
  let results = [];   // {name, pts: [{x,y}], close}
  let foundComps = 0;
  if (method === 'alpha') {
    const thr = Number($id('alphaThreshold').value);
    const d = imgData.data;
    const subject = new Uint8Array(area);
    let opaque = 0, minA = 255;
    for (let i = 0; i < area; i++) {
      const a = d[i * 4 + 3];
      if (a < minA) minA = a;
      if (a >= thr) { subject[i] = 1; opaque++; }
    }
    if (minA >= 250) {
      showDetectError('偵測失敗（透明邊）：這張圖沒有透明區域，每個像素都是不透明的。JPG 沒有透明度，白色背景也不算透明；請改用去背的 PNG，或換成「外框輪廓」「黑色線條」「邊緣」。');
      return;
    }
    if (opaque === area) {
      showDetectError(`偵測失敗（透明邊）：以目前的不透明門檻 ${thr} 來看，整張圖都算主體（最透明的地方不透明度是 ${minA}）。請把門檻調到 ${minA + 1} 以上。`);
      return;
    }
    if (!opaque) {
      showDetectError(`偵測失敗（透明邊）：以目前的不透明門檻 ${thr} 來看，整張圖都是透明的。請把門檻調低。`);
      return;
    }
    let comps = findComponents(subject, W, H, minSize);
    let names = comps.map((c, i) => `透明邊 ${i + 1}`);
    if ($id('alphaHoles').checked) {
      const holes = findComponents(holeMask(subject, W, H), W, H, minSize);
      comps = comps.concat(holes);
      names = names.concat(holes.map((c, i) => `內洞 ${i + 1}`));
    }
    foundComps = comps.length;
    if (!comps.length) {
      showDetectError(`偵測失敗（透明邊）：不透明的區域都太零碎（每一塊都小於「最小偵測像素」${minSize}）。`);
      return;
    }
    const use = comps.slice(0, MAX_AUTO_LAYERS);
    if (fillMode) {
      const counts = N ? allocateCounts(use.map(c => c.count), N) : null;
      use.forEach((c, i) => {
        const run = (sp) => fillSampleMask(c.mask, W, H, sp);
        results.push({name: names[i], pts: N ? fitToCount(run, counts[i]) : run(spacing), close: false});
      });
    } else {
      const paths = [], pnames = [];
      use.forEach((c, i) => {
        const p = simplifyPath(traceContour(c.mask, W, H), 1.5);
        if (p.length >= 3) { paths.push(p); pnames.push(names[i]); }
      });
      const counts = N ? allocateCounts(paths.map(polylineLength), N) : null;
      paths.forEach((p, i) => {
        results.push({name: pnames[i], pts: N ? resampleEven(p, counts[i]) : resampleBySpacing(p, spacing), close: true});
      });
    }
  } else if (method === 'outer') {
    let subject, bgCount;
    if (photo) {
      const r = photoSubjectMask(imgData.data, W, H);
      subject = r.mask; bgCount = r.bgCount;
    } else {
      const bg = detectBackgroundMask(imgData, W, H, Number($id('toleranceSlider').value) || 32);
      subject = new Uint8Array(bg.length);
      bgCount = 0;
      for (let i = 0; i < bg.length; i++) { subject[i] = bg[i] ? 0 : 1; bgCount += bg[i]; }
    }
    const subjCount = area - bgCount;
    if (bgCount < area * 0.02) {
      showDetectError(`偵測失敗（${modeLabel}）：找不到背景，整張圖幾乎都被當成主體。通常是背景不是單一顏色，或主體貼滿畫面邊緣。${otherHint}`);
      return;
    }
    const comps = findComponents(subject, W, H, Math.max(minSize, photo ? Math.round(area * 0.003) : minSize));
    foundComps = comps.length;
    if (!comps.length) {
      showDetectError(`偵測失敗（${modeLabel}）：去掉背景後沒有剩下任何主體（主體只佔 ${(subjCount / area * 100).toFixed(1)}%）。${otherHint}`);
      return;
    }
    const use = comps.slice(0, MAX_AUTO_LAYERS);
    if (fillMode) {
      const counts = N ? allocateCounts(use.map(c => c.count), N) : null;
      use.forEach((c, i) => {
        const run = (sp) => fillSampleMask(c.mask, W, H, sp);
        results.push({name: `填滿 ${i + 1}`, pts: N ? fitToCount(run, counts[i]) : run(spacing), close: false});
      });
    } else {
      const paths = use.map(c => simplifyPath(traceContour(c.mask, W, H), 1.5)).filter(p => p.length >= 3);
      const counts = N ? allocateCounts(paths.map(polylineLength), N) : null;
      paths.forEach((p, i) => {
        results.push({name: `外框 ${i + 1}`, pts: N ? resampleEven(p, counts[i]) : resampleBySpacing(p, spacing), close: true});
      });
    }
  } else {
    let mask, maskCount = 0, detail = '';
    if (photo) {
      const r = method === 'black' ? photoDarkLineMask(imgData.data, W, H) : photoEdgeMask(imgData.data, W, H);
      mask = r.mask; maskCount = r.count;
    } else if (method === 'black') {
      const thr = Number($id('blackThresholdSlider').value);
      mask = detectBlackMask(imgData, W, H, thr);
      for (let i = 0; i < mask.length; i++) maskCount += mask[i];
      if (!maskCount) {
        const lum = lumArray(imgData.data, W, H);
        let minL = 255;
        for (let i = 0; i < lum.length; i++) if (lum[i] < minL) minL = lum[i];
        detail = minL > 175
          ? `圖片最暗的地方亮度也有 ${Math.round(minL)}（255 是全白），沒有夠暗的線條可以抓。請改用「外框輪廓」或「邊緣」。`
          : `圖片最暗的地方亮度是 ${Math.round(minL)}，但目前暗部閾值是 ${thr}，請把閾值調到 ${Math.round(minL) + 25} 以上。`;
      }
    } else {
      mask = sobelEdgeMask(imgData, W, H, Number($id('edgeThresholdSlider').value));
      for (let i = 0; i < mask.length; i++) maskCount += mask[i];
    }
    const what = method === 'black' ? '深色線條' : '邊緣';
    if (!maskCount) {
      showDetectError(`偵測失敗（${modeLabel}）：找不到任何${what}。${detail || otherHint}`);
      return;
    }
    if (maskCount > area * 0.6) {
      showDetectError(`偵測失敗（${modeLabel}）：有 ${(maskCount / area * 100).toFixed(0)}% 的畫面都被當成${what}，結果沒有意義。${photo ? '請把「靈敏度」調低。' : (method === 'black' ? '請把暗部閾值調低，或把圖片類型改成「照片／漸層」。' : '請把邊緣敏感度的數值調高，或把圖片類型改成「照片／漸層」。')}`);
      return;
    }
    const comps = findComponents(mask, W, H, minSize);
    foundComps = comps.length;
    if (!comps.length) {
      showDetectError(`偵測失敗（${modeLabel}）：找到的${what}都太零碎（每一塊都小於「最小偵測像素」${minSize}）。${otherHint}`);
      return;
    }
    const use = comps.slice(0, MAX_AUTO_LAYERS);
    const useCenterline = $id('centerlineToggle').checked;
    const samplers = [], weights = [];
    use.forEach(c => {
      if (useCenterline) {
        const ordered = orderSkeletonPath(pruneSkeletonSpurs(thinMask(c.mask, W, H), W, H, 8), W, H);
        samplers.push((sp) => resampleBySpacing(ordered, sp));
        weights.push(Math.max(1, ordered.length));
      } else {
        samplers.push((sp) => fillSampleMask(c.mask, W, H, sp));
        weights.push(c.count);
      }
    });
    const counts = N ? allocateCounts(weights, N) : null;
    const label = method === 'black' ? '黑線' : '邊緣';
    samplers.forEach((run, i) => {
      results.push({name: `${label} ${i + 1}`, pts: N ? fitToCount(run, counts[i]) : run(spacing), close: false});
    });
  }
  results = results.filter(r => r.pts && r.pts.length);
  if (!results.length) {
    showDetectError(`偵測失敗（${modeLabel}）：找到了 ${foundComps} 個區塊，但都太小，取不出座標點。${otherHint}`);
    return;
  }
  syncActiveLayer();
  const replace = $id('detectReplace').checked;
  if (replace) { layers = []; layerSeq = 0; }
  else if (layers.length === 1 && !layers[0].points.length) { layers = []; }
  const first = layers.length;
  // 中心線描出來的路徑：頭尾幾乎接在一起（例如圓圈）就視為閉合，其餘（例如一條弧線）維持不閉合
  results.forEach(r => {
    const P = r.pts, m = P.length;
    if (r.close || m < 4 || /^填滿/.test(r.name)) return;
    const steps = [];
    for (let i = 0; i < m - 1; i++) steps.push(Math.hypot(P[i].x - P[i + 1].x, P[i].y - P[i + 1].y));
    steps.sort((x, y) => x - y);
    const med = steps[Math.floor(steps.length / 2)] || 0;
    if (med > 0 && Math.hypot(P[0].x - P[m - 1].x, P[0].y - P[m - 1].y) <= med * 2.2) r.close = true;
  });
  results.forEach(r => { layers.push(newLayer(r.name, r.pts.map(p => workToNatural(p.x, p.y)), r.close)); });
  activeLayer = first;
  points = layers[activeLayer].points;
  closeToggle.checked = layers[activeLayer].close;
  selectedPointIndex = -1;
  selectedSet.clear();
  lastPointCount = points.length;
  renderLayers();
  redraw();
  updateOutputs();
  const total = results.reduce((a, r) => a + r.pts.length, 0);
  closeWin();
  // 成功但結果可能不如預期的情況，也要講清楚
  const notes = [];
  if (foundComps > MAX_AUTO_LAYERS) notes.push(`找到 ${foundComps} 個區塊，只保留面積最大的 ${MAX_AUTO_LAYERS} 個`);
  if (N && total < N * 0.9) notes.push(`圖案的像素不夠，只產生了 ${total} 個點（設定的總點數是 ${N}）`);
  const tiny = results.filter(r => r.pts.length < 3).length;
  if (tiny >= 3) notes.push(`其中 ${tiny} 個圖層只有一兩個點，多半是雜訊`);
  if (!photo && info.photo) notes.push('這張圖看起來不是純色，建議重新匯入並把圖片類型改成「照片／漸層」');
  statusMsg.textContent = `已用${modeLabel}偵測並建立 ${results.length} 個圖層，共 ${total} 個點。` +
    (notes.length ? `請注意：${notes.join('；')}。` : '不要的圖層可以在右邊的圖層清單隱藏或刪除。');
});

// ---- 筆觸描邊：沿著線條大概畫過去，自動貼合到附近的線條中心或邊緣 ----
function snapStroke(natPts) {
  if (!img || natPts.length < 2) return natPts;
  const W = sampleCanvas.width, H = sampleCanvas.height;
  const kx = W / img.naturalWidth, ky = H / img.naturalHeight;
  const data = sampleCtx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = i * 4;
    lum[i] = data[d + 3] < 100 ? 255 : luminance(data[d], data[d + 1], data[d + 2]);
  }
  const work = natPts.map(p => ({x: p[0] * kx, y: p[1] * ky}));
  const dense = resampleEven(work, Math.max(2, Math.ceil(polylineLength(work))));
  dense.push(work[work.length - 1]);
  const R = Math.max(1, Math.round(Number($id('snapRadiusSlider').value) * kx)) || 3;
  const darkThr = Number($id('blackThresholdSlider').value);
  const snapped = dense.map(p0 => {
    // 深色線條：重複幾次「移到視窗內深色像素的重心」，會收斂到線條的中心線
    let p = p0, hitDark = false;
    for (let iter = 0; iter < 4; iter++) {
      const cx = Math.round(p.x), cy = Math.round(p.y);
      let sw = 0, sx = 0, sy = 0;
      for (let y = cy - R; y <= cy + R; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = cx - R; x <= cx + R; x++) {
          if (x < 0 || x >= W) continue;
          if ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) > R * R) continue;
          const l = lum[y * W + x];
          if (l <= darkThr) { const w = darkThr - l + 1; sw += w; sx += w * x; sy += w * y; }
        }
      }
      if (!sw) break;
      hitDark = true;
      const nx = sx / sw, ny = sy / sw;
      const moved = Math.hypot(nx - p.x, ny - p.y);
      p = {x: nx, y: ny};
      if (moved < 0.15) break;
    }
    if (hitDark) {
      // 不要被吸到離筆觸太遠的另一條線上
      return Math.hypot(p.x - p0.x, p.y - p0.y) <= R * 1.5 ? p : p0;
    }
    // 沒有深色線條時，貼到附近顏色變化最大的邊緣
    const cx = Math.round(p0.x), cy = Math.round(p0.y);
    let bestG = 0, bx = p0.x, by = p0.y;
    for (let y = cy - R; y <= cy + R; y++) {
      if (y < 1 || y >= H - 1) continue;
      for (let x = cx - R; x <= cx + R; x++) {
        if (x < 1 || x >= W - 1) continue;
        const dd = (x - p0.x) * (x - p0.x) + (y - p0.y) * (y - p0.y);
        if (dd > R * R) continue;
        const idx = y * W + x;
        const g = (Math.abs(lum[idx + 1] - lum[idx - 1]) + Math.abs(lum[idx + W] - lum[idx - W])) / (1 + dd * 0.08);
        if (g > bestG) { bestG = g; bx = x; by = y; }
      }
    }
    return bestG > 30 ? {x: bx, y: by} : p0;
  });
  // 稍微平滑，去掉逐點貼合造成的抖動
  const sm = snapped.map((p, i) => {
    let ax = 0, ay = 0, c = 0;
    for (let k = -3; k <= 3; k++) { const q = snapped[i + k]; if (q) { ax += q.x; ay += q.y; c++; } }
    return {x: ax / c, y: ay / c};
  });
  const spacing = Number($id('spacingSlider').value) || 3;
  const count = Math.max(2, Math.round(polylineLength(sm) / spacing) + 1);
  const out = resampleEven(sm, count - 1);
  out.push(sm[sm.length - 1]);
  return out.map(p => workToNatural(p.x, p.y));
}
function finishStroke() {
  const s = strokeDrag;
  strokeDrag = null;
  if (!s || s.pts.length < 2) { redraw(); return; }
  const added = snapStroke(s.pts);
  points = points.concat(added);
  selectedPointIndex = -1;
  redraw();
  updateOutputs();
  statusMsg.textContent = `筆觸已貼合並加入 ${added.length} 個點（圖層「${layers[activeLayer].name}」）。`;
}
$id('modeBrush').addEventListener('click', () => {
  dropPick();
  mode = 'brush';
  syncModeButtons();
  selectedSet.clear();
  $id('modeHint').textContent = '筆觸描邊：按住滑鼠沿著想描的線條大概畫過去，放開後會自動貼合到附近的深色線條中心（沒有深色線條時貼到顏色變化最大的邊緣），並依點位間距佈點，加到目前的圖層。「貼合範圍」越大越會被吸過去。';
  if (!img) statusMsg.textContent = '筆觸描邊需要先選擇圖片。';
  redraw();
});

// ---- 彈出視窗：儲存／套用成功後自動關閉 ----
// 做法：按下視窗裡的按鈕前先記住座標與原點，處理完如果有變動就代表套用成功，關閉視窗並把結果訊息浮出來。
let winClick = null;
document.addEventListener('click', (e) => {
  const w = e.target.closest && e.target.closest('.win');
  if (!w || !e.target.closest('button')) { winClick = null; return; }
  winClick = {win: w.id, seq: stateSeq, status: statusMsg.textContent,
    texts: Array.from(w.querySelectorAll('.status')).map(el => el.textContent)};
}, true);
document.addEventListener('click', () => {
  const st = winClick;
  winClick = null;
  if (!st || currentWin !== st.win) return;
  if (stateSeq === st.seq) return;
  let msg = '';
  $id(st.win).querySelectorAll('.status').forEach((el, i) => { if (el.textContent && el.textContent !== st.texts[i]) msg = el.textContent; });
  if (!msg && statusMsg.textContent !== st.status) msg = statusMsg.textContent;
  closeWin();
  if (msg) { statusMsg.textContent = msg; showSnack(msg); }
});
// 匯出：複製成功就關閉
[['copyBtn', 'exportBox'], ['batchCopyBtn', 'batchExportBox'], ['shiftCopyBtn', 'shiftedExportBox'], ['copyListTextBtn', null]].forEach(([btn, box]) => {
  $id(btn).addEventListener('click', () => {
    const has = box ? !!$id(box).value : exportPoints().length > 0;
    if (!has) return;
    setTimeout(() => { closeWin(); statusMsg.textContent = '已複製到剪貼簿。'; }, 200);
  });
});

// ---- 線稿用物件預設（.hideout 匯出時每個點要放的裝飾物）：可存多組 ----
(function () {
  const OBJ_KEY = 'traceToolObjectsV1';
  let store = {list: [], sel: null, seq: 0};
  try {
    const o = JSON.parse(localStorage.getItem(OBJ_KEY) || 'null');
    if (o && Array.isArray(o.list)) store = {list: o.list.filter(x => x && typeof x === 'object'), sel: o.sel, seq: Number(o.seq) || o.list.length};
  } catch (e) {}
  const save = () => { try { localStorage.setItem(OBJ_KEY, JSON.stringify(store)); } catch (e) {} };
  const intStr = (v, d) => { const s = String(v == null ? '' : v).trim(); return /^-?\d+$/.test(s) ? s : d; };
  const usable = o => o && String(o.name || '').trim() !== '' && /^-?\d+$/.test(String(o.hash || '').trim());
  function selected() { return store.list.find(o => o.id === store.sel) || store.list[0] || null; }
  function addObject(o) {
    store.seq++;
    const item = {id: store.seq, name: String(o.name || '').trim(), hash: intStr(o.hash, ''), r: intStr(o.r, '0'), fv: intStr(o.fv, '0')};
    store.list.push(item);
    if (!store.list.some(x => x.id === store.sel)) store.sel = item.id;
    save(); renderList(); renderSelect();
    return item;
  }
  function renderSelect() {
    const sel = $id('objectSelect');
    sel.innerHTML = '';
    const ok = store.list.filter(usable);
    if (!ok.length) {
      const op = document.createElement('option');
      op.value = ''; op.textContent = '（還沒有存任何物件）';
      sel.appendChild(op);
    }
    ok.forEach(o => {
      const op = document.createElement('option');
      op.value = o.id; op.textContent = o.name;
      sel.appendChild(op);
    });
    const cur = selected();
    if (cur && usable(cur)) sel.value = cur.id;
    updateInfo();
  }
  function updateInfo() {
    const o = store.list.find(x => String(x.id) === $id('objectSelect').value);
    $id('objectInfo').textContent = o ? `hash ${o.hash}　r ${o.r}　fv ${o.fv}` : '請先按「管理物件」新增一組，或在下面直接貼上一組範例。';
  }
  function renderList() {
    const box = $id('objectList');
    box.innerHTML = '';
    if (!store.list.length) {
      const e = document.createElement('div');
      e.className = 'obj-empty';
      e.textContent = '還沒有存任何物件。按「新增一組物件」手動填，或在下面貼上一組範例。';
      box.appendChild(e);
      return;
    }
    const head = document.createElement('div');
    head.className = 'obj-row head';
    head.innerHTML = '<span>預設</span><span>物件名稱</span><span>hash</span><span>r（旋轉）</span><span>fv</span><span></span>';
    box.appendChild(head);
    store.list.forEach(o => {
      const row = document.createElement('div');
      row.className = 'obj-row';
      const pick = document.createElement('input');
      pick.type = 'radio'; pick.name = 'objectDefault'; pick.checked = selected() === o;
      pick.title = '設為預設使用的物件'; pick.setAttribute('aria-label', '設為預設使用的物件');
      pick.addEventListener('change', () => { store.sel = o.id; save(); renderSelect(); });
      row.appendChild(pick);
      [['name', 'text', '物件名稱'], ['hash', 'number', 'hash'], ['r', 'number', 'r'], ['fv', 'number', 'fv']].forEach(([key, type, label]) => {
        const inp = document.createElement('input');
        inp.type = type; inp.value = o[key]; inp.placeholder = label; inp.setAttribute('aria-label', label);
        if (type === 'number') inp.step = '1';
        inp.addEventListener('input', () => {
          o[key] = key === 'name' ? inp.value.trim() : intStr(inp.value, key === 'hash' ? '' : '0');
          save(); renderSelect();
        });
        row.appendChild(inp);
      });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'icon-only ghost'; del.title = '刪除這組物件'; del.setAttribute('aria-label', '刪除這組物件');
      del.innerHTML = '<svg class="ic"><use href="#i-trash"/></svg>';
      del.addEventListener('click', () => {
        store.list = store.list.filter(x => x !== o);
        if (store.sel === o.id) store.sel = store.list.length ? store.list[0].id : null;
        save(); renderList(); renderSelect();
        $id('objectStatus').textContent = `已刪除物件「${o.name || '未命名'}」。`;
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function addFromText(text, statusEl) {
    const tpl = parseTemplate(text || '');
    if (!tpl) { statusEl.textContent = '無法從貼上的內容解析出名稱與 hash，請確認格式。'; return null; }
    const dup = store.list.find(o => o.name === tpl.name && String(o.hash) === String(tpl.hash) && String(o.r) === String(tpl.r) && String(o.fv) === String(tpl.fv));
    if (dup) { store.sel = dup.id; save(); renderList(); renderSelect(); statusEl.textContent = `「${tpl.name}」已經存過了，已選用它。`; return dup; }
    const item = addObject(tpl);
    store.sel = item.id; save(); renderList(); renderSelect();
    statusEl.textContent = `已新增物件「${tpl.name}」（hash ${tpl.hash}，r ${tpl.r}，fv ${tpl.fv}）。`;
    return item;
  }
  $id('addObjectBtn').addEventListener('click', () => {
    addObject({name: '', hash: '', r: '0', fv: '0'});
    const rows = $id('objectList').querySelectorAll('.obj-row:not(.head)');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('input[type="text"]').focus();
    $id('objectStatus').textContent = '已新增一列，請填入物件名稱與 hash。';
  });
  $id('addObjectFromPasteBtn').addEventListener('click', () => {
    if (addFromText($id('objectPasteBox').value, $id('objectStatus'))) $id('objectPasteBox').value = '';
  });
  $id('saveTemplateAsObjectBtn').addEventListener('click', () => {
    if (addFromText($id('templateBox').value, $id('batchStatus'))) { $id('templateBox').value = ''; $id('templateDetails').open = false; }
  });
  $id('objectSelect').addEventListener('change', () => {
    updateInfo();   // 這裡只是這次匯出臨時換一組；預設用哪一組在設定頁圈選
  });
  $id('manageObjectsBtn').addEventListener('click', () => {
    closeWin();
    showView('settings');
    $id('objectCard').scrollIntoView({block: 'start'});
  });
  // 匯出時用的物件：有直接貼範例就以貼上的為準，否則用選到的那組預設
  window.currentObjectTemplate = function () {
    const pasted = $id('templateBox').value;
    if (pasted.trim()) return parseTemplate(pasted);
    const o = store.list.find(x => String(x.id) === $id('objectSelect').value);
    return usable(o) ? {name: o.name.trim(), hash: String(o.hash), r: intStr(o.r, '0'), fv: intStr(o.fv, '0')} : null;
  };
  renderList();
  renderSelect();
})();

updateHeroStats();
