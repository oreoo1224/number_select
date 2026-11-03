#!/usr/bin/env python3
"""Validate monthly Korean CSV archives and prepare private dashboard imports."""

import argparse
import csv
import datetime as dt
import io
import json
from pathlib import Path
import re
import zipfile


SIGNS = ('쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지')
SOURCE_COLUMNS = ['날짜', '띠', '출생연도', '운세']
IMPORT_COLUMNS = ['fortune_date', 'zodiac', 'birth_year', 'fortune_text']
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024


def load_archives(paths):
    rows = []
    seen = set()
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            files = [entry for entry in archive.infolist() if not entry.is_dir()]
            if sum(entry.file_size for entry in files) > MAX_ARCHIVE_BYTES:
                raise ValueError(f'{path}: archive exceeds the import size limit')
            for entry in files:
                if not entry.filename.lower().endswith('.csv'):
                    raise ValueError(f'{path}: expected CSV files only: {entry.filename}')
                contents = archive.read(entry).decode('utf-8-sig')
                source = csv.reader(io.StringIO(contents, newline=''), strict=True)
                if next(source, None) != SOURCE_COLUMNS:
                    raise ValueError(f'{entry.filename}: expected {SOURCE_COLUMNS}')
                for line, fields in enumerate(source, 2):
                    where = f'{entry.filename}:{line}'
                    if len(fields) != 4:
                        raise ValueError(f'{where}: expected four fields')
                    date, sign, year_text, text = fields
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
                        raise ValueError(f'{where}: date must use YYYY-MM-DD')
                    if dt.date.fromisoformat(date).isoformat() != date:
                        raise ValueError(f'{where}: invalid calendar date')
                    if not re.fullmatch(r'[0-9]{4}', year_text):
                        raise ValueError(f'{where}: birth year must contain four digits')
                    year = int(year_text)
                    if not 1948 <= year <= 2007 or sign != SIGNS[(year - 4) % 12]:
                        raise ValueError(f'{where}: incorrect zodiac or unsupported birth year')
                    if not 1 <= len(text) <= 300 or text != text.strip():
                        raise ValueError(f'{where}: empty, padded or overlong fortune')
                    if any(ord(char) < 32 or ord(char) == 127 for char in text):
                        raise ValueError(f'{where}: fortune must be a single plain-text line')
                    key = (date, year)
                    if key in seen:
                        raise ValueError(f'{where}: duplicate date/birth year {key}')
                    seen.add(key)
                    rows.append((date, sign, year, text))
    if not rows:
        raise ValueError('No fortune rows were found')

    rows.sort(key=lambda row: (row[0], SIGNS.index(row[1]), row[2]))
    dates = sorted({row[0] for row in rows})
    start = dt.date.fromisoformat(dates[0])
    end = dt.date.fromisoformat(dates[-1])
    expected_dates = [(start + dt.timedelta(days=offset)).isoformat()
                      for offset in range((end - start).days + 1)]
    if dates != expected_dates:
        raise ValueError('The date range contains missing days')
    required_years = set(range(1948, 2008))
    for date in dates:
        if {year for candidate, year in seen if candidate == date} != required_years:
            raise ValueError(f'{date}: expected all 60 birth years (five per zodiac)')
    return rows, dates


def write_csv(path, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(IMPORT_COLUMNS)
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True,
                        help='Private output directory outside the Git repository')
    parser.add_argument('archives', type=Path, nargs='+')
    args = parser.parse_args()
    output = args.output.resolve()
    repository = Path(__file__).resolve().parent.parent
    if output == repository or repository in output.parents:
        parser.error('Store private import files outside the repository')
    if output.exists() and any(output.iterdir()):
        parser.error('Output directory must be empty so existing imports are not overwritten')
    try:
        rows, dates = load_archives(args.archives)
    except (ValueError, UnicodeError, csv.Error, zipfile.BadZipFile, OSError) as error:
        parser.error(str(error))

    output.mkdir(parents=True, exist_ok=True)
    monthly = output / 'monthly'
    monthly.mkdir()
    write_csv(output / 'all_fortunes.csv', rows)
    for month in sorted({row[0][:7] for row in rows}):
        write_csv(monthly / f'{month}.csv', [row for row in rows if row[0].startswith(month)])
    report = {
        'start': dates[0], 'end': dates[-1], 'days': len(dates), 'rows': len(rows),
        'rows_per_day': 60,
        'birth_years': {sign: [year for year in range(1948, 2008)
                              if SIGNS[(year - 4) % 12] == sign] for sign in SIGNS},
    }
    (output / 'validation.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), **report}, ensure_ascii=False))


if __name__ == '__main__':
    main()
