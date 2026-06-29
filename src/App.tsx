import { getCourse } from './data'
import { useStatuses } from './hooks/useProgress'
import { useTheme } from './hooks/useTheme'
import { CourseApp } from './components/CourseApp'

export default function App() {
  const { statuses, setStatus } = useStatuses()
  const { theme, toggleTheme } = useTheme()
  const course = getCourse('ai-engineer')!

  return (
    <CourseApp
      course={course}
      route={{ kind: 'course', courseId: course.id }}
      statuses={statuses}
      setStatus={setStatus}
      theme={theme}
      toggleTheme={toggleTheme}
      onHome={() => {}}
    />
  )
}
