// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;

let HARISH_JOHARI_KNOWLEDGE = "";

let solveState = {
    mode: 'pro', // simple or pro
    history: [],
    lastAnswer: 0,
    isAIWorking: false,
    activeExpression: ""
};

let quizState = {
    active: false,
    questions: [],
    currentIndex: 0,
    score: 0,
    timer: null,
    timeLeft: 0,
    category: '',
    results: []
};

let consecutiveApiFailures = 0;
let isAICooldownActive = false;
let aiCooldownTimer = null; // To automatically clear cooldown

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '<i class="fas fa-check-circle text-green-400"></i>';
    if (type === 'error') icon = '<i class="fas fa-exclamation-circle text-red-400"></i>';
    if (type === 'info') icon = '<i class="fas fa-info-circle text-cyan-400"></i>';
    if (type === 'warning') icon = '<i class="fas fa-exclamation-triangle text-orange-400"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
let isStreamingMode = true;
let currentAbortController = null;

// --- Time Modal Global States ---
let modalCurrentTab = 'clocks';
let modalStopwatchInterval = null;
let modalStopwatchTime = 0; // In seconds
let modalTimerInterval = null;
let modalTimerTimeRemaining = 25 * 60; // In seconds
let modalTimerChime = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let alarms = [];
let worldClocks = []; // Stores timezone strings

// --- Calendar Global States ---
let selectedCalendarDate = new Date(); // Date object for calendar interaction
let calendarEvents = []; // Stores events from DB

function toggleSendButton(type, isStopping) {
    // type can be 'main', 'mini', 'code', 'solve'
    let btnId;
    let baseColor = 'bg-purple-600';
    let hoverColor = 'hover:bg-purple-700';
    let shadowColor = 'shadow-purple-600/20';
    let iconSize = 'text-xs md:text-base';
    let clickFn;

    if (type === 'main') {
        btnId = 'aiSendBtn';
        clickFn = askAI;
    } else if (type === 'mini') {
        btnId = 'miniAiSendBtn';
        iconSize = 'text-xs';
        clickFn = askMiniAI;
    } else if (type === 'code') {
        btnId = 'codeAISendBtn';
        baseColor = 'bg-blue-600';
        hoverColor = 'hover:bg-blue-500';
        shadowColor = 'shadow-blue-900/20';
        iconSize = 'text-xs';
        clickFn = askCodeAI;
    } else if (type === 'solve') {
        btnId = 'solveAISendBtn';
        iconSize = 'text-[10px]';
        clickFn = askSolveAI;
    } else {
        // Fallback for older boolean type param
        btnId = type ? 'miniAiSendBtn' : 'aiSendBtn';
        clickFn = type ? askMiniAI : askAI;
        if (type) iconSize = 'text-xs';
    }

    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    if (isStopping) {
        btn.innerHTML = `<i class="fas fa-stop ${iconSize}"></i>`;
        btn.classList.remove(baseColor, hoverColor, shadowColor);
        btn.classList.add('bg-red-600', 'hover:bg-red-700', 'shadow-red-600/20', 'animate-pulse');
        btn.onclick = stopAIStream;
    } else {
        btn.innerHTML = `<i class="fas fa-paper-plane ${iconSize}"></i>`;
        btn.classList.add(baseColor, hoverColor, shadowColor);
        btn.classList.remove('bg-red-600', 'hover:bg-red-700', 'shadow-red-600/20', 'animate-pulse');
        btn.onclick = clickFn;
    }
}

function stopAIStream() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
        
        // Reset all buttons
        ['main', 'mini', 'code', 'solve'].forEach(t => toggleSendButton(t, false));
        
        // Clear UI indicators
        ['aiStatus', 'miniAiStatus', 'codeAIStatus', 'solveAIStatus'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        
        showToast("AI silenced.", "warning");
    }
}

function stripMarkdown(text) {
    return text
        .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '$1') // Code blocks - keep content
        .replace(/`(.+?)`/g, '$1')                    // Inline code - keep content
        .replace(/(\*\*|__)(.*?)\1/g, '$2')           // Bold
        .replace(/(\*|_)(.*?)\1/g, '$2')              // Italic
        .replace(/#+\s+(.*?)(?:\n|$)/g, '$1 ')        // Headers
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')           // Links
        .replace(/>\s+(.*?)(?:\n|$)/g, '$1 ')         // Quotes
        .replace(/- \[( |x)\] /g, '')                 // Task lists
        .replace(/[-*+]\s+/g, '')                     // Unordered lists
        .replace(/\d+\.\s+/g, '')                     // Ordered lists
        .replace(/\n+/g, ' ')                         // Newlines to spaces for better TTS flow
        .trim();
}

function speakAIMessage(text, btn) {
    if ('speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            btn.innerHTML = '<i class="fas fa-volume-up text-[10px]"></i>';
            btn.classList.remove('text-cyan-400');
            return;
        }

        const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
        utterance.rate = 1;
        utterance.pitch = 1;
        
        utterance.onstart = () => {
            btn.innerHTML = '<i class="fas fa-stop-circle text-[10px] animate-pulse"></i>';
            btn.classList.add('text-cyan-400');
        };
        
        utterance.onend = () => {
            btn.innerHTML = '<i class="fas fa-volume-up text-[10px]"></i>';
            btn.classList.remove('text-cyan-400');
        };

        window.speechSynthesis.speak(utterance);
    } else {
        showToast("TTS not supported in this browser.", "error");
    }
}

function toggleStreamMode(val) {
    isStreamingMode = val;
    // Sync toggles across UI
    const mainToggle = document.getElementById('streamToggle');
    const mainToggleMobile = document.getElementById('streamToggleMobile');
    const miniToggle = document.getElementById('miniStreamToggle');
    if (mainToggle) mainToggle.checked = val;
    if (mainToggleMobile) mainToggleMobile.checked = val;
    if (miniToggle) miniToggle.checked = val;
    
    const status = isStreamingMode ? "Streaming Active" : "Instant Delivery Mode";
    console.log(status);
}

// UI Helpers
let isCheckingHealth = false;
async function checkSystemHealth() {
    if (isCheckingHealth) return;
    isCheckingHealth = true;
    
    const start = Date.now();
    const dot = document.getElementById('healthDot');
    const text = document.getElementById('healthText');
    const indicator = document.getElementById('globalHealthIndicator');
    const latencyEl = document.getElementById('healthLatency');
    const cloudEl = document.getElementById('healthCloudStatus');

    if (currentUser && currentUser.isAdmin) indicator?.classList.remove('hidden');

    try {
        // Ping config to check DB and Server connectivity
        const res = await fetch(`/api/main?route=admin_config`, { priority: 'low' });
        const latency = Date.now() - start;
        
        if (res.ok) {
            const data = await res.json();
            const hasKeys = data.keys && data.keys.length > 0;
            
            if (dot) {
                dot.className = "relative inline-flex rounded-full h-2 w-2 " + (hasKeys ? "bg-green-500" : "bg-yellow-500");
                const ping = dot.previousElementSibling;
                if (ping) ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 " + (hasKeys ? "bg-green-400" : "bg-yellow-400");
            }
            if (text) text.innerText = hasKeys ? "Stable" : "Degraded";
            if (latencyEl) {
                latencyEl.innerText = `${latency}ms`;
                latencyEl.className = `text-xl font-black ${latency < 200 ? 'text-green-400' : 'text-yellow-400'}`;
            }
            if (cloudEl) {
                cloudEl.innerText = "ACTIVE";
                cloudEl.className = "text-xl font-black text-green-400";
            }
        } else {
            throw new Error();
        }
    } catch (e) {
        if (dot) {
            dot.className = "relative inline-flex rounded-full h-2 w-2 bg-red-500";
            const ping = dot.previousElementSibling;
            if (ping) ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75";
        }
        if (text) text.innerText = "Offline";
        if (latencyEl) {
            latencyEl.innerText = "ERR";
            latencyEl.className = "text-xl font-black text-red-500";
        }
        if (cloudEl) {
            cloudEl.innerText = "FAILED";
            cloudEl.className = "text-xl font-black text-red-500";
        }
    } finally {
        isCheckingHealth = false;
    }
}

function setLoading(show, text = "Synchronizing") {
    const loader = document.getElementById('globalLoader');
    const txt = document.getElementById('loaderText');
    if (loader) {
        if (show) {
            txt.innerText = text;
            loader.classList.remove('hidden');
        } else {
            loader.classList.add('hidden');
        }
    }
}

function showBetterError(msg) {
    const overlay = document.getElementById('errorOverlay');
    const desc = document.getElementById('errorDescription');
    if (overlay && desc) {
        desc.innerText = msg;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }
    setLoading(false);
}

function closeErrorOverlay() {
    const overlay = document.getElementById('errorOverlay');
    if (overlay) overlay.classList.add('hidden');
}
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;
let pendingFiles = [];
let miniChatHistory = [];

// --- TIME & CALENDAR STATE ---
let clockType = 'digital';
let timeFormat = localStorage.getItem('soul_time_format') || '12h';
let calendarDate = new Date();
let notes = [];
let noteType = 'note';
let sleepTimer = null;
let noteFilter = 'all';
let aiConversations = [];
let selectedConversations = new Set();
// The problematic second declaration was here. Removed 'let'.
// consecutiveApiFailures = 0;
// isAICooldownActive = false;
// aiCooldownTimer = null; // To automatically clear cooldown

let currentChatId = null;
let seekHistory = [];

async function fetchNumerologyKnowledge() {
    if (HARISH_JOHARI_KNOWLEDGE) return;
    try {
        const res = await fetch('/knowledge_numerology.txt');
        if (res.ok) {
            HARISH_JOHARI_KNOWLEDGE = await res.text();
            console.log("Numerology knowledge loaded into memory.");
        }
    } catch (e) { console.warn("Could not load external knowledge file."); }
}

let projectFiles = []; // { id: num, name: '', content: '', path: '' }
let activeFileId = null;
let aiProposedChange = null; 
let musicList = [];
let selectedTracks = new Set();
let currentTrackIndex = 0;
let audioPlayer = new Audio();
let isMusicPlaying = false;
let isCCEnabled = false;
let playMode = 'online'; // 'online' or 'offline'
let isVideoMode = false;
let ytPlayer = null;
let ytProgressInterval = null;

// --- MARKDOWN & MATH INIT ---
function renderMD(text, noteId = null) {
    let html = marked.parse(text);
    
    // Handle checkboxes generated by Marked (task lists)
    // We replace the disabled attribute and add our class and onclick
    const interactiveCheck = (match) => {
        const isChecked = match.includes('checked');
        return `<input type="checkbox" class="note-checkbox" data-note-id="${noteId || ''}" ${isChecked ? 'checked' : ''} ${noteId ? '' : 'disabled'} onclick="event.stopPropagation(); handleNoteCheckbox(this)">`;
    };

    // This catches marked's typical output for checkboxes and makes them interactive
    html = html.replace(/<input [^>]*type="checkbox"[^>]*>/g, interactiveCheck);

    const div = document.createElement('div');
    div.innerHTML = html;
    
    // Render Math
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(div, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError : false
        });
    }

    return div.innerHTML;
}

// Global bridge for inline checkbox events
async function handleNoteCheckbox(el) {
    const noteId = el.dataset.noteId;
    const isChecked = el.checked;
    await toggleNoteCheckbox(noteId, isChecked, el);
}

async function toggleNoteCheckbox(noteId, isChecked, el) {
    const id = Number(noteId);
    const note = notes.find(n => n.id === id);
    if (!note) return;

    // Identify container to calculate index relative to rendered source
    const container = el.closest('.prose') || el.closest('#notePreview');
    if (!container) return;
    
    const checkboxes = Array.from(container.querySelectorAll('.note-checkbox'));
    const index = checkboxes.indexOf(el);

    let currentIdx = -1;
    const taskRegex = /^([ \t]*[*+-] )\[([ xX])\]/gm;
    
    // 1. Update the status of the clicked checkbox in the raw text
    let updatedText = note.text.replace(taskRegex, (match, prefix, char) => {
        currentIdx++;
        if (currentIdx === index) return `${prefix}[${isChecked ? 'x' : ' '}]`;
        return match;
    });

    // 2. Auto-Sort task blocks: Keep active tasks on top and move completed tasks to bottom of the block
    const lines = updatedText.split('\n');
    const resultLines = [];
    let currentBlock = [];

    const isTaskLine = (l) => /^([ \t]*[*+-] )\[([ xX])\]/.test(l);

    const flushBlock = () => {
        if (currentBlock.length > 0) {
            currentBlock.sort((a, b) => {
                const aChecked = /\[[xX]\]/.test(a);
                const bChecked = /\[[xX]\]/.test(b);
                if (aChecked === bChecked) return 0;
                return aChecked ? 1 : -1; // Unchecked (-1) comes before Checked (1)
            });
            resultLines.push(...currentBlock);
            currentBlock = [];
        }
    };

    for (const line of lines) {
        if (isTaskLine(line)) {
            currentBlock.push(line);
        } else {
            flushBlock();
            resultLines.push(line);
        }
    }
    flushBlock();

    const newText = resultLines.join('\n');
    note.text = newText;
    
    // Refresh the UI to reflect the new order immediately
    renderNotes();
    
    // Synchronize UI if the note is currently open in the immersive editor
    const editIdInput = document.getElementById('editNoteId');
    if (editIdInput && editIdInput.value == id) {
        document.getElementById('editNoteText').value = newText;
        updateEditorStats(document.getElementById('editNoteText'));
    }

    // Sync update to Cloud DB
    try {
        fetch(`/api/main?route=notes&id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText })
        });
    } catch (e) { console.error("Checkbox Sync Error:", e); }
}

function filterNotes(query) {
    const searchTerm = query.toLowerCase();
    const list = document.getElementById('notesList');
    
    const filtered = notes.filter(n => {
        const matchesSearch = (n.title && n.title.toLowerCase().includes(searchTerm)) || 
                              (n.text && n.text.toLowerCase().includes(searchTerm));
        const matchesType = noteFilter === 'all' || 
                           (noteFilter === 'note' && (n.type === 'note' || !n.type)) ||
                           (noteFilter === 'todo' && n.type === 'todo');
        return matchesSearch && matchesType;
    });

    renderNotes(filtered);
}

function filterAIHistory(query) {
    const searchTerm = query.toLowerCase();
    const filtered = aiConversations.filter(c => c.name.toLowerCase().includes(searchTerm));
    renderAIHistory(filtered);
}

let autoSaveTimeout;
function debounceAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        const modalVisible = !document.getElementById('noteModal').classList.contains('hidden');
        if (modalVisible) saveEditedNote(true);
    }, 2000);
}

function updateEditorStats(el) {
    const text = el.value || "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    
    if (el.id === 'noteInput') {
        document.getElementById('noteWordCount').innerText = words;
        document.getElementById('noteCharCount').innerText = chars;
        // Draft Recovery
        if (text.length > 5) {
            sessionStorage.setItem('soul_note_draft', text);
            document.getElementById('restoreDraftBtn').classList.remove('hidden');
        }
    } else if (el.id === 'editNoteText') {
        document.getElementById('editWordCount').innerText = words;
        document.getElementById('editCharCount').innerText = chars;
        document.getElementById('notePreview').innerHTML = renderMD(text, document.getElementById('editNoteId').value);
        debounceAutoSave();
        // Draft for existing note
        const noteId = document.getElementById('editNoteId').value;
        if (noteId) sessionStorage.setItem(`soul_draft_${noteId}`, text);
    }
}

function restoreDraft() {
    const draft = sessionStorage.getItem('soul_note_draft');
    if (draft) {
        document.getElementById('noteInput').value = draft;
        updateEditorStats(document.getElementById('noteInput'));
        document.getElementById('restoreDraftBtn').classList.add('hidden');
    }
}

// --- GLOBAL KEYBOARD SHORTCUTS & ENTER KEY ---
document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;

    // Enter Key Logic (allowed while typing)
    if (e.key === 'Enter' && !e.shiftKey) {
        if (active.id === 'chatInput') {
            e.preventDefault();
            askAI();
            return;
        }
        if (active.id === 'miniChatInput') {
            e.preventDefault();
            askMiniAI();
            return;
        }
        if (active.id === 'codeChatInput') {
            e.preventDefault();
            askCodeAI();
            return;
        }
        if (active.id === 'seekInput') {
            e.preventDefault();
            askSoulSeekAI();
            return;
        }
        if (active.id === 'solveAIInput') {
            e.preventDefault();
            askSolveAI();
            return;
        }
        if (active.id === 'authPass' || active.id === 'authEmail') handleAuth();
        if (active.id === 'donAmount' || active.id === 'donRemark') payNow();
    }

    // Navigation Shortcuts (Alt + Key) - Disabled if typing
    if (e.altKey && !isTyping) {
        const key = e.key.toLowerCase();
        if (key === 'n') {
            e.preventDefault();
            showPage('notes');
        } else if (key === 'a') {
            e.preventDefault();
            showPage('ai');
        } else if (key === 'p') {
            e.preventDefault();
            showPage('play');
        }
    }
});

// Toggle Password Visibility
function togglePasswordVisibility(id, btn) {
    const input = document.getElementById(id);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

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

// Update the "Smart Bullets" event listener to ensure autoResize triggers correctly
document.addEventListener('input', (e) => {
    if (e.target.id === 'noteInput' || e.target.id === 'editNoteText') {
        const el = e.target;
        
        // Fix for Smart Bullets logic breaking auto-resize
        const val = el.value;
        if (val.endsWith('\n')) {
            const lines = val.split('\n');
            const prevLine = lines[lines.length - 2];
            const trimmedPrev = prevLine.trim();
            
            if ((trimmedPrev.startsWith('- [ ] ') && trimmedPrev.length > 6) || 
                (trimmedPrev.startsWith('- [x] ') && trimmedPrev.length > 6)) {
                el.value += '- [ ] ';
            } 
            else if (trimmedPrev.startsWith('- ') && trimmedPrev.length > 2) {
                el.value += '- ';
            }
            else if (trimmedPrev.match(/^\d+\. /)) {
                const num = parseInt(trimmedPrev.match(/^\d+/)[0]);
                if (trimmedPrev.length > (num.toString().length + 2)) {
                    el.value += `${num + 1}. `;
                }
            }
        }
        
        autoResize(el); // Ensure height updates after content/bullet changes
        updateEditorStats(el);
    }
});

function setNoteInputType(type) {
    noteType = type;
    const btnNote = document.getElementById('typeBtnNote');
    const btnTodo = document.getElementById('typeBtnTodo');
    const input = document.getElementById('noteInput');
    const toolbar = document.getElementById('noteToolbar');

    if (type === 'todo') {
        btnTodo.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all bg-purple-600 text-white";
        btnNote.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all text-gray-400";
        toolbar.classList.add('hidden');
        input.placeholder = "Enter your tasks...";
        if (!input.value.trim()) {
            input.value = "- [ ] ";
        }
    } else {
        btnNote.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all bg-cyan-600 text-white";
        btnTodo.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all text-gray-400";
        toolbar.classList.remove('hidden');
        input.placeholder = "Start writing markdown...";
    }
}

function setNoteFilter(filter) {
    noteFilter = filter;
    ['filterAll', 'filterNotes', 'filterTodos', 'filterTrash'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = "text-[10px] font-bold px-3 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10";
    });
    
    const ids = { all: 'filterAll', note: 'filterNotes', todo: 'filterTodos', trash: 'filterTrash' };
    const activeId = ids[filter];
    if (document.getElementById(activeId)) {
        document.getElementById(activeId).className = "text-[10px] font-bold px-3 py-1 rounded-full bg-cyan-600 text-white border border-cyan-500";
    }
    
    syncNotes(true, filter === 'trash');
}

// --- NAVIGATION & ROUTING ---
const pageCache = new Map();

function showPage(pageId, pushState = true) {
    const validPages = ['home', 'notes', 'code', 'ai', 'play', 'random', 'cricket', 'snake', 'focus', 'fun', 'support', 'dashboard', 'who', 'manage', 'login', 'legal', 'forgotPass', 'quiz', 'seek', 'solve', 'compare', 'draw'];
    if (!validPages.includes(pageId)) pageId = 'home';

    // Optimization: Don't re-render/re-toggle if already active
    const currentPage = document.querySelector('.page.active');
    if (currentPage && currentPage.id === pageId) return;

    if (currentPage) currentPage.classList.remove('active');
    
    const page = document.getElementById(pageId);
    if(page) {
        page.classList.add('active');
        // Smooth entry for better perceived performance
        if (pageId !== 'home') window.scrollTo({ top: 0, behavior: 'auto' });
    }
    
    // History & URL Management
    if (pushState) {
        const path = pageId === 'home' ? '/' : `/${pageId}`;
        if (window.location.pathname !== path) {
            history.pushState({ pageId }, "", path);
        }
    }

    // Update Document Meta
    const pageMeta = {
        home: { title: 'sOuLViSiON | Digital Sanctuary', desc: 'The ultimate multi-tool productivity platform.' },
        notes: { title: 'sOuLNOTES | Secure Markdown Workspace', desc: 'Your private encrypted note-taking vault.' },
        ai: { title: 'sOuLAI | Intelligence Core', desc: 'Advanced multi-model AI workspace.' },
        play: { title: 'sOuLPLAY | Immersive Music Player', desc: 'Stream YouTube or play local files with vinyl aesthetics.' },
        random: { title: 'sOuLRANDOM | Omni-Randomizer', desc: 'Generate numbers, lists, colors, and more.' },
        cricket: { title: 'sOuLCRICKET | Hand Cricket', desc: 'Strategic hand cricket simulator.' },
        snake: { title: 'sOuLSNAKE | Retro Arena', desc: 'High-performance retro snake with global leaderboards.' },
        focus: { title: 'sOuLFOCUS | Deep Work Timer', desc: 'Pomodoro timer, journaling, and life metrics.' },
        quiz: { title: 'sOuLQUIZ | Knowledge Challenge', desc: 'AI-generated trivia and spiritual challenges.' },
        fun: { title: 'sOuLFUN | Casual Play', desc: 'Simple joys and clicker tests.' },
        support: { title: 'sOuLSUPPORT | Fuel the Vision', desc: 'Support development and join the wall of gratitude.' },
        who: { title: 'sOuLWHO? | Mission & Architect', desc: 'The story behind sOuLViSiON.' },
        dashboard: { title: 'sOuLViSiON | Dashboard', desc: 'Manage your account and preferences.' },
        seek: { title: 'sOuLSEEK | AI Numerologist', desc: 'Discover your life path through Vedic numerology.' },
        login: { title: 'sOuLViSiON | Authentication', desc: 'Securely sign in to your sanctuary.' },
        legal: { title: 'sOuLViSiON | Privacy & Terms', desc: 'Legal documentation and policies.' },
        manage: { title: 'sOuLMANAGE | Admin Control', desc: 'System management and health.' },
        forgotPass: { title: 'sOuLViSiON | Reset Password', desc: 'Recover access to your account.' },
        draw: { title: 'sOuLDRAW | Creative Expression', desc: 'Professional-grade sketching suite.' },
        solve: { title: 'sOuLSOLVE | Omni-Calculator', desc: 'Synaptic logic and precision computation.' },
        compare: { title: 'sOuLCOMPARE | Text Diff Engine', desc: 'Synchronized text analysis and diffing.' }
    };

    const meta = pageMeta[pageId] || pageMeta.home;
    document.title = meta.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', meta.desc);

    // Cleanup Fun State if leaving
    if (currentPage && currentPage.id === 'fun') {
        if (funState.clicker.interval) clearInterval(funState.clicker.interval);
        if (funState.reaction.timer) clearTimeout(funState.reaction.timer);
        if (breathingState.active) toggleZenBreath(document.querySelector('#fun button[onclick*="toggleZenBreath"]'));
    }

    // UI State Sync
    requestAnimationFrame(() => {
        // Active Nav Highlighting
        const allNavBtns = document.querySelectorAll('nav button[onclick*="showPage"], aside nav button[onclick*="showPage"]');
        allNavBtns.forEach(btn => {
            const onclickAttr = btn.getAttribute('onclick');
            if (onclickAttr && onclickAttr.includes(`'${pageId}'`)) {
                btn.classList.add('text-cyan-400', 'bg-white/10');
            } else {
                btn.classList.remove('text-cyan-400', 'bg-white/10');
            }
        });

        const widget = document.getElementById('aiWidget');
        const mini = document.getElementById('miniChat');
        if (pageId === 'ai' || pageId === 'code') {
            widget?.classList.add('hidden');
            mini?.classList.remove('show');
        } else {
            widget?.classList.remove('hidden');
        }

        // Lazy Initializations
        if (pageId === 'snake') {
            initSnake();
            syncSnakeLeaderboard();
        } else {
            quitSnake();
        }

        if (pageId === 'draw') {
            initDrawPage();
        }

        if (pageId === 'quiz') {
            resetQuiz();
            syncQuizLeaderboard();
        } else {
            quizState.active = false;
            if (quizState.timer) clearInterval(quizState.timer);
        }
        
        if (pageId === 'dashboard') loadDashboard();

        if (pageId === 'focus') {
            initFocusPage();
        }
        if (pageId === 'seek') {
            syncSeekHistory();
            fetchNumerologyKnowledge();
        }

        if (pageId === 'solve') {
            initSolveInterface();
            syncSolveHistory();
        }

        // Trigger auto-resize for primary textareas on page entry
        ['chatInput', 'noteInput', 'editNoteText', 'miniChatInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) autoResize(el);
        });
        
        if (pageId === 'manage' && currentUser?.isAdmin) {
            loadConfig();
            loadAdminUsers();
            // Delay map loading slightly to ensure container is fully rendered and has dimensions
            setTimeout(loadVisitorMap, 300);
        }
        
        if (pageId === 'support') loadFeedbacks();
        if (pageId === 'fun') {
            initParticleVoid();
            syncFunLeaderboard();
            renderAlchemyLog();
        }
        
        // Close sidebar on navigation (mobile)
        const sidebar = document.getElementById('mobileSidebar');
        if (sidebar && sidebar.classList.contains('translate-x-0')) toggleSidebar();
    });
}

// Browser Navigation Handler (Back/Forward)
window.addEventListener('popstate', (event) => {
    if (event.state && event.state.pageId) {
        showPage(event.state.pageId, false);
    } else {
        // Fallback to URL path detection if state is missing
        const path = window.location.pathname.substring(1) || 'home';
        showPage(path, false);
    }
});

function loadDashboard() {
    if (!currentUser) return showPage('login');
    document.getElementById('dashWelcome').innerText = `Hello, ${currentUser.name}`;
    document.getElementById('dashAvatar').innerText = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('dashName').value = currentUser.name;
    document.getElementById('dashEmail').value = currentUser.email;
    document.getElementById('dashStatNotes').innerText = notes.length;
    document.getElementById('dashStatAI').innerText = aiConversations.length;
}

async function updateUserProfile() {
    const name = document.getElementById('dashName').value;
    const password = document.getElementById('dashPass').value;
    const theme = document.documentElement.getAttribute('data-theme');
    
    if (!name) return alert("Name cannot be empty");

    setLoading(true, "Updating Profile");
    try {
        const res = await fetch(`/api/main?route=auth&email=${currentUser.email}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: password || undefined, theme })
        });
        
        if (res.ok) {
            currentUser.name = name;
            currentUser.theme = theme;
            localStorage.setItem('soulUser', JSON.stringify(currentUser));
            updateAuthUI();
            showToast("Profile synchronized successfully!", "success");
            document.getElementById('dashPass').value = '';
        } else {
            const data = await res.json();
            throw new Error(data.error || "Failed to update profile");
        }
    } catch (e) {
        showBetterError(e.message);
    } finally {
        setLoading(false);
    }
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
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const btn = document.getElementById('authMainBtn');
    const toggle = document.getElementById('authToggle');
    const regFields = document.getElementById('regFields');

    if (isLoginMode) {
        title.innerText = 'Welcome Back';
        subtitle.innerText = 'Please enter your details to sign in.';
        btn.innerText = 'Sign In';
        toggle.innerText = "Don't have an account? Create one";
        regFields.classList.add('hidden');
    } else {
        title.innerText = 'Create Account';
        subtitle.innerText = 'Join the vision. It only takes a minute.';
        btn.innerText = 'Register Now';
        toggle.innerText = "Already have an account? Sign In";
        regFields.classList.remove('hidden');
    }
}

async function handleAuth() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const nameInput = document.getElementById('authName').value;
    
    if (!email || !pass) return alert("Fill all fields");
    if (!isLoginMode && !nameInput) return alert("Name is required for registration");

    setLoading(true, isLoginMode ? "Signing In" : "Creating Account");
    const mode = isLoginMode ? 'login' : 'register';
    const name = isLoginMode ? email.split('@')[0] : nameInput;

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
        if (mode === 'register') {
            // Extended delay to ensure page elements are fully painted
            setTimeout(() => {
                if (document.getElementById('home').classList.contains('active')) {
                    startWelcomeTour();
                }
            }, 2500);
        }
    } catch (err) {
        showBetterError(err.message);
    } finally {
        setLoading(false);
    }
}

async function syncAllData() {
    if (!currentUser) return;
    setLoading(true, "Synchronizing Data");
    try {
        const syncTasks = [
            syncNotes(),
            syncAIHistory(),
            syncFunStats(),
            syncCricketHistory(),
            syncRandomHistory(),
            syncMusicPlaylist(),
            syncFocusData(),
            syncQuizLeaderboard(),
            syncSolveHistory()
        ];
        
        if (currentUser.isAdmin) {
            syncTasks.push(loadConfig());
            syncTasks.push(loadAdminUsers());
        }

        // Add loading of calendar events, alarms, world clocks here
        syncTasks.push(loadCalendarEvents());
        syncTasks.push(loadAlarms());
        syncTasks.push(loadWorldClocks());

        await Promise.all(syncTasks);
    } finally {
        setLoading(false);
    }
}

async function syncRandomHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=random_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            const hist = document.getElementById('omniHistory');
            hist.innerHTML = '';
            
            // Check for saved list content
            const savedList = data.find(item => item.id === 'saved_list_input');
            if (savedList && document.getElementById('listInput')) {
                document.getElementById('listInput').value = savedList.value;
            }

            // Filter out the meta-record from visible history
            const visibleHistory = data.filter(item => item.id !== 'saved_list_input');
            visibleHistory.slice(0, 50).forEach(item => addOmniHistory(item.value, false));
        }
    } catch (e) { console.warn("Random history sync failed", e); }
}

async function saveCurrentList() {
    if (!currentUser) return alert("Login to save your lists!");
    const content = document.getElementById('listInput').value;
    setLoading(true, "Saving List Content");
    try {
        await fetch(`/api/main?route=random_history&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'saved_list_input', value: content })
        });
        alert("List content saved to cloud!");
    } finally {
        setLoading(false);
    }
}

async function saveMusicPlaylist() {
    if (!currentUser) return;
    // We only save non-blob tracks (YouTube or external URLs) to the cloud
    const cloudTracks = musicList.filter(t => {
        // YouTube tracks have 'type' property. External URLs have 'url' but not starting with 'blob:'
        if (t.type === 'youtube') return true;
        if (t.url && !t.url.startsWith('blob:')) return true;
        return false;
    });
    
    try {
        await fetch(`/api/main?route=music_playlist&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'current_playlist', tracks: cloudTracks, timestamp: Date.now() })
        });
    } catch (e) { console.warn("Failed to save playlist to cloud", e); }
}

async function syncMusicPlaylist() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=music_playlist&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            const cloudTracks = data[0].tracks || [];
            // Preserve local tracks currently in the session
            const localTracks = musicList.filter(t => t.url?.startsWith('blob:'));
            musicList = [...cloudTracks, ...localTracks];
            renderPlaylist();
            showToast("Playlist synchronized.", "success");
        }
    } catch (e) { console.warn("Music playlist sync failed", e); }
}

function exportPlaylist() {
    // Only export non-blob tracks (YouTube or external URLs)
    const exportableTracks = musicList.filter(t => t.type === 'youtube' || (t.url && !t.url.startsWith('blob:')));
    
    if (exportableTracks.length === 0) {
        return showToast("No online tracks found to export.", "warning");
    }

    const playlistData = {
        version: "1.0",
        exportedBy: currentUser ? currentUser.name : "Guest",
        exportedAt: new Date().toISOString(),
        tracks: exportableTracks
    };

    const blob = new Blob([JSON.stringify(playlistData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sOuLViSiON_Playlist_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Playlist exported as JSON.", "success");
}

function importPlaylist(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const json = JSON.parse(event.target.result);
            const incomingTracks = Array.isArray(json) ? json : json.tracks;
            
            if (!incomingTracks || !Array.isArray(incomingTracks)) {
                throw new Error("Invalid playlist format.");
            }

            let addedCount = 0;
            incomingTracks.forEach(track => {
                // Prevent duplicates based on URL or YouTube ID
                const isDuplicate = musicList.some(t => 
                    (track.type === 'youtube' && t.id === track.id) || 
                    (track.url && t.url === track.url)
                );

                if (!isDuplicate) {
                    musicList.push(track);
                    if (isShuffle) shuffledIndices.push(musicList.length - 1);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                renderPlaylist();
                saveMusicPlaylist();
                showToast(`Imported ${addedCount} new tracks!`, "success");
                if (!isMusicPlaying && musicList.length === addedCount) playTrack(0);
            } else {
                showToast("All tracks already exist in library.", "info");
            }
        } catch (err) {
            console.error("Import Error:", err);
            showToast("Import failed: Invalid file.", "error");
        } finally {
            e.target.value = '';
        }
    };
    reader.readAsText(file);
}

function updateAuthUI() {
    if (currentUser && currentUser.theme) {
        setTheme(currentUser.theme);
    }
    const adminBtn = document.getElementById('adminBtn');
    const adminBtnSide = document.getElementById('adminBtnSide');
    const dashBtn = document.getElementById('dashboardBtn');
    const dashBtnSide = document.getElementById('dashboardBtnSide');
    const authBtn = document.getElementById('authBtn');
    const authBtnSide = document.getElementById('authBtnSide');
    
    if (currentUser) {
        document.getElementById('userNameDisplay').innerText = `Hey, ${currentUser.name}`;
        
        // Header Nav
        authBtn.innerHTML = '<i class="fas fa-power-off md:hidden"></i><span class="hidden md:inline">Logout</span>';
        authBtn.onclick = logout;

        // Sidebar
        if (authBtnSide) {
            authBtnSide.innerHTML = '<i class="fas fa-power-off w-8"></i> Logout';
            authBtnSide.onclick = logout;
        }

        dashBtn?.classList.remove('hidden');
        dashBtnSide?.classList.remove('hidden');
        if(currentUser.isAdmin) {
            adminBtn?.classList.remove('hidden');
            adminBtnSide?.classList.remove('hidden');
        }
    } else {
        dashBtn?.classList.add('hidden');
        dashBtnSide?.classList.add('hidden');
        adminBtn?.classList.add('hidden');
        adminBtnSide?.classList.add('hidden');
        document.getElementById('userNameDisplay').innerText = '';
        
        // Header Nav
        authBtn.innerHTML = '<i class="fas fa-sign-in-alt md:hidden"></i><span class="hidden md:inline">Login</span>';
        authBtn.onclick = () => showPage('login');

        // Sidebar
        if (authBtnSide) {
            authBtnSide.innerHTML = '<i class="fas fa-sign-in-alt w-8"></i> Login';
            authBtnSide.onclick = () => showPage('login');
        }
    }
}

function logout() {
    currentUser = null;
    notes = [];
    renderNotes();
    localStorage.removeItem('soulUser');
    localStorage.removeItem('soul_theme');
    setTheme('midnight'); 
    updateAuthUI();
    showPage('login');
}

// --- NOTES LOGIC ---
async function addNote() {
    if (!currentUser) return alert("Login to save notes!");
    const input = document.getElementById('noteInput');
    const titleInput = document.getElementById('noteTitle');
    const deadline = document.getElementById('noteDeadline').value;
    
    if (!input.value.trim() || input.value.trim() === "- [ ]") return;
    
    const note = { 
        id: Date.now(), 
        title: titleInput.value.trim() || null,
        text: input.value, 
        type: noteType,
        userId: currentUser.email,
        deadline: deadline || null
    };
    
    notes.unshift(note);
    renderNotes();
    
    sessionStorage.removeItem('soul_note_draft');
    document.getElementById('restoreDraftBtn').classList.add('hidden');
    
    // Reset fields
    input.value = '';
    titleInput.value = '';
    document.getElementById('noteDeadline').value = '';
    if (noteType === 'todo') input.value = "- [ ] ";
    
    // Force shrink back to base
    autoResize(input);
    
    updateEditorStats(input);
    showToast("Note anchored to the vault!", "success");
    await saveNotesToDB(note);
}

function renderNotes(providedNotes = null) {
    const list = document.getElementById('notesList');
    const sourceData = providedNotes || notes;
    
    const filteredNotes = providedNotes ? sourceData : sourceData.filter(n => {
        if (noteFilter === 'trash') return n.isDeleted;
        if (n.isDeleted) return false;
        if (noteFilter === 'all') return true;
        if (noteFilter === 'note') return (n.type === 'note' || !n.type);
        if (noteFilter === 'todo') return n.type === 'todo';
        return true;
    });

    if (filteredNotes.length === 0) {
        list.innerHTML = `<div class="col-span-full py-20 text-center opacity-30">
            <i class="fas ${noteFilter === 'todo' ? 'fa-tasks' : 'fa-sticky-note'} text-6xl mb-4"></i>
            <p>${noteFilter === 'all' ? 'Your vault is empty.' : 'No items found for this category.'}</p>
        </div>`;
        return;
    }

    const currentTheme = document.documentElement.getAttribute('data-theme');
    const isMinimalist = currentTheme === 'minimalist';
    
    list.innerHTML = filteredNotes.map(n => {
        let deadlineBadge = '';
        if (n.deadline) {
            const diff = new Date(n.deadline) - new Date();
            const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
            const colorClass = days < 0 ? 'text-red-400 bg-red-400/10' : days <= 2 ? 'text-orange-400 bg-orange-400/10' : 'text-cyan-400 bg-cyan-400/10';
            deadlineBadge = `<span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${colorClass}">${days < 0 ? 'OVERDUE' : days === 0 ? 'DUE TODAY' : days + ' DAYS LEFT'}</span>`;
        }

        const isTodo = n.type === 'todo';
        const displayTitle = n.title || (isTodo ? 'Task List' : 'Untitled Note');
        const isLocked = !!n.lockCode;
        const isPinned = !!n.isPinned;
        const isTrash = !!n.isDeleted;

        return `
            <div onclick="openNote('${n.id}')" ondblclick="openNote('${n.id}')" class="glass p-5 rounded-2xl border ${isPinned ? 'border-yellow-500 shadow-lg shadow-yellow-500/10' : (isTodo ? 'border-purple-500/20' : 'border-white/5')} flex flex-col h-full cursor-pointer hover:border-cyan-500/30 transition-all group relative overflow-hidden">
                <div class="absolute top-0 right-0 p-3 flex gap-2 z-10">
                    ${deadlineBadge}
                    ${isPinned ? '<i class="fas fa-thumbtack text-yellow-500 pinned-icon transform rotate-45"></i>' : ''}
                </div>
                <div class="mb-3">
                    <span class="text-[9px] font-black uppercase tracking-widest ${isTodo ? 'text-purple-400' : 'text-cyan-400'}">${isTodo ? 'Task List' : 'Note'}</span>
                    <h3 class="text-sm font-bold truncate pr-16 ${isMinimalist ? 'text-slate-900' : 'text-white'}">${displayTitle}</h3>
                </div>
                <div class="prose ${isMinimalist ? '' : 'prose-invert'} prose-sm max-h-48 overflow-hidden mb-6 flex-grow">
                    ${isLocked ? `
                        <div class="flex flex-col items-center justify-center py-4 text-gray-500 opacity-50">
                            <i class="fas fa-lock text-3xl mb-2"></i>
                            <p class="text-[10px] font-bold uppercase">Encrypted sOuLNOTE</p>
                        </div>
                    ` : `
                        ${renderMD(n.text, n.id)}
                    `}
                </div>
                <div class="flex justify-between items-center text-[10px] text-gray-500 pt-4 border-t border-white/5">
                    <div class="flex items-center gap-2">
                        <i class="far fa-calendar-alt"></i>
                        <span>${new Date(n.id).toLocaleDateString()}</span>
                    </div>
                    <div class="flex gap-4">
                        ${!isTrash ? `
                        <button onclick="event.stopPropagation(); togglePin('${n.id}')" class="text-gray-500 hover:text-yellow-500 transition text-sm" title="Pin Note"><i class="fas fa-thumbtack"></i></button>
                        <div class="relative group/export">
                            <button onclick="event.stopPropagation()" class="text-gray-500 hover:text-cyan-400 transition text-sm" title="Export Note"><i class="fas fa-file-export"></i></button>
                            <div class="absolute bottom-full right-0 pb-2 hidden group-hover/export:flex flex-col z-50 animate-fadeIn">
                                <div class="bg-gray-900 border border-white/10 rounded-xl shadow-2xl py-2 min-w-[100px] overflow-hidden">
                                    <button onclick="event.stopPropagation(); exportData('note', '${n.id}', 'pdf')" class="w-full px-4 py-2 text-left hover:bg-cyan-600/20 text-[10px] font-bold">PDF</button>
                                    <button onclick="event.stopPropagation(); exportData('note', '${n.id}', 'markdown')" class="w-full px-4 py-2 text-left hover:bg-cyan-600/20 text-[10px] font-bold">Markdown</button>
                                    <button onclick="event.stopPropagation(); exportData('note', '${n.id}', 'txt')" class="w-full px-4 py-2 text-left hover:bg-cyan-600/20 text-[10px] font-bold">Plain Text</button>
                                </div>
                            </div>
                        </div>
                        ` : `
                        <button onclick="event.stopPropagation(); restoreFromTrash('${n.id}')" class="text-green-400 hover:text-green-300 transition text-sm" title="Restore"><i class="fas fa-undo"></i></button>
                        `}
                        <button onclick="event.stopPropagation(); deleteNote('${n.id}', ${isTrash})" class="text-gray-500 hover:text-red-400 transition text-sm" title="${isTrash ? 'Permanent Delete' : 'Move to Trash'}"><i class="fas ${isTrash ? 'fa-fire' : 'fa-trash-can'}"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

let isSyncScrolling = false;
function handleEditorScroll(e) {
    if (isSyncScrolling) return;
    isSyncScrolling = true;
    const editor = e.target;
    const preview = document.getElementById('notePreview');
    const scrollRange = editor.scrollHeight - editor.clientHeight;
    if (preview && scrollRange > 0) {
        const scrollPercentage = editor.scrollTop / scrollRange;
        preview.scrollTop = scrollPercentage * (preview.scrollHeight - preview.clientHeight);
    }
    requestAnimationFrame(() => { isSyncScrolling = false; });
}

function handlePreviewScroll(e) {
    if (isSyncScrolling) return;
    isSyncScrolling = true;
    const preview = e.target;
    const editor = document.getElementById('editNoteText');
    const scrollRange = preview.scrollHeight - preview.clientHeight;
    if (editor && scrollRange > 0) {
        const scrollPercentage = preview.scrollTop / scrollRange;
        editor.scrollTop = scrollPercentage * (editor.scrollHeight - editor.clientHeight);
    }
    requestAnimationFrame(() => { isSyncScrolling = false; });
}

// --- sOuLCODE Diff Scroll Sync ---
let isDiffSyncScrolling = false;

function handleDiffOriginalScroll(e) {
    if (isDiffSyncScrolling) return;
    isDiffSyncScrolling = true;
    const origin = e.target;
    const target = document.getElementById('diffProposed');
    const scrollRange = origin.scrollHeight - origin.clientHeight;
    if (target && scrollRange > 0) {
        const scrollPercentage = origin.scrollTop / scrollRange;
        target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);
    }
    requestAnimationFrame(() => { isDiffSyncScrolling = false; });
}

function handleDiffProposedScroll(e) {
    if (isDiffSyncScrolling) return;
    isDiffSyncScrolling = true;
    const origin = e.target;
    const target = document.getElementById('diffOriginal');
    const scrollRange = origin.scrollHeight - origin.clientHeight;
    if (target && scrollRange > 0) {
        const scrollPercentage = origin.scrollTop / scrollRange;
        target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);
    }
    requestAnimationFrame(() => { isDiffSyncScrolling = false; });
}

function openNote(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (!note) return;

    if (note.lockCode) {
        const code = prompt("This note is protected. Enter access code:");
        if (code !== note.lockCode) {
            showToast("Access Denied", "error");
            return;
        }
    }

    const draft = sessionStorage.getItem(`soul_draft_${id}`);
    if (draft && draft !== note.text) {
        if (confirm("You have an unsaved draft for this note. Restore it?")) {
            note.text = draft;
        } else {
            sessionStorage.removeItem(`soul_draft_${id}`);
        }
    }

    document.getElementById('editNoteId').value = id;
    const editor = document.getElementById('editNoteText');
    editor.value = note.text;
    document.getElementById('editNoteDeadline').value = note.deadline || '';
    document.getElementById('editNoteMeta').innerText = `CREATED: ${new Date(id).toLocaleString()}`;
    document.getElementById('wordGoal').value = note.wordGoal || 0;
    
    updateEditorStats(editor);
    autoResize(editor);
    updateGoalProgress();
    
    document.getElementById('noteModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Lock background scroll
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.add('hidden');
    document.body.style.overflow = '';
}

async function saveEditedNote(isAutoSave = false) {
    const id = parseInt(document.getElementById('editNoteId').value);
    const text = document.getElementById('editNoteText').value;
    const deadline = document.getElementById('editNoteDeadline').value;
    const wordGoal = parseInt(document.getElementById('wordGoal').value) || 0;

    const noteIdx = notes.findIndex(n => n.id === id);
    
    if (noteIdx > -1) {
        const updatedFields = { 
            text, 
            deadline: deadline || null, 
            wordGoal
        };

        Object.assign(notes[noteIdx], updatedFields);
        renderNotes();
        
        if (!isAutoSave) {
            closeNoteModal();
            sessionStorage.removeItem(`soul_draft_${id}`);
            showToast("Changes committed to cloud.", "success");
        }
        
        try {
            await fetch(`/api/main?route=notes&id=${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedFields)
            });
        } catch (e) { console.error("Cloud sync error:", e); }
    }
}

async function deleteNote(id, permanent = false) {
    id = Number(id);
    const msg = permanent ? "Permanently delete this note? This cannot be undone." : "Move this note to Trash? It will be kept for 30 days.";
    if(!confirm(msg)) return;
    
    if (permanent) {
        notes = notes.filter(n => n.id !== id);
    } else {
        const note = notes.find(n => n.id === id);
        if (note) {
            note.isDeleted = true;
            note.deletedAt = Date.now();
        }
    }
    
    renderNotes();
    showToast(permanent ? "Note purged." : "Note moved to Trash.", "warning");
    
    try {
        await fetch(`/api/main?route=notes&id=${id}&perm=${permanent}`, { method: 'DELETE' });
    } catch (e) { console.error("Delete failed:", e); }
}

async function restoreFromTrash(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (note) {
        note.isDeleted = false;
        renderNotes();
        await fetch(`/api/main?route=notes&id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isDeleted: false })
        });
        showToast("Note restored from trash.", "success");
    }
}

async function syncNotes(silent = true, showTrash = false) {
    if(!currentUser) return;
    const list = document.getElementById('notesList');
    if (list) {
        list.innerHTML = Array(3).fill('<div class="skeleton-card"></div>').join('');
    }
    const res = await fetch(`/api/main?route=notes&userId=${encodeURIComponent(currentUser.email)}&trash=${showTrash}`);
    const data = await res.json();
    if(Array.isArray(data)) {
        notes = data;
        renderNotes();
    }
}

async function saveNotesToDB(note) {
    if(!currentUser) return false;
    const statusEl = document.getElementById('syncStatus');
    if (statusEl) {
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';
        statusEl.classList.replace('text-gray-500', 'text-cyan-400');
    }
    try {
        const res = await fetch('/api/main?route=notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
        });
        if (res.ok && statusEl) {
            statusEl.innerHTML = '<i class="fas fa-check-circle mr-1 text-green-500"></i> Synced';
            statusEl.classList.replace('text-cyan-400', 'text-green-500');
            setTimeout(() => {
                statusEl.innerHTML = '';
                statusEl.classList.replace('text-green-500', 'text-gray-500');
            }, 3000);
        }
        return res.ok;
    } catch (e) {
        console.error("Failed to save note", e);
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> Sync Failed';
            statusEl.classList.replace('text-cyan-400', 'text-red-500');
        }
        return false;
    }
}

// --- RANDOMIZER LOGIC ---
async function saveRandomHistory(type, value) {
    if (!currentUser) return;
    await fetch(`/api/main?route=random_history&userId=${encodeURIComponent(currentUser.email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value })
    });
}

function updateRandomMode() {
    const mode = document.getElementById('randMode').value;
    document.querySelectorAll('.rand-cfg').forEach(el => el.classList.add('hidden'));
    document.getElementById(`cfg_${mode}`).classList.remove('hidden');
    
    // UI Reset
    const btn = document.getElementById('mainGenBtn');
    btn.classList.remove('hidden');
    if (mode === 'dice' || mode === 'list') btn.classList.add('hidden');
}

async function generateOmniRandom() {
    const mode = document.getElementById('randMode').value;
    const resText = document.getElementById('omniResultText');
    const resMeta = document.getElementById('omniResultMeta');
    const preview = document.getElementById('omniResultPreview');
    
    let result = "";
    let meta = "";
    preview.style.backgroundColor = 'transparent';

    if (mode === 'number') {
        const min = parseInt(document.getElementById('numMin').value);
        const max = parseInt(document.getElementById('numMax').value);
        const count = parseInt(document.getElementById('numCount').value);
        const unique = document.getElementById('numUnique').checked;
        
        let nums = [];
        if (unique && count > (max - min + 1)) {
            alert("Count cannot be larger than the range for unique numbers.");
            return;
        }

        while (nums.length < count) {
            let r = Math.floor(Math.random() * (max - min + 1)) + min;
            if (!unique || !nums.includes(r)) nums.push(r);
        }
        result = nums.join(', ');
        meta = `Generated ${count} number(s) [${min} to ${max}]`;
    } 
    else if (mode === 'color') {
        const format = document.getElementById('colorFormat').value;
        if (format === 'hex') {
            result = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0').toUpperCase();
        } else if (format === 'rgb') {
            const r = Math.floor(Math.random()*256), g = Math.floor(Math.random()*256), b = Math.floor(Math.random()*256);
            result = `rgb(${r}, ${g}, ${b})`;
        } else {
            const h = Math.floor(Math.random()*361), s = Math.floor(Math.random()*101), l = Math.floor(Math.random()*101);
            result = `hsl(${h}, ${s}%, ${l}%)`;
        }
        preview.style.backgroundColor = result;
        meta = `Random ${format.toUpperCase()} color`;
    }
    else if (mode === 'string') {
        const len = parseInt(document.getElementById('strLen').value);
        const u = document.getElementById('strUpper').checked ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '';
        const l = document.getElementById('strLower').checked ? 'abcdefghijklmnopqrstuvwxyz' : '';
        const n = document.getElementById('strNum').checked ? '0123456789' : '';
        const s = document.getElementById('strSym').checked ? '!@#$%^&*()_+~`|}{[]:;?><,./-=' : '';
        const pool = u + l + n + s;
        if (!pool) return alert("Select at least one character type.");
        
        for (let i = 0; i < len; i++) result += pool.charAt(Math.floor(Math.random() * pool.length));
        meta = `Secure string generated (${len} chars)`;
    }
    else if (mode === 'datetime') {
        const start = new Date(document.getElementById('dateStart').value || '1970-01-01').getTime();
        const end = new Date(document.getElementById('dateEnd').value || Date.now()).getTime();
        const randTime = Math.floor(Math.random() * (end - start + 1)) + start;
        const d = new Date(randTime);
        result = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        meta = "Random timestamp within range";
    }

    resText.innerText = result;
    resMeta.innerText = meta;
    addOmniHistory(result, true);
    showToast("Randomization complete.", "info");
    await saveRandomHistory(mode, result);
}

function pickFromList(type) {
    const raw = document.getElementById('listInput').value;
    const items = raw.split(/[\n,]/).map(i => i.trim()).filter(i => i);
    if (!items.length) return alert("Please enter some items.");

    const resText = document.getElementById('omniResultText');
    const resMeta = document.getElementById('omniResultMeta');
    
    if (type === 'pick') {
        const res = items[Math.floor(Math.random() * items.length)];
        resText.innerText = res;
        resMeta.innerText = `Selected from ${items.length} items`;
        addOmniHistory(res, true);
        saveRandomHistory('list-pick', res);
    } else {
        const shuffled = [...items].sort(() => Math.random() - 0.5);
        const resVal = shuffled.join(' → ');
        resText.innerText = resVal;
        resMeta.innerText = `Shuffled ${items.length} items`;
        addOmniHistory(resVal, true);
        saveRandomHistory('list-shuffle', shuffled.join(', '));
    }
}

function rollDice(sides) {
    const resText = document.getElementById('omniResultText');
    const resMeta = document.getElementById('omniResultMeta');
    
    if (sides === 2) {
        const coin = document.getElementById('coin');
        const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
        
        coin.classList.remove('flipping-heads', 'flipping-tails');
        void coin.offsetWidth; // reflow
        coin.classList.add(`flipping-${result.toLowerCase()}`);
        
        if (window.navigator.vibrate) window.navigator.vibrate(20);

        setTimeout(() => {
            resText.innerText = result;
            resMeta.innerText = "Aureum Coin Result";
            addOmniHistory(result, true);
            saveRandomHistory('dice', result);
        }, 1200);
    } else {
        const res = Math.floor(Math.random() * sides) + 1;
        resText.innerText = res;
        resMeta.innerText = `D${sides} Dice Roll`;
        addOmniHistory(resText.innerText, true);
        saveRandomHistory('dice', resText.innerText);
    }
}

function addOmniHistory(val, isNew = true) {
    const hist = document.getElementById('omniHistory');
    if (hist.querySelector('p')) hist.innerHTML = '';
    const span = document.createElement('span');
    span.className = "px-2 py-1 bg-white/5 border border-white/5 rounded text-[10px] text-gray-400 font-mono cursor-pointer hover:bg-white/10 transition max-w-[150px] truncate";
    span.innerText = val;
    span.onclick = () => {
        document.getElementById('omniResultText').innerText = val;
        navigator.clipboard.writeText(val);
    };
    hist.prepend(span);
}

function copyOmniResult() {
    const txt = document.getElementById('omniResultText').innerText;
    if (txt === "...") return;
    navigator.clipboard.writeText(txt);
    showToast("Copied to clipboard!", "info");
}

// --- MUSIC PLAYER LOGIC ---
// YouTube API Init
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('youtubePlayer', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 0,
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'rel': 0,
            'modestbranding': 1,
            'origin': window.location.origin
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    const savedVol = localStorage.getItem('soulVolume');
    if (savedVol !== null) {
        event.target.setVolume(parseFloat(savedVol) * 100);
    }
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        isMusicPlaying = true;
        startYTProgress();
        updateMusicUI();
    } else if (event.data === YT.PlayerState.PAUSED) {
        isMusicPlaying = false;
        stopYTProgress();
        updateMusicUI();
    } else if (event.data === YT.PlayerState.ENDED) {
        if (!isRepeat) musicNext();
    }
}

function startYTProgress() {
    stopYTProgress();
    ytProgressInterval = setInterval(() => {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            const cur = ytPlayer.getCurrentTime();
            const dur = ytPlayer.getDuration();
            const prog = document.getElementById('musicProgress');
            if (dur > 0) {
                prog.value = (cur / dur) * 100;
                document.getElementById('currentTime').innerText = formatTime(cur);
                document.getElementById('durationTime').innerText = formatTime(dur);
            }
        }
    }, 500);
}

function stopYTProgress() {
    if (ytProgressInterval) clearInterval(ytProgressInterval);
}

function toggleVisualMode() {
    isVideoMode = !isVideoMode;
    const disk = document.getElementById('vinylDisk');
    const player = document.getElementById('ytPlayerContainer');
    const btn = document.getElementById('visualModeBtn');

    if (isVideoMode) {
        disk.classList.add('opacity-0');
        player.classList.remove('opacity-0');
        btn.innerHTML = '<i class="fas fa-music mr-1"></i> AUDIO MODE';
        btn.classList.replace('bg-black/60', 'bg-cyan-600');
    } else {
        disk.classList.remove('opacity-0');
        player.classList.add('opacity-0');
        btn.innerHTML = '<i class="fas fa-eye mr-1"></i> VIDEO MODE';
        btn.classList.replace('bg-cyan-600', 'bg-black/60');
    }
}

function toggleMusicSection(sectionId) {
    const container = document.getElementById(sectionId);
    const chevron = sectionId === 'ytResultsContainer' ? document.getElementById('ytResultsChevron') : document.getElementById('localPlaylistChevron');
    
    const isCollapsed = container.classList.toggle('collapsed-music-section');
    if (chevron) {
        chevron.style.transform = isCollapsed ? 'rotate(-180deg)' : 'rotate(0deg)';
    }
}

function setPlayMode(mode) {
    playMode = mode;
    const onlineBtn = document.getElementById('modeOnline');
    const offlineBtn = document.getElementById('modeOffline');
    const searchBox = document.getElementById('ytResultsContainer');
    const libraryBox = document.getElementById('localPlaylistContainer');
    const addBtn = document.getElementById('addLocalBtn');

    if (mode === 'online') {
        onlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all bg-cyan-600 text-white";
        offlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all text-gray-400";
        searchBox.classList.remove('hidden');
        searchBox.classList.add('flex');
        addBtn.classList.add('hidden');
    } else {
        offlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all bg-cyan-600 text-white";
        onlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all text-gray-400";
        searchBox.classList.add('hidden');
        searchBox.classList.remove('flex');
        addBtn.classList.remove('hidden');
        addBtn.classList.add('flex');
        addBtn.classList.replace('text-[10px]', 'text-[9px]');
        // Ensure library is expanded if it was collapsed when switching to offline mode
        if (libraryBox.classList.contains('collapsed-music-section')) {
            toggleMusicSection('localPlaylistContainer');
        }
    }
}

function handleSearchOrUrl() {
    const input = document.getElementById('ytSearchInput').value.trim();
    if (!input) return;

    // Detect YouTube URL
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = input.match(ytRegex);

    if (match) {
        const videoId = match[1];
        const title = prompt("Enter track title:", "YouTube Video") || "YouTube Video";
        addYTTrack(videoId, title, "URL Source");
        document.getElementById('ytSearchInput').value = '';
    } else if (input.startsWith('http') && (input.toLowerCase().includes('.mp3') || input.toLowerCase().includes('.wav') || input.toLowerCase().includes('.ogg') || input.toLowerCase().includes('.m4a'))) {
        // Direct Audio URL
        const defaultName = input.split('/').pop().split('?')[0] || "Audio Stream";
        const name = prompt("Enter track title:", defaultName) || defaultName;
        const track = { name, url: input, artist: "External URL" };
        const newIdx = musicList.length;
        musicList.push(track);
        if (isShuffle) shuffledIndices.push(newIdx);
        renderPlaylist();
        if (musicList.length === 1) playTrack(0);
        document.getElementById('ytSearchInput').value = '';

        const statusMsg = document.createElement('div');
        statusMsg.className = "fixed bottom-24 right-4 bg-cyan-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg animate-bounce z-[100]";
        statusMsg.innerText = "Added to sOuLPLAY Library";
        document.body.appendChild(statusMsg);
        setTimeout(() => statusMsg.remove(), 2000);

        saveMusicPlaylist();
    } else {
        searchYT();
    }
}

async function searchYT() {
    const query = document.getElementById('ytSearchInput').value;
    if (!query) return;
    const list = document.getElementById('ytResultsList');
    list.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin text-cyan-500"></i></div>';

    try {
        const res = await fetch(`/api/main?route=yt_search&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        list.innerHTML = data.map(v => `
            <div onclick="addYTTrack('${v.videoId}', '${v.title.replace(/'/g, "\\'")}', '${v.author.name.replace(/'/g, "\\'")}')" class="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 cursor-pointer group transition">
                <img src="${v.thumbnail}" class="w-12 h-12 rounded-lg object-cover shadow-lg">
                <div class="flex-grow overflow-hidden">
                    <p class="text-xs font-bold truncate">${v.title}</p>
                    <p class="text-[10px] text-gray-500">${v.author.name} • ${v.duration.timestamp}</p>
                </div>
                <i class="fas fa-plus text-cyan-500 opacity-0 group-hover:opacity-100 transition"></i>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<p class="text-red-500 text-xs">Search failed.</p>';
    }
}

function addYTTrack(id, title, artist, instant = false) {
    const track = { type: 'youtube', id, name: title, artist: artist };
    const existingIdx = musicList.findIndex(t => t.id === id);
    
    let playIdx;
    if (existingIdx === -1) {
        musicList.push(track);
        playIdx = musicList.length - 1;
        if (isShuffle) shuffledIndices.push(playIdx);
    } else {
        playIdx = existingIdx;
    }

    renderPlaylist();
    
    if (instant || musicList.length === 1) {
        playTrack(playIdx);
        if (instant) closeYTExplorer();
    }
    
    showToast(`${title} ${existingIdx === -1 ? 'added to' : 'playing from'} Library`, "success");
    saveMusicPlaylist();
}

// --- YOUTUBE EXPLORER LOGIC ---
let explorerResults = [];
let explorerCurrentPage = 1;
const explorerPageSize = 10;
let suggestionTimeout = null;

async function openYTExplorer() {
    document.getElementById('ytExplorerModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loadYTDiscovery('trending music');
}

function closeYTExplorer() {
    document.getElementById('ytExplorerModal').classList.add('hidden');
    document.body.style.overflow = '';
    hideYTSuggestions();
}

async function handleYTSuggestions(input, isMobile = false) {
    const query = input.value.trim();
    const listId = isMobile ? 'ytSuggestionsMobile' : 'ytSuggestions';
    const list = document.getElementById(listId);

    if (query.length < 2) {
        list.classList.add('hidden');
        return;
    }

    clearTimeout(suggestionTimeout);
    suggestionTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/main?route=yt_suggest&q=${encodeURIComponent(query)}`);
            const suggestions = await res.json();
            
            if (suggestions.length > 0) {
                list.innerHTML = suggestions.map(s => `
                    <div onclick="selectYTSuggestion('${s.replace(/'/g, "\\'")}', ${isMobile})" class="px-4 py-2 hover:bg-white/5 cursor-pointer text-xs font-medium text-gray-300 border-b border-white/5 last:border-0">${s}</div>
                `).join('');
                list.classList.remove('hidden');
            } else {
                list.classList.add('hidden');
            }
        } catch (e) {
            list.classList.add('hidden');
        }
    }, 300);
}

function selectYTSuggestion(val, isMobile) {
    const inputId = isMobile ? 'ytExplorerInputMobile' : 'ytExplorerInput';
    document.getElementById(inputId).value = val;
    hideYTSuggestions();
    searchYTExplorer(isMobile);
}

function hideYTSuggestions() {
    document.getElementById('ytSuggestions').classList.add('hidden');
    document.getElementById('ytSuggestionsMobile').classList.add('hidden');
}

async function loadYTDiscovery(category) {
    await searchYTExplorer(false, category);
}

async function searchYTExplorer(isMobile = false, category = null) {
    const query = category || document.getElementById(isMobile ? 'ytExplorerInputMobile' : 'ytExplorerInput').value;
    if (!query) return;
    
    hideYTSuggestions();
    const resultsGrid = document.getElementById('ytExplorerResults');
    const pagination = document.getElementById('ytExplorerPagination');
    resultsGrid.innerHTML = Array(10).fill('<div class="skeleton h-64"></div>').join('');
    pagination.classList.add('hidden');

    try {
        const res = await fetch(`/api/main?route=yt_search&explorer=true&q=${encodeURIComponent(query)}`);
        explorerResults = await res.json();
        explorerCurrentPage = 1;
        renderExplorerPage();
    } catch (e) {
        resultsGrid.innerHTML = '<p class="col-span-full text-center text-red-500">Search Failed.</p>';
    }
}

function renderExplorerPage() {
    const resultsGrid = document.getElementById('ytExplorerResults');
    const pagination = document.getElementById('ytExplorerPagination');
    const pageNumEl = document.getElementById('explorerPageNum');
    const prevBtn = document.getElementById('prevExplorerPage');
    const nextBtn = document.getElementById('nextExplorerPage');

    if (!explorerResults || explorerResults.length === 0) {
        resultsGrid.innerHTML = '<p class="col-span-full text-center text-gray-500">No results found.</p>';
        pagination.classList.add('hidden');
        return;
    }

    const start = (explorerCurrentPage - 1) * explorerPageSize;
    const end = start + explorerPageSize;
    const pageData = explorerResults.slice(start, end);
    const totalPages = Math.ceil(explorerResults.length / explorerPageSize);

    resultsGrid.innerHTML = pageData.map(v => `
        <div class="bg-white/5 rounded-2xl overflow-hidden border border-white/5 group hover:border-red-500/50 transition-all duration-300 flex flex-col h-full">
            <div class="relative aspect-video overflow-hidden">
                <img src="${v.thumbnail}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                <div class="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded text-[10px] font-bold text-white">${v.duration.timestamp}</div>
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                    <button onclick="addYTTrack('${v.videoId}', '${v.title.replace(/'/g, "\\'")}', '${v.author.name.replace(/'/g, "\\'")}', true)" class="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center text-xl hover:scale-110 transition active:scale-95 shadow-xl shadow-red-600/40">
                        <i class="fas fa-play ml-1"></i>
                    </button>
                </div>
            </div>
            <div class="p-4 flex flex-col flex-grow">
                <h4 class="text-sm font-bold text-white line-clamp-2 mb-2 group-hover:text-red-400 transition-colors">${v.title}</h4>
                <p class="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-auto mb-3">${v.author.name}</p>
                <div class="flex gap-2">
                    <button onclick="addYTTrack('${v.videoId}', '${v.title.replace(/'/g, "\\'")}', '${v.author.name.replace(/'/g, "\\'")}')" class="flex-grow bg-white/5 hover:bg-white/10 text-[9px] font-black uppercase py-2 rounded-lg border border-white/10 transition">Add to Queue</button>
                </div>
            </div>
        </div>
    `).join('');

    pagination.classList.remove('hidden');
    pageNumEl.innerText = `Page ${explorerCurrentPage} of ${totalPages}`;
    prevBtn.disabled = explorerCurrentPage === 1;
    nextBtn.disabled = explorerCurrentPage === totalPages;
    
    const container = resultsGrid.parentElement;
    container.scrollTop = 0;
}

function changeExplorerPage(delta) {
    const totalPages = Math.ceil(explorerResults.length / explorerPageSize);
    const newPage = explorerCurrentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        explorerCurrentPage = newPage;
        renderExplorerPage();
    }
}

let isShuffle = false;
let shuffledIndices = [];
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
    
    // Set internal resolution to match display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

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
    const startIndex = musicList.length;
    const newTracks = files.map(f => ({ name: f.name.replace(/\.[^/.]+$/, ""), url: URL.createObjectURL(f) }));
    musicList = [...musicList, ...newTracks];
    
    if (isShuffle) {
        const newIndices = newTracks.map((_, i) => startIndex + i);
        shuffledIndices = [...shuffledIndices, ...newIndices];
    }
    
    renderPlaylist();
    if(musicList.length > 0 && !audioPlayer.src) playTrack(0);
}

function renderPlaylist() {
    const container = document.getElementById('playlistContainer');
    const bulkBar = document.getElementById('musicBulkActions');
    const shuffleTag = isShuffle ? '<span class="text-[8px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded ml-2 font-bold tracking-widest animate-pulse">SHUFFLE ON</span>' : '';
    const repeatTag = isRepeat ? '<span class="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded ml-2 font-bold tracking-widest animate-pulse">REPEAT ON</span>' : '';
    
    if (musicList.length === 0) {
        container.innerHTML = `<p class="text-[10px] text-gray-500 italic">No tracks added yet.</p>`;
        bulkBar.classList.add('hidden');
        selectedTracks.clear();
        return;
    }

    bulkBar.classList.remove('hidden');
    document.getElementById('musicSelectionCount').innerText = `${selectedTracks.size} selected`;
    document.getElementById('selectAllMusic').checked = (selectedTracks.size === musicList.length && musicList.length > 0);

    const displayIndices = isShuffle ? shuffledIndices : musicList.map((_, i) => i);

    container.innerHTML = `
        <div class="flex gap-1 mb-3">${shuffleTag}${repeatTag}</div>
        ${displayIndices.map((originalIdx, displayIdx) => {
            const t = musicList[originalIdx];
            const isActive = originalIdx === currentTrackIndex;
            const isSelected = selectedTracks.has(originalIdx);
            return `
                <div class="flex items-center gap-3 p-2 rounded-lg group hover:bg-white/5 transition ${isActive ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}">
                    <input type="checkbox" class="accent-cyan-500" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleTrackSelection(${originalIdx})">
                    <div onclick="playTrack(${originalIdx})" class="w-6 h-6 flex items-center justify-center bg-black/20 rounded text-[10px] font-mono cursor-pointer">${displayIdx + 1}</div>
                    <div onclick="playTrack(${originalIdx})" class="flex flex-col flex-grow overflow-hidden cursor-pointer">
                        <span class="text-xs truncate ${isActive ? 'text-cyan-400 font-bold' : 'text-gray-300'}">${t.name}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        ${isActive && isMusicPlaying ? '<div class="playing-bars"><span></span><span></span><span></span></div>' : ''}
                        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                            ${!isShuffle ? `
                                <button onclick="moveTrack(${originalIdx}, -1)" class="text-[10px] text-gray-500 hover:text-cyan-400" title="Move Up"><i class="fas fa-chevron-up"></i></button>
                                <button onclick="moveTrack(${originalIdx}, 1)" class="text-[10px] text-gray-500 hover:text-cyan-400" title="Move Down"><i class="fas fa-chevron-down"></i></button>
                            ` : ''}
                            <button onclick="renameTrack(${originalIdx})" class="text-[10px] text-gray-500 hover:text-cyan-400" title="Rename"><i class="fas fa-edit"></i></button>
                            <button onclick="deleteTrack(${originalIdx})" class="text-[10px] text-gray-500 hover:text-red-400" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

function toggleTrackSelection(idx) {
    if (selectedTracks.has(idx)) selectedTracks.delete(idx);
    else selectedTracks.add(idx);
    renderPlaylist();
}

function selectAllTracks(checked) {
    if (checked) {
        musicList.forEach((_, i) => selectedTracks.add(i));
    } else {
        selectedTracks.clear();
    }
    renderPlaylist();
}

function deleteSelectedTracks() {
    if (selectedTracks.size === 0) return;
    if (!confirm(`Delete ${selectedTracks.size} tracks?`)) return;
    
    const sortedToKeep = musicList.filter((_, i) => !selectedTracks.has(i));
    
    // Revoke blobs for deleted tracks
    musicList.forEach((t, i) => {
        if (selectedTracks.has(i) && t.url && t.url.startsWith('blob:')) {
            URL.revokeObjectURL(t.url);
        }
    });

    const currentTrack = musicList[currentTrackIndex];
    musicList = sortedToKeep;
    selectedTracks.clear();
    
    // Re-index shuffle if active
    if (isShuffle) {
        shuffledIndices = musicList.map((_, i) => i);
        // ... re-shuffle ... (simplified for now)
    }

    if (musicList.length === 0) {
        audioPlayer.pause(); audioPlayer.src = ''; isMusicPlaying = false;
        document.getElementById('trackName').innerText = "No Track Loaded";
    } else {
        const newIdx = musicList.indexOf(currentTrack);
        currentTrackIndex = newIdx > -1 ? newIdx : 0;
        if (newIdx === -1) playTrack(0);
    }
    
    renderPlaylist();
    updateMusicUI();
    saveMusicPlaylist();
}

function deleteTrack(index) {
    const isCurrent = (index === currentTrackIndex);
    if (musicList[index].url && musicList[index].url.startsWith('blob:')) {
        URL.revokeObjectURL(musicList[index].url);
    }
    
    musicList.splice(index, 1);
    
    if (isShuffle) {
        shuffledIndices = shuffledIndices.filter(i => i !== index).map(i => i > index ? i - 1 : i);
    }
    
    if (musicList.length === 0) {
        audioPlayer.pause();
        audioPlayer.src = '';
        isMusicPlaying = false;
        shuffledIndices = [];
        document.getElementById('trackName').innerText = "No Track Loaded";
        document.getElementById('artistName').innerText = "Upload local tracks to begin";
        updateMusicUI();
    } else if (isCurrent) {
        let nextToPlay = index % musicList.length;
        if (isShuffle && shuffledIndices.length > 0) {
            nextToPlay = shuffledIndices[0];
        }
        playTrack(nextToPlay);
    } else if (index < currentTrackIndex) {
        currentTrackIndex--;
    }
    renderPlaylist();
    saveMusicPlaylist();
}

function renameTrack(index) {
    const newName = prompt("Rename track:", musicList[index].name);
    if (newName && newName.trim()) {
        musicList[index].name = newName.trim();
        if (index === currentTrackIndex) {
            document.getElementById('trackName').innerText = newName.trim();
        }
        renderPlaylist();
        saveMusicPlaylist();
    }
}

function playTrack(index) {
    if (index < 0 || index >= musicList.length) return;
    currentTrackIndex = index;
    const track = musicList[index];

    // Reset both players
    audioPlayer.pause();
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    stopYTProgress();

    document.getElementById('trackName').innerText = track.name;
    document.getElementById('artistName').innerText = track.artist || "Local Storage Track";

    // Media Session API Integration for OS Lock Screen Controls
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.artist || "sOuLPLAY Library",
            album: "sOuLViSiON",
            artwork: [{ src: 'logo.svg', sizes: '512x512', type: 'image/svg+xml' }]
        });

        const actions = [
            ['play', () => toggleMusic()],
            ['pause', () => toggleMusic()],
            ['previoustrack', () => musicPrev()],
            ['nexttrack', () => musicNext()],
            ['seekbackward', (details) => musicSkip(-(details.seekOffset || 10))],
            ['seekforward', (details) => musicSkip(details.seekOffset || 10)],
            ['stop', () => { if(isMusicPlaying) toggleMusic(); }]
        ];

        for (const [action, handler] of actions) {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
        }
    }

    if (track.type === 'youtube') {
        if (ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(track.id);
            if (isCCEnabled) ytPlayer.loadModule('captions');
            else ytPlayer.unloadModule('captions');
            ytPlayer.playVideo();
            isMusicPlaying = true;
            // Background play hint for mobile
            if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                showToast("Note: Standard mobile browsers may pause YouTube in background.", "info", 5000);
            }
        }
    } else {
        initAudioContext();
        if (audioContext.state === 'suspended') audioContext.resume();
        audioPlayer.src = track.url;
        audioPlayer.play().catch(e => console.log("Playback blocked"));
        isMusicPlaying = true;
    }

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isMusicPlaying ? "playing" : "paused";
    }
    
    updateMusicUI();
    renderPlaylist();
}

function toggleMusic() {
    const track = musicList[currentTrackIndex];
    if (!track) return;

    if (track.type === 'youtube') {
        const state = ytPlayer.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            ytPlayer.pauseVideo();
            isMusicPlaying = false;
        } else {
            ytPlayer.playVideo();
            isMusicPlaying = true;
        }
    } else {
        if (!audioPlayer.src) return;
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        if (isMusicPlaying) audioPlayer.pause();
        else audioPlayer.play();
        isMusicPlaying = !isMusicPlaying;
    }
    updateMusicUI();
    renderPlaylist();
}

function musicNext() {
    if(musicList.length === 0) return;
    if(isShuffle && shuffledIndices.length > 0) {
        let currentDisplayIdx = shuffledIndices.indexOf(currentTrackIndex);
        let nextDisplayIdx = (currentDisplayIdx + 1) % shuffledIndices.length;
        playTrack(shuffledIndices[nextDisplayIdx]);
    } else {
        playTrack((currentTrackIndex + 1) % musicList.length);
    }
}

function musicPrev() {
    if(musicList.length === 0) return;
    if(isShuffle && shuffledIndices.length > 0) {
        let currentDisplayIdx = shuffledIndices.indexOf(currentTrackIndex);
        let prevDisplayIdx = (currentDisplayIdx - 1 + shuffledIndices.length) % shuffledIndices.length;
        playTrack(shuffledIndices[prevDisplayIdx]);
    } else {
        playTrack((currentTrackIndex - 1 + musicList.length) % musicList.length);
    }
}

function musicSkip(seconds) {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube') {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            ytPlayer.seekTo(ytPlayer.getCurrentTime() + seconds, true);
        }
    } else {
        audioPlayer.currentTime += seconds;
    }
}

function toggleSubtitles() {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube' && ytPlayer) {
        isCCEnabled = !isCCEnabled;
        if (isCCEnabled) {
            ytPlayer.loadModule('captions');
        } else {
            ytPlayer.unloadModule('captions');
        }
        const btn = document.getElementById('ccBtn');
        if (btn) btn.classList.toggle('control-active', isCCEnabled);
        showToast(isCCEnabled ? "Captions Enabled" : "Captions Disabled", "info");
    } else {
        showToast("Subtitles available only for sOuLPLAY Cloud tracks.", "warning");
    }
}

function setPlaybackSpeed(speed) {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube') {
        if (ytPlayer && ytPlayer.setPlaybackRate) {
            ytPlayer.setPlaybackRate(parseFloat(speed));
        }
    } else {
        audioPlayer.playbackRate = parseFloat(speed);
    }
}

function setSleepTimer(minutes) {
    if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
    }
    
    if (minutes === 0) {
        alert("Sleep timer disabled.");
        return;
    }
    
    alert(`Sleep timer set for ${minutes} minutes.`);
    sleepTimer = setTimeout(() => {
        if (isMusicPlaying) toggleMusic();
        alert("Sleep timer active: Music paused.");
        sleepTimer = null;
    }, minutes * 60000);
}

function toggleFullScreen(id) {
    const el = document.getElementById(id);
    if (!document.fullscreenElement) {
        el.requestFullscreen().catch(err => {
            alert(`Error attempting to enable full-screen mode: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle && musicList.length > 0) {
        shuffledIndices = musicList.map((_, i) => i);
        for (let i = shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
        }
    }
    document.getElementById('shuffleBtn').classList.toggle('control-active', isShuffle);
    renderPlaylist();
}

function shuffleAndPlay() {
    if (musicList.length === 0) return showToast("Add some music first!", "warning");
    
    // Enable and force a fresh shuffle
    isShuffle = true;
    shuffledIndices = musicList.map((_, i) => i);
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }
    
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) shuffleBtn.classList.add('control-active');
    
    renderPlaylist();
    
    // Play the first song in the newly shuffled sequence
    playTrack(shuffledIndices[0]);
    showToast("Shuffle & Play sequence initiated.", "info");
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
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube') {
        const seek = (e.target.value / 100) * ytPlayer.getDuration();
        ytPlayer.seekTo(seek, true);
    } else {
        const seekTime = (e.target.value / 100) * audioPlayer.duration;
        audioPlayer.currentTime = seekTime;
    }
});

document.getElementById('volumeControl').addEventListener('input', (e) => {
    const vol = e.target.value;
    audioPlayer.volume = vol;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(vol * 100);
    localStorage.setItem('soulVolume', vol);
});

function moveTrack(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= musicList.length) return;
    
    const temp = musicList[index];
    musicList[index] = musicList[newIndex];
    musicList[newIndex] = temp;
    
    if (currentTrackIndex === index) {
        currentTrackIndex = newIndex;
    } else if (currentTrackIndex === newIndex) {
        currentTrackIndex = index;
    }
    
    renderPlaylist();
    saveMusicPlaylist();
}

document.getElementById('ytSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearchOrUrl();
});

function updateMusicUI() {
    const btn = document.getElementById('playPauseBtn');
    const disk = document.getElementById('vinylDisk');
    const card = document.querySelector('.music-card');
    
    btn.innerHTML = isMusicPlaying ? '<i class="fas fa-pause-circle"></i>' : '<i class="fas fa-play-circle"></i>';
    
    if (isMusicPlaying) {
        disk.classList.add('rotating');
        card.classList.add('playing');
    } else {
        disk.classList.remove('rotating');
        card.classList.remove('playing');
    }
}

// --- AI LOGIC (Key Rotation) ---
async function loadConfig() {
    const adminEmail = currentUser ? currentUser.email : '';
    const res = await fetch(`/api/main?route=admin_config&adminEmail=${encodeURIComponent(adminEmail)}`);
    const data = await res.json();
    if(data) {
        aiConfig.keys = data.keys || [];
        aiConfig.models = data.models || [];
        aiConfig.razorpayKey = data.razorpayKey;
        updateAIUI();
        if (document.getElementById('statKeys')) document.getElementById('statKeys').innerText = aiConfig.keys.length;
        if (document.getElementById('apiKeys')) document.getElementById('apiKeys').value = aiConfig.keys.join(', ');
        if (document.getElementById('modelList')) document.getElementById('modelList').value = JSON.stringify(aiConfig.models);
    }
}

function updateAIUI() {
    const options = aiConfig.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    const modelSelects = [
        document.getElementById('modelSelect'),
        document.getElementById('codeModelSelect'),
        document.getElementById('focusModelSelect'),
        document.getElementById('seekModelSelect'),
        document.getElementById('quizModelSelect'),
        document.getElementById('miniModelSelect'),
        document.getElementById('solveModelSelect')
    ];

    modelSelects.forEach(select => {
        if (select) {
            const currentSelected = select.value; // Preserve current selection if possible
            select.innerHTML = options;
            if (currentSelected && select.querySelector(`option[value="${currentSelected}"]`)) {
                select.value = currentSelected;
            } else if (aiConfig.models.length > 0) {
                select.value = aiConfig.models[0].id; // Default to first available model
            }
        }
    });
}

// --- AI LOGIC (Key Rotation + History) ---
async function syncAIHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}`);
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
    // Force ID to number and update interaction timestamp
    conversation.id = Number(conversation.id);
    conversation.lastUpdated = Date.now();

    const idx = aiConversations.findIndex(c => Number(c.id) === conversation.id);
    if (idx > -1) {
        aiConversations[idx] = conversation;
    } else {
        aiConversations.unshift(conversation);
    }

    renderAIHistory();

    if (!currentUser) return;

    // Background sync
    try {
        await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(conversation)
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
    id = Number(id);
    currentChatId = id;
    const conv = aiConversations.find(c => Number(c.id) === id);
    if (!conv) return;

    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('currentConvName').innerText = conv.name;
    conv.messages.forEach(m => appendAIMessage(m.role, m.content));
    renderAIHistory();
    if(window.innerWidth < 1024) document.getElementById('aiSidebar').classList.add('hidden');
}

function renderAIHistory(providedHistory = null) {
    const list = document.getElementById('chatHistoryList');
    const bulkBar = document.getElementById('aiBulkActions');
    const displayData = providedHistory || aiConversations;
    
    // Robust sort by lastUpdated (or ID fallback) descending
    displayData.sort((a, b) => {
        const timeA = Number(a.lastUpdated || a.id);
        const timeB = Number(b.lastUpdated || b.id);
        return timeB - timeA;
    });

    if (displayData.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-gray-500 text-center py-4">No chat history.</p>';
        bulkBar?.classList.add('hidden');
        selectedConversations.clear();
        return;
    }

    bulkBar?.classList.remove('hidden');
    const countEl = document.getElementById('aiSelectionCount');
    if (countEl) countEl.innerText = `${selectedConversations.size} selected`;
    
    const selectAllEl = document.getElementById('selectAllAI');
    if (selectAllEl) selectAllEl.checked = (selectedConversations.size === aiConversations.length && aiConversations.length > 0);

    list.innerHTML = displayData.map(c => {
        const cid = Number(c.id);
        const isSelected = selectedConversations.has(cid);
        const isActive = cid === Number(currentChatId);
        return `
            <div onclick="loadConversation('${cid}')" class="group relative flex items-center rounded-xl transition-all duration-200 cursor-pointer overflow-hidden mb-1 ${isActive ? 'bg-purple-600/20 border border-purple-500/50 shadow-lg shadow-purple-900/20' : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/10'}">
                <div class="flex items-center justify-center w-8 pl-2">
                    <input type="checkbox" class="accent-purple-500 w-3.5 h-3.5 rounded cursor-pointer" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleConvSelection(${cid})">
                </div>
                <div class="flex-grow py-3 pl-1 pr-12 text-[11px] font-medium truncate ${isActive ? 'text-white' : 'text-gray-400'}">
                    <i class="fas fa-comment-alt mr-2 opacity-50"></i> ${c.name}
                </div>
                <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button onclick="event.stopPropagation(); renameConversation('${c.id}')" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400 transition-colors" title="Rename"><i class="fas fa-pen text-[8px]"></i></button>
                    <button onclick="event.stopPropagation(); deleteConversation('${c.id}')" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Delete"><i class="fas fa-trash-alt text-[8px]"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleConvSelection(id) {
    id = Number(id);
    if (selectedConversations.has(id)) selectedConversations.delete(id);
    else selectedConversations.add(id);
    renderAIHistory();
}

function selectAllConversations(checked) {
    if (checked) {
        aiConversations.forEach(c => selectedConversations.add(Number(c.id)));
    } else {
        selectedConversations.clear();
    }
    renderAIHistory();
}

async function deleteSelectedConversations() {
    if (selectedConversations.size === 0) return;
    if (!confirm(`Delete ${selectedConversations.size} conversations?`)) return;

    const count = selectedConversations.size;
    setLoading(true, "Deleting Chats");
    try {
        const idsToDelete = Array.from(selectedConversations);
        if (currentUser) {
            // Bulk delete via multiple API calls or a batch endpoint if it existed
            // For now, we iterate for simplicity with the existing route
            await Promise.all(idsToDelete.map(id => 
                fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, { method: 'DELETE' })
            ));
        }
        
        aiConversations = aiConversations.filter(c => !selectedConversations.has(Number(c.id)));
        if (selectedConversations.has(Number(currentChatId))) {
            currentChatId = null;
            document.getElementById('chatBox').innerHTML = '';
            document.getElementById('currentConvName').innerText = 'Untitled Chat';
        }
        selectedConversations.clear();
        renderAIHistory();
        showToast(`${count} conversations purged.`, "warning");
    } finally {
        setLoading(false);
    }
}

async function renameConversation(id) {
    id = Number(id);
    const conv = aiConversations.find(c => c.id === id);
    const newName = prompt("Enter new name for conversation:", conv.name);
    if (newName) {
        conv.name = newName;
        await saveAIHistory(conv);
        if (id === currentChatId) document.getElementById('currentConvName').innerText = newName;
    }
}

async function deleteConversation(id) {
    id = Number(id);
    if (!confirm("Are you sure you want to delete this conversation?")) return;
    aiConversations = aiConversations.filter(c => c.id !== id);
    if (currentUser) {
        setLoading(true, "Deleting Chat");
        try {
            await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, {
                method: 'DELETE'
            });
        } finally {
            setLoading(false);
        }
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
    let msgDiv = null;

    // Robust selection: Only reuse the last message if it's an active stream and role matches
    const lastMsg = box.lastElementChild;
    if (lastMsg && lastMsg.classList.contains('streaming-msg') && role === 'ai') {
        msgDiv = lastMsg;
    }

    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'} relative group ${isStreaming ? 'streaming-msg' : ''}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = "markdown-body";
        msgDiv.appendChild(contentDiv);
        box.appendChild(msgDiv);
    }

    // Sync streaming state class
    if (isStreaming) {
        msgDiv.classList.add('streaming-msg');
    } else {
        msgDiv.classList.remove('streaming-msg');
    }

    const contentDiv = msgDiv.querySelector('.markdown-body');
    
    // Check scroll position before content update for accurate auto-scroll intent
    // We stick to bottom only if the user is already there (or very close)
    const threshold = 150;
    const isAtBottom = (box.scrollHeight - box.scrollTop) <= (box.clientHeight + threshold);

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

    // If finished, add copy buttons (both Markdown and Plain Text)
    if (!isStreaming) {
        let copyGroup = msgDiv.querySelector('.msg-copy-group');
        if (!copyGroup) {
            copyGroup = document.createElement('div');
            copyGroup.className = "msg-copy-group sticky top-0 float-right flex gap-1 z-20 ml-4 mb-2 -mr-1 md:-mr-2";
            // Prepend so it doesn't get pushed down by markdown content
            msgDiv.insertBefore(copyGroup, msgDiv.firstChild);
        }
        
        copyGroup.innerHTML = ''; // Clear previous

        const btnClass = "bg-black/40 backdrop-blur-sm p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-400 transition-all flex items-center justify-center min-w-[28px]";
        
        // Markdown Copy Button (Rawest form)
        const copyMD = document.createElement('button');
        copyMD.className = btnClass;
        copyMD.title = "Copy Raw Markdown";
        copyMD.innerHTML = '<i class="fas fa-file-code text-[10px]"></i>';
        copyMD.onclick = () => {
            navigator.clipboard.writeText(content);
            copyMD.innerHTML = '<i class="fas fa-check text-green-400 text-[10px]"></i>';
            setTimeout(() => copyMD.innerHTML = '<i class="fas fa-file-code text-[10px]"></i>', 2000);
        };
        
        // Plain Text Copy Button (Rendered form)
        const copyText = document.createElement('button');
        copyText.className = btnClass;
        copyText.title = "Copy Plain Text";
        copyText.innerHTML = '<i class="far fa-copy text-[10px]"></i>';
        copyText.onclick = () => {
            navigator.clipboard.writeText(contentDiv.innerText);
            copyText.innerHTML = '<i class="fas fa-check text-green-400 text-[10px]"></i>';
            setTimeout(() => copyText.innerHTML = '<i class="far fa-copy text-[10px]"></i>', 2000);
        };

        const speakBtn = document.createElement('button');
        speakBtn.className = btnClass;
        speakBtn.title = "Read Aloud";
        speakBtn.innerHTML = '<i class="fas fa-volume-up text-[10px]"></i>';
        speakBtn.onclick = () => speakAIMessage(content, speakBtn);

        copyGroup.appendChild(speakBtn);
        copyGroup.appendChild(copyMD);
        copyGroup.appendChild(copyText);
        
        // Final math render pass
        if (typeof renderMathInElement === 'function') {
            renderMathInElement(contentDiv, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError : false
            });
        }
    }

    if (isAtBottom || !isStreaming) {
        box.scrollTop = box.scrollHeight;
    }
    return msgDiv;
}

async function handleAIFile(e, isMini = false) {
    const files = e.target ? Array.from(e.target.files) : Array.from(e);
    
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result.split(',')[1];
            const fileObj = { mime_type: file.type, data: base64, name: file.name };
            
            if (file.type.startsWith('text/')) {
                // For text files, we keep a raw copy for editing using UTF-8 aware decoding
                const raw = new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
                fileObj.raw = raw;
            }
            
            pendingFiles.push(fileObj);
            renderAttachmentChips();
        };
        reader.readAsDataURL(file);
    }
}

// STT Toggle
let recognition;
let sttForceStop = false;
let sttFinalTranscript = '';
let sttCurrentLang = 'en-US'; // Default language

// Helper to format transcript for better readability
function postProcessTranscript(transcript, isNote = false) {
    // Capitalize first letter of sentence and add period if missing
    let processed = transcript.trim();
    if (processed.length > 0) {
        processed = processed.charAt(0).toUpperCase() + processed.slice(1);
        if (!/[.?!]$/.test(processed)) {
            processed += '.';
        }
    }
    
    // Basic formatting for notes (e.g., if it looks like a list item)
    if (isNote) {
        if (processed.toLowerCase().startsWith('new item')) {
            processed = '- [ ] ' + processed.substring('new item'.length).trim();
        } else if (processed.toLowerCase().startsWith('bullet')) {
            processed = '- ' + processed.substring('bullet'.length).trim();
        }
    }
    
    return processed;
}

// Function to handle voice commands
function processVoiceCommand(command) {
    const lowerCommand = command.toLowerCase().trim();

    if (lowerCommand.includes('save note') || lowerCommand.includes('commit note')) {
        showToast("Voice command: Save Note", "info");
        addNote();
        return true;
    }
    if (lowerCommand.includes('new chat') || lowerCommand.includes('start new conversation')) {
        showToast("Voice command: New Chat", "info");
        newConversation();
        return true;
    }
    if (lowerCommand.includes('clear chat') || lowerCommand.includes('delete messages')) {
        showToast("Voice command: Clear Chat", "info");
        clearChat();
        return true;
    }
    if (lowerCommand.includes('switch to ai') || lowerCommand.includes('go to ai')) {
        showToast("Voice command: Switch to AI", "info");
        showPage('ai');
        return true;
    }
    if (lowerCommand.includes('switch to notes') || lowerCommand.includes('go to notes')) {
        showToast("Voice command: Switch to Notes", "info");
        showPage('notes');
        return true;
    }
    if (lowerCommand.includes('switch to music') || lowerCommand.includes('go to music')) {
        showToast("Voice command: Switch to Music", "info");
        showPage('play');
        return true;
    }
    if (lowerCommand.includes('go to dashboard') || lowerCommand.includes('show dashboard')) {
        showToast("Voice command: Go to Dashboard", "info");
        showPage('dashboard');
        return true;
    }
    if (lowerCommand.includes('help')) {
        showToast("Voice command: Displaying help for voice commands (WIP)", "info");
        // Implement a modal or message for voice command help
        return true;
    }
    
    return false;
}

// Unified Speech-to-Text Toggle Function
function toggleSpeechToText(inputId, btnId, isMiniChat = false, isNote = false) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);

    if (!('webkitSpeechRecognition' in window)) {
        return showToast("Speech recognition not supported in this browser.", "error");
    }

    if (recognition) { // Check if recognition object exists and might be active
        sttForceStop = true;
        recognition.stop();
        recognition = null; // Explicitly nullify the object to prevent any lingering state issues
        
        // Ensure UI is reset for the button that was clicked to stop
        const iconClass = isMiniChat ? 'text-xs' : ''; // Determine icon size based on context
        btn.innerHTML = `<i class="fas fa-microphone ${iconClass}"></i>`;
        btn.classList.remove('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
        showToast("Microphone OFF", "warning");
        return;
    }

    // If starting a new recognition session
    sttForceStop = false;
    sttFinalTranscript = input.value; // Initialize with current input value
    input.focus();

    recognition = new webkitSpeechRecognition(); // Always create a fresh instance
    recognition.continuous = true; // Keep listening for continuous input
    recognition.interimResults = true; // Get interim results for real-time display
    recognition.lang = sttCurrentLang; // Use selected language

    recognition.onstart = () => {
        const iconClass = isMiniChat ? 'text-[10px]' : '';
        btn.innerHTML = `<i class="fas fa-stop-circle text-red-500 animate-pulse ${iconClass}"></i>`;
        btn.classList.add('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
        recognition.active = true; // Manually track active state
        showToast(`Listening in ${sttCurrentLang}...`, "info");
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let currentSegmentFinal = ''; // Final transcript for the *current* event segment

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentSegmentFinal += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        // Append current segment's final transcript to our overall final transcript
        if (currentSegmentFinal.length > 0) {
            sttFinalTranscript = (sttFinalTranscript.trim() + " " + currentSegmentFinal.trim()).trim();
            
            // Check for voice commands on final segments
            const commandRecognized = processVoiceCommand(currentSegmentFinal);
            if (commandRecognized) {
                sttForceStop = true; // Stop STT if a command is recognized
                if (recognition) recognition.stop();
                sttFinalTranscript = sttFinalTranscript.replace(currentSegmentFinal, '').trim(); // Remove command from transcript
            }
        }

        // Display current overall final transcript + current interim (if any)
        input.value = (sttFinalTranscript + " " + interimTranscript).trim();
        
        // Auto-resize for flexible text areas
        if (typeof autoResize === 'function') autoResize(input);
        
        // Scroll to bottom
        input.scrollTop = input.scrollHeight;
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
            sttForceStop = true;
            showToast("Microphone access denied. Please check your browser's site permissions for the microphone.", "error");
        } else if (event.error === 'network') {
            showToast("Network error detected. This could be due to an unstable internet connection, firewall, or VPN interference. Please check your connection and try again.", "error");
        } else if (event.error === 'no-speech') {
            // This error typically occurs when the API is listening but detects no discernible speech for a period.
            showToast("No speech detected. Please speak clearly into the microphone. If the issue persists, ensure your microphone is working.", "info");
        } else if (event.error === 'audio-capture') {
            showToast("Microphone not found or is busy. Ensure it's connected and not in use by another application.", "error");
        } else if (event.error === 'service-not-allowed') {
            showToast("Speech recognition service unavailable. This may happen if not on HTTPS, or due to a temporary service issue. Please ensure your connection is secure.", "error");
        } else if (event.error === 'bad-grammar') {
            // Less common for continuous recognition, more for single shot with grammar.
            showToast("Speech recognition encountered a grammar error. Please speak clearly.", "warning");
        }
        else {
            showToast(`STT Error: ${event.error}. Please try restarting your browser.`, "warning");
        }
        console.warn("STT Error:", event.error);
        if (recognition) {
            recognition.active = false;
            const iconClass = isMiniChat ? 'text-xs' : '';
            btn.innerHTML = `<i class="fas fa-microphone ${iconClass}"></i>`;
            btn.classList.remove('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
            recognition = null; // Ensure recognition object is cleared on error
        }
    };

    recognition.onend = () => {
        // This 'onend' handler will fire for both natural ends and explicit stops.
        // The UI reset (button change, toast) is now primarily handled in the `toggleSpeechToText`
        // stopping block for immediate feedback.
        
        // Only restart if it wasn't a forced stop AND a new `recognition` object was not already created/nullified
        // by a manual stop action (recognition !== null).
        if (!sttForceStop && recognition) { 
            try { 
                recognition.start(); 
            } catch(e) { 
                console.warn("STT restart failed:", e); 
                showToast("Speech recognition stopped due to an error. Please restart manually.", "error");
                recognition = null; // Clear recognition on restart failure
            }
        } else {
            // If it was a forced stop, or if recognition was already nullified,
            // ensure any residual 'active' state is cleared.
            if (recognition) recognition.active = false;
        }
        sttForceStop = false; // Reset for next cycle
    };

    recognition.start();
}

let editingAttachmentIdx = -1;

// Updated Auto-Resize Logic
function autoResize(textarea) {
    if (!textarea) return;

    // Force style reset to calculate correct scrollHeight
    textarea.style.height = 'auto'; 
    
    const isLargeEditor = textarea.id === 'noteInput' || textarea.id === 'editNoteText';
    const baseHeight = isLargeEditor ? 120 : 44; 
    
    // Use scrollHeight but ensure it's at least the base height
    let newHeight = textarea.scrollHeight;
    if (newHeight < baseHeight) newHeight = baseHeight;
    
    const maxHeight = window.innerHeight * 0.6;
    
    if (newHeight > maxHeight) {
        textarea.style.height = maxHeight + 'px';
        textarea.style.overflowY = 'auto';
    } else {
        textarea.style.height = newHeight + 'px';
        textarea.style.overflowY = 'hidden';
    }
}

// Add a window resize listener to keep textareas responsive
window.addEventListener('resize', () => {
    ['chatInput', 'noteInput', 'editNoteText', 'miniChatInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) autoResize(el);
    });
});

function prefillAIPrompt(text) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = text;
        input.focus();
        autoResize(input);
    }
}

function addTextAsAttachment(content, name = null) {
    const fileName = name || `Large Text ${pendingFiles.length + 1}.txt`;
    // Modern UTF-8 to Base64 encoding
    const base64 = btoa(new TextEncoder().encode(content).reduce((data, byte) => data + String.fromCharCode(byte), ''));
    const fileObj = { mime_type: 'text/plain', data: base64, name: fileName, raw: content };
    pendingFiles.push(fileObj);
    renderAttachmentChips();
}

function renderAttachmentChips() {
    const preview = document.getElementById('aiAttachmentPreview');
    const miniPreview = document.getElementById('miniAttachmentPreview');
    const codePreview = document.getElementById('codeAttachmentPreview');
    const solvePreview = document.getElementById('solveAttachmentPreview');
    [preview, miniPreview, codePreview, solvePreview].forEach(p => { if(p) p.innerHTML = ''; });

    pendingFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = "bg-purple-600/20 text-purple-400 text-[10px] px-2 py-1 rounded flex items-center gap-2 border border-purple-500/30 group animate-fadeIn";
        
        let icon = '<i class="fas fa-file-alt"></i>';
        let editBtn = '';
        
        if (file.mime_type.startsWith('image/')) {
            icon = `<img src="data:${file.mime_type};base64,${file.data}" class="w-4 h-4 rounded object-cover">`;
        } else if (file.raw !== undefined) {
            editBtn = `<button onclick="toggleLargeEditor(null, ${idx})" class="hover:text-cyan-400 transition" title="Edit text"><i class="fas fa-edit"></i></button>`;
        }

        chip.innerHTML = `
            ${icon}
            <span class="max-w-[100px] truncate">${file.name}</span>
            <div class="flex items-center gap-1.5 ml-1">
                ${editBtn}
                <button onclick="removeAttachment(${idx})" class="hover:text-red-400 transition"><i class="fas fa-times"></i></button>
            </div>
        `;
        
        let target = miniPreview;
        if (document.getElementById('ai').classList.contains('active')) target = preview;
        else if (document.getElementById('code').classList.contains('active')) target = codePreview;
        else if (document.getElementById('solve').classList.contains('active')) target = solvePreview;
        
        if(target) target.appendChild(chip);
    });
}

function removeAttachment(idx) {
    pendingFiles.splice(idx, 1);
    renderAttachmentChips();
}

function toggleLargeEditor(content = null, attachmentIdx = -1) {
    const modal = document.getElementById('largeEditorModal');
    const editor = document.getElementById('largeEditorText');
    const titleEl = document.getElementById('largeEditorTitle');
    const filenameContainer = document.getElementById('largeEditorFilenameContainer');
    const filenameInput = document.getElementById('largeEditorFilename');
    const isOpening = modal.classList.contains('hidden');
    
    if (isOpening) {
        editingAttachmentIdx = attachmentIdx;
        if (attachmentIdx !== -1) {
            // Editing an attached file
            const file = pendingFiles[attachmentIdx];
            editor.value = file.raw || '';
            filenameInput.value = file.name;
            titleEl.innerText = `Editing: ${file.name}`;
            filenameContainer.classList.remove('hidden'); // Show filename input
        } else {
            // Using as a general large text input for chat
            editor.value = content || document.getElementById('chatInput').value;
            titleEl.innerText = 'sOuLAI Advanced Editor';
            filenameInput.value = ''; // Clear filename
            filenameContainer.classList.add('hidden'); // Hide filename input
        }
        modal.classList.remove('hidden');
        editor.focus();
        autoResize(editor); // Ensure editor resizes correctly on open
    } else {
        modal.classList.add('hidden');
        editingAttachmentIdx = -1;
        // Clean up title/filename when closing
        titleEl.innerText = 'sOuLAI Advanced Editor';
        filenameInput.value = '';
        filenameContainer.classList.add('hidden');
    }
}

function saveLargeEditor() {
    const content = document.getElementById('largeEditorText').value;
    const newFileName = document.getElementById('largeEditorFilename').value.trim();

    if (editingAttachmentIdx !== -1) {
        // Saving changes to an existing attached file
        const fileToUpdate = pendingFiles[editingAttachmentIdx];
        fileToUpdate.raw = content;
        // Re-encode content to base64
        fileToUpdate.data = btoa(new TextEncoder().encode(content).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        
        if (newFileName && newFileName !== fileToUpdate.name) {
            fileToUpdate.name = newFileName;
        }

        renderAttachmentChips(); // Re-render chips to show updated name/content
        showToast(`File "${fileToUpdate.name}" updated.`, "success");

    } else {
        // Original logic: content from chatInput or new large text to attach
        if (content.length > 3000) {
            addTextAsAttachment(content);
            document.getElementById('chatInput').value = '';
            showToast("Large text attached as a file.", "success");
        } else {
            const input = document.getElementById('chatInput');
            input.value = content;
            autoResize(input);
            showToast("Content applied to chat input.", "info");
        }
    }
    toggleLargeEditor(); // Close the modal
}

async function exportData(type, id, format, providedData = null) {
    if (!id && !providedData) {
        alert("Selection required for export.");
        return;
    }
    let payload = providedData;
    
    if (!payload) {
        if (type === 'chat') {
            payload = aiConversations.find(c => c.id === Number(id));
        } else if (type === 'note') {
            payload = notes.find(n => n.id === Number(id));
        }
    }
    
    if (!payload) return;

    setLoading(true, `Generating ${format.toUpperCase()} Document...`);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased to 60s for large PDFs

        const response = await fetch('/api/main?route=export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, format, data: payload }),
            signal: controller.signal
        }).catch(err => {
            if (err.name === 'AbortError') throw new Error("Export timed out. The file might be too large.");
            throw new Error("Network error: Server connection reset during export.");
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            let errorMsg = "Export failed.";
            const text = await response.text();
            try {
                const errData = JSON.parse(text);
                errorMsg = errData.error || errorMsg;
            } catch(e) {
                errorMsg = text || errorMsg;
            }
            throw new Error(errorMsg);
        }
        
        const blob = await response.blob();
        if (blob.size === 0) throw new Error("Generated file is empty.");

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const ext = format === 'markdown' ? 'md' : format;
        a.download = `sOuLViSiON_${type}_${id}.${ext}`;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

    } catch (e) {
        console.error("Export Error:", e);
        alert(`Export Failed: ${e.message === 'The user aborted a request.' ? 'Request timed out. The file might be too large for PDF conversion.' : e.message}`);
    } finally {
        setLoading(false);
    }
}

// Paste handling
document.getElementById('chatInput').addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
    const textData = clipboardData.getData('text/plain');
    const files = [];

    // Check for large text paste
    if (textData.length > 3000) { // Threshold for large text: 3000 characters
        e.preventDefault();
        addTextAsAttachment(textData);
        e.target.value = '';
        autoResize(e.target);
        return;
    }

    // Check for file paste
    const items = clipboardData.items;
    for (let item of items) {
        if (item.kind === 'file') {
            files.push(item.getAsFile());
        }
    }
    if (files.length > 0) {
        e.preventDefault();
        handleAIFile(files);
    }
});

// Add paste listener for miniChatInput
document.getElementById('miniChatInput').addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
    const textData = clipboardData.getData('text/plain');
    const files = [];

    // Check for large text paste
    if (textData.length > 3000) { // Threshold for large text: 3000 characters
        e.preventDefault();
        addTextAsAttachment(textData);
        e.target.value = '';
        autoResize(e.target);
        return;
    }

    // Check for file paste
    const items = clipboardData.items;
    for (let item of items) {
        if (item.kind === 'file') {
            files.push(item.getAsFile());
        }
    }
    if (files.length > 0) {
        e.preventDefault();
        handleAIFile(files, true); // Pass true for mini chat
    }
});

['codeChatInput', 'solveAIInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('paste', (e) => {
            const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
            const textData = clipboardData.getData('text/plain');
            const files = [];
            if (textData.length > 3000) {
                e.preventDefault();
                addTextAsAttachment(textData);
                e.target.value = '';
                if (typeof autoResize === 'function') autoResize(e.target);
                return;
            }
            const items = clipboardData.items;
            for (let item of items) {
                if (item.kind === 'file') files.push(item.getAsFile());
            }
            if (files.length > 0) {
                e.preventDefault();
                handleAIFile(files);
            }
        });
    }
});

async function askAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    // Force specific streaming setting for Code page
    const isCodePage = document.getElementById('code').classList.contains('active');
    const savedStreamMode = isStreamingMode;
    if (isCodePage) isStreamingMode = false;
    const inputEl = document.getElementById('chatInput');
    const persona = document.getElementById('personaSelect').value;
    const model = document.getElementById('modelSelect').value; // Get model from main chat dropdown
    let input = inputEl.value;
    if(!input.trim() && pendingFiles.length === 0) return;
    
    if(!currentChatId) newConversation();
    const conv = aiConversations.find(c => c.id === currentChatId);
    
    const userMsg = input + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'chatBox');
    inputEl.value = '';
    autoResize(inputEl);
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    if(conv && conv.messages.length === 0) {
        conv.name = input.substring(0, 25) || "New Conversation";
    }
    
    const parts = [];
    if (persona && (!conv || conv.messages.length === 0)) {
        parts.push({ text: persona + "\n\n" + (input || " ") });
    } else {
        parts.push({ text: input || " " });
    }
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    const messageObj = { role: 'user', content: userMsg, parts };
    if(conv) conv.messages.push(messageObj);

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(input, 'chatBox', conv ? conv.messages : [], attachmentsForApi, model); // Pass selected model
    if (isCodePage) isStreamingMode = savedStreamMode;
}

async function askCodeAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('codeChatInput');
    const editorEl = document.getElementById('codeEditor');
    const query = inputEl.value.trim();
    if (!query && pendingFiles.length === 0) return;

    let activeFile = projectFiles.find(f => f.id === activeFileId);
    
    if (!activeFile && editorEl.value.trim()) {
        const id = Date.now() + Math.random();
        activeFile = { id, name: 'notebook.txt', path: 'notebook.txt', content: editorEl.value };
        projectFiles.push(activeFile);
        activeFileId = id;
        renderFileTree();
        selectCodeFile(id);
        showToast("Editor content indexed as notebook.", "info");
    }

    if (!activeFile && pendingFiles.length === 0) {
        showToast("Upload a file or enter code in the editor to provide context.", "warning");
        return;
    }

    const userMsg = query + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'codeChatBox');
    inputEl.value = '';
    autoResize(inputEl);
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview'), document.getElementById('codeAttachmentPreview'), document.getElementById('solveAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const model = document.getElementById('codeModelSelect').value;
    const projectContext = projectFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n---\n\n');
    let activeFilePath = activeFile ? activeFile.path : 'None';
    let activeFileContent = activeFile ? activeFile.content : 'None';

    const systemPrompt = `You are an expert AI code editor. 
    CURRENT_PROJECT_CONTEXT:
    ${projectContext}

    ACTIVE_FILE: ${activeFilePath}
    ACTIVE_FILE_CONTENT: ${activeFileContent}

    USER_REQUEST: ${query}

    INSTRUCTIONS:
    1. You MUST directly edit the active file if the user requests changes.
    2. Return your response in this exact format:
       COMMENTARY: [Brief explanation of changes]
       CODE_START
       [Full new content of ${activeFilePath}]
       CODE_END
    3. If no code change is requested, just answer the question in plain text.`;

    const parts = [{ text: systemPrompt }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    const history = [{ role: 'user', content: userMsg, parts }];
    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];

    // Force non-streaming for Code AI
    const originalStreamMode = isStreamingMode;
    isStreamingMode = false;
    await callGeminiAPI(query, 'codeChatBox', history, attachmentsForApi, model);
    isStreamingMode = originalStreamMode;
}

async function askMiniAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    const txt = inputEl.value;
    const model = document.getElementById('miniModelSelect').value; // Get model from mini chat dropdown
    if(!txt.trim() && pendingFiles.length === 0) return;
    
    const userDisplayMsg = txt + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userDisplayMsg, 'miniChatBox');
    
    inputEl.value = '';
    autoResize(inputEl);
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const parts = [{ text: txt || " " }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    miniChatHistory.push({ role: 'user', content: userDisplayMsg, parts });

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(txt, 'miniChatBox', miniChatHistory, attachmentsForApi, model); // Pass selected model
}

async function callGeminiAPI(text, targetBoxId = 'chatBox', history = [], attachments = [], model = null) {
    document.title = '● AI is thinking...';
    
    if (!model) {
        if (aiConfig.models.length > 0) {
            model = aiConfig.models[0].id;
        } else {
            return alert("No AI models configured. Please ask admin to set them up.");
        }
    }
    
    if(!aiConfig.keys.length) return alert("Please configure API Keys in Admin panel.");

    let type = 'main';
    if (targetBoxId === 'miniChatBox') type = 'mini';
    else if (targetBoxId === 'codeChatBox') type = 'code';
    else if (targetBoxId === 'solveAIChat') type = 'solve';

    const statusEl = document.getElementById(type === 'mini' ? 'miniAiStatus' : (type === 'code' ? 'codeAIStatus' : (type === 'solve' ? 'solveAIStatus' : 'aiStatus')));
    
    const loadingPhrases = isStreamingMode ? [
        "Establishing neural stream...",
        "Buffering consciousness...",
        "Decoding tokenized reality...",
        "Synapsing response nodes...",
        "Venturing into latent space..."
    ] : [
        "Analyzing intent vectors...",
        "Querying sOuL-Core matrix...",
        "Synthesizing multi-dimensional context...",
        "Optimizing synaptic weights...",
        "Decrypting intelligence protocols...",
        "Resolving probabilistic outputs...",
        "Formulating definitive response..."
    ];
    let phraseIdx = 0;
    let loadingInterval = null;

    if(statusEl) { 
        toggleSendButton(type, true);
        statusEl.innerHTML = `
            <div class="neural-loader">
                <div class="neural-grid">
                    <div class="grid-dot"></div>
                    <div class="grid-dot"></div>
                    <div class="grid-dot"></div>
                    <div class="grid-dot"></div>
                </div>
                <div class="flex flex-col">
                    <span class="text-[9px] font-black tracking-[0.2em] text-purple-400 uppercase flex items-center gap-2">
                        <span class="status-dot"></span>
                        ${isStreamingMode ? 'Streaming Core Active' : 'Static Computation'}
                    </span>
                    <span class="neural-text text-[8px] text-gray-500 font-mono mt-0.5">Initializing uplink...</span>
                </div>
                <div class="ml-auto flex gap-1">
                    <div class="pulse-bar"></div>
                    <div class="pulse-bar"></div>
                    <div class="pulse-bar"></div>
                </div>
            </div>`; 
        statusEl.classList.remove('hidden'); 
    } else {
        toggleSendButton(type, true);
    }

    const contents = history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: m.parts || [{ text: m.content }]
    }));

    if (contents.length === 0 || contents[contents.length-1].role === 'model') {
        const currentParts = [{ text: text }];
        attachments.forEach(a => currentParts.push({ inline_data: { mime_type: a.mime_type, data: a.data } }));
        contents.push({ role: 'user', parts: currentParts });
    }

    currentAbortController = new AbortController();
    try {
        const endpoint = isStreamingMode ? 'streamGenerateContent' : 'generateContent';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
            signal: currentAbortController.signal
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || "API Error");
        }

        if (statusEl) {
            const neuralText = statusEl.querySelector('.neural-text');
            loadingInterval = setInterval(() => {
                if(neuralText) neuralText.innerText = loadingPhrases[phraseIdx] + "...";
                phraseIdx = (phraseIdx + 1) % loadingPhrases.length;
                // Keep scrolling so status stays visible
                const box = document.getElementById(targetBoxId);
                if(box) box.scrollTop = box.scrollHeight;
            }, 1200);
        }

        let fullContent = "";
        
        if (isStreamingMode) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            appendAIMessage('ai', '<div class="typing-dots"><span></span><span></span><span></span></div>', targetBoxId, true);
            
            let buffer = "";
            let lastUIUpdate = 0;
            const UI_UPDATE_INTERVAL = 32; // ~30fps throttled UI updates for peak performance

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // decoder.decode with {stream: true} correctly handles multi-byte characters split across chunks
                buffer += decoder.decode(value, { stream: true });
                
                let startIdx;
                // Improved JSON Stream Buffer: Accumulates fragments until valid objects are resolved
                while ((startIdx = buffer.indexOf('{')) !== -1) {
                    let braceCount = 0;
                    let endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') braceCount++;
                        else if (buffer[i] === '}') braceCount--;
                        
                        if (braceCount === 0) {
                            endIdx = i;
                            break;
                        }
                    }

                    if (endIdx !== -1) {
                        const chunkStr = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const chunk = JSON.parse(chunkStr);
                            const textPart = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
                            if (textPart) {
                                fullContent += textPart;
                                
                                // Throttled UI Update logic (Max ~30fps)
                                const now = Date.now();
                                if (now - lastUIUpdate > UI_UPDATE_INTERVAL) {
                                    let displayContent = fullContent;
                                    
                                    // Markdown fragment protection: close open tags for stable preview
                                    const codeBlockCount = (displayContent.match(/```/g) || []).length;
                                    if (codeBlockCount % 2 !== 0) displayContent += "\n```";
                                    const boldCount = (displayContent.match(/\*\*/g) || []).length;
                                    if (boldCount % 2 !== 0) displayContent += "**";
                                    
                                    appendAIMessage('ai', displayContent, targetBoxId, true);
                                    lastUIUpdate = now;
                                }
                            }
                            buffer = buffer.substring(endIdx + 1);
                        } catch (e) {
                            // If parsing fails despite matched braces, consume opening char to recover
                            buffer = buffer.substring(startIdx + 1);
                        }
                    } else {
                        break; // Incomplete object in buffer, wait for next stream chunk
                    }
                }
            }
            // Final render pass to ensure any remaining buffered content is displayed
            appendAIMessage('ai', fullContent, targetBoxId, true);
        } else {
            const data = await response.json();
            fullContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        }

        if (loadingInterval) clearInterval(loadingInterval);
        
        if (type === 'code' && fullContent.includes('CODE_START') && fullContent.includes('CODE_END')) {
             const commentary = fullContent.split('CODE_START')[0].replace('COMMENTARY:', '').trim();
             const newContent = fullContent.split('CODE_START')[1].split('CODE_END')[0].trim();
             appendAIMessage('ai', commentary + "\n\n**Proposed changes are ready for review.**", targetBoxId, false);
             
             let activeFile = projectFiles.find(f => f.id === activeFileId);
             if (activeFile) {
                 aiProposedChange = {
                     fileId: activeFile.id,
                     originalContent: activeFile.content,
                     newContent: newContent
                 };
                 showDiffOverlay();
             }
        } else {
            appendAIMessage('ai', fullContent, targetBoxId, false);
        }
        
        toggleSendButton(type, false);
        currentAbortController = null;
        
        if(statusEl) {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2 animate-fadeOut">
                    <i class="fas fa-check-circle text-green-500 text-xs"></i>
                    <span class="text-[9px] font-black tracking-widest text-green-500/80 uppercase">Intelligence Received</span>
                </div>`;
            setTimeout(() => statusEl.classList.add('hidden'), 1500);
        }

        if (targetBoxId === 'chatBox' && currentChatId) {
            const conv = aiConversations.find(c => c.id === currentChatId);
            if (conv) {
                conv.messages.push({ role: 'ai', content: fullContent });
                await saveAIHistory(conv);
            }
        } else if (targetBoxId === 'miniChatBox') {
            miniChatHistory.push({ role: 'ai', content: fullContent });
        }
        document.title = 'sOuLViSiON | Digital Sanctuary';
        // Reset failures on success
        consecutiveApiFailures = 0;
    } catch (err) {
        if (loadingInterval) clearInterval(loadingInterval);
        toggleSendButton(type, false);
        currentAbortController = null; // Always nullify the controller on error
        
        // Clear any pending files display as they won't be sent now
        pendingFiles = []; // Ensure internal state is clean (it should already be if call started)
        renderAttachmentChips(); // Clear attachments from UI

        if (err.name === 'AbortError') {
            if (statusEl) statusEl.classList.add('hidden');
            document.title = 'sOuLViSiON | Digital Sanctuary';
            // Do not increment failure count for aborts
            return;
        }
        
        console.warn(`Key ${currentKeyIndex} error: ${err.message}.`);
        
        // Increment failure count for actual API errors
        consecutiveApiFailures++;

        if (aiConfig.keys.length > 1 && consecutiveApiFailures < 3) { // Retry only if failures less than threshold
            currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
            showToast(`API key failed, switching to next key. Retrying... (${consecutiveApiFailures} failures)`, "warning");
            // Recursive call for retry, this path does not need to hide statusEl explicitly,
            // as it will be re-shown by the new callGeminiAPI invocation.
            return await callGeminiAPI(text, targetBoxId, history, attachments, model); // Pass model for retry
        }
        
        // If failures exceed threshold or only one key exists, activate cooldown
        if (consecutiveApiFailures >= 3 || aiConfig.keys.length === 1) { 
            isAICooldownActive = true;
            showAICooldownOverlay();
            // Start a timer to automatically clear cooldown after some time (e.g., 5 minutes)
            aiCooldownTimer = setTimeout(() => {
                isAICooldownActive = false;
                consecutiveApiFailures = 0;
                hideAICooldownOverlay();
                showToast("AI Cooldown lifted! Try again.", "info");
            }, 5 * 60 * 1000); // 5 minutes
            showToast("AI is on cooldown due to repeated failures. Please wait or support.", "warning");
        }

        // Always hide the status element if we're not retrying
        if(statusEl) statusEl.classList.add('hidden');
        
        if (err.message.includes("quota") || err.message.includes("API key")) {
            showBetterError("The Intelligence Core is exhausted or misconfigured. Admin attention required.");
        } else {
            appendAIMessage('ai', `**System Failure:** ${err.message}`, targetBoxId);
        }
        document.title = 'sOuLViSiON | Digital Sanctuary';
    }
}

// AI logic replaced by unified streaming/file functions above
function clearChat() { 
    if(confirm("Purge all visible messages in this view?")) {
        document.getElementById('chatBox').innerHTML = ''; 
    }
}

function clearMiniChat() {
    if(confirm("Purge mini-chat session and history?")) {
        document.getElementById('miniChatBox').innerHTML = '';
        miniChatHistory = [];
    }
}

async function exportMiniChat(format) {
    const box = document.getElementById('miniChatBox');
    const messages = [];
    box.querySelectorAll('.message').forEach(msg => {
        const role = msg.classList.contains('user-msg') ? 'user' : 'ai';
        const content = msg.querySelector('.markdown-body').innerText;
        messages.push({ role, content });
    });
    
    if(messages.length === 0) return alert("Nothing to export!");
    showToast(`Preparing ${format.toUpperCase()} export...`, "info");
    const data = { id: Date.now(), name: "Mini Chat Conversation", messages };
    await exportData('chat', data.id, format);
}

function copyChatAsMarkdown(chatId) {
    if (!chatId) return showToast("No active chat selected.", "warning");
    const conv = aiConversations.find(c => c.id === Number(chatId));
    if (!conv || !conv.messages || conv.messages.length === 0) {
        return showToast("Nothing to copy!", "warning");
    }

    const md = conv.messages.map(m => `**${m.role === 'user' ? 'User' : 'AI'}:** ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(md).then(() => {
        showToast("Chat copied to clipboard as Markdown!", "success");
    }).catch(err => {
        showToast("Failed to copy chat.", "error");
    });
}

function copyMiniChatAsMarkdown() {
    const box = document.getElementById('miniChatBox');
    const messages = [];
    box.querySelectorAll('.message').forEach(msg => {
        const role = msg.classList.contains('user-msg') ? 'User' : 'AI';
        const content = msg.querySelector('.markdown-body').innerText;
        messages.push(`**${role}:** ${content}`);
    });

    if (messages.length === 0) return showToast("Nothing to copy!", "warning");

    const md = messages.join('\n\n');
    navigator.clipboard.writeText(md).then(() => {
        showToast("Chat copied to clipboard as Markdown!", "success");
    }).catch(err => {
        showToast("Failed to copy chat.", "error");
    });
}

function toggleAIHistory() {
    const sidebar = document.getElementById('aiSidebar');
    sidebar.classList.toggle('hidden');
}
function toggleMiniChat() { document.getElementById('miniChat').classList.toggle('show'); }

function stopAllSTT() {
    if (recognition) { // Check if recognition object exists
        sttForceStop = true;
        recognition.stop();
        recognition = null; // Explicitly nullify the object when stopping universally
    }
    // Reset UI of all STT buttons that might be active
    const sttBtns = document.querySelectorAll('[id$="SttBtn"]');
    sttBtns.forEach(btn => {
        // Infer icon size based on button ID for correct styling
        const iconClass = btn.id.includes('mini') ? 'text-xs' : (btn.id.includes('solve') ? 'text-[10px]' : '');
        btn.innerHTML = `<i class="fas fa-microphone ${iconClass}"></i>`;
        btn.classList.remove('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
    });
}

// --- sOuLSEEK LOGIC ---
async function syncSeekHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=soulseek_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            seekHistory = data[0].messages || [];
            const box = document.getElementById('seekChatBox');
            box.innerHTML = '';
            seekHistory.forEach(m => appendAIMessage(m.role, m.content, 'seekChatBox'));
        }
    } catch (e) { console.warn("Seek history sync failed", e); }
}

async function askSoulSeekAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('seekInput');
    const text = inputEl.value.trim();
    if (!text) return;

    appendAIMessage('user', text, 'seekChatBox');
    inputEl.value = '';
    autoResize(inputEl);

    const systemPrompt = `You are the sOuLSEEK Oracle, an expert Vedic Numerologist. 
    Your brain is built on Harish Johari's "Numerology With Tantra, Ayurveda, and Astrology".
    
    GUIDELINES:
    1. Always be mystical, insightful, and supportive.
    2. Your goal is to help the user understand their Psychic, Destiny, and Name numbers.
    3. You MUST ask relevant questions to understand their situation. Do not just answer; engage.
    4. Use the specific traits of numbers (1-9) and their related planets/humors from Harish Johari's teachings.
    5. If they haven't provided it, ask for their full name and birth date.
    6. Analyze the interaction to prepare for a "Final Report".
    
    KNOWLEDGE BASE SNIPPET:
    ${HARISH_JOHARI_KNOWLEDGE.substring(0, 5000)}... [Instruction: Use full Vedic Numerology principles for calculation and interpretation]`;

    seekHistory.push({ role: 'user', content: text });
    
    const messages = [{ role: 'user', parts: [{ text: systemPrompt + "\n\nUser Message: " + text }] }];
    // Prepend history for context
    seekHistory.slice(-10).forEach(h => messages.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] }));

    const statusEl = document.getElementById('seekAiStatus');
    statusEl.classList.remove('hidden');
    
    const model = document.getElementById('seekModelSelect').value; // Get model from seek dropdown
    const key = aiConfig.keys[currentKeyIndex];

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: messages })
        });
        const data = await res.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "The numbers are clouded. Try again.";
        
        appendAIMessage('ai', aiResponse, 'seekChatBox');
        seekHistory.push({ role: 'ai', content: aiResponse });

        if (currentUser) {
            await fetch(`/api/main?route=soulseek_history&userId=${encodeURIComponent(currentUser.email)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 'current_session', messages: seekHistory })
            });
        }
    } catch (e) {
        showToast("Oracle connection failed.", "error");
    } finally {
        statusEl.classList.add('hidden');
    }
}

async function generateSoulSeekReport() {
    if (seekHistory.length < 4) return showToast("We need more interaction to formulate a report.", "warning");
    
    setLoading(true, "Compiling Numerological Blueprint");
    // Ensure we use the selected model from the UI
    const model = document.getElementById('seekModelSelect')?.value || aiConfig.models[0]?.id || "gemini-2.5-flash";
    const key = aiConfig.keys[currentKeyIndex];

    const prompt = `Based on our conversation history, generate a COMPREHENSIVE Numerological Report. 
    Include:
    - Calculation of Psychic, Destiny, and Name Numbers.
    - Detailed personality breakdown based on Harish Johari's teachings.
    - Life Path advice and planetary influences.
    - Specific advice for their current situation discussed.
    Format the output in professional Markdown.
    
    CONVERSATION HISTORY:
    ${JSON.stringify(seekHistory)}`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const aiSummary = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        const reportData = {
            id: Date.now(),
            title: currentUser?.name || 'Seeker',
            summary: aiSummary,
            history: seekHistory
        };

        // Call export with dedicated seek_report type to include conversation history automatically in backend
        await exportData('seek_report', reportData.id, 'pdf', reportData);
        showToast("Report Transferred to your device.", "success");
    } catch (e) {
        showToast("Failed to compile report.", "error");
        console.error("Seek Report Error:", e);
    } finally {
        setLoading(false);
    }
}

function clearSeekChat() {
    if (confirm("Reset Oracle session?")) {
        document.getElementById('seekChatBox').innerHTML = '<div class="ai-msg message"><div class="markdown-body text-sm italic">The cycle begins anew. Please tell me your Full Name and Date of Birth.</div></div>';
        seekHistory = [];
        if (currentUser) {
            fetch(`/api/main?route=soulseek_history&userId=${encodeURIComponent(currentUser.email)}`, { method: 'DELETE' });
        }
    }
}

// --- sOuLFUN ENHANCEMENTS ---
function startClicker() {
    const s = funState.clicker;
    const counter = document.getElementById('clickCounter');
    const combo = document.getElementById('clickCombo');
    const now = Date.now();

    if (window.navigator.vibrate) window.navigator.vibrate(10);

    if (s.active) {
        s.count++;
        counter.innerText = s.count;
        if (now - s.lastTime < 250) {
            combo.style.opacity = '1';
            combo.innerText = `x${Math.min(Math.floor(s.count / 10) + 1, 10)}`;
        } else {
            combo.style.opacity = '0';
        }
        s.lastTime = now;
        return;
    }

    s.active = true;
    s.count = 1;
    s.timeLeft = 10;
    s.lastTime = now;
    counter.innerText = "1";
    
    s.interval = setInterval(async () => {
        s.timeLeft--;
        document.getElementById('clickTimer').innerText = `${s.timeLeft}s REMAINING`;
        if (s.timeLeft <= 0) {
            clearInterval(s.interval);
            s.active = false;
            const cps = s.count / 10;
            combo.style.opacity = '0';
            showToast(`Session Ended. Score: ${cps} CPS`, "success");
            
            if (currentUser) {
                showToast("Saving high score...", "info");
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'clicker', score: cps })
                });
                syncFunLeaderboard();
            }
        }
    }, 1000);
}

function toggleZenBreath(btn) {
    const circle = document.getElementById('breathCircle');
    const text = document.getElementById('breathText');
    const ring = document.getElementById('zenRing');
    
    if (breathingState.active) {
        clearInterval(breathingState.interval);
        breathingState.interval = null;
        breathingState.active = false;
        
        circle.style.transform = 'scale(1)';
        if (ring) ring.style.opacity = '0';
        text.innerText = 'IDLE';
        btn.innerText = 'BEGIN CYCLE';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        
        if (breathingState.audioCtx) breathingState.audioCtx.suspend();
        return;
    }

    breathingState.active = true;
    btn.innerText = 'END CYCLE';
    btn.classList.replace('bg-teal-600', 'bg-red-600');
    if (ring) ring.style.opacity = '1';

    const phases = [
        { text: 'INHALE', scale: 1.8, color: 'rgba(20, 184, 166, 0.4)', freq: 440 },
        { text: 'EXHALE', scale: 1.0, color: 'rgba(20, 184, 166, 0.1)', freq: 330 }
    ];

    const run = () => {
        const p = phases[breathingState.phase % 2];
        text.innerText = p.text;
        circle.style.transform = `scale(${p.scale})`;
        circle.style.backgroundColor = p.color;
        
        if (breathingState.soundEnabled) playBreathingPulse(p.freq, 1.5);
        breathingState.phase = (breathingState.phase + 1) % 2;
    };

    run();
    breathingState.interval = setInterval(run, 4000);
}

// Emoji Alchemy Implementation
const alchemyEmojis = ['🔥', '💧', '🌱', '💨', '⚡', '❄️', '🌑', '✨', '💎', '🍄'];
const alchemyRecipes = {
    '🔥💧': '☁️', '🔥🌱': '🍂', '💧🌱': '🌸', '💨⚡': '🌩️', '❄️🔥': '💧',
    '🌑✨': '🔮', '🌱🌱': '🌳', '🔥🔥': '🌋', '💧💧': '🌊', '💨💨': '🌪️',
    '💎✨': '👑', '🍄🌑': '🧚', '⚡💧': '🔋', '❄️🌱': '🧊', '✨💎': '💍',
    '🍄💧': '🧪', '🔥🌑': '☄️', '💨🌱': '🌪️', '⚡✨': '🧬', '❄️💧': '🧊'
};

function renderAlchemyLog() {
    const list = document.getElementById('alchemyDiscoveryList');
    if (!list) return;
    if (funState.alchemy.discoveries.size === 0) {
        list.innerHTML = '<p class="text-[9px] text-gray-600 italic w-full">No discoveries yet.</p>';
        return;
    }
    list.innerHTML = Array.from(funState.alchemy.discoveries).map(e => `
        <div class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-lg hover:scale-110 transition cursor-help" title="Discovered Element">
            ${e}
        </div>
    `).join('');
}

function pickAlchemyEmoji(slotNum) {
    const randomEmoji = alchemyEmojis[Math.floor(Math.random() * alchemyEmojis.length)];
    funState.alchemy.slots[slotNum - 1] = randomEmoji;
    const slotEl = document.getElementById(`alchemySlot${slotNum}`);
    slotEl.innerText = randomEmoji;
    slotEl.classList.remove('emoji-pop');
    void slotEl.offsetWidth;
    slotEl.classList.add('emoji-pop');
}

function transmuteEmojis() {
    const slots = funState.alchemy.slots;
    if (!slots[0] || !slots[1]) return showToast("Pick two elements first!", "warning");
    
    const combo1 = slots[0] + slots[1];
    const combo2 = slots[1] + slots[0];
    const result = alchemyRecipes[combo1] || alchemyRecipes[combo2] || '💥';
    
    const slot1 = document.getElementById('alchemySlot1');
    const slot2 = document.getElementById('alchemySlot2');
    
    slot1.innerText = '✨';
    slot2.innerText = '✨';
    
    setTimeout(() => {
        slot1.innerText = result;
        slot2.innerText = result;
        if (result === '💥') {
            showToast("Transmutation Failed! Unstable bond.", "error");
        } else {
            showToast(`Success! You created ${result}`, "success");
            if (!funState.alchemy.discoveries.has(result)) {
                funState.alchemy.discoveries.add(result);
                localStorage.setItem('soul_alchemy_discovery', JSON.stringify(Array.from(funState.alchemy.discoveries)));
                renderAlchemyLog();
            }
        }
        funState.alchemy.slots = [null, null];
    }, 600);
}

// Particle Void Implementation
function initParticleVoid() {
    funState.particles.canvas = document.getElementById('funCanvas');
    if (!funState.particles.canvas) return;
    funState.particles.ctx = funState.particles.canvas.getContext('2d');
    
    const obs = new ResizeObserver(() => resizeFunCanvas());
    obs.observe(funState.particles.canvas.parentElement);
    
    const handleAction = (e) => {
        const rect = funState.particles.canvas.getBoundingClientRect();
        let x, y;
        if (e.touches) {
            x = e.touches[0].clientX - rect.left;
            y = e.touches[0].clientY - rect.top;
        } else {
            x = e.offsetX;
            y = e.offsetY;
        }
        spawnParticles(x, y);
    };

    funState.particles.canvas.addEventListener('mousedown', handleAction);
    funState.particles.canvas.addEventListener('mousemove', (e) => {
        if (!e.buttons) return;
        const now = Date.now();
        if (now - funState.particles.lastSpawn < 16) return;
        funState.particles.lastSpawn = now;
        handleAction(e);
    });
    
    funState.particles.canvas.addEventListener('touchstart', handleAction, { passive: true });
    funState.particles.canvas.addEventListener('touchmove', (e) => {
        const now = Date.now();
        if (now - funState.particles.lastSpawn < 16) return;
        funState.particles.lastSpawn = now;
        handleAction(e);
    }, { passive: true });

    if (!funState.particles.isAnimating) animateParticles();
}

function resizeFunCanvas() {
    const canvas = funState.particles.canvas;
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width = parent.offsetWidth;
    canvas.height = parent.offsetHeight;
}

function spawnParticles(x, y) {
    for (let i = 0; i < 15; i++) {
        funState.particles.array.push({
            x, y,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            size: Math.random() * 3 + 1,
            color: `hsla(${Math.random() * 360}, 70%, 60%, 0.8)`,
            life: 1
        });
    }
}

function animateParticles() {
    if (!funState.particles.ctx) return;
    funState.particles.isAnimating = true;
    requestAnimationFrame(animateParticles);
    
    const ctx = funState.particles.ctx;
    const canvas = funState.particles.canvas;
    
    // Smooth trail effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    funState.particles.array = funState.particles.array.filter(p => p.life > 0);
    funState.particles.array.forEach(p => {
        p.x += p.vx; 
        p.y += p.vy; 
        p.life -= 0.015;
        
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath(); 
        ctx.arc(p.x, p.y, (p.size * p.life) || 1, 0, Math.PI * 2); 
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function clearParticleVoid() {
    funState.particles.array = [];
}

// Missing Fun Functions
function flipCoinFun() {
    const coin = document.getElementById('funCoin');
    if (!coin) return;
    const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    coin.classList.remove('flipping-heads', 'flipping-tails');
    void coin.offsetWidth;
    coin.classList.add(`flipping-${result.toLowerCase()}`);
    if (window.navigator.vibrate) window.navigator.vibrate([10, 50, 10]);
    showToast(`The coin lands on: ${result}`, "info");
}

async function generateSoulQuote() {
    const quoteEl = document.getElementById('quoteText');
    if (!quoteEl) return;
    quoteEl.innerHTML = '<i class="fas fa-spinner fa-spin text-indigo-400"></i>';
    
    const fallbackQuotes = [
        { c: "The only way to do great work is to love what you do.", a: "Steve Jobs" },
        { c: "Innovation distinguishes between a leader and a follower.", a: "Steve Jobs" },
        { c: "Stay hungry, stay foolish.", a: "Whole Earth Catalog" },
        { c: "Silence is a source of great strength.", a: "Lao Tzu" },
        { c: "The journey of a thousand miles begins with a single step.", a: "Lao Tzu" },
        { c: "Quality is not an act, it is a habit.", a: "Aristotle" }
    ];

    try {
        const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://zenquotes.io/api/random'), { priority: 'low' });
        if (!res.ok) throw new Error();
        const wrapper = await res.json();
        const data = JSON.parse(wrapper.contents);
        if (data && data[0]) {
            quoteEl.innerText = `"${data[0].q}" — ${data[0].a}`;
        } else {
            throw new Error();
        }
    } catch (e) {
        const q = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
        quoteEl.innerText = `"${q.c}" — ${q.a}`;
    }
}

async function syncFunLeaderboard() {
    const clickerList = document.getElementById('clickerLeaderboard');
    const reactionList = document.getElementById('reactionLeaderboard');
    if (!clickerList) return;

    try {
        const res = await fetch('/api/main?route=fun_stats');
        const stats = await res.json();
        
        const renderList = (data, target, formatter) => {
            if (data.length === 0) { target.innerHTML = '<p class="text-[9px] text-gray-600 italic">No legends yet.</p>'; return; }
            target.innerHTML = data.slice(0, 5).map((s, i) => `
                <div class="flex justify-between text-[10px]">
                    <span class="text-gray-400 truncate max-w-[80px]">${s.userId.split('@')[0]}</span>
                    <span class="font-black ${i === 0 ? 'text-white' : 'text-gray-500'}">${formatter(s.score)}</span>
                </div>
            `).join('');
        };

        const clickerData = stats.filter(s => s.type === 'clicker').sort((a,b) => b.score - a.score);
        const reactionData = stats.filter(s => s.type === 'reaction').sort((a,b) => a.score - b.score);

        renderList(clickerData, clickerList, (s) => s + " CPS");
        renderList(reactionData, reactionList, (s) => s + "ms");
    } catch (e) {}
}

async function syncFunStats() {
    if (!currentUser) return;
    renderAlchemyLog();
    syncFunLeaderboard();
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        // We can use this data for local stats visualization if needed later
    } catch(e) {}
}

// --- sOuLQUIZ LOGIC ---
async function startQuiz(category) {
    if (!currentUser) return showPage('login');
    
    quizState = {
        active: true,
        questions: [],
        currentIndex: 0,
        score: 0,
        timer: null,
        category: category,
        results: []
    };

    document.getElementById('quizIntro').classList.add('hidden');
    document.getElementById('quizSummary').classList.add('hidden');
    document.getElementById('quizQuestionBox').classList.add('hidden');
    document.getElementById('quizLoading').classList.remove('hidden');
    document.getElementById('quizScoreDisplay').innerText = '000';
    
    try {
        const prompt = `Generate 10 multiple-choice questions for the category: "${category}". 
        Return ONLY a JSON array of objects with keys: "q" (the question), "o" (array of 4 options), "a" (index of correct option 0-3). 
        Do not include markdown blocks or any text other than the JSON. Ensure questions are challenging and diverse.`;
        
        const model = document.getElementById('quizModelSelect').value; // Get model from quiz dropdown
        quizState.model = model; // Store model in quizState
        const key = aiConfig.keys[currentKeyIndex];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await res.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        // Clean markdown if AI insisted
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();
        
        quizState.questions = JSON.parse(text);
        if (!Array.isArray(quizState.questions)) throw new Error("Invalid Format");

        document.getElementById('quizLoading').classList.add('hidden');
        document.getElementById('quizQuestionBox').classList.remove('hidden');
        renderQuizQuestion();
    } catch (e) {
        console.error(e);
        showToast("The Oracle failed to generate questions. Try another category.", "error");
        resetQuiz();
    }
}

function renderQuizQuestion() {
    const q = quizState.questions[quizState.currentIndex];
    const total = quizState.questions.length;
    const current = quizState.currentIndex + 1;
    
    document.getElementById('quizProgressText').innerText = `Question ${current.toString().padStart(2, '0')} / ${total}`;
    document.getElementById('quizCategoryLabel').innerText = quizState.category.toUpperCase();
    document.getElementById('quizQuestionText').innerText = q.q;
    
    // Render Visual Progress Dots
    const progressEl = document.getElementById('quizVisualProgress');
    progressEl.innerHTML = Array(total).fill(0).map((_, i) => {
        const state = i < quizState.currentIndex ? 'bg-indigo-500' : (i === quizState.currentIndex ? 'bg-indigo-500 animate-pulse' : 'bg-white/10');
        return `<div class="w-3 h-1 rounded-full ${state}"></div>`;
    }).join('');

    const optionsBox = document.getElementById('quizOptions');
    optionsBox.innerHTML = q.o.map((opt, idx) => `
        <button onclick="handleQuizAnswer(${idx})" class="quiz-opt-btn group/opt" id="opt-${idx}">
            <div class="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[11px] font-black group-hover/opt:bg-indigo-600 group-hover/opt:text-white group-hover/opt:border-indigo-400 transition-all shadow-inner">
                ${String.fromCharCode(65 + idx)}
            </div>
            <span class="flex-grow text-left text-sm font-medium text-gray-300 group-hover/opt:text-white transition-colors">${opt}</span>
            <i class="fas fa-chevron-right text-[8px] opacity-0 group-hover/opt:opacity-100 group-hover/opt:translate-x-1 transition-all text-indigo-400"></i>
        </button>
    `).join('');

    startQuizTimer();
}

function startQuizTimer() {
    if (quizState.timer) clearInterval(quizState.timer);
    quizState.timeLeft = 100;
    document.getElementById('quizTimerBox').classList.remove('hidden');
    
    // 30 seconds = 30000ms. Interval is 50ms.
    // 30000 / 50 = 600 ticks.
    // 100 / 600 = 0.1666...
    quizState.timer = setInterval(() => {
        quizState.timeLeft -= (100 / 600);
        document.getElementById('quizTimerBar').style.width = quizState.timeLeft + '%';
        if (quizState.timeLeft <= 0) {
            clearInterval(quizState.timer);
            handleQuizAnswer(-1); // Timeout
        }
    }, 50);
}

async function handleQuizAnswer(idx) {
    clearInterval(quizState.timer);
    const correctIdx = quizState.questions[quizState.currentIndex].a;
    const isCorrect = idx === correctIdx;
    
    // UI feedback
    const btns = document.querySelectorAll('.quiz-opt-btn');
    btns.forEach(b => {
        b.disabled = true;
        b.classList.add('opacity-50');
    });
    
    if (idx !== -1) {
        const selectedBtn = document.getElementById(`opt-${idx}`);
        selectedBtn.classList.remove('opacity-50');
        selectedBtn.classList.add(isCorrect ? 'quiz-correct' : 'quiz-wrong');
    }
    
    const correctBtn = document.getElementById(`opt-${correctIdx}`);
    correctBtn.classList.remove('opacity-50');
    correctBtn.classList.add('quiz-correct');
    
    // Explicitly show correct answer context
    if (!isCorrect && idx !== -1) {
        showToast(`Incorrect. The correct answer was ${String.fromCharCode(65 + correctIdx)}.`, "error", 1500);
    } else if (idx === -1) {
        showToast(`Time up! Correct answer: ${String.fromCharCode(65 + correctIdx)}.`, "warning", 1500);
    }

    if (isCorrect) {
        const bonus = Math.round(quizState.timeLeft / 10);
        quizState.score += (10 + bonus);
        document.getElementById('quizScoreDisplay').innerText = quizState.score.toString().padStart(3, '0');
        if (window.navigator.vibrate) window.navigator.vibrate(20);
    } else {
        if (window.navigator.vibrate) window.navigator.vibrate([30, 30, 30]);
    }

    quizState.results.push({ q: quizState.questions[quizState.currentIndex].q, correct: isCorrect });

    setTimeout(() => {
        if (quizState.currentIndex < quizState.questions.length - 1) {
            quizState.currentIndex++;
            renderQuizQuestion();
        } else {
            finishQuiz();
        }
    }, 1200);
}

async function finishQuiz() {
    quizState.active = false;
    document.getElementById('quizQuestionBox').classList.add('hidden');
    document.getElementById('quizTimerBox').classList.add('hidden');
    document.getElementById('quizLoading').classList.remove('hidden');

    const totalScore = quizState.score;
    const correctCount = quizState.results.filter(r => r.correct).length;
    
    try {
        // Get AI Evaluation
        const prompt = `The user completed a "${quizState.category}" quiz. Score: ${totalScore}/200. Correct: ${correctCount}/${quizState.questions.length}. 
        Give a single, concise, and mystical/intellectual one-sentence evaluation of their performance.`;
        
        const model = document.getElementById('focusModelSelect').value; // Get model from focus dropdown
        const key = aiConfig.keys[currentKeyIndex];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const insight = data.candidates?.[0]?.content?.parts?.[0]?.text || "Your journey through the lattice of knowledge continues.";

        document.getElementById('quizLoading').classList.add('hidden');
        document.getElementById('quizSummary').classList.remove('hidden');
        document.getElementById('summaryFinalScore').innerText = totalScore;
        document.getElementById('summaryInsight').innerText = insight;

        if (currentUser) {
            await fetch(`/api/main?route=quiz_score&userId=${encodeURIComponent(currentUser.email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    category: quizState.category, 
                    score: totalScore, 
                    correct: correctCount, 
                    total: quizState.questions.length 
                })
            });
            syncQuizLeaderboard();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('quizLoading').classList.add('hidden');
        document.getElementById('quizSummary').classList.remove('hidden');
    }
}

async function syncQuizLeaderboard() {
    const list = document.getElementById('quizLeaderboardList');
    if (!list) return;
    try {
        const res = await fetch('/api/main?route=quiz_leaderboard');
        const data = await res.json();
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="text-[10px] text-gray-500 italic p-4 text-center">No legends yet.</p>';
            return;
        }
        list.innerHTML = data.map((u, i) => `
            <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-indigo-500/20 transition-all">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black ${i < 3 ? 'text-yellow-500' : 'text-gray-600'}">#${(i+1).toString().padStart(2, '0')}</span>
                    <span class="text-xs font-bold text-gray-200 truncate max-w-[120px]">${u.name}</span>
                </div>
                <span class="text-xs font-black text-indigo-400 font-mono">${u.totalSoulScore}</span>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

function resetQuiz() {
    if (quizState.timer) clearInterval(quizState.timer);
    quizState.active = false;
    document.getElementById('quizIntro').classList.remove('hidden');
    document.getElementById('quizLoading').classList.add('hidden');
    document.getElementById('quizQuestionBox').classList.add('hidden');
    document.getElementById('quizSummary').classList.add('hidden');
    document.getElementById('quizScoreDisplay').innerText = '000';
    document.getElementById('quizTimerBox').classList.add('hidden');
}

// --- sOuLSNAKE ENGINE (REBUILT FOR PERFORMANCE) ---
let snake, food, dx, dy, score, snakeInterval, snakeCanvas, snakeCtx;
let snakeGridSize = 20;
let nextDx, nextDy; 
let touchStartX = 0;
let touchStartY = 0;

function handleSnakeSwipe() {
    const canvas = document.getElementById('snakeCanvas');
    if (!canvas) return;

    canvas.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    canvas.addEventListener('touchend', e => {
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;
        
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        const threshold = 30;

        if (Math.abs(diffX) > Math.abs(diffY)) {
            if (Math.abs(diffX) > threshold) {
                if (diffX > 0) handleManualSnakeMove('right');
                else handleManualSnakeMove('left');
            }
        } else {
            if (Math.abs(diffY) > threshold) {
                if (diffY > 0) handleManualSnakeMove('down');
                else handleManualSnakeMove('up');
            }
        }
    }, { passive: true });
}

function initSnake() {
    handleSnakeSwipe();
    snakeCanvas = document.getElementById('snakeCanvas');
    if (!snakeCanvas) return;
    
    snakeCanvas.width = 400;
    snakeCanvas.height = 400;
    snakeCtx = snakeCanvas.getContext('2d');
    
    snake = [
        {x: 200, y: 200}, 
        {x: 180, y: 200}, 
        {x: 160, y: 200}
    ];
    dx = snakeGridSize; dy = 0;
    nextDx = dx; nextDy = dy;
    score = 0;
    createFood();
    clearSnakeCanvas();
    drawSnakeBody();
    drawSnakeFood();
}

function startSnake() {
    if (snakeInterval) clearInterval(snakeInterval);
    initSnake();
    document.getElementById('snakeMenu').classList.add('hidden');
    document.getElementById('quitSnakeBtn').classList.remove('hidden');
    // Lock scroll and focus
    document.body.style.overflow = 'hidden';
    // Prevent default touch actions on canvas to stop scrolling while playing
    document.getElementById('snakeCanvas').style.touchAction = 'none';
    const container = document.getElementById('snakeGameContainer');
    if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    snakeInterval = setInterval(mainSnake, 100);
    updateSnakeUI();
}

function quitSnake() {
    clearInterval(snakeInterval);
    snakeInterval = null;
    // Unlock scroll
    document.body.style.overflow = '';
    const canvas = document.getElementById('snakeCanvas');
    if (canvas) canvas.style.touchAction = 'auto';
    const menu = document.getElementById('snakeMenu');
    const btn = document.getElementById('quitSnakeBtn');
    if (menu) menu.classList.remove('hidden');
    if (btn) btn.classList.add('hidden');
}

function mainSnake() {
    dx = nextDx; dy = nextDy; // Apply queued direction
    if (didSnakeGameEnd()) {
        handleSnakeGameOver();
        return;
    }
    clearSnakeCanvas();
    drawSnakeFood();
    advanceSnakeBody();
    drawSnakeBody();
}

async function handleSnakeGameOver() {
    clearInterval(snakeInterval);
    snakeInterval = null;
    showToast(`GAME OVER | SCORE: ${score}`, "error");
    if (currentUser) {
        await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'snake', score: score })
        });
        syncSnakeLeaderboard();
    }
    setTimeout(initSnake, 1000);
    document.getElementById('snakeMenu').classList.remove('hidden');
}

function clearSnakeCanvas() {
    snakeCtx.fillStyle = "#000";
    snakeCtx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
    snakeCtx.strokeStyle = "rgba(255,255,255,0.02)";
    for(let i=0; i<snakeCanvas.width; i+=snakeGridSize) {
        snakeCtx.beginPath(); snakeCtx.moveTo(i,0); snakeCtx.lineTo(i,400); snakeCtx.stroke();
        snakeCtx.beginPath(); snakeCtx.moveTo(0,i); snakeCtx.lineTo(400,i); snakeCtx.stroke();
    }
}

function drawSnakeBody() {
    snake.forEach((part, i) => {
        const isHead = i === 0;
        snakeCtx.fillStyle = isHead ? "#22c55e" : "#065f46";
        const r = isHead ? 6 : 4;
        const x = part.x + 1, y = part.y + 1, w = snakeGridSize - 2, h = snakeGridSize - 2;
        
        snakeCtx.beginPath();
        snakeCtx.roundRect(x, y, w, h, r);
        snakeCtx.fill();

        if (isHead) {
            snakeCtx.fillStyle = "#fff";
            if (dx > 0) { snakeCtx.fillRect(x+12, y+4, 3, 3); snakeCtx.fillRect(x+12, y+11, 3, 3); }
            else if (dx < 0) { snakeCtx.fillRect(x+3, y+4, 3, 3); snakeCtx.fillRect(x+3, y+11, 3, 3); }
            else if (dy < 0) { snakeCtx.fillRect(x+4, y+3, 3, 3); snakeCtx.fillRect(x+11, y+3, 3, 3); }
            else { snakeCtx.fillRect(x+4, y+12, 3, 3); snakeCtx.fillRect(x+11, y+12, 3, 3); }
        }
    });
}

function advanceSnakeBody() {
    const head = {x: snake[0].x + dx, y: snake[0].y + dy};
    snake.unshift(head);
    if (snake[0].x === food.x && snake[0].y === food.y) {
        score += 10;
        updateSnakeUI();
        createFood();
        if (window.navigator.vibrate) window.navigator.vibrate(15);
    } else {
        snake.pop();
    }
}

function didSnakeGameEnd() {
    const head = snake[0];
    for (let i = 4; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) return true;
    }
    return head.x < 0 || head.x >= 400 || head.y < 0 || head.y >= 400;
}

function createFood() {
    food = {
        x: Math.floor(Math.random() * 20) * snakeGridSize,
        y: Math.floor(Math.random() * 20) * snakeGridSize
    };
    if (snake.some(p => p.x === food.x && p.y === food.y)) createFood();
}

function drawSnakeFood() {
    snakeCtx.fillStyle = "#ef4444";
    snakeCtx.shadowBlur = 10;
    snakeCtx.shadowColor = "#ef4444";
    snakeCtx.beginPath();
    snakeCtx.arc(food.x + 10, food.y + 10, 7, 0, Math.PI * 2);
    snakeCtx.fill();
    snakeCtx.shadowBlur = 0;
}

function updateSnakeUI() {
    const el = document.getElementById('snakeScore');
    if (el) el.innerText = score.toString().padStart(3, '0');
}

function handleManualSnakeMove(dir) {
    if (dir === 'left' && dx === 0) { nextDx = -snakeGridSize; nextDy = 0; }
    if (dir === 'up' && dy === 0) { nextDx = 0; nextDy = -snakeGridSize; }
    if (dir === 'right' && dx === 0) { nextDx = snakeGridSize; nextDy = 0; }
    if (dir === 'down' && dy === 0) { nextDx = 0; nextDy = snakeGridSize; }
}

document.addEventListener("keydown", (e) => {
    if (!snakeInterval) return;
    const key = e.key.toLowerCase();
    // Prevent scrolling with arrows or space while game is active
    if (["arrowleft", "a", "arrowup", "w", "arrowright", "d", "arrowdown", "s", " "].includes(key)) {
        e.preventDefault();
        if (["arrowleft", "a"].includes(key)) handleManualSnakeMove('left');
        if (["arrowup", "w"].includes(key)) handleManualSnakeMove('up');
        if (["arrowright", "d"].includes(key)) handleManualSnakeMove('right');
        if (["arrowdown", "s"].includes(key)) handleManualSnakeMove('down');
    }
});

async function syncSnakeLeaderboard() {
    const list = document.getElementById('snakeLeaderboardList');
    if (!list) return;
    try {
        const res = await fetch('/api/main?route=snake_leaderboard');
        const data = await res.json();
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="text-[10px] text-gray-500 italic p-4 text-center">No data.</p>';
            return;
        }
        list.innerHTML = data.map((u, i) => `
            <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-green-500/20 transition-all">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black ${i < 3 ? 'text-yellow-500' : 'text-gray-600'}">#${(i+1).toString().padStart(2, '0')}</span>
                    <span class="text-xs font-bold text-gray-200 truncate max-w-[120px]">${u.name}</span>
                </div>
                <span class="text-xs font-black text-green-400 font-mono">${u.highScore}</span>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

function shakeBall() {
    const core = document.getElementById('sphereCore');
    const response = document.getElementById('ballResponse');
    
    core.style.animation = 'none';
    void core.offsetWidth;
    core.style.animation = 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both';
    
    response.style.opacity = '0';
    
    const answers = [
        "IT IS CERTAIN", "WITHOUT A DOUBT", "DECRYPTING... YES", 
        "VOID SAYS NO", "SYSTEM UNCERTAIN", "QUERY LATER",
        "SOURCE CODE REVEALS YES", "LOGIC ERROR: NO", "UNLIKELY",
        "CONCENTRATE ON SOUL", "THE PATH IS CLEAR"
    ];
    
    setTimeout(() => {
        response.innerText = answers[Math.floor(Math.random() * answers.length)];
        response.style.opacity = '1';
    }, 500);
}

// --- sOuLFUN Page State & Logic ---
let funState = {
    clicker: { active: false, count: 0, timeLeft: 10, lastTime: 0, interval: null },
    reaction: { timer: null, start: 0, active: false },
    alchemy: { slots: [null, null], discoveries: new Set(JSON.parse(localStorage.getItem('soul_alchemy_discovery')) || []) },
    particles: { array: [], canvas: null, ctx: null, lastSpawn: 0 }
};

// Breathing state unified
let zenInterval = null;
let breathingState = {
    active: false,
    interval: null,
    phase: 0, 
    sessionSeconds: 0,
    soundEnabled: false,
    audioCtx: null,
    oscillator: null
};

function toggleBreathingSound() {
    breathingState.soundEnabled = !breathingState.soundEnabled;
    const btn = document.getElementById('breathSoundBtn');
    btn.innerHTML = breathingState.soundEnabled ? '<i class="fas fa-volume-up text-teal-400"></i>' : '<i class="fas fa-volume-mute"></i>';
    if (!breathingState.soundEnabled && breathingState.audioCtx) {
        breathingState.audioCtx.suspend();
    } else if (breathingState.soundEnabled && breathingState.audioCtx) {
        breathingState.audioCtx.resume();
    }
}

function playBreathingPulse(frequency, duration) {
    if (!breathingState.soundEnabled) return;
    try {
        if (!breathingState.audioCtx) breathingState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (breathingState.audioCtx.state === 'suspended') breathingState.audioCtx.resume();

        const osc = breathingState.audioCtx.createOscillator();
        const gain = breathingState.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, breathingState.audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0, breathingState.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, breathingState.audioCtx.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, breathingState.audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(breathingState.audioCtx.destination);

        osc.start();
        osc.stop(breathingState.audioCtx.currentTime + duration);
    } catch (e) { console.warn("Audio Error:", e); }
}

async function toggleBreathingSession() {
    const circle = document.getElementById('breathAssistCircle');
    const text = document.getElementById('breathAssistText');
    const bar = document.getElementById('breathPhaseBar');
    const btn = document.getElementById('breathStartBtn');
    const syncTimer = document.getElementById('syncFocusTimer')?.checked;

    if (breathingState.active) {
        // End Session
        clearInterval(breathingState.interval);
        breathingState.active = false;
        breathingState.phase = 0;
        
        if (syncTimer) pauseFocusAction();

        // Save practice time and automate journal
        if (breathingState.sessionSeconds > 5) {
            const minutes = Math.round(breathingState.sessionSeconds / 60 * 10) / 10;
            const logMsg = `Completed ${minutes}m of Box Breathing meditation.`;
            
            const journalInput = document.getElementById('journalInput');
            if (journalInput) {
                journalInput.value = (journalInput.value ? journalInput.value + '\n' : '') + logMsg;
            }

            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        type: 'breathing_practice', 
                        duration: breathingState.sessionSeconds, 
                        minutes: minutes,
                        timestamp: Date.now() 
                    })
                });
                syncFocusData();
            }
            showToast(logMsg, "info");
        }

        circle.style.transform = 'scale(1)';
        circle.style.borderColor = 'rgba(20, 184, 166, 0.2)';
        text.innerText = 'Ready';
        bar.style.width = '0%';
        btn.innerText = 'Start Box Breathing';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        return;
    }

    // Start Session
    breathingState.active = true;
    breathingState.sessionSeconds = 0;
    btn.innerText = 'End Session';
    btn.classList.replace('bg-teal-600', 'bg-red-600');

    if (syncTimer) {
        toggleFocusMode('stopwatch');
        startFocusAction();
    }

    const phases = [
        { text: 'Inhale', scale: 1.5, color: '#14b8a6', freq: 440 },
        { text: 'Hold', scale: 1.5, color: '#0d9488', freq: 554 },
        { text: 'Exhale', scale: 1, color: '#0f766e', freq: 330 },
        { text: 'Hold', scale: 1, color: '#134e4a', freq: 220 }
    ];

    const runPhase = () => {
        const p = phases[breathingState.phase];
        text.innerText = p.text;
        circle.style.transform = `scale(${p.scale})`;
        circle.style.borderColor = p.color;
        
        // Handle Progress Bar
        bar.style.transitionDuration = '0s';
        bar.style.width = '0%';
        setTimeout(() => {
            bar.style.transitionDuration = '4000ms';
            bar.style.width = '100%';
        }, 50);

        // Play sound pulse at start of each phase
        playBreathingPulse(p.freq, 1.5);
        
        breathingState.sessionSeconds += 4;
        breathingState.phase = (breathingState.phase + 1) % 4;
    };

    runPhase();
    breathingState.interval = setInterval(runPhase, 4000);
}

function toggleZenBreath(btn) {
    // Legacy fun page version, updated to use sound if enabled
    const circle = document.getElementById('breathCircle');
    const text = document.getElementById('breathText');
    
    if (zenInterval) {
        clearInterval(zenInterval);
        zenInterval = null;
        circle.style.transform = 'scale(1)';
        text.innerText = 'INHALE';
        btn.innerText = 'START SESSION';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        return;
    }

    btn.innerText = 'END SESSION';
    btn.classList.replace('bg-teal-600', 'bg-red-600');
    
    let stage = 0;
    const animate = () => {
        if (stage === 0) { // Inhale
            circle.style.transform = 'scale(1.5)';
            text.innerText = 'INHALE';
            if (breathingState.soundEnabled) playBreathingPulse(440, 1);
            stage = 1;
        } else { // Exhale
            circle.style.transform = 'scale(1)';
            text.innerText = 'EXHALE';
            if (breathingState.soundEnabled) playBreathingPulse(330, 1);
            stage = 0;
        }
    };
    
    animate();
    zenInterval = setInterval(animate, 4000);
}

function startReactionTest() {
    const area = document.getElementById('reactionArea');
    const pulse = document.getElementById('reactionPulse');
    const text = document.getElementById('reactionText');
    const result = document.getElementById('reactionResult');
    const btn = document.getElementById('reactionBtn');
    const s = funState.reaction;

    if (s.active) return;
    s.active = true;

    btn.disabled = true;
    btn.classList.add('opacity-50');
    result.classList.add('hidden');
    pulse.style.backgroundColor = 'transparent';
    text.innerText = 'WAIT FOR SIGNAL...';
    
    const delay = Math.random() * 4000 + 1500;
    
    s.timer = setTimeout(() => {
        pulse.style.backgroundColor = '#10b981';
        text.innerText = 'STRIKE!';
        s.start = Date.now();
        
        area.onclick = async () => {
            const diff = Date.now() - s.start;
            let rank = diff < 150 ? "AI Core" : (diff < 220 ? "Ninja" : "Human");

            text.innerText = `RANK: ${rank}`;
            result.innerText = `${diff}ms`;
            result.classList.remove('hidden');
            pulse.style.backgroundColor = 'transparent';
            area.onclick = null;
            btn.disabled = false;
            btn.classList.remove('opacity-50');
            s.active = false;
            
            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'reaction', score: diff })
                });
                syncFunLeaderboard();
            }
        };
    }, delay);

    area.onclick = () => {
        clearTimeout(s.timer);
        text.innerText = 'FALSE START';
        pulse.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        area.onclick = null;
        btn.disabled = false;
        btn.classList.remove('opacity-50');
        s.active = false;
    };
}


// --- sOuLFOCUS LOGIC ---
let focusState = {
    currentMode: 'japa', // 'japa', 'tapasya', 'ananta'
    japa: {
        count: 0,
        mantra: "",
        interval: null,
        rippleTimeout: null
    },
    tapasya: {
        timeRemaining: 30 * 60, // seconds
        interval: null,
        intention: "",
        isBreathingActive: false
    },
    ananta: {
        stopwatchTime: 0, // seconds
        interval: null,
        intention: ""
    }
};

let focusChime = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');


function initFocusPage() {
    document.getElementById('journalDate').innerText = new Date().toDateString().toUpperCase();
    setFocusMode(focusState.currentMode);
    syncFocusData(); // Load persisted data for all modes
    // Initial call to update breathing total if it's rendered by default
    updateBreathingTotalTimeUI();
}

function setFocusMode(mode, saveToCloud = true) {
    focusState.currentMode = mode;
    ['japaMode', 'tapasyaMode', 'anantaMode'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const modeEl = document.getElementById(`${mode}Mode`);
    if (modeEl) modeEl.classList.remove('hidden');

    ['modeJapa', 'modeTapasya', 'modeAnanta'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.remove('active');
            btn.classList.replace('bg-cyan-600/20', 'bg-white/5');
            btn.classList.replace('text-cyan-400', 'text-gray-400');
            btn.classList.replace('border-cyan-500/30', 'border-white/10');
            btn.classList.remove('shadow-lg', 'shadow-cyan-600/20');
        }
    });

    const activeBtnName = `mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
    const activeBtn = document.getElementById(activeBtnName);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.classList.replace('bg-white/5', 'bg-cyan-600/20');
        activeBtn.classList.replace('text-gray-400', 'text-cyan-400');
        activeBtn.classList.replace('border-white/10', 'border-cyan-500/30');
        activeBtn.classList.add('shadow-lg', 'shadow-cyan-600/20');
    }

    // Stop all intervals when switching modes to prevent background execution
    stopJapa();
    pauseTapasyaTimer();
    pauseAnantaStopwatch();
    if (breathingState.active) toggleBreathingSession(); 

    // Reload content for the active mode
    renderFocusModeUI();
    
    // Only save if explicitly requested, and never call loadFocusData here to avoid recursion loops
    if (saveToCloud) {
        saveFocusData();
    }
}

function renderFocusModeUI() {
    // Japa Mode UI
    document.getElementById('japaCounterDisplay').innerText = focusState.japa.count;
    document.getElementById('japaMantraInput').value = focusState.japa.mantra;

    // Tapasya Mode UI
    document.getElementById('tapasyaIntentionInput').value = focusState.tapasya.intention;
    updateTapasyaDisplay();
    // Breathing assistant state is managed by its own functions but display needs update
    if (breathingState.active && focusState.currentMode !== 'tapasya') toggleBreathingSession(); // Ensure breathing stops if mode changes from Tapasya
    if (focusState.tapasya.isBreathingActive && !breathingState.active) toggleBreathingSession(); // Start breathing if was active in Tapasya
    
    // Ananta Mode UI
    document.getElementById('anantaIntentionInput').value = focusState.ananta.intention;
    updateAnantaDisplay();
}

// --- Japa Dhyana Mode Functions ---
function incrementJapa() {
    focusState.japa.count++;
    document.getElementById('japaCounterDisplay').innerText = focusState.japa.count;
    triggerJapaRipple();
    if (window.navigator.vibrate) window.navigator.vibrate(5);
    saveFocusData();
}

function resetJapa() {
    if (!confirm("Reset Japa count?")) return;
    focusState.japa.count = 0;
    document.getElementById('japaCounterDisplay').innerText = focusState.japa.count;
    showToast("Japa count reset.", "warning");
    saveFocusData();
}

function stopJapa() {
    // No continuous interval for Japa, just a tap counter
}

function triggerJapaRipple() {
    const btn = document.getElementById('japaTapBtn');
    const ripple = document.getElementById('japaRipple');
    const size = Math.max(btn.offsetWidth, btn.offsetHeight);
    const x = event.offsetX === undefined ? size / 2 : event.offsetX;
    const y = event.offsetY === undefined ? size / 2 : event.offsetY;

    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`;
    ripple.style.top = `${y - size / 2}px`;
    
    ripple.classList.remove('scale-0', 'opacity-0');
    ripple.classList.add('scale-100', 'opacity-50');

    if (focusState.japa.rippleTimeout) clearTimeout(focusState.japa.rippleTimeout);
    focusState.japa.rippleTimeout = setTimeout(() => {
        ripple.classList.remove('scale-100', 'opacity-50');
        ripple.classList.add('scale-0', 'opacity-0');
    }, 500);
}


// --- Tapasya/Saadhana Mode Functions (Timer) ---
function updateTapasyaDuration(mins) {
    focusState.tapasya.timeRemaining = parseInt(mins) * 60;
    updateTapasyaDisplay();
    saveFocusData();
}

function updateTapasyaDisplay() {
    const format = (s) => {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        if (hrs > 0) return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    document.getElementById('tapasyaTimerDisplay').innerText = format(focusState.tapasya.timeRemaining);
}

function startTapasyaTimer() {
    if (focusState.tapasya.interval) return;
    
    document.getElementById('tapasyaStartBtn').classList.add('hidden');
    document.getElementById('tapasyaPauseBtn').classList.remove('hidden');

    focusState.tapasya.interval = setInterval(async () => {
        if (focusState.tapasya.timeRemaining <= 0) {
            clearInterval(focusState.tapasya.interval);
            focusState.tapasya.interval = null;
            focusChime.play();
            
            const initialMins = parseInt(document.getElementById('tapasyaTimerRange').value);
            const logMsg = `Completed ${initialMins}m Tapasya/Saadhana session with intention: "${focusState.tapasya.intention}".`;
            const journalInput = document.getElementById('journalInput');
            if (journalInput) journalInput.value = (journalInput.value ? journalInput.value + '\n' : '') + logMsg;
            
            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        type: 'tapasya_session', 
                        duration: initialMins * 60, 
                        minutes: initialMins, 
                        intention: focusState.tapasya.intention,
                        timestamp: Date.now() 
                    })
                });
                syncFocusData();
            }

            showToast("Tapasya session complete!", "success");
            resetTapasyaTimer();
            return;
        }
        focusState.tapasya.timeRemaining--;
        updateTapasyaDisplay();
        saveFocusData();
    }, 1000);
}

function pauseTapasyaTimer() {
    clearInterval(focusState.tapasya.interval);
    focusState.tapasya.interval = null;
    document.getElementById('tapasyaStartBtn').classList.remove('hidden');
    document.getElementById('tapasyaPauseBtn').classList.add('hidden');
}

function resetTapasyaTimer() {
    pauseTapasyaTimer();
    const initialMins = parseInt(document.getElementById('tapasyaTimerRange').value);
    focusState.tapasya.timeRemaining = initialMins * 60;
    updateTapasyaDisplay();
    saveFocusData();
}

// --- Ananta Nishkam Dhyana Mode Functions (Stopwatch) ---
function updateAnantaDisplay() {
    const format = (s) => {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    document.getElementById('anantaStopwatchDisplay').innerText = format(focusState.ananta.stopwatchTime);
}

function startAnantaStopwatch() {
    if (focusState.ananta.interval) return;

    document.getElementById('anantaStartBtn').classList.add('hidden');
    document.getElementById('anantaPauseBtn').classList.remove('hidden');

    focusState.ananta.interval = setInterval(() => {
        focusState.ananta.stopwatchTime++;
        updateAnantaDisplay();
        saveFocusData();
    }, 1000);
}

function pauseAnantaStopwatch() {
    clearInterval(focusState.ananta.interval);
    focusState.ananta.interval = null;
    document.getElementById('anantaStartBtn').classList.remove('hidden');
    document.getElementById('anantaPauseBtn').classList.add('hidden');
}

function resetAnantaStopwatch() {
    pauseAnantaStopwatch();
    focusState.ananta.stopwatchTime = 0;
    updateAnantaDisplay();
    showToast("Ananta stopwatch reset.", "warning");
    saveFocusData();
}

// --- General Focus Page Functions (modified for new modes) ---
async function saveFocusData() {
    if (!currentUser) return;
    const focusData = {
        currentMode: focusState.currentMode,
        japa: {
            count: focusState.japa.count,
            mantra: document.getElementById('japaMantraInput').value
        },
        tapasya: {
            timeRemaining: focusState.tapasya.timeRemaining,
            intention: document.getElementById('tapasyaIntentionInput').value,
            isBreathingActive: breathingState.active // Save state of breathing in Tapasya
        },
        ananta: {
            stopwatchTime: focusState.ananta.stopwatchTime,
            intention: document.getElementById('anantaIntentionInput').value
        }
    };

    try {
        await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT', // Use PUT for upserting single focus config document
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'focus_state', ...focusData })
        });
    } catch (e) { console.warn("Failed to save focus data", e); }
}

async function loadFocusData() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        const storedFocusState = data.find(item => item.id === 'focus_state');

        if (storedFocusState) {
            focusState.currentMode = storedFocusState.currentMode || 'japa';
            
            focusState.japa.count = storedFocusState.japa?.count || 0;
            focusState.japa.mantra = storedFocusState.japa?.mantra || "";
            document.getElementById('japaCounterDisplay').innerText = focusState.japa.count;
            document.getElementById('japaMantraInput').value = focusState.japa.mantra;

            focusState.tapasya.timeRemaining = storedFocusState.tapasya?.timeRemaining || (parseInt(document.getElementById('tapasyaTimerRange').value) * 60) || (25 * 60);
            focusState.tapasya.intention = storedFocusState.tapasya?.intention || "";
            document.getElementById('tapasyaIntentionInput').value = focusState.tapasya.intention;
            updateTapasyaDisplay();
            const savedTapasyaMins = focusState.tapasya.timeRemaining / 60;
            if (document.getElementById('tapasyaTimerRange')) document.getElementById('tapasyaTimerRange').value = savedTapasyaMins;
            
            focusState.ananta.stopwatchTime = storedFocusState.ananta?.stopwatchTime || 0;
            focusState.ananta.intention = storedFocusState.ananta?.intention || "";
            document.getElementById('anantaIntentionInput').value = focusState.ananta.intention;
            updateAnantaDisplay();

            setFocusMode(focusState.currentMode, false); 
            
            breathingState.active = storedFocusState.tapasya?.isBreathingActive || false;
            if (focusState.currentMode === 'tapasya' && breathingState.active) {
                const btn = document.getElementById('breathStartBtn');
                if (btn && btn.innerText === 'Start Box Breathing') { 
                    toggleBreathingSession();
                }
            }
        }
        updateBreathingTotalTimeUI();
    } catch (e) { console.warn("Focus data load failed", e); }
}

async function toggleBreathingSession() {
    const circle = document.getElementById('breathAssistCircle');
    const text = document.getElementById('breathAssistText');
    const bar = document.getElementById('breathPhaseBar');
    const btn = document.getElementById('breathStartBtn');

    if (breathingState.active) {
        // End Session
        clearInterval(breathingState.interval);
        breathingState.interval = null;
        breathingState.active = false;
        breathingState.phase = 0;
        
        // Save practice time and automate journal only if it was a meaningful session
        if (breathingState.sessionSeconds > 5) {
            const minutes = Math.round(breathingState.sessionSeconds / 60 * 10) / 10;
            const logMsg = `Completed ${minutes}m of Box Breathing meditation.`;
            
            const journalInput = document.getElementById('journalInput');
            if (journalInput) {
                journalInput.value = (journalInput.value ? journalInput.value + '\n' : '') + logMsg;
            }

            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        type: 'breathing_practice', 
                        duration: breathingState.sessionSeconds, 
                        minutes: minutes,
                        timestamp: Date.now() 
                    })
                });
                syncFocusData(); // Update total breathing time in UI
            }
            showToast(logMsg, "info");
        }

        circle.style.transform = 'scale(1)';
        circle.style.borderColor = 'rgba(20, 184, 166, 0.2)';
        text.innerText = 'Ready';
        bar.style.width = '0%';
        btn.innerText = 'Start Box Breathing';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        breathingState.sessionSeconds = 0; // Reset session seconds
        if(focusState.currentMode === 'tapasya') saveFocusData(); // Save breathing state for Tapasya
        return;
    }

    // Start Session
    breathingState.active = true;
    breathingState.sessionSeconds = 0;
    btn.innerText = 'End Session';
    btn.classList.replace('bg-teal-600', 'bg-red-600');

    const phases = [
        { text: 'Inhale', duration: 4, scale: 1.5, color: '#14b8a6', freq: 440 },
        { text: 'Hold', duration: 4, scale: 1.5, color: '#0d9488', freq: 554 },
        { text: 'Exhale', duration: 4, scale: 1, color: '#0f766e', freq: 330 },
        { text: 'Hold', duration: 4, scale: 1, color: '#134e4a', freq: 220 }
    ];

    const runPhase = () => {
        const p = phases[breathingState.phase];
        text.innerText = p.text;
        circle.style.transform = `scale(${p.scale})`;
        circle.style.borderColor = p.color;
        
        bar.style.transitionDuration = '0s';
        bar.style.width = '0%';
        setTimeout(() => {
            bar.style.transitionDuration = `${p.duration * 1000}ms`;
            bar.style.width = '100%';
        }, 50);

        playBreathingPulse(p.freq, p.duration / 2); // Play pulse for half duration
        
        breathingState.sessionSeconds += p.duration; // Increment by phase duration
        breathingState.phase = (breathingState.phase + 1) % 4;
    };

    runPhase();
    breathingState.interval = setInterval(runPhase, 4000); // Intervals are 4s
    if(focusState.currentMode === 'tapasya') saveFocusData(); // Save breathing state for Tapasya
}

async function updateBreathingTotalTimeUI() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            const breathingLogs = data.filter(d => d.type === 'breathing_practice');
            const totalSeconds = breathingLogs.reduce((acc, curr) => acc + (curr.duration || 0), 0);
            const totalMinutes = Math.floor(totalSeconds / 60);
            const displayTime = totalMinutes > 60 ? `${(totalMinutes/60).toFixed(1)}h` : `${totalMinutes}m`;
            const breathStatEl = document.getElementById('breathTotalTime');
            if (breathStatEl) breathStatEl.innerText = `Practice: ${displayTime}`;
        }
    } catch (e) { console.warn("Failed to fetch breathing practice stats for UI update", e); }
}

async function syncFocusData() {
    if (!currentUser) return;
    // Call loadFocusData to load the persisted state
    await loadFocusData();

    // Now proceed with other sync tasks as before
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            // Update Breathing Total, which is distinct from the active session time
            updateBreathingTotalTimeUI(); // This now explicitly updates the UI
            
            const journals = data.filter(d => d.type === 'journal').sort((a,b) => b.id - a.id);
            const hist = document.getElementById('journalHistory');
            if (journals.length > 0) {
                hist.innerHTML = journals.map(j => `
                    <div class="p-2 bg-white/5 rounded-lg border border-white/5">
                        <p class="text-[10px] font-bold text-purple-400 mb-1">${new Date(j.id).toLocaleDateString()}</p>
                        <p class="text-[10px] text-gray-300 italic truncate">${j.content}</p>
                    </div>
                `).join('');
            } else {
                hist.innerHTML = '<p class="text-[10px] text-gray-500 italic">No entries yet.</p>';
            }

            // Metrics are still global, not tied to a specific mode
            const latestHealth = data.filter(d => d.type === 'metric_health').sort((a,b) => b.timestamp - a.timestamp)[0];
            const latestWealth = data.filter(d => d.type === 'metric_wealth').sort((a,b) => b.timestamp - a.timestamp)[0];
            
            if (latestHealth) document.getElementById('metricHealth').innerText = latestHealth.value;
            if (latestWealth) document.getElementById('metricWealth').innerText = latestWealth.value;
        }
        getSpiritualAdvice(); // Auto-load advice on sync
    } catch (e) { console.warn("Focus page general data sync failed", e); }
}

async function saveJournalEntry() {
    const input = document.getElementById('journalInput');
    const content = input.value.trim();
    if (!content) return;
    if (!currentUser) return alert("Login to save journal entries.");

    setLoading(true, "Journaling...");
    try {
        const entry = {
            id: Date.now(),
            content,
            date: new Date().toISOString()
        };
        await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'journal', ...entry })
        });
        input.value = '';
        showToast("Soul Logged.", "success");
        await syncFocusData();
    } finally {
        setLoading(false);
    }
}

function updateMetric(type, delta) {
    const el = document.getElementById(`metric${type.charAt(0).toUpperCase() + type.slice(1)}`);
    let val = parseInt(el.innerText) + delta;
    if (val < 0) val = 0;
    el.innerText = val;
    
    if (currentUser) {
        fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: `metric_${type}`, value: val })
        });
    }
}

async function getSpiritualAdvice() {
    if (!currentUser) return showToast("Login to access the Soul Oracle.", "warning");
    
    const adviceEl = document.getElementById('soulAdviceContent');
    adviceEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Querying the Oracle...';
    
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const stats = await res.json();
        const journals = stats.filter(d => d.type === 'journal').slice(0, 5).map(j => j.content).join('\n');
        const health = document.getElementById('metricHealth').innerText;
        const wealth = document.getElementById('metricWealth').innerText;

        const prompt = `Based on these recent soul journals: "${journals}" and my metrics (Health: ${health}, Wealth: ${wealth}), give me one sentence of deep spiritual wisdom and one specific actionable advice for my day. Be concise.`;
        
        const model = aiConfig.unifiedModel || "gemini-2.5-flash";
        const key = aiConfig.keys[currentKeyIndex];
        
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await aiRes.json();
        const advice = data.candidates?.[0]?.content?.parts?.[0]?.text || "The Oracle is silent. Try again later.";
        adviceEl.innerText = advice;
    } catch (e) {
        adviceEl.innerText = "Connection to the Oracle lost.";
    }
}

let reportSteps = {
    current: 0,
    questions: [],
    answers: []
};

async function startReportQuestionnaire() {
    if (!currentUser) return showToast("Login to generate reports.", "warning");
    
    reportSteps = { current: 0, questions: [], answers: [] };
    document.getElementById('reportModal').classList.remove('hidden');
    document.getElementById('reportQuestContainer').classList.remove('hidden');
    document.getElementById('reportGenerating').classList.add('hidden');
    document.getElementById('reportAnswer').value = '';
    
    const questionEl = document.getElementById('reportQuestion');
    questionEl.innerText = "Generating reflection path...";

    try {
        const prompt = "Act as a spiritual guide. Generate 3 deep, philosophical questions for a self-actualization report. Return them as a simple numbered list. Do not include any other text.";
        const model = document.getElementById('focusModelSelect').value; // Get model from focus dropdown
        const key = aiConfig.keys[currentKeyIndex];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        reportSteps.questions = text.split('\n').filter(q => q.trim()).map(q => q.replace(/^\d+\.\s+/, ''));
        
        if (reportSteps.questions.length < 3) throw new Error("Oracle failed to speak.");
        
        renderReportQuestion();
    } catch (e) {
        questionEl.innerText = "The path is blocked. Check your connection.";
    }
}

function renderReportQuestion() {
    const q = reportSteps.questions[reportSteps.current];
    document.getElementById('reportQuestion').innerText = q;
    document.getElementById('reportProgress').innerText = `Reflection ${reportSteps.current + 1} / ${reportSteps.questions.length}`;
    document.getElementById('reportAnswer').value = '';
    document.getElementById('reportNextBtn').innerText = reportSteps.current === reportSteps.questions.length - 1 ? "FINALIZE REPORT" : "NEXT REFLECTION";
}

async function nextReportQuestion() {
    const ans = document.getElementById('reportAnswer').value.trim();
    if (!ans) return showToast("Please share your reflection.", "warning");
    
    reportSteps.answers.push({
        question: reportSteps.questions[reportSteps.current],
        answer: ans
    });

    if (reportSteps.current < reportSteps.questions.length - 1) {
        reportSteps.current++;
        renderReportQuestion();
    } else {
        await finishReport();
    }
}

async function finishReport() {
    document.getElementById('reportQuestContainer').classList.add('hidden');
    document.getElementById('reportGenerating').classList.remove('hidden');

    try {
        // AI Analysis Generation
        const model = document.getElementById('focusModelSelect')?.value || aiConfig.models[0]?.id || "gemini-2.5-flash";
        const key = aiConfig.keys[currentKeyIndex];
        const analysisPrompt = `Act as a high-level psychological and spiritual analyst. 
        Based on the following reflections and metrics, provide a deep, insightful, and constructive analysis of the user's current state of soul and productivity. 
        METRICS: Health=${document.getElementById('metricHealth').innerText}, Wealth=${document.getElementById('metricWealth').innerText}
        REFLECTIONS:
        ${reportSteps.answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}
        
        Provide the analysis in structured Markdown with sections for "Core Strengths", "Mental Blocks", and "Path Forward".`;

        const analysisRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: analysisPrompt }] }] })
        });
        const analysisData = await analysisRes.json();
        const aiAnalysis = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || "The Oracle remains silent on this path.";

        // Save answers to persistence
        await fetch(`/api/main?route=user_reports&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timestamp: Date.now(),
                qna: reportSteps.answers,
                analysis: aiAnalysis,
                metrics: {
                    health: document.getElementById('metricHealth').innerText,
                    wealth: document.getElementById('metricWealth').innerText
                }
            })
        });

        // Trigger Export PDF
        const resStats = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const stats = await resStats.json();
        const journals = stats.filter(d => d.type === 'journal').slice(0, 10);
        
        const reportData = {
            id: Date.now(),
            name: `${currentUser.name}'s Soul Report`,
            journals: journals,
            qna: reportSteps.answers,
            analysis: aiAnalysis,
            metrics: {
                health: document.getElementById('metricHealth').innerText,
                wealth: document.getElementById('metricWealth').innerText
            },
            advice: document.getElementById('soulAdviceContent').innerText
        };

        await exportData('report', reportData.id, 'pdf', reportData);
        showToast("Soul Report Transferred Successfully.", "success");
        closeReportModal();
    } catch (e) {
        showToast("Report construction failed.", "error");
        console.error(e);
    }
}

function closeReportModal() {
    document.getElementById('reportModal').classList.add('hidden');
}

// Duplicate syncFocusData removed. Integrated into primary loop.

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

function setCricketDifficulty(level, btn) {
    document.getElementById('cricketDifficulty').value = level;
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.className = "diff-btn bg-gray-800 py-2 rounded-lg text-[10px] font-bold border border-white/5 hover:border-cyan-500/50";
    });
    const colors = { easy: 'green', normal: 'cyan', hard: 'red' };
    const color = colors[level];
    btn.className = `diff-btn bg-${color}-600 py-2 rounded-lg text-[10px] font-bold border border-${color}-400/50 shadow-lg shadow-${color}-600/20`;
}

async function startMatch() {
    const tA = document.getElementById('teamAName').value;
    const tB = document.getElementById('teamBName').value;
    const pA = document.getElementById('teamAPlayers').value;
    const pB = document.getElementById('teamBPlayers').value;
    const oversVal = document.getElementById('cricketOversSelect').value;
    const difficulty = document.getElementById('cricketDifficulty').value;
    
    match.difficulty = difficulty;
    match.maxOvers = parseInt(oversVal);
    match.teams = [
        { name: tA, players: parsePlayers(pA), score: 0, wickets: 0, balls: 0, history: [] },
        { name: tB, players: parsePlayers(pB), score: 0, wickets: 0, balls: 0, history: [] }
    ];
    match.currentInnings = 0;
    match.target = null;
    match.isOver = false;
    match.strikerIdx = 0;
    match.nonStrikerIdx = 1;
    selectBowler();

    // Auto-save setup to database when match starts if logged in
    if (currentUser) {
        try {
            await fetch(`/api/main?route=cricket_setup&userId=${currentUser.email}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tA, tB, pA, pB, overs: oversVal })
            });
        } catch (e) {
            console.warn("Failed to auto-save cricket setup", e);
        }
    }

    document.getElementById('cricketSetup').classList.add('hidden');
    document.getElementById('cricketGround').classList.remove('hidden');
    updateCricketUI();
}

function playCricket() {
    if(match.isOver) return;
    if (window.navigator.vibrate) window.navigator.vibrate(10);
    const battingTeam = match.teams[match.currentInnings];
    const bowlingTeam = match.teams[match.currentInnings === 0 ? 1 : 0];
    const maxBalls = match.maxOvers * 6;
    
    if(battingTeam.wickets >= 10 || battingTeam.balls >= maxBalls || (match.target && battingTeam.score >= match.target)) {
        endInnings(); return;
    }

    const striker = battingTeam.players[match.strikerIdx];
    const bowler = bowlingTeam.players[match.bowlerIdx];
    
    let outcomes = [0, 1, 2, 3, 4, 6, 'W'];
    if (match.difficulty === 'easy') outcomes = [0, 1, 2, 3, 4, 6, 4, 6, 1, 2, 'W'];
    if (match.difficulty === 'hard') outcomes = [0, 1, 2, 'W', 'W', 3, 0, 1];

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
        
        if (striker.runs >= 100 && !striker.milestoneReached) {
            striker.milestoneReached = true;
            triggerCricketCelebration('milestone', `${striker.name} hits a magnificent 100!`);
        }

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

function triggerCricketCelebration(type, detail) {
    const overlay = document.getElementById('cricketOverlay');
    const trophy = document.getElementById('trophyAnim');
    const milestone = document.getElementById('milestoneAnim');
    const canvas = document.getElementById('confettiCanvas');
    
    overlay.classList.remove('hidden');
    
    if (type === 'victory') {
        trophy.classList.remove('hidden');
        document.getElementById('victoryDetail').innerText = detail;
        setTimeout(() => trophy.classList.add('scale-100'), 10);
    } else {
        milestone.classList.remove('hidden');
        document.getElementById('milestoneDetail').innerText = detail;
    }

    // Basic Confetti
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    let particles = Array.from({ length: 150 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        size: Math.random() * 8 + 4,
        speed: Math.random() * 5 + 2
    }));

    function draw() {
        ctx.clearRect(0,0, canvas.width, canvas.height);
        particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            p.y += p.speed;
            if (p.y > canvas.height) p.y = -10;
        });
        if (overlay.classList.contains('hidden')) return;
        requestAnimationFrame(draw);
    }
    draw();

    setTimeout(() => {
        overlay.classList.add('hidden');
        trophy.classList.add('hidden', 'scale-0');
        milestone.classList.add('hidden');
    }, 5000);
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
        const isT2Win = t2.score >= match.target;
        let winMsg = isT2Win ? `${t2.name} Wins!` : t2.score === match.target - 1 ? "Match Tied!" : `${t1.name} Wins!`;
        
        document.getElementById('status').innerText = winMsg;
        document.getElementById('newMatchBtn').classList.remove('hidden');
        
        triggerCricketCelebration('victory', winMsg);

        if (currentUser) {
            // Create a deep copy of players to ensure data persistence
            const cleanPlayers = (players) => players.map(p => ({
                name: p.name, type: p.type, runs: p.runs, balls: p.balls, 
                wickets: p.wickets, runsConceded: p.runsConceded, ballsBowled: p.ballsBowled, isOut: p.isOut
            }));

            const historyObj = { 
                id: Date.now(),
                result: winMsg, 
                teamA: { name: t1.name, score: t1.score, wickets: t1.wickets, balls: t1.balls, players: cleanPlayers(t1.players) },
                teamB: { name: t2.name, score: t2.score, wickets: t2.wickets, balls: t2.balls, players: cleanPlayers(t2.players) },
                maxOvers: Number(match.maxOvers),
                setup: {
                    pA: document.getElementById('teamAPlayers').value,
                    pB: document.getElementById('teamBPlayers').value
                }
            };
            
            try {
                await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(historyObj)
                });
                await syncCricketHistory();
            } catch (e) {
                console.error("Failed to save match history", e);
            }
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
    setLoading(true, "Saving Match Setup");
    try {
        await fetch(`/api/main?route=cricket_setup&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(setup)
        });
        alert("Match setup saved to cloud!");
    } finally {
        setLoading(false);
    }
}

async function loadCricketSetup() {
    if (!currentUser) return;
    const res = await fetch(`/api/main?route=cricket_setup&userId=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    if (data && data.length > 0) {
        // Since API sorts by timestamp: -1, index 0 is the most recent setup
        const latest = data[0];
        document.getElementById('teamAName').value = latest.tA || '';
        document.getElementById('teamBName').value = latest.tB || '';
        document.getElementById('cricketOversSelect').value = latest.overs || '1';
        document.getElementById('teamAPlayers').value = latest.pA || '';
        document.getElementById('teamBPlayers').value = latest.pB || '';
    }
}

function toggleCricketView(view) {
    const setup = document.getElementById('cricketSetup');
    const archives = document.getElementById('cricketArchives');
    const ground = document.getElementById('cricketGround');
    const leader = document.getElementById('cricketLeaderboard');
    
    const tabs = { setup: 'cricketSetupTab', history: 'cricketHistoryTab', leaderboard: 'cricketLeaderTab' };
    const pages = { setup: setup, history: archives, ground: ground, leaderboard: leader };

    Object.values(pages).forEach(p => p.classList.add('hidden'));
    Object.values(tabs).forEach(t => {
        const el = document.getElementById(t);
        if (el) el.className = "hover:bg-white/5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold transition text-gray-400";
    });

    if (view === 'setup') {
        setup.classList.remove('hidden');
        document.getElementById('cricketSetupTab').className = "bg-cyan-600/20 text-cyan-400 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold border border-cyan-500/30";
    } else if (view === 'history') {
        archives.classList.remove('hidden');
        document.getElementById('cricketHistoryTab').className = "bg-cyan-600/20 text-cyan-400 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold border border-cyan-500/30";
        syncCricketHistory();
    } else if (view === 'leaderboard') {
        leader.classList.remove('hidden');
        document.getElementById('cricketLeaderTab').className = "bg-cyan-600/20 text-cyan-400 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold border border-cyan-500/30";
        syncLeaderboard();
    }
}

async function syncLeaderboard() {
    const body = document.getElementById('leaderboardBody');
    body.innerHTML = '<tr><td colspan="5" class="p-10 text-center"><i class="fas fa-spinner fa-spin text-xl text-yellow-400"></i></td></tr>';
    
    try {
        const res = await fetch('/api/main?route=cricket_leaderboard');
        const data = await res.json();
        
        if (data.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-gray-500">The Hall of Fame is empty. Step up, Legend!</td></tr>';
            return;
        }

        body.innerHTML = data.map((u, i) => `
            <tr class="border-b border-white/5 hover:bg-white/5 transition">
                <td class="p-4 font-black text-gray-500">${i + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-600 flex items-center justify-center font-bold text-black text-xs">${u.name[0]}</div>
                        <span class="font-bold text-white">${u.name}</span>
                    </div>
                </td>
                <td class="p-4 text-center font-bold text-green-400">${u.wins}</td>
                <td class="p-4 text-center font-mono text-gray-400">${u.avgRR.toFixed(2)}</td>
                <td class="p-4 text-center font-black text-yellow-400">${u.highScore}</td>
            </tr>
        `).join('');
    } catch (e) {
        body.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-red-500">Failed to load legends.</td></tr>';
    }
}

function resetCricketMatch() {
    document.getElementById('cricketGround').classList.add('hidden');
    document.getElementById('cricketSetup').classList.remove('hidden');
    document.getElementById('newMatchBtn').classList.add('hidden');
    document.getElementById('status').innerText = "Wait for Bowler...";
    toggleCricketView('setup');
}

let cricketHistoryData = [];
let selectedMatches = new Set();

function toggleMatchSelection(id) {
    id = isNaN(id) ? id : Number(id);
    if (selectedMatches.has(id)) selectedMatches.delete(id);
    else selectedMatches.add(id);
    renderCricketHistoryList();
}

function selectAllMatches(checked) {
    if (checked) {
        cricketHistoryData.forEach(m => selectedMatches.add(isNaN(m.id) ? m.id : Number(m.id)));
    } else {
        selectedMatches.clear();
    }
    renderCricketHistoryList();
}

async function deleteSelectedMatches() {
    if (selectedMatches.size === 0) return;
    if (!confirm(`Permanently delete ${selectedMatches.size} match records?`)) return;

    setLoading(true, "Purging Match Records");
    try {
        const ids = Array.from(selectedMatches);
        await Promise.all(ids.map(id => 
            fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, { method: 'DELETE' })
        ));
        
        selectedMatches.clear();
        await syncCricketHistory();
        showToast("Records successfully purged.", "warning");
    } catch (e) {
        showToast("Deletion error.", "error");
    } finally {
        setLoading(false);
    }
}

async function deleteCricketMatch(id) {
    if (!confirm("Delete this match record from history?")) return;
    setLoading(true, "Deleting Match Record");
    try {
        const res = await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await syncCricketHistory();
            showToast("Match record deleted.", "warning");
        } else {
            throw new Error("Failed to delete record");
        }
    } catch (e) {
        showBetterError(e.message);
    } finally {
        setLoading(false);
    }
}

async function syncCricketHistory() {
    if (!currentUser) return;
    const list = document.getElementById('matchHistoryList');
    list.innerHTML = '<div class="col-span-full text-center py-10"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';
    
    try {
        const res = await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        
        if (Array.isArray(data)) {
            cricketHistoryData = data;
            renderCricketHistoryList();
        } else {
            throw new Error(data.error || "Invalid data format");
        }
    } catch (e) {
        console.error("Cricket Sync Error:", e);
        list.innerHTML = `<div class="col-span-full text-center py-20 text-red-500">Failed to load history: ${e.message}</div>`;
    }
}

function renderCricketHistoryList() {
    const list = document.getElementById('matchHistoryList');
    const bulkBar = document.getElementById('cricketBulkActions');
    const countEl = document.getElementById('cricketSelectionCount');
    const selectAllEl = document.getElementById('selectAllCricket');

    if (cricketHistoryData.length === 0) {
        list.innerHTML = '<div class="col-span-full text-center py-20 text-gray-500">No matches found in archives.</div>';
        bulkBar.classList.add('hidden');
        selectedMatches.clear();
        return;
    }

    bulkBar.classList.remove('hidden');
    countEl.innerText = `${selectedMatches.size} selected`;
    selectAllEl.checked = (selectedMatches.size === cricketHistoryData.length && cricketHistoryData.length > 0);

    list.innerHTML = cricketHistoryData.map((m, idx) => {
        const tA = m.teamA || {};
        const tB = m.teamB || {};
        const tAName = tA.name || 'Unknown';
        const tBName = tB.name || 'Unknown';
        const id = isNaN(m.id) ? m.id : Number(m.id);
        const isSelected = selectedMatches.has(id);
        
        const borderClass = (m.result && tBName !== 'Unknown' && m.result.includes(tBName)) ? 'border-purple-500' : 'border-orange-500';
        
        return `
            <div onclick="toggleMatchSelection('${m.id}')" class="glass p-5 border-l-4 ${borderClass} group hover:scale-[1.02] transition-transform relative cursor-pointer ${isSelected ? 'ring-2 ring-orange-500/50' : ''}">
                <div class="absolute top-2 left-2 flex items-center gap-2">
                    <input type="checkbox" class="accent-orange-500 w-3.5 h-3.5" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleMatchSelection('${m.id}')">
                </div>
                <div class="absolute top-2 right-2">
                    <button onclick="event.stopPropagation(); deleteCricketMatch('${m.id}')" class="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1" title="Delete Match">
                        <i class="fas fa-trash-alt text-[10px]"></i>
                    </button>
                </div>
                <div class="flex justify-between items-start mb-4 pl-6 pr-6">
                    <span class="text-[10px] text-gray-500">${new Date(m.timestamp || m.id).toLocaleString()}</span>
                    <span class="text-[10px] font-bold text-cyan-400 uppercase tracking-tighter">${m.maxOvers || '?'} Overs</span>
                </div>
                <div class="flex justify-between items-center mb-4">
                    <div class="text-left">
                        <p class="text-xs font-bold">${tAName}</p>
                        <p class="text-xl font-black">${tA.score ?? 0}/${tA.wickets ?? 0}</p>
                    </div>
                    <div class="text-gray-600 font-bold">VS</div>
                    <div class="text-right">
                        <p class="text-xs font-bold">${tBName}</p>
                        <p class="text-xl font-black">${tB.score ?? 0}/${tB.wickets ?? 0}</p>
                    </div>
                </div>
                <div class="text-center p-2 bg-black/20 rounded-lg text-xs font-bold text-gray-300 mb-4">
                    ${m.result || 'Match Completed'}
                </div>
                <button onclick="event.stopPropagation(); viewMatchDetail(${idx})" class="w-full py-2 text-xs bg-white/5 rounded-lg hover:bg-white/10 transition">Deep Dive</button>
            </div>
        `;
    }).join('');
}

function viewMatchDetail(idx) {
    const m = cricketHistoryData[idx];
    if (!m) return;
    const tA = m.teamA || { name: 'Unknown', players: [] };
    const tB = m.teamB || { name: 'Unknown', players: [] };

    document.getElementById('detailMatchTitle').innerText = `${tA.name || 'Unknown'} vs ${tB.name || 'Unknown'}`;
    const content = document.getElementById('matchDetailContent');
    
    const renderTeamScorecard = (team) => `
        <div class="bg-white/5 p-4 rounded-xl border border-white/5">
            <h4 class="font-bold text-cyan-400 border-b border-white/10 mb-3 pb-1">${team.name || 'Unknown'} Scorecard</h4>
            <div class="space-y-2">
                ${(team.players || []).length > 0 ? (team.players || []).filter(p => p.balls > 0 || !p.isOut).map(p => `
                    <div class="flex justify-between text-xs">
                        <span class="${p.isOut ? 'text-gray-500' : 'text-white'}">${p.name || 'Player'} ${p.isOut ? '(out)' : ''}</span>
                        <span class="font-mono">${p.runs || 0}(${p.balls || 0}) SR: ${(((p.runs || 0)/((p.balls || 1) || 1))*100).toFixed(1)}</span>
                    </div>
                `).join('') : '<p class="text-[10px] text-gray-500 italic">No player data available</p>'}
            </div>
            <div class="mt-4 pt-3 border-t border-white/5">
                <p class="text-[10px] text-gray-500 uppercase font-bold mb-2">Bowling Performance</p>
                ${(team.players || []).length > 0 ? (team.players || []).filter(p => p.ballsBowled > 0).map(p => `
                    <div class="flex justify-between text-xs text-gray-400">
                        <span>${p.name || 'Player'}</span>
                        <span class="font-mono">${p.wickets || 0}-${p.runsConceded || 0} (${Math.floor((p.ballsBowled || 0)/6)}.${(p.ballsBowled || 0)%6})</span>
                    </div>
                `).join('') : '<p class="text-[10px] text-gray-500 italic">No bowling data</p>'}
            </div>
        </div>
    `;

    content.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${renderTeamScorecard(tA)}
            ${renderTeamScorecard(tB)}
        </div>
        <div class="bg-cyan-500/10 p-4 rounded-xl border border-cyan-500/20 text-center">
            <p class="text-sm font-bold text-cyan-400">${m.result || 'No result data'}</p>
        </div>
    `;

    const rematchBtn = document.getElementById('rematchBtn');
    rematchBtn.onclick = () => {
        closeMatchDetail();
        document.getElementById('teamAName').value = tA.name;
        document.getElementById('teamBName').value = tB.name;
        document.getElementById('cricketOversSelect').value = m.maxOvers;
        document.getElementById('teamAPlayers').value = m.setup?.pA || '';
        document.getElementById('teamBPlayers').value = m.setup?.pB || '';
        toggleCricketView('setup');
        startMatch();
    };

    document.getElementById('matchDetailModal').classList.remove('hidden');
}

function closeMatchDetail() {
    document.getElementById('matchDetailModal').classList.add('hidden');
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
    const key = aiConfig.razorpayKey || "rzp_live_RuDJUlLd5GCYqf";
    
    if (!amount || amount < 1) return alert("Please enter a valid amount.");

    const options = {
        "key": key, 
        "amount": amount * 100,
        "currency": "INR",
        "name": "sOuLViSiON Support",
        "description": remark || "Support for sOuLViSiON Development",
        "prefill": {
            "name": currentUser?.name || "",
            "email": currentUser?.email || ""
        },
        "handler": async function (response){
            setLoading(true, "Verifying Payment");
            try {
                await fetch('/api/main?route=feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name: currentUser?.name || 'Anonymous', 
                        amount, 
                        remark,
                        paymentId: response.razorpay_payment_id,
                        timestamp: Date.now()
                    })
                });
                showToast("Thank you for your support! Vision fueled.", "success", 5000);
                loadFeedbacks();
            } catch (e) {
                alert("Payment successful, but failed to update wall. We have recorded your contribution internally.");
            } finally {
                setLoading(false);
            }
        },
        "theme": { "color": "#06b6d4" }
    };
    
    try {
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response){
            alert("Payment Failed: " + response.error.description + ". Note: Ensure your domain is whitelisted in Razorpay Dashboard.");
        });
        rzp.open();
    } catch (e) {
        alert("Razorpay failed to initialize. Check your API key and domain whitelisting in Razorpay Settings.");
    }
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
                <p class="text-sm text-gray-300 italic">"${f.remark || 'Supporting sOuLViSiON development!'}"</p>
            </div>
        `).join('');
    } else {
        wall.innerHTML = `
            <div class="text-center py-20 opacity-50">
                <i class="fas fa-mug-hot text-4xl mb-4"></i>
                <p>No supporters yet. Be the first!</p>
            </div>
        `;
    }
}

// --- CONTACT FORM LOGIC ---
let contactFiles = [];

function handleContactFiles(input) {
    const files = Array.from(input.files);
    files.forEach(file => {
        // Size Check: Vercel serverless has a body limit. Let's suggest staying under 4MB total.
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            contactFiles.push({
                name: file.name,
                type: file.type,
                content: base64
            });
            renderContactFilePreview();
        };
        reader.readAsDataURL(file);
    });
    input.value = '';
}

function removeContactFile(idx) {
    contactFiles.splice(idx, 1);
    renderContactFilePreview();
}

function renderContactFilePreview() {
    const container = document.getElementById('contactFilePreview');
    const countEl = document.getElementById('contactFileCount');
    container.innerHTML = '';
    
    if (contactFiles.length === 0) {
        countEl.innerText = "No files selected";
        return;
    }

    countEl.innerText = `${contactFiles.length} file${contactFiles.length > 1 ? 's' : ''} prepared`;

    contactFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = "bg-white/5 border border-white/10 px-2 py-1 rounded-lg flex items-center gap-2 text-[10px] text-gray-300 animate-fadeIn";
        chip.innerHTML = `
            <i class="fas fa-file-alt text-cyan-400"></i>
            <span class="truncate max-w-[80px]">${file.name}</span>
            <button type="button" onclick="removeContactFile(${idx})" class="hover:text-red-500 transition"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(chip);
    });
}

async function handleContact(e) {
    e.preventDefault();
    const name = document.getElementById('contactName').value;
    const email = document.getElementById('contactEmail').value;
    const message = document.getElementById('contactMessage').value;
    const status = document.getElementById('contactStatus');

    setLoading(true, "Sending Message");
    try {
        const res = await fetch('/api/main?route=messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name, 
                email, 
                message, 
                attachments: contactFiles,
                timestamp: Date.now() 
            })
        });

        if (res.ok) {
            status.innerText = "Message sent successfully! We'll get back to you soon.";
            status.className = "mt-4 text-center text-xs text-green-400 block";
            document.getElementById('contactForm').reset();
            contactFiles = [];
            renderContactFilePreview();
        } else {
            const errData = await res.json();
            throw new Error(errData.error || "Failed to send message");
        }
    } catch (err) {
        status.innerText = "Error: " + err.message;
        status.className = "mt-4 text-center text-xs text-red-400 block";
    } finally {
        setLoading(false);
        setTimeout(() => { if(status) status.classList.add('hidden'); }, 5000);
    }
}

// --- ADMIN ---
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('soul_theme', theme);
    if (currentUser) {
        currentUser.theme = theme;
        localStorage.setItem('soulUser', JSON.stringify(currentUser));
    }
    // Re-render components that rely on theme-conditional classes
    if (document.getElementById('notes').classList.contains('active')) renderNotes();
}

async function saveAdminConfig() {
    const keys = document.getElementById('apiKeys').value.split(',').map(k => k.trim());
    const models = JSON.parse(document.getElementById('modelList').value);
    const adminEmail = currentUser ? currentUser.email : '';
    
    setLoading(true, "Applying Admin Settings");
    try {
        const res = await fetch(`/api/main?route=admin_config&adminEmail=${encodeURIComponent(adminEmail)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ai_settings', keys, models }) // Removed unifiedModel
        });
        if(res.ok) { alert("Config Updated!"); loadConfig(); }
    } finally {
        setLoading(false);
    }
}

// Admin User Management
let adminUsersCache = [];
async function loadAdminUsers() {
    if (!currentUser || !currentUser.isAdmin) return;
    const adminEmail = currentUser.email;
    setLoading(true, "Fetching Users");
    try {
        const res = await fetch(`/api/main?route=users&adminEmail=${encodeURIComponent(adminEmail)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            adminUsersCache = data;
            document.getElementById('statUsers').innerText = data.length;
            renderAdminUsers(data);
        }
    } finally {
        setLoading(false);
    }
}

function renderAdminUsers(users) {
    const list = document.getElementById('adminUserList');
    if (!users.length) {
        list.innerHTML = '<p class="text-xs text-gray-500 text-center py-10 italic">No members found in the sOuLViSiON family core.</p>';
        return;
    }
    list.innerHTML = users.map(user => {
        let joinedDate = "Legacy Member";
        if (user.joinedAt) {
            joinedDate = new Date(user.joinedAt).toLocaleDateString();
        } else if (user._id && typeof user._id === 'string' && user._id.length === 24) {
            joinedDate = new Date(parseInt(user._id.substring(0, 8), 16) * 1000).toLocaleDateString();
        }

        const isSelf = user.email === currentUser.email;

        return `
            <div class="bg-white/5 p-3 md:p-4 rounded-xl flex justify-between items-center border border-white/5 group hover:bg-white/10 hover:border-red-500/20 transition-all duration-300">
                <div class="overflow-hidden flex items-center gap-3 md:gap-4">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-red-500 font-black text-sm shrink-0 border border-white/5 shadow-inner">
                        ${user.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="overflow-hidden">
                        <p class="text-[13px] font-black text-white truncate flex items-center gap-2">
                            ${user.name}
                            ${isSelf ? '<span class="text-[8px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/20">YOU</span>' : ''}
                        </p>
                        <p class="text-[10px] text-gray-500 truncate font-mono">${user.email}</p>
                        <div class="flex flex-wrap items-center gap-2 mt-1.5">
                            <span class="text-[8px] text-gray-600 font-black uppercase tracking-tighter">EST: ${joinedDate}</span>
                            ${user.isAdmin ? '<span class="text-[7px] font-black bg-red-600/10 text-red-500 px-1.5 py-0.5 rounded border border-red-500/20 uppercase">Core Admin</span>' : ''}
                            ${user.authSource === 'google' ? '<i class="fab fa-google text-[9px] text-gray-500" title="Google Auth"></i>' : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center">
                    ${!isSelf ? `
                        <button onclick="adminDeleteUser('${user.email}')" 
                                class="w-10 h-10 flex items-center justify-center rounded-xl bg-red-600/5 text-gray-600 hover:bg-red-600 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300 border border-transparent hover:border-red-500 group/term" 
                                title="Terminate Member Access">
                            <i class="fas fa-user-xmark text-sm group-hover/term:animate-pulse"></i>
                        </button>
                    ` : `
                        <div class="w-10 h-10 flex items-center justify-center text-gray-700 opacity-20">
                            <i class="fas fa-shield-halved text-sm"></i>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function filterAdminUsers(query) {
    const q = query.toLowerCase();
    const filtered = adminUsersCache.filter(u => 
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    renderAdminUsers(filtered);
}

let visitorMap = null;
let heatmapLayer = null;

async function loadVisitorMap() {
    if (!currentUser || !currentUser.isAdmin) return;
    
    const mapEl = document.getElementById('visitorMap');
    if (!mapEl) return;

    // Check if map container has dimensions before initializing
    // If not, retry after a short delay
    if (mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) {
        setTimeout(loadVisitorMap, 100);
        return;
    }

    if (!visitorMap) {
        visitorMap = L.map('visitorMap', {
            zoomControl: false,
            attributionControl: false
        }).setView([20, 0], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(visitorMap);
    }

    // Ensure map is correctly sized when its container becomes visible
    // This is crucial for Leaflet in SPAs where map container visibility changes
    if (visitorMap) {
        visitorMap.invalidateSize(true); // true to animate
    }

    try {
        const res = await fetch(`/api/main?route=users&adminEmail=${encodeURIComponent(currentUser.email)}`);
        const users = await res.json();
        
        // 1. Clear existing layers
        visitorMap.eachLayer((layer) => {
            if (layer instanceof L.CircleMarker || (heatmapLayer && layer === heatmapLayer)) {
                visitorMap.removeLayer(layer);
            }
        });
        if (heatmapLayer) {
            visitorMap.removeLayer(heatmapLayer);
            heatmapLayer = null;
        }

        const heatData = [];
        const markers = [];
        
        users.forEach(user => {
            const lat = parseFloat(user.lastGeo?.lat);
            const lon = parseFloat(user.lastGeo?.lon);

            if (!isNaN(lat) && !isNaN(lon)) {
                // Add to Heatmap data
                heatData.push([lat, lon, 1]); 

                // Add Marker
                const marker = L.circleMarker([lat, lon], {
                    radius: 6,
                    fillColor: "#06b6d4",
                    color: "#fff",
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.8,
                    className: 'visitor-marker-pulse'
                }).addTo(visitorMap);

                const time = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : 'Legacy';
                marker.bindPopup(`
                    <div class="p-1 min-w-[140px]">
                        <p class="text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-1">Core Member</p>
                        <p class="text-sm font-bold text-white mb-1">${user.name}</p>
                        <p class="text-[9px] text-gray-400 uppercase">${user.lastGeo.city || 'Unknown'}, ${user.lastGeo.country || ''}</p>
                        <p class="text-[8px] text-gray-500 mt-2">Established: ${time}</p>
                    </div>
                `, { className: 'soul-map-popup' });
                
                markers.push(marker.getLatLng());
            }
        });

        // 2. Add Heatmap Layer for density visualization
        if (heatData.length > 0 && typeof L.heatLayer === 'function') {
            // Reinitialize heatmap layer after ensuring map has dimensions
            heatmapLayer = L.heatLayer(heatData, {
                radius: 25,
                blur: 15,
                maxZoom: 10,
                gradient: { 0.4: 'blue', 0.65: 'cyan', 1: 'lime' }
            }).addTo(visitorMap);
        }

        // 3. Render Rank Statistics
        renderVisitorStats(users);

        // 4. Auto-zoom to audience
        if (markers.length > 1) {
            visitorMap.fitBounds(L.latLngBounds(markers), { padding: [40, 40] });
        } else if (markers.length === 1) {
            visitorMap.setView(markers[0], 5); // Zoom in on single marker
        }
    } catch (e) {
        console.error("Map Load Error:", e);
    }
}

function renderVisitorStats(users) {
    const statsList = document.getElementById('visitorStatsList');
    if (!statsList) return;

    const countryMap = {};
    users.forEach(u => {
        const country = u.lastGeo?.country || 'Unknown';
        countryMap[country] = (countryMap[country] || 0) + 1;
    });

    const sorted = Object.entries(countryMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    if (sorted.length === 0) {
        statsList.innerHTML = '<p class="text-[10px] text-gray-600 italic">No region data detected.</p>';
        return;
    }

    const total = users.length;
    statsList.innerHTML = sorted.map(([country, count]) => {
        const percent = Math.round((count / total) * 100);
        return `
            <div class="group">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[11px] font-bold text-gray-300 uppercase">${country}</span>
                    <span class="text-[10px] font-black text-cyan-400">${count} (${percent}%)</span>
                </div>
                <div class="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <div class="h-full bg-cyan-600 transition-all duration-1000" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

async function sendAnnouncement() {
    const input = document.getElementById('announcementInput');
    const duration = document.getElementById('announcementDuration').value;
    const text = input.value.trim();
    if (!text) return;

    setLoading(true, "Broadcasting Announcement");
    try {
        const res = await fetch(`/api/main?route=announcement&adminEmail=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text, 
                duration: parseInt(duration),
                timestamp: Date.now()
            })
        });
        if (res.ok) {
            showToast("Broadcast active.", "success");
            input.value = '';
            checkAnnouncement();
        }
    } finally {
        setLoading(false);
    }
}

async function deleteAnnouncement() {
    if (!confirm("Stop this broadcast and remove it for all users?")) return;
    setLoading(true, "Removing Broadcast");
    try {
        await fetch(`/api/main?route=announcement&adminEmail=${encodeURIComponent(currentUser.email)}`, {
            method: 'DELETE'
        });
        showToast("Broadcast terminated.", "warning");
        // Clear inputs
        document.getElementById('announcementInput').value = '';
        checkAnnouncement();
    } finally {
        setLoading(false);
    }
}

function editAnnouncement() {
    const activeText = document.getElementById('activeAnnounceText').innerText;
    if (activeText) {
        document.getElementById('announcementInput').value = activeText;
        document.getElementById('announcementInput').focus();
        showToast("Announcement loaded into editor.", "info");
    }
}

async function checkAnnouncement() {
    try {
        const res = await fetch('/api/main?route=announcement');
        const data = await res.json();
        const banner = document.getElementById('announcementBanner');
        const text = document.getElementById('announcementText');
        const adminInfo = document.getElementById('activeAnnouncementInfo');
        const adminText = document.getElementById('activeAnnounceText');

        if (data && data.text) {
            // Update admin UI if visible
            if (adminInfo) {
                adminInfo.classList.remove('hidden');
                adminText.innerText = data.text;
            }
            
            const dismissed = localStorage.getItem('soul_dismissed_announcement');
            if (dismissed === data.timestamp.toString()) {
                banner.classList.add('hidden');
                return;
            }
            text.innerText = data.text;
            banner.classList.remove('hidden');
            banner.dataset.timestamp = data.timestamp;
        } else {
            banner.classList.add('hidden');
            if (adminInfo) adminInfo.classList.add('hidden');
        }
    } catch (e) {
        console.warn("Announcement check failed", e);
    }
}

function dismissAnnouncement() {
    const banner = document.getElementById('announcementBanner');
    if (banner.dataset.timestamp) {
        localStorage.setItem('soul_dismissed_announcement', banner.dataset.timestamp);
    }
    banner.classList.add('hidden');
}

async function adminDeleteUser(email) {
    if (email === currentUser.email) return alert("You cannot delete your own account.");
    if (!confirm(`Permanently delete account for ${email}? This will remove all their data.`)) return;
    
    setLoading(true, "Deleting User Data");
    try {
        const res = await fetch(`/api/main?route=users&adminEmail=${encodeURIComponent(currentUser.email)}&email=${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            alert("User deleted successfully.");
            loadAdminUsers();
        } else {
            const data = await res.json();
            alert("Error: " + (data.error || "Failed to delete user"));
        }
    } finally {
        setLoading(false);
    }
}

// Forgot Password Logic
function showForgotPassword() {
    showPage('forgotPass');
    document.getElementById('forgotStep1').classList.remove('hidden');
    document.getElementById('forgotStep2').classList.add('hidden');
}

async function requestResetOTP() {
    const email = document.getElementById('resetEmail').value.trim();
    if (!email) return alert("Enter your email.");
    
    setLoading(true, "Sending Verification Code");
    try {
        const res = await fetch('/api/main?route=forgot_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            alert("A 6-digit verification code has been sent to your email.");
            document.getElementById('forgotStep1').classList.add('hidden');
            document.getElementById('forgotStep2').classList.remove('hidden');
        } else {
            throw new Error(data.error || "Failed to send code.");
        }
    } catch (e) {
        showBetterError(e.message);
    } finally {
        setLoading(false);
    }
}

async function verifyAndResetPassword() {
    const email = document.getElementById('resetEmail').value.trim();
    const otp = document.getElementById('resetOTP').value.trim();
    const newPass = document.getElementById('resetNewPass').value.trim();
    
    if (!otp || otp.length !== 6) return alert("Enter valid 6-digit code.");
    if (!newPass || newPass.length < 6) return alert("Password must be at least 6 characters.");

    setLoading(true, "Updating Password");
    try {
        const res = await fetch('/api/main?route=forgot_password', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, newPassword: newPass })
        });
        const data = await res.json();
        if (res.ok) {
            alert("Password reset successful! You can now login with your new password.");
            showPage('login');
        } else {
            throw new Error(data.error || "Reset failed.");
        }
    } catch (e) {
        showBetterError(e.message);
    } finally {
        setLoading(false);
    }
}

// --- GOOGLE LOGIN ---
function handleGoogleCredentialResponse(response) {
    setLoading(true, "Authenticating with Google");
    fetch(`/api/main?route=auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            mode: 'google', 
            credential: response.credential 
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        currentUser = data;
        localStorage.setItem('soulUser', JSON.stringify(currentUser));
        updateAuthUI();
        syncAllData();
        showPage('home');
    })
    .catch(err => alert(err.message))
    .finally(() => setLoading(false));
}

function initGoogleLogin() {
    if (typeof google === 'undefined') {
        setTimeout(initGoogleLogin, 500);
        return;
    }
    google.accounts.id.initialize({
        client_id: "117626690354-1d85pk16ojvju3o3oc5e6gpcmtfno1kj.apps.googleusercontent.com",
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton(
        document.getElementById("googleBtnContainer"),
        { theme: "outline", size: "large", width: "320", shape: "rectangular" }
    );
}

// --- CUSTOM CURSOR LOGIC ---
function initCustomCursor() {
    const cursor = document.getElementById('custom-cursor');
    if (!cursor) return;
    document.body.classList.add('cursor-active');

    let mouseX = 0, mouseY = 0;
    let isHidden = true;

    // Movement using top/left for cleaner combined scale transforms in CSS
    const updateCursorPosition = () => {
        cursor.style.left = `${mouseX}px`;
        cursor.style.top = `${mouseY}px`;
        requestAnimationFrame(updateCursorPosition);
    };
    requestAnimationFrame(updateCursorPosition);

    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        if (isHidden) {
            cursor.style.opacity = '1';
            isHidden = false;
        }
    });

    document.addEventListener('mouseleave', () => {
        cursor.style.opacity = '0';
        isHidden = true;
    });

    document.addEventListener('mouseenter', () => {
        cursor.style.opacity = '1';
        isHidden = false;
    });

    const interactiveSelectors = 'a, button, input[type="submit"], input[type="button"], [role="button"], .cursor-pointer, [onclick], .note-checkbox, select';
    const textSelectors = 'input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="date"], textarea, [contenteditable="true"]';

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.closest(interactiveSelectors)) {
            cursor.classList.add('active');
        } else if (target.closest(textSelectors)) {
            cursor.classList.add('text-mode');
        }
    });

    document.addEventListener('mouseout', (e) => {
        cursor.classList.remove('active');
        cursor.classList.remove('text-mode');
    });

    document.addEventListener('mousedown', () => {
        cursor.classList.add('clicking');
    });

    document.addEventListener('mouseup', () => {
        cursor.classList.remove('clicking');
    });
    
    // Ensure cursor stays visible when dragging
    document.addEventListener('dragstart', (e) => {
        cursor.style.opacity = '0.5';
    });
    document.addEventListener('dragend', (e) => {
        cursor.style.opacity = '1';
    });
}

// --- sOuLNOTES NEW FEATURES ---

async function togglePin(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (!note) return;
    
    note.isPinned = !note.isPinned;
    renderNotes();
    
    await fetch(`/api/main?route=notes&id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: note.isPinned })
    });
}

function lockCurrentNote() {
    const id = document.getElementById('editNoteId').value;
    const note = notes.find(n => n.id == id);
    if (!note) return;
    
    const code = prompt("Set a secret access code for this note (Empty to unlock):");
    note.lockCode = code || null;
    saveEditedNote();
    showToast(code ? "Note Locked" : "Note Unlocked", "info");
}

// --- WELCOME TOUR LOGIC ---
let currentTourStep = 0;
let activeTourSteps = [];

const desktopTourSteps = [
    {
        selector: 'nav .text-cyan-400.cursor-pointer',
        text: "Hi! I'm sOuL-ie, your guide. Welcome to sOuLViSiON - your new digital sanctuary!",
        pos: { top: '20%', left: '50%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="notes"]',
        text: "In sOuLNOTES, you can write markdown notes and lock them with secret codes.",
        pos: { top: '40%', left: '30%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="ai"]',
        text: "Meet sOuLAI. Powerful models ready to assist your creative process.",
        pos: { top: '40%', left: '50%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="play"]',
        text: "Relax with sOuLPLAY. Stream from YouTube or play local files with vinyl vibes.",
        pos: { top: '40%', left: '70%' }
    },
    {
        selector: '#userProfile',
        text: "Keep track of your stats and system health here in the Dashboard.",
        pos: { top: '15%', left: '80%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="support"]',
        text: "Love sOuLViSiON? Support our journey to stay free and private for everyone!",
        pos: { top: '80%', left: '50%' }
    }
];

const mobileTourSteps = [
    {
        selector: 'nav h1',
        text: "Welcome to sOuLViSiON Mobile! I'm sOuL-ie, let me show you around.",
        pos: { top: '20%', left: '50%' }
    },
    {
        selector: 'button[onclick="toggleSidebar()"]',
        text: "Tap the Menu to access all your tools like Notes, AI, and Music.",
        pos: { top: '10%', left: '10%' }
    },
    {
        selector: '#aiWidget',
        text: "This bubble is your AI assistant. Tap it for quick help on any page!",
        pos: { top: '85%', left: '85%' }
    },
    {
        selector: '#userProfile',
        text: "Check your system health and manage your profile here.",
        pos: { top: '10%', left: '85%' }
    }
];

function startWelcomeTour() {
    // Force wait if loader is currently active
    const loader = document.getElementById('globalLoader');
    if (loader && !loader.classList.contains('hidden')) {
        setTimeout(startWelcomeTour, 1000);
        return;
    }

    if (localStorage.getItem('soul_tour_done')) return;
    
    // Detect device for tour content
    activeTourSteps = window.innerWidth < 768 ? mobileTourSteps : desktopTourSteps;
    
    currentTourStep = 0;
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex'); 
    
    setTimeout(() => {
        document.getElementById('tourBackdrop').classList.add('opacity-100');
    }, 50);

    renderTourStep();
}

// --- Time & Calendar Modal Functions (Side Quest) ---
function setActiveTimeModalTab(tabId) {
    modalCurrentTab = tabId;
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.replace('bg-cyan-600', 'bg-white/5');
        btn.classList.replace('text-white', 'text-gray-400');
        btn.classList.replace('shadow-lg', 'shadow-none');
    });
    document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.add('active');
    document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.replace('bg-white/5', 'bg-cyan-600');
    document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.replace('text-gray-400', 'text-white');
    document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.add('shadow-lg', 'shadow-cyan-600/20');

    document.querySelectorAll('.modal-tab-content').forEach(content => content.classList.add('hidden'));
    document.getElementById(`modalTabContent-${tabId}`).classList.remove('hidden');

    // Special rendering/init for each tab
    if (tabId === 'stopwatch') renderModalStopwatch();
    if (tabId === 'timer') renderModalTimer();
    if (tabId === 'alarm') renderAlarms();
    if (tabId === 'world') renderWorldClocks();
    if (tabId === 'clocks') {
        setClockType(clockType); // Ensure proper clock UI based on current state
    }
}

// --- Modal Stopwatch Functions ---
function updateModalStopwatchDisplay() {
    const format = (s) => {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    document.getElementById('modalStopwatchDisplay').innerText = format(modalStopwatchTime);
}

function startModalStopwatch() {
    if (modalStopwatchInterval) return;

    document.getElementById('modalStopwatchStartBtn').classList.add('hidden');
    document.getElementById('modalStopwatchPauseBtn').classList.remove('hidden');

    modalStopwatchInterval = setInterval(() => {
        modalStopwatchTime++;
        updateModalStopwatchDisplay();
        localStorage.setItem('modalStopwatchTime', modalStopwatchTime);
    }, 1000);
}

function pauseModalStopwatch() {
    clearInterval(modalStopwatchInterval);
    modalStopwatchInterval = null;
    document.getElementById('modalStopwatchStartBtn').classList.remove('hidden');
    document.getElementById('modalStopwatchPauseBtn').classList.add('hidden');
}

function resetModalStopwatch() {
    pauseModalStopwatch();
    modalStopwatchTime = 0;
    updateModalStopwatchDisplay();
    localStorage.removeItem('modalStopwatchTime');
    showToast("Stopwatch reset.", "warning");
}

function renderModalStopwatch() {
    const savedTime = localStorage.getItem('modalStopwatchTime');
    if (savedTime !== null) {
        modalStopwatchTime = parseInt(savedTime);
    } else {
        modalStopwatchTime = 0;
    }
    updateModalStopwatchDisplay();
    // Ensure buttons are in correct state based on whether interval is active
    if (modalStopwatchInterval) {
        document.getElementById('modalStopwatchStartBtn').classList.add('hidden');
        document.getElementById('modalStopwatchPauseBtn').classList.remove('hidden');
    } else {
        document.getElementById('modalStopwatchStartBtn').classList.remove('hidden');
        document.getElementById('modalStopwatchPauseBtn').classList.add('hidden');
    }
}


// --- Modal Timer Functions ---
function updateModalTimerDuration(mins) {
    modalTimerTimeRemaining = parseInt(mins) * 60;
    updateModalTimerDisplay();
    localStorage.setItem('modalTimerDuration', mins);
}

function updateModalTimerDisplay() {
    const format = (s) => {
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    document.getElementById('modalTimerDisplay').innerText = format(modalTimerTimeRemaining);
}

function startModalTimer() {
    if (modalTimerInterval) return;
    
    document.getElementById('modalTimerStartBtn').classList.add('hidden');
    document.getElementById('modalTimerPauseBtn').classList.remove('hidden');

    modalTimerInterval = setInterval(async () => {
        if (modalTimerTimeRemaining <= 0) {
            clearInterval(modalTimerInterval);
            modalTimerInterval = null;
            modalTimerChime.play();
            if (window.navigator.vibrate) window.navigator.vibrate([200, 100, 200]);
            
            showToast("Timer complete!", "success");
            resetModalTimer();
            return;
        }
        modalTimerTimeRemaining--;
        updateModalTimerDisplay();
        localStorage.setItem('modalTimerTimeRemaining', modalTimerTimeRemaining);
    }, 1000);
}

function pauseModalTimer() {
    clearInterval(modalTimerInterval);
    modalTimerInterval = null;
    document.getElementById('modalTimerStartBtn').classList.remove('hidden');
    document.getElementById('modalTimerPauseBtn').classList.add('hidden');
}

function resetModalTimer() {
    pauseModalTimer();
    const initialMins = parseInt(localStorage.getItem('modalTimerDuration') || '25');
    modalTimerTimeRemaining = initialMins * 60;
    document.getElementById('modalTimerRange').value = initialMins;
    updateModalTimerDisplay();
    localStorage.removeItem('modalTimerTimeRemaining');
    showToast("Timer reset.", "warning");
}

function renderModalTimer() {
    const savedDuration = localStorage.getItem('modalTimerDuration');
    const savedTimeRemaining = localStorage.getItem('modalTimerTimeRemaining');

    if (savedDuration !== null) {
        document.getElementById('modalTimerRange').value = parseInt(savedDuration);
    } else {
        document.getElementById('modalTimerRange').value = 25; // Default
    }

    if (savedTimeRemaining !== null && parseInt(savedTimeRemaining) > 0) {
        modalTimerTimeRemaining = parseInt(savedTimeRemaining);
    } else {
        modalTimerTimeRemaining = parseInt(document.getElementById('modalTimerRange').value) * 60;
    }
    updateModalTimerDisplay();

    // Set button states
    if (modalTimerInterval) {
        document.getElementById('modalTimerStartBtn').classList.add('hidden');
        document.getElementById('modalTimerPauseBtn').classList.remove('hidden');
    } else {
        document.getElementById('modalTimerStartBtn').classList.remove('hidden');
        document.getElementById('modalTimerPauseBtn').classList.add('hidden');
    }
}

// --- Alarm Clock Functions ---
function loadAlarms() {
    const savedAlarms = localStorage.getItem('alarms');
    if (savedAlarms) {
        alarms = JSON.parse(savedAlarms);
        alarms.forEach(alarm => alarm.days = new Set(alarm.days)); // Re-hydrate Set
    } else {
        alarms = [];
    }
    renderAlarms();
    checkAlarms(); // Start checking alarms
}

function addAlarm() {
    const timeInput = document.getElementById('newAlarmTime');
    const labelInput = document.getElementById('newAlarmLabel');
    const dayCheckboxes = document.querySelectorAll('.modal-alarm-day:checked');

    const time = timeInput.value;
    const label = labelInput.value.trim() || 'Alarm';
    const days = new Set(Array.from(dayCheckboxes).map(cb => parseInt(cb.value)));

    if (!time) return showToast("Please set a time for the alarm.", "error");

    const newAlarm = {
        id: Date.now(),
        time, // "HH:MM"
        label,
        days, // Set of 0-6 (Sunday-Saturday)
        enabled: true,
        lastTriggered: null // To prevent immediate re-triggering if already past for the day
    };
    
    alarms.push(newAlarm);
    localStorage.setItem('alarms', JSON.stringify(alarms, (key, value) => {
        if (value instanceof Set) {
            return Array.from(value); // Convert Set to Array for JSON serialization
        }
        return value;
    }));
    renderAlarms();
    timeInput.value = '';
    labelInput.value = '';
    dayCheckboxes.forEach(cb => cb.checked = false);
    showToast(`Alarm "${label}" set for ${time}.`, "success");
}

function toggleAlarm(id) {
    const alarm = alarms.find(a => a.id === id);
    if (alarm) {
        alarm.enabled = !alarm.enabled;
        localStorage.setItem('alarms', JSON.stringify(alarms, (key, value) => {
            if (value instanceof Set) {
                return Array.from(value);
            }
            return value;
        }));
        renderAlarms();
        showToast(`Alarm "${alarm.label}" ${alarm.enabled ? 'enabled' : 'disabled'}.`, "info");
    }
}

function deleteAlarm(id) {
    if (!confirm("Delete this alarm?")) return;
    alarms = alarms.filter(a => a.id !== id);
    localStorage.setItem('alarms', JSON.stringify(alarms, (key, value) => {
        if (value instanceof Set) {
            return Array.from(value);
        }
        return value;
    }));
    renderAlarms();
    showToast("Alarm deleted.", "warning");
}

function renderAlarms() {
    const list = document.getElementById('alarmsList');
    if (!alarms.length) {
        list.innerHTML = '<p class="text-[10px] text-gray-500 italic text-center">No alarms set yet.</p>';
        return;
    }

    list.innerHTML = alarms.map(a => {
        const daysText = a.days.size === 0 ? 'Every Day' : Array.from(a.days).sort().map(d => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]).join(', ');
        return `
            <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 group hover:border-cyan-500/30 transition">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer" ${a.enabled ? 'checked' : ''} onclick="toggleAlarm(${a.id})">
                    <div class="w-10 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                </label>
                <div class="flex-grow">
                    <p class="text-lg font-bold ${a.enabled ? 'text-white' : 'text-gray-500 line-through'}">${a.time} - ${a.label}</p>
                    <p class="text-[10px] text-gray-400">${daysText}</p>
                </div>
                <button onclick="deleteAlarm(${a.id})" class="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
    }).join('');
}

let alarmCheckInterval = null;
function checkAlarms() {
    if (alarmCheckInterval) clearInterval(alarmCheckInterval);
    
    alarmCheckInterval = setInterval(() => {
        const now = new Date();
        const currentDay = now.getDay(); // 0 (Sunday) to 6 (Saturday)
        const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

        alarms.forEach(alarm => {
            if (alarm.enabled && alarm.time === currentTime) {
                // Check if it's the right day or if it's an "Every Day" alarm
                const isCorrectDay = alarm.days.size === 0 || alarm.days.has(currentDay);
                
                // Prevent multiple triggers within the same minute on the same day
                const lastTriggeredDate = alarm.lastTriggered ? new Date(alarm.lastTriggered).toDateString() : null;
                const nowTriggeredDate = now.toDateString();

                if (isCorrectDay && lastTriggeredDate !== nowTriggeredDate) {
                    // Trigger alarm
                    modalTimerChime.play(); // Reuse timer chime
                    if (window.navigator.vibrate) window.navigator.vibrate([200, 100, 200, 100, 500]);
                    alert(`Alarm: ${alarm.label} at ${alarm.time}`);
                    
                    alarm.lastTriggered = now.toISOString(); // Update last triggered time
                    localStorage.setItem('alarms', JSON.stringify(alarms, (key, value) => {
                        if (value instanceof Set) {
                            return Array.from(value);
                        }
                        return value;
                    }));
                    renderAlarms(); // Re-render to update lastTriggered (if displayed)
                }
            }
        });
    }, 1000); // Check every second
}


// --- World Clock Functions ---
// List of common timezones for the dropdown
const commonTimezones = [
    { value: 'America/New_York', name: 'New York (EST)' },
    { value: 'America/Los_Angeles', name: 'Los Angeles (PST)' },
    { value: 'Europe/London', name: 'London (GMT)' },
    { value: 'Europe/Paris', name: 'Paris (CET)' },
    { value: 'Asia/Dubai', name: 'Dubai (GST)' },
    { value: 'Asia/Kolkata', name: 'Kolkata (IST)' },
    { value: 'Asia/Shanghai', name: 'Shanghai (CST)' },
    { value: 'Asia/Tokyo', name: 'Tokyo (JST)' },
    { value: 'Australia/Sydney', name: 'Sydney (AEST)' },
    { value: 'Pacific/Auckland', name: 'Auckland (NZST)' },
    { value: 'Africa/Johannesburg', name: 'Johannesburg (SAST)' },
    { value: 'America/Sao_Paulo', name: 'Sao Paulo (BRT)' },
    { value: 'America/Toronto', name: 'Toronto (EST)' },
    { value: 'Europe/Berlin', name: 'Berlin (CET)' },
    { value: 'Europe/Moscow', name: 'Moscow (MSK)' },
    { value: 'Asia/Singapore', name: 'Singapore (SGT)' },
    { value: 'Asia/Hong_Kong', name: 'Hong Kong (HKT)' },
    { value: 'Europe/Madrid', name: 'Madrid (CET)' },
    { value: 'Asia/Seoul', name: 'Seoul (KST)' }
];

function populateTimezoneDropdown() {
    const select = document.getElementById('newWorldClockTimezone');
    if (!select) return;

    select.innerHTML = commonTimezones.map(tz => `<option value="${tz.value}">${tz.name}</option>`).join('');
}

function loadWorldClocks() {
    const savedWorldClocks = localStorage.getItem('worldClocks');
    if (savedWorldClocks) {
        worldClocks = JSON.parse(savedWorldClocks);
    } else {
        worldClocks = [];
    }
    renderWorldClocks();
}

function addWorldClock() {
    const select = document.getElementById('newWorldClockTimezone');
    const newTz = select.value;
    if (newTz && !worldClocks.includes(newTz)) {
        worldClocks.push(newTz);
        localStorage.setItem('worldClocks', JSON.stringify(worldClocks));
        renderWorldClocks();
        showToast(`${commonTimezones.find(t => t.value === newTz)?.name || newTz} added.`, "success");
    } else {
        showToast("Timezone already added or invalid.", "warning");
    }
}

function deleteWorldClock(timezone) {
    if (!confirm(`Remove ${commonTimezones.find(t => t.value === timezone)?.name || timezone}?`)) return;
    worldClocks = worldClocks.filter(tz => tz !== timezone);
    localStorage.setItem('worldClocks', JSON.stringify(worldClocks));
    renderWorldClocks();
    showToast("Timezone removed.", "warning");
}

function renderWorldClocks() {
    const list = document.getElementById('worldClocksList');
    if (!list) return;

    if (!worldClocks.length) {
        list.innerHTML = '<p class="text-[10px] text-gray-500 italic text-center">No world clocks added yet.</p>';
        return;
    }

    list.innerHTML = worldClocks.map(tz => {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' });
        const date = now.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
        const tzName = commonTimezones.find(t => t.value === tz)?.name || tz;
        return `
            <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 group hover:border-cyan-500/30 transition">
                <div class="flex-grow">
                    <p class="text-lg font-bold text-white">${time} <span class="text-sm text-gray-400">(${date})</span></p>
                    <p class="text-[10px] text-gray-400">${tzName}</p>
                </div>
                <button onclick="deleteWorldClock('${tz}')" class="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
    }).join('');
}


// --- Calendar Events Functions ---
function selectCalendarDate(dateString) {
    // Parse the YYYY-MM-DD string as a local date to avoid timezone issues.
    // Date constructor with (year, monthIndex, day) creates a local date.
    const [year, month, day] = dateString.split('-').map(Number);
    selectedCalendarDate = new Date(year, month - 1, day); // month - 1 because months are 0-indexed in Date
    
    const dateTextEl = document.getElementById('selectedDateText');
    if (dateTextEl) dateTextEl.innerText = selectedCalendarDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    renderEventsForSelectedDate();
}

async function addCalendarEvent() {
    if (!currentUser) return showToast("Login to add calendar events.", "error");

    const title = document.getElementById('newEventTitle').value.trim();
    const time = document.getElementById('newEventTime').value;
    const description = document.getElementById('newEventDescription').value.trim();

    if (!title || !time) return showToast("Title and Time are required for the event.", "error");

    const eventDate = new Date(selectedCalendarDate);
    const [hours, minutes] = time.split(':').map(Number);
    eventDate.setHours(hours, minutes, 0, 0);

    const newEvent = {
        id: Date.now(),
        date: eventDate.toISOString(),
        title,
        time,
        description,
        userId: currentUser.email
    };

    setLoading(true, "Saving Event");
    try {
        await fetch(`/api/main?route=calendar_events&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newEvent)
        });
        showToast("Event added to calendar.", "success");
        document.getElementById('newEventTitle').value = '';
        document.getElementById('newEventTime').value = '';
        document.getElementById('newEventDescription').value = '';
        await loadCalendarEvents(); // Reload all events to update calendar UI
        renderEventsForSelectedDate(); // Re-render events for the current day
    } catch (e) {
        showToast("Failed to add event.", "error");
    } finally {
        setLoading(false);
    }
}

async function loadCalendarEvents() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=calendar_events&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        calendarEvents = Array.isArray(data) ? data : []; // Ensure calendarEvents is always an array
        renderCalendar(); // Re-render calendar to show event dots
    } catch (e) { console.warn("Failed to load calendar events", e); }
}

async function deleteCalendarEvent(id) {
    if (!confirm("Delete this event?")) return;
    if (!currentUser) return;

    setLoading(true, "Deleting Event");
    try {
        await fetch(`/api/main?route=calendar_events&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, {
            method: 'DELETE'
        });
        showToast("Event deleted.", "warning");
        await loadCalendarEvents();
        renderEventsForSelectedDate();
    } catch (e) {
        showToast("Failed to delete event.", "error");
    } finally {
        setLoading(false);
    }
}

function renderEventsForSelectedDate() {
    const eventsListEl = document.getElementById('eventsForSelectedDate');
    const events = calendarEvents.filter(event => {
        const eventDate = new Date(event.date);
        return eventDate.toDateString() === selectedCalendarDate.toDateString();
    }).sort((a,b) => new Date(a.date) - new Date(b.date)); // Sort by time

    if (!events.length) {
        eventsListEl.innerHTML = '<p class="text-[10px] text-gray-500 italic">No events for this date.</p>';
        return;
    }

    eventsListEl.innerHTML = events.map(event => `
        <div class="bg-white/5 p-2 rounded-lg border border-white/10 flex justify-between items-center group">
            <div>
                <p class="text-xs font-bold text-white">${event.title}</p>
                <p class="text-[10px] text-gray-400">${event.time} ${event.description ? ` - ${event.description}` : ''}</p>
            </div>
            <button onclick="deleteCalendarEvent(${event.id})" class="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"><i class="fas fa-trash-alt text-xs"></i></button>
        </div>
    `).join('');
}

let reminderCheckInterval = null;
function checkReminders() {
    if (reminderCheckInterval) clearInterval(reminderCheckInterval);

    reminderCheckInterval = setInterval(() => {
        const now = new Date();
        calendarEvents.forEach(event => {
            const eventDateTime = new Date(event.date);
            // Check if event is today and within the current minute
            if (eventDateTime.toDateString() === now.toDateString() && 
                eventDateTime.getHours() === now.getHours() && 
                eventDateTime.getMinutes() === now.getMinutes()) {
                
                // Prevent multiple triggers
                if (!event.triggeredToday) {
                    modalTimerChime.play();
                    if (window.navigator.vibrate) window.navigator.vibrate([200, 100, 200, 100, 500]);
                    alert(`Reminder: ${event.title} at ${event.time}`);
                    event.triggeredToday = true; // Mark as triggered for the day
                    // Small local storage update to persist triggeredToday status (optional, more robust if stored in DB for real persistence)
                }
            } else {
                event.triggeredToday = false; // Reset for next day
            }
        });
    }, 1000 * 30); // Check every 30 seconds
}


function renderTourStep() {
    const step = activeTourSteps[currentTourStep];
    const ghost = document.getElementById('ghostGuide');
    const text = document.getElementById('tourText');
    const tooltip = document.getElementById('tourTooltip');
    const prevHighlight = document.querySelector('.tour-highlight');
    if (prevHighlight) prevHighlight.classList.remove('tour-highlight');

    const target = document.querySelector(step.selector);
    let ghostX, ghostY;

    if (target && target.offsetParent !== null) {
        target.classList.add('tour-highlight');
        const rect = target.getBoundingClientRect();
        
        // Horizontal: center of target
        ghostX = rect.left + rect.width / 2;
        
        // Vertical: Prefer top, fallback to bottom if cut off
        ghostY = rect.top - 180;
        if (ghostY < 20) ghostY = rect.bottom + 20;

        // Final viewport bounds check for vertical safety
        if (ghostY + 300 > window.innerHeight) ghostY = window.innerHeight - 310;
        
        ghost.style.left = `${ghostX}px`;
        ghost.style.top = `${ghostY}px`;
        ghost.style.transform = 'translateX(-50%)';
    } else {
        ghostX = (parseFloat(step.pos.left) / 100) * window.innerWidth;
        ghostY = (parseFloat(step.pos.top) / 100) * window.innerHeight;
        ghost.style.left = `${ghostX}px`;
        ghost.style.top = `${ghostY}px`;
        ghost.style.transform = 'translate(-50%, -50%)';
    }

    // Responsive Tooltip Alignment & Width
    tooltip.classList.remove('left-1/2', '-translate-x-1/2', 'left-0', 'right-0');
    tooltip.style.left = '';
    tooltip.style.right = '';
    tooltip.style.transform = '';

    const tooltipWidth = Math.min(256, window.innerWidth - 40);
    tooltip.style.width = `${tooltipWidth}px`;
    const margin = 20;

    // Check if centering tooltip puts it offscreen
    if (ghostX - (tooltipWidth / 2) < margin) {
        tooltip.classList.add('left-0');
        tooltip.style.transform = 'translateX(0)';
    } else if (ghostX + (tooltipWidth / 2) > window.innerWidth - margin) {
        tooltip.classList.add('right-0');
        tooltip.style.left = 'auto';
        tooltip.style.transform = 'translateX(0)';
    } else {
        tooltip.classList.add('left-1/2', '-translate-x-1/2');
    }

    text.innerText = step.text;
}

function nextTourStep() {
    currentTourStep++;
    if (currentTourStep >= activeTourSteps.length) {
        finishTour();
    } else {
        renderTourStep();
    }
}

function skipTour() {
    finishTour();
}

function finishTour() {
    const overlay = document.getElementById('tourOverlay');
    const backdrop = document.getElementById('tourBackdrop');
    const highlight = document.querySelector('.tour-highlight');
    
    if (highlight) highlight.classList.remove('tour-highlight');
    backdrop.classList.remove('opacity-100');
    localStorage.setItem('soul_tour_done', 'true');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        showToast("Enjoy your journey, Soul Seeker!", "info");
    }, 500);
}

function updateGoalProgress() {
    const goal = parseInt(document.getElementById('wordGoal').value) || 0;
    const current = parseInt(document.getElementById('editWordCount').innerText) || 0;
    const bar = document.getElementById('goalProgress');
    
    if (goal <= 0) {
        bar.parentElement.classList.add('hidden');
        return;
    }
    
    bar.parentElement.classList.remove('hidden');
    const percent = Math.min((current / goal) * 100, 100);
    bar.style.width = percent + '%';
    
    if (percent >= 100) {
        bar.classList.replace('bg-cyan-500', 'bg-green-500');
        if (percent === 100 && !bar.dataset.notified) {
            showToast("Writing Goal Achieved! 🏆", "success");
            bar.dataset.notified = "true";
        }
    } else {
        bar.classList.replace('bg-green-500', 'bg-cyan-500');
        delete bar.dataset.notified;
    }
}

function showAICooldownOverlay() {
    const overlay = document.getElementById('aiCooldownOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }
}

function hideAICooldownOverlay() {
    const overlay = document.getElementById('aiCooldownOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function retryAICooldown() {
    // Attempt to clear cooldown state and close overlay
    isAICooldownActive = false;
    consecutiveApiFailures = 0;
    if (aiCooldownTimer) clearTimeout(aiCooldownTimer);
    hideAICooldownOverlay();
    showToast("Attempting to reconnect AI...", "info");
}

function goToSupportPage() {
    hideAICooldownOverlay();
    showPage('support');
}

// --- PROMPT ARCHITECT LOGIC ---
function togglePromptArchitect() {
    const modal = document.getElementById('promptArchitectModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        document.getElementById('archPersona').focus();
    } else {
        modal.classList.add('hidden');
    }
}

function applyArchitectPrompt() {
    const persona = document.getElementById('archPersona').value.trim() || "Expert Assistant";
    const objective = document.getElementById('archObjective').value.trim();
    const tone = document.getElementById('archTone').value.trim() || "Professional";
    const format = document.getElementById('archFormat').value.trim() || "Markdown";
    const exclusions = document.getElementById('archExclusions').value.trim() || "None";

    if (!objective) return alert("Please specify an objective for the Architect.");

    const masterPrompt = `Act as a ${persona}. Your goal is to execute the following task with a perfect balance of radical creativity and rigorous logical precision.

### 1. THE OBJECTIVE
${objective}

### 2. OPERATIONAL FRAMEWORK
To ensure the highest quality output, follow these cognitive protocols:
* **First-Principles Thinking:** Strip the problem down to its fundamental truths and build up from there. Do not rely on clichés or standard templates.
* **Lateral Thinking:** Explore non-obvious connections and innovative approaches that differentiate this from average results.
* **High-Resolution Detail:** Provide depth, nuance, and specific examples. Avoid vague abstractions.
* **Structural Integrity:** Ensure the output is logically sound, internally consistent, and ready for immediate implementation.

### 3. CONSTRAINTS & STYLE
* **Tone:** ${tone}
* **Format:** ${format}
* **Exclusions:** ${exclusions}

### 4. EXECUTION STEP-BY-STEP
Before providing the final answer, perform these internal steps:
1. **Drafting:** Silently brainstorm three different approaches to this task.
2. **Critique:** Evaluate those approaches for logic gaps or lack of originality.
3. **Synthesis:** Combine the best elements into a final, superior execution.

**Now, proceed with the task. Surprise me with your depth and intelligence.**`;

    const input = document.getElementById('chatInput');
    input.value = masterPrompt;
    autoResize(input);
    togglePromptArchitect();
    showToast("Master Blueprint forged and loaded.", "success");
    
    // Smooth scroll to input if needed
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}



// Persistent Background Audio Handler
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if ('mediaSession' in navigator && isMusicPlaying) {
            navigator.mediaSession.playbackState = "playing";
        }
    } else {
        if (isMusicPlaying) updateMusicUI();
    }
});

// --- sOuLSOLVE LOGIC ---
const SOLVE_BUTTONS = {
    simple: [
        { label: 'C', cmd: 'clear', class: 'text-red-400' },
        { label: '(', cmd: '(' },
        { label: ')', cmd: ')' },
        { label: 'DEL', cmd: 'backspace', class: 'text-orange-400' },
        { label: '7', cmd: '7' }, { label: '8', cmd: '8' }, { label: '9', cmd: '9' },
        { label: '÷', cmd: '/', class: 'text-emerald-400 font-black' },
        { label: '4', cmd: '4' }, { label: '5', cmd: '5' }, { label: '6', cmd: '6' },
        { label: '×', cmd: '*', class: 'text-emerald-400 font-black' },
        { label: '1', cmd: '1' }, { label: '2', cmd: '2' }, { label: '3', cmd: '3' },
        { label: '-', cmd: '-', class: 'text-emerald-400 font-black' },
        { label: '0', cmd: '0' }, { label: '.', cmd: '.' }, { label: 'ANS', cmd: 'ans' },
        { label: '+', cmd: '+', class: 'text-emerald-400 font-black' }
    ],
    pro: [
        { label: 'C', cmd: 'clear', class: 'text-red-400' },
        { label: '(', cmd: '(' }, { label: ')', cmd: ')' },
        { label: 'MOD', cmd: '%' },
        { label: 'DEL', cmd: 'backspace', class: 'text-orange-400' },
        
        { label: 'sin', cmd: 'sin(' }, { label: 'cos', cmd: 'cos(' }, { label: 'tan', cmd: 'tan(' }, { label: 'π', cmd: 'pi' }, { label: '÷', cmd: '/', class: 'text-emerald-400' },
        
        { label: 'log', cmd: 'log(' }, { label: 'ln', cmd: 'log(' }, { label: '√', cmd: 'sqrt(' }, { label: '^', cmd: '^' }, { label: '×', cmd: '*', class: 'text-emerald-400' },
        
        { label: '7', cmd: '7' }, { label: '8', cmd: '8' }, { label: '9', cmd: '9' }, { label: '!', cmd: '!' }, { label: '-', cmd: '-', class: 'text-emerald-400' },
        
        { label: '4', cmd: '4' }, { label: '5', cmd: '5' }, { label: '6', cmd: '6' }, { label: 'e', cmd: 'e' }, { label: '+', cmd: '+', class: 'text-emerald-400' },
        
        { label: '1', cmd: '1' }, { label: '2', cmd: '2' }, { label: '3', cmd: '3' }, { label: 'ANS', cmd: 'ans' }, { label: '=', cmd: 'equal', class: 'bg-emerald-600 text-white' },
        
        { label: '0', cmd: '0' }, { label: '00', cmd: '00' }, { label: '.', cmd: '.' }, { label: 'unit', cmd: 'unit(' }, { label: 'matrix', cmd: '[[]]' }
    ]
};

function initSolveInterface() {
    renderSolvePad();
    document.getElementById('solveModeBadge').innerText = solveState.mode === 'pro' ? 'PRO MODE' : 'SIMPLE MODE';
}

function renderSolvePad() {
    const pad = document.getElementById('solvePad');
    const config = SOLVE_BUTTONS[solveState.mode];
    
    pad.innerHTML = config.map(b => {
        let onClick = `handleSolveBtn('${b.cmd}')`;
        if (b.cmd === 'equal') onClick = 'executeSolve()';
        
        return `<button onclick="${onClick}" class="solve-btn ${b.class || ''}">${b.label}</button>`;
    }).join('');
}

function toggleSolveMode() {
    solveState.mode = solveState.mode === 'simple' ? 'pro' : 'simple';
    initSolveInterface();
    showToast(`Switched to ${solveState.mode.toUpperCase()} Interface`, "info");
}

function handleSolveBtn(cmd) {
    const input = document.getElementById('solveInput');
    if (cmd === 'clear') {
        input.value = '';
        solveState.activeExpression = "";
    } else if (cmd === 'backspace') {
        input.value = input.value.slice(0, -1);
    } else if (cmd === 'ans') {
        input.value += solveState.lastAnswer;
    } else if (cmd === '[[]]') {
        input.value += '[[1, 2], [3, 4]]';
    } else {
        input.value += cmd;
    }
    onSolveInput();
    input.focus();
}

function onSolveInput() {
    const raw = document.getElementById('solveInput').value;
    const resultEl = document.getElementById('solveResult');
    const previewEl = document.getElementById('solveLatexPreview');
    const errorEl = document.getElementById('solveError');
    
    if (!raw.trim()) {
        resultEl.innerText = '0';
        previewEl.innerHTML = '';
        errorEl.classList.add('hidden');
        return;
    }

    try {
        // High-speed real-time preview evaluation
        const res = math.evaluate(raw);
        let formatted = res;
        if (typeof res === 'number') formatted = math.format(res, { precision: 10 });
        else if (res && res.isResultSet) formatted = res.entries[0];
        
        resultEl.innerText = formatted;
        resultEl.classList.remove('text-red-400');
        errorEl.classList.add('hidden');
        
        // Try to generate LaTeX preview if not too complex
        try {
            const node = math.parse(raw);
            const latex = node.toTex({parenthesis: 'keep', implicit: 'hide'});
            katex.render(latex, previewEl, { throwOnError: false });
        } catch (e) { previewEl.innerHTML = ''; }

    } catch (e) {
        // Non-intrusive error display for real-time
        errorEl.classList.remove('hidden');
    }
}

async function executeSolve() {
    const input = document.getElementById('solveInput');
    const expr = input.value.trim();
    if (!expr) return;

    try {
        const result = math.evaluate(expr);
        solveState.lastAnswer = result;
        
        const historyItem = {
            id: Date.now(),
            expr,
            res: math.format(result, { precision: 14 }),
            timestamp: Date.now()
        };

        solveState.history.unshift(historyItem);
        renderSolveHistory();
        
        // Clear main input for next one but keep result in big display
        document.getElementById('solveExpression').innerText = expr;
        input.value = '';
        onSolveInput(); // Reset UI
        document.getElementById('solveResult').innerText = historyItem.res;

        if (currentUser) {
            await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(historyItem)
            });
        }
    } catch (e) {
        showToast("Invalid mathematical syntax.", "error");
    }
}

function renderSolveHistory() {
    const list = document.getElementById('solveHistory');
    if (solveState.history.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-gray-600 italic text-center py-10">No calculations recorded.</p>';
        return;
    }

    list.innerHTML = solveState.history.map(h => `
        <div class="p-2 bg-emerald-900/5 border border-white/5 rounded-lg group hover:border-emerald-500/30 transition cursor-pointer" onclick="resumeSolve('${h.expr.replace(/'/g, "\\'")}')">
            <div class="flex justify-between items-center mb-1">
                <span class="text-[8px] text-gray-500 font-mono">${new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                <button onclick="event.stopPropagation(); deleteSolveItem(${h.id})" class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition text-[8px] uppercase">Remove</button>
            </div>
            <p class="text-[10px] font-mono text-gray-400 truncate">${h.expr}</p>
            <p class="text-xs font-black text-emerald-400 truncate mt-0.5">= ${h.res}</p>
            <div class="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onclick="event.stopPropagation(); extendSolveWithAI(${h.id})" class="text-[8px] bg-purple-600/20 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20 hover:bg-purple-600 hover:text-white">EXTEND WITH AI</button>
            </div>
        </div>
    `).join('');
}

function resumeSolve(expr) {
    document.getElementById('solveInput').value = expr;
    onSolveInput();
    document.getElementById('solveInput').focus();
}

async function deleteSolveItem(id) {
    solveState.history = solveState.history.filter(h => h.id !== id);
    renderSolveHistory();
    if (currentUser) {
        await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, { method: 'DELETE' });
    }
}

async function clearSolveHistory() {
    if (!confirm("Wipe calculation logs?")) return;
    solveState.history = [];
    renderSolveHistory();
    if (currentUser) {
        await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}`, { method: 'DELETE' });
    }
}

async function syncSolveHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            solveState.history = data;
            renderSolveHistory();
        }
    } catch (e) { console.warn("Solve history sync failed"); }
}

async function extendSolveWithAI(id) {
    const item = solveState.history.find(h => h.id === id);
    if (!item) return;

    const prompt = `Provide a brief but deep mathematical insight or an interesting extension related to this calculation: "${item.expr} = ${item.res}". 
    Explain the underlying logic or provide a related formula/concept in Markdown.`;
    
    document.getElementById('solveAIInput').value = `Explain ${item.expr}`;
    await askSolveAI(prompt);
}

async function askSolveAI(customPrompt = null) {
    if (isAICooldownActive) return showAICooldownOverlay();
    
    const inputEl = document.getElementById('solveAIInput');
    const query = customPrompt || inputEl.value.trim();
    if (!query && pendingFiles.length === 0) return;

    const userMsg = query + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'solveAIChat');
    inputEl.value = '';
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview'), document.getElementById('codeAttachmentPreview'), document.getElementById('solveAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const model = document.getElementById('solveModelSelect').value;
    
    const parts = [{ text: query || " " }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    const history = [{ role: 'user', content: userMsg, parts }];

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];

    await callGeminiAPI(query, 'solveAIChat', history, attachmentsForApi, model);
}

// Global functions for AI cooldown
function showAICooldownOverlay() {
    const overlay = document.getElementById('aiCooldownOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }
}

function hideAICooldownOverlay() {
    const overlay = document.getElementById('aiCooldownOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function retryAICooldown() {
    // Attempt to clear cooldown state and close overlay
    isAICooldownActive = false;
    consecutiveApiFailures = 0;
    if (aiCooldownTimer) clearTimeout(aiCooldownTimer);
    hideAICooldownOverlay();
    showToast("Attempting to reconnect AI...", "info");
}

function goToSupportPage() {
    hideAICooldownOverlay();
    showPage('support');
}

// Keyboard shortcuts for Solver
document.addEventListener('keydown', (e) => {
    if (document.getElementById('solve').classList.contains('active')) {
        const input = document.getElementById('solveInput');
        if (document.activeElement !== input && document.activeElement !== document.getElementById('solveAIInput')) {
            // Auto-focus main input if user starts typing digits or math ops
            if (/^[0-9\+\-\*\/\(\)\.\^]/.test(e.key)) {
                input.focus();
            }
        }
    }
});


// --- sOuLCODE LOGIC ---
const CODE_EXCLUSIONS = ['node_modules', '.git', '.vercel', '.next', 'dist', 'build', '.env', 'package-lock.json', 'yarn.lock', 'venv', '__pycache__', '.vscode'];

async function handleCodeUpload(e) {
    let files = Array.from(e.target.files);
    if (!files.length) return;

    // Optional user-defined exclusions for large projects
    let customExclusions = [];
    if (files.length > 50) {
        const userInput = prompt(`Project contains ${files.length} items. \nStandard exclusions (node_modules, etc.) are active. \nEnter additional comma-separated keywords to exclude (or leave blank):`, "");
        if (userInput) {
            customExclusions = userInput.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        }
    }

    const allExclusions = [...CODE_EXCLUSIONS, ...customExclusions];

    let skipped = 0;
    const processList = files.filter(f => {
        const fullPath = (f.webkitRelativePath || f.name).toLowerCase();
        const pathSegments = fullPath.split('/');
        
        // Accurate segment matching to avoid accidental exclusion of similarly named files
        const isEx = allExclusions.some(x => {
            const pattern = x.toLowerCase();
            return pathSegments.some(segment => segment === pattern) || fullPath.includes(pattern);
        });

        if(isEx) skipped++;
        return !isEx;
    });

    if(!processList.length) {
        showToast("No valid source files found after filtering.", "warning");
        e.target.value = ''; return;
    }

    setLoading(true, `Indexing ${processList.length} items...`);
    
    // Chunked processing to maintain UI responsiveness
    const CHUNK_SIZE = 25;
    for (let i = 0; i < processList.length; i += CHUNK_SIZE) {
        const chunk = processList.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    projectFiles.push({ 
                        id: Date.now() + Math.random(), 
                        name: file.name, 
                        path: file.webkitRelativePath || file.name, 
                        content: ev.target.result 
                    });
                    resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsText(file);
            });
        }));
    }

    renderFileTree();
    setLoading(false);
    showToast(`Workspace Ready. Indexed ${processList.length} files, skipped ${skipped} ignored items.`, "success");
    e.target.value = '';
}

function renderFileTree() {
    const tree = document.getElementById('fileTree');
    if (!projectFiles.length) {
        tree.innerHTML = '<div class="py-10 text-center"><p class="text-[10px] text-gray-500 italic mb-4">Workspace empty.</p><button onclick="createNewCodeFile()" class="text-[9px] font-black text-blue-400 hover:underline">NEW BLANK FILE</button></div>';
        return;
    }

    tree.innerHTML = projectFiles.sort((a,b) => a.path.localeCompare(b.path)).map(f => {
        const isActive = f.id === activeFileId;
        return `
            <div onclick="selectCodeFile('${f.id}')" class="group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all hover:bg-white/5 ${isActive ? 'bg-blue-600/20 text-white border border-blue-500/30' : 'text-gray-400'}">
                <div class="flex items-center gap-2 min-w-0">
                    <i class="fas fa-file-code text-[10px] opacity-70"></i>
                    <span class="text-[10px] font-medium truncate">${f.path}</span>
                </div>
                <button onclick="event.stopPropagation(); deleteCodeFile('${f.id}')" class="opacity-0 group-hover:opacity-100 hover:text-red-500 p-1"><i class="fas fa-trash-alt text-[9px]"></i></button>
            </div>
        `;
    }).join('');
}

function selectCodeFile(id) {
    activeFileId = Number(id);
    const file = projectFiles.find(f => f.id === activeFileId);
    if (!file) return;
    document.getElementById('activeFileName').innerText = file.path;
    document.getElementById('codeEditor').value = file.content;
    document.getElementById('downloadBtn').classList.remove('hidden');
    const folderBtn = document.getElementById('deleteFolderBtn');
    if(file.path.includes('/')) folderBtn.classList.remove('hidden');
    else folderBtn.classList.add('hidden');
    renderFileTree();
}

function deleteCodeFile(id) {
    const numId = Number(id);
    projectFiles = projectFiles.filter(f => f.id !== numId);
    if(activeFileId === numId) clearEditorState();
    renderFileTree();
}

function deleteActiveFolder() {
    const file = projectFiles.find(f => f.id === activeFileId);
    if(!file || !file.path.includes('/')) return;
    const folder = file.path.split('/').slice(0, -1).join('/') + '/';
    if(!confirm(`Remove all files in ${folder}?`)) return;
    projectFiles = projectFiles.filter(f => !f.path.startsWith(folder));
    if(!projectFiles.find(f => f.id === activeFileId)) clearEditorState();
    renderFileTree();
    showToast(`Removed folder: ${folder}`, "warning");
}

function clearEditorState() {
    activeFileId = null;
    document.getElementById('codeEditor').value = '';
    document.getElementById('activeFileName').innerText = 'No file selected';
    document.getElementById('downloadBtn').classList.add('hidden');
    document.getElementById('deleteFolderBtn').classList.add('hidden');
}

function clearCodeWorkspace() {
    if(projectFiles.length && !confirm("Clear entire session?")) return;
    projectFiles = [];
    clearEditorState();
    renderFileTree();
}

function createNewCodeFile() {
    const name = prompt("Name your file:", "Untitled.txt") || "Untitled.txt";
    const id = Date.now() + Math.random();
    projectFiles.push({ id, name, path: name, content: '' });
    renderFileTree();
    selectCodeFile(id);
}

let codeAutoSaveTimeout;
function handleCodeInput() {
    const status = document.getElementById('editStatus');
    if (status) status.classList.remove('hidden');
    
    clearTimeout(codeAutoSaveTimeout);
    codeAutoSaveTimeout = setTimeout(() => {
        saveActiveFile(true);
        if (status) status.classList.add('hidden');
    }, 1500);
}

function saveActiveFile(isAuto = false) {
    if (!activeFileId) return;
    const file = projectFiles.find(f => f.id === activeFileId);
    if (file) {
        file.content = document.getElementById('codeEditor').value;
        if (!isAuto) showToast("Local file updated.", "success");
    }
}

function downloadActiveFile() {
    if (!activeFileId) return;
    const file = projectFiles.find(f => f.id === activeFileId);
    if (!file) return;

    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

async function askCodeAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('codeChatInput');
    const editorEl = document.getElementById('codeEditor');
    const query = inputEl.value.trim();
    if (!query && pendingFiles.length === 0) return;

    let activeFile = projectFiles.find(f => f.id === activeFileId);
    
    if (!activeFile && editorEl.value.trim()) {
        const id = Date.now() + Math.random();
        activeFile = { id, name: 'notebook.txt', path: 'notebook.txt', content: editorEl.value };
        projectFiles.push(activeFile);
        activeFileId = id;
        renderFileTree();
        selectCodeFile(id);
        showToast("Editor content indexed as notebook.", "info");
    }

    if (!activeFile && pendingFiles.length === 0) {
        showToast("Upload a file or enter code in the editor to provide context.", "warning");
        return;
    }

    const userMsg = query + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'codeChatBox');
    inputEl.value = '';
    autoResize(inputEl);
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview'), document.getElementById('codeAttachmentPreview'), document.getElementById('solveAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const model = document.getElementById('codeModelSelect').value;
    const projectContext = projectFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n---\n\n');
    let activeFilePath = activeFile ? activeFile.path : 'None';
    let activeFileContent = activeFile ? activeFile.content : 'None';

    const systemPrompt = `You are an expert AI code editor. 
    CURRENT_PROJECT_CONTEXT:
    ${projectContext}

    ACTIVE_FILE: ${activeFilePath}
    ACTIVE_FILE_CONTENT: ${activeFileContent}

    USER_REQUEST: ${query}

    INSTRUCTIONS:
    1. You MUST directly edit the active file if the user requests changes.
    2. Return your response in this exact format:
       COMMENTARY: [Brief explanation of changes]
       CODE_START
       [Full new content of ${activeFilePath}]
       CODE_END
    3. If no code change is requested, just answer the question in plain text.`;

    const parts = [{ text: systemPrompt }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    const history = [{ role: 'user', content: userMsg, parts }];
    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];

    // Force non-streaming for Code AI
    const originalStreamMode = isStreamingMode;
    isStreamingMode = false;
    await callGeminiAPI(query, 'codeChatBox', history, attachmentsForApi, model);
    isStreamingMode = originalStreamMode;
}

function showDiffOverlay() {
    if (!aiProposedChange) return;
    
    const oldLines = aiProposedChange.originalContent.split('\n');
    const newLines = aiProposedChange.newContent.split('\n');
    
    // Optimized Diff alignment using LCS (Longest Common Subsequence)
    function getDiff(oldArr, newArr) {
        const m = oldArr.length;
        const n = newArr.length;
        
        // Use a single typed array for the DP table to improve memory efficiency
        const dp = new Int32Array((m + 1) * (n + 1));
        const getIdx = (i, j) => i * (n + 1) + j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldArr[i - 1] === newArr[j - 1]) {
                    dp[getIdx(i, j)] = dp[getIdx(i - 1, j - 1)] + 1;
                } else {
                    dp[getIdx(i, j)] = Math.max(dp[getIdx(i - 1, j)], dp[getIdx(i, j - 1)]);
                }
            }
        }

        const result = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
                result.unshift({ type: 'equal', old: oldArr[i - 1], new: newArr[j - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[getIdx(i, j - 1)] >= dp[getIdx(i - 1, j)])) {
                result.unshift({ type: 'add', new: newArr[j - 1] });
                j--;
            } else {
                result.unshift({ type: 'delete', old: oldArr[i - 1] });
                i--;
            }
        }
        return result;
    }

    const diff = getDiff(oldLines, newLines);
    
    let origHtml = "";
    let newHtml = "";
    
    diff.forEach(item => {
        const oStr = item.old !== undefined ? escapeHtml(item.old) : null;
        const nStr = item.new !== undefined ? escapeHtml(item.new) : null;

        if (item.type === 'equal') {
            const content = (oStr || '').trim() === '' ? '&nbsp;' : oStr;
            origHtml += `<div>${content}</div>`;
            newHtml += `<div>${content}</div>`;
        } else if (item.type === 'delete') {
            origHtml += `<div class="bg-red-500/30 text-red-200 border-l-2 border-red-500 pl-1"> ${oStr || '&nbsp;'}</div>`;
            newHtml += `<div class="opacity-10 bg-red-900/10">&nbsp;</div>`;
        } else if (item.type === 'add') {
            origHtml += `<div class="opacity-10 bg-green-900/10">&nbsp;</div>`;
            newHtml += `<div class="bg-green-500/30 text-green-200 border-l-2 border-green-500 pl-1"> ${nStr || '&nbsp;'}</div>`;
        }
    });

    document.getElementById('diffOriginal').innerHTML = origHtml;
    document.getElementById('diffProposed').innerHTML = newHtml;
    document.getElementById('diffOverlay').classList.remove('hidden');
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function acceptAIChanges() {
    if (!aiProposedChange) return;
    const file = projectFiles.find(f => f.id === aiProposedChange.fileId);
    if (file) {
        file.content = aiProposedChange.newContent;
        if (activeFileId === file.id) {
            document.getElementById('codeEditor').value = file.content;
        }
        showToast("Changes applied to source.", "success");
    }
    closeDiffOverlay();
}

function rejectAIChanges() {
    showToast("Changes discarded.", "info");
    closeDiffOverlay();
}

function closeDiffOverlay() {
    document.getElementById('diffOverlay').classList.add('hidden');
    aiProposedChange = null;
}

// --- sOuLCOMPARE LOGIC ---
let compareMode = 'side';
let currentDiffResult = [];
let compareHistory = [];
let compareHistoryIndex = -1;

function clearCompareResults() {
    currentDiffResult = [];
    compareHistory = [];
    compareHistoryIndex = -1;
    document.getElementById('compareDiffLeft').innerHTML = '';
    document.getElementById('compareDiffRight').innerHTML = '';
    document.getElementById('compareStats').classList.add('hidden');
    document.getElementById('copyMergeBtn').classList.add('hidden');
    document.getElementById('compareHistoryControls').classList.add('hidden');
}

function handleCompareFileUpload(event, side) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const targetId = side === 'old' ? 'compareOld' : 'compareNew';
        document.getElementById(targetId).value = e.target.result;
        showToast(`${side === 'old' ? 'Original' : 'Modified'} file imported.`, "success");
        event.target.value = '';
    };
    reader.readAsText(file);
}

function toggleCompareMode() {
    compareMode = compareMode === 'side' ? 'unified' : 'side';
    const btn = document.getElementById('compareModeBtn');
    const container = document.getElementById('compareResultContainer');
    const left = document.getElementById('compareDiffLeft');
    
    btn.innerText = compareMode === 'side' ? 'Mode: Side-by-Side' : 'Mode: Unified';
    
    if (compareMode === 'side') {
        container.classList.add('lg:grid-cols-2');
        left.classList.remove('hidden');
    } else {
        container.classList.remove('lg:grid-cols-2');
        left.classList.add('hidden');
    }
    
    if (currentDiffResult.length > 0) renderDiffOutput();
}

async function executeCompare() {
    const oldVal = document.getElementById('compareOld').value;
    const newVal = document.getElementById('compareNew').value;
    
    if (!oldVal.trim() && !newVal.trim()) return showToast("Nothing to compare.", "warning");

    setLoading(true, "Analyzing Text Structures");
    
    setTimeout(() => {
        const oldLines = oldVal.split('\n');
        const newLines = newVal.split('\n');

        function getDiff(oldArr, newArr) {
            const m = oldArr.length, n = newArr.length;
            const dp = new Int32Array((m + 1) * (n + 1));
            const getIdx = (i, j) => i * (n + 1) + j;
            
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    if (oldArr[i - 1] === newArr[j - 1]) dp[getIdx(i, j)] = dp[getIdx(i - 1, j - 1)] + 1;
                    else dp[getIdx(i, j)] = Math.max(dp[getIdx(i - 1, j)], dp[getIdx(i, j - 1)]);
                }
            }
            
            const result = [];
            let i = m, j = n;
            let oL = m, nL = n;
            
            while (i > 0 || j > 0) {
                if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
                    result.unshift({ type: 'equal', val: oldArr[i - 1], oldLine: oL--, newLine: nL-- });
                    i--; j--;
                } else if (j > 0 && (i === 0 || dp[getIdx(i, j - 1)] >= dp[getIdx(i - 1, j)])) {
                    result.unshift({ type: 'add', val: newArr[j - 1], newLine: nL-- });
                    j--;
                } else {
                    result.unshift({ type: 'delete', val: oldArr[i - 1], oldLine: oL-- });
                    i--;
                }
            }
            return result;
        }

        currentDiffResult = getDiff(oldLines, newLines);
        saveCompareHistory();
        renderDiffOutput();
        setLoading(false);
        showToast("Comparison analysis complete.", "success");
    }, 50);
}

function renderDiffOutput() {
    const leftBox = document.getElementById('compareDiffLeft');
    const rightBox = document.getElementById('compareDiffRight');
    const statsBox = document.getElementById('compareStats');
    const copyBtn = document.getElementById('copyMergeBtn');
    const histBtn = document.getElementById('compareHistoryControls');

    let leftHtml = "", rightHtml = "";
    let adds = 0, dels = 0;

    currentDiffResult.forEach((item, idx) => {
        const escaped = escapeHtml(item.val);
        const content = escaped.trim() === '' ? '&nbsp;' : escaped;
        
        if (item.type === 'equal') {
            const lineHtml = `
                <div class="diff-row group/row">
                    <div class="line-num">${item.oldLine || '-'}</div>
                    <div class="line-num">${item.newLine || '-'}</div>
                    <div class="diff-content">${content}</div>
                </div>`;
            leftHtml += lineHtml;
            rightHtml += lineHtml;
        } else if (item.type === 'delete') {
            dels++;
            leftHtml += `
                <div class="diff-row delete group/row">
                    <div class="line-num">${item.oldLine}</div>
                    <div class="line-num">-</div>
                    <div class="diff-content">${content}</div>
                    <button onclick="mergeDiffLine(${idx}, 'restore')" class="merge-action-btn right" title="Restore to modified side"><i class="fas fa-arrow-right"></i></button>
                </div>`;
            if (compareMode === 'side') {
                rightHtml += `<div class="diff-row empty"><div class="line-num"></div><div class="line-num"></div><div class="diff-content">&nbsp;</div></div>`;
            }
        } else if (item.type === 'add') {
            adds++;
            if (compareMode === 'side') {
                leftHtml += `<div class="diff-row empty"><div class="line-num"></div><div class="line-num"></div><div class="diff-content">&nbsp;</div></div>`;
            }
            rightHtml += `
                <div class="diff-row add group/row">
                    <div class="line-num">-</div>
                    <div class="line-num">${item.newLine}</div>
                    <div class="diff-content">${content}</div>
                    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button onclick="mergeDiffLine(${idx}, 'remove')" class="w-5 h-5 bg-red-600/20 text-red-400 rounded flex items-center justify-center hover:bg-red-600 hover:text-white transition" title="Discard change"><i class="fas fa-times text-[8px]"></i></button>
                        <button onclick="mergeDiffLine(${idx}, 'accept')" class="w-5 h-5 bg-green-600/20 text-green-400 rounded flex items-center justify-center hover:bg-green-600 hover:text-white transition" title="Accept change"><i class="fas fa-check text-[8px]"></i></button>
                    </div>
                </div>`;
        }
    });

    leftBox.innerHTML = leftHtml;
    rightBox.innerHTML = rightHtml;
    
    document.getElementById('diffDeletions').innerText = dels;
    document.getElementById('diffAdditions').innerText = adds;
    statsBox.classList.remove('hidden');
    copyBtn.classList.remove('hidden');
    histBtn.classList.remove('hidden');

    updateCompareHistoryButtons();
    setupCompareSyncScroll();
}

function mergeDiffLine(idx, action) {
    const item = currentDiffResult[idx];
    if (!item) return;

    if (action === 'restore') {
        // Line was deleted from right side, bring it back
        item.type = 'equal';
        item.newLine = 'M';
        showToast("Line restored to modified side.", "info");
    } else if (action === 'accept') {
        // Line was added to right side, keep it as part of base
        item.type = 'equal';
        item.oldLine = 'M';
        showToast("Change accepted.", "success");
    } else if (action === 'remove') {
        // Discard the addition
        currentDiffResult.splice(idx, 1);
        showToast("Change discarded.", "warning");
    }
    
    saveCompareHistory();
    renderDiffOutput();
}

function saveCompareHistory() {
    // Truncate future history if we were in middle of undo stack
    compareHistory = compareHistory.slice(0, compareHistoryIndex + 1);
    // Push a deep copy
    compareHistory.push(JSON.parse(JSON.stringify(currentDiffResult)));
    compareHistoryIndex = compareHistory.length - 1;
    // Limit history size to 50
    if (compareHistory.length > 50) {
        compareHistory.shift();
        compareHistoryIndex--;
    }
}

function undoCompare() {
    if (compareHistoryIndex > 0) {
        compareHistoryIndex--;
        currentDiffResult = JSON.parse(JSON.stringify(compareHistory[compareHistoryIndex]));
        renderDiffOutput();
    }
}

function redoCompare() {
    if (compareHistoryIndex < compareHistory.length - 1) {
        compareHistoryIndex++;
        currentDiffResult = JSON.parse(JSON.stringify(compareHistory[compareHistoryIndex]));
        renderDiffOutput();
    }
}

function updateCompareHistoryButtons() {
    const undoBtn = document.getElementById('undoCompareBtn');
    const redoBtn = document.getElementById('redoCompareBtn');
    
    undoBtn.disabled = compareHistoryIndex <= 0;
    undoBtn.style.opacity = undoBtn.disabled ? '0.3' : '1';
    
    redoBtn.disabled = compareHistoryIndex >= compareHistory.length - 1;
    redoBtn.style.opacity = redoBtn.disabled ? '0.3' : '1';
}

function copyMergedCompare() {
    // Merged text consists of all 'equal' and 'add' lines (which are present on modified side)
    const text = currentDiffResult
        .map(item => item.val)
        .join('\n');
    
    navigator.clipboard.writeText(text).then(() => {
        showToast("Merged result copied to clipboard!", "success");
    });
}

function setupCompareSyncScroll() {
    const left = document.getElementById('compareDiffLeft');
    const right = document.getElementById('compareDiffRight');
    
    const sync = (e) => {
        const source = e.target;
        const target = source === left ? right : left;
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
    };

    left.onscroll = sync;
    right.onscroll = sync;
}

// --- INIT ---
// Performance optimized initialization sequence
const initApp = async () => {
    // 1. Critical UI setup (Immediate)
    const savedTheme = (currentUser && currentUser.theme) ? currentUser.theme : (localStorage.getItem('soul_theme') || 'midnight');
    setTheme(savedTheme);
    
    const initialPath = window.location.pathname.substring(1) || 'home';
    showPage(initialPath, false);
    
    updateAuthUI();
    initCustomCursor();

    // Initial resize trigger for pre-filled or visible textareas
    setTimeout(() => {
        ['chatInput', 'noteInput', 'editNoteText', 'miniChatInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) autoResize(el);
        });
    }, 100);

    // 2. Non-critical metadata
    const yearEl = document.getElementById('currentYear');
    if (yearEl) yearEl.innerText = new Date().getFullYear();

    // 3. Deferred/Async Logic
    requestAnimationFrame(async () => {
        // Sync scroll for compare input textareas
        const compOld = document.getElementById('compareOld');
        const compNew = document.getElementById('compareNew');
        if (compOld && compNew) {
            const syncScrollInput = (e) => {
                const target = e.target === compOld ? compNew : compOld;
                target.scrollTop = e.target.scrollTop;
            };
            compOld.addEventListener('scroll', syncScrollInput, { passive: true });
            compNew.addEventListener('scroll', syncScrollInput, { passive: true });
        }
        // Marked.js options
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                highlight: (code) => typeof hljs !== 'undefined' ? hljs.highlightAuto(code).value : code,
                breaks: true,
                gfm: true
            });
        }

        const savedVol = localStorage.getItem('soulVolume');
        if (savedVol !== null) {
            const vol = parseFloat(savedVol);
            audioPlayer.volume = vol;
            if (document.getElementById('volumeControl')) document.getElementById('volumeControl').value = vol;
        }

        // Search Input Listeners for Modal
        const explorerInputs = [document.getElementById('ytExplorerInput'), document.getElementById('ytExplorerInputMobile')];
        explorerInputs.forEach(input => {
            if(input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') searchYTExplorer(input.id.includes('Mobile'));
                });
            }
        });

        // Parallel non-blocking data fetching
        const backgroundTasks = [
            loadConfig(),
            loadFeedbacks(),
            checkAnnouncement(),
            checkSystemHealth()
        ];

        if (currentUser) {
            backgroundTasks.push(syncAllData());
            backgroundTasks.push(loadCricketSetup());
            
            // Re-trigger tour if user registered but didn't finish/see it
            if (!localStorage.getItem('soul_tour_done')) {
                setTimeout(startWelcomeTour, 4000);
            }
        }

        await Promise.all(backgroundTasks);

        // UI specific secondary setups
        renderAIHistory();
        initGoogleLogin();
        
        // Setup Greetings if not already present
        const chatBox = document.getElementById('chatBox');
        if (chatBox && !chatBox.innerHTML.trim()) {
            appendAIMessage('ai', "### Greetings.\nI am the **sOuLAI** interface. How can I assist your vision today?", 'chatBox');
        }
        
        const miniChatBox = document.getElementById('miniChatBox');
        if (miniChatBox && !miniChatBox.innerHTML.trim()) {
            appendAIMessage('ai', "Hello! I am your quick AI assistant. Ask me anything.", 'miniChatBox');
        }

        document.getElementById('aiWidget').onclick = toggleMiniChat;

        // Synced Scrolling Initialization (Notes)
        const editorEl = document.getElementById('editNoteText');
        const previewEl = document.getElementById('notePreview');
        if (editorEl && previewEl) {
            editorEl.addEventListener('scroll', handleEditorScroll, { passive: true });
            previewEl.addEventListener('scroll', handlePreviewScroll, { passive: true });
        }

        // Synced Scrolling Initialization (Code Diff)
        const diffOrig = document.getElementById('diffOriginal');
        const diffProp = document.getElementById('diffProposed');
        if (diffOrig && diffProp) {
            diffOrig.addEventListener('scroll', handleDiffOriginalScroll, { passive: true });
            diffProp.addEventListener('scroll', handleDiffProposedScroll, { passive: true });
        }

        // Start polling/monitoring
        setInterval(checkSystemHealth, 30000);
        setInterval(checkAnnouncement, 60000);
        
        if (initialPath === 'snake') syncSnakeLeaderboard();
        if (initialPath === 'draw') initDrawPage();
        startTimeUpdates();
    });
};

// --- sOuLDRAW LOGIC ---
let drawState = {
    initialized: false,
    canvas: null, ctx: null,
    isDrawing: false,
    currentTool: 'brush',
    history: [],
    historyIndex: -1,
    startX: 0, startY: 0,
    tempCanvas: null, tempCtx: null
};

function initDrawPage() {
    drawState.canvas = document.getElementById('drawCanvas');
    if (!drawState.canvas) return;
    
    // Prevent re-initialization if already active
    if (drawState.initialized) return;
    drawState.initialized = true;

    drawState.ctx = drawState.canvas.getContext('2d', { willReadFrequently: true });
    
    const resize = () => {
        const container = document.getElementById('drawContainer');
        if (!container) return;
        
        const w = drawState.canvas.width;
        const h = drawState.canvas.height;
        let temp = null;
        
        // Only attempt to save content if dimensions are valid to prevent IndexSizeError
        if (w > 0 && h > 0) {
            try {
                temp = drawState.ctx.getImageData(0, 0, w, h);
            } catch(e) { console.warn("Failed to capture draw snapshot during resize"); }
        }
        
        drawState.canvas.width = container.offsetWidth;
        drawState.canvas.height = container.offsetHeight;
        
        if (temp) {
            drawState.ctx.putImageData(temp, 0, 0);
        }
    };

    const resizer = new ResizeObserver(() => {
        if (document.getElementById('draw').classList.contains('active')) resize();
    });
    resizer.observe(document.getElementById('drawContainer'));
    resize();

    // Event Listeners
    const c = drawState.canvas;
    c.addEventListener('mousedown', startDrawing);
    c.addEventListener('mousemove', draw);
    c.addEventListener('mouseup', stopDrawing);
    c.addEventListener('mouseleave', stopDrawing);

    c.addEventListener('touchstart', (e) => { 
        if (e.target === c) {
            e.preventDefault(); 
            startDrawing(e.touches[0]); 
        }
    }, {passive: false});
    
    c.addEventListener('touchmove', (e) => { 
        if (e.target === c) {
            e.preventDefault(); 
            draw(e.touches[0]); 
        }
    }, {passive: false});
    
    c.addEventListener('touchend', stopDrawing);

    // Initial Save Point
    saveDrawHistory();
}

function setDrawTool(tool) {
    drawState.currentTool = tool;
    document.querySelectorAll('.draw-tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tool${tool.charAt(0).toUpperCase() + tool.slice(1)}`).classList.add('active');
}

function startDrawing(e) {
    drawState.isDrawing = true;
    const rect = drawState.canvas.getBoundingClientRect();
    drawState.startX = e.clientX - rect.left;
    drawState.startY = e.clientY - rect.top;
    
    drawState.ctx.beginPath();
    drawState.ctx.moveTo(drawState.startX, drawState.startY);
    
    // Save state for shape previewing
    drawState.snap = drawState.ctx.getImageData(0, 0, drawState.canvas.width, drawState.canvas.height);
}

function draw(e) {
    if (!drawState.isDrawing) return;
    const rect = drawState.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    document.getElementById('drawX').innerText = Math.round(x);
    document.getElementById('drawY').innerText = Math.round(y);

    const ctx = drawState.ctx;
    ctx.lineWidth = document.getElementById('brushSize').value;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = document.getElementById('drawColor').value;

    if (drawState.currentTool === 'brush' || drawState.currentTool === 'eraser') {
        if (drawState.currentTool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
        else ctx.globalCompositeOperation = 'source-over';
        
        ctx.lineTo(x, y);
        ctx.stroke();
    } else {
        // Shapes need to restore snapshot first to clear preview
        ctx.globalCompositeOperation = 'source-over';
        ctx.putImageData(drawState.snap, 0, 0);
        ctx.beginPath();
        
        if (drawState.currentTool === 'rect') {
            ctx.strokeRect(drawState.startX, drawState.startY, x - drawState.startX, y - drawState.startY);
        } else if (drawState.currentTool === 'line') {
            ctx.moveTo(drawState.startX, drawState.startY);
            ctx.lineTo(x, y);
            ctx.stroke();
        } else if (drawState.currentTool === 'circle') {
            const r = Math.sqrt(Math.pow(x - drawState.startX, 2) + Math.pow(y - drawState.startY, 2));
            ctx.arc(drawState.startX, drawState.startY, r, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
}

function stopDrawing() {
    if (!drawState.isDrawing) return;
    drawState.isDrawing = false;
    drawState.ctx.globalCompositeOperation = 'source-over';
    saveDrawHistory();
}

function saveDrawHistory() {
    drawState.historyIndex++;
    if (drawState.historyIndex < drawState.history.length) {
        drawState.history.splice(drawState.historyIndex);
    }
    drawState.history.push(drawState.canvas.toDataURL());
    updateDrawMemory();
}

function undoDraw() {
    if (drawState.historyIndex > 0) {
        drawState.historyIndex--;
        loadDrawHistory(drawState.history[drawState.historyIndex]);
    }
}

function redoDraw() {
    if (drawState.historyIndex < drawState.history.length - 1) {
        drawState.historyIndex++;
        loadDrawHistory(drawState.history[drawState.historyIndex]);
    }
}

function loadDrawHistory(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
        drawState.ctx.clearRect(0, 0, drawState.canvas.width, drawState.canvas.height);
        drawState.ctx.drawImage(img, 0, 0);
    };
}

function clearDrawCanvas() {
    if (!confirm("Wipe canvas?")) return;
    drawState.ctx.clearRect(0, 0, drawState.canvas.width, drawState.canvas.height);
    saveDrawHistory();
}

function updateDrawMemory() {
    const total = 50; // History limit
    const percent = (drawState.history.length / total) * 100;
    const bar = document.getElementById('drawMemBar');
    const text = document.getElementById('drawMem');
    if (bar) bar.style.width = percent + '%';
    if (text) text.innerText = Math.round(percent) + '%';
    
    if (drawState.history.length > total) drawState.history.shift();
}

function exportDrawing(format) {
    if (format === 'png') {
        const link = document.createElement('a');
        link.download = `sOuLDRAW_${Date.now()}.png`;
        link.href = drawState.canvas.toDataURL('image/png');
        link.click();
        showToast("Artwork exported to vault.", "success");
    } else {
        const data = {
            v: 2,
            timestamp: Date.now(),
            image: drawState.canvas.toDataURL(),
            historyCount: drawState.history.length
        };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `sOuLDRAW_RAW_${Date.now()}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }
}

function importDrawing() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                loadDrawHistory(data.image);
                showToast("Vectorized data re-materialized.", "success");
            } catch (err) { showToast("Corrupted data stream.", "error"); }
        };
        reader.readAsText(file);
    };
    input.click();
}

// Use DOMContentLoaded instead of window.onload for faster initial execution
// --- TIME & CALENDAR ENGINE ---
function startTimeUpdates() {
    const update = () => {
        const now = new Date();
        const is12h = timeFormat === '12h';
        
        // Update Navbar
        const navTime = document.getElementById('navTime');
        const navDate = document.getElementById('navDate');
        if (navTime) navTime.innerText = now.toLocaleTimeString([], { hour12: is12h });
        if (navDate) navDate.innerText = now.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });

        // Update Modal if visible
        const modal = document.getElementById('timeModal');
        if (modal && !modal.classList.contains('hidden')) {
            if (modalCurrentTab === 'clocks') {
                if (clockType === 'digital') {
                    document.getElementById('modalDigitalTime').innerText = now.toLocaleTimeString([], { hour12: is12h });
                    document.getElementById('modalDigitalDate').innerText = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: '2-digit' });
                } else {
                    const hour = now.getHours();
                    const min = now.getMinutes();
                    const sec = now.getSeconds();

                    const hrDeg = (hour % 12) * 30 + min * 0.5;
                    const minDeg = min * 6 + sec * 0.1;
                    const secDeg = sec * 6;

                    document.getElementById('analogHour').style.transform = `translateX(-50%) rotate(${hrDeg}deg)`;
                    document.getElementById('analogMin').style.transform = `translateX(-50%) rotate(${minDeg}deg)`;
                    document.getElementById('analogSec').style.transform = `translateX(-50%) rotate(${secDeg}deg)`;
                }
            } else if (modalCurrentTab === 'world') {
                renderWorldClocks(); // Re-render world clocks every second for real-time
            }
        }
    };
    
    update();
    setInterval(update, 1000);
}

function openTimeModal() {
    document.getElementById('timeModal').classList.remove('hidden');
    document.getElementById('timeModal').classList.add('flex');
    document.getElementById('userTimezone').innerText = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Set default selected date for event creation to today
    selectCalendarDate(new Date().toISOString().split('T')[0]);
    
    renderCalendar();
    populateTimezoneDropdown(); // Populate dropdown for world clocks

    // Initialize all modal states
    setActiveTimeModalTab(modalCurrentTab); // Restore last active tab
    loadAlarms(); // Load and start checking alarms
    loadWorldClocks(); // Load world clocks
    loadCalendarEvents(); // Load calendar events

    document.body.style.overflow = 'hidden';
}

function closeTimeModal() {
    document.getElementById('timeModal').classList.add('hidden');
    document.getElementById('timeModal').classList.remove('flex');
    document.body.style.overflow = '';
    
    // Stop all modal timers/stopwatches when closing
    pauseModalStopwatch();
    pauseModalTimer();
    // Stop alarm checks if they aren't critical background tasks or were set up to stop.
    // For now, let's assume alarm checks run in background always until app is closed.
}

function setClockType(type) {
    clockType = type;
    const btnD = document.getElementById('btnClockDigital');
    const btnA = document.getElementById('btnClockAnalog');
    const dispD = document.getElementById('displayDigital');
    const dispA = document.getElementById('displayAnalog');
    const formatToggle = document.getElementById('timeFormatToggle');

    if (type === 'digital') {
        if (btnD) btnD.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btnA) btnA.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
        if (dispD) dispD.classList.remove('hidden');
        if (dispA) dispA.classList.add('hidden');
        if (formatToggle) formatToggle.classList.remove('hidden');
    } else {
        if (btnA) btnA.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btnD) btnD.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
        if (dispA) dispA.classList.remove('hidden');
        if (dispD) dispD.classList.add('hidden');
        if (formatToggle) formatToggle.classList.add('hidden');
    }
}

function setTimeFormat(format) {
    timeFormat = format;
    localStorage.setItem('soul_time_format', format);
    const btn12 = document.getElementById('btnFormat12h');
    const btn24 = document.getElementById('btnFormat24h');

    if (format === '12h') {
        if (btn12) btn12.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btn24) btn24.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
    } else {
        if (btn24) btn24.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btn12) btn12.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
    }
    // Re-render world clocks to apply new format
    if (modalCurrentTab === 'world') renderWorldClocks();
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const header = document.getElementById('calMonthYear');
    
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    header.innerText = calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    
    let html = "";
    
    // Prev Month Padding
    for (let i = firstDay; i > 0; i--) {
        html += `<div class="cal-day other-month">${daysInPrevMonth - i + 1}</div>`;
    }
    
    // Current Month
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        const dateString = new Date(year, month, i).toISOString().split('T')[0]; // YYYY-MM-DD
        const isToday = today.getDate() === i && today.getMonth() === month && today.getFullYear() === year;
        const isSelected = selectedCalendarDate.toDateString() === new Date(year, month, i).toDateString();
        
        const hasEvent = calendarEvents.some(event => {
            const eventDate = new Date(event.date);
            return eventDate.getFullYear() === year && eventDate.getMonth() === month && eventDate.getDate() === i;
        });
        
        html += `<div class="cal-day active-month ${isToday ? 'today' : ''} ${isSelected ? 'selected-date' : ''} ${hasEvent ? 'has-event' : ''}" onclick="selectCalendarDate('${dateString}')">${i}</div>`;
    }
    
    // Next Month Padding
    const totalCells = 42;
    const consumed = firstDay + daysInMonth;
    const remaining = totalCells - consumed;
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="cal-day other-month">${i}</div>`;
    }
    
    grid.innerHTML = html;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}