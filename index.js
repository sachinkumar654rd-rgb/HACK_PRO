const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { 
    getFirestore, doc, setDoc, getDocs, 
    collection, query, limit, getDoc 
} = require('firebase/firestore');

// --- नई कॉन्फ़िगरेशन (New Config) ---
const BOT_TOKEN = '8778650117:AAHTh9KfXmiWHdNoBgyYsocF_7HYWT4HoqU';
const CHANNEL_ID = '-1003745287823'; 
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const APP_ID = "prediction-hpro-64253"; // Unique ID for your new Firebase project
const RENDER_URL = "https://hack-pro.onrender.com"; 

const firebaseConfig = {
  apiKey: "AIzaSyD3d40JbKJWDv2c0OoHJ2oy6Uo0zMdD63o",
  authDomain: "prediction-64253.firebaseapp.com",
  projectId: "prediction-64253",
  storageBucket: "prediction-64253.firebasestorage.app",
  messagingSenderId: "26921730315",
  appId: "1:26921730315:web:216e1551fc97184498a20e",
  measurementId: "G-8XBPKFWPMN"
};

// इनिशियलाइजेशन
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

// ब्राउज़र जैसे हेडर्स (Anti-Sync Error)
const stealthHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://draw.ar-lottery01.com/',
    'Origin': 'https://draw.ar-lottery01.com'
};

/**
 * गेम डेटा सिंक और स्टोर करना
 */
async function syncGameData() {
    try {
        const res = await axios.get(`${API_URL}?pageSize=50&_t=${Date.now()}`, { headers: stealthHeaders, timeout: 15000 });
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
            console.log(`✅ Data Synced: ${list[0].issueNumber}`);
            return list;
        }
    } catch (err) {
        console.error("⚠️ Sync Error:", err.message);
    }
    return null;
}

/**
 * AI प्रेडिक्शन (L10 -> L3 पैटर्न)
 */
async function calculatePrediction(currentSeq) {
    const colRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'history');
    const snapshot = await getDocs(query(colRef));
    let history = [];
    snapshot.forEach(d => history.push(d.data()));
    
    // इश्यू नंबर के आधार पर सॉर्ट करें
    history.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));
    const hNums = history.map(h => h.number);

    if (hNums.length < 5) return { result: "WAIT", level: 0, count: hNums.length };

    // पैटर्न मैचिंग शुरू
    for (let L = 10; L >= 3; L--) {
        const pattern = currentSeq.slice(0, L);
        for (let i = 1; i < hNums.length - L; i++) {
            let match = true;
            for (let j = 0; j < L; j++) { if (hNums[i+j] !== pattern[j]) { match = false; break; } }
            if (match) return { result: hNums[i-1] >= 5 ? "BIG" : "SMALL", level: L, count: hNums.length };
        }
    }
    // रैंडम अगर डेटा मैच न हो
    return { result: Math.random() > 0.5 ? "BIG" : "SMALL", level: "AI", count: hNums.length };
}

let lastID = "";

/**
 * ऑटोमेशन लूप
 */
async function automationTask() {
    const list = await syncGameData();
    if (!list) return;

    const latest = list[0];
    const currentIssue = latest.issueNumber;
    const nextIssue = (BigInt(currentIssue) + 1n).toString();

    const stateRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const stateSnap = await getDoc(stateRef);

    // 1. पिछला रिज़ल्ट अपडेट करना
    if (stateSnap.exists()) {
        const data = stateSnap.data();
        if (data.issueNumber === currentIssue && !data.completed) {
            const actualSize = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
            const win = data.prediction === actualSize;
            const emoji = win ? "✅ WIN" : "❌ LOSS";

            const resultText = `🎯 *RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${currentIssue.slice(-4)}\`\n🎲 *Prediction:* ${data.prediction}\n🎯 *Result:* ${actualSize} (${latest.number})\n📊 *Status:* ${emoji}\n✨ *Matched:* L-${data.level}`;
            
            try {
                await bot.telegram.editMessageText(CHANNEL_ID, data.msgId, null, resultText, { parse_mode: 'Markdown' });
                await setDoc(stateRef, { completed: true }, { merge: true });
            } catch (e) { console.log("Edit fail (maybe msg deleted)"); }
        }
    }

    // 2. नया प्रेडिक्शन भेजना
    if (lastID !== currentIssue) {
        lastID = currentIssue;
        const currentSeq = list.slice(0, 10).map(x => parseInt(x.number));
        const ai = await calculatePrediction(currentSeq);

        const msgText = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction:* **${ai.result}**\n📊 *Match:* L-${ai.level}\n⏳ *Status:* Waiting Result...\n━━━━━━━━━━━━━━\nTotal Scanned: \`${ai.count}\``;

        try {
            const sent = await bot.telegram.sendMessage(CHANNEL_ID, msgText, { parse_mode: 'Markdown' });
            await setDoc(stateRef, {
                issueNumber: nextIssue,
                prediction: ai.result,
                level: ai.level,
                msgId: sent.message_id,
                completed: false
            });
        } catch (e) { console.error("Post error (Check if bot is admin)"); }
    }
}

// एक्सप्रेस सर्वर (Render को जगाए रखने के लिए)
const app = express();
app.get('/', (req, res) => res.send('HACK PRO v3 System Online'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server live on port ${PORT}`);
    setInterval(() => {
        axios.get(RENDER_URL).catch(e => {});
    }, 600000); // 10 min ping
});

// लूप इंटरवल
setInterval(automationTask, 30000); 
automationTask();

// बोट स्टार्ट
bot.launch({ dropPendingUpdates: true });
console.log("🔥 AI Hack Pro v3 started successfully!");

// Graceful stops
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
