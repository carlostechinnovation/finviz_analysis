<<<<<<< HEAD
// ======== CONFIGURACIÓN ========
const CORS_PROXY = "https://corsproxy.io/?";
const CSV_FILE = "urls_screeners_finviz.csv"; // CSV en /docs/

// ======== UTILIDADES ========
function log(msg) {
  const logDiv = document.getElementById("log");
  const now = new Date().toLocaleTimeString();
  logDiv.innerHTML += `[${now}] ${msg}<br>`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

async function fetchHTML(url) {
  const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
  log(`Intentando obtener: ${url}`);
  log(`Usando proxy: ${proxiedUrl}`);
  const res = await fetch(proxiedUrl);
  if (!res.ok) throw new Error(`Error al obtener ${url}: ${res.status}`);
  log("✅ Descargado correctamente");
  return await res.text();
}

// ======== CARGA DE SCREENERS DESDE CSV ========
async function loadScreeners() {
  const res = await fetch(CSV_FILE);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // quitar cabecera
  const select = document.getElementById("screenerSelect");
  select.innerHTML = "";
  select.add(new Option("CUSTOM", ""));
  for (const line of lines) {
    const [key, url] = line.split("|");
    select.add(new Option(key, url));
  }
}

// Al seleccionar un screener, actualizar input
document.getElementById("screenerSelect").addEventListener("change", (e) => {
  const url = e.target.value;
  document.getElementById("screenerUrl").value = url;
});

// ======== PARSERS ========
function parseCompanyData(html) {
  log("Parseando datos de la empresa...");
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const tds = Array.from(doc.querySelectorAll("table.snapshot-table2 td"));
  const data = {};
  for (let i = 0; i < tds.length; i += 2) {
    const key = tds[i]?.innerText.trim();
    const val = tds[i + 1]?.innerText.trim();
    if (key && val) data[key] = val;
  }
  log(`Datos empresa extraídos: ${Object.keys(data).join(", ")}`);
  return data;
}

function parseScreenerFilters(url) {
  const filters = {};
  const match = url.match(/[?&]f=([^&]+)/);
  if (!match) return filters;
  const fParam = decodeURIComponent(match[1]);
  const items = fParam.split(",");
  for (const item of items) {
    const [prefix, key, opVal] = item.split("_");
    if (!key || !opVal) continue;
    const value = opVal.replace(/[a-z]+/, "");
    let fieldName = key
      .replace("curratio", "Current Ratio")
      .replace("debteq", "Debt/Eq")
      .replace("evsales", "EV/Sales")
      .replace("grossmargin", "Gross Margin")
      .replace("ltdebteq", "LT Debt/Eq")
      .replace("opermargin", "Oper. Margin")
      .replace("pe", "P/E")
      .replace("ps", "P/S")
      .replace("sh_float", "Shs Float")
      .replace("instown", "Inst Own")
      .replace("relvol", "Rel Volume")
      .replace("short", "Short Float")
      .replace("averagetruerange", "ATR (14)")
      .replace("highlow52w", "52W High")
      .replace("perf_3y", "Perf 3Y")
      .replace("perf2_1wup", "Perf Week")
      .replace("rsi", "RSI (14)")
      .replace("sma20", "SMA20");
    let condition = opVal.startsWith("u") ? "≤" : "≥";
    filters[fieldName] = `${condition} ${value}`;
  }
  log(`Filtros del screener: ${Object.keys(filters).join(", ")}`);
  return filters;
}

// ======== COMPARACIÓN ========
function compareData(company, filters) {
  const rows = [];
  for (const [field, condition] of Object.entries(filters)) {
    const companyValue = company[field] || "N/A";
    const ok = companyValue === "N/A" ? "N/A" : "OK";
    rows.push({ field, condition, companyValue, result: ok });
  }
  return rows;
}

// ======== EJECUCIÓN ========
async function runComparison() {
  try {
    const ticker = document.getElementById("ticker").value.trim().toUpperCase();
    const screenerUrl = document.getElementById("screenerUrl").value.trim();
    const tbody = document.querySelector("#resultsTable tbody");
    tbody.innerHTML = "";

    if (!ticker || !screenerUrl) {
      alert("Debes introducir el ticker y la URL del screener.");
      return;
    }

    log("Iniciando comparación...");
    const companyUrl = `https://finviz.com/quote.ashx?t=${ticker}`;

    const [companyHTML, screenerHTML] = await Promise.all([
      fetchHTML(companyUrl),
      fetchHTML(screenerUrl)
    ]);

    const companyData = parseCompanyData(companyHTML);
    const screenerFilters = parseScreenerFilters(screenerUrl);

    const results = compareData(companyData, screenerFilters);

    results.forEach(r => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${r.field}</td>
        <td>${r.condition}</td>
        <td>${r.companyValue}</td>
        <td class="${r.result === 'OK' ? 'ok' : 'nok'}">${r.result}</td>
      `;
      tbody.appendChild(row);
    });

    log("✅ Comparación finalizada");
  } catch (err) {
    log("❌ ERROR: " + err.message);
  }
}

// ======== EVENTOS ========
document.getElementById("compareBtn").addEventListener("click", runComparison);
loadScreeners();
=======
/**
 * app.js
 * Comparación automática de empresa vs screener (solo tablas)
 */

// Mapeo de filtros de Finviz a nombres legibles
const FILTER_MAP = {
    'cap_largeunder': 'Market Cap',
    'fa_curratio_o1': 'Current Ratio',
    'fa_debteq_u1': 'Debt/Equity',
    'fa_evsales_u6': 'EV/Sales',
    'fa_grossmargin_o10': 'Gross Margin',
    'fa_ltdebteq_u1': 'LT Debt/Equity',
    'fa_opermargin_o5': 'Operating Margin',
    'fa_pe_u30': 'P/E Ratio',
    'fa_ps_o2': 'P/S Ratio',
    'sh_float_o1': 'Float',
    'sh_instown_o30': 'Institutional Own',
    'sh_relvol_o0.5': 'Relative Volume',
    'sh_short_u10': 'Short Float',
    'ta_averagetruerange_o1': 'Average True Range',
    'ta_highlow52w_a5h': '52W High/Low',
    'ta_perf_3yup': 'Performance 3Y',
    'ta_perf2_1wup': 'Performance Week',
    'ta_rsi_nos40': 'RSI (14)',
    'ta_sma20_pa': 'SMA20'
};

// Proxies CORS públicos
const CORS_PROXIES = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

/**
 * Fetch HTML usando proxies
 * @param {string} url 
 * @returns {Promise<string>} HTML
 */
async function fetchWithProxy(url) {
    for (const proxy of CORS_PROXIES) {
        try {
            const res = await fetch(proxy(url));
            if (res.ok) return await res.text();
        } catch (e) { console.warn('Proxy fallido:', e); }
    }
    throw new Error('No se pudo acceder al recurso (proxy fallido).');
}

/**
 * Parsear HTML del screener para obtener filtros activos desde tabla principal
 * @param {string} html 
 * @returns {Array<{key:string,value:string}>} Lista de filtros
 */
function parseScreener(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const filters = [];

    // Buscar la tabla principal de filtros
    const table = doc.querySelector('table.screener-views-table') || doc.querySelector('table.table-light');
    if (!table) return Object.keys(FILTER_MAP).map(k => ({ key: k, value: 'N/A' }));

    table.querySelectorAll('tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
            const key = cells[0].textContent.trim().replace(/\s/g, '_');
            const value = cells[1].textContent.trim();
            if (key) filters.push({ key, value });
        }
    });

    return filters.length ? filters : Object.keys(FILTER_MAP).map(k => ({ key: k, value: 'N/A' }));
}

/**
 * Parsear HTML de la empresa para obtener métricas de la tabla principal
 * @param {string} html 
 * @returns {Object} {Nombre: Valor}
 */
function parseStock(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const data = {};

    const table = doc.querySelector('table.snapshot-table2');
    if (!table) return data;

    table.querySelectorAll('tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        for (let i = 0; i < cells.length; i += 2) {
            const key = cells[i].textContent.trim();
            const value = cells[i + 1].textContent.trim();
            data[key] = value;
        }
    });

    return data;
}

/**
 * Mostrar resultados en la tabla
 * @param {Array<{key:string,value:string}>} filters 
 * @param {Object} stockData 
 */
function displayResults(filters, stockData) {
    const tbody = document.querySelector('#comparison-table tbody');
    tbody.innerHTML = '';

    filters.forEach(f => {
        const name = FILTER_MAP[f.key] || f.key;
        const valueCompany = stockData[name] || 'N/A';
        const ok = valueCompany !== 'N/A';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            <td>${f.value}</td>
            <td>${valueCompany}</td>
            <td class="${ok ? 'ok' : 'nok'}">${ok ? 'OK' : 'NOK'}</td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Función principal al pulsar el botón
 */
async function compareStock() {
    const ticker = document.getElementById('ticker').value.trim().toUpperCase();
    const screenerURL = document.getElementById('screener-url').value.trim();
    const resultsDiv = document.getElementById('results');

    if (!ticker || !screenerURL) {
        alert('Debes completar ticker y URL del screener.');
        return;
    }

    resultsDiv.style.display = 'block';
    const tbody = document.querySelector('#comparison-table tbody');
    tbody.innerHTML = '<tr><td colspan="4">Cargando...</td></tr>';

    try {
        const stockURL = `https://finviz.com/quote.ashx?t=${ticker}`;
        const [screenerHTML, stockHTML] = await Promise.all([
            fetchWithProxy(screenerURL),
            fetchWithProxy(stockURL)
        ]);

        const filters = parseScreener(screenerHTML);
        const stockData = parseStock(stockHTML);

        displayResults(filters, stockData);

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4">Error: ${err.message}</td></tr>`;
        console.error(err);
    }
}

// Asignar evento al botón
document.getElementById('compareBtn').addEventListener('click', compareStock);
>>>>>>> 5c70b173351021ec008c0ed9fb49e7e2c32bfe87
