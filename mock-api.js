/* ─────────────────────────────────────────────────────────────────
   MODO SIMULADO (hospedagem estática, ex.: GitHub Pages)

   O GitHub Pages só entrega arquivos estáticos: não existe server.js
   nem Databricks por trás. Este arquivo substitui o backend dentro do
   próprio navegador — intercepta as chamadas a /api/* e responde com
   dados FICTÍCIOS, no mesmo formato e com as mesmas regras de negócio
   do server.js (cascata Árvore → Ano → Visão, ano anterior só "Actual").

   Só é carregado quando a página roda em *.github.io ou com ?mock=1
   na URL (ver o <head> do index.html). No Databricks App ele nem é
   baixado, e o app.js não sabe que ele existe.

   Nenhum número aqui é real: os valores são gerados por um sorteio
   determinístico (mesma VDT + ano + visão → sempre os mesmos números).
   ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ANO_ATUAL = new Date().getFullYear();

  // [NodeID, ParentID, nome, unidade, casas decimais, valor-base]
  var ARVORES = {
    'Demo - Produção da Usina': [
      [1, null, 'Produção de Concentrado', '(kt)', 1, 820],
      [2, 1, 'Massa Alimentada', '(kt)', 0, 23500],
      [3, 1, 'Perda de Processo', '(%)', 2, 12.4],
      [4, 1, 'Recuperação Metalúrgica', '(%)', 2, 86.5],
      [5, 2, 'Horas Paradas', '(h)', 0, 1180],
      [6, 2, 'Taxa de Alimentação', '(t/h)', 0, 3100],
      [7, 2, 'Horas Trabalhadas', '(h)', 0, 7580],
      [8, 7, 'Disponibilidade Física', '(%)', 1, 92.3],
      [9, 7, 'Utilização Física', '(%)', 1, 93.8],
      [10, 5, 'Manutenção Corretiva', '(h)', 0, 410],
      [11, 5, 'Manutenção Preventiva', '(h)', 0, 520],
      [12, 5, 'Paradas Operacionais', '(h)', 0, 250],
      [13, 4, 'Teor de Alimentação', '(%)', 2, 0.68],
      [14, 4, 'Teor do Concentrado', '(%)', 2, 37.5],
      [15, 6, 'Britagem Primária', '(t/h)', 0, 3350],
      [16, 6, 'Moagem', '(t/h)', 0, 3100],
      [17, 16, 'Moinho 1', '(t/h)', 0, 1580],
      [18, 16, 'Moinho 2', '(t/h)', 0, 1520],
      [19, 3, 'Perda na Flotação', '(%)', 2, 8.1],
      [20, 3, 'Perda no Rejeito', '(%)', 2, 4.3],
    ],
    'Demo - Produção da Mina': [
      [1, null, 'Movimentação Total', '(kt)', 0, 96000],
      [2, 1, 'Minério Lavrado', '(kt)', 0, 24800],
      [3, 1, 'Estéril Removido', '(kt)', 0, 71200],
      [4, 2, 'Produtividade de Carga', '(t/h)', 0, 4200],
      [5, 2, 'Horas Paradas de Carga', '(h)', 0, 1420],
      [6, 2, 'Horas Trabalhadas de Carga', '(h)', 0, 5900],
      [7, 3, 'Produtividade de Transporte', '(t/h)', 0, 510],
      [8, 3, 'Frota em Operação', '(un)', 0, 34],
      [9, 3, 'Distância Média de Transporte', '(km)', 2, 4.85],
      [10, 6, 'Disponibilidade Física', '(%)', 1, 88.6],
      [11, 6, 'Utilização Física', '(%)', 1, 81.2],
      [12, 4, 'Escavadeiras', '(t/h)', 0, 2900],
      [13, 4, 'Carregadeiras', '(t/h)', 0, 1300],
    ],
  };

  var VDTS = Object.keys(ARVORES).sort();
  var ANOS = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];

  // Gerador pseudoaleatório determinístico (mulberry32) semeado por texto.
  function sorteio(semente) {
    var h = 1779033703;
    for (var i = 0; i < semente.length; i++) {
      h = Math.imul(h ^ semente.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    var a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function arredonda(valor, casas) {
    var f = Math.pow(10, casas);
    return Math.round(valor * f) / f;
  }

  function visoesDe(ano) {
    return ano < ANO_ATUAL ? ['Actual'] : ['Actual', 'Forecast'];
  }

  function arvoreDe(vdt, ano, visao) {
    var nos = ARVORES[vdt];
    if (!nos) return [];
    if (ano !== null && ANOS.indexOf(ano) === -1) return [];
    if (visao && visoesDe(ano === null ? ANO_ATUAL : ano).indexOf(visao) === -1) return [];

    // Orçado e LOBP dependem só de VDT+ano (não mudam entre Actual e
    // Forecast); o projetado/realizado muda com a Visão.
    var base = sorteio(vdt + '|' + ano);
    var proj = sorteio(vdt + '|' + ano + '|' + (visao || 'Actual'));

    return nos.map(function (n, i) {
      var casas = n[4];
      var orc = n[5] * (0.97 + base() * 0.06);
      var lobp = orc * (0.96 + base() * 0.08);
      var real = orc * (0.90 + proj() * 0.18);
      var vlProj = arredonda(real, casas);
      var vlOrc = arredonda(orc, casas);
      return {
        NodeID: n[0],
        ParentID: n[1],
        IndicatorName: n[2],
        NM_VDT: vdt,
        Unit: n[3],
        VL_FATOR: 1,
        SG_DECIMAL: casas,
        DisplayOrder: i + 1,
        VL_PROJ: vlProj,
        VL_ORC: vlOrc,
        VL_LOBP: arredonda(lobp, casas),
        VL_DIF_PROJ_ORC: arredonda(vlProj - vlOrc, casas),
      };
    });
  }

  function anoDe(params) {
    var bruto = params.get('ano');
    if (bruto === null || bruto === '') return null;
    var n = parseInt(bruto, 10);
    return Number.isNaN(n) ? null : n;
  }

  // Mesmas rotas do server.js. Devolve [status, corpo].
  function responder(rota, params) {
    var vdt = params.get('nm_vdt') || null;

    if (rota === '/api/test') return [200, { status: 'ok', simulado: true }];

    if (rota === '/api/filtros-vdt') {
      return [200, VDTS.map(function (v) { return { NM_VDT: v }; })];
    }

    if (rota === '/api/filtros-ano') {
      var anos = !vdt || ARVORES[vdt] ? ANOS : [];
      return [200, anos.map(function (a) { return { ANO: a }; })];
    }

    if (rota === '/api/filtros-visao') {
      var ano = anoDe(params);
      if (!vdt || ano === null) return [400, { error: 'nm_vdt e ano são obrigatórios' }];
      return [200, visoesDe(ano).map(function (v) { return { VISAO: v }; })];
    }

    if (rota === '/api/tree') {
      return [200, arvoreDe(vdt || VDTS[0], anoDe(params), params.get('visao') || null)];
    }

    if (rota === '/api/bootstrap') {
      var preferida = params.get('vdt_preferido');
      var escolhida = VDTS.indexOf(preferida) !== -1 ? preferida : VDTS[0];
      var anosPorVdt = {};
      VDTS.forEach(function (v) { anosPorVdt[v] = ANOS.slice(); });
      var visoes = visoesDe(ANOS[0]);
      return [200, {
        vdts: VDTS,
        anosPorVdt: anosPorVdt,
        vdtSelecionada: escolhida,
        anos: ANOS.slice(),
        anoSelecionado: ANOS[0],
        visoes: visoes,
        visaoSelecionada: visoes[0],
        arvore: arvoreDe(escolhida, ANOS[0], visoes[0]),
        anoAtual: ANO_ATUAL,
      }];
    }

    return [404, { error: 'Rota não disponível no modo simulado: ' + rota }];
  }

  var fetchOriginal = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (entrada, opcoes) {
    var endereco = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    var url;
    try { url = new URL(endereco, window.location.href); } catch (e) { url = null; }

    if (!url || url.origin !== window.location.origin || url.pathname.indexOf('/api/') !== 0) {
      return fetchOriginal ? fetchOriginal(entrada, opcoes) : Promise.reject(new Error('fetch indisponível'));
    }

    var resposta = responder(url.pathname, url.searchParams);
    return Promise.resolve(new Response(JSON.stringify(resposta[1]), {
      status: resposta[0],
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
  };

  window.__VDT_MOCK = true;

  // Aviso permanente na tela: quem abre o link precisa saber que os
  // números não são reais.
  function avisar() {
    var selo = document.createElement('div');
    selo.textContent = 'Dados simulados';
    selo.setAttribute('role', 'note');
    selo.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
      'padding:6px 12px;border-radius:999px;background:#1a1a1a;color:#fff;' +
      'font:600 12px/1.2 system-ui,sans-serif;letter-spacing:.02em;opacity:.85;pointer-events:none;';
    document.body.appendChild(selo);
  }
  if (document.body) avisar();
  else document.addEventListener('DOMContentLoaded', avisar);
})();
