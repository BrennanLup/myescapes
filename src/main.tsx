import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { installBridge } from './state/bridge'
import { installTestHooks } from './contracts/testing'
import { useStore } from './state/store'
import { bus } from './contracts/events'

installBridge()
installTestHooks()
void useStore.getState().loadData()

// First user gesture unlocks audio etc.
const gesture = () => {
  bus.emit('user:gesture')
  window.removeEventListener('pointerdown', gesture)
  window.removeEventListener('keydown', gesture)
}
window.addEventListener('pointerdown', gesture)
window.addEventListener('keydown', gesture)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
