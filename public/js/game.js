// --- GLOBAL VARIABLES ---
let camera, scene, renderer;

Network.init(); // Initialize Network
let myPlayerMesh;
let otherPlayers = {};
let bullets = [];
let damagePopups = []; // Floating numbers
// let keys = ... removed (Controls.js)

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

// Drops & Items

window.worldItems = []; // Array of { mesh, type, collider }

// Variables for Controls
let pitchObject, yawObject;
let isLocked = false;
let isFirstPerson = true;

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
    Network.signup(user, pass);
}

function doLogin() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const model = document.getElementById('char-select').value;
    Network.login(user, pass, model);
}

// Listeners moved to Network.js

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

// --- ITEM SPAWNER ---






// --- INITIALIZATION ---
function initGame(playerData) {
    // socket is handled by Network
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
    floor.receiveShadow = true;
    scene.add(floor);

    // Spawn Demo Guns
    spawnWorldGun('MPSD', new THREE.Vector3(2, 0, 5));
    spawnWorldGun('Sniper', new THREE.Vector3(-2, 0, 5));
    spawnWorldGun('MPSD', new THREE.Vector3(5, 0, 0)); // Various spots
    spawnWorldGun('Sniper', new THREE.Vector3(-5, 0, 10));

    scene.add(yawObject); // Add camera control to scene

    // --- 3D AUDIO SETUP (Opponents) ---
    const listener = new THREE.AudioListener();
    camera.add(listener);
    window.audioListener = listener; // Global access for addEnemy

    const audioLoader = new THREE.AudioLoader();
    window.enemyStepBuffer = null;
    audioLoader.load('sound-effect/Steps_dirt-017.ogg', function (buffer) {
        window.enemyStepBuffer = buffer;
    });

    // 7. Network Listeners moved to Network.js

    // Blood System moved to Global Scope

    // --- CONTROLS INIT ---
    Controls.init(camera, yawObject, pitchObject);

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
            Network.sendHit(targetId, 10);
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
    leftHand: ['mixamorigLeftHand', 'LeftHand', 'WristL'],
    spine: ['mixamorigSpine', 'Spine', 'Chest', 'Torso'],
    head: ['mixamorigHead', 'Head'],
    leftLeg: ['mixamorigLeftUpLeg', 'UpperLegL', 'LeftUpLeg', 'UpLegL', 'ThighL'],
    rightLeg: ['mixamorigRightUpLeg', 'UpperLegR', 'RightUpLeg', 'UpLegR', 'ThighR']
};

// Procedural Low-Poly AK47


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

        // Bone Helper (Robust Fuzzy Search)
        const findBone = (candidates) => {
            // 1. Exact Name Match
            for (const name of candidates) {
                const bone = model.getObjectByName(name);
                if (bone) return bone;
            }
            // 2. Fuzzy Search (Includes)
            let found = null;
            model.traverse(c => {
                if (found) return;
                if (c.isBone) {
                    const lowName = c.name.toLowerCase();
                    for (const name of candidates) {
                        if (lowName.includes(name.toLowerCase())) {
                            found = c;
                            return;
                        }
                    }
                }
            });
            return found;
        };

        const getBone = (names) => findBone(names); // shim

        const findFingerChain = (baseName, side) => {
            const chain = [];
            for (let i = 1; i <= 4; i++) {
                const candidates = [
                    `${baseName}${i}${side}`,
                    `mixamorig${side === 'R' ? 'Right' : 'Left'}Hand${baseName}${i}`,
                    `${side === 'R' ? 'Right' : 'Left'}Hand${baseName}${i}`
                ];
                const b = findBone(candidates);
                if (b) chain.push(b);
            }
            return chain;
        };

        // Find Fingers
        const rThumb = findFingerChain('Thumb', 'R');
        const rIndex = findFingerChain('Index', 'R');
        const rMiddle = findFingerChain('Middle', 'R');
        const rRing = findFingerChain('Ring', 'R');
        const rPinky = findFingerChain('Pinky', 'R');

        const lThumb = findFingerChain('Thumb', 'L');
        const lIndex = findFingerChain('Index', 'L');
        const lMiddle = findFingerChain('Middle', 'L');
        const lRing = findFingerChain('Ring', 'L');
        const lPinky = findFingerChain('Pinky', 'L');

        const rightHand = getBone(BONE_MAPPINGS.rightHand);

        // Declare variables for scope
        let muzzle = null;
        let muzzleFlash = null;
        let rightArm = null;
        let rightForeArm = null;
        let leftArm = null;
        let leftForeArm = null;
        let leftHand = null;
        let spine = null;
        let head = null;
        let leftLeg = null;
        let rightLeg = null;
        let aimBone = null;

        let restRotations = {};

        if (rightHand) {
            // Find the Arm Bones for Two-Handed Hold
            const rArm = getBone(BONE_MAPPINGS.rightArm);
            rightForeArm = getBone(BONE_MAPPINGS.rightForeArm);
            leftArm = getBone(BONE_MAPPINGS.leftArm);
            leftForeArm = getBone(BONE_MAPPINGS.leftForeArm);
            leftHand = getBone(BONE_MAPPINGS.leftHand);
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

            // Capture Rest Rotations (for unequip reset)
            [rightArm, rightForeArm, rightHand, leftArm, leftForeArm, leftHand].forEach(b => {
                if (b) restRotations[b.name] = b.rotation.clone();
            });

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
                leftHand: leftHand,
                spine: spine,
                head: head, // For Pitch
                leftLeg: leftLeg,
                rightLeg: rightLeg,
                aimBone: aimBone,
                currentRecoil: 0,
                currentRecoil: 0,
                shootTimer: 0, // For animation
                isMoving: false,
                fingers: {
                    rThumb, rIndex, rMiddle, rRing, rPinky,
                    lThumb, lIndex, lMiddle, lRing, lPinky
                },
                restRotations: restRotations,
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
    // Prevent Duplicates
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }

    loadCharacter(data.model || 'Soldier', 0x00ff00, false, (charData) => {
        const enemy = charData.mesh;
        enemy.position.set(data.x, data.y, data.z);

        // --- 3D AUDIO ---
        if (window.audioListener && window.enemyStepBuffer) {
            const sound = new THREE.PositionalAudio(window.audioListener);
            sound.setBuffer(window.enemyStepBuffer);
            sound.setRefDistance(5); // Distance where volume begins to fade
            sound.setMaxDistance(50); // Audibility range
            sound.setVolume(1.0); // Base volume (attenuated by distance)
            enemy.add(sound);
            enemy.userData.sound = sound;
        }

        // Store mesh in map
        otherPlayers[id] = enemy;
        scene.add(enemy);

        // Load Opponent Guns (From Inventory Data)
        if (data.inventory && Array.isArray(data.inventory)) {
            data.inventory.forEach((type) => {
                // If type is object (from some legacy code), extract type property? 
                // Assuming string 'MPSD' etc.
                const url = GUN_ASSETS[type] || GUN_ASSETS['MPSD'];

                const loader = new THREE.GLTFLoader();
                loader.load(url, (gltf) => {
                    const gun = gltf.scene;
                    gun.userData.pickupType = type;
                    gun.traverse(c => {
                        if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
                        c.userData.isGun = true;
                    });
                    attachGunToBack(enemy, gun);
                });
            });
        }
    });
}

// Auto-Fire State
const SFX_JUMP = new Audio('sound-effect/jumpland.wav');
const SFX_STEP = new Audio('sound-effect/Steps_dirt-017.ogg');

// Volume Configuration
const VOL_RUN = 0.26; // Drastically reduced
const VOL_JUMP = 0.12; // Drastically reduced



function playSound(audioSource, volume) {
    const s = audioSource.cloneNode();
    s.volume = Math.min(1.0, Math.max(0, volume));
    s.play().catch(() => { });
}

// Controls managed by controls.js
// let isFiring = false; 
// let isSprintToggled = false; 
let lastShotTime = 0;
const FIRE_RATE = 0.15; // Seconds between shots

function attemptShoot() {
    const now = Date.now() * 0.001;
    lastFireTime = now;

    if (myPlayerMesh) {
        // FIX: Prevent shooting if dead
        if (myPlayerMesh.userData.isDead) return;

        // Recoil Impulse
        if (!myPlayerMesh.userData.currentRecoil) myPlayerMesh.userData.currentRecoil = 0;
        myPlayerMesh.userData.currentRecoil += 0.2; // Aim kick up

        // Procedural Animation Trigger (Spine + Flash)
        myPlayerMesh.userData.shootTimer = 0.1;

        // Shoot locally (Visual)
        createBullet(true); // Fixed: Pass true for isLocal
        Network.sendShoot();

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

                Network.sendHit(targetId, 10);
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

    // --- WEAPON POSTURE (Overrides) ---
    if (ud.equippedSlot !== undefined && ud.equippedSlot !== null) {
        const pose = CALIBRATION.HOLDING_POSE;

        const applyRot = (boneName, mapKey) => {
            if (ud[boneName]) {
                const e = pose[mapKey];
                ud[boneName].rotation.set(e.x, e.y, e.z);
            }
        };

        applyRot('rightArm', 'rightArm');
        applyRot('rightForeArm', 'rightForeArm');
        applyRot('rightHand', 'rightHand');
        applyRot('leftArm', 'leftArm');
        applyRot('leftForeArm', 'leftForeArm');
        applyRot('leftHand', 'leftHand');
    }

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
    */


}



// onMouseMove removed (Moved to Controls.js)

// Time Tracking
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    // Auto-Fire Check
    if (Controls.isFiring) {
        // Enforce Weapon Equipped
        if (!myPlayerMesh || myPlayerMesh.userData.equippedSlot === null || myPlayerMesh.userData.isDead) {
            // Controls.isFiring = false; // Should we force reset? Maybe not.
        } else {
            attemptShoot();
        }
    }

    // Toggle Weapons
    // Toggle Weapons handled in Controls onKeyDown for 1/2
    // But animate loop logic for 'Single Trigger' was checking keys['1']. 
    // Controls handles the event calls directly. So we can remove this block.
    // Or if we need single frame trigger, we should trust `toggleWeapon` called from `onKeyDown`.
    // Validated: onKeyDown calls `toggleWeapon`. This polling block is invalid now.

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

        // 2. Movement Inputs (From Controls)
        const input = Controls.getMovementDirection(); // returns {w,a,s,d,space,shift}

        let moveForward = input.w;

        // FIX: Disable movement if dead
        if (myPlayerMesh.userData.isDead) {
            moveForward = false;
        }

        const moveBackward = input.s;
        const moveLeft = input.a;
        const moveRight = input.d;
        const isSprint = input.shift;

        // Wait, input.shift includes toggle logic from Controls? Yes we updated it.
        // Actually Controls.getMovementDirection().shift is based on Key Shift OR Toggle.

        // Override Sprint variable locally
        isSprintToggled = isSprint; // Keep game var in sync if used elsewhere

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
        if (window.isCalibrationMode) {
            if (window.updateCalibration) window.updateCalibration();
            // In calibration mode, we let OrbitControls handle camera.
            // We still update player model animations below.

            // Keep yawObject following player so when we exit, we are at right spot
            yawObject.position.copy(myPlayerMesh.position);
            yawObject.position.y += 1.6;
        } else {
            // Apply Rotation
            if (hasInput) {
                // ... normal rotation logic ...
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
        }

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

        // --- ITEM PICKUP LOGIC ---
        for (let i = worldItems.length - 1; i >= 0; i--) {
            const item = worldItems[i];

            // Float & Rotate
            item.rotation.y += dt;
            item.position.y = 0.5 + Math.sin(time * 2 + item.userData.floatPhase) * 0.1;

            // Distance Check
            const dist = myPlayerMesh.position.distanceTo(item.position);
            if (dist < 1.5) {
                // Pickup Check
                if (!myPlayerMesh.userData.backGuns) myPlayerMesh.userData.backGuns = [];

                if (myPlayerMesh.userData.backGuns.length < 2) {
                    // Pickup
                    worldItems.splice(i, 1); // Remove from list
                    attachGunToBack(myPlayerMesh, item);

                    // Sync Inventory to Server
                    const inv = myPlayerMesh.userData.backGuns.map(g => g.userData.pickupType || 'Default');
                    Network.sendInventory(inv);

                    // Simple Feedback Log
                    console.log("Picked up " + item.userData.pickupType);
                }
            }
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
        // Jump Input
        if (input.space && isGrounded) {
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
            // updateCharacterAnimation call moved to after mixer.update
            const isMovingInput = input.w || input.s || input.a || input.d;

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

                    // --- 3D AUDIO TRIGGER ---
                    if (ud.sound && ud.sound.buffer) { // Check buffer loaded
                        if (ud.stepTimer === undefined) ud.stepTimer = 0;
                        ud.stepTimer -= dt;
                        if (ud.stepTimer <= 0) {
                            if (ud.sound.isPlaying) ud.sound.stop();
                            ud.sound.play(); // Spatial Audio
                            ud.stepTimer = 0.35; // Loop interval
                        }
                    }
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
                Network.sendMovement({
                    x: myPlayerMesh.position.x,
                    y: myPlayerMesh.position.y,
                    z: myPlayerMesh.position.z,
                    rotation: myPlayerMesh.rotation.y,
                    pitch: pitchObject.rotation.x, // Send vertical look
                    equippedSlot: myPlayerMesh.userData.equippedSlot
                });
            }

            // 4. Update Bullets
            bullets.forEach(b => b.position.add(b.userData.velocity));

            renderer.render(scene, camera);
        }
    }
}