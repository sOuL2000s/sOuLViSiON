import { createContext, useState, useEffect } from 'react';
export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const login = (userData) => {
        localStorage.setItem('token', userData.token);
        setUser(userData.user);
    };
    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
    };
    return (
        <AuthContext.Provider value={{ user, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};