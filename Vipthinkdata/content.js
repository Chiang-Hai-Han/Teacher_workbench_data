// 監聽來自 popup 的命令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_SCRAPING") {
    console.log(`🚀 開始處理第 ${request.rowIndex + 1} 行數據...`);
    processRowData(request.rowIndex);
  }
});

// 休眠函數 (取代 Python 的 time.sleep)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 原生 JS 版本的核心抓取邏輯
async function processRowData(index) {
  try {
    // === 1. 列表頁抓取 ===
    const trs = document.querySelectorAll('.el-table__body-wrapper tr');
    if (trs.length <= index) {
      console.error("找不到對應的表格行");
      return;
    }
    const targetRow = trs[index];
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);

    const listName = targetRow.querySelector('td:nth-child(2) .cell div:nth-child(1)')?.innerText.trim() || "N/A";
    const listCode = targetRow.querySelector('td:nth-child(1) .cell div:nth-child(2)')?.innerText.trim() || "N/A";
    const listCover = targetRow.querySelector('img')?.src || "N/A";

    // === 2. 點擊編輯按鈕 ===
    const fixedTrs = document.querySelectorAll('.el-table__fixed-body-wrapper tr');
    // 找出包含 "编辑" 文字的按鈕
    const buttons = Array.from(fixedTrs[index].querySelectorAll('button'));
    const editBtn = buttons.find(btn => btn.innerText.includes('编辑'));

    if (editBtn) {
      editBtn.click(); // 原生點擊，完全無視 Vue 的圖層遮擋！
      await sleep(2000); // 等待頁面跳轉
    } else {
      console.error("找不到編輯按鈕");
      return;
    }

    // === 3. 詳情頁抓取 (原生 JS 地毯式搜索) ===
    // 輔助函數：找標籤旁邊的輸入框值
    const getInputValueByLabel = (labelText) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const targetLabel = labels.find(l => l.innerText.includes(labelText));
      if (targetLabel) {
        // 找到標籤旁邊的 div 裡面的所有 input
        const inputs = targetLabel.nextElementSibling.querySelectorAll('input');
        for (let input of inputs) {
          if (input.value && input.value.trim() !== '') {
            return input.value.trim();
          }
        }
      }
      return "N/A";
    };

    // 輔助函數：找標籤旁邊的富文本
    const getRichTextByLabel = (labelText) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const targetLabel = labels.find(l => l.innerText.includes(labelText));
      if (targetLabel) {
        const editor = targetLabel.nextElementSibling.querySelector('.ql-editor');
        if (editor) return editor.innerText.trim();
      }
      return "N/A";
    };

    // 提取所有欄位
    const rowData = {
      "序号": index + 1,
      "列表_课件名称": listName,
      "列表_课件代码": listCode,
      "列表_课程封面": listCover,
      "详情_课件名称": getInputValueByLabel("课件名称"),
      "详情_内容名称": getInputValueByLabel("内容名称"),
      "详情_课件编码": getInputValueByLabel("课件编码"),
      "详情_教学目标": getRichTextByLabel("教学目标"),
      "详情_课节简介": getRichTextByLabel("课节简介")
    };

    console.log("✅ 成功提取數據：", rowData);
    alert(`成功提取：${rowData["详情_课件名称"]}\n(請打開開發者工具 F12 查看完整字典)`);

    // === 4. 點擊返回 ===
    const backBtns = Array.from(document.querySelectorAll('button'));
    const backBtn = backBtns.find(btn => btn.innerText.includes('返回'));
    if (backBtn) {
      backBtn.click();
    } else {
      window.history.back();
    }

  } catch (error) {
    console.error(`處理第 ${index + 1} 行時出錯:`, error);
  }
}