// ==========================================
// D3.js SVG 運行圖渲染模組（完整修正版）
// ==========================================

// ── 全域 ──
window.diagram_objects = window.diagram_objects || {};

const _trainDataMap = new Map();
const _allPathEls = new Map();

let _selectedPathId = null;
let _d3Svg = null;
let _d3G = null;

let _activeFilter = 'all';

// ==========================================
// 車種分類
// ==========================================

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
    taroko: '太魯閣',
    puyuma: '普悠瑪',
    tze_chiang: '自強號',
    tze_chiang_diesel: '自強（柴）',
    emu1200: 'EMU1200',
    emu300: 'EMU300',
    emu3000: 'EMU3000',
    chu_kuang: '莒光號',
    local: '區間車',
    local_express: '區間快',
    ordinary: '普快',
    fu_hsing: '復興號',
    others: '客迴',
    special: '特殊'
};

// ==========================================
// CSS
// ==========================================

if (!document.getElementById('d3-custom-styles')) {

    const style = document.createElement('style');

    style.id = 'd3-custom-styles';

    style.innerHTML = `
    
    .d3-custom-scrollbar::-webkit-scrollbar {
        width: 5px;
    }

    .d3-custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.25);
        border-radius: 4px;
    }

    #d3-panel-body {
        width: 420px;
    }

    .d3-filter-section {
        width: 180px;
        flex: 0 0 auto;
    }

    .d3-search-section {
        flex: 1;
        min-width: 0;
    }

    @media (max-width: 500px) {

        #d3-panel-body {
            width: calc(100vw - 32px) !important;
        }

        .d3-filter-section {
            width: 42% !important;
        }
    }
    `;

    document.head.appendChild(style);
}

// ==========================================
// 分類判定
// ==========================================

function _getTrainCategoryId(style, train_no) {

    const base_no = String(train_no).replace(/-End$/, '');

    if (base_no === '1' || base_no === '2') {
        return 'chu_kuang';
    }

    if (/[a-zA-Z]/.test(base_no)) {
        return 'others';
    }

    for (let i = 1; i < _filterCategories.length - 2; i++) {

        if (_filterCategories[i].styles.includes(style)) {
            return _filterCategories[i].id;
        }
    }

    return 'special';
}

// ==========================================
// 視覺更新
// ==========================================

function _updateAllPathVisuals() {

    _allPathEls.forEach((el, pathId) => {

        const baseId = pathId.replace(/-End$/, '');

        const data = _trainDataMap.get(baseId);

        if (!data) return;

        const selected = _selectedPathId === baseId;

        const filtered =
            _activeFilter !== 'all' &&
            _getTrainCategoryId(data.style, data.train_no) === _activeFilter;

        if (selected) {

            el.style('stroke-width', '6')
              .style('opacity', '1');

        } else if (filtered) {

            el.style('stroke-width', '5')
              .style('opacity', '1');

        } else {

            el.style('stroke-width', null)
              .style('opacity', null);
        }
    });
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
// 搜尋 UI
// ==========================================

function _refreshSearchResults() {

    const inp = document.getElementById('d3-search-input');

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

            const cat = _getTrainCategoryId(data.style, data.train_no);

            if (cat !== _activeFilter) continue;
        }

        if (q && !String(data.train_no).toLowerCase().includes(q)) {
            continue;
        }

        matches.push({ pathId, data });
    }

    matches.sort((a, b) =>
        String(a.data.train_no).localeCompare(
            String(b.data.train_no),
            undefined,
            { numeric: true }
        )
    );

    for (const match of matches) {

        const { pathId, data } = match;

        const item = document.createElement('div');

        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';

        item.innerHTML = `
            <b>${data.train_no}</b>
            <span style="float:right;color:#aaa">
                ${_carKindLabel[data.style] || data.style}
            </span>
        `;

        item.onclick = () => {

            _highlight(pathId);

            _panToTrain(pathId);
        };

        container.appendChild(item);
    }

    if (matches.length === 0) {

        container.innerHTML = `
            <div style="color:#888;padding:8px;text-align:center">
                無符合車次
            </div>
        `;
    }
}

// ==========================================
// UI 初始化
// ==========================================

function _init_ui_panels() {

    if (document.getElementById('d3-ui-wrapper')) return;

    const wrapper = document.createElement('div');

    wrapper.id = 'd3-ui-wrapper';

    Object.assign(wrapper.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: '9999'
    });

    const btn = document.createElement('button');

    btn.innerText = '🔍';

    Object.assign(btn.style, {
        width: '52px',
        height: '52px',
        borderRadius: '50%',
        border: 'none',
        background: '#1a73e8',
        color: '#fff',
        fontSize: '22px'
    });

    const panel = document.createElement('div');

    panel.id = 'd3-panel-body';

    Object.assign(panel.style, {
        display: 'none',
        position: 'absolute',
        right: '0',
        bottom: '60px',
        background: 'rgba(15,23,42,0.96)',
        color: '#fff',
        borderRadius: '12px',
        overflow: 'hidden'
    });

    panel.innerHTML = `
        <div style="display:flex">

            <div class="d3-filter-section d3-custom-scrollbar"
                 style="padding:12px;max-height:280px;overflow:auto">

                <div id="d3-filter-list"></div>
            </div>

            <div class="d3-search-section"
                 style="padding:12px">

                <input
                    id="d3-search-input"
                    placeholder="搜尋車次"
                    style="
                        width:100%;
                        padding:8px;
                        box-sizing:border-box;
                    "
                >

                <div
                    id="d3-search-results"
                    class="d3-custom-scrollbar"
                    style="
                        margin-top:8px;
                        max-height:220px;
                        overflow:auto;
                    "
                ></div>
            </div>

        </div>
    `;

    wrapper.appendChild(panel);

    wrapper.appendChild(btn);

    document.body.appendChild(wrapper);

    // 搜尋
    panel.querySelector('#d3-search-input')
        .addEventListener('input', e => {

            _renderSearchResults(
                e.target.value.trim(),
                panel.querySelector('#d3-search-results')
            );
        });

    // 展開
    let opened = false;

    btn.onclick = e => {

        e.stopPropagation();

        opened = !opened;

        panel.style.display = opened ? 'block' : 'none';

        if (opened) {

            _renderFilterList();

            _renderSearchResults(
                '',
                panel.querySelector('#d3-search-results')
            );
        }
    };

    // 手機 viewport 修正
    if (window.visualViewport) {

        const vv = window.visualViewport;

        const updatePos = () => {

            if (vv.scale > 1) {

                wrapper.style.position = 'absolute';

                wrapper.style.left =
                    (vv.pageLeft + vv.width - 80) + 'px';

                wrapper.style.top =
                    (vv.pageTop + vv.height - 80) + 'px';

            } else {

                wrapper.style.position = 'fixed';

                wrapper.style.left = 'auto';

                wrapper.style.top = 'auto';

                wrapper.style.right = '24px';

                wrapper.style.bottom = '24px';
            }
        };

        vv.addEventListener('scroll', updatePos);

        vv.addEventListener('resize', updatePos);

        updatePos();
    }

    function _renderFilterList() {

        const list = document.getElementById('d3-filter-list');

        list.innerHTML = '';

        _filterCategories.forEach(cat => {

            const item = document.createElement('div');

            item.innerText = cat.name;

            item.style.padding = '6px';

            item.style.cursor = 'pointer';

            item.onclick = () => {

                _activeFilter = cat.id;

                _updateAllPathVisuals();

                _refreshSearchResults();
            };

            list.appendChild(item);
        });
    }
}

// ==========================================
// 背景繪製
// ==========================================

function draw_diagram_background(line_kind, date) {

    Object.entries(OperationLines).forEach(([key, value]) => {

        if (key !== line_kind) return;

        const totalWidth = 1200 * (DiagramHours.length - 1) + 100;

        const totalHeight = value.MAX_X_AXIS;

        _init_ui_panels();

        const svg = d3.select('body')
            .append('svg')
            .attr('width', totalWidth)
            .attr('height', totalHeight + 125);

        _d3Svg = svg;

        const g = svg.append('g');

        _d3G = g;

        window.diagram_objects[key] = g;

        add_text(
            g,
            `${value.NAME} 日期:${date}`,
            5,
            0
        );
    });
}

// ==========================================
// Train Path
// ==========================================

function set_path(lk, train_no, train_kind, value) {

    let pathData = 'M';

    const coordinates = [];

    const stationPoints = [];

    const style = CarKind[train_kind] || 'others';

    const needStop = find_diagram_need_to_stop(lk);

    for (const [dsc, id, time, loc, stop] of value) {

        let x =
            time * 10 -
            1200 * DiagramHours[0] +
            50;

        let y = loc + 50;

        if (stop !== -1 || needStop.includes(id)) {

            pathData += `${x},${y} `;

            coordinates.push([x, y]);

            stationPoints.push({ x, y, dsc, time });
        }
    }

    const pathId = lk + train_no;

    _trainDataMap.set(pathId, {
        train_no,
        train_kind,
        style,
        stationPoints
    });

    add_path(
        window.diagram_objects[lk],
        lk,
        train_no,
        pathData,
        [],
        style
    );
}

// ==========================================
// Path
// ==========================================

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
        .style('pointer-events', 'stroke');

    const baseId = pathId.replace(/-End$/, '');

    hitEl.on('click', e => {

        e.stopPropagation();

        _highlight(baseId);
    });
}

// ==========================================
// 輔助
// ==========================================

function add_line(g, x1, y1, x2, y2, style) {

    const el = g.append('line')
        .attr('x1', x1)
        .attr('y1', y1)
        .attr('x2', x2)
        .attr('y2', y2);

    if (style) {
        el.attr('class', style);
    }
}

function add_text(g, text_string, x, y, style) {

    const el = g.append('text')
        .attr('x', x)
        .attr('y', y)
        .text(text_string);

    if (style) {
        el.attr('class', style);
    }
}

function _panToTrain(pathId) {

    const data = _trainDataMap.get(pathId);

    if (!data || data.stationPoints.length === 0) return;

    const pt = data.stationPoints[0];

    window.scrollTo({
        left: pt.x - window.innerWidth / 2,
        top: pt.y - window.innerHeight / 2,
        behavior: 'smooth'
    });
}

function find_diagram_need_to_stop(lk) {

    return LinesStationsForBackground[lk]
        .filter(v => v.TERMINAL === 'Y')
        .map(v => v.ID);
}
