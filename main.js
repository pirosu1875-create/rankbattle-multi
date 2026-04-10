/**
 * Rank Battle AR - 3vs3 Team Battle
 */
/**
 * Rank Battle AR - 3vs3 Team Battle
 */

// --- [修正] コピー機能をグローバルに定義（最優先で実行） ---
window.copyToClipboard = (text) => {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.left = "-9999px";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(t);

    if (ok) {
        // アラートの代わりに「COPIED!」という文字を一瞬出す
        const el = document.getElementById('copy-target');
        if (el) {
            const old = el.innerHTML;
            el.style.background = "rgba(56, 189, 248, 0.4)";
            el.innerHTML = "<strong style='color:#fff; line-height:2.5;'>COPIED!</strong>";
            setTimeout(() => {
                el.style.background = "rgba(56, 189, 248, 0.1)";
                el.innerHTML = old;
            }, 800);
        }
    }
};

// main.js の冒頭（window.onload の前）に置く
const showPasscodeScreen = (roomId) => {
    console.log("【表示】画面を合言葉表示に切り替えます:", roomId);
    const screen = document.getElementById('network-screen');
    if (!screen) return;
    screen.innerHTML = `
        <div class="setup-content glass-box" style="text-align:center; padding:40px;">
            <h1 class="title" style="font-size:1.2rem; margin-bottom:20px;">ROOM CREATED</h1>
            <p style="font-size:0.8rem; opacity:0.6; margin-bottom:10px;">合言葉を相手に伝えてください</p>
            <div id="copy-target" onclick="window.copyToClipboard('${roomId}')"
                 style="cursor:pointer; background:rgba(56, 189, 248, 0.1); border:1px dashed #38bdf8; padding:20px; border-radius:12px; margin: 20px 0;">
                <strong style="font-size:2rem; color:#38bdf8; letter-spacing:4px; display:block;">${roomId}</strong>
                <span style="font-size:0.7rem; opacity:0.5; margin-top:5px; display:block;">(タップでコピー)</span>
            </div>
            <div class="loading-spinner" style="margin: 20px auto; width:30px; height:30px; border:3px solid rgba(255,255,255,0.1); border-top-color:#38bdf8; border-radius:50%; animation:spin 1s linear infinite;"></div>
            <p style="font-size:0.8rem; opacity:0.8;">相手の参加を待っています...</p>
        </div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
};
window.onload = () => {

    const network = new NetworkManager();
    window.network = network; // グローバルに公開
    let gameInstance = null;  // ゲームインスタンスを外で保持
    let pendingStartPos = null;
    // ★【修正1】接続する前に「受信ルール」を先に決めておく
    // --- main.js 冒頭の受信処理を修正 ---
    network.onDataReceived = (received) => {
        const data = received;
        const payload = data.payload;

        if (!gameInstance) return;

        // 受信処理の中に追加
        if (data.type === 'apply-damage') {
            gameInstance.player.hp -= payload.damage; // 相手から届いたダメージを自分のHPに適用
            if (gameInstance.player.hp <= 0 && !gameInstance.player.isDead && !gameInstance.player.isBailingOut) {
                gameInstance.player.startBailOut(); // 0以下になったら自分をベイルアウトさせる
            }
        }

        // --- 1. マップ同期 ---
        if (data.type === 'init-map') {
            gameInstance.map.data = payload.mapData;
        }

        // --- 2. キャラクター選択 ---
        if (data.type === 'select-class') {
            gameInstance.rivalReady = true;
            if (!gameInstance.rivalPlayer) {
                gameInstance.rivalPlayer = new Player(0, 0);
            }
            gameInstance.rivalPlayer.setClass(payload.className);
            gameInstance.rivalPlayer.team = network.isHost ? 'red' : 'blue';

            // ホストの場合のみ、自分が準備完了ならカウントダウン開始＆ゲストに合図
            if (network.isHost && gameInstance.playerReady) {
                console.log("【ホスト】相手の準備完了を受信。カウントダウンを開始します。");
                network.sendData('trigger-countdown', {});
                gameInstance.startCountdown();
            }
        }

        // ↓↓↓ 新規追加：ゲストがホストからカウントダウン開始の合図を受け取る処理 ↓↓↓
        if (data.type === 'trigger-countdown') {
            console.log("【ゲスト】ホストから開始合図を受信しました！");
            gameInstance.startCountdown();
        }

        // --- 3. 開始位置の同期（select-class の「外」に出しました） ---
        if (data.type === 'start-positions') {
            console.log("【受信】開始位置を同期しました");

            if (payload.mapData) {
                gameInstance.map.data = payload.mapData;
            }
            // 1. まず相手のキャラを確定させる
            if (!gameInstance.rivalPlayer) gameInstance.rivalPlayer = new Player(0, 0);
            gameInstance.rivalPlayer.setClass(payload.myClass); // ホストのクラス
            gameInstance.rivalPlayer.team = 'blue'; // ホストは常にBlue

            // 2. 自分のキャラも念のため再確定させる
            // gameInstance.player.setClass(payload.rivalClass); // 自分のクラス
            gameInstance.player.team = 'red'; // 自分（ゲスト）は常にRed

            // 位置の適用
            applyStartPositions(payload);

            // スマホ側の「目隠し」を剥がす
            const selectionScreen = document.getElementById('selection-screen');
            if (selectionScreen) selectionScreen.classList.add('hidden');
            const countdownScreen = document.getElementById('countdown-screen');
            if (countdownScreen) countdownScreen.classList.add('hidden');
            const uiLayer = document.getElementById('ui-layer');
            if (uiLayer) uiLayer.classList.remove('hidden');

            gameInstance.state = 'playing';
        }

        // --- 4. 相手の位置更新 ---
        if (data.type === 'player-update' && gameInstance.rivalPlayer) {
            const p = gameInstance.rivalPlayer;
            if (payload.className) {
                const upperName = payload.className.toUpperCase();
                if (!p.config || p.config.name.toUpperCase() !== upperName) {
                    p.setClass(upperName);
                }
            }
            p.x = payload.x;
            p.y = payload.y;
            p.angle = payload.angle;
            p.isAttacking = payload.isAttacking;
            p.isShieldingInput = payload.isShielding;
            p.isShielding = payload.isShielding;
            p.isBagworm = payload.isBagworm;
        }

        // --- 5. 弾の同期 ---
        // --- 弾の同期（スキル対応版） ---
        if (data.type === 'bullet-shot') {
            const rival = gameInstance.rivalPlayer;
            if (!rival) return;

            // 相手のクラスと選択スキルを強制同期
            rival.setClass(payload.className);
            rival.selectedSkill = payload.selectedSkill;

            // 相手の位置と角度を正確に同期
            rival.x = payload.x;
            rival.y = payload.y;
            rival.angle = payload.angle;

            // ★相手のスキル発動状態（光っているか等）を一時的に同期
            const originalSkill = rival.isSkillPrimed;
            rival.isSkillPrimed = payload.isSkillPrimed;

            // 相手自身に撃たせる（ここで特殊弾や旋空エフェクトが生成される）
            const bullets = rival.shootWithAngle(payload.angle, true);
            if (bullets) {
                gameInstance.bullets.push(...bullets);
            }

            // 撃ち終わったらスキル状態を元に戻す
            rival.isSkillPrimed = originalSkill;
        }
    };

    // ヘルパー関数（位置を適用する処理を共通化）
    function applyStartPositions(posData) {
        if (!gameInstance) return;
        // ホストの自分(myPos)は、ゲストにとっての相手(rivalPlayer)
        if (gameInstance.rivalPlayer) {
            gameInstance.rivalPlayer.x = posData.myPos.x;
            gameInstance.rivalPlayer.y = posData.myPos.y;
        }
        // ホストの相手(rivalPos)は、ゲストにとっての自分(player)
        if (posData.rivalPos) {
            gameInstance.player.x = posData.rivalPos.x;
            gameInstance.player.y = posData.rivalPos.y;
        }
    }

    // 【ホスト・参加ボタンの設定】（ここは元のままでOK）
    // 【ホストボタンの設定】
    // 【ホストボタンの決定版：差し替えここから】

    // 【ホストボタンの設定】
    // ▼▼▼ ここから差し替え ▼▼▼
    // 【ホストボタンの設定】
    const btnHost = document.getElementById('btn-host');
    if (btnHost) {
        btnHost.addEventListener('click', () => {
            console.log("【1】ホストボタンがクリックされました");

            // エラー防止：確実にグローバルの network を参照する
            if (!window.network) {
                console.error("network が初期化されていません！");
                return;
            }

            // --- A. 部屋作成成功時の処理を定義 ---
            window.network.onRoomCreated = (id) => {
                console.log("【3】部屋が作成されました。ID:", id);
                if (typeof showPasscodeScreen === 'function') {
                    showPasscodeScreen(id);
                } else {
                    console.error("showPasscodeScreen 関数が見つかりません！");
                }
            };

            // --- B. 部屋作成を実行 ---
            window.network.hostRoom();
            console.log("【2】hostRoom()を実行しました");

            // --- C. 【念押し】すでにIDがある場合 ---
            if (window.network.peer && window.network.peer.id) {
                console.log("【補足】すでにIDが存在します");
                showPasscodeScreen(window.network.peer.id);
            }
        });
    }

    // 【参加ボタンの設定】
    const btnJoin = document.getElementById('btn-join');
    if (btnJoin) {
        btnJoin.addEventListener('click', () => {
            const roomId = document.getElementById('join-room-id').value.trim();
            // ここも window.network を確実に使用する
            if (roomId && window.network) {
                window.network.joinRoom(roomId);
            }
        });
    }
    // ▲▲▲ ここまで差し替え ▲▲▲

    // ★【修正2】接続確立時は、画面の切り替えとインスタンス作成だけに専念する
    network.onConnectionEstablished = () => {
        if (window.game) return;
        console.log("通信確立！");
        document.getElementById('network-screen').classList.add('hidden');
        document.getElementById('selection-screen').classList.remove('hidden');

        gameInstance = new Game();
        window.game = gameInstance;

        // 修正版
        if (network.isHost) {
            // 第一引数にタイプ、第二引数に中身を渡す
            network.sendData('init-map', {
                mapData: gameInstance.map.data
            });
        }
    };
};



const TILE_SIZE = 32;
const MAP_WIDTH = 50;
const MAP_HEIGHT = 50;

const TRG_CLASSES = {
    GUNNER: {
        name: 'Gunner', color: '#38bdf8', speed: 105, maxAmmo: 10,
        reloadSpeed: 0.4, shootDelay: 0.15, bulletSpeed: 500,
        damage: 10, range: 300, burst: 3, aimType: 'line', assetBase: 'inukai',
        shieldWidth: 1.2, maxSP: 100, shieldDeploySpeed: 0
    },
    SHOOTER: {
        name: 'Shooter', color: '#16a34a', speed: 110, maxAmmo: 12,
        reloadSpeed: 0.3, shootDelay: 0.20, bulletSpeed: 450,
        damage: 5, range: 250, burst: 4, aimType: 'broad_line', assetBase: 'osamu',
        shieldWidth: 1.2, maxSP: 100, shieldDeploySpeed: 0
    },
    SCORPION: {
        name: 'Scorpion', color: '#f43f5e', speed: 150, maxAmmo: 3,
        reloadSpeed: 1.0, shootDelay: 0.35, bulletSpeed: 450,
        damage: 30, range: 110, burst: 1, aimType: 'arc', pierce: false, assetBase: 'kuga',
        shieldWidth: 0.7, maxSP: 150, shieldDeploySpeed: 0, shieldSpeedMult: 0.9
    },
    KOGETSU: {
        name: 'Kogetsu', color: '#e2e8f0', speed: 135, maxAmmo: 2,
        reloadSpeed: 1.2, shootDelay: 0.5, bulletSpeed: 650,
        damage: 45, range: 130, burst: 1, aimType: 'arc', pierce: false, assetBase: 'tachikawa',
        shieldWidth: 0.9, maxSP: 150, shieldDeploySpeed: 0, shieldSpeedMult: 0.85
    },
    SNIPER: {
        name: 'Sniper', color: '#fbbf24', speed: 85, maxAmmo: 2,
        reloadSpeed: 2.5, shootDelay: 1.00, bulletSpeed: 900,
        damage: 60, range: 800, burst: 1, aimType: 'line_thin', assetBase: 'chika',
        shieldWidth: 1.0, maxSP: 60, shieldDeploySpeed: 0
    }
};

class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');


        this.map = new GameMap(MAP_WIDTH, MAP_HEIGHT);
        this.player = new Player(0, 0);
        this.player.isControlPlayer = true;
        this.player.setClass('GUNNER');

        // this.bots = [];
        this.bullets = [];
        this.effects = [];
        this.camera = { x: 0, y: 0 };
        this.keys = {};
        this.mousePos = { x: 0, y: 0 };
        this.isMouseDown = false;
        this.isShieldingInput = false;
        this.isBagwormInput = false;
        this.zoom = 1.0;
        this.targetZoom = 1.0;
        this.scores = { blue: 0, red: 0 };
        this.state = 'selecting';
        this.gameTime = 180;
        this.lastTime = 0;
        this.state = 'selecting';
        this.playerReady = false; // 自分が選んだか
        this.rivalReady = false;  // 相手が選んだか
        this.leftStick = new VirtualJoystick('left');
        this.rightStick = new VirtualJoystick('right');
        this.leftStick.baseEl.style.display = 'none';
        this.rightStick.baseEl.style.display = 'none';

        window.game = this;

        this.getAdjustedCanvasPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
        };

        this.init();
    }

    async init() {
        this.resize();
        this.initEventListeners();

        try {
            await this.loadAssets();
        } catch (e) {
            console.warn("Assets failed to load, continuing with boxes:", e);
        }

        setTimeout(() => {
            this.setupSelection();
        }, 500);

        requestAnimationFrame((t) => {
            this.lastTime = t;
            this.gameLoop(t);
        });
    }

    async loadAssets() {
        const load = (src) => new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => {
                console.error("Failed to load asset:", src);
                res(null);
            };
            i.src = src;
        });

        window.gameAssets = {
            kuga1: await load('./kuga1.png'),
            kuga2: await load('./kuga2.png'),
            tachikawa1: await load('./tachikawa1.png'),
            tachikawa2: await load('./tachikawa2.png'),
            osamu1: await load('./osamu1.png'),
            osamu2: await load('./osamu2.png'),
            inukai1: await load('./inukai1.png'),
            inukai2: await load('./inukai2.png'),
            chika1: await load('./chika1.png'),
            chika2: await load('./chika2.png')
        };
    }

    resize() {
        const container = document.getElementById('game-container');
        if (container) {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
        }
    }

    setupSelection() {
        const classStep = document.getElementById('class-selection-step');
        const skillStep = document.getElementById('skill-selection-step');
        const skillOptions = document.getElementById('skill-options');
        const classNameDisplay = document.getElementById('selected-class-name');
        const backBtn = document.getElementById('back-to-class');
        const classBtns = document.querySelectorAll('#class-selection-step .select-btn');

        const SKILL_DATA = {
            SCORPION: [
                { id: 'GRASSHOPPER', name: 'グラスホッパー', desc: '向いている方向へ瞬間加速' },
                { id: 'MANTIS', name: 'マンティス', desc: '斬撃の射程と軌道を変化させる' }
            ],
            KOGETSU: [
                { id: 'SENKU', name: '旋空', desc: '一時的に射程を大幅に拡大' }
            ],
            SHOOTER: [
                { id: 'HOUND', name: 'ハウンド', desc: 'ターゲットを自動追尾する弾' },
                { id: 'METEORA', name: 'メテオラ', desc: '着弾時に爆発し周囲を巻き込む' }
            ],
            GUNNER: [
                { id: 'HOUND', name: 'ハウンド', desc: '誘導性能を持つ射撃' },
                { id: 'LEAD_BULLET', name: '鉛弾', desc: '当たった敵に重しを付与して減速' }
            ],
            SNIPER: [
                { id: 'LEAD_BULLET', name: '鉛弾', desc: 'シールドを無視して重しを付与' }
            ]
        };

        let tempClass = null;
        let isSelected = false;

        classBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tempClass = btn.dataset.class;
                if (!tempClass) return;

                classStep.classList.add('hidden');
                skillStep.classList.remove('hidden');
                classNameDisplay.innerText = tempClass;

                skillOptions.innerHTML = '';
                SKILL_DATA[tempClass].forEach(skill => {
                    const sBtn = document.createElement('button');
                    sBtn.className = 'select-btn';
                    sBtn.style.justifyContent = 'center';
                    sBtn.innerHTML = `
                        <div class="btn-info" style="text-align: center;">
                            <span class="btn-name" style="display: block;">${skill.name}</span>
                            <span class="btn-desc" style="font-size: 0.7rem; opacity: 0.8;">${skill.desc}</span>
                        </div>
                    `;

                    // ★ スキル決定ボタンのクリックイベント
                    sBtn.addEventListener('click', () => {
                        console.log("【ログ】スキル決定ボタンが押されました:", skill.name);
                        if (isSelected) return;
                        isSelected = true;

                        this.player.setClass(tempClass);
                        this.player.selectedSkill = skill.id;
                        this.playerReady = true;

                        if (window.network) {
                            console.log("【ログ】相手にデータを送信します:", tempClass);
                            window.network.sendData('select-class', {
                                className: tempClass
                            });
                        }

                        // 表示を「待機中」に完全に切り替え（重なり防止）
                        skillStep.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:200px;">
            <h2 class="title" style="color:#38bdf8;">READY!</h2>
            <p id="waiting-msg" style="font-size:0.8rem; opacity:0.6;">相手の準備を待っています...</p>
        </div>
    `;
                        // 自分が「後出し」だった場合、この瞬間に rivalReady は true になっているはずなので開始
                        // 自分が「先出し」だった場合、ここでは何もしない（後から来る network.onDataReceived が開始してくれる）
                        if (window.network.isHost && this.rivalReady) {
                            console.log("【ホスト】両者準備完了。カウントダウンを開始します。");
                            window.network.sendData('trigger-countdown', {});
                            this.startCountdown();
                        } else {
                            console.log("ホストの開始合図、または相手の準備を待機します...");
                        }

                    });

                    skillOptions.appendChild(sBtn);
                });
            });
        });

        if (backBtn) {
            backBtn.addEventListener('click', () => {
                skillStep.classList.add('hidden');
                classStep.classList.remove('hidden');
                tempClass = null;
            });
        }
    }

    // --- カウントダウン専用メソッド ---
    startCountdown() {
        if (this.isCountdownStarted) return;
        this.isCountdownStarted = true;
        console.log("【ログ】startCountdown が呼び出されました");

        // 1. キャラ選択画面（フタ）を隠す
        const selectionScreen = document.getElementById('selection-screen');
        if (selectionScreen) {
            selectionScreen.classList.add('hidden');
            selectionScreen.style.display = 'none';
        }

        const countdownScreen = document.getElementById('countdown-screen');
        const countdownNumber = document.getElementById('countdown-number');
        const uiLayer = document.getElementById('ui-layer');

        // カウントダウンUIがない場合のフォールバック
        if (!countdownScreen || !countdownNumber) {
            console.log("【ログ】カウントダウンUIが見つからないため即開始します");
            if (uiLayer) uiLayer.classList.remove('hidden');
            this.startGame();
            return;
        }

        // 2. カウントダウン開始
        countdownScreen.classList.remove('hidden');
        countdownScreen.style.display = 'flex';
        let count = 3;
        countdownNumber.innerText = count;

        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                countdownNumber.innerText = count;
            } else {
                clearInterval(timer);
                countdownScreen.classList.add('hidden');
                countdownScreen.style.display = 'none';
                if (uiLayer) uiLayer.classList.remove('hidden');

                console.log("【ログ】試合開始！");
                this.startGame();
            }
        }, 1000);
    }

    // --- 追加：試合を実際に開始するメソッド ---
    startGame() {
        console.log("【システム】startGame実行");

        // ★重要：スマホ（ゲスト）側は、位置が届くまでは 'playing' にしない方が安全
        if (window.network.isHost) {
            this.state = 'playing';

            // 1. ホストが自分と相手の場所を決める
            this.spawnEntity(this.player, this.player.team);
            if (this.rivalPlayer) {
                this.spawnEntity(this.rivalPlayer, this.rivalPlayer.team);
            }

            window.network.sendData('start-positions', {
                mapData: this.map.data, // ★マップデータを送信
                myPos: { x: this.player.x, y: this.player.y },
                myClass: this.player.config.name.toUpperCase(), // 大文字で送信
                rivalPos: this.rivalPlayer ? { x: this.rivalPlayer.x, y: this.rivalPlayer.y } : null,
                rivalClass: this.rivalPlayer ? this.rivalPlayer.config.name.toUpperCase() : 'GUNNER'
            });

            // ★相手（rivalPlayer）がまだ作られていなければ、この瞬間に無理やり作る
            if (!this.rivalPlayer) {
                console.log("【警告】相手のクラスが未受信ですが、仮で作成します");
                this.rivalPlayer = new Player(0, 0);
                this.rivalPlayer.setClass('GUNNER'); // 仮
                this.rivalPlayer.team = 'red';
            }

        }

        // 3. UI表示は「ホストもゲストも両方」行う（isHostの外に出す）
        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer) uiLayer.classList.remove('hidden');

        // 4. 自分の最新位置を送信
        // Game.update(dt) 内の送信部分
        if (window.network) {
            // 第一引数に 'タイプ'、第二引数に '中身のオブジェクト' を渡す
            window.network.sendData('player-update', {
                x: this.player.x,
                y: this.player.y,
                angle: this.player.angle,
                className: this.player.config.name.toUpperCase(), // ★追加：毎フレーム自分のクラスを送る
                isAttacking: this.player.isAttacking,
                isShielding: this.player.isShielding,
                isBagworm: this.player.isBagworm
            });
        }
    }

    spawnEntity(ent, team) {
        let finalX = 0, finalY = 0;
        let bestX = 0, bestY = 0;
        let maxMinDist = -1; // 「最も敵から離れている距離」を記録する用

        // まだ座標が決定していない（xとyが0）キャラは除外して、配置済みの全キャラを取得
        // const allUnits = [this.player, this.rivalPlayer, ...this.bots]
        const allUnits = [this.player, this.rivalPlayer]
            .filter(u => u && u !== ent && (u.x !== 0 || u.y !== 0) && !u.isDead);
        // .filter(u => u && u !== ent && (u.x !== 0 || u.y !== 0) && !u.isDead);

        for (let i = 0; i < 100; i++) {
            // 壁から少し離れたランダムな座標を生成
            const rx = 100 + Math.random() * (MAP_WIDTH * TILE_SIZE - 200);
            const ry = 100 + Math.random() * (MAP_HEIGHT * TILE_SIZE - 200);

            // 壁じゃない場所かチェック
            if (this.map.getTile(rx, ry) === 0) {
                let minDistToEnemy = Infinity;

                // 配置済みの他のキャラクターとの距離を計算
                for (const other of allUnits) {
                    if (other.team !== team) { // 敵チームの場合のみ距離を気にする
                        const dist = Math.sqrt((other.x - rx) ** 2 + (other.y - ry) ** 2);
                        if (dist < minDistToEnemy) {
                            minDistToEnemy = dist;
                        }
                    }
                }

                // 敵がまだ誰もいない場合は、即座にそこに決定
                if (minDistToEnemy === Infinity) {
                    finalX = rx; finalY = ry;
                    break;
                }

                // ★ ここで安全な距離を指定！ (例: 500ピクセル以上離れていればOK)
                if (minDistToEnemy > 500) {
                    finalX = rx; finalY = ry;
                    break;
                }

                // もし 500px 以上離れていなくても、一番マシ（敵から遠い）場所を記録しておく
                if (minDistToEnemy > maxMinDist) {
                    maxMinDist = minDistToEnemy;
                    bestX = rx;
                    bestY = ry;
                }
            }
        }

        // 100回探しても完璧な場所が見つからなかった場合は、一番マシだった場所を選ぶ
        if (finalX === 0 && finalY === 0) {
            if (bestX !== 0 || bestY !== 0) {
                finalX = bestX; finalY = finalY = bestY;
            } else {
                // 最悪のフェイルセーフ（通常は起こりません）
                finalX = (MAP_WIDTH * TILE_SIZE) / 2;
                finalY = (MAP_HEIGHT * TILE_SIZE) / 2;
            }
        }

        // 決定した座標をセット
        ent.x = finalX;
        ent.y = finalY;
        ent.team = team;
        ent.hp = ent.maxHp;
        ent.isDead = false;
        ent.isBailingOut = false;

        // 転送エフェクト（光の柱）
        if (this.spawnTransferEffect) this.spawnTransferEffect(finalX, finalY);
    }

    spawnTransferEffect(x, y, life = 1.0) {
        this.effects.push({ type: 'pillar', x, y, life });
    }

    spawnBagwormEffect(x, y, type) {
        if (type === 'activate') {
            for (let i = 0; i < 15; i++) {
                this.effects.push({
                    type: 'trion_cube',
                    x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40,
                    vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100,
                    life: 0.5, size: 4 + Math.random() * 4
                });
            }
        }
    }

    initEventListeners() {
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('keydown', (e) => {
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.player.toggleBagworm(!this.player.isBagworm);
            // ★ スペースキー（または任意のキー）でスキル発動
            if (e.code === 'Space') this.player.activateSkill();
            this.keys[e.code] = true;
        });
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') {
                if (e.button === 0) this.isMouseDown = true;
                if (e.button === 2) this.isShieldingInput = true;
            }
            this.handlePointerDown(e);
        });

        window.addEventListener('pointermove', (e) => {
            this.mousePos = this.getAdjustedCanvasPos(e);
            this.handlePointerMove(e);
        });

        window.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse') {
                if (e.button === 0) this.isMouseDown = false;
                if (e.button === 2) this.isShieldingInput = false;
            }
            this.handlePointerUp(e);
        });

        // 🛡️ シールドボタンの設定
        const shieldBtn = document.getElementById('shield-btn');
        if (shieldBtn) {
            shieldBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                this.isShieldingInput = true;
                this.isMouseDown = false;
                shieldBtn.classList.add('active');

                const rect = shieldBtn.getBoundingClientRect();
                const btnX = rect.left + rect.width / 2;
                const btnY = rect.top + rect.height / 2;

                const crect = this.canvas.getBoundingClientRect();
                const scaleX = this.canvas.width / crect.width;
                const scaleY = this.canvas.height / crect.height;
                const startX = (btnX - crect.left) * scaleX;
                const startY = (btnY - crect.top) * scaleY;

                // 【重要】明確に「シールド専用」としてスティックを起動
                this.rightStick.purpose = 'shield';
                this.rightStick.activate(startX, startY, e.pointerId);
                shieldBtn.setPointerCapture(e.pointerId);
            });

            shieldBtn.addEventListener('pointermove', (e) => {
                if (this.isShieldingInput && this.rightStick.active && this.rightStick.pointerId === e.pointerId) {
                    const pos = this.getAdjustedCanvasPos(e);
                    this.rightStick.move(pos.x, pos.y);
                }
            });

            const endShield = (e) => {
                e.preventDefault(); e.stopPropagation();
                this.isShieldingInput = false;
                shieldBtn.classList.remove('active');
                if (shieldBtn.hasPointerCapture(e.pointerId)) {
                    shieldBtn.releasePointerCapture(e.pointerId);
                }
                if (this.rightStick.active && this.rightStick.pointerId === e.pointerId) {
                    this.rightStick.deactivate();
                }
            };

            shieldBtn.addEventListener('pointerup', endShield);
            shieldBtn.addEventListener('pointercancel', endShield);
        }

        const bagwormBtn = document.getElementById('bagworm-btn');
        if (bagwormBtn) {
            bagwormBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                this.player.toggleBagworm(!this.player.isBagworm);
            });
        }
        const skillBtn = document.getElementById('skill-btn');
        if (skillBtn) {
            skillBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                this.player.activateSkill();
            });
        }
    }

    handlePointerDown(e) {
        // UIタップ時はキャンバスのタッチ判定を確実に無視する
        if (e.target.closest('.fullscreen-btn') ||
            e.target.closest('#shield-btn') || e.target.closest('.shield-btn') ||
            e.target.closest('#bagworm-btn') || e.target.closest('.bagworm-btn') ||
            e.target.closest('.glass-box') || e.target.closest('button')) {
            return;
        }

        // 【大改修】シールドボタン周辺の「誤爆デッドゾーン」を設定
        // 指が太くてボタンの外を触ってしまっても、攻撃エイムが暴発しないようにする
        const shieldBtn = document.getElementById('shield-btn');
        if (shieldBtn) {
            const rect = shieldBtn.getBoundingClientRect();
            const cx = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const cy = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

            // ボタンの周囲50px以内を触った場合は完全に無視！
            if (cx > rect.left - 50 && cx < rect.right + 50 && cy > rect.top - 50 && cy < rect.bottom + 50) {
                return;
            }
        }

        if (this.state !== 'playing') return;

        const pos = this.getAdjustedCanvasPos(e);

        if (pos.x < this.canvas.width / 2) {
            this.leftStick.activate(pos.x, pos.y, e.pointerId);
        } else {
            // シールドボタンを押していない時だけ「攻撃専用」として起動
            if (!this.isShieldingInput) {
                this.rightStick.purpose = 'aim';
                this.rightStick.activate(pos.x, pos.y, e.pointerId);
            }
        }
    }

    handlePointerMove(e) {
        if (this.state !== 'playing') return;
        const pos = this.getAdjustedCanvasPos(e);
        if (this.leftStick.active && this.leftStick.pointerId === e.pointerId) this.leftStick.move(pos.x, pos.y);
        else if (this.rightStick.active && this.rightStick.pointerId === e.pointerId) this.rightStick.move(pos.x, pos.y);
    }

    handlePointerUp(e) {
        if (this.state !== 'playing') return;
        if (this.leftStick.pointerId === e.pointerId) {
            this.leftStick.deactivate();
        } else if (this.rightStick.pointerId === e.pointerId) {
            if (this.rightStick.purpose === 'aim') {
                const dist = this.rightStick.getRawDist();
                const maxDist = this.rightStick.maxDistReached;

                if (this.player.hp > 0 && !this.player.isDead && !this.player.isBailingOut) {
                    if (this.player.isBagworm) this.player.toggleBagworm(false);

                    let shootAngle = this.player.angle;
                    let shouldShoot = false;

                    // A. タップ（オートエイム）
                    if (maxDist < 30) {
                        const autoAngle = this.getNearestEnemyAngle(this.player);
                        shootAngle = autoAngle !== null ? autoAngle : this.player.angle;
                        shouldShoot = true;
                    }
                    // B. ドラッグ（マニュアルエイム）
                    else if (dist > 25) {
                        shootAngle = this.rightStick.angle;
                        shouldShoot = true;
                    }

                    if (shouldShoot) {
                        const bullets = this.player.shootWithAngle(shootAngle);
                        if (bullets) {
                            this.bullets.push(...bullets);
                            // ★【重要】ここで一括して相手にデータを送る！
                            window.network.sendData('bullet-shot', {
                                x: this.player.x,
                                y: this.player.y,
                                angle: shootAngle,
                                className: this.player.config.name.toUpperCase(),
                                selectedSkill: this.player.selectedSkill,
                                isSkillPrimed: this.player.isSkillPrimed // スキル状態も忘れずに
                            });
                        }
                    }
                }
            }
            this.rightStick.deactivate();
        }
    }

    getNearestEnemyAngle(char) {
        let nearest = null;
        let minDist = Infinity;

        // 全てのキャラ（自分、相手、Bot）を一つの配列にまとめる
        // const allUnits = [this.player, this.rivalPlayer, ...this.bots];
        const allUnits = [this.player, this.rivalPlayer];

        for (const e of allUnits) {
            // 対象が存在しない、または自分自身、または死んでいる、または味方の場合はスキップ
            if (!e || e === char || e.isDead || e.hp <= 0 || e.isBailingOut || e.team === char.team) continue;

            // ステルス（草むら・バッグワーム）判定を入れるならここ
            // if (e.isBagworm && Math.sqrt((e.x - char.x)**2 + (e.y - char.y)**2) > 150) continue;

            const dx = e.x - char.x;
            const dy = e.y - char.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDist) {
                minDist = dist;
                nearest = Math.atan2(dy, dx);
            }
        }
        return nearest;
    }

    update(dt) {
        if (this.state !== 'playing') return;

        // 1. タイム管理
        this.gameTime -= dt;
        if (this.gameTime <= 0) { this.endGame('TIME OVER'); return; }

        // 2. チーム集計（再宣言エラーが出ないよう、ここで一度だけ宣言）
        // 2. チーム集計（Bot排除版）
        let blueTeam = [];
        let redTeam = [];

        if (window.network) {
            this.player.team = window.network.isHost ? 'blue' : 'red';
        }
        if (!this.player.isDead) {
            if (this.player.team === 'blue') blueTeam.push(this.player);
            else redTeam.push(this.player);
        }
        if (this.rivalPlayer && !this.rivalPlayer.isDead) {
            if (this.rivalPlayer.team === 'blue') blueTeam.push(this.rivalPlayer);
            else redTeam.push(this.rivalPlayer);
        }

        const enemiesOfBlue = redTeam;
        const enemiesOfRed = blueTeam;

        // 3. 入力とカメラの処理（省略されていた部分を復元）
        if (!this.player.isDead && this.player.config?.name === 'Sniper' && (this.isMouseDown || (this.rightStick.active && this.rightStick.purpose === 'aim'))) {
            this.targetZoom = 0.7;
        } else {
            this.targetZoom = 1.0;
        }
        this.zoom += (this.targetZoom - this.zoom) * 0.05;

        // キーボード・スティック入力の取得
        let ix = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
        let iy = (this.keys['KeyS'] ? 1 : 0) - (this.keys['KeyW'] ? 1 : 0);
        if (this.leftStick.active) { ix = this.leftStick.input.x; iy = this.leftStick.input.y; }

        const mWorldX = (this.mousePos.x / this.zoom) + this.camera.x;
        const mWorldY = (this.mousePos.y / this.zoom) + this.camera.y;

        let playerAimAngle = this.player.angle;
        if (this.isMouseDown || this.rightStick.active || this.isShieldingInput) {
            if (this.rightStick.active) playerAimAngle = this.rightStick.angle;
            else if (this.isMouseDown) playerAimAngle = Math.atan2(mWorldY - this.player.y, mWorldX - this.player.x);
        } else if (ix !== 0 || iy !== 0) {
            playerAimAngle = Math.atan2(iy, ix);
        }

        // 4. キャラクター達の更新
        if (!this.player.isDead) {
            this.player.isShieldingInput = this.isShieldingInput;
            const isTryingToAim = (this.isMouseDown || (this.rightStick.active && this.rightStick.purpose === 'aim'));
            this.player.update(dt, ix, iy, this.map, playerAimAngle, isTryingToAim);

            if (this.isMouseDown && !this.rightStick.active && !this.isShieldingInput && !this.player.isBailingOut) {
                const b = this.player.shoot();
                if (b) this.bullets.push(...b);
                window.network.sendData('bullet-shot', {
                    x: this.player.x,
                    y: this.player.y,
                    angle: this.player.angle,
                    className: this.player.config.name.toUpperCase(),
                    selectedSkill: this.player.selectedSkill,
                    isSkillPrimed: this.player.isSkillPrimed
                });
            }
        }
        if (this.rivalPlayer && !this.rivalPlayer.isDead) {
            this.rivalPlayer.update(dt, 0, 0, this.map, this.rivalPlayer.angle, this.rivalPlayer.isAttacking);
        }
        // for (const b of activeBots) {
        //     const enemies = (b.team === 'blue') ? enemiesOfBlue : enemiesOfRed;
        //     b.updateAI(dt, this.map, enemies);
        //     const bullets = b.shootAI(enemies);
        //     if (bullets) this.bullets.push(...bullets);
        // }

        // 5. 弾の更新と当たり判定（ここをこの1つのブロックだけにしてください）
        // --- 5. 弾の更新と当たり判定（ここから） ---
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bul = this.bullets[i];
            bul.update(dt);

            let hit = false;
            // 自分(player)が撃った弾か、相手(rivalPlayer)が撃った弾かを判定
            const isMyBullet = (bul.ownerTeam === this.player.team);
            const targets = isMyBullet ? [this.rivalPlayer] : [this.player];

            for (const t of targets) {
                if (!t || t.isDead || t.isBailingOut) continue;

                if (bul.checkEntityCollision(t)) {
                    // ★ダメージ計算は「自分の画面で相手に当てた時」だけ実行
                    if (isMyBullet && t === this.rivalPlayer) {
                        let finalDamage = bul.damage;
                        if (t.isBagworm) t.toggleBagworm(false);

                        // シールド判定
                        if (t.isShielding && !t.isBroken && t.checkShield(bul.angle)) {
                            finalDamage = bul.damage * 0.1; // 9割カット
                        }

                        // 自分の画面上の相手のHPを減らす（即座に反映させるため）
                        t.hp -= finalDamage;

                        // 相手にダメージ確定を通知
                        if (window.network) {
                            window.network.sendData('apply-damage', {
                                damage: finalDamage,
                                from: this.player.team
                            });
                        }

                        // 撃破判定
                        if (t.hp <= 0) {
                            t.startBailOut();
                            if (this.player.team === 'blue') this.scores.blue++; else this.scores.red++;
                        }
                    }

                    hit = true;
                    break;
                }
            }

            // 壁衝突または寿命、またはヒットした弾を消去
            if (hit || bul.life <= 0 || (!bul.pierce && bul.checkWallCollision(this.map))) {
                this.bullets.splice(i, 1);
            }
        }
        // --- 5. 弾の更新と当たり判定（ここまで） ---

        // 6. 演出・通信・HUD
        for (let i = this.effects.length - 1; i >= 0; i--) {
            this.effects[i].life -= dt;
            if (this.effects[i].life <= 0) this.effects.splice(i, 1);
        }

        const tx = this.player.x - (this.canvas.width / 2) / this.zoom;
        const ty = this.player.y - (this.canvas.height / 2) / this.zoom;
        this.camera.x += (tx - this.camera.x) * 0.1;
        this.camera.y += (ty - this.camera.y) * 0.1;

        // Game.update(dt) 内の送信部分

        if (window.network) {
            // 第一引数に 'タイプ'、第二引数に '中身のオブジェクト' を渡す
            window.network.sendData('player-update', {
                x: this.player.x,
                y: this.player.y,
                angle: this.player.angle,
                isAttacking: this.player.isAttacking,
                isShielding: this.player.isShielding,
                isBagworm: this.player.isBagworm
            });
        }

        if (this.rivalReady) {
            if (enemiesOfRed.length === 0) this.endGame('RED WINS');
            else if (enemiesOfBlue.length === 0) this.endGame('BLUE WINS');
        }

        this.updateHUD();
    }


    updateHUD() {
        const min = Math.floor(this.gameTime / 60);
        const sec = Math.floor(this.gameTime % 60);
        document.getElementById('timer-display').innerText = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        document.getElementById('score-blue').innerText = this.scores.blue;
        document.getElementById('score-red').innerText = this.scores.red;

        const spPercent = (this.player.sp / this.player.maxSP) * 100;
        const shieldBar = document.getElementById('status-shield-bar');
        if (shieldBar) {
            shieldBar.style.width = `${spPercent}%`;
            shieldBar.classList.toggle('broken', this.player.isBroken);
        }

        const ammoInfo = document.getElementById('status-ammo');
        if (ammoInfo && this.player.config) {
            const p = this.player;
            let html = `<div class="btn-name">${p.config.name.toUpperCase()}</div><div class="ammo-dots">`;
            for (let i = 0; i < p.maxAmmo; i++) html += `<div class="ammo-dot ${i < p.ammo ? 'filled' : ''}"></div>`;
            html += `</div>`;
            ammoInfo.innerHTML = html;
        }

        const bagwormBtn = document.getElementById('bagworm-btn');
        if (bagwormBtn) bagwormBtn.classList.toggle('active', this.player.isBagworm);

        // ★ スキルボタンの表示切り替え
        const skillBtn = document.getElementById('skill-btn');
        if (skillBtn) {
            const p = this.player;
            if (p.selectedSkill) {
                skillBtn.style.display = 'flex';

                if (p.skillTimer > 0) {
                    // ★ クールダウン中は残り秒数を表示（小数点第1位まで）
                    skillBtn.innerText = p.skillTimer.toFixed(1) + "s";
                    skillBtn.classList.remove('active'); // クールダウン中は光らせない
                    skillBtn.style.opacity = "0.5";      // 少し暗くする
                } else {
                    // ★修正：待機中は残り回数を表示、そうでなければスキル名を表示
                    if (p.isSkillPrimed) {
                        skillBtn.innerText = `${p.selectedSkill} (${p.skillCharges})`;
                    } else {
                        skillBtn.innerText = p.selectedSkill;
                    }
                    skillBtn.style.opacity = "1.0";
                    skillBtn.classList.toggle('active', p.isSkillPrimed);
                }
            } else {
                skillBtn.style.display = 'none';
            }
        }

    }

    endGame(msg) {
        this.state = 'result';
        document.getElementById('ui-layer').classList.add('hidden');
        const bo = document.getElementById('bailout-text');
        if (bo) { bo.classList.add('hidden'); bo.style.display = 'none'; }
        document.getElementById('result-screen').classList.remove('hidden');
        document.getElementById('result-title').innerText = msg;
        document.getElementById('result-blue').innerText = this.scores.blue;
        document.getElementById('result-red').innerText = this.scores.red;
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(-this.camera.x, -this.camera.y);

        if (this.map) {
            this.map.render(this.ctx, this.camera, this.canvas.width / this.zoom, this.canvas.height / this.zoom, 'base');
        }

        if (this.state === 'selecting' || this.state === 'setup') {
            this.ctx.restore();
            return;
        }

        for (const fx of this.effects) {
            if (fx.type === 'pillar') {
                const grad = this.ctx.createLinearGradient(0, fx.y - 600, 0, fx.y);
                grad.addColorStop(0, 'transparent'); grad.addColorStop(0.5, '#38bdf888'); grad.addColorStop(1, '#fff');
                this.ctx.fillStyle = grad;
                const width = 24 * Math.min(1, fx.life);
                this.ctx.fillRect(fx.x - width / 2, fx.y - 1200, width, 1200);
            } else if (fx.type === 'trion_cube') {
                this.ctx.fillStyle = `rgba(56, 189, 248, ${fx.life * 2})`;
                this.ctx.fillRect(fx.x - fx.size / 2, fx.y - fx.size / 2, fx.size, fx.size);
            } else if (fx.type === 'gather_particle') {
                this.ctx.fillStyle = `rgba(255, 255, 255, ${fx.life * 2})`;
                this.ctx.beginPath(); this.ctx.arc(fx.x, fx.y, fx.size, 0, Math.PI * 2); this.ctx.fill();
            }
        }
        for (const b of this.bullets) b.render(this.ctx);

        if (!this.player.isDead) this.player.render(this.ctx, this.map);
        // render() メソッドの中、this.player.render の直後に追加
        if (this.rivalPlayer && !this.rivalPlayer.isDead) {
            this.rivalPlayer.render(this.ctx, this.map);
        }
        // for (const b of this.bots) if (!b.isDead) b.render(this.ctx, this.map);

        this.map.render(this.ctx, this.camera, this.canvas.width / this.zoom, this.canvas.height / this.zoom, 'bushes');

        this.ctx.restore();

        this.drawMinimap();

        if (this.zoom < 0.95) {
            const grad = this.ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.3, this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.8);
            grad.addColorStop(0, 'transparent'); grad.addColorStop(1, 'rgba(0,0,0,0.8)');
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }


    }

    drawMinimap() {
        const miniCanvas = document.getElementById('minimap-canvas');
        if (!miniCanvas) return;
        const miniCtx = miniCanvas.getContext('2d');
        const scale = miniCanvas.width / (MAP_WIDTH * TILE_SIZE);
        miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
        miniCtx.fillStyle = 'rgba(255,255,255,0.1)';
        for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) if (this.map.data[y][x] === 1) miniCtx.fillRect(x * TILE_SIZE * scale, y * TILE_SIZE * scale, TILE_SIZE * scale, TILE_SIZE * scale);

        if (!this.player.isDead) {
            const inBush = this.map.getTile(this.player.x, this.player.y) === 2;
            const px = this.player.x * scale;
            const py = this.player.y * scale;
            miniCtx.fillStyle = '#38bdf8';
            if (inBush) {
                miniCtx.globalAlpha = 0.5;
                miniCtx.beginPath(); miniCtx.arc(px, py, 3, 0, Math.PI * 2); miniCtx.fill();
                miniCtx.globalAlpha = 1.0;
                miniCtx.strokeStyle = '#fff'; miniCtx.lineWidth = 1;
                miniCtx.beginPath(); miniCtx.arc(px, py, 3, 0, Math.PI * 2); miniCtx.stroke();
            } else {
                miniCtx.beginPath(); miniCtx.arc(px, py, 3, 0, Math.PI * 2); miniCtx.fill();
            }
        }

        // for (const b of this.bots) {
        //     if (b.isDead) continue;
        //     if (b.team === 'red' && (b.isBagworm || this.map.getTile(b.x, b.y) === 2)) continue;

        //     miniCtx.fillStyle = (b.team === 'blue') ? '#38bdf8' : '#f43f5e';
        //     if (b.team === 'blue' && this.map.getTile(b.x, b.y) === 2) {
        //         miniCtx.globalAlpha = 0.5;
        //         miniCtx.beginPath(); miniCtx.arc(b.x * scale, b.y * scale, 2, 0, Math.PI * 2); miniCtx.fill();
        //         miniCtx.globalAlpha = 1.0;
        //     } else {
        //         miniCtx.beginPath(); miniCtx.arc(b.x * scale, b.y * scale, 2, 0, Math.PI * 2); miniCtx.fill();
        //     }
        // }
    }

    gameLoop(currentTime) {
        const dt = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        this.update(Math.min(dt, 0.1));
        this.render();
        requestAnimationFrame(this.gameLoop.bind(this));
    }
}

class VirtualJoystick {
    constructor(side) {
        this.side = side; this.active = false; this.pointerId = null;
        this.purpose = null; // 【追加】何の目的で使われているか（'aim' または 'shield'）
        this.origin = { x: 0, y: 0 }; this.current = { x: 0, y: 0 }; this.input = { x: 0, y: 0 };
        this.angle = 0; this.maxDist = 60; this.maxDistReached = 0;
        this.baseEl = document.createElement('div'); this.baseEl.className = 'joystick-base';
        this.handleEl = document.createElement('div'); this.handleEl.className = 'joystick-handle';
        this.baseEl.appendChild(this.handleEl); document.body.appendChild(this.baseEl);
    }
    activate(x, y, id) {
        this.active = true; this.pointerId = id; this.origin = { x, y }; this.current = { x, y }; this.maxDistReached = 0;
        this.baseEl.style.display = 'block'; this.baseEl.style.left = `${x - 60}px`; this.baseEl.style.top = `${y - 60}px`;
    }
    move(x, y) {
        this.current = { x, y }; const dx = x - this.origin.x; const dy = y - this.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy); this.maxDistReached = Math.max(this.maxDistReached, dist);
        this.angle = Math.atan2(dy, dx); const clamped = Math.min(dist, this.maxDist);
        this.input.x = (Math.cos(this.angle) * clamped) / this.maxDist; this.input.y = (Math.sin(this.angle) * clamped) / this.maxDist;
        this.handleEl.style.left = `${50 + this.input.x * 50}%`; this.handleEl.style.top = `${50 + this.input.y * 50}%`;
    }
    getRawDist() { const dx = this.current.x - this.origin.x, dy = this.current.y - this.origin.y; return Math.sqrt(dx * dx + dy * dy); }
    deactivate() { this.active = false; this.input = { x: 0, y: 0 }; this.baseEl.style.display = 'none'; this.purpose = null; }
}

class GameMap {
    constructor(w, h) { this.width = w; this.height = h; this.data = this.generateMap(); }
    generateMap() {
        const data = Array(this.height).fill().map(() => Array(this.width).fill(0));
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1) data[y][x] = 1;
        const my = Math.floor(this.height / 2);
        for (let x = 1; x < this.width - 1; x++) { data[my - 1][x] = 0; data[my][x] = 0; data[my + 1][x] = 0; }
        for (let i = 0; i < 200; i++) {
            const rx = Math.floor(Math.random() * (this.width - 4)) + 2; const ry = Math.floor(Math.random() * (this.height - 4)) + 2;
            if (data[ry][rx] === 0) {
                const type = Math.random() > 0.4 ? 1 : 2; const size = type === 1 ? Math.floor(Math.random() * 3) + 2 : 2;
                for (let y = ry; y < ry + size && y < this.height - 1; y++) for (let x = rx; x < rx + size && x < this.width - 1; x++) if (Math.abs(y - my) > 2) data[y][x] = type;
            }
        }
        return data;
    }
    getTile(px, py) {
        // もし数値じゃなかったら(NaNだったら)壁として扱う
        if (isNaN(px) || isNaN(py)) return 1;
        const tx = Math.floor(px / TILE_SIZE); const ty = Math.floor(py / TILE_SIZE);
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return 1;
        // ty 行が存在するかチェックしてからアクセス
        if (!this.data[ty]) return 1;
        return this.data[ty][tx];
    }
    render(ctx, cam, vw, vh, layer = 'base') {
        const sx = Math.max(0, Math.floor(cam.x / TILE_SIZE)), ex = Math.min(this.width, Math.ceil((cam.x + vw) / TILE_SIZE));
        const sy = Math.max(0, Math.floor(cam.y / TILE_SIZE)), ey = Math.min(this.height, Math.ceil((cam.y + vh) / TILE_SIZE));

        if (layer === 'base') {
            ctx.fillStyle = '#1e293b'; ctx.fillRect(sx * TILE_SIZE, sy * TILE_SIZE, (ex - sx) * TILE_SIZE, (ey - sy) * TILE_SIZE);
            ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
            for (let x = sx; x <= ex; x++) { ctx.beginPath(); ctx.moveTo(x * TILE_SIZE, sy * TILE_SIZE); ctx.lineTo(x * TILE_SIZE, ey * TILE_SIZE); ctx.stroke(); }
            for (let y = sy; y <= ey; y++) { ctx.beginPath(); ctx.moveTo(sx * TILE_SIZE, y * TILE_SIZE); ctx.lineTo(ex * TILE_SIZE, y * TILE_SIZE); ctx.stroke(); }
            ctx.fillStyle = '#475569';
            for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) if (this.data[y][x] === 1) ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        } else {
            ctx.fillStyle = 'rgba(22, 163, 74, 0.4)';
            for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) if (this.data[y][x] === 2) ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
}

class Bullet {
    constructor(x, y, angle, speed, damage, life, ownerTeam, ownerClass, size = 4) {
        this.x = x; this.y = y; this.angle = angle; this.speed = speed;
        this.damage = damage; this.life = life; this.ownerTeam = ownerTeam; this.size = size;
        this.ownerClass = ownerClass;
        this.isSlash = false; this.pierce = false;
        this.ignoreWallTimer = 0;
        this.initialIgnoreWallTime = 0;
        this.isLeadBullet = false;
    }
    update(dt) {
        // --- ハウンド(誘導弾) 1対1専用の追尾ロジック ---
        if (this.ownerClass === 'Hound' && window.game) {
            // 敵は常に自分とは違うチームの相手
            let target = (this.ownerTeam === window.game.player.team) ? window.game.rivalPlayer : window.game.player;

            if (target && !target.isDead && !target.isBailingOut) {
                const dist = Math.sqrt((target.x - this.x) ** 2 + (target.y - this.y) ** 2);
                const detectionRange = target.isBagworm ? 150 : 300;

                if (dist < detectionRange) {
                    const targetAngle = Math.atan2(target.y - this.y, target.x - this.x);
                    let diff = targetAngle - this.angle;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    this.angle += diff * 0.20; // 誘導の強さ
                }
            }
        }

        this.x += Math.cos(this.angle) * this.speed * dt;
        this.y += Math.sin(this.angle) * this.speed * dt;
        this.life -= dt;
    }
    checkWallCollision(map) { return map.getTile(this.x, this.y) === 1; }
    checkEntityCollision(ent) {
        if (ent.isDead || ent.isBailingOut) return false;
        const dx = this.x - ent.x; const dy = this.y - ent.y;
        return Math.sqrt(dx * dx + dy * dy) < ent.size / 2 + this.size;
    }
    render(ctx) {
        let drawX = this.x;
        let drawY = this.y;
        let currentSize = this.size;

        // --- 弾が「浮いている」時の視覚エフェクト ---
        if (this.ignoreWallTimer > 0 && this.initialIgnoreWallTime > 0) {
            const progress = 1 - (this.ignoreWallTimer / this.initialIgnoreWallTime);
            const jumpHeight = Math.sin(progress * Math.PI) * 50;

            // ① 影を描画 (地面の位置)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.8, 0, Math.PI * 2);
            ctx.fill();

            // ② 描画用の座標とサイズを更新
            drawY = this.y - jumpHeight;
            currentSize = this.size * (1 + (jumpHeight / 100));
        }
        if (this.isSlash) {
            ctx.save();
            ctx.translate(drawX, drawY);
            ctx.rotate(this.angle);

            if (this.ownerClass === 'Kogetsu' || this.ownerClass === 'Senku') {
                // ★ 3vs3の迫力ある大きな描画サイズに戻す
                const isSenku = this.ownerClass === 'Senku';
                const radius = isSenku ? 60 : 35; // 旋空は巨大（60）、通常弧月も大きめ（35）

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = isSenku ? 20 : 12;
                ctx.lineCap = 'round';
                ctx.shadowBlur = isSenku ? 40 : 25;
                ctx.shadowColor = '#fff';

                ctx.beginPath();
                ctx.arc(0, 0, radius, -1, 1);
                ctx.stroke();

                ctx.shadowBlur = 0;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = isSenku ? 8 : 4;

                ctx.beginPath();
                ctx.arc(0, 0, radius, -1, 1);
                ctx.stroke();

            } else if (this.ownerClass === 'Mantis') {
                // --- マンティス：長く鋭い赤い閃光 ---
                const radius = 45; // マンティスも鋭く長く描画
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#f43f5e';

                ctx.beginPath();
                ctx.arc(0, 0, radius, -0.5, 0.5);
                ctx.stroke();

            } else {
                // --- スコーピオン：青緑の素早い刃 ---
                const radius = 24; // 通常スコーピオン
                ctx.strokeStyle = '#e5e58aff';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 0, radius, -1, 1);

                ctx.shadowBlur = 5;
                ctx.shadowColor = '#38bdf8';
            }

            ctx.stroke();
            ctx.restore();
        } else {
            // ▼▼▼ ここから書き換える ▼▼▼
            ctx.save(); // ハウンドの光が他の弾にうつらないようにする
            if (this.isLeadBullet) {
                // --- 鉛弾（レッドバレッド）の描画 ---
                ctx.fillStyle = '#111111'; // 真っ黒
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#000000';
                ctx.beginPath();
                ctx.arc(drawX, drawY, currentSize * 1.8, 0, Math.PI * 2);
                ctx.fill();

                // 中心に少しハイライト
                ctx.fillStyle = '#333333';
                ctx.beginPath();
                ctx.arc(drawX, drawY, currentSize * 0.5, 0, Math.PI * 2);
                ctx.fill();
            } else
                if (this.ownerClass === 'Hound') {
                    // ハウンド専用の描画（紫色に光らせる）
                    ctx.fillStyle = '#75cf89ff';
                    ctx.shadowBlur = 12;
                    ctx.shadowColor = '#86e981ff';

                    // 【おまけ】少し弾を大きく見せると強そうです
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, currentSize * 1.5, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillStyle = this.ownerTeam === 'blue' ? '#c3eabcff' : '#f43f5e';
                    ctx.beginPath(); ctx.arc(drawX, drawY, currentSize, 0, Math.PI * 2); ctx.fill();
                }
            ctx.restore();
        }
    }
}

class Player {
    constructor(x, y) {
        this.x = x; this.y = y; this.size = 22; this.hp = 100; this.maxHp = 100;
        this.team = 'blue'; this.ammo = 0; this.reloadTimer = 0; this.lastShootTime = 0;
        this.isDead = false; this.angle = 0; this.isMoving = false; this.isAttacking = false;
        this.isShielding = false; this.isShieldingInput = false;
        this.sp = 100; this.maxSP = 100; this.isBroken = false; this.brokenTimer = 0;
        this.isBailingOut = false; this.bailOutTimer = 0; this.bailOutYOffset = 0; this.pillarSpawned = false;
        this.isControlPlayer = false;
        this.attackVisualTimer = 0;
        this.aimTimer = 0;
        this.isBagworm = false;

        // --- ここから追加 ---
        this.selectedSkill = null;
        this.isSkillPrimed = false;
        this.skillTimer = 0;      // クールダウン残り時間
        this.skillCooldown = 15;  // クールダウンの最大値
        this.skillCharges = 0;    // スキルの残り使用回数
    }

    // ★新規メソッド：スキルボタンを押した時の処理
    activateSkill() {
        if (this.isDead || this.isBailingOut || !this.selectedSkill) return;

        if (this.skillTimer > 0) return;

        // 今後即時発動型のスキル（グラスホッパーなど）を追加する場合はここに書く
        /*
        if (this.selectedSkill === 'GRASSHOPPER') {
            this.jump(); return; 
        }
        */

        // 攻撃付与型のスキル（旋空など）は、待機状態（ON/OFF）を切り替える
        this.isSkillPrimed = !this.isSkillPrimed;

        if (this.isSkillPrimed) {
            // ★発動した瞬間にチャージ数をセット（ポジションごとに変えると面白い）
            if (this.config.name === 'Gunner') {
                this.skillCharges = 3; // ガンナーは多めに連射できる
            } else if (this.config.name === 'Sniper') {
                this.skillCharges = 2;
            } else if (this.config.name === 'Shooter') {
                this.skillCharges = 5;  // シューターは強力なバースト3回分
            } else if (this.config.name === 'Kogetsu') {
                this.skillCharges = 1;  // 旋空は今まで通り1回
            } else if (this.config.name === 'Scorpion') {
                // ★追加：マンティスは3回分振れるように設定
                this.skillCharges = 3;
            }
        } else {
            // ★追加：手動でOFFにした場合もクールダウンを開始させる
            this.skillTimer = this.skillCooldown;
            this.skillCharges = 0;
        }

    }

    setClass(className) {
        if (!className) return;
        const key = className.toUpperCase(); // 全て大文字に変換して探す
        if (!TRG_CLASSES[key]) {
            console.error("未定義のクラス:", className);
            return;
        }
        this.config = TRG_CLASSES[key];
        this.speed = this.config.speed; this.maxAmmo = this.config.maxAmmo; this.ammo = this.maxAmmo;
        this.maxSP = this.config.maxSP; this.sp = this.maxSP;
    }
    toggleBagworm(on) {
        if (this.isDead || this.isBailingOut) return;
        if (on === this.isBagworm) return;
        this.isBagworm = on;
        if (window.game) window.game.spawnBagwormEffect(this.x, this.y, on ? 'activate' : 'deactivate');
    }
    update(dt, ix, iy, map, aimAngle, isAttacking) {
        if (this.isDead) return;
        // 毎フレーム、クールダウンタイマーを減らす
        if (this.skillTimer > 0) {
            this.skillTimer -= dt;
            if (this.skillTimer < 0) this.skillTimer = 0;
        }

        if (this.isBailingOut) {
            this.bailOutTimer -= dt;
            const progress = (1.5 - this.bailOutTimer) / 1.5;
            this.bailOutYOffset -= dt * 200 * (1 + progress * 2);
            if (this.bailOutTimer <= 0) {
                this.isBailingOut = false; this.isDead = true;
                if (this.isControlPlayer) {
                    const el = document.getElementById('bailout-text');
                    if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
                }
            }
            return;
        }

        if (this.isBroken) {
            this.brokenTimer -= dt;
            if (this.brokenTimer <= 0) { this.isBroken = false; this.sp = this.maxSP * 0.2; }
        }

        this.isShielding = this.isShieldingInput && !this.isBroken;
        if (this.isShielding && this.isBagworm) this.toggleBagworm(false);

        this.angle = aimAngle;

        this.isAttacking = isAttacking && !this.isShielding;
        if (this.isAttacking) this.aimTimer += dt; else this.aimTimer = 0;
        if (this.attackVisualTimer > 0) this.attackVisualTimer -= dt;
        this.isMoving = (ix !== 0 || iy !== 0);

        let currentSpeed = this.speed;
        if (this.isShielding) {
            currentSpeed *= this.config.shieldSpeedMult || 0.8;
            if (this.sp <= 0) { this.sp = 0; this.isBroken = true; this.brokenTimer = 5; this.isShielding = false; }
        } else if (!this.isBroken && this.sp < this.maxSP) {
            this.sp += dt * 15;
            if (this.sp > this.maxSP) this.sp = this.maxSP;
        }

        if (this.isMoving) {
            const len = Math.sqrt(ix * ix + iy * iy);
            const dx = (ix / len) * currentSpeed * dt;
            const dy = (iy / len) * currentSpeed * dt;
            if (this.canMoveTo(this.x + dx, this.y, map)) this.x += dx;
            if (this.canMoveTo(this.x, this.y + dy, map)) this.y += dy;
        }
        if (this.isControlPlayer) {
            this.pushOutOfWalls(map);
        }

        if (this.ammo < this.maxAmmo) {
            this.reloadTimer += dt;
            if (this.reloadTimer >= this.config.reloadSpeed) { this.ammo++; this.reloadTimer = 0; }
        }
    }
    shoot() {
        if (this.isControlPlayer && window.game && window.game.isShieldingInput) {
            return null;
        }
        if (this.isBagworm) this.toggleBagworm(false);
        return this.shootWithAngle(this.angle);
    }
    shootWithAngle(angle, isExternal = false) {
        if (this.isShielding) return null;
        const now = performance.now() / 1000;

        if (isExternal || (this.ammo > 0 && now - this.lastShootTime > this.config.shootDelay)) {
            if (!isExternal) {
                if (this.isBagworm) this.toggleBagworm(false);
                this.ammo--;
                this.lastShootTime = now;
            }
            const cfg = this.config;
            const bArr = [];
            this.attackVisualTimer = 0.2;

            // ★スキル状態の判定
            const isHound = (this.selectedSkill === 'HOUND' && this.isSkillPrimed);
            const isLead = (this.selectedSkill === 'LEAD_BULLET' && this.isSkillPrimed);
            const isSenku = (this.selectedSkill === 'SENKU' && this.isSkillPrimed);
            const isMantis = (this.selectedSkill === 'MANTIS' && this.isSkillPrimed);

            if (cfg.name === 'Gunner') {
                if (isHound) {
                    const bl = new Bullet(this.x, this.y, angle, cfg.bulletSpeed * 0.8, cfg.damage, cfg.range / cfg.bulletSpeed * 1.5, this.team, 'Hound', 4);
                    bl.ignoreWallTimer = 0.6; bl.initialIgnoreWallTime = 0.6;
                    bArr.push(bl);
                    if (!isExternal) this.skillCharges--;
                } else if (isLead) {
                    const bl = new Bullet(this.x, this.y, angle, cfg.bulletSpeed * 0.6, 0, cfg.range / cfg.bulletSpeed, this.team, cfg.name, 6);
                    bl.isLeadBullet = true;
                    bArr.push(bl);
                    if (!isExternal) this.skillCharges--;
                } else {
                    bArr.push(new Bullet(this.x, this.y, angle, cfg.bulletSpeed, cfg.damage, cfg.range / cfg.bulletSpeed, this.team, cfg.name, 4));
                }
            } else if (cfg.name === 'Shooter') {
                if (isHound) {
                    for (let i = 0; i < cfg.burst; i++) {
                        const spread = (Math.random() - 0.5) * 0.8;
                        const bl = new Bullet(this.x, this.y, angle + spread, cfg.bulletSpeed * 0.8, cfg.damage, cfg.range / cfg.bulletSpeed * 1.5, this.team, 'Hound', 4);
                        bl.ignoreWallTimer = 0.6; bl.initialIgnoreWallTime = 0.6;
                        bArr.push(bl);
                    }
                    if (!isExternal) this.skillCharges--;
                } else {
                    for (let i = 0; i < cfg.burst; i++) {
                        const s = (Math.random() - 0.5) * 0.2;
                        bArr.push(new Bullet(this.x, this.y, angle + s, cfg.bulletSpeed, cfg.damage, cfg.range / cfg.bulletSpeed, this.team, cfg.name, 3));
                    }
                }
            } else if (cfg.aimType === 'arc') {
                if (cfg.name === 'Kogetsu' || cfg.name === 'KOGETSU') {
                    const rangeMult = isSenku ? 3 : 1;
                    const actualSpeed = cfg.bulletSpeed * (isSenku ? 1.2 : 1);
                    const bl = new Bullet(this.x + Math.cos(angle) * 20, this.y + Math.sin(angle) * 20, angle, actualSpeed, cfg.damage, (cfg.range * rangeMult) / actualSpeed, this.team, isSenku ? 'Senku' : cfg.name, isSenku ? 24 : 12);
                    bl.pierce = isSenku; bl.isSlash = true;
                    bArr.push(bl);
                    if (isSenku && !isExternal) this.skillCharges--;
                } else if (cfg.name === 'Scorpion' || cfg.name === 'SCORPION') {
                    const rangeMult = isMantis ? 2.5 : 1.0;
                    const actualSpeed = cfg.bulletSpeed * (isMantis ? 1.5 : 1.0);
                    const fanAngle = isMantis ? 0.3 : 0.6;
                    for (let a = -fanAngle; a <= fanAngle; a += 0.3) {
                        const bl = new Bullet(this.x + Math.cos(angle + a) * 20, this.y + Math.sin(angle + a) * 20, angle + a, actualSpeed, cfg.damage, (cfg.range * rangeMult) / actualSpeed, this.team, isMantis ? 'Mantis' : cfg.name, 12);
                        bl.pierce = isMantis; bl.isSlash = true;
                        bArr.push(bl);
                    }
                    if (isMantis && !isExternal) this.skillCharges--;
                }
            } else {
                if (isLead) {
                    const bl = new Bullet(this.x, this.y, angle, cfg.bulletSpeed * 0.5, 0, cfg.range / cfg.bulletSpeed, this.team, cfg.name, 8);
                    bl.isLeadBullet = true;
                    bArr.push(bl);
                    if (!isExternal) this.skillCharges--;
                } else {
                    bArr.push(new Bullet(this.x, this.y, angle, cfg.bulletSpeed, cfg.damage, cfg.range / cfg.bulletSpeed, this.team, cfg.name, 5));
                }
            }

            // チャージが切れたらクールダウンへ
            if (!isExternal && this.isSkillPrimed && this.skillCharges <= 0) {
                this.isSkillPrimed = false;
                this.skillTimer = this.skillCooldown;
                this.skillCharges = 0;
            }
            return bArr;
        }
        return null;
    }

    startBailOut() {
        if (this.isBailingOut) return;
        this.isBailingOut = true;
        this.isShielding = false; this.isShieldingInput = false;
        this.isBagworm = false;
        this.bailOutTimer = 1.5;
        this.bailOutYOffset = 0;
        this.hp = 0;
        this.isAttacking = false;
        if (this.isControlPlayer) {
            const el = document.getElementById('bailout-text');
            if (el) { el.classList.remove('hidden'); el.style.display = 'block'; }
        }
        if (window.game && !this.pillarSpawned) {
            window.game.spawnTransferEffect(this.x, this.y, 2.0);
            this.pillarSpawned = true;
        }
    }
    checkShield(bulletAngle) {
        if (!this.isShielding || this.isBroken) return false;
        const hitDir = (bulletAngle + Math.PI) % (Math.PI * 2);
        let diff = Math.abs(this.angle - hitDir);
        while (diff > Math.PI) diff = Math.PI * 2 - diff;
        return diff < this.config.shieldWidth / 2;
    }
    pushOutOfWalls(map) {
        const dist = 1; const o = this.size / 2;
        if (map.getTile(this.x, this.y) === 1) { this.x += (Math.random() - 0.5) * 10; this.y += (Math.random() - 0.5) * 10; }
        if (map.getTile(this.x - o, this.y) === 1) this.x += dist; if (map.getTile(this.x + o, this.y) === 1) this.x -= dist;
        if (map.getTile(this.x, this.y - o) === 1) this.y += dist; if (map.getTile(this.x, this.y + o) === 1) this.y -= dist;
    }
    canMoveTo(nx, ny, map) {
        const o = this.size / 2; const c = [{ x: nx - o, y: ny - o }, { x: nx + o, y: ny - o }, { x: nx - o, y: ny + o }, { x: nx + o, y: ny + o }];
        for (const p of c) if (map.getTile(p.x, p.y) === 1) return false; return true;
    }
    render(ctx, map) {
        if (this.isDead) return;
        ctx.save(); // 【SAVE 1】全体の座標などの保存用

        // --- 1. 透明度(alpha)の計算ロジック ---
        let alpha = 1.0;

        if (this.isBailingOut) {
            ctx.translate(0, this.bailOutYOffset);
            alpha = Math.max(0, this.bailOutTimer / 1.5);
            ctx.filter = 'grayscale(100%) brightness(3)';
        } else {
            const inBush = (map && map.getTile(this.x, this.y) === 2);

            if (this.isBagworm || inBush) {
                // あなたが操作しているキャラ(isControlPlayer)の場合
                if (this.isControlPlayer) {
                    alpha = 0.4;
                    ctx.filter = 'contrast(50%) brightness(1.5)';
                } else {
                    // Botや他のプレイヤーの場合、操作プレイヤーとの距離を計算
                    const me = window.game.player;
                    const dist = Math.sqrt((this.x - me.x) ** 2 + (this.y - me.y) ** 2);

                    // 草むらなら50px、バッグワームなら150pxで見えるようにする
                    const visibleDist = inBush ? 80 : 350;

                    if (dist > visibleDist) {
                        alpha = 0.0;
                    } else {
                        alpha = 0.5 * (1 - dist / visibleDist);
                    }
                }
            }
        }

        // 完全に透明な場合は、ここで描画をスキップして終わる
        if (alpha <= 0) {
            ctx.restore(); // 【RESTORE 1】描画スキップ時の後始末（絶対に忘れてはいけない）
            return;
        }

        // --- 2. 実際の描画処理 ---
        // ★本体とシールドにだけ透明度・フィルターをかけるためのSAVE
        ctx.save(); // 【SAVE 2】
        ctx.globalAlpha = alpha;

        const cfg = this.config;
        const isRight = (Math.abs(this.angle) < Math.PI / 2);
        const isEnemy = (this.team !== 'blue');

        // 🛡️ シールドの描画
        if (this.isShielding && !this.isBroken) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);

            const sWidth = cfg.shieldWidth || 1.2;
            const sRadius = 35;

            ctx.beginPath();
            ctx.arc(0, 0, sRadius, -sWidth / 2, sWidth / 2);
            ctx.strokeStyle = this.team === 'blue' ? 'rgba(56, 189, 248, 0.8)' : 'rgba(244, 63, 94, 0.8)';
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.globalAlpha = 0.3 * (this.sp / this.maxSP);
            ctx.fillStyle = this.team === 'blue' ? '#38bdf8' : '#f43f5e';
            ctx.fill();
            ctx.restore();
        }

        // エイムインジケーター（射線）の描画
        let showIndicator = this.isAttacking && !this.isBagworm;
        let indicatorColor = cfg.color + '66';
        if (isEnemy) {
            if (cfg.name === 'Sniper' && this.aimTimer > 0.5) indicatorColor = '#f43f5e';
            indicatorColor = '#f43f5e';
        }

        if (showIndicator) {
            ctx.save(); // 線の設定が他の描画に影響しないように保存
            ctx.strokeStyle = indicatorColor;

            if (cfg.aimType === 'arc') {
                // --- 孤月・スコーピオンの扇形インジケーター ---

                // 旋空スキルが「発動待機中」かどうかを正しく判定
                const isSenku = (cfg.name === 'Kogetsu' && this.selectedSkill === 'SENKU' && this.isSkillPrimed);
                const isMantis = (cfg.name === 'Scorpion' && this.selectedSkill === 'MANTIS' && this.isSkillPrimed);

                // ★ ここで射程の倍率と扇の角度を同期させる
                let rangeMult = 1;
                let fanAngle = 0.6; // スコーピオンのデフォルト

                if (isSenku) {
                    rangeMult = 3;
                    fanAngle = 1;
                } else if (isMantis) {
                    rangeMult = 2.5; // shootWithAngle で設定した値と同じにする
                    fanAngle = 0.3;  // shootWithAngle で設定した値と同じにする
                } else if (cfg.name === 'Kogetsu') {
                    fanAngle = 1;    // 弧月のデフォルト
                }

                ctx.beginPath();
                ctx.moveTo(this.x, this.y);

                // 【重要】設定された range (160など) × 倍率 で円弧を描く
                ctx.arc(this.x, this.y, cfg.range * rangeMult, this.angle - fanAngle, this.angle + fanAngle);
                ctx.lineTo(this.x, this.y);

                if (isSenku || isMantis) {
                    // 旋空用の特別演出：太い点線で表示
                    ctx.lineWidth = 5;
                    ctx.setLineDash([8, 8]);
                    ctx.stroke();

                    // 範囲内をうっすら光らせて「必殺技感」を出す
                    ctx.fillStyle = this.team === 'blue' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(244, 63, 94, 0.15)';
                    ctx.fill();
                } else {
                    // 通常時の近接インジケーター：少し太めの実線
                    ctx.lineWidth = 3;
                    ctx.setLineDash([]); // 点線を解除
                    ctx.stroke();
                }

            } else {
                // --- ガンナー・シューター・スナイパーの直線インジケーター ---

                // 自分のスナイパーならエイムを見やすくするために線を太く実線にする
                ctx.lineWidth = (this.isControlPlayer && cfg.name === 'Sniper') ? 3 : 2;

                if (cfg.name === 'Sniper') {
                    if (isEnemy) {
                        ctx.setLineDash([2, 2]); // 敵が狙ってきた殺気は細かい赤い点線
                    } else {
                        ctx.setLineDash([]); // 自分のスナイパー射線はくっきりした実線
                    }
                } else {
                    ctx.setLineDash([5, 5]); // ガンナーやシューターは普通の点線
                }

                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                // 設定値通りの長さで線を引く
                ctx.lineTo(this.x + Math.cos(this.angle) * cfg.range, this.y + Math.sin(this.angle) * cfg.range);
                ctx.stroke();
            }
            ctx.restore(); // 線の太さや点線の設定をリセット
        }

        // キャラクター本体の描画
        if (window.gameAssets) {
            let img = null; let flip = false;
            const isShowingAction = this.attackVisualTimer > 0;
            if (cfg.name === 'Scorpion') { img = isShowingAction ? window.gameAssets.kuga2 : window.gameAssets.kuga1; flip = isShowingAction ? !isRight : isRight; }
            else if (cfg.name === 'Kogetsu') { img = isShowingAction ? window.gameAssets.tachikawa2 : window.gameAssets.tachikawa1; flip = isShowingAction ? !isRight : isRight; }
            else if (cfg.name === 'Shooter') { img = isShowingAction ? window.gameAssets.osamu2 : window.gameAssets.osamu1; flip = isRight; }
            else if (cfg.name === 'Gunner') { img = isShowingAction ? window.gameAssets.inukai2 : window.gameAssets.inukai1; flip = isRight; }
            else if (cfg.name === 'Sniper') { img = isShowingAction ? window.gameAssets.chika2 : window.gameAssets.chika1; flip = isRight; }

            if (img && img.complete) {
                ctx.save();
                ctx.translate(this.x, this.y);
                if (flip) ctx.scale(-1, 1);
                ctx.drawImage(img, -16, -16, 32, 32);
                ctx.restore();
            } else this.drawPlace(ctx);
        } else this.drawPlace(ctx);

        ctx.restore(); // 【RESTORE 2】★ここで本体の透明度・フィルター設定をリセット！

        // HPバーの描画（透明にしないために、SAVE2の外で描く）
        if (!this.isBagworm || this.isControlPlayer) {
            const bw = 40, bh = 6, bx = this.x - bw / 2, by = this.y - this.size - 12;
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = this.team === 'blue' ? '#38bdf8' : '#f43f5e'; ctx.fillRect(bx, by, (this.hp / this.maxHp) * bw, bh);
        }

        ctx.restore(); // 【RESTORE 1】★最重要：描画状態をリセット
    }
    drawPlace(ctx) { ctx.fillStyle = this.config.color; ctx.fillRect(this.x - 14, this.y - 14, 28, 28); }
}


// class Bot extends Player {
//     constructor(x, y) { super(x, y); this.patrolTarget = null; this.thinkTimer = 0; this.reactionTimer = 0; }

//     updateAI(dt, map, enemies) {
//         // --- 1. ベイルアウト・死亡時の処理 ---
//         if (this.isDead || this.isBailingOut) {
//             this.isAttacking = false;
//             if (this.isBailingOut) {
//                 // 変数名を bailOutTimer (Oが大文字) に統一！
//                 this.bailOutTimer -= dt;
//                 if (this.bailOutTimer <= 0) {
//                     this.isDead = true;
//                 }
//                 this.update(dt, 0, 0, map, this.angle, false);
//             }
//             return; // 演出中は以降のAI思考（移動や攻撃）をさせない
//         }

//         let nearest = null; let minDist = Infinity;
//         for (const e of enemies) {
//             if (e.isDead || e.hp <= 0 || e.isBailingOut || e.isBagworm) continue;
//             const d = Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2);
//             if (d < minDist) { minDist = d; nearest = e; }
//         }

//         let moveX = 0, moveY = 0; let aiAngle = this.angle; this.isAttacking = false;

//         this.thinkTimer -= dt;
//         if (this.thinkTimer <= 0) {
//             // --- 思考タイミング（0.5〜1秒ごと）の処理 ---
//             this.thinkTimer = 0.5 + Math.random() * 0.5;

//             if (!nearest) {
//                 this.patrolTarget = { x: Math.random() * MAP_WIDTH * TILE_SIZE, y: Math.random() * MAP_HEIGHT * TILE_SIZE };
//                 this.isShieldingInput = false; // 敵がいなければシールド解除
//             } else {
//                 const dist = Math.sqrt((nearest.x - this.x) ** 2 + (nearest.y - this.y) ** 2);
//                 // ★シールド判定をここ（タイマー内）に移動！一度決めたら次の思考まで維持する
//                 if (this.hp < this.maxHp * 0.4 && dist < this.config.range) {
//                     this.isShieldingInput = Math.random() < 0.6;
//                 } else {
//                     this.isShieldingInput = false;
//                 }
//             }
//         }

//         if (nearest) {
//             const dx = nearest.x - this.x;
//             const dy = nearest.y - this.y;
//             const dist = Math.sqrt(dx * dx + dy * dy);
//             aiAngle = Math.atan2(dy, dx);

//             // 移動ロジック（ここは維持）
//             if (dist > this.config.range * 0.8) { moveX = dx / dist; moveY = dy / dist; }
//             else if (dist < this.config.range * 0.4) { moveX = -dx / dist; moveY = -dy / dist; }
//             else { moveX = (Math.random() - 0.5); moveY = (Math.random() - 0.5); }

//             const withinRange = dist < this.config.range;

//             // --- ここからが「駆け引き」を生む修正 ---
//             if (withinRange) {
//                 // // 1. 攻撃開始の判断：自分がシールドを張っていないなら狙い始める
//                 // if (!this.isAttacking && !this.isShieldingInput) {
//                 // 反応速度を 0.4〜0.8秒 に設定（ほどよい緊張感）
//                 if (this.reactionTimer <= 0) {
//                     this.reactionTimer = 0.4 + Math.random() * 0.4;
//                 }
//                 this.isAttacking = true;
//                 // }

//                 // 2. 相手がシールドを張っている時の挙動
//                 // if (this.isAttacking && nearest.isShielding) {
//                 //     // 0.005 (約0.5%) の確率で攻撃を辞める
//                 //     // 1秒間（60フレーム）撃ち続ける確率は約74%
//                 //     // つまり、平均3〜4秒はシールドの上からゴリ押ししてくるようになります！
//                 //     if (Math.random() < 0.005) {
//                 //         this.isAttacking = false;
//                 //         this.reactionTimer = 0;
//                 //     }
//                 // }
//             } else {
//                 // 射程外に出たらリセット
//                 this.isAttacking = false;
//                 this.reactionTimer = 0;
//             }
//         } else {
//             this.isAttacking = false;
//             this.reactionTimer = 0;
//         }

//         // 毎フレーム、タイマーを減らす
//         if (this.reactionTimer > 0) this.reactionTimer -= dt;

//         if (this.config.name === 'Sniper' && !nearest && !this.isBagworm && Math.random() < 0.01) this.toggleBagworm(true);

//         this.update(dt, moveX, moveY, map, aiAngle, this.isAttacking);
//     }

//     shootAI(enemies) {
//         // 1. そもそも死んでる、または攻撃態勢（isAttacking）でないなら撃たない
//         if (this.isDead || !this.isAttacking || this.reactionTimer > 0) return null;

//         // 2. ターゲットを特定（一番近い敵を狙っていると想定）
//         let target = null;
//         let minDist = Infinity;
//         for (const e of enemies) {
//             if (e.isDead || e.hp <= 0 || e.isBailingOut || e.isBagworm) continue;
//             if (e.isBagworm) {
//                 const dist = Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2);
//                 // ★ 150px以上離れていたら、レーダーにも映らず目視もできない
//                 if (dist > 150) continue;
//                 // 150px以内なら「目視」した判定になり、攻撃対象に入る
//             }
//             const d = Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2);
//             if (d < minDist) { minDist = d; target = e; }
//         }

//         // --- ★ ここが重要！ ---
//         // ターゲットがシールドを張っていても、関係なく撃たせる。
//         // ただし、スナイパーだけは「無駄撃ち」を嫌って少し慎重にする（原作再現）
//         if (target && target.isShielding) {
//             if (this.config.name === 'Sniper') {
//                 // スナイパーは30%の確率でしかシールドを撃たない
//                 if (Math.random() > 0.3) return null;
//             }
//             // ガンナーやシューターはシールドの上からでもガンガン撃ってくる！
//         }

//         return this.shoot();
//     }
// }


