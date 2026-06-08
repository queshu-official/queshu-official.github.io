
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const ORDINALS = ['一', '二', '三', '四', '五'];
const UPCOMING_EVENT_HOUR_RANGE = 1;

const SPECIAL_FLAGS = {
    forceEveryDay: 1 << 0,
    forceEveryWeek: 1 << 1,
    hideEndTime: 1 << 2
};

const JOIN_METHOD_LABELS = {
    0: 'その他',
    1: 'Public',
    2: 'GroupPublic',
    3: 'Group+',
    4: 'GroupOnly',
    5: 'Friend+',
    6: 'FriendOnly',
    7: 'Invite',
    8: 'グループ(種別未確認)',
    9: 'フレンド(種別未確認)'
};

const GROUP_JOIN_METHODS = new Set([2, 3, 4, 8]);
const FRIEND_JOIN_METHODS = new Set([5, 6, 9]);
const GROUP_INSTANCE_NOTICE = "下記リンクよりグループに参加して入場！";
const FRIEND_INSTANCE_NOTICE = "主催者にフレンドリクエストを送信して入場！";
const OTHER_INSTANCE_NOTICE = "詳細は下記備考欄を参照！";

let allEvents = [];
let currentView = 'daily';
let onlyIos = false;
let allowIosToggle = true;
let searchQuery = '';
let selectedEventIdx = -1;
let updateAt = '';

function getJSTNow() {
    return new Date(Date.now() + 9 * 3600 * 1000);
}

function timeToMinutes(t) {
    return Math.floor(t / 100) * 60 + (t % 100);
}

function formatTime(t) {
    const h = Math.floor(t / 100);
    const m = t % 100;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function hasSpecialFlag(event, flag) {
    return ((event.specialFlag || 0) & flag) !== 0;
}

function parseDateInMonth(dateInMonth) {
    if (dateInMonth === '' || dateInMonth == null) return [];
    return String(dateInMonth)
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !Number.isNaN(n) && n >= 1 && n <= 31);
}

function formatTimeRange(event) {
    const start = formatTime(event.startTime);
    if (hasSpecialFlag(event, SPECIAL_FLAGS.hideEndTime)) return start + '〜';
    return start + '〜' + formatTime(event.endTime);
}

function isCrossMidnight(event) {
    return timeToMinutes(event.endTime) < timeToMinutes(event.startTime);
}

function getNowWeek(date) {
    return date.getUTCDay();
}

function isInCurrentWeek(date, dayOfWeek, biweekly, event) {
    if (hasSpecialFlag(event, SPECIAL_FLAGS.forceEveryWeek) || !biweekly) return true;
    if (!hasDayBit(dayOfWeek, getNowWeek(date))) return false;
    const weekOfMonth = Math.floor((date.getUTCDate() - 1) / 7) + 1;
    if (weekOfMonth < 1 || weekOfMonth > 5) return false;
    const weekMask = 1 << (weekOfMonth - 1);
    return (biweekly & weekMask) !== 0;
}

function hasDayBit(dayOfWeek, jsDay) {
    return (dayOfWeek & (1 << jsDay)) !== 0;
}

function matchesPlatform(event) {
    if (!allowIosToggle) return true;
    if (!onlyIos) return true;
    return (event.platform & 2) !== 0;
}

function matchesSearch(event) {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return String(event.eventName || '').toLowerCase().includes(q) ||
        String(event.organizer || '').toLowerCase().includes(q);
}

function getDayLabel(event) {
    const dayOfWeek = event.dayOfWeek;
    if (hasSpecialFlag(event, SPECIAL_FLAGS.forceEveryDay) || dayOfWeek === 127 || dayOfWeek === 0) return '毎日';
    const days = [];
    for (let i = 0; i < 7; i++) {
        if (dayOfWeek & (1 << i)) days.push(DAY_NAMES[i]);
    }
    return days.join(',') + (days.length ? '曜日' : '');
}

function getBiweeklyLabel(event) {
    if (hasSpecialFlag(event, SPECIAL_FLAGS.forceEveryWeek) || !event.biweekly) return '毎週';
    const weeks = [];
    for (let i = 0; i < 5; i++) {
        if (event.biweekly & (1 << i)) weeks.push('第' + ORDINALS[i]);
    }
    return weeks.join(',');
}

function getScheduleLabel(event) {
    const dateInMonths = event._parsedDateInMonths || [];
    if (event.dateInMonth) {
        return dateInMonths.length ? '毎月' + String(event.dateInMonth) + '日' : String(event.dateInMonth);
    }

    const dayLabel = getDayLabel(event);
    const isEveryDay = dayLabel === '毎日';
    if (isEveryDay) return dayLabel;
    return getBiweeklyLabel(event) + dayLabel;
}

function getFilteredEventsByDate(targetDate) {
    const result = [];
    const day = targetDate.getUTCDate();
    const week = getNowWeek(targetDate);

    for (const event of allEvents) {
        if (!matchesPlatform(event)) continue;
        if (!matchesSearch(event)) continue;

        const hasDateInMonth = event._parsedDateInMonths && event._parsedDateInMonths.length > 0;

        if (hasDateInMonth) {
            if (!event._parsedDateInMonths.includes(day)) continue;
        } else {
            if (!hasDayBit(event.dayOfWeek, week)) continue;
            if (!isInCurrentWeek(targetDate, event.dayOfWeek, event.biweekly, event)) continue;
        }

        result.push(event);
    }

    return result;
}

function getStartedEvents(now) {
    const result = [];
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
    const todayDay = now.getUTCDate();
    const yesterdayDay = yesterday.getUTCDate();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const todayWeek = getNowWeek(now);
    const yesterdayWeek = getNowWeek(yesterday);

    for (const event of allEvents) {
        if (!matchesPlatform(event)) continue;
        if (!matchesSearch(event)) continue;

        const parsedDays = event._parsedDateInMonths || [];
        const hasDateInMonth = parsedDays.length > 0;
        const eventStart = timeToMinutes(event.startTime);
        const eventEnd = timeToMinutes(event.endTime);
        const crossesMidnight = eventEnd < eventStart;

        let matchToday = false;
        if (hasDateInMonth) {
            matchToday = parsedDays.includes(todayDay);
        } else {
            matchToday = hasDayBit(event.dayOfWeek, todayWeek) && isInCurrentWeek(now, event.dayOfWeek, event.biweekly, event);
        }

        if (matchToday) {
            if (crossesMidnight) {
                if (nowMinutes >= eventStart) {
                    result.push(event);
                    continue;
                }
            } else if (nowMinutes >= eventStart && nowMinutes <= eventEnd) {
                result.push(event);
                continue;
            }
        }

        if (crossesMidnight) {
            let matchYesterday = false;
            if (hasDateInMonth) {
                matchYesterday = parsedDays.includes(yesterdayDay);
            } else {
                matchYesterday = hasDayBit(event.dayOfWeek, yesterdayWeek) && isInCurrentWeek(yesterday, event.dayOfWeek, event.biweekly, event);
            }

            if (matchYesterday && nowMinutes <= eventEnd) {
                result.push(event);
                continue;
            }
        }
    }

    return result;
}

function getDailyEvents(now) {
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const nowTime = nowMinutes;
    const todayEvents = getFilteredEventsByDate(now);
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
    const tomorrowEvents = getFilteredEventsByDate(tomorrow);
    const startedIds = new Set(getStartedEvents(now).map(event => event._idx));
    const result = { now: [], upcoming: [], today: [], tomorrow: [] };
    const upcomingThresholdMinutes = UPCOMING_EVENT_HOUR_RANGE * 60;

    for (const event of allEvents) {
        if (startedIds.has(event._idx)) result.now.push(event);
    }

    for (const event of todayEvents) {
        if (startedIds.has(event._idx)) continue;
        const eventStart = timeToMinutes(event.startTime);
        if (nowTime > eventStart) continue;
        const diff = eventStart - nowTime;
        if (diff <= upcomingThresholdMinutes) result.upcoming.push(event);
        else result.today.push(event);
    }

    for (const event of tomorrowEvents) {
        const eventStart = timeToMinutes(event.startTime) + 24 * 60;
        const diff = eventStart - nowTime;
        if (diff <= upcomingThresholdMinutes) result.upcoming.push(event);
        else result.tomorrow.push(event);
    }

    const sortFn = (a, b) => a.startTime - b.startTime || a.eventName.localeCompare(b.eventName, 'ja');
    result.now.sort(sortFn);
    result.upcoming.sort(sortFn);
    result.today.sort(sortFn);
    result.tomorrow.sort(sortFn);
    return result;
}

function getEventsByDayOfWeek(jsDay) {
    return allEvents.filter(event => {
        if (!matchesPlatform(event)) return false;
        if (!matchesSearch(event)) return false;
        if (jsDay !== 'none') return hasDayBit(event.dayOfWeek, jsDay);
        return event.dayOfWeek === 0;
    }).sort((a, b) => a.startTime - b.startTime || a.eventName.localeCompare(b.eventName, 'ja'));
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function platformBadgesHtml(platform) {
    const parts = [];
    if (platform & 1) parts.push('<span class="platform-badge android">A</span>');
    if (platform & 2) parts.push('<span class="platform-badge ios">i</span>');
    return parts.length ? '<span class="platform-badges">' + parts.join('') + '</span>' : '';
}

function renderEventItem(event) {
    const isSelected = event._idx === selectedEventIdx ? ' selected' : '';
    const schedule = getScheduleLabel(event);

    return '<div class="event-item' + isSelected + '" role="listitem" data-idx="' + event._idx + '">' +
        '<div class="event-time">' + esc(formatTimeRange(event)) + '</div>' +
        '<div class="event-info">' +
        '<div class="event-name">' + esc(event.eventName) + '</div>' +
        '<div class="event-meta">' +
        (schedule ? '<span class="event-schedule">' + esc(schedule) + '</span>' : '') +
        (event.organizer ? '<span>' + esc(event.organizer) + '</span>' : '') +
        platformBadgesHtml(event.platform) +
        '</div>' +
        '</div>' +
        '</div>';
}

function renderSectionHeader(text, cls) {
    return '<div class="section-header ' + cls + '">' + esc(text) + '</div>';
}

function renderDailyView(grouped) {
    let html = '';
    if (grouped.now.length) {
        html += renderSectionHeader('● 開催中', 'now');
        grouped.now.forEach(e => { html += renderEventItem(e); });
    }
    if (grouped.upcoming.length) {
        html += renderSectionHeader('◎ これから', 'upcoming');
        grouped.upcoming.forEach(e => { html += renderEventItem(e); });
    }
    if (grouped.today.length) {
        html += renderSectionHeader('○ 今日', 'today');
        grouped.today.forEach(e => { html += renderEventItem(e); });
    }
    if (grouped.tomorrow.length) {
        html += renderSectionHeader('◇ 明日', 'tomorrow');
        grouped.tomorrow.forEach(e => { html += renderEventItem(e); });
    }
    return html || '<div class="empty-state">本日のイベントはありません</div>';
}

function renderDayView(jsDay) {
    const events = getEventsByDayOfWeek(jsDay);
    if (!events.length) return '<div class="empty-state">' + DAY_NAMES[jsDay] + '曜日のイベントはありません</div>';
    return events.map(renderEventItem).join('');
}

function renderNoneView() {
    const events = getEventsByDayOfWeek('none');
    if (!events.length) return '<div class="empty-state">その他のイベントはありません</div>';
    return events.map(renderEventItem).join('');
}

function renderDetail(event) {
    const emptyEl = document.getElementById('detailEmpty');
    const contentEl = document.getElementById('detailContent');

    if (!event) {
        emptyEl.removeAttribute('hidden');
        contentEl.setAttribute('hidden', '');
        return;
    }

    emptyEl.setAttribute('hidden', '');
    contentEl.removeAttribute('hidden');

    const joinLabel = JOIN_METHOD_LABELS[event.joinMethod] || ('方式 ' + event.joinMethod);
    const isGroupType = GROUP_JOIN_METHODS.has(event.joinMethod);
    const isFriendType = FRIEND_JOIN_METHODS.has(event.joinMethod);
    const hasInfoOrNote = event.information || event.note;
    const crossMid = isCrossMidnight(event);
    const platformNames = [];
    if (event.platform & 1) platformNames.push('Android');
    if (event.platform & 2) platformNames.push('iOS');

    let html = '<div class="detail-event-name">' + esc(event.eventName) + '</div>';
    if (event.organizer) html += detailRow('主催者', esc(event.organizer));

    let timeVal = esc(formatTimeRange(event));
    if (crossMid) timeVal += '<span class="cross-midnight-note">（日付跨ぎ）</span>';
    html += detailRow('時間', timeVal);
    html += detailRow('開催日', esc(getScheduleLabel(event)));
    html += detailRow('対応機種', esc(platformNames.join(' / ')));
    html += detailRow('参加方法', esc(joinLabel));

    if (isGroupType && event.groupId) {
        html += '<div class="detail-notice"> ' + esc(GROUP_INSTANCE_NOTICE) + '</div>';
    }
    else if (isFriendType) {
        html += '<div class="detail-notice"> ' + esc(FRIEND_INSTANCE_NOTICE) + '</div>';
    } else if (hasInfoOrNote) {
        html += '<div class="detail-notice"> ' + esc(OTHER_INSTANCE_NOTICE) + '</div>';
    }

    if (event.groupId) {
        const groupUrl = 'https://vrchat.com/home/group/' + encodeURIComponent(event.groupId);
        const linkHtml = '<a class="group-link" href="' + esc(groupUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(event.groupId) + '</a>';
        html += detailRow('グループ', linkHtml);
    }

    if (event.information) html += '<div class="detail-info">' + esc(event.information) + '</div>';
    if (event.note) html += '<div class="detail-note">📝 ' + esc(event.note) + '</div>';

    contentEl.innerHTML = html;
    document.getElementById('detailPanel').classList.add('open');
}

function detailRow(label, valueHtml) {
    return '<div class="detail-row">' +
        '<span class="detail-label">' + esc(label) + '</span>' +
        '<span class="detail-value">' + valueHtml + '</span>' +
        '</div>';
}

function render() {
    const now = getJSTNow();
    const listEl = document.getElementById('eventListPanel');
    let html = '';

    if (currentView === 'daily') html = renderDailyView(getDailyEvents(now));
    else if (currentView === 'none') html = renderNoneView();
    else html = renderDayView(parseInt(currentView, 10));

    listEl.innerHTML = html;
    listEl.querySelectorAll('.event-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx, 10);
            selectEvent(idx);
        });
    });

    updateUpdateInfo();
}

function selectEvent(idx) {
    selectedEventIdx = idx;
    renderDetail(allEvents[idx]);
    document.querySelectorAll('.event-item').forEach(el => {
        el.classList.toggle('selected', parseInt(el.dataset.idx, 10) === idx);
    });
}

function closeDetail() {
    document.getElementById('detailPanel').classList.remove('open');
    selectedEventIdx = -1;
    renderDetail(null);
    document.querySelectorAll('.event-item.selected').forEach(el => el.classList.remove('selected'));
}

function updateUpdateInfo() {
    const el = document.getElementById('updateInfo');
    const parts = [];
    if (updateAt) parts.push('update at ' + updateAt);
    el.textContent = parts.join(' / ');
}

function normalizeEvent(raw, idx) {
    return {
        ...raw,
        _idx: idx,
        eventName: raw.eventName || '',
        dayOfWeek: Number(raw.dayOfWeek || 0),
        biweekly: Number(raw.biweekly || 0),
        dateInMonth: raw.dateInMonth ?? '',
        startTime: Number(raw.startTime || 0),
        endTime: Number(raw.endTime || 0),
        organizer: raw.organizer || '',
        joinMethod: Number(raw.joinMethod || 0),
        platform: Number(raw.platform || 0),
        groupId: raw.groupId || '',
        information: raw.information || '',
        note: raw.note || '',
        specialFlag: Number(raw.specialFlag ?? raw.specialFlags ?? 0),
        _parsedDateInMonths: parseDateInMonth(raw.dateInMonth)
    };
}

async function loadData() {
    try {
        const resp = await fetch('./qevcal.json', { cache: 'no-cache' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        updateAt = data.updateAt || '';
        allowIosToggle = typeof data.allowiosToggle === 'boolean' ? data.allowiosToggle : true;
        allEvents = Array.isArray(data.events) ? data.events.map(normalizeEvent) : [];

        const toggleIOS = document.getElementById('toggleIOS');
        const platformLabel = document.getElementById('platformLabel');
        if (!allowIosToggle) {
            onlyIos = false;
            toggleIOS.hidden = true;
            platformLabel.hidden = true;
            document.getElementById('platformToggles').hidden = true;
        } else {
            toggleIOS.hidden = false;
            platformLabel.hidden = false;
            document.getElementById('platformToggles').hidden = false;
        }

        renderDetail(null);
        render();
    } catch (err) {
        console.error(err);
        document.getElementById('eventListPanel').innerHTML =
            '<div class="empty-state">データの読み込みに失敗しました</div>';
    }
}

function initNav() {
    document.querySelectorAll('#navButtons .nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentView = btn.dataset.view;
            document.querySelectorAll('#navButtons .nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            render();
        });
    });
}

function initControls() {
    const toggleIOS = document.getElementById('toggleIOS');
    toggleIOS.addEventListener('click', () => {
        if (!allowIosToggle) return;
        onlyIos = !onlyIos;
        toggleIOS.classList.toggle('active', onlyIos);
        render();
    });

    document.getElementById('toggleAndroid').hidden = true;

    document.getElementById('searchInput').addEventListener('input', e => {
        searchQuery = e.target.value.trim();
        render();
    });

    document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
}

initNav();
initControls();
loadData();
setInterval(render, 60 * 1000);