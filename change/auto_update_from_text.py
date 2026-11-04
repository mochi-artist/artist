import json
import os
import re
import copy
from datetime import datetime, timedelta

# =================【使用者設定區】=================
DEFAULT_YEAR = 2026                    
INPUT_TXT = 'extratrain_data.txt'
SOURCE_FILES = [
    'final_train_diagram_1151003.json',
    'extratrain_data.json'
]
FINAL_WHITELIST_FILE = 'final_train_diagram.json'
TARGET_DIR = 'data'
PENDING_FILE = 'pending_trains.json'

# 預設規則車次清單 (與 auto_delete_trains.py 相同，當目標車次填 ALL 時使用)
RULE_CLASS_0001 = ['6652', '6655', '6629', '6630']
RULE_CLASS_0002 = ['6631', '6632', '6633', '6676', '6677']
ALL_RULE_TRAINS = set(RULE_CLASS_0001 + RULE_CLASS_0002)
# =================================================

def load_whitelist(filename):
    if not os.path.exists(filename): return set()
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
        trains = set()
        infos = data.get('TrainInfos', []) if isinstance(data, dict) else data
        for t in infos:
            if isinstance(t, dict) and 'Train' in t:
                trains.add(str(t['Train']))
        print(f"🔒 白名單鎖定: {len(trains)} 筆")
        return trains
    except:
        return set()

def load_sources(file_list):
    """
    載入多個來源 JSON 檔案（相容 {"TrainInfos": [...]} 與純陣列 [...] 格式）
    回傳格式: { "車次": {"data": 車次物件, "sources": ["來源檔1", "來源檔2"]} }
    """
    source_map = {}
    for filename in file_list:
        if not os.path.exists(filename):
            print(f"⚠️ 找不到來源檔 {filename}，已略過。")
            continue
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            infos = data.get('TrainInfos', []) if isinstance(data, dict) else data
            if not isinstance(infos, list):
                print(f"⚠️ {filename} 格式不符（非陣列或無 TrainInfos），已略過。")
                continue

            count = 0
            for t in infos:
                if isinstance(t, dict) and 'Train' in t:
                    tn = str(t['Train']).strip()
                    if not tn:
                        continue
                    if tn not in source_map:
                        source_map[tn] = {'data': t, 'sources': [filename]}
                    else:
                        source_map[tn]['data'] = t
                        if filename not in source_map[tn]['sources']:
                            source_map[tn]['sources'].append(filename)
                    count += 1
            print(f"📂 成功載入來源檔 [{filename}]: 共 {count} 筆車次")
        except Exception as e:
            print(f"❌ 讀取來源檔 {filename} 發生錯誤: {e}")
            
    return source_map

def has_english_char(s):
    return bool(re.search(r'[a-zA-Z]', str(s)))

def get_train_summary(train_obj):
    try:
        times = train_obj.get('TimeInfos', [])
        if not times: return "無時刻資料"
        start_stn = times[0].get('Station', '?')
        end_stn = times[-1].get('Station', '?')
        dep_time = times[0].get('DEPTime', '??:??')
        arr_time = times[-1].get('ARRTime', '??:??')
        return f"{start_stn}({dep_time}) -> {end_stn}({arr_time})"
    except:
        return "資料解析異常"

def is_valid_date(year, month, day):
    try:
        datetime(year, month, day)
        return True
    except ValueError:
        return False

def generate_date_range(start_date_str, end_date_str):
    try:
        start = datetime.strptime(str(DEFAULT_YEAR) + start_date_str, "%Y%m%d")
        end = datetime.strptime(str(DEFAULT_YEAR) + end_date_str, "%Y%m%d")
        date_list = []
        curr = start
        while curr <= end:
            date_list.append(curr.strftime("%Y%m%d"))
            curr += timedelta(days=1)
        return date_list
    except ValueError:
        return []

def parse_date(line):
    line = re.sub(r'(?<!\d)\d{3,5}[A-Z]*[\u4e00-\u9fa5]*次?', '', line)
    line = re.sub(r'\d{1,2}:\d{1,2}(:\d{1,2})?', '', line)
    line = line.replace('～', '~').replace('；', '、').replace('至', '~').replace('-', '~')
    line = re.sub(r'\(\d+天\)', '', line) 
    
    all_dates = set()

    cross_month_pattern = r'(\d{1,2})月(\d{1,2})[日]?\s*~\s*(\d{1,2})月(\d{1,2})[日]?'
    cross_matches = re.finditer(cross_month_pattern, line)
    for match in cross_matches:
        m1, d1, m2, d2 = map(int, match.groups())
        if is_valid_date(DEFAULT_YEAR, m1, d1) and is_valid_date(DEFAULT_YEAR, m2, d2):
            start_s = f"{m1:02d}{d1:02d}"
            end_s = f"{m2:02d}{d2:02d}"
            all_dates.update(generate_date_range(start_s, end_s))
    
    line_clean = re.sub(cross_month_pattern, '', line)
    month_iter = list(re.finditer(r'(\d{1,2})月', line_clean))
    
    for i, match in enumerate(month_iter):
        month = int(match.group(1))
        if month < 1 or month > 12: continue

        start_idx = match.end()
        if i + 1 < len(month_iter):
            end_idx = month_iter[i+1].start()
            content = line_clean[start_idx:end_idx]
        else:
            content = line_clean[start_idx:]
            
        clean_content = re.sub(r'[^\d~]+', '、', content)
        parts = clean_content.split('、')

        for part in parts:
            if '~' in part:
                try:
                    s_str, e_str = part.split('~')
                    if s_str and e_str:
                        s, e = int(s_str), int(e_str)
                        for d in range(s, e + 1):
                            if is_valid_date(DEFAULT_YEAR, month, d):
                                all_dates.add(f"{DEFAULT_YEAR}{month:02d}{d:02d}")
                except: pass
            else:
                try:
                    if part.strip():
                        d = int(part)
                        if is_valid_date(DEFAULT_YEAR, month, d):
                            all_dates.add(f"{DEFAULT_YEAR}{month:02d}{d:02d}")
                except: pass

    return sorted(list(all_dates))

def parse_trains(line):
    matches = re.findall(r'(?<!\d)(\d{3,5}[A-Z]*[\u4e00-\u9fa5]*)次?', line)
    valid_trains = []
    for tn in matches:
        tn = tn.rstrip('次')
        if tn != str(DEFAULT_YEAR) and tn:
            valid_trains.append(tn)
    return valid_trains

def sort_trains_logic(train_list):
    def key_func(t):
        tn = str(t.get('Train', ''))
        match = re.match(r'^(\d+)(.*)$', tn)
        if match:
            return (int(match.group(1)), match.group(2))
        return (999999, tn) 
    return sorted(train_list, key=key_func)

# =====================================================================
# 🌟 與 change/auto_delete_trains.py 相同的日期與車次比對機制
# =====================================================================
def is_date_matched(date_str, target_filters):
    """
    支援：
    - ALL (空清單)：所有日期
    - 8 碼指定單日 (YYYYMMDD，如 20261101)
    - 6 碼指定年月 (YYYYMM，如 202611)
    - 4 碼指定月日 (MMDD，如 1101)
    - 1~2 碼指定月份 (MM，如 11 或 1)
    """
    if not target_filters:
        return True
    if len(date_str) != 8:
        return False

    for raw_f in target_filters:
        f = raw_f.replace('-', '').replace('/', '').strip()
        if len(f) == 8 and date_str == f:
            return True
        elif len(f) == 6 and date_str.startswith(f):
            return True
        elif len(f) == 4 and date_str[4:8] == f:
            return True
        elif len(f) <= 2 and f.isdigit() and date_str[4:6] == f.zfill(2):
            return True
    return False

def resolve_new_carclass(train_no, target_carclass_input):
    """
    若指定具體 CarClass (如 110F、1280) 則直接使用；
    若填 AUTO 且車次屬於 0001/0002 清單，則自動套用對應車種。
    """
    if target_carclass_input.upper() == 'AUTO':
        if train_no in RULE_CLASS_0001:
            return '0001'
        elif train_no in RULE_CLASS_0002:
            return '0002'
        return None
    return target_carclass_input

def run_custom_carclass_update():
    """
    🌟 當 GitHub Actions 按鈕開啟時，依指定車次與日期/月份批次變更 CarClass
    """
    enable_flag = os.environ.get('ENABLE_CARCLASS_CHANGE', 'false').strip().lower()
    target_trains_input = os.environ.get('TARGET_TRAINS', '').strip()
    target_months_input = os.environ.get('TARGET_MONTHS', '').strip()
    target_carclass_input = os.environ.get('TARGET_CARCLASS', '').strip()

    # 若未勾選開啟，且未填寫車次參數，則直接略過
    if enable_flag != 'true' and not (target_trains_input and target_months_input and target_carclass_input):
        return

    print("\n" + "=" * 70)
    print("🎨 啟動【指定車次 CarClass 批次變更】功能")
    print("=" * 70)

    if not target_trains_input or not target_months_input or not target_carclass_input:
        print("❌ 錯誤：已開啟 CarClass 變更功能，但未完整提供「目標車次」、「目標時間」或「目標 CarClass」參數。")
        return

    # 1️⃣ 解析「目標車次」 (與 auto_delete_trains.py 相同)
    if target_trains_input.upper() == 'ALL':
        target_trains = ALL_RULE_TRAINS
    else:
        target_trains = set([t.strip() for t in re.split(r'[,\s，、]+', target_trains_input) if t.strip()])

    # 2️⃣ 解析「目標日期/月份/年月」 (與 auto_delete_trains.py 相同)
    target_filters = []
    if target_months_input.upper() != 'ALL':
        target_filters = [m.strip() for m in re.split(r'[,\s，、]+', target_months_input) if m.strip()]

    print(f"🎯 目標車次: {', '.join(sorted(target_trains))}")
    print(f"📅 目標時間: {', '.join(target_filters) if target_filters else '所有時間 (ALL)'}")
    print(f"🏷️ 目標 CarClass: {target_carclass_input}")
    print("-" * 70)

    total_updated = 0
    modified_files = []

    # 3️⃣ 掃描並變更 data/ 目錄下的 JSON 檔案
    if os.path.exists(TARGET_DIR):
        for filename in sorted(os.listdir(TARGET_DIR)):
            if not filename.endswith('.json'):
                continue

            date_str = filename.replace('.json', '')
            if not is_date_matched(date_str, target_filters):
                continue

            filepath = os.path.join(TARGET_DIR, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    daily_data = json.load(f)

                train_list = []
                if isinstance(daily_data, dict) and "TrainInfos" in daily_data:
                    train_list = daily_data["TrainInfos"]
                elif isinstance(daily_data, list):
                    train_list = daily_data

                affected = 0
                for t in train_list:
                    if not isinstance(t, dict):
                        continue
                    t_no = str(t.get("TrainNo", t.get("Train", ""))).strip()
                    if t_no in target_trains:
                        new_cls = resolve_new_carclass(t_no, target_carclass_input)
                        if new_cls and str(t.get("CarClass", "")) != new_cls:
                            old_cls = t.get("CarClass", "無")
                            t["CarClass"] = new_cls
                            affected += 1
                            print(f"  🔄 [{date_str}.json] 車次 {t_no}: CarClass {old_cls} -> {new_cls}")

                if affected > 0:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        json.dump(daily_data, f, ensure_ascii=False, indent=2)
                    total_updated += affected
                    modified_files.append(date_str)

            except Exception as e:
                print(f"❌ 處理 {filename} 時發生錯誤: {e}")

    # 4️⃣ 同步檢查並變更 pending_trains.json 內的暫存車次
    if os.path.exists(PENDING_FILE):
        try:
            with open(PENDING_FILE, 'r', encoding='utf-8') as f:
                pending_data = json.load(f)
            pending_changed = False
            for d_str, p_trains in pending_data.items():
                if not is_date_matched(d_str, target_filters):
                    continue
                for t in p_trains:
                    if not isinstance(t, dict):
                        continue
                    t_no = str(t.get("TrainNo", t.get("Train", ""))).strip()
                    if t_no in target_trains:
                        new_cls = resolve_new_carclass(t_no, target_carclass_input)
                        if new_cls and str(t.get("CarClass", "")) != new_cls:
                            old_cls = t.get("CarClass", "無")
                            t["CarClass"] = new_cls
                            total_updated += 1
                            pending_changed = True
                            print(f"  🔄 [pending_trains.json ({d_str})] 車次 {t_no}: CarClass {old_cls} -> {new_cls}")

            if pending_changed:
                modified_files.append("pending_trains.json")
                with open(PENDING_FILE, 'w', encoding='utf-8') as f:
                    json.dump(pending_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"❌ 處理 {PENDING_FILE} 時發生錯誤: {e}")

    print("-" * 70)
    if total_updated > 0:
        print(f"✅ CarClass 變更完畢！共於 {len(modified_files)} 個檔案中，成功更新 {total_updated} 筆車次。")
    else:
        print("⚪ 掃描完畢，沒有找到需要變更 CarClass 的車次（或目標車次已是該 CarClass）。")


def process_text_update():
    # 允許透過環境變數控制是否跳過 TXT 解析
    run_txt_flag = os.environ.get('RUN_TEXT_UPDATE', 'true').strip().lower()
    if run_txt_flag == 'false':
        print("⏩ 已略過 extratrain_data.txt 解析步驟。")
        return

    if not os.path.exists(INPUT_TXT):
        print(f"❌ 找不到 {INPUT_TXT}，請確認是否已將公告貼入該檔案。")
        return

    print(f"⚙️  目前年份設定: {DEFAULT_YEAR}")
    locked_trains = load_whitelist(FINAL_WHITELIST_FILE)
    
    source_map = load_sources(SOURCE_FILES)
    if not source_map:
        print(f"❌ 所有來源檔 {SOURCE_FILES} 皆無法讀取或無有效車次資料，略過 TXT 匯入。")
        return

    updates = {} 
    train_sources_log = {}
    
    print(f"\n📖 正在讀取並解析 {INPUT_TXT} ...")
    print("-" * 70)
    
    with open(INPUT_TXT, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    valid_count = 0
    pending_dates = None

    for idx, line in enumerate(lines):
        line = line.strip()
        if not line: continue

        found_dates = parse_date(line)
        if found_dates: pending_dates = found_dates
        
        train_nos = parse_trains(line)
        
        if train_nos:
            date_display = f"{pending_dates[0]} 等 {len(pending_dates)} 天" if pending_dates else "無日期"
            print(f"🔍 行 {idx+1}: 抓到日期 [{date_display}] | 車次 {train_nos}")
            
            if not pending_dates:
                print(f"   ↳ ⚠️ 失敗: 找不到有效日期")
                continue

            for train_no in train_nos:
                if train_no in locked_trains:
                    print(f"   ↳ 🛡️ 跳過 [{train_no}] (已被白名單保護)")
                    continue
                if train_no not in source_map:
                    print(f"   ↳ ❌ 跳過 [{train_no}] (於 {SOURCE_FILES} 中皆查無此車次)")
                    continue

                matched_info = source_map[train_no]
                proc_train = copy.deepcopy(matched_info['data'])
                matched_files = matched_info['sources']
                matched_files_str = "、".join(matched_files)
                train_sources_log[train_no] = matched_files_str
                
                if has_english_char(train_no):
                    proc_train['CarClass'] = "1280"

                for d in pending_dates:
                    if d not in updates: updates[d] = []
                    existing = [t['Train'] for t in updates[d]]
                    if train_no not in existing:
                        updates[d].append(proc_train)
                
                valid_count += 1
                print(f"   ↳ ✅ 成功解析 [{train_no}] (成功偵測來源: {matched_files_str})")
                
    print("-" * 70)
    print(f"✅ 解析完成！共產生 {valid_count} 筆有效指令。\n")
    
    if valid_count == 0:
        print("⚠️ 提示: extratrain_data.txt 沒有產生任何有效更新。")
        return
        
    print("="*80)
    print("      【 全 局 預 覽 模 式 】      ")
    print("="*80)

    sorted_dates = sorted(updates.keys())
    tasks = [] 

    os.makedirs(TARGET_DIR, exist_ok=True)

    for date_str in sorted_dates:
        raw_list = updates[date_str]
        new_list = sort_trains_logic(raw_list)
        
        target_path = os.path.join(TARGET_DIR, f"{date_str}.json")
        target_json = {"TrainInfos": []}
        file_exists = os.path.exists(target_path)
        
        if file_exists:
            try:
                with open(target_path, 'r', encoding='utf-8') as f:
                    target_json = json.load(f)
            except: pass
        
        t_trains = target_json.get('TrainInfos', [])
        
        logs = []
        preview_trains = copy.deepcopy(t_trains)
        preview_map = {str(t.get('Train', t.get('TrainNo'))): t for t in preview_trains}
        
        for item in new_list:
            tn = str(item['Train'])
            info_str = get_train_summary(item)
            src_label = train_sources_log.get(tn, "未知來源")
            
            if tn in preview_map:
                preview_map[tn]['TimeInfos'] = item['TimeInfos']
                logs.append(f"更新   | {tn:<6} | {info_str:<35} | 覆蓋時刻 (來源: {src_label})")
            else:
                note = f"英->1280 (來源: {src_label})" if item.get('CarClass')=="1280" and has_english_char(tn) else f"來源: {src_label}"
                preview_trains.append(item)
                logs.append(f"新增   | {tn:<6} | {info_str:<35} | {note}")

        tasks.append({
            'path': target_path,
            'json_data': {'TrainInfos': preview_trains},
            'date': date_str,
            'logs': logs
        })

        print(f"📅 日期: {date_str} ({'既有' if file_exists else '新檔'}) - {len(logs)} 筆")
        for log in logs:
            print(log)
        print("-" * 80)

    print("\n🚀 機器人自動確認，開始寫入檔案...")
    for task in tasks:
        path = task['path']
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(task['json_data'], f, ensure_ascii=False, indent=2)
        print(f"✅ 已儲存 {task['date']}.json")
    
    # 🔒 保留 extratrain_data.txt 內容不清空
    print("\n🎉 extratrain_data.txt 匯入完成！(已保留 extratrain_data.txt 內容)")

if __name__ == "__main__":
    # 1. 先執行公告文字檔匯入
    process_text_update()
    # 2. 若按鈕有開啟 CarClass 變更，接著針對指定日期與車次強制覆寫 CarClass
    run_custom_carclass_update()
