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

const CATEGORY_ORDER = ['新自強', '太魯閣', '普悠瑪', '自強', '柴聯自強', '莒光', '區間車', '區間快', '普快車', '專列', '其他'];

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
    return CAR_CLASS_CATEGORY[carClass] || '其他';
}

const KEYS_ZH = {
    Type: '列車型態', Train: '車次', BreastFeed: '哺(集)乳室',
    Route: '路線', Package: '行李(託運)服務', OverNightStn: '跨日車站代碼',
    LineDir: '行駛方向', Line: '經由路線', Dinning: '餐車',
    FoodSrv: '訂餐(便當)服務', Cripple: '輪椅座', CarClass: '列車種類',
    Bike: '攜帶自行車', ExtraTrain: '加班車', Everyday: '每日行駛',
    Note: '備註', NoteEng: '英文備註'
};

const YN_KEYS = new Set(['BreastFeed', 'Package', 'Dinning', 'FoodSrv', 'Cripple', 'Bike', 'ExtraTrain', 'Everyday']);

let Route = {};

// ==========================================
// 💡 [新增] 特殊車次日誌解析專區
// ==========================================
let specialTrainsByDate = {};

async function loadSpecialTrainsLog() {
    try {
        const res = await fetch('scan_log.txt');
        const text = await res.text();
        
        let currentDate = null;
        const lines = text.split('\n');
        
        for (const line of lines) {
            // 1. 抓日期
            const dateMatch = line.match(/日期:\s*(\d{8})/);
            if (dateMatch) {
                currentDate = dateMatch[1];
                if (!specialTrainsByDate[currentDate]) {
                    specialTrainsByDate[currentDate] = new Set();
                }
                continue;
            }
            
            // 2. 抓車次號碼 (強化版防彈寫法)
            // 只要這行不是「第 x 次讀取」，且包含 [車次]，就抓出來
            if (currentDate && !line.includes('次讀取')) {
                // 支援半形 [1404] 或全形 ［1404］
                const trainMatch = line.match(/[\[［]([a-zA-Z0-9]+)[\]］]/);
                if (trainMatch) {
                    specialTrainsByDate[currentDate].add(trainMatch[1]);
                }
            }
        }
        console.log("日誌解析完成！", specialTrainsByDate);
    } catch (error) {
        console.error('無法讀取或解析 scan_log.txt', error);
    }
}
// ==========================================

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
    Object.entries(train)
        .filter(([k]) => k !== 'TimeInfos')
        .forEach(([k, v]) => {
            const row = tpl('tpl-info-row');
            row.querySelector('.info-key').textContent = KEYS_ZH[k] || k;
            row.querySelector('.info-val').textContent = ''; // Clear placeholder
            fillInfoVal(row.querySelector('.info-val'), k, v);
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
    
    // 把時刻表塞進去
    detail.appendChild(section);

    // ==========================================
    // 💡 [新增] 100% 絕對有效的物理墊高防護罩
    // 確保手機版最後一站絕對不會被吃掉！
    // ==========================================
    const spacer = document.createElement('div');
    spacer.style.height = '120px';
    spacer.style.width = '100%';
    spacer.style.opacity = '0';
    spacer.style.pointerEvents = 'none'; // 讓它即使蓋在上面也不會阻擋點擊
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
        // 🚀 第一關：優先找你的 GitHub 庫 (你的專屬資料庫與舊資料寶藏)
        console.log(`⏳ [1] 正在尋找你的 GitHub: ${filename} ...`);
        const myGithubUrl = `https://raw.githubusercontent.com/mochi-artist/artist/main/data/${filename}`;
        const res = await fetch(myGithubUrl);
        
        if (!res.ok) throw new Error('你的 GitHub 尚未上傳或無此檔案');
        
        rawData = await res.json();
        source = '你的 GitHub (mochi-artist)';

    } catch (err1) {
        try {
            // 🚀 第二關：你這邊沒資料，前往 Billy 的 GitHub 尋找最新版
            console.log(`⏳ [2] 你這邊沒資料，前往 Billy 的雲端尋找備用資料...`);
            const billyUrl = `https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/data/${filename}`;
            const res2 = await fetch(billyUrl);
            
            if (!res2.ok) throw new Error('Billy 那邊也刪除或沒有了');
            
            rawData = await res2.json();
            source = 'Billy 的 GitHub';

        } catch (err2) {
            // ☠️ 兩邊都找不到
            console.error(`❌ 徹底失敗：兩個資料庫都找不到 ${filename}`);
            return []; // 回傳空陣列，讓畫面顯示「無資料」而不是壞掉
        }
    }

    // 🚀 資料格式相容性處理 (自動適應你或 Billy 的 JSON 格式)
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

    // 存入快取並回傳
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
    trains.forEach(t => {
        const cat = getTrainCategory(t.CarClass);
        counts[cat] = (counts[cat] || 0) + 1;
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
}

function renderTrainList(trains) {
    const listEl = document.getElementById('train-list');
    const filtered = selectedType
        ? trains.filter(t => getTrainCategory(t.CarClass) === selectedType)
        : trains;
    if (!filtered.length) {
        listEl.innerHTML = '<div class="panel-empty">無資料</div>';
        return;
    }
    listEl.innerHTML = '';
    [...filtered].sort((a, b) => Number(a.Train) - Number(b.Train)).forEach(train => {
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
    itemEl.classList.add('active');
    activeFile = filename;
    activeTrain = null;

    document.getElementById('train-list').innerHTML = '<div class="panel-empty"><span class="loading-dots">載入中</span></div>';
    document.getElementById('type-filter').innerHTML = '<div class="panel-empty">—</div>';
    document.getElementById('placeholder').style.display = 'flex';
    document.getElementById('detail').style.display = 'none';

    selectedType = null;
    
    // 💡 [修改] 取得全部車次後，使用 scan_log.txt 的名單進行精準過濾
    let allTrains = await loadFile(filename);
    const dateStr = filename.replace('.json', '');
    const specialSet = specialTrainsByDate[dateStr] || new Set();
    
    currentTrains = allTrains.filter(t => specialSet.has(t.Train));

    itemEl.querySelector('.file-count').textContent = `${currentTrains.length} 車次`;
    document.getElementById('status').textContent = `${filename} — ${currentTrains.length} 筆 (已過濾特殊車次)`;
    renderFilterPanel(currentTrains);
    renderTrainList(currentTrains);
}

async function listJsonFiles() {
    // 💡 [修改] 改成直接抓取你的 GitHub Repo 裡的 data 資料夾
    const url = 'https://api.github.com/repos/mochi-artist/artist/contents/data';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        const data = await response.json();
        return data
            .map(item => item.name)
            .filter(name => /^\d{8}\.json$/.test(name))
            .sort();
    } catch (error) {
        console.error('Error fetching GitHub files:', error);
        return [];
    }
}

async function init() {
    // 1. 初始化時，先去讀取並解析 TXT 日誌檔
    await loadSpecialTrainsLog();

    // 2. 取得 Route.json (為了顯示車站中文名稱)
    const routeData = await fetch('js/references/Route.json').then(r => r.json());
    Route = routeData;

    const listEl = document.getElementById('file-list');
    listEl.innerHTML = '';

    // 💡 [關鍵修改] 捨棄去 GitHub API 撈所有檔案
    // 改成直接從我們剛解析好的 specialTrainsByDate 裡面拿出「有紀錄的日期」
    const logDates = Object.keys(specialTrainsByDate).sort();

    // 如果 TXT 檔裡沒讀到任何日期
    if (logDates.length === 0) {
        listEl.innerHTML = '<div class="panel-empty">無特殊車次紀錄</div>';
        document.getElementById('status').textContent = `0 個日期檔案`;
        return;
    }

    // 3. 根據 TXT 裡面的日期，產生左側的列表
    logDates.forEach(dateStr => {
        // 因為檔案名稱是 "20260514.json"，我們把日期字串組裝回去
        const filename = `${dateStr}.json`; 
        
        // 把 "20260514" 變成 "2026/05/14" 的格式顯示在畫面上
        const formatted = `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
        
        // 取得該日期在 TXT 裡面紀錄了幾台車次
        const countInLog = specialTrainsByDate[dateStr].size;

        const el = document.createElement('div');
        el.className = 'file-item';
        el.innerHTML = `<span class="file-date">${formatted}</span><span class="file-count">${countInLog} 車次</span>`;
        
        // 綁定點擊事件
        el.addEventListener('click', () => selectFile(filename, el));
        listEl.appendChild(el);
    });

    // 4. 更新上方標題的統計數字
    document.getElementById('status').textContent = `${logDates.length} 個日期檔案`;
}

init().catch(err => {
    document.getElementById('file-list').innerHTML = `<div class="panel-empty">載入失敗：${err.message}</div>`;
});
