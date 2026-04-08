// NetworkManager.js

class NetworkManager {
    constructor() {
        this.peer = null;           // PeerJSの本体
        this.connections = [];      // つながっている相手のリスト
        this.isHost = false;        // 自分がホストかどうか
        this.myId = null;           // 自分のID

        // Game.js に「データが届いたよ！」と知らせるためのコールバック関数
        this.onDataReceived = null;
    }

    // ==========================================
    // 1. 接続の準備（ホスト・ゲスト共通）
    // ==========================================

    // ホストとして部屋を作る（引数なしならランダムな合言葉になる）
    hostRoom(roomId = null) {
        this.isHost = true;
        this.peer = new Peer(roomId);

        this.peer.on('open', (id) => {
            this.myId = id;
            console.log(`部屋を作成しました！合言葉は: ${id}`);
            if (this.onRoomCreated) this.onRoomCreated(id);
        });

        // ゲストが入ってきた時の処理
        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });
    }

    // ゲストとして部屋に入る
    joinRoom(hostId) {
        this.isHost = false;
        this.peer = new Peer();

        this.peer.on('open', (id) => {
            this.myId = id;
            // ホストに接続を要求する
            const conn = this.peer.connect(hostId);
            this.setupConnection(conn);
        });
    }

    // ==========================================
    // 2. 通信パイプの確立とデータ受信
    // ==========================================

    setupConnection(conn) {
        this.connections.push(conn);

        conn.on('open', () => {
            console.log(`${conn.peer} と接続しました！`);
            if (this.onConnectionEstablished) this.onConnectionEstablished();
        });

        // 相手からデータが送られてきた時！
        conn.on('data', (data) => {
            // Game.jsにデータを横流しする
            if (this.onDataReceived) {
                this.onDataReceived(data);
            }

            // 【超重要】自分がホストなら、受け取ったデータを他の全員にも配り直す（中継）
            if (this.isHost) {
                this.broadcast(data, conn.peer); // 送り主以外に配る
            }
        });
    }

    // ==========================================
    // 3. データの送信（アクション）
    // ==========================================

    // Game.jsから呼ばれる送信メソッド
    sendData(actionType, payload) {
        const data = {
            senderId: this.myId,
            type: actionType,    // 例: 'MOVE', 'SHOOT', 'DAMAGE'
            payload: payload     // 例: { x: 100, y: 200, angle: 1.5 }
        };

        if (this.isHost) {
            // 自分がホストなら、全員に配る
            this.broadcast(data);
        } else {
            // 自分がゲストなら、ホスト（[0]番目の通信相手）にだけ送る
            if (this.connections.length > 0) {
                this.connections[0].send(data);
            }
        }
    }

    // 全員にデータを配る（ホスト専用機能）
    broadcast(data, excludeId = null) {
        for (const conn of this.connections) {
            if (conn.peer !== excludeId) {
                conn.send(data);
            }
        }
    }
}