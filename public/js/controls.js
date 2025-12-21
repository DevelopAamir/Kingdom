/**
 * controls.js
 * Handles Keyboard (WASD), Mouse (PointerLock), and Touch (Nipple.js) inputs.
 * Exposes a clean API for the game loop.
 */

window.Controls = {
    keys: { w: false, a: false, s: false, d: false, ' ': false, Shift: false },
    isFiring: false,
    isLocked: false,
    pitchObject: null,
    yawObject: null,
    camera: null,

    // Joystick State
    joystickVector: { x: 0, y: 0 },
    isSprintToggled: false, // Mobile toggle
    isJoystickActive: false, // Track if joystick is currently being used
    isScoped: false, // Scope/ADS state
    defaultFOV: 75, // Default camera FOV

    // Init Listeners
    init: function (camera, yawObject, pitchObject) {
        this.camera = camera;
        this.yawObject = yawObject;
        this.pitchObject = pitchObject;

        // --- PC INPUTS ---
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mousedown', (e) => this.onMouseDown(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));

        // Prevent right-click context menu (for scope)
        document.addEventListener('contextmenu', (e) => {
            if (this.isLocked) e.preventDefault();
        });

        // Pointer Lock Change
        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === document.body) {
                this.isLocked = true;
                const ps = document.getElementById('pause-screen');
                if (ps) ps.style.display = 'none';
            } else {
                this.isLocked = false;
                const ui = document.getElementById('ui-layer');
                const ps = document.getElementById('pause-screen');
                // Only show pause if logged in (UI visible) and not calibration mode
                if (ui && ui.style.display === 'block' && !window.isCalibrationMode) {
                    if (ps) ps.style.display = 'flex';
                }
            }
        });

        // --- MOBILE INPUTS ---
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isMobile) {
            this.initMobileControls();
        }
    },

    // --- KEYBOARD HANDLERS ---
    onKeyDown: function (e) {
        const key = e.key.toLowerCase();

        // Check if player is dead - disable all actions
        const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
        if (isDead) return; // Ignore all input when dead

        // Toggle Camera
        if (key === 'c' && window.toggleCamera) window.toggleCamera();

        // Weapon Toggles (1, 2, 3, 4...)
        if (key === '1' && window.toggleWeapon) window.toggleWeapon(0);
        if (key === '2' && window.toggleWeapon) window.toggleWeapon(1);
        if (key === '3' && window.toggleWeapon) window.toggleWeapon(2);
        if (key === '4' && window.toggleWeapon) window.toggleWeapon(3);

        // Reload (R key)
        if (key === 'r' && window.FiringSystem) window.FiringSystem.reload();

        if (key === ' ') this.keys[' '] = true;
        else if (key === 'shift') {
            if (!e.repeat) {
                this.isSprintToggled = !this.isSprintToggled; // Toggle Logic
                this.syncRunButton();
            }
        } else if (this.keys.hasOwnProperty(key)) {
            this.keys[key] = true;
            // Cancel Auto-Run on Manual Move
            if (['w', 'a', 's', 'd'].includes(key)) {
                this.isSprintToggled = false;
                this.syncRunButton();
            }
        }
    },

    onKeyUp: function (e) {
        const key = e.key.toLowerCase();
        if (key === ' ') this.keys[' '] = false;
        else if (this.keys.hasOwnProperty(key)) this.keys[key] = false;
    },

    // --- MOUSE HANDLERS ---
    onMouseMove: function (e) {
        // Check if player is dead - disable look
        const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
        if (isDead) return;

        if (this.isLocked && this.yawObject && this.pitchObject) {
            this.yawObject.rotation.y -= e.movementX * 0.002;
            this.pitchObject.rotation.x -= e.movementY * 0.002;
            // Clamp Pitch
            this.pitchObject.rotation.x = Math.max(-0.5, Math.min(Math.PI / 3, this.pitchObject.rotation.x));
        }
    },

    onMouseDown: function (e) {
        console.log('[Controls] onMouseDown button:', e.button, 'isLocked:', this.isLocked);

        // Check if player is dead - disable firing
        const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
        if (isDead) return;

        if (this.isLocked) {
            if (e.button === 0) { // Left click - fire
                this.isFiring = true;
            } else if (e.button === 2) { // Right click - scope
                console.log('[Controls] Right click detected, calling toggleScope');
                this.toggleScope();
            }
        } else {
            // Try to lock on click if appropriate (e.g. valid game state)
            if (document.body.requestPointerLock && !window.isCalibrationMode) {
                // document.body.requestPointerLock();
            }
        }
    },

    onMouseUp: function (e) {
        if (e.button === 0) { // Left click
            this.isFiring = false;
        }
        // Right click scope toggle is on mousedown, not mouseup
    },

    // --- SCOPE TOGGLE ---
    toggleScope: function () {
        console.log('[Controls] toggleScope called');

        // Get weapon type if equipped using correct data structure
        let gunType = '';
        let hasWeapon = false;

        if (window.myPlayerMesh && window.myPlayerMesh.userData) {
            const ud = window.myPlayerMesh.userData;
            if (ud.equippedSlot !== null && ud.equippedSlot !== undefined && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                const gun = ud.backGuns[ud.equippedSlot];
                gunType = gun.userData?.pickupType || '';
                hasWeapon = true;
            }
        }
        console.log('[Controls] Gun type:', gunType, 'hasWeapon:', hasWeapon);

        // Require weapon to be equipped to scope
        if (!hasWeapon) {
            console.log('[Controls] No weapon equipped, cannot scope');
            return;
        }

        this.isScoped = !this.isScoped;
        console.log('[Controls] isScoped:', this.isScoped);

        const overlay = document.getElementById('scope-overlay');
        const crosshair = document.getElementById('crosshair');
        const zoomLabel = document.getElementById('scope-zoom-label');

        if (this.isScoped) {
            // Determine zoom level by weapon type
            let zoomFOV = 40; // Default 4x
            let zoomText = '4x';

            console.log('[Controls] Checking gun type for scope:', gunType);

            if (gunType === 'Sniper' || gunType.toLowerCase().includes('sniper')) {
                zoomFOV = 10; // 8x scope for sniper
                zoomText = '8x';
                console.log('[Controls] Sniper detected - 8x zoom');
            } else if (gunType === 'MPSD' || gunType.toLowerCase().includes('mpsd')) {
                zoomFOV = 20; // 4x scope for MPSD
                zoomText = '4x';
                console.log('[Controls] MPSD detected - 4x zoom');
            }

            // Apply zoom
            if (this.camera) {
                this.camera.fov = zoomFOV;
                this.camera.updateProjectionMatrix();
            }

            // Show scope overlay
            if (overlay) overlay.style.display = 'block';
            if (crosshair) crosshair.style.visibility = 'hidden'; // Use visibility to preserve layout
            if (zoomLabel) zoomLabel.textContent = zoomText;
        } else {
            // Reset to default FOV
            if (this.camera) {
                this.camera.fov = this.defaultFOV;
                this.camera.updateProjectionMatrix();
            }

            // Hide scope overlay
            if (overlay) overlay.style.display = 'none';
            if (crosshair) crosshair.style.visibility = 'visible'; // Restore crosshair
        }
    },

    // API to check scope state
    getIsScoped: function () {
        return this.isScoped;
    },

    // Unscope (for sniper after shot)
    unscope: function () {
        if (this.isScoped) {
            this.toggleScope();
        }
    },

    // --- MOBILE CONTROLS ---
    initMobileControls: function () {
        const zone = document.getElementById('joystick-zone');
        if (!zone) return;

        // Nipple.js
        const manager = nipplejs.create({
            zone: zone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white'
        });

        manager.on('move', (evt, data) => {
            // Check if player is dead - disable joystick
            const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
            if (isDead) return;

            // Mark joystick as active
            this.isJoystickActive = true;

            const forward = data.vector.y;
            const turn = data.vector.x;

            // Map Joystick to Keys
            if (forward > 0.5) { this.keys.w = true; this.keys.s = false; }
            else if (forward < -0.5) { this.keys.s = true; this.keys.w = false; }
            else { this.keys.w = false; this.keys.s = false; }

            if (turn > 0.5) { this.keys.d = true; this.keys.a = false; }
            else if (turn < -0.5) { this.keys.a = true; this.keys.d = false; }
            else { this.keys.a = false; this.keys.d = false; }
        });

        manager.on('end', () => {
            this.keys.w = false; this.keys.s = false;
            this.keys.a = false; this.keys.d = false;
            // Mark joystick as inactive
            this.isJoystickActive = false;
        });

        manager.on('start', () => {
            this.isSprintToggled = false; // Cancel auto-run
            this.syncRunButton();
        });

        // Touch Look
        this.initTouchLook();

        // Buttons
        const fireBtn = document.getElementById('mobile-fire-btn');
        if (fireBtn) {
            fireBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
                if (!isDead) this.isFiring = true;
            });
            fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.isFiring = false; });
        }

        const jumpBtn = document.getElementById('jump-btn');
        if (jumpBtn) {
            jumpBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
                if (!isDead) this.keys[' '] = true;
            });
            jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.keys[' '] = false; });
        }

        const runBtn = document.getElementById('run-btn');
        if (runBtn) {
            runBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
                if (isDead) return;

                // Ignore run button if joystick is active (joystick has priority)
                if (this.isJoystickActive) return;

                this.isSprintToggled = !this.isSprintToggled;
                this.keys.Shift = this.isSprintToggled;
                this.syncRunButton();
            });
        }

        // Scope button (mobile)
        const scopeBtn = document.getElementById('scope-btn');
        if (scopeBtn) {
            scopeBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
                if (!isDead) this.toggleScope();
            });
        }

        // Reload button (mobile)
        const reloadBtn = document.getElementById('reload-btn');
        if (reloadBtn) {
            reloadBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
                if (!isDead && window.FiringSystem) window.FiringSystem.reload();
            });
        }

        // Weapon Selection
        const w1 = document.getElementById('mobile-weapon-1');
        if (w1) w1.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
            if (!isDead && window.toggleWeapon) window.toggleWeapon(0);
        });

        const w2 = document.getElementById('mobile-weapon-2');
        if (w2) w2.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
            if (!isDead && window.toggleWeapon) window.toggleWeapon(1);
        });

        // Cam
        const cam = document.getElementById('mobile-cam-btn');
        if (cam) cam.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const isDead = window.myPlayerMesh && window.myPlayerMesh.userData && window.myPlayerMesh.userData.isDead;
            if (!isDead && window.toggleCamera) window.toggleCamera();
        });

        // Show UI
        const mc = document.getElementById('mobile-controls');
        if (mc) mc.style.display = 'block';
    },

    initTouchLook: function () {
        letlookTouchId = null;
        let lastTouchX = 0;
        let lastTouchY = 0;

        document.addEventListener('touchstart', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.clientX > window.innerWidth / 2) {
                    lookTouchId = t.identifier;
                    lastTouchX = t.clientX;
                    lastTouchY = t.clientY;
                    break;
                }
            }
        });

        document.addEventListener('touchmove', (e) => {
            if (lookTouchId !== null && this.yawObject && this.pitchObject) {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i];
                    if (t.identifier === lookTouchId) {
                        const dx = t.clientX - lastTouchX;
                        const dy = t.clientY - lastTouchY;

                        this.yawObject.rotation.y -= dx * 0.005;
                        this.pitchObject.rotation.x -= dy * 0.005;
                        this.pitchObject.rotation.x = Math.max(-0.5, Math.min(Math.PI / 3, this.pitchObject.rotation.x));

                        lastTouchX = t.clientX;
                        lastTouchY = t.clientY;
                        break;
                    }
                }
            }
        });

        document.addEventListener('touchend', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === lookTouchId) {
                    lookTouchId = null;
                }
            }
        });
    },

    syncRunButton: function () {
        const runBtn = document.getElementById('run-btn');
        if (runBtn) {
            // Need accurate state. 
            // In hybrid mode, specific key logic handles this.
            // Just visual.
            const active = this.keys.Shift || this.isSprintToggled;
            runBtn.style.background = active ? 'rgba(200, 0, 0, 0.8)' : 'rgba(255, 165, 0, 0.5)';
            runBtn.style.border = active ? '3px solid yellow' : '2px solid white';
        }
    },

    // --- API FOR GAME LOOP ---
    getMovementDirection: function () {
        // Return 0-1 values for W/A/S/D
        // Returning boolean map for now as `game.js` expects it
        // Or better, return { forward: bool, back: bool, left: bool, right: bool }
        return {
            w: this.keys.w || (this.isSprintToggled), // Auto-run implies W
            s: this.keys.s,
            a: this.keys.a,
            d: this.keys.d,
            space: this.keys[' '],
            shift: this.isSprintToggled
        };
    },

    getIsFiring: function () {
        return this.isFiring;
    }
};
