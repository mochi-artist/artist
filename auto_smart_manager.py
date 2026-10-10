import requests
import json
import os
import time
import re
import copy
from datetime import datetime, timedelta
from collections import defaultdict

# ================= 設定區 =================
# 🌟 修正：對應 GitHub 儲存庫上的資料夾名稱
TARGET_DIR = "data"
MASTER_FILE_PATH = "final_train_diagram.json"
PENDING_FILE = "pending_trains.json"
PENDING_LOG = "pending_log.txt"
STATION_DB_PATH = "SVG_Y_Axis.json"
CAR_KIND_DB_PATH = "CarKind.json"
TRAIN_ID_KEY = "Train"
START_DATE = 20260101
EXCLUDE_PREFIXES = ["29", "47", "48", "49","6631", "6632", "6633"]
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

# ----------------- 跨日處理區 -----------------
def find_4am_cutoff_index(time_infos):
    has_early_morning = False
    for i, info in enumerate(time_infos):
        arr = info.get("ARRTime", "")
        dep = info.get("DEPTime", "")
        if arr.startswith(("00:", "01:", "02:", "03:")) or dep.startswith(("00:", "01:", "02:", "03:")):
            has_early_morning = True
        if has_early_morning:
            if arr.startswith(("04:", "05:", "06:", "07:")) or dep.startswith(("04:", "05:", "06:", "07:")):
                return i
    return -1

def split_cross_day_trains(train_list):
    current_day_trains = []
    next_day_trains = []
    for train in train_list:
        time_infos = train.get("TimeInfos", train.get("Timetables", []))
        if not time_infos:
            current_day_trains.append(train)
            continue
            
        cutoff_idx = find_4am_cutoff_index(time_infos)
        if cutoff_idx != -1:
            train_part1 = copy.deepcopy(train)
            train_part2 = copy.deepcopy(train)
            if "TimeInfos" in train_part1:
                train_part1["TimeInfos"] = time_infos[:cutoff_idx]
                train_part2["TimeInfos"] = time_infos[cutoff_idx:]
            elif "Timetables" in train_part1:
                train_part1["Timetables"] = time_infos[:cutoff_idx]
                train_part2["Timetables"] = time_infos[cutoff_idx:]
            current_day_trains.append(train_part1)
            next_day_trains.append(train_part2)
        else:
            current_day_trains.append(train)
    return current_day_trains, next_day_trains
# ---------------------------------------------

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

def load_local_file(path):
    if not os.path.exists(path): return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return extract_train_list(json.load(f))
    except: return []

def load_master_ids():
    ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                data = extract_train_list(json.load(f))
                for t in data:
                    if isinstance(t, dict): ids.add(str(t.get(TRAIN_ID_KEY, "")))
            print(f"📖 已讀取總檔，排除 {len(ids)} 筆已知車次。")
        except: pass
    return ids

def load_dicts():
    s_map, c_map = {}, {}
    if os.path.exists(STATION_DB_PATH):
        try:
            with open(STATION_DB_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for line_key, stations in data.items():
                    if isinstance(stations, list):
                        for st in stations:
                            if "ID" in st and "DSC" in st: s_map[str(st["ID"])] = st["DSC"]
        except: pass
    if os.path.exists(CAR_KIND_DB_PATH):
        try:
            with open(CAR_KIND_DB_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                c_map = {str(k): v for k, v in data.items()}
        except: pass
    return s_map, c_map

def train_sort_key(train_obj):
    tid = str(train_obj.get(TRAIN_ID_KEY, "0"))
    match = re.match(r"^(\d+)([a-zA-Z]*)", tid)
    if match: return (int(match.group(1)), match.group(2)) 
    return (float('inf'), tid)

def generate_pending_log(pending_data, s_map, c_map):
    lines = []
    lines.append(f"最後更新時間: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"【暫存清單】等待合併中 (已隱藏總檔內車次)\n")
    for date_str in sorted(pending_data.keys()):
        trains = pending_data[date_str]
        if not trains: continue
        trains.sort(key=train_sort_key)
        lines.append(f"📅 日期: {date_str}")
        for t in trains:
            tid = str(t.get(TRAIN_ID_KEY, "?"))
            code = str(t.get("CarClass", t.get("Type", "?")))
            eng = c_map.get(code, "others")
            chi = CHINESE_NAME_MAP.get(eng, eng)
            st_name, end_name = "?", "?"
            tts = t.get("TimeInfos", t.get("Timetables", []))
            if tts:
                st_code = str(tts[0].get("Station", "?"))
                end_code = str(tts[-1].get("Station", "?"))
                st_name = s_map.get(st_code, st_code)
                end_name = s_map.get(end_code, end_code)
            lines.append(f"  ➜ [{tid}] {chi} {code} ({st_name} ➝ {end_name})")
        lines.append("")
    try:
        with open(PENDING_LOG, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines))
        print(f"📝 已更新暫存日誌: {PENDING_LOG}")
    except: pass

def main():
    if os.path.dirname(os.path.abspath(__file__)):
        os.chdir(os.path.dirname(os.path.abspath(__file__)))

    print("🚀 智慧管理員啟動！...")
    s_map, c_map = load_dicts()
    master_ids = load_master_ids() 
    all_data_pool = defaultdict(list)
    
    if os.path.exists(PENDING_FILE):
        try:
            with open(PENDING_FILE, 'r', encoding='utf-8') as f:
                saved_data = json.load(f)
                for date_str, trains in saved_data.items():
                    for t in trains:
                        tid = str(t.get(TRAIN_ID_KEY, ""))
                        if (not tid or tid in master_ids or 
                            any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                            any(k in tid for k in EXCLUDE_KEYWORDS)): continue
                        all_data_pool[date_str].append(t)
        except: pass

    for user, repo, path in TARGETS:
        print(f"📡 連線 {user} ...")
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
            trains = extract_train_list(raw)
            
            for t in trains:
                if isinstance(t, dict):
                    tid = str(t.get(TRAIN_ID_KEY, ""))
                    if (not tid or tid in master_ids or 
                        any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                        any(k in tid for k in EXCLUDE_KEYWORDS)): continue
                    all_data_pool[str(fdate)].append(t)
            time.sleep(0.05)

    print("\n✂️ 正在執行跨日車次分割檢查...")
    final_data_pool = defaultdict(list)
    pending_next_day_trains = defaultdict(list)

    for date_str in sorted(all_data_pool.keys()):
        train_list = all_data_pool[date_str]
        if pending_next_day_trains[date_str]:
            train_list.extend(pending_next_day_trains[date_str])
            
        curr_trains, next_trains = split_cross_day_trains(train_list)
        final_data_pool[date_str].extend(curr_trains)
        
        if next_trains:
            try:
                curr_date_obj = datetime.strptime(date_str, "%Y%m%d")
                next_date_str = (curr_date_obj + timedelta(days=1)).strftime("%Y%m%d")
                pending_next_day_trains[next_date_str].extend(next_trains)
            except ValueError: pass
                
    for next_date_str, next_trains in pending_next_day_trains.items():
        if next_date_str not in final_data_pool:
            final_data_pool[next_date_str].extend(next_trains)
            
    all_data_pool = final_data_pool
    ready_to_patch = {}
    keep_in_pending = {}

    print("\n🔍 正在分類...")
    os.makedirs(TARGET_DIR, exist_ok=True)
    
    for date_str, candidates in all_data_pool.items():
        unique = {str(t.get(TRAIN_ID_KEY)): t for t in candidates}.values()
        target_path = os.path.join(TARGET_DIR, f"{date_str}.json")
        local_trains = load_local_file(target_path)

        if local_trains is None:
            if unique: keep_in_pending[date_str] = list(unique)
        else:
            exist = set(str(t.get(TRAIN_ID_KEY)) for t in local_trains)
            new_stuff = [t for t in unique if str(t.get(TRAIN_ID_KEY)) not in exist]
            if new_stuff: ready_to_patch[date_str] = new_stuff

    print("\n" + "="*50)
    
    if keep_in_pending:
        count = sum(len(x) for x in keep_in_pending.values())
        print(f"🟡 [暫存倉庫] 有 {len(keep_in_pending)} 個日期 ({count} 班車) 等待中。")
        generate_pending_log(keep_in_pending, s_map, c_map) 
    else:
        print("⚪ [暫存倉庫] 目前是空的。")
        if os.path.exists(PENDING_LOG): os.remove(PENDING_LOG)

    if ready_to_patch:
        print("-" * 50)
        print(f"🟢 [配對成功] 發現 {len(ready_to_patch)} 個日期，準備自動寫入！")
        
        # 🌟 修正：拔除 input 互動，改為全自動寫入
        for date_str, new_trains in ready_to_patch.items():
            target_path = os.path.join(TARGET_DIR, f"{date_str}.json")
            try:
                with open(target_path, 'r', encoding='utf-8') as f:
                    data = extract_train_list(json.load(f))
                data.extend(new_trains)
                final_output = {"TrainInfos": data}
                with open(target_path, 'w', encoding='utf-8') as f:
                    json.dump(final_output, f, ensure_ascii=False, indent=2)
                print(f"  💾 已自動合併寫入 {date_str}.json ({len(new_trains)} 筆新車次)")
            except Exception as e: 
                print(f"  ❌ 寫入 {date_str}.json 發生錯誤: {e}")

    # 更新暫存檔
    if keep_in_pending:
        with open(PENDING_FILE, 'w', encoding='utf-8') as f:
            json.dump(keep_in_pending, f, ensure_ascii=False, indent=2)
    else:
        if os.path.exists(PENDING_FILE): os.remove(PENDING_FILE)

if __name__ == "__main__":
    main()
