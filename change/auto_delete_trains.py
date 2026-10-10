import os
import json
import re

# ================= 設定區 =================
DATA_DIR = "data"

RULE_CLASS_0001 = ['6652', '6655', '6629', '6630']
RULE_CLASS_0002 = ['6631', '6632', '6633', '6676', '6677']
ALL_RULE_TRAINS = set(RULE_CLASS_0001 + RULE_CLASS_0002)
# =========================================

def main():
    target_trains_input = os.environ.get('TARGET_TRAINS', '').strip()
    target_months_input = os.environ.get('TARGET_MONTHS', '').strip()

    if not target_trains_input or not target_months_input:
        print("❌ 錯誤：未提供目標車次或目標月份參數。")
        return

    # 1️⃣ 解析「目標車次」
    if target_trains_input.upper() == 'ALL':
        target_trains = ALL_RULE_TRAINS
    else:
        target_trains = set([t.strip() for t in re.split(r'[,\s、]+', target_trains_input) if t.strip()])

    # 2️⃣ 解析「目標月份/年月」
    target_filters = []
    if target_months_input.upper() != 'ALL':
        target_filters = [m.strip() for m in re.split(r'[,\s、]+', target_months_input) if m.strip()]

    print("==================================================")
    print(f"🎯 目標車次: {', '.join(target_trains)}")
    print(f"📅 目標時間: {', '.join(target_filters) if target_filters else '所有時間'}")
    print("==================================================")

    if not os.path.exists(DATA_DIR):
        print(f"❌ 找不到目標資料夾: {DATA_DIR}")
        return

    total_deleted = 0
    modified_files = []

    print("\n🔍 開始跨日掃描與刪除...\n")

    for filename in sorted(os.listdir(DATA_DIR)):
        if not filename.endswith('.json'):
            continue
        
        date_str = filename.replace('.json', '')
        
        # 🌟 升級版判斷邏輯：支援 6 碼 (YYYYMM) 或 2 碼 (MM)
        if target_filters and len(date_str) == 8:
            matched = False
            for f in target_filters:
                if len(f) == 6 and date_str.startswith(f):
                    matched = True
                    break
                elif len(f) <= 2 and date_str[4:6] == f.zfill(2):
                    matched = True
                    break
            
            if not matched:
                continue

        filepath = os.path.join(DATA_DIR, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                daily_data = json.load(f)

            affected = 0
            if isinstance(daily_data, dict) and "TrainInfos" in daily_data:
                orig_len = len(daily_data["TrainInfos"])
                daily_data["TrainInfos"] = [t for t in daily_data["TrainInfos"] if str(t.get("TrainNo", t.get("Train"))) not in target_trains]
                affected = orig_len - len(daily_data["TrainInfos"])
                
            elif isinstance(daily_data, list):
                orig_len = len(daily_data)
                daily_data = [t for t in daily_data if str(t.get("TrainNo", t.get("Train"))) not in target_trains]
                affected = orig_len - len(daily_data)

            if affected > 0:
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(daily_data, f, ensure_ascii=False, indent=2)
                total_deleted += affected
                modified_files.append(date_str)
                print(f"  🗑️ {date_str}.json: 成功刪除 {affected} 筆")

        except Exception as e:
            print(f"❌ 處理 {filename} 時發生錯誤: {e}")

    print("\n" + "="*50)
    if modified_files:
        print(f"✅ 執行完畢！共從 {len(modified_files)} 個檔案中，總計刪除 {total_deleted} 筆車次資料。")
    else:
        print("⚪ 掃描完畢，沒有找到需要刪除的資料。")

if __name__ == "__main__":
    main()
