document.getElementById('startBtn').addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById('startBtn').disabled = true;
  document.getElementById('status').innerText = "正在初始化自動流程...";
  
  // 發送全頁抓取指令
  chrome.tabs.sendMessage(tab.id, { action: "START_FULL_SCRAPING" });
});

// 監聽來自 content.js 的進度回報
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "UPDATE_STATUS") {
    document.getElementById('status').innerText = request.message;
    if (request.message.includes("已完成")) {
      document.getElementById('startBtn').disabled = false;
    }
  }
});
