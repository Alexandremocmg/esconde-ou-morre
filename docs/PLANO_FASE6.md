# Fase 6 — Polimento Final & Tela Inicial (fecha o MVP)

Status: **implementado**, pronto para o teste definitivo em `localhost:8000`.

Arquitetura mantida em **ES Modules** puros, sem bundler nem passo de build.

## 1. Menu inicial (`index.html` + `css/style.css`)
O overlay de início virou um **menu principal** com:
- Título **Esconde ou Morre** e subtítulo.
- Cartão **Como jogar** (🕹️ mover · 🧱 grudar · 🎨 camuflar · 👁️ objetivo).
- Botão **JOGAR**.
- Aviso de tela cheia/horizontal e de ativar o som.

### Init limpa no clique (`src/main.js`)
No clique de **JOGAR**, `boot()` roda **antes** do `await enterImmersive()`.
Assim o jogo e o `AudioContext` (`Game.start → audio.resume()`) são iniciados
**dentro do gesto do usuário**, respeitando a política de autoplay dos
navegadores. Fullscreen e lock de orientação vêm depois e podem falhar (desktop)
sem quebrar o jogo.

## 2. Estética / profundidade 3D (`src/Game.js` → `_addLights`)
- Hemisfério e ambiente **reduzidos** para o Sol dominar e revelar o volume.
- **Sol** mais forte (1,5) com **sombras 2048²** e borda suave (`shadow.radius = 3`).
- Nova **luz de contorno (rim)** fria do lado oposto, sem sombra: separa os
  blocos do fundo escuro e dá sensação de profundidade.

## 3. Brilho pulsante ao camuflar (`src/Player.js`)
Quando o jogador está **totalmente camuflado** (histerese confirmada), o material
emite na **própria cor do disfarce** com intensidade pulsante
(`0.16 + 0.12 · sin(t·6)`) — "reluz" sem alterar o tom, reforçando o sucesso da
camuflagem. Fora da camuflagem, `emissiveIntensity = 0`.

## 4. Prontidão para build estática
- Projeto é **estático puro**: servir a pasta por HTTP já roda (ver `README.md`).
- **Sem assets locais** — visual e áudio 100% procedurais (`assets/` vazia).
- Única dependência externa: `three@0.161.0` via CDN no `importmap`.
- Publicável em qualquer host estático (GitHub Pages, Netlify, Vercel, S3…).
- `README.md` criado com execução, deploy, estrutura e como jogar.

## Checklist do MVP (Fases 3–6)
- [x] Core loop: grudar, escalar, camuflar (histerese), câmera, joystick.
- [x] IA do Caçador: patrulha, visão com oclusão, memória de última posição, desvio.
- [x] Condição de vitória por sobrevivência + estágios + placar (tempo/camuflagem).
- [x] Juice: pulsos, cone piscando, 2º Caçador, vinheta + áudio de tensão.
- [x] Menu inicial, polimento de luz/sombra, brilho de camuflagem, docs + README.

## Ajuste rápido
- `Game.js`: intensidades de luz, `shadow.mapSize`, `shadow.radius`.
- `Player.js`: intensidade/velocidade do pulso de brilho.
- `index.html`/`style.css`: textos e visual do menu.

## Ideias pós-MVP (backlog)
- Recorde persistente (`localStorage`): melhor % camuflado / estágio máximo.
- Variações de layout do `Level` por estágio.
- Three.js hospedado localmente para deploy offline.
- Partículas (points) no lugar dos anéis para mais densidade visual.
