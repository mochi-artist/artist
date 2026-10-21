import os
import json
import re

# ================= 設定區 =================
DATA_DIR = "data"
PENDING_FILE = "pending_trains.json"

RULE_CLASS_0001 = ['6652', '6655', '6629', '6630']
RULE_CLASS_0002 = ['6631', '6632', '6633', '6676', '6677']
ALL_RULE_TRAINS = set(RULE_CLASS_0001 + RULE_CLASS_0002)
# =========================================

def is_date_matched(date_str, target_filters):
    """
    🌟 整合版日期比對邏輯，同時支援：
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

def main():
    target_trains_input = os.environ.get('TARGET_TRAINS', '').strip()
    target_months_input = os.environ.get('TARGET_MONTHS', '').strip()

    if not target_trains_input or not target_months_input:
        print("❌ 錯誤：未提供目標車次或目標時間參數。")
        return

    # 1️⃣ 解析「目標車次」
    if target_trains_input.upper() == 'ALL':
        target_trains = ALL_RULE_TRAINS
    else:
        target_trains = set([t.strip() for t in re.split(r'[,\s，、]+', target_trains_input) if t.strip()])

    # 2️⃣ 解析「目標日期/月份/年月」
    target_filters = []
    if target_months_input.upper() != 'ALL':
        target_filters = [m.strip() for m in re.split(r'[,\s，、]+', target_months_input) if m.strip()]

    print("==================================================")
    print(f"🎯 目標車次: {', '.join(sorted(target_trains))}")
    print(f"📅 目標時間: {', '.join(target_filters) if target_filters else '所有時間 (ALL)'}")
    print("==================================================")

    if not os.path.exists(DATA_DIR):
        print(f"❌ 找不到目標資料夾: {DATA_DIR}")
        return

    total_deleted = 0
    modified_files = []

    print("\n🔍 開始跨日掃描與刪除 (支援 8碼日期 / 6碼年月 / 4碼月日 / 2碼月份)...\n")

    # 3️⃣ 掃描並刪除 data/ 目錄下的 JSON 檔案
    for filename in sorted(os.listdir(DATA_DIR)):
        if not filename.endswith('.json'):
            continue
        
        date_str = filename.replace('.json', '')
        
        # 使用合併後的比對函式
        if not is_date_matched(date_str, target_filters):
            continue

        filepath = os.path.join(DATA_DIR, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                daily_data = json.load(f)

            affected = 0
            if isinstance(daily_data, dict) and "TrainInfos" in daily_data:
                orig_len = len(daily_data["TrainInfos"])
                daily_data["TrainInfos"] = [
                    t for t in daily_data["TrainInfos"]
                    if str(t.get("TrainNo", t.get("Train", ""))).strip() not in target_trains
                ]
                affected = orig_len - len(daily_data["TrainInfos"])
                
            elif isinstance(daily_data, list):
                orig_len = len(daily_data)
                daily_data = [
                    t for t in daily_data
                    if str(t.get("TrainNo", t.get("Train", ""))).strip() not in target_trains
                ]
                affected = orig_len - len(daily_data)

            if affected > 0:
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(daily_data, f, ensure_ascii=False, indent=2)
                total_deleted += affected
                modified_files.append(date_str)
                print(f"  🗑️ {date_str}.json: 成功刪除 {affected} 筆")

        except Exception as e:
            print(f"❌ 處理 {filename} 時發生錯誤: {e}")

    # 4️⃣ 同步檢查並刪除 pending_trains.json 內的暫存車次
    if os.path.exists(PENDING_FILE):
        try:
            with open(PENDING_FILE, 'r', encoding='utf-8') as f:
                pending_data = json.load(f)
            pending_changed = False
            for d_str in list(pending_data.keys()):
                if not is_date_matched(d_str, target_filters):
                    continue
                orig_p_len = len(pending_data[d_str])
                pending_data[d_str] = [
                    t for t in pending_data[d_str]
                    if str(t.get("TrainNo", t.get("Train", ""))).strip() not in target_trains
                ]
                p_affected = orig_p_len - len(pending_data[d_str])
                if p_affected > 0:
                    total_deleted += p_affected
                    pending_changed = True
                    modified_files.append(f"pending:{d_str}")
                    print(f"  🗑️ pending_trains.json ({d_str}): 成功刪除 {p_affected} 筆")
                if not pending_data[d_str]:
                    del pending_data[d_str]

            if pending_changed:
                with open(PENDING_FILE, 'w', encoding='utf-8') as f:
                    json.dump(pending_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"❌ 處理 {PENDING_FILE} 時發生錯誤: {e}")

    print("\n" + "="*50)
    if modified_files:
        print(f"✅ 執行完畢！共從 {len(modified_files)} 個項目中，總計刪除 {total_deleted} 筆車次資料。")
    else:
        print("⚪ 掃描完畢，沒有找到需要刪除的資料。")

if __name__ == "__main__":
    main()
