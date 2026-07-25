let currentAnnouncement = "";

module.exports = function registerTextHandlers(io, socket) {
    socket.emit('text_updated', currentAnnouncement);

    socket.on('update_text', (newText) => {
        console.log('Update text received:', newText);
        currentAnnouncement = newText; // サーバーに保存
        io.emit('text_updated', currentAnnouncement); // 全員に新しいテキストを配る
    });
}