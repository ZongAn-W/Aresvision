# Mars Analysis Usability Implementation Plan

**Goal:** Resolve the six verified analysis UI issues: conflicting variables, irrelevant globe tools, nested chart scrolling, lost selections, inaccurate descriptions, and failures reported as empty data.

**Architecture:** Preserve existing data APIs and calculations. Store per-chart choices in a page-level React context, render applicable controls in the shared analysis sidebar, and reuse a local request-error/retry component across Mars charts. Use responsive grids inside the existing results scroll area.

**Tech Stack:** React, CSS container queries, Plotly, Node tests, Playwright CLI.

- [x] Capture failing interaction checks for toolbar relevance, variable/range persistence, chart layout and error retry.
- [x] Add `workbench/MarsAnalysisSettings.jsx` and `marsAnalysisSettings.js`: per-chart settings, defaults and relevant choices; mount the provider in `DataOverviewPage.jsx` and controls in `ObservatoryMars.jsx`.
- [x] Connect seasonal, seasonal extremes, correlation, radiation, diurnal and spatial charts to the same sidebar state; keep standalone components usable.
- [x] Limit globe controls and field-loading feedback to observation; remove Mars chart height caps and nested scrolling. Arrange environment, relation, polar and spatial chart panels in responsive grids.
- [x] Add planet-specific analysis descriptions; remove duplicate headings in the shared workbench.
- [x] Add shared chart error/retry handling to all ten active Mars charts, preserving empty-data messages and ignoring stale request failures.
- [x] Run Node tests and production build, restart the frontend, verify health/proxy, and exercise real and simulated-failure browser flows at desktop/mobile widths.
- [x] Update README and the shared workbench documentation with the final behavior and verified limits.

Validation on 2026-09-26: 451 Node tests passed; production build passed. All ten Mars charts recovered after simulated HTTP 503 responses. Empty data and stale request failures were checked separately. Browser checks covered condition memory, observation tools, diurnal Ls, source panels, Chinese/dark and English/light with 120% text at 1440px and 390px. See [workbench validation](../earth-analysis-workbench.md#2026-09-26-分析选择与操作修复) for scope and remaining limits.
