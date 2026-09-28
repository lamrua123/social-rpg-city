# Known limitations

- MVP dùng custom WebSocket + Durable Objects thay cho Colyseus/Node. Public preview đã được kiểm tra nhiều client; temporary Cloudflare account cần được claim trong thời hạn Wrangler hiển thị để giữ deployment.
- Chưa có account hoặc server archive; browser mới không xem được chat history browser cũ.
- Block/mute chỉ có hiệu lực trên browser đã cấu hình. Người tạo guest ID mới có thể xuất hiện lại.
- Profanity filtering chỉ bao phủ một danh sách từ phổ biến; không thay thế moderation con người hoặc anti-abuse service.
- Reports là structured metadata trong storage; chưa có admin dashboard hoặc quy trình phản hồi.
- Chưa có NPC, nhiệm vụ, tương tác ngồi ghế, nhạc nền, tiếng bước chân hoặc tài khoản game.
- Chat giới hạn sáu thành viên; private room scale tự động nhưng chưa có UI cho người chơi biết họ ở cùng instance với bạn bè nếu room đã đầy.
- Collision được xác thực bằng danh sách vùng tĩnh; chưa có physics server tick liên tục.
