const firebaseConfig = {
	apiKey: "AIzaSyAdUEAHg08-FheJjawYwIPRov4105qdG0o",
	authDomain: "createteamprogram.firebaseapp.com",
	databaseURL: "https://createteamprogram-default-rtdb.asia-southeast1.firebasedatabase.app",
	projectId: "createteamprogram",
	storageBucket: "createteamprogram.firebasestorage.app",
	messagingSenderId: "108758586522",
	appId: "1:108758586522:web:75386ff04fa79121a0bb23",
	measurementId: "G-N7D10Q7MNF"
};

let database = null;
let selected = { type: null, key: null };
let toastTimer = null;
let memberDraft = { people: [], inactivePeople: [] };
let groupDraft = []; // requiredGroups: [[id, id], [id, id], ...]
let groupColorsDraft = []; // groupColors saved from main page
let constraintDraft = [];
let ruleDraft = [];
let reservationDraft = [];
let historyDraft = [];

// 실시간 리스너 핸들
let _profilesListenerRef = null;
let _usersListenerRef = null;
let _selectedListenerRef = null;
let _selectedListenerCallback = null;
let _globalHistoryListenerRef = null;
let _isSaving = false;

// 에디터 세션 타이머
let _sessionTimerInterval = null;
const _ADMIN_SESSION_STALE_MS = 5000;

// 좌측 목록 배지 로컬 tick (heartbeat 도착 타이밍과 분 경계가 어긋나도 즉시 갱신)
let _listBadgeTickInterval = null;

// 목록 캐시 (구조 변경 감지용)
const _listCache = { profiles: null, users: null };
const SESSION_ONLY_FIELDS = new Set(['heartbeat','sessionStart','online','tokenOnline','sessionType','onlineUser','tokenOnlineUser','lastAccess']);

// 에디터 캐시 (session-only 변경 감지용)
let _editorDataCache = null;

const ADMIN_ACCESS_SESSION_KEY = 'adminAccessAuthenticated';

const fieldIds = {
	key: 'fieldKey',
	membersPerTeam: 'fieldMembersPerTeam',
	genderBalanceEnabled: 'fieldGenderBalanceEnabled',
	maxTeamSizeEnabled: 'fieldMaxTeamSizeEnabled',
	weightBalanceEnabled: 'fieldWeightBalanceEnabled',
	createdAt: 'fieldCreatedAt',
	lastAccess: 'fieldLastAccess',
	password: 'fieldPassword',
	timestamp: 'fieldTimestamp'
};

const fieldEnabledByType = {
	profiles: {
		createdAt: false,
		lastAccess: false
	},
	users: {
		timestamp: false
	}
};

function getDbTimestamp() {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	const hh = String(now.getHours()).padStart(2, '0');
	const mm = String(now.getMinutes()).padStart(2, '0');
	const ss = String(now.getSeconds()).padStart(2, '0');
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function buildSyncTriggerPayload(type = 'all') {
	return {
		timestamp: getDbTimestamp(),
		tick: Date.now(),
		type
	};
}

function getSyncTriggerPath(type, key) {
	if (!key) {
		return '';
	}
	if (type === 'users') {
		return `users/${key}/syncTrigger`;
	}
	if (type === 'profiles') {
		return `profiles/${key}/syncTrigger`;
	}
	return '';
}

async function broadcastSyncTrigger(type, key, syncType = 'all') {
	if (!type || !key) {
		return;
	}
	const path = getSyncTriggerPath(type, key);
	if (!path) {
		return;
	}
	const payload = buildSyncTriggerPayload(syncType);
	await database.ref(path).set(payload);
}

function getSelectedTypePath(type, key) {
	if (!key) {
		return '';
	}
	if (type === 'users') {
		return `users/${key}`;
	}
	if (type === 'profiles') {
		return `profiles/${key}`;
	}
	return `${type}/${key}`;
}

async function savePayloadByType(type, key, payload) {
	if (!type || !key || !payload) {
		return;
	}
	const path = getSelectedTypePath(type, key);
	if (!path) {
		return;
	}
	await database.ref(path).update(payload);
}

function getEl(id) {
	return document.getElementById(id);
}

function showToast(message) {
	const toast = getEl('toast');
	toast.textContent = message;
	toast.classList.add('show');
	if (toastTimer) {
		clearTimeout(toastTimer);
	}
	toastTimer = setTimeout(() => {
		toast.classList.remove('show');
	}, 1800);
}

function initFirebase() {
	const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
	database = app.database();
}

function blockAdminAccess() {
	window.location.replace('login.html');
}

function logoutAdminAccess() {
	window.sessionStorage.removeItem(ADMIN_ACCESS_SESSION_KEY);
	window.location.replace('login.html');
}

function guardAdminAccess() {
	const sessionAuthenticated = window.sessionStorage.getItem(ADMIN_ACCESS_SESSION_KEY) === 'true';
	if (!sessionAuthenticated) {
		blockAdminAccess();
		return false;
	}
	return true;
}

function setButtonsEnabled(enabled) {
	getEl('saveBtn').disabled = !enabled;
	getEl('syncBtn').disabled = !enabled;
	document.querySelectorAll('.row-action-btn').forEach((button) => {
		button.disabled = !enabled;
	});
}

const GROUP_COLORS = [
	'#6FE5DD', '#FFB3BA', '#FFD93D', '#6BCB77', '#A78BFA',
	'#FD9843', '#FF1493', '#38BDF8', '#34D399', '#9900FF',
	'#5B7FBF', '#0066ff'
];

function getGroupColorForPersonId(personId) {
	for (let i = 0; i < groupDraft.length; i++) {
		if (groupDraft[i].includes(personId)) {
			const palette = groupColorsDraft.length ? groupColorsDraft : GROUP_COLORS;
			return palette[i % palette.length];
		}
	}
	return null;
}

function toGroupsArray(val) {
	if (!val) return [];
	const outer = Array.isArray(val) ? val : Object.values(val);
	return outer.map(inner => {
		if (!inner) return [];
		if (Array.isArray(inner)) return inner;
		if (typeof inner === 'object') return Object.values(inner);
		return [];
	});
}

function normalizeMember(item, index) {
	return {
		id: typeof item?.id === 'number' ? item.id : index + 1,
		name: item?.name || '',
		gender: item?.gender === 'female' ? 'female' : 'male',
		weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : 0
	};
}

function toMemberArray(val) {
	if (!val) return [];
	if (Array.isArray(val)) return val;
	if (typeof val === 'object') return Object.values(val);
	return [];
}

function cloneMembers(data) {
	const people = toMemberArray(data?.people).map((item, index) => normalizeMember(item, index));
	const inactivePeople = toMemberArray(data?.inactivePeople).map((item, index) => normalizeMember(item, index));
	memberDraft = { people, inactivePeople };
	groupDraft = toGroupsArray(data?.requiredGroups);
	groupColorsDraft = Array.isArray(data?.groupColors) ? data.groupColors : [];
}

function normalizeConstraint(item) {
	if (Array.isArray(item)) {
		return {
			member1: String(item[0] ?? ''),
			member2: String(item[1] ?? '')
		};
	}
	if (item && typeof item === 'object') {
		return {
			member1: String(item.member1 ?? item.left ?? item.a ?? ''),
			member2: String(item.member2 ?? item.right ?? item.b ?? '')
		};
	}
	return { member1: '', member2: '' };
}

function normalizeName(name) {
	return String(name ?? '').trim().toLowerCase();
}

function normalizeProbability(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return 100;
	}
	return Math.min(100, Math.max(0, Math.round(parsed)));
}

function normalizeRuleProbability(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return 100;
	}
	return Math.min(100, Math.max(-100, Math.round(parsed)));
}

function toList(value) {
	if (Array.isArray(value)) {
		return value;
	}
	if (value && typeof value === 'object') {
		return Object.values(value);
	}
	return [];
}

function buildMemberMaps(data) {
	const idToName = new Map();
	const nameToId = new Map();
	const allMembers = [
		...toList(data?.people),
		...toList(data?.inactivePeople)
	];
	allMembers.forEach((person) => {
		if (!person || typeof person !== 'object') {
			return;
		}
		const id = Number(person.id);
		const name = String(person.name ?? '').trim();
		if (Number.isInteger(id) && name) {
			idToName.set(id, name);
			nameToId.set(normalizeName(name), id);
		}
	});
	return { idToName, nameToId };
}

function mapConstraintValueToName(value, idToName) {
	const numberValue = Number(value);
	if (Number.isInteger(numberValue) && idToName.has(numberValue)) {
		return idToName.get(numberValue) || '';
	}
	return String(value ?? '');
}

function cloneConstraints(data) {
	const { idToName } = buildMemberMaps(data || {});
	const forbiddenPairs = toList(data?.forbiddenPairs);
	const pendingConstraints = toList(data?.pendingConstraints);
	const appliedRows = forbiddenPairs.map((item) => {
		const normalized = normalizeConstraint(item);
		return {
			member1: mapConstraintValueToName(normalized.member1, idToName),
			member2: mapConstraintValueToName(normalized.member2, idToName)
		};
	});
	const pendingRows = pendingConstraints.map((item) => normalizeConstraint(item));
	constraintDraft = [...appliedRows, ...pendingRows];
}

function cloneRules(data) {
	const hiddenGroupChains = toList(data?.hiddenGroupChains);
	const probabilisticForbiddenPairs = toList(data?.probabilisticForbiddenPairs);
	const rows = [];
	hiddenGroupChains.forEach((chain) => {
		if (!chain || typeof chain !== 'object') {
			return;
		}
		const primary = String(chain.primary ?? '').trim();
		const candidates = toList(chain.candidates);
		candidates.forEach((candidate) => {
			const isObjectCandidate = candidate && typeof candidate === 'object';
			const member2 = String(isObjectCandidate ? candidate.name : candidate ?? '').trim();
			const probability = normalizeProbability(isObjectCandidate ? candidate.probability : 100);
			if (!member2) {
				return;
			}
			rows.push({ member1: primary, member2, probability });
		});
	});

	probabilisticForbiddenPairs.forEach((rule) => {
		if (!rule || typeof rule !== 'object') {
			return;
		}
		const member1 = String(rule.left ?? rule.a ?? '').trim();
		const member2 = String(rule.right ?? rule.b ?? '').trim();
		if (!member1 || !member2) {
			return;
		}
		const probability = normalizeProbability(rule.probability);
		rows.push({ member1, member2, probability: -probability });
	});

	ruleDraft = rows;
}

// 예약 배치(batch): [group1, group2, ...] 형태로 정규화
// group은 이름 배열 ["a","b"]
function normalizeReservation(item) {
	const toGroup = (g) => {
		if (Array.isArray(g)) return g.map((n) => String(n ?? '').trim()).filter((n) => n);
		if (typeof g === 'string') return g.split(',').map((n) => n.trim()).filter((n) => n);
		return [];
	};
	if (Array.isArray(item)) {
		if (item.length > 0 && Array.isArray(item[0])) {
			// 이미 다중 그룹 배치: [["a","b"],["c","d"]]
			return item.map(toGroup).filter((g) => g.length > 0);
		}
		// 하위 호환: 단일 그룹 ["a","b"]
		const group = toGroup(item);
		return group.length > 0 ? [group] : [];
	}
	if (typeof item === 'string') {
		const text = item.trim();
		if (!text) return [];
		// "/" 구분자로 다중 그룹 지원: "a,b / c,d"
		return text.split('/').map((part) =>
			part.split(',').map((n) => n.trim()).filter((n) => n)
		).filter((g) => g.length > 0);
	}
	if (item && typeof item === 'object') {
		const names = toList(item.names ?? item.members ?? item.people);
		return names.map((name) => String(name ?? '').trim()).filter((name) => name.length > 0);
	}
	return [];
}

function cloneReservations(data) {
	const source = toList(data?.reservations);
	reservationDraft = source
		.map((item) => normalizeReservation(item))
		.filter((row) => row.length > 0);
}

// 텍스트 → 배치(batch): "a,b / c,d" → [["a","b"],["c","d"]]
function parseReservationText(text) {
	return String(text ?? '').split('/').map((part) =>
		part.split(',').map((n) => n.trim()).filter((n) => n.length > 0)
	).filter((g) => g.length > 0);
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getHistoryCreatedAt(entryKey, entry) {
	const createdAt = String(entry?.createdAt ?? '').trim();
	if (createdAt) {
		return createdAt;
	}
	const keyText = String(entryKey ?? '').trim();
	const match = keyText.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
	if (match) {
		return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
	}
	return keyText;
}

function normalizeHistoryTeams(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((team) => {
		if (Array.isArray(team)) {
			return team.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
		}
		const text = String(team ?? '').trim();
		return text ? [text] : [];
	}).filter((team) => team.length > 0);
}

function normalizeHistoryGroups(value) {
	if (!value) return [];
	const outer = Array.isArray(value) ? value : Object.values(value);
	return outer.map(inner => {
		if (Array.isArray(inner)) return inner.map(String).filter(Boolean);
		if (inner && typeof inner === 'object') return Object.values(inner).map(String).filter(Boolean);
		return [];
	}).filter(g => g.length > 1);
}

function buildGroupNameColorMap(appliedGroups, appliedGroupColors = []) {
	const map = new Map(); // name (normalized) -> color
	appliedGroups.forEach((group, i) => {
		const color = appliedGroupColors[i] || GROUP_COLORS[i % GROUP_COLORS.length];
		group.forEach(name => map.set(name.trim().toLowerCase(), color));
	});
	return map;
}

// 이름 문자열에서 접미사(남/여/가중치) 앞의 순수 이름만 추출
function extractHistoryBaseName(nameStr) {
	const m = nameStr.match(/^(.+?)\([\s\S]*\)$/);
	return m ? m[1].trim() : nameStr.trim();
}

function normalizeHistoryStrings(value, splitter = null) {
	if (Array.isArray(value)) {
		return value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
	}
	const text = String(value ?? '').trim();
	if (!text) {
		return [];
	}
	if (!splitter) {
		return [text];
	}
	return text.split(splitter).map((item) => item.trim()).filter((item) => item.length > 0);
}

function buildHistoryDetailLines(historyItem) {
	const lines = [];
	lines.push('[생성된 팀]');
	if (historyItem.teams.length) {
		historyItem.teams.forEach((team, index) => {
			lines.push(`${index + 1}팀: ${team.join(', ')}`);
		});
	} else {
		lines.push('없음');
	}

	if (historyItem.appliedReservation.length) {
		lines.push('');
		lines.push('[적용된 예약]');
		historyItem.appliedReservation.forEach((item) => {
			lines.push(`- ${item}`);
		});
	}

	if (historyItem.appliedRules.length) {
		lines.push('');
		lines.push('[적용된 규칙]');
		historyItem.appliedRules.forEach((item) => {
			lines.push(`- ${item}`);
		});
	}

	if (historyItem.appliedConstraints.length) {
		lines.push('');
		lines.push('[적용된 분리]');
		historyItem.appliedConstraints.forEach((item) => {
			lines.push(`- ${item}`);
		});
	}

	return lines.join('\n');
}

function cloneGenerateHistory(data) {
	const source = data?.generateHistory;
	if (!source || typeof source !== 'object') {
		historyDraft = [];
		return;
	}

	historyDraft = Object.entries(source).map(([entryKey, entry]) => {
		const createdAt = getHistoryCreatedAt(entryKey, entry || {});
		const rawProfile = entry?.profile || '';
		const rawUserCode = entry?.userCode || '';
		let profile = rawProfile;
		let userCode = rawUserCode;
		if (!userCode && rawProfile.startsWith('users/')) {
			profile = '';
			userCode = rawProfile.slice(6);
		}
		const teams = normalizeHistoryTeams(entry?.teams);
		const appliedReservation = normalizeHistoryStrings(entry?.appliedReservation, null);
		const appliedRules = normalizeHistoryStrings(entry?.appliedRules, '/');
		const appliedConstraints = normalizeHistoryStrings(entry?.appliedConstraints, '/');
		const appliedGroups = normalizeHistoryGroups(entry?.appliedGroups);
		const appliedGroupColors = Array.isArray(entry?.appliedGroupColors) ? entry.appliedGroupColors : [];
		const sortTime = Date.parse(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T'));
		return {
			entryKey,
			historyId: entry?.historyId || '',
			rawCreatedAt: entry?.createdAt ?? null,
			createdAt,
			profile,
			userCode,
			teams,
			appliedReservation,
			appliedRules,
			appliedConstraints,
			appliedGroups,
			appliedGroupColors,
			sortTime: Number.isFinite(sortTime) ? sortTime : Number.NEGATIVE_INFINITY
		};
	});

	historyDraft.sort((a, b) => {
		if (a.sortTime !== b.sortTime) {
			return b.sortTime - a.sortTime;
		}
		return String(b.entryKey).localeCompare(String(a.entryKey), 'ko');
	});
}

function renderGenerateHistoryTableRows() {
	const container = getEl('historyTableBody');
	if (!container) {
		return;
	}
	if (!historyDraft.length) {
		container.innerHTML = `<tr><td class="member-empty" colspan="8">데이터가 없습니다.</td></tr>`;
		return;
	}

	container.innerHTML = historyDraft.map((item) => {
		const profileCell = item.profile
			? `<span class="gh-link" onclick="openItemFromHistory('profiles','${item.profile}')">${item.profile}</span>`
			: '-';
		const userCell = item.userCode
			? `<span class="gh-link" onclick="openItemFromHistory('users','${item.userCode}')">${item.userCode}</span>`
			: '-';
		const colorMap = item.appliedGroups?.length ? buildGroupNameColorMap(item.appliedGroups, item.appliedGroupColors) : null;
		return `
		<tr
			data-history-id="${escapeHtml(item.historyId)}"
			data-raw-created-at="${item.rawCreatedAt ?? ''}"
			data-profile="${escapeHtml(item.profile)}"
			data-user-code="${escapeHtml(item.userCode)}">
			<td class="gh-cell gh-date">${formatGlobalHistoryDate(item.createdAt)}</td>
			<td class="gh-cell gh-profile">${profileCell}</td>
			<td class="gh-cell gh-user">${userCell}</td>
			<td class="gh-cell gh-teams">${formatGlobalHistoryTeams(item.teams, colorMap)}</td>
			<td class="gh-cell">${formatGlobalHistoryList(item.appliedReservation)}</td>
			<td class="gh-cell">${formatGlobalHistoryList(item.appliedRules)}</td>
			<td class="gh-cell">${formatGlobalHistoryList(item.appliedConstraints)}</td>
			<td class="gh-cell gh-del"><button class="history-del-btn" type="button" data-role="delete-history">삭제</button></td>
		</tr>`;
	}).join('');
}

function renderGenerateHistoryTable() {
	renderGenerateHistoryTableRows();
	const historyTableRow = getEl('historyTableRow');
	if (historyTableRow) {
		historyTableRow.classList.remove('expanded');
		closeAllHistoryDetailRows();
	}
	refreshHistoryExpandButton();
	applyHistoryExpandedState();
}

function closeAllHistoryDetailRows(container = getEl('historyTableBody')) {
	if (!(container instanceof HTMLElement)) {
		return;
	}
	const detailRows = Array.from(container.querySelectorAll('tr.history-detail-row'));
	const toggleButtons = Array.from(container.querySelectorAll('button[data-role="toggle-history"]'));
	detailRows.forEach((row) => {
		row.setAttribute('hidden', '');
	});
	toggleButtons.forEach((button) => {
		button.setAttribute('aria-expanded', 'false');
		const chevron = button.querySelector('.history-chevron');
		if (chevron) {
			chevron.textContent = '▸';
		}
	});
}

function openAllHistoryDetailRows(container = getEl('historyTableBody')) {
	if (!(container instanceof HTMLElement)) {
		return;
	}
	const detailRows = Array.from(container.querySelectorAll('tr.history-detail-row'));
	const toggleButtons = Array.from(container.querySelectorAll('button[data-role="toggle-history"]'));
	detailRows.forEach((row) => {
		row.removeAttribute('hidden');
	});
	toggleButtons.forEach((button) => {
		button.setAttribute('aria-expanded', 'true');
		const chevron = button.querySelector('.history-chevron');
		if (chevron) {
			chevron.textContent = '▾';
		}
	});
}

function getGenderLabel(gender) {
	return gender === 'female' ? '♀️' : '♂️';
}

function updateMemberSummary() {
	const participantsCount = getEl('participantsCountText');
	const inactiveCount = getEl('inactiveCountText');
	if (participantsCount) {
		participantsCount.textContent = `${memberDraft.people.length}명`;
	}
	if (inactiveCount) {
		inactiveCount.textContent = `${memberDraft.inactivePeople.length}명`;
	}
}

// 메인 페이지 renderPeople()과 동일한 시각적 순서를 계산
// groups 내 멤버를 처음 만나는 시점에 그룹 전체를 삽입 (그룹 내부 순서 유지)
function getVisualOrder(people, groups) {
	const groupMap = new Map();
	groups.forEach((group, groupIndex) => {
		group.forEach(personId => groupMap.set(personId, groupIndex));
	});

	const processedGroups = new Set();
	const result = [];

	people.forEach((person, originalIndex) => {
		const groupIndex = groupMap.get(person.id);
		if (groupIndex !== undefined && !processedGroups.has(groupIndex)) {
			processedGroups.add(groupIndex);
			groups[groupIndex].forEach(personId => {
				const idx = people.findIndex(p => p.id === personId);
				if (idx !== -1) result.push({ person: people[idx], originalIndex: idx });
			});
		} else if (groupIndex === undefined) {
			result.push({ person, originalIndex });
		}
		// 이미 처리된 그룹 멤버는 스킵
	});

	return result;
}

function renderMemberTableRows(containerId, listKey) {
	const container = getEl(containerId);
	if (!container) {
		return;
	}
	const source = memberDraft[listKey];
	if (!source.length) {
		container.innerHTML = `<tr><td class="member-empty" colspan="5">데이터가 없습니다.</td></tr>`;
		return;
	}

	// 참가자(people)만 메인 페이지 시각 순서 적용, 미참가자는 원본 순서 유지
	const rows = listKey === 'people'
		? getVisualOrder(source, groupDraft)
		: source.map((person, originalIndex) => ({ person, originalIndex }));

	container.innerHTML = rows.map(({ person, originalIndex }) => {
		const groupColor = getGroupColorForPersonId(person.id);
		const dotHtml = groupColor
			? `<span class="group-dot" style="background:${groupColor}" title="그룹"></span>`
			: `<span class="group-dot group-dot-empty"></span>`;
		return `<tr data-list="${listKey}" data-index="${originalIndex}">
			<td class="drag-cell" draggable="true" data-role="drag-handle" title="순서 변경"></td>
			<td class="member-name-cell">${dotHtml}<input class="member-input" type="text" data-role="name" value="${person.name.replace(/"/g, '&quot;')}"></td>
			<td><button class="gender-toggle-btn" type="button" data-role="gender">${getGenderLabel(person.gender)}</button></td>
			<td><input class="member-input" type="number" data-role="weight" min="0" step="1" value="${person.weight}"></td>
			<td><button class="member-delete-btn" type="button" data-role="delete" aria-label="삭제">×</button></td>
		</tr>`;
	}).join('');
}

function renderMemberTables() {
	renderMemberTableRows('participantsTableBody', 'people');
	renderMemberTableRows('inactiveTableBody', 'inactivePeople');
	updateMemberSummary();
	refreshMemberExpandButton();
	applyMemberExpandedState();
}

function renderConstraintTableRows() {
	const container = getEl('constraintTableBody');
	if (!container) {
		return;
	}
	if (!constraintDraft.length) {
		container.innerHTML = `<tr><td class="member-empty" colspan="4">데이터가 없습니다.</td></tr>`;
		return;
	}
	container.innerHTML = constraintDraft.map((item, index) => {
		const member1 = (item.member1 || '').replace(/"/g, '&quot;');
		const member2 = (item.member2 || '').replace(/"/g, '&quot;');
		return `<tr data-index="${index}">
			<td class="drag-cell" draggable="true" data-role="drag-handle" title="순서 변경"></td>
			<td><input class="member-input" type="text" data-role="member1" value="${member1}"></td>
			<td><input class="member-input" type="text" data-role="member2" value="${member2}"></td>
			<td><button class="member-delete-btn" type="button" data-role="delete" aria-label="삭제">×</button></td>
		</tr>`;
	}).join('');
}

function renderConstraintTable() {
	renderConstraintTableRows();
	refreshConstraintExpandButton();
	applyConstraintExpandedState();
}

function escapeAttr(value) {
	return String(value ?? '').replace(/"/g, '&quot;');
}

function renderRuleTableRows() {
	const container = getEl('ruleTableBody');
	if (!container) {
		return;
	}
	if (!ruleDraft.length) {
		container.innerHTML = `<tr><td class="member-empty" colspan="5">데이터가 없습니다.</td></tr>`;
		return;
	}

	let html = '';
	let index = 0;
	while (index < ruleDraft.length) {
		const current = ruleDraft[index];
		const member1 = String(current.member1 ?? '').trim();

		if (!member1) {
			const probability = normalizeRuleProbability(ruleDraft[index].probability);
			html += `<tr data-index="${index}">
				<td class="drag-cell" draggable="true" data-role="drag-handle" title="순서 변경"></td>
				<td class="rule-member1-cell"><input class="member-input" type="text" data-role="member1-single" value="${escapeAttr(ruleDraft[index].member1)}"></td>
				<td class="rule-member2-cell"><input class="member-input" type="text" data-role="member2" value="${escapeAttr(ruleDraft[index].member2)}"></td>
				<td class="rule-probability-cell"><input class="member-input" type="number" min="-100" max="100" step="1" data-role="probability" value="${probability}"></td>
				<td class="rule-delete-cell"><button class="member-delete-btn" type="button" data-role="delete" aria-label="삭제">×</button></td>
			</tr>`;
			index += 1;
			continue;
		}

		let span = 1;
		while (index + span < ruleDraft.length) {
			const nextMember1 = String(ruleDraft[index + span].member1 ?? '').trim();
			if (nextMember1 !== member1) {
				break;
			}
			span += 1;
		}

		for (let offset = 0; offset < span; offset += 1) {
			const rowIndex = index + offset;
			const row = ruleDraft[rowIndex];
			const probability = normalizeRuleProbability(row.probability);
			html += `<tr data-index="${rowIndex}">`;
			html += `<td class="drag-cell" draggable="true" data-role="drag-handle" title="순서 변경"></td>`;
			if (offset === 0) {
				html += `<td class="rule-member1-cell" rowspan="${span}"><input class="member-input" type="text" data-role="member1-group" data-group-start="${index}" data-group-size="${span}" value="${escapeAttr(member1)}"></td>`;
			}
			html += `<td class="rule-member2-cell"><input class="member-input" type="text" data-role="member2" value="${escapeAttr(row.member2)}"></td>
			<td class="rule-probability-cell"><input class="member-input" type="number" min="-100" max="100" step="1" data-role="probability" value="${probability}"></td>
			<td class="rule-delete-cell"><button class="member-delete-btn" type="button" data-role="delete" aria-label="삭제">×</button></td>
			</tr>`;
		}

		index += span;
	}

	container.innerHTML = html;
}

function renderRuleTable() {
	renderRuleTableRows();
}

function renderReservationTableRows() {
	const container = getEl('reservationTableBody');
	if (!container) {
		return;
	}
	if (!reservationDraft.length) {
		container.innerHTML = `<tr><td class="member-empty" colspan="3">데이터가 없습니다.</td></tr>`;
		return;
	}

	container.innerHTML = reservationDraft.map((batch, index) => {
		// batch = [group1, group2, ...], 표시: "a, b / c, d"
		const text = batch.map((g) => g.join(', ')).join(' / ');
		return `<tr data-index="${index}">
			<td class="drag-cell" draggable="true" data-role="drag-handle" title="순서 변경"></td>
			<td><input class="member-input" type="text" data-role="reservationText" value="${escapeAttr(text)}" placeholder="a,b,c / d,e,f"></td>
			<td><button class="member-delete-btn" type="button" data-role="delete" aria-label="삭제">×</button></td>
		</tr>`;
	}).join('');
}

function renderReservationTable() {
	renderReservationTableRows();
}

function moveArrayItem(list, fromIndex, toIndex) {
	if (!Array.isArray(list)) {
		return;
	}
	if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
		return;
	}
	if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex > list.length) {
		return;
	}
	if (fromIndex === toIndex || fromIndex + 1 === toIndex) {
		return;
	}
	const [moved] = list.splice(fromIndex, 1);
	const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
	list.splice(insertIndex, 0, moved);
}

function clearDragIndicators(tbody) {
	if (!(tbody instanceof HTMLElement)) {
		return;
	}
	tbody.querySelectorAll('tr.drag-over-before, tr.drag-over-after, tr.dragging-row').forEach((row) => {
		row.classList.remove('drag-over-before', 'drag-over-after', 'dragging-row');
	});
}

function bindReorderDnD(tbody, handlers) {
	if (!(tbody instanceof HTMLElement) || !handlers) {
		return;
	}
	const dragState = {
		fromIndex: -1,
		fromGroup: null,
		overIndex: -1,
		insertAfter: false
	};

	tbody.addEventListener('dragstart', (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !target.matches('[data-role="drag-handle"]')) {
			event.preventDefault();
			return;
		}
		const row = target.closest('tr[data-index]');
		if (!(row instanceof HTMLElement)) {
			event.preventDefault();
			return;
		}
		dragState.fromIndex = Number(row.getAttribute('data-index'));
		dragState.fromGroup = handlers.getGroupKey ? handlers.getGroupKey(row) : null;
		dragState.overIndex = dragState.fromIndex;
		dragState.insertAfter = false;
		row.classList.add('dragging-row');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(dragState.fromIndex));
		}
	});

	tbody.addEventListener('dragover', (event) => {
		if (dragState.fromIndex < 0) {
			return;
		}
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const row = target.closest('tr[data-index]');
		if (!(row instanceof HTMLElement)) {
			return;
		}
		if (handlers.getGroupKey) {
			const currentGroup = handlers.getGroupKey(row);
			if (currentGroup !== dragState.fromGroup) {
				return;
			}
		}
		event.preventDefault();
		const rowRect = row.getBoundingClientRect();
		const insertAfter = (event.clientY - rowRect.top) > (rowRect.height / 2);
		dragState.overIndex = Number(row.getAttribute('data-index'));
		dragState.insertAfter = insertAfter;
		clearDragIndicators(tbody);
		row.classList.add(insertAfter ? 'drag-over-after' : 'drag-over-before');
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	});

	tbody.addEventListener('drop', (event) => {
		if (dragState.fromIndex < 0 || dragState.overIndex < 0) {
			return;
		}
		event.preventDefault();
		const targetIndex = dragState.overIndex + (dragState.insertAfter ? 1 : 0);
		handlers.reorder(dragState.fromIndex, targetIndex, dragState.fromGroup);
		handlers.render();
		dragState.fromIndex = -1;
		dragState.overIndex = -1;
		dragState.fromGroup = null;
		dragState.insertAfter = false;
		clearDragIndicators(tbody);
	});

	tbody.addEventListener('dragend', () => {
		dragState.fromIndex = -1;
		dragState.overIndex = -1;
		dragState.fromGroup = null;
		dragState.insertAfter = false;
		clearDragIndicators(tbody);
	});
}


function focusLastReservationInput() {
	const tbody = getEl('reservationTableBody');
	if (!(tbody instanceof HTMLElement)) {
		return;
	}
	requestAnimationFrame(() => {
		const inputs = tbody.querySelectorAll('input[data-role="reservationText"]');
		const targetInput = inputs.length ? inputs[inputs.length - 1] : null;
		if (targetInput instanceof HTMLInputElement) {
			targetInput.focus();
			targetInput.select();
		}
	});
}

function createEmptyConstraint() {
	return { member1: '', member2: '' };
}


function focusLastConstraintInput() {
	const tbody = getEl('constraintTableBody');
	if (!(tbody instanceof HTMLElement)) {
		return;
	}
	requestAnimationFrame(() => {
		const inputs = tbody.querySelectorAll('input[data-role="member1"]');
		const targetInput = inputs.length ? inputs[inputs.length - 1] : null;
		if (targetInput instanceof HTMLInputElement) {
			targetInput.focus();
			targetInput.select();
		}
	});
}


function focusLastRuleMember1Input() {
	const tbody = getEl('ruleTableBody');
	if (!(tbody instanceof HTMLElement)) {
		return;
	}
	requestAnimationFrame(() => {
		const inputs = tbody.querySelectorAll('input[data-role="member1-single"], input[data-role="member1-group"]');
		const targetInput = inputs.length ? inputs[inputs.length - 1] : null;
		if (targetInput instanceof HTMLInputElement) {
			targetInput.focus();
			targetInput.select();
		}
	});
}

function createEmptyMember() {
	const allMembers = [...memberDraft.people, ...memberDraft.inactivePeople];
	const nextId = allMembers.reduce((maxId, item) => {
		const idValue = Number(item?.id || 0);
		return Math.max(maxId, idValue);
	}, 0) + 1;
	return {
		id: nextId,
		name: '',
		gender: 'male',
		weight: 0
	};
}


function focusLastMemberNameInput(listKey) {
	const tbodyId = listKey === 'people' ? 'participantsTableBody' : 'inactiveTableBody';
	const tbody = getEl(tbodyId);
	if (!(tbody instanceof HTMLElement)) {
		return;
	}
	requestAnimationFrame(() => {
		const inputs = tbody.querySelectorAll('input[data-role="name"]');
		const targetInput = inputs.length ? inputs[inputs.length - 1] : null;
		if (targetInput instanceof HTMLInputElement) {
			targetInput.focus();
			targetInput.select();
		}
	});
}

function shouldShowMemberExpandButton() { return false; }
function shouldShowConstraintExpandButton() { return false; }
function shouldShowHistoryExpandButton() { return true; }

function refreshMemberExpandButton() {
	const button = getEl('memberExpandBtn');
	const row = getEl('memberTableRow');
	if (!(button instanceof HTMLButtonElement) || !row) {
		return;
	}
	const shouldShow = shouldShowMemberExpandButton(row);
	if (!shouldShow) {
		row.classList.remove('expanded');
		button.style.display = 'none';
		return;
	}
	button.style.display = '';
	button.textContent = row.classList.contains('expanded') ? '숨기기' : '모두 보기';
}

function refreshConstraintExpandButton() {
	const button = getEl('constraintExpandBtn');
	const row = getEl('constraintTableRow');
	if (!(button instanceof HTMLButtonElement) || !row) {
		return;
	}
	const shouldShow = shouldShowConstraintExpandButton();
	if (!shouldShow) {
		row.classList.remove('expanded');
		button.style.display = 'none';
		return;
	}
	button.style.display = '';
	button.textContent = row.classList.contains('expanded') ? '숨기기' : '모두 보기';
}

function refreshHistoryExpandButton() {
	const button = getEl('historyExpandBtn');
	const row = getEl('historyTableRow');
	if (!(button instanceof HTMLButtonElement) || !row) {
		return;
	}
	const shouldShow = shouldShowHistoryExpandButton();
	if (!shouldShow) {
		row.classList.remove('expanded');
		closeAllHistoryDetailRows();
		button.style.display = 'none';
		return;
	}
	button.style.display = '';
	button.textContent = row.classList.contains('expanded') ? '숨기기' : '모두 보기';
}

function applyMemberExpandedState() {}
function applyConstraintExpandedState() {}
function applyHistoryExpandedState() {}

function setFieldAvailability(type) {
	const disabledMap = fieldEnabledByType[type] || {};
	Object.values(fieldIds).forEach((id) => {
		if (id === fieldIds.key) {
			return;
		}
		const element = getEl(id);
		if (!element) {
			return;
		}
		const fieldName = Object.keys(fieldIds).find((key) => fieldIds[key] === id);
		if (!fieldName) {
			return;
		}
		element.disabled = disabledMap[fieldName] === false;
	});
}

function updateConditionalRows(type) {
	const passwordRow = getEl('passwordRow');
	const historyRow = getEl('historyTableRow');
	if (!passwordRow) {
		return;
	}
	// profiles: 비밀번호 필드 표시 (로그인에 사용), users: 숨김
	passwordRow.style.display = type === 'profiles' ? 'flex' : 'none';
	if (historyRow) {
		historyRow.style.display = (type === 'users' || type === 'profiles') ? 'flex' : 'none';
	}
}

function readFormData() {
	return {
		membersPerTeam: Number(getEl(fieldIds.membersPerTeam).value || 0),
		genderBalanceEnabled: getEl(fieldIds.genderBalanceEnabled).checked,
		maxTeamSizeEnabled: getEl(fieldIds.maxTeamSizeEnabled).checked,
		weightBalanceEnabled: getEl(fieldIds.weightBalanceEnabled).checked,
		createdAt: getEl(fieldIds.createdAt).value.trim(),
		lastAccess: getEl(fieldIds.lastAccess).value.trim(),
		timestamp: getEl(fieldIds.timestamp).value.trim()
	};
}

function writeFormData(key, type, data) {
	getEl(fieldIds.key).textContent = key || '';
	getEl(fieldIds.membersPerTeam).value = Number.isFinite(data.membersPerTeam) ? data.membersPerTeam : '';
	getEl(fieldIds.genderBalanceEnabled).checked = Boolean(data.genderBalanceEnabled);
	getEl(fieldIds.maxTeamSizeEnabled).checked = Boolean(data.maxTeamSizeEnabled);
	getEl(fieldIds.weightBalanceEnabled).checked = Boolean(data.weightBalanceEnabled);
	const createdAtValue = data.createdAt || (type === 'profiles' ? (data.timestamp || '') : '');
	getEl(fieldIds.createdAt).value = createdAtValue;
	getEl(fieldIds.lastAccess).value = data.lastAccess || '';
	getEl(fieldIds.password).value = data.password || '';
	getEl(fieldIds.timestamp).value = data.timestamp || '';
	// 토큰을 editorTitle 끝에 표시
	const titleEl = getEl('editorTitle');
	if (titleEl) {
		const base = `${selected.type}/${selected.key}`;
		titleEl.textContent = (type === 'profiles' && data.token) ? `${base} (${data.token})` : base;
	}
	cloneMembers(data || {});
	cloneConstraints(data || {});
	cloneRules(data || {});
	cloneReservations(data || {});
	cloneGenerateHistory(data || {});
	renderMemberTables();
	renderConstraintTable();
	renderRuleTable();
	renderReservationTable();
	renderGenerateHistoryTable();
	setFieldAvailability(type);
	updateConditionalRows(type);
	// 에디터 세션 타이머 (online 상태 + sessionStart 존재 시)
	syncEditorSessionTimer(type, data);
	_editorDataCache = data;
}

function syncEditorSessionTimer(type, data) {
	if (data?.sessionStart && (data?.online === true || data?.tokenOnline === true)) {
		const sessionUserCode = type === 'profiles'
			? (data.sessionType === 'token' ? (data.tokenOnlineUser || data.onlineUser || '') : (data.onlineUser || ''))
			: '';
		startSessionTimer(data.sessionStart, data.sessionType, type, sessionUserCode);
	} else {
		stopSessionTimer();
	}
}

function applySelectionStyles() {
	document.querySelectorAll('.item-btn').forEach((btn) => {
		const match = btn.dataset.type === selected.type && btn.dataset.key === selected.key;
		btn.classList.toggle('active', match);
	});
}

function setEditorHeader() {
	const title = getEl('editorTitle');
	const subtitle = getEl('editorSubtitle');
	_editorDataCache = null;
	if (!selected.type || !selected.key) {
		title.textContent = '항목을 선택하세요';
		subtitle.textContent = '왼쪽 리스트에서 profiles 또는 users를 선택하면 편집할 수 있습니다.';
		updateConditionalRows(null);
		stopSessionTimer();
		return;
	}
	title.textContent = `${selected.type}/${selected.key}`;
	subtitle.textContent = '수정 후 저장을 누르고, 동기화로 최신 상태를 맞출 수 있습니다.';
	updateConditionalRows(selected.type);
}

async function softDeleteItem(type, key) {
	const label = type === 'profiles' ? `프로필 "${key}"` : `유저 "${key}"`;
	const isHardDelete = key.toLowerCase().includes('test');
	const confirmMsg = isHardDelete
		? `${label}를 완전 삭제하시겠습니까?\n(DB에서 영구적으로 제거됩니다)`
		: `${label}를 삭제하시겠습니까?\n(DB에서 deleted 상태로 처리됩니다)`;
	if (!confirm(confirmMsg)) return;
	try {
		if (isHardDelete) {
			await database.ref(`${type}/${key}`).remove();
		} else {
			const updates = { deleted: true, deletedAt: new Date().toISOString() };
			if (type === 'profiles') updates._label = `${key} (deleted)`;
			await database.ref(`${type}/${key}`).update(updates);
		}
		showToast(`${label} 삭제 완료`);
	} catch (err) {
		showToast('삭제 중 오류가 발생했습니다.');
	}
}

function buildItemButton(type, key, data) {
	const wrapper = document.createElement('div');
	wrapper.className = 'item-wrapper';

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'item-btn';
	if (data?.deleted) button.classList.add('item-btn-deleted');
	button.dataset.type = type;
	button.dataset.key = key;
	const dateValue = data?.timestamp || data?.lastAccess || data?.createdAt || '';
	const displayKey = data?.deleted ? `${key} (deleted)` : key;
	button.innerHTML = `<span class="item-title">${displayKey}${buildBadgeHtml(type, data)}</span><span class="item-meta">${dateValue || 'no timestamp'}</span>`;
	button.addEventListener('click', async () => {
		showEditorView();
		selected = { type, key };
		setButtonsEnabled(true);
		setEditorHeader();
		applySelectionStyles();
		await loadSelectedItem();
		setupSelectedItemListener(type, key);
	});

	const deleteBtn = document.createElement('button');
	deleteBtn.type = 'button';
	deleteBtn.className = 'item-delete-btn';
	deleteBtn.title = '삭제';
	deleteBtn.textContent = '×';
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		softDeleteItem(type, key);
	});

	wrapper.appendChild(button);
	wrapper.appendChild(deleteBtn);
	return wrapper;
}

function toSortableTime(value) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	const text = String(value ?? '').trim();
	if (!text) {
		return Number.POSITIVE_INFINITY;
	}
	const normalized = text.includes('T') ? text : text.replace(' ', 'T');
	const parsed = Date.parse(normalized);
	if (Number.isFinite(parsed)) {
		return parsed;
	}
	return Number.POSITIVE_INFINITY;
}

function getCreatedAtSortValue(type, data) {
	const createdAt = data?.createdAt;
	if (createdAt) {
		return toSortableTime(createdAt);
	}
	if (type === 'profiles') {
		return toSortableTime(data?.timestamp || data?.lastAccess);
	}
	return toSortableTime(data?.timestamp || data?.lastAccess);
}

function buildBadgeHtml(type, data) {
	const isOnline = data?.online === true;
	const isTokenOnline = type === 'profiles' && data?.tokenOnline === true;
	const onlineUser = type === 'profiles' ? (data?.onlineUser || '') : '';
	const tokenOnlineUser = type === 'profiles' ? (data?.tokenOnlineUser || '') : '';
	const sessionActive = isSessionActive(data);
	const sessionStart = data?.sessionStart;
	const sessionType = data?.sessionType || '';
	let html = '';
	if (type === 'profiles') {
		if (sessionActive && sessionStart) {
			const timeStr = formatSessionElapsed(sessionStart);
			if (sessionType === 'token') {
				const who = tokenOnlineUser || onlineUser;
				html += ` <span class="online-badge token-badge">${timeStr}${who ? ` ${escapeHtml(who)}` : ''} 토큰사용중</span>`;
			} else {
				const who = onlineUser;
				html += ` <span class="online-badge">${timeStr}${who ? ` ${escapeHtml(who)}` : ''} 로그인중</span>`;
			}
		} else {
			if (isOnline) {
				const label = onlineUser ? `${escapeHtml(onlineUser)} 로그인중` : '로그인중';
				html += ` <span class="online-badge">${label}</span>`;
			}
			if (isTokenOnline) {
				const label = tokenOnlineUser ? `${escapeHtml(tokenOnlineUser)} 토큰사용중` : '토큰사용중';
				html += ` <span class="online-badge token-badge">${label}</span>`;
			}
		}
	} else {
		if (sessionActive && sessionStart) {
			const timeStr = formatSessionElapsed(sessionStart);
			html += ` <span class="online-badge user-badge">${timeStr} 접속중</span>`;
		} else if (isOnline) {
			html += ` <span class="online-badge user-badge">접속중</span>`;
		}
	}
	return html;
}

function updateListBadgesInPlace(type, values) {
	const listEl = getEl(type === 'profiles' ? 'profilesList' : 'usersList');
	Object.entries(values || {}).forEach(([key, data]) => {
		const btn = listEl.querySelector(`.item-btn[data-key="${CSS.escape(key)}"]`);
		if (!btn) return;
		const titleSpan = btn.querySelector('.item-title');
		if (!titleSpan) return;
		const displayKey = data?.deleted ? `${key} (deleted)` : key;
		titleSpan.innerHTML = `${displayKey}${buildBadgeHtml(type, data)}`;
	});
}

function needsFullRender(type, newData) {
	const old = _listCache[type];
	if (!old) return true;
	const toKeys = (d) => Object.keys(d || {}).filter(k => !d[k]?.deleted).sort().join('\0');
	if (toKeys(newData) !== toKeys(old)) return true;
	for (const key of Object.keys(newData)) {
		const n = newData[key] || {};
		const o = old[key] || {};
		for (const field of Object.keys(n)) {
			if (!SESSION_ONLY_FIELDS.has(field) && JSON.stringify(n[field]) !== JSON.stringify(o[field])) return true;
		}
	}
	return false;
}

function renderList(type, values) {
	const listElement = getEl(type === 'profiles' ? 'profilesList' : 'usersList');
	const countElement = getEl(type === 'profiles' ? 'profilesCount' : 'usersCount');
	listElement.innerHTML = '';
	const entries = Object.entries(values || {}).filter(([, data]) => !data?.deleted);
	countElement.textContent = String(entries.length);
	if (!entries.length) {
		const empty = document.createElement('div');
		empty.className = 'empty-state';
		empty.textContent = '데이터가 없습니다.';
		listElement.appendChild(empty);
		return;
	}
	entries.sort((a, b) => {
		const timeA = getCreatedAtSortValue(type, a[1]);
		const timeB = getCreatedAtSortValue(type, b[1]);
		if (timeA !== timeB) {
			return timeA - timeB;
		}
		return a[0].localeCompare(b[0], 'ko');
	});
	entries.forEach(([key, value]) => {
		listElement.appendChild(buildItemButton(type, key, value));
	});
	applySelectionStyles();
}

function teardownListListeners() {
	if (_profilesListenerRef) {
		_profilesListenerRef.off('value');
		_profilesListenerRef = null;
	}
	if (_usersListenerRef) {
		_usersListenerRef.off('value');
		_usersListenerRef = null;
	}
	stopListBadgeTick();
}

function startListBadgeTick() {
	if (_listBadgeTickInterval) return;
	_listBadgeTickInterval = setInterval(() => {
		if (_listCache.profiles) updateListBadgesInPlace('profiles', _listCache.profiles);
		if (_listCache.users) updateListBadgesInPlace('users', _listCache.users);
	}, 1000);
}

function stopListBadgeTick() {
	if (_listBadgeTickInterval) { clearInterval(_listBadgeTickInterval); _listBadgeTickInterval = null; }
}

function teardownSelectedListener() {
	if (_selectedListenerRef && _selectedListenerCallback) {
		_selectedListenerRef.off('value', _selectedListenerCallback);
	}
	_selectedListenerRef = null;
	_selectedListenerCallback = null;
}

function isSessionOnlyChange(newData) {
	if (!_editorDataCache) return false;
	const old = _editorDataCache;
	for (const field of Object.keys(newData)) {
		if (!SESSION_ONLY_FIELDS.has(field) && JSON.stringify(newData[field]) !== JSON.stringify(old[field])) return false;
	}
	for (const field of Object.keys(old)) {
		if (!SESSION_ONLY_FIELDS.has(field) && JSON.stringify(old[field]) !== JSON.stringify(newData[field])) return false;
	}
	return true;
}

function updateEditorIfSelected(type, key, data) {
	if (selected.type === type && selected.key === key && !_isSaving) {
		if (isSessionOnlyChange(data)) {
			syncEditorSessionTimer(type, data);
		} else {
			writeFormData(key, type, data);
		}
	}
}

function setupRealtimeListeners() {
	teardownListListeners();
	startListBadgeTick();

	_profilesListenerRef = database.ref('profiles');
	_profilesListenerRef.on('value', (snapshot) => {
		const values = snapshot.val() || {};
		if (needsFullRender('profiles', values)) {
			renderList('profiles', values);
		} else {
			updateListBadgesInPlace('profiles', values);
		}
		_listCache.profiles = values;
		if (selected.type === 'profiles' && selected.key && values[selected.key]) {
			updateEditorIfSelected('profiles', selected.key, values[selected.key]);
		}
	});

	_usersListenerRef = database.ref('users');
	_usersListenerRef.on('value', (snapshot) => {
		const values = snapshot.val() || {};
		if (needsFullRender('users', values)) {
			renderList('users', values);
		} else {
			updateListBadgesInPlace('users', values);
		}
		_listCache.users = values;
		if (selected.type === 'users' && selected.key && values[selected.key]) {
			updateEditorIfSelected('users', selected.key, values[selected.key]);
		}
	});
}

function setupSelectedItemListener(type, key) {
	teardownSelectedListener();
	if (!type || !key) return;

	_selectedListenerCallback = (snapshot) => {
		if (_isSaving) return;
		const data = snapshot.val();
		if (!data) return;
		if (isSessionOnlyChange(data)) {
			syncEditorSessionTimer(type, data);
		} else {
			writeFormData(key, type, data);
		}
	};

	_selectedListenerRef = database.ref(`${type}/${key}`);
	_selectedListenerRef.on('value', _selectedListenerCallback);
}

function loadLists() {
	setupRealtimeListeners();
}

async function loadSelectedItem() {
	if (!selected.type || !selected.key) {
		return;
	}
	const snapshot = await database.ref(`${selected.type}/${selected.key}`).once('value');
	const data = snapshot.val();
	if (!data) {
		showToast('선택 항목이 존재하지 않습니다.');
		writeFormData(selected.key, selected.type, {});
		return;
	}
	writeFormData(selected.key, selected.type, data);
}

function buildPayloadFromForm(type) {
	const form = readFormData();
	const { nameToId } = buildMemberMaps(memberDraft);
	const forbiddenPairs = [];
	const pendingConstraints = [];
	const hiddenGroupChainsMap = new Map();
	const probabilisticForbiddenPairs = [];
	const dedupeForbidden = new Set();
	const dedupePending = new Set();
	const dedupeProbabilistic = new Set();

	constraintDraft.forEach((item) => {
		const member1 = String(item.member1 ?? '').trim();
		const member2 = String(item.member2 ?? '').trim();
		if (!member1 || !member2) {
			return;
		}

		const id1 = nameToId.get(normalizeName(member1));
		const id2 = nameToId.get(normalizeName(member2));
		if (Number.isInteger(id1) && Number.isInteger(id2) && id1 !== id2) {
			const a = Math.min(id1, id2);
			const b = Math.max(id1, id2);
			const key = `${a}:${b}`;
			if (!dedupeForbidden.has(key)) {
				dedupeForbidden.add(key);
				forbiddenPairs.push([a, b]);
			}
			return;
		}

		const left = normalizeName(member1);
		const right = normalizeName(member2);
		if (!left || !right || left === right) {
			return;
		}
		const leftRightKey = `${left}:${right}`;
		const rightLeftKey = `${right}:${left}`;
		if (dedupePending.has(leftRightKey) || dedupePending.has(rightLeftKey)) {
			return;
		}
		dedupePending.add(leftRightKey);
		pendingConstraints.push({ left, right });
	});

	ruleDraft.forEach((item) => {
		const member1 = String(item.member1 ?? '').trim();
		const member2 = String(item.member2 ?? '').trim();
		if (!member1 || !member2) {
			return;
		}
		const ruleProbability = normalizeRuleProbability(item.probability);
		if (ruleProbability < 0) {
				const left = member1;
				const right = member2;
			if (!left || !right || left === right) {
				return;
			}
			const pairKey = `${left}:${right}`;
			if (dedupeProbabilistic.has(pairKey)) {
				return;
			}
			dedupeProbabilistic.add(pairKey);
			probabilisticForbiddenPairs.push({
				left,
				right,
				probability: Math.abs(ruleProbability)
			});
			return;
		}
		let chain = hiddenGroupChainsMap.get(member1);
		if (!chain) {
			chain = {
				primary: member1,
				candidateKeys: new Set(),
				candidates: []
			};
			hiddenGroupChainsMap.set(member1, chain);
		}
		const candidateKey = normalizeName(member2);
		if (chain.candidateKeys.has(candidateKey)) {
			return;
		}
		chain.candidateKeys.add(candidateKey);
		chain.candidates.push({ name: member2, probability: normalizeProbability(ruleProbability) });
	});

	const hiddenGroupChains = Array.from(hiddenGroupChainsMap.values()).map((chain) => {
		return {
			primary: chain.primary,
			candidates: chain.candidates
		};
	});

	// reservationDraft = [[group1, group2], ...] 구조 그대로 저장 (normalizeReservations에서 복원)
	const reservations = reservationDraft
		.map((batch) => batch.filter((g) => g.some((n) => String(n ?? '').trim())))
		.filter((batch) => batch.length > 0);

	const payload = {
		membersPerTeam: form.membersPerTeam,
		genderBalanceEnabled: form.genderBalanceEnabled,
		maxTeamSizeEnabled: form.maxTeamSizeEnabled,
		weightBalanceEnabled: form.weightBalanceEnabled,
		people: memberDraft.people,
		inactivePeople: memberDraft.inactivePeople,
		forbiddenPairs,
		pendingConstraints,
		hiddenGroupChains,
		probabilisticForbiddenPairs,
		reservations
	};

	if (type === 'profiles') {
		payload.createdAt = form.createdAt || getDbTimestamp();
		payload.timestamp = form.timestamp || getDbTimestamp();
		const passwordValue = getEl(fieldIds.password) ? getEl(fieldIds.password).value : '';
		if (passwordValue) {
			payload.password = passwordValue;
		}
	}
	if (type === 'users') {
		payload.createdAt = form.createdAt || getDbTimestamp();
		payload.lastAccess = form.lastAccess || getDbTimestamp();
	}
	return payload;
}

function getSectionFieldKeys(section) {
	if (section === 'member') {
		return ['people', 'inactivePeople'];
	}
	if (section === 'option') {
		return ['membersPerTeam', 'genderBalanceEnabled', 'maxTeamSizeEnabled', 'weightBalanceEnabled'];
	}
	if (section === 'constraint') {
		return ['forbiddenPairs', 'pendingConstraints'];
	}
	if (section === 'rule') {
		return ['hiddenGroupChains', 'probabilisticForbiddenPairs'];
	}
	if (section === 'reservation') {
		return ['reservations'];
	}
	return [];
}

function buildSectionPayload(type, section) {
	const fullPayload = buildPayloadFromForm(type);
	const keys = getSectionFieldKeys(section);
	const sectionPayload = {};
	keys.forEach((key) => {
		if (Object.prototype.hasOwnProperty.call(fullPayload, key)) {
			sectionPayload[key] = fullPayload[key];
		}
	});
	return sectionPayload;
}

function sanitizeDraftBySection(section) {
	if (section === 'member') {
		removeEmptyNameRows();
		return;
	}
	if (section === 'constraint') {
		removeEmptyConstraintRows();
		return;
	}
	if (section === 'rule') {
		removeEmptyRuleRows();
		return;
	}
	if (section === 'reservation') {
		removeEmptyReservationRows();
	}
}

function getSectionSyncType(section) {
	if (section === 'member') {
		return 'member';
	}
	if (section === 'option') {
		return 'option';
	}
	if (section === 'constraint') {
		return 'constraint';
	}
	if (section === 'rule') {
		return 'rule';
	}
	if (section === 'reservation') {
		return 'reservation';
	}
	return 'all';
}

function getSectionLabel(section) {
	if (section === 'member') {
		return '멤버';
	}
	if (section === 'option') {
		return '옵션';
	}
	if (section === 'constraint') {
		return '분리';
	}
	if (section === 'rule') {
		return '규칙';
	}
	if (section === 'reservation') {
		return '예약';
	}
	return '항목';
}

function removeEmptyNameRows() {
	const filterByName = (list) => {
		return list.filter((member) => {
			return typeof member?.name === 'string' && member.name.trim().length > 0;
		});
	};

	const beforeCount = memberDraft.people.length + memberDraft.inactivePeople.length;
	memberDraft.people = filterByName(memberDraft.people);
	memberDraft.inactivePeople = filterByName(memberDraft.inactivePeople);
	const afterCount = memberDraft.people.length + memberDraft.inactivePeople.length;

	if (beforeCount !== afterCount) {
		renderMemberTables();
	}
}

function removeEmptyConstraintRows() {
	const before = constraintDraft.length;
	constraintDraft = constraintDraft.filter((item) => {
		return item.member1.trim().length > 0 && item.member2.trim().length > 0;
	});
	if (before !== constraintDraft.length) {
		renderConstraintTable();
	}
}

function removeEmptyRuleRows() {
	const before = ruleDraft.length;
	ruleDraft = ruleDraft.filter((item) => {
		return item.member1.trim().length > 0 && item.member2.trim().length > 0;
	});
	if (before !== ruleDraft.length) {
		renderRuleTable();
	}
}

function removeEmptyReservationRows() {
	const before = reservationDraft.length;
	reservationDraft = reservationDraft
		.map((batch) => batch.filter((g) => g.some((n) => String(n ?? '').trim())))
		.filter((batch) => batch.length > 0);
	if (before !== reservationDraft.length) {
		renderReservationTable();
	}
}

async function saveSelected() {
	if (!selected.type || !selected.key) {
		return;
	}
	removeEmptyNameRows();
	removeEmptyConstraintRows();
	removeEmptyRuleRows();
	removeEmptyReservationRows();
	const payload = buildPayloadFromForm(selected.type);
	_isSaving = true;
	try {
		await savePayloadByType(selected.type, selected.key, payload);
		await loadSelectedItem();
	} finally {
		_isSaving = false;
	}
	showToast('저장 완료');
}

async function syncSelected() {
	if (!selected.type || !selected.key) {
		return;
	}
	removeEmptyNameRows();
	removeEmptyConstraintRows();
	removeEmptyRuleRows();
	removeEmptyReservationRows();
	const payload = buildPayloadFromForm(selected.type);
	_isSaving = true;
	try {
		await savePayloadByType(selected.type, selected.key, payload);
		await broadcastSyncTrigger(selected.type, selected.key, 'all');
		await loadSelectedItem();
	} finally {
		_isSaving = false;
	}
	showToast('동기화 완료');
}

async function executeSectionAction(section, action) {
	if (!selected.type || !selected.key) {
		return;
	}
	sanitizeDraftBySection(section);
	const sectionPayload = buildSectionPayload(selected.type, section);
	if (!Object.keys(sectionPayload).length) {
		showToast('저장할 항목이 없습니다.');
		return;
	}
	const syncType = getSectionSyncType(section);
	const label = getSectionLabel(section);
	_isSaving = true;
	try {
		await savePayloadByType(selected.type, selected.key, sectionPayload);
		if (action === 'sync') {
			await broadcastSyncTrigger(selected.type, selected.key, syncType);
		}
		await loadSelectedItem();
	} finally {
		_isSaving = false;
	}
	showToast(action === 'sync' ? `${label} 동기화 완료` : `${label} 저장 완료`);
}

function initAccordion() {
	document.querySelectorAll('.accordion-header').forEach((header) => {
		header.addEventListener('click', () => {
			const expanded = header.getAttribute('aria-expanded') === 'true';
			header.setAttribute('aria-expanded', String(!expanded));
		});
	});
}

function initTheme() {
	const savedTheme = localStorage.getItem('adminTheme') || 'dark';
	document.documentElement.setAttribute('data-theme', savedTheme);
	const toggleButton = getEl('themeToggleBtn');
	const updateText = () => {
		const theme = document.documentElement.getAttribute('data-theme');
		toggleButton.textContent = theme === 'dark' ? '라이트 모드' : '다크 모드';
	};
	updateText();
	toggleButton.addEventListener('click', () => {
		const current = document.documentElement.getAttribute('data-theme');
		const next = current === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', next);
		localStorage.setItem('adminTheme', next);
		updateText();
	});
}

function bindEvents() {
	getEl('sessionTimerDisplay').addEventListener('click', (e) => {
		const link = e.target.closest('.session-user-link');
		if (link) navigateToUser(link.dataset.userCode);
	});
	getEl('logoutBtn').addEventListener('click', () => {
		logoutAdminAccess();
	});
	getEl('refreshListsBtn').addEventListener('click', async () => {
		loadLists();
		if (selected.type && selected.key) {
			await loadSelectedItem();
			applySelectionStyles();
		}
		showToast('리스트 갱신 완료');
	});
	getEl('saveBtn').addEventListener('click', async () => {
		try {
			await saveSelected();
		} catch (error) {
			showToast(`저장 실패: ${error.message}`);
		}
	});
	getEl('syncBtn').addEventListener('click', async () => {
		try {
			await syncSelected();
		} catch (error) {
			showToast(`동기화 실패: ${error.message}`);
		}
	});
	document.querySelectorAll('[data-row-action][data-section]').forEach((button) => {
		button.addEventListener('click', async () => {
			const section = button.getAttribute('data-section');
			const action = button.getAttribute('data-row-action');
			if (!section || (action !== 'save' && action !== 'sync')) {
				return;
			}
			try {
				await executeSectionAction(section, action);
			} catch (error) {
				const label = getSectionLabel(section);
				const actionLabel = action === 'sync' ? '동기화' : '저장';
				showToast(`${label} ${actionLabel} 실패: ${error.message}`);
			}
		});
	});
	getEl('passwordToggleBtn').addEventListener('click', () => {
		const input = getEl(fieldIds.password);
		const button = getEl('passwordToggleBtn');
		const isMasked = input.type === 'password';
		input.type = isMasked ? 'text' : 'password';
		button.textContent = isMasked ? '🙈' : '👁';
	});

	const handleMemberInput = (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const row = target.closest('tr[data-list][data-index]');
		if (!row) {
			return;
		}
		const listKey = row.getAttribute('data-list');
		const index = Number(row.getAttribute('data-index'));
		if ((listKey !== 'people' && listKey !== 'inactivePeople') || !Number.isInteger(index)) {
			return;
		}
		const person = memberDraft[listKey][index];
		if (!person) {
			return;
		}
		if (target.matches('input[data-role="name"]')) {
			person.name = target.value;
		}
		if (target.matches('input[data-role="weight"]')) {
			person.weight = Number(target.value || 0);
		}
	};

	const handleGenderToggle = (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const row = target.closest('tr[data-list][data-index]');
		if (!row) {
			return;
		}
		const listKey = row.getAttribute('data-list');
		const index = Number(row.getAttribute('data-index'));
		if ((listKey !== 'people' && listKey !== 'inactivePeople') || !Number.isInteger(index)) {
			return;
		}
		const person = memberDraft[listKey][index];
		if (!person) {
			return;
		}

		if (target.matches('button[data-role="gender"]')) {
			person.gender = person.gender === 'male' ? 'female' : 'male';
			target.textContent = getGenderLabel(person.gender);
			return;
		}

		if (target.matches('button[data-role="delete"]')) {
			memberDraft[listKey].splice(index, 1);
			renderMemberTables();
		}
	};

	const participantsBody = getEl('participantsTableBody');
	const inactiveBody = getEl('inactiveTableBody');
	if (participantsBody && inactiveBody) {
		[participantsBody, inactiveBody].forEach((tbody) => {
			tbody.addEventListener('input', handleMemberInput);
			tbody.addEventListener('click', handleGenderToggle);
		});

		bindReorderDnD(participantsBody, {
			getGroupKey: (row) => row.getAttribute('data-list') || '',
			reorder: (fromIndex, toIndex, listKey) => {
				if (listKey !== 'people') {
					return;
				}
				moveArrayItem(memberDraft.people, fromIndex, toIndex);
			},
			render: () => renderMemberTables()
		});

		bindReorderDnD(inactiveBody, {
			getGroupKey: (row) => row.getAttribute('data-list') || '',
			reorder: (fromIndex, toIndex, listKey) => {
				if (listKey !== 'inactivePeople') {
					return;
				}
				moveArrayItem(memberDraft.inactivePeople, fromIndex, toIndex);
			},
			render: () => renderMemberTables()
		});
	}

	document.querySelectorAll('.member-add-btn').forEach((button) => {
		button.addEventListener('click', () => {
			const listKey = button.getAttribute('data-list');
			if (listKey !== 'people' && listKey !== 'inactivePeople') {
				return;
			}
			memberDraft[listKey].push(createEmptyMember());
			renderMemberTables();
			focusLastMemberNameInput(listKey);
		});
	});

	const constraintTableBody = getEl('constraintTableBody');
	if (constraintTableBody) {
		constraintTableBody.addEventListener('input', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !constraintDraft[index]) {
				return;
			}
			if (target.matches('input[data-role="member1"]')) {
				constraintDraft[index].member1 = target.value;
			}
			if (target.matches('input[data-role="member2"]')) {
				constraintDraft[index].member2 = target.value;
			}
		});

		constraintTableBody.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.matches('button[data-role="delete"]')) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !constraintDraft[index]) {
				return;
			}
			constraintDraft.splice(index, 1);
			renderConstraintTable();
		});

		bindReorderDnD(constraintTableBody, {
			reorder: (fromIndex, toIndex) => {
				moveArrayItem(constraintDraft, fromIndex, toIndex);
			},
			render: () => renderConstraintTable()
		});
	}

	const constraintAddBtn = getEl('constraintAddBtn');
	if (constraintAddBtn instanceof HTMLButtonElement) {
		constraintAddBtn.addEventListener('click', () => {
			constraintDraft.push(createEmptyConstraint());
			renderConstraintTable();
			focusLastConstraintInput();
		});
	}

	const ruleTableBody = getEl('ruleTableBody');
	if (ruleTableBody) {
		ruleTableBody.addEventListener('input', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !ruleDraft[index]) {
				return;
			}
			if (target.matches('input[data-role="member2"]')) {
				ruleDraft[index].member2 = target.value;
			}
			if (target.matches('input[data-role="probability"]')) {
				ruleDraft[index].probability = target.value;
			}
			if (target.matches('input[data-role="member1-single"]')) {
				ruleDraft[index].member1 = target.value;
			}
		});

		ruleTableBody.addEventListener('change', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.matches('input[data-role="member1-group"]')) {
				return;
			}
			const start = Number(target.getAttribute('data-group-start'));
			const size = Number(target.getAttribute('data-group-size'));
			if (!Number.isInteger(start) || !Number.isInteger(size) || size <= 0) {
				return;
			}
			for (let offset = 0; offset < size; offset += 1) {
				const rowIndex = start + offset;
				if (!ruleDraft[rowIndex]) {
					continue;
				}
				ruleDraft[rowIndex].member1 = target.value;
			}
			renderRuleTable();
		});

		ruleTableBody.addEventListener('change', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.matches('input[data-role="probability"]')) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !ruleDraft[index]) {
				return;
			}
			ruleDraft[index].probability = normalizeRuleProbability(target.value);
			renderRuleTable();
		});

		ruleTableBody.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.matches('button[data-role="delete"]')) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !ruleDraft[index]) {
				return;
			}
			ruleDraft.splice(index, 1);
			renderRuleTable();
		});

		bindReorderDnD(ruleTableBody, {
			reorder: (fromIndex, toIndex) => {
				moveArrayItem(ruleDraft, fromIndex, toIndex);
			},
			render: () => renderRuleTable()
		});
	}

	const ruleAddBtn = getEl('ruleAddBtn');
	if (ruleAddBtn instanceof HTMLButtonElement) {
		ruleAddBtn.addEventListener('click', () => {
			ruleDraft.push({ member1: '', member2: '', probability: 100 });
			renderRuleTable();
			focusLastRuleMember1Input();
		});
	}

	const reservationTableBody = getEl('reservationTableBody');
	if (reservationTableBody) {
		reservationTableBody.addEventListener('input', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.matches('input[data-role="reservationText"]')) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !reservationDraft[index]) {
				return;
			}
			reservationDraft[index] = parseReservationText(target.value);
		});

		reservationTableBody.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.matches('button[data-role="delete"]')) {
				return;
			}
			const row = target.closest('tr[data-index]');
			if (!row) {
				return;
			}
			const index = Number(row.getAttribute('data-index'));
			if (!Number.isInteger(index) || !reservationDraft[index]) {
				return;
			}
			reservationDraft.splice(index, 1);
			renderReservationTable();
			if (selected.type && selected.key) {
				const reservations = reservationDraft
					.map((batch) => batch.filter((g) => g.some((n) => String(n ?? '').trim())))
					.filter((batch) => batch.length > 0);
				_isSaving = true;
				savePayloadByType(selected.type, selected.key, { reservations: reservations.length ? reservations : null })
					.then(() => loadSelectedItem())
					.catch(() => showToast('삭제 저장 실패'))
					.finally(() => { _isSaving = false; });
			}
		});

		bindReorderDnD(reservationTableBody, {
			reorder: (fromIndex, toIndex) => {
				moveArrayItem(reservationDraft, fromIndex, toIndex);
			},
			render: () => renderReservationTable()
		});
	}

	const reservationAddBtn = getEl('reservationAddBtn');
	if (reservationAddBtn instanceof HTMLButtonElement) {
		reservationAddBtn.addEventListener('click', () => {
			reservationDraft.push([[]]);
			renderReservationTable();
			focusLastReservationInput();
		});
	}

	const globalHistoryTableBody = document.getElementById('globalHistoryTableBody');
	if (globalHistoryTableBody) {
		globalHistoryTableBody.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const button = target.closest('button[data-role="delete-history"]');
			if (!(button instanceof HTMLButtonElement)) return;
			const row = button.closest('tr');
			if (!row) return;
			const historyId = row.dataset.historyId || '';
			const rawCreatedAt = row.dataset.rawCreatedAt !== '' ? row.dataset.rawCreatedAt : null;
			const profile = row.dataset.profile || '';
			const userCode = row.dataset.userCode || '';
			deleteHistoryEntry(historyId, rawCreatedAt, profile, userCode);
		});
	}

	const historyTableBody = getEl('historyTableBody');
	if (historyTableBody) {
		historyTableBody.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			const delButton = target.closest('button[data-role="delete-history"]');
			if (delButton instanceof HTMLButtonElement) {
				const row = delButton.closest('tr');
				if (!row) return;
				const historyId = row.dataset.historyId || '';
				const rawCreatedAt = row.dataset.rawCreatedAt !== '' ? row.dataset.rawCreatedAt : null;
				const profile = row.dataset.profile || '';
				const userCode = row.dataset.userCode || '';
				deleteHistoryEntry(historyId, rawCreatedAt, profile, userCode);
				return;
			}
			const button = target.closest('button[data-role="toggle-history"]');
			if (!(button instanceof HTMLButtonElement)) {
				return;
			}
			const index = button.getAttribute('data-index');
			if (!index) {
				return;
			}
			const targetDetailRow = historyTableBody.querySelector(`tr.history-detail-row[data-index="${index}"]`);
			if (!(targetDetailRow instanceof HTMLElement)) {
				return;
			}
			const historyTableRow = getEl('historyTableRow');
			const isMultiExpandMode = Boolean(historyTableRow?.classList.contains('expanded'));

			const shouldOpen = targetDetailRow.hasAttribute('hidden');
			if (!isMultiExpandMode) {
				closeAllHistoryDetailRows(historyTableBody);
			}

			if (shouldOpen) {
				targetDetailRow.removeAttribute('hidden');
				button.setAttribute('aria-expanded', 'true');
				const chevron = button.querySelector('.history-chevron');
				if (chevron) {
					chevron.textContent = '▾';
				}
				return;
			}

			targetDetailRow.setAttribute('hidden', '');
			button.setAttribute('aria-expanded', 'false');
			const chevron = button.querySelector('.history-chevron');
			if (chevron) {
				chevron.textContent = '▸';
			}
		});
	}

	const historyExpandBtn = getEl('historyExpandBtn');
	const historyTableRow = getEl('historyTableRow');
	if (historyExpandBtn instanceof HTMLButtonElement && historyTableRow) {
		historyExpandBtn.addEventListener('click', () => {
			historyTableRow.classList.toggle('expanded');
			if (historyTableRow.classList.contains('expanded')) {
				openAllHistoryDetailRows();
			} else {
				closeAllHistoryDetailRows();
			}
			applyHistoryExpandedState();
			refreshHistoryExpandButton();
		});
	}

	const memberExpandBtn = getEl('memberExpandBtn');
	const memberTableRow = getEl('memberTableRow');
	if (memberExpandBtn instanceof HTMLButtonElement && memberTableRow) {
		memberExpandBtn.addEventListener('click', () => {
			memberTableRow.classList.toggle('expanded');
			applyMemberExpandedState();
			refreshMemberExpandButton();
		});
	}

	const constraintExpandBtn = getEl('constraintExpandBtn');
	const constraintTableRow = getEl('constraintTableRow');
	if (constraintExpandBtn instanceof HTMLButtonElement && constraintTableRow) {
		constraintExpandBtn.addEventListener('click', () => {
			constraintTableRow.classList.toggle('expanded');
			applyConstraintExpandedState();
			refreshConstraintExpandButton();
		});
	}

	applyMemberExpandedState();
	refreshMemberExpandButton();
	applyConstraintExpandedState();
	refreshConstraintExpandButton();
	applyHistoryExpandedState();
	refreshHistoryExpandButton();
}

function openNewProfileModal() {
	const modal = getEl('newProfileModal');
	const idInput = getEl('newProfileId');
	const pwInput = getEl('newProfilePw');
	const errorEl = getEl('newProfileError');
	if (!modal) return;
	if (idInput) idInput.value = '';
	if (pwInput) pwInput.value = '';
	if (errorEl) errorEl.textContent = '';
	modal.style.display = 'flex';
	requestAnimationFrame(() => {
		modal.classList.add('visible');
		if (idInput) idInput.focus();
	});
}

function closeNewProfileModal() {
	const modal = getEl('newProfileModal');
	if (!modal) return;
	modal.classList.remove('visible');
	setTimeout(() => { modal.style.display = 'none'; }, 200);
}

async function submitNewProfile() {
	const idInput = getEl('newProfileId');
	const pwInput = getEl('newProfilePw');
	const errorEl = getEl('newProfileError');
	const username = (idInput ? idInput.value : '').trim();
	const password = pwInput ? pwInput.value : '';
	if (errorEl) errorEl.textContent = '';

	if (!username) {
		if (errorEl) errorEl.textContent = '아이디를 입력하세요.';
		if (idInput) idInput.focus();
		return;
	}
	if (!password) {
		if (errorEl) errorEl.textContent = '비밀번호를 입력하세요.';
		if (pwInput) pwInput.focus();
		return;
	}

	// 중복 확인
	const existing = await database.ref(`profiles/${username}`).once('value');
	if (existing.exists()) {
		if (errorEl) errorEl.textContent = '이미 존재하는 아이디입니다.';
		if (idInput) idInput.focus();
		return;
	}

	const now = getDbTimestamp();
	await database.ref(`profiles/${username}`).set({
		password,
		createdAt: now,
		timestamp: now
	});

	showToast(`프로필 '${username}' 추가 완료`);
	closeNewProfileModal();

	// 새 항목 자동 선택 (목록은 실시간 리스너가 자동 갱신)
	selected = { type: 'profiles', key: username };
	setButtonsEnabled(true);
	setEditorHeader();
	applySelectionStyles();
	await loadSelectedItem();
	setupSelectedItemListener('profiles', username);
}

function bindNewProfileModal() {
	const addBtn = getEl('addProfileBtn');
	const submitBtn = getEl('newProfileSubmitBtn');
	const cancelBtn = getEl('newProfileCancelBtn');
	const overlay = document.querySelector('#newProfileModal .new-profile-overlay');
	const idInput = getEl('newProfileId');
	const pwInput = getEl('newProfilePw');

	if (addBtn) addBtn.addEventListener('click', openNewProfileModal);
	if (submitBtn) submitBtn.addEventListener('click', submitNewProfile);
	if (cancelBtn) cancelBtn.addEventListener('click', closeNewProfileModal);
	if (overlay) overlay.addEventListener('click', closeNewProfileModal);
	if (idInput) {
		idInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { const pw = getEl('newProfilePw'); if (pw) pw.focus(); }
		});
	}
	if (pwInput) {
		pwInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') submitNewProfile();
		});
	}
}

// ==================== 전역 생성히스토리 ====================

let globalHistoryData = [];

async function openItemFromHistory(type, key) {
	if (!key || key === '-') return;
	showEditorView();
	selected = { type, key };
	setButtonsEnabled(true);
	setEditorHeader();
	applySelectionStyles();
	await loadSelectedItem();
	setupSelectedItemListener(type, key);
}

function isSessionActive(data) {
	// online/tokenOnline 필드가 Firebase onDisconnect로 관리되므로 presence 기준 사용
	return Boolean(data?.sessionStart && (data?.online === true || data?.tokenOnline === true));
}

function formatSessionElapsed(sessionStart) {
	const elapsed = Math.max(0, Math.floor((Date.now() - sessionStart) / 1000));
	return elapsed < 60
		? `${elapsed}초동안`
		: `${Math.floor(elapsed / 60)}분동안`;
}

function startSessionTimer(sessionStart, sessionType, itemType, sessionUserCode) {
	stopSessionTimer();
	const el = document.getElementById('sessionTimerDisplay');
	if (!el || !sessionStart) { if (el) el.style.display = 'none'; return; }
	const colorClass = itemType === 'profiles'
		? (sessionType === 'token' ? 'session-timer-token' : 'session-timer-login')
		: 'session-timer-user';
	el.className = `session-timer-display ${colorClass}`;
	el.style.display = '';
	const isProfile = itemType === 'profiles';
	const tick = () => {
		const elapsed = Math.max(0, Math.floor((Date.now() - sessionStart) / 1000));
		const m = Math.floor(elapsed / 60);
		const s = elapsed % 60;
		if (isProfile && sessionUserCode) {
			el.innerHTML = `( <span class="session-user-link" data-user-code="${escapeHtml(sessionUserCode)}">${escapeHtml(sessionUserCode)}</span> - ${m}분 ${s}초 )`;
		} else {
			el.textContent = `( ${m}분 ${s}초 )`;
		}
	};
	tick();
	_sessionTimerInterval = setInterval(tick, 1000);
}

function navigateToUser(userCode) {
	const btn = document.querySelector(`.item-btn[data-type="users"][data-key="${CSS.escape(userCode)}"]`);
	if (btn) btn.click();
}

function stopSessionTimer() {
	if (_sessionTimerInterval) { clearInterval(_sessionTimerInterval); _sessionTimerInterval = null; }
	const el = document.getElementById('sessionTimerDisplay');
	if (el) el.style.display = 'none';
}

function formatGlobalHistoryDate(createdAt) {
	if (!createdAt) return '-';
	let d;
	if (typeof createdAt === 'number') {
		d = new Date(createdAt);
	} else {
		d = new Date(String(createdAt));
	}
	if (isNaN(d.getTime())) return String(createdAt);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatGlobalHistoryTeams(teams, groupNameColorMap = null) {
	if (!Array.isArray(teams) || teams.length === 0) return '-';
	return teams.map((team, i) => {
		const memberHtml = Array.isArray(team)
			? team.map(nameStr => {
				if (!groupNameColorMap) return escapeHtml(nameStr);
				const baseName = extractHistoryBaseName(nameStr);
				const color = groupNameColorMap.get(baseName.toLowerCase());
				if (color) {
					return `<span class="gh-group-name" style="border-bottom-color:${color}">${escapeHtml(nameStr)}</span>`;
				}
				return escapeHtml(nameStr);
			}).join(', ')
			: escapeHtml(String(team));
		return `<span class="gh-team-block"><b>팀${i+1}</b> ${memberHtml}</span>`;
	}).join('');
}

function escapeHtml(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatGlobalHistoryList(val) {
	if (!val) return '-';
	if (Array.isArray(val)) return val.filter(Boolean).join(', ') || '-';
	return String(val) || '-';
}

function extractHistoryEntries(rootKey, rootData) {
	const historyNode = rootData?.generateHistory;
	if (!historyNode || typeof historyNode !== 'object') return [];
	return Object.entries(historyNode).map(([entryKey, entry]) => ({
		key: `${rootKey}/${entryKey}`,
		createdAt: entry?.createdAt || entryKey,
		profile: entry?.profile || rootKey,
		teams: normalizeHistoryTeams(entry?.teams),
		appliedReservation: normalizeHistoryStrings(entry?.appliedReservation, null),
		appliedRules: normalizeHistoryStrings(entry?.appliedRules, '/'),
		appliedConstraints: normalizeHistoryStrings(entry?.appliedConstraints, '/')
	}));
}

function parseGlobalHistoryEntry(pushKey, entry) {
	const rawProfile = entry?.profile || '';
	const rawUserCode = entry?.userCode || '';
	let profile = rawProfile;
	let userCode = rawUserCode;
	if (!userCode && rawProfile.startsWith('users/')) {
		profile = '';
		userCode = rawProfile.slice(6);
	}
	return {
		key: pushKey,
		historyId: entry?.historyId || '',
		rawCreatedAt: entry?.createdAt ?? null,
		createdAt: entry?.createdAt || pushKey,
		profile,
		userCode,
		teams: normalizeHistoryTeams(entry?.teams),
		appliedReservation: normalizeHistoryStrings(entry?.appliedReservation, null),
		appliedRules: normalizeHistoryStrings(entry?.appliedRules, '/'),
		appliedConstraints: normalizeHistoryStrings(entry?.appliedConstraints, '/'),
		appliedGroups: normalizeHistoryGroups(entry?.appliedGroups),
		appliedGroupColors: Array.isArray(entry?.appliedGroupColors) ? entry.appliedGroupColors : []
	};
}

function setupGlobalHistoryListener() {
	if (_globalHistoryListenerRef) return;
	const tbody = document.getElementById('globalHistoryTableBody');
	const countEl = document.getElementById('globalHistoryCount');
	if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="gh-loading">불러오는 중...</td></tr>';
	_globalHistoryListenerRef = database.ref('generateHistory');
	_globalHistoryListenerRef.on('value', (snapshot) => {
		const data = snapshot.val() || {};
		const allEntries = Object.entries(data).map(([k, v]) => parseGlobalHistoryEntry(k, v));
		allEntries.sort((a, b) => {
			const ta = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt).getTime() || 0;
			const tb = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt).getTime() || 0;
			return tb - ta;
		});
		globalHistoryData = allEntries;
		if (countEl) countEl.textContent = globalHistoryData.length;
		renderGlobalHistory();
	}, (e) => {
		if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="gh-loading">로드 실패: ${e.message}</td></tr>`;
	});
}

function loadGlobalHistory() {
	setupGlobalHistoryListener();
}

async function deleteHistoryEntry(historyId, rawCreatedAt, profile, userCode) {
	if (!database) return;
	if (!confirm('이 히스토리 항목을 삭제하시겠습니까?\n프로필/사용자/전체 기록에서 모두 삭제됩니다.')) return;

	const deleteMatchingFrom = async (ref) => {
		let query;
		if (historyId) {
			query = ref.orderByChild('historyId').equalTo(historyId);
		} else if (rawCreatedAt !== null && rawCreatedAt !== undefined && rawCreatedAt !== '') {
			query = ref.orderByChild('createdAt').equalTo(rawCreatedAt);
		} else {
			return;
		}
		const snap = await query.once('value');
		const updates = {};
		snap.forEach(child => { updates[child.key] = null; });
		if (Object.keys(updates).length) await ref.update(updates);
	};

	try {
		const promises = [deleteMatchingFrom(database.ref('generateHistory'))];
		if (profile) promises.push(deleteMatchingFrom(database.ref(`profiles/${profile}/generateHistory`)));
		if (userCode) promises.push(deleteMatchingFrom(database.ref(`users/${userCode}/generateHistory`)));
		await Promise.all(promises);
		showToast('히스토리 삭제 완료');
	} catch (e) {
		showToast(`삭제 실패: ${e.message}`);
	}
}

function renderGlobalHistory() {
	const tbody = document.getElementById('globalHistoryTableBody');
	const subtitle = document.getElementById('historyViewSubtitle');
	if (!tbody) return;
	if (subtitle) subtitle.textContent = `전체 팀 생성 기록 (${globalHistoryData.length}건)`;
	if (!globalHistoryData.length) {
		tbody.innerHTML = '<tr><td colspan="8" class="gh-loading">생성 기록이 없습니다.</td></tr>';
		return;
	}
	tbody.innerHTML = globalHistoryData.map((item) => {
		const profileCell = item.profile
			? `<span class="gh-link" onclick="openItemFromHistory('profiles','${item.profile}')">${item.profile}</span>`
			: '-';
		const userCell = item.userCode
			? `<span class="gh-link" onclick="openItemFromHistory('users','${item.userCode}')">${item.userCode}</span>`
			: '-';
		const colorMap = item.appliedGroups?.length ? buildGroupNameColorMap(item.appliedGroups, item.appliedGroupColors) : null;
		return `
		<tr
			data-history-id="${escapeHtml(item.historyId)}"
			data-raw-created-at="${item.rawCreatedAt ?? ''}"
			data-profile="${escapeHtml(item.profile)}"
			data-user-code="${escapeHtml(item.userCode)}">
			<td class="gh-cell gh-date">${formatGlobalHistoryDate(item.createdAt)}</td>
			<td class="gh-cell gh-profile">${profileCell}</td>
			<td class="gh-cell gh-user">${userCell}</td>
			<td class="gh-cell gh-teams">${formatGlobalHistoryTeams(item.teams, colorMap)}</td>
			<td class="gh-cell">${formatGlobalHistoryList(item.appliedReservation)}</td>
			<td class="gh-cell">${formatGlobalHistoryList(item.appliedRules)}</td>
			<td class="gh-cell">${formatGlobalHistoryList(item.appliedConstraints)}</td>
			<td class="gh-cell gh-del"><button class="history-del-btn" type="button" data-role="delete-history">삭제</button></td>
		</tr>`;
	}).join('');
}

function showHistoryView() {
	const historyPanel = document.getElementById('historyViewPanel');
	const editorPanel = document.querySelector('.right-panel:not(.history-view-panel)');
	if (historyPanel) historyPanel.style.display = '';
	if (editorPanel) editorPanel.style.display = 'none';
	loadGlobalHistory();
}

function showEditorView() {
	const historyPanel = document.getElementById('historyViewPanel');
	const editorPanel = document.querySelector('.right-panel:not(.history-view-panel)');
	if (historyPanel) historyPanel.style.display = 'none';
	if (editorPanel) editorPanel.style.display = '';
}

function bindHistoryNav() {
	const navBtn = document.getElementById('historyNavBtn');
	if (navBtn) navBtn.addEventListener('click', showHistoryView);
	const refreshBtn = document.getElementById('historyRefreshBtn');
	if (refreshBtn) refreshBtn.addEventListener('click', loadGlobalHistory);
}

async function bootstrap() {
	if (!guardAdminAccess()) {
		return;
	}
	initFirebase();
	initAccordion();
	initTheme();
	bindEvents();
	bindNewProfileModal();
	bindHistoryNav();
	setButtonsEnabled(false);
	setEditorHeader();
	loadLists();
	showHistoryView();
}

bootstrap().catch((error) => {
	showToast(`초기화 실패: ${error.message}`);
});
