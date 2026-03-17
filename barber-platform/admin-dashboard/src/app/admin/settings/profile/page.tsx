"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, apiUpload } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { User, Camera } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import toast from "react-hot-toast";

interface ProfileStaff {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
}

export default function ProfileSettingsPage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const profilePhotoRef = useRef<HTMLInputElement>(null);

  const staffId = user?.staffId;

  const { data: profileStaff } = useQuery<ProfileStaff>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient<ProfileStaff>("/staff/me"),
    enabled: !!staffId && !!businessId,
  });

  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
  });

  const profileUpdateMutation = useMutation({
    mutationFn: (data: { firstName: string; lastName: string; phone?: string }) =>
      apiClient(`/staff/${staffId}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || undefined,
        }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      const newName = `${variables.firstName} ${variables.lastName}`.trim();
      if (newName && user) {
        setAuth({ ...user, name: newName }, accessToken, refreshToken);
      }
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  const profilePhotoMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("photo", file);
      return apiUpload<ProfileStaff>(
        `/staff/${staffId}/photo?businessId=${businessId}`,
        fd
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed to upload"),
  });

  useEffect(() => {
    if (profileStaff) {
      setProfileForm({
        firstName: profileStaff.firstName,
        lastName: profileStaff.lastName,
        phone: profileStaff.phone ?? "",
      });
    }
  }, [profileStaff]);

  if (!businessId || !staffId) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view this page.
        </p>
      </div>
    );
  }

  if (!profileStaff) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("widget.loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
      <h1 className="mb-2 flex items-center gap-2 text-xl font-semibold">
        <User className="h-6 w-6 text-violet-600" />
        {t("settings.profile")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("settings.profileDesc")}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          profileUpdateMutation.mutate(profileForm);
        }}
        className="flex flex-col gap-4 sm:flex-row sm:items-start"
      >
        <div className="relative shrink-0">
          <div className="h-20 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-600">
            {profileStaff.avatarUrl ? (
              <img
                src={
                  profileStaff.avatarUrl.startsWith("http")
                    ? profileStaff.avatarUrl
                    : `${process.env.NEXT_PUBLIC_API_URL || ""}${profileStaff.avatarUrl}`
                }
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-medium text-zinc-500">
                {profileStaff.firstName?.[0]}
                {profileStaff.lastName?.[0]}
              </div>
            )}
          </div>
          <input
            ref={profilePhotoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) profilePhotoMutation.mutate(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => profilePhotoRef.current?.click()}
            className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-white shadow dark:bg-zinc-600"
            aria-label="Change photo"
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("staff.name")}
              </label>
              <input
                type="text"
                value={profileForm.firstName}
                onChange={(e) =>
                  setProfileForm((p) => ({ ...p, firstName: e.target.value }))
                }
                placeholder={t("register.firstName")}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">&nbsp;</label>
              <input
                type="text"
                value={profileForm.lastName}
                onChange={(e) =>
                  setProfileForm((p) => ({ ...p, lastName: e.target.value }))
                }
                placeholder={t("register.lastName")}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("staff.phone")}
            </label>
            <input
              type="tel"
              value={profileForm.phone}
              onChange={(e) =>
                setProfileForm((p) => ({ ...p, phone: e.target.value }))
              }
              placeholder="050xxxxxxxx"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <LoadingButton
            type="submit"
            loading={profileUpdateMutation.isPending}
          >
            {t("settings.save")}
          </LoadingButton>
        </div>
      </form>
    </div>
  );
}
