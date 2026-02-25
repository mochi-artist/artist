# -*- coding: utf-8 -*-
import requests
import json
import os
import time
import datetime
import re
from collections import defaultdict

# ================= 設定區 =================
MASTER_FILE_PATH = "final_train_diagram.json" 
HISTORY_FILE = "scan_history.json"  # 🧠 新版結構化記憶檔案
LOG_FILE = "scan_log.txt"           # 日誌檔案

TRAIN_ID_KEY = "Train"
START_DATE = 20260101

STATION_DB_FILE = "SVG_Y_Axis.json" 
CAR_KIND_DB_FILE = "CarKind.json"
BILLY_REF_URL = "https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/js/references/"

EXCLUDE_PREFIXES = ["29", "47", "48", "49"] 
EXCLUDE_KEYWORDS = ["(林)", "(高)"]          
TARGETS = [("billy1125", "billy1125.github.io", "data")]

CHINESE_NAME_MAP = {
    "taroko": "太魯閣", "kuaimu": "檜木", "puyuma": "普悠瑪",
    "zhongxing": "中興號", "direct": "直達車", "tze_chiang": "自強",
    "alishan_local": "阿里山號", "tze_chiang_diesel": "柴自強",
    "emu1200": "紅斑馬", "emu300": "EMU300", "emu3000": "騰雲座",
    "chu_kuang": "莒光", "chushan1": "祝山", "chushan2": "祝山",
    "skip_stop": "跳站", "local": "區間", "alishan": "阿里山",
    "all_stop": "站站停", "local_express": "區快", "fu_hsing": "復興",
    "ordinary": "普快", "theme": "主題", "special": "專車", "others": "其他"
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

# 🧠 讀取字典 (本地沒有去雲端抓)
def load_db(filename):
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    
    print(f"☁️ 正在從雲端下載字典: {filename} ...")
    url = BILLY_REF_URL + filename
    data = fetch_json(url)
    if data: return data
    return {}

# 🔢 智慧排序：(1104, A)
def train_sort_key(train_obj):
    tid = str(train_obj.get(TRAIN_ID_KEY, "0"))
    match = re.match(r"^(\d+)([a-zA-Z]*)", tid)
    if match: return (int(match.group(1)), match.group(2))
    return (float('inf'), tid)

def main():
    if os.path.dirname(os.path.abspath(__file__)):
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. 載入字典與總檔
    s_db = load_db(STATION_DB_FILE)
    station_map = {}
    for k, v in s_db.items():
        if isinstance(v, list):
            for st in v:
                if "ID" in st and "DSC" in st: station_map[str(st["ID"])] = st["DSC"]

    c_db = load_db(CAR_KIND_DB_FILE)
    c_map = {str(k): v for k, v in c_db.items()}

    master_ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                data = extract_train_list(json.load(f))
                for t in data:
                    if isinstance(t, dict): master_ids.add(str(t.get(TRAIN_ID_KEY)))
        except: pass

    # 2. 載入新版結構化歷史記憶
    history_data = {
        "runs": [],      # 記錄每次執行的時間與數量
        "seen": [],      # 記錄已經看過的 "日期_車次"
        "records": {}    # 記錄排版內容
    }
    
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "runs" in data:  # 確認是新版格式
                    history_data = data
        except: pass

    seen_set = set(history_data["seen"])
    new_findings_by_date = defaultdict(list)
    new_count = 0
    
    print(f"📡 正在掃描 Billy 的資料庫...")

    # 3. 掃描
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
            
            raw = fetch_json(file['download_url'])
            if not raw: continue
            daily_data = extract_train_list(raw)
            
            for train in daily_data:
                if not isinstance(train, dict): continue
                tid = str(train.get(TRAIN_ID_KEY, ""))
                
                if (not tid or tid in master_ids or 
                    any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                    any(k in tid for k in EXCLUDE_KEYWORDS)): 
                    continue
                
                # 🛑 綁定 日期+車次 檢查
                uid = f"{fdate}_{tid}"
                if uid not in seen_set:
                    new_findings_by_date[fdate].append(train)
                    seen_set.add(uid)
                    new_count += 1
            
            time.sleep(0.05) 

    # 4. 如果有新發現，更新資料庫並全面重新產生日誌
    if new_count > 0:
        # 新增本次掃描紀錄
        history_data["runs"].append({"time": now_str, "count": new_count})
        history_data["seen"] = list(seen_set)
        
        # 將新車次整理並存入 records
        for date_key in sorted(new_findings_by_date.keys()):
            trains = new_findings_by_date[date_key]
            trains.sort(key=train_sort_key) # 排序
            
            date_str = str(date_key)
            if date_str not in history_data["records"]:
                history_data["records"][date_str] = {}
                
            history_data["records"][date_str][now_str] = []
            
            for t in trains:
                tid = t.get(TRAIN_ID_KEY, "?")
                code = str(t.get("CarClass", t.get("Type", "?")))
                eng = c_map.get(code, "others")
                chi = CHINESE_NAME_MAP.get(eng, eng)
                
                st, end = "?", "?"
                tts = t.get("TimeInfos", t.get("Timetables", []))
                if tts:
                    st = station_map.get(str(tts[0].get("Station")), str(tts[0].get("Station")))
                    end = station_map.get(str(tts[-1].get("Station")), str(tts[-1].get("Station")))

                formatted_line = f"  ➜ [{tid}] {chi} {code} ({st} ➝ {end})"
                history_data["records"][date_str][now_str].append(formatted_line)

        # 儲存 JSON 記憶
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history_data, f, ensure_ascii=False, indent=2)

        # 🌟 重新建構 TXT 日誌檔案 (完美排版) 🌟
        log_lines = []
        log_lines.append("========================================")
        log_lines.append("🕒 掃描歷史摘要:")
        
        # 建立掃描次數對照表
        run_map = {}
        for idx, r in enumerate(history_data["runs"], 1):
            log_lines.append(f"  [{idx}] {r['time']} (發現 {r['count']} 筆新車次)")
            run_map[r['time']] = idx
        log_lines.append("========================================\n")
        
        # 依日期為主體輸出
        for date_str in sorted(history_data["records"].keys(), key=lambda x: int(x)):
            log_lines.append(f"📅 日期: {date_str}")
            date_blocks = history_data["records"][date_str]
            
            # 依照讀取時間排序印出
            for run_time in sorted(date_blocks.keys()):
                run_idx = run_map.get(run_time, "?")
                log_lines.append(f"  --- [第 {run_idx} 次讀取] {run_time} ---")
                
                for line in date_blocks[run_time]:
                    log_lines.append(line)
                    
            log_lines.append("") # 每個日期結束空一行
            
        # 寫入 (覆蓋模式)
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
            
        print(f"✅ 已將 {new_count} 筆新資料寫入 {LOG_FILE} (重新排版完成)")
    else:
        print("💤 本次無新發現。")

if __name__ == "__main__":
    main()
