// 開始按鈕
document.getElementById('startBtn').addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false; // 啟用停止按鈕
  document.getElementById('status').innerText = "正在初始化自動流程...";
  
  chrome.tabs.sendMessage(tab.id, { action: "START_FULL_SCRAPING" });
});

// 停止按鈕
document.getElementById('stopBtn').addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('status').innerText = "正在發送停止指令...";
  
  // 發送停止訊號
  chrome.tabs.sendMessage(tab.id, { action: "STOP_SCRAPING" });
});

// 監聽進度與結束狀態
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "UPDATE_STATUS") {
    document.getElementById('status').innerText = request.message;
    
    // 如果流程結束（不論是完成、被使用者停止、還是出錯），都恢復按鈕狀態
    if (request.message.includes("已完成") || request.message.includes("手動停止") || request.message.includes("❌")) {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});
