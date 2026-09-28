# Chat safety

## Input và hiển thị

- Nickname được chuẩn hóa NFKC, bỏ ký tự HTML, kiểm tra 2–16 ký tự và lọc một danh sách profanity nhỏ.
- Server giới hạn đổi nickname còn một lần mỗi 30 giây cho cùng guest ID.
- Message được chuẩn hóa, bỏ tag delimiters và ký tự điều khiển, giới hạn 180 ký tự và lọc profanity cơ bản.
- React hiển thị plain text; Phaser dùng text object. Không có `innerHTML` hoặc HTML từ client.

## Rate limit và xác thực

- Server kiểm tra identity/avatar hợp lệ, room membership, khoảng cách chat, conversation membership, giới hạn sáu người và tốc độ di chuyển.
- Request có cooldown 25 giây, tối đa tám request trong 60 giây. Tin nhắn cần cách nhau tối thiểu 1,4 giây; nội dung lặp trong 30 giây bị từ chối.
- Report giới hạn ba lần mỗi 10 phút/client và chỉ được gửi cho người online cùng room.
- Server không ghi nội dung chat hoặc log raw message.

## Block, mute, report

- Block lưu bằng guest ID local, tồn tại qua reload trong browser và được gửi lại khi kết nối/reconnect. Server không gửi request/message của guest bị block tới client đó.
- Mute lọc message tại client, không báo cho người bị mute.
- Report lưu `reporter guest ID`, `target guest ID`, reason enum, room và timestamp; tối đa 100 report metadata gần nhất. Không đính kèm transcript, IP hay profile thật.

## Phạm vi moderation

Bộ lọc profanity chỉ là lớp cơ bản; chưa có human review, dashboard, escalation hoặc identity verification. Dự án không yêu cầu tài khoản và không thể ngăn người chơi mở browser/profile mới để tạo guest ID mới.
