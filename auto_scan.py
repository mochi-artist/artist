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

# 📂 1. 車站資料庫
STATION_DB_PATH = "js/references/SVG_Y_Axis.json" 

# 📂 2. 車種代碼資料庫 (要把這行救回來！)
CAR_KIND_DB_PATH = "js/references/CarKind.json"

# 🛑 排除規則
EXCLUDE_PREFIXES = ["29", "47", "48", "49"] 
EXCLUDE_KEYWORDS = ["(林)", "(高)"]          
TARGETS = [("billy1125", "billy1125.github.io", "data")]

# 📝 3. 純中文對照表 (不含顏色代碼)
CHINESE_NAME_MAP = {
    "taroko": "太魯閣",
    "kuaimu": "檜木",
    "puyuma": "普悠瑪",
    "zhongxing": "中興號",
    "direct": "直達車",
    "tze_chiang": "自強",
    "alishan_local": "阿里山號",
    "tze_chiang_diesel": "柴自強",
    "emu1200": "紅斑馬",
    "emu300": "EMU300",
    "emu3000": "騰雲座",
    "chu_kuang": "莒光",
    "chushan1": "祝山",
    "chushan2": "祝山",
    "skip_stop": "跳站",
    "local": "區間",
    "alishan": "阿里山",
    "all_stop": "站站停",
    "local_express": "區快",
    "fu_hsing": "復興",
    "ordinary": "普快",
    "theme": "主題",
    "special": "專車",
    "others": "其他"
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

# 📖 讀取車站 DB
def load_station_db(path):
    station_map = {}
    if not os.path.exists(path): return station_map
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for line_key, stations in data.items():
                if not isinstance(stations, list): continue
                for st in stations:
                    code = str(st.get("ID", ""))
                    name = st.get("DSC", "")
                    if (not code or code.lower() == "n/a" or code.startswith("8") or code.startswith("9")): continue
                    if name: station_map[code] = name
    except: pass
    return station_map

# 📖 讀取車種代碼 DB
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
    
    # 載入兩本字典
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
                
                # ─── 轉換中文車種 (重點在這裡) ───
                car_class_code = str(t.get("CarClass", t.get("Type", "?")))
                
                # 1. 先查代碼對應的英文 (1131 -> local)
                english_kind = carkind_map.get(car_class_code, "others")
                
                # 2. 再查英文對應的中文 (local -> 區間)
                # 如果查不到，就預設顯示英文原名
                chinese_name = CHINESE_NAME_MAP.get(english_kind, english_kind)
                
                # ─── 路線處理 ───
                start_st_code = "?"
                end_st_code = "?"
                timetable = t.get("TimeInfos", t.get("Timetables", t.get("StopTimes", [])))
                if timetable and len(timetable) > 0:
                    start_st_code = str(timetable[0].get("Station", "?"))
                    end_st_code = str(timetable[-1].get("Station", "?"))

                start_name = station_map.get(start_st_code, start_st_code)
                end_name = station_map.get(end_st_code, end_st_code)

                route_str = f" ({start_name} ➝ {end_name})"
                
                # ─── 最終輸出 (有中文，無顏色碼) ───
                # 格式：➜ [1404] 區間 1131 (臺北 ➝ 基隆)
                line = f"   ➜ [{tid}] {chinese_name} {car_class_code}{route_str}"
                log_content.append(line)
            
            log_content.append("")
    else:
        pass 

    with open("scan_log.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(log_content))

if __name__ == "__main__":
    main()
