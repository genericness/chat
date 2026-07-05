import { createBrowserRouter } from "react-router-dom"

import { App } from "@/App"
import { ChatPage } from "@/routes/chat"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: "c/:id", element: <ChatPage /> },
    ],
  },
])
