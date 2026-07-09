import { createBrowserRouter } from "react-router-dom"

import { App } from "@/App"
import { ChatPage } from "@/routes/chat"
import { OAuthCallback } from "@/routes/oauth-callback"
import { SharedChat } from "@/routes/shared"

export const router = createBrowserRouter([
  { path: "/oauth/callback", element: <OAuthCallback /> },
  { path: "/s/:token", element: <SharedChat /> },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: "c/:id", element: <ChatPage /> },
    ],
  },
])
