let isInitialized = false;
let currentController = null; // Controller để hủy các fetch requests
let isNewPageLoaded = false; // Flag để kiểm tra trang mới

// Hàm dịch văn bản sử dụng Google Translate API
async function translateText(text) {
    try {
        // Tạo controller mới cho mỗi request
        if (currentController) {
            currentController.abort(); // Hủy request cũ nếu có
        }
        currentController = new AbortController();

        const response = await fetch(
            "https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=" + encodeURIComponent(text),
            { signal: currentController.signal }
        );
        const result = await response.json();
        return result[0]?.[0]?.[0] || text;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Translation aborted');
        }
        console.error('Translation error:', error);
        return text;
    }
}

// Kiểm tra có phải text tiếng Nhật không
function hasJapaneseText(text) {
    return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
}

// Kiểm tra text node có cần dịch không
function shouldTranslateNode(node) {
    if (!node || !node.textContent) return false;

    const invalidParents = ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'META', 'IFRAME'];
    let parent = node.parentElement;
    while (parent) {
        if (invalidParents.includes(parent.tagName) || parent.hasAttribute('data-translated')) {
            return false;
        }
        parent = parent.parentElement;
    }

    const text = node.textContent.trim();
    return text.length > 0 && hasJapaneseText(text);
}

// Dịch một text node
async function translateNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent.trim();
    if (!text || !hasJapaneseText(text)) return;

    try {
        const translatedText = await translateText(text);
        if (translatedText && translatedText !== text) {
            node.textContent = translatedText;
            if (node.parentElement) {
                node.parentElement.setAttribute('data-translated', 'true');
            }
        }
    } catch (error) {
        if (error.message === 'Translation aborted') {
            throw error; // Chuyển tiếp lỗi để dừng quá trình dịch
        }
        console.error('Error translating node:', error);
    }
}

// Dịch một element và tất cả con của nó
async function translateElement(element) {
    if (!element || isNewPageLoaded) return;

    try {
        // Xử lý text nodes trực tiếp
        const childNodes = element.childNodes;
        for (const node of childNodes) {
            if (isNewPageLoaded) throw new Error('Translation aborted');
            if (node.nodeType === Node.TEXT_NODE && shouldTranslateNode(node)) {
                await translateNode(node);
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // Xử lý elements con
        const children = element.children;
        if (children && children.length > 0) {
            for (const child of children) {
                if (isNewPageLoaded) throw new Error('Translation aborted');
                await translateElement(child);
            }
        }
    } catch (error) {
        if (error.message === 'Translation aborted') {
            throw error;
        }
        console.error('Error in translateElement:', error);
    }
}

// Dịch toàn bộ trang
async function translatePage() {
    isNewPageLoaded = false;
    try {
        await translateElement(document.body);
    } catch (error) {
        if (error.message === 'Translation aborted') {
            console.log('Translation stopped due to page change');
        } else {
            console.error('Error in translatePage:', error);
        }
    }
}

// Xử lý DOM mutations
const observer = new MutationObserver((mutations) => {
    if (isNewPageLoaded) return;

    mutations.forEach(async (mutation) => {
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                observer.disconnect();
                try {
                    await translateElement(node);
                } catch (error) {
                    if (error.message === 'Translation aborted') {
                        return;
                    }
                } finally {
                    if (!isNewPageLoaded) {
                        observer.observe(document.body, observerConfig);
                    }
                }
            }
        }
    });
});

const observerConfig = {
    childList: true,
    subtree: true,
    characterData: true
};

// Theo dõi thay đổi URL
let lastUrl = window.location.href;
function checkUrlChange() {
    if (lastUrl !== window.location.href) {
        lastUrl = window.location.href;
        handlePageChange();
    }
}

// Xử lý khi chuyển trang
async function handlePageChange() {
    isNewPageLoaded = true;
    
    // Hủy tất cả requests đang chạy
    if (currentController) {
        currentController.abort();
        currentController = null;
    }

    // Reset observer
    observer.disconnect();

    // Đợi một chút để trang mới load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Bắt đầu dịch trang mới
    isInitialized = false;
    initialize();
}

// Khởi tạo extension
async function initialize() {
    if (isInitialized) return;
    isInitialized = true;

    await translatePage();
    observer.observe(document.body, observerConfig);
}

// Theo dõi thay đổi URL
setInterval(checkUrlChange, 1000);

// Lắng nghe message từ background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startTranslation") {
        initialize();
    }
});

// Lắng nghe sự kiện popstate (khi người dùng sử dụng nút back/forward)
window.addEventListener('popstate', handlePageChange);

// Lắng nghe các thay đổi trong history
const originalPushState = history.pushState;
history.pushState = function() {
    originalPushState.apply(this, arguments);
    handlePageChange();
};

const originalReplaceState = history.replaceState;
history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    handlePageChange();
};