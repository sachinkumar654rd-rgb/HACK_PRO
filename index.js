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
const APP_ID = "ai-bot-render-v1";
const RENDER_URL = "https://your-app-name.onrender.com"; // Render पर डिप्लॉय के बाद इसे बदलें

const firebaseConfig = {
  apiKey: "AIzaSyD3d40JbKJWDv2c0OoHJ2oy6Uo0zMdD63o",
  authDomain: "prediction-64253.firebaseapp.com",
  projectId: "prediction-64253",
  storageBucket: "prediction-64253.firebasestorage.app",
  messagingSenderId: "26921730315",
  appId: "1:26921730315:web:216e1551fc97184498a20e",
  measurementId: "G-8XBPKFWPMN"
};
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Referer': 'https://draw.ar-lottery01.com/'
    },
    timeout: 20000
};

// --- Core Logic ---
async function syncData() {
    try {
        const res = await axios.get(`${API_URL}?pageSize=50&_t=${Date.now()}`, axiosConfig);
        if (res.data?.data?.list) {
            const list = res.data.data.list;
            for (let item of list) {
                const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'history', item.issueNumber);
                await setDoc(docRef, {
                    issueNumber: item.issueNumber,
                    number: parseInt(item.number),
                    timestamp: Date.now()
                }, { merge: true });
            }
            return list;
        }
    } catch (err) { console.error("Sync Error"); }
    return null;
}

async function getAIPrediction(currentSeq) {
    const colRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'history');
    const snapshot = await getDocs(query(colRef));
    let history = [];
    snapshot.forEach(d => history.push(d.data()));
    history.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));
    const hNums = history.map(h => h.number);

    if (hNums.length < 10) return { result: "WAIT", level: 0, count: hNums.length };

    for (let L = 10; L >= 3; L--) {
        const pattern = currentSeq.slice(0, L);
        for (let i = 1; i < hNums.length - L; i++) {
            let match = true;
            for (let j = 0; j < L; j++) { if (hNums[i+j] !== pattern[j]) { match = false; break; } }
            if (match) return { result: hNums[i-1] >= 5 ? "BIG" : "SMALL", level: L, count: hNums.length };
        }
    }
    return { result: Math.random() > 0.5 ? "BIG" : "SMALL", level: "AI", count: hNums.length };
}

let lastProcessed = "";

async function automation() {
    const list = await syncData();
    if (!list) return;

    const latest = list[0];
    const currentIssue = latest.issueNumber;
    const nextIssue = (BigInt(currentIssue) + 1n).toString();

    // Result Update
    const stateRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const stateSnap = await getDoc(stateRef);
    if (stateSnap.exists()) {
        const data = stateSnap.data();
        if (data.issueNumber === currentIssue && !data.done) {
            const actual = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
            const isWin = data.prediction === actual;
            const text = `🆔 *Period:* \`#${currentIssue.slice(-4)}\`\n🎲 *Pred:* ${data.prediction}\n🎯 *Res:* ${actual} (${latest.number})\n📊 *Status:* ${isWin ? "✅ WIN" : "❌ LOSS"}\n✨ *Level:* L-${data.level}`;
            try { 
                await bot.telegram.editMessageText(CHANNEL_ID, data.msgId, null, text, { parse_mode: 'Markdown' });
                await setDoc(stateRef, { done: true }, { merge: true });
            } catch (e) {}
        }
    }

    // New Prediction
    if (lastProcessed !== currentIssue) {
        lastProcessed = currentIssue;
        const ai = await getAIPrediction(list.slice(0, 10).map(x => parseInt(x.number)));
        const msgText = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction:* **${ai.result}**\n📊 *Match:* L-${ai.level}\n⏳ *Result:* Waiting...\n━━━━━━━━━━━━━━\nDB Size: \`${ai.count}\``;
        try {
            const sent = await bot.telegram.sendMessage(CHANNEL_ID, msgText, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { issueNumber: nextIssue, prediction: ai.result, level: ai.level, msgId: sent.message_id, done: false });
        } catch (e) {}
    }
}

// --- Express Server (Required for Render) ---
const app = express();
app.get('/', (req, res) => res.send('Bot is Alive!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Self-ping every 10 minutes to stay awake
    setInterval(() => {
        axios.get(RENDER_URL).catch(() => {});
    }, 600000);
});

setInterval(automation, 30000);
bot.launch({ dropPendingUpdates: true });
