# Guia de Publicação - Quarterly Dashboard

## 📦 Estrutura Completa do Projeto

```
teste-conexao/
└── Quartely/                          # Projeto independente
    ├── server.js                      # Backend Express (8.0 KB)
    ├── index.html                     # Página HTML principal (6.9 KB)
    ├── chart.js                       # Lógica D3 + Filtros (12 KB)
    ├── style.css                      # Estilos completos (14 KB)
    ├── package.json                   # Dependências NPM
    ├── .gitignore                     # Ignore git
    ├── README.md                      # Instruções de uso
    └── DEPLOYMENT.md                  # Este arquivo
```

## 🚀 Checklist para Publicação

### Antes de Publicar

- [ ] Variáveis de ambiente configuradas (.env)
- [ ] Dependências instaladas (`npm install`)
- [ ] Testes locais bem-sucedidos (`npm start`)
- [ ] Credenciais Databricks verificadas
- [ ] Firewall permite porta 8000 (local) ou 443 (produção)

### Arquivo .env (NÃO FAZER COMMIT)

Crie na raiz de `Quartely/`:

```bash
# .env
DATABRICKS_HOST=seu-workspace.cloud.databricks.com
DATABRICKS_WAREHOUSE_ID=abc123def456
DATABRICKS_CLIENT_ID=seu-client-id
DATABRICKS_CLIENT_SECRET=seu-client-secret
DATABRICKS_APP_PORT=8000
```

### Git - Preparar para publicação

```bash
# No diretório Quartely/
git add .
git commit -m "Ready for production deployment"
git push origin main  # ou sua branch
```

## 🌐 Opções de Publicação

### 1️⃣ Vercel (Recomendado para Jamstack)

**Pré-requisitos:**
- GitHub account
- Vercel account

**Passos:**

1. Push para GitHub
2. Acesse https://vercel.com
3. Clique "Add New..." → "Project"
4. Selecione repositório `teste-conexao`
5. Configure:
   - Framework: Other (Node.js)
   - Root Directory: `Quartely`
   - Build Command: `npm install`
   - Start Command: `npm start`

6. Variáveis de ambiente:
   ```
   DATABRICKS_HOST=seu-host
   DATABRICKS_WAREHOUSE_ID=seu-id
   DATABRICKS_CLIENT_ID=seu-client-id
   DATABRICKS_CLIENT_SECRET=seu-secret
   DATABRICKS_APP_PORT=8000
   ```

7. Deploy

**Resultado:** URL automática do tipo `https://seu-app.vercel.app`

---

### 2️⃣ Railway (Simples + Gratuito)

**Pré-requisitos:**
- GitHub account
- Railway account

**Passos:**

1. Acesse https://railway.app
2. Clique "New Project"
3. Selecione "Deploy from GitHub"
4. Selecione repositório
5. Selecione branch e raiz `Quartely/`
6. Configure variáveis:
   - Environment → Add Variable
   - Adicione todas as DATABRICKS_*

7. Deploy automático

**Resultado:** URL tipo `https://seu-app.railway.app`

---

### 3️⃣ AWS (EC2 + Nginx)

**Pré-requisitos:**
- AWS account
- EC2 instance Linux (t2.micro adequado)
- SSH access

**Passos:**

```bash
# No EC2
sudo apt update
sudo apt install -y nodejs npm nginx git

# Clone repositório
git clone https://github.com/AlvesBhz/teste-conexao.git
cd teste-conexao/Quartely

# Instale dependências
npm install --production

# Crie .env com credenciais
sudo nano .env
# (adicione variáveis)

# Instale PM2
sudo npm install -g pm2
pm2 start server.js --name "quarterly"
pm2 startup
pm2 save
```

**Configure Nginx:**

```bash
sudo nano /etc/nginx/sites-available/quarterly
```

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/quarterly /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**SSL (Let's Encrypt):**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seu-dominio.com
```

---

### 4️⃣ DigitalOcean App Platform

**Pré-requisitos:**
- DigitalOcean account
- GitHub repository

**Passos:**

1. Acesse https://cloud.digitalocean.com/apps
2. "Create App"
3. Selecione GitHub repository
4. Configure:
   - Source: GitHub / seu-repo
   - Branch: main
   - Source Directory: Quartely

5. Service Details:
   - HTTP Port: 8000
   - Build: `npm install`
   - Run: `npm start`

6. Environment:
   - Adicione variáveis DATABRICKS_*

7. Deploy

---

### 5️⃣ Docker + DockerHub

**Crie Dockerfile:**

```dockerfile
# Quartely/Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8000

ENV NODE_ENV=production

CMD ["npm", "start"]
```

**Build e Push:**

```bash
cd Quartely
docker build -t seu-usuario/quarterly-dashboard:1.0.0 .
docker login
docker push seu-usuario/quarterly-dashboard:1.0.0
```

**Executar:**

```bash
docker run -p 8000:8000 \
  -e DATABRICKS_HOST=seu-host \
  -e DATABRICKS_WAREHOUSE_ID=seu-id \
  -e DATABRICKS_CLIENT_ID=seu-client-id \
  -e DATABRICKS_CLIENT_SECRET=seu-secret \
  seu-usuario/quarterly-dashboard:1.0.0
```

---

### 6️⃣ Heroku (Deprecated mas ainda funciona)

```bash
# No diretório Quartely/
heroku login
heroku create seu-app-name
heroku config:set DATABRICKS_HOST=seu-host --app seu-app-name
heroku config:set DATABRICKS_WAREHOUSE_ID=seu-id --app seu-app-name
heroku config:set DATABRICKS_CLIENT_ID=seu-client-id --app seu-app-name
heroku config:set DATABRICKS_CLIENT_SECRET=seu-secret --app seu-app-name

git push heroku main
heroku open
```

---

## 📊 Matriz de Comparação

| Platform | Custo | Setup | Facilidade | SSL | Escalabilidade |
|----------|-------|-------|-----------|-----|-----------------|
| Vercel | Gratuito-$ | 5 min | Muito Fácil | ✅ | Excelente |
| Railway | $5-50/mês | 10 min | Fácil | ✅ | Bom |
| DigitalOcean | $5-100/mês | 15 min | Moderado | ✅ | Excelente |
| AWS EC2 | $0-50/mês | 30 min | Técnico | ✅ | Excelente |
| Docker | Variável | 20 min | Técnico | ✅ | Variável |

## ✅ Teste de Publicação

Após publicar, teste:

```bash
# Health check
curl https://seu-app.com/api/health

# Dados do gráfico
curl https://seu-app.com/api/chart-data | head

# Acesse no navegador
https://seu-app.com
```

## 🔒 Segurança

- ✅ Nunca commit `.env` (já em .gitignore)
- ✅ Use variáveis de ambiente para secrets
- ✅ Enable HTTPS (certificado SSL)
- ✅ Monitore logs da aplicação
- ✅ Atualize dependencies: `npm audit fix`

## 📱 Monitoramento

Após publicação, monitore:

- Performance da API (`/api/chart-data` < 1s)
- Taxa de erro (deve ser 0%)
- Uptime (apunte com UptimeRobot)
- Logs (procure por erros)

## 🆘 Problemas Comuns

| Erro | Solução |
|------|---------|
| 502 Bad Gateway | Verifique se app está rodando |
| Timeout | Aumentar timeout na query |
| 401 Unauthorized | Credenciais Databricks inválidas |
| CORS errors | Configurar headers CORS no server.js |
| Out of Memory | Aumentar heap size: `node --max-old-space-size=512 server.js` |

## 🎯 Próximos Passos

1. Escolha uma plataforma de publicação
2. Siga o guia específico
3. Configure variáveis de ambiente
4. Faça deploy
5. Teste a URL
6. Configure monitoramento
7. Compartilhe URL com stakeholders

---

**Última atualização:** 2025-09-21  
**Status:** ✅ Pronto para Produção
