/** The scan-to-join block. Kept on a light card so phone cameras lock on fast. */
export function QrJoinPanel({
  qrDataUrl,
  joinUrl,
  error,
}: {
  qrDataUrl: string | null;
  joinUrl: string | null;
  error: string | null;
}): JSX.Element {
  return (
    <div className="join">
      <p className="join__hint">Scan to join</p>
      <div className="join__card">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={`QR code linking to ${joinUrl ?? 'the join page'}`} />
        ) : (
          <div className="join__placeholder">{error ?? 'Generating QR…'}</div>
        )}
      </div>
      <p className="join__url">{joinUrl ?? '…'}</p>
      <p className="join__hint">Same Wi-Fi · No app to install</p>
    </div>
  );
}
