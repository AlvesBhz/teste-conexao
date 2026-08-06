/* ============================================================
   VALUE DRIVER TREE — JAVASCRIPT (v2)
   Layout compacto (d3.tree) + zoom/pan + fit-to-view animado

   MUDANÇAS PRINCIPAIS NESTA VERSÃO:
   1. Layout calculado com d3.tree().nodeSize() — espaçamento
      controlado 100% pelo bloco CFG abaixo.
   2. d3.zoom() aplicado ao viewport: pan (arrastar) + zoom
      (scroll), com limites em CFG.ZOOM_MIN / CFG.ZOOM_MAX.
   3. Ao expandir/recolher um nó: relayout animado + "zoom-to-fit"
      automático reenquadrando o nó clicado e sua subárvore.
   4. Sem scrollbar nativa: o viewport tem overflow:hidden e a
      navegação é toda por zoom/pan.
   5. Nós recolhidos "colapsam" animadamente para dentro do
      ancestral visível mais próximo (efeito de respiração).
   ============================================================ */

(function () {
  'use strict';

  // ── 0. CONFIGURAÇÃO ─────────────────────────────────────────
  // >>> TODOS os ajustes finos de tamanho/espaçamento/animação
  // >>> estão concentrados aqui. Mexa apenas nestes valores.
  const CFG = {
    // Tamanho do card (a largura DEVE bater com --card-w no CSS)
    CARD_W: 240,           // era 228 → respiro extra, sem exagerar
    CARD_H: 98,            // estimativa; é re-medida no init() com offsetHeight (título em 1 linha só)

    // Espaçamento entre nós  (PRIORIDADE do refactor)
    COL_GAP: 36,          // horizontal, entre níveis/gerações (era 80)
    ROW_GAP: 12,          // vertical, entre irmãos (era 28)
    COUSIN_SEP: 1.15,     // d3.tree().separation(): 1 = irmãos; primos ganham +15%

    // Animação
    ANIM_MS: 400,         // duração das transições de posição/conectores
    ZOOM_ANIM_MS: 550,    // duração do reenquadramento (zoom-to-fit)

    // Zoom
    ZOOM_MIN: 0.15,       // escala mínima (scaleExtent)
    ZOOM_MAX: 1.75,       // escala máxima (scaleExtent)
    FIT_MAX_SCALE: 1.0,   // fit-to-view nunca aproxima além disso (evita zoom exagerado em subárvores pequenas)
    FIT_PADDING: 48,      // folga (px) ao redor do conteúdo no fit-to-view

    // Profundidade expandida ao carregar a página
    // (2 = raiz + 2 níveis; use Infinity para abrir tudo como antes)
    INITIAL_DEPTH: 2,

    // Escala usada na abertura, ao centralizar o nó raiz na página
    INITIAL_SCALE: 0.85,
  };

  // ── 1. DADOS: busca da tabela Databricks via /api/tree ──────
  // Antes os 152 nós vinham de um array mocado aqui (RAW_DATA).
  // Agora eles vêm do backend (server.js -> /api/tree), que consulta
  // a tabela no Databricks e devolve as linhas já no formato:
  //   { NodeID, ParentID, IndicatorName, DisplayOrder, VL_REAL, VL_ORC, VL_LOBP }
  //
  // IMPORTANTE: a tabela não tem uma coluna "NodeType" (currency/percentage),
  // usada pra formatar os valores no card. Como não dá pra saber isso só
  // pelo NO_FILHO/NM_KPI, aplico uma heurística: se o nome do indicador
  // termina em "(%)" o tipo é "percentage", senão "currency".
  // Se puder, o ideal é adicionar uma coluna NodeType (ou similar) na
  // tabela e trocar essa heurística por `NodeType: r.NODE_TYPE` direto.
  function inferNodeType(indicatorName) {
    return /\(%\)\s*$/.test(String(indicatorName || '')) ? 'percentage' : 'currency';
  }

  

  // Converte pra número preservando a ausência de dado: null/undefined/''
  // viram `null` (sem informação), nunca 0 — só um 0 vindo da fonte de
  // dados vira o número 0. É a base de toda a regra "nulo vs. zero"
  // (ver formatValuePlain/calcVariation): tudo que é "sem dado" precisa
  // continuar null até a hora de exibir, nunca ser silenciosamente
  // convertido em zero no meio do caminho.
  function toNullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  async function fetchTreeData() {
    const nmVDT = document.getElementById("cmbVDT").value;
    const res= await fetch(`/api/tree?nm_vdt=${encodeURIComponent(nmVDT)}`);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (e) {}
      throw new Error(`Falha ao buscar /api/tree (HTTP ${res.status}) ${detail}`);
    }
    const rows = await res.json();
    return rows.map((r) => ({
      NodeID: r.NodeID,
      ParentID: r.ParentID,
      IndicatorName: r.IndicatorName,
      Unit: r.Unit,
      VL_FATOR: r.VL_FATOR,
      SG_DECIMAL: r.SG_DECIMAL,
      NodeType: inferNodeType(r.IndicatorName),
      DisplayOrder: r.DisplayOrder,
      VL_PROJ: toNullableNumber(r.VL_PROJ),
      VL_ORC: toNullableNumber(r.VL_ORC),
      VL_LOBP: toNullableNumber(r.VL_LOBP),
    }));
  }


  // ── 2. FORMATAÇÃO DE VALORES ─────────────────────────────────
  // Valor "só número" — sem prefixo (R$), sufixo (M) ou símbolo (%).
  // A unidade já fica implícita no título do indicador (ex.: "(tpa)", "(%)").
  //
  // Regra nulo vs. zero: `value === null` (sem informação na fonte) SEMPRE
  // exibe "-", nunca "0" e nunca entra em conta alguma. Um 0 de verdade
  // (número, não null) é formatado e tratado normalmente.
  function formatValuePlain(value, type, factor = 1, decimalFlag = 1) {
    if (value === null || value === undefined) return '-';
    const finalValue = Number(value) * Number(factor || 1);
    return finalValue.toLocaleString('pt-BR', {
      minimumFractionDigits: decimalFlag,
      maximumFractionDigits: decimalFlag,
    });
  }

  // Percentual formatado no locale da aplicação (pt-BR: vírgula decimal),
  // com sinal explícito — mesma base de cálculo de calcVariation.pct.
  // `null`/`noData` vira "-", nunca "0%" nem um percentual inventado.
  function formatPercentPtBR(pct) {
    if (pct === null || pct === undefined) return '-';
    const sign = pct >= 0 ? '+' : '';
    return sign + pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  // Regra nulo vs. zero: se o valor base OU o de comparação for null (sem
  // dado), não há variação calculável — retorna noData:true (quem
  // consome isto deve exibir "-" no delta, sem seta/cor de favorável ou
  // desfavorável, e excluir o item de rankings). Um 0 real (não-null)
  // segue participando do cálculo normalmente — inclusive como
  // referência (mantém o guard existente contra divisão por zero).
  function calcVariation(actual, reference, nodeId) {
    if (actual === null || actual === undefined || reference === null || reference === undefined) {
      return { pct: null, favorable: null, noData: true };
    }
    if (!reference || reference === 0) return { pct: 0, favorable: true, noData: false };
    const pct = ((actual - reference) / Math.abs(reference)) * 100;
    const higherIsBad = [3, 5];
    const favorable = higherIsBad.includes(nodeId) ? pct <= 0 : pct >= 0;
    return { pct, favorable, noData: false };
  }

  // ── 3. CONSTRUÇÃO DA ÁRVORE (inalterado) ────────────────────
  function buildTree(rows) {
    const map = {};
    const sorted = [...rows].sort((a, b) => a.DisplayOrder - b.DisplayOrder);

    sorted.forEach((row) => {
      map[row.NodeID] = { ...row, children: [], expanded: true };
    });

    let rootId = null;
    sorted.forEach((row) => {
      if (row.ParentID === null) {
        rootId = row.NodeID;
      } else if (map[row.ParentID]) {
        map[row.ParentID].children.push(row.NodeID);
      }
    });

    return { map, rootId };
  }

  // ── 4. GERAÇÃO DE HTML DOS CARDS ────────────────────────────
  function svgDown() {
    return `<svg viewBox="0 0 20 20" fill="none"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function svgRight() {
    return `<svg viewBox="0 0 20 20" fill="none"><path d="M8 5l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function svgArrow(up) {
    return up
      ? `<svg viewBox="0 0 16 16" fill="none" width="10" height="10"><path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg viewBox="0 0 16 16" fill="none" width="10" height="10"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function createNodeElement(node) {
    const isLeaf = node.children.length === 0;

    const vsOrc  = calcVariation(node.VL_PROJ, node.VL_ORC,  node.NodeID);
    const vsLobp = calcVariation(node.VL_PROJ, node.VL_LOBP, node.NodeID);


  const fmtReal = formatValuePlain(
    node.VL_PROJ,
    node.NodeType,
    node.VL_FATOR,
    node.SG_DECIMAL
);

const fmtOrc = formatValuePlain(
    node.VL_ORC,
    node.NodeType,
    node.VL_FATOR,
    node.SG_DECIMAL
);

const fmtLobp = formatValuePlain(
    node.VL_LOBP,
    node.NodeType,
    node.VL_FATOR,
    node.SG_DECIMAL
);

    // Cor de cada delta segue a favorabilidade real (higherIsBad-aware);
    // a seta (↑/↓) segue o sinal bruto da variação. Sem dado (noData) não
    // tem favorável/desfavorável — nem seta, nem %, só "-" em cinza.
    const orcClass  = vsOrc.noData  ? 'nodata' : (vsOrc.favorable  ? 'fav' : 'unfav');
    const lobpClass = vsLobp.noData ? 'nodata' : (vsLobp.favorable ? 'fav' : 'unfav');

    const orcPct  = vsOrc.noData  ? '-' : (vsOrc.pct  >= 0 ? '+' : '') + vsOrc.pct.toFixed(1)  + '%';
    const lobpPct = vsLobp.noData ? '-' : (vsLobp.pct >= 0 ? '+' : '') + vsLobp.pct.toFixed(1) + '%';

    const orcArrow  = vsOrc.noData  ? '' : svgArrow(vsOrc.pct  > 0);
    const lobpArrow = vsLobp.noData ? '' : svgArrow(vsLobp.pct > 0);

    const toggleBtn = isLeaf
      ? `<button class="toggle-btn" disabled>${svgRight()}</button>`
      : `<button class="toggle-btn expanded" id="btn-${node.NodeID}">${svgDown()}</button>`;

    const cardClass = ['card', isLeaf ? 'leaf-card' : ''].filter(Boolean).join(' ');

    const el = document.createElement('div');
    el.className  = 'tree-node';
    el.id         = 'node-' + node.NodeID;
    el.dataset.node   = node.NodeID;
    el.dataset.parent = node.ParentID ?? '';

    // title="" no card-title → tooltip nativo mostra o nome completo
    // quando o texto for truncado com reticências pelo CSS
    //
    // Layout "3 · Data-Dense Elegante" (propostas_cards_vdt_v2.html):
    // grade de 3 valores (LOBP/Bdgt/Fcst) + deltas centralizados
    // "vs Bdgt" / "vs LOBP", sem dot de status nem chip único combinado.
    el.innerHTML = `
      <div class="${cardClass}">
        <div class="card-header">
          <div class="card-header-left">
            <span class="card-status-dot ${orcClass}"></span>
            <div class="card-title" title="${node.IndicatorName}">${node.IndicatorName}</div>
          </div>
          
          ${toggleBtn}
        </div>
        <div class="unit"> ${node.Unit} </div>

        <div class="vals">
          <div class="vg">
            <em data-i18n="lbl.lobp">LOBP</em>
            <span class="num-v">${fmtLobp}</span>
          </div>
          <div class="vg">
            <em data-i18n="lbl.budget">Bdgt</em>
            <span class="num-v">${fmtOrc}</span>
          </div>
          <div class="vg">
            <em data-i18n="lbl.forecast">Fcst</em>
            <span class="num-v">${fmtReal}</span>
          </div>
        </div>
        <div class="drow">
          <span class="drow-item"><i data-i18n="lbl.vs">vs</i><span data-i18n="lbl.lobp">LOBP</span><span class="delta ${lobpClass}">${lobpArrow}${lobpPct}</span></span>
          <span class="drow-item"><i data-i18n="lbl.vs">vs</i><span data-i18n="lbl.bud">Bdgt</span><span class="delta ${orcClass}">${orcArrow}${orcPct}</span></span>
        </div>
      </div>
    `;

    return el;
  }

  // ── 5. LAYOUT COM d3.tree() ─────────────────────────────────
  /**
   * Calcula a posição (coordenadas do "mundo") de cada nó VISÍVEL.
   * - nodeSize([CARD_H + ROW_GAP, CARD_W + COL_GAP]):
   *     1º valor = passo VERTICAL entre irmãos
   *     2º valor = passo HORIZONTAL entre níveis
   *   → para aproximar/afastar os nós, ajuste ROW_GAP e COL_GAP no CFG.
   * - separation(): irmãos = 1; nós de pais diferentes = CFG.COUSIN_SEP.
   * Retorna { NodeID: {x, y} } apenas para nós visíveis (expandidos).
   */
  function computeLayout() {
    const rootH = d3.hierarchy(TREE_MAP[ROOT_ID], (n) =>
      n.expanded && n.children.length
        ? n.children.map((id) => TREE_MAP[id])
        : null
    );

    const layout = d3
      .tree()
      .nodeSize([CFG.CARD_H + CFG.ROW_GAP, CFG.CARD_W + CFG.COL_GAP]) // ← espaçamento
      .separation((a, b) => (a.parent === b.parent ? 1 : CFG.COUSIN_SEP));

    layout(rootH);

    // d3.tree é vertical por padrão; invertemos os eixos para
    // obter uma árvore horizontal (raiz à esquerda):
    //   d.y (profundidade) → nosso X | d.x → nosso Y
    const pos = {};
    rootH.each((d) => {
      pos[d.data.NodeID] = { x: d.y, y: d.x };
    });
    return pos;
  }

  // ── 6. APLICAÇÃO DE POSIÇÕES (com animação CSS) ─────────────
  function getAllDescendants(map, id) {
    const result = [];
    (function walk(nodeId) {
      const node = map[nodeId];
      if (!node) return;
      node.children.forEach((cid) => { result.push(cid); walk(cid); });
    })(id);
    return result;
  }

  function nearestVisibleAncestor(id, pos) {
    let p = TREE_MAP[id] ? TREE_MAP[id].ParentID : null;
    while (p != null && !pos[p]) {
      p = TREE_MAP[p] ? TREE_MAP[p].ParentID : null;
    }
    return p;
  }

  function applyPositions(pos) {
    Object.keys(TREE_MAP).forEach((idStr) => {
      const id = Number(idStr);
      const el = document.getElementById('node-' + id);
      if (!el) return;

      if (pos[id]) {
        el.classList.remove('hidden');
        el.style.left = pos[id].x + 'px';
        el.style.top  = pos[id].y + 'px';
      } else {
        // Nó oculto: anima "para dentro" do ancestral visível mais
        // próximo — efeito de colapso/compactação
        el.classList.add('hidden');
        const anc = nearestVisibleAncestor(id, pos);
        if (anc != null && pos[anc]) {
          el.style.left = pos[anc].x + 'px';
          el.style.top  = pos[anc].y + 'px';
        }
      }
    });

    // Atualiza ícones dos botões toggle
    Object.values(TREE_MAP).forEach((node) => {
      if (node.children.length === 0) return;
      const btn = document.getElementById('btn-' + node.NodeID);
      if (btn) btn.classList.toggle('collapsed', !node.expanded);
    });
  }

  // ── 7. CONECTORES SVG (data-join D3, animados) ──────────────
  // Roteamento ortogonal "em cotovelo": sai reto do nó pai, vira uma
  // única vez no meio do vão entre colunas e chega reto no nó filho —
  // cantos suavizados com um arco curto (Q) em vez de esquinas vivas.
  function roundedElbowPath(sx, sy, tx, ty, r) {
    const mx = sx + (tx - sx) / 2;
    const dy = ty - sy;
    const dir = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
    const rEff = dir === 0 ? 0 : Math.min(r, Math.abs(dy) / 2, Math.abs(mx - sx), Math.abs(tx - mx));
    return (
      `M ${sx} ${sy} ` +
      `L ${mx - rEff} ${sy} ` +
      `Q ${mx} ${sy} ${mx} ${sy + rEff * dir} ` +
      `L ${mx} ${ty - rEff * dir} ` +
      `Q ${mx} ${ty} ${mx + rEff} ${ty} ` +
      `L ${tx} ${ty}`
    );
  }

  function connectorPath(pos, d) {
    // Âncoras: meio da borda direita do pai → meio da borda esquerda do filho
    const sx = pos[d.s].x + CFG.CARD_W;
    const sy = pos[d.s].y + CFG.CARD_H / 2;
    const tx = pos[d.t].x;
    const ty = pos[d.t].y + CFG.CARD_H / 2;
    return roundedElbowPath(sx, sy, tx, ty, 10);
  }

  function drawConnectors(pos) {
    const links = [];
    Object.keys(pos).forEach((idStr) => {
      const id = Number(idStr);
      const n = TREE_MAP[id];
      if (!n || !n.expanded) return;
      n.children.forEach((cid) => {
        if (pos[cid]) links.push({ id: id + '-' + cid, s: id, t: cid });
      });
    });

    const svg = d3.select('#connectorsSvg');
    const sel = svg.selectAll('path.connector-line').data(links, (d) => d.id);

    // Saída: some suavemente
    sel.exit()
      .transition().duration(CFG.ANIM_MS / 2)
      .style('opacity', 0)
      .remove();

    // Atualização: acompanha o novo layout (mesma duração dos cards)
    sel.transition().duration(CFG.ANIM_MS).ease(d3.easeCubicInOut)
      .attr('d', (d) => connectorPath(pos, d))
      .style('opacity', 1);

    // Entrada: nasce colapsado na borda do pai e "cresce" até o filho
    sel.enter()
      .append('path')
      .attr('class', 'connector-line')
      .attr('data-link-id', (d) => d.id)
      .attr('data-source', (d) => d.s)
      .attr('data-target', (d) => d.t)
      .attr('d', (d) => {
        const sx = pos[d.s].x + CFG.CARD_W;
        const sy = pos[d.s].y + CFG.CARD_H / 2;
        return roundedElbowPath(sx, sy, sx, sy, 10);
      })
      .style('opacity', 0)
      .transition().duration(CFG.ANIM_MS).ease(d3.easeCubicInOut)
      .attr('d', (d) => connectorPath(pos, d))
      .style('opacity', 1);
  }

  // ── 7.1 DESTAQUE DE TRAJETÓRIA (hover) ───────────────────────
  // Ao passar o mouse num card, ilumina o caminho raiz → nó (toda a
  // linhagem de ancestrais) + as ligações para os filhos diretos, e
  // esmaece as demais linhas — uma forma mais elegante de "navegar"
  // visualmente pela árvore sem precisar clicar em nada.
  function ancestorChainLinks(nodeId) {
    const ids = [];
    let cur = TREE_MAP[nodeId];
    while (cur && cur.ParentID != null && TREE_MAP[cur.ParentID]) {
      ids.push(cur.ParentID + '-' + cur.NodeID);
      cur = TREE_MAP[cur.ParentID];
    }
    return ids;
  }

  function highlightConnectorPath(nodeId) {
    const node = TREE_MAP[nodeId];
    if (!node) return;

    const activeIds = new Set(ancestorChainLinks(nodeId));
    node.children.forEach((cid) => activeIds.add(nodeId + '-' + cid));

    document.querySelectorAll('#connectorsSvg path.connector-line').forEach((p) => {
      const isActive = activeIds.has(p.getAttribute('data-link-id'));
      p.classList.toggle('is-active', isActive);
      p.classList.toggle('is-dimmed', !isActive);
    });

    // SVG pinta na ordem do DOM: uma linha ativa que veio antes no
    // documento pode ficar por baixo de uma linha esmaecida vizinha,
    // criando um "gap" onde elas se aproximam/cruzam. Reenvia cada
    // trecho ativo para o fim do <svg> para garantir que a trajetória
    // destacada sempre fique por cima de tudo o que está dimmed.
    document.querySelectorAll('#connectorsSvg path.connector-line.is-active').forEach((p) => {
      p.parentNode.appendChild(p);
    });
  }

  function clearConnectorHighlight() {
    document.querySelectorAll('#connectorsSvg path.connector-line').forEach((p) => {
      p.classList.remove('is-active', 'is-dimmed');
    });
  }

  function setupConnectorHighlight() {
    // Delegação (mouseover/mouseout bubbleiam; mouseenter/mouseleave não) —
    // mesmo efeito de hover por nó, sem 1 par de listeners por card.
    const canvas = document.getElementById('treeCanvas');
    if (!canvas) return;
    canvas.addEventListener('mouseover', (e) => {
      const nodeEl = e.target.closest('.tree-node');
      if (!nodeEl || nodeEl.contains(e.relatedTarget)) return;
      highlightConnectorPath(Number(nodeEl.dataset.node));
    });
    canvas.addEventListener('mouseout', (e) => {
      const nodeEl = e.target.closest('.tree-node');
      if (!nodeEl || nodeEl.contains(e.relatedTarget)) return;
      clearConnectorHighlight();
    });
  }

  // ── 8. ZOOM / PAN / FIT-TO-VIEW (d3.zoom) ───────────────────
  let zoomBehavior = null;
  let viewportSel  = null;
  let worldSel     = null;

  function setupZoom() {
    viewportSel = d3.select('#treeViewport');
    worldSel    = d3.select('#treeWorld');

    zoomBehavior = d3.zoom()
      .scaleExtent([CFG.ZOOM_MIN, CFG.ZOOM_MAX]) // ← limites de zoom
      .clickDistance(6) // evita toggle acidental ao terminar um arrasto sobre um card
      .on('zoom', (event) => {
        const t = event.transform;
        // O transform do d3.zoom é aplicado ao contêiner "mundo"
        // (equivalente ao viewBox dinâmico, porém com cards HTML)
        worldSel.style('transform', `translate(${t.x}px, ${t.y}px) scale(${t.k})`);
      })
      .on('end', forceCrispRepaint);

    viewportSel.call(zoomBehavior).on('dblclick.zoom', null);
  }

  /**
   * O navegador mantém o #treeWorld como uma textura rasterizada
   * (por causa do will-change:transform) e só re-rasteriza em
   * definição nativa depois de alguns segundos ocioso — por isso o
   * texto dos cards fica embaçado logo após um zoom/pan e demora a
   * "afiar" sozinho. Ao soltar o gesto (evento 'end' do d3.zoom),
   * tiramos e devolvemos o will-change: isso descarta a textura em
   * cache e força um repaint imediato na resolução correta, em vez
   * de esperar a heurística do navegador.
   */
  function forceCrispRepaint() {
    if (!worldSel) return;
    worldSel.style('will-change', 'auto');
    void worldSel.node().offsetHeight; // força reflow síncrono
    worldSel.style('will-change', 'transform');
  }

  function boundsOf(ids, pos) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach((id) => {
      const p = pos[id];
      if (!p) return;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + CFG.CARD_W > maxX) maxX = p.x + CFG.CARD_W;
      if (p.y + CFG.CARD_H > maxY) maxY = p.y + CFG.CARD_H;
    });
    return { minX, minY, maxX, maxY };
  }

  /**
   * Largura (px) ocupada pelo painel "Top 15 Perdas" à esquerda do
   * viewport (+ respiro), lida em tempo real do layout renderizado —
   * sem constante fixa, então acompanha sozinha as larguras responsivas
   * definidas no CSS. Usada pra centralizar/enquadrar a árvore só no
   * espaço "livre" à direita do painel, evitando nascer escondida atrás
   * dele. Retorna 0 se o painel não existir ou estiver oculto (mobile).
   */
  function getReservedLeftPx() {
    const panel = document.getElementById('lossPanel');
    const vp = document.getElementById('treeViewport');
    if (!panel || !vp || window.getComputedStyle(panel).display === 'none') return 0;
    const panelRect = panel.getBoundingClientRect();
    const vpRect = vp.getBoundingClientRect();
    return Math.max(0, panelRect.right - vpRect.left + 16);
  }

  /**
   * Reenquadra a viewport para conter (e centralizar) o bounding box `b`.
   * A escala respeita FIT_MAX_SCALE (não aproxima demais) e ZOOM_MIN.
   */
  function zoomToBounds(b, animate = true) {
    if (!isFinite(b.minX)) return;
    const vp = document.getElementById('treeViewport');
    const reserved = getReservedLeftPx();
    const vw = vp.clientWidth - reserved;
    const vh = vp.clientHeight;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);

    let k = Math.min(
      (vw - CFG.FIT_PADDING * 2) / bw,
      (vh - CFG.FIT_PADDING * 2) / bh
    );
    k = Math.max(CFG.ZOOM_MIN, Math.min(CFG.FIT_MAX_SCALE, k));

    const tx = reserved + vw / 2 - k * (b.minX + bw / 2);
    const ty = vh / 2 - k * (b.minY + bh / 2);
    const t  = d3.zoomIdentity.translate(tx, ty).scale(k);

    if (animate) {
      viewportSel
        .transition()
        .duration(CFG.ZOOM_ANIM_MS)          // ← duração do reenquadramento
        .ease(d3.easeCubicInOut)
        .call(zoomBehavior.transform, t);
    } else {
      viewportSel.call(zoomBehavior.transform, t);
    }
  }

  function fitAll(animate = true) {
    zoomToBounds(boundsOf(Object.keys(CURRENT_POS).map(Number), CURRENT_POS), animate);
  }

  /**
   * Centraliza um nó específico no meio da viewport, na escala k.
   * Usado na abertura para posicionar o nó raiz centralizado na página.
   */
  function centerNode(id, k = CFG.INITIAL_SCALE, animate = true) {
    const p = CURRENT_POS[id];
    if (!p) { fitAll(animate); return; }
    const vp = document.getElementById('treeViewport');
    const reserved = getReservedLeftPx();
    const availW = vp.clientWidth - reserved;
    const cx = p.x + CFG.CARD_W / 2;
    const cy = p.y + CFG.CARD_H / 2;
    const t  = d3.zoomIdentity
      .translate(reserved + availW / 2 - k * cx, vp.clientHeight / 2 - k * cy)
      .scale(k);
    if (animate) {
      viewportSel.transition().duration(CFG.ZOOM_ANIM_MS).ease(d3.easeCubicInOut)
        .call(zoomBehavior.transform, t);
    } else {
      viewportSel.call(zoomBehavior.transform, t);
    }
  }

  // ── 9. UPDATE: relayout + conectores + reenquadramento ──────
  let CURRENT_POS = {};

  function update(focusId) {
    const pos = computeLayout();
    CURRENT_POS = pos;

    applyPositions(pos);
    drawConnectors(pos);

    // Zoom-to-fit com foco:
    //  - Expansão → enquadra o nó clicado + subárvore recém-aberta
    //  - Colapso  → reenquadra a árvore visível inteira (compacta de volta)
    if (focusId != null && TREE_MAP[focusId] && TREE_MAP[focusId].expanded && pos[focusId]) {
      const ids = [focusId, ...getAllDescendants(TREE_MAP, focusId)].filter((id) => pos[id]);
      zoomToBounds(boundsOf(ids, pos));
    } else {
      fitAll();
    }
  }

  // ── 10. EXPAND / COLLAPSE ───────────────────────────────────
  function toggleNode(id) {
    const node = TREE_MAP[id];
    if (!node || node.children.length === 0) return;

    node.expanded = !node.expanded;

    if (!node.expanded) {
      getAllDescendants(TREE_MAP, id).forEach((did) => {
        if (TREE_MAP[did]) TREE_MAP[did].expanded = false;
      });
    }

    update(id);
  }

  // ── 11. EVENTOS ─────────────────────────────────────────────
  function attachEvents() {
    // Delegação de evento único no canvas em vez de 1 listener por card/botão
    // (152 nós × 2 = ~300 listeners antes) — mesmo comportamento, menos
    // memória e menos trabalho de binding no boot da árvore. Os cards nunca
    // são removidos do DOM (só ganham/perdem .hidden), então a delegação
    // continua válida durante toda a vida da página.
    const canvas = document.getElementById('treeCanvas');
    if (canvas) {
      canvas.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn:not([disabled])');
        if (btn) {
          e.stopPropagation();
          const nodeEl = btn.closest('.tree-node');
          if (nodeEl) toggleNode(Number(nodeEl.dataset.node));
          return;
        }
        const card = e.target.closest('.card:not(.leaf-card)');
        if (card) {
          const nodeEl = card.closest('.tree-node');
          if (nodeEl) toggleNode(Number(nodeEl.dataset.node));
        }
      });
    }

    // Controles de zoom (+ / − / fit)
    const zi = document.getElementById('zoomInBtn');
    const zo = document.getElementById('zoomOutBtn');
    const zf = document.getElementById('zoomFitBtn');
    if (zi) zi.addEventListener('click', () =>
      viewportSel.transition().duration(200).call(zoomBehavior.scaleBy, 1.25));
    if (zo) zo.addEventListener('click', () =>
      viewportSel.transition().duration(200).call(zoomBehavior.scaleBy, 0.8));
    if (zf) zf.addEventListener('click', () => fitAll());
  }

  // ── 12. RESIZE ──────────────────────────────────────────────
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => fitAll(false), 120);
  });

  // ── 12.1 TEMA — Branco / Business ────────────────────────────
  // Mesmo mecanismo do design_system_NEW.html: persiste em
  // localStorage, aplica via atributo data-bg no <body> (as regras
  // vivem em style.css) e só liga a transição suave depois do 1º
  // paint, pra não piscar na carga inicial da página.
  const THEME_KEY = 'vdt-theme';

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.dataset.bg = isDark ? 'dark' : '';
    const btnWhite = document.getElementById('btnWhite');
    const btnBusiness = document.getElementById('btnBusiness');
    if (btnWhite) btnWhite.classList.toggle('active', !isDark);
    if (btnBusiness) btnBusiness.classList.toggle('active', isDark);
  }

  function setupThemeToggle() {
    const btnWhite = document.getElementById('btnWhite');
    const btnBusiness = document.getElementById('btnBusiness');
    // Sem os botões na página (ex.: Index2.html), o seletor de tema
    // não existe aqui — não aplica nada, mesmo que outra página do
    // mesmo domínio tenha salvo "dark" no localStorage.
    if (!btnWhite && !btnBusiness) return;

    let saved = 'light';
    try { saved = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) {}

    applyTheme(saved);
    // Limpa o fallback inline aplicado no <head> antes do 1º paint
    document.documentElement.style.background = '';

    btnWhite && btnWhite.addEventListener('click', () => {
      applyTheme('light');
      try { localStorage.setItem(THEME_KEY, 'light'); } catch (e) {}
    });
    btnBusiness && btnBusiness.addEventListener('click', () => {
      applyTheme('dark');
      try { localStorage.setItem(THEME_KEY, 'dark'); } catch (e) {}
    });

    // Ativa a transição suave só depois do 1º paint já estar pintado
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add('theme-ready');
    }));
  }

  // ── 13. FILTRO (VDT) ─────────────────────────────────────────
  // O <select id="cmbVDT"> é nativo: por natureza só permite escolher
  // 1 valor por vez (não é multi-select), então "o usuário é obrigado
  // a escolher apenas um valor" já é garantido pelo próprio elemento.
  // Aqui só populamos as opções com dados reais (vindos de
  // /api/filtros-vdt) e garantimos que ele SEMPRE nasce com um valor
  // selecionado (o primeiro da lista), nunca em branco.
  async function loadVDTFiltros() {
    const select = document.getElementById('cmbVDT');
    if (!select) return;

    try {
      const res = await fetch('/api/filtros-vdt');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();

      // server.js devolve linhas no formato { NM_VDT: '...' }
      const valores = (Array.isArray(rows) ? rows : [])
        .map((r) => r && r.NM_VDT)
        .filter((v) => v != null && String(v).trim() !== '');

      if (valores.length === 0) {
        console.warn('[VDT] /api/filtros-vdt não retornou valores; mantendo opções fixas do HTML.');
        return;
      }

      select.innerHTML = valores
        .map((v) => `<option value="${v}">${v}</option>`)
        .join('');

      // Sempre inicia com o primeiro valor da lista selecionado.
      select.value = valores[0];
    } catch (err) {
      // Falhou a busca da lista de filtros: mantém as opções fixas que
      // já vieram no HTML (fallback), pra tela não ficar sem nenhuma opção.
      console.error('[VDT] Erro ao carregar lista de VDTs, mantendo opções fixas do HTML:', err);
    }
  }

  function showViewportError(msg) {
    clearViewportError();
    const vp = document.getElementById('treeViewport');
    if (vp) vp.insertAdjacentHTML('beforeend',
      `<div id="treeErrorBox" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5A6A7E;font-size:13px;padding:24px;text-align:center;">${msg}</div>`);
  }

  function clearViewportError() {
    const box = document.getElementById('treeErrorBox');
    if (box) box.remove();
  }

  // Liga o filtro (VDT): ao trocar a opção do combo, já busca de novo
  // os dados (agora com o NM_VDT selecionado) e reconstrói a árvore do
  // zero — sem precisar de um botão "Aplicar Filtro" separado. O select
  // em si fica oculto (ver .vdt-dropdown); quem dá feedback visual de
  // "carregando" pro usuário é o botão-gatilho.
  function attachFilterEvents() {
    const select  = document.getElementById('cmbVDT');
    const trigger = document.getElementById('vdtTrigger');
    if (!select) return;

    select.addEventListener('change', async () => {
      if (select.disabled) return;
      select.disabled = true;
      if (trigger) trigger.disabled = true;
      try {
        await loadTreeAndRender({ isReload: true });
      } finally {
        select.disabled = false;
        if (trigger) trigger.disabled = false;
      }
    });
  }

  // ── 13.0.5 DROPDOWN CUSTOMIZADO DO FILTRO VDT ────────────────
  // O <select id="cmbVDT"> continua sendo a fonte de dados/eventos
  // (loadVDTFiltros/attachFilterEvents não mudam nada); este bloco só
  // desenha por cima um botão + lista customizados, cuja lista aberta
  // omite a VDT atualmente aplicada — algo impossível com um <select>
  // nativo puro, já que o rótulo fechado dele é sempre também um item
  // da própria lista.
  function syncVdtTriggerLabel() {
    const select = document.getElementById('cmbVDT');
    const label  = document.getElementById('vdtTriggerLabel');
    if (!select || !label) return;
    const opt = select.options[select.selectedIndex];
    label.textContent = (opt && opt.text.trim()) || select.value;
  }

  // Monta a lista só com as opções DIFERENTES da atualmente selecionada
  // — chamado sempre de novo a cada abertura, pra refletir trocas feitas
  // por loadVDTFiltros() entretanto.
  function renderVdtDropdownList() {
    const select = document.getElementById('cmbVDT');
    const list   = document.getElementById('vdtDropdownList');
    if (!select || !list) return;
    const current = select.value;
    list.innerHTML = Array.from(select.options)
      .filter((opt) => opt.value !== current)
      .map((opt) => `<li class="vdt-option" role="option" tabindex="0" data-value="${opt.value.replace(/"/g, '&quot;')}">${opt.text}</li>`)
      .join('');
  }

  function attachVdtDropdownEvents() {
    const select   = document.getElementById('cmbVDT');
    const dropdown = document.getElementById('vdtDropdown');
    const trigger  = document.getElementById('vdtTrigger');
    const list     = document.getElementById('vdtDropdownList');
    if (!select || !dropdown || !trigger || !list) return;

    function openList() {
      if (trigger.disabled) return;
      renderVdtDropdownList();
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      dropdown.classList.add('open');
    }
    function closeList() {
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      dropdown.classList.remove('open');
    }
    function selectValue(value) {
      if (!value || value === select.value) { closeList(); return; }
      select.value = value;
      // dispatchEvent (não .click()) já dispara o listener 'change' de
      // attachFilterEvents() normalmente — mesmo caminho de sempre pra
      // recarregar a árvore, sem duplicar lógica aqui.
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closeList();
      trigger.focus();
    }

    trigger.addEventListener('click', () => {
      dropdown.classList.contains('open') ? closeList() : openList();
    });

    list.addEventListener('click', (e) => {
      const li = e.target.closest('.vdt-option');
      if (li) selectValue(li.dataset.value);
    });
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const li = e.target.closest('.vdt-option');
      if (li) { e.preventDefault(); selectValue(li.dataset.value); }
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) closeList();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('open')) {
        closeList();
        trigger.focus();
      }
    });

    select.addEventListener('change', syncVdtTriggerLabel);
  }

  // ── 13.1 PAINEL "PERDAS & GANHOS" ─────────────────────────────
  // Painel fixo à esquerda do tree-viewport (não sofre o pan/zoom da
  // árvore — é irmão de .tree-world, igual ao badge de título). Reusa
  // os mesmos dados já buscados pra árvore (TREE_MAP), já filtrados
  // pelo VDT selecionado: nenhuma consulta nova ao Databricks é feita
  // aqui. O combo de comparação (Fcst×Bdgt / Fcst×LOBP / Bdgt×LOBP) e a
  // ordenação (maior/menor impacto) só recalculam este painel — os
  // cards da árvore continuam mostrando os dois deltas fixos de sempre
  // (vs LOBP / vs Bdgt).
  const LOSS_COMPARE_DEFS = {
    fcst_bdgt: { actualKey: 'VL_PROJ', referenceKey: 'VL_ORC' },
    fcst_lobp: { actualKey: 'VL_PROJ', referenceKey: 'VL_LOBP' },
    bdgt_lobp: { actualKey: 'VL_ORC', referenceKey: 'VL_LOBP' },
  };
  let lossCompareKey = 'fcst_bdgt';
  // 'asc' (padrão) = maiores perdas → menores perdas → menores ganhos →
  // maiores ganhos (transição contínua cruzando o zero — é a leitura
  // "natural" do painel: começa no problema mais grave, termina no
  // melhor resultado). 'desc' = espelho exato dessa sequência.
  let lossSortDir = 'asc';
  // Indicadores de tempo ficam visíveis por padrão (troca de filtro é
  // opt-in: adicionar o filtro não deve mudar o que já aparecia antes
  // dele existir).
  let lossShowTimeIndicators = true;

  // Nomes dos até `maxLevels` ancestrais de `node` na árvore, do pai
  // mais próximo pro mais distante (ex.: ["Copper Concentrate",
  // "Copper Concentrate (Dry)", "Copper Contained", "Run of Plant"]) —
  // dá contexto de onde um indicador-folha se encaixa na hierarquia,
  // sem precisar abrir/navegar a árvore pra descobrir.
  function getAncestorPath(node, maxLevels) {
    const path = [];
    let parentId = node && node.ParentID;
    while (path.length < maxLevels && parentId !== null && parentId !== undefined) {
      const parent = TREE_MAP[parentId];
      if (!parent) break;
      path.push(parent.IndicatorName);
      parentId = parent.ParentID;
    }
    return path;
  }

  // Remove parênteses externos de uma unidade, se houver — a coluna
  // Unit no Databricks às vezes já vem como "(h/y)"/"(%)" prontos, então
  // qualquer lugar que precise do texto "cru" da unidade (pra comparar
  // ou pra remontar o parêntese na exibição) passa por aqui primeiro.
  function stripUnitParens(unit) {
    const trimmed = String(unit || '').trim();
    return trimmed.replace(/^\(([\s\S]*)\)$/, '$1').trim();
  }

  // Fonte única da verdade pra "é indicador de tempo?": a unidade de
  // medida (node.Unit) que já vem do Databricks — nenhuma lista fixa de
  // nomes de indicador no front-end, válida igual em qualquer VDT (a
  // regra não depende de qual árvore está selecionada). Cobre:
  //   - "hora"/"horas" por extenso, em qualquer posição (ex.: "Horas/Ano")
  //   - abreviação isolada: h, hh, hr, hrs
  //   - taxa com hora no numerador: h/y, hr/y, hrs/mês, h/d... (com ou
  //     sem espaço ao redor da barra)
  //   - taxa com hora no denominador: un/h, 1/hr...
  function isTimeIndicator(node) {
    const unit = stripUnitParens(node && node.Unit).toLowerCase();
    if (!unit) return false;
    if (unit.includes('hora')) return true;
    if (/^h{1,2}(r|rs)?$/.test(unit)) return true;
    if (/^h(r|rs)?\s*\//.test(unit)) return true;
    if (/\/\s*h(r|rs)?$/.test(unit)) return true;
    return false;
  }

  // Todo nó-folha com variação CALCULÁVEL (nem valor-base nem
  // valor-comparação nulos — calcVariation.noData) na comparação ativa
  // entra na lista, seja perda (desfavorável) ou ganho (favorável). Item
  // sem dado suficiente simplesmente não aparece (não é "perda zero").
  // Indicador de tempo some por completo (lista, ranking e gráfico)
  // quando o filtro "Apresentar Indicadores de Tempo" está em "Não".
  function computeVarianceEntries(map, compareKey) {
    const def = LOSS_COMPARE_DEFS[compareKey] || LOSS_COMPARE_DEFS.fcst_bdgt;

    return Object.values(map)
      .filter((node) => node && node.children.length === 0)
      .filter((node) => lossShowTimeIndicators || !isTimeIndicator(node))
      .map((node) => {
        const actual    = node[def.actualKey];
        const reference = node[def.referenceKey];
        const variation = calcVariation(actual, reference, node.NodeID);
        const rawDelta  = variation.noData ? null : Math.abs(actual - reference);
        return { node, actual, reference, variation, rawDelta };
      })
      .filter((entry) => !entry.variation.noData && entry.rawDelta > 0);
  }

  function renderLossPanel() {
    const list = document.getElementById('lossList');
    if (!list || !ROOT_ID) return;

    const entries = computeVarianceEntries(TREE_MAP, lossCompareKey);

    if (entries.length === 0) {
      list.innerHTML = `<div class="loss-empty" data-i18n="loss.empty">Nenhuma perda ou ganho neste comparativo.</div>`;
      return;
    }

    // Classificação (ordenação + tamanho da barra) é sempre pelo
    // PERCENTUAL, não pelo valor bruto: a lista mistura indicadores de
    // unidades muito diferentes (h/y, g/t, %, t...), então comparar
    // magnitude bruta entre eles não tem significado — 1.777 h/y não é
    // "maior impacto" que -52% de recuperação só por ter mais dígitos.
    // O percentual é a única medida comparável entre indicadores.
    const maxPct = Math.max(...entries.map((e) => Math.abs(e.variation.pct)));

    // Ordenação por percentual COM SINAL (perda = negativo, ganho =
    // positivo, seguindo a favorabilidade real — não o sinal bruto do
    // pct, que se inverte pra nós com a heurística higherIsBad).
    // Crescente (asc): maiores perdas % → menores perdas % → menores
    // ganhos % → maiores ganhos %, transição contínua cruzando o zero.
    // Decrescente (desc) é o espelho exato.
    const sorted = [...entries].sort((a, b) => {
      const signedA = a.variation.favorable ? Math.abs(a.variation.pct) : -Math.abs(a.variation.pct);
      const signedB = b.variation.favorable ? Math.abs(b.variation.pct) : -Math.abs(b.variation.pct);
      return lossSortDir === 'asc' ? signedA - signedB : signedB - signedA;
    });

    list.innerHTML = sorted.map(({ node, actual, reference, variation, rawDelta }) => {
      const fmtDelta     = formatValuePlain(rawDelta,   node.NodeType, node.VL_FATOR, node.SG_DECIMAL);
      const fmtActual    = formatValuePlain(actual,     node.NodeType, node.VL_FATOR, node.SG_DECIMAL);
      const fmtReference = formatValuePlain(reference,  node.NodeType, node.VL_FATOR, node.SG_DECIMAL);
      const pctText   = formatPercentPtBR(variation.pct);
      const widthPct  = maxPct > 0 ? Math.max(4, (Math.abs(variation.pct) / maxPct) * 100) : 0;
      const kindClass = variation.favorable ? 'is-gain' : 'is-loss';
      const sign      = variation.favorable ? '+' : '−';
      // Nome + unidade cadastrada no Databricks (node.Unit) — sem unidade
      // cadastrada, mostra só o nome do indicador. A unidade às vezes já
      // vem com parênteses da própria base ("(h/y)"); stripUnitParens
      // evita duplicar ("((h/y))") reaproveitando sempre um único par.
      // Termina com o ID do nó ("N16") — referência rápida pra localizar
      // o registro exato na tabela do Databricks.
      const unitLabel  = stripUnitParens(node.Unit);
      const displayName = `${unitLabel ? `${node.IndicatorName} (${unitLabel})` : node.IndicatorName} - N${node.NodeID}`;

      // Caminho até 5 níveis acima na árvore (pai mais próximo primeiro),
      // dá contexto de ONDE esse indicador-folha está — só nomes, sem
      // unidade/ID, pra não poluir o tooltip.
      const ancestors = getAncestorPath(node, 5);
      const breadcrumb = ancestors.length ? `\n${ancestors.join(' >> ')}` : '';

      const tooltip = `${displayName}${breadcrumb}\n${fmtActual} vs ${fmtReference} (${pctText})\nDiferença: ${fmtDelta}`
        .replace(/"/g, '&quot;');

      return `
        <div class="loss-row ${kindClass}" title="${tooltip}">
          <div class="loss-row-top">
            <span class="loss-row-name">${displayName}</span>
            <span class="loss-row-value">${sign}${fmtDelta} <span class="loss-row-pct">(${pctText})</span></span>
          </div>
          <div class="loss-row-bar-track">
            <div class="loss-row-bar" style="width:${widthPct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function attachLossPanelEvents() {
    const select = document.getElementById('lossCompareSelect');
    if (select) {
      select.value = lossCompareKey;
      select.addEventListener('change', () => {
        lossCompareKey = select.value;
        renderLossPanel();
      });
    }

    const sortBtns = Array.from(document.querySelectorAll('.loss-sort-btn'));
    sortBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.sort === lossSortDir) return;
        lossSortDir = btn.dataset.sort;
        sortBtns.forEach((b) => b.classList.toggle('active', b.dataset.sort === lossSortDir));
        renderLossPanel();
      });
    });

    const timeBtns = Array.from(document.querySelectorAll('.loss-time-btn'));
    timeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const show = btn.dataset.time === 'show';
        if (show === lossShowTimeIndicators) return;
        lossShowTimeIndicators = show;
        timeBtns.forEach((b) => b.classList.toggle('active', b.dataset.time === (show ? 'show' : 'hide')));
        renderLossPanel();
      });
    });
  }

  // ── 14. INIT ────────────────────────────────────────────────
  let TREE_MAP = {};
  let ROOT_ID  = null;

  /**
   * Busca os dados (respeitando o NM_VDT selecionado no combo) e
   * (re)constrói a árvore inteira. Usada tanto no boot inicial quanto
   * toda vez que o usuário troca o filtro VDT.
   */
  async function loadTreeAndRender({ isReload = false } = {}) {
    const canvas = document.getElementById('treeCanvas');

    let rawData;
    try {
      rawData = await fetchTreeData();
    } catch (err) {
      console.error('[VDT] Erro ao carregar dados da tabela:', err);
      showViewportError(`Erro ao carregar dados da tabela: ${err.message}`);
      return false;
    }

    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.error('[VDT] /api/tree não retornou nenhuma linha.');
      showViewportError('Nenhum dado retornado pela tabela para o filtro selecionado.');
      return false;
    }

    clearViewportError();

    // Ao reaplicar o filtro, descarta os cards/conectores da árvore
    // anterior antes de montar a nova (o boot inicial já começa vazio).
    canvas.innerHTML = '';
    d3.select('#connectorsSvg').selectAll('*').remove();

    const { map, rootId } = buildTree(rawData);
    TREE_MAP = map;
    ROOT_ID  = rootId;

    // Recalcula o painel "Top 15 Perdas" com os dados recém-carregados
    // (já filtrados pelo VDT atual) e o comparativo ativo no combo.
    renderLossPanel();

    // Estado inicial de expansão limitado a CFG.INITIAL_DEPTH níveis
    const queue = [{ id: rootId, d: 0 }];
    while (queue.length) {
      const { id, d } = queue.shift();
      map[id].expanded = d < CFG.INITIAL_DEPTH;
      map[id].children.forEach((cid) => queue.push({ id: cid, d: d + 1 }));
    }

    // Cria TODOS os elementos uma única vez (visibilidade via classe .hidden)
    Object.values(map).forEach((node) => canvas.appendChild(node && createNodeElement(node)));

    // Mede a altura real do card renderizado e corrige o CFG
    // (layout e âncoras dos conectores ficam exatos)
    const sample = canvas.querySelector('.card');
    if (sample && sample.offsetHeight > 0) CFG.CARD_H = sample.offsetHeight;

    // 1º layout SEM transição (evita cards "voando" de 0,0)
    const pos = computeLayout();
    CURRENT_POS = pos;
    applyPositions(pos);
    drawConnectors(pos);

    // Enquadramento: nó RAIZ centralizado na página. No boot inicial é
    // síncrono (sem animação); ao reaplicar filtro, anima suavemente.
    centerNode(ROOT_ID, CFG.INITIAL_SCALE, isReload);

    // Habilita as transições de posição APENAS após o 1º posicionamento
    // já estar pintado. Duração sincronizada com CFG.ANIM_MS.
    setTimeout(() => {
      document.querySelectorAll('.tree-node').forEach((el) => {
        el.style.transition =
          `left ${CFG.ANIM_MS}ms cubic-bezier(0.65,0,0.35,1), ` +
          `top ${CFG.ANIM_MS}ms cubic-bezier(0.65,0,0.35,1), ` +
          `opacity 300ms ease, transform 300ms ease`;
      });
    }, 60);

    return true;
  }

  async function init() {
    // setupZoom/attachEvents/setupConnectorHighlight não dependem dos
    // dados — ligam 1 única vez, antes do 1º carregamento da árvore
    // (centerNode(), chamado dentro de loadTreeAndRender, já precisa
    // do zoomBehavior existir).
    setupZoom();
    attachEvents();
    setupConnectorHighlight();

    // Popula o combo com os valores reais de NM_VDT vindos do backend
    // (com fallback pras opções fixas do HTML se a busca falhar) e já
    // deixa o 1º valor selecionado.
    await loadVDTFiltros();

    attachFilterEvents();
    attachVdtDropdownEvents();
    syncVdtTriggerLabel(); // reflete o valor real definido por loadVDTFiltros()
    attachLossPanelEvents();

    await loadTreeAndRender();
  }

  // ── 14. BOOT ────────────────────────────────────────────────
  // Guard: garante que o D3 carregou antes de iniciar. Sem isso,
  // um 404 no script do D3 deixava todos os cards empilhados em
  // (0,0), pois o init() quebrava antes de posicionar os nós.
  function boot() {
    setupThemeToggle(); // independente do D3 — funciona mesmo se a árvore falhar
    if (typeof d3 === 'undefined') {
      // Fallback: tenta o CDN caso o arquivo local d3.v7.min.js falte
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
      s.onload = init;
      s.onerror = () => {
        console.error('[VDT] D3 não carregou. Verifique se o arquivo d3.v7.min.js está na raiz do projeto.');
        const vp = document.getElementById('treeViewport');
        if (vp) vp.insertAdjacentHTML('beforeend',
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5A6A7E;font-size:13px;">Erro: biblioteca D3 não carregada (d3.v7.min.js ausente).</div>');
      };
      document.head.appendChild(s);
      return;
    }
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
