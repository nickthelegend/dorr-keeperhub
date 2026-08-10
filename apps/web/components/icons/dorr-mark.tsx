import * as React from "react";
import type { SVGProps } from "react";

/**
 * The dorr mark.
 *
 * A lowercase `d` whose bowl is half solid and half open: the left side is
 * filled, the right side is only an outline. That is the whole product in one
 * glyph — half of the order is revealed, half of it never is.
 *
 * Built from geometry rather than a traced font so it stays crisp at 16px in
 * the navbar and at 200px on the landing page, and inherits `currentColor` so
 * it works on the dark chrome and on the primary tile without a second asset.
 */
export const DorrMark = ({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    fill="none"
    role={title ? "img" : "presentation"}
    aria-hidden={title ? undefined : true}
    {...props}
  >
    {title ? <title>{title}</title> : null}

    {/* The bowl, as a ring. Even-odd punches the counter out of the disc. */}
    <path
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      d="M13 10a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Z"
    />

    {/* The revealed half: the left semicircle of the counter, filled in. */}
    <path fill="currentColor" d="M13 14.4a4.6 4.6 0 0 0 0 9.2v-9.2Z" />

    {/* The ascender. Squared off so the mark reads as built, not handwritten. */}
    <rect x="22" y="3" width="4.6" height="25" rx="1.4" fill="currentColor" />
  </svg>
);

export default DorrMark;
