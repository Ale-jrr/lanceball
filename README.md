# LANCEBALL

Jogo web de leilão de jogadores e campeonato fut7. Monte uma equipe de sete atletas, escolha a tática e acompanhe partidas simuladas em uma Champions League adaptada para 4, 6 ou 8 equipes.

## Rodar localmente

Requer Node.js 26 com SQLite integrado. O projeto roda sem instalar dependências.

    node demo.mjs

Abra http://127.0.0.1:4173. O servidor cria o banco local do catálogo na primeira execução. As salas ficam em memória enquanto o servidor está ativo. Para configurar o endereço e a porta, use as variáveis de ambiente AUCTION_DEMO_HOST e AUCTION_DEMO_PORT.

## Testes

    node --test

## Créditos

O catálogo usa uma seleção dos dados de [FC 26 Player Data, de Rovnez](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data), publicado sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). As posições foram agrupadas para o fut7 e as notas foram preservadas. Cada fotografia de atleta exibe autoria, origem e licença na carta correspondente.
