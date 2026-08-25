"use client";

import { useRef, useState } from "react";
import { Check, Upload } from "@/ui/icon-registry";
import { Input } from "@/ui";
import {
  PROFILE_HUES,
  profileAvatarColor,
  ProfileAvatar,
  profileImageFromFile,
  useLocalProfile,
} from "@/features/shell/local-profile";
import { SettingsButton, SettingsGroup } from "./settings-ui";

export function ProfileSettings() {
  const [profile, updateProfile] = useLocalProfile();
  const [imageError, setImageError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const updateImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      updateProfile({ imageUrl: await profileImageFromFile(file) });
      setImageError("");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Image failed to load");
    }
  };

  return (
    <div className="space-y-10">
      <SettingsGroup
        title="Your profile"
        description="Shown in the sidebar and alongside local usage."
      >
        <div className="grid gap-6 px-1 py-6 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center sm:px-3">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="group relative rounded-full outline-none ring-offset-4 ring-offset-(--ui-bg) focus-visible:ring-2 focus-visible:ring-(--ui-fg)/50"
              aria-label="Update profile image"
            >
              <ProfileAvatar profile={profile} size={88} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Upload className="h-5 w-5 text-white" />
              </span>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void updateImage(event.currentTarget.files?.[0])}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="text-[length:var(--fs-xs)] text-(--ui-muted) transition-colors hover:text-(--ui-fg)"
            >
              Change photo
            </button>
          </div>
          <div className="min-w-0 space-y-5">
            <div>
              <label
                htmlFor="profile-display-name"
                className="mb-1.5 block text-[length:var(--fs-sm)] font-medium text-(--ui-fg)"
              >
                Display name
              </label>
              <Input
                id="profile-display-name"
                value={profile.name}
                onChange={(event) => updateProfile({ name: event.target.value })}
                onBlur={() => {
                  if (!profile.name.trim()) updateProfile({ name: "Studio" });
                }}
                className="h-9 max-w-sm"
                placeholder="Studio"
              />
            </div>
            <div>
              <div className="mb-2 text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
                Avatar color
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {PROFILE_HUES.map((hue) => (
                  <button
                    key={hue}
                    type="button"
                    onClick={() => updateProfile({ hue })}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-fg)/50"
                    style={{ background: profileAvatarColor(hue) }}
                    aria-label={`Avatar color ${hue}`}
                    aria-pressed={profile.hue === hue}
                  >
                    {profile.hue === hue ? <Check className="h-4 w-4 text-white" /> : null}
                  </button>
                ))}
                {profile.imageUrl ? (
                  <SettingsButton onClick={() => updateProfile({ imageUrl: undefined })}>
                    Remove photo
                  </SettingsButton>
                ) : null}
              </div>
            </div>
            {imageError ? (
              <p className="text-[length:var(--fs-sm)] text-(--err)">{imageError}</p>
            ) : null}
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
