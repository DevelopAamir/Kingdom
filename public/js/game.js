// --- GLOBAL VARIABLES ---
let camera, scene, renderer;
let socket = io(); // Connect immediately to handle Auth
let myPlayerMesh;
let otherPlayers = {};
let bullets = [];
let damagePopups = []; // Floating numbers
let keys = { w: false, a: false, s: false, d: false };

// Blood System
window.bloodParticles = [];
function spawnBlood(pos) {
    for (let i = 0; i < 10; i++) {
        const size = Math.random() * 0.2 + 0.1; // Bigger chunks
        const blood = new THREE.Mesh(
            new THREE.BoxGeometry(size, size, size),
            new THREE.MeshBasicMaterial({ color: 0xff0000 }) // Bright Red
        );
        blood.position.copy(pos);
        // Height variance
        blood.position.y += 1.0 + (Math.random() * 0.5);

        // Random Velocity
        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            (Math.random() * 0.2),
            (Math.random() - 0.5) * 0.2
        );

        scene.add(blood);
        window.bloodParticles.push({ mesh: blood, velocity: vel, life: 1.0 });
    }
}

// Variables for Controls
let pitchObject, yawObject;
let isLocked = false;
let isFirstPerson = false;

function toggleCamera() {
    isFirstPerson = !isFirstPerson;
    const btn = document.querySelector('button[onclick="toggleCamera()"]');

    if (isFirstPerson) {
        // FPV Mode
        if (btn) btn.innerText = "CAM (FPV)";
        // Move Camera to Eye Level
        // User requested: Little down and left
        // Left (-0.2), Down (-0.15), Forward (-0.4)
        camera.position.set(-0.2, -0.15, -0.4);

        // Hide Body Parts for FPS feel (Only show Right Arm/Gun)
        if (myPlayerMesh) {
            // New GLB Logic: Hide the Character Mesh, Keep Gun
            // DEBUG: User reports gun missing. Disabling ALL hiding to isolate.
            // myPlayerMesh.traverse((child) => {
            //     // Ensure Gun (attached mesh) stays visible. Gun parts are "Mesh", Body is "SkinnedMesh".
            //     // Explicitly check for isGun flag to prevent accidents
            //     if (child.userData.isGun) {
            //         child.visible = true;
            //         return;
            //     }

            //     if (child.isSkinnedMesh) {
            //         child.visible = false;
            //     }
            // });
        }
    } else {
        // TPS Mode
        // TPS Mode
        if (btn) btn.innerText = "CAM (TPP)";
        // Shift Right (0.7) to put char on left. Lower height (0.1) for head level aim.
        camera.position.set(0.7, 0.1, 2.5);

        // Show All
        if (myPlayerMesh) {
            myPlayerMesh.traverse((child) => {
                if (child.isSkinnedMesh) {
                    child.visible = true;
                }
            });
        }
    }
}

// --- AUTHENTICATION ---
function doSignup() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    socket.emit('signup', { username: user, password: pass });
}

function doLogin() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const model = document.getElementById('char-select').value;
    socket.emit('login', { username: user, password: pass, model: model });
}

socket.on('authError', (data) => {
    document.getElementById('auth-msg').innerText = data.message;
});

socket.on('authSuccess', (data) => {
    document.getElementById('auth-msg').style.color = "lightgreen";
    document.getElementById('auth-msg').innerText = data.message;
});

socket.on('loginSuccess', (data) => {
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
                if (document.getElementById('ui-layer').style.display === 'block') {
                    document.getElementById('pause-screen').style.display = 'flex';
                }
            }
        });
    } else {
        // Should we hide it here just in case?
        document.getElementById('pause-screen').style.display = 'none';
    }

    // Start in "Paused" state so user clicks to capture mouse (PC only)
    if (!isMobile) {
        document.getElementById('pause-screen').style.display = 'flex';
    }

    initGame(data.player);
});

// --- TEXTURE GENERATOR ---
function generateGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Gradient Green (Darker/More Natural)
    const gradient = ctx.createRadialGradient(64, 64, 20, 64, 64, 80);
    gradient.addColorStop(0, '#085708ff');
    gradient.addColorStop(1, '#003a00ff');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);

    // Noise details
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let i = 0; i < 600; i++) ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(50, 50);
    return texture;
}

// --- INITIALIZATION ---
function initGame(playerData) {
    // socket is already init
    // Player is already logged in SERVER side

    // Update UI
    updateHealthUI(playerData.health);
    updateInventoryUI(playerData.inventory);

    // 2. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x60a0e0); // Softer Blue
    scene.fog = new THREE.Fog(0x60a0e0, 20, 100);

    // 6. Camera Rig (simple yaw/pitch objects)
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    pitchObject = new THREE.Object3D();
    pitchObject.add(camera);

    yawObject = new THREE.Object3D();
    yawObject.position.y = 10; // Start high
    yawObject.add(pitchObject);
    scene.add(yawObject);

    // *** CAMERA POSITION FIX ***
    // Move camera UP (Y) and BACK (Z) so the player doesn't block the aim
    // Move camera UP (Y) and BACK (Z) so the player doesn't block the aim
    pitchObject.position.z = 0;
    // Offset Right (0.7), Head Level (0.1 relative to pivot), Back (2.5)
    camera.position.set(0.7, 0.1, 2.5);

    // 7. Create Local Player (GLB)
    loadCharacter(playerData.model, 0x0000ff, true, (data) => {
        myPlayerMesh = data.mesh;
        myPlayerMesh.userData.isLocal = true;
        scene.add(myPlayerMesh);

        // Initial Position Check (waiting for server but set safe default)
        myPlayerMesh.position.set(0, 0, 0);

        // Hide Head/Torso if FPS? 
        // We'll rely on toggleCamera logic which checks userData
        toggleCamera();
    });

    // 4. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding; // Fix dark textures (Linear -> sRGB)
    document.body.appendChild(renderer.domElement);

    // 5. Light & Floor
    // Soften Lighting: Use Hemisphere Light + Softer Directional
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5); // Reverted intensity
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7); // Reverted Sun
    dirLight.position.set(50, 80, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048; dirLight.shadow.mapSize.height = 2048;
    // Improve shadow softness
    dirLight.shadow.bias = -0.0001;
    scene.add(dirLight);

    const grassTexture = generateGrassTexture();
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400),
        new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(yawObject); // Add camera control to scene

    // 7. Network Listeners
    socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            // Wait, serverPlayers[id] has { model: '...' } now?
            if (id !== socket.id) addEnemy(id, serverPlayers[id]);
        });
    });

    socket.on('newPlayer', (data) => addEnemy(data.id, data.player));

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            const op = otherPlayers[data.id];
            if (op.userData && op.userData.isDead) return; // Don't update pos/rot if dead (preserve death anim)

            op.position.set(data.x, data.y, data.z);
            otherPlayers[data.id].rotation.y = data.rotation;

            // Apply Pitch to parts
            const ud = otherPlayers[data.id].userData;
            if (ud && data.pitch !== undefined) {
                // Pitch affects Head and Arms
                // Note: Arms are rotated by default for "Aim" (-Math.PI/2) etc.
                if (ud.head) ud.head.rotation.x = data.pitch;
                if (ud.rightArm) ud.rightArm.rotation.x = -Math.PI / 2 + data.pitch;
                if (ud.leftArm) ud.leftArm.rotation.x = -Math.PI / 3 + data.pitch; // Adjust supporting arm
            }
        }
    });

    socket.on('playerShoot', (data) => {
        if (otherPlayers[data.id]) {
            // Trigger Animation
            if (otherPlayers[data.id].userData) {
                otherPlayers[data.id].userData.shootTimer = 0.1;
                // Add recoil to currentRecoil for smooth fallback? 
                // Using procedural loop for spine, so just shootTimer is enough for Flash/Spine kick.
                // But if we want arm kick, we might need currentRecoil too.
                if (!otherPlayers[data.id].userData.currentRecoil) otherPlayers[data.id].userData.currentRecoil = 0;
                otherPlayers[data.id].userData.currentRecoil += 0.2;
            }

            // Fix: Pass false for isLocal, and the mesh object as shooter
            createBullet(false, otherPlayers[data.id]);
        }
    });

    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
        }
    });

    socket.on('updateHealth', (hp) => {
        updateHealthUI(hp);
        // If Health > 0, we are alive. Hide death screen.
        if (hp > 0) {
            document.getElementById('death-screen').style.display = 'none';
        }
    });

    let deathScreenTimeout = null;

    socket.on('youDied', (data) => {
        updateInventoryUI([]); // clear inv

        // --- LOCAL DEATH ANIMATION ---
        const p = myPlayerMesh;
        if (p && p.userData) {
            console.log("Local Player Died (youDied Event). Playing Anim...");
            p.userData.isDead = true;

            // Force TPP
            if (isFirstPerson) toggleCamera();

            // Stop All Actions
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
                console.log("No Death Animation. Falling back to rotation.");
                // Fallback: Rotate -90 degrees on X to lie down
                // We need to rotate the MESH or a parent? 
                // mesh.rotation is used for looking direction.
                // We can rotate on X.
                p.rotation.x = -Math.PI / 2;
                p.position.y = 0.5; // Adjust height so not underground
            }

            // Force Ground
            p.position.y = 0;
            p.userData.velocityY = 0;
        }

        // Delay screen to let death animation play
        clearTimeout(deathScreenTimeout);
        deathScreenTimeout = setTimeout(() => {
            document.getElementById('death-screen').style.display = 'flex';
        }, 2500); // 2.5 Seconds Delay for full animation
    });

    // Helper function for damage popups
    function spawnDamagePopup(worldPos, damage) {
        // Project to 2D screen space
        const screenPos = worldPos.clone().project(camera);

        // Convert to CSS coordinates
        const x = (screenPos.x * .5 + .5) * window.innerWidth;
        const y = (-(screenPos.y * .5) + .5) * window.innerHeight;

        // Create HTML Element
        const div = document.createElement('div');
        div.className = 'damage-popup';
        div.innerText = damage || "10"; // Default to 10 if missing
        div.style.left = x + 'px';
        div.style.top = y + 'px';
        document.getElementById('ui-layer').appendChild(div);

        // Cleanup after animation (1s)
        setTimeout(() => {
            div.remove();
        }, 1000);
    }

    socket.on('playerDied', (data) => {
        // Ignore Self (Handled by youDied)
        if (data.id === socket.id) return;

        const p = otherPlayers[data.id];

        if (p && p.userData) {
            p.userData.isDead = true;

            // Play Animation
            if (p.userData.actions && p.userData.actions.death) {
                const action = p.userData.actions.death;

                if (p.mixer) p.mixer.stopAllAction(); // Assuming remote players have mixers? Yes.

                action.reset();
                action.setEffectiveTimeScale(1);
                action.setEffectiveWeight(1);
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
                action.play();
                p.userData.activeAction = action;
            } else {
                // Fallback for Remote Players
                p.rotation.x = -Math.PI / 2;
                p.position.y = 0.5;
            }

            // Force Ground
            p.position.y = 0;
            p.userData.velocityY = 0;
        }
    });

    socket.on('playerRespawn', (data) => {
        const id = data.id;
        let p = (id === socket.id) ? myPlayerMesh : otherPlayers[id];

        if (p) {
            p.userData.isDead = false;
            p.userData.velocityY = 0;

            // Reset Transforms
            p.position.set(data.x, data.y, data.z);
            p.rotation.x = 0;
            p.rotation.z = 0;

            // Reset Animation
            const actions = p.userData.actions;
            if (actions) {
                // Stop Death
                if (actions.death) actions.death.stop();
                if (actions.run) actions.run.stop();

                // Play Idle
                if (actions.idle) {
                    actions.idle.reset().play();
                    p.userData.activeAction = actions.idle;
                }
            }
        }

        // Local Player UI Reset
        if (id === socket.id) {
            clearTimeout(deathScreenTimeout);
            document.getElementById('death-screen').style.display = 'none';
            lastHealth = 100;
        }
    });

    socket.on('playerDamaged', (data) => {
        const id = data.id;
        const damage = data.damage;
        let pos = new THREE.Vector3();

        // Helper for Hit Anim
        const playHit = (mesh) => {
            // FIX: Don't play hit anim if running (User Request)
            if (mesh.userData.isMoving) return;

            if (mesh.userData && mesh.userData.actions && mesh.userData.actions.hit && !mesh.userData.isDead) {
                // Set Hit State Timer (duration of clip)
                const clip = mesh.userData.actions.hit.getClip();
                mesh.userData.hitTimer = clip.duration;
            }
        };

        if (id === socket.id && myPlayerMesh) {
            pos.copy(myPlayerMesh.position);
            updateHealthUI(data.health);

            // Only play hit anim if still alive
            if (data.health > 0) playHit(myPlayerMesh);

            // Flash Red Vignette
            const overlay = document.getElementById('damage-overlay');
            if (overlay) {
                overlay.style.opacity = '1';
                setTimeout(() => {
                    overlay.style.opacity = '0';
                }, 300);
            }
        } else if (otherPlayers[id]) {
            const enemy = otherPlayers[id];
            pos.copy(enemy.position);

            // Only play hit anim if still alive
            if (data.health > 0) playHit(enemy);

            // Spawn Blood
            spawnBlood(enemy.position);

            // Flash Red for enemy
            enemy.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.emissive.setHex(0xff0000);
                }
            });

            setTimeout(() => {
                if (otherPlayers[data.id]) {
                    enemy.traverse((child) => {
                        if (child.isMesh && child.material) {
                            child.material.emissive.setHex(0x000000);
                        }
                    });
                }
            }, 100);

            // 2. Show Floating Damage Text
            // Calculate screen position
            // Clone pos to avoid messing up player
            const popupPos = enemy.position.clone();
            popupPos.y += 2.0; // Above head

            // Project to 2D screen space
            popupPos.project(camera);

            // Convert to CSS coordinates
            const x = (popupPos.x * .5 + .5) * window.innerWidth;
            const y = (-(popupPos.y * .5) + .5) * window.innerHeight;

            // Create HTML Element
            const div = document.createElement('div');
            div.className = 'damage-popup';
            div.innerText = data.damage || "10"; // Default to 10 if missing
            div.style.left = x + 'px';
            div.style.top = y + 'px';
            document.getElementById('ui-layer').appendChild(div);

            // 2. Show Floating Damage Text
            // ... (existing code) ...

            // 3. Spawn Blood Particles (Already Called above at line 406)

            // Cleanup after animation (1s)
            setTimeout(() => {
                div.remove();
            }, 1000);
        }
    });

    // Blood System moved to Global Scope

    // Inputs
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Mobile specific setup: Hide pause screen (no pointer lock needed)
    if (isMobile) {
        document.getElementById('pause-screen').style.display = 'none';
    }

    if (isMobile) {
        document.getElementById('mobile-controls').style.display = 'block';

        // NIPPLE.JS
        const manager = nipplejs.create({
            zone: document.getElementById('joystick-zone'),
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white'
        });

        manager.on('move', (evt, data) => {
            const forward = data.vector.y;
            const turn = data.vector.x;

            // Map to Keys for Movement logic
            if (forward > 0.5) { keys['w'] = true; keys['s'] = false; }
            else if (forward < -0.5) { keys['s'] = true; keys['w'] = false; }
            else { keys['w'] = false; keys['s'] = false; }

            if (turn > 0.5) { keys['d'] = true; keys['a'] = false; }
            else if (turn < -0.5) { keys['a'] = true; keys['d'] = false; }
            else { keys['a'] = false; keys['d'] = false; }


        });

        manager.on('end', () => {
            keys['w'] = false; keys['s'] = false;
            keys['a'] = false; keys['d'] = false;
        });

        // Cancel Auto-Run on Joystick Touch
        manager.on('start', () => {
            isSprintToggled = false;
            const runBtn = document.getElementById('run-btn');
            if (runBtn) {
                runBtn.style.background = 'rgba(255, 165, 0, 0.5)';
                runBtn.style.border = '2px solid white';
            }
        });

        // Multi-touch Look Logic
        let lookTouchId = null;
        let lastTouchX = 0;
        let lastTouchY = 0;

        document.addEventListener('touchstart', (e) => {
            // Find a finger on the right side that is NOT the joystick (left)
            // But we have fire button there too. 
            // Fire button handles its own event and stops propagation? 
            // Let's iterate.
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                // Right side of screen
                // Right side of screen AND NOT the fire button (though button stops prop, we check zone)
                // Actually, just check x > window.innerWidth / 2. The button has stopPropagation.
                if (t.clientX > window.innerWidth / 2) {
                    lookTouchId = t.identifier;
                    lastTouchX = t.clientX;
                    lastTouchY = t.clientY;
                    break;
                }
            }
        });

        document.addEventListener('touchmove', (e) => {
            if (lookTouchId !== null) {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i];
                    if (t.identifier === lookTouchId) {
                        const dx = t.clientX - lastTouchX;
                        const dy = t.clientY - lastTouchY;

                        yawObject.rotation.y -= dx * 0.005;
                        pitchObject.rotation.x -= dy * 0.005;
                        pitchObject.rotation.x = Math.max(-0.5, Math.min(Math.PI / 3, pitchObject.rotation.x));

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

        // Fire Button
        const fireBtn = document.getElementById('mobile-fire-btn');
        if (fireBtn) {
            fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isFiring = true; });
            fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); isFiring = false; });
        }

        const jumpBtn = document.getElementById('jump-btn');
        if (jumpBtn) {
            jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[' '] = true; });
            jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); keys[' '] = false; });
        }

        const runBtn = document.getElementById('run-btn');
        if (runBtn) {
            runBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                isSprintToggled = !isSprintToggled;
                // Visual Feedback
                runBtn.style.background = isSprintToggled ? 'rgba(200, 0, 0, 0.8)' : 'rgba(255, 165, 0, 0.5)';
                runBtn.style.border = isSprintToggled ? '3px solid yellow' : '2px solid white';
            });
        }

    } else {
        document.addEventListener('mousemove', onMouseMove, false);
        document.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement === document.body) isFiring = true;
        }, false);
        document.addEventListener('mouseup', () => isFiring = false, false);

        document.addEventListener('keydown', (e) => {
            keys[e.key.toLowerCase()] = true;

            // Auto-Run Cancel on Manual Input (WASD)
            if (['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
                isSprintToggled = false;
                const runBtn = document.getElementById('run-btn');
                if (runBtn) {
                    runBtn.style.background = 'rgba(255, 165, 0, 0.5)';
                    runBtn.style.border = '2px solid white';
                }
            }

            if (e.key.toLowerCase() === 'c') toggleCamera();
            if (e.key === " ") keys[' '] = true; // Spacebar for jump

            // Toggle Sprint
            if (e.key === 'Shift') {
                isSprintToggled = !isSprintToggled;
                // Sync Mobile UI if exists (hybrid testing)
                const runBtn = document.getElementById('run-btn');
                if (runBtn) {
                    runBtn.style.background = isSprintToggled ? 'rgba(200, 0, 0, 0.8)' : 'rgba(255, 165, 0, 0.5)';
                    runBtn.style.border = isSprintToggled ? '3px solid yellow' : '2px solid white';
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            keys[e.key.toLowerCase()] = false;
            if (e.key === " ") keys[' '] = false; // Spacebar for jump
        });
    }

    // Global Resize Listener (Mobile + PC)
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function fireWeaponLogic() {
    // --- RAYCAST HIT DETECTION ---
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    let meshes = [];
    let meshToId = {};

    Object.keys(otherPlayers).forEach(id => {
        meshes.push(otherPlayers[id]);
        meshToId[otherPlayers[id].uuid] = id;
    });

    const intersects = raycaster.intersectObjects(meshes, true);

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj.parent && hitObj.parent.type !== 'Scene') {
            hitObj = hitObj.parent;
        }

        const targetId = meshToId[hitObj.uuid];
        if (targetId) {
            socket.emit('playerHit', { targetId: targetId, damage: 10 });
        }
    }
}

const CHARACTER_SCALE = 1.0;
const loader = new THREE.GLTFLoader();
const GUN_URL = 'https://raw.githubusercontent.com/microsoft/MixedRealityToolkit/main/SpatialInput/Samples/DemoRoom/Media/Models/Gun.glb';
// const SOLDIER_URL = 'https://threejs.org/examples/models/gltf/Soldier.glb';

const MODELS = {
    'Soldier': 'https://threejs.org/examples/models/gltf/Soldier.glb',
    'Adventurer': './glb/Adventurer.glb',
    'Punk': './glb/Punk.glb'
};

const BONE_MAPPINGS = {
    rightHand: ['mixamorigRightHand', 'RightHand', 'WristR'],
    rightArm: ['mixamorigRightArm', 'RightArm', 'UpperArmR'],
    rightForeArm: ['mixamorigRightForeArm', 'RightForeArm', 'LowerArmR'],
    leftArm: ['mixamorigLeftArm', 'LeftArm', 'UpperArmL'],
    leftForeArm: ['mixamorigLeftForeArm', 'LeftForeArm', 'LowerArmL'],
    spine: ['mixamorigSpine', 'Spine', 'Chest', 'Torso'],
    head: ['mixamorigHead', 'Head'],
    leftLeg: ['mixamorigLeftUpLeg', 'UpperLegL', 'LeftUpLeg', 'UpLegL', 'ThighL'],
    rightLeg: ['mixamorigRightUpLeg', 'UpperLegR', 'RightUpLeg', 'UpLegR', 'ThighR']
};

// Procedural Low-Poly AK47
function createGun() {
    const gunGroup = new THREE.Group();

    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 }); // Dark Metal
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // Wood Brown

    // 1. Stock (Wood)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.4), woodMaterial);
    stock.position.set(0, -0.05, -0.3);
    gunGroup.add(stock);

    // 2. Main Body (Metal)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.4), darkMaterial);
    body.position.set(0, 0, 0.1);
    gunGroup.add(body);

    // 3. Magazine (Metal, curved-ish look via rotation?)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.15), darkMaterial);
    mag.position.set(0, -0.2, 0.15);
    mag.rotation.x = 0.2;
    gunGroup.add(mag);

    // 4. Barrel (Metal)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), darkMaterial);
    barrel.position.set(0, 0, 0.6);
    gunGroup.add(barrel);

    // 5. Handguard (Wood)
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), woodMaterial);
    handguard.position.set(0, -0.02, 0.4);
    gunGroup.add(handguard);

    // Muzzle Point
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, 0.9);
    gunGroup.add(muzzle);

    // Muzzle Flash (Procedural)
    const flashGeo = new THREE.ConeGeometry(0.1, 0.4, 8);
    flashGeo.translate(0, 0.2, 0); // Pivot at base
    flashGeo.rotateX(Math.PI / 2); // Point forward
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.visible = false;
    muzzle.add(flash);

    return { group: gunGroup, muzzle: muzzle, flash: flash };
}

// --- DAMAGE NUMBER LOGIC ---
function spawnDamagePopup(position, damage) {
    const container = document.getElementById('damage-container');
    if (!container) return;

    const el = document.createElement('div');
    el.innerText = damage;
    el.style.position = 'absolute';
    el.style.color = '#ff0000'; // RED
    el.style.fontWeight = 'bold';
    el.style.fontSize = '24px';
    el.style.textShadow = '1px 1px 2px black';
    el.style.pointerEvents = 'none';
    el.style.userSelect = 'none';

    container.appendChild(el);

    damagePopups.push({
        element: el,
        position: position.clone(), // Start pos
        velocity: new THREE.Vector3(0, 1.5, 0), // Responds to gravity or just simple float up
        life: 1.0 // 1 second
    });
}

function loadCharacter(modelType, color, isLocal, onLoad) {
    const url = MODELS[modelType] || MODELS['Soldier'];
    console.log(`Loading Character: ${modelType} from ${url}`);

    loader.load(url, function (gltf) {
        const model = gltf.scene;
        model.scale.set(1.0, 1.0, 1.0);

        model.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                // Preserve original colors/textures.
            }
        });

        // Animations
        const mixer = new THREE.AnimationMixer(model);
        const animations = gltf.animations;

        // Smart Animation Finder
        const findClip = (name) => animations.find(a => a.name.toLowerCase().includes(name));

        const idleClip = findClip('idle') || animations[0];
        const runClip = findClip('run') || findClip('walk') || animations[1]; // Walk is fallback
        const walkClip = findClip('walk') || runClip;

        const deathClip = findClip('death') || findClip('die') || findClip('falling');
        const hitClip = findClip('hit') || findClip('receive') || findClip('damage') || findClip('react');


        // Safely create actions
        const idleAction = mixer.clipAction(idleClip);
        const runAction = runClip ? mixer.clipAction(runClip) : idleAction;
        const walkAction = walkClip ? mixer.clipAction(walkClip) : runAction;
        const deathAction = deathClip ? mixer.clipAction(deathClip) : null;
        const hitAction = hitClip ? mixer.clipAction(hitClip) : null;


        if (deathAction) {
            deathAction.setLoop(THREE.LoopOnce);
            deathAction.clampWhenFinished = true;
        } else {
            console.warn("NO DEATH ANIMATION FOUND FOR MODEL:", modelType);
        }

        if (hitAction) {
            hitAction.setLoop(THREE.LoopOnce);
            hitAction.clampWhenFinished = false;
        }

        console.log(`Loaded ${modelType}. Animations:`, animations.map(a => a.name));

        idleAction.play(); // DEFAULT STATE
        runAction.stop();

        // Bone Helper
        const getBone = (names) => {
            for (const name of names) {
                const b = model.getObjectByName(name);
                if (b) return b;
            }
            return null;
        };

        const rightHand = getBone(BONE_MAPPINGS.rightHand);

        // Declare variables for scope
        let muzzle = null;
        let muzzleFlash = null;
        let rightArm = null;
        let rightForeArm = null;
        let leftArm = null;
        let leftForeArm = null;
        let spine = null;
        let head = null;
        let leftLeg = null;
        let rightLeg = null;
        let aimBone = null;

        if (rightHand) {
            // Find the Arm Bones for Two-Handed Hold
            const rArm = getBone(BONE_MAPPINGS.rightArm);
            rightForeArm = getBone(BONE_MAPPINGS.rightForeArm);
            leftArm = getBone(BONE_MAPPINGS.leftArm);
            leftForeArm = getBone(BONE_MAPPINGS.leftForeArm);
            spine = getBone(BONE_MAPPINGS.spine);
            head = getBone(BONE_MAPPINGS.head);
            leftLeg = getBone(BONE_MAPPINGS.leftLeg);
            rightLeg = getBone(BONE_MAPPINGS.rightLeg);

            if (rArm) {
                aimBone = rArm; // Capture for AIM logic
                rightArm = rArm;
            }

            // Create Reliable Procedural AK47
            const gunData = createGun();
            const gun = gunData.group;
            muzzle = gunData.muzzle;
            muzzleFlash = gunData.flash;

            // Scale and Position from USer Calibration
            gun.scale.set(76.0, 76.0, 76.0);

            // Orient Gun relative to Hand Bone
            // User: rx: -261, ry: -198, rz: 1
            gun.rotation.set(
                THREE.Math.degToRad(-261),
                THREE.Math.degToRad(-198),
                THREE.Math.degToRad(1)
            );

            // User: x: -5, y: -5, z: 5
            gun.position.set(-5, -5, 5);

            gun.userData.isGun = true;
            gun.traverse(c => c.userData.isGun = true);

            // rightHand.add(gun); // DISABLED: User request
            console.log("GUN CREATED BUT NOT ATTACHED (User Request).");
        }
        else {
            console.error("Right Hand Bone NOT found available mapping.");
            // model.traverse(c => { if (c.isBone) console.log(c.name); }); // Debugging
        }

        const characterData = {
            mesh: model,
            mixer: mixer,
            actions: { idle: idleAction, run: runAction, walk: walkAction, death: deathAction, hit: hitAction },
            userData: {
                muzzle: muzzle,
                muzzleFlash: muzzleFlash,
                rightHand: rightHand,
                rightArm: rightArm,
                rightForeArm: rightForeArm,
                leftArm: leftArm,
                leftForeArm: leftForeArm,
                spine: spine,
                head: head, // For Pitch
                leftLeg: leftLeg,
                rightLeg: rightLeg,
                aimBone: aimBone,
                currentRecoil: 0,
                shootTimer: 0, // For animation
                isMoving: false,
                isDead: false,
                actions: { idle: idleAction, run: runAction, walk: walkAction, death: deathAction, hit: hitAction },
                activeAction: idleAction
            }
        };

        model.userData = characterData.userData;
        model.mixer = mixer;

        onLoad(characterData);

    }, undefined, (e) => {
        console.error("Failed to load Character", e);
    });
}

// Assuming initGame is defined elsewhere, adding the change here for completeness.


function addEnemy(id, data) {
    loadCharacter(data.model || 'Soldier', 0x00ff00, false, (charData) => {
        const enemy = charData.mesh;
        enemy.position.set(data.x, data.y, data.z);

        // Store mesh in map
        otherPlayers[id] = enemy;
        scene.add(enemy);
    });
}

// Auto-Fire State
const SFX_JUMP = new Audio('sound-effect/jumpland.wav');
const SFX_STEP = new Audio('sound-effect/Steps_dirt-001.ogg');

// Volume Configuration
const VOL_RUN = 0.04; // Drastically reduced
const VOL_JUMP = 0.02; // Drastically reduced

function playSound(audioSource, volume) {
    const s = audioSource.cloneNode();
    s.volume = Math.min(1.0, Math.max(0, volume));
    s.play().catch(() => { });
}

let isFiring = false;
let isSprintToggled = false; // Toggle state for Run
let lastShotTime = 0;
const FIRE_RATE = 0.15; // Seconds between shots

function attemptShoot() {
    const now = Date.now() * 0.001;
    lastFireTime = now;

    if (myPlayerMesh) {
        // Recoil Impulse
        if (!myPlayerMesh.userData.currentRecoil) myPlayerMesh.userData.currentRecoil = 0;
        myPlayerMesh.userData.currentRecoil += 0.2; // Aim kick up

        // Procedural Animation Trigger (Spine + Flash)
        myPlayerMesh.userData.shootTimer = 0.1;

        // Shoot locally (Visual)
        createBullet(true); // Fixed: Pass true for isLocal
        socket.emit('shoot');

        // --- RAYCAST HIT DETECTION ---
        const raycaster = new THREE.Raycaster();

        // Ray from Camera center
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

        // Check intersections with other players
        let meshes = [];
        let meshToId = {};

        Object.keys(otherPlayers).forEach(id => {
            meshes.push(otherPlayers[id]);
            meshToId[otherPlayers[id].uuid] = id;
        });

        const intersects = raycaster.intersectObjects(meshes, true); // recursive for groups

        if (intersects.length > 0) {
            // Find the root object
            let hitObj = intersects[0].object;
            while (hitObj.parent && hitObj.parent.type !== 'Scene') {
                hitObj = hitObj.parent;
            }

            const targetId = meshToId[hitObj.uuid];
            if (targetId) {
                console.log("Hit player:", targetId);
                // Trigger Visuals immediately
                if (intersects[0].point) {
                    spawnDamagePopup(intersects[0].point, 10);
                }

                socket.emit('playerHit', { targetId: targetId, damage: 10 });
            }
        }
    }
}

function onMouseClick() {
    // Only used for single click if needed, but we use isFiring state now
}

function updateHealthUI(hp) {
    document.getElementById('health-display').innerText = hp + "%";
    if (hp <= 0) {
        // Do not show death screen immediately, wait for animation
        // document.getElementById('death-screen').style.display = 'block';
    } else {
        document.getElementById('death-screen').style.display = 'none';
    }
}

function updateInventoryUI(inv) {
    const list = inv.length ? inv.join(", ") : "Empty";
    document.getElementById('inv-display').innerText = list;
}

function showNotification(msg) {
    const el = document.getElementById('notification-msg');
    el.innerText = msg;
    el.style.display = 'block';
    // Clear previous timeout if exists (simple way: just set new one)
    setTimeout(() => {
        el.style.display = 'none';
    }, 3000); // 3 seconds
}
// --- ANIMATION UPDATE ---
function updateCharacterAnimation(mesh, dt, time) {
    if (!mesh.userData) return;
    if (mesh.userData.isDead) return; // FIX: Don't process procedural anims if dead (overwrites rotation)
    const ud = mesh.userData;

    // Debug Jump
    if (Math.random() < 0.005) { // Log occasionally
        const lName = ud.leftLeg ? ud.leftLeg.name : 'MISSING';
        const rName = ud.rightLeg ? ud.rightLeg.name : 'MISSING';
        console.log(`UpdateAnim: Grounded=${ud.isGrounded}, Jump=${ud.velocityY}, LLeg=${lName}, RLeg=${rName}`);
    }

    // Pitch retrieval (Head is already updated by Input or Network)
    const pitch = ud.head ? ud.head.rotation.x : 0;

    // Recoil
    const recoil = ud.currentRecoil || 0;

    /* DISABLED: User Request - Let animations play naturally
    // --- TWO HANDED GRIP LOGIC ---
 
    // 1. Right Arm (Aiming)
    if (ud.rightArm) {
        ud.rightArm.rotation.x = 0.84 + pitch + recoil;
        ud.rightArm.rotation.y = 0.43;
        ud.rightArm.rotation.z = 0.57;
    }
 
    // 2. Right Forearm
    if (ud.rightForeArm) {
        ud.rightForeArm.rotation.x = 1.0;
        ud.rightForeArm.rotation.y = 1.0;
        ud.rightForeArm.rotation.z = 0;
    }
 
    // 3. Left Arm (Reaching for Barrel)
    if (ud.leftArm) {
        ud.leftArm.rotation.x = -0.55;
        ud.leftArm.rotation.y = -0.96;
        ud.leftArm.rotation.z = -5.5; 
    }
 
    // 4. Left Forearm (Bent to hold foregrip)
    if (ud.leftForeArm) {
        ud.leftForeArm.rotation.x = 0.15;
        ud.leftForeArm.rotation.y = -0.4;
        ud.leftForeArm.rotation.z = -4.9;
    }
 
    // 5. Spine (Twist to align shoulders)
    if (ud.spine) {
        ud.spine.rotation.x = 0;
        ud.spine.rotation.y = 0.4; // Twist right
        ud.spine.rotation.z = 0;
    }
    */

    // --- PROCEDURAL SHOOTING ANIMATION ---
    if (ud.shootTimer > 0) {
        ud.shootTimer -= dt;

        /* DISABLED: User Request - No procedural override
        // Spine Recoil (Kick back)
        if (ud.spine) {
            ud.spine.rotation.x -= 0.2 * (ud.shootTimer / 0.1); // Kick back max 0.2 rads
        }
        */

        // Muzzle Flash Visibility
        if (ud.muzzleFlash) {
            ud.muzzleFlash.visible = true;
            // Flicker rotation for variety
            ud.muzzleFlash.rotation.z = Math.random() * Math.PI;
        }
    } else {
        if (ud.muzzleFlash) ud.muzzleFlash.visible = false;
    }

    /* DISABLED: User Request - No procedural override
    // 5. Spine (Twist to align shoulders)
    if (ud.spine) {
        ud.spine.rotation.x = 0;
        ud.spine.rotation.y = 0.4; // Twist right
        ud.spine.rotation.z = 0;
    }
 
    /* DISABLED: Manual bone overrides removed. Animation Mixer handles everything now. */
}

function createBullet(isLocal = false, shooter = null) {
    const bullet = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );

    let startPos = new THREE.Vector3();
    let direction = new THREE.Vector3();

    if (isLocal) {
        // 1. Get Gun Muzzle Position (World)
        if (myPlayerMesh && myPlayerMesh.userData && myPlayerMesh.userData.muzzle) {
            myPlayerMesh.userData.muzzle.getWorldPosition(startPos);
        } else {
            // Fallback
            camera.getWorldPosition(startPos);
        }

        // 2. Find Target Direction (Ray from Camera Center)
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

        // Point far away
        const targetPoint = new THREE.Vector3();
        raycaster.ray.at(100, targetPoint);

        // 3. Direction = Target - Muzzle
        direction.subVectors(targetPoint, startPos).normalize();

    } else if (shooter) {
        // Enemy shooting
        if (shooter.userData && shooter.userData.muzzle) {
            shooter.userData.muzzle.getWorldPosition(startPos);

            // Use Shooter's rotation Y
            const theta = shooter.rotation.y + Math.PI;
            direction.set(Math.sin(theta), 0, Math.cos(theta));
        } else {
            // Fallback
            startPos.copy(shooter.position);
            startPos.y += 1.4;
            shooter.getWorldDirection(direction);
        }
    } else {
        return; // invalid call
    }

    bullet.position.copy(startPos);
    bullet.userData.velocity = direction.multiplyScalar(1.6); // Fast bullet

    scene.add(bullet);
    bullets.push(bullet);

    setTimeout(() => {
        scene.remove(bullet);
        bullets = bullets.filter(b => b !== bullet);
    }, 2000);
}

function onMouseMove(event) {
    if (document.pointerLockElement === document.body) {
        yawObject.rotation.y -= event.movementX * 0.002;
        pitchObject.rotation.x -= event.movementY * 0.002;

        // Clamp Pitch to prevent ground clipping
        // -Math.PI/2 is straight up. Math.PI/2 is straight down.
        // If camera.position.z is 6, at 45 deg down, Y drops significantly.
        // Let's restrict looking UP too much if it clips, or just clamp generally.
        // A tighter clamp is usually better for TPS.
        pitchObject.rotation.x = Math.max(-0.5, Math.min(Math.PI / 3, pitchObject.rotation.x));
    }
}

// Time Tracking
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    // Auto-Fire Check
    if (isFiring) {
        attemptShoot();
    }

    window.frames = (window.frames || 0) + 1;

    // --- DYNAMIC DELTA TIME ---
    const now = performance.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;

    // Clamp dt to avoid spiral of death (e.g. max 100ms per frame)
    if (dt > 0.1) dt = 0.1;

    // Time scaling factor (Relative to 60FPS / 16ms)
    // Legacy physics values were tuned for dt=0.016
    // We can multiply speed/gravity by (dt / 0.016)
    // OR we can just use 'dt' effectively if we adjust the constants.
    // Plan: Use 'timeScale' to adjust existing per-frame values.
    const timeScale = dt / 0.016;

    const time = Date.now() * 0.001;

    // --- BLOOD PARTICLES ---
    // Debug Removed

    // Physics for Blood
    if (window.bloodParticles) {
        // ... (existing blood loop) ...
        for (let i = window.bloodParticles.length - 1; i >= 0; i--) {
            const p = window.bloodParticles[i];
            p.mesh.position.add(p.velocity);
            p.velocity.y -= 0.01;
            p.life -= dt;
            p.mesh.scale.setScalar(p.life);
            if (p.life <= 0) {
                scene.remove(p.mesh);
                window.bloodParticles.splice(i, 1);
            }
        }
    }

    // UPDATE DAMAGE POPUPS
    const container = document.getElementById('damage-container');
    if (container && damagePopups.length > 0) {
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;

        for (let i = damagePopups.length - 1; i >= 0; i--) {
            const p = damagePopups[i];
            p.life -= dt;

            // Move up
            p.position.y += 1.0 * dt;

            if (p.life <= 0) {
                p.element.remove();
                damagePopups.splice(i, 1);
                continue;
            }

            // Project to Screen
            const screenPos = p.position.clone();
            screenPos.project(camera);

            // Check if behind camera
            // if z > 1, it's behind near plane? No, project returns z in [-1, 1] if visible + w division. 
            // Actually standard perspective projection: z < 1 is visible?
            // If |z| > 1 it's outside frustum depth?
            // Safe check: (screenPos.z < 1 && screenPos.z > -1)

            if (screenPos.z < 1) {
                const x = (screenPos.x * widthHalf) + widthHalf;
                const y = -(screenPos.y * heightHalf) + heightHalf;

                p.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
                p.element.style.opacity = p.life;
                p.element.style.display = 'block';
            } else {
                p.element.style.display = 'none';
            }
        }
    }

    if (myPlayerMesh) {
        // 1. Sync Model to Camera (DEFAULT)
        // We now decouple rotation if moving

        // 2. Movement Inputs
        let moveForward = keys['w'];
        if (isSprintToggled) moveForward = true; // Auto-Run / Run-Lock

        const moveBackward = keys['s'];
        const moveLeft = keys['a'];
        const moveRight = keys['d'];
        const isMoving = moveForward || moveBackward || moveLeft || moveRight;

        // Calculate Camera Yaw
        const cameraYaw = yawObject.rotation.y;

        // Determine Angle Offset based on Keys
        let angleOffset = 0; // Default W
        let hasInput = false;

        if (moveForward) {
            hasInput = true;
            if (moveLeft) angleOffset = Math.PI / 4; // 45 deg Left
            else if (moveRight) angleOffset = -Math.PI / 4; // 45 deg Right
        } else if (moveBackward) {
            hasInput = true;
            if (moveLeft) angleOffset = Math.PI * 0.75; // 135 deg Left
            else if (moveRight) angleOffset = -Math.PI * 0.75; // 135 deg Right
            else angleOffset = Math.PI; // 180 deg Back
        } else if (moveLeft) {
            hasInput = true;
            angleOffset = Math.PI / 2; // 90 deg Left
        } else if (moveRight) {
            hasInput = true;
            angleOffset = -Math.PI / 2; // 90 deg Right
        }

        // Apply Rotation
        if (hasInput) {
            // Face Movement Direction
            // Target Rotation = Camera Yaw + Offset + 180 (Math.PI) to face away
            const targetRotation = cameraYaw + angleOffset + Math.PI;

            // Smooth Rotation (Lerp)
            // Fix circular wrapping (PI to -PI)
            // For MVP, just snap or simple lerp
            let diff = targetRotation - myPlayerMesh.rotation.y;
            // Normalize diff to -PI...PI
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            myPlayerMesh.rotation.y += diff * 0.2 * timeScale; // 20% smooth factor
        } else {
            // If idle, align with camera (Back to Camera)
            // Target = Camera Yaw + 180 (Math.PI)
            const targetRot = cameraYaw + Math.PI;
            let diff = targetRot - myPlayerMesh.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            myPlayerMesh.rotation.y += diff * 0.1 * timeScale; // 10% smooth factor
        }

        // Camera Follows Player Position
        yawObject.position.x = myPlayerMesh.position.x;
        yawObject.position.y = myPlayerMesh.position.y + 1.6; // Eye Height
        yawObject.position.z = myPlayerMesh.position.z;

        // 3. Apply Velocity
        let baseSpeed = 0.1;
        if (isSprintToggled) baseSpeed = 0.12; // 20% faster (adjusted from 0.15)

        const speed = baseSpeed * timeScale; // Adjusted for Delta Time

        // --- AUDIO: FOOTSTEPS ---
        const ud = myPlayerMesh.userData;
        if (ud.stepTimer === undefined) ud.stepTimer = 0;

        if (isMoving && ud.isGrounded) {
            ud.stepTimer -= dt;
            if (ud.stepTimer <= 0) {
                playSound(SFX_STEP, VOL_RUN); // Play Footstep Sound (Source + Vol)
                // Faster steps if sprinting, but gap increased as requested
                ud.stepTimer = isSprintToggled ? 0.35 : 0.55;
            }
        } else {
            // Reset timer so step plays immediately when starting to move
            ud.stepTimer = 0;
        }

        myPlayerMesh.userData.isSprinting = isSprintToggled && hasInput; // For animation logic

        if (hasInput) {
            // Move in the direction the PLAYER IS FACING (since we rotated him)
            // actually, we should move relative to CAMERA still to be precise input
            // But if we rotated player to match input, we can move player forward?
            // Yes, "Run Forward" in local space.

            // Wait, if we use Smooth Rotation, the player might not be facing the direction yet.
            // Better to move based on INPUT ANGLE relative to CAMERA irrespective of mesh rotation.

            const moveAngle = cameraYaw + angleOffset;
            myPlayerMesh.position.x -= Math.sin(moveAngle) * speed;
            myPlayerMesh.position.z -= Math.cos(moveAngle) * speed;
        }

        // --- JUMP & GRAVITY ---
        if (myPlayerMesh.userData.velocityY === undefined) myPlayerMesh.userData.velocityY = 0;

        // Gravity
        myPlayerMesh.userData.velocityY -= 0.015 * timeScale; // Gravity strength
        myPlayerMesh.position.y += myPlayerMesh.userData.velocityY * timeScale;

        // Ground Collision
        let isGrounded = false;
        if (myPlayerMesh.position.y <= 0) {
            // Play Landing Sound if previously in air
            if (!myPlayerMesh.userData.isGrounded && myPlayerMesh.userData.velocityY < 0) {
                // Added velocity check to avoid spam on spawn/jitter
                playSound(SFX_JUMP, VOL_JUMP);
            }

            myPlayerMesh.position.y = 0;
            myPlayerMesh.userData.velocityY = 0;
            isGrounded = true;
        }

        // Jump Input
        if (keys[' '] && isGrounded) {
            myPlayerMesh.userData.velocityY = 0.22; // Initial Jump Velocity (per 16ms unit)
            isGrounded = false;
        }

        myPlayerMesh.userData.isGrounded = isGrounded;

        // Update Animation State
        if (myPlayerMesh.userData) {
            myPlayerMesh.userData.isMoving = isMoving;

            // Sync Local Pitch (Aiming Up/Down)
            // This ensures arms aim where we look, making Gun visible in FPV
            const pitch = pitchObject.rotation.x;
            if (myPlayerMesh.userData.head) myPlayerMesh.userData.head.rotation.x = pitch;

            // Invert pitch for Body Group parts?
            // Since BodyGroup is Rotated 180 (PI), the local X axis is flipped relative to World X?
            // If Pitch (Look Down) is negative. 
            // We want Arm to rotate DOWN. 
            // If Body is flipped 180 Y:
            // World X is (1,0,0). Local X is (-1,0,0).
            // Rotation around Local X (positive) -> Local Z moves to Local Y?
            // Let's try INVERTING it based on user feedback.
            if (myPlayerMesh.userData.rightArm) {
                // Decay Recoil
                if (myPlayerMesh.userData.currentRecoil === undefined) myPlayerMesh.userData.currentRecoil = 0;

                if (myPlayerMesh.userData.currentRecoil > 0) {
                    myPlayerMesh.userData.currentRecoil -= dt * 2.0; // Recovery speed
                    if (myPlayerMesh.userData.currentRecoil < 0) myPlayerMesh.userData.currentRecoil = 0;
                }

                if (myPlayerMesh.userData.aimBone) {
                    // Logic moved to updateCharacterAnimation
                }

            }
            // updateCharacterAnimation call moved to after mixer.update
            const isMovingInput = keys['w'] || keys['s'] || keys['a'] || keys['d'];

            // ... (rest of input logic) ...
        }

        // Update Animations
        if (myPlayerMesh && myPlayerMesh.mixer) {
            myPlayerMesh.mixer.update(dt);

            // KEY FIX: Apply bone overrides AFTER animation mixer
            updateCharacterAnimation(myPlayerMesh, dt, time);

            const ud = myPlayerMesh.userData;
            const actions = ud.actions;

            // Fix: Use the computed 'isMoving' state from the Movement block
            // This ensures Auto-Run (which overrides moveForward) is respected.
            const isMoving = ud.isMoving;

            if (actions) {
                // If dead, don't update state (Death anim is playing once via listener)
                if (!ud.isDead) { // FIX: Changed from return to if block so we don't exit render loop
                    // Determine Target State
                    let targetAction = actions.idle;
                    // Use cached isMoving from Movement Block - This line is now redundant as `isMoving` is already defined above.

                    // HIT STATE (Exclusive)
                    if (ud.hitTimer > 0) {
                        ud.hitTimer -= dt;
                        if (actions.hit) {
                            targetAction = actions.hit;
                            targetAction.setLoop(THREE.LoopOnce);
                        }
                    } else if (!ud.isGrounded) {
                        // In Air: Play Run animation in slow motion (pseudo-jump)
                        targetAction = actions.run;
                        actions.run.timeScale = 0.5; // Slow
                        actions.run.setLoop(THREE.LoopRepeat);
                    } else if (isMoving) {
                        // On Ground: Run
                        targetAction = actions.run;
                        if (ud.isSprinting) {
                            actions.run.timeScale = 1.6; // Sprint Speed (Adjusted for 0.12 movement)
                        } else {
                            actions.run.timeScale = 1.3; // Normal Run Speed (Slightly slower than before to differentiate)
                        }
                        actions.run.setLoop(THREE.LoopRepeat);
                    } else {
                        targetAction = actions.idle;
                    }

                    // Crossfade if changed
                    if (ud.activeAction !== targetAction) {
                        // Initialize if null
                        if (!ud.activeAction) ud.activeAction = actions.idle;

                        const prev = ud.activeAction;
                        const next = targetAction;

                        // execute crossfade
                        prev.fadeOut(0.2);
                        next.reset().fadeIn(0.2).play();

                        ud.activeAction = next;
                    }
                }
                // End if (!ud.isDead) 
            }

            // Update Enemy Mixers and Logic
            Object.values(otherPlayers).forEach(mesh => {
                const ud = mesh.userData;

                // 1. Calculate Speed & Movement State
                if (!ud.lastPos) ud.lastPos = mesh.position.clone();

                const dist = mesh.position.distanceTo(ud.lastPos);
                const speed = dist / dt;

                // Set isMoving flag for Hit Logic
                ud.isMoving = dist > 0.001;

                // Update last pos
                ud.lastPos.copy(mesh.position);

                // Smoothed Movement State (Network Interpolation)
                if (speed > 0.1) {
                    ud.moveTimer = 0.2;
                } else {
                    if (ud.moveTimer > 0) ud.moveTimer -= dt;
                }

                if (mesh.mixer) {
                    const actions = ud.actions;
                    // ... (rest of mixer logic)

                    // 2. Determine Action
                    // If dead, do nothing (handled by event)
                    if (!ud.isDead && actions) {
                        let targetAction = actions.idle;

                        // HIT STATE (Exclusive)
                        if (ud.hitTimer > 0) {
                            ud.hitTimer -= dt;
                            if (actions.hit) {
                                targetAction = actions.hit;
                                targetAction.setLoop(THREE.LoopOnce);
                                targetAction.clampWhenFinished = true;
                            }
                        }
                        // RUN STATE
                        else if (ud.moveTimer > 0) {
                            targetAction = actions.run;
                            if (actions.run) {
                                actions.run.timeScale = 1.5;
                                actions.run.setLoop(THREE.LoopRepeat);
                            }
                        }

                        // 3. Crossfade
                        if (ud.activeAction !== targetAction) {
                            if (!ud.activeAction) ud.activeAction = actions.idle;
                            const prev = ud.activeAction;
                            const next = targetAction;

                            if (prev && next) {
                                prev.fadeOut(0.2);
                                next.reset().fadeIn(0.2).play();
                                ud.activeAction = next;
                            }
                        }
                    }
                    mesh.mixer.update(dt);
                }

                // 3. Update Procedural Animation (Recoil, etc)
                updateCharacterAnimation(mesh, dt, time);
            });

            if (myPlayerMesh) {
                // 3. Network Update
                // Send updates more frequently or if rotation changed significantly? 
                // For MVP, just send.
                socket.emit('playerMovement', {
                    x: myPlayerMesh.position.x,
                    y: myPlayerMesh.position.y,
                    z: myPlayerMesh.position.z,
                    rotation: myPlayerMesh.rotation.y,
                    pitch: pitchObject.rotation.x // Send vertical look
                });
            }

            // 4. Update Bullets
            bullets.forEach(b => b.position.add(b.userData.velocity));

            renderer.render(scene, camera);
        }
    }
}