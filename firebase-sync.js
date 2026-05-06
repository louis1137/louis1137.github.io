// ==================== 실시간 동기화 시스템 ====================

// Firebase 설정
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

let firebaseApp = null;
let database = null;
let currentProfileKey = null;
let currentProfileSource = 'profiles';
let currentUserCode = null;
let syncEnabled = false;
let authenticatedPassword = ''; // 인증된 비밀번호 저장

const GLOBAL_APP_PASSWORD_PATH = 'admin/password';
const DEFAULT_GLOBAL_APP_PASSWORD = 'admin1234';

function normalizeReservations(value) {
	// group: 이름 배열 ["a","b"]
	const toGroup = (item) => {
		if (Array.isArray(item)) {
			return item.map((n) => String(n ?? '').trim()).filter((n) => n.length > 0);
		}
		if (typeof item === 'string') {
			return item.split(',').map((n) => n.trim()).filter((n) => n.length > 0);
		}
		return [];
	};
	// batch: 그룹 배열. 반환값은 항상 [group1, group2, ...]
	const toBatch = (item) => {
		if (Array.isArray(item)) {
			if (item.length > 0 && Array.isArray(item[0])) {
				// 이미 다중 그룹 배치: [["a","b"],["c","d"]]
				return item.map(toGroup).filter((g) => g.length > 0);
			}
			// 하위 호환: 단일 그룹 평면 배열 ["a","b"]
			const group = toGroup(item);
			return group.length > 0 ? [group] : [];
		}
		if (typeof item === 'string') {
			// "/" 구분자로 다중 그룹 지원: "a,b / c,d"
			return item.split('/').map((part) =>
				part.split(',').map((n) => n.trim()).filter((n) => n.length > 0)
			).filter((g) => g.length > 0);
		}
		return [];
	};
	if (Array.isArray(value)) {
		return value.map(toBatch).filter((batch) => batch.length > 0);
	}
	if (value && typeof value === 'object') {
		return Object.values(value).map(toBatch).filter((batch) => batch.length > 0);
	}
	return [];
}

function setCurrentProfileSource(source) {
	if (source === 'users' || source === 'profiles') {
		currentProfileSource = source;
		return;
	}
	currentProfileSource = 'profiles';
}

function getCurrentProfileSource() {
	return currentProfileSource;
}

function getGlobalAppPassword() {
	if (!database) {
		return Promise.resolve(DEFAULT_GLOBAL_APP_PASSWORD);
	}
	return database.ref(GLOBAL_APP_PASSWORD_PATH).once('value')
		.then((snapshot) => {
			const value = snapshot.val();
			if (typeof value === 'string' && value.length > 0) {
				return value;
			}
			return DEFAULT_GLOBAL_APP_PASSWORD;
		})
		.catch(() => DEFAULT_GLOBAL_APP_PASSWORD);
}

function setGlobalAppPassword(newPassword) {
	if (!database) {
		return Promise.reject(new Error('Firebase not initialized'));
	}
	const nextPassword = String(newPassword ?? '');
	return database.ref(GLOBAL_APP_PASSWORD_PATH).set(nextPassword)
		.then(() => nextPassword);
}

function resolveProfileRecord(profileKey) {
	if (!database || !profileKey) {
		return Promise.resolve({ exists: false, source: 'profiles', data: null });
	}

	return Promise.all([
		database.ref(`profiles/${profileKey}`).once('value'),
		database.ref(`users/${profileKey}`).once('value')
	]).then(([profileSnapshot, userSnapshot]) => {
		const profileData = profileSnapshot.val();
		const userData = userSnapshot.val();

		if (profileData !== null) {
			setCurrentProfileSource('profiles');
			return { exists: true, source: 'profiles', data: profileData };
		}

		if (userData !== null) {
			setCurrentProfileSource('users');
			return { exists: true, source: 'users', data: userData };
		}

		setCurrentProfileSource('profiles');
		return { exists: false, source: 'profiles', data: null };
	});
}

// 영숫자 코드 생성 (len 자리)
function generateCode(len) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let code = '';
	for (let i = 0; i < len; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

function generateUserCode() { return generateCode(6); }

// 프로필 토큰이 없으면 생성하여 저장 + 역방향 조회 테이블에도 기록
function ensureProfileToken(profileKey) {
	if (!database || !profileKey) return Promise.resolve(null);
	const ref = database.ref(`profiles/${profileKey}/token`);
	return ref.once('value').then((snap) => {
		const existing = snap.val();
		if (existing) {
			// 역방향 테이블 보장
			database.ref(`profileTokens/${existing}`).set(profileKey).catch(() => {});
			return existing;
		}
		const token = generateCode(12);
		return Promise.all([
			ref.set(token),
			database.ref(`profileTokens/${token}`).set(profileKey)
		]).then(() => token);
	});
}

// userCode 가져오기/생성 (localStorage key: userCode)
function getUserCode() {
	const storageKey = 'userCode';
	let userCode = localStorage.getItem(storageKey);

	// 이전 키 마이그레이션
	if (!userCode) {
		const legacyUserCode = localStorage.getItem('teamMakerUserCode');
		if (legacyUserCode) {
			userCode = legacyUserCode;
			localStorage.setItem(storageKey, userCode);
			localStorage.removeItem('teamMakerUserCode');
		}
	}

	if (!userCode) {
		userCode = generateUserCode();
		localStorage.setItem(storageKey, userCode);
	}

	return userCode;
}

// DB 저장용 타임스탬프 포맷: YYYY-MM-DD HH:mm:ss
function getCurrentDbTimestamp() {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');
	const seconds = String(now.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// onDisconnect 핸들 (임시 user 레코드 자동 삭제용)
let _userDisconnectHandle = null;

// 비프로필 유저 임시 레코드 생성 + onDisconnect 설정
function ensureUserRecord() {
	if (!database || !currentUserCode || currentProfileKey) return Promise.resolve(false);
	const userRef = database.ref(`users/${currentUserCode}`);
	const now = getCurrentDbTimestamp();

	return userRef.once('value')
		.then((snapshot) => {
			if (!snapshot.exists()) {
				// 신규 접속: 임시 레코드 생성 + 연결 끊기면 서버에서 자동 삭제
				return userRef.set({ createdAt: now, lastAccess: now, confirmed: false })
					.then(() => {
						_userDisconnectHandle = userRef.onDisconnect();
						_userDisconnectHandle.remove();
						setOnlinePresence();
						setupUserSync();
					});
			}
			const data = snapshot.val();

			// 토큰 모드 잔여 데이터 — 참가자/설정 모두 초기화하고 새 세션 시작
			if (data._fromTokenMode) {
				return userRef.set({ createdAt: data.createdAt || now, lastAccess: now, confirmed: false })
					.then(() => {
						_userDisconnectHandle = userRef.onDisconnect();
						_userDisconnectHandle.remove();
						setOnlinePresence();
						setupUserSync();
					});
			}

			// admin이 저장한 게임 데이터가 있으면 로드
			const hasGameData = data.people || data.inactivePeople || data.hiddenGroupChains ||
				data.hiddenGroups || data.forbiddenPairs || data.requiredGroups || data.reservations;
			if (hasGameData && typeof loadStateFromData === 'function') {
				loadStateFromData(data);
			}
			if (!data.confirmed) {
				// 미확정 상태로 재접속 (예: 새로고침): onDisconnect 재등록
				_userDisconnectHandle = userRef.onDisconnect();
				_userDisconnectHandle.remove();
				setOnlinePresence();
				setupUserSync();
				return userRef.update({ lastAccess: now });
			}
			// 팀 생성 이력이 있는 확정 유저: lastAccess만 갱신
			setOnlinePresence();
			setupUserSync();
			return userRef.update({ lastAccess: now });
		})
		.catch((error) => {
			console.error('❌ user 레코드 저장 실패:', error);
		});
}

// 팀 생성 시 호출 — onDisconnect 취소하여 레코드 영구 보존
function confirmUserRecord() {
	if (_userDisconnectHandle) {
		// cancel()은 해당 경로 및 모든 하위 경로의 onDisconnect를 취소함
		// → online 필드의 onDisconnect도 함께 취소되므로 아래에서 재등록 필요
		_userDisconnectHandle.cancel().then(() => {
			if (!database || !currentUserCode || currentProfileKey) return;
			// 부모 remove 취소 후 online 필드 onDisconnect 재등록
			database.ref(`users/${currentUserCode}/online`).onDisconnect().remove().catch(() => {});
		}).catch(() => {});
		_userDisconnectHandle = null;
	}
	if (!database || !currentUserCode || currentProfileKey) return;
	database.ref(`users/${currentUserCode}`).update({ confirmed: true }).catch(() => {});
}

// 현재 접속 중 표시 (online: true + onDisconnect → false)
let _onlinePresenceRef = null;
let _userOnlineRef = null;

function setOnlinePresence() {
	if (!database) return;
	if (currentProfileKey) {
		const userCode = currentUserCode || getUserCode();
		// profiles 섹션 online 표시
		const profileRef = database.ref(`profiles/${currentProfileKey}`);
		profileRef.update({ online: true, onlineUser: userCode }).catch(() => {});
		profileRef.onDisconnect().update({ online: false, onlineUser: '' });
		_onlinePresenceRef = database.ref(`profiles/${currentProfileKey}/online`);
		// users 섹션에도 동일 userCode로 online 표시
		if (userCode) {
			_userOnlineRef = database.ref(`users/${userCode}/online`);
			_userOnlineRef.set(true).catch(() => {});
			_userOnlineRef.onDisconnect().set(false);
		}
	} else if (currentUserCode) {
		_onlinePresenceRef = database.ref(`users/${currentUserCode}/online`);
		// onDisconnect 먼저 서버에 등록한 뒤 set(true) — 순서 보장이 핵심
		_onlinePresenceRef.onDisconnect().remove().then(() => {
			_onlinePresenceRef && _onlinePresenceRef.set(true).catch(() => {});
		}).catch(() => {});
	}
}

function clearOnlinePresence() {
	// 프로필 online만 해제 (users online은 유지 — 로그아웃 후에도 사이트에 남아있음)
	if (_onlinePresenceRef) {
		_onlinePresenceRef.set(false).catch(() => {});
		_onlinePresenceRef.onDisconnect().cancel().catch(() => {});
		_onlinePresenceRef = null;
	}
	if (currentProfileKey && database) {
		database.ref(`profiles/${currentProfileKey}`).update({ online: false, onlineUser: '' }).catch(() => {});
	}
	_userOnlineRef = null;
}

// URL 파라미터에서 key 읽기 (레거시 - 더 이상 사용하지 않음)
function getProfileKeyFromURL() {
	const params = new URLSearchParams(window.location.search);
	return params.get('key');
}

// ==================== 프로필 로그인 세션 ====================
const PROFILE_SESSION_KEY = 'profileLoginUsername';

function getSessionProfile() {
	try { return sessionStorage.getItem(PROFILE_SESSION_KEY) || null; } catch (_) { return null; }
}

function setSessionProfile(username) {
	try { sessionStorage.setItem(PROFILE_SESSION_KEY, username); } catch (_) {}
}

function clearSessionProfile() {
	try { sessionStorage.removeItem(PROFILE_SESSION_KEY); } catch (_) {}
}

// 프로필 로그인: Firebase에서 비밀번호 검증 후 세션 설정
function loginProfile(username, password) {
	if (!database || !username) return Promise.resolve({ ok: false, error: 'Firebase가 초기화되지 않았습니다.' });
	const u = String(username).trim();
	if (!u) return Promise.resolve({ ok: false, error: '아이디를 입력하세요.' });
	return database.ref(`profiles/${u}/password`).once('value')
		.then((snapshot) => {
			const stored = snapshot.val();
			if (stored === null || stored === undefined) {
				return { ok: false, error: '존재하지 않는 아이디입니다.' };
			}
			if (String(stored) !== String(password)) {
				return { ok: false, error: '비밀번호가 올바르지 않습니다.' };
			}
			setSessionProfile(u);
			currentProfileKey = u;
			setCurrentProfileSource('profiles');
			authenticatedPassword = String(password);
			return { ok: true, username: u };
		})
		.catch(() => ({ ok: false, error: '로그인 중 오류가 발생했습니다.' }));
}

// 프로필 로그아웃
function logoutProfile() {
	clearSessionProfile();
	currentProfileKey = null;
	authenticatedPassword = '';
	syncEnabled = false;
	syncListenerAttached = false;
	realtimeSyncActive = false;
	syncTriggerInitialized = false;
	lastSyncSignature = '';
}

// Firebase 초기화
function initFirebase() {
	try {
		// 이미 초기화되었는지 확인
		if (database) {
			if (!currentUserCode) currentUserCode = getUserCode();
			return true;
		}

		if (typeof firebase !== 'undefined') {
			firebaseApp = firebase.initializeApp(firebaseConfig);
			database = firebase.database();
			const originalRef = database.ref.bind(database);
			database.ref = (path) => {
				if (typeof path !== 'string') return originalRef(path);
				if (currentProfileKey) {
					const profilePrefix = `profiles/${currentProfileKey}`;
					if (currentProfileSource === 'users') {
						if (path === profilePrefix) {
							return originalRef(`users/${currentProfileKey}`);
						}
						if (path.startsWith(`${profilePrefix}/`)) {
							return originalRef(`users/${currentProfileKey}/${path.slice(profilePrefix.length + 1)}`);
						}
					}
				}
				return originalRef(path);
			};
			console.log('✅ Firebase 초기화 완료');
			console.log('⚙️ 참가자 입력란에 \'cmd\' 또는 \'command\'를 입력하면 다양한 기능을 사용할 수 있습니다.');

			// 세션에서 로그인된 프로필 키 읽기
			currentProfileKey = getSessionProfile();
			setCurrentProfileSource('profiles');
			currentUserCode = getUserCode();

			// 비프로필 유저: 임시 레코드 생성은 init() 쪽에서 토큰 모드 여부 확인 후 호출

			return true;
		} else {
			console.log('⚠️ Firebase 설정이 필요합니다. firebase-sync.js의 firebaseConfig를 설정하세요.');
			return false;
		}
	} catch (error) {
		console.error('❌ Firebase 초기화 실패:', error);
		return false;
	}
}

// 실시간 동기화 활성화 상태
let realtimeSyncActive = false;
let lastSyncTrigger = 0;
let syncListenerAttached = false; // 리스너 중복 등록 방지
let syncTriggerInitialized = false;
let lastSyncSignature = '';

function getSyncSignature(syncTrigger) {
	if (syncTrigger && typeof syncTrigger === 'object') {
		if (syncTrigger.tick) {
			return `tick:${syncTrigger.tick}`;
		}
		return JSON.stringify(syncTrigger);
	}
	return String(syncTrigger ?? '');
}

// 실시간 동기화 설정 (프로필 로그인 상태에서만 동작)
function setupRealtimeSync() {
	if (!database || !currentProfileKey) return;

	// 이미 리스너가 등록되어 있으면 중복 등록 방지
	if (syncListenerAttached) return;

	// 이미 데이터가 로드된 경우에는 초기화하지 않음 (people이 없어도 분리/예약 등이 있을 수 있음)
	const _hasAnyData = (state.people && state.people.length > 0)
		|| (state.pendingConstraints && state.pendingConstraints.length > 0)
		|| (state.forbiddenPairs && state.forbiddenPairs.length > 0)
		|| (state.reservations && state.reservations.length > 0)
		|| (state.hiddenGroups && state.hiddenGroups.length > 0)
		|| (state.hiddenGroupChains && state.hiddenGroupChains.length > 0);
	if (!_hasAnyData) {
		clearState();
	}

	realtimeSyncActive = true;
	syncListenerAttached = true;

	const triggerPaths = [
		`profiles/${currentProfileKey}/syncTrigger`,
		`users/${currentProfileKey}/syncTrigger`
	];

	const handleSyncTrigger = (syncTrigger) => {
		const signature = getSyncSignature(syncTrigger);
		const hasChanged = Boolean(syncTrigger) && signature !== lastSyncSignature;
		const hasTick = Boolean(syncTrigger && typeof syncTrigger === 'object' && syncTrigger.tick);
		if ((syncTriggerInitialized || hasTick) && syncTrigger && hasChanged) {
			const syncType = typeof syncTrigger === 'object' ? syncTrigger.type : 'all';
			if (typeof commandConsole !== 'undefined' && commandConsole.log) {
				commandConsole.log('🔄 동기화 중...');
			}
			loadDataByType(syncType)
				.then(() => {
					if (typeof commandConsole !== 'undefined' && commandConsole.log) {
						commandConsole.log('✅ 동기화가 완료되었습니다.');
					}
				})
				.catch((error) => {
					if (typeof commandConsole !== 'undefined' && commandConsole.error) {
						commandConsole.error(`동기화 실패: ${error.message}`);
					}
				});
		}
		lastSyncTrigger = syncTrigger;
		if (syncTrigger) {
			lastSyncSignature = signature;
		}
		syncTriggerInitialized = true;
	};

	// syncTrigger 감시 - 명시적으로 동기화 명령어를 실행했을 때만 감지
	triggerPaths.forEach((path) => {
		database.ref(path).on('value', (snapshot) => {
		const syncTrigger = snapshot.val();
			handleSyncTrigger(syncTrigger);
		});
	});
}

// 익명 유저 syncTrigger 감시 (admin이 users/${userCode}/syncTrigger 를 쓰면 데이터 재로드)
let _userSyncListenerAttached = false;
function setupUserSync() {
	if (!database || !currentUserCode || currentProfileKey || _userSyncListenerAttached) return;
	_userSyncListenerAttached = true;
	let initialized = false;
	database.ref(`users/${currentUserCode}/syncTrigger`).on('value', (snapshot) => {
		const trigger = snapshot.val();
		if (!initialized) {
			initialized = true;
			return; // 초기값은 무시
		}
		if (!trigger) return;
		const syncType = (trigger && typeof trigger === 'object' && trigger.type) ? trigger.type : 'all';
		loadDataByType(syncType);
	});
}

// 동기화 타입에 따라 선택적으로 데이터 로드
function loadDataByType(type) {
	if (!currentProfileKey && currentUserCode) {
		const userBase = `users/${currentUserCode}`;
		switch(type) {
			case 'rule':
				return Promise.all([
					database.ref(`${userBase}/hiddenGroups`).once('value'),
					database.ref(`${userBase}/hiddenGroupChains`).once('value'),
					database.ref(`${userBase}/pendingHiddenGroups`).once('value'),
					database.ref(`${userBase}/pendingHiddenGroupChains`).once('value'),
					database.ref(`${userBase}/probabilisticForbiddenPairs`).once('value')
				]).then(([hgSnap, hgcSnap, phgSnap, phgcSnap, pfpSnap]) => {
					state.hiddenGroups = hgSnap.val() || [];
					state.hiddenGroupChains = hgcSnap.val() || [];
					state.pendingHiddenGroups = phgSnap.val() || [];
					state.pendingHiddenGroupChains = phgcSnap.val() || [];
					state.probabilisticForbiddenPairs = pfpSnap.val() || [];
					state.activeProbabilisticForbiddenPairs = [];
				});

			case 'option':
				return Promise.all([
					database.ref(`${userBase}/maxTeamSizeEnabled`).once('value'),
					database.ref(`${userBase}/genderBalanceEnabled`).once('value'),
					database.ref(`${userBase}/weightBalanceEnabled`).once('value'),
					database.ref(`${userBase}/membersPerTeam`).once('value')
				]).then(([maxTeamSizeSnap, genderBalanceSnap, weightBalanceSnap, membersPerTeamSnap]) => {
					state.maxTeamSizeEnabled = maxTeamSizeSnap.val() || false;
					state.genderBalanceEnabled = genderBalanceSnap.val() || false;
					state.weightBalanceEnabled = weightBalanceSnap.val() || false;
					state.membersPerTeam = membersPerTeamSnap.val() || 4;
					if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = state.maxTeamSizeEnabled;
					if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = state.genderBalanceEnabled;
					if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = state.weightBalanceEnabled;
					if (elements.teamSizeInput) elements.teamSizeInput.value = state.membersPerTeam;
					renderPeople();
				});

			case 'member':
				return Promise.all([
					database.ref(`${userBase}/people`).once('value'),
					database.ref(`${userBase}/inactivePeople`).once('value'),
					database.ref(`${userBase}/nextId`).once('value')
				]).then(([peopleSnap, inactivePeopleSnap, nextIdSnap]) => {
					state.people = peopleSnap.val() || [];
					state.inactivePeople = inactivePeopleSnap.val() || [];
					state.nextId = nextIdSnap.val() || 1;
					buildForbiddenMap();
					renderPeople();
				});

			case 'constraint':
				return Promise.all([
					database.ref(`${userBase}/requiredGroups`).once('value'),
					database.ref(`${userBase}/forbiddenPairs`).once('value'),
					database.ref(`${userBase}/pendingConstraints`).once('value')
				]).then(([requiredGroupsSnap, forbiddenPairsSnap, pendingConstraintsSnap]) => {
					state.requiredGroups = requiredGroupsSnap.val() || [];
					state.forbiddenPairs = forbiddenPairsSnap.val() || [];
					state.pendingConstraints = pendingConstraintsSnap.val() || [];
					buildForbiddenMap();
					renderPeople();
				});

			case 'reservation':
				return database.ref(`${userBase}/reservations`).once('value')
					.then((snapshot) => {
						state.reservations = normalizeReservations(snapshot.val());
						saveToLocalStorage();
					});

			case 'all':
			default:
				return database.ref(userBase).once('value')
					.then((snapshot) => {
						const data = snapshot.val();
						if (data) {
							loadStateFromData(data);
						}
					});
		}
	}

	switch(type) {
		case 'rule':
			// 규칙만 로드
			return Promise.all([
				database.ref(`profiles/${currentProfileKey}/hiddenGroups`).once('value'),
				database.ref(`profiles/${currentProfileKey}/hiddenGroupChains`).once('value'),
				database.ref(`profiles/${currentProfileKey}/pendingHiddenGroups`).once('value'),
				database.ref(`profiles/${currentProfileKey}/pendingHiddenGroupChains`).once('value'),
				database.ref(`profiles/${currentProfileKey}/probabilisticForbiddenPairs`).once('value')
			]).then(([hiddenGroupsSnap, hiddenGroupChainsSnap, pendingHiddenGroupsSnap, pendingHiddenGroupChainsSnap, probabilisticForbiddenPairsSnap]) => {
				state.hiddenGroups = hiddenGroupsSnap.val() || [];
				state.hiddenGroupChains = hiddenGroupChainsSnap.val() || [];
				state.pendingHiddenGroups = pendingHiddenGroupsSnap.val() || [];
				state.pendingHiddenGroupChains = pendingHiddenGroupChainsSnap.val() || [];
				state.probabilisticForbiddenPairs = probabilisticForbiddenPairsSnap.val() || [];
				state.activeProbabilisticForbiddenPairs = [];
			});

		case 'option':
			// 옵션만 로드
			return Promise.all([
				database.ref(`profiles/${currentProfileKey}/maxTeamSizeEnabled`).once('value'),
				database.ref(`profiles/${currentProfileKey}/genderBalanceEnabled`).once('value'),
				database.ref(`profiles/${currentProfileKey}/weightBalanceEnabled`).once('value'),
				database.ref(`profiles/${currentProfileKey}/membersPerTeam`).once('value')
			]).then(([maxTeamSizeSnap, genderBalanceSnap, weightBalanceSnap, membersPerTeamSnap]) => {
				state.maxTeamSizeEnabled = maxTeamSizeSnap.val() || false;
				state.genderBalanceEnabled = genderBalanceSnap.val() || false;
				state.weightBalanceEnabled = weightBalanceSnap.val() || false;
				state.membersPerTeam = membersPerTeamSnap.val() || 4;

				if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = state.maxTeamSizeEnabled;
				if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = state.genderBalanceEnabled;
				if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = state.weightBalanceEnabled;
				if (elements.teamSizeInput) elements.teamSizeInput.value = state.membersPerTeam;

				// 옵션 변경에 따라 참가자 UI 업데이트
				renderPeople();
			});

		case 'member':
			// 참가자만 로드
			return Promise.all([
				database.ref(`profiles/${currentProfileKey}/people`).once('value'),
				database.ref(`profiles/${currentProfileKey}/inactivePeople`).once('value'),
				database.ref(`profiles/${currentProfileKey}/nextId`).once('value')
			]).then(([peopleSnap, inactivePeopleSnap, nextIdSnap]) => {
				state.people = peopleSnap.val() || [];
				state.inactivePeople = inactivePeopleSnap.val() || [];
				state.nextId = nextIdSnap.val() || 1;

				buildForbiddenMap();
				renderPeople();
			});

		case 'people':
			// 미참가자만 로드
			return database.ref(`profiles/${currentProfileKey}/inactivePeople`).once('value')
				.then((snapshot) => {
					state.inactivePeople = snapshot.val() || [];
					renderPeople();
				});

		case 'constraint':
			// 분리만 로드
			return Promise.all([
				database.ref(`profiles/${currentProfileKey}/requiredGroups`).once('value'),
				database.ref(`profiles/${currentProfileKey}/forbiddenPairs`).once('value'),
				database.ref(`profiles/${currentProfileKey}/pendingConstraints`).once('value')
			]).then(([requiredGroupsSnap, forbiddenPairsSnap, pendingConstraintsSnap]) => {
				state.requiredGroups = requiredGroupsSnap.val() || [];
				state.forbiddenPairs = forbiddenPairsSnap.val() || [];
				state.pendingConstraints = pendingConstraintsSnap.val() || [];

				buildForbiddenMap();
				renderPeople();
			});

		case 'reservation':
		// 예약만 로드 (동기화 예약 명령어로 실행된 경우)
		const oldReservationCount = state.reservations ? state.reservations.length : 0;
		return Promise.all([
			database.ref(`profiles/${currentProfileKey}/reservations`).once('value'),
			currentUserCode ? database.ref(`users/${currentUserCode}/reservations`).once('value') : Promise.resolve(null)
		]).then(([profileSnap, userSnap]) => {
				const newReservations = normalizeReservations(profileSnap.val());
				const newCount = newReservations.length;

				// 예약 개수가 변경된 경우 알림 표시
				if (oldReservationCount !== newCount) {
					if (newCount > oldReservationCount) {
						const addedCount = newCount - oldReservationCount;
						// 인증이 되었을 경우에만 메시지 표시
						if (authenticatedPassword && typeof commandConsole !== 'undefined' && commandConsole.log) {
								commandConsole.log(`📢 예약 ${addedCount}개가 추가되었습니다.`);
						}
					}
				}

				state.reservations = newReservations;
				state.userReservations = userSnap ? normalizeReservations(userSnap.val()) : [];
				saveToLocalStorage();
			});

		case 'all':
		default:
			// 전체 데이터 로드
			return Promise.all([
				database.ref(`profiles/${currentProfileKey}`).once('value'),
				currentUserCode ? database.ref(`users/${currentUserCode}/reservations`).once('value') : Promise.resolve(null)
			]).then(([profileSnap, userResSnap]) => {
					const data = profileSnap.val();
					if (data) {
						loadStateFromData(data);
					}
					state.userReservations = userResSnap ? normalizeReservations(userResSnap.val()) : [];
				});
	}
}

// 데이터에서 state 로드
function loadStateFromData(data) {
	state.people = data.people || [];
	state.inactivePeople = data.inactivePeople || [];
	state.requiredGroups = data.requiredGroups || [];
	state.nextId = data.nextId || 1;
	state.forbiddenPairs = data.forbiddenPairs || [];
	state.pendingConstraints = data.pendingConstraints || [];
	state.hiddenGroups = data.hiddenGroups || [];
	state.hiddenGroupChains = data.hiddenGroupChains || [];
	state.pendingHiddenGroups = data.pendingHiddenGroups || [];
	state.pendingHiddenGroupChains = data.pendingHiddenGroupChains || [];
	state.probabilisticForbiddenPairs = data.probabilisticForbiddenPairs || [];
	state.activeProbabilisticForbiddenPairs = [];
	state.reservations = normalizeReservations(data.reservations);
	state.userReservations = [];
	state.maxTeamSizeEnabled = data.maxTeamSizeEnabled || false;
	state.genderBalanceEnabled = data.genderBalanceEnabled || false;
	state.weightBalanceEnabled = data.weightBalanceEnabled || false;
	state.membersPerTeam = data.membersPerTeam || 4;

	// UI 업데이트
	if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = state.maxTeamSizeEnabled;
	if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = state.genderBalanceEnabled;
	if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = state.weightBalanceEnabled;
	if (elements.teamSizeInput) elements.teamSizeInput.value = state.membersPerTeam;

	buildForbiddenMap();
	renderPeople();
	if (typeof tryResolvePendingConstraints === 'function') tryResolvePendingConstraints();
	if (typeof tryResolveHiddenGroups === 'function') tryResolveHiddenGroups();

	// 이 세션의 셔플된 groupColors를 Firebase에 즉시 기록 (admin 실시간 동기화용)
	// syncTrigger를 건드리지 않으므로 토큰 루프 없음. 토큰 모드(읽기 전용)는 건너뜀.
	if (database && !_readOnlyMode) {
		const ref = currentProfileKey
			? database.ref(`profiles/${currentProfileKey}/groupColors`)
			: (currentUserCode ? database.ref(`users/${currentUserCode}/groupColors`) : null);
		if (ref) ref.set(state.groupColors).catch(() => {});
	}
}

// state를 완전 초기화
function clearState() {
	state.people = [];
	state.inactivePeople = [];
	state.requiredGroups = [];
	state.nextId = 1;
	state.forbiddenPairs = [];
	state.pendingConstraints = [];
	state.forbiddenMap = {};
	state.hiddenGroups = [];
	state.hiddenGroupChains = [];
	state.pendingHiddenGroups = [];
	state.pendingHiddenGroupChains = [];
	state.probabilisticForbiddenPairs = [];
	state.activeProbabilisticForbiddenPairs = [];
	state.reservations = [];
	state.activeHiddenGroupMap = {};
	state.activeHiddenGroupChainInfo = {};
	state.maxTeamSizeEnabled = false;
	state.genderBalanceEnabled = false;
	state.weightBalanceEnabled = false;
	state.membersPerTeam = 4;

	// UI 업데이트
	if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = false;
	if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = false;
	if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = false;
	if (elements.teamSizeInput) elements.teamSizeInput.value = 4;

	renderPeople();
}

// 페이지 로드 시 Firebase 초기화
initFirebase();
