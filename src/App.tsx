import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/contexts/AuthContext'
import { Toaster } from '@/components/ui/toaster'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Auth from '@/pages/Auth'
import ResetPassword from '@/pages/ResetPassword'
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
import SuperAdmin from '@/pages/SuperAdmin'
import Registro from '@/pages/Registro'
import Pago from '@/pages/Pago'
import PagoExitoso from '@/pages/PagoExitoso'
import PagoFallido from '@/pages/PagoFallido'
import Facturacion from '@/pages/Facturacion'
import AceptarTerminos from '@/pages/AceptarTerminos'

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
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/aceptar-terminos" element={<AceptarTerminos />} />
            <Route path="/pago" element={<Pago />} />
            <Route path="/pago-exitoso" element={<PagoExitoso />} />
            <Route path="/pago-fallido" element={<PagoFallido />} />
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
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
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
                path="/usuarios"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
                    <ConfiguracionAdmin defaultTab="usuarios" hideTabs />
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
              <Route
                path="/facturacion"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin', 'super_admin']}>
                    <Facturacion />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/super-admin"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <SuperAdmin />
                  </ProtectedRoute>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  )
}
