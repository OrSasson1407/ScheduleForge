/** One Material Symbols glyph, loaded as the variable icon font in index.html. */

import type { CSSProperties } from "react";

interface Props {
  name: string;
  className?: string;
  filled?: boolean;
  style?: CSSProperties;
}

export function Icon({ name, className = "", filled = false, style }: Props) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1", ...style } : style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
