# -*- coding: utf-8 -*-
import requests
import json
import os
import time
import datetime
import re
from collections import defaultdict

# ================= 設定區 =================
# 💥 洗腦重建開關：設為 True 會強制忘記舊的錯誤車次，用你的 152 個檔案重新排版！
# (注意：成功排版一次後，請記得把它改回 False，不然每次都會全部重跑)
FORCE_REBUILD = True

# 🧠 多重大腦設定 (改點應對機制)
MASTER_FILES = {
    0: "final_train_diagram.json", 
    # 🌟 預留位置：拿到未來的改點檔案時，取消#註解並修改日期與檔名！
    20260701: "final_train_diagram_1150701.json",
}

HISTORY_FILE = "scan_history.json"
LOG_FILE = "scan_log.txt"
START_DATE = 20260101               # 最早掃描日期

STATION_DB_FILE = "SVG_Y_Axis.json" 
CAR_KIND_DB_FILE = "CarKind.json"
BILLY_REF_URL = "https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/js/references/"

# 🛡️ 強化排除名單 (包含 7, 8, 60, 61 等貨運/迴送/工程車)
EXCLUDE_PREFIXES = ["29", "47", "48", "49", "7", "8", "60", "61","371A","386B","191A","196B"] 
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

    # 2. 載入大腦 (防呆版)
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
                pass
    if 0 not in master_ids_dict: master_ids_dict[0] = set()

    # 3. 載入歷史記憶 (結合 FORCE_REBUILD 洗腦機制)
    history_data = {"runs": [], "seen": [], "records": {}}
    if FORCE_REBUILD:
        print("⚠️ [洗腦模式開啟] 已忽略舊有記憶，將進行全資料夾重新分析排版！")
    elif os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "runs" in data: history_data = data
        except: pass

    seen_set = set(history_data["seen"])
    new_findings_by_date = defaultdict(list)
    new_count = 0
    today = datetime.date.today()
    max_date_int = int((today + datetime.timedelta(days=14)).strftime("%Y%m%d"))
    
    # ========================================================
    # 🚀 4. 雙引擎掃描 (本地寶庫 + 雲端備份)
    # ========================================================
    files_to_process = {}

    # 引擎 A：掃描你電腦裡的 data 資料夾 (那 152 個檔案會在這裡被抓進來！)
    print(f"📡 [引擎 A] 正在掃描本地 data 資料夾...")
    if not os.path.exists("data"): 
        os.makedirs("data")
    for fname in os.listdir("data"):
        if fname.endswith(".json"):
            fdate = get_filename_date(fname)
            if START_DATE <= fdate <= max_date_int:
                try:
                    with open(os.path.join("data", fname), 'r', encoding='utf-8') as f:
                        files_to_process[fdate] = json.load(f)
                except: pass
    print(f"  ➜ 本地共抓取到 {len(files_to_process)} 天的資料！")

    # 引擎 B：掃描 Billy 的雲端，抓取你電腦裡還沒有的最新檔案
    print(f"📡 [引擎 B] 正在掃描 Billy 的 GitHub 尋找新檔案...")
    for user, repo, path in TARGETS:
        try:
            res = requests.get(f"https://api.github.com/repos/{user}/{repo}/contents/{path}")
            github_files = res.json() if res.status_code == 200 else []
            
            for file in github_files:
                fname = file['name']
                if not fname.endswith(".json"): continue
                fdate = get_filename_date(fname)
                if fdate < START_DATE or fdate > max_date_int: continue
                
                # 💡 如果本地沒有這個日期，才去雲端下載並備份！
                if fdate not in files_to_process:
                    raw = fetch_json(file['download_url'])
                    if raw:
                        files_to_process[fdate] = raw
                        # 自動備份到你的 data 資料夾
                        with open(os.path.join("data", fname), 'w', encoding='utf-8') as f:
                            json.dump(raw, f, ensure_ascii=False)
                        print(f"  📥 發現新資料，自動備份：{fname}")
            time.sleep(0.05)
        except: continue

    # ========================================================
    # 5. 開始分析所有收集到的資料
    # ========================================================
    print("🔍 正在比對並尋找特殊車次...")
    for fdate, raw in sorted(files_to_process.items()):
        # 動態決定今天要用哪個大腦
        applicable_date = max([d for d in master_ids_dict.keys() if d <= fdate], default=0)
        current_master_ids = master_ids_dict.get(applicable_date, set())
        
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
    # 6. 寫入日誌與記憶
    # ========================================================
    if new_count > 0 or FORCE_REBUILD:
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
                history_data["records"][date_str][now_str].append(f"  ➜ [{tid}] {chi} {code} ({st} ➝ {end})")

        # 儲存 json 記憶體
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history_data, f, ensure_ascii=False, indent=2)

        # 產生漂漂亮亮的 TXT
        log_lines = ["========================================", "🕒 掃描歷史摘要:"]
        run_map = {}
        for idx, r in enumerate(history_data["runs"], 1):
            log_lines.append(f"  [{idx}] {r['time']} (發現 {r['count']} 筆新車次)")
            run_map[r['time']] = idx
        log_lines.append("========================================\n")
        
        for date_str in sorted(history_data["records"].keys(), key=lambda x: int(x)):
            log_lines.append(f"📅 日期: {date_str}")
            for run_time in sorted(history_data["records"][date_str].keys()):
                run_idx = run_map.get(run_time, "?")
                log_lines.append(f"  --- [第 {run_idx} 次讀取] {run_time} ---")
                log_lines.extend(history_data["records"][date_str][run_time])
            log_lines.append("") 
            
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
            
        print(f"✅ 已將 {new_count} 筆新資料寫入 {LOG_FILE} (重新排版完成)")
    else:
        print("💤 本次無新發現。")

if __name__ == "__main__":
    main()
