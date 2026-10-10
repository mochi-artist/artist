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

    tz_tw = timezone(timedelta(hours=8))
    now = datetime.now(tz_tw)
    current_month = now.month
    current_day = now.day

    # ==========================================
    # 🌟 接收 YAML 傳來的環境變數
    # ==========================================
    event_name = os.environ.get('EVENT_NAME', '')
    sim_15 = os.environ.get('SIMULATE_15TH', 'false').lower() == 'true'
    sim_push = os.environ.get('SIMULATE_PUSH', 'false').lower() == 'true'

    # 判斷是否為總表更新
    is_push = (event_name == 'push') or sim_push
    # 判斷是否過了 15 號 (或手動模擬 15 號)
    is_15th_or_later = (current_day >= 15) or sim_15

    target_tasks = [] 

    # 🎯 條件 1：總表有變動，才需要更新「這個月 (今天 ~ 月底)」
    if is_push:
        print(f"🔄 總表更新模式：產出 {current_month} 月 {current_day} 號到月底的資料。")
        target_tasks.append((current_month, current_day))

    # 🎯 條件 2：到了 15 號以後，就產出「下個月 (1號 ~ 月底)」
    if is_15th_or_later:
        if current_month == 12:
            print("⚠️ 警告：今天已是 12/15 之後。暫停輸出明年 1 月資料！")
        else:
            print(f"📅 15號觸發模式：產出下個月 ({current_month + 1} 月) 1 號到月底的資料。")
            target_tasks.append((current_month + 1, 1))

    # 如果兩個條件都沒達成，代表今天是平日且總表沒改，直接休息
    if not target_tasks:
        print("💤 今天不是 15 號，總表也沒有更新，無需執行任何打包動作。")
        return

    print("==================================================")
    print(f"🚀 自動打包開始 | 認知今日: {current_month}/{current_day}")
    print("==================================================")

    for m, start_d in target_tasks:
        generate_for_month(m, train_infos, start_day=start_d)

    print("==================================================")
    print("🎉 打包更新作業已全數完成！")

if __name__ == "__main__":
    main()
