import json
import os
import calendar
import copy
from datetime import datetime, timezone, timedelta

# ==========================================
# ▼▼▼ 使用者設定區 ▼▼▼
# ==========================================
INPUT_FILENAME = 'final_train_diagram.json'
OUTPUT_DIR = 'data'

YEAR = 2026

HOLIDAYS_LIST = {
    '20260101',
    '20260216','20260217', '20260218','20260219', '20260220','20260227',
    '20260403','20260406',
    '20260501',
    '20260619',
    '20260925','20260928',
    '20261009','20261026',
    '20261225'
}
# ==========================================

# 🌟 參數新增 start_day，決定從哪一天開始「存檔」
def generate_for_month(target_month, train_infos, start_day=1):
    days_count = calendar.monthrange(YEAR, target_month)[1]
    start_weekday_idx = calendar.monthrange(YEAR, target_month)[0]

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    char_to_weekday = {'一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6}
    carry_over_trains = [] 

    print(f"\n⏳ 運算 {YEAR} 年 {target_month:02d} 月份資料 (將從 {start_day} 號開始寫入檔案)...")

    # 💡 迴圈依然從 1 號開始跑，確保昨天的跨夜車能順利傳遞給今天
    for d in range(1, days_count + 1):
        date_str = f"{YEAR}{target_month:02d}{d:02d}"
        current_weekday = (start_weekday_idx + (d - 1)) % 7
        is_holiday = date_str in HOLIDAYS_LIST

        daily_trains = list(carry_over_trains)
        carry_over_trains = [] 

        for train in train_infos:
            note = train.get('Note', '')
            has_run, has_stop = '駛' in note, '停' in note
            has_daily, has_holiday_kw = '每日' in note, '例' in note

            mentioned_days = {idx for char, idx in char_to_weekday.items() if char in note}

            should_run = True
            if not has_daily:
                if has_run:
                    should_run = (current_weekday in mentioned_days) or (is_holiday and has_holiday_kw)
                elif has_stop:
                    should_run = not ((current_weekday in mentioned_days) or (is_holiday and has_holiday_kw))

            if should_run:
                time_infos = train.get('TimeInfos', [])

                has_01_time = False
                idx_04_time = -1

                for i, t in enumerate(time_infos):
                    arr = str(t.get('ARRTime', '')).strip()
                    dep = str(t.get('DEPTime', '')).strip()
                    if arr.startswith('01:') or dep.startswith('01:'):
                        has_01_time = True
                    if idx_04_time == -1 and (arr.startswith('04:') or dep.startswith('04:')):
                        idx_04_time = i

                if has_01_time and idx_04_time != -1:
                    train_today = copy.deepcopy(train)
                    train_tomorrow = copy.deepcopy(train)

                    daily_trains.append(train_today)
                    tomorrow_infos = train_tomorrow['TimeInfos'][idx_04_time:]

                    if len(tomorrow_infos) > 1:
                        for i, t in enumerate(tomorrow_infos):
                            t['Order'] = str(i + 1)
                        train_tomorrow['TimeInfos'] = tomorrow_infos
                        carry_over_trains.append(train_tomorrow)
                else:
                    daily_trains.append(train)

        if target_month == 10:
            filtered_daily_trains = []
            for t_info in daily_trains:
                has_1105 = any(t.get('Station') == '1105' for t in t_info.get('TimeInfos', []))
                has_4240 = any(t.get('Station') == '4240' for t in t_info.get('TimeInfos', []))

                need_filter_1105 = has_1105 and (1 <= d <= 2)
                need_filter_4240 = has_4240 and (1 <= d <= 16)

                if need_filter_1105 or need_filter_4240:
                    new_t_info = copy.deepcopy(t_info)
                    if need_filter_1105:
                        new_t_info['TimeInfos'] = [t for t in new_t_info['TimeInfos'] if t.get('Station') != '1105']
                    if need_filter_4240:
                        new_t_info['TimeInfos'] = [t for t in new_t_info['TimeInfos'] if t.get('Station') != '4240']

                    if len(new_t_info['TimeInfos']) > 0:
                        filtered_daily_trains.append(new_t_info)
                else:
                    filtered_daily_trains.append(t_info)
            daily_trains = filtered_daily_trains

        # 🌟 核心修改：只有當天日期 >= 設定的起點 (當日) 時，才執行存檔動作！
        if d >= start_day:
            output_path = os.path.join(OUTPUT_DIR, f"{date_str}.json")
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump({"TrainInfos": daily_trains}, f, ensure_ascii=False, indent=2)

    print(f"✅ {YEAR} 年 {target_month:02d} 月份 (自 {start_day} 號起) 更新完成！")

def main():
    if not os.path.exists(INPUT_FILENAME):
        print(f"❌ 錯誤：找不到基準總表 {INPUT_FILENAME}！請確認檔案位置。")
        return

    with open(INPUT_FILENAME, 'r', encoding='utf-8') as f:
        data = json.load(f)
    train_infos = data.get('TrainInfos', [])
    if not train_infos:
        print("❌ 錯誤：基準總表中沒有 TrainInfos 資料。")
        return

    # 🌟 讀取 GitHub Actions 傳過來的手動輸入數值
    force_month_env = os.environ.get('FORCE_MONTH', '').strip()

    tz_tw = timezone(timedelta(hours=8))
    now = datetime.now(tz_tw)
    current_month = now.month
    current_day = now.day

    if force_month_env and force_month_env.isdigit():
        # ==========================================
        # 🔧 手動強制產出模式 (你從網頁按按鈕指定的月份)
        # ==========================================
        force_m = int(force_month_env)
        print("==================================================")
        print(f"🔧 手動強制模式觸發 | 指定產出月份：{force_m} 月")
        print("==================================================")
        generate_for_month(force_m, train_infos, start_day=1) # 強制產出一整個月
    else:
        # ==========================================
        # 🤖 原本的自動排程模式 (每天自動跑的邏輯)
        # ==========================================
        target_months = [current_month]

        if current_day >= 15:
            if current_month == 12:
                print("⚠️ 警告：今天已是 12/15 之後。暫停輸出明年 1 月資料！")
            else:
                target_months.append(current_month + 1)

        print("==================================================")
        print(f"🚀 自動打包開始 | 今日: {current_month}/{current_day} | 目標月份: {target_months}")
        print("==================================================")

        for m in target_months:
            start_d = current_day if m == current_month else 1
            generate_for_month(m, train_infos, start_day=start_d)

    print("==================================================")
    print("🎉 打包更新作業已全數完成！")

if __name__ == "__main__":
    main()
