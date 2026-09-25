import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { useDemoRouter } from './router';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: boolean };

export default function Link({ href, onClick, prefetch: _p, ...rest }: Props) {
  const router = useDemoRouter();
  return (
    <a
      {...rest}
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || !href.startsWith('/')) return;
        e.preventDefault();
        router.push(href);
      }}
    />
  );
}
