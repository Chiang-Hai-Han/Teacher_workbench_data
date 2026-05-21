from __future__ import annotations

import argparse
import csv
import mimetypes
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT_DIR / "下载的课程封面"
COVER_COLUMN = "列表_课程封面"
CODE_COLUMN_NAMES = ["列表_课件代码", "课件代码", "详情_课件代码", "详情_课件编码", "课件编码"]
INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def find_csv_file(csv_path: Path | None) -> Path:
    if csv_path is not None:
        path = csv_path.expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"找不到 CSV 文件：{path}")
        return path

    csv_files = sorted(ROOT_DIR.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"请把 CSV 文件放到这个文件夹里：{ROOT_DIR}")
    return max(csv_files, key=lambda path: path.stat().st_mtime)


def read_csv_rows(csv_path: Path) -> tuple[list[str], list[dict[str, str]]]:
    encodings = ["utf-8-sig", "utf-8", "gb18030", "big5"]
    last_error: Exception | None = None

    for encoding in encodings:
        try:
            with csv_path.open("r", encoding=encoding, newline="") as file:
                sample = file.read(4096)
                file.seek(0)
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
                reader = csv.DictReader(file, dialect=dialect)
                headers = [normalize_header(header or "") for header in (reader.fieldnames or [])]
                rows: list[dict[str, str]] = []
                for row in reader:
                    rows.append({
                        normalize_header(key or ""): (value or "").strip()
                        for key, value in row.items()
                    })
                return headers, rows
        except UnicodeDecodeError as exc:
            last_error = exc
        except csv.Error:
            try:
                with csv_path.open("r", encoding=encoding, newline="") as file:
                    reader = csv.DictReader(file)
                    headers = [normalize_header(header or "") for header in (reader.fieldnames or [])]
                    rows = []
                    for row in reader:
                        rows.append({
                            normalize_header(key or ""): (value or "").strip()
                            for key, value in row.items()
                        })
                    return headers, rows
            except UnicodeDecodeError as exc:
                last_error = exc

    raise RuntimeError(f"无法读取 CSV 编码：{last_error}")


def normalize_header(value: str) -> str:
    return value.replace("\ufeff", "").strip()


def find_column(headers: list[str], exact_names: list[str], fallback_keywords: list[str]) -> str:
    for name in exact_names:
        if name in headers:
            return name

    for keyword in fallback_keywords:
        for header in headers:
            if keyword in header:
                return header

    raise RuntimeError(f"找不到需要的列。当前列名：{', '.join(headers)}")


def safe_filename(value: str) -> str:
    cleaned = INVALID_FILENAME_CHARS.sub("_", value.strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:120] or "未命名课件"


def extension_from_response(url: str, response: urllib.response.addinfourl) -> str:
    url_path = urllib.parse.urlparse(url).path
    suffix = Path(urllib.parse.unquote(url_path)).suffix
    if suffix and len(suffix) <= 8:
        return suffix

    content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    guessed = mimetypes.guess_extension(content_type)
    if guessed == ".jpe":
        return ".jpg"
    return guessed or ".jpg"


def normalize_url(url: str) -> str:
    url = url.strip()
    if url.startswith("//"):
        return "https:" + url
    if url and not urllib.parse.urlparse(url).scheme:
        return "https://" + url
    return url


def unique_path(output_dir: Path, stem: str, suffix: str) -> Path:
    path = output_dir / f"{stem}{suffix}"
    if not path.exists():
        return path

    counter = 2
    while True:
        path = output_dir / f"{stem}_{counter}{suffix}"
        if not path.exists():
            return path
        counter += 1


def download_image(url: str, output_dir: Path, course_code: str, timeout: int, retries: int) -> Path:
    request = urllib.request.Request(
        normalize_url(url),
        headers={
            "User-Agent": "Mozilla/5.0 course-cover-downloader",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    )

    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                suffix = extension_from_response(url, response)
                output_path = unique_path(output_dir, safe_filename(course_code), suffix)
                output_path.write_bytes(response.read())
                return output_path
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(1.5)

    raise RuntimeError(str(last_error) if last_error else "下载失败")


def main() -> int:
    parser = argparse.ArgumentParser(description="下载 CSV 表格中的课程封面图片。")
    parser.add_argument("--csv", type=Path, default=None, help="CSV 文件路径；不填则自动读取程序同目录下唯一的 CSV")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="图片保存文件夹")
    parser.add_argument("--timeout", type=int, default=25, help="单张图片下载超时时间，单位秒")
    parser.add_argument("--retries", type=int, default=2, help="失败后的重试次数")
    parser.add_argument("--check-only", action="store_true", help="只检查 CSV，不下载图片")
    args = parser.parse_args()

    csv_path = find_csv_file(args.csv)
    output_dir = args.output.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    headers, rows = read_csv_rows(csv_path)
    code_column = find_column(headers, CODE_COLUMN_NAMES, ["课件代码", "课件编码"])
    cover_column = find_column(headers, [COVER_COLUMN, "课程封面"], ["课程封面"])

    print(f"正在读取：{csv_path}")
    print(f"识别到 {len(headers)} 列：{', '.join(headers)}")
    print(f"命名列：{code_column}")
    print(f"图片 URL 列：{cover_column}")
    print(f"图片保存到：{output_dir}")
    print()

    downloadable = sum(1 for row in rows if row.get(code_column, "").strip() and row.get(cover_column, "").strip())
    if args.check_only:
        print(f"检查完成：找到 {len(rows)} 行数据，其中 {downloadable} 行同时有课件代码和图片 URL。")
        return 0

    success = 0
    skipped = 0
    failed = 0

    for row_number, row in enumerate(rows, start=2):
        course_code = row.get(code_column, "").strip()
        cover_url = row.get(cover_column, "").strip()

        if not course_code or not cover_url:
            skipped += 1
            continue

        try:
            output_path = download_image(cover_url, output_dir, course_code, args.timeout, args.retries)
            success += 1
            print(f"[成功] 第 {row_number} 行 -> {output_path.name}")
        except Exception as exc:
            failed += 1
            print(f"[失败] 第 {row_number} 行，课件代码 {course_code}：{exc}")

    print()
    print(f"完成：成功 {success} 张，跳过 {skipped} 行，失败 {failed} 张。")
    if failed:
        print("失败的图片可以稍后重新运行程序，已下载成功的文件不会被删除。")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n已取消。")
        raise SystemExit(130)
    except Exception as exc:
        print(f"出错：{exc}")
        raise SystemExit(1)
