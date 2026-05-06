# 🔄 실시간 동기화 기능 사용 가이드

## 📋 개요

이 기능은 URL 파라미터 `?key=XXX`를 사용하여 여러 사용자가 같은 팀 데이터를 실시간으로 공유할 수 있게 합니다.

## 🚀 시작하기

### 1단계: Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com/) 접속
2. "프로젝트 추가" 클릭
3. 프로젝트 이름 입력 (예: team-maker)
4. Google Analytics 설정 (선택사항)
5. 프로젝트 생성 완료

### 2단계: Firebase Realtime Database 설정

1. 왼쪽 메뉴에서 "Realtime Database" 클릭
2. "데이터베이스 만들기" 클릭
3. 위치 선택 (asia-southeast1 추천)
4. **테스트 모드로 시작** 선택 (나중에 보안 규칙 설정 가능)
5. "사용 설정" 클릭

### 3단계: Firebase 설정 정보 가져오기

1. 프로젝트 설정(⚙️) > 프로젝트 설정 클릭
2. "내 앱" 섹션에서 웹 앱(</>) 추가
3. 앱 닉네임 입력
4. Firebase SDK 설정 정보 복사
5. `script.js` 파일의 `firebaseConfig` 부분에 붙여넣기

```javascript
const firebaseConfig = {
	apiKey: "여기에-복사한-API-KEY",
	authDomain: "your-project.firebaseapp.com",
	databaseURL: "https://your-project.firebaseio.com",
	projectId: "your-project",
	storageBucket: "your-project.appspot.com",
	messagingSenderId: "123456789",
	appId: "1:123456789:web:abcdef"
};
```

### 4단계: 보안 규칙 설정 (선택사항)

Firebase Console > Realtime Database > 규칙 탭에서:

```json
{
  "rules": {
    "profiles": {
      "$profileKey": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## 📖 사용 방법

### 기본 사용

1. **URL로 접속**
   ```
   index.html?key=myprofile
   ```
   - `key` 값은 원하는 문자열로 설정 가능
   - 같은 key를 사용하는 모든 사용자가 데이터를 공유

2. **명령어 콘솔**
   - 페이지 우측 하단에 명령어 콘솔이 자동으로 표시됨
   - Profile Key가 표시되어 현재 접속한 방 확인 가능

### 명령어

콘솔 입력창에 다음 명령어를 입력하세요:

#### `save`
현재 상태를 서버에 저장합니다. 같은 key로 접속한 모든 사용자가 이 상태로 동기화됩니다.

```
save
```

**결과:**
- 💾 저장 완료! (참가자: N명)
- 다른 사용자들의 화면이 즉시 업데이트됨

#### `load`
서버에서 저장된 데이터를 불러옵니다.

```
load
```

#### `clear`
서버에 저장된 데이터를 삭제합니다. (확인 메시지 표시)

```
clear
```

#### `status`
현재 상태 정보를 확인합니다.

```
status
```

**출력 예시:**
```
Profile Key: myprofile
Firebase: 활성화
참가자: 10명
미참가자: 5명
분리: 2개
```

#### `help`
사용 가능한 모든 명령어를 확인합니다.

```
help
```

## 🎯 활용 시나리오

### 시나리오 1: 실시간 팀 구성

1. **관리자:**
   - `index.html?key=class2024` 접속
   - 참가자 추가 및 팀 설정
   - 콘솔에서 `save` 입력

2. **참가자들:**
   - 같은 URL (`index.html?key=class2024`)로 접속
   - 관리자가 설정한 팀 구성이 자동으로 표시됨

### 시나리오 2: 여러 기기에서 작업

1. **PC에서 작업:**
   - 참가자 목록 작성
   - `save` 명령어로 저장

2. **태블릿/스마트폰에서 확인:**
   - 같은 key로 접속
   - `load` 명령어로 데이터 불러오기
   - 팀 생성 및 결과 공유

### 시나리오 3: 백업 및 복원

작업 중간에 주기적으로 `save`를 실행하여 데이터 백업.
실수로 초기화한 경우 `load`로 복원 가능.

## 🔐 보안 권장사항

### Key 이름 규칙

- **공개 사용:** `public-profile-2024`
- **비공개 사용:** `7a9f3c2e-5b1d-4e8a-9f2c-3d5e7a8b9c1f` (UUID 사용)
- **팀별 사용:** `team-alpha`, `team-beta`

### Firebase 보안 규칙 (프로덕션)

```json
{
  "rules": {
    "profiles": {
      "$profileKey": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

이 규칙은 인증된 사용자만 읽기/쓰기 가능하게 합니다.

## 🔧 문제 해결

### Firebase가 초기화되지 않음

**증상:**
```
⚠️ Firebase 설정이 필요합니다.
```

**해결:**
1. `script.js`의 `firebaseConfig` 확인
2. API 키가 올바른지 확인
3. Firebase 프로젝트가 활성화되어 있는지 확인

### 데이터가 동기화되지 않음

**확인사항:**
1. 모든 사용자가 같은 `key` 파라미터 사용하는지 확인
2. Firebase Console에서 실시간으로 데이터 변경 확인
3. 브라우저 콘솔(F12)에서 오류 확인
4. 네트워크 연결 확인

### 보안 규칙 오류

**증상:**
```
PERMISSION_DENIED: Permission denied
```

**해결:**
Firebase Console > Realtime Database > 규칙에서 읽기/쓰기 권한 확인

## 📝 추가 기능 아이디어

- [ ] 자동 저장 기능 (5분마다)
- [ ] 변경 이력 추적
- [ ] 사용자별 권한 관리
- [ ] 비밀번호 보호 기능
- [ ] 채팅 기능

## 💡 팁

- **Ctrl+Shift+J** (Windows) 또는 **Cmd+Option+J** (Mac)로 개발자 콘솔 열기
- 명령어 입력 시 **Enter** 키로 빠르게 실행
- 콘솔 헤더의 **−/+** 버튼으로 접기/펼치기
- `status` 명령어로 현재 상태 수시 확인

## 📞 지원

문제가 발생하면:
1. 브라우저 콘솔(F12) 확인
2. Firebase Console에서 데이터베이스 상태 확인
3. 네트워크 탭에서 Firebase 요청 확인

---

Made with ❤️ for seamless team collaboration
