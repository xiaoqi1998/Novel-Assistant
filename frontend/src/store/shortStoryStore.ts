import { create } from 'zustand';
import type { ShortStory } from '../types';

interface ShortStoryState {
  currentStory: ShortStory | null;
  setCurrentStory: (story: ShortStory | null) => void;
  updateCurrentStory: (patch: Partial<ShortStory>) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

export const useShortStoryStore = create<ShortStoryState>((set) => ({
  currentStory: null,
  setCurrentStory: (story) => set({ currentStory: story }),
  updateCurrentStory: (patch) =>
    set((state) => ({
      currentStory: state.currentStory ? { ...state.currentStory, ...patch } : null,
    })),
  loading: false,
  setLoading: (loading) => set({ loading: loading }),
}));
