import ipp from 'ipp';
import { logger } from './logger.js';

/**
 * CUPS Printer utility for direct IPP printing
 * 
 * Sends print jobs directly to a CUPS server via the IPP protocol.
 */

/**
 * Sends a PDF buffer to a CUPS printer via IPP protocol
 * 
 * @param {Buffer} pdfBuffer - The PDF data to print
 * @param {string} cupsUrl - CUPS server URL (e.g., http://192.168.1.100:631)
 * @param {string} printerName - Printer queue name (e.g., DYMO_LabelWriter_450)
 * @param {object} options - Print options
 * @param {string} options.jobName - Name for the print job
 * @param {number} options.copies - Number of copies (default: 1)
 * @returns {Promise<{success: boolean, jobId?: number, error?: string}>}
 */
export async function sendToCups(pdfBuffer, cupsUrl, printerName, options = {}) {
  const { 
    jobName = 'Shipping Label', 
    copies = 1,
    mediaWidthMm,
    mediaHeightMm
  } = options;
  
  // Normalize URL - ensure no trailing slash
  const baseUrl = cupsUrl.replace(/\/$/, '');
  const printerUri = `${baseUrl}/printers/${printerName}`;
  
  logger.info(`[CUPS] Sending print job to: ${printerUri}`);
  logger.debug(`[CUPS] Job name: ${jobName}, PDF size: ${pdfBuffer.length} bytes`);
  
  // Build job attributes
  const jobAttributes = {
    'copies': copies,
    'print-quality': 'normal'
  };
  
  // If explicit dimensions provided, tell CUPS the exact page size
  if (mediaWidthMm && mediaHeightMm) {
    jobAttributes['media-col'] = {
      'media-size': {
        'x-dimension': Math.round(mediaWidthMm * 100),  // hundredths of mm
        'y-dimension': Math.round(mediaHeightMm * 100)
      }
    };
    logger.debug(`[CUPS] Setting media size: ${mediaWidthMm.toFixed(1)}x${mediaHeightMm.toFixed(1)}mm`);
  }
  
  return new Promise((resolve) => {
    const printer = ipp.Printer(printerUri);
    
    const msg = {
      'operation-attributes-tag': {
        'requesting-user-name': 'label-app',
        'job-name': jobName,
        'document-format': 'application/pdf'
      },
      'job-attributes-tag': jobAttributes,
      data: pdfBuffer
    };
    
    printer.execute('Print-Job', msg, (err, res) => {
      if (err) {
        logger.error('[CUPS] Print error:', err.message);
        resolve({
          success: false,
          error: err.message || 'Failed to communicate with printer'
        });
        return;
      }
      
      // Check IPP response status
      const statusCode = res.statusCode;
      logger.debug('[CUPS] Response status:', statusCode, res['status-message']);
      
      // IPP success codes are 0x0000-0x00FF
      if (statusCode !== undefined && statusCode <= 0x00FF) {
        const jobId = res['job-attributes-tag']?.['job-id'];
        logger.info('[CUPS] Print job submitted, ID:', jobId);
        resolve({
          success: true,
          jobId: jobId
        });
      } else {
        const errorMsg = res['status-message'] || `IPP error: ${statusCode}`;
        logger.error('[CUPS] Print failed:', errorMsg);
        resolve({
          success: false,
          error: errorMsg
        });
      }
    });
  });
}

/**
 * Get printer status from CUPS
 * 
 * @param {string} cupsUrl - CUPS server URL
 * @param {string} printerName - Printer queue name
 * @returns {Promise<{online: boolean, state?: string, error?: string}>}
 */
export async function getPrinterStatus(cupsUrl, printerName) {
  const baseUrl = cupsUrl.replace(/\/$/, '');
  const printerUri = `${baseUrl}/printers/${printerName}`;
  
  return new Promise((resolve) => {
    const printer = ipp.Printer(printerUri);
    
    printer.execute('Get-Printer-Attributes', null, (err, res) => {
      if (err) {
        logger.error('[CUPS] Status check error:', err.message);
        resolve({
          online: false,
          error: err.message
        });
        return;
      }
      
      const attrs = res['printer-attributes-tag'] || {};
      const state = attrs['printer-state-message'] || attrs['printer-state'];
      
      resolve({
        online: true,
        state: String(state)
      });
    });
  });
}
