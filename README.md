# Kindred — a little town to meet in

Một thành phố pixel-art nhỏ để mọi người đi bộ tới gần nhau rồi trò chuyện. Không cần tài khoản, email hay mật khẩu.

## Chạy ở máy cá nhân

Yêu cầu Node.js 22 trở lên.

```sh
npm install
npm run dev:server
```

Mở một terminal khác trong thư mục dự án:

```sh
npm run dev
```

Vite mở giao diện ở `http://localhost:5199`; Worker và Durable Objects chạy cục bộ qua Wrangler ở `http://127.0.0.1:8787`. Vite tự chuyển tiếp `/ws` và `/api` đến Worker.

## Bản public

- Thành phố: [https://kindred-town.talented-tumble.workers.dev](https://kindred-town.talented-tumble.workers.dev)
- WebSocket: `wss://kindred-town.talented-tumble.workers.dev/ws`

Frontend và realtime server được phục vụ cùng origin bởi Cloudflare Worker. Bản hiện tại chạy trong temporary preview account; hãy claim link Wrangler tạo trong thời hạn hiển thị ở đầu ra deploy để giữ Worker và Durable Object. Claim link chỉ gửi trực tiếp cho người dùng, không lưu trong repository. Xem [hướng dẫn deploy](docs/DEPLOYMENT.md).

## Build và kiểm tra

```sh
npm run build
npm run smoke
npm run smoke:browser
```

`smoke` mở nhiều WebSocket client độc lập để kiểm tra presence, di chuyển, chat 1-1 và nhóm, từ chối, block, rate limit, report, disconnect và reconnect. `smoke:browser` mở các Chrome context riêng để kiểm tra UI multiplayer, lịch sử local và màn hình desktop, tablet, mobile. Chrome mặc định ở `C:\Program Files\Google\Chrome\Application\chrome.exe`; nếu máy dùng đường dẫn khác, đặt `KINDRED_CHROME_PATH`.

Ảnh QA gần nhất được tạo trong `artifacts/qa/` và không thuộc source commit.

## Kiến trúc

- **React + TypeScript + Vite** quản lý landing, avatar, chat, lịch sử, settings và safety UI.
- **Phaser** vẽ thành phố và người chơi, xử lý camera, bàn phím, chạm và collision. React không dựng sprite hay map.
- **Cloudflare Worker + Durable Objects** làm máy chủ WebSocket có state dùng chung. Durable Object quản lý người chơi, chuyển động, phòng, nhóm trò chuyện, yêu cầu tham gia và report metadata.
- **Browser localStorage** giữ guest identity, block/mute list, settings và tối đa 40 cuộc trò chuyện với 80 tin nhắn mỗi cuộc.

Protocol dùng JSON nhỏ. Client gửi chuyển động khoảng 17 lần/giây; server giới hạn tốc độ, tọa độ, ranh giới map và vùng va chạm rồi phát vị trí người chơi cho room. Phòng có 36 người; room tiếp theo được tạo tự động.

## Điều khiển

- Đi bộ: `WASD` hoặc phím mũi tên.
- Tương tác: `E`, `Space` hoặc nút tương tác trên màn hình.
- Điện thoại: dùng directional pad; chat mở thành drawer.
- Chạm gần người chơi để gửi request. Chat riêng không có global room.

## Safety và moderation

Nickname và message được chuẩn hóa ở client lẫn server. Server giới hạn nickname 2–16 ký tự, đổi tên mỗi 30 giây, chat 180 ký tự, tốc độ gửi và request, phát hiện tin nhắn lặp, kiểm tra membership trước khi nhận chat và request. Chat render dạng plain text, không dùng HTML.

- **Block**: lưu bằng guest ID trong localStorage; server bỏ qua request và message của guest đó trong browser đã block, Phaser ẩn avatar tại browser đó.
- **Mute**: chỉ ẩn message ở browser hiện tại.
- **Report**: lưu reason, room và hai guest ID trong bộ đệm 100 report trên server; không gửi transcript.
- Server không lưu nội dung chat. Lịch sử local chỉ được lưu khi setting bật.

## Triển khai

Source dùng Cloudflare Workers Static Assets và Durable Objects cho town hub. `wrangler.jsonc` khai báo binding `CITY_HUB`, migration `v1` và thư mục asset. Bản public hiện chạy bằng temporary Cloudflare preview account; claim account để giữ lại deployment.

Hướng dẫn phát hành và URL production hiện tại nằm trong [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## License và assets

Sprite nhân vật, cây, nhà, fountain, map, avatar thumbnails và favicon được vẽ bằng code riêng trong repository; không sử dụng game art hoặc asset bên ngoài. Phaser, React, Vite và lucide-react là các dependency phát hành theo giấy phép permissive/MIT; xem `package-lock.json` và metadata của từng package để biết chi tiết.

## Tài liệu dự án

- [PRODUCT_VISION.md](docs/PRODUCT_VISION.md)
- [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [MULTIPLAYER_PROTOCOL.md](docs/MULTIPLAYER_PROTOCOL.md)
- [CHAT_SAFETY.md](docs/CHAT_SAFETY.md)
- [DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)
