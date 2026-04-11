import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const { user, logout } = useContext(AuthContext);
    const navigate = useNavigate();

    return (
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', background: 'radial-gradient(circle at center, rgba(15, 0, 30, 0.4) 0%, transparent 80%)' }}>
            <nav style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontWeight: '700', letterSpacing: '2px', color: 'var(--accent)' }}>sOuLViSiON</h2>
                <div>
                    {user ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                            <span className="user-email-nav">{user.email}</span>
                            <button onClick={logout} className="counter" style={{ margin: 0, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)' }}>Logout</button>
                        </div>
                    ) : (
                        <button onClick={() => navigate('/login')} className="counter" style={{ margin: 0, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none', fontWeight: 'bold' }}>Sign In</button>
                    )}
                </div>
            </nav>
            
            <div style={{ padding: '6rem 1rem', textAlign: 'center', flexGrow: 1 }}>
                <div style={{ marginBottom: '4rem' }}>
                    <h1 style={{ fontSize: 'clamp(3rem, 10vw, 6rem)', margin: '0 0 1rem', background: 'linear-gradient(to bottom, #fff, #aa3bff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: '800' }}>sOuLViSiON</h1>
                    <p style={{ fontSize: 'clamp(1rem, 4vw, 1.4rem)', color: 'var(--text)', maxWidth: '700px', margin: '0 auto', lineHeight: '1.6' }}>
                        The Ultimate Multi-Tool Platform for the Digital Soul.
                    </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', padding: '0 1rem', maxWidth: '1000px', margin: '0 auto' }}>
                    <div 
                        onClick={() => navigate('/soul-notes')}
                        style={{ 
                            padding: '3rem 2rem', 
                            border: '1px solid var(--border)', 
                            borderRadius: '24px', 
                            cursor: 'pointer', 
                            transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                            background: 'linear-gradient(145deg, rgba(20, 20, 20, 0.8), rgba(0, 0, 0, 0.9))',
                            position: 'relative',
                            overflow: 'hidden'
                        }}
                        onMouseEnter={(e) => { 
                            e.currentTarget.style.transform = 'translateY(-10px) scale(1.02)'; 
                            e.currentTarget.style.borderColor = 'var(--accent)';
                            e.currentTarget.style.boxShadow = '0 20px 40px rgba(170, 59, 255, 0.2)';
                        }}
                        onMouseLeave={(e) => { 
                            e.currentTarget.style.transform = 'translateY(0) scale(1)'; 
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        <h2 style={{ color: '#fff', fontSize: '2rem', marginBottom: '1rem' }}>sOuLNoTeS</h2>
                        <p style={{ color: 'var(--text)', fontSize: '1rem' }}>Orchestrate your thoughts and tasks in a distraction-free, AMOLED environment.</p>
                        <div style={{ marginTop: '2rem', fontWeight: 'bold', color: 'var(--accent)', fontSize: '0.9rem', letterSpacing: '1px' }}>LAUNCH TOOL →</div>
                    </div>

                    <div style={{ 
                        padding: '3rem 2rem', 
                        border: '1px solid var(--border)', 
                        borderRadius: '24px', 
                        background: 'rgba(5, 5, 5, 0.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        borderStyle: 'dashed'
                    }}>
                        <h2 style={{ color: 'var(--text)', opacity: 0.5 }}>Future Vision</h2>
                        <p style={{ color: 'var(--text)', opacity: 0.3 }}>Expanding the cosmos with more specialized utilities.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}