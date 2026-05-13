# -*- coding: utf-8 -*-
import requests
import json
import os
import time
import datetime
import re
from collections import defaultdict

# ================= 設定區 =================
# 🧠 多重大腦設定 (改點應對機制)
# 0 代表「預設基準」。改點結束後，直接用新版檔案覆蓋 final_train_diagram.json 即可。
MASTER_FILES = {
    0: "final_train_diagram.json", 
    
    # 🌟 預留位置：當拿到未來的改點檔案時，請取消下方#的註解，並修改生效日期與檔名！
    20260701: "final_train_diagram_1150701.json",
    # 20261231: "future_train_diagram.json",
}

HISTORY_FILE = "scan_history.json"  # 新版結構化記憶檔案
LOG_FILE = "scan_log.txt"           # 日誌檔案
START_DATE = 20260101               # 最早掃描日期

STATION_DB_FILE = "SVG_Y_Axis.json" 
CAR_KIND_DB_FILE = "CarKind.json"
BILLY_REF_URL = "https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/js/references/"

# 🛡️ 強化排除名單 (已加入 7, 8, 60, 61 開頭的工程/迴送/貨運車次)
EXCLUDE_PREFIXES = ["29", "47", "48", "49", "7", "8", "60", "61"] 
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
        if "Train" in data: return [data]
    return []

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

def train_sort_key(train_obj):
    tid = str(train_obj.get("Train", "0"))
    match = re.match(r"^(\d+)([a-zA-Z]*)", tid)
    if match: return (int(match.group(1)), match.group(2))
    return (float('inf'), tid)

def main():
    if os.path.dirname(os.path.abspath(__file__)):
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. 載入字典
    s_db = load_db(STATION_DB_FILE)
    station_map = {}
    for k, v in s_db.items():
        if isinstance(v, list):
            for st in v:
                if "ID" in st and "DSC" in st: station_map[str(st["ID"])] = st["DSC"]

    c_db = load_db(CAR_KIND_DB_FILE)
    c_map = {str(k): v for k, v in c_db.items()}

    # 💡 2. 智慧載入多重基底檔 (大腦) - 防呆版
    master_ids_dict = {}
    print("🧠 正在載入車次過濾大腦...")
    for apply_date, filepath in MASTER_FILES.items():
        if os.path.exists(filepath):
            try:
                ids_set = set()
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = extract_train_list(json.load(f))
                    for t in data:
                        if isinstance(t, dict): ids_set.add(str(t.get("Train")))
                
                master_ids_dict[apply_date] = ids_set
                print(f"  ✅ 載入 [{filepath}] (生效日: {apply_date}) - 共 {len(ids_set)} 筆基準車次")
            except Exception as e:
                print(f"  ⚠️ 讀取基底檔 {filepath} 失敗: {e}，將忽略此檔案。")
        else:
            print(f"  ⚠️ 找不到基底檔 [{filepath}]。若生效日還沒到請忽略，程式會自動沿用舊版大腦。")

    # 防呆：確保至少有一個預設大腦
    if 0 not in master_ids_dict:
        master_ids_dict[0] = set()

    # 3. 載入新版結構化歷史記憶
    history_data = {"runs": [], "seen": [], "records": {}}
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "runs" in data: history_data = data
        except: pass

    seen_set = set(history_data["seen"])
    new_findings_by_date = defaultdict(list)
    new_count = 0
    
    # 💡 計算 14 天後的日期，阻擋掃描遙遠未來的檔案
    today = datetime.date.today()
    max_date_int = int((today + datetime.timedelta(days=14)).strftime("%Y%m%d"))
    
    print(f"📡 正在掃描 Billy 的資料庫 (最高掃描至 {max_date_int})...")

    # 4. 掃描
    for user, repo, path in TARGETS:
        try:
            res = requests.get(f"https://api.github.com/repos/{user}/{repo}/contents/{path}")
            files = res.json() if res.status_code == 200 else []
        except: continue

        for file in files:
            fname = file['name']
            if not fname.endswith(".json"): continue
            fdate = get_filename_date(fname)
            
            # 過濾太舊或太遙遠未來的檔案
            if fdate < START_DATE or fdate > max_date_int: continue
            
            # 💡 判斷這一天要用哪個大腦來過濾
            applicable_date = max([d for d in master_ids_dict.keys() if d <= fdate], default=0)
            current_master_ids = master_ids_dict.get(applicable_date, set())
            
            raw = fetch_json(file['download_url'])
            if not raw: continue
            daily_data = extract_train_list(raw)
            
            for train in daily_data:
                if not isinstance(train, dict): continue
                tid = str(train.get("Train", ""))
                
                # 使用動態切換的大腦進行過濾
                if (not tid or tid in current_master_ids or 
                    any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                    any(k in tid for k in EXCLUDE_KEYWORDS)): 
                    continue
                
                uid = f"{fdate}_{tid}"
                if uid not in seen_set:
                    new_findings_by_date[fdate].append(train)
                    seen_set.add(uid)
                    new_count += 1
            
            time.sleep(0.05) 

    # 5. 如果有新發現，更新資料庫並全面重新產生日誌
    if new_count > 0:
        history_data["runs"].append({"time": now_str, "count": new_count})
        history_data["seen"] = list(seen_set)
        
        for date_key in sorted(new_findings_by_date.keys()):
            trains = new_findings_by_date[date_key]
            trains.sort(key=train_sort_key) 
            
            date_str = str(date_key)
            if date_str not in history_data["records"]:
                history_data["records"][date_str] = {}
                
            history_data["records"][date_str][now_str] = []
            
            for t in trains:
                tid = t.get("Train", "?")
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

        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history_data, f, ensure_ascii=False, indent=2)

        log_lines = []
        log_lines.append("========================================")
        log_lines.append("🕒 掃描歷史摘要:")
        
        run_map = {}
        for idx, r in enumerate(history_data["runs"], 1):
            log_lines.append(f"  [{idx}] {r['time']} (發現 {r['count']} 筆新車次)")
            run_map[r['time']] = idx
        log_lines.append("========================================\n")
        
        for date_str in sorted(history_data["records"].keys(), key=lambda x: int(x)):
            log_lines.append(f"📅 日期: {date_str}")
            date_blocks = history_data["records"][date_str]
            
            for run_time in sorted(date_blocks.keys()):
                run_idx = run_map.get(run_time, "?")
                log_lines.append(f"  --- [第 {run_idx} 次讀取] {run_time} ---")
                
                for line in date_blocks[run_time]:
                    log_lines.append(line)
                    
            log_lines.append("") 
            
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
            
        print(f"✅ 已將 {new_count} 筆新資料寫入 {LOG_FILE} (重新排版完成)")
    else:
        print("💤 本次無新發現。")

if __name__ == "__main__":
    main()
