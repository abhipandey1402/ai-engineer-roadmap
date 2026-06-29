export interface CodeSnippet {
  title: string
  language: string
  code: string
}

export type ResourceType = 'article' | 'video' | 'course' | 'official' | 'opensource'

export interface Resource {
  title: string
  url: string
  type: ResourceType
}

export interface LabStep {
  title: string
  explanation: string
  python: string | null
  javascript: string | null
}

export interface HandsOnLab {
  goal: string
  steps: LabStep[]
  practice: string[]
}

export interface Topic {
  id: string
  title: string
  subsection: string | null
  minutes: number
  intro: string
  summary: string[]
  keyPoints: string[]
  code: CodeSnippet[]
  resources: Resource[]
  handsOn?: HandsOnLab
}

export interface Section {
  id: string
  title: string
  description: string
  topics: Topic[]
}

/** Globally-unique key for a topic (topic ids can repeat across sections). */
export const topicKey = (sectionId: string, topicId: string) => `${sectionId}/${topicId}`
