// --- Navigation Logic ---
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo(0,0);
}

// --- Floating Mini Chat Logic ---
function toggleMiniChat() {
    const mini = document.getElementById('miniChat');
    mini.classList.toggle('show');
}

async function askMiniAI() {
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    const text = inputEl.value;
    if(!text) return;

    box.innerHTML += `<div class="message user-msg text-xs">${text}</div>`;
    inputEl.value = '';

    await callGeminiAPI(text, box, 'text-xs');
}

// --- Admin & AI Logic (Key Rotation) ---
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;

async function loadConfig() {
    const res = await fetch('/api/main?route=admin_config');
    const data = await res.json();
    if(data) {
        aiConfig.keys = data.keys || [];
        aiConfig.models = data.models || [];
        updateAIUI();
    }
}

function updateAIUI() {
    const select = document.getElementById('modelSelect');
    select.innerHTML = aiConfig.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
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
    const model = (modelSelect && modelSelect.value) ? modelSelect.value : "gemini-pro";
    if(!aiConfig.keys.length) return alert("Admin has not added API keys!");

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            body: JSON.stringify({ contents: [{ parts: [{ text: text }] }] })
        });
        
        const data = await response.json();
        if (data.error) throw new Error("Key Failed");

        const aiText = data.candidates[0].content.parts[0].text;
        displayBox.innerHTML += `<div class="message ai-msg ${msgClass}">${aiText}</div>`;
        displayBox.scrollTop = displayBox.scrollHeight;
    } catch (err) {
        console.log("Switching Key...");
        currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
        await callGeminiAPI(text, displayBox, msgClass);
    }
}

// --- Note Taking Logic ---
let notes = [];
function addNote() {
    const text = document.getElementById('noteInput').value;
    const note = { id: Date.now(), text: text };
    notes.push(note);
    renderNotes();
    document.getElementById('noteInput').value = '';
}

function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = notes.map(n => `
        <div class="glass p-4 rounded flex justify-between items-center">
            <span>${n.text}</span>
            <button onclick="deleteNote(${n.id})" class="text-red-500"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

function deleteNote(id) {
    notes = notes.filter(n => n.id !== id);
    renderNotes();
}

// --- Cricket Game Logic ---
let runScore = 0;
function playCricket() {
    const outcomes = [0, 1, 2, 3, 4, 6, 'Wicket'];
    const result = outcomes[Math.floor(Math.random() * outcomes.length)];
    const status = document.getElementById('status');
    const scoreDiv = document.getElementById('score');

    if (result === 'Wicket') {
        status.innerText = "OUT! Final Score: " + runScore;
        runScore = 0;
    } else {
        runScore += result;
        status.innerText = `You hit a ${result}!`;
        scoreDiv.innerText = runScore;
    }
}

// --- Razorpay Integration ---
function payNow() {
    const amount = document.getElementById('donAmount').value;
    const options = {
        "key": "YOUR_RAZORPAY_KEY", // Enter your key here
        "amount": amount * 100,
        "currency": "INR",
        "name": "sOuLViSiON Support",
        "handler": function (response){
            alert("Thank you for your donation! ID: " + response.razorpay_payment_id);
        },
        "theme": { "color": "#0891b2" }
    };
    const rzp = new Razorpay(options);
    rzp.open();
}

// --- Initialization ---
window.onload = () => {
    loadConfig();
    
    document.getElementById('aiWidget').onclick = toggleMiniChat;

    // Simple Admin Auth Check (Demo: Prompt)
    const isAdmin = localStorage.getItem('isAdmin');
    if(isAdmin) document.getElementById('adminBtn').classList.remove('hidden');
};