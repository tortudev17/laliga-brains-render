import { useEffect, useState } from "react";
import { CircleUserRound } from "lucide-react";
import { downloadFirebaseFile } from "../services/api/client";

type UserAvatarProps = {
  photoPath?: string | null;
  name: string;
  size?: number;
  className?: string;
};

export function UserAvatar({ photoPath, name, size = 38, className = "" }: UserAvatarProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    setUrl("");
    if (!photoPath) return () => { active = false; };

    let objectUrl = "";
    void downloadFirebaseFile(photoPath)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active) setUrl(""); });

    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photoPath]);

  return <span className={`user-avatar ${className}`} style={{ width: size, height: size }} aria-label={`Foto de ${name}`}>
    {url ? <img src={url} alt="" onError={() => setUrl("")} /> : <CircleUserRound size={Math.round(size * 0.58)} aria-hidden="true" />}
  </span>;
}
