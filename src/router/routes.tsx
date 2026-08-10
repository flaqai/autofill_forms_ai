import { type RouteObject, Navigate } from 'react-router-dom'
import App from '@/App'
import { ChatPage } from '@/pages/ChatPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { BatchSubmitPage } from '@/pages/BatchSubmitPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Navigate to="/chat" replace />
      },
      {
        path: 'chat',
        element: <ChatPage />
      },
      {
        path: 'batch',
        element: <BatchSubmitPage />
      },
      {
        path: 'settings',
        element: <SettingsPage />
      },
      {
        path: '*',
        element: <Navigate to="/chat" replace />
      }
    ]
  }
]
