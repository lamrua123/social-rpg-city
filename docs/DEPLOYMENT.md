# Deployment

## Bản public hiện tại

- Link chơi: [https://lamrua123.github.io/social-rpg-city/](https://lamrua123.github.io/social-rpg-city/)
- Máy chủ Worker: [https://kindred-town.talented-tumble.workers.dev](https://kindred-town.talented-tumble.workers.dev)
- Health: `https://kindred-town.talented-tumble.workers.dev/api/health`
- WebSocket: `wss://kindred-town.talented-tumble.workers.dev/ws`

GitHub Actions build giao diện với base path `/social-rpg-city/` rồi triển khai lên GitHub Pages mỗi khi có commit mới trên `main`. Giao diện kết nối WebSocket tới Worker bên trên vì Pages chỉ phục vụ file giao diện, không chạy Durable Objects.

## Kiến trúc production

Client được build bằng Vite. Cloudflare Worker phục vụ `GET /api/health` và WebSocket `/ws`; binding `CITY_HUB` trỏ đến Durable Object `CityHub`. `wrangler.jsonc` khai báo binding, Durable Object migration `v1` và thư mục asset `dist`.

Muốn cập nhật riêng Worker sau khi chỉnh server, đăng nhập Cloudflare bằng Wrangler rồi chạy:

```sh
npm install
npm run build
npx wrangler login
npm run deploy:worker
```

Không commit Cloudflare credentials hoặc production secrets. Worker không cần secret để host guest-only MVP.

## Local preview

```sh
npm run dev:server
npm run dev
```

`npm run preview` chỉ preview frontend build; mở cùng với Worker runtime riêng để kiểm tra multiplayer. `npm run smoke` và `npm run smoke:browser` dùng local Worker mặc định. Có thể trỏ smoke test tới production:

```powershell
$env:KINDRED_BASE_URL = "https://kindred-town.talented-tumble.workers.dev"
$env:KINDRED_WS_URL = "wss://kindred-town.talented-tumble.workers.dev/ws"
npm run smoke
npm run smoke:browser
```

## Health check

Gọi `/api/health` để xác nhận Worker. WebSocket production upgrade qua `wss://.../ws` khi trang dùng HTTPS. Static hosting thuần không đủ cho multiplayer nếu không kết nối Worker.
