import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const { login } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('http://localhost:5000/api/auth/login', { email, password });
            login(res.data);
            navigate('/');
        } catch (err) {
            alert(err.response?.data?.msg || "Login failed");
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: '1rem' }}>
            <div style={{ width: '100%', maxWidth: '400px', padding: '3rem 2rem', border: '1px solid var(--border)', borderRadius: '24px', background: 'rgba(10, 10, 10, 0.8)', boxShadow: 'var(--shadow)' }}>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '2rem', fontWeight: '800' }}>Sign In</h1>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <input 
                        type="email" 
                        placeholder="Email" 
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)} 
                        style={{ padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)', background: '#000', color: '#fff' }}
                        required
                    />
                    <div style={{ position: 'relative' }}>
                        <input 
                            type={showPassword ? "text" : "password"} 
                            placeholder="Password" 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            style={{ width: '100%', boxSizing: 'border-box', padding: '1rem', paddingRight: '3rem', borderRadius: '12px', border: '1px solid var(--border)', background: '#000', color: '#fff' }}
                            required
                        />
                        <button 
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '1.2rem' }}
                        >
                            {showPassword ? '👁️' : '👁️‍🗨️'}
                        </button>
                    </div>
                    <button type="submit" className="counter" style={{ cursor: 'pointer', border: 'none', padding: '1rem', background: 'var(--accent)', color: '#000', fontWeight: 'bold', fontSize: '1rem' }}>Login</button>
                </form>

                <div style={{ margin: '1.5rem 0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text)', opacity: 0.5 }}>OR CONTINUE WITH</span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <button style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid var(--border)', background: '#000', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        <img src="https://www.svgrepo.com/show/475656/google-color.svg" width="20" alt="Google" /> Google
                    </button>
                    <button style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid var(--border)', background: '#000', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        <img src="https://www.svgrepo.com/show/512317/github-142.svg" width="20" alt="GitHub" style={{ filter: 'invert(1)' }} /> GitHub
                    </button>
                </div>

                <p style={{ marginTop: '2rem', color: 'var(--text)' }}>
                    New to the vision? <Link to="/register" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 'bold' }}>Sign Up</Link>
                </p>
            </div>
        </div>
    );
}