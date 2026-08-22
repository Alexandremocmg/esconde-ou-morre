# Acesso ao Tripo3D (geração de assets 3D por IA)

Este projeto tem acesso configurado e validado ao [Tripo3D](https://www.tripo3d.ai/) —
serviço pago de geração de assets 3D por IA (texto/imagem → malha → textura → rig →
animação). Não está em uso no jogo hoje (o personagem segue 100% o pipeline
Mixamo → Blender → GLB de `docs/PIPELINE_PERSONAGEM.md`, e o resto do visual é
procedural), mas fica disponível para prototipagem de props/cenário sob demanda.

Capacidades completas, endpoints, parâmetros e comandos: skill global
`tripo-3d` (`~/.claude/skills/tripo-3d/`), carregada automaticamente sempre que o
assunto for Tripo/geração 3D.

## O que está configurado

- `TRIPO_API_KEY` no `.env` da raiz do projeto (não versionado — cada máquina/ambiente
  precisa da própria key, obtida em https://developers.tripo3d.ai).
- `tripo-cli` instalado globalmente (`npm install -g tripo-cli`, requer Node 20+).
- Validado com `tripo doctor` em 2026-08-22: API alcançável, key ok, saldo de 235
  créditos (~US$ 2,35) na época da checagem — **confira o saldo atual antes de assumir
  que ainda há crédito** (`tripo balance`).

## Como rodar um comando

O ambiente do agente não mantém variáveis de shell entre chamadas, então carregue a key
do `.env` a cada comando:

```bash
export TRIPO_API_KEY=$(grep TRIPO_API_KEY .env | cut -d= -f2 | tr -d '\r') && tripo balance
```

Troque `tripo balance` pelo comando desejado (`tripo make "..."`, `tripo view @last`,
etc. — lista completa na skill `tripo-3d`).

## Regra de custo

É API paga por crédito. Antes de gerar qualquer asset, o agente deve informar o custo
estimado e esperar autorização — não gastar créditos "no escuro".

## Relação com o pipeline de personagem existente

`docs/PIPELINE_PERSONAGEM.md` já resolveu o personagem principal via Mixamo (mocap
real, pré-visualizável antes de gastar) e documenta por que animação
gerada/retargetada por IA tende a sair deformada quando o rig não bate com a fonte. O
Tripo não substitui essa decisão — ele é uma opção a mais para malhas estáticas novas
(props, cenário, variações de personagem) que depois podem seguir o mesmo pipeline de
Mixamo se precisarem de animação de produção.
