# Plano — Passo de Realismo (Texturas & Materiais Procedurais)

> Objetivo do usuário: ambiente **mais realista e detalhado**, com ganho concentrado
> em **textura e material** (prioridade explícita sobre iluminação/arquitetura/clutter).
> Paleta: trocar as cores-brinquedo saturadas (`HERO_COLORS`) por **cores de material
> reais e discretas** (parede pintada, madeira, metal, tecido). Alvo primário: **mobile**.
> 100% procedural — nenhum asset externo.

---

## 0. Correções ao briefing (coisas que estavam erradas — leia primeiro)

Duas premissas do plano original **não se aplicam ao three@0.161** e mudam onde vale
gastar esforço. Verifiquei no fonte do próprio three (`src/renderers/webgl/WebGLTextures.js`).

1. **`map.clone()` NÃO duplica upload de GPU.** `initTexture()` mapeia
   `Source → WebGLTexture` via `getTextureCacheKey(texture)`, e essa chave inclui
   `wrapS/wrapT/filtros/anisotropy/format/colorSpace` — **mas não inclui `repeat`/`offset`**.
   `Texture.clone()` compartilha o mesmo `.source`. Logo, todas as paredes que clonam
   `wallpaperTexture()` com repeats diferentes **compartilham UM único upload de GPU**
   (o `texImage2D` roda uma vez; os demais caem no guard `source.version === __version`).
   → O "Layout 2 sobe 11 cópias do wallpaper" **é falso**. O `clone()` custa só um objeto
   `Texture` em JS (barato). **Não é o gargalo.** Manteremos o clone; a "cache ciente de
   repeat" vira otimização opcional de baixa prioridade (§5), não correção de bug.

2. **Compartilhar material/geometria NÃO reduz draw calls.** O three emite **um draw
   call por mesh** (um render item por par geometria+material). Não há batching
   automático. Draw calls continuam ≈ número de meshes independentemente de
   compartilhamento. Só **InstancedMesh** ou **mergeGeometries** reduzem draw calls — e
   ambos quebram nossos requisitos (cor de camuflagem por-objeto + fade de oclusão
   por-objeto), então estão praticamente **fora de cogitação** para props
   grudáveis/coloráveis. Compartilhar economiza **memória, GC e tempo de load**, não
   draw calls. O ganho de FPS por-frame vem de **reduzir casters de sombra** e de
   **não pôr normalMap nas superfícies grandes (fill-rate)** no mobile.

Consequência prática: o realismo (albedo + normal maps) é seguro de adicionar; o custo
real a gerenciar é **fill-rate do fragment shader** (normalMap em parede/piso grandes) e
**a passada de sombra**. É aí que o scaling mobile atua (§4).

---

## 1. Restrição de camuflagem + paleta verificada

### A mecânica que não pode quebrar
`Player.isCamouflaged()` (src/Player.js:115-128) compara **`material.color` do jogador**
com **`latchedObject.material.color`**, canal a canal, pegando o **maior** delta:
`ENTER=0.07` para entrar em camo, `EXIT=0.13` para sair. `Game._tryCamouflage`
(src/Game.js:210-222) copia `hit.object.material.color`. Portanto:

- **Todo prop colorável mantém `material.color` num tom chapado e legível** — é o alvo.
- **Textura multiplica `material.color`.** Os mapas de detalhe (albedo) precisam ter
  **média perto do branco** (≥ ~0.85), senão a superfície renderizada não parece a cor
  que o jogador copiou → camuflagem visualmente desonesta. Mecanicamente a camo continua
  honesta (compara `material.color`, não o pixel), mas a **leitura** engana. Regra de
  ouro dos geradores: **mapa branco com sujeira/desgaste/relevo por cima**.

> **Sutileza importante:** `material.color` guarda valores **lineares** (o three
> converte o hex sRGB → linear). Os limiares 0.07/0.13 são em **espaço linear**. Cores
> escuras comprimem em linear e "colam" perto do limiar — por isso paletas realistas
> escuras tendem a ficar acidentalmente intercambiáveis. A paleta abaixo foi escolhida e
> **verificada em espaço linear**.

### Paleta "assinatura" (substitui `HERO_COLORS`) — 10 cores, todas distintas
Selecionadas por busca gulosa max-min-distância; **mínimo par-a-par = 0.152** em linear,
e **≥ 0.15 de distância** tanto do amarelo da parede (`0xcbbf82`) quanto da base do
boneco (`0xeef0f2`). Folga confortável sobre `EXIT=0.13`.

| hex | nome | material sugerido |
|-----|------|-------------------|
| `0xb5794a` | teca / madeira quente | wood |
| `0x8a4444` | oxblood (estofado) | fabric |
| `0x4f6b52` | verde-floresta (tecido) | fabric |
| `0x3f8a86` | teal petróleo (pintura) | drywall/plastic |
| `0x8794a0` | azul-aço | metal |
| `0xd8d2c4` | creme (eletrodoméstico) | metal/plastic |
| `0x8fb59a` | verde-menta (parede) | drywall |
| `0x8a8347` | olive drab | fabric |
| `0xc7a33e` | ocre-mostarda | drywall/wood |
| `0xa06a86` | malva | drywall/fabric |

O **amarelo do perímetro `0xcbbf82` permanece** (assinatura Backrooms) e é o anel-âncora
de camo; a paleta acima o evita por ≥0.15. A paleta "acento/scatter" (§3) pode ter cores
que se agrupam — clustering entre tons escuros neutros é aceitável (e realista): só é
perigoso quando um alvo que deveria ser uma **escolha distinta** deixa de ser. Os alvos
distintos são os 10 acima; o scatter é ambiente.

Script de verificação (rodar em qualquer node — replica o sRGB→linear do three):

```js
function s2l(c){c/=255;return c<0.04045?c*0.0773993808:Math.pow(c*0.9478672986+0.0521327014,2.4);}
const lin=h=>[s2l(h>>16&255),s2l(h>>8&255),s2l(h&255)];
const d=(a,b)=>Math.max(...[0,1,2].map(i=>Math.abs(a[i]-b[i])));
// falha se qualquer par (incl. amarelo 0xcbbf82) < 0.13
```

---

## 2. `src/textures.js` — sistema de materiais + normal maps

Mantém a infra atual (`_cache`, `makeCanvas`, `toTexture`, `speckle`, `dampStain`).
Adiciona um **registro de materiais** e um **derivador de normal map**.

### 2.1 Empacotador de normal map (o maior alavanca de realismo)

`toTexture()` seta `SRGBColorSpace` — **correto para albedo, ERRADO para normal**. Normal
map é dado linear. Precisa de um empacotador próprio:

```js
// Deriva normal tangente de um canvas de altura (cinza) via Sobel.
// strength escala a inclinação; wrap (%) mantém o tile costurável.
export function heightToNormal(heightCv, { strength = 2.0 } = {}) {
  const size = heightCv.width;
  const src = heightCv.getContext('2d').getImageData(0, 0, size, size).data;
  const H = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) << 2] / 255;
  const out = document.createElement('canvas'); out.width = out.height = size;
  const octx = out.getContext('2d'); const img = octx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x-1,y-1)+2*H(x-1,y)+H(x-1,y+1)) - (H(x+1,y-1)+2*H(x+1,y)+H(x+1,y+1));
    const dy = (H(x-1,y-1)+2*H(x,y-1)+H(x+1,y-1)) - (H(x-1,y+1)+2*H(x,y+1)+H(x+1,y+1));
    const nx = dx * strength, ny = dy * strength, nz = 1, inv = 1 / Math.hypot(nx, ny, nz);
    const i = (y * size + x) << 2;
    img.data[i]   = (nx * inv * 0.5 + 0.5) * 255;
    img.data[i+1] = (ny * inv * 0.5 + 0.5) * 255;
    img.data[i+2] = (nz * inv * 0.5 + 0.5) * 255;
    img.data[i+3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;   // <-- normal é linear, NÃO sRGB
  tex.anisotropy = 4;
  return tex;
}
```

**Custo de geração no load:** Sobel em 256² = 65k px × ~8 leituras ≈ 0,5M ops JS por mapa,
via um único `getImageData`/`putImageData`. ~2–5 ms por mapa. Com ~7 materiais → ~15–35 ms
total, **uma vez** no load. No mobile, gerar a **128²** (¼ do custo e da memória).

**Escala de relevo:** `MeshStandardMaterial.normalScale` é `Vector2`. Manter **sutil**
(0.15–0.5 por material) — relevo forte briga com a leitura da cor de camo e vira ruído no
mobile. Valores por material na tabela §2.3.

### 2.2 Registro de materiais

```js
// Cada material: base clara (multiply-friendly), rugosidade/metalness, escala de
// normal, e um "draw" que pinta o albedo. Height derivado da luminância do albedo
// por padrão; materiais que precisam de relevo distinto fornecem drawHeight.
const MATERIALS = {
  drywall:  { base:'#f2f0ea', roughness:0.92, metalness:0.00, normalScale:0.25, draw:drawDrywall },
  wood:     { base:'#f0e6d4', roughness:0.55, metalness:0.00, normalScale:0.40, draw:drawWood,     drawHeight:heightWood },
  metal:    { base:'#ededed', roughness:0.35, metalness:0.30, normalScale:0.20, draw:drawMetal,    drawHeight:heightMetal },
  fabric:   { base:'#eae7e0', roughness:0.92, metalness:0.00, normalScale:0.50, draw:drawFabric,   drawHeight:heightFabric },
  cardboard:{ base:'#efe4cf', roughness:0.95, metalness:0.00, normalScale:0.35, draw:drawCardboard,drawHeight:heightCardboard },
  plastic:  { base:'#f3f3f3', roughness:0.40, metalness:0.00, normalScale:0.15, draw:drawPlastic },
  concrete: { base:'#ecebe6', roughness:1.00, metalness:0.00, normalScale:0.50, draw:drawConcrete, drawHeight:heightConcrete },
};

// API pública: cacheada por (nome, size, normals). Retorna tudo que o material precisa.
// normals=false (mobile em props pequenos) → normalMap:null.
export function materialMaps(name, { size = 256, normals = true } = {}) {
  return cached(`mat:${name}:${size}:${normals}`, () => {
    const def = MATERIALS[name];
    const { cv, ctx } = makeCanvas(size, def.base);
    def.draw(ctx, size);
    const map = toTexture(cv);                    // sRGB, multiply sobre material.color
    let normalMap = null;
    if (normals) {
      const hCv = def.drawHeight ? buildHeight(def, size) : luminanceCanvas(cv);
      normalMap = heightToNormal(hCv, { strength: 2.0 });
    }
    return { map, normalMap, normalScale: def.normalScale,
             roughness: def.roughness, metalness: def.metalness };
  });
}
```

`buildHeight(def,size)` cria um canvas cinza e chama `def.drawHeight(ctx,size)`.
`luminanceCanvas(cv)` copia o albedo e o converte pra cinza (fallback de relevo barato).

### 2.3 Técnicas de desenho por material (concretas)

Todos reusam `speckle()`/`dampStain()`. Albedo sempre **claro** (base ≥ #ece…). Height em
cinza: **branco = alto, preto = fundo do sulco**.

| material | albedo (draw) | height (drawHeight) | normalScale |
|---|---|---|---|
| **drywall** (paredes/cômodos) | mottle de rolo: 4–6 blobs radiais suaves α~0.03; speckle fino (grão); 1–2 arranhões (traços diagonais escuros curtos); 1 mancha de umidade discreta embaixo (`dampStain` leve) | "casca de laranja": pontinhos aleatórios de altura baixa | 0.25 |
| **wood** (mesa/estante/teca) | 3–5 tábuas em bandas de tom levemente variável; veios: curvas quadráticas finas marrom α baixo; 1–2 nós (gradiente radial escuro); emendas escuras a cada N px | veios + emendas como **sulcos** (escuro=baixo) | 0.40 |
| **metal** (geladeira/armário/aço) | escovado horizontal: muitas linhas 1px com jitter de brilho (anisotrópico); 1 emenda vertical; leve escurecimento de borda | as estriações como micro-relevo bem raso | 0.20 (+ metalness 0.30, rough 0.35) |
| **fabric** (sofá/cadeiras) | trama: grade de retângulos alternando claro/escuro α baixo (cesta); felpa via speckle denso fino | relevo em xadrez da trama (bump) | 0.50 (rough 0.92) |
| **cardboard** (caixotes) | speckle kraft quente denso; faixas de flauta (corrugação) claras/escuras suaves; 1 tira de fita mais clara; 1 borrão de carimbo (retângulo arredondado escuro α baixo) | cristas senoidais da corrugação + desgaste de borda | 0.35 |
| **plastic** (lixeiras/vidro do vending/acabamentos) | quase liso: 1–2 linhas de molde retas fracas; mottle de brilho sutil; poeira mínima | quase plano, só os sulcos de molde | 0.15 |
| **concrete** (laje/pilares) | agregado: speckle cinza variado (claro+escuro); 2–3 trincas capilares (polilinhas escuras irregulares); manchas amplas (`dampStain` cinza) | pitting (speckle) + trincas profundas | 0.50 (rough 1.0) |

**Costura do tile:** os geradores atuais não são perfeitamente costuráveis; com
`normalScale` baixo e `dampStain` esparso a emenda é imperceptível. Não vale o custo de
tornar tudo perfeitamente tileável agora.

### 2.4 O que ganha normal map e o que NÃO ganha (orçamento mobile)

Normal map custa **fill-rate** (fetch extra + TBN por fragmento). O custo escala com
**pixels na tela**, não com número de meshes. Logo:

- **Sempre (desktop e mobile):** **paredes** (verticais, pegam luz rasante → maior
  payoff visual) e **cômodos**. Piso: sim no desktop; no mobile **opcional** (cobre muita
  tela → caro) — recomendo **piso sem normal no mobile**, só albedo do carpete.
- **Props médios/grandes** (geladeira, sofá, mesa, caixotes, laje): normal **no desktop**;
  **no mobile só os grandes** (área de tela relevante), controlado pelo flag `normals`.
- **Props pequenos/decorativos** (esferas, cones, cilindros, itens de prateleira):
  **nunca** normal — área de tela minúscula, custo de bind não compensa.
- **Teto:** já é `PlaneGeometry` visto de baixo e escuro; **sem normal** (não compensa).

---

## 3. `src/Level.js` — helpers, paleta e compartilhamento

### 3.1 Uniformizar map/normalMap/roughness/metalness nos helpers

Estado atual: só `_addBox` aceita textura. `_addSphere/_addCylinder/_addCone` fixam
material sem mapa; `_deco` aceita várias opts mas não mapa.

**`_addBox`** (Level.js:73) — já é opts-based. **Adicionar** `normalMap`, `normalScale`
às opts e aplicar:
```js
if (normalMap) { mat.normalMap = normalMap; mat.normalScale = new THREE.Vector2(normalScale, normalScale); }
```
`map` continua clonado por-mesh p/ repeat próprio (barato, §0). `normalMap` pode ser
**compartilhado direto** (sem clone) entre climbables — a oclusão mexe em
`opacity/transparent/depthWrite` do **material**, nunca no textura. Se quiser repeat
próprio no normal, clonar também (igual ao map).

**`_deco`** (Level.js:164) — já opts-based. Adicionar as mesmas chaves
`map/normalMap/normalScale`. Retrocompatível (todas as ~20 chamadas ignoram as novas).

**`_addSphere`** (Level.js:116) — mudar assinatura para opts trailing:
```js
_addSphere(r, color, x, y, z, opts = {}) // { map, normalMap, normalScale, roughness, metalness, colorable, cast }
```
As 4 chamadas (282, 302, 303, 740) passam 5 args → **intactas**.

**`_addCylinder`/`_addCone`** (132, 147) — hoje o 6º arg é `castShadow` (bool). Dobrar
em opts e **atualizar as 3 chamadas** que passam o bool (412, 738, 739). São 3 linhas, não
60 — troca `, false)`/`, cast)` por `, { cast:false })`/`, { cast })`.
```js
_addCylinder(r, h, color, x, z, opts = {}) // { cast=true, map, normalMap, normalScale, roughness, metalness, colorable }
```

### 3.2 Compartilhamento **SEGURO** de material (o ponto crítico)

**PERIGO REAL:** `Game._updateOcclusion` (Game.js:263-292) itera `level.climbables` e muta
`material.transparent/opacity/depthWrite` do oclusor. **Se dois climbables compartilharem
material, desvanecer um desvanece o outro.** Portanto:

> **Regra:** material compartilhado **somente para meshes NÃO-climbable** (deco, esferas,
> cones, cilindros — nenhum é oclusor). **Todo climbable mantém material único** (é o que
> `_addBox` já faz — **não** rotear `_addBox` pela cache).

Camuflagem é segura sob sharing: colorables que compartilham material têm, por definição,
a mesma cor — `isCamouflaged` lê a cor certa. E `_tryCamouflage` copia a cor (não a
referência), então não há aliasing de estado.

Cache de material para não-climbables:
```js
// no constructor: this._matCache = new Map();
_sharedMat({ color, roughness = 0.7, metalness = 0.05, map = null, normalMap = null, normalScale = 0.3 }) {
  const key = `${color}|${roughness}|${metalness}|${map?map.uuid:0}|${normalMap?normalMap.uuid:0}|${normalScale}`;
  let m = this._matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    if (map) m.map = map;
    if (normalMap) { m.normalMap = normalMap; m.normalScale = new THREE.Vector2(normalScale, normalScale); }
    this._matCache.set(key, m);
  }
  return m;
}
```
Usado por `_addSphere/_addCylinder/_addCone/_deco` (todos não-climbable). Muitos
decorativos repetem cor+params → colapsam para um punhado de materiais.

### 3.3 Compartilhamento de geometria

Geometria nunca é mutada por-mesh → seguro compartilhar sempre. Cache por tipo+dims
quantizadas:
```js
// this._geoCache = new Map();
_geo(key, make) { let g = this._geoCache.get(key); if (!g) { g = make(); this._geoCache.set(key, g); } return g; }
// ex.: sphere r=0.5 → _geo(`sph:${r.toFixed(2)}`, () => new THREE.SphereGeometry(r,32,24))
```
Aplicar em `_addSphere/_addCylinder/_addCone` (dims discretas se repetem no scatter) e nas
geometrias fixas de `_deco` dos props temáticos. `_addBox`/`RoundedBoxGeometry`: dims quase
sempre únicas → pouco ganho, pode deixar como está.

### 3.4 Mapeamento paleta/material dos props

Substituir `HERO_COLORS` (Level.js:18-27) pela **paleta assinatura** (§1) e casar cada
prop com o material físico plausível:

- `_buildRoom` (cada cômodo): 1 cor assinatura distinta + material `drywall`.
- `_buildFridge` → `metal`, cor `creme`/`azul-aço`.
- `_buildShelf`/`_buildDeskSet` → `wood`, cor `teca`/`ocre`.
- `_buildSofa` → `fabric`, cor `oxblood`/`olive`/`malva`/`floresta`.
- `_buildCrates` → `cardboard` (kraft) — pode variar levemente o tom da base por caixa.
- `_buildVendingMachine` corpo → `metal`/`plastic`; vidro frontal fica como está (emissivo).
- `_buildBrokenHighway` laje → `concrete`/asfalto (`rubber`/concrete escuro).
- Paredes de perímetro/partições (`_addWall`) → seguem `wallpaperTexture` **+ normalMap**
  do drywall (relevo de rolo). Manter cor `0xcbbf82`.
- `PALETTE` do `_scatterProps` (Level.js:644-649): trocar `...HERO_COLORS` por
  `...SIGNATURE`; manter os neutros (pretos/cinzas/marrons). Clustering aqui é ok.

`shade()` (Level.js:760) continua servindo para derivar detalhes (almofadas/sulcos) da cor
assinatura.

---

## 4. Scaling de qualidade mobile

`Game.isMobile` já existe (Game.js:35). Propagar para o `Level` e para os geradores.

**Assinatura:** `new Level(this.scene, layout, { mobile: this.isMobile })` (Game.js:74);
`Level.constructor(scene, layout, opts = {})` guarda `this._mobile = !!opts.mobile`.

Parâmetros por qualidade:

| item | desktop | mobile |
|---|---|---|
| tamanho de textura albedo | 256 | **128** |
| normal maps | on (paredes/piso/props grandes) | **só paredes + props grandes; piso e props pequenos off** |
| tamanho de normal map | 256 | **128** |
| anisotropy | 4 | 2 |
| **casters de sombra** | como hoje | **reduzir drasticamente (abaixo)** |
| shadow map | 2048 (já) | 1024 (já) |

**Redução de casters (maior ganho por-frame).** Hoje `_addBox`/`_addSphere` setam
`castShadow=true` incondicional; ~60–70% dos meshes projetam sombra num único
directional. No mobile:
```js
// _addBox: só estruturas altas/grudáveis projetam sombra no mobile
mesh.castShadow = this._mobile ? (climbable && h >= 3.0) : true;
// _addSphere/_addCone/_addCylinder no mobile: cast só se explicitamente pedido E grande
```
Alvo: cair de ~120–140 casters para ~30–50 no mobile → passada de sombra ~½. Paredes de
perímetro e pilares continuam projetando (dão a sombra de ambiente); scatter pequeno não.

---

## 5. Riscos e mitigação

1. **Camuflagem (cor).** Mapas albedo com média perto do branco (§1) preservam a leitura.
   Paleta assinatura verificada ≥0.15 em linear (§1). `normalMap`/`roughness` **não** afetam
   `material.color` → camo intacta. `metalness` alto escurece a leitura difusa de metais —
   manter ≤0.35 nos coloráveis metálicos p/ a cor ainda "aparecer" (checar geladeira/aço no
   playtest de camo).
2. **Oclusão × sharing (HAZARD).** Coberto em §3.2: **climbables nunca compartilham
   material**. Se algum dia rotear `_addBox` por cache, a oclusão desvaneceria props
   irmãos juntos — não fazer. Textura (map/normalMap) pode ser compartilhada entre
   climbables sem risco (oclusão só mexe em opacity/transparent/depthWrite).
3. **normalMap com colorSpace errado** → superfície "chapa" ou com tinta azulada.
   `heightToNormal` seta `NoColorSpace` (não usar `toTexture`, que é sRGB).
4. **Fill-rate mobile** (normal em superfícies grandes) → seguir §2.4/§4 (piso sem normal
   no mobile). Medir FPS antes/depois num aparelho real.
5. **Tempo de load** (geração de normais). ~15–35 ms desktop / ~5–10 ms mobile (128²). Ok,
   mas se crescer, gerar sob demanda por material realmente usado (o `cached()` já faz isso:
   só materializa o que é pedido).

---

## 6. Plano de implementação (ordenado) + verificação

1. **textures.js — infra de normal.** Add `heightToNormal`, `luminanceCanvas`,
   `buildHeight`. *Verif.:* teste isolado gerando um normal de um gradiente e conferindo
   que o canal Z domina (≈0.5,0.5,1.0 em área plana).
2. **textures.js — registro `MATERIALS` + `materialMaps()`** com os 7 `draw`/`drawHeight`.
   Começar por `drywall`, `wood`, `metal` (cobrem paredes + maioria da mobília).
   *Verif.:* página de teste rendendo um plano por material sob a luz atual; olho conferindo
   que albedo é claro (multiply não escurece a cor) e relevo é sutil.
3. **Level.js — helpers.** Estender `_addBox`/`_deco` (add `normalMap/normalScale`); mudar
   `_addSphere` (opts trailing) e `_addCylinder/_addCone` (opts, atualizar 3 chamadas).
   Add `_sharedMat`, `_geoCache/_geo`, `this._matCache`. *Verif.:* jogo carrega, nada
   quebra; contar materiais/geometrias (`renderer.info.memory`) antes/depois.
4. **Level.js — paleta.** Trocar `HERO_COLORS` → `SIGNATURE`; casar props↔material (§3.4);
   `wallpaper` das paredes recebe normal do drywall. *Verif.:* rodar o script de camo (§1)
   no conjunto final de cores coloráveis (incluindo `0xcbbf82`); nenhum par < 0.13.
5. **Mobile scaling.** Propagar `mobile` para Level+geradores; aplicar tamanhos, `normals`
   seletivo e **corte de casters**. *Verif.:* `renderer.info.render.calls` e nº de casters;
   FPS em aparelho real (ou `pointer:coarse` forçado no devtools) — comparar com baseline.
6. **Playtest de camuflagem** em cada layout: grudar em parede, cômodo, geladeira (metal),
   sofá (fabric), caixote (cardboard); confirmar que o badge "CAMUFLADO" acende e que a cor
   copiada bate visualmente com a superfície. Conferir que a **oclusão** ainda desvanece só
   o bloco correto (grudar atrás de um bloco e ver se só ele some).

**Comando de teste manual:** `python -m http.server` na raiz e abrir no navegador (o
importmap exige servidor). Forçar mobile: DevTools → toggle device → recarregar.

---

## 7. Ideias que eu NÃO recomendo (flags)

- **Cache de textura "ciente de repeat" como correção de perf** — desnecessário: o three já
  deduplica upload por Source (§0.1). Fazer como micro-otimização de objetos JS, no máximo,
  e só se o `renderer.info` mostrar contagem de texturas absurda (não vai).
- **Merge/instancing de props grudáveis** para cortar draw calls — **quebra** camo
  por-objeto e fade de oclusão por-objeto. Só serviria para decorativos puramente estáticos,
  e o ganho não paga o risco agora.
- **Normal map em tudo** (piso no mobile, props pequenos, teto) — puro custo de fill-rate/bind
  sem payoff visual. Seguir a lista §2.4.
- **Roughness/metalness map procedurais** neste passo — payoff pequeno perto do custo de
  mais um fetch por fragmento no mobile. Deixar rugosidade escalar por material (constante).
  Reavaliar só se sobrar orçamento no desktop.
- **Aumentar resolução das texturas base além de 256²** — invisível no enquadramento do jogo
  e caro em memória no mobile.
