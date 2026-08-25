# Esconde ou Morre — guia de operação para o Claude Code

> Visão completa do jogo, como rodar, e mapa de arquivos: [`README.md`](README.md).
> Este arquivo é só o "como trabalhar neste repo" — não duplica o README.

Protótipo Three.js (ES Modules puros, sem bundler) com 3 modos (Camaleão, Caçador,
Online) e um servidor Node autoritativo em `server/`. Sem passo de build — servido
direto via `dev_server.py`.

## Antes de começar (Query)

1. Leia [`docs/_index.md`](docs/_index.md) — 1 linha por doc em `docs/`, pra saber
   onde procurar antes de ler tudo.
2. Leia as últimas ~10 entradas de [`docs/_log.md`](docs/_log.md) — histórico
   cronológico de trabalho significativo feito em qualquer sessão.
3. **Rode `git fetch` e compare com `origin/main` antes de assumir que sabe o
   estado atual do repo.** Este projeto já foi trabalhado por mais de uma sessão
   do Claude Code em paralelo (mesmo usuário, janelas diferentes) sem que uma
   soubesse da outra — só foi descoberto porque o usuário pediu explicitamente
   pra sincronizar e avaliar. Não repita esse erro: cheque antes de presumir.

## Ao terminar trabalho significativo (Ingest)

1. Acrescente uma entrada em `docs/_log.md` (data, resumo de 1-2 linhas,
   arquivos/commits principais). **Nunca reescreva ou apague entradas antigas**
   — é um log, não um resumo vivo.
2. Se o trabalho muda comportamento que algum `docs/*.md` descreve, atualize o
   doc — E procure por comentários espelhados desatualizados no código (`grep`
   pelo texto antigo em `src/`). Isto já causou um bug real nesta sessão: um doc
   foi atualizado, um comentário em `Game.js` dizendo a mesma coisa (desatualizada)
   ficou pra trás.
3. Se um doc classificado como 📦 histórico em `docs/_index.md` voltou a ser
   mantido ativamente (ou vice-versa), atualize a classificação lá.

## Lint (sob pedido, ou periodicamente)

Ao ser pedido pra "avaliar mudanças" ou fazer um "health check":
- `grep` por marcadores de status parado no código e nos docs: `🔲`, "fora de
  escopo", "fase 1", "sem IA", "parado", "MVP simplificado" — confira se ainda
  batem com o estado real do código.
- Confirme que todo link em `docs/_index.md` aponta pra um arquivo que ainda existe.
- Rode `git log origin/main..HEAD` e `git log HEAD..origin/main` — divergência
  em qualquer direção é sinal de trabalho não sincronizado entre sessões.

## Convenções deste projeto

- **Cache-busting (`?v=N`)**: todo módulo importado usa
  `import ... from './Arquivo.js?v=N'`. Ao editar um arquivo, faça bump de `N`
  em **TODOS** os import sites (grep por `NomeDoArquivo.js?v=` no repo inteiro)
  — o `dev_server.py` não cacheia, mas produção sim.
- **Testar antes de reportar concluído**: mudança visual ou de gameplay precisa
  ser confirmada no Browser pane (`preview_start` + navegação real) antes de
  dizer que está pronta — não basta o código "parecer certo".
- **Commits**: em português, prefixo `feat:`/`fix:`/`docs:`, corpo explicando o
  *porquê* (não o *o quê* — o diff já mostra isso), terminando com
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Veja `git log` pro
  tom exato.
- **Duplicar em vez de extrair, quando a alternativa validada já funciona em
  produção**: ver `ChameleonTarget.js` vs `Seeker.js` (Plano 3, `docs/_log.md`)
  — copiar ~150 linhas de locomoção testada foi decisão consciente pra não
  arriscar regressão numa IA já validada, por um ganho de DRY pequeno. Nem
  sempre é a resposta certa, mas é um padrão já aceito neste repo — não
  estranhe se vir de novo.

## Ponteiros

- [`docs/_index.md`](docs/_index.md) — índice de toda a documentação em `docs/`.
- [`docs/_log.md`](docs/_log.md) — log cronológico de trabalho entre sessões.
- [`README.md`](README.md) — visão geral do jogo, como rodar, mapa de arquivos.
