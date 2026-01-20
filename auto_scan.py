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
START_DATE = 20260101 # 設定你要開始偵測的日期

# 🛑 排除規則
EXCLUDE_PREFIXES = ["29", "47", "48", "49"] 
EXCLUDE_KEYWORDS = ["(林)", "(高)"]          

# 🎯 只鎖定 billy1125
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
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. 讀取本地 final 檔 (比對基準)
    master_ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                master_list = extract_train_list(json.load(f))
                master_ids = set(str(t.get(TRAIN_ID_KEY)) for t in master_list if isinstance(t, dict))
        except: pass

    # 2. 開始掃描並按日期分類
    # 結構: { 20260201: [車次A, 車次B], 20260202: [車次C] }
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
            
            # 只看指定日期之後的
            if fdate < START_DATE: continue
            
            raw_data = fetch_json(file['download_url'])
            if not raw_data: continue
            
            daily_data = extract_train_list(raw_data)
            
            for train in daily_data:
                if not isinstance(train, dict): continue
                tid = str(train.get(TRAIN_ID_KEY, ""))
                
                # 過濾邏輯: 沒代碼、已存在、或是排除名單 -> 跳過
                if (not tid or 
                    tid in master_ids or 
                    any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                    any(k in tid for k in EXCLUDE_KEYWORDS)): 
                    continue
                
                # 存入該日期的清單
                new_trains_by_date[fdate].append(train)
                total_new_count += 1
            
            time.sleep(0.05) # 稍微休息避免被擋

    # 3. 輸出日記 (格式化)
    log_content = []
    
    # 標頭: 日期與總數
    log_content.append(f"本日讀取日期: {now_str}")
    
    if total_new_count > 0:
        log_content.append(f"發現 {total_new_count} 筆新車次！\n")
        
        # 依照日期排序 (從小到大)
        sorted_dates = sorted(new_trains_by_date.keys())
        
        for date_key in sorted_dates:
            trains = new_trains_by_date[date_key]
            # 該日期有車才顯示
            if not trains: continue
            
            log_content.append(f"📅 日期: {date_key}")
            
            # 車次排序
            trains.sort(key=lambda x: str(x.get(TRAIN_ID_KEY, "0")))
            
            for t in trains:
                tid = t.get(TRAIN_ID_KEY, "?")
                typ = t.get("CarClass", t.get("Type", "")) # 抓車種
                
                # 抓起訖站 (優化顯示 ? -> ?)
                start_st = "?"
                end_st = "?"
                if "Timetables" in t and t["Timetables"]:
                    try:
                        start_st = t["Timetables"][0].get("Station", "?")
                        end_st = t["Timetables"][-1].get("Station", "?")
                    except: pass
                elif "StopTimes" in t and t["StopTimes"]: # 兼容另一種格式
                     try:
                        start_st = t["StopTimes"][0].get("StationName", "?")
                        end_st = t["StopTimes"][-1].get("StationName", "?")
                     except: pass

                route_str = f" ({start_st} ➝ {end_st})"
                
                # 組合字串:   ➜ [1404] 2 (樹林 ➝ 花蓮)
                line = f"   ➜ [{tid}] {typ}{route_str}"
                log_content.append(line)
            
            log_content.append("") # 日期之間空一行
            
    else:
        # 如果沒新車，只留一句話，保持版面乾淨
        log_content.append("目前沒有發現新的額外車次。")

    # 寫入檔案
    with open("scan_log.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(log_content))
        
    print(f"✅ 掃描完成，已寫入 scan_log.txt (發現 {total_new_count} 筆)")

if __name__ == "__main__":
    main()
