---
name: vbm-ecossistema
description: Padrão de estrutura, segurança, conexão com o Azure SQL e identidade visual do ecossistema VBM (Portal Performance & Continuous Improvement, VBM Kaizen, VBM Performance Hub, Quartely, COO Dashboard e próximos). Use SEMPRE que for criar uma aplicação, dashboard ou tela nova do ecossistema VBM, migrar uma tela para uma pasta de aplicação, mexer em conexão com banco, controle de acesso, app.yaml/secrets do Databricks App, rotas de API, testes, ou no visual (cores, Poppins, cabeçalho, filtros, gráficos de barras Budget × Actual/Forecast, delta). Também quando o pedido citar "mesma estrutura do Kaizen", "padrão do Performance Hub", "identidade VBM" ou "como os outros projetos".
---

# Ecossistema VBM — estrutura e identidade

Todo app do ecossistema segue o mesmo molde. A **implementação de referência** é a pasta
`COO - Dashboard/` deste repositório: copie dela, não reinvente. Ela junta o desenho do
VBM Performance Hub (rotas num módulo, dois pontos de entrada) com as regras de
segurança do VBM Kaizen.

## Regras que nunca mudam

1. **Não mexer em outros projetos sem pedido explícito.** Um app novo vive na sua pasta.
   Para integrar ao Portal, entregue as linhas a incluir no `server.js` do Portal
   (documentadas no `docs/DEPLOYMENT.md` do app) em vez de editar o Portal.
2. **SQL sempre parametrizada.** `runQuery(sql, { nome: [tipoMssql, valor] })`; nenhum
   valor vindo da requisição é concatenado. Identificadores (nome de tabela/coluna)
   só entram depois de validados com `^[A-Za-z_][A-Za-z0-9_]{0,127}$`.
3. **Cada dashboard tem as suas consultas.** A infraestrutura é comum (servidor, pool,
   acesso, segurança, testes); a SQL não. Os scripts do time de dados daquele dashboard
   ficam em `database/*.sql` do próprio app, como foram entregues — nunca copie a SQL de
   outro dashboard. O código só troca filtros fixos (ex.: `DASH.ID_DASH = 15` → `@ID_DASH`)
   e falha ao subir se a troca não acontecer. A tradução da saída do script para os cards
   (ex.: `ORDEM_GRAFICO` → mês/trimestre/ano × Budget/Actual no COO) fica no `<app>-api.js`
   do app e é reescrita para cada script.
4. **Segredos só por `valueFrom`** no `app.yaml` (App resources do Databricks), criados
   **antes** do deploy. `.env` nunca vai para o git; `.env.example` sem valores.
5. **Acesso: deny by default.** Identidade só pelo `X-Forwarded-Email` do proxy do
   Databricks Apps; usuário em `IBP.USERS` com `CD_MATRICULA` preenchido. Sem cabeçalho,
   sem cadastro, sem matrícula ou erro de banco ⇒ negado. Só o "autorizado" vai para cache.
6. **Só a página sai do servidor.** Sem `express.static` na pasta do app; código, `.sql`,
   `app.yaml`, `.env`, docs e testes respondem 404.
7. **Banco PRD, conexão direta.** `rdb-ibp-bmsa-prd.database.windows.net` /
   `BDIBPBMSA_PRD`, `encrypt: true`, pool próprio por app, falha memorizada por 30 s.
8. **A tela nunca mente sobre a origem dos números.** Sem API, usa dados de exemplo e
   mostra o selo "dados de exemplo" (ou "dados parciais").
9. **Testes antes de publicar:** `npm test` (dublê do `mssql`, nunca toca no banco) e
   `npm run verifica-segredos` precisam terminar em OK.

## Como criar um app novo

1. Copie a estrutura de `COO - Dashboard/` (ver `references/estrutura-e-seguranca.md`)
   para a pasta nova e troque o prefixo: rota pública sem espaços (`/Nome-Do-App`),
   variáveis com prefixo do app (`NOMEAPP_ID_DASH`, `NOMEAPP_SQL_*`).
2. Peça os scripts SQL daquele dashboard ao time de dados (não reaproveite os de outro app),
   coloque-os em `database/` e reescreva no `<app>-api.js` a leitura da saída deles
   (colunas, códigos de série, filtros por site/período).
3. Monte a página com a identidade de `references/identidade-visual.md`.
4. Ajuste o dublê (`tests/fake-mssql.js`) para reconhecer as consultas novas e rode
   `npm test`.
5. Escreva `README.md`, `docs/ESTRUTURA.md` e `docs/DEPLOYMENT.md` no mesmo formato.
6. Confira tudo com `references/checklist.md` antes de entregar.

## Ao alterar um app existente

- Leia o `docs/ESTRUTURA.md` do app primeiro; ele vence esta skill em convenções locais.
- Mudança visual: ajuste pontual, preservando o que já foi aprovado; teste nas larguras
  1920×1188 (tela cheia), 1912×1028, 1440×860 e no tema escuro.
- Mudança de dados/segurança: rode a regressão do app e acrescente o caso novo ao teste.

## Referências

- `references/estrutura-e-seguranca.md` — árvore de pastas, papéis dos arquivos, pool,
  acesso, cabeçalhos, app.yaml, testes e deploy, com trechos prontos.
- `references/identidade-visual.md` — tokens de cor (claro/escuro), tipografia Poppins,
  cabeçalho, filtros, painéis, gráficos de barras com delta, responsividade.
- `references/checklist.md` — verificação final antes de entregar ou publicar.
