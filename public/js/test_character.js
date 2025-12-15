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

// --- GUN CREATION (Mirrored from game.js) ---
function createGun() {
    const gunGroup = new THREE.Group();

    // Low Poly AK47 Procedural
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });

    // 1. Stock (Wood)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.4), woodMaterial);
    stock.position.set(0, -0.05, -0.3);
    gunGroup.add(stock);

    // 2. Main Body (Metal)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.4), darkMaterial);
    body.position.set(0, 0, 0.1);
    gunGroup.add(body);

    // 3. Magazine (Metal)
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

    return { group: gunGroup, muzzle: muzzle };
}

// Global Vars for GUI
let armyGun = null;
let gunBodyMat = null;
let gunWoodMat = null;

// Bones
let rightArmBone = null;
let rightForeArmBone = null;
let leftArmBone = null;
let leftForeArmBone = null;
let spineBone = null;

let guiParams = {
    // Gun Transform
    x: -5,
    y: -5,
    z: 5,

    rx: -261,
    ry: -198,
    rz: 1,

    scale: 76.0,

    // Right Arm (Aiming)
    rArmX: 0.84,
    rArmY: 0.43,
    rArmZ: 0.57,

    // Right Forearm
    rForeArmX: 1,
    rForeArmY: 1,
    rForeArmZ: 0,

    // Left Arm (Reaching for Barrel)
    lArmX: -0.55,
    lArmY: -0.96,
    lArmZ: -5.5,

    // Left Forearm (Bent to hold foregrip)
    lForeArmX: 0.15,
    lForeArmY: -0.4,
    lForeArmZ: -4.9,

    // Spine (Twist to align shoulders)
    spineX: 0,
    spineY: 0.4,

    // Animations
    anim: 'Idle',

    // Colors
    gunBody: '#333333',
    gunWood: '#8B4513',
    uniform: '#5555ff', // Default blue-ish

    // Model Selection
    model: 'Soldier'
};

const loader = new THREE.GLTFLoader();

const MODELS = {
    'Soldier': 'https://threejs.org/examples/models/gltf/Soldier.glb',
    'Adventurer': './glb/Adventurer.glb',
    'Punk': './glb/Punk.glb'
};

let mixer = null;
let actions = {};
let soldierMesh = null;

// Initial Load
// initGUI(); // Moved to inside loadSelectModel callback
loadSelectModel('Soldier');

function loadSelectModel(key) {
    if (soldierMesh) {
        scene.remove(soldierMesh);
        soldierMesh = null;
    }
    // Remove skeleton helper if exists (it's added to scene directly in current code)
    // We should track it to remove it. For now, let's just clear scene helpers? 
    // Actually safe way:
    scene.children.forEach(c => {
        if (c.type === 'SkeletonHelper') scene.remove(c);
    });

    const url = MODELS[key];
    console.log(`LOADING MODEL: ${key} from ${url}`);

    loader.load(url, (gltf) => {
        const model = gltf.scene;
        soldierMesh = model;
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
        // Clear previous actions
        // Populate ALL Actions
        actions = {};
        const animNames = [];
        gltf.animations.forEach(a => {
            actions[a.name] = mixer.clipAction(a);
            animNames.push(a.name);
        });

        // Play first animation by default
        if (animNames.length > 0) {
            guiParams.anim = animNames[0];
            playAnim();
        }

        // Attach Gun - DISABLED
        /*
        const rightHand = getBone(['mixamorigRightHand', 'RightHand', 'WristR']);

        // Get Bones (Save refs)
        rightArmBone = getBone(['mixamorigRightArm', 'RightArm', 'UpperArmR']);
        rightForeArmBone = getBone(['mixamorigRightForeArm', 'RightForeArm', 'LowerArmR']);
        leftArmBone = getBone(['mixamorigLeftArm', 'LeftArm', 'UpperArmL']);
        leftForeArmBone = getBone(['mixamorigLeftForeArm', 'LeftForeArm', 'LowerArmL']);
        spineBone = getBone(['mixamorigSpine', 'Spine', 'Chest', 'Torso']);

        if (rightHand) {
            // Remove existing gun if any
            if (armyGun && armyGun.parent) {
                armyGun.parent.remove(armyGun);
            }
            const gunData = createGun();
            armyGun = gunData.group;

            // Adjust Gun Position for Wrist Bone?
            // Wrist is further back than Hand. We might need to move gun forward.
            // Let's rely on the GUI sliders for that (User can adjust x/y/z).

            rightHand.add(armyGun);
            updateGunTransform();
        } else {
            console.error("COULD NOT FIND RIGHT HAND BONE!");
        }
        */

        // Re-Init GUI to update Animation Dropdown
        if (window.gui) window.gui.destroy();
        initGUI(animNames);
    });
}

function updateColors() {
    if (gunBodyMat) gunBodyMat.color.set(guiParams.gunBody);
    if (gunWoodMat) gunWoodMat.color.set(guiParams.gunWood);
    updateUniformColor();
}

function updateUniformColor() {
    // Only color the Soldier (who has no texture). Adventurer/Punk have textures.
    if (guiParams.model === 'Soldier') {
        if (soldierMesh) {
            soldierMesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.color.set(guiParams.uniform);
                }
            });
        }
    }
}

function initGUI(animOptions = ['Idle']) {
    const gui = new dat.GUI();
    window.gui = gui; // Save ref to destroy later

    // Model Selection
    gui.add(guiParams, 'model', ['Soldier', 'Adventurer', 'Punk']).onChange(loadSelectModel);

    // Gun Transform
    const folderPos = gui.addFolder('Gun Position');
    folderPos.add(guiParams, 'x', -5, 5).onChange(updateGunTransform);
    folderPos.add(guiParams, 'y', -5, 5).onChange(updateGunTransform);
    folderPos.add(guiParams, 'z', -5, 5).onChange(updateGunTransform);

    const folderRot = gui.addFolder('Gun Rotation (Deg)');
    folderRot.add(guiParams, 'rx', -360, 360).onChange(updateGunTransform);
    folderRot.add(guiParams, 'ry', -360, 360).onChange(updateGunTransform);
    folderRot.add(guiParams, 'rz', -360, 360).onChange(updateGunTransform);

    const folderScale = gui.addFolder('Scale');
    folderScale.add(guiParams, 'scale', 1, 200).onChange(updateGunTransform);

    // Right Arm
    const folderRArm = gui.addFolder('Right Arm');
    folderRArm.add(guiParams, 'rArmX', -6.3, 6.3);
    folderRArm.add(guiParams, 'rArmY', -6.3, 6.3);
    folderRArm.add(guiParams, 'rArmZ', -6.3, 6.3);
    folderRArm.add(guiParams, 'rForeArmX', -6.3, 6.3);
    folderRArm.add(guiParams, 'rForeArmY', -6.3, 6.3);
    folderRArm.add(guiParams, 'rForeArmZ', -6.3, 6.3);

    // Left Arm
    const folderLArm = gui.addFolder('Left Arm');
    folderLArm.add(guiParams, 'lArmX', -6.3, 6.3);
    folderLArm.add(guiParams, 'lArmY', -6.3, 6.3);
    folderLArm.add(guiParams, 'lArmZ', -6.3, 6.3);
    folderLArm.add(guiParams, 'lForeArmX', -6.3, 6.3);
    folderLArm.add(guiParams, 'lForeArmY', -6.3, 6.3);
    folderLArm.add(guiParams, 'lForeArmZ', -6.3, 6.3);

    // Spine
    const folderSpine = gui.addFolder('Spine');
    folderSpine.add(guiParams, 'spineX', -3, 3);
    folderSpine.add(guiParams, 'spineY', -3, 3);

    const folderColors = gui.addFolder('Colors');
    folderColors.addColor(guiParams, 'gunBody').onChange(updateColors);
    folderColors.addColor(guiParams, 'gunWood').onChange(updateColors);
    folderColors.addColor(guiParams, 'uniform').onChange(updateColors);

    const folderAnim = gui.addFolder('Animations');
    folderAnim.add(guiParams, 'anim', animOptions).onChange(playAnim);

    folderPos.open();
    // folderRot.open();
    folderAnim.open();
}

// Global playAnim helper
function playAnim() {
    if (!mixer) return;
    Object.values(actions).forEach(a => a.stop());
    if (actions[guiParams.anim]) {
        actions[guiParams.anim].play();
    }
}

function updateGunTransform() {
    if (!armyGun) return;
    armyGun.position.set(guiParams.x, guiParams.y, guiParams.z);

    // Deg to Rad
    armyGun.rotation.set(
        THREE.Math.degToRad(guiParams.rx),
        THREE.Math.degToRad(guiParams.ry),
        THREE.Math.degToRad(guiParams.rz)
    );

    armyGun.scale.set(guiParams.scale, guiParams.scale, guiParams.scale);
}

// Animate Loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);

    /* DISABLED: User Request - No procedural override
    if (spineBone && (guiParams.spineX !== 0 || guiParams.spineY !== 0)) {
        spineBone.rotation.x += guiParams.spineX;
        spineBone.rotation.y += guiParams.spineY;
    }
    
    // Update gun transform and colors based on GUI
    updateGunTransform(); // Keep this? User said "remove gun".
    // If gun is removed from parent, transform update doesn't matter visually.
    updateColors();
    */

    // Force update colors just in case (or remove if texture handles it)
    updateColors();

    renderer.render(scene, camera);
}
animate();

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
