/**
 * SECTION 1: CONFIGURATION & GLOBAL STATE
 */
let currentLevel = 1;
let rows = 21;
let cols = 21;
let cellSize = 24;

let gameActive = true;
let hasVoidBlade = false;
let isPhasing = false;
let guardianActive = false;
let isGameWon = false;

let seenEnemies = new Set();
let echoes = [];
let flares = []; 
let lastKnownPos = null;
let fragments = [];
let stars = [];
let sunY = 0;
let worldOffset = 0;

const PIXEL_SCALE = 4;

const ENEMY_DATA = {
    standard: { name: "THE SEEKER", color: "#3b82f6", desc: "Ability: Radio Pulse. Disables your Cloak/Freeze." },
    stalker: { name: "THE STALKER", color: "#a855f7", desc: "Ability: Shadow Step. Near-invisible speed burst." },
    sprinter: { name: "THE SCOUT", color: "#f97316", desc: "Ability: Flare Drop. Lights up area & grants 250% speed." },
    phantom: { name: "THE PHANTOM", color: "#06b6d4", desc: "Ability: Void Rift. Swaps positions with you." },
    guardian: { name: "VOID SENTINEL", color: "#ffffff", desc: "Ability: Gravity Well. Pulls you toward the void." }
};

const COLORS = { 
    wall: "#0f172a", path: "#1e293b", player: "#ef4444", 
    invinc: "#fbbf24", exit: "#22c55e", battery: "#fbbf24", 
    void: "#a855f7", altarFloor: "#2e1065", gold: "#ffd700", cloak: "#8b5cf6" 
};

const canvas = document.getElementById("mazeCanvas");
const ctx = canvas.getContext("2d");
let player, enemy, maze, fog, batteries, exit, altarRect, bladeItem;

/**
 * SECTION 2: CORE ENGINE
 */

function initLevel() {
    gameActive = true;
    isPhasing = false;
    lastKnownPos = null;
    isGameWon = false;
    fragments = [];
    stars = [];
    flares = [];
    sunY = 0;

    document.getElementById("menu").style.display = "none";
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    
    player = { 
        x: 1, y: 1, px: cellSize, py: cellSize, 
        moving: false, moveSpeed: 0.35, 
        light: 8, maxLight: 12, decayRate: 0.002, 
        stillTimer: 0, isCloaked: false, cloakTimeReq: 240,
        phaseCooldown: 0, freezeCooldown: 0, 
        isInvincible: false, pulseActive: false, pulseCooldown: false,
        isJammed: false 
    };

    maze = generateMaze(rows, cols);
    fog = Array.from({ length: rows }, () => new Float32Array(cols).fill(0));
    exit = { x: cols - 2, y: rows - 2 };
    
    batteries = [];
    let bCount = 5 + (currentLevel * 5);
    for (let i = 0; i < bCount; i++) batteries.push(findEmptySlot());

    setupEnemy();
    document.getElementById("lvlTxt").innerText = `FLOOR ${currentLevel}`;
}

function setupEnemy() {
    let type = determineEnemyType();
    if (currentLevel === 10) {
        guardianActive = true;
        type = 'guardian';
    } else {
        guardianActive = false;
        bladeItem = (currentLevel >= 6 && !hasVoidBlade) ? { x: altarRect.x + 2, y: altarRect.y + 2 } : null;
    }

    let speed = 0.05;
    if (type === 'sprinter') speed = 0.09;
    if (type === 'phantom') speed = 0.035;
    if (type === 'guardian') speed = 0.12;

    enemy = { 
        type, 
        x: cols - 2, y: rows - 2, 
        px: (cols - 2) * cellSize, py: (rows - 2) * cellSize, 
        baseSpeed: speed, 
        moveSpeed: speed + (currentLevel * 0.005),
        color: ENEMY_DATA[type].color, 
        ghost: type === 'phantom', 
        isFrozen: false, 
        moving: false,
        knowsTarget: (type === 'stalker' || type === 'guardian'),
        memoryTimer: 0,
        abilityTimer: 10,     
        maxAbilityTimer: 10,  
        decayRate: 0.02,     
        isAbilityActive: false,
        abilityDuration: 0
    };

    if (!seenEnemies.has(enemy.type)) showPopup(enemy.type);
}

function determineEnemyType() {
    if (currentLevel >= 7) return ['stalker', 'sprinter', 'phantom'][Math.floor(Math.random() * 3)];
    if (currentLevel >= 5) return 'sprinter';
    if (currentLevel >= 3) return 'stalker';
    return 'standard';
}

function generateMaze(r, c) {
    const grid = Array.from({ length: r }, () => new Int8Array(c).fill(1));
    const walls = []; 
    grid[1][1] = 0;
    const addW = (x, y) => {
        [[0,-2,0,-1],[0,2,0,1],[-2,0,-1,0],[2,0,1,0]].forEach(([dx, dy, px, py]) => {
            const nx = x + dx, ny = y + dy;
            if (ny > 0 && ny < r - 1 && nx > 0 && nx < c - 1 && grid[ny][nx] === 1) walls.push([nx, ny, x + px, y + py]);
        });
    };
    addW(1, 1);
    while (walls.length > 0) {
        const idx = Math.floor(Math.random() * walls.length);
        const [nx, ny, px, py] = walls.splice(idx, 1)[0];
        if (grid[ny][nx] === 1) { grid[py][px] = 0; grid[ny][nx] = 0; addW(nx, ny); }
    }
    altarRect = { x: Math.floor(Math.random() * (c - 10)) + 2, y: Math.floor(Math.random() * (r - 10)) + 2 };
    for (let y = altarRect.y; y < altarRect.y + 5; y++) for (let x = altarRect.x; x < altarRect.x + 5; x++) grid[y][x] = 0;
    return grid;
}

/**
 * SECTION 3: GAME LOGIC (Updates)
 */

function update() {
    if (!gameActive && !isGameWon) return;
    if (!isGameWon) {
        updatePlayerMovement();
        updateCooldowns();
        updateEnemyPosition();
        updateFlares();
        updateEnemyAbilityState();
        checkDeath();
    }
    updateEchoes();
    updateFog();
    updateUI();
}

function updatePlayerMovement() {
    let pullX = 0, pullY = 0;
    if (enemy.type === 'guardian' && enemy.isAbilityActive) {
        const dx = (enemy.px + cellSize/2) - (player.px + cellSize/2);
        const dy = (enemy.py + cellSize/2) - (player.py + cellSize/2);
        const dist = Math.hypot(dx, dy);
        pullX = (dx / dist) * 0.8; 
        pullY = (dy / dist) * 0.8;
    }

    player.px += (player.x * cellSize - player.px) * player.moveSpeed + pullX;
    player.py += (player.y * cellSize - player.py) * player.moveSpeed + pullY;

    player.moving = Math.abs(player.px - player.x * cellSize) > 0.5 || Math.abs(player.py - player.y * cellSize) > 0.5;

    if (!player.moving) {
        player.stillTimer++;
        if (player.stillTimer >= player.cloakTimeReq) {
            if (!player.isCloaked) lastKnownPos = { x: player.x, y: player.y };
            player.isCloaked = true;
        }
    } else {
        player.stillTimer = 0;
        player.isCloaked = false;
        lastKnownPos = null;
    }
}

function updateCooldowns() {
    if (player.freezeCooldown > 0) player.freezeCooldown -= 1;
    if (player.phaseCooldown > 0) player.phaseCooldown -= 1;
    player.light -= (isPhasing ? player.decayRate * 12 : player.decayRate);
}

function updateFlares() {
    flares = flares.filter(f => {
        f.timer -= 0.01; 
        const distToPlayer = Math.hypot(f.x - player.x, f.y - player.y);
        
        // If player is caught in flare radius
        if (distToPlayer < 3) {
            enemy.knowsTarget = true;
            enemy.memoryTimer = Date.now() + 2000;
            if (enemy.type === 'sprinter') enemy.isAbilityActive = true;
        } else if (enemy.type === 'sprinter') {
             if (flares.every(flare => Math.hypot(flare.x - player.x, flare.y - player.y) >= 3)) {
                 enemy.isAbilityActive = false;
            }
        }
        return f.timer > 0;
    });
}

function updateEnemyPosition() {
    if (enemy.isFrozen) return;

    let oldEx = enemy.px, oldEy = enemy.py;
    
    let speedMod = 1.0;
    if (enemy.type === 'stalker' && enemy.isAbilityActive) speedMod = 1.5;
    if (enemy.type === 'sprinter' && enemy.isAbilityActive) speedMod = 2.5;

    const followSpeed = (guardianActive ? 0.12 : enemy.moveSpeed) * speedMod;
    enemy.px += (enemy.x * cellSize - enemy.px) * followSpeed;
    enemy.py += (enemy.y * cellSize - enemy.py) * followSpeed;

    enemy.moving = Math.abs(enemy.px - oldEx) > 0.1 || Math.abs(enemy.py - oldEy) > 0.1;

    if (enemy.type !== 'stalker') {
        if (enemy.moving && Math.random() > 0.95) {
            echoes.push({ x: enemy.px + cellSize / 2, y: enemy.py + cellSize / 2, r: 2, a: 0.8, color: guardianActive ? "#fff" : enemy.color });
        }
    }
}

function updateEnemyAbilityState() {
    if (enemy.abilityTimer > 0) {
        enemy.abilityTimer -= enemy.decayRate;
    } else {
        triggerEnemyAbility();
        enemy.abilityTimer = enemy.maxAbilityTimer; 
    }

    if (enemy.isAbilityActive) {
        enemy.abilityDuration -= 0.015; 
        if (enemy.abilityDuration <= 0 && enemy.type !== 'sprinter') {
            enemy.isAbilityActive = false;
            player.isJammed = false;
        }
    }
}

function triggerEnemyAbility() {
    enemy.isAbilityActive = true;
    switch(enemy.type) {
        case 'standard': 
            echoes.push({ x: enemy.px + cellSize/2, y: enemy.py + cellSize/2, r: 10, a: 1, color: "#ef4444" });
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist < 8) { player.isJammed = true; enemy.abilityDuration = 4; } 
            break;
        case 'stalker': 
            enemy.abilityDuration = 4;
            break;
        case 'sprinter': 
            flares.push({ x: enemy.x, y: enemy.y, timer: 15 });
            break;
        case 'phantom': 
            const px = player.x, py = player.y;
            player.x = enemy.x; player.y = enemy.y;
            enemy.x = px; enemy.y = py;
            showAlert("VOID RIFT: POSITIONS SWAPPED");
            break;
        case 'guardian': 
            enemy.abilityDuration = 4;
            break;
    }
}

function checkDeath() {
    if (!isPhasing && maze[player.y][player.x] === 1) return die("FUSED WITH THE WALL");
    const dist = Math.hypot(enemy.px - player.px, enemy.py - player.py);
    if (dist < cellSize * 0.7 && !player.isInvincible) die(guardianActive ? "TERMINATED BY SENTINEL" : "CAUGHT");
}

function updateEchoes() {
    echoes.forEach(e => { e.r += 1.5; e.a -= 0.015; });
    echoes = echoes.filter(e => e.a > 0);
}

function updateFog() {
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const distToPlayer = Math.hypot(x - player.x, y - player.y);
            
            // --- FLARE FOG LOGIC ---
            // Check if this specific tile is near any active flare
            let inFlareRange = false;
            for (let f of flares) {
                if (Math.hypot(x - f.x, y - f.y) < 3.5) {
                    inFlareRange = true;
                    break;
                }
            }

            const isVisible = (isGameWon || player.pulseActive || distToPlayer <= player.light || inFlareRange);
            fog[y][x] += (isVisible ? (1 - fog[y][x]) : (0 - fog[y][x])) * 0.1;
        }
    }
}

function updateUI() {
    document.getElementById("batt-bar").style.width = (player.light / 12 * 100) + "%";
    document.getElementById("cloak-bar").style.width = (Math.min(player.stillTimer, player.cloakTimeReq) / player.cloakTimeReq * 100) + "%";
    document.getElementById("freeze-bar").style.width = (100 - (player.freezeCooldown / 600 * 100)) + "%";
    document.getElementById("blade-bar").style.width = hasVoidBlade ? (100 - (player.phaseCooldown / 1200 * 100)) + "%" : "0%";
    
    let abilityPercent = (1 - (enemy.abilityTimer / enemy.maxAbilityTimer)) * 100;
    if (abilityPercent < 1) abilityPercent = 0; 
    document.getElementById("enemy-bar").style.width = abilityPercent + "%";
}

/**
 * SECTION 4: RENDERING
 */

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isGameWon) return renderFinale();

    drawMaze();
    drawFlares();
    drawEchoes();
    drawItems();
    drawExit();
    drawEnemy();
    drawPlayer();
}

function drawMaze() {
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const f = fog[y][x];
            let isRoom = altarRect && x >= altarRect.x && x < altarRect.x + 5 && y >= altarRect.y && y < altarRect.y + 5;
            ctx.fillStyle = isRoom ? (currentLevel === 10 ? COLORS.gold : COLORS.altarFloor) : (maze[y][x] === 1 ? COLORS.wall : COLORS.path);
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            if (f < 0.99) { ctx.fillStyle = `rgba(2, 6, 23, ${1 - f})`; ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize); }
        }
    }
}

function drawFlares() {
    flares.forEach(f => {
        if (fog[f.y][f.x] > 0.1) {
            ctx.fillStyle = "#fbbf24"; 
            ctx.shadowBlur = 25; 
            ctx.shadowColor = "#fbbf24";
            ctx.beginPath(); 
            ctx.arc(f.x * cellSize + cellSize/2, f.y * cellSize + cellSize/2, cellSize/3, 0, Math.PI*2); 
            ctx.fill();
            
            // Draw a subtle outer ring for the radius
            ctx.strokeStyle = "rgba(251, 191, 36, 0.3)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(f.x * cellSize + cellSize/2, f.y * cellSize + cellSize/2, cellSize * 3, 0, Math.PI*2);
            ctx.stroke();
            
            ctx.shadowBlur = 0;
        }
    });
}

function drawEchoes() {
    echoes.forEach(e => {
        ctx.strokeStyle = e.color; ctx.globalAlpha = e.a; ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1.0;
    });
}

function drawItems() {
    if (bladeItem && fog[bladeItem.y][bladeItem.x] > 0.5) {
        ctx.fillStyle = COLORS.void; ctx.shadowBlur = 15; ctx.shadowColor = COLORS.void;
        ctx.fillRect(bladeItem.x * cellSize + 4, bladeItem.y * cellSize + 4, cellSize - 8, cellSize - 8); ctx.shadowBlur = 0;
    }
    batteries.forEach(b => {
        if (fog[b.y][b.x] > 0.4) { ctx.fillStyle = COLORS.battery; ctx.fillRect(b.x * cellSize + 8, b.y * cellSize + 8, cellSize - 16, cellSize - 16); }
    });
}

function drawExit() {
    if (currentLevel < 10 && fog[exit.y][exit.x] > 0.4) {
        ctx.fillStyle = COLORS.exit; ctx.fillRect(exit.x * cellSize + 4, exit.y * cellSize + 4, cellSize - 8, cellSize - 8);
    }
}

function drawEnemy() {
    const distToPlayer = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (distToPlayer <= player.light || player.pulseActive) {
        let opacity = 1.0;
        if (enemy.type === 'stalker' && enemy.isAbilityActive) opacity = 0.2;
        ctx.globalAlpha = opacity;
        ctx.fillStyle = guardianActive ? "#fff" : (enemy.isFrozen ? "#3b82f6" : enemy.color);
        if (guardianActive || enemy.isAbilityActive) { ctx.shadowBlur = 20; ctx.shadowColor = enemy.color; }
        ctx.beginPath(); ctx.arc(enemy.px + cellSize / 2, enemy.py + cellSize / 2, cellSize / 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
    }
}

function drawPlayer() {
    let pColor = player.isJammed ? "#475569" : COLORS.player;
    if (isPhasing) pColor = COLORS.void;
    else if (player.isInvincible) pColor = COLORS.invinc;
    else if (player.isCloaked) pColor = COLORS.cloak;
    ctx.fillStyle = pColor; ctx.globalAlpha = (isPhasing || player.isCloaked) ? 0.5 : 1.0;
    ctx.beginPath(); ctx.arc(player.px + cellSize / 2, player.py + cellSize / 2, cellSize / 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;
}

/**
 * SECTION 5: INPUT & AI
 */

setInterval(() => {
    if (!gameActive || enemy.isFrozen || isGameWon) return;
    updateAIMemory();
    let target = enemy.knowsTarget ? ((!player.isCloaked || guardianActive) ? { x: player.x, y: player.y } : lastKnownPos) : null;
    const canPassWalls = (guardianActive || enemy.type === 'phantom');
    if (!target) wanderEnemy(canPassWalls);
    else performBFSPathfinding(target, canPassWalls);
}, 400);

function updateAIMemory() {
    const distToPlayer = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    
    // Check if player is currently in any flare light
    let inFlareLight = false;
    for (let f of flares) {
        if (Math.hypot(player.x - f.x, player.y - f.y) < 3.5) {
            inFlareLight = true;
            break;
        }
    }

    const isVisible = distToPlayer <= player.light || player.pulseActive || inFlareLight;

    if (enemy.type === 'guardian' || enemy.type === 'stalker') { enemy.knowsTarget = true; } 
    else {
        const memoryDuration = (enemy.type === 'sprinter') ? 2000 : 5000;
        if (isVisible) { enemy.knowsTarget = true; enemy.memoryTimer = Date.now() + memoryDuration; }
        else if (Date.now() > enemy.memoryTimer) { enemy.knowsTarget = false; }
    }
}

function wanderEnemy(canPassWalls) {
    let dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let d = dirs[Math.floor(Math.random() * 4)];
    let nx = enemy.x + d[0], ny = enemy.y + d[1];
    if (maze[ny] && (maze[ny][nx] === 0 || canPassWalls)) { enemy.x = nx; enemy.y = ny; }
}

function performBFSPathfinding(target, canPassWalls) {
    const q = [enemy.y << 8 | enemy.x];
    const prev = new Map();
    const v = new Set();
    v.add(q[0]);
    let found = false, endKey = target.y << 8 | target.x;
    while (q.length) {
        const cur = q.shift(), cx = cur & 0xFF, cy = cur >> 8;
        if (cur === endKey) { found = true; break; }
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            let nk = ny << 8 | nx;
            if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && (canPassWalls || maze[ny][nx] === 0) && !v.has(nk)) { v.add(nk); prev.set(nk, cur); q.push(nk); }
        }
    }
    if (found) {
        let step = endKey;
        const startKey = enemy.y << 8 | enemy.x;
        while (prev.get(step) !== startKey) step = prev.get(step);
        enemy.x = step & 0xFF; enemy.y = step >> 8;
    }
}

/**
 * SECTION 6: EVENT LISTENERS
 */

document.addEventListener("keydown", e => {
    if (!gameActive || isGameWon) return;
    const key = e.key.toLowerCase();
    let nx = player.x, ny = player.y;
    if (key === "arrowright") nx++; else if (key === "arrowleft") nx--; else if (key === "arrowup") ny--; else if (key === "arrowdown") ny++;
    if (maze[ny] && (isPhasing || maze[ny][nx] === 0)) { player.x = nx; player.y = ny; handleCollisions(nx, ny); }
    if (!player.isJammed) handleAbilities(e);
});

function handleCollisions(nx, ny) {
    if (bladeItem && nx === bladeItem.x && ny === bladeItem.y) {
        hasVoidBlade = true; bladeItem = null; guardianActive = true;
        showAlert("VOID BLADE CLAIMED. THE SENTINEL AWAKENS."); showPopup('guardian');
    }
    if (currentLevel === 10 && altarRect && nx >= altarRect.x && nx < altarRect.x + 5 && ny >= altarRect.y && ny < altarRect.y + 5) winGame();
    batteries = batteries.filter(b => {
        if (b.x === nx && b.y === ny) { player.light = Math.min(12, player.light + 5); return false; }
        return true;
    });
    if (currentLevel < 10 && nx === exit.x && ny === exit.y) { currentLevel++; rows += 4; cols += 4; initLevel(); }
}

function handleAbilities(e) {
    if (e.key === "Shift" && player.freezeCooldown <= 0) {
        enemy.isFrozen = player.isInvincible = true; player.freezeCooldown = 600;
        setTimeout(() => { enemy.isFrozen = player.isInvincible = false; }, 3000);
    }
    if (e.key.toLowerCase() === "e" && hasVoidBlade && player.phaseCooldown <= 0) {
        isPhasing = true; player.phaseCooldown = 1200; setTimeout(() => { isPhasing = false; }, 2000);
    }
    if (e.key === " " && !player.pulseCooldown && player.light > 2) {
        player.pulseActive = player.pulseCooldown = true; player.light -= 1;
        setTimeout(() => { player.pulseActive = false; }, 1000); setTimeout(() => { player.pulseCooldown = false; }, 5000);
    }
}

/**
 * SECTION 7: HELPERS
 */

function die(reason) {
    gameActive = false; if (currentLevel >= 6) hasVoidBlade = false;
    document.getElementById("death-reason").innerText = reason;
    document.getElementById("menu").style.display = "flex";
}

function findEmptySlot() {
    let x, y;
    do { x = (Math.random() * (cols - 2) + 1)|0; y = (Math.random() * (rows - 2) + 1)|0; } 
    while (!maze[y] || maze[y][x] !== 0 || (x === 1 && y === 1));
    return { x, y };
}

function showAlert(txt) {
    const el = document.getElementById("game-alert"); el.innerText = txt; el.classList.remove("hidden");
    setTimeout(() => { el.classList.add("hidden"); }, 4000);
}

function showPopup(type) {
    gameActive = false; seenEnemies.add(type);
    const d = ENEMY_DATA[type];
    document.getElementById("enemy-name").innerText = d.name;
    document.getElementById("enemy-desc").innerText = d.desc;
    document.getElementById("enemy-art").style.background = d.color;
    document.getElementById("enemy-popup").classList.remove("hidden");
}

function closePopup() { document.getElementById("enemy-popup").classList.add("hidden"); gameActive = true; }
function restart(t) { if (t === 'game') { currentLevel = 1; rows = 21; cols = 21; hasVoidBlade = false; seenEnemies.clear(); } initLevel(); }

function winGame() {
    isGameWon = true; gameActive = false;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (maze[y][x] === 1) fragments.push({ x: x * cellSize, y: y * cellSize, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, ang: 0, va: (Math.random() - 0.5) * 0.3 });
    showAlert("THE VOID SHATTERS. YOU ARE FREE.");
    setTimeout(() => { location.reload(); }, 12000);
}

function renderFinale() {
    worldOffset += 2; if (sunY < canvas.height * 0.25) sunY += 0.2;
    if (stars.length === 0) for (let i = 0; i < 100; i++) stars.push({ x: Math.random() * canvas.width, y: Math.random() * (canvas.height / 2), size: Math.random() > 0.9 ? 2 : 1, twinkle: Math.random() * Math.PI });
    let skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGrad.addColorStop(0, "#0f0c29"); skyGrad.addColorStop(0.5, "#302b63"); skyGrad.addColorStop(1, "#ff4b1f");
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawFinaleDetails();
}

function drawFinaleDetails() {
    stars.forEach(star => {
        ctx.globalAlpha = 0.5 + Math.abs(Math.sin(Date.now() * 0.003 + star.twinkle)) * 0.5;
        ctx.fillStyle = "#fff"; ctx.fillRect(star.x, star.y, star.size * 2, star.size * 2);
    });
    ctx.globalAlpha = 1.0;
    fragments.forEach(f => {
        f.x += f.vx; f.y += f.vy; f.ang += f.va; f.vy += 0.25;
        ctx.save(); ctx.translate(f.x | 0, f.y | 0); ctx.rotate(f.ang); ctx.fillStyle = "#000"; ctx.fillRect(-cellSize / 2, -cellSize / 2, cellSize, cellSize); ctx.restore();
    });
}

function loop() { update(); render(); requestAnimationFrame(loop); }
initLevel(); loop();