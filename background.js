let isTranslating = false;

chrome.action.onClicked.addListener(async (tab) => {
    if (isTranslating) return;
    
    isTranslating = true;
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
        });
        
        await chrome.tabs.sendMessage(tab.id, { action: "startTranslation" });
    } catch (error) {
        console.error('Error executing script:', error);
    } finally {
        isTranslating = false;
    }
});