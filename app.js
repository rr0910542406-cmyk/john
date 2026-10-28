const STORAGE_KEY = 'pace-campus-logs';
const ACHIEVEMENTS_KEY = 'pace-campus-achievements';
const DAILY_GOAL_KEY = 'pace-campus-daily-goal';
const ACTIVE_WORKOUT_KEY = 'pace-campus-active-workout';
let workoutTimer = null;
let workoutSeconds = 0;
let workoutRunning = false;
let workoutActive = false;
let geolocationWatchId = null;
let routeLine = null;
let routePoints = [];
let gpsDistanceKm = 0;
let lastGpsSample = null;
let locationMessage = '';
let selectedRouteId = null;
let activeLogFilter = 'all';
let activeChartMetric = 'distance';
let activeHistoryPeriod = 'day';

const campusLandmarks = {
  library: { name: '圖書館步道', coords: [24.1805, 120.6468] },
  stadium: { name: '操場廣場', coords: [24.1787, 120.6499] },
  dormitory: { name: '宿舍步道', coords: [24.1773, 120.6438] },
  garden: { name: '校園花園', coords: [24.1818, 120.6445] }
};

const campusRoutes = {
  easy: {
    name: '綠蔭散步',
    color: '#3f8e62',
    targetDistance: 0.7,
    points: [[24.1794, 120.6464], [24.1805, 120.6468], [24.1812, 120.6462], [24.1808, 120.6449], [24.1798, 120.6448], [24.1794, 120.6464]]
  },
  steady: {
    name: '校園慢跑',
    color: '#d58a2a',
    targetDistance: 1.5,
    points: [[24.1794, 120.6464], [24.1812, 120.6478], [24.1818, 120.6452], [24.1802, 120.6437], [24.1782, 120.6444], [24.1776, 120.6471], [24.1794, 120.6464]]
  },
  challenge: {
    name: '長距離挑戰',
    color: '#c65345',
    targetDistance: 2.8,
    points: [[24.1794, 120.6464], [24.1822, 120.6482], [24.1831, 120.6448], [24.1814, 120.6428], [24.1784, 120.6421], [24.1764, 120.6442], [24.1762, 120.6481], [24.1781, 120.6502], [24.1794, 120.6464]]
  }
};

const workoutAchievements = [
  { id: 'first-minute', title: '邁出第一步', description: '運動滿 1 分鐘', target: 60, metric: 'time' },
  { id: 'five-minutes', title: '持續前進', description: '運動滿 5 分鐘', target: 300, metric: 'time' },
  { id: 'half-kilometer', title: '校園探索者', description: '累積距離達 0.5 公里', target: 0.5, metric: 'distance' },
  { id: 'twenty-minutes', title: '耐力挑戰', description: '運動滿 20 分鐘', target: 1200, metric: 'time' }
];

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const initCampusMap = () => {
  const mapEl = document.getElementById('campus-map');
  if (!mapEl) return;

  const fcCampus = [24.1794, 120.6464];
  const map = L.map('campus-map', {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: true
  }).setView(fcCampus, 16);

  const baseLayers = {
    map: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles © Esri'
    })
  };

  const campusMarker = L.marker(fcCampus).addTo(map);
  campusMarker.bindPopup('逢甲大學');

  const routeMarker = L.layerGroup().addTo(map);
  const landmarkGroup = L.layerGroup().addTo(map);
  let selectedRouteLine = null;
  let routeRequestId = 0;

  Object.entries(campusLandmarks).forEach(([key, value]) => {
    const marker = L.marker(value.coords).addTo(landmarkGroup);
    marker.bindPopup(value.name);
    marker.on('click', () => {
      const pointEl = document.getElementById('meeting-point');
      if (pointEl) pointEl.textContent = `${value.name}`;
    });
    marker._customKey = key;
  });

  routeLine = L.polyline([], { color: '#3f8e62', weight: 6, opacity: 0.9 }).addTo(map);

  baseLayers.map.addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map).addAttribution('© OpenStreetMap contributors');

  const updateMeetingPoint = (lat, lng, label = '校園集合點') => {
    const pointLabel = `${label}：${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const pointEl = document.getElementById('meeting-point');
    if (pointEl) pointEl.textContent = pointLabel;

    routeMarker.clearLayers();
    const newMarker = L.marker([lat, lng]).addTo(routeMarker);
    newMarker.bindPopup(pointLabel).openPopup();
    map.flyTo([lat, lng], 17, { duration: 0.8 });
  };

  map.on('click', (event) => {
    const { lat, lng } = event.latlng;
    updateMeetingPoint(lat, lng, '集合點');
  });

  document.querySelectorAll('.route-option').forEach((button) => {
    button.addEventListener('click', async () => {
      const route = campusRoutes[button.dataset.route];
      if (!route) return;
      if (workoutActive) return;

      const note = document.getElementById('route-note');
      const requestId = ++routeRequestId;
      const routeButtons = [...document.querySelectorAll('.route-option')];
      routeButtons.forEach((option) => { option.disabled = true; });
      if (note) note.textContent = `正在依道路與步道規劃「${route.name}」…`;
      if (selectedRouteLine) {
        map.removeLayer(selectedRouteLine);
        selectedRouteLine = null;
      }

      try {
        const waypoints = route.points.map(([lat, lng]) => `${lng},${lat}`).join(';');
        const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${waypoints}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('路線服務暫時無法使用。');
        const result = await response.json();
        const roadRoute = result.routes?.[0];
        const coordinates = roadRoute?.geometry?.coordinates;
        if (result.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2) {
          throw new Error('這些地點之間目前找不到步行道路。');
        }
        if (requestId !== routeRequestId) return;

        const roadPoints = coordinates.map(([lng, lat]) => [lat, lng]);
        selectedRouteId = button.dataset.route;
        route.targetDistance = roadRoute.distance / 1000;
        const activityLabel = document.getElementById('selected-activity');
        if (activityLabel) activityLabel.textContent = route.name;

        routeButtons.forEach((option) => {
          const selected = option === button;
          option.classList.toggle('selected', selected);
          option.setAttribute('aria-pressed', String(selected));
          const meta = option.querySelector('.route-option-meta');
          if (selected && meta) {
            const distanceKm = roadRoute.distance / 1000;
            const walkingMinutes = Math.round(roadRoute.duration / 60);
            meta.textContent = `沿道路與步道 · ${distanceKm.toFixed(1)} km · 約 ${walkingMinutes} 分鐘`;
          }
        });

        selectedRouteLine = L.polyline(roadPoints, {
          color: route.color,
          weight: 6,
          opacity: 0.9
        }).addTo(map);
        selectedRouteLine.bindPopup(`${route.name} · 沿道路與步道`);
        map.fitBounds(selectedRouteLine.getBounds(), { padding: [36, 36], maxZoom: 17 });
        if (note) note.textContent = `「${route.name}」已沿 OpenStreetMap 步行路網規劃，約 ${route.targetDistance.toFixed(1)} 公里。實際通行請留意現場標示與道路狀況。`;
      } catch (error) {
        if (requestId !== routeRequestId) return;
        if (note) note.textContent = `${error.message} 請檢查網路後重試；未載入時不會顯示穿越建物的直線路徑。`;
      } finally {
        if (requestId === routeRequestId && !workoutActive) {
          routeButtons.forEach((option) => { option.disabled = false; });
        }
      }
    });
  });

  document.querySelectorAll('.layer-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const layer = button.dataset.layer;
      document.querySelectorAll('.layer-btn').forEach((btn) => btn.classList.toggle('active', btn === button));

      if (layer === 'satellite') {
        map.removeLayer(baseLayers.map);
        if (!map.hasLayer(baseLayers.satellite)) {
          baseLayers.satellite.addTo(map);
        }
      } else {
        map.removeLayer(baseLayers.satellite);
        if (!map.hasLayer(baseLayers.map)) {
          baseLayers.map.addTo(map);
        }
      }
    });
  });

  const goToCampusButton = document.querySelector('.secondary.action-btn:nth-of-type(2)');
  if (goToCampusButton) {
    goToCampusButton.addEventListener('click', () => map.flyTo(fcCampus, 16, { duration: 1 }));
  }

  const myLocationButton = document.querySelector('.secondary.action-btn:nth-of-type(1)');
  if (myLocationButton) {
    myLocationButton.addEventListener('click', () => {
      if (!navigator.geolocation) {
        updateMeetingPoint(fcCampus[0], fcCampus[1], '定位未支援');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          updateMeetingPoint(latitude, longitude, '我的定位');
        },
        () => {
          updateMeetingPoint(fcCampus[0], fcCampus[1], '定位失敗，回到校園');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  document.querySelectorAll('.landmark-item').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.landmark;
      const location = campusLandmarks[key];
      if (!location) return;
      updateMeetingPoint(location.coords[0], location.coords[1], location.name);
      map.flyTo(location.coords, 17, { duration: 0.8 });
    });
  });

  window.__campusMap = { map, routeLine, updateMeetingPoint };
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatPace = (minutesPerKm) => {
  if (!Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return '0:00';

  const minutes = Math.floor(minutesPerKm);
  const seconds = Math.round((minutesPerKm - minutes) * 60);

  const normalizedSeconds = seconds === 60 ? 0 : seconds;
  const normalizedMinutes = seconds === 60 ? minutes + 1 : minutes;

  return `${String(normalizedMinutes)}:${String(normalizedSeconds).padStart(2, '0')}`;
};

const loadLogs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const saveLogs = (logs) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
};

const renderLogList = (filter = 'all') => {
  const list = document.getElementById('log-list');
  if (!list) return;
  activeLogFilter = filter;

  const filteredLogs = getFilteredWorkoutLogs();

  if (!filteredLogs.length) {
    list.innerHTML = '<div class="empty-state">此篩選條件沒有運動紀錄</div>';
    renderHistoryChart();
    return;
  }

  list.innerHTML = filteredLogs
    .map(
      (entry) => `
        <article class="log-item">
          <div class="log-meta">
            <strong>${entry.title}</strong>
            <span>${entry.date}</span>
            ${entry.routeName ? `<span>${entry.routeName}${entry.routeTargetKm ? ` · 目標 ${entry.routeTargetKm} km` : ''}</span>` : ''}
            <span>${entry.distance} km • ${entry.time}</span>
            ${entry.pace ? `<span>平均配速 ${entry.pace} /km</span>` : ''}
          </div>
          <span class="log-badge">${entry.type === 'gps' ? 'GPS' : entry.type === 'estimated' ? '估算' : '示範'}</span>
        </article>
      `
    )
    .join('');
  renderHistoryChart();
};

const getFilteredWorkoutLogs = () => {
  const startDate = document.getElementById('history-start')?.value || '';
  const endDate = document.getElementById('history-end')?.value || '';
  return loadLogs().filter((entry) => {
    const matchesType = activeLogFilter === 'all' || entry.type === activeLogFilter;
    const date = String(entry.date || '');
    return matchesType && (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });
};

const parseWorkoutTimeMinutes = (value) => {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] + parts[1] / 60;
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1] + parts[2] / 60;
  return 0;
};

const renderHistoryChart = () => {
  const canvas = document.getElementById('history-chart');
  const emptyMessage = document.getElementById('history-chart-empty');
  const summary = document.getElementById('history-chart-summary');
  const accessibleSummary = document.getElementById('history-chart-accessible');
  if (!canvas || !emptyMessage || !summary || !accessibleSummary) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const logs = getFilteredWorkoutLogs();
  const groupedTotals = new Map();
  logs.forEach((entry) => {
    const date = String(entry.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const dateParts = date.split('-').map(Number);
    const utcDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
    let key = date;
    let label = date.slice(5).replace('-', '/');
    if (activeHistoryPeriod === 'week') {
      const weekday = (utcDate.getUTCDay() + 6) % 7;
      utcDate.setUTCDate(utcDate.getUTCDate() - weekday);
      key = utcDate.toISOString().slice(0, 10);
      label = `${key.slice(5).replace('-', '/')} 週`;
    } else if (activeHistoryPeriod === 'month') {
      key = date.slice(0, 7);
      label = key.replace('-', '/');
    }
    const total = groupedTotals.get(key) || { distance: 0, time: 0, count: 0, label };
    total.distance += Number.parseFloat(entry.distance) || 0;
    total.time += parseWorkoutTimeMinutes(entry.time);
    total.count += 1;
    groupedTotals.set(key, total);
  });

  const groups = [...groupedTotals.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .slice(activeHistoryPeriod === 'day' ? -7 : activeHistoryPeriod === 'week' ? -8 : -6)
    .map(([key, totals]) => ({
      key,
      label: totals.label,
      value: activeChartMetric === 'pace'
        ? totals.distance > 0 ? totals.time / totals.distance : 0
        : totals[activeChartMetric]
    }));

  const totalDistance = logs.reduce((total, entry) => total + (Number.parseFloat(entry.distance) || 0), 0);
  const totalMinutes = logs.reduce((total, entry) => total + parseWorkoutTimeMinutes(entry.time), 0);
  const countElement = document.getElementById('history-count');
  const distanceElement = document.getElementById('history-distance');
  const timeElement = document.getElementById('history-time');
  const paceElement = document.getElementById('history-pace');
  if (countElement) countElement.textContent = String(logs.length);
  if (distanceElement) distanceElement.textContent = `${totalDistance.toFixed(1)} km`;
  if (timeElement) timeElement.textContent = `${totalMinutes.toFixed(0)} 分`;
  if (paceElement) paceElement.textContent = totalDistance > 0 ? `${formatPace(totalMinutes / totalDistance)} /km` : '--';

  const width = Math.max(canvas.clientWidth, 280);
  const height = 220;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  if (!groups.length) {
    canvas.hidden = true;
    emptyMessage.hidden = false;
    summary.textContent = '尚無可顯示的運動紀錄';
    canvas.setAttribute('aria-label', '目前沒有可顯示的運動紀錄');
    accessibleSummary.textContent = summary.textContent;
    return;
  }

  canvas.hidden = false;
  emptyMessage.hidden = true;
  const periodLabel = activeHistoryPeriod === 'day' ? '天' : activeHistoryPeriod === 'week' ? '週' : '個月';
  summary.textContent = `最近 ${groups.length} ${periodLabel} · ${logs.length} 筆紀錄`;

  const padding = { top: 18, right: 16, bottom: 36, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...groups.map((group) => group.value), activeChartMetric === 'pace' ? 10 : 1);
  const step = chartWidth / groups.length;
  const barWidth = Math.min(34, step * 0.56);

  context.font = '12px "Noto Sans TC", sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  context.fillStyle = '#5f7a68';
  context.strokeStyle = 'rgba(24, 54, 41, 0.12)';
  context.lineWidth = 1;

  for (let tick = 0; tick <= 3; tick += 1) {
    const y = padding.top + chartHeight * (tick / 3);
    const labelValue = activeChartMetric === 'pace' ? maxValue * (tick / 3) : maxValue * (1 - tick / 3);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(activeChartMetric === 'pace' ? formatPace(labelValue) : labelValue.toFixed(activeChartMetric === 'time' ? 0 : 1), padding.left - 8, y);
  }

  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.fillStyle = '#5f7a68';
  const points = groups.map((group, index) => {
    const x = padding.left + step * index + step / 2;
    const chartValue = activeChartMetric === 'pace' ? maxValue - group.value : group.value;
    const barHeight = chartValue > 0 ? (chartValue / maxValue) * chartHeight : 0;
    const y = padding.top + chartHeight - barHeight;
    return { x, y, group };
  });

  if (activeChartMetric === 'pace') {
    context.strokeStyle = '#d58a2a';
    context.fillStyle = '#d58a2a';
    context.lineWidth = 3;
    context.beginPath();
    points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
    context.stroke();
    points.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 4, 0, Math.PI * 2);
      context.fill();
    });
  } else {
    points.forEach((point) => {
      context.fillStyle = '#3f8e62';
      context.beginPath();
      context.roundRect(point.x - barWidth / 2, point.y, barWidth, Math.max(padding.top + chartHeight - point.y, 2), 4);
      context.fill();
    });
  }

  context.fillStyle = '#5f7a68';
  points.forEach((point) => context.fillText(point.group.label, point.x, height - padding.bottom + 10));

  const unitLabel = activeChartMetric === 'distance' ? '公里' : activeChartMetric === 'time' ? '分鐘' : '分/公里';
  const chartDescription = groups.map((group) => `${group.label} ${activeChartMetric === 'pace' ? formatPace(group.value) : group.value.toFixed(1)} ${unitLabel}`).join('；');
  const metricLabel = activeChartMetric === 'distance' ? '距離' : activeChartMetric === 'time' ? '時間' : '平均配速';
  canvas.setAttribute('aria-label', `運動${metricLabel}趨勢圖：${chartDescription}`);
  accessibleSummary.textContent = `圖表數據：${chartDescription}`;
};

const renderReviewList = () => {
  const target = document.getElementById('review-list');
  if (!target) return;

  const logs = loadLogs();
  if (!logs.length) {
    target.innerHTML = '<p class="empty-message">尚未匯入任何紀錄。</p>';
    return;
  }

  target.innerHTML = logs
    .map(
      (entry) => `
        <div class="review-item">
          <div>
            <strong>${entry.title}</strong>
            <span>${entry.date}</span>
          </div>
          <div>
            <span>${entry.distance} km</span>
          </div>
        </div>
      `
    )
    .join('');
};

const seedDemoLogs = () => {
  const demoLogs = [
    {
      title: '校園步道舒適跑',
      date: '2026-10-21',
      distance: '2.4',
      time: '00:18',
      type: 'gps'
    },
    {
      title: '晨間散步',
      date: '2026-10-18',
      distance: '1.8',
      time: '00:15',
      type: 'demo'
    }
  ];
  saveLogs(demoLogs);
  renderLogList();
  renderReviewList();
};

const updateStats = () => {
  const distanceValue = document.getElementById('distance-value');
  const timeValue = document.getElementById('time-value');
  const currentPaceValue = document.getElementById('current-pace-value');
  const calorieValue = document.getElementById('calorie-value');
  const gpsCount = document.getElementById('gps-count');
  const status = document.getElementById('session-status');
  if (!distanceValue || !timeValue || !currentPaceValue || !calorieValue || !gpsCount || !status) return;

  const elapsed = workoutSeconds;
  const currentDistance = routePoints.length > 1 ? gpsDistanceKm : elapsed / 3600 * 0.9;
  const averagePace = elapsed > 0 && currentDistance > 0 ? formatPace(elapsed / 60 / currentDistance) : '0:00';
  const calories = Math.round(currentDistance * 75);

  distanceValue.textContent = currentDistance.toFixed(2);
  timeValue.textContent = formatTime(elapsed);
  currentPaceValue.textContent = averagePace;
  calorieValue.textContent = String(calories);
  gpsCount.textContent = `${routePoints.length} 個有效點`;

  if (status) {
    status.textContent = workoutRunning
      ? locationMessage || '運動記錄中，等待 GPS 定位。'
      : workoutActive
        ? '運動已暫停，可繼續或完成儲存。'
        : locationMessage || '定位已開啟，準備記錄你的第一步。';
    status.classList.toggle('online', workoutRunning);
  }

  updateWorkoutAchievements(elapsed, currentDistance);
  updateDailyGoal(workoutActive ? elapsed : 0);
  if (workoutActive) {
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({
      seconds: workoutSeconds,
      routeId: selectedRouteId,
      points: routePoints,
      gpsDistanceKm
    }));
  }
};

const updateDailyGoal = (currentWorkoutSeconds = 0) => {
  const select = document.getElementById('daily-goal-select');
  const progress = document.querySelector('.daily-goal-progress');
  const summary = document.getElementById('daily-goal-summary');
  if (!select || !progress || !summary) return;

  const savedGoal = Number(localStorage.getItem(DAILY_GOAL_KEY));
  const goalMinutes = [20, 30, 45].includes(savedGoal) ? savedGoal : 30;
  select.value = String(goalMinutes);
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const completedSeconds = loadLogs()
    .filter((entry) => entry.date === todayString)
    .reduce((total, entry) => total + parseWorkoutTimeMinutes(entry.time) * 60, 0);
  const totalMinutes = (completedSeconds + currentWorkoutSeconds) / 60;
  const percent = Math.min(100, Math.round((totalMinutes / goalMinutes) * 100));
  progress.setAttribute('aria-valuenow', String(percent));
  progress.querySelector('span').style.width = `${percent}%`;
  summary.textContent = `今日 ${Math.min(totalMinutes, goalMinutes).toFixed(0)} / ${goalMinutes} 分鐘${percent >= 100 ? ' · 已達標' : ''}`;
};

const updateWorkoutAchievements = (elapsedSeconds, distanceKm) => {
  const list = document.getElementById('achievement-list');
  if (!list) return;

  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayLogs = loadLogs().filter((entry) => entry.date === todayString);
  const loggedSeconds = todayLogs.reduce((total, entry) => total + parseWorkoutTimeMinutes(entry.time) * 60, 0);
  const loggedDistance = todayLogs.reduce((total, entry) => total + (Number.parseFloat(entry.distance) || 0), 0);
  const completedSeconds = loggedSeconds + (workoutActive ? elapsedSeconds : 0);
  const completedDistance = loggedDistance + (workoutActive ? distanceKm : 0);
  let unlockedByDate = {};
  try {
    unlockedByDate = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) || '{}');
  } catch {
    unlockedByDate = {};
  }
  const unlockedToday = new Set(Array.isArray(unlockedByDate[todayString]) ? unlockedByDate[todayString] : []);

  list.innerHTML = workoutAchievements.map((achievement) => {
    const current = achievement.metric === 'time' ? completedSeconds : completedDistance;
    const progress = Math.min(100, Math.round((current / achievement.target) * 100));
    if (current >= achievement.target) unlockedToday.add(achievement.id);
    const unlocked = unlockedToday.has(achievement.id);

    return `
      <article class="achievement-item${unlocked ? ' is-unlocked' : ''}">
        <div class="achievement-copy">
          <strong>${achievement.title}</strong>
          <span>${unlocked ? '已達成' : achievement.description}</span>
        </div>
        <div class="achievement-progress" role="progressbar" aria-label="${achievement.title}" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
          <span style="width: ${progress}%"></span>
        </div>
      </article>
    `;
  }).join('');

  unlockedByDate[todayString] = [...unlockedToday];
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlockedByDate));
};

const startWorkoutTimer = () => {
  if (workoutRunning) return;

  if (!workoutActive) {
    workoutSeconds = 0;
    gpsDistanceKm = 0;
    routePoints = [];
    lastGpsSample = null;
    locationMessage = '';
    if (window.__campusMap?.routeLine) window.__campusMap.routeLine.setLatLngs([]);
  }

  workoutActive = true;
  workoutRunning = true;
  updateStats();

  workoutTimer = setInterval(() => {
    if (!workoutRunning) return;
    workoutSeconds += 1;
    updateStats();
  }, 1000);

  if (!navigator.geolocation) {
    locationMessage = '此裝置不支援 GPS，距離將以時間估算。';
    updateStats();
    return;
  }

  if (!window.__campusMap) {
    return;
  }

  lastGpsSample = null;
  geolocationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const accuracy = position.coords.accuracy;
      const now = position.timestamp || Date.now();
      if (!Number.isFinite(accuracy) || accuracy > 35) {
        locationMessage = 'GPS 精度不足，已忽略此定位點。';
        updateStats();
        return;
      }

      const point = { lat: latitude, lng: longitude };
      if (lastGpsSample) {
        const elapsedSeconds = Math.max((now - lastGpsSample.timestamp) / 1000, 1);
        const rawDistanceKm = haversineDistance(lastGpsSample.lat, lastGpsSample.lng, latitude, longitude);
        const uncertaintyKm = (lastGpsSample.accuracy + accuracy) / 2000;
        const segmentDistanceKm = Math.max(0, rawDistanceKm - uncertaintyKm);
        const segmentSpeedKmh = segmentDistanceKm / (elapsedSeconds / 3600);
        if (segmentSpeedKmh > 25) {
          lastGpsSample = { ...point, accuracy, timestamp: now };
          locationMessage = '已排除異常 GPS 位移，正在重新校正。';
          updateStats();
          return;
        }
        if (segmentDistanceKm < 0.005) {
          lastGpsSample = { ...point, accuracy, timestamp: now };
          locationMessage = 'GPS 定位正常，等待有效移動。';
          updateStats();
          return;
        }
        gpsDistanceKm += segmentDistanceKm;
      }

      lastGpsSample = { ...point, accuracy, timestamp: now };
      routePoints.push(point);
      locationMessage = `GPS 定位中，精度約 ${Math.round(accuracy)} 公尺。`;
      if (routePoints.length > 1 && window.__campusMap?.routeLine) {
        const latlngs = routePoints.map((item) => [item.lat, item.lng]);
        window.__campusMap.routeLine.setLatLngs(latlngs);
      }
      updateStats();
    },
    (error) => {
      locationMessage = error.code === 1
        ? '定位權限未開啟，距離將以時間估算。'
        : error.code === 3
          ? 'GPS 定位逾時，仍可繼續運動。'
          : 'GPS 暫時無法使用，距離將以時間估算。';
      updateStats();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
  );
};

const stopWorkoutTimer = () => {
  workoutRunning = false;
  if (workoutTimer) {
    clearInterval(workoutTimer);
    workoutTimer = null;
  }
  if (geolocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(geolocationWatchId);
    geolocationWatchId = null;
  }
  updateStats();
};

const finishWorkout = () => {
  if (!workoutActive) return;
  stopWorkoutTimer();

  if (workoutSeconds < 1) {
    const status = document.getElementById('session-status');
    if (status) status.textContent = '運動時間太短，尚未建立紀錄。';
    return;
  }

  const distanceKm = routePoints.length > 1 ? gpsDistanceKm : workoutSeconds / 3600 * 0.9;
  const route = selectedRouteId ? campusRoutes[selectedRouteId] : null;
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const log = {
    title: route?.name || '自由運動',
    routeName: route?.name || '',
    routeTargetKm: route?.targetDistance || '',
    date: localDate,
    distance: distanceKm.toFixed(2),
    time: formatTime(workoutSeconds),
    type: routePoints.length > 1 ? 'gps' : 'estimated',
    pace: distanceKm > 0 ? formatPace(workoutSeconds / 60 / distanceKm) : '0:00'
  };

  saveLogs([log, ...loadLogs()]);
  localStorage.removeItem(ACTIVE_WORKOUT_KEY);
  workoutActive = false;
  locationMessage = '運動完成，紀錄已儲存。';
  const startButton = document.getElementById('start-btn');
  if (startButton) startButton.innerHTML = '<span>開始新運動</span>';
  const finishButton = document.getElementById('finish-btn');
  if (finishButton) finishButton.hidden = true;
  document.querySelectorAll('.route-option').forEach((option) => { option.disabled = false; });
  renderLogList(activeLogFilter);
  renderReviewList();
  updateStats();
  const status = document.getElementById('session-status');
  if (status) status.textContent = `運動完成，${log.distance} 公里紀錄已儲存。`;
};

const restoreActiveWorkout = () => {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(ACTIVE_WORKOUT_KEY) || 'null');
  } catch {
    localStorage.removeItem(ACTIVE_WORKOUT_KEY);
    return;
  }
  if (!draft || !Number.isFinite(draft.seconds) || draft.seconds < 1) return;

  workoutSeconds = draft.seconds;
  workoutActive = true;
  workoutRunning = false;
  selectedRouteId = campusRoutes[draft.routeId] ? draft.routeId : null;
  routePoints = Array.isArray(draft.points) ? draft.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)) : [];
  gpsDistanceKm = Number.isFinite(draft.gpsDistanceKm) ? draft.gpsDistanceKm : 0;

  const finishButton = document.getElementById('finish-btn');
  const startButton = document.getElementById('start-btn');
  if (finishButton) finishButton.hidden = false;
  if (startButton) startButton.innerHTML = '<span>繼續運動</span>';
  document.querySelectorAll('.route-option').forEach((button) => {
    const selected = button.dataset.route === selectedRouteId;
    button.disabled = true;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const activityLabel = document.getElementById('selected-activity');
  if (activityLabel) activityLabel.textContent = selectedRouteId ? campusRoutes[selectedRouteId].name : '自由運動';
  if (routePoints.length > 1 && window.__campusMap?.routeLine) {
    window.__campusMap.routeLine.setLatLngs(routePoints.map((point) => [point.lat, point.lng]));
  }
  locationMessage = '已還原未完成的運動，可繼續記錄或完成儲存。';
  updateStats();
};

const bindControls = () => {
  const startButton = document.getElementById('start-btn');
  const finishButton = document.getElementById('finish-btn');
  const clearButton = document.getElementById('clear-btn');
  const exportButton = document.getElementById('export-btn');
  const filterButtons = document.querySelectorAll('.filter-btn');
  const chartButtons = document.querySelectorAll('.chart-switch-btn');
  const periodButtons = document.querySelectorAll('.period-switch-btn');
  const dailyGoalSelect = document.getElementById('daily-goal-select');
  const historyDateInputs = [document.getElementById('history-start'), document.getElementById('history-end')].filter(Boolean);

  if (startButton) {
    startButton.addEventListener('click', () => {
      const status = document.getElementById('session-status');
      if (!workoutRunning) {
        if (!workoutActive) {
          if (finishButton) finishButton.hidden = false;
          document.querySelectorAll('.route-option').forEach((option) => { option.disabled = true; });
        }
        startButton.innerHTML = '<span>暫停運動</span>';
        startWorkoutTimer();
      } else {
        startButton.innerHTML = '<span>繼續運動</span>';
        stopWorkoutTimer();
      }
    });
  }

  if (finishButton) finishButton.addEventListener('click', finishWorkout);

  if (dailyGoalSelect) {
    const savedGoal = localStorage.getItem(DAILY_GOAL_KEY);
    if (savedGoal) dailyGoalSelect.value = savedGoal;
    dailyGoalSelect.addEventListener('change', () => {
      localStorage.setItem(DAILY_GOAL_KEY, dailyGoalSelect.value);
      updateDailyGoal(workoutActive ? workoutSeconds : 0);
    });
  }

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ACTIVE_WORKOUT_KEY);
      renderLogList();
      renderReviewList();
      workoutSeconds = 0;
      workoutRunning = false;
      workoutActive = false;
      routePoints = [];
      gpsDistanceKm = 0;
      lastGpsSample = null;
      locationMessage = '';
      selectedRouteId = null;
      if (window.__campusMap?.routeLine) {
        window.__campusMap.routeLine.setLatLngs([]);
      }
      if (startButton) {
        startButton.innerHTML = '<span>開始運動</span>';
      }
      if (finishButton) finishButton.hidden = true;
      document.querySelectorAll('.route-option').forEach((option) => {
        option.disabled = false;
        option.classList.remove('selected');
        option.setAttribute('aria-pressed', 'false');
      });
      const activityLabel = document.getElementById('selected-activity');
      if (activityLabel) activityLabel.textContent = '自由運動';
      stopWorkoutTimer();
      const status = document.getElementById('session-status');
      if (status) {
        status.textContent = '已清除所有紀錄，準備開始新的一次。';
        status.classList.remove('online');
      }
      updateStats();
    });
  }

  if (exportButton) {
    exportButton.addEventListener('click', () => {
      const logs = loadLogs();
      if (!logs.length) {
        alert('目前沒有可匯出的紀錄。');
        return;
      }

      const csv = [
        ['title,date,distance,time,type,routeName,routeTargetKm,pace'],
        ...logs.map((entry) => [entry.title, entry.date, entry.distance, entry.time, entry.type, entry.routeName || '', entry.routeTargetKm || '', entry.pace || ''].join(','))
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pace-campus-logs.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      filterButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
      renderLogList(button.dataset.filter || 'all');
    });
  });

  historyDateInputs.forEach((input) => input.addEventListener('change', () => renderLogList(activeLogFilter)));

  periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeHistoryPeriod = ['day', 'week', 'month'].includes(button.dataset.period) ? button.dataset.period : 'day';
      periodButtons.forEach((periodButton) => {
        const selected = periodButton === button;
        periodButton.classList.toggle('active', selected);
        periodButton.setAttribute('aria-pressed', String(selected));
      });
      renderHistoryChart();
    });
  });

  chartButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeChartMetric = ['distance', 'time', 'pace'].includes(button.dataset.metric) ? button.dataset.metric : 'distance';
      chartButtons.forEach((chartButton) => {
        const selected = chartButton === button;
        chartButton.classList.toggle('active', selected);
        chartButton.setAttribute('aria-pressed', String(selected));
      });
      renderHistoryChart();
    });
  });

  window.addEventListener('resize', renderHistoryChart);

  const csvUpload = document.getElementById('csv-upload');
  if (csvUpload) {
    csvUpload.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const rows = text.split(/\r?\n/).filter(Boolean);
        if (rows.length < 2) return;

        const logged = rows.slice(1).map((row, index) => {
          const [title, date, distance, time, type = 'gps', routeName = '', routeTargetKm = '', pace = ''] = row.split(',');
          return {
            title: title || `匯入紀錄 ${index + 1}`,
            date: date || new Date().toISOString().slice(0, 10),
            distance: distance || '0.0',
            time: time || '00:00',
            type: type.trim() || 'gps',
            routeName,
            routeTargetKm,
            pace
          };
        });

        const merged = [...loadLogs(), ...logged];
        saveLogs(merged);
        renderLogList();
        renderReviewList();
      };
      reader.readAsText(file);
    });
  }

  const demoImport = document.getElementById('demo-import');
  if (demoImport) {
    demoImport.addEventListener('click', () => {
      seedDemoLogs();
    });
  }
};

window.addEventListener('DOMContentLoaded', () => {
  initCampusMap();
  renderLogList();
  renderReviewList();
  bindControls();
  restoreActiveWorkout();
  updateStats();
});
