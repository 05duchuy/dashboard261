/* ==========================================================
   Real-time IoT Overview — interactions
   LƯU Ý: toàn bộ số liệu bên dưới là DỮ LIỆU MÔ PHỎNG để dựng giao diện.
   Khi có backend/MQTT, thay các chỗ đánh dấu "TODO(data)".
   ========================================================== */
(() => {
  'use strict';
  const SUPABASE_URL = 'https://tswqqezlffhzdbzcsiaa.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzd3FxZXpsZmZoemRiemNzaWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNjM2OTAsImV4cCI6MjEwNjkzOTY5MH0.xz1cPCzMttBR-P4oIMcSLRctLuDCtcPCffDcMpsynvI';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------- Toast ---------- */
  function toast(message, type = 'ok') {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'info' ? ' is-info' : '');
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-out');
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }

  /* ---------- Math helpers ---------- */

  // Nội suy monotone cubic (Fritsch–Carlson): mượt, không vọt quá đỉnh.
  function monotone(xs, ys) {
    const n = xs.length;
    const d = [];
    const m = new Array(n);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    return (x) => {
      x = clamp(x, xs[0], xs[n - 1]);
      let i = 0;
      while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i];
      const t = (x - xs[i]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] +
             (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function tween(from, to, dur, onUpdate) {
    if (reduceMotion || dur <= 0) { onUpdate(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      onUpdate(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ==========================================================
     KPI cards
     ========================================================== */
  const kpi = {
    temp:  { base: 28.5,  jitter: 0.4, el: $('[data-kpi="temp"]'),  fmt: (v) => v.toFixed(1) },
    hum:   { base: 65,    jitter: 3,   el: $('[data-kpi="hum"]'),   fmt: (v) => String(Math.round(v)) },
    soil:  { base: 42,    jitter: 1.5, el: $('[data-kpi="soil"]'),  fmt: (v) => String(Math.round(v)) },
    light: { base: 18500, jitter: 250, el: $('[data-kpi="light"]'), fmt: (v) => Math.round(v).toLocaleString('en-US') },
    co2:   { base: 650,   jitter: 8,   el: $('[data-kpi="co2"]'),   fmt: (v) => String(Math.round(v)) },
  };
  for (const k of Object.values(kpi)) k.value = k.base;

  const GAUGE_C = 2 * Math.PI * 18.5;
  function setGauge(pct) {
    $('#gauge-value').setAttribute('stroke-dasharray', `${(GAUGE_C * pct) / 100} ${GAUGE_C}`);
    $('#gauge-text').textContent = Math.round(pct);
  }

  function syncSensors() {
    $('#sensor-th').textContent = `${kpi.temp.fmt(kpi.temp.value)}°C / ${kpi.hum.fmt(kpi.hum.value)}%`;
    $('#sensor-co2').textContent = `${kpi.co2.fmt(kpi.co2.value)} ppm`;
  }

  function setKpi(key, target, dur) {
    const k = kpi[key];
    const from = k.value;
    k.value = target;
    tween(from, target, dur, (v) => { k.el.textContent = k.fmt(v); });
    if (key === 'hum') setGauge(target);
  }

  // Sparkline
  const sparkData = {
    temp:  [0.15, 0.3, 0.2, 0.45, 0.35, 0.55, 0.5, 0.75, 0.7, 0.9],
    soil:  [0.5, 0.35, 0.5, 0.65, 0.5, 0.4, 0.55, 0.75, 0.6, 0.8],
    light: [0.4, 0.3, 0.45, 0.6, 0.35, 0.5, 0.7, 0.55, 0.75, 0.85],
    co2:   [0.2, 0.25, 0.15, 0.35, 0.3, 0.45, 0.4, 0.7, 0.65, 0.85],
  };

  function sparkPath(values) {
    const xs = values.map((_, i) => (i / (values.length - 1)) * 74);
    const ys = values.map((v) => 2 + (1 - v) * 22);
    const f = monotone(xs, ys);
    let d = '';
    for (let x = 0; x <= 74; x += 1) d += (x ? 'L' : 'M') + x + ' ' + f(x).toFixed(2) + ' ';
    return d;
  }

  function renderSparks(animate) {
    $$('[data-spark]').forEach((p) => {
      p.setAttribute('d', sparkPath(sparkData[p.dataset.spark]));
      if (animate && !reduceMotion) {
        p.setAttribute('pathLength', '1');
        p.classList.add('draw');
      }
    });
  }

  function tickKpis(dur = 600) {
    const rnd = (j) => (Math.random() - 0.5) * 2 * j;
    for (const key of Object.keys(kpi)) {
      const k = kpi[key];
      let next = k.base + rnd(k.jitter);
      if (key === 'temp') next = Math.round(next * 10) / 10;
      else next = Math.round(next);
      setKpi(key, next, dur);
    }
    // Đẩy điểm mới vào sparkline
    for (const key of Object.keys(sparkData)) {
      const arr = sparkData[key];
      const last = arr[arr.length - 1];
      arr.push(clamp(last + (Math.random() - 0.5) * 0.35, 0.05, 0.95));
      arr.shift();
    }
    renderSparks(false);
    // Đợi tween xong rồi đồng bộ text cảm biến
    setTimeout(syncSensors, dur + 20);
    $('#last-update').textContent = 'LAST ' + clockString(new Date());
  }

  function clockString(d) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  /* ==========================================================
     24-hour chart
     ========================================================== */
  const DAY_TEMP = [[0, 24], [2, 24.6], [4, 25.4], [6, 26.2], [8, 27.2], [10, 29.2], [11.5, 30.3], [13, 29.9],
                    [14.5, 28.8], [16.3, 29.7], [18, 30.6], [19.5, 31.8], [21, 32.5], [22.5, 32.7], [24, 32.3]];
  const DAY_SOIL = [[0, 32.4], [2, 31.6], [4, 30.4], [6, 28.6], [8, 27.3], [10, 27.8], [12, 29.2], [13.5, 28.5],
                    [15, 27.6], [16.3, 26.75], [18, 25.6], [20, 25.2], [21.5, 24.6], [23, 24.9], [24, 24.1]];

  // Trục Y của Figma: 24–32 (°C). Độ ẩm đất dùng cùng trục hiển thị: 25% … 75%.
  const soilPercent = (v) => 25 + 6.25 * (v - 24);

  const DAY_MS = 24 * 3600e3;

  function fnFromPoints(points, spanX) {
    return monotone(points.map((p) => p[0] / spanX), points.map((p) => p[1]));
  }

  function randomSeries(seed, count) {
    const rnd = mulberry32(seed);
    const xs = []; const t = []; const s = [];
    let tv = 27 + rnd() * 3; let sv = 27 + rnd() * 3;
    for (let i = 0; i < count; i++) {
      xs.push(i / (count - 1));
      tv = clamp(tv + (rnd() - 0.5) * 3.2, 24.4, 32);
      sv = clamp(sv + (rnd() - 0.5) * 3.2, 24.4, 32);
      t.push(tv); s.push(sv);
    }
    return { temp: monotone(xs, t), soil: monotone(xs, s) };
  }

  const fmtDate = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const fmtDay = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  const fmtHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  function buildRange(range) {
    const now = new Date();
    if (range === 'live' || range === '1d') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return {
        title: '24 giờ',
        temp: fnFromPoints(DAY_TEMP, 24),
        soil: fnFromPoints(DAY_SOIL, 24),
        labels: [0, 4, 8, 12, 16, 20, 24].map((h) => `${pad2(h)}:00`),
        at: (t) => new Date(start + t * DAY_MS),
      };
    }
    const days = range === '1w' ? 7 : 30;
    const span = days * DAY_MS;
    const startMs = now.getTime() - span;
    const series = randomSeries(range === '1w' ? 7 : 30, range === '1w' ? 14 : 20);
    return {
      title: `${days} ngày`,
      temp: series.temp,
      soil: series.soil,
      labels: Array.from({ length: 7 }, (_, i) => fmtDay(new Date(startMs + (i / 6) * span))),
      at: (t) => new Date(startMs + t * span),
    };
  }

  const plot = $('#plot');
  const svg = $('#plot-svg');
  const tooltip = $('#tooltip');
  const PINNED_T = (507 - 38) / 690; // vị trí tooltip mẫu trong Figma
  const GRID_Y = [44, 98, 152, 206, 260];
  const AXIS = [32, 30, 28, 26, 24];
  const yOf = (v) => 44 + (32 - v) * 27;

  let range = 'live';
  let data = buildRange(range);
  let geo = { w: 0, left: 38, right: 36 };
  let cursorT = PINNED_T;
  let hovering = false;
  let guide, ptTemp, ptSoil;

  const xOf = (t) => geo.left + t * (geo.w - geo.left - geo.right);

  function linePath(fn) {
    const span = geo.w - geo.left - geo.right;
    const steps = Math.max(60, Math.round(span / 4));
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      d += (i ? 'L' : 'M') + xOf(t).toFixed(1) + ' ' + yOf(clamp(fn(t), 24, 32.6)).toFixed(1) + ' ';
    }
    return d;
  }

  function drawChart() {
    geo.w = plot.clientWidth;
    const H = 292;
    svg.setAttribute('viewBox', `0 0 ${geo.w} ${H}`);
    svg.textContent = '';

    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: 'area-grad', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#06b6d4', 'stop-opacity': 0.28 }),
      svgEl('stop', { offset: '100%', 'stop-color': '#06b6d4', 'stop-opacity': 0 }),
    );
    defs.appendChild(grad);
    svg.appendChild(defs);

    GRID_Y.forEach((y, i) => {
      svg.appendChild(svgEl('line', { class: 'grid', x1: geo.left, x2: geo.w - geo.right, y1: y, y2: y }));
      const t = svgEl('text', { class: 'axis', x: 8, y: y + 3 });
      t.textContent = AXIS[i];
      svg.appendChild(t);
    });

    const span = geo.w - geo.left - geo.right;
    data.labels.forEach((label, i) => {
      const t = svgEl('text', { class: 'axis', x: geo.left + (i * (span - 18)) / 6, y: 280 });
      t.textContent = label;
      svg.appendChild(t);
    });

    const tempD = linePath(data.temp);
    const soilD = linePath(data.soil);
    const animate = !reduceMotion;

    const area = svgEl('path', {
      d: `${tempD} L${xOf(1).toFixed(1)} 262 L${xOf(0).toFixed(1)} 262 Z`,
      fill: 'url(#area-grad)',
    });
    if (animate) area.classList.add('fade-in');
    svg.appendChild(area);

    for (const [d, cls] of [[soilD, 'line--soil'], [tempD, 'line--temp']]) {
      const p = svgEl('path', { class: `line ${cls}`, d, pathLength: 1 });
      if (animate) p.classList.add('draw');
      svg.appendChild(p);
    }

    guide = svgEl('line', { class: 'guide', y1: 34, y2: 238 });
    ptSoil = svgEl('circle', { class: 'pt pt--soil', r: 5 });
    ptTemp = svgEl('circle', { class: 'pt pt--temp', r: 5 });
    svg.append(guide, ptSoil, ptTemp);

    moveCursor(cursorT);
  }

  function moveCursor(t) {
    cursorT = clamp(t, 0, 1);
    const x = xOf(cursorT);
    const tv = data.temp(cursorT);
    const sv = data.soil(cursorT);
    guide.setAttribute('x1', x); guide.setAttribute('x2', x);
    ptTemp.setAttribute('cx', x); ptTemp.setAttribute('cy', yOf(clamp(tv, 24, 32.6)));
    ptSoil.setAttribute('cx', x); ptSoil.setAttribute('cy', yOf(clamp(sv, 24, 32.6)));

    const when = data.at(cursorT);
    $('#tt-ts').textContent = `${fmtDate(when)} · ${fmtHM(when)}`;
    $('#tt-temp').textContent = `${tv.toFixed(1)}°C`;
    $('#tt-soil').textContent = `${Math.round(soilPercent(sv))}%`;

    // Tooltip nằm bên phải đường guide (+13px), lật sang trái khi gần mép.
    const w = tooltip.offsetWidth || 166;
    tooltip.style.left = (x + 13 + w > geo.w ? x - 13 - w : x + 13) + 'px';
  }

  plot.addEventListener('pointermove', (e) => {
    const rect = plot.getBoundingClientRect();
    const span = geo.w - geo.left - geo.right;
    hovering = true;
    moveCursor((e.clientX - rect.left - geo.left) / span);
  });
  plot.addEventListener('pointerleave', () => {
    hovering = false;
    moveCursor(PINNED_T);
  });

  new ResizeObserver(() => { if (plot.clientWidth !== geo.w) drawChart(); }).observe(plot);

  // Bộ lọc thời gian
  $$('.time-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.range === range) return;
      range = btn.dataset.range;
      $$('.time-filter').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      data = buildRange(range);
      $('#chart-title').textContent = `Biến động môi trường · ${data.title}`;
      cursorT = PINNED_T;
      drawChart();
    });
  });

  /* ==========================================================
     Navigation / quick actions (các trang này chưa có trong Figma)
     ========================================================== */
  $$('.nav-item[data-todo]').forEach((btn) => {
    btn.addEventListener('click', () => toast(`“${btn.dataset.todo}” chưa có trong thiết kế Figma này.`, 'info'));
  });
  $('#btn-twin').addEventListener('click', () => toast('“3D Spatial Twin” chưa có trong thiết kế Figma này.', 'info'));

  /* ==========================================================
     Irrigation dialog (form)
     ========================================================== */
  const dialog = $('#irrigation-dialog');
  const form = $('#irrigation-form');
  const fDuration = $('#f-duration');
  const fRange = $('#f-range');
  const fNote = $('#f-note');
  const durError = $('#duration-error');
  const irrigateBtn = $('#btn-irrigate');
  let irrigationTimer = null;

  function openDialog() {
    if (irrigateBtn.disabled) return;
    durError.textContent = '';
    fDuration.removeAttribute('aria-invalid');
    dialog.showModal();
    $('#f-zone').focus();
  }

  const closeDialog = () => dialog.close();

  irrigateBtn.addEventListener('click', openDialog);
  $('#dlg-close').addEventListener('click', closeDialog);
  $('#dlg-cancel').addEventListener('click', closeDialog);
  // Bấm ra ngoài hộp thoại để đóng
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(); });

  fRange.addEventListener('input', () => { fDuration.value = fRange.value; durError.textContent = ''; fDuration.removeAttribute('aria-invalid'); });
  fDuration.addEventListener('input', () => {
    const v = Number(fDuration.value);
    if (Number.isInteger(v) && v >= 1 && v <= 60) fRange.value = v;
  });
  fNote.addEventListener('input', () => { $('#note-count').textContent = fNote.value.length; });

  async function startIrrigation({ zone, zoneLabel, minutes, note }) {
    // 1. Gọi API lưu dữ liệu xuống Supabase
    const { error } = await supabase
      .from('irrigation_logs')
      .insert([{ 
        zone: zone, 
        duration_minutes: minutes, 
        note: note 
      }]);

    if (error) {
      toast('Lỗi kết nối DB: ' + error.message, 'error');
      return;
    }

    // 2. Chạy hiệu ứng UI như cũ nếu lưu thành công
    document.dispatchEvent(new CustomEvent('irrigation:start', { detail: { zone, minutes, note } }));
    toast(`Đã gửi lệnh tưới xuống DB · ${zoneLabel} · ${minutes} phút`);
    
    const label = $('span', irrigateBtn);
    irrigateBtn.disabled = true;
    let remaining = minutes * 60;
    
    const render = () => { label.textContent = `Đang tưới ${pad2(Math.floor(remaining / 60))}:${pad2(remaining % 60)}`; };
    render();
    
    irrigationTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(irrigationTimer);
        label.textContent = 'Kích hoạt tưới';
        irrigateBtn.disabled = false;
        toast(`Hoàn tất tưới · ${zoneLabel}`);
      } else {
        render();
      }
    }, 1000);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const minutes = Number(fDuration.value);
    if (fDuration.value.trim() === '' || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      durError.textContent = 'Nhập số phút nguyên từ 1 đến 60.';
      fDuration.setAttribute('aria-invalid', 'true');
      fDuration.focus();
      return;
    }
    const zoneSelect = $('#f-zone');
    startIrrigation({
      zone: zoneSelect.value,
      zoneLabel: zoneSelect.selectedOptions[0].textContent,
      minutes,
      note: fNote.value.trim(),
    });
    form.reset();
    $('#note-count').textContent = '0';
    closeDialog();
  });

  async function fetchRealKpis() {
    const { data, error } = await supabase
      .from('telemetry_logs')
      .select('temperature, humidity, soil_moisture, light_lux, co2_ppm')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return;

    // Cập nhật lên UI (bỏ qua hàm sinh số ngẫu nhiên cũ)
    setKpi('temp', data.temperature, 600);
    setKpi('hum', data.humidity, 600);
    setKpi('soil', data.soil_moisture, 600);
    setKpi('light', data.light_lux, 600);
    setKpi('co2', data.co2_ppm, 600);

    setTimeout(syncSensors, 620);
    $('#last-update').textContent = 'LAST ' + clockString(new Date());
  }

  /* ==========================================================
     Boot
     ========================================================== */
  function boot() {
    // Đếm số lên từ 0 khi tải trang
    for (const key of Object.keys(kpi)) {
      const k = kpi[key];
      k.el.textContent = k.fmt(0);
      tween(0, k.base, 1000, (v) => { k.el.textContent = k.fmt(v); });
    }
    setGauge(0);
    requestAnimationFrame(() => setGauge(kpi.hum.base));
    renderSparks(true);
    syncSensors();
    $('#last-update').textContent = 'LAST ' + clockString(new Date());
    drawChart();

    // Thay thế đoạn setInterval cũ:
    fetchRealKpis(); // Lấy dữ liệu lần đầu
    setInterval(() => {
      if (!document.hidden) fetchRealKpis(); 
    }, 5000); // Tự động kéo dữ liệu mỗi 5s
  }

  boot();
})();
