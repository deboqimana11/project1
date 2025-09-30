import * as React from 'react'

export function SinglePageGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="3.25" y="2.75" width="9.5" height="10.5" rx="1.5" />
    </svg>
  )
}

export function DoublePageGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="2.75" y="2.75" width="4.5" height="10.5" rx="1" />
      <rect x="8.75" y="2.75" width="4.5" height="10.5" rx="1" />
    </svg>
  )
}

export function VerticalGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="4" y="2.75" width="8" height="10.5" rx="1.5" />
      <line x1="8" y1="4" x2="8" y2="12" strokeLinecap="round" />
    </svg>
  )
}

export function FitWidthGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="3" y="4" width="10" height="8" rx="1.5" />
      <path d="M1.75 8h2.5" strokeLinecap="round" />
      <path d="M11.75 8h2.5" strokeLinecap="round" />
      <path d="m4.5 6 1.5 2-1.5 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m11.5 6-1.5 2 1.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FitHeightGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="4" y="3" width="8" height="10" rx="1.5" />
      <path d="M8 1.75v2.5" strokeLinecap="round" />
      <path d="M8 11.75v2.5" strokeLinecap="round" />
      <path d="M6 4.5 8 6l2-1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11.5 8 10l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FitContainGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.5" />
      <rect x="4.75" y="4.75" width="6" height="6" rx="1" />
    </svg>
  )
}

export function FitFillGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none" {...props}>
      <rect x="3" y="3" width="10" height="10" rx="2" className="opacity-80" />
    </svg>
  )
}

export function FitOriginalGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="5.5" y="5.5" width="5" height="5" rx="0.8" />
      <rect x="3" y="3" width="10" height="10" rx="2" strokeDasharray="2 2" />
    </svg>
  )
}
