import requests
import json
import os
import time
import re
import copy
from datetime import datetime, timedelta
from collections import defaultdict

# ================= 設定區 =================
TARGET_DIR = "data"
MASTER_FILE_PATH = "final_train_diagram.json"
PENDING_FILE = "pending_trains.json"  
CATCH_LOG_FILE = "catch_log.txt"      
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
        except: pass
    return ids

def load_dicts():
    s_map, c_map = {}, {}
    s_path = None
    for root, dirs, files in os.walk("."):
        if "SVG_Y_Axis.json" in files:
            s_path = os.path.join(root, "SVG_Y_Axis.json")
            break
    if s_path:
        try:
            with open(s_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for line_key, stations in data.items():
                    if isinstance(stations, list):
                        for st in stations:
                            if "ID" in st and "DSC" in st: 
                                s_map[str(st["ID"])] = st["DSC"]
        except: pass

    c_path = None
    for root, dirs, files in os.walk("."):
        if "CarKind.json" in files:
            c_path = os.path.join(root, "CarKind.json")
            break
    if c_path:
        try:
            with open(c_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                c_map = {str(k): v for k, v in data.items()}
        except: pass
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
        st_code = str(tts[0].get("Station", tts[0].get("StationID", "?")))
        end_code = str(tts[-1].get("Station", tts[-1].get("StationID", "?")))
        st_name = s_map.get(st_code, st_code)
        end_name = s_map.get(end_code, end_code)
    return f"  ➜ [{tid}] {chi} {code} ({st_name} -> {end_name})"

def generate_catch_log(ready_to_patch, keep_in_pending, s_map, c_map):
    lines = []
    lines.append(f"====== 自動抓取報告 ({time.strftime('%Y-%m-%d %H:%M:%S')}) ======\n")
    if ready_to_patch:
        lines.append("✅ 【成功寫入的車次】")
        for d in sorted(ready_to_patch.keys()):
            items = ready_to_patch[d]
            items.sort(key=train_sort_key)
            lines.append(f"📅 日期: {d} (共 {len(items)} 筆)")
            for t in items: lines.append(format_train_log(t, s_map, c_map))
            lines.append("")
    if keep_in_pending:
        lines.append("🟡 【暫存等待中的車次 (目標日期檔尚未產出)】")
        for d in sorted(keep_in_pending.keys()):
            items = keep_in_pending[d]
            items.sort(key=train_sort_key)
            lines.append(f"📅 日期: {d} (共 {len(items)} 筆)")
            for t in items: lines.append(format_train_log(t, s_map, c_map))
            lines.append("")
    if not ready_to_patch and not keep_in_pending:
        lines.append("⚪ 今日無任何外部新車次。")
    try:
        with open(CATCH_LOG_FILE, 'w', encoding='utf-8') as f: f.write("\n".join(lines))
    except: pass

# 🌟 新增：最終大檢查與強制覆寫功能
def run_post_processing_corrections():
    print("\n🔧 正在執行最終資料校正 (CarClass 自動替換與 110F 專車規則)...")
    
    # 1. 修正 pending_trains.json 中的 0001/0002
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

    # 2. 修正 data/ 目錄下所有 JSON 檔的 110F 與 0001/0002
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
                
                # 規則 A: 110F 專車覆寫 (優先權最高)
                if t_no in target_110f_trains:
                    if curr_class != "110F":
                        t["CarClass"] = "110F"
                        changed = True
                else:
                    # 規則 B: 0001/0002 強制校正
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

    if ready_to_patch:
        for date_str, new_trains in ready_to_patch.items():
            target_path = os.path.join(TARGET_DIR, f"{date_str}.json")
            try:
                with open(target_path, 'r', encoding='utf-8') as f:
                    data = extract_train_list(json.load(f))
                data.extend(new_trains)
                final_output = {"TrainInfos": data}
                with open(target_path, 'w', encoding='utf-8') as f:
                    json.dump(final_output, f, ensure_ascii=False, indent=2)
            except: pass

    generate_catch_log(ready_to_patch, keep_in_pending, s_map, c_map)

    if keep_in_pending:
        with open(PENDING_FILE, 'w', encoding='utf-8') as f:
            json.dump(keep_in_pending, f, ensure_ascii=False, indent=2)
    else:
        if os.path.exists(PENDING_FILE): os.remove(PENDING_FILE)
        
    # 🌟 程式結尾：呼叫最後的大掃除與校正
    run_post_processing_corrections()
    print("🎉 智慧管理員作業與校正全部完成！")

if __name__ == "__main__":
    main()
