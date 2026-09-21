const express = require("express");
const path = require("path");
const { DBSQLClient } = require("@databricks/sql");
const app = express();

// Middleware de compressão
try {
  app.use(require("compression")());
} catch (err) {
  console.warn("[perf] middleware 'compression' indisponível; servindo sem gzip.");
}

// Servir arquivos estáticos
app.use(express.static(__dirname, {
  etag: true,
  index: false,
  setHeaders: (res) => res.set("Cache-Control", "no-store"),
}));

// ── Conexão Databricks ──────────────────────────────────────────
async function createSession() {
  const client = new DBSQLClient();

  const host = process.env.DATABRICKS_HOST;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;

  const missing = [
    !host && "DATABRICKS_HOST",
    !warehouseId && "DATABRICKS_WAREHOUSE_ID",
    !clientId && "DATABRICKS_CLIENT_ID",
    !clientSecret && "DATABRICKS_CLIENT_SECRET",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(", ")}`);
  }

  await client.connect({
    authType: "databricks-oauth",
    useDatabricksOAuthInAzure: true,
    host,
    path: `/sql/1.0/warehouses/${warehouseId}`,
    oauthClientId: clientId,
    oauthClientSecret: clientSecret,
  });

  const session = await client.openSession();
  return { client, session };
}

let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) sessionPromise = createSession();
  try {
    return await sessionPromise;
  } catch (err) {
    sessionPromise = null;
    throw err;
  }
}

async function closeSessionQuietly() {
  const pending = sessionPromise;
  sessionPromise = null;
  if (!pending) return;
  try {
    const { client, session } = await pending;
    await session.close();
    await client.close();
  } catch (err) {
    /* sessão já estava morta */
  }
}

let queue = Promise.resolve();

async function executeOnSession(sql) {
  const tSession = Date.now();
  const { session } = await getSession();
  const msSession = Date.now() - tSession;

  const tQuery = Date.now();
  const query = await session.executeStatement(sql);
  try {
    const rows = await query.fetchAll();
    const primeiraLinha = sql.trim().split("\n")[0].trim().slice(0, 48);
    console.log(
      `[sql] sessão=${msSession}ms query=${Date.now() - tQuery}ms linhas=${rows.length} :: ${primeiraLinha}`
    );
    return rows;
  } finally {
    await query.close();
  }
}

async function runQuery(sql) {
  const run = async () => {
    try {
      return await executeOnSession(sql);
    } catch (err) {
      await closeSessionQuietly();
      return executeOnSession(sql);
    }
  };
  queue = queue.then(run, run);
  return queue;
}

// ── Cache em memória ────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function withCache(key, fetcher) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// ── Função de dados do gráfico ──────────────────────────────────
async function getChartData() {
  return withCache("chart-data", async () => {
    const sql = `
      DECLARE @DT_INI AS DATE, @DT_FIM AS DATE, @DT_REF AS DATE
      SET @DT_INI = '2025-01-01'
      SET @DT_FIM = CAST(DATEADD(MONTH, 0, CONCAT(YEAR(DATEFROMPARTS(YEAR(DATEADD(MONTH, 0, GETDATE()-1)), MONTH(DATEADD(MONTH, -1, GETDATE()-1)), 1)), '-12-01')) AS DATE)
      SET @DT_REF = (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)

      -- MESES
      SELECT
        PVC.DT_REF, PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
        DASH.NM_KPIS_DASH AS NM_KPI, DASH.ID_ORDEM,
        CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 1 ELSE 2 END AS ORDEM_GRAFICO,
        CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS ID_TYPE,
        CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS NM_TYPE,
        CASE WHEN UnpivotedData.Type = 'Budget' THEN CONCAT(FORMAT(DT_REF, 'MMM'),' B')
          WHEN UnpivotedData.Type = 'Supply' THEN CONCAT(FORMAT(DT_REF, 'MMM'),' P')
          WHEN UnpivotedData.Type = 'Forecast' AND PVC.DT_REF <= @DT_REF THEN CONCAT(FORMAT(DT_REF, 'MMM'),' A')
          WHEN UnpivotedData.Type = 'Forecast' THEN CONCAT(FORMAT(DT_REF, 'MMM'),' F') END AS Type,
        CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END AS Value
      FROM IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH ON PVC.ID_SISTEMA = DASH.ID_SISTEMA AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
      CROSS APPLY (
        SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
        UNION ALL SELECT 'Forecast' AS Type,
          CASE WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
            WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
            ELSE PVC.VL_PROJ * DASH.VL_FATOR END AS Value
      ) AS UnpivotedData
      WHERE PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM AND DASH.ID_DASH = 21
    `;

    const rows = await runQuery(sql);
    return rows;
  });
}

// ── Middleware de cache para APIs ──────────────────────────────
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ── Endpoint de dados do gráfico ───────────────────────────────
app.get("/api/chart-data", async (req, res) => {
  try {
    const tTotal = Date.now();
    const data = await getChartData();
    console.log(`[api] /api/chart-data total=${Date.now() - tTotal}ms rows=${data.length}`);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Rotas de página ────────────────────────────────────────────
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Health check ───────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Error handling ─────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION");
  console.error(err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION");
  console.error(err);
});

// ── Iniciar servidor ───────────────────────────────────────────
const port = process.env.DATABRICKS_APP_PORT || 8000;

app.listen(port, "0.0.0.0", () => {
  console.log(`[quarterly-dashboard] Server running on port ${port}`);
  console.log(`  http://localhost:${port}`);
  console.log(`  API: http://localhost:${port}/api/chart-data`);
});
