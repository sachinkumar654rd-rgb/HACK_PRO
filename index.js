const { Telegraf, Input } = require('telegraf');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { 
    getFirestore, doc, setDoc, getDocs, 
    collection, query, limit, getDoc, orderBy 
} = require('firebase/firestore');

// --- Config ---
const BOT_TOKEN = '8778650117:AAHTh9KfXmiWHdNoBgyYsocF_7HYWT4HoqU';
const CHANNEL_ID = '-1003745287823'; 
const APP_ID = "prediction-hpro-64253";

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
 * 🛰️ DATA FETCHING (Hybrid Source)
 */
async function syncData() {
    // Attempt 1: Proxy for ar-lottery
    try {
        const url = `https://api.allorigins.win/get?url=${encodeURIComponent("https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=20")}`;
        const res = await axios.get(url, { timeout: 15000 });
        const data = JSON.parse(res.data.contents);
        if (data?.data?.list) return data.data.list;
    } catch (e) { console.log("Source 1 Failed"); }

    // Attempt 2: Tiranga Alternative
    try {
        const res = await axios.post("https://api.tirangagames.com/api/webapi/GetNoaverageEmerdList", {
            pageSize: 20, pageNo: 1, typeid: 1, language: 0
        }, { timeout: 10000 });
        if (res.data?.data?.list) return res.data.data.list;
    } catch (e) { console.log("Source 2 Failed"); }

    return null;
}

/**
 * 🧠 ADVANCED MATCHING LOGIC
 */
async function getPredictionWithReference(latestNums) {
    try {
        const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', 'history'));
        let history = [];
        snap.forEach(d => history.push(d.data()));
        
        if (history.length < 20) return { r: "WAIT", l: 0, dbSize: history.length, mP: "Wait for Data" };

        history.sort((a, b) => Number(b.period) - Number(a.period));
        const hNums = history.map(h => h.number);
        const hPeriods = history.map(h => h.period);

        for (let L = 10; L >= 2; L--) {
            const pattern = latestNums.slice(0, L);
            for (let i = 1; i < hNums.length - L; i++) {
                let match = true;
                for (let j = 0; j < L; j++) {
                    if (hNums[i + j] !== pattern[j]) { match = false; break; }
                }

                if (match) {
                    const predictedNum = hNums[i - 1];
                    const matchedAtPeriod = hPeriods[i + L - 1]; 
                    return {
                        r: predictedNum >= 5 ? "BIG" : "SMALL",
                        l: L,
                        dbSize: hNums.length,
                        mP: matchedAtPeriod 
                    };
                }
            }
        }
        return { r: Math.random() > 0.5 ? "BIG" : "SMALL", l: "AI", dbSize: hNums.length, mP: "Deep Scan" };
    } catch (err) {
        return { r: "SMALL", l: "ERR", dbSize: 0, mP: "Error" };
    }
}

// --- BOT LOOPS ---
let lastProcessedPeriod = "";

async function mainTask() {
    console.log("Checking for updates...");
    const list = await syncData();
    if (!list || list.length === 0) return console.log("Data not available yet.");

    const top = list[0];
    const curP = (top.issueNumber || top.period).toString();
    const nxtP = (BigInt(curP) + 1n).toString();

    // Sync to DB
    for (let item of list.slice(0, 10)) {
        const id = (item.issueNumber || item.period).toString();
        const num = parseInt(item.number || item.result);
        await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'history', id), {
            period: id, number: num, time: Date.now()
        }, { merge: true });
    }

    const stateRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const stateSnap = await getDoc(stateRef);

    // Update Last Result
    if (stateSnap.exists()) {
        const d = stateSnap.data();
        if (d.issueNumber === curP && !d.done) {
            const actNum = parseInt(top.number || top.result);
            const actSz = actNum >= 5 ? "BIG" : "SMALL";
            const updateMsg = `🎯 *RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${curP.slice(-4)}\`\n🎲 *Pred:* ${d.prediction}\n🎯 *Res:* ${actSz} (${actNum})\n📊 *Status:* ${d.prediction === actSz ? "✅ WIN" : "❌ LOSS"}\n✨ *Based on:* \`#${d.mP.toString().slice(-4)}\` (L-${d.level})`;
            try {
                await bot.telegram.editMessageText(CHANNEL_ID, d.msgId, null, updateMsg, { parse_mode: 'Markdown' });
                await setDoc(stateRef, { done: true }, { merge: true });
            } catch (e) { console.log("Edit failed"); }
        }
    }

    // New Prediction
    if (lastProcessedPeriod !== curP) {
        lastProcessedPeriod = curP;
        const seq = list.slice(0, 10).map(x => parseInt(x.number || x.result));
        const ai = await getPredictionWithReference(seq);

        const msg = `🎯 *HACK BRO PRO*\n━━━━━━━━━━━━━━\n🆔 *Next:* \`#${nxtP.slice(-4)}\`\n🎲 *Prediction:* **${ai.r}**\n📊 *Match:* L-${ai.l}\n🔍 *Based on:* \`#${ai.mP.toString().slice(-4)}\` \n━━━━━━━━━━━━━━\nDB Size: \`${ai.dbSize}\``;

        try {
            const s = await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: 'Markdown' });
            await setDoc(stateRef, {
                issueNumber: nxtP,
                prediction: ai.r,
                level: ai.l,
                msgId: s.message_id,
                mP: ai.mP,
                done: false
            });
            console.log("New Prediction Sent: " + nxtP);
        } catch (e) { console.log("Send failed"); }
    }
}

bot.command('history', async (ctx) => {
    const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', 'history'));
    let hList = [];
    snap.forEach(d => hList.push(d.data()));
    hList.sort((a,b) => Number(b.period) - Number(a.period));
    let txt = hList.slice(0, 20).map(h => `${h.period}: ${h.number} (${h.number >= 5 ? 'B' : 'S'})`).join('\n');
    ctx.reply("Latest 20 Records:\n" + txt);
});

const app = express();
app.get('/', (req, res) => res.send('System Working'));
app.listen(process.env.PORT || 3000);

setInterval(mainTask, 25000);
mainTask();
bot.launch();
