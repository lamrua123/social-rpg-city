# Architecture

## Các phần

### Frontend

React + TypeScript + Vite quản lý form, tabs, chat drawer, history, settings, reports và state kết nối. Phaser khởi động riêng trong `CityScene`; map, player, NPC, camera, collision và speech bubbles ở trong scene.

### Realtime backend

Cloudflare Worker phục vụ static assets, health endpoint và `/ws`. Binding `CITY_HUB` định tuyến đến một Durable Object. Actor giữ snapshot người chơi, phòng, nhóm, pending requests và giới hạn tần suất; WebSocket attachment giữ state cần để xử lý event. Durable Object Storage giữ metadata phòng, cooldown nickname, request timeout và structured reports; nội dung chat không ghi vào storage.

### Dữ liệu local

`kindred.guest.v1` lưu guest ID, nickname và avatar. `kindred.history.v1` lưu tối đa 40 cuộc trò chuyện, mỗi cuộc 80 message. `kindred.blocks.v1`, `kindred.mutes.v1` và `kindred.prefs.v1` giữ lựa chọn moderation/settings của browser.

## Di chuyển và collision

Phaser mô phỏng vị trí local ngay trên client để điều khiển mượt. Khoảng 17 lần/giây client gửi vị trí/direction. Server loại bước nhảy vô lý, áp speed limit, kiểm tra map bounds và `SOLID_AREAS`, sau đó phát snapshot chuyển động nhỏ cho room. Phaser nội suy player từ xa giữa các snapshot.

## Rooms

Mỗi room có 36 chỗ. Worker chọn room còn chỗ; khi đầy, room sequence tăng và người mới tự được đưa sang instance tiếp theo. Không có UI chọn shard.

## Deployment trade-off

Production cần WebSocket runtime serverless có state tập trung, nên MVP dùng Durable Objects. Giao thức WebSocket được viết trực tiếp thay vì Colyseus để giữ runtime tương thích với Worker deployment. Cấu hình Cloudflare Worker chuẩn cũng được giữ trong `wrangler.jsonc`. Bản public hiện dùng temporary preview account; cần claim trong thời hạn Wrangler hiển thị để giữ Worker và Durable Object.
