// ==================== 명령어 콘솔 ====================

const commandConsole = {
	output: null,
	input: null,
	savedPosition: { x: 0, y: 0, width: '900px', height: '600px' }, // 최소화 전 위치와 크기 저장
	dragState: null, // 드래그 상태 저장
	inputMode: 'normal', // 입력 모드: 'normal', 'auth', 'profile', 'password', 'password-confirm', 'password-ask'
	tempProfile: '', // 임시 프로필 이름 저장
	tempPassword: '', // 임시 비밀번호 저장
	authenticated: false, // 인증 상태
	storedPassword: null, // Firebase에서 가져온 비밀번호
	firstTimeHelpShown: false, // 첫 번째 도움말 안내 표시 여부

	// 외부 파일에서 메시지 불러오기
	placeholders: commandConsoleMessages.placeholders,
	comments: commandConsoleMessages.comments,

	isUsersMode() {
		if (!currentProfileKey) return true;
		return (typeof getCurrentProfileSource === 'function' && getCurrentProfileSource() === 'users');
	},

	hasWriteAccess() {
		return this.authenticated || this.isUsersMode();
	},

	getUnifiedPassword() {
		if (typeof getGlobalAppPassword === 'function') {
			return getGlobalAppPassword();
		}
		if (!database || !currentProfileKey) {
			return Promise.resolve('');
		}
		return database.ref(`profiles/${currentProfileKey}/password`).once('value')
			.then((snapshot) => String(snapshot.val() || ''))
			.catch(() => '');
	},

	setUnifiedPassword(nextPassword) {
		const value = String(nextPassword ?? '');
		if (typeof setGlobalAppPassword === 'function') {
			return setGlobalAppPassword(value).then(() => value);
		}
		if (!database || !currentProfileKey) {
			return Promise.resolve(value);
		}
		return database.ref(`profiles/${currentProfileKey}/password`).set(value).then(() => value);
	},

	init() {
		this.output = document.getElementById('commandOutput');
		this.input = document.getElementById('commandInput');
		const sendBtn = document.getElementById('commandSendBtn');
		const toggleBtn = document.getElementById('toggleConsoleBtn');
		const consoleEl = document.getElementById('commandConsole');
		const profileKeyDisplay = document.getElementById('profileKeyDisplay');

		// 세션에서 로그인된 프로필 키 설정
		currentProfileKey = (typeof getSessionProfile === 'function') ? getSessionProfile() : null;
		if (currentProfileKey) {
			profileKeyDisplay.textContent = `🔑 ${currentProfileKey}`;
			profileKeyDisplay.classList.add('authenticated');

			// Firebase 초기화 시도
			if (initFirebase()) {
				syncEnabled = true;
				setupRealtimeSync();
			}
		}

		// 드래그 기능 추가 (dragState를 commandConsole에 저장)
		this.dragState = this.setupDragging(consoleEl);

		// 전역 ESC 키 이벤트 리스너 (비밀번호 모드 취소용)
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' || e.keyCode === 27) {
				// 비밀번호 입력 모드에서 ESC 키를 누르면 읽기 전용 모드로 전환
				if (this.inputMode === 'auth' || this.inputMode === 'auth-switch' ||
				    this.inputMode === 'password-change' || this.inputMode === 'delete-confirm' ||
				    this.inputMode === 'delete-password-confirm' || this.inputMode === 'password-delete-confirm' ||
				    this.inputMode === 'matching' || this.inputMode === 'input-data' ||
				    this.inputMode === 'profile-switch' || this.inputMode === 'reservation') {
					e.preventDefault();
					e.stopPropagation();
					this.log(this.comments.cancel);
					this.inputMode = 'normal';
					if (this.input) {
						this.input.type = 'text';
						this.input.value = '';
						this.input.placeholder = this.placeholders.input;
					}
					this.removeCancelButton();
					this.showFirstTimeHelp();
				}
			}
		});

		if (this.input) {
			this.input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.executeCommand();
				}
			});
		}

		if (sendBtn) {
			sendBtn.addEventListener('click', () => this.executeCommand());
		}

		// 콘솔 토글
		if (toggleBtn) {
			toggleBtn.addEventListener('click', () => {
				const content = document.querySelector('.command-content');
				const isHidden = content.style.display === 'none';

				if (isHidden) {
					// 펼치기: 저장된 위치와 크기 복원
					content.style.display = 'flex';
					consoleEl.style.width = this.savedPosition.width || '900px';
					consoleEl.style.height = this.savedPosition.height || '600px';
					consoleEl.style.transform = `translate(${this.savedPosition.x}px, ${this.savedPosition.y}px)`;
					this.dragState.xOffset = this.savedPosition.x;
					this.dragState.yOffset = this.savedPosition.y;
					toggleBtn.textContent = '_';
				} else {
					// 최소화: 현재 위치와 크기 저장 후 우측 하단으로 이동, 헤더만 표시
					this.savedPosition.x = this.dragState.xOffset;
					this.savedPosition.y = this.dragState.yOffset;
					this.savedPosition.width = consoleEl.style.width;
					this.savedPosition.height = consoleEl.style.height;
					content.style.display = 'none';
					consoleEl.style.width = '450px';
					consoleEl.style.height = 'auto';
					consoleEl.style.transform = 'translate(0, 0)';
					toggleBtn.textContent = '+';
				}
			});
		}

		// 콘솔 닫기
		const closeBtn = document.getElementById('closeConsoleBtn');
		if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				consoleEl.style.display = 'none';

				// 상태 초기화 (다시 열었을 때 프로필 입력부터 시작)
				if (!currentProfileKey) {
					// 파라미터가 없는 경우에만 초기화 (자동 프로필 프롬프트 비활성화)
					this.inputMode = 'normal';
					this.input.type = 'text';
					this.input.placeholder = this.placeholders.input;
					this.authenticated = false;
					this.storedPassword = null;
					this.tempProfile = '';
					this.tempPassword = '';

					// 출력 화면 클리어
					if (this.output) {
						this.output.innerHTML = '';
					}
				} else {
					// 프로필이 있는 경우
					// 비밀번호 입력 모드에서 닫으면 자동으로 읽기 모드로 전환
					if (this.inputMode === 'auth' || this.inputMode === 'auth-switch' ||
					    this.inputMode === 'password-change' || this.inputMode === 'delete-confirm' ||
					    this.inputMode === 'delete-password-confirm' || this.inputMode === 'password-delete-confirm' ||
					    this.inputMode === 'password-ask-initial' || this.inputMode === 'password-ask-switch' ||
					    this.inputMode === 'matching' || this.inputMode === 'input-data') {
						this.log(this.comments.cancel);
						this.inputMode = 'normal';

						// 확인 버튼이 표시되어 있다면 입력 필드로 복원
						this.restoreInputField();

						this.input.type = 'text';
						this.input.placeholder = this.placeholders.input;
					} else if (this.inputMode !== 'normal') {
						// 다른 특수 모드에서는 normal로 복귀
						this.inputMode = 'normal';
						this.input.type = 'text';
						this.input.placeholder = this.placeholders.input;
					}
				}
			});
		}

		// 리사이즈 기능 추가
		this.setupResizing(consoleEl);
	},

	setupResizing(consoleEl) {
		const handles = consoleEl.querySelectorAll('.resize-handle');
		if (!handles.length) return;

		let isResizing = false;
		let resizeDirection = '';
		let startX, startY, startWidth, startHeight;
		let startLeft, startTop;
		let finalLeft, finalTop, finalWidth, finalHeight;
		let originalTransform = '';
		let originalWidth, originalHeight;

		handles.forEach(handle => {
			handle.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();

				isResizing = true;
				startX = e.clientX;
				startY = e.clientY;

				originalTransform = consoleEl.style.transform || 'translate(0px, 0px)';
				originalWidth = parseInt(consoleEl.style.width) || 450;
				originalHeight = parseInt(consoleEl.style.height) || 350;

				const rect = consoleEl.getBoundingClientRect();
				startWidth = Math.round(rect.width);
				startHeight = Math.round(rect.height);
				startLeft = Math.round(rect.left);
				startTop = Math.round(rect.top);

				finalLeft = startLeft;
				finalTop = startTop;
				finalWidth = startWidth;
				finalHeight = startHeight;

				consoleEl.style.bottom = 'auto';
				consoleEl.style.right = 'auto';
				consoleEl.style.left = `${startLeft}px`;
				consoleEl.style.top = `${startTop}px`;
				consoleEl.style.transform = 'none';

				if (handle.classList.contains('resize-n')) resizeDirection = 'n';
				else if (handle.classList.contains('resize-s')) resizeDirection = 's';
				else if (handle.classList.contains('resize-e')) resizeDirection = 'e';
				else if (handle.classList.contains('resize-w')) resizeDirection = 'w';
				else if (handle.classList.contains('resize-ne')) resizeDirection = 'ne';
				else if (handle.classList.contains('resize-nw')) resizeDirection = 'nw';
				else if (handle.classList.contains('resize-se')) resizeDirection = 'se';
				else if (handle.classList.contains('resize-sw')) resizeDirection = 'sw';

				consoleEl.style.transition = 'none';
			});
		});

		document.addEventListener('mousemove', (e) => {
			if (!isResizing) return;

			const deltaX = e.clientX - startX;
			const deltaY = e.clientY - startY;

			let newWidth = startWidth;
			let newHeight = startHeight;
			let newLeft = startLeft;
			let newTop = startTop;

			if (resizeDirection.includes('e')) {
				newWidth = Math.max(450, Math.min(startWidth + deltaX, window.innerWidth - startLeft - 20));
			}
			if (resizeDirection.includes('w')) {
				const maxWidth = startLeft + startWidth - 20;
				newWidth = Math.max(450, Math.min(startWidth - deltaX, maxWidth));
				newLeft = startLeft + (startWidth - newWidth);
			}
			if (resizeDirection.includes('s')) {
				newHeight = Math.max(350, Math.min(startHeight + deltaY, window.innerHeight - startTop - 20));
			}
			if (resizeDirection.includes('n')) {
				const maxHeight = startTop + startHeight - 20;
				newHeight = Math.max(350, Math.min(startHeight - deltaY, maxHeight));
				newTop = startTop + (startHeight - newHeight);
			}

			finalLeft = Math.round(newLeft) + 15;
			finalTop = Math.round(newTop);
			finalWidth = Math.round(newWidth);
			finalHeight = Math.round(newHeight);

			consoleEl.style.width = `${newWidth}px`;
			consoleEl.style.height = `${newHeight}px`;
			consoleEl.style.left = `${newLeft}px`;
			consoleEl.style.top = `${newTop}px`;
		});

		document.addEventListener('mouseup', () => {
			if (isResizing) {
				const widthChanged = finalWidth !== originalWidth;
				const heightChanged = finalHeight !== originalHeight;

				if (widthChanged || heightChanged) {
					const baseRight = window.innerWidth - finalWidth - 20;
					const baseBottom = window.innerHeight - finalHeight - 20;

					const newTransformX = finalLeft - baseRight;
					const newTransformY = finalTop - baseBottom;

					consoleEl.style.width = `${finalWidth}px`;
					consoleEl.style.height = `${finalHeight}px`;
					consoleEl.style.left = 'auto';
					consoleEl.style.top = 'auto';
					consoleEl.style.right = '20px';
					consoleEl.style.bottom = '20px';
					consoleEl.style.transform = `translate(${newTransformX}px, ${newTransformY}px)`;

					if (this.dragState) {
						this.dragState.xOffset = newTransformX;
						this.dragState.yOffset = newTransformY;
						this.dragState.currentX = newTransformX;
						this.dragState.currentY = newTransformY;
						this.dragState.initialX = 0;
						this.dragState.initialY = 0;
					}

					this.savedPosition.x = newTransformX;
					this.savedPosition.y = newTransformY;
				} else {
					consoleEl.style.left = 'auto';
					consoleEl.style.top = 'auto';
					consoleEl.style.right = '20px';
					consoleEl.style.bottom = '20px';
					consoleEl.style.transform = originalTransform;
				}

				isResizing = false;
				resizeDirection = '';
			}
		});
	},

	setupDragging(consoleEl) {
		const header = consoleEl.querySelector('.command-header');
		const content = consoleEl.querySelector('.command-content');
		if (!header) return { xOffset: 0, yOffset: 0 };

		const dragState = {
			isDragging: false,
			currentX: 0,
			currentY: 0,
			initialX: 0,
			initialY: 0,
			xOffset: 0,
			yOffset: 0
		};

		header.addEventListener('mousedown', (e) => {
			if (e.target.closest('.toggle-console-btn')) return;
			if (e.target.closest('.close-console-btn')) return;
			if (content && content.style.display === 'none') return;

			dragState.initialX = e.clientX - dragState.xOffset;
			dragState.initialY = e.clientY - dragState.yOffset;
			dragState.isDragging = true;
			consoleEl.style.transition = 'none';
		});

		document.addEventListener('mousemove', (e) => {
			if (!dragState.isDragging) return;

			e.preventDefault();
			dragState.currentX = e.clientX - dragState.initialX;
			dragState.currentY = e.clientY - dragState.initialY;

			const rect = consoleEl.getBoundingClientRect();
			const maxX = window.innerWidth - rect.width - 20;
			const maxY = window.innerHeight - rect.height - 20;
			const minX = 20;
			const minY = 20;

			dragState.xOffset = Math.max(minX - (window.innerWidth - rect.width - 20), Math.min(dragState.currentX, maxX - (window.innerWidth - rect.width - 20)));
			dragState.yOffset = Math.max(minY - (window.innerHeight - rect.height - 20), Math.min(dragState.currentY, maxY - (window.innerHeight - rect.height - 20)));

			setTranslate(dragState.xOffset, dragState.yOffset, consoleEl);
		});

		document.addEventListener('mouseup', () => {
			if (dragState.isDragging) {
				dragState.initialX = dragState.currentX;
				dragState.initialY = dragState.currentY;
				dragState.isDragging = false;
			}
		});

		function setTranslate(xPos, yPos, el) {
			el.style.transform = `translate(${xPos}px, ${yPos}px)`;
		}

		return dragState;
	},

	showConfirmButtons() {
		const container = document.querySelector('.command-input-container');
		if (!container) return;

		container.innerHTML = `
			<button id="commandConfirmBtn" class="command-confirm-btn">확인</button>
			<button id="commandCancelBtn" class="command-cancel-btn">취소</button>
		`;

		document.getElementById('commandConfirmBtn').addEventListener('click', () => {
			this.handleConfirmResponse(true);
		});

		document.getElementById('commandCancelBtn').addEventListener('click', () => {
			this.handleConfirmResponse(false);
		});
	},

	addCancelButton() {
		const container = document.querySelector('.command-input-container');
		if (!container) return;

		// 이미 취소 버튼이 있는지 확인
		if (document.getElementById('commandCancelBtn')) return;

		const cancelBtn = document.createElement('button');
		cancelBtn.id = 'commandCancelBtn';
		cancelBtn.className = 'command-send-btn';
		cancelBtn.textContent = '취소';
		cancelBtn.style.cssText = 'background: #ef4444; margin-left: 5px;';

		cancelBtn.addEventListener('click', () => {
			this.log(this.comments.cancel);
			this.inputMode = 'normal';
			if (this.input) {
				this.input.type = 'text';
				this.input.value = '';
				this.input.placeholder = this.placeholders.input;
			}
			this.removeCancelButton();
		});

		container.appendChild(cancelBtn);
	},

	removeCancelButton() {
		const cancelBtn = document.getElementById('commandCancelBtn');
		if (cancelBtn) {
			cancelBtn.remove();
		}
	},

	showFirstTimeHelp() {
		if (!this.firstTimeHelpShown) {
			this.log(this.comments.help);
			this.firstTimeHelpShown = true;
		}
	},

	restoreInputField(showCancelButton = false) {
		const container = document.querySelector('.command-input-container');
		if (!container) return;

		// 취소 버튼 제거
		this.removeCancelButton();
		// 프로필 입력 모드에서는 기본적으로 취소 버튼을 표시하도록 처리
		const showCancel = showCancelButton || this.inputMode === 'profile' || this.inputMode === 'profile-switch';

		const placeholderText = (this.inputMode === 'profile' || this.inputMode === 'profile-switch') ? this.placeholders.profile : this.placeholders.input;
		if (showCancel) {
			container.innerHTML = `
					<input type="text" id="commandInput" class="command-input" placeholder="${placeholderText}">
					<button id="commandSendBtn" class="command-send-btn">전송</button>
					<button id="commandCancelBtn" class="command-send-btn" style="background: #ef4444; margin-left: 5px;">취소</button>
				`;
		} else {
			container.innerHTML = `
					<input type="text" id="commandInput" class="command-input" placeholder="${placeholderText}">
					<button id="commandSendBtn" class="command-send-btn">전송</button>
				`;
		}

		this.input = document.getElementById('commandInput');
		const sendBtn = document.getElementById('commandSendBtn');
		const cancelBtn = document.getElementById('commandCancelBtn');

		if (this.input) {
			this.input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.executeCommand();
				}
			});
			// 입력 폼에 포커스
			setTimeout(() => this.input.focus(), 50);
		}

		if (sendBtn) {
			sendBtn.addEventListener('click', () => this.executeCommand());
		}

		if (cancelBtn) {
			cancelBtn.addEventListener('click', () => {
				this.log(this.comments.cancel);
				this.inputMode = 'normal';
				this.input.type = 'text';
				this.input.value = '';
				this.input.placeholder = this.placeholders.input;
				this.restoreInputField(false);
			});
		}
	},

	handleConfirmResponse(confirmed) {
		if (this.inputMode === 'profile-create-confirm') {
			if (confirmed) {
				if (typeof setCurrentProfileSource === 'function') {
					setCurrentProfileSource('profiles');
				}
				currentProfileKey = this.tempProfile;

				const url = new URL(window.location);
				url.searchParams.set('key', this.tempProfile);
				window.history.pushState({}, '', url);

				const profileKeyDisplay = document.getElementById('profileKeyDisplay');
				if (profileKeyDisplay) {
					profileKeyDisplay.textContent = `Profile: ${this.tempProfile}`;
					// 신규 생성 시에는 인증됨
					profileKeyDisplay.classList.add('authenticated');
				}

				this.success(`프로필 '${this.tempProfile}' 생성됨`);

				// 동기화 활성화
				if (!syncEnabled) {
					syncEnabled = true;
					setupRealtimeSync();
				}
				this.log('🔄 실시간 동기화가 활성화되었습니다.');

				// 신규 프로필 생성 시 바로 빈 데이터로 초기화하여 동기화 시작
				const initialData = {
					people: state.people || [],
					inactivePeople: state.inactivePeople || [],
					requiredGroups: state.requiredGroups || [],
					nextId: state.nextId || 1,
					forbiddenPairs: state.forbiddenPairs || [],
					pendingConstraints: state.pendingConstraints || [],
					hiddenGroups: state.hiddenGroups || [],
					hiddenGroupChains: state.hiddenGroupChains || [],
					pendingHiddenGroups: state.pendingHiddenGroups || [],
					pendingHiddenGroupChains: state.pendingHiddenGroupChains || [],
					maxTeamSizeEnabled: state.maxTeamSizeEnabled || false,
					genderBalanceEnabled: state.genderBalanceEnabled || false,
					weightBalanceEnabled: state.weightBalanceEnabled || false,
					membersPerTeam: state.membersPerTeam || 4,
					timestamp: getCurrentDbTimestamp()
				};

				if (database && currentProfileKey) {
					database.ref(`profiles/${currentProfileKey}`).set(initialData)
						.then(() => {
							this.success(this.comments.syncActivated);
							this.log(this.comments.passwordCreate);
							this.inputMode = 'password-ask';
							this.showConfirmButtons();
						})
						.catch((error) => {
							this.error(`초기화 실패: ${error.message}`);
							this.log(this.comments.passwordCreate);
							this.inputMode = 'password-ask';
							this.showConfirmButtons();
						});
				} else {
					this.log(this.comments.passwordCreate);
					this.inputMode = 'password-ask';
					this.showConfirmButtons();
				}
			} else {
				// 프로필 생성 취소: 현재 프로필 유지 또는 초기 모드로 돌아가기
				if (currentProfileKey) {
					// 이미 프로필이 있으면 현재 프로필 유지
					this.log(this.comments.profileCreateCanceled.replace('{currentProfileKey}', currentProfileKey));

					// 전환을 취소하면 현재 프로필을 유지하고 명령어 입력 모드로 복귀
					this.inputMode = 'normal';
					this.restoreInputField();
					if (this.input) {
						this.input.type = 'text';
						this.input.placeholder = this.placeholders.input;
						this.input.focus && setTimeout(() => this.input.focus(), 50);
					}
				} else {
					// 프로필이 없으면 초기 상태로
					const url = new URL(window.location);
					url.searchParams.delete('key');
					window.history.pushState({}, '', url);

					const profileKeyDisplay = document.getElementById('profileKeyDisplay');
					if (profileKeyDisplay) {
						profileKeyDisplay.textContent = 'Profile: -';
						profileKeyDisplay.classList.remove('authenticated');
					}

					currentProfileKey = null;
					this.tempProfile = '';
					this.tempPassword = '';
					this.storedPassword = null;
					this.authenticated = false;
					this.log(this.comments.profileCreateCanceled);
					// 취소 시 명령어 입력 모드로 복귀
					this.inputMode = 'normal';
					this.restoreInputField();
					if (this.input) {
						this.input.type = 'text';
						this.input.placeholder = this.placeholders.input;
						setTimeout(() => this.input.focus(), 50);
					}
				}
			}
		} else if (this.inputMode === 'password-ask') {
			if (confirmed) {
				this.log(this.comments.passwordCreatePrompt);
				this.inputMode = 'password';
				this.restoreInputField();
				this.input.placeholder = this.placeholders.passwordCreate;
				this.input.type = 'password';
				this.addCancelButton();
				setTimeout(() => this.input.focus(), 50);
			} else {
				this.setUnifiedPassword('').then(() => {
					this.success(this.comments.passwordSkipSuccess);
				}).catch((error) => {
					this.error(`${this.comments.profileCreateFailed}: ${error.message}`);
				});
				this.inputMode = 'normal';
				this.authenticated = true;
				this.restoreInputField();
				this.input.placeholder = this.placeholders.input;
			}
		} else if (this.inputMode === 'password-ask-switch') {
			// 프로필 전환 시 비밀번호 입력 확인
			if (confirmed) {
				this.log(this.comments.passwordInput);
				this.inputMode = 'auth-switch';
				this.restoreInputField();
				this.input.type = 'password';
				this.input.placeholder = this.placeholders.passwordInput;
				this.addCancelButton();
				setTimeout(() => this.input.focus(), 50);
			} else {
				// 비밀번호 입력 취소 - 읽기 전용 모드로 사용
				this.log(this.comments.readOnlyModeInfo);
				this.inputMode = 'normal';
				this.authenticated = false; // 인증되지 않음
				this.restoreInputField();
				this.input.placeholder = this.placeholders.input;
				this.showFirstTimeHelp();
			}
		} else if (this.inputMode === 'password-ask-initial') {
			// 초기 접속 시 비밀번호 입력 확인
			if (confirmed) {
				this.log(this.comments.passwordInput);
				this.inputMode = 'auth';
				this.restoreInputField();
				this.input.type = 'password';
				this.input.placeholder = this.placeholders.passwordInput;
				this.addCancelButton();
				setTimeout(() => this.input.focus(), 50);
			} else {
				// 비밀번호 입력 취소 - 읽기 전용 모드로 사용
				this.log(this.comments.passwordInputSkipped);
				this.inputMode = 'normal';
				this.authenticated = false; // 인증되지 않음
				this.restoreInputField();
				this.input.placeholder = this.placeholders.input;
				this.showFirstTimeHelp();
			}
		} else if (this.inputMode === 'delete-confirm') {
			// 비밀번호 없을 때 삭제 확인
			if (confirmed) {
				this.warn(this.comments.deleteConfirmQuestion);
				this.log(this.comments.deleteConfirm);
				this.inputMode = 'delete-final-confirm';
				this.restoreInputField();
				this.input.type = 'text';
				this.input.placeholder = this.placeholders.profile;
				setTimeout(() => this.input.focus(), 50);
			} else {
				this.log(this.comments.deleteCanceled);
				this.inputMode = 'normal';
				this.restoreInputField();
				this.input.placeholder = this.placeholders.input;
			}
		} else if (this.inputMode === 'password-delete-confirm') {
			// 비밀번호 삭제 확인
			if (confirmed) {
				this.setUnifiedPassword('')
					.then(() => {
						this.success(this.comments.passwordDeleted);
						this.storedPassword = ''; // 저장된 비밀번호 초기화
					})
					.catch((error) => {
						this.error(this.comments.passwordDeleteFailed.replace('{error}', error.message));
					});
				this.inputMode = 'normal';
				this.restoreInputField();
				this.input.type = 'text';
				this.input.placeholder = this.placeholders.input;
			} else {
				this.log(this.comments.passwordChangeCanceled);
				this.inputMode = 'password-change-new';
				this.restoreInputField();
				this.input.type = 'password';
				this.input.placeholder = this.placeholders.passwordChangeNew;
				setTimeout(() => this.input.focus(), 50);
			}
		}
	},

	log(message, type = 'info') {
		if (!this.output) return;
		const timestamp = new Date().toLocaleTimeString('ko-KR');
		const entry = document.createElement('div');
		entry.className = `command-log command-log-${type}`;

		entry.innerHTML = `<span class="log-time">[${timestamp}]</span><span class="log-content">${message}</span>`;
		this.output.appendChild(entry);
		this.output.scrollTop = this.output.scrollHeight;

		// <code> 태그에 클릭 이벤트 추가 (명령어 자동 실행)
		entry.querySelectorAll('code[data-cmd]').forEach(code => {
			code.style.cursor = 'pointer';
			code.addEventListener('click', (e) => {
				e.stopPropagation();
				const cmdText = code.getAttribute('data-cmd');
				if (this.input && cmdText) {
					// 모든 특수 모드를 해제하고 normal 모드로 전환
					this.inputMode = 'normal';
					this.input.type = 'text';
					this.input.placeholder = this.placeholders.input;
					this.removeCancelButton();

					// 명령어 자동 입력 및 실행
					this.input.value = cmdText;
					this.input.focus();

					// 명령어 즉시 실행
					this.executeCommand();
				}
			});
		});
	},

	error(message) {
		this.log(message, 'error');
	},

	warn(message) {
		this.log(message, 'warn');
	},

	success(message) {
		this.log(message, 'success');
	},

	executeCommand() {
		if (!this.input) return;
		const cmd = this.input.value.trim();

		// password-change-new 모드에서는 빈 값도 처리해야 함 (비밀번호 삭제 기능)
		if (!cmd && this.inputMode !== 'password-change-new') return;

		// 비밀번호 관련 입력 모드에서는 로그 출력하지 않음
		if (this.inputMode !== 'auth' &&
		    this.inputMode !== 'auth-switch' &&
		    this.inputMode !== 'password' &&
		    this.inputMode !== 'password-confirm' &&
		    this.inputMode !== 'password-change' &&
		    this.inputMode !== 'password-change-confirm' &&
		    this.inputMode !== 'delete-password-confirm' &&
		    this.inputMode !== 'matching') {
			this.log(`> ${cmd}`, 'command');
		}
		this.input.value = '';

		if (this.inputMode === 'reservation') {
			// 예약 모드: 예약 명령어 처리
			// 예약 등록 처리
			try {
				const names = cmd.split(',').map(n => n.trim()).filter(n => n);
				if (names.length === 0) {
					this.error(commandConsoleMessages.comments.reservationInvalidFormat);
				} else {
					state.reservations.push(names);
					this.success(commandConsoleMessages.comments.reservationAdded.replace('{members}', names.join(', ')));
					saveToLocalStorage();
				}
			} catch (error) {
				this.error(commandConsoleMessages.comments.reservationAddFailed.replace('{error}', error.message));
			}

			// 예약 모드 유지 (취소 또는 ESC로만 종료 가능)
			this.input.placeholder = this.placeholders.reservation;
			setTimeout(() => this.input.focus(), 50);
			return;
		}

		if (this.inputMode === 'matching') {
			// 규칙 모드: 히든 그룹 명령어 처리
			this.log(`> ${cmd}`, 'command');

			// 규칙 제거 명령어 체크
			const isRemoveCommand = /^([^()!]+)\(!\)/.test(cmd) || /^([^()!,]+)!/.test(cmd);

			// input 명령어를 통해 처리
			this.inputCommand(cmd);
			saveToLocalStorage();

			// 결과 메시지 출력
			if (isRemoveCommand) {
				this.success('✅ 규칙 제거 완료');
			} else {
				this.success('✅ 규칙 추가 완료');
			}

			// 확인하기 안내
			this.log('확인하기 (명령어: <code data-cmd="확률">확률</code>)');

			// 규칙 모드 유지 (취소 또는 ESC로만 종료 가능)
			this.input.placeholder = this.placeholders.ruleInput;
			setTimeout(() => this.input.focus(), 50);
			return;
		}

		if (this.inputMode === 'profile' || this.inputMode === 'profile-switch') {
			if (!database && !initFirebase()) {
				this.error(this.comments.firebaseInitFailed + '.');
				return;
			}

			// 현재 프로필과 동일한 이름을 입력한 경우
			if (cmd === currentProfileKey) {
				this.log(this.comments.profileKeepCurrent);
				this.inputMode = 'normal';
				this.input.type = 'text';
				this.input.placeholder = this.placeholders.input;
				return;
			}

			// 프로필 전체 데이터 확인 (profiles + users)
			Promise.all([
				database.ref(`profiles/${cmd}`).once('value'),
				database.ref(`users/${cmd}`).once('value')
			]).then(async ([profileSnapshot, userSnapshot]) => {
				const profileNodeData = profileSnapshot.val();
				const userData = userSnapshot.val();
				const source = profileNodeData !== null ? 'profiles' : (userData !== null ? 'users' : 'profiles');
				const isUsersSource = source === 'users';
				const profileData = profileNodeData !== null ? profileNodeData : userData;
				const isProfileSwitch = this.inputMode === 'profile-switch';

				// 프로필이 존재하는지 확인 (password 또는 다른 데이터가 있으면 존재)
				if (profileData !== null) {
					if (typeof setCurrentProfileSource === 'function') {
						setCurrentProfileSource(source);
					}
					const password = isUsersSource ? '' : await this.getUnifiedPassword();
					this.tempProfile = cmd;
					currentProfileKey = cmd;
					this.storedPassword = isUsersSource ? '' : password;
					this.authenticated = isUsersSource;
					authenticatedPassword = isUsersSource ? 'users-auto-auth' : ''; // 프로필 전환 시 인증 초기화

					const url = new URL(window.location);
					url.searchParams.set('key', cmd);
					window.history.pushState({}, '', url);

					const profileKeyDisplay = document.getElementById('profileKeyDisplay');
					if (profileKeyDisplay) {
						profileKeyDisplay.textContent = `Profile: ${cmd}`;
						if (isUsersSource) {
							profileKeyDisplay.classList.add('authenticated');
						} else {
							// 프로필 전환 시에는 항상 인증되지 않은 상태
							profileKeyDisplay.classList.remove('authenticated');
						}
					}

					if (isProfileSwitch) {
						// 프로필 전환 모드: 비밀번호 없으면 바로 전환, 있으면 인증 요청
						if (isUsersSource || password === '') {
							this.authenticated = true;
							if (isUsersSource) authenticatedPassword = 'users-auto-auth';
							this.inputMode = 'normal';
							this.input.type = 'text';
							this.input.placeholder = this.placeholders.input;

							if (!syncEnabled) {
								syncEnabled = true;
								setupRealtimeSync();
							}

							// 데이터 로드 및 자동 동기화 설정
							database.ref(`profiles/${currentProfileKey}`).once('value')
								.then((snapshot) => {
									const data = snapshot.val();
									if (data && (data.people || data.timestamp)) {
										// 저장된 데이터가 있으면 로드
										loadStateFromData(data);
										this.success(this.comments.profileSwitchSuccess.replace('{profile}', cmd));
										this.log('🔄 실시간 동기화가 활성화되었습니다.');
									} else {
										// 데이터가 없으면 초기화
										clearState();
										this.success(this.comments.profileSwitchSuccess.replace('{profile}', cmd));
										this.log('🔄 실시간 동기화가 활성화되었습니다.');
									}
								})
								.catch((error) => {
									this.error(this.comments.dataLoadFailed.replace('{error}', error.message));
								});
						} else {
							// 동기화 먼저 활성화
							if (!syncEnabled) {
								syncEnabled = true;
								setupRealtimeSync();
							}

							// 데이터 먼저 로드
							database.ref(`profiles/${currentProfileKey}`).once('value')
								.then((snapshot) => {
									const data = snapshot.val();
									if (data && (data.people || data.timestamp)) {
										loadStateFromData(data);
										this.log(this.comments.profileFoundMessage.replace('{profile}', cmd));
									} else {
										this.log(this.comments.profileFoundMessage.replace('{profile}', cmd));
									}
									this.log('🔄 실시간 동기화가 활성화되었습니다.');
									this.log(this.comments.passwordInputAsk);
									this.inputMode = 'password-ask-switch';
									this.showConfirmButtons();
								})
								.catch((error) => {
									this.error(this.comments.dataLoadFailed.replace('{error}', error.message));
									this.log(this.comments.passwordInputAsk);
									this.inputMode = 'password-ask-switch';
									this.showConfirmButtons();
								});
						}
					} else {
						// 초기 접속 모드
						// 동기화 먼저 활성화
						if (!syncEnabled) {
							syncEnabled = true;
							setupRealtimeSync();
						}

						// 데이터 먼저 로드
						database.ref(`profiles/${currentProfileKey}`).once('value')
							.then((snapshot) => {
								const data = snapshot.val();
								if (data && (data.people || data.timestamp)) {
									loadStateFromData(data);
									this.log(this.comments.profileFoundMessage.replace('{profile}', cmd));
								} else {
									this.log(this.comments.profileFoundMessage.replace('{profile}', cmd));
								}
								this.log('🔄 실시간 동기화가 활성화되었습니다.');
								if (isUsersSource || password === '') {
									this.authenticated = true;
									if (isUsersSource) authenticatedPassword = 'users-auto-auth';
									this.inputMode = 'normal';
									this.input.type = 'text';
									this.input.placeholder = this.placeholders.input;
									this.log(this.comments.consoleReady);
								} else {
									this.log(this.comments.passwordAskInitial);
									this.inputMode = 'password-ask-initial';
									this.showConfirmButtons();
								}
							})
							.catch((error) => {
								this.error(this.comments.dataLoadFailed.replace('{error}', error.message));
								if (!(isUsersSource || password === '')) {
									this.log(this.comments.passwordAskInitial);
									this.inputMode = 'password-ask-initial';
									this.showConfirmButtons();
								}
							});
					}
				} else {
					this.tempProfile = cmd;
					if (isProfileSwitch) {
						this.warn(this.comments.profileNotFoundSwitch.replace('{profile}', cmd));
					} else {
						this.warn(this.comments.profileNotFoundInitial.replace('{profile}', cmd));
					}
					this.log(this.comments.profileCreateNew.replace('{profile}', cmd));
					this.inputMode = 'profile-create-confirm';
					this.showConfirmButtons();
				}
			}).catch((error) => {
				this.error(this.comments.profileCheckFailed.replace('{error}', error.message));
			});
			return;
		}

		if (this.inputMode === 'auth' || this.inputMode === 'auth-switch') {
			const isSwitch = this.inputMode === 'auth-switch';

			if (cmd === this.storedPassword) {
				this.authenticated = true;
				authenticatedPassword = cmd; // 인증된 비밀번호 저장
				this.inputMode = 'normal';
				this.input.type = 'text';
				this.input.placeholder = this.placeholders.input;
				this.removeCancelButton();

				// 프로필 배경색 업데이트
				const profileKeyDisplay = document.getElementById('profileKeyDisplay');
				if (profileKeyDisplay) {
					profileKeyDisplay.classList.add('authenticated');
				}

				// 동기화가 비활성화되어 있으면 활성화
				if (!syncEnabled) {
					syncEnabled = true;
					setupRealtimeSync();
				}

				// 프로필 전환 모드든 초기 접속 모드든 데이터 로드
				database.ref(`profiles/${currentProfileKey}`).once('value')
					.then((snapshot) => {
						const data = snapshot.val();
						if (data && (data.people || data.timestamp)) {
							if (isSwitch) {
								this.success(`✅ '${this.tempProfile}' 프로필로 전환 성공!`);
							} else {
								this.success(this.comments.authSuccess);
								this.showFirstTimeHelp();
							}
						} else {
							// 데이터가 없으면 초기화
							clearState();
							if (isSwitch) {
								this.success(`✅ '${this.tempProfile}' 프로필로 전환 성공!`);
							} else {
								this.success(this.comments.authSuccess);
								this.showFirstTimeHelp();
							}
						}
					})
					.catch((error) => {
						this.error(this.comments.dataLoadFailed.replace('{error}', error.message));
					});
			} else {
				this.error(this.comments.passwordMismatch + '. 다시 시도해주세요.');
			}
			return;
		}

		if (this.inputMode === 'password') {
		// 첫 번째 비밀번호 입력
		this.tempPassword = cmd;
		this.log(this.comments.passwordInputConfirm);
		this.inputMode = 'password-confirm';
		this.input.placeholder = this.placeholders.passwordConfirm;
		this.input.value = '';
		// 취소 버튼 유지 (이미 있음)
		return;
	}

	if (this.inputMode === 'password-confirm') {
		// 두 번째 비밀번호 입력 및 확인
		if (cmd === this.tempPassword) {
			// 비밀번호 일치
			this.setUnifiedPassword(this.tempPassword)
				.then(() => {
					this.success(this.comments.passwordSet);
					this.authenticated = true;
					this.storedPassword = this.tempPassword;
					this.removeCancelButton();
					this.showFirstTimeHelp();
				})
				.catch((error) => {
					this.error(`비밀번호 설정 실패: ${error.message}`);
				});
			this.inputMode = 'normal';
			this.input.type = 'text';
			this.input.placeholder = this.placeholders.input;
			this.tempPassword = '';
		} else {
			// 비밀번호 불일치
			this.error(this.comments.passwordMismatch);
			this.log(this.comments.passwordCreatePrompt);
			this.inputMode = 'password';
			this.input.placeholder = this.placeholders.passwordCreate;
			this.tempPassword = '';
		}
		return;
	}

	if (this.inputMode === 'password-change') {
		// 1단계: 현재 비밀번호 확인
		if (cmd === this.storedPassword) {
			this.success(this.comments.passwordConfirmed);
			this.removeCancelButton();
			this.log(this.comments.passwordChangeNew);
			this.inputMode = 'password-change-new';
			this.input.placeholder = this.placeholders.passwordChangeNew;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
		} else {
			this.error('현재 ' + this.comments.passwordMismatch.toLowerCase() + '. 다시 시도해주세요.');
			this.inputMode = 'normal';
			this.input.type = 'text';
			this.input.placeholder = this.placeholders.input;
			this.removeCancelButton();
		}
		return;
	}

	if (this.inputMode === 'password-change-new') {
		// 2단계: 새 비밀번호 입력
		if (!cmd || cmd.trim() === '') {
			// 빈 값이면 비밀번호 삭제 확인
			this.warn(this.comments.passwordDeleteConfirm);
			this.inputMode = 'password-delete-confirm';
			this.showConfirmButtons();
			return;
		}
		this.tempPassword = cmd;
		this.log(this.comments.passwordChangeConfirm);
		this.inputMode = 'password-change-confirm';
		this.input.placeholder = this.placeholders.passwordChangeConfirm;
		setTimeout(() => this.input.focus(), 50);
		return;
	}

	if (this.inputMode === 'password-change-confirm') {
		// 3단계: 새 비밀번호 확인
		if (cmd === this.tempPassword) {
			this.setUnifiedPassword(this.tempPassword)
				.then(() => {
					this.success(this.comments.passwordChanged);
					this.storedPassword = this.tempPassword; // 저장된 비밀번호 업데이트
					this.removeCancelButton();
				})
				.catch((error) => {
					this.error(`비밀번호 변경 실패: ${error.message}`);
				});
			this.inputMode = 'normal';
			this.input.type = 'text';
			this.input.placeholder = this.placeholders.input;
			this.tempPassword = '';
		} else {
			this.error(this.comments.passwordInputConfirm);
			this.inputMode = 'password-change-new';
			this.input.placeholder = this.placeholders.passwordChangeNew;
			this.tempPassword = '';
			setTimeout(() => this.input.focus(), 50);
		}
		return;
	}

	if (this.inputMode === 'input-data') {
		// 참가자 데이터 입력 완료
		if (typeof addPerson === 'function' && elements.nameInput) {
			elements.nameInput.value = cmd;
			addPerson();
			this.success(`${this.comments.participantAddComplete} ${cmd}`);
		} else {
			this.error(this.comments.participantAddDisabled);
		}

		// 입력 모드 유지 (취소 또는 ESC로만 종료 가능)
		this.input.placeholder = this.placeholders.inputData;
		setTimeout(() => this.input.focus(), 50);
		return;
	}

	if (this.inputMode === 'delete-password-confirm') {
		// 삭제 전 비밀번호 확인
		if (cmd === this.storedPassword) {
			this.success(this.comments.profileDeleteConfirmFinal);
			this.log(this.comments.deleteConfirm);
			this.inputMode = 'delete-final-confirm';
			this.input.type = 'text';
			this.input.placeholder = this.placeholders.profile;
			setTimeout(() => this.input.focus(), 50);
		} else {
			this.error(this.comments.passwordMismatch + '. 삭제가 취소되었습니다.');
			this.inputMode = 'normal';
			this.input.type = 'text';
			this.input.placeholder = this.placeholders.input;
			this.removeCancelButton();
		}
		return;
	}

	if (this.inputMode === 'delete-final-confirm') {
		// 최종 확인: 프로필 이름 일치 확인
		if (cmd === currentProfileKey) {
			// Firebase에서 프로필 삭제
			database.ref(`profiles/${currentProfileKey}`).remove()
				.then(() => {
					this.success(`✅ ${this.comments.profileDeleted.replace('프로필이', `프로필 '${currentProfileKey}'가`).replace('삭제되었습니다', '완전히 삭제되었습니다')}`);
					this.log(this.comments.deleteRedirect);

					// 로컬 상태 초기화
					clearState();
					currentProfileKey = null;
					syncEnabled = false;

					// 2초 후 index.html로 리다이렉트
					setTimeout(() => {
						window.location.href = 'index.html';
					}, 2000);
				})
				.catch((error) => {
					this.error(`삭제 실패: ${error.message}`);
					this.inputMode = 'normal';
					this.input.placeholder = this.placeholders.input;
				});
		} else {
			this.error(this.comments.profileDeleteNameMismatch);
			this.inputMode = 'normal';
			this.input.placeholder = this.placeholders.input;
		}
		return;
	}

	if (currentProfileKey && typeof getCurrentProfileSource === 'function' && getCurrentProfileSource() === 'users' && !this.authenticated) {
		this.authenticated = true;
		this.storedPassword = '';
		authenticatedPassword = 'users-auto-auth';
		const profileKeyDisplay = document.getElementById('profileKeyDisplay');
		if (profileKeyDisplay) profileKeyDisplay.classList.add('authenticated');
	}

	if (!this.hasWriteAccess() && currentProfileKey) {
		// 읽기 모드에서는 save와 입력 관련 명령어만 차단
		const [command] = cmd.split(' ');
		const writeCommands = ['save', '저장', 'input', '입력', 'clear', '초기화'];
		if (writeCommands.includes(command.toLowerCase())) {
			this.warn(this.comments.readOnlyModeWarning + '. ' + this.comments.authenticationNeeded);
			this.log(this.comments.loginRequired);
			return;
		}
	}

	const [command, ...args] = cmd.split(' ');

		switch (command.toLowerCase()) {
			case 'save':
			case '저장':
				this.saveCommand();
				break;
			case 'load':
			case '불러오기':
				this.loadCommand(args.join(' '));
				break;
			case 'sync':
			case '동기화':
				this.syncCommand(args.join(' '));
				break;
			case 'clear':
			case '초기화':
				this.clearCommand(args.join(' '));
				break;
			case 'status':
			case '상태':
				this.statusCommand();
				break;
			case 'login':
			case '로그인':
				// 로그인 명령어 - 비밀번호 입력 모드로 전환
				this.loginCommand();
				break;
			case 'logout':
			case '종료':
				// 로그아웃 명령어 - 쓰기 모드에서 읽기 모드로 전환
				this.logoutCommand();
				break;
			case 'password':
			case '비밀번호':
				// 비밀번호 변경 명령어
				this.passwordCommand(args.join(' '));
				break;
			case 'profile':
			case '프로필':
				this.profileCommand();
				break;
			case '참가자':
			case 'member':
				this.participantsCommand();
				break;
			case '미참가자':
			case 'people':
				this.nonParticipantsCommand();
				break;
			case '분리':
				this.constraintsCommand();
				break;
			case '히든':
			case '확률':
				this.hiddenCommand();
				break;
			case '규칙':
			case 'rule':
			case 'matching':
				this.matchingCommand(args.join(' '));
				break;
			case '생성':
			case 'generate':
				this.generateCommand();
				break;
			case 'input':
			case '입력':
				this.inputCommand(args.join(' '));
				break;
			case 'reservation':
			case '예약':
				this.reservationCommand(args.join(' '));
				break;
			case 'delete':
			case '삭제':
			case 'delete-profile':
			case '프로필삭제':
				this.deleteCommand();
				break;
			case 'help':
			case '도움':
				this.helpCommand();
				break;
			default:
			this.error(this.comments.unknownCommand);
		}
	},

	saveCommand() {
		if (!syncEnabled || !currentProfileKey) {
			this.error(this.comments.firebaseMissing);
			return;
		}

		const ensureProfileSourceForSave = () => {
			if (typeof getCurrentProfileSource === 'function' && getCurrentProfileSource() === 'users') {
				if (typeof setCurrentProfileSource === 'function') setCurrentProfileSource('users');
				return Promise.resolve();
			}

			if (typeof resolveProfileRecord !== 'function') {
				return Promise.resolve();
			}

			return resolveProfileRecord(currentProfileKey)
				.then((result) => {
					if (result && result.source === 'users' && typeof setCurrentProfileSource === 'function') {
						setCurrentProfileSource('users');
					}
				});
		};

		// 저장은 Firebase에 업로드만 하고 다른 창에 알림을 보내지 않음
		if (typeof window !== 'undefined') {
			window.lastReservationChangeByMe = true;
		}

		ensureProfileSourceForSave()
		.then(() => {

			const data = {
				people: state.people,
				inactivePeople: state.inactivePeople,
				requiredGroups: state.requiredGroups,
				nextId: state.nextId,
				forbiddenPairs: state.forbiddenPairs,
				pendingConstraints: state.pendingConstraints,
				probabilisticForbiddenPairs: state.probabilisticForbiddenPairs,
				hiddenGroups: state.hiddenGroups,
				hiddenGroupChains: state.hiddenGroupChains,
				pendingHiddenGroups: state.pendingHiddenGroups,
				pendingHiddenGroupChains: state.pendingHiddenGroupChains,
				reservations: state.reservations,
				maxTeamSizeEnabled: state.maxTeamSizeEnabled,
				genderBalanceEnabled: state.genderBalanceEnabled,
				weightBalanceEnabled: state.weightBalanceEnabled,
				membersPerTeam: state.membersPerTeam,
				timestamp: getCurrentDbTimestamp()
			};

			return database.ref(`profiles/${currentProfileKey}`).set(data);
		})
		.then(() => {
			this.success(this.comments.saveComplete);

		// 플래그 해제 (약간의 지연 후)
		setTimeout(() => {
			if (typeof window !== 'undefined') {
				window.lastReservationChangeByMe = false;
			}
		}, 100);
	})
	.catch((error) => {
		this.error(`저장 실패: ${error.message}`);

		// 에러 시에도 플래그 해제
		if (typeof window !== 'undefined') {
			window.lastReservationChangeByMe = false;
		}
	});
},

loadCommand(profileName = '') {
		if (!currentProfileKey) {
			this.error('⚠️ 현재 프로필이 없어서 실행할 수 없습니다. 먼저 프로필을 선택하세요.');
			return;
		}

		const targetProfile = (profileName || '').trim();
		const ensureSource = (profileKey) => {
			if (typeof resolveProfileRecord !== 'function') {
				return Promise.resolve({ exists: true, source: 'profiles', data: null });
			}
			return resolveProfileRecord(profileKey)
				.then((result) => {
					if (result && typeof setCurrentProfileSource === 'function') {
						setCurrentProfileSource(result.source);
					}
					return result;
				});
		};

		if (!targetProfile) {
			ensureSource(currentProfileKey)
				.then(() => database.ref(`profiles/${currentProfileKey}`).once('value'))
				.then((snapshot) => {
					const data = snapshot.val();
					if (data) {
						loadStateFromData(data);
						this.success(this.comments.loadComplete);
					} else {
						this.warn(this.comments.noSavedData + '.');
					}
				})
				.catch((error) => {
					this.error(`로드 실패: ${error.message}`);
				});
			return;
		}

		// 다른 프로필 데이터 가져와 현재 프로필에 로컬 반영 (저장/동기화 없음)
		ensureSource(targetProfile)
			.then((result) => {
				if (!result || !result.exists || !result.data) {
					this.warn(this.comments.profileNotFoundSwitch.replace('{profile}', targetProfile));
					return;
				}
				const data = result.data;

				const importedData = {
					people: data.people || [],
					inactivePeople: data.inactivePeople || [],
					requiredGroups: data.requiredGroups || [],
					nextId: data.nextId || 1,
					forbiddenPairs: data.forbiddenPairs || [],
					pendingConstraints: data.pendingConstraints || [],
					probabilisticForbiddenPairs: data.probabilisticForbiddenPairs || [],
					hiddenGroups: data.hiddenGroups || [],
					hiddenGroupChains: data.hiddenGroupChains || [],
					pendingHiddenGroups: data.pendingHiddenGroups || [],
					pendingHiddenGroupChains: data.pendingHiddenGroupChains || [],
					reservations: data.reservations || [],
					maxTeamSizeEnabled: data.maxTeamSizeEnabled || false,
					genderBalanceEnabled: data.genderBalanceEnabled || false,
					weightBalanceEnabled: data.weightBalanceEnabled || false,
					membersPerTeam: data.membersPerTeam || 4
				};

				loadStateFromData(importedData);
				saveToLocalStorage();
				tryResolvePendingConstraints();
				tryResolveHiddenGroups();
				this.success(this.comments.loadComplete);
			})
			.catch((error) => {
				this.error(`로드 실패: ${error.message}`);
			});
	},

	syncCommand(args) {
		if (!syncEnabled || !currentProfileKey) {
			this.error(this.comments.firebaseMissing);
			return;
		}

		// 인증 체크
		if (!this.hasWriteAccess()) {
			this.error(this.comments.readOnlyFeatureDisabled);
			this.log(this.comments.authenticationRequired);
			return;
		}

		// 세분화된 동기화 옵션 처리
		const option = args.toLowerCase().trim();

		// 옵션이 있는 경우
		if (option) {
			switch (option) {
				case 'rule':
				case '규칙':
				case '확률':
					this.syncRuleCommand();
					return;
				case 'option':
				case '옵션':
					this.syncOptionCommand();
					return;
				case 'member':
				case '참가자':
					this.syncMemberCommand();
					return;
				case 'people':
				case '미참가자':
					this.syncPeopleCommand();
					return;
				case 'constraint':
				case '분리':
					this.syncConstraintCommand();
					return;
				case 'reservation':
				case '예약':
					this.syncReservationCommand();
					return;
				default:
					// 잘못된 옵션
					this.error(`❌ 알 수 없는 동기화 옵션: "${args}"<br>사용 가능한 옵션: 규칙, 확률, 옵션, 참가자, 미참가자, 분리, 예약`);
					return;
			}
		} else {
			// 옵션이 없으면 전체 동기화
			this.syncAllCommand();
			return;
		}
	},

	// 전체 동기화 (기존 sync 명령어)
	syncAllCommand() {
		// 인증 체크
		if (!this.hasWriteAccess()) {
			this.error(this.comments.readOnlyFeatureDisabled);
			this.log(this.comments.authenticationRequired);
			return;
		}

		// 전체 동기화 시에도 예약 알림을 보내지 않음 (syncTrigger로 전체 동기화 알림만 표시)
		if (typeof window !== 'undefined') {
			window.lastReservationChangeByMe = true;
		}

		// 먼저 현재 상태를 저장
		Promise.resolve()
			.then(() => {
				const data = {
					people: state.people,
					inactivePeople: state.inactivePeople,
					requiredGroups: state.requiredGroups,
					nextId: state.nextId,
					forbiddenPairs: state.forbiddenPairs,
					pendingConstraints: state.pendingConstraints,
					probabilisticForbiddenPairs: state.probabilisticForbiddenPairs,
					hiddenGroups: state.hiddenGroups,
					hiddenGroupChains: state.hiddenGroupChains,
					pendingHiddenGroups: state.pendingHiddenGroups,
					pendingHiddenGroupChains: state.pendingHiddenGroupChains,
					reservations: state.reservations,
					maxTeamSizeEnabled: state.maxTeamSizeEnabled,
					genderBalanceEnabled: state.genderBalanceEnabled,
					weightBalanceEnabled: state.weightBalanceEnabled,
					membersPerTeam: state.membersPerTeam,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).set(data);
			})
			.then(() => {
				// 동기화 트리거를 Firebase에 기록하여 모든 창에 알림
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'all' };

				// 자신이 발생시킨 트리거는 리스너에서 무시하도록 lastSyncTrigger 미리 업데이트
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}

				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 현재 창에서도 동기화 실행
				return database.ref(`profiles/${currentProfileKey}`).once('value');
			})
			.then((snapshot) => {
				const data = snapshot.val();
					if (data) {
						loadStateFromData(data);
						this.success(`✅ 동기화 및 저장 완료`);

				// 플래그 해제 (약간의 지연 후)
				setTimeout(() => {
					if (typeof window !== 'undefined') {
						window.lastReservationChangeByMe = false;
					}
				}, 100);
			} else {
				this.warn(this.comments.noSavedData + '.');

				// 플래그 해제
				if (typeof window !== 'undefined') {
					window.lastReservationChangeByMe = false;
				}
			}
		})
			.catch((error) => {
				this.error(`❌ 동기화 실패: ${error.message}`);

				// 에러 시에도 플래그 해제
				if (typeof window !== 'undefined') {
					window.lastReservationChangeByMe = false;
				}
			});
	},

	// 규칙만 동기화
	syncRuleCommand() {
		// 인증 체크
		if (!this.hasWriteAccess()) {
			this.error('❌ 인증이 필요합니다. <code data-cmd="login">login</code> 또는 <code data-cmd="로그인">로그인</code> 명령어로 먼저 로그인하세요.');
			return;
		}

		database.ref(`profiles/${currentProfileKey}`).once('value')
			.then((snapshot) => {
				const existingData = snapshot.val() || {};

				// 규칙 관련 데이터만 업데이트
				const updates = {
					hiddenGroups: state.hiddenGroups,
					hiddenGroupChains: state.hiddenGroupChains,
					pendingHiddenGroups: state.pendingHiddenGroups,
					pendingHiddenGroupChains: state.pendingHiddenGroupChains,
					probabilisticForbiddenPairs: state.probabilisticForbiddenPairs,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).update(updates);
			})
			.then(() => {
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'rule' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 규칙 데이터만 다시 로드
				return Promise.all([
					database.ref(`profiles/${currentProfileKey}/hiddenGroups`).once('value'),
					database.ref(`profiles/${currentProfileKey}/hiddenGroupChains`).once('value'),
					database.ref(`profiles/${currentProfileKey}/pendingHiddenGroups`).once('value'),
					database.ref(`profiles/${currentProfileKey}/pendingHiddenGroupChains`).once('value'),
					database.ref(`profiles/${currentProfileKey}/probabilisticForbiddenPairs`).once('value')
				]);
			})
			.then(([hiddenGroupsSnap, hiddenGroupChainsSnap, pendingHiddenGroupsSnap, pendingHiddenGroupChainsSnap, probabilisticForbiddenPairsSnap]) => {
				// 규칙 데이터만 state에 반영
				state.hiddenGroups = hiddenGroupsSnap.val() || [];
				state.hiddenGroupChains = hiddenGroupChainsSnap.val() || [];
				state.pendingHiddenGroups = pendingHiddenGroupsSnap.val() || [];
				state.pendingHiddenGroupChains = pendingHiddenGroupChainsSnap.val() || [];
				state.probabilisticForbiddenPairs = probabilisticForbiddenPairsSnap.val() || [];
				state.activeProbabilisticForbiddenPairs = [];

				// UI 업데이트는 필요 없음 (규칙은 UI에 직접 표시되지 않음)
				this.success(`✅ 동기화 및 저장 완료`);
			})
			.catch((error) => {
				this.error(`❌ 규칙 동기화 실패: ${error.message}`);
			});
	},

	// 옵션만 동기화
	syncOptionCommand() {
		// 인증 체크
		if (!this.hasWriteAccess()) {
			this.error('❌ 인증이 필요합니다. <code data-cmd="login">login</code> 또는 <code data-cmd="로그인">로그인</code> 명령어로 먼저 로그인하세요.');
			return;
		}

		database.ref(`profiles/${currentProfileKey}`).once('value')
			.then((snapshot) => {
				const existingData = snapshot.val() || {};

				// 옵션 관련 데이터만 업데이트
				const updates = {
					maxTeamSizeEnabled: state.maxTeamSizeEnabled,
					genderBalanceEnabled: state.genderBalanceEnabled,
					weightBalanceEnabled: state.weightBalanceEnabled,
					membersPerTeam: state.membersPerTeam,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).update(updates);
			})
			.then(() => {
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'option' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 옵션 데이터만 다시 로드
				return Promise.all([
					database.ref(`profiles/${currentProfileKey}/maxTeamSizeEnabled`).once('value'),
					database.ref(`profiles/${currentProfileKey}/genderBalanceEnabled`).once('value'),
					database.ref(`profiles/${currentProfileKey}/weightBalanceEnabled`).once('value'),
					database.ref(`profiles/${currentProfileKey}/membersPerTeam`).once('value')
				]);
			})
			.then(([maxTeamSizeSnap, genderBalanceSnap, weightBalanceSnap, membersPerTeamSnap]) => {
				// 옵션 데이터만 state에 반영
				state.maxTeamSizeEnabled = maxTeamSizeSnap.val() || false;
				state.genderBalanceEnabled = genderBalanceSnap.val() || false;
				state.weightBalanceEnabled = weightBalanceSnap.val() || false;
				state.membersPerTeam = membersPerTeamSnap.val() || 4;

				// UI 업데이트
				if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = state.maxTeamSizeEnabled;
				if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = state.genderBalanceEnabled;
				if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = state.weightBalanceEnabled;
				if (elements.teamSizeInput) elements.teamSizeInput.value = state.membersPerTeam;

				this.success(`✅ 동기화 및 저장 완료`);
			})
			.catch((error) => {
				this.error(`❌ 옵션 동기화 실패: ${error.message}`);
			});
	},

	// 참가자만 동기화
	syncMemberCommand() {
		database.ref(`profiles/${currentProfileKey}`).once('value')
			.then((snapshot) => {
				const existingData = snapshot.val() || {};

				// 참가자 관련 데이터만 업데이트
				const updates = {
					people: state.people,
					nextId: state.nextId,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).update(updates);
			})
			.then(() => {
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'member' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 참가자 데이터만 다시 로드
				return Promise.all([
					database.ref(`profiles/${currentProfileKey}/people`).once('value'),
					database.ref(`profiles/${currentProfileKey}/nextId`).once('value')
				]);
			})
			.then(([peopleSnap, nextIdSnap]) => {
				// 참가자 데이터만 state에 반영
				state.people = peopleSnap.val() || [];
				state.nextId = nextIdSnap.val() || 1;

				// 금지 맵 재구성 및 UI 업데이트
				buildForbiddenMap();
				renderPeople();

				this.success(`✅ 동기화 및 저장 완료`);
			})
			.catch((error) => {
				this.error(`❌ 참가자 동기화 실패: ${error.message}`);
			});
	},

	// 미참가자만 동기화
	syncPeopleCommand() {
		database.ref(`profiles/${currentProfileKey}`).once('value')
			.then((snapshot) => {
				const existingData = snapshot.val() || {};

				// 미참가자 관련 데이터만 업데이트
				const updates = {
					inactivePeople: state.inactivePeople,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).update(updates);
			})
			.then(() => {
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'people' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 미참가자 데이터만 다시 로드
				return database.ref(`profiles/${currentProfileKey}/inactivePeople`).once('value');
			})
			.then((snapshot) => {
				// 미참가자 데이터만 state에 반영
				state.inactivePeople = snapshot.val() || [];

				// UI 업데이트
				renderPeople();

				this.success(`✅ 동기화 및 저장 완료`);
			})
			.catch((error) => {
				this.error(`❌ 미참가자 동기화 실패: ${error.message}`);
			});
	},

	// 분리만 동기화
	syncConstraintCommand() {
		database.ref(`profiles/${currentProfileKey}`).once('value')
			.then((snapshot) => {
				const existingData = snapshot.val() || {};

				// 분리 관련 데이터만 업데이트
				const updates = {
					requiredGroups: state.requiredGroups,
					forbiddenPairs: state.forbiddenPairs,
					pendingConstraints: state.pendingConstraints,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).update(updates);
			})
			.then(() => {
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'constraint' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 분리 데이터만 다시 로드
				return Promise.all([
					database.ref(`profiles/${currentProfileKey}/requiredGroups`).once('value'),
					database.ref(`profiles/${currentProfileKey}/forbiddenPairs`).once('value'),
					database.ref(`profiles/${currentProfileKey}/pendingConstraints`).once('value')
				]);
			})
			.then(([requiredGroupsSnap, forbiddenPairsSnap, pendingConstraintsSnap]) => {
				// 분리 데이터만 state에 반영
				state.requiredGroups = requiredGroupsSnap.val() || [];
				state.forbiddenPairs = forbiddenPairsSnap.val() || [];
				state.pendingConstraints = pendingConstraintsSnap.val() || [];

				// 금지 맵 재구성 및 UI 업데이트
				buildForbiddenMap();
				renderPeople();

				this.success(`✅ 동기화 및 저장 완료`);
			})
			.catch((error) => {
				this.error(`❌ 분리 동기화 실패: ${error.message}`);
			});
	},

	syncReservationCommand() {
		// 인증 체크
		if (!this.hasWriteAccess()) {
			this.error(this.comments.readOnlyFeatureDisabled);
			this.log(this.comments.authenticationRequired);
			return;
		}

		database.ref(`profiles/${currentProfileKey}`).once('value')
			.then((snapshot) => {
				const existingData = snapshot.val() || {};

				// 예약 데이터만 업데이트
				const updates = {
					reservations: state.reservations,
					timestamp: getCurrentDbTimestamp()
				};

				return database.ref(`profiles/${currentProfileKey}`).update(updates);
			})
			.then(() => {
				const syncTrigger = { timestamp: getCurrentDbTimestamp(), type: 'reservation' };
				if (typeof lastSyncTrigger !== 'undefined') {
					lastSyncTrigger = syncTrigger;
				}
				return database.ref(`profiles/${currentProfileKey}/syncTrigger`).set(syncTrigger);
			})
			.then(() => {
				// 예약 데이터만 다시 로드
				return database.ref(`profiles/${currentProfileKey}/reservations`).once('value');
			})
			.then((snapshot) => {
				// 예약 데이터만 state에 반영
				state.reservations = snapshot.val() || [];

				this.success(`✅ 동기화 및 저장 완료`);
			})
			.catch((error) => {
				this.error(`❌ 예약 동기화 실패: ${error.message}`);
			});
	},

	clearCommand(args = '') {
		if (!syncEnabled || !currentProfileKey) {
			this.error(this.comments.firebaseMissing);
			return;
		}

		const trimmedArgs = (args || '').trim();

		if (!trimmedArgs) {
			if (!confirm(this.comments.clearConfirmMessage)) return;

			// 초기화도 Firebase 업로드만 하고 다른 창에 알림을 보내지 않음
			if (typeof window !== 'undefined') {
				window.lastReservationChangeByMe = true;
			}

			// 초기화된 데이터 저장
			Promise.resolve()
				.then(() => {
					const emptyData = {
						people: [],
						inactivePeople: [],
						requiredGroups: [],
						nextId: 1,
						forbiddenPairs: [],
						pendingConstraints: [],
						probabilisticForbiddenPairs: [],
						hiddenGroups: [],
						hiddenGroupChains: [],
						pendingHiddenGroups: [],
						pendingHiddenGroupChains: [],
						reservations: [],
						maxTeamSizeEnabled: false,
						genderBalanceEnabled: false,
						weightBalanceEnabled: false,
						membersPerTeam: 4,
						timestamp: getCurrentDbTimestamp()
					};
					return database.ref(`profiles/${currentProfileKey}`).set(emptyData);
				})
				.then(() => {
					// 로컬 state 초기화
					clearState();
					this.success(this.comments.clearComplete);
				})
				.catch((error) => {
					this.error(`초기화 실패: ${error.message}`);
				})
				.finally(() => {
					// 플래그 해제 (약간의 지연 후)
					setTimeout(() => {
						if (typeof window !== 'undefined') {
							window.lastReservationChangeByMe = false;
						}
					}, 100);
				});
			return;
		}

		const tokens = trimmedArgs.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
		const targets = new Set();

		const addTarget = (name) => targets.add(name);
		tokens.forEach((token) => {
			switch (token.toLowerCase()) {
				case '참가자':
				case 'member':
				case '멤버':
					addTarget('participants');
					break;
				case '미참가자':
				case 'people':
					addTarget('inactive');
					break;
				case '분리':
				case 'constraint':
					addTarget('constraints');
					break;
				case '옵션':
				case 'option':
					addTarget('options');
					break;
				case '확률':
				case '규칙':
				case 'rule':
				case 'matching':
					addTarget('rules');
					break;
				case '예약':
				case 'reservation':
					addTarget('reservations');
					break;
				default:
					break;
			}
		});

		if (targets.size === 0) {
			this.error('❌ 알 수 없는 초기화 대상입니다. 사용 가능한 대상: 참가자, 미참가자, 분리, 옵션, 확률, 규칙, 예약');
			return;
		}

		const labelMap = {
			participants: '참가자',
			inactive: '미참가자',
			constraints: '분리',
			options: '옵션',
			rules: '규칙/확률',
			reservations: '예약'
		};
		const targetLabels = Array.from(targets).map(key => labelMap[key]).join(', ');
		if (!confirm(`⚠️ 선택 초기화를 진행합니다: ${targetLabels}\n진행하시겠습니까?`)) {
			return;
		}

		const updateData = { timestamp: getCurrentDbTimestamp() };

		if (targets.has('participants')) {
			state.people = [];
			state.nextId = 1;
			updateData.people = [];
			updateData.nextId = 1;
		}
		if (targets.has('inactive')) {
			state.inactivePeople = [];
			updateData.inactivePeople = [];
		}
		if (targets.has('constraints')) {
			state.requiredGroups = [];
			state.forbiddenPairs = [];
			state.pendingConstraints = [];
			state.forbiddenMap = {};
			updateData.requiredGroups = [];
			updateData.forbiddenPairs = [];
			updateData.pendingConstraints = [];
		}
		if (targets.has('rules')) {
			state.hiddenGroups = [];
			state.hiddenGroupChains = [];
			state.pendingHiddenGroups = [];
			state.pendingHiddenGroupChains = [];
			state.activeHiddenGroupMap = {};
			state.activeHiddenGroupChainInfo = {};
			state.probabilisticForbiddenPairs = [];
			updateData.hiddenGroups = [];
			updateData.hiddenGroupChains = [];
			updateData.pendingHiddenGroups = [];
			updateData.pendingHiddenGroupChains = [];
			updateData.probabilisticForbiddenPairs = [];
		}
		if (targets.has('reservations')) {
			state.reservations = [];
			updateData.reservations = [];
		}
		if (targets.has('options')) {
			state.maxTeamSizeEnabled = false;
			state.genderBalanceEnabled = false;
			state.weightBalanceEnabled = false;
			state.membersPerTeam = 4;
			updateData.maxTeamSizeEnabled = false;
			updateData.genderBalanceEnabled = false;
			updateData.weightBalanceEnabled = false;
			updateData.membersPerTeam = 4;
			if (elements.maxTeamSizeCheckbox) elements.maxTeamSizeCheckbox.checked = false;
			if (elements.genderBalanceCheckbox) elements.genderBalanceCheckbox.checked = false;
			if (elements.weightBalanceCheckbox) elements.weightBalanceCheckbox.checked = false;
			if (elements.teamSizeInput) elements.teamSizeInput.value = 4;
		}

		buildForbiddenMap();
		renderPeople();
		saveToLocalStorage();
		tryResolvePendingConstraints();
		tryResolveHiddenGroups();

		if (typeof window !== 'undefined') {
			window.lastReservationChangeByMe = true;
		}

		database.ref(`profiles/${currentProfileKey}`).update(updateData)
			.then(() => {
				this.success('🗑️ 선택한 항목이 초기화되었습니다.');
			})
			.catch((error) => {
				this.error(`초기화 실패: ${error.message}`);
			})
			.finally(() => {
				if (typeof window !== 'undefined') {
					window.lastReservationChangeByMe = false;
				}
			});
	},
	statusCommand() {
		const ruleCount =
			(state.hiddenGroups?.length || 0) +
			(state.hiddenGroupChains?.length || 0) +
			(state.pendingHiddenGroups?.length || 0) +
			(state.pendingHiddenGroupChains?.length || 0) +
			(state.probabilisticForbiddenPairs?.length || 0);
		const reservationCount = state.reservations?.length || 0;
		const statusLines = [
			'=== 현재 상태 ===',
			`Profile Key: ${currentProfileKey || '없음'}`,
			`Firebase: ${syncEnabled ? '활성화' : '비활성화'}`,
			`참가자: ${state.people.length}명 <code data-cmd="참가자">참가자</code>`,
			`미참가자: ${state.inactivePeople.length}명 <code data-cmd="미참가자">미참가자</code>`,
			`분리: ${state.forbiddenPairs.length}개 <code data-cmd="분리">분리</code>`
		];

		if (this.authenticated) {
			statusLines.push(`규칙: ${ruleCount}개 <code data-cmd="확률">확률</code>`);
			statusLines.push(`예약: ${reservationCount}개 <code data-cmd="예약 목록">예약 목록</code>`);
		}

		this.log(statusLines.join('<br>'));
	},

	helpCommand() {
		let message = this.comments.helpMessage;
		// 인증되었을 때만 인증 필요 명령어 테이블 추가
		if (this.authenticated) {
			message += this.comments.helpMessageAuth;
		}
		this.log(message);
	},

	passwordCommand(newPassword) {

		// 현재 비밀번호가 없는지 확인
		if (!this.storedPassword || this.storedPassword === '') {
			// 비밀번호가 없으면 바로 새 비밀번호 입력 모드로
			this.log(this.comments.passwordChangeNew);
			this.inputMode = 'password-change-new';
			this.input.type = 'password';
			this.input.placeholder = this.placeholders.passwordChangeNew;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
			return;
		}

		// 인자가 제공된 경우 - 비밀번호 변경 플로우 시작
		if (newPassword && newPassword.trim()) {
			this.warn(this.comments.passwordChangeInteractive);
			this.log(this.comments.passwordCurrent);
			this.inputMode = 'password-change';
			this.input.type = 'password';
			this.input.placeholder = this.placeholders.passwordInput;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
		} else {
			// 인자가 없으면 비밀번호 변경 모드로 전환
			this.log(this.comments.passwordCurrent);
			this.inputMode = 'password-change';
			this.input.type = 'password';
			this.input.placeholder = this.placeholders.passwordInput;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
		}
	},

	loginCommand() {
		if (!currentProfileKey) {
			this.error('⚠️ 현재 프로필이 없어서 실행할 수 없습니다. 먼저 프로필을 선택하세요.');
			return;
		}

		if (typeof getCurrentProfileSource === 'function' && getCurrentProfileSource() === 'users') {
			this.authenticated = true;
			this.storedPassword = '';
			authenticatedPassword = 'users-auto-auth';
			const profileKeyDisplay = document.getElementById('profileKeyDisplay');
			if (profileKeyDisplay) profileKeyDisplay.classList.add('authenticated');
			this.log(this.comments.loginSuccess);
			return;
		}

		if (!syncEnabled) {
			this.error(this.comments.firebaseMissing);
			return;
		}

		if (this.authenticated) {
			this.log(this.comments.loginSuccess);
			return;
		}

		// 비밀번호 입력 모드로 전환
		this.log('🔒 비밀번호를 입력하세요:');
		this.inputMode = 'auth';
		this.input.type = 'password';
		this.input.placeholder = this.placeholders.passwordInput;
		this.addCancelButton();
		setTimeout(() => this.input.focus(), 50);
	},

	logoutCommand() {
		if (!currentProfileKey) {
			this.error('⚠️ 현재 프로필이 없어서 실행할 수 없습니다. 먼저 프로필을 선택하세요.');
			return;
		}

		if (typeof getCurrentProfileSource === 'function' && getCurrentProfileSource() === 'users') {
			this.authenticated = true;
			this.storedPassword = '';
			authenticatedPassword = 'users-auto-auth';
			const profileKeyDisplay = document.getElementById('profileKeyDisplay');
			if (profileKeyDisplay) profileKeyDisplay.classList.add('authenticated');
			this.log('ℹ️ users 상태에서는 항상 인증 모드가 유지됩니다.');
			return;
		}

		if (!syncEnabled) {
			this.error(this.comments.firebaseMissing);
			return;
		}

		if (!this.authenticated) {
			this.log(this.comments.readonlyMode);
			return;
		}

		// 쓰기 모드에서 읽기 모드로 전환
		this.authenticated = false;
		authenticatedPassword = ''; // 인증 해제

		// 프로필 배경색 업데이트
		const profileKeyDisplay = document.getElementById('profileKeyDisplay');
		if (profileKeyDisplay) {
			profileKeyDisplay.classList.remove('authenticated');
		}

		this.success(this.comments.logoutSuccess);
		this.log(this.comments.loginInstructions);
	},

	profileCommand() {
		if (!database && !initFirebase()) {
			this.error(this.comments.firebaseInitFailed + '.');
			return;
		}

		// 프로필 전환 모드로 진입
		this.log(this.comments.profileSwitch);
		this.inputMode = 'profile-switch';
		this.input.type = 'text';
		this.input.placeholder = this.placeholders.profile;
		this.addCancelButton();
		setTimeout(() => this.input.focus(), 50);
	},

	participantsCommand() {
		if (state.people.length === 0) {
			this.log(this.comments.noParticipants + '.');
			return;
		}

		let output = `<div style="margin: 10px 0;">
			<div style="font-weight: bold; margin-bottom: 8px;">=== 📋 참가자 목록 (${state.people.length}명) ===</div>
			<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
				<thead>
					<tr style="background: rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.2);">
						<th style="padding: 6px; text-align: center; width: 60px;">(index)</th>
						<th style="padding: 6px; text-align: left;">이름</th>
						<th style="padding: 6px; text-align: center; width: 60px;">성별</th>
						<th style="padding: 6px; text-align: center; width: 80px;">가중치</th>
						<th style="padding: 6px; text-align: left;">그룹</th>
					</tr>
				</thead>
				<tbody>`;

		state.people.forEach((person, index) => {
			const genderIcon = person.gender === 'male' ? '♂️' : person.gender === 'female' ? '♀️' : '?';
			const weight = person.weight || 0;
			const groups = state.requiredGroups
				.filter(group => group.includes(person.id))
				.map(group => {
					const otherIds = group.filter(id => id !== person.id);
					const otherNames = otherIds.map(id => {
						const p = state.people.find(per => per.id === id);
						return p ? p.name : '?';
					});
					return otherNames.join(', ');
				})
				.filter(g => g)
				.join(', ');

			const groupDisplay = groups ? `'${groups}'` : '';

			output += `
				<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
					<td style="padding: 6px; text-align: center; color: #94a3b8;">${index}</td>
					<td style="padding: 6px;">'${person.name}'</td>
					<td style="padding: 6px; text-align: center;">${genderIcon}</td>
					<td style="padding: 6px; text-align: center; color: ${weight > 0 ? '#a78bfa' : '#94a3b8'};">${weight}</td>
					<td style="padding: 6px; color: #6ee7b7;">${groupDisplay}</td>
				</tr>`;
		});

		output += `
				</tbody>
			</table>
		</div>`;

		this.log(output);
	},

	nonParticipantsCommand() {
		if (state.inactivePeople.length === 0) {
			this.log(this.comments.noInactiveParticipants + '.');
			return;
		}

		let output = `<div style="margin: 10px 0;">
			<div style="font-weight: bold; margin-bottom: 8px;">=== 🚫 미참가자 목록 (${state.inactivePeople.length}명) ===</div>
			<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
				<thead>
					<tr style="background: rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.2);">
						<th style="padding: 6px; text-align: center; width: 60px;">(index)</th>
						<th style="padding: 6px; text-align: left;">이름</th>
						<th style="padding: 6px; text-align: center; width: 60px;">성별</th>
						<th style="padding: 6px; text-align: center; width: 80px;">가중치</th>
					</tr>
				</thead>
				<tbody>`;

		state.inactivePeople.forEach((person, index) => {
			const genderIcon = person.gender === 'male' ? '♂️' : person.gender === 'female' ? '♀️' : '?';
			const weight = person.weight || 0;

			output += `
				<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
					<td style="padding: 6px; text-align: center; color: #94a3b8;">${index}</td>
					<td style="padding: 6px;">'${person.name}'</td>
					<td style="padding: 6px; text-align: center;">${genderIcon}</td>
					<td style="padding: 6px; text-align: center; color: ${weight > 0 ? '#a78bfa' : '#94a3b8'};">${weight}</td>
				</tr>`;
		});

		output += `
				</tbody>
			</table>
		</div>`;

		this.log(output);
	},

	constraintsCommand() {
		const totalConstraints = state.forbiddenPairs.length + state.pendingConstraints.length;

		if (totalConstraints === 0) {
			this.log(this.comments.noConstraints);
			return;
		}

		let output = `=== ⚠️ 분리 조건 (${totalConstraints}개) ===<br><br>`;

		// 활성 분리 (forbiddenPairs)
		if (state.forbiddenPairs.length > 0) {
			output += `<strong>⚠️ 활성 분리 (${state.forbiddenPairs.length}개):</strong><br>`;
			state.forbiddenPairs.forEach((pair, index) => {
				const personA = state.people.find(p => p.id === pair[0]);
				const personB = state.people.find(p => p.id === pair[1]);
				if (personA && personB) {
					output += `${index + 1}. ${personA.name} ⛔ ${personB.name}<br>`;
				}
			});
			output += '<br>';
		}

		// 보류 분리 (pendingConstraints)
		if (state.pendingConstraints.length > 0) {
			output += `<strong>? 보류 분리 (${state.pendingConstraints.length}개):</strong><br>`;
			state.pendingConstraints.forEach((constraint, index) => {
				output += `${index + 1}. ${constraint.left} ⛔ ${constraint.right}<br>`;
			});
		}

		this.log(output);
	},

	matchingCommand(ruleInput) {
		if (!this.hasWriteAccess()) {
			this.error(this.comments.ruleReadOnlyError);
			this.log(this.comments.authenticationRequired);
			return;
		}

		// 인자가 있으면 바로 규칙 등록
		if (ruleInput && ruleInput.trim()) {
			this.log(`> ${ruleInput}`, 'command');

			// 규칙 제거 명령어 체크
			const isRemoveCommand = /^([^()!]+)\(!\)/.test(ruleInput);

			// input 명령어를 통해 처리
			this.inputCommand(ruleInput, { isRuleInput: true });

			// 결과 메시지 출력
			if (isRemoveCommand) {
				this.success(this.comments.ruleRemoveSuccess);
			} else {
				this.success(this.comments.ruleAddSuccess);
			}

			// 확인하기 안내
			this.log(this.comments.matchingGroupsHelp);
			return;
		}

		// 인자가 없으면 입력 모드로 전환
		this.log(this.comments.matchingSetup);
		this.log(this.comments.matchingFormat);
		this.log(this.comments.probabilityExample);

		this.inputMode = 'matching';
		this.input.placeholder = this.placeholders.matchingRule;
		this.addCancelButton();
		setTimeout(() => this.input.focus(), 50);
	},

	generateCommand() {
		if (typeof shuffleTeams === 'function') {
			this.log(this.comments.teamGenerating);
			try {
				shuffleTeams();
				// shuffleTeams가 성공하면 cmd 콘솔에 결과가 출력됨
			} catch (error) {
				this.error(this.comments.teamGenerationFailed.replace('{error}', error.message));
			}
		} else {
			this.error(this.comments.shuffleFunctionMissing);
		}
	},

	hiddenCommand() {
		if (!this.hasWriteAccess()) {
			this.error(this.comments.ruleReadOnlyError);
			this.log(this.comments.authenticationRequired);
			return;
		}

		const totalHidden = state.hiddenGroups.length + state.hiddenGroupChains.length +
		                    state.pendingHiddenGroups.length + state.pendingHiddenGroupChains.length +
						(state.probabilisticForbiddenPairs?.length || 0);

		if (totalHidden === 0) {
			this.log(this.comments.noProbabilityRules);
			return;
		}

		let output = `<div style="margin: 10px 0;">
			<div style="font-weight: bold; margin-bottom: 8px;">📊 ${this.comments.probabilityRules} (${this.comments.ruleSetup} : <code data-cmd="규칙">규칙</code>)</div>`;

		const rows = [];
		const green = '#4ade80';
		const red = '#f87171';
		const dim = '#94a3b8';

		// 확률 기반 그룹 (hiddenGroups)
		state.hiddenGroups.forEach((group) => {
			const personA = state.people.find(p => p.id === group[0]);
			const personB = state.people.find(p => p.id === group[1]);
			const probability = group[2];
			if (personA && personB) {
				const displayPercent = probability > 1 ? Math.round(probability) : Math.round(probability * 100);
				rows.push({
					leftKey: `'${personA.name}'`,
					left: `'${personA.name}'`,
					right: `'${personB.name}'`,
					percent: displayPercent,
					color: green
				});
			}
		});

		// 확률 규칙 체인 (hiddenGroupChains)
		state.hiddenGroupChains.forEach((chain) => {
			const primaryPerson = state.people.find(p => p.name === chain.primary);
			const candidates = chain.candidates || [];
			const primaryName = primaryPerson ? primaryPerson.name : chain.primary;
			const primaryDisplay = primaryPerson ? `'${primaryName}'` : `<span style="color: ${dim};">'${primaryName}'</span>`;
			if (candidates.length > 0) {
				candidates.forEach((candidate, idx) => {
					const candidatePerson = state.people.find(p => p.name === candidate.name);
					const candidateName = candidatePerson ? candidatePerson.name : candidate.name;
					const candidateDisplay = candidatePerson ? `'${candidateName}'` : `<span style="color: ${dim};">'${candidateName}'</span>`;
					const displayPercent = Math.round(candidate.probability);
					rows.push({
						leftKey: primaryDisplay,
						left: idx === 0 ? primaryDisplay : '',
						right: candidateDisplay,
						percent: displayPercent,
						color: green
					});
				});
			}
		});

		// 보류 확률 규칙 (pendingHiddenGroups)
		state.pendingHiddenGroups.forEach((group) => {
			const displayPercent = Math.round(group.probability * 100);
			rows.push({
				leftKey: `<span style="color: ${dim};">'${group.left}' (보류)</span>`,
				left: `<span style="color: ${dim};">'${group.left}' (보류)</span>`,
				right: `<span style="color: ${dim};">'${group.right}'</span>`,
				percent: displayPercent,
				color: green
			});
		});

		// 보류 확률 기반 그룹 체인 (pendingHiddenGroupChains)
		state.pendingHiddenGroupChains.forEach((chain) => {
			const candidates = chain.candidates || [];
			if (candidates.length > 0) {
				candidates.forEach((candidate, idx) => {
					const displayPercent = candidate.probability > 1 ? Math.round(candidate.probability) : Math.round(candidate.probability * 100);
					const pendingLeft = `<span style="color: ${dim};">'${chain.primary}' (보류)</span>`;
					rows.push({
						leftKey: pendingLeft,
						left: idx === 0 ? pendingLeft : '',
						right: `<span style="color: ${dim};">'${candidate.name}'</span>`,
						percent: displayPercent,
						color: green
					});
				});
			}
		});

		// 확률 분리 규칙 (probabilisticForbiddenPairs)
		(state.probabilisticForbiddenPairs || []).forEach((rule) => {
			const leftName = rule.leftRaw || rule.left;
			const rightName = rule.rightRaw || rule.right;
			const leftPerson = findPersonByName(leftName);
			const rightPerson = findPersonByName(rightName);
			const leftDisplay = leftPerson ? `'${leftPerson.name}'` : `<span style="color: ${dim};">'${leftName}'</span>`;
			const rightDisplay = rightPerson ? `'${rightPerson.name}'` : `<span style="color: ${dim};">'${rightName}'</span>`;
			rows.push({
				leftKey: leftDisplay,
				left: leftDisplay,
				right: rightDisplay,
				percent: Math.round(rule.probability),
				color: red
			});
		});

		// 멤버A(leftKey) 기준으로 정렬 - 같은 멤버는 그룹화되어 표시
		rows.sort((a, b) => {
			// HTML 태그와 따옴표를 제거하여 순수 이름만 추출
			const getCleanKey = (key) => {
				if (!key) return '';
				return key.replace(/<[^>]*>/g, '').replace(/'/g, '').replace(/\(보류\)/g, '').trim();
			};

			const keyA = getCleanKey(a.leftKey);
			const keyB = getCleanKey(b.leftKey);

			return keyA.localeCompare(keyB, 'ko');
		});

		output += `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
			<thead>
				<tr style="background: rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.2);">
					<th style="padding: 6px; text-align: left;">${this.comments.memberA}</th>
					<th style="padding: 6px; text-align: left;">${this.comments.memberB}</th>
					<th style="padding: 6px; text-align: center; width: 80px;">${this.comments.probability}</th>
				</tr>
			</thead>
			<tbody>`;

		let prevLeftKey = null;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			let leftCell = '';
			if (row.leftKey && row.leftKey !== prevLeftKey) {
				let span = 1;
				for (let j = i + 1; j < rows.length; j++) {
					if (rows[j].leftKey && rows[j].leftKey === row.leftKey) {
						span++;
					} else {
						break;
					}
				}
				leftCell = `<td style="padding: 6px;" rowspan="${span}">${row.left}</td>`;
				prevLeftKey = row.leftKey;
			} else if (row.leftKey) {
				leftCell = '';
			} else if (row.left) {
				leftCell = `<td style="padding: 6px;">${row.left}</td>`;
			}
			output += `
				<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
					${leftCell}
					<td style="padding: 6px;">${row.right}</td>
					<td style="padding: 6px; text-align: center; color: ${row.color};">
						<span style="color: ${row.color}; margin-right: 4px;">●</span>${row.percent}%
					</td>
				</tr>`;
		}

		output += `
			</tbody>
		</table>
		</div>`;

		this.log(output);
	},

	inputCommand(data, options = {}) {
		// 참가자 추가 폼에 입력하는 것과 동일하게 처리
		if (!data || data.trim() === '') {
			// 데이터가 없으면 입력 모드로 전환
			this.log(this.comments.inputDataPrompt);
			this.inputMode = 'input-data';
			this.input.placeholder = this.placeholders.participantData;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
			return;
		}

		// nameInput에 값을 설정하고 addPerson 함수 호출
		if (typeof addPerson === 'function' && elements.nameInput) {
			const originalValue = elements.nameInput.value;
			elements.nameInput.value = data;
			const isRuleInput = options.isRuleInput === true || this.inputMode === 'matching';

			// addPerson 함수 실행 (fromConsole=true 전달)
			addPerson(true, { skipAutoDetect: isRuleInput });

			this.success(`${this.comments.participantAddComplete} ${data}`);
		} else {
			this.error(this.comments.participantAddDisabled);
		}
	},

	reservationCommand(args) {
		const normalizeReservations = (value) => {
			const toRow = (item) => {
				if (Array.isArray(item)) {
					return item.map((name) => String(name ?? '').trim()).filter((name) => name.length > 0);
				}
				if (typeof item === 'string') {
					return item.split(',').map((name) => name.trim()).filter((name) => name.length > 0);
				}
				return [];
			};
			if (Array.isArray(value)) {
				return value.map(toRow).filter((row) => row.length > 0);
			}
			if (value && typeof value === 'object') {
				return Object.values(value).map(toRow).filter((row) => row.length > 0);
			}
			return [];
		};

		state.reservations = normalizeReservations(state.reservations);
		const trimmedArgs = String(args || '').trim();

		// 예약 목록 보기
		if (trimmedArgs === '목록') {
			if (state.reservations.length === 0) {
				this.log(commandConsoleMessages.comments.reservationEmpty);
			} else {
				let listMessage = commandConsoleMessages.comments.reservationList.replace('{count}', state.reservations.length) + '<br>';
				state.reservations.forEach((reservation, index) => {
					listMessage += commandConsoleMessages.comments.reservationListItem
						.replace('{index}', index + 1)
						.replace('{members}', reservation.join(', ')) + '<br>';
				});
				this.log(listMessage);
			}
			return;
		}

		// 인증 체크 (목록 조회 제외)
		if (!this.hasWriteAccess()) {
			this.error(this.comments.readOnlyFeatureDisabled);
			this.log(this.comments.authenticationRequired);
			return;
		}

	// 예약 취소 (마지막 예약 제거)
	if (trimmedArgs === '취소') {
		if (state.reservations.length === 0) {
				this.error(commandConsoleMessages.comments.reservationCancelFailed);
			} else {
				const removed = state.reservations.pop();
				this.success(commandConsoleMessages.comments.reservationCanceled.replace('{members}', removed.join(', ')));
				saveToLocalStorage();
			}
			return;
		}

		// 예약 초기화
		if (trimmedArgs === '초기화') {
			state.reservations = [];
			this.success(commandConsoleMessages.comments.reservationCleared);
			saveToLocalStorage();
			return;
		}

		// 예약 우선 추가 (맨 앞에 삽입)
		if (trimmedArgs.startsWith('우선 ')) {
			const namesStr = trimmedArgs.substring(3).trim();
			if (namesStr) {
				const names = namesStr.split(',').map(n => n.trim()).filter(n => n);
				if (names.length === 0) {
					this.error(commandConsoleMessages.comments.reservationInvalidFormat);
				} else {
					state.reservations.unshift(names);  // 맨 앞에 추가
					this.success(commandConsoleMessages.comments.reservationPriorityAdded.replace('{members}', names.join(', ')));
					saveToLocalStorage();
				}
			}
			return;
		}

		// 예약 등록 (A,B,C,D 형태 감지)
		if (trimmedArgs.includes(',') || trimmedArgs.length > 0) {
			const names = trimmedArgs.split(',').map(n => n.trim()).filter(n => n);
			if (names.length === 0) {
				// 데이터가 없으면 예약 모드로 진입
				this.log(commandConsoleMessages.comments.reservationModeEnter);
				this.inputMode = 'reservation';
				this.input.placeholder = this.placeholders.reservation;
				this.addCancelButton();
				setTimeout(() => this.input.focus(), 50);
			} else {
				// 바로 예약 등록
				state.reservations.push(names);
				this.success(commandConsoleMessages.comments.reservationAdded.replace('{members}', names.join(', ')));
				saveToLocalStorage();
			}
			return;
		}

		// 인자가 없으면 예약 모드 진입
		if (trimmedArgs === '') {
			this.log(commandConsoleMessages.comments.reservationModeEnter);
			this.inputMode = 'reservation';
			this.input.placeholder = this.placeholders.reservation;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
			return;
		}
	},

	deleteCommand() {
		if (!syncEnabled || !currentProfileKey) {
			this.error(this.comments.firebaseMissing);
			return;
		}

		if (!this.hasWriteAccess()) {
			this.error(this.comments.deleteReadOnlyError);
			this.log(this.comments.authenticationRequired);
			return;
		}

		this.warn(this.comments.profileDeleteAttemptMessage.replace('{profile}', currentProfileKey));
		this.warn(this.comments.deleteWarning);

		// 비밀번호가 있는지 확인
		if (this.storedPassword && this.storedPassword !== '') {
			// 비밀번호가 있으면 비밀번호 입력 모드
			this.log(this.comments.passwordConfirmPrompt);
			this.inputMode = 'delete-password-confirm';
			this.input.type = 'password';
			this.input.placeholder = this.placeholders.passwordInput;
			this.addCancelButton();
			setTimeout(() => this.input.focus(), 50);
		} else {
			// 비밀번호가 없으면 확인/취소 버튼 표시
			// this.warn('삭제하시겠습니까?');
			this.inputMode = 'delete-confirm';
			this.showConfirmButtons();
		}
	}
};

console = commandConsole;
