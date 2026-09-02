import QRCode from 'qrcode';

/** ASCII QR for the terminal, so the host can join before any UI is open. */
export function renderQrForTerminal(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });
}

/** PNG data URL for the TV join panel. */
export function renderQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 512, errorCorrectionLevel: 'M' });
}
