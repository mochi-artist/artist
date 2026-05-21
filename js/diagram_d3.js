// D3.js 版本的 SVG 渲染模組
// 互動功能：
//   一、HTML 骨架移植版：UI 元素直接靜態寫入 HTML，JS 僅負責數據控制與事件綁定
//   二、整合控制中心：單一按鈕展開「左側車種過濾、右側車次搜尋」
//   三、嚴格分類閘門：1、2次歸類莒光，含英文字歸類客迴，其餘特殊列車
//   四、純 CSS 固定選單：利用架構優勢，免去 JS 實時計算，回歸最穩定的 position: fixed
//   五、暴力精準定位：配合滾動容器優化 scrollIntoView，縮放狀態下依然 100% 完美置中
//   六、🚀 抗縮放引擎：加入 VisualViewport 偵測，雙指放大時自動反向縮小 UI，維持版面完美

// ── 模組層級狀態 ──
const _trainDataMap = new Map(); 
const _allPathEls   = new Map(); 
let _selectedPathId = null;      
let _d3Svg = null;
let _d3G = null;        

// ==========================================
// 🌟 核心狀態與分類設定
// ==========================================
let _activeFilter = 'all';

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

const _carKindLabel = {
    taroko: '太魯閣', puyuma: '普悠瑪', tze_chiang: '自強號', tze_chiang_diesel: '自強（柴）',
    emu1200: '自強 EMU1200', emu300: '自強 EMU300', emu3000: '自強 EMU3000', kuaimu: '快哩慕',
    zhongxing: '中興號', direct: '直快', chu_kuang: '莒光號', chushan1: '曙山（早）',
    chushan2: '曙山（晚）', local: '區間車', local_express: '區間快', fu_hsing: '復興號',
    ordinary: '普快', skip_stop: '跳停', alishan: '阿里山', alishan_local: '阿里山區間',
    all_stop: '普通車', theme: '主題列車', special: '特殊', others: '客迴',
};

// 智慧判定車種分類
function _getTrainCategoryId(style, train_no) {
    const base_no = train_no.replace(/-End$/, '');
    if (base_no === '1' || base_no === '2') return 'chu_kuang';
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

        const isSelected = (_selectedPathId === baseId);
        const isFiltered = (_activeFilter !== 'all' && _getTrainCategoryId(baseData.style, baseData.train_no) === _activeFilter);

        if (isSelected) {
            el.style('stroke-width', '6').style('opacity', '1'); 
        } else if (isFiltered) {
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

function _highlight(pathId) {
    _selectedPathId = pathId;
    _updateAllPathVisuals();
    _refreshSearchResults();
}

function _clearHighlight() {
    _selectedPathId = null;
    _updateAllPathVisuals();
    _refreshSearchResults();
}

// ==========================================
// 🌟 畫面跳轉與精準定位
// ==========================================
function _panToTrain(pathId) {
    const data = _trainDataMap.get(pathId);
    if (!data || data.firstX === undefined || data.firstY === undefined) return;

    const container = document.getElementById('d3-diagram-container');
    if (!container) return;

    // 動態建立隱形錨點，強制瀏覽器將其置中
    const anchor = document.createElement('div');
    Object.assign(anchor.style, {
        position: 'absolute', left: `${data.firstX}px`, top: `${data.firstY}px`,
        width: '1px', height: '1px', pointerEvents: 'none', visibility: 'hidden'
    });

    container.appendChild(anchor);
    anchor.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    setTimeout(() => anchor.remove(), 100);
}

// ==========================================
// 🌟 搜尋結果渲染邏輯
// ==========================================
function _refreshSearchResults() {
    const inp  = document.getElementById('d3-search-input');
    const cont = document.getElementById('d3-search-results');
    if (!inp || !cont) return;
    _renderSearchResults(inp.value.trim(), cont);
}

function _renderSearchResults(query, container) {
    container.innerHTML = '';
    const q = query.toLowerCase();
    
    const matches = [];
    for (const [pathId, data] of _trainDataMap) {
        if (data.train_no.endsWith('-End')) continue; 
        
        if (_activeFilter !== 'all') {
            const catId = _getTrainCategoryId(data.style, data.train_no);
            if (catId !== _activeFilter) continue;
        }

        if (q && !data.train_no.toLowerCase().includes(q)) continue;
        matches.push({ pathId, data });
    }

    matches.sort((a, b) => a.data.train_no.localeCompare(b.data.train_no, undefined, {numeric: true}));
    const fragment = document.createDocumentFragment();

    for (const match of matches) {
        const { pathId, data } = match;
        const isSelected = _selectedPathId === pathId;
        
        const item = document.createElement('div');
        Object.assign(item.style, {
            padding: '6px 8px', borderRadius: '4px', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: isSelected ? 'rgba(26,115,232,0.7)' : 'transparent',
            transition: 'background 0.15s', userSelect: 'none', marginBottom: '2px'
        });
        
        const kindLabel = _carKindLabel[data.style] || data.style;
        item.innerHTML = `<b class="d3-item-text">${data.train_no}</b><span class="d3-item-badge" style="color:#aaa;">${kindLabel}</span>`;

        item.addEventListener('mouseenter', () => { if (_selectedPathId !== pathId) item.style.background = 'rgba(255,255,255,0.1)'; });
        item.addEventListener('mouseleave', () => { if (_selectedPathId !== pathId) item.style.background = 'transparent'; });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_selectedPathId === pathId) _clearHighlight();
            else { _highlight(pathId); _panToTrain(pathId); }
        });
        fragment.appendChild(item);
    }

    if (matches.length === 0) {
        const empty = document.createElement('div');
        Object.assign(empty.style, { color: '#888', padding: '4px 8px', textAlign: 'center', fontSize: '12px' });
        empty.textContent = '無符合車次';
        fragment.appendChild(empty);
    }

    container.appendChild(fragment);
}

// ==========================================
// 🌟 UI 控制中心初始化 (對接 HTML 並啟動抗縮放引擎)
// ==========================================
function _init_ui_panels() {
    const toggleBtn = document.getElementById('d3-toggle-btn');
    const panelBody = document.getElementById('d3-panel-body');
    const searchInput = document.getElementById('d3-search-input');
    const searchResults = document.getElementById('d3-search-results');
    const filterList = document.getElementById('d3-filter-list');
    
    // 用來掛載變形的控制容器
    const controlContainer = document.getElementById('d3-control-container'); 

    if (!toggleBtn || !panelBody || !controlContainer) return;
    if (toggleBtn.dataset.bound === 'true') return; 
    toggleBtn.dataset.bound = 'true';

    function _renderFilterList() {
        if (!filterList) return;
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
            const isActive = _activeFilter === cat.id;
            
            Object.assign(item.style, {
                padding: '6px 8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'transparent', borderRadius: '6px',
                transition: 'background 0.1s', userSelect: 'none', color: isActive ? '#38bdf8' : '#e2e8f0', fontWeight: isActive ? 'bold' : 'normal'
            });
            
            item.innerHTML = `<span class="d3-item-text">${cat.name}</span> <span class="d3-item-badge" style="background: rgba(0,0,0,0.3); border-radius:10px; color:#cbd5e1">${counts[cat.id]}</span>`;
            
            item.addEventListener('click', () => { _activeFilter = cat.id; _renderFilterList(); _applyFilter(); });
            filterList.appendChild(item);
        });
    }

    let isPanelOpen = false;
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isPanelOpen = !isPanelOpen;
        if (isPanelOpen) {
            _renderFilterList(); 
            panelBody.style.display = 'flex';
            requestAnimationFrame(() => { panelBody.style.opacity = '1'; panelBody.style.transform = 'translateY(0)'; });
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
    });

    searchInput.addEventListener('input', () => _renderSearchResults(searchInput.value.trim(), searchResults));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isPanelOpen) toggleBtn.click(); });
    panelBody.addEventListener('click', (e) => e.stopPropagation());

    // 🚀 加入 VisualViewport 抗縮放引擎
    // 當使用者在手機上雙指放大畫面時，自動反向縮小 UI 面板，保持完美比例
    if (window.visualViewport) {
        const updateVVScale = () => {
            const vv = window.visualViewport;
            if (vv.scale > 1) {
                // 設定縮放原點為右下角，並反向縮小
                controlContainer.style.transformOrigin = 'bottom right';
                controlContainer.style.transform = `translateZ(0) scale(${1 / vv.scale})`;
            } else {
                controlContainer.style.transform = 'translateZ(0) scale(1)';
            }
        };

        window.visualViewport.addEventListener('resize', updateVVScale);
        window.visualViewport.addEventListener('scroll', updateVVScale);
        requestAnimationFrame(updateVVScale); // 初始化執行
    }
}

// ==========================================
// ── 公開 API (D3 繪圖引擎) ──
// ==========================================
function draw_diagram_background(line_kind, date) {
    Object.entries(OperationLines).forEach(([key, value]) => {
        if (key !== line_kind) return;

        const totalWidth = 1200 * (DiagramHours.length - 1) + 100;
        const totalHeight = value['MAX_X_AXIS'];
        const text_spacing_factor = 500;
        const draw_date = new Date().toLocaleString(); 
        const now_time_x_axis = get_now_time_x_axis(0);
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 初始化面版事件綁定
        _init_ui_panels(); 

        const container = d3.select('#d3-diagram-container');

        const svg = container.append('svg')
            .attr('class', 'd3-diagram-svg')
            .attr('width', totalWidth)
            .attr('height', totalHeight + 125);

        _d3Svg = svg;

        const g = svg.append('g').attr('class', 'diagram-root');
        _d3G = g;

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
            const containerEl = document.getElementById('d3-diagram-container');
            if (containerEl) {
                containerEl.scrollLeft = Math.max(0, initDx);
                containerEl.scrollTop = Math.max(0, initDy);
            }
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
                if (hour === 24) { after_midnight = '隔日'; css = 'hour_midnight'; } 
                else { after_midnight = ''; css = 'hour'; }
                
                if (y <= totalHeight) add_text(g, `${hour_text}00 ${after_midnight}`, x, y + 30, css);
                else break;
                y += text_spacing_factor;
            }

            if (i !== DiagramHours.length - 1) {
                for (let j = 0; j < 5; j++) {
                    x = 50 + i * 1200 + (j + 1) * 200;
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

function draw_train_path(all_trains_data, realtime_trains) {
    for (const train_data of all_trains_data) {
        for (const [lk, train_no, train_kind, , line_dir, value] of train_data) {
            if (value.length <= 2) continue;

            const split = find_uncontinuous_index(value);
            const section_start = value.slice(0, split);
            const section_end = value.slice(split);

            let realtime_data;
            if (realtime_trains != null) realtime_data = realtime_trains.get(train_no);

            if (section_start.length > 1)
                set_path(lk, train_no, train_kind, section_start);
            if (typeof realtime_data !== 'undefined')
                mark_realtime_train_position(lk, section_start, line_dir, train_kind, realtime_data); 

            if (section_end.length > 3)
                set_path(lk, train_no + '-End', train_kind, section_end);
            if (typeof realtime_data !== 'undefined')
                mark_realtime_train_position(lk, section_end, line_dir, train_kind, realtime_data); 
        }
    }
}

// ── 內部渲染細節 ──
function find_uncontinuous_index(value) {
    let order_next = value[0][5];
    let index = 0;
    for (const [, , , , , order] of value) {
        if (order === order_next) { order_next += 1; index += 1; }
        else break;
    }
    return index;
}

function set_path(lk, train_no, train_kind, value) {
    if (!value || value.length === 0) return;

    const first_time = value[0][2];
    const first_loc = value[0][3];
    const firstX = Math.round((first_time * 10 - 1200 * DiagramHours[0] + 50 + Number.EPSILON) * 100) / 100;
    const firstY = Math.round((first_loc + 50 + Number.EPSILON) * 100) / 100;

    let pathData = 'M';
    const coordinates = [];
    const style = CarKind[train_kind] || 'others';
    const diagram_need_stop = find_diagram_need_to_stop(lk);

    for (const [, id, time, loc, stop] of value) {
        let x = time * 10 - 1200 * DiagramHours[0] + 50;
        let y = loc + 50;
        x = Math.round((x + Number.EPSILON) * 100) / 100;
        y = Math.round((y + Number.EPSILON) * 100) / 100;
        if (stop !== -1 || diagram_need_stop.includes(id)) {
            pathData += `${x},${y} `;
            coordinates.push([x, y]);
        }
    }

    const pathId = lk + train_no;
    _trainDataMap.set(pathId, { train_no, train_kind, style, firstX, firstY });

    const text_position = calculate_text_position(coordinates, style);
    add_path(diagram_objects[lk], lk, train_no, pathData, text_position, style);
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

    if (realtime_data && realtime_data.StationID > 0) {
        now_time_x_axis = get_now_time_x_axis(realtime_data.DelayTime);
    }

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

function add_line(g, x1, y1, x2, y2, style) {
    const el = g.append('line').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
    if (style) el.attr('class', style);
}

function add_text(g, text_string, x, y, style) {
    const el = g.append('text').attr('x', x).attr('y', y).attr('dominant-baseline', 'hanging').text(text_string);
    if (style) el.attr('class', style);
}

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

    const basePathId = pathId.replace(/-End$/, '');

    hitEl
        .on('mouseenter', () => { if (_selectedPathId !== basePathId) pathEl.style('stroke-width', '6'); })
        .on('mouseleave', () => { if (_selectedPathId !== basePathId) _updateAllPathVisuals(); });

    hitEl.on('click', function (event) {
        event.stopPropagation();
        if (_selectedPathId === basePathId) _clearHighlight();
        else _highlight(basePathId);
    });

    const hrefTarget = '#' + pathId;
    for (const offset of text_position) {
        const textEl = g.append('text').attr('class', style).classed('d3-train-label', true);
        textEl.append('textPath')
            .attr('href', hrefTarget)
            .attr('startOffset', offset)
            .append('tspan').attr('dy', -3)
            .text(train_id);
    }
}

function calculate_distance(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

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

function find_diagram_need_to_stop(lk) {
    return Object.values(LinesStationsForBackground[lk]).filter(item => item['TERMINAL'] === 'Y').map(item => item['ID']);
}
