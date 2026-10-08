// ========== SERVICE WORKER ==========
// Abre las páginas propias de la extensión a pedido del panel (por ejemplo, "Armar grupos").

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req && req.action === 'abrirGrupos') {
        const url = chrome.runtime.getURL('grupos.html') + (req.libretaId ? '?libreta=' + encodeURIComponent(req.libretaId) : '');
        chrome.tabs.create({ url, index: sender.tab ? sender.tab.index + 1 : undefined }, () => sendResponse({ ok: !chrome.runtime.lastError }));
        return true; // respuesta asíncrona
    }
    return false;
});
