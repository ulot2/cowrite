// The talking C: a C drawn as a speech bubble. As the first letter of "CoWrite" it is the logo. The capital W
// keeps the name from reading as "cow rite".
// The tile version (the app icon) is in public/favicon.svg and public/landing/og.png.
// The C carries the name for screen readers, so it still has one when the collapsed sidebar hides
// the text and keeps the C as the icon.
export function Logo() {
  return (
    <>
      <svg className="logo-c" viewBox="0 0 32 32" role="img" aria-label="CoWrite" focusable="false">
        <path d="M24.3 8.3A11 11 0 1 0 24.3 23.7" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
        <path d="M6.6 19.6C7 24.2 5.6 27.6 2.6 30 7.5 30 11.6 27.7 13.7 24.8z" fill="var(--accent)" />
      </svg>
      <span className="logo-rest" aria-hidden="true">oWrite</span>
    </>
  )
}
