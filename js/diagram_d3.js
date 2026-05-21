// ==========================================
// 🌟 UI 控制中心 (純綁定 HTML 版，不干涉 CSS 與創建)
// ==========================================
function _init_ui_panels() {
    // 1. 直接抓取 HTML 裡已經建好的元素
    const wrapper = document.getElementById('d3-ui-wrapper');
    const toggleBtn = document.getElementById('d3-toggle-btn');
    const panelBody = document.getElementById('d3-panel-body');
    const searchInput = document.getElementById('d3-search-input');
    const searchResults = document.getElementById('d3-search-results');
    const filterList = document.getElementById('d3-filter-list');

    // 2. 如果找不到元素，或已經綁定過了，就跳出
    if (!toggleBtn || !panelBody) return;
    if (toggleBtn.dataset.bound === 'true') return; 
    toggleBtn.dataset.bound = 'true';

    // 3. 渲染左側過濾清單 (這裡內容是動態的，所以保留 JS 生成)
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
            
            item.innerHTML = `<span class="d3-item-text" style="font-size:12px;">${cat.name}</span> <span class="d3-item-badge" style="background: rgba(0,0,0,0.3); border-radius:10px; color:#cbd5e1">${counts[cat.id]}</span>`;
            
            item.addEventListener('click', () => { _activeFilter = cat.id; _renderFilterList(); _applyFilter(); });
            filterList.appendChild(item);
        });
    }

    // 4. 綁定按鈕開關事件
    let isPanelOpen = false;
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isPanelOpen = !isPanelOpen;
        if (isPanelOpen) {
            _renderFilterList(); 
            panelBody.style.display = 'flex';
            requestAnimationFrame(() => { 
                panelBody.style.opacity = '1'; 
                panelBody.style.transform = 'translateY(0)'; 
            });
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

    // 5. 綁定搜尋框事件
    searchInput.addEventListener('input', () => _renderSearchResults(searchInput.value.trim(), searchResults));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isPanelOpen) toggleBtn.click(); });
    panelBody.addEventListener('click', (e) => e.stopPropagation());
    
    // ⛔ 因為你的 HTML 已經設定了強大的 CSS 定位與防縮放，這裡再也不需要寫任何複雜的手機防跑版數學公式了！
}
