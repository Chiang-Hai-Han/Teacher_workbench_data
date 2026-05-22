from __future__ import annotations

import argparse
import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
NEWLINE_RE = re.compile(r"\r\n|\r|\n")
PARAGRAPH_RE = re.compile(r"^\s*(?:<p\b[^>]*>.*?</p>\s*)+\s*$", re.IGNORECASE | re.DOTALL)


@dataclass
class CsvData:
    path: Path
    encoding: str
    dialect: csv.Dialect
    rows: list[list[str]]


def find_csv_file(csv_path: Path | None) -> Path:
    if csv_path is not None:
        path = csv_path.expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"找不到 CSV 文件：{path}")
        return path

    csv_files = sorted(
        path for path in ROOT_DIR.glob("*.csv")
        if not path.name.endswith("_换行已转p.csv")
    )
    if not csv_files:
        raise FileNotFoundError(f"请把 CSV 文件放到这个文件夹里：{ROOT_DIR}")
    return max(csv_files, key=lambda path: path.stat().st_mtime)


def read_csv(csv_path: Path) -> CsvData:
    encodings = ["utf-8-sig", "utf-8", "gb18030", "big5", "utf-16"]
    last_error: Exception | None = None

    for encoding in encodings:
        try:
            text = csv_path.read_text(encoding=encoding)
            sample = text[:4096]
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel

            rows = list(csv.reader(io.StringIO(text), dialect))
            return CsvData(csv_path, encoding, dialect, rows)
        except UnicodeDecodeError as exc:
            last_error = exc

    raise RuntimeError(f"无法读取 CSV 编码：{last_error}")


def needs_normalization(value: str) -> bool:
    return bool(NEWLINE_RE.search(value)) and not PARAGRAPH_RE.match(value)


def normalize_cell(value: str) -> tuple[str, bool]:
    if not needs_normalization(value):
        return value, False

    parts = [part.strip() for part in NEWLINE_RE.split(value)]
    paragraphs = [f"<p>{part}</p>" for part in parts if part]
    return "".join(paragraphs), True


def normalize_rows(rows: list[list[str]]) -> tuple[list[list[str]], int, dict[int, int]]:
    changed_cells = 0
    changed_by_column: dict[int, int] = {}
    normalized_rows: list[list[str]] = []

    for row_number, row in enumerate(rows, start=1):
        normalized_row: list[str] = []
        for column_index, value in enumerate(row):
            normalized_value, changed = normalize_cell(value)
            normalized_row.append(normalized_value)
            if changed and row_number > 1:
                changed_cells += 1
                changed_by_column[column_index] = changed_by_column.get(column_index, 0) + 1
        normalized_rows.append(normalized_row)

    return normalized_rows, changed_cells, changed_by_column


def output_path_for(csv_path: Path) -> Path:
    return csv_path.with_name(f"{csv_path.stem}_换行已转p.csv")


def write_csv(output_path: Path, rows: list[list[str]], dialect: csv.Dialect, encoding: str) -> None:
    output_encoding = "utf-8-sig" if encoding in {"utf-8", "utf-8-sig"} else encoding
    with output_path.open("w", encoding=output_encoding, newline="") as file:
        writer = csv.writer(
            file,
            delimiter=dialect.delimiter,
            quotechar=dialect.quotechar or '"',
            lineterminator="\r\n",
            quoting=csv.QUOTE_MINIMAL,
        )
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="把 CSV 单元格中的真实换行统一转换成 <p>...</p>。")
    parser.add_argument("--csv", type=Path, default=None, help="CSV 文件路径；不填则自动读取程序同目录下最新的 CSV")
    parser.add_argument("--output", type=Path, default=None, help="输出 CSV 路径")
    parser.add_argument("--check-only", action="store_true", help="只检查，不生成新 CSV")
    args = parser.parse_args()

    csv_path = find_csv_file(args.csv)
    data = read_csv(csv_path)
    normalized_rows, changed_cells, changed_by_column = normalize_rows(data.rows)
    output_path = args.output.expanduser().resolve() if args.output else output_path_for(csv_path)

    headers = data.rows[0] if data.rows else []
    print(f"正在读取：{csv_path}")
    print(f"识别编码：{data.encoding}")
    print(f"识别分隔符：{repr(data.dialect.delimiter)}")
    print(f"总行数：{max(len(data.rows) - 1, 0)}")
    print(f"需要转换的单元格：{changed_cells}")

    if changed_by_column:
        print()
        print("涉及列：")
        for column_index, count in sorted(changed_by_column.items()):
            column_name = headers[column_index] if column_index < len(headers) else f"第 {column_index + 1} 列"
            print(f"  - {column_name}：{count} 个单元格")

    print()
    if args.check_only:
        print("检查完成，未生成新 CSV。")
        return 0

    write_csv(output_path, normalized_rows, data.dialect, data.encoding)
    print(f"已生成：{output_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n已取消。")
        raise SystemExit(130)
    except Exception as exc:
        print(f"出错：{exc}")
        raise SystemExit(1)
