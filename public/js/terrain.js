/**
 * TerrainSystem - Chunk-based procedural terrain with view occlusion
 * Loads terrain within 100m, unloads beyond 120m, on 5m movement threshold
 */
window.TerrainSystem = (function () {
    const CHUNK_SIZE = 50;
    const VIEW_DISTANCE = 100;
    const UNLOAD_DISTANCE = 120;
    const LOAD_THRESHOLD = 5;

    const loadedChunks = {};  // Map of "cx_cz" -> { mesh, trees, items, center }
    const pendingChunks = new Set();
    let lastLoadPos = null;

    // Tree model cache
    const treeModels = {};
    const TREE_ASSETS = {
        'Pine Tree': 'trees/Pine Tree.glb',
        'Tree': 'trees/Tree.glb',
        'Tree2': 'trees/Tree2.glb',
        'Big Tree': 'trees/Big Tree.glb'
    };

    // Preload tree models
    function preloadTrees() {
        const loader = new THREE.GLTFLoader();
        Object.keys(TREE_ASSETS).forEach(type => {
            loader.load(TREE_ASSETS[type], (gltf) => {
                treeModels[type] = gltf.scene;
                console.log(`[Terrain] Preloaded tree: ${type}`);
            }, undefined, (err) => {
                console.warn(`[Terrain] Failed to load tree ${type}:`, err);
            });
        });
    }

    // Get chunk coordinates from world position
    function worldToChunk(x, z) {
        return {
            cx: Math.floor(x / CHUNK_SIZE),
            cz: Math.floor(z / CHUNK_SIZE)
        };
    }

    // Get chunk key
    function chunkKey(cx, cz) {
        return `${cx}_${cz}`;
    }

    // Calculate chunks within view distance
    function getChunksInRange(pos) {
        const chunks = [];
        const { cx: centerCx, cz: centerCz } = worldToChunk(pos.x, pos.z);
        const range = Math.ceil(VIEW_DISTANCE / CHUNK_SIZE);

        for (let cx = centerCx - range; cx <= centerCx + range; cx++) {
            for (let cz = centerCz - range; cz <= centerCz + range; cz++) {
                const chunkCenterX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
                const chunkCenterZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
                const dx = pos.x - chunkCenterX;
                const dz = pos.z - chunkCenterZ;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist <= VIEW_DISTANCE) {
                    chunks.push({ cx, cz, key: chunkKey(cx, cz) });
                }
            }
        }

        return chunks;
    }

    // Create terrain mesh from heightmap
    function createTerrainMesh(chunkData) {
        const { cx, cz, heightmap } = chunkData;
        const resolution = heightmap.length - 1;

        const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, resolution, resolution);
        geometry.rotateX(-Math.PI / 2);

        // Apply heightmap to vertices
        // After rotation: vertex at loop (i, j) has world X = cx*50 + j*5, world Z = cz*50 + i*5
        // Server heightmap[x_idx][z_idx], so we need heightmap[j][i]
        const positions = geometry.attributes.position.array;
        for (let i = 0; i <= resolution; i++) {
            for (let j = 0; j <= resolution; j++) {
                const idx = (i * (resolution + 1) + j) * 3;
                positions[idx + 1] = heightmap[j][i]; // Swapped: j for X index, i for Z index
            }
        }

        geometry.computeVertexNormals();

        // Create grass texture procedurally
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 32, 128, 128, 128);
        gradient.addColorStop(0, '#2d5a27');
        gradient.addColorStop(1, '#1a3a15');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        for (let i = 0; i < 800; i++) {
            ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 4);

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.9,
            metalness: 0.1
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
        mesh.receiveShadow = true;
        mesh.userData.isChunk = true;
        mesh.userData.chunkKey = chunkKey(cx, cz);

        return mesh;
    }

    // Spawn trees for a chunk
    function spawnChunkTrees(chunkData) {
        const trees = [];

        if (!chunkData.trees) return trees;

        chunkData.trees.forEach(treeData => {
            const model = treeModels[treeData.type];
            if (!model) return;

            const tree = model.clone();

            // Calculate bounding box to offset tree so base is on ground
            const box = new THREE.Box3().setFromObject(tree);
            const treeHeight = box.max.y - box.min.y;
            const yOffset = -box.min.y; // Offset to place bottom of tree at y=0 locally

            // Scale first, then set position
            tree.scale.setScalar(treeData.scale || 1);

            // Recalculate after scaling
            const scaledOffset = yOffset * (treeData.scale || 1);
            tree.position.set(treeData.x, treeData.y + scaledOffset, treeData.z);

            tree.rotation.y = Math.random() * Math.PI * 2;

            tree.traverse(obj => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });

            tree.userData.isTree = true;
            tree.userData.treeType = treeData.type; // Store type for collision radius lookup
            trees.push(tree);
        });

        return trees;
    }

    // Load a single chunk
    function loadChunk(cx, cz) {
        const key = chunkKey(cx, cz);
        if (loadedChunks[key] || pendingChunks.has(key)) return;

        pendingChunks.add(key);

        // Request from server via socket
        if (window.socket) {
            window.socket.emit('requestChunks', [{ cx, cz }]);
            console.log(`[Terrain] Requesting chunk ${cx},${cz}`);
        } else {
            console.warn('[Terrain] Socket not available, cannot request chunk');
        }
    }

    // Handle chunk data from server
    function onChunkData(chunkData) {
        const key = chunkKey(chunkData.cx, chunkData.cz);
        pendingChunks.delete(key);

        if (loadedChunks[key]) return; // Already loaded

        // Create terrain mesh
        const mesh = createTerrainMesh(chunkData);
        scene.add(mesh);

        // Spawn trees
        const trees = spawnChunkTrees(chunkData);
        trees.forEach(t => scene.add(t));

        // Store chunk
        loadedChunks[key] = {
            mesh: mesh,
            trees: trees,
            items: [],
            center: new THREE.Vector3(
                chunkData.cx * CHUNK_SIZE + CHUNK_SIZE / 2,
                0,
                chunkData.cz * CHUNK_SIZE + CHUNK_SIZE / 2
            ),
            heightmap: chunkData.heightmap,
            cx: chunkData.cx,
            cz: chunkData.cz
        };

        console.log(`[Terrain] Loaded chunk ${key}`);
    }

    // Unload distant chunks
    function unloadDistantChunks(pos) {
        Object.keys(loadedChunks).forEach(key => {
            const chunk = loadedChunks[key];
            const dx = pos.x - chunk.center.x;
            const dz = pos.z - chunk.center.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > UNLOAD_DISTANCE) {
                scene.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
                chunk.mesh.material.dispose();

                chunk.trees.forEach(t => scene.remove(t));
                chunk.items.forEach(i => scene.remove(i));

                delete loadedChunks[key];
                console.log(`[Terrain] Unloaded chunk ${key}`);
            }
        });
    }

    // Get height at world position
    function getHeightAt(x, z) {
        const { cx, cz } = worldToChunk(x, z);
        const key = chunkKey(cx, cz);
        const chunk = loadedChunks[key];

        if (!chunk || !chunk.heightmap) return 0;

        const resolution = chunk.heightmap.length - 1;
        const localX = x - cx * CHUNK_SIZE;
        const localZ = z - cz * CHUNK_SIZE;

        const fx = (localX / CHUNK_SIZE) * resolution;
        const fz = (localZ / CHUNK_SIZE) * resolution;

        const i0 = Math.floor(fx);
        const j0 = Math.floor(fz);
        const i1 = Math.min(i0 + 1, resolution);
        const j1 = Math.min(j0 + 1, resolution);

        const fracX = fx - i0;
        const fracZ = fz - j0;

        const h00 = chunk.heightmap[i0]?.[j0] || 0;
        const h10 = chunk.heightmap[i1]?.[j0] || 0;
        const h01 = chunk.heightmap[i0]?.[j1] || 0;
        const h11 = chunk.heightmap[i1]?.[j1] || 0;

        const h0 = h00 * (1 - fracX) + h10 * fracX;
        const h1 = h01 * (1 - fracX) + h11 * fracX;

        return h0 * (1 - fracZ) + h1 * fracZ;
    }

    // Main update function - call every frame
    function update(playerPos) {
        if (!playerPos) return;

        // Check if we should load new chunks
        if (lastLoadPos) {
            const dist = playerPos.distanceTo(lastLoadPos);
            if (dist < LOAD_THRESHOLD) return;
        }

        lastLoadPos = playerPos.clone();

        // Get chunks to load
        const needed = getChunksInRange(playerPos);
        needed.forEach(({ cx, cz, key }) => {
            if (!loadedChunks[key]) {
                loadChunk(cx, cz);
            }
        });

        // Unload distant chunks
        unloadDistantChunks(playerPos);
    }

    // Trunk collision radius per type (actual trunk width)
    const TRUNK_COLLISION_RADIUS = {
        'Pine Tree': 0.4,  // Thin pine trunk
        'Tree': 2.0,       // Large leafy tree - thick trunk
        'Tree2': 2.5,      // Even larger tree
        'Big Tree': 3.0
    };

    // Check if a position would collide with any tree trunk
    // Returns adjusted position if collision, or null if no collision
    function checkTreeCollision(newPos, currentPos) {
        const playerRadius = 0.4; // Player collision radius

        // Check all loaded chunks for trees
        for (const key in loadedChunks) {
            const chunk = loadedChunks[key];
            if (!chunk.trees) continue;

            for (const tree of chunk.trees) {
                if (!tree.userData) continue;

                const treePos = tree.position;
                const treeType = tree.userData.treeType || 'Pine Tree';
                // Use small fixed trunk radius - NOT scaled by tree size
                // (Tree scale affects leaves, not trunk width much)
                const trunkRadius = TRUNK_COLLISION_RADIUS[treeType] || 0.4;
                const totalRadius = trunkRadius + playerRadius;

                // Check horizontal distance (XZ plane only)
                const dx = newPos.x - treePos.x;
                const dz = newPos.z - treePos.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < totalRadius * totalRadius) {
                    // Collision with trunk! Push player back
                    const dist = Math.sqrt(distSq);
                    if (dist < 0.01) continue; // Avoid division by zero

                    // Calculate push direction (away from tree)
                    const pushX = dx / dist;
                    const pushZ = dz / dist;

                    // Return adjusted position outside collision radius
                    return {
                        x: treePos.x + pushX * totalRadius,
                        y: newPos.y,
                        z: treePos.z + pushZ * totalRadius,
                        collided: true
                    };
                }
            }
        }

        return null; // No collision
    }

    // Initialize terrain system
    function init() {
        preloadTrees();
        console.log('[Terrain] TerrainSystem initialized');
    }

    return {
        init,
        update,
        getHeightAt,
        onChunkData,
        checkTreeCollision,
        CHUNK_SIZE,
        VIEW_DISTANCE
    };
})();

