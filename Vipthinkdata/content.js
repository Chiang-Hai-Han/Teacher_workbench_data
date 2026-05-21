// 建立一個全域控制開關
let isScrapingActive = false;

// 監聽來自 popup 的各種命令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_FULL_SCRAPING") {
    isScrapingActive = true; // 開啟開關
    runAutoScraper();
  }
  if (request.action === "STOP_SCRAPING") {
    isScrapingActive = false; // 關閉開關，觸發煞車
  }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function updatePopupStatus(msg) {
  console.log(`[系統提示] ${msg}`);
  chrome.runtime.sendMessage({ action: "UPDATE_STATUS", message: msg });
}

// 主自動化流程
async function runAutoScraper() {
  const allData = [];
  const trs = document.querySelectorAll('.el-table__body-wrapper tr');
  const totalRows = trs.length;
  
  if (totalRows === 0) {
    updatePopupStatus("❌ 找不到任何資料表格，請確保在正確頁面！");
    return;
  }
  
  updatePopupStatus(`🔍 檢測到當前頁面共有 ${totalRows} 條數據，準備開始...`);
  await sleep(1000);

  // 核心大循環
  for (let i = 0; i < totalRows; i++) {
    
    // 💡 【核心修改】每次循環開頭，先檢查開關狀態
    if (!isScrapingActive) {
      updatePopupStatus("🛑 使用者手動停止流程，正在準備導出已有數據...");
      break; // 立刻跳出 For 循環，往下執行匯出代碼！
    }

    updatePopupStatus(`⏳ 正在處理第 ${i + 1}/${totalRows} 條數據...`);
    
    const rowData = await processSingleRow(i);
    
    if (rowData) {
      allData.push(rowData); // 使用正確的 JS push 語法
    } else {
      console.error(`第 ${i + 1} 行抓取失敗，跳過並繼續下一條。`);
    }

    await sleep(2000);
  }

  // 4. 匯出邏輯 (不論是正常跑完還是中途 break 跳出來，都會走到這裡)
  if (allData.length > 0) {
    updatePopupStatus(`💾 正在生成包含 ${allData.length} 筆數據的 Excel 報表...`);
    exportToExcel(allData);
    updatePopupStatus(`🎉 流程已完成！已成功導出 ${allData.length} 筆數據。`);
  } else {
    updatePopupStatus("❌ 流程結束，因未成功抓到任何數據，故不執行導出。");
  }
}

// 單行提取與跳轉邏輯 (保持原樣)
async function processSingleRow(index) {
  try {
    const trs = document.querySelectorAll('.el-table__body-wrapper tr');
    if (trs.length <= index) return null;
    
    const targetRow = trs[index];
    targetRow.scrollIntoView({ behavior: 'auto', block: 'center' });
    await sleep(3000);

    const listName = targetRow.querySelector('td:nth-child(2) .cell div:nth-child(1)')?.innerText.trim() || "N/A";
    const listCode = targetRow.querySelector('td:nth-child(1) .cell div:nth-child(2)')?.innerText.trim() || "N/A";
    const listCover = targetRow.querySelector('img')?.src || "N/A";

    const fixedTrs = document.querySelectorAll('.el-table__fixed-body-wrapper tr');
    if (fixedTrs.length <= index) return null;
    const buttons = Array.from(fixedTrs[index].querySelectorAll('button'));
    const editBtn = buttons.find(btn => btn.innerText.includes('编辑'));

    if (!editBtn) return null;
    editBtn.click(); 
    
    let isDetailLoaded = false;
    for (let t = 0; t < 10; t++) {
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
    await sleep(1000);

// 💡 升級版：死纏爛打型抓取函數 (如果框是空的，會每 0.5 秒重試一次，最多等 4 秒)
// 💡 無敵版：突破層級限制的抓取函數
    const getInputValueByLabelAsync = async (labelText) => {
      for (let i = 0; i < 10; i++) { // 最多等 5 秒 (10次 * 500ms)
        const labels = Array.from(document.querySelectorAll('label'));
        const matchedLabels = labels.filter(l => l.innerText.includes(labelText));
        
        for (let targetLabel of matchedLabels) {
          // 【核心改變】：不找隔壁了！直接往上找 Element UI 的標準表單容器 .el-form-item
          // 如果找不到，就退一步找 .el-col，再找不到就找爺爺節點
          const container = targetLabel.closest('.el-form-item') || targetLabel.closest('.el-col') || targetLabel.parentElement.parentElement;
          
          if (container) {
            // 在整個大區塊內，搜尋所有的 input 甚至是 textarea
            const inputs = container.querySelectorAll('input, textarea');
            
            // 加入排查日誌：如果是課件名稱，印出到底找到了幾個框
            if (labelText === "课件名称" && inputs.length > 0) {
               console.log(`[排查] 尋找 "${labelText}" 區塊內，共發現 ${inputs.length} 個輸入框。`);
            }

            for (let input of inputs) {
              const val = input.value; 
              if (val && val.trim() !== '') {
                return val.trim();
              }
            }
          }
        }
        // 如果這個瞬間框裡還沒有字，睡 0.5 秒再試一次
        await sleep(500); 
      }
      return "N/A";
    };

    // 富文本 (教學目標、簡介) 也一併升級
    const getRichTextByLabelAsync = async (labelText) => {
      for (let i = 0; i < 8; i++) {
        const labels = Array.from(document.querySelectorAll('label'));
        const matchedLabels = labels.filter(l => l.innerText.includes(labelText));
        
        for (let targetLabel of matchedLabels) {
          if (targetLabel && targetLabel.nextElementSibling) {
            const editor = targetLabel.nextElementSibling.querySelector('.ql-editor');
            if (editor && editor.innerText.trim() !== '') return editor.innerText.trim();
          }
        }
        await sleep(500);
      }
      return "N/A";
    };

    updatePopupStatus(`⏳ 正在等待第 ${index + 1} 行詳情數據載入...`);

    // 💡 注意：這裡每個欄位前面都加上了 await，強迫腳本一定要等到文字出現才往下走
    const rowData = {
      "序号": index + 1,
      "列表_课件名称": listName,
      "列表_课件代码": listCode,
      "列表_课程封面": listCover,
      "详情_课件名称": await getInputValueByLabelAsync("课件名称"),
      "详情_内容名称": await getInputValueByLabelAsync("内容名称"),
      "详情_课件编码": await getInputValueByLabelAsync("课件编码"),
      "详情_教学目标": await getRichTextByLabelAsync("教学目标"),
      "详情_课节简介": await getRichTextByLabelAsync("课节简介")
    };

    console.log(`[Row ${index+1} 成功]`, rowData);

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
    window.history.back();
    return null;
  }
}

// Excel (CSV) 匯出函數 (保持原樣)
function exportToExcel(dataList) {
  if (dataList.length === 0) return;
  const headers = ["序号", "列表_课件名称", "列表_课件代码", "列表_课程封面", "详情_课件名称", "详情_内容名称", "详情_课件编码", "详情_教学目标", "详情_课节简介"];
  let csvString = "\ufeff";
  csvString += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";
  
  dataList.forEach(row => {
    const rowCells = headers.map(h => {
      const cellValue = row[h] !== undefined ? String(row[h]) : "";
      return `"${cellValue.replace(/"/g, '""')}"`;
    });
    csvString += rowCells.join(",") + "\n";
  });
  
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  downloadLink.setAttribute("href", url);
  downloadLink.setAttribute("download", `豌豆课件部分数据导出_${today}.csv`);
  
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}
