// ==========================================
// 🌟 JSON 轉換與核心控制模組
// ==========================================

// JSON檔處理，將JSON檔案轉換成時間空間資料，可指定車次
function json_to_trains_data(json_data, train_no_input, line_kind) {
    let all_trains_data = [];

    if (!json_data || !Array.isArray(json_data['TrainInfos'])) {
        console.warn("JSON資料格式錯誤，無法處理");
        return all_trains_data;
    }

    for (let i = 0; i < json_data['TrainInfos'].length; i++) {
        let train_no = "";
        try {
            let trainInfo = json_data['TrainInfos'][i];

            // 確保資料存在
            if (!trainInfo || typeof trainInfo['Train'] === "undefined") {
                console.warn(`TrainInfos[${i}] 缺少 Train 欄位，已跳過`);
                continue;
            }

            // 決定要處理的車次編號
            train_no = (train_no_input.length === 0) ? trainInfo['Train'] : train_no_input;

            // 過濾：只處理目標車次
            if (trainInfo['Train'] == train_no) {
                let train_data = calculate_space_time(trainInfo, line_kind);

                if (train_data && Array.isArray(train_data)) {
                    all_trains_data.push(train_data);
                } else {
                    console.warn(`車次 ${train_no} 的空間時間資料無效，已跳過`);
                }
            }
        } catch (e) {
            console.error(`車次：${train_no} 資料處理失敗，已跳過。錯誤訊息：`, e);
            continue; // 遇到錯誤直接跳過，不影響其他車次
        }
    }

    return all_trains_data;
}

// 處理單一車次資料
function calculate_space_time(train, line_kind) {
    const train_id = train['Train'];                
    const car_class = train['CarClass'];            
    const line = train['Line'];                     
    const line_dir = train['LineDir'];              
    const timetable = train['TimeInfos'];

    let timetable_dict = {};                        
    let _trains_data = [];                          

    // 🌟 全自動環島/環線修正：支援「八堵繞一圈回基隆」與「竹南成追環線回竹南」
    // 只要任何車站在時刻表中出現第二次，自動加上 '_LOOP' 避免字典覆蓋
    const seen_timetable_st = new Set();
    for (let i = 0; i < timetable.length; i++) {
        let raw_st = String(timetable[i].Station).replace('_LOOP', '');
        if (seen_timetable_st.has(raw_st)) {
            timetable[i].Station = raw_st + '_LOOP';
        } else {
            timetable[i].Station = raw_st;
            seen_timetable_st.add(raw_st);
        }
    }

    // 建立時刻表字典
    for (let TimeInfos of timetable) {
        timetable_dict[TimeInfos.Station] = [TimeInfos.ARRTime, TimeInfos.DEPTime, TimeInfos.Station, TimeInfos.Order];
    }

    // 找出車次「停靠與通過」的所有車站 (拓撲推算)
    const passing_stations = find_passing_stations(timetable, line, line_dir);
    
    // 整理車次通過的所有車站到站與離站時間
    const estimate_time_space = estimate_timeSpace(timetable_dict, passing_stations);
    
    // 將車次的通過車站、到離站時間轉入各營運路線
    const operation_lines = time_space_to_operation_lines(estimate_time_space, line_kind);

    Object.entries(operation_lines).forEach(([key, value]) => {
        _trains_data.push([key, train_id, car_class, line, line_dir, value]);
    });

    return _trains_data;
}


// ==========================================
// 🌟 路線拓撲與車站推算模組 (支援全島環線 & 成追線環線)
// ==========================================

// 查詢車次會「停靠與通過」的所有車站
function find_passing_stations(timetable, line, line_dir) {
    const start_station = String(timetable[0]['Station']).replace('_LOOP', '');
    let raw_end_station = String(timetable[timetable.length - 1]['Station']);
    let end_station = raw_end_station.replace('_LOOP', '');
    if (end_station === '1001') end_station = '1000';

    let _passing_stations = [];
    let station = start_station;
    let km = 0.0;

    // 取得乾淨的停靠站序列（去除 _LOOP），並用 target_idx 依序追蹤下一站目標
    let stations = timetable.map(item => String(item['Station']).replace('_LOOP', ''));
    let visited_raw_stations = new Set();
    let target_idx = 1;

    // 區間判定輔助函式
    const isCoastSt = (st) => /^21|^22[0-5]/.test(st); // 海線 (談文 2110 ~ 大肚 2250)
    const isMountSt = (st) => /^31[4-9]|^32|^33[0-4]/.test(st); // 山線 (造橋 3140 ~ 新烏日 3340)
    const isNorthOfZhunan = (st) => /^0|^1[01]|^12[0-4]|^7/.test(st); // 竹南以北

    // 🌟 智慧判定是否經由「成追線 (2260 <-> 3350)」(排除中間有停靠彰化 3360 的列車)
    let cheng_zhui = (line === "3");
    if (!cheng_zhui && !stations.includes('3360')) {
        if (stations.includes('2260') && stations.includes('3350')) {
            cheng_zhui = true;
        } else {
            for (let i = 0; i < stations.length - 1; i++) {
                const s1 = stations[i], s2 = stations[i + 1];
                if (((isCoastSt(s1) || s1 === '2260') && (isMountSt(s2) || s2 === '3350')) ||
                    ((isMountSt(s1) || s1 === '3350') && (isCoastSt(s2) || s2 === '2260'))) {
                    cheng_zhui = true;
                    break;
                }
            }
        }
    }

    let neiwan = stations.includes('1191') || stations.includes('1192') || stations.includes('1193') || stations.includes('1194') || stations.includes('1201') || stations.includes('1202') || stations.includes('1203') || stations.includes('1204') || stations.includes('1205') || stations.includes('1206') || stations.includes('1207') || stations.includes('1208');
    let pingxi = stations.includes('7362') || stations.includes('7361') || stations.includes('7331') || stations.includes('7332') || stations.includes('7333') || stations.includes('7334') || stations.includes('7335') || stations.includes('7336');
    let jiji = stations.includes('3431') || stations.includes('3432') || stations.includes('3433') || stations.includes('3434') || stations.includes('3435') || stations.includes('3436');
    let shalun = stations.includes('4271') || stations.includes('4272');

    // 🌟 起點站初始 line_dir 自動校正：解決成追線車次在海線/山線起點 LineDir 與實際南下/北上相反的問題
    // 🌟 起點站初始 line_dir 自動校正 (包含山海線與四大支線)
    if (stations.length > 1) {
        const first_target = stations[1];
        if (isCoastSt(start_station)) {
            if ((isCoastSt(first_target) && parseInt(first_target) > parseInt(start_station)) || first_target === '2260' || isMountSt(first_target) || first_target === '3350' || first_target === '3360') {
                line_dir = '2'; // 海線南下
            } else if ((isCoastSt(first_target) && parseInt(first_target) < parseInt(start_station)) || first_target === '1250' || isNorthOfZhunan(first_target)) {
                line_dir = '1'; // 海線北上
            }
        } else if (isMountSt(start_station)) {
            if ((isMountSt(first_target) && parseInt(first_target) > parseInt(start_station)) || first_target === '3350' || isCoastSt(first_target) || first_target === '2260' || first_target === '3360') {
                line_dir = '2'; // 山線南下
            } else if ((isMountSt(first_target) && parseInt(first_target) < parseInt(start_station)) || first_target === '1250' || isNorthOfZhunan(first_target)) {
                line_dir = '1'; // 山線北上
            }
        } 
        // 👇 新增：平溪線 (7331~7336) 與 內灣線 (1191~1208) 往深處(站碼變大)為 CW('1')，往主線為 CCW('2')
        else if (/^733[1-6]$/.test(start_station) && /^733[0-6]$/.test(first_target)) {
            line_dir = (parseInt(first_target) > parseInt(start_station)) ? '1' : '2';
        } else if (/^119[1-4]|^120[1-8]$/.test(start_station) && /^119[0-4]|^120[1-8]$/.test(first_target)) {
            line_dir = (parseInt(first_target) > parseInt(start_station)) ? '1' : '2';
        }
        // 👇 新增：深澳線 (7361~7362)、集集線 (3431~3436)、沙崙線 (4271~4272) 往深處(站碼變大)為 CCW('2')，往主線為 CW('1')
        else if (/^736[1-2]|^343[1-6]|^427[1-2]$/.test(start_station)) {
            line_dir = (parseInt(first_target) > parseInt(start_station)) ? '2' : '1';
        }
    }

    // 判斷在八堵(0920)是否準備好轉入「三坑(0910) -> 基隆(0900)」終點支線
    const isReadyForKeelungBranch = () => {
        if (end_station !== '0900' && end_station !== '0910') return false;
        const remaining = stations.slice(target_idx);
        return remaining.every(st => st === '0920' || st === '0910' || st === '0900' || visited_raw_stations.has(st));
    };

    // 核心：智慧計算下一站的子函式 (全面統一使用標準 CW/CCW，只在路口做精準分流)
    const getNextStep = (curr, dir, prev_st, isRetry = false) => {
        let n_st = '', d_km = 0;
        let ccw_fallback = Route[curr].CCW || Route[curr].CCW_BRANCH || '';
        let cw_fallback = Route[curr].CW || Route[curr].CW_BRANCH || '';
        const remaining = stations.slice(target_idx);
        const next_target = remaining.find(st => st !== curr) || end_station;

        if (!isRetry) {
            // 1. 八堵 (0920) 三叉路口
            if (curr === '0920') {
                if (isReadyForKeelungBranch() && prev_st !== '0910') {
                    return { st: '0910', km: parseFloat(Route[curr].CW_KM || 0), forceDir: '1' };
                }
                if (prev_st === '0910') {
                    const hasEastAhead = remaining.some(st => /^7|^6/.test(st));
                    if (hasEastAhead) {
                        return { st: Route[curr].CW_BRANCH || '7390', km: parseFloat(Route[curr].CW_BRANCH_KM || 0), forceDir: '1' };
                    }
                }
            }

            // 2. 竹南 (1250) 山海線分岔口
            if (curr === '1250') {
                if ((prev_st === '2110' || prev_st === '3140') && (remaining.some(st => isNorthOfZhunan(st)) || isNorthOfZhunan(end_station))) {
                    return { st: '1240', km: parseFloat(Route['1250'].CW_KM || 0), forceDir: '1' };
                }
                const nextCoastOrMount = remaining.find(st => isCoastSt(st) || st === '2260' || isMountSt(st) || st === '3350');
                if (nextCoastOrMount) {
                    if ((isCoastSt(nextCoastOrMount) || nextCoastOrMount === '2260') && prev_st !== '2110') {
                        return { st: '2110', km: parseFloat(Route['1250'].CCW_BRANCH_KM || Route['1250'].CCW_KM || 0), forceDir: '2' };
                    }
                    if ((isMountSt(nextCoastOrMount) || nextCoastOrMount === '3350') && prev_st !== '3140') {
                        return { st: '3140', km: parseFloat(Route['1250'].CCW_KM || 0), forceDir: '2' };
                    }
                }
            }

            // 3. 追分 (2260) 成追線/彰化分岔口
            if (curr === '2260') {
                if (prev_st === '3350' || prev_st === '3360') {
                    return { st: '2250', km: parseFloat(Route['2260'].CW_KM || 0), forceDir: '1' };
                }
                if (prev_st === '2250' || prev_st === null) {
                    if (prev_st === null && (isCoastSt(next_target) || (next_target === '1250' && !cheng_zhui))) {
                        return { st: '2250', km: parseFloat(Route['2260'].CW_KM || 0), forceDir: '1' };
                    }
                    if (cheng_zhui) {
                        return { st: '3350', km: parseFloat(Route['2260'].CHENG_ZHUI_CW_KM || Route['2260'].CHENG_ZHUI_CCW_KM || 2.2), forceDir: '1' };
                    }
                    return { st: '3360', km: parseFloat(Route['2260'].CCW_KM || 0), forceDir: '2' };
                }
            }

            // 4. 成功 (3350) 成追線/山線分岔口
            if (curr === '3350') {
                if (prev_st === '2260' || prev_st === '3360' || prev_st === '3355') {
                    return { st: '3340', km: parseFloat(Route['3350'].CW_KM || 0), forceDir: '1' };
                }
                if (prev_st === '3340' || prev_st === null) {
                    if (prev_st === null && (isMountSt(next_target) || (next_target === '1250' && !cheng_zhui))) {
                        return { st: '3340', km: parseFloat(Route['3350'].CW_KM || 0), forceDir: '1' };
                    }
                    if (cheng_zhui) {
                        return { st: '2260', km: parseFloat(Route['3350'].CHENG_ZHUI_CW_KM || Route['3350'].CHENG_ZHUI_CCW_KM || 2.2), forceDir: '1' };
                    }
                    return { st: Route['3350'].CCW || '3360', km: parseFloat(Route['3350'].CCW_KM || 0), forceDir: '2' };
                }
            }

            // 5. 彰化 (3360) 北上山海線分岔口：根據後續目標站自動選擇山線或海線，不受 Line='0' 影響
            if (curr === '3360' && dir === '1') {
                const nextNorthSt = remaining.find(st => isCoastSt(st) || st === '2260' || isMountSt(st) || st === '3350');
                if (nextNorthSt && (isCoastSt(nextNorthSt) || nextNorthSt === '2260')) {
                    return { st: Route['3360'].CW_BRANCH || '2260', km: parseFloat(Route['3360'].CW_BRANCH_KM || 0), forceDir: '1' };
                }
                if (nextNorthSt && (isMountSt(nextNorthSt) || nextNorthSt === '3350')) {
                    return { st: Route['3360'].CW || '3350', km: parseFloat(Route['3360'].CW_KM || 0), forceDir: '1' };
                }
            }
        }

        // 🌟 標準路段導航：全面使用統一的 CW / CCW，徹底消除 CHENG_ZHUI 反向衝突！
        if (dir === '2') {
            let branch = Route[curr].CCW_BRANCH || '';
            if (branch !== '') {
                if (curr === '7360') { n_st = (end_station === '7362') ? '7361' : ccw_fallback; d_km = (end_station === '7362') ? parseFloat(Route[curr].CCW_BRANCH_KM||0) : parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                else if (curr === '3430') { n_st = jiji ? '3431' : ccw_fallback; d_km = jiji ? parseFloat(Route[curr].CCW_BRANCH_KM||0) : parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                else if (curr === '4270') { n_st = shalun ? '4271' : ccw_fallback; d_km = shalun ? parseFloat(Route[curr].CCW_BRANCH_KM||0) : parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                else if (['1', '0', 'LINE_Alishan', 'thsr'].includes(line)) { n_st = ccw_fallback; d_km = parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                else if (line === '2') { n_st = Route[curr].CCW_BRANCH || Route[curr].CCW; d_km = parseFloat(Route[curr].CCW_BRANCH_KM || Route[curr].CCW_KM||0); }
                else { n_st = ccw_fallback; d_km = parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
            } else { n_st = ccw_fallback; d_km = parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
        } else if (dir === '1') {
            let branch = Route[curr].CW_BRANCH || '';
            if (branch !== '') {
                if (curr === '0920') { n_st = Route[curr].CW_BRANCH; d_km = parseFloat(Route[curr].CW_BRANCH_KM||0); }
                else if (curr === '7130') { n_st = (end_station === '7120') ? '7120' : '7110'; d_km = (end_station === '7120') ? parseFloat(Route[curr].CW_BRANCH_KM||0) : parseFloat(Route[curr].CW_KM||0); }
                else if (curr === '1190' || curr === '1193') {
                    if (neiwan) {
                        if (curr === '1190') { n_st = '1191'; d_km = parseFloat(Route[curr].CW_BRANCH_KM||0); }
                        else { n_st = (end_station === '1208' || end_station === '1203') ? '1201' : '1194'; d_km = parseFloat(Route[curr].CW_BRANCH_KM||0); }
                    } else { n_st = '1180'; d_km = parseFloat(Route[curr].CW_KM||0); }
                }
                else if (curr === '7330') { n_st = pingxi ? '7331' : '7320'; d_km = pingxi ? parseFloat(Route[curr].CW_BRANCH_KM||0) : parseFloat(Route[curr].CW_KM||0); }
                else if (['1', '0', 'LINE_Alishan', 'thsr'].includes(line)) { n_st = cw_fallback; d_km = parseFloat(Route[curr].CW_KM||Route[curr].CW_BRANCH_KM||0); }
                else if (line === '2') { n_st = Route[curr].CW_BRANCH || Route[curr].CW; d_km = parseFloat(Route[curr].CW_BRANCH_KM || Route[curr].CW_KM||0); }
                else { n_st = cw_fallback; d_km = parseFloat(Route[curr].CW_KM||Route[curr].CW_BRANCH_KM||0); }
            } else { n_st = cw_fallback; d_km = parseFloat(Route[curr].CW_KM||Route[curr].CW_BRANCH_KM||0); }
        }
        return { st: n_st, km: d_km, forceDir: dir };
    };

    // --- 開始模擬火車行走 ---
    while (true) {
        const dsc = Route[station]?.DSC || `未知站(${station})`;
        const routeKm = Route[station]?.KM || 0; 
        
        const isSecondVisit = visited_raw_stations.has(String(station));
        const pushed_id = isSecondVisit ? `${station}_LOOP` : String(station);
        visited_raw_stations.add(String(station));

        if (_passing_stations.length > 0 && target_idx < stations.length) {
            if (String(station) === stations[target_idx]) {
                target_idx++;
            } else {
                const matchIdx = stations.indexOf(String(station), target_idx);
                if (matchIdx !== -1) target_idx = matchIdx + 1;
            }
        }

        _passing_stations.push([pushed_id, dsc, routeKm, km]);

        if (station === end_station && _passing_stations.length > 1) {
            if (start_station !== end_station || target_idx >= stations.length || _passing_stations.length > 10) {
                if (raw_end_station === '1001') {
                    _passing_stations[_passing_stations.length - 1][0] = '1001';
                }
                break;
            }
        }

        if (!Route[station]) {
            console.warn(`⚠️ 字典徹底斷裂，無法離開 [${station}]`); break;
        }

        let prev_st = _passing_stations.length >= 2 ? _passing_stations[_passing_stations.length - 2][0].replace('_LOOP', '') : null;
        let step = getNextStep(station, line_dir, prev_st, false);

        if (step.forceDir) {
            line_dir = step.forceDir;
        }

        if (!step.st || step.st === prev_st) {
            let alt_dir = (line_dir === '1') ? '2' : '1';
            let alt_step = getNextStep(station, alt_dir, prev_st, true);
            
            if (alt_step.st && alt_step.st !== prev_st) {
                step = alt_step;
                line_dir = alt_step.forceDir || alt_dir; 
            } else {
                console.warn(`⚠️ 雙向死路！站點: ${station}`); break;
            }
        }

        km += step.km;
        station = step.st;

        if (_passing_stations.length > 500) {
            console.warn(`⚠️ 迴圈超過 500 次，強制中斷 (起終點: ${start_station}->${end_station}, 目前卡在: ${station})`); break;
        }
    }

    return _passing_stations;
}


// ==========================================
// 🌟 時間推算與插補模組
// ==========================================

// 整理車次會通過的所有車站到站與離站時間
function estimate_timeSpace(timetable, passing_stations) {
    let _estimate_time_space = {};
    let index = 0;
    const timetable_stations = Object.keys(timetable);

    // 將起終點中間歷經的停靠與通過車站均找出
    for (const [StationId, StationName, LocationKM, KM] of passing_stations) {
        if (timetable_stations.includes(StationId)) {
            let ARRTime = parseFloat(SVG_X_Axis[timetable[StationId][0]]?.ax1 ?? NaN);
            let DEPTime = parseFloat(SVG_X_Axis[timetable[StationId][1]]?.ax1 ?? NaN);
            let Order = parseInt(timetable[StationId][3]);

            _estimate_time_space[index]   = [StationId, StationName, parseFloat(KM), ARRTime, Order];
            _estimate_time_space[index+1] = [StationId, StationName, parseFloat(KM), DEPTime, Order];
            index += 2;
        } else {
            _estimate_time_space[index] = [StationId, StationName, parseFloat(KM), NaN, -1];
            index += 1;
        }
    }

    // 跨午夜車次處理
    let after_midnight_row_index = -1;
    let last_time_value = -1;

    Object.entries(_estimate_time_space).forEach(([key, value]) => {
        if (!isNaN(value[3])) {
            if (value[3] < last_time_value) {
                after_midnight_row_index = parseInt(key);
            }
            last_time_value = value[3];
        }
    });

    if (after_midnight_row_index !== -1) {
        Object.entries(_estimate_time_space).forEach(([key, value]) => {
            if (parseInt(key) >= after_midnight_row_index) {
                value[3] += 2880;
            }
        });
    }

    let interpolate = [];
    Object.entries(_estimate_time_space).forEach(([key, value]) => interpolate.push(value[3]));
    const interpolatedArray = linearInterpolation(interpolate);
    Object.entries(_estimate_time_space).forEach(([key, value]) => value[3] = interpolatedArray[key]);

    return _estimate_time_space;
}

// 將車次通過車站時間轉入各營運路線的資料
function time_space_to_operation_lines(estimate_time_space, line_kind) {
    let _operation_lines = {};

    // 相容 LinesStations 與 LinesStationsForBackground
    const stationDict = (typeof LinesStations !== 'undefined' && LinesStations[line_kind]) 
        ? LinesStations 
        : (typeof LinesStationsForBackground !== 'undefined' ? LinesStationsForBackground : LinesStations);

    for (let key in stationDict) {
        _operation_lines[key] = [];
    }
    if (!_operation_lines[line_kind]) {
        _operation_lines[line_kind] = [];
    }

    const pageStations = stationDict[line_kind];
    if (!pageStations) return _operation_lines;

    const rows = Object.entries(estimate_time_space);
    let offset = 0;
    let prev_real_id = null;

    // ==========================================
    // 🌟 雙端點智慧分流設定 (同時支援「八堵 0920」與「竹南 1250」)
    // ==========================================
    const dualConfigs = {};

    // 1. 八堵雙端點 (0920 與 0920_LOOP)：A側為暖暖(7390)，B側為七堵(0930)/三坑(0910)
    if (('0920' in pageStations) && ('0920_LOOP' in pageStations) && ('7390' in pageStations)) {
        let keyNearA = '0920', keyNearB = '0920_LOOP';
        const y_0920 = pageStations['0920']['SVGYAXIS'];
        const y_loop = pageStations['0920_LOOP']['SVGYAXIS'];
        const y_7390 = pageStations['7390']['SVGYAXIS'];
        if (Math.abs(y_loop - y_7390) < Math.abs(y_0920 - y_7390)) {
            keyNearA = '0920_LOOP'; keyNearB = '0920';
        }
        dualConfigs['0920'] = {
            sideA: new Set(['7390']),
            sideB: new Set(['0930', '0910']),
            keyNearA,
            keyNearB
        };
    }

    // 2. 竹南雙端點 (1250 與 1250_LOOP)：A側為海線談文(2110/2115)，B側為山線造橋(3140)
    if (('1250' in pageStations) && ('1250_LOOP' in pageStations) && ('2110' in pageStations)) {
        let keyNearA = '1250', keyNearB = '1250_LOOP';
        const y_1250 = pageStations['1250']['SVGYAXIS'];
        const y_loop = pageStations['1250_LOOP']['SVGYAXIS'];
        const y_2110 = pageStations['2110']['SVGYAXIS'];
        if (Math.abs(y_loop - y_2110) < Math.abs(y_1250 - y_2110)) {
            keyNearA = '1250_LOOP'; keyNearB = '1250';
        }
        dualConfigs['1250'] = {
            sideA: new Set(['2110', '2115']),
            sideB: new Set(['3140']),
            keyNearA,
            keyNearB
        };
    }

    for (let i = 0; i < rows.length; i++) {
        const [key, value] = rows[i];
        let original_id = value[0];
        let real_id = original_id.replace('_LOOP', '');
        if (real_id === '1001') real_id = '1000';

        // 🌟 若遇到雙端點車站 (如 0920 八堵 或 1250 竹南)
        if (dualConfigs[real_id]) {
            const cfg = dualConfigs[real_id];

            // 往前找上一個不同站碼的車站
            let prev_diff_st = null;
            for (let p = i - 1; p >= 0; p--) {
                let pid = rows[p][1][0].replace('_LOOP', '');
                if (pid !== real_id) { prev_diff_st = pid; break; }
            }
            // 往後找下一個不同站碼的車站
            let next_diff_st = null;
            for (let n = i + 1; n < rows.length; n++) {
                let nid = rows[n][1][0].replace('_LOOP', '');
                if (nid !== real_id) { next_diff_st = nid; break; }
            }

            // 檢查是否為雙列停靠點 (到站+離站)
            const isTwoRowStop = (i + 1 < rows.length) && (rows[i + 1][1][0].replace('_LOOP', '') === real_id);

            const fromA = cfg.sideA.has(prev_diff_st);
            const toA   = cfg.sideA.has(next_diff_st);
            const fromB = cfg.sideB.has(prev_diff_st);
            const toB   = cfg.sideB.has(next_diff_st);

            // 若該列車在畫面內完全沒有連接海線、山線或宜蘭線 (例如只從崎頂 1240 終點竹南 1250)，直接跳過避免孤立點
            // 情況 1：從 B 側開往 A 側
            if (fromB && toA) {
                const arrRow = rows[i][1];
                const depRow = isTwoRowStop ? rows[i + 1][1] : rows[i][1];

                _operation_lines[line_kind].push([
                    arrRow[1], arrRow[0], arrRow[3], // 👈 保留原始站碼 arrRow[0]
                    pageStations[cfg.keyNearB]['SVGYAXIS'], arrRow[4],
                    parseInt(rows[i][0]) + offset
                ]);

                offset += 1000;

                _operation_lines[line_kind].push([
                    depRow[1], depRow[0], depRow[3], // 👈 保留原始站碼 depRow[0]
                    pageStations[cfg.keyNearA]['SVGYAXIS'], depRow[4],
                    parseInt(isTwoRowStop ? rows[i + 1][0] : rows[i][0]) + offset
                ]);

                if (isTwoRowStop) i++;
                prev_real_id = real_id;
                continue;
            }

            // 情況 2：從 A 側開往 B 側
            if (fromA && toB) {
                const arrRow = rows[i][1];
                const depRow = isTwoRowStop ? rows[i + 1][1] : rows[i][1];

                _operation_lines[line_kind].push([
                    arrRow[1], arrRow[0], arrRow[3], // 👈 保留原始站碼 arrRow[0]
                    pageStations[cfg.keyNearA]['SVGYAXIS'], arrRow[4],
                    parseInt(rows[i][0]) + offset
                ]);

                offset += 1000;

                _operation_lines[line_kind].push([
                    depRow[1], depRow[0], depRow[3], // 👈 保留原始站碼 depRow[0]
                    pageStations[cfg.keyNearB]['SVGYAXIS'], depRow[4],
                    parseInt(isTwoRowStop ? rows[i + 1][0] : rows[i][0]) + offset
                ]);

                if (isTwoRowStop) i++;
                prev_real_id = real_id;
                continue;
            }

            // 情況 3：單純連接 A 側或單純連接 B 側
            const targetKey = (fromA || toA) ? cfg.keyNearA : cfg.keyNearB;
            prev_real_id = real_id;

            _operation_lines[line_kind].push([
                value[1], original_id, value[3], // 👈 保留原始站碼 original_id
                pageStations[targetKey]['SVGYAXIS'], value[4],
                parseInt(key) + offset
            ]);
            continue;
        }

        // 一般車站處理
        if (real_id in pageStations) {
            if (!dualConfigs['0920'] && ['LINE_Counterclockwise', 'LINE_Clockwise', 'LINE_All', 'LINE_ALL'].includes(line_kind)) {
                if (
                    (prev_real_id === '0920' && real_id === '7390') ||
                    (prev_real_id === '7390' && real_id === '0920')
                ) {
                    offset += 1000;
                }
            }

            prev_real_id = real_id;

            _operation_lines[line_kind].push([
                value[1], 
                original_id, 
                value[3], 
                pageStations[real_id]['SVGYAXIS'], 
                value[4], 
                parseInt(key) + offset
            ]);
        }
    }

    return _operation_lines;
}

// 線性插補函式
function linearInterpolation(array) {
    for (let i = 0; i < array.length; i++) {
        if (isNaN(array[i])) {
            let prevValue, nextValue, prevIndex, nextIndex;

            // 往前找
            for (let j = i - 1; j >= 0; j--) {
                if (!isNaN(array[j])) {
                    prevValue = array[j];
                    prevIndex = j;
                    break;
                }
            }

            // 往後找
            for (let j = i + 1; j < array.length; j++) {
                if (!isNaN(array[j])) {
                    nextValue = array[j];
                    nextIndex = j;
                    break;
                }
            }

            // 計算插補
            if (prevValue !== undefined && nextValue !== undefined) {
                const indexDiff = nextIndex - prevIndex;
                const valueDiff = nextValue - prevValue;
                const interpolatedValue = prevValue + (valueDiff / indexDiff) * (i - prevIndex);
                array[i] = interpolatedValue;
            }
        }
    }
    return array;
}