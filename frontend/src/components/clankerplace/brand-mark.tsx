export function BrandMark({ dead = false, className = "" }: { dead?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={className} fill="none">
      <path d="M5 20.5a10.5 10.5 0 1 1 18 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m6.2 18.1-2.1 1.2M21.8 18.1l2.1 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <g style={{ transformOrigin: "14px 20px", transform: `rotate(${dead ? -66 : 34}deg)` }}>
        <path d="M14 20V10.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        {!dead && <path d="M14 10.6c-2-1.5-.8-4 .6-5.6.1 1.6 2.1 2.1 1.5 4.1-.25.85-.95 1.35-2.1 1.5Z" fill="currentColor" />}
      </g>
      <circle cx="14" cy="20" r="2.1" fill="currentColor" />
    </svg>
  );
}
