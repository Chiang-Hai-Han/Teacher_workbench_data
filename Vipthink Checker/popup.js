document.getElementById('startBtn').addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById('startBtn').disabled = true;
  document.getElementById('status').innerText = "正在執行稽核，請勿操作網頁...";
  chrome.tabs.sendMessage(tab.id, { action: "START_CHECKING" });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "UPDATE_STATUS") {
    document.getElementById('status').innerText = request.message;
    if (request.message.includes("檢查完畢")) {
      document.getElementById('startBtn').disabled = false;
    }
  }
});