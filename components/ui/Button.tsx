import { type ButtonHTMLAttributes } from 'react';
type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  primary: 'bg-[var(--a1)] text-white hover:opacity-90',
  secondary: 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]',
  ghost: 'bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]'
};
const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm'
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    />
  );
}
