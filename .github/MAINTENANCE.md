# Pending site fixes

Recorded on 2026-10-27. The user asked to retain the following two findings for
later work. They are intentionally not included in the fortune disclaimer change.

## 1. Distinguish manually entered reference numbers from official results

- The `applyManual` click handler replaces `latestDraw.winning_numbers` with user
  input and calls `renderLatestDraw`, preserving the previous official round,
  draw date and bonus number. Arbitrary input can consequently appear to be an
  official winning result.
- The manual-input notice is assigned to `latestStatus`, but removing its `warn`
  class hides the notice under the current `.latest-status` CSS.
- A future fix should keep official results separate from `manualDrawNumbers`,
  identify manual comparison/reference numbers clearly, and avoid attaching
  unverified official round, date or bonus information to user input.
- Review settings summaries and generated-result descriptions as well: they
  currently describe the previous round as automatically applied even when
  manually entered reference numbers are being used.
- Verify the manual-input state after lookup failures, including visible source
  labelling, correct filtering and unchanged official-result data.

## 2. Make the automatic-lookup label match the actual behavior

- The home card's markup contains `직전 회차 자동 적용` even when the previous-round
  overlap filter is disabled; the default filter mask is zero. Current home-page
  CSS hides this tag, so this is hidden wording to clean up rather than a
  currently visible incorrect message.
- Prefer `최근 당첨번호 자동 조회` or equivalent wording when this fix is applied.
- The previous-round overlap rule affects generation only when its `data-bit=4`
  checkbox is enabled. Do not change filter defaults as part of a label fix.

## Implemented separately

After `오늘의 행운번호` is generated, display the following below the result rows:

> 무작위로 생성한 번호이며, 당첨을 보장하지 않습니다.

Hide that notice until the first lookup and avoid duplicate notices on repeat
lookups.
