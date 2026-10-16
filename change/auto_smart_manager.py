import requests
import json
import os
import time
import re
import copy
from datetime import datetime, timedelta, timezone
from collections import defaultdict

# ================= 自動定位根目錄 =================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(os.path.join(os.getcwd(), "final_train_diagram.json")) or os.path.exists(os.path.join(os.getcwd(), "data")):
    BASE_DIR = os.getcwd()
elif os.path.exists(os.path.join(os.path.dirname(SCRIPT_DIR), "final_train_diagram.json")) or os.path.exists(os.path.join(os.path.dirname(SCRIPT_DIR), "data")):
    BASE_DIR = os.path.dirname(SCRIPT_DIR)
else:
    BASE_DIR = os.getcwd()

# ================= 設定區 =================
TARGET_DIR = os.path.join(BASE_DIR, "data")
MASTER_FILE_PATH = os.path.join(BASE_DIR, "final_train_diagram.json")
PENDING_FILE = os.path.join(BASE_DIR, "pending_trains.json")
CATCH_LOG_FILE = os.path.join(BASE_DIR, "catch_log.txt")            # 🌟 僅保留【四、暫存於 pending_trains.json 等待中的車次】
MERGED_HISTORY_FILE = os.path.join(BASE_DIR, "merged_history.txt")  # 🌟 單獨記錄【二、成功合併寫入 data/ 的新車次】
TRAIN_ID_KEY = "Train"

# 🌟 自動取得台灣時間 (UTC+8)「今天」的 YYYYMMDD 數值，只掃描今天以後的檔案
TW_NOW = datetime.now(timezone.utc) + timedelta(hours=8)
START_DATE = int(TW_NOW.strftime("%Y%m%d"))

EXCLUDE_PREFIXES = ["29", "47", "48", "49", "6631", "6632", "6633"]
EXCLUDE_KEYWORDS = ["(林)", "(高)"]

# 🌟 抓取順序：朋友倉庫優先抓取，原作者 (固定週一更新) 排第二
TARGETS = [
    ("朋友倉庫", "mochi-artist", "TRA-Timetable-Data", "Timetable-Json"),
    ("原作者倉庫", "billy1125", "billy1125.github.io", "data")
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TRA-Smart-Manager/1.0",
    "Accept": "application/vnd.github.v3+json"
}
if os.environ.get("GITHUB_TOKEN"):
    HEADERS["Authorization"] = f"token {os.environ['GITHUB_TOKEN']}"

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

FALLBACK_C_MAP = {
    "1100": "tze_chiang", "1101": "tze_chiang", "1102": "taroko", "1107": "puyuma", "1108": "tze_chiang", "110A": "tze_chiang",
    "1110": "chu_kuang", "1111": "chu_kuang", "1112": "chu_kuang", "1114": "chu_kuang", "1115": "chu_kuang",
    "1120": "fu_hsing", "1121": "fu_hsing", "1122": "fu_hsing",
    "1130": "local", "1131": "local", "1132": "local_express",
    "1140": "ordinary", "1141": "ordinary"
}

# 🌟 自動替換的車次規則清單
RULE_CLASS_0001 = ['6652', '6655', '6629', '6630']
RULE_CLASS_0002 = ['6631', '6632', '6633', '6676', '6677']

# 🌟 110F 專車替換規則
TEMP_110F_RULES = {
    "20260925": ["2183", "3231"], "20260926": ["3010", "3035"],
    "20260927": ["3001", "3018", "3021"], "20260928": ["3006", "1038"],
    "20260929": ["2013", "2244"], "20260930": ["2123", "2184", "2223"],
    "20261001": ["2128", "3177", "3228", "2257"], "20261002": ["2144", "2203", "2264"],
    "20261003": ["6725A", "6725", "6725B"], "20261004": ["2183", "3231"],
    "20261005": ["3010", "3035"], "20261006": ["3001", "3018", "3021"],
    "20261007": ["3006", "1038"], "20261008": ["2013", "2244"],
    "20261009": ["2183", "3231"], "20261010": ["3010", "3035"],
    "20261011": ["3001", "3018", "3021"], "20261012": ["3006", "1038"],
    "20261013": ["2013", "2244"], "20261014": ["2143", "2204", "2263"],
    "20261015": ["2124", "2163", "2224"], "20261016": ["2143", "2204", "2263"],
    "20261017": ["2124", "2163", "2224"], "20261018": ["6725A", "6725", "6725B"],
    "20261019": ["2183", "3231"], "20261020": ["3010", "3035"],
    "20261021": ["3001", "3018", "3021"], "20261022": ["3006", "1038"],
    "20261023": ["2013", "2244"], "20261024": ["2183", "3231"],
    "20261025": ["3010", "3035"], "20261026": ["3001", "3018", "3021"],
    "20261027": ["3006", "1038"], "20261028": ["2013", "2244"],
    "20261029": ["2143", "2204", "2263"], "20261030": ["2124", "2163", "2224"],
    "20261031": ["6725A", "6725", "6725B"], "20261101": ["2183", "3231"],
    "20261102": ["3010", "3035"], "20261103": ["3001", "3018", "3021"],
    "20261104": ["3006", "1038"], "20261105": ["2013", "2244"],
    "20261106": ["2183", "3231"], "20261107": ["3010", "3035"],
    "20261108": ["3001", "3018", "3021"], "20261109": ["3006", "1038"],
    "20261110": ["2013", "2244"], "20261111": ["2123", "2184", "2223"],
    "20261112": ["2128", "3177", "3228", "2257"], "20261113": ["2144", "2203", "2264"],
    "20261114": ["6725A", "6725", "6725B"], "20261115": ["2183", "3231"],
    "20261116": ["3010", "3035"], "20261117": ["3001", "3018", "3021"],
    "20261118": ["3006", "1038"], "20261119": ["2013", "2244"],
    "20261120": ["2183", "3231"], "20261121": ["3010", "3035"],
    "20261122": ["3001", "3018", "3021"], "20261123": ["3006", "1038"],
    "20261124": ["2013", "2244"], "20261125": ["2143", "2204", "2263"],
    "20261126": ["2124", "2163", "2224"], "20261127": ["2143", "2204", "2263"],
    "20261128": ["2124", "2163", "2224"], "20261129": ["6725A", "6725", "6725B"],
    "20261130": ["2183", "3231"], "20261201": ["3010", "3035"],
    "20261202": ["3001", "3018", "3021"], "20261203": ["3006", "1038"],
    "20261204": ["2013", "2244"], "20261205": ["6725A", "6725", "6725B"],
    "20261206": ["2183", "3231"], "20261207": ["3010", "3035"],
    "20261208": ["3001", "3018", "3021"], "20261209": ["3006", "1038"],
    "20261210": ["2013", "2244"], "20261211": ["2123", "2184", "2223"],
    "20261212": ["2128", "3177", "3228", "2257"], "20261213": ["2144", "2203", "2264"]
}
# =========================================

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

def get_filename_date(filename):
    try:
        clean_name = filename.replace(".json", "").replace("-", "").strip()
        return int(clean_name)
    except:
        return 0

def fetch_json(url):
    try:
        res = requests.get(url, headers=HEADERS, timeout=20)
        return res.json() if res.status_code == 200 else None
    except:
        return None

def normalize_train_obj(t):
    if not isinstance(t, dict):
        return None
    if "TrainInfo" in t and isinstance(t["TrainInfo"], dict):
        ti = t["TrainInfo"]
        stop_times = t.get("StopTimes", [])
        time_infos = []
        for idx, st in enumerate(stop_times, 1):
            arr = st.get("ArrivalTime", st.get("DepartureTime", "00:00"))
            dep = st.get("DepartureTime", st.get("ArrivalTime", "00:00"))
            if len(arr) == 5: arr += ":00"
            if len(dep) == 5: dep += ":00"
            time_infos.append({
                "Station": str(st.get("StationID", "")),
                "ARRTime": arr,
                "DEPTime": dep,
                "Order": str(st.get("StopSequence", idx))
            })
        return {
            "Train": str(ti.get("TrainNo", "")),
            "CarClass": str(ti.get("TrainTypeID", ti.get("TrainTypeCode", ""))),
            "Line": str(ti.get("TripLine", "0")),
            "LineDir": str(ti.get("Direction", "1")),
            "TimeInfos": time_infos
        }
    return t

def extract_train_list(data):
    raw_list = []
    if isinstance(data, list):
        raw_list = data
    elif isinstance(data, dict):
        for key in ["TrainInfos", "TrainTimetables", "Trains", "data", "records", "result"]:
            if key in data and isinstance(data[key], list):
                raw_list = data[key]
                break
        if not raw_list and TRAIN_ID_KEY in data:
            raw_list = [data]
    normalized = []
    for item in raw_list:
        nt = normalize_train_obj(item)
        if nt:
            normalized.append(nt)
    return normalized

def load_local_file(path):
    if not os.path.exists(path): return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return extract_train_list(json.load(f))
    except:
        return []

def load_master_ids():
    ids = set()
    if os.path.exists(MASTER_FILE_PATH):
        try:
            with open(MASTER_FILE_PATH, 'r', encoding='utf-8') as f:
                data = extract_train_list(json.load(f))
                for t in data:
                    if isinstance(t, dict):
                        ids.add(str(t.get(TRAIN_ID_KEY, t.get("TrainNo", ""))))
        except:
            pass
    return ids

def load_dicts():
    s_map, c_map = {}, {}
    s_path = None
    for root, dirs, files in os.walk(BASE_DIR):
        if "SVG_Y_Axis.json" in files:
            s_path = os.path.join(root, "SVG_Y_Axis.json")
            break
    if s_path:
        try:
            with open(s_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                search_space = data.get("LinesStations", data) if isinstance(data, dict) else {}
                for line_key, stations in search_space.items():
                    if isinstance(stations, list):
                        for st in stations:
                            if isinstance(st, dict) and "ID" in st and "DSC" in st:
                                s_map[str(st["ID"]).replace("_LOOP", "")] = st["DSC"]
                    elif isinstance(stations, dict):
                        for st_key, st in stations.items():
                            if isinstance(st, dict) and "ID" in st and "DSC" in st:
                                s_map[str(st["ID"]).replace("_LOOP", "")] = st["DSC"]
        except:
            pass

    c_path = None
    for root, dirs, files in os.walk(BASE_DIR):
        if "CarKind.json" in files:
            c_path = os.path.join(root, "CarKind.json")
            break
    if c_path:
        try:
            with open(c_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                c_map = {str(k): v for k, v in data.items()}
        except:
            pass
    return s_map, c_map

def train_sort_key(train_obj):
    tid = str(train_obj.get(TRAIN_ID_KEY, "0"))
    match = re.match(r"^(\d+)([a-zA-Z]*)", tid)
    if match: return (int(match.group(1)), match.group(2)) 
    return (float('inf'), tid)

def format_train_log(t, s_map, c_map):
    tid = str(t.get(TRAIN_ID_KEY, "?"))
    code = str(t.get("CarClass", t.get("Type", "?")))
    eng = c_map.get(code, FALLBACK_C_MAP.get(code, "others"))
    chi = CHINESE_NAME_MAP.get(eng, eng)
    st_name, end_name = "?", "?"
    tts = t.get("TimeInfos", t.get("Timetables", []))
    if tts:
        st_code = str(tts[0].get("Station", tts[0].get("StationID", "?"))).replace("_LOOP", "")
        end_code = str(tts[-1].get("Station", tts[-1].get("StationID", "?"))).replace("_LOOP", "")
        st_name = s_map.get(st_code, st_code)
        end_name = s_map.get(end_code, end_code)
    src = t.get("_source", "")
    src_tag = f" [來源: {src}]" if src else ""
    return f"  ➜ [{tid}] {chi} {code} ({st_name} -> {end_name}){src_tag}"

# 🌟 【一、外部來源連線與檔案偵測狀態】：只印在終端機 (GitHub Actions .yml 執行紀錄)，不寫入 TXT
def print_source_detection_summary(source_reports):
    print("\n" + "=" * 60)
    print("📡 【外部來源連線與檔案偵測狀態 (僅顯示於 Action 終端機)】")
    for rep in source_reports:
        status_icon = "✅ 讀取成功" if rep["connected"] else f"❌ 讀取失敗 (HTTP {rep['status_code']})"
        print(
            f"  • {rep['label']} ({rep['user']}/{rep['repo']}/{rep['path']}): {status_icon}\n"
            f"    - 資料夾內 JSON 總數: {rep['total_files']} 個 (最新檔案日期: {rep['latest_date'] or '無'})\n"
            f"    - 符合條件 (>={START_DATE}) 並成功抓取: {len(rep['fetched_files'])} 個檔案\n"
            f"    - 篩選出特殊/加班車: {rep['captured_trains']} 筆 (因優先順序跳過重複: {rep['skipped_dups']} 筆)"
        )
    print("=" * 60 + "\n")

# 🌟 【二、本次成功合併寫入 data/ 的新車次】：單獨寫入 merged_history.txt
def update_merged_history_txt(ready_to_patch, s_map, c_map):
    now_str = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S')
    placeholder_marker = "⚪ 目前尚無新合併寫入的車次。"

    if ready_to_patch:
        lines = []
        lines.append(f"====== ✅ 本次成功合併寫入 data/ 的新車次 ({now_str}) ======\n")
        for d in sorted(ready_to_patch.keys()):
            items = sorted(ready_to_patch[d], key=train_sort_key)
            lines.append(f"📅 日期: {d} (共 {len(items)} 筆)")
            for t in items:
                lines.append(format_train_log(t, s_map, c_map))
            lines.append("")
        lines.append("-" * 60 + "\n")
        new_block = "\n".join(lines)

        old_content = ""
        if os.path.exists(MERGED_HISTORY_FILE):
            try:
                with open(MERGED_HISTORY_FILE, 'r', encoding='utf-8') as f:
                    old_content = f.read()
                if placeholder_marker in old_content:
                    old_content = ""
            except:
                old_content = ""

        # 將最新合併的車次放在最上方，舊紀錄保留在下方
        final_content = new_block + ("\n" + old_content if old_content else "")
        try:
            with open(MERGED_HISTORY_FILE, 'w', encoding='utf-8') as f:
                f.write(final_content)
            print(f"📝 已將【成功合併寫入 data/ 的新車次】寫入獨立檔案：{MERGED_HISTORY_FILE}")
        except Exception as e:
            print(f"❌ 寫入 {MERGED_HISTORY_FILE} 失敗: {e}")
    else:
        # 若檔案尚未存在，先建立初始檔案讓 Git 能追蹤推播；若已有歷史紀錄則保留不動
        if not os.path.exists(MERGED_HISTORY_FILE):
            init_text = (
                f"====== ✅ 成功合併寫入 data/ 的新車次紀錄 ({now_str}) ======\n\n"
                f"{placeholder_marker}\n"
            )
            try:
                with open(MERGED_HISTORY_FILE, 'w', encoding='utf-8') as f:
                    f.write(init_text)
                print(f"📝 已建立初始合併紀錄檔：{MERGED_HISTORY_FILE}")
            except Exception as e:
                print(f"❌ 建立 {MERGED_HISTORY_FILE} 失敗: {e}")

# 🌟 【四、暫存於 pending_trains.json 等待中的車次】：單獨保留在 catch_log.txt (隱藏第三項)
def generate_catch_log_txt(keep_in_pending, s_map, c_map):
    now_str = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S')
    lines = []
    lines.append(f"====== 自動抓取暫存報告 (更新時間: {now_str}) ======\n")

    if keep_in_pending:
        lines.append("🟡 【暫存於 pending_trains.json 等待中的車次 (目標日期檔尚未產出)】")
        for d in sorted(keep_in_pending.keys()):
            items = sorted(keep_in_pending[d], key=train_sort_key)
            lines.append(f"📅 日期: {d} (共 {len(items)} 筆)")
            for t in items:
                lines.append(format_train_log(t, s_map, c_map))
            lines.append("")
    else:
        lines.append("⚪ 目前無暫存等待中的車次。")

    try:
        with open(CATCH_LOG_FILE, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines) + "\n")
        print(f"📄 已更新暫存報告檔：{CATCH_LOG_FILE}")
    except Exception as e:
        print(f"❌ 寫入 {CATCH_LOG_FILE} 失敗: {e}")

# 🌟 最終大檢查與強制覆寫功能
def run_post_processing_corrections():
    print("\n🔧 正在執行最終資料校正 (CarClass 自動替換與 110F 專車規則)...")
    
    if os.path.exists(PENDING_FILE):
        try:
            with open(PENDING_FILE, 'r', encoding='utf-8') as f:
                pending_data = json.load(f)
            changed = False
            for d_str, trains in pending_data.items():
                for t in trains:
                    t_no = str(t.get("TrainNo", t.get(TRAIN_ID_KEY)))
                    curr_class = str(t.get("CarClass", ""))
                    if t_no in RULE_CLASS_0001 and curr_class != "0001":
                        t["CarClass"] = "0001"
                        changed = True
                    elif t_no in RULE_CLASS_0002 and curr_class != "0002":
                        t["CarClass"] = "0002"
                        changed = True
            if changed:
                with open(PENDING_FILE, 'w', encoding='utf-8') as f:
                    json.dump(pending_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"❌ 修正暫存檔時發生錯誤: {e}")

    if not os.path.exists(TARGET_DIR):
        return
        
    for filename in os.listdir(TARGET_DIR):
        if not filename.endswith(".json"): continue
        date_str = filename.replace(".json", "")
        filepath = os.path.join(TARGET_DIR, filename)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                daily_data = json.load(f)
                
            train_list = []
            if isinstance(daily_data, dict) and "TrainInfos" in daily_data:
                train_list = daily_data["TrainInfos"]
            elif isinstance(daily_data, list):
                train_list = daily_data
                
            changed = False
            target_110f_trains = TEMP_110F_RULES.get(date_str, [])
            
            for t in train_list:
                t_no = str(t.get("TrainNo", t.get(TRAIN_ID_KEY)))
                curr_class = str(t.get("CarClass", ""))
                
                if t_no in target_110f_trains:
                    if curr_class != "110F":
                        t["CarClass"] = "110F"
                        changed = True
                else:
                    if t_no in RULE_CLASS_0001 and curr_class != "0001":
                        t["CarClass"] = "0001"
                        changed = True
                    elif t_no in RULE_CLASS_0002 and curr_class != "0002":
                        t["CarClass"] = "0002"
                        changed = True
                        
            if changed:
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(daily_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"❌ 校正 {filename} 時發生錯誤: {e}")


def main():
    print(f"🚀 智慧管理員啟動！(專案根目錄: {BASE_DIR} | 掃描起始日: {START_DATE})")

    s_map, c_map = load_dicts()
    master_ids = load_master_ids()
    print(f"📚 基準總表 ({os.path.basename(MASTER_FILE_PATH)}) 已載入，共 {len(master_ids)} 筆正規車次")

    all_data_pool = defaultdict(list)
    seen_trains_by_date = defaultdict(set)
    source_reports = []

    # 1. 優先依序偵測並抓取外部倉庫：先抓朋友 (mochi-artist)，再抓原作者 (billy1125)
    for label, user, repo, path in TARGETS:
        api_url = f"https://api.github.com/repos/{user}/{repo}/contents/{path}"
        print(f"\n🔍 [偵測來源] {label} ({user}/{repo}/{path}) ...")
        rep_info = {
            "label": label, "user": user, "repo": repo, "path": path,
            "connected": False, "status_code": 0, "total_files": 0,
            "latest_date": None, "fetched_files": [],
            "captured_trains": 0, "skipped_dups": 0
        }

        try:
            res = requests.get(api_url, headers=HEADERS, timeout=20)
            rep_info["status_code"] = res.status_code
            if res.status_code != 200:
                print(f"   ❌ 無法讀取 {label}！HTTP 狀態碼: {res.status_code}")
                source_reports.append(rep_info)
                continue
            files = res.json()
        except Exception as e:
            print(f"   ❌ 連線 {label} 發生例外錯誤: {e}")
            source_reports.append(rep_info)
            continue

        if not isinstance(files, list):
            print(f"   ❌ {label} 回傳格式非檔案清單")
            source_reports.append(rep_info)
            continue

        rep_info["connected"] = True
        json_files = [f for f in files if f.get("name", "").endswith(".json")]
        rep_info["total_files"] = len(json_files)

        all_dates = [get_filename_date(f.get("name", "")) for f in json_files if get_filename_date(f.get("name", "")) > 0]
        if all_dates:
            rep_info["latest_date"] = str(max(all_dates))

        target_files = [f for f in json_files if get_filename_date(f.get("name", "")) >= START_DATE]
        print(f"   ✅ 成功偵測到 {label}！共有 {len(json_files)} 個 JSON 檔 (最新日期: {rep_info['latest_date']})，符合 >={START_DATE} 共 {len(target_files)} 個檔案")

        for file in target_files:
            fname = file.get("name", "")
            fdate = get_filename_date(fname)
            date_str = str(fdate)

            raw = fetch_json(file.get("download_url"))
            if not raw:
                print(f"   ⚠️ 抓取失敗: {fname}")
                continue

            rep_info["fetched_files"].append(fname)
            trains = extract_train_list(raw)

            file_captured = 0
            file_skipped = 0
            for t in trains:
                if isinstance(t, dict):
                    tid = str(t.get(TRAIN_ID_KEY, t.get("TrainNo", "")))
                    if (not tid or tid in master_ids or 
                        any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                        any(k in tid for k in EXCLUDE_KEYWORDS)):
                        continue

                    if tid in seen_trains_by_date[date_str]:
                        rep_info["skipped_dups"] += 1
                        file_skipped += 1
                        continue

                    t[TRAIN_ID_KEY] = tid
                    t["_source"] = f"{label}({user})"
                    seen_trains_by_date[date_str].add(tid)
                    all_data_pool[date_str].append(t)
                    rep_info["captured_trains"] += 1
                    file_captured += 1

            print(f"   📥 已抓取 [{label}] {fname} -> 總車次: {len(trains)} 筆 | 新增特殊/加班車: {file_captured} 筆 | 跳過重複: {file_skipped} 筆")
            time.sleep(0.05)

        source_reports.append(rep_info)

    # 2. 合併本地舊有的 pending_trains.json
    if os.path.exists(PENDING_FILE):
        try:
            with open(PENDING_FILE, 'r', encoding='utf-8') as f:
                saved_data = json.load(f)
                for date_str, trains in saved_data.items():
                    for t in trains:
                        tid = str(t.get(TRAIN_ID_KEY, t.get("TrainNo", "")))
                        if (not tid or tid in master_ids or 
                            any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or 
                            any(k in tid for k in EXCLUDE_KEYWORDS)):
                            continue
                        if tid in seen_trains_by_date[date_str]:
                            continue
                        t[TRAIN_ID_KEY] = tid
                        t["_source"] = t.get("_source", "本地暫存(pending)")
                        seen_trains_by_date[date_str].add(tid)
                        all_data_pool[date_str].append(t)
        except:
            pass

    # 3. 處理跨午夜 04:00 切分車次
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
            except ValueError:
                pass
                
    for next_date_str, next_trains in pending_next_day_trains.items():
        if next_date_str not in final_data_pool:
            final_data_pool[next_date_str].extend(next_trains)
            
    all_data_pool = final_data_pool
    ready_to_patch = {}
    keep_in_pending = {}

    os.makedirs(TARGET_DIR, exist_ok=True)
    
    for date_str, candidates in all_data_pool.items():
        unique_dict = {}
        for t in candidates:
            tid = str(t.get(TRAIN_ID_KEY, ""))
            if tid and tid not in unique_dict:
                unique_dict[tid] = t
        unique = list(unique_dict.values())

        target_path = os.path.join(TARGET_DIR, f"{date_str}.json")
        local_trains = load_local_file(target_path)

        if local_trains is None:
            if unique: keep_in_pending[date_str] = unique
        else:
            exist = set(str(t.get(TRAIN_ID_KEY, t.get("TrainNo", ""))) for t in local_trains)
            new_stuff = [t for t in unique if str(t.get(TRAIN_ID_KEY)) not in exist]
            if new_stuff: ready_to_patch[date_str] = new_stuff

    # 🌟 4. 輸出分流：
    # (1) 第一項：只印在終端機 (供 GitHub Actions 檢視)
    print_source_detection_summary(source_reports)

    if any(r["connected"] for r in source_reports):
        # (2) 第二項：單獨寫入 merged_history.txt
        update_merged_history_txt(ready_to_patch, s_map, c_map)
        # (3) 第四項：保留在 catch_log.txt (第三項已完全隱藏)
        generate_catch_log_txt(keep_in_pending, s_map, c_map)

    # 5. 將新車次寫入 data/YYYYMMDD.json
    if ready_to_patch:
        for date_str, new_trains in ready_to_patch.items():
            target_path = os.path.join(TARGET_DIR, f"{date_str}.json")
            try:
                with open(target_path, 'r', encoding='utf-8') as f:
                    data = extract_train_list(json.load(f))
                clean_new_trains = []
                for t in new_trains:
                    t_clean = copy.deepcopy(t)
                    t_clean.pop("_source", None)
                    clean_new_trains.append(t_clean)
                data.extend(clean_new_trains)
                final_output = {"TrainInfos": data}
                with open(target_path, 'w', encoding='utf-8') as f:
                    json.dump(final_output, f, ensure_ascii=False, indent=2)
            except:
                pass

    if keep_in_pending:
        clean_pending = {}
        for d_str, t_list in keep_in_pending.items():
            clean_pending[d_str] = []
            for t in t_list:
                t_clean = copy.deepcopy(t)
                t_clean.pop("_source", None)
                clean_pending[d_str].append(t_clean)
        with open(PENDING_FILE, 'w', encoding='utf-8') as f:
            json.dump(clean_pending, f, ensure_ascii=False, indent=2)
    else:
        if os.path.exists(PENDING_FILE): os.remove(PENDING_FILE)
        
    # 🌟 程式結尾：呼叫最後的大掃除與校正
    run_post_processing_corrections()
    print("🎉 智慧管理員作業與校正全部完成！")

if __name__ == "__main__":
    main()
