# Especificação Técnica: Mapa "Chameleon Manor"
## Adaptação do "Mansion Plus" para Esconde ou Morre (Three.js Procedural)

---

## 1. Resumo Executivo

**Nome interno:** `chameleon_manor`  
**Nome exibido:** Chameleon Manor / Mansão Meccha  
**Base conceitual:** Expansão do mapa Mansão atual, incorporando lições do *Meccha Chameleon* e da especificação "Grand Estate".  
**Premissa:** Mansão europeia clássica com toques surrealistas leves, 3 andares + porão, alta densidade de props procedurais, paleta pop toon, e 18+ hero spots de camuflagem documentados.

**Diferencial em relação aos mapas existentes:**
- Maior verticalidade (3 andares + porão vs. 2 andares atuais)
- Galeria de Arte dedicada (quadros pintáveis como superfícies de camuflagem)
- Padrões complexos procedurais (papel de parede, azulejos, tapetes) que recompensam alinhamento fino
- Iluminação variada por zona (quente, fria, industrial, natural)
- Passagens secretas (1 porta falsa, 1 painel móvel)

---

## 2. Restrições Técnicas do Projeto (Checklist de Viabilidade)

| Restrição | Status no Mapa Proposto |
|-----------|------------------------|
| 100% procedural — sem assets `.glb`/`.fbx` de cenário | ✅ Toda geometria via `THREE.BoxGeometry`, `CylinderGeometry`, `PlaneGeometry` |
| Estilo toon/cel-shaded (`MeshToonMaterial`, `gradientMap`) | ✅ Paleta limitada, sem PBR real |
| Suporte a 2+ andares com escadas e colisão | ✅ Escadas principais + escadas de serviço |
| Sistema `colorables` (superfícies amostráveis pelo jogador) | ✅ Toda parede/prop relevante expõe `userData.colorable = true` |
| Waypoints para patrulha do `Seeker` | ✅ Rede de waypoints por andar + conexões verticais |
| Oclusão de câmera (`Game._updateOcclusion`) | ✅ Props altos marcados como ocluders |
| Modo Online compatível (rotação determinística) | ✅ Seed fixa por hora, layout idêntico cliente/servidor |
| Performance mobile-first (60 FPS em mid-range) | ✅ LOD agressivo, instancing de props repetidos |

---

## 3. Estrutura do Mapa

### 3.1 Dimensões Gerais
- **Área jogável:** ~1.3× a mansão atual (120m × 80m de footprint)
- **Altura total:** 14m (porão 3m, térreo 4.5m, 1º andar 4m, ático 2.5m)
- **Grid de colisão:** 0.5m (mantém compatibilidade com `Player.js`)

### 3.2 Zonas por Andar

```
PORÃO (-3m a 0m)
├── Cozinha Industrial (colorables: azulejos brancos/azuis, aço inox, caixas de papelão)
├── Adega (colorables: tijolos escuros, barris de madeira, garrafas)
├── Área de Serviço (colorables: concreto, tubos metálicos, caixas empilhadas)
└── Escada de Serviço (conexão com Térreo)

TÉRREO (0m a 4.5m)
├── Ballroom / Salão Principal (colorables: mármore claro, pilares de pedra, cortinas)
├── Hall de Entrada (colorables: madeira de lei, tapete vermelho, papel de parede)
├── Galeria de Arte Leste (colorables: 24 quadros variados, molduras douradas, paredes verde-sálvia)
├── Biblioteca Oeste (colorables: estantes de carvalho, lombadas coloridas, carpete)
├── Corredor Central (colorables: papel de parede listrado, piso de tacos, luminárias)
├── Banheiro de Visitas (colorables: azulejos hexagonais brancos, espelho, toalhas)
└── Escada Principal (conexão com 1º Andar)

1º ANDAR (4.5m a 8.5m)
├── Quarto Principal (colorables: papel de parede floral, cama com colcha, carpete)
├── Quarto de Hóspedes (colorables: listras azuis/brancas, escrivaninha, cortinas)
├── Sala de Costura / Storage (colorables: tecidos coloridos, caixas, prateleiras)
├── Banheiro de Luxo (colorables: azulejos pretos/dourados, banheira, espelho grande)
├── Mezanino da Biblioteca (colorables: corrimão de ferro, vista para baixo)
└── Escada de Serviço + Escada Principal (conexões)

ÁTICO (8.5m a 11m)
├── Sótão Aberto (colorables: madeira envelhecida, baús, caixas, teias de aranha decorativas)
├── Telhado Parcialmente Acessível (colorables: telhas escuras, chaminés, beiral)
└── Claraboia sobre Ballroom (vidro, não colorable, mas oclusor)
```

---

## 4. Paleta de Cores Toon (Materiais)

O mapa usa **apenas** `MeshToonMaterial` com `gradientMap` de 3-4 tons. Cada cor é um material instanciado reutilizado.

### 4.1 Materiais Base (Reutilizáveis)

| ID | Cor Hex | Uso Principal | Zonas |
|----|---------|---------------|-------|
| `wall_cream` | `#F5F0E1` | Paredes base, teto | Geral |
| `wall_sage` | `#8FA68E` | Galeria, corredores | Térreo |
| `wall_floral` | `#E8D5C4` | Papel de parede floral | 1º Andar |
| `wall_striped` | `#D4C5B0` | Papel listrado (procedural) | Corredor |
| `wood_oak` | `#A67B5B` | Estantes, pisos, portas | Biblioteca, Hall |
| `wood_dark` | `#5C4033` | Madeira envelhecida | Ático, Porão |
| `marble_white` | `#F0F0F0` | Piso Ballroom | Térreo |
| `tile_blue` | `#4A7C8C` | Azulejos banheiro/cozinha | Térreo, 1º Andar |
| `tile_black` | `#2A2A2A` | Azulejos banheiro luxo | 1º Andar |
| `fabric_red` | `#B85450` | Cortinas, tapetes | Ballroom, Hall |
| `fabric_gold` | `#C9A961` | Molduras, detalhes | Galeria |
| `metal_iron` | `#6B6B6B` | Corrimões, tubos | Escadas, Porão |
| `book_spine_1` | `#8B4513` | Lombadas livros | Biblioteca |
| `book_spine_2` | `#2F4F4F` | Lombadas livros | Biblioteca |
| `book_spine_3` | `#800000` | Lombadas livros | Biblioteca |
| `book_spine_4` | `#556B2F` | Lombadas livros | Biblioteca |
| `concrete_gray` | `#808080` | Porão, área serviço | Porão |
| `plant_green` | `#4A7C59` | Vasos, folhagem | Geral |

### 4.2 Materiais Especiais (Não-colorables)

| ID | Tipo | Uso |
|----|------|-----|
| `glass` | `MeshPhysicalMaterial` (transparente, baixo custo) | Claraboia, espelhos |
| `mirror` | `MeshToonMaterial` + `envMap` fake (cubo de cor sólida) | Espelhos do banheiro |

---

## 5. Props Procedurais — Especificação de Geometria

Todos os props são construídos via composição de geometrias básicas do Three.js. **Nenhum asset externo**.

### 5.1 Props Alto Valor (Densos / Quebram Silhueta)

#### **Estante de Livros (`Bookshelf`)**
```javascript
// Estrutura
const shelf = new THREE.Group();
// Caixa principal: BoxGeometry(0.4, 2.4, 0.3)
// Prateleiras internas: 5x BoxGeometry(0.38, 0.02, 0.28) espaçadas 0.45m
// Livros: BoxGeometry(0.03-0.08, 0.18-0.22, 0.25) em fileiras
// Cores alternadas entre book_spine_1..4 + variação de rotação Y ±5°
// userData: { colorable: true, colorType: 'wood_oak' } na estrutura
// Cada livro: userData: { colorable: true, colorType: 'book_spine_N' }
```
- **Quantidade:** 8 unidades na Biblioteca, 2 no Quarto, 1 no Storage
- **Instancing:** Sim (matriz de posição + paleta de 4 cores)
- **Oclusor:** Sim (altura > 1.5m)

#### **Quadro com Moldura (`Painting`)**
```javascript
// Moldura: BoxGeometry(0.08, w+0.16, h+0.16) — cor `fabric_gold`
// Tela: PlaneGeometry(w, h) — cor procedural por quadro
// Sistema de "tela pintável": o jogador pode amostrar a cor da tela
// userData: { colorable: true, colorType: 'canvas_N', isFlatSurface: true }
```
- **Quantidade:** 24 na Galeria, 8 no Corredor, 4 no Ballroom
- **Variações de tamanho:** 0.6×0.8m, 0.8×1.0m, 1.2×0.9m (paisagem)
- **Tela procedural:** Cada quadro gera uma cor base + 2-3 formas geométricas abstratas (círculos/retângulos) em tons complementares. O jogador pode amostrar qualquer pixel.

#### **Pilar de Pedra (`Pillar`)**
```javascript
// Base: CylinderGeometry(0.25, 0.28, 0.2, 8)
// Fuste: CylinderGeometry(0.2, 0.2, 3.8, 8)
// Capitel: BoxGeometry(0.5, 0.15, 0.5)
// Cor: `marble_white` com variação sutil de emissão
```
- **Quantidade:** 6 no Ballroom, 2 no Hall
- **Oclusor:** Sim
- **Colorable:** Sim (textura sólida, amostragem única)

#### **Vaso com Planta (`PlantVase`)**
```javascript
// Vaso: CylinderGeometry(0.15, 0.2, 0.4, 8) — cerâmica colorida
// Planta: 3-5 esferas escaladas aleatoriamente (folhas) + cilindro fino (caule)
// Folhas: IcosahedronGeometry(0.12, 0) escalado em Y
```
- **Quantidade:** 12 espalhados
- **Colorable:** Vaso sim, folhas sim (`plant_green`)

#### **Sofá (`Sofa`)**
```javascript
// Base: BoxGeometry(1.8, 0.4, 0.7)
// Encosto: BoxGeometry(1.8, 0.5, 0.15) posicionado em Z-
// Braços: 2× BoxGeometry(0.15, 0.5, 0.7)
// Almofadas: 2× BoxGeometry(0.7, 0.08, 0.5) no topo
```
- **Quantidade:** 4 no Ballroom, 2 na Biblioteca
- **Colorable:** Sim (`fabric_red` ou variação)
- **Oclusor:** Sim

### 5.2 Props Médios (Quebram Silhueta / Cobertura Parcial)

| Prop | Geometria | Quantidade | Colorable |
|------|-----------|------------|-----------|
| Mesa de centro | Cilindro (tampo) + 4 caixas finas (pernas) | 6 | Sim (tampo) |
| Banheira | Cilindro alongado (oco visual) | 2 | Sim (azulejo) |
| Baú | Caixa com tampa inclinada 15° | 8 | Sim (wood_dark) |
| Caixa de papelão | Caixa com abas abertas | 15 | Sim (cardboard) |
| Barril | Cilindro com anéis (torus) | 6 | Sim (wood_dark) |
| Cortina | Plano duplo (frente/verso) + onda em Z | 10 | Sim (fabric_red) |
| Lustre | Cilindro central + 6 caixas (braços) + esferas (luzes) | 3 | Parcial |
| Estatueta | Cilindro + esfera (abstrata) | 4 | Sim (mármore) |

### 5.3 Props de Ambiente (Baixo Custo)

| Prop | Geometria | Quantidade |
|------|-----------|------------|
| Tapete retangular | Plano com borda elevada | 8 |
| Luminária de parede | Caixa + esfera pequena | 12 |
| Prateleira vazia | Caixa fina + suportes triangulares | 10 |
| Toalha | Plano fino com dobras (3 segmentos) | 6 |

---

## 6. Sistema de Superfícies Pintáveis (`colorables`)

Este é o **sistema central** do mapa. Toda superfície que o jogador pode amostrar deve estar registrada.

### 6.1 Hierarquia de Colorables

```javascript
// Exemplo: Parede da Galeria
const wall = new THREE.Mesh(geometry, material);
wall.userData = {
  colorable: true,
  colorType: 'wall_sage',      // Referência para a paleta
  isPattern: false,            // Se true, amostra múltiplos pontos
  patternScale: 1.0,           // Escala do padrão procedural
  roughnessHint: 0.8           // Para efeito visual toon (não PBR real)
};
```

### 6.2 Superfícies com Padrão Procedural (Alta Dificuldade / Alta Recompensa)

#### **Papel de Parede Listado (Corredor)**
```javascript
// Geração: Material com stripe procedural via canvas
// Canvas 64×64: listras verticais de 8px alternando #D4C5B0 e #C4B5A0
// Quando o jogador amostra, retorna a cor do pixel exato
// Dificuldade: Média (padrão regular, fácil de replicar)
```

#### **Azulejos Hexagonais (Banheiros)**
```javascript
// Canvas 128×128: grid hexagonal
// Cores: branco (#F0F0F0) com rejunte cinza (#B0B0B0)
// Amostragem precisa recompensa jogadores atentos ao alinhamento
// Dificuldade: Alta (padrão geométrico exige pose flat)
```

#### **Lombadas de Livros (Biblioteca)**
```javascript
// Cada livro é um colorable independente
// 4 paletas base + variação de matiz ±10° por prateleira
// O jogador pode amostrar uma "fileira" ou um livro individual
// Dificuldade: Baixa-Média (blocos de cor sólida)
```

#### **Telas de Quadro (Galeria)**
```javascript
// Cada quadro gera uma composição abstrata procedural única
// 3-4 formas geométricas em tons complementares
// O jogador pode se pintar como "parte da obra"
// Dificuldade: Muito Alta (exige pintura manual com Pincel Livre)
```

### 6.3 Zonas de Camuflagem por Tipo

| Zona | Tipo de Match | Nível de Dificuldade | Pose Recomendada |
|------|---------------|---------------------|------------------|
| Biblioteca (entre livros) | Cor + Cluster | Média | Crouch / Prone |
| Galeria (como quadro) | Cor + Padrão + Forma | Muito Alta | Flat Against Wall |
| Ballroom (pilar) | Cor sólida | Baixa | Climb / Flat |
| Banheiro (azulejo) | Padrão geométrico | Alta | Flat Against Wall |
| Porão (caixas) | Cor + Cluster | Baixa | Crouch |
| Ático (madeira) | Cor + Textura | Média | Prone / Crouch |
| Hall (tapete) | Padrão + Cor | Média | Lie Down |
| Cozinha (aço inox) | Cor metálica | Média | Flat / Crouch |

---

## 7. Iluminação Toon por Zona

O mapa usa `SpotLight` e `PointLight` com `decay=2` (física real) mas **limitados** para performance mobile.

### 7.1 Setup por Zona

```javascript
// Ballroom — Iluminação quente difusa
const ballroomLight = new THREE.PointLight(0xFFE4B5, 1.2, 20, 2);
ballroomLight.position.set(0, 4, 0); // Lustre central
// 2 SpotLights auxiliares nas paredes laterais (ângulo 60°, penumbra 0.3)

// Galeria — Iluminação direcional + sombras suaves
const galleryLight = new THREE.SpotLight(0xFFF8DC, 1.0, 15, Math.PI/4, 0.5, 2);
// 1 por quadro, mas otimizado: 4 SpotLights cobrem 24 quadros em batches

// Porão — Iluminação industrial fria
const basementLight = new THREE.PointLight(0xA0C4FF, 0.6, 10, 2);
// 3 unidades espaçadas, sombra desligada em mobile

// Ático — Luz natural filtrada
const atticLight = new THREE.DirectionalLight(0xFFF5E1, 0.8);
atticLight.position.set(5, 10, 5); // Vindo das claraboias
```

### 7.2 Sombras
- **Desktop:** `castShadow = true` em pilares, jogadores, props altos
- **Mobile:** Sombras desligadas, substituídas por "fake shadow" (círculo escuro sob props, `MeshBasicMaterial` transparente)
- **Seeker:** Lanterna do Caçador interage normalmente com todas as superfícies

---

## 8. Waypoints e Patrulha do Seeker

A rede de waypoints deve ser densa o suficiente para o Seeker não parecer robótico, mas não tão densa a ponto de consumir CPU.

### 8.1 Estrutura de Waypoints

```javascript
// Formato compatível com Seeker.js atual
const waypoints = [
  // Térreo
  { id: 'h0', pos: [0, 0.5, 0], zone: 'ballroom', floor: 0 },
  { id: 'h1', pos: [8, 0.5, 4], zone: 'gallery_e', floor: 0 },
  { id: 'h2', pos: [-8, 0.5, 4], zone: 'library_w', floor: 0 },
  { id: 'h3', pos: [0, 0.5, -8], zone: 'hall', floor: 0 },
  { id: 'h4', pos: [4, 0.5, -4], zone: 'bathroom_t', floor: 0 },

  // 1º Andar
  { id: 'h10', pos: [0, 4.5, 0], zone: 'mezzanine', floor: 1 },
  { id: 'h11', pos: [6, 4.5, -3], zone: 'bedroom_main', floor: 1 },
  { id: 'h12', pos: [-6, 4.5, -3], zone: 'bedroom_guest', floor: 1 },
  { id: 'h13', pos: [0, 4.5, 6], zone: 'storage', floor: 1 },
  { id: 'h14', pos: [4, 4.5, 4], zone: 'bathroom_lux', floor: 1 },

  // Porão
  { id: 'h20', pos: [0, -2.5, 0], zone: 'kitchen_ind', floor: -1 },
  { id: 'h21', pos: [5, -2.5, 5], zone: 'cellar', floor: -1 },
  { id: 'h22', pos: [-5, -2.5, 5], zone: 'service', floor: -1 },

  // Ático
  { id: 'h30', pos: [0, 8.5, 0], zone: 'attic_center', floor: 2 },
  { id: 'h31', pos: [4, 8.5, -4], zone: 'attic_storage', floor: 2 },
];

// Conexões (grafo não-direcionado)
const connections = [
  ['h0','h1'], ['h0','h2'], ['h0','h3'], ['h0','h4'],
  ['h3','h4'], ['h1','h4'],
  // Escada principal: h3 -> h10
  ['h3','h10'],
  // 1º andar
  ['h10','h11'], ['h10','h12'], ['h10','h13'], ['h10','h14'],
  ['h11','h14'], ['h12','h13'],
  // Escada de serviço: h0 -> h20 (porão)
  ['h0','h20'],
  // Porão
  ['h20','h21'], ['h20','h22'],
  // Escada de serviço 2: h13 -> h30 (ático)
  ['h13','h30'],
  // Ático
  ['h30','h31'],
];
```

### 8.2 Comportamento do Seeker por Zona

| Zona | Probabilidade de Visita | Tempo Médio de Permanência | Comportamento Especial |
|------|------------------------|---------------------------|----------------------|
| Ballroom | Alta (25%) | 4-6s | Gira 360° no centro |
| Galeria | Média (15%) | 3-5s | Olha para cada quadro (simulação) |
| Biblioteca | Média (15%) | 4-6s | Passa perto das estantes |
| Hall | Alta (20%) | 2-3s | Passagem rápida |
| Porão | Baixa (10%) | 5-8s | Movimento lento, lanterna mais ativa |
| Ático | Muito Baixa (5%) | 6-10s | Checa cantos (spots avançados) |
| Quartos | Média (10%) | 3-4s | Checa atrás de móveis |

---

## 9. Passagens Secretas

### 9.1 Porta Falsa (Biblioteca → Corredor)
- **Localização:** Estante do canto noroeste da Biblioteca
- **Mecânica:** Ao interagir (botão "Escalar" brilha), a estante desliza 1m para dentro, revelando um corredor estreito de 2m que conecta ao Hall de Entrada
- **Visual:** A estante tem cor idêntica às outras, mas com livros ligeiramente mais desalinhados (pista sutil)
- **Uso:** Fuga rápida ou reposicionamento mid-round

### 9.2 Painel Móvel (Quarto de Hóspedes → Storage)
- **Localização:** Parede leste do Quarto de Hóspedes
- **Mecânica:** Painel de madeira que gira 90° no eixo Y, revelando passagem de 1.2m
- **Pista:** Papel de parede ligeiramente mais desbotado no painel
- **Cooldown:** 5s após uso (evita spam)

---

## 10. Hero Spots (18 Spots Documentados)

Cada spot inclui: posição aproximada, pose recomendada, cor(es) a amostrar, ângulos de risco, e nível de dificuldade.

### 10.1 Spots S-Tier (Quase Invisíveis)

| # | Spot | Zona | Posição | Pose | Cores | Risco | Dificuldade |
|---|------|------|---------|------|-------|-------|-------------|
| S1 | **Lombada de Livro** | Biblioteca | Entre fileiras, prateleira 3 | Crouch | `book_spine_2` + variação | Seeker checa estantes de perto | Média |
| S2 | **Quadro Vivo** | Galeria | Parede entre 2 quadros reais | Flat Against Wall | Canvas do quadro N+1 | Ângulo lateral expõe espessura | Muito Alta |
| S3 | **Pilar do Ballroom** | Ballroom | Lado interno do pilar central | Climb/Flat | `marble_white` | Seeker gira ao redor | Baixa |
| S4 | **Azulejo do Banheiro Luxo** | 1º Andar | Parede entre banheira e espelho | Flat Against Wall | `tile_black` + rejunte | Luz do espelho cria highlight | Alta |
| S5 | **Caixa no Porão** | Cozinha Industrial | Pilha de 3 caixas, canto sul | Crouch | `cardboard` | Seeker passa perto | Baixa |

### 10.2 Spots A-Tier (Efetivos com Boa Execução)

| # | Spot | Zona | Posição | Pose | Cores | Risco | Dificuldade |
|---|------|------|---------|------|-------|-------|-------------|
| A1 | **Cortina do Ballroom** | Ballroom | Atrás de cortina leste | Stand/Flat | `fabric_red` + sombra | Cortina balança (movimento!) | Média |
| A2 | **Sofá da Biblioteca** | Biblioteca | Atrás do sofá, encostado na parede | Crouch | `wood_oak` + `fabric_red` | Seeker checa atrás | Média |
| A3 | **Tapete do Hall** | Hall | Centro do tapete vermelho | Lie Down | `fabric_red` + franjas douradas | Seeker pisa ao passar | Média |
| A4 | **Barril da Adega** | Porão | Entre 2 barris, fileira leste | Crouch | `wood_dark` | Seeker checa fileiras | Baixa |
| A5 | **Teto do Ático** | Ático | Trave de madeira, canto noroeste | Flat/Climb | `wood_dark` | Seeker raramente olha para cima | Alta |
| A6 | **Vaso da Galeria** | Galeria | Ao lado do vaso grande, parede sul | Stand | `plant_green` + vaso | Seeker nota silhueta extra | Média |
| A7 | **Moldura Falsa** | Corredor | Parede vazia entre 2 quadros | Flat Against Wall | `wall_sage` | Seeker nota ausência de arte | Alta |

### 10.3 Spots B-Tier (Situacionais / Fallback)

| # | Spot | Zona | Posição | Pose | Cores | Risco | Dificuldade |
|---|------|------|---------|------|-------|-------|-------------|
| B1 | **Sob a Mesa** | Ballroom | Abaixo da mesa de centro | Prone | `marble_white` | Seeker agacha para checar | Baixa |
| B2 | **Cama do Quarto** | 1º Andar | Atrás da cabeceira | Crouch | `wall_floral` | Seeker checa quartos por último | Baixa |
| B3 | **Tecidos do Storage** | 1º Andar | Entre rolos de tecido | Crouch | Variação de tecidos | Seeker passa rápido | Baixa |
| B4 | **Toalha do Banheiro** | Térreo | Gancho de toalha (pequeno) | Flat | Branco puro | Seeker nota tamanho errado | Média |
| B5 | **Chaminé do Ático** | Ático | Lateral da chaminé de tijolos | Stand/Flat | `concrete_gray` | Exposto ao céu | Média |
| B6 | **Estatueta do Hall** | Hall | Base da estatueta abstrata | Crouch | `marble_white` | Seeker reconhece número de props | Média |

---

## 11. Otimização e Performance

### 11.1 Instancing de Props

```javascript
// Exemplo: Livros da Biblioteca
const bookGeometry = new THREE.BoxGeometry(0.05, 0.2, 0.25);
const bookMaterial = new THREE.MeshToonMaterial({ color: 0x8B4513 });
const bookMesh = new THREE.InstancedMesh(bookGeometry, bookMaterial, 200);
// Preenche matriz de instâncias por prateleira
// Cada instância pode ter cor diferente via setColorAt()
```

### 11.2 Oclusão de Câmera

```javascript
// Props marcados como ocluders (fade quando bloqueiam visão do jogador)
const ocluderTags = ['pillar', 'bookshelf', 'sofa', 'plant_large', 'curtain'];
// Em Game._updateOcclusion:
// Raycast da câmera ao jogador; se intersectar ocluder, material.opacity = 0.3
```

### 11.3 LOD (Level of Detail)

| Distância | Comportamento |
|-----------|---------------|
| < 10m | Geometria completa, sombras ativas |
| 10-25m | Geometria simplificada (livros viram caixas, plantas viram cones) |
| > 25m | Props invisíveis, apenas paredes e pisos visíveis |

### 11.4 Limites de Luz

- **Máximo de 8 luzes dinâmicas** simultâneas por câmera
- Luzes distantes (>15m) desligadas automaticamente
- `SpotLight` do Caçador conta como 1 luz dinâmica adicional

---

## 12. Integração com Sistemas Existentes

### 12.1 Level.js

Adicionar método `_buildChameleonManor()` em `Level.js`:

```javascript
_buildChameleonManor() {
  this.currentMap = 'chameleon_manor';
  this.floors = 3; // 0 = térreo, 1 = 1º andar, 2 = ático/porão como extensão

  // 1. Estrutura base (pisos, paredes, tetos)
  this._buildManorStructure();

  // 2. Escadas e conexões verticais
  this._buildManorStairs();

  // 3. Props por zona
  this._buildBallroom();
  this._buildGallery();
  this._buildLibrary();
  this._buildBathrooms();
  this._buildBedrooms();
  this._buildBasement();
  this._buildAttic();

  // 4. Passagens secretas
  this._buildSecretPassages();

  // 5. Waypoints para Seeker
  this._setupManorWaypoints();

  // 6. Colorables registry (para amostragem rápida)
  this._registerColorables();
}
```

### 12.2 Player.js — Amostragem de Cor

O sistema atual de amostragem (`Player._sampleColor`) deve funcionar sem alterações, desde que todos os props relevantes tenham `userData.colorable = true`.

**Ajuste necessário:** Adicionar suporte a `userData.isPattern = true` para que o jogador amostre a cor exata do ponto tocado (em vez da cor média do objeto).

### 12.3 Seeker.js — Patrulha

Nenhuma alteração necessária no `Seeker.js` se os waypoints seguirem o formato existente. O Seeker reutiliza a rede de waypoints automaticamente.

### 12.4 Modo Online

O mapa deve ser elegível para rotação determinística:

```javascript
// Em onlineLayoutFor() ou equivalente
const eligibleMaps = ['mansion', 'factory', 'chameleon_manor'];
// Rotação por hora: (hour % 3) -> 0=mansion, 1=factory, 2=chameleon_manor
```

---

## 13. Checklist de Implementação

### Fase 1 — Estrutura Base (Semana 1)
- [ ] Implementar `_buildManorStructure()` — pisos, paredes, tetos dos 3 andares + porão
- [ ] Implementar escadas (principal + serviço) com colisão
- [ ] Validar colisão do jogador em todas as escadas
- [ ] Testar oclusão de câmera em pilares e paredes

### Fase 2 — Props Core (Semana 2)
- [ ] Estante de livros com instancing (Biblioteca)
- [ ] Sistema de quadros procedurais (Galeria) — 24 variações
- [ ] Pilares do Ballroom (6 unidades)
- [ ] Sofás e mesas (Ballroom + Biblioteca)
- [ ] Banheiras e azulejos (Banheiros)
- [ ] Barris e caixas (Porão)

### Fase 3 — Colorables e Padrões (Semana 3)
- [ ] Registrar todos os colorables em `this.colorables`
- [ ] Implementar padrão procedural: listras (Corredor)
- [ ] Implementar padrão procedural: hexágonos (Banheiros)
- [ ] Implementar padrão procedural: lombadas (Biblioteca)
- [ ] Implementar padrão procedural: telas de quadro (Galeria)
- [ ] Testar amostragem em todos os 18 hero spots

### Fase 4 — Iluminação e Atmosfera (Semana 4)
- [ ] Configurar PointLights por zona (máx 8 simultâneas)
- [ ] Ajustar sombras (desktop) / fake shadows (mobile)
- [ ] Testar interação com lanterna do Caçador
- [ ] Ajustar `MeshToonMaterial.gradientMap` para cada zona

### Fase 5 — Waypoints e IA (Semana 4-5)
- [ ] Criar rede de waypoints (30+ nós)
- [ ] Definir conexões e pesos
- [ ] Testar patrulha do Seeker por 10 minutos
- [ ] Ajustar probabilidades de visita por zona
- [ ] Testar passagens secretas com Seeker (não deve atravessar)

### Fase 6 — Polimento e Testes (Semana 5-6)
- [ ] Testar todos os 18 hero spots com diferentes poses
- [ ] Testar performance em dispositivo mobile (target 60 FPS)
- [ ] Testar modo Online (sincronização de props/colorables)
- [ ] Testar Pincel Livre em superfícies animadas/estáticas
- [ ] Ajustar LOD e distâncias de culling
- [ ] Documentar spots no README do mapa

---

## 14. Métricas de Sucesso

| Métrica | Target | Como Medir |
|---------|--------|------------|
| FPS mínimo mobile | 55 FPS | Chrome DevTools, Moto G Power equivalente |
| FPS médio desktop | 120+ FPS | Monitoramento durante partida de 5 min |
| Tempo de carga do mapa | < 2s após preloader | Cronometrar `_buildChameleonManor()` |
| Hero spots funcionais | 18/18 | Checklist manual de testes |
| Win rate hiders (solo) | 45-55% | Analytics de 20+ partidas |
| Seeker não trava em | 100% | Observar patrulha por 10 min |

---

## 15. Notas para o Artista/Direção de Arte

- **Estilo Toon:** Evitar gradientes suaves. Cada superfície deve ter **no máximo** 3 tons visíveis (claro, médio, sombra). O `gradientMap` de 4 pixels é suficiente.
- **Legibilidade:** O mapa deve ser "legível" à primeira vista — um jogador novo deve entender imediatamente onde estão as zonas (Ballroom = aberto/lustre, Biblioteca = livros, Porão = industrial).
- **Paleta Pop:** Não tenha medo de cores saturadas. O jogo é um party game — o visual deve ser atraente em screenshots e clips.
- **Props como "linguagem visual":** Pilares = "fique de pé aqui", Livros = "agache aqui", Quadros = "fique flat aqui", Caixas = "agache aqui". O ambiente ensina o jogador a jogar.

---

*Documento gerado para o projeto Esconde ou Morre — adaptação da especificação "Mansion Plus / Grand Estate" para arquitetura Three.js procedural.*
