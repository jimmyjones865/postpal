# CODEMAP

Two independent Node packages: `/` = Vite/React/TS frontend, `/server` = Express (ESM JS). They talk only via `/api/*`.

## Server (`server/`)
- `index.js` — Express app: JSON body, `/api` router, static frontend, SPA fallback, graceful shutdown.
- `routes/api.js` — builds shared services, mounts sub-routers; health, credentials status, config, `GET/PATCH /settings`, parse-address; daily retention cleanup.
- `routes/labels.js` — list, `GET /:id/pdf` (`?print=1` → cropped), `POST /:id/print` (CUPS, saved settings), delete, refund (DHL retoure by voucherId), `POST /:id/refund/check` (retoure state → `refund.state` open/refunded/rejected), purchase (→ `lib/purchase.js`), recover by shopOrderId.
- `routes/wallet.js` — `POST /wallet/balance` (forces token refresh), `POST /wallet/charge` (Portokasse top-up via `lib/topups.js`).
- `routes/paket.js` — `/api/paket`: products by country (`ALL` = DE+EU union for the hide list), orders (GET/POST manual), cart-id fallback, `GET /pay/:id`, `GET /pay-all` (303 to DHL or small Nord HTML page).
- `routes/intake.js` — `GET /api/intake`: read-only merge of CM + Paket orders, newest first.
- `routes/tracked.js` — `GET /api/tracked`: CM tracked letters + all Paket orders not marked done, with country flag; `POST /:key/done` (`cm:<id>` / `paket:<id>`). State `tracked-done.json`: `since` = first use − 3 days (older = done), done marks pruned with their source order.
- `lib/settings.js` — UI-editable settings in `PDF_STORAGE_PATH/settings.json`; effective = override ?? env ?? default.
- `lib/config.js` — sender/printer env vars, `envNum`, `berlinDay`.
- `lib/purchase.js` — `buyLabel` (reserve shopOrderId → checkout → download → store) and `recoverLabel`; shared by UI route and CM intake.
- `lib/dhl-api.js` — Internetmarke client: auth token cache, cart, checkout, retrieve, wallet charge, refund + refund state; 30 s timeout.
- `lib/dhl-private-api.js` — DHL Parcel DE Private Shipping client: catalog + `catalogPrice`, `createCart`, `getCart`, `getLabel`.
- `lib/paket.js` — DHL Paket orders (`paket-orders.json`): pay links, pay-all, paid-mail polling → label → print, daily unpaid reminder.
- `lib/cm-intake.js` — Cardmarket email intake: IMAP poll → decide → buy → print → Discord; state in `cm-orders.json`.
- `lib/cm-email.js` — pure CM mail parsing + `decide` (all no-buy rules, Paket vs letter); tested. Items split name/set/rarity/lang; CM cuts lines at ~70 chars → lost parts null, a cut set keeps its prefix.
- `lib/plz-check.js` — DE PLZ vs city via OpenPLZ API; warn-only line in CM order summary, never blocks.
- `lib/discord.js` — webhook notices, never throws; `notify(text, { wait })` → message id, `editNotice(id, text)` (no time limit, edits don't ping).
- `lib/sales.js` — sale + postage push to turbostats (`SALES_URL`, off when unset); fire-and-forget, never throws, no retry. `saleFromMail` = payload (mail amount strings → numbers, country ISO3 only, no name/address).
- `lib/mail-archive.js` — mark handled mails read + move to archive folder.
- `lib/topups.js` — top-up limits + ledger `topups.json`, shared by UI and auto top-up.
- `lib/print-window.js` — Berlin-time print windows for CM intake.
- `lib/print-label.js` — `printStoredLabel`: crop → media size → rotate → CUPS; `printWithSettings` uses `settings.json` printer values.
- `lib/label-storage.js` — PDFs + `labels.json` metadata; retention cleanup.
- `lib/pdf-cropper.js` — pixel-scan content detection + page-box crop; rotation.
- `lib/cups-printer.js` — IPP Print-Job with explicit media size.
- `lib/european-address-parser.js` — heuristic parser; outputs German country names.
- `lib/address-rules.js` — DP charset allowlist, sanitize, DE `Straße` → `Str.`, field limits, name/additionalName swap; also bundled into the frontend.
- `lib/country-codes.js` — country name/ISO3 → ISO3, `countryFlag(iso3)` emoji; also bundled into the frontend.
- `lib/logger.js` — level-filtered console logger (`LOG_LEVEL`).
- `cm-shipping.json` — CM shipping cost → letter product code, or `paket.<ISO3|EU>.<cost>` → Paket product (`.<service>` = insurance); volume-mounted.
- `scripts/backfill-sales.js` — all CM ship mails (`MAIL_FOLDER`, read-only) + `labels.json` postage → turbostats; latest mail per order, idempotent, `--dry-run` = stats only. Run: `docker exec postpal node scripts/backfill-sales.js`. Letter postage = current `products.json` cost. Label → order: `cmOrderId` (letter top-level, Paket in `meta`), else unique name line + postcode match within 7 days after the mail (UI-bought labels; address never sent).
- `test/` — `npm test` (node:test) with anonymized fixtures; fake DHL client for `paket.js`.

## Frontend (`src/`)
- `pages/Index.tsx` — the only page: create / history / tracked / intake / settings tabs; owns recipient, product, balance, print-mode state.
- `services/labelService.ts` — every `/api` call; print/download pick CUPS vs browser print.
- `hooks/useConfig.ts` — settings via `/api/settings`, debounced PATCH.
- `hooks/useLabelPurchase.ts` — purchase flow: validation, auto product, country check, buy, print/download.
- `hooks/usePaket.ts` — Paket cards for the parsed country, order → DHL checkout tab.
- `hooks/useLabelHistory.ts` — label list state.
- `hooks/useAddressParser.ts`, `useDebounce.ts`, `useProducts.ts`, `useTranslation.ts` — small helpers.
- `components/AddressInput.tsx` — raw address textarea, print/download toggle, Ctrl+Enter.
- `components/ParsedAddressEditor.tsx` — debounced parse → editable fields that rewrite the raw text.
- `components/LabelResult.tsx` — last purchase: recipient preview, reprint/download, copy ID.
- `components/LabelHistory.tsx` — stored labels: tracking link, download, print, refund (status + manual check button in the row), delete.
- `components/ProductSelector.tsx` — letter product grid + DHL Paket section with optional recipient email; `hiddenProducts` hides letters and Paket (`paket:<id>[.<insurance>]`).
- `components/IntakeView.tsx` — Intake tab: open pay links, pay-all, recent CM + Paket orders; 30 s refresh.
- `components/TrackedView.tsx` — Tracked tab: letter/parcel quick filter (click again clears), table row per shipment (letter/parcel icon, paid date, buyer + flag, recipient, click-to-copy tracking, Done; mobile: tracking wraps below); unpaid Paket shows Pay / pay-all instead of Done; 30 s refresh.
- `components/SettingsPanel.tsx` — sender, printer/crop, product visibility, Automatik (intake) settings.
- `components/WalletBalance.tsx` — header balance, refresh, top-up chips.
- `components/ui/` — shadcn button/input/tabs/textarea/sonner; label, checkbox, select, scroll-area, confirm-dialog (`<dialog>`) are thin native wrappers.
- `lib/address.ts` — `ParsedAddress` type, empty value, raw-text formatter.
- `lib/addressValidation.ts` — line length + charset per line via `address-rules.js`.
- `lib/countryCodes.ts` — re-export of `server/lib/country-codes.js`.
- `lib/i18n.ts` — loads `public/locales/<lang>.json`, `t()` with `{param}`.
- `lib/clipboard.ts`, `lib/utils.ts` — copy with Safari fallback; `cn()`.
- `types/shipping.ts` — product + config types.

## Data (`public/`)
- `products.json` — letter products and prices; volume-mounted, edit without rebuild.
- `paper-formats.json` — DHL format IDs for the settings dropdown.
- `locales/{de,en}.json` — UI strings; language from `LANGUAGE` env via `/api/config`.

## Key wiring

### Labels, printing
- Stored PDFs are always the original; cropping happens per request. Endless-roll height comes from the crop result, so endless roll + crop failure = print error by design.
- Landscape: `print-label.js` remaps margins into portrait space before cropping, because the PDF is rotated 90° CW afterwards. Change one side and the other must change too.
- `dhl-paket` labels (MOPS 70×170 mm) get +2 mm top / +3 mm bottom on top of the settings margins (`PAKET_EXTRA_MM`).
- `pdf-cropper.js` thresholds and retry passes were tuned against real DHL labels — change only with real labels to test. Crop math assumes MediaBox starts at (0,0). Stays on `pdfjs-dist` 3.x (`NodeCanvasFactory._createCanvas` hack is v3-specific). `overrides` in `server/package.json` points pdfjs' optional `canvas` at the top-level 3.x; npm won't apply overrides to existing lock entries — delete them from `package-lock.json` and re-resolve. Alpine host has no canvas prebuild: local install needs `--ignore-scripts` (tests don't need canvas).
- `label-storage.js`: every metadata change goes through `updateMetadata` (queued load→mutate→save); writing `labels.json` directly loses concurrent changes.
- Shutdown (SIGTERM/SIGINT) drains requests and lets the CM poll finish its current order, capped at 150 s; compose `stop_grace_period` 160 s must stay above it.
- UI and CM intake share one printer/sender config (`settings.json`). CUPS print reads `settings.json` only; browser print/download still pass crop margins in the URL. `settings.json` holds only overrides; `null` in a PATCH drops one; validated on write (400).

### Internetmarke purchase
- Money moves at the checkout call. DHL accepts one checkout per shopOrderId, so a retry must reuse the id; never reserve a new one for an order whose outcome is unclear. After checkout the route must always return the shopOrderId/PDF link, even on failure.
- `DPOST_DIRECT_CHECKOUT=true` skips reserving a shopOrderId; DHL then ignores a passed id, so a lost direct response can't be looked up (→ `uncertain`, no id; intake → `check-manually`).
- Throw/timeout/non-JSON 2xx/duplicate reject/success without link → `recoverLabel` lookup; unconfirmed → `uncertain: true`; store fails → `paid: true`. DHL answers unknown ids with `400 unknownShopOrderId` — a lookup failure, not "not bought".
- PDF download allow-list: `https://*.deutschepost.de`.
- Every purchase sanitizes and swaps server-side (`prepareReceiver`): DHL prints `additionalName` above `name`, so input line 1 (person) goes to `additionalName` when both exist. Don't run it twice on the same receiver.
- Parser emits German country names; `country-codes.js` must cover each or the purchase is blocked. `address-rules.js` and `country-codes.js` are bundled into the frontend: no Node imports there.
- Top-ups: 10 € DHL minimum, `TOPUP_MAX_EUR` per charge, `TOPUP_DAILY_MAX_EUR` per Berlin day incl. auto. Ledger entry written `pending` before the DHL call; only `rejected` frees the cap (lost response/crash still counts).

### CM intake
- Off unless `MAIL_*` set. IMAP poll of `MAIL_FOLDER` (default `INBOX,Archive` — mail gets archived fast), server-side subject search, 7-day lookback.
- `lib/mail-archive.js`: CM mails of `bought`/`paket` orders, handled SOLD mails (posted or covered by a seen ship mail), applied cancel mails and DHL mails of `done` carts → `\Seen` + moved to `MAIL_ARCHIVE_FOLDER` (default `Archive`, empty = read-only). Other states stay in the inbox as a to-do. CM mails archive in the same poll, DHL mails on the next. Mails before `startedAt` untouched.
- Settings (dry run, daily cap, auto top-up, print windows) re-read at the start of every poll; a change after startup → one `⚙️` notice. LIVE without DHL creds or sender → dry run, notified once per missing set.
- Only mail from a `cardmarket.com` domain (+ DKIM pass when the top `Authentication-Results` exists); others → `foreign`, one notice, never recorded under the order ID.
- Dedupe by order ID only: CM sometimes sends the same ship mail twice minutes apart, and mail moves INBOX → Archive. An order is written `processing` before the DHL call (shopOrderId added once reserved); on restart those become `interrupted`.
- Each live poll first looks up `uncertain`/`bought-unstored`/`interrupted`/`error` orders older than 60 s: found → stored + printed; 404 → `retry`; `checkoutSent` without shopOrderId → `check-manually` (never auto-retried); `unknownShopOrderId` → reprocess with the same id, 1 retry, then `failed`. Recovery prints even outside the print window.
- Unexpected per-order errors → `error`, no retry; config errors (`cm-shipping.json`, `products.json`) fail the poll without recording.
- Daily label cap counts every possibly-paid state (all with `productCode` except `dry-run`/`failed`), Berlin days. Paket orders don't count.
- Auto top-up (`AUTO_TOPUP_EUR`, 0 = off) when balance < label price, capped by `AUTO_TOPUP_DAILY_MAX_EUR` and `TOPUP_DAILY_MAX_EUR`; unknown balance → no top-up.
- Print window (`PRINT_WINDOW_WEEKDAY`/`_WEEKEND`, Berlin, unset = 24 h): outside it a new order → `queued` + one `⏰` notice, no buy; first poll inside the window processes `queued` like `retry`.
- `✅` notice adds `📦 trackId` for tracked products (`trackId || voucherId`: DHL sends trackId only for international Einschreiben), then the address block.
- Never delete `cm-orders.json` while live — `startedAt` resets to now (safe), but dedupe history is gone. Orders/foreign pruned after 14 days.
- CM mail pads price columns with spaces and writes `1.234,56` above 1000 €; fixtures mirror that. Discord `allowed_mentions` off: buyer text is posted verbatim.
- SOLD mails (`Shipment N for X: SOLD` / `Bestellung N für X: Verkauf`, unpaid) → one `🟡 SOLD` message, id in `cm-orders.json` `sold` (pruned 14 d). First ship mail of that order edits it to `🟢 PAID after …` (silent; label notice still posts new, without the item list). `… has been cancelled[: reason]` / `Bestellung N für X wurde storniert[: …]` → `❌ CANCELLED`. Pass runs before the ship pass, archives handled mails (same poll); only mails after `soldSince` (first start with this feature). Skipped if the ship mail was seen first. SOLD → ship gap seen up to 8.4 days.
- Sales push (`lib/sales.js`): every genuine mail reaching `processMail` (skipped/dry-run/retry too; queued ones once the window opens) → sale, not awaited. Letter postage (`postageEur` = `products.json` cost, kept in the order record for recovery) on `bought`; Paket postage (`item.price`) when the label is stored. Upsert by shipment ID on turbostats' side.
- `cm-shipping.json` Paket keys are per destination (ISO3 beats `EU`) because costs collide across countries (EU Päckchen M = DE PAK10 = 11.49). Paket match wins over a letter code; unlisted cost = no label.

### DHL Paket
- Discord pay links are markdown `[Tailscale](<POSTPAL_URL…>) · [LAN](<POSTPAL_LOCAL_URL…>)`; UI/API still get plain `payUrl`.
- Payment is always manual in DHL's checkout (`entryUrl`); `createCart` returns no cart id. `notifyUrl` (`POSTPAL_URL/dhl-paid?order=<id>&cart=<n>`) is never called, only echoed by `getCart` — used as the order tag.
- Paid state comes from DHL's confirmation mail (`noreply@dhl.com` + DKIM, cart id in subject), polled with the CM IMAP client, also in dry run. Unpaid carts can't be looked up, so any order in a cart opened <30 min ago gets a confirm page instead of a new cart.
- Pay-all cart matches items by `position` (= request order) confirmed by plz, else unique plz + name (case/accent/truncation tolerant), else unique plz, else `⚠️` unmatched: no label, the cart's still-open orders → `check-manually` (out of pay-all + reminders). Single-order tag: all items belong to it. Tag path matched by suffix (`POSTPAL_URL` may carry a path).
- Each order → `done` as soon as its label is stored; a failed item marks the cart `error` (retried each poll, notified once) without holding back the others.
- Untagged carts (bought outside postpal) → log line only; tagged but unknown order → one notice; cart unknown at DHL (404/`WRONG_SCID`: sandbox test mail in the same mailbox, or a glitch) → notified once, retried 1 h, then `ignored`. 2nd paid cart for an order → stored + double-payment warning.
- DHL drops `addressAddition1` from German labels: DEU line 2 → `name3` (joined with additionalName, 35 together); other countries keep `addressAddition1` (printed after the street).
- CM letter to a DE Packstation/Postfiliale → skipped (Deutsche Post doesn't deliver letters there); UI letter buys unaffected.
- DE Packstation/Postfiliale (`pakLocker`, any line): needs a 6–10 digit Postnummer + a name, else skipped. Sent as name1 person, name2 Postnummer, street `Packstation`/`Postfiliale` + number (sandbox-tested). DHL only warns on an unknown station number — still payable.
- Paket needs a house number (`splitStreet`: trailing, or leading for FR-style `12 rue …`).
- Paket receivers: `prepareReceiver(…, { paket: true })` — sanitized, no letter swap, DHL limits (name/name3/street/addition/city 35, house number 10, plz 17; spec Private Shipping v1.2). Manual `POST /orders` checks product/insurance, DE+EU, catalog availability.
- Intake error after the Paket order exists → CM order `paket` + pay link, not "do it manually".
- CM orders get recipient email `shipment-<id>@cardmarket.com` (CM relay → DHL tracking mails reach the buyer). Non-DEU → `preAdvice PA_RETURN`. Region `EU` resolved via `EU_ISO3` (API has no member list).
- `paket.js` is serialized by one promise queue. Labels print with no print window.
- UI opens the DHL checkout tab before awaiting the order POST (popup blocker).
