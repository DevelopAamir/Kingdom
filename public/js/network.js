/* NETWORK MODULE */

window.Network = {
    socket: null,

    init: function () {
        this.socket = io();

        // --- AUTHENTICATION LISTENERS ---
        this.socket.on('authError', (data) => {
            document.getElementById('auth-msg').innerText = data.message;
        });

        this.socket.on('authSuccess', (data) => {
            document.getElementById('auth-msg').style.color = "lightgreen";
            document.getElementById('auth-msg').innerText = data.message;
        });

        this.socket.on('loginSuccess', (data) => {
            // data.player contains my starting stats
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block';

            // Pointer Lock Setup
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            if (!isMobile) {
                document.body.requestPointerLock = document.body.requestPointerLock || document.body.mozRequestPointerLock;
                document.addEventListener('pointerlockchange', () => {
                    if (document.pointerLockElement === document.body) {
                        document.getElementById('pause-screen').style.display = 'none';
                    } else {
                        // Check if logged in before showing pause
                        if (document.getElementById('ui-layer').style.display === 'block' && !window.isCalibrationMode) {
                            document.getElementById('pause-screen').style.display = 'flex';
                        }
                    }
                });
            } else {
                document.getElementById('pause-screen').style.display = 'none';
            }

            // Start in "Paused" state so user clicks to capture mouse (PC only)
            if (!isMobile) {
                document.getElementById('pause-screen').style.display = 'flex';
            }

            initGame(data.player);
        });

        // --- PLAYER LISTENERS ---
        this.socket.on('currentPlayers', (serverPlayers) => {
            Object.keys(serverPlayers).forEach((id) => {
                if (id !== this.socket.id) addEnemy(id, serverPlayers[id]);
            });
        });

        this.socket.on('newPlayer', (data) => addEnemy(data.id, data.player));

        this.socket.on('playerMoved', (data) => {
            if (window.otherPlayers && window.otherPlayers[data.id]) {
                const op = window.otherPlayers[data.id];
                if (op.userData && op.userData.isDead) return;

                // Weapon Sync
                if (data.equippedSlot !== op.userData.equippedSlot) {
                    if (data.equippedSlot !== null && data.equippedSlot !== undefined) {
                        equipWeapon(data.equippedSlot, op);
                    } else {
                        unequipWeapon(op);
                    }
                }

                // NEW: Use target variables for smooth interpolation in game loop
                if (!op.userData.targetPos) op.userData.targetPos = op.position.clone();

                // Snap if too far (e.g. teleport/spawn)
                if (op.position.distanceTo(new THREE.Vector3(data.x, data.y, data.z)) > 10) {
                    op.position.set(data.x, data.y, data.z);
                    op.userData.targetPos.set(data.x, data.y, data.z);
                } else {
                    op.userData.targetPos.set(data.x, data.y, data.z);
                }

                op.userData.targetRot = data.rotation;

                // Apply Pitch to parts (snap ok for now)
                const ud = op.userData;
                if (ud && data.pitch !== undefined) {
                    if (ud.head) ud.head.rotation.x = data.pitch;

                    // ONLY apply pitch to arms if holding a weapon
                    if (ud.equippedSlot !== null && ud.equippedSlot !== undefined) {
                        if (ud.rightArm) ud.rightArm.rotation.x = -Math.PI / 2 + data.pitch;
                        if (ud.leftArm) ud.leftArm.rotation.x = -Math.PI / 3 + data.pitch;
                    }
                }
            }
        });

        this.socket.on('playerShoot', (data) => {
            if (window.otherPlayers && window.otherPlayers[data.id]) {
                const p = window.otherPlayers[data.id];
                if (p.userData) {
                    p.userData.shootTimer = 0.3; // Longer to keep pose steady between bullets
                    if (!p.userData.currentRecoil) p.userData.currentRecoil = 0;
                    p.userData.currentRecoil += 0.2;
                }
                // Use FiringSystem for remote player shots
                if (window.FiringSystem) {
                    window.FiringSystem.executeShot(false, p);
                }
            }
        });

        this.socket.on('playerInventoryUpdated', (data) => {
            if (window.otherPlayers && window.otherPlayers[data.id]) {
                const enemy = window.otherPlayers[data.id];
                if (window.syncRemoteInventory) {
                    window.syncRemoteInventory(enemy, data.inventory);
                }
            }
        });

        this.socket.on('playerDisconnected', (id) => {
            if (window.otherPlayers && window.otherPlayers[id]) {
                if (scene) scene.remove(window.otherPlayers[id]);
                delete window.otherPlayers[id];
            }
        });

        this.socket.on('updateHealth', (hp) => {
            updateHealthUI(hp);
            if (hp > 0) {
                document.getElementById('death-screen').style.display = 'none';
            }
        });

        this.socket.on('youDied', (data) => {
            updateInventoryUI([]);

            // --- LOCAL DEATH ANIMATION ---
            const p = window.myPlayerMesh;
            if (p && p.userData) {
                console.log("Local Player Died (youDied Event). Playing Anim...");
                p.userData.isDead = true;

                if (window.isFirstPerson) toggleCamera();
                if (p.mixer) p.mixer.stopAllAction();

                if (p.userData.actions && p.userData.actions.death) {
                    const action = p.userData.actions.death;
                    action.reset();
                    action.setEffectiveTimeScale(1);
                    action.setEffectiveWeight(1);
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    action.play();
                    p.userData.activeAction = action;
                } else {
                    p.rotation.x = -Math.PI / 2;
                    p.position.y = 0.5;
                }
                p.position.y = 0;
                p.userData.velocityY = 0;
            }

            // Delay screen
            if (window.deathScreenTimeout) clearTimeout(window.deathScreenTimeout);
            window.deathScreenTimeout = setTimeout(() => {
                document.getElementById('death-screen').style.display = 'flex';
            }, 2500);
        });

        this.socket.on('playerDied', (data) => {
            if (data.id === this.socket.id) return;
            const p = window.otherPlayers[data.id];

            if (p && p.userData) {
                p.userData.isDead = true;
                if (p.userData.actions && p.userData.actions.death) {
                    const action = p.userData.actions.death;
                    if (p.mixer) p.mixer.stopAllAction();
                    action.reset().setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    action.play();
                    p.userData.activeAction = action;
                } else {
                    p.rotation.x = -Math.PI / 2;
                    p.position.y = 0.5;
                }
                p.position.y = 0;
                p.userData.velocityY = 0;
            }
        });

        this.socket.on('playerRespawn', (data) => {
            const id = data.id;
            let p = (id === this.socket.id) ? window.myPlayerMesh : window.otherPlayers[id];

            if (p) {
                p.userData.isDead = false;
                p.userData.velocityY = 0;
                p.position.set(data.x, data.y, data.z);
                p.rotation.x = 0;
                p.rotation.z = 0;

                const actions = p.userData.actions;
                if (actions) {
                    if (actions.death) actions.death.stop();
                    if (actions.run) actions.run.stop();
                    if (actions.idle) {
                        actions.idle.reset().play();
                        p.userData.activeAction = actions.idle;
                    }
                }
            }

            if (id === this.socket.id) {
                if (window.deathScreenTimeout) clearTimeout(window.deathScreenTimeout);
                document.getElementById('death-screen').style.display = 'none';
                // lastHealth = 100; // Not strictly needed if updateHealth is called
            }
        });

        this.socket.on('playerDamaged', (data) => {
            const id = data.id;
            // Helper for Hit Anim
            const playHit = (mesh) => {
                if (mesh.userData.isMoving) return;
                if (mesh.userData && mesh.userData.actions && mesh.userData.actions.hit && !mesh.userData.isDead) {
                    const clip = mesh.userData.actions.hit.getClip();
                    mesh.userData.hitTimer = clip.duration;
                }
            };

            if (id === this.socket.id && window.myPlayerMesh) {
                updateHealthUI(data.health);
                if (data.health > 0) playHit(window.myPlayerMesh);

                const overlay = document.getElementById('damage-overlay');
                if (overlay) {
                    overlay.style.opacity = '1';
                    setTimeout(() => { overlay.style.opacity = '0'; }, 300);
                }
            } else if (window.otherPlayers[id]) {
                const enemy = window.otherPlayers[id];
                if (data.health > 0) playHit(enemy);

                spawnBlood(enemy.position);

                enemy.traverse((child) => {
                    if (child.isMesh && child.material) {
                        if (child.userData.orgEmissive === undefined) {
                            child.userData.orgEmissive = child.material.emissive.getHex();
                        }
                        child.material.emissive.setHex(0xff0000);
                    }
                });

                setTimeout(() => {
                    // Check if mesh still exists
                    if (enemy && enemy.parent) {
                        enemy.traverse((child) => {
                            if (child.isMesh && child.material) {
                                child.material.emissive.setHex(child.userData.orgEmissive || 0x000000);
                            }
                        });
                    }
                }, 150); // Snappier 150ms flash

                // Spawn Damage Popup
                // Using global helper if available, or logic here
                if (window.spawnDamagePopup) {
                    const popupPos = enemy.position.clone();
                    popupPos.y += 2.0;
                    window.spawnDamagePopup(popupPos, data.damage || 10);
                }
            }
        });

        console.log("Network Initialized.");
    },

    // --- EMIT FUNCTIONS ---
    signup: function (username, password) {
        this.socket.emit('signup', { username, password });
    },

    login: function (username, password, model) {
        this.socket.emit('login', { username, password, model });
    },

    sendMovement: function (data) {
        // data: {x, y, z, rotation, equippedSlot, pitch}
        this.socket.emit('playerMovement', data);
    },

    sendShoot: function () {
        this.socket.emit('shoot');
    },

    sendHit: function (targetId, damage) {
        this.socket.emit('playerHit', { targetId, damage });
    },

    sendInventory: function (inventory) {
        this.socket.emit('updateInventory', inventory);
    }
};
