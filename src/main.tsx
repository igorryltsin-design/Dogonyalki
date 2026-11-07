import { createRoot } from 'react-dom/client'
import { GameApp } from './GameApp'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('На странице нет контейнера #root')
createRoot(root).render(<GameApp />)
