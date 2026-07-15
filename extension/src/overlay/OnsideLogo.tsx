import React from "react";

/**
 * Onside brandmark — circle + cyan play-chevron with a scrubber line & dot,
 * recreated as inline SVG from the brand kit (onside-logo v1). `size` in px.
 */
export function OnsideLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="Onside">
      <circle cx="50" cy="50" r="43" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2.5" />
      <path
        d="M46 29 L71 50 L46 71"
        stroke="#22d3ee"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="37" y1="30" x2="37" y2="70" stroke="#dff5ef" strokeWidth="7" strokeLinecap="round" />
      <circle cx="37" cy="50" r="6.5" fill="#22d3ee" />
    </svg>
  );
}
