# Plano — Paridade 1:1 com Meccha Chameleon (P1 · P2 · P3)

> Objetivo do usuário: sair de ~80% de similaridade para **1:1** com o original, nos três
> recursos que faltam na camuflagem/personagem:
> - **P1** — pintura por **zonas** do corpo (bi/tri-tom): tronco de uma cor, pernas de outra.
> - **P2** — copiar a **textura/estampa** da parede (tijolo, madeira, azulejo) para a "pele".
> - **P3** — **poses** + **ocultar os olhos** ao grudar.
>
> Continua a linha do `PLANO_TOON.md` (MVP toon já entregue). Isto é a **Fase 9+**.
> Alvo: mobile web, 100% procedural.

---

## 0. A tensão central (ler primeiro)

Toda a mecânica atual assume **uma cor sólida**:

- `Player`: um único `bodyMat` (`material.color`) + um `targetColor`; `Character.buildBody`
  compartilha ESSE material em todas as partes (a camo tinge o corpo inteiro de uma vez).
- `Player.isCamouflaged()`: compara `this.material.color` × `latchedObject.material.color`
  (maior diff por canal em sRGB; `ENTER=0.07`/`EXIT=0.13`).
- `Player.sampleColor(camera)`: raycast na mira → copia UMA `material.color`.

P1 e P2 quebram essa premissa. O plano preserva o **caminho de cor sólida como fallback**
(forma sem zonas / sem estampa continua funcionando) e adiciona os novos modos por cima,
para não desestabilizar o feel já aprovado.

> **Consequência de design importante (P1):** hoje as paredes são **caixas de cor
> chapada única**. Se o corpo tem 2 zonas mas a parede atrás é toda de uma cor, bi-tom
> **não dá vantagem** (as duas zonas copiam a mesma cor). Logo, P1 **exige** introduzir
> **regiões de cor verticais** no cenário — ex.: **rodapé (baseboard)** e/ou **friso
> (dado rail)** de cor distinta. Sem isso, P1 é só cosmético. Está no escopo do P1.

---

## P1 — Pintura por ZONAS (bi/tri-tom) 🔴 essencial e mais difícil

### Zonas
Dividir o corpo em **2 zonas** (MVP) — `upper` (cabeça+tronco+braços) e `lower`
(pernas/pés) — com folga para uma 3ª (`head`) depois.

### Passos
1. **`Character.buildBody` (src/Character.js):** aceitar **materiais por zona** em vez de
   um só. Assinatura: `buildBody(materials, height, opts)` onde `materials` pode ser
   um `THREE.Material` (comportamento atual — todas as zonas iguais, mantém o Caçador) ou
   `{ upper, lower }`. Cada parte escolhe o material da sua zona (nas 3 formas: em `blob`,
   a massa = `upper`, os nubs de baixo = `lower`; em `cube`, cabeça/tronco = `upper`,
   pernas = `lower`). O contorno (inverted-hull) segue por-parte.
2. **`Player` (src/Player.js):** criar `this.zones = [{ mat, target }]` (upper/lower),
   cada um com seu `MeshToonMaterial` + `targetColor`. Generalizar o **lerp de cor** e o
   **glow** para iterar as zonas. `this.material` vira getter da zona `upper` (retrocompat
   para o `#color-chip` do HUD, ou o chip passa a mostrar 2 swatches).
3. **`sampleColor` → por zona (automático, sem UI extra — recomendado):** ao tocar 🎨,
   para **cada zona** faz um raycast a partir da **posição de mundo daquela zona** na
   direção da parede (−normal quando grudado; direção da câmera no chão) e copia a cor da
   superfície ali. Resultado mágico: encostado num trecho com **rodapé marrom + parede
   amarela**, a zona `lower` pega o marrom e a `upper` o amarelo **automaticamente**.
   - **Opção manual (fino):** um toggle de zona no HUD faz a **roda de cor (5b)** editar a
     zona selecionada. Reaproveita `ColorPicker` (só muda o alvo do `onChange`).
4. **`isCamouflaged` → por zona:** para cada zona, amostrar a cor da superfície **atrás
   daquela zona** (mesmo raycast do passo 3, contra `level.colorables` — não só o
   `latchedObject`, para pegar o rodapé como mesh separado) e comparar com a cor da zona.
   **Camuflado = TODAS as zonas batem** (dentro do limiar). Mantém `ENTER/EXIT` em sRGB.
5. **Cenário (habilita o bi-tom):** em `Level.js`, adicionar **rodapé** (faixa baixa,
   ~0.5 m, cor distinta) e opcionalmente **friso/dado** nas paredes dos cômodos e no
   perímetro. Cada faixa é um `colorable` próprio. Revalidar deltas de paleta
   (par-a-par ≥0.16) incluindo as novas cores de rodapé.

### Riscos P1
- Redesenho da métrica é o ponto mais sensível — **manter o caminho 1-cor como fallback**
  (se `zones.length === 1`, comportamento idêntico ao atual).
- Custo de mesh do jogador sobe pouco (mesmas partes, +1 material) — desprezível.
- Churn de cenário (rodapés) — fazer incremental e rodar `palette_check`.

---

## P2 — Copiar TEXTURA/estampa da parede 🟡

> **Status:** ✅ feito (MVP, métrica por cor). Pele = CanvasTexture; 🎨 carimba a
> estampa da superfície mirada; roda de cor limpa para cor sólida. Stretch (match de
> padrão real) segue pendente.

### Ideia
A "pele" do corpo vira um **CanvasTexture** editável; o conta-gotas passa a **carimbar o
padrão** da superfície (não só a cor).

### Passos
1. **Pele = CanvasTexture (src/Player.js):** cada zona ganha um `<canvas>` (128–256 px) como
   `material.map`. Base = branco.
2. **`sampleTexture` (novo):** a superfície-alvo já tem `material.map` cujo `.image` é o
   **canvas do padrão** (gerado em textures.js). Ao tocar 🎨: `drawImage` do padrão da
   superfície na pele da zona (ajustando escala/tom) + `map.needsUpdate = true`. Trabalha
   sobre o mesmo raycast por-zona do P1.
3. **Métrica (pragmática):** comparar padrões de verdade é caro. **MVP:** o portão de
   stealth continua **por cor** — guardamos `zone.matchColor` = **cor média** do padrão
   carimbado (calculada 1× no carimbo, lendo `getImageData`), e `isCamouflaged` compara
   `matchColor` × cor média da superfície. Visualmente é a estampa; mecanicamente é a cor
   média. **Sutileza:** com `map` mostrando o padrão real, pôr `material.color = branco`
   (senão multiplica) — por isso a métrica usa `matchColor`, não `material.color`.
4. **Custo:** um CanvasTexture por zona é barato; o carimbo roda **no toque**, não por
   frame. Manter a pele pequena no mobile.

### Stretch P2
Casamento de **padrão** real (não só cor média): comparar canvases reduzidos (ex. 8×8) por
distância — dá peso à estampa, não só à cor. Opcional; pode frustrar no touch.

---

## P3 — Poses + ocultar olhos 🟢

> **Status:** 3a ✅ e 3b ✅ feitos (Player.js). 3c pendente (stretch).

Ordenado do mais barato/impactante ao mais custoso:

1. **Ocultar olhos ao camuflar (3a — ganho rápido):** quando `isCamouflaged()` (ou ao
   grudar), esconder as pupilas (`this._pupils`) — `visible=false` ou escala→0 com lerp
   curto; revelar ao sair. Resolve direto o "olhos pretos denunciam". Sem mexer na métrica.
2. **Face contra a parede (3b):** hoje o latch orienta a face (local +Z) para **fora**
   (olhos para a câmera). Quando camuflado, girar para **prensar a face na parede**
   (+Z = −normal). A câmera fica do lado da normal e vê as **costas** (brancas/pintadas) —
   ótimo para esconder. Implementar como variação de `_orientTo` no estado camuflado.
3. **Menu de poses (3c — stretch):** 2–3 poses congeladas que alinham o corpo às linhas do
   cenário: **deitar** (rotaciona ~90° em X, vira "tapete" no chão), **estátua de canto**
   (encolhe/tuck). São estados de orientação + pose no `Gait`. Maior esforço; fazer por
   último. Requer cuidado com colisão/latch (a pose é visual; a cápsula lógica não muda).

### Riscos P3
- 3b muda o que a câmera enquadra (costas em vez de rosto) — validar no playtest.
- 3c mexe em orientação: garantir que **não** afeta `solids`/latch (só o grupo visual).

---

## Ordem recomendada (engenharia × valor)

A prioridade do usuário é P1→P2→P3, mas por **risco/retorno** recomendo:

1. **P3a + P3b** (ocultar olhos + face na parede) — baratos, fidelidade imediata, **sem**
   mudar a métrica. Ótimo primeiro passo.
2. **P2** (carimbo de estampa, métrica por cor média) — grande salto visual, esforço médio.
3. **P1** (zonas + rodapés + métrica por zona) — o mais difícil (métrica + cenário); com
   P2 pronto, cada zona já pode carregar a estampa da sua faixa. Fazer por último.
4. **P3c** (menu de poses) e **stretch de P2** (match de padrão) — opcionais no fim.

> Se o usuário preferir seguir a numeração (P1 primeiro), tudo bem — só começa pelo item
> de maior risco. A recomendação acima entrega "cara de Meccha" mais cedo.

Cada item = 1+ commits, **boot headless** (`chromium --headless=new
--enable-unsafe-swiftshader` instanciando `buildBody`/`Game`) + **playtest** pelo túnel.
Servir sempre com `dev_server.py` (no-store).

## Verificação
- `palette_check` estendido (inclui rodapés/friso do P1; deltas ≥0.16).
- Boot headless: as 3 formas com zonas (`upper`/`lower`) constroem e o Gait anima; carimbo
  de textura não lança; `isCamouflaged` por zona retorna bool coerente.
- Playtest: bi-tom num trecho parede+rodapé; carimbo de padrão legível; olhos somem ao
  camuflar; face vira para a parede; conforto no touch.

## Estado-alvo (1:1)
Encostar num trecho com **rodapé de madeira + parede de azulejo**, tocar 🎨 uma vez →
pernas recebem a **madeira** e o tronco o **azulejo** (cor+estampa), os **olhos somem** e a
**face prensa** na parede → invisível como no original.
