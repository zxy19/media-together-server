import { MEDIA_STATE, Media } from "../../types/media-item";
import { DROP_THRESHOLD, LAGGING_THRESHOLD, LARGE_LAGGING_THRESHOLD, USE_SLOWER_SYNC } from "../../config/const";
import { MSG_TYPE } from "../../types/msg";
type roomMgrOps = {
    send(group: string, data: Record<string, any> | String, exceptConId?: number): void;
    sendPlayer(conId: number, data: Record<string, any> | String): void;
    on(type: string, room: string, cb: (from: number, data: Record<string, any>) => void): void;
    closePlayer(conId: number): void;
}
enum CTRMODE {
    SLOW = 0,
    PAUSE = 1,
    PLAY = 2
}
export default class Room {
    roomMgr: roomMgrOps
    id: string
    userId2Name: Record<number, string> = {}
    userId2WebId: Record<number, string> = {}
    userProgress: Record<number, number> = {}
    userControlMode: Record<number, CTRMODE> = {}
    lastResponse: Record<number, number> = {}
    pingVal: Record<number, number> = {}
    userCnt = 0
    mediaList: Media[] = []
    historyList: Media[] = []
    readyUsers: number[] = []
    index: number = 0
    tickSplit = 0
    isPlaying = false
    isLastNormal = true
    constructor(group: string, ops: roomMgrOps) {
        this.id = group;
        this.roomMgr = ops;
        ops.on("ready", this.id, this.onReady.bind(this));
        ops.on("addItem", this.id, this.onAddItem.bind(this));
        ops.on("remove", this.id, this.onRemoveItem.bind(this));
        ops.on("resume", this.id, this.onResumeItem.bind(this));
        ops.on("finish", this.id, this.onFinish.bind(this));
        ops.on("rep", this.id, this.onRep.bind(this));
        ops.on("seek", this.id, this.onSeek.bind(this));
        ops.on("removeHistory", this.id, this.onRemoveHistory.bind(this));
        ops.on("pullHistory", this.id, this.onPullHistory.bind(this));
        ops.on("pull", this.id, this.onPull.bind(this));
        ops.on("error", this.id, this.onError.bind(this));
        ops.on("pong", this.id, this.onPing.bind(this));
    }
    join(id: string, conId: number, name: string): boolean {
        if (this.userId2Name[conId]) return false;
        this.userId2Name[conId] = name;
        this.userId2WebId[conId] = id;
        this.lastResponse[conId] = (Date.now());
        this.userCnt++;
        let maxProgress = 0;
        Object.keys(this.userProgress).forEach((key) => {
            maxProgress = Math.max(maxProgress, this.userProgress[key]);
        })
        if (this.isPlaying) this.userControlMode[conId] = CTRMODE.PLAY;
        let curIndex = -1;
        if (this.mediaList.length > 0) {
            curIndex = this.mediaList[0].index;
        }
        setTimeout(() => {
            this.send({ type: "msg", from: "系统", msg: this.userId2Name[conId] + " 进入房间", theme: MSG_TYPE.INFO });
            this.sendPlayer(conId, {
                type: "initItems",
                medias: this.mediaList,
                history: this.historyList,
                index: curIndex,
                isPlaying: this.isPlaying,
                time: maxProgress
            });
        }, 100)
        return true;
    }
    leave(conId: number) {
        if (this.userId2Name[conId])
            this.send({ type: "msg", from: "系统", msg: this.userId2Name[conId] + " 离开房间", theme: MSG_TYPE.INFO });
        this.cleanConId(conId);
    }
    cleanConId(uid: number) {
        if (this.userId2Name[uid]) {
            this.userCnt--;
            delete this.userId2Name[uid];
        }
        if (this.userControlMode[uid]) delete this.userControlMode[uid];
        if (this.userProgress[uid]) delete this.userProgress[uid];
        if (this.userId2WebId[uid]) delete this.userId2WebId[uid];
        if (this.lastResponse[uid]) delete this.lastResponse[uid];
        if (this.pingVal[uid]) delete this.pingVal[uid];
        if (this.readyUsers.includes(uid)) {
            this.readyUsers = this.readyUsers.filter((item) => item != uid);
        }
        if (this.isPlaying && this.userCnt == this.readyUsers.length && this.readyUsers.length > 0 && this.mediaList.length > 0) {
            this.onReady(this.readyUsers[0], {});
        }
    }
    onPing(conId: number, data: Record<string, any>) {
        this.lastResponse[conId] = (Date.now());
        this.pingVal[conId] = (Date.now()) - data.stamp;
    }
    tick() {
        this.tickSplit++;
        if (this.tickSplit % 10 == 0) {
            this.send({ type: "ping", stamp: (Date.now()) });
        }
        if (this.tickSplit > 20) {
            this.tickSplit = 0;
            this.largeTick();
        }
        if (this.mediaList.length > 0 && (this.mediaList[0].state == MEDIA_STATE.REMOVED || this.mediaList[0].state == MEDIA_STATE.ENDED)) {
            while (this.mediaList.length > 0 && (this.mediaList[0].state == MEDIA_STATE.REMOVED || this.mediaList[0].state == MEDIA_STATE.ENDED)) {
                if (this.mediaList[0].state == MEDIA_STATE.ENDED) {
                    this.historyList.push(this.mediaList[0]);
                    this.send({ type: "addHistory", media: this.mediaList[0] });
                }
                console.log("删除项目:" + this.mediaList[0].index);
                this.mediaList.shift();
                this.isPlaying = false;
            }
            if (this.mediaList.length != 0) {
                this.startPlay();
            } else if (this.historyList.length) {
                // const idx = Math.floor(Math.random() * this.historyList.length);
                const idx = 0;
                let item = this.historyList[idx];
                this.historyList.splice(idx, 1);
                this.send({ type: "pickHistory", index: item.index });

                item.index = this.index++;
                item.state = MEDIA_STATE.WAITING;
                this.mediaList.push(item);
                this.send({ type: "addItem", media: item });
                this.startPlay();
            } else {
                this.send({ type: "changeIndex", index: -1 });
            }
        }
        if (this.mediaList.length == 0) return;
        let MinProgress = -1;
        let MaxProgress = 0;
        Object.keys(this.userId2Name).forEach((uid) => {
            if (this.userProgress[uid] < MinProgress || MinProgress == -1) {
                MinProgress = this.userProgress[uid];
            }
            if (this.userProgress[uid] > MaxProgress) {
                MaxProgress = this.userProgress[uid];
            }
        });
        let currentNormal = true;
        let slowerUsers: string[] = [];
        Object.keys(this.userId2Name).forEach((uid) => {
            if (this.userProgress[uid] <= MaxProgress - LARGE_LAGGING_THRESHOLD) {
                slowerUsers.push(this.userId2Name[uid]);
            } else if (USE_SLOWER_SYNC && this.userProgress[uid] <= MaxProgress - LAGGING_THRESHOLD) {
                slowerUsers.push(this.userId2Name[uid]);
            }
            let tmpNormalState = false;
            if (this.userProgress[uid] > MinProgress + LARGE_LAGGING_THRESHOLD) {
                this.userControlMode[uid] = CTRMODE.PAUSE;
                this.sendPlayer(parseInt(uid), { type: "pause", index: this.mediaList[0].index });
            } else if (this.userProgress[uid] > MinProgress + LAGGING_THRESHOLD) {
                if (USE_SLOWER_SYNC) {
                    if (this.userControlMode[uid] == CTRMODE.PAUSE) {
                        this.sendPlayer(parseInt(uid), { type: "play", index: this.mediaList[0].index });
                    }
                    this.userControlMode[uid] = CTRMODE.SLOW;
                    this.sendPlayer(parseInt(uid), { type: "slow", slower: true, index: this.mediaList[0].index });
                } else tmpNormalState = true;
            } else {
                tmpNormalState = true;
                if (this.userControlMode[uid] == CTRMODE.SLOW) {
                    this.sendPlayer(parseInt(uid), { type: "slow", slower: false, index: this.mediaList[0].index });
                } else if (this.userControlMode[uid] == CTRMODE.PAUSE) {
                    this.sendPlayer(parseInt(uid), { type: "play", index: this.mediaList[0].index });
                }
                this.userControlMode[uid] = CTRMODE.PLAY;
            }
            currentNormal = currentNormal && tmpNormalState;
            if (this.tickSplit == 0) {
                //大tick，发送实际状态用于同步
                this.sendPlayer(parseInt(uid), {
                    type: "status",
                    index: this.mediaList[0].index,
                    control: this.userControlMode[uid],
                })
            }
        });
        if (currentNormal != this.isLastNormal) {
            this.isLastNormal = currentNormal;
            if (!currentNormal) {
                this.send({ type: "msg", from: "播控", msg: slowerUsers.join(",") + "的进度异常（落后" + (MaxProgress - MinProgress).toFixed(0) + "ms），正在调节以同步进度", theme: MSG_TYPE.WARNING });
            } else {
                this.send({ type: "msg", from: "播控", msg: "进度同步完成", theme: MSG_TYPE.INFO });
            }
        }
    }
    largeTick() {
        Object.keys(this.userId2Name).filter((uid) => {
            console.log(this.lastResponse[uid] + " " + DROP_THRESHOLD + " " + (Date.now()));
            return this.lastResponse[uid] + DROP_THRESHOLD < (Date.now());
        }).forEach((uid) => {//用户掉线
            if (this.userId2Name[uid])
                this.send({ type: "msg", from: "系统", msg: this.userId2Name[uid] + "Ping超时，已踢出", theme: MSG_TYPE.WARNING });
            this.roomMgr.closePlayer(parseInt(uid));
            this.cleanConId(parseInt(uid));
        })
        const dat = Object.keys(this.userId2Name).map((uid) => {
            return {
                name: this.userId2Name[uid],
                id: uid,
                webId: this.userId2WebId[uid],
                progress: this.userProgress[uid],
                ping: this.pingVal[uid],
            }
        });

        this.send({ type: "users", data: dat });
    }
    send(msg: string | Object) {
        this.roomMgr.send(this.id, msg);
    }
    sendPlayer(conId: number, msg: string | Object) {
        this.roomMgr.sendPlayer(conId, msg);
    }

    onAddItem(conId: number, data: Record<string, any>) {
        let media: Media = {
            url: data.media.url,
            index: this.index++,
            name: data.media.name,
            type: data.media.type,
            from: this.userId2Name[conId],
            state: MEDIA_STATE.WAITING
        }
        this.mediaList.push(media);
        this.send({ type: "addItem", media: media });
        this.send({ type: "msg", from: "队列", msg: this.userId2Name[conId] + " 添加项目" + "[" + media.index + "]" + media.name, theme: MSG_TYPE.SUCCESS });
        if (this.mediaList.length == 1) {
            this.startPlay();
        }
    }
    onRemoveItem(conId: number, data: Record<string, any>) {
        let retItem: Media | null = null;
        this.mediaList = this.mediaList.map((item) => {
            if (item.index == data.index) {
                if (item.state != MEDIA_STATE.REMOVED) {
                    this.send({ type: "msg", from: "队列", msg: this.userId2Name[conId] + "删除了" + "[" + item.index + "]" + item.name, theme: MSG_TYPE.INFO });
                }
                item.state = MEDIA_STATE.REMOVED;
                retItem = item;
            }
            return item;
        });
        if (!retItem) return;
        this.send({ type: "updateItem", media: retItem });
    }
    onRemoveHistory(conId: number, data: Record<string, any>) {
        let item = this.historyList.find((item) => {
            return item.index == data.index;
        })
        if (!item) return
        this.historyList = this.historyList.filter((item) => {
            return item.index != data.index;
        })
        this.send({ type: "pickHistory", index: data.index });
        this.send({ type: "msg", from: "队列", msg: this.userId2Name[conId] + "删除了历史记录" + "[" + item.index + "]" + item.name, theme: MSG_TYPE.INFO });
    }
    onError(conId: number, data: Record<string, any>) {
        this.mediaList = this.mediaList.map((item) => {
            if (item.index == data.index) {
                if (item.state != MEDIA_STATE.REMOVED) {
                    this.send({ type: "msg", from: "播控", msg: this.userId2Name[conId] + "报告播放失败，即将跳过", theme: MSG_TYPE.WARNING });
                }
                item.state = MEDIA_STATE.REMOVED;
                this.send({ type: "updateItem", media: item });
            }
            return item;
        });
    }
    onResumeItem(conId: number, data: Record<string, any>) {
        let retItem: Media | null = null;
        this.mediaList = this.mediaList.map((item) => {
            if (item.index == data.index) {
                item.state = MEDIA_STATE.WAITING;
                retItem = item;
            }
            return item;
        });
        if (!retItem) return;
        this.send({ type: "updateItem", media: retItem });
        this.send({ type: "msg", from: "队列", msg: this.userId2Name[conId] + " 恢复了 " + "[" + retItem.index + "]" + retItem.name, theme: MSG_TYPE.INFO });
    }
    onFinish(conId: number, data: Record<string, any>) {
        this.mediaList = this.mediaList.map((item) => {
            if (item.index == data.index) {
                if (item.state != MEDIA_STATE.ENDED)
                    this.send({ type: "msg", from: "播控", msg: this.userId2Name[conId] + "报告完播/切换到下一个媒体", theme: MSG_TYPE.INFO });
                item.state = MEDIA_STATE.ENDED;
            }
            return item;
        });
    }
    startPlay() {
        this.isPlaying = true;
        this.readyUsers = [];
        this.send({ type: "changeIndex", index: this.mediaList[0].index });
        this.send({ type: "msg", from: "播控", msg: "当前媒体切换到=>[" + this.mediaList[0].index + "]" + this.mediaList[0].name, theme: MSG_TYPE.INFO });
    }

    onReady(conId: number, data: Record<string, any>) {
        if (!this.readyUsers.includes(conId)) {
            this.readyUsers.push(conId);
        }
        if (this.readyUsers.length == this.userCnt) {
            //用户重置播放进度
            Object.keys(this.userId2Name).forEach((uid) => {
                this.userControlMode[uid] = CTRMODE.PLAY;
                this.userProgress[uid] = 0;
            })
            this.mediaList[0].state = MEDIA_STATE.PLAYING;

            this.send({ type: "updateItem", media: this.mediaList[0] });
            this.send({ type: "play", index: this.mediaList[0].index });
        }
    }
    onRep(conId: number, data: Record<string, any>) {
        if (!this.userId2Name[conId]) return;
        //用户上报播放进度
        this.userProgress[conId] = data.p;
    }
    onSeek(conId: number, data: Record<string, any>) {
        this.send({ type: "seekTo", p: data.p, index: data.index });
        if (this.userId2Name[conId])
            this.send({ type: "msg", from: "播控", msg: this.userId2Name[conId] + "将当前媒体快进到 => " + data.p + "s", theme: MSG_TYPE.INFO });
    }
    onPull(conId: number, data: Record<string, any>) {
        if (data.index == this.mediaList[0].index) return;
        let newList = this.mediaList.filter((item) => {
            return item.index != data.index;
        });
        let pullList = this.mediaList.filter((item) => {
            return item.index == data.index;
        })
        this.mediaList = [];

        pullList.forEach((item) => {
            item.index = this.index++;
            this.mediaList.push(item);
        });
        newList.forEach((item) => {
            item.index = this.index++;
            this.mediaList.push(item);
        })
        this.send({ type: "addItems", medias: this.mediaList });
        this.startPlay();
        if (this.userId2Name[conId])
            this.send({ type: "msg", from: "播控", msg: this.userId2Name[conId] + "插队，当前媒体切换到=>[" + this.mediaList[0].index + "]" + this.mediaList[0].name, theme: MSG_TYPE.INFO });

    }
    onPullHistory(conId: number, data: Record<string, any>) {
        let historyItem = this.historyList.find((item) => {
            return item.index == data.index;
        })
        if (!historyItem) return;
        this.historyList = this.historyList.filter((item) => {
            return item.index != data.index;
        })
        this.send({ type: "pickHistory", index: data.index });
        let newList = Object.assign([], this.mediaList);
        historyItem.index = this.index++;
        historyItem.state = MEDIA_STATE.WAITING;
        this.mediaList = [historyItem];
        newList.forEach((item) => {
            item.index = this.index++;
            this.mediaList.push(item);
        })
        this.send({ type: "addItems", medias: this.mediaList });
        this.startPlay();
        if (this.userId2Name[conId])
            this.send({ type: "msg", from: "播控", msg: this.userId2Name[conId] + "插队，当前媒体切换到=>[" + this.mediaList[0].index + "]" + this.mediaList[0].name, theme: MSG_TYPE.INFO });
    }
}