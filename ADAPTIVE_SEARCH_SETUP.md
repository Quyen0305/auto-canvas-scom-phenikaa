# 9Router → Adaptive Search VPS

The Chrome popup now requires **only APP_API_KEY** for the 9Router option. Gemini, combo1 and SearXNG are selected by the VPS backend automatically.

## Configure the backend URL once

Set `globalThis.ADAPTIVE_BACKEND_URL` in `extension/adaptive-config.js` to your publicly reachable **Adaptive Search (port 8765)** HTTPS address:

```js
globalThis.ADAPTIVE_BACKEND_URL = 'https://YOUR-ADAPTIVE-SEARCH.trycloudflare.com';
```

**Important:** The repository is public. Commit only the **public URL**, never the `APP_API_KEY` or `ROUTER_API_KEY`. For a permanent setup, use a stable Cloudflare Named Tunnel; Quick Tunnel URLs are temporary and must be updated in the file when they change. The URL of the *9Router* tunnel (port 20128) is NOT the correct endpoint.

Then reload the unpacked extension at `chrome://extensions`. Choose 9Router and paste **APP_API_KEY only**. It is kept in session storage/worker memory, never the on-disk settings.

## Logs

For Adaptive answers, SCORM popup reports the most recent method; Canvas status reports the chosen method per question:

- `AI trực tiếp · gemini-3.5-flash-lite · 10s` — backend did not search the web.
- `AI + Search · gemini-3.5-flash-lite · 12s` — backend used SearXNG search.

These are method indicators, not proof of answer accuracy. The extension does not store question/answer archives.

## Connect for testing

```bash
curl -fsS http://127.0.0.1:8765/health
sudo docker logs --tail 100 adaptive-search-tunnel
```

Use the *latest* HTTPS Quick Tunnel for port 8765, copied into `extension/adaptive-config.js`. The key is only entered manually in Chrome.

## Limitations

- Adaptive Search backend v0.2.0 supports single-answer multiple choice with 2–8 choices. Multi-answer and unsupported formats stop rather than guess.
- Every selected question (text and options) is transmitted over HTTPS to your VPS.
- For production, protect the endpoint with appropriately scoped authentication and a stable domain.
- Test with `npm test` locally, then load `extension/` in Chrome developer mode.
