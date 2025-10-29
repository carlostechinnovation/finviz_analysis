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
