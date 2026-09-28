# Deployment

## Production architecture

Client được build bằng Vite. Production Worker phục vụ file tĩnh, `GET /api/health` và WebSocket `/ws`; binding `CITY_HUB` trỏ đến Durable Object `CityHub`. `wrangler.jsonc` khai báo binding, Durable Object migration `v1` và asset directory `dist`.

## Public release hiện tại

- URL: [https://kindred-town.talented-tumble.workers.dev](https://kindred-town.talented-tumble.workers.dev)
- Health: `https://kindred-town.talented-tumble.workers.dev/api/health`
- WebSocket: `wss://kindred-town.talented-tumble.workers.dev/ws`

Deployment này dùng temporary preview account vì môi trường chưa đăng nhập Cloudflare. Worker và Durable Object hoạt động công khai ngay bây giờ. Để giữ deployment, mở claim link do Wrangler tạo trong thời hạn hiển thị ở đầu ra deploy, đăng nhập hoặc tạo Cloudflare account rồi hoàn tất claim. Nếu không claim kịp, Cloudflare sẽ xóa preview deployment. [Cloudflare claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/) mô tả thời hạn và luồng claim.

Sau khi claim xong, có thể cập nhật deployment lâu dài từ account đó:

```sh
npm install
npm run build
npx wrangler login
npm run deploy:worker
```

Wrangler `4.102+` hỗ trợ temporary deployment. Không commit Cloudflare credentials hoặc production secrets. Worker không cần secret để host guest-only MVP.

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

Gọi `/api/health` để xác nhận Worker. WebSocket production upgrade từ cùng origin qua `wss://.../ws` khi trang dùng HTTPS. Static hosting thuần không đủ cho multiplayer.
