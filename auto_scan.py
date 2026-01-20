# -*- coding: utf-8 -*-
import requests
import json
import os
import time
import datetime
from collections import defaultdict

# ================= 設定區 =================
MASTER_FILE_PATH = "final_train_diagram.json" 
TRAIN_ID_KEY = "Train"
START_DATE = 20260101

# 📂 1. 車站資料庫 (讀取 SVG_Y_Axis.json)
STATION_DB_PATH = "js/references/SVG_Y_Axis.json" 

# 📂 2. 車種代碼資料庫 (讀取 CarKind.json)
CAR_KIND_DB_PATH = "js/references/CarKind.json"

# 🛑 排除規則
EXCLUDE_PREFIXES = ["29", "47", "48", "49"] 
EXCLUDE_KEYWORDS = ["(林)", "(高)"]          
TARGETS = [("billy1125", "billy1125.github.io", "data")]

# 🎨 3. 顏色對照表 (根據你的 style.css 轉換)
CSS_COLOR_MAP = {
    # .taroko, .kuaimu
    "taroko": "太魯閣 (#20b2aa)",
    "kuaimu": "檜木 (#20b2aa)",
    
    # .puyuma, .zhongxing, .direct
    "puyuma": "普悠瑪 (red)",
    "zhongxing": "中興號 (red)",
    "direct": "直達車 (red)",
    
    # .tze_chiang, .alishan_local
    "tze_chiang": "自強 (#ffa500)", # Orange
    "alishan_local": "阿里山號 (#ffa500)", # Orange
    
    # .tze_chiang_diesel
    "tze_chiang_diesel": "柴自強 (gold)",
    
    # .emu1200
    "emu1200": "紅斑馬 (#ff008c)",
    
    # .emu300
    "emu300": "EMU300 (#f44)",
    
    # .emu3000
    "emu3000": "騰雲座 (#000)",
    
    # .chu_kuang, .chushan1, .chushan2, .skip_stop
    "chu_kuang": "莒光 (#faab82)",
    "chushan1": "祝山 (#faab82)",
    "chushan2": "祝山 (#faab82)",
    "skip_stop": "跳站 (#faab82)",
    
    # .local, .alishan, .all_stop
    "local": "區間 (#00f)",
    "alishan": "阿里山 (#00f)",
    "all_stop": "站站停 (#00f)",
    
    # .local_express
    "local_express": "區快 (#00a6ff)",
    
    # .fu_hsing
    "fu_hsing": "復興 (#00bfff)",
    
    # .ordinary, .theme
    "ordinary": "普快 (#006055)",
    "theme": "主題 (#006055)",
    
    # .special
    "special": "專車 (#ff1493)",
    
    # .others
    "others": "其他 (grey)"
}
# =========================================

def get_filename_date(filename):
    try: return int(filename.replace(".json", ""))
    except: return 0

def fetch_json(url):
    try:
        res = requests.get(url)
        return res.json() if res.status_code == 200 else None
    except: return None

def extract_train_list(data):
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for key in ["TrainInfos", "TrainTimetables", "Trains", "data", "records", "result"]:
            if key in data and isinstance(data[key], list): return data[key]
        if TRAIN_ID_KEY in data: return [data]
    return []

# 📖 讀取車站 DB (SVG版)
def load_station_db(path):
    station_map = {}
    if not os.path.exists(path): return station_map
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 針對 SVG_Y_Axis.json 格式: { "LINE_I": [{"ID":..., "DSC":...}], ... }
            for line_key, stations in data.items():
                if not isinstance(stations, list): continue
                for st in stations:
                    code = str(st.get("ID", ""))
                    name = st.get("DSC", "")
                    if (not code or code.lower() == "n/a" or code.startswith("8") or code.startswith("9")): continue
                    if name: station_map[code] = name
    except: pass
    return station_map

# 📖 讀取車種代碼 DB (CarKind.json)
def load_carkind_db(path):
    carkind_map = {}
    if not os.path.exists(path): return carkind_map
    try:
        with open(path, 'r', encoding='utf-8') as f:
            carkind_map = json.load(f)
            carkind_map = {str(k): v for k, v in carkind_map.items()}
    except: pass
    return carkind_map

def main():
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. 載入兩本字典
    station_map = load_station_db(STATION_DB_PATH)
    carkind_map = load_carkind_db(CAR_KIND_DB_PATH)

    master_ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                master_list = extract_train_list(json.load(f))
                master_ids = set(str(t.get(TRAIN_ID_KEY)) for t in master_list if isinstance(t, dict))
        except: pass

    new_trains_by_date = defaultdict(list)
    total_new_count = 0
    
    print(f"📡 正在掃描 billy1125 資料...")

    for user, repo, path in TARGETS:
        try:
            res = requests.get(f"https://api.github.com/repos/{user}/{repo}/contents/{path}")
            files = res.json() if res.status_code == 200 else []
        except: continue

        for file in files:
            fname = file['name']
            if not fname.endswith(".json"): continue
            fdate = get_filename_date(fname)
            if fdate < START_DATE: continue
            
            raw_data = fetch_json(file['download_url'])
            if not raw_data: continue
            
            daily_data = extract_train_list(raw_data)
            
            for train in daily_data:
                if not isinstance(train, dict): continue
                tid = str(train.get(TRAIN_ID_KEY, ""))
                
                if (not tid or 
                    tid in master_ids or 
                    any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                    any(k in tid for k in EXCLUDE_KEYWORDS)): 
                    continue
                
                new_trains_by_date[fdate].append(train)
                total_new_count += 1
            
            time.sleep(0.05)

    log_content = []
    log_content.append(f"本日讀取日期: {now_str}")
    
    if total_new_count > 0:
        log_content.append(f"發現 {total_new_count} 筆新車次！\n")
        sorted_dates = sorted(new_trains_by_date.keys())
        
        for date_key in sorted_dates:
            trains = new_trains_by_date[date_key]
            if not trains: continue
            
            log_content.append(f"📅 日期: {date_key}")
            trains.sort(key=lambda x: str(x.get(TRAIN_ID_KEY, "0")))
            
            for t in trains:
                tid = t.get(TRAIN_ID_KEY, "?")
                
                # ─── 顏色轉換 ───
                car_class_code = str(t.get("CarClass", t.get("Type", "?")))
                english_kind = carkind_map.get(car_class_code, "others")
                color_info = CSS_COLOR_MAP.get(english_kind, f"未知 ({english_kind})")
                
                # ─── 路線處理 (強力抓取版) ───
                start_st_code = "?"
                end_st_code = "?"
                
                # 優先抓取 TimeInfos，並嘗試多種 Key
                timetable = t.get("TimeInfos", t.get("Timetables", t.get("StopTimes", [])))
                if timetable and len(timetable) > 0:
                    # 嘗試抓取 Station 或 StationID
                    s_first = timetable[0]
                    s_last = timetable[-1]
                    start_st_code = str(s_first.get("Station", s_first.get("StationID", "?")))
                    end_st_code = str(s_last.get("Station", s_last.get("StationID", "?")))
                
                # 翻譯代碼 (如果翻譯不到，就會顯示原始代碼，至少不會是問號)
                start_name = station_map.get(start_st_code, start_st_code)
                end_name = station_map.get(end_st_code, end_st_code)

                route_str = f" ({start_name} ➝ {end_name})"
                
                # ─── 最終輸出 ───
                # 格式：[車次] 顏色 (顏色前) 代碼 (代碼後) (起點 ➝ 終點)
                # 範例：➜ [1404] 區間 (#00f) 1131 (樹林 ➝ 花蓮)
                line = f"   ➜ [{tid}] {color_info} {car_class_code}{route_str}"
                log_content.append(line)
            
            log_content.append("")
    else:
        pass 

    with open("scan_log.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(log_content))

if __name__ == "__main__":
    main()
