import { createFileRoute } from '@tanstack/react-router'
import MapPage from '../features/map/MapPage'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return <MapPage />
}
