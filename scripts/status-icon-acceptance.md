# Windows notification-area acceptance

This is the remaining human acceptance for ImageQueue's notification-area icon.
The launcher uses a packaged app and an isolated `IMAGEQUEUE_HOME`; it seeds
inert queue rows and does not start the provider processor, read ordinary API
keys, or make generation calls.

## Launch a state

Exit every running ImageQueue instance, then run from the repository root:

```powershell
.\scripts\run-status-icon-acceptance.ps1 -State mixed
```

Use `-Rebuild` once after source changes or when `dist/win-unpacked/ImageQueue.exe`
does not exist. The accepted states are `idle`, `queued`, `generating`, `paused`,
`failed`, `completed`, `interrupted`, and `mixed`. Exit ImageQueue before
launching another state; the app's single-instance behavior intentionally
prevents two acceptance profiles from running together.

Expected tooltip and menu state:

| State | Tooltip | Queue menu item |
|---|---|---|
| `idle` | `ImageQueue — idle` | Pause |
| `queued` | `ImageQueue — 5 queued` | Pause |
| `generating` | `ImageQueue — 2 generating` | Pause |
| `paused` | `ImageQueue — paused · 5 queued` | Resume |
| `failed` | `ImageQueue — idle` | Pause |
| `completed` | `ImageQueue — idle` | Pause |
| `interrupted` | `ImageQueue — 2 interrupted` | Pause |
| `mixed` | `ImageQueue — paused · 2 generating · 5 queued · 2 interrupted` | Resume |

`failed` and `completed` deliberately leave the high-level tooltip idle; their
rows remain visible in the main queue. Every right-click menu should contain
Open ImageQueue, Open Output Folder, Pause or Resume, and Exit ImageQueue.

## A. Queue-state and menu matrix

Use one ordinary theme and scale for this section. For every state above:

- [ ] Launch the state and confirm the matching rows are visible in the app.
- [ ] Hover the notification-area icon and match the exact tooltip above.
- [ ] Secondary-click it and verify all four commands, separators, and Pause/Resume.
- [ ] Close the main window; confirm the same process stays alive and the icon
      remains. Primary-click once and confirm the same window returns, appears in
      the taskbar and Alt+Tab, and receives focus.
- [ ] Close it again, secondary-click, choose Open ImageQueue, and confirm the same
      restoration behavior.
- [ ] On `paused`, choose Resume and confirm the tooltip becomes
      `ImageQueue — 5 queued` and the menu changes to Pause. Choose Pause and
      confirm both return to their prior values. No work should start.
- [ ] Choose Open Output Folder and confirm it opens only the disposable
      acceptance session folder.
- [ ] Choose Exit ImageQueue and confirm both the process and icon disappear.

## B. Scale, theme, contrast, and overflow matrix

Use the `mixed` state. In Windows Settings, change **System → Display → Scale**
and **Personalization → Colors → Choose your mode**. Contrast themes are under
**Accessibility → Contrast themes**; select a theme and Apply, then restore
None after the row. At each row, inspect the icon once in the visible area and
once in the overflow panel. Hover and open the secondary-click menu in both places.

For every cell, confirm: four cards and the central gap remain distinct; the
glyph contrasts with the shell background; the full tooltip is readable; the
menu text, separators, disabled/enabled state, and selection highlight are
legible; primary-click restoration still works.

| Scale | Normal light | Normal dark | Light mode → dark contrast | Dark mode → light contrast |
|---|---|---|---|---|
| 100% | [ ] | [ ] | [ ] | [ ] |
| 125% | [ ] | [ ] | [ ] | [ ] |
| 150% | [ ] | [ ] | [ ] | [ ] |
| 200% | [ ] | [ ] | [ ] | [ ] |

The two arrow columns are the important mismatch probes: set the normal mode
first, then apply a contrast theme whose notification-area background has the
opposite luminance. Record the exact contrast-theme name for any failure.

## C. Shell and session-end recovery

Return to the preferred scale/theme and launch `mixed`.

- [ ] With the main window visible, restart **Windows Explorer** from Task
      Manager. Confirm the ImageQueue icon returns once Explorer is ready,
      hover/secondary-click still work, and primary-click restores/focuses the window.
- [ ] Close ImageQueue to the background, restart Windows Explorer again, and
      repeat the icon, tooltip, menu, and restore checks.
- [ ] Launch `generating`, then sign out of Windows normally. After signing in,
      confirm no ImageQueue process or ghost icon remains. Relaunch the same
      fixture, open Sessions, resume the previous session, and confirm its
      synthetic generating rows were persisted as interrupted by shutdown/session
      recovery rather than resumed as work.
- [ ] Repeat the prior step with a normal Windows restart.
- [ ] Finally launch `idle`, turn **Show in notification area** off in ImageQueue
      Settings, restart ImageQueue, and confirm close exits. Turn it on, restart,
      confirm close backgrounds, then use Exit ImageQueue and confirm no process
      or icon remains.

For a failure, record the state, scale, normal mode, contrast theme, whether the
icon was visible or overflowed, the exact action, and a screenshot. Do not mark
the parent plan complete from a nearby or inferred observation.
