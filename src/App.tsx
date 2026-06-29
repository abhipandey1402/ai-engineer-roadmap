import { courses, getCourse } from './data'
import { useStatuses } from './hooks/useProgress'
import { useTheme } from './hooks/useTheme'
import { navigate, useRoute } from './hooks/useRoute'
import { HomePage } from './components/HomePage'
import { CourseApp } from './components/CourseApp'

export default function App() {
  const route = useRoute()
  const { statuses, setStatus } = useStatuses()
  const { theme, toggleTheme } = useTheme()

  const course = route.kind === 'home' ? null : getCourse(route.courseId)

  if (route.kind === 'home' || !course) {
    return (
      <HomePage
        courses={courses}
        statuses={statuses}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenCourse={(id) => navigate(id)}
      />
    )
  }

  return (
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
}
