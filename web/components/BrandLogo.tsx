export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo inline-flex items-center gap-2.5" aria-label="Carta Viva">
      <svg className={compact ? "brand-mark h-8 w-8" : "brand-mark h-9 w-9 sm:h-11 sm:w-11"} viewBox="0 0 48 48" role="img" aria-hidden>
        <defs>
          <linearGradient id="carta-viva-mark" x1="5" y1="4" x2="43" y2="45" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2DD8C9" />
            <stop offset=".53" stopColor="#E85FD1" />
            <stop offset="1" stopColor="#F4C15C" />
          </linearGradient>
        </defs>
        <path className="brand-card" d="M13.2 5.8 37 9.2a4.2 4.2 0 0 1 3.5 4.8l-4.2 28.1-28.8-4.3 4.2-28.5a4 4 0 0 1 1.5-2.6Z" fill="#11161A" stroke="url(#carta-viva-mark)" strokeWidth="2.2" />
        <path className="brand-wave" d="M11.1 29.5c7.7-7 12.1 4.4 19.4-2.2 2.7-2.4 4.5-3 7.6-1.2" fill="none" stroke="url(#carta-viva-mark)" strokeWidth="2.7" strokeLinecap="round" />
        <path className="brand-spark" d="m30.8 12.8 1.3 3.6 3.5 1.3-3.5 1.3-1.3 3.6-1.3-3.6-3.5-1.3 3.5-1.3 1.3-3.6Z" fill="#F8E9A3" />
      </svg>
      <span className={`brand-wordmark font-display font-bold leading-none ${compact ? "text-2xl" : "text-3xl sm:text-4xl"}`}>
        <span>Carta</span><span>Viva</span>
      </span>
    </span>
  );
}
