/**
 * Quartely acoplado ao Portal (app VBM Kaizen) em /Quartely/quartely.html.
 *
 * Tudo do Quartely fica nesta pasta. O server.js do Portal só faz:
 *     require("./Quartely/portal")(app);
 * ANTES do gate de páginas e do express.static.
 *
 * Conexão PRÓPRIA (pool separado do Kaizen), sempre no Azure SQL PRD.
 * Variáveis opcionais: QUARTELY_SQL_SERVER / _DATABASE / _PORT / _USER /
 * _PASSWORD. Sem elas: servidor e base PRD abaixo, e o usuário/senha do
 * Portal (AZURE_SQL_USER / AZURE_SQL_PASSWORD).
 */
const sql = require('mssql');
const { criarQuartelyRouter } = require('./quartely-api');

const PRD_SERVER = 'rdb-ibp-bmsa-prd.database.windows.net';
const PRD_DATABASE = 'BDIBPBMSA_PRD';

module.exports = function montarQuartelyNoPortal(app) {
  const env = process.env;
  const DB = {
    server: env.QUARTELY_SQL_SERVER || PRD_SERVER,
    database: env.QUARTELY_SQL_DATABASE || PRD_DATABASE,
    user: env.QUARTELY_SQL_USER || env.AZURE_SQL_USER || '',
    password: env.QUARTELY_SQL_PASSWORD || env.AZURE_SQL_PASSWORD || '',
    port: parseInt(env.QUARTELY_SQL_PORT || env.AZURE_SQL_PORT || '1433', 10),
  };

  let poolPromise = null;
  let ultimaFalha = null; // falha recente reaproveitada por 30 s (evita esperar o timeout a cada rota)

  function getPool() {
    if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < 30000) return Promise.reject(ultimaFalha.erro);
    if (!poolPromise) {
      const faltando = ['user', 'password'].filter(k => !DB[k]);
      if (faltando.length) return Promise.reject(new Error(`Quartely: credencial do banco ausente (${faltando.join(', ')})`));
      const pool = new sql.ConnectionPool({
        server: DB.server,
        port: DB.port,
        database: DB.database,
        user: DB.user,
        password: DB.password,
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30000,
        requestTimeout: 60000,
        pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
      });
      pool.on('error', err => { console.error('[quartely] erro no pool:', err.message); poolPromise = null; });
      poolPromise = pool.connect().then(p => {
        ultimaFalha = null;
        console.log(`[quartely] conectado a ${DB.server}/${DB.database}`);
        return p;
      }).catch(err => {
        poolPromise = null;
        ultimaFalha = { erro: err, em: Date.now() };
        console.error('[quartely] falha ao conectar:', err.message);
        throw err;
      });
    }
    return poolPromise;
  }

  const runQuery = async query => (await getPool()).request().query(query);
  const semCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // Express não diferencia maiúsculas: cobre /Quartely/api e /quartely/api.
  app.get('/Quartely/api/health', semCache, async (req, res) => {
    try {
      await runQuery('SELECT 1 AS ok');
      res.json({ status: 'healthy', database: DB.database, server: DB.server });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', database: DB.database, error: err.message });
    }
  });
  app.use('/Quartely/api', semCache, criarQuartelyRouter({ runQuery }));

  // Da pasta Quartely/ só a página e os assets são públicos: server.js,
  // portal.js, quartely-api.js, app.yaml, package*.json, .env* e docs ficam
  // bloqueados (o express.static do Portal serve a pasta inteira).
  const PUBLICO = /^\/quartely\/(quartely\.html|assets\/.+)$/i;
  app.use('/Quartely', (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Não encontrado.' });
  });

  console.log(`[quartely] rotas em /Quartely/api — banco ${DB.server}/${DB.database}`);
};
