import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4', {
  variants: { variant: { default: 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm', outline: 'border border-border bg-background hover:bg-muted', ghost: 'hover:bg-muted', destructive: 'bg-red-600 text-white hover:bg-red-700' }, size: { default: 'h-10 px-4 py-2', sm: 'h-8 rounded-md px-3 text-xs', icon: 'size-10' } },
  defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
