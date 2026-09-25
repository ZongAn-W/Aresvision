# Homepage Polish Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent planet preview task and review the combined result. Keep changes in the current checkout for local preview.

**Goal:** Improve the AstraAtmos homepage hierarchy, action clarity, and planet illustration while preserving its two-column composition and existing routes.

**Architecture:** Keep the existing homepage and texture-only Three.js preview. Scope typography, spacing, and responsive changes to homepage CSS; update both translations and the README together. No API, dataset, training, or prediction behavior changes.

**Tech Stack:** React, CSS, Three.js, existing Node tests, Vite, Playwright browser verification.

---

## Implementation

- [x] Update `frontend/src/pages/HomePage/homePage.css`: Chinese title capped at 64px, English wordmark at 44px, description at 16px with a wider measure; wrap actions when enlarged text requires it. Style the secondary action with a subtle full outline, preserve focus treatment, increase workflow labels to 13px and click height to at least 44px. Remove the 480px minimum right column, tighten excess hero height, and verify compact desktop, stacked mobile, and enlarged text layouts.
- [x] Update `frontend/src/i18n/zh.js` and `frontend/src/i18n/en.js`: use exploratory copy about Earth/Mars atmospheric patterns and testing ideas, per the user's copy refinement; rename the secondary action to “训练火星模型” / “Train a Mars model” to retain the training boundary. Keep existing route targets.
- [x] Update only `frontend/src/pages/HomePage/PlanetPreview.jsx` for softer light and restrained blue atmospheric edge. Keep the existing texture, camera framing, rotation speed, reduced-motion behavior, offscreen handling, fallback, and resource disposal. The illustration must not imply live measurements.
- [x] Synchronize the homepage overview in `README.md` and record actual verification below. No new dependencies, skills, unrelated refactors, commits, or data changes.

## QA inventory

These are reversible presentation changes; use existing tests and rendered checks rather than tests that assert literal CSS values.

- [x] Capture initial desktop layout before changes; compare title/description hierarchy, outlined secondary button, workflow spacing, and illuminated Earth after changes.
- [x] Verify at 1440×900 and 1366×768: the actions and workflow fit the initial viewport and no overlap or horizontal overflow occurs.
- [x] Verify breakpoint edges around 960px plus 390px and 375px mobile: actions wrap, title and descriptions remain readable, and workflow targets fit without clipping.
- [x] Verify English, light theme, and maximum supported text scale (1.5), including narrow-screen combinations.
- [x] Use real clicks to verify both hero buttons and all three workflow entries reach their existing destinations; return home after each. Check visible keyboard focus with Tab.
- [x] Check reduced motion and WebGL fallback. Ensure preview loads without new browser errors and its geometric outline is visually aligned.
- [x] Run `node --test` from `frontend/`, run `npm run build -- --emptyOutDir=false` to preserve existing output files, and run `git diff --check` from the repository root.
- [x] Review scoped diff and README links. Store screenshots and temporary verification scripts outside project source under the workspace output directory.

## Verification outcome

Completed on 2026-09-24.

- Existing frontend tests: 426 passed, 0 failed. Re-run after the settings focus fix also passed.
- Production build: `npm run build -- --emptyOutDir=false` passed after the final copy update. Vite reported the existing large-bundle advisory; no files were deleted.
- Edge browser: 13 layout scenarios covering desktop, 1366×768, both sides of the 960px breakpoint, 375/390px mobile, English, light theme, and font scale 1.5. No document horizontal overflow, clipped homepage button content, or page exceptions were observed. Mobile and enlarged English layouts scroll vertically as needed.
- Real input checks passed for both hero actions, all three workflow routes, returning home, visible Tab focus, opening/closing settings, reduced-motion stationary rendering, normal rotation, and WebGL fallback. The homepage did not request analysis data; no initial-page runtime/shader errors occurred.
- Browser QA exposed an existing offscreen settings panel in the tab order: `SettingsPanel.jsx` now applies `inert` and `aria-hidden` while closed, with open/closed behavior verified. Enlarged English at 930px exposed a clipped login entry; the homepage navigation now switches to two rows at 1100px and scales its height with text size.
- Scoped source review found no blocking issues. README homepage links exist and `git diff --check` passed. Temporary scripts, reports, and screenshots are under the workspace-level `output/playwright/homepage-polish/`; this implementation note follows the repository's existing ignored local-plan convention.
- User refinement replaced literal feature-list copy with exploratory language: “从地球到火星，追寻大气变化的时空规律。让数据启发思考，让想法在实验中得到验证。” The Mars training boundary remains explicit in the secondary action.
