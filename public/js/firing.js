/**
 * firing.js
 * Centralized firing system for "Infinite Battle".
 * Handles: Input check, Raycasting, Visuals (Tracers), and Network Events.
 */

window.FiringSystem = {
    bullets: [], // Array of active visual bullets/tracers
    lastFireTime: 0,
    hasFiredThisTrigger: false, // For single-shot weapons like Sniper

    // Config
    DEFAULT_FIRE_RATE: 0.15, // Seconds
    TRACER_SPEED: 100, // Units per second
    MAX_RANGE: 100, // Units

    // Recoil Config
    RECOIL_KICK: 0.04, // How much camera kicks up per shot (radians)
    RECOIL_RECOVERY_SPEED: 8, // How fast camera recovers
    currentRecoil: 0, // Current recoil offset applied to pitch

    // Audio
    sfxShoot: null,

    init: function (scene) {
        this.scene = scene;
        console.log("FiringSystem Initialized");

        // Load Audio
        this.sfxShoot = new Audio('sound-effect/jumpland.wav'); // Placeholder until gunshot_legacy.mp3 is added
    },

    update: function (dt) {
        this.handleInput(dt);
        this.updateBullets(dt);
        this.updateRecoil(dt);
    },

    updateRecoil: function (dt) {
        // Apply recoil to the equipped gun
        if (this.currentRecoil > 0 && window.myPlayerMesh) {
            const ud = window.myPlayerMesh.userData;

            if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                const gun = ud.backGuns[ud.equippedSlot];

                // Store original rotation if not stored
                if (gun.userData.baseRotationX === undefined) {
                    gun.userData.baseRotationX = gun.rotation.x;
                }

                // Apply recoil kick (rotate gun backward/upward)
                gun.rotation.x = gun.userData.baseRotationX - this.currentRecoil;
            }

            // Decay recoil for next frame
            this.currentRecoil *= 0.7; // Smooth decay

            // Clear tiny values and reset gun rotation
            if (this.currentRecoil < 0.005) {
                this.currentRecoil = 0;

                // Reset gun to base rotation
                const ud2 = window.myPlayerMesh.userData;
                if (ud2.equippedSlot !== null && ud2.backGuns && ud2.backGuns[ud2.equippedSlot]) {
                    const gun = ud2.backGuns[ud2.equippedSlot];
                    if (gun.userData.baseRotationX !== undefined) {
                        gun.rotation.x = gun.userData.baseRotationX;
                    }
                }
            }
        }
    },

    handleInput: function (dt) {
        if (!window.myPlayerMesh || window.myPlayerMesh.userData.isDead) return;
        if (!window.Controls) return;

        // Check Input
        if (window.Controls.isFiring) {
            this.attemptShoot();
        } else {
            // Reset single-shot flag when trigger is released
            this.hasFiredThisTrigger = false;
        }
    },

    attemptShoot: function () {
        const now = Date.now() / 1000;

        // Get current weapon spec
        let fireRate = this.DEFAULT_FIRE_RATE;
        let isAutomatic = true;

        if (window.myPlayerMesh && window.myPlayerMesh.userData) {
            const ud = window.myPlayerMesh.userData;
            if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                const gun = ud.backGuns[ud.equippedSlot];
                const type = gun.userData.pickupType || 'MPSD';
                const spec = window.WEAPON_SPECS ? window.WEAPON_SPECS[type] : null;

                if (spec) {
                    if (spec.fireRate !== undefined) fireRate = spec.fireRate;
                    if (spec.isAutomatic !== undefined) isAutomatic = spec.isAutomatic;
                }
            }
        }

        // For non-automatic weapons (like Sniper), require trigger release between shots
        if (!isAutomatic) {
            if (this.hasFiredThisTrigger) return; // Already fired this trigger press
            // Don't set flag yet - wait until after shot fires
        }

        // Fire Rate Check
        if (now - this.lastFireTime < fireRate) return;

        this.lastFireTime = now;

        // EXECUTE SHOT
        this.executeShot(true); // isLocal = true

        // Mark single-shot weapons as fired AFTER shot executes
        // This allows firing pose to show briefly before switching back
        if (!isAutomatic) {
            // Use a small delay so the firing pose shows momentarily
            setTimeout(() => {
                this.hasFiredThisTrigger = true;
            }, 100); // 100ms delay to show firing pose
        }
    },

    // Main Shot Logic (Called by local input OR network event)
    executeShot: function (isLocal, shooterMesh) {
        let startPos = new THREE.Vector3();
        let direction = new THREE.Vector3();
        let aimTarget = null; // Store for visual tracer

        // --- A. DETERMINE ORIGIN & DIRECTION ---
        let logicalStart = new THREE.Vector3();
        let logicalDir = new THREE.Vector3();

        if (isLocal) {
            // My Player: Logical shot comes from Camera center for 100% accuracy
            if (!window.camera || !window.myPlayerMesh) return;

            window.camera.getWorldPosition(logicalStart);
            window.camera.getWorldDirection(logicalDir);

            // 1. Calculate Aim Target (Where Camera is looking at Max Range)
            aimTarget = logicalStart.clone().add(logicalDir.clone().multiplyScalar(this.MAX_RANGE));

            // 2. Determine Start Position for Visuals (Gun Muzzle)
            const ud = window.myPlayerMesh.userData;
            let visualOriginFound = false;

            if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                const gun = ud.backGuns[ud.equippedSlot];
                const type = gun.userData.pickupType || 'MPSD';
                const spec = window.WEAPON_SPECS ? window.WEAPON_SPECS[type] : null;

                if (spec && spec.shoot && spec.shoot.muzzlePos) {
                    startPos.copy(spec.shoot.muzzlePos).applyMatrix4(gun.matrixWorld);
                    visualOriginFound = true;
                } else {
                    const flash = gun.getObjectByName('MuzzleFlash') || gun.getObjectByName('flash');
                    if (flash) {
                        flash.getWorldPosition(startPos);
                        visualOriginFound = true;
                    } else {
                        gun.getWorldPosition(startPos);
                        const gunForward = new THREE.Vector3();
                        gun.getWorldDirection(gunForward);
                        startPos.add(gunForward.multiplyScalar(0.8));
                        visualOriginFound = true;
                    }
                }
            }

            if (!visualOriginFound) {
                startPos.copy(logicalStart);
            }

            // Network Sync
            if (window.Network) Network.sendShoot();

            // Muzzle Flash (Local)
            this.triggerMuzzleFlash(window.myPlayerMesh);

            // Recoil
            if (window.myPlayerMesh.userData) {
                const ud = window.myPlayerMesh.userData;
                ud.currentRecoil = (ud.currentRecoil || 0) + 0.2;

                // Get weapon type for shoot timer duration
                let shootTimerDuration = 0.3; // Default for rapid fire weapons
                if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                    const gun = ud.backGuns[ud.equippedSlot];
                    const type = gun.userData.pickupType || 'MPSD';
                    const spec = window.WEAPON_SPECS ? window.WEAPON_SPECS[type] : null;

                    // For non-automatic weapons (sniper), use longer timer to show full recoil then reset
                    if (spec && !spec.isAutomatic) {
                        shootTimerDuration = 0.5; // Longer recoil animation for sniper
                    }
                }

                ud.shootTimer = shootTimerDuration;
                this.currentRecoil += this.RECOIL_KICK;
            }

        } else {
            // Remote Player: Shoot from Gun Muzzle
            if (!shooterMesh) return;
            const ud = shooterMesh.userData;
            if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                const gun = ud.backGuns[ud.equippedSlot];
                const muzzleOffset = new THREE.Vector3(0, 0, 0.9);
                startPos.copy(muzzleOffset).applyMatrix4(gun.matrixWorld);

                const gunPos = new THREE.Vector3();
                gun.getWorldPosition(gunPos);
                direction.subVectors(startPos, gunPos).normalize();
            } else {
                shooterMesh.getWorldPosition(startPos);
                startPos.y += 1.5;
                shooterMesh.getWorldDirection(direction);
            }
            logicalStart.copy(startPos);
            logicalDir.copy(direction);
            this.triggerMuzzleFlash(shooterMesh);
        }

        // --- B. AUDIO ---
        // Simple clone and play
        if (this.sfxShoot) {
            const s = this.sfxShoot.cloneNode();
            s.volume = isLocal ? 0.3 : 0.1; // Louder for self
            s.play().catch(e => { });
        }

        // --- C. RAYCAST (Hit Detection) ---
        // Only Local Player calculates hits
        let hitPoint = null;
        let hitTarget = null;

        if (isLocal) {
            const raycaster = new THREE.Raycaster();
            raycaster.set(logicalStart, logicalDir); // Use camera ray for perfect aim
            raycaster.far = this.MAX_RANGE;

            // Collect Targets (Other Players)
            let meshes = [];
            let meshToId = {};
            if (window.otherPlayers) {
                Object.keys(window.otherPlayers).forEach(id => {
                    meshes.push(window.otherPlayers[id]);
                    meshToId[window.otherPlayers[id].uuid] = id;
                });
            }

            // Add World Items? (Barrels etc) - Future

            const intersects = raycaster.intersectObjects(meshes, true);

            if (intersects.length > 0) {
                hitPoint = intersects[0].point;
                let obj = intersects[0].object;

                // Detect Headshot by checking hit object name
                let isHeadshot = false;
                let checkBone = obj;
                while (checkBone) {
                    const name = checkBone.name ? checkBone.name.toLowerCase() : '';
                    if (name.includes('head')) {
                        isHeadshot = true;
                        break;
                    }
                    checkBone = checkBone.parent;
                }

                // Find Root Player by traversing up and checking against otherPlayers
                let foundId = null;
                let checkObj = obj;

                // First: Check if any parent in the chain is in otherPlayers
                while (checkObj && !foundId) {
                    // Check if this object is a root player mesh
                    Object.keys(window.otherPlayers).forEach(id => {
                        if (window.otherPlayers[id] === checkObj) {
                            foundId = id;
                        }
                    });
                    checkObj = checkObj.parent;
                }

                // Fallback: Check original UUID mapping
                if (!foundId) {
                    // Traverse up to find mesh in meshToId
                    checkObj = obj;
                    while (checkObj && !foundId) {
                        if (meshToId[checkObj.uuid]) {
                            foundId = meshToId[checkObj.uuid];
                        }
                        checkObj = checkObj.parent;
                    }
                }

                // Get current weapon type
                let weaponType = 'MPSD';
                const ud = window.myPlayerMesh.userData;
                if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
                    weaponType = ud.backGuns[ud.equippedSlot].userData.pickupType || 'MPSD';
                }

                if (foundId) {
                    hitTarget = foundId;
                    // HIT!
                    console.log("HIT DETECTED:", foundId, "at", intersects[0].point, isHeadshot ? "(HEADSHOT!)" : "(body)");
                    this.onHit(foundId, intersects[0].point, weaponType, isHeadshot);
                }
            }
        }

        // --- D. VISUAL TRACER ---
        // Determine end point for tracer
        let endPos = new THREE.Vector3();
        if (hitPoint) {
            endPos.copy(hitPoint);
        } else if (isLocal && aimTarget) {
            // Use exact aim target for local player (where crosshair points)
            endPos.copy(aimTarget);
        } else {
            // Remote player or fallback: Start + (Direction * Range)
            // Use logicalDir if available, else direction
            const dir = (logicalDir.length() > 0) ? logicalDir : direction;
            endPos.copy(startPos).add(dir.clone().multiplyScalar(this.MAX_RANGE));
        }

        // Visual start is already startPos (muzzle position)
        this.spawnTracer(startPos, endPos);
    },

    onHit: function (targetId, point, weaponType = 'MPSD', isHeadshot = false) {
        // Get damage from weapon specs
        const spec = window.WEAPON_SPECS ? window.WEAPON_SPECS[weaponType] : null;
        let damage = 10; // Default fallback

        if (spec && spec.damage) {
            damage = isHeadshot ? spec.damage.head : spec.damage.body;
        }

        console.log("HIT PLAYER:", targetId, "Weapon:", weaponType, "Headshot:", isHeadshot, "Damage:", damage);

        // 1. Network Send
        if (window.Network) Network.sendHit(targetId, damage);

        // 2. Visual Number (Pass isHeadshot for red color)
        if (window.spawnDamagePopup) {
            window.spawnDamagePopup(point, damage, isHeadshot);
        }
    },

    triggerMuzzleFlash: function (characterMesh) {
        if (!characterMesh || !characterMesh.userData) return;

        const ud = characterMesh.userData;

        // 1. Find the Gun
        if (ud.equippedSlot !== null && ud.backGuns && ud.backGuns[ud.equippedSlot]) {
            const gun = ud.backGuns[ud.equippedSlot];

            // 2. Find the Flash Object (Lazy load if not cached)
            // We cache it on the gun userData to avoid traversal every frame
            if (!gun.userData.muzzleFlashObj) {
                gun.userData.muzzleFlashObj = gun.getObjectByName('MuzzleFlash') || gun.getObjectByName('flash');
            }

            const flashObj = gun.userData.muzzleFlashObj;

            if (flashObj) {
                // 3. Link to Character for Animation Loop
                // The game loop in game.js checks characterMesh.userData.muzzleFlash
                ud.muzzleFlash = flashObj;

                // 4. Trigger Animation
                // shootTimer > 0 makes game.js set visible = true (and keep pose)
                ud.shootTimer = 0.3; // Longer duration to bridge gaps between bullets
            }
        }
    },

    spawnTracer: function (start, end) {
        // Create a simple yellow tube or line
        // Line is faster
        const geometry = new THREE.BufferGeometry().setFromPoints([start, start]); // Start as point
        const material = new THREE.LineBasicMaterial({ color: 0xffffaa, linewidth: 2 });
        const line = new THREE.Line(geometry, material);

        this.scene.add(line);

        this.bullets.push({
            mesh: line,
            start: start.clone(),
            end: end.clone(),
            progress: 0,
            speed: 2.0 // Multiplier for Lerp, or use distance/speed
        });
    },

    updateBullets: function (dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.progress += dt * 4.0; // Fast speed

            if (b.progress >= 1.0) {
                // Done
                this.scene.remove(b.mesh);
                this.bullets.splice(i, 1);
            } else {
                // Animate Tail?
                // For a tracer, we want head to move to target, tail to follow.

                // Simple Beam: Just draw line from Start to Lerp(Start, End, Progress)
                // Better: Draw line from Lerp(Start, End, Progress-Length) to Lerp(Start, End, Progress)

                const currentPos = new THREE.Vector3().lerpVectors(b.start, b.end, b.progress);

                // Update Geometry
                // We need to access position attribute
                const positions = b.mesh.geometry.attributes.position.array;

                // Point 0 (Tail)
                // Let tail lag behind
                const tailProgress = Math.max(0, b.progress - 0.2);
                const tailPos = new THREE.Vector3().lerpVectors(b.start, b.end, tailProgress);

                positions[0] = tailPos.x;
                positions[1] = tailPos.y;
                positions[2] = tailPos.z;

                // Point 1 (Head)
                positions[3] = currentPos.x;
                positions[4] = currentPos.y;
                positions[5] = currentPos.z;

                b.mesh.geometry.attributes.position.needsUpdate = true;
            }
        }
    }
};
