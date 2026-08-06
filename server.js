const express = require("express");
const path = require("path");
const { DBSQLClient } = require("@databricks/sql");
const app = express();

app.use(express.static(__dirname));

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
    throw new Error(
      `Variáveis de ambiente ausentes: ${missing.join(", ")}`
    );
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

async function getTreeData(nmVDT = null, ano = null) {

  const { client, session } = await createSession();

  const catalog = process.env.CATALOG_NAME || "franquia_bmsa_insight";
  const schema = process.env.SCHEMA_NAME || "default";
  const table = process.env.TABLE_NAME || "estrutura_salobo_mill_production";

  try {

    let sql = `
      SELECT
        NO_PAI,
        NO_FILHO,
        NM_KPI,
        NM_VDT,
        Unit,
        VL_FATOR,
        SG_DECIMAL,
        ID_ORDEM,
        VL_PROJ,
        VL_ORC,
        VL_LOBP,
        (VL_PROJ - VL_ORC) AS VL_DIF_PROJ_ORC
      FROM ${catalog}.${schema}.${table}
    `;

    // nmVDT é escapado (é texto livre); ano só chega aqui já validado
    // como inteiro por app.get("/api/tree") — nunca interpolado como
    // string, então não precisa (nem faz sentido) de escaping de aspas.
    const where = [];
    if (nmVDT) where.push(`NM_VDT = '${nmVDT.replace(/'/g, "''")}'`);
    if (ano !== null) where.push(`YEAR(DT_REF) = ${ano}`);
    if (where.length) sql += `WHERE ${where.join(" AND ")}\n`;

    sql += `
      ORDER BY ID_ORDEM
    `;

    const query = await session.executeStatement(sql);

    const rows = await query.fetchAll();

    await query.close();

    return rows.map((r) => ({
      NodeID: r.NO_PAI,
      ParentID: r.NO_FILHO,
      IndicatorName: r.NM_KPI,
      NM_VDT: r.NM_VDT,
      Unit: r.Unit,
      VL_FATOR: r.VL_FATOR,
      SG_DECIMAL: r.SG_DECIMAL,
      DisplayOrder: r.ID_ORDEM,
      VL_PROJ: r.VL_PROJ,
      VL_ORC: r.VL_ORC,
      VL_LOBP: r.VL_LOBP,
      VL_DIF_PROJ_ORC: r.VL_DIF_PROJ_ORC
    }));

  } finally {

    await session.close();
    await client.close();

  }
}
async function getListaVDT() {

  const { client, session } = await createSession();

  const catalog = process.env.CATALOG_NAME || "franquia_bmsa_insight";
  const schema = process.env.SCHEMA_NAME || "default";
  const table = process.env.TABLE_NAME || "estrutura_salobo_mill_production";

  try {

    const query = await session.executeStatement(`
      SELECT DISTINCT NM_VDT
      FROM ${catalog}.${schema}.${table}
      WHERE NM_VDT IS NOT NULL
      ORDER BY NM_VDT
    `);

    const rows = await query.fetchAll();

    await query.close();

    return rows;

  } finally {

    await session.close();
    await client.close();

  }
}

// Anos distintos da coluna DT_REF, mais recente primeiro — usado pra
// popular o combo "Selecione o Ano" (ver /api/filtros-ano). YEAR(...)
// já extrai o ano de qualquer DATE/TIMESTAMP, e o DISTINCT antes do
// ORDER BY elimina duplicidade de datas do mesmo ano.
// A VDT é o filtro mandatório: o Ano é sempre um RECORTE da VDT
// selecionada (nunca o contrário), então a lista de anos só traz os
// anos que aquela VDT específica realmente possui — se a VDT só tiver
// dado em 2026, a lista devolvida tem 1 item só, e o combo de Ano fica
// travado nesse único valor (ver app.js).
async function getListaAnos(nmVDT = null) {

  const { client, session } = await createSession();

  const catalog = process.env.CATALOG_NAME || "franquia_bmsa_insight";
  const schema = process.env.SCHEMA_NAME || "default";
  const table = process.env.TABLE_NAME || "estrutura_salobo_mill_production";

  try {

    let sql = `
      SELECT DISTINCT YEAR(DT_REF) AS ANO
      FROM ${catalog}.${schema}.${table}
      WHERE DT_REF IS NOT NULL
    `;

    if (nmVDT) {
      sql += ` AND NM_VDT = '${nmVDT.replace(/'/g, "''")}'\n`;
    }

    sql += ` ORDER BY ANO DESC`;

    const query = await session.executeStatement(sql);

    const rows = await query.fetchAll();

    await query.close();

    return rows;

  } finally {

    await session.close();
    await client.close();

  }
}

app.get("/api/tree", async (req, res) => {
  try {

    const nmVDT = req.query.nm_vdt || null;

    // Ano é sempre validado como inteiro antes de ir pro SQL (ver
    // getTreeData) — qualquer valor não numérico é ignorado, nunca
    // interpolado direto na query.
    let ano = null;
    if (req.query.ano !== undefined && req.query.ano !== "") {
      const parsed = parseInt(req.query.ano, 10);
      if (!Number.isNaN(parsed)) ano = parsed;
    }

    const data = await getTreeData(nmVDT, ano);

    res.json(data);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }
});

app.get("/api/test", (req, res) => {
  res.json({
    status: "ok",
  });
});

app.get("/api/filtros-vdt", async (req, res) => {
  try {

    const dados = await getListaVDT();

    res.json(dados);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }
});

app.get("/api/filtros-ano", async (req, res) => {
  try {

    const nmVDT = req.query.nm_vdt || null;

    const dados = await getListaAnos(nmVDT);

    res.json(dados);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }
});

app.get("/api/test-auth", async (req, res) => {
  try {
    let WorkspaceClient;

    try {
      const sdk = require("@databricks/sdk");

      WorkspaceClient = sdk.WorkspaceClient;

      if (!WorkspaceClient) {
        return res.status(500).json({
          error: "WorkspaceClient não encontrado no SDK",
        });
      }
    } catch (err) {
      return res.status(500).json({
        error: "Erro carregando SDK",
        details: err.message,
      });
    }

    try {
      const client = new WorkspaceClient();

      const me = await client.currentUser.me();

      return res.json({
        success: true,
        user: me,
      });
    } catch (err) {
      return res.status(500).json({
        error: "Erro autenticando",
        details: err.message,
        stack: err.stack,
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "Erro inesperado",
      details: err.message,
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const port = process.env.DATABRICKS_APP_PORT || 8000;

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION");
  console.error(err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION");
  console.error(err);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
