// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;
let pendingFiles = [];
let notes = [];
let aiConversations = [];
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
    const page = document.getElementById(pageId);
    if(page) page.classList.add('active');
    
    // Close sidebar on navigation (mobile)
    const sidebar = document.getElementById('mobileSidebar');
    if (sidebar && sidebar.classList.contains('translate-x-0')) toggleSidebar();
    
    window.scrollTo(0, 0);
}

function toggleSidebar() {
    const sidebar = document.getElementById('mobileSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen = sidebar.classList.contains('translate-x-0');
    
    if (isOpen) {
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    } else {
        sidebar.classList.add('translate-x-0');
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    }
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
        await syncAllData();
        showPage('home');
    } catch (err) {
        alert(err.message);
    }
}

async function syncAllData() {
    if (!currentUser) return;
    await Promise.all([
        syncNotes(),
        syncAIHistory(),
        syncFunStats(),
        syncCricketHistory()
    ]);
}

function updateAuthUI() {
    const adminBtn = document.getElementById('adminBtn');
    const adminBtnSide = document.getElementById('adminBtnSide');
    if (currentUser) {
        document.getElementById('userNameDisplay').innerText = `Hey, ${currentUser.name}`;
        document.getElementById('authBtn').innerText = 'Logout';
        document.getElementById('authBtn').onclick = logout;
        if(currentUser.isAdmin) {
            adminBtn?.classList.remove('hidden');
            adminBtnSide?.classList.remove('hidden');
        }
    } else {
        document.getElementById('userNameDisplay').innerText = '';
        document.getElementById('authBtn').innerText = 'Login';
        document.getElementById('authBtn').onclick = () => showPage('login');
        adminBtn?.classList.add('hidden');
        adminBtnSide?.classList.add('hidden');
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

async function syncNotes(silent = true) {
    if(!currentUser) {
        if(!silent) alert("Login to sync notes!");
        return;
    }
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
async function saveRandomHistory(type, value) {
    if (!currentUser) return;
    await fetch(`/api/main?route=random_history&userId=${currentUser.email}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value })
    });
}

async function genRandomNum() {
    const min = parseInt(document.getElementById('randMin').value);
    const max = parseInt(document.getElementById('randMax').value);
    const res = Math.floor(Math.random() * (max - min + 1)) + min;
    document.getElementById('numResult').innerText = res;
    await saveRandomHistory('number', res);
}

async function genRandomColor() {
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
    document.getElementById('colorPreview').style.backgroundColor = color;
    document.getElementById('colorHex').innerText = color.toUpperCase();
    await saveRandomHistory('color', color.toUpperCase());
}

async function pickRandom() {
    const raw = document.getElementById('randChoices').value;
    const choices = raw.split(',').map(c => c.trim()).filter(c => c);
    if(!choices.length) return;
    const res = choices[Math.floor(Math.random() * choices.length)];
    document.getElementById('choiceResult').innerText = res;
    await saveRandomHistory('choice', res);
}

// --- MUSIC PLAYER LOGIC ---
let isShuffle = false;
let isRepeat = false;
let audioContext, analyser, dataArray, source;
let eqBands = {};

function initAudioContext() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaElementSource(audioPlayer);
    
    // Equalizer Bands
    const freqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    let lastNode = source;
    freqs.forEach(freq => {
        const filter = audioContext.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;
        lastNode.connect(filter);
        lastNode = filter;
        eqBands[freq] = filter;
    });

    lastNode.connect(analyser);
    analyser.connect(audioContext.destination);
    analyser.fftSize = 64;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    drawVisualizer();
}

function drawVisualizer() {
    const canvas = document.getElementById('musicVisualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const render = () => {
        requestAnimationFrame(render);
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / dataArray.length) * 2.5;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = `rgba(6, 182, 212, ${dataArray[i]/255})`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    };
    render();
}

function loadMusic(e) {
    const files = Array.from(e.target.files);
    const newTracks = files.map(f => ({ name: f.name.replace(/\.[^/.]+$/, ""), url: URL.createObjectURL(f) }));
    musicList = [...musicList, ...newTracks];
    renderPlaylist();
    if(musicList.length > 0 && !audioPlayer.src) playTrack(0);
}

function renderPlaylist() {
    const container = document.getElementById('playlistContainer');
    const shuffleTag = isShuffle ? '<span class="text-[8px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded ml-2 font-bold tracking-widest animate-pulse">SHUFFLE ON</span>' : '';
    const repeatTag = isRepeat ? '<span class="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded ml-2 font-bold tracking-widest animate-pulse">REPEAT ON</span>' : '';
    
    if (musicList.length === 0) {
        container.innerHTML = `<p class="text-[10px] text-gray-500 italic">No tracks added yet.</p>`;
        return;
    }

    container.innerHTML = `
        <div class="flex gap-1 mb-3">${shuffleTag}${repeatTag}</div>
        ${musicList.map((t, i) => `
            <div class="flex items-center gap-3 p-2 rounded-lg group hover:bg-white/5 transition ${i === currentTrackIndex ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}">
                <div onclick="playTrack(${i})" class="w-6 h-6 flex items-center justify-center bg-black/20 rounded text-[10px] font-mono cursor-pointer">${i + 1}</div>
                <div onclick="playTrack(${i})" class="flex flex-col flex-grow overflow-hidden cursor-pointer">
                    <span class="text-xs truncate ${i === currentTrackIndex ? 'text-cyan-400 font-bold' : 'text-gray-300'}">${t.name}</span>
                </div>
                <div class="flex items-center gap-2">
                    ${i === currentTrackIndex && isMusicPlaying ? '<div class="playing-bars"><span></span><span></span><span></span></div>' : ''}
                    <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                        <button onclick="renameTrack(${i})" class="text-[10px] text-gray-500 hover:text-cyan-400"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteTrack(${i})" class="text-[10px] text-gray-500 hover:text-red-400"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `).join('')}
    `;
}

function deleteTrack(index) {
    const isCurrent = (index === currentTrackIndex);
    URL.revokeObjectURL(musicList[index].url);
    musicList.splice(index, 1);
    
    if (musicList.length === 0) {
        audioPlayer.pause();
        audioPlayer.src = '';
        isMusicPlaying = false;
        document.getElementById('trackName').innerText = "No Track Loaded";
        document.getElementById('artistName').innerText = "Upload local tracks to begin";
        updateMusicUI();
    } else if (isCurrent) {
        playTrack(currentTrackIndex % musicList.length);
    } else if (index < currentTrackIndex) {
        currentTrackIndex--;
    }
    renderPlaylist();
}

function renameTrack(index) {
    const newName = prompt("Rename track:", musicList[index].name);
    if (newName && newName.trim()) {
        musicList[index].name = newName.trim();
        if (index === currentTrackIndex) {
            document.getElementById('trackName').innerText = newName.trim();
        }
        renderPlaylist();
    }
}

function playTrack(index) {
    initAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    
    currentTrackIndex = index;
    const track = musicList[index];
    audioPlayer.src = track.url;
    document.getElementById('trackName').innerText = track.name;
    document.getElementById('artistName').innerText = "Local Storage Track";
    audioPlayer.play().catch(e => console.log("Playback blocked"));
    isMusicPlaying = true;
    updateMusicUI();
    renderPlaylist();
}

function toggleMusic() {
    if(!audioPlayer.src) return;
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    if(isMusicPlaying) audioPlayer.pause();
    else audioPlayer.play();
    isMusicPlaying = !isMusicPlaying;
    updateMusicUI();
    renderPlaylist();
}

function musicNext() {
    if(musicList.length === 0) return;
    if(isShuffle) {
        playTrack(Math.floor(Math.random() * musicList.length));
    } else {
        playTrack((currentTrackIndex + 1) % musicList.length);
    }
}

function musicPrev() {
    if(musicList.length === 0) return;
    playTrack((currentTrackIndex - 1 + musicList.length) % musicList.length);
}

function musicSkip(seconds) {
    audioPlayer.currentTime += seconds;
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    document.getElementById('shuffleBtn').classList.toggle('control-active', isShuffle);
    renderPlaylist();
}

function toggleRepeat() {
    isRepeat = !isRepeat;
    audioPlayer.loop = isRepeat;
    document.getElementById('repeatBtn').classList.toggle('control-active', isRepeat);
    renderPlaylist();
}

function setEQ(preset) {
    document.querySelectorAll('.eq-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    const settings = {
        normal: { 60:0, 170:0, 310:0, 600:0, 1000:0, 3000:0, 6000:0, 12000:0, 14000:0, 16000:0 },
        bass: { 60:10, 170:8, 310:4, 600:0, 1000:0, 3000:0, 6000:0, 12000:0, 14000:0, 16000:0 },
        pop: { 60:-2, 170:-1, 310:0, 600:2, 1000:4, 3000:4, 6000:2, 12000:0, 14000:-1, 16000:-2 },
        rock: { 60:6, 170:4, 310:2, 600:0, 1000:-1, 3000:-1, 6000:2, 12000:4, 14000:6, 16000:6 }
    }[preset];

    Object.keys(settings).forEach(freq => {
        if(eqBands[freq]) eqBands[freq].gain.value = settings[freq];
    });
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// Event Listeners for Player
audioPlayer.addEventListener('timeupdate', () => {
    const prog = document.getElementById('musicProgress');
    const cur = document.getElementById('currentTime');
    const dur = document.getElementById('durationTime');
    if (!isNaN(audioPlayer.duration)) {
        prog.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        cur.innerText = formatTime(audioPlayer.currentTime);
        dur.innerText = formatTime(audioPlayer.duration);
    }
});

audioPlayer.addEventListener('ended', () => {
    if (!isRepeat) musicNext();
});

document.getElementById('musicProgress').addEventListener('input', (e) => {
    const seekTime = (e.target.value / 100) * audioPlayer.duration;
    audioPlayer.currentTime = seekTime;
});

document.getElementById('volumeControl').addEventListener('input', (e) => {
    audioPlayer.volume = e.target.value;
});

function updateMusicUI() {
    const btn = document.getElementById('playPauseBtn');
    const disk = document.getElementById('vinylDisk');
    btn.innerHTML = isMusicPlaying ? '<i class="fas fa-pause-circle"></i>' : '<i class="fas fa-play-circle"></i>';
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
async function syncAIHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=ai_conversations&userId=${currentUser.email}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            aiConversations = data;
            renderAIHistory();
        }
    } catch (e) {
        console.warn("Failed to sync AI history", e);
    }
}

async function saveAIHistory(conversation) {
    const idx = aiConversations.findIndex(c => c.id === conversation.id);
    if (idx > -1) aiConversations[idx] = conversation;
    else aiConversations.unshift(conversation);

    renderAIHistory();

    if (!currentUser) return;

    // Ensure ID is a number for DB consistency
    const payload = { ...conversation, id: Number(conversation.id) };

    try {
        await fetch(`/api/main?route=ai_conversations&userId=${currentUser.email}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn("Could not sync AI history to cloud", e);
    }
}

function newConversation() {
    currentChatId = Date.now();
    const conv = { id: currentChatId, name: "New Conversation", messages: [] };
    saveAIHistory(conv);
    loadConversation(currentChatId);
}

function loadConversation(id) {
    currentChatId = id;
    const conv = aiConversations.find(c => c.id === id);
    if (!conv) return;

    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('currentConvName').innerText = conv.name;
    conv.messages.forEach(m => appendAIMessage(m.role, m.content));
    renderAIHistory();
    if(window.innerWidth < 1024) document.getElementById('aiSidebar').classList.add('hidden');
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

async function renameConversation(id) {
    const conv = aiConversations.find(c => c.id === id);
    const newName = prompt("Enter new name for conversation:", conv.name);
    if (newName) {
        conv.name = newName;
        await saveAIHistory(conv);
        if (id === currentChatId) document.getElementById('currentConvName').innerText = newName;
    }
}

async function deleteConversation(id) {
    if (!confirm("Are you sure you want to delete this conversation?")) return;
    aiConversations = aiConversations.filter(c => c.id !== id);
    if (currentUser) {
        await fetch(`/api/main?route=ai_conversations&userId=${currentUser.email}&id=${id}`, {
            method: 'DELETE'
        });
    }
    if (currentChatId === id) {
        currentChatId = null;
        document.getElementById('chatBox').innerHTML = '';
        document.getElementById('currentConvName').innerText = 'Untitled Chat';
    }
    renderAIHistory();
}

function appendAIMessage(role, content, targetBoxId = 'chatBox', isStreaming = false) {
    const box = document.getElementById(targetBoxId);
    let msgDiv = isStreaming ? box.querySelector('.streaming-msg') : null;
    
    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'} relative group ${isStreaming ? 'streaming-msg' : ''}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = "markdown-body";
        msgDiv.appendChild(contentDiv);
        
        if (role === 'ai' && !isStreaming) {
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
        
        box.appendChild(msgDiv);
    }

    const contentDiv = msgDiv.querySelector('.markdown-body');
    contentDiv.innerHTML = renderMD(content);
    
    // Add Copy Buttons to Code Blocks
    contentDiv.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return;
        const code = pre.querySelector('code');
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.innerHTML = '<i class="far fa-copy"></i>';
        btn.onclick = () => {
            navigator.clipboard.writeText(code.innerText);
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => btn.innerHTML = '<i class="far fa-copy"></i>', 2000);
        };
        pre.appendChild(btn);
    });

    box.scrollTop = box.scrollHeight;
    return msgDiv;
}

async function handleAIFile(e, isMini = false) {
    const files = Array.from(e.target.files);
    const previewId = isMini ? 'miniAttachmentPreview' : 'aiAttachmentPreview';
    const preview = document.getElementById(previewId);
    
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result.split(',')[1];
            pendingFiles.push({ mime_type: file.type, data: base64, name: file.name });
            
            const chip = document.createElement('div');
            chip.className = "bg-purple-600/20 text-purple-400 text-[10px] px-2 py-1 rounded flex items-center gap-2 border border-purple-500/30";
            chip.innerHTML = `<span>${file.name}</span><button class="hover:text-red-400">&times;</button>`;
            chip.querySelector('button').onclick = () => {
                pendingFiles = pendingFiles.filter(p => p.data !== base64);
                chip.remove();
            };
            preview.appendChild(chip);
        };
        reader.readAsDataURL(file);
    }
}

async function askAI() {
    const inputEl = document.getElementById('chatInput');
    const input = inputEl.value;
    if(!input.trim() && pendingFiles.length === 0) return;
    
    if(!currentChatId) newConversation();
    const conv = aiConversations.find(c => c.id === currentChatId);
    
    const userMsg = input + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'chatBox');
    inputEl.value = '';
    document.getElementById('aiAttachmentPreview').innerHTML = '';

    if(conv && conv.messages.length === 0) {
        conv.name = input.substring(0, 25) || "New Conversation";
    }
    
    const parts = [{ text: input }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    const messageObj = { role: 'user', content: userMsg, parts };
    if(conv) conv.messages.push(messageObj);

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(input, 'chatBox', conv ? conv.messages : [], attachmentsForApi);
}

async function askMiniAI() {
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    if(!inputEl.value.trim() && pendingFiles.length === 0) return;
    
    const txt = inputEl.value;
    appendAIMessage('user', txt + (pendingFiles.length ? " [Files attached]" : ""), 'miniChatBox');
    inputEl.value = '';
    document.getElementById('miniAttachmentPreview').innerHTML = '';
    
    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(txt, 'miniChatBox', [], attachmentsForApi);
}

async function callGeminiAPI(text, targetBoxId = 'chatBox', history = [], attachments = []) {
    let model = "gemini-1.5-flash";
    if (targetBoxId === 'miniChatBox') {
        model = aiConfig.miniChatModel || "gemini-1.5-flash";
    } else {
        const modelSelect = document.getElementById('modelSelect');
        model = (modelSelect && modelSelect.value) ? modelSelect.value : (aiConfig.models[0]?.id || "gemini-1.5-flash");
    }
    
    if(!aiConfig.keys.length) return alert("Please configure API Keys in Admin panel.");

    const statusEl = document.getElementById(targetBoxId === 'chatBox' ? 'aiStatus' : null);
    if(statusEl) { statusEl.innerText = "Connecting to Neural Link..."; statusEl.classList.remove('hidden'); }

    // Map history to Gemini format
    const contents = history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: m.parts || [{ text: m.content }]
    }));

    // Add current prompt if history doesn't already contain it
    if (contents.length === 0 || contents[contents.length-1].role === 'model') {
        const currentParts = [{ text: text }];
        attachments.forEach(a => currentParts.push({ inline_data: { mime_type: a.mime_type, data: a.data } }));
        contents.push({ role: 'user', parts: currentParts });
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || "API Error");
        }

        if(statusEl) statusEl.innerText = "Streaming Response...";
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullContent = "";
        let streamingDiv = appendAIMessage('ai', '...', targetBoxId, true);
        
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            let braceCount = 0;
            let inString = false;
            let startIdx = -1;

            for (let i = 0; i < buffer.length; i++) {
                const char = buffer[i];
                
                // Handle strings to ignore braces inside them
                if (char === '"' && (i === 0 || buffer[i - 1] !== '\\')) {
                    inString = !inString;
                }

                if (!inString) {
                    if (char === '{') {
                        if (braceCount === 0) startIdx = i;
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        
                        if (braceCount === 0 && startIdx !== -1) {
                            const chunkStr = buffer.substring(startIdx, i + 1);
                            try {
                                const chunk = JSON.parse(chunkStr);
                                const textPart = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
                                if (textPart) {
                                    fullContent += textPart;
                                    appendAIMessage('ai', fullContent, targetBoxId, true);
                                }
                            } catch (e) {
                                console.error("Stream parse error", e);
                            }
                            
                            // Remove processed object and any trailing comma/whitespace
                            buffer = buffer.substring(i + 1).replace(/^[\s,]+/, '');
                            // Reset search indices for the new buffer
                            i = -1; 
                            startIdx = -1;
                            braceCount = 0;
                            inString = false;
                        }
                    }
                }
            }
        }

        streamingDiv.classList.remove('streaming-msg');
        if(statusEl) statusEl.classList.add('hidden');

        if (targetBoxId === 'chatBox' && currentChatId) {
            const conv = aiConversations.find(c => c.id === currentChatId);
            if (conv) {
                conv.messages.push({ role: 'ai', content: fullContent });
                await saveAIHistory(conv);
            }
        }
    } catch (err) {
        console.warn(`Key ${currentKeyIndex} error: ${err.message}.`);
        if (aiConfig.keys.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
            if(statusEl) statusEl.innerText = `Retrying with Key ${currentKeyIndex}...`;
            return await callGeminiAPI(text, targetBoxId, history, attachments);
        }
        if(statusEl) statusEl.classList.add('hidden');
        appendAIMessage('ai', `**System Failure:** ${err.message}`, targetBoxId);
    }
}

// AI logic replaced by unified streaming/file functions above
function clearChat() { document.getElementById('chatBox').innerHTML = ''; }
function toggleAIHistory() {
    const sidebar = document.getElementById('aiSidebar');
    sidebar.classList.toggle('hidden');
}
function toggleMiniChat() { document.getElementById('miniChat').classList.toggle('show'); }

// --- FUN PAGE LOGIC ---
let clickCount = 0;
let clickTime = 10;
let clickActive = false;
function startClicker() {
    if(clickActive) { clickCount++; document.getElementById('clickCounter').innerText = clickCount; return; }
    clickActive = true; clickCount = 1; clickTime = 10;
    document.getElementById('clickCounter').innerText = "1";
    const interval = setInterval(async () => {
        clickTime--;
        document.getElementById('clickTimer').innerText = clickTime + "s remaining";
        if(clickTime <= 0) {
            clearInterval(interval);
            clickActive = false;
            const cps = clickCount / 10;
            alert(`Time's up! Your CPS: ${cps}`);
            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${currentUser.email}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'clicker', score: cps })
                });
            }
        }
    }, 1000);
}

async function syncFunStats() {
    if (!currentUser) return;
    const res = await fetch(`/api/main?route=fun_stats&userId=${currentUser.email}`);
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
    // Max overs a single bowler can bowl (Standard rule: 1/5th of total innings overs)
    const maxPerBowler = Math.ceil(match.maxOvers / 5);
    
    const playersWithIdx = bowlingTeam.players.map((p, idx) => ({ ...p, idx }));
    let available = playersWithIdx.filter(p => {
        const hasNotExhaustedLimit = (p.ballsBowled / 6) < maxPerBowler;
        const isEligibleType = (priorities[p.type] || 5) <= 3;
        return hasNotExhaustedLimit && isEligibleType;
    });
    
    if (available.length === 0) {
        available = playersWithIdx.filter(p => (p.ballsBowled / 6) < maxPerBowler);
    }
    
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

async function endInnings() {
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
        document.getElementById('newMatchBtn').classList.remove('hidden');
        
        if (currentUser) {
            await fetch(`/api/main?route=cricket_history&userId=${currentUser.email}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    result: winMsg, 
                    scoreA: `${t1.name}: ${t1.score}/${t1.wickets}`,
                    scoreB: `${t2.name}: ${t2.score}/${t2.wickets}`
                })
            });
        }
    }
}

async function saveCricketSetup() {
    if (!currentUser) return alert("Login to save your teams!");
    const setup = {
        tA: document.getElementById('teamAName').value,
        tB: document.getElementById('teamBName').value,
        overs: document.getElementById('cricketOversSelect').value,
        pA: document.getElementById('teamAPlayers').value,
        pB: document.getElementById('teamBPlayers').value
    };
    await fetch(`/api/main?route=cricket_setup&userId=${currentUser.email}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setup)
    });
    alert("Match setup saved to cloud!");
}

async function loadCricketSetup() {
    if (!currentUser) return;
    const res = await fetch(`/api/main?route=cricket_setup&userId=${currentUser.email}`);
    const data = await res.json();
    if (data && data.length > 0) {
        const latest = data[data.length - 1];
        document.getElementById('teamAName').value = latest.tA;
        document.getElementById('teamBName').value = latest.tB;
        document.getElementById('cricketOversSelect').value = latest.overs;
        document.getElementById('teamAPlayers').value = latest.pA;
        document.getElementById('teamBPlayers').value = latest.pB;
    }
}

function resetCricketMatch() {
    document.getElementById('cricketGround').classList.add('hidden');
    document.getElementById('cricketSetup').classList.remove('hidden');
    document.getElementById('newMatchBtn').classList.add('hidden');
    document.getElementById('status').innerText = "Wait for Bowler...";
}

async function syncCricketHistory() {
    if (!currentUser) return;
    const res = await fetch(`/api/main?route=cricket_history&userId=${currentUser.email}`);
    // History can be displayed in an 'Archives' tab if UI is added later
}

function updateCricketUI() {
    const team = match.teams[match.currentInnings];
    const crr = (team.score / (team.balls / 6 || 1)).toFixed(2);
    document.getElementById('battingTeamName').innerText = team.name;
    document.getElementById('score').innerText = `${team.score}/${team.wickets}`;
    document.getElementById('overs').innerText = `${Math.floor(team.balls/6)}.${team.balls%6}`;
    
    let statsText = `CRR: ${crr}`;
    if (match.target) {
        const remainingBalls = (match.maxOvers * 6) - team.balls;
        const runsNeeded = match.target - team.score;
        const rrr = remainingBalls > 0 ? ((runsNeeded / remainingBalls) * 6).toFixed(2) : '0.00';
        statsText += ` | RRR: ${rrr}`;
        document.getElementById('targetDisplay').innerText = `Target: ${match.target} (Need ${runsNeeded} off ${remainingBalls} balls)`;
    } else {
        document.getElementById('targetDisplay').innerText = '';
    }
    
    document.getElementById('battingPartnership').innerText = statsText;
    
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
window.onload = async () => {
    updateAuthUI();
    if (currentUser) {
        await syncAllData();
        await loadCricketSetup();
    }
    loadConfig();
    loadFeedbacks();
    renderAIHistory();

    // Init Greetings
    const aiWelcome = "### Greetings.\nI am the **sOuLAI** interface. How can I assist your vision today?";
    appendAIMessage('ai', aiWelcome, 'chatBox');
    appendAIMessage('ai', "Hello! I am your quick AI assistant. Ask me anything.", 'miniChatBox');

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