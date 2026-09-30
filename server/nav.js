// Navegação da IA do servidor (server/botAI.js) sobre a grade de server/navdata.js.
//
// Sem dependências e sem nada de Three.js: é geometria 2D sobre uma grade de células,
// então roda igual em Node e nos testes. A grade já vem com o raio da IA descontado e
// só com o que é alcançável a partir do spawn (scripts/navdata/build.mjs), então aqui
// "célula livre" basta pra saber se a IA pode pisar ali.
import { NAVDATA_BY_LAYOUT } from './navdata.js';

const SQRT2 = Math.SQRT2;

// Heap binário mínimo (prioridade, valor) sobre arrays tipados — o Dijkstra abaixo roda
// sobre até ~35 mil células (Chameleon Manor), e a versão com arrays comuns e troca por
// desestruturação (`[a, b] = [b, a]` aloca um array por troca) custava ~3x mais.
class MinHeap {
  constructor(capacity = 4096) {
    this.pri = new Float64Array(capacity);
    this.val = new Int32Array(capacity);
    this.size = 0;
  }
  grow() {
    const pri = new Float64Array(this.pri.length * 2); pri.set(this.pri);
    const val = new Int32Array(this.val.length * 2); val.set(this.val);
    this.pri = pri; this.val = val;
  }
  push(priority, value) {
    if (this.size === this.pri.length) this.grow();
    const { pri, val } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= priority) break;
      pri[i] = pri[parent]; val[i] = val[parent];
      i = parent;
    }
    pri[i] = priority; val[i] = value;
  }
  pop() {
    const { pri, val } = this;
    const top = val[0];
    const n = --this.size;
    if (n > 0) {
      const lastP = pri[n], lastV = val[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        pri[i] = pri[c]; val[i] = val[c];
        i = c;
      }
      pri[i] = lastP; val[i] = lastV;
    }
    return top;
  }
}

export class NavGrid {
  constructor(data) {
    this.cell = data.cell;
    this.x0 = data.x0;
    this.z0 = data.z0;
    this.cols = data.cols;
    this.rows = data.rows;
    this.free = new Uint8Array(this.cols * this.rows);
    data.grid.forEach((line, r) => {
      for (let c = 0; c < this.cols; c++) this.free[r * this.cols + c] = line[c] === '.' ? 1 : 0;
    });
    // Esconderijos já com a célula de onde a IA parte pra eles.
    this.spots = data.spots.map(([kind, x, z, yaw, upper, lower], index) => ({
      index, kind, x, z, yaw, upper, lower,
      // A IA "olha" pra fora da parede (o avatar de quem está grudado encara a parede).
      gaze: kind === 'w' ? yaw + Math.PI : yaw,
      approach: this.nearestFree(x, z, 4),
    }));
  }

  idx(c, r) { return r * this.cols + c; }
  inBounds(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  isFreeCell(c, r) { return this.inBounds(c, r) && this.free[r * this.cols + c] === 1; }
  cellOf(x, z) { return { c: Math.floor((x - this.x0) / this.cell), r: Math.floor((z - this.z0) / this.cell) }; }
  center(c, r) { return { x: this.x0 + (c + 0.5) * this.cell, z: this.z0 + (r + 0.5) * this.cell }; }
  isFreePoint(x, z) { const { c, r } = this.cellOf(x, z); return this.isFreeCell(c, r); }

  // Célula livre mais próxima (pelo centro) dentro de `radiusCells`; null se não houver.
  // `exclude` (Set de índices de célula) pula células já reservadas — usado pra espalhar
  // as IAs no spawn em vez de empilhar todas na mesma célula.
  nearestFree(x, z, radiusCells = 6, exclude = null) {
    const { c: c0, r: r0 } = this.cellOf(x, z);
    let best = null, bestD = Infinity;
    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (!this.isFreeCell(c, r)) continue;
        if (exclude && exclude.has(r * this.cols + c)) continue;
        const p = this.center(c, r);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) { bestD = d; best = { c, r }; }
      }
    }
    return best;
  }

  // Segmento inteiro sobre células livres? Amostra a cada meia célula, então não deixa
  // passar cortando a quina de uma célula bloqueada.
  lineFree(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isFreePoint(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // Dijkstra de uma célula pras outras (8 vizinhos, sem cortar quina), até `maxDist`
  // metros de caminho. Uma passada serve pra ranquear todos os esconderijos por
  // distância de caminho e depois reconstruir o caminho do escolhido.
  flood(from, maxDist = Infinity) {
    const { cols, rows, cell, free } = this;
    const n = cols * rows;
    const dist = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    if (!from || !this.isFreeCell(from.c, from.r)) return { dist, parent };
    const diag = SQRT2 * cell;
    const heap = new MinHeap();
    const start = from.r * cols + from.c;
    dist[start] = 0;
    heap.push(0, start);
    while (heap.size) {
      const cur = heap.pop();
      const dCur = dist[cur];
      if (dCur > maxDist) break;
      const r = (cur / cols) | 0;
      const c = cur - r * cols;
      const up = r > 0, down = r < rows - 1, left = c > 0, right = c < cols - 1;
      // Vizinhos ortogonais primeiro: a diagonal só vale se os DOIS ortogonais que a
      // cercam estão livres (sem cortar quina de obstáculo).
      const fl = left && free[cur - 1] === 1, fr = right && free[cur + 1] === 1;
      const fu = up && free[cur - cols] === 1, fd = down && free[cur + cols] === 1;
      let ni, nd;
      if (fl) { ni = cur - 1; nd = dCur + cell; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fr) { ni = cur + 1; nd = dCur + cell; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fu) { ni = cur - cols; nd = dCur + cell; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fd) { ni = cur + cols; nd = dCur + cell; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fl && fu && free[cur - cols - 1] === 1) { ni = cur - cols - 1; nd = dCur + diag; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fr && fu && free[cur - cols + 1] === 1) { ni = cur - cols + 1; nd = dCur + diag; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fl && fd && free[cur + cols - 1] === 1) { ni = cur + cols - 1; nd = dCur + diag; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
      if (fr && fd && free[cur + cols + 1] === 1) { ni = cur + cols + 1; nd = dCur + diag; if (nd < dist[ni]) { dist[ni] = nd; parent[ni] = cur; heap.push(nd, ni); } }
    }
    return { dist, parent };
  }

  // Caminho (centros de célula) da origem do flood até `to`; null se inalcançável.
  pathTo(flood, to) {
    const { cols } = this;
    let i = this.idx(to.c, to.r);
    if (!Number.isFinite(flood.dist[i])) return null;
    const cells = [];
    while (i !== -1) { cells.push(i); i = flood.parent[i]; }
    cells.reverse();
    return cells.map((k) => this.center(k % cols, (k - (k % cols)) / cols));
  }

  // "String pulling": troca a escada de células por poucos pontos, pulando o que dá
  // pra atravessar em linha reta. Sem isso a IA andaria em zigue-zague de grade.
  simplify(points, lookahead = 60) {
    if (points.length <= 2) return points.slice();
    const out = [points[0]];
    let a = 0;
    while (a < points.length - 1) {
      let b = Math.min(points.length - 1, a + lookahead);
      while (b > a + 1 && !this.lineFree(points[a].x, points[a].z, points[b].x, points[b].z)) b--;
      out.push(points[b]);
      a = b;
    }
    return out;
  }
}

const cache = new Map();
// NavGrid do layout, ou null se não há dados (a IA então fica parada — ver botAI.js).
export function navFor(layout) {
  if (!cache.has(layout)) {
    const data = NAVDATA_BY_LAYOUT[layout];
    cache.set(layout, data ? new NavGrid(data) : null);
  }
  return cache.get(layout);
}
