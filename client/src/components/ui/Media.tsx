import { useState } from 'react';

/**
 * Image with consistent cropping and a visible failure state, so a missing
 * file on party day is obvious rather than an invisible gap.
 */
export function Media({
  src,
  alt,
  className = '',
}: {
  src: string;
  alt: string;
  className?: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={`media media--missing ${className}`.trim()}>Image missing</div>;
  }

  return (
    <figure className={`media ${className}`.trim()}>
      <img src={src} alt={alt} onError={() => setFailed(true)} />
    </figure>
  );
}
