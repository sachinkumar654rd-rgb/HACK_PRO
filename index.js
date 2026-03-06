const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { 
    getFirestore, doc, setDoc, getDocs, 
    collection, query, limit, getDoc 
} = require('firebase/firestore');

// --- Config ---
const BOT_TOKEN = '8778650117:AAHTh9KfXmiWHdNoBgyYsocF_7HYWT4HoqU';
const CHANNEL_ID = '-1003745287823'; 
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const APP_ID = "prediction-hpro-64253";
const RENDER_URL = "https://hack-pro.onrender.com"; 

const firebaseConfig = {
  apiKey: "AIzaSyD3d40JbKJWDv2c0OoHJ2oy6Uo0zMdD63o",
  authDomain: "prediction-64253.firebaseapp.com",
  projectId: "prediction-64253",
  storageBucket: "prediction-64253.firebasestorage.app",
  messagingSenderId: "26921730315",
  appId: "1:26921730315:web:216e1551fc97184498a20e"
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

/**
 * HIGH-LEVEL BYPASSING
 * यह अलग-अलग API गेटवे इस्तेमाल करेगा ताकि ब्लॉक न हो
 */
async function fetchGameDataSecurely() {
    const gateways = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(API_URL + "?pageSize=20")}`,
        `https://thingproxy.freeboard.io/fetch/${API_URL}?pageSize=20`,
        `https://cors-anywhere.herokuapp.com/${API_URL}?pageSize=20` // Note: Needs temporary access activation
    ];

    for (let url of gateways) {
        try {
            console.log(`Trying Gateway: ${url.substring(0, 30)}...`);
            const res = await axios.get(url, { timeout: 15000 });
            
            let rawData = res.data;
            // AllOrigins wraps data in .contents
            if (rawData.contents) rawData = JSON.parse(rawData.contents);
            
            if (rawData?.data?.list) {
                return rawData.data.list;
            }
        } catch (e) {
            console.log("Gateway failed, trying next...");
        }
    }
    return null;
}

async function syncTask() {
    const list = await fetchGameDataSecurely();
    if (list && list.length > 0) {
        for (let item of list) {
            const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'history', item.issueNumber);
            await setDoc(docRef, {
                issueNumber: item.issueNumber,
                number: parseInt(item.number),
                timestamp: Date.now()
            }, { merge: true });
        }
        console.log(`🔥 SUCCESS: Synced ${list[0].issueNumber}`);
        return list;
    }
    console.log("💀 CRITICAL: All Bypass Gateways Failed. Website is fully locked.");
    return null;
}

// Prediction Logic (L10 to L3)
async function getPrediction(seq) {
    const snap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'history')));
    let history = [];
    snap.forEach(d => history.push(d.data()));
    history.sort((a,b) => Number(b.issueNumber) - Number(a.issueNumber));
    const hNums = history.map(h => h.number);

    if (hNums.length < 3) return { res: "WAIT", lvl: 0, count: hNums.length };

    for (let L = 10; L >= 3; L--) {
        const pattern = seq.slice(0, L);
        for (let i = 1; i < hNums.length - L; i++) {
            let m = true;
            for (let j=0; j<L; j++) { if (hNums[i+j] !== pattern[j]) { m = false; break; } }
            if (m) return { res: hNums[i-1] >= 5 ? "BIG" : "SMALL", lvl: L, count: hNums.length };
        }
    }
    return { res: Math.random() > 0.5 ? "BIG" : "SMALL", lvl: "AI", count: hNums.length };
}

let lastDone = "";

async function mainLoop() {
    const list = await syncTask();
    if (!list) return;

    const top = list[0];
    const cur = top.issueNumber;
    const nxt = (BigInt(cur) + 1n).toString();

    const stRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const stSnap = await getDoc(stRef);

    if (stSnap.exists()) {
        const d = stSnap.data();
        if (d.issueNumber === cur && !d.done) {
            const act = parseInt(top.number) >= 5 ? "BIG" : "SMALL";
            const isW = d.prediction === act;
            const txt = `🆔 *Period:* \`#${cur.slice(-4)}\`\n🎲 *Pred:* ${d.prediction}\n🎯 *Res:* ${act} (${top.number})\n📊 *Status:* ${isW ? "✅ WIN" : "❌ LOSS"}\n✨ *Lvl:* L-${d.level}`;
            try { 
                await bot.telegram.editMessageText(CHANNEL_ID, d.msgId, null, txt, { parse_mode: 'Markdown' });
                await setDoc(stRef, { done: true }, { merge: true });
            } catch (e) {}
        }
    }

    if (lastDone !== cur) {
        lastDone = cur;
        const ai = await getPrediction(list.slice(0,10).map(x => parseInt(x.number)));
        const msg = `🎯 *HACK PRO V3*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${nxt.slice(-4)}\`\n🎲 *Prediction:* **${ai.res}**\n📊 *Match:* L-${ai.lvl}\n⏳ *Status:* Wait...\n━━━━━━━━━━━━━━\nRecords: \`${ai.count}\``;
        try {
            const s = await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: 'Markdown' });
            await setDoc(stRef, { issueNumber: nxt, prediction: ai.res, level: ai.lvl, msgId: s.message_id, done: false });
        } catch (e) {}
    }
}

const app = express();
app.get('/', (req, res) => res.send('Bypass System Active'));
app.listen(process.env.PORT || 3000, () => {
    setInterval(() => axios.get(RENDER_URL).catch(e => {}), 600000);
});

setInterval(mainLoop, 35000); 
mainLoop();

bot.launch({ dropPendingUpdates: true });
