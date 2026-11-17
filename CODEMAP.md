# CODEMAP

Two independent Node packages: `/` = Vite/React/TS frontend, `/server` = Express (ESM JS). They talk only via `/api/*`.

## Server (`server/`)
- `index.js` — Express app: JSON body, `/api` router, static frontend, SPA fallback. No CORS (same-origin only). SIGTERM/SIGINT drain in-flight requests and the CM poll (`stopCmIntake`, finishes the current order; 150s cap, compose `stop_grace_period` 160s).
- `routes/api.js` — builds shared services, mounts sub-routers; health, credentials status, config, parse-address; daily retention cleanup.
- `routes/labels.js` — `GET /labels`, `GET /labels/:id/pdf` (`?print=1` → cropped), `DELETE /labels/:id`, `POST /labels/:id/refund` (DHL retoure by voucherId, marks `refund` in metadata), `POST /labels/purchase` (→ `lib/purchase.js`), `POST /labels/recover` (stored label by shopOrderId; UI "Retrieve" toast action).
- `routes/print.js` — `POST /print` → `lib/print-label.js`.
- `lib/print-label.js` — `printStoredLabel`: crop → media size → rotate (landscape) → CUPS. Shared by `/print` and CM intake.
- `routes/wallet.js` — `POST /wallet/balance` (forces token refresh; balance comes with the auth response), `POST /wallet/charge` (Portokasse top-up, 10 € DHL min, `TOPUP_MAX_EUR` per charge, `TOPUP_DAILY_MAX_EUR` per day incl. auto).
- `lib/topups.js` — top-up limits + ledger `PDF_STORAGE_PATH/topups.json` shared by UI and auto. Entry written `pending` before the DHL call; only `rejected` frees the cap (lost response/crash still counts). Days = Berlin.
- `lib/purchase.js` — `buyLabel`: `prepareReceiver` → [`DHL_TWO_STEP`, default true: reserve shopOrderId (`POST /app/shoppingcart`, or reuse for a retry)] → `beforeCheckout` (caller persists "checkout sent") → checkout (direct, or two-step without `directCheckout`) → download PDF → store with DHL's returned shopOrderId. Direct checkout ignores a passed shopOrderId, so a lost direct response can't be looked up (→ `uncertain`, no id; intake → `check-manually`). Success without link → treated as uncertain. Shared by the UI route and CM intake. Throw/timeout/non-JSON 2xx/duplicate reject → `recoverLabel` lookup; unconfirmed → `uncertain: true`; store fails → `paid: true`. `recoverLabel`: existing label by shopOrderId, else `GET /app/shoppingcart/{id}` → store; 404 → `notFound`. PDF host allow-list `https://*.deutschepost.de`.
- `lib/address-rules.js` — charset allowlist, sanitize (replacement map + NFD strip), field limits, name/additionalName swap. Imported by the frontend too.
- `lib/country-codes.js` — country name/ISO3 → ISO3. Imported by the frontend too.
- `lib/cm-intake.js` — Cardmarket email intake: read-only IMAP poll of `MAIL_FOLDER` (default `INBOX,Archive` — mail gets archived fast), server-side subject search, 7-day lookback, chunked fetch. State in `PDF_STORAGE_PATH/cm-orders.json`, buy → print → Discord. Off unless `MAIL_*` set; `CM_DRY_RUN` defaults true. Only mail from a `cardmarket.com` domain (+ DKIM pass when the top `Authentication-Results` exists); others → `foreign` (one Discord notice, never recorded under the order ID). Daily label cap counts every possibly-paid state (all with `productCode` except `dry-run`/`failed`), Berlin days. LIVE refused (→ dry run) when DHL creds or sender are missing. Auto top-up (`AUTO_TOPUP_EUR`, 0 = off) when balance < label price, capped by `AUTO_TOPUP_DAILY_MAX_EUR` (auto only, default one top-up/day) and `TOPUP_DAILY_MAX_EUR`; unknown balance → no top-up. Orders/foreign pruned after 14 days. Orders store shopOrderId + purchase fields; each live poll first looks up `uncertain`/`bought-unstored`/`interrupted`/`error` orders older than 60s: found → stored + printed, 404 → `retry`; `checkoutSent` without shopOrderId → `check-manually` (never auto-retried); DHL answers unknown ids with `400 unknownShopOrderId`, treated as lookup failure, not "not bought" (mail reprocessed with the same shopOrderId, 1 retry, then `failed`).
- `lib/cm-email.js` — subject filter (order ID + buyer), sender check (`senderProblem`, `topHeader`), body parse (order ID, address block, shipping cost), `decide` = all no-buy rules incl. email-only city-has-letter / street-has-digit. Pure, tested.
- `lib/discord.js` — webhook notice, never throws; `allowed_mentions` off (buyer text is posted verbatim). Order notices start with `buyer: N items @ total €` (quantities summed, total incl. shipping, from the mail; stored as `summary`).
- `cm-shipping.json` — CM shipping cost (EUR) → product code; unlisted cost = no label. Volume-mounted read-only.
- `test/` — `npm test` (node:test) on `cm-email.js`, `address-rules.js`, `topups.js`, `purchase.js` (fake DHL client) with anonymized fixtures.
- `lib/dhl-api.js` — 30s timeout on every call. Internetmarke auth with in-memory token cache, cart init, purchase payload (with shopOrderId), purchase call, cart retrieve, wallet charge, voucher refund.
- `lib/label-storage.js` — PDFs + `labels.json` metadata in `PDF_STORAGE_PATH`. Retention cleanup (startup + daily): indexed labels by `createdAt`, unindexed `.pdf`/`.png` by file mtime.
- `lib/pdf-cropper.js` — pixel-scan content detection + page-box crop; rotation.
- `lib/cups-printer.js` — IPP Print-Job with explicit media size.
- `lib/european-address-parser.js` — heuristic parser; outputs German country names.
- `lib/config.js` — env vars → server-side UI defaults (only keys actually set); `envNum`, `berlinDay`.
- `lib/logger.js` — level-filtered console logger (`LOG_LEVEL`).

## Frontend (`src/`)
- `pages/Index.tsx` — the only page: create / history / settings tabs; owns recipient, product, balance, print-mode state.
- `services/labelService.ts` — every `/api` call; `printLabel` / `downloadLabel` take `PrinterConfig` and pick CUPS vs browser print.
- `hooks/useConfig.ts` — localStorage config merged with code + server defaults; credentials status.
- `hooks/useLabelPurchase.ts` — purchase flow: validation, auto product, country check, buy, then print/download.
- `hooks/useLabelHistory.ts` — label list state.
- `hooks/useAddressParser.ts`, `hooks/useDebounce.ts`, `hooks/useProducts.ts`, `hooks/useTranslation.ts` — small helpers.
- `components/AddressInput.tsx` — raw address textarea, print/download toggle, Ctrl+Enter.
- `components/ParsedAddressEditor.tsx` — debounced parse → editable fields; edits rewrite the raw text.
- `components/LabelResult.tsx` — recipient preview, reprint/download, copy ID for the last purchase.
- `components/LabelHistory.tsx` — stored labels: copy ID, tracking link, download (uncropped), print, refund (confirm dialog; hidden once requested), delete.
- `components/ProductSelector.tsx` — product grid by domestic/international + group.
- `components/SettingsPanel.tsx` — sender, printer/crop, product visibility.
- `components/WalletBalance.tsx` — header balance with refresh and top-up chips (10/25/50 €).
- `components/ui/` — shadcn primitives.
- `lib/address.ts` — `ParsedAddress` type, empty value, raw-text formatter.
- `lib/addressValidation.ts` — line length + charset per line, via `server/lib/address-rules.js`.
- `lib/countryCodes.ts` — re-export of `server/lib/country-codes.js`.
- `lib/i18n.ts` — loads `public/locales/<lang>.json`, `t()` with `{param}` substitution.
- `lib/clipboard.ts`, `lib/utils.ts` — copy with Safari fallback; `cn()`.
- `types/shipping.ts` — product + config types.

## Data (`public/`)
- `products.json` — products and prices; volume-mounted read-only in Docker, edit without rebuild.
- `paper-formats.json` — DHL format IDs for the settings dropdown.
- `locales/{de,en}.json` — UI strings; language from `LANGUAGE` env via `/api/config`.

## Key wiring
- Stored PDFs are always the original; cropping happens per request. Endless-roll height comes from the crop result, so endless roll + crop failure = print error by design.
- Landscape: `print-label.js` remaps margins into portrait space before cropping, because the PDF is rotated 90° CW afterwards. Change one side and the other must change too.
- `pdf-cropper.js` detection thresholds and retry passes were tuned against real DHL labels — change only with real labels to test against. Crop math assumes the source MediaBox starts at (0,0). Stays on `pdfjs-dist` 3.x (its `NodeCanvasFactory._createCanvas` hack is v3-specific).
- `label-storage.js`: every metadata change goes through `updateMetadata` (one queued load→mutate→save); writing `labels.json` directly loses concurrent changes.
- Money moves at the checkout call. DHL accepts one checkout per shopOrderId, so a retry must reuse the id; never reserve a new one for an order whose outcome is unclear. After checkout the route must always return the shopOrderId/PDF link, even on failure.
- CM intake dedupes by order ID only: CM sometimes sends the same ship mail twice minutes apart (3× in 2026), and mail moves INBOX → Archive. An order is written as `processing` before the DHL call (shopOrderId added once reserved); on restart those become `interrupted` and go through the lookup. Unexpected per-order errors → `error`, no retry; config errors (`cm-shipping.json`, `products.json`) fail the poll without recording. Never delete `cm-orders.json` while live — `startedAt` resets to now, which is safe, but dedupe history is gone.
- CM intake prints with `.env` printer settings (`loadServerConfig`), not the browser's localStorage settings.
- `favoriteProducts` in config is a list of **hidden** products (legacy name, kept for localStorage compatibility).
- `server/lib/address-rules.js` and `country-codes.js` are bundled into the frontend: no Node imports there.
- Every purchase sanitizes and swaps server-side (`prepareReceiver`): DHL prints `additionalName` above `name`, so input line 1 (person) goes to `additionalName` when both exist. Don't run it twice on the same receiver.
- Parser emits German country names; `country-codes.js` must cover each of them or the purchase is blocked.
