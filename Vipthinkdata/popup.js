document.getElementById('startBtn').addEventListener('click', async () => {
  // 找到當前活躍的標籤頁
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // 發送訊息給 content.js，命令它開始執行提取
  chrome.tabs.sendMessage(tab.id, { action: "START_SCRAPING", rowIndex: 0 });
});