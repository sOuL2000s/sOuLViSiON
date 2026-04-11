import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthContext } from './context/AuthContext';
import Home from './pages/Home';
import ToolOne from './pages/ToolOne'; // Placeholder

const PrivateRoute = ({ children }) => {
    const { user } = useContext(AuthContext);
    return user ? children : <Navigate to="/" />;
};

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Home />} />
                {/* Scalable Tool Routes */}
                <Route path="/tool/1" element={<PrivateRoute><ToolOne /></PrivateRoute>} />
            </Routes>
        </Router>
    );
}
export default App;