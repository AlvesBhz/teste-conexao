# Quartely — app independente

Dashboard de barras (trimestre → semestre → ano) com filtros, deltas e múltiplos gráficos.
Conexão **direta ao Azure SQL de produção** (`rdb-ibp-bmsa-prd` / `BDIBPBMSA_PRD`), sem depender do app VBM Kaizen.

| Arquivo | Função |
|---|---|
| `quartely.html` | Página (HTML/CSS/JS em um arquivo) |
| `portal.js` | **Modo Portal** (em uso): monta rotas, conexão própria ao PRD e bloqueio de arquivos dentro do app Portal |
| `server.js` | Modo standalone (app próprio, opcional): Express + pool `mssql`; serve só a página e `assets/` |
| `quartely-api.js` | Rotas `/chart-data`, `/sites`, `/ping` e a SQL (mesma do VBM Kaizen) |
| `app.yaml` | Configuração do Databricks App (PRD; credenciais via secret) |
| `assets/images/vale-logo.svg` | Logo |

## No Portal (em uso)
O `server.js` do Portal carrega o Quartely com **uma linha**, antes do gate de páginas e do `express.static`:
```js
require("./Quartely/portal")(app);
```
Banco padrão: `rdb-ibp-bmsa-prd` / `BDIBPBMSA_PRD`, com o usuário/senha do Portal. Opcionais: `QUARTELY_SQL_SERVER`, `QUARTELY_SQL_DATABASE`, `QUARTELY_SQL_PORT`, `QUARTELY_SQL_USER`, `QUARTELY_SQL_PASSWORD`.
Rotas: `/Quartely/quartely.html`, `/Quartely/api/chart-data`, `/Quartely/api/sites`, `/Quartely/api/ping`, `/Quartely/api/health`.

## Rotas (modo standalone)
- `GET /` — página
- `GET /api/chart-data`, `GET /api/sites` — dados (cache de 5 min); também em `/Quartely/api/*`
- `GET /api/health` — testa o banco (`200` conectado / `503` com o motivo)
- `GET /api/ping` — diagnóstico sem tocar no banco

## Rodar localmente
```bash
cp .env.example .env   # preencha AZURE_SQL_USER / AZURE_SQL_PASSWORD
npm install
npm run start:local    # http://localhost:8000
```
O banco PRD só aceita conexões da rede Vale / do workspace Databricks (private link).
Sem acesso, a página abre com o aviso de "dados de exemplo".
