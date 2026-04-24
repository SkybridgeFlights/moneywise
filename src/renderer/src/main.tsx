import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

type BootPhase = 'preload' | 'bridge' | 'app mount' | 'data load' | 'renderer bootstrap'

function updateBootFallback(phase: BootPhase, error?: unknown): void {
  const phaseNode = document.getElementById('boot-phase')
  const errorNode = document.getElementById('boot-error')
  if (phaseNode) {
    phaseNode.textContent = `Phase: ${phase}`
  }
  if (errorNode) {
    if (!error) {
      errorNode.textContent = 'Renderer started successfully.'
      errorNode.style.color = '#86efac'
      return
    }

    if (error instanceof Error) {
      errorNode.textContent = `${error.message}\n\n${error.stack ?? ''}`
      return
    }

    errorNode.textContent = String(error)
  }
}

function showBootError(phase: BootPhase, error: unknown): void {
  console.error(`[renderer] Boot failure in phase "${phase}"`, error)
  updateBootFallback(phase, error)
}

window.addEventListener('error', (event) => {
  showBootError('renderer bootstrap', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  showBootError('renderer bootstrap', event.reason)
})

console.info('[renderer] main.tsx starting')

class BootErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  constructor(props: React.PropsWithChildren) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    showBootError('app mount', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-error-screen">
          <div className="boot-error-card">
            <h1>MoneyWise startup error</h1>
            <p>Phase: app mount</p>
            <pre>{`${this.state.error.message}\n\n${this.state.error.stack ?? ''}`}</pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

try {
  if (!window.moneywise) {
    throw new Error('Preload bridge is missing. window.moneywise was not exposed.')
  }

  const root = document.getElementById('root')
  if (!root) {
    throw new Error('Renderer root element #root was not found.')
  }

  console.info('[renderer] Bridge detected, mounting React')
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BootErrorBoundary>
        <App />
      </BootErrorBoundary>
    </React.StrictMode>
  )
  updateBootFallback('app mount')
  document.getElementById('boot-fallback')?.remove()
} catch (error) {
  showBootError(!window.moneywise ? 'bridge' : 'app mount', error)
}
