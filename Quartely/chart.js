// ── Theme Management ────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
}

// ── Language Management ──────────────────────────────────────────
document.getElementById('language-select').addEventListener('change', (e) => {
  const lang = e.target.value;
  setLanguage(lang);
  renderChart(window.chartData, window.activeFilters);
});

// ── Global State ─────────────────────────────────────────────────
let chartData = [];
let filteredData = [];
let activeFilters = {
  years: new Set(),
  sites: new Set(),
  products: new Set(),
  views: new Set(),
  horizons: new Set()
};
let distinctValues = {
  years: [],
  sites: [],
  products: [],
  views: [],
  horizons: []
};

// ── API Call ─────────────────────────────────────────────────────
async function fetchChartData() {
  showState('loading');
  try {
    const response = await fetch('/api/chart-data');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    chartData = await response.json();
    window.chartData = chartData;

    if (chartData.length === 0) {
      showState('empty');
      return;
    }

    extractFilters(chartData);
    renderFilters();
    applyFilters();
  } catch (err) {
    console.error('Fetch error:', err);
    showState('error', err.message);
  }
}

// ── State Management ────────────────────────────────────────────
function showState(state, errorMessage = '') {
  document.getElementById('state-loading').style.display = state === 'loading' ? 'flex' : 'none';
  document.getElementById('state-empty').style.display = state === 'empty' ? 'flex' : 'none';
  document.getElementById('state-error').style.display = state === 'error' ? 'flex' : 'none';
  document.getElementById('chart-wrapper').style.display = state === 'ready' ? 'block' : 'none';

  if (state === 'error') {
    document.getElementById('error-message').textContent = errorMessage;
  }
}

// ── Filter Extraction ───────────────────────────────────────────
function extractFilters(data) {
  const years = new Set();
  const sites = new Set();
  const products = new Set();
  const views = new Set();
  const horizons = new Set();

  data.forEach(row => {
    if (row.DT_REF) {
      const year = new Date(row.DT_REF).getFullYear();
      years.add(year);
    }
    if (row.ID_SITE) sites.add(String(row.ID_SITE));
    if (row.ID_OPERACAO) products.add(String(row.ID_OPERACAO));
    if (row.NM_TYPE) views.add(row.NM_TYPE);
    if (row.Type) horizons.add(row.Type);
  });

  distinctValues = {
    years: Array.from(years).sort((a, b) => a - b),
    sites: Array.from(sites).sort(),
    products: Array.from(products).sort(),
    views: Array.from(views).sort(),
    horizons: Array.from(horizons).sort()
  };

  // Initialize all filters as active
  activeFilters = {
    years: new Set(distinctValues.years),
    sites: new Set(distinctValues.sites),
    products: new Set(distinctValues.products),
    views: new Set(distinctValues.views),
    horizons: new Set(distinctValues.horizons)
  };
  window.activeFilters = activeFilters;
}

// ── Filter Rendering ───────────────────────────────────────────
function renderFilters() {
  const filterGroups = [
    { id: 'years-filter', key: 'years', values: distinctValues.years },
    { id: 'sites-filter', key: 'sites', values: distinctValues.sites },
    { id: 'products-filter', key: 'products', values: distinctValues.products },
    { id: 'views-filter', key: 'views', values: distinctValues.views },
    { id: 'horizons-filter', key: 'horizons', values: distinctValues.horizons }
  ];

  filterGroups.forEach(group => {
    const container = document.getElementById(group.id);
    container.innerHTML = '';

    group.values.forEach(value => {
      const label = document.createElement('label');
      label.className = 'filter-checkbox';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = activeFilters[group.key].has(String(value));
      checkbox.addEventListener('change', () => {
        const strVal = String(value);
        if (checkbox.checked) {
          activeFilters[group.key].add(strVal);
        } else {
          activeFilters[group.key].delete(strVal);
        }
        applyFilters();
      });

      const span = document.createElement('span');
      span.textContent = String(value);

      label.appendChild(checkbox);
      label.appendChild(span);
      container.appendChild(label);
    });
  });
}

// ── Filter Application ──────────────────────────────────────────
function applyFilters() {
  filteredData = chartData.filter(row => {
    const year = new Date(row.DT_REF).getFullYear();
    const site = String(row.ID_SITE);
    const product = String(row.ID_OPERACAO);
    const view = row.NM_TYPE;
    const horizon = row.Type;

    return (
      activeFilters.years.has(year) &&
      activeFilters.sites.has(site) &&
      activeFilters.products.has(product) &&
      activeFilters.views.has(view) &&
      activeFilters.horizons.has(horizon)
    );
  });

  if (filteredData.length === 0) {
    showState('empty');
  } else {
    renderChart(filteredData, activeFilters);
  }
}

// ── Data Sorting ────────────────────────────────────────────────
function sortChartData(data) {
  return data.sort((a, b) => {
    const yearA = new Date(a.DT_REF).getFullYear();
    const yearB = new Date(b.DT_REF).getFullYear();
    if (yearA !== yearB) return yearA - yearB;

    const dateA = new Date(a.DT_REF);
    const dateB = new Date(b.DT_REF);
    if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;

    const typeOrderMap = { Budget: 0, Plan: 1, 'Act/Fcst': 2 };
    const typeA = typeOrderMap[a.NM_TYPE] ?? 999;
    const typeB = typeOrderMap[b.NM_TYPE] ?? 999;
    if (typeA !== typeB) return typeA - typeB;

    return (a.ID_ORDEM ?? 999) - (b.ID_ORDEM ?? 999);
  });
}

// ── D3 Chart Rendering ──────────────────────────────────────────
function renderChart(data, filters) {
  if (!data || data.length === 0) {
    showState('empty');
    return;
  }

  showState('ready');
  const sorted = sortChartData([...data]);

  const svg = d3.select('#chart');
  svg.selectAll('*').remove();

  const container = document.getElementById('chart-wrapper');
  const width = container.clientWidth;
  const height = container.clientHeight;

  const margin = { top: 20, right: 20, bottom: 60, left: 60 };
  const innerWidth = Math.max(300, width - margin.left - margin.right);
  const innerHeight = Math.max(200, height - margin.top - margin.bottom);

  svg.attr('width', width).attr('height', height);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Group data by date for grouped bars
  const groupedData = d3.group(sorted, d => d.DT_REF);
  const groups = Array.from(groupedData.keys()).sort();
  const subgroups = Array.from(new Set(sorted.map(d => d.NM_TYPE)));

  const xScale = d3.scaleBand()
    .domain(groups)
    .range([0, innerWidth])
    .padding(0.2);

  const xSubScale = d3.scaleBand()
    .domain(subgroups)
    .range([0, xScale.bandwidth()])
    .padding(0.05);

  const yMax = d3.max(sorted, d => d.Value) || 100;
  const yScale = d3.scaleLinear()
    .domain([0, yMax * 1.1])
    .range([innerHeight, 0]);

  const colorScale = d3.scaleOrdinal()
    .domain(subgroups)
    .range(['#1f77b4', '#ff7f0e', '#2ca02c']);

  // X Axis
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale))
    .append('text')
    .attr('x', innerWidth / 2)
    .attr('y', 45)
    .attr('fill', 'currentColor')
    .style('text-anchor', 'middle')
    .text('Date');

  // Y Axis
  g.append('g')
    .call(d3.axisLeft(yScale))
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', 0 - margin.left)
    .attr('x', 0 - (innerHeight / 2))
    .attr('dy', '1em')
    .attr('fill', 'currentColor')
    .style('text-anchor', 'middle')
    .text('Value');

  // Bars
  g.selectAll('g.group')
    .data(groups)
    .enter()
    .append('g')
    .attr('class', 'group')
    .attr('transform', d => `translate(${xScale(d)},0)`)
    .selectAll('rect')
    .data(date => subgroups.map(subgroup => ({
      date,
      subgroup,
      value: groupedData.get(date).find(d => d.NM_TYPE === subgroup)?.Value || 0
    })))
    .enter()
    .append('rect')
    .attr('x', d => xSubScale(d.subgroup))
    .attr('y', d => yScale(d.value))
    .attr('width', xSubScale.bandwidth())
    .attr('height', d => innerHeight - yScale(d.value))
    .attr('fill', d => colorScale(d.subgroup))
    .attr('opacity', 0.8)
    .on('mouseover', function() {
      d3.select(this).attr('opacity', 1);
    })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', 0.8);
    });

  // Legend
  const legend = g.append('g')
    .attr('transform', `translate(${innerWidth - 150}, 0)`);

  legend.selectAll('rect')
    .data(subgroups)
    .enter()
    .append('rect')
    .attr('y', (d, i) => i * 25)
    .attr('width', 18)
    .attr('height', 18)
    .attr('fill', d => colorScale(d));

  legend.selectAll('text')
    .data(subgroups)
    .enter()
    .append('text')
    .attr('x', 24)
    .attr('y', (d, i) => i * 25 + 13)
    .text(d => d)
    .attr('fill', 'currentColor')
    .attr('font-size', '12px');
}

// ── Event Listeners ─────────────────────────────────────────────
document.getElementById('clear-filters').addEventListener('click', () => {
  activeFilters = {
    years: new Set(distinctValues.years),
    sites: new Set(distinctValues.sites),
    products: new Set(distinctValues.products),
    views: new Set(distinctValues.views),
    horizons: new Set(distinctValues.horizons)
  };
  window.activeFilters = activeFilters;
  renderFilters();
  applyFilters();
});

document.getElementById('retry-btn').addEventListener('click', fetchChartData);

document.getElementById('filters-toggle').addEventListener('click', () => {
  const panel = document.getElementById('filters-panel');
  panel.classList.toggle('collapsed');
});

// ── Responsive Resize ───────────────────────────────────────────
window.addEventListener('resize', () => {
  if (filteredData.length > 0) {
    renderChart(filteredData, activeFilters);
  }
});

// ── Initialization ──────────────────────────────────────────────
initTheme();
fetchChartData();
