/**
 * Server-side configuration from environment variables.
 * Only includes keys where the env var is explicitly set (non-empty).
 * Client localStorage takes precedence over these values.
 */

function env(key) {
  const val = process.env[key];
  return val && val.trim() ? val.trim() : undefined;
}

export function loadServerConfig() {
  const config = {};

  // Sender address — only include fields that are explicitly set
  const sender = {
    ...(env('SENDER_NAME')        && { name: env('SENDER_NAME') }),
    ...(env('SENDER_COMPANY')     && { company: env('SENDER_COMPANY') }),
    ...(env('SENDER_STREET')      && { street: env('SENDER_STREET') }),
    ...(env('SENDER_CITY')        && { city: env('SENDER_CITY') }),
    ...(env('SENDER_POSTAL_CODE') && { postalCode: env('SENDER_POSTAL_CODE') }),
    ...(env('SENDER_COUNTRY')     && { country: env('SENDER_COUNTRY') }),
  };
  if (Object.keys(sender).length > 0) config.senderAddress = sender;

  // Printer config — only include fields that are explicitly set
  const printer = {
    ...(env('CUPS_URL')            && { cupsUrl: env('CUPS_URL') }),
    ...(env('CUPS_PRINTER_NAME')   && { printerName: env('CUPS_PRINTER_NAME') }),
    ...(env('PAPER_FORMAT_ID')     && { paperFormatId: parseInt(env('PAPER_FORMAT_ID')) }),
    ...(env('PRINTER_ORIENTATION') && { orientation: env('PRINTER_ORIENTATION') }),
    ...(env('CROP_MARGIN_TOP')     && { cropMarginTop: parseFloat(env('CROP_MARGIN_TOP')) }),
    ...(env('CROP_MARGIN_RIGHT')   && { cropMarginRight: parseFloat(env('CROP_MARGIN_RIGHT')) }),
    ...(env('CROP_MARGIN_BOTTOM')  && { cropMarginBottom: parseFloat(env('CROP_MARGIN_BOTTOM')) }),
    ...(env('CROP_MARGIN_LEFT')    && { cropMarginLeft: parseFloat(env('CROP_MARGIN_LEFT')) }),
    ...(env('PAPER_WIDTH_MM')      && { paperWidthMm: parseFloat(env('PAPER_WIDTH_MM')) }),
    ...(env('PAPER_HEIGHT_MM')     && { paperHeightMm: parseFloat(env('PAPER_HEIGHT_MM')) }),
  };
  // Booleans: only include if explicitly set to 'true' or 'false'
  if (env('DISABLE_CROPPING'))    printer.disableCropping   = env('DISABLE_CROPPING') === 'true';
  if (env('ENABLE_DIRECT_PRINT')) printer.enableDirectPrint = env('ENABLE_DIRECT_PRINT') === 'true';
  if (env('ENDLESS_ROLL'))        printer.endlessRoll       = env('ENDLESS_ROLL') !== 'false';

  if (Object.keys(printer).length > 0) config.printerConfig = printer;

  return config;
}
