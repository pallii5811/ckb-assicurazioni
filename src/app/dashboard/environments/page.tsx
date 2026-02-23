import { getEnvironments } from './actions'
import { EnvironmentsList } from './EnvironmentsList'

export default async function EnvironmentsPage() {
  const environments = await getEnvironments()

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">I Miei Ambienti</h1>
          <p className="text-gray-500 mt-1">
            Organizza i tuoi lead in ambienti tematici per gestirli meglio
          </p>
        </div>
      </div>

      <EnvironmentsList environments={environments} />
    </div>
  )
}
