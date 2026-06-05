import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import ClienteDetalle from '@/pages/ClienteDetalle'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
    },
  },
})

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
              <Route path="/finanzas" element={<Finanzas />} />
              <Route
                path="/rrhh"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
                    <RRHH />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/productos"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
                    <Productos />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/gift-cards"
                element={
                  <ProtectedRoute roles={['owner', 'partner_admin']}>
                    <GiftCards />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracion"
                element={
                  <ProtectedRoute roles={['owner']}>
                    <Configuracion />
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
