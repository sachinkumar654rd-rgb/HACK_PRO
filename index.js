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
const ALT_API_URL = "https://api.tirangagames.com/api/webapi/GetNoaverageEmerdList"; 

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
 * डेटा फेचिंग
 */
async function syncData() {
    try {
        const res = await axios.post(ALT_API_URL, {
            pageSize: 20, pageNo: 1, typeid: 1, language: 0
        }, { timeout: 10000 });
        if (res.data?.data?.list) return res.data.data.list;
    } catch (e) { return null; }
}

/**
 * एडवांस्ड सीक्वेंस मैचिंग विथ पीरियड रेफरेंस
 */
async function getPredictionWithReference(latestNums) {
    const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', 'history'));
    let history = [];
    snap.forEach(d => history.push(d.data()));
    
    // ताज़ा डेटा पहले
    history.sort((a, b) => Number(b.period) - Number(a.period));
    
    const hNums = history.map(h => h.number);
    const hPeriods = history.map(h => h.period);

    if (hNums.length < 15) return { r: "WAIT", l: 0, dbSize: hNums.length, mP: "N/A" };

    // L10 से L2 तक स्कैन
    for (let L = 10; L >= 2; L--) {
        const pattern = latestNums.slice(0, L);
        
        for (let i = 1; i < hNums.length - L; i++) {
            let match = true;
            for (let j = 0; j < L; j++) {
                if (hNums[i + j] !== pattern[j]) {
                    match = false;
                    break;
                }
            }

            // अगर पैटर्न मिला
            if (match) {
                const predictedNum = hNums[i - 1];
                const matchedAtPeriod = hPeriods[i + L - 1]; // वह पीरियड जहाँ से पैटर्न शुरू हुआ
                
                return {
                    r: predictedNum >= 5 ? "BIG" : "SMALL",
                    l: L,
                    dbSize: hNums.length,
                    mP: matchedAtPeriod // मैच हुआ पीरियड नंबर
                };
            }
        }
    }

    return { r: Math.random() > 0.5 ? "BIG" : "SMALL", l: "AI", dbSize: hNums.length, mP: "Random Scan" };
}

// --- COMMANDS ---

bot.command('history', async (ctx) => {
    try {
        const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', 'history'));
        let history = [];
        snap.forEach(d => history.push(d.data()));
        history.sort((a, b) => Number(b.period) - Number(a.period));

        let fileContent = "🆔 PERIOD | 🎯 RESULT | 📊 SIZE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        history.forEach(h => {
            const size = h.number >= 5 ? "BIG" : "SMALL";
            fileContent += `${h.period}  |    ${h.number}     |  ${size}\n`;
        });

        const fileName = `history_${Date.now()}.txt`;
        fs.writeFileSync(fileName, fileContent);
        await ctx.replyWithDocument(Input.fromLocalFile(fileName, 'Full_History.txt'), {
            caption: `📊 Total Records: ${history.length}`
        });
        fs.unlinkSync(fileName);
    } catch (e) { ctx.reply("❌ History fetch error."); }
});

// --- MAIN LOOP ---
let lastP = "";

async function taskLoop() {
    const list = await syncData();
    if (!list) return;

    const top = list[0];
    const cur = top.issueNumber || top.period;
    const nxt = (BigInt(cur) + 1n).toString();

    // Firebase Sync
    for (let item of list.slice(0, 5)) {
        const id = item.issueNumber || item.period;
        const num = item.number || item.result;
        await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'history', id), {
            period: id, number: parseInt(num), time: Date.now()
        }, { merge: true });
    }

    const stRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const stSnap = await getDoc(stRef);

    // Edit Last Message with Result
    if (stSnap.exists()) {
        const d = stSnap.data();
        if (d.issueNumber === cur && !d.done) {
            const actNum = parseInt(top.number || top.result);
            const actSz = actNum >= 5 ? "BIG" : "SMALL";
            const updateMsg = `🎯 *RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${cur.slice(-4)}\`\n🎲 *Pred:* ${d.prediction}\n🎯 *Res:* ${actSz} (${actNum})\n📊 *Status:* ${d.prediction === actSz ? "✅ WIN" : "❌ LOSS"}\n✨ *Matched Period:* \`#${d.mP.slice(-4) || 'N/A'}\` (L-${d.level})`;
            try {
                await bot.telegram.editMessageText(CHANNEL_ID, d.msgId, null, updateMsg, { parse_mode: 'Markdown' });
                await setDoc(stRef, { done: true }, { merge: true });
            } catch (e) {}
        }
    }

    // New Prediction
    if (lastP !== cur) {
        lastP = cur;
        const seq = list.slice(0, 10).map(x => parseInt(x.number || x.result));
        const ai = await getPredictionWithReference(seq);

        const msg = `🎯 *HACK BRO PRO*\n━━━━━━━━━━━━━━\n🆔 *Next Period:* \`#${nxt.slice(-4)}\`\n🎲 *Prediction:* **${ai.r}**\n📊 *Match:* L-${ai.l}\n🔍 *Based on Period:* \`#${ai.mP.toString().slice(-4)}\` \n━━━━━━━━━━━━━━\nDB Scanned: \`${ai.dbSize}\``;

        try {
            const s = await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: 'Markdown' });
            await setDoc(stRef, {
                issueNumber: nxt,
                prediction: ai.r,
                level: ai.l,
                msgId: s.message_id,
                mP: ai.mP,
                done: false
            });
        } catch (e) {}
    }
}

const app = express();
app.get('/', (req, res) => res.send('AI History Reference Engine Running'));
app.listen(process.env.PORT || 3000);

setInterval(taskLoop, 30000);
taskLoop();
bot.launch();
