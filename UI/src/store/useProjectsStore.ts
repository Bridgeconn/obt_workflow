import { create } from "zustand";

interface ProjectsState {
  projects: Project[];
  activeProjects: Project[];
  archivedProjects: Project[];
  setProjects: (projects: Project[]) => void;
  isActive: boolean;
  setActive: (active: boolean) => void;
}

export interface Project {
  id: string;
  name: string;
  owner: string;
  scriptLanguage: string;
  audioLanguage: string;
  books: number;
  approved: number;
  archive: boolean;
}

const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  activeProjects: [],
  archivedProjects: [],
  setProjects: (projects) =>
    set({
      projects,
      activeProjects: projects.filter((project) => !project.archive),
      archivedProjects: projects.filter((project) => project.archive),
    }),
  isActive: true,
  setActive: (active) => set({ isActive: active }),
}));

export default useProjectsStore;
