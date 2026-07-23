// D3.js 版本的 SVG 渲染模組
// 互動功能：
//   一、原生縮放與平移：交由瀏覽器原生滑動處理，徹底解決卡頓！
//   二、整合控制中心：單一按鈕展開「左側車種過濾、右側車次搜尋」
//   三、嚴格分類閘門：1、2次歸類莒光，含英文字與 3455/3456 歸類客迴，其餘特殊列車
//   四、無敵抗縮放鎖定：改用 Document 絕對座標系，徹底解決 iOS/Android 縮放時按鈕亂飛變大的死穴！
//   五、加入跳轉動畫：使用 window.scrollTo 平滑捲動至車次位置
//   六、單選/多選與恆粗鎖定：支援自由切換單多選模式，並可鎖定加粗狀態不受面板影響！
//   七、運轉停車標示：支援動態讀取 OpStops.json，於水平停靠線中點標示星星，具備「重疊迴避」功能！

// ── 模組層級狀態 ──
const _trainDataMap = new Map(); 
const _allPathEls   = new Map(); 
let _selectedPathIds = new Set(); 
let _d3Svg = null;
let _d3G = null;
let _drawnStarPositions = []; // 🌟 新增：用來記錄畫過的星星位置，以利判斷重疊

// ==========================================
// 🎨 視覺顯示濾網：清理系統標籤，保留完整車次備註
// ==========================================
function cleanTrainNoForDisplay(trainNo) {
    if (!trainNo) return "";
    let cleaned = String(trainNo);
    // 1. 消除跨日產生的標籤 (支援消除 -End, -End2 等後綴)
    cleaned = cleaned.replace(/-End\d*/g, ''); 
    // 2. 精準隱藏系統專屬標籤：只刪除 (高) 與 (林)
    cleaned = cleaned.replace(/[(（][高林][)）]/g, '');
    return cleaned;
}

// ==========================================
// 🌟 核心狀態與分類設定
// ==========================================
let _activeFilters = new Set();  
let _isBoldLocked = false;       
let _isPanelOpen = false;        
let _isMultiSelectMode = false; 
let _isTimetableMode = false; 
let _currentLineKind = null;


const _filterCategories = [
    { id: 'all', name: '全部', styles: [] },
    { id: 'emu3000', name: '新自強', styles: ['emu3000'] },
    { id: 'taroko', name: '太魯閣', styles: ['taroko'] },
    { id: 'puyuma', name: '普悠瑪', styles: ['puyuma'] },
    { id: 'tze_chiang', name: '自強', styles: ['tze_chiang', 'emu1200', 'emu300'] },
    { id: 'tze_chiang_diesel', name: '柴聯自強', styles: ['tze_chiang_diesel'] },
    { id: 'chu_kuang', name: '莒光', styles: ['chu_kuang'] },
    { id: 'local', name: '區間車', styles: ['local'] },
    { id: 'local_express', name: '區間快', styles: ['local_express'] },
    { id: 'ordinary', name: '普快車', styles: ['ordinary', 'fu_hsing'] },
    { id: 'others', name: '客迴', styles: [] }, 
    { id: 'special', name: '特殊列車', styles: [] } 
];

// 注入美化捲軸與響應式 CSS
if (!document.getElementById('d3-custom-styles')) {
    const style = document.createElement('style');
    style.id = 'd3-custom-styles';
    style.innerHTML = `
        .d3-custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .d3-custom-scrollbar::-webkit-scrollbar-track { background: transparent; } /* 全透明捲軸 */
        .d3-custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
        .d3-custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
        
        #d3-panel-body { width: 450px; }
        .d3-filter-section { width: 200px; flex: 0 0 auto; }
        .d3-search-section { flex: 1; min-width: 0; }
        .d3-search-input-field { font-size: 13px; }
        .d3-item-text { font-size: 14px; }
        .d3-item-badge { font-size: 11px; padding: 2px 8px; }

        /* 📱 手機版極小螢幕覆蓋 */
        @media (max-width: 500px) {
            #d3-panel-body { width: calc(100vw - 24px) !important; }
            .d3-filter-section { width: 45% !important; padding: 10px 6px !important; }
            .d3-search-section { padding: 10px 8px !important; }
            .d3-search-input-field { font-size: 16px !important; padding: 6px !important; }
            .d3-item-text { font-size: 12px !important; }
            .d3-item-badge { font-size: 10px !important; padding: 2px 5px !important; }
            .d3-panel-title { font-size: 12px !important; }
            
            /* 🌟 核心修正：取消彈性拉伸 (flex: 0 0 auto)，徹底消除底部的多餘黑邊！ */
            #d3-timetable-section { 
                margin-top: 8px !important; /* 將時刻表稍微往下推開一點距離 */
                flex: 0 0 auto !important;  /* 👈 關鍵：讓外框「剛好包住內容」，絕對不往下硬拉 */
            }
            /* 🌟 精準鎖定清單高度：表頭 + 5格車站 剛好約 195px */
            #d3-timetable-section .d3-custom-scrollbar { 
                max-height: 211.5px !important; 
            }
        }
        
        /* 🌟 已經將電腦版的強制加長設定 (max-height: 380px) 刪除，讓時刻表完美回歸 5 格高度 */
    `;
    document.head.appendChild(style);
}

// 智慧判定車種分類
function _getTrainCategoryId(style, train_no) {
    const base_no = train_no.replace(/-End$/, '');
    if (base_no === '1' || base_no === '2') return 'chu_kuang';
    if (base_no === '3455' || base_no === '3456') return 'others';
    if (/[a-zA-Z]/.test(base_no)) return 'others';
    for (let i = 1; i < _filterCategories.length - 2; i++) {
        if (_filterCategories[i].styles.includes(style)) return _filterCategories[i].id;
    }
    return 'special';
}

// ==========================================
// 🌟 統一視覺更新引擎
// ==========================================
function _updateAllPathVisuals() {
    _allPathEls.forEach((el, pathId) => {
        const baseId = pathId.replace(/-End$/, '');
        const baseData = _trainDataMap.get(baseId);
        if (!baseData) return;

        const isSelected = _selectedPathIds.has(baseId);
        const catId = _getTrainCategoryId(baseData.style, baseData.train_no);
        const isFiltered = _activeFilters.size > 0 && _activeFilters.has(catId);

        if (isSelected) {
            el.style('stroke-width', '6').style('opacity', '1'); 
        } else if (isFiltered && (_isPanelOpen || _isBoldLocked)) {
            el.style('stroke-width', '5').style('opacity', '1'); 
        } else {
            el.style('stroke-width', null).style('opacity', null); 
        }
    });

    if (_d3G) {
        _d3G.selectAll('text.d3-train-label').style('font-weight', null);
    }
}

function _applyFilter() {
    _updateAllPathVisuals();
    _refreshSearchResults(); 
}

function _toggleHighlight(pathId) {
    if (_isMultiSelectMode) {
        if (_selectedPathIds.has(pathId)) {
            _selectedPathIds.delete(pathId);
        } else {
            _selectedPathIds.add(pathId);
        }
    } else {
        if (_selectedPathIds.has(pathId)) {
            _selectedPathIds.delete(pathId); 
        } else {
            _selectedPathIds.clear(); 
            _selectedPathIds.add(pathId); 
        }
    }
    
    _updateAllPathVisuals();
    _refreshSearchResults();
}

// ==========================================
// 🌟 清除高亮與關閉浮動介面
// ==========================================
function _clearHighlight() {
    _selectedPathIds.clear();
    _updateAllPathVisuals();
    _refreshSearchResults();
    
    // 🌟 新增：點擊畫布空白處時，連同快速時刻表一起隱藏
    const qtc = document.getElementById('d3-quick-timetable-section');
    if (qtc) qtc.style.display = 'none';
}

// ==========================================
// 🌟 畫面跳轉與無限清單邏輯 (恢復強制置中 + 防面板遮擋機制)
// ==========================================
function _panToTrain(pathId) {
    const data = _trainDataMap.get(pathId);
    if (!data || data.firstX === undefined || data.firstY === undefined) return;

    let offsetX = 0;
    let offsetY = 0;
    if (_d3Svg && _d3Svg.node()) {
        const rect = _d3Svg.node().getBoundingClientRect();
        offsetX = rect.left + window.scrollX;
        offsetY = rect.top + window.scrollY;
    }

    const targetX = offsetX + data.firstX;
    const targetY = offsetY + data.firstY;

    // 🌟 核心防遮擋：如果是電腦版，把錨點往左算一點，這樣目標車站就會出現在右半部可視區，不會被左側面板蓋住！
    const shiftX = (window.innerWidth > 768 && _isPanelOpen) ? 225 : 0;

    // 建立隱形幽靈錨點
    const anchor = document.createElement('div');
    Object.assign(anchor.style, {
        position: 'absolute',
        left: (targetX - shiftX) + 'px',
        top: targetY + 'px',
        width: '1px',
        height: '1px',
        pointerEvents: 'none',
        visibility: 'hidden'
    });
    document.body.appendChild(anchor);

    setTimeout(() => {
        // 🌟 關鍵修復：從 nearest 改回 center，保證車站絕對出現在畫面正中央
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        // 功成身退，兩秒後刪除幽靈錨點
        setTimeout(() => document.body.removeChild(anchor), 2000);
    }, 50);
}

function _refreshSearchResults() {
    const inp  = document.getElementById('d3-search-input');
    const cont = document.getElementById('d3-search-results');
    if (!inp || !cont) return;
    _renderSearchResults(inp.value.trim(), cont);
}

// ==========================================
// 🌟 搜尋結果渲染 (自動解析線段起點，顯示 -XX端)
// ==========================================
function _renderSearchResults(query, containerElement) {
    if (!containerElement) containerElement = document.getElementById('d3-search-results');
    if (!containerElement) return;

    containerElement.innerHTML = '';
    const q = query ? query.toLowerCase() : '';
    let resultCount = 0;

    const matches = [];
    for (const [pathId, data] of _trainDataMap) {
        const catId = _getTrainCategoryId(data.style, data.train_no);
        if (_activeFilters.size > 0 && !_activeFilters.has(catId)) continue;

        const display_train_no = cleanTrainNoForDisplay(data.train_no);
        
        if (q && !display_train_no.toLowerCase().includes(q) && !data.train_no.toLowerCase().includes(q)) continue;
        
        // 🌟 核心修改：如果是 -End 分段，提取該線段畫出來的「第一站」站名
        let suffixTag = '';
        const endMatch = data.train_no.match(/-End\d*/);
        if (endMatch) {
            let firstStationName = '未知';
            // rawData 的結構是 [stationName, id, time, loc, stop]
            // 我們直接抓取陣列裡第一個點 (索引 0) 的站名 (索引 0)
            if (data.rawData && data.rawData.length > 0) {
                firstStationName = data.rawData[0][0]; 
            }
            
            // 將原本的 -End 替換為 -XX端
            suffixTag = `<span style="font-size:10px; color:#fbbf24; background:rgba(251,191,36,0.2); padding:2px 4px; border-radius:4px; margin-left:6px;">-${firstStationName}端</span>`;
        }

        matches.push({ pathId, data, display_train_no, suffixTag });
    }

    // 排序：讓同車次的 -XX端 排在原本車次的緊接著下方
    matches.sort((a, b) => {
        const cmp = a.display_train_no.localeCompare(b.display_train_no, undefined, {numeric: true});
        if (cmp === 0) return a.pathId.localeCompare(b.pathId);
        return cmp;
    });

    const fragment = document.createDocumentFragment();

    for (const match of matches) {
        const { pathId, data, display_train_no, suffixTag } = match;
        const isSelected = _selectedPathIds.has(pathId);
        
        const item = document.createElement('div');
        Object.assign(item.style, {
            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: isSelected ? 'rgba(26,115,232,0.7)' : 'transparent',
            transition: 'background 0.15s', userSelect: 'none', marginBottom: '2px',
            flex: '0 0 auto'
        });
        
        const kindLabel = (typeof _carKindLabel !== 'undefined' && _carKindLabel[data.style]) ? _carKindLabel[data.style] : data.style;
        
        // 🌟 渲染標籤
        item.innerHTML = `
            <span class="d3-item-text" style="color:${isSelected ? '#fff' : '#e2e8f0'}; display:flex; align-items:center;">
                <b>${display_train_no}</b>${suffixTag}
            </span>
            <span class="d3-item-badge" style="color:#aaa;">${kindLabel}</span>
        `;

        item.addEventListener('mouseenter', () => { if (!_selectedPathIds.has(pathId)) item.style.background = 'rgba(255,255,255,0.1)'; });
        item.addEventListener('mouseleave', () => { if (!_selectedPathIds.has(pathId)) item.style.background = 'transparent'; });
        
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 提取真正的 baseId (去除 -End) 來做為選取與高亮判斷
            const basePathId = pathId.replace(/-End\d*/g, '');
            
            if (typeof _isMultiSelectMode !== 'undefined' && _isMultiSelectMode) {
                if (_selectedPathIds.has(basePathId)) _selectedPathIds.delete(basePathId);
                else _selectedPathIds.add(basePathId);
            } else {
                _selectedPathIds.clear();
                _selectedPathIds.add(basePathId);
            }
            
            _updateAllPathVisuals();
            _renderSearchResults(query, containerElement);
            
            if (_selectedPathIds.has(basePathId)) {
                if (typeof _isTimetableMode !== 'undefined' && _isTimetableMode) {
                    if (typeof _showTimetable === 'function') {
                        // 傳入精確的 pathId (包含 -End) 給時刻表，確保讀取分段資料
                        _showTimetable(pathId, display_train_no, null);
                    }
                } else {
                    if (typeof _panToTrain === 'function') {
                        _panToTrain(pathId); 
                    }
                }
            }
        });
        
        fragment.appendChild(item);
        resultCount++;
    }

    if (resultCount === 0) {
        const empty = document.createElement('div');
        Object.assign(empty.style, { color: '#888', padding: '12px', textAlign: 'center', fontSize: '13px' });
        empty.textContent = '找不到符合的車次';
        fragment.appendChild(empty);
    }

    containerElement.appendChild(fragment);
}

// ==========================================
// 🌟 確保「快速時刻表」懸浮容器存在 (加入電腦版專屬放大 CSS + 拔除留白死角)
// ==========================================
function _ensureQuickTimetableContainer() {
    let container = document.getElementById('d3-quick-timetable-section');
    if (!container) {
        container = document.createElement('div');
        container.id = 'd3-quick-timetable-section';
        
        Object.assign(container.style, {
            position: 'absolute', 
            width: '340px', // 預設寬度，電腦版會被底下的 CSS 覆蓋
            background: 'rgba(15, 23, 42, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '12px',
            overflow: 'hidden', 
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            zIndex: '9999',
            display: 'none',
            flexDirection: 'column',
            padding: '0', // 🌟 核心修正：將 '0 0 12px 0' 改為 '0'，徹底拔除底部的留白死角
            fontFamily: 'sans-serif',
            backdropFilter: 'blur(10px)',
            boxSizing: 'border-box',
            margin: '0',
            transformOrigin: 'top left'
        });
        
        const style = document.createElement('style');
        style.innerHTML = `
            /* 手機版設定 (維持原樣) */
            @media (max-width: 768px) {
                #d3-quick-timetable-section {
                    width: 280px !important;
                }
            }
            
            /* 🌟 核心新增：專屬電腦版的額外時刻表放大設定 🌟 */
            @media (min-width: 769px) {
                #d3-quick-timetable-section {
                    width: 500px !important; /* 根據紅框比例大幅加寬 */
                }
                #d3-quick-timetable-section .d3-panel-title {
                    font-size: 18px !important; /* 標題字體放大 */
                    padding: 16px 24px 12px 24px !important;
                }
                #d3-quick-timetable-section .d3-panel-title button {
                    font-size: 32px !important; /* 關閉按鈕放大 */
                }
                #d3-quick-timetable-section .d3-custom-scrollbar {
                    max-height: 460px !important; /* 增加可視高度，顯示更多車站 */
                }
                /* 表頭放大 */
                #d3-quick-timetable-section .d3-custom-scrollbar > div:first-child {
                    font-size: 15px !important;
                    padding: 12px 24px !important;
                }
                /* 資料列放大 */
                #d3-quick-timetable-section .timetable-row {
                    padding: 12px 24px !important; /* 增加間距 */
                }
                #d3-quick-timetable-section .timetable-row > span {
                    font-size: 15px !important; /* 時間與備註文字放大 */
                }
                #d3-quick-timetable-section .timetable-row > span:first-child {
                    font-size: 18px !important; /* 車站名稱文字放大 */
                }
                #d3-quick-timetable-section .timetable-row > span:first-child > span:first-child {
                    font-size: 20px !important; /* 🚉 圖示放大 */
                    width: 36px !important;
                }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(container);

        window._updateQuickUIPos = () => {
            if (container.style.display === 'none') return;
            
            const vv = window.visualViewport;
            const scale = vv ? vv.scale : 1;
            const pL = vv ? vv.pageLeft : window.scrollX;
            const pT = vv ? vv.pageTop : window.scrollY;
            const vW = vv ? vv.width : window.innerWidth;
            
            // 🌟 座標定位修正：將電腦版的預設寬度改為 500 計算，避免彈出時偏離右側邊界
            let uiWidth = container.offsetWidth || (window.innerWidth <= 768 ? 280 : 500);

            let offsetX = 0, offsetY = 0;
            if (window.innerWidth <= 768) {
                offsetX = (vW - (uiWidth / scale)) / 2;
                offsetY = 15 / scale; 
            } else {
                offsetX = vW - (uiWidth / scale) - (20 / scale);
                offsetY = 20 / scale;
            }

            container.style.left = (pL + offsetX) + 'px';
            container.style.top = (pT + offsetY) + 'px';
            
            container.style.transform = `scale(${1 / scale}) translateZ(0)`;
        };

        if (!window._quickUIVVBound) {
            window._quickUIVVBound = true;
            if (window.visualViewport) {
                window.visualViewport.addEventListener('scroll', window._updateQuickUIPos);
                window.visualViewport.addEventListener('resize', window._updateQuickUIPos);
            }
            window.addEventListener('scroll', window._updateQuickUIPos);
        }

        const mainControlBtn = document.getElementById('d3-control-container');
        if (mainControlBtn) {
            mainControlBtn.addEventListener('click', () => {
                container.style.display = 'none';
            });
        }
    }
    return container;
}

// ==========================================
// 🌟 產生時刻表內容與點擊跳轉 (完美橫向填滿 + 色調融合)
// ==========================================
async function _showTimetable(pathId, display_train_no, clickY, targetContainerId = 'd3-timetable-section') {
    const container = document.getElementById(targetContainerId);
    if (!container) return;
    
    container.style.display = 'flex';
    const rawJsonData = window._rawTrainData;
    
    if (!rawJsonData) {
        container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 16px 8px 16px; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="color:#ff6b6b; font-weight:bold; font-size:14px;">❌ 讀取失敗</span>
            <button onclick="document.getElementById('${targetContainerId}').style.display='none';" style="background:none; border:none; color:#94a3b8; font-size:22px; padding:0; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <div style="color:#aaa; font-size:12px; padding: 8px 16px; text-align:center;">找不到時刻表原始資料，請確認是否載入成功</div>`;
        return;
    }

    try {
        const baseId = pathId.replace(/-End\d*/g, '');
        const hasSpecialChars = /[a-zA-Z\u4e00-\u9fa5]/.test(display_train_no);
        const railyards = hasSpecialChars ? [] : ['1045', '1145', '5999'];

        let exactTimes = {};
        let trueOriginId = null;
        let trueDestId = null;

        if (rawJsonData && rawJsonData.TrainInfos) {
            const trainInfo = rawJsonData.TrainInfos.find(t => 
                String(t.Train) === display_train_no || 
                String(t.TrainNo) === display_train_no || 
                String(t.Train) === baseId ||
                String(t.TrainNo) === baseId
            );
            
            if (trainInfo && trainInfo.TimeInfos) {
                const timeInfos = JSON.parse(JSON.stringify(trainInfo.TimeInfos));
                
                timeInfos.forEach((ti, index) => {
                    if ((display_train_no === '1' || display_train_no === '2') && index === timeInfos.length - 1 && String(ti.Station) === '1000') {
                        ti.Station = '1001';
                    }
                    exactTimes[String(ti.Station)] = { arr: ti.ARRTime, dep: ti.DEPTime };
                });

                const validJsonStops = timeInfos.filter(ti => !railyards.includes(String(ti.Station)));
                if (validJsonStops.length > 0) {
                    trueOriginId = String(validJsonStops[0].Station);
                    trueDestId = String(validJsonStops[validJsonStops.length - 1].Station);
                }
            }
        }

        const d3TrainData = _trainDataMap.get(pathId) || _trainDataMap.get(baseId);
        if (!d3TrainData || !d3TrainData.rawData) throw new Error("無法取得該車次的繪圖原始資料");
        
        const rawData = d3TrainData.rawData;
        let validStationIds = [];
        
        if (typeof LinesStationsForBackground !== 'undefined' && _currentLineKind) {
            const stationsOnPage = LinesStationsForBackground[_currentLineKind];
            validStationIds = Object.values(stationsOnPage).map(s => String(s.ID));
            if (validStationIds.includes('1000')) validStationIds.push('1001');
        }

        let allMergedStops = [];
        rawData.forEach((stationPoint) => {
            let [stationName, id, time, loc, stop] = stationPoint;
            if ((display_train_no === '1' || display_train_no === '2') && pathId.includes('-End') && String(id) === '1000') id = '1001';
            if (String(id) === '1001') stationName = '台北(環島)';

            const isStop = parseInt(stop, 10) !== -1;
            if (isStop) {
                if (allMergedStops.length > 0 && allMergedStops[allMergedStops.length - 1].id === String(id)) {
                    allMergedStops[allMergedStops.length - 1].depTime = time;
                } else {
                    allMergedStops.push({ stationName, id: String(id), arrTime: time, depTime: time, loc });
                }
            }
        });

        allMergedStops.forEach((stop, index) => {
            if (railyards.includes(stop.id)) stop.remark = "調車場";
            else if (stop.id === trueOriginId) stop.remark = "起站";
            else if (stop.id === trueDestId) stop.remark = "終點";
            else {
                let isStopping = exactTimes[stop.id] ? (exactTimes[stop.id].arr !== exactTimes[stop.id].dep) : (stop.arrTime !== stop.depTime);
                stop.remark = isStopping ? "停靠" : "通過";
            }
        });

        let mergedStops = allMergedStops.filter(stop => validStationIds.length === 0 || validStationIds.includes(stop.id));

        let targetStopId = null;
        if (clickY !== undefined && clickY !== null && mergedStops.length > 0) {
            let minDiff = Infinity;
            mergedStops.forEach(stop => {
                let diff = Math.abs(stop.loc + 50 - clickY);
                if (diff < minDiff) { minDiff = diff; targetStopId = stop.id; }
            });
        }

        const isQuick = targetContainerId === 'd3-quick-timetable-section';
        const closeScript = isQuick
            ? `document.getElementById('d3-quick-timetable-section').style.display='none';`
            : `document.getElementById('d3-timetable-section').style.display='none'; const cb = document.getElementById('d3-timetable-toggle'); if(cb) cb.checked=false; _isTimetableMode=false;`;

        // 🌟 標題列：將 padding 統一改為 8px 16px，讓高度與下方對齊
        const titleHTML = `
            <div class="d3-panel-title" style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; color:#fbbc04; margin-bottom:0px; padding:8px 16px; border-bottom:1px solid rgba(255,255,255,0.1); position: sticky; top: -1px; background: #131b2d; z-index: 10; transform: translateZ(0);">
                <span style="pointer-events: none;">🕒 <b>${display_train_no}</b> 車次時刻表</span>
                <button onclick="${closeScript}" style="background:none; border:none; color:#94a3b8; font-size:22px; padding:0; cursor:pointer; line-height:1; display:flex; align-items:center;">&times;</button>
            </div>`;
            
// 🌟 列表容器：將 background 改為 transparent，確保不會有死硬的黑底露出！
let listHTML = `<div class="d3-custom-scrollbar" id="d3-timetable-list-container-${targetContainerId}" style="max-height: 224px; overflow-y: auto; display:flex; flex-direction:column; position:relative; background: transparent;">`;

// 🌟 表頭列：加入 box-shadow 與 transform 強制硬體加速貼合
// 🌟 表頭列：將 padding 統一改為 8px 16px，讓高度與資料列完全相同
        listHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#8ab4f8; padding:8px 16px; border-bottom:1px solid rgba(255,255,255,0.1); margin: 0; position:sticky; top: -1px; background: #131b2d; z-index:5; transform: translateZ(0); box-shadow: 0 -1px 0 #131b2d;">
                <span style="flex: 1.2; text-align: left; display:flex; align-items:center;">
                    <span style="display:inline-block; width: 28px;"></span><span>車站</span>
                </span>
                <span style="flex: 1; text-align: center;">到站</span>
                <span style="flex: 1; text-align: center;">離站</span>
                <span style="flex: 1; text-align: center;">備註</span>
            </div>`;
        if (mergedStops.length === 0) {
            listHTML += `<div style="color:#888; text-align:center; padding:10px 0; font-size:12px;">此路線範圍內無停靠資料</div>`;
        } else {
            mergedStops.forEach((stop) => {
                let arrDisplay = exactTimes[stop.id] && exactTimes[stop.id].arr ? exactTimes[stop.id].arr.substring(0, 8) : formatTime(stop.arrTime);
                let depDisplay = exactTimes[stop.id] && exactTimes[stop.id].dep ? exactTimes[stop.id].dep.substring(0, 8) : formatTime(stop.depTime);
                
                arrDisplay = arrDisplay.replace(/:00$/, '.0').replace(/:30$/, '.5');
                depDisplay = depDisplay.replace(/:00$/, '.0').replace(/:30$/, '.5');
                
                let remarkDisplay = stop.remark; 
                let isTarget = (stop.id === targetStopId);
                
                // 🌟 恢復為透明底色，只有目標車站有淡淡的高亮
                let bgStyle = isTarget ? 'rgba(56, 189, 248, 0.25)' : 'transparent';
                let borderStyle = isTarget ? 'border-left: 3px solid #38bdf8;' : 'border-left: 3px solid transparent;';

                let remarkColor = '#aaa';
                if (remarkDisplay === '起站' || remarkDisplay === '終點') remarkColor = '#38bdf8'; 
                else if (remarkDisplay === '調車場') remarkColor = '#94a3b8'; 
                else if (remarkDisplay === '通過') remarkColor = '#fbbf24'; 
                else if (remarkDisplay === '停靠') remarkColor = '#4ade80'; 

                let timeColumnsHTML = '';
                if (remarkDisplay === '通過') {
                    timeColumnsHTML = `
                        <span style="flex: 1; text-align: center; color:#aaa; font-size:12px; pointer-events:none;">-</span>
                        <span style="flex: 1; text-align: center; color:#fbbc04; font-size:12px; pointer-events:none;">${depDisplay}</span>
                    `;
                } else {
                    timeColumnsHTML = `
                        <span style="flex: 1; text-align: center; color:#fbbc04; font-size:12px; pointer-events:none;">${arrDisplay}</span>
                        <span style="flex: 1; text-align: center; color:#fbbc04; font-size:12px; pointer-events:none;">${depDisplay}</span>
                    `;
                }

                // 🌟 核心修正：移除 margin、border-radius 與獨立背景色，加上 border-bottom 與 8px 16px 的舒適內距
                listHTML += `
                    <div class="timetable-row" id="d3-stop-row-${targetContainerId}-${stop.id}" data-time="${stop.arrTime}" data-loc="${stop.loc}" 
                         style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:8px 16px; cursor:pointer; transition: background 0.2s; border-bottom:1px solid rgba(255,255,255,0.05); background:${bgStyle}; ${borderStyle}"
                         onmouseenter="this.style.background='rgba(255,255,255,0.1)'" 
                         onmouseleave="this.style.background='${bgStyle}'">
                        
                        <span style="flex: 1.2; font-weight:bold; color:#fff; pointer-events:none; display:flex; align-items:center;">
                            <span style="display:inline-block; width: 24px; font-size:14px; text-align:left;">🚉</span><span>${stop.stationName}</span>
                        </span> 
                        
                        ${timeColumnsHTML}
                        
                        <span style="flex: 1; text-align: center; font-weight:bold; color:${remarkColor}; font-size:12px; pointer-events:none;">${remarkDisplay}</span>
                    </div>`;
            });
        }
        listHTML += `</div>`;
        container.innerHTML = titleHTML + listHTML;

        if (targetStopId) {
            setTimeout(() => {
                let targetRow = document.getElementById(`d3-stop-row-${targetContainerId}-${targetStopId}`);
                let listContainer = document.getElementById(`d3-timetable-list-container-${targetContainerId}`);
                
                if (targetRow && listContainer) {
                    let scrollPos = 0;
                    
                    if (window.innerWidth > 768) {
                        // 🌟 電腦版專屬：精準計算表頭真實高度，讓跳轉車站完美貼合在表頭正下方
                        const header = listContainer.firstElementChild;
                        const headerHeight = header ? header.offsetHeight : 0;
                        // 計算：目標車站的相對頂部位置 - 表頭高度 + 1px(補償 top: -1px 的偏差)
                        scrollPos = targetRow.offsetTop - headerHeight + 1;
                    } else {
                        // 🌟 手機版：維持原本推到上一站的設定 (不動手機版邏輯)
                        let prevRow = targetRow.previousElementSibling;
                        let targetElement = (prevRow && prevRow.classList.contains('timetable-row')) ? prevRow : targetRow;
                        scrollPos = targetElement.offsetTop;
                    }
                    
                    // 執行內部捲動
                    listContainer.scrollTo({
                        top: scrollPos, 
                        behavior: 'smooth'
                    });

                    // 維持原本的變色特效
                    setTimeout(() => {
                        targetRow.style.background = 'rgba(255,255,255,0.05)';
                        targetRow.style.borderLeft = '3px solid transparent';
                        targetRow.onmouseleave = function() { this.style.background = 'transparent'; };
                    }, 2500);
                }
            }, 150);
        }

        const rows = container.querySelectorAll('.timetable-row');
        rows.forEach(row => {
            row.addEventListener('click', function(e) {
                e.stopPropagation(); 

                const rawTime = parseFloat(this.getAttribute('data-time'));
                const rawLoc = parseFloat(this.getAttribute('data-loc'));
                if (isNaN(rawTime) || isNaN(rawLoc)) return;

                // 點擊後關閉時刻表面板
                container.style.display = 'none'; 
                if (!isQuick) {
                    const toggleCb = document.getElementById('d3-timetable-toggle');
                    if (toggleCb) toggleCb.checked = false;
                    _isTimetableMode = false;
                }

                let offsetX = 0; let offsetY = 0;
                if (typeof _d3Svg !== 'undefined' && _d3Svg && _d3Svg.node()) {
                    const rect = _d3Svg.node().getBoundingClientRect();
                    offsetX = rect.left + window.scrollX;
                    offsetY = rect.top + window.scrollY;
                }

                const startHour = (typeof DiagramHours !== 'undefined' && DiagramHours.length > 0) ? DiagramHours[0] : 4;
                
                const svgX = rawTime * 10 - 1200 * startHour + 50;
                const svgY = rawLoc + 50;
                
                const targetX = offsetX + svgX;
                const targetY = offsetY + svgY;

                // 讓錨點往下移一點，目標點就會偏畫面上方，對手機版特別好用
                const shiftY = window.innerWidth <= 768 ? (window.innerHeight * 0.15) : 0;

                const anchor = document.createElement('div');
                Object.assign(anchor.style, {
                    position: 'absolute',
                    left: targetX + 'px',
                    top: (targetY + shiftY) + 'px',
                    width: '1px',
                    height: '1px',
                    pointerEvents: 'none',
                    visibility: 'hidden'
                });
                document.body.appendChild(anchor);

                setTimeout(() => { 
                    // 🌟 關鍵修復：從 nearest 改回 center，把目標車站無情地拉回視野中心！
                    anchor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); 
                    setTimeout(() => document.body.removeChild(anchor), 2000);
                }, 50);
            });
        });

    } catch (error) {
        container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 16px 8px 16px; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="color:#ff6b6b; font-weight:bold; font-size:14px;">❌ 讀取失敗</span>
            <button onclick="document.getElementById('${targetContainerId}').style.display='none';" style="background:none; border:none; color:#94a3b8; font-size:22px; padding:0; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <div style="color:#aaa; font-size:12px; padding: 8px 16px;">${error.message}</div>`;
        console.error("時刻表解析錯誤：", error);
    }
}

// ==========================================
// 🌟 UI 控制中心 (時刻表填滿橫行 + 放大鏡連動關閉版)
// ==========================================
function _init_ui_panels() {
    if (document.getElementById('d3-ui-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'd3-ui-wrapper';
    Object.assign(wrapper.style, {
        position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px',
        zIndex: '9999', pointerEvents: 'none', overflow: 'visible'
    });

    const container = document.createElement('div');
    container.id = 'd3-control-container';
    Object.assign(container.style, {
        position: 'absolute', right: '0px', bottom: '0px', display: 'flex',
        flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none', transformOrigin: 'bottom right' 
    });

    const panelBody = document.createElement('div');
    panelBody.id = 'd3-panel-body';
    Object.assign(panelBody.style, {
        background: '#131b2d', // ✅ 改成純實心的深藍/黑底色
        color: '#fff', borderRadius: '12px', 
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'none', 
        flexDirection: 'column', 
        maxHeight: 'calc(100vh - 90px)',
        fontFamily: 'Tahoma, Verdana, sans-serif',
        opacity: '0', transform: 'translateY(12px)', transition: 'opacity 0.2s, transform 0.2s',
        pointerEvents: 'all', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden'
    });

    const topSectionContainer = document.createElement('div');
    Object.assign(topSectionContainer.style, { 
        display: 'flex', flexDirection: 'row', width: '100%',
        flex: '1 1 auto',
        minHeight: '0'
    });

    // --- 左側：過濾區塊 ---
    const filterSection = document.createElement('div');
    filterSection.className = 'd3-filter-section d3-custom-scrollbar';
    Object.assign(filterSection.style, { 
        padding: '12px', borderRight: '1px solid rgba(255,255,255,0.1)', 
        maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' 
    });

    const filterTitle = document.createElement('div');
    filterTitle.className = 'd3-panel-title';
    filterTitle.innerHTML = '🎛️ 此頁面車種過濾';
    Object.assign(filterTitle.style, { fontWeight: 'bold', color: '#8ab4f8', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' });

    const boldToggleContainer = document.createElement('div');
    Object.assign(boldToggleContainer.style, {
        display: 'flex', alignItems: 'center', marginBottom: '4px',
        fontSize: '12px', color: '#e2e8f0', cursor: 'pointer',
        padding: '4px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px'
    });
    const boldToggleCb = document.createElement('input');
    boldToggleCb.type = 'checkbox';
    boldToggleCb.id = 'd3-bold-toggle';
    boldToggleCb.checked = _isBoldLocked;
    Object.assign(boldToggleCb.style, { marginRight: '6px', cursor: 'pointer' });
    const boldToggleLabel = document.createElement('label');
    boldToggleLabel.htmlFor = 'd3-bold-toggle';
    boldToggleLabel.textContent = '關閉面板保持線條加粗';
    Object.assign(boldToggleLabel.style, { cursor: 'pointer', userSelect: 'none' });
    boldToggleCb.addEventListener('change', (e) => {
        _isBoldLocked = e.target.checked;
        _updateAllPathVisuals();
    });
    boldToggleContainer.appendChild(boldToggleCb);
    boldToggleContainer.appendChild(boldToggleLabel);

    const multiToggleContainer = document.createElement('div');
    Object.assign(multiToggleContainer.style, {
        display: 'flex', alignItems: 'center', marginBottom: '8px',
        fontSize: '12px', color: '#e2e8f0', cursor: 'pointer',
        padding: '4px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px'
    });
    const multiToggleCb = document.createElement('input');
    multiToggleCb.type = 'checkbox';
    multiToggleCb.id = 'd3-multi-toggle';
    multiToggleCb.checked = _isMultiSelectMode;
    Object.assign(multiToggleCb.style, { marginRight: '6px', cursor: 'pointer' });
    const multiToggleLabel = document.createElement('label');
    multiToggleLabel.htmlFor = 'd3-multi-toggle';
    multiToggleLabel.textContent = '啟用多選功能 (車種/車次)';
    Object.assign(multiToggleLabel.style, { cursor: 'pointer', userSelect: 'none' });
    multiToggleCb.addEventListener('change', (e) => {
        _isMultiSelectMode = e.target.checked;
        if (!_isMultiSelectMode) {
            if (_activeFilters.size > 1) _activeFilters.clear();
            if (_selectedPathIds.size > 1) _selectedPathIds.clear();
            _renderFilterList();
            _applyFilter();
        }
    });
    multiToggleContainer.appendChild(multiToggleCb);
    multiToggleContainer.appendChild(multiToggleLabel);

    const timetableToggleContainer = document.createElement('div');
    Object.assign(timetableToggleContainer.style, {
        display: 'flex', alignItems: 'center', marginBottom: '8px',
        fontSize: '12px', color: '#fbbc04', cursor: 'pointer',
        padding: '4px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px'
    });
    const timetableToggleCb = document.createElement('input');
    timetableToggleCb.type = 'checkbox';
    timetableToggleCb.id = 'd3-timetable-toggle';
    timetableToggleCb.checked = _isTimetableMode;
    Object.assign(timetableToggleCb.style, { marginRight: '6px', cursor: 'pointer' });
    const timetableToggleLabel = document.createElement('label');
    timetableToggleLabel.htmlFor = 'd3-timetable-toggle';
    timetableToggleLabel.textContent = '點擊車次顯示時刻表';
    Object.assign(timetableToggleLabel.style, { cursor: 'pointer', userSelect: 'none' });
    timetableToggleCb.addEventListener('change', (e) => {
        _isTimetableMode = e.target.checked;
        const ts = document.getElementById('d3-timetable-section');
        if (!_isTimetableMode && ts) {
            ts.style.display = 'none';
        }
    });
    timetableToggleContainer.appendChild(timetableToggleCb);
    timetableToggleContainer.appendChild(timetableToggleLabel);

    const filterList = document.createElement('div');
    
    function _renderFilterList() {
        filterList.innerHTML = '';
        const counts = {};
        _filterCategories.forEach(c => counts[c.id] = 0);
        
        let total = 0;
        for (const [pathId, data] of _trainDataMap) {
            if (data.train_no.endsWith('-End')) continue;
            counts[_getTrainCategoryId(data.style, data.train_no)]++;
            total++;
        }
        counts['all'] = total;

        _filterCategories.forEach(cat => {
            if (counts[cat.id] === 0 && cat.id !== 'all' && cat.id !== 'special') return;

            const item = document.createElement('div');
            const isAllCat = cat.id === 'all';
            const isActive = isAllCat ? (_activeFilters.size === 0) : _activeFilters.has(cat.id);
            
            Object.assign(item.style, {
                padding: '6px 8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'transparent', borderRadius: '6px',
                transition: 'background 0.1s', userSelect: 'none', color: isActive ? '#38bdf8' : '#e2e8f0', fontWeight: isActive ? 'bold' : 'normal'
            });
            
            item.innerHTML = `<span class="d3-item-text">${cat.name}</span> <span class="d3-item-badge" style="background: rgba(0,0,0,0.3); border-radius:10px; color:#cbd5e1">${counts[cat.id]}</span>`;
            
            item.addEventListener('click', () => { 
                if (isAllCat) {
                    _activeFilters.clear(); 
                } else {
                    if (_isMultiSelectMode) {
                        if (_activeFilters.has(cat.id)) _activeFilters.delete(cat.id); 
                        else _activeFilters.add(cat.id); 
                    } else {
                        if (_activeFilters.has(cat.id)) {
                            _activeFilters.delete(cat.id);
                        } else {
                            _activeFilters.clear();
                            _activeFilters.add(cat.id);
                        }
                    }
                }
                _renderFilterList(); 
                _applyFilter(); 
            });
            filterList.appendChild(item);
        });
    }
    
    filterSection.appendChild(filterTitle);
    filterSection.appendChild(boldToggleContainer);
    filterSection.appendChild(multiToggleContainer); 
    filterSection.appendChild(timetableToggleContainer);
    filterSection.appendChild(filterList);

    // --- 右側：搜尋區塊 ---
    const searchSection = document.createElement('div');
    searchSection.className = 'd3-search-section';
    Object.assign(searchSection.style, { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' });

    const searchTitle = document.createElement('div');
    searchTitle.className = 'd3-panel-title';
    searchTitle.innerHTML = '🔍 車次搜尋定位';
    Object.assign(searchTitle.style, { fontWeight: 'bold', color: '#8ab4f8', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' });

    const searchInput = document.createElement('input');
    searchInput.id = 'd3-search-input';
    searchInput.className = 'd3-search-input-field';
    searchInput.type = 'text';
    searchInput.placeholder = '輸入車次號碼...';
    Object.assign(searchInput.style, {
        width: '100%', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', 
        background: 'rgba(0,0,0,0.3)', color: '#fff', boxSizing: 'border-box', outline: 'none', padding: '6px 8px'
    });
    searchInput.addEventListener('focus', () => searchInput.style.borderColor = '#38bdf8');
    searchInput.addEventListener('blur', () => searchInput.style.borderColor = 'rgba(255,255,255,0.2)');

    const searchResults = document.createElement('div');
    searchResults.id = 'd3-search-results';
    searchResults.className = 'd3-custom-scrollbar';
    Object.assign(searchResults.style, { maxHeight: '230px', overflowY: 'auto', display: 'flex', flexDirection: 'column', marginTop: '4px' });

    searchSection.appendChild(searchTitle);
    searchSection.appendChild(searchInput);
    searchSection.appendChild(searchResults);

    topSectionContainer.appendChild(filterSection);
    topSectionContainer.appendChild(searchSection);

    // 🌟 核心修改：移除 12px 底部留白，並強制加入「透明底色」、「底部圓角」與「溢出裁切」
    const timetableSection = document.createElement('div');
    timetableSection.id = 'd3-timetable-section';
    timetableSection.className = 'd3-custom-scrollbar';
    Object.assign(timetableSection.style, {
        display: 'none', 
        flexDirection: 'column', 
        padding: '0', // 👈 拔除底部的 12px 死角
        borderTop: '1px solid rgba(255,255,255,0.1)', 
        background: 'transparent', // 👈 改為透明，自然融合主面板底色
        borderBottomLeftRadius: '12px',  // 👈 強制加上左下圓角
        borderBottomRightRadius: '12px', // 👈 強制加上右下圓角
        overflow: 'hidden', // 👈 強制裁切內部超出圓角的資料列
        flex: '1 1 auto',
        minHeight: '0'
    });

    panelBody.appendChild(topSectionContainer);
    panelBody.appendChild(timetableSection);

    // --- 觸發按鈕 ---
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '🔍';
    Object.assign(toggleBtn.style, {
        width: '50px', height: '50px', borderRadius: '50%', border: 'none', background: '#1a73e8', color: '#fff',
        fontSize: '22px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', 
        boxShadow: '0 4px 16px rgba(26, 115, 232, 0.4)', transition: 'background 0.2s', pointerEvents: 'all', marginTop: '8px',
        touchAction: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent'
    });

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        const qtc = document.getElementById('d3-quick-timetable-section');
        if (qtc) qtc.style.display = 'none';

        _isPanelOpen = !_isPanelOpen;
        if (_isPanelOpen) {
            _renderFilterList(); 
            panelBody.style.display = 'flex';
            requestAnimationFrame(() => { 
                // 🌟 把原本的 panelBody.style.opacity = '1'; 改成下面這行：
                panelBody.style.setProperty('opacity', '1', 'important'); 
                panelBody.style.transform = 'translateY(0)'; 
            });
            toggleBtn.textContent = '✕';
            toggleBtn.style.background = '#c5221f';
            _renderSearchResults('', searchResults);
        } else {
            panelBody.style.opacity = '0'; 
            panelBody.style.transform = 'translateY(12px)';
            setTimeout(() => { panelBody.style.display = 'none'; }, 200);
            toggleBtn.textContent = '🔍';
            toggleBtn.style.background = '#1a73e8';
        }
        _updateAllPathVisuals();
    });

    searchInput.addEventListener('input', () => _renderSearchResults(searchInput.value.trim(), searchResults));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _isPanelOpen) toggleBtn.click(); });

    container.appendChild(panelBody);
    container.appendChild(toggleBtn);
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);

    panelBody.addEventListener('click', (e) => e.stopPropagation());

    if (window.visualViewport) {
        const vv = window.visualViewport;
        let basePageX = 0;
        let basePageY = 0;

        const updateBasePos = () => {
            wrapper.style.transform = 'none';
            const rect = wrapper.getBoundingClientRect();
            basePageX = rect.left + window.scrollX;
            basePageY = rect.top + window.scrollY;
        };

        const updatePos = () => {
            const scale = vv.scale;
            const margin = 12; 
            
            const targetX = vv.pageLeft + vv.width - (margin / scale);
            const targetY = vv.pageTop + vv.height - (margin / scale);
            
            const dx = targetX - basePageX;
            const dy = targetY - basePageY;
            
            wrapper.style.transform = `translate(${dx}px, ${dy}px)`;
            container.style.transform = `scale(${1 / scale})`;
        };

        updateBasePos();
        updatePos();

        vv.addEventListener('scroll', updatePos);
        vv.addEventListener('resize', () => { updateBasePos(); updatePos(); });
        window.addEventListener('scroll', updatePos);
        setTimeout(() => { updateBasePos(); updatePos(); }, 300);
    }
}

// ==========================================
// 🌟 動態抓取資料並寫出時刻表 (排版絕對鎖死版)
// ==========================================
async function _fetchAndShowTimetable(pathId, display_train_no) {
    const container = document.getElementById('d3-timetable-section');
    if (!container) return;
    
    // 🌟 關鍵修復 1：強制外層容器為「垂直排列(column)」，避免水平擠壓
    container.style.display = 'flex';
    container.style.flexDirection = 'column'; 
    container.style.overflow = 'hidden'; 
    container.innerHTML = '<div style="padding:10px; color:#aaa; text-align:center;">載入時刻表資料中...</div>';

    // 🌟 1. 抓取網址參數
    const urlParams = new URLSearchParams(window.location.search);
    const revisedJson = urlParams.get('revisedJson'); 
    const currentDate = urlParams.get('formattedDate') || urlParams.get('date');

    let jsonPath = '';
    if (revisedJson) {
        jsonPath = revisedJson;
    } else if (currentDate) {
        jsonPath = `data/${currentDate}.json`;
    } else {
        const d = new Date();
        const yyyymmdd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        jsonPath = `data/${yyyymmdd}.json`;
    }

    try {
        // 🌟 2. 讀取 JSON 並快取
        if (!window._rawJsonCache || window._rawJsonPath !== jsonPath) {
            const response = await fetch(jsonPath);
            if (!response.ok) throw new Error(`找不到檔案 ${jsonPath}`);
            window._rawJsonCache = await response.json();
            window._rawJsonPath = jsonPath;
        }

        const rawJsonData = window._rawJsonCache;
        const baseId = pathId.replace(/-End\d*/g, '');

        // 🌟 3. 建立精確時間字典
        let exactTimes = {};
        if (rawJsonData && rawJsonData.TrainInfos) {
            const trainInfo = rawJsonData.TrainInfos.find(t => 
                String(t.Train) === display_train_no || 
                String(t.TrainNo) === display_train_no || 
                String(t.Train) === baseId ||
                String(t.TrainNo) === baseId
            );
            
            if (trainInfo && trainInfo.TimeInfos) {
                trainInfo.TimeInfos.forEach(ti => {
                    exactTimes[String(ti.Station)] = { arr: ti.ARRTime, dep: ti.DEPTime };
                });
            }
        }

        // 🌟 4. 從 D3 畫布抓取原始資料
        const d3TrainData = _trainDataMap.get(pathId) || _trainDataMap.get(baseId);
        if (!d3TrainData || !d3TrainData.rawData) {
            throw new Error("無法取得該車次的繪圖原始資料");
        }
        
        const rawData = d3TrainData.rawData;
        let validStationIds = [];
        if (typeof LinesStationsForBackground !== 'undefined' && _currentLineKind) {
            const stationsOnPage = LinesStationsForBackground[_currentLineKind];
            validStationIds = Object.values(stationsOnPage).map(s => String(s.ID));
        }

        // 🌟 5. 解析停靠站，合併到站與離站
        let mergedStops = [];
        rawData.forEach((stationPoint) => {
            const [stationName, id, time, loc, stop] = stationPoint;
            const isStop = parseInt(stop, 10) !== -1;
            const isOnThisPage = validStationIds.length === 0 || validStationIds.includes(String(id));

            if (isStop && isOnThisPage) {
                if (mergedStops.length > 0 && mergedStops[mergedStops.length - 1].id === String(id)) {
                    mergedStops[mergedStops.length - 1].depTime = time;
                } else {
                    mergedStops.push({ stationName: stationName, id: String(id), arrTime: time, depTime: time, loc: loc });
                }
            }
        });

        // 🌟 1. 標題區塊 (實心背景、禁止縮放)
        // 使用純黑底色或極深藍 (#131b2d)，保證絕對不透明
        const titleHTML = `
            <div style="flex: 0 0 auto; background-color: #131b2d !important; padding-top: 4px;">
                
                <!-- 第一排：車次標題 -->
                <div class="d3-panel-title" style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; color:#fbbc04; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #334155;">
                    <span>🕒 <b>${display_train_no}</b> 車次時刻表</span>
                    <button onclick="document.getElementById('d3-timetable-section').style.display='none'; const cb = document.getElementById('d3-timetable-toggle'); if(cb) cb.checked=false; _isTimetableMode=false;" style="background:none; border:none; color:#94a3b8; font-size:22px; padding:0; cursor:pointer; line-height:1;">&times;</button>
                </div>
                
                <!-- 第二排：欄位名稱 -->
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#8ab4f8; padding:0 8px 6px 8px; border-bottom:1px solid #334155; margin-bottom: 4px;">
                    <span style="flex: 1.2; text-align: left; padding-left: 60px;">車站</span>
                    <span style="flex: 1; text-align: center;">到站</span>
                    <span style="flex: 1; text-align: center;">離站</span>
                    <span style="flex: 0.8; text-align: center;">備註</span>
                </div>
                
            </div>`;
            
        // 🌟 2. 捲動清單區塊 (設定 overflow-y: auto，讓文字在這裡面就被裁切掉，絕對不會捲到標題底下)
        let listHTML = `<div class="d3-custom-scrollbar" id="d3-timetable-list-container" style="flex: 1 1 auto; max-height: 180px; overflow-y: auto; overflow-x: hidden; display:flex; flex-direction:column; padding-right: 4px; background-color: #131b2d !important;">`;
        
        if (mergedStops.length === 0) {
            listHTML += `<div style="color:#888; text-align:center; padding:10px 0; font-size:12px;">此路線範圍內無停靠資料</div>`;
        } else {
            mergedStops.forEach((stop) => {
                let arrDisplay = exactTimes[stop.id] && exactTimes[stop.id].arr ? exactTimes[stop.id].arr.substring(0, 8) : formatTime(stop.arrTime);
                let depDisplay = exactTimes[stop.id] && exactTimes[stop.id].dep ? exactTimes[stop.id].dep.substring(0, 8) : formatTime(stop.depTime);
                let remarkDisplay = "-"; 

                let isTarget = (typeof targetStopId !== 'undefined' && stop.id === targetStopId);
                
                // 🌟 這裡取消了 rgba，全部改成「實心色」
                // 目標車站背景為實心深藍色(#1e3a8a)，一般車站背景為實心深灰色(#1e293b)
                let bgStyle = isTarget ? '#1e3a8a' : '#1e293b'; 
                let hoverStyle = isTarget ? '#1e40af' : '#334155'; // 滑鼠移上去的實心顏色
                let borderStyle = isTarget ? 'border-left: 3px solid #38bdf8;' : 'border-left: 3px solid transparent;';

                listHTML += `
                    <div class="timetable-row" id="d3-stop-row-${stop.id}" data-time="${stop.arrTime}" data-loc="${stop.loc}" 
                         style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:6px 8px; border-radius:4px; cursor:pointer; transition: background 0.2s; margin-bottom:2px; background-color:${bgStyle}; ${borderStyle}"
                         onmouseenter="this.style.backgroundColor='${hoverStyle}'" 
                         onmouseleave="this.style.backgroundColor='${bgStyle}'">
                        <span style="flex: 1.2; font-weight:bold; color:#fff; pointer-events:none;">🚉 ${stop.stationName}</span> 
                        <span style="flex: 1; text-align: center; color:#fbbc04; font-size:12px; pointer-events:none;">${arrDisplay}</span>
                        <span style="flex: 1; text-align: center; color:#fbbc04; font-size:12px; pointer-events:none;">${depDisplay}</span>
                        <span style="flex: 0.8; text-align: center; color:#aaa; font-size:11px; pointer-events:none;">${remarkDisplay}</span>
                    </div>`;
            });
        }
        listHTML += `</div>`;
        container.innerHTML = titleHTML + listHTML;

        // 🌟 7. 綁定點擊事件 
        setTimeout(() => {
            const rows = container.querySelectorAll('.timetable-row');
            console.log(`[時刻表UI] 成功找到並綁定了 ${rows.length} 個車站點擊事件`);

            rows.forEach(row => {
                row.addEventListener('click', function() {
                    console.log("🟢 1. 成功點擊！");

                    const timeValue = parseFloat(this.getAttribute('data-time'));
                    const loc = parseFloat(this.getAttribute('data-loc'));

                    if (isNaN(timeValue) || isNaN(loc)) {
                        console.error("❌ 座標解析失敗", this.getAttribute('data-time'), this.getAttribute('data-loc'));
                        return;
                    }

                    const timeDate = new Date(timeValue);

                    try {
                        if (typeof xScale === 'undefined' || typeof yScale === 'undefined') {
                            console.error("❌ 找不到 xScale 或 yScale！");
                            return;
                        }
                        if (typeof svg === 'undefined' || typeof zoom === 'undefined') {
                            console.error("❌ 找不到 svg 或 zoom 變數！");
                            return;
                        }

                        const targetX = xScale(timeDate); 
                        const targetY = yScale(loc);
                        console.log(`🟢 2. 目標畫面座標: X=${targetX.toFixed(2)}, Y=${targetY.toFixed(2)}`);

                        const currentTransform = d3.zoomTransform(svg.node()); 
                        const scale = Math.max(currentTransform.k, 1.5); 

                        const screenWidth = window.innerWidth;
                        const screenHeight = window.innerHeight;
                        
                        const translateX = screenWidth / 2 - targetX * scale;
                        const translateY = screenHeight / 2 - targetY * scale;

                        svg.transition()
                            .duration(750) 
                            .call(
                                zoom.transform, 
                                d3.zoomIdentity.translate(translateX, translateY).scale(scale)
                            );
                            
                        console.log("🟢 3. 平移動畫觸發成功！");
                    } catch (error) {
                        console.error("❌ 平移過程報錯：", error);
                    }
                });
            });
        }, 100);

    } catch (error) {
        container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="color:#ff6b6b; font-weight:bold; font-size:14px;">❌ 讀取失敗</span>
            <button onclick="document.getElementById('d3-timetable-section').style.display='none'; document.getElementById('d3-timetable-toggle').checked=false; _isTimetableMode=false;" style="background:none; border:none; color:#94a3b8; font-size:22px; padding:0; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <div style="color:#aaa; font-size:12px; padding-top:8px;">${error.message}</div>`;
        console.error("時刻表抓取錯誤：", error);
    }
}

// 🌟 時間格式轉換工具
function formatTime(rawTime) {
    if (isNaN(rawTime)) return '--:--:--';
    let hrs = Math.floor(rawTime / 60);
    let mins = Math.floor(rawTime % 60);
    let secs = Math.round((rawTime % 1) * 60);
    if (secs >= 60) { secs -= 60; mins += 1; }
    if (mins >= 60) { mins -= 60; hrs += 1; }
    if (hrs >= 24) hrs -= 24;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 🌟 點擊時刻表車站，跳轉至地圖對應位置
document.addEventListener('click', function(e) {
    const row = e.target.closest('.timetable-row');
    if (!row) return; 

    const rawTime = parseFloat(row.getAttribute('data-time'));
    const rawLoc = parseFloat(row.getAttribute('data-loc'));
    if (isNaN(rawTime) || isNaN(rawLoc)) return;

    // 關閉時刻表
    const container = document.getElementById('d3-timetable-section');
    if (container) container.style.display = 'none'; 
    
    // 取消勾選狀態
    const toggleCb = document.getElementById('d3-timetable-toggle');
    if (toggleCb) toggleCb.checked = false;
    _isTimetableMode = false;

    // 計算座標
    let offsetX = 0; let offsetY = 0;
    if (typeof _d3Svg !== 'undefined' && _d3Svg && _d3Svg.node()) {
        const rect = _d3Svg.node().getBoundingClientRect();
        offsetX = rect.left + window.scrollX;
        offsetY = rect.top + window.scrollY;
    }

    const startHour = (typeof DiagramHours !== 'undefined' && DiagramHours.length > 0) ? DiagramHours[0] : 4;
    const targetX = offsetX + rawTime * 10 - 1200 * startHour + 50;
    const targetY = offsetY + rawLoc + 50;
    
    const scrollToX = targetX - (window.innerWidth / 2);
    const scrollToY = targetY - (window.innerHeight / 2);

    // 平滑跳轉
    setTimeout(() => {
        window.scrollTo({ left: scrollToX, top: scrollToY, behavior: 'smooth' });
    }, 50);
});

const _carKindLabel = {
    taroko: '太魯閣', puyuma: '普悠瑪', tze_chiang: '自強號', tze_chiang_diesel: '自強（柴）',
    emu1200: '自強 EMU1200', emu300: '自強 EMU300', emu3000: '自強 EMU3000', kuaimu: '快哩慕',
    zhongxing: '中興號', direct: '直快', chu_kuang: '莒光號', chushan1: '曙山（早）',
    chushan2: '曙山（晚）', local: '區間車', local_express: '區間快', fu_hsing: '復興號',
    ordinary: '普快', skip_stop: '跳停', alishan: '阿里山', alishan_local: '阿里山區間',
    all_stop: '普通車', theme: '主題列車', special: '特殊', others: '客迴',
};

// ── 公開 API ──

function draw_diagram_background(line_kind, date) {
    _currentLineKind = line_kind;
    Object.entries(OperationLines).forEach(([key, value]) => {
        if (key !== line_kind) return;

        const totalWidth = 1200 * (DiagramHours.length - 1) + 100;
        const totalHeight = value['MAX_X_AXIS'];
        const text_spacing_factor = 500;
        const draw_date = new Date().toLocaleString(); 
        const now_time_x_axis = get_now_time_x_axis(0);
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        _init_ui_panels(); 

        const svg = d3.select('body')
            .append('svg')
            .attr('class', 'd3-diagram-svg')
            .attr('width', totalWidth)
            .attr('height', totalHeight + 125);

        _d3Svg = svg;

        const g = svg.append('g').attr('class', 'diagram-root');
        _d3G = g;

        // 點擊背景，一鍵清除所有多選高亮
        svg.on('click', () => { _clearHighlight(); });

        let initDx = 0;
        let initDy = 0;
        if (typeof scrollToCurrentTime !== 'undefined' && scrollToCurrentTime) {
            initDx = now_time_x_axis - vw / 2;
        }
        if (typeof stationAxisY !== 'undefined' && stationAxisY !== null) {
            initDy = (parseInt(stationAxisY) + 50) - vh / 2;
        }
        
        if (initDx > 0 || initDy > 0) {
            window.scrollTo(Math.max(0, initDx), Math.max(0, initDy));
        }

        const title = `${value['NAME']} ，日期：${date}，運行圖繪製完成時間：${draw_date}`;
        add_text(g, title, 5, 0, null);

        for (let i = 0; i < DiagramHours.length; i++) {
            let x = 50 + i * 1200;
            let y = 0;
            add_line(g, x, 50, x, totalHeight + 50, 'hour_line');

            while (true) {
                const hour = DiagramHours[i];
                const hour_text = hour.toString().padStart(2, '0');
                let after_midnight, css;
                if (hour === 24) {
                    after_midnight = '隔日'; css = 'hour_midnight';
                } else {
                    after_midnight = ''; css = 'hour';
                }
                if (y <= totalHeight) add_text(g, `${hour_text}00 ${after_midnight}`, x, y + 30, css);
                else break;
                y += text_spacing_factor;
            }

            if (i !== DiagramHours.length - 1) {
                for (let j = 0; j < 5; j++) {
                    let x = 50 + i * 1200 + (j + 1) * 200;
                    const lineClass = (j !== 2) ? 'min10_line' : 'min30_line';
                    const textClass = (j !== 2) ? 'min10' : 'min30';
                    add_line(g, x, 50, x, totalHeight + 50, lineClass);

                    y = 0;
                    while (true) {
                        if (y <= totalHeight) add_text(g, `${j + 1}0`, x, y + 30, textClass);
                        else break;
                        y += text_spacing_factor;
                    }
                }
            }
        }

        const stations = LinesStationsForBackground[key];
        Object.entries(stations).forEach(([, stn]) => {
            const sy = stn['SVGYAXIS'] + 50;
            const isServed = stn['ID'] !== 'NA';
            add_line(g, 50, sy, totalWidth - 50, sy, isServed ? 'station_line' : 'station_noserv_line');
            for (let i = 0; i < 31; i++) {
                add_text(g, stn['DSC'], 5 + i * 1200, sy - 20, isServed ? 'station' : 'station_noserv');
            }
        });

        diagram_objects[key] = g;
        add_line(g, now_time_x_axis, 50, now_time_x_axis, totalHeight + 50, 'now_time_line');
    });
}

// ==========================================
// 🌟 統籌畫圖與圖層排序 (💯 100% 全自動時空菜單版)
// ==========================================
function draw_train_path(all_trains_data, realtime_trains) {
    const urlParams = new URLSearchParams(window.location.search);
    const revisedJson = urlParams.get('revisedJson');
    const dateParam = urlParams.get('date');

    // 核心畫圖執行邏輯 (包裝起來等待菜單讀取)
    const initDrawingWithEpochs = (OP_STOPS_EPOCHS) => {
        let opStopsUrl = null;

        // 1. 判斷時空路徑
        if (revisedJson) {
            const match = revisedJson.match(/(\d{7})/);
            if (match) opStopsUrl = `OpStops/OpStops_${match[1]}.json`;
        } else {
            let qDate;
            if (dateParam) {
                qDate = parseInt(dateParam);
            } else {
                const d = new Date();
                qDate = parseInt(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);
            }

            // 比對 Python 給的菜單，找最近的歷史世代
            let activeFileId = null;
            if (OP_STOPS_EPOCHS && OP_STOPS_EPOCHS.length > 0) {
                for (let i = OP_STOPS_EPOCHS.length - 1; i >= 0; i--) {
                    if (qDate >= OP_STOPS_EPOCHS[i].date) {
                        activeFileId = OP_STOPS_EPOCHS[i].fileId;
                        break;
                    }
                }
            }
            if (activeFileId) opStopsUrl = `OpStops/OpStops_${activeFileId}.json`;
        }

        window._opStopsData = window._opStopsData || {};

        const executeDrawing = () => {
            _drawnStarPositions = []; // 清空重疊座標記錄

            // 🌟 自動模式判定：透過網址參數決定
            // 如果網址有 revisedJson，代表是從「進入改點預覽」進來的總車次檔 (data all)
            // 如果沒有，代表是從「今日運行圖」或「日期圖庫」進來的日期檔 (data)
            const is_master_mode = !!revisedJson; 

            // 🌟 空間跳躍引擎參數
            const shift_amount = 2880; // 24小時的 time 單位 (24 * 60 * 2)
            const start_time = DiagramHours[0] * 120; // 網頁左邊界時間，通常為 04:00 (480)

            for (const train_data of all_trains_data) {
                for (const [lk, train_no, train_kind, , line_dir, value] of train_data) {
                    if (value.length <= 2) continue;

                    let realtime_data = realtime_trains != null ? realtime_trains.get(train_no) : undefined;

                    let sections = [];
                    let current_section = [];
                    let order_next = value[0][5];

                    for (let i = 0; i < value.length; i++) {
                        let pt = [...value[i]];
                        let orig_time = value[i][2];
                        let order = pt[5];

                        let is_disconnect = false;
                        if (order !== order_next) is_disconnect = true;

                        if (orig_time !== null && !isNaN(orig_time)) {
                            if (current_section.length > 0) {
                                let orig_prev_time = value[i-1][2];

                                // 異常髒資料：時間嚴重倒退，強制切斷
                                if (orig_time < orig_prev_time - 1440) {
                                    is_disconnect = true;
                                } else if (!is_disconnect) {
                                    // 🌟 跨越 04:00 邊界判定
                                    let prev_cycles = Math.floor((orig_prev_time - start_time) / shift_amount);
                                    let curr_cycles = Math.floor((orig_time - start_time) / shift_amount);

                                    // 當偵測到跨越右邊界時 (例如 03:55 -> 04:01)
                                    if (curr_cycles > prev_cycles) {
                                        // A. 將當前點「降維」，把線畫到右邊界 04:00 出圖
                                        let pt_old = [...pt];
                                        pt_old[2] -= prev_cycles * shift_amount;
                                        current_section.push(pt_old);
                                        sections.push(current_section);

                                        // B. 根據模式決定後續動作！
                                        if (is_master_mode) {
                                            // 🔮 全車次版 (data all)：莫比烏斯環，無縫接回左邊 04:00！
                                            let prev_new = [...value[i-1]];
                                            prev_new[2] -= curr_cycles * shift_amount;
                                            pt[2] -= curr_cycles * shift_amount;
                                            current_section = [prev_new, pt];
                                            order_next = order + 1;
                                            continue;
                                        } else {
                                            // 🚫 日期檔 (data)：超過明早 4:00 的部分屬於明天，當天直接隱藏！
                                            current_section = []; 
                                            break; // 直接跳出這個車次的內部站點迴圈
                                        }
                                    }
                                    
                                    // 同週期的正常點，僅做基礎位移
                                    pt[2] -= curr_cycles * shift_amount;
                                }
                            }
                            
                            // 新線段的起點基礎位移
                            if (current_section.length === 0 || is_disconnect) {
                                let curr_cycles = Math.floor((orig_time - start_time) / shift_amount);
                                pt[2] -= curr_cycles * shift_amount;
                            }
                        }

                        if (is_disconnect) {
                            if (current_section.length > 1) sections.push(current_section);
                            current_section = [pt];
                            order_next = order + 1;
                            continue;
                        }

                        current_section.push(pt);
                        order_next = order + 1;
                    }

                    if (current_section.length > 1) sections.push(current_section);

                    // 將拆分後的每一段畫出
                    for (let j = 0; j < sections.length; j++) {
                        let suffix = j === 0 ? '' : (j === 1 ? '-End' : `-End${j}`);
                        set_path(lk, train_no + suffix, train_kind, sections[j]);
                        
                        if (typeof realtime_data !== 'undefined') {
                            mark_realtime_train_position(lk, sections[j], line_dir, train_kind, realtime_data);
                        }
                    }
                }
            }
            if (_d3G) {
                _d3G.selectAll('.op-stop-marker').raise();  
                _d3G.selectAll('[class$="_mark"]').raise(); 
            }
        };

        // 2. 讀取星星檔並畫圖
        if (opStopsUrl && window._currentOpStopsUrl !== opStopsUrl) {
            d3.json(opStopsUrl).then(function(opStopsData) {
                console.log(`🌟 運轉停車載入成功！(菜單導航至: ${opStopsUrl})`);
                window._opStopsData = opStopsData; 
                window._currentOpStopsUrl = opStopsUrl; 
                executeDrawing(); 
            }).catch(function(error) {
                console.log(`💤 尚未上傳此世代星星檔 (${opStopsUrl})，無星模式畫線。`);
                window._opStopsData = {}; 
                window._currentOpStopsUrl = opStopsUrl; 
                executeDrawing(); 
            });
        } else {
            executeDrawing();
        }
    };

    // 🌟 啟動：先確認有沒有拿到菜單
    if (window._cachedRevisedEpochs) {
        initDrawingWithEpochs(window._cachedRevisedEpochs); // 已經有了就直接用
    } else {
        d3.json("data all/Revised_Epochs.json").then(epochs => {
            window._cachedRevisedEpochs = epochs; // 緩存起來，避免切換面板重複讀取
            initDrawingWithEpochs(epochs);
        }).catch(err => {
            console.log("⚠️ 找不到 data all/Revised_Epochs.json 菜單，正常畫線。");
            initDrawingWithEpochs([]); // 沒菜單也能安全降級
        });
    }
}

// ==========================================
// 🌟 畫線與疊加運轉停車星星模組 (修復 rawData 資料遺失問題)
// ==========================================
function set_path(lk, train_no, train_kind, value) {
    if (!value || value.length === 0) return;

    if (isNaN(value[0][2]) || isNaN(value[0][3])) return;

    const first_time = value[0][2];
    const first_loc = value[0][3];
    const firstX = Math.round((first_time * 10 - 1200 * DiagramHours[0] + 50 + Number.EPSILON) * 100) / 100;
    const firstY = Math.round((first_loc + 50 + Number.EPSILON) * 100) / 100;

    let pathData = 'M';
    const coordinates = [];
    
    // 從全域變數讀取該車次的運轉停車名單
    const baseTrainNo = train_no.replace(/-End$/, ''); 
    const myOpStops = window._opStopsData ? (window._opStopsData[baseTrainNo] || []) : [];
    let opStopsToDraw = []; 

    const style = CarKind[train_kind] || 'others';

    for (let i = 0; i < value.length; i++) {
        const [, id, time, loc, stop] = value[i];
        if (isNaN(time) || isNaN(loc)) continue;

        let x = time * 10 - 1200 * DiagramHours[0] + 50;
        let y = loc + 50;
        x = Math.round((x + Number.EPSILON) * 100) / 100;
        y = Math.round((y + Number.EPSILON) * 100) / 100;
        
        // 破解偶數車次 stop 為字串 "-1" 的陷阱
        const isStop = parseInt(stop, 10) !== -1;
        const isBoundary = (i === 0 || i === value.length - 1);

        if (isStop || isBoundary) {
            pathData += `${x},${y} `;
            coordinates.push([x, y]);
        }
    }
    
    // 尋找水平線段中點畫星星
    for (let i = 0; i < value.length - 1; i++) {
        const [, id1, time1, loc1] = value[i];
        const [, id2, time2, loc2] = value[i+1];

        if (id1 === id2 && time1 !== time2) {
            if (myOpStops.includes(String(id1))) {
                let arr_x = time1 * 10 - 1200 * DiagramHours[0] + 50;
                let dep_x = time2 * 10 - 1200 * DiagramHours[0] + 50;
                
                let mid_x = (arr_x + dep_x) / 2;
                let mid_y = loc1 + 50;
                
                let overlapCount = 0;
                for (const pos of _drawnStarPositions) {
                    if (Math.abs(pos.x - mid_x) < 1 && Math.abs(pos.y - mid_y) < 1) {
                        overlapCount++;
                    }
                }

                if (overlapCount === 1) { mid_x -= 3; } 
                else if (overlapCount === 2) { mid_x += 3; } 
                else if (overlapCount > 2) { mid_x += (overlapCount * 2); }

                _drawnStarPositions.push({ x: mid_x, y: mid_y });
                opStopsToDraw.push([mid_x, mid_y]);
            }
        }
    }

    if (coordinates.length < 2) return;

    const pathId = lk + train_no;
    
    // 🌟🌟🌟 核心修復：加入了 rawData: value，讓時刻表引擎抓得到資料！
    _trainDataMap.set(pathId, { train_no, train_kind, style, firstX, firstY, rawData: value });

    const text_position = calculate_text_position(coordinates, style);
    add_path(diagram_objects[lk], lk, train_no, pathData, text_position, style);
    
    const starGenerator = d3.symbol().type(d3.symbolStar).size(50)();

    for (const [cx, cy] of opStopsToDraw) {
        diagram_objects[lk].append('path')
            .attr('d', starGenerator)
            .attr('transform', `translate(${cx}, ${cy})`)
            .attr('class', `${style} op-stop-marker`) 
            .style('fill', '#ffffff')
            .style('stroke-width', '1.5')
            .style('pointer-events', 'none'); 
    }
}

function calculate_text_position(coordinates, color) {
    const pairs = [];
    const distances = [];

    for (const pt of coordinates) {
        if (pairs.length === 2) {
            distances.push(calculate_distance(pairs[0], pairs[1]));
            pairs[0] = pairs[1];
            pairs[1] = pt;
        } else {
            pairs.push(pt);
        }
    }
    if (pairs.length === 2) distances.push(calculate_distance(pairs[0], pairs[1]));

    let text_position = [];
    let acc = 0;

    if (color === 'local') {
        const all = [];
        for (const d of distances) {
            if (d > 60) all.push(acc + d / 4);
            acc += d;
        }
        text_position = all.filter((_, i) => i % 2 === 0);
    } else {
        for (const d of distances) {
            if (d > 60 && d < 100) {
                text_position.push(0);
            } else if (d >= 100 && d <= 500) {
                text_position.push(acc + d / 2);
            } else if (d > 500) {
                text_position.push(acc + d / 3);
                text_position.push(acc + 2 * d / 3);
            }
            acc += d;
        }
    }
    return text_position;
}

function mark_realtime_train_position(lk, value, line_dir, train_kind, realtime_data) {
    const diagram_need_stop = find_diagram_need_to_stop(lk);
    const style = (CarKind[train_kind] || 'special') + '_mark';
    let now_time_x_axis = null;
    const coords = [];

    if (realtime_data.StationID > 0)
        now_time_x_axis = get_now_time_x_axis(realtime_data.DelayTime);

    for (const [, id, time, loc, stop] of value) {
        let x = time * 10 - 1200 * DiagramHours[0] + 50;
        let y = loc + 50;
        x = Math.round((x + Number.EPSILON) * 100) / 100;
        y = Math.round((y + Number.EPSILON) * 100) / 100;
        if (stop !== -1 || diagram_need_stop.includes(id)) coords.push([x, y]);
    }

    for (let i = 1; i < coords.length; i++) {
        if (coords[i][0] >= now_time_x_axis && coords[0][0] <= now_time_x_axis) {
            const axis_x = [coords[i - 1][0], now_time_x_axis, coords[i][0]];
            const axis_y = [coords[i - 1][1], NaN, coords[i][1]];
            if (axis_x[0] <= axis_x[1] && axis_x[1] <= axis_x[2]) {
                const interp = interpolateArray(axis_x, axis_y);
                diagram_objects[lk].append('circle') 
                    .attr('cx', axis_x[1]).attr('cy', interp[1]).attr('r', 5)
                    .attr('class', style);
            }
            break;
        }
    }
}

// ── D3 繪圖輔助函式 ──

function add_line(g, x1, y1, x2, y2, style) {
    const el = g.append('line')
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2);
    if (style) el.attr('class', style);
}

function add_text(g, text_string, x, y, style) {
    const el = g.append('text')
        .attr('x', x).attr('y', y)
        .attr('dominant-baseline', 'hanging')
        .text(text_string);
    if (style) el.attr('class', style);
}

// ── D3 繪圖輔助函式 ──

function add_path(g, lk, train_id, path_string, text_position, style) {
    const pathId = lk + train_id;

    const pathEl = g.append('path')
        .attr('d', path_string)
        .attr('class', style)
        .attr('id', pathId)
        .style('pointer-events', 'none');

    _allPathEls.set(pathId, pathEl);

    const hitEl = g.append('path')
        .attr('d', path_string)
        .style('fill', 'none')
        .style('stroke', 'transparent')
        .style('stroke-width', '16')
        .style('pointer-events', 'stroke')
        .style('cursor', 'crosshair');

    const basePathId = pathId.replace(/-End\d*/g, '');
    const display_train_id = cleanTrainNoForDisplay(train_id);

    hitEl
        .on('mouseenter', () => {
            if (!_selectedPathIds.has(basePathId)) pathEl.style('stroke-width', '6');
        })
        .on('mouseleave', () => {
            if (!_selectedPathIds.has(basePathId)) {
                _updateAllPathVisuals();
            }
        });

    hitEl.on('click', function (event) {
        event.stopPropagation();
        
        // 1. 執行單選/多選高亮切換
        _toggleHighlight(basePathId);
        
        let clickY = null;
        try {
            if (d3.pointer) {
                clickY = d3.pointer(event, _d3G.node())[1];
            } else {
                clickY = d3.mouse(_d3G.node())[1]; 
            }
        } catch(e) { console.warn("無法取得 D3 點擊座標", e); }

        // 🌟 2. 判斷要用哪種方式顯示時刻表
        if (_isPanelOpen) {
            // 【放大鏡主選單開啟時】：關閉上方快速預覽
            const qtc = document.getElementById('d3-quick-timetable-section');
            if (qtc) qtc.style.display = 'none';

            if (_selectedPathIds.has(basePathId) && _isTimetableMode) {
                if (typeof _showTimetable === 'function') {
                    _showTimetable(pathId, display_train_id, clickY, 'd3-timetable-section');
                }
            }
        } else {
            // 【放大鏡主選單關閉時】：直接顯示可拖曳的快速時刻表
            if (_selectedPathIds.has(basePathId)) {
                const qtc = _ensureQuickTimetableContainer(); 
                
                qtc.style.display = 'flex';
                
                // 🌟 強制更新絕對座標，確保 UI 出現在你拖曳/預設好的螢幕實體位置上！
                if (window._updateQuickUIPos) window._updateQuickUIPos();
                
                if (typeof _showTimetable === 'function') {
                    _showTimetable(pathId, display_train_id, clickY, 'd3-quick-timetable-section');
                }
            } else {
                const qtc = document.getElementById('d3-quick-timetable-section');
                if (qtc) qtc.style.display = 'none';
            }
        }
    });

    const hrefTarget = '#' + pathId;

    for (const offset of text_position) {
        const textEl = g.append('text').attr('class', style).classed('d3-train-label', true);
        textEl.append('textPath')
            .attr('href', hrefTarget)
            .attr('startOffset', offset)
            .append('tspan').attr('dy', -3)
            .text(display_train_id);
    }
}

function calculate_distance(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function interpolateArray(A, B) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
        if (!isNaN(B[i])) {
            result[i] = B[i];
        } else {
            let pi = i - 1, ni = i + 1;
            while (pi >= 0 && isNaN(B[pi])) pi--;
            while (ni < A.length && isNaN(B[ni])) ni++;
            const pv = B[pi], nv = B[ni];
            const pd = A[i] - A[pi], nd = A[ni] - A[i];
            result[i] = Math.round(((pv * nd + nv * pd) / (pd + nd) + Number.EPSILON) * 100) / 100;
        }
    }
    return result;
}

// 取得當前時間的 X 軸位置
function get_now_time_x_axis(minus_time) {
    const t = new Date();
    t.setMinutes(t.getMinutes() - minus_time);
    
    const seconds = t.getSeconds();
    const roundedSeconds = Math.round(seconds / 30) * 30;
    t.setSeconds(roundedSeconds);
    
    const hh = t.getHours().toString().padStart(2, '0');
    const mm = t.getMinutes().toString().padStart(2, '0');
    const ssStr = t.getSeconds().toString().padStart(2, '0');
    
    return SVG_X_Axis[`${hh}:${mm}:${ssStr}`].ax1 * 10 - 1200 * DiagramHours[0] + 50;
}

function find_diagram_need_to_stop(lk) {
    return Object.values(LinesStationsForBackground[lk])
        .filter(item => item['TERMINAL'] === 'Y')
        .map(item => item['ID']);
}
// ── 內部渲染函式 ──
function find_uncontinuous_index(value) {
    let order_next = value[0][5];
    let index = 0;
    for (const [, , , , , order] of value) {
        if (order === order_next) { order_next += 1; index += 1; }
        else break;
    }
    return index;
}
