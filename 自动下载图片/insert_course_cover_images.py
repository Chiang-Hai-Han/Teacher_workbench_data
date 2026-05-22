from __future__ import annotations

import argparse
import csv
import html
import io
import posixpath
import re
import shutil
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_IMAGE_DIR = ROOT_DIR / "下载的课程封面"
OUTPUT_COLUMN = "课程封面图片"
CODE_COLUMN_NAMES = ["列表_课件代码", "课件代码", "详情_课件代码", "详情_课件编码", "课件编码"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp"}
EMU_PER_PIXEL = 9525
MAX_IMAGE_WIDTH = 150
MAX_IMAGE_HEIGHT = 110
INVALID_XML_CHARS = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1f]"
)


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


def read_csv_rows(csv_path: Path) -> tuple[list[str], list[list[str]]]:
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
            if rows:
                headers = [normalize_header(value) for value in rows[0]]
                return headers, rows[1:]
        except UnicodeDecodeError as exc:
            last_error = exc

    raise RuntimeError(f"无法读取 CSV 编码：{last_error}")


def normalize_header(value: str) -> str:
    return value.replace("\ufeff", "").strip()


def find_column_index(headers: list[str], exact_names: list[str], fallback_keywords: list[str]) -> int:
    for name in exact_names:
        if name in headers:
            return headers.index(name)

    for keyword in fallback_keywords:
        for index, header in enumerate(headers):
            if keyword in header:
                return index

    raise RuntimeError(f"找不到需要的列。当前列名：{', '.join(headers)}")


def excel_column_name(index: int) -> str:
    index += 1
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def clean_xml_text(value: object) -> str:
    text = "" if value is None else str(value)
    return INVALID_XML_CHARS.sub("", text)


def xml_text(value: object) -> str:
    return escape(clean_xml_text(value), {'"': "&quot;"})


def build_image_index(image_dir: Path) -> dict[str, Path]:
    if not image_dir.exists():
        raise FileNotFoundError(f"找不到图片文件夹：{image_dir}")

    index: dict[str, Path] = {}
    for image_path in sorted(image_dir.iterdir()):
        if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
            index.setdefault(image_path.stem.lower(), image_path)
    return index


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(b"\xff\xd8"):
        return None

    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        i += 2
        if marker in {0xD8, 0xD9}:
            continue
        if i + 2 > len(data):
            return None
        length = int.from_bytes(data[i : i + 2], "big")
        if length < 2 or i + length > len(data):
            return None
        if marker in {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }:
            height = int.from_bytes(data[i + 3 : i + 5], "big")
            width = int.from_bytes(data[i + 5 : i + 7], "big")
            return width, height
        i += length
    return None


def png_size(data: bytes) -> tuple[int, int] | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        width = int.from_bytes(data[16:20], "big")
        height = int.from_bytes(data[20:24], "big")
        return width, height
    return None


def image_size(image_path: Path) -> tuple[int, int]:
    data = image_path.read_bytes()[:65536]
    size = png_size(data) or jpeg_size(data)
    return size or (MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT)


def scaled_size(image_path: Path) -> tuple[int, int]:
    width, height = image_size(image_path)
    scale = min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1)
    return max(1, int(width * scale)), max(1, int(height * scale))


def content_type(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".gif":
        return "image/gif"
    if suffix == ".bmp":
        return "image/bmp"
    return "application/octet-stream"


def normalize_rows(headers: list[str], rows: list[list[str]]) -> tuple[list[str], list[list[str]], int]:
    headers = [normalize_header(header) for header in headers]
    if OUTPUT_COLUMN in headers:
        output_index = headers.index(OUTPUT_COLUMN)
    else:
        headers.append(OUTPUT_COLUMN)
        output_index = len(headers) - 1

    normalized: list[list[str]] = []
    for row in rows:
        values = list(row)
        if len(values) < len(headers):
            values.extend([""] * (len(headers) - len(values)))
        elif len(values) > len(headers):
            values = values[: len(headers)]
        values[output_index] = ""
        normalized.append(values)

    return headers, normalized, output_index


def write_xlsx(
    output_path: Path,
    headers: list[str],
    rows: list[list[str]],
    image_matches: dict[int, Path],
    image_col_index: int,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_media: list[tuple[Path, str, str]] = []

    for image_number, image_path in enumerate(image_matches.values(), start=1):
        suffix = image_path.suffix.lower()
        if suffix == ".jpeg":
            suffix = ".jpg"
        media_name = f"image{image_number}{suffix}"
        temp_media.append((image_path, media_name, content_type(image_path)))

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as book:
        write_content_types(book, temp_media)
        book.writestr("_rels/.rels", package_rels_xml())
        book.writestr("xl/workbook.xml", workbook_xml())
        book.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml())
        book.writestr("xl/styles.xml", styles_xml())
        book.writestr("xl/worksheets/sheet1.xml", worksheet_xml(headers, rows, image_col_index, bool(image_matches)))
        if image_matches:
            book.writestr("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels_xml())
            book.writestr("xl/drawings/drawing1.xml", drawing_xml(image_matches, image_col_index))
            book.writestr("xl/drawings/_rels/drawing1.xml.rels", drawing_rels_xml(temp_media))
            for image_path, media_name, _ctype in temp_media:
                book.write(image_path, f"xl/media/{media_name}")


def write_content_types(book: zipfile.ZipFile, media: list[tuple[Path, str, str]]) -> None:
    defaults = {
        "rels": "application/vnd.openxmlformats-package.relationships+xml",
        "xml": "application/xml",
    }
    for _path, media_name, ctype in media:
        defaults[Path(media_name).suffix.lower().lstrip(".")] = ctype

    default_xml = "\n".join(
        f'  <Default Extension="{xml_text(ext)}" ContentType="{xml_text(ctype)}"/>'
        for ext, ctype in sorted(defaults.items())
    )
    drawing_override = ""
    if media:
        drawing_override = (
            '\n  <Override PartName="/xl/drawings/drawing1.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
        )
    book.writestr(
        "[Content_Types].xml",
        f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
{default_xml}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>{drawing_override}
</Types>''',
    )


def package_rels_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''


def workbook_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="课程数据" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>'''


def workbook_rels_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''


def styles_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''


def worksheet_xml(headers: list[str], rows: list[list[str]], image_col_index: int, has_images: bool) -> str:
    column_xml = []
    for index in range(len(headers)):
        width = 22
        if index == image_col_index:
            width = 24
        column_xml.append(f'<col min="{index + 1}" max="{index + 1}" width="{width}" customWidth="1"/>')

    row_xml = [row_xml_line(1, headers, style=1)]
    for row_number, row in enumerate(rows, start=2):
        height = MAX_IMAGE_HEIGHT * 0.75 if has_images else 18
        row_xml.append(row_xml_line(row_number, row, style=2, height=height))

    drawing = '<drawing r:id="rId1"/>' if has_images else ""
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>{''.join(column_xml)}</cols>
  <sheetData>{''.join(row_xml)}</sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
  {drawing}
</worksheet>'''


def row_xml_line(row_number: int, values: list[str], style: int, height: float | None = None) -> str:
    height_attr = f' ht="{height:.2f}" customHeight="1"' if height else ""
    cells = []
    for col_index, value in enumerate(values):
        cell_ref = f"{excel_column_name(col_index)}{row_number}"
        text = clean_xml_text(value)
        if len(text) > 32767:
            text = text[:32767]
        cells.append(
            f'<c r="{cell_ref}" t="inlineStr" s="{style}"><is><t>{xml_text(text)}</t></is></c>'
        )
    return f'<row r="{row_number}"{height_attr}>{"".join(cells)}</row>'


def sheet_rels_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>'''


def drawing_xml(image_matches: dict[int, Path], image_col_index: int) -> str:
    anchors = []
    for image_number, (zero_based_row, image_path) in enumerate(image_matches.items(), start=1):
        width, height = scaled_size(image_path)
        cx = width * EMU_PER_PIXEL
        cy = height * EMU_PER_PIXEL
        anchors.append(
            f'''<xdr:oneCellAnchor>
  <xdr:from><xdr:col>{image_col_index}</xdr:col><xdr:colOff>20000</xdr:colOff><xdr:row>{zero_based_row + 1}</xdr:row><xdr:rowOff>20000</xdr:rowOff></xdr:from>
  <xdr:ext cx="{cx}" cy="{cy}"/>
  <xdr:pic>
    <xdr:nvPicPr><xdr:cNvPr id="{image_number}" name="课程封面 {image_number}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
    <xdr:blipFill><a:blip r:embed="rId{image_number}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
    <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>'''
        )

    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
{''.join(anchors)}
</xdr:wsDr>'''


def drawing_rels_xml(media: list[tuple[Path, str, str]]) -> str:
    rels = []
    for index, (_image_path, media_name, _ctype) in enumerate(media, start=1):
        rels.append(
            f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{xml_text(media_name)}"/>'
        )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {''.join(rels)}
</Relationships>'''


def default_output_path(csv_path: Path) -> Path:
    return ROOT_DIR / f"{csv_path.stem}_已插入课程封面.xlsx"


def main() -> int:
    parser = argparse.ArgumentParser(description="把下载好的课程封面图片插入到 Excel 表格中。")
    parser.add_argument("--csv", type=Path, default=None, help="CSV 文件路径；不填则自动读取程序同目录下最新的 CSV")
    parser.add_argument("--images", type=Path, default=DEFAULT_IMAGE_DIR, help="下载好的课程封面图片文件夹")
    parser.add_argument("--output", type=Path, default=None, help="输出的 Excel 文件路径")
    parser.add_argument("--check-only", action="store_true", help="只检查匹配情况，不生成 Excel")
    args = parser.parse_args()

    csv_path = find_csv_file(args.csv)
    image_dir = args.images.expanduser().resolve()
    output_path = (args.output.expanduser().resolve() if args.output else default_output_path(csv_path))

    headers, rows = read_csv_rows(csv_path)
    headers, rows, output_col_index = normalize_rows(headers, rows)
    code_col_index = find_column_index(headers, CODE_COLUMN_NAMES, ["课件代码", "课件编码"])
    image_index = build_image_index(image_dir)

    image_matches: dict[int, Path] = {}
    missing: list[str] = []
    for row_index, row in enumerate(rows):
        course_code = row[code_col_index].strip() if code_col_index < len(row) else ""
        if not course_code:
            continue
        image_path = image_index.get(course_code.lower())
        if image_path:
            image_matches[row_index] = image_path
        else:
            missing.append(course_code)

    print(f"正在读取：{csv_path}")
    print(f"图片文件夹：{image_dir}")
    print(f"课件代码列：{headers[code_col_index]}")
    print(f"图片插入列：{OUTPUT_COLUMN}")
    print(f"数据行数：{len(rows)}")
    print(f"匹配到图片：{len(image_matches)} 张")
    print(f"未匹配图片：{len(missing)} 行")
    print()

    if missing:
        print("未匹配示例：")
        for code in missing[:20]:
            print(f"  - {code}")
        if len(missing) > 20:
            print(f"  ... 还有 {len(missing) - 20} 行")
        print()

    if args.check_only:
        print("检查完成，未生成 Excel。")
        return 0

    write_xlsx(output_path, headers, rows, image_matches, output_col_index)
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
