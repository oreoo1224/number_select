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

```sh
python3 scripts/prepare-fortunes.py --output /tmp/fortunes-import 원본1.zip 원본2.zip
```

이미 가져온 기간은 다시 중복 가져오지 않습니다. 기존 문구는 Table Editor에서 수정합니다.

가져오기 전에 `validation.json`의 `text_repetition`을 확인합니다. 같은 문구의 두 번째
이후 등장 횟수는 `repeated_rows`, 날짜별로 센 횟수는 `repeated_rows_within_dates`에
표시됩니다. 같은 출생연도에서 전날 문구가 반복된 행은 `same_birth_year_as_previous_day`,
60개 문구가 모두 같은 연속 날짜 쌍은 `identical_adjacent_date_pairs`에서 확인할 수 있습니다.
비교에는 유니코드와 공백을 정규화한 문구를 사용합니다. 보고서에는 집계만 표시하고 원본
문구는 그대로 유지합니다. 의미가 비슷한 문장은 원본에서 직접 확인합니다.
