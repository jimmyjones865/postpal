import { PrinterConfig } from '@/types/shipping';

/**
 * Direct print configuration for CUPS printing.
 * This interface is used by both Index.tsx and LabelHistory.tsx.
 */
export interface DirectPrintConfig {
  cupsUrl: string;
  printerName: string;
  orientation: 'portrait' | 'landscape';
  paperFormatName: string;
  enableDirectPrint: boolean;
  disableCropping: boolean;
  paperWidthMm: number;
  paperHeightMm: number;
  endlessRoll: boolean;
}

/**
 * Print options for PDF cropping.
 */
export interface PrintOptions {
  cropH: number;
  cropV: number;
}

/**
 * Builds a DirectPrintConfig from PrinterConfig.
 * 
 * @param config - Printer configuration from app config
 * @returns DirectPrintConfig with defaults applied
 */
export function buildDirectPrintConfig(config: PrinterConfig): DirectPrintConfig {
  return {
    cupsUrl: config.cupsUrl || '',
    printerName: config.printerName || '',
    orientation: config.orientation,
    paperFormatName: config.paperFormatName || '',
    enableDirectPrint: config.enableDirectPrint || false,
    disableCropping: config.disableCropping || false,
    paperWidthMm: config.paperWidthMm ?? 62,
    paperHeightMm: config.paperHeightMm ?? 100,
    endlessRoll: config.endlessRoll ?? true
  };
}

/**
 * Builds PrintOptions from PrinterConfig.
 * 
 * @param config - Printer configuration from app config
 * @returns PrintOptions with defaults applied
 */
export function buildPrintOptions(config: PrinterConfig): PrintOptions {
  return {
    cropH: config.cropMarginHorizontal ?? 5,
    cropV: config.cropMarginVertical ?? 5
  };
}
