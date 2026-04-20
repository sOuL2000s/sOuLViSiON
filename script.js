// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;
let notes = [];
let aiConversations = JSON.parse(localStorage.getItem('soulAI_convs')) || [];
let currentChatId = null;
let musicList = [];
let currentTrackIndex = 0;
let audioPlayer = new Audio();
let isMusicPlaying = false;

// --- MARKDOWN & MATH INIT ---
function renderMD(text) {
    const raw = marked.parse(text);
    const div = document.createElement('div');
    div.innerHTML = raw;
    renderMathInElement(div, {
        delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
        ],
        throwOnError : false
    });
    return div.innerHTML;
}

// --- GLOBAL ENTER KEY LISTENER ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        const active = document.activeElement;
        if (active.tagName === 'TEXTAREA') return; // Don't submit on Enter in textareas
        if (active.id === 'authPass' || active.id === 'authEmail') handleAuth();
        if (active.id === 'chatInput') askAI();
        if (active.id === 'miniChatInput') askMiniAI();
        if (active.id === 'donAmount' || active.id === 'donRemark') payNow();
    }
});

// Markdown Helper
function wrapText(elId, before, after) {
    const el = document.getElementById(elId);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const selected = text.substring(start, end);
    el.value = text.substring(0, start) + before + selected + after + text.substring(end);
    el.focus();
    el.selectionStart = start + before.length;
    el.selectionEnd = end + before.length;
    if (elId === 'editNoteText') {
        document.getElementById('notePreview').innerHTML = renderMD(el.value);
    }
}

// Smart Bullets for Note Input
document.addEventListener('input', (e) => {
    if (e.target.id === 'noteInput' || e.target.id === 'editNoteText') {
        const val = e.target.value;
        const lastChar = val[val.length - 1];
        if (lastChar === '\n') {
            const lines = val.split('\n');
            const prevLine = lines[lines.length - 2];
            if (prevLine.trim().startsWith('- ')) e.target.value += '- ';
            if (prevLine.trim().startsWith('* ')) e.target.value += '* ';
            if (prevLine.trim().match(/^\d+\. /)) {
                const num = parseInt(prevLine.match(/^\d+/)[0]);
                e.target.value += `${num + 1}. `;
            }
        }
        if (e.target.id === 'editNoteText') {
            document.getElementById('notePreview').innerHTML = renderMD(e.target.value);
        }
    }
});

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
    if (!input.value.trim()) return;
    const note = { id: Date.now(), text: input.value, userId: currentUser.email };
    
    notes.unshift(note);
    renderNotes();
    input.value = '';
    await saveNotesToDB(note);
}

function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = notes.map(n => `
        <div class="glass p-5 rounded-xl border border-white/5 flex flex-col justify-between group">
            <div class="prose prose-invert prose-sm max-h-48 overflow-hidden mb-4">
                ${renderMD(n.text)}
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 pt-4 border-t border-white/5">
                <span>${new Date(n.id).toLocaleDateString()}</span>
                <div class="flex gap-3">
                    <button onclick="openNote(${n.id})" class="text-cyan-400 opacity-0 group-hover:opacity-100 transition"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteNote(${n.id})" class="text-red-400 hover:text-red-300"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        </div>
    `).join('');
}

function openNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    document.getElementById('editNoteId').value = id;
    document.getElementById('editNoteText').value = note.text;
    document.getElementById('notePreview').innerHTML = renderMD(note.text);
    document.getElementById('noteModal').classList.remove('hidden');
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.add('hidden');
}

async function saveEditedNote() {
    const id = parseInt(document.getElementById('editNoteId').value);
    const text = document.getElementById('editNoteText').value;
    const noteIdx = notes.findIndex(n => n.id === id);
    if (noteIdx > -1) {
        notes[noteIdx].text = text;
        renderNotes();
        closeNoteModal();
        await fetch(`/api/main?route=notes&id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
    }
}

async function deleteNote(id) {
    notes = notes.filter(n => n.id !== id);
    renderNotes();
    await fetch(`/api/main?route=notes&id=${id}`, { method: 'DELETE' });
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
        aiConfig.miniChatModel = data.miniChatModel || "gemini-1.5-flash";
        updateAIUI();
        document.getElementById('statKeys').innerText = aiConfig.keys.length;
        document.getElementById('statModels').innerText = aiConfig.models.length;
        document.getElementById('apiKeys').value = aiConfig.keys.join(', ');
        document.getElementById('modelList').value = JSON.stringify(aiConfig.models);
        document.getElementById('miniChatModelId').value = aiConfig.miniChatModel;
    }
}

function updateAIUI() {
    const select = document.getElementById('modelSelect');
    if(select) select.innerHTML = aiConfig.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

// --- AI LOGIC (Key Rotation + History) ---
function newConversation() {
    currentChatId = Date.now();
    aiConversations.unshift({ id: currentChatId, name: "New Conversation", messages: [] });
    saveAIHistory();
    renderAIHistory();
    loadConversation(currentChatId);
}

function loadConversation(id) {
    currentChatId = id;
    const conv = aiConversations.find(c => c.id === id);
    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('currentConvName').innerText = conv.name;
    conv.messages.forEach(m => appendAIMessage(m.role, m.content));
    renderAIHistory();
}

function renderAIHistory() {
    const list = document.getElementById('chatHistoryList');
    list.innerHTML = aiConversations.map(c => `
        <div class="flex items-center gap-1 group">
            <div onclick="loadConversation(${c.id})" class="flex-grow p-3 rounded-xl cursor-pointer transition text-xs truncate ${c.id === currentChatId ? 'bg-purple-600/30 border border-purple-500' : 'hover:bg-white/5'}">
                <i class="fas fa-comment-alt mr-2 opacity-50"></i> ${c.name}
            </div>
            <div class="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition pr-1">
                <button onclick="renameConversation(${c.id})" class="text-[10px] text-gray-400 hover:text-cyan-400"><i class="fas fa-pen"></i></button>
                <button onclick="deleteConversation(${c.id})" class="text-[10px] text-gray-400 hover:text-red-400"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `).join('');
}

function renameConversation(id) {
    const conv = aiConversations.find(c => c.id === id);
    const newName = prompt("Enter new name for conversation:", conv.name);
    if (newName) {
        conv.name = newName;
        saveAIHistory();
        renderAIHistory();
        if (id === currentChatId) document.getElementById('currentConvName').innerText = newName;
    }
}

function deleteConversation(id) {
    if (!confirm("Are you sure you want to delete this conversation?")) return;
    aiConversations = aiConversations.filter(c => c.id !== id);
    saveAIHistory();
    if (currentChatId === id) {
        currentChatId = null;
        document.getElementById('chatBox').innerHTML = '';
        document.getElementById('currentConvName').innerText = 'Untitled Chat';
    }
    renderAIHistory();
}

function appendAIMessage(role, content, targetBoxId = 'chatBox') {
    const box = document.getElementById(targetBoxId);
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'} relative group`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = "markdown-body";
    contentDiv.innerHTML = renderMD(content);
    
    if (role === 'ai') {
        const copyBtn = document.createElement('button');
        copyBtn.className = "absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition text-xs bg-white/10 p-1 rounded hover:bg-white/20";
        copyBtn.innerHTML = '<i class="far fa-copy"></i>';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(content);
            copyBtn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => copyBtn.innerHTML = '<i class="far fa-copy"></i>', 2000);
        };
        msgDiv.appendChild(copyBtn);
    }

    msgDiv.appendChild(contentDiv);
    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

async function askAI() {
    const inputEl = document.getElementById('chatInput');
    const input = inputEl.value;
    if(!input.trim()) return;
    if(!currentChatId) newConversation();
    
    appendAIMessage('user', input, 'chatBox');
    inputEl.value = '';

    const conv = aiConversations.find(c => c.id === currentChatId);
    if(conv.messages.length === 0) conv.name = input.substring(0, 20) + "...";
    conv.messages.push({ role: 'user', content: input });

    await callGeminiAPI(input, 'chatBox');
    saveAIHistory();
}

async function callGeminiAPI(text, targetBoxId = 'chatBox') {
    let model = "gemini-1.5-flash";
    if (targetBoxId === 'miniChatBox') {
        model = aiConfig.miniChatModel || (aiConfig.models[0]?.id || "gemini-1.5-flash");
    } else {
        const modelSelect = document.getElementById('modelSelect');
        model = (modelSelect && modelSelect.value) ? modelSelect.value : (aiConfig.models[0]?.id || "gemini-1.5-flash");
    }
    
    if(!aiConfig.keys.length) return alert("Please configure API Keys in Admin panel.");

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: text }] }] })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const aiText = data.candidates[0].content.parts[0].text;
        appendAIMessage('ai', aiText, targetBoxId);
        
        // Only save history if it's the dedicated chat
        if (targetBoxId === 'chatBox' && currentChatId) {
            aiConversations.find(c => c.id === currentChatId).messages.push({ role: 'ai', content: aiText });
            saveAIHistory();
        }
    } catch (err) {
        console.warn(`Key Index ${currentKeyIndex} failed: ${err.message}. Rotating...`);
        currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
        if(currentKeyIndex === 0) return alert("All API keys exhausted.");
        await callGeminiAPI(text, targetBoxId);
    }
}

function saveAIHistory() {
    localStorage.setItem('soulAI_convs', JSON.stringify(aiConversations.slice(0, 50)));
}

function clearChat() { document.getElementById('chatBox').innerHTML = ''; }

// --- MINI CHAT ---
function toggleMiniChat() { document.getElementById('miniChat').classList.toggle('show'); }
async function askMiniAI() {
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    if(!inputEl.value.trim()) return;
    
    const txt = inputEl.value;
    appendAIMessage('user', txt, 'miniChatBox');
    inputEl.value = '';
    
    await callGeminiAPI(txt, 'miniChatBox');
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
let match = {
    teams: [],
    currentInnings: 0,
    maxOvers: 1,
    target: null,
    isOver: false,
    strikerIdx: 0,
    nonStrikerIdx: 1,
    bowlerIdx: -1
};

function parsePlayers(raw) {
    return raw.split('\n').filter(l => l.trim()).map(l => {
        const [name, type] = l.split('/');
        return {
            name: name?.trim() || 'Player',
            type: type?.trim() || 'Batsman',
            runs: 0, balls: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, isOut: false
        };
    });
}

function selectBowler() {
    const bowlingTeam = match.teams[match.currentInnings === 0 ? 1 : 0];
    const priorities = { 'Bowler': 1, 'Bowling AR': 2, 'Batting AR': 3, 'Wicketkeeper': 4, 'Batsman': 5 };
    
    const playersWithIdx = bowlingTeam.players.map((p, idx) => ({ ...p, idx }));
    let available = playersWithIdx.filter(p => (priorities[p.type] || 5) <= 3);
    
    if (available.length === 0) available = playersWithIdx;

    available.sort((a, b) => {
        const pA = priorities[a.type] || 5;
        const pB = priorities[b.type] || 5;
        return pA - pB || a.ballsBowled - b.ballsBowled;
    });
    
    const next = available.find(p => p.idx !== match.bowlerIdx) || available[0];
    match.bowlerIdx = next ? next.idx : 0;
    return next;
}

function startMatch() {
    const tA = document.getElementById('teamAName').value;
    const tB = document.getElementById('teamBName').value;
    
    match.maxOvers = parseInt(document.getElementById('cricketOversSelect').value);
    match.teams = [
        { name: tA, players: parsePlayers(document.getElementById('teamAPlayers').value), score: 0, wickets: 0, balls: 0, history: [] },
        { name: tB, players: parsePlayers(document.getElementById('teamBPlayers').value), score: 0, wickets: 0, balls: 0, history: [] }
    ];
    match.currentInnings = 0;
    match.target = null;
    match.isOver = false;
    match.strikerIdx = 0;
    match.nonStrikerIdx = 1;
    selectBowler();

    document.getElementById('cricketSetup').classList.add('hidden');
    document.getElementById('cricketGround').classList.remove('hidden');
    updateCricketUI();
}

function playCricket() {
    if(match.isOver) return;
    const battingTeam = match.teams[match.currentInnings];
    const bowlingTeam = match.teams[match.currentInnings === 0 ? 1 : 0];
    const maxBalls = match.maxOvers * 6;
    
    if(battingTeam.wickets >= 10 || battingTeam.balls >= maxBalls || (match.target && battingTeam.score >= match.target)) {
        endInnings(); return;
    }

    const striker = battingTeam.players[match.strikerIdx];
    const bowler = bowlingTeam.players[match.bowlerIdx];
    const outcomes = [0, 1, 2, 3, 4, 6, 'W'];
    const res = outcomes[Math.floor(Math.random() * outcomes.length)];
    
    battingTeam.balls++;
    striker.balls++;
    bowler.ballsBowled++;
    
    if (res === 'W') {
        battingTeam.wickets++;
        striker.isOut = true;
        bowler.wickets++;
        battingTeam.history.push('W');
        document.getElementById('status').innerText = `OUT! ${striker.name} departed!`;
        if (battingTeam.wickets < 10) {
            const nextIdx = Math.max(match.strikerIdx, match.nonStrikerIdx) + 1;
            match.strikerIdx = nextIdx < battingTeam.players.length ? nextIdx : match.nonStrikerIdx;
        }
    } else {
        battingTeam.score += res;
        striker.runs += res;
        bowler.runsConceded += res;
        battingTeam.history.push(res);
        document.getElementById('status').innerText = `${res} runs! Great shot by ${striker.name}`;
        
        if (typeof res === 'number' && res % 2 !== 0) {
            [match.strikerIdx, match.nonStrikerIdx] = [match.nonStrikerIdx, match.strikerIdx];
        }
    }

    if (battingTeam.balls % 6 === 0 && !match.isOver) {
        [match.strikerIdx, match.nonStrikerIdx] = [match.nonStrikerIdx, match.strikerIdx];
        selectBowler();
    }

    updateCricketUI();
    if(battingTeam.wickets >= 10 || battingTeam.balls >= maxBalls || (match.target && battingTeam.score >= match.target)) endInnings();
}

function endInnings() {
    if(match.currentInnings === 0) {
        match.target = match.teams[0].score + 1;
        match.currentInnings = 1;
        match.strikerIdx = 0;
        match.nonStrikerIdx = 1;
        selectBowler();
        alert(`Innings Break! ${match.teams[1].name} needs ${match.target} to win.`);
        updateCricketUI();
    } else {
        match.isOver = true;
        const t1 = match.teams[0];
        const t2 = match.teams[1];
        let winMsg = t2.score >= match.target ? `${t2.name} Wins!` : t2.score === match.target - 1 ? "Match Tied!" : `${t1.name} Wins!`;
        document.getElementById('status').innerText = winMsg;
    }
}

function updateCricketUI() {
    const team = match.teams[match.currentInnings];
    const crr = (team.score / (team.balls / 6 || 1)).toFixed(2);
    document.getElementById('battingTeamName').innerText = team.name;
    document.getElementById('score').innerText = `${team.score}/${team.wickets}`;
    document.getElementById('overs').innerText = `${Math.floor(team.balls/6)}.${team.balls%6}`;
    document.getElementById('battingPartnership').innerText = `CRR: ${crr}`;
    document.getElementById('targetDisplay').innerText = match.target ? `Target: ${match.target}` : '';
    
    const hist = document.getElementById('cricketHistory');
    hist.innerHTML = team.history.slice(-12).map(r => `<span class="w-8 h-8 rounded-full flex items-center justify-center text-xs ${r === 'W' ? 'bg-red-600' : 'bg-gray-700'}">${r}</span>`).join('');

    const scorecard = document.getElementById('liveScorecard');
    scorecard.innerHTML = match.teams.map(t => `
        <div class="mb-6 bg-white/5 p-3 rounded-lg">
            <h4 class="font-bold text-cyan-400 border-b border-white/10 mb-2">${t.name} ${t.score}/${t.wickets} (${(t.balls/6).toFixed(1)} ov)</h4>
            <div class="space-y-1">
                ${t.players.filter(p => p.balls > 0 || !p.isOut).map(p => {
                    const sr = ((p.runs / (p.balls || 1)) * 100).toFixed(1);
                    return `<div class="flex justify-between text-[10px] ${p.isOut ? 'opacity-50' : 'text-white'}">
                        <span>${p.name}${p.isOut ? ' (out)' : ''}</span>
                        <span>${p.runs}(${p.balls}) SR: ${sr}</span>
                    </div>`;
                }).join('')}
            </div>
            <div class="mt-2 pt-2 border-t border-white/5 text-[10px] text-gray-400">
                <p class="font-bold mb-1">Bowling</p>
                ${t.players.filter(p => p.ballsBowled > 0).map(p => `
                    <div class="flex justify-between">
                        <span>${p.name}</span>
                        <span>${p.wickets}-${p.runsConceded} (${Math.floor(p.ballsBowled/6)}.${p.ballsBowled%6})</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
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
    const wall = document.getElementById('feedbackWall');
    wall.innerHTML = '<div class="text-center p-10"><i class="fas fa-spinner fa-spin text-3xl text-cyan-500"></i></div>';
    
    const res = await fetch('/api/main?route=feedback');
    const data = await res.json();
    
    if(Array.isArray(data) && data.length > 0) {
        wall.innerHTML = data.map(f => `
            <div class="bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-all transform hover:-translate-y-1">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-cyan-400">${f.name}</span>
                    <span class="bg-cyan-500/20 text-cyan-400 text-[10px] px-2 py-0.5 rounded-full font-bold">₹${f.amount}</span>
                </div>
                <p class="text-sm text-gray-300 italic">"${f.remark || 'Helping sOuLViSiON grow!'}"</p>
            </div>
        `).join('');
    } else {
        wall.innerHTML = `
            <div class="text-center py-20 opacity-50">
                <i class="fas fa-heart-broken text-4xl mb-4"></i>
                <p>No donations yet. Be the pioneer!</p>
            </div>
        `;
    }
}

// --- ADMIN ---
async function saveAdminConfig() {
    const keys = document.getElementById('apiKeys').value.split(',').map(k => k.trim());
    const models = JSON.parse(document.getElementById('modelList').value);
    const miniChatModel = document.getElementById('miniChatModelId').value.trim();
    const res = await fetch('/api/main?route=admin_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ai_settings', keys, models, miniChatModel })
    });
    if(res.ok) { alert("Config Updated!"); loadConfig(); }
}

// --- INIT ---
window.onload = () => {
    updateAuthUI();
    if (currentUser) syncNotes();
    loadConfig();
    loadFeedbacks();
    renderAIHistory();
    document.getElementById('aiWidget').onclick = toggleMiniChat;
    
    // Marked.js options
    marked.setOptions({
        highlight: function(code, lang) {
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });
};