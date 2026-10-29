# Site maintenance notes

Recorded on 2026-10-27 and initially deferred at the user's request. Both source
labelling findings below were resolved on 2026-10-29 as part of the user's switch
to administrator-entered draw results. The original findings remain here as
historical context; they are no longer pending fixes.

## 1. Resolved: distinguish visitor input from registered results

- The former `applyManual` click handler replaced `latestDraw.winning_numbers` with user
  input and calls `renderLatestDraw`, preserving the previous official round,
  draw date and bonus number. Arbitrary input can consequently appear to be an
  official winning result.
- The manual-input notice is assigned to `latestStatus`, but removing its `warn`
  class hides the notice under the current `.latest-status` CSS.
- The visitor override and its handler have now been removed. Home results come
  from an owner-managed table through a read-only RPC. Visitor-entered comparison
  numbers remain local to the comparison form and never rewrite home results.
- Registered, archived and empty states are labelled explicitly. Settings and
  generated results identify the actual reference round/source; the overlap
  condition is unavailable when no reference data exists.

## 2. Resolved: make the result-source label match the actual behavior

- The former home card's markup contained `직전 회차 자동 적용` even when the previous-round
  overlap filter is disabled; the default filter mask is zero. Current home-page
  CSS hides this tag, so this is hidden wording to clean up rather than a
  currently visible incorrect message.
- The label now describes administrator-entered data. There is no automatic
  network lookup to the lottery provider, and the source note is visible.
- The previous-round overlap rule affects generation only when its `data-bit=4`
  checkbox is enabled. Do not change filter defaults as part of a label fix.

## Implemented separately

After `오늘의 행운번호` is generated, display the following below the result rows:

> 무작위로 생성한 번호이며, 당첨을 보장하지 않습니다.

Hide that notice until the first lookup and avoid duplicate notices on repeat
lookups.
