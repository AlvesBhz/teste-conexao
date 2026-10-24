# Estrutura, segurança e conexão com o banco

Referência: `COO - Dashboard/` no commit `44fdbd6` (copie os arquivos e troque nomes/prefixos):
`git archive 44fdbd6 "COO - Dashboard" | tar -x -C <destino>`.

## Árvore de um app

```
<Nome do App>/
├── index.html              a página (única rota pública)
├── <app>-api.js            express.Router com as rotas de dados (usado pelos dois modos)
├── portal.js               modo Portal: pool PRD próprio + rotas + bloqueio de arquivos
├── server.js               modo standalone: helmet, compression, pool, acesso, shutdown
├── acesso.js               IBP.USERS + CD_MATRICULA (só standalone; no Portal vale o portal-acesso.js)
├── app.yaml                Databricks App — segredos por valueFrom
├── package.json            express ^5, helmet ^8, compression, mssql ^11; scripts start, start:local, test, verifica-segredos
├── .env.example  .gitignore
├── database/*.sql          scripts do time de dados (fonte única da SQL)
├── docs/ESTRUTURA.md  docs/DEPLOYMENT.md
└── tests/  regressao.sh  teste-api.js  teste-portal.js  fake-mssql.js  preload.js  env-exemplo.sh  verifica-segredos.sh
```

Pasta pode ter espaços ("COO - Dashboard"); a **rota pública não** (`/COO-Dashboard`).

## O que é comum e o que é de cada dashboard

| Comum a todos (copiar da referência) | Próprio de cada dashboard |
|---|---|
| `server.js`, `portal.js`, `acesso.js`, pool, cabeçalhos, 404 dos arquivos | `database/*.sql` entregues pelo time de dados |
| `app.yaml` (estrutura), `.env.example`, `.gitignore`, scripts de teste | No `<app>-api.js`: leitura das colunas e códigos do script (ex.: `ORDEM_GRAFICO`, `Type`), filtros por site/período e formato da resposta |
| Rotas `/ping`, `/health`, validação de parâmetros, cache de 5 min | Indicadores, cards e ligação card ↔ KPI na página |
| Dublê (`fake-mssql.js`) — mecanismo | Dublê — linhas de exemplo no formato da saída do script daquele app |

## Dois pontos de entrada, uma SQL por app

- `<app>-api.js` exporta `criar<App>Router({ runQuery, ... })`. `runQuery` é injetado
  porque cada entrada tem seu pool. Contrato: devolve `.recordset`; `params` é
  `{ nome: [tipoMssql, valor] }`.
- `GET /ping` não toca no banco (separa "não publicado" de "banco falha").
- `GET /health` faz `SELECT 1` e devolve `{status, database, server}` — nunca usuário/senha.
- Cache de 5 min por chave dentro do router (uma ida ao banco atende todos).
- Validação de query string com inteiros em faixa (`site`, `ano` 2000–2100, `mes` 1–12):
  inválido ⇒ 400 antes de qualquer consulta.
- A página tenta `['api/', '../api/', '/<Rota>/api/', '/api/']` e guarda a primeira base
  que responder (funciona no Portal e standalone sem configuração).

## Pool (server.js e portal.js)

```js
new sql.ConnectionPool({ server, database, user, password, port,
  options: { encrypt: true, trustServerCertificate: false },
  connectionTimeout: 30000, requestTimeout: 60000,
  pool: { max: 5 /* 3 no portal.js */, min: 0, idleTimeoutMillis: 30000 } })
```
- Criado na 1ª consulta; `pool.on('error')` zera o pool; promise quebrada não fica em cache.
- Falha de conexão memorizada por 30 s (`ultimaFalha`), para as rotas não esperarem o timeout de novo.
- `configAusente()` lista as variáveis que faltam (padrão `checkConfig()` do Kaizen); o servidor
  sobe mesmo sem banco e a página mostra os dados de exemplo.
- Aviso no log se a base não terminar em `_PRD`. Pool fechado em `SIGTERM`/`SIGINT`.
- No `portal.js`: `<APP>_SQL_SERVER/_AZURE_SQL_DATABASE/_SQL_PORT/_SQL_USER/_SQL_PASSWORD`
  opcionais; padrão = servidor/base PRD e o usuário/senha do Portal.
- Erro de SQL: o texto da consulta vai para o **log**, nunca para a resposta HTTP.

## Controle de acesso

- Identidade: `req.get('X-Forwarded-Email')` (injetado pelo proxy do Databricks Apps).
- Regra: linha em `IBP.USERS` com `CD_MATRICULA` não vazio. Coluna de e-mail descoberta em
  `INFORMATION_SCHEMA.COLUMNS` (preferência `CD_EMAIL`, `DS_EMAIL`, …) ou fixada por variável.
- Consulta sem função na coluna (`WHERE [col] = @email`) para usar índice; collation é case-insensitive.
- Cache só do autorizado (10 min). Negativa e erro nunca entram no cache; erro ⇒ 503 e bloqueia.
- API negada ⇒ JSON 403/503; página negada ⇒ tela simples de "Acesso não autorizado".
- `/health` e `/ping` ficam fora do controle (diagnóstico do deploy; não expõem dados).
- Local: `<APP>_ACESSO_LOCAL_EMAIL` simula o cabeçalho; `<APP>_ACESSO=desligado` só em dev (loga aviso).
- No Portal: `portal.use("/<Rota>", aguardarAcesso("exigir"))` antes de montar o `portal.js`.

## Cabeçalhos e arquivos

```js
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginOpenerPolicy: false }));
app.use(compression());
```
CSP/COEP/COOP desligados porque as páginas têm `<script>/<style>` inline sem nonce
(mesma decisão do Kaizen). API com `Cache-Control: no-store`. Página com `no-store`.
Só `index.html` via `sendFile`; nenhum `express.static` na pasta do app; 404 JSON no resto.

## app.yaml

```yaml
command: [npm, start]
env:
  - name: 'AZURE_SQL_SERVER'    value: 'rdb-ibp-bmsa-prd.database.windows.net'
  - name: 'AZURE_SQL_DATABASE'  value: 'BDIBPBMSA_PRD'
  - name: 'AZURE_SQL_PORT'      value: '1433'
  - name: '<APP>_ID_DASH'       value: '<n>'
  - name: 'AZURE_SQL_USER'      valueFrom: 'azure-sql-user'
  - name: 'AZURE_SQL_PASSWORD'  valueFrom: 'azure-sql-password'
```
Resources `azure-sql-user`/`azure-sql-password` criados e confirmados **antes** do deploy.

## Testes (padrão Kaizen)

- `fake-mssql.js`: dublê que reconhece consultas pelo texto e **falha** se aparecer valor da
  requisição literal na SQL ou filtro de dashboard fixo (ex.: `DASH.ID_DASH = 15`).
- `preload.js`: troca `mssql` pelo dublê (`node -r ./tests/preload.js server.js`).
- `teste-api.js` (standalone): ping/health; 403 sem cabeçalho, sem cadastro e sem matrícula;
  página negada e liberada; dados por rota; 400 em parâmetros inválidos e tentativa de injeção;
  404 para cada arquivo interno (código, `.sql`, `app.yaml`, `.env`, testes, `../`);
  nosniff, frame-options, sem X-Powered-By.
- `teste-portal.js`: monta `portal.js` num Express e confere rota, redirect da barra final,
  health, dados e 404 dos arquivos internos.
- `verifica-segredos.sh`: valueFrom no app.yaml, padrões de credencial, `.env` no `.gitignore`.
- `regressao.sh` roda tudo; `env-exemplo.sh` só com valores fictícios.

## Deploy

- Portal: copiar a pasta, incluir as duas linhas no `server.js` do Portal, deploy, validar
  `/<Rota>/api/ping`, `/api/health`, dados e 404 dos arquivos internos.
- Standalone: app Custom, secrets antes, `databricks sync` + `databricks apps deploy` só da pasta.
- Permissão SQL: SELECT nas tabelas dos scripts + `IBP.SITES`, `IBP.DASHBOARD`,
  `IBP.CONTROLE_PROCESSOS` (+ `IBP.USERS` no standalone) e leitura de `INFORMATION_SCHEMA.COLUMNS`.
