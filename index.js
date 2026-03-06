const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { 
    getFirestore, doc, setDoc, getDocs, 
    collection, query, limit, getDoc 
} = require('firebase/firestore');

// --- नई कॉन्फ़िगरेशन ---
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
 * Proxy-Based API Fetching (Anti-Block)
 * अगर डायरेक्ट रिक्वेस्ट फेल होती है, तो यह अलग-अलग प्रॉक्सी ट्राई करेगा
 */
async function fetchWithRetry() {
    // असली मोबाइल ब्राउज़र जैसे हेडर्स
    const config = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://draw.ar-lottery01.com/',
            'Origin': 'https://draw.ar-lottery01.com',
            'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 10000
    };

    try {
        // प्रयास 1: डायरेक्ट रिक्वेस्ट
        const res = await axios.get(`${API_URL}?pageSize=30&_t=${Date.now()}`, config);
        if (res.data?.data?.list) return res.data.data.list;
    } catch (e) {
        console.log("Direct Fetch Failed, trying alternative...");
    }

    try {
        // प्रयास 2: प्रॉक्सी गेटवे (AllOrigins) - यह IP ब्लॉक को बाईपास करता है
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(API_URL + "?pageSize=30")}`;
        const res = await axios.get(proxyUrl);
        const parsedData = JSON.parse(res.data.contents);
        if (parsedData?.data?.list) return parsedData.data.list;
    } catch (e) {
        console.log("Proxy Fetch Failed.");
    }

    return null;
}

async function syncAndStore() {
    const list = await fetchWithRetry();
    if (list) {
        for (let item of list) {
            const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'history', item.issueNumber);
            await setDoc(docRef, {
                issueNumber: item.issueNumber,
                number: parseInt(item.number),
                timestamp: Date.now()
            }, { merge: true });
        }
        console.log(`✅ Success: Synced Issue ${list[0].issueNumber}`);
        return list;
    }
    console.log("❌ Sync Still Failing. Website might be down or heavily protected.");
    return null;
}

// AI प्रेडिक्शन लॉजिक (L10 -> L3)
async function getAIPrediction(currentSeq) {
    const colRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'history');
    const snapshot = await getDocs(query(colRef));
    let history = [];
    snapshot.forEach(d => history.push(d.data()));
    history.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));
    const hNums = history.map(h => h.number);

    if (hNums.length < 5) return { result: "WAIT", level: 0, count: hNums.length };

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

let lastID = "";

async function automation() {
    const list = await syncAndStore();
    if (!list) return;

    const latest = list[0];
    const currentIssue = latest.issueNumber;
    const nextIssue = (BigInt(currentIssue) + 1n).toString();

    const stateRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const stateSnap = await getDoc(stateRef);

    if (stateSnap.exists()) {
        const data = stateSnap.data();
        if (data.issueNumber === currentIssue && !data.completed) {
            const actual = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
            const win = data.prediction === actual;
            const text = `🎯 *RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${currentIssue.slice(-4)}\`\n🎲 *Pred:* ${data.prediction}\n🎯 *Res:* ${actual} (${latest.number})\n📊 *Status:* ${win ? "✅ WIN" : "❌ LOSS"}\n✨ *Lvl:* L-${data.level}`;
            try { 
                await bot.telegram.editMessageText(CHANNEL_ID, data.msgId, null, text, { parse_mode: 'Markdown' });
                await setDoc(stateRef, { completed: true }, { merge: true });
            } catch (e) {}
        }
    }

    if (lastID !== currentIssue) {
        lastID = currentIssue;
        const ai = await getAIPrediction(list.slice(0, 10).map(x => parseInt(x.number)));
        const msgText = `🎯 *AI HACK PRO*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction:* **${ai.result}**\n📊 *Match:* L-${ai.level}\n⏳ *Status:* Waiting...\n━━━━━━━━━━━━━━\nDB Size: \`${ai.count}\``;
        try {
            const sent = await bot.telegram.sendMessage(CHANNEL_ID, msgText, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { issueNumber: nextIssue, prediction: ai.result, level: ai.level, msgId: sent.message_id, completed: false });
        } catch (e) {}
    }
}

// Server for Render
const app = express();
app.get('/', (req, res) => res.send('System Online'));
app.listen(process.env.PORT || 3000, () => {
    setInterval(() => axios.get(RENDER_URL).catch(e => {}), 600000);
});

setInterval(automation, 30000); 
automation();

bot.launch({ dropPendingUpdates: true });
