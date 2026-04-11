import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthContext } from './context/AuthContext';
import Home from './pages/Home';
import SoulNotes from './pages/SoulNotes';
import Login from './pages/Login';
import Register from './pages/Register';

const PrivateRoute = ({ children }) => {
    const { user } = useContext(AuthContext);
    return user ? children : <Navigate to="/login" />;
};

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/soul-notes" element={<PrivateRoute><SoulNotes /></PrivateRoute>} />
            </Routes>
        </Router>
    );
}
export default App;