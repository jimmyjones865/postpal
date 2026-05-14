# Post Pal

Self-hosted web app for purchasing and printing Deutsche Post / DHL shipping labels. Connects to the DHL Internetmarke API (Portokasse), stores purchased label PDFs locally, and can print directly to a label printer via CUPS/IPP.

## Requirements

- Docker + Docker Compose
- DHL Business Customer account with Internetmarke API access (API key + Portokasse credentials)

## Setup

**1. Copy and fill in credentials**

```sh
cp .env.example .env
```

At minimum, set your DHL credentials:

```env
DHL_API_KEY=...
DHL_API_SECRET=...
DHL_PORTOKASSE_LOGIN=...
DHL_PORTOKASSE_PASSWORD=...
```

**2. Start**

```sh
docker compose up -d
```

Open `http://localhost:3001` and configure your sender address in Settings.

## Optional: server-side defaults

Any settings configured in `.env` become UI defaults that survive container restarts. Users can still override them in the browser. Useful for shared installs or kiosk setups.

```env
# Sender address
SENDER_NAME=Max Mustermann
SENDER_STREET=Musterstraße 123
SENDER_POSTAL_CODE=10115
SENDER_CITY=Berlin
SENDER_COUNTRY=DE

# Label printer (CUPS)
CUPS_URL=http://192.168.1.100:631
CUPS_PRINTER_NAME=DYMO_LabelWriter_450
ENABLE_DIRECT_PRINT=true
PAPER_FORMAT_ID=176        # numeric DHL format ID
PAPER_WIDTH_MM=62
ENDLESS_ROLL=true

# UI language
LANGUAGE=de                # de | en
```

See `.env.example` for all available options.

## Printing

Two modes, selectable in the UI:

- **Direct print** — sends the label PDF to a CUPS server via IPP. Requires `CUPS_URL` and a printer name. Works with label printers (DYMO, Brother, etc.).
- **Download** — downloads the cropped PDF for manual printing.

### Bundled CUPS server

If you don't have an existing CUPS instance, use the included CUPS sidecar:

```sh
docker compose -f docker-compose.cups.yml up -d
```

CUPS web admin: `http://localhost:631` (default login: `print` / `print`)

## Paper format ID

The DHL API requires a numeric format ID for the label PDF layout. Find your ID in the format selector under Settings → Printer — the ID is stored alongside the name when you select a format. Set `PAPER_FORMAT_ID` in `.env` to lock it server-side.

## Updating product prices

Product prices are in `public/products.json`, mounted as a read-only volume. Edit the file and restart the container — no rebuild needed.

```sh
docker compose restart
```

## Label storage

Purchased label PDFs are stored in a named Docker volume (`labels-data`). Labels are automatically deleted after `RETENTION_DAYS` days (default: 60).
