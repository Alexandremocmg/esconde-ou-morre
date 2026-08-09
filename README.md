# Esconde ou Morre

Protótipo mobile-first em **Three.js** (ES Modules puros, sem bundler). Você é uma
cápsula que **gruda em paredes**, **copia a cor das superfícies para se camuflar**
e precisa **sobreviver ao(s) Caçador(es)** até o tempo acabar.

## Como rodar (build estática)

Não há passo de build. Basta servir a pasta por HTTP (ES Modules exigem
`http://`, não abre via `file://`):

```bash
# qualquer um destes, na raiz do projeto:
python -m http.server 8000
# ou
npx serve .
```

Abra `http://localhost:8000` e clique em **JOGAR**.

> Única dependência externa: `three@0.161.0` via CDN (unpkg), declarada no
> `importmap` do `index.html`. Requer conexão. Para deploy 100% offline, baixe o
> `three.module.js` para `assets/` e ajuste o `importmap`.

## Deploy

Qualquer host de arquivos estáticos serve a pasta como está (GitHub Pages,
Netlify, Vercel, S3, etc.) — publique a raiz do repositório.

## Estrutura

```
index.html        # HUD, overlays (menu/vitória/game over), importmap, vinheta
css/style.css     # HUD, joystick, overlays, vinheta e menu
src/
  main.js         # boot: gesto do usuário → áudio + loop + fullscreen
  Game.js         # orquestra cena, partida, caçadores, efeitos, áudio, feedback
  Level.js        # sala de teste (paredes/blocos coloridos, colisão)
  Player.js       # cápsula: chão/parede, camuflagem com histerese, brilho
  Seeker.js       # IA do Caçador: patrulha/caça, visão, desvio, rotas alternadas
  Effects.js      # pulsos visuais (juice) ao camuflar/grudar
  Audio.js        # áudio procedural (Web Audio API)
  FollowCamera.js # câmera de perseguição
  Joystick.js     # joystick virtual (touch)
docs/             # planos de cada fase (PLANO_FASE3..6)
```

## Como jogar

- **Mover:** joystick na metade esquerda da tela.
- **Grudar/escalar:** vá de encontro a uma parede.
- **Camuflar:** grudado, toque numa superfície para copiar a cor. Camuflado, o
  Caçador não te captura.
- **Objetivo:** sobreviva até o cronômetro chegar à meta. A cada estágio a meta
  cresce e o Caçador acelera; no **Estágio 3** entra um **segundo Caçador**.

Progresso de estágio persiste em `sessionStorage['eom-stage']`.
