#!/usr/bin/env python3
"""Generate fixed zodiac page shells; daily fortunes are fetched in the browser."""

import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SIGNS = (
    ("rat", "쥐"),
    ("ox", "소"),
    ("tiger", "호랑이"),
    ("rabbit", "토끼"),
    ("dragon", "용"),
    ("snake", "뱀"),
    ("horse", "말"),
    ("sheep", "양"),
    ("monkey", "원숭이"),
    ("rooster", "닭"),
    ("dog", "개"),
    ("pig", "돼지"),
)


def page(slug, sign, offset):
    years = ", ".join(f"{1948 + offset + 12 * index}년" for index in range(5))
    links = "\n".join(
        f'          <a href="/fortunes/{other_slug}.html"'
        + (' aria-current="page"' if other_slug == slug else "")
        + f">{other_sign}띠</a>"
        for other_slug, other_sign in SIGNS
    )
    return f'''<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{sign}띠 오늘의 운세 | 행운설계소</title>
  <meta name="description" content="{sign}띠 {years}생의 오늘의 한 줄 운세를 확인해 보세요. 한국시간 기준 출생연도별 운세를 오락용으로 제공합니다.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="https://luckzip.com/fortunes/{slug}.html">
  <link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
  <link rel="stylesheet" href="/assets/fortune-detail.css?v=20261104-1">
  <script defer src="/assets/reviews-config.js"></script>
  <script defer src="/assets/fortunes-api.js?v=20261103-2"></script>
  <script defer src="/assets/fortune-detail.js?v=20261104-1"></script>
</head>
<body>
  <header class="fortune-header">
    <a class="fortune-brand" href="/" aria-label="행운설계소 홈으로 이동"><img src="/assets/logo-96.webp" width="38" height="38" alt=""><span>행운설계소</span></a>
    <a class="fortune-back" href="/fortunes.html">띠 다시 선택</a>
  </header>
  <main id="fortuneDetail" class="fortune-main" data-zodiac="{sign}">
    <div class="fortune-intro">
      <p class="fortune-eyebrow">출생연도별 오늘의 한 줄</p>
      <h1>{sign}띠 오늘의 운세</h1>
      <p class="fortune-years">{years}생</p>
      <p class="fortune-explanation">오늘의 운세를 한국시간(KST) 기준으로 자동으로 불러옵니다.<br>태어난 연도에 맞는 한 줄 운세를 재미로 확인해 보세요.</p>
    </div>
    <section class="fortune-results" aria-labelledby="fortuneResultsHeading">
      <h2 id="fortuneResultsHeading">출생연도별 운세</h2>
      <div id="fortuneTiming" class="fortune-timing" hidden>
        <p><time id="fortuneDate"></time><span class="fortune-timezone">한국시간 기준</span></p>
        <p class="fortune-checked">확인 시각 <time id="fortuneServerTime"></time></p>
      </div>
      <div id="fortuneContent" aria-live="polite" aria-busy="true">
        <p id="fortuneState" class="fortune-state" role="status">오늘의 운세를 불러오고 있습니다.</p>
        <dl id="fortuneList" class="fortune-list" hidden></dl>
      </div>
      <button id="retryFortunes" class="fortune-retry" type="button" hidden>다시 불러오기</button>
      <noscript><p class="fortune-state">오늘 날짜의 운세를 불러오려면 브라우저의 자바스크립트를 켜 주세요.</p></noscript>
    </section>
    <nav class="fortune-other-signs" aria-labelledby="fortuneOtherSignsHeading">
      <h2 id="fortuneOtherSignsHeading">다른 띠의 오늘의 운세</h2>
      <div class="fortune-sign-links">
{links}
      </div>
    </nav>
  </main>
  <footer class="fortune-footer"><p>본 운세는 과학적 근거가 없는 오락용 콘텐츠로, 재미로만 참고해 주시기 바랍니다.</p></footer>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check generated pages without writing")
    args = parser.parse_args()
    mismatches = []
    for offset, (slug, sign) in enumerate(SIGNS):
        path = ROOT / "fortunes" / f"{slug}.html"
        expected = page(slug, sign, offset)
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                mismatches.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(exist_ok=True)
            path.write_text(expected, encoding="utf-8")
    if mismatches:
        parser.exit(1, "Pages need regeneration: " + ", ".join(mismatches) + "\n")
    print("Checked 12 zodiac detail pages." if args.check else "Generated 12 zodiac detail pages.")


if __name__ == "__main__":
    main()
