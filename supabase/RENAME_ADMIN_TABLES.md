# 관리자용 스키마·테이블 이름 변경

기존 당첨번호·후기 저장소가 연결된 프로젝트에서 한 번 적용합니다.

| 기존 이름 | 변경할 이름 |
| --- | --- |
| `draws_private` 스키마 | `aalotto_number` |
| 당첨번호 `draws` 테이블 | `lotto` |
| `reviews_private` 스키마 | `aareview_private` |
| 후기 `posts` 테이블 | `posts` 유지 |

## 적용 방법

1. 본인 프로젝트의 **SQL Editor → New query**를 엽니다.
2. [20261029_rename_admin_tables.sql](migrations/20261029_rename_admin_tables.sql)
   전체를 복사해 붙여 넣고 **Run**을 누릅니다.
3. 성공 후 Table Editor와 사이트를 새로고침합니다.

브라우저용 공개 키에는 이름을 바꿀 권한이 없어 프로젝트 관리자가 직접 실행합니다.
이름과 연결된 함수 정의를 하나의 트랜잭션에서 함께 바꿉니다. 기존 당첨번호,
후기 본문, 비밀번호 해시, 작성·수정 시각과 요청 제한 기록을 보존합니다.
방문자용 함수 이름과 접근 권한도 유지합니다.

이미 일부 이름을 바꾼 경우에도 대상 객체가 유일하면 연결을 맞춰 처리합니다.
기존 이름과 새 이름의 객체가 동시에 있거나 필수 객체가 없으면 오류로 중단합니다.
이 경우 테이블을 임의로 지우지 말고 오류 내용을 확인합니다.
완료된 상태에서 같은 변경 SQL을 다시 실행할 수도 있습니다.

## 변경 후 관리 경로

- 당첨번호 입력·수정: **Table Editor → `aalotto_number` → `lotto`**
- 후기 조회·수정·삭제: **Table Editor → `aareview_private` → `posts`**
- 후기 요청 제한 기록: `aareview_private.request_limits` — 일반적인 글 관리에는 수정할 필요가 없습니다.

입력 칸 `draw_no`, `draw_date`, `n1`~`n6`, `bonus_number`는 같은 이름입니다.

## 향후 사용할 파일

- 새 프로젝트 후기 설치·현재 함수 갱신: [schema.sql](schema.sql)
- 새 프로젝트 당첨번호 설치·현재 함수 갱신: [draws.sql](draws.sql)
- 기존 이름을 변경할 때: 위의 `20261029_rename_admin_tables.sql`

이전 `20261027_review_pins.sql`과 `20261029_admin_draw_results.sql`은 옛 이름을
사용한 이력 파일입니다. 이름 변경 후에는 다시 실행하지 않습니다.
현재 설치 파일을 옛 이름의 저장소에 바로 실행하면 변경 SQL을 먼저 실행하라는
안내와 함께 중단합니다.
