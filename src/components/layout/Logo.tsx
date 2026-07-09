import * as React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  variant?: 'white' | 'colored';
}

export default function Logo({ className, variant = 'colored' }: LogoProps) {
  const primaryColor = variant === 'colored' ? '#7380FF' : 'white';
  const secondaryColor = variant === 'colored' ? '#D2D6FF' : 'white';

  return (
    <svg 
      width="93" 
      height="51" 
      viewBox="0 0 93 51" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-8 w-auto", className)}
    >
      <path 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M36.8988 20.2548H13.8364L0 8.0897e-09H16.4939C18.4964 -7.00061e-05 20.4646 0.454327 22.2064 1.31879C23.9481 2.18326 25.4037 3.42823 26.4309 4.93205L36.8988 20.2548Z" 
        fill={secondaryColor}
      />
      <path 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M66.1711 4.85104L55.4221 20.2548H13.7441L31.3857 45.7543C32.4172 47.2449 33.8708 48.4776 35.6061 49.333C37.3414 50.1884 39.2995 50.6376 41.2913 50.6371H51.3788C53.3849 50.6369 55.3565 50.1806 57.1002 49.3129C58.844 48.4453 60.3001 47.196 61.3258 45.6877L78.6168 20.2548L92.7509 1.10226e-09H76.0519C74.0678 -2.5606e-05 72.117 0.446114 70.3867 1.2956C68.6565 2.14509 67.2048 3.3694 66.1711 4.85104Z" 
        fill={primaryColor}
      />
    </svg>
  );
}
