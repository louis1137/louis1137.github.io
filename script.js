
// let console = window.console;
const teamDisplayDelay = isLocalView() ? 40 : 600;
const maxTimer = isLocalView() ? 0 : 5000;
const blindDelay = isLocalView() ? null : null;
// 검증 비교창 표시 여부 (true: 표시, false: 숨김)
const SHOW_VALIDATION_COMPARISON = isLocalView() ? false : false;
try { window.blindDelay = blindDelay; } catch (_) { /* no-op */ }

const state = {
	people: [],
	inactivePeople: [], // 미참가자 목록 (성별/가중치 저장)
	requiredGroups: [],
	forbiddenPairs: [], // [idA, idB] 형식의 배열
	forbiddenMap: {},   // forbiddenPairs에서 만들어진 빠른 조회용 맵
	pendingConstraints: [], // {left: 정규화, right: 정규화} 형식의 보류 분리 배열
	probabilisticForbiddenPairs: [], // {left: 정규화, right: 정규화, probability} 형식의 확률 분리
	hiddenGroups: [], // [idA, idB, probability] 형식의 배열 - 확률 기반 히든 그룹
	hiddenGroupChains: [], // [{primary: "이름", candidates: [{name: "이름", probability}]}] 형식 - 체이닝 히든 그룹 (규칙)
	activeHiddenGroupMap: {}, // 현재 팀 생성에서 활성화된 히든 그룹 맵 (임시)
	activeHiddenGroupChainInfo: {}, // 체이닝 정보 맵 { primaryId: { partnerId: probability } }
	activeProbabilisticForbiddenPairs: [], // 현재 팀 생성에서 활성화된 확률 분리 쌍
	pendingHiddenGroups: [], // {left: 정규화, right: 정규화, probability: 숫자} 형식의 보류 히든 그룹 배열
	pendingHiddenGroupChains: [], // [{primary: 정규화, candidates: [{name, probability}]}] 형식 - 보류 체이닝
	reservations: [], // [["A","B","C","D"], ["E","F"], ...] 형식의 예약 스택 (인덱스 0이 다음 사용될 예약)
	userReservations: [], // users/${currentUserCode}/reservations 에서 로드한 예약 스택 (프로필+유저 합산 소모용)
	genderBalanceEnabled: true,
	weightBalanceEnabled: false,
	maxTeamSizeEnabled: false,
	membersPerTeam: 4,
	nextId: 1,
	teamDisplayDelay,
	ungroupedColor: '#94a3b8',
	groupColors: [
		'#6FE5DD', // 밝은 아쿠아 틸
		'#FFB3BA', // 파스텔 코랄
		'#FFD93D', // 밝은 노랑
		'#6BCB77', // 신선한 초록
		'#A78BFA', // 부드러운 보라
		'#FD9843', // 따뜻한 오렌지
		'#FF1493', // 선명한 핑크
		'#38BDF8', // 연한 파랑
		'#34D399', // 민트 그린
		'#9900FF', // 순수한 보라
		'#5B7FBF', // 밝은 네이비
		'#0066ff'  // 코발트 블루
	]
};

const elements = {
	genderBalanceCheckbox: document.getElementById('genderBalanceCheckbox'),
	weightBalanceCheckbox: document.getElementById('weightBalanceCheckbox'),
	maxTeamSizeCheckbox: document.getElementById('maxTeamSizeCheckbox'),
	teamSizeInput: document.getElementById('teamSizeInput'),
	nameInput: document.getElementById('nameInput'),
	addPersonBtn: document.getElementById('addPersonBtn'),
	resetBtn: document.getElementById('resetBtn'),
	shuffleOrderBtn: document.getElementById('shuffleOrderBtn'),
	peopleList: document.getElementById('peopleList'),
	shuffleBtn: document.getElementById('shuffleBtn'),
	resultsSection: document.getElementById('results'),
	teamsDisplay: document.getElementById('teamsDisplay'),
	participantCount: document.querySelector('.participantCount'),
	captureBtn: document.getElementById('captureBtn'),
	captureButtonContainer: document.querySelector('.capture-button-container'),
	manageSeparationBtn: document.getElementById('manageSeparationBtn')
};

let captureSuccessTimer = null;
let editingPersonId = null;
let lastProfileConsoleMessage = '';
let lastProfileConsoleMessageAt = 0;
let isTeamGenerationInProgress = false;

function setTeamGenerationButtonState(isGenerating) {
	const btn = elements.shuffleBtn;
	if (!btn) return;

	if (isGenerating) {
		if (!btn.dataset.originalLabel) {
			btn.dataset.originalLabel = btn.textContent || '팀 생성';
		}
		btn.textContent = '팀 생성중...';
		btn.disabled = true;
		return;
	}

	btn.textContent = btn.dataset.originalLabel || '팀 생성';
	btn.disabled = false;
	delete btn.dataset.originalLabel;
}

function logProfileConsole(message) {
	const now = Date.now();
	if (message === lastProfileConsoleMessage && (now - lastProfileConsoleMessageAt) < 1500) {
		return;
	}
	lastProfileConsoleMessage = message;
	lastProfileConsoleMessageAt = now;
	commandConsole.log(message);
}

// ==================== 읽기 전용 모드 ====================
let _readOnlyMode = false;
let _readOnlyProfileKey = '';

// 체류시간 세션 트래킹
let _sessionHeartbeatInterval = null;
let _sessionProfileKey = null;
const _SESSION_EXPIRY_MS = 3000;
const _SESSION_HB_MS = 2000;

function _sessionWriteHeartbeat() {
	const now = Date.now();
	if (database && currentUserCode) {
		database.ref(`users/${currentUserCode}/heartbeat`).set(now).catch(() => {});
	}
	if (database && _sessionProfileKey) {
		database.ref(`profiles/${_sessionProfileKey}/heartbeat`).set(now).catch(() => {});
	}
}

function startUserSession() {
	if (!database || !currentUserCode) return;
	const userRef = database.ref(`users/${currentUserCode}`);
	const now = Date.now();

	let sessionStart = now;
	try {
		const storedStart = localStorage.getItem('_uSessionStart');
		const storedHb = localStorage.getItem('_uSessionHb');
		if (storedStart && storedHb) {
			const hbTime = parseInt(storedHb, 10);
			if (!isNaN(hbTime) && (now - hbTime) <= _SESSION_EXPIRY_MS) {
				sessionStart = parseInt(storedStart, 10) || now;
			}
		}
	} catch (_) {}

	try {
		localStorage.setItem('_uSessionStart', String(sessionStart));
		localStorage.setItem('_uSessionHb', String(now));
	} catch (_) {}

	userRef.update({ sessionStart, heartbeat: now }).catch(() => {});

	if (!_sessionHeartbeatInterval) {
		_sessionHeartbeatInterval = setInterval(() => {
			_sessionWriteHeartbeat();
			if (_sessionProfileKey) {
				try { localStorage.setItem(`_pSessionHb_${_sessionProfileKey}`, String(Date.now())); } catch (_) {}
			}
			try { localStorage.setItem('_uSessionHb', String(Date.now())); } catch (_) {}
		}, _SESSION_HB_MS);
	}
}

function startProfileSession(profileKey, type) {
	if (!database || !profileKey) return;
	_sessionProfileKey = profileKey;
	const now = Date.now();

	const lsStartKey = `_pSessionStart_${profileKey}`;
	const lsHbKey = `_pSessionHb_${profileKey}`;
	let sessionStart = now;
	try {
		const storedStart = localStorage.getItem(lsStartKey);
		const storedHb = localStorage.getItem(lsHbKey);
		if (storedStart && storedHb) {
			const hbTime = parseInt(storedHb, 10);
			if (!isNaN(hbTime) && (now - hbTime) <= _SESSION_EXPIRY_MS) {
				sessionStart = parseInt(storedStart, 10) || now;
			}
		}
	} catch (_) {}

	try {
		localStorage.setItem(lsStartKey, String(sessionStart));
		localStorage.setItem(lsHbKey, String(now));
	} catch (_) {}

	database.ref(`profiles/${profileKey}`).update({
		sessionStart,
		sessionType: type,
		heartbeat: now
	}).catch(() => {});

	if (!_sessionHeartbeatInterval) {
		_sessionHeartbeatInterval = setInterval(() => {
			_sessionWriteHeartbeat();
			if (_sessionProfileKey) {
				try { localStorage.setItem(`_pSessionHb_${_sessionProfileKey}`, String(Date.now())); } catch (_) {}
			}
			try { localStorage.setItem('_uSessionHb', String(Date.now())); } catch (_) {}
		}, _SESSION_HB_MS);
	}
}

function stopProfileSession(profileKey) {
	if (!database || !profileKey) return;
	_sessionProfileKey = null;
	try {
		localStorage.removeItem(`_pSessionStart_${profileKey}`);
		localStorage.removeItem(`_pSessionHb_${profileKey}`);
	} catch (_) {}
	database.ref(`profiles/${profileKey}`).update({
		sessionStart: null,
		sessionType: null,
		heartbeat: null
	}).catch(() => {});
}

function enterReadOnlyMode(profileKey, data) {
	_readOnlyMode = true;
	_readOnlyProfileKey = profileKey || '';
	if (data && typeof loadStateFromData === 'function') loadStateFromData(data);
	// 토큰 모드에서도 유저 예약 병행 로드
	if (database && currentUserCode) {
		database.ref(`users/${currentUserCode}/reservations`).once('value')
			.then((snap) => { state.userReservations = normalizeReservations(snap.val()); })
			.catch(() => {});
	}
	updateLoginUI();
	setupTokenSync();
	if (database && profileKey) {
		const userCode = currentUserCode || '';
		database.ref(`profiles/${profileKey}`).update({ tokenOnline: true, tokenOnlineUser: userCode }).catch(() => {});
		database.ref(`profiles/${profileKey}/tokenOnline`).onDisconnect().remove().catch(() => {});
		database.ref(`profiles/${profileKey}/tokenOnlineUser`).onDisconnect().remove().catch(() => {});
		if (userCode) {
			const userOnlineRef = database.ref(`users/${userCode}/online`);
			userOnlineRef.onDisconnect().remove().then(() => {
				userOnlineRef.set(true).catch(() => {});
			}).catch(() => {});
		}
	}
}

let _tokenSyncAttached = false;
function setupTokenSync() {
	if (!database || !_readOnlyProfileKey || _tokenSyncAttached) return;
	_tokenSyncAttached = true;
	let initialized = false;
	database.ref(`profiles/${_readOnlyProfileKey}/syncTrigger`).on('value', (snapshot) => {
		const trigger = snapshot.val();
		if (!initialized) { initialized = true; return; }
		if (!trigger) return;
		const syncType = (trigger && typeof trigger === 'object' && trigger.type) ? trigger.type : 'all';
		// loadDataByType은 currentProfileKey 기반으로 동작하므로 임시로 설정 후 복원
		// 토큰 모드는 읽기 전용이므로 이 사이에 쓰기가 발생하지 않아 안전
		const prev = currentProfileKey;
		currentProfileKey = _readOnlyProfileKey;
		loadDataByType(syncType).finally(() => {
			currentProfileKey = prev;
		});
	});
}

function exitReadOnlyMode() {
	if (_readOnlyMode && _readOnlyProfileKey) stopProfileSession(_readOnlyProfileKey);
	if (database && _readOnlyProfileKey) {
		const tokenOnlineRef = database.ref(`profiles/${_readOnlyProfileKey}/tokenOnline`);
		const tokenOnlineUserRef = database.ref(`profiles/${_readOnlyProfileKey}/tokenOnlineUser`);
		tokenOnlineRef.onDisconnect().cancel().catch(() => {});
		tokenOnlineUserRef.onDisconnect().cancel().catch(() => {});
		tokenOnlineRef.remove().catch(() => {});
		tokenOnlineUserRef.remove().catch(() => {});
	}
	_readOnlyMode = false;
	_readOnlyProfileKey = '';
	_tokenSyncAttached = false;
	history.replaceState({}, '', window.location.pathname);

	// 토큰 모드 해제 시 프로필의 옵션값을 기본으로 초기화
	// (이후 프로필 로그인이 되면 loadStateFromData가 덮어쓰고, 아니면 빈 상태 유지)
	state.maxTeamSizeEnabled = false;
	state.genderBalanceEnabled = true;
	state.weightBalanceEnabled = false;
	state.membersPerTeam = 4;
	if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = false;
	if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = true;
	if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = false;
	if (elements.teamSizeInput) elements.teamSizeInput.value = 4;
}

async function initTokenMode() {
	const params = new URLSearchParams(window.location.search);
	const token = params.get('token');
	if (!token) return false;

	// 자동로그인이 설정되어 있으면 토큰 사용을 건너뛰고 URL 파라미터만 제거.
	// 자동로그인이 URL 파라미터를 정리하므로 토큰 사용은 의미가 없음.
	let savedAutoLogin = null;
	try { savedAutoLogin = JSON.parse(localStorage.getItem('profileAutoLogin') || 'null'); } catch (_) {}
	if (savedAutoLogin && savedAutoLogin.username && savedAutoLogin.password) {
		history.replaceState({}, '', window.location.pathname);
		return false;
	}

	if (!database && typeof initFirebase === 'function') initFirebase();
	if (!database) return false;

	try {
		// profileTokens/${token} → profileKey 역방향 조회
		const tokenSnap = await database.ref(`profileTokens/${token}`).once('value');
		const profileKey = tokenSnap.val();
		if (!profileKey) return false;

		// 해당 프로필 데이터 읽기
		const profileSnap = await database.ref(`profiles/${profileKey}`).once('value');
		const profileData = profileSnap.val();
		if (!profileData) return false;

		enterReadOnlyMode(profileKey, profileData);
		startProfileSession(profileKey, 'token');
		startUserSession();

		// 프로필 데이터를 유저 레코드에 즉시 동기화 — admin users 탭에서 실시간으로 보이도록
		if (currentUserCode && database) {
			saveToLocalStorage(0);
		}

		return true;
	} catch (e) {
		console.error('토큰 모드 로드 실패:', e);
		return false;
	}
}

function init() {
	if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.addEventListener('change', handleGenderBalanceToggle);
	if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.addEventListener('change', handleWeightBalanceToggle);
	if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.addEventListener('change', handleMaxTeamSizeToggle);
	if (elements.teamSizeInput) elements.teamSizeInput.addEventListener('change', handleTeamSizeChange);
	if (elements.addPersonBtn) elements.addPersonBtn.addEventListener('click', addPerson);
	if (elements.resetBtn) elements.resetBtn.addEventListener('click', (e) => resetAll(e));
	if (elements.shuffleOrderBtn) elements.shuffleOrderBtn.addEventListener('click', shuffleOrder);
	if (elements.manageSeparationBtn) elements.manageSeparationBtn.addEventListener('click', openForbiddenWindow);
	if (elements.nameInput) {
		elements.nameInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') addPerson();
		});
		// 실시간 중복 체크를 위한 input 이벤트 리스너
		elements.nameInput.addEventListener('input', () => {
			renderPeople();
		});
	}
	if (elements.shuffleBtn) elements.shuffleBtn.addEventListener('click', shuffleTeams);
	if (elements.captureBtn) {
		elements.captureBtn.addEventListener('click', captureResultsSection);
		// 호버 시 캡처 영역 하이라이트
		elements.captureBtn.addEventListener('mouseenter', () => {
			if (elements.resultsSection.classList.contains('visible')) elements.resultsSection.classList.add('capture-highlight');
		});
		elements.captureBtn.addEventListener('mouseleave', () => {
			elements.resultsSection.classList.remove('capture-highlight');
		});
	}

	// 참가자 관리 영역에서 Ctrl+C로 참가자 복사
	document.addEventListener('keydown', handleParticipantCopy);

	// 그룹 색상 팔레트는 세션당 한 번 랜덤 셔플
	shuffleGroupColorsOnce();

	// 팀 표시 애니메이션 시간: teamDisplayDelay의 50%로 설정
	setTeamAnimDurationFromDelay();

	// 비프로필: 빈 화면 시작. ?token= 이 있으면 읽기 전용 로드, 없으면 자동로그인 + 임시 user 레코드 생성
	if (!currentProfileKey) {
		initTokenMode().then((isTokenMode) => {
			if (!isTokenMode) {
				tryAutoLogin();
				if (typeof ensureUserRecord === 'function') ensureUserRecord().then(() => startUserSession());
			}
		});
	} else if (database) {
		// 프로필이 있는 경우 Firebase에서 데이터 즉시 로드 (profiles + users 동시 확인)
		if (typeof setOnlinePresence === 'function') setOnlinePresence();
		resolveProfileRecord(currentProfileKey)
			.then((result) => {
				const data = result.data;
				if (data && (data.people || data.timestamp)) {
					loadStateFromData(data);
					console.log(commandConsoleMessages.comments.profileLoaded.replace('{profile}', currentProfileKey).replace('{count}', state.people.length));
				}
				// 유저 예약도 병행 로드 (프로필+유저 합산 소모용)
				if (currentUserCode && database) {
					database.ref(`users/${currentUserCode}/reservations`).once('value')
						.then((snap) => { state.userReservations = normalizeReservations(snap.val()); })
						.catch(() => {});
				}
				setupRealtimeSync();
			})
			.catch((error) => {
				console.error(`데이터 로드 실패: ${error.message}`);
			});
	}

	renderPeople();
	// 분리(금지) 쌍 맵 준비
	buildForbiddenMap();
	// 이전에 참가자가 추가되어 있다면 보류 중인 텍스트 분리을 해결 시도
	tryResolvePendingConstraints();
	// 이전에 참가자가 추가되어 있다면 보류 중인 히든 그룹을 해결 시도
	tryResolveHiddenGroups();

	// 분리 목록 확인 레이어 이벤트 리스너
	const constraintNotificationConfirm = document.getElementById('constraintNotificationConfirm');
	const constraintNotificationCancel = document.getElementById('constraintNotificationCancel');

	if (constraintNotificationConfirm) constraintNotificationConfirm.addEventListener('click', () => {
		hideConstraintNotification();
		safeOpenForbiddenWindow();
	});

	if (constraintNotificationCancel) constraintNotificationCancel.addEventListener('click', () => {
		// 분리 초기화
		state.forbiddenPairs = [];
		state.pendingConstraints = [];
		state.forbiddenMap = {};
		saveToLocalStorage();
		console.log(commandConsoleMessages.comments.constraintsCleared);
		hideConstraintNotification();
	});

	// 중복 확인 모달 이벤트 리스너
	const duplicateConfirmBtn = document.getElementById('duplicateConfirmBtn');
	const duplicateCancelBtn = document.getElementById('duplicateCancelBtn');
	if (duplicateConfirmBtn) duplicateConfirmBtn.addEventListener('click', handleDuplicateConfirm);
	if (duplicateCancelBtn) duplicateCancelBtn.addEventListener('click', handleDuplicateCancel);

	// 참가자 수정 모달 이벤트 리스너
	const editSaveBtn = document.getElementById('editPersonSaveBtn');
	const editCloseBtn = document.getElementById('editPersonCloseBtn');
	const editMaleBtn = document.getElementById('editGenderMale');
	const editFemaleBtn = document.getElementById('editGenderFemale');
	if (editSaveBtn) editSaveBtn.addEventListener('click', saveEditModal);
	if (editCloseBtn) editCloseBtn.addEventListener('click', closeEditModal);
	if (editMaleBtn) editMaleBtn.addEventListener('click', () => {
		editMaleBtn.classList.add('active');
		editFemaleBtn.classList.remove('active');
	});
	if (editFemaleBtn) editFemaleBtn.addEventListener('click', () => {
		editFemaleBtn.classList.add('active');
		editMaleBtn.classList.remove('active');
	});
	const editModal = document.getElementById('editPersonModal');
	if (editModal) {
		editModal.querySelector('.edit-modal-overlay').addEventListener('click', closeEditModal);
		editModal.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') closeEditModal();
			if (e.key === 'Enter') saveEditModal();
		});
	}

	// 로그인 모달 이벤트 리스너
	const loginTriggerBtn = document.getElementById('loginTriggerBtn');
	const loginSubmitBtn = document.getElementById('loginSubmitBtn');
	const loginCloseBtn = document.getElementById('loginCloseBtn');
	const logoutSubmitBtn = document.getElementById('logoutSubmitBtn');
	const logoutCloseBtn = document.getElementById('logoutCloseBtn');
	const profileLoginModal = document.getElementById('profileLoginModal');

	if (loginTriggerBtn) loginTriggerBtn.addEventListener('click', openLoginModal);
	if (loginSubmitBtn) loginSubmitBtn.addEventListener('click', handleLoginSubmit);
	if (loginCloseBtn) loginCloseBtn.addEventListener('click', closeLoginModal);
	if (logoutSubmitBtn) logoutSubmitBtn.addEventListener('click', handleLogout);
	if (logoutCloseBtn) logoutCloseBtn.addEventListener('click', closeLoginModal);
	if (profileLoginModal) {
		profileLoginModal.querySelector('.login-modal-overlay').addEventListener('click', closeLoginModal);
	}

	const loginPwInput = document.getElementById('loginPwInput');
	if (loginPwInput) {
		loginPwInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') handleLoginSubmit();
		});
	}
	const loginIdInput = document.getElementById('loginIdInput');
	if (loginIdInput) {
		loginIdInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				const pw = document.getElementById('loginPwInput');
				if (pw) pw.focus();
			}
		});
	}

	// 프로필 생성 모달 이벤트 리스너
	const signupTriggerBtn = document.getElementById('signupTriggerBtn');
	const signupSubmitBtn = document.getElementById('signupSubmitBtn');
	const signupCloseBtn = document.getElementById('signupCloseBtn');
	const profileSignupModal = document.getElementById('profileSignupModal');

	if (signupTriggerBtn) signupTriggerBtn.addEventListener('click', openSignupModal);
	if (signupSubmitBtn) signupSubmitBtn.addEventListener('click', handleSignupSubmit);
	if (signupCloseBtn) signupCloseBtn.addEventListener('click', closeSignupModal);
	if (profileSignupModal) {
		profileSignupModal.querySelector('.login-modal-overlay').addEventListener('click', closeSignupModal);
	}

	const signupIdInput = document.getElementById('signupIdInput');
	if (signupIdInput) {
		signupIdInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { const pw = document.getElementById('signupPwInput'); if (pw) pw.focus(); }
		});
	}
	const signupPwInput = document.getElementById('signupPwInput');
	if (signupPwInput) {
		signupPwInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { const pc = document.getElementById('signupPwConfirmInput'); if (pc) pc.focus(); }
		});
	}
	const signupPwConfirmInput = document.getElementById('signupPwConfirmInput');
	if (signupPwConfirmInput) {
		signupPwConfirmInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') handleSignupSubmit();
		});
	}

	// 비밀번호 변경 / 직접 로그아웃 버튼
	const passwordChangeTriggerBtn = document.getElementById('passwordChangeTriggerBtn');
	const logoutDirectBtn = document.getElementById('logoutDirectBtn');
	if (passwordChangeTriggerBtn) passwordChangeTriggerBtn.addEventListener('click', openPasswordChangeModal);
	if (logoutDirectBtn) logoutDirectBtn.addEventListener('click', handleLogout);

	const pwChangeSubmitBtn = document.getElementById('pwChangeSubmitBtn');
	const pwChangeCancelBtn = document.getElementById('pwChangeCancelBtn');
	const passwordChangeModal = document.getElementById('passwordChangeModal');
	if (pwChangeSubmitBtn) pwChangeSubmitBtn.addEventListener('click', handlePasswordChangeSubmit);
	if (pwChangeCancelBtn) pwChangeCancelBtn.addEventListener('click', closePasswordChangeModal);
	if (passwordChangeModal) {
		passwordChangeModal.querySelector('.login-modal-overlay').addEventListener('click', closePasswordChangeModal);
	}

	const profileDeleteTriggerBtn = document.getElementById('profileDeleteTriggerBtn');
	const profileDeleteConfirmBtn = document.getElementById('profileDeleteConfirmBtn');
	const profileDeleteCancelBtn = document.getElementById('profileDeleteCancelBtn');
	if (profileDeleteTriggerBtn) profileDeleteTriggerBtn.addEventListener('click', showDeleteConfirmSection);
	if (profileDeleteConfirmBtn) profileDeleteConfirmBtn.addEventListener('click', handleProfileDelete);
	if (profileDeleteCancelBtn) profileDeleteCancelBtn.addEventListener('click', hideDeleteConfirmSection);

	const deleteConfirmPwInput = document.getElementById('deleteConfirmPwInput');
	if (deleteConfirmPwInput) {
		deleteConfirmPwInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') handleProfileDelete();
		});
	}

	const pwChangeCurInput = document.getElementById('pwChangeCurrentInput');
	const pwChangeNewInput = document.getElementById('pwChangeNewInput');
	const pwChangeConfirmInput = document.getElementById('pwChangeConfirmInput');
	if (pwChangeCurInput) {
		pwChangeCurInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { if (pwChangeNewInput) pwChangeNewInput.focus(); }
		});
	}
	if (pwChangeNewInput) {
		pwChangeNewInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { if (pwChangeConfirmInput) pwChangeConfirmInput.focus(); }
		});
	}
	if (pwChangeConfirmInput) {
		pwChangeConfirmInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') handlePasswordChangeSubmit();
		});
	}

	// 초기 로그인 상태 UI 반영 (세션에 로그인 정보 있으면 표시)
	updateLoginUI();

	// 자동 로그인은 위쪽 initTokenMode().then() 분기에서 처리됨.
	// 중복 호출 시 initTokenMode와 병렬 실행되어 토큰/로그인이 동시에 활성화되는 문제 발생.

	// 개발자 도구가 열려있으면 cmd 콘솔 자동으로 열기
	checkDevToolsAndOpenConsole();
}

// 개발자 도구 감지 및 콘솔 자동 열기
function checkDevToolsAndOpenConsole() {
	const threshold = 160;
	const widthThreshold = window.outerWidth - window.innerWidth > threshold;
	const heightThreshold = window.outerHeight - window.innerHeight > threshold;
	const isDevToolsOpen = widthThreshold || heightThreshold;

	// 로컬 환경이면서 개발자 도구가 열려있을 때만 콘솔 자동 열기
	if (isLocalView() && isDevToolsOpen) {
		// 개발자 도구가 열려있으면 콘솔 자동 열기
		setTimeout(() => {
			const consoleEl = document.getElementById('commandConsole');
			if (consoleEl && consoleEl.style.display !== 'flex') {
				consoleEl.style.display = 'flex';
				consoleEl.style.transform = 'translate(0, 0)';
				consoleEl.style.width = '900px';
				consoleEl.style.height = '600px';

				const content = document.querySelector('.command-content');
				if (content) content.style.display = 'flex';
				const toggleBtn = document.getElementById('toggleConsoleBtn');
				if (toggleBtn) toggleBtn.textContent = '−';

				if (commandConsole.output) {
					if (currentProfileKey) {
						// 프로필이 있는 경우 - 이미 인증되었다면 비밀번호를 묻지 않음
						if (commandConsole.authenticated) {
							commandConsole.log(commandConsoleMessages.comments.profileConnectedAuth.replace('{profile}', currentProfileKey));
							commandConsole.log(commandConsoleMessages.comments.syncActivated);
							commandConsole.log(commandConsoleMessages.comments.consoleReady);
							setTimeout(() => commandConsole.input.focus(), 100);
						} else if (database) {
							// 아직 인증되지 않았다면 비밀번호 확인
							resolveProfileRecord(currentProfileKey)
								.then((result) => {
									if (!result.exists) {
										commandConsole.tempProfile = currentProfileKey;
										commandConsole.warn(commandConsoleMessages.comments.profileNotFoundInitial.replace('{profile}', currentProfileKey));
										commandConsole.log(commandConsoleMessages.comments.profileCreateNew.replace('{profile}', currentProfileKey));
										commandConsole.inputMode = 'profile-create-confirm';
										commandConsole.showConfirmButtons();
										return;
									}

									const data = result.data || {};
									const password = data.password || '';
									const isUsersSource = result.source === 'users';

									if (isUsersSource || password === '') {
										commandConsole.authenticated = true;
										commandConsole.storedPassword = '';
										authenticatedPassword = 'users-auto-auth';
										if (data && (data.people || data.timestamp)) {
											loadStateFromData(data);
										} else {
											logProfileConsole(`📡 프로필 '${currentProfileKey}' 로드됨 (초기 상태)`);
										}
										commandConsole.log('🔄 실시간 동기화 활성화됨');
										setupRealtimeSync();
										commandConsole.log(commandConsoleMessages.comments.consoleReady);
										setTimeout(() => commandConsole.input.focus(), 100);
									} else {
										commandConsole.storedPassword = password;
										commandConsole.authenticated = false;
										if (data && (data.people || data.timestamp)) {
											loadStateFromData(data);
											logProfileConsole(`📡 프로필 '${currentProfileKey}' 발견 (참가자: ${state.people.length}명)`);
										} else {
											logProfileConsole(`📡 프로필 '${currentProfileKey}' 발견 (초기 상태)`);
										}
										commandConsole.log('🔄 실시간 동기화 활성화됨');
										setupRealtimeSync();
										commandConsole.log(commandConsoleMessages.comments.passwordInputAsk);
										commandConsole.inputMode = 'password-ask-initial';
										commandConsole.showConfirmButtons();
									}
								})
								.catch((error) => {
									commandConsole.error(commandConsoleMessages.comments.dataLoadFailed + error.message);
								});
						}
					} else {
						// 프로필이 없는 경우: 자동 프롬프트 없이 일반 입력 모드 유지
						commandConsole.inputMode = 'normal';
						commandConsole.restoreInputField(false);
						commandConsole.input.placeholder = commandConsoleMessages.placeholders.input;
						setTimeout(() => commandConsole.input && commandConsole.input.focus(), 100);
					}
				}
			}
		}, 500);
	}
}

// 입력 내용에서 성별/가중치 패턴 감지하여 자동 체크
function autoDetectAndCheckOptions() {
	const text = elements.nameInput.value;

	// 패턴 감지 (괄호 안에 남/여가 있는지, 숫자가 있는지)
	const hasGenderPattern = text.includes('(남)') || text.includes('(여)') || /\(.*남.*\)/.test(text) || /\(.*여.*\)/.test(text);
	const hasWeightPattern = /\(\d+\)/.test(text) || /\(.*\d+.*\)/.test(text);

	// 성별 패턴이 있으면 성별균등 자동 체크
	if (hasGenderPattern && !state.genderBalanceEnabled) {
		if (elements.genderBalanceCheckbox) {
			elements.genderBalanceCheckbox.checked = true;
			state.genderBalanceEnabled = true;
			saveToLocalStorage();
		}
	}

	// 가중치 패턴이 있으면 가중치균등 자동 체크
	if (hasWeightPattern && !state.weightBalanceEnabled) {
		if (elements.weightBalanceCheckbox) {
			elements.weightBalanceCheckbox.checked = true;
			state.weightBalanceEnabled = true;
			saveToLocalStorage();
			// 가중치 입력 필드 표시
			const weightInputContainer = document.getElementById('weightInputContainer');
			if (weightInputContainer) {
				weightInputContainer.style.display = 'block';
			}
		}
	}
}

// 분리 목록 확인 레이어 표시
function showConstraintNotification() {
	const layer = document.getElementById('constraintNotificationLayer');
	if (layer) {
		layer.style.display = 'block';
		// 브라우저 리플로우를 위한 지연
		setTimeout(() => {
			layer.classList.add('visible');
			layer.classList.remove('hiding');
		}, 10);
	}
}

// 분리 목록 확인 레이어 숨김
function hideConstraintNotification() {
	const layer = document.getElementById('constraintNotificationLayer');
	if (layer) {
		layer.classList.remove('visible');
		layer.classList.add('hiding');
		// 애니메이션 완료 후 display: none
		setTimeout(() => {
			if (layer.classList.contains('hiding')) {
				layer.style.display = 'none';
				layer.classList.remove('hiding');
			}
		}, 300);
	}
}

// 중복 확인 모달 표시
function showDuplicateConfirmModal(duplicateNames) {
	const modal = document.getElementById('duplicateConfirmModal');
	const messageEl = document.getElementById('duplicateModalMessage');
	const existingListEl = document.getElementById('duplicateModalExisting');
	const newListEl = document.getElementById('duplicateModalNew');
	const confirmBtn = document.getElementById('duplicateConfirmBtn');
	const warningEl = document.getElementById('duplicateWarning');
	const arrowEl = document.querySelector('.duplicate-arrow');
	const existingSectionEl = existingListEl?.parentElement;

	if (!modal) return;

	// 입력 데이터 내에서 중복된 이름 검사
	const allNewNames = [];
	if (pendingAddData && pendingAddData.pendingNamesData) {
		pendingAddData.pendingNamesData.forEach(({ names }) => {
			names.forEach(name => {
				allNewNames.push(normalizeName(name));
			});
		});
	}

	// 중복 검사
	const nameCount = {};
	const duplicatesInInput = [];
	allNewNames.forEach(name => {
		nameCount[name] = (nameCount[name] || 0) + 1;
		if (nameCount[name] === 2) duplicatesInInput.push(name);
	});

	const hasInputDuplicates = duplicatesInInput.length > 0;

	// 입력 내 중복인 경우 기존 필드와 화살표 숨김/표시
	if (existingSectionEl) existingSectionEl.style.display = hasInputDuplicates ? 'none' : 'block';
	if (arrowEl) arrowEl.style.display = hasInputDuplicates ? 'none' : 'flex';

	// 기존 참가자 목록 표시
	existingListEl.innerHTML = '';
	const duplicateNormalized = duplicateNames.map(name => normalizeName(name));
	const duplicatePeople = state.people.filter(p => duplicateNormalized.includes(normalizeName(p.name)));

	// 그룹 정보 맵 생성
	const groupMap = new Map();
	state.requiredGroups.forEach((group, groupIndex) => {
		group.forEach(personId => {
			groupMap.set(personId, groupIndex);
		});
	});

	const { weightHighIds, weightLowIds } = computeWeightHighLow();

	// 이미 처리된 그룹 추적
	const processedGroups = new Set();

	// 기존 참가자 렌더링 (중복으로 영향받는 전체 그룹 표시)
	duplicatePeople.forEach(person => {
		const groupIndex = groupMap.get(person.id);

		if (groupIndex !== undefined && !processedGroups.has(groupIndex)) {
			// 그룹에 속한 경우 - 전체 그룹을 표시
			processedGroups.add(groupIndex);
			const group = state.requiredGroups[groupIndex];

			const groupContainer = document.createElement('div');
			groupContainer.className = 'style_group';
			const color = getGroupColor(groupIndex);
			groupContainer.style.border = `2px solid ${color}`;

			// 그룹의 모든 멤버를 표시 (중복된 사람은 진하게, 남을 사람은 연하게)
			group.forEach(personId => {
				const groupPerson = state.people.find(p => p.id === personId);
				if (groupPerson) {
					const personTag = createDuplicatePersonTag(groupPerson, weightHighIds, weightLowIds);
					const isDuplicate = duplicateNormalized.includes(normalizeName(groupPerson.name));
					if (isDuplicate) {
						// 중복된 사람 (바뀔 요소) - 진하게, 두꺼운 글씨
						personTag.style.opacity = '1';
						const nameSpan = personTag.querySelector('.name');
						if (nameSpan) nameSpan.style.fontWeight = 'bold';
					} else {
						// 남을 사람 - 연하게
						personTag.style.opacity = '0.5';
					}
					groupContainer.appendChild(personTag);
				}
			});

			existingListEl.appendChild(groupContainer);
		} else if (groupIndex === undefined) {
			// 그룹에 속하지 않은 개별 참가자
			const personTag = createDuplicatePersonTag(person, weightHighIds, weightLowIds);
			personTag.style.opacity = '1';
			const nameSpan = personTag.querySelector('.name');
			if (nameSpan) nameSpan.style.fontWeight = 'bold';
			existingListEl.appendChild(personTag);
		}
	});

	// 변경 필드: 영향받는 그룹들의 변화 + 새 그룹만 표시
	newListEl.innerHTML = '';
	if (pendingAddData && pendingAddData.pendingNamesData) {
		// 중복으로 영향받는 그룹 인덱스 찾기
		const affectedGroupIndices = new Set();
		duplicatePeople.forEach(person => {
			const groupIndex = groupMap.get(person.id);
			if (groupIndex !== undefined) affectedGroupIndices.add(groupIndex);
		});

		// 영향받는 그룹들이 어떻게 변하는지 보여주기 (연한 색상으로)
		affectedGroupIndices.forEach(groupIndex => {
			const group = state.requiredGroups[groupIndex];
			const remainingMembers = group.filter(personId => {
				const person = state.people.find(p => p.id === personId);
				return person && !duplicateNormalized.includes(normalizeName(person.name));
			});

			if (remainingMembers.length === 1) {
				// 1명만 남으면 개별 참가자로 표시
				const person = state.people.find(p => p.id === remainingMembers[0]);
				if (person) {
					const personTag = createDuplicatePersonTag(person, weightHighIds, weightLowIds);
					personTag.style.opacity = '0.5';
					newListEl.appendChild(personTag);
				}
			} else if (remainingMembers.length > 1) {
				// 2명 이상 남으면 그룹으로 표시
				const groupContainer = document.createElement('div');
				groupContainer.className = 'style_group';
				const color = getGroupColor(groupIndex);
				groupContainer.style.border = `2px solid ${color}`;
				groupContainer.style.opacity = '0.5';

				remainingMembers.forEach(personId => {
					const person = state.people.find(p => p.id === personId);
					if (person) {
						const personTag = createDuplicatePersonTag(person, weightHighIds, weightLowIds);
						groupContainer.appendChild(personTag);
					}
				});

				newListEl.appendChild(groupContainer);
			}
		});

		// 새로 추가될 그룹들 렌더링
		const usedColors = [];
		state.requiredGroups.forEach((group, idx) => {
			const color = getGroupColor(idx);
			if (color && color !== state.ungroupedColor) usedColors.push(color);
		});

		const previewColors = [];
		pendingAddData.pendingNamesData.forEach(({ names }, index) => {
			const colorIndex = pendingAddData.newGroupColorIndices ? pendingAddData.newGroupColorIndices[index] : -1;

			if (names.length > 1 && colorIndex >= 0) {
				// 그룹으로 등록될 경우 - 새로 추가되는 그룹은 진하게
				const groupContainer = document.createElement('div');
				groupContainer.className = 'style_group';
				const color = getGroupColor(colorIndex);
				groupContainer.style.border = `2px solid ${color}`; // border 전체를 설정
				previewColors.push(color);

				names.forEach(name => {
					// 이름에서 괄호 패턴 파싱
					let actualName = name;
					let parsedGender = 'male'; // 기본값: 남
					let parsedWeight = 0; // 기본값: 0

				const match = name.match(/^(.+?)\(([^)]+)\)$/);
				if (match) {
					actualName = match[1].trim();
					const content = match[2].trim();
					const numberMatch = content.match(/\d+/);
					const genderMatch = content.match(/[남여]/);
					if (numberMatch) parsedWeight = parseInt(numberMatch[0]);
					if (genderMatch) parsedGender = genderMatch[0] === '남' ? 'male' : 'female';
				} else {
					// 괄호가 없으면 기존 참가자나 inactivePeople에서 정보 가져오기
					const normalized = normalizeName(actualName);
					const existingPerson = state.people.find(p => normalizeName(p.name) === normalized);
					const inactivePerson = state.inactivePeople.find(p => normalizeName(p.name) === normalized);

					if (existingPerson) {
						parsedGender = existingPerson.gender;
						parsedWeight = existingPerson.weight ?? 0;
					} else if (inactivePerson) {
						parsedGender = inactivePerson.gender;
						parsedWeight = inactivePerson.weight ?? 0;
					}
				}

				const personTag = document.createElement('div');
				personTag.className = 'style_person';

				// 성별 배경색 (기본값 포함)
				if (state.genderBalanceEnabled) {
					personTag.style.backgroundColor = parsedGender === 'male' ? '#e0f2fe' : '#fce7f3';
				}

				const nameSpan = document.createElement('span');
				nameSpan.className = 'name';
				nameSpan.textContent = actualName;
				nameSpan.style.fontWeight = 'bold';
				personTag.appendChild(nameSpan);

				// 가중치 표시 (기본값 포함)
				if (state.weightBalanceEnabled) {
					const weightDisplay = document.createElement('span');
					weightDisplay.className = 'weight-display';
					weightDisplay.textContent = `(${parsedWeight})`;
					const matchedPerson = state.people.find(p => normalizeName(p.name) === normalizeName(actualName));
					if (matchedPerson && weightHighIds.has(matchedPerson.id)) weightDisplay.style.color = '#ef4444';
					else if (matchedPerson && weightLowIds.has(matchedPerson.id)) weightDisplay.style.color = '#3b82f6';
					else weightDisplay.style.color = '#999';
					personTag.appendChild(weightDisplay);
				}

				// 입력 데이터 내 중복된 이름이면 빨간 테두리와 pulse 애니메이션
				if (duplicatesInInput.includes(normalizeName(name))) {
					personTag.classList.add('is-duplicate');
				}

				groupContainer.appendChild(personTag);
			});

			newListEl.appendChild(groupContainer);
		} else {
			// 개별 참가자로 등록될 경우
			names.forEach(name => {
				// 이름에서 괄호 패턴 파싱
				let actualName = name;
				let parsedGender = 'male'; // 기본값: 남
				let parsedWeight = 0; // 기본값: 0

				const match = name.match(/^(.+?)\(([^)]+)\)$/);
				if (match) {
					actualName = match[1].trim();
					const content = match[2].trim();
					const numberMatch = content.match(/\d+/);
					const genderMatch = content.match(/[남여]/);
					if (numberMatch) parsedWeight = parseInt(numberMatch[0]);
					if (genderMatch) parsedGender = genderMatch[0] === '남' ? 'male' : 'female';
				} else {
					// 괄호가 없으면 기존 참가자나 inactivePeople에서 정보 가져오기
					const normalized = normalizeName(actualName);
					const existingPerson = state.people.find(p => normalizeName(p.name) === normalized);
					const inactivePerson = state.inactivePeople.find(p => normalizeName(p.name) === normalized);

					if (existingPerson) {
						parsedGender = existingPerson.gender;
						parsedWeight = existingPerson.weight ?? 0;
					} else if (inactivePerson) {
						parsedGender = inactivePerson.gender;
						parsedWeight = inactivePerson.weight ?? 0;
					}
			}

			const personTag = document.createElement('div');
			personTag.className = 'style_person';

			// 성별 배경색 (기본값 포함)
			if (state.genderBalanceEnabled) {
				personTag.style.backgroundColor = parsedGender === 'male' ? '#e0f2fe' : '#fce7f3';
			}

			const nameSpan = document.createElement('span');
			nameSpan.className = 'name';
			nameSpan.textContent = actualName;
			nameSpan.style.fontWeight = 'bold';
			personTag.appendChild(nameSpan);

		// 가중치 표시 (기본값 포함)
		if (state.weightBalanceEnabled) {
			const weightDisplay = document.createElement('span');
			weightDisplay.className = 'weight-display';
			weightDisplay.textContent = `(${parsedWeight})`;
			const matchedPerson = state.people.find(p => normalizeName(p.name) === normalizeName(actualName));
			if (matchedPerson && weightHighIds.has(matchedPerson.id)) weightDisplay.style.color = '#ef4444';
			else if (matchedPerson && weightLowIds.has(matchedPerson.id)) weightDisplay.style.color = '#3b82f6';
			else weightDisplay.style.color = '#999';
			personTag.appendChild(weightDisplay);
		}

		// 입력 데이터 내 중복된 이름이면 빨간 테두리와 pulse 애니메이션
		if (duplicatesInInput.includes(normalizeName(name))) {
			personTag.classList.add('is-duplicate');
		}

		newListEl.appendChild(personTag);
	});
}
});
// 미리보기에서 사용한 색상 배열 저장
pendingAddData.previewColors = previewColors;
	}

	// 메시지 업데이트 및 확인 버튼 상태 설정
	if (hasInputDuplicates) {
		// 입력 내 중복이 있는 경우
		// 기존 질문 메시지 숨김
		messageEl.style.display = 'none';
	} else {
		// 질문 메시지 표시
		messageEl.textContent = duplicateNames.length === 1 ? commandConsoleMessages.comments.removeDuplicateSingle : commandConsoleMessages.comments.removeDuplicateMultiple;
		messageEl.style.display = 'block';
	}
	// 경고 메시지 및 확인 버튼 상태를 삼항으로 설정
	if (warningEl) warningEl.style.display = hasInputDuplicates ? 'block' : 'none';
	if (warningEl && hasInputDuplicates) warningEl.innerHTML = `<strong>⚠️ 입력된 데이터에 중복된 이름이 있습니다!</strong>`;
	if (confirmBtn) {
		confirmBtn.disabled = !!hasInputDuplicates;
		confirmBtn.style.opacity = hasInputDuplicates ? '0.5' : '1';
		confirmBtn.style.cursor = hasInputDuplicates ? 'not-allowed' : 'pointer';
	}

	// 키보드 이벤트 리스너 추가
	document.addEventListener('keydown', handleDuplicateModalKeydown);

	// 모달 표시
	modal.style.display = 'flex';
	setTimeout(() => {
		modal.classList.add('visible');
	}, 10);
}

// 중복 모달용 person-tag 생성 (제거 버튼 없는 버전)
function createDuplicatePersonTag(person, weightHighIds = new Set(), weightLowIds = new Set()) {
	const personTag = document.createElement('div');
	personTag.className = 'style_person';

	if (state.genderBalanceEnabled) personTag.style.backgroundColor = person.gender === 'male' ? '#e0f2fe' : '#fce7f3';

	const nameSpan = document.createElement('span');
	nameSpan.className = 'name';
	nameSpan.textContent = person.name;
	personTag.appendChild(nameSpan);
	if (state.weightBalanceEnabled) {
		const weightDisplay = document.createElement('span');
		weightDisplay.className = 'weight-display';
		weightDisplay.textContent = `(${person.weight ?? 0})`;
		if (weightHighIds.has(person.id)) weightDisplay.style.color = '#ef4444';
		else if (weightLowIds.has(person.id)) weightDisplay.style.color = '#3b82f6';
		else weightDisplay.style.color = '#999';
		personTag.appendChild(weightDisplay);
	}

	return personTag;
}

// 중복 확인 모달 키보드 이벤트 핸들러
function handleDuplicateModalKeydown(e) {
	if (e.key === 'Enter') {
		e.preventDefault();
		handleDuplicateConfirm();
	} else if (e.key === 'Escape') {
		e.preventDefault();
		handleDuplicateCancel();
	}
}

// 중복 확인 모달 숨김
function hideDuplicateConfirmModal() {
	const modal = document.getElementById('duplicateConfirmModal');
	if (!modal) return;

	// 키보드 이벤트 리스너 제거
	document.removeEventListener('keydown', handleDuplicateModalKeydown);

	modal.classList.remove('visible');
	setTimeout(() => {
		modal.style.display = 'none';
	}, 300);
}

// 중복 확인 - 확인 버튼 처리
function handleDuplicateConfirm() {
	if (!pendingAddData) return;

	// 입력창 먼저 초기화 (실시간 하이라이트 제거를 위해)
	elements.nameInput.value = '';

	// 중복된 이름들을 제거하고 새로 등록 (미리 계산된 색상 인덱스 전달)
	processAddPerson(pendingAddData.pendingNamesData, pendingAddData.newGroupColorIndices);

	// 포커스
	elements.nameInput.focus();

	// 모달 숨김
	hideDuplicateConfirmModal();

	// 대기 데이터 초기화
	pendingAddData = null;
}

// 중복 확인 - 취소 버튼 처리
function handleDuplicateCancel() {
	// 폼 내용은 유지하고 모달만 닫음
	hideDuplicateConfirmModal();

	// 대기 데이터 초기화
	pendingAddData = null;

	// 포커스는 입력창에 유지
	elements.nameInput.focus();
}

let _profileAutoSaveTimer = null;

// localStorage에 저장
function saveToLocalStorage(delay = 1000) {
	try {
		const data = {
			people: state.people,
			inactivePeople: state.inactivePeople,
			requiredGroups: state.requiredGroups,
			nextId: state.nextId,
			forbiddenPairs: state.forbiddenPairs,
			pendingConstraints: state.pendingConstraints,
			reservations: state.reservations,
			hiddenGroups: state.hiddenGroups,
			hiddenGroupChains: state.hiddenGroupChains,
			pendingHiddenGroups: state.pendingHiddenGroups,
			pendingHiddenGroupChains: state.pendingHiddenGroupChains,
			probabilisticForbiddenPairs: state.probabilisticForbiddenPairs,
			maxTeamSizeEnabled: state.maxTeamSizeEnabled,
			genderBalanceEnabled: state.genderBalanceEnabled,
			weightBalanceEnabled: state.weightBalanceEnabled,
			membersPerTeam: state.membersPerTeam,
			groupColors: state.groupColors,
			timestamp: getCurrentDbTimestamp(),
			lastAccess: getCurrentDbTimestamp()
		};

		// 프로필 로그인 상태 — Firebase 프로필에 자동 저장
		if (currentProfileKey) {
			if (!database) return;
			clearTimeout(_profileAutoSaveTimer);
			_profileAutoSaveTimer = setTimeout(() => {
				database.ref(`profiles/${currentProfileKey}`).update(data)
					.catch((e) => { console.error('프로필 자동 저장 실패:', e); });
			}, delay);
			return;
		}

		// 토큰 모드 — 해당 프로필에 저장 + syncTrigger 발송 + 유저 레코드 동기화
		if (_readOnlyMode && _readOnlyProfileKey && database) {
			clearTimeout(_profileAutoSaveTimer);
			_profileAutoSaveTimer = setTimeout(() => {
				database.ref(`profiles/${_readOnlyProfileKey}`).update(data)
					.then(() => {
						database.ref(`profiles/${_readOnlyProfileKey}/syncTrigger`).set({
							timestamp: getCurrentDbTimestamp(),
							tick: Date.now(),
							type: 'member'
						}).catch(() => {});
					})
					.catch((e) => { console.error('토큰 모드 저장 실패:', e); });
				if (currentUserCode) {
					// 옵션은 기본값으로 명시 덮어쓰기 — update()는 병합이므로 기존 Firebase 값이 남기 때문
					const participantData = {
						people: data.people,
						inactivePeople: data.inactivePeople,
						requiredGroups: data.requiredGroups,
						nextId: data.nextId,
						forbiddenPairs: data.forbiddenPairs,
						pendingConstraints: data.pendingConstraints,
						reservations: data.reservations,
						hiddenGroups: data.hiddenGroups,
						hiddenGroupChains: data.hiddenGroupChains,
						pendingHiddenGroups: data.pendingHiddenGroups,
						pendingHiddenGroupChains: data.pendingHiddenGroupChains,
						probabilisticForbiddenPairs: data.probabilisticForbiddenPairs,
						groupColors: data.groupColors,
						timestamp: data.timestamp,
						lastAccess: data.lastAccess,
						maxTeamSizeEnabled: false,
						genderBalanceEnabled: true,
						weightBalanceEnabled: false,
						membersPerTeam: 4,
						_fromTokenMode: true
					};
					database.ref(`users/${currentUserCode}`).update(participantData)
						.catch((e) => { console.error('토큰 유저 동기화 실패:', e); });
				}
			}, delay);
			return;
		}

		// 비프로필 유저 — Firebase users에 실시간 저장
		if (currentUserCode && database) {
			clearTimeout(_profileAutoSaveTimer);
			_profileAutoSaveTimer = setTimeout(() => {
				database.ref(`users/${currentUserCode}`).update(data)
					.catch((e) => { console.error('유저 자동 저장 실패:', e); });
			}, delay);
		}
	} catch (e) {
		console.error('자동 저장 실패:', e);
	}
}

// 대기 중인 debounce 저장을 즉시 실행 (로그아웃 직전 호출)
function flushProfileAutoSave() {
	if (!_profileAutoSaveTimer || !currentProfileKey || !database) return;
	clearTimeout(_profileAutoSaveTimer);
	_profileAutoSaveTimer = null;
	const data = {
		people: state.people,
		inactivePeople: state.inactivePeople,
		requiredGroups: state.requiredGroups,
		nextId: state.nextId,
		forbiddenPairs: state.forbiddenPairs,
		pendingConstraints: state.pendingConstraints,
		reservations: state.reservations,
		hiddenGroups: state.hiddenGroups,
		hiddenGroupChains: state.hiddenGroupChains,
		pendingHiddenGroups: state.pendingHiddenGroups,
		pendingHiddenGroupChains: state.pendingHiddenGroupChains,
		probabilisticForbiddenPairs: state.probabilisticForbiddenPairs,
		maxTeamSizeEnabled: state.maxTeamSizeEnabled,
		genderBalanceEnabled: state.genderBalanceEnabled,
		weightBalanceEnabled: state.weightBalanceEnabled,
		membersPerTeam: state.membersPerTeam,
		groupColors: state.groupColors,
		timestamp: getCurrentDbTimestamp(),
		lastAccess: getCurrentDbTimestamp()
	};
	database.ref(`profiles/${currentProfileKey}`).update(data)
		.catch((e) => { console.error('프로필 즉시 저장 실패:', e); });
}

// localStorage에서 복원 — 현재는 비프로필 저장 없으므로 사용하지 않음
function loadFromLocalStorage() {
	// 비프로필: 새로고침 시 빈 화면 (저장 없음)
	// 프로필: loginProfile 흐름에서 직접 로드
}

// 이름별 기본값 가져오기

// 결과 섹션 캐처 기능
function captureResultsSection() {
	const section = elements.resultsSection;
	if (!section || !section.classList.contains('visible')) {
		alert(commandConsoleMessages.comments.noTeamResults);
		return;
	}

	// html2canvas가 로드되었는지 확인
	if (typeof html2canvas === 'undefined') {
		alert(commandConsoleMessages.comments.html2canvasNotFound);
		return;
	}

	// 캡처할 실제 영역 (::after 효과 제외)
	const captureArea = section.querySelector('.results-capture-area');
	if (!captureArea) {
		alert(commandConsoleMessages.comments.captureAreaNotFound);
		return;
	}

	// 기존 타이머 클리어 및 버튼 상태 초기화
	if (captureSuccessTimer) {
		clearTimeout(captureSuccessTimer);
		captureSuccessTimer = null;
	}

	// 플래시 효과 추가 (::after 가상요소)
	section.classList.add('capture-flash');

	// 찰칵 사운드 재생
	playCameraShutterSound();

	// 애니메이션 종료 후 클래스 제거
	setTimeout(() => {
		section.classList.remove('capture-flash');
	}, 600);

	// 캐처 버튼 임시 비활성화 (원본 HTML은 변경 전에 저장)
	const btn = elements.captureBtn;
	const originalHTML = btn ? btn.innerHTML : '';
	if (btn) {
		btn.textContent = commandConsoleMessages.comments.capturingInProgress;
		btn.disabled = true;
	}

	// 플래시 효과 후 약간 대기
	setTimeout(() => {
		html2canvas(captureArea, {
		backgroundColor: '#f8f9fa',
		scale: 2,
		logging: false,
		allowTaint: true,
		useCORS: true
	}).then(canvas => {
		// 캔버스를 이미지로 변환하여 클립보드에 복사
		canvas.toBlob(blob => {
			if (!blob) {
				alert(commandConsoleMessages.comments.imageGenerationFailed);
				btn.innerHTML = originalHTML;
				btn.disabled = false;
				return;
			}

			// 클립보드 API 확인
			if (!navigator.clipboard || !navigator.clipboard.write) {
				alert(commandConsoleMessages.comments.clipboardHttpsRequired);
				btn.innerHTML = originalHTML;
				btn.disabled = false;
				return;
			}

			// 클립보드에 이미지 복사
			const item = new ClipboardItem({ 'image/png': blob });
			navigator.clipboard.write([item]).then(() => {
				// 성공 메시지
				btn.textContent = commandConsoleMessages.comments.copyComplete;
				captureSuccessTimer = setTimeout(() => {
					btn.innerHTML = originalHTML;
					captureSuccessTimer = null;
				}, 2000);
				btn.disabled = false;
			}).catch(err => {
				console.error('클립보드 복사 실패:', err);
				alert(commandConsoleMessages.comments.clipboardCopyFailed);
				btn.innerHTML = originalHTML;
				btn.disabled = false;
			});
		}, 'image/png');
	}).catch(err => {
		console.error('캐처 실패:', err);
		alert(commandConsoleMessages.comments.captureFailed);
		btn.innerHTML = originalHTML;
		btn.disabled = false;
	});
	}, 100);
}

// 카메라 셔터 사운드 재생
function playCameraShutterSound() {
	try {
		const AudioCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtor) throw new Error('AudioContext not supported');
		const audioContext = new AudioCtor();
		if (audioContext.state === 'suspended') audioContext.resume();

		const now = audioContext.currentTime;
		const freq = 2500; // 동일한 음 높이 (2500Hz)

		// 비프음을 생성하는 내부 함수
		const playBeep = (startTime, duration) => {
			const osc = audioContext.createOscillator();
			const gain = audioContext.createGain();

			osc.type = 'square';
			osc.frequency.setValueAtTime(freq, startTime);

			gain.gain.setValueAtTime(0, startTime);
			gain.gain.linearRampToValueAtTime(0.1, startTime + 0.002); // 삑!
			gain.gain.linearRampToValueAtTime(0, startTime + duration); // 끝

			osc.connect(gain);
			gain.connect(audioContext.destination);

			osc.start(startTime);
			osc.stop(startTime + duration);
		};

		// 1. 첫 번째 "삐" (0.05초 동안)
		playBeep(now, 0.05);

		// 2. 두 번째 "빅" (0.06초 뒤에 시작, 0.05초 동안)
		// 시작 시간을 now + 0.06으로 설정해 아주 짧은 간격을 둡니다.
		playBeep(now + 0.06, 0.05);

	} catch (e) {
		console.log(commandConsoleMessages.comments.soundPlaybackFailed, e);
	}
}

// 참가자 복사 기능 (Ctrl+C)
function handleParticipantCopy(e) {
	// Ctrl+C 또는 Cmd+C 감지 (Mac 지원)
	// e.key는 대소문자 구분하므로 소문자로 변환
	const key = e.key.toLowerCase();

	if ((e.ctrlKey || e.metaKey) && key === 'c') {
		// 텍스트 선택 여부 확인 - 텍스트가 선택되어 있으면 기본 복사 동작 유지
		const selection = window.getSelection();
		if (selection && selection.toString().length > 0) {
			return; // 텍스트가 선택되어 있으면 기본 복사 동작
		}

		// 입력창에 포커스가 있으면 기본 복사 동작 유지
		const activeElement = document.activeElement;
		if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
			return;
		}

		// 참가자가 없으면 아무것도 하지 않음
		if (state.people.length === 0) {
			return;
		}

		// 기본 동작 방지
		e.preventDefault();

		// 참가자 데이터를 문자열로 변환
		const participantString = convertParticipantsToString();

		// 클립보드에 복사
		copyToClipboard(participantString);

		// 플래시 효과 발생
		triggerParticipantFlash();
	}
}

// 참가자 데이터를 문자열로 변환
function convertParticipantsToString() {
	const result = [];
	const grouped = new Set();
	const groupMap = new Map();

	// 그룹 정보를 맵으로 저장
	state.requiredGroups.forEach((group, groupIndex) => {
		group.forEach(personId => {
			grouped.add(personId);
			groupMap.set(personId, groupIndex);
		});
	});

	const processedGroups = new Set();

	state.people.forEach(person => {
		const groupIndex = groupMap.get(person.id);

		if (groupIndex !== undefined && !processedGroups.has(groupIndex)) {
			// 그룹 처리
			processedGroups.add(groupIndex);
			const group = state.requiredGroups[groupIndex];
			const groupMembers = group.map(personId => {
				const groupPerson = state.people.find(p => p.id === personId);
				return groupPerson ? formatPersonString(groupPerson) : '';
			}).filter(s => s);

			result.push(groupMembers.join(','));
		} else if (groupIndex === undefined) {
			// 그룹에 속하지 않은 개별 항목
			result.push(formatPersonString(person));
		}
	});

	return result.join('/');
}

// 개별 참가자를 문자열로 포맷
function formatPersonString(person) {
	let result = person.name;

	const genderEnabled = state.genderBalanceEnabled;
	const weightEnabled = state.weightBalanceEnabled;

	// 둘 다 체크되어 있지 않으면 이름만
	if (!genderEnabled && !weightEnabled) {
		return result;
	}

	// 괄호 안에 들어갈 내용 구성
	let bracketContent = '';

	// 성별 추가 (체크되어 있을 때)
	if (genderEnabled) {
		const genderStr = person.gender === 'female' ? commandConsoleMessages.comments.genderFemale : commandConsoleMessages.comments.genderMale;
		bracketContent += genderStr;
	}

	// 가중치 추가 (체크되어 있을 때)
	if (weightEnabled) {
		const weightStr = person.weight || 0;
		bracketContent += weightStr;
	}

	result += `(${bracketContent})`;
	return result;
}

// 클립보드에 텍스트 복사
function copyToClipboard(text) {
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(() => {
			console.log(commandConsoleMessages.comments.participantsCopiedToClipboard, text);
		}).catch(err => {
			console.error('클립보드 복사 실패:', err);
			fallbackCopyToClipboard(text);
		});
	} else {
		fallbackCopyToClipboard(text);
	}
}

// 클립보드 API가 지원되지 않을 때 대체 방법
function fallbackCopyToClipboard(text) {
	const textArea = document.createElement('textarea');
	textArea.value = text;
	textArea.style.position = 'fixed';
	textArea.style.left = '-9999px';
	document.body.appendChild(textArea);
	textArea.focus();
	textArea.select();

	try {
		document.execCommand('copy');
		console.log(commandConsoleMessages.comments.participantsCopiedToClipboard, text);
	} catch (err) {
		console.error('클립보드 복사 실패:', err);
	}

	document.body.removeChild(textArea);
}

// 참가자 영역에 플래시 효과 발생
function triggerParticipantFlash() {
	const peopleList = elements.peopleList;
	if (!peopleList) return;

	// 플래시 효과 클래스 추가
	peopleList.classList.add('capture-flash');

	// 찰칵 사운드 재생
	playCameraShutterSound();

	// 애니메이션 종료 후 클래스 제거
	setTimeout(() => {
		peopleList.classList.remove('capture-flash');
	}, 600);
}

function resetAll(e) {
	// Shift 키를 누른 상태로 클릭한 경우 완전 초기화
	const isCompleteReset = e && e.shiftKey;

	if (isCompleteReset) {
		if (!confirm(commandConsoleMessages.comments.completeResetConfirm)) {
			return;
		}
	} else {
		if (!confirm(commandConsoleMessages.comments.resetAllConfirm)) {
			return;
		}
	}

	// 적용된(id 기반) 분리을 이름 기반 보류 분리으로 변환하여 유지
	let converted = 0;
	state.forbiddenPairs.forEach(([a, b]) => {
		const pa = state.people.find(p => p.id === a);
		const pb = state.people.find(p => p.id === b);
		if (pa && pb) if (addPendingConstraint(pa.name, pb.name).ok) converted++;
	});
	if (converted > 0) {
		console.log(commandConsoleMessages.comments.resetConstraintsConverted.replace('{count}', converted));
	}

	// Shift 키를 누른 경우: 미참가자도 모두 삭제
	if (isCompleteReset) {
		state.inactivePeople = [];
		console.log(commandConsoleMessages.comments.resetComplete);
	} else {
		// 일반 초기화: 모든 참가자를 미참가자 목록으로 이동
		state.people.forEach(person => {
			const normalized = normalizeName(person.name);
			const existingInactive = state.inactivePeople.find(p => normalizeName(p.name) === normalized);
			if (!existingInactive) {
				const inactivePerson = {
					name: person.name,
					gender: person.gender,
					weight: person.weight
				};
				state.inactivePeople.push(inactivePerson);
			}
		});
	}

	// 참가자 및 그룹 목록 초기화(보류 분리은 유지)
	state.people = [];
	state.requiredGroups = [];
	state.nextId = 1;
	state.forbiddenPairs = []; // id 기반 분리 초기화(보류로 전환됨)
	state.forbiddenMap = {};
	state.hiddenGroups = []; // id 기반 히든 그룹 초기화
	// state.hiddenGroupChains는 초기화하지 않음 (규칙은 cmd의 초기화로만 삭제 가능)
	state.activeHiddenGroupMap = {};
	elements.resultsSection.classList.remove('visible');
	// 캡처 버튼 컨테이너 숨기기
	if (elements.captureButtonContainer) elements.captureButtonContainer.style.display = 'none';
	// 리셋 시 FAQ 섹션 다시 표시
	const faqSection = document.querySelector('.faq-section');
	if (faqSection) faqSection.style.display = '';
	saveToLocalStorage();
	renderPeople();
	// 상태가 모두 정리된 후 팝업이 이미 열려 있으면 내용만 갱신
	if (forbiddenPopup && !forbiddenPopup.closed) {
		renderForbiddenWindowContent();
	}
}

function handleGenderBalanceToggle(e) {
	state.genderBalanceEnabled = e.target.checked;
	saveToLocalStorage();
	renderPeople();
}

function handleWeightBalanceToggle(e) {
	state.weightBalanceEnabled = e.target.checked;
	saveToLocalStorage();
	renderPeople();
}

function handleMaxTeamSizeToggle(e) {
	state.maxTeamSizeEnabled = e.target.checked;
	saveToLocalStorage();
}

function handleTeamSizeChange(e) {
	state.membersPerTeam = parseInt(e.target.value) || 4;
	saveToLocalStorage();
}

function shuffleOrder() {
	if (state.people.length === 0) {
		alert(commandConsoleMessages.comments.noParticipants);
		return;
	}

		// Fisher-Yates 셔플 알고리즘 (전체 참가자 배열)
		for (let i = state.people.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[state.people[i], state.people[j]] = [state.people[j], state.people[i]];
		}
		// 그룹 내부도 섞기
		state.requiredGroups = state.requiredGroups.map(group => {
			const arr = [...group];
			for (let i = arr.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[arr[i], arr[j]] = [arr[j], arr[i]];
			}
			return arr;
		});
		saveToLocalStorage(0);
		renderPeople();
}

// 중복 확인 모달을 위한 전역 변수
let pendingAddData = null;

function addPerson(fromConsole = false, options = {}) {
	const input = elements.nameInput.value.trim();
	if (input === '') {
		if (!fromConsole) alert(commandConsoleMessages.comments.nameRequired);
		return;
	}

	if (input === '!') {
		safeOpenForbiddenWindow();
		elements.nameInput.value = '';
		elements.nameInput.focus();
		return;
	}

	// 콘솔 열기 명령어 체크
	if (input.toLowerCase() === 'command' || input.toLowerCase() === 'cmd') {
		const consoleEl = document.getElementById('commandConsole');
		if (consoleEl) {
			consoleEl.style.display = 'flex';
			consoleEl.style.transform = 'translate(0, 0)'; // 초기 위치로 리셋
			consoleEl.style.width = '900px'; // 초기 크기로 리셋
			consoleEl.style.height = '600px'; // 초기 크기로 리셋
			// content 표시 (최소화 상태 해제)
			const content = document.querySelector('.command-content');
			if (content) content.style.display = 'flex';
			const toggleBtn = document.getElementById('toggleConsoleBtn');
			if (toggleBtn) toggleBtn.textContent = '−';
			elements.nameInput.value = '';

			if (commandConsole.output) {
				if (currentProfileKey) {
					// 파라미터가 있는 경우 - 이미 인증되었다면 비밀번호를 묻지 않음
					if (commandConsole.authenticated) {
						commandConsole.log(commandConsoleMessages.comments.profileConnectedAuth.replace('{profile}', currentProfileKey));
						commandConsole.log(commandConsoleMessages.comments.consoleReady);
						setTimeout(() => commandConsole.input.focus(), 100);
					} else if (database) {
						const isUsersSource = (typeof getCurrentProfileSource === 'function' && getCurrentProfileSource() === 'users');
						if (isUsersSource) {
							commandConsole.authenticated = true;
							commandConsole.storedPassword = '';
							authenticatedPassword = 'users-auto-auth';
							commandConsole.log(commandConsoleMessages.comments.profileConnectedAuth.replace('{profile}', currentProfileKey));
							commandConsole.log(commandConsoleMessages.comments.consoleReady);
							setTimeout(() => commandConsole.input.focus(), 100);
							return;
						}
						// 인증되지 않았고, 저장된 비밀번호가 이미 있다면 읽기 전용 모드로
						if (commandConsole.storedPassword !== null && commandConsole.storedPassword !== undefined) {
							// 읽기 전용 모드로 진입
							commandConsole.authenticated = false;
							commandConsole.log(commandConsoleMessages.comments.profileConnectedReadOnly.replace('{profile}', currentProfileKey));
							commandConsole.log(commandConsoleMessages.comments.writeLoginRequired);
							commandConsole.log(commandConsoleMessages.comments.consoleReady);
							setTimeout(() => commandConsole.input.focus(), 100);
						} else {
							// 최초 cmd 입력 시 - 비밀번호 확인
							resolveProfileRecord(currentProfileKey)
								.then((result) => {
									if (!result.exists) {
										commandConsole.tempProfile = currentProfileKey;
										commandConsole.warn(`⚠️ '${currentProfileKey}'는 존재하지 않는 프로필입니다.`);
										commandConsole.log(commandConsoleMessages.comments.registerNewProfile);
										commandConsole.inputMode = 'profile-create-confirm';
										commandConsole.showConfirmButtons();
										return;
									}

									const data = result.data || {};
									const password = data.password || '';
									const isUsersSource = result.source === 'users';

									if (isUsersSource || password === '') {
										commandConsole.authenticated = true;
										commandConsole.storedPassword = '';
										authenticatedPassword = 'users-auto-auth';
										if (data && (data.people || data.timestamp)) {
											loadStateFromData(data);
										} else {
											logProfileConsole(`📡 프로필 '${currentProfileKey}' 로드됨 (초기 상태)`);
										}
										commandConsole.log('🔄 실시간 동기화 활성화됨');
										setupRealtimeSync();
										commandConsole.log(commandConsoleMessages.comments.consoleReady);
										setTimeout(() => commandConsole.input.focus(), 100);
									} else {
										commandConsole.storedPassword = password;
										commandConsole.authenticated = false;
										if (data && (data.people || data.timestamp)) {
											loadStateFromData(data);
											logProfileConsole(`📡 프로필 '${currentProfileKey}' 발견 (참가자: ${state.people.length}명)`);
										} else {
											logProfileConsole(`📡 프로필 '${currentProfileKey}' 발견 (초기 상태)`);
										}
										commandConsole.log('🔄 실시간 동기화 활성화됨');
										setupRealtimeSync();
										commandConsole.log('🔒 비밀번호를 입력하세요:');
										commandConsole.inputMode = 'auth';
										commandConsole.input.type = 'password';
										commandConsole.input.placeholder = '비밀번호 입력...';
										setTimeout(() => commandConsole.input.focus(), 100);
									}
								})
								.catch((error) => {
									commandConsole.error(`데이터 로드 실패: ${error.message}`);
								});
						}
					}
				} else {
					// 파라미터가 없는 경우: 자동 프롬프트 없이 일반 입력 모드 유지
					commandConsole.inputMode = 'normal';
					commandConsole.restoreInputField(false);
					commandConsole.input.placeholder = commandConsoleMessages.placeholders.input;
					setTimeout(() => commandConsole.input && commandConsole.input.focus(), 100);
				}
			}
			// 위치와 크기 상태 완전 초기화
			commandConsole.savedPosition.x = 0;
			commandConsole.savedPosition.y = 0;
			commandConsole.savedPosition.width = '450px';
			commandConsole.savedPosition.height = '350px';
			if (commandConsole.dragState) {
				commandConsole.dragState.xOffset = 0;
				commandConsole.dragState.yOffset = 0;
				commandConsole.dragState.currentX = 0;
				commandConsole.dragState.currentY = 0;
				commandConsole.dragState.initialX = 0;
				commandConsole.dragState.initialY = 0;
			}
		}
		return;
	}

	// 입력 내용에서 성별/가중치 패턴 감지하여 자동 체크
	if (!options.skipAutoDetect) {
		autoDetectAndCheckOptions();
	}

	// '/'로 분리하여 토큰 처리; '!'가 포함된 토큰은 분리, 아니면 이름/그룹으로 처리
	const tokens = input.split('/').map(t => t.trim()).filter(t => t !== '');

	if (tokens.length === 0) {
		if (!fromConsole) alert(commandConsoleMessages.comments.nameRequired);
		return;
	}

	let constraintsTouched = false;
	const duplicateHits = [];
	const pendingNamesData = []; // 등록 대기중인 이름 그룹들
	const allInputNames = []; // 입력된 모든 이름 (정규화된 형태)

	tokens.forEach(token => {
		// cmd 콘솔에서만 확률 규칙 처리
		if (fromConsole) {
				// 확률 분리 체이닝 체크: A(!50)B(!50)C(!50)D 패턴
				const probabilisticChainPattern = /^([^(]+)(?:\(!\s*(\d+)\s*\)([^(]*?))+$/;
				if (probabilisticChainPattern.test(token)) {
					// 체인 파싱
					const parts = [];
					let current = token;
					let firstPart = null;

					// 첫 번째 부분 추출
					const firstMatch = current.match(/^([^(]+)\(!/);
					if (firstMatch) {
						firstPart = firstMatch[1].trim();
						current = current.substring(firstMatch[1].length);
					}

					// 나머지 (!확률)이름 패턴 반복 추출
					const pairPattern = /\(!\s*(\d+)\s*\)([^(]*?)(?=\(!|$)/g;
					let match;
					while ((match = pairPattern.exec(current)) !== null) {
						const prob = parseInt(match[1]);
						const name = match[2].trim();
						// 이름이 있고 확률이 유효한 경우만 추가
						if (name && prob >= 0 && prob <= 100) {
							parts.push({ name, probability: prob });
						}
					}

					if (firstPart && parts.length > 0) {
						// 각 쌍에 대해 확률 분리 등록
						const primaryName = firstPart.trim();
						let addedCount = 0;
						parts.forEach(part => {
							const res = addProbabilisticForbiddenPairByNames(primaryName, part.name, part.probability);
							if (res.ok) {
								addedCount++;
							}
						});
						if (addedCount > 0) {
							saveToLocalStorage();
							constraintsTouched = true;
						}
						return; // 확률 분리 체인 처리 완료
					}
				}

				// 확률 분리 등록: A(!10)B
				const probabilisticForbiddenPattern = /^([^()!]+)\(!\s*(\d+)\s*\)([^()!]+)$/;
				const probabilisticMatch = token.match(probabilisticForbiddenPattern);
				if (probabilisticMatch) {
					const leftName = probabilisticMatch[1].trim();
					const probability = parseInt(probabilisticMatch[2], 10);
					const rightName = probabilisticMatch[3].trim();
					if (leftName && rightName && probability >= 0 && probability <= 100) {
						const res = addProbabilisticForbiddenPairByNames(leftName, rightName, probability);
						if (res.ok) {
							saveToLocalStorage();
							constraintsTouched = true;
						}
					}
					return; // 확률 분리 처리 완료
				}

			// 체이닝 제거 패턴: A(!), A(!)B, A(!)B(!)C
			const removeChainPattern = /^([^()!]+)\(!\)(.*)$/;
			const removeMatch = token.match(removeChainPattern);
			if (removeMatch) {
				const primaryName = removeMatch[1].trim();
				const rest = removeMatch[2].trim();

				const existingChain = state.hiddenGroupChains.find(chain => chain.primary === primaryName);

				if (!existingChain) {
					console.log(commandConsoleMessages.comments.chainRuleDeleteFailed.replace('{name}', primaryName));
					return;
				}

				if (!rest) {
					// A(!) - 모든 체이닝 제거
					state.hiddenGroupChains = state.hiddenGroupChains.filter(chain => chain.primary !== primaryName);
					const removedProb = removeProbabilisticForbiddenByName(primaryName);
					saveToLocalStorage();
					constraintsTouched = true;
					console.log(commandConsoleMessages.comments.chainRuleDeleted.replace('{name}', primaryName));
				} else {
					// A(!)B 또는 A(!)B(!)C - 특정 후보 제거
					const removeTargets = rest.split('(!)').map(n => n.trim()).filter(n => n);

					let removedCount = 0;
					const removedNames = [];
					const removedProbTargets = [];
					removeTargets.forEach(targetName => {
						const beforeLen = existingChain.candidates.length;
						existingChain.candidates = existingChain.candidates.filter(c => c.name !== targetName);
						const afterLen = existingChain.candidates.length;
						if (beforeLen > afterLen) {
							removedCount++;
							removedNames.push(targetName);
						}
						const probRemoved = removeProbabilisticForbiddenPairByNames(primaryName, targetName);
						if (probRemoved > 0) removedProbTargets.push(targetName);
					});

					// 후보가 모두 제거되면 체인 자체를 제거
					if (existingChain.candidates.length === 0) {
						state.hiddenGroupChains = state.hiddenGroupChains.filter(chain => chain.primary !== primaryName);
						console.log(commandConsoleMessages.comments.chainAllCandidatesDeleted.replace('{name}', primaryName));
					} else if (removedCount > 0) {
						console.log(commandConsoleMessages.comments.chainCandidatesDeleted + `: '${primaryName}' → ${removedNames.map(n => `'${n}'`).join(', ')} (${removedCount}개)`);
					} else {
						console.log(commandConsoleMessages.comments.chainCandidateDeleteFailed);
					}

					if (removedCount > 0 || removedProbTargets.length > 0) {
						saveToLocalStorage();
						constraintsTouched = true;
					}
				}
				return; // 체이닝 제거 처리 완료
			}

			// 간편 삭제 패턴: A!, A!B, A!B!C
			const removeSimplePattern = /^([^()!,]+)!(.*)$/;
			const removeSimpleMatch = token.match(removeSimplePattern);
			if (removeSimpleMatch) {
				const primaryName = removeSimpleMatch[1].trim();
				const rest = removeSimpleMatch[2].trim();
				const primaryKey = normalizeName(primaryName);

				const existingChain = state.hiddenGroupChains.find(chain => normalizeName(chain.primary) === primaryKey);
				if (!existingChain) {
					console.log(commandConsoleMessages.comments.chainRuleDeleteFailed.replace('{name}', primaryName));
					return;
				}

				if (!rest) {
					state.hiddenGroupChains = state.hiddenGroupChains.filter(chain => normalizeName(chain.primary) !== primaryKey);
					const removedProb = removeProbabilisticForbiddenByName(primaryName);
					saveToLocalStorage();
					constraintsTouched = true;
					console.log(commandConsoleMessages.comments.chainRuleDeleted.replace('{name}', primaryName));
					return;
				}

				const removeTargets = rest.split('!').map(n => n.trim()).filter(n => n);
				let removedCount = 0;
				const removedNames = [];
				const removedProbTargets = [];

				removeTargets.forEach(targetName => {
					const targetKey = normalizeName(targetName);
					const beforeLen = existingChain.candidates.length;
					existingChain.candidates = existingChain.candidates.filter(c => normalizeName(c.name) !== targetKey);
					const afterLen = existingChain.candidates.length;
					if (beforeLen > afterLen) {
						removedCount++;
						removedNames.push(targetName);
					}
					const probRemoved = removeProbabilisticForbiddenPairByNames(primaryName, targetName);
					if (probRemoved > 0) removedProbTargets.push(targetName);
				});

				if (existingChain.candidates.length === 0) {
					state.hiddenGroupChains = state.hiddenGroupChains.filter(chain => normalizeName(chain.primary) !== primaryKey);
					console.log(commandConsoleMessages.comments.chainAllCandidatesDeleted.replace('{name}', primaryName));
				} else if (removedCount > 0) {
					console.log(commandConsoleMessages.comments.chainCandidatesDeleted + `: '${primaryName}' → ${removedNames.map(n => `'${n}'`).join(', ')} (${removedCount}개)`);
				} else {
					console.log(commandConsoleMessages.comments.chainCandidateDeleteFailed);
				}

				if (removedCount > 0 || removedProbTargets.length > 0) {
					saveToLocalStorage();
					constraintsTouched = true;
				}
				return;
			}

			// 히든 그룹 체이닝 체크: A(50)B(50)C(50)D 패턴
			const chainPattern = /^([^(]+)(?:\((\d+)\)([^(]*?))+$/;
			if (chainPattern.test(token)) {
				// 체인 파싱
				const parts = [];
				let current = token;
				let firstPart = null;

				// 첫 번째 부분 추출
				const firstMatch = current.match(/^([^(]+)\(/);
				if (firstMatch) {
					firstPart = firstMatch[1].trim();
					current = current.substring(firstMatch[1].length);
				}

				// 나머지 (확률)이름 패턴 반복 추출
				const pairPattern = /\((\d+)\)([^(]*?)(?=\(|$)/g;
				let match;
				while ((match = pairPattern.exec(current)) !== null) {
					const prob = parseInt(match[1]);
					const name = match[2].trim();
					// 이름이 있고 확률이 유효한 경우만 추가
					if (name && prob >= 0 && prob <= 100) {
						parts.push({ name, probability: prob });
					}
				}

				if (firstPart && parts.length > 0) {
					// 규칙으로 등록 (참가자 존재 여부와 무관)
					const primaryName = firstPart.trim();
					const candidates = parts.map(p => ({ name: p.name.trim(), probability: p.probability }));
					// 동일한 확률 분리이 있으면 제거 (A(!10)B -> A(10)B)
					candidates.forEach(candidate => {
						const removedProb = removeProbabilisticForbiddenPairByNames(primaryName, candidate.name);
						if (removedProb > 0) {
							constraintsTouched = true;
						}
					});

					// 기존 체인이 있으면 후보를 병합
					const existingChain = state.hiddenGroupChains.find(chain => chain.primary === primaryName);
					if (existingChain) {
						// 기존 체인에 새 후보들 추가/갱신
						candidates.forEach(newCandidate => {
							const existing = existingChain.candidates.find(c => c.name === newCandidate.name);
							if (existing) {
								existing.probability = newCandidate.probability;
							} else {
								existingChain.candidates.push(newCandidate);
							}
						});
					} else {
						// 새 체인 생성
						state.hiddenGroupChains.push({
							primary: primaryName,
							candidates: candidates
						});
					}
					saveToLocalStorage();
					constraintsTouched = true;
					return; // 체인 처리 완료
				}
			}

			// 히든 그룹 단일 쌍 체크: A(50)B 패턴 (체이닝이 아닌 경우)
			const hiddenGroupMatch = token.match(/^([^(]+)\((\d+)\)([^(]+)$/);
			if (hiddenGroupMatch) {
				const leftName = hiddenGroupMatch[1].trim();
				const probability = parseInt(hiddenGroupMatch[2]);
				const rightName = hiddenGroupMatch[3].trim();
				if (leftName && rightName && probability >= 0 && probability <= 100) {
					// 동일한 확률 분리이 있으면 제거 (A(!10)B -> A(10)B)
					const removedProb = removeProbabilisticForbiddenPairByNames(leftName, rightName);
					if (removedProb > 0) {
						constraintsTouched = true;
					}
					// 규칙으로 등록 (참가자 존재 여부와 무관)
					const existingChain = state.hiddenGroupChains.find(chain => chain.primary === leftName);
					if (existingChain) {
						// 기존 체인에 후보 추가
						const existingCandidate = existingChain.candidates.find(c => c.name === rightName);
						if (existingCandidate) {
							existingCandidate.probability = probability;
						} else {
							existingChain.candidates.push({ name: rightName, probability: probability });
						}
					} else {
						// 기존 체인이 없으면 새 체인 생성
						state.hiddenGroupChains.push({
							primary: leftName,
							candidates: [{ name: rightName, probability: probability }]
						});
					}
					saveToLocalStorage();
					constraintsTouched = true;
					return; // 히든 그룹 처리 완료
				}
			}
		}
		// fromConsole 블록 종료

		if (token.includes('!')) {
			// 한 입력에서 여러 분리 처리: "A!B!C!D" 또는 "A!B,C!E"
			// 먼저 쉼표로 분리하여 "A!B,C!E" -> ["A!B", "C!E"] 형태로 처리
			const constraintParts = token.split(',').map(p => p.trim()).filter(p => p !== '');

			constraintParts.forEach(constraint => {
				// 제거 처리: A!!B
				if (constraint.includes('!!')) {
					const [left, right] = constraint.split('!!').map(s => s.trim());
					if (left && right) {
						const rres = removeForbiddenPairByNames(left, right);
						if (!rres.ok) console.log('보류/적용 분리 제거 실패:', rres.message);
						else { constraintsTouched = true; }
						// 명령어로 분리 제거 시 창 열기
						safeOpenForbiddenWindow();
					}
				}
				// 쌍 분리 처리: A!B!C!D -> 모든 조합 쌍 생성
				else if (constraint.includes('!')) {
					const names = constraint.split('!').map(s => s.trim()).filter(s => s !== '');

					// 모든 조합에 대해 쌍 분리 생성
					for (let i = 0; i < names.length; i++) {
						for (let j = i + 1; j < names.length; j++) {
							const ln = names[i];
							const rn = names[j];
							if (!ln || !rn) continue;

							const pa = findPersonByName(ln);
							const pb = findPersonByName(rn);
							if (pa && pb) {
								const res = addForbiddenPairByNames(ln, rn);
								// addForbiddenPairByNames가 영속화와 뷰 업데이트를 처리함
								if (res.ok) constraintsTouched = true;
								// 성공/실패 모두 자식창 표시
								safeOpenForbiddenWindow();
							} else {
								const pres = addPendingConstraint(ln, rn);
								if (pres.ok) constraintsTouched = true;
								// 보류 분리도 사용자가 명시적으로 !를 입력했으므로 창 표시
								safeOpenForbiddenWindow();
							}
						}
					}
				}
			});
		} else {
			// 일반 그룹/이름 토큰
			const names = token.split(',').map(n => n.trim()).filter(n => n !== '');
			if (names.length === 0) return;

			// 기존 참가자와의 중복 체크 (괄호 제거된 이름으로 비교)
			const groupDuplicates = [];
			names.forEach(name => {
				const normalized = normalizeName(name);
				const exists = state.people.some(p => normalizeName(p.name) === normalized);
				if (exists) groupDuplicates.push(name);
			});

			// 중복된 이름이 있으면 기록
			if (groupDuplicates.length > 0) duplicateHits.push(...groupDuplicates);

			// 등록 대기 데이터에 추가
			pendingNamesData.push({ names, hasDuplicates: groupDuplicates.length > 0 });

			// 모든 입력 이름을 수집 (정규화된 형태)
			names.forEach(name => {
				allInputNames.push(normalizeName(name));
			});
		}
	});

	// 여러 토큰에 걸친 입력 데이터 내 중복 체크 (예: "하/하")
	const inputNameCount = {};
	const duplicatesAcrossTokens = [];
	allInputNames.forEach(normalizedName => {
		inputNameCount[normalizedName] = (inputNameCount[normalizedName] || 0) + 1;
		if (inputNameCount[normalizedName] === 2) duplicatesAcrossTokens.push(normalizedName);
	});

	const hasInputDuplicates = duplicatesAcrossTokens.length > 0;

	// 분리 처리만 있었다면 입력창 초기화
	if (constraintsTouched && pendingNamesData.length === 0) {
		elements.nameInput.value = '';
		elements.nameInput.focus();
		return;
	}

	// 중복이 하나라도 있으면 모달 표시 (기존 참가자와 중복 또는 입력 내 중복)
	if (duplicateHits.length > 0 || hasInputDuplicates) {
		// 중복 확인 모달 표시
		// 중복 제거 후 남을 그룹 개수를 예측하여 색상 인덱스 계산

		// 제거될 참가자들이 속한 그룹 찾기
		const groupsToRemove = new Set();
		duplicateHits.forEach(name => {
			const normalized = normalizeName(name);
			const person = state.people.find(p => normalizeName(p.name) === normalized);
			if (person) {
				state.requiredGroups.forEach((group, groupIndex) => {
					if (group.includes(person.id)) {
						groupsToRemove.add(groupIndex);
					}
				});
			}
		});

		// 중복 제거 후 남을 그룹 개수
		const remainingGroupCount = state.requiredGroups.length - groupsToRemove.size;

		// 새 그룹들에 할당할 색상 인덱스 계산
		const newGroupColorIndices = [];
		let nextColorIndex = remainingGroupCount;

		pendingNamesData.forEach(({ names }) => {
			if (names.length > 1) {
				// 그룹인 경우에만 색상 인덱스 할당
				newGroupColorIndices.push(nextColorIndex);
				nextColorIndex++;
			} else {
				newGroupColorIndices.push(-1); // 개별 참가자는 -1
			}
		});

		pendingAddData = {
			input: input,
			pendingNamesData: pendingNamesData,
			duplicateHits: duplicateHits,
			newGroupColorIndices: newGroupColorIndices
		};
		showDuplicateConfirmModal(duplicateHits);
		return;
	}

	// 중복이 없으면 바로 등록
	// renderPeople()이 입력창을 참조하지 않도록 먼저 초기화
	const tempInput = elements.nameInput.value;
	elements.nameInput.value = '';
	processAddPerson(pendingNamesData, null);
	elements.nameInput.focus();
}

// 실제 등록 처리 함수
function processAddPerson(pendingNamesData, groupColorIndices) {
	let addedAny = false;

	// 0단계: 중복된 이름을 가진 사람들 찾기
	const duplicateIds = [];
	pendingNamesData.forEach(({ names }) => {
		names.forEach(name => {
			const normalized = normalizeName(name);
			const existing = state.people.find(p => normalizeName(p.name) === normalized);
			if (existing) duplicateIds.push(existing.id);
		});
	});

	// 1단계: 중복된 사람들을 미참가자 목록에 추가 (성별/가중치 보존)
	duplicateIds.forEach(id => {
		const person = state.people.find(p => p.id === id);
		if (person) {
			const normalized = normalizeName(person.name);
			const existingInactive = state.inactivePeople.find(p => normalizeName(p.name) === normalized);
			if (!existingInactive) {
				state.inactivePeople.push({
					name: person.name,
					gender: person.gender,
					weight: person.weight
				});
			} else {
				// 이미 미참가자 목록에 있으면 정보 갱신
				existingInactive.gender = person.gender;
				existingInactive.weight = person.weight;
			}
		}
	});

	// 2단계: 중복된 사람들을 state.people에서 제거
	state.people = state.people.filter(p => !duplicateIds.includes(p.id));

	// 3단계: 각 그룹에서 중복된 사람들 제거 (그룹은 유지, 1명 이하가 되면 그룹 해체)
	state.requiredGroups = state.requiredGroups.map(group => {
		return group.filter(pid => !duplicateIds.includes(pid));
	}).filter(group => group.length > 1);

	// 4단계: 분리 조건에서도 중복된 사람들 제거
	duplicateIds.forEach(id => {
		const before = state.forbiddenPairs.length;
		state.forbiddenPairs = state.forbiddenPairs.filter(([a, b]) => a !== id && b !== id);
		const after = state.forbiddenPairs.length;
		if (before !== after) {
			console.log(`분리 제거: 삭제된 사람(id:${id})과 관련된 분리 ${before - after}개가 제거되었습니다.`);
		}
	});
	buildForbiddenMap();

	// 4단계: 새 참가자 추가
	const newGroupsToAdd = [];

		pendingNamesData.forEach(({ names }, index) => {
			const newIds = [];
				names.forEach(name => {
					// 이름에서 괄호 패턴 분석: 이름(남), 이름(100), 이름(100남), 이름(여400) 등
					let actualName = name;
					let parsedGender = null;
					let parsedWeight = null;

					// 괄호가 있는지 확인
					const match = name.match(/^(.+?)\(([^)]+)\)$/);
					if (match) {
						actualName = match[1].trim();
						const content = match[2].trim();

						// 괄호 안 내용 분석
						// 패턴: 숫자만, 남/여만, 숫자+남/여 (순서 무관)
						const numberMatch = content.match(/\d+/);
						const genderMatch = content.match(/[남여]/);

						if (numberMatch) {
							parsedWeight = parseInt(numberMatch[0]);
						}
						if (genderMatch) {
							parsedGender = genderMatch[0] === '남' ? 'male' : 'female';
						}
					}

					// 기본값 설정
					let weight = 0;
					let gender = 'male';

					// 미참가자 목록에서 찾기
					const normalized = normalizeName(actualName);
					const inactivePerson = state.inactivePeople.find(p => normalizeName(p.name) === normalized);

					// 우선순위: 1. 명령어 입력값 (parsedGender/parsedWeight)
					//          2. 미참가자 목록 값
					//          3. 기본값만 (입력 필드 값 사용 안 함)

					// 성별 결정
					if (parsedGender !== null) {
						// 1순위: 명령어로 지정된 성별
						gender = parsedGender;
					} else if (inactivePerson) {
						// 2순위: 미참가자 목록의 성별
						gender = inactivePerson.gender;
					}
					// else: 3순위 기본값 'male' 유지

					// 가중치 결정
					if (parsedWeight !== null) {
						// 1순위: 명령어로 지정된 가중치
						weight = Math.max(0, parsedWeight);
					} else if (inactivePerson) {
						// 2순위: 미참가자 목록의 가중치
						weight = inactivePerson.weight;
					}
					// else: 3순위 기본값 0 유지 (입력 필드 값 사용 안 함)

					const person = {
						id: state.nextId++,
						name: actualName,
						gender: gender,
						weight: weight
					};
					state.people.push(person);
					newIds.push(person.id);
					addedAny = true;

					// 미참가자 목록에서 제거
					if (inactivePerson) {
						state.inactivePeople = state.inactivePeople.filter(p => normalizeName(p.name) !== normalized);
					}
				});
			if (newIds.length > 1) newGroupsToAdd.push(newIds);
		});

	// 5단계: 새 그룹들을 마지막에 추가하면서 미리보기 색상 적용
	newGroupsToAdd.forEach((group, idx) => {
		const newGroupIndex = state.requiredGroups.length;
		state.requiredGroups.push(group);

		// 미리보기 색상이 있으면 해당 위치에 색상 설정
		if (groupColorIndices && pendingAddData && pendingAddData.previewColors && pendingAddData.previewColors[idx]) {
			// state.groupColors 배열을 확장하여 해당 인덱스에 색상 저장
			while (state.groupColors.length <= newGroupIndex) {
				state.groupColors.push(state.groupColors[state.groupColors.length % 11] || '#94a3b8');
			}
			state.groupColors[newGroupIndex] = pendingAddData.previewColors[idx];
		}
	});

	if (addedAny) {
		saveToLocalStorage();
		renderPeople();
		// 사람을 추가한 이후 보류 중인 텍스트 분리을 해결 시도
		tryResolvePendingConstraints();
		// 사람을 추가한 이후 보류 중인 히든 그룹을 해결 시도
		tryResolveHiddenGroups();
	}
}

function removePerson(id, isCompleteDelete = false) {
	const person = state.people.find(p => p.id === id);
	if (person) {
		// isCompleteDelete가 true가 아닌 경우에만 미참가자 목록에 추가
		if (!isCompleteDelete) {
			// 미참가자 목록에 추가 (중복 확인)
			const normalized = normalizeName(person.name);
			const existingInactive = state.inactivePeople.find(p => normalizeName(p.name) === normalized);
			if (!existingInactive) {
				// id 제거하고 미참가자 목록에 추가
				const inactivePerson = {
					name: person.name,
					gender: person.gender,
					weight: person.weight
				};
				state.inactivePeople.push(inactivePerson);
			}
		} else {
			console.log(`완전 삭제: ${person.name}이(가) 완전히 삭제되었습니다.`);
		}
	}

	state.people = state.people.filter(p => p.id !== id);
	state.requiredGroups = state.requiredGroups.map(group => group.filter(pid => pid !== id));
	state.requiredGroups = state.requiredGroups.filter(group => group.length > 1);

	// 이 사람이 포함된 분리을 이름 기반 보류 분리으로 변환 (분리 유지)
	if (person) {
		const personName = normalizeName(person.name);
		state.forbiddenPairs.forEach(([a, b]) => {
			if (a === id || b === id) {
				const otherPerson = state.people.find(p => p.id === (a === id ? b : a));
				if (otherPerson) {
					const otherName = normalizeName(otherPerson.name);
					// 보류 분리으로 변환
					const exists = state.pendingConstraints.some(pc =>
						(pc.left === personName && pc.right === otherName) ||
						(pc.left === otherName && pc.right === personName)
					);
					if (!exists) {
						state.pendingConstraints.push({ left: personName, right: otherName });
						console.log(`분리 보존: ${person.name} - ${otherPerson.name} 분리이 보류 상태로 변환되었습니다.`);
					}
				}
			}
		});
	}

	// id 기반 분리 제거 (이미 보류로 변환됨)
	state.forbiddenPairs = state.forbiddenPairs.filter(([a, b]) => a !== id && b !== id);
	buildForbiddenMap();

	// 히든 그룹도 이름 기반 보류로 변환 (규칙 유지)
	if (person) {
		const personName = person.name;
		state.hiddenGroups.forEach(([a, b, prob]) => {
			if (a === id || b === id) {
				const otherPerson = state.people.find(p => p.id === (a === id ? b : a));
				if (otherPerson) {
					// 보류 히든 그룹으로 변환
					const exists = state.pendingHiddenGroups.some(pg =>
						(pg.left === personName && pg.right === otherPerson.name) ||
						(pg.left === otherPerson.name && pg.right === personName)
					);
					if (!exists) {
						state.pendingHiddenGroups.push({
							left: personName,
							right: otherPerson.name,
							probability: prob
						});
						console.log(`히든 그룹 보존: ${personName} - ${otherPerson.name}(${prob}%) 규칙이 보류 상태로 변환되었습니다.`);
					}
				}
			}
		});
	}

	// id 기반 히든 그룹 제거 (이미 보류로 변환됨)
	state.hiddenGroups = state.hiddenGroups.filter(([a, b]) => a !== id && b !== id);

	saveToLocalStorage();
	renderPeople();
	if (forbiddenPopup && !forbiddenPopup.closed) renderForbiddenWindowContent();
}

function updatePersonGender(id, gender) {
	const person = state.people.find(p => p.id === id);
	if (person) {
		person.gender = gender;
		saveToLocalStorage();
	}
}

function updatePersonWeight(id, weight) {
	const person = state.people.find(p => p.id === id);
	if (person) {
		person.weight = parseInt(weight) || 0;
		saveToLocalStorage();
	}
}

function updatePersonName(id, name) {
	const person = state.people.find(p => p.id === id);
	if (person) {
		person.name = name;
		saveToLocalStorage();
	}
}

function openEditModal(person) {
	editingPersonId = person.id;

	document.getElementById('editPersonName').value = person.name;

	document.getElementById('editGenderMale').classList.toggle('active', person.gender === 'male');
	document.getElementById('editGenderFemale').classList.toggle('active', person.gender !== 'male');

	document.getElementById('editPersonWeight').value = person.weight;

	const modal = document.getElementById('editPersonModal');
	modal.style.display = 'flex';
	requestAnimationFrame(() => modal.classList.add('visible'));
	document.getElementById('editPersonName').focus();
}

function closeEditModal() {
	const modal = document.getElementById('editPersonModal');
	modal.classList.remove('visible');
	setTimeout(() => { modal.style.display = 'none'; }, 250);
	editingPersonId = null;
}

function saveEditModal() {
	if (!editingPersonId) return;
	const person = state.people.find(p => p.id === editingPersonId);
	if (!person) return;

	const newName = document.getElementById('editPersonName').value.trim();
	if (newName) person.name = newName;

	if (state.genderBalanceEnabled) {
		person.gender = document.getElementById('editGenderMale').classList.contains('active') ? 'male' : 'female';
	}

	if (state.weightBalanceEnabled) {
		const w = parseInt(document.getElementById('editPersonWeight').value);
		person.weight = isNaN(w) ? 0 : w;
	}

	saveToLocalStorage();
	closeEditModal();
	renderPeople();
}

// ==================== 프로필 로그인 모달 ====================
function updateLoginUI() {
	const loginBtn = document.getElementById('loginTriggerBtn');
	const signupBtn = document.getElementById('signupTriggerBtn');
	const pwChangeBtn = document.getElementById('passwordChangeTriggerBtn');
	const logoutDirectBtn = document.getElementById('logoutDirectBtn');
	const statusText = document.getElementById('loginStatusText');

	if (currentProfileKey) {
		if (loginBtn) loginBtn.style.display = 'none';
		if (signupBtn) signupBtn.style.display = 'none';
		if (pwChangeBtn) pwChangeBtn.style.display = '';
		if (logoutDirectBtn) logoutDirectBtn.style.display = '';
		if (statusText) {
			statusText.textContent = `${currentProfileKey}님 환영합니다.`;
			statusText.classList.add('logged-in');
		}
	} else if (_readOnlyMode && _readOnlyProfileKey) {
		if (loginBtn) loginBtn.style.display = '';
		if (signupBtn) signupBtn.style.display = '';
		if (pwChangeBtn) pwChangeBtn.style.display = 'none';
		if (logoutDirectBtn) logoutDirectBtn.style.display = 'none';
		if (statusText) {
			statusText.textContent = '';
			statusText.classList.remove('logged-in');
		}
	} else {
		if (loginBtn) { loginBtn.style.display = ''; loginBtn.textContent = '로그인'; loginBtn.classList.remove('logged-in'); }
		if (signupBtn) signupBtn.style.display = '';
		if (pwChangeBtn) pwChangeBtn.style.display = 'none';
		if (logoutDirectBtn) logoutDirectBtn.style.display = 'none';
		if (statusText) {
			statusText.textContent = '';
			statusText.classList.remove('logged-in');
		}
	}
}

function openLoginModal() {
	const modal = document.getElementById('profileLoginModal');
	if (!modal) return;
	const loginSection = document.getElementById('loginFormSection');
	const logoutSection = document.getElementById('logoutFormSection');
	const errorEl = document.getElementById('loginErrorText');
	const idInput = document.getElementById('loginIdInput');
	const pwInput = document.getElementById('loginPwInput');
	if (errorEl) errorEl.textContent = '';
	if (idInput) idInput.value = '';
	if (pwInput) pwInput.value = '';

	if (currentProfileKey) {
		const nameEl = document.getElementById('loggedInUsernameText');
		if (nameEl) nameEl.textContent = currentProfileKey;
		if (loginSection) loginSection.style.display = 'none';
		if (logoutSection) logoutSection.style.display = '';
	} else {
		if (loginSection) loginSection.style.display = '';
		if (logoutSection) logoutSection.style.display = 'none';
	}

	modal.style.display = 'flex';
	requestAnimationFrame(() => {
		modal.classList.add('visible');
		if (!currentProfileKey && idInput) idInput.focus();
	});
}

function closeLoginModal() {
	const modal = document.getElementById('profileLoginModal');
	if (!modal) return;
	modal.classList.remove('visible');
	setTimeout(() => { modal.style.display = 'none'; }, 250);
}

// ==================== 프로필 생성 모달 ====================
function openSignupModal() {
	const modal = document.getElementById('profileSignupModal');
	if (!modal) return;
	const idInput = document.getElementById('signupIdInput');
	const pwInput = document.getElementById('signupPwInput');
	const pwConfirmInput = document.getElementById('signupPwConfirmInput');
	const errorEl = document.getElementById('signupErrorText');
	if (idInput) idInput.value = '';
	if (pwInput) pwInput.value = '';
	if (pwConfirmInput) pwConfirmInput.value = '';
	if (errorEl) errorEl.textContent = '';
	modal.style.display = 'flex';
	requestAnimationFrame(() => {
		modal.classList.add('visible');
		if (idInput) idInput.focus();
	});
}

function closeSignupModal() {
	const modal = document.getElementById('profileSignupModal');
	if (!modal) return;
	modal.classList.remove('visible');
	setTimeout(() => { modal.style.display = 'none'; }, 250);
}

// ==================== 정보 변경 모달 ====================
function openPasswordChangeModal() {
	const modal = document.getElementById('passwordChangeModal');
	if (!modal) return;
	hideDeleteConfirmSection();
	['pwChangeCurrentInput', 'pwChangeNewInput', 'pwChangeConfirmInput'].forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.value = '';
	});
	const errorEl = document.getElementById('pwChangeErrorText');
	if (errorEl) errorEl.textContent = '';
	modal.style.display = 'flex';
	requestAnimationFrame(() => {
		modal.classList.add('visible');
		const cur = document.getElementById('pwChangeCurrentInput');
		if (cur) cur.focus();
	});
}

function closePasswordChangeModal() {
	const modal = document.getElementById('passwordChangeModal');
	if (!modal) return;
	modal.classList.remove('visible');
	setTimeout(() => { modal.style.display = 'none'; }, 250);
}

function showDeleteConfirmSection() {
	const normalSection = document.getElementById('pwChangeSectionNormal');
	const deleteSection = document.getElementById('pwChangeDeleteConfirmSection');
	if (normalSection) normalSection.style.display = 'none';
	if (deleteSection) deleteSection.style.display = '';
	const errEl = document.getElementById('pwChangeDeleteErrorText');
	if (errEl) errEl.textContent = '';
	const pwInput = document.getElementById('deleteConfirmPwInput');
	if (pwInput) { pwInput.value = ''; pwInput.focus(); }
}

function hideDeleteConfirmSection() {
	const normalSection = document.getElementById('pwChangeSectionNormal');
	const deleteSection = document.getElementById('pwChangeDeleteConfirmSection');
	if (normalSection) normalSection.style.display = '';
	if (deleteSection) deleteSection.style.display = 'none';
	const pwInput = document.getElementById('deleteConfirmPwInput');
	if (pwInput) pwInput.value = '';
	const errEl = document.getElementById('pwChangeDeleteErrorText');
	if (errEl) errEl.textContent = '';
}

async function handleProfileDelete() {
	if (!currentProfileKey || !database) return;
	const errorEl = document.getElementById('pwChangeDeleteErrorText');
	const deleteBtn = document.getElementById('profileDeleteConfirmBtn');
	const pwInput = document.getElementById('deleteConfirmPwInput');

	const enteredPw = pwInput ? pwInput.value : '';
	if (!enteredPw) {
		if (errorEl) errorEl.textContent = '현재 비밀번호를 입력하세요.';
		if (pwInput) pwInput.focus();
		return;
	}

	// 현재 비밀번호 검증
	let storedPw = '';
	try {
		const snap = await database.ref(`profiles/${currentProfileKey}/password`).once('value');
		storedPw = String(snap.val() || '');
	} catch (_) {}
	if (storedPw !== enteredPw) {
		if (errorEl) errorEl.textContent = '비밀번호가 올바르지 않습니다.';
		if (pwInput) { pwInput.value = ''; pwInput.focus(); }
		return;
	}

	if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.textContent = '삭제 중...'; }
	try {
		const username = currentProfileKey;
		await database.ref(`profiles/${username}`).update({
			password: null,
			deleted: true,
			deletedAt: new Date().toISOString(),
			_label: `${username} (deleted)`
		});
		logoutProfile();
		updateLoginUI();
		closePasswordChangeModal();
	} catch (_) {
		if (errorEl) errorEl.textContent = '삭제에 실패했습니다.';
		if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = '삭제'; }
	}
}

async function handlePasswordChangeSubmit() {
	const currentPw = document.getElementById('pwChangeCurrentInput');
	const newPw = document.getElementById('pwChangeNewInput');
	const confirmPw = document.getElementById('pwChangeConfirmInput');
	const errorEl = document.getElementById('pwChangeErrorText');
	if (errorEl) errorEl.textContent = '';

	const current = currentPw ? currentPw.value : '';
	const next = newPw ? newPw.value : '';
	const confirm = confirmPw ? confirmPw.value : '';

	if (!current) { if (errorEl) errorEl.textContent = '현재 비밀번호를 입력하세요.'; if (currentPw) currentPw.focus(); return; }
	if (!next) { if (errorEl) errorEl.textContent = '새 비밀번호를 입력하세요.'; if (newPw) newPw.focus(); return; }
	if (next !== confirm) { if (errorEl) errorEl.textContent = '새 비밀번호가 일치하지 않습니다.'; if (confirmPw) { confirmPw.value = ''; confirmPw.focus(); } return; }
	if (!currentProfileKey || !database) { if (errorEl) errorEl.textContent = '로그인 상태가 아닙니다.'; return; }

	// 현재 비밀번호 검증
	let storedPw = '';
	try {
		const snap = await database.ref(`profiles/${currentProfileKey}/password`).once('value');
		storedPw = String(snap.val() || '');
	} catch (_) {}
	if (storedPw !== current) {
		if (errorEl) errorEl.textContent = '현재 비밀번호가 올바르지 않습니다.';
		if (currentPw) { currentPw.value = ''; currentPw.focus(); }
		return;
	}

	const submitBtn = document.getElementById('pwChangeSubmitBtn');
	if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '변경 중...'; }
	try {
		await database.ref(`profiles/${currentProfileKey}/password`).set(next);
		authenticatedPassword = next;
		if (commandConsole) commandConsole.storedPassword = next;
	} catch (_) {
		if (errorEl) errorEl.textContent = '비밀번호 변경에 실패했습니다.';
		if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '변경'; }
		return;
	}
	if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '변경'; }
	closePasswordChangeModal();
}

function buildProfileStatePayload() {
	return {
		people: state.people,
		inactivePeople: state.inactivePeople,
		requiredGroups: state.requiredGroups,
		nextId: state.nextId,
		forbiddenPairs: state.forbiddenPairs,
		pendingConstraints: state.pendingConstraints,
		reservations: state.reservations,
		hiddenGroups: state.hiddenGroups,
		hiddenGroupChains: state.hiddenGroupChains,
		pendingHiddenGroups: state.pendingHiddenGroups,
		pendingHiddenGroupChains: state.pendingHiddenGroupChains,
		probabilisticForbiddenPairs: state.probabilisticForbiddenPairs,
		maxTeamSizeEnabled: state.maxTeamSizeEnabled,
		genderBalanceEnabled: state.genderBalanceEnabled,
		weightBalanceEnabled: state.weightBalanceEnabled,
		membersPerTeam: state.membersPerTeam
	};
}

async function handleSignupSubmit() {
	const idInput = document.getElementById('signupIdInput');
	const pwInput = document.getElementById('signupPwInput');
	const pwConfirmInput = document.getElementById('signupPwConfirmInput');
	const errorEl = document.getElementById('signupErrorText');
	const username = (idInput ? idInput.value : '').trim();
	const password = pwInput ? pwInput.value : '';
	const passwordConfirm = pwConfirmInput ? pwConfirmInput.value : '';
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
	if (password !== passwordConfirm) {
		if (errorEl) errorEl.textContent = '비밀번호가 일치하지 않습니다.';
		if (pwConfirmInput) { pwConfirmInput.value = ''; pwConfirmInput.focus(); }
		return;
	}

	if (!database) {
		if (typeof initFirebase === 'function') initFirebase();
	}
	if (!database) {
		if (errorEl) errorEl.textContent = 'Firebase에 연결할 수 없습니다.';
		return;
	}

	const submitBtn = document.getElementById('signupSubmitBtn');
	if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '처리 중...'; }

	// 중복 아이디 확인
	let alreadyExists = false;
	try {
		const snap = await database.ref(`profiles/${username}`).once('value');
		alreadyExists = snap.exists();
	} catch (_) {}

	if (alreadyExists) {
		if (errorEl) errorEl.textContent = '이미 사용 중인 아이디입니다.';
		if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '확인'; }
		if (idInput) idInput.focus();
		return;
	}

	// 프로필 생성 — 빈 상태로만 저장 (현재 화면 상태 포함 안 함)
	const now = (typeof getCurrentDbTimestamp === 'function') ? getCurrentDbTimestamp() : new Date().toISOString();
	const token = (typeof generateCode === 'function') ? generateCode(12) : Math.random().toString(36).slice(2, 14).toUpperCase();
	const profileData = {
		password,
		token,
		createdAt: now,
		timestamp: now
	};

	try {
		await database.ref(`profiles/${username}`).set(profileData);
		await database.ref(`profileTokens/${token}`).set(username);
	} catch (e) {
		if (errorEl) errorEl.textContent = '프로필 생성에 실패했습니다.';
		if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '확인'; }
		return;
	}

	if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '확인'; }

	// 자동 로그인
	closeForbiddenPopup();
	setSessionProfile(username);
	currentProfileKey = username;
	setCurrentProfileSource('profiles');
	authenticatedPassword = password;
	commandConsole.authenticated = true;
	commandConsole.storedPassword = password;
	syncEnabled = true;

	// 화면을 빈 상태로 초기화 (auto-save 타이머 취소 후)
	clearTimeout(_profileAutoSaveTimer);
	clearState();

	initFirebase();
	syncListenerAttached = false;
	setupRealtimeSync();

	const profileKeyDisplay = document.getElementById('profileKeyDisplay');
	if (profileKeyDisplay) {
		profileKeyDisplay.textContent = `🔑 ${currentProfileKey}`;
		profileKeyDisplay.classList.add('authenticated');
	}

	updateLoginUI();
	closeSignupModal();
}

async function handleLoginSubmit() {
	const idInput = document.getElementById('loginIdInput');
	const pwInput = document.getElementById('loginPwInput');
	const errorEl = document.getElementById('loginErrorText');
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

	if (!database) {
		if (typeof initFirebase === 'function') initFirebase();
	}
	if (!database) {
		if (errorEl) errorEl.textContent = 'Firebase에 연결할 수 없습니다.';
		return;
	}

	const submitBtn = document.getElementById('loginSubmitBtn');
	if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '확인 중...'; }

	const result = await loginProfile(username, password);

	if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '로그인'; }

	if (!result.ok) {
		if (errorEl) errorEl.textContent = result.error || '로그인에 실패했습니다.';
		if (pwInput) { pwInput.value = ''; pwInput.focus(); }
		return;
	}

	// 자동 로그인 설정 저장/해제
	const autoLoginCheckbox = document.getElementById('autoLoginCheckbox');
	if (autoLoginCheckbox && autoLoginCheckbox.checked) {
		try { localStorage.setItem('profileAutoLogin', JSON.stringify({ username, password })); } catch (_) {}
	} else {
		try { localStorage.removeItem('profileAutoLogin'); } catch (_) {}
	}

	// 로그인 성공
	closeForbiddenPopup();
	exitReadOnlyMode();
	commandConsole.authenticated = true;
	commandConsole.storedPassword = password;
	syncEnabled = true;

	// 프로필 토큰 자동 생성 (없을 경우)
	if (typeof ensureProfileToken === 'function') ensureProfileToken(currentProfileKey);
	if (typeof setOnlinePresence === 'function') setOnlinePresence();
	startProfileSession(currentProfileKey, 'login');
	startUserSession();

	// Firebase 초기화 후 데이터 로드
	initFirebase();
	resolveProfileRecord(currentProfileKey)
		.then((res) => {
			clearTimeout(_profileAutoSaveTimer);
			if (res.data) {
				loadStateFromData(res.data);
			} else {
				clearState();
			}
			syncListenerAttached = false;
			setupRealtimeSync();
		})
		.catch(() => {
			clearTimeout(_profileAutoSaveTimer);
			clearState();
		});

	// profileKeyDisplay 업데이트
	const profileKeyDisplay = document.getElementById('profileKeyDisplay');
	if (profileKeyDisplay) {
		profileKeyDisplay.textContent = `🔑 ${currentProfileKey}`;
		profileKeyDisplay.classList.add('authenticated');
	}

	updateLoginUI();
	closeLoginModal();
}

function handleLogout() {
	closeForbiddenPopup();
	try { localStorage.removeItem('profileAutoLogin'); } catch (_) {}
	try { localStorage.removeItem('_uSessionStart'); localStorage.removeItem('_uSessionHb'); } catch (_) {}
	// debounce 대기 중인 저장이 있으면 로그아웃 전에 즉시 flush (currentProfileKey가 유효한 동안)
	flushProfileAutoSave();
	if (currentProfileKey) stopProfileSession(currentProfileKey);
	if (typeof clearOnlinePresence === 'function') clearOnlinePresence();
	if (typeof logoutProfile === 'function') logoutProfile();
	// 로그아웃 후 익명 유저로 users online 유지
	if (typeof setOnlinePresence === 'function') setOnlinePresence();
	commandConsole.authenticated = false;
	commandConsole.storedPassword = null;

	const profileKeyDisplay = document.getElementById('profileKeyDisplay');
	if (profileKeyDisplay) {
		profileKeyDisplay.textContent = '';
		profileKeyDisplay.classList.remove('authenticated');
	}

	clearState();
	exitReadOnlyMode();
	renderPeople();
	updateLoginUI();
	closeLoginModal();
}

async function tryAutoLogin() {
	let saved = null;
	try { saved = JSON.parse(localStorage.getItem('profileAutoLogin') || 'null'); } catch (_) {}
	if (!saved || !saved.username || !saved.password) return;

	if (!database && typeof initFirebase === 'function') initFirebase();
	if (!database) return;

	const result = await loginProfile(saved.username, saved.password);
	if (!result.ok) {
		// 저장된 자격증명이 유효하지 않으면 삭제
		try { localStorage.removeItem('profileAutoLogin'); } catch (_) {}
		return;
	}

	exitReadOnlyMode();
	commandConsole.authenticated = true;
	commandConsole.storedPassword = saved.password;
	syncEnabled = true;

	if (typeof ensureProfileToken === 'function') ensureProfileToken(currentProfileKey);
	if (typeof setOnlinePresence === 'function') setOnlinePresence();
	startProfileSession(currentProfileKey, 'login');
	startUserSession();

	initFirebase();
	resolveProfileRecord(currentProfileKey)
		.then((res) => {
			clearTimeout(_profileAutoSaveTimer);
			if (res.data) {
				loadStateFromData(res.data);
			} else {
				clearState();
			}
			syncListenerAttached = false;
			setupRealtimeSync();
		})
		.catch(() => {
			clearTimeout(_profileAutoSaveTimer);
			clearState();
		});

	const profileKeyDisplay = document.getElementById('profileKeyDisplay');
	if (profileKeyDisplay) {
		profileKeyDisplay.textContent = `🔑 ${currentProfileKey}`;
		profileKeyDisplay.classList.add('authenticated');
	}

	updateLoginUI();
}

// --- 분리 및 이름 정규화 관련 헬퍼 함수들 ---
function normalizeName(name) {
	// 괄호 패턴 제거: 이름(남100) -> 이름
	const withoutParentheses = (name || '').replace(/\([^)]*\)$/, '').trim();
	return withoutParentheses.toLowerCase();
}

function findPersonByName(name) {
	return state.people.find(p => normalizeName(p.name) === normalizeName(name));
}

function findPersonByIdAny(id) {
	const numericId = Number(id);
	const isSameId = (person) => Number(person?.id) === numericId;
	return state.people.find(isSameId) || state.inactivePeople.find(isSameId) || null;
}

function addForbiddenPairByNames(nameA, nameB) {
	const pa = findPersonByName(nameA);
	const pb = findPersonByName(nameB);
	if (!pa || !pb) {
		const msg = `등록된 사용자 중에 ${!pa ? nameA : nameB}을(를) 찾을 수 없습니다.`;
		// 실패 메시지는 UI 팝업에서 처리하므로 콘솔 로그는 제거
		return { ok: false, message: msg };
	}
	if (pa.id === pb.id) {
		const msg = commandConsoleMessages.comments.samePersonConstraintError;
		console.log(commandConsoleMessages.comments.constraintAddFailed, msg);
		return { ok: false, message: msg };
	}
	const gA = getPersonGroupIndex(pa.id);
	const gB = getPersonGroupIndex(pb.id);
	if (gA !== -1 && gA === gB) {
		const msg = `${pa.name}${commandConsoleMessages.comments.sameGroupConstraintError.replace('와 는', '와 ' + pb.name + '는')}`;
		console.log(commandConsoleMessages.comments.constraintAddFailed, msg);
		return { ok: false, message: msg };
	}
	const exists = state.forbiddenPairs.some(([a, b]) => (a === pa.id && b === pb.id) || (a === pb.id && b === pa.id));
	if (!exists) {
		state.forbiddenPairs.push([pa.id, pb.id]);
		buildForbiddenMap();
		saveToLocalStorage();
	}
	return { ok: true, added: !exists };
}

function removeProbabilisticForbiddenPairByNames(nameA, nameB) {
	const left = normalizeName(nameA);
	const right = normalizeName(nameB);
	const before = state.probabilisticForbiddenPairs.length;
	state.probabilisticForbiddenPairs = state.probabilisticForbiddenPairs.filter(p =>
		!((p.left === left && p.right === right) || (p.left === right && p.right === left))
	);
	return before - state.probabilisticForbiddenPairs.length;
}

function removeProbabilisticForbiddenByName(name) {
	const n = normalizeName(name);
	const before = state.probabilisticForbiddenPairs.length;
	state.probabilisticForbiddenPairs = state.probabilisticForbiddenPairs.filter(p =>
		p.left !== n && p.right !== n
	);
	return before - state.probabilisticForbiddenPairs.length;
}

function removeHiddenRulePairByNames(nameA, nameB) {
	const left = normalizeName(nameA);
	const right = normalizeName(nameB);
	let removed = 0;

	// hiddenGroupChains (등록 규칙)
	const chain = state.hiddenGroupChains.find(c => normalizeName(c.primary) === left);
	if (chain) {
		const beforeLen = chain.candidates.length;
		chain.candidates = chain.candidates.filter(c => normalizeName(c.name) !== right);
		if (chain.candidates.length === 0) {
			state.hiddenGroupChains = state.hiddenGroupChains.filter(c => c !== chain);
		}
		if (beforeLen !== chain.candidates.length) removed++;
	}
	const reverseChain = state.hiddenGroupChains.find(c => normalizeName(c.primary) === right);
	if (reverseChain) {
		const beforeLen = reverseChain.candidates.length;
		reverseChain.candidates = reverseChain.candidates.filter(c => normalizeName(c.name) !== left);
		if (reverseChain.candidates.length === 0) {
			state.hiddenGroupChains = state.hiddenGroupChains.filter(c => c !== reverseChain);
		}
		if (beforeLen !== reverseChain.candidates.length) removed++;
	}

	// pendingHiddenGroups (보류 규칙)
	const beforePending = state.pendingHiddenGroups.length;
	state.pendingHiddenGroups = state.pendingHiddenGroups.filter(p =>
		!((normalizeName(p.left) === left && normalizeName(p.right) === right) ||
		  (normalizeName(p.left) === right && normalizeName(p.right) === left))
	);
	if (state.pendingHiddenGroups.length !== beforePending) removed++;

	// pendingHiddenGroupChains (보류 체인)
	const pendingChain = state.pendingHiddenGroupChains.find(c => normalizeName(c.primary) === left);
	if (pendingChain) {
		const beforeLen = pendingChain.candidates.length;
		pendingChain.candidates = pendingChain.candidates.filter(c => normalizeName(c.name) !== right);
		if (pendingChain.candidates.length === 0) {
			state.pendingHiddenGroupChains = state.pendingHiddenGroupChains.filter(c => c !== pendingChain);
		}
		if (beforeLen !== pendingChain.candidates.length) removed++;
	}
	const reversePendingChain = state.pendingHiddenGroupChains.find(c => normalizeName(c.primary) === right);
	if (reversePendingChain) {
		const beforeLen = reversePendingChain.candidates.length;
		reversePendingChain.candidates = reversePendingChain.candidates.filter(c => normalizeName(c.name) !== left);
		if (reversePendingChain.candidates.length === 0) {
			state.pendingHiddenGroupChains = state.pendingHiddenGroupChains.filter(c => c !== reversePendingChain);
		}
		if (beforeLen !== reversePendingChain.candidates.length) removed++;
	}

	// hiddenGroups (id 기반 규칙)
	const pa = findPersonByName(nameA);
	const pb = findPersonByName(nameB);
	if (pa && pb) {
		const beforeHidden = state.hiddenGroups.length;
		state.hiddenGroups = state.hiddenGroups.filter(([a, b]) =>
			!((a === pa.id && b === pb.id) || (a === pb.id && b === pa.id))
		);
		if (state.hiddenGroups.length !== beforeHidden) removed++;
	}

	return removed;
}

// 확률 분리 등록 (이름 기반, 참가자 없어도 등록 가능)
function addProbabilisticForbiddenPairByNames(nameA, nameB, probability) {
	const left = normalizeName(nameA);
	const right = normalizeName(nameB);
	if (!left || !right) return { ok: false, message: commandConsoleMessages.comments.nameRequired };
	if (left === right) return { ok: false, message: commandConsoleMessages.comments.samePersonConstraintError };
	const prob = Math.max(0, Math.min(100, parseInt(probability, 10) || 0));

	// 동일한 일반 규칙이 있으면 제거 (A(10)B -> A(!10)B)
	removeHiddenRulePairByNames(nameA, nameB);

	const existing = state.probabilisticForbiddenPairs.find(p =>
		(p.left === left && p.right === right) || (p.left === right && p.right === left)
	);
	if (existing) {
		existing.probability = prob;
		existing.leftRaw = (nameA || '').trim();
		existing.rightRaw = (nameB || '').trim();
		return { ok: true, updated: true };
	}
	state.probabilisticForbiddenPairs.push({
		left,
		right,
		leftRaw: (nameA || '').trim(),
		rightRaw: (nameB || '').trim(),
		probability: prob
	});
	return { ok: true, added: true };
}

// 이름 기반 보류 분리 추가 (참가자가 없어도 추가 가능)
function addPendingConstraint(leftName, rightName) {
	const l = normalizeName(leftName);
	const r = normalizeName(rightName);
	if (l === r) return { ok: false, message: commandConsoleMessages.comments.samePersonConstraintError };
	// 보류 목록에서 중복 방지
	const existsPending = state.pendingConstraints.some(pc => pc.left === l && pc.right === r);
	if (existsPending) { return { ok: true }; }
	state.pendingConstraints.push({ left: l, right: r });
	saveToLocalStorage();
	return { ok: true };
}

// 새 참가자 추가 시 보류 분리을 해결하려 시도
function tryResolvePendingConstraints() {
	if (!state.pendingConstraints.length) return;
	let changed = false;
	state.pendingConstraints = state.pendingConstraints.filter(pc => {
		const pa = findPersonByName(pc.left);
		const pb = findPersonByName(pc.right);
		if (pa && pb) {
			const res = addForbiddenPairByNames(pa.name, pb.name);
			// 과도한 로그를 피하기 위해; addForbiddenPairByNames가 콘솔을 갱신합니다
			changed = true;
			return false; // 보류 목록에서 제거
		}
		return true; // 보류 유지
	});
	if (changed) {
		buildForbiddenMap();
		saveToLocalStorage();
		if (forbiddenPopup && !forbiddenPopup.closed) renderForbiddenWindowContent();
	}
}

// 로컬 보기(file:// 또는 localhost) 감지 — 개발 편의를 위해 동작을 조정
function isLocalView() {
	try {
		const proto = window.location.protocol || '';
		const host = window.location.hostname || '';
		return proto === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
	} catch (e) {
		return false;
	}
}

// 그룹 색상 팔레트를 한 번만 랜덤 셔플
function shuffleGroupColorsOnce() {
	if (state._groupColorsShuffled) return;
	state._groupColorsShuffled = true;
	const arr = state.groupColors;
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
}

// CSS 변수로 팀원 표시 애니메이션 시간 설정 (teamDisplayDelay의 50%)
function setTeamAnimDurationFromDelay() {
	try {
		const dur = Math.max(50, Math.round((state.teamDisplayDelay || 400) * 0.75));
		document.documentElement.style.setProperty('--team-anim-duration', dur + 'ms');
	} catch (_) { /* no-op */ }
}

function getTeamAnimDurationMs() {
	// 애니메이션 지속시간(ms) 계산을 통일
	return Math.max(50, Math.round((state.teamDisplayDelay || 400) * 0.75));
}



// 이름으로 분리 제거 (적용된 id 기반 분리 또는 보류 분리 모두 지원). 순서는 무관합니다.
function removeForbiddenPairByNames(nameA, nameB) {
	const na = normalizeName(nameA);
	const nb = normalizeName(nameB);
	if (na === nb) {
		console.log(commandConsoleMessages.comments.constraintRemoveFailed);
		return { ok: false, message: commandConsoleMessages.comments.constraintRemoveFailed };
	}
	// 둘 다 존재하면 적용된(id 기반) 분리을 먼저 제거 시도
	const pa = findPersonByName(na);
	const pb = findPersonByName(nb);
	if (pa && pb) {
		const before = state.forbiddenPairs.length;
		state.forbiddenPairs = state.forbiddenPairs.filter(([a, b]) => !((a === pa.id && b === pb.id) || (a === pb.id && b === pa.id)));
		if (state.forbiddenPairs.length !== before) {
			buildForbiddenMap();
			saveToLocalStorage();
			return { ok: true };
		}
	}
	// 적용된 분리을 찾지 못했거나 사람이 없으면 보류 중인 텍스트 분리(순서 무관)을 제거
	const beforePending = state.pendingConstraints.length;
	state.pendingConstraints = state.pendingConstraints.filter(pc => !( (pc.left === na && pc.right === nb) || (pc.left === nb && pc.right === na) ));
	if (state.pendingConstraints.length !== beforePending) {
		saveToLocalStorage();
		return { ok: true };
	}
	return { ok: false, message: commandConsoleMessages.comments.constraintNotFound };
}

function buildForbiddenMap() {
	state.forbiddenMap = {};
	state.forbiddenPairs.forEach(([a, b]) => {
		if (!state.forbiddenMap[a]) state.forbiddenMap[a] = new Set();
		if (!state.forbiddenMap[b]) state.forbiddenMap[b] = new Set();
		state.forbiddenMap[a].add(b);
		state.forbiddenMap[b].add(a);
	});
}

// 예약을 임시 히든 그룹으로 적용 (팀 생성 시에만 사용)
function applyReservationAsHiddenGroup(reservationNames) {
	if (!reservationNames || reservationNames.length === 0) return;

	// 예약된 이름들을 ID로 변환 (참가자 목록에 있는 것만)
	const reservationIds = [];
	const notFoundNames = [];

	reservationNames.forEach(name => {
		const person = state.people.find(p => p.name === name);
		if (person) {
			reservationIds.push(person.id);
		} else {
			notFoundNames.push(name);
		}
	});

	// 팀 인원수보다 많은 경우 앞에서부터 membersPerTeam 만큼만 사용
	const maxReservationSize = state.membersPerTeam || reservationIds.length;
	const limitedReservationIds = reservationIds.slice(0, maxReservationSize);
	const excludedNames = reservationIds.slice(maxReservationSize).map(id =>
		state.people.find(p => p.id === id)?.name
	).filter(Boolean);
	if (limitedReservationIds.length <= 1) {
		window.appliedReservation = {
			names: reservationNames,
			foundNames: limitedReservationIds.map(id => state.people.find(p => p.id === id).name),
			additionalNames: [],
			notFoundNames: notFoundNames,
			excludedNames: excludedNames
		};
		return [...limitedReservationIds];
	}

	// 예약 그룹과 규칙의 상호작용 처리
	// 규칙 A(확률)B가 있고 예약에 B가 포함되어 있으면, A도 예약 그룹에 확률적으로 추가
	const additionalIds = [];

	// hiddenGroupChains 확인 (A(확률)B(확률)C 형태)
	state.hiddenGroupChains.forEach(chain => {
		const primaryPerson = state.people.find(p => p.name === chain.primary);
		if (!primaryPerson) return;

		// chain의 candidates 중에 예약에 포함된 사람이 있는지 확인
		for (const candidate of chain.candidates) {
			const candidatePerson = state.people.find(p => p.name === candidate.name);
			if (!candidatePerson) continue;

			// 예약에 candidate가 포함되어 있는지 확인 (제한된 예약 ID 기준)
			if (limitedReservationIds.includes(candidatePerson.id)) {
				// 확률 체크
				const random = Math.random() * 100;
				if (random < candidate.probability) {
					// primary를 예약 그룹에 추가
					if (!limitedReservationIds.includes(primaryPerson.id) && !additionalIds.includes(primaryPerson.id)) {
						additionalIds.push(primaryPerson.id);

						// 적용된 규칙 정보 저장
						if (!window.appliedReservationRules) {
							window.appliedReservationRules = [];
						}
						window.appliedReservationRules.push({
							primaryName: chain.primary,
							partnerName: candidate.name,
							probability: candidate.probability
						});
					}
					break; // 첫 번째 매칭 성공 시 중단
				}
			}
		}
	});

	// 추가 ID들을 예약 그룹에 포함 (제한된 예약 ID 사용)
	const finalReservationIds = [...limitedReservationIds, ...additionalIds];

	// 예약된 참가자들을 activeHiddenGroupMap에 직접 추가 (히든 그룹으로 처리)
	// 모든 예약 참가자를 서로 연결하여 하나의 클러스터로 만듦
	finalReservationIds.forEach(id1 => {
		if (!state.activeHiddenGroupMap[id1]) {
			state.activeHiddenGroupMap[id1] = new Set();
		}
		finalReservationIds.forEach(id2 => {
			if (id1 !== id2) {
				state.activeHiddenGroupMap[id1].add(id2);
			}
		});
	});

	// 예약 적용 정보 저장 (나중에 CMD 출력용)
	window.appliedReservation = {
		names: reservationNames,
		foundNames: limitedReservationIds.map(id => state.people.find(p => p.id === id).name),
		additionalNames: additionalIds.map(id => state.people.find(p => p.id === id).name),
		notFoundNames: notFoundNames,
		excludedNames: excludedNames // 팀 인원수 초과로 제외된 이름들
	};

	return [...finalReservationIds];
}

// 예약으로 추가된 임시 그룹 제거 (더 이상 필요 없음)
function removeTemporaryReservationGroup() {
	// activeHiddenGroupMap은 deactivateHiddenGroups에서 자동으로 초기화됨
	// 별도 처리 불필요
}

// 팀 생성 시 확률 분리 활성화 (확률 기반 금지)
function activateProbabilisticForbiddenPairsForTeamGeneration() {
	state.activeProbabilisticForbiddenPairs = [];
	state.probabilisticForbiddenPairs.forEach(rule => {
		const personA = findPersonByName(rule.left);
		const personB = findPersonByName(rule.right);
		if (!personA || !personB) return;
		const random = Math.random() * 100;
		if (random < rule.probability) {
			if (!state.forbiddenMap[personA.id]) state.forbiddenMap[personA.id] = new Set();
			if (!state.forbiddenMap[personB.id]) state.forbiddenMap[personB.id] = new Set();
			state.forbiddenMap[personA.id].add(personB.id);
			state.forbiddenMap[personB.id].add(personA.id);
			state.activeProbabilisticForbiddenPairs.push({
				aId: personA.id,
				bId: personB.id,
				probability: rule.probability,
				aName: personA.name,
				bName: personB.name
			});
		}
	});
}

// 팀 생성 시 히든 그룹 활성화 (확률 기반)
function activateHiddenGroupsForTeamGeneration() {
	state.activeHiddenGroupMap = {};
	state.activeHiddenGroupChainInfo = [];

	// 단일 쌍 히든 그룹 처리
	state.hiddenGroups.forEach(([a, b, probability]) => {
		// 확률에 따라 활성화 여부 결정
		const random = Math.random() * 100;
		// 참가자 이름 가져오기
		const personA = state.people.find(p => p.id === a);
		const personB = state.people.find(p => p.id === b);
		const nameA = personA ? personA.name : `ID ${a}`;
		const nameB = personB ? personB.name : `ID ${b}`;

		if (random < probability) {
			if (!state.activeHiddenGroupMap[a]) state.activeHiddenGroupMap[a] = new Set();
			if (!state.activeHiddenGroupMap[b]) state.activeHiddenGroupMap[b] = new Set();
			state.activeHiddenGroupMap[a].add(b);
			state.activeHiddenGroupMap[b].add(a);
		}
	});

	// 체인 히든 그룹 처리
	state.hiddenGroupChains.forEach(chain => {
		// primary 이름으로 참가자 찾기
		const primaryPerson = state.people.find(p => p.name === chain.primary);
		if (!primaryPerson) {
			return; // 주 참가자가 없으면 스킵
		}
		const primaryName = primaryPerson.name;

		let activated = false;
		for (const candidate of chain.candidates) {
			// candidate 이름으로 참가자 찾기
			const candidatePerson = state.people.find(p => p.name === candidate.name);
			if (!candidatePerson) {
				continue; // 후보가 없으면 다음 후보로
			}

			const random = Math.random() * 100;
			const candidateName = candidatePerson.name;

			if (random < candidate.probability) {
				// 활성화 성공
				if (!state.activeHiddenGroupMap[primaryPerson.id]) state.activeHiddenGroupMap[primaryPerson.id] = new Set();
				if (!state.activeHiddenGroupMap[candidatePerson.id]) state.activeHiddenGroupMap[candidatePerson.id] = new Set();
				state.activeHiddenGroupMap[primaryPerson.id].add(candidatePerson.id);
				state.activeHiddenGroupMap[candidatePerson.id].add(primaryPerson.id);

				// 체이닝 정보 저장 (배열에 추가)
				state.activeHiddenGroupChainInfo.push({
					primaryName: primaryName,
					candidateName: candidateName,
					probability: candidate.probability
				});

				activated = true;
				break; // 체인에서 첫 번째 성공하면 중단
			}
		}

		if (!activated) {
			// 체인 모두 실패
		}
	});
}

// 팀 생성 후 히든 그룹 해제
function deactivateHiddenGroups() {
	// 활성화된 히든 그룹 정보 출력
	const activatedPairs = new Set();
	Object.keys(state.activeHiddenGroupMap).forEach(aId => {
		state.activeHiddenGroupMap[aId].forEach(bId => {
			// 중복 출력 방지 (a-b와 b-a는 같은 쌍)
			const pairKey = [parseInt(aId), parseInt(bId)].sort((x, y) => x - y).join('-');
			if (!activatedPairs.has(pairKey)) {
				activatedPairs.add(pairKey);

				// 참가자 이름 가져오기
				const personA = state.people.find(p => p.id === parseInt(aId));
				const personB = state.people.find(p => p.id === parseInt(bId));
				const nameA = personA ? personA.name : `ID ${aId}`;
				const nameB = personB ? personB.name : `ID ${bId}`;

				// 체이닝으로 생성된 히든 그룹인지 확인
				let isChain = false;
				let primaryName = null;
				let partnerName = null;
				let probability = null;

				if (state.activeHiddenGroupChainInfo[aId] && state.activeHiddenGroupChainInfo[aId][bId]) {
					// aId가 primary
					isChain = true;
					primaryName = nameA;
					partnerName = nameB;
					probability = state.activeHiddenGroupChainInfo[aId][bId];
				} else if (state.activeHiddenGroupChainInfo[bId] && state.activeHiddenGroupChainInfo[bId][aId]) {
					// bId가 primary
					isChain = true;
					primaryName = nameB;
					partnerName = nameA;
					probability = state.activeHiddenGroupChainInfo[bId][aId];
				}

				if (isChain) {
					// 체이닝 형식: "A(체이닝의 맨앞에 선언된 참가자) - B(히든그룹으로 묶인 멤버) (확률)"
				} else {
					// 일반 히든 그룹 형식
					const hiddenGroup = state.hiddenGroups.find(([a, b]) =>
						(a === parseInt(aId) && b === parseInt(bId)) || (a === parseInt(bId) && b === parseInt(aId))
					);
					probability = hiddenGroup ? hiddenGroup[2] : '?';
				}
			}
		});
	});

	state.activeHiddenGroupMap = {};
	state.activeHiddenGroupChainInfo = {};

	// 예약 정보 초기화 (팀 표시 완료 후)
	window.appliedReservation = null;
	window.appliedReservationRules = null;
}

// 히든 그룹 추가 (이름 기반)
function addHiddenGroupByNames(nameA, nameB, probability) {
	const pa = findPersonByName(nameA);
	const pb = findPersonByName(nameB);
	if (!pa || !pb) {
		const msg = `등록된 사용자 중에 ${!pa ? nameA : nameB}을(를) 찾을 수 없습니다.`;
		return { ok: false, message: msg };
	}
	if (pa.id === pb.id) {
		const msg = commandConsoleMessages.comments.samePersonHiddenGroupError;
		console.log(commandConsoleMessages.comments.hiddenGroupAddFailed, msg);
		return { ok: false, message: msg };
	}

	// 이미 체인으로 등록되어 있는지 확인
	const existingChainAsA = state.hiddenGroupChains.find(chain => chain.primary === nameA);
	const existingChainAsB = state.hiddenGroupChains.find(chain => chain.primary === nameB);

	if (existingChainAsA) {
		// nameA가 primary인 체인이 있으면 nameB를 후보로 추가
		const existingCandidate = existingChainAsA.candidates.find(c => c.name === nameB);
		if (existingCandidate) {
			existingCandidate.probability = probability;
			console.log(commandConsoleMessages.comments.chainCandidateProbabilityUpdated + `: ${nameA} → ${nameB}(${probability}%)`);
		} else {
			existingChainAsA.candidates.push({ name: nameB, probability: probability });
			console.log(commandConsoleMessages.comments.chainCandidateAdded + `: ${nameA} → ${nameB}(${probability}%)`);
		}
		saveToLocalStorage();
		return { ok: true, added: true };
	}

	if (existingChainAsB) {
		// nameB가 primary인 체인이 있으면 nameA를 후보로 추가
		const existingCandidate = existingChainAsB.candidates.find(c => c.name === nameA);
		if (existingCandidate) {
			existingCandidate.probability = probability;
			console.log(commandConsoleMessages.comments.chainCandidateProbabilityUpdated + `: ${nameB} → ${nameA}(${probability}%)`);
		} else {
			existingChainAsB.candidates.push({ name: nameA, probability: probability });
			console.log(commandConsoleMessages.comments.chainCandidateAdded + `: ${nameB} → ${nameA}(${probability}%)`);
		}
		saveToLocalStorage();
		return { ok: true, added: true };
	}

	// 새 체인 생성 (참가자 확인 없이 이름만으로)
	state.hiddenGroupChains.push({
		primary: nameA,
		candidates: [{ name: nameB, probability: probability }]
	});
	saveToLocalStorage();
	console.log(commandConsoleMessages.comments.newChainCreated + `: ${nameA} → ${nameB}(${probability}%)`);
	return { ok: true, added: true };
}

// 보류 히든 그룹 추가
function addPendingHiddenGroup(leftName, rightName, probability) {
	const l = normalizeName(leftName);
	const r = normalizeName(rightName);
	if (l === r) return { ok: false, message: commandConsoleMessages.comments.samePersonHiddenGroupError };

	// 기존 보류 히든 그룹 찾기 (양방향 체크)
	const existingIndex = state.pendingHiddenGroups.findIndex(
		pg => (pg.left === l && pg.right === r) || (pg.left === r && pg.right === l)
	);

	if (existingIndex === -1) {
		// 새로 추가
		state.pendingHiddenGroups.push({ left: l, right: r, probability: probability });
		saveToLocalStorage();
		console.log(commandConsoleMessages.comments.pendingHiddenGroupAdded + ` (${probability}%): ${leftName} ↔ ${rightName}`);
	} else {
		// 확률 업데이트
		const oldProb = state.pendingHiddenGroups[existingIndex].probability;
		state.pendingHiddenGroups[existingIndex].probability = probability;
		saveToLocalStorage();
		console.log(commandConsoleMessages.comments.pendingHiddenGroupUpdated + ` (${oldProb}% → ${probability}%): ${leftName} ↔ ${rightName}`);
	}

	return { ok: true };
}

// 보류 히든 그룹 해결
function tryResolveHiddenGroups() {
	if (!state.pendingHiddenGroups.length && !state.pendingHiddenGroupChains.length) return;
	let changed = false;

	// 단일 쌍 해결
	state.pendingHiddenGroups = state.pendingHiddenGroups.filter(pg => {
		const pa = findPersonByName(pg.left);
		const pb = findPersonByName(pg.right);
		if (pa && pb) {
			const res = addHiddenGroupByNames(pa.name, pb.name, pg.probability);
			changed = true;
			return false; // 보류 목록에서 제거
		}
		return true; // 보류 유지
	});

	// 체인 해결
	state.pendingHiddenGroupChains = state.pendingHiddenGroupChains.filter(chain => {
		const primaryPerson = findPersonByName(chain.primary);
		if (!primaryPerson) return true; // 주 참가자가 없으면 보류 유지

		const candidateIds = [];
		let allFound = true;

		for (const cand of chain.candidates) {
			const candidate = findPersonByName(cand.name);
			if (candidate) {
				candidateIds.push({ id: candidate.id, probability: cand.probability });
			} else {
				allFound = false;
				break;
			}
		}

		if (allFound) {
			addHiddenGroupChain(primaryPerson.id, candidateIds);
			changed = true;
			return false; // 보류 목록에서 제거
		}
		return true; // 보류 유지
	});

	if (changed) saveToLocalStorage();
}

// 히든 그룹 체인 추가 (이름 기반)
function addHiddenGroupChain(primaryName, candidates) {
	// 기존 체인 찾기
	const existingChain = state.hiddenGroupChains.find(chain => chain.primary === primaryName);

	if (existingChain) {
		// 기존 체인이 있으면 후보들을 병합 (덮어쓰지 않고 추가)
		candidates.forEach(newCandidate => {
			const existing = existingChain.candidates.find(c => c.name === newCandidate.name);
			if (existing) {
				// 이미 있는 후보면 확률만 업데이트
				existing.probability = newCandidate.probability;
			} else {
				// 없는 후보면 추가
				existingChain.candidates.push(newCandidate);
			}
		});
	} else {
		// 기존 체인이 없으면 새로 생성
		state.hiddenGroupChains.push({
			primary: primaryName,
			candidates: candidates
		});
	}

	saveToLocalStorage();
}

// 보류 히든 그룹 체인 추가
function addPendingHiddenGroupChain(primaryName, candidates) {
	const normalizedPrimary = normalizeName(primaryName);

	// 기존 보류 체인 찾기
	const existingChain = state.pendingHiddenGroupChains.find(chain => chain.primary === normalizedPrimary);

	if (existingChain) {
		// 기존 체인이 있으면 후보들을 병합 (덮어쓰지 않고 추가)
		candidates.forEach(newCandidate => {
			const normalizedName = normalizeName(newCandidate.name);
			const existing = existingChain.candidates.find(c => c.name === normalizedName);
			if (existing) {
				// 이미 있는 후보면 확률만 업데이트
				existing.probability = newCandidate.probability;
			} else {
				// 없는 후보면 추가
				existingChain.candidates.push({ name: normalizedName, probability: newCandidate.probability });
			}
		});
	} else {
		// 기존 체인이 없으면 새로 생성
		state.pendingHiddenGroupChains.push({
			primary: normalizedPrimary,
			candidates: candidates.map(c => ({ name: normalizeName(c.name), probability: c.probability }))
		});
	}

	saveToLocalStorage();
}

// 히든 그룹 확인 (현재 활성화된 것만)
function isActiveHiddenGroup(aId, bId) {
	return state.activeHiddenGroupMap[aId] && state.activeHiddenGroupMap[aId].has(bId);
}

// 정의된 히든 그룹 클러스터 찾기 (콘솔 표시용 - 활성화 여부 무관)
function getDefinedHiddenGroupCluster(personId) {
	const visited = new Set();
	const cluster = new Set();
	const queue = [personId];

	while (queue.length > 0) {
		const current = queue.shift();
		if (visited.has(current)) continue;
		visited.add(current);
		cluster.add(current);

		// 정의된 히든 그룹으로 연결된 모든 ID 찾기
		state.hiddenGroups.forEach(([a, b, prob]) => {
			if (a === current && !visited.has(b)) {
				queue.push(b);
			} else if (b === current && !visited.has(a)) {
				queue.push(a);
			}
		});
	}

	return cluster;
}

// 활성화된 히든 그룹 클러스터 찾기 (연결된 모든 블록 찾기)
function getActiveHiddenGroupCluster(personId) {
	const visited = new Set();
	const cluster = new Set();
	const queue = [personId];

	while (queue.length > 0) {
		const current = queue.shift();
		if (visited.has(current)) continue;
		visited.add(current);
		cluster.add(current);

		// 활성화된 히든 그룹으로 연결된 모든 ID 찾기
		if (state.activeHiddenGroupMap[current]) {
			state.activeHiddenGroupMap[current].forEach(connectedId => {
				if (!visited.has(connectedId)) {
					queue.push(connectedId);
				}
			});
		}
	}

	return cluster;
}

// 사람이 속한 활성화된 히든 그룹 클러스터의 모든 블록 ID 반환
function getActiveHiddenGroupBlockIds(personId) {
	const cluster = getActiveHiddenGroupCluster(personId);
	const blockIds = new Set();

	cluster.forEach(id => {
		// 그룹에 속한 경우 그룹의 모든 멤버 추가
		const groupIndex = getPersonGroupIndex(id);
		if (groupIndex !== -1) {
			state.requiredGroups[groupIndex].forEach(memberId => {
				blockIds.add(memberId);
			});
		} else {
			// 개인인 경우 자신만 추가
			blockIds.add(id);
		}
	});

	return Array.from(blockIds);
}

// --- 참가자 분리 팝업 창 관련 헬퍼 ---
let forbiddenPopup = null;

function closeForbiddenPopup() {
	if (forbiddenPopup && !forbiddenPopup.closed) {
		try { forbiddenPopup.close(); } catch (_) {}
	}
	forbiddenPopup = null;
}

function openForbiddenWindow() {
	const features = 'width=600,height=700,toolbar=0,location=0,status=0,menubar=0,scrollbars=1,resizable=1';
	try {
		// 팝업이 이미 존재하지만 크로스오리진 문제로 접근 불가해졌다면 닫고 다시 생성
		if (forbiddenPopup && !forbiddenPopup.closed) {
			try {
				void forbiddenPopup.document;
			} catch (e) {
				forbiddenPopup.close();
				forbiddenPopup = null;
			}
		}
		if (!forbiddenPopup || forbiddenPopup.closed) {
			forbiddenPopup = window.open('', 'forbiddenPopup', features);
			if (!forbiddenPopup) {
				console.log(commandConsoleMessages.comments.popupBlockedError);
				return;
			}
			let doc;
			try {
				doc = forbiddenPopup.document;
			} catch (e) {
				console.warn(commandConsoleMessages.comments.popupAccessError, e);
				// 반복되는 예외를 피하기 위해 참조를 제거
				try { forbiddenPopup.close(); } catch(_){ }
				forbiddenPopup = null;
				return;
			}
			doc.open();
			doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${commandConsoleMessages.comments.constraintManagement}</title><style>
				:root{--btn_main:#2c78dd;--btn_sub:#df4a65}
				body{font-family:'Pretendard','Segoe UI',Tahoma,Geneva,Verdana,sans-serif;padding:18px;background:#f3f4f8;color:#0f172a;font-size:16px}
				header{background:white;color:#0f172a;padding:14px 16px;border-radius:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;border:1px solid #e5e7eb}
				h1{margin:0;font-size:18px;font-weight:700}
				.reset-all-btn{background:var(--btn_sub);border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;transition:background 0.18s}
				.reset-all-btn:hover{background:#dc2626}
				.add-form{display:flex;gap:8px;margin:12px 0}
				.add-form input{flex:1;padding:10px 14px;border:1px solid #ddd;border-radius:4px;font-size:1rem;font-family:inherit;outline:none;transition:border-color 0.15s;background:white}
				.add-form input:focus{border-color:var(--btn_main)}
				.add-form button{padding:10px 16px;border-radius:4px;border:none;background:var(--btn_main);color:#fff;cursor:pointer;font-size:1rem;font-weight:600;transition:background 0.18s;font-family:inherit}
				.add-form button:hover{background:#1d4ed8}
				section{margin-bottom:12px}
				h2{font-size:14px;font-weight:600;color:#374151;margin:8px 0}
				ul{list-style:none;padding-left:0}
				li{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:8px;border:1px solid #e5e7eb;background:white;margin-bottom:8px;font-size:0.95rem}
				li .label{font-weight:600;color:#0f172a}
				.remove-btn{background:var(--btn_sub);border:none;color:#fff;border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;cursor:pointer;transition:background 0.15s;flex-shrink:0}
				.remove-btn:hover{background:#dc2626}
				.empty{color:#9ca3af;padding:8px;font-size:0.9rem}
				.initial-modal{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:999;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
				.initial-modal .modal-content{background:#fff;padding:24px;border-radius:16px;text-align:center;max-width:90%;transform-origin:top}
				.initial-modal:not(.visible) .modal-content{transform:scaleY(0);opacity:0}
				.initial-modal.visible .modal-content{transform:scaleY(1);opacity:1}
				.modal-show-btn{background:var(--btn_main);color:#fff;border:none;padding:12px 28px;border-radius:4px;font-size:1.1rem;cursor:pointer;font-weight:600;transition:background 0.18s;font-family:inherit}
				.modal-show-btn:hover{background:#1d4ed8}
				.initial-modal .warn{margin-top:8px;color:var(--btn_sub);font-size:12px;font-weight:400;line-height:1.2}
			</style></head><body>
			<header><h1>${commandConsoleMessages.comments.constraintConnection}</h1><button id="resetAllBtn" class="reset-all-btn">${commandConsoleMessages.comments.resetButton}</button></header>
			<div id="initialModal" class="initial-modal visible">
				<div class="modal-content">
					<button id="showBtn" class="modal-show-btn">${commandConsoleMessages.comments.showButton}</button>
					<div id="showWarn" class="warn">${commandConsoleMessages.comments.showButtonWarning}</div>
				</div>
			</div>
			<section class="add-form"><input id="addConstraintInputA" placeholder="참가자 A"><input id="addConstraintInputB" placeholder="참가자 B"><button id="addConstraintBtn">분리하기</button></section>
			<section id="appliedSection" style="display:none"><h2>${commandConsoleMessages.comments.appliedConstraints}</h2><div id="appliedList"></div></section>
			<section id="pendingSection" style="display:none"><h2>${commandConsoleMessages.comments.pendingConstraints}</h2><div id="pendingList"></div></section>
			<script>
				(function(){
					const parentWindow = window.opener;
					if (!parentWindow) {
						alert(commandConsoleMessages.comments.parentWindowNotFound);
						return;
					}
					const addBtn = document.getElementById('addConstraintBtn');
					const inputA = document.getElementById('addConstraintInputA');
					const inputB = document.getElementById('addConstraintInputB');
					const showBtn = document.getElementById('showBtn');
					const modal = document.getElementById('initialModal');
					const showWarn = document.getElementById('showWarn');
					const resetAllBtn = document.getElementById('resetAllBtn');
					let reShowTimeout = null;
					let modalDisabled = false;
					let blindTime = 1000;
					try {
						if (parentWindow && typeof parentWindow.blindDelay !== 'undefined') {
							if (parentWindow.blindDelay === null) modalDisabled = true;
							else if (Number.isFinite(parentWindow.blindDelay)) {
								blindTime = parentWindow.blindDelay;
							}
						}
					} catch (_) { /* fallback to defaults */ }
					function refresh(){ try { if (parentWindow && parentWindow.renderForbiddenWindowContent) parentWindow.renderForbiddenWindowContent(); } catch(e){ console.log(e); } }
					addBtn.addEventListener('click', ()=>{
						const ln = inputA.value.trim();
						const rn = inputB.value.trim();
						if (!ln || !rn) return;
						inputA.value = '';
						inputB.value = '';
						try {
							const res = parentWindow.addForbiddenPairByNames(ln, rn);
							if (!res.ok) parentWindow.addPendingConstraint(ln, rn);
							refresh();
						} catch(e){ console.log(commandConsoleMessages.comments.additionFailed, e); }
					});
					inputA.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') inputB.focus(); });
					inputB.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') addBtn.click(); });

					// 초기화 버튼 이벤트
					if (resetAllBtn) {
						resetAllBtn.addEventListener('click', ()=>{
							if (confirm(commandConsoleMessages.comments.resetAllConstraintsConfirm)) {
								try {
									if (parentWindow && parentWindow.clearAllConstraints) {
										parentWindow.clearAllConstraints();
									} else {
										alert(commandConsoleMessages.comments.parentWindowNotFound);
									}
								} catch(e){ console.log(e); }
							}
						});
					}
					function hideModal(){
						if (reShowTimeout) { clearTimeout(reShowTimeout); reShowTimeout = null; }
						modal.classList.remove('visible');
						setTimeout(()=>{ if (!modal.classList.contains('visible')) modal.style.display = 'none'; }, 340);
						document.getElementById('appliedSection').style.display = '';
						document.getElementById('pendingSection').style.display = '';
						showWarn.style.display = 'none';
						refresh();
					}
					showBtn.addEventListener('click', hideModal);
					// blindDelay가 null이면 모달/보기 버튼 비활성화
					if (modalDisabled) {
						showBtn.style.display = 'none';
						showWarn.style.display = 'none';
						modal.classList.remove('visible');
						modal.style.display = 'none';
						document.getElementById('appliedSection').style.display = '';
						document.getElementById('pendingSection').style.display = '';
					}
					function scheduleModalShow(){
						if (modalDisabled) return;
						if (reShowTimeout) clearTimeout(reShowTimeout);
						reShowTimeout = setTimeout(()=>{
							modal.style.display = '';
							modal.classList.add('visible');
							document.getElementById('appliedSection').style.display = 'none';
							document.getElementById('pendingSection').style.display = 'none';
							showWarn.style.display = '';
						}, blindTime);
					}
					function cancelModalShow(){ if (reShowTimeout){ clearTimeout(reShowTimeout); reShowTimeout = null; } }
					// 모달 비활성화 시 재노출 이벤트 비활성화
					if (!modalDisabled) {
						window.addEventListener('mouseout', (e)=>{ if (!e.relatedTarget && !e.toElement) scheduleModalShow(); });
						window.addEventListener('blur', scheduleModalShow);
						window.addEventListener('mousemove', ()=>{ cancelModalShow(); });
					}
				})();
			</script>
			</body></html>`);
			doc.close();
		}

		// 팝업이 열릴 때마다 모달 상태 초기화
		if (forbiddenPopup && !forbiddenPopup.closed) {
			try {
				const doc = forbiddenPopup.document;
				const modal = doc.getElementById('initialModal');
				const showBtn = doc.getElementById('showBtn');
				const showWarn = doc.getElementById('showWarn');
				const appliedSection = doc.getElementById('appliedSection');
				const pendingSection = doc.getElementById('pendingSection');

				if (modal) {
					if (blindDelay === null) {
						modal.style.display = 'none';
						modal.classList.remove('visible');
						if (showBtn) showBtn.style.display = 'none';
						if (showWarn) showWarn.style.display = 'none';
						if (appliedSection) appliedSection.style.display = '';
						if (pendingSection) pendingSection.style.display = '';
					} else {
						modal.style.display = '';
						modal.classList.remove('visible');
						void modal.offsetWidth;
						modal.classList.add('visible');
						if (appliedSection) appliedSection.style.display = 'none';
						if (pendingSection) pendingSection.style.display = 'none';
						if (showBtn) showBtn.style.display = '';
						if (showWarn) showWarn.style.display = '';
					}
				}
			} catch(e) {
				console.warn('모달 초기화 실패:', e);
			}
		}

		renderForbiddenWindowContent();
		if (forbiddenPopup && !forbiddenPopup.closed) forbiddenPopup.focus();
	} catch (e) {
		console.log(commandConsoleMessages.comments.popupOpenError, e);
	}
}

function renderForbiddenWindowContent() {
	if (!forbiddenPopup || forbiddenPopup.closed) return;
	let doc;
	try {
		doc = forbiddenPopup.document;
	} catch (e) {
		console.warn(commandConsoleMessages.comments.popupDocumentAccessError, e);
		try { forbiddenPopup.close(); } catch(_){}
		forbiddenPopup = null;
		return;
	}
	const appliedList = doc.getElementById('appliedList');
	const pendingList = doc.getElementById('pendingList');
	if (!appliedList || !pendingList) return;
	// 초기화
	appliedList.innerHTML = '';
	pendingList.innerHTML = '';
	// 적용된 분리
	if (state.forbiddenPairs.length) {
		const ul = doc.createElement('ul');
		state.forbiddenPairs.forEach(([a,b]) => {
			const pa = findPersonByIdAny(a);
			const pb = findPersonByIdAny(b);
			const left = pa ? pa.name : `id:${a}`;
			const right = pb ? pb.name : `id:${b}`;
			const li = doc.createElement('li');
			const label = doc.createElement('span'); label.className='label'; label.textContent = `${left} ! ${right}`;
			li.appendChild(label);
			const btn = doc.createElement('button'); btn.className='remove-btn'; btn.textContent='×';
			btn.addEventListener('click', ()=>{
				try { removeForbiddenPairByNames(left, right); renderForbiddenWindowContent(); } catch(e){ console.log(e); }
			});
			li.appendChild(btn);
			ul.appendChild(li);
		});
		appliedList.appendChild(ul);
	} else {
		const p = doc.createElement('div'); p.className='empty'; p.textContent=commandConsoleMessages.comments.noneText; appliedList.appendChild(p);
	}
	// 대기중인 분리
	if (state.pendingConstraints.length) {
		const ul2 = doc.createElement('ul');
		state.pendingConstraints.forEach(pc => {
			const li = doc.createElement('li');
			const label = doc.createElement('span'); label.className='label'; label.textContent = `${pc.left} ! ${pc.right}`;
			li.appendChild(label);
			const btn = doc.createElement('button'); btn.className='remove-btn'; btn.textContent='×';
			btn.addEventListener('click', ()=>{
				try { removeForbiddenPairByNames(pc.left, pc.right); renderForbiddenWindowContent(); } catch(e){ console.log(e); }
			});
			li.appendChild(btn);
			ul2.appendChild(li);
		});
		pendingList.appendChild(ul2);
	} else {
		const p = doc.createElement('div'); p.className='empty'; p.textContent=commandConsoleMessages.comments.noneText; pendingList.appendChild(p);
	}
}

// 팝업 헬퍼가 현재 스코프에 없을 때 ReferenceError를 방지하는 안전한 래퍼
function safeOpenForbiddenWindow() {
	if (typeof openForbiddenWindow === 'function') {
		try { openForbiddenWindow(); } catch (e) { console.log(commandConsoleMessages.comments.popupOpenError, e); }
	} else {
		console.warn(commandConsoleMessages.comments.popupFunctionNotDefined);
	}
}

// 모든 분리 초기화 함수 (자식창에서 호출용)
function clearAllConstraints() {
	state.forbiddenPairs = [];
	state.pendingConstraints = [];
	state.forbiddenMap = {};
	saveToLocalStorage();
	renderForbiddenWindowContent();
}

// escapeHtml은 제거됨(참조되지 않음). 필요하면 DOM API 또는 간단한 인라인 헬퍼 사용

function isForbidden(aId, bId) {
	return state.forbiddenMap[aId] && state.forbiddenMap[aId].has(bId);
}

function teamHasForbiddenConflict(team, person) {
	return team.some(m => isForbidden(m.id, person.id));
}

function conflictExists(teams) {
	for (const team of teams) {
		for (let i = 0; i < team.length; i++) {
			for (let j = i + 1; j < team.length; j++) {
				if (isForbidden(team[i].id, team[j].id)) return true;
			}
		}
	}
	return false;
}

function getPersonGroupIndex(personId) {
	return state.requiredGroups.findIndex(group => group.includes(personId));
}

function getGroupColor(groupIndex) {
	if (groupIndex === -1) return state.ungroupedColor;
	return state.groupColors[groupIndex % state.groupColors.length];
}

function createPersonTag(person, potentialDuplicates = [], weightHighIds = new Set(), weightLowIds = new Set()) {
	const personTag = document.createElement('div');
	personTag.className = 'style_person';

	// 중복 체크: potentialDuplicates 배열에 이 사람의 normalized 이름이 있으면 강조
	const normalized = normalizeName(person.name);
	if (potentialDuplicates.includes(normalized)) {
		personTag.classList.add('is-duplicate');
	}

	if (state.genderBalanceEnabled) personTag.style.backgroundColor = person.gender === 'male' ? '#e0f2fe' : '#fce7f3';

	const nameSpan = document.createElement('span');
	nameSpan.className = 'name';
	nameSpan.textContent = person.name;
	personTag.appendChild(nameSpan);

	if (state.genderBalanceEnabled) {
		const genderToggle = document.createElement('button');
		genderToggle.className = 'gender-toggle-circle';
		genderToggle.textContent = person.gender === 'male' ? '♂️' : '♀️';
		genderToggle.addEventListener('click', (e) => {
			e.stopPropagation();
			const newGender = person.gender === 'male' ? 'female' : 'male';
			updatePersonGender(person.id, newGender);
			renderPeople();
		});
		personTag.appendChild(genderToggle);
	}

	if (state.weightBalanceEnabled) {
		const weightSpan = document.createElement('span');
		weightSpan.className = 'person-data';
		weightSpan.textContent = '(' + person.weight + ')';
		if (weightHighIds.has(person.id)) weightSpan.style.color = '#ef4444';
		else if (weightLowIds.has(person.id)) weightSpan.style.color = '#3b82f6';
		personTag.appendChild(weightSpan);
	}

	const editBtn = document.createElement('button');
	editBtn.textContent = '수정';
	editBtn.className = 'edit-btn';
	editBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		openEditModal(person);
	});
	personTag.appendChild(editBtn);

	const removeBtn = document.createElement('button');
	removeBtn.textContent = '삭제';
	removeBtn.className = 'remove-btn';
	removeBtn.addEventListener('click', (e) => {
		// Shift 키를 누른 상태로 클릭한 경우 완전 삭제
		const isCompleteDelete = e.shiftKey;
		if (isCompleteDelete) {
			if (confirm(commandConsoleMessages.comments.completePersonDeleteConfirm.replace('{name}', person.name))) {
				removePerson(person.id, true);
			}
		} else {
			removePerson(person.id, false);
		}
	});
	personTag.appendChild(removeBtn);

	return personTag;
}

function updateParticipantCount() {
	if (!elements.participantCount) return;

	const count = state.people.length;
	elements.participantCount.textContent = count;

	const em = elements.participantCount.closest('em');
	if (em) {
		em.style.display = count === 0 ? 'none' : 'inline-flex';
		em.setAttribute('aria-hidden', count === 0 ? 'true' : 'false');
	}
}

function computeWeightHighLow() {
	const weightHighIds = new Set();
	const weightLowIds = new Set();
	if (state.weightBalanceEnabled && state.people.length >= 4) {
		const maxW = Math.max(...state.people.map(p => p.weight));
		const minW = Math.min(...state.people.map(p => p.weight));
		const maxPeople = state.people.filter(p => p.weight === maxW);
		const minPeople = state.people.filter(p => p.weight === minW);
		if (maxPeople.length <= 2) maxPeople.forEach(p => weightHighIds.add(p.id));
		if (minPeople.length <= 2) minPeople.forEach(p => weightLowIds.add(p.id));
	}
	return { weightHighIds, weightLowIds };
}

function renderPeople() {
	updateParticipantCount();
	elements.peopleList.innerHTML = '';


	// 입력창에서 중복 체크를 위한 이름 목록 가져오기
	const potentialDuplicates = getPotentialDuplicatesFromInput();

	const { weightHighIds, weightLowIds } = computeWeightHighLow();

	const grouped = new Set();
	const groupMap = new Map(); // personId -> groupIndex(그룹 인덱스)

	// 그룹 정보를 맵으로 저장
	state.requiredGroups.forEach((group, groupIndex) => {
		// 그룹 내부는 실제 배열 순서대로(셔플 반영)
		group.forEach(personId => {
			grouped.add(personId);
			groupMap.set(personId, groupIndex);
		});
	});


	// people 배열 순서대로 표시하되, 그룹 시작 시점에 그룹 전체를 한 번에 표시
	const processedGroups = new Set();

	state.people.forEach(person => {
		const groupIndex = groupMap.get(person.id);

		if (groupIndex !== undefined && !processedGroups.has(groupIndex)) {
			// 이 그룹을 처음 만났을 때, 그룹 전체를 표시
			processedGroups.add(groupIndex);
			const group = state.requiredGroups[groupIndex];
			// 그룹 내부는 실제 배열 순서대로(셔플 반영)
			const groupContainer = document.createElement('div');
			groupContainer.className = 'style_group';
			groupContainer.style.borderColor = getGroupColor(groupIndex);
			group.forEach(personId => {
				const groupPerson = state.people.find(p => p.id === personId);
				if (groupPerson) {
					const personTag = createPersonTag(groupPerson, potentialDuplicates, weightHighIds, weightLowIds);
					groupContainer.appendChild(personTag);
				}
			});
			elements.peopleList.appendChild(groupContainer);
		} else if (groupIndex === undefined) {
			// 그룹에 속하지 않은 개별 항목
			const personTag = createPersonTag(person, potentialDuplicates, weightHighIds, weightLowIds);
			elements.peopleList.appendChild(personTag);
		}
		// 이미 처리된 그룹의 멤버는 스킵
	});

}

// 입력창의 텍스트에서 중복될 가능성이 있는 이름들 추출
function getPotentialDuplicatesFromInput() {
	const input = elements.nameInput.value.trim();
	if (!input) return [];

	const duplicateNames = [];
	const tokens = input.split('/').map(t => t.trim()).filter(t => t !== '');

	tokens.forEach(token => {
		// 분리 조건(!로 시작하는 것)은 무시
		if (token.includes('!')) return;

		// 쉼표로 구분된 이름들 추출
		const names = token.split(',').map(n => n.trim()).filter(n => n !== '');
		names.forEach(name => {
			const normalized = normalizeName(name);
			// 현재 참가자 중 이 이름이 있는지 확인
			const exists = state.people.some(p => normalizeName(p.name) === normalized);
			if (exists) {
				duplicateNames.push(normalized);
			}
		});
	});

	return duplicateNames;
}

async function shuffleTeams() {
	if (isTeamGenerationInProgress) return;

	if (state.people.length === 0) {
		showError(commandConsoleMessages.comments.addParticipant);
		return;
	}

	const validPeople = state.people.filter(p => p.name.trim() !== '');
	if (validPeople.length === 0) {
		showError(commandConsoleMessages.comments.minOneName);
		return;
	}

	if (state.membersPerTeam < 2) {
		showError(commandConsoleMessages.comments.minTwoPerTeam);
		return;
	}

	if (validPeople.length < state.membersPerTeam) {
		showError(commandConsoleMessages.comments.notEnoughParticipants);
		return;
	}

	isTeamGenerationInProgress = true;
	setTeamGenerationButtonState(true);

	try {

	// 예약 처리: 프로필 예약과 유저 예약을 동시 소모하여 합산
	let consumedReservation = null;
	if (state.reservations.length > 0 || state.userReservations.length > 0) {
		const profileBatch = state.reservations.length > 0 ? state.reservations.shift() : null;
		const userBatch = state.userReservations.length > 0 ? state.userReservations.shift() : null;
		const merged = [...(profileBatch || []), ...(userBatch || [])];
		consumedReservation = merged.length > 0 ? merged : null;
		saveToLocalStorage();
	}

	const teams = generateTeams(preShufflePeopleForGeneration(validPeople), consumedReservation);
	if (!teams) return; // generateTeams가 불가능할 경우 오류를 표시함

	// 예약 소모 알림 (CMD 콘솔에 출력)
	if (consumedReservation && typeof commandConsole !== 'undefined' && commandConsole.log) {
		// appliedReservation 정보 확인 (제외된 인원이 있는지 체크)
		if (window.appliedReservation && window.appliedReservation.excludedNames && window.appliedReservation.excludedNames.length > 0) {
			// 제외된 인원이 있는 경우
			const appliedMembers = [...window.appliedReservation.foundNames, ...window.appliedReservation.additionalNames].join(', ');
			const excludedMembers = window.appliedReservation.excludedNames.join(', ');
			commandConsole.log(
				commandConsoleMessages.comments.reservationConsumedPartial
					.replace('{limit}', state.membersPerTeam)
					.replace('{members}', appliedMembers)
					.replace('{excluded}', excludedMembers)
			);
		} else {
			// 제외된 인원이 없는 경우 (기존 동작)
			commandConsole.log(commandConsoleMessages.comments.reservationConsumed.replace('{members}', consumedReservation.map((g) => g.join(', ')).join(' / ')));
		}
	}

	// 토큰 모드: 예약 소모를 해당 프로필 DB에 반영
	if (consumedReservation && database && _readOnlyMode && _readOnlyProfileKey) {
		database.ref(`profiles/${_readOnlyProfileKey}/reservations`).set(state.reservations)
			.then(() => database.ref(`profiles/${_readOnlyProfileKey}/syncTrigger`).set({
				timestamp: getCurrentDbTimestamp(), type: 'reservation'
			}))
			.catch(error => console.error('토큰 모드 예약 동기화 실패:', error));
		// 유저 예약도 동기화
		if (currentUserCode) {
			database.ref(`users/${currentUserCode}/reservations`).set(state.userReservations)
				.catch(error => console.error('토큰 모드 유저 예약 동기화 실패:', error));
		}
	}

	// 익명 유저: 예약 소모를 DB에 반영 (admin 실시간 갱신) — 프로필 없이 유저만 있는 경우
	if (consumedReservation && database && currentUserCode && !currentProfileKey && !_readOnlyMode) {
		database.ref(`users/${currentUserCode}/reservations`).set(state.reservations)
			.catch(error => console.error('예약 동기화 실패:', error));
	}

	// Firebase에 예약 소모 반영
	if (consumedReservation && syncEnabled && currentProfileKey) {
		// 자신이 예약을 소모했다는 플래그 설정 (Firebase 리스너가 알림을 보내지 않도록)
		if (typeof window !== 'undefined') {
			window.lastReservationChangeByMe = true;
		}
		// 유저 예약도 동기화 (currentUserCode 있을 경우)
		if (currentUserCode && database) {
			database.ref(`users/${currentUserCode}/reservations`).set(state.userReservations)
				.catch(error => console.error('유저 예약 동기화 실패:', error));
		}
		database.ref(`profiles/${currentProfileKey}/reservations`).set(state.reservations)
			.then(() => {
				// syncTrigger 설정하여 다른 창에 알림
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'reservation' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 약간의 지연 후 플래그 해제
				setTimeout(() => {
					if (typeof window !== 'undefined') {
						window.lastReservationChangeByMe = false;
					}
				}, 100);
			})
			.catch(error => {
				console.error('예약 동기화 실패:', error);
				if (typeof window !== 'undefined') {
					window.lastReservationChangeByMe = false;
				}
			});
	}

	// 검증된 팀 저장
	currentTeams = teams;
	isValidated = false;

	// 팀 생성시 분리 레이어가 열려있으면 내리기
	hideConstraintNotification();

	// 캡처 버튼 상태 초기화
	if (captureSuccessTimer) {
		clearTimeout(captureSuccessTimer);
		captureSuccessTimer = null;
	}
	if (elements.captureBtn) {
		elements.captureBtn.innerHTML = '화면 캡처 <span class="camera-emoji">📸</span>';
		elements.captureBtn.disabled = false;
	}

	// teamDisplayDelay가 바뀔 수 있으므로 표시 전 최신값으로 반영
	setTeamAnimDurationFromDelay();

	// 검증 루프 실행 후 최종 결과만 표시
	await startValidationLoop(teams);
	} finally {
		isTeamGenerationInProgress = false;
		setTeamGenerationButtonState(false);
	}
}
// 팀 생성 전에 내부적으로 한 번 셔플: 그룹 내 인원은 제외(비그룹 인원만 무작위화)
function preShufflePeopleForGeneration(people) {
	try {
		const groupedIdSet = new Set();
		for (const g of state.requiredGroups) {
			for (const id of g) groupedIdSet.add(id);
		}
		const groupedPeople = people.filter(p => groupedIdSet.has(p.id));
		const ungroupedPeople = people.filter(p => !groupedIdSet.has(p.id));
		// 비그룹 참가자만을 위한 Fisher-Yates 셔플
		for (let i = ungroupedPeople.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[ungroupedPeople[i], ungroupedPeople[j]] = [ungroupedPeople[j], ungroupedPeople[i]];
		}
		// 그룹 인원은 원래 순서 유지, 비그룹 인원만 셔플된 순서로 뒤에 배치
		return [...groupedPeople, ...ungroupedPeople];
	} catch (_) {
		// 문제가 있으면 원본 people 사용
		return people;
	}
}

function generateTeams(people, reservation = null) {
	buildForbiddenMap();
	// reservation은 배치(batch) 구조: [[group1Names], [group2Names], ...]
	const reservationBaseIdSet = new Set();
	if (Array.isArray(reservation)) {
		reservation.forEach((group) => {
			if (!Array.isArray(group)) return;
			group.forEach((name) => {
				const person = people.find((item) => item.name === name);
				if (person && Number.isInteger(person.id)) reservationBaseIdSet.add(person.id);
			});
		});
	}
	const isReservationOverridePair = (aId, bId, activeReservationIdSet) => {
		if (!(activeReservationIdSet instanceof Set)) {
			return false;
		}
		return activeReservationIdSet.has(aId) || activeReservationIdSet.has(bId);
	};
	const conflictExistsWithReservation = (teams, activeReservationIdSet) => {
		for (const team of teams) {
			for (let i = 0; i < team.length; i++) {
				for (let j = i + 1; j < team.length; j++) {
					if (isReservationOverridePair(team[i].id, team[j].id, activeReservationIdSet)) {
						continue;
					}
					if (isForbidden(team[i].id, team[j].id)) return true;
				}
			}
		}
		return false;
	};

	// 팀 순서 배열에서 마지막 팀 인덱스를 항상 맨 뒤로 보낼지 결정하는 공통 로직
	function pushLastTeamToEndIfNeeded(teamOrder, teams) {
		if (state.maxTeamSizeEnabled && teamOrder.length > 1) {
			const lastIdx = teams.length - 1;
			const pos = teamOrder.indexOf(lastIdx);
			if (pos !== -1) {
				teamOrder.splice(pos, 1);
				teamOrder.push(lastIdx);
			}
		}
	}

	// 유효성 검사: 필수 그룹 내에 금지 분리 쌍이 포함되어 있으면 안 됨
	for (const group of state.requiredGroups) {
		for (let i = 0; i < group.length; i++) {
			for (let j = i + 1; j < group.length; j++) {
				if (isReservationOverridePair(group[i], group[j], reservationBaseIdSet)) {
					continue;
				}
				if (isForbidden(group[i], group[j])) {
					showError(commandConsoleMessages.comments.constraintInSameGroup);
					return null;
				}
			}
		}
	}

	// 팀 인원수와 정확히 일치하는 그룹들을 미리 분리
	const completeTeamGroups = []; // 완성된 팀으로 사용할 그룹들
	const regularGroups = []; // 일반 그룹들 [{ group, requiredGroupIndex }]
	const completeTeamMemberIds = new Set(); // 완성된 팀에 속한 멤버 ID들

	state.requiredGroups.forEach((group, requiredGroupIndex) => {
		if (!group.every(id => people.some(p => p.id === id))) {
			return;
		}
		if (group.length === state.membersPerTeam) {
			completeTeamGroups.push(group);
			group.forEach(id => completeTeamMemberIds.add(id));
		} else {
			regularGroups.push({ group, requiredGroupIndex });
		}
	});

	// 완성된 팀 그룹에 속하지 않은 사람들만 필터링
	const remainingPeople = people.filter(p => !completeTeamMemberIds.has(p.id));

	// 팀 수 계산 (완성된 팀 + 나머지 인원으로 만들 팀)
	const additionalTeamCount = remainingPeople.length > 0
		? Math.max(1, Math.ceil(remainingPeople.length / state.membersPerTeam))
		: 0;
	const totalTeamCount = completeTeamGroups.length + additionalTeamCount;

	if (totalTeamCount === 0) {
		showError(commandConsoleMessages.comments.cannotFormTeams);
		return null;
	}

	const maxAttempts = 2000;

	// 나머지 참가자에서 최소 성별(소수 성별) 계산
	const maleCount = remainingPeople.filter(p => p.gender === 'male').length;
	const femaleCount = remainingPeople.filter(p => p.gender === 'female').length;
	const minorityCount = Math.min(maleCount, femaleCount);
	const minorityGender = maleCount === femaleCount ? null : (femaleCount < maleCount ? 'female' : 'male');
	const getTeamMinorityCount = (team) => {
		if (!minorityGender) return 0;
		return team.filter(p => p.gender === minorityGender).length;
	};
	const isMinorityForcedTogether = () => {
		if (!minorityGender) return false;
		const minorityIds = new Set(
			people.filter((p) => p.gender === minorityGender).map((p) => p.id)
		);
		if (minorityIds.size <= 1) return false;

		for (const group of state.requiredGroups) {
			let count = 0;
			for (const id of group) {
				if (minorityIds.has(id)) count += 1;
				if (count >= 2) return true;
			}
		}

		const visited = new Set();
		for (const startId of minorityIds) {
			if (visited.has(startId)) continue;
			const queue = [startId];
			const componentMinorityIds = new Set();
			while (queue.length > 0) {
				const current = queue.shift();
				if (visited.has(current)) continue;
				visited.add(current);
				if (minorityIds.has(current)) componentMinorityIds.add(current);
				const neighbors = state.activeHiddenGroupMap[current];
				if (!neighbors) continue;
				neighbors.forEach((nextId) => {
					if (!visited.has(nextId)) queue.push(nextId);
				});
			}
			if (componentMinorityIds.size >= 2) return true;
		}

		return false;
	};

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// 각 시도마다 확률적 분리과 히든 그룹을 새로 샘플링
		activateProbabilisticForbiddenPairsForTeamGeneration();
		activateHiddenGroupsForTeamGeneration();
		const activeReservationIdSet = new Set(reservationBaseIdSet);
		if (Array.isArray(reservation) && reservation.length > 0) {
			window.appliedReservationRules = [];
			const groupsApplied = [];
			reservation.forEach((group) => {
				if (!Array.isArray(group) || group.length === 0) return;
				const appliedIds = applyReservationAsHiddenGroup(group) || [];
				appliedIds.forEach((id) => { if (Number.isInteger(id)) activeReservationIdSet.add(id); });
				if (window.appliedReservation) groupsApplied.push({ ...window.appliedReservation });
			});
			window.appliedReservation = {
				names: groupsApplied.flatMap((g) => g.names || []),
				foundNames: groupsApplied.flatMap((g) => g.foundNames || []),
				additionalNames: groupsApplied.flatMap((g) => g.additionalNames || []),
				notFoundNames: groupsApplied.flatMap((g) => g.notFoundNames || []),
				excludedNames: groupsApplied.flatMap((g) => g.excludedNames || []),
				groups: groupsApplied.map((g) => [
					...(g.foundNames || []),
					...(g.additionalNames || [])
				])
			};
		}
		const minorityForcedTogether = isMinorityForcedTogether();

		// 나머지 사람들만 셔플
		const shuffledPeople = [...remainingPeople].sort(() => Math.random() - 0.5);
		// 나머지 사람들로 만들 팀들만 생성
		const teams = Array.from({ length: additionalTeamCount }, () => []);
		const assigned = new Set();

		// 헬퍼 함수: 팀의 총 가중치 계산
		const calcTeamWeight = (team) => team.reduce((sum, p) => sum + (p.weight || 0), 0);

		// 히든 그룹 처리 - 연결된 블록들을 하나의 단위로 배치
		const processedHiddenClusters = new Set();
		const hiddenGroupAffectedGroupIndices = new Set(); // 히든 그룹에 영향받은 requiredGroups 추적
		let hiddenGroupFailed = false;
		// 멀티 예약 그룹: 각 예약 클러스터가 배정된 팀 인덱스 추적 (서로 다른 팀에 배치)
		const reservedTeamIndices = new Set();

		for (const person of shuffledPeople) {
			if (assigned.has(person.id)) continue;

			// 활성화된 히든 그룹 클러스터 확인
			const cluster = getActiveHiddenGroupCluster(person.id);
			if (cluster.size > 1) {
				// 클러스터 대표 ID로 중복 처리 방지
				const clusterKey = Math.min(...Array.from(cluster));
				if (processedHiddenClusters.has(clusterKey)) continue;
				processedHiddenClusters.add(clusterKey);

				// 히든 그룹 클러스터의 모든 블록 멤버 수집
				const blockIds = getActiveHiddenGroupBlockIds(person.id);
				const blockMembers = blockIds.map(id => shuffledPeople.find(p => p.id === id)).filter(Boolean);

				if (blockMembers.length === 0) continue;

				// 이 블록에 포함된 모든 requiredGroups를 추적
				blockMembers.forEach(member => {
					const gi = getPersonGroupIndex(member.id);
					if (gi !== -1) hiddenGroupAffectedGroupIndices.add(gi);
				});

				// 이 클러스터가 예약 멤버를 포함하는지 확인 (멀티 예약 분리용)
				const isReservationCluster = blockIds.some(id => activeReservationIdSet.has(id));

				// 가중치 균등이 활성화된 경우 가중치 낮은 팀부터
				let teamOrder;
				if (state.weightBalanceEnabled) {
					teamOrder = teams.map((team, idx) => ({
						idx,
						weight: team.reduce((sum, p) => sum + (p.weight || 0), 0)
					})).sort((a, b) => {
						if (a.weight !== b.weight) return a.weight - b.weight;
						if (state.maxTeamSizeEnabled) return a.idx - b.idx;
						return 0;
					}).map(t => t.idx);
					pushLastTeamToEndIfNeeded(teamOrder, teams);
				} else {
					teamOrder = teams.map((_, idx) => idx).sort(() => Math.random() - 0.5);
				}

				// 예약 클러스터는 이미 다른 예약 그룹이 배정된 팀을 우선 제외
				if (isReservationCluster && reservedTeamIndices.size > 0) {
					const filtered = teamOrder.filter(i => !reservedTeamIndices.has(i));
					if (filtered.length > 0) teamOrder = filtered;
				}

				let selectedTeam = -1;

				for (const i of teamOrder) {
					// 인원 수 분리 체크
					if (state.maxTeamSizeEnabled) {
						if (i < teams.length - 1 && teams[i].length + blockMembers.length > state.membersPerTeam) continue;
					} else {
						if (teams[i].length + blockMembers.length > state.membersPerTeam) continue;
					}

					// 충돌 체크
					let hasConflict = false;
					for (const bm of blockMembers) {
						if (teams[i].some((tm) => {
							if (isReservationOverridePair(bm.id, tm.id, activeReservationIdSet)) {
								return false;
							}
							return isForbidden(bm.id, tm.id);
						})) {
							hasConflict = true;
							break;
						}
					}
					if (hasConflict) continue;

					// 조건 만족하면 배치
					selectedTeam = i;
					break;
				}

				if (selectedTeam === -1) {
					// 히든 그룹 블록을 배치할 수 없으면 이 시도는 실패
					hiddenGroupFailed = true;
					break;
				}

				// 블록 멤버들을 팀에 추가
				teams[selectedTeam].push(...blockMembers);
				blockMembers.forEach(m => assigned.add(m.id));
				// 예약 클러스터가 배정된 팀 기록 (다음 예약 그룹은 다른 팀으로)
				if (isReservationCluster) reservedTeamIndices.add(selectedTeam);
			}
		}

		if (hiddenGroupFailed) continue;

		// 일반 그룹들만 처리 - 히든 그룹에 영향받은 그룹은 제외
		// (히든 그룹 블록에 이미 포함된 멤버들은 assigned되었으므로)
		const unaffectedRegularGroups = regularGroups.filter(({ requiredGroupIndex }) =>
			!hiddenGroupAffectedGroupIndices.has(requiredGroupIndex)
		);

		// 가중치 균등이 활성화된 경우 그룹을 가중치 순으로 정렬 (높은 순)
		let processGroups;
		if (state.weightBalanceEnabled) {
			// 각 그룹의 평균 가중치 계산
			const groupsWithWeight = unaffectedRegularGroups.map(({ group }) => {
				const groupMembers = group.map(id => shuffledPeople.find(p => p.id === id)).filter(Boolean);
				const totalWeight = groupMembers.reduce((sum, p) => sum + (p.weight || 0), 0);
				const avgWeight = groupMembers.length > 0 ? totalWeight / groupMembers.length : 0;
				return { group, avgWeight };
			});
			// 가중치 내림차순 정렬
			groupsWithWeight.sort((a, b) => b.avgWeight - a.avgWeight);
			processGroups = groupsWithWeight.map(g => g.group);
		} else {
			// 가중치 균등이 없으면 셔플
			processGroups = [...unaffectedRegularGroups]
				.map(({ group }) => group)
				.sort(() => Math.random() - 0.5);
		}

		let groupFailed = false;

		for (const group of processGroups) {
			const groupMembers = group.map(id => shuffledPeople.find(p => p.id === id)).filter(Boolean);
			if (groupMembers.some(member => assigned.has(member.id))) {
				continue;
			}

			// 가중치 균등이 활성화된 경우: 팀을 가중치 낮은 순으로 정렬하여 순차 확인
			let teamOrder;
			if (state.weightBalanceEnabled) {
				// 팀을 현재 가중치 기준 오름차순 정렬 (낮은 가중치 팀부터)
				teamOrder = teams.map((team, idx) => ({
					idx,
					weight: team.reduce((sum, p) => sum + (p.weight || 0), 0)
				})).sort((a, b) => {
					if (a.weight !== b.weight) return a.weight - b.weight;
					// 가중치가 같으면 최대인원 모드에서는 인덱스 작은 팀 우선
					if (state.maxTeamSizeEnabled) return a.idx - b.idx;
					return 0;
				}).map(t => t.idx);
				// 최대인원 모드일 때는 마지막 팀을 우선순위 맨 뒤로 보냄 (중복 로직을 헬퍼로 대체)
				pushLastTeamToEndIfNeeded(teamOrder, teams);
			} else {
				// 가중치 균등이 없으면 랜덤 순서
				teamOrder = teams.map((_, idx) => idx).sort(() => Math.random() - 0.5);
			}

			let selectedTeam = -1;

			// 가중치 낮은 팀부터 조건 확인
			for (const i of teamOrder) {
				// 체크 1: 인원 수 분리
				if (state.maxTeamSizeEnabled) {
					if (i < teams.length - 1 && teams[i].length + groupMembers.length > state.membersPerTeam) continue;
				} else {
					if (teams[i].length + groupMembers.length > state.membersPerTeam) continue;
				}

				// 체크 2: 충돌(금지 분리) 없음
				let hasConflict = false;
				for (const gm of groupMembers) {
					if (teams[i].some((tm) => {
						if (isReservationOverridePair(gm.id, tm.id, activeReservationIdSet)) {
							return false;
						}
						return isForbidden(gm.id, tm.id);
					})) {
						hasConflict = true;
						break;
					}
				}
				if (hasConflict) continue;

				// 체크 3: 성별 균형 - 활성화된 경우에만 적용
				if (state.genderBalanceEnabled && minorityGender && !minorityForcedTogether) {
					const currentMinGender = getTeamMinorityCount(teams[i]);
					const allTeamMinGenders = teams.map(getTeamMinorityCount);
					const globalMinGender = Math.min(...allTeamMinGenders);
					if (currentMinGender > globalMinGender) continue;
				}

				// 모든 조건을 만족하면 이 팀 선택
				selectedTeam = i;
				break;
			}

			if (selectedTeam === -1) {
				groupFailed = true;
				break;
			}

			teams[selectedTeam].push(...groupMembers);
			groupMembers.forEach(m => assigned.add(m.id));
		}

		if (groupFailed) continue;

		// 개별 참가자 배치 - shuffledPeople 사용으로 매 시도마다 다른 순서 보장
		const unassignedPeople = shuffledPeople.filter(p => !assigned.has(p.id));

		// 가중치 균등이 활성화된 경우: 가중치별로 그룹화 후 각 그룹 내에서 랜덤
		if (state.weightBalanceEnabled) {
			// 1. 가중치별로 그룹화
			const weightGroups = new Map();
			unassignedPeople.forEach(p => {
				const w = p.weight || 0;
				if (!weightGroups.has(w)) weightGroups.set(w, []);
				weightGroups.get(w).push(p);
			});

			// 2. 각 가중치 그룹 내에서 랜덤 셔플
			weightGroups.forEach(group => {
				for (let i = group.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[group[i], group[j]] = [group[j], group[i]];
				}
			});

			// 3. 가중치 높은 순으로 재구성
			const sortedWeights = Array.from(weightGroups.keys()).sort((a, b) => b - a);
			unassignedPeople.length = 0;
			sortedWeights.forEach(w => {
				unassignedPeople.push(...weightGroups.get(w));
			});
		}

		let personFailed = false;

		for (const person of unassignedPeople) {
			const isMinorityPerson = minorityGender && person.gender === minorityGender;

			// 팀 순서 결정: 최대인원 모드, 일반 모드 + 가중치, 일반 모드 구분
			let teamOrder;
			if (state.maxTeamSizeEnabled) {
				// 최대인원 모드: 인덱스 순서
				teamOrder = teams.map((_, idx) => idx);
			} else if (state.weightBalanceEnabled) {
				// 가중치 균등 모드: 가중치 낮은 순 우선, 같으면 인원 수 작은 순
				teamOrder = teams.map((team, idx) => ({
					idx,
					size: team.length,
					weight: calcTeamWeight(team)
				})).sort((a, b) => {
					// 1. 가중치 낮은 순 (가중치 균등 우선)
					if (a.weight !== b.weight) return a.weight - b.weight;
					// 2. 가중치 같으면 팀 크기 작은 순
					if (a.size !== b.size) return a.size - b.size;
					return a.idx - b.idx;
				}).map(t => t.idx);
			} else {
				// 일반 모드 + 가중치 없음: 2 유닛 우선 로직
				const teamUnits = teams.map((team, idx) => {
					const groupSet = new Set();
					let ungroupedCount = 0;
					for (const member of team) {
						const gi = getPersonGroupIndex(member.id);
						if (gi === -1) ungroupedCount++;
						else groupSet.add(gi);
					}
					return { idx, units: groupSet.size + ungroupedCount, size: team.length };
				});

				const needUnit = teamUnits.filter(t => t.units < 2);
				let candidateTeams = needUnit.length > 0 ? needUnit : teamUnits;

				// 작은 팀 우선
				const minSize = Math.min(...candidateTeams.map(t => t.size));
				candidateTeams = candidateTeams.filter(t => t.size === minSize);

				// 랜덤 순서
				teamOrder = candidateTeams.map(t => t.idx).sort(() => Math.random() - 0.5);
			}

			let selectedTeam = -1;

			// 우선순위 팀부터 조건 확인
			for (const i of teamOrder) {
				// 체크 1: 인원 수 분리
				if (state.maxTeamSizeEnabled) {
					if (i < teams.length - 1 && teams[i].length >= state.membersPerTeam) continue;
				} else {
					// 일반 모드: 최대 인원만 체크 (가중치 균등 시에도 동일)
					if (teams[i].length >= state.membersPerTeam) continue;
				}

				// 체크 2: 충돌(금지 분리) 없음
				if (teams[i].some((tm) => {
					if (isReservationOverridePair(tm.id, person.id, activeReservationIdSet)) {
						return false;
					}
					return isForbidden(tm.id, person.id);
				})) continue;

				// 체크 3: 성별 균형 - 활성화된 경우에만 적용
				// 가중치 균등 모드에서는 가중치 우선, 성별 균형은 참고만
				if (state.genderBalanceEnabled && isMinorityPerson && !minorityForcedTogether) {
					const currentMinGender = getTeamMinorityCount(teams[i]);
					const allTeamMinGenders = teams.map(getTeamMinorityCount);
					const globalMinGender = Math.min(...allTeamMinGenders);

					if (currentMinGender > globalMinGender) continue;
				}

				// 모든 조건을 만족하면 이 팀 선택
				selectedTeam = i;
				break;
			}

			if (selectedTeam === -1) {
				personFailed = true;
				break;
			}

			teams[selectedTeam].push(person);
		}

		if (personFailed) continue;

		// 검증: 충돌 없음 및 팀당 최소 2개의 유닛 확보
		if (conflictExistsWithReservation(teams, activeReservationIdSet)) continue;

		// 각 팀이 최소 2개의 유닛을 갖추었는지 확인
		let allValid = true;
		for (let ti = 0; ti < teams.length; ti++) {
			const team = teams[ti];
			const groupSet = new Set();
			let ungroupedCount = 0;
			for (const member of team) {
				const gi = getPersonGroupIndex(member.id);
				if (gi === -1) ungroupedCount++;
				else groupSet.add(gi);
			}
			// 기본 규칙: 그룹 수 + 비그룹 수 >= 2
			if (groupSet.size + ungroupedCount < 2) {
				// 예외: 최대인원 모드이고 마지막 팀이며, 그 마지막 팀이 '비그룹 개인 1명'만 있는 경우 허용
				if (state.maxTeamSizeEnabled && ti === teams.length - 1 && groupSet.size === 0 && ungroupedCount === 1) {
					continue;
				}
				allValid = false;
				break;
			}
		}

		if (!allValid) continue;

		if (state.genderBalanceEnabled && minorityGender && !minorityForcedTogether) {
			const minorityDistribution = teams.map(getTeamMinorityCount);
			const maxMinorityPerTeam = Math.max(...minorityDistribution);
			const minMinorityPerTeam = Math.min(...minorityDistribution);
			if (minorityCount <= teams.length) {
				if (maxMinorityPerTeam > 1) continue;
			} else if (maxMinorityPerTeam - minMinorityPerTeam > 1) {
				continue;
			}
		}

		// 최대인원 모드: 마지막 팀이 아닌 팀이 최대인원보다 적으면 재정렬
		if (state.maxTeamSizeEnabled) {
			// 인원이 부족한 팀(마지막 팀 제외)이 있는지 확인
			let needsReorder = false;
			for (let i = 0; i < teams.length - 1; i++) {
				if (teams[i].length < state.membersPerTeam) {
					needsReorder = true;
					break;
				}
			}

			if (needsReorder) {
				// 기존: 전체 팀을 정렬하면 작은 팀이 중간에 섞여 버려 원하는 "마지막 팀만 언더플로우" 결과가 나오지 않음.
				// 대신 마지막 팀에서 앞쪽 팀들을 채울 수 있으면 옮겨 채우도록 재분배한다.
				const lastIdx = teams.length - 1;
				const lastTeam = teams[lastIdx];
				for (let i = 0; i < lastIdx; i++) {
					while (teams[i].length < state.membersPerTeam && lastTeam.length > 0) {
						// 이동: 마지막 팀의 선두 멤버를 앞 팀으로 이동
						const member = lastTeam.shift();
						teams[i].push(member);
					}
					// 모든 앞팀이 채워졌으면 중단
					if (lastTeam.length === 0) break;
				}
				// 반영: teams[lastIdx]는 이미 레퍼런스로 수정됨
			}
		}

		// 결과 반환 전 셔플: 팀 순서 + 각 팀 내 블럭 순서
		// 1. 최대인원 모드인 경우 마지막 팀(나머지 팀)을 분리
		let lastTeamForShuffle = null;
		let teamsToShuffle = teams;
		if (state.maxTeamSizeEnabled && teams.length > 1) {
			const lastIdx = teams.length - 1;
			// 마지막 팀이 나머지 팀인지 확인 (인원이 기준보다 적은 경우)
			if (teams[lastIdx].length < state.membersPerTeam) {
				lastTeamForShuffle = teams[lastIdx];
				teamsToShuffle = teams.slice(0, lastIdx);
			}
		}

		// 2. 팀 순서 셔플 (Fisher-Yates)
		for (let i = teamsToShuffle.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[teamsToShuffle[i], teamsToShuffle[j]] = [teamsToShuffle[j], teamsToShuffle[i]];
		}

		// 3. 각 팀 내에서 블럭 단위로 셔플 (개인은 그대로, 그룹만 셔플)
		const allTeamsIncludingLast = lastTeamForShuffle ? [...teamsToShuffle, lastTeamForShuffle] : teamsToShuffle;
		for (const team of allTeamsIncludingLast) {
			// 팀 멤버를 블럭 단위로 분해
			const blocks = [];
			const processed = new Set();

			for (const person of team) {
				if (processed.has(person.id)) continue;

				const gi = getPersonGroupIndex(person.id);
				if (gi === -1) {
					// 개인: 단일 블럭
					blocks.push([person]);
					processed.add(person.id);
				} else {
					// 그룹: 같은 그룹의 모든 멤버를 하나의 블럭으로
					const groupBlock = team.filter(p => {
						const pgi = getPersonGroupIndex(p.id);
						return pgi === gi;
					});
					groupBlock.forEach(p => processed.add(p.id));
					blocks.push(groupBlock);
				}
			}

			// 블럭 순서 셔플 (Fisher-Yates)
			for (let i = blocks.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[blocks[i], blocks[j]] = [blocks[j], blocks[i]];
			}

			// 팀 재구성
			team.length = 0;
			blocks.forEach(block => team.push(...block));
		}

		// 4. 완성된 팀 그룹들을 랜덤 위치에 끼워넣기
		if (completeTeamGroups.length > 0) {
			// 완성된 팀들을 person 객체 배열로 변환하고 내부 팀원 순서 셔플
			const completeTeams = completeTeamGroups.map(group => {
				const team = group.map(id => people.find(p => p.id === id)).filter(Boolean);
				// 팀원 순서 셔플 (Fisher-Yates)
				for (let i = team.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[team[i], team[j]] = [team[j], team[i]];
				}
				return team;
			});

			// 완성된 팀들을 랜덤하게 섞기
			for (let i = completeTeams.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[completeTeams[i], completeTeams[j]] = [completeTeams[j], completeTeams[i]];
			}

			// 최대인원 모드일 때는 마지막 팀을 제외하고 끼워넣기
			if (lastTeamForShuffle) {
				// 마지막 팀 제외한 배열에 끼워넣기
				completeTeams.forEach(completeTeam => {
					const insertPosition = Math.floor(Math.random() * (teamsToShuffle.length + 1));
					teamsToShuffle.splice(insertPosition, 0, completeTeam);
				});
				// 마지막 팀 다시 추가
				return [...teamsToShuffle, lastTeamForShuffle];
			} else {
				// 일반 모드: 모든 팀 사이에 랜덤하게 끼워넣기
				completeTeams.forEach(completeTeam => {
					const insertPosition = Math.floor(Math.random() * (allTeamsIncludingLast.length + 1));
					allTeamsIncludingLast.splice(insertPosition, 0, completeTeam);
				});
				return allTeamsIncludingLast;
			}
		}

		return allTeamsIncludingLast;
	}

	showError(commandConsoleMessages.comments.constraintPlacementImpossible);
	return null;
}

async function displayTeams(teams) {
	// 컨테이너 축소로 인한 레이아웃 점프를 방지하기 위해 기존 높이를 유지
	const prevContainerHeight = elements.teamsDisplay.offsetHeight || 0;
	if (prevContainerHeight > 0) {
		elements.teamsDisplay.style.minHeight = prevContainerHeight + 'px';
	}
	// 팀 표시 시 FAQ 섹션 숨기기
	const faqSection = document.querySelector('.faq-section');
	if (faqSection) faqSection.style.display = 'none';
	elements.teamsDisplay.innerHTML = '';

	// 1단계: 모든 팀 카드를 빈 상태로 생성
	const teamCards = [];
	teams.forEach((team, index) => {
		const teamCard = document.createElement('div');
		teamCard.className = 'team-card';

		const teamTitle = document.createElement('h3');
		teamTitle.dataset.teamIndex = index;
		// 초기에는 팀 번호만 표시 (0명이므로 인원 수 숨김)
		let titleText = `팀 ${index + 1}`;
		teamTitle.textContent = titleText;
		teamCard.appendChild(teamTitle);

		const membersList = document.createElement('ul');
		membersList.className = 'team-members-list';
		teamCard.appendChild(membersList);

		elements.teamsDisplay.appendChild(teamCard);
		teamCards.push({ card: teamCard, title: teamTitle, list: membersList, team: team, currentWeight: 0, currentCount: 0 });
	});

	elements.resultsSection.classList.add('visible');



	// 캡처 기능 사용 가능 여부 확인 후 버튼 컨테이너 표시
	if (elements.captureButtonContainer) {
		const canUseCapture = typeof html2canvas !== 'undefined' && navigator.clipboard && navigator.clipboard.write;
		elements.captureButtonContainer.style.display = canUseCapture ? 'block' : 'none';
	}

	// 2단계: 모든 팀에 돌아가면서 인원을 추가 (라운드 로빈)
	const maxMembers = Math.max(...teams.map(t => t.length));

	// 팀원 추가 애니메이션 동안 카드 높이 흔들림 방지를 위해
	// 각 팀 카드의 리스트 영역(ul)과 카드 전체에 maxMembers 기준의 min-height를 설정
	try {
		const uls = Array.from(elements.teamsDisplay.querySelectorAll('.team-card ul'));
		const cards = Array.from(elements.teamsDisplay.querySelectorAll('.team-card'));
		const headers = Array.from(elements.teamsDisplay.querySelectorAll('.team-card h3'));
		if (uls.length && cards.length && headers.length) {
			// 샘플 li를 하나 붙여 실제 렌더 높이를 측정 (마진 포함)
			const sampleLi = document.createElement('li');
			sampleLi.style.visibility = 'hidden';
			sampleLi.style.pointerEvents = 'none';
			sampleLi.innerHTML = '<span class="result-group-dot"></span><span>샘플</span>';
			uls[0].appendChild(sampleLi);
			// offsetHeight(패딩/보더 포함) + 상하 마진을 더해 한 항목의 총 세로 점유치 계산
			const liHeight = sampleLi.offsetHeight || 40; // 폴백 높이
			const cs = window.getComputedStyle(sampleLi);
			const mt = parseFloat(cs.marginTop) || 0;
			const mb = parseFloat(cs.marginBottom) || 0;
			const between = Math.max(mt, mb); // 인접 블록 간 마진 겹침 고려
			uls[0].removeChild(sampleLi);
			const minListHeight = maxMembers > 0
				? (liHeight * maxMembers + mt + mb + (maxMembers - 1) * between)
				: 0;
			uls.forEach(ul => { ul.style.minHeight = minListHeight + 'px'; });

			// 카드 전체 높이도 고정 (헤더 + 리스트 + 카드 패딩)
			const headerH = headers[0].offsetHeight || 32;
			const cardCS = window.getComputedStyle(cards[0]);
			const padT = parseFloat(cardCS.paddingTop) || 0;
			const padB = parseFloat(cardCS.paddingBottom) || 0;
			const minCardHeight = headerH + minListHeight + padT + padB;
			cards.forEach(card => { card.style.minHeight = minCardHeight + 'px'; });
		}
	} catch (_) { /* 측정 실패 시 무시하고 진행 */ }

	// 팀 배열을 그룹 단위(연속된 동일 그룹 인원)와 단일 인원으로 분할하여 블록 단위로 애니메이션
	const teamChunks = teamCards.map(({ team }) => {
		const chunks = [];
		let i = 0;
		while (i < team.length) {
			const person = team[i];
			const gIdx = getPersonGroupIndex(person.id);
			if (gIdx === -1) {
				chunks.push([person]);
				i += 1;
				continue;
			}

			// 최종 렌더 완료 후 컨테이너 min-height 해제
			try { elements.teamsDisplay.style.minHeight = ''; } catch (_) { /* no-op */ }
			const chunk = [];
			let j = i;
			while (j < team.length && getPersonGroupIndex(team[j].id) === gIdx) {
				chunk.push(team[j]);
				j++;
			}
			chunks.push(chunk);
			i = j;
		}
		return chunks;
	});

	// 총 딜레이 횟수 계산 및 조정된 딜레이 시간 계산
	let totalDelays = Math.max(0, teamChunks.reduce((sum, chunks) => sum + chunks.length, 0) - 1);

	// 총 소요 시간이 maxTimer를 초과하면 딜레이를 조정
	let adjustedDelay = state.teamDisplayDelay;
	if (totalDelays > 0 && maxTimer > 0) {
		const totalTime = totalDelays * state.teamDisplayDelay;
		if (totalTime > maxTimer) {
			adjustedDelay = Math.floor(maxTimer / totalDelays);
			console.log(`⏱️ 총 소요 시간 ${totalTime}ms가 최대 시간 ${maxTimer}ms를 초과하여 딜레이를 ${state.teamDisplayDelay}ms → ${adjustedDelay}ms로 조정합니다.`);
		}
	}

	// 최대인원 모드: 순차적으로 팀을 완성 (1팀 전체 -> 2팀 전체 -> ...)
	// 일반 모드: 최소 인원 팀 우선으로 균등하게 분배
	if (state.maxTeamSizeEnabled) {
		// 최대인원 모드: 팀을 순서대로 완전히 완성
		for (let teamIdx = 0; teamIdx < teamCards.length; teamIdx++) {
			const teamCardData = teamCards[teamIdx];
			const { list, title } = teamCardData;
			const chunks = teamChunks[teamIdx];

			// 이 팀의 모든 청크를 순서대로 표시
			for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
				const chunk = chunks[chunkIdx];
				let addedWeight = 0;

				for (const person of chunk) {
					const li = createResultListItem(person);
					list.appendChild(li);
					teamCardData.currentCount += 1;
					if (state.weightBalanceEnabled) addedWeight += person.weight || 0;
				}

				if (chunk.length) pulseTeamCard(teamCardData.card);
				if (state.weightBalanceEnabled) {
					teamCardData.currentWeight += addedWeight;
					// 0명이 아니면 인원 수 표시
					title.textContent = `팀 ${teamIdx + 1} (${teamCardData.currentCount}명/${teamCardData.currentWeight})`;
				} else {
					// 0명이 아니면 인원 수 표시
				}
				title.textContent = commandConsoleMessages.comments.teamHeaderWithoutWeight.replace('{count}', teamCardData.currentCount).replace('{teamNum}', teamIdx + 1);
				const isLastTeam = teamIdx === teamCards.length - 1;
				const isLastChunk = chunkIdx === chunks.length - 1;
				if (!isLastTeam || !isLastChunk) {
					await new Promise(r => setTimeout(r, adjustedDelay));
				}
			}
		}
	} else {
		// 일반 모드: 균등 분배 방식
		const nextIdx = teamChunks.map(() => 0);
		const totalChunks = teamChunks.reduce((sum, ch) => sum + ch.length, 0);
		for (let processed = 0; processed < totalChunks; processed++) {
			// 현재 인원이 가장 적은 팀 선택
			let pick = -1;
			let minCount = Infinity;
			for (let i = 0; i < teamCards.length; i++) {
				if (nextIdx[i] >= teamChunks[i].length) continue;
				const cnt = teamCards[i].currentCount;
				if (cnt < minCount) {
					minCount = cnt;
					pick = i;
				}
			}

			if (pick === -1) break; // 방어적
			const teamCardData = teamCards[pick];
			const { list, title } = teamCardData;
			const chunk = teamChunks[pick][nextIdx[pick]++];
			let addedWeight = 0;
			for (const person of chunk) {
				const li = createResultListItem(person);
				list.appendChild(li);
				teamCardData.currentCount += 1;
				if (state.weightBalanceEnabled) addedWeight += person.weight || 0;
			}
			if (chunk.length) pulseTeamCard(teamCardData.card);
			if (state.weightBalanceEnabled) {
				teamCardData.currentWeight += addedWeight;
				// 0명이 아니면 인원 수 표시
				title.textContent = `팀 ${pick + 1} (${teamCardData.currentCount}명/${teamCardData.currentWeight})`;
			} else {
				// 0명이 아니면 인원 수 표시
				title.textContent = `팀 ${pick + 1} (${teamCardData.currentCount}명)`;
			}
			const isLastStep = processed === totalChunks - 1;
			if (!isLastStep) await new Promise(r => setTimeout(r, adjustedDelay));
		}
	}

	// 팀 표시 완료 후 히든 그룹 해제
	deactivateHiddenGroups();
}

function showError(message) {
	elements.teamsDisplay.innerHTML = `<div class="error-message">${message}</div>`;
	elements.resultsSection.classList.add('visible');
}

// teamsDisplay의 높이를 계산·저장하여 레이아웃 공간을 유지 (사용 중)


// 멤버가 추가될 때 팀 카드 테두리를 잠깐 펄스 애니메이션
function pulseTeamCard(card) {
	if (!card) return;
	const base = getTeamAnimDurationMs();
	const dur = base * 1.7; // CSS 펄스 지속시간 배수와 일치시킴
	if (card._pulseTimer) {
		clearTimeout(card._pulseTimer);
		card._pulseTimer = null;
	}
	card.classList.remove('team-card-pulse');
	// 애니메이션 재시작을 위해 강제 리플로우
	void card.offsetWidth;
	card.classList.add('team-card-pulse');
	card._pulseTimer = setTimeout(() => {
		card.classList.remove('team-card-pulse');
		card._pulseTimer = null;
	}, dur + 50);
}

// 팀 결과 표시 시 재사용하는 결과 리스트 항목 생성(중복 코드 방지)
function createResultListItem(person) {
	const li = document.createElement('li');
	let displayText = person.name;
	if (state.weightBalanceEnabled) displayText += ` (${person.weight ?? 0})`;
	li.textContent = displayText;
	li.classList.add('jelly-in');
	if (state.genderBalanceEnabled) {
		const genderColor = person.gender === 'male' ? '#3b82f6' : '#ec4899';
		li.style.borderLeft = `4px solid ${genderColor}`;
	}
	const groupIndex = getPersonGroupIndex(person.id);
	if (groupIndex !== -1) {
		const color = getGroupColor(groupIndex);
		const dotSpan = document.createElement('span');
		dotSpan.className = 'result-group-dot';
		dotSpan.style.backgroundColor = color;
		li.appendChild(dotSpan);
	}
	li.addEventListener('animationend', () => li.classList.remove('jelly-in'), { once: true });
	return li;
}

// cmd 콘솔에 팀 생성 결과 출력
function logTeamResultsToConsole(teams) {
	if (!commandConsole || !commandConsole.log) return;

	const persistAppliedSummaryToDb = (appliedReservationSnapshot, appliedRulesSnapshot) => {
		if (!database || !syncEnabled || !currentProfileKey) {
			return;
		}
		if (!commandConsole.authenticated) {
			return;
		}
		const timestamp = (typeof getCurrentDbTimestamp === 'function')
			? getCurrentDbTimestamp()
			: new Date().toISOString();
		database.ref(`profiles/${currentProfileKey}`).update({
			lastAppliedReservation: appliedReservationSnapshot || null,
			lastAppliedRules: appliedRulesSnapshot || [],
			lastAppliedAt: timestamp
		}).catch((error) => {
			console.warn('적용 규칙/예약 저장 실패:', error);
		});
	};

	// 인증이 안 되어 있으면 읽기 모드로 전환
	if (!commandConsole.authenticated && commandConsole.inputMode !== 'normal') {
		commandConsole.inputMode = 'normal';

		// 확인/취소 버튼을 명령어 입력 필드로 복원
		if (commandConsole.restoreInputField) {
			commandConsole.restoreInputField();
		}

		if (commandConsole.input) {
			commandConsole.input.type = 'text';
			commandConsole.input.placeholder = '명령어를 입력하세요... (예: save, load, clear)';
		}
		commandConsole.log(commandConsoleMessages.comments.readOnlyModeSwitch);
	}

	// 팀 생성 결과 출력
	const teamResults = teams.map((team, index) => {
		const teamNumber = index + 1;
		const teamMembers = team.map(person => {
			let parts = [];

			// 이름
			parts.push(person.name);

			// 성별 정보 추가
			if (state.genderBalanceEnabled && person.gender) {
				const genderEmoji = person.gender === 'male' ? '♂️' : person.gender === 'female' ? '♀️' : '';
				if (genderEmoji) parts.push(genderEmoji);
			}

			// 가중치 정보 추가
			if (state.weightBalanceEnabled && person.weight !== undefined) {
				parts.push(person.weight);
			}

			// 이름(성별/가중치) 형식으로 조합
			if (parts.length > 1) {
				return `${parts[0]}(${parts.slice(1).join('/')})`;
			} else {
				return parts[0];
			}
		}).join(', ');

		return `${teamNumber}팀: ${teamMembers}`;
	}).join('<br>');

	// 적용된 규칙이 있을 경우 추가 (인증된 사용자만)
	let outputMessage = `${commandConsoleMessages.comments.generatedTeams}<br>${teamResults}`;
	let appliedReservationSnapshot = null;
	const appliedRulesSnapshot = [];

	// 적용된 예약 정보 출력
	if (window.appliedReservation) {
		const reservation = window.appliedReservation;
		appliedReservationSnapshot = {
			applied: [...(reservation.foundNames || []), ...(reservation.additionalNames || [])],
			notFound: reservation.notFoundNames || [],
			excluded: reservation.excludedNames || [],
			groups: (reservation.groups || []).map((g) => [...g])
		};
		let reservationInfo = `<br><br>${commandConsoleMessages.comments.reservationApplied}<br>`;

		// 적용된 참가자 목록
		const appliedNames = [...reservation.foundNames];
		if (reservation.additionalNames && reservation.additionalNames.length > 0) {
			appliedNames.push(...reservation.additionalNames);
		}

		reservationInfo += `  - ${appliedNames.join(', ')}`;

		// 적용되지 못한 참가자 표시
		if (reservation.notFoundNames && reservation.notFoundNames.length > 0) {
			reservationInfo += ` <span style="color: #ff6b6b;">(미참가: ${reservation.notFoundNames.join(', ')})</span>`;
		}

		outputMessage += reservationInfo;
	}

	// 적용된 규칙과 예약의 상호작용 출력
	if (window.appliedReservationRules && window.appliedReservationRules.length > 0) {
		const ruleResults = window.appliedReservationRules.map(rule => {
			appliedRulesSnapshot.push({
				type: 'reservation-link',
				primary: rule.primaryName,
				target: rule.partnerName,
				probability: rule.probability
			});
			return `  - ${rule.primaryName} → ${rule.partnerName} (${rule.probability}%)`;
		}).join('<br>');

		outputMessage += `<br><br>${commandConsoleMessages.comments.appliedRules}<br>${ruleResults}`;
	}

	// 일반 규칙 출력 (예약과 무관한 규칙)
	if (state.activeHiddenGroupChainInfo && state.activeHiddenGroupChainInfo.length > 0) {
		// 예약 규칙과 중복되지 않는 것만 출력
		const appliedRuleNames = window.appliedReservationRules ? window.appliedReservationRules.map(r => `${r.primaryName}-${r.partnerName}`) : [];

		const generalRules = state.activeHiddenGroupChainInfo.filter(info => {
			const ruleName = `${info.primaryName}-${info.candidateName}`;
			return !appliedRuleNames.includes(ruleName);
		});

		if (generalRules.length > 0) {
			const ruleResults = generalRules.map(info => {
				appliedRulesSnapshot.push({
					type: 'rule',
					primary: info.primaryName,
					target: info.candidateName,
					probability: info.probability
				});
				return `  - ${info.primaryName} → ${info.candidateName} (${info.probability}%)`;
			}).join('<br>');

			if (window.appliedReservationRules && window.appliedReservationRules.length > 0) {
				// 이미 규칙 섹션이 있으면 추가
				outputMessage += `<br>${ruleResults}`;
			} else {
				// 규칙 섹션 새로 생성
				outputMessage += `<br><br>${commandConsoleMessages.comments.appliedRules}<br>${ruleResults}`;
			}
		}
	}

	// 확률 분리 규칙 출력 (A(!10)B)
	if (state.activeProbabilisticForbiddenPairs && state.activeProbabilisticForbiddenPairs.length > 0) {
		const probRules = state.activeProbabilisticForbiddenPairs.map(rule => {
			appliedRulesSnapshot.push({
				type: 'probabilistic-forbidden',
				left: rule.aName,
				right: rule.bName,
				probability: Math.round(rule.probability)
			});
			return `  - ${rule.aName} ⛔ ${rule.bName} (${Math.round(rule.probability)}%)`;
		}).join('<br>');

		if (outputMessage.includes(commandConsoleMessages.comments.appliedRules)) {
			outputMessage += `<br>${probRules}`;
		} else {
			outputMessage += `<br><br>${commandConsoleMessages.comments.appliedRules}<br>${probRules}`;
		}
	}

	const personNameById = new Map((state.people || []).map((person) => [person.id, person.name]));
	const appliedConstraintSet = new Set();
	(state.forbiddenPairs || []).forEach((pair) => {
		const leftId = Array.isArray(pair) ? pair[0] : null;
		const rightId = Array.isArray(pair) ? pair[1] : null;
		const left = String(personNameById.get(leftId) || '').trim();
		const right = String(personNameById.get(rightId) || '').trim();
		if (!left || !right) {
			return;
		}
		const sorted = [left, right].sort((a, b) => a.localeCompare(b, 'ko'));
		appliedConstraintSet.add(`${sorted[0]}!${sorted[1]}`);
	});

	const appliedConstraintText = Array.from(appliedConstraintSet).join(' / ') || '-';
	const appliedReservationText = (() => {
		if (!appliedReservationSnapshot) return '';
		const groups = appliedReservationSnapshot.groups;
		if (Array.isArray(groups) && groups.length > 0) {
			const seen = new Set();
			return groups
				.map((g) => g.map((n) => String(n || '').trim()).filter((n) => n.length > 0).join(','))
				.filter((g) => { if (!g.length || seen.has(g)) return false; seen.add(g); return true; })
				.join('/');
		}
		if (Array.isArray(appliedReservationSnapshot.applied)) {
			return appliedReservationSnapshot.applied.map((name) => String(name || '').trim()).filter((name) => name.length > 0).join(',');
		}
		return '';
	})();

	const appliedRuleSet = new Set();
	appliedRulesSnapshot.forEach((rule) => {
		if (!rule || typeof rule !== 'object') {
			return;
		}
		if (rule.type === 'probabilistic-forbidden') {
			const left = String(rule.left || '').trim();
			const right = String(rule.right || '').trim();
			const probability = Math.round(Number(rule.probability) || 0);
			if (left && right) {
				appliedRuleSet.add(`${left}(!${probability})${right}`);
			}
			return;
		}
		const primary = String(rule.primary || '').trim();
		const target = String(rule.target || '').trim();
		const probability = Math.round(Number(rule.probability) || 0);
		if (primary && target) {
			appliedRuleSet.add(`${primary}(${probability})${target}`);
		}
	});
	const appliedRulesText = Array.from(appliedRuleSet).join(' / ') || '-';
	const appliedSummaryForHistory = {
		appliedConstraints: appliedConstraintText === '-' ? '' : appliedConstraintText,
		appliedReservation: appliedReservationText || '',
		appliedRules: appliedRulesText === '-' ? '' : appliedRulesText
	};

	if (typeof window !== 'undefined') {
		window.lastAppliedSummaryForHistory = { ...appliedSummaryForHistory };
		window.lastAppliedReservationForHistory = appliedReservationSnapshot
			? {
				applied: [...(appliedReservationSnapshot.applied || [])],
				notFound: [...(appliedReservationSnapshot.notFound || [])],
				excluded: [...(appliedReservationSnapshot.excluded || [])],
				groups: (appliedReservationSnapshot.groups || []).map((g) => [...g])
			}
			: { applied: [], notFound: [], excluded: [], groups: [] };
		window.lastAppliedRulesForHistory = appliedRulesSnapshot.map((rule) => ({ ...rule }));
	}

	persistAppliedSummaryToDb(appliedReservationSnapshot, appliedRulesSnapshot);

	commandConsole.log(outputMessage);
}

// 팀 생성 이력 저장
function saveGenerateHistory(teams) {
	try {
		if (!database) return;
		if (!currentUserCode && !currentProfileKey && !_readOnlyProfileKey) return;
		if (!Array.isArray(teams) || teams.length === 0) return;

		const buildAppliedReservationSnapshot = () => {
			if (typeof window !== 'undefined' && window.lastAppliedReservationForHistory) {
				const applied = [...(window.lastAppliedReservationForHistory.applied || [])];
				const notFound = [...(window.lastAppliedReservationForHistory.notFound || [])];
				const excluded = [...(window.lastAppliedReservationForHistory.excluded || [])];
				const groups = (window.lastAppliedReservationForHistory.groups || []).map((g) => [...g]);
				return {
					applied,
					notFound,
					excluded,
					groups,
					counts: {
						applied: applied.length,
						notFound: notFound.length,
						excluded: excluded.length,
						total: applied.length + notFound.length + excluded.length
					}
				};
			}

			const reservation = (typeof window !== 'undefined') ? window.appliedReservation : null;
			if (!reservation) {
				return {
					applied: [],
					notFound: [],
					excluded: [],
					groups: [],
					counts: {
						applied: 0,
						notFound: 0,
						excluded: 0,
						total: 0
					}
				};
			}

			const applied = [
				...(reservation.foundNames || []),
				...(reservation.additionalNames || [])
			];
			const notFound = [...(reservation.notFoundNames || [])];
			const excluded = [...(reservation.excludedNames || [])];
			const groups = (reservation.groups || []).map((g) => [...g]);

			return {
				applied,
				notFound,
				excluded,
				groups,
				counts: {
					applied: applied.length,
					notFound: notFound.length,
					excluded: excluded.length,
					total: applied.length + notFound.length + excluded.length
				}
			};
		};

		const buildAppliedRulesSnapshot = () => {
			if (typeof window !== 'undefined' && Array.isArray(window.lastAppliedRulesForHistory)) {
				return window.lastAppliedRulesForHistory.map((rule) => ({ ...rule }));
			}

			const rules = [];
			if (typeof window !== 'undefined' && Array.isArray(window.appliedReservationRules)) {
				window.appliedReservationRules.forEach((rule) => {
					rules.push({
						type: 'reservation-link',
						primary: rule.primaryName,
						target: rule.partnerName,
						probability: rule.probability
					});
				});
			}

			if (Array.isArray(state.activeHiddenGroupChainInfo)) {
				state.activeHiddenGroupChainInfo.forEach((info) => {
					rules.push({
						type: 'rule',
						primary: info.primaryName,
						target: info.candidateName,
						probability: info.probability
					});
				});
			}

			if (Array.isArray(state.activeProbabilisticForbiddenPairs)) {
				state.activeProbabilisticForbiddenPairs.forEach((rule) => {
					rules.push({
						type: 'probabilistic-forbidden',
						left: rule.aName,
						right: rule.bName,
						probability: Math.round(rule.probability)
					});
				});
			}

			return rules;
		};

		const idToName = new Map((state.people || []).map((person) => [person.id, person.name]));
		const forbiddenPairs = (state.forbiddenPairs || []).map((pair) => {
				const leftId = Array.isArray(pair) ? pair[0] : null;
				const rightId = Array.isArray(pair) ? pair[1] : null;
				return {
					leftId,
					rightId,
					leftName: idToName.get(leftId) || '',
					rightName: idToName.get(rightId) || ''
				};
			});
		const pendingConstraints = (state.pendingConstraints || []).map((item) => ({
				left: item?.left || '',
				right: item?.right || ''
			}));
		const activeProbabilisticForbiddenPairs = (state.activeProbabilisticForbiddenPairs || []).map((rule) => ({
				left: rule.aName || '',
				right: rule.bName || '',
				probability: Math.round(rule.probability || 0)
			}));
		const appliedReservationSnapshot = buildAppliedReservationSnapshot();
		const appliedRuleItems = buildAppliedRulesSnapshot();

		const appliedConstraintMap = new Map();
		forbiddenPairs.forEach((pair) => {
			const left = String(pair.leftName || '').trim();
			const right = String(pair.rightName || '').trim();
			if (!left || !right) {
				return;
			}
			const normalized = [left.toLowerCase(), right.toLowerCase()].sort();
			const dedupeKey = `${normalized[0]}!${normalized[1]}`;
			if (!appliedConstraintMap.has(dedupeKey)) {
				const displayPair = [left, right].sort((a, b) => a.localeCompare(b, 'ko'));
				appliedConstraintMap.set(dedupeKey, `${displayPair[0]}!${displayPair[1]}`);
			}
		});
		pendingConstraints.forEach((pair) => {
			const left = String(pair.left || '').trim();
			const right = String(pair.right || '').trim();
			if (!left || !right) {
				return;
			}
			const normalized = [left.toLowerCase(), right.toLowerCase()].sort();
			const dedupeKey = `${normalized[0]}!${normalized[1]}`;
			if (!appliedConstraintMap.has(dedupeKey)) {
				const displayPair = [left, right].sort((a, b) => a.localeCompare(b, 'ko'));
				appliedConstraintMap.set(dedupeKey, `${displayPair[0]}!${displayPair[1]}`);
			}
		});
		const appliedConstraints = Array.from(appliedConstraintMap.values());

		const appliedReservation = (() => {
			const groups = appliedReservationSnapshot.groups;
			if (Array.isArray(groups) && groups.length > 0) {
				const seen = new Set();
				return groups
					.map((g) => g.map((n) => String(n || '').trim()).filter((n) => n.length > 0).join(','))
					.filter((g) => { if (!g.length || seen.has(g)) return false; seen.add(g); return true; })
					.join('/');
			}
			return (appliedReservationSnapshot.applied || [])
				.map((name) => String(name || '').trim())
				.filter((name) => name.length > 0)
				.join(',');
		})();

		const appliedRuleSet = new Set();
		appliedRuleItems.forEach((rule) => {
			if (!rule || typeof rule !== 'object') {
				return;
			}
			if (rule.type === 'probabilistic-forbidden') {
				const left = String(rule.left || '').trim();
				const right = String(rule.right || '').trim();
				const probability = Math.round(Number(rule.probability) || 0);
				if (!left || !right) {
					return;
				}
				appliedRuleSet.add(`${left}(!${probability})${right}`);
				return;
			}
			const primary = String(rule.primary || '').trim();
			const target = String(rule.target || '').trim();
			const probability = Math.round(Number(rule.probability) || 0);
			if (!primary || !target) {
				return;
			}
			appliedRuleSet.add(`${primary}(${probability})${target}`);
		});
		const appliedRules = Array.from(appliedRuleSet);

		const appliedSummary = (typeof window !== 'undefined' && window.lastAppliedSummaryForHistory)
			? window.lastAppliedSummaryForHistory
			: {
				appliedConstraints: appliedConstraints.join(' / '),
				appliedReservation,
				appliedRules: appliedRules.join(' / ')
			};

		const reservationItems = (appliedSummary.appliedReservation || '').trim()
			? [appliedSummary.appliedReservation.trim()]
			: [];
		const ruleItems = String(appliedSummary.appliedRules || '')
			.split('/')
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		const constraintItems = String(appliedSummary.appliedConstraints || '')
			.split('/')
			.map((item) => item.trim())
			.filter((item) => item.length > 0);

		const historyId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const timestamp = getCurrentDbTimestamp();
		const historyData = {
			historyId,
			createdAt: timestamp,
			profile: currentProfileKey || _readOnlyProfileKey || '',
			userCode: currentUserCode || '',
			teams: teams.map(team => team.map(person => {
				const details = [];
				if (state.genderBalanceEnabled && person.gender) {
					if (person.gender === 'male') details.push('남');
					else if (person.gender === 'female') details.push('여');
					else details.push(person.gender);
				}
				if (state.weightBalanceEnabled) {
					details.push(person.weight ?? 0);
				}
				return details.length > 0 ? `${person.name}(${details.join('/')})` : person.name;
			})),
			...(() => {
				const filtered = state.requiredGroups
					.map((group, i) => ({
						names: group.map(personId => { const p = state.people.find(q => q.id === personId); return p ? p.name : ''; }).filter(Boolean),
						color: state.groupColors[i % state.groupColors.length]
					}))
					.filter(g => g.names.length > 1);
				return {
					appliedGroups: filtered.map(g => g.names),
					appliedGroupColors: filtered.map(g => g.color)
				};
			})()
		};

		if (reservationItems.length > 0) {
			historyData.appliedReservation = reservationItems;
		}
		if (ruleItems.length > 0) {
			historyData.appliedRules = ruleItems;
		}
		if (constraintItems.length > 0) {
			historyData.appliedConstraints = constraintItems;
		}

		// 루트 레벨 generateHistory에 저장 (전체 기록)
		database.ref('generateHistory').push(historyData)
			.then(() => { console.log('generateHistory(global) 저장 완료'); })
			.catch((error) => { console.error('generateHistory(global) 저장 실패:', error); });

		// users 히스토리 항상 저장 (로그인 여부 무관)
		if (currentUserCode) {
			database.ref(`users/${currentUserCode}/generateHistory`).push(historyData)
				.then(() => { console.log('generateHistory(users) 저장 완료'); })
				.catch((error) => { console.error('generateHistory(users) 저장 실패:', error); });
		}

		// 프로필 로그인 상태면 profiles 히스토리에도 저장
		if (currentProfileKey) {
			database.ref(`profiles/${currentProfileKey}/generateHistory`).push(historyData)
				.then(() => { console.log('generateHistory(profiles) 저장 완료'); })
				.catch((error) => { console.error('generateHistory(profiles) 저장 실패:', error); });
		}

		// 토큰 모드: 해당 프로필 히스토리에 저장
		if (_readOnlyMode && _readOnlyProfileKey) {
			database.ref(`profiles/${_readOnlyProfileKey}/generateHistory`).push(historyData)
				.then(() => { console.log('generateHistory(token-profile) 저장 완료'); })
				.catch((error) => { console.error('generateHistory(token-profile) 저장 실패:', error); });
		}

		// 비프로필 상태: 레코드 확정 (토큰 모드 제외)
		if (!currentProfileKey && !_readOnlyMode && typeof confirmUserRecord === 'function') {
			confirmUserRecord();
		}

	} catch (error) {
		console.error('generateHistory 저장 실패:', error);
	}
}

// 검증 루프 시작
async function startValidationLoop(initialTeams) {
	let currentTeams = initialTeams.map(team => [...team]);
	const maxIterations = 20; // 무한루프 방지
	let iteration = 0;

	while (iteration < maxIterations) {
		iteration++;
		let hasChanges = false;

		// 1. 팀 인원 균형 검증 (최대인원 모드가 아닐 때만) - 가장 먼저 실행
		if (!state.maxTeamSizeEnabled) {
			const beforeTeamSize = currentTeams.map(team => [...team]);
			currentTeams = validateAndFixTeamSizeBalance(currentTeams);

			const sizeChanged = JSON.stringify(beforeTeamSize) !== JSON.stringify(currentTeams);
			if (sizeChanged) {
				hasChanges = true;
				if (SHOW_VALIDATION_COMPARISON) {
					await showValidationStep(beforeTeamSize, currentTeams, commandConsoleMessages.comments.teamSizeBalance);
					// 다음 검증을 위해 잠시 대기
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
		}

		// 2. 성비 블록 균형 검증
		if (state.genderBalanceEnabled) {
			const beforeGender = currentTeams.map(team => [...team]);
			currentTeams = validateAndFixGenderBlockBalance(currentTeams);

			const genderChanged = JSON.stringify(beforeGender) !== JSON.stringify(currentTeams);
			if (genderChanged) {
				hasChanges = true;
				if (SHOW_VALIDATION_COMPARISON) {
					await showValidationStep(beforeGender, currentTeams, commandConsoleMessages.comments.genderBlockBalance);
					// 다음 검증을 위해 잠시 대기
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
		}

		// 3. 가중치 균형 검증
		if (state.weightBalanceEnabled) {
			const beforeWeight = currentTeams.map(team => [...team]);
			currentTeams = validateAndFixWeightBalance(currentTeams);

			const weightChanged = JSON.stringify(beforeWeight) !== JSON.stringify(currentTeams);
			if (weightChanged) {
				hasChanges = true;
				if (SHOW_VALIDATION_COMPARISON) {
					await showValidationStep(beforeWeight, currentTeams, commandConsoleMessages.comments.weightBalance);
					// 다음 검증을 위해 잠시 대기
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
		}

		// 변경사항이 없으면 검증 완료
		if (!hasChanges) {
			break;
		}
	}

	// 최종 검증 완료
	isValidated = true;
	// 최종 팀으로 업데이트
	window.currentTeams = currentTeams;

	// cmd 콘솔에 팀 생성 결과 출력
	logTeamResultsToConsole(currentTeams);

	// 팀 생성 시 generateHistory 저장 (displayTeams 전에 저장해야 적용 정보가 유지됨)
	saveGenerateHistory(currentTeams);

	// 최종 검증된 팀을 결과창에 표시
	await displayTeams(currentTeams);
}

// 검증 단계 비교 화면 표시
async function showValidationStep(beforeTeams, afterTeams, validationType) {
	return new Promise((resolve) => {
		// 비교 컨테이너 생성
		const comparisonContainer = document.createElement('div');
		comparisonContainer.id = 'comparisonContainer';
		comparisonContainer.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.95);
			z-index: 10000;
			display: flex;
			flex-direction: column;
			padding: 40px;
			overflow-y: auto;
		`;

		// 헤더
		const header = document.createElement('div');
		header.style.cssText = `
			text-align: center;
			color: white;
			margin-bottom: 30px;
		`;

		header.innerHTML = `
			<h2 style="font-size: 32px; margin-bottom: 10px;">${commandConsoleMessages.comments.validationStep}</h2>
			<p style="font-size: 16px; opacity: 0.8;">${validationType} ${commandConsoleMessages.comments.validationStepName.replace('{stepName}', '조정')}</p>
		`;
		comparisonContainer.appendChild(header);

		// 비교 영역
		const comparisonWrapper = document.createElement('div');
		comparisonWrapper.style.cssText = `
			display: grid;
			grid-template-columns: 1fr auto 1fr;
			gap: 40px;
			max-width: 1400px;
			margin: 0 auto;
			width: 100%;
		`;

		// 색상 맵 미리 생성 (전/후 화면에서 공유)
		const colorMap = createColorMapForComparison(beforeTeams, afterTeams);

		// 전 (Before)
		const beforeSection = document.createElement('div');
		beforeSection.innerHTML = '<h3 style="color: #ef4444; text-align: center; margin-bottom: 20px; font-size: 24px;">' + commandConsoleMessages.comments.beforeAdjustment + '</h3>';
		const beforeDisplay = createComparisonTeamsDisplay(beforeTeams, afterTeams, colorMap);
		beforeSection.appendChild(beforeDisplay);

		// 화살표
		const arrow = document.createElement('div');
		arrow.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 48px;
			color: #22c55e;
		`;
		arrow.textContent = '→';

		// 후 (After)
		const afterSection = document.createElement('div');
		afterSection.innerHTML = '<h3 style="color: #22c55e; text-align: center; margin-bottom: 20px; font-size: 24px;">' + commandConsoleMessages.comments.afterAdjustment + '</h3>';
		const afterDisplay = createComparisonTeamsDisplay(afterTeams, beforeTeams, colorMap);
		afterSection.appendChild(afterDisplay);

		comparisonWrapper.appendChild(beforeSection);
		comparisonWrapper.appendChild(arrow);
		comparisonWrapper.appendChild(afterSection);
		comparisonContainer.appendChild(comparisonWrapper);

		// 닫기 버튼
		const closeBtn = document.createElement('button');
		closeBtn.textContent = commandConsoleMessages.comments.nextButton;
		closeBtn.style.cssText = `
			margin: 30px auto 0;
			padding: 15px 40px;
			background: #3b82f6;
			color: white;
			border: none;
			border-radius: 8px;
			font-size: 18px;
			font-weight: 600;
			cursor: pointer;
			transition: background 0.2s;
		`;
		closeBtn.onmouseover = () => closeBtn.style.background = '#2563eb';
		closeBtn.onmouseout = () => closeBtn.style.background = '#3b82f6';

		const closeComparison = () => {
			comparisonContainer.remove();
			resolve();
		};

		closeBtn.onclick = closeComparison;
		comparisonContainer.appendChild(closeBtn);

		document.body.appendChild(comparisonContainer);
	});
}

// 스페이스바 안내 메시지 표시
function showValidationHint() {
	if (!state.genderBalanceEnabled) return;

	const hint = document.createElement('div');
	hint.id = 'validationHint';
	hint.style.cssText = `
		position: fixed;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(59, 130, 246, 0.95);
		color: white;
		padding: 12px 24px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 500;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		z-index: 10000;
		animation: fadeInUp 0.3s ease-out;
	`;
	hint.textContent = commandConsoleMessages.comments.spacebarHint;

	document.body.appendChild(hint);

	// 5초 후 자동 제거
	setTimeout(() => {
		if (hint.parentNode) {
			hint.style.animation = 'fadeOut 0.3s ease-out';
			setTimeout(() => hint.remove(), 300);
		}
	}, 5000);
}

// 검증 및 재표시
async function validateAndRedisplayTeams() {
	if (!currentTeams || isValidated) return;

	// 검증 로직 실행
	const validatedTeams = validateAndFixGenderBlockBalance(currentTeams);

	// 검증된 팀으로 업데이트
	currentTeams = validatedTeams;
	isValidated = true;

	// 검증된 팀으로 바로 표시
	await displayTeams(validatedTeams);
}

// 변경사항 없음 메시지 (자동 검증 시에는 표시하지 않음)
function showNoChangesMessage() {
	// 자동 검증이므로 메시지 표시 없이 그냥 리턴
	isValidated = true;
}

// 전/후 비교 화면 표시
async function showBeforeAfterComparison(beforeTeams, afterTeams) {
	// 비교 컨테이너 생성
	const comparisonContainer = document.createElement('div');
	comparisonContainer.id = 'comparisonContainer';
	comparisonContainer.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.95);
		z-index: 10000;
		display: flex;
		flex-direction: column;
		padding: 40px;
		overflow-y: auto;
	`;

	// 헤더
	const header = document.createElement('div');
	header.style.cssText = `
		text-align: center;
		color: white;
		margin-bottom: 30px;
	`;

	const titleParts = [];
	if (state.weightBalanceEnabled) titleParts.push(commandConsoleMessages.comments.weightBalance);

	header.innerHTML = `
		<h2 style="font-size: 32px; margin-bottom: 10px;">${commandConsoleMessages.comments.validationResult}</h2>
		<p style="font-size: 16px; opacity: 0.8;">${titleParts.length ? titleParts.join(' 및 ') + commandConsoleMessages.comments.adjustedOptions : commandConsoleMessages.comments.teamsAdjusted}</p>
	`;
	comparisonContainer.appendChild(header);

	// 비교 영역
	const comparisonWrapper = document.createElement('div');
	comparisonWrapper.style.cssText = `
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 40px;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	`;

	// 색상 맵 미리 생성 (전/후 화면에서 공유)
	const colorMap = createColorMapForComparison(beforeTeams, afterTeams);

	// 전 (Before)
	const beforeSection = document.createElement('div');
	beforeSection.innerHTML = '<h3 style="color: #ef4444; text-align: center; margin-bottom: 20px; font-size: 24px;">' + commandConsoleMessages.comments.beforeAdjustment + '</h3>';
	const beforeDisplay = createComparisonTeamsDisplay(beforeTeams, afterTeams, colorMap);
	beforeSection.appendChild(beforeDisplay);

	// 화살표
	const arrow = document.createElement('div');
	arrow.style.cssText = `
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 48px;
		color: #22c55e;
	`;
	arrow.textContent = '→';

	// 후 (After)
	const afterSection = document.createElement('div');
	afterSection.innerHTML = '<h3 style="color: #22c55e; text-align: center; margin-bottom: 20px; font-size: 24px;">' + commandConsoleMessages.comments.afterAdjustment + '</h3>';
	const afterDisplay = createComparisonTeamsDisplay(afterTeams, beforeTeams, colorMap);
	afterSection.appendChild(afterDisplay);

	comparisonWrapper.appendChild(beforeSection);
	comparisonWrapper.appendChild(arrow);
	comparisonWrapper.appendChild(afterSection);
	comparisonContainer.appendChild(comparisonWrapper);

	// 닫기 버튼
	const closeBtn = document.createElement('button');
	closeBtn.textContent = commandConsoleMessages.comments.confirmButton;
	closeBtn.style.cssText = `
		margin: 30px auto 0;
		padding: 15px 40px;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 18px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	`;
	closeBtn.onmouseover = () => closeBtn.style.background = '#2563eb';
	closeBtn.onmouseout = () => closeBtn.style.background = '#3b82f6';

	const closeComparison = () => {
		comparisonContainer.remove();
		// 검증된 팀으로 재표시
		displayTeams(afterTeams);
	};

	closeBtn.onclick = closeComparison;
	comparisonContainer.appendChild(closeBtn);

	document.body.appendChild(comparisonContainer);
}

// 색상 맵 생성 함수 (전/후 화면에서 공유)
function createColorMapForComparison(beforeTeams, afterTeams) {
	const changedMemberColors = new Map();

	const beforeMembers = beforeTeams.map(team => new Set(team.map(p => p.id)));
	const afterMembers = afterTeams.map(team => new Set(team.map(p => p.id)));

	// 변경된 모든 멤버 수집 (ID 순으로 정렬하여 일관성 유지)
	const changedMembersSet = new Set();

	afterTeams.forEach((team, teamIdx) => {
		team.forEach(person => {
			if (!beforeMembers[teamIdx].has(person.id)) {
				changedMembersSet.add(person.id);
			}
		});
	});

	// ID로 정렬하여 일관된 색상 할당
	const changedMembers = Array.from(changedMembersSet).sort((a, b) => a - b);

	// 각 변경된 멤버에게 groupColors에서 색상 할당 (파스텔 톤으로 투명도 추가)
	changedMembers.forEach((personId, index) => {
		const colorIndex = index % state.groupColors.length;
		const baseColor = state.groupColors[colorIndex];
		// 핵사코드에 투명도 추가 (40 = 약 25% 불투명도로 파스텔 톤)
		const pastelColor = baseColor + '40';
		changedMemberColors.set(personId, pastelColor);
	});

	return changedMemberColors;
}

// 비교용 팀 표시 생성
function createComparisonTeamsDisplay(teams, compareTeams = null, changedMemberColors = null) {
	const container = document.createElement('div');
	container.style.cssText = `
		display: flex;
		flex-direction: column;
		gap: 15px;
	`;

	// 비교를 위한 팀 멤버 맵 생성
	let compareTeamMembers = null;
	if (compareTeams) {
		compareTeamMembers = compareTeams.map(team =>
			new Set(team.map(p => p.id))
		);
	}

	teams.forEach((team, index) => {
		const teamCard = document.createElement('div');
		teamCard.style.cssText = `
			background: white;
			border-radius: 12px;
			padding: 20px;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		`;

		// 팀 헤더
		const teamHeader = document.createElement('h4');
		teamHeader.style.cssText = `
			margin: 0 0 15px 0;
			font-size: 20px;
			color: #1e293b;
		`;

		let headerText = `팀 ${index + 1} (${team.length}명`;
		if (state.weightBalanceEnabled) {
			const totalWeight = team.reduce((sum, p) => sum + (p.weight || 0), 0);
			headerText += `/${totalWeight}`;
		}
		headerText += ')';

		teamHeader.textContent = headerText;
		teamCard.appendChild(teamHeader);

		// 멤버 리스트
		const membersList = document.createElement('ul');
		membersList.style.cssText = `
			list-style: none;
			padding: 0;
			margin: 0;
			display: flex;
			flex-direction: column;
			gap: 8px;
		`;

		team.forEach(person => {
			const li = document.createElement('li');

			// 비교 대상이 있을 때 변경된 멤버 확인
			let isChanged = false;
			let highlightColor = null;
			if (compareTeamMembers) {
				// 현재 팀에 있지만 같은 위치의 비교 팀에 없으면 변경된 것
				const compareTeamSet = compareTeamMembers[index];
				if (compareTeamSet && !compareTeamSet.has(person.id)) {
					isChanged = true;
					highlightColor = changedMemberColors.get(person.id);
				}
			}

			li.style.cssText = `
				padding: 8px 12px;
				background: ${isChanged && highlightColor ? highlightColor : '#f8fafc'};
				border-radius: 6px;
				font-size: 14px;
				${isChanged ? 'font-weight: 600;' : ''}
			`;

			let displayText = person.name;
			if (state.weightBalanceEnabled) displayText += ` (${person.weight ?? 0})`;

			if (state.genderBalanceEnabled) {
				const genderColor = person.gender === 'male' ? '#3b82f6' : '#ec4899';
				li.style.borderLeft = `4px solid ${genderColor}`;
			}

			const groupIndex = getPersonGroupIndex(person.id);
			if (groupIndex !== -1) {
				displayText = '● ' + displayText;
			}

			li.textContent = displayText;
			membersList.appendChild(li);
		});

		teamCard.appendChild(membersList);
		container.appendChild(teamCard);
	});

	return container;
}

// 성별 블록 균형 검증 및 수정
function validateAndFixGenderBlockBalance(teams) {
	if (!state.genderBalanceEnabled) return teams;

	// 소수 성별 파악
	const allPeople = teams.flat();
	const maleCount = allPeople.filter(p => p.gender === 'male').length;
	const femaleCount = allPeople.filter(p => p.gender === 'female').length;

	if (maleCount === femaleCount || maleCount === 0 || femaleCount === 0) {
		return teams; // 성비가 동일하거나 한쪽만 있으면 검증 불필요
	}

	const minorityGender = femaleCount < maleCount ? 'female' : 'male';

	// 최대 10번 반복 (무한루프 방지)
	let iterations = 0;
	const maxIterations = 10;
	let modified = true;

	while (modified && iterations < maxIterations) {
		modified = false;
		iterations++;

		// 각 팀의 소수성별 블록 수 계산
		const teamBlockCounts = teams.map((team, idx) => ({
			teamIdx: idx,
			blocks: getTeamGenderBlockInfo(team, minorityGender).totalBlocks
		}));

		// 최대/최소 블록 팀 찾기
		const maxBlockTeam = teamBlockCounts.reduce((max, curr) =>
			curr.blocks > max.blocks ? curr : max
		);
		const minBlockTeam = teamBlockCounts.reduce((min, curr) =>
			curr.blocks < min.blocks ? curr : min
		);

		// 차이가 2 이상이면 교체
		if (maxBlockTeam.blocks - minBlockTeam.blocks >= 2) {
			const swapResult = swapToBalanceBlocks(
				teams,
				maxBlockTeam.teamIdx,
				minBlockTeam.teamIdx,
				minorityGender
			);

			if (swapResult) {
				modified = true;
			}
		}
	}

	return teams;
}

// 가중치 균형 검증 및 수정
function validateAndFixWeightBalance(teams) {
	if (!state.weightBalanceEnabled) return teams;

	// 최대 10번 반복 (무한루프 방지)
	let iterations = 0;
	const maxIterations = 10;
	let modified = true;

	while (modified && iterations < maxIterations) {
		modified = false;
		iterations++;

		// 각 팀의 총 가중치 계산
		const teamWeights = teams.map((team, idx) => ({
			teamIdx: idx,
			totalWeight: team.reduce((sum, p) => sum + (p.weight || 0), 0),
			team: team
		}));

		// 가중치 기준 정렬
		teamWeights.sort((a, b) => a.totalWeight - b.totalWeight);

		// 가장 낮은 팀과 가장 높은 팀
		const minWeightTeam = teamWeights[0];
		const maxWeightTeam = teamWeights[teamWeights.length - 1];

		// 가장 낮은 팀의 최고 점수 팀원
		const minTeamMaxPerson = minWeightTeam.team.reduce((max, p) =>
			(p.weight || 0) > (max.weight || 0) ? p : max
		);

		// 가장 높은 팀의 최저 점수 팀원
		const maxTeamMinPerson = maxWeightTeam.team.reduce((min, p) =>
			(p.weight || 0) < (min.weight || 0) ? p : min
		);

		// 조건 확인: 낮은 팀의 최고 점수 <= 높은 팀의 최저 점수
		if ((minTeamMaxPerson.weight || 0) <= (maxTeamMinPerson.weight || 0)) {
			// 교체 로직 실행
			const swapResult = swapToBalanceWeight(
				teams,
				teamWeights,
				minWeightTeam.teamIdx,
				maxWeightTeam.teamIdx
			);

			if (swapResult) {
				modified = true;
			} else {
				// 첫 번째 교체 실패 시, 두 번째로 높은 팀과 시도
				if (teamWeights.length > 2) {
					const secondMaxWeightTeam = teamWeights[teamWeights.length - 2];
					const swapResult2 = swapToBalanceWeight(
						teams,
						teamWeights,
						minWeightTeam.teamIdx,
						secondMaxWeightTeam.teamIdx
					);
					if (swapResult2) modified = true;
				}
			}
		}
	}

	return teams;
}

// 가중치 균형을 위한 팀원 교체
function swapToBalanceWeight(teams, teamWeights, minTeamIdx, maxTeamIdx) {
	const minTeam = teams[minTeamIdx];
	const maxTeam = teams[maxTeamIdx];

	// 전체 팀 중 최대 소수성별 블록 수 계산
	let maxMinorityBlocks = 0;
	let minorityGender = null;

	if (state.genderBalanceEnabled) {
		const allPeople = teams.flat();
		const maleCount = allPeople.filter(p => p.gender === 'male').length;
		const femaleCount = allPeople.filter(p => p.gender === 'female').length;

		if (maleCount !== femaleCount && maleCount !== 0 && femaleCount !== 0) {
			minorityGender = femaleCount < maleCount ? 'female' : 'male';

			// 모든 팀의 소수성별 블록 수 계산
			teams.forEach(team => {
				const blockInfo = getTeamGenderBlockInfo(team, minorityGender);
				if (blockInfo.totalBlocks > maxMinorityBlocks) {
					maxMinorityBlocks = blockInfo.totalBlocks;
				}
			});
		}
	}

	// 1. 낮은 팀의 최고 점수 팀원 찾기 (그룹이 아닌 개인만, 히든 그룹 제외)
	const minTeamIndividuals = minTeam.filter(person => {
		const groupIndex = getPersonGroupIndex(person.id);
		if (groupIndex !== -1) return false;
		// 히든 그룹 체크
		const hiddenCluster = getActiveHiddenGroupCluster(person.id);
		if (hiddenCluster.size > 1) return false;
		return true;
	});

	if (minTeamIndividuals.length === 0) {
		return false; // 교체할 개인이 없음
	}

	// 최고 점수 팀원
	const minTeamMaxPerson = minTeamIndividuals.reduce((max, p) =>
		(p.weight || 0) > (max.weight || 0) ? p : max
	);

	// 2. 높은 팀에서 최고 가중치 팀원 찾기 (그룹이 아닌 개인만, 히든 그룹 제외)
	const maxTeamIndividuals = maxTeam.filter(person => {
		const groupIndex = getPersonGroupIndex(person.id);
		if (groupIndex !== -1) return false;
		// 히든 그룹 체크
		const hiddenCluster = getActiveHiddenGroupCluster(person.id);
		if (hiddenCluster.size > 1) return false;
		return true;
	});

	if (maxTeamIndividuals.length === 0) {
		return false; // 교체할 개인이 없음
	}

	// 후보들을 가중치 높은 순으로 정렬
	const candidates = maxTeamIndividuals.sort((a, b) => (b.weight || 0) - (a.weight || 0));

	// 각 후보에 대해 교체 가능성 검사
	for (const maxTeamTargetPerson of candidates) {
		// 분리 확인
		if (isForbidden(minTeamMaxPerson.id, maxTeamTargetPerson.id)) {
			continue;
		}

		// 점수가 동일한지 확인
		if ((minTeamMaxPerson.weight || 0) === (maxTeamTargetPerson.weight || 0)) {
			continue; // 동일하면 교체 불필요
		}

		// 성비 균등이 활성화된 경우, 교체 후 블록 수 검증
		if (minorityGender && state.genderBalanceEnabled) {
			// 교체 후 시뮬레이션
			const minTeamAfter = minTeam.map(p =>
				p.id === minTeamMaxPerson.id ? maxTeamTargetPerson : p
			);
			const maxTeamAfter = maxTeam.map(p =>
				p.id === maxTeamTargetPerson.id ? minTeamMaxPerson : p
			);

			// 교체 후 양 팀의 소수성별 블록 수 계산
			const minTeamBlocksAfter = getTeamGenderBlockInfo(minTeamAfter, minorityGender).totalBlocks;
			const maxTeamBlocksAfter = getTeamGenderBlockInfo(maxTeamAfter, minorityGender).totalBlocks;

			// 양 팀 모두 최대 블록 수를 넘지 않으면 교체 가능
			if (minTeamBlocksAfter > maxMinorityBlocks || maxTeamBlocksAfter > maxMinorityBlocks) {
				continue; // 블록 수가 초과되면 다음 후보로
			}
		}

		// 교체 실행
		const minPersonIdx = minTeam.indexOf(minTeamMaxPerson);
		const maxPersonIdx = maxTeam.indexOf(maxTeamTargetPerson);

		if (minPersonIdx !== -1 && maxPersonIdx !== -1) {
			// 배열에서 교체
			[teams[minTeamIdx][minPersonIdx], teams[maxTeamIdx][maxPersonIdx]] =
			[teams[maxTeamIdx][maxPersonIdx], teams[minTeamIdx][minPersonIdx]];

			return true;
		}
	}

	return false;
}

// 팀 인원 균형 검증 및 수정 (최대인원 모드가 아닐 때)
function validateAndFixTeamSizeBalance(teams) {
	if (state.maxTeamSizeEnabled) return teams;

	// 최대 10번 반복 (무한루프 방지)
	let iterations = 0;
	const maxIterations = 10;
	let modified = true;

	while (modified && iterations < maxIterations) {
		modified = false;
		iterations++;

		// 각 팀의 인원 수 계산
		const teamSizes = teams.map((team, idx) => ({
			teamIdx: idx,
			size: team.length
		}));

		// 최대/최소 인원 팀 찾기
		const maxSizeTeam = teamSizes.reduce((max, curr) =>
			curr.size > max.size ? curr : max
		);
		const minSizeTeam = teamSizes.reduce((min, curr) =>
			curr.size < min.size ? curr : min
		);

		// 차이가 2명 이상이면 조정
		if (maxSizeTeam.size - minSizeTeam.size >= 2) {
			// 받는 팀이 이미 최고 가중치 팀인지 확인
			let isMinTeamMaxWeight = false;
			if (state.weightBalanceEnabled) {
				const allWeights = teams.map(team =>
					team.reduce((sum, p) => sum + (p.weight || 0), 0)
				);
				const maxWeight = Math.max(...allWeights);
				const minTeamWeight = teams[minSizeTeam.teamIdx].reduce((sum, p) => sum + (p.weight || 0), 0);
				isMinTeamMaxWeight = (minTeamWeight === maxWeight);
			}

			let bestCandidate = null;
			let bestSourceTeamIdx = -1;

			if (isMinTeamMaxWeight) {
				// 받는 팀이 이미 최고 가중치 팀 -> 가장 점수가 낮은 개인을 찾되, 성비 블록만 체크
				let lowestWeight = Infinity;

				for (let sourceTeamIdx = 0; sourceTeamIdx < teams.length; sourceTeamIdx++) {
					const sourceTeam = teams[sourceTeamIdx];

					// 최소 인원 팀이거나 인원이 2명 이하면 스킵
					if (sourceTeamIdx === minSizeTeam.teamIdx || sourceTeam.length <= 2) {
						continue;
					}

					// 이 팀의 개인 멤버들 (그룹이 아닌, 히든 그룹 제외)
					const individuals = sourceTeam.filter(person => {
						const groupIndex = getPersonGroupIndex(person.id);
						if (groupIndex !== -1) return false;
						// 히든 그룹 체크
						const hiddenCluster = getActiveHiddenGroupCluster(person.id);
						if (hiddenCluster.size > 1) return false;
						return true;
					});

					// 각 후보에 대해 검증
					for (const candidate of individuals) {
						const candidateWeight = candidate.weight || 0;

						// 분리 확인
						let hasConstraint = false;
						for (const teamMember of teams[minSizeTeam.teamIdx]) {
							if (isForbidden(candidate.id, teamMember.id)) {
								hasConstraint = true;
								break;
							}
						}
						if (hasConstraint) continue;

						// 성비 블록만 체크
						if (canMoveMemberToTeamGenderOnly(teams, candidate, sourceTeamIdx, minSizeTeam.teamIdx)) {
							if (candidateWeight < lowestWeight) {
								lowestWeight = candidateWeight;
								bestCandidate = candidate;
								bestSourceTeamIdx = sourceTeamIdx;
							}
						}
					}
				}
			} else {
				// 받는 팀이 최고 가중치 팀이 아님 -> 기존 로직 (전체 조건 체크)
				for (let sourceTeamIdx = 0; sourceTeamIdx < teams.length; sourceTeamIdx++) {
					const sourceTeam = teams[sourceTeamIdx];

					// 최소 인원 팀이거나 인원이 2명 이하면 스킵
					if (sourceTeamIdx === minSizeTeam.teamIdx || sourceTeam.length <= 2) {
						continue;
					}

					// 이 팀의 개인 멤버들 (그룹이 아닌, 히든 그룹 제외)
					const individuals = sourceTeam.filter(person => {
						const groupIndex = getPersonGroupIndex(person.id);
						if (groupIndex !== -1) return false;
						// 히든 그룹 체크
						const hiddenCluster = getActiveHiddenGroupCluster(person.id);
						if (hiddenCluster.size > 1) return false;
						return true;
					});

					// 각 후보에 대해 검증
					for (const candidate of individuals) {
						if (canMoveMemberToTeam(teams, candidate, sourceTeamIdx, minSizeTeam.teamIdx)) {
							bestCandidate = candidate;
							bestSourceTeamIdx = sourceTeamIdx;
							break;
						}
					}

					if (bestCandidate) break;
				}
			}

			// 적합한 후보를 찾았으면 이동
			if (bestCandidate && bestSourceTeamIdx !== -1) {
				const candidateIdx = teams[bestSourceTeamIdx].indexOf(bestCandidate);
				if (candidateIdx !== -1) {
					// 멤버를 다른 팀으로 이동
					const member = teams[bestSourceTeamIdx].splice(candidateIdx, 1)[0];
					teams[minSizeTeam.teamIdx].push(member);
					modified = true;
				}
			}
		}
	}

	return teams;
}

// 멤버를 다른 팀으로 이동 가능한지 검증 (성비만)
function canMoveMemberToTeamGenderOnly(teams, member, fromTeamIdx, toTeamIdx) {
	const toTeam = teams[toTeamIdx];

	// 성비 균형 확인만
	if (state.genderBalanceEnabled) {
		const allPeople = teams.flat();
		const maleCount = allPeople.filter(p => p.gender === 'male').length;
		const femaleCount = allPeople.filter(p => p.gender === 'female').length;

		if (maleCount !== femaleCount && maleCount !== 0 && femaleCount !== 0) {
			const minorityGender = femaleCount < maleCount ? 'female' : 'male';

			// 이동 후 시뮬레이션
			const simulatedToTeam = [...toTeam, member];

			// 이동 후 받는 팀의 블록 수
			const toTeamBlocksAfter = getTeamGenderBlockInfo(simulatedToTeam, minorityGender).totalBlocks;

			// 모든 팀의 현재 블록 수 계산
			const allBlockCounts = teams.map((team, idx) => {
				if (idx === toTeamIdx) {
					return toTeamBlocksAfter;
				}
				return getTeamGenderBlockInfo(team, minorityGender).totalBlocks;
			});

			const maxBlocks = Math.max(...allBlockCounts);
			const minBlocks = Math.min(...allBlockCounts);

			// 최대-최소 차이가 2 이상이면 안됨
			if (maxBlocks - minBlocks >= 2) {
				return false;
			}
		}
	}

	return true;
}

// 멤버를 다른 팀으로 이동 가능한지 검증
function canMoveMemberToTeam(teams, member, fromTeamIdx, toTeamIdx) {
	const toTeam = teams[toTeamIdx];

	// 1. 분리 조건 확인
	for (const teamMember of toTeam) {
		if (isForbidden(member.id, teamMember.id)) {
			return false;
		}
	}

	// 2. 성비 균형 확인
	if (state.genderBalanceEnabled) {
		const allPeople = teams.flat();
		const maleCount = allPeople.filter(p => p.gender === 'male').length;
		const femaleCount = allPeople.filter(p => p.gender === 'female').length;

		if (maleCount !== femaleCount && maleCount !== 0 && femaleCount !== 0) {
			const minorityGender = femaleCount < maleCount ? 'female' : 'male';

			// 이동 후 시뮬레이션
			const simulatedToTeam = [...toTeam, member];

			// 이동 후 받는 팀의 블록 수
			const toTeamBlocksAfter = getTeamGenderBlockInfo(simulatedToTeam, minorityGender).totalBlocks;

			// 모든 팀의 현재 블록 수 계산
			const allBlockCounts = teams.map((team, idx) => {
				if (idx === toTeamIdx) {
					return toTeamBlocksAfter;
				}
				return getTeamGenderBlockInfo(team, minorityGender).totalBlocks;
			});

			const maxBlocks = Math.max(...allBlockCounts);
			const minBlocks = Math.min(...allBlockCounts);

			// 최대-최소 차이가 2 이상이면 안됨
			if (maxBlocks - minBlocks >= 2) {
				return false;
			}
		}
	}

	// 3. 가중치 균형 확인
	if (state.weightBalanceEnabled) {
		// 이동 후 받는 팀의 총 가중치
		const toTeamWeightAfter = toTeam.reduce((sum, p) => sum + (p.weight || 0), 0) + (member.weight || 0);

		// 모든 팀의 가중치 계산 (이동 후 시뮬레이션)
		const allWeights = teams.map((team, idx) => {
			if (idx === toTeamIdx) {
				return toTeamWeightAfter;
			} else if (idx === fromTeamIdx) {
				// 출발 팀은 해당 멤버 제외
				return team.reduce((sum, p) => sum + (p.weight || 0), 0) - (member.weight || 0);
			}
			return team.reduce((sum, p) => sum + (p.weight || 0), 0);
		});

		const maxWeight = Math.max(...allWeights);

		// 받는 팀이 최고 가중치 팀이 되면 안됨
		if (toTeamWeightAfter >= maxWeight && toTeamIdx !== teams.findIndex(t =>
			t.reduce((sum, p) => sum + (p.weight || 0), 0) === maxWeight
		)) {
			return false;
		}
	}

	return true;
}

// 팀의 성별 블록 정보 계산
function getTeamGenderBlockInfo(team, targetGender = null) {
	// targetGender가 없으면 소수 성별 자동 파악
	if (!targetGender) {
		const maleCount = team.filter(p => p.gender === 'male').length;
		const femaleCount = team.filter(p => p.gender === 'female').length;
		if (maleCount === femaleCount) return { totalBlocks: 0, groupBlocks: 0, individualBlocks: 0 };
		targetGender = femaleCount < maleCount ? 'female' : 'male';
	}

	let groupBlocks = 0;
	let individualBlocks = 0;
	const processedGroups = new Set();

	team.forEach(person => {
		const groupIndex = getPersonGroupIndex(person.id);

		if (groupIndex !== -1) {
			// 그룹에 속한 경우
			if (!processedGroups.has(groupIndex)) {
				processedGroups.add(groupIndex);
				// 이 그룹에 targetGender가 있는지 확인
				const group = state.requiredGroups[groupIndex];
				const hasTargetGender = group.some(memberId => {
					const member = team.find(p => p.id === memberId);
					return member && member.gender === targetGender;
				});
				if (hasTargetGender) groupBlocks++;
			}
		} else {
			// 개인인 경우
			if (person.gender === targetGender) {
				individualBlocks++;
			}
		}
	});

	return {
		totalBlocks: groupBlocks + individualBlocks,
		groupBlocks,
		individualBlocks
	};
}

// 블록 균형을 위한 팀원 교체
function swapToBalanceBlocks(teams, maxTeamIdx, minTeamIdx, minorityGender) {
	const maxTeam = teams[maxTeamIdx];
	const minTeam = teams[minTeamIdx];

	// 1. 최대 블록 팀에서 소수성별 개인 찾기 (히든 그룹 제외)
	const maxTeamIndividuals = maxTeam.filter(person => {
		const groupIndex = getPersonGroupIndex(person.id);
		if (groupIndex !== -1) return false;
		if (person.gender !== minorityGender) return false;
		// 히든 그룹 체크
		const hiddenCluster = getActiveHiddenGroupCluster(person.id);
		if (hiddenCluster.size > 1) return false;
		return true;
	});

	if (maxTeamIndividuals.length === 0) {
		return false; // 교체할 개인이 없음
	}

	// 2. 최소 블록 팀에서 교체 대상 찾기
	let targetPerson = null;

	if (state.weightBalanceEnabled) {
		// 가중치가 가장 비슷한 사람 찾기
		let minWeightDiff = Infinity;

		maxTeamIndividuals.forEach(maxPerson => {
			minTeam.forEach(minPerson => {
				// 그룹이 아니고, 히든 그룹이 아니고, 분리이 없는 경우만
				const groupIndex = getPersonGroupIndex(minPerson.id);
				if (groupIndex !== -1) return;
				// 히든 그룹 체크
				const hiddenCluster = getActiveHiddenGroupCluster(minPerson.id);
				if (hiddenCluster.size > 1) return;
				if (isForbidden(maxPerson.id, minPerson.id)) return;

				const weightDiff = Math.abs((maxPerson.weight || 0) - (minPerson.weight || 0));
				if (weightDiff < minWeightDiff) {
					minWeightDiff = weightDiff;
					targetPerson = { from: maxPerson, to: minPerson };
				}
			});
		});
	} else {
		// 랜덤 선택
		const minTeamIndividuals = minTeam.filter(person => {
			const groupIndex = getPersonGroupIndex(person.id);
			if (groupIndex !== -1) return false;
			// 히든 그룹 체크
			const hiddenCluster = getActiveHiddenGroupCluster(person.id);
			if (hiddenCluster.size > 1) return false;
			return true;
		});

		if (minTeamIndividuals.length > 0) {
			const maxPerson = maxTeamIndividuals[Math.floor(Math.random() * maxTeamIndividuals.length)];
			const minPerson = minTeamIndividuals[Math.floor(Math.random() * minTeamIndividuals.length)];

			// 분리 확인
			if (!isForbidden(maxPerson.id, minPerson.id)) {
				targetPerson = { from: maxPerson, to: minPerson };
			}
		}
	}

	if (!targetPerson) {
		return false; // 교체 가능한 쌍이 없음
	}

	// 3. 교체 실행
	const maxPersonIdx = maxTeam.indexOf(targetPerson.from);
	const minPersonIdx = minTeam.indexOf(targetPerson.to);

	if (maxPersonIdx !== -1 && minPersonIdx !== -1) {
		// 배열에서 교체
		[teams[maxTeamIdx][maxPersonIdx], teams[minTeamIdx][minPersonIdx]] =
		[teams[minTeamIdx][minPersonIdx], teams[maxTeamIdx][maxPersonIdx]];

		return true;
	}

	return false;
}

// 전역 변수: 현재 표시된 팀과 검증 상태
let currentTeams = null;
let isValidated = false;

// ==================== 초기화 ====================

// 초기화 실행
init();
commandConsole.init();
