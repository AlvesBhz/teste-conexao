# Checklist antes de entregar ou publicar

## Escopo
- [ ] Só a pasta do app foi alterada (nenhum outro projeto sem pedido explícito).
- [ ] Integração com o Portal entregue como linhas a incluir, documentadas no `docs/DEPLOYMENT.md`.

## Banco e dados
- [ ] Toda consulta por `runQuery` com parâmetros; nenhum valor da requisição concatenado.
- [ ] SQL de negócio em `database/*.sql` (do time de dados); filtros fixos trocados por parâmetro.
- [ ] Parâmetros de query string validados (400 antes do banco).
- [ ] `/ping` sem banco; `/health` sem expor credenciais.
- [ ] Página com dados de exemplo e selo "dados de exemplo"/"dados parciais" quando a API falha.

## Segurança
- [ ] `app.yaml`: usuário e senha só por `valueFrom`; resources criados antes do deploy.
- [ ] `.env` no `.gitignore`; `.env.example` sem valores.
- [ ] Acesso deny by default (X-Forwarded-Email + IBP.USERS + CD_MATRICULA); só autorizado em cache.
- [ ] Só `index.html` público; código, `.sql`, `app.yaml`, `.env`, docs e testes ⇒ 404.
- [ ] helmet ligado (CSP/COEP/COOP off documentado), sem X-Powered-By, API `no-store`.

## Testes
- [ ] `npm test` — regressão (dublê do mssql) em OK nos modos standalone e Portal.
- [ ] `npm run verifica-segredos` em OK.
- [ ] Página conferida no navegador em 1920×1188 (tela cheia), 1912×1028, 1440×860 e tema escuro,
      sem rolagem, sem sobreposição e sem erros no console.

## Identidade
- [ ] Poppins, tokens de cor e tema escuro conforme `identidade-visual.md`.
- [ ] Cabeçalho, filtros, painéis e gráficos no padrão (delta simples, polaridade de custo).

## Documentação
- [ ] `README.md`, `docs/ESTRUTURA.md` e `docs/DEPLOYMENT.md` atualizados.
