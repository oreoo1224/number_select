# 오늘의 운세 연결

1. Supabase **SQL Editor**에서 [fortunes.sql](fortunes.sql) 전체를 실행합니다.
2. **Table Editor → `fortunes_private` → `daily_fortunes` → Import data from CSV**에서
   제공된 `all_fortunes.csv`를 가져옵니다. 날짜와 출생연도별로 한 행씩 저장됩니다.
3. 웹사이트에서 오늘 자료를 확인합니다. 해당 날짜 자료가 없으면 준비 중으로 표시됩니다.

기존 프로젝트 URL·공개 키를 그대로 사용합니다. 운세의 수정·삭제는 이 테이블에서 합니다.
`fortunes_private`를 Data API 공개 스키마에 추가하거나 방문자에게 테이블 권한을 주지 않습니다.
방문자용 `fortunes_today`는 한국 시간의 오늘 자료만 반환합니다. 매일 SQL을 실행할 필요는 없습니다.

원본은 2026-11-04~2027-12-31, 25,380행입니다. 날짜가 지난 자료와 미래 자료도
관리자는 볼 수 있지만 방문자 API로는 조회할 수 없습니다. 운세 CSV를 공개 저장소에 올리지 않습니다.

새 CSV를 변환할 때:

브라우저에서는 [운세 자료 변환](https://luckzip.com/tools/fortune-import.html)에서 원본 ZIP을 선택한 뒤 CSV를 저장합니다. 파일은 기기 안에서만 처리됩니다.

```sh
python3 scripts/prepare-fortunes.py --output /tmp/fortunes-import 원본1.zip 원본2.zip
```

이미 가져온 기간은 다시 중복 가져오지 않습니다. 기존 문구는 Table Editor에서 수정합니다.
