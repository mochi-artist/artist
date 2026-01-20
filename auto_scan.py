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

# 🛑 排除規則
EXCLUDE_PREFIXES = ["29", "47", "48", "49"] 
EXCLUDE_KEYWORDS = ["(林)", "(高)"]          

# 🎯 只鎖定 billy1125 作為比對來源
TARGETS = [
    ("billy1125", "billy1125.github.io", "data")
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
    # 這裡不需要切換路徑，因為 GitHub Action 會在根目錄執行
    # os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. 讀取你自己目前的 final 檔案 (當作基準)
    master_ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                master_list = extract_train_list(json.load(f))
                master_ids = set(str(t.get(TRAIN_ID_KEY)) for t in master_list if isinstance(t, dict))
            print(f"📚 已讀取本地 final 檔，目前共有 {len(master_ids)} 筆車次。")
        except: 
            print("⚠️ 找不到 final 檔，將視為全部都是新車。")

    # 2. 開始掃描 Billy 的資料
    current_extras = {} 
    
    print(f"📡 [{now_str}] 正在比對 billy1125 的資料...", end="", flush=True)

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
                
                current_extras[tid] = train
            
            time.sleep(0.1)

    # 3. 輸出比對結果
    new_findings = list(current_extras.values())

    if new_findings:
        print(f" ➡️ 發現 {len(new_findings)} 筆你沒有的額外車次！")
        
        log_msg = []
        log_msg.append("="*40)
        log_msg.append(f"📅 比對時間: {now_str}")
        log_msg.append(f"🔍 來源: billy1125 vs 本地 final")
        log_msg.append(f"🎉 發現 {len(new_findings)} 筆額外車次")
        log_msg.append("-" * 20)

        for t in new_findings:
            tid = t.get(TRAIN_ID_KEY, "?")
            typ = t.get("Type", t.get("CarClass", ""))
            
            route_str = ""
            if "Timetables" in t and t["Timetables"]:
                start = t["Timetables"][0].get("Station", "")
                end = t["Timetables"][-1].get("Station", "")
                if start and end:
                    route_str = f" ({start} ➝ {end})"
            
            info_line = f"   ➜ [{tid}]"
            if typ: info_line += f" {typ}"
            if route_str: info_line += route_str
            
            log_msg.append(info_line)

        # 寫入日記
        with open("scan_log.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(log_msg) + "\n")
            
    else:
        print(" ➡️ 無新車。")
        with open("scan_log.txt", "w", encoding="utf-8") as f:
            f.write(f"[{now_str}] 你的資料是最新的，與 billy1125 同步無缺漏。")

if __name__ == "__main__":
    main()
