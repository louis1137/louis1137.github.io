// ==================== 명령어 콘솔 메시지 ====================

const commandConsoleMessages = {
	placeholders: {
		input: '명령어를 입력하세요... (예: help, save, load, clear)',
		profile: '프로필 이름 입력...',
		passwordInput: '비밀번호 입력...',
		passwordCreate: '비밀번호를 생성하세요...',
		passwordConfirm: '비밀번호 확인...',
		passwordChangeNew: '새 비밀번호 입력...',
		passwordChangeConfirm: '비밀번호 확인...',
		inputData: '참가자 입력 (취소: ESC)',
		participantData: '참가자 데이터 입력...',
		matchingRule: '확률 규칙 입력...',
		ruleInput: '확률 규칙 입력 (취소: ESC)...',
		reservation: '예약 입력 (예: A,B,C,D)...'
	},

	comments: {
		// ==================== command-console.js 메시지 ====================

		// --- 공통 메시지 ---
		cancel: '❌ 취소되었습니다.',
		help: '💡 명령어 목록을 보려면 <code data-cmd="도움">도움</code> 또는 <code data-cmd="help">help</code> 명령어를 입력하세요.',
		unknownCommand: '알 수 없는 명령어: <code data-cmd="도움">도움</code> 또는 <code data-cmd="help">help</code>를 입력하여 도움말을 확인하세요.',
		consoleReady: '콘솔이 준비되었습니다.',
		helpMessage : '=== 📋 명령어 도움말 ===<br><br>' +
		'<div style="margin-bottom: 30px;">' +
		'<h3 style="color: #22c55e; margin: 15px 0 10px 0;">🔓 명령어</h3>' +
		'<table style="width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.05); border-radius: 8px; overflow: hidden;">' +
		'<thead><tr style="background: rgba(34, 197, 94, 0.1); border-bottom: 2px solid #22c55e;">' +
		'<th style="padding: 12px; text-align: left; width: 35%; color: #22c55e; font-weight: bold;">명령어</th>' +
		'<th style="padding: 12px; text-align: left; color: #22c55e; font-weight: bold;">설명</th>' +
		'</tr></thead>' +
		'<tbody style="font-size: 14px;">' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="load">load</code> / <code data-cmd="불러오기">불러오기</code></td><td style="padding: 10px;">서버에 저장된 데이터를 불러옵니다. 최신 저장 상태로 복원되며, 화면이 자동으로 업데이트됩니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="status">status</code> / <code data-cmd="상태">상태</code></td><td style="padding: 10px;">현재 Profile Key, Firebase 연결 상태, 참가자 수, 미참가자 수, 분리 조건 개수 등 현재 상태를 확인합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="login">login</code> / <code data-cmd="로그인">로그인</code></td><td style="padding: 10px;">읽기 전용 모드에서 쓰기 모드로 전환합니다. 비밀번호를 입력하여 인증하면 데이터 수정이 가능합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="logout">logout</code> / <code data-cmd="종료">종료</code></td><td style="padding: 10px;">쓰기 모드에서 읽기 전용 모드로 전환합니다. 데이터를 읽을 수만 있고 수정할 수 없습니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="profile">profile</code> / <code data-cmd="프로필">프로필</code></td><td style="padding: 10px;">다른 프로필로 전환합니다. 프로필 이름을 입력하면 해당 프로필의 데이터를 불러옵니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="password">password</code> / <code data-cmd="비밀번호">비밀번호</code></td><td style="padding: 10px;">현재 프로필의 비밀번호를 변경합니다. 현재 비밀번호 확인 후 새 비밀번호를 설정할 수 있습니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="member">member</code> / <code data-cmd="참가자">참가자</code></td><td style="padding: 10px;">현재 등록된 모든 참가자 목록을 확인합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="people">people</code> / <code data-cmd="미참가자">미참가자</code></td><td style="padding: 10px;">현재 등록된 모든 미참가자 목록을 확인합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="constraints">constraints</code> / <code data-cmd="분리">분리</code></td><td style="padding: 10px;">현재 설정된 분리 조건 목록을 확인합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="input">input</code> / <code data-cmd="입력">입력</code></td><td style="padding: 10px;">참가자 데이터를 직접 입력할 수 있는 모드로 들어갑니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="input 데이터">input 데이터</code> / <code data-cmd="입력 데이터">입력 데이터</code></td><td style="padding: 10px;">참가자 데이터를 직접 입력합니다. 예: <code data-cmd="입력 홍길동,김철수">입력 홍길동,김철수</code></td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="generate">generate</code> / <code data-cmd="생성">생성</code></td><td style="padding: 10px;">설정된 조건에 따라 랜덤 팀을 생성합니다.</td></tr>' +
		'<tr><td style="padding: 10px;"><code data-cmd="help">help</code> / <code data-cmd="도움">도움</code></td><td style="padding: 10px;">이 도움말을 표시합니다.</td></tr>' +
		'</tbody></table></div>',

		helpMessageAuth : '<div style="margin-bottom: 30px;">' +
		'<h3 style="color: #f59e0b; margin: 15px 0 10px 0;">🔐 인증 필요 명령어</h3>' +
		'<table style="width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.05); border-radius: 8px; overflow: hidden;">' +
		'<thead><tr style="background: rgba(245, 158, 11, 0.1); border-bottom: 2px solid #f59e0b;">' +
		'<th style="padding: 12px; text-align: left; width: 35%; color: #f59e0b; font-weight: bold;">명령어</th>' +
		'<th style="padding: 12px; text-align: left; color: #f59e0b; font-weight: bold;">설명</th>' +
		'</tr></thead>' +
		'<tbody style="font-size: 14px;">' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="save">save</code> / <code data-cmd="저장">저장</code></td><td style="padding: 10px;">현재 참가자, 미참가자, 분리 조건, 설정 등 모든 상태를 서버에 저장합니다. 동일한 Profile Key로 접속한 다른 사용자들과 실시간으로 공유됩니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync">sync</code> / <code data-cmd="동기화">동기화</code></td><td style="padding: 10px;">서버의 최신 데이터를 불러와 현재 화면과 동기화합니다. 다른 사용자가 변경한 내용을 즉시 반영합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync rule">sync rule</code> / <code data-cmd="동기화 규칙">동기화 규칙</code></td><td style="padding: 10px;">확률 규칙만 서버에 저장하고 동기화합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync option">sync option</code> / <code data-cmd="동기화 옵션">동기화 옵션</code></td><td style="padding: 10px;">팀 생성 옵션만 서버에 저장하고 동기화합니다. (최대인원, 성별균형, 가중치균형, 팀 인원수)</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync member">sync member</code> / <code data-cmd="동기화 참가자">동기화 참가자</code></td><td style="padding: 10px;">참가자 목록만 서버에 저장하고 동기화합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync people">sync people</code> / <code data-cmd="동기화 미참가자">동기화 미참가자</code></td><td style="padding: 10px;">미참가자 목록만 서버에 저장하고 동기화합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync constraint">sync constraint</code> / <code data-cmd="동기화 분리">동기화 분리</code></td><td style="padding: 10px;">분리 조건만 서버에 저장하고 동기화합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="sync reservation">sync reservation</code> / <code data-cmd="동기화 예약">동기화 예약</code></td><td style="padding: 10px;">예약 목록만 서버에 저장하고 동기화합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="clear">clear</code> / <code data-cmd="초기화">초기화</code></td><td style="padding: 10px;">참가자, 미참가자, 분리, 확률 그룹, 옵션 설정을 모두 초기화합니다. ⚠️ 비밀번호와 프로필은 유지되며, 초기화된 데이터는 복구할 수 없습니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="delete">delete</code> / <code data-cmd="삭제">삭제</code></td><td style="padding: 10px;">현재 프로필을 완전히 삭제합니다. ⚠️ 비밀번호 확인과 프로필 이름 확인 후 삭제되며 복구할 수 없습니다. 삭제 후 프로필 선택 화면으로 이동합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="확률">확률</code></td><td style="padding: 10px;">확률 그룹 및 설정된 확률 규칙을 확인합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="규칙">규칙</code> / <code data-cmd="rule">rule</code></td><td style="padding: 10px;">확률 규칙을 등록할 수 있는 모드로 들어갑니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="규칙 명령어">규칙 명령어</code> / <code data-cmd="rule 명령어">rule 명령어</code></td><td style="padding: 10px;">확률 규칙을 등록하거나 수정합니다. 예: <code data-cmd="규칙 A(40)B(30)C">규칙 A(40)B(30)C</code></td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="예약">예약</code> / <code data-cmd="reservation">reservation</code></td><td style="padding: 10px;">예약 모드로 진입하여 팀 구성을 예약할 수 있습니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="예약 A,B,C">예약 A,B,C</code></td><td style="padding: 10px;">A,B,C를 다음 팀 생성 시 하나의 팀으로 예약합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="예약 목록">예약 목록</code></td><td style="padding: 10px;">현재 등록된 예약 목록을 확인합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="예약 취소">예약 취소</code></td><td style="padding: 10px;">마지막에 등록한 예약을 취소합니다.</td></tr>' +
		'<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><td style="padding: 10px;"><code data-cmd="예약 우선 A,B,C">예약 우선 A,B,C</code></td><td style="padding: 10px;">A,B,C를 다음 예약보다 우선하여 예약 스택 맨 앞에 추가합니다.</td></tr>' +
		'<tr><td style="padding: 10px;"><code data-cmd="예약 초기화">예약 초기화</code></td><td style="padding: 10px;">모든 예약을 제거합니다.</td></tr>' +
		'</tbody></table></div>',

		// --- 비밀번호 관련 ---
		passwordCreate: '비밀번호를 생성하시겠습니까?',
		passwordCreatePrompt: '비밀번호를 생성하세요:',
		passwordInput: '🔒 비밀번호를 입력하세요:',
		passwordInputAsk: '🔒 비밀번호를 입력하시겠습니까?',
		passwordAskInitial: '🔒 비밀번호를 입력하시겠습니까?',
		passwordInputConfirm: '비밀번호를 다시 한번 입력해주세요:',
		passwordConfirmPrompt: '비밀번호를 입력하여 확인하세요:',
		passwordCurrent: '현재 비밀번호를 입력하세요:',
		passwordChangeNew: '새 비밀번호를 입력하세요:',
		passwordChangeConfirm: '새 비밀번호를 다시 한번 입력해주세요:',
		passwordChangeInteractive: '⚠️ 보안을 위해 비밀번호 변경은 대화형 모드로만 가능합니다.',
		passwordChangeCanceled: '비밀번호 삭제가 취소되었습니다.<br>새 비밀번호를 입력하세요:',
		passwordInputSkipped: '비밀번호 입력을 건너뛰었습니다.<br>읽기 전용 모드로 프로필을 사용합니다.',
		passwordSkipSuccess: '비밀번호 설정을 건너뛰었습니다.<br>프로필이 생성되었습니다.<br>콘솔이 준비되었습니다.',
		passwordSet: '비밀번호가 설정되었습니다',
		passwordConfirmed: '현재 비밀번호가 확인되었습니다.',
		passwordChanged: '🔑 비밀번호가 변경되었습니다.',
		passwordMismatch: '비밀번호가 일치하지 않습니다',
		passwordDeleted: '🗑️ 비밀번호가 삭제되었습니다.<br>콘솔이 준비되었습니다.',
		passwordDeleteConfirm: '⚠️ 비밀번호를 삭제하시겠습니까?',
		passwordDeleteFailed: '비밀번호 삭제 실패: {error}',

		// --- 프로필 관련 ---
		profileInput: '프로필 이름을 입력하세요:',
		profileSwitch: '🔄 프로필 이름을 입력하세요:',
		profileKeepCurrent: '현재 프로필을 유지합니다',
		profileSwitchSuccess: '프로필로 전환 성공!',
		profileSwitchCanceled: '프로필 전환이 취소되었습니다.',
		profileCreateCanceled: '프로필 생성이 취소되었습니다.',
		profileCreated: '프로필이 생성되었습니다',
		profileCreateFailed: '프로필 생성 실패',
		profileCreateNew: '\'{profile}\'을 새로운 프로필로 등록하시겠습니까?',
		profileNotFound: '는 존재하지 않는 프로필입니다.',	profileNotFoundSwitch: '⚠️ \'{profile}\'는 존재하지 않는 프로필입니다.',
		profileNotFoundInitial: '⚠️ \'{profile}\'는 존재하지 않는 프로필입니다.',
		profileCheckFailed: '프로필 확인 실패: {error}',
		profileNameLength: '프로필 이름은 1~20자여야 합니다',
		profileNameExists: '이미 존재하는 프로필 이름입니다',
		profileConnected: '📡 프로필 \'{profile}\' 연결됨',	profileConnectedAuth: '📡 프로필 \'{profile}\' 연결됨 (인증 완료)',		profileConnectedReadOnly: '📡 프로필 \'{profile}\' 연결됨 (읽기 전용 모드)',
		profileLoaded: '📡 프로필 \'{profile}\' 로드됨 (참가자: {count}명)',
		profileLoadedInitial: '📡 프로필 \'{profile}\' 로드됨 (초기 상태)',
		profileFoundMessage: '프로필 \'{profile}\'를 발견했습니다.',

		// --- 프로필 삭제 관련 ---
		deleteConfirm: '삭제하려면 프로필 이름을 정확히 입력하세요:',
		deleteCanceled: '삭제가 취소되었습니다.',
		deleteConfirmQuestion: '삭제하시겠습니까?',
		deleteRedirect: '잠시 후 프로필 선택 화면으로 이동합니다...',
		deleteWarning: '⚠️ 이 작업은 되돌릴 수 없습니다!',
		profileDeleted: '프로필이 삭제되었습니다',
		profileDeleteSuccess: '프로필이 완전히 삭제되었습니다.',
		profileDeleteConfirmFinal: '🔑 비밀번호가 확인되었습니다.',
		profileDeleteQuestion: '정말로 프로필을 삭제하시겠습니까?',
		profileDeleteNameMismatch: '프로필 이름이 일치하지 않습니다. 삭제가 취소되었습니다.',
		profileDeleteAttempt: '프로필을 삭제하려고 합니다.',
		profileDeleteAttemptMessage: '🔥 프로필 \'{profile}\'를 삭제하려고 합니다.',
		deleteReadOnlyError: '🚫 프로필 삭제는 읽기 전용 모드에서 사용할 수 없습니다.',

		// --- 로그인/인증 관련 ---
		loginRequired: '인증하려면 <code data-cmd="로그인">로그인</code> 또는 <code data-cmd="login">login</code> 명령어를 사용하세요.',
		loginSuccess: '✅ 이미 로그인되어 있습니다.',
		loginInstructions: '💡 다시 로그인하려면 <code data-cmd="login">login</code> 또는 <code data-cmd="로그인">로그인</code> 명령어를 사용하세요.',
		logoutSuccess: '✅ 읽기 전용 모드로 전환되었습니다.',
		logoutInfo: '💡 다시 로그인하려면 <code data-cmd="login">login</code> 또는 <code data-cmd="로그인">로그인</code> 명령어를 사용하세요.',
		authSuccess: '✅ 인증 성공!<br>콘솔이 준비되었습니다.',
		authFailed: '인증에 실패했습니다',
		authenticationRequired: '💡 먼저 <code data-cmd="login">login</code> 또는 <code data-cmd="로그인">로그인</code> 명령어로 인증하세요.',
		readonlyMode: 'ℹ️ 이미 읽기 전용 모드입니다.',
		readOnlyModeWarning: '⚠️ 읽기 전용 모드입니다',
		readOnlyModeInfo: '읽기 전용 모드로 전환됩니다.',
		readOnlyFeatureDisabled: '🚫 이 기능은 읽기 전용 모드에서 사용할 수 없습니다',
		readOnlyModeSwitch: '🔓 읽기 전용 모드로 전환되었습니다.',
		writeLoginRequired: '💡 쓰기 권한이 필요하면 <code data-cmd="login">login</code> 또는 <code data-cmd="로그인">로그인</code> 명령어를 사용하세요.',

		// --- Firebase/저장/동기화 관련 ---
		firebaseMissing: '⚠️ Firebase가 설정되지 않았거나 Profile Key가 없습니다.',
		firebaseInitFailed: 'Firebase 초기화에 실패했습니다',
		saving: '💾 저장 중...',
		saveComplete: '💾 저장 완료!',
		syncing: '🔄 동기화 요청중...',
		syncComplete: '✅ 동기화 요청완료',
		syncFailed: '동기화에 실패했습니다',
		syncActivated: '🔄 실시간 동기화 활성화됨',
		syncRuleComplete: '✅ 규칙 동기화 완료',
		syncOptionComplete: '✅ 옵션 동기화 완료',
		syncMemberComplete: '✅ 참가자 동기화 완료',
		syncPeopleComplete: '✅ 미참가자 동기화 완료',
		syncConstraintComplete: '✅ 분리 동기화 완료',
		syncReservationComplete: '✅ 예약 동기화 완료',
		loadComplete: '📥 데이터 로드 완료! (확인하기: <code data-cmd="상태">상태</code>)',
		dataLoadFailed: '데이터 로드 실패: ',
		noSavedData: '저장된 데이터가 없습니다',
		localDataRestored: '✅ 로컬 데이터 복원: 참가자 {count}명',
		localStorageRestoreFailed: '❌ localStorage 복원 실패: ',

		// --- 초기화/리셋 관련 ---
		clearComplete: '🗑️ 데이터 초기화 완료 (비밀번호 유지)',
		clearConfirmMessage: '⚠️ 참가자, 미참가자, 분리, 확률 그룹, 옵션 설정을 모두 초기화하시겠습니까?\n(비밀번호와 프로필은 유지됩니다)',
		resetAllConfirm: '모든 데이터를 초기화하시겠습니까?',
		completeResetConfirm: '⚠️ 완전 초기화를 실행합니다!\n\n참가자와 미참가자를 포함한 모든 데이터가 완전히 삭제됩니다.',
		resetComplete: '완전 초기화: 참가자 및 미참가자 모두 삭제되었습니다.',
		resetConstraintsConverted: '초기화: 기존 분리 {count}개가 보류 분리으로 변환되어 유지됩니다.',
		constraintsCleared: '분리 목록이 모두 초기화되었습니다.',
		resetAllConstraintsConfirm: '모든 분리을 초기화하시겠습니까?',
		resetButton: '초기화',
		resetFailed: '초기화 실패:',

		// --- 참가자 관련 ---
		noParticipants: '등록된 참가자가 없습니다',
		noInactiveParticipants: '미참가자가 없습니다',
		inputDataPrompt: '참가자 데이터를 입력하세요:<br>예시: 홍길동,김철수 / 이영희(남)50 / A!B / C(80)D',
		participantsCopiedToClipboard: '참가자 데이터가 클립보드에 복사되었습니다:',
		participantAddComplete: '참가자 추가 처리 완료:',
		participantAddDisabled: '참가자 추가 기능을 사용할 수 없습니다.',
		removeDuplicateSingle: '기존 참가자를 제거하고 새로 등록하시겠습니까?',
		removeDuplicateMultiple: '기존 참가자들을 제거하고 새로 등록하시겠습니까?',
		completePersonDeleteConfirm: '⚠️ 이 참가자를 완전히 삭제하시겠습니까?',
		nameRequired: '이름을 입력해주세요.',
		addParticipant: '참가자를 추가해주세요.',
		minOneName: '최소 1명 이상의 이름을 입력해주세요.',
		genderMale: '남',
		genderFemale: '여',

		// --- 분리 조건 관련 ---
		noConstraints: '설정된 분리 조건이 없습니다.',
		constraintManagement: '분리 관리',
		constraintConnection: '참가자 분리',
		constraintInputPlaceholder: '예: A!B 또는 해지: A!!B (쉼표로 여러 항목 가능)',
		appliedConstraints: '적용된 분리',
		pendingConstraints: '대기중인 분리',
		constraintAddFailed: '금지 분리 추가 실패:',
		constraintRemoveFailed: '분리 제거 실패: 동일인 분리은 불가능합니다.',
		constraintNotFound: '해당 분리을 찾을 수 없습니다.',
		samePersonConstraintError: '동일인에 대한 분리은 불가능합니다.',
		sameGroupConstraintError: '와 는 같은 그룹에 속해 있어 분리을 추가할 수 없습니다.',
		constraintInSameGroup: '같은 그룹에 금지 분리이 있습니다.',
		constraintPlacementImpossible: '분리 조건으로 팀 배치가 불가능합니다. 다시 시도해주세요.',
		userNotFoundForConstraint: '분리 대상 사용자를 찾을 수 없습니다:',

		// --- 확률/매칭 규칙 관련 ---
		noProbabilityRules: '설정된 확률 규칙이 없습니다.',
		probabilityRules: '확률 규칙 목록',
		probability: '확률',
		probabilityExample: '예) A(40)B(30)C(20)D',
		ruleSetup: '규칙 설정',
		ruleCheck: '확인하기 (명령어: <code data-cmd="확률">확률</code>)',
		ruleRemoveSuccess: '✅ 규칙 제거 완료',
		ruleAddSuccess: '✅ 규칙 추가 완료',
		ruleReadOnlyError: '🚫 확률 규칙 등록은 읽기 전용 모드에서 사용할 수 없습니다.',
		matchingSetup: '📊 확률 규칙을 설정합니다.',
		matchingFormat: '형식: <code>기준참가자(확률)매칭참가자1(확률)매칭참가자2...</code>',
		matchingGroupsHelp: '📊 설정된 매칭 그룹을 보려면 <code data-cmd="확률">확률</code> 명령어를 입력하세요.',
		memberA: '멤버 A',
		memberB: '멤버 B',
		chainRuleDeleteFailed: '⚠️ 규칙 삭제 실패: \'{name}\' 주최자의 규칙이 없습니다.',
		chainRuleDeleted: '✅ 규칙 삭제 완료: \'{name}\' 주최자의 모든 규칙이 삭제되었습니다.',
		chainCandidateDeleteFailed: '⚠️ 규칙 삭제 실패: 삭제할 후보를 찾을 수 없습니다.',
		chainAllCandidatesDeleted: '✅ 규칙 삭제 완료: \'{name}\' 주최자의 모든 후보가 삭제되어 규칙이 제거되었습니다.',
		chainCandidatesDeleted: '✅ 규칙 삭제 완료',
		chainCandidateProbabilityUpdated: '🔄 체인 후보 확률 갱신',
		chainCandidateAdded: '➕ 체인에 후보 추가',
		newChainCreated: '✅ 새 체인 생성',

		// --- 히든 그룹 관련 ---
		hiddenGroupAddFailed: '히든 그룹 추가 실패:',
		samePersonHiddenGroupError: '동일인에 대한 히든 그룹은 불가능합니다.',
		pendingHiddenGroupAdded: '⏳ 보류 히든 그룹 추가',
		pendingHiddenGroupUpdated: '🔄 보류 히든 그룹 확률 갱신',

		// --- 팝업/윈도우 관련 ---
		popupBlockedError: '팝업 차단: 참가자 분리 창을 열 수 없습니다. 브라우저의 팝업 차단을 확인하세요.',
		popupAccessError: '팝업에 접근할 수 없습니다 (크로스오리진 또는 차단됨):',
		popupOpenError: '팝업 열기 중 오류:',
		popupDocumentAccessError: '팝업 문서에 접근할 수 없습니다 (크로스오리진):',
		popupFunctionNotDefined: 'openForbiddenWindow 함수가 정의되지 않았습니다.',
		parentWindowNotFound: '부모 창 참조를 찾을 수 없습니다. 팝업을 닫고 다시 열어주세요.',
		additionFailed: '추가 실패',

		// --- 기타 UI 요소 ---
		showButton: '보기',
		showButtonWarning: ' 보기 버튼을 누르면 분리셋팅의 목록이 노출됩니다',
		noneText: '없음',
		nextButton: '다음',
		confirmButton: '확인',


		// ==================== script.js 메시지 ====================

		// --- 팀 생성/셔플 관련 ---
		teamGenerating: '🎲 팀 생성 중...',
		teamGenerationFailed: '팀 생성 실패: {error}',
		shuffleFunctionMissing: 'shuffleTeams 함수를 찾을 수 없습니다.',
		noTeamResults: '팀 생성 결과가 없습니다.',
		cannotFormTeams: '팀을 구성할 수 없습니다.',
		minTwoPerTeam: '팀 인원수는 최소 2명 이상이어야 합니다.',
		notEnoughParticipants: '참가자 수가 팀 인원수보다 적습니다.',
		delayAdjusted: '⚡ 지연 조정',

		// --- 팀 정보 표시 ---
		generatedTeams: '[생성된 팀]',
		teamFormat: '{number}팀: {members}',
		teamHeaderWithWeight: '{count}명 (가중치 {weight})',
		teamHeaderWithoutWeight: '{count}명',
		comparisonTeamHeaderWithWeight: '{number}팀 ({count}명, 가중치 {weight})',
		comparisonTeamHeaderWithoutWeight: '{number}팀 ({count}명)',
		memberWithGroup: '{name} (그룹 {groupIndex})',
		appliedRules: '[적용된 규칙]',
		appliedRuleFormat: '  - {primaryName} → {partnerName} (확률 {probability}%)',

		// --- 검증/밸런스 관련 ---
		teamSizeBalance: '팀 인원 균형',
		genderBlockBalance: '성비 블록 균형',
		weightBalance: '가중치 균형',
		validationStep: '검증 단계',
		validationStepName: '({stepName})',
		validationResult: '검증 결과',
		beforeAdjustment: '조정 전',
		afterAdjustment: '조정 후',
		adjustedOptions: '이 조정되었습니다',
		teamsAdjusted: '팀이 조정되었습니다',
		spacebarHint: '스페이스바를 눌러 성비 블록 균형을 검증하세요',

		// --- 화면 캡처/클립보드 관련 ---
		html2canvasNotFound: 'html2canvas 라이브러리를 찾을 수 없습니다.',
		captureAreaNotFound: '캡처 영역을 찾을 수 없습니다.',
		capturingInProgress: '캡처 중...',
		imageGenerationFailed: '이미지 생성에 실패했습니다.',
		captureFailed: '화면 캐처에 실패했습니다.',
		clipboardHttpsRequired: '클립보드 기능을 사용할 수 없습니다. HTTPS 환경이 필요합니다.',
		clipboardCopyFailed: '클립보드 복사 실패:',
		copyComplete: '복사 완료!',

		// --- 사운드 관련 ---
		soundPlaybackFailed: '사운드 재생 실패:',
		audioContextNotSupported: 'AudioContext not supported',

		// --- 예약 관련 ---
		reservationModeEnter: '📅 예약 모드로 진입했습니다. 참가자를 입력하세요 (예: A,B,C,D)',
		reservationAdded: '✅ 예약이 등록되었습니다: {members}',
		reservationAddFailed: '예약 등록 실패: {error}',
		reservationCanceled: '❌ 마지막 예약이 취소되었습니다: {members}',
		reservationCancelFailed: '취소할 예약이 없습니다.',
		reservationPriorityAdded: '⏫ 우선 예약이 등록되었습니다: {members}',
		reservationCleared: '🗑️ 모든 예약이 초기화되었습니다.',
		reservationList: '📋 예약 목록 ({count}개)',
		reservationListItem: '  {index}. {members}',
		reservationEmpty: '등록된 예약이 없습니다.',
		reservationConsumed: '✅ 예약 1개 소모됨: {members}',
		reservationConsumedPartial: '✅ 예약 1개 소모됨 (팀 인원수 {limit}명 제한): {members}<br>   ⚠️ 제외됨: {excluded}',
		reservationConsumedByOther: '📢 다른 창에서 예약이 소모되었습니다: {members}',
		reservationSyncNotification: '📢 예약 동기화: {action}',
		reservationInvalidFormat: '예약 형식이 올바르지 않습니다. 예: A,B,C,D',
		reservationApplied: '[적용된 예약]',
		reservationAppliedFormat: '  - {members}'
	}
};
