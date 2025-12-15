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
    Spine: null
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
    rHandX: 0, rHandY: 0, rHandZ: 0,

    // Spine
    spineX: 0, spineY: 0, spineZ: 0,

    // Actions
    logValues: () => {
        const msg = `
GUN TRANSFORM (${guiParams.parent}):
Position: ${guiParams.gx.toFixed(3)}, ${guiParams.gy.toFixed(3)}, ${guiParams.gz.toFixed(3)}
Rotation: ${guiParams.grx.toFixed(1)}, ${guiParams.gry.toFixed(1)}, ${guiParams.grz.toFixed(1)}
Scale: ${guiParams.scale}

BONE ROTATIONS:
RightArm: ${guiParams.rArmX.toFixed(2)}, ${guiParams.rArmY.toFixed(2)}, ${guiParams.rArmZ.toFixed(2)}
RightForeArm: ${guiParams.rForeArmX.toFixed(2)}, ${guiParams.rForeArmY.toFixed(2)}, ${guiParams.rForeArmZ.toFixed(2)}
RightHand: ${guiParams.rHandX.toFixed(2)}, ${guiParams.rHandY.toFixed(2)}, ${guiParams.rHandZ.toFixed(2)}
Spine: ${guiParams.spineX.toFixed(2)}, ${guiParams.spineY.toFixed(2)}, ${guiParams.spineZ.toFixed(2)}
        `;
        console.log(msg);
        alert("Values logged to Console (Cmd+Option+J to view)");
    }
};

const loader = new THREE.GLTFLoader();

// --- INITIALIZATION ---
function init() {
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
    fTrans.add(guiParams, 'gx', -2, 2, 0.01);
    fTrans.add(guiParams, 'gy', -2, 2, 0.01);
    fTrans.add(guiParams, 'gz', -2, 2, 0.01);
    fTrans.add(guiParams, 'grx', -360, 360).name('Rot X (Deg)');
    fTrans.add(guiParams, 'gry', -360, 360).name('Rot Y (Deg)');
    fTrans.add(guiParams, 'grz', -360, 360).name('Rot Z (Deg)');
    fTrans.add(guiParams, 'scale', 0.1, 5);
    fTrans.open();

    // Bones
    const fBones = gui.addFolder('Bone Rotations');
    fBones.add(guiParams, 'rArmX', -3.2, 3.2, 0.01).name('R.Arm X');
    fBones.add(guiParams, 'rArmY', -3.2, 3.2, 0.01).name('R.Arm Y');
    fBones.add(guiParams, 'rArmZ', -3.2, 3.2, 0.01).name('R.Arm Z');
    fBones.add(guiParams, 'rForeArmX', -3.2, 3.2, 0.01).name('R.ForeArm X');
    fBones.add(guiParams, 'rForeArmY', -3.2, 3.2, 0.01).name('R.ForeArm Y');
    fBones.add(guiParams, 'rForeArmZ', -3.2, 3.2, 0.01).name('R.ForeArm Z');
    fBones.add(guiParams, 'rHandX', -3.2, 3.2, 0.01).name('R.Hand X');
    fBones.add(guiParams, 'rHandY', -3.2, 3.2, 0.01).name('R.Hand Y');
    fBones.add(guiParams, 'rHandZ', -3.2, 3.2, 0.01).name('R.Hand Z');
    fBones.open();

    gui.add(guiParams, 'logValues').name('LOG VALUES');
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

            // Update Animation GUI
            guiParams.anim = names[0] || 'Idle';
            // (If strictly needed, could update controller, but standard text edit works)

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
        // Default orientation fix? Most guns point -Z or +Z.
        updateGunParent();
    });
}

function updateGunParent() {
    if (!currentGunMesh) return;

    let parent = scene;
    if (guiParams.parent === 'RightHand' && bones.RightHand) parent = bones.RightHand;
    else if (guiParams.parent === 'Spine' && bones.Spine) parent = bones.Spine;

    parent.add(currentGunMesh);
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
        bones.RightArm.rotation.x += guiParams.rArmX;
        bones.RightArm.rotation.y += guiParams.rArmY;
        bones.RightArm.rotation.z += guiParams.rArmZ;
    }
    if (bones.RightForeArm) {
        bones.RightForeArm.rotation.x += guiParams.rForeArmX;
        bones.RightForeArm.rotation.y += guiParams.rForeArmY;
        bones.RightForeArm.rotation.z += guiParams.rForeArmZ;
    }
    if (bones.RightHand) {
        bones.RightHand.rotation.x += guiParams.rHandX;
        bones.RightHand.rotation.y += guiParams.rHandY;
        bones.RightHand.rotation.z += guiParams.rHandZ;
    }
    if (bones.Spine && (guiParams.spineX || guiParams.spineY || guiParams.spineZ)) {
        bones.Spine.rotation.x += guiParams.spineX;
        bones.Spine.rotation.y += guiParams.spineY;
        bones.Spine.rotation.z += guiParams.spineZ;
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
animate();
