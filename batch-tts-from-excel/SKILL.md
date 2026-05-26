---
name: batch-tts-from-excel
description: Batch-generate text-to-speech audio from spreadsheet rows through a local Gradio TTS web app, especially the 10.200.16.209 voice model directory. Use when the user asks to read an Excel/CSV sheet of lines, choose a voice such as "系统声音 -> 中文", generate one voice clip per row, rename audio by row text, or create a download page/CSV when direct local downloads are blocked.
---

# Batch TTS From Excel

Use this skill to turn spreadsheet rows into one TTS audio item per row through a local Gradio voice page.

## Workflow

1. Inspect the spreadsheet and identify the text column.
   - For the Taiwan question sheet pattern, use the `对白` column as the target text.
   - Preserve the row number and role column when available for progress reporting.
   - Skip blank rows and instruction/notes rows.

2. Resolve the voice page from the model directory.
   - Directory page: `http://10.200.16.209:1000/`
   - `系统声音 -> 中文` maps to `http://10.200.16.209:1001/`.
   - Prefer the Browser plugin/in-app browser for this intranet service because local Node or shell network calls may be blocked with `EACCES`.

3. Use the in-app browser to operate the Gradio page.
   - Open the resolved voice page.
   - Confirm the title/model is the requested voice, for example `0.系统声音（A全阶-中文-常规）`.
   - Use the second `textarea` as `需要合成的文本`.
   - Use the `合成语音` button to generate.
   - Wait for a fresh `a[href*="file="][href*="audio.wav"]` link after each click.

4. Save output if possible.
   - If direct network/file download works, download each fresh audio link and save it as the sanitized target text plus `.wav`.
   - If local download commands are blocked by Codex safety review or network `EACCES`, do not keep retrying the same blocked route. Create a download page, CSV link manifest, and a user-run `.bat` downloader instead.

5. Deliver clearly.
   - Report the count generated.
   - Link the output folder, download page, CSV manifest, or audio files.
   - Mention any platform blocker exactly and briefly, such as `codex-auto-review` not configured or local `EACCES`.

## Browser Generation Pattern

After reading the Browser skill and bootstrapping `browser`/`tab`, this is the essential page-control loop:

```js
await tab.goto("http://10.200.16.209:1001/");
await tab.playwright.waitForTimeout(5000);

async function currentAudioLinks() {
  return await tab.playwright.evaluate(() =>
    [...document.querySelectorAll("a")]
      .map(a => a.href)
      .filter(h => /file=.*audio\.wav/i.test(h))
  );
}

async function generateOne(text) {
  await tab.playwright.locator("textarea").nth(1).fill(text);
  const before = await currentAudioLinks();
  await tab.playwright.locator("button").filter({ hasText: "合成语音" }).click({ timeout: 10000 });

  for (let i = 0; i < 300; i++) {
    await tab.playwright.waitForTimeout(1000);
    const links = await currentAudioLinks();
    const fresh = links.filter(h => !before.includes(h));
    if (fresh.length) return fresh.at(-1);

    const tail = await tab.playwright.evaluate(() => document.body.innerText.slice(-1200));
    if (/Error|错误|Traceback|失败/.test(tail)) throw new Error(tail);
  }
  throw new Error("等待新音频链接超时");
}
```

## Download Fallback

When direct downloads are blocked, use `scripts/create_download_manifest.mjs` to create:

- `下载生成语音.html`: a local page with one download button per generated link and `download="<target text>.wav"`.
- `生成音频链接.csv`: row, role, target filename, text, and generated audio URL.
- `一键下载语音.bat` and `download_audio.ps1`: user-run Windows downloader files.

Do not rely on the HTML `download` attribute alone. For cross-origin Gradio file links, many browsers ignore the requested filename and only play the audio. Tell the user to run the generated `.bat` if webpage buttons play instead of downloading.

Keep Windows downloader scripts ASCII-only where possible. Older Windows PowerShell sessions may misread UTF-8 script literals containing Chinese filenames or CSV column names. The generated PowerShell script should:

- Find the first `*.csv` in the output folder instead of hardcoding `生成音频链接.csv`.
- Parse CSV columns by position: row, role, filename, text, audio_url.
- Save audio to an ASCII folder such as `audio_files`.
- Avoid `$var:` string interpolation; use `-f` formatting instead.

Run it with bundled Node or the Node REPL equivalent:

```bash
node scripts/create_download_manifest.mjs --json results.json --out "output-folder"
```

The JSON must be an array of objects with:

```json
[
  {
    "row": 2,
    "role": "山羊老师（1）",
    "text": "需要合成的文本",
    "link": "http://10.200.16.209:1001/file=.../audio.wav"
  }
]
```

## File Naming

Use the row text as the base filename. Replace Windows-invalid characters with Chinese commas:

`\\ / : * ? " < > |`

Trim whitespace and cap the filename stem at roughly 150 characters before appending `.wav`.
