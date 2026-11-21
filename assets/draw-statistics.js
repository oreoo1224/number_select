(function () {
  'use strict';

  const api = window.DrawsAPI;
  const button = document.getElementById('loadDrawStatistics');
  const status = document.getElementById('drawStatisticsStatus');
  const result = document.getElementById('drawStatisticsResult');
  const periodSize = 10;
  const requiredDraws = 2 * periodSize;
  const batchSize = 4;
  const sumRanges = [[21, 59], [60, 89], [90, 119], [120, 149], [150, 179], [180, 209], [210, 239], [240, 255]];

  async function readDraws(latest) {
    const draws = [latest];
    for (let offset = 1; offset < requiredDraws; offset += batchSize) {
      const size = Math.min(batchSize, requiredDraws - offset);
      const batch = await Promise.all(Array.from({ length: size }, (_, index) => api.get(latest.draw_no - offset - index)));
      for (const draw of batch) {
        if (!draw) return draws;
        if (draw.draw_date >= draws[draws.length - 1].draw_date) throw new Error('Draw dates out of order');
        draws.push(draw);
      }
    }
    return draws;
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

  function comparison(title, category, labels, recent, previous, note) {
    const details = document.createElement('details');
    details.className = 'draw-statistics-panel';
    details.append(createText('summary', title), createText('p', note));

    const table = document.createElement('table');
    table.append(createText('caption', `${title} (단위 회)`));
    const header = table.createTHead().insertRow();
    for (const label of [category, '최근 10회', '직전 10회']) {
      const cell = createText('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    labels.forEach((label, index) => {
      const row = body.insertRow();
      const cell = createText('th', label);
      cell.scope = 'row';
      row.append(cell, createText('td', recent[index]), createText('td', previous[index]));
    });
    details.append(table);
    return details;
  }

  function describePeriod(label, draws) {
    const oldest = draws[draws.length - 1];
    const newest = draws[0];
    return createText('li', `${label} ${oldest.draw_no}~${newest.draw_no}회 (${oldest.draw_date} ~ ${newest.draw_date})`);
  }

  function render(draws) {
    const recentDraws = draws.slice(0, periodSize);
    const previousDraws = draws.slice(periodSize);
    const recent = summarize(recentDraws);
    const previous = summarize(previousDraws);
    const periods = document.createElement('ul');
    periods.append(describePeriod('최근 10회', recentDraws), describePeriod('직전 10회', previousDraws));

    result.append(
      periods,
      comparison('번호별 출현 횟수', '번호', recent.frequency.map((_, index) => index + 1), recent.frequency, previous.frequency,
        '각 번호가 해당 기간의 당첨번호 6개 안에 들어간 회차 수입니다.'),
      comparison('홀짝 분포', '홀수 : 짝수', recent.odd.map((_, index) => `${index} : ${6 - index}`), recent.odd, previous.odd,
        '한 회차에 나온 홀수 개수와 짝수 개수를 한 쌍으로 집계합니다.'),
      comparison('번호 합계 분포', '합계 구간', sumRanges.map(([low, high]) => `${low}~${high}`), recent.sum, previous.sum,
        '회차마다 당첨번호 6개를 더해 해당하는 합계 구간에 한 번 더합니다.'),
      comparison('연속 번호 출현', '연속 번호 쌍', ['한 쌍 이상', '없음'], recent.consecutive, previous.consecutive,
        '차이가 1인 번호 쌍이 있으면 해당 회차를 한 번 집계합니다. 12·13·14처럼 한 회차에 여러 쌍이 있을 때도 횟수는 1회입니다.'),
    );
  }

  if (!api?.isConfigured()) {
    status.textContent = '등록 당첨번호 조회를 사용할 수 없습니다.';
    return;
  }

  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    result.replaceChildren();
    status.textContent = '등록 당첨번호를 확인하는 중입니다.';

    try {
      const latest = await api.latest();
      if (!latest) {
        status.textContent = '조회할 수 있는 등록 당첨번호가 없습니다.';
        return;
      }
      const draws = latest.draw_no >= requiredDraws ? await readDraws(latest) : [latest];
      if (draws.length < requiredDraws) {
        status.textContent = `최신 등록 ${latest.draw_no}회(${latest.draw_date})부터 연속 ${draws.length}회를 확인했습니다. 두 기간을 비교하려면 연속 20회가 필요합니다.`;
        return;
      }
      render(draws);
      status.textContent = '연속 20회의 등록 결과를 확인했습니다. 항목을 펼치면 집계 결과를 볼 수 있습니다.';
    } catch (_) {
      status.textContent = '등록 당첨번호를 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.';
    } finally {
      button.disabled = false;
    }
  });
}());
