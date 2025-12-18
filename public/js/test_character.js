// Basic Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// Lights
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff);
dirLight.position.set(3, 10, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// Grid
const grid = new THREE.GridHelper(100, 100);
scene.add(grid);

// DEBUG CUBE (Verify Scene is Rendering)
const debugCube = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }) // Red
);
debugCube.position.set(2, 1, 0);
scene.add(debugCube);

// --- CONFIG & ASSETS ---
const MODELS = {
    'Soldier': 'https://threejs.org/examples/models/gltf/Soldier.glb',
    'Adventurer': './glb/Adventurer.glb',
    'Punk': './glb/Punk.glb'
};

const GUNS = {
    'MPSD': 'guns/Mpsd.glb',
    'Sniper': 'guns/Sniper Rifle.glb'
};

// --- STATE ---
let characterMesh;
let currentGunMesh;
let mixer, actions = {};
let bones = {
    RightHand: null,
    RightArm: null,
    RightForeArm: null,
    Spine: null,

    // Left Arm
    LeftHand: null,
    LeftArm: null,
    LeftForeArm: null,

    // Fingers (Right)
    R_Thumb: [], R_Index: [], R_Middle: [], R_Ring: [], R_Pinky: [],
    // Fingers (Left)
    L_Thumb: [], L_Index: [], L_Middle: [], L_Ring: [], L_Pinky: []
};

// GUI Parameters
let guiParams = {
    // Character
    model: 'Soldier',
    anim: 'Idle',

    // Gun Config
    gunType: 'MPSD',
    parent: 'RightHand', // RightHand, Spine, Scene

    // Gun Transform (Local)
    gx: 0, gy: 0, gz: 0,
    grx: 0, gry: 0, grz: 0,
    scale: 1.5,

    // Bone Overrides
    // Right Arm
    rArmX: 0, rArmY: 0, rArmZ: 0,
    rForeArmX: 0, rForeArmY: 0, rForeArmZ: 0,
    // Hand
    // Hand
    rHandX: 0, rHandY: 0, rHandZ: 0,

    // Left Arm
    lArmX: 0, lArmY: 0, lArmZ: 0,
    lForeArmX: 0, lForeArmY: 0, lForeArmZ: 0,
    lHandX: 0, lHandY: 0, lHandZ: 0,

    // Fingers (Right) - Curl 0 to 2.5
    rThumbCurl: 0, rIndexCurl: 0, rMiddleCurl: 0, rRingCurl: 0, rPinkyCurl: 0,
    // Fingers (Left)
    lThumbCurl: 0, lIndexCurl: 0, lMiddleCurl: 0, lRingCurl: 0, lPinkyCurl: 0,

    // Spine
    spineX: 0, spineY: 0, spineZ: 0,

    // Actions
    logValues: () => {
        const fR = [guiParams.rThumbCurl, guiParams.rIndexCurl, guiParams.rMiddleCurl, guiParams.rRingCurl, guiParams.rPinkyCurl].map(v => v.toFixed(2)).join(', ');
        const fL = [guiParams.lThumbCurl, guiParams.lIndexCurl, guiParams.lMiddleCurl, guiParams.lRingCurl, guiParams.lPinkyCurl].map(v => v.toFixed(2)).join(', ');

        const msg = `
GUN TRANSFORM (${guiParams.parent}):
Position: ${guiParams.gx.toFixed(4)}, ${guiParams.gy.toFixed(4)}, ${guiParams.gz.toFixed(4)}
Rotation: ${guiParams.grx.toFixed(1)}, ${guiParams.gry.toFixed(1)}, ${guiParams.grz.toFixed(1)}
Scale: ${guiParams.scale}

BONE ROTATIONS (Right):
RightArm: ${guiParams.rArmX.toFixed(2)}, ${guiParams.rArmY.toFixed(2)}, ${guiParams.rArmZ.toFixed(2)}
RightForeArm: ${guiParams.rForeArmX.toFixed(2)}, ${guiParams.rForeArmY.toFixed(2)}, ${guiParams.rForeArmZ.toFixed(2)}
RightHand: ${guiParams.rHandX.toFixed(2)}, ${guiParams.rHandY.toFixed(2)}, ${guiParams.rHandZ.toFixed(2)}
Fingers (T,I,M,R,P): ${fR}

BONE ROTATIONS (Left):
LeftArm: ${guiParams.lArmX.toFixed(2)}, ${guiParams.lArmY.toFixed(2)}, ${guiParams.lArmZ.toFixed(2)}
LeftForeArm: ${guiParams.lForeArmX.toFixed(2)}, ${guiParams.lForeArmY.toFixed(2)}, ${guiParams.lForeArmZ.toFixed(2)}
LeftHand: ${guiParams.lHandX.toFixed(2)}, ${guiParams.lHandY.toFixed(2)}, ${guiParams.lHandZ.toFixed(2)}
Fingers (T,I,M,R,P): ${fL}

Spine: ${guiParams.spineX.toFixed(2)}, ${guiParams.spineY.toFixed(2)}, ${guiParams.spineZ.toFixed(2)}
        `;
        console.log(msg);
        alert("Values logged to Console (Cmd+Option+J to view)");
    },

    save: () => {
        saveCalibrationData();
    }
};

const loader = new THREE.GLTFLoader();

// --- INITIALIZATION ---
// --- INITIALIZATION ---
async function init() {
    await loadCalibrationData(); // Load saved values first
    initGUI();
    loadCharacter();
}

function initGUI() {
    const gui = new dat.GUI({ width: 300 });

    // Model
    gui.add(guiParams, 'model', Object.keys(MODELS)).onChange(loadCharacter);
    gui.add(guiParams, 'anim', ['Idle']).onChange(playAnim).listen(); // Updated dynamically

    // Gun
    const fGun = gui.addFolder('Weapon Config');
    fGun.add(guiParams, 'gunType', Object.keys(GUNS)).onChange(loadGun);
    fGun.add(guiParams, 'parent', ['RightHand', 'Spine', 'Scene']).onChange(updateGunParent);
    fGun.open();

    // Gun Transform
    const fTrans = gui.addFolder('Weapon Transform (Local)');
    fTrans.add(guiParams, 'gx', -2, 2, 0.000001);
    fTrans.add(guiParams, 'gy', -2, 2, 0.000001);
    fTrans.add(guiParams, 'gz', -2, 2, 0.000001);
    fTrans.add(guiParams, 'grx', -360, 360, 0.000001).name('Rot X (Deg)');
    fTrans.add(guiParams, 'gry', -360, 360, 0.000001).name('Rot Y (Deg)');
    fTrans.add(guiParams, 'grz', -360, 360, 0.000001).name('Rot Z (Deg)');
    fTrans.add(guiParams, 'scale', 0.0001, 5.0, 0.000001);
    fTrans.open();

    // Bones
    const fBones = gui.addFolder('Right Arm Rotations');
    fBones.add(guiParams, 'rArmX', -3.2, 3.2, 0.000001).name('R.Arm X');
    fBones.add(guiParams, 'rArmY', -3.2, 3.2, 0.000001).name('R.Arm Y');
    fBones.add(guiParams, 'rArmZ', -3.2, 3.2, 0.000001).name('R.Arm Z');
    fBones.add(guiParams, 'rForeArmX', -3.2, 3.2, 0.000001).name('R.ForeArm X');
    fBones.add(guiParams, 'rForeArmY', -3.2, 3.2, 0.000001).name('R.ForeArm Y');
    fBones.add(guiParams, 'rForeArmZ', -3.2, 3.2, 0.000001).name('R.ForeArm Z');
    fBones.add(guiParams, 'rHandX', -3.2, 3.2, 0.000001).name('R.Hand X');
    fBones.add(guiParams, 'rHandY', -3.2, 3.2, 0.000001).name('R.Hand Y');
    fBones.add(guiParams, 'rHandZ', -3.2, 3.2, 0.000001).name('R.Hand Z');
    fBones.open();

    const fRFingers = gui.addFolder('Right Hand Fingers (Curl)');
    fRFingers.add(guiParams, 'rThumbCurl', -1.0, 3.0, 0.000001).name('Thumb');
    fRFingers.add(guiParams, 'rIndexCurl', -1.0, 3.0, 0.000001).name('Index');
    fRFingers.add(guiParams, 'rMiddleCurl', -1.0, 3.0, 0.000001).name('Middle');
    fRFingers.add(guiParams, 'rRingCurl', -1.0, 3.0, 0.000001).name('Ring');
    fRFingers.add(guiParams, 'rPinkyCurl', -1.0, 3.0, 0.000001).name('Pinky');
    fRFingers.open();

    const fLeftBones = gui.addFolder('Left Arm Rotations');
    fLeftBones.add(guiParams, 'lArmX', -3.2, 3.2, 0.000001).name('L.Arm X');
    fLeftBones.add(guiParams, 'lArmY', -3.2, 3.2, 0.000001).name('L.Arm Y');
    fLeftBones.add(guiParams, 'lArmZ', -3.2, 3.2, 0.000001).name('L.Arm Z');
    fLeftBones.add(guiParams, 'lForeArmX', -3.2, 3.2, 0.000001).name('L.ForeArm X');
    fLeftBones.add(guiParams, 'lForeArmY', -3.2, 3.2, 0.000001).name('L.ForeArm Y');
    fLeftBones.add(guiParams, 'lForeArmZ', -3.2, 3.2, 0.000001).name('L.ForeArm Z');
    fLeftBones.add(guiParams, 'lHandX', -3.2, 3.2, 0.000001).name('L.Hand X');
    fLeftBones.add(guiParams, 'lHandY', -3.2, 3.2, 0.000001).name('L.Hand Y');
    fLeftBones.add(guiParams, 'lHandZ', -3.2, 3.2, 0.000001).name('L.Hand Z');
    fLeftBones.open();

    const fLFingers = gui.addFolder('Left Hand Fingers (Curl)');
    fLFingers.add(guiParams, 'lThumbCurl', -1.0, 3.0, 0.000001).name('Thumb');
    fLFingers.add(guiParams, 'lIndexCurl', -1.0, 3.0, 0.000001).name('Index');
    fLFingers.add(guiParams, 'lMiddleCurl', -1.0, 3.0, 0.000001).name('Middle');
    fLFingers.add(guiParams, 'lRingCurl', -1.0, 3.0, 0.000001).name('Ring');
    fLFingers.add(guiParams, 'lPinkyCurl', -1.0, 3.0, 0.000001).name('Pinky');
    fLFingers.open();

    gui.add(guiParams, 'logValues').name('LOG VALUES');
    gui.add(guiParams, 'save').name('💾 SAVE TO DB');
}

// --- LOADING ---
function loadCharacter() {
    if (characterMesh) {
        scene.remove(characterMesh);
        characterMesh = null;
    }

    // Remove helpers
    scene.children.filter(c => c.type === 'SkeletonHelper').forEach(s => scene.remove(s));

    console.log(`LOADING MODEL: ${guiParams.model} from ${MODELS[guiParams.model]}`);

    loader.load(
        MODELS[guiParams.model],
        (gltf) => {
            console.log("Model Loaded Successfully!");
            const model = gltf.scene;
            characterMesh = model;
            scene.add(model);

            model.traverse(o => {
                if (o.isMesh) {
                    o.castShadow = true;
                    if (o.material) o.material = o.material.clone();
                }
            });

            // Log Bones and Animations for Analysis
            console.log("--- BONE LIST ---");
            model.traverse(c => {
                if (c.isBone) console.log(c.name);
            });

            console.log("--- ANIMATIONS ---");
            gltf.animations.forEach(a => console.log(a.name));

            updateUniformColor();

            // Skeleton Helper
            const skeleton = new THREE.SkeletonHelper(model);
            scene.add(skeleton);

            // Animations
            mixer = new THREE.AnimationMixer(model);
            actions = {};
            const names = [];
            gltf.animations.forEach(a => {
                actions[a.name] = mixer.clipAction(a);
                names.push(a.name);
            });

            // Helper to find bone by multiple names or fuzzy search
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

            // Find Bones (Robust Search)
            bones.RightHand = findBone(['mixamorigRightHand', 'RightHand', 'HandR', 'WristR']);
            bones.RightArm = findBone(['mixamorigRightArm', 'RightArm', 'ArmR', 'UpperArmR']);
            bones.RightForeArm = findBone(['mixamorigRightForeArm', 'RightForeArm', 'ForeArmR', 'LowerArmR']);

            bones.LeftHand = findBone(['mixamorigLeftHand', 'LeftHand', 'HandL', 'WristL']);
            bones.LeftArm = findBone(['mixamorigLeftArm', 'LeftArm', 'ArmL', 'UpperArmL']);
            bones.LeftForeArm = findBone(['mixamorigLeftForeArm', 'LeftForeArm', 'ForeArmL', 'LowerArmL']);

            bones.Spine = findBone(['mixamorigSpine', 'Spine', 'Spine1', 'spines', 'Torso', 'Chest']);

            // Find Fingers
            const findFingerChain = (baseName, side) => {
                const chain = [];
                // Look for 1, 2, 3, 4 (e.g. Index1L or RightHandIndex1)
                for (let i = 1; i <= 4; i++) {
                    const candidates = [
                        // Pattern 1: Index1L (Adventurer)
                        `${baseName}${i}${side}`,
                        // Pattern 2: RightHandIndex1 (Mixamo)
                        `mixamorig${side === 'R' ? 'Right' : 'Left'}Hand${baseName}${i}`,
                        // Pattern 3: RightHandIndex1 (Standard)
                        `${side === 'R' ? 'Right' : 'Left'}Hand${baseName}${i}`
                    ];
                    const b = findBone(candidates);
                    if (b) chain.push(b);
                }
                return chain;
            };

            // Naming: Thumb, Index, Middle, Ring, Pinky
            bones.R_Thumb = findFingerChain('Thumb', 'R');
            bones.R_Index = findFingerChain('Index', 'R');
            bones.R_Middle = findFingerChain('Middle', 'R');
            bones.R_Ring = findFingerChain('Ring', 'R');
            bones.R_Pinky = findFingerChain('Pinky', 'R');

            bones.L_Thumb = findFingerChain('Thumb', 'L');
            bones.L_Index = findFingerChain('Index', 'L');
            bones.L_Middle = findFingerChain('Middle', 'L');
            bones.L_Ring = findFingerChain('Ring', 'L');
            bones.L_Pinky = findFingerChain('Pinky', 'L');


            console.log("--- DETECTED BONES ---");
            console.log("Spine:", bones.Spine ? bones.Spine.name : "MISSING");
            console.log("RightHand:", bones.RightHand ? bones.RightHand.name : "MISSING");
            console.log("LeftHand:", bones.LeftHand ? bones.LeftHand.name : "MISSING");

            // Update Animation GUI
            guiParams.anim = names[0] || 'Idle';

            playAnim();
            loadGun(); // Reload gun to attach to new mesh
        },
        (xhr) => {
            // console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        (error) => {
            console.error("An error happened loading the model:", error);
            alert("Error Loading Model! Open Console.");
        }
    );
}

function loadGun() {
    if (currentGunMesh) {
        if (currentGunMesh.parent) currentGunMesh.parent.remove(currentGunMesh);
        currentGunMesh = null;
    }

    loader.load(GUNS[guiParams.gunType], (gltf) => {
        currentGunMesh = gltf.scene;
        // Fix Gimbal Lock issues by changing order
        currentGunMesh.rotation.order = 'YXZ';

        // Initial Context from current Parent selection
        const context = (guiParams.parent === 'Spine') ? 'back' : 'hand';
        loadWrapper(guiParams.gunType, context);
    });
}

// Helper to load and update
function loadWrapper(gunType, context) {
    // 1. Try DB
    loadCalibrationData(gunType, context).then(loaded => {
        if (!loaded) {
            // 2. Try Code Presets
            if (window.WEAPON_SPECS && window.WEAPON_SPECS[gunType]) {
                const spec = window.WEAPON_SPECS[gunType];
                const cfg = spec[context]; // 'hand' or 'back'

                if (cfg) {
                    console.log(`Loading Code Preset for ${gunType} (${context})`);
                    guiParams.gx = cfg.pos.x;
                    guiParams.gy = cfg.pos.y;
                    guiParams.gz = cfg.pos.z;
                    guiParams.grx = THREE.MathUtils.radToDeg(cfg.rot.x);
                    guiParams.gry = THREE.MathUtils.radToDeg(cfg.rot.y);
                    guiParams.grz = THREE.MathUtils.radToDeg(cfg.rot.z);
                    guiParams.scale = cfg.scale;
                }
            }
        }
        updateGunParent(false); // Update parent but don't re-trigger load
    });
}

function updateGunParent(shouldLoad = true) {
    if (shouldLoad) {
        // If user changed parent in dropdown, we should load that context's data
        const context = (guiParams.parent === 'Spine') ? 'back' : 'hand';
        loadWrapper(guiParams.gunType, context);
        return; // loadWrapper will call updateGunParent(false)
    }

    if (!currentGunMesh) return;

    let parent = scene;
    let parentName = "Scene (Ground)";

    if (guiParams.parent === 'RightHand') {
        if (bones.RightHand) {
            parent = bones.RightHand;
            parentName = "RightHand (" + bones.RightHand.name + ")";
        } else {
            console.warn("RightHand Bone Not Found! Check Console.");
            alert("RightHand Bone Not Found! Using Scene/Ground.");
        }
    }
    else if (guiParams.parent === 'Spine') {
        if (bones.Spine) {
            parent = bones.Spine;
            parentName = "Spine (" + bones.Spine.name + ")";
        } else {
            console.warn("Spine Bone Not Found! Check Console.");
            alert("Spine Bone Not Found! Using Scene/Ground.");
        }
    }

    parent.add(currentGunMesh);
    console.log(`Attached Gun to: ${parentName}`);

    // Check Parent Scale
    const s = new THREE.Vector3();
    parent.getWorldScale(s);
    console.log(`${parentName} World Scale: ${s.x.toFixed(3)}, ${s.y.toFixed(3)}, ${s.z.toFixed(3)}`);
}

function updateColors() {
    updateUniformColor();
}

function updateUniformColor() {
    // Only color the Soldier (who has no texture). Adventurer/Punk have textures.
    if (guiParams.model === 'Soldier') {
        if (characterMesh) {
            characterMesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.color.set(guiParams.uniform);
                }
            });
        }
    }
}

function playAnim() {
    if (!mixer) return;
    mixer.stopAllAction();
    if (actions[guiParams.anim]) actions[guiParams.anim].play();
}

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (mixer) mixer.update(dt);

    // Apply Bone Overrides (Post-Animation)
    // We do this every frame to override the animation pose
    if (bones.RightArm) {
        bones.RightArm.rotation.x = guiParams.rArmX;
        bones.RightArm.rotation.y = guiParams.rArmY;
        bones.RightArm.rotation.z = guiParams.rArmZ;
    }
    if (bones.RightForeArm) {
        bones.RightForeArm.rotation.x = guiParams.rForeArmX;
        bones.RightForeArm.rotation.y = guiParams.rForeArmY;
        bones.RightForeArm.rotation.z = guiParams.rForeArmZ;
    }
    if (bones.RightHand) {
        bones.RightHand.rotation.x = guiParams.rHandX;
        bones.RightHand.rotation.y = guiParams.rHandY;
        bones.RightHand.rotation.z = guiParams.rHandZ;
    }
    // Left Arm
    if (bones.LeftArm) {
        bones.LeftArm.rotation.x = guiParams.lArmX;
        bones.LeftArm.rotation.y = guiParams.lArmY;
        bones.LeftArm.rotation.z = guiParams.lArmZ;
    }
    if (bones.LeftForeArm) {
        bones.LeftForeArm.rotation.x = guiParams.lForeArmX;
        bones.LeftForeArm.rotation.y = guiParams.lForeArmY;
        bones.LeftForeArm.rotation.z = guiParams.lForeArmZ;
    }
    if (bones.LeftHand) {
        bones.LeftHand.rotation.x = guiParams.lHandX;
        bones.LeftHand.rotation.y = guiParams.lHandY;
        bones.LeftHand.rotation.z = guiParams.lHandZ;
    }

    // Finger Curls
    const applyCurl = (chain, val) => {
        chain.forEach(b => {
            // Z rotation is standard curl for Mixamo
            // but user wants to control it.
            // We'll set X to keep it simple, or Z. 
            // Try Z first.
            b.rotation.z = val; // Usually curl
        });
    };

    if (bones.R_Thumb) applyCurl(bones.R_Thumb, guiParams.rThumbCurl);
    if (bones.R_Index) applyCurl(bones.R_Index, guiParams.rIndexCurl);
    if (bones.R_Middle) applyCurl(bones.R_Middle, guiParams.rMiddleCurl);
    if (bones.R_Ring) applyCurl(bones.R_Ring, guiParams.rRingCurl);
    if (bones.R_Pinky) applyCurl(bones.R_Pinky, guiParams.rPinkyCurl);

    if (bones.L_Thumb) applyCurl(bones.L_Thumb, guiParams.lThumbCurl);
    if (bones.L_Index) applyCurl(bones.L_Index, guiParams.lIndexCurl);
    if (bones.L_Middle) applyCurl(bones.L_Middle, guiParams.lMiddleCurl);
    if (bones.L_Ring) applyCurl(bones.L_Ring, guiParams.lRingCurl);
    if (bones.L_Pinky) applyCurl(bones.L_Pinky, guiParams.lPinkyCurl);
    if (bones.Spine && (guiParams.spineX || guiParams.spineY || guiParams.spineZ)) {
        bones.Spine.rotation.x = guiParams.spineX;
        bones.Spine.rotation.y = guiParams.spineY;
        bones.Spine.rotation.z = guiParams.spineZ;
    }

    // Apply Gun Transform
    if (currentGunMesh) {
        currentGunMesh.position.set(guiParams.gx, guiParams.gy, guiParams.gz);
        currentGunMesh.rotation.set(
            THREE.Math.degToRad(guiParams.grx),
            THREE.Math.degToRad(guiParams.gry),
            THREE.Math.degToRad(guiParams.grz)
        );
        currentGunMesh.scale.set(guiParams.scale, guiParams.scale, guiParams.scale);
    }

    renderer.render(scene, camera);
}

init();

// Handle Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start Loop
// Start Loop
animate();

// --- PERSISTENCE ---
async function saveCalibrationData() {
    const data = { ...guiParams };
    delete data.logValues;
    delete data.save;

    // Determine Context: Hand or Back?
    const context = (guiParams.parent === 'Spine') ? 'back' : 'hand';

    // KEY: sandbox_GunName_Context (e.g., sandbox_Sniper_hand)
    // We save this SPECIFIC STATE.
    const typeKey = `sandbox_${guiParams.gunType}_${context}`;

    try {
        const res = await fetch('/api/calibration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: typeKey, data: data })
        });
        const json = await res.json();
        if (json.success) {
            alert(`Saved to ${typeKey}!`);
        } else {
            alert("Save Failed: " + json.error);
        }
    } catch (e) {
        console.error(e);
        alert("Save Error (Check Console)");
    }
}

async function loadCalibrationData(gunType, context) {
    // If context not provided, guess? No, we demand context.
    // context: 'hand' or 'back'
    if (!context) context = 'hand';

    // Try specific key first: sandbox_Sniper_hand
    const typeKey = `sandbox_${gunType}_${context}`;

    try {
        let res = await fetch(`/api/calibration/${typeKey}`);
        let data = await res.json();

        // Fallback to legacy 'sandbox_Sniper' if new key not found?
        // Maybe. But for now let's stick to the new strict scheme.

        if (data && Object.keys(data).length > 0) {
            console.log(`Loaded Calibration for ${typeKey}:`, data);

            // We ONLY want to overwrite the Transform variables (gx, gy, gz, grx, gry, grz, scale)
            // We do NOT want to overwrite 'parent' or 'gunType', or we get loops.

            guiParams.gx = data.gx !== undefined ? data.gx : guiParams.gx;
            guiParams.gy = data.gy !== undefined ? data.gy : guiParams.gy;
            guiParams.gz = data.gz !== undefined ? data.gz : guiParams.gz;

            guiParams.grx = data.grx !== undefined ? data.grx : guiParams.grx;
            guiParams.gry = data.gry !== undefined ? data.gry : guiParams.gry;
            guiParams.grz = data.grz !== undefined ? data.grz : guiParams.grz;

            guiParams.scale = data.scale !== undefined ? data.scale : guiParams.scale;

            // Also bone rotations might be saved in data, restore them if present
            // (The user might have tweaked arm pos for the gun)
            Object.keys(data).forEach(k => {
                if (k.startsWith('rArm') || k.startsWith('lArm') || k.startsWith('spine') || k.endsWith('Curl')) {
                    guiParams[k] = data[k];
                }
            });

            return true;
        }
        return false;
    } catch (e) {
        console.warn("Could not load calibration data", e);
        return false;
    }
}
