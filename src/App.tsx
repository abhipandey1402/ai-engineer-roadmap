import { courses, getCourse } from './data'
import { useStatuses } from './hooks/useProgress'
import { useTheme } from './hooks/useTheme'
import { navigate, useRoute } from './hooks/useRoute'
import { HomePage } from './components/HomePage'
import { CourseApp } from './components/CourseApp'
import { PlaygroundApp } from './components/python/PlaygroundApp'
import { CodeRunnerDock } from './components/python/CodeRunnerDock'

export default function App() {
  const route = useRoute()
  const { statuses, setStatus } = useStatuses()
  const { theme, toggleTheme } = useTheme()

  // The Playground is itself a full runner, so the floating dock is redundant there.
  if (route.kind === 'playground') {
    return <PlaygroundApp theme={theme} onToggleTheme={toggleTheme} />
  }

  const course = route.kind === 'home' ? null : getCourse(route.courseId)

  // Keep the dock as a stable trailing sibling so its state survives navigation
  // between home / course / topic without remounting.
  const content =
    route.kind === 'home' || !course ? (
      <HomePage
        courses={courses}
        statuses={statuses}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenCourse={(id) => navigate(id)}
        onOpenPlayground={() => navigate('playground')}
      />
    ) : (
      <CourseApp
        course={course}
        route={route}
        statuses={statuses}
        setStatus={setStatus}
        theme={theme}
        toggleTheme={toggleTheme}
        onHome={() => navigate('')}
      />
    )

  return (
    <>
      {content}
      <CodeRunnerDock />
    </>
  )
}
