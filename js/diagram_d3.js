// D3.js 版本的 SVG 渲染模組
// 互動功能：
//   一、D3 畫布縮放與平移 (d3.zoom)：攔截原生縮放，UI 絕對零殘影！
//   二、懸停提示框 (tooltip)：滑鼠移到車次線時顯示車次、車種、最近車站、時刻
//   三、整合控制中心：單一按鈕展開「左側車種過濾、右側車次搜尋」

// ── 模組層級狀態 ──
const _state = {
    trainDataMap:    new Map(), 
    allPathEls:      new Map(), 
    selectedPathId:  null,      
    wasDragged:      false,     
    tooltipEl:       null,
    svg:             null,
    g:               null,      
    zoom:            null,      
    searchItems:     new Map(), 
    lastSearchQuery: null,      
};

// ── 核心分類設定 ──
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

// 注入 UI 專屬 CSS
if (!document.getElementById('d3-custom-styles')) {
    const style = document.createElement('style');
    style.id = 'd3-custom-styles';
    style.innerHTML = `
        .d3-custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .d3-custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
        .d3-custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
        .d3-custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
    `;
    document.head.appendChild(style);
}

function _getTrainCategoryId(style, train_no) {
    const base_no = String(train_no).replace(/-End$/, '');
    if (base_no === '1' || base_no === '2') return 'chu_kuang';
    if (/[a-zA-Z]/.test(base_no)) return 'others';
    for (let i = 1; i < _filterCategories.length - 2; i++) {
        if (_filterCategories[i].styles.includes(style)) return _filterCategories[i].id;
    }
    return 'special';
}

function _resetState() {
    _state.trainDataMap.clear();
    _state.allPathEls.clear();
    _state.selectedPathId  = null;
    _state.wasDragged      = false;
    if (_state.tooltipEl) {
        _state.tooltipEl.remove();
        _state.tooltipEl = null;
    }
    const uiContainer = document.getElementById('d3-control-wrapper');
    if (uiContainer) uiContainer.remove();
    _state.svg             = null;
    _state.g               = null;
    _state.zoom            = null;
    _state.searchItems.clear();
    _state.lastSearchQuery = null;
}

// ── 視覺更新引擎 ──
function _updateAllPathVisuals() {
    const hasSelection = (_state.selectedPathId !== null);

    _state.allPathEls.forEach((el, id) => {
        const baseId = id.replace(/-End$/, '');
        const baseData = _state.trainDataMap.get(baseId);
        if (!baseData) return;

        const isSelected = (_state.selectedPathId === baseId);
        const isFiltered = (_activeFilter !== 'all' && _getTrainCategoryId(baseData.style, baseData.train_no) === _activeFilter);

        if (hasSelection) {
            if (isSelected) {
                el.style('opacity', '1').style('stroke-width', '6');
            } else {
                el.style('opacity', '0.1').style('stroke-width', null);
            }
        } else {
            el.style('opacity', '1');
            if (isFiltered) {
                el.style('stroke-width', '5');
            } else {
                el.style('stroke-width', null);
            }
        }
    });

    if (_state.g) {
        _state.g.selectAll('text.d3-train-label').each(function() {
            const textNode = d3.select(this);
            const href = textNode.select('textPath').attr('href');
            const pathId = href ? href.substring(1) : null;
            const baseId = pathId ? pathId.replace(/-End$/, '') : null;
            
            if (hasSelection) {
                textNode.style('opacity', (_state.selectedPathId === baseId) ? '1' : '0.05');
            } else {
                textNode.style('opacity', '1');
            }
        });
    }
}

function _applyFilter() {
    _updateAllPathVisuals();
    _refreshSearchResults(); 
}

function _highlight(pathId) {
    _state.selectedPathId = pathId;
    _updateAllPathVisuals();
    _refreshSearchResults();
}

function _clearHighlight() {
    _state.selectedPathId = null;
    _updateAllPathVisuals();
    _refreshSearchResults();
}

function _panToTrain(pathId) {
    const data = _state.trainDataMap.get(pathId);
    if (!data || !_state.svg || !_state.zoom || data.stationPoints.length === 0) return;
    
    const pts = data.stationPoints;
    const ox = pts[Math.floor(pts.length / 2)].x;
    const oy = pts[Math.floor(pts.length / 2)].y;
    
    const k  = d3.zoomTransform(_state.svg.node()).k;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    _state.svg.transition().duration(600).call(
        _state.zoom.transform,
        d3.zoomIdentity.scale(k).translate(vw / (2 * k) - ox, vh / (2 * k) - oy)
    );
}

function _refreshSearchResults() {
    const inp  = document.getElementById('d3-search-input');
    const cont = document.getElementById('d3-search-results');
    if (!inp || !cont) return;
    _renderSearchResults(inp.value.trim(), cont);
}

function _renderSearchResults(query, container) {
    const q = query.toLowerCase();

    if (_state.lastSearchQuery !== q) {
        _state.lastSearchQuery = q;
        _state.searchItems.clear();
        container.innerHTML = '';

        const matches = [];
        for (const [pathId, data] of _state.trainDataMap) {
            if (data.train_no.endsWith('-End')) continue; 
            
            if (_activeFilter !== 'all') {
                const catId = _getTrainCategoryId(data.style, data.train_no);
                if (catId !== _activeFilter) continue;
            }

            if (q && !String(data.train_no).toLowerCase().includes(q)) continue;
            matches.push({ pathId, data });
        }

        matches.sort((a, b) => String(a.data.train_no).localeCompare(String(b.data.train_no), undefined, {numeric: true}));
        const fragment = document.createDocumentFragment();

        for (const match of matches) {
            const { pathId, data } = match;
            const item = document.createElement('div');
            Object.assign(item.style, {
                padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.15s', userSelect: 'none', marginBottom: '2px'
            });
            const kindLabel = _carKindLabel[data.style] || data.style;
            item.innerHTML = `<b style="font-size: 14px;">${data.train_no}</b><span style="color:#aaa; font-size:11px; padding:2px 8px;">${kindLabel}</span>`;

            item.addEventListener('mouseenter', () => { if (_state.selectedPathId !== pathId) item.style.background = 'rgba(255,255,255,0.1)'; });
            item.addEventListener('mouseleave', () => { if (_state.selectedPathId !== pathId) item.style.background = 'transparent'; });
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (_state.selectedPathId === pathId) { _clearHighlight(); } 
                else { _highlight(pathId); _panToTrain(pathId); }
            });
            _state.searchItems.set(pathId, item);
            fragment.appendChild(item);
        }

        if (matches.length === 0) {
            const empty = document.createElement('div');
            Object.assign(empty.style, { color: '#888', padding: '4px 8px', textAlign: 'center', fontSize: '12px' });
            empty.textContent = q ? '無符合車次' : '請輸入車次搜尋';
            fragment.appendChild(empty);
        }
        container.appendChild(fragment);
    }

    _state.searchItems.forEach((item, pathId) => {
        item.style.background = (_state.selectedPathId === pathId) ? 'rgba(26,115,232,0.7)' : 'transparent';
    });
}

// ── 🌟 新版控制面板 (純 JS 生成，穩固固定右下角，高度寬度自適應) ──
function _init_ui_panels() {
    if (document.getElementById('d3-control-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'd3-control-wrapper';
    Object.assign(wrapper.style, {
        position: 'fixed', right: '24px', bottom: 'max(24px, calc(env(safe-area-inset-bottom) + 16px))',
        zIndex: '9999', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none'
    });

    const panelBody = document.createElement('div');
    panelBody.id = 'd3-panel-body';
    
    // ✅ 解法 1 核心：將寫死的寬度改為動態比例，確保不超出螢幕
    Object.assign(panelBody.style, {
        width: 'min(420px, calc(100vw - 32px))', // 適應手機寬度
        maxHeight: 'calc(100vh - 120px)',        // 適應手機高度
        background: 'rgba(15, 23, 42, 0.95)', color: '#fff', borderRadius: '12px', 
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'none', flexDirection: 'row', 
        fontFamily: 'Tahoma, Verdana, sans-serif', opacity: '0', transform: 'translateY(12px)', 
        transition: 'opacity 0.2s ease-out, transform 0.2s ease-out', pointerEvents: 'all', 
        border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: '8px'
    });

    // [左側] 車種過濾區
    const filterSection = document.createElement('div');
    filterSection.className = 'd3-filter-section d3-custom-scrollbar';
    Object.assign(filterSection.style, { 
        width: 'min(160px, 40%)', // ✅ 解法 1 核心：改為比例彈性寬度
        flex: '0 0 auto', padding: '10px', 
        borderRight: '1px solid rgba(255,255,255,0.1)', 
        maxHeight: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' 
    });
    
    const filterTitle = document.createElement('div');
    filterTitle.innerHTML = '🎛️ 過濾';
    Object.assign(filterTitle.style, { fontWeight: 'bold', fontSize: '12px', color: '#8ab4f8', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' });
    
    const filterList = document.createElement('div');
    
    function _renderFilterList() {
        filterList.innerHTML = '';
        const counts = {};
        _filterCategories.forEach(c => counts[c.id] = 0);
        
        for (const [pathId, data] of _state.trainDataMap) {
            if (!data.train_no.endsWith('-End')) counts[_getTrainCategoryId(data.style, data.train_no)]++;
        }

        _filterCategories.forEach(cat => {
            if (counts[cat.id] === 0 && cat.id !== 'all' && cat.id !== 'special') return;

            const item = document.createElement('div');
            const isActive = _activeFilter === cat.id;
            
            Object.assign(item.style, {
                padding: '6px 4px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'transparent', borderRadius: '6px',
                transition: 'background 0.1s', userSelect: 'none', color: isActive ? '#38bdf8' : '#e2e8f0', fontWeight: isActive ? 'bold' : 'normal'
            });
            
            item.innerHTML = `<span style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${cat.name}</span> <span style="font-size:10px; padding:2px 4px; background: rgba(0,0,0,0.3); border-radius:10px; color:#cbd5e1">${counts[cat.id]}</span>`;
            
            item.addEventListener('click', () => { _activeFilter = cat.id; _renderFilterList(); _applyFilter(); });
            filterList.appendChild(item);
        });
    }
    filterSection.appendChild(filterTitle);
    filterSection.appendChild(filterList);

    // [右側] 搜尋區
    const searchSection = document.createElement('div');
    searchSection.className = 'd3-search-section';
    Object.assign(searchSection.style, { 
        flex: '1', minWidth: '0', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' 
    });
    
    const searchInput = document.createElement('input');
    searchInput.id = 'd3-search-input';
    searchInput.placeholder = '🔍 車次號碼...';
    Object.assign(searchInput.style, {
        width: '100%', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', 
        background: 'rgba(0,0,0,0.3)', color: '#fff', boxSizing: 'border-box', outline: 'none', padding: '8px 6px', fontSize: '16px' // fontSize 16px 防 iOS 放大
    });
    searchInput.addEventListener('focus', () => searchInput.style.borderColor = '#38bdf8');
    searchInput.addEventListener('blur', () => searchInput.style.borderColor = 'rgba(255,255,255,0.2)');

    const searchResults = document.createElement('div');
    searchResults.id = 'd3-search-results';
    searchResults.className = 'd3-custom-scrollbar';
    Object.assign(searchResults.style, { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', marginTop: '4px' });

    searchSection.appendChild(searchInput);
    searchSection.appendChild(searchResults);

    panelBody.appendChild(filterSection);
    panelBody.appendChild(searchSection);

    // 圓形懸浮按鈕
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '🔍';
    Object.assign(toggleBtn.style, {
        width: '50px', height: '50px', borderRadius: '50%', border: 'none', background: '#1a73e8', color: '#fff',
        fontSize: '22px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', 
        boxShadow: '0 4px 16px rgba(26, 115, 232, 0.4)', transition: 'background 0.2s', pointerEvents: 'all',
        transform: 'translateZ(0)', flexShrink: '0'
    });

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
            _renderSearchResults(searchInput.value.trim(), searchResults);
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

    wrapper.appendChild(panelBody);
    wrapper.appendChild(toggleBtn);
    document.body.appendChild(wrapper);

    // 抗縮放引擎 (VisualViewport 映射)
    if (window.visualViewport) {
        const updateVVPos = () => {
            const vv = window.visualViewport;
            if (vv.scale > 1) {
                wrapper.style.position = 'absolute';
                wrapper.style.left = `${vv.pageLeft + vv.width - 24}px`;
                wrapper.style.top = `${vv.pageTop + vv.height - 24}px`;
                wrapper.style.bottom = 'auto';
                wrapper.style.right = 'auto';
                wrapper.style.transformOrigin = 'bottom right';
                wrapper.style.transform = `translate(-100%, -100%) scale(${1 / vv.scale})`;
            } else {
                wrapper.style.position = 'fixed';
                wrapper.style.left = 'auto';
                wrapper.style.top = 'auto';
                wrapper.style.bottom = 'max(24px, calc(env(safe-area-inset-bottom) + 16px))';
                wrapper.style.right = '24px';
                wrapper.style.transformOrigin = 'bottom right';
                wrapper.style.transform = 'none';
            }
        };
        window.visualViewport.addEventListener('scroll', updateVVPos);
        window.visualViewport.addEventListener('resize', updateVVPos);
        setTimeout(updateVVPos, 100);
    }
}

function _ax1_to_timestr(ax1) {
    const isNextDay = ax1 >= NEXT_DAY_AX1;
    const a = isNextDay ? ax1 - NEXT_DAY_AX1 : ax1;
    const totalSec = a * 30;
    const h = Math.floor(totalSec / 3600) % 24;
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}${isNextDay ? ' (隔日)' : ''}`;
}

function _init_tooltip() {
    if (_state.tooltipEl) return;
    _state.tooltipEl = document.createElement('div');
    _state.tooltipEl.id = 'd3-tooltip';
    Object.assign(_state.tooltipEl.style, {
        position: 'fixed', padding: '6px 12px', background: 'rgba(15,15,15,0.85)',
        color: '#fff', borderRadius: '5px', fontSize: '13px', lineHeight: '1.75',
        fontFamily: 'Tahoma, Verdana, sans-serif', pointerEvents: 'none', zIndex: '2000',
        display: 'none', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
    });
    document.body.appendChild(_state.tooltipEl);
}

// ── 公開 API ──

function draw_diagram_background(line_kind, date) {
    Object.entries(OperationLines).forEach(([key, value]) => {
        if (key !== line_kind) return;

        const totalWidth  = PX_PER_HOUR * (DiagramHours.length - 1) + 2 * MARGIN;
        const totalHeight = value['MAX_X_AXIS'];
        const text_spacing_factor = 500;
        const draw_date = Date().toLocaleString();
        const now_time_x_axis = get_now_time_x_axis(0);
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        _init_tooltip();
        _init_ui_panels(); 

        const svg = d3.select('body').append('svg').attr('class', 'd3-diagram-svg').attr('width', vw).attr('height', vh);
        _state.svg = svg;

        const g = svg.append('g').attr('class', 'diagram-root');
        _state.g = g;

        const zoom = d3.zoom()
            .scaleExtent([0.02, 10]) // ✅ 解法 2 核心：允許縮放得非常小 (0.02)
            // 🚫 ✅ 解法 2 核心：刪除 .translateExtent(...) 隱形牆壁，釋放視角自由！
            .on('zoom', (event) => { g.attr('transform', event.transform); });

        _state.zoom = zoom;
        svg.call(zoom);

        svg.on('mousedown.dragtrack', () => { _state.wasDragged = false; })
           .on('mousemove.dragtrack', () => { _state.wasDragged = true; })
           .on('click.deselect', () => { if (!_state.wasDragged) _clearHighlight(); });

        const initialScale = 1;
        let initDx = 0;
        let initDy = 0;
        if (typeof scrollToCurrentTime !== 'undefined' && scrollToCurrentTime) {
            initDx = vw / (2 * initialScale) - now_time_x_axis;
        }
        if (typeof stationAxisY !== 'undefined' && stationAxisY !== null) {
            initDy = vh / (2 * initialScale) - (parseInt(stationAxisY) + MARGIN);
        }
        svg.call(zoom.transform, d3.zoomIdentity.scale(initialScale).translate(initDx, initDy));

        const title = `${value['NAME']} ，日期：${date}，運行圖繪製完成時間：${draw_date}`;
        add_text(g, title, 5, 0, null);

        for (let i = 0; i < DiagramHours.length; i++) {
            let x = MARGIN + i * PX_PER_HOUR;
            let y = 0;
            add_line(g, x, MARGIN, x, totalHeight + MARGIN, 'hour_line');

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
                    x = MARGIN + i * PX_PER_HOUR + (j + 1) * PX_PER_10MIN;
                    const lineClass = (j !== 2) ? 'min10_line' : 'min30_line';
                    const textClass = (j !== 2) ? 'min10' : 'min30';
                    add_line(g, x, MARGIN, x, totalHeight + MARGIN, lineClass);

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
            const sy = stn['SVGYAXIS'] + MARGIN;
            const isServed = stn['ID'] !== 'NA';
            add_line(g, MARGIN, sy, totalWidth - MARGIN, sy, isServed ? 'station_line' : 'station_noserv_line');
            for (let i = 0; i < 31; i++) { add_text(g, stn['DSC'], 5 + i * PX_PER_HOUR, sy - 20, isServed ? 'station' : 'station_noserv'); }
        });

        diagram_objects[key] = g;
        add_line(g, now_time_x_axis, MARGIN, now_time_x_axis, totalHeight + MARGIN, 'now_time_line');
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
                mark_realtime_train_position(section_start, line_dir, train_kind, realtime_data);

            if (section_end.length > 3)
                set_path(lk, train_no + '-End', train_kind, section_end);
            if (typeof realtime_data !== 'undefined')
                mark_realtime_train_position(section_end, line_dir, train_kind, realtime_data);
        }
    }
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

function _buildPathData(value, lk) {
    let pathData = 'M';
    const coordinates = [];
    const stationPoints = [];
    const diagram_need_stop = find_diagram_need_to_stop(lk);

    for (const [dsc, id, time, loc, stop] of value) {
        let x = time * PX_PER_AX1 - PX_PER_HOUR * DiagramHours[0] + MARGIN;
        let y = loc + MARGIN;
        x = Math.round((x + Number.EPSILON) * 100) / 100;
        y = Math.round((y + Number.EPSILON) * 100) / 100;
        if (stop !== -1 || diagram_need_stop.includes(id)) {
            pathData += `${x},${y} `;
            coordinates.push([x, y]);
            stationPoints.push({ x, y, dsc, time });
        }
    }
    return { pathData, coordinates, stationPoints };
}

function set_path(lk, train_no, train_kind, value) {
    const style = CarKind[train_kind] || 'others';
    const { pathData, coordinates, stationPoints } = _buildPathData(value, lk);
    const pathId = lk + train_no;
    _state.trainDataMap.set(pathId, { train_no, train_kind, style, stationPoints });
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
            if (d > 60 && d < 100) text_position.push(0);
            else if (d >= 100 && d <= 500) text_position.push(acc + d / 2);
            else if (d > 500) { text_position.push(acc + d / 3); text_position.push(acc + 2 * d / 3); }
            acc += d;
        }
    }
    return text_position;
}

function mark_realtime_train_position(value, line_dir, train_kind, realtime_data) {
    const diagram_need_stop = find_diagram_need_to_stop(line_kind);
    const style = (CarKind[train_kind] || 'special') + '_mark';
    let now_time_x_axis = null;
    const coords = [];

    if (realtime_data && realtime_data.StationID > 0)
        now_time_x_axis = get_now_time_x_axis(realtime_data.DelayTime);

    for (const [, id, time, loc, stop] of value) {
        let x = time * PX_PER_AX1 - PX_PER_HOUR * DiagramHours[0] + MARGIN;
        let y = loc + MARGIN;
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
                diagram_objects[line_kind].append('circle').attr('cx', axis_x[1]).attr('cy', interp[1]).attr('r', 5).attr('class', style);
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

    const pathEl = g.append('path').attr('d', path_string).attr('class', style).attr('id', pathId).style('pointer-events', 'none');
    _state.allPathEls.set(pathId, pathEl);

    const hitEl = g.append('path')
        .attr('d', path_string).style('fill', 'none').style('stroke', 'transparent')
        .style('stroke-width', '16').style('pointer-events', 'stroke').style('cursor', 'crosshair');

    const basePathId = pathId.replace(/-End$/, '');

    hitEl.on('mouseenter', () => { if (_state.selectedPathId !== basePathId) pathEl.style('stroke-width', '6'); })
         .on('mouseleave', () => {
             if (_state.selectedPathId !== basePathId) {
                 const isFiltered = (_activeFilter !== 'all' && _getTrainCategoryId(style, train_id) === _activeFilter);
                 pathEl.style('stroke-width', isFiltered && !_state.selectedPathId ? '5' : null);
             }
             if (_state.tooltipEl) _state.tooltipEl.style.display = 'none';
         });

    hitEl.on('click', function (event) {
        event.stopPropagation();
        if (_state.selectedPathId === basePathId) _clearHighlight();
        else _highlight(basePathId);
    });

    hitEl.on('mousemove', function (event) {
        const data = _state.trainDataMap.get(pathId);
        if (!data || !_state.tooltipEl || data.stationPoints.length === 0) return;

        const [mx] = d3.pointer(event, _state.g.node());
        let nearest = data.stationPoints[0];
        let minDist = Infinity;
        for (const pt of data.stationPoints) {
            const dist = Math.abs(pt.x - mx);
            if (dist < minDist) { minDist = dist; nearest = pt; }
        }

        const kindLabel = _carKindLabel[data.style] || data.style;
        const timeStr = _ax1_to_timestr(nearest.time);
        const displayNo = data.train_no.replace(/-End$/, '');

        _state.tooltipEl.innerHTML = `<b>車次 ${displayNo}</b><br>車種：${kindLabel}<br><hr style="margin:3px 0;border-color:#555">車站：${nearest.dsc}<br>時刻：${timeStr}`;
        _state.tooltipEl.style.display = 'block';

        const tipW = _state.tooltipEl.offsetWidth || 160;
        const left = (event.clientX + 16 + tipW > window.innerWidth) ? event.clientX - tipW - 8 : event.clientX + 16;
        _state.tooltipEl.style.left = left + 'px';
        _state.tooltipEl.style.top = (event.clientY - 10) + 'px';
    });

    const hrefTarget = '#' + pathId;
    for (const offset of text_position) {
        const textEl = g.append('text').attr('class', style).classed('d3-train-label', true);
        textEl.append('textPath').attr('href', hrefTarget).attr('startOffset', offset).append('tspan').attr('dy', -3).text(train_id);
    }
}

function calculate_distance(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function interpolateArray(A, B) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
        if (!isNaN(B[i])) result[i] = B[i];
        else {
            let pi = i - 1, ni = i + 1;
            while (pi >= 0 && isNaN(B[pi])) pi--;
            while (ni < A.length && isNaN(B[ni])) ni++;
            const pv = B[pi], nv = B[ni], pd = A[i] - A[pi], nd = A[ni] - A[i];
            result[i] = Math.round(((pv * nd + nv * pd) / (pd + nd) + Number.EPSILON) * 100) / 100;
        }
    }
    return result;
}

function get_now_time_x_axis(minus_time) {
    const t = new Date(); t.setMinutes(t.getMinutes() - minus_time);
    const hh = t.getHours().toString().padStart(2, '0');
    const mm = t.getMinutes().toString().padStart(2, '0');
    const ss = Math.round(t.getSeconds() / 30) * 30;
    const ssStr = ss === 60 ? '00' : ss.toString().padStart(2, '0');
    return SVG_X_Axis[`${hh}:${mm}:${ssStr}`].ax1 * PX_PER_AX1 - PX_PER_HOUR * DiagramHours[0] + MARGIN;
}

function find_diagram_need_to_stop(lk) {
    return LinesStationsForBackground[lk].filter(item => item['TERMINAL'] === 'Y').map(item => item['ID']);
}
