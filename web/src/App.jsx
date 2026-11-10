import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PlayerApp from './player/PlayerApp.jsx';
import AdminApp from './admin/AdminApp.jsx';
import AgentApp from './agent/AgentApp.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PlayerApp />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="/agent/*" element={<AgentApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
