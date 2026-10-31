import { cn } from '@/lib/cn';

/** Original typographic Saathi wordmark with a simple companion/check mark. */
export function Wordmark({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const s = size === 'lg' ? 'text-[26px]' : 'text-[21px]';
  return (
    <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
      <svg aria-hidden viewBox="0 0 28 28" className={size === 'lg' ? 'size-8' : 'size-7'}>
        <path d="M14 2.5 4.5 6v7.2c0 6 4 10.6 9.5 12.3 5.5-1.7 9.5-6.3 9.5-12.3V6L14 2.5Z" fill="#F65B3A" />
        <path d="m9.4 14.2 3.2 3.2 6.2-6.4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={cn('font-[family-name:var(--font-display)] font-semibold tracking-[-0.01em]', s)}>Saathi</span>
    </span>
  );
}
