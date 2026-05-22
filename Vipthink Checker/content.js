chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_CHECKING") {
    runChecker();
  }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function updatePopupStatus(msg) {
  console.log(`[稽核進度] ${msg}`);
  chrome.runtime.sendMessage({ action: "UPDATE_STATUS", message: msg });
}

async function runChecker() {
  const emptyRecords = []; // 用來存放漏填的課件資料
  
  // 獲取表格主體 (用來抓名稱與代碼) 與 固定列 (用來點擊按鈕)
  const mainTrs = document.querySelectorAll('.el-table__body-wrapper tr');
  const fixedTrs = document.querySelectorAll('.el-table__fixed-body-wrapper tr');
  const totalRows = mainTrs.length;

  if (totalRows === 0) {
    updatePopupStatus("❌ 找不到資料，請確保在課件列表頁面！");
    return;
  }

  updatePopupStatus(`開始檢查，共 ${totalRows} 筆...`);

  for (let i = 0; i < totalRows; i++) {
    updatePopupStatus(`正在檢查第 ${i + 1}/${totalRows} 筆...`);
    
    try {
      const targetMainRow = document.querySelectorAll('.el-table__body-wrapper tr')[i];
      const targetFixedRow = document.querySelectorAll('.el-table__fixed-body-wrapper tr')[i];
      
      targetMainRow.scrollIntoView({ behavior: 'auto', block: 'center' });
      await sleep(500);

      // 1. 提取課件名稱與代碼 (沿用你之前的 DOM 結構)
      const listName = targetMainRow.querySelector('td:nth-child(1) .cell div:nth-child(1)')?.innerText.trim() || targetMainRow.querySelector('td:nth-child(2) .cell div:nth-child(1)')?.innerText.trim() || "未知名稱";
      const listCode = targetMainRow.querySelector('td:nth-child(1) .cell div:nth-child(2)')?.innerText.trim() || targetMainRow.querySelector('td:nth-child(2) .cell div:nth-child(2)')?.innerText.trim() || "未知代碼";

      // 2. 尋找並點擊「更多」
      const spans = Array.from(targetFixedRow.querySelectorAll('span'));
      const moreBtn = spans.find(span => span.innerText.includes('更多'));
      
      if (!moreBtn) {
        console.warn(`第 ${i+1} 行沒有「更多」按鈕`);
        continue;
      }
      
      moreBtn.click(); // 觸發下拉選單
      await sleep(800); // 等待下拉選單出現在 DOM 中

      // 3. 尋找下拉選單中的「小老師作品」並點擊
      // Element UI 會把當前顯示的 dropdown menu 放在 body 下，且通常是可見的 (沒有 display: none)
      const dropdownItems = Array.from(document.querySelectorAll('.el-dropdown-menu__item'));
      // 過濾出文字包含「小老師作品」且在畫面上是可見的節點
      const teacherBtn = dropdownItems.find(item => item.innerText.includes('小老师作品') && item.offsetParent !== null);

      if (!teacherBtn) {
        console.warn(`第 ${i+1} 行找不到「小老師作品」選項`);
        // 隨便點擊網頁空白處關閉下拉選單
        document.body.click(); 
        continue;
      }

      teacherBtn.click();
      
      // 4. 等待彈窗出現
      await sleep(1500); 

      // 5. 檢查空值邏輯
      let isThemeEmpty = false;
      let isSuggestionEmpty = false;

      const labels = Array.from(document.querySelectorAll('label'));
      
      // 檢查「建议主题」
      const themeLabel = labels.find(l => l.innerText.includes('建议主题'));
      if (themeLabel && themeLabel.nextElementSibling) {
        const input = themeLabel.nextElementSibling.querySelector('input');
        if (!input || input.value.trim() === '') {
          isThemeEmpty = true;
        }
      } else {
        isThemeEmpty = true; // 找不到框也視為漏填
      }

      // 檢查「录制建议」 (富文本處理)
      const suggestionLabel = labels.find(l => l.innerText.includes('录制建议'));
      if (suggestionLabel && suggestionLabel.nextElementSibling) {
        const editor = suggestionLabel.nextElementSibling.querySelector('.ql-editor');
        if (editor) {
          // 清除富文本常帶有的零寬空格 (\u200B) 與首尾空白
          const text = editor.innerText.replace(/\u200B/g, '').trim();
          if (text === '') {
            isSuggestionEmpty = true;
          }
        } else {
          isSuggestionEmpty = true;
        }
      } else {
        isSuggestionEmpty = true;
      }

      // 6. 如果有漏填，記錄下來
      if (isThemeEmpty || isSuggestionEmpty) {
        emptyRecords.push({
          "課件名稱": listName,
          "課件代碼": listCode,
          "漏填項目": (isThemeEmpty ? "[建议主题] " : "") + (isSuggestionEmpty ? "[录制建议]" : "")
        });
        console.log(`⚠️ 發現漏填: ${listName}`);
      }

      // 7. 點擊「返回」關閉彈窗
      const buttons = Array.from(document.querySelectorAll('.el-dialog__wrapper button, .el-dialog button'));
      // 找到可見的返回按鈕
      const backBtn = buttons.find(btn => btn.innerText.includes('返回') && btn.offsetParent !== null);
      
      if (backBtn) {
        backBtn.click();
      } else {
        // 保底方案：點擊右上角的 X
        const closeIcon = document.querySelector('.el-dialog__headerbtn:not([style*="display: none"])');
        if (closeIcon) closeIcon.click();
      }

      // 等待彈窗消失，再進行下一輪
      await sleep(1000);

    } catch (error) {
      console.error(`檢查第 ${i + 1} 行時發生錯誤:`, error);
      // 嘗試關閉可能卡住的彈窗
      document.body.click(); 
      const closeIcon = document.querySelector('.el-dialog__headerbtn');
      if (closeIcon && closeIcon.offsetParent !== null) closeIcon.click();
      await sleep(1000);
    }
  }

  // === 稽核結束，產出報告 ===
  if (emptyRecords.length > 0) {
    updatePopupStatus(`⚠️ 檢查完畢！發現 ${emptyRecords.length} 筆漏填，正在產出報告...`);
    exportReport(emptyRecords);
  } else {
    updatePopupStatus(`✅ 檢查完畢！全部填寫完整，沒有漏填。`);
    alert("太棒了！當前頁面的小老師作品全部都有填寫主題與建議。");
  }
}

// 產出 CSV 報告下載
function exportReport(records) {
  let csvString = "\ufeff課件名稱,課件代碼,漏填項目\n";
  
  records.forEach(row => {
    const name = `"${row['課件名稱'].replace(/"/g, '""')}"`;
    const code = `"${row['課件代碼'].replace(/"/g, '""')}"`;
    const missing = `"${row['漏填項目']}"`;
    csvString += `${name},${code},${missing}\n`;
  });
  
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  downloadLink.setAttribute("href", url);
  downloadLink.setAttribute("download", `小老師漏填稽核報告_${today}.csv`);
  
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}