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
let vents = []; 
let lastKnownPos = null;
let finaleTimer = 0; 

const ENEMY_DATA = {
    standard: { name: "THE SEEKER", color: "#3b82f6", desc: "Ability: Radio Pulse. Emits a shockwave that jams your abilities." },
    stalker: { name: "THE STALKER", color: "#a855f7", desc: "Ability: Shadow Step. Becomes nearly invisible and moves at terrifying speeds." },
    sprinter: { name: "THE SCOUT", color: "#f97316", desc: "Ability: Flare Drop. Leaves flares that reveal you and grant a massive speed boost." },
    phantom: { name: "THE PHANTOM", color: "#06b6d4", desc: "Ability: Blackout. Plunges the maze into total darkness, blinding you temporarily." },
    guardian: { name: "VOID SENTINEL", color: "#ffffff", desc: "Ability: Gravity Well. A relentless hunter that constantly drags you toward it." }
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
    flares = [];
    vents = [];

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
        isJammed: false,
        pullTimer: 0,
        ventCooldown: 0 
    };

    maze = generateMaze(rows, cols);
    
    fog = [];
    for (let i = 0; i < rows; i++) {
        fog.push(new Float32Array(cols).fill(0));
    }
    
    exit = { x: cols - 2, y: rows - 2 };
    
    batteries = [];
    let bCount = 5 + (currentLevel * 5);
    for (let i = 0; i < bCount; i++) {
        batteries.push(findEmptySlot());
    }

    if (altarRect) {
        batteries.push({x: altarRect.x + 1, y: altarRect.y + 1});
        batteries.push({x: altarRect.x + 3, y: altarRect.y + 1});
        batteries.push({x: altarRect.x + 1, y: altarRect.y + 3});
        batteries.push({x: altarRect.x + 3, y: altarRect.y + 3});
    }

    let numVentPairs = Math.floor(currentLevel / 3) + 1; 
    for (let i = 0; i < numVentPairs; i++) {
        let v1 = findEmptySlot();
        let v2 = findEmptySlot();
        vents.push({ x: v1.x, y: v1.y, peer: { x: v2.x, y: v2.y } });
        vents.push({ x: v2.x, y: v2.y, peer: { x: v1.x, y: v1.y } });
    }

    enemy = null; 
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
        if (currentLevel >= 6 && !hasVoidBlade) {
            bladeItem = { x: altarRect.x + 2, y: altarRect.y + 2 };
        } else {
            bladeItem = null;
        }
    }

    let speed = 0.05;
    if (type === 'sprinter') {
        speed = 0.09;
    } else if (type === 'phantom') {
        speed = 0.035;
    } else if (type === 'guardian') {
        speed = 0.15; 
    }

    let spawnX = cols - 2;
    let spawnY = rows - 2;
    let spawnPx = (cols - 2) * cellSize;
    let spawnPy = (rows - 2) * cellSize;

    if (enemy !== null) {
        spawnX = enemy.x;
        spawnY = enemy.y;
        spawnPx = enemy.px;
        spawnPy = enemy.py;
    }

    let isGhost = false;
    if (type === 'phantom' || type === 'guardian') {
        isGhost = true;
    }

    let knowsT = false;
    if (type === 'stalker' || type === 'guardian') {
        knowsT = true;
    }

    enemy = { 
        type: type, 
        x: spawnX, y: spawnY, 
        px: spawnPx, py: spawnPy, 
        baseSpeed: speed, 
        moveSpeed: speed + (currentLevel * 0.005),
        color: ENEMY_DATA[type].color, 
        ghost: isGhost, 
        isFrozen: false, 
        moving: false,
        knowsTarget: knowsT,
        memoryTimer: 0,
        abilityTimer: 15,     
        maxAbilityTimer: 15,  
        decayRate: 0.015,     
        isAbilityActive: false,
        abilityDuration: 0,
        wanderTarget: null
    };

    if (!seenEnemies.has(enemy.type)) {
        showPopup(enemy.type);
    }
}

function transformToSentinel() {
    guardianActive = true;
    enemy.type = 'guardian';
    enemy.color = ENEMY_DATA['guardian'].color;
    enemy.baseSpeed = 0.15;
    enemy.moveSpeed = 0.15 + (currentLevel * 0.005);
    enemy.ghost = true;
    enemy.knowsTarget = true;
    
    if (!seenEnemies.has('guardian')) {
        showPopup('guardian');
    }
}

function determineEnemyType() {
    if (currentLevel === 9) {
        let types = ['standard', 'stalker', 'sprinter', 'phantom'];
        let randomIndex = Math.floor(Math.random() * types.length);
        return types[randomIndex];
    } else if (currentLevel >= 7) {
        return 'phantom';
    } else if (currentLevel >= 5) {
        return 'sprinter';
    } else if (currentLevel >= 3) {
        return 'stalker';
    } else {
        return 'standard';
    }
}

function generateMaze(r, c) {
    let grid = [];
    for (let i = 0; i < r; i++) {
        grid.push(new Int8Array(c).fill(1));
    }
    
    let walls = []; 
    grid[1][1] = 0;
    
    function addW(x, y) {
        let directions = [[0,-2,0,-1], [0,2,0,1], [-2,0,-1,0], [2,0,1,0]];
        for (let i = 0; i < directions.length; i++) {
            let dx = directions[i][0];
            let dy = directions[i][1];
            let px = directions[i][2];
            let py = directions[i][3];
            
            let nx = x + dx;
            let ny = y + dy;
            
            if (ny > 0 && ny < r - 1 && nx > 0 && nx < c - 1) {
                if (grid[ny][nx] === 1) {
                    walls.push([nx, ny, x + px, y + py]);
                }
            }
        }
    }
    
    addW(1, 1);
    
    while (walls.length > 0) {
        let idx = Math.floor(Math.random() * walls.length);
        let wall = walls.splice(idx, 1)[0];
        let nx = wall[0];
        let ny = wall[1];
        let px = wall[2];
        let py = wall[3];
        
        if (grid[ny][nx] === 1) { 
            grid[py][px] = 0; 
            grid[ny][nx] = 0; 
            addW(nx, ny); 
        }
    }
    
    let randomX = Math.floor(Math.random() * (c - 10)) + 2;
    let randomY = Math.floor(Math.random() * (r - 10)) + 2;
    altarRect = { x: randomX, y: randomY };
    
    for (let y = altarRect.y; y < altarRect.y + 5; y++) {
        for (let x = altarRect.x; x < altarRect.x + 5; x++) {
            grid[y][x] = 0;
        }
    }
    return grid;
}

/**
 * SECTION 3: GAME LOGIC (Updates)
 */

function update() {
    if (!gameActive && !isGameWon) {
        return;
    }
    
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
    let pullX = 0;
    let pullY = 0;
    
    if (enemy.type === 'guardian' && enemy.isAbilityActive) {
        player.pullTimer++;
        if (player.pullTimer >= 40) { 
            player.pullTimer = 0;
            let bestDist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
            let bestX = player.x;
            let bestY = player.y;
            
            let directions = [[0,1], [0,-1], [1,0], [-1,0]];
            for (let i = 0; i < directions.length; i++) {
                let dx = directions[i][0];
                let dy = directions[i][1];
                let nx = player.x + dx;
                let ny = player.y + dy;
                
                if (maze[ny] !== undefined && maze[ny][nx] === 0) {
                    let dist = Math.hypot(nx - enemy.x, ny - enemy.y);
                    if (dist < bestDist) {
                        bestDist = dist; 
                        bestX = nx; 
                        bestY = ny;
                    }
                }
            }
            
            if (player.x !== bestX || player.y !== bestY) {
                player.x = bestX; 
                player.y = bestY;
                handleCollisions(player.x, player.y);
            }
        }
    } else {
        player.pullTimer = 0;
    }

    player.px += (player.x * cellSize - player.px) * player.moveSpeed;
    player.py += (player.y * cellSize - player.py) * player.moveSpeed;

    let dxPixels = Math.abs(player.px - player.x * cellSize);
    let dyPixels = Math.abs(player.py - player.y * cellSize);
    
    if (dxPixels > 0.5 || dyPixels > 0.5) {
        player.moving = true;
    } else {
        player.moving = false;
    }

    if (!player.moving) {
        player.stillTimer++;
        if (player.stillTimer >= player.cloakTimeReq) {
            if (!player.isCloaked) {
                lastKnownPos = { x: player.x, y: player.y };
            }
            player.isCloaked = true;
        }
    } else {
        player.stillTimer = 0;
        player.isCloaked = false;
        lastKnownPos = null;
    }
}

function updateCooldowns() {
    if (player.freezeCooldown > 0) {
        player.freezeCooldown -= 1;
    }
    if (player.phaseCooldown > 0) {
        player.phaseCooldown -= 1;
    }
    if (player.ventCooldown > 0) {
        player.ventCooldown -= 1;
    }
    
    let currentDecay = player.decayRate;
    if (isPhasing) {
        currentDecay = player.decayRate * 12;
    }
    player.light -= currentDecay;
}

function updateFlares() {
    let activeFlares = [];
    
    for (let i = 0; i < flares.length; i++) {
        let f = flares[i];
        f.timer -= 0.01; 
        
        let distToPlayer = Math.hypot(f.x - player.x, f.y - player.y);
        
        if (distToPlayer < 3) {
            enemy.knowsTarget = true;
            enemy.memoryTimer = Date.now() + 2000;
            if (enemy.type === 'sprinter') {
                enemy.isAbilityActive = true;
            }
        } else {
            if (enemy.type === 'sprinter') {
                let playerInAnyFlare = false;
                for (let j = 0; j < flares.length; j++) {
                    let flareDist = Math.hypot(flares[j].x - player.x, flares[j].y - player.y);
                    if (flareDist < 3) {
                        playerInAnyFlare = true;
                        break;
                    }
                }
                
                if (!playerInAnyFlare) {
                    enemy.isAbilityActive = false;
                }
            }
        }
        
        if (f.timer > 0) {
            activeFlares.push(f);
        }
    }
    
    flares = activeFlares;
}

function updateEnemyPosition() {
    if (enemy.isFrozen) {
        return;
    }
    
    let oldEx = enemy.px;
    let oldEy = enemy.py;
    let speedMod = 1.0;
    
    if (enemy.type === 'stalker' && enemy.isAbilityActive) {
        speedMod = 4.0;
    } else if (enemy.type === 'sprinter' && enemy.isAbilityActive) {
        speedMod = 3.5;
    }

    let currentBaseSpeed = enemy.moveSpeed;
    if (guardianActive) {
        currentBaseSpeed = 0.12;
    }
    
    let followSpeed = currentBaseSpeed * speedMod;
    
    enemy.px += (enemy.x * cellSize - enemy.px) * followSpeed;
    enemy.py += (enemy.y * cellSize - enemy.py) * followSpeed;
    
    let exDiff = Math.abs(enemy.px - oldEx);
    let eyDiff = Math.abs(enemy.py - oldEy);
    
    if (exDiff > 0.1 || eyDiff > 0.1) {
        enemy.moving = true;
    } else {
        enemy.moving = false;
    }

    if (enemy.type !== 'stalker') {
        if (enemy.moving && Math.random() > 0.95) {
            let echoColor = enemy.color;
            if (guardianActive) {
                echoColor = "#fff";
            }
            echoes.push({ 
                x: enemy.px + cellSize / 2, 
                y: enemy.py + cellSize / 2, 
                r: 2, 
                a: 0.8, 
                color: echoColor 
            });
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
        if (enemy.abilityDuration <= 0) {
            if (enemy.type !== 'sprinter') {
                enemy.isAbilityActive = false;
                player.isJammed = false;
            }
        }
    }
}

function triggerEnemyAbility() {
    enemy.isAbilityActive = true;
    let activeType = enemy.type;
    
    if (guardianActive) {
        activeType = 'guardian';
    }

    if (activeType === 'standard') {
        echoes.push({ x: enemy.px + cellSize/2, y: enemy.py + cellSize/2, r: 10, a: 1, color: "#ef4444" });
        let dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        if (dist < 8) { 
            player.isJammed = true; 
            enemy.abilityDuration = 4; 
        }
    } else if (activeType === 'stalker') {
        enemy.abilityDuration = 4;
    } else if (activeType === 'sprinter') {
        flares.push({ x: enemy.x, y: enemy.y, timer: 15 });
    } else if (activeType === 'phantom') {
        enemy.abilityDuration = 4;
        showAlert("BLACKOUT");
    } else if (activeType === 'guardian') {
        enemy.abilityDuration = 4;
    }
}

function checkDeath() {
    if (!isPhasing && maze[player.y][player.x] === 1) {
        die("FUSED WITH THE WALL");
        return;
    }
    
    let dist = Math.hypot(enemy.px - player.px, enemy.py - player.py);
    if (dist < cellSize * 0.7 && !player.isInvincible) {
        if (guardianActive) {
            die("TERMINATED BY SENTINEL");
        } else {
            die("CAUGHT");
        }
    }
}

function updateEchoes() {
    let activeEchoes = [];
    for (let i = 0; i < echoes.length; i++) {
        let e = echoes[i];
        e.r += 1.5; 
        e.a -= 0.015;
        if (e.a > 0) {
            activeEchoes.push(e);
        }
    }
    echoes = activeEchoes;
}

function updateFog() {
    let effectiveLight = player.light;
    if (enemy.type === 'phantom' && enemy.isAbilityActive) {
        effectiveLight = 1.5;
    }

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let distToPlayer = Math.hypot(x - player.x, y - player.y);
            let inFlareRange = false;
            
            for (let i = 0; i < flares.length; i++) {
                let f = flares[i];
                if (Math.hypot(x - f.x, y - f.y) < 3.5) { 
                    inFlareRange = true; 
                    break; 
                }
            }
            
            let isVisible = false;
            if (isGameWon || player.pulseActive || distToPlayer <= effectiveLight || inFlareRange) {
                isVisible = true;
            }
            
            if (isVisible) {
                fog[y][x] += (1 - fog[y][x]) * 0.1;
            } else {
                fog[y][x] += (0 - fog[y][x]) * 0.1;
            }
        }
    }
}

function updateUI() {
    let lightPercent = (player.light / 12) * 100;
    document.getElementById("batt-bar").style.width = lightPercent + "%";
    
    let cloakTimer = player.stillTimer;
    if (cloakTimer > player.cloakTimeReq) {
        cloakTimer = player.cloakTimeReq;
    }
    let cloakPercent = (cloakTimer / player.cloakTimeReq) * 100;
    document.getElementById("cloak-bar").style.width = cloakPercent + "%";
    
    let freezePercent = 100 - (player.freezeCooldown / 600 * 100);
    document.getElementById("freeze-bar").style.width = freezePercent + "%";
    
    let phasePercent = 0;
    if (hasVoidBlade) {
        phasePercent = 100 - (player.phaseCooldown / 1200 * 100);
    }
    document.getElementById("blade-bar").style.width = phasePercent + "%";
    
    let abilityPercent = (1 - (enemy.abilityTimer / enemy.maxAbilityTimer)) * 100;
    if (abilityPercent < 1) {
        abilityPercent = 0; 
    }
    document.getElementById("enemy-bar").style.width = abilityPercent + "%";
}

/**
 * SECTION 4: RENDERING
 */

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawMaze();
    
    if (!isGameWon) {
        drawVents();
        drawFlares();
        drawEchoes();
        drawItems();
        drawExit();
        drawEnemy();
    }
    
    drawPlayer();

    if (isGameWon) {
        renderFinale();
    }
}

function drawMaze() {
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let f = fog[y][x];
            let isRoom = false;
            
            if (altarRect !== undefined && altarRect !== null) {
                if (x >= altarRect.x && x < altarRect.x + 5 && y >= altarRect.y && y < altarRect.y + 5) {
                    isRoom = true;
                }
            }
            
            if (isRoom) {
                if (currentLevel === 10) {
                    ctx.fillStyle = COLORS.gold;
                    if (isGameWon) {
                        let glowAmount = finaleTimer * 1.5;
                        if (glowAmount > 100) glowAmount = 100;
                        ctx.shadowBlur = glowAmount; 
                        ctx.shadowColor = COLORS.gold;
                    } else {
                        ctx.shadowBlur = 0;
                    }
                } else {
                    ctx.fillStyle = COLORS.altarFloor;
                    ctx.shadowBlur = 0; 
                }
            } else {
                if (maze[y][x] === 1) {
                    ctx.fillStyle = COLORS.wall;
                } else {
                    ctx.fillStyle = COLORS.path;
                }
                ctx.shadowBlur = 0; 
            }
            
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            
            if (f < 0.99 && !isGameWon) { 
                ctx.fillStyle = `rgba(2, 6, 23, ${1 - f})`; 
                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize); 
            }
        }
    }
    ctx.shadowBlur = 0; 
}

function drawVents() {
    for (let i = 0; i < vents.length; i++) {
        let v = vents[i];
        if (fog[v.y][v.x] > 0.3) {
            ctx.fillStyle = "#334155"; 
            ctx.fillRect(v.x * cellSize + 2, v.y * cellSize + 2, cellSize - 4, cellSize - 4);
            
            ctx.fillStyle = "#020617";
            ctx.fillRect(v.x * cellSize + 6, v.y * cellSize + 6, cellSize - 12, cellSize - 12);
            
            ctx.strokeStyle = "#475569";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(v.x * cellSize + 6, v.y * cellSize + 12);
            ctx.lineTo(v.x * cellSize + 18, v.y * cellSize + 12);
            ctx.stroke();
        }
    }
}

function drawFlares() {
    for (let i = 0; i < flares.length; i++) {
        let f = flares[i];
        if (fog[f.y][f.x] > 0.1) {
            ctx.fillStyle = "#fbbf24"; 
            ctx.shadowBlur = 25; 
            ctx.shadowColor = "#fbbf24";
            
            ctx.beginPath(); 
            ctx.arc(f.x * cellSize + cellSize/2, f.y * cellSize + cellSize/2, cellSize/3, 0, Math.PI*2); 
            ctx.fill();
            
            ctx.strokeStyle = "rgba(251, 191, 36, 0.3)"; 
            ctx.lineWidth = 2;
            
            ctx.beginPath(); 
            ctx.arc(f.x * cellSize + cellSize/2, f.y * cellSize + cellSize/2, cellSize * 3, 0, Math.PI*2); 
            ctx.stroke();
            
            ctx.shadowBlur = 0;
        }
    }
}

function drawEchoes() {
    for (let i = 0; i < echoes.length; i++) {
        let e = echoes[i];
        ctx.strokeStyle = e.color; 
        ctx.globalAlpha = e.a; 
        
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); 
        ctx.stroke(); 
        
        ctx.globalAlpha = 1.0;
    }
}

function drawItems() {
    if (bladeItem !== null && fog[bladeItem.y][bladeItem.x] > 0.5) {
        ctx.fillStyle = COLORS.void; 
        ctx.shadowBlur = 15; 
        ctx.shadowColor = COLORS.void;
        ctx.fillRect(bladeItem.x * cellSize + 4, bladeItem.y * cellSize + 4, cellSize - 8, cellSize - 8); 
        ctx.shadowBlur = 0;
    }
    
    for (let i = 0; i < batteries.length; i++) {
        let b = batteries[i];
        if (fog[b.y][b.x] > 0.4) { 
            ctx.fillStyle = COLORS.battery; 
            ctx.fillRect(b.x * cellSize + 8, b.y * cellSize + 8, cellSize - 16, cellSize - 16); 
        }
    }
}

function drawExit() {
    if (currentLevel < 10) {
        if (fog[exit.y][exit.x] > 0.4) {
            ctx.fillStyle = COLORS.exit; 
            ctx.fillRect(exit.x * cellSize + 4, exit.y * cellSize + 4, cellSize - 8, cellSize - 8);
        }
    }
}

function drawEnemy() {
    let distToPlayer = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    let inFlareLight = false;
    
    for (let i = 0; i < flares.length; i++) {
        let f = flares[i];
        if (Math.hypot(enemy.x - f.x, enemy.y - f.y) < 3.5) { 
            inFlareLight = true; 
            break; 
        }
    }
    
    let effectiveLight = player.light;
    if (enemy.type === 'phantom' && enemy.isAbilityActive) {
        effectiveLight = 1.5;
    }

    if (distToPlayer <= effectiveLight || player.pulseActive || inFlareLight) {
        let opacity = 1.0;
        if (enemy.type === 'stalker' && enemy.isAbilityActive) {
            opacity = 0.2;
        }
        
        ctx.globalAlpha = opacity;
        
        if (guardianActive) {
            ctx.fillStyle = "#fff";
        } else if (enemy.isFrozen) {
            ctx.fillStyle = "#3b82f6";
        } else {
            ctx.fillStyle = enemy.color;
        }
        
        if (guardianActive || enemy.isAbilityActive) { 
            ctx.shadowBlur = 20; 
            ctx.shadowColor = enemy.color; 
        } else {
            ctx.shadowBlur = 0;
        }
        
        ctx.beginPath(); 
        ctx.arc(enemy.px + cellSize / 2, enemy.py + cellSize / 2, cellSize / 2.2, 0, Math.PI * 2); 
        ctx.fill();
        
        ctx.shadowBlur = 0; 
        ctx.globalAlpha = 1.0;
    }
}

function drawPlayer() {
    let pColor = COLORS.player;
    
    if (player.isJammed) {
        pColor = "#475569";
    } else if (isPhasing) {
        pColor = COLORS.void;
    } else if (player.isInvincible) {
        pColor = COLORS.invinc;
    } else if (player.isCloaked) {
        pColor = COLORS.cloak;
    }
    
    ctx.fillStyle = pColor; 
    
    if (isPhasing || player.isCloaked) {
        ctx.globalAlpha = 0.5;
    } else {
        ctx.globalAlpha = 1.0;
    }
    
    ctx.beginPath(); 
    ctx.arc(player.px + cellSize / 2, player.py + cellSize / 2, cellSize / 2.5, 0, Math.PI * 2); 
    ctx.fill();
    ctx.globalAlpha = 1.0;
}

/**
 * SECTION 5: INPUT & AI
 */

function aiTick() {
    if (!gameActive || isGameWon || !enemy) {
        setTimeout(aiTick, 400);
        return;
    }

    let tickRate = 400; 

    if (!enemy.isFrozen) {
        updateAIMemory();
        
        let target = null;
        if (enemy.knowsTarget) {
            if (!player.isCloaked || guardianActive) {
                target = { x: player.x, y: player.y };
            } else {
                target = lastKnownPos;
            }
        }
        
        let canPassWalls = false;
        if (guardianActive || enemy.type === 'phantom') {
            canPassWalls = true;
        }

        if (target === null) {
            if (enemy.wanderTarget === null || (enemy.x === enemy.wanderTarget.x && enemy.y === enemy.wanderTarget.y)) {
                enemy.wanderTarget = findEmptySlot();
            }
            performBFSPathfinding(enemy.wanderTarget, canPassWalls);
        } else {
            enemy.wanderTarget = null; 
            performBFSPathfinding(target, canPassWalls);
        }

        let speedMod = 1.0;
        if (enemy.type === 'stalker' && enemy.isAbilityActive) {
            speedMod = 4.0;
        } else if (enemy.type === 'sprinter' && enemy.isAbilityActive) {
            speedMod = 3.5;
        }
        
        if (guardianActive) {
            tickRate = 300; 
        }

        tickRate = tickRate / speedMod;
    }

    setTimeout(aiTick, tickRate);
}

function updateAIMemory() {
    let distToPlayer = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    let inFlareLight = false;
    
    for (let i = 0; i < flares.length; i++) {
        let f = flares[i];
        if (Math.hypot(player.x - f.x, player.y - f.y) < 3.5) { 
            inFlareLight = true; 
            break; 
        }
    }
    
    let isVisible = false;
    if (distToPlayer <= player.light || player.pulseActive || inFlareLight) {
        isVisible = true;
    }
    
    if (enemy.type === 'guardian' || enemy.type === 'stalker') { 
        enemy.knowsTarget = true; 
    } else {
        let memoryDuration = 5000;
        if (enemy.type === 'sprinter') {
            memoryDuration = 2000;
        }
        
        if (isVisible) { 
            enemy.knowsTarget = true; 
            enemy.memoryTimer = Date.now() + memoryDuration; 
        } else {
            if (Date.now() > enemy.memoryTimer) { 
                enemy.knowsTarget = false; 
            }
        }
    }
}

function performBFSPathfinding(target, canPassWalls) {
    let q = [enemy.y << 8 | enemy.x];
    let prev = new Map();
    let v = new Set();
    v.add(q[0]);
    
    let found = false;
    let endKey = target.y << 8 | target.x;
    
    while (q.length > 0) {
        let cur = q.shift();
        let cx = cur & 0xFF;
        let cy = cur >> 8;
        
        if (cur === endKey) { 
            found = true; 
            break; 
        }
        
        let directions = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (let i = 0; i < directions.length; i++) {
            let nx = directions[i][0];
            let ny = directions[i][1];
            
            if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                if (canPassWalls || maze[ny][nx] === 0) {
                    let nk = ny << 8 | nx;
                    if (!v.has(nk)) { 
                        v.add(nk); 
                        prev.set(nk, cur); 
                        q.push(nk); 
                    }
                }
            }
        }
    }
    
    if (found) {
        let step = endKey;
        let startKey = enemy.y << 8 | enemy.x;
        while (prev.get(step) !== startKey && prev.get(step) !== undefined) {
            step = prev.get(step);
        }
        enemy.x = step & 0xFF; 
        enemy.y = step >> 8;
    }
}

/**
 * SECTION 6: EVENT LISTENERS
 */

document.addEventListener("keydown", function(e) {
    if (!gameActive || isGameWon) {
        return;
    }
    
    let key = e.key.toLowerCase();
    
    // FIX: Vent teleportation logic isolated with an early return
    if (key === "q") {
        if (player.ventCooldown <= 0) {
            for (let i = 0; i < vents.length; i++) {
                if (player.x === vents[i].x && player.y === vents[i].y) {
                    player.x = vents[i].peer.x;
                    player.y = vents[i].peer.y;
                    player.px = player.x * cellSize;
                    player.py = player.y * cellSize;
                    
                    player.ventCooldown = 60; // 1 second cooldown
                    showAlert("VENT TRAVEL USED");
                    break; 
                }
            }
        }
        return; // Exits the keydown listener immediately so movement code doesn't override the teleport
    }
    
    let nx = player.x;
    let ny = player.y;
    let moved = false;
    
    if (key === "arrowright") {
        nx++;
        moved = true;
    } else if (key === "arrowleft") {
        nx--;
        moved = true;
    } else if (key === "arrowup") {
        ny--;
        moved = true;
    } else if (key === "arrowdown") {
        ny++;
        moved = true;
    }
    
    // Only check movement collision if an arrow key was pressed
    if (moved && maze[ny] !== undefined) {
        if (isPhasing || maze[ny][nx] === 0) { 
            player.x = nx; 
            player.y = ny; 
            handleCollisions(nx, ny); 
        }
    }
    
    if (!player.isJammed) {
        handleAbilities(e);
    }
});

function handleCollisions(nx, ny) {
    if (bladeItem !== null) {
        if (nx === bladeItem.x && ny === bladeItem.y) {
            hasVoidBlade = true; 
            bladeItem = null; 
            transformToSentinel(); 
            showAlert("VOID BLADE CLAIMED. THE SENTINEL AWAKENS."); 
        }
    }
    
    if (currentLevel === 10 && altarRect !== undefined) {
        if (nx >= altarRect.x && nx < altarRect.x + 5 && ny >= altarRect.y && ny < altarRect.y + 5) {
            winGame();
        }
    }
    
    let activeBatteries = [];
    for (let i = 0; i < batteries.length; i++) {
        let b = batteries[i];
        if (b.x === nx && b.y === ny) { 
            player.light += 5;
            if (player.light > 12) {
                player.light = 12;
            }
        } else {
            activeBatteries.push(b);
        }
    }
    batteries = activeBatteries;
    
    if (currentLevel < 10) {
        if (nx === exit.x && ny === exit.y) { 
            currentLevel++; 
            rows += 4; 
            cols += 4; 
            initLevel(); 
        }
    }
}

function handleAbilities(e) {
    if (e.key === "Shift" && player.freezeCooldown <= 0) {
        enemy.isFrozen = true;
        player.isInvincible = true; 
        player.freezeCooldown = 600;
        
        setTimeout(function() { 
            enemy.isFrozen = false;
            player.isInvincible = false; 
        }, 3000);
    }
    
    let keyLower = e.key.toLowerCase();
    if (keyLower === "e" && hasVoidBlade && player.phaseCooldown <= 0) {
        isPhasing = true; 
        player.phaseCooldown = 1200; 
        
        setTimeout(function() { 
            isPhasing = false; 
        }, 2000);
    }
    
    if (e.key === " " && !player.pulseCooldown && player.light > 2) {
        player.pulseActive = true; 
        player.pulseCooldown = true; 
        player.light -= 1;
        
        setTimeout(function() { 
            player.pulseActive = false; 
        }, 1000); 
        
        setTimeout(function() { 
            player.pulseCooldown = false; 
        }, 5000);
    }
}

/**
 * SECTION 7: HELPERS
 */

function die(reason) {
    gameActive = false; 
    if (currentLevel === 6) {
        hasVoidBlade = false;
    }
    document.getElementById("death-reason").innerText = reason;
    document.getElementById("menu").style.display = "flex";
}

function findEmptySlot() {
    let x, y;
    let searching = true;
    while (true) {
        x = Math.floor(Math.random() * (cols - 2)) + 1; 
        y = Math.floor(Math.random() * (rows - 2)) + 1;
        
        if (maze[y] !== undefined && maze[y][x] === 0) {
            if (!(x === 1 && y === 1)) {
                break;
            }
        }
    }
    return { x: x, y: y };
}

function showAlert(txt) {
    let el = document.getElementById("game-alert"); 
    el.innerText = txt; 
    el.classList.remove("hidden");
    
    setTimeout(function() { 
        el.classList.add("hidden"); 
    }, 4000);
}

function showPopup(type) {
    gameActive = false; 
    seenEnemies.add(type);
    let d = ENEMY_DATA[type];
    
    document.getElementById("enemy-name").innerText = d.name;
    document.getElementById("enemy-desc").innerText = d.desc;
    document.getElementById("enemy-art").style.background = d.color;
    document.getElementById("enemy-popup").classList.remove("hidden");
}

function closePopup() { 
    document.getElementById("enemy-popup").classList.add("hidden"); 
    gameActive = true; 
}

function restart(t) { 
    if (t === 'game') { 
        currentLevel = 1; 
        rows = 21; 
        cols = 21; 
        hasVoidBlade = false; 
        seenEnemies.clear(); 
    } 
    initLevel(); 
}

function winGame() {
    isGameWon = true; 
    gameActive = false; 
    finaleTimer = 0;
    showAlert("THE VOID IS PURGED. YOU ARE FREE.");
    
    setTimeout(function() { 
        location.reload(); 
    }, 10000); 
}

function renderFinale() {
    finaleTimer++; 

    if (finaleTimer > 90) {
        let alpha = (finaleTimer - 90) / 180;
        if (alpha > 1) {
            alpha = 1;
        }
        
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (finaleTimer > 250) {
            let textAlpha = (finaleTimer - 250) / 60;
            if (textAlpha > 1) {
                textAlpha = 1;
            }
            
            ctx.globalAlpha = textAlpha;
            ctx.fillStyle = "#000000";
            
            ctx.font = "bold 52px 'Courier New', monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Made by Nejc Krašna, 4.RA", canvas.width / 2, canvas.height / 2);
            
            ctx.globalAlpha = 1.0; 
        }
    }
}

function loop() { 
    update(); 
    render(); 
    requestAnimationFrame(loop); 
}

initLevel(); 
loop();
aiTick();
