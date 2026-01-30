
# Graceful CUPS Integration (Works with Both Compose Files)

## The Issue

The planned CUPS integration adds:
1. A backend `/cups/defaults` endpoint that reads `DEFAULT_CUPS_URL` from environment
2. Frontend logic to auto-apply CUPS defaults

When using the original `docker-compose.yml` (without CUPS), the `DEFAULT_CUPS_URL` environment variable won't exist. We need to ensure this doesn't cause errors or unexpected behavior.

## Safety Analysis

### Backend: `/cups/defaults` Endpoint

The endpoint is already safe:
```javascript
router.get('/cups/defaults', (req, res) => {
  const defaultCupsUrl = process.env.DEFAULT_CUPS_URL || '';  // Falls back to empty string
  res.json({ 
    cupsUrl: defaultCupsUrl,
    configured: Boolean(defaultCupsUrl)  // Will be false
  });
});
```

When `DEFAULT_CUPS_URL` is not set, it returns `{ cupsUrl: '', configured: false }`.

### Frontend: `useConfig.ts` Auto-Apply Logic

The planned logic needs proper guards:

```typescript
useEffect(() => {
  async function checkCupsDefaults() {
    // Guard 1: Skip if user already configured a CUPS URL
    if (config.printerConfig.cupsUrl) return;
    
    try {
      const response = await fetch('/api/cups/defaults');
      if (response.ok) {
        const data = await response.json();
        // Guard 2: Only apply if server actually has a configured URL
        if (data.configured && data.cupsUrl) {
          updatePrinterConfig({ cupsUrl: data.cupsUrl });
        }
      }
      // Guard 3: Silently ignore non-ok responses (endpoint might not exist in older versions)
    } catch (e) {
      // Guard 4: Silently fail - CUPS defaults are optional
      console.debug('CUPS defaults not available');
    }
  }
  
  if (isLoaded) {
    checkCupsDefaults();
  }
}, [isLoaded]);
```

## Implementation

### File: `server/routes/api.js`

Add the `/cups/defaults` endpoint after `/credentials/status`:

```javascript
/**
 * GET /cups/defaults - Get default CUPS configuration
 * Returns pre-configured CUPS URL if set via environment
 * Safe to call even when DEFAULT_CUPS_URL is not set
 */
router.get('/cups/defaults', (req, res) => {
  const defaultCupsUrl = process.env.DEFAULT_CUPS_URL || '';
  res.json({ 
    cupsUrl: defaultCupsUrl,
    configured: Boolean(defaultCupsUrl)
  });
});
```

### File: `src/hooks/useConfig.ts`

Add a new effect to check for CUPS defaults (after the existing effects):

```typescript
// Check for server-provided CUPS defaults (for docker-compose.cups.yml users)
useEffect(() => {
  async function checkCupsDefaults() {
    // Don't override if user already has CUPS configured
    if (config.printerConfig.cupsUrl) return;
    
    try {
      const response = await fetch('/api/cups/defaults');
      if (response.ok) {
        const data = await response.json();
        if (data.configured && data.cupsUrl) {
          updatePrinterConfig({ cupsUrl: data.cupsUrl });
        }
      }
    } catch {
      // Silently ignore - CUPS defaults are optional
    }
  }
  
  if (isLoaded) {
    checkCupsDefaults();
  }
}, [isLoaded, config.printerConfig.cupsUrl]);
```

## Behavior Matrix

| Compose File | `DEFAULT_CUPS_URL` | Endpoint Response | Frontend Behavior |
|--------------|-------------------|-------------------|-------------------|
| `docker-compose.yml` | Not set | `{ cupsUrl: '', configured: false }` | Does nothing |
| `docker-compose.cups.yml` | `http://cups:631` | `{ cupsUrl: 'http://cups:631', configured: true }` | Auto-fills CUPS URL |
| Either (user already configured) | Any | Any | Skipped entirely |

## Files to Modify

| File | Change |
|------|--------|
| `server/routes/api.js` | Add `/cups/defaults` endpoint (~6 lines) |
| `src/hooks/useConfig.ts` | Add CUPS defaults effect (~15 lines) |

## New Files to Create

| File | Description |
|------|-------------|
| `docker-compose.cups.yml` | Compose file with CUPS service included |
| `cups/cupsd.conf` | Custom CUPS configuration for local network printing |
