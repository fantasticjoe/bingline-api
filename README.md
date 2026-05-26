# Bingline API

A lightweight Bing wallpaper redirect and metadata API.

Bingline means “Bing + line”: a new line of Bing wallpaper every day.  
中文可以理解为：每天一行新的风景。

This project does not store images, does not archive history, and does not use a database, KV, R2, GitHub storage, or GitHub Actions.

It is only a light wrapper around Bing's homepage image data endpoint. That endpoint may change over time and is not treated here as a Microsoft-guaranteed stable public developer API.

Image copyright belongs to Microsoft, the original authors, or other relevant rights holders. This project does not claim image copyright.

Default domain assumption: `wall.0a.ink`.

## Routes

- `GET /`
- `GET /latest`
- `GET /api/latest`
- `GET /url`
- `GET /raw`

## Query Parameters

- `mkt`: Bing market, default `en-US`
- `idx`: relative date index, default `0`
- `res`: resolution, default `UHD`
- `mode`: `redirect` or `proxy`, default `redirect`
- `format`: `text` or `json`, default `text`
- `n`: raw metadata count, default `1`, max `8`

## `GET /latest`

Direct image endpoint for HTML and CSS:

```html
<img src="https://wall.0a.ink/latest">
```

```css
background-image: url("https://wall.0a.ink/latest");
```

By default this endpoint redirects to the resolved Bing image URL with `302`.

Examples:

- `GET /latest`
- `GET /latest?mkt=zh-CN`
- `GET /latest?mkt=ja-JP&mode=proxy`
- `GET /latest?mkt=en-US&res=1920x1080`
- `GET /latest?mkt=en-US&idx=1`

## `GET /api/latest`

Returns normalized JSON:

```json
{
  "date": "20260526",
  "endDate": "20260527",
  "market": "en-US",
  "title": "...",
  "copyright": "...",
  "copyrightLink": "https://www.bing.com/search?q=...",
  "image": "https://wall.0a.ink/latest?mkt=en-US&idx=0&res=UHD",
  "bingImageUrl": "https://www.bing.com/th?id=...",
  "resolution": "UHD",
  "source": "Bing",
  "sourceEndpoint": "HPImageArchive.aspx"
}
```

The `image` field points back to this service. The `bingImageUrl` field is the resolved Bing image URL. The `resolution` field reflects the actual resolved image, including fallback from `UHD` to `1920x1080` or `original`.

## `GET /url`

Returns only the resolved Bing image URL.

- `format=text`: returns `text/plain`
- `format=json`: returns `{"url":"..."}`

## `GET /raw`

Returns Bing's original JSON from:

```text
https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US
```

`n` is capped at `8`.

## Examples

- `GET /latest`
- `GET /latest?mkt=zh-CN`
- `GET /latest?mkt=ja-JP&mode=proxy`
- `GET /latest?mkt=en-US&res=1920x1080`
- `GET /api/latest`
- `GET /url`
- `GET /url?format=json`
- `GET /raw`
- `GET /raw?n=8`

## Cache And CORS

- `/latest` redirect: `Cache-Control: public, max-age=3600`
- `/latest?mode=proxy`: `Cache-Control: public, max-age=86400`
- `/api/latest`: `Cache-Control: public, max-age=3600`
- `/url`: `Cache-Control: public, max-age=3600`
- `/raw`: `Cache-Control: public, max-age=3600`
- JSON and text endpoints send `Access-Control-Allow-Origin: *`
- `OPTIONS` preflight returns `204`

Errors use this JSON shape:

```json
{
  "error": "Error message",
  "status": 502
}
```

## Local Development

```bash
npm install
npm run dev
npm run typecheck
npm run deploy
```

Run tests:

```bash
npm test
```

## Deploying To Cloudflare Workers

```bash
npm install
npm run typecheck
npm run deploy
```

## GitHub CI/CD

This repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

On pull requests to `main`, it runs:

```bash
npm ci
npm run typecheck
npm test
```

On pushes to `main`, it runs the same validation first, then deploys the Worker with Wrangler.

Add these repository secrets in **GitHub** -> **Settings** -> **Secrets and variables** -> **Actions**:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token allowed to edit/deploy Workers

Cloudflare's CI/CD environment is non-interactive, so Wrangler needs those two values as secrets. Do not commit API tokens to the repository.

To create a GitHub repository and push the project:

```bash
git init
git branch -M main
git add .
git commit -m "feat: initialize Bingline API"
gh repo create bingline-api --public --source=. --remote=origin --push
```

After the first push, GitHub Actions will run automatically. Future pushes to `main` will validate and deploy.

## Binding `wall.0a.ink`

1. Add `0a.ink` to Cloudflare DNS if it is not already managed there.
2. Deploy the Worker with `npm run deploy`.
3. In Cloudflare Dashboard, open **Workers & Pages**.
4. Select `bingline-api`.
5. Go to **Settings** -> **Triggers**.
6. Add a **Custom Domain**.
7. Enter `wall.0a.ink` and confirm.
8. Wait for Cloudflare to create the DNS route and certificate.

You can also bind a route such as `wall.0a.ink/*` from the Worker trigger settings if you prefer route-based configuration.

## Notes

- Default market: `en-US`
- Default idx: `0`
- Default n: `1`
- Default image mode: `302 redirect`
- JSON endpoints send `Access-Control-Allow-Origin: *`
- All responses use reasonable `Cache-Control` headers
