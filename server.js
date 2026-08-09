const express = require("express");
const path = require("path");
const { DBSQLClient } = require("@databricks/sql");
const app = express();

// gzip/brotli nos estáticos (d3.v7.min.js sozinho tem ~280 KB de texto
// altamente compressível). Opcional de propósito: se a dependência não
// estiver instalada no ambiente, o servidor sobe do mesmo jeito, só sem
// compressão — nunca deixa a app fora do ar por causa disso.
try {
  app.use(require("compression")());
} catch (err) {
  console.warn("[perf] middleware 'compression' indisponível; servindo sem gzip.");
}

// SEM maxAge: este projeto não tem cache-busting (nomes de arquivo sem
// hash/versão) e ainda está em desenvolvimento ativo, com deploys
// frequentes. Um maxAge alto aqui já causou um bug real em produção —
// como express.static serve index.html automaticamente pra "/" (antes
// da rota explícita abaixo), o Cache-Control de 1 dia pegava o PRÓPRIO
// HTML de entrada; o navegador ficava até 24h preso numa versão antiga,
// às vezes misturando HTML novo com JS/CSS velhos (ou vice-versa) —
// exatamente o tipo de bug "fantasma" que não existe em nenhum commit
// real. etag:true já garante requisição condicional (304 quando nada
// mudou), o que é suficiente pra performance sem esse risco.
//
// index:false é o outro lado dessa correção: por padrão o express.static
// responde SOZINHO a "GET /" servindo index.html (comportamento de
// "diretório com index"), antes mesmo da rota explícita abaixo rodar —
// então o Cache-Control:no-store definido ali nunca era de fato
// aplicado (confirmado testando: sem index:false, "/" respondia com
// "public, max-age=0" do middleware, e a rota explícita nunca era
// alcançada). Com index:false, "/" cai direto na rota explícita.
//
// setHeaders(no-store) em cima disso: o default do express.static sem
// maxAge ainda manda "Cache-Control: public, max-age=0" — tecnicamente
// já força revalidação, mas o "public" deixa margem pra um proxy/CDN
// corporativo na frente do domínio *.databricksapps.com guardar uma
// cópia e servir sem revalidar direito. no-store fecha essa brecha por
// completo pros mesmos arquivos (app.js/style.css) que antes só tinham
// essa proteção implícita — sessões/abas nunca ficam presas numa versão
// antiga do bundle depois de um deploy.
app.use(express.static(__dirname, {
  etag: true,
  index: false,
  setHeaders: (res) => res.set("Cache-Control", "no-store"),
}));

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

// ── Sessão Databricks reaproveitada ────────────────────────────
// ANTES: cada consulta chamava createSession() — handshake OAuth
// completo + abertura de sessão SQL do zero — e fechava tudo no
// finally. Como o handshake custa MUITO mais que a query em si numa
// tabela pequena, era ele (não o volume de dados) que dominava o tempo
// de resposta: a tela inicial pagava esse custo 2–3x seguidas e cada
// troca de filtro pagava de novo.
// AGORA: uma única sessão "quente" é mantida no processo e reusada.
let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) sessionPromise = createSession();
  try {
    return await sessionPromise;
  } catch (err) {
    sessionPromise = null; // falhou ao conectar: não cacheia a promise quebrada
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
    /* sessão já estava morta — nada a fazer */
  }
}

// O driver não garante segurança para statements concorrentes na mesma
// sessão, então as execuções são serializadas numa fila. Com o volume
// atual (consultas de milissegundos numa tabela pequena) isso não vira
// gargalo, e evita a classe inteira de bug de concorrência que um
// client compartilhado traria.
let queue = Promise.resolve();

// Instrumentação: separa o tempo de OBTER a sessão (handshake OAuth +
// abertura — pago só na 1ª consulta do processo) do tempo de EXECUTAR a
// consulta (que inclui a partida do SQL Warehouse, se ele estiver
// auto-suspenso). Sem essa separação é impossível saber, em produção,
// se o primeiro carregamento lento é conexão, warehouse frio ou a query
// em si. Aparece no log da app como [sql].
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
      // A sessão pode ter expirado por ociosidade entre uma requisição
      // e outra. Descarta e tenta UMA vez com sessão nova; se falhar de
      // novo, o erro é real (SQL inválido, warehouse fora, etc.) e sobe.
      await closeSessionQuietly();
      return executeOnSession(sql);
    }
  };
  queue = queue.then(run, run); // segue a fila mesmo após uma falha
  return queue;
}

// ── Cache em memória para listas de filtro ─────────────────────
// VDTs e anos são dados estruturais: mudam raramente e eram
// reconsultados por inteiro a cada carregamento de página e a cada
// troca de VDT. TTL curto mantém a tela atualizada sem repetir a
// consulta a cada clique. Os DADOS DA ÁRVORE não entram aqui de
// propósito — são valores de negócio e devem vir sempre frescos.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function withCache(key, fetcher) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

function tableRef() {
  const catalog = process.env.CATALOG_NAME || "franquia_bmsa_insight";
  const schema = process.env.SCHEMA_NAME || "default";
  const table = process.env.TABLE_NAME || "estrutura_salobo_mill_production";
  return `${catalog}.${schema}.${table}`;
}

function buildTreeSql(nmVDT, ano, visao) {
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
    FROM ${tableRef()}
  `;

  // nmVDT/visao são escapados (texto livre); ano só chega aqui já
  // validado como inteiro por app.get("/api/tree") — nunca interpolado
  // como string, então não precisa (nem faz sentido) de escaping.
  const where = [];
  if (nmVDT) where.push(`NM_VDT = '${nmVDT.replace(/'/g, "''")}'`);
  // Intervalo em vez de YEAR(DT_REF) = ano: aplicar função na coluna
  // torna o predicado não-sargável e impede o Delta/Spark de podar
  // partições e pular arquivos pelas estatísticas de min/max — o motor
  // acaba lendo a tabela inteira para depois descartar. A comparação
  // por faixa preserva exatamente o mesmo conjunto de linhas.
  if (ano !== null) where.push(`DT_REF >= '${ano}-01-01' AND DT_REF < '${ano + 1}-01-01'`);
  // VISAO_COLUMN (TP_VISION, Actual/Forecast) — ver comentário na
  // declaração da constante. Só entra no WHERE se `visao` foi passado.
  if (visao) where.push(`${VISAO_COLUMN} = '${visao.replace(/'/g, "''")}'`);
  if (where.length) sql += `WHERE ${where.join(" AND ")}\n`;

  sql += `
    ORDER BY ID_ORDEM
  `;
  return sql;
}

async function getTreeData(nmVDT = null, ano = null, visao = null) {
  let rows;
  if (visao) {
    try {
      rows = await runQuery(buildTreeSql(nmVDT, ano, visao));
    } catch (err) {
      // Proteção defensiva (ver comentário na declaração de VISAO_COLUMN):
      // se a coluna falhar por qualquer motivo, a ÁRVORE NÃO PODE quebrar
      // por causa disso — recarrega sem o filtro de Visão e loga o motivo.
      console.warn(`[visao] Filtro por Visão falhou (coluna ${VISAO_COLUMN} pode não existir); recarregando sem ele: ${err.message}`);
      rows = await runQuery(buildTreeSql(nmVDT, ano, null));
    }
  } else {
    rows = await runQuery(buildTreeSql(nmVDT, ano, null));
  }

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
}

async function getListaVDT() {
  return withCache("vdt-list", async () => {
    const rows = await runQuery(`
      SELECT DISTINCT NM_VDT
      FROM ${tableRef()}
      WHERE NM_VDT IS NOT NULL
      ORDER BY NM_VDT
    `);
    // IS NOT NULL não barra NM_VDT em branco ('', só espaços) — mesma
    // brecha já fechada em getFilterMatrix()/getVisoesMatrix().
    return rows.filter((r) => r.NM_VDT != null && String(r.NM_VDT).trim() !== "");
  });
}

// Matriz de filtros: TODOS os pares (VDT, ano) existentes numa consulta
// só. Antes eram duas idas ao warehouse — lista de VDTs e lista de anos
// da VDT escolhida — e a de anos ainda era refeita a cada troca de VDT.
// O resultado é minúsculo (nº de VDTs × nº de anos), então trazer tudo
// de uma vez sai mais barato que buscar por partes: o boot economiza uma
// consulta e a troca de VDT no front passa a não precisar de requisição
// nenhuma para montar o combo de Ano.
async function getFilterMatrix() {
  return withCache("filter-matrix", async () => {
    const rows = await runQuery(`
      SELECT DISTINCT NM_VDT, YEAR(DT_REF) AS ANO
      FROM ${tableRef()}
      WHERE NM_VDT IS NOT NULL AND DT_REF IS NOT NULL
      ORDER BY NM_VDT, ANO DESC
    `);

    const anosPorVdt = {};
    rows.forEach((r) => {
      // == null só pega NULL/undefined — uma NM_VDT em branco ('', só
      // espaços) passa pelo WHERE IS NOT NULL do SQL e cairia aqui como
      // opção vazia no combo. trim() fecha essa brecha.
      if (r.NM_VDT == null || String(r.NM_VDT).trim() === "" || r.ANO == null) return;
      (anosPorVdt[r.NM_VDT] = anosPorVdt[r.NM_VDT] || []).push(Number(r.ANO));
    });
    // Mais recente primeiro (não confia só no ORDER BY do motor).
    Object.values(anosPorVdt).forEach((anos) => anos.sort((a, b) => b - a));

    return { vdts: Object.keys(anosPorVdt).sort(), anosPorVdt };
  });
}

// Anos distintos da coluna DT_REF, mais recente primeiro — usado pra
// popular o combo "Selecione o Ano" (ver /api/filtros-ano). YEAR(...)
// já extrai o ano de qualquer DATE/TIMESTAMP, e o DISTINCT antes do
// ORDER BY elimina duplicidade de datas do mesmo ano.
// A VDT é o filtro mandatório: o Ano é sempre um RECORTE da VDT
// selecionada (nunca o contrário), então a lista de anos só traz os
// anos que aquela VDT específica realmente possui.
async function getListaAnos(nmVDT = null) {
  return withCache(`anos:${nmVDT || "*"}`, () => {
    let sql = `
      SELECT DISTINCT YEAR(DT_REF) AS ANO
      FROM ${tableRef()}
      WHERE DT_REF IS NOT NULL
    `;

    if (nmVDT) {
      sql += ` AND NM_VDT = '${nmVDT.replace(/'/g, "''")}'\n`;
    }

    sql += ` ORDER BY ANO DESC`;

    return runQuery(sql);
  });
}

// ── Visão (Actual / Forecast) ───────────────────────────────────
// Coluna confirmada pelo usuário: TP_VISION, com valores literais
// 'Actual'/'Forecast' (mesmos rótulos exibidos na UI). Se o nome real
// mudar no futuro, ajustar apenas esta constante — buildTreeSql() e
// getVisoesMatrix() a referenciam, nunca hardcodam o nome da coluna.
//
// Toda a leitura desta coluna segue defensiva (mesmo confirmada): se
// ela não existir por algum motivo, a consulta falha e
// getVisoesMatrix() devolve null (em vez de derrubar o processo), e
// resolveVisoes() cai no fallback permissivo abaixo — o combo de Visão
// continua funcionando, só sem o refinamento real por dado. O filtro na
// árvore (getTreeData) tem a mesma proteção.
const VISAO_COLUMN = "TP_VISION";

// Ano corrente do SERVIDOR (fonte única da verdade pra "ano anterior
// vs. ano corrente" — evita depender do relógio/fuso do navegador de
// cada usuário).
function anoAtual() {
  return new Date().getFullYear();
}

// Matriz NM_VDT × ANO × Visões-reais-observadas, numa única consulta
// (mesmo espírito de getFilterMatrix — resultado minúsculo, cacheado).
async function getVisoesMatrix() {
  return withCache("visoes-matrix", async () => {
    try {
      const rows = await runQuery(`
        SELECT DISTINCT NM_VDT, YEAR(DT_REF) AS ANO, ${VISAO_COLUMN} AS VISAO
        FROM ${tableRef()}
        WHERE NM_VDT IS NOT NULL AND DT_REF IS NOT NULL AND ${VISAO_COLUMN} IS NOT NULL
      `);
      const matrix = {};
      rows.forEach((r) => {
        // == null só pega NULL/undefined — NM_VDT/VISAO em branco ('', só
        // espaços) passam pelo WHERE IS NOT NULL do SQL e virariam opção
        // vazia no combo de Visão. trim() fecha essa brecha.
        if (r.NM_VDT == null || String(r.NM_VDT).trim() === "") return;
        if (r.ANO == null) return;
        if (r.VISAO == null || String(r.VISAO).trim() === "") return;
        const porAno = (matrix[r.NM_VDT] = matrix[r.NM_VDT] || {});
        (porAno[Number(r.ANO)] = porAno[Number(r.ANO)] || new Set()).add(String(r.VISAO));
      });
      return matrix;
    } catch (err) {
      console.warn(`[visao] Consulta de Visão indisponível (coluna ${VISAO_COLUMN} pode não existir); combo de Visão usará fallback permissivo: ${err.message}`);
      return null;
    }
  });
}

// Regra de negócio (única fonte da verdade, usada por /api/bootstrap E
// /api/filtros-visao — nunca duplicada):
//   - Ano ANTERIOR ao corrente: só "Actual", incondicionalmente (mesmo
//     que existam linhas de Forecast remanescentes pra um ano fechado,
//     elas não fazem sentido de negócio e não são oferecidas).
//   - Ano corrente (ou futuro): as visões que realmente existem nos
//     dados; sem dado real (matrix ausente ou vazia p/ este VDT+ano),
//     oferece as duas como fallback permissivo em vez de travar o combo.
function resolveVisoes(nmVDT, ano, visoesMatrix) {
  if (ano < anoAtual()) return ["Actual"];
  const reais = visoesMatrix && visoesMatrix[nmVDT] && visoesMatrix[nmVDT][ano];
  if (reais && reais.size) return [...reais].sort();
  return ["Actual", "Forecast"];
}

// Nenhuma resposta de /api/* pode ser guardada por um proxy/CDN na
// frente do app (mesmo motivo do no-store nos estáticos, acima): estes
// endpoints são a fonte dos números da árvore, consultados frescos no
// Databricks a cada chamada — uma cópia em cache aqui reintroduziria
// exatamente a desatualização que o no-store nos estáticos elimina.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

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

    const visao = req.query.visao || null;

    const data = await getTreeData(nmVDT, ano, visao);

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

// Terceiro nível da cascata Árvore → Ano → Visão: exige nm_vdt E ano
// (a Visão é um recorte do par VDT+Ano, nunca isolada). Usa a mesma
// matriz/regra de negócio do /api/bootstrap (resolveVisoes) — evita
// qualquer duplicação de lógica entre a carga inicial e as trocas de
// filtro subsequentes.
app.get("/api/filtros-visao", async (req, res) => {
  try {

    const nmVDT = req.query.nm_vdt || null;
    const ano = parseInt(req.query.ano, 10);

    if (!nmVDT || Number.isNaN(ano)) {
      return res.status(400).json({ error: "nm_vdt e ano são obrigatórios" });
    }

    // Ano anterior ao corrente não precisa nem consultar a matriz —
    // resolveVisoes já resolve pra ["Actual"] só com a data.
    const visoesMatrix = ano < anoAtual() ? null : await getVisoesMatrix();
    const visoes = resolveVisoes(nmVDT, ano, visoesMatrix);

    res.json(visoes.map((v) => ({ VISAO: v })));

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }
});

// Carga inicial numa única ida e volta. ANTES o boot da página fazia 3
// chamadas ENCADEADAS (lista de VDTs → anos daquela VDT → árvore),
// somando 3 latências de rede antes do 1º card aparecer. Como as duas
// primeiras só existem pra descobrir QUAL VDT/ano carregar, o servidor
// resolve isso sozinho e devolve tudo junto.
// A preferência de VDT default continua sendo do cliente (parâmetro
// vdt_preferido) — o servidor só a respeita se ela existir de fato na
// lista real, mesma regra que o front já aplicava.
app.get("/api/bootstrap", async (req, res) => {
  try {

    const tTotal = Date.now();
    const preferida = req.query.vdt_preferido || null;

    // 1 consulta (cacheada) resolve VDTs E anos de todas elas.
    const { vdts, anosPorVdt } = await getFilterMatrix();

    const vdtSelecionada =
      (preferida && vdts.includes(preferida)) ? preferida : (vdts[0] || null);

    // Sem nenhuma VDT na tabela não há o que carregar — devolve a
    // estrutura vazia e deixa o front exibir a mensagem de "sem dados".
    if (!vdtSelecionada) {
      return res.json({
        vdts: [], anosPorVdt: {}, vdtSelecionada: null, anos: [], anoSelecionado: null,
        visoes: [], visaoSelecionada: null, arvore: [],
      });
    }

    // Lista já vem ordenada decrescente: o 1º é o ano mais recente.
    const anos = anosPorVdt[vdtSelecionada] || [];
    const anoSelecionado = anos.length ? anos[0] : null;

    // Terceiro nível da cascata, resolvido junto — sem isso, o 1º
    // carregamento da página precisaria de uma requisição A MAIS só
    // pra saber quais Visões oferecer pro VDT+ano já escolhidos.
    let visoes = ["Actual"];
    if (anoSelecionado !== null) {
      const visoesMatrix = anoSelecionado < anoAtual() ? null : await getVisoesMatrix();
      visoes = resolveVisoes(vdtSelecionada, anoSelecionado, visoesMatrix);
    }
    const visaoSelecionada = visoes[0] || null;

    const arvore = await getTreeData(vdtSelecionada, anoSelecionado, visaoSelecionada);

    console.log(`[api] /api/bootstrap total=${Date.now() - tTotal}ms nos=${arvore.length}`);

    // anosPorVdt vai junto de propósito: com a matriz inteira em mãos,
    // trocar de VDT no front não precisa de requisição nenhuma para
    // remontar o combo de Ano. Visão já vem escopada pro VDT+ano
    // resolvidos aqui; trocar VDT ou Ano no front busca a Visão de novo
    // via /api/filtros-visao (ela depende dos DOIS, não dá pra
    // pré-computar tudo numa matriz sem explodir o tamanho da resposta).
    res.json({ vdts, anosPorVdt, vdtSelecionada, anos, anoSelecionado, visoes, visaoSelecionada, arvore });

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
  // Cache-Control explícito: garante que o HTML de entrada NUNCA fique
  // em cache no navegador do usuário, mesmo que o middleware acima
  // mude no futuro — é o arquivo que referencia todo o resto (JS/CSS),
  // então ele precisa ser sempre buscado fresco a cada visita.
  res.set("Cache-Control", "no-store");
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
