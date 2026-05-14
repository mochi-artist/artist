// Type：列車型態（1=定期 2=加開 3=郵輪 4=專列）
const TRAIN_TYPE_MAP = {
    '1': '定期', '2': '加開', '3': '郵輪', '4': '專列'
};

// CarClass：列車種類代碼表（V1.5）
const CAR_CLASS_MAP = {
    '1100': '自強',           '1101': '自強(太,障)',    '1102': '自強(腳,障)',
    '1103': '自強(障)',        '1104': '自強(專)',       '1105': '自強(郵)',
    '1106': '自強(商專)',      '1107': '自強(普,障)',    '1108': '自強(PP障)',
    '1109': '自強(PP親)',      '110A': '自強(PP障12)',   '110B': '自強(E12)',
    '110C': '自強(E3)',        '110D': '自強(D28)',      '110E': '自強(D29)',
    '110F': '自強(D31)',       '110G': '自強(3000障)',   '110H': '自強(3000親障)',
    '1110': '莒光',            '1111': '莒光(障)',       '1112': '莒光(專)',
    '1113': '莒光(郵)',        '1114': '莒光(腳)',       '1115': '莒光(腳,障)',
    '1120': '復興',            '1121': '復興(專)',       '1122': '復興(郵)',
    '1130': '電車(專)',        '1131': '區間車',         '1132': '區間快',
    '1133': '電車(郵)',        '1134': '兩鐵(專)',       '1135': '區間車(腳,障)',
    '1140': '普快車',          '1141': '柴快車',
    '1150': '普通車(專)',      '1151': '普通車',         '1152': '行包專車',
    '1154': '柴客(專)',        '1155': '柴客(郵)',       '110K': '自強',
    '1270': '普通貨車',        '1280': '客迴',           '1281': '柴迴',
    '1282': '臨時客迴',        '12A0': '調車列車',       '12A1': '單機迴送',
    '12B0': '試運轉',          '4200': '特種(戰)',       '5230': '特種(警)'
};

// LineDir / Line 對照
const LINE_DIR_MAP = { '1': '順行', '2': '逆行' };
const LINE_MAP = { '0': '不經山海線', '1': '山線', '2': '海線', '3': '成追線', '4': '山海線' };

const CATEGORY_ORDER = ['新自強', '太魯閣', '普悠瑪', '自強', '柴聯自強', '莒光', '區間車', '區間快', '普快車', '專列', '客迴'];

const CAR_CLASS_CATEGORY = {
    // 新自強
    '110G': '新自強', '110H': '新自強',
    // 太魯閣
    '1101': '太魯閣',
    // 普悠瑪
    '1107': '普悠瑪',
    // 自強
    '1100': '自強',  '1102': '自強',  '1103': '自強',
    '1105': '自強',  '1106': '自強',  '1108': '自強',  '1109': '自強',
    '110A': '自強',  '110B': '自強',  '110C': '自強',  '110D': '自強',
    '110E': '自強',  '110K': '自強',
    // 柴聯自強
    '110F': '柴聯自強',
    // 莒光
    '1110': '莒光',  '1111': '莒光',
    '1113': '莒光',  '1114': '莒光',  '1115': '莒光',
    // 區間車
    '1131': '區間車', '1135': '區間車',
    // 區間快
    '1132': '區間快',
    // 普快車
    '1140': '普快車', '1141': '普快車', '1150': '普快車',
    // 專列
    '1104': '專列',  '1112': '專列',  '1121': '專列',
    '1130': '專列',  '1134': '專列',  '1154': '專列',
};

function getTrainCategory(carClass) {
    return CAR_CLASS_CATEGORY[carClass] || '客迴';
}

const KEYS_ZH = {
    Type: '列車型態', Train: '車次',
    Route: '路線', 
    LineDir: '行駛方向', Line: '經由路線', CarClass: '列車種類',
    ExtraTrain: '加班車', Everyday: '每日行駛',
    Note: '備註', CalculatedOverNightStn: '跨日車站代碼'
};

const YN_KEYS = new Set(['ExtraTrain', 'Everyday']);

const IGNORE_KEYS = new Set(['BreastFeed', 'Package', 'Dinning', 'FoodSrv', 'Cripple', 'Bike', 'NoteEng', 'OverNightStn', 'OverNightStationID']);

let Route = {};

// ==========================================
// 💡 精準計算「最靠近 00:00:00 的跨日車站」演算法
// ==========================================
function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2] || 0, 10);
}

function timeToMidnightDiff(timeStr) {
    if (!timeStr) return Infinity;
    const sec = timeToSeconds(timeStr);
    if (sec > 12 * 3600) return 86400 - sec;
    return sec;
}

function findOverNightStation(timeInfos) {
    if (!timeInfos || timeInfos.length === 0) return null;
    
    let crossedMidnight = false;
    let prevSeconds = -1;
    let minDiff = Infinity;
    let closestStn = null;
    
    for (const t of timeInfos) {
        const arrStr = t.ARRTime || t.DEPTime;
        const depStr = t.DEPTime || t.ARRTime;
        if (!arrStr || !depStr) continue;
        
        const arrSec = timeToSeconds(arrStr);
        const depSec = timeToSeconds(depStr);
        
        if (prevSeconds !== -1 && (arrSec < prevSeconds || depSec < arrSec)) {
            crossedMidnight = true;
        }
        prevSeconds = Math.max(arrSec, depSec);
    }
    
    if (!crossedMidnight) return null;
    
    for (const t of timeInfos) {
        const arrStr = t.ARRTime || t.DEPTime;
        const depStr = t.DEPTime || t.ARRTime;
        
        const arrDiff = timeToMidnightDiff(arrStr);
        const depDiff = timeToMidnightDiff(depStr);
        
        const localMinDiff = Math.min(arrDiff, depDiff);
        if (localMinDiff < minDiff) {
            minDiff = localMinDiff;
            closestStn = t.Station;
        }
    }
    
    return closestStn;
}

// ==========================================
// 💡 特殊車次日誌解析專區
// ==========================================
let specialTrainsByDate = {};

async function loadSpecialTrainsLog() {
    try {
        const res = await fetch('scan_log.txt', { cache: 'no-store' });
        const text = await res.text();
        
        let currentDate = null;
        const lines = text.split('\n');
        
        for (const line of lines) {
            const dateMatch = line.match(/日期:\s*(\d{8})/);
            if (dateMatch) {
                currentDate = dateMatch[1];
                if (!specialTrainsByDate[currentDate]) {
                    specialTrainsByDate[currentDate] = new Set();
                }
                continue;
            }
            if (currentDate && !line.includes('次讀取')) {
                const trainMatch = line.match(/[\[［]([a-zA-Z0-9]+)[\]］]/);
                if (trainMatch) {
                    specialTrainsByDate[currentDate].add(trainMatch[1]);
                }
            }
        }
    } catch (error) {
        console.error('無法讀取或解析 scan_log.txt', error);
    }
}

function setYN(td, v) {
    if (v === 'Y') { td.innerHTML = '<span class="badge badge-green">是</span>'; return; }
    if (v === 'N') { td.innerHTML = '<span class="badge badge-red">否</span>'; return; }
    if (v) { td.innerHTML = `<span class="badge badge-gray">${v}</span>`; return; }
    td.innerHTML = '<span style="color:#cbd5e1">—</span>';
}

function fillInfoVal(td, key, val) {
    if (key === 'Type') {
        const label = TRAIN_TYPE_MAP[val] || val;
        td.innerHTML = `<span style="color:#94a3b8;font-size:0.78rem">${val}</span> ${label}`;
    } else if (key === 'CarClass') {
        const label = CAR_CLASS_MAP[val] || val;
        td.innerHTML = `<span style="color:#94a3b8;font-size:0.78rem">${val}</span> ${label}`;
    } else if (key === 'LineDir') {
        td.textContent = LINE_DIR_MAP[val] || val;
    } else if (key === 'Line') {
        td.textContent = LINE_MAP[val] || val;
    } else if (YN_KEYS.has(key)) {
        setYN(td, val);
    } else if (val && val !== '') {
        td.textContent = val;
    } else {
        td.innerHTML = '<span style="color:#cbd5e1">—</span>';
    }
}

function tpl(id) {
    return document.getElementById(id).content.cloneNode(true);
}

function renderDetail(train) {
    const detail = document.getElementById('detail');
    detail.innerHTML = '';

    const card = tpl('tpl-detail-card');
    card.querySelector('.train-num').textContent = train.Train;
    card.querySelector('.type-badge').textContent = CAR_CLASS_MAP[train.CarClass] || train.CarClass || '';
    const infoTbody = card.querySelector('tbody');
    
    const displayObj = { ...train };
    
    delete displayObj.OverNightStn;
    delete displayObj.OverNightStationID;
    
    const calculatedStn = findOverNightStation(train.TimeInfos);
    if (calculatedStn) {
        displayObj.CalculatedOverNightStn = calculatedStn;
    }

    Object.entries(displayObj)
        .filter(([k, v]) => {
            if (k === 'TimeInfos') return false;
            if (IGNORE_KEYS.has(k)) return false; 
            return true;
        })
        .forEach(([k, v]) => {
            let displayVal = v;
            
            if (k === 'CalculatedOverNightStn') {
                const stnName = Route[v]?.DSC || '';
                displayVal = stnName ? `${v} ${stnName}` : v;
            }

            const row = tpl('tpl-info-row');
            row.querySelector('.info-key').textContent = KEYS_ZH[k] || k;
            row.querySelector('.info-val').textContent = ''; 
            fillInfoVal(row.querySelector('.info-val'), k, displayVal);
            infoTbody.appendChild(row);
        });
    detail.appendChild(card);

    const section = tpl('tpl-time-section');
    section.querySelector('.section-title').textContent =
        `TimeInfos — 時刻表（${(train.TimeInfos || []).length} 站）`;
    const timeTbody = section.querySelector('tbody');
    (train.TimeInfos || []).forEach(t => {
        const row = tpl('tpl-time-row');
        row.querySelector('.order').textContent = t.Order;
        row.querySelector('.station').textContent = Route[t.Station]?.DSC ?? t.Station;
        row.querySelector('.arr').textContent = t.ARRTime || '—';
        row.querySelector('.dep').textContent = t.DEPTime || '—';
        row.querySelector('.route').textContent = t.Route || '—';
        timeTbody.appendChild(row);
    });
    
    detail.appendChild(section);

    const spacer = document.createElement('div');
    spacer.style.height = '120px';
    spacer.style.width = '100%';
    spacer.style.opacity = '0';
    spacer.style.pointerEvents = 'none'; 
    detail.appendChild(spacer);
}

const cache = {};
let activeFile = null;
let activeTrain = null;
let selectedType = null;
let currentTrains = [];

async function loadFile(filename) {
    if (cache[filename]) return cache[filename];

    let rawData = null;
    let source = '';

    try {
        console.log(`⏳ [1] 正在尋找你的 GitHub: ${filename} ...`);
        const basePath = filename === 'final_train_diagram.json' ? '' : 'data/';
        const myGithubUrl = `https://raw.githubusercontent.com/mochi-artist/artist/main/${basePath}${filename}`;
        
        const res = await fetch(myGithubUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error('你的 GitHub 尚未上傳或無此檔案');
        
        rawData = await res.json();
        source = '你的 GitHub (mochi-artist)';

    } catch (err1) {
        try {
            console.log(`⏳ [2] 你這邊沒資料，前往 Billy 的雲端尋找備用資料...`);
            const billyPath = filename === 'final_train_diagram.json' ? '' : 'data/';
            const billyUrl = `https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/${billyPath}${filename}`;
            
            const res2 = await fetch(billyUrl, { cache: 'no-store' });
            if (!res2.ok) throw new Error('Billy 那邊也刪除或沒有了');
            
            rawData = await res2.json();
            source = 'Billy 的 GitHub';

        } catch (err2) {
            console.error(`❌ 徹底失敗：兩個資料庫都找不到 ${filename}`);
            return []; 
        }
    }

    let trainArray = [];
    if (Array.isArray(rawData)) {
        trainArray = rawData;
    } else if (rawData && rawData.TrainInfos) {
        trainArray = rawData.TrainInfos;
    } else if (rawData && rawData.Trains) {
        trainArray = rawData.Trains;
    } else {
        console.error("❌ 無法解析 JSON 結構：找不到車次陣列！", rawData);
        return [];
    }

    console.log(`✅ 成功從 [${source}] 讀取，解析出 ${trainArray.length} 筆車次！`);
    cache[filename] = trainArray;
    return cache[filename];
}

function selectTrain(train, itemEl) {
    document.querySelectorAll('.train-item').forEach(el => el.classList.remove('active'));
    itemEl.classList.add('active');
    activeTrain = train.Train;
    document.getElementById('placeholder').style.display = 'none';
    const detail = document.getElementById('detail');
    detail.style.display = 'block';
    renderDetail(train);
    document.getElementById('detail-scroll').scrollTop = 0;
}

function renderFilterPanel(trains) {
    const filterEl = document.getElementById('type-filter');
    filterEl.innerHTML = '';

    const counts = {};
    let overnightCount = 0;

    trains.forEach(t => {
        const cat = getTrainCategory(t.CarClass);
        counts[cat] = (counts[cat] || 0) + 1;

        if (cat !== '客迴' && findOverNightStation(t.TimeInfos) !== null) {
            overnightCount++;
        }
    });

    const allFrag = tpl('tpl-filter-item');
    const allEl = allFrag.firstElementChild;
    allEl.querySelector('.f-name').textContent = '全部';
    allEl.querySelector('.f-count').textContent = trains.length;
    if (selectedType === null) allEl.classList.add('active');
    allEl.addEventListener('click', () => {
        selectedType = null;
        renderFilterPanel(currentTrains);
        renderTrainList(currentTrains);
    });
    filterEl.appendChild(allEl);

    CATEGORY_ORDER.filter(cat => counts[cat]).forEach(cat => {
        const frag = tpl('tpl-filter-item');
        const el = frag.firstElementChild;
        el.querySelector('.f-name').textContent = cat;
        el.querySelector('.f-count').textContent = counts[cat];
        if (selectedType === cat) el.classList.add('active');
        el.addEventListener('click', () => {
            selectedType = cat;
            renderFilterPanel(currentTrains);
            renderTrainList(currentTrains);
        });
        filterEl.appendChild(el);
    });

    if (overnightCount > 0) {
        const frag = tpl('tpl-filter-item');
        const el = frag.firstElementChild;
        el.querySelector('.f-name').textContent = '跨夜正班車';
        el.querySelector('.f-name').style.color = '#eab308'; 
        el.querySelector('.f-count').textContent = overnightCount;
        if (selectedType === '跨夜正班車') el.classList.add('active');
        el.addEventListener('click', () => {
            selectedType = '跨夜正班車';
            renderFilterPanel(currentTrains);
            renderTrainList(currentTrains);
        });
        filterEl.appendChild(el);
    }
}

function renderTrainList(trains) {
    const listEl = document.getElementById('train-list');
    
    let filtered = trains;
    if (selectedType === '跨夜正班車') {
        filtered = trains.filter(t => getTrainCategory(t.CarClass) !== '客迴' && findOverNightStation(t.TimeInfos) !== null);
    } else if (selectedType) {
        filtered = trains.filter(t => getTrainCategory(t.CarClass) === selectedType);
    }

    if (!filtered.length) {
        listEl.innerHTML = '<div class="panel-empty">無資料</div>';
        return;
    }
    listEl.innerHTML = '';
    
    [...filtered].sort((a, b) => {
        const numA = parseInt(a.Train, 10) || 0;
        const numB = parseInt(b.Train, 10) || 0;
        if (numA !== numB) {
            return numA - numB;
        }
        return a.Train.localeCompare(b.Train);
    }).forEach(train => {
        const frag = tpl('tpl-train-item');
        const el = frag.firstElementChild;
        el.querySelector('.t-num').textContent = train.Train;
        el.querySelector('.t-meta').textContent =
            `${CAR_CLASS_MAP[train.CarClass] || train.CarClass || TRAIN_TYPE_MAP[train.Type] || ''} · ${(train.TimeInfos || []).length}站`;
        if (train.Train === activeTrain) el.classList.add('active');
        el.addEventListener('click', () => selectTrain(train, el));
        listEl.appendChild(el);
    });
}

async function selectFile(filename, itemEl) {
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');
    
    activeFile = filename;
    activeTrain = null;

    document.getElementById('train-list').innerHTML = '<div class="panel-empty"><span class="loading-dots">載入中</span></div>';
    document.getElementById('type-filter').innerHTML = '<div class="panel-empty">—</div>';
    document.getElementById('placeholder').style.display = 'flex';
    document.getElementById('detail').style.display = 'none';

    selectedType = null;
    
    let allTrains = await loadFile(filename);
    
    if (filename === 'final_train_diagram.json') {
        currentTrains = allTrains;
        document.getElementById('status').textContent = `全車次總表 — 共 ${currentTrains.length} 筆`;
    } else {
        const dateStr = filename.replace('.json', '');
        const specialSet = specialTrainsByDate[dateStr] || new Set();
        currentTrains = allTrains.filter(t => specialSet.has(t.Train));
        document.getElementById('status').textContent = `${filename} — 共 ${currentTrains.length} 筆`;
    }

    renderFilterPanel(currentTrains);
    renderTrainList(currentTrains);
}

// ==========================================
// 💡 初始化與左側「月份資料夾」渲染
// ==========================================
async function init() {
    await loadSpecialTrainsLog();

    const routeData = await fetch('js/references/Route.json').then(r => r.json());
    Route = routeData;

    const listEl = document.getElementById('file-list');
    listEl.innerHTML = '';

    const monthElements = {};
    const jumpSelect = document.createElement('select');

    // 1. 全車次總表 (置頂)
    const masterEl = document.createElement('div');
    masterEl.className = 'file-item';
    masterEl.innerHTML = `<span class="file-date">全車次總表</span><span class="file-count">基準檔</span>`;
    
    masterEl.addEventListener('click', () => {
        selectFile('final_train_diagram.json', masterEl);
        Object.values(monthElements).forEach(group => {
            group.container.style.display = 'none';
            group.header.innerHTML = `<span style="white-space:nowrap">${group.shortYear}年${group.month}月</span> <span style="color:#94a3b8; font-size:0.7rem; font-weight:normal; white-space:nowrap">${group.daysLen}天 ▸</span>`;
        });
        jumpSelect.value = '';
    });
    listEl.appendChild(masterEl);

    const logDates = Object.keys(specialTrainsByDate).sort();

    if (logDates.length === 0) {
        listEl.innerHTML += '<div class="panel-empty">無特殊車次紀錄</div>';
        document.getElementById('status').textContent = `0 個日期檔案`;
        return;
    }

    // 2. 將日期依照 YYYYMM 進行分組
    const groups = {};
    logDates.forEach(dateStr => {
        const monthKey = dateStr.slice(0, 6); 
        if (!groups[monthKey]) groups[monthKey] = [];
        groups[monthKey].push(dateStr);
    });

    // 💡 [更新] 大幅縮減快速跳轉選單的 Padding 和字體大小
    const jumpContainer = document.createElement('div');
    jumpContainer.style.padding = '6px 4px';
    jumpContainer.style.backgroundColor = '#0f172a';
    jumpContainer.style.position = 'sticky'; 
    jumpContainer.style.top = '0';
    jumpContainer.style.zIndex = '10';
    jumpContainer.style.borderBottom = '1px solid #1e293b';

    jumpSelect.style.width = '100%';
    jumpSelect.style.padding = '4px 2px';
    jumpSelect.style.fontSize = '0.75rem';
    jumpSelect.style.backgroundColor = '#1e293b';
    jumpSelect.style.color = '#e2e8f0';
    jumpSelect.style.border = '1px solid #334155';
    jumpSelect.style.borderRadius = '4px';
    jumpSelect.style.outline = 'none';

    const defaultOpt = document.createElement('option');
    defaultOpt.textContent = '跳轉月份...';
    defaultOpt.value = '';
    jumpSelect.appendChild(defaultOpt);
    jumpContainer.appendChild(jumpSelect);
    listEl.appendChild(jumpContainer);

    // 3. 依序渲染每個月份的「資料夾標題」與內含的「檔案」
    Object.keys(groups).sort().forEach(monthKey => {
        const year = monthKey.slice(0, 4);
        const shortYear = monthKey.slice(2, 4); // 取得 26
        const month = monthKey.slice(4, 6);
        const days = groups[monthKey];

        jumpSelect.appendChild(new Option(`${year}年${month}月`, monthKey));

        const headerEl = document.createElement('div');
        headerEl.style.padding = '8px 4px';
        headerEl.style.backgroundColor = '#0f172a';
        headerEl.style.color = '#e2e8f0';
        headerEl.style.fontSize = '0.75rem'; // 字體縮小
        headerEl.style.fontWeight = 'bold';
        headerEl.style.cursor = 'pointer';
        headerEl.style.display = 'flex';
        headerEl.style.justifyContent = 'space-between';
        headerEl.style.position = 'sticky'; 
        headerEl.style.top = '40px'; 
        headerEl.style.zIndex = '5';
        headerEl.style.borderBottom = '1px solid #1e293b';
        
        // 💡 [更新] 拿掉圖示，縮寫為 "26年01月"，並強制不換行 (nowrap)
        headerEl.innerHTML = `<span style="white-space:nowrap">${shortYear}年${month}月</span> <span style="color:#94a3b8; font-size:0.7rem; font-weight:normal; white-space:nowrap">${days.length}天 ▸</span>`;

        const containerEl = document.createElement('div');
        containerEl.style.display = 'none'; 

        headerEl.addEventListener('click', () => {
            const isExpanded = containerEl.style.display !== 'none';
            containerEl.style.display = isExpanded ? 'none' : 'block';
            headerEl.innerHTML = `<span style="white-space:nowrap">${shortYear}年${month}月</span> <span style="color:#94a3b8; font-size:0.7rem; font-weight:normal; white-space:nowrap">${days.length}天 ${isExpanded ? '▸' : '▾'}</span>`;
        });

        listEl.appendChild(headerEl);

        days.forEach(dateStr => {
            const filename = `${dateStr}.json`; 
            const formatted = `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
            const countInLog = specialTrainsByDate[dateStr].size;

            const el = document.createElement('div');
            el.className = 'file-item';
            el.style.paddingLeft = '10px'; // 大幅減少手機版的內縮空間
            el.innerHTML = `<span class="file-date">${formatted}</span><span class="file-count">${countInLog} 車次</span>`;
            
            el.addEventListener('click', () => selectFile(filename, el));
            containerEl.appendChild(el);
        });

        listEl.appendChild(containerEl);

        monthElements[monthKey] = { header: headerEl, container: containerEl, year, shortYear, month, daysLen: days.length };
    });

    jumpSelect.addEventListener('change', (e) => {
        const targetKey = e.target.value;
        if (!targetKey || !monthElements[targetKey]) return;

        Object.values(monthElements).forEach(group => {
            group.container.style.display = 'none';
            group.header.innerHTML = `<span style="white-space:nowrap">${group.shortYear}年${group.month}月</span> <span style="color:#94a3b8; font-size:0.7rem; font-weight:normal; white-space:nowrap">${group.daysLen}天 ▸</span>`;
        });

        const { header, container, shortYear, month, daysLen } = monthElements[targetKey];
        container.style.display = 'block';
        header.innerHTML = `<span style="white-space:nowrap">${shortYear}年${month}月</span> <span style="color:#94a3b8; font-size:0.7rem; font-weight:normal; white-space:nowrap">${daysLen}天 ▾</span>`;

        header.scrollIntoView({ behavior: 'smooth', block: 'start' });
        jumpSelect.value = '';
    });

    document.getElementById('status').textContent = `${logDates.length} 個日期檔案 + 1 份基準檔`;
}

init().catch(err => {
    document.getElementById('file-list').innerHTML = `<div class="panel-empty">載入失敗：${err.message}</div>`;
});
