import roommgr from "./modules/roommgr";
import WSS from "./modules/wss";
const { readFileSync } = require('fs');
let cfg: { cert: any, key: any } | undefined = undefined;
try {
    cfg = {
        "cert": readFileSync("../ssl/fullchain.pem"),
        "key": readFileSync("../ssl/privkey.pem")
    };
} catch (e) { }
const wss = new WSS(19982, cfg);
const roomMgr = new roommgr(wss);