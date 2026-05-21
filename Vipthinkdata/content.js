// 監聽 popup 的全頁抓取命令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_FULL_SCRAPING") {
    runAutoScraper();
  }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 發送狀態更新給 popup 介面顯示
function updatePopupStatus(msg) {
  console.log(`[系統提示] ${msg}`);
  chrome.runtime.sendMessage({ action: "UPDATE_STATUS", message: msg });
}

// 主自動化流程
async function runAutoScraper() {
  const allData = [];
  
  // 1. 獲取當前頁面所有的表格行數
  const trs = document.querySelectorAll('.el-table__body-wrapper tr');
  const totalRows = trs.length;
  
  if (totalRows === 0) {
    updatePopupStatus("❌ 找不到任何資料表格，請確保在正確頁面！");
    return;
  }
  
  updatePopupStatus(`🔍 檢測到當前頁面共有 ${totalRows} 條數據，準備開始...`);
  await sleep(1000);

  // 2. 核心大循環
  for (let i = 0; i < totalRows; i++) {
    updatePopupStatus(`⏳ 正在處理第 ${i + 1}/${totalRows} 條數據...`);
    
    // 執行單行抓取邏輯
    const rowData = await processSingleRow(i);
    
   if (rowData) {
      allData.push(rowData); 
    } else {
      console.error(`第 ${i + 1} 行抓取失敗，跳過並繼續下一條。`);
    }

    // 關鍵：從詳情頁返回列表頁後，給予 Element UI 表格足夠的時間重新加載與渲染
    await sleep(2000);
  }

  // 3. 循環結束，匯出成 Excel
  updatePopupStatus(`💾 抓取完畢！正在生成 Excel 報表...`);
  exportToExcel(allData);
  updatePopupStatus(`🎉 已完成！Excel 檔案已自動下載。`);
}

// 單行提取與跳轉邏輯 (成功則返回 rowData 物件，失敗返回 null)
async function processSingleRow(index) {
  try {
    // 重新獲取最新的 tr 列表（因為每次返回列表頁，DOM 都會刷新）
    const trs = document.querySelectorAll('.el-table__body-wrapper tr');
    if (trs.length <= index) return null;
    
    const targetRow = trs[index];
    targetRow.scrollIntoView({ behavior: 'auto', block: 'center' });
    await sleep(3000); // 滾動後稍作停頓

    // 抓取列表頁數據
    const listName = targetRow.querySelector('td:nth-child(2) .cell div:nth-child(1)')?.innerText.trim() || "N/A";
    const listCode = targetRow.querySelector('td:nth-child(1) .cell div:nth-child(2)')?.innerText.trim() || "N/A";
    const listCover = targetRow.querySelector('img')?.src || "N/A";

    // 尋找並點擊編輯按鈕
    const fixedTrs = document.querySelectorAll('.el-table__fixed-body-wrapper tr');
    if (fixedTrs.length <= index) return null;
    const buttons = Array.from(fixedTrs[index].querySelectorAll('button'));
    const editBtn = buttons.find(btn => btn.innerText.includes('编辑'));

    if (!editBtn) return null;
    editBtn.click(); 
    
    // 等待詳情頁加載（盯著「课件名称」標籤出現）
    let isDetailLoaded = false;
    for (let t = 0; t < 10; t++) { // 最多等 5 秒
      const labels = Array.from(document.querySelectorAll('label'));
      if (labels.some(l => l.innerText.includes("课件名称"))) {
        isDetailLoaded = true;
        break;
      }
      await sleep(500);
    }
    
    if (!isDetailLoaded) {
      console.error("詳情頁加載超時！");
      window.history.back();
      return null;
    }
    await sleep(1000); // 額外等待 1 秒確保 Vue 雙向綁定數據填入

    // 詳情頁內部的地毯式搜索輔助函數
    const getInputValueByLabel = (labelText) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const targetLabel = labels.find(l => l.innerText.includes(labelText));
      if (targetLabel && targetLabel.nextElementSibling) {
        const inputs = targetLabel.nextElementSibling.querySelectorAll('input');
        for (let input of inputs) {
          if (input.value && input.value.trim() !== '') return input.value.trim();
        }
      }
      return "N/A";
    };

    const getRichTextByLabel = (labelText) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const targetLabel = labels.find(l => l.innerText.includes(labelText));
      if (targetLabel && targetLabel.nextElementSibling) {
        const editor = targetLabel.nextElementSibling.querySelector('.ql-editor');
        if (editor) return editor.innerText.trim();
      }
      return "N/A";
    };

    // 封裝該行所有數據
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

    console.log(`[Row ${index+1} 成功]`, rowData);

    // 點擊返回
    const backBtns = Array.from(document.querySelectorAll('button'));
    const backBtn = backBtns.find(btn => btn.innerText.includes('返回'));
    if (backBtn) {
      backBtn.click();
    } else {
      window.history.back();
    }

    return rowData;

  } catch (error) {
    console.error(`處理第 ${index + 1} 行時引發異常:`, error);
    window.history.back(); // 發生異常嘗試強制返回
    return null;
  }
}

// 數據匯出與瀏覽器自動下載函數
function exportToExcel(dataList) {
  if (dataList.length === 0) return;
  
  // 定義表頭順序
  const headers = ["序号", "列表_课件名称", "列表_课件代码", "列表_课程封面", "详情_课件名称", "详情_内容名称", "详情_课件编码", "详情_教学目标", "详情_课节简介"];
  
  // 建立 CSV 內容字串，一開頭加入 '\ufeff' (UTF-8 BOM)，這是讓 Excel 能正確識別中文不亂碼的關鍵必殺技
  let csvString = "\ufeff";
  
  // 1. 寫入表頭行
  csvString += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";
  
  // 2. 遍歷寫入每一行數據
  dataList.forEach(row => {
    const rowCells = headers.map(h => {
      const cellValue = row[h] !== undefined ? String(row[h]) : "";
      // 處理資料內包含引號、換行或逗號的特殊格式，用雙引號包起來並把內部引號轉義
      return `"${cellValue.replace(/"/g, '""')}"`;
    });
    csvString += rowCells.join(",") + "\n";
  });
  
  // 3. 透過 Blob 觸發瀏覽器下載
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const downloadLink = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  downloadLink.setAttribute("href", url);
  downloadLink.setAttribute("download", `豌豆课件数据导出_${today}.csv`);
  
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}
