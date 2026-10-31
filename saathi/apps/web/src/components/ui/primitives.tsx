import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

// shadcn/ui-style primitives restyled with Saathi tokens (frontend.md §3).

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-3 focus-visible:outline-focus [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-action text-white hover:bg-brand-action-hover',
        secondary: 'bg-surface text-ink border border-border-control hover:bg-surface-subtle',
        quiet: 'bg-surface-subtle text-ink hover:bg-border-subtle',
        ghost: 'text-ink hover:bg-surface-subtle',
        danger: 'bg-danger-ink text-white hover:brightness-95',
        link: 'text-brand-action-hover underline underline-offset-4 hover:text-brand-action px-0 min-h-0',
      },
      size: {
        md: 'min-h-11 px-4 text-[15px] rounded-[11px]',
        lg: 'min-h-12 px-5 text-base rounded-[11px]',
        sm: 'min-h-11 px-3 text-sm rounded-[10px]',
        pill: 'min-h-12 px-6 text-base rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp ref={ref} data-saathi-interactive="" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[16px] border border-border-subtle bg-surface p-[18px] shadow-[var(--shadow-rest)] sm:p-6', className)} {...p} />;
}

export function SectionTitle({ children, className, as: As = 'h2', id }: { children: ReactNode; className?: string; as?: 'h2' | 'h3'; id?: string }) {
  return (
    <As id={id} className={cn('text-[17px] font-semibold leading-snug text-ink', className)}>
      {children}
    </As>
  );
}

export const Label = ({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn('block text-[15px] font-medium text-ink', className)} {...p} />;

const field = 'mt-1.5 block w-full rounded-[11px] border border-border-control bg-surface px-3 text-[16px] text-ink placeholder:text-ink-secondary/80 focus-visible:outline-3 focus-visible:outline-focus disabled:bg-surface-subtle aria-[invalid=true]:border-danger-ink';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, 'min-h-11', className)} {...p} />);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'min-h-32 py-2.5 leading-relaxed', className)} {...p} />);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, 'min-h-11 pr-8', className)} {...p} />);
Select.displayName = 'Select';

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-danger-ink" role="alert">
      {children}
    </p>
  );
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mt-1.5 text-[14px] leading-relaxed text-ink-secondary', className)}>{children}</p>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('saathi-pending rounded-[10px] bg-surface-subtle', className)} />;
}

export function Divider() {
  return <hr className="my-6 border-border-subtle" />;
}
