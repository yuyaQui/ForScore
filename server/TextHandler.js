let currentAnnouncement = "";

const store = require("./stateStore");
store.register(
    "text",
    () => ({ currentAnnouncement }),
    (saved) => {
        const v = saved && typeof saved === "object" ? saved.currentAnnouncement : undefined;
        if (typeof v === "string") currentAnnouncement = v.slice(0, 2000);
    }
);

module.exports = function registerTextHandlers(io, socket) {
    socket.emit('text_updated', currentAnnouncement);

    socket.on('update_text', (newText) => {
        console.log('Update text received:', newText);
        if (typeof newText !== 'string') return; // 文字列以外は受け付けない（2026-11-04）
        currentAnnouncement = newText.slice(0, 2000); // サーバーに保存
        io.emit('text_updated', currentAnnouncement); // 全員に新しいテキストを配る
    });
}