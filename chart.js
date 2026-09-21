/* Chart.js — Gráfico de barras com filtros e deltas */

let appState = {
  allData: [],
  filteredData: [],
  filters: {
    years: [],
    sites: [],
    products: [],
    views: [],
    horizons: []
  },
  selectedFilters: {
    years: [],
    sites: [],
    products: [],
    views: [],
    horizons: []
  },
  colors: {
    'Budget': '#B2B7FF',
    'Plan': '#CFEAF7',
    'Act/Fcst': '#3CB5E5'
  },
  chartBgColor: '#ffffff'
};

// Formatadores
const formatNumber = (num) => {
  if (num === null || num === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

const formatPercent = (num) => {
  if (num === null || num === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(num);
};

// Extrair filtros dos dados
function extractFilters(data) {
  const years = new Set();
  const sites = new Set();
  const products = new Set();
  const views = new Set();
  const horizons = new Set();

  data.forEach(row => {
    const year = new Date(row.DT_REF).getFullYear();
    years.add(year);
    if (row.ID_SITE) sites.add(row.ID_SITE);
    if (row.NM_KPI) products.add(row.NM_KPI);
    if (row.NM_TYPE) views.add(row.NM_TYPE);
    if (row.Type) horizons.add(row.Type);
  });

  return {
    years: Array.from(years).sort((a, b) => b - a),
    sites: Array.from(sites).sort(),
    products: Array.from(products).sort(),
    views: Array.from(views).sort(),
    horizons: Array.from(horizons).sort()
  };
}

// Montar UI de filtros
function renderFilters(filters) {
  const body = document.querySelector('.chart-filters-body');
  body.innerHTML = '';

  // Anos
  if (filters.years.length > 0) {
    const group = document.createElement('div');
    group.className = 'chart-filter-group';
    group.innerHTML = `
      <label for="filterYears" data-i18n="chart.filter.year">Ano</label>
      <select id="filterYears" multiple size="${Math.min(filters.years.length, 5)}">
        ${filters.years.map(y => `<option value="${y}" selected>${y}</option>`).join('')}
      </select>
    `;
    body.appendChild(group);
    appState.selectedFilters.years = [...filters.years];
  }

  // Sites
  if (filters.sites.length > 0) {
    const group = document.createElement('div');
    group.className = 'chart-filter-group';
    group.innerHTML = `
      <label for="filterSites" data-i18n="chart.filter.site">Site</label>
      <select id="filterSites" multiple size="${Math.min(filters.sites.length, 5)}">
        ${filters.sites.map(s => `<option value="${s}" selected>${s}</option>`).join('')}
      </select>
    `;
    body.appendChild(group);
    appState.selectedFilters.sites = [...filters.sites];
  }

  // Produtos
  if (filters.products.length > 0) {
    const group = document.createElement('div');
    group.className = 'chart-filter-group';
    group.innerHTML = `
      <label for="filterProducts" data-i18n="chart.filter.product">Produto</label>
      <select id="filterProducts" multiple size="${Math.min(filters.products.length, 5)}">
        ${filters.products.map(p => `<option value="${p}" selected>${p}</option>`).join('')}
      </select>
    `;
    body.appendChild(group);
    appState.selectedFilters.products = [...filters.products];
  }

  // Visões
  if (filters.views.length > 0) {
    const group = document.createElement('div');
    group.className = 'chart-filter-group';
    group.innerHTML = `
      <label for="filterViews" data-i18n="chart.filter.view">Visão</label>
      <select id="filterViews" multiple size="${Math.min(filters.views.length, 5)}">
        ${filters.views.map(v => `<option value="${v}" selected>${v}</option>`).join('')}
      </select>
    `;
    body.appendChild(group);
    appState.selectedFilters.views = [...filters.views];
  }

  // Horizontes
  if (filters.horizons.length > 0) {
    const group = document.createElement('div');
    group.className = 'chart-filter-group';
    group.innerHTML = `
      <label for="filterHorizons" data-i18n="chart.filter.horizon">Horizonte</label>
      <select id="filterHorizons" multiple size="${Math.min(filters.horizons.length, 5)}">
        ${filters.horizons.map(h => `<option value="${h}" selected>${h}</option>`).join('')}
      </select>
    `;
    body.appendChild(group);
    appState.selectedFilters.horizons = [...filters.horizons];
  }

  // Event listeners
  document.getElementById('filterYears')?.addEventListener('change', e => {
    appState.selectedFilters.years = Array.from(e.target.selectedOptions, o => parseInt(o.value));
  });
  document.getElementById('filterSites')?.addEventListener('change', e => {
    appState.selectedFilters.sites = Array.from(e.target.selectedOptions, o => o.value);
  });
  document.getElementById('filterProducts')?.addEventListener('change', e => {
    appState.selectedFilters.products = Array.from(e.target.selectedOptions, o => o.value);
  });
  document.getElementById('filterViews')?.addEventListener('change', e => {
    appState.selectedFilters.views = Array.from(e.target.selectedOptions, o => o.value);
  });
  document.getElementById('filterHorizons')?.addEventListener('change', e => {
    appState.selectedFilters.horizons = Array.from(e.target.selectedOptions, o => o.value);
  });
}

// Aplicar filtros
function applyFilters() {
  const { selectedFilters } = appState;

  appState.filteredData = appState.allData.filter(row => {
    const year = new Date(row.DT_REF).getFullYear();
    const matchYear = selectedFilters.years.length === 0 || selectedFilters.years.includes(year);
    const matchSite = selectedFilters.sites.length === 0 || selectedFilters.sites.includes(row.ID_SITE);
    const matchProduct = selectedFilters.products.length === 0 || selectedFilters.products.includes(row.NM_KPI);
    const matchView = selectedFilters.views.length === 0 || selectedFilters.views.includes(row.NM_TYPE);
    const matchHorizon = selectedFilters.horizons.length === 0 || selectedFilters.horizons.includes(row.Type);

    return matchYear && matchSite && matchProduct && matchView && matchHorizon;
  });

  renderChart();
}

// Ordenar dados conforme especificação
function sortChartData(data) {
  return data.sort((a, b) => {
    const yearA = new Date(a.DT_REF).getFullYear();
    const yearB = new Date(b.DT_REF).getFullYear();
    if (yearA !== yearB) return yearA - yearB;

    const dateA = new Date(a.DT_REF).getTime();
    const dateB = new Date(b.DT_REF).getTime();
    if (dateA !== dateB) return dateA - dateB;

    const typeOrderA = a.ID_TYPE || 999;
    const typeOrderB = b.ID_TYPE || 999;
    if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;

    return a.ID_ORDEM - b.ID_ORDEM;
  });
}

// Renderizar gráfico
function renderChart() {
  const data = sortChartData(appState.filteredData);

  if (data.length === 0) {
    showState('empty');
    return;
  }

  showState('chart');

  const margin = { top: 40, right: 20, bottom: 50, left: 50 };
  const container = document.getElementById('chartSvgWrapper');
  const width = container.clientWidth - margin.left - margin.right;
  const height = container.clientHeight - margin.top - margin.bottom;

  const svg = d3.select('#chartSvg');
  svg.selectAll('*').remove();

  const maxValue = d3.max(data, d => d.Value) || 100;
  const xScale = d3.scaleBand()
    .domain(data.map((_, i) => i))
    .range([margin.left, margin.left + width])
    .padding(0.15);

  const yScale = d3.scaleLinear()
    .domain([0, maxValue * 1.1])
    .range([margin.top + height, margin.top]);

  const g = svg.append('g');

  // Grid horizontal
  g.selectAll('.grid-line')
    .data(yScale.ticks(5))
    .enter()
    .append('line')
    .attr('class', 'grid-line')
    .attr('x1', margin.left)
    .attr('x2', margin.left + width)
    .attr('y1', d => yScale(d))
    .attr('y2', d => yScale(d))
    .attr('stroke', 'var(--chart-grid)')
    .attr('stroke-width', '1')
    .attr('stroke-dasharray', '2,2')
    .attr('opacity', '0.3');

  // Eixo Y
  g.selectAll('.y-label')
    .data(yScale.ticks(5))
    .enter()
    .append('text')
    .attr('class', 'y-label')
    .attr('x', margin.left - 8)
    .attr('y', d => yScale(d))
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', '12')
    .attr('fill', 'var(--text-muted)')
    .text(d => formatNumber(d));

  // Barras
  const bars = g.selectAll('.bar')
    .data(data)
    .enter()
    .append('rect')
    .attr('class', 'chart-bar')
    .attr('x', (_, i) => xScale(i) + xScale.bandwidth() * 0.125)
    .attr('y', d => yScale(d.Value))
    .attr('width', xScale.bandwidth() * 0.75)
    .attr('height', d => margin.top + height - yScale(d.Value))
    .attr('fill', d => appState.colors[d.NM_TYPE] || '#888')
    .attr('rx', '4')
    .attr('opacity', '0')
    .on('mouseenter', function (_, d, i) {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('opacity', '1')
        .attr('filter', 'brightness(1.1)');
    })
    .on('mouseleave', function () {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('opacity', '1')
        .attr('filter', 'none');
    });

  bars.transition().duration(600).attr('opacity', '1');

  // Valores acima das barras
  g.selectAll('.bar-value')
    .data(data)
    .enter()
    .append('text')
    .attr('class', 'bar-value')
    .attr('x', (_, i) => xScale(i) + xScale.bandwidth() / 2)
    .attr('y', d => yScale(d.Value) - 8)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12')
    .attr('font-weight', '600')
    .attr('fill', 'var(--text-primary)')
    .text(d => formatNumber(d.Value));

  // Rótulos do eixo X
  g.selectAll('.x-label')
    .data(data)
    .enter()
    .append('text')
    .attr('class', 'x-label')
    .attr('x', (_, i) => xScale(i) + xScale.bandwidth() / 2)
    .attr('y', margin.top + height + 20)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12')
    .attr('fill', 'var(--text-muted)')
    .text(d => d.Type);

  // Tooltips
  g.selectAll('.bar')
    .append('title')
    .text(d => `
${d.NM_KPI}
${d.Type}: ${formatNumber(d.Value)}
Visão: ${d.NM_TYPE}
Site: ${d.ID_SITE}
`.trim());
}

// Mostrar/ocultar estados
function showState(state) {
  document.getElementById('chartLoading').style.display = state === 'loading' ? 'flex' : 'none';
  document.getElementById('chartError').style.display = state === 'error' ? 'flex' : 'none';
  document.getElementById('chartEmpty').style.display = state === 'empty' ? 'flex' : 'none';
  document.getElementById('chartWrapper').style.display = state === 'chart' ? 'flex' : 'none';
}

// Carregar dados
async function loadData() {
  showState('loading');
  try {
    const response = await fetch('/api/chart-data');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    appState.allData = await response.json();

    if (appState.allData.length === 0) {
      showState('empty');
      return;
    }

    const filters = extractFilters(appState.allData);
    appState.filters = filters;
    renderFilters(filters);
    applyFilters();
  } catch (err) {
    console.error('Erro carregando dados:', err);
    document.getElementById('chartErrorMsg').textContent = err.message;
    showState('error');
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  document.getElementById('filtersApply')?.addEventListener('click', applyFilters);
  document.getElementById('filtersReset')?.addEventListener('click', () => {
    const { filters } = appState;
    appState.selectedFilters = {
      years: [...filters.years],
      sites: [...filters.sites],
      products: [...filters.products],
      views: [...filters.views],
      horizons: [...filters.horizons]
    };
    renderFilters(filters);
    applyFilters();
  });

  // Resize listener
  window.addEventListener('resize', () => {
    if (appState.filteredData.length > 0) {
      renderChart();
    }
  });
});
