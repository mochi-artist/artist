import argparse
import re
import sys
from pathlib import Path

# ==========================================
# 🌟 批次對應表設定區（留空 {} 時由參數或終端機輸入）
# 格式："原本的車站代碼": "新的 4 位數代碼"
# 範例：{"1045": "1046", "1001": "1000"}
# ==========================================
STATION_MAP = {
    # "1045": "1046",
}

ROOT_DIR = Path(__file__).resolve().parent.parent
STATION_PATTERN = re.compile(r'("Station"\s*:\s*")([^"]+)(")')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="批次替換 data / data all 內的 Station 代碼")
    parser.add_argument("--target", choices=["data", "data all", "all"], help="目標資料夾")
    parser.add_argument("--old", dest="old_code", default="", help="要替換的舊車站代碼")
    parser.add_argument("--new", dest="new_code", default="", help="新的 4 位數車站代碼")
    parser.add_argument("--yes", action="store_true", help="跳過確認直接寫入（GitHub Actions 用）")
    parser.add_argument("--dry-run", action="store_true", help="僅預覽不實際寫入")
    return parser.parse_args()


def resolve_folders(target: str | None) -> list[Path]:
    if target is None:
        print("請選擇要修改的資料夾：")
        print("  1. 只改 data")
        print("  2. 只改 data all")
        print("  3. data 與 data all 全部修改")
        choice = input("請輸入選項 (1/2/3)：").strip()
        target = {"1": "data", "2": "data all", "3": "all"}.get(choice)
        if not target:
            print("❌ 無效選項，已取消。")
            return []

    folder_names = ["data", "data all"] if target == "all" else [target]
    folders = []
    for name in folder_names:
        path = ROOT_DIR / name
        if path.is_dir():
            folders.append(path)
        else:
            print(f"⚠️ 找不到資料夾：{path}")
    return folders


def resolve_mapping(args: argparse.Namespace) -> dict[str, str]:
    old_arg = args.old_code.strip()
    new_arg = args.new_code.strip()

    # 1. 若透過參數（如 Actions 表單）傳入新舊代碼，優先使用參數
    if old_arg or new_arg:
        if not old_arg or not new_arg:
            print("❌ 錯誤：old_code 與 new_code 必須同時填寫，或同時留空以使用 STATION_MAP。")
            sys.exit(1)
        if not re.fullmatch(r"\d{4}", new_arg):
            print(f"❌ 錯誤：新代碼 '{new_arg}' 必須剛好是 4 位數字。")
            sys.exit(1)
        if old_arg == new_arg:
            print("⚠️ 新舊代碼相同，無需修改。")
            return {}
        return {old_arg: new_arg}

    # 2. 若未傳入代碼參數，檢查檔案上方的 STATION_MAP
    cleaned_map = {
        str(k).strip(): str(v).strip()
        for k, v in STATION_MAP.items()
        if str(k).strip() and str(v).strip() and str(k).strip() != str(v).strip()
    }
    if cleaned_map:
        for old_code, new_code in cleaned_map.items():
            if not re.fullmatch(r"\d{4}", new_code):
                print(f"❌ 錯誤：STATION_MAP 的新代碼 '{new_code}' 不是 4 位數字（對應 {old_code}）。")
                sys.exit(1)
        return cleaned_map

    # 3. 若在 Actions 自動模式下既無參數又無 STATION_MAP，直接報錯結束
    if args.yes or args.dry_run:
        print("❌ 錯誤：未輸入 old_code / new_code，且腳本內的 STATION_MAP 也為空。")
        sys.exit(1)

    # 4. 本機互動模式
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

    return STATION_PATTERN.sub(_repl, text), count


def main() -> None:
    args = parse_args()
    print(f"📂 專案根目錄：{ROOT_DIR}\n")

    folders = resolve_folders(args.target)
    if not folders:
        sys.exit(1)

    mapping = resolve_mapping(args)
    if not mapping:
        return

    print("🔎 準備執行的代碼轉換：")
    for k, v in mapping.items():
        print(f'   "Station": "{k}"  ➔  "Station": "{v}"')

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
        print('\n✅ 掃描完成：沒有找到任何符合的 "Station" 代碼，未修改任何檔案。')
        return

    print(f'\n📋 預覽結果：共 {len(matched_files)} 個檔案、{total_hits} 筆 "Station" 將被修改：')
    for json_path, count in matched_files[:30]:
        print(f"   - {json_path.relative_to(ROOT_DIR)}（{count} 筆）")
    if len(matched_files) > 30:
        print(f"   ... 另有 {len(matched_files) - 30} 個檔案")

    if args.dry_run:
        print("\n🧪 Dry-run 預覽模式結束，未寫入任何檔案。")
        return

    if not args.yes:
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
