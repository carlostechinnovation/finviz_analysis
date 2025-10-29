// ESTABLE_2122+
// Script para comparar Empresa vs Screener en Finviz con resultados OK/NOK/NA y colores

const screenerSelect = document.getElementById('screener');
const compareBtn = document.getElementById('compareBtn');
const resultDiv = document.getElementById('result');
const logDiv = document.getElementById('log');

// Función para log en pantalla
function log(msg) {
    console.log(msg);
    logDiv.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Cargar CSV de screeners
async function loadScreeners() {
    try {
        const resp = await fetch('urls_screeners_finviz.csv');
        const text = await resp.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        screenerSelect.innerHTML = '';
        lines.slice(1).forEach(line => {
            const [key, url] = line.split('|');
            const opt = document.createElement('option');
            opt.value = url.trim();
            opt.textContent = key.trim();
            screenerSelect.appendChild(opt);
        });
    } catch (err) {
        log('Error cargando screeners: ' + err);
        screenerSelect.innerHTML = '<option value="">Error cargando</option>';
    }
}

// Normalizar valores numéricos
function cleanValue(v) {
    if (!v) return NaN;
    return parseFloat(v.replace(/[%BKM,]/g, '').trim());
}

// Comparar valor con condición
function compareValue(operator, limit, actual) {
    if (!operator || !limit || actual === 'N/A') return 'NA';
    const val = cleanValue(actual);
    const lim = cleanValue(limit);
    switch (operator.trim()) {
        case '≥':
        case '>=': return val >= lim ? 'OK' : 'NOK';
        case '≤':
        case '<=': return val <= lim ? 'OK' : 'NOK';
        case '=': return val === lim ? 'OK' : 'NOK';
        case '>': return val > lim ? 'OK' : 'NOK';
        case '<': return val < lim ? 'OK' : 'NOK';
        default: return 'NA';
    }
}

// Extraer filtros del URL del screener
function parseScreenerFilters(url) {
    const params = new URL(url).searchParams.get('f');
    if (!params) return [];
    return params.split(',').map(f => {
        // Mapear a nombre legible y operador/valor
        const mapping = {
            'fa_pe_u30': ['P/E', '≤', '30'],
            'fa_curratio_o1': ['Current Ratio', '≥', '1'],
            'fa_debteq_u1': ['Debt/Eq', '≤', '1'],
            'fa_ev_sales_u6': ['EV/Sales', '≤', '6'],
            'fa_grossmargin_o10': ['Gross Margin', '≥', '10'],
            'fa_ltdebteq_u1': ['ltDebt/Eq', '≤', '1'],
            'fa_opermargin_o5': ['OP/Er. Margin', '≥', '5'],
            'fa_ps_u2': ['P/S', '≥', '2'],
            'sh_float_o1': ['float', '≥', '1'],
            'sh_instown_o30': ['Inst Own', '≥', '30'],
            'sh_relvol_o0.5': ['Rel Volume', '≥', '0.5'],
            'sh_short_u10': ['Short Float', '≤', '10'],
            'ta_averagetruerange_o1': ['ATR (14)', '≥', '1'],
            'ta_highlow52w_a5h': ['52W High', '≥', '5h'],
            'ta_perf_3yup': ['Perf 3Y', '≥', '0'],
            'ta_perf2_26wup': ['Perf 26W', '≥', '0'],
            'ta_rsi_nos40': ['RSI (14)', '≥', '40'],
            'ta_sma20_pa': ['SMA20', '≥', '0']
        };
        return mapping[f] || [f, '', ''];
    });
}

// Extraer valores de la página de la empresa (parse HTML)
function parseCompanyData(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const data = {};
    doc.querySelectorAll('td.fullview-title+td')?.forEach(td => {
        const key = td.previousElementSibling.textContent.trim();
        const val = td.textContent.trim();
        data[key] = val;
    });
    return data;
}

// Función principal
async function runComparison() {
    const ticker = document.getElementById('ticker').value.trim().toUpperCase();
    const screenerURL = screenerSelect.value.trim();
    if (!ticker || !screenerURL) { alert('Rellenar ticker y screener'); return; }

    log('Iniciando comparación...');
    const proxy = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;

    try {
        log('Obteniendo empresa: ' + ticker);
        const compResp = await fetch(proxy(`https://finviz.com/quote.ashx?t=${ticker}`));
        const compHTML = await compResp.text();
        const companyData = parseCompanyData(compHTML);
        log('Datos empresa extraídos: ' + Object.keys(companyData).join(', '));

        log('Obteniendo screener');
        const scrResp = await fetch(proxy(screenerURL));
        const scrHTML = await scrResp.text();
        const screenerFilters = parseScreenerFilters(screenerURL);
        log('Filtros del screener: ' + screenerFilters.map(f => f[0]).join(', '));

        // Construir tabla
        let html = '<table><tr><th>Filtro</th><th>Condición Screener</th><th>Valor Empresa</th><th>OK/NOK</th></tr>';
        screenerFilters.forEach(([name, op, limit]) => {
            const val = companyData[name] || 'N/A';
            const res = compareValue(op, limit, val);
            html += `<tr><td>${name}</td><td>${op} ${limit}</td><td>${val}</td><td class="${res}">${res}</td></tr>`;
        });
        html += '</table>';
        resultDiv.innerHTML = html;
        log('✅ Comparación finalizada');
    } catch (err) {
        log('Error: ' + err);
    }
}

// Event listeners
compareBtn.addEventListener('click', runComparison);
window.addEventListener('load', loadScreeners);
