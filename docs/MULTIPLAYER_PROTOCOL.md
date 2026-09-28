# Multiplayer protocol

WebSocket path: `/ws`. Identity nằm trong query `guestId`, `nickname`, `avatarId`, và danh sách block local `blocked`. Payload dùng JSON; server kiểm tra kiểu, membership và rate limit.

## Client → server

| type | Dữ liệu |
|---|---|
| `move` | `x`, `y`, `direction`, `moving` |
| `request_talk` | `targetId` |
| `request_join` | `conversationId` |
| `respond_request` | `requestId`, `accept` |
| `send_message` | `conversationId`, `text` |
| `leave_conversation` | `conversationId` |
| `update_blocks` | `blockedIds` |
| `report` | `targetId`, `reason` |

## Server → client

Server gửi `welcome`, `player_joined`, `player_left`, `players_moved`, `move_ack`, `request_received`, `request_closed`, `conversation_started`, `conversation_updated`, `conversation_ended`, `chat_message`, `system_notice` hoặc `error`.

`welcome` gửi room ID, self ID, player states và conversation membership. Tin nhắn server có timestamp và ID do server sinh. Message giới hạn 180 ký tự và lọc profanity căn bản trước khi broadcast.

## Giới hạn

- 36 client mỗi room, nhiều room dùng chung lobby Durable Object.
- Player snapshots phát theo nhịp client chuyển động, không gửi 60 full room snapshots/giây.
- Request hết hạn sau 25 giây, tối đa 8 request/phút/client.
- Chat tối đa 7 message/10 giây (khoảng cách tối thiểu 1,4 giây) và chặn nội dung lặp liên tiếp.
- Conversation tối đa sáu thành viên; message chỉ đến thành viên hiện tại và được lọc theo block list của người nhận.

Xem `shared/protocol.ts` để biết các union type và `server/worker.ts` để biết xử lý server.
