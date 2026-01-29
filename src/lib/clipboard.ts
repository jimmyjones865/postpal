/**
 * Copy text to clipboard with Safari fallback.
 * Uses modern Clipboard API with fallback to execCommand for Safari compatibility.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
      // Fall through to legacy method
    }
  }
  
  // Fallback: Create a temporary textarea and use execCommand
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Prevent scrolling to bottom on iOS
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    textArea.style.opacity = '0';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    return success;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
}
