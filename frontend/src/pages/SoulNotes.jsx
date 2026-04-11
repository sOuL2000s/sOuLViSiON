import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function SoulNotes() {
    const [notes, setNotes] = useState([]);
    const [newNote, setNewNote] = useState('');
    const [type, setType] = useState('note');
    const navigate = useNavigate();
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

    const fetchNotes = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`${API_URL}/api/notes`, {
                headers: { 'x-auth-token': token }
            });
            setNotes(res.data);
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        fetchNotes();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!newNote.trim()) return;
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_URL}/api/notes`, 
                { content: newNote, type }, 
                { headers: { 'x-auth-token': token } }
            );
            setNewNote('');
            fetchNotes();
        } catch (err) {
            console.error(err);
        }
    };

    const deleteNote = async (id) => {
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/api/notes/${id}`, {
                headers: { 'x-auth-token': token }
            });
            fetchNotes();
        } catch (err) {
            console.error(err);
        }
    };

    const toggleTodo = async (note) => {
        try {
            const token = localStorage.getItem('token');
            await axios.put(`${API_URL}/api/notes/${note._id}`, 
                { completed: !note.completed }, 
                { headers: { 'x-auth-token': token } }
            );
            fetchNotes();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div style={{ padding: '2rem 1rem', maxWidth: '900px', margin: '0 auto', textAlign: 'left', minHeight: '100vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: '800', background: 'linear-gradient(to right, #fff, var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>sOuLNoTeS</h1>
                <button onClick={() => navigate('/')} className="counter" style={{ cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', fontSize: '0.9rem' }}>Back to Vision</button>
            </div>

            <form onSubmit={handleSubmit} style={{ marginBottom: '3rem', background: 'rgba(15, 15, 15, 0.8)', padding: '2rem', borderRadius: '24px', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                <textarea 
                    placeholder="Capture your thoughts..." 
                    value={newNote} 
                    onChange={(e) => setNewNote(e.target.value)}
                    style={{ width: '100%', padding: '1.2rem', borderRadius: '16px', border: '1px solid var(--border)', minHeight: '120px', marginBottom: '1.5rem', boxSizing: 'border-box', background: '#000', color: '#fff', fontSize: '1.1rem', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: '0.8rem 1.2rem', borderRadius: '12px', background: '#000', color: '#fff', border: '1px solid var(--border)', fontSize: '0.9rem', cursor: 'pointer' }}>
                        <option value="note">Thought (Note)</option>
                        <option value="todo">Mission (To-Do)</option>
                    </select>
                    <button type="submit" className="counter" style={{ margin: 0, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none', fontWeight: 'bold', padding: '0.8rem 2rem' }}>Add to Soul</button>
                </div>
            </form>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
                {notes.map(note => (
                    <div key={note._id} style={{ 
                        padding: '1.5rem', 
                        border: '1px solid var(--border)', 
                        borderRadius: '20px', 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        background: note.completed ? 'rgba(170, 59, 255, 0.05)' : 'rgba(10, 10, 10, 0.5)',
                        transition: 'all 0.3s ease',
                        backdropFilter: 'blur(5px)'
                    }}>
                        <div style={{ flexGrow: 1, paddingRight: '1rem' }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--accent)', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '0.8rem' }}>{note.type}</div>
                            <p style={{ 
                                textDecoration: note.completed ? 'line-through' : 'none',
                                opacity: note.completed ? 0.4 : 1,
                                whiteSpace: 'pre-wrap',
                                margin: 0,
                                fontSize: '1.1rem',
                                color: '#fff',
                                lineHeight: '1.5'
                            }}>
                                {note.content}
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.8rem' }}>
                            {note.type === 'todo' && (
                                <button onClick={() => toggleTodo(note)} style={{ cursor: 'pointer', background: note.completed ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)', color: note.completed ? '#000' : 'var(--accent)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                    {note.completed ? 'Undo' : 'Complete'}
                                </button>
                            )}
                            <button onClick={() => deleteNote(note._id)} style={{ cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255, 77, 77, 0.5)', color: '#ff4d4d', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>Delete</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}