export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo-mark" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="ixA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1B3A5F" />
          <stop offset="1" stopColor="#215FA6" />
        </linearGradient>
        <linearGradient id="ixB" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4CAF6E" />
          <stop offset="1" stopColor="#2E9E96" />
        </linearGradient>
      </defs>
      <path d="M4 4h12l28 40H32z" fill="url(#ixA)" />
      <path d="M44 4H32L4 44h12z" fill="url(#ixB)" />
      <path d="M20.5 20.5l7 7-3.5 5-7-7z" fill="#FFFFFF" />
    </svg>
  );
}
