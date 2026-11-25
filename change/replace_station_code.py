import re
from pathlib import Path

# ==========================================
# 🌟 批次對應表設定區（留空 {} 則執行時由終端機手動輸入）
# 格式："原本的車站代碼": "新的 4 位數代碼"
# 範例：{"1045": "1046", "1001": "1000"}
# ==========================================
STATION_MAP = {
    # "1045": "1046",
}

# 自動定位專案根目錄（不管從根目錄或 change/ 內執行都能正確找到 data 與 data all）
ROOT_DIR = Path(__file__).resolve().parent.parent

# 精準比對 JSON 內的 "Station": "xxxx"，不會誤改車次(Train)或其他欄位
STATION_PATTERN = re.compile(r'("Station"\s*:\s*")([^"]+)(")')


def choose_target_folders() -> list[Path]:
    print("請選擇要修改的資料夾：")
    print("  1. 只改 data")
    print("  2. 只改 data all")
    print("  3. data 與 data all 全部修改")

    choice = input("請輸入選項 (1/2/3)：").strip()
    folder_names = {
        "1": ["data"],
        "2": ["data all"],
        "3": ["data", "data all"],
    }.get(choice)

    if not folder_names:
        print("❌ 無效選項，已取消。")
        return []

    folders = []
    for name in folder_names:
        path = ROOT_DIR / name
        if path.is_dir():
            folders.append(path)
        else:
            print(f"⚠️ 找不到資料夾：{path}")
    return folders


def get_mapping() -> dict[str, str]:
    # 若上方 STATION_MAP 已填寫，直接採用批次對應表
    cleaned_map = {
        str(k).strip(): str(v).strip()
        for k, v in STATION_MAP.items()
        if str(k).strip() and str(v).strip() and str(k).strip() != str(v).strip()
    }

    if cleaned_map:
        for old_code, new_code in cleaned_map.items():
            if not re.fullmatch(r"\d{4}", new_code):
                print(f"❌ 錯誤：新代碼 '{new_code}' 不是 4 位數字（對應舊代碼 {old_code}）。")
                return {}
        return cleaned_map

    # 若 STATION_MAP 為空，改由終端機互動輸入
    old_code = input("請輸入要替換的舊車站代碼 (xxxx)：").strip()
    new_code = input("請輸入新的 4 位數車站代碼：").strip()

    if not old_code:
        print("❌ 舊車站代碼不可為空。")
        return {}
    if not re.fullmatch(r"\d{4}", new_code):
        print("❌ 新車站代碼必須剛好是 4 位數字。")
        return {}
    if old_code == new_code:
        print("⚠️ 新舊代碼相同，無需修改。")
        return {}

    return {old_code: new_code}


def replace_in_text(text: str, mapping: dict[str, str]) -> tuple[str, int]:
    count = 0

    def _repl(match: re.Match) -> str:
        nonlocal count
        old_code = match.group(2)
        if old_code in mapping:
            count += 1
            return f"{match.group(1)}{mapping[old_code]}{match.group(3)}"
        return match.group(0)

    new_text = STATION_PATTERN.sub(_repl, text)
    return new_text, count


def main() -> None:
    print(f"📂 專案根目錄：{ROOT_DIR}\n")

    folders = choose_target_folders()
    if not folders:
        return

    mapping = get_mapping()
    if not mapping:
        return

    print("\n🔎 準備執行的代碼轉換：")
    for k, v in mapping.items():
        print(f"   \"Station\": \"{k}\"  ➔  \"Station\": \"{v}\"")

    # 1. 先掃描預覽，確認會影響哪些檔案與筆數
    matched_files: list[tuple[Path, int]] = []
    total_hits = 0

    for folder in folders:
        for json_path in sorted(folder.rglob("*.json")):
            try:
                text = json_path.read_text(encoding="utf-8-sig")
            except Exception as e:
                print(f"⚠️ 讀取失敗，已跳過 {json_path.relative_to(ROOT_DIR)}：{e}")
                continue

            _, count = replace_in_text(text, mapping)
            if count > 0:
                matched_files.append((json_path, count))
                total_hits += count

    if not matched_files:
        print("\n✅ 掃描完成：沒有找到任何符合的 \"Station\" 代碼，未修改任何檔案。")
        return

    print(f"\n📋 預覽結果：共 {len(matched_files)} 個檔案、{total_hits} 筆 \"Station\" 將被修改：")
    for json_path, count in matched_files[:20]:
        print(f"   - {json_path.relative_to(ROOT_DIR)}（{count} 筆）")
    if len(matched_files) > 20:
        print(f"   ... 另有 {len(matched_files) - 20} 個檔案")

    # 2. 確認後才正式寫入
    confirm = input("\n確定要寫入修改嗎？(y/n)：").strip().lower()
    if confirm != "y":
        print("🚫 已取消，未更動任何檔案。")
        return

    updated_files = 0
    for json_path, _ in matched_files:
        text = json_path.read_text(encoding="utf-8-sig")
        new_text, count = replace_in_text(text, mapping)
        if count > 0:
            json_path.write_text(new_text, encoding="utf-8")
            updated_files += 1

    print(f"\n✅ 完成！已更新 {updated_files} 個 JSON 檔案，共替換 {total_hits} 筆車站代碼。")


if __name__ == "__main__":
    main()
