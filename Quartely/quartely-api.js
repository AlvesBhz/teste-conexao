/**
 * Quartely — rotas de dados (chart-data / sites) como MÓDULO.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O Quartely tem dois pontos de entrada possíveis:
 *
 *   1. Standalone, para desenvolvimento: `cd Quartely && npm start`
 *      (Quartely/server.js sobe o próprio Express + pool).
 *   2. Dentro do app publicado: o Databricks App roda `npm start` na
 *      RAIZ do projeto (ver app.yaml), ou seja, o server.js da raiz —
 *      Quartely/server.js não roda em produção.
 *
 * Antes deste módulo, a SQL vivia duplicada nos dois server.js: editar
 * a query no Quartely não mudava nada em produção, que é exatamente a
 * armadilha que fez o filtro Product parecer quebrado por semanas.
 * Aqui a query existe UMA vez, e os dois pontos de entrada montam o
 * mesmo router.
 *
 * `runQuery` entra por injeção porque cada entrada tem seu próprio
 * pool: a raiz já mantém um (com instrumentação de tempo), o
 * standalone abre o seu. Contrato: recebe a SQL e devolve algo com
 * `.recordset` (o formato do pacote `mssql`).
 */
const express = require('express');

// Janela e data de referência vêm do banco (IBP.CONTROLE_PROCESSOS),
// nunca do relógio do servidor de aplicação: é @DT_REF que decide o
// corte Actual/Forecast ('A' vs 'F') de cada período.
const CHART_DATA_SQL = `
DECLARE @DT_INI AS DATE, @DT_FIM AS DATE, @DT_REF AS DATE

SET @DT_INI = '2025-01-01'
SET @DT_FIM = CAST(DATEADD(MONTH, 0, CONCAT(YEAR(DATEFROMPARTS(YEAR(DATEADD(MONTH, 0, GETDATE()-1)), MONTH(DATEADD(MONTH, -1, GETDATE()-1)), 1)), '-12-01')) AS DATE)
SET @DT_REF = (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)

-- QUARTER
SELECT
  DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 1 ELSE 2 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CONCAT(
    'Q', DATEPART(QUARTER, PVC.DT_REF),
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), DATEPART(QUARTER, PVC.DT_REF) * 3, 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'QUARTER' AS CD_VISAO, 'Trimestral' AS NM_VISAO, 2 AS ORDEM_VISAO,
  YEAR(PVC.DT_REF) AS ORDEM_ANO, DATEPART(QUARTER, PVC.DT_REF) AS ORDEM_PERIODO,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
FROM
  IBP.PEDRAVISAOCONSOLIDADA PVC
  INNER JOIN IBP.DASHBOARD DASH
    ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
    AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
  CROSS APPLY (
    SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
    UNION ALL
    SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
    UNION ALL
    SELECT 'Forecast' AS Type,
    CASE
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0),
  YEAR(PVC.DT_REF), DATEPART(QUARTER, PVC.DT_REF),
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type

UNION ALL

-- SEMESTER
SELECT
  DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 7 END, 1) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 1 ELSE 2 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CONCAT(
    CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 'H1' ELSE 'H2' END,
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 6 ELSE 12 END, 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'SEMESTER' AS CD_VISAO, 'Semestral' AS NM_VISAO, 3 AS ORDEM_VISAO,
  YEAR(PVC.DT_REF) AS ORDEM_ANO,
  CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 2 END AS ORDEM_PERIODO,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
FROM
  IBP.PEDRAVISAOCONSOLIDADA PVC
  INNER JOIN IBP.DASHBOARD DASH
    ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
    AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
  CROSS APPLY (
    SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
    UNION ALL
    SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
    UNION ALL
    SELECT 'Forecast' AS Type,
    CASE
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF),
  CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 7 END,
  CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 2 END,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type,
  -- SQL Server exige a expressão de 'Type' repetida verbatim aqui: os
  -- CASEs numéricos acima não cobrem o ramo Forecast A/F, que depende
  -- de EOMONTH. Mesma forma da QUARTELY.sql de origem.
  CONCAT(
    CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 'H1' ELSE 'H2' END,
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 6 ELSE 12 END, 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2)))

UNION ALL

-- YEAR
SELECT
  DATEFROMPARTS(YEAR(PVC.DT_REF), 1, 1) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 6 ELSE 7 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CASE
    WHEN UnpivotedData.Type = 'Budget' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'B')
    WHEN UnpivotedData.Type = 'Supply' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'P')
    WHEN UnpivotedData.Type = 'Forecast' AND YEAR(PVC.DT_REF) < YEAR(@DT_REF) THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'A')
    WHEN UnpivotedData.Type = 'Forecast' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'F')
  END AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'YEAR' AS CD_VISAO, 'Anual' AS NM_VISAO, 4 AS ORDEM_VISAO,
  YEAR(PVC.DT_REF) AS ORDEM_ANO, YEAR(PVC.DT_REF) AS ORDEM_PERIODO,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
FROM
  IBP.PEDRAVISAOCONSOLIDADA PVC
  INNER JOIN IBP.DASHBOARD DASH
    ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
    AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
  CROSS APPLY (
    SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
    UNION ALL
    SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
    UNION ALL
    SELECT 'Forecast' AS Type,
    CASE
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF), PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type

ORDER BY ORDEM_ANO, ORDEM_VISAO, ORDEM_PERIODO, ORDEM_SERIE`;

// A origem correta é IBP.DASHBOARD.ID_SITE (todo site configurado para
// este dashboard), não IBP.PEDRAVISAOCONSOLIDADA: partir de PVC por
// INNER JOIN omite qualquer site cadastrado no DASHBOARD mas ainda sem
// linhas de fato/orçamento — causa-raiz de sites "faltando" no filtro.
const SITES_SQL = `
SELECT DISTINCT
  S.ID_SITE,
  LTRIM(RTRIM(S.NM_SITE)) AS NM_SITE
FROM IBP.SITES S
RIGHT JOIN IBP.DASHBOARD D
  ON D.ID_SITE = S.ID_SITE
WHERE D.ID_DASH = 21
  AND S.NM_SITE IS NOT NULL
  AND LTRIM(RTRIM(S.NM_SITE)) <> ''
ORDER BY NM_SITE`;

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Monta o router com /chart-data, /sites e /ping.
 *
 * O router pode ser montado em VÁRIOS caminhos (a raiz monta nos quatro
 * candidatos, porque de fora não dá para saber se o Databricks Apps
 * entrega "/Quartely/api/..." ou já sem o prefixo da pasta). Montar a
 * MESMA instância em todos compartilha o cache — não multiplica ida ao
 * banco.
 */
function criarQuartelyRouter({ runQuery }) {
  if (typeof runQuery !== 'function') {
    throw new Error('criarQuartelyRouter: `runQuery` é obrigatório');
  }

  const router = express.Router();
  const cache = new Map();

  async function comCache(chave, buscar) {
    const item = cache.get(chave);
    if (item && item.expiraEm > Date.now()) return item.dados;
    const dados = await buscar();
    cache.set(chave, { dados, expiraEm: Date.now() + CACHE_TTL_MS });
    return dados;
  }

  function rota(caminho, chaveCache, consulta, oQueFalhou) {
    router.get(caminho, async (req, res) => {
      try {
        const dados = await comCache(chaveCache, async () => (await runQuery(consulta)).recordset);
        res.json(dados);
      } catch (err) {
        console.error(`[quartely] Erro ao buscar ${chaveCache}:`, err.message);
        res.status(500).json({ error: oQueFalhou, detalhe: err.message });
      }
    });
  }

  // Diagnóstico que NÃO toca no banco: separa "código não publicado"
  // (404 aqui) de "publicado, mas o banco falha" (200 aqui + 500 abaixo).
  router.get('/ping', (req, res) => {
    res.json({ ok: true, caminhoRecebido: req.originalUrl });
  });

  rota('/chart-data', 'chart-data', CHART_DATA_SQL, 'Failed to fetch chart data');
  rota('/sites', 'sites', SITES_SQL, 'Failed to fetch sites');

  return router;
}

module.exports = { criarQuartelyRouter, CHART_DATA_SQL, SITES_SQL };
