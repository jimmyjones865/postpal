# CODEMAP

Two independent Node packages: `/` = Vite/React/TS frontend, `/server` = Express (ESM JS). They talk only via `/api/*`.

## Server (`server/`)
- `index.js` — Express app: JSON body, `/api` router, static frontend, SPA fallback. No CORS (same-origin only).
- `routes/api.js` — builds shared services, mounts sub-routers; health, credentials status, config, parse-address; daily retention cleanup.
- `routes/labels.js` — `GET /labels`, `GET /labels/:id/pdf` (`?print=1` → cropped), `DELETE /labels/:id`, `POST /labels/purchase` (buy → download PDF → store).
- `routes/print.js` — `POST /print`: crop → media size → rotate (landscape) → CUPS.
- `routes/wallet.js` — `POST /wallet/balance` (forces token refresh; balance comes with the auth response).
- `lib/dhl-api.js` — Internetmarke auth with in-memory token cache, purchase payload, purchase call.
- `lib/label-storage.js` — PDFs + `labels.json` metadata in `PDF_STORAGE_PATH`.
- `lib/pdf-cropper.js` — pixel-scan content detection + page-box crop; rotation.
- `lib/cups-printer.js` — IPP Print-Job with explicit media size.
- `lib/european-address-parser.js` — heuristic parser; outputs German country names.
- `lib/config.js` — env vars → server-side UI defaults (only keys actually set).
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
- `components/LabelHistory.tsx` — stored labels: copy ID, tracking link, download (uncropped), print, delete.
- `components/ProductSelector.tsx` — product grid by domestic/international + group.
- `components/SettingsPanel.tsx` — sender, printer/crop, product visibility.
- `components/WalletBalance.tsx` — header balance with refresh.
- `components/ui/` — shadcn primitives.
- `lib/address.ts` — `ParsedAddress` type, empty value, raw-text formatter.
- `lib/addressValidation.ts` — Deutsche Post line length + charset rules.
- `lib/countryCodes.ts` — country name/ISO3 → ISO3.
- `lib/i18n.ts` — loads `public/locales/<lang>.json`, `t()` with `{param}` substitution.
- `lib/clipboard.ts`, `lib/utils.ts` — copy with Safari fallback; `cn()`.
- `types/shipping.ts` — product + config types.

## Data (`public/`)
- `products.json` — products and prices; volume-mounted read-only in Docker, edit without rebuild.
- `paper-formats.json` — DHL format IDs for the settings dropdown.
- `locales/{de,en}.json` — UI strings; language from `LANGUAGE` env via `/api/config`.

## Key wiring
- Stored PDFs are always the original; cropping happens per request. Endless-roll height comes from the crop result, so endless roll + crop failure = print error by design.
- Landscape: `print.js` remaps margins into portrait space before cropping, because the PDF is rotated 90° CW afterwards. Change one side and the other must change too.
- `pdf-cropper.js` detection thresholds and retry passes were tuned against real DHL labels — change only with real labels to test against. Crop math assumes the source MediaBox starts at (0,0). Stays on `pdfjs-dist` 3.x (its `NodeCanvasFactory._createCanvas` hack is v3-specific).
- `label-storage.js`: every metadata change goes through `updateMetadata` (one queued load→mutate→save); writing `labels.json` directly loses concurrent changes.
- Purchase is not idempotent and money moves at the DHL call; after that the route must always return the PDF link, even on failure.
- `favoriteProducts` in config is a list of **hidden** products (legacy name, kept for localStorage compatibility).
- Parser emits German country names; `countryCodes.ts` must cover each of them or the purchase is blocked.
