import requests
import json
import os
import time
import datetime
from collections import defaultdict

# ================= 設定區 =================
MASTER_FILE_PATH = "final_train_diagram.json" 
HISTORY_FILE = "scan_history.json"
TRAIN_ID_KEY = "Train"
START_DATE = 20260101

# 🛑 排除規則 (跟 patch.py 完全同步)
EXCLUDE_PREFIXES = ["29", "47", "48", "49"] # 排除車次開頭
EXCLUDE_KEYWORDS = ["(林)", "(高)"]          # 排除包含這些字的車次

TARGETS = [
    ("billy1125", "billy1125.github.io", "data"),
    ("mochi-artist", "artist", "data")
]
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

def main():
    # 強制將工作目錄設為程式所在位置
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. 讀取基準檔
    master_ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                master_list = extract_train_list(json.load(f))
                master_ids = set(str(t.get(TRAIN_ID_KEY)) for t in master_list if isinstance(t, dict))
        except: pass

    # 2. 讀取記憶
    history_ids = set()
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                history_ids = set(json.load(f))
        except: pass

    # 3. 掃描
    current_extras = {} 
    dates_to_merge = set()
    new_train_dates = defaultdict(set)
    
    # flush=True 確保文字馬上顯示
    print(f"📡 [{now_str}] 自動掃描執行中...", end="", flush=True)

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
                
                # ================= 過濾邏輯 (同步更新) =================
                if (not tid or 
                    tid in master_ids or
                    any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                    any(k in tid for k in EXCLUDE_KEYWORDS)): # 這裡會把 (林)/(高) 擋掉
                    continue
                # =====================================================
                
                current_extras[tid] = train
                
                if tid not in history_ids:
                    dates_to_merge.add(fdate)
                    new_train_dates[tid].add(fdate)
            
            time.sleep(0.1)

    # 4. 整理新發現
    new_findings = []
    current_extra_ids = set(current_extras.keys())
    
    for tid in current_extra_ids:
        if tid not in history_ids:
            new_findings.append(current_extras[tid])

    # 5. 判斷與寫入
    if new_findings:
        print(f" ➡️ 發現 {len(new_findings)} 筆新車！")
        
        log_msg = []
        log_msg.append("="*40)
        log_msg.append(f"📅 本日讀取日期: {now_str}")
        log_msg.append(f"🎉 發現 {len(new_findings)} 筆新車次！")

        trains_by_date = defaultdict(list)
        for t in new_findings:
            tid = str(t.get(TRAIN_ID_KEY, ""))
            dates = new_train_dates.get(tid, set())
            for d in dates:
                trains_by_date[d].append(t)
        
        sorted_dates = sorted(trains_by_date.keys())
        for d in sorted_dates:
            log_msg.append(f"\n📅 日期: {d}")
            daily_trains = sorted(trains_by_date[d], key=lambda x: str(x.get(TRAIN_ID_KEY, "0")))
            for t in daily_trains:
                tid = t.get(TRAIN_ID_KEY, "?")
                typ = t.get("Type", t.get("CarClass", "未知"))
                start, end = "?", "?"
                if "Timetables" in t and t["Timetables"]:
                    start = t["Timetables"][0].get("Station", "?")
                    end = t["Timetables"][-1].get("Station", "?")
                log_msg.append(f"   ➜ [{tid}] {typ} ({start} ➝ {end})")

        if dates_to_merge:
            with open("dates_to_update.json", "w") as f: 
                json.dump(sorted(list(dates_to_merge)), f)
            log_msg.append(f"\n⚠️  已更新 dates_to_update.json，請執行 patch.py。")

        with open("scan_log.txt", "a", encoding="utf-8") as f:
            f.write("\n".join(log_msg) + "\n\n")
            
    else:
        print(" ➡️ 無新發現 (保持安靜)。")

    # 6. 更新記憶
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(list(current_extra_ids), f)

if __name__ == "__main__":
    main()