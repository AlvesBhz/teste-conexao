# Deploy — Quartely (Databricks App próprio)

## 1. Pré-requisitos (uma vez)
1. Usuário SQL com **SELECT** em `IBP.PEDRAVISAOCONSOLIDADA`, `IBP.DASHBOARD`, `IBP.CONTROLE_PROCESSOS` e `IBP.SITES` no `BDIBPBMSA_PRD`.
2. Criar o app: **Compute › Apps › Create app › Custom** (ex.: `quartely`).
3. Em **Edit › App resources › + Add resource › Secret**, criar e **confirmar** antes do deploy:
   - `azure-sql-user` → usuário SQL
   - `azure-sql-password` → senha
   (nomes exatamente iguais aos `valueFrom` do `app.yaml`)

## 2. Publicar
Envie **somente a pasta `Quartely/`** (sem `node_modules` e sem `.env`) como código-fonte do app:
```bash
databricks sync ./Quartely /Workspace/Users/<seu-email>/quartely
databricks apps deploy quartely --source-code-path /Workspace/Users/<seu-email>/quartely
```
O runtime executa `npm install` e `npm start` (definido no `app.yaml`).

## 3. Validar após o deploy
1. `https://<url-do-app>/api/ping` → `{"ok":true}`
2. `https://<url-do-app>/api/health` → `{"status":"healthy","database":"BDIBPBMSA_PRD"}`
   - `503 ... Variáveis de ambiente ausentes` → secrets não criados/vinculados
   - `503 ... Login failed` → usuário/senha
   - `503 ... Failed to connect` → rede/firewall entre o app e o Azure SQL
3. Abrir `https://<url-do-app>/` → **sem** o aviso "Exibindo DADOS DE EXEMPLO".

## Rollback
O app é independente: parar/reverter o deploy do Quartely não afeta o VBM Kaizen.
