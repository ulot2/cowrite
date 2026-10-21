---
version: 1
slug: "public-landing-index-html"
primary_target: "public/landing/index.html"
related_targets: ["public/landing/how.css","public/landing/landing.css"]
---

## Scope and mode

Public landing page, Persuade. The redesign covers How it works, Nib, collaboration, onboarding, FAQ, the closing invitation, footer, and navigation. The existing hero demo remains.

## Visitor and purpose

Prospective teammates should understand how a thought becomes work with an accountable next step. The example is illustrative, never a customer claim. The primary conversion is to start a space; a document can also be tried without an account elsewhere on the page.

## How it works direction

A compact, reader-paced walkthrough: idea → discussion → decision → plan. Four numbered selectors form a horizontal path above a pale-blue workbench. A narrative sits beside a distinct paper artifact for each stage: a tilted idea note, a conversation, a recorded decision, and an actionable plan. On phones, the narrative and artifact stack. One coherent product launch-party example carries all four scenes. Working source links go backwards through the story; next-step links go forwards. The final scene has named task owners, dates and a link to the decision it implements.

Use the incumbent Studio palette and Manrope, with an Instrument Serif italic headline phrase and margin notes. Keep scene height stable, avoid autoplay, support keyboard tabs and source navigation, respect reduced motion and system theme. Without JavaScript, all scenes remain visible and ordinary anchors work. No new raster artwork is needed for this section; its text and controls are semantic HTML/CSS.

## Unresolved

Visual browser verification of the final redesign remains outstanding. Source checks and the production build passed.

## Supporting sections

Nib pairs context with its existing animated demo on an ink-blue stage. Collaboration gives two document views a shared status and pause control. Onboarding uses a continuous three-step route. FAQ keeps native disclosure rows and places the Nib question form separately, with saved answers appended to the list. A cobalt closing invitation uses decorative SVG contours. The footer groups navigation and appearance controls; a floating header includes a contained mobile menu. Section styles live in individual CSS files under public/landing.
