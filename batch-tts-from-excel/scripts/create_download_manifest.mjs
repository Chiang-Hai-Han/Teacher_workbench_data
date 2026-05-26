import fs from "node:fs";
import path from "node:path";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeFileName(text) {
  return `${String(text)
    .replace(/[\\/:*?"<>|]/g, "，")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)}.wav`;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[ch]);
}

const jsonPath = argValue("--json");
const outDir = argValue("--out");

if (!jsonPath || !outDir) {
  console.error('Usage: node create_download_manifest.mjs --json results.json --out "output-folder"');
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "")).map((row) => ({
  ...row,
  fileName: row.fileName || safeFileName(row.text),
}));

fs.mkdirSync(outDir, { recursive: true });

const csvPath = path.join(outDir, "生成音频链接.csv");
const htmlPath = path.join(outDir, "下载生成语音.html");
const batPath = path.join(outDir, "一键下载语音.bat");
const psPath = path.join(outDir, "download_audio.ps1");

const csv = "\uFEFF" + [
  "行号,角色,文件名,对白,音频链接",
  ...rows.map((row) =>
    [row.row ?? "", row.role ?? "", row.fileName, row.text ?? "", row.link ?? ""]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")
  ),
].join("\r\n");

fs.writeFileSync(csvPath, csv, "utf8");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>批量语音下载</title>
  <style>
    body { font-family: Arial, "Microsoft YaHei", sans-serif; margin: 28px; line-height: 1.55; color: #1f2937; }
    h1 { font-size: 22px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    th { background: #f3f4f6; }
    a.button { display: inline-block; background: #0f766e; color: white; text-decoration: none; padding: 6px 10px; border-radius: 4px; white-space: nowrap; }
    .text { max-width: 620px; }
  </style>
</head>
<body>
  <h1>批量语音下载</h1>
  <p>共 ${rows.length} 条。点击“下载”会使用对应文本作为文件名。</p>
  <table>
    <thead><tr><th>行号</th><th>角色</th><th>文本</th><th>下载</th></tr></thead>
    <tbody>
      ${rows.map((row) => `<tr><td>${esc(row.row ?? "")}</td><td>${esc(row.role ?? "")}</td><td class="text">${esc(row.text ?? "")}</td><td><a class="button" href="${esc(row.link ?? "")}" download="${esc(row.fileName)}">下载</a></td></tr>`).join("")}
    </tbody>
  </table>
</body>
</html>`;

fs.writeFileSync(htmlPath, html, "utf8");
fs.writeFileSync(batPath, `@echo off
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\\download_audio.ps1"
popd
pause
`, "utf8");

fs.writeFileSync(psPath, String.raw`$ErrorActionPreference = "Stop"

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csvFile = Get-ChildItem -Path $baseDir -Filter "*.csv" | Select-Object -First 1
$audioDir = Join-Path $baseDir "audio_files"

if ($csvFile -eq $null) {
    Write-Host "CSV not found in folder: $baseDir" -ForegroundColor Red
    exit 1
}

$csvPath = $csvFile.FullName
New-Item -ItemType Directory -Force -Path $audioDir | Out-Null

function Read-CsvLine {
    param([string]$Line)

    $values = New-Object System.Collections.Generic.List[string]
    $current = New-Object System.Text.StringBuilder
    $inQuotes = $false
    $i = 0

    while ($i -lt $Line.Length) {
        $ch = $Line[$i]
        if ($ch -eq '"') {
            if ($inQuotes -and ($i + 1) -lt $Line.Length -and $Line[$i + 1] -eq '"') {
                [void]$current.Append('"')
                $i += 2
                continue
            }
            $inQuotes = -not $inQuotes
        }
        elseif ($ch -eq ',' -and -not $inQuotes) {
            $values.Add($current.ToString())
            $current.Length = 0
        }
        else {
            [void]$current.Append($ch)
        }
        $i += 1
    }

    $values.Add($current.ToString())
    return $values.ToArray()
}

function Get-SafeFileName {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        $Name = "audio"
    }

    foreach ($ch in [IO.Path]::GetInvalidFileNameChars()) {
        $Name = $Name.Replace($ch, "_")
    }

    $Name = [regex]::Replace($Name, '\s+', ' ').Trim()

    if ($Name.Length -gt 150) {
        $Name = $Name.Substring(0, 150)
    }

    if (-not $Name.ToLower().EndsWith(".wav")) {
        $Name = $Name + ".wav"
    }

    return $Name
}

$lines = [System.IO.File]::ReadAllLines($csvPath, [System.Text.Encoding]::UTF8)
if ($lines.Count -le 1) {
    Write-Host "No rows in CSV." -ForegroundColor Yellow
    exit 0
}

$total = $lines.Count - 1
$done = 0

for ($lineIndex = 1; $lineIndex -lt $lines.Count; $lineIndex += 1) {
    $cols = Read-CsvLine $lines[$lineIndex]

    if ($cols.Count -lt 5) {
        Write-Host ("Skip row {0}: not enough columns" -f $lineIndex) -ForegroundColor Yellow
        continue
    }

    $fileName = Get-SafeFileName $cols[2]
    $url = $cols[4]

    if ([string]::IsNullOrWhiteSpace($url)) {
        Write-Host ("Skip row {0}: empty url" -f $lineIndex) -ForegroundColor Yellow
        continue
    }

    $outPath = Join-Path $audioDir $fileName
    $done += 1
    Write-Host ("Downloading {0}/{1}: {2}" -f $done, $total, $fileName)

    try {
        $client = New-Object System.Net.WebClient
        $client.DownloadFile($url, $outPath)
    }
    catch {
        Write-Host ("Failed: {0}" -f $fileName) -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
    finally {
        if ($client -ne $null) {
            $client.Dispose()
        }
    }
}

Write-Host ""
Write-Host "Done. Audio folder:" -ForegroundColor Green
Write-Host $audioDir -ForegroundColor Green
`, "utf8");

console.log(JSON.stringify({ count: rows.length, htmlPath, csvPath, batPath, psPath }, null, 2));
