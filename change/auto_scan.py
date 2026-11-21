# -*- coding: utf-8 -*-
import requests
import json
import os
import time
import datetime
import re
from collections import defaultdict

# ================= 設定區 =================
FORCE_REBUILD = False

HISTORY_FILE = "scan_history.json"
LOG_FILE = "scan_log.txt"

# 🕒 強制使用台灣時間 (UTC+8)
TW_TZ = datetime.timezone(datetime.timedelta(hours=8))

# 👇 之後要恢復自動抓「今日」，把上面那行註解掉、打開下面這行即可
START_DATE = int(datetime.datetime.now(TW_TZ).strftime("%Y%m%d"))

# 🧠 你這邊的基準檔 (大腦) 路徑設定
ROOT_MASTER_FILE = "final_train_diagram.json"  # 根目錄 (現役基準檔)
FUTURE_BRAIN_DIR = "data all"                  # 未來改點基準檔資料夾

STATION_DB_FILE = "SVG_Y_Axis.json"
CAR_KIND_DB_FILE = "CarKind.json"
BILLY_REF_URL = "https://raw.githubusercontent.com/billy1125/billy1125.github.io/main/js/references/"

# 🌟 黃金排除名單
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
    """僅解析標準 8 碼日期檔名 (YYYYMMDD.json)，其他格式回傳 0"""
    stem = filename.replace(".json", "")
    if len(stem) == 8 and stem.isdigit():
        return int(stem)
    return 0

def fetch_json(url):
    try:
        res = requests.get(url, timeout=15)
        return res.json() if res.status_code == 200 else None
    except Exception:
        return None

def extract_train_list(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ["TrainInfos", "TrainTimetables", "Trains", "data", "records", "result"]:
            if key in data and isinstance(data[key], list):
                return data[key]
        if "Train" in data or "TrainNo" in data:
            return [data]
    return []

def load_db(filename):
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    print(f"☁️ 正在從雲端下載字典: {filename} ...")
    url = BILLY_REF_URL + filename
    data = fetch_json(url)
    if data:
        return data
    return {}

def train_sort_key(train_obj):
    tid = str(train_obj.get("Train", train_obj.get("TrainNo", "0")))
    match = re.match(r"^(\d+)([a-zA-Z]*)", tid)
    if match:
        return (int(match.group(1)), match.group(2))
    return (float('inf'), tid)

def main():
    # 🔒 鎖定工作目錄在專案根目錄
    script_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir = os.path.dirname(script_dir) if os.path.basename(script_dir) == "change" else script_dir
    os.chdir(base_dir)

    now_str = datetime.datetime.now(TW_TZ).strftime("%Y-%m-%d %H:%M:%S")
    print(f"🕒 執行時間 (台灣時間): {now_str}")
    print(f"📅 掃描起始日期: {START_DATE} 起（僅抓取 billy1125.github.io 之日期檔）")

    s_db = load_db(STATION_DB_FILE)
    station_map = {}
    for k, v in s_db.items():
        if isinstance(v, list):
            for st in v:
                if "ID" in st and "DSC" in st:
                    station_map[str(st["ID"])] = st["DSC"]
    c_db = load_db(CAR_KIND_DB_FILE)
    c_map = {str(k): v for k, v in c_db.items()}

    # ========================================================
    # 🧠 1. 載入本地基準檔與未來改點大腦
    # ========================================================
    print("\n🧠 正在載入本地基準檔與時空菜單...")

    root_master_ids = set()
    if os.path.exists(ROOT_MASTER_FILE):
        try:
            with open(ROOT_MASTER_FILE, 'r', encoding='utf-8') as f:
                data = extract_train_list(json.load(f))
                for t in data:
                    if isinstance(t, dict):
                        tid = str(t.get("Train", t.get("TrainNo", ""))).strip()
                        if tid:
                            root_master_ids.add(tid)
            print(f"  ✅ [基底大腦] {ROOT_MASTER_FILE} - 共 {len(root_master_ids)} 筆")
        except Exception as e:
            print(f"  ❌ 讀取 {ROOT_MASTER_FILE} 失敗: {e}")

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
                                if isinstance(t, dict):
                                    tid = str(t.get("Train", t.get("TrainNo", ""))).strip()
                                    if tid:
                                        ids_set.add(tid)
                        future_masters[g_date] = ids_set
                        revised_epochs.append({"date": g_date, "fileId": roc_date_str})
                        print(f"  ✅ [未來大腦] {fname} (生效日: {g_date}) - 共 {len(ids_set)} 筆")
                    except Exception:
                        pass

    if revised_epochs:
        revised_epochs.sort(key=lambda x: x["date"])
        os.makedirs(FUTURE_BRAIN_DIR, exist_ok=True)
        try:
            with open(os.path.join(FUTURE_BRAIN_DIR, "Revised_Epochs.json"), "w", encoding="utf-8") as f:
                json.dump(revised_epochs, f, ensure_ascii=False, indent=2)
            print(f"  ✅ 成功產生時空菜單: {FUTURE_BRAIN_DIR}/Revised_Epochs.json (共 {len(revised_epochs)} 個結界)")
        except Exception:
            pass

    # ========================================================
    # 🚀 2. 純抓取 billy1125.github.io（完全不看本地 data/）
    # ========================================================
    files_to_process = {}
    print(f"\n📡 正在純抓取 billy1125.github.io 最新日期檔 ({START_DATE} 起)...")

    headers = {}
    gh_token = os.environ.get("GITHUB_TOKEN")
    if gh_token:
        headers["Authorization"] = f"Bearer {gh_token}"

    for user, repo, path in TARGETS:
        try:
            res = requests.get(
                f"https://api.github.com/repos/{user}/{repo}/contents/{path}",
                headers=headers,
                timeout=15
            )
            if res.status_code != 200:
                print(f"  ❌ 讀取 {user}/{repo} 目錄失敗 (HTTP {res.status_code})")
                continue

            github_files = res.json()
            if not isinstance(github_files, list):
                continue

            target_files = [
                f for f in github_files
                if f.get("name", "").endswith(".json") and get_filename_date(f["name"]) >= START_DATE
            ]
            target_files.sort(key=lambda f: get_filename_date(f["name"]))

            for file in target_files:
                fdate = get_filename_date(file["name"])
                raw = fetch_json(file["download_url"])
                if raw:
                    files_to_process[fdate] = raw
                time.sleep(0.05)
        except Exception as e:
            print(f"  ❌ 抓取 {user}/{repo} 發生錯誤: {e}")
            continue

    print(f"  ➜ 雲端抓取完成！共取得 {len(files_to_process)} 天 ({START_DATE} 起) 的原作者日期檔。")

    # ========================================================
    # 🔍 3. 智慧時空對位、篩選特殊車次 & 自動對帳清理已消失舊車次
    # ========================================================
    history_data = {"runs": [], "seen": [], "records": {}}
    if FORCE_REBUILD:
        print("\n⚠️ [洗腦模式開啟] 已忽略舊有記憶，將進行重新分析！")
    elif os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "runs" in data:
                    history_data = data
        except Exception:
            pass

    seen_set = set(history_data["seen"])
    new_findings_by_date = defaultdict(list)
    new_count = 0
    removed_count = 0

    print("\n🔍 正在比對基準檔，篩選特殊車次並對帳清理已消失車次...")
    for fdate, raw in sorted(files_to_process.items()):
        applicable_dates = [d for d in future_masters.keys() if d <= fdate]
        if applicable_dates:
            best_date = max(applicable_dates)
            current_master_ids = future_masters[best_date]
        else:
            current_master_ids = root_master_ids

        daily_data = extract_train_list(raw)
        valid_tids_today = set()

        for train in daily_data:
            if not isinstance(train, dict):
                continue
            tid = str(train.get("Train", train.get("TrainNo", ""))).strip()

            if (not tid or tid in current_master_ids or
                any(tid.startswith(p) for p in EXCLUDE_PREFIXES) or
                any(k in tid for k in EXCLUDE_KEYWORDS)):
                continue

            valid_tids_today.add(tid)
            uid = f"{fdate}_{tid}"
            if uid not in seen_set:
                new_findings_by_date[fdate].append(train)
                seen_set.add(uid)
                new_count += 1

        # 🧹 自動對帳：若舊紀錄內有已不在當日原作者檔的車次，自動移除並釋放記憶（未來再出現仍可重抓）
        date_str = str(fdate)
        if date_str in history_data["records"]:
            for rt in list(history_data["records"][date_str].keys()):
                kept_lines = []
                for line in history_data["records"][date_str][rt]:
                    m = re.search(r"\[([^\]]+)\]", line)
                    rec_tid = m.group(1).strip() if m else ""
                    if rec_tid and rec_tid in valid_tids_today:
                        kept_lines.append(line)
                    else:
                        removed_count += 1
                        if rec_tid:
                            seen_set.discard(f"{fdate}_{rec_tid}")
                            print(f"  🧹 [{date_str}] 清除已移除之舊車次: {rec_tid}")
                if kept_lines:
                    history_data["records"][date_str][rt] = kept_lines
                else:
                    del history_data["records"][date_str][rt]
            if not history_data["records"][date_str]:
                del history_data["records"][date_str]

    # ========================================================
    # 📝 4. 寫入 scan_log.txt 與歷史記憶
    # ========================================================
    if new_count > 0 or removed_count > 0 or FORCE_REBUILD:
        history_data["seen"] = list(seen_set)
        if new_count > 0:
            history_data["runs"].append({
                "time": now_str,
                "total_seen": len(seen_set),
                "new_added": new_count
            })

        for date_key in sorted(new_findings_by_date.keys()):
            trains = new_findings_by_date[date_key]
            trains.sort(key=train_sort_key)
            date_str = str(date_key)
            if date_str not in history_data["records"]:
                history_data["records"][date_str] = {}
            history_data["records"][date_str][now_str] = []

            for t in trains:
                tid = t.get("Train", t.get("TrainNo", "?"))
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

        print(f"\n✅ 完成！新增 {new_count} 筆、清理過時 {removed_count} 筆，已同步更新 {LOG_FILE}")
    else:
        print("\n💤 本次無新發現，亦無需清理過時紀錄。")

if __name__ == "__main__":
    main()
