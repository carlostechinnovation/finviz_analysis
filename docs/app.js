const tickerInput = document.getElementById("ticker");
const screenerSelect = document.getElementById("screenerSelect");
const customURLInput = document.getElementById("customURL");
const compareBtn = document.getElementById("compareBtn");
const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
const log = document.getElementById("log");

// --- MAPA DE FILTROS Y CONDICIONES ---
const filterMap = {
    "fa_curratio_o1": ["Current Ratio", "≥ 1"],
    "fa_debteq_u1": ["Debt/Eq", "≤ 1"],
    "fa_evsales_u6": ["EV/Sales", "≤ 6"],
    "fa_fpe_u20": ["Forward P/E", "≤ 20"],
    "fa_grossmargin_o10": ["Gross Margin", "≥ 10"],
    "fa_ltdebteq_u1": ["LT Debt/Eq", "≤ 1"],
    "fa_opermargin_o5": ["Operating Margin", "≥ 5"],
    "fa_pe_u30": ["P/E", "≤ 30"],
    "fa_ps_o2": ["P/S", "≥ 2"],
    "sh_float_o1": ["Float", "≥ 1"],
    "sh_instown_o30": ["Inst Own", "≥ 30"],
    "sh_relvol_o0.5": ["Rel Volume", "≥ 0.5"],
    "sh_short_u10": ["Short Float", "≤ 10"],
    "ta_averagetruerange_o1": ["ATR (14)", "≥ 1"],
    "ta_highlow52w_a5h": ["52W High", "≥ 5h"],
    "ta_perf_3yup": ["Perf 3Y", "≥ 0"],
    "ta_perf2_26wup": ["Perf 26W", "≥ 0"],
    "ta_rsi_nos40": ["RSI (14)", "≥ 40"],
    "ta_sma20_pa": ["SMA20", "≥ 0"]
};

// --- LOG ---
function logMsg(msg) {
    log.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    log.scrollTop = log.scrollHeight;
}

// --- CARGAR SCREENERS ---
async function loadScreeners() {
    const resp = await fetch("urls_screeners_finviz.csv");
    const text = await resp.text();
    const lines = text.split("\n").slice(1);
    screenerSelect.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "none";
    defaultOption.textContent = "Elegir...";
    screenerSelect.appendChild(defaultOption);

    const customOption = document.createElement("option");
    customOption.value = "";
    customOption.textContent = "CUSTOM";
    screenerSelect.appendChild(customOption);

    for (const line of lines) {
        if (!line.trim()) continue;
        const [name, url] = line.trim().split("|");
        const option = document.createElement("option");
        option.value = url || "";
        option.textContent = name;
        screenerSelect.appendChild(option);
    }
}

screenerSelect.addEventListener("change", () => {
    customURLInput.style.display = screenerSelect.value === "" ? "inline-block" : "none";
});

// --- CARGAR DESCRIPCIONES ---
async function loadDescriptions() {
    const resp = await fetch("descripcion_filtros.csv");
    const text = await resp.text();
    const lines = text.split("\n").slice(1);
    const map = {};
    for (const line of lines) {
        if (!line.trim()) continue;
        const [filtro, descripcion] = line.split("|");
        map[filtro.trim()] = descripcion.trim();
    }
    return map;
}

// --- COMPARAR EMPRESA CON SCREENER ---
async function runComparison() {
    log.textContent = "";
    resultsTable.innerHTML = "";

    const ticker = tickerInput.value.trim().toUpperCase();
    let screenerURL = screenerSelect.value;
    if (screenerURL === "none") screenerURL = "";
    if (!screenerURL) screenerURL = customURLInput.value.trim();
    if (!ticker || !screenerURL) return alert("Rellena Ticker y URL");

    logMsg(`Iniciando comparación...`);

    const quoteURL = `https://corsproxy.io/?${encodeURIComponent(`https://finviz.com/quote.ashx?t=${ticker}`)}`;
    logMsg(`Obteniendo datos: ${quoteURL}`);
    const quoteResp = await fetch(quoteURL);
    const quoteHTML = await quoteResp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(quoteHTML, "text/html");

    const companyData = {};

    doc.querySelectorAll("table.snapshot-table2 tr").forEach(tr => {
        const tds = tr.querySelectorAll("td");
        for (let i = 0; i < tds.length; i += 2) {
            let key = tds[i].textContent.trim();
            let value =
                tds[i + 1]?.querySelector("b")?.textContent.trim() ||
                tds[i + 1]?.innerText.trim() ||
                "N/A";
            value = value.replace("%", "").replace(/,/g, "").trim();

            if (key === "Oper. Margin") key = "Operating Margin";
            if (key === "Perf Half Y") key = "Perf 26W";
            if (key === "Shs Float") key = "Float";

            companyData[key] = value;
        }
    });

    logMsg("Datos empresa extraídos");

    const urlParams = new URLSearchParams(screenerURL.split("?")[1]);
    const f = urlParams.get("f");
    const filters = f ? f.split(",") : [];
    logMsg(`Filtros del screener: ${filters.join(", ")}`);

    const economicOrder = [
        "fa_pe_u30", "fa_fpe_u20", "fa_grossmargin_o10", "fa_debteq_u1", "fa_curratio_o1",
        "sh_instown_o30", "sh_relvol_o0.5", "sh_short_u10", "fa_evsales_u6", "fa_opermargin_o5",
        "ta_averagetruerange_o1", "ta_highlow52w_a5h", "ta_perf_3yup", "ta_perf2_26wup",
        "ta_rsi_nos40", "ta_sma20_pa", "sh_float_o1", "fa_ps_o2", "fa_ltdebteq_u1"
    ];
    const sortedFilters = economicOrder.filter(flt => filters.includes(flt));

    const descripcionFiltros = await loadDescriptions();

    for (const filter of sortedFilters) {
        const [label, condition] = filterMap[filter] || [filter, ""];
        const value = companyData[label] || "N/A";

        let status = "na";
        if (value !== "N/A") {
            const numeric = parseFloat(value);
            if (!isNaN(numeric)) {
                if (condition.includes("≥")) {
                    const condVal = parseFloat(condition.split("≥")[1]);
                    status = numeric >= condVal ? "ok" : "nok";
                } else if (condition.includes("≤")) {
                    const condVal = parseFloat(condition.split("≤")[1]);
                    status = numeric <= condVal ? "ok" : "nok";
                }
            }
        }

        let descripcion = descripcionFiltros[label] || "";
        if (!descripcion && label === "Perf 26W") {
            descripcion = descripcionFiltros["Perf Half Y"] || "";
        }
        if (!descripcion && label === "Operating Margin") {
            descripcion = descripcionFiltros["Oper. Margin"] || "";
        }
        if (!descripcion && label === "Float") {
            descripcion = descripcionFiltros["Shs Float"] || "";
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${label}</td>
      <td>${condition}</td>
      <td>${value}</td>
      <td class="${status}">${status.toUpperCase()}</td>
      <td>${descripcion}</td>
    `;
        resultsTable.appendChild(tr);
    }

    logMsg("✅ Comparación finalizada");
}

compareBtn.addEventListener("click", runComparison);
loadScreeners();
