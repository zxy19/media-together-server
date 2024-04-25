import Room from "../gameroom";
import WSS from "../../modules/wss";

export default class {
    wss: WSS
    grpConns: Record<string, number[]> = {};
    grpData: Record<string, { meta: Record<string, any>, data: Record<string, any> }> = {};
    conId2Grp: Record<number, string> = {};
    conId2Meta: Record<number, { id: string }> = {};
    gameRooms: Record<number, Room> = {};
    hasRegedEvent: Record<string, boolean> = {};
    roomEvents: Record<string, { id: string, events: ((from: number, data: Record<string, any>) => void)[] }[]> = {};
    constructor(wss: WSS) {
        this.wss = wss;
        this.grpConns = {};
        this.grpData = {};
        this.conId2Grp = {};
        this.conId2Meta = {};
        wss.on("connect", (conId) => {
            this.conId2Grp[conId] = "";
        });
        wss.on("reg", this.onReg.bind(this))
        wss.on("leave", this.onLeave.bind(this))
        wss.on("close", this.onLeave.bind(this))

        setInterval(this.tick.bind(this), 250);
    }
    on(type: string, room: string, cb: (from: number, data: Record<string, any>) => void) {
        if (!this.hasRegedEvent[type]) {
            this.roomEvents[type] = []
            this.wss.on(type, (conId, data) => {
                this.roomEvents[type].forEach((event) => {
                    if (this.conId2Grp[conId] == event.id) {
                        event.events.forEach((cb) => {
                            cb(conId, data);
                        })
                    }
                })
            });
            this.hasRegedEvent[type] = true;
        }
        if (!this.roomEvents[type]) this.roomEvents[type] = [];
        for (let i = 0; i < this.roomEvents[type].length; i++) {
            if (this.roomEvents[type][i].id == room) {
                this.roomEvents[type][i].events.push(cb);
                return;
            }
        }
        this.roomEvents[type].push({ id: room, events: [cb] });
    }
    //房间注册
    onReg(conId: number, dat: Record<string, any>) {
        this.conId2Meta[conId] = { id: dat.id };
        if (!this.gameRooms[dat.group]) {
            this.gameRooms[dat.group] = new Room(dat.group, {
                on: this.on.bind(this),
                send: this.send.bind(this),
                sendPlayer: this.sendPlayer.bind(this),
                closePlayer: this.closePlayer.bind(this),
            });
            console.log("[ROOM]创建:" + dat.group);
            this.grpConns[dat.group] = [];
        }
        if (this.gameRooms[dat.group].join(dat.id, conId, dat.name)) {
            this.conId2Grp[conId] = dat.group;
            this.grpConns[dat.group].push(conId);
        } else {
            this.wss.send(conId, { type: "error", msg: "该房间当前不可加入，请稍后再试" });
        }
    }

    //房间广播
    send(group: string, data: Record<string, any> | String, exceptConId?: number) {
        if (!this.grpConns[group]) return;
        let toSendData: string;
        if (typeof data == "string") {
            toSendData = data;
        } else {
            toSendData = JSON.stringify(data);
        }
        for (let conId of this.grpConns[group]) {
            if (conId == exceptConId) continue;
            this.wss.send(conId, toSendData);
        }
    }
    //玩家消息
    sendPlayer(conId: number, data: Record<string, any> | String) {
        this.wss.send(conId, data);
    }
    closePlayer(conId: number) {
        this.wss.close(conId);
    }

    onLeave(conId: number, data: Record<string, any>) {
        if (this.conId2Grp[conId]) {
            let findId = this.grpConns[this.conId2Grp[conId]].indexOf(conId);
            if (findId != -1) {
                this.grpConns[this.conId2Grp[conId]].splice(findId, 1);
                if (this.grpConns[this.conId2Grp[conId]].length == 0) {
                    // 如果房间内没有人，则删除房间
                    delete this.grpConns[this.conId2Grp[conId]];
                    delete this.gameRooms[this.conId2Grp[conId]];
                    Object.keys(this.roomEvents).forEach((type) => {
                        this.roomEvents[type] = this.roomEvents[type].filter((event) => {
                            if (event.id == this.conId2Grp[conId]) return false;
                            return true;
                        })
                    })
                    console.log("[ROOM]销毁:" + this.conId2Grp[conId]);
                } else {
                    this.gameRooms[this.conId2Grp[conId]].leave(conId);
                }
            }
            delete this.conId2Grp[conId];
            delete this.conId2Meta[conId];
        }
    }

    tick() {
        for (let room in this.gameRooms) {
            this.gameRooms[room].tick();
        }
    }
}
