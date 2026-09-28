import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button, Empty } from '@/components/ui'

export default function NotFound() {
  return (
    <Empty icon={Compass} title="Esta página no existe" text="Revisa el enlace o regresa al inicio."
      action={<Link to="/"><Button>Ir al Dashboard</Button></Link>} />
  )
}
