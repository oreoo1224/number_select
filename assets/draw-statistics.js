(function () {
  'use strict';

  const api = window.DrawsAPI;
  const buttons = [...document.querySelectorAll('[data-statistics-period]')];
  const status = document.getElementById('drawStatisticsStatus');
  const result = document.getElementById('drawStatisticsResult');
  if (!buttons.length || !status || !result) return;

  const recentCount = 10;
  const requestBatchSize = 4;
  const sumRanges = [[21, 59], [60, 89], [90, 119], [120, 149], [150, 179], [180, 209], [210, 239], [240, 255]];
  const numberFormat = new Intl.NumberFormat('ko-KR');
  let archivePromise;

  async function loadArchive() {
    const response = await fetch('/assets/draw-history.json', { signal: AbortSignal.timeout?.(8000) });
    if (!response.ok) throw new Error('Archive unavailable');

    const { start, draws } = await response.json();
    if (start !== 1 || !Array.isArray(draws) || draws.length < recentCount) throw new Error('Invalid archive');

    const koreanDate = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const datePart = type => koreanDate.find(part => part.type === type).value;
    const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;

    let precedingDate = '';
    return draws.map((row, index) => {
      if (!Array.isArray(row) || row.length !== 7) throw new Error('Invalid archive row');
      const [date, ...numbers] = row;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= precedingDate || date > today ||
          new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
          numbers.some((number, position) => !Number.isInteger(number) || number < 1 || number > 45 ||
            (position > 0 && number <= numbers[position - 1]))) {
        throw new Error('Invalid archive row');
      }
      precedingDate = date;
      return { draw_no: index + start, draw_date: date, winning_numbers: numbers };
    });
  }

  function readArchive() {
    if (!archivePromise) {
      archivePromise = loadArchive().catch(() => {
        archivePromise = null;
        return [];
      });
    }
    return archivePromise;
  }

  async function readLatest() {
    try {
      if (api?.isConfigured()) return { latest: await api.latest(), unavailable: false };
    } catch (_) {
      // A validated archive can still be used during a live lookup failure.
    }
    return { latest: null, unavailable: true };
  }

  async function readSupplement(latest, firstRound, precedingDate) {
    const draws = [];
    for (let round = firstRound; round <= latest.draw_no; round += requestBatchSize) {
      const size = Math.min(requestBatchSize, latest.draw_no - round + 1);
      const batch = await Promise.allSettled(Array.from({ length: size }, (_, index) => {
        const requested = round + index;
        return requested === latest.draw_no ? latest : api.get(requested);
      }));
      for (const entry of batch) {
        const draw = entry.value;
        if (!draw || (precedingDate && draw.draw_date <= precedingDate)) return draws;
        draws.push(draw);
        precedingDate = draw.draw_date;
      }
    }
    return draws;
  }

  async function selectDraws(period, archive, lookup) {
    const { latest, unavailable } = lookup;
    const lastArchived = archive.at(-1);
    const archivedRound = lastArchived?.draw_no ?? 0;
    const recent = period === 'recent';
    const archivedDraws = recent ? archive.slice(-recentCount) : archive;
    const archiveSource = '동행복권 당첨결과 보관 자료';

    if (!latest || latest.draw_no <= archivedRound) {
      const notice = unavailable ? '최신 등록 자료 조회에 실패해 보관 자료를 사용했습니다.' : '';
      return { draws: archivedDraws, source: archiveSource, notice };
    }

    if (!recent && !archivedRound) return { draws: [], source: '', notice: '' };

    const firstSelected = recent ? latest.draw_no - recentCount + 1 : 1;
    if (firstSelected < 1) return { draws: [], source: '', notice: '' };
    const firstSupplement = Math.max(firstSelected, archivedRound + 1);
    const earlier = archive.slice(firstSelected - 1);
    const supplement = await readSupplement(latest, firstSupplement, earlier.at(-1)?.draw_date);
    const complete = supplement.at(-1)?.draw_no === latest.draw_no;
    const gapNotice = '최신 회차까지 연속 자료를 확인하지 못했습니다.';
    if (!supplement.length || (recent && !complete)) {
      return {
        draws: archivedDraws,
        source: archiveSource,
        notice: `${gapNotice} 보관 자료를 사용했습니다.`,
      };
    }

    return {
      draws: earlier.concat(supplement),
      source: earlier.length ? `${archiveSource}와 행운설계소 추가 등록 자료` : '행운설계소 등록 자료',
      notice: complete ? '' : `${gapNotice} 확인된 연속 구간을 집계했습니다.`,
    };
  }

  function summarize(draws) {
    const frequency = Array(45).fill(0);
    const odd = Array(7).fill(0);
    const sum = Array(sumRanges.length).fill(0);
    let consecutive = 0;

    for (const { winning_numbers: numbers } of draws) {
      numbers.forEach(number => { frequency[number - 1] += 1; });
      odd[numbers.filter(number => number % 2 === 1).length] += 1;
      const total = numbers.reduce((accumulator, number) => accumulator + number, 0);
      const range = sumRanges.findIndex(([low, high]) => total >= low && total <= high);
      sum[range] += 1;
      if (numbers.some((number, index) => index > 0 && number - numbers[index - 1] === 1)) {
        consecutive += 1;
      }
    }

    return { frequency, odd, sum, consecutive: [consecutive, draws.length - consecutive] };
  }

  function createText(tag, content) {
    const element = document.createElement(tag);
    element.textContent = content;
    return element;
  }

  function breakdown(title, category, labels, counts, note) {
    const details = document.createElement('details');
    details.className = 'draw-statistics-panel';
    details.append(createText('summary', title));
    if (note) details.append(createText('p', note));

    const table = document.createElement('table');
    table.append(createText('caption', `${title} (단위 회)`));
    const header = table.createTHead().insertRow();
    for (const label of [category, '회차 수']) {
      const cell = createText('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    labels.forEach((label, index) => {
      const row = body.insertRow();
      const cell = createText('th', label);
      cell.scope = 'row';
      row.append(cell, createText('td', numberFormat.format(counts[index])));
    });
    details.append(table);
    return details;
  }

  function render({ draws, source, notice }, period) {
    const first = draws[0];
    const last = draws.at(-1);
    const count = numberFormat.format(draws.length);
    const range = `${numberFormat.format(first.draw_no)}~${numberFormat.format(last.draw_no)}회`;
    const stats = summarize(draws);
    result.append(
      createText('h2', period === 'recent' ? '최근 10회 집계' : '1회부터 집계'),
      createText('p', `${range} (${first.draw_date} ~ ${last.draw_date}) · 총 ${count}회`),
      createText('p', `집계 자료 · ${source}`),
      breakdown('번호별 출현 횟수', '번호', stats.frequency.map((_, index) => index + 1), stats.frequency),
      breakdown('홀짝 분포', '홀수 : 짝수', stats.odd.map((_, index) => `${index} : ${6 - index}`), stats.odd),
      breakdown('번호 합계 분포', '합계 구간', sumRanges.map(([low, high]) => `${low}~${high}`), stats.sum),
      breakdown('연속 번호 출현', '연속 번호 쌍', ['한 쌍 이상', '없음'], stats.consecutive,
        '연속된 번호 쌍이 여러 개여도 한 회차로 셉니다.'),
    );
    status.textContent = notice || '집계 완료.';
  }

  async function showStatistics(button) {
    const period = button.dataset.statisticsPeriod;
    buttons.forEach(control => {
      control.disabled = true;
      control.setAttribute('aria-pressed', String(control === button));
    });
    result.replaceChildren();
    status.textContent = '회차 자료를 확인하는 중입니다.';

    try {
      const [archive, latest] = await Promise.all([readArchive(), readLatest()]);
      const selection = await selectDraws(period, archive, latest);
      if (selection.draws.length) {
        render(selection, period);
      } else {
        status.textContent = period === 'recent'
          ? '연속된 최근 10회 자료를 확인하지 못했습니다.'
          : '1회부터 이어지는 당첨번호 자료를 확인하지 못했습니다.';
      }
    } catch (_) {
      status.textContent = '회차 자료를 불러오지 못했습니다. 다시 선택해 주세요.';
    } finally {
      buttons.forEach(control => { control.disabled = false; });
    }
  }

  buttons.forEach(button => {
    button.hidden = false;
    button.addEventListener('click', () => showStatistics(button));
  });
}());
