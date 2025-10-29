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
