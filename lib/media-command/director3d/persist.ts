import { cloneProject, type HvsProject } from '../types'
import { cloneScene, emptyDirector3DStore, type Hvs3DScene, nid } from './types'

export function directorStore(project: HvsProject) {
  return project.director3d ?? emptyDirector3DStore()
}

export function activeScene(project: HvsProject): Hvs3DScene | null {
  const store = directorStore(project)
  if (!store.activeSceneId) return store.scenes[0] ?? null
  return store.scenes.find(item => item.id === store.activeSceneId) ?? store.scenes[0] ?? null
}

export function attachDirector3D(project: HvsProject, scene: Hvs3DScene): HvsProject {
  const next = cloneProject(project)
  const store = directorStore(next)
  const scenes = store.scenes.filter(item => item.id !== scene.id)
  scenes.unshift(scene)
  next.director3d = {
    ...store,
    activeSceneId: scene.id,
    scenes,
  }
  next.updatedAt = new Date().toISOString()
  return next
}

export function pushSceneRevision(project: HvsProject, scene: Hvs3DScene, label: string): HvsProject {
  const next = cloneProject(project)
  const store = directorStore(next)
  const revisions = [
    {
      id: nid('rev3d'),
      sceneId: scene.id,
      label,
      createdAt: new Date().toISOString(),
      snapshot: cloneScene(scene),
    },
    ...store.revisions,
  ].slice(0, 12)
  next.director3d = { ...store, revisions, activeSceneId: scene.id, scenes: store.scenes.some(item => item.id === scene.id) ? store.scenes.map(item => item.id === scene.id ? scene : item) : [scene, ...store.scenes] }
  return next
}

export function restoreSceneRevision(project: HvsProject, revisionId: string): HvsProject {
  const store = directorStore(project)
  const revision = store.revisions.find(item => item.id === revisionId)
  if (!revision) throw new Error('Unknown 3D scene revision.')
  return attachDirector3D(project, cloneScene(revision.snapshot))
}
