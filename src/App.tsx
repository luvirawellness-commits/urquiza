import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Auth from '@/pages/Auth'
import Dashboard from '@/pages/Dashboard'
import Clientes from '@/pages/Clientes'
import Agenda from '@/pages/Agenda'
import Finanzas from '@/pages/Finanzas'
import GiftCards from '@/pages/GiftCards'
import Productos from '@/pages/Productos'
import RRHH from '@/pages/RRHH'
import Configuracion from '@/pages/Configuracion'
import ConfiguracionAdmin from '@/pages/ConfiguracionAdmin'
import Membresias from '@/pages/Membresias'
import Auditoria from '@/pages/Auditoria'
import ClienteDetalle from '@/pages/ClienteDetalle'

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <AppLayout />
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/clientes/:id" element={<ClienteDetalle />} />
              <Route path="/agenda" element={<Agenda />} />
              <Route
                path="/finanzas"
                element={
                  <ProtectedRoute anyPermission={['caja', 'finanzas']}>
                    <Finanzas />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rrhh"
                element={
                  <ProtectedRoute permission="rrhh">
                    <RRHH />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/productos"
                element={
                  <ProtectedRoute permission="productos">
                    <Productos />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/gift-cards"
                element={
                  <ProtectedRoute permission="gift_cards">
                    <GiftCards />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/compras"
                element={
                  <ProtectedRoute permission="compras">
                    <Configuracion />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/membresias"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
                    <Membresias />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/auditoria"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
                    <Auditoria />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracion-admin"
                element={
                  <ProtectedRoute roles={['owner']}>
                    <ConfiguracionAdmin />
                  </ProtectedRoute>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
