import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Desactivar tooltips blancos por defecto del navegador en validaciones HTML5
if (typeof document !== 'undefined') {
  document.addEventListener(
    'invalid',
    (e) => {
      e.preventDefault()
    },
    true
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

