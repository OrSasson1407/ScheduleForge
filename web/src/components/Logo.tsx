/**
 * The ScheduleForge mark: a calendar grid fused with an anvil, in one colour.
 *
 * Drawn as inline SVG rather than shipping the mockup's raster export, so it
 * stays crisp at any size and recolours for free with `currentColor`.
 */

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 3 L27 8.5 L16 14 L5 8.5 Z"
        fill="currentColor"
      />
      <path
        d="M5 8.5 L16 14 L16 20 L5 14.5 Z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M27 8.5 L16 14 L16 20 L27 14.5 Z"
        fill="currentColor"
        opacity="0.8"
      />
      <g stroke="var(--panel, #1E293B)" strokeWidth="0.9" opacity="0.9">
        <path d="M9.5 6.75 L20.5 6.75" />
        <path d="M8 7.9 L22.5 7.9" strokeOpacity="0" />
        <path d="M12.5 5.1 L12.5 12.6" />
        <path d="M19.5 5.1 L19.5 12.6" />
        <path d="M9.5 6.75 L16 10.3" />
        <path d="M22.5 6.75 L16 10.3" />
      </g>
      <path
        d="M11 21 L11 26.5 Q11 28 12.6 28 L19.4 28 Q21 28 21 26.5 L21 21 Q17.5 24 16 21 Q14.5 24 11 21 Z"
        fill="currentColor"
      />
    </svg>
  );
}
