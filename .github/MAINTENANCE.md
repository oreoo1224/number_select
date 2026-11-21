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

## 당첨번호와 운세 갱신 점검

- 당첨번호를 등록할 때 동행복권 발표와 회차, 추첨일, 기본 당첨번호 6개,
  보너스 번호를 대조한다. 등록 뒤 홈과 당첨번호 조회에서 같은 값을 확인한다.
  [당첨번호 등록 안내](../supabase/DRAWS_SETUP.md)
- 당첨번호 통계는 동행복권 공식 결과 1~1250회를 담은 `assets/draw-history.json`과
  이후 등록 회차를 읽는다. 최근 10회와 전체 회차를 각각 조회해 화면의 집계 범위를 확인한다.
  오래된 자료를 갱신할 때는 `start`가 1인지, `draws`의 각 행이 회차순으로
  `[추첨일, 당첨번호 6개]` 형식이며 중간 회차 없이 이어지는지 확인한다.
- 운세 자료를 등록하기 전에 날짜별 12띠·60개 문구와 중복 검사 결과를 확인한다.
  등록 뒤 한국 시간으로 날짜가 바뀌면 목록과 띠별 페이지에서 새 날짜와 문구를 확인한다.
  [운세 등록 안내](../supabase/FORTUNES_SETUP.md)
- 공개 본문을 바꾸면 해당 URL의 `sitemap.xml` 수정일과 본문의 날짜를 확인한다.
  누락 주소가 404로 응답하는지, 사이트맵에는 색인 대상 URL만 있는지도 확인한다.
