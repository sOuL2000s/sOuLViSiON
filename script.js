// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;
let notes = [];
let musicList = [];
let currentTrackIndex = 0;
let audioPlayer = new Audio();
let isMusicPlaying = false;

// --- NAVIGATION ---
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo(0, 0);
}

// --- AUTH LOGIC ---
let isLoginMode = true;
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('authTitle').innerText = isLoginMode ? 'Login to sOuLViSiON' : 'Register for sOuLViSiON';
    document.getElementById('authToggle').innerText = isLoginMode ? "Don't have an account? Register" : "Already have an account? Login";
}

async function handleAuth() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    if (!email || !pass) return alert("Fill all fields");

    const mode = isLoginMode ? 'login' : 'register';
    const name = email.split('@')[0];

    try {
        const response = await fetch(`/api/main?route=auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass, name, mode })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Authentication failed");

        currentUser = data;
        localStorage.setItem('soulUser', JSON.stringify(currentUser));
        updateAuthUI();
        syncNotes(); // Fetch user's notes immediately after login
        showPage('home');
    } catch (err) {
        alert(err.message);
    }
}

function updateAuthUI() {
    if (currentUser) {
        document.getElementById('userNameDisplay').innerText = `Hey, ${currentUser.name}`;
        document.getElementById('authBtn').innerText = 'Logout';
        document.getElementById('authBtn').onclick = logout;
        if(currentUser.isAdmin) document.getElementById('adminBtn').classList.remove('hidden');
    } else {
        document.getElementById('userNameDisplay').innerText = '';
        document.getElementById('authBtn').innerText = 'Login';
        document.getElementById('authBtn').onclick = () => showPage('login');
        document.getElementById('adminBtn').classList.add('hidden');
    }
}

function logout() {
    currentUser = null;
    notes = [];
    renderNotes();
    localStorage.removeItem('soulUser');
    updateAuthUI();
    showPage('login');
}

// --- NOTES LOGIC ---
async function addNote() {
    if (!currentUser) return alert("Login to save notes!");
    const input = document.getElementById('noteInput');
    if (!input.value) return;
    const note = { id: Date.now(), text: input.value, userId: currentUser.email };
    
    const success = await saveNotesToDB(note);
    if (success) {
        notes.push(note);
        renderNotes();
        input.value = '';
    }
}

function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = notes.map(n => `
        <div class="glass p-5 rounded-xl border border-white/5 flex flex-col justify-between">
            <p class="text-gray-200 mb-4">${n.text}</p>
            <div class="flex justify-between items-center text-xs text-gray-500">
                <span>${new Date(n.id).toLocaleDateString()}</span>
                <button onclick="deleteNote(${n.id})" class="text-red-400 hover:text-red-300"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `).join('');
}

function deleteNote(id) {
    notes = notes.filter(n => n.id !== id);
    renderNotes();
}

async function syncNotes() {
    if(!currentUser) return alert("Login to sync notes!");
    const res = await fetch(`/api/main?route=notes&userId=${currentUser.email}`);
    const data = await res.json();
    if(Array.isArray(data)) {
        notes = data;
        renderNotes();
    }
}

async function saveNotesToDB(note) {
    if(!currentUser) return false;
    try {
        const res = await fetch('/api/main?route=notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
        });
        return res.ok;
    } catch (e) {
        console.error("Failed to save note", e);
        return false;
    }
}

// --- RANDOMIZER LOGIC ---
function genRandomNum() {
    const min = parseInt(document.getElementById('randMin').value);
    const max = parseInt(document.getElementById('randMax').value);
    const res = Math.floor(Math.random() * (max - min + 1)) + min;
    document.getElementById('numResult').innerText = res;
}

function genRandomColor() {
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
    document.getElementById('colorPreview').style.backgroundColor = color;
    document.getElementById('colorHex').innerText = color.toUpperCase();
}

function pickRandom() {
    const raw = document.getElementById('randChoices').value;
    const choices = raw.split(',').map(c => c.trim()).filter(c => c);
    if(!choices.length) return;
    const res = choices[Math.floor(Math.random() * choices.length)];
    document.getElementById('choiceResult').innerText = res;
}

// --- MUSIC PLAYER LOGIC ---
function loadMusic(e) {
    const files = Array.from(e.target.files);
    musicList = files.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));
    if(musicList.length > 0) playTrack(0);
}

function playTrack(index) {
    currentTrackIndex = index;
    const track = musicList[index];
    audioPlayer.src = track.url;
    document.getElementById('trackName').innerText = track.name;
    document.getElementById('artistName').innerText = "Local Track";
    audioPlayer.play();
    isMusicPlaying = true;
    updateMusicUI();
}

function toggleMusic() {
    if(!audioPlayer.src) return;
    if(isMusicPlaying) audioPlayer.pause();
    else audioPlayer.play();
    isMusicPlaying = !isMusicPlaying;
    updateMusicUI();
}

function musicNext() {
    if(musicList.length === 0) return;
    playTrack((currentTrackIndex + 1) % musicList.length);
}

function musicPrev() {
    if(musicList.length === 0) return;
    playTrack((currentTrackIndex - 1 + musicList.length) % musicList.length);
}

function updateMusicUI() {
    const btn = document.getElementById('playPauseBtn');
    const disk = document.getElementById('vinylDisk');
    btn.innerHTML = isMusicPlaying ? '<i class="fas fa-pause-circle text-5xl text-cyan-400"></i>' : '<i class="fas fa-play-circle text-5xl"></i>';
    isMusicPlaying ? disk.classList.add('rotating') : disk.classList.remove('rotating');
}

// --- AI LOGIC (Key Rotation) ---
async function loadConfig() {
    const res = await fetch('/api/main?route=admin_config');
    const data = await res.json();
    if(data) {
        aiConfig.keys = data.keys || [];
        aiConfig.models = data.models || [];
        updateAIUI();
        document.getElementById('statKeys').innerText = aiConfig.keys.length;
        document.getElementById('statModels').innerText = aiConfig.models.length;
        document.getElementById('apiKeys').value = aiConfig.keys.join(', ');
        document.getElementById('modelList').value = JSON.stringify(aiConfig.models);
    }
}

function updateAIUI() {
    const select = document.getElementById('modelSelect');
    if(select) select.innerHTML = aiConfig.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

async function askAI() {
    const inputEl = document.getElementById('chatInput');
    const input = inputEl.value;
    const chatBox = document.getElementById('chatBox');
    if(!input) return;
    chatBox.innerHTML += `<div class="message user-msg">User: ${input}</div>`;
    inputEl.value = '';
    await callGeminiAPI(input, chatBox);
}

async function callGeminiAPI(text, displayBox, msgClass = '') {
    const modelSelect = document.getElementById('modelSelect');
    const model = (modelSelect && modelSelect.value) ? modelSelect.value : (aiConfig.models[0]?.id || "gemini-pro");
    if(!aiConfig.keys.length) return alert("System Error: No API Keys configured.");

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: text }] }] })
        });
        
        const data = await response.json();
        if (data.error) throw new Error("Key Failed or Rate Limited");

        const aiText = data.candidates[0].content.parts[0].text;
        displayBox.innerHTML += `<div class="message ai-msg ${msgClass}">${aiText}</div>`;
        displayBox.scrollTop = displayBox.scrollHeight;
    } catch (err) {
        console.warn(`Key ${currentKeyIndex} failed. Rotating...`);
        currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
        if(currentKeyIndex === 0) return alert("All API Keys are currently exhausted.");
        await callGeminiAPI(text, displayBox, msgClass);
    }
}

function clearChat() { document.getElementById('chatBox').innerHTML = ''; }

// --- MINI CHAT ---
function toggleMiniChat() { document.getElementById('miniChat').classList.toggle('show'); }
async function askMiniAI() {
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    if(!inputEl.value) return;
    box.innerHTML += `<div class="message user-msg text-xs">${inputEl.value}</div>`;
    const txt = inputEl.value;
    inputEl.value = '';
    await callGeminiAPI(txt, box, 'text-xs');
}

// --- FUN PAGE LOGIC ---
let clickCount = 0;
let clickTime = 10;
let clickActive = false;
function startClicker() {
    if(clickActive) { clickCount++; document.getElementById('clickCounter').innerText = clickCount; return; }
    clickActive = true; clickCount = 1; clickTime = 10;
    document.getElementById('clickCounter').innerText = "1";
    const interval = setInterval(() => {
        clickTime--;
        document.getElementById('clickTimer').innerText = clickTime + "s remaining";
        if(clickTime <= 0) {
            clearInterval(interval);
            clickActive = false;
            alert(`Time's up! Your CPS: ${clickCount/10}`);
        }
    }, 1000);
}

function shakeBall() {
    const answers = ["Yes", "No", "Maybe", "Outlook good", "Ask again later", "Very doubtful", "Absolutely"];
    document.getElementById('ballResponse').innerText = answers[Math.floor(Math.random()*answers.length)];
}

// --- CRICKET LOGIC ---
let cRuns = 0; let cWickets = 0; let cBalls = 0;
function playCricket() {
    if(cWickets >= 10 || cBalls >= 6) return alert("Innings Over!");
    const outcomes = [0, 1, 2, 3, 4, 6, 'W'];
    const res = outcomes[Math.floor(Math.random() * outcomes.length)];
    cBalls++;
    const hist = document.getElementById('cricketHistory');
    
    if (res === 'W') {
        cWickets++;
        hist.innerHTML += `<span class="bg-red-600 w-8 h-8 rounded-full flex items-center justify-center text-xs">W</span>`;
        document.getElementById('status').innerText = "OUT! Batter returns to pavilion.";
    } else {
        cRuns += res;
        hist.innerHTML += `<span class="bg-gray-700 w-8 h-8 rounded-full flex items-center justify-center text-xs">${res}</span>`;
        document.getElementById('status').innerText = `Nice shot! ${res} runs.`;
    }
    
    document.getElementById('score').innerText = `${cRuns}/${cWickets}`;
    document.getElementById('overs').innerText = `${Math.floor(cBalls/6)}.${cBalls%6} (1.0)`;
}

function resetCricket() {
    cRuns = 0; cWickets = 0; cBalls = 0;
    document.getElementById('score').innerText = "0/0";
    document.getElementById('overs').innerText = "0.0 (1.0)";
    document.getElementById('cricketHistory').innerHTML = "";
    document.getElementById('status').innerText = "Ready to Bat!";
}

// --- SUPPORT & RAZORPAY ---
async function payNow() {
    const amount = document.getElementById('donAmount').value;
    const remark = document.getElementById('donRemark').value;
    const options = {
        "key": "rzp_live_RuDJUlLd5GCYqf", 
        "amount": amount * 100,
        "currency": "INR",
        "name": "sOuLViSiON Support",
        "description": remark,
        "handler": async function (response){
            alert("Payment Successful!");
            await fetch('/api/main?route=feedback', {
                method: 'POST',
                body: JSON.stringify({ name: currentUser?.name || 'Anonymous', amount, remark })
            });
            loadFeedbacks();
        },
        "theme": { "color": "#06b6d4" }
    };
    new Razorpay(options).open();
}

async function loadFeedbacks() {
    const res = await fetch('/api/main?route=feedback');
    const data = await res.json();
    if(Array.isArray(data)) {
        document.getElementById('feedbackWall').innerHTML = data.map(f => `
            <div class="bg-white/5 p-4 rounded-xl border-l-4 border-cyan-500">
                <p class="font-bold text-cyan-400">${f.name} <span class="text-xs text-gray-500 font-normal">donated ₹${f.amount}</span></p>
                <p class="text-sm italic">"${f.remark}"</p>
            </div>
        `).join('');
    }
}

// --- ADMIN ---
async function saveAdminConfig() {
    const keys = document.getElementById('apiKeys').value.split(',').map(k => k.trim());
    const models = JSON.parse(document.getElementById('modelList').value);
    const res = await fetch('/api/main?route=admin_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ai_settings', keys, models })
    });
    if(res.ok) { alert("Config Updated!"); loadConfig(); }
}

// --- INIT ---
window.onload = () => {
    updateAuthUI();
    if (currentUser) syncNotes();
    loadConfig();
    loadFeedbacks();
    document.getElementById('aiWidget').onclick = toggleMiniChat;
};