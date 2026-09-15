import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'special';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** Toggle state for tool-style buttons (brush size, eraser). */
  active?: boolean;
}

/**
 * The only button in the app. Hierarchy is carried by `variant` alone so a
 * destructive host control can never look like the next-step control.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  active = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    block ? 'btn--block' : '',
    active ? 'btn--active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}
