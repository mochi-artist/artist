# -*- coding: utf-8 -*-
import requests
import json
import os
import time
import datetime
import re
from collections import defaultdict

# ================= 設定區 =================
# 💥 洗腦重建開關：請設為 False！這樣機器人才會記住歷史，並算出「新增」了幾筆車次！
FORCE_REBUILD = False

HISTORY_FILE = "scan_history.json"
LOG_FILE = "scan_log.txt"
START_DATE = 20260101               # 最早掃描日期

# 🧠 大腦路徑設定
ROOT_MASTER_FILE = "final_train_diagram.json"  # 根目錄 (現役大腦)
FUTURE_BRAIN_DIR = "data all"                  # 未來大腦資料夾

STATION_DB_FILE = "SVG_Y_Axis.json" 
CAR_KIND_DB_FILE = "CarKind.json"
BILLY_REF_URL = "https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/js/references/"

# 🌟 你最完美的黃金排除名單 (保留了你新增的 4008)
EXCLUDE_PREFIXES = ["29", "47", "48", "4008", "49"] 
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

    s_db = load_db(STATION_DB_FILE)
    station_map = {}
    for k, v in s_db.items():
        if isinstance(v, list):
            for st in v:
                if "ID" in st and "DSC" in st: station_map[str(st["ID"])] = st["DSC"]
    c_db = load_db(CAR_KIND_DB_FILE)
    c_map = {str(k): v for k, v in c_db.items()}

    # ========================================================
    # 🧠 1. 動態大腦與時空菜單載入機制 (嚴格結界版)
    # ========================================================
    print(f"🧠 正在載入動態時空大腦與菜單...")
    
    root_master_ids = set()
    if os.path.exists(ROOT_MASTER_FILE):
        try:
            with open(ROOT_MASTER_FILE, 'r', encoding='utf-8') as f:
                data = extract_train_list(json.load(f))
                for t in data:
                    if isinstance(t, dict): root_master_ids.add(str(t.get("Train", "")))
            print(f"  ✅ [基底大腦] {ROOT_MASTER_FILE} - 共 {len(root_master_ids)} 筆")
        except: print(f"  ❌ 讀取 {ROOT_MASTER_FILE} 失敗")

    future_masters = {}
    revised_epochs = [] 

    if os.path.exists(FUTURE_BRAIN_DIR):
        for fname in os.listdir(FUTURE_BRAIN_DIR):
            if fname.startswith("final_train_diagram_") and fname.endswith(".json"):
                match = re.search(r"(\d{7})", fname)
                if match:
                    roc_date_str = match.group(1)
                    g_year = int(roc_date_str[:3]) + 1911
                    g_date = int(f"{g_year}{roc_date_str[3:]}")
                    
                    filepath = os.path.join(FUTURE_BRAIN_DIR, fname)
                    try:
                        ids_set = set()
                        with open(filepath, 'r', encoding='utf-8') as f:
                            data = extract_train_list(json.load(f))
                            for t in data:
                                if isinstance(t, dict): ids_set.add(str(t.get("Train", "")))
                        future_masters[g_date] = ids_set
                        revised_epochs.append({"date": g_date, "fileId": roc_date_str}) 
                        print(f"  ✅ [未來大腦] {fname} (生效日: {g_date}) - 共 {len(ids_set)} 筆")
                    except: pass
            
    if revised_epochs:
        revised_epochs.sort(key=lambda x: x["date"]) 
        if not os.path.exists("data all"): os.makedirs("data all")
        try:
            with open("data all/Revised_Epochs.json", "w", encoding="utf-8") as f:
                json.dump(revised_epochs, f, ensure_ascii=False, indent=2)
            print(f"  ✅ 成功產生時空菜單: data all/Revised_Epochs.json (共 {len(revised_epochs)} 個結界)")
        except: pass

    # ========================================================
    # 🚀 2. 雙引擎掃描 (僅供比對，絕對不寫入硬碟覆蓋資料！)
    # ========================================================
    files_to_process = {}
    if not os.path.exists("data"): os.makedirs("data")

    # 引擎 A：抓本地當底
    for fname in os.listdir("data"):
        if fname.endswith(".json"):
            fdate = get_filename_date(fname)
            if fdate >= START_DATE:
                try:
                    with open(os.path.join("data", fname), 'r', encoding='utf-8') as f:
                        files_to_process[fdate] = json.load(f)
                except: pass

    # 引擎 B：從 GitHub 讀取最新資料「放進記憶體比對」
    print(f"\n📡 正在從 GitHub 同步最新資料 (🔒 安全模式：絕不覆蓋本地 data 檔案)...")
    for user, repo, path in TARGETS:
        try:
            res = requests.get(f"https://api.github.com/repos/{user}/{repo}/contents/{path}")
            github_files = res.json() if res.status_code == 200 else []
            for file in github_files:
                fname = file['name']
                if not fname.endswith(".json"): continue
                fdate = get_filename_date(fname)
                
                if fdate >= START_DATE:
                    # 🌟 唯讀模式：抓下來存進記憶體比對，不再執行寫入動作！
                    raw = fetch_json(file['download_url'])
                    if raw:
                        files_to_process[fdate] = raw
            time.sleep(0.05)
        except: continue
    print(f"  ➜ 雲端同步完成！共準備分析 {len(files_to_process)} 天的資料。")

    # ========================================================
    # 🔍 3. 智慧時空對位與過濾
    # ========================================================
    history_data = {"runs": [], "seen": [], "records": {}}
    if FORCE_REBUILD:
        print("\n⚠️ [洗腦模式開啟] 已忽略舊有記憶，將進行全資料夾重新分析！")
    elif os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "runs" in data: history_data = data
        except: pass

    seen_set = set(history_data["seen"])
    new_findings_by_date = defaultdict(list)
    new_count = 0

    print("\n🔍 正在使用動態大腦尋找特殊車次...")
    for fdate, raw in sorted(files_to_process.items()):
        
        applicable_dates = [d for d in future_masters.keys() if d <= fdate]
        if applicable_dates:
            best_date = max(applicable_dates)
            current_master_ids = future_masters[best_date]
        else:
            current_master_ids = root_master_ids

        daily_data = extract_train_list(raw)
        for train in daily_data:
            if not isinstance(train, dict): continue
            tid = str(train.get("Train", ""))
            
            if (not tid or tid in current_master_ids or 
                any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                any(k in tid for k in EXCLUDE_KEYWORDS)): 
                continue
            
            uid = f"{fdate}_{tid}"
            if uid not in seen_set:
                new_findings_by_date[fdate].append(train)
                seen_set.add(uid)
                new_count += 1

    # ========================================================
    # 📝 4. 寫入 scan_log.txt 與歷史記憶 (✨ 全新排版格式)
    # ========================================================
    if new_count > 0 or FORCE_REBUILD:
        if new_count > 0:
            # 紀錄每次執行的：時間、累計總發現數、本次新增數量
            history_data["runs"].append({
                "time": now_str, 
                "total_seen": len(seen_set), 
                "new_added": new_count
            })
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
                history_data["records"][date_str][now_str].append(f"  ➜ [{tid}] {chi} {code} ({st} ➝ {end})")

        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history_data, f, ensure_ascii=False, indent=2)

        # 🌟 產生全新格式的 txt 報表
        log_lines = ["========================================", "🕒 掃描歷史摘要 (動態大腦模式):"]
        run_map = {}
        for idx, r in enumerate(history_data["runs"], 1):
            total_seen = r.get('total_seen', 0)
            new_added = r.get('new_added', 0)
            if idx == 1 or new_added == total_seen:
                log_lines.append(f"  [{idx}] {r['time']} (共發現 {total_seen} 筆特殊車次)")
            else:
                log_lines.append(f"  [{idx}] {r['time']} (共發現 {total_seen} 筆特殊車次) (新增 {new_added} 筆)")
            run_map[r['time']] = idx
        log_lines.append("========================================\n")
        
        for date_str in sorted(history_data["records"].keys(), key=lambda x: int(x)):
            # 計算該日期的總車次，與本次掃描新增的車次
            total_for_date = sum(len(history_data["records"][date_str][rt]) for rt in history_data["records"][date_str])
            new_for_date = len(new_findings_by_date.get(int(date_str), []))
            
            log_lines.append(f"📅 日期: {date_str}")
            if new_for_date > 0 and not FORCE_REBUILD:
                log_lines.append(f"   📊 總計: {total_for_date} 筆特殊車次 (本次掃描新增 {new_for_date} 筆)")
            else:
                log_lines.append(f"   📊 總計: {total_for_date} 筆特殊車次")
                
            for run_time in sorted(history_data["records"][date_str].keys()):
                run_idx = run_map.get(run_time, "?")
                log_lines.append(f"  --- [第 {run_idx} 次紀錄] {run_time} ---")
                log_lines.extend(history_data["records"][date_str][run_time])
            log_lines.append("") 
            
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
            
        print(f"\n✅ 成功！已將 {new_count} 筆新資料寫入 {LOG_FILE} (重新排版完成)")
    else:
        print("\n💤 本次無新發現。")

if __name__ == "__main__":
    main()
