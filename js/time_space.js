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
    const train_id = train['Train'];                // 車次代碼
    const car_class = train['CarClass'];            // 車種代碼
    const line = train['Line'];                     // 路線代號
    const line_dir = train['LineDir'];              // 順行1、逆行2
    const timetable = train['TimeInfos'];

    let timetable_dict = {};                        // 暫存車次時刻表物件
    let _trains_data = [];                          // 時刻表轉換後的時間空間資料

    // 建立時刻表字典
    for (let TimeInfos of train.TimeInfos) {
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
// 🌟 路線拓撲與車站推算模組 (AI 導航自駕版 - 已修復環島車次)
// ==========================================

// 查詢車次會「停靠與通過」的所有車站
function find_passing_stations(timetable, line, line_dir) {
    const start_station = timetable[0]['Station'];
    let end_station = timetable[timetable.length - 1]['Station'];

    let _passing_stations = [];
    let station = start_station;
    let km = 0.0;

    let cheng_zhui = false;
    let roundabout_train = false;
    
    // 🌟 修正 1：精準判定環島列車 (當起點等於終點，且時刻表站數大於 2 站時)
    if (end_station === '1001' || (start_station === end_station && timetable.length > 2)) {
        end_station = start_station;
        roundabout_train = true;
    }

    let stations = timetable.map(item => item['Station']);

    if (line === "3" || (stations.includes('2260') && stations.includes('3350'))) cheng_zhui = true;
    let neiwan = stations.includes('1191') || stations.includes('1192') || stations.includes('1193') || stations.includes('1194')|| stations.includes('1201')|| stations.includes('1202')|| stations.includes('1203')|| stations.includes('1204')|| stations.includes('1205')|| stations.includes('1206')|| stations.includes('1207')|| stations.includes('1208');
    let pingxi = stations.includes('7362') || stations.includes('7361') || stations.includes('7331') || stations.includes('7332') || stations.includes('7333') || stations.includes('7334') || stations.includes('7335') || stations.includes('7336');
    let jiji = stations.includes('3431') || stations.includes('3432') || stations.includes('3433') || stations.includes('3434') || stations.includes('3435') || stations.includes('3436');
    let shalun = stations.includes('4271') || stations.includes('4272');

    // 核心：智慧計算下一站的子函式 (自動 fallback 支線資料)
    const getNextStep = (curr, dir) => {
        let n_st = '', d_km = 0;
        // 智慧備援：如果 CW/CCW 是空的，自動抓 BRANCH 的資料填補黑洞
        let ccw_fallback = Route[curr].CCW || Route[curr].CCW_BRANCH || '';
        let cw_fallback = Route[curr].CW || Route[curr].CW_BRANCH || '';
        
        if (dir === '2') {
            if (!cheng_zhui) {
                let branch = Route[curr].CCW_BRANCH || '';
                if (branch !== '') {
                    if (curr === '7360') { n_st = (end_station === '7362') ? '7361' : ccw_fallback; d_km = (end_station === '7362') ? parseFloat(Route[curr].CCW_BRANCH_KM||0) : parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                    else if (curr === '3430') { n_st = jiji ? '3431' : ccw_fallback; d_km = jiji ? parseFloat(Route[curr].CCW_BRANCH_KM||0) : parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                    else if (curr === '4270') { n_st = shalun ? '4271' : ccw_fallback; d_km = shalun ? parseFloat(Route[curr].CCW_BRANCH_KM||0) : parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                    else if (['1', '0', 'LINE_Alishan', 'thsr'].includes(line)) { n_st = ccw_fallback; d_km = parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                    else if (line === '2') { n_st = Route[curr].CCW_BRANCH || Route[curr].CCW; d_km = parseFloat(Route[curr].CCW_BRANCH_KM || Route[curr].CCW_KM||0); }
                    else { n_st = ccw_fallback; d_km = parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
                } else { n_st = ccw_fallback; d_km = parseFloat(Route[curr].CCW_KM||Route[curr].CCW_BRANCH_KM||0); }
            } else { n_st = Route[curr].CHENG_ZHUI_CCW; d_km = parseFloat(Route[curr].CHENG_ZHUI_CCW_KM||0); }
        } else if (dir === '1') {
            if (!cheng_zhui) {
                let branch = Route[curr].CW_BRANCH || '';
                if (branch !== '') {
                    if (curr === '0920') { n_st = (end_station !== '0900') ? Route[curr].CW_BRANCH : cw_fallback; d_km = (end_station !== '0900') ? parseFloat(Route[curr].CW_BRANCH_KM||0) : parseFloat(Route[curr].CW_KM||Route[curr].CW_BRANCH_KM||0); }
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
            } else { n_st = Route[curr].CHENG_ZHUI_CW; d_km = parseFloat(Route[curr].CHENG_ZHUI_CW_KM||0); }
        }
        return { st: n_st, km: d_km };
    };

    // --- 開始模擬火車行走 ---
    while (true) {
        const dsc = Route[station]?.DSC || `未知站(${station})`;
        const routeKm = Route[station]?.KM || 0; 
        
        _passing_stations.push([String(station), dsc, routeKm, km]);

        // 🌟 修正 2：加入 `_passing_stations.length > 1` 判定
        // 確保火車至少走出了起點站，之後若再次遇到終點站才算真正繞完一圈抵達！
        if (station === end_station && _passing_stations.length > 1) {
            if (roundabout_train && timetable[timetable.length - 1]['Station'] === '1001') {
                _passing_stations[_passing_stations.length - 1][0] = '1001';
            }
            break;
        }

        if (!Route[station]) {
            console.warn(`⚠️ 字典徹底斷裂，無法離開 [${station}]`); break;
        }

        // 先依據現有方向探路
        let step = getNextStep(station, line_dir);
        let prev_st = _passing_stations.length >= 2 ? _passing_stations[_passing_stations.length - 2][0] : null;

        // 🛡️ AI 導航修正：如果撞牆(空字串)或發現要原地折返(遇到上一站)，強制切換方向！
        if (!step.st || step.st === prev_st) {
            let alt_dir = (line_dir === '1') ? '2' : '1';
            let alt_step = getNextStep(station, alt_dir);
            
            // 如果換方向有路走，就永久翻轉方向開下去！
            if (alt_step.st && alt_step.st !== prev_st) {
                step = alt_step;
                line_dir = alt_dir; 
            } else {
                console.warn(`⚠️ 雙向死路！站點: ${station}`); break;
            }
        }

        km += step.km;
        station = step.st;

        if (_passing_stations.length > 500) {
            console.warn(`⚠️ 迴圈超過 500 次，強制中斷`); break;
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
            // 🛡️ 防護網：使用 Optional Chaining (?.) 避免座標缺少時報錯
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

    // 環島、跨午夜車次處理
    let after_midnight_row_index = -1;
    let last_time_value = -1;

    Object.entries(_estimate_time_space).forEach(([key, value]) => {
        // 環島車次處理
        if (value[0] === "1001") {
            value[0] = "1000";
        }
        // 跨午夜車次處理
        if (!isNaN(value[3])) {
            if (value[3] < last_time_value) {
                after_midnight_row_index = parseInt(key);
            }
            last_time_value = value[3];
        }
    });

    // 跨午夜車次處理：將超過午夜的時間一律加上 2880
    if (after_midnight_row_index !== -1) {
        Object.entries(_estimate_time_space).forEach(([key, value]) => {
            if (parseInt(key) >= after_midnight_row_index) {
                value[3] += 2880;
            }
        });
    }

    // 線性插補運算 (補齊通過站的時間)
    let interpolate = [];
    Object.entries(_estimate_time_space).forEach(([key, value]) => {
        interpolate.push(value[3]);
    });

    const interpolatedArray = linearInterpolation(interpolate);
    Object.entries(_estimate_time_space).forEach(([key, value]) => {
        value[3] = interpolatedArray[key];
    });

    return _estimate_time_space;
}

// 將車次通過車站時間轉入各營運路線的資料
function time_space_to_operation_lines(estimate_time_space, line_kind) {
    let _operation_lines = {};

    for (let key in LinesStations) {
        _operation_lines[key] = [];
    }

    Object.entries(estimate_time_space).forEach(([key, value]) => {
        Object.entries(LinesStations).forEach(([key1, value1]) => {
            if (key1 === line_kind) { // 只處理目前選擇的路線
                if (value[0] in value1) {
                    _operation_lines[key1].push([value[1], value[0], value[3], LinesStations[key1][value[0]]['SVGYAXIS'], value[4], parseInt(key)]);
                }
            }
        });
    });

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
