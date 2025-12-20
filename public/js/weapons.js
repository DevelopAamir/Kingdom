/* WEAPON SYSTEM (Refactored from game.js) */

// Global Constants (exposed to window)
window.BONE_MAPPINGS = {
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

window.CALIBRATION = {
    // Pose when holding a gun (Applied to bones)
    HOLDING_POSE: {
        rightArm: { x: -1.033, y: -0.338, z: -0.164 },
        rightForeArm: { x: -1.728, y: -2.134, z: 0 },
        rightHand: { x: -0.048, y: -0.106, z: -1.265 },
        leftArm: { x: -1.356, y: -0.161, z: 0.921 },
        leftForeArm: { x: -0.957, y: 0, z: 0 },
        leftHand: { x: -0.275, y: -0.445, z: 0.295 }
    },
    // Gun Transform on Back (Spine parent) -> Recovered from attachGunToBack
    BACK_TRANSFORM: {
        pos: new THREE.Vector3(-0.001, 0, -0.001),
        rot: new THREE.Vector3(THREE.MathUtils.degToRad(-84), 0, 0),
        scale: 0.025
    },
    // Gun Transform in Hand (Spine parent) -> From DB
    HAND_TRANSFORM: {
        pos: new THREE.Vector3(0, -0.0005, 0.002),
        rot: new THREE.Vector3(THREE.MathUtils.degToRad(313.92), THREE.MathUtils.degToRad(-83.63), 0),
        scale: 0.0285
    },
    FINGERS: {
        rThumb: 0, rIndex: 0, rMiddle: 0, rRing: 0, rPinky: 0,
        lThumb: 0, lIndex: 0, lMiddle: 0, lRing: 0, lPinky: 0
    }
};

window.WEAPON_SPECS = {
    'MPSD': {
        back: {
            pos: new THREE.Vector3(-0.001, 0.000, -0.001),
            rot: new THREE.Vector3(THREE.MathUtils.degToRad(-84), 0, 0),
            scale: 0.025
        },
        hand: {
            pos: new THREE.Vector3(0.0008, -0.0026, 0.002),
            rot: new THREE.Vector3(THREE.MathUtils.degToRad(323), THREE.MathUtils.degToRad(-91), THREE.MathUtils.degToRad(-4)),
            scale: 0.034
        },
        shoot: {
            // Copied from Sniper shoot, but scale from MPSD (0.034)
            pos: new THREE.Vector3(-0.0012, 0.0011, 0.0032),
            rot: new THREE.Vector3(THREE.MathUtils.degToRad(0), THREE.MathUtils.degToRad(180), THREE.MathUtils.degToRad(5.5)),
            scale: 0.034,
            pose: {
                rightArm: { x: -0.164, y: 0.179, z: -0.555 },
                rightForeArm: { x: -1.486, y: -1.339, z: 0.778 },
                rightHand: { x: 0.23, y: 1.077, z: -0.066 },
                leftArm: { x: -2.106, y: -0.365, z: -0.714 },
                leftForeArm: { x: -0.465, y: 1.164, z: 0.032 },
                leftHand: { x: -0.166, y: -0.21, z: 0.13 }
            },
            // Muzzle position offset in local gun space
            // This gets transformed to world space when shooting
            // Negative Z because gun is rotated 180° on Y axis
            muzzlePos: new THREE.Vector3(0, 0.02, 0)
        }
    },
    'Sniper': {
        back: {
            pos: new THREE.Vector3(-0.001, 0.000, -0.001),
            rot: new THREE.Vector3(0, Math.PI, Math.PI / 4),
            scale: 0.0015
        },
        hand: {
            // Using MPSD pos/rot as base, but correcting scale
            pos: new THREE.Vector3(-0.0006, -0.0024, 0.0021),
            rot: new THREE.Vector3(THREE.MathUtils.degToRad(360), THREE.MathUtils.degToRad(-9.4), THREE.MathUtils.degToRad(-25.7)),
            scale: 0.0016
        },
        shoot: {
            pos: new THREE.Vector3(-0.0012, 0.0011, 0.0032),
            rot: new THREE.Vector3(THREE.MathUtils.degToRad(0), THREE.MathUtils.degToRad(-87), THREE.MathUtils.degToRad(5.5)),
            scale: 0.0016,
            pose: {
                rightArm: { x: -0.164, y: 0.179, z: -0.555 },
                rightForeArm: { x: -1.486, y: -1.339, z: 0.778 },
                rightHand: { x: 0.23, y: 1.077, z: -0.066 },
                leftArm: { x: -2.106, y: -0.365, z: -0.714 },
                leftForeArm: { x: -0.465, y: 1.164, z: 0.032 },
                leftHand: { x: -0.166, y: -0.21, z: 0.13 }
            },
            // Muzzle position for sniper rifle (longer barrel)
            muzzlePos: new THREE.Vector3(0, 0, 0)
        }
    }
};

// Fallback for unknown weapons
window.DEFAULT_WEAPON_SPEC = {
    back: {
        pos: new THREE.Vector3(-0.001, 0.000, -0.001),
        rot: new THREE.Vector3(0, Math.PI, Math.PI / 4),
        scale: 0.0015
    },
    hand: {
        pos: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Vector3(0, 0, 0),
        scale: 1.0
    }
};

// Repository (Hidden or exposed?)
// CALIBRATION.WEAPONS could be added here if we want to restore that functionality.

// Auto-Load Calibration
(async function loadCalibration() {
    try {
        const res = await fetch('/api/calibration/sandbox');
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
            console.log("Applying Calibration from DB:", data);

            // Map Bone Rotations
            const pose = CALIBRATION.HOLDING_POSE;
            if (data.rArmX !== undefined) pose.rightArm = { x: data.rArmX, y: data.rArmY, z: data.rArmZ };
            if (data.rForeArmX !== undefined) pose.rightForeArm = { x: data.rForeArmX, y: data.rForeArmY, z: data.rForeArmZ };
            if (data.rHandX !== undefined) pose.rightHand = { x: data.rHandX, y: data.rHandY, z: data.rHandZ };

            if (data.lArmX !== undefined) pose.leftArm = { x: data.lArmX, y: data.lArmY, z: data.lArmZ };
            if (data.lForeArmX !== undefined) pose.leftForeArm = { x: data.lForeArmX, y: data.lForeArmY, z: data.lForeArmZ };
            if (data.lForeArmX !== undefined) pose.leftForeArm = { x: data.lForeArmX, y: data.lForeArmY, z: data.lForeArmZ };
            if (data.lHandX !== undefined) pose.leftHand = { x: data.lHandX, y: data.lHandY, z: data.lHandZ };

            // Map Fingers
            const f = CALIBRATION.FINGERS;
            if (data.rThumbCurl !== undefined) f.rThumb = data.rThumbCurl;
            if (data.rIndexCurl !== undefined) f.rIndex = data.rIndexCurl;
            if (data.rMiddleCurl !== undefined) f.rMiddle = data.rMiddleCurl;
            if (data.rRingCurl !== undefined) f.rRing = data.rRingCurl;
            if (data.rPinkyCurl !== undefined) f.rPinky = data.rPinkyCurl;

            if (data.lThumbCurl !== undefined) f.lThumb = data.lThumbCurl;
            if (data.lIndexCurl !== undefined) f.lIndex = data.lIndexCurl;
            if (data.lMiddleCurl !== undefined) f.lMiddle = data.lMiddleCurl;
            if (data.lRingCurl !== undefined) f.lRing = data.lRingCurl;
            if (data.lPinkyCurl !== undefined) f.lPinky = data.lPinkyCurl;

            // Map Gun Transform
            const hand = CALIBRATION.HAND_TRANSFORM;
            if (data.gx !== undefined) hand.pos.set(data.gx, data.gy, data.gz);
            if (data.grx !== undefined) hand.rot.set(
                THREE.MathUtils.degToRad(data.grx),
                THREE.MathUtils.degToRad(data.gry),
                THREE.MathUtils.degToRad(data.grz)
            );
            if (data.scale !== undefined) hand.scale = data.scale;

            console.log("Calibration Applied Successfully.");
        }
    } catch (e) {
        console.warn("Failed to load calibration:", e);
    }
})();

// Procedural Low-Poly AK47
window.createGun = function () {
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

    // Muzzle Flash
    const flashGeo = new THREE.ConeGeometry(0.1, 0.4, 8);
    flashGeo.translate(0, 0.2, 0); // Pivot at base
    flashGeo.rotateX(Math.PI / 2); // Point forward
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.name = 'MuzzleFlash';
    flash.visible = false;
    muzzle.add(flash);

    return { group: gunGroup, muzzle: muzzle, flash: flash };
};

window.attachGunToBack = function (player, gunMesh) {
    const ud = player.userData;
    if (!ud.backGuns) ud.backGuns = [];

    if (ud.spine) {
        // Remove from world scene, attach to spine bone
        scene.remove(gunMesh);
        ud.spine.add(gunMesh);

        const count = ud.backGuns.length;
        const type = gunMesh.userData.pickupType || 'Default';

        // --- LOOKUP SPECS ---
        const spec = window.WEAPON_SPECS[type] || window.DEFAULT_WEAPON_SPEC;
        const config = spec.back;

        // Apply Scale
        gunMesh.scale.set(config.scale, config.scale, config.scale);

        // Position based on Slot
        if (count === 0) {
            // Slot 1
            gunMesh.position.copy(config.pos);
            gunMesh.rotation.setFromVector3(config.rot);
        } else {
            // Slot 2 (Mirror/Offset)
            // Simple mirroring strategy: Invert X
            gunMesh.position.set(-config.pos.x, config.pos.y, config.pos.z);
            gunMesh.rotation.setFromVector3(config.rot);
        }

        ud.backGuns.push(gunMesh);
    }
};

window.toggleWeapon = function (slot) {
    if (!myPlayerMesh || myPlayerMesh.userData.isDead) return;

    const ud = myPlayerMesh.userData;

    // Prevent switching during animation
    if (ud.isSwitchingWeapon) {
        console.log("Weapon switch in progress, please wait...");
        return;
    }

    // Check if we have a weapon in that slot
    if (!ud.backGuns || !ud.backGuns[slot]) return;

    if (ud.equippedSlot === slot) {
        unequipWeapon(myPlayerMesh); // Holster
    } else {
        equipWeapon(slot, myPlayerMesh);
    }
    // Sync to Server
    Network.sendMovement({
        x: myPlayerMesh.position.x,
        y: myPlayerMesh.position.y,
        z: myPlayerMesh.position.z,
        rotation: myPlayerMesh.rotation.y,
        equippedSlot: ud.equippedSlot
    });
};

window.unequipWeapon = function (targetPlayer = myPlayerMesh) {
    if (!targetPlayer) return;
    const ud = targetPlayer.userData;
    if (ud.equippedSlot === null || ud.equippedSlot === undefined) return;

    const slot = ud.equippedSlot;
    const gunMesh = ud.backGuns[slot];

    if (gunMesh && ud.spine) {
        // Ensure attached to Spine
        if (gunMesh.parent !== ud.spine) {
            scene.remove(gunMesh);
            ud.spine.add(gunMesh);
        }

        // Restore Back Transform
        const type = gunMesh.userData.pickupType || 'Default';
        const spec = window.WEAPON_SPECS[type] || window.DEFAULT_WEAPON_SPEC;
        const cfg = spec.back;

        gunMesh.position.copy(cfg.pos);
        gunMesh.rotation.setFromVector3(cfg.rot);
        gunMesh.scale.setScalar(cfg.scale);

        // Mirror for Slot 2 (Index 1)
        if (slot === 1) {
            gunMesh.position.set(-cfg.pos.x, cfg.pos.y, cfg.pos.z);
        } else { // slot 0
            gunMesh.position.copy(cfg.pos);
        }
    }

    ud.equippedSlot = null;
    if (targetPlayer === myPlayerMesh) isFiring = false;

    // Reset rotations to prevent stuck posture
    const resetBone = (b) => {
        if (b && ud.restRotations && ud.restRotations[b.name]) {
            b.rotation.copy(ud.restRotations[b.name]);
        } else if (b) {
            b.rotation.set(0, 0, 0); // Fallback
        }
    };
    resetBone(ud.rightArm);
    resetBone(ud.rightForeArm);
    resetBone(ud.rightHand);
    resetBone(ud.leftArm);
    resetBone(ud.leftForeArm);
    resetBone(ud.leftHand);

    console.log("Holstered Weapon");
};

window.equipWeapon = function (slot, targetPlayer = myPlayerMesh) {
    if (!targetPlayer) return;
    const ud = targetPlayer.userData;

    // Prevent switching during animation
    if (ud.isSwitchingWeapon) {
        console.log("Already switching weapon, please wait...");
        return;
    }

    // If already equipped, do nothing
    if (ud.equippedSlot === slot) return;

    if (!ud.backGuns) return; // Should not happen

    const gunMesh = ud.backGuns[slot];
    if (!gunMesh || !ud.spine) return;

    // Check if we need to unequip current weapon first
    const needsUnequip = (ud.equippedSlot !== null && ud.equippedSlot !== undefined);

    if (needsUnequip) {
        // Sequential switching: unequip first, then equip after delay
        ud.isSwitchingWeapon = true;

        // Step 1: Unequip current weapon
        unequipWeapon(targetPlayer);

        // Step 2: Wait 300ms, then equip new weapon
        setTimeout(() => {
            // KEEP ATTACHED TO SPINE (As requested)
            if (gunMesh.parent !== ud.spine) {
                scene.remove(gunMesh);
                ud.spine.add(gunMesh);
            }

            // Apply Hand Transform
            const type = gunMesh.userData.pickupType || 'Default';
            const spec = window.WEAPON_SPECS[type] || window.DEFAULT_WEAPON_SPEC;
            let cfg = spec.hand;

            gunMesh.position.copy(cfg.pos);
            gunMesh.rotation.setFromVector3(cfg.rot);
            gunMesh.scale.setScalar(cfg.scale);

            // Fix Gimbal Lock
            gunMesh.rotation.order = 'YXZ';

            ud.equippedSlot = slot;
            ud.isSwitchingWeapon = false; // Animation complete

            if (targetPlayer === myPlayerMesh) console.log(`Equipped Weapon ${slot + 1}`);
        }, 300); // 300ms delay for animation
    } else {
        // No weapon currently equipped, equip immediately
        // KEEP ATTACHED TO SPINE (As requested)
        if (gunMesh.parent !== ud.spine) {
            scene.remove(gunMesh);
            ud.spine.add(gunMesh);
        }

        // Apply Hand Transform
        const type = gunMesh.userData.pickupType || 'Default';
        const spec = window.WEAPON_SPECS[type] || window.DEFAULT_WEAPON_SPEC;
        let cfg = spec.hand;

        gunMesh.position.copy(cfg.pos);
        gunMesh.rotation.setFromVector3(cfg.rot);
        gunMesh.scale.setScalar(cfg.scale);

        // Fix Gimbal Lock
        gunMesh.rotation.order = 'YXZ';

        ud.equippedSlot = slot;
        if (targetPlayer === myPlayerMesh) console.log(`Equipped Weapon ${slot + 1}`);
    }
};



// --- ITEM SPAWNER ---
window.GUN_ASSETS = {
    'MPSD': 'guns/Mpsd.glb',
    'Sniper': 'guns/Sniper Rifle.glb'
};
// NOTE: I am redefining this because I couldn't find the original definition in the snippets.
// Ideally I should find the real URLs.
// I see GUN_URL constant in game.js: 
// const GUN_URL = 'https://raw.githubusercontent.com/microsoft/MixedRealityToolkit/main/SpatialInput/Samples/DemoRoom/Media/Models/Gun.glb';

window.spawnWorldGun = function (type, pos) {
    const url = window.GUN_ASSETS[type] || window.GUN_ASSETS['MPSD'];
    if (!url) return;

    // Use global loader if available, else new
    const loader = window.loader || new THREE.GLTFLoader();

    loader.load(url, (gltf) => {
        const mesh = gltf.scene;
        // Scale might need tuning per model. 
        mesh.scale.set(1.5, 1.5, 1.5);

        mesh.position.copy(pos);
        mesh.position.y = 0.5; // Float

        // Add to scene
        scene.add(mesh);

        // Track
        mesh.userData.isPickup = true;
        mesh.userData.pickupType = type;
        mesh.userData.floatPhase = Math.random() * Math.PI * 2;

        if (window.worldItems) window.worldItems.push(mesh);
    });
};
