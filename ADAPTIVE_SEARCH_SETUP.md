# 9Router option → Adaptive Search v0.2.0 (Oracle VPS)

Select **9Router · AI + tìm kiếm trên VPS** in the extension. It now uses the **Adaptive Search backend** endpoint, **not** direct 9Router /v1/chat/completions or /v1/search.

## One-line setup

The popup displays one connection field. Paste:

```
https://YOUR-ADAPTIVE-BACKEND.trycloudflare.com | APP_API_KEY
```

- Use the **Adaptive Search backend** HTTPS URL (port 8765 on the VPS), **not** the 9Router tunnel (port 20128).
- `APP_API_KEY` is the *client* key created by the backend setup, **not** `ROUTER_API_KEY`.
- Leave the URL as the root; `/v1` or `/v1/answer` also work. Never put the API key in the URL.
- The extension keeps credentials in `chrome.storage.session` / worker memory, not local disk. They are cleared after Chrome fully exits.
- On the same Chrome session, you can click Start again without reentering the connection.
- Server-side: Gemini primary, combo1 fallback, SearXNG (Adaptive mode searches only when needed).

To expose the existing backend for a **temporary development test**, on the VPS:

```bash
curl -fsS http://127.0.0.1:8765/health
sudo docker rm -f adaptive-search-tunnel 2>/dev/null || true
sudo docker run -d --name adaptive-search-tunnel --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://127.0.0.1:8765
sudo docker logs --tail 50 adaptive-search-tunnel
```

Look for `https://...trycloudflare.com` and paste it with `APP_API_KEY` in the extension. For a stable deployment use Cloudflare Named Tunnel and an access-control layer, rather than publishing a long-lived app key through a public Quick Tunnel. The URL changes if the Quick Tunnel is recreated.

## Compatibility / limitations

- Applies only to the **9Router** option. Other providers are unchanged.
- The existing Canvas/SCORM integrations receive numeric answer indexes as before.
- Adaptive Search v0.2.0 currently supports **single-answer** multiple-choice questions with **2–8 options**. Unsupported multi-answer questions are explicitly rejected, never guessed.
- Source snippets are references, not proof that a claim has been independently verified.
- Questions plus answer options are sent to the remote VPS when this provider is selected.
- Internet access, a running backend, a working tunnel, and a valid session key are required.
- To test: `npm test` in the repository root, then load the `extension/` folder with Chrome Developer mode.
