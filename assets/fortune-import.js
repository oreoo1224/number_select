(function () {
  'use strict';

  const signs = ['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지'];
  const sourceColumns = ['날짜','띠','출생연도','운세'];
  const importColumns = ['fortune_date','zodiac','birth_year','fortune_text'];
  const maxFileBytes = 40 * 1024 * 1024;
  const maxContentsBytes = 64 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  let files = [];
  let busy = false;
  let downloadURL = null;
  let shareFile = null;
  let completed = false;

  function problem(message) { return new Error(message); }
  function errorMessage(message) {
    $('importError').textContent = message;
    $('importError').hidden = !message;
    if (message) reveal($('importError'), $('importError'));
  }

  function reveal(element, focusTarget) {
    requestAnimationFrame(() => {
      if (element.hidden) return;
      element.scrollIntoView({behavior:'auto',block:'start'});
      if (focusTarget) focusTarget.focus({preventScroll:true});
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      let reader = null;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => {
        finish(reject, problem('파일을 읽는 데 시간이 오래 걸립니다. 기기의 다운로드 폴더에 저장한 뒤 다시 선택해 주세요.'));
        if (reader && reader.readyState === FileReader.LOADING) reader.abort();
      }, 20000);
      const unreadable = () => finish(reject, problem('파일을 읽지 못했습니다. 기기의 다운로드 폴더에 저장한 뒤 다시 선택해 주세요.'));
      try {
        if (typeof file.arrayBuffer === 'function') {
          Promise.resolve(file.arrayBuffer()).then(value => finish(resolve, value), unreadable);
        } else {
          reader = new FileReader();
          reader.onload = () => finish(resolve, reader.result);
          reader.onerror = unreadable;
          reader.onabort = unreadable;
          reader.readAsArrayBuffer(file);
        }
      } catch (_) { unreadable(); }
    });
  }

  function parseCSV(input, label) {
    const text = input.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', state = 'plain', active = false;
    const pushField = () => { row.push(field); field = ''; state = 'plain'; };
    const pushRow = () => { pushField(); rows.push(row); row = []; active = false; };
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (state === 'quoted') {
        if (character === '"') {
          if (text[index + 1] === '"') { field += '"'; index++; }
          else state = 'closed';
        } else field += character;
        continue;
      }
      if (character === ',') { pushField(); active = true; continue; }
      if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index++;
        pushRow();
        continue;
      }
      if (state === 'closed') throw problem(`${label}: CSV 따옴표 뒤의 형식을 확인해 주세요.`);
      if (character === '"') {
        if (field) throw problem(`${label}: CSV 따옴표 형식을 확인해 주세요.`);
        state = 'quoted';
      } else field += character;
      active = true;
    }
    if (state === 'quoted') throw problem(`${label}: 닫히지 않은 CSV 따옴표가 있습니다.`);
    if (active || row.length || field) pushRow();
    return rows;
  }

  function decode(bytes, label) {
    try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
    catch (_) { throw problem(`${label}: UTF-8 형식의 CSV 파일을 선택해 주세요.`); }
  }

  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1) return false;
    const parsed = new Date(date + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  function collect(text, label, rows, seen, days) {
    const parsed = parseCSV(text, label);
    const header = parsed.shift();
    if (!header || ![sourceColumns, importColumns].some(columns =>
      columns.length === header.length && columns.every((name, index) => name === header[index]))) {
      throw problem(`${label}: 날짜·띠·출생연도·운세 4개 열이 있는 CSV가 필요합니다.`);
    }
    for (let index = 0; index < parsed.length; index++) {
      const fields = parsed[index];
      const where = `${label} ${index + 2}행`;
      if (fields.length !== 4) throw problem(`${where}: 열이 4개인지 확인해 주세요.`);
      const [date, zodiac, yearText, fortune] = fields;
      if (!validDate(date)) throw problem(`${where}: 날짜는 올바른 YYYY-MM-DD 형식이어야 합니다.`);
      const year = Number(yearText);
      if (!/^[0-9]{4}$/.test(yearText) || year < 1948 || year > 2007 || signs[(year - 4) % 12] !== zodiac) {
        throw problem(`${where}: 띠와 출생연도(1948~2007년)를 확인해 주세요.`);
      }
      if (!fortune || fortune !== fortune.trim() || [...fortune].length > 300 || /[\u0000-\u001f\u007f]/.test(fortune)) {
        throw problem(`${where}: 운세는 앞뒤 공백·줄바꿈 없이 1~300자로 작성해 주세요.`);
      }
      const key = `${date}:${year}`;
      if (seen.has(key)) throw problem(`${where}: ${date} ${year}년생 자료가 중복됩니다. 같은 기간의 파일은 한 번만 선택해 주세요.`);
      seen.add(key);
      if (!days.has(date)) days.set(date, new Set());
      days.get(date).add(year);
      rows.push([date,zodiac,year,fortune]);
    }
  }

  function encodeCSV(rows) {
    const field = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
    return '\uFEFF' + [importColumns, ...rows].map(row => row.map(field).join(',')).join('\r\n') + '\r\n';
  }

  async function convertFiles(selected, report = () => {}) {
    if (!selected.length) throw problem('변환할 ZIP 또는 CSV 파일을 먼저 선택해 주세요.');
    const rows = [], seen = new Set(), days = new Map();
    let contentsBytes = 0;
    for (const file of selected) {
      if (file.size > maxFileBytes) throw problem(`${file.name}: 파일 하나의 크기는 40MB 이하여야 합니다.`);
      report(`${file.name} 확인 중…`);
      const bytes = new Uint8Array(await readFile(file));
      if (/\.csv$/i.test(file.name)) {
        contentsBytes += bytes.byteLength;
        if (contentsBytes > maxContentsBytes) throw problem('압축을 푼 전체 CSV 용량은 64MB 이하여야 합니다. 기간을 나눠 선택해 주세요.');
        collect(decode(bytes, file.name), file.name, rows, seen, days);
      } else if (/\.zip$/i.test(file.name)) {
        if (!window.JSZip) throw problem('압축파일 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
        let archive;
        try { archive = await window.JSZip.loadAsync(bytes, {createFolders:false}); }
        catch (_) { throw problem(`${file.name}: ZIP 파일을 열지 못했습니다. 원본 파일을 다시 선택해 주세요.`); }
        const entries = Object.values(archive.files).filter(entry => !entry.dir &&
          !entry.name.startsWith('__MACOSX/') && !/(?:^|\/)\.DS_Store$/.test(entry.name));
        if (!entries.length) throw problem(`${file.name}: ZIP 안에 CSV 파일이 없습니다.`);
        for (const entry of entries) {
          if (!/\.csv$/i.test(entry.name)) throw problem(`${file.name}: ZIP 안에는 CSV 파일만 넣어 주세요.`);
          const size = entry._data && entry._data.uncompressedSize;
          if (!Number.isSafeInteger(size) || size < 0) throw problem(`${file.name}: 압축파일의 크기 정보를 확인하지 못했습니다.`);
          contentsBytes += size;
          if (contentsBytes > maxContentsBytes) throw problem('압축을 푼 전체 CSV 용량은 64MB 이하여야 합니다. 기간을 나눠 선택해 주세요.');
        }
        // Verify source integrity after checking the declared expanded size.
        try { archive = await window.JSZip.loadAsync(bytes, {createFolders:false,checkCRC32:true}); }
        catch (_) { throw problem(`${file.name}: 압축파일이 손상되었거나 암호로 잠겨 있습니다. 원본 파일을 다시 선택해 주세요.`); }
        for (const entry of entries) {
          let contents;
          try { contents = await archive.file(entry.name).async('uint8array'); }
          catch (_) { throw problem(`${entry.name}: CSV 파일을 압축에서 꺼내지 못했습니다.`); }
          collect(decode(contents, entry.name), entry.name, rows, seen, days);
        }
      } else throw problem(`${file.name}: ZIP 또는 CSV 파일을 선택해 주세요.`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!rows.length) throw problem('선택한 파일에 운세 자료가 없습니다.');
    const dates = [...days.keys()].sort();
    for (let index = 0; index < dates.length; index++) {
      const date = dates[index];
      if (days.get(date).size !== 60) throw problem(`${date}: 하루에 12띠 × 출생연도 5개, 총 60개 자료가 필요합니다.`);
      if (index && Date.parse(date + 'T00:00:00Z') - Date.parse(dates[index - 1] + 'T00:00:00Z') !== 86400000) {
        throw problem(`${dates[index - 1]} 다음부터 ${date} 사이에 빠진 날짜가 있습니다. 나머지 기간 파일도 선택해 주세요.`);
      }
    }
    rows.sort((a,b) => a[0].localeCompare(b[0]) || signs.indexOf(a[1]) - signs.indexOf(b[1]) || a[2] - b[2]);
    return {csv:encodeCSV(rows),rows:rows.length,days:dates.length,start:dates[0],end:dates[dates.length - 1]};
  }

  function resetOutput() {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = null;
    shareFile = null;
    completed = false;
    $('importStatus').classList.remove('is-complete');
    $('importResult').hidden = true;
    $('downloadCsv').hidden = true;
    $('downloadCsv').removeAttribute('href');
    $('shareCsv').hidden = true;
    $('importSummary').textContent = '';
  }

  function renderFiles() {
    $('selectedFiles').replaceChildren();
    for (const file of files) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '선택 취소';
      remove.setAttribute('aria-label', `${file.name} 선택 취소`);
      remove.disabled = busy;
      remove.addEventListener('click', () => {
        files = files.filter(candidate => candidate !== file);
        $('importFiles').value = '';
        resetOutput();
        errorMessage('');
        renderFiles();
        $('importStatus').textContent = files.length ? `${files.length}개 파일을 선택했습니다.` : 'ZIP 또는 CSV 파일을 선택해 주세요.';
      });
      item.append(name, remove);
      $('selectedFiles').appendChild(item);
    }
    $('importFiles').disabled = busy;
    $('clearFiles').disabled = busy || !files.length;
    $('convertFiles').disabled = busy || !files.length;
    $('convertFiles').textContent = busy ? '확인·변환 중…' : completed ? 'CSV 다시 만들기' : '확인하고 CSV 만들기';
  }

  $('importFiles').addEventListener('change', () => {
    const incoming = [...$('importFiles').files];
    if (!incoming.length || busy) return;
    resetOutput();
    errorMessage('');
    for (const file of incoming) {
      if (!/\.(zip|csv)$/i.test(file.name) || file.size > maxFileBytes) {
        errorMessage('40MB 이하의 ZIP 또는 CSV 파일을 선택해 주세요.');
        continue;
      }
      if (!files.some(candidate => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified)) files.push(file);
    }
    renderFiles();
    $('importStatus').textContent = files.length ? `${files.length}개 파일을 선택했습니다. 다른 기간 파일도 추가로 선택할 수 있습니다.` : 'ZIP 또는 CSV 파일을 선택해 주세요.';
  });

  $('clearFiles').addEventListener('click', () => {
    if (busy) return;
    files = [];
    $('importFiles').value = '';
    resetOutput();
    errorMessage('');
    renderFiles();
    $('importStatus').textContent = 'ZIP 또는 CSV 파일을 선택해 주세요.';
  });

  $('convertFiles').addEventListener('click', async () => {
    if (busy || !files.length) return;
    busy = true;
    resetOutput();
    errorMessage('');
    renderFiles();
    try {
      const result = await convertFiles(files, message => { $('importStatus').textContent = message; });
      const blob = new Blob([result.csv], {type:'text/csv;charset=utf-8'});
      downloadURL = URL.createObjectURL(blob);
      $('downloadCsv').href = downloadURL;
      $('downloadCsv').download = 'all_fortunes.csv';
      $('downloadCsv').hidden = false;
      $('importSummary').textContent = `${result.start} ~ ${result.end} · ${result.days.toLocaleString('ko-KR')}일 · ${result.rows.toLocaleString('ko-KR')}개 운세`;
      try {
        const candidate = new File([blob], 'all_fortunes.csv', {type:'text/csv'});
        if (navigator.share && navigator.canShare && navigator.canShare({files:[candidate]})) {
          shareFile = candidate;
          $('shareCsv').hidden = false;
        }
      } catch (_) { /* File download remains available if native sharing is absent. */ }
      $('importResult').hidden = false;
      completed = true;
      $('importStatus').classList.add('is-complete');
      $('importStatus').textContent = '변환을 완료했습니다. CSV 다운로드를 눌러 저장해 주세요.';
      reveal($('importResult'), $('downloadCsv'));
    } catch (error) {
      resetOutput();
      errorMessage(error instanceof Error ? error.message : '변환하지 못했습니다. 원본 파일을 다시 확인해 주세요.');
      $('importStatus').textContent = '파일을 확인한 뒤 다시 변환할 수 있습니다.';
    } finally {
      busy = false;
      renderFiles();
    }
  });

  $('shareCsv').addEventListener('click', async () => {
    if (!shareFile || !navigator.share) return;
    try { await navigator.share({files:[shareFile]}); }
    catch (error) {
      if (error && error.name !== 'AbortError') errorMessage('파일 저장·공유를 열지 못했습니다. CSV 다운로드 버튼을 이용해 주세요.');
    }
  });

  window.FortuneImport = Object.freeze({parseCSV,convertFiles});
  renderFiles();
}());
