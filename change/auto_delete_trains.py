import os
import json
import re

# ================= 設定區 =================
DATA_DIR = "data"

# 如果使用者輸入 ALL，預設涵蓋這些規則車次
RULE_CLASS_0001 = ['6652', '6655', '6629', '6630']
RULE_CLASS_0002 = ['6631', '6632', '6633', '6676', '6677']
ALL_RULE_TRAINS = set(RULE_CLASS_0001 + RULE_CLASS_0002)
# =========================================

def main():
    # 從 GitHub Actions 網頁按鈕接收參數
    target_trains_input = os.environ.get('TARGET_TRAINS', '').strip()
    target_months_input = os.environ.get('TARGET_MONTHS', '').strip()

    if not target_trains_input or not target_months_input:
        print("❌ 錯誤：未提供目標車次或目標月份參數。")
        return

    # 1️⃣ 解析「目標車次」
    if target_trains_input.upper() == 'ALL':
        target_trains = ALL_RULE_TRAINS
    else:
        # 支援用逗號或空格分隔多筆輸入 (例如 "6631, 6632")
        target_trains = set([t.strip() for t in re.split(r'[,\s、]+', target_trains_input) if t.strip()])

    # 2️⃣ 解析「目標月份」
    target_months = []
    if target_months_input.upper() != 'ALL':
        target_months = [m.strip().zfill(2) for m in re.split(r'[,\s、]+', target_months_input) if m.strip()]

    print("==================================================")
    print(f"🎯 目標車次: {', '.join(target_trains)}")
    print(f"📅 目標月份: {', '.join(target_months) if target_months else '所有月份'}")
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
        
        # 檢查檔案是否符合目標月份
        if target_months and len(date_str) == 8:
            file_month = date_str[4:6]
            if file_month not in target_months:
                continue

        filepath = os.path.join(DATA_DIR, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                daily_data = json.load(f)

            affected = 0
            # 處理包含 TrainInfos 的標準結構
            if isinstance(daily_data, dict) and "TrainInfos" in daily_data:
                orig_len = len(daily_data["TrainInfos"])
                daily_data["TrainInfos"] = [t for t in daily_data["TrainInfos"] if str(t.get("TrainNo", t.get("Train"))) not in target_trains]
                affected = orig_len - len(daily_data["TrainInfos"])
                
            # 處理純陣列結構
            elif isinstance(daily_data, list):
                orig_len = len(daily_data)
                daily_data = [t for t in daily_data if str(t.get("TrainNo", t.get("Train"))) not in target_trains]
                affected = orig_len - len(daily_data)

            # 如果有刪除到東西，才進行存檔
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
        print("⚪ 掃描完畢，該月份沒有找到指定的車次資料，無需修改。")

if __name__ == "__main__":
    main()
