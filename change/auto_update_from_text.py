import json
import os
import re
import copy
from datetime import datetime, timedelta

# =================【使用者設定區】=================
DEFAULT_YEAR = 2026                    
INPUT_TXT = 'extratrain_data.txt'
SOURCE_FILE = 'final_train_diagram_1151003.json'
FINAL_WHITELIST_FILE = 'final_train_diagram.json'
TARGET_DIR = 'data' # 🌟 已修正為 GitHub 的相對路徑
# =================================================

def load_whitelist(filename):
    if not os.path.exists(filename): return set()
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
        trains = set()
        infos = data.get('TrainInfos', []) if isinstance(data, dict) else data
        for t in infos:
            if 'Train' in t: trains.add(str(t['Train']))
        print(f"🔒 白名單鎖定: {len(trains)} 筆")
        return trains
    except: return set()

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
    except: return "資料解析異常"

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
    except ValueError: return []

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

def process_text_update():
    if not os.path.exists(INPUT_TXT):
        print(f"❌ 找不到 {INPUT_TXT}，請確認是否已將公告貼入該檔案。")
        return

    print(f"⚙️  目前年份設定: {DEFAULT_YEAR}")
    locked_trains = load_whitelist(FINAL_WHITELIST_FILE)
    
    if not os.path.exists(SOURCE_FILE):
        print(f"❌ 找不到來源檔 {SOURCE_FILE}")
        return

    with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
        source_data = json.load(f)
    source_map = {str(t['Train']): t for t in source_data.get('TrainInfos', [])}

    updates = {} 
    
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
                    print(f"   ↳ ❌ 跳過 [{train_no}] (來源檔 {SOURCE_FILE} 中查無此車次)")
                    continue

                proc_train = copy.deepcopy(source_map[train_no])
                
                if has_english_char(train_no):
                    proc_train['CarClass'] = "1280"

                for d in pending_dates:
                    if d not in updates: updates[d] = []
                    existing = [t['Train'] for t in updates[d]]
                    if train_no not in existing:
                        updates[d].append(proc_train)
                
                valid_count += 1
                print(f"   ↳ ✅ 成功解析 [{train_no}]")
                
    print("-" * 70)
    print(f"✅ 解析完成！共產生 {valid_count} 筆有效指令。\n")
    
    if valid_count == 0:
        print("⚠️ 提示: 沒有產生任何有效更新，任務結束。")
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
        t_map = {str(t.get('Train', t.get('TrainNo'))): t for t in t_trains}
        
        logs = []
        preview_trains = copy.deepcopy(t_trains)
        preview_map = {str(t.get('Train', t.get('TrainNo'))): t for t in preview_trains}
        
        for item in new_list:
            tn = str(item['Train'])
            info_str = get_train_summary(item)
            
            if tn in preview_map:
                preview_map[tn]['TimeInfos'] = item['TimeInfos']
                logs.append(f"更新   | {tn:<6} | {info_str:<40} | 覆蓋時刻")
            else:
                note = "英->1280" if item.get('CarClass')=="1280" and has_english_char(tn) else ""
                preview_trains.append(item)
                logs.append(f"新增   | {tn:<6} | {info_str:<40} | {note}")

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

    # 🌟 拔除 input() 詢問，直接全自動執行寫入
    print("\n🚀 機器人自動確認，開始寫入檔案...")
    for task in tasks:
        path = task['path']
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(task['json_data'], f, ensure_ascii=False, indent=2)
        print(f"✅ 已儲存 {task['date']}.json")
    
    # 🌟 寫入完成後，清空 train_data.txt，避免下次誤重複執行
    with open(INPUT_TXT, 'w', encoding='utf-8') as f:
        f.write("")
        
    print("\n🎉 全部任務完成！已清空 train_data.txt 待命下一次任務。")

if __name__ == "__main__":
    process_text_update()
