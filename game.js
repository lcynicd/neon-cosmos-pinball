/* ============================================
   NEON COSMOS — 赛博弹球 · 科幻渲染引擎 v5
   ============================================
   视觉特性:
   - 拉丝金属桌面 + 程序化噪声纹理
   - 闪电/能量裂纹遍布桌面 (动态)
   - 霓虹紫/青色发光管道轨道
   - 水晶球状 bumper (内部能量核心 + 折射)
   - 蓝色漩涡黑洞 (旋转动画)
   - 全局 bloom 辉光效果
   - 电弧/火花粒子系统
   ============================================ */
(function () {
    'use strict';

    // ========== 逻辑坐标常量（物理世界） ==========
    const LW = 420, LH = 700;
    const GRAVITY = 0.15;
    const BALL_R = 10;
    const FL = 72, FT = 12, FS = 0.18;
    const F_REST = 0.45, F_MAX = -0.6;
    const LAUNCH_SPD = -16, BUMP_BOUNCE = 9;
    const LANE_W = 42, LANE_LEFT = LW - LANE_W, LANE_TOP = 60;

    // ========== 透视参数 ==========
    const RENDER_W = 500, RENDER_H = 800;
    const PERSP_SHRINK_TOP = 0.72;
    const TABLE_WALL_H = 24;
    const ELEMENT_H = 8;

    // ========== 霓虹颜色主题 ==========
    const NEON = {
        cyan:    '#00e5ff',
        purple:  '#7c4dff',
        magenta: '#e040fb',
        orange:  '#ff6d00',
        green:   '#00e676',
        pink:    '#ff4081',
        blue:    '#448aff',
        yellow:  '#ffd740',
        white:   '#e8eaf6',
    };

    // ========== DOM ==========
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = RENDER_W; canvas.height = RENDER_H;

    const scoreEl = document.getElementById('score');
    const ballsEl = document.getElementById('balls');
    const highscoreEl = document.getElementById('highscore');
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayScore = document.getElementById('overlay-score');
    const startBtn = document.getElementById('start-btn');

    // ========== 离屏缓冲 ==========
    // bloom 效果缓冲
    const bloomCanvas = document.createElement('canvas');
    bloomCanvas.width = RENDER_W; bloomCanvas.height = RENDER_H;
    const bloomCtx = bloomCanvas.getContext('2d');

    // ========== 透视投影 ==========
    function proj(lx, ly) {
        const t = ly / LH;
        const scale = PERSP_SHRINK_TOP + (1 - PERSP_SHRINK_TOP) * t;
        const centeredX = (lx - LW / 2) * scale;
        const px = RENDER_W / 2 + centeredX * (RENDER_W / LW);
        const py = 32 + t * (RENDER_H - 52);
        return { x: px, y: py };
    }
    function scaleAt(ly) {
        const t = ly / LH;
        return PERSP_SHRINK_TOP + (1 - PERSP_SHRINK_TOP) * t;
    }
    function projR(r, ly) {
        return r * scaleAt(ly) * (RENDER_W / LW);
    }

    // ========== 颜色工具 ==========
    function hexRGB(c) {
        if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
        const m = c.match(/(\d+)/g); return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
    }
    function clamp(v) { return Math.min(255, Math.max(0, Math.round(v))); }
    function lighten(hex, a) {
        const [r, g, b] = hexRGB(hex);
        return `rgb(${clamp(r + (255 - r) * a)},${clamp(g + (255 - g) * a)},${clamp(b + (255 - b) * a)})`;
    }
    function darken(hex, a) {
        const [r, g, b] = hexRGB(hex);
        return `rgb(${clamp(r * (1 - a))},${clamp(g * (1 - a))},${clamp(b * (1 - a))})`;
    }
    function neonGlow(col, alpha) {
        const [r, g, b] = hexRGB(col);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ========== 随机 ==========
    function mulberry32(s) {
        return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }

    // ========== 噪声函数（简化 Perlin） ==========
    const permutation = [];
    const rng0 = mulberry32(12345);
    for (let i = 0; i < 256; i++) permutation[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng0() * (i + 1)); [permutation[i], permutation[j]] = [permutation[j], permutation[i]]; }
    const perm = [...permutation, ...permutation];

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function grad(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y, v = h < 2 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    function noise2D(x, y) {
        const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x), yf = y - Math.floor(y);
        const u = fade(xf), v = fade(yf);
        const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
        const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
        return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
                    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v);
    }

    // ========== 游戏状态 ==========
    let running = false, score = 0, ballsLeft = 3, highScore = 0;
    try { highScore = +localStorage.getItem('pb3dHigh') || 0; } catch (e) { }
    highscoreEl.textContent = highScore;
    let frame = 0, time = 0;
    const keys = {};

    let ball = null, launched = false, inLane = false, springComp = 0;
    let flippers = [], bumpers = [], slings = [];
    let particles = [], popups = [], arcs = [];
    let decorLights = [], rollovers = [];

    // 闪电裂纹（预生成）
    let cracks = [];
    // 管道轨道（装饰性霓虹管）
    let neonTubes = [];
    // 漩涡黑洞
    let vortex = { x: 189, y: 420, r: 50, angle: 0 };

    function mkBall() {
        return { x: LW - LANE_W / 2, y: LH - 160, vx: 0, vy: 0, r: BALL_R, trail: [], spin: 0, energy: 1 };
    }

    // ========== Flipper ==========
    class Flipper {
        constructor(x, y, side) {
            this.x = x; this.y = y; this.side = side;
            this.len = FL;
            this.angle = side === 'left' ? F_REST : Math.PI - F_REST;
            this.rest = this.angle;
            this.max = side === 'left' ? F_MAX : Math.PI - F_MAX;
            this.on = false; this.glow = 0;
        }
        update() {
            if (this.on) {
                this.angle += this.side === 'left' ? -FS : FS;
                if (this.side === 'left') this.angle = Math.max(this.angle, this.max);
                else this.angle = Math.min(this.angle, this.max);
                this.glow = Math.min(1, this.glow + 0.25);
            } else {
                this.angle += this.side === 'left' ? FS * 0.7 : -FS * 0.7;
                if (this.side === 'left') this.angle = Math.min(this.angle, this.rest);
                else this.angle = Math.max(this.angle, this.rest);
                this.glow = Math.max(0, this.glow - 0.1);
            }
        }
        tip() { return { x: this.x + Math.cos(this.angle) * this.len, y: this.y + Math.sin(this.angle) * this.len }; }
        draw() {
            const t = this.tip();
            const p0 = proj(this.x, this.y), p1 = proj(t.x, t.y);
            const thick = FT * scaleAt((this.y + t.y) / 2) * (RENDER_W / LW);
            const sc = scaleAt((this.y + t.y) / 2);
            ctx.save();
            ctx.lineCap = 'round';

            // 计算法线方向
            const fdx = p1.x - p0.x, fdy = p1.y - p0.y;
            const fnl = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
            const fnx = -fdy / fnl, fny = fdx / fnl;

            // 底部投影
            ctx.lineWidth = thick + 8;
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath(); ctx.moveTo(p0.x + 5, p0.y + 9); ctx.lineTo(p1.x + 5, p1.y + 9); ctx.stroke();

            // 侧面（前面 — 可见的高度面）
            ctx.lineWidth = thick + 4;
            ctx.strokeStyle = '#1a1e30';
            ctx.beginPath(); ctx.moveTo(p0.x + 1, p0.y + ELEMENT_H * 1.8); ctx.lineTo(p1.x + 1, p1.y + ELEMENT_H * 1.8); ctx.stroke();

            // 侧面金属渐变
            const sideG = ctx.createLinearGradient(p0.x, p0.y + ELEMENT_H * 0.5, p0.x, p0.y + ELEMENT_H * 1.8);
            sideG.addColorStop(0, '#3a4568');
            sideG.addColorStop(0.5, '#2a3250');
            sideG.addColorStop(1, '#1a2038');
            ctx.lineWidth = thick + 2;
            ctx.strokeStyle = sideG;
            ctx.beginPath(); ctx.moveTo(p0.x + 1, p0.y + ELEMENT_H * 1.2); ctx.lineTo(p1.x + 1, p1.y + ELEMENT_H * 1.2); ctx.stroke();

            // 主体 — 顶面圆柱形金属渐变
            const g = ctx.createLinearGradient(p0.x + fnx * thick * 0.5, p0.y + fny * thick * 0.5, p0.x - fnx * thick * 0.5, p0.y - fny * thick * 0.5);
            g.addColorStop(0, '#5a6888');
            g.addColorStop(0.12, '#7888a8');
            g.addColorStop(0.25, '#98a8c8');
            g.addColorStop(0.35, '#b8c8e0');
            g.addColorStop(0.45, '#d0d8ec');
            g.addColorStop(0.5, '#c8d0e4');
            g.addColorStop(0.6, '#a0b0c8');
            g.addColorStop(0.72, '#7888a8');
            g.addColorStop(0.85, '#506078');
            g.addColorStop(1, '#3a4060');
            ctx.lineWidth = thick;
            ctx.strokeStyle = g;
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();

            // 顶面主高光线
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = 'rgba(200,220,255,0.45)';
            ctx.beginPath(); ctx.moveTo(p0.x + fnx * thick * 0.15, p0.y + fny * thick * 0.15); ctx.lineTo(p1.x + fnx * thick * 0.15, p1.y + fny * thick * 0.15); ctx.stroke();

            // 顶面次高光
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = 'rgba(180,200,240,0.2)';
            ctx.beginPath(); ctx.moveTo(p0.x + fnx * thick * 0.3, p0.y + fny * thick * 0.3); ctx.lineTo(p1.x + fnx * thick * 0.3, p1.y + fny * thick * 0.3); ctx.stroke();

            // 霓虹边缘光
            const neonCol = this.side === 'left' ? NEON.cyan : NEON.purple;
            ctx.lineWidth = 1;
            ctx.strokeStyle = neonGlow(neonCol, 0.3 + this.glow * 0.5);
            ctx.shadowColor = neonCol; ctx.shadowBlur = 8 + this.glow * 15;
            ctx.beginPath(); ctx.moveTo(p0.x - fnx * thick * 0.1, p0.y - fny * thick * 0.1); ctx.lineTo(p1.x - fnx * thick * 0.1, p1.y - fny * thick * 0.1); ctx.stroke();
            ctx.shadowBlur = 0;

            // 轴心能量核心
            drawEnergyBolt(p0.x, p0.y, 8 * sc, neonCol);

            // 激活发光
            if (this.glow > 0) {
                ctx.globalAlpha = this.glow * 0.2;
                ctx.shadowColor = neonCol; ctx.shadowBlur = 30;
                ctx.lineWidth = thick + 4; ctx.strokeStyle = neonCol;
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
            }
            ctx.restore();
        }
        collide(b) {
            if (!b) return false;
            const t = this.tip(), dx = t.x - this.x, dy = t.y - this.y;
            const l2 = dx * dx + dy * dy; if (!l2) return false;
            let u = ((b.x - this.x) * dx + (b.y - this.y) * dy) / l2;
            u = Math.max(0, Math.min(1, u));
            const cx = this.x + u * dx, cy = this.y + u * dy;
            const ex = b.x - cx, ey = b.y - cy;
            const d = Math.sqrt(ex * ex + ey * ey), m = b.r + FT / 2 + 4;
            if (d < m && d > 0) {
                const nx = ex / d, ny = ey / d;
                b.x = cx + nx * (m + 2); b.y = cy + ny * (m + 2);
                const dot = b.vx * nx + b.vy * ny;
                const ff = this.on ? 9 : 2;
                b.vx = (b.vx - 2 * dot * nx) * 0.85 + nx * ff;
                b.vy = (b.vy - 2 * dot * ny) * 0.85 - (this.on ? 8 : 0);
                emitParticles(b.x, b.y, this.side === 'left' ? NEON.cyan : NEON.purple, 8);
                return true;
            }
            return false;
        }
    }

    // ========== Bumper（水晶球/能量核心） ==========
    class Bumper {
        constructor(x, y, r, pts, col, ring) {
            this.x = x; this.y = y; this.r = r;
            this.pts = pts; this.col = col; this.ring = ring || NEON.cyan;
            this.hit = 0; this.phase = Math.random() * 6.28;
            this.pulsePhase = Math.random() * 6.28;
        }
        update() { if (this.hit > 0) this.hit--; this.phase += 0.04; this.pulsePhase += 0.06; }
        draw() {
            const p = proj(this.x, this.y);
            const pr = projR(this.r, this.y);
            const sc = scaleAt(this.y);
            const glow = this.hit > 0;
            const pulse = 0.8 + Math.sin(this.pulsePhase) * 0.2;
            ctx.save();

            // 地面投影 — 霓虹颜色
            ctx.fillStyle = neonGlow(this.ring, 0.15 + (glow ? 0.2 : 0));
            ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 8, pr + 8, (pr + 8) * 0.4, 0, 0, Math.PI * 2); ctx.fill();

            // 底座 — 暗金属环
            const baseH = ELEMENT_H * 2 * sc;
            const baseGrad = ctx.createLinearGradient(p.x - pr, p.y, p.x + pr, p.y);
            baseGrad.addColorStop(0, '#1a1e30'); baseGrad.addColorStop(0.3, '#2a3050');
            baseGrad.addColorStop(0.7, '#1e2240'); baseGrad.addColorStop(1, '#101428');
            ctx.fillStyle = baseGrad;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + baseH, pr + 5, (pr + 5) * 0.38, 0, 0, Math.PI);
            ctx.lineTo(p.x - pr - 5, p.y);
            ctx.ellipse(p.x, p.y, pr + 5, (pr + 5) * 0.38, 0, Math.PI, 0, true);
            ctx.closePath(); ctx.fill();

            // 底座霓虹环
            ctx.lineWidth = 2 * sc;
            ctx.strokeStyle = neonGlow(this.ring, 0.4 + (glow ? 0.4 : 0));
            ctx.shadowColor = this.ring; ctx.shadowBlur = glow ? 15 : 6;
            ctx.beginPath(); ctx.ellipse(p.x, p.y + baseH * 0.5, pr + 4, (pr + 4) * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.shadowBlur = 0;

            // 外圈金属环 — 反射
            const rgr = ctx.createLinearGradient(p.x - pr, p.y - pr, p.x + pr, p.y + pr);
            rgr.addColorStop(0, '#606880'); rgr.addColorStop(0.2, '#a0a8c0');
            rgr.addColorStop(0.4, '#404860'); rgr.addColorStop(0.6, '#808898');
            rgr.addColorStop(0.8, '#303850'); rgr.addColorStop(1, '#505870');
            ctx.lineWidth = 4.5 * sc;
            ctx.strokeStyle = rgr;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, pr, pr * 0.72, 0, 0, Math.PI * 2); ctx.stroke();

            // 水晶球体 — 半透明+内部能量
            // 外层玻璃
            const glassG = ctx.createRadialGradient(p.x - pr * 0.25, p.y - pr * 0.2, 0, p.x, p.y, pr * 0.88);
            glassG.addColorStop(0, `rgba(255,255,255,${glow ? 0.35 : 0.15})`);
            glassG.addColorStop(0.25, neonGlow(this.col, glow ? 0.4 : 0.15));
            glassG.addColorStop(0.5, neonGlow(this.col, glow ? 0.25 : 0.08));
            glassG.addColorStop(0.8, neonGlow(darken(this.col, 0.3), 0.15));
            glassG.addColorStop(1, 'rgba(0,0,0,0.3)');
            ctx.fillStyle = glassG;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, pr * 0.85, pr * 0.85 * 0.72, 0, 0, Math.PI * 2); ctx.fill();

            // 内部能量核心
            const coreR = pr * 0.4 * pulse;
            const coreG = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, coreR);
            coreG.addColorStop(0, glow ? '#ffffff' : lighten(this.col, 0.7));
            coreG.addColorStop(0.3, this.col);
            coreG.addColorStop(0.7, neonGlow(this.col, 0.4));
            coreG.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = coreG;
            ctx.beginPath(); ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2); ctx.fill();

            // 内部电弧
            ctx.strokeStyle = neonGlow(this.ring, 0.3 + (glow ? 0.5 : 0));
            ctx.lineWidth = 1 * sc;
            for (let i = 0; i < 3; i++) {
                const a = this.phase + i * 2.09;
                const startX = p.x + Math.cos(a) * coreR * 0.3;
                const startY = p.y + Math.sin(a) * coreR * 0.3 * 0.72;
                const endX = p.x + Math.cos(a + 1) * pr * 0.6;
                const endY = p.y + Math.sin(a + 1) * pr * 0.6 * 0.72;
                const midX = (startX + endX) / 2 + (Math.sin(this.phase * 3 + i) * 5);
                const midY = (startY + endY) / 2 + (Math.cos(this.phase * 2 + i) * 3);
                ctx.beginPath(); ctx.moveTo(startX, startY);
                ctx.quadraticCurveTo(midX, midY, endX, endY); ctx.stroke();
            }

            // 玻璃高光 — 主高光（大椭圆）
            ctx.fillStyle = `rgba(255,255,255,${glow ? 0.55 : 0.28})`;
            ctx.beginPath(); ctx.ellipse(p.x - pr * 0.15, p.y - pr * 0.18, pr * 0.38, pr * 0.16, -0.4, 0, Math.PI * 2); ctx.fill();

            // 次高光（小圆点）
            ctx.fillStyle = `rgba(255,255,255,${glow ? 0.4 : 0.15})`;
            ctx.beginPath(); ctx.arc(p.x + pr * 0.25, p.y + pr * 0.22, pr * 0.08, 0, Math.PI * 2); ctx.fill();

            // 外圈装饰灯（脉冲）— 优化shadowBlur切换
            ctx.shadowBlur = 0;
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2 + this.phase;
                const dx = Math.cos(a) * (pr + 7 * sc), dy = Math.sin(a) * (pr * 0.72 + 5 * sc);
                const lit = glow || (Math.sin(this.phase * 2 + i * 0.6) > 0.3);
                ctx.fillStyle = lit ? this.ring : neonGlow(this.ring, 0.15);
                ctx.beginPath(); ctx.arc(p.x + dx, p.y + dy, 1.8 * sc, 0, Math.PI * 2); ctx.fill();
            }

            // 击中时的大范围辉光
            if (glow) {
                ctx.globalAlpha = this.hit / 15 * 0.35;
                ctx.shadowColor = this.col; ctx.shadowBlur = 45;
                ctx.fillStyle = this.col;
                ctx.beginPath(); ctx.ellipse(p.x, p.y, pr * 1.5, pr * 1.5 * 0.72, 0, 0, Math.PI * 2); ctx.fill();
            }

            ctx.restore();
        }
        collide(b) {
            if (!b) return false;
            const dx = b.x - this.x, dy = b.y - this.y;
            const d = Math.sqrt(dx * dx + dy * dy), m = b.r + this.r;
            if (d < m && d > 0) {
                const nx = dx / d, ny = dy / d;
                b.x = this.x + nx * (m + 1); b.y = this.y + ny * (m + 1);
                b.vx = nx * BUMP_BOUNCE; b.vy = ny * BUMP_BOUNCE;
                this.hit = 15;
                addScore(this.pts);
                emitParticles(b.x, b.y, this.col, 14);
                emitArc(this.x, this.y, b.x, b.y, this.ring);
                return true;
            }
            return false;
        }
    }

    // ========== Slingshot（霓虹护盾） ==========
    class Slingshot {
        constructor(x1, y1, x2, y2, pts, col) {
            this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
            this.pts = pts; this.col = col; this.hit = 0;
        }
        update() { if (this.hit > 0) this.hit--; }
        draw() {
            const pa = proj(this.x1, this.y1), pb = proj(this.x2, this.y2);
            const glow = this.hit > 0;
            const sc = scaleAt((this.y1 + this.y2) / 2);
            ctx.save();
            ctx.lineCap = 'round';

            // 计算法线方向
            const dx = pb.x - pa.x, dy = pb.y - pa.y;
            const nl = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / nl, ny = dx / nl;
            const hw = 5 * sc;  // half-width

            // 投影
            ctx.lineWidth = 10 * sc;
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath(); ctx.moveTo(pa.x + 4, pa.y + 6); ctx.lineTo(pb.x + 4, pb.y + 6); ctx.stroke();

            // 侧面（前面高度）
            ctx.lineWidth = 8 * sc;
            ctx.strokeStyle = '#1e2640';
            ctx.beginPath(); ctx.moveTo(pa.x, pa.y + ELEMENT_H * 1.5 * sc); ctx.lineTo(pb.x, pb.y + ELEMENT_H * 1.5 * sc); ctx.stroke();

            // 主体 — 圆柱形金属渐变（模拟弧形截面）
            const metalG = ctx.createLinearGradient(
                (pa.x + pb.x) / 2 + nx * hw * 2, (pa.y + pb.y) / 2 + ny * hw * 2,
                (pa.x + pb.x) / 2 - nx * hw * 2, (pa.y + pb.y) / 2 - ny * hw * 2
            );
            metalG.addColorStop(0, '#4a5878');
            metalG.addColorStop(0.15, '#6878a0');
            metalG.addColorStop(0.3, '#8898b8');
            metalG.addColorStop(0.45, '#a8b8d0');
            metalG.addColorStop(0.5, '#b8c8e0');
            metalG.addColorStop(0.55, '#a0b0c8');
            metalG.addColorStop(0.7, '#7888a8');
            metalG.addColorStop(0.85, '#506078');
            metalG.addColorStop(1, '#3a4860');
            ctx.lineWidth = (glow ? 9 : 8) * sc;
            ctx.strokeStyle = metalG;
            ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();

            // 顶面高光条
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = 'rgba(200,220,255,0.35)';
            ctx.beginPath();
            ctx.moveTo(pa.x + nx * hw * 0.3, pa.y + ny * hw * 0.3);
            ctx.lineTo(pb.x + nx * hw * 0.3, pb.y + ny * hw * 0.3);
            ctx.stroke();

            // 霓虹边缘（内侧更亮）
            ctx.lineWidth = 1.5 * sc;
            ctx.strokeStyle = neonGlow(this.col, glow ? 0.9 : 0.5);
            ctx.shadowColor = this.col; ctx.shadowBlur = glow ? 20 : 8;
            ctx.beginPath(); ctx.moveTo(pa.x + nx * 0.35, pa.y + ny * 0.35); ctx.lineTo(pb.x + nx * 0.35, pb.y + ny * 0.35); ctx.stroke();
            ctx.shadowBlur = 0;

            // 端点能量球
            drawEnergyBolt(pa.x, pa.y, 4 * sc, this.col);
            drawEnergyBolt(pb.x, pb.y, 4 * sc, this.col);

            if (glow) {
                ctx.globalAlpha = this.hit / 12 * 0.3;
                ctx.shadowColor = this.col; ctx.shadowBlur = 25;
                ctx.lineWidth = 8 * sc; ctx.strokeStyle = this.col;
                ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
            }
            ctx.restore();
        }
        collide(b) {
            if (!b) return false;
            const dx = this.x2 - this.x1, dy = this.y2 - this.y1;
            const l2 = dx * dx + dy * dy; if (!l2) return false;
            let t = ((b.x - this.x1) * dx + (b.y - this.y1) * dy) / l2;
            t = Math.max(0, Math.min(1, t));
            const cx = this.x1 + t * dx, cy = this.y1 + t * dy;
            const ex = b.x - cx, ey = b.y - cy;
            const d = Math.sqrt(ex * ex + ey * ey), m = b.r + 4;
            if (d < m && d > 0) {
                const nx = ex / d, ny = ey / d;
                b.x = cx + nx * (m + 2); b.y = cy + ny * (m + 2);
                const dot = b.vx * nx + b.vy * ny;
                b.vx = (b.vx - 2 * dot * nx) * 0.95; b.vy = (b.vy - 2 * dot * ny) * 0.95;
                this.hit = 12;
                addScore(this.pts);
                emitParticles((this.x1 + this.x2) / 2, (this.y1 + this.y2) / 2, this.col, 10);
                emitArc(cx, cy, b.x, b.y, this.col);
                return true;
            }
            return false;
        }
    }

    // ========== 绘图辅助 ==========
    function drawEnergyBolt(px, py, r, col) {
        const g = ctx.createRadialGradient(px - r * 0.2, py - r * 0.2, 0, px, py, r);
        g.addColorStop(0, '#fff'); g.addColorStop(0.3, lighten(col, 0.5));
        g.addColorStop(0.6, col); g.addColorStop(1, neonGlow(col, 0.2));
        ctx.fillStyle = g;
        ctx.shadowColor = col; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    }

    // ========== 粒子系统 ==========
    function emitParticles(lx, ly, col, n) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
            particles.push({
                x: lx, y: ly, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
                life: 25 + Math.random() * 25, max: 50, col, r: 1 + Math.random() * 2,
                type: Math.random() > 0.4 ? 'spark' : 'dot'
            });
        }
    }
    function emitArc(x1, y1, x2, y2, col) {
        arcs.push({ x1, y1, x2, y2, col, life: 12, max: 12 });
    }
    function tickParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.vx *= 0.97; p.vy *= 0.97;
            if (--p.life <= 0) particles.splice(i, 1);
        }
        for (let i = arcs.length - 1; i >= 0; i--) {
            if (--arcs[i].life <= 0) arcs.splice(i, 1);
        }
    }
    function drawParticles() {
        for (const p of particles) {
            const pp = proj(p.x, p.y), a = p.life / p.max;
            const sc = scaleAt(p.y);
            ctx.save(); ctx.globalAlpha = a;
            if (p.type === 'spark') {
                const pv = proj(p.x - p.vx * 4, p.y - p.vy * 4);
                ctx.strokeStyle = p.col; ctx.lineWidth = p.r * 0.6 * sc;
                ctx.shadowColor = p.col; ctx.shadowBlur = 4;
                ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(pv.x, pv.y); ctx.stroke();
            } else {
                ctx.shadowColor = p.col; ctx.shadowBlur = 6;
                ctx.fillStyle = p.col;
                ctx.beginPath(); ctx.arc(pp.x, pp.y, p.r * a * sc, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }
        // 电弧
        for (const arc of arcs) {
            const pa = proj(arc.x1, arc.y1), pb = proj(arc.x2, arc.y2);
            const a = arc.life / arc.max;
            ctx.save(); ctx.globalAlpha = a * 0.7;
            ctx.strokeStyle = arc.col; ctx.lineWidth = 1.5;
            ctx.shadowColor = arc.col; ctx.shadowBlur = 10;
            const mid = { x: (pa.x + pb.x) / 2 + (Math.random() - 0.5) * 20, y: (pa.y + pb.y) / 2 + (Math.random() - 0.5) * 15 };
            ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mid.x, mid.y, pb.x, pb.y); ctx.stroke();
            ctx.restore();
        }
    }

    // ========== 关卡初始化 ==========
    function initLevel() {
        flippers = [new Flipper(96, LH - 55, 'left'), new Flipper(282, LH - 55, 'right')];
        bumpers = [
            new Bumper(120, 170, 30, 100, NEON.cyan, NEON.cyan),
            new Bumper(250, 150, 30, 100, NEON.purple, NEON.purple),
            new Bumper(185, 250, 35, 150, NEON.magenta, NEON.magenta),
            new Bumper(90, 330, 24, 50, NEON.green, NEON.green),
            new Bumper(280, 310, 24, 50, NEON.orange, NEON.orange),
        ];
        slings = [
            new Slingshot(35, 470, 85, 550, 25, NEON.cyan),
            new Slingshot(343, 470, 293, 550, 25, NEON.cyan),
            new Slingshot(40, 110, 95, 75, 30, NEON.green),
            new Slingshot(338, 110, 283, 75, 30, NEON.green),
            new Slingshot(150, 400, 192, 378, 20, NEON.purple),
            new Slingshot(228, 400, 186, 378, 20, NEON.purple),
        ];
        initCracks(); initNeonTubes(); initDecor(); initRollovers();
    }

    function initCracks() {
        cracks = [];
        const rng = mulberry32(777);
        for (let i = 0; i < 18; i++) {
            const pts = [];
            let lx = rng() * LW * 0.8 + LW * 0.1, ly = rng() * LH * 0.8 + LH * 0.1;
            pts.push({ x: lx, y: ly });
            const segs = 4 + Math.floor(rng() * 6);
            for (let j = 0; j < segs; j++) {
                lx += (rng() - 0.5) * 70; ly += (rng() - 0.5) * 70;
                lx = Math.max(10, Math.min(LW - 10, lx));
                ly = Math.max(10, Math.min(LH - 10, ly));
                pts.push({ x: lx, y: ly });
                // 分支
                if (rng() > 0.6) {
                    const bx = lx + (rng() - 0.5) * 40, by = ly + (rng() - 0.5) * 40;
                    pts.push({ x: bx, y: by, branch: true });
                    pts.push({ x: lx, y: ly, rejoin: true });
                }
            }
            cracks.push({ pts, col: rng() > 0.5 ? NEON.cyan : NEON.purple, width: 0.5 + rng() * 1 });
        }
    }

    function initNeonTubes() {
        neonTubes = [
            // 左弧形管道
            { pts: [[20, 100], [30, 50], [100, 20], [200, 15], [280, 20], [350, 50], [358, 100]], col: NEON.cyan, w: 4 },
            // 右弧形管道
            { pts: [[50, 460], [90, 480], [140, 490], [230, 490], [280, 480], [320, 460]], col: NEON.purple, w: 3 },
            // 中央 V 形
            { pts: [[100, 350], [189, 380], [278, 350]], col: NEON.magenta, w: 3 },
        ];
    }

    function initDecor() {
        decorLights = [];
        for (let i = 0; i < 24; i++) {
            const a = Math.PI + (i / 23) * Math.PI;
            decorLights.push({
                x: LANE_LEFT / 2 + Math.cos(a) * (LANE_LEFT / 2 - 15),
                y: 20 - Math.sin(a) * 12,
                col: i % 3 === 0 ? NEON.cyan : i % 3 === 1 ? NEON.purple : NEON.magenta,
                ph: i * 0.4
            });
        }
        for (let i = 0; i < 9; i++) {
            decorLights.push({ x: 10, y: 90 + i * 55, col: i % 2 ? NEON.cyan : NEON.orange, ph: i * 0.7 });
            decorLights.push({ x: LANE_LEFT - 10, y: 90 + i * 55, col: i % 2 ? NEON.purple : NEON.green, ph: i * 0.7 + 0.35 });
        }
    }

    function initRollovers() {
        rollovers = [];
        const cx = LANE_LEFT / 2;
        for (let i = 0; i < 5; i++) {
            rollovers.push({
                x: cx - 60 + i * 30, y: 50, lit: false,
                col: [NEON.cyan, NEON.purple, NEON.magenta, NEON.green, NEON.orange][i]
            });
        }
    }

    // ========== 预渲染背景 ==========
    let bgBuf = null;
    function preRender() {
        bgBuf = document.createElement('canvas');
        bgBuf.width = RENDER_W; bgBuf.height = RENDER_H;
        const c = bgBuf.getContext('2d');

        c.fillStyle = '#020408';
        c.fillRect(0, 0, RENDER_W, RENDER_H);

        drawTableCasing(c);
        drawTableSurface(c);
        drawBrushedMetal(c);
        drawSlopeShading(c);
        drawStaticRails(c);
        drawTableDecorations(c);
    }

    function drawTableCasing(c) {
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        c.save();
        const pad = TABLE_WALL_H;

        // 外框 — 拉丝金属带微妙蓝光
        const sides = [
            { path: [[tl.x - pad, tl.y - pad * 0.5], [tl.x, tl.y], [bl.x, bl.y], [bl.x - pad, bl.y + pad * 0.3]], dir: 'v' },
            { path: [[tr.x + pad, tr.y - pad * 0.5], [tr.x, tr.y], [br.x, br.y], [br.x + pad, br.y + pad * 0.3]], dir: 'v' },
            { path: [[tl.x - pad, tl.y - pad * 0.5], [tr.x + pad, tr.y - pad * 0.5], [tr.x, tr.y], [tl.x, tl.y]], dir: 'h' },
            { path: [[bl.x - pad, bl.y + pad * 0.3], [bl.x, bl.y], [br.x, br.y], [br.x + pad, br.y + pad * 0.3]], dir: 'h' },
        ];

        for (let si = 0; si < sides.length; si++) {
            const side = sides[si];
            const g = side.dir === 'v'
                ? c.createLinearGradient(side.path[0][0], 0, side.path[1][0], 0)
                : c.createLinearGradient(0, side.path[0][1], 0, side.path[2][1]);
            // 更亮更有层次的金属
            g.addColorStop(0, '#181e30');
            g.addColorStop(0.15, '#2a3450');
            g.addColorStop(0.35, '#3a4868');
            g.addColorStop(0.5, '#2e3c58');
            g.addColorStop(0.65, '#3a4868');
            g.addColorStop(0.85, '#2a3450');
            g.addColorStop(1, '#181e30');
            c.fillStyle = g;
            c.beginPath();
            c.moveTo(side.path[0][0], side.path[0][1]);
            for (let i = 1; i < side.path.length; i++) c.lineTo(side.path[i][0], side.path[i][1]);
            c.closePath(); c.fill();

            // 拉丝纹理条
            c.save();
            c.beginPath();
            c.moveTo(side.path[0][0], side.path[0][1]);
            for (let i = 1; i < side.path.length; i++) c.lineTo(side.path[i][0], side.path[i][1]);
            c.closePath(); c.clip();
            c.globalAlpha = 0.04;
            c.strokeStyle = '#6080b0';
            c.lineWidth = 0.5;
            if (side.dir === 'v') {
                for (let y = Math.floor(side.path[0][1]); y < side.path[2][1]; y += 3) {
                    c.beginPath(); c.moveTo(side.path[0][0], y); c.lineTo(side.path[1][0], y); c.stroke();
                }
            } else {
                for (let x = Math.floor(Math.min(side.path[0][0], side.path[2][0])); x < Math.max(side.path[1][0], side.path[3][0]); x += 3) {
                    c.beginPath(); c.moveTo(x, side.path[0][1]); c.lineTo(x, side.path[2][1]); c.stroke();
                }
            }
            c.restore();
        }

        // 内边缘 — 双重霓虹线（加强深度感）
        // 外层霓虹
        c.strokeStyle = neonGlow(NEON.cyan, 0.35); c.lineWidth = 2;
        c.shadowColor = NEON.cyan; c.shadowBlur = 15;
        c.beginPath();
        c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
        c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
        c.closePath(); c.stroke();

        // 内层霓虹（更细更亮）
        c.strokeStyle = neonGlow(NEON.cyan, 0.15); c.lineWidth = 0.8;
        c.shadowBlur = 5;
        c.beginPath();
        c.moveTo(tl.x + 3, tl.y + 2); c.lineTo(tr.x - 3, tr.y + 2);
        c.lineTo(br.x - 3, br.y - 2); c.lineTo(bl.x + 3, bl.y - 2);
        c.closePath(); c.stroke();
        c.shadowBlur = 0;

        // 外框边缘
        c.strokeStyle = 'rgba(60,80,120,0.5)'; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(tl.x - pad, tl.y - pad * 0.5);
        c.lineTo(tr.x + pad, tr.y - pad * 0.5);
        c.lineTo(br.x + pad, br.y + pad * 0.3);
        c.lineTo(bl.x - pad, bl.y + pad * 0.3);
        c.closePath(); c.stroke();

        // 外框高光线（顶部）
        c.strokeStyle = 'rgba(120,150,200,0.15)'; c.lineWidth = 1;
        c.beginPath();
        c.moveTo(tl.x - pad + 2, tl.y - pad * 0.5 + 1);
        c.lineTo(tr.x + pad - 2, tr.y - pad * 0.5 + 1);
        c.stroke();

        // 螺栓装饰
        const boltPositions = [
            [tl.x - pad * 0.5, tl.y - pad * 0.25],
            [tr.x + pad * 0.5, tr.y - pad * 0.25],
            [bl.x - pad * 0.5, bl.y + pad * 0.15],
            [br.x + pad * 0.5, br.y + pad * 0.15],
            [(tl.x + tr.x) / 2, tl.y - pad * 0.3],
        ];
        for (const [bx, by] of boltPositions) {
            const boltG = c.createRadialGradient(bx - 0.5, by - 0.5, 0, bx, by, 4);
            boltG.addColorStop(0, '#90a0c0');
            boltG.addColorStop(0.3, '#6878a0');
            boltG.addColorStop(0.6, '#404c68');
            boltG.addColorStop(1, '#2a3248');
            c.fillStyle = boltG;
            c.beginPath(); c.arc(bx, by, 4, 0, Math.PI * 2); c.fill();
            // 十字槽
            c.strokeStyle = '#1a2038'; c.lineWidth = 0.8;
            c.beginPath(); c.moveTo(bx - 2, by); c.lineTo(bx + 2, by); c.stroke();
            c.beginPath(); c.moveTo(bx, by - 2); c.lineTo(bx, by + 2); c.stroke();
        }

        c.restore();
    }

    function drawTableSurface(c) {
        c.save();
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        c.beginPath();
        c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
        c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
        c.closePath(); c.clip();

        // 深空背景 — 但更亮更金属
        const g = c.createLinearGradient(0, tl.y, 0, bl.y);
        g.addColorStop(0, '#0a1420'); g.addColorStop(0.15, '#0e1828');
        g.addColorStop(0.3, '#101c2e');
        g.addColorStop(0.5, '#0c1824');
        g.addColorStop(0.7, '#0e1a28');
        g.addColorStop(1, '#101e30');
        c.fillStyle = g;
        c.fillRect(0, 0, RENDER_W, RENDER_H);

        // 中央辉光（淡紫）
        const cx = proj(LANE_LEFT / 2, LH * 0.5);
        const rg = c.createRadialGradient(cx.x, cx.y, 0, cx.x, cx.y, 220);
        rg.addColorStop(0, 'rgba(60,30,120,0.12)');
        rg.addColorStop(0.5, 'rgba(20,40,100,0.06)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = rg; c.fillRect(0, 0, RENDER_W, RENDER_H);

        c.restore();
    }

    function drawBrushedMetal(c) {
        c.save();
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        c.beginPath();
        c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
        c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
        c.closePath(); c.clip();

        // 拉丝金属纹理 — 用噪声模拟
        const imgData = c.getImageData(0, 0, RENDER_W, RENDER_H);
        const data = imgData.data;
        for (let py = Math.floor(tl.y); py < Math.floor(bl.y); py += 2) {
            for (let px = Math.floor(Math.min(tl.x, bl.x)); px < Math.floor(Math.max(tr.x, br.x)); px += 2) {
                if (px < 0 || px >= RENDER_W || py < 0 || py >= RENDER_H) continue;
                const n = noise2D(px * 0.03, py * 0.15) * 0.5 + 0.5; // 水平拉丝方向
                const n2 = noise2D(px * 0.1 + 100, py * 0.1 + 100) * 0.5 + 0.5;
                const brightness = (n * 0.7 + n2 * 0.3) * 28 - 14;
                const idx = (py * RENDER_W + px) * 4;
                data[idx] = clamp(data[idx] + brightness * 0.7);
                data[idx + 1] = clamp(data[idx + 1] + brightness * 0.8);
                data[idx + 2] = clamp(data[idx + 2] + brightness * 1.4);
                // 也填充相邻像素（加速）
                if (px + 1 < RENDER_W) {
                    const idx2 = idx + 4;
                    data[idx2] = clamp(data[idx2] + brightness * 0.6);
                    data[idx2 + 1] = clamp(data[idx2 + 1] + brightness * 0.7);
                    data[idx2 + 2] = clamp(data[idx2 + 2] + brightness * 1.2);
                }
            }
        }
        c.putImageData(imgData, 0, 0);
        c.restore();
    }

    // ========== 坡度光照 — 模拟桌面倾斜的光照效果 ==========
    function drawSlopeShading(c) {
        c.save();
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        c.beginPath();
        c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
        c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
        c.closePath(); c.clip();

        // 顶部偏亮（光从上方照射）—— 模拟坡度
        const slopeG = c.createLinearGradient(0, tl.y, 0, bl.y);
        slopeG.addColorStop(0, 'rgba(80,100,140,0.06)');
        slopeG.addColorStop(0.15, 'rgba(60,80,120,0.04)');
        slopeG.addColorStop(0.4, 'rgba(0,0,0,0)');
        slopeG.addColorStop(0.7, 'rgba(0,0,0,0.04)');
        slopeG.addColorStop(1, 'rgba(0,0,0,0.1)');
        c.fillStyle = slopeG;
        c.fillRect(0, 0, RENDER_W, RENDER_H);

        // 左侧高光条 — 环境光反射
        const leftG = c.createLinearGradient(tl.x, 0, tl.x + 80, 0);
        leftG.addColorStop(0, 'rgba(80,100,150,0.06)');
        leftG.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = leftG;
        c.fillRect(0, 0, RENDER_W, RENDER_H);

        // 中央区域微妙凹陷（漩涡附近更暗）
        const vp = proj(vortex.x, vortex.y);
        const vr = projR(vortex.r * 2.5, vortex.y);
        const depthG = c.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, vr);
        depthG.addColorStop(0, 'rgba(0,0,0,0.15)');
        depthG.addColorStop(0.4, 'rgba(0,0,0,0.06)');
        depthG.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = depthG;
        c.fillRect(0, 0, RENDER_W, RENDER_H);

        c.restore();
    }

    // ========== 立体管道/轨道 — 模拟圆柱形金属管道 ==========
    function drawStaticRails(c) {
        c.save();
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        c.beginPath();
        c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
        c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
        c.closePath(); c.clip();

        // 管道定义：每条管道由控制点组成
        const rails = [
            // 右侧弧形管道（从顶部弯曲到中间）
            { pts: [[LW - 15, 40], [LW - 10, 120], [LW - 20, 200], [LW - 50, 280], [LANE_LEFT - 30, 350]], col: NEON.cyan, w: 7, glow: 0.35 },
            // 左侧弧形管道
            { pts: [[15, 40], [10, 120], [15, 220], [50, 320], [80, 380]], col: NEON.purple, w: 7, glow: 0.3 },
            // 顶部弧形管道（连接左右）
            { pts: [[60, 20], [120, 8], [189, 5], [258, 8], [318, 20]], col: NEON.magenta, w: 5, glow: 0.25 },
        ];

        for (const rail of rails) {
            draw3DRail(c, rail.pts, rail.w, rail.col, rail.glow);
        }

        c.restore();
    }

    function draw3DRail(c, logicalPts, width, col, glowAlpha) {
        if (logicalPts.length < 2) return;
        const pts = logicalPts.map(p => proj(p[0], p[1]));
        const scales = logicalPts.map(p => scaleAt(p[1]));

        c.save();

        // 底部投影
        c.save();
        c.globalAlpha = 0.35;
        c.strokeStyle = 'rgba(0,0,0,0.8)';
        c.lineWidth = width * 1.8;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(pts[0].x + 4, pts[0].y + 8);
        for (let i = 1; i < pts.length; i++) {
            if (i < pts.length - 1) {
                const mx = (pts[i].x + pts[i + 1].x) / 2 + 4;
                const my = (pts[i].y + pts[i + 1].y) / 2 + 8;
                c.quadraticCurveTo(pts[i].x + 4, pts[i].y + 8, mx, my);
            } else {
                c.lineTo(pts[i].x + 4, pts[i].y + 8);
            }
        }
        c.stroke();
        c.restore();

        // 管道暗面（下半部分）
        c.strokeStyle = '#1a2038';
        c.lineWidth = width * 1.6;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y + 2);
        for (let i = 1; i < pts.length; i++) {
            if (i < pts.length - 1) {
                const mx = (pts[i].x + pts[i + 1].x) / 2;
                const my = (pts[i].y + pts[i + 1].y) / 2 + 2;
                c.quadraticCurveTo(pts[i].x, pts[i].y + 2, mx, my);
            } else {
                c.lineTo(pts[i].x, pts[i].y + 2);
            }
        }
        c.stroke();

        // 管道主体 — 金属圆柱渐变（模拟圆柱形截面）
        // 使用path来获取管道方向，然后沿法线方向创建渐变
        const midIdx = Math.floor(pts.length / 2);
        const midPt = pts[midIdx];
        let tangentX = 0, tangentY = -1;
        if (midIdx > 0) {
            tangentX = pts[midIdx].x - pts[midIdx - 1].x;
            tangentY = pts[midIdx].y - pts[midIdx - 1].y;
            const tl = Math.sqrt(tangentX * tangentX + tangentY * tangentY) || 1;
            tangentX /= tl; tangentY /= tl;
        }
        const normalX = -tangentY, normalY = tangentX;
        const hw = width * 0.8;

        const metalG = c.createLinearGradient(
            midPt.x + normalX * hw, midPt.y + normalY * hw,
            midPt.x - normalX * hw, midPt.y - normalY * hw
        );
        metalG.addColorStop(0, '#3a4560');
        metalG.addColorStop(0.15, '#5a6880');
        metalG.addColorStop(0.3, '#8898b8');
        metalG.addColorStop(0.42, '#b0bcd0');  // 高光带
        metalG.addColorStop(0.5, '#c8d0e0');   // 最亮高光
        metalG.addColorStop(0.58, '#a0aec4');
        metalG.addColorStop(0.7, '#6878a0');
        metalG.addColorStop(0.85, '#404c68');
        metalG.addColorStop(1, '#2a3248');

        c.strokeStyle = metalG;
        c.lineWidth = width * 1.3;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            if (i < pts.length - 1) {
                const mx = (pts[i].x + pts[i + 1].x) / 2;
                const my = (pts[i].y + pts[i + 1].y) / 2;
                c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
            } else {
                c.lineTo(pts[i].x, pts[i].y);
            }
        }
        c.stroke();

        // 高光线（管道顶部反射条）
        c.strokeStyle = 'rgba(200,220,255,0.35)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(pts[0].x + normalX * hw * 0.4, pts[0].y + normalY * hw * 0.4);
        for (let i = 1; i < pts.length; i++) {
            const offX = normalX * hw * 0.4;
            const offY = normalY * hw * 0.4;
            if (i < pts.length - 1) {
                const mx = (pts[i].x + pts[i + 1].x) / 2 + offX;
                const my = (pts[i].y + pts[i + 1].y) / 2 + offY;
                c.quadraticCurveTo(pts[i].x + offX, pts[i].y + offY, mx, my);
            } else {
                c.lineTo(pts[i].x + offX, pts[i].y + offY);
            }
        }
        c.stroke();

        // 霓虹发光边缘（管道下缘）
        c.strokeStyle = neonGlow(col, glowAlpha);
        c.lineWidth = 1.2;
        c.shadowColor = col; c.shadowBlur = 10;
        c.beginPath();
        c.moveTo(pts[0].x - normalX * hw * 0.5, pts[0].y - normalY * hw * 0.5);
        for (let i = 1; i < pts.length; i++) {
            const offX = -normalX * hw * 0.5;
            const offY = -normalY * hw * 0.5;
            if (i < pts.length - 1) {
                const mx = (pts[i].x + pts[i + 1].x) / 2 + offX;
                const my = (pts[i].y + pts[i + 1].y) / 2 + offY;
                c.quadraticCurveTo(pts[i].x + offX, pts[i].y + offY, mx, my);
            } else {
                c.lineTo(pts[i].x + offX, pts[i].y + offY);
            }
        }
        c.stroke();
        c.shadowBlur = 0;

        // 端点金属环（管道入口/出口）
        for (const ep of [pts[0], pts[pts.length - 1]]) {
            const epSc = width * 0.8;
            const ringG = c.createRadialGradient(ep.x - 1, ep.y - 1, 0, ep.x, ep.y, epSc);
            ringG.addColorStop(0, '#c0c8e0');
            ringG.addColorStop(0.4, '#6878a0');
            ringG.addColorStop(0.7, '#3a4560');
            ringG.addColorStop(1, '#1a2038');
            c.fillStyle = ringG;
            c.beginPath(); c.arc(ep.x, ep.y, epSc, 0, Math.PI * 2); c.fill();
            // 内光环
            c.strokeStyle = neonGlow(col, 0.3);
            c.lineWidth = 1;
            c.shadowColor = col; c.shadowBlur = 5;
            c.beginPath(); c.arc(ep.x, ep.y, epSc * 0.6, 0, Math.PI * 2); c.stroke();
            c.shadowBlur = 0;
        }

        c.restore();
    }

    function drawTableDecorations(c) {
        c.save();
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        c.beginPath();
        c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
        c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
        c.closePath(); c.clip();

        // 箭头装饰 — 霓虹风格
        const arrows = [[LANE_LEFT / 2 - 40, 320], [LANE_LEFT / 2, 310], [LANE_LEFT / 2 + 40, 320], [55, 520], [LANE_LEFT - 55, 520], [LANE_LEFT / 2, 550]];
        const arrowCols = [NEON.cyan, NEON.magenta, NEON.cyan, NEON.orange, NEON.orange, NEON.green];
        const arrowSizes = [12, 12, 12, 8, 8, 10];
        for (let i = 0; i < arrows.length; i++) {
            const pp = proj(arrows[i][0], arrows[i][1]);
            const sz = arrowSizes[i] * scaleAt(arrows[i][1]);
            c.save();
            c.globalAlpha = 0.25;
            c.fillStyle = arrowCols[i];
            c.shadowColor = arrowCols[i]; c.shadowBlur = 6;
            c.beginPath();
            c.moveTo(pp.x, pp.y - sz); c.lineTo(pp.x - sz * 0.7, pp.y + sz * 0.5);
            c.lineTo(pp.x + sz * 0.7, pp.y + sz * 0.5);
            c.closePath(); c.fill();
            c.strokeStyle = neonGlow(arrowCols[i], 0.4); c.lineWidth = 0.8;
            c.stroke();
            c.restore();
        }

        c.restore();
    }

    // ========== 动态绘制 ==========

    function drawDynamicCracks() {
        // 动态闪电叠加 — 随时间脉冲
        ctx.save();
        for (const crack of cracks) {
            const pulse = Math.sin(time * 0.002 + crack.pts[0].x * 0.01) * 0.5 + 0.5;
            if (pulse < 0.3) continue;
            ctx.globalAlpha = pulse * 0.08;
            ctx.strokeStyle = crack.col; ctx.lineWidth = crack.width + 1;
            ctx.shadowColor = crack.col; ctx.shadowBlur = 10;
            ctx.beginPath();
            const fp = proj(crack.pts[0].x, crack.pts[0].y);
            ctx.moveTo(fp.x, fp.y);
            for (let i = 1; i < crack.pts.length; i++) {
                if (crack.pts[i].branch || crack.pts[i].rejoin) {
                    const pp = proj(crack.pts[i].x, crack.pts[i].y);
                    crack.pts[i].rejoin ? ctx.moveTo(pp.x, pp.y) : ctx.lineTo(pp.x, pp.y);
                } else {
                    const pp = proj(crack.pts[i].x, crack.pts[i].y);
                    ctx.lineTo(pp.x, pp.y);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawDynamicTubes() {
        // 保留但不再使用
    }

    // 立体管道上的能量流动动画
    function drawDynamicRailFlow() {
        const rails = [
            { pts: [[LW - 15, 40], [LW - 10, 120], [LW - 20, 200], [LW - 50, 280], [LANE_LEFT - 30, 350]], col: NEON.cyan },
            { pts: [[15, 40], [10, 120], [15, 220], [50, 320], [80, 380]], col: NEON.purple },
            { pts: [[60, 20], [120, 8], [189, 5], [258, 8], [318, 20]], col: NEON.magenta },
        ];

        ctx.save();
        for (const rail of rails) {
            const projPts = rail.pts.map(p => proj(p[0], p[1]));
            // 计算管道总长
            let totalLen = 0;
            const segLens = [];
            for (let i = 1; i < projPts.length; i++) {
                const sl = Math.sqrt((projPts[i].x - projPts[i-1].x)**2 + (projPts[i].y - projPts[i-1].y)**2);
                segLens.push(sl);
                totalLen += sl;
            }

            // 多个流动光点
            for (let dot = 0; dot < 3; dot++) {
                const pos = ((time * 0.002 + dot * 0.33) % 1);
                const target = pos * totalLen;
                let acc = 0, dotX = projPts[0].x, dotY = projPts[0].y;
                for (let i = 0; i < segLens.length; i++) {
                    if (acc + segLens[i] >= target) {
                        const t = (target - acc) / segLens[i];
                        dotX = projPts[i].x + (projPts[i+1].x - projPts[i].x) * t;
                        dotY = projPts[i].y + (projPts[i+1].y - projPts[i].y) * t;
                        break;
                    }
                    acc += segLens[i];
                }

                // 发光光点（带拖尾）
                ctx.globalAlpha = 0.7 - dot * 0.15;
                ctx.fillStyle = '#fff';
                ctx.shadowColor = rail.col; ctx.shadowBlur = 12;
                ctx.beginPath(); ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 0.3 - dot * 0.08;
                ctx.fillStyle = rail.col;
                ctx.beginPath(); ctx.arc(dotX, dotY, 6, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.restore();
    }

    function drawVortex() {
        // 蓝色漩涡黑洞 — 凹陷效果
        const p = proj(vortex.x, vortex.y);
        const pr = projR(vortex.r, vortex.y);
        const pry = pr * 0.72;
        vortex.angle += 0.02;
        ctx.save();

        // ---- 凹陷阴影（外圈暗影表示深度） ----
        const depthG = ctx.createRadialGradient(p.x, p.y, pr * 0.8, p.x, p.y, pr * 1.8);
        depthG.addColorStop(0, 'rgba(0,0,0,0.25)');
        depthG.addColorStop(0.5, 'rgba(0,0,0,0.1)');
        depthG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = depthG;
        ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 3, pr * 1.8, pry * 1.8, 0, 0, Math.PI * 2); ctx.fill();

        // ---- 凸起金属环（边缘） ----
        // 环的底部投影
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 4, pr + 4, pry + 3, 0, 0, Math.PI * 2); ctx.stroke();

        // 环暗面（底部）
        ctx.strokeStyle = '#1a2038';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, pr + 2, pry + 1.5, 0, 0.1, Math.PI - 0.1); ctx.stroke();

        // 环主体 — 金属渐变（模拟圆环截面）
        const ringG = ctx.createLinearGradient(p.x - pr, p.y - pry, p.x + pr, p.y + pry);
        ringG.addColorStop(0, '#404c68');
        ringG.addColorStop(0.2, '#6878a0');
        ringG.addColorStop(0.35, '#98a8c8');
        ringG.addColorStop(0.5, '#b8c4d8');
        ringG.addColorStop(0.65, '#8898b8');
        ringG.addColorStop(0.8, '#506080');
        ringG.addColorStop(1, '#303850');
        ctx.strokeStyle = ringG;
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, pr, pry, 0, 0, Math.PI * 2); ctx.stroke();

        // 环高光条
        ctx.strokeStyle = 'rgba(200,220,255,0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(p.x, p.y - 1, pr - 1, pry - 0.8, 0, Math.PI + 0.3, Math.PI * 2 - 0.3); ctx.stroke();

        // 环内壁暗影（内侧环壁）
        const innerShadowG = ctx.createRadialGradient(p.x, p.y, pr * 0.5, p.x, p.y, pr * 0.95);
        innerShadowG.addColorStop(0, 'rgba(0,0,0,0)');
        innerShadowG.addColorStop(0.6, 'rgba(0,0,0,0)');
        innerShadowG.addColorStop(0.85, 'rgba(0,0,0,0.2)');
        innerShadowG.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = innerShadowG;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, pr - 2, pry - 1.5, 0, 0, Math.PI * 2); ctx.fill();

        // 外辉光
        const og = ctx.createRadialGradient(p.x, p.y, pr * 0.3, p.x, p.y, pr * 1.5);
        og.addColorStop(0, neonGlow(NEON.blue, 0.12));
        og.addColorStop(0.5, neonGlow(NEON.purple, 0.05));
        og.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, pr * 1.2, pry * 1.2, 0, 0, Math.PI * 2); ctx.fill();

        // 漩涡臂
        for (let arm = 0; arm < 4; arm++) {
            const baseAngle = vortex.angle + arm * Math.PI / 2;
            ctx.strokeStyle = neonGlow(arm % 2 === 0 ? NEON.cyan : NEON.purple, 0.25);
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < 40; i++) {
                const t = i / 40;
                const a = baseAngle + t * Math.PI * 2.5;
                const r = t * pr * 0.85;
                const x = p.x + Math.cos(a) * r;
                const y = p.y + Math.sin(a) * r * 0.72;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // 核心
        const cg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 0.3);
        cg.addColorStop(0, neonGlow(NEON.cyan, 0.5));
        cg.addColorStop(0.5, neonGlow(NEON.purple, 0.2));
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, pr * 0.25, pr * 0.25 * 0.72, 0, 0, Math.PI * 2); ctx.fill();

        // 中心亮点
        ctx.fillStyle = 'rgba(200,230,255,0.5)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();

        // 环上霓虹
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.35);
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, pr + 3, pry + 2.2, 0, 0, Math.PI * 2); ctx.stroke();

        // 装饰螺栓（环上的凸起点）— 简化绘制避免过多渐变
        ctx.shadowBlur = 0;
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const bx = p.x + Math.cos(a) * (pr + 1);
            const by = p.y + Math.sin(a) * (pry + 0.7);
            ctx.fillStyle = '#7888a0';
            ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#a0aac0';
            ctx.beginPath(); ctx.arc(bx - 0.5, by - 0.5, 1.2, 0, Math.PI * 2); ctx.fill();
        }

        ctx.restore();
    }

    function drawTableWalls() {
        const walls = [
            [0, LH - 120, 70, LH - 55],
            [LANE_LEFT, LH - 120, 308, LH - 55],
            [0, LH - 120, 0, LH],
            [LANE_LEFT, LH - 120, LANE_LEFT, LH],
            [0, LH, 96, LH],
            [282, LH, LANE_LEFT, LH],
        ];
        for (const [x1, y1, x2, y2] of walls) {
            draw3DWall(x1, y1, x2, y2);
        }
    }

    function draw3DWall(x1, y1, x2, y2) {
        const pa = proj(x1, y1), pb = proj(x2, y2);
        const sc = scaleAt((y1 + y2) / 2);
        const wallH = ELEMENT_H * 2.2 * sc;  // 更高的墙壁
        const wallW = 8 * sc;  // 墙壁宽度
        ctx.save(); ctx.lineCap = 'round';

        // 计算法线方向（朝桌内侧）
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const nl = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / nl, ny = dx / nl;

        // ---- 1. 底部投影 ----
        ctx.lineWidth = wallW + 8;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.moveTo(pa.x + 5, pa.y + 8); ctx.lineTo(pb.x + 5, pb.y + 8); ctx.stroke();

        // ---- 2. 前面（侧面可见部分）----
        // 绘制为四边形填充
        ctx.fillStyle = '#1e2540';
        ctx.beginPath();
        ctx.moveTo(pa.x - nx * wallW * 0.5, pa.y - ny * wallW * 0.5);
        ctx.lineTo(pb.x - nx * wallW * 0.5, pb.y - ny * wallW * 0.5);
        ctx.lineTo(pb.x - nx * wallW * 0.5, pb.y - ny * wallW * 0.5 + wallH);
        ctx.lineTo(pa.x - nx * wallW * 0.5, pa.y - ny * wallW * 0.5 + wallH);
        ctx.closePath();
        ctx.fill();

        // 前面金属渐变
        const frontG = ctx.createLinearGradient(
            pa.x - nx * wallW * 0.5, pa.y,
            pa.x - nx * wallW * 0.5, pa.y + wallH
        );
        frontG.addColorStop(0, '#3a4568');
        frontG.addColorStop(0.3, '#2a3250');
        frontG.addColorStop(0.7, '#1e2540');
        frontG.addColorStop(1, '#141828');
        ctx.fillStyle = frontG;
        ctx.beginPath();
        ctx.moveTo(pa.x - nx * wallW * 0.5, pa.y - ny * wallW * 0.5);
        ctx.lineTo(pb.x - nx * wallW * 0.5, pb.y - ny * wallW * 0.5);
        ctx.lineTo(pb.x - nx * wallW * 0.5, pb.y - ny * wallW * 0.5 + wallH);
        ctx.lineTo(pa.x - nx * wallW * 0.5, pa.y - ny * wallW * 0.5 + wallH);
        ctx.closePath();
        ctx.fill();

        // ---- 3. 顶面 — 最亮的金属面（主要可见面） ----
        const topG = ctx.createLinearGradient(
            (pa.x + pb.x) / 2 + nx * wallW, (pa.y + pb.y) / 2 + ny * wallW,
            (pa.x + pb.x) / 2 - nx * wallW, (pa.y + pb.y) / 2 - ny * wallW
        );
        topG.addColorStop(0, '#5a6888');
        topG.addColorStop(0.15, '#7888a8');
        topG.addColorStop(0.3, '#98a8c8');
        topG.addColorStop(0.45, '#b8c4d8');  // 高光
        topG.addColorStop(0.5, '#c8d4e8');   // 最亮
        topG.addColorStop(0.55, '#b0bcd0');
        topG.addColorStop(0.7, '#8898b8');
        topG.addColorStop(0.85, '#607090');
        topG.addColorStop(1, '#405068');

        ctx.lineWidth = wallW;
        ctx.strokeStyle = topG;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();

        // ---- 4. 顶面高光条 ----
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(200,220,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(pa.x + nx * wallW * 0.2, pa.y + ny * wallW * 0.2);
        ctx.lineTo(pb.x + nx * wallW * 0.2, pb.y + ny * wallW * 0.2);
        ctx.stroke();

        // 次高光
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(180,200,240,0.2)';
        ctx.beginPath();
        ctx.moveTo(pa.x + nx * wallW * 0.35, pa.y + ny * wallW * 0.35);
        ctx.lineTo(pb.x + nx * wallW * 0.35, pb.y + ny * wallW * 0.35);
        ctx.stroke();

        // ---- 5. 内侧霓虹边缘 ----
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.5);
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(pa.x + nx * wallW * 0.5, pa.y + ny * wallW * 0.5);
        ctx.lineTo(pb.x + nx * wallW * 0.5, pb.y + ny * wallW * 0.5);
        ctx.stroke();

        // 外侧霓虹边缘（较弱）
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.2);
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(pa.x - nx * wallW * 0.5, pa.y - ny * wallW * 0.5);
        ctx.lineTo(pb.x - nx * wallW * 0.5, pb.y - ny * wallW * 0.5);
        ctx.stroke();

        ctx.restore();
    }

    function drawLaunchLane() {
        ctx.save();
        const ltl = proj(LANE_LEFT, 0), ltr = proj(LW, 0);
        const lbl = proj(LANE_LEFT, LH), lbr = proj(LW, LH);
        ctx.beginPath();
        ctx.moveTo(ltl.x, ltl.y); ctx.lineTo(ltr.x, ltr.y);
        ctx.lineTo(lbr.x, lbr.y); ctx.lineTo(lbl.x, lbl.y);
        ctx.closePath(); ctx.clip();

        // 深色金属背景
        const wg = ctx.createLinearGradient(ltl.x, 0, ltr.x, 0);
        wg.addColorStop(0, '#0a0e18'); wg.addColorStop(0.3, '#141828');
        wg.addColorStop(0.7, '#101420'); wg.addColorStop(1, '#0a0e18');
        ctx.fillStyle = wg;
        ctx.fillRect(ltl.x - 5, ltl.y, lbr.x - ltl.x + 10, lbr.y - ltl.y);

        // 拉丝纹理线
        ctx.globalAlpha = 0.04; ctx.strokeStyle = '#4060a0'; ctx.lineWidth = 0.5;
        for (let ly = 0; ly < LH; ly += 12) {
            const pl = proj(LANE_LEFT + 5, ly), pr2 = proj(LW - 5, ly);
            ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(pr2.x, pr2.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // 导轨 — 霓虹
        const railTop = proj(LANE_LEFT, LANE_TOP), railBot = proj(LANE_LEFT, LH);
        ctx.lineWidth = 2;
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.2);
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(railTop.x, railTop.y); ctx.lineTo(railBot.x, railBot.y); ctx.stroke();
        ctx.shadowBlur = 0;

        // 顶部弧
        const arcL = proj(LANE_LEFT, LANE_TOP), arcR = proj(LW, LANE_TOP);
        const arcM = proj(LANE_LEFT + LANE_W / 2, LANE_TOP - LANE_W / 2);
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.15); ctx.lineWidth = 2;
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.moveTo(arcL.x, arcL.y); ctx.quadraticCurveTo(arcM.x, arcM.y, arcR.x, arcR.y); ctx.stroke();
        ctx.shadowBlur = 0;

        // 引导灯
        for (let i = 0; i < 10; i++) {
            const ly = LANE_TOP + 30 + i * 55; if (ly > LH - 50) break;
            const lp = proj(LW - LANE_W / 2, ly);
            const lit = (frame + i * 3) % 20 < 10;
            ctx.fillStyle = lit ? neonGlow(NEON.orange, 0.6) : neonGlow(NEON.orange, 0.1);
            if (lit) { ctx.shadowColor = NEON.orange; ctx.shadowBlur = 5; }
            ctx.beginPath(); ctx.arc(lp.x, lp.y, 2 * scaleAt(ly), 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    function drawDecorLights() {
        ctx.save();
        for (const l of decorLights) {
            const pulse = Math.sin(frame * 0.06 + l.ph);
            const lit = pulse > 0;
            const pp = proj(l.x, l.y);
            ctx.globalAlpha = lit ? 0.35 + pulse * 0.45 : 0.08;
            ctx.fillStyle = l.col;
            if (lit) { ctx.shadowColor = l.col; ctx.shadowBlur = 8; } else { ctx.shadowBlur = 0; }
            ctx.beginPath(); ctx.arc(pp.x, pp.y, 2.5 * scaleAt(l.y), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    function drawRollovers() {
        ctx.save();
        for (const r of rollovers) {
            const pp = proj(r.x, r.y);
            const sz = 5 * scaleAt(r.y);
            // 底座
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.beginPath(); ctx.arc(pp.x, pp.y, sz + 2, 0, Math.PI * 2); ctx.fill();
            // 灯
            const g = ctx.createRadialGradient(pp.x - 1, pp.y - 1, 0, pp.x, pp.y, sz);
            if (r.lit) {
                g.addColorStop(0, '#fff'); g.addColorStop(0.3, r.col); g.addColorStop(1, neonGlow(r.col, 0.3));
                ctx.shadowColor = r.col; ctx.shadowBlur = 12;
            } else {
                g.addColorStop(0, 'rgba(60,60,80,0.3)'); g.addColorStop(1, 'rgba(20,20,30,0.15)');
                ctx.shadowBlur = 0;
            }
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pp.x, pp.y, sz, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    function drawDangerZone() {
        // V形排水口 — 立体金属造型
        const centerX = (96 + 282) / 2;
        const centerY = LH + 5;
        const pc = proj(centerX, centerY);
        const pl = proj(96, LH);
        const pr2 = proj(282, LH);

        ctx.save();

        // V形底部深渊阴影
        const voidG = ctx.createRadialGradient(pc.x, pc.y - 5, 0, pc.x, pc.y, 40);
        voidG.addColorStop(0, 'rgba(0,0,0,0.4)');
        voidG.addColorStop(0.5, 'rgba(0,0,0,0.2)');
        voidG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = voidG;
        ctx.fillRect(pl.x - 5, pl.y - 15, pr2.x - pl.x + 10, 40);

        // V形金属装饰 — 危险标记
        const vTipP = proj(centerX, LH - 15);
        const vLp = proj(centerX - 35, LH + 3);
        const vRp = proj(centerX + 35, LH + 3);

        // V形金属面
        const vG = ctx.createLinearGradient(vTipP.x, vTipP.y, vTipP.x, vLp.y);
        vG.addColorStop(0, '#6878a0');
        vG.addColorStop(0.3, '#8898b8');
        vG.addColorStop(0.5, '#a0aec4');
        vG.addColorStop(0.7, '#6070a0');
        vG.addColorStop(1, '#3a4568');
        ctx.fillStyle = vG;
        ctx.beginPath();
        ctx.moveTo(vTipP.x, vTipP.y);
        ctx.lineTo(vLp.x, vLp.y);
        ctx.lineTo(vRp.x, vRp.y);
        ctx.closePath();
        ctx.fill();

        // V形高光线
        ctx.strokeStyle = 'rgba(200,220,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vTipP.x, vTipP.y + 2);
        ctx.lineTo(vLp.x + 3, vLp.y - 1);
        ctx.stroke();

        // V形霓虹边缘
        ctx.strokeStyle = neonGlow(NEON.pink, 0.4);
        ctx.lineWidth = 1.2;
        ctx.shadowColor = NEON.pink; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(vLp.x, vLp.y);
        ctx.lineTo(vTipP.x, vTipP.y);
        ctx.lineTo(vRp.x, vRp.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 危险指示灯脉冲
        const pulse = 0.15 + Math.sin(frame * 0.08) * 0.1;
        ctx.fillStyle = neonGlow(NEON.pink, pulse);
        ctx.shadowColor = NEON.pink; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(vTipP.x, vTipP.y + 5, 3, 0, Math.PI * 2); ctx.fill();

        ctx.restore();
    }

    // ========== 3D 弹球 — 能量球 ==========
    function drawBall(b) {
        if (!b) return;
        const sc = scaleAt(b.y);
        const pr = projR(b.r, b.y);

        // 尾迹 — 霓虹拖尾
        for (let i = 0; i < b.trail.length; i++) {
            const t = b.trail[i], pp = proj(t.x, t.y);
            const a = (i / b.trail.length);
            const tsc = scaleAt(t.y);
            ctx.save(); ctx.globalAlpha = a * 0.25;
            ctx.fillStyle = NEON.cyan;
            ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 5;
            ctx.beginPath(); ctx.arc(pp.x, pp.y, pr * a * 0.55, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        const pp = proj(b.x, b.y);
        ctx.save();

        // 桌面投影 — 霓虹色
        ctx.fillStyle = neonGlow(NEON.cyan, 0.2);
        ctx.beginPath(); ctx.ellipse(pp.x + 3, pp.y + 6 * sc, pr * 1.2, pr * 0.5, 0, 0, Math.PI * 2); ctx.fill();

        // 球体外辉光
        ctx.fillStyle = neonGlow(NEON.cyan, 0.08);
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(pp.x, pp.y, pr * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // 球体 — 金属+能量核心
        const mg = ctx.createRadialGradient(pp.x - pr * 0.3, pp.y - pr * 0.3, 0, pp.x, pp.y, pr);
        mg.addColorStop(0, '#f0f4ff'); mg.addColorStop(0.1, '#d0d8f0');
        mg.addColorStop(0.3, '#8090b8'); mg.addColorStop(0.55, '#506088');
        mg.addColorStop(0.8, '#304060'); mg.addColorStop(1, '#1a2040');
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(pp.x, pp.y, pr, 0, Math.PI * 2); ctx.fill();

        // 能量环纹
        b.spin += 0.12;
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.15);
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.ellipse(pp.x, pp.y, pr * 0.7, pr * 0.25, b.spin, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(pp.x, pp.y, pr * 0.5, pr * 0.65, -b.spin * 0.7, 0, Math.PI * 2); ctx.stroke();

        // 主高光
        ctx.fillStyle = 'rgba(200,220,255,0.65)';
        ctx.beginPath(); ctx.ellipse(pp.x - pr * 0.22, pp.y - pr * 0.22, pr * 0.33, pr * 0.17, -0.5, 0, Math.PI * 2); ctx.fill();

        // 次高光
        ctx.fillStyle = 'rgba(150,200,255,0.2)';
        ctx.beginPath(); ctx.ellipse(pp.x + pr * 0.22, pp.y + pr * 0.28, pr * 0.1, pr * 0.06, 0.8, 0, Math.PI * 2); ctx.fill();

        // 边缘霓虹环
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.25);
        ctx.lineWidth = 0.8;
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(pp.x, pp.y, pr, 0, Math.PI * 2); ctx.stroke();

        ctx.restore();
    }

    function drawSpring() {
        if (launched || !ball) return;
        const sx = LW - LANE_W / 2, baseY = LH - 15;
        const topY = ball.y + ball.r + 5;
        const segs = 10, segH = (baseY - topY) / segs;
        const sc = scaleAt((baseY + topY) / 2);
        ctx.save();

        // 投影
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 4 * sc; ctx.lineCap = 'round';
        const pBase = proj(sx, baseY);
        ctx.beginPath(); ctx.moveTo(pBase.x + 2, pBase.y + 2);
        for (let i = 1; i <= segs; i++) {
            const xOff = (i % 2 ? 1 : -1) * 6 * sc;
            const pp = proj(sx, baseY - segH * i);
            ctx.lineTo(pp.x + xOff + 2, pp.y + 2);
        }
        ctx.stroke();

        // 主体
        const springCol = springComp > 0 ? NEON.orange : '#606878';
        ctx.strokeStyle = springComp > 0 ? NEON.orange : '#808898';
        ctx.lineWidth = 3 * sc;
        if (springComp > 0) { ctx.shadowColor = NEON.orange; ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.moveTo(pBase.x, pBase.y);
        for (let i = 1; i <= segs; i++) {
            const xOff = (i % 2 ? 1 : -1) * 6 * sc;
            const pp = proj(sx, baseY - segH * i);
            ctx.lineTo(pp.x + xOff, pp.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 蓄力条
        if (springComp > 0) {
            const bL = proj(LW - LANE_W + 5, LH - 6), bR = proj(LW - 5, LH - 6);
            const bw = bR.x - bL.x, bh = 5;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(bL.x - 1, bL.y - 1, bw + 2, bh + 2);
            const pg = ctx.createLinearGradient(bL.x, bL.y, bL.x + bw * springComp, bL.y);
            pg.addColorStop(0, NEON.cyan); pg.addColorStop(0.5, NEON.purple); pg.addColorStop(1, NEON.magenta);
            ctx.fillStyle = pg;
            ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 6;
            ctx.fillRect(bL.x, bL.y, bw * springComp, bh);
        }
        ctx.restore();
    }

    // ========== 后处理 ==========
    function drawInnerFrame() {
        ctx.save();
        const tl = proj(0, 0), tr = proj(LW, 0), bl = proj(0, LH), br = proj(LW, LH);
        const wallH = TABLE_WALL_H * 0.6;

        // 内壁阴影
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x + wallH * 0.3, tl.y + wallH * 0.1);
        ctx.lineTo(bl.x + wallH * 0.3, bl.y - wallH * 0.05); ctx.lineTo(bl.x, bl.y);
        ctx.closePath(); ctx.fill();

        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(tr.x - wallH * 0.2, tr.y + wallH * 0.15);
        ctx.lineTo(tl.x + wallH * 0.2, tl.y + wallH * 0.15);
        ctx.closePath(); ctx.fill();

        // 内边缘霓虹
        ctx.strokeStyle = neonGlow(NEON.cyan, 0.08); ctx.lineWidth = 1;
        ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    function drawVignette() {
        ctx.save();
        const vg = ctx.createRadialGradient(RENDER_W / 2, RENDER_H / 2, RENDER_H * 0.2, RENDER_W / 2, RENDER_H / 2, RENDER_H * 0.6);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, RENDER_W, RENDER_H);
        ctx.restore();
    }

    function applyBloom() {
        // 简化版 bloom — 叠加一层模糊的发光（每3帧更新一次减少性能开销）
        if (frame % 3 === 0) {
            bloomCtx.clearRect(0, 0, RENDER_W, RENDER_H);
            bloomCtx.filter = 'blur(6px) brightness(1.3)';
            bloomCtx.globalAlpha = 0.1;
            bloomCtx.drawImage(canvas, 0, 0);
            bloomCtx.filter = 'none';
        }

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(bloomCanvas, 0, 0);
        ctx.restore();
    }

    // ========== 分数 ==========
    function addScore(pts) {
        score += pts; scoreEl.textContent = score;
        for (const r of rollovers) { if (!r.lit && Math.random() > 0.7) { r.lit = true; break; } }
        if (rollovers.every(r => r.lit)) {
            score += 500; scoreEl.textContent = score;
            rollovers.forEach(r => r.lit = false);
            if (ball) popups.push({ x: ball.x, y: ball.y - 40, txt: 'BONUS +500!', life: 60, big: true });
        }
        if (ball) popups.push({ x: ball.x, y: ball.y - 20, txt: '+' + pts, life: 45 });
    }

    function drawPopups() {
        for (let i = popups.length - 1; i >= 0; i--) {
            const p = popups[i]; p.y -= 1.2; p.life--;
            const pp = proj(p.x, p.y), a = p.life / (p.big ? 60 : 45);
            ctx.save(); ctx.globalAlpha = a;
            const col = p.big ? NEON.yellow : NEON.cyan;
            ctx.fillStyle = col;
            ctx.shadowColor = col; ctx.shadowBlur = p.big ? 15 : 6;
            ctx.font = `bold ${p.big ? 16 : 12}px 'Orbitron', sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(p.txt, pp.x, pp.y);
            ctx.restore();
            if (p.life <= 0) popups.splice(i, 1);
        }
    }

    // ========== 碰撞 ==========
    function wallCollision(b) {
        if (!b) return false;
        if (!launched && !inLane) {
            if (b.x - b.r < LANE_LEFT) b.x = LANE_LEFT + b.r;
            if (b.x + b.r > LW) b.x = LW - b.r;
            return false;
        }
        if (inLane) {
            if (b.x - b.r < LANE_LEFT) { b.x = LANE_LEFT + b.r; b.vx = Math.abs(b.vx) * 0.5; }
            if (b.x + b.r > LW) { b.x = LW - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
            if (b.y - b.r < LANE_TOP) { inLane = false; b.vx = -3 - Math.random() * 2; b.vy = -Math.abs(b.vy) * 0.5; }
            return b.y > LH + 40;
        }
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.8; }
        if (b.x + b.r > LANE_LEFT) { b.x = LANE_LEFT - b.r; b.vx = -Math.abs(b.vx) * 0.8; }
        if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.8; }
        return b.y > LH + 40;
    }
    function lineColl(b, x1, y1, x2, y2) {
        if (!b) return;
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; if (!l2) return;
        let t = ((b.x - x1) * dx + (b.y - y1) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + t * dx, cy = y1 + t * dy;
        const ex = b.x - cx, ey = b.y - cy;
        const d = Math.sqrt(ex * ex + ey * ey), m = b.r + 3;
        if (d < m && d > 0) {
            const nx = ex / d, ny = ey / d;
            b.x = cx + nx * (m + 1); b.y = cy + ny * (m + 1);
            const dot = b.vx * nx + b.vy * ny;
            b.vx = (b.vx - 2 * dot * nx) * 0.8; b.vy = (b.vy - 2 * dot * ny) * 0.8;
        }
    }
    function gutterColl(b) {
        if (!b) return;
        // 斜坡导轨
        lineColl(b, 0, LH - 120, 70, LH - 55);
        lineColl(b, LANE_LEFT, LH - 120, 308, LH - 55);
        // 底部横线
        lineColl(b, 0, LH, 96, LH);
        lineColl(b, LANE_LEFT, LH, 282, LH);
        // 翻板区域垂直侧壁（防止球从侧面漏出）
        lineColl(b, 0, LH - 55, 0, LH);
        lineColl(b, LANE_LEFT, LH - 55, LANE_LEFT, LH);
    }

    // ========== 主循环 ==========
    const PHYSICS_SUBSTEPS = 3;
    const MAX_SPEED = 14;
    function update() {
        if (!running) return;
        frame++; time = performance.now();
        flippers[0].on = !!(keys['ArrowLeft'] || keys['a'] || keys['A']);
        flippers[1].on = !!(keys['ArrowRight'] || keys['d'] || keys['D']);
        if (!launched && ball && keys[' ']) {
            springComp = Math.min(springComp + 0.02, 1);
            ball.y = LH - 160 + springComp * 50;
        }
        for (const f of flippers) f.update();
        for (const b of bumpers) b.update();
        for (const s of slings) s.update();
        if (ball) {
            if (launched) ball.vy += GRAVITY;
            else {
                if (ball.x - ball.r < LANE_LEFT) ball.x = LANE_LEFT + ball.r;
                if (ball.x + ball.r > LW) ball.x = LW - ball.r;
            }
            // 速度限制
            const sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            if (sp > MAX_SPEED) { ball.vx = ball.vx / sp * MAX_SPEED; ball.vy = ball.vy / sp * MAX_SPEED; }
            // 物理子步：将位移拆分为多个小步，每步都做碰撞检测
            const steps = PHYSICS_SUBSTEPS;
            const svx = ball.vx / steps, svy = ball.vy / steps;
            for (let step = 0; step < steps; step++) {
                ball.x += svx; ball.y += svy;
                if (wallCollision(ball)) { ballLost(); return; }
                if (launched && !inLane) {
                    gutterColl(ball);
                    // 多次迭代碰撞解决，防止一次推离后仍在另一个碰撞体内
                    for (let iter = 0; iter < 2; iter++) {
                        for (const f of flippers) f.collide(ball);
                    }
                    for (const b of bumpers) b.collide(ball);
                    for (const s of slings) s.collide(ball);
                }
            }
            if (launched) { ball.trail.push({ x: ball.x, y: ball.y }); if (ball.trail.length > 16) ball.trail.shift(); }
        }
        tickParticles();
    }

    function draw() {
        ctx.fillStyle = '#020408'; ctx.fillRect(0, 0, RENDER_W, RENDER_H);
        if (bgBuf) ctx.drawImage(bgBuf, 0, 0);

        // 动态层
        drawVortex();
        drawDecorLights();
        drawRollovers();
        drawDynamicRailFlow();
        drawLaunchLane();
        drawTableWalls();
        drawDangerZone();
        for (const s of slings) s.draw();
        for (const b of bumpers) b.draw();
        for (const f of flippers) f.draw();
        drawSpring();
        if (ball) drawBall(ball);
        drawParticles();
        drawPopups();
        drawInnerFrame();
        drawVignette();

        // Bloom 后处理
        applyBloom();

        // 发射提示
        if (running && ball && !launched) {
            const pp = proj(LW - LANE_W / 2, LH - 185);
            ctx.save();
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 300) * 0.3;
            ctx.fillStyle = NEON.cyan;
            ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 8;
            ctx.font = `bold ${Math.round(9 * scaleAt(LH - 185))}px 'Rajdhani', sans-serif`;
            ctx.textAlign = 'center';
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            ctx.fillText(isMobile ? '长按▲' : '按住空格', pp.x, pp.y);
            ctx.fillText('蓄力发射', pp.x, pp.y + 14);
            ctx.restore();
        }
    }

    function loop() {
        try { update(); draw(); } catch (e) { console.error('[Neon Cosmos]', e); }
        requestAnimationFrame(loop);
    }

    // ========== 游戏流程 ==========
    function startGame() {
        score = 0; ballsLeft = 3; scoreEl.textContent = '0'; ballsEl.textContent = '3';
        particles = []; popups = []; arcs = [];
        initLevel(); newBall();
        running = true; overlay.classList.add('hidden'); canvas.focus();
    }
    function newBall() {
        ball = mkBall(); launched = false; inLane = false; springComp = 0;
    }
    function ballLost() {
        ballsLeft--; ballsEl.textContent = ballsLeft;
        emitParticles(LW / 2, LH, NEON.pink, 22);
        if (ballsLeft <= 0) gameOver();
        else { ball = null; setTimeout(() => { if (running) newBall(); }, 800); }
    }
    function gameOver() {
        running = false; ball = null;
        if (score > highScore) { highScore = score; try { localStorage.setItem('pb3dHigh', '' + highScore); } catch (e) { } highscoreEl.textContent = highScore; }
        overlayTitle.textContent = 'GAME OVER';
        overlayScore.style.display = 'block'; overlayScore.textContent = 'FINAL SCORE: ' + score;
        startBtn.textContent = '▶ RELAUNCH';
        overlay.classList.remove('hidden');
    }

    // ========== 事件 ==========
    document.addEventListener('keydown', e => {
        keys[e.key] = true;
        if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    });
    document.addEventListener('keyup', e => {
        keys[e.key] = false;
        if (e.key === ' ' && !launched && ball && running) {
            ball.vy = LAUNCH_SPD * (0.4 + springComp * 0.6); ball.vx = 0;
            launched = true; inLane = true; springComp = 0;
            emitParticles(ball.x, ball.y + 10, NEON.cyan, 14);
        }
    });
    startBtn.addEventListener('click', e => { e.preventDefault(); startGame(); });
    window._startGame = startGame;
    canvas.setAttribute('tabindex', '0');

    // ========== 触屏控制 ==========
    const touchLeft = document.getElementById('touch-left');
    const touchRight = document.getElementById('touch-right');
    const touchLaunch = document.getElementById('touch-launch');

    // 给发射按钮添加蓄力进度条
    if (touchLaunch) {
        const barWrap = document.createElement('div');
        barWrap.className = 'launch-bar';
        const barFill = document.createElement('div');
        barFill.className = 'launch-bar-fill';
        barWrap.appendChild(barFill);
        touchLaunch.appendChild(barWrap);
    }

    function touchBind(el, keyName) {
        if (!el) return;
        el.addEventListener('touchstart', e => {
            e.preventDefault();
            keys[keyName] = true;
            el.classList.add('active');
        }, { passive: false });
        el.addEventListener('touchend', e => {
            e.preventDefault();
            keys[keyName] = false;
            el.classList.remove('active');
            // 发射逻辑（仅空格键）
            if (keyName === ' ' && !launched && ball && running) {
                ball.vy = LAUNCH_SPD * (0.4 + springComp * 0.6); ball.vx = 0;
                launched = true; inLane = true; springComp = 0;
                emitParticles(ball.x, ball.y + 10, NEON.cyan, 14);
                // 重置进度条
                const fill = touchLaunch && touchLaunch.querySelector('.launch-bar-fill');
                if (fill) fill.style.width = '0%';
            }
        }, { passive: false });
        el.addEventListener('touchcancel', e => {
            keys[keyName] = false;
            el.classList.remove('active');
        });
        // 鼠标兼容（平板可能用鼠标）
        el.addEventListener('mousedown', e => {
            e.preventDefault();
            keys[keyName] = true;
            el.classList.add('active');
        });
        el.addEventListener('mouseup', e => {
            keys[keyName] = false;
            el.classList.remove('active');
            if (keyName === ' ' && !launched && ball && running) {
                ball.vy = LAUNCH_SPD * (0.4 + springComp * 0.6); ball.vx = 0;
                launched = true; inLane = true; springComp = 0;
                emitParticles(ball.x, ball.y + 10, NEON.cyan, 14);
                const fill = touchLaunch && touchLaunch.querySelector('.launch-bar-fill');
                if (fill) fill.style.width = '0%';
            }
        });
        el.addEventListener('mouseleave', e => {
            keys[keyName] = false;
            el.classList.remove('active');
        });
    }
    touchBind(touchLeft, 'ArrowLeft');
    touchBind(touchRight, 'ArrowRight');
    touchBind(touchLaunch, ' ');

    // 蓄力进度条实时更新
    function updateLaunchBar() {
        const fill = touchLaunch && touchLaunch.querySelector('.launch-bar-fill');
        if (fill) fill.style.width = (springComp * 100) + '%';
        requestAnimationFrame(updateLaunchBar);
    }
    updateLaunchBar();

    // 防止触屏时页面滚动/缩放
    document.addEventListener('touchmove', e => {
        if (running) e.preventDefault();
    }, { passive: false });

    // 画布自适应：根据可用视口高度动态计算canvas尺寸，确保触控按钮不被遮挡
    function resizeCanvas() {
        const vw = window.innerWidth;
        // 使用 visualViewport 获取实际可视高度（排除浏览器UI），回退到 innerHeight
        const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
        
        if (vw < 520) {
            // 移动端：计算HUD和触控按钮占用的高度
            const hud = document.getElementById('hud');
            const touchCtrl = document.getElementById('touch-controls');
            const hudH = hud ? hud.offsetHeight : 44;
            const touchH = touchCtrl ? touchCtrl.offsetHeight : 92;
            
            // canvas可用高度 = 视口高度 - HUD高度 - 触控按钮高度
            const availH = vh - hudH - touchH;
            
            // 按宽度等比缩放的canvas高度
            const scaleByWidth = vw / RENDER_W;
            const canvasHByWidth = RENDER_H * scaleByWidth;
            
            // 取较小值，确保不超出可用区域
            const finalH = Math.min(canvasHByWidth, availH);
            const finalW = finalH * (RENDER_W / RENDER_H);
            
            canvas.style.width = finalW + 'px';
            canvas.style.height = finalH + 'px';
        } else {
            canvas.style.width = '';
            canvas.style.height = '';
        }
    }
    window.addEventListener('resize', resizeCanvas);
    // 监听 visualViewport 变化（浏览器地址栏收起/展开时触发）
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', resizeCanvas);
    }
    resizeCanvas();

    // ========== 初始化 ==========
    initLevel(); preRender();
    overlay.classList.remove('hidden'); overlay.style.display = 'flex';
    loop();
})();
