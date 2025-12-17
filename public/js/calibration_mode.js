
// ==========================================
// --- IN-GAME CALIBRATION MODE (Dev Tool) ---
// ==========================================
window.isCalibrationMode = false; // Expose global
let orbitalControls = null;
let gui = null;
let savedCameraParent = null;

// Initialize GUI and Controls
window.initCalibrationMode = function () {
    if (gui) return; // Already init

    // 1. Orbit Controls (Global camera)
    orbitalControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitalControls.enableDamping = true;
    orbitalControls.dampingFactor = 0.05;
    orbitalControls.enabled = false;

    // 2. GUI Setup
    gui = new dat.GUI({ autoPlace: true, width: 350 });
    gui.domElement.style.position = 'absolute';
    gui.domElement.style.top = '10px';
    gui.domElement.style.right = '10px';
    gui.domElement.style.zIndex = '1000';
    gui.hide();

    const pose = CALIBRATION.HOLDING_POSE;
    const hand = CALIBRATION.HAND_TRANSFORM;


    // Helper to add rotation slider
    const addRot = (folder, obj, name, key) => {
        // Convert rad to deg for GUI
        // We create a live binding
    };

    // Helper for vector
    const addVec = (folder, obj, limit = 2) => {
        folder.add(obj, 'x', -limit, limit).step(0.001);
        folder.add(obj, 'y', -limit, limit).step(0.001);
        folder.add(obj, 'z', -limit, limit).step(0.001);
    };

    // --- FOLDER: GUN TRANSFORM ---
    const fGun = gui.addFolder('Weapon Transform (Spine Parent)');
    fGun.add(hand.pos, 'x', -1, 1).step(0.0001).name('Pos X');
    fGun.add(hand.pos, 'y', -1, 1).step(0.0001).name('Pos Y');
    fGun.add(hand.pos, 'z', -1, 1).step(0.0001).name('Pos Z');

    // Rotation for gun (Vector3 in radians) - Live Binding
    const gunRotHelper = {
        get rx() { return THREE.MathUtils.radToDeg(hand.rot.x); },
        set rx(v) { hand.rot.x = THREE.MathUtils.degToRad(v); },
        get ry() { return THREE.MathUtils.radToDeg(hand.rot.y); },
        set ry(v) { hand.rot.y = THREE.MathUtils.degToRad(v); },
        get rz() { return THREE.MathUtils.radToDeg(hand.rot.z); },
        set rz(v) { hand.rot.z = THREE.MathUtils.degToRad(v); }
    };
    fGun.add(gunRotHelper, 'rx', -360, 360).step(0.1).name('Rot X');
    fGun.add(gunRotHelper, 'ry', -360, 360).step(0.1).name('Rot Y');
    fGun.add(gunRotHelper, 'rz', -360, 360).step(0.1).name('Rot Z');
    fGun.add(hand, 'scale', 0.01, 2.0).step(0.0001).name('Scale');
    fGun.open();

    // --- FOLDER: ARMS ---
    const fArms = gui.addFolder('Arm Rotations');
    const bNames = ['rightArm', 'rightForeArm', 'rightHand', 'leftArm', 'leftForeArm', 'leftHand'];

    bNames.forEach(bn => {
        const sf = fArms.addFolder(bn);
        // Direct Euler binding (x,y,z in radians)
        // Ideally we want Degrees for user friendliness
        const helper = {
            get x() { return obj[bn] ? THREE.MathUtils.radToDeg(obj[bn].x) : 0; }, // Wait, pose[bn] is object {x,y,z}
            set x(v) { if (obj[bn]) obj[bn].x = THREE.MathUtils.degToRad(v); },
            // ... too complex to map every prop dynamically if it's simple object
        };
        // Just use RAW radians for now or simple mapping if pose[bn] is defined
        addVec(sf, pose[bn], 3.2); // Radian Vector
    });



    // --- SAVE BUTTON ---
    const funcs = {
        save: async () => {
            const data = {
                // Arms
                rArmX: pose.rightArm.x, rArmY: pose.rightArm.y, rArmZ: pose.rightArm.z,
                rForeArmX: pose.rightForeArm.x, rForeArmY: pose.rightForeArm.y, rForeArmZ: pose.rightForeArm.z,
                rHandX: pose.rightHand.x, rHandY: pose.rightHand.y, rHandZ: pose.rightHand.z,

                lArmX: pose.leftArm.x, lArmY: pose.leftArm.y, lArmZ: pose.leftArm.z,
                lForeArmX: pose.leftForeArm.x, lForeArmY: pose.leftForeArm.y, lForeArmZ: pose.leftForeArm.z,
                lHandX: pose.leftHand.x, lHandY: pose.leftHand.y, lHandZ: pose.leftHand.z,

                // Gun
                gx: hand.pos.x, gy: hand.pos.y, gz: hand.pos.z,
                grx: THREE.MathUtils.radToDeg(hand.rot.x), gry: THREE.MathUtils.radToDeg(hand.rot.y), grz: THREE.MathUtils.radToDeg(hand.rot.z),
                scale: hand.scale,


            };

            try {
                const res = await fetch('/api/calibration', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'sandbox', data: data })
                });
                const json = await res.json();
                if (json.success) alert("Saved to Database!");
                else alert("Save Failed: " + json.error);
            } catch (e) {
                console.error(e);
                alert("Save Error");
            }
        }
    };
    gui.add(funcs, 'save').name('💾 SAVE TO DB');
};

function toggleCalibrationMode() {
    window.isCalibrationMode = !window.isCalibrationMode;
    console.log("Calibration Mode:", window.isCalibrationMode);

    if (window.isCalibrationMode) {
        window.initCalibrationMode(); // Ensure init
        gui.show();

        // Unlock Pointer
        document.exitPointerLock();
        // Hide Pause Screen (User Request)
        const pauseScreen = document.getElementById("pause-screen");
        if (pauseScreen) pauseScreen.style.display = "none";

        // Detach Camera from Player/PitchObject so OrbitControls works freely
        savedCameraParent = camera.parent;
        // Convert to World Position before detaching
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        camera.getWorldPosition(worldPos);
        camera.getWorldQuaternion(worldQuat);

        scene.add(camera); // Attach to Scene
        camera.position.copy(worldPos);
        camera.quaternion.copy(worldQuat);

        // Enable Orbit
        orbitalControls.enabled = true;
        // Target Player
        if (myPlayerMesh) {
            orbitalControls.target.copy(myPlayerMesh.position);
            orbitalControls.target.y += 1.5;
        }
        orbitalControls.update();

        showNotification("CALIBRATION ON (U to exit)");
    } else {
        gui.hide();
        orbitalControls.enabled = false;

        // Restore Camera Parent
        if (savedCameraParent) {
            savedCameraParent.add(camera);
            camera.position.set(0, 0, 0); // Local reset
            camera.rotation.set(0, 0, 0);
            camera.scale.set(1, 1, 1);
        }

        // document.body.requestPointerLock();
        showNotification("CALIBRATION OFF");
    }
}

// Global Update Hook
window.updateCalibration = function () {
    if (orbitalControls) orbitalControls.update();

    // Live update Gun Transform if equipped
    if (typeof myPlayerMesh !== 'undefined' && myPlayerMesh && myPlayerMesh.userData) {
        const ud = myPlayerMesh.userData;
        if (ud.equippedSlot !== null && ud.equippedSlot !== undefined && ud.backGuns) {
            const gun = ud.backGuns[ud.equippedSlot];
            if (gun) {
                const cfg = CALIBRATION.HAND_TRANSFORM;
                gun.position.copy(cfg.pos);
                gun.rotation.setFromVector3(cfg.rot);
                gun.scale.setScalar(cfg.scale);
            }
        }
    }
};

window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'u') {
        toggleCalibrationMode();
    }
});
