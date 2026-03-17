import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Branch {
  id: string;
  businessId: string;
  name: string;
  address?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BranchState {
  selectedBranchId: string | null; // null = "All branches"
  setSelectedBranch: (branchId: string | null) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      selectedBranchId: null,
      setSelectedBranch: (branchId) => set({ selectedBranchId: branchId }),
    }),
    { name: "branch-storage" }
  )
);
