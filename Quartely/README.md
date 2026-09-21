# Quarterly Dashboard

Dashboard interativo de gráficos de barras alimentado por banco de dados Databricks com filtros dinâmicos, tema escuro/claro e suporte multilíngue (PT-BR/EN).

## Estrutura de Pasta

```
Quartely/
├── server.js          # Backend Express com conexão Databricks
├── index.html         # Página principal com interface HTML
├── chart.js           # Lógica D3 de visualização e filtros
├── style.css          # Estilos com tokens do Design System
├── package.json       # Configuração NPM com dependências
├── .gitignore         # Arquivos a ignorar no Git
└── README.md          # Este arquivo
```

## Requisitos

- **Node.js**: >= 14.0.0
- **npm**: >= 6.0.0

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto `Quartely/` com as seguintes variáveis:

```env
# Databricks Configuration
DATABRICKS_HOST=seu-host-databricks.cloud.databricks.com
DATABRICKS_WAREHOUSE_ID=seu-warehouse-id
DATABRICKS_CLIENT_ID=seu-client-id
DATABRICKS_CLIENT_SECRET=seu-client-secret

# Servidor
DATABRICKS_APP_PORT=8000
```

## Instalação

1. **Navegue para o diretório do projeto:**
   ```bash
   cd Quartely
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

## Execução Local

```bash
npm start
```

O servidor iniciará em `http://localhost:8000`

Acesse:
- **Dashboard**: http://localhost:8000/
- **API de dados**: http://localhost:8000/api/chart-data
- **Health check**: http://localhost:8000/api/health

## Recursos

### Backend (server.js)
- ✅ Conexão OAuth com Databricks SQL
- ✅ Pooling de sessões para otimizar conexões
- ✅ Fila de execução serializada para queries
- ✅ Cache em memória com TTL de 5 minutos
- ✅ Compressão gzip automática
- ✅ Servir arquivos estáticos

### Frontend (index.html, chart.js, style.css)
- ✅ Visualização com D3.js v7
- ✅ Filtros interativos (Anos, Sites, Produtos, Visualizações, Horizontes)
- ✅ Tema escuro/claro com localStorage
- ✅ Idiomas: PT-BR e English
- ✅ Responsive design (desktop/tablet/mobile)
- ✅ Estados de carregamento, erro e vazio
- ✅ Design System tokens (cores, tipografia, espaçamento)

## Publicação

### Opção 1: Vercel
1. Faça push do código para GitHub
2. Conecte o repositório em https://vercel.com
3. Configure variáveis de ambiente em Settings → Environment Variables
4. Deploy automático

### Opção 2: Heroku
1. Crie uma aplicação Heroku
2. Configure as variáveis de ambiente:
   ```bash
   heroku config:set DATABRICKS_HOST=... --app seu-app
   heroku config:set DATABRICKS_WAREHOUSE_ID=... --app seu-app
   heroku config:set DATABRICKS_CLIENT_ID=... --app seu-app
   heroku config:set DATABRICKS_CLIENT_SECRET=... --app seu-app
   ```
3. Deploy via git:
   ```bash
   git push heroku main
   ```

### Opção 3: Docker

Crie um `Dockerfile` na pasta `Quartely/`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8000

CMD ["npm", "start"]
```

Build e execute:
```bash
docker build -t quarterly-dashboard .
docker run -p 8000:8000 \
  -e DATABRICKS_HOST=... \
  -e DATABRICKS_WAREHOUSE_ID=... \
  -e DATABRICKS_CLIENT_ID=... \
  -e DATABRICKS_CLIENT_SECRET=... \
  quarterly-dashboard
```

### Opção 4: Servidor Linux/Unix

1. Clone o repositório no servidor
2. Instale Node.js (>=14)
3. Execute:
   ```bash
   cd Quartely
   npm install
   npm start
   ```

4. Use um gerenciador de processo (pm2):
   ```bash
   npm install -g pm2
   pm2 start server.js --name "quarterly-dashboard"
   pm2 save
   pm2 startup
   ```

## Endpoints da API

### GET /api/chart-data
Retorna dados do gráfico em formato JSON

**Resposta:**
```json
[
  {
    "DT_REF": "2025-01-01",
    "ID_SISTEMA": 1,
    "ID_SITE": "SITE01",
    "ID_OPERACAO": "OP01",
    "ID_KPI": "KPI01",
    "NM_KPI": "KPI Name",
    "ID_ORDEM": 1,
    "ORDEM_GRAFICO": 0,
    "ID_TYPE": 0,
    "NM_TYPE": "Budget",
    "Type": "Jan B",
    "Value": 1000.50
  }
]
```

### GET /api/health
Status de saúde da aplicação

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2025-09-21T14:00:00.000Z"
}
```

## Performance

- Cache de 5 minutos reduz carga no banco de dados
- Compressão gzip para respostas mais rápidas
- Session pooling para otimizar handshakes OAuth
- D3.js otimizado para renderização responsiva

## Troubleshooting

### Erro: "Variáveis de ambiente ausentes"
- Verifique se todas as variáveis DATABRICKS_* estão definidas
- Teste com: `echo $DATABRICKS_HOST`

### Gráfico não carrega
1. Abra Developer Tools (F12)
2. Verifique aba Network para erros na requisição `/api/chart-data`
3. Verifique aba Console para erros JavaScript
4. Verifique logs do servidor

### Conexão Databricks recusada
- Verifique credenciais OAuth (Client ID e Secret)
- Confirme que o Warehouse ID está correto
- Teste a conexão com a CLI Databricks

## Licença

MIT

## Suporte

Para dúvidas ou problemas, abra uma issue no repositório ou consulte a documentação do Databricks SQL Connector.
