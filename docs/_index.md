# Índice da documentação (`docs/`)

Ponto de partida pra não precisar ler os 19 arquivos de `docs/` um por um.
Instruções de uso deste índice: [`../CLAUDE.md`](../CLAUDE.md).

- 🟢 **vivo** — descreve comportamento atual do jogo, mantido em sync ativo
  com o código (ou deveria estar — se achar divergência, é achado de lint,
  não "está errado o índice").
- 📦 **histórico** — registro de uma fase de desenvolvimento já concluída e
  absorvida no código. Ainda útil como contexto/arqueologia, mas não
  necessariamente atualizado depois que a fase fechou.

Esta classificação é um ponto de partida, não uma auditoria linha-a-linha —
se um doc mudou de categoria, atualize aqui (ver `CLAUDE.md` § Ingest).

| Doc | Status | Resumo |
| --- | --- | --- |
| [`MECANICA_CACADOR.md`](MECANICA_CACADOR.md) | 🟢 | Especificação técnica do modo Caçador: munição, condições de vitória/derrota, HUD, sorteio de papel no lobby. |
| [`MECANICA_CACADOR_VISAO.md`](MECANICA_CACADOR_VISAO.md) | 🟢 | Design de câmera/FOV, arma de água e Scanner do Caçador (status ✅/🔲 por item); §3 cobre a IA dos alvos-camaleão. |
| [`PLANO_MANSAO.md`](PLANO_MANSAO.md) | 🟢 | Arquitetura dos mapas (mansão de 3 alas + Fábrica Abandonada): andares, escadas, colisão, mezanino/passarela. |
| [`PLANO_MULTIPLAYER.md`](PLANO_MULTIPLAYER.md) | 🟢 | Especificação do modo Online: servidor autoritativo, protocolo, rotação de mapa por relógio. |
| [`PLANO_CONTAS.md`](PLANO_CONTAS.md) | 🟢 | Contas de jogador via Supabase (Ranking, Missões, Personalização): schema e limitações. |
| [`PAINEL_AJUSTE.md`](PAINEL_AJUSTE.md) | 🟢 | Painel de dev (`?tune=1`) pra calibrar parâmetros de movimento ao vivo. |
| [`PLANO_LOBBY_MULTIPLAYER.md`](PLANO_LOBBY_MULTIPLAYER.md) | 🟢 | Evolução da sala fixa de 2 pra 1 Caçador + até 4 Camaleões. |
| [`PLANO_LOBBY_COUNTDOWN.md`](PLANO_LOBBY_COUNTDOWN.md) | 🟢 | Contagem regressiva de lobby antes da partida ativar (segue o doc acima). |
| [`PIPELINE_PERSONAGEM.md`](PIPELINE_PERSONAGEM.md) | 🟢 | Pipeline Mixamo → Blender → GLB único do personagem; UV por região; armadilhas de constantes duplicadas. |
| [`TRIPO_3D.md`](TRIPO_3D.md) | 🟢 | Acesso configurado ao Tripo3D pra gerar assets 3D por IA sob demanda (não usado no personagem principal). |
| [`PLANO_TOON.md`](PLANO_TOON.md) | 🟢 | Direção de arte toon/cel-shaded; histórico de fases com status de implementação por item. |
| [`PLANO_FASE3.md`](PLANO_FASE3.md) | 📦 | Balanceamento do Caçador-IA (Seeker): memória de última posição vista, feedback do cone de visão. |
| [`PLANO_FASE4.md`](PLANO_FASE4.md) | 📦 | Loop de partida e condição de vitória por sobrevivência; HUD de placar. |
| [`PLANO_FASE5.md`](PLANO_FASE5.md) | 📦 | Polimento visual (`Effects.js`/`Audio.js`) e suporte a múltiplos Caçadores. |
| [`PLANO_FASE6.md`](PLANO_FASE6.md) | 📦 | Polimento final e menu inicial; fecha o MVP original. |
| [`PLANO_VERTICAL_SLICE.md`](PLANO_VERTICAL_SLICE.md) | 📦 | Consolidação do MVP: layouts variáveis por estágio + refinamento procedural. |
| [`PLANO_MANEQUIM.md`](PLANO_MANEQUIM.md) | 📦 | 4º modelo de personagem "Manequim" articulado (paridade visual com Meccha Chameleon). |
| [`PLANO_REALISMO.md`](PLANO_REALISMO.md) | 📦 | Texturas/materiais procedurais mais realistas; paleta de cores de material real. |
| [`PLANO_PARIDADE.md`](PLANO_PARIDADE.md) | 📦 | Paridade 1:1 com Meccha Chameleon: pintura por zonas, textura de parede, poses + ocultar olhos (Fase 9+). |
